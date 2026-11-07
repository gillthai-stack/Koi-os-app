// Database side of customer requests.
import prisma from "../db.server";
import type { CustomerRequest } from "@prisma/client";
import { KEEP_IN_STOCK_TAB, REQUEST_TABS, appendRow, readTab, sheetConfig, writeCells } from "./google.server";
import {
  KEEP_PREFIX,
  STORE_PREFIX,
  nextCode,
  parseRequestRows,
  planSheetWrite,
  sheetKey,
  type RequestInput,
  type RequestStore,
} from "./requests";

/** The sheet's Store column isn't a database field; the store comes from the page. */
function fieldsOf(input: RequestInput) {
  const fields = { ...input };
  delete fields.store;
  return fields;
}

export function listRequests(store: RequestStore) {
  return prisma.customerRequest.findMany({ where: { store }, orderBy: [{ code: "asc" }] });
}

async function codesFor(prefix: string): Promise<string[]> {
  const rows = await prisma.customerRequest.findMany({ where: { code: { startsWith: `${prefix}-` } }, select: { code: true } });
  return rows.map((r) => r.code);
}

export async function addRequest(store: RequestStore, input: RequestInput, updatedBy: string) {
  const fields = fieldsOf(input);
  const code = input.code ?? nextCode(STORE_PREFIX[store], await codesFor(STORE_PREFIX[store]));
  return prisma.customerRequest.create({ data: { ...fields, code, store, source: "manual", updatedBy } });
}

const DELETED = "requests.deleted.";

/** Deleted requests stay deleted: the sheet row is left alone, so remember not to import it again. */
export async function deleteRequest(id: number) {
  const r = await prisma.customerRequest.delete({ where: { id } });
  const key = r.sheetKey ?? sheetKey(r.store, r);
  await prisma.appSetting.upsert({ where: { key: DELETED + r.code }, create: { key: DELETED + r.code, value: key }, update: { value: key } });
  return r;
}

/**
 * Adds rows from the sheet (or pasted from it) that aren't in the app yet. With `updateSince`,
 * a row already here takes the sheet's status, set-aside count and notes, unless someone changed
 * it in the app after that time (the app's change is written to the sheet instead).
 */
export async function importRows(
  store: RequestStore,
  rows: RequestInput[],
  updatedBy: string,
  source: "sheet" | "paste",
  prefix: string = STORE_PREFIX[store],
  updateSince: Date | null = null,
) {
  const existing = await prisma.customerRequest.findMany();
  const byCode = new Map(existing.map((r) => [r.code, r]));
  const byKey = new Map(existing.flatMap((r) => [r.sheetKey, sheetKey(r.store, r)].filter(Boolean).map((k) => [k as string, r] as const)));
  const deleted = await prisma.appSetting.findMany({ where: { key: { startsWith: DELETED } } });
  const gone = new Set(deleted.flatMap((d) => [d.key.slice(DELETED.length), d.value]));
  const allCodes = existing.map((r) => r.code);
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const key = sheetKey(store, row);
    if (gone.has(key) || (row.code && gone.has(row.code))) continue;
    const here = (row.code && byCode.get(row.code)) || byKey.get(key);
    if (here) {
      if (updateSince && here.updatedAt <= updateSince) {
        const change: Partial<CustomerRequest> = {};
        if (row.status !== here.status) change.status = row.status;
        if (row.qtySetAside !== here.qtySetAside) change.qtySetAside = row.qtySetAside;
        if ((row.notes ?? null) !== (here.notes ?? null)) change.notes = row.notes;
        if (Object.keys(change).length) {
          // Keep updatedAt at the sync time so this doesn't count as an app edit.
          await prisma.customerRequest.update({ where: { id: here.id }, data: { ...change, updatedBy: "sheet", updatedAt: updateSince } });
          updated++;
        }
      }
      continue;
    }
    const fields = fieldsOf(row);
    const code = row.code ?? nextCode(prefix, allCodes);
    await prisma.customerRequest.create({ data: { ...fields, code, store, source, sheetKey: key, updatedBy } });
    allCodes.push(code);
    byCode.set(code, { code } as CustomerRequest);
    added++;
  }
  return { added, updated, skipped: rows.length - added - updated };
}

