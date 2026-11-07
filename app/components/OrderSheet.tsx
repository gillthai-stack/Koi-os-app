// Order sheet: cartons grouped by distributor, with Add to cart through the KOI//OS Cart extension.
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { canFillCart, cartPageFor, cartQty, platformFor, type QtyUnit } from "../lib/distributors";
import type { OrderGroup } from "../lib/ordering";

export type SheetLineInfo = { cartonSize: number; productUrl: string | null };

type LineResult = { ok: boolean; message?: string };
type JobState = { done: number; total: number; results: Record<string, LineResult>; finished: boolean; error?: string };

/** Listens for the KOI//OS Cart extension and relays its progress. */
function useCartExtension() {
  const [version, setVersion] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "koi-cart") return;
      if (m.type === "READY") setVersion(String(m.version ?? "1"));
      if (m.type === "PROGRESS")
        setJobs((j) => {
          const cur = j[m.key] ?? { done: 0, total: m.total, results: {}, finished: false };
          return { ...j, [m.key]: { ...cur, done: m.done, total: m.total, results: { ...cur.results, [m.variantId]: { ok: m.ok, message: m.message } } } };
        });
      if (m.type === "DONE")
        setJobs((j) => ({ ...j, [m.key]: { ...(j[m.key] ?? { done: 0, total: 0, results: {} }), finished: true, error: m.error } }));
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "koi-os", type: "PING" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const start = (job: { key: string } & Record<string, unknown>) => {
    setJobs((j) => ({ ...j, [job.key]: { done: 0, total: (job.lines as unknown[]).length, results: {}, finished: false } }));
    window.postMessage({ source: "koi-os", type: "FILL_CART", job }, window.location.origin);
  };
  return { ready: version !== null, jobs, start };
}

