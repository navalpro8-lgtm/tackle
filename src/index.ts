/* eslint-disable no-console -- startup errors must reach stderr before a logger exists */
import { createApp, INSTALL_PATH } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`${err.message}\n\nSee .env.example for the expected variables.`);
      process.exit(1);
    }
    throw err;
  }

  const db = openDatabase(config.databasePath);
  const { app } = createApp(config, db);

  await app.start(config.port);
  app.logger.info(`Tackle listening on port ${config.port}`);
  app.logger.info(
    `Install URL: http://localhost:${config.port}${INSTALL_PATH} (use your tunnel URL)`,
  );

  const shutdown = async (signal: string) => {
    app.logger.info(`${signal} received, shutting down`);
    await app.stop();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // Print the message only: stack traces and error objects can carry request data.
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