export async function syncFromSheet(store: RequestStore, updatedBy: string) {
  const prev = await lastSync(store);
  // Rows edited in the app after the last pull keep the app's values.
  const since = prev ? new Date(prev) : null;
  const rows = parseRequestRows(await readTab(REQUEST_TABS[store])).filter((r) => !r.store || r.store === store);
  const result = await importRows(store, rows, updatedBy, "sheet", STORE_PREFIX[store], since);
  // Keep-in-stock asks for this store become standing orders with K-### IDs.
  const keep = parseRequestRows(await readTab(KEEP_IN_STOCK_TAB), "Standing order").filter((r) => r.store === store);
  const kept = await importRows(store, keep, updatedBy, "sheet", KEEP_PREFIX, since);
  result.added += kept.added;
  result.updated += kept.updated;
  result.skipped += kept.skipped;
  // Stamped after the import, so rows it just created don't look like app edits next time.
  const now = new Date();
  await prisma.appSetting.upsert({
    where: { key: `requests.sync.${store}` },
    create: { key: `requests.sync.${store}`, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
  return result;
}

const AUTO_SYNC_MS = 2 * 60 * 1000;

/** Pulls from the sheet when the page opens, at most every 2 minutes. Never blocks the page on errors. */
export async function autoSync(store: RequestStore, updatedBy: string): Promise<string | null> {
  if (!sheetConfig().connected) return null;
  const prev = await lastSync(store);
  if (prev && Date.now() - new Date(prev).getTime() < AUTO_SYNC_MS) return null;
  try {
    await syncFromSheet(store, updatedBy);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't read the sheet.";
  }
}

/** Writes one request's status, set-aside count and notes to its sheet row, or appends it. */
export async function pushToSheet(r: CustomerRequest): Promise<string | null> {
  if (!sheetConfig().connected) return null;
  const store = r.store as RequestStore;
  const tab = r.code.startsWith(`${KEEP_PREFIX}-`) ? KEEP_IN_STOCK_TAB : REQUEST_TABS[store];
  try {
    const plan = planSheetWrite(await readTab(tab), r);
    if (plan.kind === "update") await writeCells(tab, plan.cells);
    if (plan.kind === "append") await appendRow(tab, plan.values);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't update the sheet.";
  }
}

export async function lastSync(store: RequestStore): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key: `requests.sync.${store}` } }))?.value ?? null;
}

// Requests sent to the Reorder page's order sheet.

export function listOrderItems(store: RequestStore) {
  return prisma.requestOrderItem.findMany({ where: { store }, orderBy: [{ distributor: "asc" }, { name: "asc" }] });
}

export type QueuedLine = { key: string; name: string; distributor: string; stamp: "ONTARIO" | "FEDERAL"; cartons: number; requestIds: number[] };

/** Saves the cartons chosen for each request line; 0 takes the line off the order sheet. */
export async function queueOrderItems(store: RequestStore, lines: QueuedLine[], updatedBy: string) {
  for (const l of lines) {
    const key = `${store}|${l.key}`;
    if (l.cartons > 0) {
      const data = { store, name: l.name, distributor: l.distributor, stamp: l.stamp, cartons: l.cartons, requestIds: l.requestIds, updatedBy };
      await prisma.requestOrderItem.upsert({ where: { key }, create: { key, ...data }, update: data });
    } else {
      await prisma.requestOrderItem.deleteMany({ where: { key } });
    }
  }
}

export async function setOrderItemCartons(key: string, cartons: number, updatedBy: string) {
  if (cartons > 0) await prisma.requestOrderItem.updateMany({ where: { key }, data: { cartons, updatedBy } });
  else await prisma.requestOrderItem.deleteMany({ where: { key } });
}

/** After checkout: the lines' requests become Ordered (and on the sheet), and the lines leave the order sheet. */
export async function markOrderItemsOrdered(keys: string[], updatedBy: string) {
  const items = await prisma.requestOrderItem.findMany({ where: { key: { in: keys } } });
  const errors: string[] = [];
  let count = 0;
  for (const id of new Set(items.flatMap((i) => i.requestIds))) {
    const r = await prisma.customerRequest.update({ where: { id }, data: { status: "Ordered", updatedBy } }).catch(() => null);
    if (!r) continue;
    count++;
    const e = await pushToSheet(r);
    if (e) errors.push(e);
  }
  await prisma.requestOrderItem.deleteMany({ where: { key: { in: keys } } });
  return { count, sheetError: errors[0] ?? null };
}
