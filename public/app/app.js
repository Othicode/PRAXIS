/* ============ PW Budget - frontend ============ */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const COLORS = {
  spend: "#c9971f", credit: "#f87171", paid: "#34d399", income: "#34d399",
  cash: "#cbd5e1", bank: "#d4af37", mobile: "#2dd4bf",
};
const PALETTE = ["#f59e0b", "#d4af37", "#7c3aed", "#2dd4bf", "#f87171",
  "#94a3b8", "#db2777", "#ea580c", "#a78bfa", "#65a30d",
  "#0891b2", "#9333ea", "#fbbf24", "#38bdf8", "#be123c", "#34d399"];

let META = null;
const state = {
  view: "dashboard",
  branch_id: null,
  page: 1,
  filters: { q: "", month: "", dist: "", product: "", pay: "", owed: false },
  income: { q: "", month: "", page: 1 },
  // Working copy of the last statement read. It lives here, unticked and
  // unrecorded, until the owner presses "Record money in" — a statement
  // never writes a row by itself.
  stmt: { rows: [], image: "", source: "" },
  budget: { year: null, month: null, rows: [] },
  // Remaining line items from a scan, recorded one at a time through the
  // normal save path so a 3-line receipt becomes 3 purchases.
  scanQueue: [],
  review: [],
};

/* ---------- shop identity (per-device, works offline) ---------- */
const PROFILE_KEY = "pwbudget.profile.v1";
let PROFILE = { owner: "", business: "", phone: "" };
function loadProfile() {
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem(PROFILE_KEY);
    if (raw) PROFILE = { ...PROFILE, ...JSON.parse(raw) };
  } catch (e) { /* keep defaults */ }
  return PROFILE;
}
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE)); } catch (e) { /* full */ }
}
const initialsOf = (s) => {
  const w = String(s || "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "•";
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
};
const greetingFor = (h) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
function renderProfile() {
  const owner = (PROFILE.owner || "").trim();
  const biz = (PROFILE.business || "").trim();
  const nameEl = $("#profile-name"), bizEl = $("#profile-business"),
    avEl = $("#profile-avatar"), brandEl = $("#brand-name"), subEl = $("#brand-sub");
  if (nameEl) nameEl.textContent = owner || "Set up";
  if (bizEl) bizEl.textContent = biz || "Your shop";
  if (avEl) avEl.textContent = initialsOf(owner || biz || "PW");
  if (brandEl) brandEl.textContent = biz || "PW Budget";
  if (subEl) subEl.textContent = owner ? `${owner} · Stock · Credit` : "Stock · Distributors · Credit";
  const mark = $("#brand-mark");
  if (mark) mark.textContent = initialsOf(biz || owner || "PW");
}
function renderWelcome() {
  const hello = $("#welcome-hello"), sub = $("#welcome-sub"), dateEl = $("#welcome-date");
  if (!hello) return;
  const owner = (PROFILE.owner || "").trim();
  const biz = (PROFILE.business || "").trim();
  const h = new Date().getHours();
  hello.textContent = owner ? `${greetingFor(h)}, ${owner.split(/\s+/)[0]}` : `${greetingFor(h)} — welcome back`;
  const branch = state.branch_id
    ? (META && META.branches.find((x) => x.id === Number(state.branch_id)) || {}).name : "";
  sub.textContent = biz
    ? `${biz}${branch ? ` · viewing ${branch}` : " · all branches"} — here's what's happening today.`
    : `${branch ? `Viewing ${branch}` : "All branches"} — here's what's happening today.`;
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function openProfileDialog() {
  const o = $("#p-owner"), b = $("#p-business"), p = $("#p-phone"), err = $("#profile-err");
  if (o) o.value = PROFILE.owner || "";
  if (b) b.value = PROFILE.business || "";
  if (p) p.value = PROFILE.phone || "";
  if (err) err.textContent = "";
  const dlg = $("#profile-dialog");
  if (dlg && dlg.showModal) dlg.showModal();
  setTimeout(() => o && o.focus && o.focus(), 50);
}
async function submitProfile(e) {
  e.preventDefault();
  PROFILE.owner = ($("#p-owner").value || "").trim().slice(0, 40);
  PROFILE.business = ($("#p-business").value || "").trim().slice(0, 60);
  PROFILE.phone = ($("#p-phone").value || "").trim().slice(0, 20);
  saveProfile();
  renderProfile();
  renderWelcome();
  const dlg = $("#profile-dialog");
  if (dlg && dlg.close) dlg.close();
  toast(PROFILE.owner ? `Welcome, ${PROFILE.owner.split(/\s+/)[0]} ✓` : "Identity saved ✓");
}

/* ---------- appearance: bright / dark (per-device) ---------- */
const THEME_KEY = "pwbudget.theme.v1";
const THEME_META = { dark: "#07070a", light: "#f5f2ea" };  // <meta name="theme-color">
function currentTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* no storage */ }
  if (saved === "light" || saved === "dark") return saved;
  try {
    const el = document.documentElement;
    const attr = el && el.getAttribute ? el.getAttribute("data-theme") : null;
    if (attr === "light" || attr === "dark") return attr;
  } catch (e) { /* no document element */ }
  return "dark";                                   // default: onyx & gold
}
function applyTheme(theme, persist) {
  const t = theme === "light" ? "light" : "dark";
  try {
    const el = document.documentElement;
    if (el && el.setAttribute) el.setAttribute("data-theme", t);
  } catch (e) { /* headless */ }
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.setAttribute) meta.setAttribute("content", THEME_META[t]);
  } catch (e) { /* no meta */ }
  const ico = $("#theme-ico");
  if (ico) ico.textContent = t === "light" ? "🌙" : "☀️";   // shows the theme you'd switch to
  const btn = $("#btn-theme");
  if (btn) {
    btn.title = t === "light" ? "Switch to dark appearance" : "Switch to bright appearance";
    if (btn.setAttribute) btn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
    btn.classList.toggle("bright", t === "light");
  }
  const mark = (id, on) => { const el = $("#" + id); if (el) el.classList.toggle("active", on); };
  mark("theme-dark", t === "dark");
  mark("theme-light", t === "light");
  if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* full */ } }
  return t;
}
const toggleTheme = () => applyTheme(currentTheme() === "light" ? "dark" : "light", true);

/* ---------- Android / PWA install ---------- */
let deferredInstall = null;
function showInstallUI(show) {
  ["#btn-install", "#install-hint"].forEach((sel) => {
    const el = $(sel);
    if (el) el.classList.toggle("hidden", !show);
  });
  const b2 = $("#btn-install-2");
  if (b2) b2.classList.toggle("hidden", !show);
  // the phone "More" sheet carries its own install entry
  const b3 = $("#btn-install-more");
  if (b3) b3.classList.toggle("hidden", !show);
}
async function promptInstall() {
  if (deferredInstall) {
    try { deferredInstall.prompt(); await deferredInstall.userChoice; } catch (e) { /* dismissed */ }
    deferredInstall = null;
    showInstallUI(false);
    return;
  }
  toast("To install: Chrome menu ⋮ → Install app / Add to Home screen");
}
function initInstall() {
  try {
    if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return;
    if (window.navigator && window.navigator.standalone) return;
  } catch (e) { /* browser */ }
  try {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstall = e;
      showInstallUI(true);
    });
    window.addEventListener("appinstalled", () => {
      deferredInstall = null;
      showInstallUI(false);
      toast("PW Budget installed ✓ — find it on your home screen");
    });
  } catch (e) { /* ignore */ }
  // Fallback hint for Android Chrome where prompt hasn't fired yet
  try {
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    if (isAndroid) showInstallUI(true);
  } catch (e) { /* ignore */ }
}

/* ---------- helpers ---------- */
const cur = (n) => {
  const v = Number(n) || 0;
  return (META ? META.currency : "GH\u20b5 ") + v.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
};
const curShort = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const sym = (META ? META.currency : "GH\u20b5 ");
  if (a >= 1e6) return sign + sym + (a / 1e6).toFixed(1) + "m";
  if (a >= 1e4) return sign + sym + (a / 1e3).toFixed(0) + "k";
  return sign + sym + a.toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const num = (n) => (Number(n) || 0).toLocaleString("en-US", {
  maximumFractionDigits: Number(n) % 1 ? 2 : 0,
});
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};
const monthName = (m) => new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const ymOf = (ym) => { const [y, m] = ym.split("-").map(Number); return { y, m }; };

/* ---------- reminders / alerts ----------
   Everything is derived from data the app already fetches (no extra API
   round-trip), so it works identically online and in the offline PWA. */
const DAY_MS = 86400000;

/* Whole-day age of a YYYY-MM-DD date, counted in the user's own calendar. */
function daysSince(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return 0;
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const n = new Date();
  const now = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.max(0, Math.round((now - then) / DAY_MS));
}
/* 60+ days = overdue, 30–59 = worth a nudge. */
const ageTone = (age) => (age >= 60 ? "old" : age >= 30 ? "soon" : "fresh");
const agePill = (age) =>
  `<span class="age-pill ${ageTone(age)}">${age >= 60 ? "⏳ " : ""}${num(age)} day${age === 1 ? "" : "s"} old</span>`;

/* Red count on the Credits tab when credit is getting old.
   Returns how many open credits need attention (0 = badge hidden). */
function updateCreditBadge(open) {
  const btn = document.querySelector('.nav-btn[data-view="credits"]');
  if (!btn) return 0;
  let badge = btn.querySelector(".nav-badge");
  const ages = (open || []).map((c) => daysSince(c.date));
  const overdue = ages.filter((a) => a >= 60).length;
  const soon = ages.filter((a) => a >= 30 && a < 60).length;
  const count = overdue || soon;
  if (!count) { if (badge) badge.remove(); return 0; }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "nav-badge";
    btn.appendChild(badge);
  }
  badge.className = "nav-badge" + (overdue ? "" : " soon");
  badge.textContent = String(count);
  badge.title = overdue
    ? `${overdue} credit${overdue === 1 ? "" : "s"} 60+ days old — pay it`
    : `${soon} credit${soon === 1 ? "" : "s"} 30+ days old`;
  return count;
}

/* Build the reminder list: overdue credit, ageing credit, budget burn,
   and unit-price spikes. Ordered worst-first, max 4. */
function buildAlerts(data) {
  const out = [];
  const open = (((data || {}).creds && data.creds.open) || [])
    .map((c) => ({ ...c, age: daysSince(c.date) }))
    .sort((a, b) => b.age - a.age);

  const overdue = open.filter((c) => c.age >= 60);
  const dueSoon = open.filter((c) => c.age >= 30 && c.age < 60);
  if (overdue.length) {
    const owed = overdue.reduce((s, c) => s + (c.balance || 0), 0);
    const o = overdue[0];
    out.push({
      tone: "red", icon: "⏳",
      title: `${overdue.length} credit${overdue.length === 1 ? "" : "s"} overdue — ${cur(owed)} still owed`,
      detail: `${o.product} · ${o.distributor} is ${num(o.age)} days old — pay it`,
      view: "credits", action: "Open credits",
    });
  } else if (dueSoon.length) {
    const owed = dueSoon.reduce((s, c) => s + (c.balance || 0), 0);
    const o = dueSoon[0];
    out.push({
      tone: "amber", icon: "🔔",
      title: `${dueSoon.length} credit${dueSoon.length === 1 ? "" : "s"} 30+ days old — ${cur(owed)} outstanding`,
      detail: `Oldest is ${o.product} · ${o.distributor} at ${num(o.age)} days old`,
      view: "credits", action: "Review credits",
    });
  }

  const b = (data || {}).budget;
  if (b && b.saved && b.allocations && b.allocations.length && b.spendable > 0) {
    const spent = Number(b.actual_spend) || 0;
    const left = b.spendable - spent;
    const when = b.month ? monthName(b.month) : "this month";
    if (left < -0.005) {
      out.push({
        tone: "red", icon: "🎯",
        title: `Over budget by ${cur(-left)}`,
        detail: `${cur(spent)} spent of ${cur(b.spendable)} spendable in ${when}`,
        view: "budget", action: "Open budget",
      });
    } else if (spent / b.spendable >= 0.9) {
      out.push({
        tone: "amber", icon: "🎯",
        title: `Only ${cur(left)} left to spend`,
        detail: `${((spent / b.spendable) * 100).toFixed(0)}% of ${cur(b.spendable)} used in ${when}`,
        view: "budget", action: "Open budget",
      });
    }
  }

  const trends = ((data || {}).a && data.a.unit_trend) || [];
  let spike = null;
  for (const u of trends) {
    const p = u.points || [];
    if (p.length < 2) continue;
    const last = p[p.length - 1], prev = p[p.length - 2];
    if (!(prev.avg > 0)) continue;
    const delta = (last.avg - prev.avg) / prev.avg;
    if (delta >= 0.15 && (!spike || delta > spike.delta)) spike = { u, prev, last, delta };
  }
  if (spike) {
    out.push({
      tone: "gold", icon: "📈",
      title: `${spike.u.product} costs ${Math.round(spike.delta * 100)}% more`,
      detail: `Unit price ${cur(spike.prev.avg)} → ${cur(spike.last.avg)} · ${monthLabel(spike.prev.month)} → ${monthLabel(spike.last.month)}`,
      view: "analytics", action: "See price trend",
    });
  }
  return out.slice(0, 4);
}

