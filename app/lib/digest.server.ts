// Builds the daily out-of-stock digest from live Shopify stock, saves it for the Digest page,
// and emails it at 9 AM Toronto when Gmail is set up (GMAIL_USER + GMAIL_APP_PASSWORD).
import nodemailer from "nodemailer";
import prisma from "../db.server";
import { STORES } from "./ordering";
import { ShopifyNotConnected, loadReorderTable } from "./stock.server";
import {
  DIGEST_HOUR,
  buildDigest,
  digestHtml,
  digestSubject,
  digestText,
  localDate,
  nextRunAt,
  type Digest,
  type DigestStoreInput,
} from "./digest";

const LATEST = "digest.latest";
const SENT_ON = "digest.sentOn";

export function emailConfig() {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const to = process.env.DIGEST_TO?.trim() || user;
  return user && pass && to ? { user, pass, to } : null;
}

function appUrl(): string | undefined {
  const base = process.env.SHOPIFY_APP_URL?.replace(/\/+$/, "");
  return base ? `${base}/` : undefined;
}

export async function buildLiveDigest(): Promise<Digest> {
  const inputs: DigestStoreInput[] = [];
  for (const s of STORES) {
    try {
      const t = await loadReorderTable(s.key);
      inputs.push({ store: s.key, label: s.label, rows: t.rows, units: t.units });
    } catch (e) {
      const problem =
        e instanceof ShopifyNotConnected ? "Shopify isn't connected" : e instanceof Error ? e.message : "Unknown error";
      inputs.push({ store: s.key, label: s.label, rows: [], units: {}, problem });
    }
  }
  const digest = buildDigest(inputs);
  await prisma.appSetting.upsert({
    where: { key: LATEST },
    create: { key: LATEST, value: JSON.stringify(digest) },
    update: { value: JSON.stringify(digest) },
  });
  return digest;
}

export async function latestDigest(): Promise<Digest | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: LATEST } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Digest;
  } catch {
    return null;
  }
}

export async function lastSentOn(): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key: SENT_ON } }))?.value ?? null;
}

export async function emailDigest(digest: Digest): Promise<void> {
  const cfg = emailConfig();
  if (!cfg) throw new Error("Email isn't set up yet (GMAIL_USER and GMAIL_APP_PASSWORD on Render).");
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user: cfg.user, pass: cfg.pass } });
  await transport.sendMail({
    from: `KOI//OS <${cfg.user}>`,
    to: cfg.to,
    subject: digestSubject(digest),
    text: digestText(digest, appUrl()),
    html: digestHtml(digest, appUrl()),
  });
}

/** The 9 AM run: build, save, email once per Toronto day. */
export async function runDailyDigest(now = new Date()): Promise<void> {
  const today = localDate(now);
  if ((await lastSentOn()) === today) return;
  const digest = await buildLiveDigest();
  if (emailConfig()) await emailDigest(digest);
  await prisma.appSetting.upsert({
    where: { key: SENT_ON },
    create: { key: SENT_ON, value: today },
    update: { value: today },
  });
}

const g = globalThis as unknown as { __koiDigestTimer?: ReturnType<typeof setTimeout> };

/** Starts the in-process 9 AM timer once per server (Render keeps the starter instance running). */
export function startDigestScheduler() {
  if (g.__koiDigestTimer || process.env.NODE_ENV !== "production" || process.env.DIGEST_DISABLED === "1") return;
  const schedule = () => {
    const at = nextRunAt();
    g.__koiDigestTimer = setTimeout(async () => {
      try {
        await runDailyDigest();
      } catch (e) {
        console.error("[digest] daily run failed", e);
      }
      schedule();
    }, at.getTime() - Date.now());
    console.log(`[digest] next run ${at.toISOString()} (${DIGEST_HOUR}:00 Toronto)`);
  };
  schedule();
}
