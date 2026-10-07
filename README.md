# PW Budget — Stock, Distributors, Credit & Analytics

A dead-simple stock-purchasing app for a print shop (DTF / garment printing).
Tap **＋ New Purchase**, type the distributor and item, quantity and amount
paid — unit price is calculated automatically, new distributors/items are saved
into dropdowns for next time, credit purchases compute the balance and
%-cleared on their own, and the analytics dashboard shows exactly what any
item costs.

**Zero installs — pure Python standard library** on the server, and the app
itself is a **Progressive Web App (PWA)** that installs onto phones and runs
**completely offline** once installed.

---

## Two ways the app runs

| Mode | When | Data lives | Internet? |
|---|---|---|---|
| **Offline PWA** | Installed via "Add to Home Screen" (or `…?offline` in the URL) | `localStorage` on the phone | **No — fully offline** |
| **Server app** | Opened in a normal browser tab | `ledger.db` on the server | Yes |

The installed app is a proper PWA: it opens in its own window with its own
icon, and every feature — purchases, credits, budgets, analytics **and the
built-in calculator** — works in airplane mode. The full Python backend was
ported to a client-side engine in `public/app/db.js` with the *same* API
contract, so nothing in the UI changes.

> Note: the two modes keep separate data. If the boss uses the browser version
> and then installs, the installed copy starts fresh (empty). Install first,
> then use the app from the home-screen icon.

## What the boss sees

- **Dashboard** — monthly spend, outstanding credit, budget headroom, charts,
  most-bought items, recent purchases, credit watch, plus a **reminders**
  strip: overdue credit (“X is 60 days old — pay it”), credits ageing past 30
  days, budget over/90% burn, and unit-price spikes — worst first, hidden when
  everything is quiet. The **Credits** tab carries a live count badge.
- **Purchases** — filter / search / paginate every entry; move entries between
  branches; delete.
- **📷 Scan a slip** — inside **New purchase**, two ways to type less.
  *Scan a slip* photographs a receipt or ledger page and pre-fills the date,
  supplier, item, quantity and amount; *Paste text* does the same from copied
  text and works with **no internet at all**. Anything it is not sure about
  comes back as a **⚠ Check these before saving** card — tap an option to
  answer it, and that question disappears. A slip listing three lines becomes
  three purchases, each one confirmed and saved through the ordinary form.
  Nothing is written until **Save purchase** is pressed, and the photo itself
  is never stored.
- **🤖 AI status strip** — a one-line bar under the header on **every screen**:
  `AI · Groq · llama-3.3-70b · capture · catalogue`. Green dot = a model is
  attached on this device, hollow = built-in rules only, red = it could not
  reach the model and says so instead of quietly guessing. Tap it to open
  **AI connection**, which also lists the **coverage** — exactly which parts
  of the app the model may reach. Turn *Receipt & slip capture* off and the
  scan bar disappears; turn *My items & suppliers* off and your catalogue
  stops travelling with a scan.
- **💬 The assistant** — a chat bubble on every screen (top bar 🤖) that
  opens as a **glass drawer**: a dimmed backdrop, then a full sheet on the
  phone or a floating card on the right of a wide screen. It
  answers from *your* books: what you spent this month, what you owe, price
  moves, top suppliers, reminders, a PDF report on request, even "open the
  Credits screen". It opens with a **briefing** — where the shop stands right
  now, keyless — and after each answer offers one-tap **follow-up** chips. It
  is honest about its hands: a tool your coverage has switched off is shown as
  `[locked]` in its instructions, so it will offer *propose widening access*
  instead of pretending. Writes — recording a pasted slip, taking a backup,
  flipping a coverage switch, building a file — always arrive as a card with
  an **Approve** tap (or **Approve all** for a batch); nothing is written by
  itself, and a model that cannot be reached says so with **Try again**
  instead of going quiet.
