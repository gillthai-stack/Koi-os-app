import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { STORES, type Stamp, type StoreKey } from "../lib/ordering";
import { loadStockDeck, saveProductSetting, type DeckProduct } from "../lib/stock.server";

function storeFrom(url: URL): StoreKey {
  const s = url.searchParams.get("store");
  return STORES.some((x) => x.key === s) ? (s as StoreKey) : "mississauga";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const store = storeFrom(new URL(request.url));
  const deck = await loadStockDeck(admin, store);
  return { store, ...deck };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  const stamp = form.get("stamp") === "FEDERAL" ? "FEDERAL" : "ONTARIO";
  const cartonSize = Number(form.get("cartonSize"));
  if (!productId.startsWith("gid://shopify/Product/")) {
    return { ok: false, error: "Unknown product" };
  }
  const who = session.onlineAccessInfo?.associated_user?.email ?? null;
  await saveProductSetting(productId, cartonSize, stamp, who);
  return { ok: true };
};

function stampLabel(s: Stamp) {
  return s === "ONTARIO" ? "Ontario" : "Federal";
}

function ProductSettings({ product }: { product: DeckProduct }) {
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="productId" value={product.productId} />
      <s-stack direction="inline" gap="base" alignItems="end">
        <s-select label="Stamp" name="stamp" value={product.stamp}>
          <s-option value="ONTARIO">Ontario</s-option>
          <s-option value="FEDERAL">Federal</s-option>
        </s-select>
        <s-number-field
          label="Pieces per carton"
          name="cartonSize"
          value={String(product.cartonSize)}
          min={1}
          max={50}
        />
        <s-button type="submit" {...(saving ? { loading: true } : {})}>
          Save
        </s-button>
      </s-stack>
    </fetcher.Form>
  );
}

export default function StockDeck() {
  const { store, products, refreshedAt } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const nav = useNavigation();
  const storeLabel = STORES.find((s) => s.key === store)!.label;

  const needOrder = products.filter((p) => p.outLines.length > 0);
  const byDistributor = new Map<string, DeckProduct[]>();
  for (const p of needOrder) {
    byDistributor.set(p.distributor, [...(byDistributor.get(p.distributor) ?? []), p]);
  }
  const distributors = [...byDistributor.keys()].sort();
  const totalCartons = needOrder.reduce((n, p) => n + p.outLines.reduce((m, l) => m + l.cartons, 0), 0);

  return (
    <s-page heading={`Stock deck · ${storeLabel}`}>
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          {STORES.map((s) => {
            const next = new URLSearchParams(params);
            next.set("store", s.key);
            return (
              <s-button key={s.key} href={`/app?${next.toString()}`} variant={s.key === store ? "primary" : "secondary"}>
                {s.label}
              </s-button>
            );
          })}
          {nav.state === "loading" ? <s-spinner accessibilityLabel="Loading stock" /> : null}
          <s-text color="subdued">
            Live from Shopify · {new Date(refreshedAt).toLocaleTimeString("en-CA", { timeZone: "America/Toronto" })}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading={`To order: ${needOrder.length} products, about ${totalCartons} cartons`}>
        <s-paragraph>
          Flavours at 0 pieces in {storeLabel}, from the top 30 sellers (last 30 days) and items added in the last 3
          weeks. Cartons cover about 2 weeks of sales and are estimates; fix the pieces per carton and the stamp for
          each product and they are remembered.
        </s-paragraph>
        {distributors.length === 0 ? (
          <s-banner tone="success">Nothing on the watch list is out of stock.</s-banner>
        ) : null}
      </s-section>

      {distributors.map((d) => (
        <s-section key={d} heading={d}>
          <s-stack direction="block" gap="large">
            {byDistributor.get(d)!.map((p) => (
              <s-box key={p.productId} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading>{p.title}</s-heading>
                    {p.reason === "new" ? <s-badge tone="info">New</s-badge> : <s-badge>#{p.rank}</s-badge>}
                    <s-badge tone={p.stamp === "ONTARIO" ? "success" : "warning"}>{stampLabel(p.stamp)} stamp</s-badge>
                  </s-stack>
                  <s-table>
                    <s-table-header-row>
                      <s-table-header listSlot="primary">Flavour</s-table-header>
                      <s-table-header format="numeric">On hand (pcs)</s-table-header>
                      <s-table-header format="numeric">Sold 30 days (pcs)</s-table-header>
                      <s-table-header format="numeric">Order (cartons)</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {p.outLines.map((l) => (
                        <s-table-row key={l.variantId}>
                          <s-table-cell>{l.flavour}</s-table-cell>
                          <s-table-cell>{l.available}</s-table-cell>
                          <s-table-cell>{l.sold30}</s-table-cell>
                          <s-table-cell>{l.cartons}</s-table-cell>
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                  <ProductSettings product={p} />
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ))}

      <s-section heading="Watch list">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header>Distributor</s-table-header>
            <s-table-header format="numeric">Sold 30 days (pcs)</s-table-header>
            <s-table-header format="numeric">Flavours out</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.map((p) => (
              <s-table-row key={p.productId}>
                <s-table-cell>
                  {p.reason === "new" ? "New · " : `#${p.rank} · `}
                  {p.title}
                </s-table-cell>
                <s-table-cell>{p.distributor}</s-table-cell>
                <s-table-cell>{p.sold30}</s-table-cell>
                <s-table-cell>
                  {p.outLines.length} of {p.variantCount}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
