// Moving customer requests along when their order ships or arrives, and noting when the customer was texted.
import prisma from "../db.server";
import { pushToSheet } from "./requests.server";
import { STAGE_FROM, STAGE_TO, matchInvoice, pickupText, smsHref, type InvoiceLine, type Stage } from "./pickup";
import type { RequestStore } from "./requests";

export type AdvancedRequest = {
  id: number;
  code: string;
  customer: string;
  product: string;
  from: string;
  to: string;
  line: string;
  text: string | null;
  smsHref: string | null;
};

/** Requests an invoice would move, without changing anything. */
export async function previewInvoice(opts: { store?: RequestStore | null; distributor?: string | null; lines: InvoiceLine[]; stage: Stage }) {
  const requests = await prisma.customerRequest.findMany({
    where: { status: { in: [...STAGE_FROM[opts.stage]] }, ...(opts.store ? { store: opts.store } : {}) },
  });
  return matchInvoice(opts.lines, requests, opts);
}

/**
 * When an order ships, its matching requests go On the way; when it's delivered they go
 * Ready – set aside with the requested pieces set aside, and get a drafted pickup text.
 * Called by the order tracker and by "Match an invoice" on the Requests page. `onlyIds`
 * limits it to the requests someone ticked.
 */
export async function advanceRequestsFromInvoice(opts: {
  store?: RequestStore | null;
  distributor?: string | null;
  lines: InvoiceLine[];
  stage: Stage;
  updatedBy: string;
  onlyIds?: number[];
}): Promise<{ moved: AdvancedRequest[]; sheetError: string | null }> {
  if (!opts.lines.length) return { moved: [], sheetError: null };
  const matches = (await previewInvoice(opts)).filter((m) => !opts.onlyIds || opts.onlyIds.includes(m.request.id));
  const moved: AdvancedRequest[] = [];
  let sheetError: string | null = null;
  for (const { request: r, line } of matches) {
    const to = STAGE_TO[opts.stage];
    const data: { status: string; qtySetAside?: number; updatedBy: string } = { status: to, updatedBy: opts.updatedBy };
    if (opts.stage === "delivered") data.qtySetAside = Math.max(r.qtySetAside ?? 0, r.qtyWanted ?? 1);
    const u = await prisma.customerRequest.update({ where: { id: r.id }, data });
    sheetError ??= await pushToSheet(u);
    const text = opts.stage === "delivered" ? pickupText(u) : null;
    moved.push({
      id: u.id,
      code: u.code,
      customer: u.customer,
      product: u.product,
      from: r.status,
      to,
      line: line.name,
      text,
      smsHref: text ? smsHref(u.phone, text) : null,
    });
  }
  return { moved, sheetError };
}

const shortDate = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" });

/** After the pickup text goes out: Notified – holding, with the date in the notes. */
export async function markTexted(id: number, updatedBy: string) {
  const r = await prisma.customerRequest.findUniqueOrThrow({ where: { id } });
  const stamp = `Texted ${shortDate(new Date())}`;
  const notes = r.notes?.includes(stamp) ? r.notes : [r.notes, stamp].filter(Boolean).join(" · ");
  const u = await prisma.customerRequest.update({ where: { id }, data: { status: "Notified – holding", notes, updatedBy } });
  return { request: u, sheetError: await pushToSheet(u) };
}
