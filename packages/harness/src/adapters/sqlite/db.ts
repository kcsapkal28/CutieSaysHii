import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle, type SqliteRemoteDatabase, type SqliteRemoteResult } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.ts";

export type Db = SqliteRemoteDatabase<typeof schema>;

export type Sqlite = {
  db: Db;
  /** The underlying connection, for synchronous transactions and diagnostics. */
  raw: DatabaseSync;
  close(): void;
};

/** What the proxy callback returns for `run`; read it back with `changesOf`. */
type RunResult = SqliteRemoteResult & { changes: number; lastInsertRowid: number };

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../drizzle", import.meta.url));

// node:sqlite is synchronous, so while another process holds the write lock this blocks the whole
// event loop for up to busy_timeout. Every write is a single small row; keep it short.
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens and migrates the database. Safe when several processes or connections open the same fresh
 * file at once: the WAL switch is retried while busy, and the migration, including the check of
 * what is already applied, runs synchronously in one BEGIN IMMEDIATE.
 */
export async function openSqlite(path: string): Promise<Sqlite> {
  const raw = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  try {
    await enableWal(raw, path);
    raw.exec("PRAGMA foreign_keys = ON");
    immediate(raw, () => migrateSync(raw, readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR })));
    const db = drizzle(async (sql, params, method) => execute(raw, sql, params, method), { schema });
    return { db, raw, close: () => raw.close() };
  } catch (e) {
    raw.close();
    throw e;
  }
}

const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * drizzle's sqlite migrator, made synchronous so no transaction spans an await: same bookkeeping
 * table, and a migration is pending when its folder time is newer than the last applied one.
 */
function migrateSync(raw: DatabaseSync, migrations: MigrationMeta[]): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const last = raw.prepare(`SELECT created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`).get() as
    | { created_at: number | string }
    | undefined;
  const record = raw.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`);
  for (const m of migrations) {
    if (last && Number(last.created_at) >= m.folderMillis) continue;
    for (const statement of m.sql) raw.exec(statement);
    record.run(m.hash, m.folderMillis);
  }
}

const isBusy = (e: unknown) => ((e as { errcode?: number }).errcode ?? 0) % 256 === 5; // SQLITE_BUSY*

/**
 * Switching to WAL can report BUSY without consulting the busy handler, so it is retried on timers
 * for at most BUSY_TIMEOUT_MS. Fails unless the database ends up in WAL (":memory:" stays "memory").
 */
async function enableWal(raw: DatabaseSync, path: string): Promise<void> {
  const deadline = performance.now() + BUSY_TIMEOUT_MS;
  let mode: unknown;
  for (;;) {
    try {
      mode = (raw.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: unknown } | undefined)?.journal_mode;
      break;
    } catch (e) {
      if (!isBusy(e) || performance.now() >= deadline) throw e;
    }
    await delay(5 + Math.random() * 20);
  }
  const expected = path === ":memory:" ? "memory" : "wal";
  if (mode !== expected) throw new Error(`could not enable WAL on ${path}: journal_mode is ${String(mode)}`);
}

// The sqlite-proxy contract: `all`/`values` return rows as value arrays, `get` one value array.
function execute(raw: DatabaseSync, sql: string, params: unknown[], method: "run" | "all" | "values" | "get") {
  const stmt = raw.prepare(sql);
  const args = params as SQLInputValue[];
  if (method === "run") {
    const { changes, lastInsertRowid } = stmt.run(...args);
    return { rows: [], changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) } satisfies RunResult;
  }
  stmt.setReturnArrays(true);
  return { rows: method === "get" ? (stmt.get(...args) as unknown[] | undefined) : stmt.all(...args) } as { rows: unknown[] };
}

export function changesOf(result: SqliteRemoteResult): RunResult {
  return result as RunResult;
}

/**
 * Runs `fn` in BEGIN IMMEDIATE. `fn` must be synchronous: drizzle's async calls yield, and other
 * queries on this connection would then land inside the transaction.
 */
export function immediate<T>(raw: DatabaseSync, fn: () => T): T {
  raw.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    raw.exec("COMMIT");
    return out;
  } catch (e) {
    if (raw.isTransaction) raw.exec("ROLLBACK");
    throw e;
  }
}

type BuiltQuery = { toSQL(): { sql: string; params: unknown[] } };

/** Runs a drizzle-built statement synchronously, for use inside `immediate`. */
export function runSync(raw: DatabaseSync, query: BuiltQuery): number {
  const { sql, params } = query.toSQL();
  return Number(raw.prepare(sql).run(...(params as SQLInputValue[])).changes);
}

/** Runs a drizzle-built query synchronously and returns its rows as objects keyed by column name. */
export function allSync<R>(raw: DatabaseSync, query: BuiltQuery): R[] {
  const { sql, params } = query.toSQL();
  return raw.prepare(sql).all(...(params as SQLInputValue[])) as R[];
}
