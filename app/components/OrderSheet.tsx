// Order sheet: cartons grouped by distributor. Each group copies a ready-to-paste prompt
// for Claude in Chrome, which fills that distributor's cart in the user's own browser.
import { useState, type ReactNode } from "react";
import { cartQty, type QtyUnit } from "../lib/distributors";
import type { OrderGroup } from "../lib/ordering";
import { orderPrompt } from "../lib/prompt";

export type SheetLineInfo = { cartonSize: number; productUrl: string | null };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function OrderSheet({
  sheet,
  total,
  store,
  siteOf,
  infoOf,
  units,
  onUnit,
  groupActions,
  onRequestCartons,
  emptyText = "Add cartons with + or Fill suggested. They’re grouped here by distributor.",
}: {
  sheet: OrderGroup[];
  total: number;
  store: string;
  siteOf: Map<string, string>;
  infoOf: Map<string, SheetLineInfo>;
  units: Record<string, QtyUnit>;
  onUnit: (distributor: string, unit: QtyUnit) => void;
  /** Extra buttons under each distributor, e.g. marking customer requests as ordered. */
  groupActions?: (g: OrderGroup) => ReactNode;
  /** Change (or with 0, remove) a request line's cartons. */
  onRequestCartons?: (key: string, cartons: number) => void;
  emptyText?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const unitOf = (d: string): QtyUnit => units[d] ?? "CARTON";
  const qtyFor = (g: OrderGroup, l: OrderGroup["lines"][number]) =>
    cartQty(l.cartons, infoOf.get(l.variantId)?.cartonSize ?? 5, unitOf(g.distributor));

  const promptFor = (g: OrderGroup) =>
    orderPrompt({
      distributor: g.distributor,
      siteUrl: siteOf.get(g.distributor) ?? null,
      store,
      unit: unitOf(g.distributor),
      onlyStamp: g.stamp,
      lines: g.lines.map((l) => ({ name: l.name, stamp: l.stamp, qty: qtyFor(g, l), productUrl: infoOf.get(l.variantId)?.productUrl })),
    });

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
  };

  const sheetText = [
    `KOI//OS order · ${store}`,
    ...sheet.flatMap((g) => [
      "",
      `${g.distributor}${g.stamp ? ` (${g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout)` : ""}`,
      ...g.lines.map((l) => `  ${l.cartons} ctn  ${l.name}  [${l.stamp === "ONTARIO" ? "ONT" : "FED"}]`),
    ]),
  ].join("\n");

  return (
    <section className="card sheet">
      <div className="card-head">
        <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Order sheet</h2>
        <span className="idx">{total} CTN</span>
      </div>
      {sheet.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>{emptyText}</p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Copy a distributor’s prompt, open their site in Chrome, and paste it into Claude in Chrome. It fills the cart; you check out.
          </p>
          {sheet.map((g) => {
            const site = siteOf.get(g.distributor);
            const unit = unitOf(g.distributor);
            const prompt = promptFor(g);
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

                <ul className="sheet-lines">
                  {g.lines.filter((l) => !l.request).map((l) => (
                    <li key={l.variantId}>
                      <div>
                        <span className="mono glow-c">{l.cartons}×</span> {l.name}
                        <StampTag stamp={l.stamp} />
                        {unit === "PIECE" && <span className="muted mono" style={{ fontSize: 11 }}> = {qtyFor(g, l)} pcs</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {g.lines.some((l) => l.request) && (
                  <div className="sheet-requests">
                    <div className="kicker" style={{ fontSize: 11 }}>Requests</div>
                    <ul className="sheet-lines">
                      {g.lines.filter((l) => l.request).map((l) => (
                        <li key={l.variantId}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {onRequestCartons ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <button type="button" className="stepper mini" aria-label="One carton less" onClick={() => onRequestCartons(l.request!.key, l.cartons - 1)}>−</button>
                                <span className="mono glow-c">{l.cartons}×</span>
                                <button type="button" className="stepper mini" aria-label="One carton more" onClick={() => onRequestCartons(l.request!.key, l.cartons + 1)}>+</button>
                              </span>
                            ) : (
                              <span className="mono glow-c">{l.cartons}×</span>
                            )}
                            <span>{l.name}</span>
                            <StampTag stamp={l.stamp} />
                            {unit === "PIECE" && <span className="muted mono" style={{ fontSize: 11 }}>= {qtyFor(g, l)} pcs</span>}
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            For {l.request!.customers.join(", ")} · {l.request!.codes.join(", ")}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn pink"
                    style={{ flex: 1 }}
                    onClick={async () => {
                      if (await copyText(prompt)) flash(g.key);
                      else setOpen(g.key);
                    }}
                  >
                    {copied === g.key ? "Copied. Paste into Claude" : "Copy Claude prompt"}
                  </button>
                  <button type="button" className="btn" onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key}>
                    {open === g.key ? "Hide" : "View"}
                  </button>
                </div>
                {open === g.key && (
                  <textarea className="field prompt-box" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} />
                )}
                {groupActions?.(g)}
              </div>
            );
          })}
          {sheet.some((g) => g.stamp) && (
            <p className="muted" style={{ fontSize: 12 }}>GCore Ontario and Federal are separate prompts and checkouts. Do one, check out, then the other.</p>
          )}
          <button
            type="button"
            className="btn"
            onClick={async () => {
              if (await copyText(sheetText)) flash("sheet");
            }}
            style={{ width: "100%" }}
          >
            {copied === "sheet" ? "Copied" : "Copy order sheet"}
          </button>
        </>
      )}
    </section>
  );
}

function StampTag({ stamp }: { stamp: OrderGroup["lines"][number]["stamp"] }) {
  return (
    <span className={`stamp ${stamp === "ONTARIO" ? "ont" : "fed"}`} style={{ minHeight: 22, padding: "0 8px", marginLeft: 6, fontSize: 10 }}>
      {stamp === "ONTARIO" ? "ONT" : "FED"}
    </span>
  );
}