function renderAlerts(list) {
  const box = $("#alert-stack");
  if (!box) return;
  const items = (list || []).slice(0, 4);
  box.classList.toggle("hidden", !items.length);
  if (!items.length) { box.innerHTML = ""; return; }
  box.innerHTML = items.map((a) => `
    <div class="alert ${a.tone}">
      <span class="a-ico" aria-hidden="true">${a.icon}</span>
      <span class="a-body"><strong>${esc(a.title)}</strong><small>${esc(a.detail)}</small></span>
      <button class="btn ghost small" data-goto="${a.view}">${esc(a.action)} →</button>
    </div>`).join("");
  box.querySelectorAll("[data-goto]").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.goto)));
}

const OFFLINE_ENGINE = (() => {
  try {
    if (typeof location !== "undefined" &&
        new URLSearchParams(location.search).has("offline")) return true;
  } catch (e) { /* ignore */ }
  try { if (typeof navigator !== "undefined" && navigator.standalone) return true; } catch (e) { /* ignore */ }
  try {
    if (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) return true;
  } catch (e) { /* ignore */ }
  return false;
})();

let serverAvailable = true;

async function offlineRequest(method, pathname, qs, body) {
  if (typeof PWDB === "undefined") throw new Error("offline engine not available in this browser");
  // awaited, not assumed-sync: /api/ai/extract may take a model round-trip.
  const r = await PWDB.request(method, pathname, qs, body);
  if (r.status >= 400) throw new Error(r.body.error || `HTTP ${r.status}`);
  return r.body;
}

function serverDown(path, method, u, qs, body) {
  serverAvailable = false;
  console.warn("PW Budget: server API unreachable — switched to offline mode (data saved on this device).");
  toast("Offline mode — data is saved on this device", "ok");
  showOfflineBadge();
  return offlineRequest(method, u.pathname, qs, body);
}

function showOfflineBadge() {
  const el = $("#offline-badge");
  if (el) el.classList.remove("hidden");
}

async function api(path, opts) {
  const method = (opts && opts.method) || "GET";
  const u = new URL(path, "https://pwbudget.local");
  const qs = {};
  u.searchParams.forEach((v, k) => { qs[k] = v; });
  const body = opts && opts.body ? JSON.parse(opts.body) : {};

  // Installed PWA (add to home screen), or the server was found to be
  // missing -> fully offline engine, no internet needed.
  if (OFFLINE_ENGINE || !serverAvailable) {
    return await offlineRequest(method, u.pathname, qs, body);
  }

  let res = null, netError = null;
  try { res = await fetch(path, opts); }
  catch (e) { netError = e; }

  // Network failure (offline, host down) -> run on this device.
  if (netError) return await serverDown(path, method, u, qs, body);

  // Our server always answers /api/* with application/json (even errors).
  // Anything else (404 HTML, SPA fallback page) means there is no real
  // backend here -> fall back to the offline engine instead of failing.
  const ct = res.headers.get("content-type") || "";
  if (path.startsWith("/api/") && !ct.includes("application/json")) {
    return await serverDown(path, method, u, qs, body);
  }

  const rbody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(rbody.error || `HTTP ${res.status}`);
  return rbody;
}

function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = "toast"), 2800);
}

const analyticsUrl = (n = 6) => {
  let u = `/api/analytics?n=${n}`;
  if (state.branch_id) u += `&branch_id=${state.branch_id}`;
  return u;
};
const branchScope = () => (state.branch_id ? `?branch_id=${state.branch_id}` : "");

/* ---------- SVG charts (offline, no deps) ---------- */
function svgEl(w, h) { return `<svg viewBox="0 0 ${w} ${h}">`; }

function niceStep(max) {
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return step * mag;
}

function groupedBars(labels, series, height = 230) {
  const W = 760, H = height, padL = 56, padR = 10, padT = 12, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const n = labels.length;
  const gw = iw / n;
  const groupW = Math.min(gw - 8, 60 + series.length * 8);
  const bw = Math.max(6, (groupW - (series.length - 1) * 3) / series.length);

  let out = svgEl(W, H);
  for (let i = 0; i <= 4; i++) {
    const v = (top * i) / 4;
    const y = padT + ih - (v / top) * ih;
    out += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="c-grid"/>`;
    out += `<text x="${padL - 7}" y="${y + 4}" font-size="10.5" class="c-lab" text-anchor="end">${curShort(v)}</text>`;
  }
  labels.forEach((lbl, gi) => {
    const gx = padL + gi * gw + (gw - groupW) / 2;
    series.forEach((s, si) => {
      const v = s.values[gi] || 0;
      const h = (v / top) * ih;
      const x = gx + si * (bw + 3);
      out += `<rect x="${x.toFixed(1)}" y="${(padT + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="3" fill="${s.color}" opacity=".95"><title>${esc(s.name)} · ${lbl}: ${cur(v)}</title></rect>`;
    });
    out += `<text x="${padL + gi * gw + gw / 2}" y="${H - 8}" font-size="11" class="c-lab" text-anchor="middle">${esc(lbl)}</text>`;
  });
  return out + "</svg>";
}

function donut(items, size = 185, title = "Total") {
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = size / 2 - 16, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * R;
  let acc = 0, out = svgEl(size, size);
  out += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" class="c-track" stroke-width="25"/>`;
  if (total <= 0) return out + `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="13" class="c-lab">No data</text></svg>`;
  items.forEach((it) => {
    const frac = it.value / total;
    const dash = frac * circ;
    out += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${it.color}" stroke-width="25" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-acc * circ}" transform="rotate(-90 ${cx} ${cy})" opacity=".95"><title>${esc(it.name)}: ${cur(it.value)} (${(frac * 100).toFixed(1)}%)</title></circle>`;
    acc += frac;
  });
  out += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="11" class="c-lab">${esc(title)}</text>`;
  out += `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="14.5" font-weight="800" class="c-total">${curShort(total)}</text>`;
  return out + "</svg>";
}

function multiLine(series, labels, height = 210) {
  const W = 760, H = height, padL = 52, padR = 10, padT = 14, padB = 28;
  const iw = W - padL - padR, ih = H - padT - padB;
  const all = series.flatMap((s) => s.points.map((p) => p.v));
  const max = Math.max(...all, 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const X = (i) => padL + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const Y = (v) => padT + ih - (v / top) * ih;

  let out = svgEl(W, H);
  for (let i = 0; i <= 4; i++) {
    const v = (top * i) / 4;
    const y = Y(v);
    out += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="c-grid"/>`;
    out += `<text x="${padL - 7}" y="${y + 4}" font-size="10.5" class="c-lab" text-anchor="end">${curShort(v)}</text>`;
  }
  labels.forEach((lbl, i) => {
    out += `<text x="${X(i)}" y="${H - 7}" font-size="11" class="c-lab" text-anchor="middle">${esc(lbl)}</text>`;
  });
  series.forEach((s, si) => {
    const pts = s.points.map((p) => ({ x: X(labels.indexOf(p.m)), y: Y(p.v) }));
    if (!pts.length) return;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    out += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    pts.forEach((p) => {
      out += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="c-dot" stroke="${s.color}" stroke-width="2.5"><title>${esc(s.name)} ${esc(labels[pts.indexOf(p)])}: ${cur(p.v)}</title></circle>`;
    });
  });
  return out + "</svg>";
}

function legend(items) {
  return items.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
}

/* ---------- state ---------- */
function branchLabel(id) {
  const b = META.branches.find((x) => x.id === Number(id));
  return b ? b.name : "All branches";
}

