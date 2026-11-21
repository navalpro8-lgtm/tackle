# Tackle

A TypeScript starter kit for multi-workspace Slack apps.

- **Slack Bolt for JavaScript** in HTTP mode (Express receiver, not Socket Mode)
- **OAuth install flow** for any number of workspaces and Enterprise Grid orgs
- **SQLite installation store** with tokens **encrypted at rest** (AES-256-GCM)
- One slash command, `/tackle-ping`, plus a `/health` endpoint
- Config validated at startup, strict TypeScript, Vitest, ESLint and Prettier

## Requirements

- Node.js 22 or newer
- A Slack workspace where you can create apps
- A tunnel tool so Slack can reach your machine: [ngrok](https://ngrok.com/) or
  [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

## 1. Install and configure

```sh
npm install
cp .env.example .env
```

Generate the two local secrets and paste them into `.env`:

```sh
# SLACK_STATE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# TOKEN_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Keep `TOKEN_ENCRYPTION_KEY` safe.** If you lose it, stored installations can't be
> decrypted and every workspace has to reinstall the app.

The other three values (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`)
come from Slack in step 3.

| Variable               | Required | Default              | Notes                                    |
| ---------------------- | -------- | -------------------- | ---------------------------------------- |
| `SLACK_CLIENT_ID`      | yes      |                      | Basic Information → App Credentials      |
| `SLACK_CLIENT_SECRET`  | yes      |                      | Basic Information → App Credentials      |
| `SLACK_SIGNING_SECRET` | yes      |                      | Basic Information → App Credentials      |
| `SLACK_STATE_SECRET`   | yes      |                      | 32+ random characters, signs OAuth state |
| `TOKEN_ENCRYPTION_KEY` | yes      |                      | 32 bytes, as base64 or 64 hex chars      |
| `SLACK_SCOPES`         | no       | `commands,team:read` | Comma-separated bot scopes               |
| `PORT`                 | no       | `3000`               |                                          |
| `DATABASE_PATH`        | no       | `./data/tackle.db`   | Parent folder is created automatically   |
| `LOG_LEVEL`            | no       | `info`               | `debug`, `info`, `warn` or `error`       |

If anything is missing or invalid, the app exits at startup and lists every problem at once.
Errors name the variable but never print its value.

## 2. Start a tunnel

Slack must reach your server over public HTTPS, both for the OAuth redirect and for
slash commands. Start the tunnel first so you know the URL:

```sh
ngrok http 3000
# or
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://…` forwarding URL. Below it's written as `https://YOUR-TUNNEL`.

> Free tunnel URLs often change when the tunnel restarts. When yours changes, update the
> three URLs in your Slack app settings (redirect URL, slash command URL, event request URL).
> ngrok's free static domain avoids this.

## 3. Create the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**, and pick
   your development workspace.
2. Paste this manifest, replacing `YOUR-TUNNEL` everywhere:

   ```yaml
   display_information:
     name: Tackle
   features:
     bot_user:
       display_name: Tackle
       always_online: false
     slash_commands:
       - command: /tackle-ping
         url: https://YOUR-TUNNEL/slack/events
         description: Replies with the workspace name and the time
         should_escape: false
   oauth_config:
     redirect_urls:
       - https://YOUR-TUNNEL/slack/oauth_redirect
     scopes:
       bot:
         - commands
         - team:read
   settings:
     event_subscriptions:
       request_url: https://YOUR-TUNNEL/slack/events
       bot_events:
         - app_uninstalled
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```

3. Open **Basic Information → App Credentials** and copy **Client ID**, **Client Secret**
   and **Signing Secret** into `.env`.
4. To install into workspaces other than the one you created the app in, open
   **Manage Distribution** and activate public distribution. You don't need to list the app
   in the Slack Marketplace.

What the pieces are for:

- `commands` scope: lets the app register `/tackle-ping`.
- `team:read` scope: lets `/tackle-ping` look up the workspace name with `team.info`.
- `app_uninstalled` event: when a workspace removes the app, its stored tokens are deleted.
- All Slack traffic (slash commands and events) goes to one URL, `/slack/events`.

> Slack checks the event **Request URL** as soon as you save it, so the server (step 4)
> must be running and reachable through the tunnel. If you created the app before starting
> the server, open **Event Subscriptions** afterwards and click **Retry**.

## 4. Run locally

```sh
npm run dev      # tsx watch, reloads on change, reads .env
```

Or build and run the compiled output:

```sh
npm run build
npm start
```

Check the server is up:

```sh
curl http://localhost:3000/health
# {"status":"ok","checks":{"database":"ok"},"uptimeSeconds":3}
```

## 5. Install into a workspace

Open **`https://YOUR-TUNNEL/slack/install`** in your browser. Use the tunnel URL, not
localhost. You're sent to Slack to approve the app, then back to `/slack/oauth_redirect`,
where the installation is saved (encrypted) to SQLite.

> The install must start and finish in the **same browser on the same host** (your
> tunnel URL), because the OAuth `state` is checked against a cookie set by
> `/slack/install`. Starting from `localhost` and returning through the tunnel fails the
> state check.

Then type `/tackle-ping` in any channel. Only you see the reply:

> :wave: Pong from **Your Workspace**. It's Nov 21, 2026 at 1:23:45 PM.

The time is shown in each viewer's own timezone.

Repeat step 5 for each workspace. Each one gets its own row in the database.

## Endpoints

| Method | Path                    | Purpose                                                      |
| ------ | ----------------------- | ------------------------------------------------------------ |
| GET    | `/slack/install`        | Starts OAuth: sets a state cookie, redirects to Slack        |
| GET    | `/slack/oauth_redirect` | OAuth callback: checks state, exchanges code, stores install |
| POST   | `/slack/events`         | Slash commands and events (signature-verified)               |
| GET    | `/health`               | `200` when healthy, `503` if the database check fails        |

## Security notes

- **Request signatures are verified.** Bolt checks `X-Slack-Signature` and the timestamp
  on every `/slack/events` request. This is Bolt's default, and `src/app.ts` also sets
  `signatureVerification: true` explicitly. Tests confirm that unsigned, wrongly signed
  and replayed (stale) requests get a `401`.
- **Tokens are encrypted at rest.** The whole installation (bot token, user token,
  refresh tokens, webhook URL) is encrypted with AES-256-GCM, using a fresh random IV each
  time, before it's written. Only team/enterprise IDs and names are stored in plain text.
  A test confirms no token appears in the raw database rows.
- **Tokens are never logged.** The app's own log lines contain only IDs and error codes.
  Avoid `LOG_LEVEL=debug` in production, since it turns on Bolt's verbose request logs.
- **OAuth state is CSRF-protected**, with a signed state parameter checked against a
  browser cookie.
- `.env`, `*.db` and `data/` are in `.gitignore`.

## Development

```sh
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
npm run check       # all of the above (format in check mode)
```

Tests use in-memory SQLite and random keys. They need no Slack credentials or network.

## Project layout

```
src/
  index.ts                          entry point: config → DB → app.start, graceful shutdown
  app.ts                            Bolt App + ExpressReceiver, OAuth, routes, handlers
  config.ts                         env validation (zod)
  crypto.ts                         AES-256-GCM TokenCipher
  db.ts                             SQLite open + migrations + health probe
  health.ts                         GET /health
  commands/ping.ts                  /tackle-ping
  store/sqliteInstallationStore.ts  Bolt InstallationStore on SQLite
test/
  config.test.ts  crypto.test.ts  store.test.ts  http.test.ts  helpers.ts
```

## Dependencies

Runtime:

- `@slack/bolt`: Slack framework, providing the Express receiver, OAuth installer and
  signature verification
- `better-sqlite3`: fast, synchronous SQLite driver (native module, prebuilt binaries)
- `zod`: config validation with readable error messages

Dev: `typescript`, `tsx` (run TS without building), `vitest`, `supertest` (HTTP tests
without opening a port), `eslint` + `typescript-eslint` + `@eslint/js`, `prettier` +
`eslint-config-prettier`, and the `@types/*` packages.

`.env` loading uses Node's built-in `--env-file-if-exists`, so `dotenv` isn't needed.
