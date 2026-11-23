'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  uni_no     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  major      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'Other',
  location    TEXT NOT NULL DEFAULT '',
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 0,
  credits     REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('hidden','announced','open','closed','done')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS events_start ON events(starts_at);

CREATE TABLE IF NOT EXISTS registrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uni_no      TEXT NOT NULL REFERENCES students(uni_no) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'online',
  attended    INTEGER NOT NULL DEFAULT 0,
  attended_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
  UNIQUE (event_id, uni_no)
);
CREATE INDEX IF NOT EXISTS registrations_uni ON registrations(uni_no);

-- CSO credits ledger. auto = 1 rows come from event attendance and follow it.
CREATE TABLE IF NOT EXISTS credits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uni_no     TEXT NOT NULL REFERENCES students(uni_no) ON DELETE CASCADE,
  amount     REAL NOT NULL,
  reason     TEXT NOT NULL,
  event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,
  auto       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS credits_uni ON credits(uni_no);
CREATE UNIQUE INDEX IF NOT EXISTS credits_auto_once ON credits(event_id, uni_no) WHERE auto = 1;

CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Committee',
  season      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  uni_no  TEXT NOT NULL REFERENCES students(uni_no) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'Member',
  PRIMARY KEY (team_id, uni_no)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx };
