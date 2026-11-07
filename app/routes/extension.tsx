// How to install the KOI//OS Cart Chrome extension.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { Hero, Shell } from "../components/Shell";
import { requireUser } from "../lib/auth.server";

export const meta: MetaFunction = () => [{ title: "Cart extension · KOI//OS" }];

export const loader = async ({ request }: LoaderFunctionArgs) => ({ user: await requireUser(request) });

export default function Extension() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <Shell user={user}>
      <Hero kicker="カート" title={<>Fill distributor <span className="glow-c">carts</span></>}>
        <p className="muted" style={{ margin: 0 }}>
          The KOI//OS Cart extension adds your order sheet to each distributor’s cart, in your own browser, using your own login there.
        </p>
      </Hero>
      <section className="card">
        <div className="card-head">
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Install (one time, in Chrome)</h2>
        </div>
        <ol className="steps">
          <li>
            <a className="btn primary" href="/koi-cart-extension.zip" download style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              Download the extension
            </a>{" "}
            then unzip it. You’ll get a folder called <span className="mono">koi-cart</span>.
          </li>
          <li>
            Open <span className="mono">chrome://extensions</span> in a new tab and turn on <strong>Developer mode</strong> (top right).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and pick the <span className="mono">koi-cart</span> folder.
          </li>
          <li>Come back here and refresh. The order sheet’s buttons will say “Add … to cart”.</li>
        </ol>
      </section>
      <section className="card">
        <div className="card-head">
          <h2 className="h" style={{ margin: 0, fontSize: 18 }}>Using it</h2>
        </div>
        <ul className="steps">
          <li>Log in to each distributor site in Chrome first.</li>
          <li>
            The first time you order an item, paste its product page from the distributor site into the order sheet. Pick a page for one flavour.
            It’s saved for everyone after that.
          </li>
          <li>Press <strong>Add to cart</strong> on a distributor. A tab opens, adds each line, then shows that site’s cart. Check it, then check out.</li>
          <li>GCore: fill and check out the Ontario group, then the Federal group. They are separate checkouts.</li>
          <li>globe11 counts pieces, the rest count cartons. Switch it under each distributor if a site changes.</li>
        </ul>
      </section>
    </Shell>
  );
}
