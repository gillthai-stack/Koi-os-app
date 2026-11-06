import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderSheet,
  cartonsFor,
  defaultStamp,
  isExcluded,
  nextCartonSize,
  reorderFor,
  soldByVariant,
  topVariants,
} from "./ordering.ts";

test("skips Hydra 18K and KoiKoin Recyclables", () => {
  assert.equal(isExcluded("[ONT] Hydra 18K - Disposable"), true);
  assert.equal(isExcluded("KoiKoin Recyclables"), true);
  assert.equal(isExcluded("[ONT] Kraze - Luna Link"), false);
});

test("stamp defaults from the [ONT] title prefix", () => {
  assert.equal(defaultStamp("[ONT] Vice Box"), "ONTARIO");
  assert.equal(defaultStamp("Vice Box"), "FEDERAL");
});

test("carton size cycles 4 -> 5 -> 6 -> 4", () => {
  assert.equal(nextCartonSize(4), 5);
  assert.equal(nextCartonSize(6), 4);
  assert.equal(nextCartonSize(7), 4);
});

test("out of stock tops up two weeks of sales", () => {
  // 30 sold in 30 days = 1/day -> 14 pcs needed
  assert.deepEqual(reorderFor(0, 30), { status: "OUT", daysLeft: null, needPcs: 14 });
});

test("low when under a week is left, ok otherwise", () => {
  assert.deepEqual(reorderFor(5, 30), { status: "LOW", daysLeft: 5, needPcs: 9 });
  assert.deepEqual(reorderFor(10, 30), { status: "OK", daysLeft: 10, needPcs: 0 });
  assert.equal(reorderFor(3, 0).daysLeft, 99);
});

test("a new item with no sales gets the starter quantity", () => {
  assert.equal(reorderFor(0, 0, true).needPcs, 5);
});

test("cartons round up", () => {
  assert.equal(cartonsFor(14, 5), 3);
  assert.equal(cartonsFor(0, 5), 0);
  assert.equal(cartonsFor(9, 0), 2);
});

test("top sellers rank by pieces, skipping excluded and unknown items", () => {
  const sold = soldByVariant([
    { variantId: "a", quantity: 9 },
    { variantId: "h", quantity: 99 },
    { variantId: "b", quantity: 4 },
    { variantId: "a", quantity: 1 },
    { variantId: "gone", quantity: 50 },
    { variantId: null, quantity: 7 },
  ]);
  const titles: Record<string, string> = { a: "A", h: "Hydra 18K", b: "B" };
  assert.deepEqual(topVariants(sold, (id) => titles[id], 30), ["a", "b"]);
});

test("order sheet groups by distributor and splits GCore by stamp", () => {
  const groups = buildOrderSheet([
    { variantId: "1", name: "X", distributor: "Pacific Smoke", stamp: "ONTARIO", cartons: 2 },
    { variantId: "2", name: "Y", distributor: "Pacific Smoke", stamp: "FEDERAL", cartons: 1 },
    { variantId: "3", name: "Z", distributor: "GCore Canada", stamp: "ONTARIO", cartons: 1 },
    { variantId: "4", name: "W", distributor: "GCore Canada", stamp: "FEDERAL", cartons: 3 },
    { variantId: "5", name: "V", distributor: "Valor Distributions", stamp: "ONTARIO", cartons: 0 },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.distributor, g.stamp, g.cartons]),
    [
      ["GCore Canada", "FEDERAL", 3],
      ["GCore Canada", "ONTARIO", 1],
      ["Pacific Smoke", null, 3],
    ],
  );
});
