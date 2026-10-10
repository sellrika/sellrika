// the runtime's own files, served from this app (not a CDN); the version matches the one transformers.js pins
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

/**
 * The background-removal engine (bg0), in a worker so the page never freezes
 * while the model starts or runs. See `removeBackground.ts` for the page side.
 * Messages in: `init` (once, `cpu` = keep off the GPU), `prepare`, `run` (an ImageBitmap).
 * Messages out: `ready`, `progress`, `done` (a PNG blob), `error`.
 */

type Bg0 = typeof import("@/vendor/bg0");

/** The engine, once `init` came in. */
let engine: Promise<Bg0> | null = null;

/**
 * Load the engine: point the ONNX runtime at this app's files, then import bg0.
 * @param cpu true = hide WebGPU, so bg0 picks the CPU (after a GPU failure on this device).
 * @returns The bg0 module.
 */
async function load(cpu: boolean): Promise<Bg0> {
	if (cpu) Object.defineProperty(navigator, "gpu", { value: undefined });
	const { env } = await import("@huggingface/transformers");
	if (env.backends.onnx.wasm)
		env.backends.onnx.wasm.wasmPaths = {
			mjs: new URL(ortMjs, import.meta.url).href,
			wasm: new URL(ortWasm, import.meta.url).href,
		};
	return import("@/vendor/bg0");
}

/**
 * The photo as a PNG: bg0 reads PNG, JPEG and WebP only, and wants a blob.
 * @param photo The photo's pixels.
 * @returns The same pixels as a PNG.
 */
function toPng(photo: ImageBitmap): Promise<Blob> {
	const canvas = new OffscreenCanvas(photo.width, photo.height);
	canvas.getContext("2d")?.drawImage(photo, 0, 0);
	photo.close();
	return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Tell the page something failed.
 * @param error What went wrong.
 */
function fail(error: unknown) {
	self.postMessage({ type: "error", message: String(error) });
}

/**
 * Start the model without a photo, so the first click is quick.
 */
async function prepare() {
	const bg0 = await (engine as Promise<Bg0>);
	await bg0.prepareBackgroundRemoval();
	self.postMessage({ type: "ready" });
}

/**
 * Cut the product out of one photo, reporting progress on the way.
 * @param photo The photo's pixels.
 */
async function run(photo: ImageBitmap) {
	const bg0 = await (engine as Promise<Bg0>);
	const result = await bg0.removeBackground(await toPng(photo), {
		onProgress: function progress(p) {
			self.postMessage({
				type: "progress",
				stage: p.stage,
				progress: p.progress,
			});
		},
	});
	self.postMessage({ type: "done", blob: result.blob });
}

self.onmessage = function onMessage(e: MessageEvent) {
	const m = e.data;
	if (m.type === "init") engine = load(m.cpu);
	else if (m.type === "prepare") prepare().catch(fail);
	else if (m.type === "run") run(m.photo).catch(fail);
};
