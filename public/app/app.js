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

/* Are records going to this device rather than to a server? One question,
   answered in one place: the capture gate and the "Your data" tools both need
   it, and the two must never disagree. */
const usingOfflineEngine = () => OFFLINE_ENGINE || !serverAvailable;

async function offlineRequest(method, pathname, qs, body) {
  if (typeof PWDB === "undefined") throw new Error("offline engine not available in this browser");
  let r;
  // awaited, not assumed-sync: /api/ai/extract may take a model round-trip.
  // The finally matters as much as the await: db.js reports a write that did
  // not stick (device full), and that must surface as banner + error, never as
  // a quiet success.
  try { r = await PWDB.request(method, pathname, qs, body); }
  finally { renderStorageBanner(); }
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

/* ---------- storage health ----------
   Both engines answer 507 when a write cannot be stored: db.js because the
   phone's localStorage refused it, server.py because sqlite's disk did not.
   The dialog that failed shows the reason; this banner is the persistent half,
   so nobody keeps typing records into a store that is not taking them. */
function renderStorageBanner(msg) {
  const el = $("#storage-banner");
  if (!el) return;
  const st = (typeof PWDB !== "undefined" && PWDB.storageStatus)
    ? PWDB.storageStatus() : { ok: true, error: "" };
  const text = msg || (st.ok ? "" : st.error);
  if (text) {
    el.textContent = /storage is full/i.test(text)
      ? "⚠ Storage is full — changes are NOT being saved. Tap to back up now."
      : "⚠ Your changes are not being saved. Tap to back up now.";
  }
  el.classList.toggle("hidden", !text);
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
  if (!res.ok) {
    renderStorageBanner(res.status === 507 ? String(rbody.error || "") : "");
    throw new Error(rbody.error || `HTTP ${res.status}`);
  }
  renderStorageBanner("");      // a stored write clears the alarm
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
  chat: ["Assistant", "Chat with your books"],
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
    view === "budget" || view === "branches" || view === "income" || view === "chat");
  closeMore();
  try {
    if (view === "dashboard") await loadDashboard();
    else if (view === "purchases") await loadPurchases();
    else if (view === "income") await loadIncome();
    else if (view === "credits") await loadCredits();
    else if (view === "analytics") await loadAnalytics();
    else if (view === "budget") await loadBudget();
    else if (view === "chat") { syncChatUser(); renderAgent(); renderSidebar(); showChatPane(CHAT_PANE); }
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

/* Each preset is a real, live endpoint — verified against the provider, not
   guessed: preflights answered from this app's own origin, ids read off the
   provider's own docs or model list. `models` is the datalist offered under
   it, `note` is what the dialog tells the owner about it. `google` leads
   because its free tier is the only one that both takes a key with no card
   and reads photographs — which is what a slip scan needs. */
const AI_PROVIDERS = [
  { id: "gemini", name: "Google Gemini", label: "Google Gemini · free, no card",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    get: "https://aistudio.google.com/apikey",
    /* Google retires ids as it ships replacements, so these are the ones a
       brand-new key is actually served today. An older id a returning owner
       has stored stays valid for them: it is on no preset's list, so
       aiOwnModel() leaves it alone instead of swapping it out. */
    models: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"],
    note: "Free with no card, and it reads photos — the simplest pick." },
  { id: "groq", name: "Groq", label: "Groq · free, no card",
    base: "https://api.groq.com/openai/v1",
    get: "https://console.groq.com/keys",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    note: "Free plan: 1,000 requests a day. Text only — no camera scans." },
  { id: "openrouter", name: "OpenRouter", label: "OpenRouter · free models",
    base: "https://openrouter.ai/api/v1",
    get: "https://openrouter.ai/keys",
    models: ["openrouter/free", "google/gemma-4-31b-it:free",
             "qwen/qwen3.8-27b:free", "thinkingmachines/inkling:free",
             "anthropic/claude-haiku-4.5"],
    note: "Free models, no card — several read photos, and paid ids like Claude work once OpenRouter has credit." },
  { id: "deepseek", name: "DeepSeek", label: "DeepSeek · cheap, reads photos",
    base: "https://api.deepseek.com/v1",
    get: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
             "deepseek-v4-pro"],
    note: "Cheapest that reads photos (about $0.15 per 1M words in) — top up a balance, no free tier." },
  { id: "custom", name: "Custom", label: "Custom · OpenAI-compatible",
    base: "", get: "", models: [],
    note: "Any OpenAI-compatible endpoint you already have." },
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

let AI = { provider: "gemini", base: "", model: "", key: "", areas: null };
let AI_LAST_ERROR = "";

const aiAreaDefault = (id) => id === "capture" || id === "catalogue";

function loadAI() {
  try {
    const raw = localStorage.getItem(AI_KEY_STORAGE);
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === "object") {
      AI = {
        provider: String(o.provider || "gemini"),
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

/* A model id belongs to exactly one provider. The stored one can be left over
   from another — the owner saved with Groq, then switched to Google — and
   asking Google for `openai/gpt-oss-120b` would only fail after the key was
   accepted, which looks like a broken key rather than a wrong model. So an id
   that sits on some *other* preset's list is not this connection's id and the
   provider's default takes over. An id on no list is left alone: a custom
   endpoint may serve models this app has never heard of. */
function aiOwnModel() {
  const m = String(AI.model || "").trim();
  if (!m || AI.provider === "custom") return m;
  if ((aiPreset().models || []).includes(m)) return m;
  const elsewhere = AI_PROVIDERS.some((p) =>
    p.id !== "custom" && p.id !== AI.provider && (p.models || []).includes(m));
  return elsewhere ? "" : m;
}
const aiModel = () => (aiOwnModel() || aiPreset().models[0] || "").trim();
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
  const note = $("#ai-note");
  if (note) note.textContent = aiPreset().note || "";
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
    provider: (($("#ai-provider") || {}).value || "gemini"),
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

/* ---------- AI assistant: the control centre ----------
   Everything above is a body part. This is the console: the owner types,
   speaks or attaches something, the model proposes what to do, and nothing
   that changes a record happens until a hand presses Approve.

   Three rules hold it up:
     1. The model only ever *proposes*. Reads run at once; writes render an
        approval card and wait for a human.
     2. Every write lands in an on-device journal with the state before it,
        so the owner — or the model, when asked — can put it back.
     3. The tool list is filtered by the same coverage areas as everything
        else: turn `app` off and the hands are gone.

   /api/ai/chat is mirrored in db.js and server.py. The tools themselves
   call ordinary /api/* routes, so the body gains nothing to mirror. */
const AGENT_STORE = "pwbudget.agent.v1";
const AGENT_TURNS = 3;      // model turns allowed per user message
const AGENT_GAP = 1200;     // ms between model calls — free tiers are metered
const AGENT_JOURNAL_MAX = 120;
const AGENT_SESSION_MAX = 20;
const AGENT_BULK_MAX = 40;   // actions per tool one reply may turn into cards

/* A flat conversation became a list of them: every reload archives the chat
   that was open and starts an empty one, the sidebar holds the rest. */
let AGENT = {
  sessions: [], cur: 0, projects: [],
  messages: [], journal: [], voice: false, seq: 1, jseq: 1, ui: {},
};
let AGENT_BUSY = false;
let AGENT_LAST_CALL = 0;
const AGENT_FILES = {};     // generated reports: fid -> {name, mime, bytes}

/* Every hand the model may ask for. `area` ties it to the coverage switch,
   `risk` decides whether it runs straight away or waits for approval, and
   `free` marks a hand the coverage matrix never hides — asking the owner to
   widen that matrix is itself part of the deal. */
const AGENT_TOOLS = [
  { id: "overview", risk: "read", area: "", label: "Read the dashboard",
    args: "{}", desc: "This month's spend, money in, outstanding credit and budget left." },
  { id: "search_purchases", risk: "read", area: "", label: "Search purchases",
    args: "{q?, month?, branch_id?, limit?}", desc: "Find purchases by word, month or branch." },
  { id: "get_purchase", risk: "read", area: "", label: "Read one purchase",
    args: "{purchase_id}", desc: "The full detail of a single purchase row." },
  { id: "compare_months", risk: "read", area: "", label: "Compare months",
    args: "{n?}", desc: "Spend, money in and bill count for the last n months (default 3), with the change between them." },
  { id: "get_reminders", risk: "read", area: "", label: "Read the reminders",
    args: "{}", desc: "Overdue credit, budget burn and unit-price spikes — worst first. Says 'all quiet' when there is nothing." },
  { id: "price_trend", risk: "read", area: "", label: "Unit price trend for an item",
    args: "{product, n?}", desc: "Average unit price per month for one of your items — shows a price rising." },
  { id: "top_suppliers", risk: "read", area: "", label: "Top suppliers",
    args: "{n?}", desc: "Who has been paid the most, with share of spend." },
  { id: "navigate", risk: "read", area: "", label: "Open a screen",
    args: "{view}",
    desc: "view: dashboard|purchases|income|credits|analytics|budget|branches|chat — opens it in the app." },
  { id: "list_income", risk: "read", area: "money", label: "List money in",
    args: "{month?, limit?}", desc: "List recorded income rows." },
  { id: "search_income", risk: "read", area: "money", label: "Search money in",
    args: "{q?, month?, limit?}", desc: "Find money-in rows by word or month." },
  { id: "list_credits", risk: "read", area: "money", label: "List what is owed",
    args: "{}", desc: "Outstanding supplier credit with balances." },
  { id: "get_budget", risk: "read", area: "money", label: "Read the budget",
    args: "{year?, month?, branch_id?}", desc: "Saved budget, allocations and actual spend." },
  { id: "budget_health", risk: "read", area: "money", label: "Budget health",
    args: "{year?, month?}", desc: "Plan versus actual: percent used, what is left, and each allocation's burn." },
  { id: "get_analytics", risk: "read", area: "money", label: "Read analytics",
    args: "{n?}", desc: "Monthly spend, top items, distributors and payment split." },
  { id: "list_catalogue", risk: "read", area: "catalogue", label: "List items and suppliers",
    args: "{}", desc: "Your own product and distributor names, spelled your way." },
  { id: "list_changes", risk: "read", area: "", label: "Read the change log",
    args: "{}", desc: "What has been changed here, with the state before each change." },
  { id: "make_report", risk: "read", area: "", label: "Build a report file",
    args: "{kind, format, month?, year?, branch_id?}",
    desc: "kind: overview|purchases|income|credits|budget; format: pdf|docx. Returns a file to download." },
  { id: "backup_books", risk: "read", area: "", label: "Back up my books",
    args: "{}", desc: "Build the full backup JSON — every branch, supplier, item, purchase, payment, money-in row and budget — for the owner to keep." },
  { id: "import_slip", risk: "write", area: "capture", label: "Record a pasted slip",
    args: "{text?}",
    desc: "Turn pasted receipt or statement lines into one approval card per purchase. Text may be omitted when the owner's message already holds it." },
  { id: "propose_coverage", risk: "write", area: "", free: true,
    label: "Change a coverage switch",
    args: "{area, on?}",
    desc: "area: capture|catalogue|money|app; on: true (default) or false. Proposes one of the owner's four coverage switches — it turns on only when they approve." },
  { id: "create_purchase", risk: "write", area: "app", label: "Record a purchase",
    args: "{date, distributor, product, unit, quantity, total_amount, payment_method, branch_id?, memo?, credit_paid?}",
    desc: "Write a new purchase row." },
  { id: "create_income", risk: "write", area: "app", label: "Record money in",
    args: "{date, amount, source, reference?, memo?, branch_id?}", desc: "Write a new income row." },
  { id: "pay_credit", risk: "write", area: "app", label: "Pay a credit",
    args: "{purchase_id, date, amount, memo?}", desc: "Record a payment against an outstanding credit." },
  { id: "save_budget", risk: "write", area: "app", label: "Save the budget",
    args: "{year, month, total_amount, save_amount, branch_id?}", desc: "Set the monthly plan." },
  { id: "add_branch", risk: "write", area: "app", label: "Add a branch",
    args: "{name}", desc: "Create a new shop or plant." },
  { id: "move_purchase", risk: "write", area: "app", label: "Move a purchase to another branch",
    args: "{purchase_id, branch_id}", desc: "Change which branch a purchase belongs to." },
  { id: "delete_purchase", risk: "danger", area: "app", label: "Delete a purchase",
    args: "{purchase_id}", desc: "Remove a purchase row and its credit payments." },
  { id: "delete_income", risk: "danger", area: "app", label: "Delete a money-in row",
    args: "{income_id}", desc: "Remove an income row." },
  { id: "undo_change", risk: "danger", area: "app", label: "Undo an earlier change",
    args: "{jid}", desc: "Put back the previous state of a logged change." },
];
const AGENT_TOOL = (id) => AGENT_TOOLS.find((t) => t.id === id) || null;
/* The screens the assistant may open behind its panel — same list the app's
   own navigation accepts. */
const AGENT_VIEWS = ["dashboard", "purchases", "income", "credits", "analytics", "budget", "branches", "chat"];

/* Which hands are attached right now, by the same coverage switch the rest
   of the app obeys. Reads need no permission beyond the area that owns the
   data; every write needs `app` on top of that. `free` hands (asking for
   coverage itself) are attached whatever the matrix says. */
function agentTools() {
  return AGENT_TOOLS.filter((t) => {
    if (t.free) return true;
    if (t.area && !aiAllows(t.area)) return false;
    if (t.risk !== "read" && !aiAllows("app")) return false;
    return true;
  });
}
/* The hands the matrix is holding back. They are still *described* to the
   model — a tool it never hears about is a capability it will deny having,
   and "that's all I can do" is a lie it cannot know it is telling. */
function agentLocked() {
  const on = agentTools();
  return AGENT_TOOLS.filter((t) => on.indexOf(t) === -1);
}
function agentLockReason(t) {
  const area = AI_AREAS.find((a) => a.id === (t.area || "app"));
  return `LOCKED — the owner has not switched on "${area ? area.label : "App settings"}" in AI connection`;
}
const agentToolLines = () => agentTools()
  .map((t) => `${t.id} [${t.risk}] (${t.args}) - ${t.desc}`)
  .concat(agentLocked().map((t) =>
    `${t.id} [locked] (${t.args}) - ${t.desc} ${agentLockReason(t)}; you may propose it with propose_coverage, but never claim you can run it.`));

function loadAgent() {
  try {
    const raw = localStorage.getItem(AGENT_STORE);
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === "object") {
      AGENT = {
        sessions: Array.isArray(o.sessions)
          ? o.sessions.map(agentNormSession).filter(Boolean) : null,
        cur: Number(o.cur) || 0,
        projects: Array.isArray(o.projects)
          ? o.projects.filter((p) => p && typeof p === "object")
              .map((p) => ({ id: Number(p.id) || 0,
                             name: String(p.name || "Project").slice(0, 60),
                             ts: Number(p.ts) || Date.now() }))
              .filter((p) => p.id)
          : [],
        messages: [],
        journal: Array.isArray(o.journal) ? o.journal : [],
        voice: !!o.voice,
        seq: Number(o.seq) || 1,
        jseq: Number(o.jseq) || 1,
        ui: o.ui && typeof o.ui === "object" ? { collapsed: !!o.ui.collapsed } : {},
      };
      // v1 shipped one flat conversation — it becomes a single session.
      if (!AGENT.sessions) {
        AGENT.sessions = [{
          id: 1, title: "", renamed: false, pinned: false, pid: null, ts: Date.now(),
          messages: Array.isArray(o.messages) ? o.messages : [],
        }];
      }
      if (!AGENT.sessions.length) AGENT.sessions = [agentFreshSession()];
      if (!AGENT.sessions.some((s) => s.id === AGENT.cur)) AGENT.cur = AGENT.sessions[0].id;
      /* A generated file lives only in memory; on reload its card is a promise
         that has to be made again rather than a lie. */
      AGENT.sessions.forEach((s) => s.messages.forEach((m) => (m.cards || []).forEach((c) => {
        if (c.type === "file") c.stale = !AGENT_FILES[c.fid];
      })));
      const active = agentSession(AGENT.cur) || AGENT.sessions[0];
      AGENT.messages = active.messages;
      /* Every page load is a new chat. The conversation that was open is
         archived under the sidebar — kept in full, titled from its own words
         when it had no name — and an empty one takes its place. */
      if (active.messages.length) {
        const fresh = agentFreshSession();
        AGENT.sessions.push(fresh);
        AGENT.cur = fresh.id;
        AGENT.messages = fresh.messages;
        saveAgent();
      }
    } else if (!AGENT.sessions.length) {
      AGENT.sessions = [agentFreshSession()];
      AGENT.cur = AGENT.sessions[0].id;
      AGENT.messages = AGENT.sessions[0].messages;
    }
  } catch (e) { /* private mode: start empty */ }
}

function saveAgent() {
  capAgentHistory();
  capSessions();
  const active = agentSession(AGENT.cur);
  /* The thread is held in two places on purpose: tests and tools poke
     AGENT.messages directly, so write it back onto the session it belongs
     to before anything is persisted. */
  if (active && active.messages !== AGENT.messages) active.messages = AGENT.messages;
  try {
    localStorage.setItem(AGENT_STORE, JSON.stringify({
      sessions: AGENT.sessions, cur: AGENT.cur, projects: AGENT.projects,
      journal: AGENT.journal, voice: AGENT.voice,
      seq: AGENT.seq, jseq: AGENT.jseq, ui: AGENT.ui,
    }));
  } catch (e) { /* quota */ }
  renderSidebar();
}

/* The conversation lives on this device and grows faster than anything else
   the app stores — read-results are the bulk of it. Shed the old ones before
   a long chat quietly exceeds localStorage and takes the change log down with
   it. A card still waiting for the owner is never shed. */
function capAgentHistory() {
  let hidden = 0;
  for (let i = AGENT.messages.length - 1; i >= 0; i--) {
    const m = AGENT.messages[i];
    if (m && m.role === "system" && m.hidden && m.text) {
      hidden++;
      if (hidden > 6) m.text = "";
    }
  }
  let over = AGENT.messages.length - 120;
  if (over > 0) {
    AGENT.messages = AGENT.messages.filter((m) => {
      const pending = (m && m.cards || []).some((c) => c.type === "ask" && c.status === "pending");
      if (pending || over <= 0) return true;
      over--;
      return false;
    });
  }
}

/* Chats compete for the same localStorage quota as everything else. Keep the
   newest, keep the pinned, never drop the one that is open. */
function capSessions() {
  if (AGENT.sessions.length <= AGENT_SESSION_MAX) return;
  const droppable = AGENT.sessions
    .filter((s) => s.id !== AGENT.cur && !s.pinned)
    .sort((a, b) => a.ts - b.ts);
  let over = AGENT.sessions.length - AGENT_SESSION_MAX;
  for (const s of droppable) {
    if (over <= 0) break;
    AGENT.sessions.splice(AGENT.sessions.indexOf(s), 1);
    over--;
  }
}

/* ---------- sessions ---------- */
function agentNormSession(s, i) {
  if (!s || typeof s !== "object") return null;
  return {
    id: Number(s.id) || (Date.now() + i),
    title: typeof s.title === "string" ? s.title : "",
    renamed: !!s.renamed,
    pinned: !!s.pinned,
    pid: s.pid === null || s.pid === undefined || s.pid === "" ? null : Number(s.pid),
    ts: Number(s.ts) || Date.now(),
    messages: Array.isArray(s.messages) ? s.messages : [],
  };
}

function agentSession(id) {
  return AGENT.sessions.find((s) => s.id === id) || null;
}

function activeSession() {
  return agentSession(AGENT.cur) || AGENT.sessions[0] || null;
}

function agentFreshSession() {
  let id = Date.now();
  while (agentSession(id)) id++;
  return { id, title: "", renamed: false, pinned: false, pid: null, ts: id, messages: [] };
}

/* Titles come from the owner's own words: the first message's significant
   words, more only when that alone has nothing to give. Renaming pins a name
   for good. */
const AGENT_STOP = ("a an the and or but if so to of in on at for with from by as is are was were be been "
  + "do does did this that it its i we you they he she my our your their me us them "
  + "please can could would should will shall may might just now today yesterday tomorrow "
  + "what which who whom how much many some any all get got give show tell let need want "
  + "there here when while about into over under after before again more less very not no yes").split(/\s+/);

function agentTitleWords(text) {
  return String(text || "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w && AGENT_STOP.indexOf(w.toLowerCase()) === -1);
}

function agentAutoTitle(messages) {
  const ums = (messages || []).filter((m) => m && m.role === "user" && m.text);
  if (!ums.length) {
    const any = (messages || []).find((m) => m && m.text && m.role !== "system");
    return agentTitleWords(any ? any.text : "").slice(0, 6).join(" ");
  }
  let words = agentTitleWords(ums[0].text);
  for (let i = 1; i < ums.length && words.length < 3; i++) {
    words = words.concat(agentTitleWords(ums[i].text));
  }
  return words.slice(0, 6).join(" ");
}

function agentSessionTitle(s) {
  if (!s) return "New chat";
  if (s.renamed && s.title) return s.title;
  return agentAutoTitle(s.messages) || "New chat";
}

function agentNewSession() {
  const cur = activeSession();
  if (cur && !cur.messages.length) {   // an empty chat already is new
    AGENT.cur = cur.id;
    AGENT.messages = cur.messages;
    renderSidebar();
    return cur;
  }
  const s = agentFreshSession();
  AGENT.sessions.push(s);
  AGENT.cur = s.id;
  AGENT.messages = s.messages;
  saveAgent();
  renderAgent();
  return s;
}

function agentSwitchSession(id) {
  const s = agentSession(id);
  if (!s) return;
  AGENT.cur = s.id;
  AGENT.messages = s.messages;
  showChatPane("chats");
  saveAgent();
  renderAgent();
  if (!s.messages.length) agentBriefing();
}

function agentDeleteSession(id) {
  const i = AGENT.sessions.findIndex((s) => s.id === id);
  if (i === -1) return;
  const wasActive = AGENT.cur === id;
  AGENT.sessions.splice(i, 1);
  if (!AGENT.sessions.length) AGENT.sessions = [agentFreshSession()];
  if (wasActive) {
    const next = activeSession();
    AGENT.cur = next.id;
    AGENT.messages = next.messages;
    renderAgent();
  }
  saveAgent();
}

function agentRenameSession(id, title) {
  const s = agentSession(id);
  if (!s) return;
  s.title = String(title || "").trim().slice(0, 80);
  s.renamed = !!s.title;
  saveAgent();
}

function agentTogglePin(id) {
  const s = agentSession(id);
  if (!s) return;
  s.pinned = !s.pinned;
  saveAgent();
}

function agentMoveSession(id, pid) {
  const s = agentSession(id);
  if (!s) return;
  s.pid = pid ? Number(pid) : null;
  saveAgent();
}

function agentAddProject(name) {
  const n = String(name || "").trim().slice(0, 60);
  if (!n) return null;
  const p = { id: Date.now(), name: n, ts: Date.now() };
  while (agentProject(p.id)) p.id++;
  AGENT.projects.unshift(p);
  saveAgent();
  return p;
}

function agentProject(id) {
  return AGENT.projects.find((p) => p.id === id) || null;
}

function agentDeleteProject(id) {
  const i = AGENT.projects.findIndex((p) => p.id === id);
  if (i === -1) return;
  AGENT.projects.splice(i, 1);
  AGENT.sessions.forEach((s) => { if (s.pid === id) s.pid = null; });
  if (PROJ_FILTER === id) PROJ_FILTER = null;
  saveAgent();
}

/* ---------- rendering ---------- */
const AGENT_RISK = {
  read: { cls: "", tag: "reads" },
  write: { cls: "write", tag: "changes data" },
  danger: { cls: "danger", tag: "destructive" },
};
const AGENT_ICON = { read: "👁", write: "✍", danger: "⚠" };

function agentAskHtml(c, fresh) {
  const r = AGENT_RISK[c.risk] || AGENT_RISK.read;
  const lines = (c.lines || []).map((l) => `<li>${esc(l)}</li>`).join("");
  const state = {
    pending: "",
    done: `<div class="acard-state ok">✓ done — written to your books</div>`,
    denied: `<div class="acard-state no">✗ denied — nothing was changed</div>`,
    failed: `<div class="acard-state no">✗ ${esc(c.error || "could not be done")}</div>`,
    undone: `<div class="acard-state ok">✓ undone — previous state restored</div>`,
  }[c.status] || "";
  const acts = c.status === "pending"
    ? `<div class="acard-acts">
         <button type="button" class="btn primary small" data-agent-act="approve" data-aid="${c.aid}">Approve</button>
         <button type="button" class="btn ghost small" data-agent-act="deny" data-aid="${c.aid}">Deny</button>
       </div>`
    : "";
  return `<div class="acard ${r.cls} st-${esc(c.status || "pending")}${fresh ? " fresh" : ""}" data-aid="${c.aid}">
    <div class="acard-top"><span class="acard-ico">${AGENT_ICON[c.risk] || "•"}</span>
      <b>${esc(c.label || c.tool)}</b><span class="abadge ${r.cls}">${esc(r.tag)}</span></div>
    <ul class="acard-lines">${lines}</ul>${state}${acts}</div>`;
}

function agentResultHtml(c, fresh) {
  const body = c.text ? `<div class="acard-body">${esc(c.text)}</div>` : "";
  return `<div class="acard read st-done${fresh ? " fresh" : ""}">
    <div class="acard-top"><span class="acard-ico">👁</span><b>${esc(c.label || c.tool)}</b>
      <span class="abadge">read</span></div>${body}</div>`;
}

function agentFileHtml(c, fresh) {
  const ready = !c.stale && AGENT_FILES[c.fid];
  return `<div class="acard read st-done${fresh ? " fresh" : ""}">
    <div class="acard-top"><span class="acard-ico">📄</span><b>${esc(c.name)}</b>
      <span class="abadge">${esc(c.format)}</span></div>
    <div class="acard-acts">
      <button type="button" class="btn ${ready ? "primary" : "ghost"} small"
        data-agent-act="download" data-fid="${esc(c.fid)}"${ready ? "" : " disabled"}>
        ${ready ? "⤓ Download" : "ask me to rebuild it"}</button>
    </div></div>`;
}

function agentCardHtml(c, fresh) {
  if (!c) return "";
  if (c.type === "ask") return agentAskHtml(c, fresh);
  if (c.type === "result") return agentResultHtml(c, fresh);
  if (c.type === "file") return agentFileHtml(c, fresh);
  return "";
}

/* The quick-start chips reflect the hands actually attached: offering "what
   do we owe" when that switch is off would only earn a locked answer. */
function agentChips() {
  const ids = agentTools().map((t) => t.id);
  const chips = [{ text: "How much did we spend this month?" }];
  if (ids.indexOf("list_credits") !== -1) chips.push({ text: "What do we owe right now?" });
  else chips.push({ act: "open-ai", text: "Turn on credit coverage ⚙️" });
  chips.push({ text: "Build me a PDF report" });
  chips.push({ text: "What have you changed so far?" });
  return chips;
}

function agentBriefHtml() {
  const b = AGENT_BRIEF;
  if (!b) return "";
  const alerts = b.alerts && b.alerts.length
    ? `<ul class="agent-brief-list">${b.alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
    : `<p class="agent-brief-quiet">✅ Nothing needs attention right now.</p>`;
  return `<div class="agent-brief"><b>${esc(b.hello)} — here is where the shop stands.</b>
    ${alerts}<small>${esc(b.reach)}</small></div>`;
}

/* A rendered message is only animated the first time it appears — the list
   is rebuilt wholesale on every state change, so "new since last paint" has
   to be remembered, not derived. Object identity does that (history cap
   keeps the same references). */
const AGENT_SEEN = new WeakSet();
const AGENT_SEEN_CARDS = new WeakSet();

function renderAgent() {
  const box = $("#agent-msgs");
  if (!box) return;
  const msgs = AGENT.messages;
  if (!msgs.length) {
    box.innerHTML = `<div class="agent-empty">
      <div class="agent-empty-ico">✦</div>
      <b>What should I do?</b>
      <p>Ask in plain words. Reads happen straight away; anything that changes a
         record waits for your approval first.</p>
      ${agentBriefHtml()}
      <div class="agent-chips">
        ${agentChips().map((c) => c.act
          ? `<button type="button" class="agent-chip" data-agent-act="${esc(c.act)}">${esc(c.text)}</button>`
          : `<button type="button" class="agent-chip" data-agent-chip="${esc(c.text)}">${esc(c.text)}</button>`).join("")}
      </div></div>`;
  } else {
    box.innerHTML = msgs.map((m) => {
      if (m.hidden) return "";
      if (m.role === "system")
        return `<div class="agent-sys">${esc(m.text)}</div>`;
      const fresh = !AGENT_SEEN.has(m);
      AGENT_SEEN.add(m);
      const side = m.role === "user" ? "me" : "bot";
      const cards = (m.cards || []).map((c) => {
        const cf = !AGENT_SEEN_CARDS.has(c);
        AGENT_SEEN_CARDS.add(c);
        return agentCardHtml(c, cf);
      }).join("");
      const pend = (m.cards || []).filter((c) => c.type === "ask" && c.status === "pending").length;
      const bulk = pend >= 2
        ? `<div class="acard-acts bulk">
             <button type="button" class="btn primary small" data-agent-act="approve-all"
               data-mid="${m.mid || 0}">Approve all ${pend}</button>
           </div>` : "";
      const speak = side === "bot" && m.text
        ? `<button type="button" class="agent-say" data-agent-act="speak"
             data-mid="${m.mid || 0}" aria-label="Read aloud">🔈</button>` : "";
      const retry = side === "bot" && m.retry
        ? `<button type="button" class="btn ghost small agent-retry"
             data-agent-act="retry" data-mid="${m.mid || 0}">Try again</button>` : "";
      const follow = side === "bot" && (m.follow || []).length
        ? `<div class="agent-follow">${m.follow.map((f) =>
            `<button type="button" class="agent-chip" data-agent-chip="${esc(f)}">${esc(f)}</button>`).join("")}</div>`
        : "";
      const av = side === "bot"
        ? `<span class="agent-av" aria-hidden="true">✦</span>` : "";
      return `<div class="agent-row ${side}${fresh ? " fresh" : ""}">${av}
        <div class="agent-col">
          <div class="agent-bubble">${m.text ? esc(m.text) : ""}${speak}</div>
          ${retry}${cards}${bulk}${follow}
        </div></div>`;
    }).join("");
    if (AGENT_BUSY)
      box.insertAdjacentHTML("beforeend",
        `<div class="agent-row bot">
           <span class="agent-av" aria-hidden="true">✦</span>
           <div class="agent-col"><div class="agent-bubble typing"><i></i><i></i><i></i></div></div>
         </div>`);
  }
  renderAgentStatus();
  const input = $("#agent-input");
  const send = $("#agent-send");
  if (send) send.disabled = AGENT_BUSY;
  if (input) input.disabled = AGENT_BUSY;
  const scroller = $("#agent-scroll") || box;
  if (scroller && scroller.scrollTop != null) scroller.scrollTop = scroller.scrollHeight;
}

function renderAgentStatus() {
  const el = $("#agent-status");
  if (!el) return;
  const s = aiStatus();
  const pill = $("#agent-pill");
  if (pill) pill.classList.toggle("on", aiConfigured());
  // Cards wait in whichever chat they were left — count every session, and
  // light the badge even with no model attached: approving is a local act.
  const msgs = AGENT.sessions.length
    ? AGENT.sessions.reduce((a, s) => a.concat(s.messages), []) : AGENT.messages;
  const pend = msgs.reduce((n, m) =>
    n + (m.cards || []).filter((c) => c.type === "ask" && c.status === "pending").length, 0);
  const fab = $("#agent-fab");
  if (fab) fab.className = "agent-fab" + (pend ? " pending" : "");
  const chatNav = document.querySelector('.nav-btn[data-view="chat"]');
  if (chatNav) chatNav.classList.toggle("pending", !!pend);
  if (!aiConfigured()) {
    el.textContent = "no model attached" + (pend ? ` · ${pend} waiting on you` : "");
    return;
  }
  const reach = agentTools().map((t) => t.risk).filter((v, i, a) => a.indexOf(v) === i);
  const bits = [`${reach.length ? "can " + reach.join("/") : "reads only"}`];
  const locked = agentLocked().length;
  if (locked) bits.push(`${locked} locked by coverage`);
  if (AI_LAST_ERROR) bits.push("problem");
  el.textContent = bits.join(" · ") + (pend ? ` · ${pend} waiting on you` : "");
}

/* The assistant is an app section now: opening it is switching to the chat
   view. The mobile sidebar is a drawer; on a wide screen it collapses to
   give the thread the full width. */
let CHAT_PANE = "chats";   // which pane the main area shows: chats | projects | logs

function isMobileChat() {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
}

function toggleChatSidebar(force) {
  const side = $("#chat-sidebar"), scrim = $("#chat-scrim"), layout = $("#chat-layout");
  if (!side || !layout) return;
  if (isMobileChat()) {
    const open = force === undefined ? !side.classList.contains("open") : !!force;
    side.classList.toggle("open", open);
    if (scrim) scrim.classList.toggle("open", open);
  } else {
    const open = force === undefined ? layout.classList.contains("collapsed") : !force;
    layout.classList.toggle("collapsed", !open);
    AGENT.ui = AGENT.ui || {};
    AGENT.ui.collapsed = !open;
    saveAgent();
  }
}

/* Chats and Projects share the thread pane; Logs swaps in the change log.
   The composer stays under both — typing from Logs sends to the chat. */
function showChatPane(which) {
  const w = which === "projects" ? "chats" : which;
  const logs = w === "logs";
  const thread = $("#agent-scroll"), pane = $("#chat-logs");
  if (thread) thread.classList.toggle("hidden", logs);
  if (pane) pane.classList.toggle("hidden", !logs);
  $$(".chat-link").forEach((b) => b.classList.toggle("active", b.dataset.clink === which));
  CHAT_PANE = which;
  if (logs) renderJournal();
}

/* The sidebar's user row mirrors the top bar's shop identity. */
function syncChatUser() {
  const n = $("#chat-user-name"), a = $("#chat-avatar");
  const pn = $("#profile-name"), pa = $("#profile-avatar");
  if (n && pn && pn.textContent) n.textContent = pn.textContent;
  if (a && pa && pa.textContent) a.textContent = pa.textContent;
}

/* ---------- sidebar: chat list, projects, search ---------- */
let CHAT_SEARCH = "";   // live query over titles and every word inside them
let PROJ_FILTER = null; // project row highlighted in the sidebar
let ROW_MENU = null;    // { sid, mode: "actions"|"move" } while a ⋯ menu is open

/* Works for real nodes (closest) and harness fakes (direct getAttribute). */
function closestAttr(el, name) {
  if (!el) return null;
  if (el.closest) {
    const c = el.closest(`[${name}]`);
    if (c && c.getAttribute) { const v = c.getAttribute(name); if (v) return v; }
  }
  if (el.getAttribute) { const v = el.getAttribute(name); if (v) return v; }
  return null;
}

function agentSessionMatches(s, q) {
  if (agentSessionTitle(s).toLowerCase().indexOf(q) !== -1) return true;
  return s.messages.some((m) => m && m.text && String(m.text).toLowerCase().indexOf(q) !== -1);
}

function agentSessionSnippet(s, q) {
  for (const m of s.messages) {
    if (!m || !m.text) continue;
    const t = String(m.text);
    const i = t.toLowerCase().indexOf(q);
    if (i === -1) continue;
    const from = Math.max(0, i - 24);
    return (from ? "…" : "") + t.slice(from, from + 72).trim()
      + (from + 72 < t.length ? "…" : "");
  }
  return "";
}

function agentBuckets(list) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const y = startToday - 86400000;
  const w = startToday - 7 * 86400000;
  const g = { Pinned: [], Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  for (const s of list) {
    if (s.pinned) g.Pinned.push(s);
    else if (s.ts >= startToday) g.Today.push(s);
    else if (s.ts >= y) g.Yesterday.push(s);
    else if (s.ts >= w) g["Previous 7 days"].push(s);
    else g.Older.push(s);
  }
  return g;
}

function agentChatRow(s) {
  const q = CHAT_SEARCH.trim().toLowerCase();
  return `<div class="chat-row${s.id === AGENT.cur ? " active" : ""}${s.pinned ? " pinned" : ""}" data-crow="${s.id}">
      <button type="button" class="chat-row-main" data-csid="${s.id}">
        <span class="chat-row-t">${esc(agentSessionTitle(s))}${s.pinned ? '<span class="chat-row-pin" title="Pinned">★</span>' : ""}</span>
        ${q ? `<small class="chat-row-sn">${esc(agentSessionSnippet(s, q))}</small>` : ""}
      </button>
      <button type="button" class="chat-row-more" data-cmenu="${s.id}" aria-label="Chat options">⋯</button>
    </div>`;
}

function renderSidebar() {
  const layout = $("#chat-layout");
  if (layout) layout.classList.toggle("collapsed", !!AGENT.ui.collapsed);
  const title = $("#chat-title");
  if (title) title.textContent = agentSessionTitle(activeSession());
  const projs = $("#chat-projects");
  if (projs) {
    projs.innerHTML = AGENT.projects.length
      ? AGENT.projects.map((p) =>
          `<div class="chat-proj${PROJ_FILTER === p.id ? " on" : ""}" data-cproj="${p.id}">
             <span>${esc(p.name)}</span>
             <button type="button" class="chat-proj-x" data-cprojdel="${p.id}" aria-label="Delete project">✕</button>
           </div>`).join("")
      : `<p class="chat-sec-empty">No projects yet.</p>`;
  }
  const recents = $("#chat-recents");
  if (recents) {
    const q = CHAT_SEARCH.trim().toLowerCase();
    let list = AGENT.sessions.slice();
    if (q) list = list.filter((s) => agentSessionMatches(s, q));
    else if (PROJ_FILTER) list = list.filter((s) => s.pid === PROJ_FILTER);
    list.sort((a, b) => b.ts - a.ts);
    let html = "";
    if (!list.length) {
      html = `<p class="chat-sec-empty">${q ? "No chats match." : "Your conversations appear here."}</p>`;
    } else if (q) {
      html = `<div class="chat-grp"><div class="chat-grp-h">Results</div>${list.map(agentChatRow).join("")}</div>`;
    } else {
      const g = agentBuckets(list);
      html = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"]
        .filter((k) => g[k].length)
        .map((k) => `<div class="chat-grp"><div class="chat-grp-h">${k}</div>${g[k].map(agentChatRow).join("")}</div>`)
        .join("");
    }
    recents.innerHTML = html;
  }
}

/* One shared popover for every row's ⋯ — rename, move, pin, delete. */
function openRowMenu(sid, anchor) {
  const m = $("#chat-row-menu");
  if (!m || !agentSession(sid)) return;
  ROW_MENU = { sid, mode: "actions" };
  renderRowMenu();
  m.classList.remove("hidden");
  if (anchor && anchor.getBoundingClientRect && m.style) {
    const r = anchor.getBoundingClientRect();
    if (r && typeof r.bottom === "number") m.style.top = Math.max(4, r.bottom + 4) + "px";
    if (r && typeof r.right === "number" && window.innerWidth)
      m.style.right = Math.max(4, window.innerWidth - r.right) + "px";
  }
}

function renderRowMenu() {
  const m = $("#chat-row-menu");
  const s = ROW_MENU ? agentSession(ROW_MENU.sid) : null;
  if (!m || !s) return;
  if (ROW_MENU.mode === "move") {
    m.innerHTML = `<button type="button" data-ract="back" role="menuitem">← Back</button>`
      + `<button type="button" data-ract="setproj" data-rpid="" role="menuitem">${s.pid ? "No project" : "✓ No project"}</button>`
      + AGENT.projects.map((p) =>
          `<button type="button" data-ract="setproj" data-rpid="${p.id}" role="menuitem">${s.pid === p.id ? "✓ " : ""}${esc(p.name)}</button>`).join("");
  } else {
    m.innerHTML = `<button type="button" data-ract="rename" role="menuitem">✎ Rename</button>`
      + `<button type="button" data-ract="move" role="menuitem">📁 Move to project</button>`
      + `<button type="button" data-ract="pin" role="menuitem">${s.pinned ? "☆ Unpin" : "★ Pin"}</button>`
      + `<button type="button" data-ract="delete" class="danger" role="menuitem">🗑 Delete</button>`;
  }
}

function closeRowMenu() {
  const m = $("#chat-row-menu");
  if (m) m.classList.add("hidden");
  ROW_MENU = null;
}

function runRowMenuAction(t) {
  if (!ROW_MENU) return;
  const act = closestAttr(t, "data-ract");
  if (!act) return;
  if (act === "back") { ROW_MENU.mode = "actions"; renderRowMenu(); return; }
  if (act === "rename") {
    const s = agentSession(ROW_MENU.sid);
    const v = typeof prompt === "function"
      ? prompt("Rename chat", s ? agentSessionTitle(s) : "") : null;
    if (v !== null && v !== undefined) agentRenameSession(ROW_MENU.sid, v);
    closeRowMenu();
    return;
  }
  if (act === "move") { ROW_MENU.mode = "move"; renderRowMenu(); return; }
  if (act === "setproj") {
    agentMoveSession(ROW_MENU.sid, closestAttr(t, "data-rpid"));
    closeRowMenu();
    return;
  }
  if (act === "pin") {
    agentTogglePin(ROW_MENU.sid);
    closeRowMenu();
    return;
  }
  if (act === "delete") {
    const s = agentSession(ROW_MENU.sid);
    const ok = typeof confirm === "undefined"
      || confirm(`Delete "${s ? agentSessionTitle(s) : "chat"}"? This cannot be undone.`);
    if (ok) agentDeleteSession(ROW_MENU.sid);
    closeRowMenu();
  }
}

function agentOpen() {
  if (state.view !== "chat") switchView("chat");
  renderAgent();
  /* First opening of an empty conversation gets the briefing; it fetches the
     reminders and re-renders itself, so the panel answers immediately either
     way. */
  if (!AGENT.messages.length) agentBriefing();
  setTimeout(() => { const i = $("#agent-input"); if (i && i.focus) i.focus(); }, 60);
}

/* Nothing floats over the app to close any more — this only backs out of
   the mobile drawer (and answers for the harness). */
function agentClose() {
  if (isMobileChat()) toggleChatSidebar(false);
}

/* ---------- what the model is told ---------- */
async function agentContext() {
  const bits = [`Today ${today()}.`, `Branch ${branchLabel(state.branch_id)}.`,
                `Currency ${META ? META.currency : "GH\u20b5"}.`,
                `Coverage ${aiScopeSummary()}.`];
  const ctx = await aiBuildContext();
  if (ctx) bits.push(ctx);
  const alerts = await agentAlerts();
  if (alerts.length)
    bits.push("Reminders: " + alerts.slice(0, 3).map((x) => x.title).join("; ") + ".");
  else bits.push("Reminders: nothing needs attention.");
  const ctxMsgs = AGENT.sessions.length
    ? AGENT.sessions.reduce((a, s) => a.concat(s.messages), []) : AGENT.messages;
  const pending = ctxMsgs.reduce((n, m) =>
    n + (m.cards || []).filter((c) => c.type === "ask" && c.status === "pending").length, 0);
  if (pending) bits.push(`${pending} proposal(s) are waiting for the owner to approve.`);
  if (AGENT.journal.length) {
    const last = AGENT.journal.slice(-3).map((j) => `${j.label} (${j.detail})`).join("; ");
    bits.push(`Recent changes: ${last}.`);
  }
  return bits.join(" ");
}

const agentHistory = () => AGENT.messages.filter((m) => m.text).map((m) => ({
  role: m.role === "system" ? "system" : m.role,
  content: String(m.text).slice(0, 2000),
}));

/* A reply is "failed" when a model was asked for and none answered: no
   response at all, or an engine that fell back to its rules (source "").
   `heuristic` is not a failure — that is a server with no key, which has
   something useful to say about attaching one. */
const agentTurnFailed = (r) => !r || r.source === "";
const AGENT_DOWN_LINE = "I could not reach the model just now — check the connection and try again.";
const agentSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function agentTurn() {
  const wait = AGENT_GAP - (Date.now() - AGENT_LAST_CALL);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  AGENT_LAST_CALL = Date.now();
  const payload = {
    messages: agentHistory(),
    tools: agentToolLines(),
    context: await agentContext(),
  };
  const ask = () => {
    if (aiConfigured() && typeof PWDB !== "undefined")
      return offlineRequest("POST", "/api/ai/chat", {}, payload);
    return api("/api/ai/chat", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  };
  let r = null;
  try {
    r = await ask();
    /* Free tiers blip. One quiet retry beats telling the owner it is down
       when it was only a dropped connection — but only once, and never in a
       loop that would look like the app is hanging. */
    if (agentTurnFailed(r)) { await agentSleep(1500); r = await ask(); }
  } catch (e) {
    try { await agentSleep(1200); r = await ask(); } catch (e2) { r = null; }
  }
  if (aiConfigured() && typeof PWDB !== "undefined") {
    if (r && r.source !== "model") {
      AI_LAST_ERROR = `Could not reach ${aiModel()} — the assistant is guessing.`;
    } else { AI_LAST_ERROR = ""; }
    renderAiStrip();
  }
  const failed = agentTurnFailed(r);
  const out = agentParse(!failed && r && r.text ? r.text : "");
  out.failed = failed;
  if (failed && !out.reply) out.reply = AGENT_DOWN_LINE;
  return out;
}

/* The contract is one JSON object. A model that disobeys still gets to talk:
   its raw text becomes the reply instead of an exception. */
function agentParse(raw) {
  const out = { reply: String(raw || "").trim(), actions: [] };
  const s = out.reply.replace(/^```[A-Za-z]*\s*/, "").replace(/\s*```$/, "").trim();
  const bases = [s];
  const open = s.indexOf("{"), close = s.lastIndexOf("}");
  if (open > -1 && close > open + 1) {
    const mid = s.slice(open, close + 1);
    if (mid !== s) bases.push(mid);
  }
  const parse = (t) => {
    try {
      const p = JSON.parse(t);
      return (p && typeof p === "object" && !Array.isArray(p)) ? p : null;
    } catch (e) { return null; }
  };
  const balance = (t) => {
    let inStr = false, esc = false;
    const stack = [];
    for (const ch of t) {
      if (esc) { esc = false; continue; }
      if (inStr) { if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") stack.pop();
    }
    if (!inStr && !stack.length) return null;
    return t + (inStr ? '"' : "") + stack.reverse().join("");
  };
  let obj = null;
  for (const base of bases) {
    let t = base;
    /* Peel the tail a model adds after its object: stray closers, a count
       pasted on the end ("...}]5}"), quotes, whitespace. A quote stops the
       peel, so text inside the JSON can never be eaten. */
    for (let i = 0; i <= 16 && t && !obj; i++) {
      obj = parse(t);
      if (obj) break;
      const n = t.replace(/[}\]\s\d,;`]$/, "");
      if (n === t) {
        const fixed = balance(t);
        if (fixed) obj = parse(fixed);
        break;
      }
      t = n;
    }
    if (obj) break;
  }
  if (obj) {
    if (typeof obj.reply === "string") out.reply = obj.reply;
    if (Array.isArray(obj.actions)) {
      out.actions = obj.actions.filter((a) => a && typeof a === "object")
        .map((a) => ({ tool: String(a.tool || ""), args: (a.args && typeof a.args === "object") ? a.args : {} }))
        .filter((a) => !!AGENT_TOOL(a.tool));
    }
  }
  if (!out.reply) out.reply = "…";
  return out;
}

/* ---------- the loop ----------
   A turn may ask for reads. Those run immediately and their answers go back
   as a system message so the model can finish the thought — but a write never
   runs inside the loop, it becomes a card and the loop stops there. */
async function agentLoop(maxTurns) {
  /* A decision wraps a loop; the loop must hand the flag back the way it
     found it rather than releasing a caller's work in progress. */
  const outer = AGENT_BUSY;
  AGENT_BUSY = true;
  try {
    renderAgent();
    for (let i = 0; i < (maxTurns || AGENT_TURNS); i++) {
      const turn = await agentTurn();
      const msg = { role: "assistant", text: turn.reply, cards: [], mid: AGENT.seq++ };
      AGENT.messages.push(msg);
      /* Voice on means *read my replies*, not "make me press 🔈 every time" —
         the previous utterance is cancelled by agentSpeak before this one. */
      if (AGENT.voice && msg.text && !turn.failed) agentSpeak(msg.mid);
      /* The model could not be reached: say so once, offer the way back in,
         and stop — running the loop again would just repeat the failure. */
      if (turn.failed) { msg.retry = true; renderAgent(); break; }
      const reads = [];
      const asks = [];
      const allowed = agentTools().map((t) => t.id);
      for (const a of turn.actions) {
        if (allowed.indexOf(a.tool) === -1) continue;
        const tool = AGENT_TOOL(a.tool);
        if (tool.id === "import_slip") {
          /* One pasted slip becomes one card per line, all of them pending
             together — the expansion is the tool, not a proposal of its own. */
          const cards = await agentSlipCards(a.args);
          for (const c of cards) msg.cards.push(c);
          continue;
        }
        if (tool.risk === "read") reads.push(a);
        else asks.push(a);
      }
      for (const c of await agentPlanCards(asks)) msg.cards.push(c);
      renderAgent();
      if (!reads.length) { msg.follow = agentFollowups(msg); renderAgent(); break; }
      const seen = [];
      for (const a of reads) {
        const tool = AGENT_TOOL(a.tool);
        if (seen.indexOf(a.tool) !== -1) continue;
        seen.push(a.tool);
        const out = await agentRunTool(tool, a.args);
        if (out && out.file) {
          msg.cards.push({ type: "file", tool: tool.id, fid: out.file.fid,
                           name: out.file.name, format: out.file.format });
        }
        msg.cards.push({ type: "result", tool: tool.id, label: tool.label,
                         text: out.ok === false ? out.error || "could not do that" : out.text });
      }
      AGENT.messages.push({ role: "system", hidden: true,
        text: "Read results:\n" + msg.cards.filter((c) => c.type === "result")
          .map((c) => `${c.tool}: ${c.text}`).join("\n") });
      msg.follow = agentFollowups(msg);
      renderAgent();
    }
  } catch (e) {
    AGENT.messages.push({ role: "assistant", text: `Something went wrong: ${e.message}` });
  } finally {
    AGENT_BUSY = outer;
    saveAgent();
    try { renderAgent(); } catch (e) { /* never strand the panel busy */ }
  }
}

async function agentSend(text) {
  const t = String(text || "").trim();
  if (!t || AGENT_BUSY) return;
  AGENT.messages.push({ role: "user", text: t, mid: AGENT.seq++ });
  const sess = activeSession();
  if (sess) sess.ts = Date.now();       // sending is activity: bump it up the list
  const input = $("#agent-input");
  if (input) input.value = "";
  saveAgent();
  renderAgent();
  await agentLoop();
}

/* ---------- what to offer next ----------
   Two chips, chosen from what the model just did — the cheapest way to make
   a chat feel like a conversation instead of a terminal. */
function agentFollowups(msg) {
  const cards = (msg && msg.cards) || [];
  const tools = cards.filter((c) => c.type === "result").map((c) => c.tool);
  const asked = cards.filter((c) => c.type === "ask" && c.status !== "failed").map((c) => c.tool);
  const has = (t) => tools.indexOf(t) !== -1 || asked.indexOf(t) !== -1;
  const out = [];
  if (has("overview") || has("get_analytics") || has("compare_months")) {
    out.push("What do we owe right now?", "Compare with last month");
  }
  if (has("search_purchases") || has("get_purchase")) {
    out.push("Which supplier cost us the most?", "Show the biggest purchases");
  }
  if (has("list_credits") || has("budget_health")) out.push("Build me a PDF report");
  if (has("get_reminders")) out.push("Open the credits screen");
  if (has("list_catalogue") || has("price_trend")) out.push("Which item got more expensive?");
  if (asked.length) out.push("What have you changed so far?");
  if (!out.length) out.push("How much did we spend this month?", "What do we owe right now?");
  const seen = [];
  return out.filter((c) => { if (seen.indexOf(c) !== -1) return false; seen.push(c); return true; }).slice(0, 2);
}

/* The owner's own pasted text, if the model did not carry it along: the
   message it is answering is the slip more often than not. */
function agentLastUserText() {
  for (let i = AGENT.messages.length - 1; i >= 0; i--) {
    const m = AGENT.messages[i];
    if (m && m.role === "user" && m.text) return String(m.text);
  }
  return "";
}

const agentFailCard = (toolId, error) => ({
  type: "ask", tool: toolId,
  label: (AGENT_TOOL(toolId) || {}).label || toolId,
  risk: (AGENT_TOOL(toolId) || {}).risk || "write",
  aid: AGENT.seq++, status: "failed", error, lines: [],
});

/* One pasted slip → one approval card per line. Extraction is the same call
   the New-purchase dialog makes (so the same rules, the same model, the same
   offline fallback), and nothing is written here — each card goes through the
   ordinary approve path when the owner taps it. */
async function agentSlipCards(args) {
  const a = args && typeof args === "object" ? args : {};
  const text = String(a.text || agentLastUserText()).trim().slice(0, 4000);
  if (!text) return [agentFailCard("import_slip", "there was no text to read")];
  let r = null;
  try { r = await aiExtractRequest({ text }); } catch (e) {
    return [agentFailCard("import_slip", e.message)];
  }
  const draft = (r && r.draft) || (r && r.data && r.data.draft) || null;
  const items = (draft && draft.items) || [];
  if (!draft || !items.length)
    return [agentFailCard("import_slip", "nothing readable in that text")];
  const uncertain = (r && r.uncertain) || [];
  const base = { date: draft.date, distributor: draft.distributor,
                 payment_method: draft.payment_method, memo: draft.memo };
  const cards = [];
  for (let i = 0; i < items.length; i++) {
    const card = await agentPrepare(AGENT_TOOL("create_purchase"),
      Object.assign({}, base, items[i]));
    if (items.length > 1)
      card.label = `Record a purchase (${i + 1} of ${items.length})`;
    if (uncertain.length)
      for (const u of uncertain.slice(0, 3))
        card.lines.push(`⚠ ${(u && u.field) || "field"}: ${(u && u.why) || "check this"}`);
    cards.push(card);
  }
  return cards;
}

/* ---------- the dashboard's own reminders, shared with the model ---------- */
let AGENT_ALERTS = null;
let AGENT_ALERTS_AT = 0;

async function agentDashboardData() {
  const [cr, bg, an] = await Promise.all([
    api("/api/credits"),
    api(`/api/budget?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`),
    api("/api/analytics?n=6"),
  ]);
  return { creds: cr, budget: bg, a: an };
}

async function agentAlerts(force) {
  const now = Date.now();
  if (!force && AGENT_ALERTS && now - AGENT_ALERTS_AT < 30000) return AGENT_ALERTS;
  try {
    AGENT_ALERTS = buildAlerts(await agentDashboardData());
  } catch (e) { AGENT_ALERTS = AGENT_ALERTS || []; }
  AGENT_ALERTS_AT = now;
  return AGENT_ALERTS;
}

/* ---------- the briefing ----------
   Said on opening an empty conversation, built here rather than by the model
   so it works with no key at all: what needs attention, and how far the
   assistant can reach today. */
let AGENT_BRIEF = null;

async function agentBriefing() {
  if (AGENT.messages.length) { AGENT_BRIEF = null; return; }
  let alerts = [];
  try { alerts = await agentAlerts(); } catch (e) { alerts = []; }
  if (AGENT.messages.length) { AGENT_BRIEF = null; return; }
  const hour = new Date().getHours();
  const locked = agentLocked().length;
  AGENT_BRIEF = {
    hello: greetingFor(hour),
    alerts: alerts.slice(0, 3).map((x) => `${x.icon} ${x.title}`),
    reach: aiConfigured()
      ? (locked ? `Attached · ${locked} hand(s) the coverage switch holds back`
                : "Attached · every hand is available")
      : "No model attached yet — add a free key under ⚙️ and I take over from there.",
  };
  renderAgent();
}

/* After a Yes/No the owner deserves an answer in words, not just a tick. */
async function agentFollowup(note) {
  AGENT.messages.push({ role: "system", hidden: true, text: note });
  await agentLoop(1);
}

/* The owner tapped "Try again": the failed reply is folded away and the
   question is asked once more — one retry of our own, not a loop. */
async function agentRetry(mid) {
  if (AGENT_BUSY) return;
  const i = AGENT.messages.findIndex((m) => m && m.mid === mid && m.retry);
  if (i >= 0) AGENT.messages.splice(i, 1);
  saveAgent();
  renderAgent();
  await agentLoop(1);
}

/* ---------- building an approval card ---------- */
/* The whole batch becomes cards — a restock is twelve purchases, not one
   with eleven left on the floor. Same-tool actions are no longer deduped;
   the flood stops at AGENT_BULK_MAX per tool, and a batch of more than one
   numbers itself ("2 of 12") so the owner can tell the rows apart. Reads
   and import_slip are handled by the loop before this is called. */
async function agentPlanCards(actions) {
  const total = {}, seen = {};
  for (const a of actions) total[a.tool] = (total[a.tool] || 0) + 1;
  const cards = [];
  for (const a of actions) {
    const tool = AGENT_TOOL(a.tool);
    if (!tool) continue;
    seen[a.tool] = (seen[a.tool] || 0) + 1;
    if (seen[a.tool] > AGENT_BULK_MAX) continue;
    const card = await agentPrepare(tool, a.args);
    const shown = Math.min(total[a.tool], AGENT_BULK_MAX);
    if (shown > 1) card.label = `${card.label} (${seen[a.tool]} of ${shown})`;
    cards.push(card);
  }
  return cards;
}

async function agentPrepare(tool, args) {
  const a = args || {};
  const card = { type: "ask", tool: tool.id, label: tool.label, risk: tool.risk,
                 aid: AGENT.seq++, status: "pending", lines: [], args: a };
  const br = (id) => {
    const b = META && (META.branches || []).find((x) => x.id === Number(id));
    return b ? b.name : "Main Shop";
  };
  if (tool.id === "create_purchase") {
    const row = agentPurchaseArgs(a);
    card.lines = [
      `${row.date} · ${br(row.branch_id)}`,
      `${row.distributor} · ${row.product} × ${row.quantity} ${row.unit}`,
      `${cur(row.total_amount)} via ${row.payment_method}`,
    ];
    if (row.memo) card.lines.push(`memo: ${row.memo}`);
    card.args = row;
  } else if (tool.id === "create_income") {
    const row = agentIncomeArgs(a);
    card.lines = [`${row.date} · ${br(row.branch_id)}`, `${cur(row.amount)} from ${row.source}`];
    if (row.reference) card.lines.push(`ref ${row.reference}`);
    card.args = row;
  } else if (tool.id === "delete_purchase") {
    const row = await agentFindPurchase(Number(a.purchase_id) || 0);
    if (!row) { card.status = "failed"; card.error = "no purchase with that id"; return card; }
    card.before = row;
    const b = META && (META.branches || []).find((x) => x.id === row.branch_id);
    card.lines = [
      `${row.date} · ${(b && b.name) || "Main Shop"}`,
      `${row.product} × ${row.quantity} ${row.unit} · ${cur(row.total)}`,
      row.payment_method === "Credit"
        ? "on credit — payments against it would go too, so this cannot be undone"
        : "the row will be gone; it can be put back from the log",
    ];
    card.inverse = row.payment_method === "Credit" ? null
      : { tool: "create_purchase", args: agentRowToPurchaseArgs(row) };
    if (!META || !META.branches) card.inverse = null;
    if (!card.inverse) card.undoable = false; else card.undoable = true;
  } else if (tool.id === "delete_income") {
    const rows = await agentFetchAll("/api/income", "rows");
    const row = rows.find((x) => x.id === Number(a.income_id));
    if (!row) { card.status = "failed"; card.error = "no money-in row with that id"; return card; }
    card.before = row;
    card.lines = [`${row.date} · ${cur(row.amount)} from ${row.source}`];
    card.inverse = { tool: "create_income", args: {
      date: row.date, branch_id: row.branch_id, amount: row.amount,
      source: row.source, reference: row.reference, memo: row.memo } };
    card.undoable = true;
  } else if (tool.id === "save_budget") {
    const year = Number(a.year) || new Date().getFullYear();
    const month = Number(a.month) || new Date().getMonth() + 1;
    const prev = await api(`/api/budget?year=${year}&month=${month}`);
    card.lines = [
      `${monthName(month)} ${year} · plan ${cur(Number(a.total_amount) || 0)}`,
      `saving ${cur(Number(a.save_amount) || 0)}`,
    ];
    card.inverse = prev && prev.saved ? { tool: "save_budget", args: {
      year, month, branch_id: prev.branch_id != null ? prev.branch_id : a.branch_id,
      total_amount: prev.total_amount, save_amount: prev.save_amount,
      allocations: prev.allocations } } : null;
    card.undoable = !!card.inverse;
  } else if (tool.id === "move_purchase") {
    const row = await agentFindPurchase(Number(a.purchase_id) || 0);
    if (!row) { card.status = "failed"; card.error = "no purchase with that id"; return card; }
    const from = META && (META.branches || []).find((x) => x.id === row.branch_id);
    card.lines = [`from ${from ? from.name : "?"} → ${br(a.branch_id)}`,
                  `${row.product} · ${cur(row.total)}`];
    card.inverse = { tool: "move_purchase", args: { purchase_id: row.id, branch_id: row.branch_id } };
    card.undoable = true;
  } else if (tool.id === "pay_credit") {
    card.lines = [`pay ${cur(Number(a.amount) || 0)} toward purchase #${a.purchase_id}`,
                  `on ${a.date || today()}`];
    card.undoable = false;
  } else if (tool.id === "add_branch") {
    card.lines = [`new branch: ${String(a.name || "").slice(0, 60)}`,
                  "branches cannot be deleted, so this one sticks"];
    card.undoable = false;
  } else if (tool.id === "undo_change") {
    const j = AGENT.journal.find((x) => x.jid === Number(a.jid));
    if (!j) { card.status = "failed"; card.error = "no such change in the log"; return card; }
    if (!j.inverse) { card.status = "failed"; card.error = "that change cannot be put back"; return card; }
    card.lines = [`put back the state before: ${j.label}`, j.detail];
    card.args = Object.assign({}, j.inverse.args);
    card.tool = j.inverse.tool;
    card.label = `Undo · ${j.label}`;
    card.undoTarget = j.jid;
    card.inverse = null;
    card.undoable = false;
  } else if (tool.id === "propose_coverage") {
    const wantOn = a.on !== false;
    const area = AI_AREAS.find((x) => x.id === String(a.area || ""));
    if (!area) { card.status = "failed"; card.error = "no such coverage switch"; return card; }
    if (aiAllows(area.id) === wantOn) {
      card.status = "failed";
      card.error = `${area.label} is already ${wantOn ? "on" : "off"}`;
      return card;
    }
    card.args = { area: area.id, on: wantOn };
    card.label = `${wantOn ? "Switch on" : "Switch off"} “${area.label}”`;
    card.lines = [`${area.ico} ${area.label} — ${wantOn ? "on" : "off"}`, area.note,
                  "reversible any time in AI connection"];
    card.inverse = { tool: "propose_coverage", args: { area: area.id, on: !wantOn } };
    card.undoable = true;
  } else {
    card.lines = [JSON.stringify(a).slice(0, 200)];
  }
  return card;
}

/* ---------- running a tool ---------- */
const agentPost = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body) });

function agentPurchaseArgs(a) {
  const branch = (META && META.branches && META.branches[0] && META.branches[0].id) || 1;
  const pays = (META && META.payment_methods) || ["Cash"];
  let pm = String(a.payment_method || "").trim();
  if (pays.indexOf(pm) === -1) {
    const hit = pays.find((p) => p.toLowerCase() === pm.toLowerCase());
    if (hit) pm = hit;
    else if (pm) pm = "Cash";
    else pm = "Cash";
  }
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : today(),
    branch_id: Number(a.branch_id) || branch,
    distributor: String(a.distributor || "").trim().slice(0, 80),
    product: String(a.product || "").trim().slice(0, 80),
    unit: String(a.unit || "bag").trim().slice(0, 20) || "bag",
    quantity: Number(a.quantity) || 1,
    total_amount: Number(a.total_amount) || 0,
    payment_method: pm,
    memo: String(a.memo || "").trim().slice(0, 140),
    credit_paid: pm === "Credit" && a.credit_paid != null && a.credit_paid !== ""
      ? Number(a.credit_paid) || 0 : undefined,
  };
}

function agentRowToPurchaseArgs(r) {
  /* The API's own row shape: `product`/`total`, with credit figures nested
     under `credit`. Undo rebuilds a deleted row from exactly this. */
  return { date: r.date, branch_id: r.branch_id, distributor: r.distributor,
           product: r.product, unit: r.unit, quantity: r.quantity,
           total_amount: r.total, payment_method: r.payment_method,
           credit_paid: r.payment_method === "Credit" && r.credit ? r.credit.paid : undefined,
           memo: r.memo };
}

function agentIncomeArgs(a) {
  const branch = (META && META.branches && META.branches[0] && META.branches[0].id) || 1;
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : today(),
    branch_id: Number(a.branch_id) || branch,
    amount: Number(a.amount) || 0,
    source: String(a.source || "").trim().slice(0, 80),
    reference: String(a.reference || "").trim().slice(0, 40),
    memo: String(a.memo || "").trim().slice(0, 140),
  };
}

async function agentFetchAll(path, key) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await api(`${path}?page=${page}&page_size=100`);
    const rows = r && r[key] ? r[key] : [];
    out.push(...rows);
    if (!rows.length || (r.pages && page >= r.pages) || rows.length < 100) break;
  }
  return out;
}

async function agentFindPurchase(id) {
  if (!id) return null;
  const rows = await agentFetchAll("/api/purchases", "rows");
  return rows.find((r) => r.id === id) || null;
}

async function agentRunTool(tool, args) {
  try {
    const a = args || {};
    switch (tool.id) {
      case "overview": {
        const [an, cr] = await Promise.all([api("/api/analytics?n=2"), api("/api/credits")]);
        const m = (an.months || [])[an.months.length - 1] || {};
        const t = an.totals || {};
        return { ok: true, data: { month: m.month, spend: m.spend, income: m.income,
          outstanding: t.credit_outstanding, open_credits: t.open_credit_count },
          text: `${m.month || ""}: spend ${cur(m.spend || 0)}, money in ${cur(m.income || 0)}, ` +
                `${cur(t.credit_outstanding || 0)} owed across ${t.open_credit_count || 0} bill(s).` };
      }
      case "search_purchases": {
        const q = new URLSearchParams();
        if (a.q) q.set("q", String(a.q));
        if (a.month) q.set("month", String(a.month));
        if (a.branch_id) q.set("branch_id", String(a.branch_id));
        q.set("page_size", String(Math.min(50, Number(a.limit) || 20)));
        const r = await api(`/api/purchases?${q}`);
        const rows = (r.rows || []).map((x) =>
          `${x.date} ${x.distributor} ${x.product} x${x.quantity} ${cur(x.total)} ${x.payment_method}`);
        return { ok: true, data: r, text: rows.length ? `${r.total} found:\n${rows.join("\n")}` : "no purchases matched." };
      }
      case "list_income": {
        const q = new URLSearchParams();
        if (a.month) q.set("month", String(a.month));
        q.set("page_size", String(Math.min(50, Number(a.limit) || 20)));
        const r = await api(`/api/income?${q}`);
        const rows = (r.rows || []).map((x) => `${x.date} ${x.source} ${cur(x.amount)}`);
        return { ok: true, data: r, text: rows.length ? `${r.total} found:\n${rows.join("\n")}` : "no money in recorded." };
      }
      case "list_credits": {
        const r = await api("/api/credits");
        const rows = (r.open || []).map((x) => `#${x.id} ${x.distributor || ""} ${cur(x.balance)} of ${cur(x.total)} left`);
        return { ok: true, data: r, text: rows.length ? `${cur(r.outstanding)} outstanding:\n${rows.join("\n")}` : "nothing is owed." };
      }
      case "get_budget": {
        const y = Number(a.year) || new Date().getFullYear();
        const m = Number(a.month) || new Date().getMonth() + 1;
        const r = await api(`/api/budget?year=${y}&month=${m}`);
        return { ok: true, data: r,
          text: r && r.saved ? `${monthName(m)} ${y}: plan ${cur(r.total_amount)}, saved ${cur(r.save_amount)}, spent so far ${cur(r.actual_spend || 0)}.`
                             : `no budget saved for ${monthName(m)} ${y}.` };
      }
      case "get_analytics": {
        const r = await api(`/api/analytics?n=${Math.min(24, Math.max(3, Number(a.n) || 6))}`);
        const top = (r.top_items || []).slice(0, 5)
          .map((x) => `${x.product} ${cur(x.spend)}`).join(", ");
        return { ok: true, data: r,
          text: `spend ${cur((r.totals || {}).spend || 0)} · in ${cur((r.totals || {}).income || 0)}. Top: ${top || "none"}.` };
      }
      case "list_catalogue": {
        const r = await api("/api/meta");
        return { ok: true, data: { products: r.products, distributors: r.distributors },
          text: `items: ${(r.products || []).map((p) => p.name).join(", ") || "none"}.\n` +
                `suppliers: ${(r.distributors || []).map((d) => d.name).join(", ") || "none"}.` };
      }
      case "list_changes": {
        const rows = AGENT.journal.slice(-20).reverse()
          .map((j) => `#${j.jid} ${j.ts} ${j.label} — ${j.detail}${j.undone ? " (undone)" : ""}`);
        return { ok: true, data: AGENT.journal,
          text: rows.length ? `${AGENT.journal.length} change(s):\n${rows.join("\n")}` : "nothing has been changed here yet." };
      }
      case "get_reminders": {
        const list = await agentAlerts(true);
        return { ok: true, data: list,
          text: list.length
            ? `${list.length} reminder(s), worst first:\n` +
              list.map((x, i) => `${i + 1}. ${x.title} — ${x.detail}`).join("\n")
            : "All quiet: no overdue credit, the budget is healthy and no item's price has spiked." };
      }
      case "compare_months": {
        const n = Math.min(12, Math.max(2, Number(a.n) || 3));
        const r = await api(`/api/analytics?n=${n}`);
        const ms = r.months || [];
        const rows = ms.map((m) => `${m.month}  spend ${cur(m.spend)}  in ${cur(m.income)}  ${m.buys} bill(s)`);
        let change = "";
        if (ms.length >= 2) {
          const last = ms[ms.length - 1], prev = ms[ms.length - 2];
          const d = prev.spend > 0 ? ((last.spend - prev.spend) / prev.spend) * 100 : 0;
          change = `\n${last.month} vs ${prev.month}: spend ${d >= 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}%` +
            (last.income >= last.spend ? " · money in still covers it" : " · money in did not cover it");
        }
        return { ok: true, data: ms, text: rows.join("\n") + change };
      }
      case "get_purchase": {
        const row = await agentFindPurchase(Number(a.purchase_id) || 0);
        if (!row) return { ok: false, error: "no purchase with that id" };
        const b = META && (META.branches || []).find((x) => x.id === row.branch_id);
        const cr = row.credit;
        return { ok: true, data: row,
          text: [`#${row.id}  ${row.date}  ${(b && b.name) || row.branch || "Main Shop"}`,
                 `${row.distributor} · ${row.product} × ${row.quantity} ${row.unit}`,
                 `total ${cur(row.total)} · unit ${cur(row.unit_price)} · ${row.payment_method}`]
            .concat(cr && row.payment_method === "Credit"
              ? [`paid ${cur(cr.paid)} · ${cur(cr.balance)} left · ${cr.percent}% settled`] : [])
            .concat(row.memo ? [`memo: ${row.memo}`] : []).join("\n") };
      }
      case "search_income": {
        const q = new URLSearchParams();
        if (a.q) q.set("q", String(a.q));
        if (a.month) q.set("month", String(a.month));
        q.set("page_size", String(Math.min(50, Number(a.limit) || 20)));
        const r = await api(`/api/income?${q}`);
        const rows = (r.rows || []).map((x) =>
          `${x.date}  ${x.source}${x.reference ? " · " + x.reference : ""}  ${cur(x.amount)}`);
        return { ok: true, data: r,
          text: rows.length ? `${r.total} found:\n${rows.join("\n")}` : "no money-in rows matched." };
      }
      case "budget_health": {
        const y = Number(a.year) || new Date().getFullYear();
        const m = Number(a.month) || new Date().getMonth() + 1;
        const r = await api(`/api/budget?year=${y}&month=${m}`);
        if (!r || !r.saved) return { ok: true, text: `no budget saved for ${monthName(m)} ${y}.` };
        const spendable = Math.max((Number(r.total_amount) || 0) - (Number(r.save_amount) || 0), 0);
        const spent = Number(r.actual_spend) || 0;
        const left = spendable - spent;
        const pct = spendable ? (spent / spendable) * 100 : 0;
        const lines = [
          `${monthName(m)} ${y}: plan ${cur(r.total_amount)} · saving ${cur(r.save_amount)}`,
          `spendable ${cur(spendable)} · spent ${cur(spent)} (${pct.toFixed(0)}%) · ${left >= 0 ? `${cur(left)} left` : `${cur(-left)} over`}`,
        ];
        for (const al of (r.allocations || [])) {
          const burn = Number(al.actual) || 0;
          lines.push(`· ${al.name} ${al.percent}% — ${cur(burn)}`);
        }
        return { ok: true, data: r, text: lines.join("\n") };
      }
      case "price_trend": {
        const name = String(a.product || "").trim();
        const n = Math.min(24, Math.max(3, Number(a.n) || 12));
        const r = await api(`/api/analytics?n=${n}`);
        const all = r.unit_trend || [];
        const hit = name
          ? all.find((u) => String(u.product).toLowerCase() === name.toLowerCase()) ||
            all.find((u) => String(u.product).toLowerCase().indexOf(name.toLowerCase()) !== -1)
          : null;
        if (!hit)
          return { ok: true, data: [],
            text: name ? `No unit-price history for "${name}" yet — it has not been bought in this window.`
                       : "Name an item and I will show what it has been costing." };
        const pts = (hit.points || []);
        const rows = pts.map((p) => `${monthLabel(p.month)}  ${cur(p.avg)}`);
        let move = "";
        if (pts.length >= 2) {
          const last = pts[pts.length - 1], prev = pts[pts.length - 2];
          if (prev.avg > 0) {
            const d = ((last.avg - prev.avg) / prev.avg) * 100;
            move = `\n${d >= 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}% since ${monthLabel(prev.month)}`;
          }
        }
        return { ok: true, data: hit, text: `${hit.product}, average unit price:\n${rows.join("\n")}${move}` };
      }
      case "top_suppliers": {
        const n = Math.min(10, Math.max(1, Number(a.n) || 5));
        const r = await api("/api/analytics?n=6");
        const rows = (r.by_distributor || []).slice(0, n)
          .map((d, i) => `${i + 1}. ${d.name}  ${cur(d.spend)}  ${d.share}% · ${d.buys} bill(s)`);
        return { ok: true, data: (r.by_distributor || []).slice(0, n),
          text: rows.length ? `Last 6 months:\n${rows.join("\n")}` : "no purchases on record yet." };
      }
      case "navigate": {
        const v = String(a.view || "").trim();
        if (AGENT_VIEWS.indexOf(v) === -1)
          return { ok: false, error: `no screen called "${v.slice(0, 20)}"` };
        await switchView(v);
        return { ok: true, detail: `opened ${TITLES[v] || v}`,
                 text: `Opened ${TITLES[v] || v} — it is behind this panel.` };
      }
      case "backup_books": {
        const data = await buildBackup();
        const body = JSON.stringify(data, null, 2);
        const name = `pwbudget-backup-${today()}.json`;
        const fid = "f" + (AGENT.seq++);
        AGENT_FILES[fid] = { name, mime: "application/json", bytes: body };
        return { ok: true, data: { name },
          text: `backup ready: ${name} — download it and keep it somewhere safe. It is the whole book, both online and offline.`,
          file: { fid, name, format: "json" } };
      }
      case "make_report": {
        const rep = await agentBuildReport(a);
        const fid = "f" + (AGENT.seq++);
        AGENT_FILES[fid] = { name: rep.name, mime: rep.mime, bytes: rep.bytes };
        return { ok: true, data: { name: rep.name }, text: `report ready: ${rep.name}`,
                 file: { fid, name: rep.name, format: rep.format } };
      }
      default:
        return await agentExecute(tool.id, a);
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------- writes, and putting them back ---------- */
async function agentExecute(toolId, a) {
  switch (toolId) {
    case "create_purchase": {
      const args = agentPurchaseArgs(a);
      const r = await agentPost("/api/purchases", args);
      return { ok: true, id: r.id, inverse: { tool: "delete_purchase", args: { purchase_id: r.id } },
        detail: `${args.distributor} · ${args.product} · ${cur(args.total_amount)}` };
    }
    case "create_income": {
      const args = agentIncomeArgs(a);
      const r = await agentPost("/api/income", args);
      return { ok: true, id: r.id, inverse: { tool: "delete_income", args: { income_id: r.id } },
        detail: `${args.source} · ${cur(args.amount)}` };
    }
    case "delete_purchase": {
      const row = await agentFindPurchase(Number(a.purchase_id) || 0);
      if (!row) return { ok: false, error: "no purchase with that id" };
      await api(`/api/purchases/${row.id}`, { method: "DELETE" });
      const undoable = row.payment_method !== "Credit" && !!(META && META.branches);
      return { ok: true, detail: `${row.product} · ${cur(row.total)} deleted`,
        before: row,
        inverse: undoable ? { tool: "create_purchase", args: agentRowToPurchaseArgs(row) } : null };
    }
    case "delete_income": {
      const rows = await agentFetchAll("/api/income", "rows");
      const row = rows.find((x) => x.id === Number(a.income_id));
      if (!row) return { ok: false, error: "no money-in row with that id" };
      await api(`/api/income/${row.id}`, { method: "DELETE" });
      return { ok: true, detail: `${row.source} · ${cur(row.amount)} deleted`, before: row,
        inverse: { tool: "create_income", args: {
          date: row.date, branch_id: row.branch_id, amount: row.amount,
          source: row.source, reference: row.reference, memo: row.memo } } };
    }
    case "pay_credit": {
      const args = { purchase_id: Number(a.purchase_id) || 0,
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : today(),
        amount: Number(a.amount) || 0, memo: String(a.memo || "").slice(0, 120) };
      const r = await agentPost(`/api/purchases/${args.purchase_id}/pay`, args);
      return { ok: true, detail: `${cur(args.amount)} paid toward #${args.purchase_id}`,
        before: r.credit || null, inverse: null };
    }
    case "save_budget": {
      const args = { year: Number(a.year) || new Date().getFullYear(),
        month: Number(a.month) || new Date().getMonth() + 1,
        branch_id: a.branch_id != null && a.branch_id !== "" ? Number(a.branch_id) : null,
        total_amount: Number(a.total_amount) || 0, save_amount: Number(a.save_amount) || 0 };
      const prev = await api(`/api/budget?year=${args.year}&month=${args.month}`);
      const r = await agentPost("/api/budget", args);
      return { ok: true, detail: `${monthName(args.month)} ${args.year} planned at ${cur(args.total_amount)}`,
        before: prev && prev.saved ? prev : null,
        inverse: prev && prev.saved ? { tool: "save_budget", args: {
          year: args.year, month: args.month, branch_id: prev.branch_id != null ? prev.branch_id : args.branch_id,
          total_amount: prev.total_amount, save_amount: prev.save_amount,
          allocations: prev.allocations } } : null,
        after: r };
    }
    case "add_branch": {
      const args = { name: String(a.name || "").trim().slice(0, 60) };
      const r = await agentPost("/api/branches", args);
      return { ok: true, id: r.id, detail: `branch “${args.name}” added`, inverse: null };
    }
    case "propose_coverage": {
      const area = AI_AREAS.find((x) => x.id === String(a.area || ""));
      if (!area) return { ok: false, error: "no such coverage switch" };
      const wantOn = a.on !== false;
      if (aiAllows(area.id) === wantOn)
        return { ok: false, error: `${area.label} is already ${wantOn ? "on" : "off"}` };
      setAiArea(area.id, wantOn);
      saveAI();
      renderAiStrip();
      renderAiAreas();
      return { ok: true,
        detail: `coverage “${area.label}” is ${wantOn ? "on" : "off"}`,
        before: null,
        inverse: { tool: "propose_coverage", args: { area: area.id, on: !wantOn } } };
    }
    case "move_purchase": {
      const args = { purchase_id: Number(a.purchase_id) || 0, branch_id: Number(a.branch_id) || 0 };
      const row = await agentFindPurchase(args.purchase_id);
      const r = await agentPost(`/api/purchases/${args.purchase_id}/move`, args);
      return { ok: true, id: r.id,
        detail: `#${args.purchase_id} moved to branch ${args.branch_id}`,
        before: row || null,
        inverse: row ? { tool: "move_purchase", args: { purchase_id: row.id, branch_id: row.branch_id } } : null };
    }
    case "undo_change": {
      const j = AGENT.journal.find((x) => x.jid === Number(a.jid));
      if (!j) return { ok: false, error: "no such change in the log" };
      if (!j.inverse) return { ok: false, error: "that change cannot be put back" };
      const tool = AGENT_TOOL(j.inverse.tool);
      if (!tool) return { ok: false, error: "unknown undo step" };
      const res = await agentExecute(j.inverse.tool, j.inverse.args);
      if (res.ok) { j.undone = true; saveAgent(); }
      return res;
    }
    default:
      return { ok: false, error: "unknown tool" };
  }
}

function agentJournal(toolId, label, detail, res) {
  AGENT.journal.push({
    jid: AGENT.jseq++, ts: new Date().toISOString().slice(0, 19).replace("T", " "),
    tool: toolId, label, detail,
    before: res.before !== undefined ? res.before : null,
    after: res.after !== undefined ? res.after : null,
    inverse: res.inverse || null, undone: false,
  });
  while (AGENT.journal.length > AGENT_JOURNAL_MAX) AGENT.journal.shift();
}

function agentFindCard(aid) {
  for (const m of AGENT.messages) {
    const c = (m.cards || []).find((x) => x.type === "ask" && String(x.aid) === String(aid));
    if (c) return { msg: m, card: c };
  }
  return null;
}

async function agentDecide(aid, approve, opts) {
  const silent = !!(opts && opts.silent);      /* part of an approve-all run */
  const hit = agentFindCard(aid);
  if (!hit || hit.card.status !== "pending" || AGENT_BUSY) return;
  const card = hit.card;
  /* Busy covers the whole decision — writing, logging and the reply that
     follows — so a second tap cannot run the same proposal twice. */
  AGENT_BUSY = true;
  card.status = approve ? "running" : "denied";
  renderAgent();
  try {
    if (!approve) {
      saveAgent();
      if (!silent)
        await agentFollowup(`The owner DENIED: ${card.label} — ${card.lines.join(" / ")}. Do not offer it again.`);
      return;
    }
    const tool = AGENT_TOOL(card.tool);
    const res = await agentExecute(card.tool, card.args);
    if (!res.ok) throw new Error(res.error || "failed");
    card.status = "done";
    if (tool) agentJournal(card.tool, tool.label, res.detail || card.lines.join(" / "), res);
    if (card.undoTarget != null) {
      const j = AGENT.journal.find((x) => x.jid === card.undoTarget);
      if (j) j.undone = true;
    }
    toast("✓ " + (res.detail || card.label));
    await refreshMeta();
    if (!silent)
      await agentFollowup(`The owner APPROVED: ${card.label} — ${res.detail || "done"}. It is recorded now.`);
  } catch (e) {
    card.status = "failed";
    card.error = e.message;
    saveAgent();
    renderAgent();
    try {
      if (!silent)
        await agentFollowup(`The owner APPROVED ${card.label} but it FAILED: ${e.message}. Explain and offer a fix.`);
    } catch (e2) { /* the failure is on the card already */ }
  } finally {
    AGENT_BUSY = false;
    saveAgent();
    renderAgent();
    agentRefreshBody();
  }
}

/* Several cards in one message are usually one intention ("record this
   slip"): one tap for the lot, still card by card underneath, still one
   reply at the end instead of one per card. */
async function agentApproveAll(mid) {
  if (AGENT_BUSY) return;
  const msg = AGENT.messages.find((m) => m && String(m.mid) === String(mid));
  if (!msg) return;
  const pending = (msg.cards || []).filter((c) => c.type === "ask" && c.status === "pending");
  if (!pending.length) return;
  let done = 0;
  for (const c of pending) {
    await agentDecide(c.aid, true, { silent: true });
    if (c.status === "done") done++;
  }
  if (done) {
    try { await agentFollowup(`The owner APPROVED ${done} change(s) in one go. All are recorded.`); }
    catch (e) { /* every card shows its own state already */ }
  }
}

/* The panel sits on top of the app, so a change has to be visible underneath
   once the owner closes it. */
async function agentRefreshBody() {
  try {
    if (state.view === "dashboard") await loadDashboard();
    else if (state.view === "purchases") await loadPurchases();
    else if (state.view === "income") await loadIncome();
    else if (state.view === "credits") await loadCredits();
    else if (state.view === "analytics") await loadAnalytics();
    else if (state.view === "budget") await loadBudget();
    else await loadBranches();
  } catch (e) { /* the panel is the truth right now */ }
}

function agentUndo(jid) {
  AGENT.messages.push({ role: "user", text: `Undo change #${jid}`, mid: AGENT.seq++ });
  saveAgent();
  renderAgent();
  agentLoop(1);
}

/* ---------- reports: PDF and Word, built right here ----------
   A report is a view of data the browser already holds, so it is rendered
   in the browser: no dependency, no upload, and it still works with the
   server switched off. A PDF is written byte by byte; a .docx is a ZIP of
   XML, and the ZIP below stores its entries uncompressed, which Word and
   Google Docs both read happily. */
const REPORT_KINDS = ["overview", "purchases", "income", "credits", "budget"];

async function agentReportModel(kind, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const now = new Date();
  const y = Number(o.year) || now.getFullYear();
  const m = Number(o.month) || now.getMonth() + 1;
  const branch = o.branch_id != null && o.branch_id !== "" ? Number(o.branch_id) : null;
  const bq = branch ? `&branch_id=${branch}` : "";
  const title = {
    overview: "Business overview", purchases: "Purchases", income: "Money in",
    credits: "Credit owed", budget: "Budget",
  }[kind] || "Report";
  const rep = {
    title: `PW Budget — ${title}`,
    subtitle: `${monthName(m)} ${y} · ${branchLabel(branch != null ? branch : state.branch_id)}`,
    generated: `Generated ${today()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    sections: [],
  };
  const money = (n) => cur(Number(n) || 0);
  if (kind === "overview") {
    const [an, cr, bg] = await Promise.all([
      api(`/api/analytics?n=6${bq}`), api(`/api/credits${branch ? `?branch_id=${branch}` : ""}`),
      api(`/api/budget?year=${y}&month=${m}${bq}`)]);
    const t = an.totals || {};
    rep.sections.push({ heading: "Key figures",
      columns: [{ h: "Measure", w: 3 }, { h: "Value", w: 2 }],
      rows: [
        ["Spend, last 6 months", money(t.spend)], ["Money in, last 6 months", money(t.income)],
        ["Net", money(t.net)], ["Outstanding credit", money(t.credit_outstanding)],
        ["Open credit accounts", String(t.open_credit_count || 0)],
        ["Purchases recorded", String(t.buys || 0)],
        ["Budget this month", bg && bg.saved ? money(bg.total_amount) : "not set"],
        ["Spent this month", bg && bg.saved ? money(bg.actual_spend || 0) : "—"],
      ] });
    rep.sections.push({ heading: "Month by month",
      columns: [{ h: "Month", w: 2 }, { h: "Spend", w: 2 }, { h: "Money in", w: 2 }, { h: "Bills", w: 1 }],
      rows: (an.months || []).map((r) => [r.month, money(r.spend), money(r.income), String(r.buys || 0)]) });
    rep.sections.push({ heading: "Where it goes",
      columns: [{ h: "Item", w: 3 }, { h: "Qty", w: 1 }, { h: "Spend", w: 2 }, { h: "Share", w: 1 }],
      rows: (an.top_items || []).slice(0, 12)
        .map((r) => [r.product, String(r.qty), money(r.spend), `${r.share}%`]) });
  } else if (kind === "purchases") {
    const r = await api(`/api/purchases?page=1&page_size=300${bq}`);
    rep.sections.push({ heading: `${r.total} purchase(s)`,
      columns: [{ h: "Date", w: 2 }, { h: "Supplier", w: 3 }, { h: "Item", w: 3 },
                { h: "Qty", w: 1 }, { h: "Total", w: 2 }, { h: "Paid via", w: 2 }],
      rows: (r.rows || []).map((x) => [x.date, x.distributor, x.product,
        String(x.quantity), money(x.total), x.payment_method]) });
  } else if (kind === "income") {
    const r = await api(`/api/income?page=1&page_size=300${bq}`);
    rep.sections.push({ heading: `${r.total} row(s)`,
      columns: [{ h: "Date", w: 2 }, { h: "Source", w: 4 }, { h: "Amount", w: 2 }, { h: "Ref", w: 2 }],
      rows: (r.rows || []).map((x) => [x.date, x.source, money(x.amount), x.reference || "—"]) });
  } else if (kind === "credits") {
    const r = await api(`/api/credits${branch ? `?branch_id=${branch}` : ""}`);
    const rows = (r.open || []).concat(r.settled || []);
    rep.sections.push({ heading: `${money(r.outstanding)} outstanding`,
      columns: [{ h: "Supplier", w: 3 }, { h: "Item", w: 3 }, { h: "Total", w: 2 },
                { h: "Paid", w: 2 }, { h: "Left", w: 2 }],
      rows: rows.map((x) => [x.distributor || "—", x.product || `#${x.id}`,
        money(x.total), money(x.paid), money(x.balance)]) });
  } else if (kind === "budget") {
    const r = await api(`/api/budget?year=${y}&month=${m}${bq}`);
    const total = Number(r && r.total_amount) || 0;
    const save = Number(r && r.save_amount) || 0;
    const spendable = Math.max(total - save, 0);
    const spent = Number(r && r.actual_spend) || 0;
    rep.sections.push({ heading: `${monthName(m)} ${y}`,
      columns: [{ h: "Line", w: 3 }, { h: "Amount", w: 2 }],
      rows: r && r.saved
        ? [["Plan", money(total)], ["Saving", money(save)],
           ["Spendable", money(spendable)],
           ["Spent so far", money(spent)],
           ["Left to spend", money(Math.max(spendable - spent, 0))]]
        : [["No budget saved for this month", "—"]] });
    if (r && r.allocations && r.allocations.length)
      rep.sections.push({ heading: "Allocations",
        columns: [{ h: "Category", w: 3 }, { h: "Percent", w: 1 }, { h: "Spent", w: 2 }],
        rows: r.allocations.map((a) => [a.name, `${a.percent}%`, money(a.actual || 0)]) });
  }
  return rep;
}

