---
name: new-language
description: Add a new language to the whole app (staff pages, online store, validation messages, emails) — the dictionary file translated from English, the locale list, Zod's messages, the language name, tests and docs. Use when asked to add, support or translate the app into a language, e.g. "add French" or "/new-language fr French".
---

# New language

Usage: `/new-language <code> <name>` — e.g. `/new-language fr Français`. `<code>` is the 2-letter
ISO 639-1 code the browser sends in `Accept-Language` (`fr`, `ja`, `th`); `<name>` is the language's
own name ("Français", not "French").

The app has one dictionary for server and frontend (`i18n/`). English (`i18n/en.ts`) is the source of
truth; every other language `satisfies` the same keys, so `bun check` finds a missing or extra one.
Extensions are **not** part of this: each extension has its own `i18n/` folder, and a language it
doesn't ship falls back to its English. Only add extension files when asked.

## Steps — all of them, in this order

1. **Language name**: add `"lang.<code>": "<name>"` after the last `lang.*` key in **every** dictionary
   (`i18n/en.ts`, `de.ts`, `th.ts`, …). It is always the language's own name, in every file.
2. **Translate** `i18n/en.ts` into `i18n/<code>.ts` (about 2,100 keys — too many for one pass):
   - Split the body of `en` (the lines between `export const en = {` and `} as const;`) into **5 parts**
     at `// ── <area> ──` comment lines, about the same size each. Write them to `/tmp/en-part-<n>.ts`.
   - Start **5 subagents at once** (at most 5), one per part. Each writes
     `/tmp/<code>-part-<n>.ts`: the **same keys in the same order**, the same comments, only the values
     translated, no `export`/imports. Tell each one to:
     - keep every `{placeholder}`, HTML tag, URL, email address, code token (`CSV`, `SKU`, `SMTP`, `API`,
       `APP_KEY`, `VAT`…) and brand name (Stripe, PayPal, Firebase, Google, Telegram, GeoNames, POS…) as is;
     - use short, everyday UI wording as local shop and POS apps do, one term per idea across the file;
     - keep `lang.*` values unchanged;
     - use straight `"` for the TS strings and “ ” inside a text;
     - check its part with `diff <(rg -o '^\t"[^"]+":' /tmp/en-part-<n>.ts) <(rg -o '^\t"[^"]+":' /tmp/<code>-part-<n>.ts)`.
   - Put the parts together in `i18n/<code>.ts`, with the same header as `i18n/de.ts`:
     `import type { en } from "./en";` + a one-line comment + `export const <code> = {` … `} satisfies Record<keyof typeof en, string>;`.
     Then `bunx biome format --write i18n/<code>.ts`.
3. **Register it** in `i18n/index.ts`: `import { <code> } from "./<code>";`, add it to the `Locale` type,
   to `LOCALES` (the order the switchers show) and to `dictionaries`.
4. **Zod's own messages**: add `<code>: z.locales.<code>().localeError` to `zodLocales` in
   `app/validators/validate.ts`. Check that Zod has it: `ls node_modules/zod/v4/locales/ | rg '^<code>\.'`.
   If it doesn't, use `z.locales.en()` and say so.
5. **Check the translation**: `bun .claude/skills/new-language/check.ts <code> "<letters regex>"`
   (e.g. `"[\u0E00-\u0E7F]"` for Thai; leave it out for Latin scripts). It lists missing keys,
   `{placeholder}` / HTML tag mismatches and texts that look untranslated.
   - Fix every mismatch. `reports.hour_am` / `hour_pm` are allowed to differ: they get `{h12}` **and**
     `{h24}`, and a 24-hour-clock language uses `"{h24}:00"` (German, Thai). A new key like that goes into
     `FREE_PLACEHOLDERS` in `check.ts`.
   - Untranslated is fine for brand names, code tokens, examples (`you@shop.com`) and pure placeholders.
6. **Nothing else lists the languages.** The user menu (`AppLayout.vue`), the storefront footer, the
   `/online-store` › Languages rows and `StoreLanguagesInput` all read `LOCALES`, and money and dates use
   `Intl` with the code. Existing shops keep their `shops.languages` list. The new language is off on
   their store until the shop switches it on, so don't write a migration.
7. **Tests**: in `app/xcore/i18n/__tests__/i18n.test.ts` add a `translate("<code>", "common.save")` check,
   a `negotiate("<code>-XX,<code>;q=0.9,en;q=0.8")` check, and a `validate()` run inside
   `I18n.withLocale("<code>", …)` (our key and Zod's email message, both in the new language).
8. **Docs**: the user guide where it names the languages (`resources/guide/`).
9. **Verify**: `bun run lint && bun check && bun test`, then `bun run build` and
   `bunx playwright test e2e/p-i18n.spec.ts` (a fresh build first — e2e serves `public/build`).

## Tell the user
- The translation is machine-made; a native speaker should read the main pages once.
- Anything `Intl` does differently in that language (Thai dates show the Buddhist year, for example).
- Printed receipts (RawBT, ESC/POS) may need a printer code page for a non-Latin script.

## Don't
- Don't add extension `i18n/<code>.ts` files unless asked.
- Don't translate keys, placeholders or `lang.*` names; don't reorder keys.
- Don't change the `shops.languages` default or existing rows.
