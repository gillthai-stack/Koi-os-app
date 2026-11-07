// Database side of customer requests.
import prisma from "../db.server";
import { KEEP_IN_STOCK_TAB, REQUEST_TABS, readTab } from "./google.server";
import { KEEP_PREFIX, STORE_PREFIX, nextCode, parseRequestRows, sheetKey, type RequestInput, type RequestStore } from "./requests";

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

/**
 * Adds rows from the sheet (or pasted from it) that aren't in the app yet. Rows already here,
 * by ID or by customer + phone + product, are left alone: once imported, the app is the record.
 */
export async function importRows(
  store: RequestStore,
  rows: RequestInput[],
  updatedBy: string,
  source: "sheet" | "paste",
  prefix: string = STORE_PREFIX[store],
) {
  const existing = await prisma.customerRequest.findMany({ select: { code: true, sheetKey: true, store: true, customer: true, phone: true, product: true } });
  const codes = new Set(existing.map((r) => r.code));
  const keys = new Set(existing.flatMap((r) => [r.sheetKey, sheetKey(r.store, r)].filter(Boolean) as string[]));
  const allCodes = existing.map((r) => r.code);
  let added = 0;
  for (const row of rows) {
    const key = sheetKey(store, row);
    if (keys.has(key) || (row.code && codes.has(row.code))) continue;
    const fields = fieldsOf(row);
    const code = row.code ?? nextCode(prefix, allCodes);
    await prisma.customerRequest.create({ data: { ...fields, code, store, source, sheetKey: key, updatedBy } });
    codes.add(code);
    keys.add(key);
    allCodes.push(code);
    added++;
  }
  return { added, skipped: rows.length - added };
}

export async function syncFromSheet(store: RequestStore, updatedBy: string) {
  const rows = parseRequestRows(await readTab(REQUEST_TABS[store])).filter((r) => !r.store || r.store === store);
  const result = await importRows(store, rows, updatedBy, "sheet");
  // Keep-in-stock asks for this store become standing orders with K-### IDs.
  const keep = parseRequestRows(await readTab(KEEP_IN_STOCK_TAB), "Standing order")
    .filter((r) => r.store === store)
    .map((r) => (r.customer === "(no name)" ? { ...r, customer: "Keep in stock" } : r));
  const kept = await importRows(store, keep, updatedBy, "sheet", KEEP_PREFIX);
  result.added += kept.added;
  result.skipped += kept.skipped;
  await prisma.appSetting.upsert({
    where: { key: `requests.sync.${store}` },
    create: { key: `requests.sync.${store}`, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  return result;
}

export async function lastSync(store: RequestStore): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key: `requests.sync.${store}` } }))?.value ?? null;
}
