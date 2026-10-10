import { Hooks } from "@xcore/hooks/Hooks";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { GuideQuery } from "@validators/ApiQuery.Validator";
import { GUIDE_TOPICS } from "@constants/Guide.Constant";
import { guides, guideTitle } from "@resources/guide";

/**
 * The user guide, how to do things in the app's screens.
 * It is the MCP tool `read_user_guide` only, never an API route:
 * an assistant reads a topic and answers the person's question.
 * The texts are English only; the assistant answers in the person's language.
 * An extension the shop runs may add one topic of its own (manifest
 * `guide`), named by its key.
 */
@Service()
export class GuideApiController {
	constructor(private extensions: ExtensionService) {}

	/**
	 * The tool `read_user_guide` — one topic of the guide, plus the names of
	 * all topics.
	 * @param req The current request.
	 * @returns `{ topic, title, text, topics }`;
	 *   without `topic` the overview;
	 *   422 for a topic the shop does not have.
	 */
	async show(req: Request) {
		const v = ApiResponse.query(req, GuideQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		const { topic } = v.data;
		// ponytail: an extension keyed like a topic of the app ("orders")
		// is hidden by it; prefix the topic if one ever is
		const all: Record<string, string> = Object.fromEntries(
			(await this.extensions.guides(ctx(req).shop.id)).map(function entry(one) {
				return [one.topic, one.text];
			}),
		);
		Object.assign(all, Hooks.guides);
		for (const key of GUIDE_TOPICS) all[key] = guides[key];
		const text = all[topic];
		if (text === undefined)
			return ApiResponse.invalid({ topic: t("api.guide_topic_unknown") });
		return json({
			topic,
			title: guideTitle(text),
			text,
			topics: [
				...GUIDE_TOPICS,
				...Object.keys(all).filter(function added(key) {
					return !(GUIDE_TOPICS as readonly string[]).includes(key);
				}),
			].map(function listed(key) {
				return { topic: key, title: guideTitle(all[key] ?? "") };
			}),
		});
	}
}
