import type { Installation, InstallationQuery, InstallationStore } from '@slack/bolt';
import type { TokenCipher } from '../crypto.js';
import type { DB } from '../db.js';

interface Key {
  enterpriseId: string;
  teamId: string;
}

interface Row {
  payload_enc: string;
}

/** Thrown when no installation matches; Bolt turns this into an authorization failure. */
export class InstallationNotFoundError extends Error {
  constructor(key: Key) {
    super(
      `No installation found for enterprise=${key.enterpriseId || '-'} team=${key.teamId || '-'}`,
    );
    this.name = 'InstallationNotFoundError';
  }
}

function keyFromInstallation(installation: Installation): Key {
  if (installation.isEnterpriseInstall) {
    if (!installation.enterprise?.id) {
      throw new Error('Enterprise install is missing enterprise.id');
    }
    return { enterpriseId: installation.enterprise.id, teamId: '' };
  }
  if (!installation.team?.id) {
    throw new Error('Workspace install is missing team.id');
  }
  return { enterpriseId: installation.enterprise?.id ?? '', teamId: installation.team.id };
}

function keyFromQuery(query: InstallationQuery<boolean>): Key {
  if (query.isEnterpriseInstall) {
    if (!query.enterpriseId) throw new Error('Enterprise query is missing enterpriseId');
    return { enterpriseId: query.enterpriseId, teamId: '' };
  }
  if (!query.teamId) throw new Error('Workspace query is missing teamId');
  return { enterpriseId: query.enterpriseId ?? '', teamId: query.teamId };
}

/**
 * Bolt InstallationStore backed by SQLite.
 *
 * The whole Installation object (bot/user tokens, refresh tokens, webhook URL) is
 * encrypted with AES-256-GCM before it is written. Reinstalling a workspace replaces
 * its row. Nothing in this class logs tokens or payloads.
 */
export class SqliteInstallationStore implements InstallationStore {
  readonly #db: DB;
  readonly #cipher: TokenCipher;
  readonly #now: () => Date;

  constructor(db: DB, cipher: TokenCipher, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#cipher = cipher;
    this.#now = now;
  }

  // better-sqlite3 is synchronous, so these methods have no `await`. They stay `async`
  // because Bolt's interface expects Promises, and `async` turns throws into rejections.
  /* eslint-disable @typescript-eslint/require-await */

  async storeInstallation<AuthVersion extends 'v1' | 'v2'>(
    installation: Installation<AuthVersion, boolean>,
  ): Promise<void> {
    const key = keyFromInstallation(installation);
    const now = this.#now().toISOString();
    this.#db
      .prepare(
        `INSERT INTO installations
           (enterprise_id, team_id, is_enterprise_install, team_name, enterprise_name,
            payload_enc, installed_at, updated_at)
         VALUES (@enterpriseId, @teamId, @isEnterprise, @teamName, @enterpriseName,
                 @payload, @now, @now)
         ON CONFLICT (enterprise_id, team_id) DO UPDATE SET
           is_enterprise_install = excluded.is_enterprise_install,
           team_name             = excluded.team_name,
           enterprise_name       = excluded.enterprise_name,
           payload_enc           = excluded.payload_enc,
           updated_at            = excluded.updated_at`,
      )
      .run({
        ...key,
        isEnterprise: installation.isEnterpriseInstall ? 1 : 0,
        teamName: installation.team?.name ?? null,
        enterpriseName: installation.enterprise?.name ?? null,
        payload: this.#cipher.encrypt(JSON.stringify(installation)),
        now,
      });
  }

  async fetchInstallation(
    query: InstallationQuery<boolean>,
  ): Promise<Installation<'v1' | 'v2', boolean>> {
    const key = keyFromQuery(query);
    const row = this.#db
      .prepare(
        'SELECT payload_enc FROM installations WHERE enterprise_id = @enterpriseId AND team_id = @teamId',
      )
      .get(key) as Row | undefined;
    if (!row) throw new InstallationNotFoundError(key);
    return JSON.parse(this.#cipher.decrypt(row.payload_enc)) as Installation;
  }

  async deleteInstallation(query: InstallationQuery<boolean>): Promise<void> {
    const key = keyFromQuery(query);
    this.#db
      .prepare(
        'DELETE FROM installations WHERE enterprise_id = @enterpriseId AND team_id = @teamId',
      )
      .run(key);
  }
}
