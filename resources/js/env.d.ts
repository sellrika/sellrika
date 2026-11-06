/// <reference types="vite/client" />
/** The app's version from package.json, set by vite.config.ts. */
declare const __APP_VERSION__: string;
declare module "*.vue" {
	import type { DefineComponent } from "vue";
	const component: DefineComponent<object, object, unknown>;
	export default component;
}
