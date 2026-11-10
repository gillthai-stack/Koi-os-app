import { test } from "node:test";
import assert from "node:assert/strict";
import { matchOrder, parseMail, refKey, stageAfter, trackingNumbers, type Mail, type MailEvent, type OrderLike } from "./orderMail.ts";

const mail = (from: string, subject: string, body: string): Mail => ({ id: "m", from, subject, body, date: new Date("2026-11-05T12:00:00Z") });

const order = (o: Partial<OrderLike> & { id: number; distributor: string }): OrderLike => ({
  store: "mississauga",
  refs: [],
  tracking: [],
  amount: null,
  stage: 1,
  cancelled: false,
  createdAt: new Date("2026-11-04T12:00:00Z"),
  ...o,
});

test("Interac deposited e-Transfer becomes a payment with refs from the message", () => {
  const e = parseMail(
    mail(
      "TD Canada Trust <catch@payments.interac.ca>",
      "Interac e-Transfer: Your $1,078.84 transfer to PACIFIC SMOKE INTERNATIONAL INC. has been successfully deposited.",
      "Hi VAPING KOI INC.,\n\nYour transfer to PACIFIC SMOKE INTERNATIONAL INC. was successfully deposited.\n\nTransfer Details\n\nDate: Nov 5, 2026\nReference Number: C1ArqTBC8cTg\n\nMessage:\nINV-718010 / SO-707823 / Acct 8189-05677\n\nFAQ: ...",
    ),
  );
  assert.deepEqual(e, {
    kind: "payment",
    payee: "PACIFIC SMOKE INTERNATIONAL INC.",
    distributor: "Pacific Smoke",
    amount: 1078.84,
    refs: ["INV-718010", "SO-707823"],
    message: "INV-718010 / SO-707823 / Acct 8189-05677",
  });
});

test("'has accepted your transfer' is a payment too; payments to people have no distributor", () => {
  const a = parseMail(mail("catch@payments.interac.ca", "Interac e-Transfer: Canada-E-Clouds has accepted your transfer of $202.84", "deposited by Canada-E-Clouds"));
  assert.equal(a?.kind, "payment");
  assert.equal(a?.kind === "payment" && a.payee, "Canada-E-Clouds");
  const b = parseMail(mail("catch@payments.interac.ca", "Interac e-Transfer: Your $544.78 transfer to ISABELLA MARIA MENA has been successfully deposited.", ""));
  assert.equal(b?.kind === "payment" && b.distributor, null);
});

test("e-Transfers we receive are ignored", () => {
  assert.equal(parseMail(mail("notify@payments.interac.ca", "Interac e-Transfer: JOHN sent you money.", "The money has been automatically deposited.")), null);
});

test("Pacific Smoke fulfilment gives SO ref, UPS tracking and store", () => {
  const e = parseMail(
    mail(
      "Pacific Smoke International <serivce@pacificsmoke.com>",
      "Your order no. SO-707169 has been fulfilled",
      "Dear Vaping Koi (Sunnyvale - Brampton),\n\nThank you for shopping at Pacific Smoke International.\n\nYour order no. SO-707169 has been fulfilled.\n\nTracking numbers:\n1ZA0Y1502098202997\n\nLink: http://wwwapps.ups.com/etracking/tracking.cgi?InquiryNumber1=1ZA0Y1502098202997",
    ),
  );
  assert.deepEqual(e, { kind: "shipped", distributor: "Pacific Smoke", refs: ["SO-707169"], tracking: ["1ZA0Y1502098202997"], store: "brampton", lines: [] });
  const m = parseMail(mail("serivce@pacificsmoke.com", "Your order no. SO-707823 has been fulfilled", "Dear Vaping Koi Inc,\n\nYour order no. SO-707823 has been fulfilled.\n1ZA0Y1502098206493"));
  assert.equal(m?.kind === "shipped" && m.store, "mississauga");
});

