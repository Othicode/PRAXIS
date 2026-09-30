"use strict";
/* ==========================================================================
   PW Budget — calculation audit
   ==========================================================================
   Answers one question: does the arithmetic in this app actually hold up?

   Three sections:

     1. CALCULATOR  — drives the real calcEval()/calcPush() with a battery of
                      expressions, simulated key taps, and malformed input.

     2. PARITY      — replays one identical call sequence against BOTH engines
                      (public/app/db.js offline, server.py over HTTP) and
                      requires identical status codes, numbers and error
                      strings. The two are documented as mirrors, so any
                      divergence means a user gets different figures online
                      than offline. Opaque row ids are ignored because the
                      engines ship different seed catalogs by design.

     3. INVARIANTS  — arithmetic that must hold no matter the engine: credit
                      paid+balance==total, qty*unit_price==total, analytics
                      breakdowns summing to their totals, budget
                      spendable==total-save, allocation percents summing to
                      100, and the validation rules that keep them true.

   Self-contained: it starts its OWN server on a free port against a throwaway
   data directory, so it never touches your real ledger.db.

   Run:  node audit_calculations.js
   ========================================================================== */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const REPO = __dirname;
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;

let pass = 0, fail = 0;
const bad = [];
function ok(label, cond, detail) {
  if (cond) pass++;
  else { fail++; bad.push(`  ${label}${detail ? "\n     " + detail : ""}`); }
}

/* ======================================================================
   1. environment: DOM stubs so app.js can be loaded headlessly
   ====================================================================== */
class ClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  contains(c) { return this.s.has(c); }
  toggle(c, f) {
    if (f === undefined) this.s.has(c) ? this.s.delete(c) : this.s.add(c);
    else f ? this.s.add(c) : this.s.delete(c);
  }
}
const registry = new Map();
class El {
  constructor(tag, id) {
    this.tagName = tag || "div"; this.id = id || null;
    this.classList = new ClassList(); this.className = ""; this.value = "";
    this._html = ""; this.textContent = ""; this.dataset = {}; this.style = {};
    this.children = []; this._listeners = {}; this.disabled = false;
    this.checked = false; this._attrs = {};
    if (id) registry.set(id, this);
  }
  setAttribute(k, v) { this._attrs[k] = String(v); this[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; delete this[k]; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  remove() {} close() {} showModal() {} focus() {}
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  querySelector() { return new El("div", null); }
  querySelectorAll() { return []; }
  closest() { return null; }
}
const byId = (id) => registry.get(id) || new El("div", id);
const make = (sel) => {
  sel = String(sel).trim();
  return sel.startsWith("#") ? byId(sel.slice(1)) : new El("div", null);
};
class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

// Capture Node's real fetch BEFORE stubbing global.fetch below — the health
// probe and the server half of the parity test both need the genuine article.
const nativeFetch = globalThis.fetch;

global.document = {
  title: "", body: new El("body"), documentElement: new El("html"),
  querySelector: (s) => (/theme-color/.test(String(s))
    ? Object.assign(new El("meta"), { setAttribute() {} }) : make(s)),
  querySelectorAll: () => [], createElement: (t) => new El(t), addEventListener() {},
};
global.window = {
  _creditCache: [], _picked: null,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
global.localStorage = new FakeStorage();
global.location = { search: "?offline" };
global.confirm = () => true;
global.fetch = () => Promise.reject(new Error("offline"));

require(path.join(REPO, "public", "app", "db.js"));

/* Pull the calculator internals out of the real app.js without editing it. */
function loadCalculator() {
  const src = fs.readFileSync(path.join(REPO, "public", "app", "app.js"), "utf8");
  const tmp = path.join(REPO, `_audit_app_${process.pid}.js`);
  fs.writeFileSync(tmp, src + `
module.exports = { calcEval, calcPush, fmtCalc, CALC_KEYS,
  get calcRes() { return calcRes; }, get calcExpr() { return calcExpr; } };
`);
  try { return require(tmp); }
  finally { try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ } }
}

/* ======================================================================
   1b. calculator battery
   ====================================================================== */
function auditCalculator(C) {
  console.log("== 1. calculator ==");

  const minusKey = C.CALC_KEYS.find((k) => k === "-" || k === "\u2212");
  ok("keypad has a minus key", !!minusKey, JSON.stringify(C.CALC_KEYS));
  ok("keypad's minus is U+2212 MINUS SIGN",
    minusKey === "\u2212",
    minusKey ? `code point ${minusKey.codePointAt(0)}` : "absent");
  ok("calcEval accepts the keypad's U+2212 minus",
    !Number.isNaN(C.calcEval(`7\u22123`)));
  ok("calcEval accepts ASCII hyphen (from ± and typed input)",
    !Number.isNaN(C.calcEval("7-3")));

  // direct evaluation
  const ev = [
    ["7-3", 4], ["7\u22123", 4], ["10-4-3", 3], ["2-8", -6], ["9-9", 0],
    ["3\u22121\u22121", 1], ["100-1-1-1", 97], ["1\u22122\u22123\u22124", -8],
    ["7\u22120", 7], ["0\u22125\u00d72", -10], ["-5+3", -2], ["\u22125+3", -2],
    ["12\u00d734", 408], ["2+3\u00d74", 14], ["100\u00f74", 25], ["5\u00f72", 2.5],
    ["2^10", 1024], ["5^2", 25], ["2^3^2", 512], ["2^2^2", 16],
    ["\u221a9", 3], ["\u221a(16)", 4], ["\u221a9+7", 10],
    ["(2+3)\u00d74", 20], ["2\u00d7(3+4)", 14], ["((2))", 2],
    ["200%", 2], ["50%\u00d780", 40],
    ["1.5\u00d72", 3], ["0.1+0.2", 0.30000000000000004], ["5\u00f70", Infinity],
  ];
  for (const [e, w] of ev) {
    const got = C.calcEval(e);
    const same = (typeof w === "number" && Number.isFinite(w))
      ? (Number.isFinite(got) && Math.abs(got - w) < 1e-9)
      : Object.is(got, w);
    ok(`calcEval(${JSON.stringify(e)})`, same, `got ${got} want ${w}`);
  }

  // malformed input must fail loudly rather than answer a plausible wrong number
  for (const e of ["", "5\u00f7", "+", "()", "abc", "5+", "(", "5..3", "5\u00d7\u00f73"]) {
    const v = C.calcEval(e);
    ok(`calcEval(${JSON.stringify(e)}) rejects malformed input`,
      !Number.isFinite(v), `got ${v}`);
  }

  // what a user actually does: tap keys
  const tap = (keys) => {
    C.calcPush("AC");
    for (const k of keys) C.calcPush(k);
    C.calcPush("=");
    return C.calcRes;
  };
  const taps = [
    [["7", minusKey, "3"], 4],
    [["1", "0", minusKey, "2", "0"], -10],
    [["9", minusKey, "9"], 0],
    [["7", minusKey, "3", "+", "1"], 5],
    [["8", minusKey, "2", "\u00d7", "3"], 2],
    [["3", minusKey, "1", minusKey, "1"], 1],
    [["1", "2", "\u00d7", "3", "4"], 408],
    [["2", "+", "3", "\u00d7", "4"], 14],
    [["1", "0", "0", "\u00f7", "4"], 25],
    [["6", "+", "7"], 13],
    [["1", ".", "5", "\u00d7", "2"], 3],
    [["5", "x\u00b2"], 25],
    [["2", "x\u00b2", "x\u00b2"], 16],
    [["2", "0", "0", "%"], 2],
    [["5", "0", "%", "\u00d7", "8", "0"], 40],
    [["(", "2", "+", "3", ")", "\u00d7", "4"], 20],
    [["\u221a", "9", ")"], 3],
    [["\u00b1", "5"], -5],
    [["8", "\u00b1"], -8],
    [["5", "\u00f7", "0"], "Error"],
  ];
  for (const [keys, w] of taps) {
    const got = tap(keys);
    const same = typeof w === "number"
      ? (typeof got === "number" && Math.abs(got - w) < 1e-9)
      : got === w;
    ok(`tap(${keys.join("")})`, same, `got ${JSON.stringify(got)} want ${JSON.stringify(w)}`);
  }

  // display formatting: no float noise leaking to the screen
  ok("fmtCalc(408)", C.fmtCalc(408) === "408", C.fmtCalc(408));
  ok("fmtCalc(0.1+0.2) hides float error", C.fmtCalc(0.30000000000000004) === "0.3",
    C.fmtCalc(0.30000000000000004));
  ok("fmtCalc(Infinity) reads Error", C.fmtCalc(Infinity) === "Error", C.fmtCalc(Infinity));
  ok("fmtCalc(1/3) caps at 10 fraction digits", C.fmtCalc(1 / 3) === "0.3333333333",
    C.fmtCalc(1 / 3));
  ok("fmtCalc(-10)", C.fmtCalc(-10) === "-10", C.fmtCalc(-10));
}

/* ======================================================================
   server lifecycle — a throwaway instance on a free port
   ====================================================================== */
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

async function waitForHealth(base, child, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (child.exitCode !== null) throw new Error("server exited early");
    try {
      const r = await nativeFetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    if (Date.now() > deadline) throw new Error("server did not become healthy");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/* ======================================================================
   2/3. shared scenario + invariants
   ====================================================================== */
const offline = (method, p, qs, body) => {
  const r = PWDB.request(method, p, qs || {}, body || {});
  return { status: r.status, body: r.body };
};
function serverCall(base) {
  return async (method, p, qs, body) => {
    const u = new URL(base + p);
    for (const [k, v] of Object.entries(qs || {})) {
      if (v !== "" && v != null) u.searchParams.set(k, v);
    }
    const res = await nativeFetch(u, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch (e) { j = { __raw: text.slice(0, 200) }; }
    return { status: res.status, body: j };
  };
}

async function scenario(call) {
  const log = [];
  const step = async (label, method, p, qs, body) => {
    const r = await call(method, p, qs, body);
    log.push({ label, status: r.status, body: r.body });
    return r;
  };

  const meta1 = await step("meta:initial", "GET", "/api/meta");
  const bid1 = meta1.body.branches[0] && meta1.body.branches[0].id;
  const b2 = await step("branch:add", "POST", "/api/branches", {}, { name: "Accra North" });
  const BR2 = b2.body.id;

  // purchases — fractional quantity, exact totals, credit, multiple branches
  await step("purchase:cash fractional qty", "POST", "/api/purchases", {}, {
    date: "2026-08-15", branch_id: bid1, distributor: "Ceda Industrial",
    product: "DTF Powder", unit: "bag", quantity: 2.5,
    total_amount: 271.75, payment_method: "Cash",
  });
  await step("purchase:cash qty 3", "POST", "/api/purchases", {}, {
    date: "2026-08-20", branch_id: bid1, distributor: "Ceda Industrial",
    product: "Vinyl Roll", unit: "roll", quantity: 3,
    total_amount: 1000, payment_method: "Cash", memo: "restock",
  });
  await step("purchase:credit 9000", "POST", "/api/purchases", {}, {
    date: "2026-09-01", branch_id: bid1, distributor: "Alpha Inks",
    product: "Ink Set", unit: "set", quantity: 10,
    total_amount: 9000, payment_method: "Credit", credit_paid: 0,
  });
  await step("purchase:credit prepaid", "POST", "/api/purchases", {}, {
    date: "2026-09-05", branch_id: bid1, distributor: "Alpha Inks",
    product: "Foil", unit: "pack", quantity: 4,
    total_amount: 1200, payment_method: "Credit", credit_paid: 1200,
  });
  const pLast = await step("purchase:2nd branch", "POST", "/api/purchases", {}, {
    date: "2026-09-08", branch_id: BR2, distributor: "Ceda Industrial",
    product: "DTF Powder", unit: "bag", quantity: 1,
    total_amount: 500, payment_method: "Mobile Money",
  });

  await step("purchases:list", "GET", "/api/purchases", { page: 1, page_size: 50 });
  await step("purchases:owed", "GET", "/api/purchases", { owed: 1 });
  await step("purchases:filter branch", "GET", "/api/purchases", { branch_id: BR2 });
  await step("purchases:filter month", "GET", "/api/purchases", { month: "2026-08" });
  await step("purchases:search", "GET", "/api/purchases", { q: "dtf" });

  const credits1 = await step("credits:initial", "GET", "/api/credits");
  const openId = credits1.body.open[0] && credits1.body.open[0].id;

  // credit payments — partial, invalid, over, exact
  await step("credit:pay partial 2500", "POST", `/api/purchases/${openId}/pay`, {},
    { date: "2026-09-12", amount: 2500 });
  const c2 = await step("credits:after partial", "GET", "/api/credits");
  await step("credit:pay overpay", "POST", `/api/purchases/${openId}/pay`, {},
    { date: "2026-09-13", amount: 999999 });
  await step("credit:pay zero", "POST", `/api/purchases/${openId}/pay`, {},
    { date: "2026-09-13", amount: 0 });
  await step("credit:pay negative", "POST", `/api/purchases/${openId}/pay`, {},
    { date: "2026-09-13", amount: -50 });
  await step("credit:pay bad date", "POST", `/api/purchases/${openId}/pay`, {},
    { date: "13/09/2026", amount: 10 });
  const bal = c2.body.open[0].balance;
  await step("credit:pay exact balance", "POST", `/api/purchases/${openId}/pay`, {},
    { date: "2026-09-14", amount: bal });
  await step("credits:settled", "GET", "/api/credits");
  await step("purchases:owed after settle", "GET", "/api/purchases", { owed: 1 });

  // analytics & budget
  await step("analytics:6mo", "GET", "/api/analytics", { n: 6 });
  await step("analytics:branch", "GET", "/api/analytics", { n: 6, branch_id: BR2 });
  await step("budget:get (unsaved)", "GET", "/api/budget", { year: 2026, month: 9 });
  await step("budget:save", "POST", "/api/budget", {}, {
    year: 2026, month: 9, branch_id: null, total_amount: 10000, save_amount: 1000,
    allocations: [
      { name: "DTF Powder", percent: 50 },
      { name: "Vinyl Roll", percent: 30 },
      { name: "Ink Set", percent: 20 },
    ],
  });
  await step("budget:get (saved)", "GET", "/api/budget", { year: 2026, month: 9 });
  await step("budget:save zero total", "POST", "/api/budget", {},
    { year: 2026, month: 10, total_amount: 0, save_amount: 0 });
  await step("budget:save empty allocs", "POST", "/api/budget", {},
    { year: 2026, month: 9, total_amount: 5000, save_amount: 500, allocations: [] });

  // validation errors — these must match byte-for-byte across engines
  const stub = { date: "2026-09-10", branch_id: bid1, distributor: "X",
    product: "Y", unit: "bag", quantity: 1, total_amount: 10, payment_method: "Cash" };
  await step("err:bad date", "POST", "/api/purchases", {},
    { ...stub, date: "nope" });
  await step("err:zero qty", "POST", "/api/purchases", {},
    { ...stub, quantity: 0 });
  await step("err:zero total", "POST", "/api/purchases", {},
    { ...stub, total_amount: 0 });
  await step("err:bad payment", "POST", "/api/purchases", {},
    { ...stub, payment_method: "Bitcoin" });
  await step("err:credit overpay at create", "POST", "/api/purchases", {},
    { ...stub, total_amount: 100, payment_method: "Credit", credit_paid: 5000 });
  await step("err:bad branch", "POST", "/api/purchases", {},
    { ...stub, branch_id: 99999 });
  await step("err:unknown route", "GET", "/api/nope");

  await step("purchase:delete", "DELETE", `/api/purchases/${pLast.body.id}`);
  await step("purchases:final", "GET", "/api/purchases", { page: 1, page_size: 50 });
  await step("analytics:final", "GET", "/api/analytics", { n: 6 });
  await step("meta:final", "GET", "/api/meta");

  return log;
}

function invariants(log, name) {
  const at = (l) => log.find((s) => s.label === l);
  const before = at("credits:after partial").body.open[0];
  const settled = at("credits:settled").body;
  const analytics = at("analytics:6mo").body;
  const budget = at("budget:get (saved)").body;
  const purchases = at("purchases:list").body;

  /* --- credit --- */
  ok(`${name}: paid + balance == total`, r2(before.paid + before.balance) === before.total,
    `paid ${before.paid} + balance ${before.balance} != total ${before.total}`);
  ok(`${name}: percent stays within 0..100`, before.percent >= 0 && before.percent <= 100,
    `percent ${before.percent}`);
  ok(`${name}: percent == paid/total*100 (1dp)`,
    before.percent === r1(before.paid / before.total * 100),
    `percent ${before.percent} vs ${r1(before.paid / before.total * 100)}`);
  ok(`${name}: remaining == 100-percent (1dp)`, before.remaining === r1(100 - before.percent),
    `remaining ${before.remaining}`);
  ok(`${name}: 2500 of 9000 paid -> 6500 balance`, before.paid === 2500 && before.balance === 6500,
    `paid ${before.paid} balance ${before.balance}`);
  ok(`${name}: settling zeroes the balance and hits 100%`,
    settled.open.length === 0 &&
    settled.settled.some((c) => c.percent === 100 && c.balance === 0),
    JSON.stringify(settled));
  ok(`${name}: outstanding == sum of open balances`,
    settled.outstanding === r2(settled.open.reduce((s, c) => s + c.balance, 0)),
    `outstanding ${settled.outstanding}`);
  ok(`${name}: nothing left owed after settling`,
    at("purchases:owed after settle").body.total === 0,
    `total ${at("purchases:owed after settle").body.total}`);
  ok(`${name}: overpay rejected with 400`,
    at("credit:pay overpay").status === 400 &&
    /cannot exceed|exceeds remaining/.test(at("credit:pay overpay").body.error || ""),
    JSON.stringify(at("credit:pay overpay")));
  ok(`${name}: zero and negative payments rejected`,
    at("credit:pay zero").status === 400 && at("credit:pay negative").status === 400,
    `${at("credit:pay zero").status}/${at("credit:pay negative").status}`);

  /* --- purchases --- */
  for (const s of purchases.rows) {
    const expect = r2(s.quantity * s.unit_price);
    ok(`${name}: row ${s.id} qty*unit_price == total`, Math.abs(expect - s.total) < 0.02,
      `${s.quantity} * ${s.unit_price} = ${expect} vs total ${s.total}`);
    ok(`${name}: row ${s.id} total is a clean 2dp number`,
      Math.abs(r2(s.total) - s.total) < 1e-9, String(s.total));
  }
  const frac = purchases.rows.find((r) => r.quantity === 2.5);
  ok(`${name}: fractional quantity price stored at 4dp`,
    frac && Math.abs(frac.unit_price - 108.7) < 1e-9, frac && String(frac.unit_price));
  const three = purchases.rows.find((r) => r.quantity === 3 && r.total === 1000);
  ok(`${name}: 1000/3 unit price == 333.3333`,
    three && three.unit_price === 333.3333, three && String(three && three.unit_price));

  /* --- analytics: the breakdowns must add up to the whole --- */
  const T = analytics.totals.spend;
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  for (const [label, arr] of [
    ["by_distributor", analytics.by_distributor],
    ["payment_split", analytics.payment_split],
    ["months", analytics.months],
    ["top_items", analytics.top_items],
  ]) {
    const got = r2(sum(arr, "spend"));
    ok(`${name}: sum(${label}.spend) == totals.spend`, Math.abs(got - T) < 0.02,
      `${got} vs ${T}`);
  }
  const shares = sum(analytics.top_items, "share");
  ok(`${name}: top_items shares sum to 100`, Math.abs(shares - 100) <= 0.6, `shares ${shares}`);
  ok(`${name}: payment_split non-negative`,
    analytics.payment_split.length >= 1 && analytics.payment_split.every((p) => p.spend >= 0),
    JSON.stringify(analytics.payment_split));
  ok(`${name}: credit_outstanding within total_credit`,
    analytics.totals.credit_outstanding >= 0 &&
    analytics.totals.credit_outstanding <= analytics.totals.total_credit,
    `outstanding ${analytics.totals.credit_outstanding} of ${analytics.totals.total_credit}`);

  /* --- budget --- */
  ok(`${name}: spendable == max(total - save, 0)`,
    budget.spendable === r2(Math.max(budget.total_amount - budget.save_amount, 0)),
    `spendable ${budget.spendable} vs ${budget.total_amount}-${budget.save_amount}`);
  ok(`${name}: budget round-trips 10000/1000`,
    budget.total_amount === 10000 && budget.save_amount === 1000 && budget.saved === true,
    JSON.stringify({ t: budget.total_amount, s: budget.save_amount, saved: budget.saved }));
  ok(`${name}: allocation amounts == spendable*pct/100`,
    budget.allocations.every((a) => a.amount === r2(budget.spendable * a.percent / 100)),
    JSON.stringify(budget.allocations));
  const pctSum = budget.allocations.reduce((s, a) => s + a.percent, 0);
  ok(`${name}: allocation percents sum to 100`, Math.abs(pctSum - 100) < 0.5, `sum ${pctSum}`);
  const amtSum = r2(budget.allocations.reduce((s, a) => s + a.amount, 0));
  ok(`${name}: sum(allocation amounts) == spendable`,
    Math.abs(amtSum - budget.spendable) < 0.1, `sum ${amtSum} vs spendable ${budget.spendable}`);
  ok(`${name}: per-allocation actual spend never negative`,
    budget.allocations.every((a) => a.actual >= 0), JSON.stringify(budget.allocations));
  ok(`${name}: budget rejects zero total`, at("budget:save zero total").status === 400,
    String(at("budget:save zero total").status));
  const emptyAlloc = at("budget:save empty allocs").body;
  ok(`${name}: empty allocations fall back to a recommendation`,
    emptyAlloc.allocations.length > 0, JSON.stringify(emptyAlloc.allocations));
  const recSum = emptyAlloc.allocations.reduce((s, a) => s + a.percent, 0);
  ok(`${name}: auto-recommended percents sum to 100 despite 1dp rounding`,
    Math.abs(recSum - 100) < 0.15, `sum ${recSum}`);
}

/* ======================================================================
   main
   ====================================================================== */
(async function main() {
  let child = null, tmpDir = null;
  const started = Date.now();
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pwbudget-audit-"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    child = spawn("python",
      [path.join(REPO, "server.py"), String(port)],
      { cwd: REPO, env: { ...process.env, PWBUDGET_DATA_DIR: tmpDir }, stdio: "ignore" });
    await waitForHealth(base, child);

    const C = loadCalculator();
    auditCalculator(C);

    console.log("\n== 2. engine parity (offline db.js vs server.py) ==");
    global.localStorage.clear();
    const off = await scenario(offline);
    const srv = await scenario(serverCall(base));

    // Opaque ids differ by design: db.js ships a starter catalog so a fresh
    // install isn't empty, server.py starts empty unless --demo. Ignore them,
    // compare every number, status and error string.
    const ID_KEY = /^(id|branch_id|product_id|distributor_id|purchase_id|budget_id)$/;
    const norm = (v) => {
      if (Array.isArray(v)) return v.map(norm);
      if (v && typeof v === "object") {
        const o = {};
        for (const [k, val] of Object.entries(v)) o[k] = ID_KEY.test(k) ? "<id>" : norm(val);
        return o;
      }
      return v;
    };
    let diffs = 0;
    for (let i = 0; i < Math.max(off.length, srv.length); i++) {
      const a = off[i], b = srv[i];
      if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) {
        diffs++;
        console.log(`  DIVERGE [${(a || b).label}]`);
        console.log(`     offline: ${JSON.stringify(norm(a))}`);
        console.log(`     server : ${JSON.stringify(norm(b))}`);
      }
    }
    ok("engines return identical responses", diffs === 0, `${diffs} divergent step(s)`);
    console.log(`  ${off.length} steps compared, ${diffs} divergent`);

    console.log("\n== 3. invariants ==");
    const before = fail;
    invariants(off, "offline");
    invariants(srv, "server");
    console.log(`  ${fail - before} failure(s)`);

    console.log(`\n==== ${pass} passed, ${fail} failed (${((Date.now() - started) / 1000).toFixed(1)}s) ====`);
    if (bad.length) { console.log("\nFAILURES:"); bad.forEach((b) => console.log(b)); }
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error("audit could not run:", e.message);
    process.exitCode = 2;
  } finally {
    if (child) { try { child.kill(); } catch (e) { /* already gone */ } }
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  }
})();
