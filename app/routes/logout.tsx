import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { endSession } from "../lib/auth.server";

export const action = async ({ request }: ActionFunctionArgs) => endSession(request);

export const loader = () => redirect("/");
