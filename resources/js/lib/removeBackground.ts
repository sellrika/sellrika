import workerUrl from "./removeBackground.worker.ts?worker&url";

/**
 * Remove a photo's background in the browser: no server, no cost per photo.
 * The engine is bg0 (Apache-2.0, `vendor/bg0`), running the BiRefNet-lite 512px model (MIT)
 * through transformers.js: on WebGPU when the GPU can, else on the CPU.
 * It runs in a Web Worker (`removeBackground.worker.ts`): starting the model takes seconds
 * of heavy work, and on the page itself that froze everything.
 * The browser keeps the model (about 98 MB) in its Cache Storage, so it is downloaded once.
 */

/** Where a removal is: getting the model ready, or cutting the photo out. */
export type RemovalStep = { loading: boolean; percent: number };

/**
 * localStorage key: set once WebGPU failed on this device, so later workers use the CPU.
 * (bg0 remembers this itself, but a worker has no localStorage.)
 */
const CPU_KEY = "remove-bg:cpu";

/** The worker with the engine; null = not started, or closed after a failure. */
let worker: Worker | null = null;
/** Whether the current worker was told to keep off the GPU. */
let onCpu = false;
/** The photo being cut out right now (one at a time: the button is disabled meanwhile). */
let pending: {
	resolve: (blob: Blob) => void;
	reject: (error: Error) => void;
	onStep: (step: RemovalStep) => void;
} | null = null;

/**
 * Whether this device already failed on WebGPU. Private windows may block storage.
 * @returns true = use the CPU.
 */
function cpuOnly(): boolean {
	try {
		return localStorage.getItem(CPU_KEY) === "1";
	} catch {
		return false;
	}
}

/**
 * Remember that this device must use the CPU.
 */
function rememberCpu() {
	try {
		localStorage.setItem(CPU_KEY, "1");
	} catch {
		// a private window: the fallback is simply found again next time
	}
}

/**
 * Answer the worker's messages.
 * @param e One message: ready, progress, done or error.
 */
function onMessage(e: MessageEvent) {
	const m = e.data;
	if (m.type === "progress")
		pending?.onStep({
			loading: m.stage === "preparing" || m.stage === "downloading",
			percent: Math.round(m.progress * 100),
		});
	else if (m.type === "done") {
		pending?.resolve(m.blob);
		pending = null;
	} else if (m.type === "error") {
		console.error("Remove background:", m.message);
		// after one failed run transformers.js fails every later run in that worker: start clean next time
		stop();
		pending?.reject(new Error(m.message));
		pending = null;
	}
}

/**
 * Close the worker; the next call starts a new one.
 */
function stop() {
	worker?.terminate();
	worker = null;
}

/**
 * Start the worker, unless it is already running.
 * In dev the script lives on Vite's port, and a worker must come from the page's own origin,
 * so there it is started from a small blob that imports it.
 * @returns The worker.
 */
function start(): Worker {
	if (worker) return worker;
	const script = new URL(workerUrl, import.meta.url);
	const boot =
		script.origin === location.origin
			? script
			: URL.createObjectURL(
					new Blob([`import ${JSON.stringify(script.href)};`], {
						type: "text/javascript",
					}),
				);
	worker = new Worker(boot, { type: "module" });
	worker.onmessage = onMessage;
	onCpu = cpuOnly();
	worker.postMessage({ type: "init", cpu: onCpu });
	return worker;
}

/**
 * Start the model in the background once the page is idle,
 * so "Remove background" is ready by the time someone clicks it.
 * Automated browsers (the e2e tests) skip it, so a test run never downloads the model unasked.
 */
export function preloadBackgroundModel() {
	if (navigator.webdriver) return;
	/**
	 * Start the worker and let it load the model.
	 */
	function begin() {
		start().postMessage({ type: "prepare" });
	}
	if ("requestIdleCallback" in window) requestIdleCallback(begin);
	else setTimeout(begin, 1000);
}

/**
 * Send one photo to the worker.
 * @param photo The loaded photo.
 * @param onStep Called as the work moves on.
 * @returns The cut-out PNG.
 */
async function ask(
	photo: HTMLImageElement,
	onStep: (step: RemovalStep) => void,
): Promise<Blob> {
	const pixels = await createImageBitmap(photo);
	return new Promise(function asked(resolve, reject) {
		pending = { resolve, reject, onStep };
		start().postMessage({ type: "run", photo: pixels }, [pixels]);
	});
}

/**
 * Cut the product out of its photo.
 * Some GPUs can't run the model: then a new worker runs it on the CPU,
 * and this device uses the CPU from now on. The model file is the same, so nothing is downloaded again.
 * @param photo The loaded photo.
 * @param onStep Called as the work moves on: the model's download / start-up, then the cut-out.
 * @returns A PNG of the same size with a transparent background.
 */
export async function removeBackground(
	photo: HTMLImageElement,
	onStep: (step: RemovalStep) => void,
): Promise<Blob> {
	try {
		return await ask(photo, onStep);
	} catch (error) {
		if (onCpu) throw error;
		rememberCpu();
		stop();
		return ask(photo, onStep);
	}
}
