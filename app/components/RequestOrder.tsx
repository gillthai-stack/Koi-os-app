// "To order" view on the Requests page: pick how many cartons to order for each requested item,
// then send them to the Reorder page, where they join that distributor's order and Claude prompt.
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import type { Stamp } from "../lib/ordering";
import type { RequestOrderLine } from "../lib/requests";

export function RequestOrder({
  lines,
  store,
  storeLabel,
  queued,
  onClose,
}: {
  lines: RequestOrderLine[];
  store: string;
  storeLabel: string;
  /** Cartons already sent to Reorder, by line key. */
  queued: Record<string, { cartons: number; stamp: Stamp }>;
  onClose: () => void;
}) {
  const busy = useNavigation().state !== "idle";
  // Start from what's already on Reorder, else one carton; 0 leaves a line out.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [stamps, setStamps] = useState<Record<string, Stamp>>({});
  const qty = (l: RequestOrderLine) => picked[l.key] ?? queued[l.key]?.cartons ?? 1;
  const stampOf = (l: RequestOrderLine) => stamps[l.key] ?? queued[l.key]?.stamp ?? l.stamp;
  const bump = (l: RequestOrderLine, d: number) => setPicked((m) => ({ ...m, [l.key]: Math.max(0, qty(l) + d) }));

  const payload = lines.map((l) => ({
    key: l.key,
    name: l.name,
    distributor: l.distributor,
    stamp: stampOf(l),
    cartons: qty(l),
    requestIds: l.requestIds,
  }));
  const chosen = payload.filter((l) => l.cartons > 0);
  const perDistro = new Map<string, number>();
  for (const l of chosen) perDistro.set(l.distributor, (perDistro.get(l.distributor) ?? 0) + l.cartons);

  return (
    <div className="work">
      <section className="card" style={{ minWidth: 0 }}>
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 className="h" style={{ margin: 0, fontSize: 18 }}>To order · {storeLabel}</h2>
            <div className="muted" style={{ fontSize: 12 }}>Pick cartons for each item, then send them to Reorder.</div>
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
                  <th>Item</th><th>Wanted</th><th>Stamp</th><th>Cartons</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const stamp = stampOf(l);
                  return (
                    <tr key={l.key}>
                      <td style={{ minWidth: 220 }}>
                        <div style={{ fontWeight: 600 }}>
                          {l.name}
                          {queued[l.key] && <span className="pill ok" style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px" }}>ON REORDER</span>}
                        </div>
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
                          <button type="button" className="stepper" aria-label="One carton less" onClick={() => bump(l, -1)}>−</button>
                          <span className="mono qty">{qty(l)}</span>
                          <button type="button" className="stepper" aria-label="One carton more" onClick={() => bump(l, 1)}>+</button>
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

      <section className="card sheet">
        <div className="card-head">
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Send to Reorder</h2>
          <span className="idx">{chosen.reduce((n, l) => n + l.cartons, 0)} CTN</span>
        </div>
        {perDistro.size === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>Set cartons with + for the items you want to order.</p>
        ) : (
          <ul className="sheet-lines">
            {[...perDistro.entries()].map(([d, n]) => (
              <li key={d}>
                <span className="mono glow-c">{n}×</span> {d}
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          They’ll show under “Requests” in each distributor on the Reorder order sheet and go into that distributor’s Claude prompt.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="queue" />
          <input type="hidden" name="store" value={store} />
          <input type="hidden" name="lines" value={JSON.stringify(payload)} />
          <button className="btn primary" type="submit" disabled={busy || lines.length === 0} style={{ width: "100%" }}>
            {busy ? "Sending…" : "Send to Reorder"}
          </button>
        </Form>
      </section>
    </div>
  );
}