- **🎤 Speak to the app** — a floating microphone (bottom-left, or
  Ctrl+Shift+Space) opens a **voice overlay**: say or type a budget change in
  **English, Français, Twi, Ga, Ewe or Hausa**, get a plain reply plus
  **tap-to-apply chips** (`＋ transport · GH₵500`) for the month you are
  looking at. Nothing applies until you tap: every amount must be one you
  actually said, deleting or setting the total asks first, and one **↩ Undo**
  chip reverts the last change. The microphone is consent-gated and audio is
  never stored — with a Groq/OpenAI key attached it records in memory and
  posts straight to `/api/ai/transcribe` (your provider's Whisper), otherwise
  the browser's own Web Speech dictation listens; the 🔊 button reads replies
  aloud, and every applied change is written to the assistant's change log.
  The same **App settings** coverage switch decides what it may touch.
- **Credits** — outstanding accounts with balance + %-settled progress and
  payment history; "Pay now" records later payments and recomputes everything.
  Each open credit shows how **old** it is (⏳ 60+ days = overdue) and an
  *Oldest open credit* KPI, so nothing quietly rots.
- **Analytics** — spend per item, most-bought by quantity, per distributor,
  payment mix, monthly trend, unit-price trends.
- **Money in** — the other half of the ledger: takings and deposits, with
  their own list, search, month filter and dialog, a dashboard KPI and a
  money-in series in the spend chart (so the trend shows **net**, not just
  spend). Inside it, **statement ingest** takes a pasted text / 📂 CSV /
  📷 screenshot of a MoMo or bank statement and turns it into tickable
  candidates — money-in rows record through the ordinary money-in path;
  money-out rows are shown but never imported (a statement has no product or
  quantity, so they belong in a purchase).
- **Budget** — year + month + total + savings target; ⚡ auto-distributes the
  spendable amount across items from purchase history; editable percentages;
  plan vs actual.
- **Branches** — add shops/plants; clicking a branch opens its dashboard.
- **🧮 Calculator** — the floating button (bottom-right, chat-widget style)
  opens a calculator on any screen. Keyboard, √, %, x², decimals, operator
  precedence, errors handled.
- **☀️ / 🌙 Bright or dark screen** — the toggle in the top bar (and the
  *Appearance* switch inside **Your shop identity**) repaints the whole app:
  onyx-&-gold **dark** (default) or a **bright** paper screen with the same
  gold accents, re-tuned for daylight contrast — tables, charts, dialogs,
  calculator and the browser's theme colour all follow. Saved per device under
  `pwbudget.theme.v1` and applied before first paint, so there is no flash.
  Works identically offline and in server mode.

## Run the server

```
python server.py          # → http://127.0.0.1:8000
python server.py 8123     # optional: different port
python server.py --demo   # optional: fresh DB with 6 months of sample data
```

- **First launch starts clean** — one default `Main Shop`, no test data.
- `--demo` seeds 6 months of realistic purchases.
- Data lives in `ledger.db` next to `server.py`.

## Websites served

| URL | What it is |
|---|---|
| `/` | **PRAXIS company site** — brand landing for the studio (products, story, contact). |
| `/pw-budget/` | **PW Budget download site** — features + step-by-step install for iPhone (Safari → Share → Add to Home Screen) and Android (Chrome → Install app). |
| `/app/` | The app itself (PWA). Also `index.html`, `sw.js`, `manifest.webmanifest` and `icons/` live here. |
| `/api/*` | JSON API (server mode). |

## Install on a phone (once, over Wi-Fi)

1. Open the **PRAXIS site** (e.g. `https://<tunnel>.trycloudflare.com/`), then the **PW Budget** product page (`/pw-budget/`).
2. **iPhone/iPad**: open in *Safari* → Share → **Add to Home Screen** → Add.
   **Android**: open in *Chrome* → ⋮ → **Install app** / **Add to Home screen**.
3. Tap the new **PW Budget** icon — it launches standalone and works offline.

There is no `.apk` because the boss has an iPhone — iOS can't install APKs.
The PWA *is* the iOS-native install path (it gets its own icon, window, and
runs offline). The download page says exactly this.

## Look & branding (one design system)

Every surface — landing page (`/`), download page (`/pw-budget/`), the app
(`/app/`) and the PWA icons — is built from the same onyx-&-gold tokens:

- `public/theme.css` (marketing pages) and `public/app/styles.css` (the app)
  carry an **identical token block**: `--bg #07070a`, `--bg2 #0b0b10`,
  `--panel #121218`, `--ink #f4efe3`, `--muted/--sub #a49b89`,
  `--gold #d4af37`, `--gold-hi #f7e7a8`, `--radius 14px`, `--btn-radius 12px`,
  `--shadow`, plus the amber/green/red/teal/violet accent set. Change both
  files together when you retune the palette.
- Shared geometry: 12px buttons (gold-grad + sheen sweep on hover, gold ghost
  variant), 14px cards with the same gradient/border/shadow, 20px pills,
  gold `:focus-visible` ring, `color-scheme: dark`.
- **Icons follow the front page**: the mark is the faceted gold pyramid from
  `public/logo.svg`, drawn on the app's onyx→bronze tile by
  `python tools/make_icons.py` → `public/app/icons/*.png` (PWA + home screen),
  `public/favicon.svg` and `public/favicon.ico` (browser tabs).

## Going live on Render

`render.yaml` ships with the repo:

1. Push to GitHub → Render → **New → Blueprint** (auto-detects `render.yaml`).
2. You get `/`, `/pw-budget/`, `/app/` **and** the live `/api` backend.
   `server.py` picks up Render's `$PORT` and binds `0.0.0.0` via `HOST`.
3. **Free plan:** `ledger.db` lives on the instance disk and is reset on each
   redeploy. On a paid plan attach a disk mounted at `/var/data` and add the
   env var `PWBUDGET_DATA_DIR=/var/data` (already supported — see `render.yaml`).

No backend needed? Create a **Static Site** with publish directory `public`
instead — the PWA detects the missing `/api` and switches to its offline
storage engine. Same for `vercel.json` and `netlify.toml`.

## Going live with a stable link

The dev tunnel uses Cloudflare *quick tunnels* — the URL is temporary and
changes when cloudflared restarts. The installed app keeps working offline
regardless, but for a permanent shareable link do this once:

```
# 1) Download the binary (run as admin once to login):
cloudflared-windows-amd64.exe tunnel login

# 2) Give the tunnel a name, then point it at the app:
cloudflared-windows-amd64.exe tunnel create pwbudget
cloudflared-windows-amd64.exe tunnel route dns pwbudget app.yourdomain.com
cloudflared-windows-amd64.exe tunnel run pwbudget
```

and use the local `--url` flag pointing at `http://localhost:8123` (or edit the
tunnel's config file's ingress). Any static host works too because the app is
fully client-side after install.

## Data model

```
branches         shops / plants — every purchase belongs to one
distributors     suppliers, auto-registered on first use
products         items with a default unit, auto-registered on first use
purchases        date, branch, distributor, product, qty + unit, total paid,
                 unit price (auto), payment method; credit carries original
                 price + amount paid
credit_payments  later payments against a credit purchase (drives balance)
budgets          year + month + total + savings target + item allocations (%)
income           money in: date, branch, source, reference, amount, memo
```

Offline engine (`public/app/db.js`) mirrors this JSON-in-`localStorage`.

## HTTP API (server mode)

```
GET  /api/meta                      branches, distributors, products, units, currency
GET  /api/branches                  list branches        POST /api/branches {name}   create
GET  /api/purchases?[branch_id&month&frm&to&distributor&product&payment&owed&q&page&page_size]
POST /api/purchases                 {date, branch_id, distributor, product, unit, quantity,
                                     total_amount, payment_method, credit_paid?, memo}
DELETE /api/purchases/<id>          delete a purchase (and its credit payments)
POST /api/purchases/<id>/pay        {date, amount}  repay credit — balance re-computed
POST /api/purchases/<id>/move       {branch_id}     send the entry to another branch
GET  /api/credits?branch_id=        open + settled credit list, outstanding totals
GET  /api/analytics?branch_id=&n=6  item / distributor / monthly / payment-mix split,
                                     unit-price trends, credit totals
GET  /api/budget?year=&month=&branch_id=          current plan or auto-suggestion
POST /api/budget                    {year, month, branch_id, total_amount, save_amount,
                                     allocations:[{name, percent}]}
GET  /api/income?[branch_id&month&q&page&page_size]   money in
POST /api/income                    {date, branch_id, source, reference?, amount, memo?}
DELETE /api/income/<id>             delete a money-in entry

# AI extraction — proposal only, never writes. Human confirms, then the
# ordinary /api/purchases path records. See docs/AI_AUTOMATION_PLAN.md.
POST /api/ai/extract                {text?, image?}  -> {draft, uncertain[], source}
POST /api/ai/instruct               {draft, instruction} -> {patch, source}
POST /api/ai/statement              {text?, image?}  -> {candidates[], uncertain[], source}
```

`source` is `heuristic` unless `AI_API_KEY` (or a recorded fixture) is
configured. A per-device key pasted into **AI connection** makes `db.js`
produce `model` too — still identical to a keyless `server.py`, because the
parity harness clears the key, so the two engines answer identically. An
image with no provider is a 400 asking for the text instead.

Example:

```
curl -X POST http://127.0.0.1:8000/api/purchases -H "Content-Type: application/json" \
  -d '{"date":"2026-09-22","branch_id":1,"distributor":"Ceda Industrial Supplies",
       "product":"DTF Powder","unit":"bag","quantity":200,"total_amount":21600,
       "payment_method":"Credit","credit_paid":5000}'
```

Server computes unit price (108.00), finds/creates the distributor and product,
and stashes balance (16,600) and %-cleared (23.1%).

## Connect a free model

Every AI path has a working no-key fallback, so this is optional — but with a
key the slip reader gets a real model instead of regex rules.

1. Tap the **AI strip** (or *AI settings* in the phone's **More** sheet).
2. Pick a provider — **Google Gemini**, **Groq** or **OpenRouter** are all
   free tiers with no credit card, **DeepSeek** is the cheapest pay-per-use
   one that reads photos, and *Custom* takes any OpenAI-compatible
   `base URL`. A one-line note under the picker says what that provider can
   do (Gemini is the free one that also **reads photos**; Groq's free plan is
   text-only). **Get a free key ↗** opens the right console.
3. Paste the key — the **model id is filled in for you** from that provider's
   own free list, and an id left over from a *different* provider is dropped
   rather than sent to the wrong endpoint. *Test connection* proves the key,
   endpoint and model all answer, by checking the reply came from a model
   rather than from the built-in rules. Set the coverage, **Save**.

The key is stored in this device's `localStorage` under `pwbudget.ai.v1` and
is sent to **nothing but the provider you picked** — never to this project's
server, never to a third party. *Forget* wipes it and the strip goes hollow.

Coverage is yours to set: *Receipt & slip capture*, *My items & suppliers*,
*Credit you owe* and *App settings* are all live switches, not decoration —
each one decides whether the corresponding part of the app is part of the
model's body. The **assistant** plays by the same switches: it is told which
hands are locked and must not claim them, and can *ask* you to widen access
(`propose_coverage`) — you still tap Approve.

An unreachable model never fails a core path: `db.js` falls back to the same
deterministic rules a keyless server runs, and the strip turns red to say so.
In the assistant a failed turn retries once, then offers **Try again** rather
than leaving a dead thread.

## Speaking to the app — the voice overlay

The 🎤 button (bottom-left; **Ctrl+Shift+Space** anywhere) opens the overlay.
Type or talk; the reply arrives as **chips you tap to apply** — nothing is
written by itself, and only to the year/month the budget view is showing.

- **Which engine hears you** is picked automatically: a Groq/OpenAI key
  attached *and* a microphone → push-to-talk recording (in memory only, sent
  to `/api/ai/transcribe`, i.e. your own provider's Whisper — `whisper-1`, or
  `whisper-large-v3-turbo` on Groq); otherwise the browser's **Web Speech**
  dictation (live, keyless); neither → the panel says so and typing still
  works. The first microphone tap only asks for consent (remembered in
  `pwbudget.voice.mic.v1`); a refused permission falls back to typing.
- **What it may change** obeys the *App settings* coverage switch: every tap
  checks it, and if it is off the overlay tells you and offers the settings
  dialog. Chips carry only amounts that were really spoken (the model cannot
  invent a number), `delete` and *set the total* confirm before touching
  anything, notes go to the change log, and **↩ Undo** reverts the last
  applied change in one step.
- **Adding a language**: the number/word parser is a per-language lexicon in
  `public/app/voice.js` (`VOICE_LEX` — en, fr, tw, ga, ee, ha). To add one,
  give it a lexicon + label in `VOICE_LANGS`. All six languages understand
  each other's digits, but the overlay's own **chrome** (buttons, hints,
  consent lines) ships in English and French only — the other four fall back
  to English text.
- **Swapping the STT backend**: `voiceSttProvider()` in `voice.js` is the one
  decision point — `whisper` (record → `/api/ai/transcribe`) or `webspeech`
  (live browser recognition). A different provider only needs its
  `/audio/transcriptions` endpoint to keep the same
  `{audio, mime, lang}` shape the parity tests pin.
- **Wake word ("Hey Budget") is dormant by design** — an always-on listener
  costs battery and a permission the app never asks for. Nothing listens
  until the microphone is tapped. Audio is transient like every image in
  this app: recorded in memory, transcribed, dropped.
- Known limits: live Web Speech truly transcribes **en/fr** — the other four
  languages need the Whisper path (a key), and neither backend has been
  exercised against a *real* live key in these sessions (the headless tests
  cover the consent flow, backend selection, and route contract).

## Your data — backup, restore, export

Open **More → Your data** (or the identity chip → *Your data*). One dialog:

- **⤓ Backup** downloads a single `pwbudget-backup-YYYY-MM-DD.json` holding
  every branch, supplier, item, purchase, credit payment, money-in record and
  budget. In **server mode** the file is assembled through the ordinary API, so
  it holds exactly what the app can see; in **offline mode** it is the device
  store itself. The two shapes are the same, so a file taken in one mode
  restores into the other.
- **⤒ Restore…** reads a backup back. It is **additive**: anything the backup
  has that you don't already have is added, anything you already have is left
  exactly as it is. Nothing is ever deleted, so running it twice is harmless
  and there is no way for a stray file to wipe your books.
- **Purchases / Credits / Money in** export a CSV (UTF-8 with BOM, so Excel
  opens it cleanly) for a spreadsheet or an accountant.

A backup is your only copy when the app runs offline — the ledger lives in the
phone's `localStorage`, not on any server. Keep one somewhere safe.

If the device runs out of storage, the write **fails loudly**: the dialog says
`storage is full — this change was not saved…`, a red banner stays up until a
save succeeds, and the failed change is rolled back rather than left looking
saved. The server answers `507` with the same sentence when its disk is full.

## Tests

```
node smoke_test.js
```

Runs the **real** `public/app/app.js` + `public/app/db.js` headlessly in Node
with a DOM stub, in **both modes** (offline engine + server via fetch). Covers
every view — including **Money in** and its **statement ingest** card (paste /
CSV / screenshot → candidates → *Record money in*) — cash/credit entry, later
payments, budget auto-distribute, branch creation + navigation, analytics,
the calculator math, the capture flow
(text → extract → review card → each line saved through `/api/purchases`),
and the AI surface: the status strip, the coverage defaults, the settings
dialog's provider list (and a provider switch swapping in that provider's own
model id, never another's), a pasted key installing a device-side connection,
an unreachable model falling back instead of failing, and *Forget* detaching
it again — plus the **assistant**: locked tools described (never hidden),
`propose_coverage` offering to widen access, the keyless briefing, follow-up
chips, a failed turn offering *Try again*, one pasted slip expanding into one
pending card per line, a requested backup arriving as a file, **Approve all**
recording several rows in one tap, the history cap keeping a waiting card,
the new read tools answering, `navigate` opening a view, a month-scoped
report, and the harness's own exports — then the **voice overlay**: the
multilingual number engine and strict batch validator, a chip applying a
budget change (set total → add → update → delete) with one-step *↩ Undo*
back to where it started, the coverage gate blocking and then releasing the
same tap, a declined confirmation changing nothing, an amount that was never
spoken being refused at apply time, a voice note landing in the change log,
the consent-gated microphone choosing its backend, a recognized/transcribed
line reaching the engine, and the `/api/ai/voice` + `/api/ai/transcribe`
routes answering keyless — then **Your data**: the backup file's
table coverage, each CSV's
header and first row, a restore putting a deleted purchase back and nothing
else, and (offline only) a full store answering `507` with the purchase rolled
out of the store and the storage banner raising then clearing itself.
Server smoke data is deleted by the harness; run
`python tools/cleanup_smoke.py` afterwards if anything lingers (it also
reports the clean state).

```
node audit_calculations.js
```

Answers *"is the arithmetic actually right?"* in five sections:

1. **Calculator** — drives the real `calcEval()`/`calcPush()` with ~70
   expressions, simulated key taps and malformed input. Guards against the
   class of bug where the keypad's `−` (U+2212) didn't match the tokenizer's
   ASCII `-` and every subtraction answered *Error*.
2. **Engine parity** — replays one identical call sequence against the offline
   engine *and* a live `server.py`, then requires matching status codes,
   figures and error strings. Opaque row ids are ignored (the engines ship
   different seed catalogs by design); everything else must match, because a
   user should see the same numbers online and offline. This now includes the
   `/api/ai/*` routes — extraction, voice and transcribe — and the spawned
   server has `AI_API_KEY` cleared, so a live model can never mask a heuristic
   divergence.
3. **Invariants** — arithmetic that must hold whatever the engine: credit
   `paid + balance == total`, `qty × unit_price == total`, every analytics
   breakdown summing to its total, `spendable == total - save`, allocation
   percents summing to 100 after 1dp rounding, and the validation rules that
   keep them true.
4. **Recorded-fixture replay** — a second server started against `fixtures/ai`
   must answer a recorded request with `source: "fixture"`, an unrecorded one
   with `source: "heuristic"`, and a bare image with a 400.
5. **Shared model contract** — the thirteen constants both engines ask the model
   with (`AI_SYSTEM`, the capture image + text prompts, the instruct prompt,
   the two statement prompts, the assistant's prompt + its two fallback lines,
   the voice prompt, and the three AI error strings)
   must be byte-identical in `server.py` and `public/app/db.js`; otherwise the
   same slip would yield different drafts online and offline.

Self-contained — it starts its own server(s) on free ports against throwaway
data directories, so it never touches your real `ledger.db`. Exit code is
non-zero on any failure.

## Tools / config

- `tools/make_icons.py` — regenerate the PWA icons **and** `public/favicon.ico`
  from the front-page pyramid mark (pure stdlib PNG writer).
- `tools/check_static.py` — verify every page/asset/MIME is served.
- `tools/cleanup_smoke.py` — wipe any leftover smoke-test rows.
- **Currency** — `CURRENCY` in `server.py` *and* `CURRENCY` in `public/app/db.js`.
- **Payment methods** — `PAYMENT_METHODS` in both files too.
- **AI (optional)** — `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT`,
  plus `AI_FIXTURES` (replay a recorded response by request digest) and
  `AI_FIXTURES_RECORD=1` (write them as they land). **No key is required**:
  every `/api/ai/*` route then runs the same deterministic heuristic `db.js`
  runs, which is what keeps the engines in parity. A per-device key pasted
  into **AI connection** is a second, independent source: `db.js` calls the
  provider straight from the browser, so it works in server mode too and the
  key never leaves the device.
- **App data** remains in `ledger.db` for server mode; offline data is in the
  phone's `localStorage` under key `pwbudget.v1`.

## Roadmap ideas

The AI / automation direction (features, inference approach, constraints) is
written down in [`docs/AI_AUTOMATION_PLAN.md`](docs/AI_AUTOMATION_PLAN.md),
together with a summary of how this codebase is put together.

- Low-stock warnings per item (credit age, budget burn and price-spike
  reminders already ship — see Dashboard).
- CSV export of purchases and credits.
- Simple PIN lock on the installed app.