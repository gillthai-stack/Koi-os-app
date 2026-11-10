// Reads distributor, Interac and carrier emails and works out what they mean for our orders.
// Pure functions only (no database, no Gmail), so `npm test` can cover them.

export const ORDER_STAGES = [
  { stage: 1, label: "Awaiting payment", short: "Awaiting payment" },
  { stage: 2, label: "Paid – waiting to ship", short: "Paid" },
  { stage: 3, label: "On the way", short: "On the way" },
  { stage: 4, label: "Delivered", short: "Delivered" },
] as const;
export type Stage = 1 | 2 | 3 | 4;

export const stageLabel = (s: number) => ORDER_STAGES.find((x) => x.stage === s)?.label ?? "Unknown";

export type MailStore = "mississauga" | "brampton";
export type OrderLine = { name: string; qty?: number };

export type Mail = {
  id: string;
  from: string; // "Name <addr>" or just the address
  subject: string;
  body: string; // plain text
  date: Date;
};

export type MailEvent =
  | { kind: "order"; distributor: string; refs: string[]; amount: number | null; lines: OrderLine[]; store: MailStore | null; paid?: boolean; note?: string }
  | { kind: "invoice"; distributor: string; refs: string[]; amount: number | null; store: MailStore | null }
  | { kind: "payment"; payee: string; distributor: string | null; amount: number; refs: string[]; message: string }
  | { kind: "shipped"; distributor: string | null; refs: string[]; tracking: string[]; store: MailStore | null; lines: OrderLine[] }
  | { kind: "delivered"; distributor: string | null; refs: string[]; tracking: string[]; store: MailStore | null }
  | { kind: "cancelled"; distributor: string; refs: string[] };

/** The Gmail search that finds every email this tracker reads. */
export const MAIL_QUERY =
  "from:(payments.interac.ca OR ups.com OR fedex.com OR canadapost.ca OR pacificsmoke.com OR valordistributions.com OR nimbusdistro.ca OR gcorecanada.com OR globe11.com) -category:promotions";

const DISTRO_BY_DOMAIN: [RegExp, string][] = [
  [/pacificsmoke\.com/i, "Pacific Smoke"],
  [/valordistributions\.com/i, "Valor Distributions"],
  [/nimbusdistro\.ca/i, "NimbusDistro"],
  [/gcorecanada\.com/i, "GCore Canada"],
  [/globe11\.com/i, "globe11"],
];

/** Interac payee names and UPS "From:" shippers → our distributor names. */
const DISTRO_BY_NAME: [RegExp, string][] = [
  [/pacific\s*smoke/i, "Pacific Smoke"],
  [/valor/i, "Valor Distributions"],
  [/nimbus/i, "NimbusDistro"],
  [/g\s*core/i, "GCore Canada"],
  [/globe\s*11/i, "globe11"],
];

export function distributorFromName(name: string): string | null {
  return DISTRO_BY_NAME.find(([re]) => re.test(name))?.[1] ?? null;
}

const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

/** "$1,078.84" → 1078.84 */
export function money(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]|CAD/gi, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Ref keys that let "#1106698", "#1106698A" and "1106698a" find the same order. */
export function refKey(ref: string): string {
  return ref
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .replace(/^(\d{5,})A$/, "$1");
}

/** Our two stores, from a shipping address or the name a distributor greets us with. */
export function storeFromText(text: string): MailStore | null {
  const brampton = /brampton|sunnyvale/i.test(text);
  const mississauga = /mississauga|creditview/i.test(text);
  if (brampton && !mississauga) return "brampton";
  if (mississauga && !brampton) return "mississauga";
  return null;
}

/** UPS 1Z…, FedEx 12-digit, Canada Post 16-digit tracking numbers, without repeats. */
export function trackingNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b1Z[0-9A-Z]{16}\b/g)) found.add(m[0]);
  for (const m of text.matchAll(/(?:trknbr=|FedEx\s*\n+\s*)(\d{12,15})\b/gi)) found.add(m[1]);
  for (const m of text.matchAll(/(?:pin=|Canada Post\s*\n+\s*)(\d{16})\b/gi)) found.add(m[1]);
  return [...found];
}