/* ============================ DASHBOARD ============================ */
async function loadDashboard() {
  renderWelcome();
  const a = await api(analyticsUrl(6));
  const months = a.months;
  const curM = months[months.length - 1];
  const prevM = months[months.length - 2];
  const delta = prevM && prevM.spend ? (curM.spend - prevM.spend) / prevM.spend : null;

  const curYm = curM.month;
  const purchases = await api(`/api/purchases?month=${curYm}&page_size=8${state.branch_id ? `&branch_id=${state.branch_id}` : ""}`);
  const creds = await api(`/api/credits${branchScope()}`);
  const budget = await api(`/api/budget?year=${curM.month.slice(0, 4)}&month=${curM.month.slice(5, 7)}${state.branch_id ? `&branch_id=${state.branch_id}` : ""}`);

  const spent = curM.spend;
  const remaining = budget.saved && budget.allocations.length
    ? budget.spendable - budget.actual_spend : null;

  const kpis = [
    { c: "", label: "Spend this month", value: cur(spent),
      sub: `${num(curM.buys)} purchases ${delta !== null ? `<span class="k-delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta * 100).toFixed(0)}%</span>` : ""}` },
    { c: "orange", label: "Last month", value: cur(prevM ? prevM.spend : 0),
      sub: prevM ? `${num(prevM.buys)} purchases` : "no data yet" },
    { c: "green", label: "Money in this month", value: cur(curM.income || 0),
      sub: `net ${cur((curM.income || 0) - spent)} · tap for detail`, goto: "income" },
    { c: "red", label: "Outstanding credit", value: cur(creds.outstanding),
      sub: `${creds.open_count} unpaid account${creds.open_count === 1 ? "" : "s"}` },
    { c: "green", label: "Budget left to spend", value: remaining !== null ? cur(remaining) : "—",
      sub: budget.saved ? `of ${cur(budget.spendable)} after savings` : "set a budget in 🎯 Budget" },
  ];
  $("#kpis").innerHTML = kpis.map((k) => `
    <div class="kpi ${k.c}" ${k.goto ? `data-goto="${k.goto}"` : ""}>
      <div class="k-label">${k.label}</div>
      <div class="k-value">${k.value}</div>
      <div class="k-sub">${k.sub}</div>
    </div>`).join("");

  $("#legend-flow").innerHTML = legend([
    ["Money in", COLORS.income], ["Spend", COLORS.spend], ["New credit", COLORS.credit],
  ]);
  $("#chart-flow").innerHTML = groupedBars(
    months.map((m) => monthLabel(m.month)),
    [
      { name: "Money in", color: COLORS.income, values: months.map((m) => m.income || 0) },
      { name: "Spend", color: COLORS.spend, values: months.map((m) => m.spend) },
      { name: "New credit", color: COLORS.credit, values: months.map((m) => m.credit_new) },
    ],
  );

  const top = (a.top_items || []).slice(0, 6);
  const others = (a.top_items || []).slice(6).reduce((s, x) => s + x.spend, 0);
  const di = top.map((t, i) => ({ name: t.product, value: t.spend, color: PALETTE[i % PALETTE.length] }));
  if (others > 1) di.push({ name: "Other items", value: others, color: PALETTE[6 % PALETTE.length] });
  $("#chart-donut").innerHTML = donut(di, 185, "Spent in " + monthLabel(curYm));
  $("#donut-legend").innerHTML = di.map((d) => `
    <div class="d-row"><span class="d-dot" style="background:${d.color}"></span>
      <span class="d-name">${esc(d.name)}</span>
      <span class="d-amt">${cur(d.value)}</span>
      <span class="d-pct">${curM.spend ? ((d.value / curM.spend) * 100).toFixed(0) : 0}%</span>
    </div>`).join("") || `<div class="d-row"><span class="d-name">No purchases yet</span></div>`;

  $("#top-items-list").innerHTML = (a.top_items || []).slice(0, 6).map((t) => `
    <div class="h-item">
      <span class="h-name">${esc(t.product)}</span>
      <div class="h-bar"><i style="width:${Math.max(t.share, 3)}%;background:${PALETTE[0]}"></i></div>
      <span class="h-val">${num(t.qty)} ${esc(t.unit)}s</span>
    </div>`).join("") || `<div class="h-item"><span class="h-name">No purchases</span></div>`;

  $("#recent-list").innerHTML = purchases.rows.length ? purchases.rows.slice(0, 7).map((r) => `
    <div class="recent-row">
      <span class="r-date">${r.date.slice(5)}</span>
      <span class="r-item">${esc(r.product)}<small>${esc(r.distributor)} · ${num(r.quantity)} ${esc(r.unit)}</small></span>
      <span class="r-amt">${cur(r.total)}</span>
    </div>`).join("") : `<div class="recent-row"><span class="r-item">No purchases this month yet.</span></div>`;

  const open = creds.open.slice(0, 5);
  $("#credit-watch").innerHTML = open.length ? open.map((c) => {
    const age = daysSince(c.date);
    return `
    <div class="credit-watch-item">
      <span class="cw-name">${esc(c.product)} <small>${esc(c.distributor)} · ${c.percent}% settled${age >= 30 ? agePill(age) : ""}</small></span>
      <span class="cw-bal">${cur(c.balance)}</span>
    </div>`;
  }).join("") : `<div class="credit-watch-item"><span class="cw-name">✅ No outstanding credit</span></div>`;

  // reminders: overdue credit / budget burn / price spikes (hidden when quiet)
  renderAlerts(buildAlerts({ creds, budget, a }));
  updateCreditBadge(creds.open);
}

/* ============================ PURCHASES ============================ */
async function loadPurchases() {
  const f = state.filters;
  const qs = new URLSearchParams();
  if (state.branch_id) qs.set("branch_id", state.branch_id);
  if (f.q) qs.set("q", f.q);
  if (f.month) qs.set("month", f.month);
  if (f.dist) qs.set("distributor", f.dist);
  if (f.product) qs.set("product", f.product);
  if (f.pay) qs.set("payment", f.pay);
  if (f.owed) qs.set("owed", "1");
  qs.set("page", state.page);
  qs.set("page_size", 25);
  const d = await api(`/api/purchases?${qs}`);
  state.page = d.page;

  $("#purchase-count").textContent = `${d.total} purchases`;
  $("#page-info").textContent = `Page ${d.page} of ${d.pages}`;
  $("#page-prev").disabled = d.page <= 1;
  $("#page-next").disabled = d.page >= d.pages;

  $("#purchase-body").innerHTML = d.rows.map((r) => {
    const pill = {
      Cash: `<span class="pill cash">Cash</span>`,
      "Bank Transfer": `<span class="pill bank">Bank</span>`,
      "Mobile Money": `<span class="pill mobile">MoMo</span>`,
      Credit: `<span class="pill credit">Credit</span>`,
    }[r.payment_method] || esc(r.payment_method);

    let creditCell = `<span class="branch-tag">—</span>`;
    if (r.credit) {
      if (r.credit.balance > 0.005) {
        creditCell = `<span class="pill open">${cur(r.credit.balance)} · ${r.credit.percent}%</span>`;
      } else {
        creditCell = `<span class="pill paid">${r.credit.percent}% paid</span>`;
      }
    }
    /* data-label lets styles.css turn each row into a stacked card on
       phones (table.ledger td[data-label]::before) while desktop keeps
       the real table + <thead>. */
    const memo = r.memo ? `<span class="branch-tag memo">${esc(r.memo)}</span>` : "";
    return `<tr>
      <td data-label="Date">${r.date}</td>
      <td data-label="Distributor"><strong>${esc(r.distributor)}</strong></td>
      <td data-label="Item">${esc(r.product)} ${memo}</td>
      <td class="num" data-label="Qty">${num(r.quantity)}</td>
      <td class="num" data-label="Unit price">${curShort(r.unit_price)}</td>
      <td class="num amt tot" data-label="Total">${cur(r.total)}</td>
      <td data-label="Paid via">${pill}</td>
      <td data-label="Credit">${creditCell}</td>
      <td class="branch-tag" data-label="Branch">${esc(r.branch)}</td>
      <td><div class="row-actions">
        ${r.credit && r.credit.balance > 0.005 ? `<button class="icon-btn" title="Pay credit" data-pay="${r.id}">💳 Pay</button>` : ""}
        <button class="icon-btn" title="Move to branch" data-move="${r.id}">↔ Move</button>
        <button class="icon-btn danger" title="Delete" data-del="${r.id}">🗑</button>
      </div></td>
    </tr>`;
  }).join("") || `<tr class="empty-row"><td colspan="10">No purchases match. Try the big ＋ New Purchase button!</td></tr>`;
}

/* Move dialog helper - quick inline select via prompt-less dialog */
async function movePurchase(id) {
  const opts = META.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  const chosen = await pickDialog("Move purchase to branch", opts, "Move ↺");
  if (!chosen) return;
  try {
    const r = await api(`/api/purchases/${id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_id: chosen }),
    });
    toast("Purchase moved ✓");
    loadPurchases();
  } catch (e) { toast(e.message, "err"); }
}

function pickDialog(title, optionsHtml, btnLabel) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `
      <div style="padding:22px"><div class="dialog-head"><h3>${esc(title)}</h3>
      <button class="btn ghost small" id="pick-cancel">✕</button></div>
      <div class="form-grid"><label>Choose<select id="pick-sel">${optionsHtml}</select></label></div>
      <div class="dialog-foot"><button class="btn ghost" id="pick-cancel2">Cancel</button>
      <button class="btn primary" id="pick-ok">${esc(btnLabel)}</button></div></div>`;
    document.body.appendChild(dlg);
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector("#pick-ok").onclick = () => close(dlg.querySelector("#pick-sel").value);
    dlg.querySelector("#pick-cancel").onclick = () => close(null);
    dlg.querySelector("#pick-cancel2").onclick = () => close(null);
    dlg.showModal();
  });
}

/* ============================ MONEY IN ============================
   The other half of the ledger. A purchase is money out; this is money in.
   Statements arrive as *candidates* — read, tick, then record — so nothing
   lands in the books without the owner having seen it first. */
async function loadIncome() {
  const f = state.income;
  const qs = new URLSearchParams();
  if (state.branch_id) qs.set("branch_id", state.branch_id);
  if (f.q) qs.set("q", f.q);
  if (f.month) qs.set("month", f.month);
  qs.set("page", f.page);
  qs.set("page_size", 25);

  const [d, a] = await Promise.all([api(`/api/income?${qs}`), api(analyticsUrl(6))]);
  f.page = d.page;
  const t = a.totals;

  const card = $("#stmt-card");
  if (card) card.classList.toggle("hidden", !aiAllows("capture"));
  const sel = $("#income-month");
  if (sel) sel.value = f.month || "";

  $("#income-count").textContent = `${d.total} records`;
  $("#income-page").textContent = `Page ${d.page} of ${d.pages}`;
  $("#income-prev").disabled = d.page <= 1;
  $("#income-next").disabled = d.page >= d.pages;

  $("#income-kpis").innerHTML = `
    <div class="kpi green"><div class="k-label">Money in <span class="sub">(6 mo)</span></div>
      <div class="k-value">${cur(t.income)}</div><div class="k-sub">what came into the shop</div></div>
    <div class="kpi orange"><div class="k-label">Money out <span class="sub">(6 mo)</span></div>
      <div class="k-value">${cur(t.spend)}</div><div class="k-sub">${num(t.buys)} purchases</div></div>
    <div class="kpi ${t.net >= 0 ? "green" : "red"}"><div class="k-label">Left over <span class="sub">(6 mo)</span></div>
      <div class="k-value">${cur(t.net)}</div><div class="k-sub">money in − money out</div></div>
    <div class="kpi"><div class="k-label">Records here</div>
      <div class="k-value">${num(d.total)}</div><div class="k-sub">${branchLabel(state.branch_id)}</div></div>`;

  $("#income-body").innerHTML = d.rows.map((r) => `<tr>
      <td data-label="Date">${r.date}</td>
      <td data-label="Source"><strong>${esc(r.source)}</strong></td>
      <td data-label="Reference">${esc(r.reference || "—")}</td>
      <td class="num amt tot" data-label="Amount">${cur(r.amount)}</td>
      <td class="branch-tag" data-label="Branch">${esc(r.branch)}</td>
      <td data-label="Memo">${r.memo ? `<span class="branch-tag memo">${esc(r.memo)}</span>` : "—"}</td>
      <td><div class="row-actions">
        <button class="icon-btn danger" title="Delete" data-inc-del="${r.id}">🗑</button>
      </div></td>
    </tr>`).join("") ||
    `<tr class="empty-row"><td colspan="7">No money in here yet. Add it with ＋ Money in, or read a statement above.</td></tr>`;
}

/* ---------- statement ingest: read → tick → record ---------- */
const stmtBranch = () =>
  state.branch_id || (META.branches[0] && META.branches[0].id) || 0;
const stmtDateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

function stmtSetBusy(busy) {
  const b = $("#btn-stmt-read");
  if (b) b.disabled = !!busy;
  const n = $("#stmt-note");
  if (n && busy) n.textContent = "Reading…";
}

async function readStatement() {
  const text = ($("#stmt-text").value || "").trim();
  const image = state.stmt.image;
  const note = $("#stmt-note");
  if (!text && !image) {
    note.textContent = "Paste lines, choose a CSV, or take a screenshot first.";
    return;
  }
  stmtSetBusy(true);
  try {
    const payload = image && !text ? { image } : { text };
    const r = await aiRequest("/api/ai/statement", payload);
    note.textContent = "";
    renderStatement(r.candidates || [], r.uncertain || [], r.source || "");
  } catch (e) {
    note.textContent = "";
    $("#stmt-out").classList.add("hidden");
    toast(e.message, "err");
  } finally {
    stmtSetBusy(false);
    if ($("#btn-stmt-read")) $("#btn-stmt-read").disabled = false;
  }
}

function renderStatement(cand, uncertain, source) {
  state.stmt.rows = (cand || []).map((c, i) => ({
    i,
    date: String((c && c.date) || ""),
    dir: String((c && c.direction) || "").toLowerCase() === "out" ? "out" : "in",
    amount: Number((c && c.amount) || 0),
    description: String((c && c.description) || ""),
    reference: String((c && c.reference) || ""),
  }));
  state.stmt.source = source;

  const usable = state.stmt.rows.filter((r) => r.dir === "in" && r.amount > 0 && stmtDateOk(r.date));
  const spent = state.stmt.rows.filter((r) => r.dir === "out").length;

  $("#stmt-out").classList.remove("hidden");
  $("#stmt-summary").innerHTML = usable.length
    ? `<strong>${usable.length}</strong> money in · <span class="sub">${spent} money out, not imported</span>`
    : `<span class="sub">No money-in rows found</span>`;
  $("#stmt-src").textContent = source ? `read by ${source}` : "";

  const warn = $("#stmt-warn");
  if (uncertain.length) {
    warn.classList.remove("hidden");
    warn.innerHTML = `<strong>${uncertain.length} to check:</strong> ` +
      uncertain.slice(0, 6).map((u) => `${esc(u.field)} — ${esc(u.why)}`).join(" · ");
  } else {
    warn.classList.add("hidden");
    warn.innerHTML = "";
  }

  $("#stmt-rows").innerHTML = state.stmt.rows.map((r) => {
    const good = r.dir === "in" && r.amount > 0 && stmtDateOk(r.date);
    const why = !stmtDateOk(r.date) ? "no readable date"
      : r.amount <= 0 ? "no amount"
      : r.dir === "out" ? "money out — record it as a purchase instead" : "";
    return `<label class="stmt-row ${good ? "" : "off"}">
      <input type="checkbox" class="stmt-tick" data-i="${r.i}" ${good ? "checked" : "disabled"}>
      <span class="stmt-dir ${r.dir}">${r.dir}</span>
      <span class="stmt-date">${esc(r.date) || "?"}</span>
      <span class="stmt-desc">${esc(r.description) || "—"}</span>
      <span class="stmt-ref">${esc(r.reference)}</span>
      <span class="stmt-amt">${cur(r.amount)}</span>
      ${why ? `<span class="stmt-why">${why}</span>` : ""}
    </label>`;
  }).join("") || `<p class="sub">Nothing readable in that.</p>`;

  $("#btn-stmt-record").disabled = !usable.length;
  $("#stmt-rec-note").textContent = usable.length
    ? `${usable.length} ticked will become money-in rows`
    : "";
}

async function recordStatement() {
  const ticks = Array.prototype.slice.call(
    document.querySelectorAll("#stmt-rows .stmt-tick")).filter((c) => c.checked);
  const note = $("#stmt-rec-note");
  if (!ticks.length) { note.textContent = "Tick the rows you want to keep first."; return; }
  const branch_id = stmtBranch();
  let saved = 0;
  for (const c of ticks) {
    const r = state.stmt.rows[Number(c.dataset.i)];
    if (!r) continue;
    try {
      await api("/api/income", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: r.date, branch_id, amount: r.amount,
          source: r.description || "Statement", reference: r.reference,
          memo: "imported from statement",
        }),
      });
      saved += 1;
    } catch (e) { /* keep going — one bad row must not lose the rest */ }
  }
  toast(`${saved} money-in row${saved === 1 ? "" : "s"} recorded ✓`);
  await refreshMeta();
  clearStatement();
  loadIncome();
}

function clearStatement() {
  state.stmt = { rows: [], image: "", source: "" };
  const ta = $("#stmt-text");
  if (ta) ta.value = "";
  const out = $("#stmt-out");
  if (out) out.classList.add("hidden");
  const note = $("#stmt-note");
  if (note) note.textContent = "";
  const rows = $("#stmt-rows");
  if (rows) rows.innerHTML = "";
  ["#stmt-csv", "#stmt-img"].forEach((s) => { const el = $(s); if (el) el.value = ""; });
}

function readFileText(file, into) {
  if (typeof FileReader === "undefined") { toast("This browser cannot read files", "err"); return; }
  const fr = new FileReader();
  fr.onload = () => { into(String(fr.result || "")); readStatement(); };
  fr.onerror = () => toast("Could not read that file", "err");
  fr.readAsText(file);
}

function readShot(file) {
  compressImage(file).then((dataUrl) => {
    state.stmt.image = dataUrl;
    $("#stmt-note").textContent = "Screenshot ready — press Read statement.";
  }).catch((e) => toast(e.message, "err"));
}

/* ---------- manual money in ---------- */
function openIncomeDialog() {
  $("#income-form").reset();
  $("#i-err").textContent = "";
  $("#i-date").value = today();
  $("#i-branch").innerHTML = META.branches
    .map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("#i-branch").value = stmtBranch();
  $("#income-dialog").showModal();
  setTimeout(() => $("#i-amount").focus(), 50);
}

async function submitIncome(e) {
  e.preventDefault();
  const err = $("#i-err");
  err.textContent = "";
  const payload = {
    date: $("#i-date").value,
    branch_id: Number($("#i-branch").value),
    amount: Number($("#i-amount").value),
    source: $("#i-source").value.trim(),
    reference: $("#i-ref").value.trim(),
    memo: $("#i-memo").value.trim(),
  };
  try {
    await api("/api/income", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    $("#income-dialog").close();
    toast("Money in recorded ✓");
    await refreshMeta();
    loadIncome();
  } catch (ex) { err.textContent = ex.message; }
}

/* ============================ CREDITS ============================ */
async function loadCredits() {
  const c = await api(`/api/credits${branchScope()}`);
  const totalCredit = c.outstanding + c.open.reduce((s, x) => s + (x.total - x.balance), 0) +
    c.settled.reduce((s, x) => s + x.total, 0);

  const withAge = c.open.map((x) => ({ ...x, age: daysSince(x.date) }))
    .sort((a, b) => b.age - a.age);
  const oldest = withAge[0];
  const overdueCount = withAge.filter((x) => x.age >= 60).length;

  $("#credit-kpis").innerHTML = `
    <div class="kpi red"><div class="k-label">Total outstanding</div><div class="k-value">${cur(c.outstanding)}</div><div class="k-sub">${c.open_count} unpaid account${c.open_count === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="k-label">Total credit raised</div><div class="k-value">${cur(totalCredit)}</div><div class="k-sub">what suppliers financed</div></div>
    <div class="kpi green"><div class="k-label">Cleared so far</div><div class="k-value">${cur(totalCredit - c.outstanding)}</div><div class="k-sub">${totalCredit ? ((totalCredit - c.outstanding) / totalCredit * 100).toFixed(0) : 0}% of all credit</div></div>
    <div class="kpi ${oldest ? (oldest.age >= 60 ? "red" : oldest.age >= 30 ? "orange" : "") : ""}"><div class="k-label">Oldest open credit</div><div class="k-value ${oldest ? "sm" : ""}">${oldest ? `${num(oldest.age)} days` : "—"}</div><div class="k-sub">${oldest ? `${esc(oldest.product)} · ${esc(oldest.distributor)}` : "nothing outstanding"}${overdueCount > 1 ? ` · ${overdueCount} overdue` : ""}</div></div>`;
  $("#credit-range").innerHTML = `<span class="sub">${branchLabel(state.branch_id)}</span>`;
  updateCreditBadge(c.open);

  const pay = (id) => openPayDialog(id);

  $("#credit-list").innerHTML = c.open.length ? c.open.map((cc) => `
    <div class="credit-card">
      <div class="cc-main">
        <div class="cc-title">${esc(cc.product)} <span class="pill ${cc.percent >= 50 ? "paid" : "open"}">${cc.percent}% settled</span>${agePill(daysSince(cc.date))}</div>
        <div class="cc-sub">${esc(cc.distributor)} · ${cc.date} · ${num(cc.quantity)} ${esc(cc.unit)}s · ${esc(cc.branch)}</div>
        ${cc.payments.length ? `<div class="pay-history">payments: ${cc.payments.map((p) => `+${cur(p.amount)} on ${p.date}`).join(", ")}</div>` : ""}
      </div>
      <div class="cc-nums">
        <div class="cn"><label>Original</label><div class="cn-val">${cur(cc.total)}</div></div>
        <div class="cn"><label>Paid</label><div class="cn-val" style="color:var(--green)">${cur(cc.paid)}</div></div>
        <div class="cn"><label>Left</label><div class="cn-val red">${cur(cc.balance)}</div></div>
      </div>
      <div class="cc-pct"><div class="pct-num">${cc.percent}% paid</div>
        <div class="progress"><i style="width:${cc.percent}%"></i></div></div>
      <div class="cc-actions"><button class="btn primary small" data-pay="${cc.id}">💳 Pay now</button></div>
    </div>`).join("") : `<p style="color:var(--muted);padding:10px 2px">No outstanding credit. 🎉</p>`;

  document.querySelectorAll("#credit-list [data-pay]").forEach((b) =>
    b.addEventListener("click", () => pay(b.dataset.pay)));

  $("#credit-settled").innerHTML = c.settled.length ? c.settled.map((cc) => `
    <div class="credit-card">
      <div class="cc-main">
        <div class="cc-title">${esc(cc.product)} <span class="pill paid">fully paid ✓</span></div>
        <div class="cc-sub">${esc(cc.distributor)} · ${cc.date} · ${esc(cc.branch)}</div>
      </div>
      <div class="cc-nums"><div class="cn"><label>Total</label><div class="cn-val">${cur(cc.total)}</div></div></div>
    </div>`).join("") : `<p style="color:var(--muted);padding:10px 2px">No settled credits yet.</p>`;
}

let activePayId = null;
async function openPayDialog(id) {
  activePayId = Number(id);
  let card = window._creditCache && window._creditCache.find((c) => c.id === activePayId);
  if (!card) {
    const c = await api(`/api/credits${branchScope()}`);
    window._creditCache = [...c.open, ...c.settled];
    card = window._creditCache.find((x) => x.id === activePayId);
  }
  if (!card) return;
  const age = daysSince(card.date);
  $("#pay-info").innerHTML = `Credit on <b>${esc(card.product)}</b> from <b>${esc(card.distributor)}</b><br>
    Original ${cur(card.total)} · already paid ${cur(card.paid)} · <b style="color:var(--red)">balance ${cur(card.balance)}</b>
    ${age >= 30 ? `<br><b style="color:${age >= 60 ? "var(--red)" : "var(--amber)"}">⏳ ${num(age)} days old${age >= 60 ? " — pay it" : ""}</b>` : ""}`;
  $("#pay-amount").value = card.balance.toFixed(2);
  $("#pay-amount").max = card.balance;
  $("#pay-date").value = today();
  $("#pay-err").textContent = "";
  $("#pay-dialog").showModal();
}

/* ============================ ANALYTICS ============================ */
async function loadAnalytics() {
  const a = await api(analyticsUrl(6));
  const t = a.totals;
  $("#ana-kpis").innerHTML = `
    <div class="kpi"><div class="k-label">Total spend <span class="sub">(6 mo)</span></div><div class="k-value">${cur(t.spend)}</div><div class="k-sub">${num(t.buys)} purchases</div></div>
    <div class="kpi orange"><div class="k-label">Distinct items</div><div class="k-value">${num(t.items)}</div><div class="k-sub">${num(t.distributors)} distributors</div></div>
    <div class="kpi"><div class="k-label">Avg / purchase</div><div class="k-value">${t.buys ? cur(t.spend / t.buys) : "—"}</div><div class="k-sub">${branchLabel(state.branch_id)}</div></div>
    <div class="kpi red"><div class="k-label">Credit outstanding</div><div class="k-value">${cur(t.credit_outstanding)}</div><div class="k-sub">${t.total_credit ? ((t.credit_outstanding / t.total_credit) * 100).toFixed(0) : 0}% of ${cur(t.total_credit)} still owed</div></div>`;

  const items = a.top_items.slice(0, 7);
  const others = a.top_items.slice(7).reduce((s, x) => s + x.spend, 0);
  const di = items.map((x, i) => ({ name: x.product, value: x.spend, color: PALETTE[i % PALETTE.length] }));
  if (others > 1) di.push({ name: "Other", value: others, color: PALETTE[6 % PALETTE.length] });
  $("#chart-items").innerHTML = donut(di, 200, "Spend split");
  $("#legend-item").innerHTML = `<span class="sub">share of ${cur(t.spend)}</span>`;

  const maxSpend = Math.max(...items.map((x) => x.spend), 1);
  $("#item-table").innerHTML = items.map((x, i) => `
    <div class="h-item">
      <span class="h-name">${esc(x.product)}</span>
      <div class="h-bar"><i style="width:${(x.spend / maxSpend * 100).toFixed(0)}%;background:${PALETTE[i % PALETTE.length]}"></i></div>
      <span class="h-val">${cur(x.spend)}</span>
      <span class="h-sub">${x.share}%</span>
    </div>`).join("") || `<div class="h-item"><span class="h-name">No data</span></div>`;

  $("#qty-list").innerHTML = a.top_by_qty.map((x) => `
    <div class="qty-row"><span class="q-name">${esc(x.product)}</span>
      <span class="q-val">bought <strong>${num(x.qty)} ${esc(x.unit)}s</strong> · ${x.buys}×</span></div>`).join("");

  const maxDist = Math.max(...a.by_distributor.map((d) => d.spend), 1);
  /* NOTE: #dist-list is the <datalist> in the purchase dialog — the spend-by-
     distributor list must use its own id or populateDatalists() would wipe it. */
  $("#dist-spend").innerHTML = a.by_distributor.map((d, i) => `
    <div class="h-item">
      <span class="h-name">${esc(d.name)}</span>
      <div class="h-bar"><i style="width:${(d.spend / maxDist * 100).toFixed(0)}%;background:${PALETTE[(i + 7) % PALETTE.length]}"></i></div>
      <span class="h-val">${cur(d.spend)}</span>
      <span class="h-sub">${d.share}%</span>
    </div>`).join("") || `<div class="h-item"><span class="h-name">No data</span></div>`;

  const maxPay = Math.max(...a.payment_split.map((p) => p.spend), 1);
  const payColors = { Cash: COLORS.cash, "Bank Transfer": COLORS.bank, "Mobile Money": COLORS.mobile, Credit: COLORS.credit };
  $("#pay-list").innerHTML = a.payment_split.map((p, i) => `
    <div class="h-item">
      <span class="h-name">${esc(p.method)}</span>
      <div class="h-bar"><i style="width:${(p.spend / maxPay * 100).toFixed(0)}%;background:${payColors[p.method] || PALETTE[i]}"></i></div>
      <span class="h-val">${cur(p.spend)}</span>
      <span class="h-sub">${p.buys}×</span>
    </div>`).join("");

  // unit price trends for top 5
  const labels = a.months.map((m) => monthLabel(m.month));
  const trendSeries = (a.unit_trend || []).filter((u) => u.points.length > 1).slice(0, 4).map((u, i) => ({
    name: u.product,
    color: PALETTE[i % PALETTE.length],
    points: labels.map((mn, mi) => {
      const found = u.points.find((p) => monthLabel(p.month) === mn);
      return found ? { m: labels[mi], v: found.avg } : null;
    }).filter(Boolean),
  }));
  $("#legend-trend").innerHTML = trendSeries.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
  $("#chart-trend").innerHTML = trendSeries.length
    ? multiLine(trendSeries, labels)
    : `<p style="color:var(--muted);padding:30px 0;text-align:center">Buy an item across several months to see its price trend.</p>`;
}

/* ============================ BUDGET ============================ */
async function loadBudget() {
  const now = new Date();
  const y = state.budget.year || now.getFullYear();
  const m = state.budget.month || now.getMonth() + 1;

  // populate year/month selects
  const years = new Set([now.getFullYear()]);
  (META.months || []).forEach((mm) => years.add(Number(mm.slice(0, 4))));
  $("#b-year").innerHTML = [...years].sort().map((yy) => `<option ${yy === y ? "selected" : ""}>${yy}</option>`).join("");
  $("#b-month").innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map((mm) =>
    `<option value="${mm}" ${mm === m ? "selected" : ""}>${monthName(mm)}</option>`).join("");

  const bid = state.branch_id ? `&branch_id=${state.branch_id}` : "";
  const b = await api(`/api/budget?year=${y}&month=${m}${bid}`);
  state.budget = {
    year: y, month: m, rows: b.allocations,
    baseTotal: b.total_amount, baseSave: b.save_amount,
    actual_spend: b.actual_spend,
  };

  $("#b-total").value = b.total_amount || "";
  $("#b-save").value = b.save_amount || "";
  renderBudgetBody(b);
}

function renderBudgetBody(b) {
  const rows = state.budget.rows;
  const sumPct = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const total = Number(state.budget.baseTotal) || 0;
  const save = Number(state.budget.baseSave) || 0;
  const spendable = Math.max(total - save, 0);

  $("#b-spendable").innerHTML = `
    <span>Total budget <b>${cur(total)}</b></span>
    <span>Savings <b style="color:var(--green)">− ${cur(save)}</b></span>
    <span>Spendable <b style="color:var(--navy)">${cur(spendable)}</b></span>
    <span style="margin-left:auto;color:var(--muted)">allocations sum: <b style="color:${Math.abs(sumPct - 100) < 0.5 ? "var(--green)" : "var(--red)"}">${sumPct.toFixed(1)}%</b></span>`;

  $("#b-alloc").innerHTML = rows.map((r, i) => `
    <div class="alloc-row">
      <span class="all-name">${esc(r.name)}</span>
      <input type="number" data-idx="${i}" data-field="percent" value="${r.percent}" min="0" max="100" step="0.1" placeholder="%" title="Percent of the spendable budget" aria-label="Percent of budget for ${esc(r.name)}">
      <span class="al-amt">${cur(spendable * r.percent / 100)}</span>
      <span class="al-actual ${r.actual > (spendable * r.percent / 100) ? "over" : ""}">${cur(r.actual)}</span>
      <button class="al-del" data-del-alloc="${i}" title="remove">✕</button>
    </div>`).join("") || `<div class="alloc-row"><span>Enter a budget, then click ⚡ Auto-distribute.</span></div>`;

  // live recompute on % change
  document.querySelectorAll("[data-field='percent']").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      state.budget.rows[idx].percent = Number(e.target.value) || 0;
      const row = e.target.closest(".alloc-row");
      row.querySelector(".al-amt").textContent = cur(spendable * (Number(e.target.value) || 0) / 100);
      updateAllocSum();
    });
  });
  document.querySelectorAll("[data-del-alloc]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      state.budget.rows.splice(Number(e.target.dataset.delAlloc), 1);
      renderBudgetBody(b);
    });
  });
  updateAllocSum();

  // KPI: what's planned vs what's already spent
  const savingsTarget = save;
  const needed = Math.max(spendable - b.actual_spend, 0);
  const onTrack = b.actual_spend <= spendable;
  $("#budget-kpis").innerHTML = `
    <div class="kpi"><div class="k-label">${monthName(b.month)} plan</div><div class="k-value">${cur(b.total_amount)}</div><div class="k-sub">saving ${cur(b.save_amount)}</div></div>
    <div class="kpi ${onTrack ? "green" : "red"}"><div class="k-label">Spent in ${monthName(b.month)}</div><div class="k-value">${cur(b.actual_spend)}</div><div class="k-sub">${onTrack ? "✓ within allocation" : "⚠ over allocation"}</div></div>
    <div class="kpi"><div class="k-label">Still available</div><div class="k-value">${cur(needed)}</div><div class="k-sub">of ${cur(spendable)} after savings</div></div>`;
}

function updateAllocSum() {
  const sum = state.budget.rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const el = $("#b-sum");
  if (el) el.textContent = Math.abs(sum - 100) < 0.5
    ? "✓ allocations add up to 100%"
    : `allocations add up to ${sum.toFixed(1)}% — tip: keep it near 100%`;
}

/* ============================ BRANCHES ============================ */
async function loadBranches() {
  const list = $("#branch-list");
  list.innerHTML = "";
  for (const b of META.branches) {
    const a = await api(`/api/analytics?branch_id=${b.id}&n=12`);
    const div = document.createElement("div");
    div.className = "branch-row" + (Number(state.branch_id) === b.id ? " current" : "");
    div.innerHTML = `
      <span class="br-name"><span class="b-dot"></span>${esc(b.name)}
        ${Number(state.branch_id) === b.id ? '<span class="pill bank">current</span>' : ""}</span>
      <span class="br-stats">
        <span>spend <strong>${cur(a.totals.spend)}</strong></span>
        <span>purchases <strong>${num(a.totals.buys)}</strong></span>
        <span>credit owed <strong style="color:var(--red)">${cur(a.totals.credit_outstanding)}</strong></span>
        <button class="btn ghost small" data-switch="${b.id}">open branch &gt;</button>
      </span>`;
    const openBranch = () => {
      if (Number(state.branch_id) !== b.id) {
        state.branch_id = b.id;
        $("#branch-select").value = b.id;
        toast(`Now viewing ${b.name} — dashboard, purchases, credits & analytics are scoped to it`);
      }
      switchView("dashboard");
    };
    div.addEventListener("click", (e) => {
      if (!e.target.closest("[data-switch]")) openBranch();
    });
    div.querySelector("[data-switch]").addEventListener("click", openBranch);
    list.appendChild(div);
  }
}

/* ============================ NAV & BOOTSTRAP ============================ */
const TITLES = {
  dashboard: ["Dashboard", "Everything at a glance"],
  purchases: ["Purchases", "Every item you buy, recorded"],
  income: ["Money in", "Sales, deposits and takings"],
  credits: ["Credit tracker", "What you owe suppliers"],
  analytics: ["Analytics", "Where every cedi goes"],
  budget: ["Budget", "Plan, save, and track"],
  branches: ["Branches", "Your shops and plants"],
};

async function switchView(view) {
  state.view = view;
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + view).classList.remove("hidden");
  document.title = `${TITLES[view][0]} - PW Budget`;
  /* On phones the Budget/Branches tabs live inside the "More" sheet, so the
     More tab itself has to light up while one of them is on screen. */
  const more = $("#nav-more");
  if (more) more.classList.toggle("active",
    view === "budget" || view === "branches" || view === "income");
  closeMore();
  try {
    if (view === "dashboard") await loadDashboard();
    else if (view === "purchases") await loadPurchases();
    else if (view === "income") await loadIncome();
    else if (view === "credits") await loadCredits();
    else if (view === "analytics") await loadAnalytics();
    else if (view === "budget") await loadBudget();
    else await loadBranches();
  } catch (err) { toast(err.message, "err"); }
}

/* ---------- phone navigation: the "More" bottom sheet ---------- */
function closeMore() {
  const sheet = $("#more-sheet"), scrim = $("#more-scrim"), trigger = $("#nav-more");
  if (sheet) sheet.classList.remove("open");
  if (scrim) scrim.classList.remove("open");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}
function toggleMore(force) {
  const sheet = $("#more-sheet"), scrim = $("#more-scrim"), trigger = $("#nav-more");
  if (!sheet) return;
  const open = force === undefined ? !sheet.classList.contains("open") : !!force;
  sheet.classList.toggle("open", open);
  if (scrim) scrim.classList.toggle("open", open);
  if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
}

/* ---------- new purchase dialog ---------- */
function populateDatalists() {
  $("#dist-list").innerHTML = META.distributors.map((d) => `<option value="${esc(d)}">`).join("");
  $("#prod-list").innerHTML = META.products.map((p) => `<option value="${esc(p.name)}">`).join("");
  $("#unit-list").innerHTML = META.units.map((u) => `<option value="${esc(u)}">`).join("");
  $("#f-method").innerHTML = (META.payment_methods || [])
    .map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
}

function populateFilters() {
  const f = state.filters;
  $("#filter-month").innerHTML = `<option value="">All months</option>` +
    (META.months || []).map((m) => `<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("");
  $("#income-month").innerHTML = `<option value="">All months</option>` +
    (META.months || []).map((m) => `<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("");
  $("#filter-dist").innerHTML = `<option value="">All distributors</option>` +
    (META.distributor_options || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  $("#filter-product").innerHTML = `<option value="">All items</option>` +
    (META.product_options || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  // re-apply current selection so a refresh (after save/delete) keeps the filters
  $("#filter-month").value = f.month || "";
  $("#filter-dist").value = f.dist || "";
  $("#filter-product").value = f.product || "";
  $("#income-month").value = state.income.month || "";
}

function populateBranches() {
  const opts = META.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("#branch-select").innerHTML = `<option value="">All branches</option>` + opts;
  $("#f-branch").innerHTML = opts;
  $("#i-branch").innerHTML = opts;
  if (state.branch_id) {
    $("#branch-select").value = state.branch_id;
    $("#f-branch").value = state.branch_id;
    $("#i-branch").value = state.branch_id;
  } else if (META.branches.length) {
    $("#f-branch").value = META.branches[0].id;
    $("#i-branch").value = META.branches[0].id;
  }
}

function openEntryDialog() {
  $("#dialog-title").textContent = "🧾 New purchase";
  $("#f-date").value = today();
  $("#f-dist").value = "";
  $("#f-product").value = "";
  $("#f-unit").value = "";
  $("#f-qty").value = "1";
  $("#f-total").value = "";
  $("#f-memo").value = "";
  $("#f-method").value = "Cash";
  $("#f-credit-paid").value = "";
  $("#form-err").textContent = "";
  resetScan();
  const scanBar = $("#scan-bar");
  if (scanBar) scanBar.classList.toggle("hidden", !aiAllows("capture"));
  $("#f-branch").value = state.branch_id || META.branches[0].id;
  updateCreditMode();
  updateLiveBox();
  $("#entry-dialog").showModal();
  setTimeout(() => $("#f-dist").focus(), 50);
}

function updateCreditMode() {
  const isCredit = $("#f-method").value === "Credit";
  $("#lbl-credit-paid").classList.toggle("hidden", !isCredit);
  $("#lbl-total").querySelector("span")?.remove();
  if (isCredit) {
    const span = document.createElement("span");
    span.className = "hint";
    span.textContent = "full cost / original price";
    $("#lbl-total").appendChild(span);
  }
  updateLiveBox();
}

function updateLiveBox() {
  const qty = Number($("#f-qty").value) || 0;
  const total = Number($("#f-total").value) || 0;
  const unitPrice = qty > 0 ? total / qty : 0;
  const isCredit = $("#f-method").value === "Credit";
  const paid = Number($("#f-credit-paid").value) || 0;
  const balance = isCredit ? Math.max(total - paid, 0) : 0;
  const pct = isCredit && total > 0 ? Math.min(paid / total * 100, 100) : 0;

  const chunks = [
    isCredit ? `<div class="lv"><label>Unit price</label><b>${cur(unitPrice)}</b></div>`
             : `<div class="lv"><label>Unit price</label><b>${cur(unitPrice)}</b></div>`,
    `<div class="lv"><label>Total</label><b>${cur(total)}</b></div>`,
    isCredit ? `<div class="lv"><label>Balance left</label><b class="${balance > 0 ? "red" : "green"}">${cur(balance)}</b></div>`
             : `<div class="lv"><label>Payment</label><b class="green">${cur(total)}</b></div>`,
    isCredit ? `<div class="lv"><label>Credit cleared</label><b class="green">${pct.toFixed(1)}%</b></div>` : "",
  ].filter(Boolean);
  $("#live-box").innerHTML = chunks.join("");
}

async function submitEntry(e) {
  e.preventDefault();
  const isCredit = $("#f-method").value === "Credit";
  const payload = {
    date: $("#f-date").value,
    branch_id: Number($("#f-branch").value),
    distributor: $("#f-dist").value,
    product: $("#f-product").value,
    unit: $("#f-unit").value || "bag",
    quantity: parseFloat($("#f-qty").value),
    total_amount: parseFloat($("#f-total").value),
    payment_method: $("#f-method").value,
    memo: $("#f-memo").value,
  };
  if (isCredit) payload.credit_paid = parseFloat($("#f-credit-paid").value) || 0;
  try {
    const r = await api("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    refreshMeta();
    if (state.scanQueue.length) {
      // A scanned slip can hold several lines. Each one is confirmed and saved
      // exactly like the first — the dialog stays open until they are all done.
      const next = state.scanQueue.shift();
      const left = state.scanQueue.length;
      applyDraftItem(next);
      $("#f-credit-paid").value = "";
      updateCreditMode();
      updateLiveBox();
      $("#form-err").textContent = "";
      toast(`✓ Saved ${payload.product} · next: ${next.product || "line"}${left ? ` (+${left} more)` : " (last line)"}`);
      setTimeout(() => $("#f-product").focus(), 50);
      return;
    }
    $("#entry-dialog").close();
    toast(`✓ Saved — ${payload.product} · ${cur(payload.total_amount)}${r.credit ? ` · credit balance ${cur(r.credit.balance)}` : ""}`);
    switchView("dashboard");
  } catch (err) {
    $("#form-err").textContent = err.message;
  }
}

async function submitPay(e) {
  e.preventDefault();
  try {
    const r = await api(`/api/purchases/${activePayId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: $("#pay-date").value, amount: parseFloat($("#pay-amount").value) }),
    });
    $("#pay-dialog").close();
    toast(`✓ Payment recorded · balance ${cur(r.credit.balance)}`);
    loadCredits();
  } catch (err) {
    $("#pay-err").textContent = err.message;
  }
}

/* ---------- AI: connection, coverage, status (per device) ----------
   The app and every one of its parts are the model's body. This is the nerve
   that says which parts it may reach, and whether a model is attached at all.

   The key lives only in this device's localStorage. It is sent to nothing but
   the provider the owner picked here — never to our server, never to a third
   party. Without one, both engines fall back to the same built-in rules. */
const AI_KEY_STORAGE = "pwbudget.ai.v1";

const AI_PROVIDERS = [
  { id: "groq", name: "Groq", label: "Groq · free, no card",
    base: "https://api.groq.com/openai/v1",
    get: "https://console.groq.com/keys",
    models: ["groq/compound", "openai/gpt-oss-120b", "qwen/qwen3.6-27b"] },
  { id: "gemini", name: "Gemini", label: "Google Gemini · free tier",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    get: "https://aistudio.google.com/apikey",
    models: ["gemini-2.5-flash", "gemini-2.0-flash"] },
  { id: "openrouter", name: "OpenRouter", label: "OpenRouter · free models",
    base: "https://openrouter.ai/api/v1",
    get: "https://openrouter.ai/keys",
    models: ["google/gemma-4-31b-it:free", "openai/gpt-oss-20b:free"] },
  { id: "custom", name: "Custom", label: "Custom · OpenAI-compatible",
    base: "", get: "", models: [] },
];

/* The coverage. Every area is live, not aspirational: `capture` decides
   whether the scan bar exists, `catalogue` and `money` decide what context
   travels with a scan, `app` decides whether it may propose changes to the
   app itself. Turn one off and it stops being part of the model's body. */
const AI_AREAS = [
  { id: "capture", short: "capture", ico: "📷", label: "Receipt & slip capture",
    note: "photograph or paste a slip and have the form filled in" },
  { id: "catalogue", short: "catalogue", ico: "🏷️", label: "My items & suppliers",
    note: "share your existing names so it uses yours, not invented ones" },
  { id: "money", short: "credit", ico: "💰", label: "Credit you owe",
    note: "share outstanding credit so suggestions fit what is left" },
  { id: "app", short: "settings", ico: "⚙️", label: "App settings",
    note: "let it propose changes to this app itself" },
];

let AI = { provider: "groq", base: "", model: "", key: "", areas: null };
let AI_LAST_ERROR = "";

const aiAreaDefault = (id) => id === "capture" || id === "catalogue";

function loadAI() {
  try {
    const raw = localStorage.getItem(AI_KEY_STORAGE);
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === "object") {
      AI = {
        provider: String(o.provider || "groq"),
        base: String(o.base || ""),
        model: String(o.model || ""),
        key: String(o.key || ""),
        areas: o.areas && typeof o.areas === "object" ? o.areas : null,
      };
    }
  } catch (e) { /* private mode: stay unconfigured */ }
  pushProvider();
}

