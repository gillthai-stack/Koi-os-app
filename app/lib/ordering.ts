// Pure ordering rules for KOI//OS, matching the Command Center's reorder table.
// No Shopify or database imports here, so `npm test` can cover them.

export const STORES = [
  { key: "mississauga", label: "Mississauga", locationName: "Mississauga Koi" },
  { key: "brampton", label: "Brampton", locationName: "Brampton Koi" },
] as const;
export type StoreKey = (typeof STORES)[number]["key"];

export const TOP_SELLER_COUNT = 30;
export const SALES_WINDOW_DAYS = 30;
export const NEW_ITEM_WINDOW_DAYS = 21;
export const DEFAULT_CARTON_SIZE = 5;
export const CARTON_SIZES = [4, 5, 6] as const;
/** Weeks of sales an order should cover. */
export const COVER_WEEKS = 2;
/** Pieces to stock of a brand-new item that has no sales history yet. */
export const NEW_ITEM_QTY = 5;
/** Under this many days of stock left, a line is LOW. */
export const LOW_DAYS = 7;

export type Stamp = "ONTARIO" | "FEDERAL";
export type Status = "OUT" | "LOW" | "OK";

const EXCLUDED_TITLES = [/hydra\s*18\s*k/i, /koikoin\s+recyclables?/i];

export function isExcluded(title: string): boolean {
  return EXCLUDED_TITLES.some((re) => re.test(title));
}

/** Products titled "[ONT] ..." carry the Ontario stamp; everything else defaults to Federal. */
export function defaultStamp(title: string): Stamp {
  return /^\s*\[ONT\]/i.test(title) ? "ONTARIO" : "FEDERAL";
}

export function nextCartonSize(size: number): number {
  const i = CARTON_SIZES.indexOf(size as 4 | 5 | 6);
  return CARTON_SIZES[(i + 1) % CARTON_SIZES.length];
}

export type SaleLine = { variantId: string | null; quantity: number };

export function soldByVariant(lines: SaleLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.variantId) out.set(l.variantId, (out.get(l.variantId) ?? 0) + l.quantity);
  }
  return out;
}

export type Reorder = {
  status: Status;
  /** Whole days of stock left; null when out of stock, 99 when it isn't selling. */
  daysLeft: number | null;
  /** Pieces needed to cover COVER_WEEKS of sales (0 when the line is OK). */
  needPcs: number;
};

/** Same rule as the Command Center: OUT at 0 pcs, LOW under a week left, top up to 2 weeks of sales. */
export function reorderFor(stock: number, sold30: number, isNew = false): Reorder {
  const perDay = sold30 / SALES_WINDOW_DAYS;
  const daysLeft = stock <= 0 ? null : perDay > 0 ? Math.floor(stock / perDay) : 99;
  const status: Status = stock <= 0 ? "OUT" : (daysLeft ?? 0) < LOW_DAYS ? "LOW" : "OK";
  const target = isNew && sold30 === 0 ? NEW_ITEM_QTY : Math.ceil(perDay * 7 * COVER_WEEKS);
  const needPcs = status === "OK" ? 0 : Math.max(0, target - Math.max(stock, 0));
  return { status, daysLeft, needPcs };
}

export function cartonsFor(pcs: number, cartonSize = DEFAULT_CARTON_SIZE): number {
  const size = cartonSize > 0 ? cartonSize : DEFAULT_CARTON_SIZE;
  return pcs > 0 ? Math.ceil(pcs / size) : 0;
}

/** Top sellers by pieces sold, skipping excluded items. */
export function topVariants(
  sold: Map<string, number>,
  titleOf: (variantId: string) => string | undefined,
  count = TOP_SELLER_COUNT,
): string[] {
  return [...sold.entries()]
    .filter(([id]) => {
      const t = titleOf(id);
      return t !== undefined && !isExcluded(t);
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([id]) => id);
}

export function daysAgoISODate(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export type OrderLine = {
  variantId: string;
  name: string;
  distributor: string;
  stamp: Stamp;
  cartons: number;
};

export type OrderGroup = {
  key: string;
  distributor: string;
  /** Set when this distributor needs one checkout per stamp. */
  stamp: Stamp | null;
  cartons: number;
  lines: OrderLine[];
};

/** Distributors whose site needs Ontario and Federal lines checked out separately. */
export const SPLIT_BY_STAMP = new Set(["GCore Canada"]);

export function buildOrderSheet(lines: OrderLine[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const l of lines) {
    if (l.cartons <= 0) continue;
    const split = SPLIT_BY_STAMP.has(l.distributor);
    const key = split ? `${l.distributor}|${l.stamp}` : l.distributor;
    let g = groups.get(key);
    if (!g) {
      g = { key, distributor: l.distributor, stamp: split ? l.stamp : null, cartons: 0, lines: [] };
      groups.set(key, g);
    }
    g.lines.push(l);
    g.cartons += l.cartons;
  }
  return [...groups.values()].sort(
    (a, b) => a.distributor.localeCompare(b.distributor) || (a.stamp ?? "").localeCompare(b.stamp ?? ""),
  );
}
