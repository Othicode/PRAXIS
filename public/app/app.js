/* ============ PW Budget - frontend ============ */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const COLORS = {
  spend: "#c9971f", credit: "#f87171", paid: "#34d399",
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
  budget: { year: null, month: null, rows: [] },
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

function offlineRequest(method, pathname, qs, body) {
  if (typeof PWDB === "undefined") throw new Error("offline engine not available in this browser");
  const r = PWDB.request(method, pathname, qs, body);
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
    return offlineRequest(method, u.pathname, qs, body);
  }

  let res = null, netError = null;
  try { res = await fetch(path, opts); }
  catch (e) { netError = e; }

  // Network failure (offline, host down) -> run on this device.
  if (netError) return serverDown(path, method, u, qs, body);

  // Our server always answers /api/* with application/json (even errors).
  // Anything else (404 HTML, SPA fallback page) means there is no real
  // backend here -> fall back to the offline engine instead of failing.
  const ct = res.headers.get("content-type") || "";
  if (path.startsWith("/api/") && !ct.includes("application/json")) {
    return serverDown(path, method, u, qs, body);
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
    { c: "red", label: "Outstanding credit", value: cur(creds.outstanding),
      sub: `${creds.open_count} unpaid account${creds.open_count === 1 ? "" : "s"}` },
    { c: "green", label: "Budget left to spend", value: remaining !== null ? cur(remaining) : "—",
      sub: budget.saved ? `of ${cur(budget.spendable)} after savings` : "set a budget in 🎯 Budget" },
  ];
  $("#kpis").innerHTML = kpis.map((k) => `
    <div class="kpi ${k.c}">
      <div class="k-label">${k.label}</div>
      <div class="k-value">${k.value}</div>
      <div class="k-sub">${k.sub}</div>
    </div>`).join("");

  $("#legend-flow").innerHTML = legend([
    ["Spend", COLORS.spend], ["New credit", COLORS.credit],
  ]);
  $("#chart-flow").innerHTML = groupedBars(
    months.map((m) => monthLabel(m.month)),
    [
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
  if (more) more.classList.toggle("active", view === "budget" || view === "branches");
  closeMore();
  try {
    if (view === "dashboard") await loadDashboard();
    else if (view === "purchases") await loadPurchases();
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
  $("#filter-dist").innerHTML = `<option value="">All distributors</option>` +
    (META.distributor_options || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  $("#filter-product").innerHTML = `<option value="">All items</option>` +
    (META.product_options || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  // re-apply current selection so a refresh (after save/delete) keeps the filters
  $("#filter-month").value = f.month || "";
  $("#filter-dist").value = f.dist || "";
  $("#filter-product").value = f.product || "";
}

function populateBranches() {
  const opts = META.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("#branch-select").innerHTML = `<option value="">All branches</option>` + opts;
  $("#f-branch").innerHTML = opts;
  if (state.branch_id) {
    $("#branch-select").value = state.branch_id;
    $("#f-branch").value = state.branch_id;
  } else if (META.branches.length) {
    $("#f-branch").value = META.branches[0].id;
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
    $("#entry-dialog").close();
    refreshMeta();
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
  applyTheme(currentTheme(), false);
  renderProfile();
  renderWelcome();
  populateDatalists();
  populateFilters();
  populateBranches();
  bindAll();
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
    const VIEWS = ["dashboard", "purchases", "credits", "analytics", "budget", "branches"];
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
      toks.push({ t: "num", v: parseFloat(S.slice(i, j)) });
      i = j;
    } else if ("+-×÷".includes(c)) { toks.push({ t: "op", v: c }); i++; }
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
    let v = unary();
    if (peek() && peek().t === "op" && peek().v === "^") { take(); return Math.pow(v, unary()); }
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