import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV, the recommended size for GCM
const TAG_BYTES = 16;
const VERSION = 'v1';

/**
 * Encrypts and decrypts short secrets (Slack tokens) with AES-256-GCM.
 * Output format: `v1:<iv b64>:<auth tag b64>:<ciphertext b64>`.
 * A fresh random IV is used for every encryption.
 */
export class TokenCipher {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error('TokenCipher requires a 32-byte key');
    }
    this.#key = Buffer.from(key);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Unrecognized encrypted token format');
    }
    const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('Unrecognized encrypted token format');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      const data = Buffer.from(dataB64, 'base64');
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      // Don't leak OpenSSL details; the cause is a wrong key or tampered data.
      throw new Error('Failed to decrypt token: wrong key or data was tampered with');
    }
  }
}
