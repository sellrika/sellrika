import { rm } from "node:fs/promises"; // Playwright runs this under Node
import { portOf, SPECS, tmpOf } from "./tmp";

// Wipe every throwaway DB + uploads dir once the run is over (the config also clears each before boot).
export default () =>
	Promise.all(
		SPECS.map((s) => rm(tmpOf(portOf(s)), { recursive: true, force: true })),
	);
