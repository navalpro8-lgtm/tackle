import type { Installation, InstallationQuery } from '@slack/bolt';
import { beforeEach, describe, expect, it } from 'vitest';
import { TokenCipher } from '../src/crypto.js';
import { openDatabase, type DB } from '../src/db.js';
import {
  InstallationNotFoundError,
  SqliteInstallationStore,
} from '../src/store/sqliteInstallationStore.js';
import { testKey } from './helpers.js';

// Fake tokens, used only to prove they never reach disk in plain text.
const BOT_TOKEN = 'xoxb-fake-bot-token-for-tests';
const USER_TOKEN = 'xoxp-fake-user-token-for-tests';

const workspaceInstall = (teamId: string, enterpriseId?: string): Installation<'v2', false> => ({
  team: { id: teamId, name: `Team ${teamId}` },
  enterprise: enterpriseId ? { id: enterpriseId, name: `Org ${enterpriseId}` } : undefined,
  user: { id: 'U123', token: USER_TOKEN, scopes: ['identify'] },
  bot: { id: 'B123', userId: 'UBOT', token: BOT_TOKEN, scopes: ['commands', 'team:read'] },
  appId: 'A123',
  tokenType: 'bot',
  isEnterpriseInstall: false,
  authVersion: 'v2',
});

const orgInstall = (enterpriseId: string): Installation<'v2', true> => ({
  team: undefined,
  enterprise: { id: enterpriseId, name: `Org ${enterpriseId}` },
  user: { id: 'U999', token: undefined, scopes: undefined },
  bot: { id: 'B999', userId: 'UBOT9', token: BOT_TOKEN, scopes: ['commands'] },
  appId: 'A123',
  tokenType: 'bot',
  isEnterpriseInstall: true,
  authVersion: 'v2',
});

/** Query for a workspace install (optionally inside an enterprise). */
const team = (teamId: string, enterpriseId?: string): InstallationQuery<false> => ({
  teamId,
  enterpriseId,
  isEnterpriseInstall: false,
});

/** Query for an org-wide enterprise install. */
const org = (enterpriseId: string): InstallationQuery<true> => ({
  teamId: undefined,
  enterpriseId,
  isEnterpriseInstall: true,
});

describe('SqliteInstallationStore', () => {
  let db: DB;
  let store: SqliteInstallationStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SqliteInstallationStore(db, new TokenCipher(testKey()));
  });

  it('saves and fetches a workspace installation', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const fetched = await store.fetchInstallation(team('T1'));
    expect(fetched).toEqual(JSON.parse(JSON.stringify(workspaceInstall('T1'))));
    expect(fetched.bot?.token).toBe(BOT_TOKEN);
  });

  it('keeps installations for different teams separate', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    await store.storeInstallation(workspaceInstall('T2'));
    expect((await store.fetchInstallation(team('T2'))).team?.id).toBe('T2');
  });

  it('keys workspaces inside an enterprise grid by both ids', async () => {
    await store.storeInstallation(workspaceInstall('T1', 'E1'));
    expect((await store.fetchInstallation(team('T1', 'E1'))).enterprise?.id).toBe('E1');
    await expect(store.fetchInstallation(team('T1'))).rejects.toBeInstanceOf(
      InstallationNotFoundError,
    );
  });

  it('saves and fetches an org-wide enterprise installation', async () => {
    await store.storeInstallation(orgInstall('E1'));
    const fetched = await store.fetchInstallation(org('E1'));
    expect(fetched.isEnterpriseInstall).toBe(true);
    expect(fetched.bot?.token).toBe(BOT_TOKEN);
  });

  it('replaces the row on reinstall', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const updated = workspaceInstall('T1');
    updated.bot = { ...updated.bot!, token: 'xoxb-fake-rotated-token' };
    await store.storeInstallation(updated);

    const { n } = db.prepare('SELECT COUNT(*) AS n FROM installations').get() as { n: number };
    expect(n).toBe(1);
    expect((await store.fetchInstallation(team('T1'))).bot?.token).toBe('xoxb-fake-rotated-token');
  });

  it('deletes only the requested installation', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    await store.storeInstallation(workspaceInstall('T2'));
    await store.deleteInstallation(team('T1'));
    await expect(store.fetchInstallation(team('T1'))).rejects.toBeInstanceOf(
      InstallationNotFoundError,
    );
    await expect(store.fetchInstallation(team('T2'))).resolves.toBeDefined();
  });

  it('treats deleting a missing installation as a no-op', async () => {
    await expect(store.deleteInstallation(team('TX'))).resolves.toBeUndefined();
  });

  it('throws InstallationNotFoundError for unknown teams', async () => {
    await expect(store.fetchInstallation(team('TX'))).rejects.toBeInstanceOf(
      InstallationNotFoundError,
    );
  });

  it('never writes tokens to the database in plain text', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const rows = db.prepare('SELECT * FROM installations').all() as { payload_enc: string }[];
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(BOT_TOKEN);
    expect(raw).not.toContain(USER_TOKEN);
    expect(raw).not.toContain('xoxb-');
    expect(rows[0]?.payload_enc.startsWith('v1:')).toBe(true);
  });

  it('round-trips through encryption and fails with a different key', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const wrongKeyStore = new SqliteInstallationStore(db, new TokenCipher(testKey()));
    await expect(wrongKeyStore.fetchInstallation(team('T1'))).rejects.toThrow(/wrong key or data/);
    await expect(store.fetchInstallation(team('T1'))).resolves.toMatchObject({
      bot: { token: BOT_TOKEN },
    });
  });
});
