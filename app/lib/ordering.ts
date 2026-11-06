// Pure ordering rules for KOI//OS. No Shopify or database imports here,
// so these can be unit tested with `npm test`.

export const STORES = [
  { key: "mississauga", label: "Mississauga", locationName: "Mississauga Koi" },
  { key: "brampton", label: "Brampton", locationName: "Brampton Koi" },
] as const;
export type StoreKey = (typeof STORES)[number]["key"];

export const TOP_SELLER_COUNT = 30;
export const SALES_WINDOW_DAYS = 30;
export const NEW_ITEM_WINDOW_DAYS = 21;
export const DEFAULT_CARTON_SIZE = 5;
/** Days of sales one order should cover when suggesting cartons. */
export const COVER_DAYS = 14;
/** A line counts as low when available pieces are at or below this. */
export const LOW_LEVEL = 0;

export type Stamp = "ONTARIO" | "FEDERAL";

const EXCLUDED_TITLES = [/hydra\s*18\s*k/i, /koikoin\s+recyclables?/i];

export function isExcluded(title: string): boolean {
  return EXCLUDED_TITLES.some((re) => re.test(title));
}

/** Products titled "[ONT] ..." carry the Ontario stamp; everything else defaults to Federal. */
export function defaultStamp(title: string): Stamp {
  return /^\s*\[ONT\]/i.test(title) ? "ONTARIO" : "FEDERAL";
}

export type SaleLine = {
  productId: string | null;
  variantId: string | null;
  quantity: number;
};

export type SalesSummary = {
  byProduct: Map<string, number>;
  byVariant: Map<string, number>;
};

export function summarizeSales(lines: SaleLine[]): SalesSummary {
  const byProduct = new Map<string, number>();
  const byVariant = new Map<string, number>();
  for (const line of lines) {
    if (line.productId) {
      byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity);
    }
    if (line.variantId) {
      byVariant.set(line.variantId, (byVariant.get(line.variantId) ?? 0) + line.quantity);
    }
  }
  return { byProduct, byVariant };
}

/**
 * Products to watch: the top sellers by pieces sold (excluding skipped
 * products), plus every product added in the last 3 weeks.
 */
export function buildWatchList(
  byProduct: Map<string, number>,
  titles: Map<string, string>,
  newProductIds: string[],
  count = TOP_SELLER_COUNT,
): { productId: string; reason: "top" | "new" }[] {
  const top = [...byProduct.entries()]
    .filter(([id]) => !isExcluded(titles.get(id) ?? ""))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([productId]) => ({ productId, reason: "top" as const }));
  const seen = new Set(top.map((t) => t.productId));
  const fresh = newProductIds
    .filter((id) => !seen.has(id) && !isExcluded(titles.get(id) ?? ""))
    .map((productId) => ({ productId, reason: "new" as const }));
  return [...top, ...fresh];
}

/**
 * Cartons to order for one line: enough to cover COVER_DAYS of sales,
 * at least one carton. An estimate; carton sizes vary by product (4–6).
 */
export function suggestCartons(
  soldInWindow: number,
  cartonSize = DEFAULT_CARTON_SIZE,
  windowDays = SALES_WINDOW_DAYS,
): number {
  const size = cartonSize > 0 ? cartonSize : DEFAULT_CARTON_SIZE;
  const needed = (soldInWindow / windowDays) * COVER_DAYS;
  return Math.max(1, Math.ceil(needed / size));
}

export function isLow(available: number): boolean {
  return available <= LOW_LEVEL;
}

export function daysAgoISODate(days: number, now = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
