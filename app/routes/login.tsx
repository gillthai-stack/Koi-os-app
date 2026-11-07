import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import prisma from "../db.server";
import { Gate } from "../components/Shell";
import { cleanUsername, currentUser, startSession, verifyPassword } from "../lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Log in · KOI//OS" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
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

/** True when the page is shown inside another site's frame, where its login cookie is blocked. */
function useFramed(): boolean {
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);
  return framed;
}

export default function Login() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const framed = useFramed();
  if (framed) {
    return (
      <Gate title="Open KOI//OS in its own tab">
        <div className="stack">
          <p className="muted" style={{ fontSize: 14, textAlign: "center", margin: 0 }}>
            Logins don’t work inside Shopify admin. Open the app in a new tab and log in there.
          </p>
          <a className="btn primary" href="/login" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
            Open KOI//OS
          </a>
        </div>
      </Gate>
    );
  }
  return (
    <Gate title="Staff log in">
      <Form method="post" className="stack">
        <input className="field" name="username" placeholder="Username" autoComplete="username" autoCapitalize="none" required />
        <input className="field" name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        {data?.error && <p className="err">{data.error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Log in"}
        </button>
        <a href="/setup" className="muted" style={{ fontSize: 13, textAlign: "center" }}>
          Owner: set up or recover with the setup code
        </a>
      </Form>
    </Gate>
  );
}
