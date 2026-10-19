import { expect, test } from "bun:test";
import { oneAtATime } from "@helpers/lock";

test("oneAtATime: jobs with the same key never overlap", async () => {
	const log: string[] = [];
	const job = (name: string) => async () => {
		log.push(`${name} start`);
		await Bun.sleep(5);
		log.push(`${name} end`);
		return name;
	};
	const out = await Promise.all([
		oneAtATime("code", job("a")),
		oneAtATime("code", job("b")),
	]);
	expect(out).toEqual(["a", "b"]);
	expect(log).toEqual(["a start", "a end", "b start", "b end"]);
});

test("oneAtATime: jobs with different keys run side by side", async () => {
	const log: string[] = [];
	const job = (name: string) => async () => {
		log.push(`${name} start`);
		await Bun.sleep(5);
		log.push(`${name} end`);
	};
	await Promise.all([oneAtATime("x", job("a")), oneAtATime("y", job("b"))]);
	expect(log.slice(0, 2)).toEqual(["a start", "b start"]);
});

test("oneAtATime: a failed job throws to its caller and the next job still runs", async () => {
	const failed = oneAtATime("fail", async () => {
		throw new Error("boom");
	});
	const next = oneAtATime("fail", async () => "ok");
	await expect(failed).rejects.toThrow("boom");
	expect(await next).toBe("ok");
});
