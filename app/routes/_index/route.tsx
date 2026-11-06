// KOI//OS reorder page: top 30 sellers per store, filtered to what needs ordering,
// with an order sheet grouped by distributor (GCore split by stamp).
import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction, ShouldRevalidateFunction } from "react-router";
import { Link, useFetcher, useLoaderData, useNavigation } from "react-router";
import { Hero, Shell } from "../../components/Shell";
import { requireUser } from "../../lib/auth.server";
import { DISTRIBUTOR_SITES } from "../../lib/distributors";
import { STORES, buildOrderSheet, cartonsFor, nextCartonSize, type Stamp, type StoreKey } from "../../lib/ordering";
import { ShopifyNotConnected, loadReorderTable, saveVariantSetting, type ReorderRow } from "../../lib/stock.server";

export const meta: MetaFunction = () => [{ title: "Reorder · KOI//OS" }];

function storeFrom(url: URL): StoreKey {
  const s = url.searchParams.get("store");
  return STORES.some((x) => x.key === s) ? (s as StoreKey) : "mississauga";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const store = storeFrom(new URL(request.url));
  try {
    const table = await loadReorderTable(store);
    return { user, store, ...table, problem: null as null | "not-connected" | string };
  } catch (e) {
    const problem = e instanceof ShopifyNotConnected ? "not-connected" : e instanceof Error ? e.message : "Unknown error";
    return { user, store, location: null, rows: [] as ReorderRow[], refreshedAt: null, problem };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const form = await request.formData();
  const variantId = String(form.get("variantId") ?? "");
  if (!variantId.startsWith("gid://shopify/ProductVariant/")) return { ok: false };
  const stamp = form.get("stamp");
  const cartonSize = form.get("cartonSize");
  await saveVariantSetting(
    variantId,
    {
      stamp: stamp === "ONTARIO" || stamp === "FEDERAL" ? stamp : undefined,
      cartonSize: cartonSize ? Number(cartonSize) : undefined,
    },
    user.username,
  );
  return { ok: true };
};

// Saving a stamp or carton size shouldn't re-pull all of Shopify.
export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, defaultShouldRevalidate }) =>
  formMethod === "POST" ? false : defaultShouldRevalidate;

type Filter = "needs" | "out" | "all" | "new";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "needs", label: "Needs reorder" },
  { key: "out", label: "Out of stock" },
  { key: "all", label: "All top sellers" },
  { key: "new", label: "New items" },
];

type Override = { stamp?: Stamp; cartonSize?: number };

function useSavedOrder(store: StoreKey) {
  const key = `koi-order-${store}`;
  const [qty, setQty] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      // Saved order lives in this browser only; read it after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQty(JSON.parse(localStorage.getItem(key) ?? "{}"));
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQty({});
    }
  }, [key]);
  const save = (next: Record<string, number>) => {
    setQty(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode: keep it in memory */
    }
  };
  return [qty, save] as const;
}

