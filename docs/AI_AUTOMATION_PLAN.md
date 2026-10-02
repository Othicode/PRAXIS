# PW Budget — Project Summary & AI / Automation Plan

> Status: **direction agreed, not yet implemented.** This document records what
> the project is today, and what we decided the AI/automation layer should be.
> Last discussed: 2026-10-02.

---

## Part 1 — What the project is

**PW Budget** is a stock-purchasing app for a print shop (DTF / garment
printing): purchases, supplier credit, budgets, analytics and branches.
Currency is **GH₵** (Ghana cedi). The hard constraint of the codebase is
**zero installs**: the server is pure Python standard library, the UI has no
build step and no npm dependencies.

### Two runtime modes (the core design idea)

| Mode | Trigger | Data lives |
|---|---|---|
| **Server** | browser tab, `/api/*` reachable | `ledger.db` (SQLite, next to `server.py`) |
| **Offline PWA** | installed / `?offline` / standalone, or API unreachable | `localStorage["pwbudget.v1"]` |

- `public/app/db.js` is a **faithful client-side port of `server.py`'s API** —
  same routes, same validation, same response shapes
  (`PWDB.request(method, path, qs, body) → {status, body}`).
- `api()` in `public/app/app.js` chooses: `OFFLINE_ENGINE` or a previously
  failed server → offline engine; a non-JSON response on `/api/*` → treated as
  "no backend here", so static hosting works too.
- The two engines must never disagree. Parity is **enforced by tests**.

### Layout

| Path | Role |
|---|---|
| `server.py` (~1440 lines) | Stdlib HTTP server: SQLite schema, `/api/*` business logic, static serving (with traversal guard), single-user `/admin/` (PBKDF2 login, DB sessions, throttle, hash-chained `audit_log` + verify + CSV/JSON export) |
| `public/app/app.js` (~1600 lines) | SPA: 6 views (dashboard, purchases, credits, analytics, budget, branches), hand-rolled SVG charts, reminder engine, profile, bright/dark theme, PWA install + SW update flow, calculator |
| `public/app/db.js` (~590 lines) | Offline engine — mirror of the Python API |
| `public/app/index.html`, `styles.css` | Onyx-&-gold design system, mobile bottom tab bar + "More" sheet |
| `public/index.html`, `public/pw-budget/` | PRAXIS company site, PW Budget download page |
| `public/admin/` | Admin dashboard UI |
| `sw.js` | Cache-first service worker, `CACHE = "pwbudget-v16"` (bump on every update); `/api/*` is network-first |
| `tools/` | `make_icons.py`, `check_static.py`, `cleanup_smoke.py` |
| `render.yaml`, `vercel.json`, `netlify.toml` | Deploy targets |

### Data model

```
branches         shops / plants — every purchase belongs to one
distributors     suppliers, auto-registered on first use
products         items with a default unit, auto-registered on first use
purchases        date, branch, distributor, product, qty + unit, total paid,
                 unit price (auto), payment method; credit carries original
                 price + amount paid
credit_payments  later payments against a credit purchase (drives balance)
budgets          year + month + total + savings target + item allocations (%)
```

### Domain rules (must stay mirrored in both engines)

- `unit_price = total / qty` (4dp); distributors/products auto-register
  case-insensitively on first use.
- Credit: `paid = credit_paid + Σ credit_payments`,
  `balance = max(total − paid, 0)`, `percent = paid/total` to 1dp.
  `db.js` validates **before** creating rows (the server gets this free from
  transaction rollback) — an orphan-row bug was already found and fixed here.
- Budget: `spendable = total − save`; ⚡ auto-distribute weights the top 6
  items from the prior 6 months, drift-corrected to exactly 100%.

### Tests (baseline verified green on 2026-10-02)

```
node audit_calculations.js   → 146 passed, 0 failed
                               (calculator, 40-step offline↔server parity, invariants)
node smoke_test.js           → 102 passed, 0 failed  — needs a server on :8123
                               (run `python server.py 8123` first; it does NOT spawn one)
python tools/cleanup_smoke.py  → wipes smoke rows from ledger.db afterwards
```

**Rule for every future change:** any new endpoint must exist in *both*
`server.py` and `public/app/db.js` with identical status codes, figures and
error strings, or `audit_calculations.js` parity breaks.

---

## Part 2 — The AI / automation direction (agreed)

### Chosen approach: **Cloud LLM API + graceful fallback**

- `server.py` gains `/api/ai/*`, calling an **OpenAI-compatible** endpoint
  through stdlib `urllib.request` — no new dependencies.
- Config via env: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`
  (works with OpenAI, Groq, OpenRouter, DeepSeek, local Ollama, …).
- **No key / no network / offline PWA → every AI path degrades to a
  deterministic heuristic.** The installed app must never break because a
  model is unreachable. `db.js` mirrors the `/api/ai/*` routes returning
  heuristic-only results, since the offline device may have no internet at all.

### Selected features

| # | Feature | LLM's job | Offline / no-key fallback |
|---|---|---|---|
| 1 | **Receipt capture → entry** | Vision → distributor, line items, qty, amount → prefill the New Purchase dialog (README roadmap item #1) | Text paste parsed by regex/heuristics; photo path disabled with a clear hint |
| 2 | **Ask-your-books chat** | Turn a question into a structured answer (chart/table + prose) over local analytics | Keyword/intent matcher hitting existing `/api/analytics` etc. |
| 3 | **Auto insights / weekly digest** | Write the narrative over locally-computed numbers | Existing `buildAlerts()` reminder engine, no prose |
| 4 | **Forecast & smart budget** | Explain and refine a forecast | Local stats (moving average / linear trend) feeding the existing ⚡ recommender |
| 5 | **Voice entry** | Parse transcript into the entry form | Browser Web Speech API → same parser as receipt text |
| 6 | **Automated reminders / exports** | Phrase scheduled digests | `threading` timer + existing admin CSV/JSON export |
| 7 | **AI feature builder** (new, user-added) | Turn an instruction into a *new UI feature* | Builder disabled without a key; previously-created features still render |

### Feature #7 — the builder: design constraint

Letting a model "add features by instruction" means it must be able to modify
the interface. In a financial app this is only acceptable if the output is
**data, not code**:

- The model returns a **declarative JSON spec** (widget kind, title, metric
  over a whitelisted expression vocabulary, chart type, which existing API
  action a button may call) — **never HTML, never `eval`'d JS**.
- The spec is validated server-side against a strict schema, persisted
  (SQLite in server mode, `localStorage` offline), and rendered by a single
  trusted renderer in `app.js`.
- The builder dialog is **admin-gated** on the server; offline it is
  available to the device owner and stored locally.

This makes "add a card showing overdue credit by distributor" a safe,
reproducible operation — and a prompt-injection attempt a rejected 400.

### Open questions (not yet answered)

1. **Provider + key** — which service, and does it support images (vision
   needed for receipt photos)? Until answered, everything gets built against
   a **recorded-fixture mock** so no rework is needed when the key lands.
2. **Sequencing** — options considered were: infrastructure-first (AI layer +
   parity + tests, then features), one vertical slice first (chat end-to-end),
   breadth-first (all surfaces with heuristic output), or builder-first.
   **Not decided.**

### Risks to keep in view

- **Parity drift** — `server.py` and `db.js` must be updated together.
- **Offline guarantee** — an AI call must never block a core write path
  (recording a purchase must work in airplane mode, always).
- **Cost & latency** — vision calls and per-render prose must be cached;
  numbers always come from local computation, the model only interprets.
- **Prompt injection** — user text (invoices, chat, memos) is untrusted; the
  builder's schema validation is the backstop.
- **Audit trail** — server-side AI actions should write to the existing
  hash-chained `audit_log` like every other mutation.
