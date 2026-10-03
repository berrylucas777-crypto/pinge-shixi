import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "pingo.db"

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  school TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  major TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  wants TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  learn_tags TEXT NOT NULL DEFAULT '[]',
  intro TEXT NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT '',
  looking_for TEXT NOT NULL DEFAULT '',
  prefer_same_city INTEGER NOT NULL DEFAULT 1,
  xhs TEXT NOT NULL DEFAULT '',
  letter TEXT NOT NULL DEFAULT 'P',
  tone TEXT NOT NULL DEFAULT 'blue',
  referral_code TEXT NOT NULL UNIQUE,
  invited_by_user_id INTEGER,
  is_seed INTEGER NOT NULL DEFAULT 0,
  is_pro INTEGER NOT NULL DEFAULT 0,
  pro_purchased_at TEXT,
  boost_until REAL NOT NULL DEFAULT 0,
  boost_period TEXT NOT NULL DEFAULT '',
  consent_version TEXT NOT NULL DEFAULT '',
  consented_at TEXT,
  content_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  can_share TEXT NOT NULL,
  wants TEXT NOT NULL,
  shared_tags TEXT NOT NULL DEFAULT '[]',
  period TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, rank),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_user_id, to_user_id),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_views (
  user_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, candidate_id, period),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_user_id INTEGER NOT NULL,
  target_user_id INTEGER,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pinpin_payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  order_code TEXT NOT NULL UNIQUE,
  payer_nickname TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 1000,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id, rank);
CREATE INDEX IF NOT EXISTS idx_users_seed ON users(is_seed);
CREATE INDEX IF NOT EXISTS idx_views_user_period ON member_views(user_id, period);
CREATE INDEX IF NOT EXISTS idx_pinpin_payment_requests_status ON pinpin_payment_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_created ON import_batches(created_at);
"""

MIGRATIONS = {
    "users": {
        "major": "TEXT NOT NULL DEFAULT ''",
        "learn_tags": "TEXT NOT NULL DEFAULT '[]'",
        "experience": "TEXT NOT NULL DEFAULT ''",
        "looking_for": "TEXT NOT NULL DEFAULT ''",
        "prefer_same_city": "INTEGER NOT NULL DEFAULT 1",
        "xhs": "TEXT NOT NULL DEFAULT ''",
        "is_pro": "INTEGER NOT NULL DEFAULT 0",
        "pro_purchased_at": "TEXT",
        "boost_until": "REAL NOT NULL DEFAULT 0",
        "boost_period": "TEXT NOT NULL DEFAULT ''",
        "consent_version": "TEXT NOT NULL DEFAULT ''",
        "consented_at": "TEXT",
        "content_confirmed_at": "TEXT",
        "updated_at": "TEXT NOT NULL DEFAULT ''",
    },
    "matches": {"period": "TEXT NOT NULL DEFAULT ''"},
    "sessions": {"expires_at": "REAL NOT NULL DEFAULT 0"},
    "login_codes": {"attempts": "INTEGER NOT NULL DEFAULT 0"},
}


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, columns in MIGRATIONS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, declaration in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        _add_missing_columns(conn)