async function agentBuildReport(args) {
  const kind = REPORT_KINDS.indexOf(String(args && args.kind)) !== -1 ? args.kind : "overview";
  const format = String((args && args.format) || "pdf").toLowerCase() === "docx" ? "docx" : "pdf";
  const rep = await agentReportModel(kind, args);
  const bytes = format === "docx" ? docxFromReport(rep) : pdfFromReport(rep);
  return { name: `pwbudget-${kind}-${today()}.${format === "docx" ? "docx" : "pdf"}`,
           mime: format === "docx"
             ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
             : "application/pdf",
           format, bytes };
}

function pdfFromReport(rep) {
  const W = 595, H = 842, ML = 54, MR = 54, MT = 58, MB = 52;
  const usable = W - ML - MR;
  const pages = [];
  let ops = [], y = H - MT;
  /* Latin-1 has no cedi sign and the base-14 fonts have no glyphs past it, so
     the handful of characters a report can contain are transliterated rather
     than rendered as noise. */
  const ascii = (s) => String(s == null ? "" : s)
    .replace(/[\u20b5]/g, "GHS ").replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2022\u00b7]/g, "-")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = H - MT; };
  const put = (s, x, size, bold) => {
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${ascii(s)}) Tj ET`);
  };
  const write = (s, size, bold, x, gap) => {
    if (y - (gap || size * 1.5) < MB) newPage();
    put(s, x == null ? ML : x, size, bold);
    y -= (gap || size * 1.5);
  };
  const rule = (w) => {
    if (y < MB) newPage();
    ops.push(`q ${ML.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} 0.7 re f Q`);
    y -= 12;
  };

  write(rep.title, 17, true, ML, 22);
  write(rep.subtitle, 10.5, false, ML, 14);
  write(rep.generated, 9, false, ML, 16);
  rule(usable);

  for (const sec of rep.sections) {
    write(sec.heading, 12, true, ML, 17);
    const cols = sec.columns || [];
    const total = cols.reduce((s, c) => s + (Number(c.w) || 1), 0) || 1;
    const widths = cols.map((c) => usable * (Number(c.w) || 1) / total);
    const xs = [];
    let acc = ML;
    for (const w of widths) { xs.push(acc); acc += w; }
    cols.forEach((c, i) => {
      if (y - 13 < MB) newPage();
      put(ascii(c.h).slice(0, Math.floor(widths[i] / 4.4)), xs[i], 8.6, true);
      y -= 13;
    });
    if (y < MB) newPage();
    ops.push(`q ${ML.toFixed(2)} ${y.toFixed(2)} ${usable.toFixed(2)} 0.5 re f Q`);
    y -= 13;
    for (const row of sec.rows || []) {
      if (y - 13 < MB) newPage();
      row.forEach((cell, i) => {
        if (i >= xs.length) return;
        put(String(cell == null ? "" : cell).slice(0, Math.floor(widths[i] / 4.9)), xs[i], 9, false);
      });
      y -= 13.5;
    }
    y -= 9;
  }
  if (ops.length) pages.push(ops);
  if (!pages.length) pages.push([`BT /F1 11 Tf 1 0 0 1 54 780 Tm (Nothing to report.) Tj ET`]);

  const objs = [];
  const nPages = pages.length;
  const fontReg = 3 + nPages * 2, fontBold = fontReg + 1;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`;
  pages.forEach((p, i) => {
    const pid = 3 + i * 2, cid = pid + 1;
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${cid} 0 R >>`;
    const stream = p.join("\n");
    objs[cid] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[fontReg] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[fontBold] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const start = out.length;
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++)
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += xref + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/* --- a minimal store-only ZIP, enough for a .docx --- */
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  const locals = [], centrals = [];
  let offset = 0;
  /* little-endian, as the format demands — these write into a DataView, not
     a byte array, so the setters (not index assignment) are the ones that
     actually move the bits */
  const u16 = (dv, i, v) => dv.setUint16(i, v & 0xffff, true);
  const u32 = (dv, i, v) => dv.setUint32(i, v >>> 0, true);

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length);
    const dv = new DataView(lh.buffer);
    u32(dv, 0, 0x04034b50); u16(dv, 4, 20); u16(dv, 6, 0x0800);
    u16(dv, 8, 0); u16(dv, 10, dosTime); u16(dv, 12, dosDate);
    u32(dv, 14, crc); u32(dv, 18, data.length); u32(dv, 22, data.length);
    u16(dv, 26, name.length); u16(dv, 28, 0);
    lh.set(name, 30);
    locals.push(lh, data);

    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800);
    u16(cv, 10, 0); u16(cv, 12, dosTime); u16(cv, 14, dosDate);
    u32(cv, 16, crc); u32(cv, 20, data.length); u32(cv, 24, data.length);
    u16(cv, 28, name.length); u32(cv, 42, offset);
    ch.set(name, 46);
    centrals.push(ch);
    offset += lh.length + data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, files.length); u16(ev, 10, files.length);
  u32(ev, 12, centralSize); u32(ev, 16, offset);

  const all = locals.concat(centrals, [end]);
  const total = all.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

function docxXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function docxFromReport(rep) {
  const enc = new TextEncoder();
  const p = (runs) => `<w:p>${runs}</w:p>`;
  const run = (text, bold, size) =>
    `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size || 20}"/></w:rPr>` +
    `<w:t xml:space="preserve">${docxXml(text)}</w:t></w:r>`;
  const paras = [
    p(`<w:pPr><w:spacing w:after="60"/></w:pPr>${run(rep.title, true, 34)}`),
    p(run(rep.subtitle, false, 22)),
    p(run(rep.generated, false, 18)),
  ];
  for (const sec of rep.sections) {
    paras.push(p(`<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>${run(sec.heading, true, 26)}`));
    const cols = sec.columns || [];
    paras.push(p(cols.map((c) => run(c.h, true, 18)).reduce(
      (acc, r, i) => acc + (i ? `<w:r><w:tab/></w:r>` : "") + r, "")));
    for (const row of sec.rows || []) {
      paras.push(p(String(row.map((c) => (c == null ? "" : c)).join("\t"))
        .split("\t").map((c, i) => (i ? `<w:r><w:tab/></w:r>` : "") + run(c, false, 18))
        .reduce((a, b) => a + b, "")));
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    paras.join("") +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "word/document.xml", data: enc.encode(document) },
  ]);
}

