/// <reference types="vite/client" />

/**
 * The build this bundle was made from, injected by `vite.config.ts`. Declared
 * optional because the test runner does not inject it — `src/lib/appVersion.ts`
 * treats a missing value as "nothing to compare against".
 */
declare const __APP_BUILD__: { commit: string; builtAt: string } | undefined;
