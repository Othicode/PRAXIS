"""
PW Budget - Print Shop Stock, Distributor, Credit & Analytics
==============================================================
Pure Python standard library. No installs.
Run:  python server.py   ->  http://127.0.0.1:8000
      /            PRAXIS company site
      /pw-budget/  PW Budget download site
      /app/        the PWA itself

Data model
  branches      shops / plants. Every purchase belongs to one branch.
  distributors  suppliers, auto-registered on first use (dropdown for later).
  products      items with a default unit, auto-registered on first use.
  purchases     the daily entry: date, branch, distributor, product, qty+unit,
                total paid, unit price (auto), payment method.
                Credit purchases carry original price + amount paid; balance
                and %-cleared are derived (later payments live in credit_payments).
  budgets       year+month plan: total + savings target + per-item allocations.
"""

import calendar
import csv
import datetime as dt
import hashlib
import hmac
import io
import json
import os
import random
import re
import secrets
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
CURRENCY = "GH\u20b5"

# Hosting: Render (or any PaaS) injects $PORT and expects the process on
# 0.0.0.0. Locally nothing changes: 127.0.0.1:8000 by default.
#   PWBUDGET_DATA_DIR  where ledger.db lives — point it at a mounted disk so
#                      the data survives redeploys (see render.yaml).
_data = os.environ.get("PWBUDGET_DATA_DIR") or str(BASE_DIR)
DATA_DIR = Path(_data)
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError:      # read-only/ephemeral filesystem: fall back to the app dir
    DATA_DIR = BASE_DIR
DB_PATH = DATA_DIR / "ledger.db"
HOST = os.environ.get("HOST") or "127.0.0.1"
# CLI: python server.py [port] [--demo]  (CLI port wins over $PORT)
#   --demo  seeds 6 months of sample data on a fresh database
PORT = 8000
try:
    PORT = int(os.environ.get("PORT") or 8000)
except ValueError:
    sys.exit("PORT must be an integer")
for _arg in sys.argv[1:]:
    if _arg in ("--demo", "--seed"):
        continue
    try:
        PORT = int(_arg)
    except ValueError:
        sys.exit(f"Usage: python server.py [port] [--demo]")

PAYMENT_METHODS = ["Cash", "Bank Transfer", "Mobile Money", "Credit"]
UNIT_SUGGESTIONS = ["bag", "roll", "pack", "set", "bottle", "kg",
                    "box", "piece", "litre", "carton", "can"]

# ---------------------------------------------------------------------------
# Admin (single-user) configuration
# ---------------------------------------------------------------------------
# The /admin directory is gated behind one account. The FIRST person to open
# /admin signs up (username + password) and that locks the account — no further
# signups are possible. You can instead pre-seed the account with env vars:
#   PWBUDGET_ADMIN_USER / PWBUDGET_ADMIN_PASS
# Sessions are random tokens stored in the DB and delivered via an HttpOnly
# cookie. The audit_log table is a hash chain, so any edit to a past entry
# breaks verification (useful for legal / accounting records).
COOKIE_NAME = "pwadmin_session"
SESSION_DAYS = 7
PBKDF2_ROUNDS = 200_000
MAX_FAILED_LOGINS = 8            # per IP before a cooldown kicks in
LOGIN_COOLDOWN_SEC = 300

SCHEMA = """
CREATE TABLE IF NOT EXISTS branches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS distributors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    unit_default  TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    branch_id       INTEGER NOT NULL REFERENCES branches(id),
    distributor_id  INTEGER REFERENCES distributors(id),
    product_id      INTEGER REFERENCES products(id),
    product_name    TEXT NOT NULL,
    unit            TEXT NOT NULL DEFAULT 'bag',
    quantity        REAL NOT NULL CHECK(quantity > 0),
    total_amount    REAL NOT NULL CHECK(total_amount > 0),
    unit_price      REAL NOT NULL CHECK(unit_price >= 0),
    payment_method  TEXT NOT NULL,
    credit_total    REAL,
    credit_paid     REAL,
    memo            TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credit_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    amount      REAL NOT NULL CHECK(amount > 0),
    memo        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS budgets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id        INTEGER REFERENCES branches(id),
    year             INTEGER NOT NULL,
    month            INTEGER NOT NULL,
    total_amount     REAL NOT NULL DEFAULT 0,
    save_amount      REAL NOT NULL DEFAULT 0,
    allocations_json TEXT NOT NULL DEFAULT '[]',
    updated_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(branch_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_purch_date   ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_purch_branch ON purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_purch_product ON purchases(product_id);
CREATE TABLE IF NOT EXISTS admin_user (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    username   TEXT NOT NULL,
    pass_salt  TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    detail    TEXT NOT NULL DEFAULT '',
    ip        TEXT NOT NULL DEFAULT '',
    prev_hash TEXT NOT NULL DEFAULT '',
    row_hash  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
"""


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _to_int(value, default=0):
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return default


def _to_float(value, default=0.0):
    try:
        return round(float(str(value)), 2)
    except (TypeError, ValueError):
        return default


def _month_list(end_date, n):
    """Oldest -> newest list of (year, month) tuples ending at end_date."""
    y, m = end_date.year, end_date.month
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(out))


def _month_bounds(year, month):
    first = dt.date(year, month, 1)
    last = dt.date(year, month, calendar.monthrange(year, month)[1])
    return first, last


# ---------------------------------------------------------------------------
# Auth (single admin user) + tamper-evident audit log
# ---------------------------------------------------------------------------
_LOGIN_ATTEMPTS = {}             # ip -> [count, first_ts]
_LOGIN_LOCK = threading.Lock()


def _utcnow():
    return dt.datetime.now(dt.timezone.utc)


def _hash_password(password, salt_hex):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ROUNDS
    ).hex()


def admin_exists(conn):
    return conn.execute("SELECT 1 FROM admin_user WHERE id = 1").fetchone() is not None


def create_admin_user(conn, username, password):
    salt = secrets.token_hex(16)
    conn.execute(
        "INSERT INTO admin_user(id, username, pass_salt, pass_hash) VALUES (1,?,?,?)",
        (username, salt, _hash_password(password, salt)),
    )
    conn.commit()


def verify_admin(conn, username, password):
    row = conn.execute("SELECT username, pass_salt, pass_hash FROM admin_user WHERE id = 1").fetchone()
    if not row:
        return None
    if not hmac.compare_digest(row["username"], username or ""):
        return None
    if not hmac.compare_digest(_hash_password(password or "", row["pass_salt"]), row["pass_hash"]):
        return None
    return row["username"]