/* ---------- voice: the microphone and the reply read back ---------- */
function agentRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function agentMic() {
  const btn = $("#agent-mic");
  if (AGENT_BUSY) return;
  const Rec = agentRecognition();
  if (!Rec) {
    toast("Voice input needs Chrome or Edge — type it instead", "err");
    return;
  }
  let rec;
  try { rec = new Rec(); } catch (e) { toast("Voice input could not start", "err"); return; }
  rec.lang = "en-GB";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  if (btn) { btn.classList.add("on"); btn.setAttribute("aria-label", "Listening…"); }
  rec.onresult = (e) => {
    const said = e.results && e.results[0] && e.results[0][0]
      ? e.results[0][0].transcript : "";
    const input = $("#agent-input");
    if (input) input.value = (input.value ? input.value + " " : "") + said;
    agentAutogrow();
  };
  rec.onerror = () => toast("Could not hear that — try again", "err");
  rec.onend = () => { if (btn) { btn.classList.remove("on"); btn.setAttribute("aria-label", "Speak"); } };
  try { rec.start(); } catch (e) { if (btn) btn.classList.remove("on"); }
}

function agentSpeak(mid) {
  if (!AGENT.voice) return;
  if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  const m = AGENT.messages.find((x) => String(x.mid) === String(mid));
  if (!m || !m.text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(m.text);
    u.lang = "en-GB";
    window.speechSynthesis.speak(u);
  } catch (e) { /* voice is a courtesy */ }
}

