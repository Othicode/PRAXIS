"use strict";
/* Headless smoke test for PW Budget.
   Runs the REAL public/app/app.js (+ db.js) inside Node with a minimal DOM stub.
   Two passes: "offline" (PWA engine, localStorage, no network) and "server" (fetch).
   Also verifies the calculator widget + its math. */
const fs = require("fs");
const path = require("path");
const TRACE = process.env.PW_TRACE === "1";
const BASE = "http://127.0.0.1:8123";

/* ---------------- fake DOM ---------------- */
class ClassList {
  constructor() { this.s = new Set(); }
  add(...cs) { cs.forEach((c) => this.s.add(c)); }
  remove(...cs) { cs.forEach((c) => this.s.delete(c)); }
  contains(c) { return this.s.has(c); }
  toggle(c, force) {
    if (force === undefined) this.s.has(c) ? this.s.delete(c) : this.s.add(c);
    else if (force) this.s.add(c);
    else this.s.delete(c);
  }
}
const registry = new Map();
class El {
  constructor(tag, id) {
    this.tagName = tag || "div";
    this.id = id || null;
    this.classList = new ClassList();
    this.className = "";
    this.value = "";
    this._html = "";
    this.textContent = "";
    this.dataset = {};
    this.style = {};
    this.children = [];
    this._listeners = {};
    this.disabled = false;
    this.checked = false;
    this._attrs = {};
    if (id) registry.set(id, this);
  }
  setAttribute(k, v) { this._attrs[k] = String(v); this[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; delete this[k]; }
  reset() { this.value = ""; }   // HTMLFormElement.reset(), as the stub's "form"
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this.children = []; // mirror real DOM: assigning innerHTML replaces children
    const opt = String(v).match(/<option[^>]*selected[^>]*>([^<]+)<\/option>/);
    if (opt) this.value = opt[1].trim();
  }
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  close() {}
  showModal() {}
  focus() {}
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  dispatch(t, ev) {
    const e = Object.assign({ target: this, currentTarget: this, preventDefault() {} }, ev || {});
    (this._listeners[t] || []).forEach((fn) => fn(e));
  }
  querySelector() { return new El("div", null); }
  querySelectorAll() { return []; }
  closest() { return null; }
}
function byId(id) {
  let el = registry.get(id);
  if (!el) el = new El("div", id);
  return el;
}
function make(sel) {
  sel = String(sel).trim();
  if (sel.startsWith("#")) return byId(sel.slice(1));
  return new El("div", null);
}
function makeDocument() {
  const metaTheme = new El("meta", null);   // <meta name="theme-color">
  metaTheme.setAttribute("content", "#07070a");
  return {
    title: "",
    body: new El("body", null),
    documentElement: new El("html", null),
    querySelector: (sel) => (/theme-color/.test(String(sel)) ? metaTheme : make(sel)),
    /* recordStatement() ticks real checkboxes; the stub hands back whatever
       the test staged in global.__stmtTicks instead of a parsed DOM. */
    querySelectorAll: (sel) => (String(sel).includes(".stmt-tick")
      ? (global.__stmtTicks || [])
      : [new El("div", null)]),
    createElement: (t) => new El(t, null),
    addEventListener() {},
  };
}
class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const realFetch = global.fetch;
global.fetch = (url, opts) =>
  realFetch(typeof url === "string" && !/^https?:\/\//.test(url) ? BASE + url : url, opts);
global.confirm = () => true;
require(path.join(__dirname, "public", "app", "db.js")); // exposes globalThis.PWDB

/* ---------------- load app in a mode ---------------- */
function loadApp(mode) {
  registry.clear();
  global.document = makeDocument();
  global.window = { _creditCache: [], _picked: null };
  global.localStorage = new FakeStorage();
  global.location = { search: mode === "offline" ? "?offline" : "" };
  const src = fs.readFileSync(path.join(__dirname, "public", "app", "app.js"), "utf8");
  const tmp = path.join(__dirname, `_app_${mode}.js`);
  fs.writeFileSync(tmp, src + `
module.exports = {
  get META() { return META; },
  get state() { return state; },
  init, switchView, loadDashboard, loadPurchases, loadCredits,
  loadAnalytics, loadBudget, loadBranches, loadIncome,
  openEntryDialog, openPayDialog, openIncomeDialog, updateCreditMode, updateLiveBox,
  submitEntry, submitPay, submitIncome, recommendedRows, saveBudget, addBranch, refreshMeta,
  readStatement, renderStatement, recordStatement, clearStatement,
  calcEval, calcPush, CALC_KEYS,
  runScan, renderReview, applyUncertain, fillEntryDraft, resetScan, scanOffline,
  aiConfigured, aiStatus, aiAllows, setAiArea, aiScopeSummary,
  renderAiStrip, renderAiSettings, renderAiAreas, aiExtractRequest, aiBuildContext,
  loadAI, saveAI,
  daysSince, ageTone, agePill, buildAlerts, renderAlerts, updateCreditBadge,
  applyTheme, currentTheme, toggleTheme,
};
`);
  return require(tmp);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitMeta(pw, timeout = 6000) {
  const t0 = Date.now();
  while (!pw.META && Date.now() - t0 < timeout) await sleep(100);
  return pw.META;
}
const get = (id) => byId(id);

/* ---------------- test runner ---------------- */
let pass = 0, fail = 0;
const results = [];
async function check(name, fn) {
  try {
    const r = await fn();
    if (!r) { fail++; results.push(["FAIL", name]); console.log("  FAIL  " + name); }
    else { pass++; results.push(["PASS", name]); console.log("  PASS  " + name); }
  } catch (e) {
    fail++; results.push(["FAIL", name + " :: " + e.message]);
    console.log("  FAIL  " + name + "  :: " + e.message);
    if (TRACE) console.log(e.stack);
  }
}

async function runMode(mode) {
  console.log(`\n########## MODE: ${mode} ##########`);
  const pw = loadApp(mode);
  await sleep(300);

  // server-mode persistence via API, offline via PWDB
  const apiGet = async (p) => mode === "offline"
    ? (await PWDB.request("GET", new URL(p, "https://pw.local").pathname, Object.fromEntries(new URL(p, "https://pw.local").searchParams), {} )).body
    : await (await fetch(BASE + p)).json();

  const stamp = "smoke-" + mode + "-" + Date.now();
  let creditId = null;

  await check(mode + ": boot & meta (branches present, no purchases)", async () => {
    const m = await waitMeta(pw);
    if (!m) return false;
    const p = await apiGet("/api/purchases");
    // branches can't be deleted via the API, so they accumulate across runs;
    // run tools/cleanup_smoke.py to reset to a single branch. Purchases must be clean.
    return m.branches.length >= 1 && p.rows.length === 0;
  });

  for (const v of ["dashboard", "purchases", "income", "credits", "analytics", "budget", "branches"]) {
    await check(mode + `: view '${v}' renders`, async () => {
      await pw.switchView(v);
      return !get("view-" + v).classList.contains("hidden");
    });
  }
  await check(mode + ": dashboard KPIs rendered", () =>
    get("kpis").innerHTML.includes("Spend this month"));

  // ---- cash purchase through the real UI ----
  await check(mode + ": dialog opens", () => { pw.openEntryDialog(); return get("f-dist").value === ""; });
  get("f-date").value = new Date().toISOString().slice(0, 10);
  get("f-branch").value = "1";
  get("f-dist").value = "Smoke Dist " + stamp;
  get("f-product").value = "Smoke Item " + stamp;
  get("f-unit").value = "bag";
  get("f-qty").value = "200";
  get("f-total").value = "21600";
  get("f-method").value = "Cash";
  get("f-memo").value = stamp;
  pw.updateLiveBox();
  await check(mode + ": live box unit price GH 108", () => get("live-box").innerHTML.includes("108"));
  await check(mode + ": submit cash purchase", async () => {
    await pw.submitEntry({ preventDefault() {} });
    await sleep(300);
    return get("form-err").textContent === "";
  });
  await check(mode + ": purchase persisted", async () => {
    const p = await apiGet("/api/purchases?page_size=50");
    return p.rows.some((r) => (r.memo || "").includes(stamp));
  });

  // ---- credit + later payment ----
  await check(mode + ": credit mode field toggle", () => {
    pw.openEntryDialog();
    get("f-method").value = "Credit";
    pw.updateCreditMode();
    return !get("lbl-credit-paid").classList.contains("hidden");
  });
  get("f-dist").value = "Smoke Dist " + stamp;
  get("f-product").value = "Smoke Item " + stamp;
  get("f-unit").value = "bag";
  get("f-qty").value = "100";
  get("f-total").value = "12000";
  get("f-credit-paid").value = "3000";
  pw.updateLiveBox();
  await check(mode + ": credit live box 9000 / 25%", () =>
    get("live-box").innerHTML.includes("9,000") && get("live-box").innerHTML.includes("25.0%"));
  await check(mode + ": submit credit purchase", async () => {
    await pw.submitEntry({ preventDefault() {} });
    await sleep(300);
    return get("form-err").textContent === "";
  });
  const creds = await apiGet("/api/credits");
  const mine = creds.open.filter((c) => (c.product || "").includes(stamp));
  creditId = mine.length ? mine[0].id : null;
  await check(mode + ": credit balance 9000 / 25%", () =>
    creditId && mine[0].balance === 9000 && Math.abs(mine[0].percent - 25) < 0.1);
  await check(mode + ": pay dialog prefills", async () => {
    await pw.openPayDialog(creditId);
    return get("pay-info").innerHTML.includes("balance");
  });
  get("pay-date").value = new Date().toISOString().slice(0, 10);
  get("pay-amount").value = "2500";
  await check(mode + ": later payment recorded", async () => {
    await pw.submitPay({ preventDefault() {} });
    await sleep(300);
    return get("pay-err").textContent === "";
  });
  const c2 = await apiGet("/api/credits");
  const afterPay = c2.open.find((c) => c.id === creditId);
  await check(mode + ": balance now 6500 / 45.8%", () =>
    afterPay && afterPay.balance === 6500 && Math.abs(afterPay.percent - 45.8333) < 0.1);
  await check(mode + ": credits view renders", async () => {
    await pw.switchView("credits");
    return get("credit-kpis").innerHTML.includes("Total outstanding");
  });
  await check(mode + ": credit cards carry an age reminder", () =>
    get("credit-list").innerHTML.includes("days old"));
  await check(mode + ": oldest-open-credit KPI rendered", () =>
    get("credit-kpis").innerHTML.includes("Oldest open credit"));
  await check(mode + ": Credits tab badge counts ageing credit", () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return pw.updateCreditBadge([{ date: "2020-01-01" }, { date: todayISO }]) === 1 &&
           pw.updateCreditBadge([{ date: todayISO }]) === 0;
  });

  // ---- cleanup this mode's purchases ----
  if (creditId) {
    if (mode === "offline") PWDB.request("DELETE", `/api/purchases/${creditId}`, {}, {});
    else await fetch(BASE + `/api/purchases/${creditId}`, { method: "DELETE" });
  }
  const list = await apiGet("/api/purchases?page_size=100");
  for (const r of list.rows.filter((x) => (x.memo || "").includes(stamp))) {
    if (mode === "offline") PWDB.request("DELETE", `/api/purchases/${r.id}`, {}, {});
    else await fetch(BASE + `/api/purchases/${r.id}`, { method: "DELETE" });
  }

  // ---- budget ----
  await check(mode + ": budget loads clean", async () => {
    await pw.switchView("budget");
    return get("b-year").value !== "" && get("b-alloc").innerHTML.length > 0;
  });
  await check(mode + ": auto-distribute no-throw", async () => { await pw.recommendedRows(); return true; });
  await check(mode + ": planner reacts to inputs", () => {
    get("b-total").value = "50000";
    get("b-save").value = "8000";
    get("b-total").dispatch("input");
    get("b-save").dispatch("input");
    return get("b-spendable").innerHTML.includes("50,000") && get("b-spendable").innerHTML.includes("42,000");
  });

  // ---- branches ----
  await check(mode + ": branches view renders", async () => {
    await pw.switchView("branches");
    return get("branch-list").children.length >= 1;
  });
  await check(mode + ": add branch persists", async () => {
    const bname = "Smoke Branch " + stamp;
    get("new-branch-name").value = bname;
    await pw.addBranch();
    await sleep(300);
    return pw.META.branches.some((b) => b.name === bname);
  });
  await check(mode + ": clicking branch row opens its dashboard", async () => {
    await pw.switchView("branches");
    await sleep(200);
    const smoke = pw.META.branches.find((b) => b.name === "Smoke Branch " + stamp);
    if (!smoke) return false;
    const list = get("branch-list");
    const idx = pw.META.branches.indexOf(smoke);
    const row = list.children[idx >= 0 ? idx : list.children.length - 1];
    row.dispatch("click");
    await sleep(300);
    const ok = pw.state.branch_id === smoke.id && pw.state.view === "dashboard";
    pw.state.branch_id = null;
    return ok;
  });

  // ---- analytics ----
  await check(mode + ": analytics renders", async () => {
    await pw.switchView("analytics");
    return get("ana-kpis").innerHTML.includes("Total spend");
  });

  // ---- reminders / alerts ----
  await check(mode + ": overdue credit raises a red reminder", () => {
    const list = pw.buildAlerts({
      creds: { open: [{ id: 1, date: "2020-01-01", product: "Smoke Item " + stamp,
                        distributor: "Smoke Dist " + stamp, balance: 9000, percent: 25 }] },
      budget: null, a: { unit_trend: [] },
    });
    pw.renderAlerts(list);
    return !get("alert-stack").classList.contains("hidden") &&
      get("alert-stack").innerHTML.includes("red") &&
      get("alert-stack").innerHTML.includes("days old") &&
      get("alert-stack").innerHTML.includes("pay it");
  });
  await check(mode + ": ageing credit (30-59 days) raises an amber reminder", () =>
    pw.buildAlerts({
      creds: { open: [{ id: 2, date: new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10),
                        product: "Smoke Item", distributor: "Smoke Dist", balance: 500, percent: 50 }] },
      budget: null, a: { unit_trend: [] },
    }).some((x) => x.tone === "amber" && x.title.includes("30+ days old")));
  await check(mode + ": budget overrun raises a reminder", () =>
    pw.buildAlerts({
      creds: { open: [] },
      budget: { saved: true, allocations: [{ name: "Ink", percent: 100 }],
                spendable: 1000, actual_spend: 1250, month: 9 },
      a: { unit_trend: [] },
    }).some((x) => x.tone === "red" && x.title.includes("Over budget by")));
  await check(mode + ": unit-price spike raises a reminder", () =>
    pw.buildAlerts({
      creds: { open: [] }, budget: null,
      a: { unit_trend: [{ product: "Smoke Item",
        points: [{ month: "2026-07", avg: 100 }, { month: "2026-08", avg: 130 }] }] },
    }).some((x) => x.title.includes("costs 30% more")));
  await check(mode + ": quiet data hides the alert stack", () => {
    pw.renderAlerts([]);
    return get("alert-stack").classList.contains("hidden");
  });

  // ---- appearance: bright / dark ----
  await check(mode + ": default appearance is dark", () =>
    pw.currentTheme() === "dark" &&
    document.documentElement.getAttribute("data-theme") === "dark");
  await check(mode + ": switch to bright repaints and persists", () => {
    const t = pw.applyTheme("light", true);
    const meta = document.querySelector('meta[name="theme-color"]');
    return t === "light" &&
      document.documentElement.getAttribute("data-theme") === "light" &&
      localStorage.getItem("pwbudget.theme.v1") === "light" &&
      meta && meta.content === "#f5f2ea" &&
      get("theme-light").classList.contains("active") &&
      !get("theme-dark").classList.contains("active") &&
      get("btn-theme").getAttribute("aria-pressed") === "true" &&
      get("theme-ico").textContent === "🌙";
  });
  await check(mode + ": top-bar toggle flips back to dark", () => {
    get("btn-theme").dispatch("click");
    return pw.currentTheme() === "dark" &&
      document.documentElement.getAttribute("data-theme") === "dark" &&
      localStorage.getItem("pwbudget.theme.v1") === "dark" &&
      get("theme-dark").classList.contains("active") &&
      get("theme-ico").textContent === "☀️";
  });
  await check(mode + ": profile dialog picks the theme too", () => {
    get("theme-light").dispatch("click");
    const first = document.documentElement.getAttribute("data-theme");
    get("theme-dark").dispatch("click");
    return first === "light" && document.documentElement.getAttribute("data-theme") === "dark";
  });
  await check(mode + ": theme choice is read back on reload", () => {
    pw.applyTheme("light", true);
    const saved = localStorage.getItem("pwbudget.theme.v1");
    const afterReload = pw.currentTheme();   // boots from localStorage first
    pw.applyTheme("dark", true);             // leave the harness as we found it
    return saved === "light" && afterReload === "light" &&
      document.documentElement.getAttribute("data-theme") === "dark";
  });
  await check(mode + ": index.html wires the switch", () => {
    const html = fs.readFileSync(path.join(__dirname, "public", "app", "index.html"), "utf8");
    return html.includes('id="btn-theme"') &&
      html.includes('data-theme="dark"') &&
      html.includes("pwbudget.theme.v1") &&
      html.includes('id="theme-light"') &&
      html.includes('id="theme-dark"');
  });

  // ---- calculator widget ----
  await check(mode + ": calculator keys built", () => get("calc-keys").innerHTML.includes("ck"));
  await check(mode + ": calc 12 × 34 = 408", () => {
    pw.calcPush("AC");
    ["1", "2", "×", "3", "4", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "408";
  });
  await check(mode + ": calc precedence 2+3×4 = 14", () => {
    pw.calcPush("AC");
    ["2", "+", "3", "×", "4", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "14";
  });
  await check(mode + ": calc √(9) = 3 and 5^2 via x²", () => {
    pw.calcPush("AC");
    ["√", "9", ")", "="].forEach((k) => pw.calcPush(k));
    const a = get("calc-display").textContent;
    pw.calcPush("AC");
    ["5", "x²", "="].forEach((k) => pw.calcPush(k));
    const b = get("calc-display").textContent;
    return a === "3" && b === "25";
  });
  await check(mode + ": calc % 200% = 2", () => {
    pw.calcPush("AC");
    ["2", "0", "0", "%", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "2";
  });
  await check(mode + ": calc divide by zero -> Error", () => {
    pw.calcPush("AC");
    ["5", "÷", "0", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "Error";
  });

  // Regression guards. The keypad's minus key is U+2212 MINUS SIGN while the
  // tokenizer originally only accepted ASCII "-", so subtraction silently
  // returned "Error" — no earlier test happened to use minus, which is how it
  // shipped. Drive the real key, not a hard-coded guess at its spelling.
  const minusKey = pw.CALC_KEYS.find((k) => k === "-" || k === "\u2212");
  await check(mode + ": calc subtracts with the keypad's minus key", () => {
    if (!minusKey) return false;
    pw.calcPush("AC");
    ["7", minusKey, "3", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "4";
  });
  await check(mode + ": calc subtract down to a negative result", () => {
    pw.calcPush("AC");
    ["1", "0", minusKey, "2", "0", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "-10";
  });
  await check(mode + ": calc minus composes with + and precedence", () => {
    pw.calcPush("AC");
    ["7", minusKey, "3", "+", "1", "="].forEach((k) => pw.calcPush(k));
    const a = get("calc-display").textContent;
    pw.calcPush("AC");
    ["8", minusKey, "2", "×", "3", "="].forEach((k) => pw.calcPush(k));
    return a === "5" && get("calc-display").textContent === "2";
  });
  await check(mode + ": calc chained x² is not silently dropped", () => {
    // "2 x² x²" builds "2^2^2"; a non-recursive power() swallowed the tail
    // and answered 4 instead of 16.
    pw.calcPush("AC");
    ["2", "x²", "x²", "="].forEach((k) => pw.calcPush(k));
    return get("calc-display").textContent === "16";
  });

  // ---- capture → extract → confirm (the model proposes, a human confirms) ----
  await check(mode + ": scan from text fills the purchase form", async () => {
    pw.openEntryDialog();
    const ok = await pw.runScan({ text: "Ceda Industrial Supplies\n2026-09-22\nDTF Powder 200 bag 21600\nCredit" });
    return ok &&
      get("f-dist").value === "Ceda Industrial Supplies" &&
      get("f-product").value === "DTF Powder" &&
      Number(get("f-qty").value) === 200 &&
      Number(get("f-total").value) === 21600 &&
      get("f-method").value === "Credit" &&
      get("f-date").value === "2026-09-22" &&
      get("scan-err").textContent === "" &&
      pw.state.scanQueue.length === 0;
  });
  await check(mode + ": a scan that misses key facts raises a review card", async () => {
    pw.openEntryDialog();
    const ok = await pw.runScan({ text: "DTF Powder 200 21600" });
    const card = get("review-card");
    const html = card.innerHTML;
    return ok && !card.classList.contains("hidden") &&
      html.includes("Date") && html.includes("Distributor") &&
      html.includes("Paid via") && html.includes("Unit");
  });
  await check(mode + ": confirming a question fills the field and clears the row", () => {
    const applied = pw.applyUncertain("distributor", "Ceda Industrial Supplies");
    return applied &&
      get("f-dist").value === "Ceda Industrial Supplies" &&
      !get("review-card").innerHTML.includes("Distributor");
  });
  await check(mode + ": an option chip can answer for the item line", () => {
    const applied = pw.applyUncertain("items[0].unit", "roll");
    return applied && get("f-unit").value === "roll" &&
      !get("review-card").innerHTML.includes("Unit");
  });
  await check(mode + ": a scan that finds nothing reports it instead of guessing", async () => {
    pw.openEntryDialog();
    const ok = await pw.runScan({ text: "" });
    return !ok && get("scan-err").textContent.length > 0;
  });
  await check(mode + ": a multi-line slip queues the extra items", async () => {
    pw.openEntryDialog();
    await pw.runScan({ text: "2026-09-01\nAlpha Inks\nInk Set 10 set 9000\nFoil 4 pack 1200" });
    return get("f-product").value === "Ink Set" &&
      Number(get("f-total").value) === 9000 &&
      pw.state.scanQueue.length === 1;
  });
  await check(mode + ": queued lines save one at a time through the normal path", async () => {
    const tag = stamp + "-scan";
    get("f-branch").value = "1";
    get("f-memo").value = tag;
    await pw.submitEntry({ preventDefault() {} });
    await sleep(300);
    const between = get("f-product").value === "Foil" && pw.state.scanQueue.length === 0;
    await pw.submitEntry({ preventDefault() {} });
    await sleep(350);
    const rows = (await apiGet("/api/purchases?page_size=200")).rows.filter((r) => r.memo === tag);
    const byProduct = rows.map((r) => r.product).sort().join(",");
    return between && rows.length === 2 && byProduct === "Foil,Ink Set" &&
      rows.every((r) => Number(r.total) > 0 && Number(r.quantity) > 0) &&
      pw.state.scanQueue.length === 0;
  });

  // ---- AI connection, coverage, status ----
  await check(mode + ": AI status strip is on every screen", () => {
    const txt = get("ai-strip-txt").textContent;
    return txt.startsWith("AI ·") &&
      get("ai-strip-scope").textContent.includes("capture") &&
      get("ai-dot").className.includes("off");
  });
  await check(mode + ": coverage defaults — capture and catalogue on, the rest off", () =>
    pw.aiAllows("capture") && pw.aiAllows("catalogue") &&
    !pw.aiAllows("money") && !pw.aiAllows("app") &&
    pw.aiScopeSummary() === "capture · catalogue");
  await check(mode + ": settings lists free providers and every coverage area", () => {
    pw.renderAiSettings();
    return get("ai-provider").innerHTML.includes("groq") &&
      get("ai-provider").innerHTML.includes("gemini") &&
      get("ai-provider").innerHTML.includes("openrouter") &&
      get("ai-model-list").innerHTML.length > 0 &&
      get("ai-areas").innerHTML.includes("Receipt &amp; slip capture") &&
      get("ai-areas").innerHTML.split("data-area=").length === 5 &&
      get("ai-instr").classList.contains("hidden");
  });
  await check(mode + ": coverage decides what context travels with a scan", async () => {
    pw.setAiArea("catalogue", true);
    const withCtx = await pw.aiBuildContext();
    pw.setAiArea("catalogue", false);
    const without = await pw.aiBuildContext();
    pw.setAiArea("catalogue", true);
    return withCtx.includes("My items") && without === "";
  });
  await check(mode + ": turning capture off hides the scan bar", () => {
    pw.setAiArea("capture", false);
    pw.openEntryDialog();
    const hidden = get("scan-bar").classList.contains("hidden");
    pw.setAiArea("capture", true);
    pw.openEntryDialog();
    return hidden && !get("scan-bar").classList.contains("hidden");
  });
  await check(mode + ": a pasted key installs a device-side connection only", () => {
    get("ai-provider").value = "custom";
    get("ai-base").value = "http://127.0.0.1:9/v1";
    get("ai-key").value = "sk-test-device";
    get("ai-model").value = "test-model";
    get("ai-form").dispatch("submit");
    const stored = JSON.parse(localStorage.getItem("pwbudget.ai.v1") || "{}");
    return pw.aiConfigured() && stored.key === "sk-test-device" &&
      PWDB.providerSet() === true && pw.aiStatus().tone === "on";
  });
  await check(mode + ": an unreachable model falls back instead of failing", async () => {
    // The provider is installed but its endpoint is dead, so db.js must not
    // throw and must not hand back an empty form: the built-in rules answer,
    // and the strip owns the bad news instead of the dialog.
    const note = "Ceda\nDTF Powder 2 bags 21600\npaid Cash\n22/09/2026";
    const r = await pw.aiExtractRequest({ text: note });
    return r && r.source === "heuristic" &&
      r.draft.distributor === "Ceda" && r.draft.items.length === 1 &&
      r.draft.items[0].total_amount === 21600 && r.draft.payment_method === "Cash" &&
      pw.aiStatus().tone === "bad" &&
      pw.aiStatus().detail.includes("built-in rules");
  });
  await check(mode + ": forgetting the key detaches the model", () => {
    get("ai-key").value = "";
    get("ai-form").dispatch("submit");
    return !pw.aiConfigured() && PWDB.providerSet() === false &&
      pw.aiStatus().tone === "off";
  });
  await check(mode + ": picking a provider swaps in that provider's model", () => {
    // Saved with Groq…
    get("ai-provider").value = "groq";
    get("ai-key").value = "gsk-test";
    get("ai-model").value = "openai/gpt-oss-120b";
    get("ai-form").dispatch("submit");
    const groqModel = get("ai-model").value;
    // …then switched to Google: the field must not still name a Groq model,
    // and the dialog must say which provider this is.
    get("ai-provider").value = "gemini";
    get("ai-provider").dispatch("change");
    return groqModel === "openai/gpt-oss-120b" &&
      get("ai-model").value === "gemini-2.5-flash" &&
      get("ai-note").textContent.length > 0;
  });
  await check(mode + ": a model id from another provider is not saved with it", () => {
    get("ai-provider").value = "gemini";
    get("ai-key").value = "AIza-test-google";
    get("ai-model").value = "openai/gpt-oss-120b";      // a Groq id, not Google's
    get("ai-form").dispatch("submit");
    const stored = JSON.parse(localStorage.getItem("pwbudget.ai.v1") || "{}");
    const ok = stored.provider === "gemini" && stored.model === "gemini-2.5-flash" &&
      pw.aiConfigured() && pw.aiStatus().text.includes("Google Gemini");
    get("ai-key").value = "";                           // leave the device clean
    get("ai-form").dispatch("submit");
    return ok;
  });

  // ---- money in: a person records it, or a statement proposes it ----
  await check(mode + ": money-in dialog opens with a branch and today", () => {
    pw.openIncomeDialog();
    return get("i-branch").value !== "" &&
      /^\d{4}-\d{2}-\d{2}$/.test(get("i-date").value);
  });
  get("i-date").value = "2026-09-27";
  get("i-branch").value = "1";
  get("i-amount").value = "4800";
  get("i-source").value = "Smoke takings " + stamp;
  get("i-ref").value = "SMK0";
  get("i-memo").value = stamp;
  await check(mode + ": money in recorded through the dialog", async () => {
    await pw.submitIncome({ preventDefault() {} });
    await sleep(300);
    return get("i-err").textContent === "";
  });
  await check(mode + ": money in persisted with its amount", async () => {
    const rows = (await apiGet("/api/income?page_size=50")).rows;
    return rows.some((r) => (r.memo || "").includes(stamp) && Number(r.amount) === 4800);
  });
  await check(mode + ": income view shows money in and what is left over", async () => {
    await pw.switchView("income");
    const k = get("income-kpis").innerHTML;
    return k.includes("Money in") && k.includes("Left over") &&
      get("income-body").innerHTML.includes("Smoke takings");
  });
  await check(mode + ": a statement becomes candidates, not rows", async () => {
    get("stmt-text").value = [
      "Date,Description,Debit,Credit,Reference",
      "2026-09-26,Shop takings,,4800,SMK1",
      "2026-09-26,Ceda Industrial Supplies,900,,SMK2",
    ].join("\n");
    await pw.readStatement();
    await sleep(400);
    const html = get("stmt-rows").innerHTML;
    return !get("stmt-out").classList.contains("hidden") &&
      html.includes("SMK1") && html.includes("SMK2") &&
      html.includes("money out") &&
      get("btn-stmt-record").disabled === false;
  });
  await check(mode + ": ticking a candidate records it as money in", async () => {
    global.__stmtTicks = [{ checked: true, dataset: { i: "0" } }];
    await pw.recordStatement();
    await sleep(400);
    global.__stmtTicks = [];
    const rows = (await apiGet("/api/income?page_size=50")).rows;
    return rows.some((r) => r.reference === "SMK1" && Number(r.amount) === 4800);
  });
  await check(mode + ": capture coverage also gates the statement importer", async () => {
    pw.setAiArea("capture", false);
    await pw.loadIncome();
    const hidden = get("stmt-card").classList.contains("hidden");
    pw.setAiArea("capture", true);
    await pw.loadIncome();
    return hidden && !get("stmt-card").classList.contains("hidden");
  });

  // ---- cleanup this mode's scan purchases (they are written after the
  //      earlier cleanup pass, so they need their own) ----
  const leftovers = await apiGet("/api/purchases?page_size=200");
  for (const r of leftovers.rows.filter((x) => (x.memo || "").includes(stamp))) {
    if (mode === "offline") PWDB.request("DELETE", `/api/purchases/${r.id}`, {}, {});
    else await fetch(BASE + `/api/purchases/${r.id}`, { method: "DELETE" });
  }
  const incLeft = await apiGet("/api/income?page_size=200");
  for (const r of incLeft.rows.filter((x) =>
    (x.memo || "").includes(stamp) || (x.source || "").includes(stamp) ||
    String(x.reference || "").startsWith("SMK"))) {
    if (mode === "offline") PWDB.request("DELETE", `/api/income/${r.id}`, {}, {});
    else await fetch(BASE + `/api/income/${r.id}`, { method: "DELETE" });
  }

  fs.unlinkSync(path.join(__dirname, `_app_${mode}.js`));
  return creditId;
}

(async () => {
  await runMode("offline");
  await runMode("server");
  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });