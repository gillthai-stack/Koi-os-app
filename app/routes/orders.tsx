// Distributor orders, moved along from Gmail: invoice/confirmation → e-Transfer deposited →
// shipping email → delivered. Anything the emails can't settle is fixed here by hand.
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { Hero, Shell } from "../components/Shell";
import { requireUser } from "../lib/auth.server";
import { DISTRIBUTOR_SITES } from "../lib/distributors";
import { GMAIL_ADDRESS, disconnect, gmailStatus, redirectUri } from "../lib/gmail.server";
import { STORES } from "../lib/ordering";
import { ORDER_STAGES, refsIn, trackingUrl, type OrderLine } from "../lib/orderMail";
import {
  addManualOrder,
  attachMail,
  autoSyncGmail,
  dismissMail,
  lastGmailSync,
  listOrders,
  moveOrder,
  syncGmail,
  unmatchedMail,
  updateOrder,
} from "../lib/orders.server";

export const meta: MetaFunction = () => [{ title: "Orders · KOI//OS" }];

type StoreFilter = "all" | "mississauga" | "brampton";
const storeFilter = (v: string | null): StoreFilter => (v === "mississauga" || v === "brampton" ? v : "all");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const syncError = await autoSyncGmail();
  const [orders, unmatched, gmail, syncedAt] = await Promise.all([listOrders(), unmatchedMail(), gmailStatus(), lastGmailSync()]);
  return {
    user,
    store: storeFilter(url.searchParams.get("store")),
    notice: url.searchParams.get("gmail"),
    gmail: { ...gmail, address: GMAIL_ADDRESS, redirectUri: redirectUri(request), syncedAt, syncError },
    orders: orders.map((o) => ({
      ...o,
      lines: (Array.isArray(o.lines) ? o.lines : []) as OrderLine[],
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      shippedAt: o.shippedAt?.toISOString() ?? null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
    })),
    unmatched: unmatched.map((m) => ({ id: m.id, kind: m.kind, summary: m.summary, receivedAt: m.receivedAt.toISOString() })),
  };
};

