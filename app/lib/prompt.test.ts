import { test } from "node:test";
import assert from "node:assert/strict";
import { orderPrompt } from "./prompt.ts";

test("prompt lists lines with stamp and quantity in the site's unit", () => {
  const p = orderPrompt({
    distributor: "globe11",
    siteUrl: "https://globe11.com/",
    store: "Brampton",
    unit: "PIECE",
    onlyStamp: null,
    lines: [{ name: "Geek Bar Pulse · Watermelon Ice", stamp: "FEDERAL", qty: 15 }],
  });
  assert.match(p, /globe11 \(https:\/\/globe11\.com\/\)/);
  assert.match(p, /1\. Geek Bar Pulse · Watermelon Ice \| Federal stamp \| qty 15/);
  assert.match(p, /single pieces/);
  assert.match(p, /don't check out/i);
  assert.doesNotMatch(p, /separate checkout/);
});

test("GCore prompt says it's one stamp only", () => {
  const p = orderPrompt({
    distributor: "GCore Canada",
    siteUrl: null,
    store: "Mississauga",
    unit: "CARTON",
    onlyStamp: "ONTARIO",
    lines: [{ name: "STLTH · Lush Ice", stamp: "ONTARIO", qty: 2, productUrl: "https://gcorecanada.com/p/1" }],
  });
  assert.match(p, /only for Ontario stamp items/);
  assert.match(p, /cartons \(boxes\)/);
  assert.match(p, /page: https:\/\/gcorecanada\.com\/p\/1/);
});
