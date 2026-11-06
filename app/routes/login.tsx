import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import prisma from "../db.server";
import { Gate } from "../components/Shell";
import { cleanUsername, currentUser, startSession, verifyPassword } from "../lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Log in · KOI//OS" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await currentUser(request)) throw redirect("/");
  if ((await prisma.user.count()) === 0) throw redirect("/setup");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const username = cleanUsername(form.get("username"));
  const password = String(form.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Wrong username or password." };
  }
  return startSession(user.id);
};

export default function Login() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <Gate title="Staff log in">
      <Form method="post" className="stack">
        <input className="field" name="username" placeholder="Username" autoComplete="username" autoCapitalize="none" required />
        <input className="field" name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        {data?.error && <p className="err">{data.error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </Form>
    </Gate>
  );
}
