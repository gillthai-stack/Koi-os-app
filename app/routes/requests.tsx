// Customer requests per store: add them at the counter, pull new ones from the request sheet,
// and move each one through its statuses until it's picked up.
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, redirect, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { RequestOrder } from "../components/RequestOrder";
import { Hero, Shell } from "../components/Shell";
import prisma from "../db.server";
import { requireUser } from "../lib/auth.server";
import { DISTRIBUTOR_SITES } from "../lib/distributors";
import { KEEP_IN_STOCK_TAB, REQUEST_TABS, SHEET_NAME, sheetConfig } from "../lib/google.server";
import { STORES } from "../lib/ordering";
import {
  REQUEST_STATUSES,
  STATUS_GROUPS,
  normalizeStatus,
  parsePasted,
  parseRequestRows,
  requestOrderLines,
  statusTone,
  type RequestStore,
  type StatusGroupKey,
} from "../lib/requests";
import {
  addRequest,
  autoSync,
  deleteRequest,
  importRows,
  lastSync,
  listOrderItems,
  listRequests,
  pushToSheet,
  queueOrderItems,
  syncFromSheet,
  type QueuedLine,
} from "../lib/requests.server";

export const meta: MetaFunction = () => [{ title: "Requests · KOI//OS" }];

function storeFrom(v: string | null): RequestStore {
  return v === "brampton" ? "brampton" : "mississauga";
}

