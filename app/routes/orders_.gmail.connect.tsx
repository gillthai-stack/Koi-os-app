// Sends the owner to Google to let KOI//OS read Gmail (read-only) for order tracking.
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireOwner } from "../lib/auth.server";
import { authUrl } from "../lib/gmail.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireOwner(request);
  try {
    return redirect(authUrl(request));
  } catch (e) {
    return redirect(`/orders?gmail=${encodeURIComponent(e instanceof Error ? e.message : "Couldn't start Google sign-in.")}`);
  }
};