const clean = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return t ? t : null;
};
const num = (v: FormDataEntryValue | null) => {
  const n = parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = Number(form.get("id"));

  try {
    if (intent === "sync") {
      const { read, changed } = await syncGmail();
      return { ok: read ? `Read ${read} new email${read === 1 ? "" : "s"}, updated ${changed} order${changed === 1 ? "" : "s"}.` : "No new emails." };
    }
    if (intent === "move") {
      await moveOrder(id, Number(form.get("stage")), user.username);
      return { saved: id };
    }
    if (intent === "update") {
      const data: Parameters<typeof updateOrder>[1] = {};
      if (form.has("note")) data.note = clean(form.get("note"));
      if (form.has("store")) data.store = clean(form.get("store"));
      if (form.has("amount")) data.amount = num(form.get("amount"));
      if (form.has("cancelled")) data.cancelled = form.get("cancelled") === "true";
      await updateOrder(id, data, user.username);
      return { saved: id };
    }
    if (intent === "add") {
      const distributor = clean(form.get("distributor"));
      if (!distributor) return { error: "Pick the distributor." };
      const ref = clean(form.get("ref"));
      await addManualOrder(
        {
          distributor,
          store: clean(form.get("store")),
          refs: ref ? (refsIn(ref).length ? refsIn(ref) : [ref]) : [],
          amount: num(form.get("amount")),
          stage: Number(form.get("stage")) || 1,
          note: clean(form.get("note")),
          lines: [],
        },
        user.username,
      );
      return { ok: `Added the ${distributor} order.`, at: Date.now() };
    }
    if (intent === "attach") {
      await attachMail(String(form.get("mail")), Number(form.get("order")), user.username);
      return { ok: "Matched the email to that order." };
    }
    if (intent === "dismiss") {
      await dismissMail(String(form.get("mail")));
      return { saved: 0 };
    }
    if (intent === "disconnect") {
      if (user.role !== "OWNER") return { error: "Only the owner can disconnect Gmail." };
      await disconnect();
      return { ok: "Gmail disconnected." };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
  return null;
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Order = Data["orders"][number];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : null);
const dollars = (n: number | null) => (n == null ? null : `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const storeLabel = (s: string | null) => STORES.find((x) => x.key === s)?.label ?? null;
const formKey = (r: unknown) => (r && typeof r === "object" && "at" in r ? String(r.at) : "form");

export default function Orders() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [adding, setAdding] = useState(false);

  const shown = useMemo(
    () => data.orders.filter((o) => !o.cancelled && (data.store === "all" || !o.store || o.store === data.store)),
    [data.orders, data.store],
  );
  const open = shown.filter((o) => o.stage < 4);

  return (
    <Shell user={data.user}>
      <Hero kicker="注文" title={<>Distributor <span className="glow-m">orders</span></>}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["all", ...STORES.map((s) => s.key)] as StoreFilter[]).map((k) => (
            <Link key={k} to={k === "all" ? "/orders" : `/orders?store=${k}`} className={`ktab${k === data.store ? " on" : ""}`} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {k === "all" ? "Both stores" : storeLabel(k)}
            </Link>
          ))}
        </div>
      </Hero>

      <div className="tiles">
        {ORDER_STAGES.map((s, i) => (
          <div key={s.stage} className="card stat-tile">
            <span className="sweep" />
            <span className="kanji" aria-hidden="true">{["払", "済", "送", "着"][i]}</span>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{s.label}{s.stage === 4 ? " · 60 days" : ""}</div>
            <div className={`stat ${["glow-m", "glow-c", "glow-v", "glow-l"][i]}`}>{shown.filter((o) => o.stage === s.stage).length}</div>
          </div>
        ))}
      </div>

      <GmailCard gmail={data.gmail} owner={data.user.role === "OWNER"} busy={busy} notice={data.notice} />

      {result && "error" in result && result.error && <p className="err">{result.error}</p>}
      {result && "ok" in result && result.ok && <p className="glow-l" style={{ fontSize: 14, margin: 0 }}>{result.ok}</p>}

      {data.unmatched.length > 0 && <Unmatched mails={data.unmatched} orders={open} />}

      <section className="card">
        <div className="card-head">
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Add an order by hand</h2>
          <button type="button" className="btn" onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? "Hide" : "Add order"}</button>
        </div>
        {adding && (
          <Form method="post" className="inline-form" key={formKey(result)} style={{ marginTop: 12 }}>
            <input type="hidden" name="intent" value="add" />
            <input className="field" name="distributor" list="order-distros" placeholder="Distributor" required style={{ flex: "1 1 160px" }} />
            <select className="field" name="store" defaultValue={data.store === "all" ? "" : data.store} aria-label="Store" style={{ flex: "0 1 150px" }}>
              <option value="">Store?</option>
              {STORES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <input className="field" name="ref" placeholder="Order / invoice #" style={{ flex: "1 1 150px" }} />
            <input className="field" name="amount" placeholder="Amount" inputMode="decimal" style={{ flex: "0 1 110px" }} />
            <select className="field" name="stage" defaultValue="1" aria-label="Stage" style={{ flex: "0 1 190px" }}>
              {ORDER_STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.label}</option>)}
            </select>
            <input className="field" name="note" placeholder="Note" style={{ flex: "1 1 160px" }} />
            <button className="btn primary" type="submit" disabled={busy}>Add</button>
            <datalist id="order-distros">
              {Object.keys(DISTRIBUTOR_SITES).map((d) => <option key={d} value={d} />)}
            </datalist>
          </Form>
        )}
      </section>

      <div className="order-board">
        {ORDER_STAGES.map((s) => {
          const list = shown.filter((o) => o.stage === s.stage);
          return (
            <section key={s.stage} className="order-col" aria-label={s.label}>
              <h2 className="h order-col-head">
                {s.label} <span className="muted mono">{list.length}</span>
              </h2>
              {list.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing here.</p>}
              {list.map((o) => <OrderCard key={o.id} order={o} />)}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function GmailCard({ gmail, owner, busy, notice }: { gmail: Data["gmail"]; owner: boolean; busy: boolean; notice: string | null }) {
  return (
    <section className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>From Gmail</h2>
          <div className="muted" style={{ fontSize: 12 }}>
            {gmail.connected ? `Reading ${gmail.email || gmail.address}` : `Not connected`}
            {gmail.syncedAt && ` · last checked ${new Date(gmail.syncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {gmail.connected && (
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Check now"}</button>
            </Form>
          )}
          {owner && gmail.configured && !gmail.connected && (
            <a className="btn primary" href="/orders/gmail/connect" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Connect Gmail</a>
          )}
          {owner && gmail.connected && (
            <Form method="post" onSubmit={(e) => !confirm("Stop reading Gmail for orders?") && e.preventDefault()}>
              <input type="hidden" name="intent" value="disconnect" />
              <button className="btn" type="submit">Disconnect</button>
            </Form>
          )}
        </div>
      </div>
      {notice === "connected" && <p className="glow-l" style={{ fontSize: 14 }}>Gmail connected. Orders from the last 45 days are being read now.</p>}
      {notice && notice !== "connected" && <p className="err">{notice}</p>}
      {gmail.syncError && <p className="err">Couldn’t read Gmail: {gmail.syncError}</p>}
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        {gmail.connected
          ? "Checked every 10 minutes and when this page opens. Invoices and order confirmations open an order; a deposited Interac e-Transfer marks it Paid (put the invoice or order # in the e-Transfer message for a sure match); fulfilment and UPS/FedEx emails move it to On the way; delivery emails to Delivered."
          : gmail.configured
            ? owner
              ? `Connect ${gmail.address} once with Google sign-in (read-only). Pick that account on Google's screen.`
              : "The owner needs to connect Gmail from this page."
            : `Google sign-in isn't set up yet. In Google Cloud, create an OAuth client (Web application) with redirect URI ${gmail.redirectUri}, turn on the Gmail API, then set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Render. Until then, add orders by hand.`}
      </p>
    </section>
  );
}

function Unmatched({ mails, orders }: { mails: Data["unmatched"]; orders: Order[] }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Emails that didn’t match an order</h2>
          <div className="muted" style={{ fontSize: 12 }}>Pick the order it belongs to, or ignore it. Payments to people show here too.</div>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {mails.map((m) => <UnmatchedRow key={m.id} mail={m} orders={orders} />)}
      </div>
    </section>
  );
}

function UnmatchedRow({ mail, orders }: { mail: Data["unmatched"][number]; orders: Order[] }) {
  const f = useFetcher();
  if (f.state !== "idle" || f.data) return null;
  return (
    <div className="inline-form" style={{ justifyContent: "space-between" }}>
      <div style={{ flex: "2 1 300px", minWidth: 0 }}>
        <span className={`pill ${mail.kind === "payment" ? "warn" : "ship"}`} style={{ marginRight: 8 }}>{day(mail.receivedAt)}</span>
        {mail.summary}
      </div>
      <f.Form method="post" className="inline-form" style={{ flex: "1 1 300px" }}>
        <input type="hidden" name="mail" value={mail.id} />
        <select className="field" name="order" required aria-label="Order this email belongs to" style={{ minHeight: 36 }}>
          <option value="">Belongs to…</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.distributor} {o.refs[0] ?? ""} {dollars(o.amount) ?? ""} {storeLabel(o.store) ?? ""}
            </option>
          ))}
        </select>
        <button className="btn" type="submit" name="intent" value="attach" style={{ minHeight: 36 }}>Match</button>
        <button className="btn" type="submit" name="intent" value="dismiss" formNoValidate style={{ minHeight: 36 }}>Ignore</button>
      </f.Form>
    </div>
  );
}

