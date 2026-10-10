import { expect, test } from "bun:test";
import { recordEntries } from "@/lib/search";
import type { SearchResults } from "@/types";

test("recordEntries: text from a record is escaped, search-js writes it as HTML", () => {
	const hit = {
		title: `<img src=x onerror=alert(1)>`,
		subtitle: `#1 · <i>Zed</i>`,
		href: "/customers/1",
	};
	const [row] = recordEntries(
		{ customers: [hit] } as unknown as SearchResults,
		"USD",
	);
	expect(row!.title).toBe("&#60;img src=x onerror=alert(1)&#62;");
	expect(row!.description).not.toContain("<");
	expect(row!.href).toBe("/customers/1");
});
