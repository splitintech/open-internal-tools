import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase } from '@splitin/outreach-contracts';
import { wrapNativeDatabase, type NativeDatabase } from './driver';
import { migrate } from './migrate';

export interface OpenOptions {
  /** Apply pending migrations after opening (default true). */
  readonly migrate?: boolean;
  readonly busyTimeoutMs?: number;
}

function configure(db: SqlDatabase, path: string, busyTimeoutMs: number): void {
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
}

/** Opens (and by default migrates) a database with the built-in node:sqlite driver. */
export function openSqliteDatabase(path: string, options: OpenOptions = {}): SqlDatabase {
  const db = wrapNativeDatabase(new DatabaseSync(path) as unknown as NativeDatabase);
  configure(db, path, options.busyTimeoutMs ?? 5_000);
  if (options.migrate ?? true) migrate(db);
  return db;
}

/**
 * Adapts an already-open better-sqlite3 handle (what Papr Work loads in Electron).
 * Kept structural so this package does not depend on the native module.
 */
export function fromBetterSqlite3(native: NativeDatabase, path: string, options: OpenOptions = {}): SqlDatabase {
  const db = wrapNativeDatabase(native);
  configure(db, path, options.busyTimeoutMs ?? 5_000);
  if (options.migrate ?? true) migrate(db);
  return db;
}
