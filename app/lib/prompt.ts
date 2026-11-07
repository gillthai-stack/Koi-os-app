// Turns one order sheet group into a prompt for Claude in Chrome on the distributor's site.
import type { QtyUnit } from "./distributors";
import type { Stamp } from "./ordering";

export type PromptLine = { name: string; stamp: Stamp; qty: number; productUrl?: string | null };

const stampName = (s: Stamp) => (s === "ONTARIO" ? "Ontario" : "Federal");

/** Drops our own "[ONT]"/"[FED]" title tag; the stamp column is what the distributor needs. */
export function cleanName(name: string): string {
  return name.replace(/^\s*\[(ONT|ONTARIO|FED|FEDERAL)\]\s*/i, "").trim();
}

/** A product page only helps if it points past the site's home page. */
export function usefulPage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "").replace(/^\/(en|fr)$/i, "");
    return path || u.search ? url : null;
  } catch {
    return null;
  }
}

export function orderPrompt(opts: {
  distributor: string;
  siteUrl: string | null;
  store: string;
  unit: QtyUnit;
  /** Set when this distributor needs one checkout per stamp (GCore). */
  onlyStamp: Stamp | null;
  lines: PromptLine[];
}): string {
  const { distributor, siteUrl, store, unit, onlyStamp, lines } = opts;
  const unitWord = unit === "PIECE" ? "single pieces" : "cartons (boxes)";
  const out = [
    `Add these items to my cart on ${distributor}${siteUrl ? ` (${siteUrl})` : ""}. I'm already logged in. This is the ${store} Koi order.`,
    "",
    "For each line:",
    "- Search the site for the product and open the exact flavour.",
    "- Pick the version with the stamp shown on the line (Ontario or Federal). Don't swap stamps.",
    `- Set the quantity in ${unitWord} and add it to the cart.`,
    "",
    onlyStamp
      ? `This cart is only for ${stampName(onlyStamp)} stamp items. The other stamp is a separate checkout, so don't mix them.`
      : null,
    "Items:",
    ...lines.map(
      (l, i) => {
        const page = usefulPage(l.productUrl);
        return `${i + 1}. ${cleanName(l.name)} | ${stampName(l.stamp)} stamp | qty ${l.qty}${page ? ` | page: ${page}` : ""}`;
      },
    ),
    "",
    "Don't substitute anything and don't check out. When you're done, open the cart and tell me what's in it, and list any item you couldn't find, that was out of stock, or that had a different quantity limit.",
  ];
  return out.filter((l) => l !== null).join("\n");
}
