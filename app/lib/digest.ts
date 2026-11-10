// Daily out-of-stock digest: items at 0 pcs among each store's top 30 sellers (last 30 days)
// and items added in the last 3 weeks, grouped by distributor with suggested quantities.
// Pure code only, so `npm test` can cover it.
import { cartQty, type QtyUnit } from "./distributors.ts";
import { cleanName } from "./prompt.ts";
import { SPLIT_BY_STAMP, isExcluded, type Stamp } from "./ordering.ts";

export const DIGEST_TIME_ZONE = "America/Toronto";
export const DIGEST_HOUR = 9;

/** The fields of a reorder row the digest needs. */
export type DigestRow = {
  kind: "top" | "new";
  rank: number | null;
  name: string;
  distributor: string;
  stock: number;
  sold30: number;
  cartonSize: number;
  suggestedCartons: number;
  stamp: Stamp;
};

export type DigestStoreInput = {
  store: string;
  label: string;
  rows: DigestRow[];
  units: Record<string, QtyUnit>;
  /** Set when this store's stock couldn't be read. */
  problem?: string | null;
};

export type DigestLine = {
  name: string;
  kind: "top" | "new";
  rank: number | null;
  sold30: number;
  stamp: Stamp;
  cartons: number;
  /** What to type on the distributor's site: cartons, or pieces for piece sites (globe11). */
  qty: number;
  unit: QtyUnit;
};

export type DigestGroup = { distributor: string; stamp: Stamp | null; unit: QtyUnit; qty: number; lines: DigestLine[] };

export type DigestStore = { store: string; label: string; problem: string | null; outCount: number; groups: DigestGroup[] };

export type Digest = { date: string; builtAt: string; outCount: number; stores: DigestStore[] };

const qtyWord = (n: number, unit: QtyUnit) => (unit === "PIECE" ? `${n} pc${n === 1 ? "" : "s"}` : `${n} ctn${n === 1 ? "" : "s"}`);
const stampTag = (s: Stamp) => (s === "ONTARIO" ? "ONT" : "FED");

export function buildDigest(stores: DigestStoreInput[], now = new Date()): Digest {
  const out: DigestStore[] = stores.map((s) => {
    const groups = new Map<string, DigestGroup>();
    let outCount = 0;
    for (const r of s.rows) {
      if (r.stock > 0 || isExcluded(r.name)) continue;
      outCount++;
      const unit = s.units[r.distributor] ?? "CARTON";
      // An out-of-stock line always gets at least one carton.
      const cartons = Math.max(1, r.suggestedCartons);
      const split = SPLIT_BY_STAMP.has(r.distributor);
      const key = split ? `${r.distributor}|${r.stamp}` : r.distributor;
      let g = groups.get(key);
      if (!g) {
        g = { distributor: r.distributor, stamp: split ? r.stamp : null, unit, qty: 0, lines: [] };
        groups.set(key, g);
      }
      const qty = cartQty(cartons, r.cartonSize, unit);
      g.lines.push({ name: cleanName(r.name), kind: r.kind, rank: r.rank, sold30: r.sold30, stamp: r.stamp, cartons, qty, unit });
      g.qty += qty;
    }
    const sorted = [...groups.values()].sort(
      (a, b) => a.distributor.localeCompare(b.distributor) || (a.stamp ?? "").localeCompare(b.stamp ?? ""),
    );
    for (const g of sorted) g.lines.sort((a, b) => b.sold30 - a.sold30 || a.name.localeCompare(b.name));
    return { store: s.store, label: s.label, problem: s.problem ?? null, outCount, groups: sorted };
  });
  return {
    date: localDate(now),
    builtAt: now.toISOString(),
    outCount: out.reduce((n, s) => n + s.outCount, 0),
    stores: out,
  };
}

export function digestSubject(d: Digest): string {
  const parts = d.stores.map((s) => `${s.label} ${s.problem ? "?" : s.outCount}`).join(" · ");
  return `KOI//OS out of stock ${prettyDate(d.date)}: ${parts}`;
}

