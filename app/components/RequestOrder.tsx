// "To order" view on the Requests page: open requests grouped by distributor, with the same
// order sheet and Claude prompts as Reorder, and a button to mark each distributor's requests ordered.
import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { QtyUnit } from "../lib/distributors";
import { buildOrderSheet, type Stamp } from "../lib/ordering";
import type { RequestOrderLine } from "../lib/requests";
import { OrderSheet, type SheetLineInfo } from "./OrderSheet";

export function RequestOrder({
  lines,
  store,
  storeLabel,
  siteOf,
  units: savedUnits,
  onClose,
}: {
  lines: RequestOrderLine[];
  store: string;
  storeLabel: string;
  siteOf: Map<string, string>;
  units: Record<string, QtyUnit>;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  // One carton of each to start; set a line to 0 to leave it out.
  const [picked, setQty] = useState<Record<string, number>>({});
  const qty = (key: string) => picked[key] ?? 1;
  const [stamps, setStamps] = useState<Record<string, Stamp>>({});
  const [unitOver, setUnitOver] = useState<Record<string, QtyUnit>>({});
  const units = { ...savedUnits, ...unitOver };
  const stampOf = (l: RequestOrderLine) => stamps[l.key] ?? l.stamp;
  const byKey = useMemo(() => new Map(lines.map((l) => [l.key, l])), [lines]);

  const sheet = buildOrderSheet(
    lines.map((l) => ({ variantId: l.key, name: l.name, distributor: l.distributor, stamp: stampOf(l), cartons: qty(l.key) })),
  );
  const total = sheet.reduce((n, g) => n + g.cartons, 0);
  const infoOf = new Map<string, SheetLineInfo>(lines.map((l) => [l.key, { cartonSize: 5, productUrl: null }]));
  const bump = (key: string, d: number) => setQty((q) => ({ ...q, [key]: Math.max(0, (q[key] ?? 1) + d) }));
  const onUnit = (distributor: string, unit: QtyUnit) => {
    setUnitOver((m) => ({ ...m, [distributor]: unit }));
    fetcher.submit({ intent: "unit", store, distributor, unit }, { method: "post" });
  };

  return (
    <div className="work">
      <section className="card" style={{ minWidth: 0 }}>
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Order for requests · {storeLabel}</h2>
            <div className="muted" style={{ fontSize: 12 }}>New, Needs info, Order on request and Waiting on stock</div>
          </div>
          <button type="button" className="btn" onClick={onClose}>Back to list</button>
        </div>
        {lines.length === 0 ? (
          <p className="muted" style={{ padding: "20px 4px" }}>No requests waiting to be ordered.</p>
        ) : (
          <div className="scroll table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th><th>Wanted</th><th>Stamp</th><th>Order</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const stamp = stampOf(l);
                  return (
                    <tr key={l.key}>
                      <td style={{ minWidth: 220 }}>
                        <div style={{ fontWeight: 600 }}>{l.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {l.distributor === "No distributor" ? <span className="pill warn" style={{ fontSize: 10, padding: "1px 6px" }}>NO DISTRIBUTOR</span> : l.distributor}
                          {" · "}
                          {l.customers.join(", ")} <span className="mono">({l.codes.join(", ")})</span>
                        </div>
                      </td>
                      <td className="mono">{l.wanted} pcs</td>
                      <td>
                        <button
                          type="button"
                          className={`stamp ${stamp === "ONTARIO" ? "ont" : "fed"}`}
                          title="Tap to switch stamp"
                          onClick={() => setStamps((m) => ({ ...m, [l.key]: stamp === "ONTARIO" ? "FEDERAL" : "ONTARIO" }))}
                        >
                          {stamp === "ONTARIO" ? "ONT" : "FED"}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button type="button" className="stepper" aria-label="One carton less" onClick={() => bump(l.key, -1)}>−</button>
                          <span className="mono qty">{qty(l.key)}</span>
                          <button type="button" className="stepper" aria-label="One carton more" onClick={() => bump(l.key, 1)}>+</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OrderSheet
        sheet={sheet}
        total={total}
        store={storeLabel}
        siteOf={siteOf}
        infoOf={infoOf}
        units={units}
        onUnit={onUnit}
        emptyText="Set cartons with + to build the order. It’s grouped here by distributor."
        groupActions={(g) => <MarkOrdered ids={g.lines.flatMap((l) => byKey.get(l.variantId)?.requestIds ?? [])} store={store} />}
      />
    </div>
  );
}

function MarkOrdered({ ids, store }: { ids: number[]; store: string }) {
  const fetcher = useFetcher<{ ok?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" style={{ marginTop: 8 }}>
      <input type="hidden" name="intent" value="ordered" />
      <input type="hidden" name="store" value={store} />
      <input type="hidden" name="ids" value={ids.join(",")} />
      <button className="btn" type="submit" disabled={busy || !ids.length} style={{ width: "100%" }}>
        {busy ? "Saving…" : `Checked out · mark ${ids.length} request${ids.length === 1 ? "" : "s"} Ordered`}
      </button>
    </fetcher.Form>
  );
}
