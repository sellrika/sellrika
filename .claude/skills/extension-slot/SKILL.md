---
name: extension-slot
description: Add a new UI slot where extensions can mount their own interface inside an app page (like `product.form`) — the constant, the `<ExtensionSlot>` in the page with its context, the context type, the docs and the tests. Use when asked to let extensions add UI to a page, e.g. "let extensions add a panel on the order page" or "/extension-slot order.show".
---

# New extension slot

Usage: `/extension-slot <name> <page> <what the context offers>` — e.g. `/extension-slot order.show Orders/Show.vue below the totals, context = the order`.

Names are `<page>.<place>` in lower case (`product.form`, `order.show`, `pos.cart`, `customer.show`).

## Steps — all of them, in this order
1. **Constant**: add the name to `EXTENSION_SLOTS` in `app/constants/Extension.Constant.ts` (the manifest validator and the type `ExtensionSlot` follow).
2. **Context type**: add a key to `SlotContexts` in `extensions/types.ts` describing what `api.context` carries, with a JSDoc that says where the slot renders and the shape of every value (money as integer cents or as the form's decimal strings — say which). Give read access as plain data or functions, and write access only through explicit functions (`set(patch)`, `refresh()`), never the raw Vue form/reactive object.
3. **Render it**: in the page, `import ExtensionSlot from "@/components/ExtensionSlot.vue";` and place
   `<ExtensionSlot name="<name>" :context="<context>" />` at the spot described; build the context object in `<script setup>` (a plain object of functions/data — see `productSlot` in `resources/js/Pages/Products/Form.vue`). Keep `v-show`/tab conditions the surrounding content has. It renders nothing when no running extension names the slot.
4. **Docs**: the JSDoc of the slot's context in `extensions/types.ts` is what authors read: say there where the slot is and what it gets.
5. **Tests**: `app/services/settings/__tests__/Extension.Service.test.ts` — a manifest naming the new slot passes validation and `ui()` returns its script URL under that name. `e2e/o-extensions.spec.ts` — zip a small extension inline with `zip()` (manifest `slots` + an `assets/<name>.ts` script that uses the context) and click through it: upload, enable, open the page, assert what the script rendered / changed.
6. **Verify**: `bunx tsc --noEmit -p . && bun test && bun run build && bunx playwright test e2e/o-extensions.spec.ts`.

## Don't
- Don't hand the extension Vue internals, the Inertia form object or component refs — only the context you documented.
- Don't gate the slot in the UI by role; the server already filters `extension_ui` per role for pages, and slots follow the extension's enabled state.
