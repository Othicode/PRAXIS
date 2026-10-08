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
  /* the assistant appends its typing indicator this way */
  insertAdjacentHTML(pos, html) { this._html += String(html); }
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
  click() { this.dispatch("click"); }   // HTMLElement.click(), for download links
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
  constructor() { this.m = new Map(); this.fail = false; }   // fail = "device is full"
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    if (this.fail) {
      const e = new Error("The quota has been exceeded.");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.m.set(k, String(v));
  }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

/* ---- microphone + speech stubs for the voice overlay ---- */
const SR_INSTANCES = [];
class FakeSR {
  constructor() {
    this.lang = ""; this.interimResults = false; this.continuous = false;
    this.started = false; this.stopped = false;
    SR_INSTANCES.push(this);
  }
  start() { this.started = true; }
  stop() { this.stopped = true; if (this.onend) this.onend(); }   // the browser fires end after stop
  partial(t) { if (this.onresult) this.onresult({ results: [{ isFinal: false, 0: { transcript: t } }] }); }
  final(t) { if (this.onresult) this.onresult({ results: [{ isFinal: true, 0: { transcript: t } }] }); }
  end() { if (this.onend) this.onend(); }
}
const REC_INSTANCES = [];
class FakeRecorder {
  constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; REC_INSTANCES.push(this); }
  start() { this.state = "recording"; }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(["fake-audio"]) });
    if (this.onstop) this.onstop();
  }
}
const SPOKEN = [];
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
  global.window.webkitSpeechRecognition = FakeSR;
  global.window.MediaRecorder = FakeRecorder;
  global.window.navigator = {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
  };
  global.window.speechSynthesis = { speak: (u) => SPOKEN.push(u), cancel() {} };
  global.window.SpeechSynthesisUtterance = function (t) { this.text = String(t); this.lang = ""; };
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
  buildBackup, buildCsv, restoreBackup, summarizeRestore,
  renderStorageBanner, openDataDialog, usingOfflineEngine,
  daysSince, ageTone, agePill, buildAlerts, renderAlerts, updateCreditBadge,
  applyTheme, currentTheme, toggleTheme,
  get AGENT() { return AGENT; },
  get AGENT_FILES() { return AGENT_FILES; },
  AGENT_TOOLS, AGENT_TOOL, AGENT_VIEWS, agentTools, agentLocked, agentLockReason,
  agentToolLines, agentParse, agentHistory, agentChips, agentBriefHtml, agentBriefing,
  agentFollowups, agentSlipCards, agentLastUserText, agentApproveAll, agentRetry,
  agentTurnFailed, capAgentHistory, agentAlerts, agentDashboardData,
  loadAgent, saveAgent, renderAgent, renderAgentStatus,
  agentOpen, agentClose, agentMic, agentToggleVoice, agentAutogrow,
  showChatPane, toggleChatSidebar, syncChatUser,
  agentPrepare, agentRunTool, agentExecute, agentDecide, agentUndo,
  agentBuildReport, agentReportModel, pdfFromReport, docxFromReport,
  zipStore, crc32, renderJournal, openJournal,
};
`);
  const pw = require(tmp);
  const vsrc = fs.readFileSync(path.join(__dirname, "public", "app", "voice.js"), "utf8");
  const vtmp = path.join(__dirname, `_voice_${mode}.js`);
  fs.writeFileSync(vtmp, vsrc + "\nmodule.exports = window.VoiceOverlay;\n");
  pw.VoiceOverlay = require(vtmp);
  return pw;
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

  await check(mode + ": boot & meta (branches present, no smoke leftovers)", async () => {
    const m = await waitMeta(pw);
    if (!m) return false;
    const p = await apiGet("/api/purchases?page_size=100");
    // branches can't be deleted via the API, so they accumulate across runs;
    // run tools/cleanup_smoke.py to reset to a single branch. Real purchases
    // belong to the owner and are welcome here — what must be clean is the
    // harness's own debris: a smoke stamp or a smoke fixture's name.
    const junk = p.rows.filter((r) =>
      String(r.memo || "").includes("smoke-") ||
      /^Smoke /.test(r.distributor || "") ||
      r.distributor === "Alpha Inks" || r.distributor === "Ceda" ||
      r.distributor === "Ceda Industrial Supplies");
    return m.branches.length >= 1 && junk.length === 0;
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
  await check(mode + ": credits CSV carries the open credit", async () => {
    const lines = (await pw.buildCsv("credits")).trim().split("\r\n");
    return lines[0] ===
      "date,branch,product,distributor,total,paid,balance,percent,payments,memo" &&
      lines.length >= 2 && !lines[1].includes("undefined");
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
  await check(mode + ": settings lists every provider preset and every coverage area", () => {
    pw.renderAiSettings();
    return get("ai-provider").innerHTML.includes("groq") &&
      get("ai-provider").innerHTML.includes("gemini") &&
      get("ai-provider").innerHTML.includes("openrouter") &&
      get("ai-provider").innerHTML.includes("deepseek") &&
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
      get("ai-model").value === "gemini-3.5-flash-lite" &&
      get("ai-note").textContent.length > 0;
  });
  await check(mode + ": a model id from another provider is not saved with it", () => {
    get("ai-provider").value = "gemini";
    get("ai-key").value = "AIza-test-google";
    get("ai-model").value = "openai/gpt-oss-120b";      // a Groq id, not Google's
    get("ai-form").dispatch("submit");
    const stored = JSON.parse(localStorage.getItem("pwbudget.ai.v1") || "{}");
    const ok = stored.provider === "gemini" && stored.model === "gemini-3.5-flash-lite" &&
      pw.aiConfigured() && pw.aiStatus().text.includes("Google Gemini");
    get("ai-key").value = "";                           // leave the device clean
    get("ai-form").dispatch("submit");
    return ok;
  });
  await check(mode + ": the DeepSeek and OpenRouter presets carry their own ids", () => {
    // DeepSeek is pay-per-use but browser-verified: its own base, its own
    // model ids, and a note that does not promise a free tier.
    get("ai-provider").value = "deepseek";
    get("ai-provider").dispatch("change");
    const ds = get("ai-model").value === "deepseek-v4-flash" &&
      get("ai-base").value === "https://api.deepseek.com/v1" &&
      get("ai-note").textContent.includes("no free tier") &&
      get("ai-model-list").innerHTML.includes("deepseek-v4-pro");
    // OpenRouter's datalist now reaches Claude too (verified on its live
    // model list) — a paid id among the free ones, not on any other preset.
    get("ai-provider").value = "openrouter";
    get("ai-provider").dispatch("change");
    const orv = get("ai-model-list").innerHTML.includes("anthropic/claude-haiku-4.5");
    get("ai-provider").value = "gemini";
    get("ai-provider").dispatch("change");
    return ds && orv;
  });

  // ---- the assistant: its own two-column view over the same app ----
  await check(mode + ": the assistant opens as its own view with a live thread", () => {
    pw.loadAgent();
    get("view-chat").classList.add("hidden");      // what index.html ships
    pw.agentOpen();
    const onChat = pw.state.view === "chat" &&
      !get("view-chat").classList.contains("hidden");
    pw.renderAgent();
    const empty = get("agent-msgs").innerHTML.includes("What should I do?");
    const html = fs.readFileSync(path.join(__dirname, "public", "app", "index.html"), "utf8");
    const drawerGone = html.indexOf('id="agent-shell"') === -1 &&
      html.indexOf('id="agent-scrim"') === -1 &&
      html.indexOf('id="journal-dialog"') === -1;
    pw.agentClose();
    return onChat && empty && drawerGone;
  });

  await check(mode + ": the change log lives inside the chat view now", async () => {
    await pw.switchView("dashboard");
    pw.renderJournal();
    pw.openJournal();
    const logsOn = pw.state.view === "chat" &&
      !get("chat-logs").classList.contains("hidden") &&
      get("agent-scroll").classList.contains("hidden");
    pw.showChatPane("chats");
    const back = !get("agent-scroll").classList.contains("hidden") &&
      get("chat-logs").classList.contains("hidden");
    return logsOn && back;
  });

  await check(mode + ": the chat view is a nav destination with a collapsible sidebar", async () => {
    pw.toggleChatSidebar();                        // wide screen: collapse
    const collapsed = get("chat-layout").classList.contains("collapsed");
    pw.toggleChatSidebar();                        // and open again
    const reopened = !get("chat-layout").classList.contains("collapsed");
    await pw.switchView("chat");
    const nav = pw.state.view === "chat" && pw.AGENT_VIEWS.indexOf("chat") !== -1 &&
      pw.agentToolLines().join("\n").indexOf("branches|chat") !== -1;
    return collapsed && reopened && nav;
  });

  await check(mode + ": the sidebar's user menu answers", () => {
    const menu = get("chat-user-menu"), btn = get("chat-user-btn");
    menu.classList.add("hidden");
    btn.dispatch("click");
    const opened = !menu.classList.contains("hidden") && btn.getAttribute("aria-expanded") === "true";
    menu.dispatch("click", { target: { getAttribute: (k) => (k === "data-umenu" ? "theme" : null) } });
    return opened && menu.classList.contains("hidden");
  });

  await check(mode + ": the agent's hands follow the coverage switch", () => {
    const ids = (list) => list.map((t) => t.id).join(",");
    const readsOnly = ids(pw.agentTools());
    pw.setAiArea("app", true);
    pw.setAiArea("money", true);
    const wide = ids(pw.agentTools());
    pw.setAiArea("app", false);
    pw.setAiArea("money", false);
    const back = ids(pw.agentTools());
    return readsOnly.indexOf("create_purchase") === -1 &&
      readsOnly.indexOf("list_income") === -1 &&
      wide.indexOf("create_purchase") !== -1 &&
      wide.indexOf("list_income") !== -1 &&
      wide.indexOf("overview") !== -1 &&
      wide.indexOf("make_report") !== -1 &&
      back === readsOnly;
  });

  await check(mode + ": the model may speak in prose or one JSON object", () => {
    const a = pw.agentParse('{"reply":"Records 3.","actions":[{"tool":"overview","args":{}},{"tool":"nope","args":{}}]}');
    const b = pw.agentParse("just plain words");
    const c = pw.agentParse('```json\n{"reply":"ok"}\n```');
    return a.reply === "Records 3." && a.actions.length === 1 &&
      a.actions[0].tool === "overview" &&
      b.reply === "just plain words" && b.actions.length === 0 &&
      c.reply === "ok" && c.actions.length === 0;
  });

  await check(mode + ": a stray closing brace does not swallow the action", () => {
    const r = pw.agentParse('{"reply":"I will record the purchase of banners for 40 Ghana cedis.","actions":[{"tool":"create_purchase","args":{"date":"2026-10-07","distributor":"General","product":"Banners","unit":"pcs","quantity":1,"total_amount":40,"payment_method":"cash"}}]}}');
    return r.reply === "I will record the purchase of banners for 40 Ghana cedis." &&
      r.actions.length === 1 && r.actions[0].tool === "create_purchase" &&
      r.actions[0].args.product === "Banners" && r.actions[0].args.total_amount === 40;
  });

  await check(mode + ": prose around the object still carries the action", () => {
    const r = pw.agentParse('Sure thing! {"reply":"On it.","actions":[{"tool":"overview","args":{}}]} - anything else?');
    return r.reply === "On it." && r.actions.length === 1 &&
      r.actions[0].tool === "overview";
  });

  await check(mode + ": a cut-off reply keeps the action it had", () => {
    const r = pw.agentParse('{"reply":"Recording now","actions":[{"tool":"create_purchase","args":{"product":"Ban');
    return r.reply === "Recording now" && r.actions.length === 1 &&
      r.actions[0].tool === "create_purchase" && r.actions[0].args.product === "Ban";
  });

  // ---- voice overlay ----
  await check(mode + ": voice hears numbers in every shipped language", () => {
    const N = pw.VoiceOverlay.parseNumbers;
    return N("add five hundred and fifty for food", "en")[0] === 550 &&
      N("two hundred", "en")[0] === 200 &&
      N("a thousand", "en")[0] === 1000 &&
      N("ɔha anum", "tw")[0] === 500 &&
      N("ɔha ne enum", "tw")[0] === 105 &&
      N("ahanum", "tw")[0] === 500 &&
      N("oha kɛ ekome", "ga")[0] === 101 &&
      N("ohai enumɔ", "ga")[0] === 500 &&
      N("nyɔŋmai enyɔ", "ga")[0] === 20 &&
      N("alafa ɖeka kple ɖeka", "ee")[0] === 101 &&
      N("blaeve", "ee")[0] === 20 &&
      N("akpe ewo", "ee")[0] === 10000 &&
      N("ɗari biyu", "ha")[0] === 200 &&
      N("ɗari da tamanin", "ha")[0] === 180 &&
      N("dubu biyar", "ha")[0] === 5000 &&
      N("goma sha biyu", "ha")[0] === 12 &&
      N("quatre-vingt-dix", "fr")[0] === 90 &&
      N("soixante et onze", "fr")[0] === 71 &&
      N("trois cents cinquante", "fr")[0] === 350 &&
      N("vingt et un", "fr")[0] === 21;
  });

  await check(mode + ": voice reads digits, separators and decimals", () => {
    const N = pw.VoiceOverlay.parseNumbers;
    return N("GHS 1,200 for rent", "en")[0] === 1200 &&
      N("set aside 500.50", "en")[0] === 500.5 &&
      N("500 cedis", "en")[0] === 500;
  });

  await check(mode + ": the voice reply parser survives a stray brace", () => {
    const P = pw.VoiceOverlay.parseReply;
    const r = P('{"reply":"Added transport.","actions":[{"op":"add_item","name":"transport","amount":500}]}}');
    const p = P('Sure! {"reply":"Done.","actions":[{"op":"add_note","text":"ok"}]} ok?');
    return r.reply === "Added transport." && r.actions.length === 1 &&
      r.actions[0].op === "add_item" && r.actions[0].amount === 500 &&
      p.reply === "Done." && p.actions.length === 1 && p.actions[0].op === "add_note";
  });

  await check(mode + ": a cut-off voice reply keeps what it had and drops junk ops", () => {
    const P = pw.VoiceOverlay.parseReply;
    const t = P('{"reply":"Done","actions":[{"op":"add_item","name":"ba');
    const u = P('{"reply":"ok","actions":[{"op":"make_coffee","x":1},{"op":"delete_item","name":"fuel"}]}');
    return t.reply === "Done" && t.actions.length === 1 &&
      t.actions[0].op === "add_item" && t.actions[0].name === "ba" &&
      u.actions.length === 1 && u.actions[0].op === "delete_item";
  });

  await check(mode + ": voice batches may only contain what was said", () => {
    const V = pw.VoiceOverlay.validateBatch;
    const rows = [{ name: "Transport" }, { name: "Food" }];
    const ok = V([{ op: "add_item", name: "transport", amount: 500 }], [500], { rows });
    const invented = V([{ op: "add_item", name: "x", amount: 450 }], [500], { rows });
    const missing = V([{ op: "update_item", name: "Rocket", amount: 500 }], [500], { rows });
    const renamed = V([{ op: "update_item", name: "transport", amount: 500 }], [500], { rows });
    const ask = V([{ op: "ask_clarification", question: "How much?" },
      { op: "add_item", name: "x", amount: 500 }], [500], { rows });
    const many = V(Array.from({ length: 7 }, () => ({ op: "add_note", text: "n" })), [], { rows });
    return ok.ok && ok.actions.length === 1 &&
      !invented.ok && /not spoken/.test(invented.issues.join(" ")) &&
      !missing.ok && /no item/.test(missing.issues.join(" ")) &&
      renamed.ok && ask.ok && ask.actions.length === 1 &&
      ask.actions[0].op === "ask_clarification" && !many.ok;
  });

  await check(mode + ": a voice chip says exactly what would change", () => {
    const V = pw.VoiceOverlay;
    V.renderChips([{ op: "add_item", name: "transport", amount: 500 }]);
    const html = byId("voice-chips").innerHTML;
    V.renderChips([]);
    return html.includes("transport") && html.includes("500") &&
      html.includes('data-vi="0"') && !html.includes("disabled") &&
      byId("voice-chips").innerHTML === "";
  });

  await check(mode + ": the voice panel opens on its hotkey and closes on Esc", () => {
    const V = pw.VoiceOverlay;
    V.close();
    const t = V.hotkey({ key: " ", ctrlKey: true, shiftKey: true, preventDefault() {} });
    const opened = V.isOpen() && byId("voice-panel").classList.contains("open") &&
      byId("voice-fab").classList.contains("active");
    let stopped = false;
    const e = V.hotkey({ key: "Escape", stopPropagation() { stopped = true; } });
    const closed = !V.isOpen() && !byId("voice-panel").classList.contains("open") && stopped;
    const again = V.hotkey({ key: " ", ctrlKey: true, shiftKey: true, preventDefault() {} });
    byId("voice-fab").dispatch("click");
    return t && opened && e && closed && again && !V.isOpen();
  });

  await check(mode + ": the voice language is remembered", () => {
    const V = pw.VoiceOverlay;
    V.setLang("tw");
    const saved = JSON.parse(localStorage.getItem("pwbudget.voice.v1") || "{}");
    const now = V.getLang();
    const back = V.setLang("en");
    const saved2 = JSON.parse(localStorage.getItem("pwbudget.voice.v1") || "{}");
    return saved.lang === "tw" && now === "tw" &&
      saved2.lang === "en" && back === "en";
  });

  await check(mode + ": typed text reaches the engine and comes back a reply", async () => {
    const V = pw.VoiceOverlay;
    V.open();
    const out = await V.submit("what is my total budget?");
    const reply = byId("voice-reply").textContent;
    const tr = byId("voice-transcript").textContent;
    const hist = V.state().history;
    V.close();
    return !!out && reply.length > 0 && tr === "what is my total budget?" &&
      hist === 2 && byId("voice-chips").innerHTML === "";
  });

  await check(mode + ": an empty voice line just says so", async () => {
    const V = pw.VoiceOverlay;
    const r = await V.submit("   ");
    return r === null && byId("voice-note").textContent === "Say or type something first.";
  });

  await check(mode + ": the panel picks a microphone backend", () => {
    const V = pw.VoiceOverlay;
    localStorage.setItem("pwbudget.ai.v1", JSON.stringify(
      { provider: "gemini", base: "", model: "", key: "" }));
    pw.loadAI();
    const w = global.window;
    const live = w.webkitSpeechRecognition;
    delete w.webkitSpeechRecognition;
    const none = V.sttProvider();
    w.webkitSpeechRecognition = live;
    const web = V.sttProvider();
    localStorage.setItem("pwbudget.ai.v1", JSON.stringify(
      { provider: "custom", base: "http://127.0.0.1:8123/openai",
        model: "test-model", key: "sk-test" }));
    pw.loadAI();
    const whisper = V.sttProvider();
    localStorage.setItem("pwbudget.ai.v1", JSON.stringify(
      { provider: "gemini", base: "", model: "", key: "" }));
    pw.loadAI();
    const restored = V.sttProvider();
    return none === null && web === "webspeech" &&
      whisper === "whisper" && restored === "webspeech";
  });

  await check(mode + ": the microphone asks before it listens", () => {
    const V = pw.VoiceOverlay;
    localStorage.removeItem("pwbudget.voice.mic.v1");
    SR_INSTANCES.length = 0;
    V.mic();
    const asked = SR_INSTANCES.length === 0 &&
      /microphone/i.test(byId("voice-note").textContent);
    V.mic();
    const rec = SR_INSTANCES[SR_INSTANCES.length - 1];
    const listening = SR_INSTANCES.length === 1 && rec && rec.started === true &&
      V.micActive() === true && byId("voice-wave").hidden === false;
    const saved = localStorage.getItem("pwbudget.voice.mic.v1") === "yes";
    V.mic();
    const stopped = V.micActive() === false && byId("voice-wave").hidden === true;
    return asked && listening && saved && stopped;
  });

  await check(mode + ": a recognized line is asked for real", async () => {
    const V = pw.VoiceOverlay;
    const before = V.state().history;
    V.mic();
    const rec = SR_INSTANCES[SR_INSTANCES.length - 1];
    const started = !!(rec && rec.started);
    rec.final("what is my total budget?");
    rec.end();
    await sleep(250);
    return started && V.micActive() === false &&
      byId("voice-transcript").textContent === "what is my total budget?" &&
      byId("voice-reply").textContent.length > 0 &&
      V.state().history === before + 2 &&
      byId("voice-wave").hidden === true;
  });

  await check(mode + ": tapping the mic again stops the listening", () => {
    const V = pw.VoiceOverlay;
    V.mic();
    const rec = SR_INSTANCES[SR_INSTANCES.length - 1];
    rec.partial("five hun");
    const mid = byId("voice-transcript").textContent;
    V.mic();
    return rec.stopped === true && V.micActive() === false &&
      mid === "five hun" && byId("voice-wave").hidden === true;
  });

  await check(mode + ": a recorded line goes through the transcribe route", async () => {
    const V = pw.VoiceOverlay;
    localStorage.setItem("pwbudget.ai.v1", JSON.stringify(
      { provider: "custom", base: "http://127.0.0.1:8123/openai",
        model: "test-model", key: "sk-test" }));
    pw.loadAI();
    const backend = V.sttProvider();
    REC_INSTANCES.length = 0;
    V.mic();
    await sleep(30);                       // getUserMedia resolves on a microtask
    const rec = REC_INSTANCES[REC_INSTANCES.length - 1];
    const recording = backend === "whisper" && rec && rec.state === "recording" &&
      V.micActive() === true && byId("voice-wave").hidden === false;
    V.mic();
    await sleep(500);
    const note = byId("voice-note").textContent;
    const down = V.micActive() === false && byId("voice-wave").hidden === true &&
      /reach/.test(note);
    localStorage.setItem("pwbudget.ai.v1", JSON.stringify(
      { provider: "gemini", base: "", model: "", key: "" }));
    pw.loadAI();
    return recording && down;
  });

  await check(mode + ": replies can be read aloud", async () => {
    const V = pw.VoiceOverlay;
    SPOKEN.length = 0;
    const startOff = V.ttsOn() === false;
    V.setTts(true);
    const on = V.ttsOn() === true &&
      JSON.parse(localStorage.getItem("pwbudget.voice.v1") || "{}").tts === true &&
      byId("voice-tts").getAttribute("aria-pressed") === "true";
    await V.submit("what is my total budget?");
    const spoke = SPOKEN.length === 1 && SPOKEN[0].text.length > 0;
    V.setTts(false);
    await V.submit("what is my total budget?");
    const silent = SPOKEN.length === 1;
    return startOff && on && spoke && silent && V.ttsOn() === false;
  });

  await check(mode + ": voice chips apply a change and one-step undo restores it", async () => {
    const V = pw.VoiceOverlay;
    const nm = "voicetest-" + mode;
    const orig = {
      t: Number(pw.state.budget.baseTotal) || 0,
      s: Number(pw.state.budget.baseSave) || 0,
      rows: JSON.stringify(pw.state.budget.rows || []),
    };
    const chips = () => byId("voice-chips").innerHTML;
    const click = (vi) => byId("voice-chips").dispatch("click", { target: { dataset: { vi } } });
    const row = () => (pw.state.budget.rows || []).find((r) => r.name === nm);
    const realConfirm = global.confirm;
    let confirms = 0;
    global.confirm = () => { confirms++; return true; };
    pw.setAiArea("app", true);
    try {
      V.renderChips([{ op: "set_total", amount: 1000, save: 0, confirm: false }], [1000]);
      click("0");
      await sleep(80);
      const step1 = pw.state.budget.baseTotal === 1000 && chips().includes("disabled");

      V.renderChips([{ op: "add_item", name: nm, amount: 500 }], [500]);
      click("0");
      await sleep(80);
      const step2 = !!row() && Math.abs(Number(row().percent) - 50) < 0.01;

      V.renderChips([{ op: "update_item", name: nm, amount: 250 }], [250]);
      click("0");
      await sleep(80);
      const step3 = !!row() && Math.abs(Number(row().percent) - 25) < 0.01;

      V.renderChips([{ op: "delete_item", name: nm, confirm: false }], []);
      click("0");
      await sleep(80);
      const step4 = !row();

      click("undo");
      await sleep(80);
      const step5 = !!row() && Math.abs(Number(row().percent) - 25) < 0.01 &&
        !chips().includes('data-vi="undo"');

      V.renderChips([{ op: "delete_item", name: nm, confirm: false }], []);
      click("0");
      await sleep(80);
      const step6 = !row();

      V.renderChips([{ op: "set_total", amount: orig.t, save: orig.s, confirm: false }], [orig.t]);
      click("0");
      await sleep(80);
      const back = pw.state.budget.baseTotal === orig.t &&
        pw.state.budget.baseSave === orig.s &&
        JSON.stringify(pw.state.budget.rows || []) === orig.rows;
      return step1 && step2 && step3 && step4 && step5 && step6 && back &&
        confirms === 4;
    } finally {
      global.confirm = realConfirm;
      pw.setAiArea("app", false);
    }
  });

  await check(mode + ": the coverage gate decides whether a chip can apply", async () => {
    const V = pw.VoiceOverlay;
    const t0 = Number(pw.state.budget.baseTotal) || 0;
    const s0 = Number(pw.state.budget.baseSave) || 0;
    const chips = () => byId("voice-chips").innerHTML;
    const click = (vi) => byId("voice-chips").dispatch("click", { target: { dataset: { vi } } });
    V.renderChips([{ op: "set_total", amount: 1200, save: 0, confirm: false }], [1200]);
    click("0");
    await sleep(60);
    const blocked = pw.state.budget.baseTotal === t0 &&
      /coverage/i.test(byId("voice-note").textContent) &&
      !chips().includes("disabled");
    pw.setAiArea("app", true);
    click("0");
    await sleep(80);
    const opened = pw.state.budget.baseTotal === 1200 && chips().includes("disabled");
    V.renderChips([{ op: "set_total", amount: t0, save: s0, confirm: false }], [t0]);
    click("0");
    await sleep(80);
    const back = pw.state.budget.baseTotal === t0 && pw.state.budget.baseSave === s0;
    pw.setAiArea("app", false);
    return blocked && opened && back;
  });

  await check(mode + ": a declined confirmation changes nothing", async () => {
    const V = pw.VoiceOverlay;
    const t0 = Number(pw.state.budget.baseTotal) || 0;
    const before = JSON.stringify(pw.state.budget.rows || []);
    const realConfirm = global.confirm;
    global.confirm = () => false;
    pw.setAiArea("app", true);
    try {
      V.renderChips([{ op: "set_total", amount: 777, save: 1, confirm: false }], [777]);
      byId("voice-chips").dispatch("click", { target: { dataset: { vi: "0" } } });
      await sleep(60);
      return pw.state.budget.baseTotal === t0 &&
        JSON.stringify(pw.state.budget.rows || []) === before &&
        /declined/i.test(byId("voice-note").textContent) &&
        !byId("voice-chips").innerHTML.includes("disabled");
    } finally {
      global.confirm = realConfirm;
      pw.setAiArea("app", false);
    }
  });

  await check(mode + ": a chip can only carry what was really said", async () => {
    const V = pw.VoiceOverlay;
    pw.setAiArea("app", true);
    V.renderChips([{ op: "add_item", name: "ghost", amount: 450 }], [500]);
    byId("voice-chips").dispatch("click", { target: { dataset: { vi: "0" } } });
    await sleep(60);
    const refused = /not spoken/i.test(byId("voice-note").textContent) &&
      !(pw.state.budget.rows || []).some((r) => r.name === "ghost") &&
      !byId("voice-chips").innerHTML.includes("disabled");
    const noteNow = byId("voice-note").textContent;
    V.renderChips([{ op: "ask_clarification", question: "How much for rent?" }], [500]);
    byId("voice-chips").dispatch("click", { target: { dataset: { vi: "0" } } });
    await sleep(40);
    const ask = V.state().pending === 1 &&
      !byId("voice-chips").innerHTML.includes("disabled") &&
      byId("voice-note").textContent === noteNow;
    pw.setAiArea("app", false);
    return refused && ask;
  });

  await check(mode + ": a voice note lands in the change log", async () => {
    const V = pw.VoiceOverlay;
    const n0 = pw.AGENT.journal.length;
    pw.setAiArea("app", true);
    V.renderChips([{ op: "add_note", text: "Call the landlord about rent" }], []);
    byId("voice-chips").dispatch("click", { target: { dataset: { vi: "0" } } });
    await sleep(60);
    const j = pw.AGENT.journal[pw.AGENT.journal.length - 1];
    const list = byId("journal-list").innerHTML;
    pw.setAiArea("app", false);
    return pw.AGENT.journal.length === n0 + 1 && !!j && j.tool === "voice" &&
      String(j.detail).includes("landlord") &&
      list.includes("landlord") && list.includes("voiced");
  });

  await check(mode + ": a read tool answers without asking first", async () => {
    const out = await pw.agentRunTool(pw.AGENT_TOOL("overview"), {});
    const rep = await pw.agentRunTool(pw.AGENT_TOOL("list_changes"), {});
    return out.ok && out.text.includes("spend") && out.text.includes("owed") &&
      rep.ok && rep.text.length > 0;
  });

  await check(mode + ": the PDF report is written in the browser", async () => {
    const rep = await pw.agentBuildReport({ kind: "overview", format: "pdf" });
    const b = rep.bytes;
    const head = String.fromCharCode(b[0], b[1], b[2], b[3]);
    const tail = new TextDecoder().decode(b.slice(Math.max(0, b.length - 240)));
    return rep.name.startsWith("pwbudget-overview-") && rep.name.endsWith(".pdf") &&
      rep.mime === "application/pdf" && b.length > 800 &&
      head === "%PDF" && tail.includes("%%EOF") && tail.includes("trailer");
  });

  await check(mode + ": the Word report is a real .docx package", async () => {
    const rep = await pw.agentBuildReport({ kind: "purchases", format: "docx" });
    const b = rep.bytes;
    const zip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
    const txt = new TextDecoder().decode(b);
    return rep.name.endsWith(".docx") &&
      rep.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      zip && txt.includes("[Content_Types].xml") && txt.includes("word/document.xml");
  });

  await check(mode + ": the ZIP checksum is the standard CRC-32", () =>
    (pw.crc32(new TextEncoder().encode("123456789")) >>> 0) === 0xCBF43926);

  const agentDraft = () => ({
    date: "2026-10-02", distributor: "Smoke Agent Ltd", product: "Ribbon",
    unit: "roll", quantity: 2, total_amount: 500, payment_method: "Cash",
    memo: "agent " + stamp,
  });

  await check(mode + ": a proposal is a card, not a write", async () => {
    const before = (await apiGet("/api/purchases")).rows.length;
    pw.setAiArea("app", true);
    const card = await pw.agentPrepare(pw.AGENT_TOOL("create_purchase"), agentDraft());
    const after = (await apiGet("/api/purchases")).rows.length;
    const say = card.lines.join(" ");
    pw.setAiArea("app", false);
    return card.type === "ask" && card.status === "pending" && card.risk === "write" &&
      say.includes("Smoke Agent Ltd") && say.includes("Ribbon") && say.includes("GH") &&
      before === after;
  });

  await check(mode + ": approval writes once and the log keeps the state before it", async () => {
    pw.setAiArea("app", true);
    const before = (await apiGet("/api/purchases")).rows.length;
    const card = await pw.agentPrepare(pw.AGENT_TOOL("create_purchase"), agentDraft());
    pw.AGENT.messages.push({ role: "assistant", text: "propose", cards: [card], mid: pw.AGENT.seq++ });
    await pw.agentDecide(card.aid, true);
    const rows = (await apiGet("/api/purchases")).rows;
    const mine = rows.filter((r) => r.distributor === "Smoke Agent Ltd" && r.memo === "agent " + stamp);
    const j = pw.AGENT.journal[pw.AGENT.journal.length - 1];
    const ok = mine.length === 1 && rows.length === before + 1 && card.status === "done" &&
      !!j && j.tool === "create_purchase" && j.inverse && j.inverse.tool === "delete_purchase" &&
      j.before === null && j.undone === false;
    pw.setAiArea("app", false);
    return ok;
  });

  await check(mode + ": the change log renders what happened", () => {
    pw.renderJournal();
    const html = get("journal-list").innerHTML;
    const j = pw.AGENT.journal[pw.AGENT.journal.length - 1];
    return html.includes("Record a purchase") && html.includes("Put it back") &&
      html.includes("#" + j.jid) && !html.includes("undone");
  });

  await check(mode + ": a denied proposal leaves the books alone", async () => {
    pw.setAiArea("app", true);
    const before = (await apiGet("/api/purchases")).rows.length;
    const card = await pw.agentPrepare(pw.AGENT_TOOL("create_purchase"),
      Object.assign(agentDraft(), { distributor: "Smoke Denied Ltd" }));
    pw.AGENT.messages.push({ role: "assistant", text: "propose", cards: [card], mid: pw.AGENT.seq++ });
    await pw.agentDecide(card.aid, false);
    const after = (await apiGet("/api/purchases")).rows.length;
    pw.setAiArea("app", false);
    return before === after && card.status === "denied";
  });

  await check(mode + ": undo puts back the state before a change", async () => {
    const j = pw.AGENT.journal.filter((x) => x.tool === "create_purchase").pop();
    if (!j) return false;
    const before = (await apiGet("/api/purchases")).rows.length;
    const res = await pw.agentExecute("undo_change", { jid: j.jid });
    const after = (await apiGet("/api/purchases")).rows.length;
    return res.ok === true && after === before - 1 && j.undone === true;
  });

  await check(mode + ": the assistant says how far it can reach", () => {
    const statusOf = () => get("agent-status").textContent;
    pw.renderAgentStatus();
    const detached = statusOf();
    // attach a key so the line can name the reach it has, then take it away
    get("ai-provider").value = "custom";
    get("ai-base").value = "http://127.0.0.1:9/v1";
    get("ai-key").value = "sk-status-probe";
    get("ai-model").value = "m";
    get("ai-form").dispatch("submit");
    pw.setAiArea("app", true);
    pw.renderAgentStatus();
    const attached = statusOf();
    pw.setAiArea("app", false);
    get("ai-key").value = "";
    get("ai-form").dispatch("submit");
    pw.renderAgentStatus();
    return detached.includes("no model attached") &&
      attached.includes("can read/write") &&
      statusOf().includes("no model attached") &&
      get("agent-fab").className.includes("agent-fab");
  });

  await check(mode + ": voice is opt-in and safe where there is no microphone", () => {
    const read = () => JSON.parse(localStorage.getItem("pwbudget.agent.v1") || "{}").voice;
    pw.agentToggleVoice();
    const on = read() === true;
    pw.agentMic();                     // no SpeechRecognition in this harness
    pw.agentToggleVoice();
    return on && read() === false && pw.AGENT.voice === false;
  });

  // ---- assistant v2: honest about its hands, useful between turns ----
  await check(mode + ": locked hands are described to the model, not hidden", () => {
    pw.setAiArea("app", false); pw.setAiArea("money", false);
    const locked = pw.agentToolLines().find((l) => l.indexOf("create_purchase ") === 0);
    const free = pw.agentToolLines().find((l) => l.indexOf("propose_coverage ") === 0);
    const moneyLocked = pw.agentToolLines().find((l) => l.indexOf("list_credits ") === 0);
    pw.setAiArea("app", true);
    const open = pw.agentToolLines().find((l) => l.indexOf("create_purchase ") === 0);
    pw.setAiArea("app", false);
    return !!locked && locked.indexOf("[locked]") !== -1 && locked.indexOf("LOCKED") !== -1 &&
      !!free && free.indexOf("[write]") !== -1 &&
      !!moneyLocked && moneyLocked.indexOf("[locked]") !== -1 &&
      !!open && open.indexOf("[write]") !== -1 && open.indexOf("[locked]") === -1 &&
      pw.agentLocked().some((t) => t.id === "create_purchase") &&
      pw.agentTools().some((t) => t.id === "propose_coverage");
  });

  await check(mode + ": the assistant may propose widening its own coverage", async () => {
    pw.setAiArea("money", false);
    const card = await pw.agentPrepare(pw.AGENT_TOOL("propose_coverage"), { area: "money" });
    const line = card.lines.join(" ");
    const res = await pw.agentExecute("propose_coverage", { area: "money" });
    const on = pw.aiAllows("money");
    const again = await pw.agentExecute("propose_coverage", { area: "money" });
    pw.setAiArea("money", false);
    return card.status === "pending" && card.risk === "write" &&
      line.indexOf("Credit you owe") !== -1 && card.inverse && card.inverse.args.on === false &&
      res.ok === true && on === true && again.ok === false;
  });

  await check(mode + ": the briefing says where the shop stands", async () => {
    pw.AGENT.messages.length = 0;
    await pw.agentBriefing();
    pw.renderAgent();
    const html = get("agent-msgs").innerHTML;
    return pw.AGENT.messages.length === 0 &&
      html.indexOf("What should I do?") !== -1 &&
      html.indexOf("here is where the shop stands") !== -1 &&
      (html.indexOf("Nothing needs attention") !== -1 || html.indexOf("⏱") !== -1 ||
       html.indexOf("🔔") !== -1 || html.indexOf("🎯") !== -1 || html.indexOf("📈") !== -1) &&
      (html.indexOf("No model attached") !== -1 || html.indexOf("Attached") !== -1 ||
       html.indexOf("holds back") !== -1);
  });

  await check(mode + ": quick chips follow the coverage the owner set", () => {
    pw.setAiArea("money", false);
    const off = pw.agentChips();
    pw.setAiArea("money", true);
    const on = pw.agentChips();
    pw.setAiArea("money", false);
    const base = pw.agentTools().map((t) => t.id);
    pw.setAiArea("app", true);
    const withApp = pw.agentTools().map((t) => t.id);
    pw.setAiArea("capture", false);
    const noCapture = pw.agentTools().map((t) => t.id);
    pw.setAiArea("capture", true);
    pw.setAiArea("app", false);
    return off.some((c) => c.act === "open-ai") && on.some((c) => c.text.indexOf("owe") !== -1) &&
      base.indexOf("backup_books") !== -1 && base.indexOf("get_reminders") !== -1 &&
      base.indexOf("navigate") !== -1 && base.indexOf("propose_coverage") !== -1 &&
      base.indexOf("import_slip") === -1 &&
      withApp.indexOf("import_slip") !== -1 &&
      noCapture.indexOf("import_slip") === -1;
  });

  await check(mode + ": follow-up chips come from what just happened", () => {
    const a = pw.agentFollowups({ cards: [{ type: "result", tool: "overview", text: "x" }] });
    const b = pw.agentFollowups({ cards: [{ type: "ask", tool: "create_purchase", status: "pending" }] });
    const c = pw.agentFollowups({ cards: [] });
    return Array.isArray(a) && a.length > 0 && a.length <= 2 &&
      a.indexOf("What do we owe right now?") !== -1 &&
      b.length > 0 && Array.isArray(c) && c.length === 2;
  });

  await check(mode + ": a failed turn offers Try again instead of a dead end", async () => {
    pw.AGENT.messages.length = 0;
    pw.AGENT.messages.push({ role: "user", text: "hello", mid: pw.AGENT.seq++ },
                           { role: "assistant", text: "down", retry: true, mid: pw.AGENT.seq++ });
    pw.renderAgent();
    const shown = get("agent-msgs").innerHTML.indexOf("Try again") !== -1;
    await pw.agentRetry(pw.AGENT.messages[1].mid);
    const clean = pw.AGENT.messages.every((m) => !m.retry) && pw.AGENT.messages.length >= 2;
    return shown && clean &&
      pw.agentTurnFailed({ source: "" }) === true &&
      pw.agentTurnFailed(null) === true &&
      pw.agentTurnFailed({ source: "heuristic", text: "x" }) === false;
  });

  await check(mode + ": one pasted slip becomes one approval card per line", async () => {
    const cards = await pw.agentSlipCards({ text:
      "Ceda Industrial Supplies\n2026-09-22\nDTF Powder 200 bag 21600\nCredit" });
    const one = cards[0];
    return cards.length >= 1 && one.type === "ask" && one.tool === "create_purchase" &&
      one.status === "pending" && one.risk === "write" && one.lines.join(" ").indexOf("Ceda") !== -1;
  });

  await check(mode + ": a backup can be asked for and comes back as a file", async () => {
    const out = await pw.agentRunTool(pw.AGENT_TOOL("backup_books"), {});
    const f = out.file && pw.AGENT_FILES[out.file.fid];
    const body = f ? JSON.parse(f.bytes) : null;
    return out.ok === true && !!f && f.name.indexOf("pwbudget-backup-") === 0 &&
      !!body && body.app === "pwbudget" && body.kind === "backup" &&
      body.data && Array.isArray(body.data.purchases);
  });

  await check(mode + ": several cards can be approved in one tap", async () => {
    pw.setAiArea("app", true);
    const before = (await apiGet("/api/purchases")).rows.length;
    const c1 = await pw.agentPrepare(pw.AGENT_TOOL("create_purchase"),
      Object.assign(agentDraft(), { product: "Ribbon Bulk A", memo: "agent " + stamp }));
    const c2 = await pw.agentPrepare(pw.AGENT_TOOL("create_purchase"),
      Object.assign(agentDraft(), { product: "Ribbon Bulk B", memo: "agent " + stamp }));
    const msg = { role: "assistant", text: "two lines", cards: [c1, c2], mid: pw.AGENT.seq++ };
    pw.AGENT.messages.push(msg);
    pw.renderAgent();
    const offered = get("agent-msgs").innerHTML.indexOf("Approve all 2") !== -1;
    await pw.agentApproveAll(msg.mid);
    const rows = (await apiGet("/api/purchases")).rows;
    const mine = rows.filter((r) => (r.memo || "").includes(stamp) &&
      (r.product === "Ribbon Bulk A" || r.product === "Ribbon Bulk B"));
    pw.setAiArea("app", false);
    return offered && c1.status === "done" && c2.status === "done" &&
      mine.length === 2 && rows.length === before + 2;
  });

  await check(mode + ": history is capped without shedding a waiting card", () => {
    const keep = { role: "assistant", text: "wait", cards:
      [{ type: "ask", tool: "create_purchase", status: "pending", aid: "keepme", lines: [] }],
      mid: "keepmid" };
    pw.AGENT.messages = [];
    for (let i = 0; i < 140; i++) pw.AGENT.messages.push({ role: "system", hidden: true, text: "r" + i });
    pw.AGENT.messages.push(keep);
    pw.capAgentHistory();
    const kept = pw.AGENT.messages.some((m) => m && m.aid === undefined && m.cards &&
      m.cards.some((c) => c.aid === "keepme"));
    const short = pw.AGENT.messages.length <= 120;
    pw.AGENT.messages = [];
    return kept && short;
  });

  await check(mode + ": the new read tools answer with something to say", async () => {
    const rem = await pw.agentRunTool(pw.AGENT_TOOL("get_reminders"), {});
    const cmp = await pw.agentRunTool(pw.AGENT_TOOL("compare_months"), { n: 3 });
    const sup = await pw.agentRunTool(pw.AGENT_TOOL("top_suppliers"), { n: 3 });
    const bud = await pw.agentRunTool(pw.AGENT_TOOL("budget_health"), {});
    const trend = await pw.agentRunTool(pw.AGENT_TOOL("price_trend"), { product: "Nothing Like It" });
    const search = await pw.agentRunTool(pw.AGENT_TOOL("search_income"), { q: "smoke" });
    const missing = await pw.agentRunTool(pw.AGENT_TOOL("get_purchase"), { purchase_id: 999999 });
    return rem.ok && rem.text.length > 0 && cmp.ok && cmp.text.indexOf("spend") !== -1 &&
      sup.ok && bud.ok && trend.ok && search.ok &&
      missing.ok === false && missing.error.indexOf("no purchase") !== -1;
  });

  await check(mode + ": the assistant can open a screen behind its panel", async () => {
    const was = pw.state.view;
    const ok = await pw.agentRunTool(pw.AGENT_TOOL("navigate"), { view: "credits" });
    const now = pw.state.view;
    const bad = await pw.agentRunTool(pw.AGENT_TOOL("navigate"), { view: "nowhere" });
    if (was !== now) await pw.switchView(was);
    return ok.ok === true && now === "credits" && bad.ok === false;
  });

  await check(mode + ": a report can be asked for a particular month", async () => {
    const rep = await pw.agentReportModel("budget", { month: 1, year: 2026 });
    const file = await pw.agentBuildReport({ kind: "budget", format: "pdf", month: 1, year: 2026 });
    return rep.subtitle.indexOf("January 2026") !== -1 && file.bytes.length > 800;
  });

  await check(mode + ": /api/ai/chat replies even with no model attached", async () => {
    const r = await fetch(BASE + "/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }],
                             tools: [], context: "" }),
    });
    const j = await r.json();
    const bad = await fetch(BASE + "/api/ai/chat", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    return r.status === 200 && typeof j.text === "string" && j.text.length > 0 &&
      bad.status === 400;
  });

  await check(mode + ": /api/ai/voice replies even with no model attached", async () => {
    const r = await fetch(BASE + "/api/ai/voice", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "five hundred cedis for transport", lang: "en",
                             snapshot: { year: 2026, month: 10, total: 3000, items: [] } }),
    });
    const j = await r.json();
    const bad = await fetch(BASE + "/api/ai/voice", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    return r.status === 200 && typeof j.text === "string" && j.text.length > 0 &&
      bad.status === 400;
  });

  await check(mode + ": /api/ai/transcribe refuses without audio", async () => {
    const empty = await fetch(BASE + "/api/ai/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const ej = await empty.json();
    const withAudio = await fetch(BASE + "/api/ai/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: Buffer.from("not a real recording").toString("base64"),
                             mime: "audio/webm", lang: "en" }) });
    const aj = await withAudio.json();
    return empty.status === 400 && withAudio.status === 400 &&
      ej.error === "nothing to read \u2014 provide text or an image" &&
      aj.error === ej.error;
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

  // ---- your data: backup, restore, CSV export ----
  await check(mode + ": a backup file lists every table", async () => {
    const b = await pw.buildBackup();
    const d = b.data || {};
    return b.app === "pwbudget" && b.kind === "backup" &&
      Array.isArray(d.branches) && d.branches.length >= 1 &&
      Array.isArray(d.purchases) && d.purchases.length >= 1 &&
      Array.isArray(d.income) && d.income.length >= 1 &&
      Array.isArray(d.distributors) && Array.isArray(d.products) &&
      Array.isArray(d.credit_payments) && Array.isArray(d.budgets) &&
      d.seq > 1 && typeof d.created === "string";
  });
  await check(mode + ": purchases CSV has a header and a real row", async () => {
    const lines = (await pw.buildCsv("purchases")).trim().split("\r\n");
    return lines[0] ===
      "date,branch,distributor,product,unit,quantity,unit_price,total,payment_method,balance,memo" &&
      lines.length >= 2 && !lines[1].includes("undefined") && !lines[1].includes("null");
  });
  await check(mode + ": money-in CSV has a header and a real row", async () => {
    const lines = (await pw.buildCsv("income")).trim().split("\r\n");
    return lines[0] === "date,branch,source,amount,reference,memo" &&
      lines.length >= 2 && !lines[1].includes("undefined");
  });
  await check(mode + ": restore puts a deleted purchase back and nothing else", async () => {
    const backup = await pw.buildBackup();          // taken before the deletion
    const rows = backup.data.purchases;
    const victim = rows.find((p) => (p.memo || "").includes(stamp)) || rows[rows.length - 1];
    const before = (await apiGet("/api/purchases?page_size=200")).rows.length;
    if (mode === "offline") PWDB.request("DELETE", `/api/purchases/${victim.id}`, {}, {});
    else await fetch(BASE + `/api/purchases/${victim.id}`, { method: "DELETE" });
    const gone = (await apiGet("/api/purchases?page_size=200")).rows.length;
    const report = await pw.restoreBackup(backup.data);
    const back = (await apiGet("/api/purchases?page_size=200")).rows.length;
    return gone === before - 1 && back === before &&
      report.purchases.added === 1 && report.income.added === 0 &&
      report.branches.added === 0 && report.budgets.added === 0 &&
      report.errors.length === 0;
  });
  if (mode === "offline") {
    // The offline store is the ledger: when it refuses a write, the app must
    // say so and leave nothing half-saved behind.
    await check(mode + ": importData takes a backup back and refuses junk", () => {
      const snap = PWDB.exportData();
      const junk = PWDB.importData({ hello: 1 });          // not a backup
      const back = PWDB.importData(snap);                  // the same file, twice
      const same = JSON.stringify(PWDB.exportData()) === JSON.stringify(snap);
      return junk.ok === false && /missing "branches"/.test(junk.error) &&
        back.ok === true && same;
    });
    await check(mode + ": a full store refuses a whole-file restore too", () => {
      const before = JSON.stringify(PWDB.exportData());
      localStorage.fail = true;
      const r = PWDB.importData(PWDB.exportData());
      localStorage.fail = false;
      const after = JSON.stringify(PWDB.exportData());
      return r.ok === false && /not saved/.test(r.error) && after === before;
    });
    await check(mode + ": a full store refuses the write instead of pretending", () => {
      const before = PWDB.request("GET", "/api/purchases", {}, {}).body.rows.length;
      localStorage.fail = true;
      const r = PWDB.request("POST", "/api/purchases", {}, {
        date: "2026-10-05", branch_id: 1, distributor: "Quota Probe Co",
        product: "Must not exist", unit: "bag", quantity: 1,
        total_amount: 42, payment_method: "Cash", memo: "quota probe",
      });
      localStorage.fail = false;
      const after = PWDB.request("GET", "/api/purchases", {}, {}).body.rows.length;
      pw.renderStorageBanner();
      const alarmUp = !get("storage-banner").classList.contains("hidden") &&
        get("storage-banner").textContent.toLowerCase().includes("not being saved");
      PWDB.save();                            // the device has room again
      pw.renderStorageBanner();
      const alarmDown = get("storage-banner").classList.contains("hidden");
      return r.status === 507 && /not saved/.test(r.body.error) &&
        after === before && alarmUp && alarmDown;
    });
  }

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
  fs.unlinkSync(path.join(__dirname, `_voice_${mode}.js`));
  return creditId;
}

(async () => {
  await runMode("offline");
  await runMode("server");
  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });