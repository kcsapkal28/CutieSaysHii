import { DatabaseSync, type SQLInputValue } from "node:sqlite";
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

export async function openSqlite(path: string): Promise<Sqlite> {
  const raw = new DatabaseSync(path);
  try {
    raw.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    const db = drizzle(async (sql, params, method) => execute(raw, sql, params, method), { schema });
    await migrate(
      db,
      async (queries) =>
        immediate(raw, () => {
          for (const q of queries) raw.exec(q);
        }),
      { migrationsFolder: MIGRATIONS_DIR },
    );
    return { db, raw, close: () => raw.close() };
  } catch (e) {
    raw.close();
    throw e;
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
