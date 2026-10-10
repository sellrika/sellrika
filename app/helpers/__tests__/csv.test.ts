import { expect, test } from "bun:test";
import { parseCsv, toCsv, unguardCell } from "@helpers/csv";

test("csv: quoting, escapes, CRLF, BOM, blank lines, leading zeros round-trip", () => {
	expect(parseCsv('a,b\r\n"x, y","say ""hi""\nok",00123\n\nlast')).toEqual([
		["a", "b"],
		["x, y", 'say "hi"\nok', "00123"],
		["last"],
	]);
	expect(parseCsv("﻿name\nCola")).toEqual([["name"], ["Cola"]]);
	const rows = [
		["name", "note"],
		["Té, 500ml", 'a "b"\nc'],
		["0042", ""],
	];
	expect(parseCsv(toCsv(rows))).toEqual(rows);
	expect(toCsv([["a", "b"]])).toBe("a,b\r\n");
});

test("csv: text that looks like a formula gets a ' in front; numbers stay numbers", () => {
	const row = [
		"=HYPERLINK(1)",
		"+1+1",
		"-cmd",
		"@SUM(A1)",
		"\tx",
		"'=x",
		"-5",
		"12.50",
		"Tea",
	];
	const [out] = parseCsv(toCsv([row]));
	expect(out).toEqual([
		"'=HYPERLINK(1)",
		"'+1+1",
		"'-cmd",
		"'@SUM(A1)",
		"'\tx",
		"''=x",
		"-5",
		"12.50",
		"Tea",
	]);
	expect(out!.map(unguardCell)).toEqual(row); // reading it back gives the original
});
