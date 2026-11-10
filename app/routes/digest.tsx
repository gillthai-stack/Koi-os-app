// Daily out-of-stock digest: Mississauga and Brampton items at 0 pcs among the top 30 sellers
// and new items, grouped by distributor. Built at 9 AM Toronto (and emailed when Gmail is set up).
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { Hero, Shell } from "../components/Shell";
import { requireUser } from "../lib/auth.server";
import { DIGEST_HOUR } from "../lib/digest";
import { buildLiveDigest, emailConfig, emailDigest, lastSentOn, latestDigest } from "../lib/digest.server";

export const meta: MetaFunction = () => [{ title: "Digest · KOI//OS" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const cfg = emailConfig();
  return { user, digest: await latestDigest(), sentOn: await lastSentOn(), emailTo: cfg?.to ?? null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const intent = String((await request.formData()).get("intent") ?? "");
  const digest = await buildLiveDigest();
  if (intent === "email") {
    if (user.role !== "OWNER") return { ok: false, message: "Only the owner can send the email." };
    try {
      await emailDigest(digest);
      return { ok: true, message: `Sent to ${emailConfig()?.to}.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Couldn't send the email." };
    }
  }
  return { ok: true, message: "Rebuilt from live stock." };
};

const qtyWord = (n: number, unit: "CARTON" | "PIECE") =>
  unit === "PIECE" ? `${n} pc${n === 1 ? "" : "s"}` : `${n} ctn${n === 1 ? "" : "s"}`;

export default function DigestPage() {
  const { user, digest, sentOn, emailTo } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle" ? String(nav.formData?.get("intent") ?? "") : "";

  return (
    <Shell user={user}>
      <Hero kicker="朝報" title={<>Morning <span className="glow-m">out-of-stock</span> digest</>}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Every day at {DIGEST_HOUR} AM: items at 0 pcs among each store’s top 30 sellers and new items, with suggested
          cartons per distributor.
        </p>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
          {emailTo ? `Emailed to ${emailTo}.` : "Email isn’t set up yet, so it’s only shown here."}
          {sentOn ? ` Last daily run: ${sentOn}.` : ""}
        </p>
      </Hero>

      <section className="card">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div className="muted" style={{ fontSize: 13 }}>
            {digest
              ? `Built ${new Date(digest.builtAt).toLocaleString("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : "Not built yet."}
          </div>
          <Form method="post" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" name="intent" value="build" disabled={!!busy}>
              {busy === "build" ? "Pulling live stock…" : "Rebuild now"}
            </button>
            {user.role === "OWNER" && emailTo && (
              <button className="btn" name="intent" value="email" disabled={!!busy}>
                {busy === "email" ? "Sending…" : "Email it now"}
              </button>
            )}
          </Form>
        </div>
        {result && (
          <p className={result.ok ? "muted" : "err"} style={{ margin: "12px 0 0", fontSize: 14 }}>
            {result.message}
          </p>
        )}
      </section>

      {digest?.stores.map((s) => (
        <section className="card" key={s.store}>
          <div className="card-head">
            <h2 className="h" style={{ margin: 0, fontSize: 20 }}>{s.label}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`pill ${s.problem ? "warn" : s.outCount ? "low" : "ok"}`}>
                {s.problem ? "NOT READ" : `${s.outCount} OUT`}
              </span>
              <Link to={`/?store=${s.store}`} className="btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                Order sheet
              </Link>
            </div>
          </div>
          {s.problem ? (
            <p className="err" style={{ marginTop: 12 }}>Couldn’t read stock: {s.problem}</p>
          ) : s.groups.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Nothing out of stock.</p>
          ) : (
            <div className="stack" style={{ marginTop: 12 }}>
              {s.groups.map((g) => (
                <div key={`${g.distributor}|${g.stamp ?? ""}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <strong>
                      {g.distributor}
                      {g.stamp && <span className="muted"> · {g.stamp === "ONTARIO" ? "Ontario" : "Federal"} checkout</span>}
                    </strong>
                    <span className="mono glow-c">{qtyWord(g.qty, g.unit)}</span>
                  </div>
                  <div className="scroll">
                    <table>
                      <tbody>
                        {g.lines.map((l) => (
                          <tr key={l.name + l.stamp}>
                            <td className="mono muted" style={{ width: 48 }}>
                              {l.kind === "new" ? <span className="pill new">NEW</span> : `#${l.rank}`}
                            </td>
                            <td style={{ minWidth: 200 }}>{l.name}</td>
                            <td>
                              <span className={`stamp ${l.stamp === "ONTARIO" ? "ont" : "fed"}`}>{l.stamp === "ONTARIO" ? "ONT" : "FED"}</span>
                            </td>
                            <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{l.sold30} sold 30d</td>
                            <td className="mono" style={{ whiteSpace: "nowrap", textAlign: "right" }}>{qtyWord(l.qty, l.unit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </Shell>
  );
}