def create_session(conn, username):
    token = secrets.token_urlsafe(32)
    exp = (_utcnow() + dt.timedelta(days=SESSION_DAYS)).isoformat()
    conn.execute(
        "INSERT INTO sessions(token, username, expires_at) VALUES (?,?,?)",
        (token, username, exp),
    )
    conn.commit()
    return token


def get_session(conn, token):
    if not token:
        return None
    row = conn.execute("SELECT username, expires_at FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return None
    try:
        exp = dt.datetime.fromisoformat(row["expires_at"])
    except ValueError:
        exp = _utcnow()
    if exp < _utcnow():
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return None
    return row["username"]


def destroy_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def _throttle_check(ip):
    """Return seconds to wait (0 if allowed). Sliding window brute-force guard."""
    now = _utcnow().timestamp()
    with _LOGIN_LOCK:
        rec = _LOGIN_ATTEMPTS.get(ip)
        if not rec or now - rec[1] > LOGIN_COOLDOWN_SEC:
            return 0
        if rec[0] >= MAX_FAILED_LOGINS:
            return int(LOGIN_COOLDOWN_SEC - (now - rec[1]))
        return 0


def _throttle_fail(ip):
    now = _utcnow().timestamp()
    with _LOGIN_LOCK:
        rec = _LOGIN_ATTEMPTS.get(ip)
        if not rec or now - rec[1] > LOGIN_COOLDOWN_SEC:
            _LOGIN_ATTEMPTS[ip] = [1, now]
        else:
            rec[0] += 1


def _throttle_clear(ip):
    with _LOGIN_LOCK:
        _LOGIN_ATTEMPTS.pop(ip, None)


def audit(conn, actor, action, detail="", ip=""):
    """Append a hash-chained entry. Returns the new row_hash."""
    detail = (detail or "")[:500]
    last = conn.execute("SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1").fetchone()
    prev = last["row_hash"] if last else ""
    ts = _utcnow().isoformat(timespec="seconds")
    row_hash = hashlib.sha256(f"{prev}|{ts}|{actor}|{action}|{detail}".encode("utf-8")).hexdigest()
    conn.execute(
        "INSERT INTO audit_log(ts, actor, action, detail, ip, prev_hash, row_hash)"
        " VALUES (?,?,?,?,?,?,?)",
        (ts, actor or "anonymous", action, detail, ip or "", prev, row_hash),
    )
    conn.commit()
    return row_hash


def audit_list(conn, limit=200, offset=0):
    limit = min(1000, max(1, limit))
    rows = conn.execute(
        "SELECT id, ts, actor, action, detail, ip, row_hash FROM audit_log"
        " ORDER BY id DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) c FROM audit_log").fetchone()["c"]
    return {"rows": [dict(r) for r in rows], "total": total}


def audit_verify(conn):
    """Walk the chain oldest->newest; any edit/insert/delete breaks it."""
    prev = ""
    count = 0
    for r in conn.execute("SELECT id, ts, actor, action, detail, prev_hash, row_hash"
                          " FROM audit_log ORDER BY id ASC").fetchall():
        expected = hashlib.sha256(
            f"{r['prev_hash']}|{r['ts']}|{r['actor']}|{r['action']}|{r['detail']}".encode("utf-8")
        ).hexdigest()
        if r["prev_hash"] != prev or expected != r["row_hash"]:
            return {"ok": False, "broken_at": r["id"], "verified": count}
        prev = r["row_hash"]
        count += 1
    return {"ok": True, "verified": count}



# ---------------------------------------------------------------------------
# Seed - 6 months of realistic DTF / print-shop stock purchases
# ---------------------------------------------------------------------------
BRANCH_SEED = ["Main Plant", "Accra Shop"]

PRODUCT_SEED = [
    ("DTF Powder",              "bag",     (80, 140), (40, 200)),
    ("PET Film - A3",           "roll",    (90, 160), (8, 40)),
    ("CMYK DTF Ink Set",        "set",     (700, 1200), (2, 8)),
    ("White DTF Ink",           "bottle",  (130, 240), (3, 12)),
    ("Hot-Melt Adhesive Powder", "bag",    (35, 65),  (15, 80)),
    ("Transfer Paper - A3",     "pack",    (45, 90),  (20, 90)),
    ("Heat Transfer Tape",      "roll",    (25, 55),  (4, 20)),
    ("Blank T-Shirts",          "piece",   (18, 42),  (30, 120)),
]

DIST_SEED = [
    "Ceda Industrial Supplies", "GoldLink Printing Distributors",
    "Future Ink Services", "TransDream Films", "UrbanStock Supplies",
    "Kumasi Bulk Traders",
]

PRODUCT_DIST = {
    "DTF Powder": ["Ceda Industrial Supplies", "Kumasi Bulk Traders"],
    "PET Film - A3": ["TransDream Films", "GoldLink Printing Distributors"],
    "CMYK DTF Ink Set": ["Future Ink Services", "GoldLink Printing Distributors"],
    "White DTF Ink": ["Future Ink Services", "Ceda Industrial Supplies"],
    "Hot-Melt Adhesive Powder": ["Ceda Industrial Supplies", "Kumasi Bulk Traders"],
    "Transfer Paper - A3": ["UrbanStock Supplies", "GoldLink Printing Distributors"],
    "Heat Transfer Tape": ["UrbanStock Supplies"],
    "Blank T-Shirts": ["UrbanStock Supplies", "Kumasi Bulk Traders"],
}

PURCHASE_MEMOS = [
    "", "", "", "", "", "monthly restock", "big job forward order",
    "client rush order", "warehouse stock-up",
]


def seed_demo(conn):
    rng = random.Random(11)
    today = dt.date.today()
    months = _month_list(today, 6)

    for name in BRANCH_SEED:
        conn.execute("INSERT INTO branches(name) VALUES (?)", (name,))
    dist_ids = {}
    for name in DIST_SEED:
        cur = conn.execute("INSERT INTO distributors(name) VALUES (?)", (name,))
        dist_ids[name] = cur.lastrowid
    prod_ids = {}
    for name, unit, _, _ in PRODUCT_SEED:
        cur = conn.execute("INSERT INTO products(name, unit_default) VALUES (?, ?)", (name, unit))
        prod_ids[name] = cur.lastrowid

    pm_weights = [38, 27, 18, 17]          # Cash, Bank, Mobile, Credit
    for (y, m) in months:
        last_day = calendar.monthrange(y, m)[1]
        is_current = (y, m) == (today.year, today.month)
        max_day = today.day if is_current else last_day
        branch = rng.choice([1, 2])         # 1=Main Plant, 2=Accra Shop

        count = rng.randint(9, 14)
        for _ in range(count):
            name, unit, (plo, phi), (qlo, qhi) = rng.choice(PRODUCT_SEED)
            day = rng.randint(1, min(28, max_day))
            qty = float(rng.randint(qlo, qhi))
            unit_price = round(rng.uniform(plo, phi), 2)
            total = round(qty * unit_price, 2)
            dist_name = rng.choice(PRODUCT_DIST[name])
            pm = rng.choices(PAYMENT_METHODS, weights=pm_weights)[0]
            memo = rng.choice(PURCHASE_MEMOS)

            credit_total = credit_paid = None
            if pm == "Credit":
                credit_total = total
                credit_paid = round(total * rng.uniform(0, 0.6), 2)

            conn.execute(
                """INSERT INTO purchases(date, branch_id, distributor_id, product_id,
                   product_name, unit, quantity, total_amount, unit_price,
                   payment_method, credit_total, credit_paid, memo)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (dt.date(y, m, day).isoformat(), branch, dist_ids[dist_name],
                 prod_ids[name], name, unit, qty, total, unit_price,
                 pm, credit_total, credit_paid, memo),
            )

    # settle a few older credit purchases and pay others down
    rows = conn.execute(
        """SELECT id, credit_total, credit_paid FROM purchases
           WHERE payment_method='Credit' AND credit_total > credit_paid
           ORDER BY date ASC"""
    ).fetchall()
    for idx, r in enumerate(rows):
        if idx % 3 == 0:                       # fully settled later
            amount = r["credit_total"] - r["credit_paid"]
        elif idx % 3 == 1:                     # partial pay-down
            amount = round((r["credit_total"] - r["credit_paid"]) * 0.5, 2)
        else:
            continue
        pay_date = dt.date.fromisoformat(
            conn.execute("SELECT date d FROM purchases WHERE id = ?", (r["id"],)).fetchone()["d"]
        ) + dt.timedelta(days=14)
        if pay_date <= today and amount > 0:
            conn.execute(
                "INSERT INTO credit_payments(purchase_id, date, amount, memo) VALUES (?,?,?,?)",
                (r["id"], pay_date.isoformat(), amount, "auto partial / full settlement"),
            )

    # seed a current-month budget from purchase history so the planner is alive
    rec = recommend_budget(conn, None, today.year, today.month)
    if rec:
        last_month = today.replace(day=1) - dt.timedelta(days=1)
        lm = last_month.strftime("%Y-%m")
        prev_spend = conn.execute(
            "SELECT COALESCE(SUM(total_amount), 0) s FROM purchases WHERE date LIKE ?",
            (lm + "-%",),
        ).fetchone()["s"]
        total = round(prev_spend * 1.05, -2) if prev_spend else 0
        save = round(total * 0.10, 2)
        if total > 0:
            conn.execute(
                "INSERT INTO budgets(branch_id, year, month, total_amount, save_amount, allocations_json)"
                " VALUES (NULL, ?, ?, ?, ?, ?)",
                (today.year, today.month, total, save, json.dumps(rec, ensure_ascii=False)),
            )

    conn.commit()


# ---------------------------------------------------------------------------
# Reporting / query helpers
# ---------------------------------------------------------------------------
def distributor_id(conn, name):
    if not name:
        return None
    row = conn.execute("SELECT id FROM distributors WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO distributors(name) VALUES (?)", (name.strip(),))
    return cur.lastrowid


def product_id(conn, name, unit):
    if not name:
        return None, name
    row = conn.execute("SELECT id, unit_default FROM products WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    if row:
        if unit and not row["unit_default"]:
            conn.execute("UPDATE products SET unit_default = ? WHERE id = ?", (unit, row["id"]))
        return row["id"], row["unit_default"] or unit or "bag"
    cur = conn.execute("INSERT INTO products(name, unit_default) VALUES (?, ?)", (name.strip(), unit or "bag"))
    return cur.lastrowid, unit or "bag"


def credit_stats(conn, purchase_id=None, branch_id=None):
    """Return rows with current paid_total / balance / percent per credit purchase."""
    where = ["p.payment_method = 'Credit'"]
    args = []
    if purchase_id is not None:
        where.append("p.id = ?")
        args.append(purchase_id)
    if branch_id is not None:
        where.append("p.branch_id = ?")
        args.append(branch_id)
    rows = conn.execute(
        f"""
        SELECT p.id, p.date, p.branch_id, p.product_name, p.unit, p.quantity,
               p.total_amount, p.credit_paid, p.memo, d.name AS distributor,
               b.name AS branch,
               COALESCE(SUM(cp.amount), 0) AS payments
        FROM purchases p
        LEFT JOIN distributors d ON d.id = p.distributor_id
        JOIN branches b ON b.id = p.branch_id
        LEFT JOIN credit_payments cp ON cp.purchase_id = p.id
        WHERE {" AND ".join(where)}
        GROUP BY p.id
        ORDER BY p.date DESC
        """,
        args,
    ).fetchall()
    out = []
    for r in rows:
        paid = float(r["credit_paid"] or 0) + float(r["payments"] or 0)
        total = float(r["total_amount"])
        balance = max(round(total - paid, 2), 0.0)
        percent = round(paid / total * 100, 1) if total else 0.0
        out.append({
            "id": r["id"], "date": r["date"], "branch_id": r["branch_id"],
            "branch": r["branch"], "product": r["product_name"], "unit": r["unit"],
            "quantity": r["quantity"], "distributor": r["distributor"] or "",
            "total": total, "paid": round(paid, 2), "balance": balance,
            "percent": percent, "remaining": round(100 - percent, 1),
            "memo": r["memo"], "payments": [
                {"date": x["date"], "amount": x["amount"], "memo": x["memo"]}
                for x in conn.execute(
                    "SELECT date, amount, memo FROM credit_payments WHERE purchase_id = ? ORDER BY date",
                    (r["id"],),
                ).fetchall()
            ],
        })
    return out


def purchases_query(conn, params):
    where, args = ["1=1"], []
    if params.get("branch_id"):
        where.append("p.branch_id = ?")
        args.append(_to_int(params["branch_id"]))
    if params.get("month"):
        where.append("p.date LIKE ?")
        args.append(params["month"] + "-%")
    if params.get("frm"):
        where.append("p.date >= ?")
        args.append(params["frm"])
    if params.get("to"):
        where.append("p.date <= ?")
        args.append(params["to"])
    if params.get("distributor"):
        where.append("p.distributor_id = ?")
        args.append(_to_int(params["distributor"]))
    if params.get("product"):
        where.append("p.product_id = ?")
        args.append(_to_int(params["product"]))
    if params.get("payment"):
        where.append("p.payment_method = ?")
        args.append(params["payment"])
    if params.get("owed") == "1":
        where.append("p.payment_method = 'Credit'")
        where.append("p.credit_total > COALESCE(p.credit_paid,0) + "
                     "COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.purchase_id = p.id),0)")
    if params.get("q"):
        like = f"%{params['q']}%"
        where.append("(p.product_name LIKE ? OR p.memo LIKE ? OR p.unit LIKE ? OR d.name LIKE ?)")
        args.extend([like] * 4)

    base = f"""
        FROM purchases p
        LEFT JOIN distributors d ON d.id = p.distributor_id
        LEFT JOIN products pr  ON pr.id = p.product_id
        JOIN branches b ON b.id = p.branch_id
        WHERE {" AND ".join(where)}
    """
    total = conn.execute("SELECT COUNT(*) c " + base, args).fetchone()["c"]
    page = max(1, _to_int(params.get("page"), 1))
    page_size = min(200, max(1, _to_int(params.get("page_size"), 25)))
    pages = max(1, (total + page_size - 1) // page_size)

    rows = conn.execute(
        "SELECT p.*, d.name AS distributor, b.name AS branch " + base +
        " ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?",
        args + [page_size, (page - 1) * page_size],
    ).fetchall()

    out = []
    credit = {c["id"]: c for c in credit_stats(conn)} if total else {}
    for r in rows:
        cs = credit.get(r["id"])
        out.append({
            "id": r["id"], "date": r["date"], "branch_id": r["branch_id"],
            "branch": r["branch"], "distributor_id": r["distributor_id"],
            "distributor": r["distributor"] or "", "product_id": r["product_id"],
            "product": r["product_name"], "unit": r["unit"], "quantity": r["quantity"],
            "total": r["total_amount"], "unit_price": r["unit_price"],
            "payment_method": r["payment_method"], "memo": r["memo"],
            "credit": cs or None,
        })
    return {"rows": out, "total": total, "page": page, "pages": pages, "page_size": page_size}


def analytics(conn, branch_id=None, months=6):
    today = dt.date.today()
    ml = _month_list(today, months)
    first = dt.date(*ml[0], 1)
    scope = ""
    args = [first.isoformat()]
    if branch_id is not None:
        scope = "AND p.branch_id = ?"
        args.append(branch_id)

    by_item = conn.execute(
        f"""
        SELECT p.product_name, p.unit, COUNT(*) AS buys,
               SUM(p.quantity) AS qty, SUM(p.total_amount) AS spend,
               SUM(p.total_amount) / SUM(p.quantity) AS avg_unit
        FROM purchases p
        WHERE p.date >= ? {scope}
        GROUP BY p.product_id, p.product_name, p.unit
        ORDER BY spend DESC
        """,
        args,
    ).fetchall()

    by_dist = conn.execute(
        f"""
        SELECT COALESCE(d.name, '—') AS name, COUNT(*) AS buys,
               SUM(p.total_amount) AS spend, SUM(p.quantity) AS qty
        FROM purchases p LEFT JOIN distributors d ON d.id = p.distributor_id
        WHERE p.date >= ? {scope}
        GROUP BY d.id ORDER BY spend DESC
        """,
        args,
    ).fetchall()

    monthly = conn.execute(
        f"""
        SELECT substr(p.date,1,7) AS ym, COUNT(*) AS buys,
               SUM(p.total_amount) AS spend,
               SUM(CASE WHEN p.payment_method='Credit' THEN p.total_amount ELSE 0 END) AS credit_new
        FROM purchases p WHERE p.date >= ? {scope}
        GROUP BY ym ORDER BY ym
        """,
        args,
    ).fetchall()

    pay_split = conn.execute(
        f"""
        SELECT p.payment_method AS pm, COUNT(*) AS buys, SUM(p.total_amount) AS spend
        FROM purchases p WHERE p.date >= ? {scope}
        GROUP BY p.payment_method ORDER BY spend DESC
        """,
        args,
    ).fetchall()

    monthly_map = {r["ym"]: {"spend": r["spend"], "buys": r["buys"],
                             "credit_new": r["credit_new"]} for r in monthly}
    series = [{
        "month": f"{y:04d}-{m:02d}",
        "spend": round(monthly_map.get(f"{y:04d}-{m:02d}", {}).get("spend") or 0, 2),
        "buys": monthly_map.get(f"{y:04d}-{m:02d}", {}).get("buys") or 0,
        "credit_new": round(monthly_map.get(f"{y:04d}-{m:02d}", {}).get("credit_new") or 0, 2),
    } for y, m in ml]

    total_spend = sum(r["spend"] for r in by_item)
    top_items = [{
        "product": r["product_name"], "unit": r["unit"], "buys": r["buys"],
        "qty": r["qty"], "spend": round(r["spend"], 2),
        "avg_unit": round(r["avg_unit"], 2) if r["avg_unit"] else 0,
        "share": round(r["spend"] / total_spend * 100, 1) if total_spend else 0,
    } for r in by_item]

    # unit price trend for top 5 items
    unit_trend = []
    for item in top_items[:5]:
        pts = conn.execute(
            f"""
            SELECT substr(p.date,1,7) AS ym,
                   SUM(p.total_amount)/SUM(p.quantity) AS avg_unit, COUNT(*) AS n
            FROM purchases p
            WHERE p.product_name = ? AND p.date >= ? {scope}
            GROUP BY ym ORDER BY ym
            """,
            [item["product"], first.isoformat()] + ([branch_id] if branch_id is not None else []),
        ).fetchall()
        unit_trend.append({
            "product": item["product"],
            "points": [{"month": r["ym"], "avg": round(r["avg_unit"], 2)} for r in pts],
        })

    credits = credit_stats(conn, branch_id=branch_id)
    outstanding = sum(c["balance"] for c in credits)
    total_credit = sum(c["total"] for c in credits)

    return {
        "months": series,
        "top_items": top_items,
        "top_by_qty": sorted(top_items, key=lambda x: -x["qty"])[:8],
        "by_distributor": [{
            "name": r["name"], "buys": r["buys"], "spend": round(r["spend"], 2),
            "share": round(r["spend"] / total_spend * 100, 1) if total_spend else 0,
        } for r in by_dist],
        "payment_split": [{
            "method": r["pm"], "buys": r["buys"], "spend": round(r["spend"], 2),
        } for r in pay_split],
        "unit_trend": unit_trend,
        "totals": {
            "spend": round(total_spend, 2),
            "buys": sum(r["buys"] for r in by_item),
            "items": len(by_item),
            "distributors": len(by_dist),
            "credit_outstanding": round(outstanding, 2),
            "total_credit": round(total_credit, 2),
            "credit_cleared": round(total_credit - outstanding, 2),
            "open_credit_count": len([c for c in credits if c["balance"] > 0.005]),
        },
    }


def recommend_budget(conn, branch_id, year, month):
    """Historical spend weights (6 months before the target month) -> item %"""
    first, _ = _month_bounds(year, month)
    months_before = _month_list((first - dt.timedelta(days=1)).replace(day=1), 6)
    hist_start = dt.date(*months_before[0], 1)
    scope = ""
    args = [hist_start.isoformat(), first.isoformat()]
    if branch_id is not None:
        scope = "AND p.branch_id = ?"
        args.insert(1, branch_id)

    rows = conn.execute(
        f"""
        SELECT p.product_name, SUM(p.total_amount) AS spend
        FROM purchases p
        WHERE p.date >= ? {scope} AND p.date < ?
        GROUP BY p.product_id, p.product_name
        ORDER BY spend DESC
        """,
        args,
    ).fetchall()
    total = sum(r["spend"] for r in rows) or 0
    if total <= 0:
        return []
    weights = [(r["product_name"], r["spend"] / total * 100) for r in rows[:6]]
    other = sum(r["spend"] for r in rows[6:])
    if other > total * 0.02:
        weights.append(("Other items", other / total * 100))
    # round to whole percent, fix drift on the biggest
    rounded = [(n, round(w, 1)) for n, w in weights]
    drift = 100 - sum(w for _, w in rounded)
    if rounded:
        rounded[0] = (rounded[0][0], round(rounded[0][1] + drift, 1))
    return [{"name": n, "percent": w} for n, w in rounded]


def budget_view(conn, branch_id, year, month):
    row = conn.execute(
        "SELECT * FROM budgets WHERE branch_id IS ? AND year = ? AND month = ?",
        (branch_id, year, month),
    ).fetchone()
    rec = recommend_budget(conn, branch_id, year, month)
    if row:
        alloc = json.loads(row["allocations_json"] or "[]")
        total, save = row["total_amount"], row["save_amount"]
        saved = True
    else:
        alloc = rec
        # default: last real month's spend as a starting budget + 10% suggested savings
        hist_spend = 0.0
        month_map = {s["month"]: s["spend"] for s in analytics(conn, branch_id, 12)["months"]}
        for hy, hm in _month_list(dt.date.today(), 4):
            val = month_map.get(f"{hy:04d}-{hm:02d}")
            if val:
                hist_spend = val
        total = round(hist_spend, -2) if hist_spend else 0
        save = round(total * 0.10, 2) if total else 0
        saved = False

    spendable = max(total - save, 0)
    scope = ""
    args = []
    if branch_id is not None:
        scope = "AND p.branch_id = ?"
        args.append(branch_id)
    spend_rows = conn.execute(
        f"SELECT p.product_name, SUM(p.total_amount) AS sp FROM purchases p WHERE 1=1 {scope}"
        " AND p.date LIKE ? GROUP BY p.product_name ORDER BY sp DESC",
        args + [f"{year:04d}-{month:02d}-%"],
    ).fetchall()
    actual = {r["product_name"]: round(float(r["sp"]), 2) for r in spend_rows}

    return {
        "saved": saved, "branch_id": branch_id, "year": year, "month": month,
        "total_amount": total, "save_amount": save, "spendable": round(spendable, 2),
        "allocations": [{
            "name": a["name"], "percent": a["percent"],
            "amount": round(spendable * a["percent"] / 100, 2),
            "actual": round(actual.get(a["name"]) or 0, 2),
        } for a in alloc],
        "recommended": rec,
        "actual_spend": round(sum(actual.values()), 2),
    }


def meta(conn):
    branches = [{"id": r["id"], "name": r["name"]} for r in conn.execute(
        "SELECT id, name FROM branches ORDER BY id").fetchall()]
    distributors = [r["name"] for r in conn.execute("SELECT name FROM distributors ORDER BY name").fetchall()]
    distributor_options = [{"id": r["id"], "name": r["name"]} for r in conn.execute(
        "SELECT id, name FROM distributors ORDER BY name").fetchall()]
    products = [{"name": r["name"], "unit": r["unit_default"]} for r in conn.execute(
        "SELECT name, unit_default FROM products ORDER BY name").fetchall()]
    product_options = [{"id": r["id"], "name": r["name"]} for r in conn.execute(
        "SELECT id, name FROM products ORDER BY name").fetchall()]
    months = [r["m"] for r in conn.execute(
        "SELECT DISTINCT substr(date,1,7) m FROM purchases ORDER BY m DESC").fetchall()]
    return {
        "currency": CURRENCY,
        "branches": branches,
        "distributors": distributors,
        "distributor_options": distributor_options,
        "products": products,
        "product_options": product_options,
        "payment_methods": PAYMENT_METHODS,
        "units": UNIT_SUGGESTIONS,
        "months": months,
    }


# ---------------------------------------------------------------------------
# Export (CSV / JSON) - all readable business records for research / legal
# ---------------------------------------------------------------------------
EXPORT_KINDS = ("purchases", "credits", "budgets", "audit", "analytics")


def _records_from(rows):
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if isinstance(v, (list, dict)):
                d[k] = json.dumps(v, ensure_ascii=False)
        out.append(d)
    return out


def export_records(conn, kind, branch_id=None):
    """Return an ordered list of flat dict records for the given export kind."""
    if kind == "purchases":
        rows = conn.execute(
            """SELECT p.id, p.date, b.name AS branch, d.name AS distributor,
                      p.product_name AS product, p.unit, p.quantity, p.unit_price,
                      p.total_amount, p.payment_method, p.credit_total, p.credit_paid,
                      p.memo, p.created_at
               FROM purchases p
               LEFT JOIN branches b ON b.id = p.branch_id
               LEFT JOIN distributors d ON d.id = p.distributor_id
               ORDER BY p.date DESC, p.id DESC"""
        ).fetchall()
        return _records_from(rows)
    if kind == "credits":
        recs = []
        for c in credit_stats(conn, branch_id=branch_id):
            d = dict(c)
            d["payments"] = json.dumps(d.get("payments", []), ensure_ascii=False)
            recs.append(d)
        return recs
    if kind == "budgets":
        rows = conn.execute(
            """SELECT bu.id, bu.year, bu.month, b.name AS branch, bu.total_amount,
                      bu.save_amount, bu.allocations_json AS allocations, bu.updated_at
               FROM budgets bu LEFT JOIN branches b ON b.id = bu.branch_id
               ORDER BY bu.year DESC, bu.month DESC"""
        ).fetchall()
        return _records_from(rows)
    if kind == "audit":
        rows = conn.execute(
            "SELECT id, ts, actor, action, detail, ip, prev_hash, row_hash"
            " FROM audit_log ORDER BY id DESC"
        ).fetchall()
        return _records_from(rows)
    if kind == "analytics":
        return [analytics(conn, branch_id=branch_id, months=12)]
    return None


def to_csv(records):
    if not records:
        return ""
    cols = []
    for rec in records:
        for k in rec.keys():
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for rec in records:
        w.writerow(rec)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, body, status=200, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj, status=200, headers=None):
        self._send(json.dumps(obj, ensure_ascii=False), status, extra=headers)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    # -- cookies / identity ---------------------------------------------------
    def _cookie(self, name):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        for part in raw.split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v or None
        return None

    def _cookie_header(self, value, max_age=None):
        parts = [f"{COOKIE_NAME}={value}", "Path=/", "HttpOnly", "SameSite=Lax"]
        parts.append(f"Max-Age={SESSION_DAYS * 86400 if max_age is None else max_age}")
        if self.headers.get("X-Forwarded-Proto") == "https":
            parts.append("Secure")
        return "; ".join(parts)

    def _ip(self):
        fwd = self.headers.get("X-Forwarded-For")
        if fwd:
            return fwd.split(",")[0].strip()[:45]
        return self.address_string()

    def _actor(self, conn):
        return get_session(conn, self._cookie(COOKIE_NAME)) or "app"

    def _api(self, method, path, qs, payload):
        conn = get_db()
        actor = self._actor(conn)
        ip = self._ip()
        try:
            # ---- meta & misc ---------------------------------------------
            if path == "/api/health":
                return self.send_json({"ok": True})
            if path == "/api/meta":
                return self.send_json(meta(conn))

            # ---- branches ---------------------------------------------------
            if path == "/api/branches" and method == "GET":
                return self.send_json({"branches": meta(conn)["branches"]})
            if path == "/api/branches" and method == "POST":
                name = str(payload.get("name") or "").strip()[:60]
                if not name:
                    return self.send_json({"error": "branch name is required"}, 400)
                try:
                    cur = conn.execute("INSERT INTO branches(name) VALUES (?)", (name,))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "branch already exists"}, 400)
                conn.commit()
                audit(conn, actor, "branch.create", f"id={cur.lastrowid} name={name}", ip)
                self.send_json({"ok": True, "id": cur.lastrowid, "name": name}, 201)
                return

            # ---- dropdown data ----------------------------------------------
            if path == "/api/distributors" and method == "GET":
                return self.send_json({"distributors": meta(conn)["distributors"]})
            if path == "/api/products" and method == "GET":
                return self.send_json({"products": meta(conn)["products"]})

            # ---- purchases ----------------------------------------------------
            if path == "/api/purchases" and method == "GET":
                p = {k: (v[0] if v else "") for k, v in qs.items()}
                return self.send_json(purchases_query(conn, p))
            if path == "/api/purchases" and method == "POST":
                return self._create_purchase(conn, payload)

            m = re.match(r"^/api/purchases/(\d+)/(pay|move)$", path)
            if m and method == "POST":
                pid = int(m.group(1))
                if conn.execute("SELECT id FROM purchases WHERE id = ?", (pid,)).fetchone() is None:
                    return self.send_json({"error": "purchase not found"}, 404)
                if m.group(2) == "move":
                    bid = _to_int(payload.get("branch_id"))
                    if not bid:
                        return self.send_json({"error": "branch_id required"}, 400)
                    conn.execute("UPDATE purchases SET branch_id = ? WHERE id = ?", (bid, pid))
                    conn.commit()
                    audit(conn, actor, "purchase.move", f"id={pid} -> branch {bid}", ip)
                    self.send_json({"ok": True, "id": pid})
                    return
                # pay toward credit
                date = self._valid_date(payload, conn)
                if isinstance(date, str):
                    return self.send_json({"error": date}, 400)
                amount = _to_float(payload.get("amount"))
                cs = credit_stats(conn, purchase_id=pid)
                if not cs:
                    return self.send_json({"error": "not a credit purchase"}, 400)
                balance = cs[0]["balance"]
                if amount <= 0:
                    return self.send_json({"error": "amount must be greater than zero"}, 400)
                if amount > balance + 0.005:
                    return self.send_json({"error": f"amount exceeds remaining balance ({CURRENCY}{balance:,.2f})"}, 400)
                conn.execute(
                    "INSERT INTO credit_payments(purchase_id, date, amount, memo) VALUES (?,?,?,?)",
                    (pid, date.isoformat(), amount, str(payload.get("memo") or "").strip()[:120]),
                )
                conn.commit()
                audit(conn, actor, "credit.payment", f"purchase {pid} +{amount}", ip)
                self.send_json({"ok": True, "id": pid, "credit": credit_stats(conn, purchase_id=pid)[0]}, 201)
                return

            m = re.match(r"^/api/purchases/(\d+)$", path)
            if m and method == "DELETE":
                pid = int(m.group(1))
                if conn.execute("SELECT id FROM purchases WHERE id = ?", (pid,)).fetchone() is None:
                    return self.send_json({"error": "purchase not found"}, 404)
                conn.execute("DELETE FROM purchases WHERE id = ?", (pid,))
                conn.commit()
                audit(conn, actor, "purchase.delete", f"id={pid}", ip)
                return self.send_json({"ok": True})

            # ---- credits ----------------------------------------------------------
            if path == "/api/credits" and method == "GET":
                bid = _to_int((qs.get("branch_id") or [""])[0]) or None
                rows = credit_stats(conn, branch_id=bid)
                open_rows = [r for r in rows if r["balance"] > 0.005]
                closed = [r for r in rows if r["balance"] <= 0.005]
                return self.send_json({
                    "open": open_rows, "settled": closed,
                    "outstanding": round(sum(r["balance"] for r in rows), 2),
                    "open_count": len(open_rows),
                })

            # ---- analytics -----------------------------------------------------------
            if path == "/api/analytics" and method == "GET":
                bid = _to_int((qs.get("branch_id") or [""])[0]) or None
                n = min(24, max(3, _to_int(qs.get("n") and qs["n"][0], 6)))
                return self.send_json(analytics(conn, branch_id=bid, months=n))

            # ---- budget --------------------------------------------------------------
            if path == "/api/budget" and method == "GET":
                year = _to_int((qs.get("year") or [""])[0]) or dt.date.today().year
                month = _to_int((qs.get("month") or [""])[0]) or dt.date.today().month
                bid_raw = (qs.get("branch_id") or [""])[0]
                bid = _to_int(bid_raw) if bid_raw not in ("", "all") else None
                return self.send_json(budget_view(conn, bid, year, month))
            if path == "/api/budget" and method == "POST":
                year = _to_int(payload.get("year")) or dt.date.today().year
                month = _to_int(payload.get("month")) or dt.date.today().month
                bid_raw = payload.get("branch_id")
                bid = _to_int(bid_raw) if bid_raw not in (None, "", "all") else None
                total = _to_float(payload.get("total_amount"))
                save = _to_float(payload.get("save_amount"))
                alloc = payload.get("allocations")
                if alloc not in (None, []):
                    alloc = [{"name": str(a.get("name")), "percent": _to_float(a.get("percent"))} for a in alloc]
                else:
                    alloc = recommend_budget(conn, bid, year, month)
                if total <= 0:
                    self.send_json({"error": "total_amount must be greater than zero"}, 400)
                    return
                # explicit delete-then-insert: SQLite UNIQUE treats NULLs as distinct,
                # so "All branches" (branch_id IS NULL) needs manual dedupe.
                conn.execute(
                    "DELETE FROM budgets WHERE year = ? AND month = ? AND "
                    "(branch_id = ? OR (branch_id IS NULL AND ? IS NULL))",
                    (year, month, bid, bid),
                )
                conn.execute(
                    """INSERT INTO budgets(branch_id, year, month, total_amount, save_amount, allocations_json)
                       VALUES (?,?,?,?,?,?)""",
                    (bid, year, month, total, save, json.dumps(alloc, ensure_ascii=False)),
                )
                conn.commit()
                audit(conn, actor, "budget.save",
                      f"{year:04d}-{month:02d} branch={bid} total={total} save={save}", ip)
                return self.send_json({"ok": True, **budget_view(conn, bid, year, month)})

            return self.send_json({"error": "not found"}, 404)
        finally:
            conn.close()

    def _valid_date(self, payload, conn):
        raw = str(payload.get("date") or "").strip()
        try:
            return dt.date.fromisoformat(raw)
        except ValueError:
            return "date must be YYYY-MM-DD"

    def _create_purchase(self, conn, payload):
        date = self._valid_date(payload, conn)
        if isinstance(date, str):
            return self.send_json({"error": date}, 400)

        bid = _to_int(payload.get("branch_id"))
        branch = conn.execute("SELECT id FROM branches WHERE id = ?", (bid,)).fetchone() if bid else None
        if not branch:
            return self.send_json({"error": "a valid branch_id is required"}, 400)

        qty = _to_float(payload.get("quantity"))
        if qty <= 0:
            return self.send_json({"error": "quantity must be greater than zero"}, 400)

        total = _to_float(payload.get("total_amount"))
        if total <= 0:
            return self.send_json({"error": "total amount must be greater than zero"}, 400)

        pm = str(payload.get("payment_method") or "").strip()
        if pm not in PAYMENT_METHODS:
            return self.send_json({"error": f"payment_method must be one of: {', '.join(PAYMENT_METHODS)}"}, 400)

        unit = str(payload.get("unit") or "").strip()[:20] or "bag"
        product_raw = str(payload.get("product") or "").strip()[:80]
        if not product_raw:
            return self.send_json({"error": "product name is required"}, 400)
        dist_raw = str(payload.get("distributor") or "").strip()[:80]
        if not dist_raw:
            return self.send_json({"error": "distributor name is required"}, 400)

        did = distributor_id(conn, dist_raw)
        p_id, unit = product_id(conn, product_raw, unit)
        unit_price = round(total / qty, 4)

        credit_total = credit_paid = None
        if pm == "Credit":
            credit_total = total
            credit_paid = _to_float(payload.get("credit_paid"))
            if credit_paid < 0:
                credit_paid = 0.0
            if credit_paid > total + 0.005:
                return self.send_json(
                    {"error": f"amount paid ({CURRENCY}{credit_paid:,.2f}) cannot exceed the original price ({CURRENCY}{total:,.2f})"},
                    400,
                )
            credit_paid = round(credit_paid, 2)

        memo = str(payload.get("memo") or "").strip()[:140]
        cur = conn.execute(
            """INSERT INTO purchases(date, branch_id, distributor_id, product_id,
               product_name, unit, quantity, total_amount, unit_price,
               payment_method, credit_total, credit_paid, memo)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (date.isoformat(), bid, did, p_id, product_raw, unit, qty, total,
             unit_price, pm, credit_total, credit_paid, memo),
        )
        conn.commit()
        audit(conn, self._actor(conn), "purchase.create",
              f"id={cur.lastrowid} {product_raw} qty={qty} total={total} method={pm}",
              self._ip())
        cs = None
        if pm == "Credit":
            cs = credit_stats(conn, purchase_id=cur.lastrowid)[0]
        return self.send_json({"ok": True, "id": cur.lastrowid, "credit": cs}, 201)

    # -- protected admin API (single user) ------------------------------------
    def _admin_api(self, method, path, qs, payload):
        conn = get_db()
        try:
            ip = self._ip()
            token = self._cookie(COOKIE_NAME)
            actor = get_session(conn, token)

            # public: session probe
            if path == "/admin/api/session" and method == "GET":
                return self.send_json({
                    "authed": bool(actor), "username": actor,
                    "signup_required": not admin_exists(conn),
                })

            # public: first-run signup (locks the single account)
            if path == "/admin/api/signup" and method == "POST":
                if admin_exists(conn):
                    return self.send_json({"error": "account already created"}, 403)
                username = str((payload or {}).get("username") or "").strip()[:40]
                password = str((payload or {}).get("password") or "")
                if len(username) < 3:
                    return self.send_json({"error": "username must be at least 3 characters"}, 400)
                if len(password) < 8:
                    return self.send_json({"error": "password must be at least 8 characters"}, 400)
                create_admin_user(conn, username, password)
                new_token = create_session(conn, username)
                audit(conn, username, "admin.signup", "account created", ip)
                return self.send_json(
                    {"ok": True, "username": username}, 200,
                    {"Set-Cookie": self._cookie_header(new_token)},
                )

            # public: login
            if path == "/admin/api/login" and method == "POST":
                wait = _throttle_check(ip)
                if wait > 0:
                    return self.send_json({"error": f"too many attempts, retry in {wait}s"}, 429)
                username = str((payload or {}).get("username") or "").strip()
                password = str((payload or {}).get("password") or "")
                user = verify_admin(conn, username, password)
                if not user:
                    _throttle_fail(ip)
                    audit(conn, username or "anonymous", "admin.login_failed", "bad credentials", ip)
                    return self.send_json({"error": "invalid username or password"}, 401)
                _throttle_clear(ip)
                new_token = create_session(conn, user)
                audit(conn, user, "admin.login", "session started", ip)
                return self.send_json(
                    {"ok": True, "username": user}, 200,
                    {"Set-Cookie": self._cookie_header(new_token)},
                )

            # public: logout
            if path == "/admin/api/logout" and method == "POST":
                if actor:
                    audit(conn, actor, "admin.logout", "session ended", ip)
                destroy_session(conn, token)
                return self.send_json(
                    {"ok": True}, 200, {"Set-Cookie": self._cookie_header("", max_age=0)}
                )

            # ---- everything below requires a valid session ----
            if not actor:
                return self.send_json({"error": "authentication required"}, 401)

            bid = _to_int((qs.get("branch_id") or [""])[0]) or None

            if path == "/admin/api/analytics" and method == "GET":
                n = min(24, max(3, _to_int((qs.get("n") or ["6"])[0], 6)))
                return self.send_json(analytics(conn, branch_id=bid, months=n))

            if path == "/admin/api/overview" and method == "GET":
                m = meta(conn)
                a = analytics(conn, branch_id=bid, months=12)
                counts = {
                    "purchases": conn.execute("SELECT COUNT(*) c FROM purchases").fetchone()["c"],
                    "branches": len(m["branches"]),
                    "distributors": len(m["distributor_options"]),
                    "products": len(m["product_options"]),
                    "audit_entries": conn.execute("SELECT COUNT(*) c FROM audit_log").fetchone()["c"],
                }
                return self.send_json({
                    "username": actor, "meta": m, "totals": a["totals"],
                    "months": a["months"], "counts": counts,
                    "top_items": a["top_items"][:8],
                    "by_distributor": a["by_distributor"],
                    "payment_split": a["payment_split"],
                    "audit": audit_verify(conn),
                })

            if path == "/admin/api/audit" and method == "GET":
                limit = min(1000, max(1, _to_int((qs.get("limit") or ["200"])[0], 200)))
                offset = max(0, _to_int((qs.get("offset") or ["0"])[0], 0))
                data = audit_list(conn, limit, offset)
                data["verify"] = audit_verify(conn)
                return self.send_json(data)

            if path == "/admin/api/export" and method == "GET":
                kind = (qs.get("type") or ["purchases"])[0]
                fmt = (qs.get("format") or ["csv"])[0].lower()
                if kind not in EXPORT_KINDS:
                    return self.send_json({"error": f"unknown export type '{kind}'"}, 400)
                if fmt not in ("csv", "json"):
                    return self.send_json({"error": "format must be csv or json"}, 400)
                records = export_records(conn, kind, branch_id=bid)
                audit(conn, actor, "data.export",
                      f"type={kind} format={fmt} rows={len(records)}", ip)
                stamp = _utcnow().strftime("%Y%m%d-%H%M%S")
                fname = f"pwbudget-{kind}-{stamp}.{fmt}"
                if fmt == "json":
                    body = json.dumps(records, ensure_ascii=False, indent=2)
                    ctype = "application/json; charset=utf-8"
                else:
                    body = to_csv(records)
                    ctype = "text/csv; charset=utf-8"
                return self._send(body, 200, ctype, {
                    "Content-Disposition": f'attachment; filename="{fname}"',
                })

            return self.send_json({"error": "not found"}, 404)
        finally:
            conn.close()

    # -- HTTP verbs -----------------------------------------------------------
    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/admin/api/"):
                self._admin_api("GET", parsed.path, parse_qs(parsed.query), None)
            elif parsed.path.startswith("/api/"):
                self._api("GET", parsed.path, parse_qs(parsed.query), None)
            else:
                self._static(parsed.path)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            if not (parsed.path.startswith("/api/") or parsed.path.startswith("/admin/api/")):
                return self.send_json({"error": "not found"}, 404)
            payload = self._read_body()
            if payload is None:
                return self.send_json({"error": "invalid JSON body"}, 400)
            if parsed.path.startswith("/admin/api/"):
                self._admin_api("POST", parsed.path, parse_qs(parsed.query), payload)
            else:
                self._api("POST", parsed.path, parse_qs(parsed.query), payload)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/admin/api/"):
                return self._admin_api("DELETE", parsed.path, parse_qs(parsed.query), None)
            if not parsed.path.startswith("/api/"):
                return self.send_json({"error": "not found"}, 404)
            self._api("DELETE", parsed.path, parse_qs(parsed.query), None)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    # -- static ---------------------------------------------------------------
    def _static(self, path):
        if path == "/":
            path = "/index.html"
        elif path.endswith("/"):
            path += "index.html"
        fp = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if not str(fp).startswith(str(PUBLIC_DIR.resolve())) or not fp.is_file():
            return self.send_json({"error": "not found"}, 404)
        ctype = MIME.get(fp.suffix.lower(), "application/octet-stream")
        self._send(fp.read_bytes(), 200, ctype)


def init_db():
    fresh = not DB_PATH.exists()
    conn = get_db()
    conn.executescript(SCHEMA)
    if fresh and conn.execute("SELECT COUNT(*) c FROM branches").fetchone()["c"] == 0:
        if "--demo" in sys.argv or "--seed" in sys.argv:
            seed_demo(conn)
        else:
            # clean start: one default branch, nothing else — no test data
            conn.execute("INSERT INTO branches(name) VALUES (?)", ("Main Shop",))
        conn.commit()
    # optionally pre-seed the single admin account from the environment
    env_user = os.environ.get("PWBUDGET_ADMIN_USER")
    env_pass = os.environ.get("PWBUDGET_ADMIN_PASS")
    if env_user and env_pass and not admin_exists(conn):
        create_admin_user(conn, env_user.strip()[:40], env_pass)
        audit(conn, env_user.strip()[:40], "admin.signup", "account seeded from environment", "")
    # drop expired sessions
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_utcnow().isoformat(),))
    conn.commit()
    conn.close()


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    shown = "127.0.0.1" if HOST in ("0.0.0.0", "::") else HOST
    print(f"\n  PW Budget - Stock, Distributor, Credit & Analytics")
    print(f"  http://{shown}:{PORT}")
    print(f"  Admin dashboard: http://{shown}:{PORT}/admin/")
    print(f"  Database: {DB_PATH}")
    print(f"  Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()