function agentToggleVoice() {
  AGENT.voice = !AGENT.voice;
  saveAgent();
  const b = $("#agent-voice");
  if (b) {
    b.classList.toggle("on", AGENT.voice);
    b.setAttribute("aria-pressed", AGENT.voice ? "true" : "false");
    b.title = AGENT.voice ? "Replies are read aloud" : "Read replies aloud";
  }
  if (AGENT.voice) toast("Replies will be read aloud");
  else if (typeof window !== "undefined" && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
}

function agentAutogrow() {
  const i = $("#agent-input");
  if (!i) return;
  i.style.height = "auto";
  i.style.height = Math.min(140, (i.scrollHeight || 40)) + "px";
}

/* ---------- attaching a file: the "upload data" half ---------- */
async function agentAttach(file) {
  if (!file) return;
  const name = String(file.name || "file");
  if (file.type && file.type.indexOf("image/") === 0) {
    if (!aiAllows("capture")) {
      toast("Turn on receipt capture in AI settings to read photos", "err");
      return;
    }
    AGENT.messages.push({ role: "user", text: `📷 ${name}`, mid: AGENT.seq++ });
    renderAgent();
    AGENT_BUSY = true;
    renderAgent();
    try {
      const text = await agentReadImage(file);
      const r = await aiExtractRequest({ image: text });
      const msg = { role: "assistant", text: "I read this off the slip — approve to record it.", cards: [] };
      const draft = (r && (r.draft || r.data && r.data.draft)) || null;
      if (draft) {
        msg.cards.push({ type: "ask", tool: "create_purchase", label: "Record a purchase",
          risk: "write", aid: AGENT.seq++, status: "pending",
          lines: [`${draft.date || today()} · ${draft.distributor || "?"}`,
                  (draft.items || []).map((i) => `${i.product} × ${i.quantity} ${i.unit} ${cur(i.total_amount)}`).join("; "),
                  draft.payment_method || "payment not read"],
          args: agentDraftToArgs(draft) });
      } else {
        msg.text = "I could not read anything off that image — paste the text instead.";
      }
      AGENT.messages.push(msg);
    } catch (e) {
      AGENT.messages.push({ role: "assistant", text: `That image did not read: ${e.message}` });
    } finally {
      AGENT_BUSY = false;
      saveAgent();
      renderAgent();
    }
    return;
  }
  const text = await agentReadText(file);
  if (!text) { toast("That file had nothing readable in it", "err"); return; }
  await agentSend(`📎 Attached "${name}":\n${text.slice(0, 3500)}`);
}

function agentDraftToArgs(d) {
  const it = (d.items && d.items[0]) || {};
  return { date: d.date, distributor: d.distributor, product: it.product, unit: it.unit,
           quantity: it.quantity, total_amount: it.total_amount,
           payment_method: d.payment_method, memo: d.memo };
}

function agentReadImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("could not open the file"));
    fr.readAsDataURL(file);
  });
}

