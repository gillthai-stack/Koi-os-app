// Customer requests: statuses, IDs and reading rows copied or synced from the request sheets.
// Pure helpers only, so `npm test` can cover them.
import { canonicalDistributor } from "./distributors.ts";

export const REQUEST_STATUSES = [
  "New",
  "Needs info",
  "Order on request",
  "Waiting on stock",
  "Ordered",
  "On the way",
  "Ready – set aside",
  "Notified – holding",
  "Picked up",
  "Standing order",
  "Closed – inactive",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_GROUPS = [
  { key: "open", label: "Open", statuses: REQUEST_STATUSES.filter((s) => s !== "Picked up" && s !== "Closed – inactive") },
  { key: "order", label: "To order", statuses: ["New", "Needs info", "Order on request", "Waiting on stock"] },
  { key: "coming", label: "Ordered", statuses: ["Ordered", "On the way"] },
  { key: "ready", label: "Ready", statuses: ["Ready – set aside", "Notified – holding"] },
  { key: "standing", label: "Standing", statuses: ["Standing order"] },
  { key: "done", label: "Done", statuses: ["Picked up", "Closed – inactive"] },
  { key: "all", label: "All", statuses: [...REQUEST_STATUSES] },
] as const satisfies readonly { key: string; label: string; statuses: readonly RequestStatus[] }[];
export type StatusGroupKey = (typeof STATUS_GROUPS)[number]["key"];

/** Pill colour per status. */
export function statusTone(s: string): "low" | "warn" | "ok" | "new" | "muted" {
  if (s === "New" || s === "Needs info") return "new";
  if (s === "Order on request" || s === "Waiting on stock") return "low";
  if (s === "Ordered" || s === "On the way") return "warn";
  if (s === "Ready – set aside" || s === "Notified – holding" || s === "Standing order") return "ok";
  return "muted";
}

const squash = (s: string) => s.toLowerCase().replace(/[‐-―-]/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Matches sheet spellings ("Ready - set aside", "waiting on stock") to a status; unknown text becomes New. */
export function normalizeStatus(raw: string | null | undefined): RequestStatus {
  const want = squash(raw ?? "");
  if (!want) return "New";
  return REQUEST_STATUSES.find((s) => squash(s) === want) ?? REQUEST_STATUSES.find((s) => want.startsWith(squash(s))) ?? "New";
}

export const STORE_PREFIX = { mississauga: "M", brampton: "B" } as const;
export const KEEP_PREFIX = "K";
export type RequestStore = keyof typeof STORE_PREFIX;

/** Next free ID for a prefix, e.g. M-073 after M-072. */
export function nextCode(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  for (const c of existing) {
    const m = re.exec(c.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export type RequestInput = {
  code: string | null;
  customer: string;
  phone: string | null;
  product: string;
  distributor: string | null;
  type: string | null;
  qtyWanted: number | null;
  qtySetAside: number | null;
  status: RequestStatus;
  priority: string | null;
  repeatDays: number | null;
  lastDate: string | null;
  notes: string | null;
  /** The row's Store column, when the tab has one (squashed, e.g. "mississauga"). */
  store?: string | null;
};

type Field = keyof RequestInput;

// Header names seen in the request sheets, squashed.
const HEADERS: Record<Field, string[]> = {
  code: ["id", "request id", "code", "#"],
  customer: ["customer", "name", "customer name", "client", "requested by"],
  phone: ["phone", "phone number", "number", "cell", "contact"],
  product: ["product", "item", "product flavour", "product flavor", "request", "requested item", "items"],
  distributor: ["distributor", "distro", "supplier", "vendor"],
  type: ["type", "category"],
  qtyWanted: ["qty wanted", "qty", "quantity", "amount", "qty requested"],
  qtySetAside: ["qty set aside", "set aside", "on hold", "qty on hold"],
  status: ["status"],
  priority: ["priority"],
  repeatDays: ["repeat every days", "repeat every", "repeat days", "repeat"],
  lastDate: ["last date as written", "last date", "date"],
  notes: ["notes", "note", "comments", "comment"],
  store: ["store", "location", "shop"],
};

export function headerIndex(row: string[]): Partial<Record<Field, number>> | null {
  const cells = row.map((c) => squash(c ?? ""));
  const idx: Partial<Record<Field, number>> = {};
  for (const [field, names] of Object.entries(HEADERS) as [Field, string[]][]) {
    const i = cells.findIndex((c) => c && names.includes(c));
    if (i >= 0) idx[field] = i;
  }
  return idx.product !== undefined && idx.customer !== undefined ? idx : null;
}

const num = (s: string | undefined): number | null => {
  const m = /-?\d+/.exec(s ?? "");
  return m ? Number(m[0]) : null;
};
const text = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/**
 * Reads request rows from a sheet tab (or cells pasted from it). The header row is found by
 * its names, so extra rows above it and column order don't matter. Rows without a product are skipped.
 */
export function parseRequestRows(rows: string[][], defaultStatus: RequestStatus = "New"): RequestInput[] {
  const at = rows.findIndex((r) => headerIndex(r));
  if (at < 0) return [];
  const idx = headerIndex(rows[at])!;
  const get = (r: string[], f: Field) => (idx[f] === undefined ? undefined : r[idx[f]!]);
  const out: RequestInput[] = [];
  for (const r of rows.slice(at + 1)) {
    const product = text(get(r, "product"));
    if (!product) continue;
    const code = text(get(r, "code"));
    out.push({
      code: code && /^[A-Z]-\d+$/i.test(code) ? code.toUpperCase() : null,
      customer: text(get(r, "customer")) ?? "(no name)",
      phone: text(get(r, "phone")),
      product,
      distributor: text(get(r, "distributor")),
      type: text(get(r, "type")),
      qtyWanted: num(get(r, "qtyWanted")),
      qtySetAside: num(get(r, "qtySetAside")),
      status: text(get(r, "status")) ? normalizeStatus(get(r, "status")) : defaultStatus,
      priority: text(get(r, "priority")),
      repeatDays: num(get(r, "repeatDays")),
      lastDate: text(get(r, "lastDate")),
      notes: text(get(r, "notes")),
      store: text(get(r, "store")) ? squash(get(r, "store")!) : null,
    });
  }
  return out;
}

/** Cells copied from Google Sheets arrive tab-separated, one row per line. */
export function parsePasted(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => (l.includes("\t") ? l.split("\t") : l.split(",")));
}

/** Identity of a sheet row, so syncing again doesn't add it twice. */
export function sheetKey(store: string, r: Pick<RequestInput, "customer" | "phone" | "product">): string {
  return [store, squash(r.customer), (r.phone ?? "").replace(/\D/g, ""), squash(r.product)].join("|");
}

/** What the app keeps for a request, as far as the sheet is concerned. */
export type SheetRequest = {
  code: string;
  store: string;
  customer: string;
  phone: string | null;
  product: string;
  distributor: string | null;
  type: string | null;
  qtyWanted: number | null;
  qtySetAside: number | null;
  status: string;
  priority: string | null;
  notes: string | null;
};

const STORE_LABEL: Record<string, string> = { mississauga: "Mississauga", brampton: "Brampton" };

/** Fields the app changes after a request exists; these are written back to the sheet. */
export const SYNCED_FIELDS = ["status", "qtySetAside", "notes"] as const;

const cellValue = (r: SheetRequest, f: Field): string => {
  if (f === "store") return STORE_LABEL[r.store] ?? r.store;
  const v = (r as unknown as Record<string, unknown>)[f];
  return v === null || v === undefined ? "" : String(v);
};

/**
 * How to bring one request into a sheet tab: the cells to change on its row (matched by ID, or by
 * customer + phone + product when the tab has no IDs), or a whole new row to append.
 */
export function planSheetWrite(
  rows: string[][],
  req: SheetRequest,
): { kind: "update"; cells: { row: number; col: number; value: string }[] } | { kind: "append"; values: string[] } | { kind: "none" } {
  const at = rows.findIndex((r) => headerIndex(r));
  if (at < 0) return { kind: "none" };
  const idx = headerIndex(rows[at])!;
  const key = sheetKey(req.store, req);
  const get = (r: string[], f: Field) => (idx[f] === undefined ? "" : (r[idx[f]!] ?? ""));
  for (let i = at + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = get(r, "code").trim().toUpperCase();
    const sameCode = idx.code !== undefined && code && code === req.code;
    const sameKey =
      (!code || idx.code === undefined) &&
      get(r, "product").trim() &&
      sheetKey(req.store, { customer: get(r, "customer").trim() || "(no name)", phone: get(r, "phone"), product: get(r, "product") }) === key;
    if (!sameCode && !sameKey) continue;
    const cells: { row: number; col: number; value: string }[] = [];
    const fields: Field[] = [...SYNCED_FIELDS];
    if (idx.code !== undefined && !code) fields.push("code");
    for (const f of fields) {
      if (idx[f] === undefined) continue;
      const want = cellValue(req, f);
      if (get(r, f).trim() !== want) cells.push({ row: i, col: idx[f]!, value: want });
    }
    return { kind: "update", cells };
  }
  const width = rows[at].length;
  const values = Array.from({ length: width }, () => "");
  for (const [f, col] of Object.entries(idx) as [Field, number][]) {
    if (f === "repeatDays" || f === "lastDate") continue;
    values[col] = cellValue(req, f);
  }
  return { kind: "append", values };
}

/** Statuses that still need ordering from a distributor. */
export const TO_ORDER_STATUSES: readonly string[] = STATUS_GROUPS.find((g) => g.key === "order")!.statuses;

export type RequestOrderLine = {
  key: string;
  name: string;
  distributor: string;
  stamp: "ONTARIO" | "FEDERAL";
  /** Pieces customers asked for, minus what's already set aside. */
  wanted: number;
  customers: string[];
  requestIds: number[];
  codes: string[];
};

/** Ontario only when the request says so (e.g. "[ONT]" or "ONT"); everything else is Federal. */
export function requestStamp(product: string): "ONTARIO" | "FEDERAL" {
  return /\bONT(ARIO)?\b/i.test(product) ? "ONTARIO" : "FEDERAL";
}

/** Open requests that need ordering, one line per product and distributor (several customers can share a line). */
export function requestOrderLines(
  requests: { id: number; code: string; customer: string; product: string; distributor: string | null; status: string; qtyWanted: number | null; qtySetAside: number | null }[],
): RequestOrderLine[] {
  const lines = new Map<string, RequestOrderLine>();
  for (const r of requests) {
    if (!TO_ORDER_STATUSES.includes(r.status)) continue;
    const distributor = canonicalDistributor(r.distributor);
    const stamp = requestStamp(r.product);
    const key = `${distributor}|${squash(r.product)}|${stamp}`;
    let l = lines.get(key);
    if (!l) {
      l = { key, name: r.product.trim(), distributor, stamp, wanted: 0, customers: [], requestIds: [], codes: [] };
      lines.set(key, l);
    }
    l.wanted += Math.max(0, (r.qtyWanted ?? 1) - (r.qtySetAside ?? 0));
    if (!l.customers.includes(r.customer)) l.customers.push(r.customer);
    l.requestIds.push(r.id);
    l.codes.push(r.code);
  }
  return [...lines.values()].sort((a, b) => a.distributor.localeCompare(b.distributor) || a.name.localeCompare(b.name));
}
