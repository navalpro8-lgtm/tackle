import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type TackleApp } from '../src/app.js';
import { pingMessage } from '../src/commands/ping.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db.js';
import { validEnv } from './helpers.js';

const SIGNING_SECRET = 'test-signing-secret';

function sign(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const base = `v0:${timestamp}:${body}`;
  const signature = `v0=${createHmac('sha256', SIGNING_SECRET).update(base).digest('hex')}`;
  return { 'X-Slack-Request-Timestamp': String(timestamp), 'X-Slack-Signature': signature };
}

describe('HTTP endpoints', () => {
  let db: DB;
  let tackle: TackleApp;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const config = loadConfig(
      validEnv({ SLACK_SIGNING_SECRET: SIGNING_SECRET, LOG_LEVEL: 'error' }),
    );
    tackle = createApp(config, db);
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(tackle.receiver.app).get('/health');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
      expect(typeof (res.body as { uptimeSeconds: unknown }).uptimeSeconds).toBe('number');
    });

    it('returns 503 when the database is unavailable', async () => {
      db.close();
      const res = await request(tackle.receiver.app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'error', checks: { database: 'error' } });
    });
  });

  describe('Slack request signature verification', () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });

    it('rejects unsigned requests with 401', async () => {
      const res = await request(tackle.receiver.app)
        .post('/slack/events')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(401);
    });

    it('rejects requests signed with the wrong secret', async () => {
      const ts = Math.floor(Date.now() / 1000);
      const bad = `v0=${createHmac('sha256', 'wrong-secret').update(`v0:${ts}:${body}`).digest('hex')}`;
      const res = await request(tackle.receiver.app)
        .post('/slack/events')
        .set('Content-Type', 'application/json')
        .set('X-Slack-Request-Timestamp', String(ts))
        .set('X-Slack-Signature', bad)
        .send(body);
      expect(res.status).toBe(401);
    });

    it('rejects stale timestamps (replay protection)', async () => {
      const res = await request(tackle.receiver.app)
        .post('/slack/events')
        .set('Content-Type', 'application/json')
        .set(sign(body, Math.floor(Date.now() / 1000) - 60 * 10))
        .send(body);
      expect(res.status).toBe(401);
    });

    it('accepts correctly signed requests', async () => {
      const res = await request(tackle.receiver.app)
        .post('/slack/events')
        .set('Content-Type', 'application/json')
        .set(sign(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(res.text).toContain('abc123');
    });
  });

  describe('OAuth install', () => {
    it('/slack/install redirects to Slack with our scopes and a state cookie', async () => {
      const res = await request(tackle.receiver.app).get('/slack/install');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.origin).toBe('https://slack.com');
      expect(location.pathname).toBe('/oauth/v2/authorize');
      expect(location.searchParams.get('scope')).toBe('commands,team:read');
      expect(location.searchParams.get('client_id')).toBe('test-client-id');
      expect(location.searchParams.get('state')).toBeTruthy();
      expect(String(res.headers['set-cookie'])).toMatch(/slack-app-oauth-state=/);
    });

    it('/slack/oauth_redirect rejects a callback without valid state', async () => {
      const res = await request(tackle.receiver.app).get(
        '/slack/oauth_redirect?code=fake&state=bogus',
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

describe('pingMessage', () => {
  it('includes the workspace name and a Slack date token', () => {
    const msg = pingMessage('Acme', new Date('2026-01-02T03:04:05Z'));
    expect(msg).toContain('*Acme*');
    expect(msg).toContain('<!date^1767323045^');
    expect(msg).toContain('Fri, 02 Jan 2026 03:04:05 GMT');
  });
});
