/**
 * The shapes live in ./types.
 * So a provider file can import them without a cycle back through here.
 * A test importing a mailer directly would otherwise get a half-loaded module.
 * The registry that lists the providers is ./Mailer.Registry.ts.
 */
export { MailError } from "./types";
export type { InlineImage, MailField, MailMessage, Mailer } from "./types";