export function digestText(d: Digest, appUrl?: string): string {
  const lines: string[] = [`Out of stock (0 pcs) among top 30 sellers and new items, ${prettyDate(d.date)}.`, ""];
  for (const s of d.stores) {
    lines.push(`== ${s.label.toUpperCase()} ==`);
    if (s.problem) lines.push(`Couldn't read stock: ${s.problem}`);
    else if (s.groups.length === 0) lines.push("Nothing out of stock.");
    for (const g of s.groups) {
      lines.push(`${g.distributor}${g.stamp ? ` (${g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout)` : ""}: ${qtyWord(g.qty, g.unit)}`);
      for (const l of g.lines) {
        const tag = l.kind === "new" ? "NEW" : `#${l.rank}`;
        lines.push(`  - ${l.name} [${stampTag(l.stamp)}] ${qtyWord(l.qty, l.unit)} (${tag}, ${l.sold30} sold 30d)`);
      }
    }
    lines.push("");
  }
  if (appUrl) lines.push(`Open the order sheet: ${appUrl}`);
  return lines.join("\n").trimEnd() + "\n";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function digestHtml(d: Digest, appUrl?: string): string {
  const cell = "padding:4px 8px;border-bottom:1px solid #eee;";
  const body = d.stores
    .map((s) => {
      const head = `<h2 style="font-size:17px;margin:20px 0 6px">${esc(s.label)} <span style="color:#888;font-weight:normal">· ${s.problem ? "not read" : `${s.outCount} out`}</span></h2>`;
      if (s.problem) return `${head}<p style="color:#b00">Couldn't read stock: ${esc(s.problem)}</p>`;
      if (s.groups.length === 0) return `${head}<p style="color:#2a7">Nothing out of stock.</p>`;
      const groups = s.groups
        .map((g) => {
          const title = `${esc(g.distributor)}${g.stamp ? ` · ${g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout` : ""}`;
          const rows = g.lines
            .map(
              (l) =>
                `<tr><td style="${cell}">${esc(l.name)}</td><td style="${cell}">${stampTag(l.stamp)}</td><td style="${cell}text-align:right"><b>${qtyWord(l.qty, l.unit)}</b></td><td style="${cell}color:#888">${l.kind === "new" ? "NEW" : `#${l.rank}`} · ${l.sold30} sold</td></tr>`,
            )
            .join("");
          return `<h3 style="font-size:14px;margin:12px 0 4px">${title} <span style="color:#888;font-weight:normal">· ${qtyWord(g.qty, g.unit)}</span></h3><table style="border-collapse:collapse;font-size:14px;width:100%">${rows}</table>`;
        })
        .join("");
      return head + groups;
    })
    .join("");
  const link = appUrl ? `<p style="margin-top:20px"><a href="${esc(appUrl)}">Open the order sheet in KOI//OS</a></p>` : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:640px"><p>Out of stock (0 pcs) among top 30 sellers and new items, ${esc(prettyDate(d.date))}.</p>${body}${link}</div>`;
}

// ---- Time: 9 AM in Toronto, whatever the daylight-saving offset ----

function wallClock(t: number, tz = DIGEST_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), min: n("minute"), s: n("second") };
}

/** Toronto calendar date, YYYY-MM-DD. */
export function localDate(now = new Date(), tz = DIGEST_TIME_ZONE): string {
  const w = wallClock(now.getTime(), tz);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The UTC instant of a wall-clock time in the given zone. */
function zonedToUtc(y: number, m: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const offsetAt = (t: number) => {
    const w = wallClock(t, tz);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - t;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** The next DIGEST_HOUR:00 in Toronto strictly after `now`. */
export function nextRunAt(now = new Date(), hour = DIGEST_HOUR, tz = DIGEST_TIME_ZONE): Date {
  const w = wallClock(now.getTime(), tz);
  let t = zonedToUtc(w.y, w.m, w.d, hour, tz);
  if (t <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(w.y, w.m - 1, w.d + 1, 12));
    t = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, tz);
  }
  return new Date(t);
}
