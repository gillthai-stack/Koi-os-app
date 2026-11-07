// Distributor ordering sites, keyed by the distributor name used on the order sheet.
// Pure data and helpers only, so `npm test` can cover them.

export const DISTRIBUTOR_SITES: Record<string, string> = {
  "Pacific Smoke": "https://www.pacificsmoke.com/en/",
  "Valor Distributions": "https://www.valordistributions.com/",
  NimbusDistro: "https://nimbusdistro.ca/",
  globe11: "https://globe11.com/shop/?custom_filter=cat_all_filter&sub_filter=all",
  "GCore Canada": "https://gcorecanada.com/",
};

// Distributor names as people write them (e.g. on the request sheet) → our names above.
const DISTRIBUTOR_ALIASES: [RegExp, string][] = [
  [/^gcore/i, "GCore Canada"],
  [/^valor/i, "Valor Distributions"],
  [/^pacific/i, "Pacific Smoke"],
  [/^nimbus/i, "NimbusDistro"],
  [/^globe\s*11/i, "globe11"],
];

/** Our name for a distributor, so requests and reorders share sites, units and GCore's split. */
export function canonicalDistributor(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "No distributor";
  return DISTRIBUTOR_ALIASES.find(([re]) => re.test(n))?.[1] ?? n;
}

/** How a site's cart is filled by the KOI//OS Cart extension. */
export type Platform = "magento" | "shopify" | "woocommerce" | "generic";

const PLATFORM_BY_HOST: Record<string, Platform> = {
  "pacificsmoke.com": "magento",
  "valordistributions.com": "shopify",
  "nimbusdistro.ca": "shopify",
  "globe11.com": "woocommerce",
};

export type QtyUnit = "CARTON" | "PIECE";

/** globe11 counts single pieces in its cart; everyone else counts cartons. */
const PIECE_SITES = new Set(["globe11.com"]);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Sites the KOI//OS Cart extension is allowed to fill (matches extension/manifest.json). */
export function canFillCart(url: string): boolean {
  return hostOf(url) in PLATFORM_BY_HOST || hostOf(url) === "gcorecanada.com";
}

export function platformFor(url: string): Platform {
  return PLATFORM_BY_HOST[hostOf(url)] ?? "generic";
}

export function defaultQtyUnit(siteUrl: string): QtyUnit {
  return PIECE_SITES.has(hostOf(siteUrl)) ? "PIECE" : "CARTON";
}

/** The number to type into the distributor's quantity box. */
export function cartQty(cartons: number, cartonSize: number, unit: QtyUnit): number {
  return unit === "PIECE" ? cartons * cartonSize : cartons;
}

/** Where to land after the cart is filled. */
export function cartPageFor(siteUrl: string): string {
  const host = hostOf(siteUrl);
  if (!host) return siteUrl;
  const origin = new URL(siteUrl).origin;
  switch (platformFor(siteUrl)) {
    case "magento":
      return host === "pacificsmoke.com" ? `${origin}/en/checkout/cart/` : `${origin}/checkout/cart/`;
    case "woocommerce":
      return `${origin}/cart/`;
    default:
      return `${origin}/cart`;
  }
}