/** Sales orders, invoices and order numbers written anywhere in a text, e.g. an e-Transfer message. */
export function refsIn(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\b(SO|INV)-\d{4,}\b/gi)) refs.add(m[0].toUpperCase());
  for (const m of text.matchAll(/(?:order|invoice|#)\s*(?:no\.?|number|#)?\s*#?(\d{5,}[A-Z]?)\b/gi)) refs.add(`#${m[1].toUpperCase()}`);
  return [...refs];
}

/** Value after a "Total" label in an order email (handles "Total\n$1,113.50 CAD" and "| Total: | $566.95 |"). */
function totalIn(body: string): number | null {
  const m =
    body.match(/(?:^|\n|\|)\s*(?:Grand\s+)?Total(?:\s+due)?\s*:?\s*\|?\s*\n?\s*\$?\s*([\d,]+\.\d{2})/i) ??
    body.match(/Amount\s+Due\s*:?\s*\n?\s*\$?\s*([\d,]+\.\d{2})/i);
  return m ? money(m[1]) : null;
}

/** Nimbus (Shopify) order summary: a product name, then "Qty: n". */
function shopifyLines(body: string): OrderLine[] {
  const lines: OrderLine[] = [];
  const re = /\n\n([^\n$][^\n]*(?:\n[^\n$][^\n]*)?)\n\nQty:\s*(\d+)/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].replace(/\s*\n\s*/g, " ").trim();
    if (name && !/^(order summary|subtotal)/i.test(name)) lines.push({ name, qty: Number(m[2]) });
  }
  return lines;
}

/** GCore (WooCommerce) order table rows: "| Product | 3 | $75.60 |". */
function tableLines(body: string): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const m of body.matchAll(/^\|\s*([^|\n]+?)\s*\|\s*(\d+)\s*\|\s*\$[\d,.]+\s*\|\s*$/gm)) {
    if (!/^product$/i.test(m[1])) lines.push({ name: m[1].replace(/\s*\(Excise Incl\.\)\s*/i, "").trim(), qty: Number(m[2]) });
  }
  return lines;
}

/** Valor (Shopify) shipping and delivery emails: "PRODUCT\n( link )\n\nVARIANT\n\n× n". */
function valorLines(body: string): OrderLine[] {
  const lines: OrderLine[] = [];
  const re = /\n\n([A-Z0-9][^\n(]*(?:\n[^\n(]+)*)\n+\(\s*https?:\/\/[^)]*\/products\/[^)]*\)\s*\n\n([\s\S]*?)\n*×\s*(\d+)/g;
  for (const m of body.matchAll(re)) {
    const product = m[1].replace(/\s*\n\s*/g, " ").trim();
    if (/^excise tax/i.test(product) || /POSM|MARKETING BUNDLE/i.test(product)) continue;
    const variant = m[2]
      .split(/\n+/)
      .map((s) => s.trim().replace(/\s+-$/, ""))
      .filter((s) => s && !/^excise:/i.test(s))
      .join(" ");
    lines.push({ name: variant ? `${product} · ${variant}` : product, qty: Number(m[3]) });
  }
  return lines;
}

