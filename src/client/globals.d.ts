/**
 * Ambient browser globals the plugin's test hook touches. The bundle is
 * wrapped in `window.__ModuleLoader__.load(...)` at build time, so the loader
 * itself is not declared here.
 */

export {};

declare global {
  interface Window {
    /** Set by the test harness before the bundle is evaluated. */
    __dsmTestHooks?: boolean;
    /** Installed by the bundle when `__dsmTestHooks` is on. */
    __dsmTest?: Record<string, unknown>;
  }
}
