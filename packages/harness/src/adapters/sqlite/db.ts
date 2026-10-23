import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { drizzle, type SqliteRemoteDatabase, type SqliteRemoteResult } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
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
 * Opens and migrates the database. Safe when several processes (or connections) open the same fresh
 * file at once: the WAL switch is retried while busy, and the whole migration, including drizzle's
 * check of what is already applied, runs in one BEGIN IMMEDIATE.
 */
export async function openSqlite(path: string): Promise<Sqlite> {
  const raw = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  try {
    // Switching to WAL can report BUSY without consulting the busy handler.
    await whileBusy(raw, () => raw.exec("PRAGMA journal_mode = WAL"));
    raw.exec("PRAGMA foreign_keys = ON");
    const db = drizzle(async (sql, params, method) => execute(raw, sql, params, method), { schema });
    await whileBusy(raw, () => raw.exec("BEGIN IMMEDIATE"));
    try {
      await migrate(
        db,
        async (queries) => {
          for (const q of queries) raw.exec(q);
        },
        { migrationsFolder: MIGRATIONS_DIR },
      );
      raw.exec("COMMIT");
    } catch (e) {
      if (raw.isTransaction) raw.exec("ROLLBACK");
      throw e;
    }
    return { db, raw, close: () => raw.close() };
  } catch (e) {
    raw.close();
    throw e;
  }
}

const isBusy = (e: unknown) => ((e as { errcode?: number }).errcode ?? 0) % 256 === 5; // SQLITE_BUSY*

/**
 * Retries `fn` while the database is busy, for at most BUSY_TIMEOUT_MS, polling with timers instead
 * of the blocking busy handler. A blocking wait here would freeze the event loop while another
 * connection in this process is mid-migration (drizzle's migrator is async), so neither could finish.
 */
async function whileBusy(raw: DatabaseSync, fn: () => void): Promise<void> {
  raw.exec("PRAGMA busy_timeout = 0");
  try {
    const deadline = performance.now() + BUSY_TIMEOUT_MS;
    for (;;) {
      try {
        return fn();
      } catch (e) {
        if (!isBusy(e) || performance.now() >= deadline) throw e;
      }
      await delay(5 + Math.random() * 20);
    }
  } finally {
    raw.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
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
