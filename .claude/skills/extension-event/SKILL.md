---
name: extension-event
description: Add a new event that extensions can listen for (like `order.created`) — the constant, the payload types, the emit() call at the place it happens, the docs and the tests. Use when asked to add, expose or fire an extension event / hook, e.g. "let extensions know when an order is refunded" or "/extension-event product.saved".
---

# New extension event

Usage: `/extension-event <name> <what it carries> <where it happens>` — e.g. `/extension-event order.refunded { order, refund } OrderService.refund after the refund is written`.

Names are `<thing>.<past-tense verb>` in lower case (`order.created`, `order.refunded`, `product.saved`, `stock.moved`).

## Steps — all of them, in this order
1. **Constant**: add the name to `EXTENSION_EVENTS` in `app/constants/Extension.Constant.ts` (the type `ExtensionEvent` follows).
2. **Server payload type**: add a key to `ExtensionEvents` in `app/services/settings/extensions/types/Extension.Events.Types.ts` with the data the listener gets (besides `shop` and `config`, which every event carries). Use the existing model types (`OrderFull`, `Product`, …); never costs or credentials the extension has no business with.
3. **Author-facing type**: mirror it in `Events` in `extensions/types.ts`, with a one-line JSDoc saying when it fires.
4. **Fire it**: in the service where the thing happens, right after the write is committed, add
   `void this.extensions.emit("<name>", shop, { … });` — `void`, never awaited, with a short comment. Inject `ExtensionService` in the constructor if the service doesn't have it yet (`private extensions: ExtensionService`; no circular imports — `ExtensionService` must not import that service). Fire it from **every** place the thing happens (POS and online store both create orders, for example).
5. **Docs**: the JSDoc of the event in `extensions/types.ts` is what authors read: say there when it fires and what it carries.
6. **Tests**: `app/services/settings/__tests__/ExtensionEvents.test.ts` uploads one recorder extension that listens for every name in `EXTENSION_EVENTS` (so a new event is recorded with no change there), then drives the real services. Add a step for the new event: do the thing through the service, `await events(n)` (it calls `ExtensionService.idle()`, which waits for every `void` emit in flight, and fails on any extra event — `reset()` first) and assert the payload. Cover every fire site.
7. **Verify**: `bun check && bun test`.

## Don't
- Don't await `emit()` on a request path; don't let it throw (it already catches — keep it that way).
- Don't add an event nobody fires, or fire one from only one of two code paths.
