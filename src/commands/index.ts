import type { App } from '@slack/bolt';
import { registerPingCommand } from './ping.js';

/**
 * Every slash command the app handles.
 * To add one: create `src/commands/<name>.ts` exporting a `register…(app)` function,
 * add it to this list, and add the command to slack-manifest.yaml.
 */
const commands: Array<(app: App) => void> = [registerPingCommand];

export function registerCommands(app: App): void {
  for (const register of commands) register(app);
}
