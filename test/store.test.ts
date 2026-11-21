import type { Installation } from '@slack/bolt';
import { beforeEach, describe, expect, it } from 'vitest';
import { TokenCipher } from '../src/crypto.js';
import { openDatabase, type DB } from '../src/db.js';
import {
  InstallationNotFoundError,
  SqliteInstallationStore,
} from '../src/store/sqliteInstallationStore.js';
import { testKey } from './helpers.js';

// Obviously fake token values, used only to check they never reach disk in plain text.
const BOT_TOKEN = 'xoxb-fake-bot-token-for-tests';
const USER_TOKEN = 'xoxp-fake-user-token-for-tests';

function workspaceInstall(teamId: string, enterpriseId?: string): Installation<'v2', false> {
  return {
    team: { id: teamId, name: `Team ${teamId}` },
    enterprise: enterpriseId ? { id: enterpriseId, name: `Org ${enterpriseId}` } : undefined,
    user: { id: 'U123', token: USER_TOKEN, scopes: ['identify'] },
    bot: { id: 'B123', userId: 'UBOT', token: BOT_TOKEN, scopes: ['commands', 'team:read'] },
    appId: 'A123',
    tokenType: 'bot',
    isEnterpriseInstall: false,
    authVersion: 'v2',
  };
}

function orgInstall(enterpriseId: string): Installation<'v2', true> {
  return {
    team: undefined,
    enterprise: { id: enterpriseId, name: `Org ${enterpriseId}` },
    user: { id: 'U999', token: undefined, scopes: undefined },
    bot: { id: 'B999', userId: 'UBOT9', token: BOT_TOKEN, scopes: ['commands'] },
    appId: 'A123',
    tokenType: 'bot',
    isEnterpriseInstall: true,
    authVersion: 'v2',
  };
}

describe('SqliteInstallationStore', () => {
  let db: DB;
  let cipher: TokenCipher;
  let store: SqliteInstallationStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    cipher = new TokenCipher(testKey());
    store = new SqliteInstallationStore(db, cipher);
  });

  it('saves and fetches a workspace installation', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const fetched = await store.fetchInstallation({
      teamId: 'T1',
      enterpriseId: undefined,
      isEnterpriseInstall: false,
    });
    expect(fetched).toEqual(JSON.parse(JSON.stringify(workspaceInstall('T1'))));
    expect(fetched.bot?.token).toBe(BOT_TOKEN);
  });

  it('keeps installations for different teams separate', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    await store.storeInstallation(workspaceInstall('T2'));
    const t2 = await store.fetchInstallation({
      teamId: 'T2',
      enterpriseId: undefined,
      isEnterpriseInstall: false,
    });
    expect(t2.team?.id).toBe('T2');
  });

  it('handles a workspace inside an enterprise grid', async () => {
    await store.storeInstallation(workspaceInstall('T1', 'E1'));
    const fetched = await store.fetchInstallation({
      teamId: 'T1',
      enterpriseId: 'E1',
      isEnterpriseInstall: false,
    });
    expect(fetched.enterprise?.id).toBe('E1');
    await expect(
      store.fetchInstallation({
        teamId: 'T1',
        enterpriseId: undefined,
        isEnterpriseInstall: false,
      }),
    ).rejects.toBeInstanceOf(InstallationNotFoundError);
  });

  it('saves and fetches an org-wide enterprise installation', async () => {
    await store.storeInstallation(orgInstall('E1'));
    const fetched = await store.fetchInstallation({
      teamId: undefined,
      enterpriseId: 'E1',
      isEnterpriseInstall: true,
    });
    expect(fetched.isEnterpriseInstall).toBe(true);
    expect(fetched.bot?.token).toBe(BOT_TOKEN);
  });

  it('replaces the row on reinstall', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const updated = workspaceInstall('T1');
    updated.bot = { ...updated.bot!, token: 'xoxb-fake-rotated-token' };
    await store.storeInstallation(updated);
    const count = db.prepare('SELECT COUNT(*) AS n FROM installations').get() as { n: number };
    expect(count.n).toBe(1);
    const fetched = await store.fetchInstallation({
      teamId: 'T1',
      enterpriseId: undefined,
      isEnterpriseInstall: false,
    });
    expect(fetched.bot?.token).toBe('xoxb-fake-rotated-token');
  });

  it('deletes an installation', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    await store.storeInstallation(workspaceInstall('T2'));
    const q = { teamId: 'T1', enterpriseId: undefined, isEnterpriseInstall: false as const };
    await store.deleteInstallation(q);
    await expect(store.fetchInstallation(q)).rejects.toBeInstanceOf(InstallationNotFoundError);
    // Other teams are untouched.
    await expect(
      store.fetchInstallation({
        teamId: 'T2',
        enterpriseId: undefined,
        isEnterpriseInstall: false,
      }),
    ).resolves.toBeDefined();
  });

  it('deleting a missing installation is a no-op', async () => {
    await expect(
      store.deleteInstallation({
        teamId: 'TX',
        enterpriseId: undefined,
        isEnterpriseInstall: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws InstallationNotFoundError for unknown teams', async () => {
    await expect(
      store.fetchInstallation({
        teamId: 'TX',
        enterpriseId: undefined,
        isEnterpriseInstall: false,
      }),
    ).rejects.toBeInstanceOf(InstallationNotFoundError);
  });

  it('never writes tokens to the database in plain text', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const rows = db.prepare('SELECT * FROM installations').all();
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(BOT_TOKEN);
    expect(raw).not.toContain(USER_TOKEN);
    expect(raw).not.toContain('xoxb-');
    expect((rows[0] as { payload_enc: string }).payload_enc.startsWith('v1:')).toBe(true);
  });

  it('round-trips through encryption and fails with a different key', async () => {
    await store.storeInstallation(workspaceInstall('T1'));
    const q = { teamId: 'T1', enterpriseId: undefined, isEnterpriseInstall: false as const };
    const other = new SqliteInstallationStore(db, new TokenCipher(testKey()));
    await expect(other.fetchInstallation(q)).rejects.toThrow(/wrong key or data/);
    await expect(store.fetchInstallation(q)).resolves.toMatchObject({ bot: { token: BOT_TOKEN } });
  });
});
