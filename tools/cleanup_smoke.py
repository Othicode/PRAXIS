"""Remove any smoke-test data left over from headless harness runs.
Keeps the DB clean for real use. Pure stdlib."""
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "ledger.db"
conn = sqlite3.connect(DB)
conn.execute("DELETE FROM purchases WHERE memo LIKE 'smoke-%'")
# Money-in rows written by smoke_test.js: the manual entry carries the run
# stamp as its memo, the statement-imported ones use a SMK reference.
conn.execute("DELETE FROM income WHERE memo LIKE 'smoke-%' OR reference LIKE 'SMK%' "
             "OR source LIKE 'Smoke takings%'")
conn.execute("DELETE FROM branches WHERE name LIKE 'Smoke Branch %'")
conn.execute("DELETE FROM distributors WHERE name LIKE 'Smoke %'")
conn.execute("DELETE FROM products WHERE name LIKE 'Smoke %'")
# The scan-flow fixtures in smoke_test.js are saved through the ordinary
# /api/purchases path, so they never carry a `smoke-` memo — but creating a
# purchase is what makes their distributor/product rows. Now that the
# purchases above are gone they are orphans, listed by name on purpose:
# never a wildcard, and only when no purchase still references them, so a
# real row with history can never be caught in this.
for name in ("Alpha Inks", "Ceda Industrial Supplies", "Ceda"):
    conn.execute(
        "DELETE FROM distributors WHERE name = ? AND NOT EXISTS ("
        "SELECT 1 FROM purchases p WHERE p.distributor_id = distributors.id)",
        (name,))
for name in ("Ink Set", "Foil", "DTF Powder"):
    conn.execute(
        "DELETE FROM products WHERE name = ? AND NOT EXISTS ("
        "SELECT 1 FROM purchases p WHERE p.product_id = products.id)",
        (name,))
conn.commit()
print("branches :", [r[1] for r in conn.execute("SELECT id, name FROM branches")])
print("distribs :", conn.execute("SELECT COUNT(*) FROM distributors").fetchone()[0])
print("products :", conn.execute("SELECT COUNT(*) FROM products").fetchone()[0])
print("purchases:", conn.execute("SELECT COUNT(*) FROM purchases").fetchone()[0], "| credits:",
      conn.execute("SELECT COUNT(*) FROM credit_payments").fetchone()[0])