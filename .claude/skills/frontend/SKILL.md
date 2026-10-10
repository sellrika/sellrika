---
name: frontend
description: Add or change UI in this POS (Inertia v3 pages, Vue 3 components, shadcn-vue, Tailwind v4). Use when a task touches resources/js (Pages, components, layouts, lib, types.ts) or resources/css.
---

# Frontend

Inertia pages live in `resources/js/Pages/<Area>/<Name>.vue`; the controller renders them by that string (`inertia(req, "Customers/Index", props)`). Props are typed from `resources/js/types.ts` — update it when the backend shape changes.

## Page skeleton
Copy `Pages/Customers/Index.vue` (list + dialog + server search + pager) or `Pages/Customers/Show.vue` (detail). Keep:
- `<script setup lang="ts">`, `defineOptions({ layout: AppLayout })`, `defineProps<{…}>()` with types from `@/types`.
- `<Head title="…" />`, wrapper `mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6`.
- Forms: `useForm()` → `form.post/put(url, { preserveScroll, onSuccess })`; errors arrive as `form.errors.<field>`; success → `toast.success()` from `vue-sonner`.
- Lists: server-side `?q=`/`?page=` with `watchDebounced` + `router.get(..., { preserveState, preserveScroll, replace })`, `components/Pager.vue`, `useFitPage(key, url, chromePx, …)`.
- Money through `money(cents, currency)` (`lib/format.ts`); currency from `usePage<SharedProps>().props.shop.currency`.
- Role-gated UI: `useAuth()` from `lib/auth.ts` (`isAdmin`); never rely on it for security (server gates).

## Components
- Dialogs: `DialogContent` / `AlertDialogContent` already cap their height, scroll only the body (never sideways) and keep the header + footer pinned — never add `max-h` / `overflow` to a dialog or its form; pass `p-0 gap-0` only for full-bleed layouts that scroll themselves.
- UI primitives: `@/components/ui/*` (shadcn-vue). Missing one → `bunx shadcn-vue@latest add <component>`. Icons from `@lucide/vue`.
- Shared pieces go in `resources/js/components/` (`CurrencySelect`, `IconPicker`, `Pager`, `pos/*`, `products/*`) — check there before writing a new one.
- Give interactive controls accessible names (`aria-label`, `<Label for>`, button text like `Delete {{ name }}`) — e2e tests locate by role/label, not CSS.

## Rules
- Every user-visible text goes through `t("area.key")` from `@/lib/i18n` (keys in `i18n/en.ts` + `i18n/de.ts`); call it at render time, never at module load.
- Tailwind utility classes + existing theme tokens (`text-muted-foreground`, `bg-muted`…); no new CSS files, no new deps.
- Empty state + loading/disabled states for every list/form.
- Any new page or user flow gets e2e coverage → load the `e2e-test` skill. `bun run lint && bunx tsc --noEmit -p .` must pass (Biome formats the `<script>` of Vue files; Vue files are type-checked through the TS project).
