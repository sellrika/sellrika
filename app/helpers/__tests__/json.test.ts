import { expect, test } from "bun:test";
import { parseJson, safeJson } from "@helpers/json";

test("parseJson: reads text, keeps a parsed value, falls back on an empty column", () => {
	expect(parseJson<number[]>("[1,2]", [])).toEqual([1, 2]); // SQLite hands back text
	expect(parseJson({ a: 1 }, {})).toEqual({ a: 1 }); // Postgres may hand it back parsed
	expect(parseJson(null, ["x"])).toEqual(["x"]);
	expect(parseJson(undefined, 0)).toBe(0);
	expect(parseJson("", "none")).toBe("none");
});

test("safeJson: no </script> can close the tag early", () => {
	const out = safeJson({ name: "</script><script>evil()</script>" });
	expect(out).not.toContain("<");
	expect(JSON.parse(out)).toEqual({ name: "</script><script>evil()</script>" });
	expect(safeJson(undefined)).toBe("null"); // JSON can not write it
});
