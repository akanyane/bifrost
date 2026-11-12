import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HostKeyAlgorithm } from './config/schema.ts';

/**
 * Local credential store (SQLite) filled by `bifrost connect`.
 *
 * The password is stored in PLAIN TEXT: the protection is the file mode (0600, directory 0700),
 * the same as ~/.ssh/id_* without a passphrase. Anyone (or any agent) that can read your files can read it.
 */
export interface Connection {
  name: string;
  host: string;
  port: number;
  username: string;
  hostKeyAlgorithm: HostKeyAlgorithm;
  fingerprint: string;
  password: string;
}

export function defaultStorePath(): string {
  const env = process.env.BIFROST_DB;
  if (env) return env === '~' || env.startsWith('~/') ? join(homedir(), env.slice(1)) : env;
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(base, 'bifrost', 'bifrost.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  name               TEXT PRIMARY KEY,
  host               TEXT NOT NULL,
  port               INTEGER NOT NULL,
  username           TEXT NOT NULL,
  host_key_algorithm TEXT NOT NULL,
  fingerprint        TEXT NOT NULL,
  password           TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface Row {
  name: string;
  host: string;
  port: number;
  username: string;
  host_key_algorithm: string;
  fingerprint: string;
  password: string;
}

const fromRow = (r: Row): Connection => ({
  name: r.name,
  host: r.host,
  port: r.port,
  username: r.username,
  hostKeyAlgorithm: r.host_key_algorithm as HostKeyAlgorithm,
  fingerprint: r.fingerprint,
  password: r.password,
});

export class CredentialStore {
  readonly path: string;
  readonly #db: DatabaseSync;

  private constructor(path: string, db: DatabaseSync) {
    this.path = path;
    this.#db = db;
  }

  /** Opens the store, creating the file (0600) and its directory (0700) if needed. */
  static open(path: string = defaultStorePath()): CredentialStore {
    const onDisk = path !== ':memory:';
    if (onDisk) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    if (onDisk) chmodSync(path, 0o600);
    db.exec(SCHEMA);
    return new CredentialStore(path, db);
  }

  save(conn: Connection): void {
    this.#db
      .prepare(
        `INSERT INTO connections (name, host, port, username, host_key_algorithm, fingerprint, password)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           host = excluded.host, port = excluded.port, username = excluded.username,
           host_key_algorithm = excluded.host_key_algorithm, fingerprint = excluded.fingerprint,
           password = excluded.password, updated_at = datetime('now')`,
      )
      .run(conn.name, conn.host, conn.port, conn.username, conn.hostKeyAlgorithm, conn.fingerprint, conn.password);
  }

  get(name: string): Connection | undefined {
    const row = this.#db.prepare('SELECT * FROM connections WHERE name = ?').get(name) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(): Connection[] {
    return (this.#db.prepare('SELECT * FROM connections ORDER BY name').all() as unknown as Row[]).map(fromRow);
  }

  remove(name: string): boolean {
    const res = this.#db.prepare('DELETE FROM connections WHERE name = ?').run(name);
    if (this.activeName() === name) this.#db.prepare("DELETE FROM settings WHERE key = 'active'").run();
    return Number(res.changes) > 0;
  }

  setActive(name: string): void {
    this.#db
      .prepare("INSERT INTO settings (key, value) VALUES ('active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(name);
  }

  activeName(): string | undefined {
    const row = this.#db.prepare("SELECT value FROM settings WHERE key = 'active'").get() as { value: string } | undefined;
    return row?.value;
  }

  active(): Connection | undefined {
    const name = this.activeName();
    return name ? this.get(name) : undefined;
  }

  close(): void {
    this.#db.close();
  }
}