export default function Reorder() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const fetcher = useFetcher();
  const [filter, setFilter] = useState<Filter>("needs");
  const [over, setOver] = useState<Record<string, Override>>({});
  const [qty, setQty] = useSavedOrder(data.store);
  const loading = nav.state === "loading";

  const rows = useMemo(
    () =>
      data.rows.map((r) => {
        const o = over[r.variantId] ?? {};
        const cartonSize = o.cartonSize ?? r.cartonSize;
        return { ...r, stamp: o.stamp ?? r.stamp, cartonSize, suggestedCartons: cartonsFor(r.needPcs, cartonSize) };
      }),
    [data.rows, over],
  );

  const top = rows.filter((r) => r.kind === "top");
  const fresh = rows.filter((r) => r.kind === "new");
  const out = top.filter((r) => r.status === "OUT");
  const low = top.filter((r) => r.status === "LOW");
  const shown =
    filter === "needs" ? top.filter((r) => r.status !== "OK")
    : filter === "out" ? out
    : filter === "all" ? top
    : fresh;

  const sheet = buildOrderSheet(
    rows
      .filter((r) => (qty[r.variantId] ?? 0) > 0)
      .map((r) => ({ variantId: r.variantId, name: r.name, distributor: r.distributor, stamp: r.stamp, cartons: qty[r.variantId] })),
  );
  const totalCartons = sheet.reduce((n, g) => n + g.cartons, 0);

  const bump = (id: string, d: number) => {
    const n = Math.max(0, (qty[id] ?? 0) + d);
    const next = { ...qty };
    if (n) next[id] = n;
    else delete next[id];
    setQty(next);
  };
  const fillSuggested = () => {
    const next = { ...qty };
    for (const r of shown) if (r.suggestedCartons > 0) next[r.variantId] = r.suggestedCartons;
    setQty(next);
  };
  const saveSetting = (r: ReorderRow, change: Override) => {
    setOver((o) => ({ ...o, [r.variantId]: { ...o[r.variantId], ...change } }));
    const body: Record<string, string> = { variantId: r.variantId };
    if (change.stamp) body.stamp = change.stamp;
    if (change.cartonSize) body.cartonSize = String(change.cartonSize);
    fetcher.submit(body, { method: "post" });
  };

  const storeLabel = STORES.find((s) => s.key === data.store)!.label;

  return (
    <Shell user={data.user}>
      <Hero kicker="発注" title={<>Top sellers to <span className="glow-m">reorder</span></>}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STORES.map((s) => (
            <Link key={s.key} to={`/?store=${s.key}`} className={`ktab${s.key === data.store ? " on" : ""}`} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {s.label}
            </Link>
          ))}
        </div>
        <p className="muted" style={{ margin: "12px 0 0", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <span className="live" />
          {loading ? "Pulling live stock…" : data.refreshedAt ? `Live from Shopify · ${new Date(data.refreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not connected"}
        </p>
      </Hero>

      {data.problem === "not-connected" && (
        <section className="card">
          <h2 className="h" style={{ marginTop: 0 }}>Shopify isn’t connected yet</h2>
          <p className="muted">
            Open the KOI OS app once from your Shopify admin (Apps → KOI OS). That links the store, then refresh this page.
          </p>
        </section>
      )}
      {data.problem && data.problem !== "not-connected" && (
        <section className="card"><p className="err" style={{ margin: 0 }}>Couldn’t load stock: {data.problem}</p></section>
      )}

      {!data.problem && (
        <>
          <div className="tiles">
            <Tile label="Top sellers" value={top.length} tone="glow-c" kanji="売" />
            <Tile label="Out of stock" value={out.length} tone="glow-m" kanji="無" />
            <Tile label="Running low" value={low.length} tone="glow-v" kanji="少" />
            <Tile label="Cartons in order" value={totalCartons} tone="glow-l" kanji="箱" />
          </div>

          <div className="work">
            <section className="card" style={{ minWidth: 0 }}>
              <div className="card-head" style={{ flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {FILTERS.map((f) => (
                    <button key={f.key} type="button" className={`chip${filter === f.key ? " on" : ""}`} onClick={() => setFilter(f.key)}>
                      {f.label}
                      {f.key === "new" && fresh.length > 0 ? ` · ${fresh.length}` : ""}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn primary" onClick={fillSuggested} disabled={!shown.some((r) => r.suggestedCartons > 0)}>
                    Fill suggested
                  </button>
                  <button type="button" className="btn" onClick={() => setQty({})} disabled={totalCartons === 0}>
                    Clear
                  </button>
                </div>
              </div>

              {shown.length === 0 ? (
                <p className="muted" style={{ padding: "20px 4px" }}>
                  {filter === "new" ? "No new items stocked at this store in the last 3 weeks." : `Nothing to reorder for ${storeLabel} right now.`}
                </p>
              ) : (
                <div className="scroll table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Item</th><th>Sold 30d</th><th>Stock</th><th>Days left</th><th>Stamp</th><th>Carton</th><th>Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.variantId}>
                          <td className="mono muted">{r.rank ?? <span className="pill new">NEW</span>}</td>
                          <td style={{ minWidth: 220 }}>
                            <div style={{ fontWeight: 600 }}>{r.name}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{r.distributor}</div>
                          </td>
                          <td className="mono">{r.sold30}</td>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>
                            {r.stock} <StatusPill status={r.status} />
                          </td>
                          <td className="mono">{r.daysLeft === null ? "0" : r.daysLeft >= 99 ? "—" : r.daysLeft}</td>
                          <td>
                            <button
                              type="button"
                              className={`stamp ${r.stamp === "ONTARIO" ? "ont" : "fed"}`}
                              title="Tap to switch stamp"
                              onClick={() => saveSetting(r, { stamp: r.stamp === "ONTARIO" ? "FEDERAL" : "ONTARIO" })}
                            >
                              {r.stamp === "ONTARIO" ? "ONT" : "FED"}
                            </button>
                          </td>
                          <td>
                            <button type="button" className="stamp none" title="Pieces per carton (tap to change)" onClick={() => saveSetting(r, { cartonSize: nextCartonSize(r.cartonSize) })}>
                              {r.cartonSize} pcs
                            </button>
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <button type="button" className="stepper" aria-label="One carton less" onClick={() => bump(r.variantId, -1)}>−</button>
                              <span className="mono qty">{qty[r.variantId] ?? 0}</span>
                              <button type="button" className="stepper" aria-label="One carton more" onClick={() => bump(r.variantId, 1)}>+</button>
                              {r.suggestedCartons > 0 && (
                                <span className="muted mono" style={{ fontSize: 12 }} title="Suggested to cover 2 weeks">
                                  ≈{r.suggestedCartons}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <OrderSheet sheet={sheet} total={totalCartons} store={storeLabel} />
          </div>
        </>
      )}
    </Shell>
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

function StatusPill({ status }: { status: ReorderRow["status"] }) {
  if (status === "OUT") return <span className="pill low">OUT</span>;
  if (status === "LOW") return <span className="pill warn">LOW</span>;
  return <span className="pill ok">OK</span>;
}

function OrderSheet({ sheet, total, store }: { sheet: ReturnType<typeof buildOrderSheet>; total: number; store: string }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `KOI//OS order · ${store}`,
    ...sheet.flatMap((g) => [
      "",
      `${g.distributor}${g.stamp ? ` (${g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout)` : ""}`,
      ...g.lines.map((l) => `  ${l.cartons} ctn  ${l.name}  [${l.stamp === "ONTARIO" ? "ONT" : "FED"}]`),
    ]),
  ].join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <section className="card sheet">
      <div className="card-head">
        <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Order sheet</h2>
        <span className="idx">{total} CTN</span>
      </div>
      {sheet.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>Add cartons with + or Fill suggested. They’re grouped here by distributor.</p>
      ) : (
        <>
          {sheet.map((g) => (
            <div key={g.key} className="sheet-group">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div className="h" style={{ fontWeight: 700 }}>{g.distributor}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {g.cartons} cartons
                    {g.stamp && <> · <span className={g.stamp === "ONTARIO" ? "glow-ont" : "glow-fed"}>{g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout</span></>}
                  </div>
                </div>
                {DISTRIBUTOR_SITES[g.distributor] && (
                  <a className="btn pink" href={DISTRIBUTOR_SITES[g.distributor]} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                    Open site
                  </a>
                )}
              </div>
              <ul className="sheet-lines">
                {g.lines.map((l) => (
                  <li key={l.variantId}>
                    <span className="mono glow-c">{l.cartons}×</span> {l.name}
                    <span className={`stamp ${l.stamp === "ONTARIO" ? "ont" : "fed"}`} style={{ minHeight: 22, padding: "0 8px", marginLeft: 6, fontSize: 10 }}>
                      {l.stamp === "ONTARIO" ? "ONT" : "FED"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {sheet.some((g) => g.stamp) && (
            <p className="muted" style={{ fontSize: 12 }}>GCore Ontario and Federal lines are separate checkouts. Do one, then the other.</p>
          )}
          <button type="button" className="btn" onClick={copy} style={{ width: "100%" }}>
            {copied ? "Copied" : "Copy order sheet"}
          </button>
        </>
      )}
    </section>
  );
}