test("Pacific Smoke invoice opens an order; Auto-Ship invoices are already paid", () => {
  const inv = parseMail(mail("Order Desk <orders@pacificsmoke.com>", "Pacific Smoke International - Invoice: #INV-718010", "Dear Vaping Koi Inc :\n\nAttached is a copy of your latest invoice."));
  assert.equal(inv?.kind, "order");
  assert.deepEqual(inv?.kind === "order" && [inv.refs, inv.store, inv.paid], [["INV-718010"], "mississauga", false]);
  const asp = parseMail(mail("orders@pacificsmoke.com", "Q4 2026 ASP - Pacific Smoke International - Invoice: #INV-717354", "Dear Vaping Koi (Sunnyvale - Brampton) : This invoice has been sent to you as part of our Auto-Ship Program."));
  assert.deepEqual(asp?.kind === "order" && [asp.store, asp.paid], ["brampton", true]);
  assert.equal(parseMail(mail("account.receivable@pacificsmoke.com", "Unsettled Invoice First Reminder - Pacific Smoke International - Payment Required Invoice: #INV-714674", "")), null);
});

test("Pacific Smoke cancellation", () => {
  const e = parseMail(mail("account.receivable@pacificsmoke.com", "Cancelled - RE: Unsettled Invoice Second Reminder - Payment Required Invoice: #INV-710342", "we have cancelled this order."));
  assert.deepEqual(e, { kind: "cancelled", distributor: "Pacific Smoke", refs: ["INV-710342"] });
});

const VALOR_SHIPPED = `We're happy to let you know that your order has been shipped!

Order No. #1106698A

Track
Shipment
( https://www.fedex.com/fedextrack/?trknbr=879802825944 )

Shipped Items : 28

STLTH LINK MARKETING
BUNDLE
( http://valordistributions.myshopify.com/products/stlth-link-marketing-bundle?syclid=f6 )

× 4

GRAPE SALT BY LEMON
DROP
( http://valordistributions.myshopify.com/products/grape-salt-by-lemon-drop?syclid=9d )

20MG / 30ML

× 1

STLTH LOOP 25K POD PACK

( http://valordistributions.myshopify.com/products/stlth-loop-25k-pod-pack-green-apple-ice-5pcs-ctn?syclid=3e )

GREEN APPLE ICE
(5PC/CTN) -

20MG / 20ML

× 1

Excise Tax
( http://valordistributions.myshopify.com/products/excise-tax-federal?syclid=77 )

Federal

× 1

Shipped To

Guillame Thai

Vaping Koi

4040 Creditview Road

Mississauga, ON L5C 3Y8

Shipping Method

FedEx

879802825944
`;

test("Valor shipped gives ref, FedEx tracking, store and item lines", () => {
  const e = parseMail(mail("Valor Distributions <wholesale@valordistributions.com>", "Valor Order #1106698A has been shipped", VALOR_SHIPPED));
  assert.equal(e?.kind, "shipped");
  if (e?.kind !== "shipped") return;
  assert.deepEqual(e.refs, ["#1106698A"]);
  assert.deepEqual(e.tracking, ["879802825944"]);
  assert.equal(e.store, "mississauga");
  assert.deepEqual(e.lines, [
    { name: "GRAPE SALT BY LEMON DROP · 20MG / 30ML", qty: 1 },
    { name: "STLTH LOOP 25K POD PACK · GREEN APPLE ICE (5PC/CTN) 20MG / 20ML", qty: 1 },
  ]);
});

test("Valor delivered, confirmation and invoice", () => {
  const d = parseMail(mail("wholesale@valordistributions.com", "A shipment from order #1095769A has been delivered", "Shipping Address\n\n50 Sunnyvale Gate\n\nBrampton, ON\n\nShipping Method\n\nUPS\n\n1Z0A29Y72096634623"));
  assert.deepEqual(d, { kind: "delivered", distributor: "Valor Distributions", refs: ["#1095769A"], tracking: ["1Z0A29Y72096634623"], store: "brampton" });
  const c = parseMail(mail("wholesale@valordistributions.com", "Valor Order #1107818 Confirmed", "Thank you for your purchase"));
  assert.deepEqual(c?.kind === "order" && c.refs, ["#1107818"]);
  const i = parseMail(mail("payment@valordistributions.com", "Valor Invoice #1107818A", "Subtotal\n$400.00\n\nTotal\n$446.34"));
  assert.deepEqual(i, { kind: "invoice", distributor: "Valor Distributions", refs: ["#1107818A"], amount: 446.34, store: null });
});

