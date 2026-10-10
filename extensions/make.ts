/**
 * Scaffolds a new extension folder to fill in.
 * `bun run make:extension my-thing` writes
 * extensions/my-thing/{extension.json,index.ts} plus its dictionaries.
 * `bun run build:extension my-thing` then packs it into
 * extensions/my-thing/dist/<key>-<version>.zip, for
 * /extensions › Upload zip.
 */
const key = process.argv[2];
if (!key || !/^[a-z0-9][a-z0-9-]{1,49}$/.test(key))
	throw new Error(
		"usage: bun run make:extension <key>  (2–50 lower-case letters, digits, dashes)",
	);
const dir = new URL(`./${key}/`, import.meta.url).pathname;
if (await Bun.file(`${dir}extension.json`).exists())
	throw new Error(`${dir} already exists`);
const name = key.replace(/-+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
await Bun.write(
	`${dir}extension.json`,
	`${JSON.stringify(
		{
			key,
			/**
			 * A key of i18n/<locale>.ts.
			 * The texts live there, one file per language.
			 */
			name: "name",
			version: "1.0.0",
			description: "description",
			main: "index.ts",
			fields: [
				{
					name: "example",
					label: "field.example",
					required: false,
					secret: false,
					placeholder: "field.example_placeholder",
				},
			],
			pages: [],
			slots: [],
		},
		null,
		2,
	)}\n`,
);
/**
 * One dictionary per language.
 * Add i18n/<locale>.ts for a new one; there is nothing else to register.
 */
await Bun.write(
	`${dir}i18n/en.ts`,
	`/**
 * English. It is the fallback for every other language.
 * The manifest names these keys where it shows text.
 * Listeners and routes get \`t\`, browser scripts get \`api.t\`.
 */
export default {
	name: "${name}",
	description: "What ${name} does, in one line.",
	"field.example": "Example setting",
	"field.example_placeholder": "Delete this field if you need no settings",
	"log.order": "Order #{id} at {shop}",
};
`,
);
await Bun.write(
	`${dir}i18n/de.ts`,
	`/**
 * German texts for this extension.
 * A key missing here falls back to en.ts.
 */
export default {
	name: "${name}",
	description: "Was ${name} macht, in einem Satz.",
	"field.example": "Beispiel-Einstellung",
	"field.example_placeholder": "Dieses Feld löschen, wenn keine Einstellungen nötig sind",
	"log.order": "Bestellung #{id} bei {shop}",
};
`,
);
await Bun.write(
	`${dir}index.ts`,
	`/**
 * ${name}.
 * See the extension guide (developer.sellrika.com) for events, routes, pages and slots.
 * extensions/webhook and extensions/chat-alerts are working examples.
 */
import type { Listeners, Routes } from "../types";

/**
 * Staff routes.
 * Keys are relative to this extension's mount, \`/ext/${key}/…\`.
 * The mount comes from the manifest key.
 * So \`"GET /hello"\` answers at \`/ext/${key}/hello\`.
 * It never clashes with another extension.
 */
export const routes: Routes = {
  "GET /hello": ({ shop, user }) => ({ hello: user?.name, shop: shop.name }),
};

export default {
  /**
   * A sale rang up at the POS.
   * Or an online checkout turned into an order.
   */
  "order.created": async ({ shop, config, order, t }) => {
    console.log(\`[${key}]\`, t("log.order", { id: order.id, shop: shop.name }), config.example);
  },
} satisfies Listeners;
`,
);
console.log(
	`created extensions/${key}/ — build it with: bun run build:extension ${key}`,
);
