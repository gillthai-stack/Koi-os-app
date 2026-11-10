import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyProduct, matchInvoice, matchScore, parseInvoiceLines, pickupText, smsHref } from "./pickup.ts";

test("invoice line names match requested products by model and flavour", () => {
  const p = "Ripper X 75K [Classico Ice 20]";
  assert.ok(matchScore(p, "RIPPER X 75K Disposable - Classico Ice 20mg (Ontario Stamp) 5pk") > 0.9);
  assert.ok(matchScore(p, "Ripper X 75,000 Puffs Classico Ice") > 0); // 75K vs 75,000 still has ripper+x
  assert.equal(matchScore(p, "Ripper X 75K - Blue Razz Ice"), 0);
  assert.equal(matchScore("Orbito 18K [Mint]", "Elfbar BC 18K Mint"), 0);
  assert.ok(matchScore("InstaBarGO [Any]", "InstaBar GO Watermelon") === 0); // model word spelled differently
  assert.ok(matchScore("Instabargo [Any]", "Instabargo Watermelon Ice") > 0);
});

const req = (id: number, product: string, extra: Partial<{ status: string; distributor: string | null; qtyWanted: number; store: string }> = {}) => ({
  id,
  code: `M-${id}`,
  store: "mississauga",
  customer: `C${id}`,
  product,
  distributor: "GCore",
  status: "Ordered",
  qtyWanted: 1,
  ...extra,
});

test("matches open requests only, by distributor and store, and up to the line's quantity", () => {
  const requests = [
    req(1, "Ripper X 75K [Classico Ice]", { qtyWanted: 2 }),
    req(2, "Ripper X 75K [Classico Ice]", { qtyWanted: 2 }),
    req(3, "Ripper X 75K [Classico Ice]", { status: "Picked up" }),
    req(4, "Ripper X 75K [Classico Ice]", { distributor: "Valor" }),
    req(5, "Ripper X 75K [Classico Ice]", { store: "brampton" }),
  ];
  const got = matchInvoice([{ name: "Ripper X 75K Classico Ice (ONT)", qty: 2 }], requests, { stage: "shipped", distributor: "GCore Canada", store: "mississauga" });
  assert.deepEqual(got.map((m) => m.request.id), [1]);
  const all = matchInvoice([{ name: "Ripper X 75K Classico Ice" }], requests, { stage: "delivered", distributor: "gcore" });
  assert.deepEqual(all.map((m) => m.request.id), [1, 2, 5]);
});

test("delivered also moves requests already on the way", () => {
  const got = matchInvoice([{ name: "Ripper X 75K Classico Ice" }], [req(1, "Ripper X 75K [Classico Ice]", { status: "On the way" })], { stage: "delivered" });
  assert.equal(got.length, 1);
  assert.equal(matchInvoice([{ name: "Ripper X 75K Classico Ice" }], [req(1, "Ripper X 75K [Classico Ice]", { status: "On the way" })], { stage: "shipped" }).length, 0);
});

test("reads pasted invoice lines with quantities", () => {
  assert.deepEqual(
    parseInvoiceLines("Item  Qty\n3 x Ripper X 75K Classico Ice\nOrbito 18K Mint x 2\nGeek Bar Pulse Qty: 4\nFoger Switch Pro\tsku\t6\n\n"),
    [
      { name: "Item  Qty" },
      { name: "Ripper X 75K Classico Ice", qty: 3 },
      { name: "Orbito 18K Mint", qty: 2 },
      { name: "Geek Bar Pulse", qty: 4 },
      { name: "Foger Switch Pro  sku", qty: 6 },
    ],
  );
});

test("pickup text is short, uses the first name and drops stamp tags", () => {
  assert.equal(friendlyProduct("[ONT] Ripper X 75K [Classico Ice 20]"), "Ripper X 75K Classico Ice 20");
  assert.equal(
    pickupText({ customer: "Mark Zhao", product: "Ripper X 75K [Classico Ice 20]", store: "mississauga", qtyWanted: 2 }),
    "Hi Mark, it's Koi Mississauga. Your Ripper X 75K Classico Ice 20 (x2) is in and set aside for you. Come grab it any time!",
  );
  assert.ok(pickupText({ customer: "(no name)", product: "X", store: "brampton" }).startsWith("Hi, it's Koi Brampton."));
});

test("sms links add +1 and encode the body", () => {
  assert.equal(smsHref("647-978-7890", "Hi Mark & co"), "sms:+16479787890?&body=Hi%20Mark%20%26%20co");
  assert.equal(smsHref("1 (905) 555-0101", "x"), "sms:+19055550101?&body=x");
  assert.equal(smsHref("ask at counter", "x"), null);
});
