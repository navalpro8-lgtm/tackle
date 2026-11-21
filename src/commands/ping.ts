import type { App } from '@slack/bolt';

/** Formats a timestamp so Slack renders it in each viewer's own timezone. */
export function slackDate(date: Date): string {
  const unix = Math.floor(date.getTime() / 1000);
  const fallback = date.toUTCString();
  return `<!date^${unix}^{date_short_pretty} at {time_secs}|${fallback}>`;
}

export function pingMessage(workspaceName: string, now: Date): string {
  return `:wave: Pong from *${workspaceName}*. It's ${slackDate(now)}.`;
}

/** /tackle-ping: replies (only to the caller) with the workspace name and current time. */
export function registerPingCommand(app: App, now: () => Date = () => new Date()): void {
  app.command('/tackle-ping', async ({ ack, respond, client, command, logger }) => {
    await ack(); // Slack requires an ack within 3 seconds.

    let workspaceName = command.team_domain;
    try {
      const info = await client.team.info({ team: command.team_id });
      workspaceName = info.team?.name ?? workspaceName;
    } catch (err) {
      // Usually a missing team:read scope. Log the error code only, never request details.
      logger.warn(`team.info failed: ${(err as { code?: string }).code ?? 'unknown error'}`);
    }

    await respond({ response_type: 'ephemeral', text: pingMessage(workspaceName, now()) });
  });
}