function agentReadText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("could not open the file"));
    fr.readAsText(file);
  });
}

/* ---------- the change log the owner can see ---------- */
function renderJournal() {
  const box = $("#journal-list");
  if (!box) return;
  if (!AGENT.journal.length) {
    box.innerHTML = `<p class="hint">Nothing has been changed through the assistant yet.</p>`;
    return;
  }
  box.innerHTML = AGENT.journal.slice().reverse().map((j) => `
    <div class="jrow${j.undone ? " undone" : ""}${j.tool === "voice" ? " voiced" : ""}">
      <div class="jrow-head">
        <span class="jrow-ts">${esc(j.ts)}</span>
        <b>${esc(j.label)}</b>
        ${j.undone ? `<span class="jrow-flag">undone</span>` : ""}
      </div>
      <div class="jrow-detail">${esc(j.detail)}</div>
      ${j.before != null ? `<div class="jrow-before">before: <code>${esc(JSON.stringify(j.before).slice(0, 220))}</code></div>` : ""}
      <div class="jrow-acts">
        ${j.inverse && !j.undone
          ? `<button type="button" class="btn ghost small" data-journal-undo="${j.jid}">↺ Put it back</button>` : ""}
        <span class="jrow-id">#${j.jid}</span>
      </div>
    </div>`).join("");
}

function openJournal() {
  if (state.view !== "chat") switchView("chat");
  showChatPane("logs");
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
function scanOffline() { return usingOfflineEngine(); }

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

/* ================= Your data — backup, restore, export =================
   The offline app has no server to lean on: localStorage on the phone IS the
   ledger. So the owner needs a file they keep themselves, a way to put one
   back, and a spreadsheet they can hand to an accountant.

   Both are written against ordinary API calls, never against engine internals,
   so one code path serves the offline engine and server.py alike, and neither
   engine gains an endpoint the other has to mirror. Restore is deliberately
   additive — it adds what is missing and deletes nothing, which makes it safe
   to run twice and safe on a device that already holds records. */

async function fetchAll(path) {
  const sep = path.indexOf("?") >= 0 ? "&" : "?";
  const first = await api(`${path}${sep}page=1&page_size=200`);
  const rows = (first.rows || []).slice();
  for (let p = 2; p <= (first.pages || 1); p++) {
    const more = await api(`${path}${sep}page=${p}&page_size=200`);
    rows.push(...(more.rows || []));
  }
  return rows;
}

/* Run async work in small batches: N parallel requests is a convenience, 2N is
   a way to be refused a connection. */
async function pool(items, fn, width) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(width || 4, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

/* One .json file in the offline engine's own shape, whichever engine the app
   is talking to — so a backup taken against the server restores into the
   offline copy and the other way round. */
async function buildBackup() {
  const envelope = (mode, data) => ({
    app: "pwbudget", kind: "backup", format: 1,
    exported: new Date().toISOString(), mode, data,
  });
  if (usingOfflineEngine()) return envelope("offline", PWDB.exportData());

  const meta = await api("/api/meta");
  const branches = (meta.branches || []).map((b) => ({ id: b.id, name: b.name }));
  const distributors = (meta.distributor_options || [])
    .map((d) => ({ id: d.id, name: d.name }));
  const purchases = await fetchAll("/api/purchases");
  const income = await fetchAll("/api/income");
  const credits = await api("/api/credits");
  const creditRows = (credits.open || []).concat(credits.settled || []);

  // /api/products answers with a name and a unit; product_options answers with
  // an id and a name. Together they rebuild the table exactly, including items
  // nobody has bought yet — everything left crosses over by name, which is all
  // the create path matches on.
  const unitByName = {};
  for (const p of meta.products || []) unitByName[p.name] = p.unit || "";
  const products = (meta.product_options || []).map((p) => ({
    id: p.id, name: p.name,
    unit_default: p.unit_default || unitByName[p.name] || "",
  }));
  for (const p of meta.products || []) {
    if (products.some((x) => x.name === p.name)) continue;
    products.push({ id: null, name: p.name, unit_default: p.unit || "" });
  }

  const bName = {}, dName = {};
  for (const b of branches) bName[b.id] = b.name;
  for (const d of distributors) dName[d.id] = d.name;
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

  const rows = purchases.map((p) => {
    const pays = p.credit ? p.credit.payments || [] : [];
    const paid = p.credit ? p.credit.paid : 0;
    const isCredit = p.payment_method === "Credit";
    return {
      id: p.id, date: p.date, branch_id: p.branch_id,
      branch: p.branch || bName[p.branch_id] || "",
      distributor_id: p.distributor_id,
      distributor: p.distributor || dName[p.distributor_id] || "",
      product_id: p.product_id, product_name: p.product, unit: p.unit,
      quantity: p.quantity, total_amount: p.total, unit_price: p.unit_price,
      payment_method: p.payment_method,
      credit_total: isCredit ? p.total : null,
      // the ledger stores the first payment on the row and the rest one per
      // line, so what the offline copy calls credit_paid is paid minus those.
      credit_paid: isCredit ? r2(paid - pays.reduce((s, x) => s + x.amount, 0)) : null,
      memo: p.memo || "", created_at: "",
    };
  });

  const credit_payments = [];
  let cp = 0;
  for (const c of creditRows) {
    for (const pay of c.payments || []) {
      credit_payments.push({
        id: ++cp, purchase_id: c.id, date: pay.date,
        amount: pay.amount, memo: pay.memo || "",
      });
    }
  }

  // Budgets come back one month and branch at a time; slots nothing was ever
  // saved for are left out (their answer is a recommendation, not a record).
  // Read in small batches — a page of parallel requests is fine, seventy at
  // once is not: the surplus is refused, and one refused connection is enough
  // to switch the whole app to offline mode for the rest of the session.
  const slots = [null].concat(branches.map((b) => b.id));
  const year = new Date().getFullYear();
  const reqs = [];
  for (let m = 1; m <= 12; m++) for (const b of slots) reqs.push([year, m, b]);
  const views = await pool(reqs, ([y, m, b]) =>
    api(`/api/budget?year=${y}&month=${m}${b ? `&branch_id=${b}` : ""}`), 4);
  const budgets = [];
  views.forEach((v, i) => {
    if (!v.saved) return;
    const [y, m, b] = reqs[i];
    budgets.push({
      id: budgets.length + 1, branch_id: b, year: y, month: m,
      total_amount: v.total_amount, save_amount: v.save_amount,
      allocations: (v.allocations || []).map((a) => ({ name: a.name, percent: a.percent })),
      updated_at: "",
    });
  });

  let seq = 1;
  const tables = { branches, distributors, products, purchases: rows, income, credit_payments, budgets };
  for (const k in tables) for (const r of tables[k]) seq = Math.max(seq, Number(r.id) || 0);
  tables.seq = seq + 1;
  tables.version = 1;
  tables.created = new Date().toISOString().slice(0, 10);
  return envelope("server", tables);
}

/* ---------------- CSV ---------------- */
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (head, rows) =>
  [head.join(",")].concat(rows.map((r) => r.map(csvCell).join(","))).join("\r\n") + "\r\n";

async function buildCsv(kind) {
  if (kind === "income") {
    const rows = await fetchAll("/api/income");
    return toCsv(["date", "branch", "source", "amount", "reference", "memo"],
      rows.map((r) => [r.date, r.branch, r.source, r.amount, r.reference, r.memo]));
  }
  if (kind === "credits") {
    const c = await api("/api/credits");
    const rows = (c.open || []).concat(c.settled || []);
    return toCsv(
      ["date", "branch", "product", "distributor", "total", "paid", "balance",
       "percent", "payments", "memo"],
      rows.map((r) => [r.date, r.branch, r.product, r.distributor, r.total,
        r.paid, r.balance, r.percent,
        (r.payments || []).map((p) => `${p.date}:${p.amount}`).join(" | "), r.memo]));
  }
  const rows = await fetchAll("/api/purchases");
  return toCsv(
    ["date", "branch", "distributor", "product", "unit", "quantity", "unit_price",
     "total", "payment_method", "balance", "memo"],
    rows.map((p) => [p.date, p.branch, p.distributor, p.product, p.unit,
      p.quantity, p.unit_price, p.total, p.payment_method,
      p.credit ? p.credit.balance : "", p.memo]));
}

function downloadFile(name, mime, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    // detach only when the blob is revoked — removing the link synchronously
    // can cancel the download in some browsers
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
    return true;
  } catch (e) { return false; }
}

/* ---------------- restore ----------------
   Replay through the ordinary create paths. Records that are already present
   (same date, product, total and branch) are counted and left alone, so a
   restore is idempotent: running it twice changes nothing the second time. */
async function restoreBackup(data) {
  const prog = $("#data-progress");
  const say = (t) => { if (prog) prog.textContent = t; };
  const num = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const report = {
    branches: { added: 0, kept: 0 }, purchases: { added: 0, kept: 0 },
    income: { added: 0, kept: 0 }, budgets: { added: 0, kept: 0 },
    payments: { added: 0 }, errors: [],
  };
  const names = (rows) => {
    const m = {};
    for (const r of rows || []) if (r && r.id != null) m[r.id] = r.name || "";
    return m;
  };
  const bNames = names(data.branches), dNames = names(data.distributors);

  // 1. branches — a duplicate name is answered with 400, which is exactly the
  //    "already here" answer we need.
  const live = await api("/api/branches");
  const liveByName = {};
  for (const b of live.branches || []) liveByName[b.name] = b.id;
  const bMap = {};
  // a branch that did not make it into the backup keeps its raw id, and the
  // create path then answers 400 for it — reported, not hidden.
  const branchRef = (id) => (bMap[id] != null ? bMap[id] : id);
  let i = 0;
  for (const b of data.branches || []) {
    i += 1;
    say(`Checking branches… ${i}`);
    if (liveByName[b.name]) { bMap[b.id] = liveByName[b.name]; report.branches.kept += 1; continue; }
    try {
      const r = await api("/api/branches", { method: "POST", body: JSON.stringify({ name: b.name }) });
      bMap[b.id] = r.id;
      liveByName[b.name] = r.id;
      report.branches.added += 1;
    } catch (e) { report.errors.push(`branch “${b.name}”: ${e.message}`); }
  }

  // 2. purchases, oldest first, so every credit payment finds its balance ready
  const existing = await fetchAll("/api/purchases");
  const pKey = (date, product, total, branch) => `${date}|${product}|${num(total)}|${branch}`;
  const have = {}, existingId = {};
  for (const p of existing) {
    const k = pKey(p.date, p.product, p.total, p.branch);
    have[k] = (have[k] || 0) + 1;
    if (!(k in existingId)) existingId[k] = p.id;
  }
  const paysBy = {};
  for (const cp of data.credit_payments || []) {
    (paysBy[cp.purchase_id] = paysBy[cp.purchase_id] || []).push(cp);
  }
  const idMap = {}, addedIds = {};
  const incoming = (data.purchases || []).slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.id || 0) - (b.id || 0));
  i = 0;
  for (const p of incoming) {
    i += 1;
    if (i % 5 === 0 || i === incoming.length) say(`Restoring purchases… ${i}/${incoming.length}`);
    const branch = p.branch || bNames[p.branch_id] || "";
    const k = pKey(p.date, p.product_name, p.total_amount, branch);
    if (have[k] > 0) {
      have[k] -= 1;
      idMap[p.id] = existingId[k];
      report.purchases.kept += 1;
      continue;
    }
    try {
      const r = await api("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          date: p.date,
          branch_id: branchRef(p.branch_id),
          distributor: p.distributor || dNames[p.distributor_id] || "",
          product: p.product_name, unit: p.unit, quantity: p.quantity,
          total_amount: p.total_amount, payment_method: p.payment_method,
          memo: p.memo || "", credit_paid: p.credit_paid || 0,
        }),
      });
      idMap[p.id] = r.id;
      addedIds[p.id] = true;
      report.purchases.added += 1;
    } catch (e) { report.errors.push(`${p.date} “${p.product_name}”: ${e.message}`); }
  }

  // 3. the payments recorded against the purchases this run just added
  for (const p of incoming) {
    const to = idMap[p.id];
    if (!to || !addedIds[p.id]) continue;   // already here: its payments are too
    const pays = (paysBy[p.id] || []).slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const cp of pays) {
      try {
        await api(`/api/purchases/${to}/pay`, {
          method: "POST",
          body: JSON.stringify({ date: cp.date, amount: cp.amount, memo: cp.memo || "" }),
        });
        report.payments.added += 1;
      } catch (e) { report.errors.push(`payment on ${p.date}: ${e.message}`); }
    }
  }

  // 4. money in
  const incHave = {};
  for (const r of await fetchAll("/api/income")) {
    const k = `${r.date}|${r.source}|${num(r.amount)}|${r.reference || ""}`;
    incHave[k] = (incHave[k] || 0) + 1;
  }
  const income = (data.income || []).slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.id || 0) - (b.id || 0));
  i = 0;
  for (const r of income) {
    i += 1;
    if (i % 5 === 0 || i === income.length) say(`Restoring money in… ${i}/${income.length}`);
    const k = `${r.date}|${r.source}|${num(r.amount)}|${r.reference || ""}`;
    if (incHave[k] > 0) { incHave[k] -= 1; report.income.kept += 1; continue; }
    try {
      await api("/api/income", {
        method: "POST",
        body: JSON.stringify({
          date: r.date,
          branch_id: branchRef(r.branch_id),
          source: r.source, amount: r.amount,
          reference: r.reference || "", memo: r.memo || "",
        }),
      });
      report.income.added += 1;
    } catch (e) { report.errors.push(`${r.date} “${r.source}”: ${e.message}`); }
  }

  // 5. budgets — a slot that already holds one is left as it is
  const budgets = data.budgets || [];
  i = 0;
  for (const b of budgets) {
    i += 1;
    say(`Restoring budgets… ${i}/${budgets.length}`);
    try {
      const bid = branchRef(b.branch_id);
      const now = await api(`/api/budget?year=${b.year}&month=${b.month}${bid ? `&branch_id=${bid}` : ""}`);
      if (now.saved) { report.budgets.kept += 1; continue; }
      await api("/api/budget", {
        method: "POST",
        body: JSON.stringify({
          year: b.year, month: b.month, branch_id: bid,
          total_amount: b.total_amount, save_amount: b.save_amount,
          allocations: b.allocations || [],
        }),
      });
      report.budgets.added += 1;
    } catch (e) { report.errors.push(`budget ${b.year}-${b.month}: ${e.message}`); }
  }

  say("");
  return report;
}

