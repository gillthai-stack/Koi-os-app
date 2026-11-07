// Turns one order sheet group into a prompt for Claude in Chrome on the distributor's site.
import type { QtyUnit } from "./distributors";
import type { Stamp } from "./ordering";

export type PromptLine = { name: string; stamp: Stamp; qty: number; productUrl?: string | null };

const stampName = (s: Stamp) => (s === "ONTARIO" ? "Ontario" : "Federal");

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
      (l, i) =>
        `${i + 1}. ${l.name} | ${stampName(l.stamp)} stamp | qty ${l.qty}${l.productUrl ? ` | page: ${l.productUrl}` : ""}`,
    ),
    "",
    "Don't substitute anything and don't check out. When you're done, open the cart and tell me what's in it, and list any item you couldn't find, that was out of stock, or that had a different quantity limit.",
  ];
  return out.filter((l) => l !== null).join("\n");
}
