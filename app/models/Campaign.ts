import type { CampaignStatus } from "@constants/Marketing.Constant";

/** One email campaign of a shop (migration 0061, `campaigns`). */
export type Campaign = {
	id: number;
	shop_id: number;
	subject: string;
	/** Rich text, sanitised on save. */
	body: string;
	/** Products shown as cards under the text. */
	product_ids: number[];
	/** The customers the owner picked. */
	customer_ids: number[];
	status: CampaignStatus;
	/** When it goes out (UTC); null = a draft. */
	send_at: string | null;
	sent: number;
	failed: number;
	created_by: number | null;
	created_at: string;
	updated_at: string;
};

/** One recipient of a campaign (`campaign_sends`). */
export type CampaignSend = {
	id: number;
	campaign_id: number;
	customer_id: number;
	email: string;
	/** Null = not sent (failed, skipped, or cut off by a crash). */
	sent_at: string | null;
	error: string | null;
	/** The customer's name, when the row still exists. */
	name: string | null;
};

/** A customer the recipient picker shows. */
export type MarketingCustomer = {
	id: number;
	name: string;
	email: string;
	unsubscribed: boolean;
};