function saveAI() {
  try { localStorage.setItem(AI_KEY_STORAGE, JSON.stringify(AI)); } catch (e) { /* quota */ }
  pushProvider();
}

const aiPreset = () => AI_PROVIDERS.find((p) => p.id === AI.provider) || AI_PROVIDERS[0];
const aiBase = () => (AI.provider === "custom" ? AI.base : aiPreset().base).replace(/\/+$/, "");
const aiModel = () => (AI.model || aiPreset().models[0] || "").trim();
const aiConfigured = () => !!(AI.key && aiBase() && aiModel());

/* Install the device's connection into the offline engine. This is the one
   place the key is handed over; it never travels anywhere else. */
function pushProvider() {
  if (typeof PWDB === "undefined" || !PWDB.setProvider) return;
  PWDB.setProvider(aiConfigured() ? { baseUrl: aiBase(), model: aiModel(), key: AI.key } : null);
}

function aiAllows(id) {
  const saved = AI.areas;
  if (saved && Object.prototype.hasOwnProperty.call(saved, id)) return !!saved[id];
  return aiAreaDefault(id);
}

function setAiArea(id, on) {
  const areas = Object.assign({}, AI.areas || {});
  AI_AREAS.forEach((a) => { areas[a.id] = aiAllows(a.id); });
  areas[id] = !!on;
  AI.areas = areas;
}

