// Reads the request tabs of the Google Sheet with a Google service account.
// Set GOOGLE_SERVICE_ACCOUNT_JSON (the key file's JSON) in Render and share the sheet with the
// service account's email. No Google SDK: a signed JWT is traded for a read-only token.
import { createSign } from "node:crypto";

/** "Koi Shop Requests - Main v1" (owned by vapingkoi@gmail.com). Override with REQUESTS_SHEET_ID. */
const DEFAULT_SHEET_ID = "1enXsMzVSqyTI9u9o3pcvpuwI0j25mC8wABYkvM3JZZE";
export const SHEET_NAME = "Koi Shop Requests - Main v1";

export const REQUEST_TABS = {
  mississauga: process.env.REQUESTS_TAB_M || "Mississauga Requests",
  brampton: process.env.REQUESTS_TAB_B || "Brampton Requests",
} as const;
/** Shared by both stores; rows say which store in their Store column. They get K-### IDs. */
export const KEEP_IN_STOCK_TAB = process.env.REQUESTS_TAB_K || "Keep In Stock";

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function sheetConfig() {
  const sa = serviceAccount();
  return {
    connected: Boolean(sa),
    email: sa?.client_email ?? null,
    sheetId: process.env.REQUESTS_SHEET_ID || DEFAULT_SHEET_ID,
  };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

let cached: { token: string; expires: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${claims}`);
  const jwt = `${head}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!json.access_token) throw new Error(`Google sign-in failed: ${json.error_description ?? res.status}`);
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** All cells of one tab as text. */
export async function readTab(tab: string): Promise<string[][]> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Google Sheets isn't connected yet.");
  const { sheetId } = sheetConfig();
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${await accessToken(sa)}` },
  });
  if (res.status === 403 || res.status === 404) {
    throw new Error(`Can't open the sheet. Share it with ${sa.client_email} (Viewer), and check the tab "${tab}" exists.`);
  }
  if (!res.ok) throw new Error(`Google Sheets error ${res.status}`);
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}