const clean = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return t ? t : null;
};
const int = (v: FormDataEntryValue | null) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const store = storeFrom(new URL(request.url).searchParams.get("store"));
  const syncError = await autoSync(store, user.username);
  const [requests, syncedAt] = await Promise.all([listRequests(store), lastSync(store)]);
  const sheet = sheetConfig();
  const queued = Object.fromEntries(
    (await listOrderItems(store)).map((i) => [i.key.slice(store.length + 1), { cartons: i.cartons, stamp: i.stamp }]),
  );
  return {
    user,
    store,
    queued,
    requests: requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    sheet: { connected: sheet.connected, email: sheet.email, name: SHEET_NAME, tab: `${REQUEST_TABS[store]}” + “${KEEP_IN_STOCK_TAB}`, syncedAt, syncError },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const store = storeFrom(String(form.get("store")));

  if (intent === "add") {
    const customer = clean(form.get("customer"));
    const product = clean(form.get("product"));
    if (!customer || !product) return { error: "Add the customer and what they want." };
    const r = await addRequest(
      store,
      {
        code: null,
        customer,
        phone: clean(form.get("phone")),
        product,
        distributor: clean(form.get("distributor")),
        type: null,
        qtyWanted: int(form.get("qty")) ?? 1,
        qtySetAside: null,
        status: "New",
        priority: null,
        repeatDays: null,
        lastDate: null,
        notes: clean(form.get("notes")),
      },
      user.username,
    );
    const sheetError = await pushToSheet(r);
    return { ok: `Added ${r.code} for ${r.customer}${sheetError ? "" : sheetConfig().connected ? " and to the sheet" : ""}.`, at: Date.now(), sheetError };
  }

  if (intent === "update") {
    const id = Number(form.get("id"));
    const data: { status?: string; qtySetAside?: number | null; notes?: string | null } = {};
    if (form.has("status")) data.status = normalizeStatus(String(form.get("status")));
    if (form.has("qtySetAside")) data.qtySetAside = int(form.get("qtySetAside"));
    if (form.has("notes")) data.notes = clean(form.get("notes"));
    const r = await prisma.customerRequest.update({ where: { id }, data: { ...data, updatedBy: user.username } });
    return { saved: id, sheetError: await pushToSheet(r) };
  }

  if (intent === "queue") {
    let lines: QueuedLine[] = [];
    try {
      lines = JSON.parse(String(form.get("lines") ?? "[]"));
    } catch {
      return { error: "Couldn't read the order. Try again." };
    }
    await queueOrderItems(store, lines.filter((l) => l.key && l.name), user.username);
    throw redirect(`/?store=${store}`);
  }

  if (intent === "delete") {
    if (user.role !== "OWNER") return { error: "Only the owner can delete requests." };
    await deleteRequest(Number(form.get("id")));
    return { ok: "Deleted." };
  }

  if (intent === "sync") {
    try {
      const { added, updated } = await syncFromSheet(store, user.username);
      const parts = [added && `added ${added} new`, updated && `updated ${updated}`].filter(Boolean);
      return { ok: parts.length ? `From the sheet: ${parts.join(", ")}.` : "Up to date with the sheet." };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Couldn't read the sheet." };
    }
  }

  if (intent === "paste") {
    const rows = parseRequestRows(parsePasted(String(form.get("cells") ?? ""))).filter((r) => !r.store || r.store === store);
    if (!rows.length) return { error: "Couldn't find a header row. Copy the header row (Customer, Product…) along with the requests." };
    const { added, skipped } = await importRows(store, rows, user.username, "paste");
    return { ok: `Added ${added} request${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} already here` : ""}.`, at: Date.now() };
  }

  return null;
};

/** Changes after each successful add or paste, so those forms start empty again. */
const formKey = (result: unknown) => (result && typeof result === "object" && "at" in result ? String(result.at) : "form");

type Row = ReturnType<typeof useLoaderData<typeof loader>>["requests"][number];

export default function Requests() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [group, setGroup] = useState<StatusGroupKey>("open");
  const [ordering, setOrdering] = useState(false);
  const orderLines = useMemo(() => requestOrderLines(data.requests), [data.requests]);
  const [q, setQ] = useState("");

  const count = (k: StatusGroupKey) => {
    const g = STATUS_GROUPS.find((x) => x.key === k)!;
    return data.requests.filter((r) => (g.statuses as readonly string[]).includes(r.status)).length;
  };
  const shown = useMemo(() => {
    const g = STATUS_GROUPS.find((x) => x.key === group)!;
    const needle = q.trim().toLowerCase();
    return data.requests.filter(
      (r) =>
        (g.statuses as readonly string[]).includes(r.status) &&
        (!needle || [r.code, r.customer, r.phone, r.product, r.distributor, r.notes].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [data.requests, group, q]);

  const storeLabel = STORES.find((s) => s.key === data.store)!.label;

  return (
    <Shell user={data.user}>
      <Hero kicker="依頼" title={<>Customer <span className="glow-m">requests</span></>}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STORES.map((s) => (
            <Link key={s.key} to={`/requests?store=${s.key}`} className={`ktab${s.key === data.store ? " on" : ""}`} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {s.label}
            </Link>
          ))}
        </div>
      </Hero>

      <div className="tiles">
        <Tile label="Open" value={count("open")} tone="glow-c" kanji="開" />
        <button type="button" className="tile-button" onClick={() => setOrdering(true)} aria-label="Order for requests">
          <Tile label="To order · tap to order" value={count("order")} tone="glow-m" kanji="注" />
        </button>
        <Tile label="Ready for pickup" value={count("ready")} tone="glow-l" kanji="済" />
        <Tile label="Standing orders" value={count("standing")} tone="glow-v" kanji="常" />
      </div>

      {ordering ? (
        <RequestOrder
          key={data.store}
          lines={orderLines}
          store={data.store}
          storeLabel={storeLabel}
          queued={data.queued}
          onClose={() => setOrdering(false)}
        />
      ) : (
        <>
      <section className="card">
        <div className="card-head">
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>New request · {storeLabel}</h2>
        </div>
        <Form method="post" className="inline-form" key={formKey(result)}>
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="store" value={data.store} />
          <input className="field" name="customer" placeholder="Customer" required style={{ flex: "1 1 150px" }} />
          <input className="field" name="phone" placeholder="Phone" inputMode="tel" style={{ flex: "1 1 130px" }} />
          <input className="field" name="product" placeholder="Product and flavour, e.g. Orbito 18K [Mint 20]" required style={{ flex: "2 1 260px" }} />
          <input className="field" name="qty" type="number" min={1} defaultValue={1} aria-label="Quantity" style={{ flex: "0 0 80px" }} />
          <input className="field" name="distributor" list="req-distros" placeholder="Distributor" style={{ flex: "1 1 150px" }} />
          <input className="field" name="notes" placeholder="Notes" style={{ flex: "1 1 160px" }} />
          <button className="btn primary" type="submit" disabled={busy}>Add</button>
          <datalist id="req-distros">
            {Object.keys(DISTRIBUTOR_SITES).map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Form>
        {result && "error" in result && result.error && <p className="err">{result.error}</p>}
        {result && "sheetError" in result && result.sheetError && <p className="err">Saved here, but not on the sheet: {result.sheetError}</p>}
        {result && "ok" in result && result.ok && <p className="glow-l" style={{ fontSize: 14 }}>{result.ok}</p>}
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STATUS_GROUPS.map((g) => (
              <button key={g.key} type="button" className={`chip${group === g.key ? " on" : ""}`} onClick={() => setGroup(g.key)}>
                {g.label} · {count(g.key)}
              </button>
            ))}
          </div>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, product…" style={{ flex: "0 1 260px" }} />
        </div>
        {shown.length === 0 ? (
          <p className="muted" style={{ padding: "20px 4px" }}>
            {data.requests.length === 0 ? `No requests for ${storeLabel} yet. Add one above or pull them from the sheet below.` : "Nothing here."}
          </p>
        ) : (
          <div className="scroll table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Customer</th><th>Product</th><th>Qty</th><th>Set aside</th><th>Status</th><th>Notes</th>{data.user.role === "OWNER" && <th />}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <RequestRow key={r.id} r={r} owner={data.user.role === "OWNER"} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

        </>
      )}

      <SheetCard key={formKey(result)} store={data.store} sheet={data.sheet} busy={busy} />
    </Shell>
  );
}

function RequestRow({ r, owner }: { r: Row; owner: boolean }) {
  const fetcher = useFetcher<{ sheetError?: string | null }>();
  const sheetError = fetcher.data?.sheetError;
  const pending = fetcher.formData;
  const status = pending?.has("status") ? String(pending.get("status")) : r.status;
  const save = (field: string, value: string) => fetcher.submit({ intent: "update", id: String(r.id), [field]: value }, { method: "post" });
  return (
    <tr>
      <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
        {r.code}
        {sheetError && (
          <div className="err" style={{ fontSize: 11, whiteSpace: "normal", maxWidth: 140 }} title={sheetError}>
            Not saved to sheet
          </div>
        )}
      </td>
      <td style={{ minWidth: 130 }}>
        <div style={{ fontWeight: 600 }}>{r.customer}</div>
        {r.phone && (
          <a className="muted mono" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} style={{ fontSize: 12 }}>
            {r.phone}
          </a>
        )}
      </td>
      <td style={{ minWidth: 220 }}>
        <div>{r.product}</div>
        {(r.distributor || r.type) && (
          <div className="muted" style={{ fontSize: 12 }}>
            {[r.distributor, r.type].filter(Boolean).join(" · ")}
          </div>
        )}
      </td>
      <td className="mono">{r.qtyWanted ?? "—"}</td>
      <td>
        <input
          className="field mono"
          type="number"
          min={0}
          defaultValue={r.qtySetAside ?? ""}
          aria-label={`Set aside for ${r.customer}`}
          onBlur={(e) => e.currentTarget.value !== String(r.qtySetAside ?? "") && save("qtySetAside", e.currentTarget.value)}
          style={{ width: 70, minHeight: 36, flex: "none", padding: "0 8px" }}
        />
      </td>
      <td>
        <select
          className={`field status-select ${statusTone(status)}`}
          value={status}
          onChange={(e) => save("status", e.target.value)}
          aria-label={`Status of ${r.code}`}
          style={{ minHeight: 36, flex: "none", width: 190 }}
        >
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </td>
      <td style={{ minWidth: 180 }}>
        <input
          className="field"
          defaultValue={r.notes ?? ""}
          placeholder="Add a note"
          aria-label={`Notes for ${r.code}`}
          onBlur={(e) => e.currentTarget.value !== (r.notes ?? "") && save("notes", e.currentTarget.value)}
          style={{ minHeight: 36, width: "100%" }}
        />
      </td>
      {owner && (
        <td>
          <fetcher.Form method="post" onSubmit={(e) => !confirm(`Delete ${r.code} (${r.customer})?`) && e.preventDefault()}>
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={r.id} />
            <button className="btn" type="submit" aria-label={`Delete ${r.code}`} style={{ minHeight: 36, padding: "0 10px" }}>✕</button>
          </fetcher.Form>
        </td>
      )}
    </tr>
  );
}

function SheetCard({ store, sheet, busy }: { store: RequestStore; sheet: { connected: boolean; email: string | null; name: string; tab: string; syncedAt: string | null; syncError: string | null }; busy: boolean }) {
  const [paste, setPaste] = useState(false);
  return (
    <section className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>From the request sheet</h2>
          <div className="muted" style={{ fontSize: 12 }}>
            {sheet.name} · “{sheet.tab}”
            {sheet.syncedAt && ` · last checked ${new Date(sheet.syncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {sheet.connected && (
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <input type="hidden" name="store" value={store} />
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Syncing…" : "Sync now"}</button>
            </Form>
          )}
          <button type="button" className="btn" onClick={() => setPaste(!paste)} aria-expanded={paste}>
            {paste ? "Hide" : "Paste rows"}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        {sheet.connected
          ? `Connected as ${sheet.email}. New rows and status changes on the sheet come in when this page opens (every 2 minutes at most). Changes made here, and new requests, are written to the sheet.`
          : "Not connected. Two-way sync needs a Google service account key in Render (GOOGLE_SERVICE_ACCOUNT_JSON) and the sheet shared with it. Until then, copy rows from the sheet and paste them."}
      </p>
      {sheet.syncError && <p className="err" style={{ marginBottom: 0 }}>Couldn’t read the sheet: {sheet.syncError}</p>}
      {paste && (
        <Form method="post" className="stack" style={{ marginTop: 12 }}>
          <input type="hidden" name="intent" value="paste" />
          <input type="hidden" name="store" value={store} />
          <textarea
            className="field prompt-box"
            name="cells"
            required
            placeholder="In Google Sheets, select the header row and the requests, copy, and paste here."
          />
          <button className="btn primary" type="submit" disabled={busy}>Add pasted requests</button>
        </Form>
      )}
    </section>
  );
}

function Tile({ label, value, tone, kanji }: { label: string; value: number; tone: string; kanji: string }) {
  return (
    <div className="card stat-tile">
      <span className="sweep" />
      <span className="kanji" aria-hidden="true">{kanji}</span>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{label}</div>
      <div className={`stat ${tone}`}>{value}</div>
    </div>
  );
}
