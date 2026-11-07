import { Database } from "bun:sqlite";

/** The Shelf schema. Every statement is "IF NOT EXISTS", so opening an existing database never changes its data. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  author      TEXT,
  url         TEXT,
  kind        TEXT NOT NULL DEFAULT 'book' CHECK (kind IN ('book', 'article')),
  status      TEXT NOT NULL DEFAULT 'to_read' CHECK (status IN ('to_read', 'reading', 'done')),
  rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  UNIQUE (item_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_by_tag ON tags(tag);
CREATE TABLE IF NOT EXISTS goals (
  year  INTEGER PRIMARY KEY CHECK (year BETWEEN 0 AND 9999),
  books INTEGER NOT NULL CHECK (books BETWEEN 1 AND 1000)
);
`;

/** Opens (or creates) the Shelf database at `path` (a file path or ":memory:") and ensures the schema exists. */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
