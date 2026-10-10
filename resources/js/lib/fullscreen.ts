import { ref } from "vue";

const KEY = "maximized";

/**
 * True while the app is maximized: no sidebar, and the browser full screen.
 * Kept for the tab, so a page load or a new page does not bring the sidebar back.
 */
export const maximized = ref(saved());

/**
 * Read the saved state.
 * @returns True when this tab was maximized. False where there is no storage.
 */
function saved() {
	try {
		return sessionStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

/**
 * Ask the browser for full screen.
 * Quiet where it can't (iPhone) or refuses (no click yet).
 */
function enter() {
	if (document.fullscreenElement) return;
	document.documentElement.requestFullscreen?.()?.catch(() => {});
}

/** The Full screen button: maximize, or bring the normal screen back. */
export function toggleMaximized() {
	maximized.value = !maximized.value;
	try {
		sessionStorage.setItem(KEY, maximized.value ? "1" : "0");
	} catch {
		// no storage: the state lives until the next page load
	}
	if (maximized.value) enter();
	else if (document.fullscreenElement) void document.exitFullscreen();
}

/**
 * Click and `afterprint` listener of the layout. The browser itself leaves
 * full screen on a print, a page load or Esc; this takes it back while maximized.
 * After a print it only works when the print dialog was closed within a few
 * seconds of the click (the browser's rule); else the next click does it.
 * @param e The click, or the end of a print.
 */
export function keepFullscreen(e: Event) {
	if (!maximized.value) return;
	// the button's own click is about to minimize
	if ((e.target as Element).closest?.("[data-fullscreen-toggle]")) return;
	enter();
}
