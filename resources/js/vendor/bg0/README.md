# bg0 browser engine (vendored)

Local background removal in the browser: BiRefNet-lite (512px, MIT) through
transformers.js, on WebGPU when the GPU can, else on the CPU (WASM).

- Source: https://github.com/opencoredev/bg0, `packages/browser/src`
- Commit: `4330f7ef881aa97d8fe6368b4352260ff08d0f61` (2026-09-27)
- Licence: Apache-2.0 (`LICENSE`). Model weights: MIT,
  `studioludens/birefnet-lite-512` (downloaded by the browser, not bundled).

Why vendored: the npm release (`@bg0/browser@0.1.1`) still depends on
transformers.js 3.8.1; the 512px fixes only exist in the repository.

## Changes from upstream (marked `pos:` in the code)

- `index.ts`: the iOS path (its own worker and a model on a temporary host) is
  left out; `useIosModel()` returns false.
- `cache.ts`, `image.ts`, `index.ts`: `// @ts-nocheck` on line 1 — this app's
  tsconfig is stricter than upstream's.
- `image.ts`, `index.ts`: canvases come from `createCanvas()` (in `image.ts`),
  which uses OffscreenCanvas when there is no `document` — the app runs bg0 in
  a Web Worker.
- `models.ts`: only the lite model is offered (no 473 MB full model).
- Not copied: `ios.ts`, `ios-pixels.ts`, the HEIC decoder (LGPL) and the tests.
  The HEIC branch in `image.ts` is never reached: the app always passes a PNG.

The ONNX runtime files are served by this app, not a CDN: see
`resources/js/lib/removeBackground.ts`.
