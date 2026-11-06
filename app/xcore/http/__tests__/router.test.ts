import { expect, test } from "bun:test";
import { router } from "@xcore/http/Router";

test("router builds Bun.serve routes", async () => {
	const ok = () => new Response("ok");
	const calls: string[] = [];
	router
		.redirect("/", "/x")
		.group(
			(next) => (req) => {
				calls.push("mw");
				return next(req);
			},
			() => {
				router.resource("/x", {
					index: ok,
					store: ok,
					update: ok,
					destroy: ok,
				});
			},
		)
		.get("/y", [{ hi: ok }, "hi"]);
	expect(Object.keys(router.routes["/x"]!)).toEqual(["GET", "POST"]);
	expect(Object.keys(router.routes["/x/:id"]!)).toEqual([
		"PUT",
		"PATCH",
		"DELETE",
	]);
	expect(router.routes["/"]).toBeInstanceOf(Response);
	await (router.routes["/y"] as any).GET(new Request("http://x/y"));
	expect(calls).toEqual([]); // outside the group → the middleware never ran
	const res = await (router.routes["/x"] as any).GET(new Request("http://x/x"));
	expect(calls).toEqual(["mw"]);
	// every route is stamped with the security headers, wherever it was registered
	expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(res.headers.get("Content-Security-Policy")).toContain(
		"frame-ancestors 'none'",
	);
});

/**
 * A middleware that writes its name down when it runs.
 * @param calls Where the names go.
 * @param name The name to write.
 * @returns The middleware.
 */
function tag(calls: string[], name: string) {
	return function tagged(next: (req: any) => any) {
		return function run(req: any) {
			calls.push(name);
			return next(req);
		};
	};
}

/**
 * Call a registered route.
 * @param path The route's path.
 * @param method The HTTP method.
 * @returns The route's response.
 */
function call(path: string, method: string) {
	return (router.routes[path] as any)[method](new Request(`http://x${path}`));
}

test("group takes a list of middleware, the first one outermost", async () => {
	const calls: string[] = [];
	const ok = () => {
		calls.push("handler");
		return new Response("ok");
	};
	router.group([tag(calls, "a"), tag(calls, "b")], () => {
		router.get("/group-list", ok);
	});
	await call("/group-list", "GET");
	// [a, b] = a(b(handler))
	expect(calls).toEqual(["a", "b", "handler"]);

	// the same order as two nested groups
	const nested: string[] = [];
	router.group(tag(nested, "a"), () => {
		router.group(tag(nested, "b"), () => {
			router.get("/group-nested", () => new Response("ok"));
		});
	});
	await call("/group-nested", "GET");
	expect(nested).toEqual(["a", "b"]);

	// a route registered after the group is not wrapped
	calls.length = 0;
	router.get("/group-after", ok);
	await call("/group-after", "GET");
	expect(calls).toEqual(["handler"]);
});

test("a route takes its own middleware, inside the group's", async () => {
	const calls: string[] = [];
	const ok = () => new Response("ok");
	router.group(tag(calls, "group"), () => {
		router.post("/via", ok, tag(calls, "a"), tag(calls, "b"));
		router.get("/via", ok);
	});
	await call("/via", "POST");
	expect(calls).toEqual(["group", "a", "b"]);
	// only that one route got them
	calls.length = 0;
	await call("/via", "GET");
	expect(calls).toEqual(["group"]);
	// every method takes them
	for (const m of ["get", "put", "patch", "delete"] as const) {
		calls.length = 0;
		router[m](`/via-${m}`, ok, tag(calls, m));
		await call(`/via-${m}`, m.toUpperCase());
		expect(calls).toEqual([m]);
	}
});

test("any registers get, post, put, patch and delete, not options", async () => {
	const calls: string[] = [];
	router.any("/any", () => new Response("ok"), tag(calls, "via"));
	expect(Object.keys(router.routes["/any"]!)).toEqual([
		"GET",
		"POST",
		"PUT",
		"PATCH",
		"DELETE",
	]);
	const res = await call("/any", "DELETE");
	expect(await res.text()).toBe("ok");
	expect(calls).toEqual(["via"]);
});

test("a signed-in change from another host is refused, and text/plain is not read as JSON", async () => {
	const { HttpRequest } = await import("@xcore/http/Request");
	router.post("/origin-check", async function echo(req) {
		return Response.json(await HttpRequest.body(req));
	});
	/**
	 * POST a JSON text to the route.
	 * @param headers The request headers.
	 * @returns The route's response.
	 */
	function send(headers: Record<string, string>): Promise<Response> {
		return (router.routes["/origin-check"] as any).POST(
			new Request("http://pos.test/origin-check", {
				method: "POST",
				headers: { host: "pos.test", ...headers },
				body: `{"a":1}`,
			}),
		);
	}
	const json = { "content-type": "application/json" };
	const refused = await send({
		...json,
		cookie: "sid=abc",
		origin: "http://evil.shop.pos.test",
	});
	expect(refused.status).toBe(403);
	const own = await send({
		...json,
		cookie: "sid=abc",
		origin: "http://pos.test",
	});
	expect(await own.json()).toEqual({ a: 1 });
	const plain = await send({ "content-type": "text/plain" });
	expect(await plain.json()).toEqual({});
});

test("Hooks.beforeRoute answers first, with the security headers; null falls through to the route", async () => {
	const { Hooks } = await import("@xcore/hooks/Hooks");
	router.get("/hooked", () => new Response("route"));
	const get = (router.routes["/hooked"] as any).GET;
	try {
		Hooks.beforeRoute = async function hook(req) {
			return new URL(req.url).hostname === "addon.test"
				? new Response("hook")
				: null;
		};
		const hooked = await get(new Request("http://addon.test/hooked"));
		expect(await hooked.text()).toBe("hook");
		expect(hooked.headers.get("X-Content-Type-Options")).toBe("nosniff");
		const plain = await get(new Request("http://x/hooked"));
		expect(await plain.text()).toBe("route");
	} finally {
		Hooks.beforeRoute = null;
	}
});
