# PW Budget — Project Summary & AI / Automation Plan

> Status: **phases 1–3 + Phase 0 + the assistant v2 (agentic) pass +
> the voice overlay + the chat-view rework (two-column shell, sessions,
> bulk cards) implemented, phases 4–5 not yet started.** This
> document records what the project is today, and what we decided the
> AI/automation layer should be.
> 2026-10-04 — capture pipeline, statement ingest, knowledge base, income
> side, image policy and sequencing all decided (*Decisions* in Part 2), and
> the phase-1 plumbing shipped: `/api/ai/extract`, `/api/ai/instruct`,
> `/api/ai/statement` in both engines, `fixtures/ai/` recording, parity
> extended to 65 steps.
> Phase 2 shipped the same day: the New-purchase dialog gained 📷 Scan a slip
> and 📋 Paste text, the `uncertain[]` review card, and multi-line slips that
> save one line at a time through the ordinary `/api/purchases` path.
> Then the platform became **AI native**: a per-device model connection chosen
> in **AI connection** (provider select + API key, stored only on the device),
> an **AI status strip on every screen**, and a **coverage** matrix the owner
> sets — the model's body is the app, and the owner decides how much of it it
> may reach.
> Phase 3 closed the other half of the ledger: an **`income`** table with
> `GET/POST /api/income` and `DELETE /api/income/{id}` in both engines, a
> **Money in** view with its own list, filters and dialog, a dashboard KPI and
> a money-in series in the spend chart, and **statement ingest** —
> paste / CSV / screenshot → candidates → the owner ticks → *Record money in*,
> which writes through the ordinary `POST /api/income` path. Money-out rows in
> a statement are shown but never imported (a statement has no product or
> quantity, so they belong in a purchase). `aiInstruct` / `aiStatement` in
> `db.js` now use the device's model exactly like `server.py` does, and the
> three statement/instruct prompts were hoisted to shared constants — the
> audit's model contract check now compares **9** strings, not 6. Parity 79
> steps; 160 audit + 148 smoke assertions.
> **2026-10-07 — assistant v2 (the agentic pass)** landed: the chat assistant
> now knows its own limits (coverage-off tools are described to the model as
> `[locked]`, never hidden), retries a failed model call once and offers
> *Try again*, briefs the owner on open, suggests follow-ups, and gained four
> **approve-gated** write powers (`propose_coverage`, `import_slip` → one card
> per line, `backup_books` → file card, **Approve all** for a batch) plus
> month/year/branch-scoped reports. `AI_PROMPT_AGENT` became a shared
> constant (contract now **12** strings); `CACHE = "pwbudget-v29"`.
> Also 2026-10-07 — **provider presets extended** after a platform research
> pass (Claude / Gemini / DeepSeek / ChatGPT): **DeepSeek** joined the picker
> as the cheap pay-per-use option (OpenAI-compatible base, vision ids from its
> own pricing docs, CORS preflight measured 200 from this app's origin), and
> OpenRouter's datalist gained `anthropic/claude-haiku-4.5` (verified against
> its live model list). Claude and OpenAI as *direct* presets were deliberately
> skipped: no free tier for either, a direct Claude preset needs a second wire
> format in both engines, and OpenAI's browser CORS is flaky.
> Also 2026-10-07 — **`agentParse` hardened**: a model reply with a stray
> closing brace, prose around the object, or a cut-off tail no longer swallows
> its `actions` (this is exactly how one real approved purchase never became
> a card — see SESSION_STATUS §3.7).
> Also 2026-10-07 — **voice overlay shipped** (5 commits): `POST /api/ai/voice`
> in both engines behind the new shared `AI_PROMPT_VOICE` (contract now
> **13** strings), plus `POST /api/ai/transcribe` (audio → text, same parity
> rules). `public/app/voice.js` adds the draggable overlay: strict one-JSON
> action batch, spoken-amounts whitelist, a multilingual number engine
> (en/fr/tw/ga/ee/ha), consent-gated mic choosing Whisper (push-to-talk →
> transcribe) or Web Speech, TTS read-aloud, and tap-to-apply chips with
> one-step ↩ Undo, destructive confirms and the coverage gate at apply time.
> `CACHE = "pwbudget-v32"`.
> Also 2026-10-07 — **chat rework shipped** (4 commits): the floating
> drawer became a **two-column chat view** with a collapsible sidebar
> (Chats / Projects / Logs, search, day groups, per-row ⋯ menu, projects,
> user menu), **sessions** under one key (every reload archives the open
> chat under a keyword auto-title — v1 migrates in place; pending cards
> badge across sessions), and the **batch gate lifted**: same-tool dedupe
> removed, `agentPlanCards()` turns every write action into a numbered card
> (`3 of 12`) capped at 40 per tool, `AI_PROMPT_AGENT` gained the
> byte-identical restock/sample-data rule, and `agentParse`'s peel now
> strips stray digits (`…}]5}`). `CACHE = "pwbudget-v35"`.
> Tests now: 174 audit + 301 smoke, 0 failed.

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
  (`PWDB.request(method, path, qs, body) → {status, body}`). The five
  `/api/ai/*` routes answer with a **Promise** instead, because a model
  round-trip is asynchronous — every caller awaits them.
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
| `sw.js` | Cache-first service worker, `CACHE = "pwbudget-v35"` (bump on every update); `/api/*` is network-first |
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

