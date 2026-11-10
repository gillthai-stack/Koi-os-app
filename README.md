# KOI//OS

Vaping Koi's ops web app for staff. Phase 1 is reordering: for Mississauga and Brampton it ranks the top 30 sellers (last 30 days, one row per flavour), shows what's out or running low, suggests cartons to cover two weeks, and builds an order sheet grouped by distributor with a link to each ordering site. GCore Ontario and Federal lines are split into separate checkouts.

Rules baked in: cartons of 4, 5 or 6 pieces (default 5); every line is Ontario or Federal stamp (`[ONT]` titles default to Ontario); Hydra 18K and KoiKoin Recyclables are skipped; items added in the last 3 weeks show under "New items".

## How it fits together

- **Web app** (`/`, `/login`, `/team`, `/setup`): staff log in with a username and password the owner creates on the Team page.
- **Shopify**: the KOI OS custom app stays installed on vaping-koi.myshopify.com in the background. Opening it once in Shopify admin (`/app`) stores an offline token; the web app uses that token to read live stock and sales. Nothing is written to Shopify.
- **Database** (Postgres on Neon): users, saved stamp and carton size per flavour, and Shopify's session.

## Stack

React Router 7 (Shopify app template), Prisma + Postgres, hosted on Render.

## First run

1. Deploy (below). Render generates `SESSION_SECRET` and `SETUP_CODE`.
2. In Shopify admin, open Apps → KOI OS once.
3. Visit the web app. With no users yet it goes to `/setup`: enter the `SETUP_CODE` from Render's Environment tab and create the owner login.
4. Add staff on the Team page.

## Deploy (Render)

`render.yaml` is the blueprint. Secrets (`SHOPIFY_API_SECRET`, `DATABASE_URL`) are pasted into the Render dashboard, never committed. `npm run setup` runs migrations on start.

## Daily digest

At 9 AM Toronto the server builds the out-of-stock digest (0 pcs among each store's top 30 sellers and new items, by distributor) and shows it on the Digest page. To also get it by email, set `GMAIL_USER` and `GMAIL_APP_PASSWORD` (a Google app password) on Render; `DIGEST_TO` changes the recipient.

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (CI runs all of them).
