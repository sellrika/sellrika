/// <reference lib="dom" />
import { onMounted, onUnmounted } from "vue";
import { router } from "@inertiajs/vue3";
import type { FormDataConvertible } from "@inertiajs/core";

/** Rows that fit the viewport: (height − everything above/below the table) / row height, clamped to 5..100. */
export const rowsThatFit = (reservedPx: number, rowPx = 57) =>
	Math.min(
		100,
		Math.max(5, Math.floor((window.innerHeight - reservedPx) / rowPx)),
	);

/**
 * Keep the server page size in step with the screen height.
 * Stores it in the `pp_<key>` cookie (read by app/xcore/http/Paginate.ts on the next request) and
 * re-fetches the list when the viewport can fit a different number of rows than the server sent.
 * The size travels in the cookie only — not `?per_page=` — so the URL never changes under the page
 * (an in-place `?per_page=` rewrite raced tests and every bookmark/share).
 */
export function useFitPage(
	key: string,
	url: string,
	reservedPx: number,
	current: () => number,
	params: () => Record<string, FormDataConvertible> = () => ({}),
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const sync = () => {
		const n = rowsThatFit(reservedPx);
		// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is async (the reload below must see the cookie) and missing in older Safari/Firefox
		document.cookie = `pp_${key}=${n}; path=/; max-age=31536000; samesite=lax`;
		if (n !== current())
			router.get(url, params(), {
				preserveState: true,
				preserveScroll: true,
				replace: true,
			});
	};
	const onResize = () => {
		clearTimeout(timer);
		timer = setTimeout(sync, 250);
	};
	onMounted(() => {
		sync();
		window.addEventListener("resize", onResize);
	});
	onUnmounted(() => {
		clearTimeout(timer);
		window.removeEventListener("resize", onResize);
	});
}