function summarizeRestore(r) {
  const parts = [];
  const add = (label, s) => { if (s.added || s.kept) parts.push(`${label}: ${s.added} added, ${s.kept} already there`); };
  add("branches", r.branches);
  add("purchases", r.purchases);
  add("money in", r.income);
  add("budgets", r.budgets);
  if (r.payments.added) parts.push(`${r.payments.added} credit payments added`);
  return parts.join(" · ") || "nothing new to add";
}

/* ---------------- dialog ---------------- */
function openDataDialog() {
  const err = $("#data-err"), prog = $("#data-progress"), where = $("#data-where");
  if (err) err.textContent = "";
  if (prog) prog.textContent = "";
  if (where) {
    where.textContent = usingOfflineEngine()
      ? "Everything is saved on this device — there is no server behind it, so a backup file is your only copy. Keep one somewhere safe."
      : "Records live on the server. This backup is your own copy of them; restoring adds what is missing and never deletes.";
  }
  const dlg = $("#data-dialog");
  if (dlg && dlg.showModal) dlg.showModal();
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

  /* --- your data: backup, restore, CSV export --- */
  const openData = () => { closeMore(); openDataDialog(); };
  const dataMore = $("#btn-data-more");
  if (dataMore) dataMore.addEventListener("click", openData);
  const dataProfile = $("#btn-data-profile");
  if (dataProfile) dataProfile.addEventListener("click", openData);
  const storageAlarm = $("#storage-banner");
  if (storageAlarm) storageAlarm.addEventListener("click", openData);

  const backupBtn = $("#btn-backup");
  if (backupBtn) backupBtn.addEventListener("click", async () => {
    const err = $("#data-err"), prog = $("#data-progress");
    err.textContent = "";
    prog.textContent = "Building the backup…";
    try {
      const file = await buildBackup();
      const name = `pwbudget-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (!downloadFile(name, "application/json", JSON.stringify(file, null, 2)))
        throw new Error("this browser would not start the download — try once more");
      prog.textContent = `Saved ${name} · ${file.data.purchases.length} purchases, ` +
        `${file.data.income.length} money-in, ${file.data.branches.length} branches.`;
    } catch (e) { prog.textContent = ""; err.textContent = e.message; }
  });

  const restoreBtn = $("#btn-restore");
  if (restoreBtn) restoreBtn.addEventListener("click", () => {
    const inp = $("#data-file");
    if (inp) inp.click();
  });
  const dataFile = $("#data-file");
  if (dataFile) dataFile.addEventListener("change", async (ev) => {
    const input = ev.target;
    const file = input && input.files && input.files[0];
    if (!file) return;
    input.value = "";          // reset now: the same file must be choosable again,
                               // even if the user cancels or the parse throws
    const err = $("#data-err"), prog = $("#data-progress");
    err.textContent = "";
    prog.textContent = "Reading the backup…";
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed && parsed.kind === "backup" ? parsed.data : parsed;
      if (!confirm("Restore adds the records from this backup that aren't already here — nothing is deleted. Continue?")) {
        prog.textContent = "";
        return;
      }
      const report = await restoreBackup(data);
      prog.textContent = `Restored · ${summarizeRestore(report)}.`;
      if (report.errors.length) {
        err.textContent = report.errors.slice(0, 4).join(" · ") +
          (report.errors.length > 4 ? ` … +${report.errors.length - 4} more` : "");
      }
      await refreshMeta();
      switchView(state.view);
    } catch (e) { prog.textContent = ""; err.textContent = e.message; }
  });

  $$("[data-csv]").forEach((b) => b.addEventListener("click", async () => {
    const err = $("#data-err"), prog = $("#data-progress");
    err.textContent = "";
    prog.textContent = "Building the spreadsheet…";
    try {
      const kind = b.getAttribute("data-csv");
      const csv = await buildCsv(kind);
      const name = `pwbudget-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      if (!downloadFile(name, "text/csv;charset=utf-8", "\ufeff" + csv))
        throw new Error("this browser would not start the download — try once more");
      prog.textContent = `Saved ${name}`;
    } catch (e) { prog.textContent = ""; err.textContent = e.message; }
  }));
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
    AI.model = aiModel();   // never persist an id that belongs to another provider
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
    renderAgentStatus();
  });

  /* --- the assistant: open, speak, send, decide --- */
  const agentFab = $("#agent-fab");
  if (agentFab) agentFab.addEventListener("click", agentOpen);
  const agentMore = $("#btn-agent-more");
  if (agentMore) agentMore.addEventListener("click", () => { closeMore(); agentOpen(); });
  const agentSettings = $("#agent-settings");
  if (agentSettings) agentSettings.addEventListener("click", openAiDialog);
  const agentVoice = $("#agent-voice");
  if (agentVoice) agentVoice.addEventListener("click", agentToggleVoice);

  /* --- the chat view: sidebar drawer, section links, user menu --- */
  const chatBurger = $("#chat-burger");
  if (chatBurger) chatBurger.addEventListener("click", () => toggleChatSidebar());
  const chatCollapse = $("#chat-collapse");
  if (chatCollapse) chatCollapse.addEventListener("click", () => toggleChatSidebar());
  const chatScrim = $("#chat-scrim");
  if (chatScrim) chatScrim.addEventListener("click", () => toggleChatSidebar(false));
  const chatLinks = $("#chat-links");
  if (chatLinks) chatLinks.addEventListener("click", (e) => {
    const t = e.target;
    const which = t && t.getAttribute ? t.getAttribute("data-clink") : null;
    if (!which) return;
    showChatPane(which);
    if (which === "projects") {
      const sec = $("#chat-projects-sec");
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "nearest" });
    }
    if (isMobileChat()) toggleChatSidebar(false);
  });
  const chatUserBtn = $("#chat-user-btn");
  if (chatUserBtn) chatUserBtn.addEventListener("click", (e) => {
    if (e.stopPropagation) e.stopPropagation();
    const m = $("#chat-user-menu");
    if (m) m.classList.toggle("hidden");
    chatUserBtn.setAttribute("aria-expanded",
      m && !m.classList.contains("hidden") ? "true" : "false");
  });
  const chatUserMenu = $("#chat-user-menu");
  if (chatUserMenu) chatUserMenu.addEventListener("click", (e) => {
    const t = e.target;
    const act = t && t.getAttribute ? t.getAttribute("data-umenu") : null;
    if (!act) return;
    chatUserMenu.classList.add("hidden");
    if (act === "settings") openAiDialog();
    else if (act === "data") openDataDialog();
    else if (act === "theme") toggleTheme();
  });
  document.addEventListener("click", () => {
    const m = $("#chat-user-menu");
    if (m && !m.classList.contains("hidden")) m.classList.add("hidden");
    closeRowMenu();
  });
  if (window.addEventListener) {
    window.addEventListener("beforeunload", () => saveAgent());
  }

  /* --- chats: new, search, rows, projects, the row menu --- */
  const chatNew = $("#chat-new");
  if (chatNew) chatNew.addEventListener("click", () => {
    agentNewSession();
    showChatPane("chats");
    const i = $("#agent-input");
    if (i && i.focus) i.focus();
  });
  const chatSearch = $("#chat-search");
  if (chatSearch) chatSearch.addEventListener("input", () => {
    CHAT_SEARCH = chatSearch.value || "";
    renderSidebar();
  });
  const chatRecents = $("#chat-recents");
  if (chatRecents) chatRecents.addEventListener("click", (e) => {
    const t = e.target;
    const menuId = closestAttr(t, "data-cmenu");
    if (menuId) {
      if (e.stopPropagation) e.stopPropagation();
      openRowMenu(Number(menuId), t);
      return;
    }
    const sid = closestAttr(t, "data-csid");
    if (sid) {
      agentSwitchSession(Number(sid));
      if (isMobileChat()) toggleChatSidebar(false);
    }
  });
  const chatRowMenu = $("#chat-row-menu");
  if (chatRowMenu) chatRowMenu.addEventListener("click", (e) => {
    if (e.stopPropagation) e.stopPropagation();
    runRowMenuAction(e.target);
  });
  const chatProjects = $("#chat-projects");
  if (chatProjects) chatProjects.addEventListener("click", (e) => {
    const del = closestAttr(e.target, "data-cprojdel");
    if (del) {
      if (e.stopPropagation) e.stopPropagation();
      if (typeof confirm === "undefined"
          || confirm("Delete this project? Its chats stay.")) {
        agentDeleteProject(Number(del));
      }
      return;
    }
    const pid = closestAttr(e.target, "data-cproj");
    if (pid) {
      PROJ_FILTER = PROJ_FILTER === Number(pid) ? null : Number(pid);
      renderSidebar();
    }
  });
  const chatNewProject = $("#chat-new-project");
  if (chatNewProject) chatNewProject.addEventListener("click", (e) => {
    if (e.stopPropagation) e.stopPropagation();
    if (typeof prompt !== "function") return;
    const name = prompt("New project name", "");
    if (name && name.trim()) agentAddProject(name.trim());
  });
  const agentMicBtn = $("#agent-mic");
  if (agentMicBtn) agentMicBtn.addEventListener("click", agentMic);
  const agentAttach = $("#agent-attach-btn");
  if (agentAttach) agentAttach.addEventListener("click", () => {
    const f = $("#agent-file");
    if (f) f.click();
  });
  const agentFile = $("#agent-file");
  if (agentFile) agentFile.addEventListener("change", async (ev) => {
    const input = ev.target;
    const file = input && input.files && input.files[0];
    input.value = "";              // the same file must be choosable again
    if (file) await agentAttach(file);
  });

  const agentForm = $("#agent-form");
  if (agentForm) agentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const i = $("#agent-input");
    agentSend(i ? i.value : "");
  });
  const agentInput = $("#agent-input");
  if (agentInput) {
    agentInput.addEventListener("input", agentAutogrow);
    agentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const f = $("#agent-form");
        if (f && f.requestSubmit) f.requestSubmit();
        else agentSend(e.target.value);
      }
    });
  }

  /* Every button inside the conversation is reached through this one
     listener: the list is rebuilt on every message, so per-button binds
     would be lost after the first reply. */
  const agentMsgs = $("#agent-msgs");
  if (agentMsgs) agentMsgs.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const chip = t.closest("[data-agent-chip]");
    if (chip) { agentSend(chip.getAttribute("data-agent-chip")); return; }
    const act = t.closest("[data-agent-act]");
    if (!act) return;
    const kind = act.getAttribute("data-agent-act");
    if (kind === "approve" || kind === "deny")
      agentDecide(act.getAttribute("data-aid"), kind === "approve");
    else if (kind === "approve-all") agentApproveAll(act.getAttribute("data-mid"));
    else if (kind === "retry") agentRetry(Number(act.getAttribute("data-mid")));
    else if (kind === "open-ai") openAiDialog();
    else if (kind === "speak") agentSpeak(act.getAttribute("data-mid"));
    else if (kind === "download") {
      const f = AGENT_FILES[act.getAttribute("data-fid")];
      if (f) { if (downloadFile(f.name, f.mime, f.bytes)) toast("⤓ " + f.name); else toast("This browser blocked the download", "err"); }
      else toast("Ask me to build it again", "err");
    }
  });

  const journalList = $("#journal-list");
  if (journalList) journalList.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const u = t.closest("[data-journal-undo]");
    if (!u) return;
    agentUndo(Number(u.getAttribute("data-journal-undo")));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isMobileChat()) toggleChatSidebar(false);
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
  renderStorageBanner();   // a store that refused a write says so from the start
  renderAiStrip();
  loadAgent();             // conversation + change log live on this device only
  renderAgentStatus();
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
    const VIEWS = ["dashboard", "purchases", "income", "credits", "analytics", "budget", "branches", "chat"];
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

window.PWApp = {
  get state() { return state; },
  get AGENT() { return AGENT; },
  api, offlineRequest, toast, cur, esc, monthName,
  switchView, aiAllows, aiConfigured, aiBase,
  snapshotBudget, renderBudgetBody, saveBudget, loadBudget,
  refreshMeta, openAiDialog, agentJournal, saveAgent, renderJournal,
};