// Reads live sales and stock from Shopify for the KOI//OS stock deck.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  NEW_ITEM_WINDOW_DAYS,
  SALES_WINDOW_DAYS,
  STORES,
  buildWatchList,
  daysAgoISODate,
  defaultStamp,
  isLow,
  suggestCartons,
  summarizeSales,
  type SaleLine,
  type Stamp,
  type StoreKey,
} from "./ordering";

type Admin = AdminApiContext;

async function gql<T>(admin: Admin, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) throw new Error(`Shopify query failed: ${JSON.stringify(json.errors)}`);
  return json.data;
}

export async function findStoreLocation(admin: Admin, store: StoreKey) {
  const wanted = STORES.find((s) => s.key === store)!;
  const data = await gql<{ locations: { nodes: { id: string; name: string }[] } }>(
    admin,
    `#graphql
    query KoiLocations { locations(first: 50) { nodes { id name } } }`,
  );
  const loc = data.locations.nodes.find((l) => l.name === wanted.locationName);
  if (!loc) throw new Error(`No Shopify location named "${wanted.locationName}"`);
  return loc;
}

/** Every line item sold at one location in the sales window. */
async function fetchSales(admin: Admin, locationId: string): Promise<SaleLine[]> {
  const numericId = locationId.split("/").pop();
  const search = `created_at:>=${daysAgoISODate(SALES_WINDOW_DAYS)} AND location_id:${numericId}`;
  const lines: SaleLine[] = [];
  let after: string | null = null;
  // 40 orders x 20 lines keeps each page under Shopify's query cost limit.
  for (let page = 0; page < 100; page++) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          retailLocation: { id: string } | null;
          lineItems: {
            nodes: { quantity: number; product: { id: string } | null; variant: { id: string } | null }[];
          };
        }[];
      };
    } = await gql(
      admin,
      `#graphql
      query KoiSales($q: String!, $after: String) {
        orders(first: 40, after: $after, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            retailLocation { id }
            lineItems(first: 20) { nodes { quantity product { id } variant { id } } }
          }
        }
      }`,
      { q: search, after },
    );
    for (const order of data.orders.nodes) {
      if (order.retailLocation && order.retailLocation.id !== locationId) continue;
      for (const li of order.lineItems.nodes) {
        lines.push({ productId: li.product?.id ?? null, variantId: li.variant?.id ?? null, quantity: li.quantity });
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return lines;
}

async function fetchNewProductIds(admin: Admin): Promise<string[]> {
  const data = await gql<{ products: { nodes: { id: string }[] } }>(
    admin,
    `#graphql
    query KoiNewProducts($q: String!) {
      products(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id } }
    }`,
    { q: `created_at:>=${daysAgoISODate(NEW_ITEM_WINDOW_DAYS)} AND status:active` },
  );
  return data.products.nodes.map((p) => p.id);
}

type ProductStock = {
  id: string;
  title: string;
  vendor: string;
  variants: { id: string; title: string; sku: string | null; available: number }[];
};

async function fetchProductStock(admin: Admin, ids: string[], locationId: string): Promise<ProductStock[]> {
  const out: ProductStock[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const data = await gql<{
      nodes: ({
        id: string;
        title: string;
        vendor: string;
        variants: {
          nodes: {
            id: string;
            title: string;
            sku: string | null;
            inventoryItem: { inventoryLevel: { quantities: { name: string; quantity: number }[] } | null };
          }[];
        };
      } | null)[];
    }>(
      admin,
      `#graphql
      query KoiStock($ids: [ID!]!, $loc: ID!) {
        nodes(ids: $ids) {
          ... on Product {
            id title vendor
            variants(first: 100) {
              nodes {
                id title sku
                inventoryItem { inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } }
              }
            }
          }
        }
      }`,
      { ids: ids.slice(i, i + 8), loc: locationId },
    );
    for (const p of data.nodes) {
      if (!p || !p.id) continue;
      out.push({
        id: p.id,
        title: p.title,
        vendor: p.vendor,
        variants: p.variants.nodes
          // Variants not stocked at this store have no inventory level; skip them.
          .filter((v) => v.inventoryItem.inventoryLevel)
          .map((v) => ({
            id: v.id,
            title: v.title,
            sku: v.sku,
            available: v.inventoryItem.inventoryLevel!.quantities[0]?.quantity ?? 0,
          })),
      });
    }
  }
  return out;
}

export type DeckLine = {
  variantId: string;
  flavour: string;
  sku: string | null;
  available: number;
  sold30: number;
  cartons: number;
};

export type DeckProduct = {
  productId: string;
  title: string;
  distributor: string;
  reason: "top" | "new";
  rank: number | null;
  sold30: number;
  cartonSize: number;
  stamp: Stamp;
  outLines: DeckLine[];
  variantCount: number;
};

export async function loadStockDeck(admin: Admin, store: StoreKey) {
  const location = await findStoreLocation(admin, store);
  const [sales, newIds] = await Promise.all([fetchSales(admin, location.id), fetchNewProductIds(admin)]);
  const { byProduct, byVariant } = summarizeSales(sales);

  // Titles are needed to apply the skip list before ranking, so rank a few extra.
  const candidateIds = [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);
  const allIds = [...new Set([...candidateIds, ...newIds])];
  const stock = await fetchProductStock(admin, allIds, location.id);
  const byId = new Map(stock.map((p) => [p.id, p]));
  const titles = new Map(stock.map((p) => [p.id, p.title]));

  const watch = buildWatchList(byProduct, titles, newIds.filter((id) => byId.has(id)));
  const settings = await prisma.productSetting.findMany({
    where: { productId: { in: watch.map((w) => w.productId) } },
  });
  const settingById = new Map(settings.map((s) => [s.productId, s]));

  let rank = 0;
  const products: DeckProduct[] = watch.flatMap((w) => {
    const p = byId.get(w.productId);
    if (!p) return [];
    const setting = settingById.get(p.id);
    const cartonSize = setting?.cartonSize ?? 5;
    const outLines = p.variants
      .filter((v) => isLow(v.available))
      .map((v) => {
        const sold30 = byVariant.get(v.id) ?? 0;
        return {
          variantId: v.id,
          flavour: v.title,
          sku: v.sku,
          available: v.available,
          sold30,
          cartons: suggestCartons(sold30, cartonSize),
        };
      })
      .sort((a, b) => b.sold30 - a.sold30);
    return [
      {
        productId: p.id,
        title: p.title,
        distributor: p.vendor,
        reason: w.reason,
        rank: w.reason === "top" ? ++rank : null,
        sold30: byProduct.get(p.id) ?? 0,
        cartonSize,
        stamp: (setting?.stamp as Stamp | undefined) ?? defaultStamp(p.title),
        outLines,
        variantCount: p.variants.length,
      },
    ];
  });

  return { location, products, refreshedAt: new Date().toISOString() };
}

export async function saveProductSetting(
  productId: string,
  cartonSize: number,
  stamp: Stamp,
  updatedBy: string | null,
) {
  const size = Number.isFinite(cartonSize) && cartonSize >= 1 && cartonSize <= 50 ? Math.round(cartonSize) : 5;
  await prisma.productSetting.upsert({
    where: { productId },
    create: { productId, cartonSize: size, stamp, updatedBy },
    update: { cartonSize: size, stamp, updatedBy },
  });
}
