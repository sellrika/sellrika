import { Storage } from "@xcore/storage/Storage";
import type { InlineImage } from "@mail/types";
import {
	MAIL_BODY_PICTURES_MAX,
	MAIL_BODY_PICTURES_MS,
	MAIL_LOGO_IMAGE_PX,
} from "@constants/Mail.Constant";

/**
 * Read a picture: one of our uploads, else download an https link.
 * @param url A `/uploads/…` path or an https link.
 * @returns The bytes and mime type, or null when it can't be read.
 */
async function readPicture(url: string) {
	if (Storage.isUploadUrl(url)) return Storage.readBytes(url);
	const file = await Storage.fetchImage(url);
	return "error" in file ? null : file;
}

/**
 * Read one picture, shrink it and add it to an email's inline files (CID).
 * The email carries its own copy.
 * So it still shows after the picture is deleted.
 * Only a picture that can't be read leaves the email without it.
 * @param inline The list to add to.
 * @param url A `/uploads/…` path or an https link, or null.
 * @param name The file's name in the email, for example `item-0`.
 * @param px The box the picture must fit in, in pixels.
 * @returns The `cid:` link, or null when there is no picture.
 */
export async function inlinePicture(
	inline: InlineImage[],
	url: string | null | undefined,
	name: string,
	px: number,
): Promise<string | null> {
	if (!url) return null;
	const file = await readPicture(url);
	if (!file) return null;
	const small = await Storage.shrink(file, px);
	const cid = `${name}@pos`;
	inline.push({
		cid,
		filename: `${name}.${small.ext}`,
		contentType: small.type,
		content: small.bytes,
	});
	return `cid:${cid}`;
}

/**
 * Read the shop's logo, shrink it and add it to an email's inline files.
 * @param inline The list to add to.
 * @param shop The shop sending the email.
 * @returns The `cid:` link, or null when the shop has no logo.
 */
export function inlineLogo(
	inline: InlineImage[],
	shop: { logo: string | null },
): Promise<string | null> {
	return inlinePicture(inline, shop.logo, "logo", MAIL_LOGO_IMAGE_PX);
}

/**
 * Put every picture of some HTML inside the email (CID).
 * A picture that can't be read is removed.
 * So the email shows no broken picture.
 * Each link is read once. Only the first `MAIL_BODY_PICTURES_MAX` links
 * are read, and none is started after `MAIL_BODY_PICTURES_MS`:
 * one email must not hold the job that sends every shop's emails.
 * @param html The sanitised HTML.
 * @param inline The list to add the pictures to.
 * @param px The box each picture must fit in, in pixels.
 * @returns The HTML with `cid:` links.
 */
export async function inlineHtmlPictures(
	html: string,
	inline: InlineImage[],
	px: number,
): Promise<string> {
	// two passes: HTMLRewriter handlers are sync, the downloads are not
	const srcs: string[] = [];
	await new HTMLRewriter()
		.on("img", {
			element(el) {
				srcs.push(el.getAttribute("src") ?? "");
			},
		})
		.transform(new Response(html))
		.text();
	const cids = new Map<string, string | null>();
	const deadline = Date.now() + MAIL_BODY_PICTURES_MS;
	const links = [...new Set(srcs)].slice(0, MAIL_BODY_PICTURES_MAX);
	for (const [i, src] of links.entries()) {
		// ponytail: checked between pictures, so the last one may run past it
		if (Date.now() >= deadline) break;
		cids.set(src, await inlinePicture(inline, src, `body-${i}`, px));
	}
	return new HTMLRewriter()
		.on("img", {
			element(el) {
				const cid = cids.get(el.getAttribute("src") ?? "");
				if (!cid) return void el.remove();
				el.setAttribute("src", cid);
				el.setAttribute("style", "max-width:100%;height:auto");
			},
		})
		.transform(new Response(html))
		.text();
}
