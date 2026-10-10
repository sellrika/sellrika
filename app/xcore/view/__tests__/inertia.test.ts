import { expect, test } from "bun:test";
import { VITE_CSS_ENTRY, VITE_ENTRY } from "@constants/Inertia.Constant";
import { inertia } from "@xcore/view/Inertia";
import { Vite } from "@xcore/view/Vite";

/**
 * An Inertia visit of the page "Keys/Index", as the browser sends it.
 * @param headers More headers, e.g. the ones of a partial reload.
 * @returns The request.
 */
async function visit(headers: Record<string, string> = {}) {
	const { version } = await Vite.tags([VITE_CSS_ENTRY, VITE_ENTRY]);
	return new Request("http://pos.test/keys", {
		headers: { "X-Inertia": "true", "X-Inertia-Version": version, ...headers },
	});
}

test("inertia: a partial reload sends only the named props (and errors), and calls only their functions", async () => {
	const calls: string[] = [];
	/**
	 * The page's props: one plain value and two functions.
	 * @returns The props.
	 */
	function props() {
		return {
			plain: 1,
			keys: function keys() {
				calls.push("keys");
				return Promise.resolve(["a"]);
			},
			slow: function slow() {
				calls.push("slow");
				return "s";
			},
		};
	}

	// a normal visit: everything, functions called
	const full = await (
		await inertia(await visit(), "Keys/Index", props())
	).json();
	expect(full.props).toMatchObject({
		plain: 1,
		keys: ["a"],
		slow: "s",
		errors: {},
	});
	expect(full.props.shops).toEqual([]); // the shared props ride along
	expect(calls.sort()).toEqual(["keys", "slow"]);

	// `router.reload({ only: ["keys"] })`
	calls.length = 0;
	const only = await visit({
		"X-Inertia-Partial-Component": "Keys/Index",
		"X-Inertia-Partial-Data": "keys",
	});
	const part = await (await inertia(only, "Keys/Index", props())).json();
	expect(part.props).toEqual({ errors: {}, keys: ["a"] });
	expect(calls).toEqual(["keys"]);

	// `except`: everything but the named prop
	const except = await visit({
		"X-Inertia-Partial-Component": "Keys/Index",
		"X-Inertia-Partial-Except": "slow",
	});
	const rest = await (await inertia(except, "Keys/Index", props())).json();
	expect(rest.props.keys).toEqual(["a"]);
	expect("slow" in rest.props).toBe(false);

	// the headers of another page do not count: every prop is sent
	const other = await visit({
		"X-Inertia-Partial-Component": "Other/Page",
		"X-Inertia-Partial-Data": "keys",
	});
	const whole = await (await inertia(other, "Keys/Index", props())).json();
	expect(whole.props.slow).toBe("s");
});
