// Reads the store's Gmail (vapingkoi@gmail.com) for the order tracker, read-only.
// The owner connects it once from the Orders page with Google sign-in; the refresh token is
// kept in AppSetting. Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Render.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import type { Mail } from "./orderMail";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const KEY_TOKEN = "gmail.refreshToken";
const KEY_EMAIL = "gmail.email";
/** The inbox the tracker is meant to read; Google's account picker is pre-filled with it. */
export const GMAIL_ADDRESS = process.env.GMAIL_ADDRESS || "vapingkoi@gmail.com";

function oauthClient() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/** Public address of the app, for Google's redirect back (Render serves it over https). */
export function appOrigin(request: Request): string {
  const env = process.env.APP_URL || process.env.SHOPIFY_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${request.headers.get("x-forwarded-host") ?? url.host}`;
}
export const redirectUri = (request: Request) => `${appOrigin(request)}/orders/gmail/callback`;

export async function gmailStatus() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY_TOKEN, KEY_EMAIL] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { configured: Boolean(oauthClient()), connected: Boolean(get(KEY_TOKEN)), email: get(KEY_EMAIL) };
}

// The OAuth "state" is signed with SESSION_SECRET so a callback can't be forged.
const secret = () => process.env.SESSION_SECRET || "koi-os-dev-only-secret";
const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

export function authUrl(request: Request): string {
  const client = oauthClient();
  if (!client) throw new Error("Google sign-in isn't set up yet (GOOGLE_OAUTH_CLIENT_ID / SECRET).");
  const nonce = `${Date.now()}.${randomBytes(8).toString("hex")}`;
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: GMAIL_ADDRESS,
    state: `${nonce}.${sign(nonce)}`,
  });
  return `${AUTH_URL}?${params}`;
}

function validState(state: string | null): boolean {
  if (!state) return false;
  const i = state.lastIndexOf(".");
  const nonce = state.slice(0, i);
  const want = Buffer.from(sign(nonce));
  const got = Buffer.from(state.slice(i + 1));
  const fresh = Date.now() - Number(nonce.split(".")[0]) < 15 * 60_000;
  return fresh && want.length === got.length && timingSafeEqual(want, got);
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  return (await res.json()) as TokenReply;
}

async function saveSetting(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Google redirected back with a code: trade it for a refresh token and remember the inbox. */
export async function finishConnect(request: Request): Promise<string> {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) throw new Error(`Google said: ${url.searchParams.get("error")}`);
  if (!validState(url.searchParams.get("state"))) throw new Error("That sign-in link expired. Try Connect Gmail again.");
  const client = oauthClient();
  if (!client) throw new Error("Google sign-in isn't set up yet.");
  const t = await tokenRequest({
    code: url.searchParams.get("code") ?? "",
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri(request),
    grant_type: "authorization_code",
  });
  if (!t.refresh_token || !t.access_token) throw new Error(`Google sign-in failed: ${t.error_description ?? t.error ?? "no refresh token"}`);
  cached = { token: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 };
  const profile = (await (await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json()) as { emailAddress?: string };
  await saveSetting(KEY_TOKEN, t.refresh_token);
  await saveSetting(KEY_EMAIL, profile.emailAddress ?? "");
  return profile.emailAddress ?? "";
}

export async function disconnect() {
  cached = null;
  await prisma.appSetting.deleteMany({ where: { key: { in: [KEY_TOKEN, KEY_EMAIL] } } });
}

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const client = oauthClient();
  const refresh = (await prisma.appSetting.findUnique({ where: { key: KEY_TOKEN } }))?.value;
  if (!client || !refresh) throw new Error("Gmail isn't connected.");
  const t = await tokenRequest({ refresh_token: refresh, client_id: client.id, client_secret: client.secret, grant_type: "refresh_token" });
  if (!t.access_token) {
    if (t.error === "invalid_grant") throw new Error("Gmail access was revoked or expired. Connect Gmail again.");
    throw new Error(`Gmail sign-in failed: ${t.error_description ?? t.error}`);
  }
  cached = { token: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return t.access_token;
}

async function gmail<T>(path: string): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Ids of messages matching a Gmail search, newest first. */
export async function searchMessages(q: string, max = 300): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "100", ...(page ? { pageToken: page } : {}) });
    const r = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params}`);
    ids.push(...(r.messages ?? []).map((m) => m.id));
    page = r.nextPageToken;
  } while (page && ids.length < max);
  return ids.slice(0, max);
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

function findPart(p: Part, type: string): string | null {
  if (p.mimeType === type && p.body?.data) return decode(p.body.data);
  for (const c of p.parts ?? []) {
    const found = findPart(c, type);
    if (found) return found;
  }
  return null;
}

/** HTML email → readable text, keeping line breaks where blocks and cells end. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export async function getMessage(id: string): Promise<Mail> {
  const m = await gmail<{ id: string; internalDate: string; payload: Part }>(`/messages/${id}?format=full`);
  const header = (n: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
  const plain = findPart(m.payload, "text/plain");
  const html = plain ? null : findPart(m.payload, "text/html");
  return {
    id: m.id,
    from: header("from"),
    subject: header("subject"),
    body: plain ?? (html ? htmlToText(html) : ""),
    date: new Date(Number(m.internalDate)),
  };
}

export const messageUrl = (id: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(GMAIL_ADDRESS)}#all/${id}`;
