// Inside Shopify admin: opening the app stores the offline token the web app uses.
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { url: process.env.SHOPIFY_APP_URL || "" };
};

export default function Connected() {
  const { url } = useLoaderData<typeof loader>();
  return (
    <s-page heading="KOI//OS">
      <s-section heading="Shopify is connected">
        <s-paragraph>KOI//OS can now read live stock and sales. Staff use the web app, not this page.</s-paragraph>
        <s-button href={url} target="_blank" variant="primary">
          Open KOI//OS
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