function aiScopeSummary() {
  const on = AI_AREAS.filter((a) => aiAllows(a.id)).map((a) => a.short);
  return on.length ? on.join(" · ") : "nothing";
}

function aiStatus() {
  const name = aiPreset().name;
  if (!aiConfigured())
    return { tone: "off", text: "AI · not connected",
             detail: "No key yet — slips are read with built-in rules. Add a free key to use a model." };
  if (AI_LAST_ERROR)
    return { tone: "bad", text: `AI · ${name} · problem`, detail: AI_LAST_ERROR };
  return { tone: "on", text: `AI · ${name} · ${aiModel()}`, detail: "Connected on this device." };
}

function renderAiStrip() {
  const dot = $("#ai-dot"), txt = $("#ai-strip-txt"), scope = $("#ai-strip-scope");
  if (!txt) return;
  const s = aiStatus();
  if (dot) dot.className = "ai-dot " + s.tone;
  txt.textContent = s.text;
  if (scope) scope.textContent = "· " + aiScopeSummary();
  const strip = $("#ai-strip");
  if (strip) strip.title = `${s.detail}\nCoverage: ${aiScopeSummary()}`;
}

/* What the owner has allowed to travel with a scan. Built fresh each time so
   turning an area off takes effect immediately; a failure here is never a
   blocker — context is a courtesy, not a requirement. */