test("Nimbus order confirmation gives total and lines", () => {
  const body =
    "#100842\n\nThank you for your purchase!\n\nOrder Summary\n\nOrbito Slim 18K - Grape Ice (4pc/Carton)\n[Ontario]\n\nQty: 1\n\nGrape Ice\n\n$71.80\n\n$61.01\n\nOrbito Lumo AI 120K (20mg) - X Mint\n(4pc/Carton) [Federal]\n\nQty: 2\n\nX Mint\n\n$177.20\n\nSubtotal\n$965.40\n\nShipping\n$20.00\n\nTaxes\n$128.10\n\nTotal\n$1,113.50 CAD\n\nShipping Address\n\nVaping Koi Inc.\n4040 Creditview Road, Unit 11\nMississauga ON";
  const e = parseMail(mail("Nimbus Distro <info@nimbusdistro.ca>", "Order #100842 confirmed", body));
  assert.equal(e?.kind, "order");
  if (e?.kind !== "order") return;
  assert.deepEqual([e.distributor, e.refs, e.amount, e.store], ["NimbusDistro", ["#100842"], 1113.5, "mississauga"]);
  assert.deepEqual(e.lines, [
    { name: "Orbito Slim 18K - Grape Ice (4pc/Carton) [Ontario]", qty: 1 },
    { name: "Orbito Lumo AI 120K (20mg) - X Mint (4pc/Carton) [Federal]", qty: 2 },
  ]);
});

test("GCore order received gives table lines and total", () => {
  const body =
    "| Hi Guillaume, Thanks for your order. ## [Order #139984] (November 7, 2026) |\n| Product | Quantity | Price |\n|---|---|---|\n| Peach Strawberry Ice Ripper X 75K (20mg/ML / 5PCs) (Excise Incl.) | 1 | $65.06 |\n| BLUE RAZZ (10mg/ml) 60ml (Excise Incl.) | 3 | $75.60 |\n\n| Subtotal: | $471.71 |\n|---|---|\n| Total: | $566.95 |\n|---|---|\n\nLocation: FEDERAL - Excise stamp: Federal\n| ## Shipping address Vaping Koi Unit 11 - 4040 Creditview Rd Mississauga ON |";
  const e = parseMail(mail("GCORE & RUFPUF <do-not-reply@gcorecanada.com>", "Your Gcore Vape order has been received!", body));
  assert.equal(e?.kind, "order");
  if (e?.kind !== "order") return;
  assert.deepEqual([e.distributor, e.refs, e.amount, e.store], ["GCore Canada", ["#139984"], 566.95, "mississauga"]);
  assert.deepEqual(e.lines, [
    { name: "Peach Strawberry Ice Ripper X 75K (20mg/ML / 5PCs)", qty: 1 },
    { name: "BLUE RAZZ (10mg/ml) 60ml", qty: 3 },
  ]);
});

test("UPS ship and delivery notifications", () => {
  const ship = parseMail(
    mail(
      "UPS <pkginfo@ups.com>",
      "UPS Ship Notification, Tracking Number 1ZAC61690443650817",
      "You have a package coming.\n\nShipment Details\n\nFrom: GCORE CANADA\n\nTracking Number: 1ZAC61690443650817\n\nShip To: \n\nVAPING KOI\n4040 Creditview Road\n#11\nMississauga, ON L5C3Y8",
    ),
  );
  assert.deepEqual(ship, { kind: "shipped", distributor: "GCore Canada", refs: [], tracking: ["1ZAC61690443650817"], store: "mississauga", lines: [] });
  const del = parseMail(mail("pkginfo@ups.com", "UPS Delivery Notification, Tracking Number 1ZK96A222021108689", "Hello, your package has been delivered."));
  assert.deepEqual(del?.kind === "delivered" && del.tracking, ["1ZK96A222021108689"]);
});

