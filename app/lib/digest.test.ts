import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, digestSubject, digestText, localDate, nextRunAt, type DigestRow } from "./digest.ts";

const row = (o: Partial<DigestRow>): DigestRow => ({
  kind: "top",
  rank: 1,
  name: "Item",
  distributor: "Pacific Smoke",
  stock: 0,
  sold30: 10,
  cartonSize: 5,
  suggestedCartons: 1,
  stamp: "FEDERAL",
  ...o,
});

test("lists only 0 pcs lines, grouped by distributor, skipping excluded items", () => {
  const d = buildDigest(
    [
      {
        store: "mississauga",
        label: "Mississauga",
        units: { globe11: "PIECE" },
        rows: [
          row({ name: "[ONT] Kraze Luna · Blue Razz", stamp: "ONTARIO", sold30: 30, suggestedCartons: 3 }),
          row({ name: "Still has some", stock: 4 }),
          row({ name: "[ONT] Hydra 18K - Disposable" }),
          row({ name: "Globe thing", distributor: "globe11", cartonSize: 6, suggestedCartons: 2 }),
          row({ name: "Brand new", kind: "new", rank: null, sold30: 0, suggestedCartons: 0 }),
        ],
      },
    ],
    new Date("2026-11-10T14:00:00Z"),
  );
  const s = d.stores[0];
  assert.equal(s.outCount, 3);
  assert.deepEqual(s.groups.map((g) => g.distributor), ["globe11", "Pacific Smoke"]);
  // globe11 counts pieces: 2 cartons x 6
  assert.equal(s.groups[0].qty, 12);
  assert.equal(s.groups[0].unit, "PIECE");
  const ps = s.groups[1];
  assert.deepEqual(ps.lines.map((l) => l.name), ["Kraze Luna · Blue Razz", "Brand new"]);
  // new item with no suggestion still gets a carton
  assert.equal(ps.lines[1].cartons, 1);
  assert.equal(ps.qty, 4);
});

test("GCore is split into Ontario and Federal checkouts", () => {
  const d = buildDigest([
    {
      store: "brampton",
      label: "Brampton",
      units: {},
      rows: [row({ distributor: "GCore Canada", stamp: "ONTARIO" }), row({ distributor: "GCore Canada", stamp: "FEDERAL", name: "B" })],
    },
  ]);
  assert.deepEqual(d.stores[0].groups.map((g) => g.stamp), ["FEDERAL", "ONTARIO"]);
});

test("text and subject read well, and a failed store says so", () => {
  const d = buildDigest(
    [
      { store: "mississauga", label: "Mississauga", units: {}, rows: [row({ name: "Kraze", rank: 3, sold30: 12 })] },
      { store: "brampton", label: "Brampton", units: {}, rows: [], problem: "Shopify down" },
    ],
    new Date("2026-11-10T14:00:00Z"),
  );
  assert.equal(digestSubject(d), "KOI//OS out of stock Tue, Nov 10: Mississauga 1 · Brampton ?");
  const t = digestText(d);
  assert.match(t, /Pacific Smoke: 1 ctn\n {2}- Kraze \[FED\] 1 ctn \(#3, 12 sold 30d\)/);
  assert.match(t, /Couldn't read stock: Shopify down/);
});

test("next run is 9 AM Toronto, across daylight saving", () => {
  // 8 AM EST (13:00 UTC) -> same day 9 AM EST = 14:00 UTC
  assert.equal(nextRunAt(new Date("2026-11-10T13:00:00Z")).toISOString(), "2026-11-10T14:00:00.000Z");
  // right at 9 AM -> tomorrow
  assert.equal(nextRunAt(new Date("2026-11-10T14:00:00Z")).toISOString(), "2026-11-11T14:00:00.000Z");
  // summer (EDT): 9 AM = 13:00 UTC
  assert.equal(nextRunAt(new Date("2026-07-01T10:00:00Z")).toISOString(), "2026-07-01T13:00:00.000Z");
  // the night before DST ends (Nov 1 2026): Oct 31 22:00 EDT -> Nov 1 9:00 EST
  assert.equal(nextRunAt(new Date("2026-11-01T02:00:00Z")).toISOString(), "2026-11-01T14:00:00.000Z");
  assert.equal(localDate(new Date("2026-11-11T03:00:00Z")), "2026-11-10");
});
