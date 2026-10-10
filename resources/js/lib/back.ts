/**
 * The back buttons of the app go back in the browser's history, so a list
 * keeps its search, filters and page.
 * This file keeps count of where the person is, so one click always leaves
 * the page: a payment or a filter on the same page adds history entries,
 * and those are skipped.
 */
import { router } from "@inertiajs/vue3";

/** The path of the page on screen, "" before the first page. */
let path = "";
/** How long the browser's history was when that page was opened. */
let length = 0;
/** How many pages were opened in this tab since the app loaded. */
let pages = 0;

/**
 * Note a page visit: a new path is a new page.
 */
function onNavigate() {
	if (window.location.pathname === path) return;
	path = window.location.pathname;
	length = window.history.length;
	pages++;
}

/**
 * Start keeping count. Called once, when the app starts.
 */
export function trackBack() {
	router.on("navigate", onNavigate);
}

/**
 * Leave the page: back to the one before it.
 * Opened directly (a link, a reload), there is no page before it,
 * so the fallback page opens instead.
 * @param fallback The page to open when there is nothing to go back to.
 */
export function goBack(fallback: string) {
	if (pages <= 1) return router.visit(fallback);
	// entries added while on this page (a payment, a filter) are skipped too
	const added = Math.max(0, window.history.length - length);
	window.history.go(-(added + 1));
}