export function OrderSheet({
  sheet,
  total,
  store,
  siteOf,
  infoOf,
  units,
  onUnit,
  onProductUrl,
}: {
  sheet: OrderGroup[];
  total: number;
  store: string;
  siteOf: Map<string, string>;
  infoOf: Map<string, SheetLineInfo>;
  units: Record<string, QtyUnit>;
  onUnit: (distributor: string, unit: QtyUnit) => void;
  onProductUrl: (variantId: string, url: string) => void;
}) {
  const ext = useCartExtension();
  const [copied, setCopied] = useState(false);
  const unitOf = (d: string): QtyUnit => units[d] ?? "CARTON";
  const qtyFor = (g: OrderGroup, l: OrderGroup["lines"][number]) =>
    cartQty(l.cartons, infoOf.get(l.variantId)?.cartonSize ?? 5, unitOf(g.distributor));

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

  const fill = (g: OrderGroup) => {
    const site = siteOf.get(g.distributor);
    if (!site) return;
    const lines = g.lines
      .filter((l) => infoOf.get(l.variantId)?.productUrl)
      .map((l) => ({ variantId: l.variantId, name: l.name, url: infoOf.get(l.variantId)!.productUrl!, qty: qtyFor(g, l) }));
    ext.start({ key: g.key, distributor: g.distributor, stamp: g.stamp, platform: platformFor(site), cartUrl: cartPageFor(site), lines });
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
          {!ext.ready && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              To fill distributor carts for you, install the{" "}
              <a href="/extension">KOI//OS Cart extension</a> (one time, in Chrome).
            </p>
          )}
          {sheet.map((g) => {
            const site = siteOf.get(g.distributor);
            const fillable = !!site && canFillCart(site);
            const unit = unitOf(g.distributor);
            const linkedCount = g.lines.filter((l) => infoOf.get(l.variantId)?.productUrl).length;
            const job = ext.jobs[g.key];
            const running = job && !job.finished;
            return (
              <div key={g.key} className="sheet-group">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="h" style={{ fontWeight: 700 }}>{g.distributor}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {g.cartons} cartons
                      {g.stamp && (
                        <>
                          {" · "}
                          <span className={g.stamp === "ONTARIO" ? "glow-ont" : "glow-fed"}>
                            {g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {site && (
                    <a className="btn" href={site} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", flex: "none" }}>
                      Open site
                    </a>
                  )}
                </div>

                {fillable && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: 12 }}>Site counts</span>
                    {(["CARTON", "PIECE"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        className={`chip${unit === u ? " on" : ""}`}
                        style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
                        onClick={() => unit !== u && onUnit(g.distributor, u)}
                      >
                        {u === "CARTON" ? "Cartons" : "Pieces"}
                      </button>
                    ))}
                  </div>
                )}

                <ul className="sheet-lines">
                  {g.lines.map((l) => {
                    const info = infoOf.get(l.variantId);
                    const r = job?.results[l.variantId];
                    return (
                      <li key={l.variantId}>
                        <div>
                          {r && <span className={r.ok ? "glow-l" : "glow-m"} title={r.message}>{r.ok ? "✓ " : "✗ "}</span>}
                          <span className="mono glow-c">{l.cartons}×</span> {l.name}
                          <span className={`stamp ${l.stamp === "ONTARIO" ? "ont" : "fed"}`} style={{ minHeight: 22, padding: "0 8px", marginLeft: 6, fontSize: 10 }}>
                            {l.stamp === "ONTARIO" ? "ONT" : "FED"}
                          </span>
                          {unit === "PIECE" && <span className="muted mono" style={{ fontSize: 11 }}> = {qtyFor(g, l)} pcs</span>}
                        </div>
                        {r && !r.ok && r.message && <div className="err" style={{ fontSize: 12 }}>{r.message}</div>}
                        {fillable && !info?.productUrl && <ProductLinkForm variantId={l.variantId} onSaved={onProductUrl} />}
                      </li>
                    );
                  })}
                </ul>

                {fillable && (
                  <button
                    type="button"
                    className="btn pink"
                    style={{ width: "100%", marginTop: 10 }}
                    disabled={!ext.ready || linkedCount === 0 || !!running}
                    onClick={() => fill(g)}
                    title={!ext.ready ? "Install the KOI//OS Cart extension first" : undefined}
                  >
                    {running
                      ? `Adding ${job.done}/${job.total}…`
                      : linkedCount === 0
                        ? "Paste item links above to add to cart"
                        : `Add ${linkedCount === g.lines.length ? "all" : `${linkedCount} of ${g.lines.length}`} to ${g.distributor} cart`}
                  </button>
                )}
                {job?.finished && (
                  <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                    {job.error ??
                      `${Object.values(job.results).filter((x) => x.ok).length} of ${job.total} added. The cart is open in a new tab; check it before checkout.`}
                  </p>
                )}
              </div>
            );
          })}
          {sheet.some((g) => g.stamp) && (
            <p className="muted" style={{ fontSize: 12 }}>GCore Ontario and Federal lines are separate checkouts. Fill and check out one, then the other.</p>
          )}
          <button type="button" className="btn" onClick={copy} style={{ width: "100%" }}>
            {copied ? "Copied" : "Copy order sheet"}
          </button>
        </>
      )}
    </section>
  );
}

function ProductLinkForm({ variantId, onSaved }: { variantId: string; onSaved: (variantId: string, url: string) => void }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; variantId?: string; productUrl?: string }>();
  const res = fetcher.data;
  useEffect(() => {
    if (res?.ok && res.variantId === variantId && res.productUrl) onSaved(variantId, res.productUrl);
  }, [res, variantId, onSaved]);
  return (
    <fetcher.Form method="post" className="inline-form" style={{ marginTop: 6 }}>
      <input type="hidden" name="intent" value="product" />
      <input type="hidden" name="variantId" value={variantId} />
      <input className="field" name="url" placeholder="Paste item page link" inputMode="url" required style={{ minHeight: 34, fontSize: 12, flex: "1 1 120px" }} />
      <button className="btn" type="submit" style={{ minHeight: 34 }} disabled={fetcher.state !== "idle"}>
        Save
      </button>
      {res && !res.ok && res.error && <span className="err" style={{ fontSize: 12 }}>{res.error}</span>}
    </fetcher.Form>
  );
}
