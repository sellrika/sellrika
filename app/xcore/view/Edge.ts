import { Edge } from "edge.js";
import { app } from "@config/app";

/**
 * The one Edge instance.
 * Templates are imported with `{ type: "text" }`.
 * The module that owns them registers them:
 * root view: xcore/view/inertia.ts, the store: xcore/view/store.ts,
 * emails: app/emails/*.
 * So they are embedded at compile time and work inside the single binary.
 * Compiled templates are cached in production only, so dev edits show.
 */
export const edge = Edge.create({ cache: app.isProd });
