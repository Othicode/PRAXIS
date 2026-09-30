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
      credit_payments: [], budgets: [], created: todayISO(),
    };
    save();
  }
  return DB;
}
function save() {
  try { globalThis.localStorage && localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
  catch (e) { /* storage full / unavailable */ }
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
  const series = ml.map(([y, m]) => {
    const ym = `${y}-${pad2(m)}`;
    const g = monthlyMap[ym] || {};
    return {
      month: ym,
      spend: r2(g.spend || 0), buys: g.buys || 0, credit_new: r2(g.credit_new || 0),
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
    months: DB.purchases.map((p) => p.date.slice(0, 7))
      .filter((v, i, a) => a.indexOf(v) === i).sort().reverse(),
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

/* ---------------- request dispatcher (mirror server.py _api) ---------------- */
function request(method, path, qs, body) {
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

  return { status: 404, body: { error: "not found" } };
}

const PWDB = { request, load, save, storageKey: LS_KEY };
if (typeof globalThis !== "undefined") globalThis.PWDB = PWDB;