/** What one email means for our orders, or null when it doesn't concern them. */
export function parseMail(mail: Mail): MailEvent | null {
  const from = addressOf(mail.from);
  const subject = mail.subject.replace(/\s+/g, " ").trim();
  const body = mail.body ?? "";
  const all = `${subject}\n${body}`;
  const distro = DISTRO_BY_DOMAIN.find(([re]) => re.test(from))?.[1] ?? null;

  // Interac e-Transfer sent by us and deposited by the payee.
  if (/interac\.ca$/.test(from)) {
    const deposited = /successfully deposited|has been deposited|has accepted your transfer/i.test(all);
    if (!deposited) return null;
    const payee =
      subject.match(/transfer to (.+?) has been (?:successfully )?deposited/i)?.[1] ??
      subject.match(/^Interac e-Transfer:\s*(.+?) has accepted your transfer/i)?.[1] ??
      body.match(/deposited by ([^\n]+)/i)?.[1]?.trim() ??
      "";
    const amount = money(subject.match(/\$([\d,]+\.\d{2})/)?.[1] ?? body.match(/\$([\d,]+\.\d{2})/)?.[1] ?? "");
    if (!payee || amount == null) return null;
    const message = body.match(/Message:\s*\n([^\n]+)/i)?.[1]?.trim() ?? "";
    return { kind: "payment", payee, distributor: distributorFromName(payee), amount, refs: refsIn(message), message };
  }

  // Carrier notices (UPS sends one per tracking number, for any shipper).
  if (/ups\.com$|fedex\.com$|canadapost/.test(from)) {
    const tracking = trackingNumbers(all);
    if (!tracking.length) return null;
    const shipper = body.match(/(?:^|\n)From:\s*([^\n]+)/)?.[1] ?? body.match(/at the request of ([^\n]+?) to notify/i)?.[1] ?? "";
    const shipTo = body.match(/Ship To:\s*([\s\S]{0,200})/i)?.[1] ?? "";
    const base = { distributor: shipper ? distributorFromName(shipper) : null, refs: [], tracking, store: storeFromText(shipTo) };
    if (/delivery notification|has been delivered|was delivered/i.test(all)) return { kind: "delivered", ...base };
    if (/ship notification|package coming|on the way|update/i.test(all)) return { kind: "shipped", ...base, lines: [] };
    return null;
  }

  if (!distro) return null;
  // Pacific Smoke greets the Mississauga account as "Vaping Koi Inc" and Brampton as "(Sunnyvale - Brampton)".
  const store =
    storeFromText(body.slice(0, 2000)) ?? (distro === "Pacific Smoke" && /Dear Vaping Koi Inc\b/i.test(body) ? "mississauga" : null);

  // Cancellations (Pacific Smoke cancels unpaid invoices).
  if (/^cancelled\b/i.test(subject) || /we have cancelled this order/i.test(body)) {
    const refs = refsIn(all);
    return refs.length ? { kind: "cancelled", distributor: distro, refs } : null;
  }

  // Delivered (Shopify stores such as Valor: "A shipment from order #1095769A has been delivered").
  if (/has been delivered|shipment delivered/i.test(subject)) {
    return { kind: "delivered", distributor: distro, refs: refsIn(subject), tracking: trackingNumbers(body), store };
  }

  // Shipped / fulfilled / out for delivery.
  if (/has been (?:shipped|fulfilled)|is on (?:the|its) way|out for delivery|shipping confirmation/i.test(subject)) {
    const refs = refsIn(subject);
    if (!refs.length) refs.push(...refsIn(body.slice(0, 600)));
    const lines = distro === "Valor Distributions" ? valorLines(body) : [];
    return { kind: "shipped", distributor: distro, refs, tracking: trackingNumbers(body), store, lines };
  }

  // Pacific Smoke invoices: the order to pay (items and amount are on the PDF).
  if (distro === "Pacific Smoke" && /Invoice:\s*#?INV-\d+/i.test(subject) && !/reminder|statement|credit memo/i.test(subject)) {
    const refs = refsIn(subject);
    const autoShip = /\bASP\b|Auto-Ship/i.test(all);
    return {
      kind: "order",
      distributor: distro,
      refs,
      amount: totalIn(body),
      lines: [],
      store,
      paid: autoShip,
      note: autoShip ? "Auto-Ship invoice (paid by pre-authorized debit). Items are on the PDF." : "Items and amount are on the PDF invoice.",
    };
  }

  // Valor: the order confirmation comes first, then a final invoice to pay.
  if (distro === "Valor Distributions" && /^Valor Order #\w+ Confirmed/i.test(subject)) {
    return { kind: "order", distributor: distro, refs: refsIn(subject), amount: null, lines: [], store, note: "Wait for Valor's final invoice before paying." };
  }
  if (distro === "Valor Distributions" && /^Valor Invoice #\w+/i.test(subject)) {
    return { kind: "invoice", distributor: distro, refs: refsIn(subject), amount: totalIn(body), store };
  }

  // Nimbus (Shopify): "Order #100842 confirmed".
  if (/^Order #\d+ confirmed/i.test(subject)) {
    return { kind: "order", distributor: distro, refs: refsIn(subject), amount: totalIn(body), lines: shopifyLines(body), store };
  }

  // GCore / globe11 (WooCommerce): "Your … order has been received!" with "[Order #139984]".
  if (/order has been received|thank you for your order/i.test(all) && /Order #\d+/i.test(body)) {
    const refs = [`#${body.match(/Order #(\d+)/i)![1]}`];
    const stamp = body.match(/Excise stamp:\s*(\w+)/i)?.[1];
    return {
      kind: "order",
      distributor: distro,
      refs,
      amount: totalIn(body),
      lines: tableLines(body),
      store,
      note: [stamp && `${stamp} stamp`, distro === "GCore Canada" && "Paid by bill payment, so mark it paid here once sent."].filter(Boolean).join(". ") || undefined,
    };
  }

  return null;
}

