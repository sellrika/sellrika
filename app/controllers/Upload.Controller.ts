import { Account } from "@xcore/auth/Account";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { Storage } from "@xcore/storage/Storage";
import { Service } from "@xcore/di";
import { ShopRepository } from "@repositories/Shop.Repository";
import { UPLOAD_FOLDERS, type UploadFolder } from "@constants/Storage.Constant";

/**
 * Image uploads for the product form and the page builder
 * (admin only).
 */
@Service()
export class UploadController {
	constructor(private shops: ShopRepository) {}

	/**
	 * JSON API: POST /uploads (multipart).
	 * The fields are "file", "folder" and an optional "shop".
	 * The file lands in `/uploads/<shop id>/<folder>/`.
	 * The shop is the active one.
	 * Or it is "shop", when that names another shop of the same
	 * account (a logo on its edit page).
	 * @param req The request, carrying the multipart body.
	 * @returns 201 `{ url }`, or 422 `{ errors }` when the file,
	 *   folder or shop is not right.
	 */
	async store(req: Request) {
		const form = await HttpRequest.formOf(req);
		const file = form?.get("file");
		if (!(file instanceof File))
			return HttpResponse.unprocessable({ file: t("server.upload_no_file") });
		const folder = form?.get("folder");
		if (!this.#isClientFolder(folder))
			return HttpResponse.unprocessable({
				file: t("server.upload_bad_folder"),
			});
		const shopId = await this.#shopId(req, form?.get("shop"));
		if (!shopId)
			return HttpResponse.unprocessable({ file: t("server.not_found") });
		const r = await Storage.storeImage(file, shopId, folder);
		return "error" in r
			? HttpResponse.unprocessable({ file: r.error })
			: json({ url: r.url }, 201);
	}

	/**
	 * JSON API: POST /uploads/link `{ url }`.
	 * Hands back the picture behind an https link, so the image editor can crop it.
	 * Nothing is stored; the edited result is uploaded through `store`.
	 * @param req The request, carrying the link.
	 * @returns The image bytes, or 422 `{ errors }`.
	 */
	async link(req: Request) {
		const { url } = ((await HttpRequest.body(req)) ?? {}) as { url?: unknown };
		const r = await Storage.fetchImage(typeof url === "string" ? url : "");
		return "error" in r
			? HttpResponse.unprocessable({ url: r.error })
			: new Response(r.bytes, { headers: { "content-type": r.type } });
	}

	/**
	 * A folder the browser may upload into: any of `UPLOAD_FOLDERS` but `orders`,
	 * which only the checkout writes (order pictures are never deleted).
	 * @param v The "folder" form field.
	 * @returns True for an allowed folder.
	 */
	#isClientFolder(v: unknown): v is UploadFolder {
		return v !== "orders" && (UPLOAD_FOLDERS as readonly unknown[]).includes(v);
	}

	/**
	 * The shop an upload belongs to.
	 * @param req The current request.
	 * @param asked The "shop" form field, if any.
	 * @returns The active shop's id, or the asked shop's id when
	 *   the account owns it, else null.
	 */
	async #shopId(req: Request, asked: unknown) {
		const { shop, user } = ctx(req);
		if (!asked) return shop.id;
		const own = await this.shops.findOwned(Number(asked), Account.id(user));
		return own?.id ?? null;
	}
}
