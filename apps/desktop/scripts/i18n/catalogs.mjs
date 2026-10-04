/**
 * [INPUT]: Explicit product translation module paths, including shared App enablement and plugin installation copy.
 * [OUTPUT]: translationCatalogFiles, the closed set of complete locale dictionaries.
 * [POS]: Copy-audit policy data; UI and execution modules remain subject to sink checks.
 */
// These modules contain complete five-language dictionaries, without UI or execution logic.
export const translationCatalogFiles = new Set([
  "apps/cloud-web/src/onboarding/copy.ts",
  "apps/cloud-web/src/shortcuts/copy.ts",
  "apps/cloud-web/src/shell/copy.ts",
  "apps/cloud-web/src/push/copy.ts",
  "apps/cloud-web/src/server-tunnel/copy.ts",
  "apps/desktop/electron/main/preview/session/copy.ts",
  "packages/base-ui/src/ui/workflow/details/copy.ts",
  "packages/chat-ui/src/artifacts/live/copy.ts",
  "apps/cloud-web/src/routes/settings/memory/copy.ts",
  "packages/chat-ui/src/deletion/copy.ts",
  "packages/chat-ui/src/i18n/messages/failure.ts",
  "packages/chat-ui/src/i18n/navigation.ts",
  "packages/chat-ui/src/i18n/messages/notice.ts",
  "packages/chat-ui/src/i18n/messages/remote.ts",
  "packages/chat-ui/src/i18n/side-panel.ts",
  "packages/chat-ui/src/ui/composer/controls/copy/en.ts",
  "packages/chat-ui/src/ui/composer/controls/copy/es.ts",
  "packages/chat-ui/src/ui/composer/controls/copy/fr.ts",
  "packages/chat-ui/src/ui/composer/controls/copy/ja.ts",
  "packages/chat-ui/src/ui/composer/controls/copy/zh-cn.ts",
  "packages/chat-ui/src/ui/composer/agent/quota/copy.ts",
  "packages/ui/src/components/workspace/copy/en.ts",
  "packages/ui/src/components/workspace/copy/es.ts",
  "packages/ui/src/components/workspace/copy/fr.ts",
  "packages/ui/src/components/workspace/copy/ja.ts",
  "packages/ui/src/components/workspace/copy/zh-cn.ts",
  "packages/ui/src/lib/ui-text-copy/en.ts",
  "packages/ui/src/lib/ui-text-copy/es.ts",
  "packages/ui/src/lib/ui-text-copy/fr.ts",
  "packages/ui/src/lib/ui-text-copy/ja.ts",
  "packages/ui/src/lib/ui-text-copy/zh-cn.ts",
  ...["en", "es", "fr", "ja", "zh-cn"].map(locale => `packages/ui/src/lib/workbench-copy/${locale}.ts`),
  ...["en", "es", "fr", "ja", "zh-cn"].map(locale => `packages/ui/src/lib/workbench-copy/memory/${locale}.ts`),
  ...["en", "es", "fr", "ja", "zh-cn"].map(locale => `packages/ui/src/lib/workbench-copy/dock/${locale}.ts`),

  "apps/desktop/src/views/cloud-chat/retained/copy.ts",
  "apps/desktop/src/views/cloud-chat/retained/project-copy.ts",
  "packages/ui/src/lib/account-deletion-copy/index.ts",
  "packages/ui/src/lib/app-enablement/copy.ts",
  "packages/ui/src/lib/plugin-install/copy.ts",
  "packages/ui/src/lib/shortcuts/copy.ts",
]);
