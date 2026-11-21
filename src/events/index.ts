import type { App, InstallationStore } from '@slack/bolt';
import { registerAppUninstalled } from './appUninstalled.js';

/**
 * Every Slack event the app handles.
 * To add one: create `src/events/<name>.ts`, add it to this list, and add the event
 * under `bot_events` in slack-manifest.yaml.
 */
const events: Array<(app: App, store: InstallationStore) => void> = [registerAppUninstalled];

export function registerEvents(app: App, store: InstallationStore): void {
  for (const register of events) register(app, store);
}
