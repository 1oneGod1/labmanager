const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

let DatabaseSync;
let sqliteBackup;

try {
  ({ DatabaseSync, backup: sqliteBackup } = require('node:sqlite'));
} catch (error) {
  throw new Error(
    `Runtime Node.js ini belum mendukung SQLite bawaan. Gunakan Node.js 24 atau aplikasi Admin terinstal. (${error.message})`,
  );
}

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, cleanUndefined(entry)]),
    );
  }
  return value;
}

function serialize(value) {
  return JSON.stringify(cleanUndefined(value));
}

function deserialize(value) {
  return JSON.parse(value);
}

class SqliteDocumentStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    this.db = null;
    this.statements = null;
  }

  open() {
    if (this.db) return this;

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_documents_collection_updated
        ON documents (collection, updated_at_ms DESC);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
    `);

    this.statements = {
      list: this.db.prepare('SELECT id, data_json FROM documents WHERE collection = ?'),
      get: this.db.prepare('SELECT data_json FROM documents WHERE collection = ? AND id = ?'),
      insert: this.db.prepare(`
        INSERT INTO documents (collection, id, data_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?)
      `),
      replace: this.db.prepare(`
        INSERT INTO documents (collection, id, data_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(collection, id) DO UPDATE SET
          data_json = excluded.data_json,
          updated_at_ms = excluded.updated_at_ms
      `),
      remove: this.db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?'),
      getMetadata: this.db.prepare('SELECT value FROM metadata WHERE key = ?'),
      setMetadata: this.db.prepare(`
        INSERT INTO metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `),
    };

    const schemaVersion = this.getMetadata('schema_version');
    if (!schemaVersion) this.setMetadata('schema_version', '1');
    return this;
  }

  ensureOpen() {
    return this.open();
  }

  list(collection) {
    this.ensureOpen();
    return this.statements.list.all(collection).map((row) => ({
      id: row.id,
      ...deserialize(row.data_json),
    }));
  }

  get(collection, id) {
    this.ensureOpen();
    const row = this.statements.get.get(collection, String(id));
    return row ? { id: String(id), ...deserialize(row.data_json) } : null;
  }

  insert(collection, data, id = randomUUID()) {
    this.ensureOpen();
    const now = Date.now();
    const normalizedId = String(id);
    this.statements.insert.run(collection, normalizedId, serialize(data), now, now);
    return this.get(collection, normalizedId);
  }

  set(collection, id, data, { merge = false } = {}) {
    this.ensureOpen();
    const normalizedId = String(id);
    const existing = this.get(collection, normalizedId);
    const next = merge && existing
      ? { ...existing, ...cleanUndefined(data) }
      : cleanUndefined(data);
    delete next.id;
    const now = Date.now();
    this.statements.replace.run(collection, normalizedId, serialize(next), now, now);
    return this.get(collection, normalizedId);
  }

  update(collection, id, updates) {
    const existing = this.get(collection, id);
    if (!existing) throw new Error(`Data ${collection}/${id} tidak ditemukan.`);
    return this.set(collection, id, updates, { merge: true });
  }

  remove(collection, id) {
    this.ensureOpen();
    const result = this.statements.remove.run(collection, String(id));
    return Number(result.changes || 0);
  }

  transaction(callback) {
    this.ensureOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  getMetadata(key) {
    this.ensureOpen();
    return this.statements.getMetadata.get(String(key))?.value ?? null;
  }

  setMetadata(key, value) {
    this.ensureOpen();
    this.statements.setMetadata.run(String(key), String(value));
  }

  async backupTo(destination) {
    this.ensureOpen();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await sqliteBackup(this.db, destination);
    return destination;
  }

  close() {
    if (!this.db) return;
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    this.db.close();
    this.db = null;
    this.statements = null;
  }
}

module.exports = { SqliteDocumentStore, cleanUndefined };