### Tests (baseline verified green on 2026-10-07)

```
node audit_calculations.js   → 174 passed, 0 failed
                               (calculator, offline↔server parity —
                               including /api/ai/* —, invariants, fixture replay,
                               13 shared model constants incl. AI_PROMPT_VOICE)
node smoke_test.js           → 301 passed, 0 failed  — needs a server on :8123
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

The core is a **pipeline, not a set of unrelated features** — capture →
extract → confirm → record → remember:

```
capture ──▶ extract ──▶ confirm ──▶ record ──▶ remember
(camera)    (vision)    (user)     (existing   (knowledge
                                    API)        base)
                          ▲
                          └── AI asks what it couldn't read
```

**Governing rule:** the model *proposes*, the human *confirms*, the
**existing write path records**. Nothing auto-commits. This keeps
`POST /api/purchases` untouched and parity risk low.

| # | Feature | LLM's job | Offline / no-key fallback |
|---|---|---|---|
| 1 | **Capture → entry** (camera scan of slips *and* handwritten shop books) | Vision → distributor, line items, qty, unit, amount, date, payment + an `uncertain[]` list | Photo path disabled with a clear hint; text-paste path parsed by regex/heuristics |
| 2 | **Edit by instruction** | Turn "set the distributor on Tuesday's entries to Ceda" into a declarative patch against a field whitelist | Deterministic parser over a small grammar (`set X to Y`, `change 5000 to 4500`) |
| 3 | **Ask what it isn't sure of** | Return `uncertain[{field, why, options[]}]` rendered as a **review card**, not a chat loop | Review card shows a plain "check this field" flag |
| 4 | **Statement & slip ingest** (MoMo, bank, receipts) | Screenshot/text → candidate transactions, matched to existing distributors/products | CSV channel is **fully offline** (stdlib `csv`); paste channel uses regex; PDF has no offline path |
| 5 | **Knowledge base** | Link documents ↔ purchases ↔ distributors ↔ products ↔ ref codes | FTS5 server-side, small tokenizer + scorer in `db.js`; embeddings only when online |
| 6 | **Ask-your-books chat** | Turn a question into a structured answer (chart/table + prose) over the knowledge base | Keyword/intent matcher hitting existing `/api/analytics` etc. |
| 7 | **Auto insights / weekly digest** | Write the narrative over locally-computed numbers | Existing `buildAlerts()` reminder engine, no prose |
| 8 | **Forecast & smart budget** | Explain and refine a forecast | Local stats (moving average / linear trend) feeding the existing ⚡ recommender |
| 9 | **Voice entry** ✅ *shipped as the voice overlay (2026-10-07)* | `/api/ai/voice` turns a transcript into one strict JSON `{reply, actions}` over the budget snapshot; amounts must match what was spoken | Fully local: per-language number lexicon (en/fr/tw/ga/ee/ha) + action validator; Web Speech dictation or Whisper via `/api/ai/transcribe` when a key is attached |
| 10 | **Automated reminders / exports** | Phrase scheduled digests | `threading` timer + existing admin CSV/JSON export |
| 11 | **AI feature builder** | Turn an instruction into a *new UI feature* | Builder disabled without a key; previously-created features still render |

### Capture constraints (decided)

- **Capture control:** `<input type="file" accept="image/*" capture="environment">`
  — works in iOS Safari *and* the installed PWA with no permission dance;
  `getUserMedia` is the viewfinder fallback.
- **Compress before upload:** canvas downscale to ~1500px, JPEG ~0.7 →
  200–400KB instead of 5MB. Non-negotiable for mobile-data costs.
- **Images are transient.** A photo is *input*, not a record: it is held only
  while the user reviews the extraction, then discarded. `documents` stores the
  **extracted text + provenance** (source type, captured date, raw transcript),
  never image bytes. No image store, no IndexedDB, no quota problem.
  *Tradeoff accepted:* a bad extraction cannot be re-checked against the photo
  later — so the stored transcript must be faithful.
- **Accuracy expectation:** printed slips read well; **handwritten ledger books
  are hard** (column alignment in a ruled exercise book). Human confirmation is
  therefore mandatory, never optional, before anything is written.

### Endpoint surface (must exist in both engines)

```
POST /api/ai/extract     image/text    → structured draft + uncertain[]
POST /api/ai/instruct    draft + text  → validated declarative patch
POST /api/ai/statement   statement/CSV → candidate transactions
GET  /api/search?q=      knowledge-base retrieval
POST /api/documents      record extraction (text + provenance only)
GET  /api/documents      list / link back to purchases
POST /api/income         record takings / deposits   (new — see below)
GET  /api/income?[…]     list income
```

`db.js` mirrors **every one** of them returning heuristic-only results. That is
simultaneously the offline fallback *and* the recorded-fixture mock.

**Shipped in phase 1:** the three `/api/ai/*` routes, in both engines.
`/api/documents`, `/api/search` and `/api/income` arrive with phases 3–4.

Implementation notes worth keeping:

- **Parity requires a keyless server.** With `AI_API_KEY` set, `server.py`
  consults the model and answers *better* than `db.js` can — legitimately
  different, and out of scope for parity. `audit_calculations.js` therefore
  spawns its server with `AI_API_KEY=""`.
- **Rounding had to be re-aligned.** Python's `round()` is banker's rounding
  (`round(0.125, 2)` → 0.12) while `r2` in db.js is `Math.round` (→ 0.13).
  The new `_r2` uses `floor(x + 0.5)`, which lands on the same float as
  `Math.round` — otherwise `uncertain` options and statement amounts would
  drift by a cent.
- **Substitution parity.** Python's `re.sub` replaces *every* match even
  without `re.I`/global; JS `.replace` on a non-global regex stops after the
  first. `db.js` keeps `ISO_DATE_G`/`SLASH_DATE_G` for that reason.
- **Fixtures are keyed by digest**, `sha256(kind + payload)` with sorted JSON
  keys, in `fixtures/ai/<digest>.json`. An unrecorded request falls through to
  the heuristic rather than failing, so adding fixtures can never break a
  working app.
- **Model output is never trusted to choose its own schema.** `_normalise_draft`
  keeps only known keys; `_apply_patch` runs every model change through the
  same field whitelist and value validator as user text, and drops anything
  that fails rather than applying it.
- **Nothing here writes to the database.** These routes propose; a human
  confirms; `POST /api/purchases` records.

### Schema additions (both engines)

```
income        date, branch_id, source, reference, amount, memo
              — deposits seen in statements = sales/takings.
              Without this, statement ingest has nowhere to put money IN,
              and the app reports spend but never profit.

documents     kind (slip|statement|screenshot|invoice), source, captured_at,
              raw_text, summary        ← NO image bytes

references    document_id ↔ purchase_id / income_id / distributor_id /
              product_id + ref_code (MoMo transaction id, cheque no,
              invoice no)   ← this is what makes a slip walkable
              in both directions: purchase → slip, distributor → every slip
```

`income` and `documents`/`references` must also be added to `SCHEMA` in
`server.py` **and** the `DB` seed object in `db.js`, or parity breaks.

### Income side (decided)

**Yes — add `income` now.** Bank/MoMo statements carry money *in* as well as
*out*; recording only the outflow would leave deposits unmatched and keep the
app reporting spend instead of profit. This is the change that turns "stock
book" into "the shop's whole picture", and it is cheaper to add alongside the
capture work than to retrofit later.

### Feature #11 — the builder: design constraint

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

**The same rule governs feature #2 (edit by instruction).** An instruction
yields a declarative patch against a whitelist of fields — never SQL, never
HTML, never `eval`'d JS — validated server-side, then applied as ordinary API
calls. So *"set the distributor on all of Tuesday's entries to Ceda"* becomes:

```json
{"op":"update","target":"purchases","match":{"date":"2026-09-30"},
 "changes":{"distributor":"Ceda Industrial Supplies"}}
```

### Decisions (answered 2026-10-04)

**1. Provider — fixture-first.** Build everything against a **recorded-fixture
mock** so no rework is needed when a key lands. Conveniently, the `db.js`
heuristic mirrors *are* that mock: `db.js` returns the same response shapes
with no network call, and server-side `/api/ai/*` replays recorded fixtures.
When a provider is chosen — it must support **vision**; OpenAI, Gemini and
Groq all qualify — it gets wired in behind `AI_API_KEY` / `AI_BASE_URL` /
`AI_MODEL` through stdlib `urllib.request`, and the fixtures become the
regression suite. Nothing built meanwhile is thrown away.

**2. Sequencing — capture pipeline first, builder last.**

| Phase | What | Status / why here |
|---|---|---|
| 1 | AI plumbing: `/api/ai/*`, fixture mock, parity harness extended to the new routes | ✅ **done 2026-10-04** — 3 routes in both engines, `fixtures/ai/`, 65-step parity + fixture replay (151 assertions) |
| 2 | Camera → entry: capture, extract, `uncertain[]` review card | ✅ **done 2026-10-04** — file input (`accept="image/*" capture="environment"`) + canvas downscale to 1500px JPEG 0.7, paste-text path, review card with option chips, extra line items queued and saved one at a time; photo path gated offline with a plain hint. 116 smoke assertions |
| 2b | AI-native surface: connection, status, coverage | ✅ **done 2026-10-04** — **AI connection** dialog (provider select: Groq / Gemini / OpenRouter / custom OpenAI-compatible, key + model, *Test connection*, *Forget*), key in `localStorage["pwbudget.ai.v1"]` and never sent anywhere but the provider; **AI status strip** on every screen (`on` / `off` / `bad` + coverage); **coverage** matrix — `capture` gates the scan bar, `catalogue` + `money` gate what context travels with a scan (`payload.context`, mirrored in both engines), `app` gates the instruction box driving `/api/ai/instruct`. Model plumbing moved into `db.js` (`setProvider`/`aiChat`/`aiCall`) mirroring `server.py`'s env config, with an added audit section comparing the 6 shared prompt/error constants. 132 smoke + 157 audit assertions |
| 3 | Income side + statement/slip ingest | ✅ **done 2026-10-04** — `income` table (`date, branch_id, source, reference, amount, memo`) with `GET/POST /api/income` + `DELETE /api/income/{id}` in both engines; **Money in** view (list, search, month filter, pager, delete, ＋ Money in dialog); analytics gains `series[].income`, `totals.income` / `totals.net`; dashboard gains a *Money in this month* KPI and a money-in series in the spend chart; `/api/meta` `months` now unions purchases **and** income. **Statement ingest** card: paste / 📂 CSV / 📷 screenshot → `POST /api/ai/statement` → candidates with a *read by …* source line, `uncertain[]` as a warning, money-in rows ticked by default and *Record money in* looping `POST /api/income`; money-out rows are shown, tick-disabled and labelled "record it as a purchase instead". Gated by the existing `capture` coverage area (no 5th area, so the settings matrix still ships 4). `db.js`'s `aiInstruct`/`aiStatement` gained the same model path as `server.py`, all three AI routes are now Promises offline, and the 3 statement/instruct prompts were hoisted into shared constants (contract check: 6 → **9**). 148 smoke + 160 audit assertions |
| 0 | **Your data**: loud storage failures + backup / restore / CSV export | ✅ **done 2026-10-05** — `db.js`'s `save()` no longer swallows quota errors: `request()` snapshots the store and, if the write did not stick, rolls back and answers **507** with a shared sentence (`server.py` answers 507 too when sqlite reports a full/read-only disk — probed for real with `attrib +R ledger.db`). Persistent red storage banner until a save succeeds. **Your data** dialog: one-file backup in the offline engine's own shape (assembled through the API in server mode), **additive restore** replayed through the ordinary create paths (never deletes, idempotent — no new endpoints to mirror), and purchases/credits/money-in CSV export with BOM. Read fan-out batched to 4: a 72-way parallel burst was enough to get a connection refused and silently downgrade the app to offline for the rest of the session. 165 smoke + 160 audit assertions |
| A–D | **Assistant v2 (agentic)**: honest capability reporting + retry, richer reads, briefing & follow-ups, approve-gated write powers | ✅ **done 2026-10-07** — 24 tools; coverage-off tools described as `[locked]` (never hidden), `AI_PROMPT_AGENT` says so and became a shared contract string (**12**); `agentTurn` retries once, a dead turn renders *Try again*; keyless **briefing** on open + `agentFollowups` chips; new reads (`get_purchase`, `compare_months`, `get_reminders`, `price_trend`, `top_suppliers`, `navigate`, `search_income`, `budget_health`); write powers still behind Approve: `propose_coverage` (free tool, flips a coverage switch), `import_slip` (one card per line), `backup_books` (file card), **Approve all**; reports take `{month, year, branch_id}`; `CACHE = "pwbudget-v29"`; 229 smoke + 173 audit assertions |
| V | **Voice overlay**: summon the assistant by voice, multilingual STT, strict-JSON budget actions, tap-to-apply + one-step undo | ✅ **done 2026-10-07** — `POST /api/ai/voice` + `POST /api/ai/transcribe` in both engines, `AI_PROMPT_VOICE` as shared constant **13**; `public/app/voice.js`: draggable panel (fab + Ctrl+Shift+Space, drag-to-move), number engine for en/fr/tw/ga/ee/ha, reply parser + validator (spoken-amounts whitelist, ≤6 flat ops, destructive `confirm`), consent-gated mic → Whisper push-to-talk or Web Speech fallback, TTS read-aloud, en/fr chrome; chips apply to the shown budget month (percent of spendable) with confirm on delete/set-total, **↩ Undo**, change-log rows with a gold rail, coverage gate at apply time; `CACHE = "pwbudget-v32"`; 275 smoke + 174 audit assertions |
| C | **Chat view**: two-column shell + sessions + bulk cards | ✅ **done 2026-10-07** — the floating drawer is gone: `#view-chat` with a collapsible sidebar (New chat, search over titles + message text, day groups, per-row ⋯ menu, projects, Logs pane, user menu) and the thread + composer on the right; `pwbudget.agent.v1` holds `{sessions, cur, projects, journal, voice, seq, jseq, ui}` (v1 migrates), **every reload archives the open chat under a keyword auto-title**, pending cards badge across all sessions; the same-tool dedupe is lifted — `agentPlanCards()` numbers each card (`3 of 12`) and caps at `AGENT_BULK_MAX = 40`, `AI_PROMPT_AGENT` gained the byte-identical restock/sample-data rule (contract **13** unchanged), `agentParse` peels stray digits (`…}]5}`); `CACHE = "pwbudget-v35"`; 301 smoke + 174 audit assertions |
| 4 | Knowledge base: `documents`/`references`, `/api/search`, then chat | Worthless until phases 2–3 have produced data |
| 5 | Builder | Riskiest surface, least valuable for this audience |

Rejected: breadth-first (all surfaces at once with heuristic output) and
builder-first.

**3. Images — transient, never stored.** See *Capture constraints* above.

### Risks to keep in view

- **Parity drift** — `server.py` and `db.js` must be updated together. The new
  routes nearly double the surface this rule applies to.
- **Offline guarantee** — an AI call must never block a core write path
  (recording a purchase must work in airplane mode, always). Camera capture
  *requires* a network; the UI must say so plainly and keep the manual entry
  path one tap away.
- **Cost & latency** — vision calls and per-render prose must be cached;
  numbers always come from local computation, the model only interprets.
  Compress images before upload and cap scans per device.
- **Prompt injection** — user text (invoices, chat, memos, statement lines) is
  untrusted; declarative-patch and schema validation are the backstop.
- **OCR accuracy** — a confident wrong figure is worse than a blank field.
  Route uncertain extractions into the `uncertain[]` review card rather than
  guessing, and never auto-commit.
- **Lost transcript** — with images discarded, `documents.raw_text` is the only
  trace of what a slip said. It must be faithful, and `documents` rows should
  be exportable alongside the ledger.
- **Audit trail** — server-side AI actions should write to the existing
  hash-chained `audit_log` like every other mutation.
