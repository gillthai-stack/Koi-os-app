# KOI//OS

Vaping Koi's ordering and request deck, as a private Shopify app for the Vaping Koi store.

**Phase 1 (this version): live stock deck.** Inside Shopify admin, pick Mississauga or Brampton and see:

- the watch list: top 30 sellers by pieces sold in the last 30 days at that store, plus products added in the last 3 weeks (Hydra 18K and KoiKoin Recyclables are skipped);
- every flavour at 0 pieces on that list, grouped by distributor (the product's Shopify vendor), with a carton suggestion that covers about 2 weeks of sales;
- the stamp (Ontario or Federal) and pieces per carton for each product. Stamp defaults to Ontario for `[ONT]` titles and Federal otherwise; carton size defaults to 5. Changes are saved in the app database.

The app only reads from Shopify. Orders are still placed on each distributor's website.

## Stack

Shopify's React Router app template · Polaris web components · Prisma + Postgres (Neon) · hosted on Render (`render.yaml`).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the Neon connection string.
3. `npx prisma migrate deploy`
4. `npm run config:link` to link this code to the KOI//OS app in the Shopify Dev Dashboard (fills `client_id`).
5. `npm run dev` to run it against the store.

## Deploy (Render)

1. New → Blueprint → this repo. Render reads `render.yaml`.
2. Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `DATABASE_URL` and `SHOPIFY_APP_URL` (the Render URL) in the Render dashboard.
3. Put the Render URL in `shopify.app.toml` (`application_url` and redirect URLs) and run `npm run deploy`.
4. Install the app on vaping-koi.myshopify.com from the Dev Dashboard (custom distribution).

## Checks

`npm test` (ordering rules) · `npx tsc --noEmit` · `npm run lint` · `npm run build`
