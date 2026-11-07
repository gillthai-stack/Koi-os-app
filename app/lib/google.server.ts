// Reads and writes the request tabs of the Google Sheet with a Google service account.
// Set GOOGLE_SERVICE_ACCOUNT_JSON (the key file's JSON) in Render and share the sheet with the
// service account's email as an Editor. No Google SDK: a signed JWT is traded for a token.
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

// Overridable only so the sync can be tested against a local stand-in for Google.
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const SHEETS_API = process.env.GOOGLE_SHEETS_API || "https://sheets.googleapis.com";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

let cached: { token: string; expires: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${claims}`);
  const jwt = `${head}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!json.access_token) throw new Error(`Google sign-in failed: ${json.error_description ?? res.status}`);
  cached = { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

/** Column number (0-based) to A1 letters: 0 → A, 26 → AA. */
export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

async function sheets(path: string, init: RequestInit = {}, tab = ""): Promise<Response> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Google Sheets isn't connected yet.");
  const { sheetId } = sheetConfig();
  const res = await fetch(`${SHEETS_API}/v4/spreadsheets/${sheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 403 || res.status === 404) {
    throw new Error(`Can't open the sheet. Share it with ${sa.client_email} as an Editor${tab ? `, and check the tab "${tab}" exists` : ""}.`);
  }
  if (!res.ok) throw new Error(`Google Sheets error ${res.status}`);
  return res;
}

/** All cells of one tab as text. */
export async function readTab(tab: string): Promise<string[][]> {
  const res = await sheets(`/values/${encodeURIComponent(quoteTab(tab))}?valueRenderOption=FORMATTED_VALUE`, {}, tab);
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

export type CellUpdate = { row: number; col: number; value: string }; // row and col are 0-based

/** Writes single cells; everything else in the tab is left as it is. */
export async function writeCells(tab: string, cells: CellUpdate[]): Promise<void> {
  if (!cells.length) return;
  await sheets(
    "/values:batchUpdate",
    {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: cells.map((c) => ({ range: `${quoteTab(tab)}!${columnLetter(c.col)}${c.row + 1}`, values: [[c.value]] })),
      }),
    },
    tab,
  );
}

/** Adds a row under the tab's last filled row. */
export async function appendRow(tab: string, values: string[]): Promise<void> {
  await sheets(
    `/values/${encodeURIComponent(`${quoteTab(tab)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [values] }) },
    tab,
  );
}
