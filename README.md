# Tackle

[![CI](https://github.com/navalpro8-lgtm/tackle/actions/workflows/ci.yml/badge.svg)](https://github.com/navalpro8-lgtm/tackle/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A TypeScript starter kit for Slack apps that any number of workspaces can install.

- OAuth install flow for many workspaces, including Enterprise Grid
- Tokens stored in SQLite, **encrypted at rest** (AES-256-GCM)
- Slack request signatures verified on every request
- A working `/tackle-ping` slash command and a `/health` endpoint
- Settings checked at startup, with clear errors
- Strict TypeScript, Vitest, ESLint and Prettier

## Quick start

You need **Node 22.9+** and a tunnel tool such as [ngrok](https://ngrok.com/) or
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

**1. Install and create your `.env`**

```sh
npm install
cp .env.example .env
```

Generate the two local secrets and paste them into `.env`:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"     # SLACK_STATE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # TOKEN_ENCRYPTION_KEY
```

**2. Start a tunnel** and copy its `https://…` URL:

```sh
ngrok http 3000
```

**3. Create the Slack app.** Open <https://api.slack.com/apps>, choose **Create New App →
From a manifest**, and paste [`slack-manifest.yaml`](slack-manifest.yaml) with
`YOUR-TUNNEL` replaced by your tunnel host. Then copy the **Client ID**, **Client Secret**
and **Signing Secret** from **Basic Information** into `.env`.

**4. Run it**

```sh
npm run dev
```

**5. Install it.** Open `https://YOUR-TUNNEL/slack/install` in your browser, approve the
app, then type `/tackle-ping` in any channel.

> **Gotchas**
>
> - Start the install from the **tunnel URL**, not localhost. The OAuth state cookie is tied
>   to that host.
> - Slack checks the event Request URL when you save it, so the server must already be
>   running. If the check failed, click **Retry** under **Event Subscriptions**.
> - Free tunnel URLs change on restart. When yours changes, update the URLs in your Slack
>   app settings.
> - To install in other workspaces, turn on **Manage Distribution → Public distribution**.

## See it work in two workspaces

Tackle stores one installation per workspace, so the quickest way to see that it really is multi-workspace is to install it twice.

1. Finish the quick start above and install it in your first workspace.
2. Create a second, free workspace at <https://slack.com/create>. Make sure **Manage Distribution → Public distribution** is on for your Slack app.
3. Open `https://YOUR-TUNNEL/slack/install` again, and this time pick the second workspace in the top-right dropdown on Slack's approval page. Approve it.
4. Type `/tackle-ping` in each workspace. Each one answers with its own name: `Pong from *Workspace A*` in the first, `Pong from *Workspace B*` in the second. Only you see the reply.

Each install gets its own row in the `installations` table (one per workspace, keyed by team ID), and its tokens are encrypted. If you have the `sqlite3` command-line tool, you can look:

```sh
sqlite3 data/tackle.db "select team_id, team_name from installations"
```

Reinstalling a workspace replaces its row, so you won't get duplicates.

## Configuration

Every setting is listed in [`.env.example`](.env.example) and checked in
[`src/config.ts`](src/config.ts). The app won't start if any are missing or invalid, and it
lists every problem at once without printing secret values.

| Variable               | Default              |                                              |
| ---------------------- | -------------------- | -------------------------------------------- |
| `SLACK_CLIENT_ID`      | required             | Slack app → Basic Information                |
| `SLACK_CLIENT_SECRET`  | required             | Slack app → Basic Information                |
| `SLACK_SIGNING_SECRET` | required             | Slack app → Basic Information                |
| `SLACK_STATE_SECRET`   | required             | 32+ random chars, signs the OAuth state      |
| `TOKEN_ENCRYPTION_KEY` | required             | 32 bytes (base64 or hex). **Don't lose it.** |
| `SLACK_SCOPES`         | `commands,team:read` | Bot scopes, comma-separated                  |
| `PORT`                 | `3000`               |                                              |
| `DATABASE_PATH`        | `./data/tackle.db`   |                                              |
| `LOG_LEVEL`            | `info`               | `debug` / `info` / `warn` / `error`          |

## Extending it

| To add…          | Do this                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| A slash command  | Copy `src/commands/ping.ts`, add it to the list in `src/commands/index.ts`, add it to `slack-manifest.yaml` |
| An event handler | Add a file in `src/events/`, add it to `src/events/index.ts`, add the event to `slack-manifest.yaml`        |
| A setting        | Add it to the schema in `src/config.ts` and to `.env.example`                                               |
| A database table | Append a `CREATE TABLE` to `MIGRATIONS` in `src/db.ts`. Existing databases are upgraded on start            |
| A bot scope      | Add it to `SLACK_SCOPES` and `slack-manifest.yaml`, then reinstall the app                                  |

## Project layout

```
src/
  index.ts          Entry point: load config, open DB, start server
  app.ts            Wires Bolt, OAuth, routes, commands and events together
  config.ts         Environment settings and validation
  commands/         Slash commands (one file each + index.ts)
  events/           Slack event handlers (one file each + index.ts)
  store/            Installation store (encrypted tokens in SQLite)
  crypto.ts         AES-256-GCM encryption
  db.ts             SQLite connection and migrations
  health.ts         GET /health
test/               Vitest tests, no Slack account or network needed
```

## Endpoints

| Route                       | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `GET /slack/install`        | Starts the OAuth install                             |
| `GET /slack/oauth_redirect` | OAuth callback: checks state, saves the installation |
| `POST /slack/events`        | All slash commands and events (signature-verified)   |
| `GET /health`               | `200` when OK, `503` if the database is down         |

## Scripts

| Command          | What it does                             |
| ---------------- | ---------------------------------------- |
| `npm run dev`    | Run with auto-reload, reading `.env`     |
| `npm run build`  | Compile to `dist/`                       |
| `npm start`      | Run the compiled app                     |
| `npm test`       | Run the tests                            |
| `npm run check`  | Type check, lint, format check and tests |
| `npm run format` | Format all files                         |

## Security

- **Signatures:** every `/slack/events` request must be signed by Slack. Unsigned, wrongly
  signed or replayed requests get a `401`, and tests cover all three.
- **Tokens at rest:** the whole installation record is encrypted before it's saved. Only
  team/enterprise IDs and names are stored in plain text.
- **Logs:** the app never logs tokens. Avoid `LOG_LEVEL=debug` in production, since Bolt's
  debug output is verbose.
- **Secrets:** `.env` and database files are git-ignored.

## Dependencies

| Package          | Why                                                     |
| ---------------- | ------------------------------------------------------- |
| `@slack/bolt`    | Slack framework: HTTP receiver, OAuth, signature checks |
| `better-sqlite3` | Fast, simple SQLite driver                              |
| `zod`            | Settings validation with readable errors                |

Dev only: TypeScript, tsx, Vitest, supertest, ESLint, Prettier. `.env` is loaded by Node
itself (`--env-file`), so there's no `dotenv`.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started, or pick a
[`good first issue`](https://github.com/navalpro8-lgtm/tackle/labels/good%20first%20issue).

## License

[MIT](LICENSE)
