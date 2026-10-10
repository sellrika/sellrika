// Check a new dictionary against English: every `{placeholder}` and HTML tag must match, and
// list the texts with no letters of the new language (brand names are fine, a missed line is not).
// Run from the repo root: `bun .claude/skills/new-language/check.ts <code> [script regex]`
// e.g. `bun .claude/skills/new-language/check.ts th "[\u0E00-\u0E7F]"`.
import { en } from "../../../i18n/en";

const [code, script] = process.argv.slice(2);
if (!code) throw new Error("usage: check.ts <code> [script regex]");
const mod = await import(`../../../i18n/${code}.ts`);
const dict = mod[code] as Record<string, string>;
const letters = script ? new RegExp(script) : null;

/**
 * Keys whose caller passes more params than English uses, so a language may pick another one.
 * `reports.hour_am/pm` get `{h12}` and `{h24}`: a 24-hour-clock language writes `{h24}:00`.
 */
const FREE_PLACEHOLDERS = new Set(["reports.hour_am", "reports.hour_pm"]);

/**
 * The sorted names of a text's `{placeholders}`.
 * @param s The text.
 * @returns The names, comma joined.
 */
function placeholders(s: string) {
	return [...s.matchAll(/\{(\w+)\}/g)]
		.map((m) => m[1])
		.sort()
		.join(",");
}

/**
 * The sorted HTML tag names of a text.
 * @param s The text.
 * @returns The names, comma joined.
 */
function tags(s: string) {
	return [...s.matchAll(/<\/?(\w+)/g)]
		.map((m) => m[1])
		.sort()
		.join(",");
}

let bad = 0;
const untranslated: string[] = [];
for (const [key, text] of Object.entries(en)) {
	const got = dict[key];
	if (got === undefined) {
		bad++;
		console.log("MISSING", key);
		continue;
	}
	const placeholdersDiffer =
		!FREE_PLACEHOLDERS.has(key) && placeholders(text) !== placeholders(got);
	if (placeholdersDiffer || tags(text) !== tags(got)) {
		bad++;
		console.log(
			"MISMATCH",
			key,
			JSON.stringify(text),
			"→",
			JSON.stringify(got),
		);
	}
	if (got === text || (letters && !letters.test(got)))
		untranslated.push(`${key}: ${got}`);
}
console.log(`${bad} problem(s) in ${Object.keys(en).length} keys`);
console.log(`${untranslated.length} text(s) look untranslated:`);
console.log(untranslated.join("\n"));
if (bad) process.exit(1);
