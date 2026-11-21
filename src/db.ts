import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  // 1: installations. One row per workspace install, or per org for enterprise-wide installs
  // (team_id = ''). The full Installation object, tokens included, lives in `payload_enc`,
  // encrypted with AES-256-GCM. Only non-secret identifiers are stored in plain text.
  `CREATE TABLE installations (
     enterprise_id         TEXT    NOT NULL DEFAULT '',
     team_id               TEXT    NOT NULL DEFAULT '',
     is_enterprise_install INTEGER NOT NULL DEFAULT 0,
     team_name             TEXT,
     enterprise_name       TEXT,
     payload_enc           TEXT    NOT NULL,
     installed_at          TEXT    NOT NULL,
     updated_at            TEXT    NOT NULL,
     PRIMARY KEY (enterprise_id, team_id)
   )`,
];

/** Opens (or creates) the SQLite database and applies pending migrations. */
export function openDatabase(path: string): DB {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const apply = db.transaction(() => {
    for (let i = current; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i] as string);
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  });
  if (current < MIGRATIONS.length) apply();
}

/** Cheap liveness probe used by /health. */
export function pingDatabase(db: DB): boolean {
  try {
    return db.prepare('SELECT 1 AS ok').get() !== undefined;
  } catch {
    return false;
  }
}
