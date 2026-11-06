// First run only: creates the owner account. Needs the SETUP_CODE from Render.
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData } from "react-router";
import { timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import { Gate } from "../components/Shell";
import { checkNewUser, cleanUsername, hashPassword, startSession } from "../lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Set up · KOI//OS" }];

export const loader = async () => {
  if ((await prisma.user.count()) > 0) throw redirect("/login");
  return null;
};

function codeMatches(given: string): boolean {
  const want = process.env.SETUP_CODE ?? "";
  if (!want || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if ((await prisma.user.count()) > 0) throw redirect("/login");
  const form = await request.formData();
  if (!codeMatches(String(form.get("code") ?? "").trim())) {
    return { error: "That setup code doesn't match SETUP_CODE in Render." };
  }
  const username = cleanUsername(form.get("username"));
  const password = String(form.get("password") ?? "");
  const displayName = String(form.get("displayName") ?? "").trim() || username;
  const problem = checkNewUser(username, password);
  if (problem) return { error: problem };
  const user = await prisma.user.create({
    data: { username, displayName, passwordHash: await hashPassword(password), role: "OWNER" },
  });
  return startSession(user.id);
};

export default function Setup() {
  const data = useActionData<typeof action>();
  return (
    <Gate title="Create the owner login">
      <Form method="post" className="stack">
        <input className="field" name="code" placeholder="Setup code (from Render)" autoComplete="off" required />
        <input className="field" name="displayName" placeholder="Your name" required />
        <input className="field" name="username" placeholder="Username" autoCapitalize="none" required />
        <input className="field" name="password" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" required />
        {data?.error && <p className="err">{data.error}</p>}
        <button className="btn primary" type="submit">
          Create owner
        </button>
      </Form>
    </Gate>
  );
}
