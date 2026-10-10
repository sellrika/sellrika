/**
 * The place of the hosted edition's add-on.
 * The alias `@cloud` points at `cloud/index.ts` when that folder is there,
 * else at this empty file (`tsconfig.json` › `paths`).
 * The source-available app has no such folder, so nothing is added:
 * no plans, no limits, no website.
 * An add-on changes the app only through `Hooks`
 * (`app/xcore/hooks/Hooks.ts`), the DI container and the router.
 */
export {};
