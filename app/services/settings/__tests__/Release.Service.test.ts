import { expect, test } from "bun:test";
import { ReleaseService } from "@services/settings/Release.Service";

/**
 * A release service whose GitHub answers with this.
 * @param res What every ask gets.
 * @returns The service.
 */
function withAnswer(res: () => Response) {
	const s = new ReleaseService();
	s.fetcher = async function stub() {
		return res();
	};
	return s;
}

test("release: a newer tag gives an update with its page", async () => {
	const s = withAnswer(function newer() {
		return Response.json({ tag_name: "v1.10.0" });
	});
	await s.run();
	expect(s.update("1.9.3")).toEqual({
		version: "1.10.0",
		url: "https://github.com/sellrika/sellrika/releases/tag/v1.10.0",
	});
});

test("release: the same or an older tag gives no update", async () => {
	const s = withAnswer(function same() {
		return Response.json({ tag_name: "v1.2.0" });
	});
	await s.run();
	expect(s.update("1.2.0")).toBeNull();
	expect(s.update("1.3.0")).toBeNull();
	expect(s.update("2.0.0")).toBeNull();
});

test("release: a failure or an odd tag keeps what was known", async () => {
	let res = Response.json({ tag_name: "v1.5.0" });
	const s = withAnswer(function answer() {
		return res;
	});
	await s.run();
	res = new Response("rate limited", { status: 403 });
	await s.run();
	expect(s.update("1.0.0")?.version).toBe("1.5.0");
	res = Response.json({ tag_name: "v9.0.0-beta.1" });
	await s.run();
	expect(s.update("1.0.0")?.version).toBe("1.5.0");
	s.fetcher = async function down() {
		throw new Error("offline");
	};
	await s.run();
	expect(s.update("1.0.0")?.version).toBe("1.5.0");
});

test("release: nothing known, or a running version that is not a version, gives no update", () => {
	const s = new ReleaseService();
	expect(s.update("1.0.0")).toBeNull();
	s.latest = "2.0.0";
	expect(s.update("dev")).toBeNull();
});
