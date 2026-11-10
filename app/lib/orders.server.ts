// Distributor orders: created and moved along from Gmail, or by hand on the Orders page.
import type { DistroOrder, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getMessage, gmailStatus, messageUrl, searchMessages } from "./gmail.server";
import { MAIL_QUERY, describeEvent, matchOrder, parseMail, stageAfter, type Mail, type MailEvent, type OrderLine } from "./orderMail";

const KEY_LAST_SYNC = "gmail.lastSync";
/** How far back the first check reads; later checks read the last week and skip what they've seen. */
const FIRST_WINDOW_DAYS = 45;
const WINDOW_DAYS = 7;
const AUTO_EVERY_MS = 5 * 60_000;

export type OrderStage = 1 | 2 | 3 | 4;

/**
 * Runs whenever an order moves to On the way (3) or Delivered (4), from Gmail or by hand.
 * This is where open customer requests for the order's lines get moved along.
 */
export async function onOrderStage(order: DistroOrder, stage: OrderStage): Promise<void> {
  void order;
  void stage;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
const linesOf = (o: DistroOrder) => (Array.isArray(o.lines) ? (o.lines as OrderLine[]) : []);
const fmtDate = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" });
const addNote = (note: string | null, line: string) => (note?.includes(line) ? note : [note, line].filter(Boolean).join("\n"));

async function setStage(order: DistroOrder, stage: number, at: Date, data: Prisma.DistroOrderUpdateInput, updatedBy: string) {
  const before = order.stage;
  const stamps: Prisma.DistroOrderUpdateInput = {};
  if (stage >= 2 && !order.paidAt) stamps.paidAt = at;
  if (stage >= 3 && !order.shippedAt) stamps.shippedAt = at;
  if (stage >= 4 && !order.deliveredAt) stamps.deliveredAt = at;
  const updated = await prisma.distroOrder.update({ where: { id: order.id }, data: { ...data, ...stamps, stage, updatedBy } });
  if (stage > before && stage >= 3) await onOrderStage(updated, (stage >= 4 ? 4 : 3) as OrderStage);
  return updated;
}

/** Apply one parsed email to the orders. Returns the order it touched, if any. */
export async function applyEvent(mail: Mail, event: MailEvent): Promise<DistroOrder | null> {
  const since = new Date(mail.date.getTime() - 120 * 86_400_000);
  const orders = await prisma.distroOrder.findMany({ where: { createdAt: { gte: since } } });
  const match = matchOrder(event, orders.map((o) => ({ ...o, store: o.store })));
  const order = match ? orders.find((o) => o.id === match.id)! : null;
  const url = messageUrl(mail.id);
  const by = "gmail";

  switch (event.kind) {
    case "order":
    case "invoice": {
      if (order) {
        return prisma.distroOrder.update({
          where: { id: order.id },
          data: {
            refs: uniq([...order.refs, ...event.refs]),
            amount: event.amount ?? order.amount,
            store: order.store ?? event.store,
            // Valor's final invoice replaces the "wait for the invoice" note from the confirmation.
            ...(event.kind === "invoice" && order.note?.startsWith("Wait for") ? { note: order.note.replace(/^Wait for[^\n]*\n?/, "") || null } : {}),
            ...(event.kind === "order" && event.lines.length && !linesOf(order).length ? { lines: event.lines } : {}),
            updatedBy: by,
          },
        });
      }
      const paid = event.kind === "order" && event.paid;
      return prisma.distroOrder.create({
        data: {
          distributor: event.distributor,
          store: event.store,
          refs: event.refs,
          amount: event.amount,
          lines: event.kind === "order" ? event.lines : [],
          stage: paid ? 2 : 1,
          paidAt: paid ? mail.date : null,
          note: event.kind === "order" ? (event.note ?? null) : null,
          emailUrl: url,
          createdAt: mail.date,
          updatedBy: by,
        },
      });
    }
    case "payment": {
      if (!order) return null;
      return setStage(
        order,
        stageAfter(order.stage, event),
        mail.date,
        {
          refs: uniq([...order.refs, ...event.refs]),
          amount: order.amount ?? event.amount,
          note: addNote(order.note, `Paid ${fmtDate(mail.date)} (e-Transfer $${event.amount.toFixed(2)}).`),
        },
        by,
      );
    }
    case "shipped":
    case "delivered": {
      if (!order) {
        // A fulfilment for an order we never saw (e.g. Pacific Smoke Auto-Ship): start tracking it here.
        if (event.kind !== "shipped" || !event.distributor || !event.refs.length) return null;
        const created = await prisma.distroOrder.create({
          data: {
            distributor: event.distributor,
            store: event.store,
            refs: event.refs,
            tracking: event.tracking,
            lines: event.lines,
            stage: 3,
            shippedAt: mail.date,
            note: "Found from the shipping email; no invoice or payment email matched.",
            emailUrl: url,
            createdAt: mail.date,
            updatedBy: by,
          },
        });
        await onOrderStage(created, 3);
        return created;
      }
      return setStage(
        order,
        stageAfter(order.stage, event),
        mail.date,
        {
          refs: uniq([...order.refs, ...event.refs]),
          tracking: uniq([...order.tracking, ...event.tracking]),
          store: order.store ?? event.store,
          ...(event.kind === "shipped" && event.lines.length && !linesOf(order).length ? { lines: event.lines } : {}),
        },
        by,
      );
    }
    case "cancelled":
      return order ? prisma.distroOrder.update({ where: { id: order.id }, data: { cancelled: true, note: addNote(order.note, `Cancelled by ${event.distributor} ${fmtDate(mail.date)}.`), updatedBy: by } }) : null;
  }
}

let running: Promise<SyncResult> | null = null;
export type SyncResult = { read: number; changed: number };

/** Read new tracker emails from Gmail, oldest first, and apply each one once. */
export function syncGmail(): Promise<SyncResult> {
  running ??= (async () => {
    try {
      const last = await prisma.appSetting.findUnique({ where: { key: KEY_LAST_SYNC } });
      const ids = await searchMessages(`${MAIL_QUERY} newer_than:${last ? WINDOW_DAYS : FIRST_WINDOW_DAYS}d`);
      const seen = new Set((await prisma.orderMail.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((m) => m.id));
      const fresh = ids.filter((id) => !seen.has(id)).reverse(); // Gmail lists newest first
      let changed = 0;
      for (const id of fresh) {
        const mail = await getMessage(id);
        const event = parseMail(mail);
        const order = event ? await applyEvent(mail, event) : null;
        if (order) changed++;
        await prisma.orderMail.create({
          data: {
            id,
            kind: event?.kind ?? null,
            summary: event ? describeEvent(event) : mail.subject.slice(0, 200),
            orderId: order?.id ?? null,
            matched: Boolean(order),
            receivedAt: mail.date,
          },
        });
      }
      const now = new Date().toISOString();
      await prisma.appSetting.upsert({ where: { key: KEY_LAST_SYNC }, create: { key: KEY_LAST_SYNC, value: now }, update: { value: now } });
      return { read: fresh.length, changed };
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function lastGmailSync(): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key: KEY_LAST_SYNC } }))?.value ?? null;
}

/** Check Gmail when the Orders page opens, at most every 5 minutes. Returns an error message, if any. */
export async function autoSyncGmail(): Promise<string | null> {
  const status = await gmailStatus();
  if (!status.connected || !status.configured) return null;
  const last = await lastGmailSync();
  if (last && Date.now() - Date.parse(last) < AUTO_EVERY_MS) return null;
  try {
    await syncGmail();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't read Gmail.";
  }
}

/** Keep checking Gmail every 10 minutes while the server runs, so orders move without anyone opening the page. */
export function startGmailWatcher() {
  const g = globalThis as { __koiGmailWatcher?: NodeJS.Timeout };
  if (g.__koiGmailWatcher || process.env.NODE_ENV !== "production") return;
  g.__koiGmailWatcher = setInterval(() => {
    autoSyncGmail().then((err) => err && console.warn(`[orders] Gmail check: ${err}`));
  }, 10 * 60_000);
  g.__koiGmailWatcher.unref?.();
}

export async function listOrders() {
  const cutoff = new Date(Date.now() - 60 * 86_400_000);
  return prisma.distroOrder.findMany({
    where: { OR: [{ stage: { lt: 4 }, cancelled: false }, { updatedAt: { gte: cutoff } }] },
    orderBy: { createdAt: "desc" },
  });
}

/** Recent emails that look like payments or shipments but didn't match an order. */
export async function unmatchedMail() {
  return prisma.orderMail.findMany({
    where: { matched: false, kind: { in: ["payment", "shipped", "delivered"] }, receivedAt: { gte: new Date(Date.now() - 21 * 86_400_000) } },
    orderBy: { receivedAt: "desc" },
    take: 30,
  });
}

export async function moveOrder(id: number, stage: number, updatedBy: string) {
  const order = await prisma.distroOrder.findUniqueOrThrow({ where: { id } });
  const s = Math.min(4, Math.max(1, stage));
  if (s >= order.stage) return setStage(order, s, new Date(), {}, updatedBy);
  // Going back clears the later dates so the order reads right.
  return prisma.distroOrder.update({
    where: { id },
    data: {
      stage: s,
      ...(s < 2 ? { paidAt: null } : {}),
      ...(s < 3 ? { shippedAt: null } : {}),
      deliveredAt: null,
      updatedBy,
    },
  });
}

export async function updateOrder(id: number, data: { note?: string | null; store?: string | null; amount?: number | null; cancelled?: boolean }, updatedBy: string) {
  return prisma.distroOrder.update({ where: { id }, data: { ...data, updatedBy } });
}

export async function addManualOrder(
  data: { distributor: string; store: string | null; refs: string[]; amount: number | null; stage: number; note: string | null; lines: OrderLine[] },
  updatedBy: string,
) {
  const now = new Date();
  return prisma.distroOrder.create({
    data: {
      ...data,
      source: "manual",
      paidAt: data.stage >= 2 ? now : null,
      shippedAt: data.stage >= 3 ? now : null,
      deliveredAt: data.stage >= 4 ? now : null,
      updatedBy,
    },
  });
}

/** Attach an unmatched email (e.g. a payment) to an order by hand, and apply it. */
export async function attachMail(mailId: string, orderId: number, updatedBy: string) {
  const mail = await getMessage(mailId);
  const event = parseMail(mail);
  const order = await prisma.distroOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!event || event.kind === "order" || event.kind === "invoice" || event.kind === "cancelled") return order;
  const updated = await setStage(
    order,
    stageAfter(order.stage, event),
    mail.date,
    {
      refs: uniq([...order.refs, ...event.refs]),
      ...(event.kind === "payment"
        ? { amount: order.amount ?? event.amount, note: addNote(order.note, `Paid ${fmtDate(mail.date)} (e-Transfer $${event.amount.toFixed(2)}).`) }
        : { tracking: uniq([...order.tracking, ...event.tracking]) }),
    },
    updatedBy,
  );
  await prisma.orderMail.update({ where: { id: mailId }, data: { orderId, matched: true } });
  return updated;
}

export async function dismissMail(mailId: string) {
  await prisma.orderMail.update({ where: { id: mailId }, data: { matched: true } });
}
