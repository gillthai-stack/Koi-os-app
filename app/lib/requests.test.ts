import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCode, normalizeStatus, parsePasted, parseRequestRows, sheetKey } from "./requests.ts";

test("status spellings from the sheet map to our statuses", () => {
  assert.equal(normalizeStatus("Ready - set aside"), "Ready – set aside");
  assert.equal(normalizeStatus("waiting on stock"), "Waiting on stock");
  assert.equal(normalizeStatus("Closed – inactive"), "Closed – inactive");
  assert.equal(normalizeStatus(""), "New");
  assert.equal(normalizeStatus("???"), "New");
});

test("next ID per store prefix", () => {
  assert.equal(nextCode("M", ["M-001", "M-072", "B-090", "K-004"]), "M-073");
  assert.equal(nextCode("B", []), "B-001");
});

test("reads sheet rows by header names, skipping rows above the header", () => {
  const rows = [
    ["Request order sheet M"],
    ["ID", "Store", "Customer", "Phone", "Product", "Distributor", "Type", "Qty wanted", "Qty set aside", "Status", "Notes"],
    ["M-004", "Mississauga", "Mark Zhao", "647-978-7890", "Ripper X 75K [Classico Ice 20]", "GCore", "Pod", "2", "2", "Ready - set aside", "Reach out"],
    ["", "", "", "", "", "", "", "", "", "", ""],
    ["", "Mississauga", "Evan", "", "InstaBarGO [Any]", "NimbusDistro", "", "", "", "", ""],
  ];
  const got = parseRequestRows(rows);
  assert.equal(got.length, 2);
  assert.deepEqual(
    { code: got[0].code, customer: got[0].customer, qty: got[0].qtyWanted, aside: got[0].qtySetAside, status: got[0].status },
    { code: "M-004", customer: "Mark Zhao", qty: 2, aside: 2, status: "Ready – set aside" },
  );
  assert.equal(got[1].code, null);
  assert.equal(got[1].status, "New");
});

test("pasted cells are tab separated", () => {
  const rows = parsePasted("Customer\tProduct\r\nAli\tVuse GO8K [Creamy Tobacco]\n");
  assert.equal(parseRequestRows(rows)[0].product, "Vuse GO8K [Creamy Tobacco]");
});

test("sheet key ignores phone formatting and case", () => {
  assert.equal(
    sheetKey("mississauga", { customer: "Ali ", phone: "647-882-7727", product: "Vuse GO8K" }),
    sheetKey("mississauga", { customer: "ali", phone: "(647) 882 7727", product: "vuse go8k" }),
  );
});

test("keep-in-stock rows use Requested by and the store column", () => {
  const rows = [
    ["Store", "Product", "Requested by", "Phone", "Priority", "Stocked now?", "OK to text?", "Notes"],
    ["Brampton", "STLTH60K [Grape Ice]", "", "647-230-1004", "F", "", "", "Stock it."],
    ["Mississauga", "Level X G2U [Extreme]", "John", "647-893-6533", "", "", "", ""],
  ];
  const got = parseRequestRows(rows, "Standing order");
  assert.equal(got.length, 2);
  assert.equal(got[0].store, "brampton");
  assert.equal(got[0].status, "Standing order");
  assert.equal(got[1].customer, "John");
});
