import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | null | Uint8Array | boolean | undefined;

function bind(params: Param[]): SQLInputValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p as SQLInputValue;
  });
}

export class Db {
  readonly raw: DatabaseSync;
  readonly file: string;
  private txDepth = 0;

  constructor(file: string) {
    this.file = file;
    if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
    if (file !== ":memory:") {
      this.raw.exec("PRAGMA journal_mode = WAL");
      this.raw.exec("PRAGMA synchronous = NORMAL");
    }
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...bind(params));
    return { changes: Number(r.changes) };
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...bind(params)) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...bind(params)) as T[];
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Nested-safe transaction (uses savepoints when nested). */
  transaction<T>(fn: () => T): T {
    const nested = this.txDepth > 0;
    const sp = `sp_${this.txDepth}`;
    this.raw.exec(nested ? `SAVEPOINT ${sp}` : "BEGIN IMMEDIATE");
    this.txDepth++;
    try {
      const out = fn();
      this.txDepth--;
      this.raw.exec(nested ? `RELEASE ${sp}` : "COMMIT");
      return out;
    } catch (e) {
      this.txDepth--;
      this.raw.exec(nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : "ROLLBACK");
      throw e;
    }
  }

  migrate(): { applied: number[] } {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const done = new Set(this.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => Number(r.version)));
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.transaction(() => {
        this.raw.exec(m.sql);
        this.run("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)", m.version, m.name, new Date().toISOString());
      });
      applied.push(m.version);
    }
    return { applied };
  }

  schemaVersion(): number {
    const r = this.get<{ v: number | null }>("SELECT MAX(version) v FROM schema_migrations");
    return Number(r?.v ?? 0);
  }

  close(): void {
    this.raw.close();
  }
}

export function openDatabase(file: string, opts: { reset?: boolean } = {}): Db {
  if (opts.reset && file !== ":memory:") {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(file + suffix, { force: true }); } catch { /* ignore */ }
    }
  }
  const db = new Db(file);
  db.migrate();
  return db;
}
