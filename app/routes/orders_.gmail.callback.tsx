// Google sends the owner back here after they allow Gmail access.
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireOwner } from "../lib/auth.server";
import { finishConnect } from "../lib/gmail.server";
import { syncGmail } from "../lib/orders.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireOwner(request);
  try {
    await finishConnect(request);
    // First read covers the last 45 days; let it run while the page loads.
    syncGmail().catch((e) => console.warn(`[orders] first Gmail read: ${e instanceof Error ? e.message : e}`));
    return redirect("/orders?gmail=connected");
  } catch (e) {
    return redirect(`/orders?gmail=${encodeURIComponent(e instanceof Error ? e.message : "Google sign-in failed.")}`);
  }
};
