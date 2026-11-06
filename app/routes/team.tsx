// Owner-only: create staff logins, reset passwords, turn access off.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { Hero, Shell } from "../components/Shell";
import { checkNewUser, cleanUsername, hashPassword, requireOwner } from "../lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Team · KOI//OS" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireOwner(request);
  const people = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
    select: { id: true, username: true, displayName: true, role: true, active: true },
  });
  return { user, people };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const me = await requireOwner(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = Number(form.get("id"));

  if (intent === "create") {
    const username = cleanUsername(form.get("username"));
    const password = String(form.get("password") ?? "");
    const displayName = String(form.get("displayName") ?? "").trim() || username;
    const role = form.get("role") === "OWNER" ? "OWNER" : "STAFF";
    const problem = checkNewUser(username, password);
    if (problem) return { error: problem };
    if (await prisma.user.findUnique({ where: { username } })) return { error: `"${username}" is taken.` };
    await prisma.user.create({ data: { username, displayName, role, passwordHash: await hashPassword(password) } });
    return { ok: `Added ${displayName}. They log in as "${username}".` };
  }

  if (intent === "reset") {
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return { error: "Password needs at least 8 characters." };
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    return { ok: "Password changed." };
  }

  if (intent === "toggle") {
    if (id === me.id) return { error: "You can't turn off your own login." };
    const u = await prisma.user.findUnique({ where: { id } });
    if (u) await prisma.user.update({ where: { id }, data: { active: !u.active } });
    return { ok: u?.active ? `${u.displayName} can no longer log in.` : `${u?.displayName} can log in again.` };
  }
  return { error: "Unknown action." };
};

export default function Team() {
  const { user, people } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  return (
    <Shell user={user}>
      <Hero kicker="チーム" title={<>Team <span className="glow-c">logins</span></>}>
        <p className="muted" style={{ margin: 0 }}>Give each staff member their own username and password.</p>
      </Hero>

      {data && "error" in data && <p className="err">{data.error}</p>}
      {data && "ok" in data && <p className="okmsg">{data.ok}</p>}

      <section className="card">
        <div className="card-head">
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Add a person</h2>
        </div>
        <Form method="post" className="inline-form" style={{ marginTop: 14 }}>
          <input type="hidden" name="intent" value="create" />
          <input className="field" name="displayName" placeholder="Name" required />
          <input className="field" name="username" placeholder="Username" autoCapitalize="none" required />
          <input className="field" name="password" type="text" placeholder="Starting password" autoComplete="off" required />
          <select className="field" name="role" defaultValue="STAFF" style={{ flex: "0 1 140px" }}>
            <option value="STAFF">Staff</option>
            <option value="OWNER">Owner</option>
          </select>
          <button className="btn primary" type="submit">Add</button>
        </Form>
      </section>

      <section className="card">
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th>New password</th><th /></tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                  <td>{p.displayName}</td>
                  <td className="mono">{p.username}</td>
                  <td><span className={`pill ${p.role === "OWNER" ? "top" : "ship"}`}>{p.role === "OWNER" ? "Owner" : "Staff"}</span></td>
                  <td>
                    <Form method="post" className="inline-form">
                      <input type="hidden" name="intent" value="reset" />
                      <input type="hidden" name="id" value={p.id} />
                      <input className="field" name="password" placeholder="New password" autoComplete="off" required style={{ flex: "1 1 140px" }} />
                      <button className="btn" type="submit">Set</button>
                    </Form>
                  </td>
                  <td>
                    {p.id !== user.id && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <input type="hidden" name="id" value={p.id} />
                        <button className={`btn${p.active ? " danger" : ""}`} type="submit">
                          {p.active ? "Turn off" : "Turn on"}
                        </button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
