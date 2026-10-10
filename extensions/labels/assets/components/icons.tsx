/**
 * The few icons the Labels page shows (Lucide, ISC licence).
 * They draw in the text colour.
 * The JSX here is plain DOM.
 */

/**
 * The inner shapes of each icon, on a 24 × 24 grid.
 */
const PATHS = {
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	minus: '<path d="M5 12h14"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	left: '<path d="m15 18-6-6 6-6"/>',
	right: '<path d="m9 18 6-6-6-6"/>',
	alert:
		'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	printer:
		'<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
};
export type IconName = keyof typeof PATHS;

/**
 * Draw an icon.
 * @param props.name Which icon.
 * @param props.size Its width and height in pixels.
 * @param props.class Extra classes, like a colour.
 * @returns The icon in a span.
 */
export function Icon({
	name,
	size = 16,
	class: extra = "",
}: {
	name: IconName;
	size?: number;
	class?: string;
}) {
	const span = (
		<span class={`inline-flex shrink-0 ${extra}`} />
	) as HTMLElement;
	span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
	return span;
}
