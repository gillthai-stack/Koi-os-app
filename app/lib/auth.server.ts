// Username + password login for KOI//OS staff. Passwords are scrypt-hashed.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createCookieSessionStorage, redirect } from "react-router";
import prisma from "../db.server";

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return ["scrypt", salt, hash.toString("hex")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hex] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hex) return false;
  const want = Buffer.from(hex, "hex");
  const got = await scrypt(password, salt, want.length);
  return timingSafeEqual(want, got);
}

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return "koi-os-dev-only-secret";
}

let storage: ReturnType<typeof makeStorage> | undefined;
function makeStorage() {
  return createCookieSessionStorage<{ userId: number }>({
    cookie: {
      name: "koi_os",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      secrets: [sessionSecret()],
      maxAge: 60 * 60 * 24 * 14,
    },
  });
}
function sessions() {
  storage ??= makeStorage();
  return storage;
}

export type CurrentUser = { id: number; username: string; displayName: string; role: "OWNER" | "STAFF" };

export async function currentUser(request: Request): Promise<CurrentUser | null> {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  const id = session.get("userId");
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || !u.active) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
}

export async function requireUser(request: Request): Promise<CurrentUser> {
  const u = await currentUser(request);
  if (u) return u;
  if ((await prisma.user.count()) === 0) throw redirect("/setup");
  throw redirect("/login");
}

export async function requireOwner(request: Request): Promise<CurrentUser> {
  const u = await requireUser(request);
  if (u.role !== "OWNER") throw redirect("/");
  return u;
}

export async function startSession(userId: number, to = "/") {
  const session = await sessions().getSession();
  session.set("userId", userId);
  return redirect(to, { headers: { "Set-Cookie": await sessions().commitSession(session) } });
}

export async function endSession(request: Request) {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  return redirect("/login", { headers: { "Set-Cookie": await sessions().destroySession(session) } });
}

export function cleanUsername(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export function checkNewUser(username: string, password: string): string | null {
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) return "Username: 2 to 32 letters, numbers, dots or dashes.";
  if (password.length < 8) return "Password needs at least 8 characters.";
  return null;
}
