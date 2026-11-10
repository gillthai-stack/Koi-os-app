// Requests page, after ordering: "Ready to text" drafts a pickup text per customer that sends with one tap,
// and "Match an invoice" moves requests to On the way or Ready from the lines on an invoice.
import { useState } from "react";
import { useFetcher } from "react-router";
import { DISTRIBUTOR_SITES } from "../lib/distributors";
import { pickupText, smsHref } from "../lib/pickup";

type ReadyRow = { id: number; code: string; customer: string; phone: string | null; product: string; store: string; qtyWanted: number | null };

export function ReadyToText({ rows }: { rows: ReadyRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Ready to text · {rows.length}</h2>
          <div className="muted" style={{ fontSize: 12 }}>
            Set aside and waiting for a text. Send opens Messages with the text filled in, and marks the request Notified – holding.
          </div>
        </div>
      </div>
      <div className="stack">
        {rows.map((r) => (
          <TextRow key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function TextRow({ r }: { r: ReadyRow }) {
  const fetcher = useFetcher<{ sheetError?: string | null }>();
  const [text, setText] = useState(() => pickupText(r));
  const [copied, setCopied] = useState(false);
  const href = smsHref(r.phone, text);
  const done = () => fetcher.submit({ intent: "texted", id: String(r.id) }, { method: "post", action: "/requests" });
  if (fetcher.state !== "idle" || (fetcher.data && !fetcher.data.sheetError)) {
    return <p className="muted" style={{ margin: 0 }}>{r.code} {r.customer}: texted, now Notified – holding.</p>;
  }
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10 }}>
      <div style={{ flex: "1 1 170px", minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          <span className="mono muted" style={{ fontSize: 12 }}>{r.code}</span> {r.customer}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{r.product}</div>
        <div className="mono muted" style={{ fontSize: 12 }}>{r.phone ?? "No phone number"}</div>
      </div>
      <textarea
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={`Text to ${r.customer}`}
        rows={2}
        style={{ flex: "3 1 280px", minHeight: 60, resize: "vertical", padding: 8 }}
      />
      <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
        {href ? (
          <a className="btn primary" href={href} onClick={done} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Send text
          </a>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            {copied ? "Copied" : "Copy text"}
          </button>
        )}
        <button type="button" className="btn" onClick={done} title="Already told them another way">
          Mark texted
        </button>
      </div>
      {fetcher.data?.sheetError && <p className="err" style={{ flexBasis: "100%", margin: 0 }}>Saved here, but not on the sheet: {fetcher.data.sheetError}</p>}
    </div>
  );
}

type Preview = { matches: { id: number; code: string; customer: string; product: string; status: string; line: string }[] };
type Applied = { moved: { id: number; code: string; customer: string; to: string }[]; sheetError: string | null };

export function MatchInvoice({ store }: { store: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState("");
  const [distributor, setDistributor] = useState("");
  const [stage, setStage] = useState<"shipped" | "delivered">("delivered");
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const preview = useFetcher<Preview & { error?: string }>();
  const apply = useFetcher<Applied & { error?: string }>();
  const body = { store, lines, distributor, stage };
  const matches = lines.trim() ? (preview.data?.matches ?? null) : null;
  const picked = (matches ?? []).filter((m) => !skip.has(m.id));

  return (
    <section className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Match an invoice</h2>
          <div className="muted" style={{ fontSize: 12 }}>Paste an invoice or shipping email’s item lines to move the requests they fill.</div>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Paste invoice"}</button>
      </div>
      {open && (
        <div className="stack">
          <textarea
            className="field prompt-box"
            value={lines}
            onChange={(e) => {
              setLines(e.target.value);
              setSkip(new Set());
            }}
            placeholder={"One item per line, e.g.\n3 x Ripper X 75K Classico Ice (Ontario Stamp)"}
          />
          <div className="inline-form">
            <input className="field" value={distributor} onChange={(e) => setDistributor(e.target.value)} list="inv-distros" placeholder="Distributor (optional)" style={{ flex: "1 1 180px" }} />
            <datalist id="inv-distros">
              {Object.keys(DISTRIBUTOR_SITES).map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <button type="button" className={`chip${stage === "shipped" ? " on" : ""}`} onClick={() => setStage("shipped")}>Shipped → On the way</button>
            <button type="button" className={`chip${stage === "delivered" ? " on" : ""}`} onClick={() => setStage("delivered")}>Arrived → Ready – set aside</button>
            <button
              type="button"
              className="btn"
              disabled={!lines.trim() || preview.state !== "idle"}
              onClick={() => preview.submit({ intent: "invoice-preview", ...body }, { method: "post", action: "/requests" })}
            >
              Find requests
            </button>
          </div>
          {preview.data?.error && <p className="err">{preview.data.error}</p>}
          {matches && matches.length === 0 && <p className="muted">No open requests match these lines.</p>}
          {matches && matches.length > 0 && (
            <>
              <div className="scroll table-wrap">
                <table>
                  <thead>
                    <tr><th /><th>ID</th><th>Customer</th><th>Requested</th><th>Invoice line</th><th>Now</th></tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!skip.has(m.id)}
                            aria-label={`Move ${m.code}`}
                            onChange={(e) => {
                              const s = new Set(skip);
                              if (e.target.checked) s.delete(m.id);
                              else s.add(m.id);
                              setSkip(s);
                            }}
                          />
                        </td>
                        <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{m.code}</td>
                        <td>{m.customer}</td>
                        <td>{m.product}</td>
                        <td className="muted">{m.line}</td>
                        <td className="muted">{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={!picked.length || apply.state !== "idle"}
                onClick={() => {
                  apply.submit({ intent: "invoice-apply", ...body, ids: picked.map((m) => m.id).join(",") }, { method: "post", action: "/requests" });
                  // Start over with an empty box for the next invoice.
                  setLines("");
                }}
              >
                Move {picked.length} to {stage === "shipped" ? "On the way" : "Ready – set aside"}
              </button>
            </>
          )}
          {apply.data?.moved && (
            <p className="glow-l" style={{ fontSize: 14, margin: 0 }}>
              Moved {apply.data.moved.length} request{apply.data.moved.length === 1 ? "" : "s"} to {stage === "shipped" ? "On the way" : "Ready – set aside"}
              {stage === "delivered" && apply.data.moved.length ? ". Their texts are in Ready to text." : "."}
            </p>
          )}
          {apply.data?.sheetError && <p className="err">Saved here, but not on the sheet: {apply.data.sheetError}</p>}
        </div>
      )}
    </section>
  );
}