function OrderCard({ order: o }: { order: Order }) {
  const f = useFetcher();
  const pending = f.formData?.get("intent") === "move" ? Number(f.formData.get("stage")) : null;
  const stage = pending ?? o.stage;
  const move = (s: number) => f.submit({ intent: "move", id: String(o.id), stage: String(s) }, { method: "post" });
  const save = (k: string, v: string) => f.submit({ intent: "update", id: String(o.id), [k]: v }, { method: "post" });
  const dates = [
    ["Ordered", day(o.createdAt)],
    ["Paid", day(o.paidAt)],
    ["Shipped", day(o.shippedAt)],
    ["Delivered", day(o.deliveredAt)],
  ].filter(([, d]) => d);

  return (
    <article className="card order-card" style={{ opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <strong>{o.distributor}</strong>
        <span className="mono">{dollars(o.amount) ?? "—"}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
        <select
          className={`pill ${o.store ? "top" : "warn"}`}
          value={o.store ?? ""}
          onChange={(e) => save("store", e.target.value)}
          aria-label="Store"
          style={{ cursor: "pointer" }}
        >
          <option value="">Store?</option>
          {STORES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {o.refs.map((r) => <span key={r} className="pill new">{r}</span>)}
        {o.source === "manual" && <span className="pill">by hand</span>}
      </div>
      {o.tracking.length > 0 && (
        <div style={{ fontSize: 13 }}>
          {o.tracking.map((t) => (
            <a key={t} href={trackingUrl(t)} target="_blank" rel="noreferrer" className="mono glow-v" style={{ display: "block" }}>{t}</a>
          ))}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{dates.map(([l, d]) => `${l} ${d}`).join(" · ")}</div>
      {o.lines.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 13 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>{o.lines.length} line{o.lines.length === 1 ? "" : "s"}</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {o.lines.map((l, i) => <li key={i}>{l.name}{l.qty ? ` × ${l.qty}` : ""}</li>)}
          </ul>
        </details>
      )}
      <textarea
        className="field"
        defaultValue={o.note ?? ""}
        placeholder="Note"
        aria-label={`Note for ${o.distributor} order`}
        onBlur={(e) => e.currentTarget.value !== (o.note ?? "") && save("note", e.currentTarget.value)}
        rows={Math.min(5, Math.max(2, (o.note ?? "").split("\n").length + 1))}
        style={{ width: "100%", minHeight: 40, padding: "8px 10px", fontSize: 13, marginTop: 8, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {stage > 1 && <button type="button" className="btn" onClick={() => move(stage - 1)} aria-label="Move back a stage" style={{ minHeight: 36, padding: "0 10px" }}>◀</button>}
        {stage < 4 && (
          <button type="button" className="btn primary" onClick={() => move(stage + 1)} style={{ minHeight: 36, padding: "0 12px", flex: 1 }}>
            {["", "Mark paid", "Mark shipped", "Mark delivered"][stage]}
          </button>
        )}
        {o.emailUrl && <a className="btn" href={o.emailUrl} target="_blank" rel="noreferrer" style={{ minHeight: 36, padding: "0 10px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Email</a>}
        {stage < 3 && (
          <button
            type="button"
            className="btn"
            onClick={() => confirm(`Remove this ${o.distributor} order from the board (cancelled)?`) && save("cancelled", "true")}
            aria-label="Cancelled"
            style={{ minHeight: 36, padding: "0 10px" }}
          >
            ✕
          </button>
        )}
      </div>
    </article>
  );
}
