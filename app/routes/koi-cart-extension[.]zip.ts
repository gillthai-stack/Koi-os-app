// Download of the KOI//OS Cart Chrome extension (from the repo's extension/ folder).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "../lib/auth.server";
import { makeZip } from "../lib/zip.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireUser(request);
  const dir = path.resolve(process.cwd(), "extension");
  const names = (await readdir(dir)).filter((n) => !n.startsWith("."));
  const files = await Promise.all(
    names.map(async (n) => ({ name: `koi-cart/${n}`, data: await readFile(path.join(dir, n)) })),
  );
  return new Response(new Uint8Array(makeZip(files)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="koi-cart-extension.zip"',
      "Cache-Control": "no-store",
    },
  });
};
