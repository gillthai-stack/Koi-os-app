import { test } from "node:test";
import assert from "node:assert/strict";
import { cartPageFor, cartQty, defaultQtyUnit, platformFor } from "./distributors.ts";

test("platform comes from the site's host", () => {
  assert.equal(platformFor("https://www.pacificsmoke.com/en/kraze-luna.html"), "magento");
  assert.equal(platformFor("https://nimbusdistro.ca/products/x?variant=1"), "shopify");
  assert.equal(platformFor("https://globe11.com/product/abc/"), "woocommerce");
  assert.equal(platformFor("https://gcorecanada.com/p"), "generic");
  assert.equal(platformFor("not a url"), "generic");
});

test("globe11 counts pieces, others count cartons", () => {
  assert.equal(defaultQtyUnit("https://globe11.com/shop/"), "PIECE");
  assert.equal(defaultQtyUnit("https://www.valordistributions.com/"), "CARTON");
});

test("cart quantity follows the site's unit", () => {
  assert.equal(cartQty(3, 5, "CARTON"), 3);
  assert.equal(cartQty(3, 5, "PIECE"), 15);
});

test("cart page per platform", () => {
  assert.equal(cartPageFor("https://www.pacificsmoke.com/en/"), "https://www.pacificsmoke.com/en/checkout/cart/");
  assert.equal(cartPageFor("https://globe11.com/shop/"), "https://globe11.com/cart/");
  assert.equal(cartPageFor("https://nimbusdistro.ca/"), "https://nimbusdistro.ca/cart");
});
