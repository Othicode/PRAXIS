/* ============================================================
   PW Budget - offline data engine
   ============================================================
   A faithful client-side port of server.py's API so the app
   runs with ZERO internet once installed (PWA). Data lives in
   localStorage on the phone. Response shapes match the server
   exactly, so app.js's api() calls work unchanged.

   Exposed as globalThis.PWDB with PWDB.request(method, path, qs, body)
   -> { status, body }   (mirrors the server's HTTP layer)
   ============================================================ */
"use strict";

const CURRENCY = "GH\u20b5";
const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Mobile Money", "Credit"];
const UNIT_SUGGESTIONS = ["bag", "roll", "pack", "set", "bottle", "kg",
  "box", "piece", "litre", "carton", "can"];
const LS_KEY = "pwbudget.v1";
/* One sentence, in both engines, for the one failure that used to be silent. */
const STORAGE_FULL_ERROR = "storage is full — this change was not saved. Export a backup and free some space, then try again.";

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
const r4 = (x) => Math.round((Number(x) || 0) * 10000) / 10000;
const toInt = (v, dflt = 0) => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : dflt;
};
const toFloat = (v, dflt = 0) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? r2(n) : dflt;
};
const pad2 = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const money = (n) => CURRENCY + Number(n || 0).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function monthList(endY, endM, n) {
  const out = [];
  let y = endY, m = endM;
  for (let i = 0; i < n; i++) {
    out.push([y, m]);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out.reverse();
}
const monthBefore = (y, m) => (m === 1 ? [y - 1, 12] : [y, m - 1]);

/* ---------------- storage ---------------- */
let DB = null;

function load() {
  if (DB) return DB;
  try {
    const raw = globalThis.localStorage && localStorage.getItem(LS_KEY);
    if (raw) DB = JSON.parse(raw);
  } catch (e) { DB = null; }
  if (!DB || !Array.isArray(DB.branches)) {
    DB = {
      seq: 1, version: 1,
      branches: [{ id: 1, name: "Main Shop" }],
      distributors: [], products: [], purchases: [],
      income: [], credit_payments: [], budgets: [], created: todayISO(),
    };
    save();
  }
  // Devices installed before money-in shipped arrive without the key, and
  // every income read would then see `undefined`. Backfill once.
  if (!Array.isArray(DB.income)) {
    DB.income = [];
    save();
  }
  return DB;
}
/* save() used to swallow every exception, which meant a full phone reported
   "✓ Saved" and then lost the entry on the next reload. It now records why the
   write failed; request() turns that into a 507 and rolls the store back, so a
   failed write can never masquerade as a saved one. */
let SAVE_ERROR = "";      // why the last write attempt failed ("" = it stuck)
let SAVE_ATTEMPTS = 0;    // write attempts, so a caller can tell its own write apart

function save() {
  SAVE_ATTEMPTS += 1;
  SAVE_ERROR = "";
  if (!globalThis.localStorage) return;   // e.g. Node, in the parity harness
  try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
  catch (e) {
    SAVE_ERROR = (e && e.name === "QuotaExceededError")
      ? STORAGE_FULL_ERROR
      : "this device refused to save the change" + (e && e.message ? ` (${e.message})` : "");
  }
}
function storageStatus() {
  return { ok: !SAVE_ERROR, error: SAVE_ERROR, full: SAVE_ERROR === STORAGE_FULL_ERROR };
}
/* A byte-exact copy of the store — the shape a .pwbudget backup file holds. */
function exportData() {
  return JSON.parse(JSON.stringify(load()));
}
/* Replace the store with a backup. Callers hand over an envelope they have
   already parsed; this only accepts the offline engine's own shape, and it
   puts the previous store back if the new one will not fit on the device. */
function importData(data) {
  const tables = ["branches", "distributors", "products", "purchases",
    "income", "credit_payments", "budgets"];
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { ok: false, error: "that file is not a PW Budget backup" };
  for (const k of tables) {
    if (!Array.isArray(data[k]))
      return { ok: false, error: `that file is missing "${k}" — it is not a PW Budget backup` };
    if (!data[k].every((r) => r && typeof r === "object" && !Array.isArray(r)))
      return { ok: false, error: `that file has a damaged "${k}" list — it is not a PW Budget backup` };
  }
  if (!data.branches.length) return { ok: false, error: "that backup has no branches" };

  const prev = DB;
  let seq = toInt(data.seq, 1);
  for (const k of tables) for (const r of data[k]) seq = Math.max(seq, toInt(r.id, 0));
  DB = {
    seq, version: toInt(data.version, 1),
    branches: data.branches, distributors: data.distributors, products: data.products,
    purchases: data.purchases, income: data.income, credit_payments: data.credit_payments,
    budgets: data.budgets, created: String(data.created || todayISO()),
  };
  save();
  if (SAVE_ERROR) {
    DB = prev;                      // the old books, untouched
    return { ok: false, error: SAVE_ERROR };
  }
  return {
    ok: true,
    counts: {
      purchases: DB.purchases.length, income: DB.income.length,
      branches: DB.branches.length, credit_payments: DB.credit_payments.length,
      budgets: DB.budgets.length,
    },
  };
}
const nextId = () => (DB.seq += 1);

/* ---------------- helpers (mirror server.py) ---------------- */
function distributorId(name) {
  if (!name) return null;
  const hit = DB.distributors.find((d) => d.name.toLowerCase() === String(name).toLowerCase());
  if (hit) return hit.id;
  const id = nextId();
  DB.distributors.push({ id, name: String(name).trim() });
  save();
  return id;
}
function productId(name, unit) {
  if (!name) return [null, name];
  const hit = DB.products.find((p) => p.name.toLowerCase() === String(name).toLowerCase());
  if (hit) {
    if (unit && !hit.unit_default) { hit.unit_default = unit; save(); }
    return [hit.id, hit.unit_default || unit || "bag"];
  }
  const id = nextId();
  DB.products.push({ id, name: String(name).trim(), unit_default: unit || "bag" });
  save();
  return [id, unit || "bag"];
}

function creditStats(opts) {
  opts = opts || {};
  const out = [];
  for (const p of DB.purchases) {
    if (p.payment_method !== "Credit") continue;
    if (opts.purchase_id != null && p.id !== opts.purchase_id) continue;
    if (opts.branch_id != null && p.branch_id !== opts.branch_id) continue;
    const payments = DB.credit_payments
      .filter((cp) => cp.purchase_id === p.id)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const paid = (p.credit_paid || 0) + payments.reduce((s, x) => s + x.amount, 0);
    const total = p.total_amount;
    const balance = Math.max(r2(total - paid), 0);
    const percent = total ? r1(paid / total * 100) : 0;
    const branch = DB.branches.find((b) => b.id === p.branch_id);
    const dist = DB.distributors.find((d) => d.id === p.distributor_id);
    out.push({
      id: p.id, date: p.date, branch_id: p.branch_id,
      branch: branch ? branch.name : "", product: p.product_name, unit: p.unit,
      quantity: p.quantity, distributor: dist ? dist.name : "",
      total: total, paid: r2(paid), balance, percent,
      remaining: r1(100 - percent), memo: p.memo,
      payments: payments.map((x) => ({ date: x.date, amount: x.amount, memo: x.memo || "" })),
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/* ---------------- reporting (mirror server.py) ---------------- */
function purchasesQuery(params) {
  const P = (k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : "");
  let rows = DB.purchases.slice();
  if (P("branch_id")) rows = rows.filter((p) => p.branch_id === toInt(P("branch_id")));
  if (P("month")) rows = rows.filter((p) => p.date.startsWith(P("month") + "-"));
  if (P("frm")) rows = rows.filter((p) => p.date >= P("frm"));
  if (P("to")) rows = rows.filter((p) => p.date <= P("to"));
  if (P("distributor")) rows = rows.filter((p) => p.distributor_id === toInt(P("distributor")));
  if (P("product")) rows = rows.filter((p) => p.product_id === toInt(P("product")));
  if (P("payment")) rows = rows.filter((p) => p.payment_method === P("payment"));
  if (P("owed") === "1") {
    rows = rows.filter((p) => {
      if (p.payment_method !== "Credit") return false;
      const paid = (p.credit_paid || 0) +
        DB.credit_payments.filter((cp) => cp.purchase_id === p.id)
          .reduce((s, x) => s + x.amount, 0);
      return (p.credit_total || 0) > paid;
    });
  }
  if (P("q")) {
    const q = P("q").toLowerCase();
    rows = rows.filter((p) => {
      const dist = DB.distributors.find((d) => d.id === p.distributor_id);
      return [p.product_name, p.memo, p.unit, dist ? dist.name : ""]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }

  const total = rows.length;
  const page = Math.max(1, toInt(P("page"), 1));
  const pageSize = Math.min(200, Math.max(1, toInt(P("page_size"), 25)));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = rows
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice((page - 1) * pageSize, page * pageSize);

  const creditMap = {};
  for (const c of creditStats()) creditMap[c.id] = c;
  const out = pageRows.map((p) => {
    const dist = DB.distributors.find((d) => d.id === p.distributor_id);
    const branch = DB.branches.find((b) => b.id === p.branch_id);
    return {
      id: p.id, date: p.date, branch_id: p.branch_id,
      branch: branch ? branch.name : "", distributor_id: p.distributor_id,
      distributor: dist ? dist.name : "", product_id: p.product_id,
      product: p.product_name, unit: p.unit, quantity: p.quantity,
      total: p.total_amount, unit_price: p.unit_price,
      payment_method: p.payment_method, memo: p.memo,
      credit: creditMap[p.id] || null,
    };
  });
  return { rows: out, total, page, pages, page_size: pageSize };
}

/* Money in — same envelope as purchasesQuery so every pager, filter and
   parity step can treat the two alike. */
function incomeQuery(params) {
  const P = (k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : "");
  let rows = (DB.income || []).slice();
  if (P("branch_id")) rows = rows.filter((r) => r.branch_id === toInt(P("branch_id")));
  if (P("month")) rows = rows.filter((r) => r.date.startsWith(P("month") + "-"));
  if (P("frm")) rows = rows.filter((r) => r.date >= P("frm"));
  if (P("to")) rows = rows.filter((r) => r.date <= P("to"));
  if (P("q")) {
    const q = P("q").toLowerCase();
    rows = rows.filter((r) => [r.source, r.reference, r.memo]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  }
  const total = rows.length;
  const page = Math.max(1, toInt(P("page"), 1));
  const pageSize = Math.min(200, Math.max(1, toInt(P("page_size"), 25)));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = rows
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice((page - 1) * pageSize, page * pageSize);
  const out = pageRows.map((r) => {
    const branch = DB.branches.find((b) => b.id === r.branch_id);
    return {
      id: r.id, date: r.date, branch_id: r.branch_id,
      branch: branch ? branch.name : "", source: r.source,
      reference: r.reference, amount: r.amount, memo: r.memo,
    };
  });
  return { rows: out, total, page, pages, page_size: pageSize };
}

function analytics(branchId, months) {
  const today = new Date();
  const ml = monthList(today.getFullYear(), today.getMonth() + 1, months);
  const first = `${ml[0][0]}-${pad2(ml[0][1])}-01`;
  const scoped = DB.purchases.filter((p) =>
    p.date >= first && (branchId == null || p.branch_id === branchId));

  // per item
  const itemMap = new Map();
  for (const p of scoped) {
    const key = `${p.product_id}|${p.product_name}|${p.unit}`;
    const g = itemMap.get(key) || { name: p.product_name, unit: p.unit, buys: 0, qty: 0, spend: 0 };
    g.buys += 1; g.qty += p.quantity; g.spend += p.total_amount;
    itemMap.set(key, g);
  }
  const byItem = [...itemMap.values()]
    .map((g) => ({ ...g, avg_unit: g.qty ? g.spend / g.qty : 0 }))
    .sort((a, b) => b.spend - a.spend);

  // per distributor
  const distMap = new Map();
  for (const p of scoped) {
    const key = p.distributor_id == null ? "none" : p.distributor_id;
    const g = distMap.get(key) || { name: p.distributor_id == null ? "\u2014" :
      (DB.distributors.find((d) => d.id === p.distributor_id) || { name: "\u2014" }).name, buys: 0, spend: 0, qty: 0 };
    g.buys += 1; g.spend += p.total_amount; g.qty += p.quantity;
    distMap.set(key, g);
  }
  const byDist = [...distMap.values()].sort((a, b) => b.spend - a.spend);

  // monthly
  const monthlyMap = {};
  for (const p of scoped) {
    const ym = p.date.slice(0, 7);
    const g = monthlyMap[ym] || { spend: 0, buys: 0, credit_new: 0 };
    g.spend += p.total_amount; g.buys += 1;
    if (p.payment_method === "Credit") g.credit_new += p.total_amount;
    monthlyMap[ym] = g;
  }
  // money in over the same window, so spend and takings sit side by side
  const incomeMap = {};
  let totalIncome = 0;
  for (const r of (DB.income || [])) {
    if (r.date < first) continue;
    if (branchId != null && r.branch_id !== branchId) continue;
    const ym = r.date.slice(0, 7);
    incomeMap[ym] = (incomeMap[ym] || 0) + r.amount;
    totalIncome += r.amount;
  }

  const series = ml.map(([y, m]) => {
    const ym = `${y}-${pad2(m)}`;
    const g = monthlyMap[ym] || {};
    return {
      month: ym,
      spend: r2(g.spend || 0), income: r2(incomeMap[ym] || 0),
      buys: g.buys || 0, credit_new: r2(g.credit_new || 0),
    };
  });

  const totalSpend = byItem.reduce((s, x) => s + x.spend, 0);
  const topItems = byItem.map((g) => ({
    product: g.name, unit: g.unit, buys: g.buys, qty: g.qty, spend: r2(g.spend),
    avg_unit: r2(g.avg_unit), share: totalSpend ? r1(g.spend / totalSpend * 100) : 0,
  }));

  // unit price trend for top 5
  const unitTrend = [];
  for (const item of topItems.slice(0, 5)) {
    const ptsMap = {};
    for (const p of scoped) {
      if (p.product_name !== item.product) continue;
      const ym = p.date.slice(0, 7);
      const g = ptsMap[ym] || { spend: 0, qty: 0 };
      g.spend += p.total_amount; g.qty += p.quantity;
      ptsMap[ym] = g;
    }
    const points = Object.keys(ptsMap).sort().map((ym) => {
      const g = ptsMap[ym];
      return { month: ym, avg: r2(g.spend / g.qty) };
    });
    unitTrend.push({ product: item.product, points });
  }

  const credits = creditStats(branchId == null ? {} : { branch_id: branchId });
  const outstanding = credits.reduce((s, c) => s + c.balance, 0);
  const totalCredit = credits.reduce((s, c) => s + c.total, 0);

  return {
    months: series,
    top_items: topItems,
    top_by_qty: topItems.slice().sort((a, b) => b.qty - a.qty).slice(0, 8),
    by_distributor: byDist.map((g) => ({
      name: g.name, buys: g.buys, spend: r2(g.spend),
      share: totalSpend ? r1(g.spend / totalSpend * 100) : 0,
    })),
    payment_split: Object.values(scoped.reduce((map, p) => {
      const g = map[p.payment_method] || { pm: p.payment_method, buys: 0, spend: 0 };
      g.buys += 1; g.spend += p.total_amount;
      map[p.payment_method] = g;
      return map;
    }, {})).sort((a, b) => b.spend - a.spend).map((g) => ({
      method: g.pm, buys: g.buys, spend: r2(g.spend),
    })),
    unit_trend: unitTrend,
    totals: {
      spend: r2(totalSpend),
      income: r2(totalIncome),
      net: r2(totalIncome - totalSpend),
      buys: byItem.reduce((s, x) => s + x.buys, 0),
      items: byItem.length,
      distributors: byDist.length,
      credit_outstanding: r2(outstanding),
      total_credit: r2(totalCredit),
      credit_cleared: r2(totalCredit - outstanding),
      open_credit_count: credits.filter((c) => c.balance > 0.005).length,
    },
  };
}

function recommendBudget(branchId, year, month) {
  const [py, pm] = monthBefore(year, month);
  const monthsBefore = monthList(py, pm, 6);
  const histStartY = monthsBefore[0][0], histStartM = monthsBefore[0][1];
  const histStart = `${histStartY}-${pad2(histStartM)}-01`;
  const firstOfTarget = `${year}-${pad2(month)}-01`;

  const map = new Map();
  for (const p of DB.purchases) {
    if (p.date < histStart || p.date >= firstOfTarget) continue;
    if (branchId != null && p.branch_id !== branchId) continue;
    const key = `${p.product_id}|${p.product_name}`;
    map.set(key, (map.get(key) || 0) + p.total_amount);
  }
  const rows = [...map.entries()].map(([k, spend]) => ({ name: k.split("|")[1], spend }))
    .sort((a, b) => b.spend - a.spend);
  const total = rows.reduce((s, r) => s + r.spend, 0);
  if (total <= 0) return [];

  const weights = rows.slice(0, 6).map((r) => [r.name, r.spend / total * 100]);
  const other = rows.slice(6).reduce((s, r) => s + r.spend, 0);
  if (other > total * 0.02) weights.push(["Other items", other / total * 100]);
  let rounded = weights.map(([n, w]) => [n, r1(w)]);
  if (rounded.length) {
    const drift = 100 - rounded.reduce((s, r) => s + r[1], 0);
    rounded[0] = [rounded[0][0], r1(rounded[0][1] + drift)];
  }
  return rounded.map(([n, w]) => ({ name: n, percent: w }));
}

function budgetView(branchId, year, month) {
  const row = DB.budgets.find((b) =>
    b.year === year && b.month === month &&
    ((b.branch_id == null && branchId == null) || b.branch_id === branchId)) || null;

  let alloc, total, save, saved;
  if (row) {
    alloc = row.allocations || [];
    total = row.total_amount; save = row.save_amount; saved = true;
  } else {
    alloc = recommendBudget(branchId, year, month);
    const months = analytics(branchId == null ? undefined : branchId, 12).months;
    const today = new Date();
    let histSpend = 0;
    for (const [y, m] of monthList(today.getFullYear(), today.getMonth() + 1, 4)) {
      const found = months.find((s) => s.month === `${y}-${pad2(m)}`);
      if (found && found.spend) histSpend = found.spend;
    }
    total = histSpend ? Math.round(histSpend / 100) * 100 : 0;
    save = total ? r2(total * 0.10) : 0;
    saved = false;
  }

  const spendable = Math.max(total - save, 0);
  const monthPrefix = `${pad2(year)}-${pad2(month)}-`;
  const actual = {};
  for (const p of DB.purchases) {
    if (!p.date.startsWith(monthPrefix)) continue;
    if (branchId != null && p.branch_id !== branchId) continue;
    actual[p.product_name] = (actual[p.product_name] || 0) + p.total_amount;
  }

  return {
    saved, branch_id: branchId, year, month,
    total_amount: total, save_amount: save, spendable: r2(spendable),
    allocations: alloc.map((a) => ({
      name: a.name, percent: a.percent,
      amount: r2(spendable * a.percent / 100),
      actual: r2(actual[a.name] || 0),
    })),
    recommended: recommendBudget(branchId, year, month),
    actual_spend: r2(Object.values(actual).reduce((s, x) => s + x, 0)),
  };
}

function metaData() {
  return {
    currency: CURRENCY,
    branches: DB.branches.slice().sort((a, b) => a.id - b.id)
      .map((b) => ({ id: b.id, name: b.name })),
    distributors: DB.distributors.slice().map((d) => d.name).sort((a, b) => a.localeCompare(b)),
    distributor_options: DB.distributors.slice()
      .sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ id: d.id, name: d.name })),
    products: DB.products.slice().map((p) => ({ name: p.name, unit: p.unit_default || "" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    product_options: DB.products.slice()
      .sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: p.id, name: p.name })),
    payment_methods: PAYMENT_METHODS,
    units: UNIT_SUGGESTIONS,
    months: [...new Set(
      DB.purchases.concat(DB.income || []).map((r) => r.date.slice(0, 7)),
    )].sort().reverse(),
  };
}

/* ---------------- purchase creation (mirror server.py) ---------------- */
function createPurchase(payload) {
  const rawDate = String(payload.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return { status: 400, body: { error: "date must be YYYY-MM-DD" } };

  const bid = toInt(payload.branch_id);
  if (!DB.branches.some((b) => b.id === bid)) {
    return { status: 400, body: { error: "a valid branch_id is required" } };
  }
  const qty = toFloat(payload.quantity);
  if (!(qty > 0)) return { status: 400, body: { error: "quantity must be greater than zero" } };
  const total = toFloat(payload.total_amount);
  if (!(total > 0)) return { status: 400, body: { error: "total amount must be greater than zero" } };

  const pm = String(payload.payment_method || "").trim();
  if (!PAYMENT_METHODS.includes(pm)) {
    return { status: 400, body: { error: `payment_method must be one of: ${PAYMENT_METHODS.join(", ")}` } };
  }
  let unit = String(payload.unit || "").trim().slice(0, 20) || "bag";
  const productRaw = String(payload.product || "").trim().slice(0, 80);
  if (!productRaw) return { status: 400, body: { error: "product name is required" } };
  const distRaw = String(payload.distributor || "").trim().slice(0, 80);
  if (!distRaw) return { status: 400, body: { error: "distributor name is required" } };

  // Validate the credit amount BEFORE distributorId()/productId(): those two
  // create records and save() immediately, so a rejected purchase would
  // otherwise leave an orphan distributor/product behind (the server avoids
  // this because its uncommitted INSERTs roll back when it returns 400).
  let creditTotal = null, creditPaid = null;
  if (pm === "Credit") {
    creditTotal = total;
    creditPaid = toFloat(payload.credit_paid);
    if (creditPaid < 0) creditPaid = 0;
    if (creditPaid > total + 0.005) {
      return { status: 400, body: {
        error: `amount paid (${money(creditPaid)}) cannot exceed the original price (${money(total)})` } };
    }
    creditPaid = r2(creditPaid);
  }

  const did = distributorId(distRaw);
  const [pId, unitOut] = productId(productRaw, unit);
  unit = unitOut;
  const unitPrice = r4(total / qty);

  const id = nextId();
  DB.purchases.push({
    id, date: rawDate, branch_id: bid, distributor_id: did, product_id: pId,
    product_name: productRaw, unit, quantity: qty, total_amount: total,
    unit_price: unitPrice, payment_method: pm, credit_total: creditTotal,
    credit_paid: creditPaid, memo: String(payload.memo || "").trim().slice(0, 140),
    created_at: todayISO(),
  });
  save();
  const cs = pm === "Credit" ? creditStats({ purchase_id: id })[0] : null;
  return { status: 201, body: { ok: true, id, credit: cs } };
}

/* Money in. Validated in the same order as createPurchase — date, branch,
   the number, then the name — so both engines reject in step. */
function createIncome(payload) {
  const rawDate = String(payload.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate))
    return { status: 400, body: { error: "date must be YYYY-MM-DD" } };
  const bid = toInt(payload.branch_id);
  if (!bid || !DB.branches.some((b) => b.id === bid))
    return { status: 400, body: { error: "a valid branch_id is required" } };
  const amount = toFloat(payload.amount);
  if (amount <= 0)
    return { status: 400, body: { error: "amount must be greater than zero" } };
  const source = String(payload.source || "").trim().slice(0, 80);
  if (!source)
    return { status: 400, body: { error: "source is required" } };
  const id = nextId();
  DB.income.push({
    id, date: rawDate, branch_id: bid, source, amount,
    reference: String(payload.reference || "").trim().slice(0, 40),
    memo: String(payload.memo || "").trim().slice(0, 140),
    created_at: todayISO(),
  });
  save();
  return { status: 201, body: { ok: true, id } };
}

/* ==========================================================================
   AI extraction layer — phase 1 plumbing (docs/AI_AUTOMATION_PLAN.md)

   This is the offline half of /api/ai/*. There is no model here: an installed
   phone may have no internet at all, so every route runs the same
   deterministic heuristic a *keyless* server.py runs. The plan calls this
   "fixture-first" — the fixtures exist to test the model path, but the
   shapes a keyless server produces and the shapes produced here must be
   identical, or audit_calculations.js parity breaks.

   Governing rule: this layer only proposes. A human confirms, and the
   ordinary createPurchase() path records.
   ========================================================================== */

const AI_IMAGE_ERROR = "image extraction needs an AI provider \u2014 paste the text instead";
const AI_NOTHING_ERROR = "nothing to read \u2014 provide text or an image";
const AI_READ_ERROR = "could not read that image \u2014 paste the text instead";

/* The model contract — byte-identical to server.py's AI_SYSTEM / AI_PROMPT_*
   constants. audit_calculations.js compares the source literals, because the
   server path (env key) and this device path (key from Settings) must ask the
   model for the same thing or the two engines drift. */
const AI_SYSTEM = "You extract bookkeeping records from receipts, ledger pages and bank statements. Answer with one JSON object only \u2014 no prose, no markdown. Never invent a figure you cannot read: leave it empty and list it under \"uncertain\" as {field, why, options[]}.";
const AI_PROMPT_IMAGE = "Read this bookkeeping image and return the purchase draft as JSON: {\"date\":\"YYYY-MM-DD\",\"distributor\":\"\",\"items\":[{\"product\":\"\",\"unit\":\"\",\"quantity\":0,\"total_amount\":0}],\"payment_method\":\"\",\"memo\":\"\"} plus \"uncertain\":[{field,why,options[]}].";
const AI_PROMPT_TEXT_PREFIX = "Turn this note into a purchase draft JSON: {\"date\":\"\",\"distributor\":\"\",\"items\":[{\"product\":\"\",\"unit\":\"\",\"quantity\":0,\"total_amount\":0}],\"payment_method\":\"\",\"memo\":\"\"} plus \"uncertain\":[{field,why,options[]}]. Note:\n";
const AI_PROMPT_INSTRUCT = "Apply this edit to the bookkeeping draft and return only {\"op\":\"update\",\"changes\":{...}} with an empty changes object if the instruction does not name a field. Whitelisted fields: ";
const AI_PROMPT_STATEMENT_IMAGE = "Read this statement image and return JSON {\"candidates\":[{\"date\":\"YYYY-MM-DD\",\"direction\":\"out|in\",\"amount\":0,\"description\":\"\",\"reference\":\"\"}],\"uncertain\":[{field,why,options[]}]}.";
const AI_PROMPT_STATEMENT_TEXT_PREFIX = "Read this statement text and return JSON {\"candidates\":[{\"date\":\"YYYY-MM-DD\",\"direction\":\"out|in\",\"amount\":0,\"description\":\"\",\"reference\":\"\"}],\"uncertain\":[{field,why,options[]}]}.\n";
const AI_PROMPT_AGENT = "You are the control centre of PW Budget, a bookkeeping app for a small shop. The owner types instructions here; the app is your body and the tools below are your hands. Answer with one JSON object only \u2014 no prose, no markdown: {\"reply\":\"what you say to the owner\",\"actions\":[{\"tool\":\"tool_id\",\"args\":{}}]}. Rules: use only the tools listed below and only the arguments they declare; propose at most what the instruction needs; never claim a change already happened, because every write is a proposal the owner approves by hand \u2014 write \"I will\", not \"I did\"; when you need data first, ask for the read tools and wait for the result; when the owner refuses, adjust instead of repeating yourself; when nothing fits, say so plainly and name the closest tool. Tools marked [locked] are held by a coverage switch the owner has left off: never claim you can run one, and offer propose_coverage only when widening access would actually help.";
const AI_AGENT_OFFLINE = "I can think, but there is no model attached to this device. Add a free key under Settings \u2192 AI connection and I will take over from there.";
const AI_AGENT_DOWN = "I could not reach the model just now \u2014 check the connection and try again.";
const AI_PROMPT_VOICE = "You are the voice assistant of PW Budget, a budgeting app for a shop in Ghana. The owner speaks in their own language; you receive the language, a compact snapshot of the current budget, and the transcript of what was just said. Answer with one JSON object only \u2014 no prose, no markdown: {\"reply\":\"one short plain sentence in the owner's language\",\"actions\":[{\"op\":\"add_item\",\"name\":\"transport\",\"amount\":500}]}. The six actions: add_item {name, amount}, update_item {name, amount}, delete_item {name}, set_total {amount, save}, add_note {text}, ask_clarification {question}. Rules: reply in the language of the transcript, short and free of jargon; use only amounts the owner actually said \u2014 never invent an amount and never convert currencies; amounts are GH\u20b5 cedis; names for update_item and delete_item must match the snapshot exactly; if a name is missing, an amount was not spoken, or the request is unclear, send exactly one action, ask_clarification, with one short question; delete_item and set_total disturb what already exists, so add confirm true to them only when the owner clearly agreed; at most 6 actions; never claim a change was made \u2014 the app applies what it validates.";

/* The device-supplied model connection. This is the offline engine's counterpart
   of server.py's AI_API_KEY / AI_BASE_URL / AI_MODEL: the owner picks a provider
   and pastes a key in Settings, it is stored on this device only, and it travels
   nowhere except straight to that provider. Null means "no model here" — the
   routes then answer exactly like a keyless server.py. */
let AI_PROVIDER = null;

function setProvider(cfg) {
  const key = cfg && cfg.key ? String(cfg.key).trim() : "";
  const baseUrl = cfg && cfg.baseUrl ? String(cfg.baseUrl).trim().replace(/\/+$/, "") : "";
  AI_PROVIDER = key && baseUrl
    ? { baseUrl, key, model: String((cfg && cfg.model) || "").trim() }
    : null;
}

function providerSet() { return AI_PROVIDER !== null; }

/* One chat completion. Returns the model's text, or null on any failure — an
   unreachable model must never break a core path (mirrors server.py _ai_chat).
   `system` overrides the extraction contract for routes that are not about
   receipts — the agent chat, for instance. Callers that pass nothing keep
   AI_SYSTEM, so every existing path behaves exactly as before. */
async function aiChat(prompt, image, system) {
  const cfg = AI_PROVIDER;
  if (!cfg) return null;
  const content = [{ type: "text", text: prompt }];
  if (image) {
    const raw = String(image);
    content.push({
      type: "image_url",
      image_url: { url: raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}` },
    });
  }
  let data;
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model, temperature: 0,
        messages: [{ role: "system", content: system || AI_SYSTEM }, { role: "user", content }],
      }),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch (e) {
    return null;   // CORS, offline, DNS — fall back to the heuristic
  }
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const raw = choice && choice.message ? String(choice.message.content || "") : "";
  let text = raw.trim();
  if (!text) return null;
  text = text.replace(/^```[A-Za-z]*\s*/, "").replace(/\s*```$/, "");
  return text;
}

/* fixture-free device equivalent of server.py's ai_call: model -> parsed JSON,
   or null so the caller falls back to the heuristic. */
async function aiCall(kind, payload, prompt) {
  const text = await aiChat(prompt, payload && payload.image);
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// Mirrors PAYMENT_HINTS in server.py — first keyword hit wins.
const PAYMENT_HINTS = [
  ["Mobile Money", ["mobile money", "momo", "telecel", "airteltigo", "mtn momo"]],
  ["Bank Transfer", ["bank transfer", "bank", "transfer", "ghipss", "cheque", "check"]],
  ["Credit", ["credit", "on credit", "owed"]],
  ["Cash", ["cash"]],
];

const ISO_DATE_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const SLASH_DATE_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/;
// Python's re.sub replaces every match even without re.I/g, while JS
// String.replace on a non-global regex stops after the first — these globals
// are what keep rowNumbers() and the description scrub identical.
const ISO_DATE_G = new RegExp(ISO_DATE_RE.source, "g");
const SLASH_DATE_G = new RegExp(SLASH_DATE_RE.source, "g");
const WHOLE_DATE_RE = /^\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*$/;
const NUM_SRC = "\\d+(?:\\.\\d+)?";
const ITEM_4 = new RegExp(`^(.+?)\\s+(${NUM_SRC})\\s+([A-Za-z]+)\\s+(${NUM_SRC})$`);
const ITEM_3 = new RegExp(`^(.+?)\\s+(${NUM_SRC})\\s+(${NUM_SRC})$`);
const TOTAL_RE = new RegExp(`^(?:total|grand total|subtotal|amount paid|paid)\\D*?(${NUM_SRC})\\s*$`, "i");
const STRICT_NUM_RE = new RegExp(`^-?${NUM_SRC}$`);

const INSTR_FIELDS = "distributor|supplier|vendor|date|payment(?:\\s+method)?|method|memo|note|product|item|unit|quantity|qty|amount|total";
const INSTR_SET_RE = new RegExp(
  `^\\s*(?:set|change|make|update|put|switch)\\s+(?:the\\s+)?(${INSTR_FIELDS})\\s*(?:to|=|:|as)\\s*(.+)$`, "i");
const INSTR_BARE_RE = new RegExp(`^\\s*(${INSTR_FIELDS})\\s*(?:is|=|:)\\s*(.+)$`, "i");

const FIELD_ALIASES = {
  distributor: "distributor", supplier: "distributor", vendor: "distributor",
  date: "date",
  payment: "payment_method", "payment method": "payment_method", method: "payment_method",
  payment_method: "payment_method",
  memo: "memo", note: "memo",
  product: "product", item: "product",
  unit: "unit",
  quantity: "quantity", qty: "quantity",
  amount: "total_amount", total: "total_amount",
  total_amount: "total_amount",
};
const NUMERIC_FIELDS = ["quantity", "total_amount"];
const TEXT_LIMITS = { distributor: 80, product: 80, unit: 20, memo: 140 };

const HEADER_MAP = {
  date: "date", "transaction date": "date", "value date": "date", "posting date": "date",
  description: "description", details: "description", narration: "description",
  particulars: "description", name: "description",
  amount: "amount", debit: "debit", withdrawal: "debit", dr: "debit",
  credit: "credit", deposit: "credit", cr: "credit",
  balance: "balance",
  reference: "reference", ref: "reference", "reference no": "reference",
  "transaction id": "reference", "transaction id": "reference",
  "transaction reference": "reference",
};

const hasLetter = (s) => /[A-Za-z]/.test(s);

function findDate(text) {
  const src = String(text || "");
  let m = ISO_DATE_RE.exec(src);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${String(y).padStart(4, "0")}-${pad2(mo)}-${pad2(d)}`;
  }
  m = SLASH_DATE_RE.exec(src);
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3];
    const y = c < 100 ? c + 2000 : c;
    let day, mon;
    if (a > 12 && b <= 12) { day = a; mon = b; }
    else if (b > 12 && a <= 12) { day = b; mon = a; }
    else { day = a; mon = b; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31)
      return `${String(y).padStart(4, "0")}-${pad2(mon)}-${pad2(day)}`;
  }
  return "";
}

function findPayment(text) {
  const low = String(text || "").toLowerCase();
  for (const [name, keys] of PAYMENT_HINTS)
    for (const k of keys) if (low.includes(k)) return name;
  return "";
}

function draftUncertain(draft, totalLine) {
  const items = (draft && draft.items) || [];
  const out = [];
  if (totalLine != null && items.length > 1) {
    out.push({
      field: "total_amount",
      why: "the total does not match the line items",
      options: [
        r2(items.reduce((s, i) => s + (Number(i.total_amount) || 0), 0)),
        r2(totalLine),
      ],
    });
  }
  if (!draft.date) out.push({ field: "date", why: "no date found", options: [] });
  if (!draft.distributor) out.push({ field: "distributor", why: "no supplier name found", options: [] });
  if (!draft.payment_method)
    out.push({ field: "payment_method", why: "no payment method found", options: ["Cash", "Credit"] });
  if (!items.length) out.push({ field: "items", why: "no item lines matched", options: [] });
  items.forEach((it, i) => {
    if (!it.unit)
      out.push({ field: `items[${i}].unit`, why: "unit not readable", options: UNIT_SUGGESTIONS.slice(0, 6) });
    if (!(Number(it.quantity) > 0))
      out.push({ field: `items[${i}].quantity`, why: "quantity not readable", options: [] });
    if (!(Number(it.total_amount) > 0))
      out.push({ field: `items[${i}].total_amount`, why: "amount not readable", options: [] });
  });
  return out;
}

function extractDraft(text) {
  const draft = { date: "", distributor: "", items: [], payment_method: "", memo: "" };
  let totalLine = null;
  const memos = [];

  for (const raw of String(text || "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (WHOLE_DATE_RE.test(line)) {
      if (!draft.date) draft.date = findDate(line);
      continue;
    }
    let m = ITEM_4.exec(line);
    if (m) {
      draft.items.push({
        product: m[1].trim().slice(0, 80),
        quantity: toFloat(m[2]),
        unit: m[3].slice(0, 20),
        total_amount: toFloat(m[4]),
      });
      continue;
    }
    m = ITEM_3.exec(line);
    if (m) {
      draft.items.push({
        product: m[1].trim().slice(0, 80),
        quantity: toFloat(m[2]),
        unit: "",
        total_amount: toFloat(m[3]),
      });
      continue;
    }
    m = TOTAL_RE.exec(line);
    if (m) { totalLine = toFloat(m[1]); continue; }
    const pm = findPayment(line);
    // ASCII \d, matching the explicit range check in server.py.
    if (pm && !/[0-9]/.test(line)) { draft.payment_method = pm; continue; }
    const d = findDate(line);
    if (d) {
      if (!draft.date) draft.date = d;
      continue;
    }
    if (!draft.distributor && hasLetter(line)) { draft.distributor = line.slice(0, 80); continue; }
    if (hasLetter(line)) memos.push(line.slice(0, 140));
  }

  // A receipt's printed total is authoritative when there is a single line.
  if (totalLine != null && draft.items.length === 1)
    draft.items[0].total_amount = totalLine;

  if (memos.length) draft.memo = memos.join("; ").slice(0, 140);
  return [draft, draftUncertain(draft, totalLine)];
}

function normaliseDraft(obj) {
  const src = (obj && typeof obj === "object") ? obj : {};
  const raw = Array.isArray(src.items) ? src.items : [];
  const items = [];
  for (const it of raw.slice(0, 50)) {
    if (!it || typeof it !== "object") continue;
    items.push({
      product: String(it.product || "").trim().slice(0, 80),
      unit: String(it.unit || "").trim().slice(0, 20),
      quantity: toFloat(it.quantity),
      total_amount: toFloat(it.total_amount),
    });
  }
  const pm = String(src.payment_method || "").trim();
  return {
    date: findDate(String(src.date || "")) || "",
    distributor: String(src.distributor || "").trim().slice(0, 80),
    items,
    payment_method: PAYMENT_METHODS.includes(pm) ? pm : "",
    memo: String(src.memo || "").trim().slice(0, 140),
  };
}

function validateChange(field, value) {
  const raw = String(value == null ? "" : value).trim();
  if (field === "date") {
    const d = findDate(raw);
    return d ? [true, d] : [false, "date must be YYYY-MM-DD"];
  }
  if (field === "payment_method") {
    for (const pm of PAYMENT_METHODS)
      if (pm.toLowerCase() === raw.toLowerCase()) return [true, pm];
    const hit = findPayment(raw);
    if (hit) return [true, hit];
    return [false, `payment_method must be one of: ${PAYMENT_METHODS.join(", ")}`];
  }
  if (NUMERIC_FIELDS.includes(field)) {
    const num = raw.replace(/,/g, "");
    if (!STRICT_NUM_RE.test(num) || !(parseFloat(num) > 0))
      return [false, `${field} must be a positive number`];
    return [true, r2(parseFloat(num))];
  }
  const limit = TEXT_LIMITS[field] != null ? TEXT_LIMITS[field] : 80;
  if (!raw) return [false, `${field} is required`];
  return [true, raw.slice(0, limit)];
}

function applyPatch(changes) {
  const clean = {};
  if (changes && typeof changes === "object") {
    for (const [field, value] of Object.entries(changes)) {
      const name = FIELD_ALIASES[String(field).trim().toLowerCase()];
      if (!name) continue;
      const [flag, out] = validateChange(name, value);
      if (flag) clean[name] = out;
    }
  }
  if (!Object.keys(clean).length) return { op: "none", changes: {} };
  return { op: "update", target: "purchase_draft", changes: clean };
}

/* The agent's one call. The model never touches a record here: it is handed a
   description of the tools it may propose, whatever the owner's coverage lets
   it know, and the conversation so far, and it answers with what to say plus
   the actions it would like to run. Carrying those out — and asking permission
   first — is the app's job, not the model's. Mirror of server.py ai_agent(). */
async function aiAgent(payload) {
  const msgs = payload && Array.isArray(payload.messages) ? payload.messages : null;
  const single = payload && typeof payload.text === "string" ? payload.text : "";
  if (!msgs && !single.trim()) return [400, { error: AI_NOTHING_ERROR }];
  if (!providerSet()) return [200, { text: AI_AGENT_OFFLINE, source: "heuristic" }];

  const tools = payload && Array.isArray(payload.tools)
    ? payload.tools.filter((t) => typeof t === "string" || typeof t === "number")
        .map((t) => String(t))
    : [];
  const ctx = payload && typeof payload.context === "string" ? payload.context : "";
  const lines = (msgs || [{ role: "user", content: single }]).slice(-12).map((m) =>
    String((m && m.role) || "user") + ": " + String((m && m.content) || "").slice(0, 2000));
  const parts = ["Tools you may use:\n" + tools.join("\n")];
  if (ctx.trim()) parts.push("What you already know:\n" + ctx.slice(0, 4000));
  parts.push("Conversation:\n" + lines.join("\n"));
  parts.push("Reply with the JSON object now.");
  const text = await aiChat(parts.join("\n\n"), null, AI_PROMPT_AGENT);
  if (text === null) return [200, { text: AI_AGENT_DOWN, source: "" }];
  return [200, { text, source: "model" }];
}

/* The voice overlay's one call — mirror of server.py ai_voice(). The panel
   sends the transcript, the owner's language and a compact budget snapshot;
   back comes the model's raw text for voice.js to parse and validate before
   anything is applied. */
async function aiVoice(payload) {
  const transcript = payload && typeof payload.transcript === "string" ? payload.transcript : "";
  if (!transcript.trim()) return [400, { error: AI_NOTHING_ERROR }];
  if (!providerSet()) return [200, { text: AI_AGENT_OFFLINE, source: "heuristic" }];
  const lang = String((payload && payload.lang) || "en").slice(0, 12);
  const snap = payload && payload.snapshot && typeof payload.snapshot === "object" &&
    !Array.isArray(payload.snapshot) ? payload.snapshot : {};
  const hist = payload && Array.isArray(payload.history) ? payload.history.slice(-6) : [];
  const parts = [];
  if (hist.length) parts.push("Conversation:\n" + hist.map((m) =>
    String((m && m.role) || "user") + ": " + String((m && m.content) || "").slice(0, 2000)).join("\n"));
  parts.push("Language: " + lang);
  parts.push("Budget snapshot: " + JSON.stringify(snap).slice(0, 4000));
  parts.push("Transcript: " + transcript.slice(0, 2000));
  parts.push("Reply with the JSON object now.");
  const text = await aiChat(parts.join("\n\n"), null, AI_PROMPT_VOICE);
  if (text === null) return [200, { text: AI_AGENT_DOWN, source: "" }];
  return [200, { text, source: "model" }];
}

async function aiExtract(payload) {
  const text = String((payload && payload.text) || "");
  const image = String((payload && payload.image) || "");
  if (!text.trim() && !image) return [400, { error: AI_NOTHING_ERROR }];

  if (image && !text.trim()) {
    // Only a model can read pixels; a heuristic on an empty string would
    // quietly hand back a blank draft. With no key on this device the
    // refusal is byte-identical to a keyless server.py's.
    if (!providerSet()) return [400, { error: AI_IMAGE_ERROR }];
    const got = await aiCall("extract", { image }, AI_PROMPT_IMAGE);
    if (got === null) return [400, { error: AI_READ_ERROR }];
    const draft = normaliseDraft(got);
    return [200, { ok: true, draft, uncertain: draftUncertain(draft), source: "model" }];
  }

  if (providerSet()) {
    // `context` is the owner's scope at work: names and figures they have
    // allowed the model to see. Absent or empty it changes nothing.
    const ctx = String((payload && payload.context) || "").trim();
    const fixture = { text };
    if (ctx) fixture.context = ctx;
    const got = await aiCall("extract", fixture,
      AI_PROMPT_TEXT_PREFIX + (ctx ? ctx + "\n" : "") + text);
    if (got !== null) {
      const draft = normaliseDraft(got);
      const uncertain = Array.isArray(got.uncertain) ? got.uncertain : [];
      return [200, { ok: true, draft, uncertain, source: "model" }];
    }
  }

  const [draft, uncertain] = extractDraft(text);
  return [200, { ok: true, draft, uncertain, source: "heuristic" }];
}

async function aiInstruct(payload) {
  const draft = payload && payload.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft))
    return [400, { error: "draft is required" }];
  const instruction = String(payload.instruction || "").trim();
  if (!instruction) return [400, { error: "instruction is required" }];

  if (providerSet()) {
    const fields = [...new Set(Object.values(FIELD_ALIASES))].sort().join(", ");
    const got = await aiCall("instruct", { draft, instruction },
      AI_PROMPT_INSTRUCT + fields + ".\nDraft: " + JSON.stringify(draft) +
      "\nInstruction: " + instruction);
    if (got !== null) {
      // the same whitelist runs over a model's answer as over a person's
      const changes = got && typeof got === "object" && !Array.isArray(got)
        ? got.changes : null;
      return [200, { ok: true, patch: applyPatch(changes), source: "model" }];
    }
  }

  const m = INSTR_SET_RE.exec(instruction) || INSTR_BARE_RE.exec(instruction);
  if (!m) return [200, { ok: true, patch: { op: "none", changes: {} }, source: "heuristic" }];
  const field = FIELD_ALIASES[m[1].trim().toLowerCase()];
  const [flag, value] = validateChange(field, m[2]);
  if (!flag) return [400, { error: value }];
  return [200, { ok: true, source: "heuristic",
                 patch: { op: "update", target: "purchase_draft", changes: { [field]: value } } }];
}

function splitRow(line, delim) {
  const cells = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; continue; }
      quoted = !quoted;
      continue;
    }
    if (ch === delim && !quoted) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const cellAt = (cells, idx) =>
  (idx == null || idx < 0 || idx >= cells.length) ? "" : cells[idx];

function rowNumbers(text) {
  let src = String(text || "").replace(ISO_DATE_G, " ");
  src = src.replace(SLASH_DATE_G, " ");
  return (src.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((m) => parseFloat(m.replace(/,/g, "")));
}

function numCell(cells, idx) {
  if (idx == null) return null;
  const raw = cellAt(cells, idx).replace(/,/g, "");
  if (!STRICT_NUM_RE.test(raw)) return null;
  return parseFloat(raw);
}

function parseStatement(text) {
  const lines = String(text || "").split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (!lines.length) return [[], []];
  const delim = lines[0].includes("\t") ? "\t" : (lines[0].includes(";") ? ";" : ",");
  const rows = lines.map((l) => splitRow(l, delim));

  const cols = {};
  rows[0].forEach((cell, i) => {
    const key = HEADER_MAP[cell.trim().toLowerCase()];
    if (key && cols[key] === undefined) cols[key] = i;
  });
  const data = Object.keys(cols).length ? rows.slice(1) : rows;

  const candidates = [], uncertain = [];
  data.forEach((cells, n) => {
    if (!cells.some((c) => c)) return;
    const rowText = cells.join(" ");
    const date = cols.date != null ? findDate(cellAt(cells, cols.date)) : findDate(rowText);

    let amount = null, direction = null;
    if (cols.debit != null || cols.credit != null) {
      const dv = numCell(cells, cols.debit);
      const cv = numCell(cells, cols.credit);
      if (dv != null && dv > 0) { amount = dv; direction = "out"; }
      else if (cv != null && cv > 0) { amount = cv; direction = "in"; }
    }
    if (amount == null && cols.amount != null) {
      const av = numCell(cells, cols.amount);
      if (av != null && av !== 0) { amount = Math.abs(av); direction = av < 0 ? "out" : "in"; }
    }

    if (amount == null) {
      const found = rowNumbers(rowText);
      if (found.length) {
        amount = Math.abs(found[0]);
        if (found.length > 1) {
          uncertain.push({
            field: `rows[${n}].amount`,
            why: "more than one number in the row",
            options: found.slice(0, 4).map((v) => r2(Math.abs(v))),
          });
        }
      }
    }
    if (amount == null || amount <= 0) {
      uncertain.push({ field: `rows[${n}].amount`, why: "amount not readable", options: [] });
      return;
    }
    if (!date) uncertain.push({ field: `rows[${n}].date`, why: "no date found", options: [] });

    let desc = "";
    if (cols.description != null) {
      desc = cellAt(cells, cols.description);
    } else {
      // No description column: take the first readable cell and drop any date
      // from it, so "2026-09-22 Payment to Ceda" reads as a name.
      desc = cells.find((c) => hasLetter(c)) || "";
      if (desc) desc = desc.replace(ISO_DATE_G, "").replace(SLASH_DATE_G, "").trim();
    }
    if (direction == null) {
      direction = "out";
      uncertain.push({
        field: `rows[${n}].direction`,
        why: "no debit/credit column \u2014 assumed money out",
        options: ["out", "in"],
      });
    }

    candidates.push({
      date,
      direction,
      amount: r2(amount),
      description: desc.slice(0, 60),
      reference: cellAt(cells, cols.reference).slice(0, 40),
    });
  });

  if (!candidates.length)
    uncertain.push({ field: "candidates", why: "no transactions found", options: [] });
  return [candidates, uncertain];
}

async function aiStatement(payload) {
  const text = String((payload && payload.text) || "");
  const image = String((payload && payload.image) || "");
  if (!text.trim() && !image) return [400, { error: AI_NOTHING_ERROR }];

  if (image && !text.trim()) {
    // Same refusal as a keyless server.py: pixels need a model.
    if (!providerSet()) return [400, { error: AI_IMAGE_ERROR }];
    const got = await aiCall("statement", { image }, AI_PROMPT_STATEMENT_IMAGE);
    if (got === null) return [400, { error: AI_READ_ERROR }];
    return [200, statementResult(got, "model")];
  }

  if (providerSet()) {
    const got = await aiCall("statement", { text },
      AI_PROMPT_STATEMENT_TEXT_PREFIX + text);
    if (got !== null) return [200, statementResult(got, "model")];
  }

  const [candidates, uncertain] = parseStatement(text);
  return [200, { ok: true, candidates, uncertain, source: "heuristic" }];
}

/* Model answers arrive as loose JSON; this is the shape both engines agree on. */
function statementResult(got, source) {
  const cand = got && Array.isArray(got.candidates) ? got.candidates : [];
  const unc = got && Array.isArray(got.uncertain) ? got.uncertain : [];
  return { ok: true, candidates: cand.slice(0, 200), uncertain: unc, source };
}

/* ---------------- request dispatcher (mirror server.py _api) ----------------
   route() answers; request() is the public entry and owns write safety: it
   snapshots the store, runs the route, and if the write did not stick it puts
   the store back and answers 507 — the same status server.py answers with when
   its own disk is full. GETs are never snapshotted (they cannot write), and
   neither are the /api/ai/* routes (they only propose, never write). */
function request(method, path, qs, body) {
  const writes = (method === "POST" || method === "DELETE") &&
    path.indexOf("/api/ai/") !== 0;
  const attempts = SAVE_ATTEMPTS;
  const before = writes ? JSON.stringify(load()) : null;
  const res = route(method, path, qs, body);
  if (res && typeof res.then === "function") return res.then((r) => settled(r, before, attempts));
  return settled(res, before, attempts);
}

function settled(res, before, attempts) {
  if (before === null || SAVE_ATTEMPTS === attempts || !SAVE_ERROR) return res;
  try { DB = JSON.parse(before); } catch (e) { /* keep what we have */ }
  return { status: 507, body: { error: SAVE_ERROR } };
}

function route(method, path, qs, body) {
  qs = qs || {};
  body = body || {};
  load();

  const q = (k) => (qs[k] !== undefined && qs[k] !== null ? String(qs[k]) : "");

  // meta & misc
  if (path === "/api/health") return { status: 200, body: { ok: true } };
  if (path === "/api/meta") return { status: 200, body: metaData() };

  // branches
  if (path === "/api/branches" && method === "GET")
    return { status: 200, body: { branches: metaData().branches } };
  if (path === "/api/branches" && method === "POST") {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) return { status: 400, body: { error: "branch name is required" } };
    if (DB.branches.some((b) => b.name === name))
      return { status: 400, body: { error: "branch already exists" } };
    const id = nextId();
    DB.branches.push({ id, name });
    save();
    return { status: 201, body: { ok: true, id, name } };
  }

  // dropdown data
  if (path === "/api/distributors" && method === "GET")
    return { status: 200, body: { distributors: metaData().distributors } };
  if (path === "/api/products" && method === "GET")
    return { status: 200, body: { products: metaData().products } };

  // purchases
  if (path === "/api/purchases" && method === "GET")
    return { status: 200, body: purchasesQuery(qs) };
  if (path === "/api/purchases" && method === "POST")
    return createPurchase(body);

  const pm2 = path.match(/^\/api\/purchases\/(\d+)\/(pay|move)$/);
  if (pm2 && method === "POST") {
    const pid = toInt(pm2[1]);
    const purchase = DB.purchases.find((p) => p.id === pid);
    if (!purchase) return { status: 404, body: { error: "purchase not found" } };
    if (pm2[2] === "move") {
      const bid = toInt(body.branch_id);
      if (!bid) return { status: 400, body: { error: "branch_id required" } };
      if (!DB.branches.some((b) => b.id === bid))
        return { status: 400, body: { error: "a valid branch_id is required" } };
      purchase.branch_id = bid;
      save();
      return { status: 200, body: { ok: true, id: pid } };
    }
    // pay toward credit
    const rawDate = String(body.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate))
      return { status: 400, body: { error: "date must be YYYY-MM-DD" } };
    const amount = toFloat(body.amount);
    const cs = creditStats({ purchase_id: pid });
    if (!cs.length) return { status: 400, body: { error: "not a credit purchase" } };
    const balance = cs[0].balance;
    if (!(amount > 0)) return { status: 400, body: { error: "amount must be greater than zero" } };
    if (amount > balance + 0.005)
      return { status: 400, body: { error: `amount exceeds remaining balance (${money(balance)})` } };
    DB.credit_payments.push({
      id: nextId(), purchase_id: pid, date: rawDate, amount,
      memo: String(body.memo || "").trim().slice(0, 120), created_at: todayISO(),
    });
    save();
    return { status: 201, body: { ok: true, id: pid, credit: creditStats({ purchase_id: pid })[0] } };
  }

  const pm3 = path.match(/^\/api\/purchases\/(\d+)$/);
  if (pm3 && method === "DELETE") {
    const pid = toInt(pm3[1]);
    const idx = DB.purchases.findIndex((p) => p.id === pid);
    if (idx === -1) return { status: 404, body: { error: "purchase not found" } };
    DB.purchases.splice(idx, 1);
    DB.credit_payments = DB.credit_payments.filter((cp) => cp.purchase_id !== pid);
    save();
    return { status: 200, body: { ok: true } };
  }

  // income (money in)
  if (path === "/api/income" && method === "GET")
    return { status: 200, body: incomeQuery(qs) };
  if (path === "/api/income" && method === "POST")
    return createIncome(body);

  const pm4 = path.match(/^\/api\/income\/(\d+)$/);
  if (pm4 && method === "DELETE") {
    const iid = toInt(pm4[1]);
    const idx = (DB.income || []).findIndex((r) => r.id === iid);
    if (idx === -1) return { status: 404, body: { error: "income not found" } };
    DB.income.splice(idx, 1);
    save();
    return { status: 200, body: { ok: true } };
  }

  // credits
  if (path === "/api/credits" && method === "GET") {
    const bid = toInt(q("branch_id")) || null;
    const rows = creditStats(bid ? { branch_id: bid } : {});
    const open = rows.filter((r) => r.balance > 0.005);
    const settled = rows.filter((r) => r.balance <= 0.005);
    return { status: 200, body: {
      open, settled,
      outstanding: r2(rows.reduce((s, r) => s + r.balance, 0)),
      open_count: open.length,
    } };
  }

  // analytics
  if (path === "/api/analytics" && method === "GET") {
    const bid = toInt(q("branch_id")) || null;
    const n = Math.min(24, Math.max(3, toInt(q("n"), 6)));
    return { status: 200, body: analytics(bid, n) };
  }

  // budget
  if (path === "/api/budget" && method === "GET") {
    const now = new Date();
    const year = toInt(q("year"), now.getFullYear());
    const month = toInt(q("month"), now.getMonth() + 1);
    const bidRaw = q("branch_id");
    const bid = bidRaw && bidRaw !== "all" ? toInt(bidRaw) : null;
    return { status: 200, body: budgetView(bid, year, month) };
  }
  if (path === "/api/budget" && method === "POST") {
    const now = new Date();
    const year = toInt(body.year, now.getFullYear());
    const month = toInt(body.month, now.getMonth() + 1);
    const bidRaw = body.branch_id;
    const bid = bidRaw !== undefined && bidRaw !== null && bidRaw !== "" && bidRaw !== "all"
      ? toInt(bidRaw) : null;
    let alloc = body.allocations;
    if (!(alloc == null || alloc.length === 0)) {
      alloc = alloc.map((a) => ({
        name: String((a && a.name) || ""), percent: toFloat(a && a.percent),
      }));
    } else {
      alloc = recommendBudget(bid, year, month);
    }
    if (!(toFloat(body.total_amount) > 0))
      return { status: 400, body: { error: "total_amount must be greater than zero" } };
    const total = toFloat(body.total_amount);
    const saveAmt = toFloat(body.save_amount);
    DB.budgets = DB.budgets.filter((b) =>
      !(b.year === year && b.month === month &&
        ((b.branch_id == null && bid == null) || b.branch_id === bid)));
    DB.budgets.push({
      id: nextId(), branch_id: bid, year, month, total_amount: total,
      save_amount: saveAmt, allocations: alloc, updated_at: todayISO(),
    });
    save();
    return { status: 200, body: { ok: true, ...budgetView(bid, year, month) } };
  }

  // AI extraction layer — proposal only, never writes. Mirror of the three
  // /api/ai/* routes in server.py. extract/instruct/statement can use a model
  // when the owner has pasted a key into Settings (setProvider); otherwise
  // they answer exactly like a keyless server.py. All three may be
  // asynchronous, because a model round-trip is, so each hands back a Promise.
  if (path === "/api/ai/extract" && method === "POST")
    return aiExtract(body).then((r) => ({ status: r[0], body: r[1] }));
  if (path === "/api/ai/instruct" && method === "POST")
    return aiInstruct(body).then((r) => ({ status: r[0], body: r[1] }));
  if (path === "/api/ai/statement" && method === "POST")
    return aiStatement(body).then((r) => ({ status: r[0], body: r[1] }));
  if (path === "/api/ai/chat" && method === "POST")
    return aiAgent(body).then((r) => ({ status: r[0], body: r[1] }));
  if (path === "/api/ai/voice" && method === "POST")
    return aiVoice(body).then((r) => ({ status: r[0], body: r[1] }));

  return { status: 404, body: { error: "not found" } };
}

const PWDB = { request, load, save, storageKey: LS_KEY, setProvider, providerSet,
  storageStatus, exportData, importData };
if (typeof globalThis !== "undefined") globalThis.PWDB = PWDB;