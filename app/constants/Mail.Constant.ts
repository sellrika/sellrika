/** Outgoing email — the platform's, and each shop's own. */

/**
 * `settings.key` of the JSON row that holds the platform's mail setup
 * (migration 0031).
 * A shop's own setup is `mail:shop:<id>`.
 */
export const MAIL_SETTING_KEY = "mail";

/**
 * The sender name on email to the app's users
 * (sign-up confirmation, invitations, alerts, test email).
 * Email to a shop's customers is sent in the shop's name instead.
 */
export const MAIL_SYSTEM_NAME = "Sellrika";

/**
 * How many emails of one campaign go out at the same time.
 * Each worker takes the next waiting row of `email_queue`
 * as soon as its email is sent.
 */
export const EMAIL_WORKERS = 5;

/**
 * What an `email_queue` row can be.
 * `campaign` = one recipient of a campaign (ref_id = the `campaign_sends` row).
 */
export const EMAIL_QUEUE_KINDS = ["campaign"] as const;

/** One of `EMAIL_QUEUE_KINDS`. */
export type EmailQueueKind = (typeof EMAIL_QUEUE_KINDS)[number];

/**
 * How many times Resend is asked before a send gives up
 * on "too many requests" (429).
 * Resend allows 10 requests a second per account.
 * Between tries we wait its `retry-after`.
 */
export const RESEND_MAX_TRIES = 3;

/**
 * The version of Azure's Email REST API we call.
 * The first stable one with inline images.
 */
export const AZURE_EMAIL_API_VERSION = "2025-09-01";

/**
 * How many times Azure is asked before a send gives up
 * on "too many requests" (429).
 * Between tries we wait its `retry-after`.
 */
export const AZURE_MAX_TRIES = 3;

/** How long each SMTP round trip may take before the send is abandoned. */
export const SMTP_TIMEOUT_MS = 15_000;

/**
 * The most different pictures of an email's own HTML that are put inside it.
 * The ones past it are removed.
 */
export const MAIL_BODY_PICTURES_MAX = 20;

/**
 * How long reading all pictures of an email's HTML may take.
 * No new picture is started after it. The ones not read are removed.
 */
export const MAIL_BODY_PICTURES_MS = 30_000;

/**
 * Where Resend takes a message.
 * `RESEND_API_URL` points it at a stand-in in the e2e tests.
 */
export const RESEND_API_URL =
	process.env.RESEND_API_URL ?? "https://api.resend.com/emails";

/**
 * The box a product picture in an order email is shrunk to fit, in pixels.
 * It is shown at about 56 px; twice that stays sharp on high-density screens.
 */
export const MAIL_ITEM_IMAGE_PX = 112;

/**
 * The box the shop logo in an order email is shrunk to fit, in pixels.
 * It is shown at 40 px; twice that stays sharp on high-density screens.
 */
export const MAIL_LOGO_IMAGE_PX = 80;
