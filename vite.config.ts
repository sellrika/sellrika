import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

/**
 * Every built-in store theme's own stylesheet and script.
 * A glob, so a new theme folder is built without touching this file.
 */
const themeFiles = [
	...new Bun.Glob("resources/views/themes/*/{style.css,script.js}").scanSync(
		".",
	),
	// the fonts a shop may pick for its theme: one small stylesheet each
	...new Bun.Glob("resources/css/store-fonts/*.css").scanSync("."),
].sort();

/**
 * The icons the checkout island uses (through the shared components too).
 * They stay small files of their own,
 * so a buyer never downloads the staff app's icons.
 * One missing here still works: the checkout then loads the big icon file.
 */
const STORE_ICONS = [
	"check",
	"chevrons-up-down",
	"circle-check",
	"circle-x",
	"clock",
	"loader-circle",
	"package",
	"package-check",
	"search",
	"shopping-bag",
	"x",
];

/**
 * Is this module an icon only the staff app uses?
 * Every icon used to be its own tiny file: 150 requests under 1 kB.
 * The staff app's icons now share one file.
 * @param id The module's path.
 * @returns true for a Lucide icon that is not one of `STORE_ICONS`.
 */
function isStaffIcon(id: string) {
	const name =
		/@lucide[\\/]vue[\\/]dist[\\/]esm[\\/]icons[\\/]([^\\/]+)\.mjs$/.exec(
			id,
		)?.[1];
	return !!name && !STORE_ICONS.includes(name);
}

/**
 * The client build: into public/build (with a manifest).
 * The staff app, `window.Store`, the checkout island and the store themes.
 */
const clientBuild = {
	manifest: true,
	outDir: process.env.BUILD_DIR ?? "public/build", // config/app.ts › buildDir reads the same variable
	emptyOutDir: true,
	rollupOptions: {
		input: [
			"resources/js/app.ts",
			"resources/js/store/index.ts",
			"resources/js/store/checkout.ts",
			...themeFiles,
		],
		output: {
			codeSplitting: {
				groups: [
					{
						name: "icons",
						test: isStaffIcon,
						// the icons only: Vue stays in its own shared file
						includeDependenciesRecursively: false,
					},
				],
			},
		},
	},
};

/**
 * The server build (`vite build --ssr`): the public pages as one file, build/ssr/ssr.js.
 * The Bun server loads it to render their HTML (app/xcore/view/Ssr.ts).
 * The pictures keep the URLs of the client build, so it writes none.
 */
const serverBuild = {
	ssr: true,
	outDir: "build/ssr", // config/app.ts › ssrBundle
	emptyOutDir: true,
	rollupOptions: {
		input: "resources/js/ssr.ts",
		output: { codeSplitting: false },
	},
};

export default defineConfig(function config({ isSsrBuild, mode }) {
	// read .env here: Vite does not put it into process.env by itself
	const appUrl =
		process.env.APP_URL || loadEnv(mode, process.cwd(), "").APP_URL;
	return {
		base: "/build/",
		plugins: [vue(), tailwindcss()],
		// Mirror of tsconfig.json "paths" — the browser code imports shared server code (validators,
		// constants) and must resolve the same aliases the Bun side does.
		resolve: {
			alias: Object.entries({
				"@": "./resources/js",
				"@cloud": "./cloud",
				"@config": "./config",
				"@constants": "./app/constants",
				"@controllers": "./app/controllers",
				"@database": "./database",
				"@emails": "./app/emails",
				"@extensions": "./extensions",
				"@gateways": "./app/gateways",
				"@helpers": "./app/helpers",
				"@jobs": "./app/jobs",
				"@i18n": "./i18n",
				"@mail": "./app/mail",
				"@models": "./app/models",
				"@repositories": "./app/repositories",
				"@resources": "./resources",
				"@routes": "./routes",
				"@services": "./app/services",
				"@validators": "./app/validators",
				"@xcore": "./app/xcore",
			}).map(([find, dir]) => ({
				find,
				replacement: fileURLToPath(new URL(dir, import.meta.url)),
			})),
		},
		publicDir: false, // `public/` only holds the build output itself — copying it into outDir would recurse
		build: isSsrBuild ? serverBuild : clientBuild,
		// the compiled server has no node_modules at runtime: the server build holds everything it imports
		ssr: { noExternal: true as const },
		// cors: true would answer every origin with Access-Control-Allow-Origin:* — name the dev app origin
		// instead, so a page on some other localhost port can't read the dev bundle. (The Bun server sends no
		// CORS headers at all: every browser call to the API is same-origin.)
		server: {
			origin: "http://localhost:5173",
			cors: {
				origin: [
					// the stores run on their own subdomain in dev (main-shop.localhost:3000)
					/^https?:\/\/([a-z0-9-]+\.)*localhost(:\d+)?$/,
					/^https?:\/\/127\.0\.0\.1(:\d+)?$/,
					// a tunnel address in APP_URL (ngrok) opens the dev app from outside
					...(appUrl ? [new URL(appUrl).origin] : []),
				],
			},
			strictPort: true,
		},
	};
});
