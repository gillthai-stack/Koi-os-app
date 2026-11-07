// KOI//OS reorder page: top 30 sellers per store, filtered to what needs ordering,
// with an order sheet grouped by distributor (GCore split by stamp).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction, ShouldRevalidateFunction } from "react-router";
import { Link, useFetcher, useLoaderData, useNavigation } from "react-router";
import { Hero, Shell } from "../../components/Shell";
import { OrderSheet, type SheetLineInfo } from "../../components/OrderSheet";
import prisma from "../../db.server";
import { requireUser } from "../../lib/auth.server";
import { DISTRIBUTOR_SITES, hostOf, type QtyUnit } from "../../lib/distributors";
import { STORES, buildOrderSheet, cartonsFor, type Stamp, type StoreKey } from "../../lib/ordering";
import {
  ShopifyNotConnected,
  cleanSiteUrl,
  loadReorderTable,
  saveDistributorLink,
  saveProductUrl,
  saveQtyUnit,
  saveVariantSetting,
  type ReorderRow,
} from "../../lib/stock.server";

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
    return { user, store, location: null, rows: [] as ReorderRow[], units: {} as Record<string, QtyUnit>, refreshedAt: null, problem };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "link") {
    const vendor = String(form.get("vendor") ?? "").trim();
    const distributor = String(form.get("distributor") ?? "").trim() || vendor;
    const url = cleanSiteUrl(String(form.get("url") ?? ""));
    if (!vendor || !url) return { ok: false, error: "Add a working website link." };
    await saveDistributorLink(vendor, distributor, url, user.username);
    return { ok: true, vendor, distributor, url };
  }
  if (form.get("intent") === "unit") {
    const distributor = String(form.get("distributor") ?? "").trim();
    const unit = form.get("unit") === "PIECE" ? "PIECE" : "CARTON";
    if (!distributor) return { ok: false };
    await saveQtyUnit(distributor, unit, user.username);
    return { ok: true };
  }
  const variantId = String(form.get("variantId") ?? "");
  if (!variantId.startsWith("gid://shopify/ProductVariant/")) return { ok: false };
  if (form.get("intent") === "product") {
    const productUrl = cleanSiteUrl(String(form.get("url") ?? ""));
    const known = productUrl && (Object.values(DISTRIBUTOR_SITES).some((u) => hostOf(u) === hostOf(productUrl)) || (await knownSite(productUrl)));
    if (!productUrl || !known) {
      return { ok: false, error: "That link isn't on a distributor site we know." };
    }
    await saveProductUrl(variantId, productUrl, user.username);
    return { ok: true, variantId, productUrl };
  }
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

async function knownSite(url: string): Promise<boolean> {
  const links = await prisma.distributorLink.findMany({ select: { url: true } });
  return links.some((l) => hostOf(l.url) === hostOf(url));
}

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
type LinkOverride = { distributor: string; url: string };

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
  const [linked, setLinked] = useState<Record<string, LinkOverride>>({});
  const [unitOver, setUnitOver] = useState<Record<string, QtyUnit>>({});
  const onUnit = (distributor: string, unit: QtyUnit) => {
    setUnitOver((m) => ({ ...m, [distributor]: unit }));
    fetcher.submit({ intent: "unit", distributor, unit }, { method: "post" });
  };
  const [qty, setQty] = useSavedOrder(data.store);
  const loading = nav.state === "loading";

  const rows = useMemo(
    () =>
      data.rows.map((r) => {
        const o = over[r.variantId] ?? {};
        const cartonSize = o.cartonSize ?? r.cartonSize;
        const link = linked[r.vendor];
        return {
          ...r,
          stamp: o.stamp ?? r.stamp,
          cartonSize,
          suggestedCartons: cartonsFor(r.needPcs, cartonSize),
          distributor: link?.distributor ?? r.distributor,
          siteUrl: link?.url ?? r.siteUrl,
        };
      }),
    [data.rows, over, linked],
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
  const siteOf = new Map(rows.filter((r) => r.siteUrl).map((r) => [r.distributor, r.siteUrl as string]));
  const infoOf = new Map<string, SheetLineInfo>(rows.map((r) => [r.variantId, { cartonSize: r.cartonSize, productUrl: r.productUrl }]));
  const units: Record<string, QtyUnit> = { ...data.units, ...unitOver };

  // Vendors with something to order but no ordering site yet: ask for one.
  const unlinked = new Map<string, number>();
  for (const r of rows) {
    const wanted = (r.kind === "top" && r.status !== "OK") || (qty[r.variantId] ?? 0) > 0;
    if (wanted && !r.siteUrl) unlinked.set(r.vendor, (unlinked.get(r.vendor) ?? 0) + 1);
  }

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
          {unlinked.size > 0 && (
            <section className="card on-note">
              <div className="card-head">
                <h2 className="h" style={{ margin: 0, fontSize: 18 }}>
                  Where do these come from?
                </h2>
                <span className="idx">{unlinked.size} TO LINK</span>
              </div>
              <p className="muted" style={{ fontSize: 14 }}>
                These need reordering but have no distributor site linked. Add where you order them and it’s saved for everyone.
              </p>
              <div className="stack">
                {[...unlinked.entries()].map(([vendor, count]) => (
                  <LinkForm key={vendor} vendor={vendor} count={count} onSaved={(l) => setLinked((m) => ({ ...m, [vendor]: l }))} />
                ))}
              </div>
            </section>
          )}

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
                        <th>#</th><th>Item</th><th>Sold 30d</th><th>Stock</th><th>Days left</th><th>Stamp</th><th>Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.variantId}>
                          <td className="mono muted">{r.rank ?? <span className="pill new">NEW</span>}</td>
                          <td style={{ minWidth: 220 }}>
                            <div style={{ fontWeight: 600 }}>{r.name}</div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {r.distributor}
                              {!r.siteUrl && <span className="pill warn" style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px" }}>NO DISTRO LINK</span>}
                            </div>
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

            <OrderSheet
              sheet={sheet}
              total={totalCartons}
              store={storeLabel}
              siteOf={siteOf}
              infoOf={infoOf}
              units={units}
              onUnit={onUnit}
            />
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

function LinkForm({ vendor, count, onSaved }: { vendor: string; count: number; onSaved: (l: LinkOverride) => void }) {
  const fetcher = useFetcher<typeof action>();
  const res = fetcher.data;
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!res || handled.current === res) return;
    handled.current = res;
    if ("url" in res && res.url && res.vendor === vendor) onSaved({ distributor: res.distributor, url: res.url });
  }, [res, vendor, onSaved]);
  return (
    <fetcher.Form method="post" className="inline-form sheet-group">
      <input type="hidden" name="intent" value="link" />
      <input type="hidden" name="vendor" value={vendor} />
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{vendor}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {count} item{count === 1 ? "" : "s"} to order
        </div>
      </div>
      <input className="field" name="distributor" list="koi-distros" placeholder="Distributor (e.g. Valor Distributions)" defaultValue={vendor} />
      <input className="field" name="url" placeholder="Ordering site link" inputMode="url" required />
      <button className="btn primary" type="submit" disabled={fetcher.state !== "idle"}>
        {fetcher.state !== "idle" ? "Saving…" : "Save"}
      </button>
      {res && "error" in res && res.error && <p className="err" style={{ flexBasis: "100%" }}>{res.error}</p>}
      <datalist id="koi-distros">
        {Object.keys(DISTRIBUTOR_SITES).map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </fetcher.Form>
  );
}
