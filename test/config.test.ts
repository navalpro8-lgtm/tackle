import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { validEnv } from './helpers.js';

function problemsFor(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = loadConfig(validEnv());
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe('./data/tackle.db');
    expect(config.slack.scopes).toEqual(['commands', 'team:read']);
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.logLevel).toBe('info');
  });

  it('accepts a hex encryption key', () => {
    const config = loadConfig(validEnv({ TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') }));
    expect(config.encryptionKey).toHaveLength(32);
  });

  it('parses PORT and SLACK_SCOPES', () => {
    const config = loadConfig(validEnv({ PORT: '8080', SLACK_SCOPES: ' commands , chat:write ' }));
    expect(config.port).toBe(8080);
    expect(config.slack.scopes).toEqual(['commands', 'chat:write']);
  });

  it('lists every missing required variable at once', () => {
    const problems = problemsFor({});
    expect(problems).toEqual(
      expect.arrayContaining([
        'SLACK_CLIENT_ID is required',
        'SLACK_CLIENT_SECRET is required',
        'SLACK_SIGNING_SECRET is required',
        'SLACK_STATE_SECRET is required',
        'TOKEN_ENCRYPTION_KEY is required',
      ]),
    );
  });

  it('treats empty strings as missing', () => {
    expect(problemsFor(validEnv({ SLACK_CLIENT_ID: '' }))).toContain('SLACK_CLIENT_ID is required');
  });

  it('rejects placeholder values copied from .env.example', () => {
    expect(problemsFor(validEnv({ SLACK_CLIENT_SECRET: 'your-client-secret' }))).toContain(
      'SLACK_CLIENT_SECRET still has a placeholder value from .env.example',
    );
  });

  it('rejects an encryption key of the wrong length', () => {
    const problems = problemsFor(
      validEnv({ TOKEN_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    );
    expect(problems).toContain(
      'TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as 64 hex characters or base64',
    );
  });

  it('rejects a short state secret', () => {
    expect(problemsFor(validEnv({ SLACK_STATE_SECRET: 'short' }))).toContain(
      'SLACK_STATE_SECRET must be at least 32 characters',
    );
  });

  it('rejects an invalid PORT', () => {
    expect(problemsFor(validEnv({ PORT: '70000' }))).toContain('PORT must be between 1 and 65535');
    expect(problemsFor(validEnv({ PORT: 'abc' })).join()).toMatch(/PORT/);
  });

  it('never includes secret values in error messages', () => {
    const badKey = 'not-a-valid-key-but-secret-looking-value';
    const err = (() => {
      try {
        loadConfig(validEnv({ TOKEN_ENCRYPTION_KEY: badKey }));
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toBeDefined();
    expect(err?.message).not.toContain(badKey);
  });
});
