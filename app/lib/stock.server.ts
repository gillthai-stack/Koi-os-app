// Reads live sales and stock from Shopify for the KOI//OS reorder table.
// Uses the offline token stored when the KOI OS Shopify app was installed.
import prisma from "../db.server";
import { DISTRIBUTOR_SITES, defaultQtyUnit, type QtyUnit } from "./distributors";
import { unauthenticated } from "../shopify.server";
import {
  NEW_ITEM_WINDOW_DAYS,
  SALES_WINDOW_DAYS,
  STORES,
  TOP_SELLER_COUNT,
  cartonsFor,
  daysAgoISODate,
  defaultStamp,
  isExcluded,
  reorderFor,
  soldByVariant,
  topVariants,
  type SaleLine,
  type Stamp,
  type Status,
  type StoreKey,
} from "./ordering";

type GraphQL = (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;

export function shopDomain(): string {
  return process.env.SHOP || "vaping-koi.myshopify.com";
}

export class ShopifyNotConnected extends Error {}

async function adminClient(): Promise<GraphQL> {
  try {
    const { admin } = await unauthenticated.admin(shopDomain());
    return admin.graphql as unknown as GraphQL;
  } catch {
    throw new ShopifyNotConnected("The KOI OS Shopify app isn't installed on the store yet.");
  }
}

async function gql<T>(graphql: GraphQL, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) throw new Error(`Shopify query failed: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function findLocation(graphql: GraphQL, store: StoreKey) {
  const wanted = STORES.find((s) => s.key === store)!;
  const data = await gql<{ locations: { nodes: { id: string; name: string }[] } }>(
    graphql,
    `#graphql
    query KoiLocations { locations(first: 50) { nodes { id name } } }`,
  );
  const loc = data.locations.nodes.find((l) => l.name === wanted.locationName);
  if (!loc) throw new Error(`No Shopify location named "${wanted.locationName}"`);
  return loc;
}

async function fetchSales(graphql: GraphQL, locationId: string): Promise<SaleLine[]> {
  const numericId = locationId.split("/").pop();
  const q = `created_at:>=${daysAgoISODate(SALES_WINDOW_DAYS)} AND location_id:${numericId}`;
  const lines: SaleLine[] = [];
  let after: string | null = null;
  // 40 orders x 20 lines keeps each page under Shopify's query cost limit.
  for (let page = 0; page < 100; page++) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          retailLocation: { id: string } | null;
          lineItems: { nodes: { quantity: number; variant: { id: string } | null }[] };
        }[];
      };
    } = await gql(
      graphql,
      `#graphql
      query KoiSales($q: String!, $after: String) {
        orders(first: 40, after: $after, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes { retailLocation { id } lineItems(first: 20) { nodes { quantity variant { id } } } }
        }
      }`,
      { q, after },
    );
    for (const o of data.orders.nodes) {
      if (o.retailLocation && o.retailLocation.id !== locationId) continue;
      for (const li of o.lineItems.nodes) lines.push({ variantId: li.variant?.id ?? null, quantity: li.quantity });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return lines;
}

type VariantInfo = {
  id: string;
  name: string;
  productTitle: string;
  vendor: string;
  stock: number | null; // null = not stocked at this store
};

const VARIANT_FIELDS = `
  id title
  product { title vendor }
  inventoryItem { inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { quantity } } }
`;

type RawVariant = {
  id: string;
  title: string;
  product: { title: string; vendor: string };
  inventoryItem: { inventoryLevel: { quantities: { quantity: number }[] } | null };
};

function toInfo(v: RawVariant): VariantInfo {
  const flavour = v.title === "Default Title" ? "" : ` · ${v.title}`;
  return {
    id: v.id,
    name: `${v.product.title}${flavour}`,
    productTitle: v.product.title,
    vendor: v.product.vendor,
    stock: v.inventoryItem.inventoryLevel ? v.inventoryItem.inventoryLevel.quantities[0]?.quantity ?? 0 : null,
  };
}

async function fetchVariants(graphql: GraphQL, ids: string[], locationId: string): Promise<Map<string, VariantInfo>> {
  const out = new Map<string, VariantInfo>();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await gql<{ nodes: (RawVariant | null)[] }>(
      graphql,
      `#graphql
      query KoiVariants($ids: [ID!]!, $loc: ID!) { nodes(ids: $ids) { ... on ProductVariant { ${VARIANT_FIELDS} } } }`,
      { ids: ids.slice(i, i + 50), loc: locationId },
    );
    for (const v of data.nodes) if (v && v.id) out.set(v.id, toInfo(v));
  }
  return out;
}

async function fetchNewVariants(graphql: GraphQL, locationId: string): Promise<VariantInfo[]> {
  const data = await gql<{ products: { nodes: { variants: { nodes: RawVariant[] } }[] } }>(
    graphql,
    `#graphql
    query KoiNewItems($q: String!, $loc: ID!) {
      products(first: 15, query: $q, sortKey: CREATED_AT, reverse: true) {
        nodes { variants(first: 40) { nodes { ${VARIANT_FIELDS} } } }
      }
    }`,
    { q: `created_at:>=${daysAgoISODate(NEW_ITEM_WINDOW_DAYS)} AND status:active`, loc: locationId },
  );
  return data.products.nodes.flatMap((p) => p.variants.nodes.map(toInfo));
}

export type ReorderRow = {
  variantId: string;
  kind: "top" | "new";
  rank: number | null;
  name: string;
  /** Shopify vendor on the product. */
  vendor: string;
  /** Who we order it from (the vendor unless a link says otherwise). */
  distributor: string;
  /** Ordering site, or null when nobody has linked one yet. */
  siteUrl: string | null;
  /** This flavour's product page on the distributor site, once linked. */
  productUrl: string | null;
  sold30: number;
  stock: number;
  daysLeft: number | null;
  status: Status;
  needPcs: number;
  cartonSize: number;
  suggestedCartons: number;
  stamp: Stamp;
};

export async function loadReorderTable(store: StoreKey) {
  const graphql = await adminClient();
  const location = await findLocation(graphql, store);
  const [sales, fresh] = await Promise.all([fetchSales(graphql, location.id), fetchNewVariants(graphql, location.id)]);
  const sold = soldByVariant(sales);

  // Look up a few more than 30 so skipped or deleted items don't shorten the list.
  const candidates = [...sold.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SELLER_COUNT + 15)
    .map(([id]) => id);
  const info = await fetchVariants(graphql, candidates, location.id);
  const top = topVariants(sold, (id) => info.get(id)?.productTitle);

  const topSet = new Set(top);
  const newOnes = fresh.filter((v) => v.stock !== null && !topSet.has(v.id) && !isExcluded(v.productTitle));
  const ids = [...top, ...newOnes.map((v) => v.id)];
  const settings = await prisma.variantSetting.findMany({ where: { variantId: { in: ids } } });
  const settingOf = new Map(settings.map((s) => [s.variantId, s]));
  const links = await prisma.distributorLink.findMany();
  const products = await prisma.distroProduct.findMany({ where: { variantId: { in: ids } } });
  const productOf = new Map(products.map((p) => [p.variantId, p.url]));
  const linkOf = new Map(links.map((l) => [l.vendor, l]));

  const row = (v: VariantInfo, kind: "top" | "new", rank: number | null): ReorderRow => {
    const s = settingOf.get(v.id);
    const cartonSize = s?.cartonSize ?? 5;
    const sold30 = sold.get(v.id) ?? 0;
    const stock = v.stock ?? 0;
    const r = reorderFor(stock, sold30, kind === "new");
    return {
      variantId: v.id,
      kind,
      rank,
      name: v.name,
      vendor: v.vendor,
      distributor: linkOf.get(v.vendor)?.distributor ?? v.vendor,
      siteUrl: linkOf.get(v.vendor)?.url ?? DISTRIBUTOR_SITES[v.vendor] ?? null,
      productUrl: productOf.get(v.id) ?? null,
      sold30,
      stock,
      daysLeft: r.daysLeft,
      status: r.status,
      needPcs: r.needPcs,
      cartonSize,
      suggestedCartons: cartonsFor(r.needPcs, cartonSize),
      stamp: (s?.stamp as Stamp | null) ?? defaultStamp(v.productTitle),
    };
  };

  const rows = [
    ...top.map((id, i) => row(info.get(id)!, "top", i + 1)),
    ...newOnes.map((v) => row(v, "new", null)),
  ];
  const units = await loadQtyUnits(rows);
  return { location, rows, units, refreshedAt: new Date().toISOString() };
}

export async function saveVariantSetting(
  variantId: string,
  change: { cartonSize?: number; stamp?: Stamp },
  updatedBy: string,
) {
  const cartonSize =
    change.cartonSize !== undefined && [4, 5, 6].includes(change.cartonSize) ? change.cartonSize : undefined;
  await prisma.variantSetting.upsert({
    where: { variantId },
    create: { variantId, cartonSize: cartonSize ?? 5, stamp: change.stamp ?? null, updatedBy },
    update: { ...(cartonSize ? { cartonSize } : {}), ...(change.stamp ? { stamp: change.stamp } : {}), updatedBy },
  });
}

export function cleanSiteUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function saveDistributorLink(vendor: string, distributor: string, url: string, updatedBy: string) {
  await prisma.distributorLink.upsert({
    where: { vendor },
    create: { vendor, distributor, url, updatedBy },
    update: { distributor, url, updatedBy },
  });
}

/** Cartons or pieces per distributor: saved choice, else the site default (globe11 = pieces). */
export async function loadQtyUnits(rows: { distributor: string; siteUrl: string | null }[]) {
  const saved = await prisma.distributorSetting.findMany();
  const savedOf = new Map(saved.map((s) => [s.distributor, s.qtyUnit as QtyUnit]));
  const out: Record<string, QtyUnit> = {};
  for (const r of rows) out[r.distributor] ??= savedOf.get(r.distributor) ?? defaultQtyUnit(r.siteUrl ?? "");
  return out;
}

export async function saveQtyUnit(distributor: string, qtyUnit: QtyUnit, updatedBy: string) {
  await prisma.distributorSetting.upsert({
    where: { distributor },
    create: { distributor, qtyUnit, updatedBy },
    update: { qtyUnit, updatedBy },
  });
}

export async function saveProductUrl(variantId: string, url: string, updatedBy: string) {
  await prisma.distroProduct.upsert({
    where: { variantId },
    create: { variantId, url, updatedBy },
    update: { url, updatedBy },
  });
}
