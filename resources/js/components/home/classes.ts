/**
 * The classes the front page and the pricing page share.
 * Both are built from the Claude Design file "Sellrika Redesign v2".
 * Their colours are fixed: they look the same in light and dark mode.
 */

/** The page's width and side padding. */
export const WRAP = "mx-auto w-full max-w-[1200px] px-6";
/** The pricing page is a bit narrower. */
export const WRAP_NARROW = "mx-auto w-full max-w-[1080px] px-6";
/** A dark section with a line under it. */
export const SECTION = "border-b border-[#1f1c16] bg-[#0b0a08] text-[#fbf8f1]";
/** The small grey line over a headline. */
export const EYEBROW =
	"font-jetbrains text-[13px] leading-none font-medium text-[#a39a86]";
/** A section's headline. */
export const H2 =
	"font-bricolage text-[clamp(36px,4.4vw,54px)] leading-none font-extrabold tracking-[-0.04em] text-balance text-[#fbf8f1]";
/** The ring a control shows when the keyboard reaches it. */
export const FOCUS =
	"outline-none focus-visible:ring-3 focus-visible:ring-[#f5c13b]/50";
/** The round buttons. */
export const BTN = `inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full leading-none transition-colors ${FOCUS}`;
export const BTN_YELLOW = `${BTN} bg-[#f5c13b] text-[#16130d] hover:bg-[#ffd35c]`;
export const BTN_GHOST = `${BTN} border border-[#3a3426] text-[#fbf8f1] hover:bg-white/6`;
/** A dark card. */
export const CARD =
	"border border-[#26231c] bg-[#141210] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
/** The switch with two or three round buttons, and one button of it. */
export const TABS =
	"flex gap-1 rounded-full border border-[#3a3426] bg-[#16130d] p-[5px]";
export const TAB = `flex cursor-pointer items-center gap-2 rounded-full text-[15px] leading-none font-semibold ${FOCUS}`;
export const TAB_ON = "bg-[#f5c13b] text-[#16130d]";
export const TAB_OFF = "text-[#c9c1ae]";
