# Contributing to Tackle

Thanks for helping out! Bug fixes, docs, tests and new features are all welcome.

## Find something to work on

- Issues labelled [`good first issue`](https://github.com/navalpro8-lgtm/tackle/labels/good%20first%20issue)
  are small and well-scoped, so they're a good place to start.
- Have a bigger idea? Open an issue first so we can agree on the approach before you spend
  time on it.
- Comment on an issue to claim it, so two people don't work on the same thing.

## Set up

You need Node 22.9+.

```sh
git clone https://github.com/<your-username>/tackle.git
cd tackle
npm install
npm test
```

You don't need a Slack app to run the tests. To try the app in Slack, follow the
[Quick start](README.md#quick-start).

## Make a change

1. Fork the repo and create a branch: `git checkout -b feat/my-change`.
2. Make your change. Add or update tests for anything you change in `src/`.
3. Run every check. CI runs the same command and must pass:

   ```sh
   npm run check
   ```

   `npm run format` fixes formatting problems automatically.

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/), for example
   `feat: add /tackle-help command` or `fix: handle missing team name`.
5. Push and open a pull request. Describe what changed and how you tested it.

## Where things go

See [Extending it](README.md#extending-it) in the README. In short:

- Slash commands go in `src/commands/` and are registered in `src/commands/index.ts`.
- Event handlers go in `src/events/` and are registered in `src/events/index.ts`.
- New settings go in `src/config.ts` and `.env.example`.
- New commands, events or scopes also go in `slack-manifest.yaml`.

## Ground rules

- **Never commit secrets.** Use fake values in tests and placeholders in docs.
- **Never log tokens** or full request bodies.
- Keep dependencies minimal. Explain any new one in your PR.
- Be kind and constructive in reviews and discussions.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
