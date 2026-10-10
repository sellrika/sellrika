import { t } from "@/lib/i18n";
import type { CampaignStatus } from "@/types";

/**
 * How a campaign's status looks: its label and badge style.
 * @param status The campaign's status.
 * @returns The label and the badge variant.
 */
export function campaignStatus(status: CampaignStatus): {
	label: string;
	variant: "default" | "secondary" | "outline";
} {
	if (status === "sent")
		return { label: t("marketing.status_sent"), variant: "default" };
	if (status === "sending")
		return { label: t("marketing.status_sending"), variant: "secondary" };
	if (status === "scheduled")
		return { label: t("marketing.status_scheduled"), variant: "secondary" };
	return { label: t("marketing.status_draft"), variant: "outline" };
}