// ---- Matching emails to orders ----

export type OrderLike = {
  id: number;
  distributor: string;
  store: string | null;
  refs: string[];
  tracking: string[];
  amount: number | null;
  stage: number;
  cancelled: boolean;
  createdAt: Date;
};

const shareRef = (o: OrderLike, refs: string[]) => {
  const keys = new Set(refs.map(refKey));
  return o.refs.some((r) => keys.has(refKey(r)));
};
const shareTracking = (o: OrderLike, tracking: string[]) => o.tracking.some((t) => tracking.includes(t));
const sameMoney = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.011;
const oldestFirst = (a: OrderLike, b: OrderLike) => a.createdAt.getTime() - b.createdAt.getTime();

/**
 * The order an email is about. Refs and tracking numbers win; otherwise a payment matches an
 * unpaid order to that distributor for the same amount (or the only unpaid one), and a shipping
 * notice matches the oldest paid (else unpaid) order from that distributor and store with no tracking yet.
 */
export function matchOrder(event: MailEvent, orders: OrderLike[]): OrderLike | null {
  const live = orders.filter((o) => !o.cancelled);
  if (event.kind === "order" || event.kind === "invoice" || event.kind === "cancelled") {
    return live.find((o) => o.distributor === event.distributor && shareRef(o, event.refs)) ?? null;
  }
  if (event.kind === "payment") {
    if (event.refs.length) {
      const byRef = live.find((o) => shareRef(o, event.refs));
      if (byRef) return byRef;
    }
    if (!event.distributor) return null;
    const unpaid = live.filter((o) => o.distributor === event.distributor && o.stage === 1).sort(oldestFirst);
    return unpaid.find((o) => sameMoney(o.amount, event.amount)) ?? (unpaid.length === 1 && unpaid[0].amount == null ? unpaid[0] : null);
  }
  // shipped / delivered
  const byRef = event.refs.length ? live.find((o) => shareRef(o, event.refs) && (!event.distributor || o.distributor === event.distributor)) : undefined;
  if (byRef) return byRef;
  const byTracking = event.tracking.length ? live.find((o) => shareTracking(o, event.tracking)) : undefined;
  if (byTracking) return byTracking;
  if (event.kind === "shipped" && event.distributor) {
    // Paid orders first; an unpaid one can ship too (GCore is paid by bill payment, which sends no email).
    const waiting = live
      .filter((o) => o.distributor === event.distributor && o.stage <= 2 && !o.tracking.length && (!event.store || !o.store || o.store === event.store))
      .sort((a, b) => b.stage - a.stage || oldestFirst(a, b));
    return waiting[0] ?? null;
  }
  return null;
}

/** The stage an order moves to for an event (never backwards). */
export function stageAfter(current: number, event: MailEvent): number {
  const target = event.kind === "payment" ? 2 : event.kind === "shipped" ? 3 : event.kind === "delivered" ? 4 : current;
  return Math.max(current, target);
}

/** One-line summary of an email for the activity log. */
export function describeEvent(e: MailEvent): string {
  const refs = "refs" in e && e.refs.length ? ` ${e.refs.join(" · ")}` : "";
  switch (e.kind) {
    case "order":
      return `${e.distributor} order${refs}${e.amount != null ? ` · $${e.amount.toFixed(2)}` : ""}`;
    case "invoice":
      return `${e.distributor} invoice${refs}${e.amount != null ? ` · $${e.amount.toFixed(2)}` : ""}`;
    case "payment":
      return `e-Transfer $${e.amount.toFixed(2)} to ${e.payee} deposited${e.message ? ` (“${e.message}”)` : ""}`;
    case "shipped":
      return `${e.distributor ?? "Carrier"} shipped${refs}${e.tracking.length ? ` · ${e.tracking.join(", ")}` : ""}`;
    case "delivered":
      return `${e.distributor ?? "Carrier"} delivered${refs}${e.tracking.length ? ` · ${e.tracking.join(", ")}` : ""}`;
    case "cancelled":
      return `${e.distributor} cancelled${refs}`;
  }
}

/** Link to track a parcel on its carrier's site. */
export function trackingUrl(n: string): string {
  if (/^1Z/i.test(n)) return `https://www.ups.com/track?tracknum=${n}`;
  if (/^\d{16}$/.test(n)) return `https://www.canadapost-postescanada.ca/track-reperage/en#/details/${n}`;
  return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
}
