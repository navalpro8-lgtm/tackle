import { randomBytes } from 'node:crypto';

/** A complete, valid environment built from random test-only values. */
export function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    SLACK_CLIENT_ID: 'test-client-id',
    SLACK_CLIENT_SECRET: 'test-client-secret',
    SLACK_SIGNING_SECRET: 'test-signing-secret',
    SLACK_STATE_SECRET: randomBytes(32).toString('hex'),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ...overrides,
  };
}

export function testKey(): Buffer {
  return randomBytes(32);
}
