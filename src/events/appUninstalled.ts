import type { App, InstallationStore } from '@slack/bolt';

/** When a workspace removes the app, delete its stored tokens. */
export function registerAppUninstalled(app: App, store: InstallationStore): void {
  app.event('app_uninstalled', async ({ context, logger }) => {
    await store.deleteInstallation?.({
      teamId: context.isEnterpriseInstall ? undefined : context.teamId,
      enterpriseId: context.enterpriseId,
      isEnterpriseInstall: context.isEnterpriseInstall,
    });
    logger.info(`Removed installation for team=${context.teamId ?? '-'}`);
  });
}