async function aiBuildContext() {
  const bits = [];
  if (aiAllows("catalogue") && META) {
    const prods = (META.products || []).map((p) => p.name).filter(Boolean);
    const dists = (META.distributors || []).map((d) => d.name).filter(Boolean);
    if (prods.length) bits.push("My items, spelled this way: " + prods.slice(0, 30).join(", "));
    if (dists.length) bits.push("My suppliers, spelled this way: " + dists.slice(0, 30).join(", "));
  }
  if (aiAllows("money")) {
    try {
      const c = await api("/api/credits");
      const open = (c && c.open) || [];
      const owed = open.reduce((s, x) => s + (Number(x.balance) || 0), 0);
      if (open.length) bits.push(`I have ${open.length} unpaid supplier bill(s) totalling ${cur(owed)}.`);
    } catch (e) { /* ignore */ }
  }
  return bits.join("\n");
}

/* One entry point for extraction, in both modes. A key on this device always
   wins: the engine holding the key is the only one that may call out, and it
   is asked directly so the key never leaves the device. With no key we ask
   the server, which uses its own key if configured, or the same rules the
   offline engine would run. */
async function aiExtractRequest(payload) {
  const context = await aiBuildContext();
  const body = Object.assign({}, payload);
  if (context) body.context = context;
  const opts = { method: "POST", headers: { "Content-Type": "application/json" },
                 body: JSON.stringify(body) };
  if (aiConfigured() && typeof PWDB !== "undefined") {
    let r;
    try {
      r = await offlineRequest("POST", "/api/ai/extract", {}, body);
    } catch (e) {
      throw e;                       // a plain validation error, not an AI fault
    }
    // db.js silently falls back to the built-in rules when the model cannot
    // be reached. That must not be invisible: the strip is where it shows.
    if (r && r.source !== "model") {
      AI_LAST_ERROR = `Could not reach ${aiModel()} — using built-in rules instead.`;
    } else {
      AI_LAST_ERROR = "";
    }
    renderAiStrip();
    return r;
  }
  return await api("/api/ai/extract", opts);
}

/* ---------- settings dialog ---------- */
function openAiDialog() {
  AI_LAST_ERROR = "";
  renderAiSettings();
  $("#ai-dialog").showModal();
}

function renderAiSettings() {
  const sel = $("#ai-provider");
  if (sel) {
    sel.innerHTML = AI_PROVIDERS.map((p) =>
      `<option value="${p.id}"${p.id === AI.provider ? " selected" : ""}>${esc(p.label)}</option>`).join("");
  }
  const dl = $("#ai-model-list");
  if (dl) dl.innerHTML = (aiPreset().models || [])
    .map((m) => `<option value="${esc(m)}"></option>`).join("");
  const key = $("#ai-key");
  if (key) key.value = AI.key;
  const model = $("#ai-model");
  if (model) model.value = aiModel();
  const base = $("#ai-base");
  if (base) base.value = AI.provider === "custom" ? AI.base : aiPreset().base;
  const wrap = $("#ai-custom-wrap");
  if (wrap) wrap.classList.toggle("hidden", AI.provider !== "custom");
  const get = $("#ai-get-key");
  if (get) {
    const url = aiPreset().get;
    get.classList.toggle("hidden", !url);
    if (url) get.setAttribute("href", url);
  }
  renderAiAreas();
  renderAiTest("");
  const err = $("#ai-err");
  if (err) err.textContent = "";
  renderAiStrip();
}

function renderAiAreas() {
  const box = $("#ai-areas");
  if (!box) return;
  box.innerHTML = AI_AREAS.map((a) => `
    <label class="ai-area${aiAllows(a.id) ? " on" : ""}">
      <input type="checkbox" data-area="${a.id}"${aiAllows(a.id) ? " checked" : ""}>
      <span class="ai-area-txt"><b>${a.ico} ${esc(a.label)}</b><small>${esc(a.note)}</small></span>
    </label>`).join("");
  const instr = $("#ai-instr");
  if (instr) instr.classList.toggle("hidden", !aiAllows("app"));
}

function renderAiTest(msg) {
  const box = $("#ai-test");
  if (box) box.textContent = msg || "";
}

function readAiForm() {
  return {
    provider: (($("#ai-provider") || {}).value || "groq"),
    key: (($("#ai-key") || {}).value || "").trim(),
    model: (($("#ai-model") || {}).value || "").trim(),
    base: (($("#ai-base") || {}).value || "").trim(),
  };
}

/* Prove the key, endpoint and model all work by making the engine do the one
   thing it exists for and checking it came back from a model rather than from
   the built-in rules. */
async function testAiConnection() {
  const err = $("#ai-err");
  err.textContent = "";
  const form = readAiForm();
  const saved = Object.assign({}, AI);
  Object.assign(AI, form);
  pushProvider();
  if (!aiConfigured()) {
    Object.assign(AI, saved);
    pushProvider();
    renderAiStrip();
    renderAiTest("");
    err.textContent = "A provider, a key and a model are all needed first.";
    return false;
  }
  renderAiTest("Testing…");
  let ok = false, why = "";
  try {
    const r = await offlineRequest("POST", "/api/ai/extract", {},
      { text: "Ceda supplied 2 bags of powder for 21600 on 22/09/2026" });
    ok = r && r.source === "model";
    if (!ok) why = "the model did not answer — check the key and the model id";
  } catch (e) {
    why = e.message;
  }
  Object.assign(AI, saved);
  pushProvider();
  if (ok) {
    AI_LAST_ERROR = "";
    renderAiTest(`✓ ${aiModel()} answered — ${aiPreset().name} is working.`);
  } else {
    AI_LAST_ERROR = why || "could not reach the model";
    renderAiTest("");
    err.textContent = AI_LAST_ERROR;
  }
  renderAiStrip();
  return ok;
}

/* ---------- settings dialog: the model proposing a change to the app ---------- */
async function proposeChange() {
  const instr = (($("#instr-text") || {}).value || "").trim();
  const out = $("#instr-out"), err = $("#ai-err");
  err.textContent = "";
  if (!instr) { out.innerHTML = ""; err.textContent = "Type what should change first."; return; }
  const draft = {
    date: (($("#f-date") || {}).value || ""),
    distributor: (($("#f-dist") || {}).value || ""),
    items: [{
      product: (($("#f-product") || {}).value || ""),
      unit: (($("#f-unit") || {}).value || ""),
      quantity: Number(($("#f-qty") || {}).value) || 0,
      total_amount: Number(($("#f-total") || {}).value) || 0,
    }],
    payment_method: (($("#f-method") || {}).value || ""),
    memo: (($("#f-memo") || {}).value || ""),
  };
  out.innerHTML = "";
  try {
    const r = await aiRequest("/api/ai/instruct", { draft, instruction: instr });
    const ch = (r && r.patch && r.patch.changes) || {};
    const keys = Object.keys(ch);
    if (!keys.length) {
      out.innerHTML = `<span class="instr-none">Nothing to change — it did not recognise a field.</span>`;
      return;
    }
    const rows = keys.map((k) => `<div class="instr-row"><span>${esc(k)}</span><b>${esc(String(ch[k]))}</b></div>`).join("");
    out.innerHTML = `<div class="instr-ask">It proposes:</div>${rows}` +
      `<button type="button" class="btn secondary small" id="btn-instr-apply">Apply to the form</button>`;
    const apply = $("#btn-instr-apply");
    if (apply) apply.onclick = () => {
      const map = { date: "#f-date", distributor: "#f-dist", payment_method: "#f-method",
                    memo: "#f-memo", product: "#f-product", unit: "#f-unit",
                    quantity: "#f-qty", total_amount: "#f-total" };
      keys.forEach((k) => { const el = $(map[k]); if (el) el.value = String(ch[k]); });
      updateCreditMode();
      updateLiveBox();
      out.innerHTML = `<span class="instr-none">✓ applied — review it, then save as usual.</span>`;
    };
  } catch (e) {
    err.textContent = e.message;
  }
}

/* Instruct goes through whichever engine can answer: with a key on this
   device that is the offline engine (the key stays here), otherwise the
   server's own configuration. */
async function aiRequest(path, payload) {
  const opts = { method: "POST", headers: { "Content-Type": "application/json" },
                 body: JSON.stringify(payload) };
  if (aiConfigured() && typeof PWDB !== "undefined")
    return await offlineRequest("POST", path, {}, payload);
  return await api(path, opts);
}

/* ---------- capture → extract → confirm (AI) ----------
   The extractor proposes; a human confirms; submitEntry() records through the
   ordinary /api/purchases path. Nothing here writes a purchase on its own.  */
const SCAN_MAX_EDGE = 1500;   // downscale first — a phone photo is ~5MB
const SCAN_QUALITY = 0.7;     // ~200-400KB is enough for a printed receipt
const SCAN_FIELD_LABELS = {
  date: "Date", distributor: "Distributor", payment_method: "Paid via",
  memo: "Memo", product: "Item", unit: "Unit",
  quantity: "Quantity", total_amount: "Total", items: "Line items",
};
const SCAN_FIELD_INPUTS = {
  date: "#f-date", distributor: "#f-dist", payment_method: "#f-method",
  memo: "#f-memo", product: "#f-product", unit: "#f-unit",
  quantity: "#f-qty", total_amount: "#f-total",
};

/* Photo capture needs the server (the offline engine has no vision). Paste
   works everywhere: the same /api/ai/extract route is served by db.js. */
function scanOffline() { return OFFLINE_ENGINE || !serverAvailable; }

function setScanBusy(busy) {
  ["#btn-scan", "#btn-paste", "#btn-read-text"].forEach((s) => {
    const el = $(s);
    if (el) el.disabled = !!busy;
  });
  const note = $("#scan-note");
  if (note) note.textContent = busy ? "Reading…" : "";
}

function flashField(sel) {
  const el = $(sel);
  if (!el || !el.classList) return;
  el.classList.remove("f-flash");
  void el.offsetWidth;                 // restart the animation on repeat taps
  el.classList.add("f-flash");
  setTimeout(() => el.classList.remove("f-flash"), 950);
}

/* "items[0].unit" -> "Unit", "distributor" -> "Distributor" */
function scanFieldLabel(field) {
  const m = /^items\[(\d+)\]\.(.+)$/.exec(String(field || ""));
  const key = m ? m[2] : String(field || "");
  const label = SCAN_FIELD_LABELS[key] || key || "Check";
  return m && Number(m[1]) > 0 ? `${label} (line ${Number(m[1]) + 1})` : label;
}

/* Only the line sitting in the form is answerable here; later lines are
   answered when they come up for their own save. */
