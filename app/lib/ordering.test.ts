import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWatchList,
  defaultStamp,
  isExcluded,
  isLow,
  suggestCartons,
  summarizeSales,
} from "./ordering.ts";

test("skips Hydra 18K and KoiKoin Recyclables", () => {
  assert.equal(isExcluded("[ONT] Hydra 18K - Disposable"), true);
  assert.equal(isExcluded("Hydra 18k"), true);
  assert.equal(isExcluded("KoiKoin Recyclables"), true);
  assert.equal(isExcluded("[ONT] Kraze - Luna Link - Pod - 100k Puffs"), false);
});

test("stamp defaults from the [ONT] title prefix", () => {
  assert.equal(defaultStamp("[ONT] Vice Box"), "ONTARIO");
  assert.equal(defaultStamp("Vice Box"), "FEDERAL");
});

test("sales are summed per product and per variant", () => {
  const s = summarizeSales([
    { productId: "p1", variantId: "v1", quantity: 2 },
    { productId: "p1", variantId: "v2", quantity: 1 },
    { productId: null, variantId: null, quantity: 9 },
  ]);
  assert.equal(s.byProduct.get("p1"), 3);
  assert.equal(s.byVariant.get("v1"), 2);
});

test("watch list = top sellers without excluded items, plus new items", () => {
  const byProduct = new Map([
    ["a", 50],
    ["hydra", 99],
    ["b", 10],
    ["c", 5],
  ]);
  const titles = new Map([
    ["a", "A"],
    ["hydra", "Hydra 18K"],
    ["b", "B"],
    ["c", "C"],
    ["n", "New thing"],
  ]);
  const list = buildWatchList(byProduct, titles, ["b", "n"], 2);
  assert.deepEqual(list, [
    { productId: "a", reason: "top" },
    { productId: "b", reason: "top" },
    { productId: "n", reason: "new" },
  ]);
});

test("carton suggestion covers two weeks, minimum one carton", () => {
  assert.equal(suggestCartons(0), 1);
  assert.equal(suggestCartons(30, 5), 3); // 14 pcs -> 3 cartons of 5
  assert.equal(suggestCartons(60, 6), 5); // 28 pcs -> 5 cartons of 6
  assert.equal(suggestCartons(10, 0), 1); // bad size falls back to 5
});

test("low level is zero pieces", () => {
  assert.equal(isLow(0), true);
  assert.equal(isLow(-2), true);
  assert.equal(isLow(1), false);
});
