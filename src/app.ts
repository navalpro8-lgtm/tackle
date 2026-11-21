import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import { registerPingCommand } from './commands/ping.js';
import type { Config } from './config.js';
import { TokenCipher } from './crypto.js';
import { pingDatabase, type DB } from './db.js';
import { registerHealthRoute } from './health.js';
import { SqliteInstallationStore } from './store/sqliteInstallationStore.js';

export const INSTALL_PATH = '/slack/install';
export const REDIRECT_PATH = '/slack/oauth_redirect';
export const EVENTS_PATH = '/slack/events';

const LOG_LEVELS: Record<Config['logLevel'], LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

export interface TackleApp {
  app: App;
  receiver: ExpressReceiver;
  installationStore: SqliteInstallationStore;
}

export function createApp(config: Config, db: DB): TackleApp {
  const installationStore = new SqliteInstallationStore(db, new TokenCipher(config.encryptionKey));

  const receiver = new ExpressReceiver({
    signingSecret: config.slack.signingSecret,
    // On by default in Bolt; set explicitly so it can't be switched off by accident.
    // Every request to /slack/events must carry a valid X-Slack-Signature or gets a 401.
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
      // Send visitors of /slack/install straight to Slack instead of an intermediate page.
      directInstall: true,
      // Verify the OAuth state parameter against a browser cookie (CSRF protection).
      stateVerification: true,
    },
    logLevel: LOG_LEVELS[config.logLevel],
  });

  registerHealthRoute(receiver.router, { database: () => pingDatabase(db) });

  // With a receiver that has an installer, Bolt authorizes each request by looking up
  // the installation for that team in our store.
  const app = new App({ receiver, logLevel: LOG_LEVELS[config.logLevel] });

  registerPingCommand(app);

  // Clean up stored tokens when a workspace removes the app.
  app.event('app_uninstalled', async ({ context, logger }) => {
    await installationStore.deleteInstallation({
      teamId: context.isEnterpriseInstall ? undefined : context.teamId,
      enterpriseId: context.enterpriseId,
      isEnterpriseInstall: context.isEnterpriseInstall,
    });
    logger.info(`Removed installation for team=${context.teamId ?? '-'}`);
  });

  return { app, receiver, installationStore };
}