function renderReview(uncertain) {
  const card = $("#review-card");
  if (!card) return;
  state.review = Array.isArray(uncertain) ? uncertain.filter((u) => u && u.field) : [];
  if (!state.review.length) { card.innerHTML = ""; card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  card.innerHTML = `<div class="u-head">⚠ Check these before saving</div>` +
    state.review.map((u) => {
      const m = /^items\[(\d+)\]\.(.+)$/.exec(String(u.field));
      const line = m ? Number(m[1]) : -1;
      const chips = line > 0 ? "" : (Array.isArray(u.options) ? u.options : [])
        .map((o) => `<button type="button" class="u-chip" data-u-field="${esc(u.field)}" data-u-val="${esc(String(o))}">${esc(String(o))}</button>`)
        .join("");
      return `<div class="u-row">
        <span class="u-lab">${esc(scanFieldLabel(u.field))}</span>
        <span class="u-why">${esc(u.why || "check this")}</span>
        <span class="u-opts">${chips}</span>
      </div>`;
    }).join("");
}

function applyUncertain(field, value) {
  const m = /^items\[(\d+)\]\.(.+)$/.exec(String(field || ""));
  const line = m ? Number(m[1]) : -1;
  if (line > 0) return false;                    // queued line — answered later
  const sel = SCAN_FIELD_INPUTS[m ? m[2] : String(field)];
  const el = sel && $(sel);
  if (!el) return false;
  el.value = String(value);
  flashField(sel);
  state.review = state.review.filter((u) => u.field !== field);
  renderReview(state.review);
  if (m && m[2] === "payment_method") updateCreditMode();
  updateLiveBox();
  return true;
}

/* Fill only what the extractor actually found, so a scan never wipes what
   the shopkeeper already typed. Extra line items wait in state.scanQueue. */
function fillEntryDraft(draft) {
  if (!draft || typeof draft !== "object") return 0;
  if (draft.date) $("#f-date").value = String(draft.date);
  if (draft.distributor) $("#f-dist").value = String(draft.distributor);
  if (draft.payment_method) $("#f-method").value = String(draft.payment_method);
  if (draft.memo) $("#f-memo").value = String(draft.memo);
  const items = Array.isArray(draft.items) ? draft.items : [];
  if (items[0]) applyDraftItem(items[0]);
  state.scanQueue = items.slice(1);
  updateCreditMode();
  updateLiveBox();
  return items.length;
}

function applyDraftItem(item) {
  if (!item) return;
  if (item.product) $("#f-product").value = String(item.product);
  if (item.unit) $("#f-unit").value = String(item.unit);
  if (Number(item.quantity) > 0) $("#f-qty").value = String(item.quantity);
  if (Number(item.total_amount) > 0) $("#f-total").value = String(item.total_amount);
}

async function runScan(payload) {
  const err = $("#scan-err");
  err.textContent = "";
  setScanBusy(true);
  try {
    const r = await aiExtractRequest(payload);
    const found = fillEntryDraft(r.draft);
    renderReview(r.uncertain || []);
    if (!found) err.textContent = "Nothing readable in that — type the entry instead.";
    else if (state.scanQueue.length) toast(`✓ ${found} line items found — save them one at a time`);
    else toast("✓ Filled in — check it, then save");
    return true;
  } catch (e) {
    err.textContent = e.message;
    return false;
  } finally {
    setScanBusy(false);
  }
}

/* Downscale + JPEG on-device so the upload is small and the camera roll
   photo never leaves as a full-size original. Returns bare base64. */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a readable photo."));
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, SCAN_MAX_EDGE / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", SCAN_QUALITY).replace(/^data:image\/jpeg;base64,/, ""));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function resetScan() {
  state.scanQueue = [];
  renderReview([]);
  const e = $("#scan-err");
  if (e) e.textContent = "";
  const box = $("#paste-box");
  if (box) box.classList.add("hidden");
  const txt = $("#paste-text");
  if (txt) txt.value = "";
}

/* ---------- bindings ---------- */
function bindAll() {
  $$(".nav-btn").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.view) switchView(b.dataset.view);   // switchView() also closes the More sheet
    else if (b.id === "btn-calc-nav" || b.id === "btn-calc-more") {
      closeMore();
      toggleCalc();
    }
  }));
  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.goto)));
  // KPIs are rebuilt on every dashboard load, so their links need a
  // container-level listener rather than a one-off binding.
  const kpiBox = $("#kpis");
  if (kpiBox) kpiBox.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b) switchView(b.dataset.goto);
  });

  /* --- phone navigation: "More" tab + bottom sheet --- */
  const moreBtn = $("#nav-more");
  if (moreBtn) moreBtn.addEventListener("click", () => toggleMore());
  const moreClose = $("#more-close");
  if (moreClose) moreClose.addEventListener("click", closeMore);
  const moreScrim = $("#more-scrim");
  if (moreScrim) moreScrim.addEventListener("click", closeMore);
  const installMore = $("#btn-install-more");
  if (installMore) installMore.addEventListener("click", () => { closeMore(); promptInstall(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMore(); });

  $("#branch-select").addEventListener("change", (e) => {
    state.branch_id = e.target.value ? Number(e.target.value) : null;
    state.page = 1;
    switchView(state.view);
  });
  $("#btn-new").addEventListener("click", openEntryDialog);
  const pc = $("#profile-chip");
  if (pc) pc.addEventListener("click", openProfileDialog);
  const pf = $("#profile-form");
  if (pf) pf.addEventListener("submit", submitProfile);
  const tb = $("#btn-theme");
  if (tb) tb.addEventListener("click", toggleTheme);
  [["theme-dark", "dark"], ["theme-light", "light"]].forEach(([id, t]) => {
    const b = $("#" + id);
    if (b) b.addEventListener("click", () => applyTheme(t, true));
  });
  ["#btn-install", "#btn-install-2"].forEach((sel) => {
    const b = $(sel);
    if (b) b.addEventListener("click", promptInstall);
  });
  $("#f-method").addEventListener("change", updateCreditMode);
  ["#f-qty", "#f-total", "#f-credit-paid"].forEach((s) => $(s).addEventListener("input", updateLiveBox));
  $("#entry-form").addEventListener("submit", submitEntry);
  $("#pay-form").addEventListener("submit", submitPay);
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  /* --- capture → extract → confirm --- */
  const scanBtn = $("#btn-scan");
  if (scanBtn) scanBtn.addEventListener("click", () => {
    const e = $("#scan-err");
    e.textContent = "";
    if (scanOffline()) {
      e.textContent = "Scanning a photo needs internet — use “Paste text” instead, it works offline.";
      const box = $("#paste-box");
      if (box) box.classList.remove("hidden");
      return;
    }
    const f = $("#scan-file");
    if (f) f.click();
  });
  const scanFile = $("#scan-file");
  if (scanFile) scanFile.addEventListener("change", async (ev) => {
    const file = ev.target && ev.target.files && ev.target.files[0];
    ev.target.value = "";                    // allow picking the same photo twice
    if (!file) return;
    setScanBusy(true);
    try {
      const image = await compressImage(file);
      setScanBusy(false);
      await runScan({ image });
    } catch (err) {
      setScanBusy(false);
      $("#scan-err").textContent = err.message;
    }
  });
  const pasteBtn = $("#btn-paste");
  if (pasteBtn) pasteBtn.addEventListener("click", () => {
    const box = $("#paste-box");
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) {
      $("#scan-err").textContent = "";
      const t = $("#paste-text");
      if (t) t.focus();
    }
  });
  const pasteClose = $("#btn-paste-close");
  if (pasteClose) pasteClose.addEventListener("click", () => $("#paste-box").classList.add("hidden"));
  const readBtn = $("#btn-read-text");
  if (readBtn) readBtn.addEventListener("click", async () => {
    const t = (($("#paste-text") || {}).value || "").trim();
    if (!t) { $("#scan-err").textContent = "Paste the receipt or statement text first."; return; }
    await runScan({ text: t });
  });
  const reviewCard = $("#review-card");
  if (reviewCard) reviewCard.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-u-field]");
    if (!chip) return;
    e.preventDefault();
    applyUncertain(chip.getAttribute("data-u-field"), chip.getAttribute("data-u-val"));
  });

  /* --- AI connection, coverage, status --- */
  const aiStrip = $("#ai-strip");
  if (aiStrip) aiStrip.addEventListener("click", openAiDialog);
  const aiMore = $("#btn-ai-more");
  if (aiMore) aiMore.addEventListener("click", () => {
    closeMore();
    openAiDialog();
  });
  const aiForm = $("#ai-form");
  if (aiForm) aiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    Object.assign(AI, readAiForm());
    saveAI();
    AI_LAST_ERROR = "";
    renderAiSettings();
    $("#ai-dialog").close();
    toast("✓ AI settings saved on this device");
  });
  const aiProvider = $("#ai-provider");
  if (aiProvider) aiProvider.addEventListener("change", () => {
    AI.provider = aiProvider.value;
    if (AI.provider !== "custom") AI.base = "";
    renderAiSettings();
  });
  const aiAreas = $("#ai-areas");
  if (aiAreas) aiAreas.addEventListener("change", (e) => {
    const box = e.target.closest("[data-area]");
    if (!box) return;
    setAiArea(box.getAttribute("data-area"), box.checked);
    saveAI();
    renderAiAreas();
    renderAiStrip();
  });
  const aiForget = $("#btn-ai-forget");
  if (aiForget) aiForget.addEventListener("click", () => {
    AI.key = "";
    saveAI();
    AI_LAST_ERROR = "";
    renderAiSettings();
    toast("Key forgotten — this device has no model attached", "ok");
  });
  const aiTest = $("#btn-ai-test");
  if (aiTest) aiTest.addEventListener("click", testAiConnection);
  const aiInstr = $("#btn-instr");
  if (aiInstr) aiInstr.addEventListener("click", proposeChange);
  const aiDialog = $("#ai-dialog");
  if (aiDialog) aiDialog.addEventListener("close", () => {
    // A test installs the key temporarily; closing puts the saved one back.
    pushProvider();
    renderAiStrip();
  });

  // purchases filters
  let debounce;
  $("#filter-q").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.filters.q = e.target.value.trim(); state.page = 1; loadPurchases(); }, 300);
  });
  $("#filter-month").addEventListener("change", (e) => { state.filters.month = e.target.value; state.page = 1; loadPurchases(); });
  $("#filter-dist").addEventListener("change", (e) => { state.filters.dist = e.target.value; state.page = 1; loadPurchases(); });
  $("#filter-product").addEventListener("change", (e) => { state.filters.product = e.target.value; state.page = 1; loadPurchases(); });
  $("#filter-pay").addEventListener("change", (e) => { state.filters.pay = e.target.value; state.page = 1; loadPurchases(); });
  $("#filter-owed").addEventListener("change", (e) => { state.filters.owed = e.target.checked; state.page = 1; loadPurchases(); });
  $("#btn-reset").addEventListener("click", () => {
    state.filters = { q: "", month: "", dist: "", product: "", pay: "", owed: false };
    state.page = 1;
    ["filter-q", "filter-month", "filter-dist", "filter-product", "filter-pay"].forEach((id) => ($("#" + id).value = ""));
    $("#filter-owed").checked = false;
    loadPurchases();
  });
  $("#page-prev").addEventListener("click", () => { state.page--; loadPurchases(); });
  $("#page-next").addEventListener("click", () => { state.page++; loadPurchases(); });

  $("#purchase-body").addEventListener("click", async (e) => {
    const payBtn = e.target.closest("[data-pay]");
    if (payBtn) {
      const id = Number(payBtn.dataset.pay);
      openPayDialog(id);
      return;
    }
    const mv = e.target.closest("[data-move]");
    if (mv) { await movePurchase(mv.dataset.move); return; }
    const del = e.target.closest("[data-del]");
    if (!del) return;
    if (!confirm("Delete this purchase? This also removes any credit payments linked to it.")) return;
    try {
      await api(`/api/purchases/${del.dataset.del}`, { method: "DELETE" });
      toast("Purchase deleted");
      refreshMeta();
      loadPurchases();
    } catch (err) { toast(err.message, "err"); }
  });

  /* --- money in: the list --- */
  let incDebounce;
  $("#income-q").addEventListener("input", (e) => {
    clearTimeout(incDebounce);
    const v = e.target.value.trim();
    incDebounce = setTimeout(() => { state.income.q = v; state.income.page = 1; loadIncome(); }, 300);
  });
  $("#income-month").addEventListener("change", (e) => {
    state.income.month = e.target.value; state.income.page = 1; loadIncome();
  });
  $("#income-reset").addEventListener("click", () => {
    state.income = { q: "", month: "", page: 1 };
    $("#income-q").value = "";
    $("#income-month").value = "";
    loadIncome();
  });
  $("#income-prev").addEventListener("click", () => { state.income.page--; loadIncome(); });
  $("#income-next").addEventListener("click", () => { state.income.page++; loadIncome(); });
  $("#btn-income-add").addEventListener("click", openIncomeDialog);
  $("#income-form").addEventListener("submit", submitIncome);
  $("#income-body").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-inc-del]");
    if (!del) return;
    if (!confirm("Delete this money-in record?")) return;
    try {
      await api(`/api/income/${del.dataset.incDel}`, { method: "DELETE" });
      toast("Money in deleted");
      refreshMeta();
      loadIncome();
    } catch (err) { toast(err.message, "err"); }
  });

  /* --- money in: statement ingest (read → tick → record) --- */
  $("#btn-stmt-csv").addEventListener("click", () => $("#stmt-csv").click());
  $("#btn-stmt-img").addEventListener("click", () => $("#stmt-img").click());
  $("#stmt-csv").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) readFileText(f, (txt) => { $("#stmt-text").value = txt; });
  });
  $("#stmt-img").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) readShot(f);
  });
  $("#btn-stmt-read").addEventListener("click", readStatement);
  $("#btn-stmt-record").addEventListener("click", recordStatement);
  $("#btn-stmt-clear").addEventListener("click", clearStatement);

  // budget
  $("#b-year").addEventListener("change", (e) => { state.budget.year = Number(e.target.value); state.budget.month = Number($("#b-month").value); loadBudget(); });
  $("#b-month").addEventListener("change", (e) => { state.budget.month = Number(e.target.value); state.budget.year = Number($("#b-year").value); loadBudget(); });
  $("#b-total").addEventListener("input", (e) => { state.budget.baseTotal = Number(e.target.value) || 0; renderBudgetBody(snapshotBudget()); });
  $("#b-save").addEventListener("input", (e) => { state.budget.baseSave = Number(e.target.value) || 0; renderBudgetBody(snapshotBudget()); });
  $("#b-auto").addEventListener("click", () => recommendedRows());
  $("#b-save-btn").addEventListener("click", saveBudget);

  // branches
  $("#btn-add-branch").addEventListener("click", addBranch);
}

