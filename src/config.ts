import { z } from 'zod';

/**
 * All settings come from environment variables and are validated here at startup.
 * To add a setting: add a line to `schema`, map it in the `.transform()` below,
 * and document it in .env.example. The `Config` type updates itself.
 */

/** Decodes a 32-byte key given as 64 hex chars or base64. Returns undefined if invalid. */
export function decodeEncryptionKey(value: string): Buffer | undefined {
  const v = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(v)) {
    const buf = Buffer.from(v, 'base64');
    if (buf.length === 32) return buf;
  }
  return undefined;
}

const PLACEHOLDER = /^(your[-_]|changeme|replace[-_]?me|xxx)/i;

/** A required string that must not be left as an .env.example placeholder. */
const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`)
    .refine((v) => !PLACEHOLDER.test(v), `${name} still has a placeholder value from .env.example`);

const schema = z
  .object({
    SLACK_CLIENT_ID: required('SLACK_CLIENT_ID'),
    SLACK_CLIENT_SECRET: required('SLACK_CLIENT_SECRET'),
    SLACK_SIGNING_SECRET: required('SLACK_SIGNING_SECRET'),
    SLACK_STATE_SECRET: required('SLACK_STATE_SECRET').refine(
      (v) => v.length >= 32,
      'SLACK_STATE_SECRET must be at least 32 characters',
    ),
    TOKEN_ENCRYPTION_KEY: required('TOKEN_ENCRYPTION_KEY').refine(
      (v) => decodeEncryptionKey(v) !== undefined,
      'TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as 64 hex characters or base64',
    ),
    SLACK_SCOPES: z.string().default('commands,team:read'),
    PORT: z.coerce
      .number({ error: 'PORT must be a number' })
      .int('PORT must be an integer')
      .min(1, 'PORT must be between 1 and 65535')
      .max(65535, 'PORT must be between 1 and 65535')
      .default(3000),
    DATABASE_PATH: z.string().trim().min(1).default('./data/tackle.db'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .transform((env) => ({
    slack: {
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      signingSecret: env.SLACK_SIGNING_SECRET,
      stateSecret: env.SLACK_STATE_SECRET,
      scopes: env.SLACK_SCOPES.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    encryptionKey: decodeEncryptionKey(env.TOKEN_ENCRYPTION_KEY) as Buffer,
    port: env.PORT,
    databasePath: env.DATABASE_PATH,
    logLevel: env.LOG_LEVEL,
  }));

export type Config = z.output<typeof schema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates the environment and returns typed config, or throws a ConfigError listing
 * every problem. Messages name the variable but never include its value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty strings count as missing, so defaults apply and "required" errors fire.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = schema.safeParse(present);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.');
    return issue.message.startsWith(key) ? issue.message : `${key}: ${issue.message}`;
  });
  throw new ConfigError([...new Set(problems)]);
}
