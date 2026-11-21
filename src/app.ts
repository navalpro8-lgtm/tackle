import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import { registerCommands } from './commands/index.js';
import type { Config } from './config.js';
import { TokenCipher } from './crypto.js';
import { pingDatabase, type DB } from './db.js';
import { registerEvents } from './events/index.js';
import { registerHealthRoute } from './health.js';
import { SqliteInstallationStore } from './store/sqliteInstallationStore.js';

export const INSTALL_PATH = '/slack/install';
export const REDIRECT_PATH = '/slack/oauth_redirect';
export const EVENTS_PATH = '/slack/events';

export interface TackleApp {
  app: App;
  receiver: ExpressReceiver;
  installationStore: SqliteInstallationStore;
}

/** Wires everything together. Features live in src/commands and src/events. */
export function createApp(config: Config, db: DB): TackleApp {
  const installationStore = new SqliteInstallationStore(db, new TokenCipher(config.encryptionKey));
  const logLevel = config.logLevel as LogLevel; // our level names match Bolt's enum values

  const receiver = new ExpressReceiver({
    signingSecret: config.slack.signingSecret,
    // Bolt's default, set explicitly so it can't be turned off by accident:
    // requests without a valid X-Slack-Signature get a 401.
    signatureVerification: true,
    endpoints: EVENTS_PATH,
    clientId: config.slack.clientId,
    clientSecret: config.slack.clientSecret,
    stateSecret: config.slack.stateSecret,
    scopes: config.slack.scopes,
    installationStore,
    installerOptions: {
      installPath: INSTALL_PATH,
      redirectUriPath: REDIRECT_PATH,
      directInstall: true, // skip Bolt's "Add to Slack" page
      stateVerification: true, // CSRF check: OAuth state must match a browser cookie
    },
    logLevel,
  });

  registerHealthRoute(receiver.router, { database: () => pingDatabase(db) });

  // Bolt looks up each workspace's token in our store via the receiver's installer.
  const app = new App({ receiver, logLevel });
  registerCommands(app);
  registerEvents(app, installationStore);

  return { app, receiver, installationStore };
}