function snapshotBudget() {
  const total = state.budget.baseTotal || 0, save = state.budget.baseSave || 0;
  return {
    total_amount: total, save_amount: save, saved: true,
    allocations: state.budget.rows,
    actual_spend: state.budget.actual_spend || 0, month: state.budget.month,
  };
}

async function recommendedRows() {
  const bid = state.branch_id ? `&branch_id=${state.branch_id}` : "";
  const b = await api(`/api/budget?year=${state.budget.year || new Date().getFullYear()}&month=${state.budget.month || new Date().getMonth() + 1}${bid}`);
  // carry over what was already spent per item this month where names match
  const spent = Object.fromEntries(state.budget.rows.map((r) => [r.name, r.actual || 0]));
  state.budget.rows = b.recommended.map((r) => ({ ...r, actual: spent[r.name] || 0 }));
  // after recompute, use baseTotal values to render amounts
  state.budget.baseTotal = state.budget.baseTotal || b.total_amount;
  state.budget.baseSave = state.budget.baseSave || b.save_amount;
  state.budget.actual_spend = b.actual_spend;
  renderBudgetBody(snapshotBudget());
  toast("Allocated by your purchase history ⚡");
}

async function saveBudget() {
  const bid = state.branch_id || "";
  const payload = {
    year: state.budget.year || new Date().getFullYear(),
    month: state.budget.month || new Date().getMonth() + 1,
    branch_id: bid,
    total_amount: state.budget.baseTotal || 0,
    save_amount: state.budget.baseSave || 0,
    allocations: state.budget.rows,
  };
  try {
    const r = await api("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, branch_id: state.branch_id || "all" }),
    });
    toast(`✓ Budget saved · spendable ${cur(r.spendable)} (saving ${cur(r.save_amount)})`);
  } catch (err) { toast(err.message, "err"); }
}

async function addBranch() {
  const name = $("#new-branch-name").value.trim();
  if (!name) return toast("Enter a branch name", "err");
  try {
    await api("/api/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    $("#new-branch-name").value = "";
    toast(`✓ Branch "${name}" added`);
    await refreshMeta();
    loadBranches();
  } catch (err) { toast(err.message, "err"); }
}

async function refreshMeta() {
  META = await api("/api/meta");
  populateDatalists();
  populateFilters();
  populateBranches();
}

/* ---------- init ---------- */
async function init() {
  try {
    META = await api("/api/meta");
  } catch (err) {
    document.body.innerHTML = `<p style="padding:40px;font-family:sans-serif">Cannot reach API: ${esc(err.message)}</p>`;
    return;
  }
  if (OFFLINE_ENGINE) showOfflineBadge();
  loadProfile();
  loadAI();
  applyTheme(currentTheme(), false);
  renderProfile();
  renderWelcome();
  populateDatalists();
  populateFilters();
  populateBranches();
  bindAll();
  renderAiStrip();
  initInstall();

  // prefetch credit cache for the pay dialog
  const refreshCache = async () => {
    const c = await api(`/api/credits${branchScope()}`);
    window._creditCache = [...c.open, ...c.settled];
  };
  window._creditCache = [];
  refreshCache();
  switchView("dashboard");
  try {
    const act = new URLSearchParams(location.search).get("action");
    if (act === "new") setTimeout(() => openEntryDialog(), 600);
    // deep link: /app/#purchases, /app/#credits, ... (also handy for previews)
    const VIEWS = ["dashboard", "purchases", "income", "credits", "analytics", "budget", "branches"];
    const h = (location.hash || "").replace("#", "");
    if (VIEWS.includes(h)) switchView(h);
  } catch (e) { /* ignore */ }

  // PWA: register service worker so the installed app works with no internet.
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js")
        .then((reg) => initUpdateCheck(reg))
        .catch(() => { /* offline dev */ });
    }
  } catch (e) { /* ignore */ }
}

/* ---------- update notification ----------
   Offline-first: the installed app always opens from cache. When the device
   comes back online and a newer build exists (CACHE bumped in sw.js), we pull
   it and apply it automatically; if still offline, a "tap to update" banner
   waits until there's a connection. */
function initUpdateCheck(reg) {
  let autoReloadArmed = false;
  sessionStorage.removeItem("pw.sw.reload");   // allow one guarded reload per session

  const banner = (msg, tapToApply) => {
    const b = $("#update-banner");
    if (!b) return;
    b.textContent = msg;
    b.hidden = false;
    b.onclick = tapToApply ? () => location.reload() : null;
  };

  const applyUpdate = () => {
    if (!navigator.onLine) { banner("Update ready — tap to install", true); return; }
    banner("Updating to the latest version…", false);
    autoReloadArmed = true;
    // the new worker skipWaiting()s on install, so nudge it to take control
    if (reg.waiting) reg.waiting.postMessage("skip-waiting");
    setTimeout(() => location.reload(), 900);
  };

  reg.addEventListener("updatefound", () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener("statechange", () => {
      // "installed" with an existing controller = update, not first install
      if (nw.state === "installed" && navigator.serviceWorker.controller) applyUpdate();
    });
  });

  // If a new worker took control while we weren't watching (background tab),
  // reload once so the fresh assets actually run.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (autoReloadArmed) return;
    if (navigator.onLine && sessionStorage.getItem("pw.sw.reload") !== "1") {
      sessionStorage.setItem("pw.sw.reload", "1");
      setTimeout(() => location.reload(), 400);
    }
  });

  const recheck = () => { try { reg.update(); } catch (e) { /* offline */ } };
  window.addEventListener("online", recheck);            // grab updates on reconnect
  setInterval(recheck, 3 * 60 * 60 * 1000);               // hourly while open
  document.addEventListener("visibilitychange", () => { if (!document.hidden) recheck(); });
}

init();

// keep credit cache fresh when opening pay dialog
document.addEventListener("click", async (e) => {
  const payBtn = e.target.closest("[data-pay]");
  if (payBtn && !window._creditCache.length) {
    const c = await api(`/api/credits${branchScope()}`);
    window._creditCache = [...c.open, ...c.settled];
  }
});

/* ============ Calculator widget (chat-widget style) ============ */
const CALC_KEYS = ["AC", "(", ")", "⌫", "÷",
                   "7", "8", "9", "√", "×",
                   "4", "5", "6", "±", "−",
                   "1", "2", "3", "x²", "+",
                   "0", ".", "%", "="];
let calcExpr = "";
let calcRes = null;
let calcFresh = false;
let calcOpen = false;

const fmtCalc = (n) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Error";
  let s = parseFloat(n.toPrecision(12));
  return s.toLocaleString("en-US", { maximumFractionDigits: 10 });
};
const plainCalc = (n) => String(parseFloat(n.toPrecision(12)));

function calcEval(src) {
  const toks = [];
  const S = String(src).replace(/\s+/g, "");
  let i = 0;
  while (i < S.length) {
    const c = S[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < S.length && /[0-9.]/.test(S[j])) j++;
      const raw = S.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) return NaN;   // "5..3" -> reject, don't truncate to 5
      toks.push({ t: "num", v: parseFloat(raw) });
      i = j;
    } else if (c === "+" || c === "-" || c === "\u2212") {
      // normalise: the keypad's minus key is U+2212 MINUS SIGN, ± and hand
      // typing produce ASCII hyphen. The parser below only matches "-".
      toks.push({ t: "op", v: c === "+" ? "+" : "-" }); i++;
    } else if (c === "\u00d7" || c === "\u00f7") { toks.push({ t: "op", v: c }); i++; }
    else if (c === "^") { toks.push({ t: "op", v: "^" }); i++; }
    else if (c === "%") { toks.push({ t: "pct" }); i++; }
    else if (c === "√") { toks.push({ t: "fn", v: "√" }); i++; }
    else if (c === "(") { toks.push({ t: "lp" }); i++; }
    else if (c === ")") { toks.push({ t: "rp" }); i++; }
    else return NaN;
  }
  // postfix % -> /100 on the preceding number
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].t === "pct" && k > 0 && toks[k - 1].t === "num") toks[k - 1].v /= 100;
  }
  const tlist = toks.filter((x) => x.t !== "pct");
  if (!tlist.length) return NaN;

  let p = 0;
  const peek = () => tlist[p];
  const take = () => tlist[p++];
  const expr = () => {
    let v = term();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-" || peek().v === "−")) {
      const o = take().v;
      const r = term();
      v = o === "+" ? v + r : v - r;
    }
    return v;
  };
  const term = () => {
    let v = power();
    while (peek() && peek().t === "op" && (peek().v === "×" || peek().v === "÷")) {
      const o = take().v;
      const r = power();
      v = o === "×" ? v * r : v / r;
    }
    return v;
  };
  const power = () => {
    const v = unary();
    // right-associative and recursive, so 2^3^2 = 2^(3^2) and a chained
    // "x²" (which appends ^2) isn't silently swallowed by term()/expr().
    if (peek() && peek().t === "op" && peek().v === "^") { take(); return Math.pow(v, power()); }
    return v;
  };
  const unary = () => {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "−")) { take(); return -unary(); }
    if (peek() && peek().t === "fn") { take(); return Math.sqrt(unary()); }
    return atom();
  };
  const atom = () => {
    const t = peek();
    if (!t) return NaN;
    if (t.t === "num") { take(); return t.v; }
    if (t.t === "lp") { take(); const v = expr(); if (peek() && peek().t === "rp") take(); return v; }
    return NaN;
  };
  return expr();
}

function calcPush(ch) {
  if (ch === "AC") { calcExpr = ""; calcRes = null; calcFresh = false; renderCalc(); return; }
  if (ch === "⌫") { calcExpr = calcExpr.slice(0, -1); calcFresh = false; renderCalc(); return; }
  if (ch === "±") {
    if (calcFresh) { renderCalc(); return; }
    const m = calcExpr.match(/(-?\d+(?:\.\d+)?)$/);
    if (m) calcExpr = calcExpr.slice(0, m.index) + (m[1].startsWith("-") ? m[1].slice(1) : "-" + m[1]);
    else if (!calcExpr) calcExpr = "-";
    renderCalc(); return;
  }
  if ("÷×−+".includes(ch)) {
    if (calcFresh) {
      calcExpr = (typeof calcRes === "number" ? plainCalc(calcRes) : "0") + ch;
      calcFresh = false;
    } else if (calcExpr) {
      calcExpr = calcExpr.replace(/[÷×−+]$/, "") + ch;
    }
    renderCalc();
    return;
  }
  if (ch === "=") {
    if (!calcExpr || calcFresh) { renderCalc(); return; }
    const v = calcEval(calcExpr);
    if (!Number.isFinite(v)) { calcExpr = ""; calcRes = "Error"; }
    else { calcRes = v; calcExpr = calcExpr; }
    calcFresh = true;
    renderCalc();
    return;
  }
  // digits, dot, parens, functions
  if (calcFresh) { calcExpr = ""; calcFresh = false; }
  if (ch === ".") {
    if (/[\d)]$/.test(calcExpr) && !/\d\.\d*$/.test(calcExpr)) calcExpr += ".";
    renderCalc(); return;
  }
  if (ch === "%") { calcExpr += "%"; renderCalc(); return; }
  if (ch === "√") { calcExpr += "√("; renderCalc(); return; }
  if (ch === "x²") { calcExpr += "^2"; renderCalc(); return; }
  calcExpr += ch;
  renderCalc();
}

function renderCalc() {
  $("#calc-expr").textContent = calcExpr || "\u00a0";
  let disp = calcExpr || "0";
  if (calcFresh && calcRes != null) disp = typeof calcRes === "number" ? fmtCalc(calcRes) : calcRes;
  $("#calc-display").textContent = disp;
}

function buildCalcKeys() {
  const fnKeys = new Set(["AC", "(", ")", "⌫", "√", "±", "x²", "%"]);
  const el = $("#calc-keys");
  el.innerHTML = CALC_KEYS.map((k) =>
    `<button class="ck${k === "=" ? " eq" : ""}${fnKeys.has(k) ? " fn" : ""}${/[÷×−+]/.test(k) ? " op" : ""}" data-key="${k}">${k}</button>`
  ).join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-key]");
    if (b) calcPush(b.dataset.key);
  });
}

function toggleCalc(open) {
  calcOpen = open === undefined ? !calcOpen : !!open;
  $("#calc-shell").classList.toggle("open", calcOpen);
  $("#calc-fab").classList.toggle("active", calcOpen);
  /* On phones the calculator becomes a bottom sheet that covers the two
     floating buttons — hide them while it is open (see styles.css). */
  document.body.classList.toggle("calc-open", calcOpen);
  $("#calc-close").focus();
}

function initCalc() {
  buildCalcKeys();
  renderCalc();
  $("#calc-fab").addEventListener("click", () => toggleCalc());
  $("#calc-close").addEventListener("click", () => toggleCalc(false));
  $("#calc-clear").addEventListener("click", () => calcPush("AC"));
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && t.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (!calcOpen) {
      if (e.key === "c" || e.key === "C") { toggleCalc(true); e.preventDefault(); }
      return;
    }
    const kmap = { Enter: "=", "=": "=", Backspace: "⌫", Escape: "AC", "*": "×", "/": "÷", "_": "−" };
    if (/^[0-9]$/.test(e.key) || e.key === "." || e.key === "(" || e.key === ")" || e.key === "%") {
      e.preventDefault(); calcPush(e.key);
    } else if (/^[+\-]$/.test(e.key)) {
      e.preventDefault(); calcPush(e.key === "-" ? "−" : "+");
    } else if (kmap[e.key]) {
      e.preventDefault(); calcPush(kmap[e.key]);
    } else if (e.key === "^") { e.preventDefault(); calcPush("x²"); }
  });
}

initCalc();