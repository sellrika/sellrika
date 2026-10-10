import { expect, test } from "bun:test";
import { MAIL_BODY_PICTURES_MAX } from "@constants/Mail.Constant";
import { Storage } from "@xcore/storage/Storage";
import { inlineHtmlPictures } from "@emails/pictures";

test("inlineHtmlPictures: each link is read once, and only the first few", async () => {
	const read = Storage.readBytes;
	const asked: string[] = [];
	Storage.readBytes = async function none(url: string) {
		asked.push(url);
		return null;
	} as typeof Storage.readBytes;
	try {
		const links = Array.from(
			{ length: MAIL_BODY_PICTURES_MAX + 5 },
			(_, i) => `/uploads/1/products/${i}.png`,
		);
		// every picture twice
		const html = [...links, ...links]
			.map((src) => `<img src="${src}">`)
			.join("");
		const out = await inlineHtmlPictures(`<p>hi</p>${html}`, [], 100);
		expect(asked).toEqual(links.slice(0, MAIL_BODY_PICTURES_MAX));
		// a picture that was not read is removed
		expect(out).toBe("<p>hi</p>");
	} finally {
		Storage.readBytes = read;
	}
});
