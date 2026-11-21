import { describe, expect, it } from 'vitest';
import { TokenCipher } from '../src/crypto.js';
import { testKey } from './helpers.js';

const SAMPLE = 'xoxb-test-0000000000-not-a-real-token';

describe('TokenCipher', () => {
  it('round-trips a token', () => {
    const cipher = new TokenCipher(testKey());
    const encrypted = cipher.encrypt(SAMPLE);
    expect(encrypted).not.toContain(SAMPLE);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(cipher.decrypt(encrypted)).toBe(SAMPLE);
  });

  it('uses a fresh IV each time', () => {
    const cipher = new TokenCipher(testKey());
    expect(cipher.encrypt(SAMPLE)).not.toBe(cipher.encrypt(SAMPLE));
  });

  it('fails with the wrong key', () => {
    const encrypted = new TokenCipher(testKey()).encrypt(SAMPLE);
    expect(() => new TokenCipher(testKey()).decrypt(encrypted)).toThrow(/wrong key or data/);
  });

  it('detects tampered ciphertext', () => {
    const cipher = new TokenCipher(testKey());
    const [v, iv, tag, data] = cipher.encrypt(SAMPLE).split(':') as [
      string,
      string,
      string,
      string,
    ];
    const bytes = Buffer.from(data, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = [v, iv, tag, bytes.toString('base64')].join(':');
    expect(() => cipher.decrypt(tampered)).toThrow(/wrong key or data/);
  });

  it('rejects malformed payloads', () => {
    const cipher = new TokenCipher(testKey());
    expect(() => cipher.decrypt('plain-text')).toThrow(/format/);
    expect(() => cipher.decrypt('v2:a:b:c')).toThrow(/format/);
  });

  it('requires a 32-byte key', () => {
    expect(() => new TokenCipher(Buffer.alloc(16))).toThrow(/32-byte/);
  });
});
