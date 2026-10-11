(function () {
  "use strict";

  const VOICE_PREFS_KEY = "pwbudget.voice.v1";
  const VOICE_CONSENT_KEY = "pwbudget.voice.mic.v1";

  const VOICE_LANGS = {
    en: {
      label: "English", stt: "en",
      nums: {
        connectives: { and: 1 },
        articles: { a: 1, an: 1 },
        units: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 },
        tens: {
          ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
          sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
          twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
          seventy: 70, eighty: 80, ninety: 90,
        },
        scales: [
          { w: ["hundred"], v: 100, dir: "suffix" },
          { w: ["thousand"], v: 1000, dir: "suffix" },
          { w: ["million"], v: 1000000, dir: "suffix" },
        ],
      },
    },
    fr: {
      label: "Français", stt: "fr",
      nums: {
        connectives: { et: 1 },
        units: { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9 },
        tens: {
          dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
          vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
        },
        scales: [
          { w: ["cent", "cents"], v: 100, dir: "suffix" },
          { w: ["mille"], v: 1000, dir: "suffix" },
          { w: ["million", "millions"], v: 1000000, dir: "suffix" },
        ],
        twentyMul: true,
      },
    },
    tw: {
      label: "Twi", stt: "tw",
      nums: {
        connectives: { ne: 1 },
        units: {
          baako: 1, koro: 1, mmienu: 2, abien: 2, mmiensa: 3, abiasa: 3,
          nan: 4, enan: 4, anan: 4, enum: 5, num: 5, anum: 5,
          nsia: 6, asia: 6, nson: 7, asuon: 7, nwotwe: 8, awotwe: 8,
          nkron: 9, akron: 9,
        },
        tens: {
          du: 10, dubaako: 11, dumienu: 12, dumiensa: 13, dunan: 14, dunum: 15,
          dunsia: 16, dunson: 17, dunwotwe: 18, dunkron: 19,
          aduonu: 20, aduasa: 30, aduanan: 40, aduonum: 50, aduenum: 50,
          aduosia: 60, adunsia: 60, aduoson: 70, adunson: 70,
          aduowotwe: 80, adunwotwe: 80, aduokron: 90, adunkron: 90,
        },
        atoms: { ahanu: 200, ahasa: 300, ahanan: 400, ahanum: 500 },
        scales: [
          { w: ["ɔha", "oha"], v: 100, dir: "prefix", mul: [1, 9] },
          { w: ["apem"], v: 1000, dir: "prefix", mul: [1, 9] },
        ],
      },
    },
    ga: {
      label: "Ga", stt: "ga",
      nums: {
        connectives: { kɛ: 1, ke: 1 },
        units: {
          kome: 1, ekome: 1, enyo: 2, ete: 3, ejwe: 4, enumo: 5, ekpaa: 6,
          kpawo: 7, kpaanyo: 8, neehu: 9,
        },
        tens: { nyonma: 10 },
        scales: [
          { w: ["ɔha", "oha"], v: 100, dir: "prefix", mul: [1, 9] },
          { w: ["ohai"], v: 100, dir: "prefix", mul: [1, 9] },
          { w: ["akpe"], v: 1000, dir: "prefix", mul: [1, 10] },
          { w: ["akpei"], v: 1000, dir: "prefix", mul: [1, 10] },
          { w: ["nyonmai", "nyonmais"], v: 10, dir: "prefix", mul: [1, 9] },
          { w: ["milio"], v: 1000000, dir: "suffix" },
        ],
      },
    },
    ee: {
      label: "Ewe", stt: "ee",
      nums: {
        connectives: { kple: 1 },
        units: {
          deka: 1, eve: 2, eto: 3, ene: 4, ato: 5, ade: 6, adre: 7, enyi: 8, asieke: 9,
        },
        tens: {
          ewo: 10, wui: 10,
          blaeve: 20, blaeto: 30, blaene: 40, blaato: 50, blaade: 60,
          blaadre: 70, blaenyi: 80, blaasieke: 90,
          wuideke: 11, wuieve: 12, wuieto: 13, wuiene: 14, wuiato: 15,
          wuiade: 16, wuiadre: 17, wuienyi: 18, wuiasieke: 19,
        },
        scales: [
          { w: ["alafa"], v: 100, dir: "prefix", mul: [1, 9] },
          { w: ["akpe"], v: 1000, dir: "prefix", mul: [1, 10] },
          { w: ["miliɔn", "milion"], v: 1000000, dir: "suffix" },
        ],
      },
    },
    ha: {
      label: "Hausa", stt: "ha",
      nums: {
        connectives: { da: 1, sha: 1 },
        units: {
          daya: 1, biyu: 2, uku: 3, hudu: 4, fudu: 4, biyar: 5, shida: 6, shidda: 6,
          bakwai: 7, takwas: 8, tokwas: 8, tara: 9,
        },
        tens: {
          goma: 10, ashirin: 20, ishirin: 20, talatin: 30, arbain: 40, hamsin: 50,
          sittin: 60, sabain: 70, tamanin: 80, tisin: 90, tasani: 90,
        },
        scales: [
          { w: ["ɗari", "dari"], v: 100, dir: "prefix", mul: [1, 9] },
          { w: ["dubu"], v: 1000, dir: "prefix", mul: [1, 9] },
          { w: ["miliyan"], v: 1000000, dir: "suffix" },
        ],
      },
    },
  };

  const VOICE_OPS = {
    add_item: ["name", "amount"],
    update_item: ["name", "amount"],
    delete_item: ["name", "confirm"],
    set_total: ["amount", "save"],
    add_note: ["text"],
    ask_clarification: ["question"],
  };

  const VOICE_STR = {
    en: {
      think: "Thinking…",
      idle: "Say it or type it — nothing changes until it is checked.",
      offline: "I could not reach the model just now — please try again.",
      empty: "Say or type something first.",
      consent: "The microphone stays on this device — tap it again to start.",
      micNone: "No microphone here — type your request instead.",
      micDenied: "The microphone was refused — allow it in your browser, or type instead.",
      listening: "Listening…",
      recording: "Recording — tap the microphone again when you are done.",
      applied: "Applied — tap ↩ Undo if that was wrong.",
      undone: "Brought back — the budget is as it was.",
      gate: "That change needs the App settings coverage — turn it on under Settings › AI.",
      cant: "I cannot apply that —",
      declined: "Nothing changed — you declined.",
      needTotal: "Set a total budget first, then ask me again.",
      undoLabel: "Undo",
    },
    fr: {
      think: "Réflexion…",
      idle: "Dites-le ou écrivez-le — rien ne change avant vérification.",
      offline: "Je n'ai pas pu joindre le modèle — veuillez réessayer.",
      empty: "Dites ou écrivez d'abord quelque chose.",
      consent: "Le micro reste sur cet appareil — touchez-le encore pour commencer.",
      micNone: "Pas de micro ici — écrivez plutôt votre demande.",
      micDenied: "Le micro a été refusé — autorisez-le dans le navigateur, ou écrivez.",
      listening: "À l'écoute…",
      recording: "Enregistrement — touchez le micro encore quand vous avez fini.",
      applied: "Appliqué — touchez ↩ Annuler si c'était une erreur.",
      undone: "Restauré — le budget est comme avant.",
      gate: "Ce changement demande la couverture Paramètres › Application — activez-la dans Paramètres › IA.",
      cant: "Je ne peux pas appliquer —",
      declined: "Rien n'a changé — vous avez refusé.",
      needTotal: "Définissez d'abord un budget total, puis redemandez.",
      undoLabel: "Annuler",
    },
  };

  const VOICE = {
    open: false, inited: false, asking: false,
    lang: "en", tts: false, wake: false,
    history: [], pending: [], transcript: "", reply: "",
    amounts: [], undo: null,
    mic: null, sr: null, rec: null, consentPending: false,
    whisperCancel: false, micError: "",
  };

  const $ = (s) => (typeof document !== "undefined" && document ? document.querySelector(s) : null);
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const str = (k) => (VOICE_STR[VOICE.lang] && VOICE_STR[VOICE.lang][k]) || VOICE_STR.en[k] || "";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function voiceNorm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[\u025b\u0259\u01dd]/g, "e")
      .replace(/\u0254/g, "o")
      .replace(/[\u0256\u0257]/g, "d")
      .replace(/\u014b/g, "n")
      .replace(/\u0269/g, "i")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2018\u2019\u02bc\u0060']/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function voiceWords(t) {
    return voiceNorm(t).match(/[a-z0-9]+(?:[.,][0-9]+)*/g) || [];
  }

  function voiceDigits(raw) {
    const out = [];
    const re = /\d+(?:,\d{3})*(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(String(raw || "")))) {
      const v = parseFloat(m[0].replace(/,/g, ""));
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  }

  function voiceLexOf(L) {
    if (L._map) return L._map;
    const m = {};
    const put = (w, o) => {
      const k = voiceNorm(w);
      if (k && !m[k]) m[k] = o;
    };
    const N = L.nums;
    Object.keys(N.units || {}).forEach((w) => put(w, { k: "num", v: N.units[w] }));
    Object.keys(N.tens || {}).forEach((w) => put(w, { k: "num", v: N.tens[w] }));
    Object.keys(N.atoms || {}).forEach((w) => put(w, { k: "num", v: N.atoms[w] }));
    Object.keys(N.connectives || {}).forEach((w) => put(w, { k: "conn" }));
    (N.scales || []).forEach((s) => s.w.forEach((w) =>
      put(w, { k: "scale", v: s.v, dir: s.dir, mul: s.mul || [1, 9] })));
    L._map = m;
    return m;
  }

  function voiceWalk(seg, L) {
    const twentyMul = !!(L.nums && L.nums.twentyMul);
    let total = 0, cur = 0, pending = null, afterConn = false;
    for (const c of seg) {
      if (c.k === "conn") { afterConn = true; continue; }
      if (pending) {
        const mulable = c.k === "num" && !afterConn &&
          c.v >= pending.mul[0] && c.v <= pending.mul[1];
        if (mulable) {
          total += pending.v * c.v;
          pending = null;
          afterConn = false;
          continue;
        }
        total += pending.v;
        pending = null;
      }
      afterConn = false;
      if (c.k === "scale") {
        if (c.dir === "suffix") {
          if (c.v >= 1000) { total += (cur || 1) * c.v; cur = 0; }
          else cur = (cur || 1) * c.v;
        } else {
          pending = { v: c.v, mul: c.mul };
        }
        continue;
      }
      if (twentyMul && c.v === 20 && cur === 4) { cur = 80; continue; }
      cur = cur ? cur + c.v : c.v;
    }
    if (pending) total += pending.v;
    total += cur;
    return total;
  }

  function voiceParseNumbers(text, lang) {
    const L = VOICE_LANGS[lang] || VOICE_LANGS.en;
    const map = voiceLexOf(L);
    const out = voiceDigits(text);
    const words = voiceWords(text);
    const articles = (L.nums && L.nums.articles) || {};
    const cls = words.map((w, i) => {
      if (/^\d/.test(w)) {
        const v = parseFloat(w.replace(/,/g, ""));
        return Number.isFinite(v) ? { k: "num", v } : { k: "other" };
      }
      const c = map[w];
      if (c) return c;
      if (articles[w]) {
        const nxt = words[i + 1];
        if (nxt && map[nxt] && map[nxt].k === "scale") return { k: "num", v: 1 };
      }
      return { k: "other" };
    });
    let i = 0;
    while (i < words.length) {
      if (cls[i].k === "other") { i++; continue; }
      let j = i;
      while (j < words.length && cls[j].k !== "other") j++;
      while (j > i && cls[j - 1].k === "conn") j--;
      if (j > i) {
        const v = voiceWalk(cls.slice(i, j), L);
        if (v) out.push(v);
      }
      i = Math.max(j, i + 1);
    }
    const seen = new Set();
    const res = [];
    for (const v of out) {
      const r = Math.round(v * 100) / 100;
      if (!seen.has(r)) { seen.add(r); res.push(r); }
    }
    return res.slice(0, 24);
  }

  function voiceParseReply(raw) {
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
        if (inStr) {
          if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
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
      for (let i = 0; i <= 8 && t && !obj; i++) {
        obj = parse(t);
        if (obj) break;
        const n = t.replace(/[}\]\s`]$/, "");
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
        for (const a of obj.actions) {
          if (!a || typeof a !== "object") continue;
          const op = String(a.op || "");
          const fields = VOICE_OPS[op];
          if (!fields) continue;
          const act = { op };
          for (const f of fields) {
            if (a[f] === undefined) continue;
            if (f === "amount" || f === "save") act[f] = Number(a[f]);
            else if (f === "confirm") act[f] = !!a[f];
            else act[f] = String(a[f]);
          }
          out.actions.push(act);
        }
      }
    }
    if (!out.reply) out.reply = "…";
    return out;
  }

  function voiceValidateBatch(actions, amounts, opts) {
    opts = opts || {};
    const list = (Array.isArray(actions) ? actions : [])
      .filter((a) => a && VOICE_OPS[a.op]);
    const rows = (Array.isArray(opts.rows) ? opts.rows : [])
      .map((r) => String((r && r.name) || ""))
      .filter(Boolean);
    const issues = [];
    if (list.length > 6) issues.push("more than 6 actions");
    const ask = list.find((a) => a.op === "ask_clarification");
    if (ask) {
      if (!String(ask.question || "").trim()) issues.push("empty clarification");
      return issues.length
        ? { ok: false, actions: [], issues }
        : { ok: true, actions: [ask], issues: [] };
    }
    const spoken = (Array.isArray(amounts) ? amounts : []).map(Number)
      .filter((n) => Number.isFinite(n));
    const said = (v) => spoken.some((a) => Math.abs(a - v) < 0.005);
    const findRow = (name) => {
      const n = voiceNorm(name);
      if (!n) return null;
      return rows.find((r) => voiceNorm(r) === n) ||
        rows.find((r) => voiceNorm(r).includes(n) || n.includes(voiceNorm(r))) ||
        null;
    };
    for (const a of list) {
      if (a.op === "add_item" || a.op === "update_item" || a.op === "set_total") {
        const v = Number(a.amount);
        if (a.amount == null || a.amount === "" || !Number.isFinite(v)) {
          issues.push(a.op + " needs an amount");
        } else if (!spoken.length) {
          issues.push("no amount was spoken for " + a.op);
        } else if (!said(v)) {
          issues.push("amount " + v + " was not spoken");
        }
      }
      if (a.op === "add_item" || a.op === "update_item" || a.op === "delete_item") {
        const name = String(a.name || "").trim();
        if (!name) issues.push(a.op + " needs a name");
        else if (a.op !== "add_item" && !findRow(name)) issues.push("no item named " + name);
      }
      if (a.op === "add_note" && !String(a.text || "").trim()) issues.push("empty note");
      if (a.op === "delete_item" || a.op === "set_total") {
        if (typeof a.confirm !== "boolean") a.confirm = false;
      }
    }
    return { ok: !issues.length, actions: issues.length ? [] : list, issues };
  }

  function voicePrefs() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || "{}") || {}; } catch (e) { o = {}; }
    return {
      lang: typeof o.lang === "string" && VOICE_LANGS[o.lang] ? o.lang : "en",
      tts: !!o.tts,
      wake: !!o.wake,
    };
  }

  function voiceSavePrefs(p) {
    try {
      localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({
        lang: (p && p.lang) || "en", tts: !!(p && p.tts), wake: !!(p && p.wake),
      }));
    } catch (e) { /* private mode */ }
  }

  function voiceSetLang(l) {
    if (!VOICE_LANGS[l]) return VOICE.lang;
    VOICE.lang = l;
    const p = voicePrefs();
    p.lang = l;
    voiceSavePrefs(p);
    const sel = $("#voice-lang");
    if (sel && sel.value !== l) sel.value = l;
    return l;
  }

  function setStatus(t) {
    const n = $("#voice-note");
    if (n) n.textContent = t;
  }

  function renderTranscript(t) {
    const el = $("#voice-transcript");
    if (el) el.textContent = t || "";
  }

  function renderReply(t) {
    const el = $("#voice-reply");
    if (el) el.textContent = t || "";
  }

  function voiceChipLabel(a) {
    const A = (typeof window !== "undefined" && window) ? window.PWApp : null;
    const money = (v) => {
      const n = Number(v);
      if (A && A.cur) return A.cur(n);
      return "GH₵" + n;
    };
    if (!a) return "";
    if (a.op === "add_item") return "＋ " + String(a.name || "") + " · " + money(a.amount);
    if (a.op === "update_item") return "✎ " + String(a.name || "") + " · " + money(a.amount);
    if (a.op === "delete_item") return "✕ " + String(a.name || "");
    if (a.op === "set_total") return "Σ " + money(a.amount);
    if (a.op === "add_note") return "✎ " + String(a.text || "").slice(0, 40);
    if (a.op === "ask_clarification") return "? " + String(a.question || "").slice(0, 60);
    return String(a.op || "");
  }

  function voiceRenderChips(actions, amounts) {
    VOICE.pending = Array.isArray(actions) ? actions : [];
    if (Array.isArray(amounts))
      VOICE.amounts = amounts.map(Number).filter((n) => Number.isFinite(n));
    const c = $("#voice-chips");
    if (!c) return;
    const chips = VOICE.pending.map((a, i) => {
      const done = !!(a && a._done);
      return `<button type="button" class="voice-chip${done ? " applied" : ""}" data-vi="${i}"${done ? " disabled" : ""}>${h((done ? "✓ " : "") + voiceChipLabel(a))}</button>`;
    });
    if (VOICE.undo)
      chips.push(`<button type="button" class="voice-chip voice-undo" data-vi="undo">↩ ${h(str("undoLabel"))}</button>`);
    c.innerHTML = chips.join("");
  }

  function voiceOpen() {
    voiceInit();
    VOICE.open = true;
    const p = $("#voice-panel");
    if (p) { p.classList.add("open"); p.setAttribute("aria-hidden", "false"); }
    const fab = $("#voice-fab");
    if (fab) fab.classList.add("active");
    if (typeof document !== "undefined" && document && document.body)
      document.body.classList.add("voice-open");
    setStatus(str("idle"));
    setTimeout(() => { const t = $("#voice-text"); if (t && t.focus) t.focus(); }, 60);
  }

  function voiceClose() {
    voiceMicStop(true);
    VOICE.open = false;
    const p = $("#voice-panel");
    if (p) { p.classList.remove("open"); p.setAttribute("aria-hidden", "true"); }
    const fab = $("#voice-fab");
    if (fab) fab.classList.remove("active");
    if (typeof document !== "undefined" && document && document.body)
      document.body.classList.remove("voice-open");
  }

  function voiceToggle() {
    if (VOICE.open) voiceClose();
    else voiceOpen();
    return VOICE.open;
  }

  function voiceHotkey(e) {
    if (!e) return false;
    if (e.key === " " && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      if (e.preventDefault) e.preventDefault();
      voiceToggle();
      return true;
    }
    if (e.key === "Escape" && VOICE.open) {
      voiceClose();
      if (e.stopPropagation) e.stopPropagation();
      return true;
    }
    return false;
  }

  function voicePost(payload) {
    const A = (typeof window !== "undefined" && window) ? window.PWApp : null;
    if (!A) return Promise.resolve(null);
    if (A.aiConfigured() && typeof PWDB !== "undefined") {
      return A.offlineRequest("POST", "/api/ai/voice", {}, payload);
    }
    return A.api("/api/ai/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function voiceAsk(text) {
    const A = (typeof window !== "undefined" && window) ? window.PWApp : null;
    const t = String(text || "").trim();
    if (!t) { setStatus(str("empty")); return null; }
    if (VOICE.mic) voiceMicStop(true);
    if (!A || VOICE.asking) return null;
    VOICE.asking = true;
    VOICE.transcript = t;
    renderTranscript(t);
    renderReply("");
    voiceRenderChips([]);
    setStatus(str("think"));
    try {
      const amounts = voiceParseNumbers(t, VOICE.lang);
      const snap = A.snapshotBudget() || {};
      const base = {
        transcript: t,
        lang: VOICE.lang,
        snapshot: snap,
        history: VOICE.history.slice(-6),
      };
      let last = { reply: "", actions: [] };
      let issues = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const payload = attempt
          ? Object.assign({}, base, {
              history: base.history.concat([{
                role: "system",
                content: "Rejected: " + issues.join("; ") +
                  ". Reply again with a corrected JSON object.",
              }]),
            })
          : base;
        let r = null;
        try { r = await voicePost(payload); } catch (e) { r = null; }
        if (!r || !r.source) {
          try { await sleep(1200); r = await voicePost(payload); } catch (e) { r = null; }
        }
        if (!r || !r.source) {
          last = { reply: str("offline"), actions: [] };
          break;
        }
        const out = voiceParseReply(r.text);
        const res = voiceValidateBatch(out.actions, amounts, {
          rows: snap.allocations || [],
        });
        if (res.ok) { last = { reply: out.reply, actions: res.actions }; break; }
        last = { reply: out.reply, actions: [] };
        issues = res.issues;
        if (!out.actions.length) break;
        if (attempt === 1) break;
      }
      VOICE.history.push({ role: "user", content: t }, { role: "assistant", content: last.reply });
      if (VOICE.history.length > 12) VOICE.history = VOICE.history.slice(-12);
      VOICE.reply = last.reply;
      renderReply(last.reply);
      voiceRenderChips(last.actions, amounts);
      setStatus(str("idle"));
      voiceSpeak(last.reply);
      return last;
    } finally {
      VOICE.asking = false;
    }
  }

  async function voiceApply(i) {
    const A = voiceApp();
    const a = VOICE.pending[i];
    if (!A || !a || a._done) return false;
    if (a.op === "ask_clarification") {
      const box = $("#voice-text");
      if (box && box.focus) box.focus();
      return false;
    }
    if (!A.aiAllows("app")) { setStatus(str("gate")); return false; }
    const snap = A.snapshotBudget() || {};
    const rows = Array.isArray(snap.allocations) ? snap.allocations : [];
    const res = voiceValidateBatch([a], VOICE.amounts, { rows });
    if (!res.ok) { setStatus(str("cant") + " " + res.issues.join("; ")); return false; }
    const act = res.actions[0];
    if (act.op === "delete_item" || act.op === "set_total") {
      const msg = act.op === "delete_item"
        ? "Remove \u201C" + act.name + "\u201D from this month's budget?"
        : "Set the total budget to " + A.cur(Number(act.amount)) + "?";
      if (typeof confirm === "function" && !confirm(msg)) {
        setStatus(str("declined"));
        return false;
      }
    }
    const total = Number(snap.total_amount) || 0;
    const save = Number(snap.save_amount) || 0;
    const before = { total, save, rows: JSON.parse(JSON.stringify(rows)) };
    const spendable = Math.max(total - save, 0);
    if (act.op === "add_item" || act.op === "update_item") {
      if (spendable <= 0) { setStatus(str("needTotal")); return false; }
      const pct = Math.round((Number(act.amount) / spendable) * 10000) / 100;
      const n = voiceNorm(act.name);
      const hit = rows.find((r) => voiceNorm(r && r.name) === n);
      if (hit) hit.percent = pct;
      else rows.push({ name: String(act.name), percent: pct, actual: 0 });
    } else if (act.op === "delete_item") {
      const n = voiceNorm(act.name);
      let idx = rows.findIndex((r) => voiceNorm(r && r.name) === n);
      if (idx < 0) idx = rows.findIndex((r) => {
        const rn = voiceNorm(r && r.name);
        return rn.includes(n) || n.includes(rn);
      });
      if (idx >= 0) rows.splice(idx, 1);
    } else if (act.op === "set_total") {
      A.state.budget.baseTotal = Number(act.amount);
      if (Number.isFinite(Number(act.save))) A.state.budget.baseSave = Number(act.save);
    }
    a._done = true;
    if (act.op !== "add_note") {
      VOICE.undo = { rows: before.rows, total: before.total, save: before.save };
      A.renderBudgetBody(A.snapshotBudget());
      await A.saveBudget();
    }
    const after = {
      total: Number(A.state.budget.baseTotal) || 0,
      save: Number(A.state.budget.baseSave) || 0,
      rows: rows.map((r) => [r.name, Number(r.percent) || 0]),
    };
    A.agentJournal("voice", voiceChipLabel(a),
      act.op === "add_note" ? String(act.text)
        : `total ${after.total} · save ${after.save} · ${after.rows.length} allocations`,
      act.op === "add_note"
        ? { before: null, after: { text: String(act.text) }, inverse: null }
        : { before: { total: before.total, save: before.save,
                      rows: before.rows.map((r) => [r.name, Number(r.percent) || 0]) },
            after, inverse: null });
    A.renderJournal();
    voiceRenderChips(VOICE.pending);
    setStatus(str("applied"));
    return true;
  }

  async function voiceUndo() {
    const A = voiceApp();
    const u = VOICE.undo;
    if (!A || !u) return false;
    if (!A.aiAllows("app")) { setStatus(str("gate")); return false; }
    const snap = A.snapshotBudget() || {};
    A.state.budget.rows = u.rows;
    A.state.budget.baseTotal = u.total;
    A.state.budget.baseSave = u.save;
    VOICE.undo = null;
    A.renderBudgetBody(A.snapshotBudget());
    await A.saveBudget();
    A.agentJournal("voice", "\u21A9 " + str("undoLabel"),
      `total ${u.total} · save ${u.save} · ${u.rows.length} allocations`,
      { before: { total: Number(snap.total_amount) || 0, save: Number(snap.save_amount) || 0,
                  rows: (snap.allocations || []).map((r) => [r.name, Number(r.percent) || 0]) },
        after: { total: u.total, save: u.save,
                 rows: u.rows.map((r) => [r.name, Number(r.percent) || 0]) },
        inverse: null });
    A.renderJournal();
    voiceRenderChips(VOICE.pending);
    setStatus(str("undone"));
    return true;
  }

  function voiceApp() {
    return (typeof window !== "undefined" && window) ? window.PWApp : null;
  }

  function voiceWindow() {
    return (typeof window !== "undefined" && window) ? window : null;
  }

  function voiceSR() {
    const w = voiceWindow();
    return (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) || null;
  }

  function voiceMicConsent() {
    try { return localStorage.getItem(VOICE_CONSENT_KEY) === "yes"; } catch (e) { return false; }
  }

  function voiceSttProvider() {
    const w = voiceWindow();
    const nav = w && w.navigator;
    const A = voiceApp();
    const recordable = !!(w && w.MediaRecorder && nav && nav.mediaDevices &&
      nav.mediaDevices.getUserMedia);
    let whisper = false;
    try {
      whisper = !!(A && A.aiConfigured && A.aiConfigured() && A.aiBase &&
        /groq|openai/i.test(A.aiBase()));
    } catch (e) { whisper = false; }
    if (whisper && recordable) return "whisper";
    if (voiceSR()) return "webspeech";
    return null;
  }

  function voiceWave(on) {
    const el = $("#voice-wave");
    if (el) el.hidden = !on;
  }

  function voiceMicFail(key) {
    VOICE.mic = null; VOICE.sr = null; VOICE.rec = null;
    VOICE.whisperCancel = false;
    VOICE.micError = key || "micDenied";
    voiceWave(false);
    setStatus(str(VOICE.micError));
  }

  function voiceMicStop(cancel) {
    const p = VOICE.mic;
    if (!p || p === "transcribing") return;
    if (p === "whisper") {
      VOICE.whisperCancel = !!cancel;
      try {
        if (VOICE.rec && VOICE.rec.state !== "inactive") VOICE.rec.stop();
      } catch (e) { voiceMicFail("micDenied"); return; }
      if (cancel && (!VOICE.rec || VOICE.rec.state === "inactive")) {
        VOICE.mic = null;
        voiceWave(false);
      }
      return;
    }
    const sr = VOICE.sr;
    if (!sr) { VOICE.mic = null; voiceWave(false); return; }
    try { if (cancel) sr.cancel(); else sr.stop(); }
    catch (e) { /* already ended */ }
  }

  function voiceMicWebspeech() {
    const SR = voiceSR();
    if (!SR) { voiceMicFail("micNone"); return; }
    let rec;
    try { rec = new SR(); } catch (e) { voiceMicFail("micDenied"); return; }
    const finals = [];
    let done = false, cancelled = false, err = "";
    rec.interimResults = true;
    rec.continuous = false;
    rec.lang = (VOICE_LANGS[VOICE.lang] || VOICE_LANGS.en).stt || "en";
    rec.onresult = (e) => {
      let live = "";
      const list = (e && e.results) || [];
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const t = r && r[0] ? String(r[0].transcript || "") : "";
        if (r && r.isFinal) { if (t.trim()) finals.push(t.trim()); }
        else live += t;
      }
      const seen = finals.concat(live ? [live] : []).join(" ").trim();
      if (seen) { VOICE.transcript = seen; renderTranscript(seen); }
    };
    rec.onerror = (e) => {
      const code = String((e && e.error) || "");
      if (code === "not-allowed" || code === "service-not-allowed" ||
        code === "audio-capture") err = "micDenied";
    };
    rec.onend = () => {
      if (done) return;
      done = true;
      voiceWave(false);
      VOICE.sr = null;
      if (VOICE.mic === "webspeech") VOICE.mic = null;
      const t = cancelled ? "" : finals.join(" ").trim();
      if (err) setStatus(str(err));
      else if (t) voiceAsk(t);
      else setStatus(str("idle"));
    };
    VOICE.sr = {
      stop() { try { rec.stop(); } catch (e) { /* already ended */ } },
      cancel() { cancelled = true; try { rec.stop(); } catch (e) { /* already ended */ } },
    };
    VOICE.mic = "webspeech";
    VOICE.micError = "";
    voiceWave(true);
    setStatus(str("listening"));
    try { rec.start(); } catch (e) { voiceMicFail("micDenied"); }
  }

  async function voiceBlobB64(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  async function voiceTranscribe(b64, mime) {
    const A = voiceApp();
    if (!A) return "";
    const payload = {
      audio: b64,
      mime: String(mime || "audio/webm").slice(0, 60),
      lang: VOICE.lang,
    };
    let r = null;
    try {
      if (A.aiConfigured() && typeof PWDB !== "undefined") {
        r = await A.offlineRequest("POST", "/api/ai/transcribe", {}, payload);
      } else {
        r = await A.api("/api/ai/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    } catch (e) { r = null; }
    if (!r || !r.source || typeof r.text !== "string") return "";
    return r.text.trim();
  }

  async function voiceMicWhisper() {
    const w = voiceWindow();
    const nav = w && w.navigator;
    VOICE.mic = "whisper";
    VOICE.micError = "";
    VOICE.whisperCancel = false;
    voiceWave(true);
    setStatus(str("recording"));
    let stream = null;
    try {
      stream = await nav.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { voiceMicFail("micDenied"); return; }
    const stopTracks = () => {
      try {
        const tracks = stream && stream.getTracks ? stream.getTracks() : [];
        tracks.forEach((t) => { try { if (t.stop) t.stop(); } catch (e2) { /* noop */ } });
      } catch (e2) { /* no tracks */ }
    };
    if (VOICE.mic !== "whisper") { stopTracks(); return; }
    let rec;
    try { rec = new w.MediaRecorder(stream); }
    catch (e) { stopTracks(); voiceMicFail("micDenied"); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e && e.data) chunks.push(e.data); };
    rec.onstop = () => {
      stopTracks();
      VOICE.rec = null;
      const cancelled = VOICE.whisperCancel;
      VOICE.whisperCancel = false;
      if (cancelled) {
        if (VOICE.mic === "whisper") VOICE.mic = null;
        voiceWave(false);
        return;
      }
      VOICE.mic = "transcribing";
      setStatus(str("think"));
      (async () => {
        let text = "";
        try {
          const type = String(rec.mimeType || "audio/webm").split(";")[0] || "audio/webm";
          const blob = new Blob(chunks, { type });
          text = await voiceTranscribe(await voiceBlobB64(blob), type);
        } catch (e) { text = ""; }
        if (VOICE.mic === "transcribing") VOICE.mic = null;
        voiceWave(false);
        if (text) voiceAsk(text);
        else setStatus(str("offline"));
      })();
    };
    VOICE.rec = rec;
    try { rec.start(); } catch (e) { stopTracks(); voiceMicFail("micDenied"); }
  }

  function voiceMic() {
    if (VOICE.mic) { voiceMicStop(false); return; }
    const p = voiceSttProvider();
    if (!p) { setStatus(str("micNone")); return; }
    if (!voiceMicConsent()) {
      if (VOICE.consentPending) {
        VOICE.consentPending = false;
        try { localStorage.setItem(VOICE_CONSENT_KEY, "yes"); } catch (e) { /* private mode */ }
      } else {
        VOICE.consentPending = true;
        setStatus(str("consent"));
        return;
      }
    }
    if (p === "whisper") voiceMicWhisper();
    else voiceMicWebspeech();
  }

  function voiceSpeak(t) {
    const w = voiceWindow();
    if (!VOICE.tts || !t || !(w && w.speechSynthesis && w.SpeechSynthesisUtterance)) return;
    try {
      w.speechSynthesis.cancel();
      const u = new w.SpeechSynthesisUtterance(String(t));
      u.lang = (VOICE_LANGS[VOICE.lang] || VOICE_LANGS.en).stt || "en";
      w.speechSynthesis.speak(u);
    } catch (e) { /* speech is a courtesy */ }
  }

  function voiceSetTts(on) {
    VOICE.tts = !!on;
    const p = voicePrefs();
    p.tts = VOICE.tts;
    voiceSavePrefs(p);
    const b = $("#voice-tts");
    if (b) {
      b.classList.toggle("on", VOICE.tts);
      b.setAttribute("aria-pressed", VOICE.tts ? "true" : "false");
    }
    if (!VOICE.tts) {
      const w = voiceWindow();
      if (w && w.speechSynthesis) { try { w.speechSynthesis.cancel(); } catch (e) { /* noop */ } }
    }
    return VOICE.tts;
  }

  function voiceDrag() {
    const head = $("#voice-head");
    const panel = $("#voice-panel");
    if (!head || !head.addEventListener || !panel) return;
    let drag = null;
    head.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.tagName &&
        /^(BUTTON|SELECT|INPUT)$/.test(String(e.target.tagName).toUpperCase())) return;
      drag = { x: e.clientX, y: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      if (head.setPointerCapture && e.pointerId != null) {
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    });
    head.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const l = drag.left + (e.clientX - drag.x);
      const t2 = drag.top + (e.clientY - drag.y);
      panel.style.left = Math.max(4, Math.min(l, window.innerWidth - 80)) + "px";
      panel.style.top = Math.max(4, Math.min(t2, window.innerHeight - 60)) + "px";
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    });
    const done = () => { drag = null; };
    head.addEventListener("pointerup", done);
    head.addEventListener("pointercancel", done);
  }

  function voiceInit() {
    if (VOICE.inited) return;
    if (typeof document === "undefined" || !document) return;
    VOICE.inited = true;
    const prefs = voicePrefs();
    VOICE.lang = prefs.lang;
    VOICE.tts = prefs.tts;
    VOICE.wake = prefs.wake;
    const tts = $("#voice-tts");
    if (tts) {
      tts.addEventListener("click", () => voiceSetTts(!VOICE.tts));
      voiceSetTts(VOICE.tts);
    }
    const sel = $("#voice-lang");
    if (sel) {
      sel.innerHTML = Object.keys(VOICE_LANGS).map((k) =>
        `<option value="${k}">${h(VOICE_LANGS[k].label)}</option>`).join("");
      sel.value = VOICE.lang;
      sel.addEventListener("change", () => voiceSetLang(sel.value));
    }
    const fab = $("#voice-fab");
    if (fab) fab.addEventListener("click", voiceToggle);
    const close = $("#voice-close");
    if (close) close.addEventListener("click", voiceClose);
    const mic = $("#voice-mic");
    if (mic) mic.addEventListener("click", voiceMic);
    const form = $("#voice-form");
    if (form) form.addEventListener("submit", (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const t = $("#voice-text");
      const v = t ? String(t.value || "").trim() : "";
      if (!v) { setStatus(str("empty")); return; }
      if (t) t.value = "";
      voiceAsk(v);
    });
    const chips = $("#voice-chips");
    if (chips) chips.addEventListener("click", (e) => {
      const t = e && e.target ? e.target : null;
      const vi = t && t.dataset ? t.dataset.vi : null;
      if (vi == null || vi === "") return;
      /* Returning the promise changes nothing for the browser (an event
         handler's value is ignored) but lets the headless suite await the
         apply instead of guessing how long the save takes. */
      if (String(vi) === "undo") return voiceUndo();
      return voiceApply(Number(vi));
    });
    if (typeof document.addEventListener === "function")
      document.addEventListener("keydown", voiceHotkey, true);
    voiceDrag();
  }

  const API = {
    VOICE_LANGS,
    VOICE_OPS,
    open: voiceOpen,
    close: voiceClose,
    toggle: voiceToggle,
    isOpen: () => VOICE.open,
    init: voiceInit,
    submit: voiceAsk,
    ask: voiceAsk,
    hotkey: voiceHotkey,
    setLang: voiceSetLang,
    getLang: () => VOICE.lang,
    prefs: voicePrefs,
    savePrefs: voiceSavePrefs,
    mic: voiceMic,
    sttProvider: voiceSttProvider,
    micActive: () => !!VOICE.mic,
    micConsent: voiceMicConsent,
    setTts: voiceSetTts,
    ttsOn: () => VOICE.tts,
    setStatus,
    renderChips: voiceRenderChips,
    chipLabel: voiceChipLabel,
    apply: voiceApply,
    undo: voiceUndo,
    state: () => ({
      open: VOICE.open, asking: VOICE.asking, lang: VOICE.lang,
      pending: VOICE.pending.length, history: VOICE.history.length,
    }),
    norm: voiceNorm,
    words: voiceWords,
    digits: voiceDigits,
    parseNumbers: voiceParseNumbers,
    parseReply: voiceParseReply,
    validateBatch: voiceValidateBatch,
  };

  if (typeof window !== "undefined") window.VoiceOverlay = API;
  if (typeof document !== "undefined" && document && document.body) {
    try { voiceInit(); } catch (e) { /* no DOM yet */ }
  }
})();
