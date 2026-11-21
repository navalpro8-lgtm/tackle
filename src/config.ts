import { z } from 'zod';

/**
 * Decodes a 32-byte key given as 64 hex characters or as base64.
 * Returns undefined if the value is not exactly 32 bytes in either form.
 */
export function decodeEncryptionKey(value: string): Buffer | undefined {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  }
  return undefined;
}

const PLACEHOLDER = /^(your[-_]|changeme|replace[-_]?me|xxx)/i;

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`)
    .refine((v) => !PLACEHOLDER.test(v), `${name} still has a placeholder value from .env.example`);

const schema = z.object({
  SLACK_CLIENT_ID: secret('SLACK_CLIENT_ID'),
  SLACK_CLIENT_SECRET: secret('SLACK_CLIENT_SECRET'),
  SLACK_SIGNING_SECRET: secret('SLACK_SIGNING_SECRET'),
  SLACK_STATE_SECRET: secret('SLACK_STATE_SECRET').refine(
    (v) => v.length >= 32,
    'SLACK_STATE_SECRET must be at least 32 characters',
  ),
  TOKEN_ENCRYPTION_KEY: secret('TOKEN_ENCRYPTION_KEY').refine(
    (v) => decodeEncryptionKey(v) !== undefined,
    'TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as 64 hex characters or base64',
  ),
  SLACK_SCOPES: z
    .string()
    .default('commands,team:read')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((v) => v.length > 0, 'SLACK_SCOPES must list at least one scope'),
  PORT: z.coerce
    .number({ error: 'PORT must be a number' })
    .int('PORT must be an integer')
    .min(1, 'PORT must be between 1 and 65535')
    .max(65535, 'PORT must be between 1 and 65535')
    .default(3000),
  DATABASE_PATH: z.string().trim().min(1).default('./data/tackle.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface Config {
  slack: {
    clientId: string;
    clientSecret: string;
    signingSecret: string;
    stateSecret: string;
    scopes: string[];
  };
  encryptionKey: Buffer;
  port: number;
  databasePath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates environment variables and returns typed config.
 * Error messages name the variable and the problem; they never include the value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as missing so defaults apply and "required" fires.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.join('.');
      return issue.message.startsWith(key) ? issue.message : `${key}: ${issue.message}`;
    });
    throw new ConfigError([...new Set(problems)]);
  }
  const e = result.data;
  return {
    slack: {
      clientId: e.SLACK_CLIENT_ID,
      clientSecret: e.SLACK_CLIENT_SECRET,
      signingSecret: e.SLACK_SIGNING_SECRET,
      stateSecret: e.SLACK_STATE_SECRET,
      scopes: e.SLACK_SCOPES,
    },
    encryptionKey: decodeEncryptionKey(e.TOKEN_ENCRYPTION_KEY) as Buffer,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    logLevel: e.LOG_LEVEL,
  };
}
