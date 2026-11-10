// Customer requests after ordering: match invoice lines to open requests, and draft the pickup text.
// Pure helpers only, so `npm test` can cover them.
import { canonicalDistributor } from "./distributors.ts";

export type InvoiceLine = { name: string; qty?: number | null };
export type Stage = "shipped" | "delivered";

/** Which requests a stage can move, and where to. */
export const STAGE_FROM: Record<Stage, readonly string[]> = {
  shipped: ["Ordered", "Order on request", "Waiting on stock"],
  delivered: ["Ordered", "On the way", "Order on request", "Waiting on stock"],
};
export const STAGE_TO: Record<Stage, string> = { shipped: "On the way", delivered: "Ready – set aside" };

// Words that say nothing about which product it is.
const NOISE = new Set([
  "ont", "ontario", "fed", "federal", "stamp", "stamped", "duty", "paid", "any", "the", "and", "with", "of",
  "disposable", "disposables", "vape", "pod", "pods", "device", "devices", "puffs", "puff",
  "pk", "pack", "pcs", "pc", "box", "carton", "ctn", "mg", "ml", "x",
]);

/** Lowercase words, with "20mg" → "20", "75K" and "75,000" → "75000", and "5pk" dropped. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^(\d+)(mg|ml)$/, "$1").replace(/^(\d+)k$/, (_, n) => String(Number(n) * 1000)))
    .filter((t) => t && !NOISE.has(t) && !/^\d+(pk|pcs|pc|ct)$/.test(t));
}

/** "Ripper X 75K [Classico Ice 20]" → model words and flavour words. */
export function splitProduct(product: string): { model: string[]; flavour: string[] } {
  const inside = [...product.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]).join(" ");
  const outside = product.replace(/\[[^\]]*\]/g, " ");
  return { model: tokens(outside), flavour: tokens(inside) };
}

/**
 * How well an invoice line fits a requested product, 0 to 1. Every flavour word must be on the line
 * (small numbers such as a 20 mg strength are optional), and most of the model words.
 */
export function matchScore(product: string, line: string): number {
  const { model, flavour } = splitProduct(product);
  const have = new Set(tokens(line));
  const needFlavour = flavour.filter((t) => !/^\d{1,2}$/.test(t));
  if (needFlavour.some((t) => !have.has(t))) return 0;
  if (!model.length) return needFlavour.length ? 0.8 : 0;
  const hit = model.filter((t) => have.has(t)).length / model.length;
  return hit >= 0.66 ? hit : 0;
}

export type MatchableRequest = {
  id: number;
  code: string;
  store: string;
  customer: string;
  product: string;
  distributor: string | null;
  status: string;
  qtyWanted: number | null;
};

export type RequestMatch<R> = { request: R; line: InvoiceLine; score: number };

/**
 * Open requests that an invoice's lines fill. Each request takes its best line; a line can fill
 * several requests up to its quantity (in pieces) when it has one, oldest request first.
 */
export function matchInvoice<R extends MatchableRequest>(
  lines: InvoiceLine[],
  requests: R[],
  opts: { stage: Stage; distributor?: string | null; store?: string | null },
): RequestMatch<R>[] {
  const distro = opts.distributor ? canonicalDistributor(opts.distributor) : null;
  const open = requests
    .filter((r) => STAGE_FROM[opts.stage].includes(r.status))
    .filter((r) => !opts.store || r.store === opts.store)
    // A request without a distributor can still match; one for another distributor can't.
    .filter((r) => !distro || !r.distributor || canonicalDistributor(r.distributor) === distro)
    .sort((a, b) => a.id - b.id);
  const left = lines.map((l) => (l.qty && l.qty > 0 ? l.qty : Infinity));
  const out: RequestMatch<R>[] = [];
  for (const r of open) {
    let best = -1;
    let bestScore = 0;
    lines.forEach((l, i) => {
      const s = matchScore(r.product, l.name);
      if (s > bestScore && left[i] > 0) {
        best = i;
        bestScore = s;
      }
    });
    if (best < 0) continue;
    left[best] -= Math.max(1, r.qtyWanted ?? 1);
    out.push({ request: r, line: lines[best], score: bestScore });
  }
  return out;
}

/** Invoice lines pasted from an email or the distributor's site, one per line, with an optional quantity. */
export function parseInvoiceLines(text: string): InvoiceLine[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\t/g, "  ").trim())
    .filter((l) => /[a-z]/i.test(l))
    .map((l) => {
      // "3 x Ripper…", "Ripper… x 3", "Ripper…  Qty: 3", or a quantity column after two spaces.
      const m =
        /^(\d{1,3})\s*[x×]\s+(.+)$/i.exec(l) ??
        /^(.+?)\s+[x×]\s*(\d{1,3})$/i.exec(l) ??
        /^(.+?)\s+(?:qty|quantity)[:\s]*(\d{1,3})\b.*$/i.exec(l) ??
        /^(.+?)\s{2,}(\d{1,3})(?:\s{2,}.*)?$/.exec(l);
      if (!m) return { name: l };
      const [a, b] = [m[1], m[2]];
      return /^\d+$/.test(a) ? { name: b.trim(), qty: Number(a) } : { name: a.trim(), qty: Number(b) };
    });
}

const STORE_NAME: Record<string, string> = { mississauga: "Koi Mississauga", brampton: "Koi Brampton" };

/** "Ripper X 75K [Classico Ice 20] [ONT]" → "Ripper X 75K Classico Ice 20", for the customer. */
export function friendlyProduct(product: string): string {
  return product
    .replace(/\[\s*(ont|ontario|fed|federal)\s*\]/gi, " ")
    .replace(/\b(ont|fed)\b\.?/gi, " ")
    .replace(/[[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The short text telling a customer their request is in and set aside. */
export function pickupText(r: { customer: string; product: string; store: string; qtyWanted?: number | null }): string {
  const first = r.customer.trim().split(/\s+/)[0];
  const hi = first && first !== "(no" ? `Hi ${first}, ` : "Hi, ";
  const qty = r.qtyWanted && r.qtyWanted > 1 ? ` (x${r.qtyWanted})` : "";
  const shop = STORE_NAME[r.store] ?? "Koi";
  return `${hi}it's ${shop}. Your ${friendlyProduct(r.product)}${qty} is in and set aside for you. Come grab it any time!`;
}

/** Digits for an sms: link, with +1 added to 10-digit Canadian numbers; null when it isn't a phone number. */
export function smsNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** Opens Messages with the text filled in. "?&body=" works on both iPhone and Android. */
export function smsHref(phone: string | null | undefined, body: string): string | null {
  const n = smsNumber(phone);
  return n ? `sms:${n}?&body=${encodeURIComponent(body)}` : null;
}