test("promotions and other mail are ignored", () => {
  assert.equal(parseMail(mail("Dean.Farndell@pacificsmoke.com", "Kraze Luna Link Is LIVE! Enjoy 10% OFF", "Order now")), null);
  assert.equal(parseMail(mail("noreply@joinhomebase.com", "Your week", "tracking")), null);
});

test("ref keys line up Valor confirmations with invoices", () => {
  assert.equal(refKey("#1106698"), refKey("#1106698A"));
  assert.notEqual(refKey("SO-707823"), refKey("INV-718010"));
  assert.deepEqual(trackingNumbers("1ZA0Y1502098206493 and again 1ZA0Y1502098206493"), ["1ZA0Y1502098206493"]);
});

test("payments match by ref, then by distributor and amount", () => {
  const orders = [
    order({ id: 1, distributor: "Pacific Smoke", refs: ["INV-718010"] }),
    order({ id: 2, distributor: "Pacific Smoke", refs: ["INV-714674"], createdAt: new Date("2026-10-29") }),
    order({ id: 3, distributor: "Valor Distributions", refs: ["#1106698"], amount: 446.34 }),
    order({ id: 4, distributor: "Valor Distributions", refs: ["#1107818"], amount: 300 }),
  ];
  const pay = (distributor: string, amount: number, refs: string[] = []) =>
    ({ kind: "payment", payee: distributor, distributor, amount, refs, message: "" }) as const;
  assert.equal(matchOrder(pay("Pacific Smoke", 1078.84, ["INV-718010", "SO-707823"]), orders)?.id, 1);
  assert.equal(matchOrder(pay("Valor Distributions", 446.34), orders)?.id, 3);
  assert.equal(matchOrder(pay("Valor Distributions", 999), orders), null);
  // Two unpaid Pacific Smoke orders without amounts: too risky to guess.
  assert.equal(matchOrder(pay("Pacific Smoke", 1125.21), orders), null);
});

test("shipping matches by ref (Valor A-suffix), tracking, or oldest paid order from that distributor and store", () => {
  const orders = [
    order({ id: 1, distributor: "Valor Distributions", refs: ["#1106698"], stage: 2 }),
    order({ id: 2, distributor: "Pacific Smoke", refs: ["INV-718010", "SO-707823"], stage: 2 }),
    order({ id: 3, distributor: "Pacific Smoke", refs: ["INV-717354"], stage: 2, store: "brampton" }),
    order({ id: 4, distributor: "GCore Canada", refs: ["#139984"], stage: 1, tracking: [] }),
  ];
  const ship = (distributor: string | null, refs: string[], tracking: string[], store: "mississauga" | "brampton" | null = null): MailEvent =>
    ({ kind: "shipped", distributor, refs, tracking, store, lines: [] });
  assert.equal(matchOrder(ship("Valor Distributions", ["#1106698A"], []), orders)?.id, 1);
  assert.equal(matchOrder(ship("Pacific Smoke", ["SO-707823"], []), orders)?.id, 2);
  assert.equal(matchOrder(ship("Pacific Smoke", ["SO-707169"], [], "brampton"), orders)?.id, 3);
  assert.equal(matchOrder(ship("GCore Canada", [], ["1ZAC61690443650817"], "mississauga"), orders)?.id, 4);
  const withTracking = orders.map((o) => (o.id === 4 ? { ...o, tracking: ["1ZAC61690443650817"], stage: 3 } : o));
  assert.equal(matchOrder({ kind: "delivered", distributor: null, refs: [], tracking: ["1ZAC61690443650817"], store: null }, withTracking)?.id, 4);
});

test("stages only move forward", () => {
  assert.equal(stageAfter(1, { kind: "payment", payee: "x", distributor: null, amount: 1, refs: [], message: "" }), 2);
  assert.equal(stageAfter(4, { kind: "shipped", distributor: null, refs: [], tracking: [], store: null, lines: [] }), 4);
});
