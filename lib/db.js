// Database layer — uses Node's built-in SQLite (Node 22.5+), no packages needed.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'humanizeedu.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    level         TEXT NOT NULL DEFAULT 'Undergraduate',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    tone          TEXT NOT NULL,
    citation      TEXT NOT NULL,
    original_text TEXT NOT NULL,
    humanized     TEXT NOT NULL,
    report_json   TEXT NOT NULL,
    engine        TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(user_id, id DESC);
`);

const q = {
  createUser: db.prepare('INSERT INTO users (name, email, password_hash, level) VALUES (?, ?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id, name, email, level, created_at FROM users WHERE id = ?'),
  updateUser: db.prepare('UPDATE users SET name = ?, level = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  createSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.id, u.name, u.email, u.level, u.created_at
                           FROM sessions s JOIN users u ON u.id = s.user_id
                           WHERE s.token_hash = ? AND s.expires_at > ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  createDoc: db.prepare(`INSERT INTO documents (user_id, title, tone, citation, original_text, humanized, report_json, engine)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  listDocs: db.prepare(`SELECT id, title, tone, engine, created_at, substr(original_text, 1, 140) AS preview
                        FROM documents WHERE user_id = ? ORDER BY id DESC LIMIT 100`),
  getDoc: db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?'),
  deleteDoc: db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?'),
  countDocs: db.prepare('SELECT COUNT(*) AS n FROM documents WHERE user_id = ?'),
};

module.exports = { db, q };
