import { z } from "zod";
import { email } from "@validators/Fields.Validator";
import {
	EXTENSION_APP_SETTINGS,
	EXTENSION_ASSETS_DIR,
	EXTENSION_FIELD_TYPES,
	EXTENSION_PAYMENT_MODES,
	EXTENSION_SLOTS,
} from "@constants/Extension.Constant";
import { PAYMENT_ICON_NAMES } from "@constants/PaymentMethod.Constant";
import { ROLES } from "@constants/User.Constant";

/**
 * A browser script of the extension.
 * A .js, .ts or .tsx file under `assets/`, no `..`.
 * .ts / .tsx are transpiled when served.
 */
const asset = z
	.string()
	.regex(
		new RegExp(
			`^${EXTENSION_ASSETS_DIR}/(?!.*\\.\\.)[\\w./-]+\\.(js|mjs|ts|tsx)$`,
		),
		`script must be a .js, .ts or .tsx file under ${EXTENSION_ASSETS_DIR}/`,
	);

/**
 * The extension's logo: an image under `assets/`.
 * It is shown on /extensions, in the sidebar and on its pages.
 */
const image = z
	.string()
	.regex(
		new RegExp(
			`^${EXTENSION_ASSETS_DIR}/(?!.*\\.\\.)[\\w./-]+\\.(png|jpg|jpeg|gif|webp|svg)$`,
		),
		`icon must be a .png, .jpg, .gif, .webp or .svg file under ${EXTENSION_ASSETS_DIR}/`,
	);

/**
 * The folder of a theme's Edge templates, inside the extension.
 * One `<page>.edge` per store page (STORE_THEME_PAGES) lives in it.
 */
const viewsDir = z
	.string()
	.regex(
		/^(?!.*\.\.)[\w-]+(\/[\w-]+)*$/,
		"theme.views must be a folder inside the extension",
	)
	.default("views");

/**
 * A theme's stylesheet: a .css file under `assets/`.
 * It is loaded by the storefront it dresses.
 */
const stylesheet = z
	.string()
	.regex(
		new RegExp(`^${EXTENSION_ASSETS_DIR}/(?!.*\\.\\.)[\\w./-]+\\.css$`),
		`css must be a .css file under ${EXTENSION_ASSETS_DIR}/`,
	);

/**
 * One setting the admin fills in.
 * What the admin types and what the extension gets:
 * text/url → string, number → number,
 * select → one option value,
 * multiselect → string[] of option values,
 * switch/checkbox → boolean.
 */
const fieldShape = {
	/**
	 * The setting's name: the key its value is stored under.
	 * Lower-case letters, digits and underscores, 50 at most.
	 */
	name: z
		.string()
		.regex(
			/^[a-z0-9_]{1,50}$/,
			"field name: lower-case letters, digits and underscores",
		),
	/** The words next to the box. Needed, at most 60 characters. */
	label: z.string().trim().min(1).max(60),
	/**
	 * The kind of box: `text`, `url`, `number`, `select`,
	 * `multiselect`, `switch`, `checkbox`, `color`, `image` or `list`.
	 * Left out = `text`.
	 */
	type: z.enum(EXTENSION_FIELD_TYPES).default("text"),
	/** Text/url only: stored encrypted, never echoed back. */
	secret: z.boolean().default(false),
	/** The extension only runs once every required field is filled. */
	required: z.boolean().default(false),
	/** Text only: a textarea. */
	multiline: z.boolean().default(false),
	/**
	 * Width on the settings form, out of 8 columns.
	 * Two `4`s share a row.
	 */
	grid: z.number().int().min(1).max(8).default(8),
	/** An example value inside the empty box. */
	placeholder: z.string().max(200).optional(),
	/**
	 * A short line under the box:
	 * where to find the value, what blank means.
	 */
	hint: z.string().max(200).optional(),
	/**
	 * Text only: a value must begin with this ("pk_").
	 * An early typo check.
	 */
	starts_with: z.string().min(1).max(100).optional(),
	/**
	 * The choices of a select / multiselect: 1 to 100.
	 * Needed for those two types, and only there.
	 */
	options: z
		.array(
			z.object({
				/** The value that is stored when this choice is picked. */
				value: z.string().min(1).max(100),
				/** The words the admin sees for this choice. */
				label: z.string().trim().min(1).max(100),
			}),
		)
		.min(1)
		.max(100)
		.optional(),
	/** Number only: the smallest value allowed. */
	min: z.number().optional(),
	/** Number only: the largest value allowed. */
	max: z.number().optional(),
	/** Number only: the size of one step. Over 0. */
	step: z.number().positive().optional(),
};

/** The parts of a field that the rules below look at. */
type FieldShape = {
	type: string;
	secret: boolean;
	options?: unknown;
	fields?: unknown;
};

/**
 * May this field be secret?
 * @param f The field.
 * @returns True when it is not secret, or is a text or url field.
 */
function secretAllowed(f: FieldShape) {
	return !f.secret || f.type === "text" || f.type === "url";
}

/**
 * Does the field have options exactly when it needs them?
 * @param f The field.
 * @returns True when select / multiselect have options and no other type has.
 */
function optionsMatch(f: FieldShape) {
	return (f.type === "select" || f.type === "multiselect") === !!f.options;
}

/** Only a text or url field may be secret. */
const secretRule = {
	check: secretAllowed,
	message: "secret is only for text and url fields",
};

/** Options go with select and multiselect, and only with them. */
const optionsRule = {
	check: optionsMatch,
	message: "options are required for select and multiselect, and only there",
};

/**
 * A row of a `list` field: any type but another list, and no secrets.
 * ponytail: rows move and go,
 * so a blank-keeps-it secret has no fixed row to keep.
 */
const subField = z
	.object(fieldShape)
	.refine(secretRule.check, { message: secretRule.message })
	.refine(optionsRule.check, { message: optionsRule.message })
	.refine((f) => f.type !== "list" && !f.secret, {
		message: "a list's fields can't be secret or another list",
	});

/**
 * A top-level field: the same, plus `list`.
 * `list` = a repeatable group of sub-fields (`fields`),
 * stored as an array of rows.
 */
const listField = z
	.object({
		...fieldShape,
		/**
		 * `list` only: the boxes of one row, 1 to 20.
		 * Needed for a list, and only there.
		 */
		fields: z.array(subField).min(1).max(20).optional(),
		/**
		 * `list` only: the words on the Add button.
		 * Absent = "Add".
		 */
		add_label: z.string().trim().min(1).max(40).optional(),
		/**
		 * The app reads this field's value as one of its own settings
		 * (`EXTENSION_APP_SETTINGS`).
		 */
		app: z.enum(EXTENSION_APP_SETTINGS).optional(),
	})
	.refine(secretRule.check, { message: secretRule.message })
	.refine(optionsRule.check, { message: optionsRule.message })
	.refine((f) => (f.type === "list") === !!f.fields, {
		message: "fields are required for list, and only there",
	});

/**
 * `extension.json`: what every extension must say about itself.
 * See the extension guide.
 * It is not a form: the catalog reads it from the extension's folder
 * (`Extension.Catalog.ts`, `Extension.Manifest.ts`).
 */
export const ExtensionManifest = z.object({
	/**
	 * The extension's id. Its pages and routes live under it.
	 * 2 to 50 lower-case letters, digits and dashes.
	 */
	key: z
		.string()
		.regex(
			/^[a-z0-9][a-z0-9-]{1,49}$/,
			"key: 2–50 lower-case letters, digits and dashes",
		),
	/** The extension's name. Needed, at most 60 characters. */
	name: z.string().trim().min(1, "name is required").max(60),
	/** The version text, at most 20 characters. Left out = `1.0.0`. */
	version: z.string().trim().min(1).max(20).default("1.0.0"),
	/** What it does, at most 300 characters. Left out = "". */
	description: z.string().trim().max(300).default(""),
	/** A link to its help page: a full URL. Optional. */
	help_url: z.url("help_url must be a full URL").optional(),
	/** The extension's logo: an image under `assets/`. Optional. */
	icon: image.optional(),
	/**
	 * The entry module: a .js / .mjs / .cjs / .ts file in the folder.
	 * Left out = `index.js`.
	 */
	main: z
		.string()
		.regex(
			/^(?!.*\.\.)[\w./-]+\.(js|mjs|cjs|ts)$/,
			"main must be a .js/.mjs/.cjs/.ts file inside the folder",
		)
		.default("index.js"),
	/** The settings the admin fills in, 20 at most. Left out = none. */
	fields: z.array(listField).max(20).default([]),
	/**
	 * Its own pages inside the app, 20 at most.
	 * A sidebar link + `/extensions/<key>/<path>`.
	 * The script mounts the UI. Left out = none.
	 */
	pages: z
		.array(
			z.object({
				/**
				 * The page's path after `/extensions/<key>/`.
				 * Lower-case letters, digits and dashes, 50 at most.
				 */
				path: z
					.string()
					.regex(
						/^[a-z0-9][a-z0-9-]{0,49}$/,
						"page path: lower-case letters, digits and dashes",
					),
				/** The page's title and its sidebar link. At most 60 characters. */
				title: z.string().trim().min(1).max(60),
				/** The browser script that mounts the page. */
				script: asset,
				/** Its own sidebar icon. Default the extension's. */
				icon: image.optional(),
				/** False = cashiers see it too. */
				admin: z.boolean().default(true),
				/**
				 * The sidebar section the link joins ("Catalog", "Sales", …).
				 * Its own section otherwise
				 * (a key of its dictionary is translated).
				 */
				group: z.string().trim().max(30).default("Extensions"),
				/**
				 * Where its own section goes:
				 * above this app section ("Sales"). Default the end.
				 */
				group_before: z.string().trim().max(30).optional(),
				/** A Full screen button in the title row. */
				fullscreen: z.boolean().default(false),
				/** False = no breadcrumb bar, like the Sell screen. */
				breadcrumb: z.boolean().default(true),
				/**
				 * The page is as tall as the screen (from md up).
				 * The title stays, the script scrolls its own lists.
				 */
				fill: z.boolean().default(false),
			}),
		)
		.max(20)
		.default([]),
	/**
	 * App settings it sets outright while it runs
	 * (`{ "orders.delivery": "hide" }`).
	 * A field's `app` wins.
	 */
	app: z
		.partialRecord(z.enum(EXTENSION_APP_SETTINGS), z.string().max(30))
		.default({}),
	/**
	 * App sidebar links it hides while it runs, by path (`["/customers"]`).
	 * The pages stay reachable.
	 */
	hide_nav: z
		.array(
			z
				.string()
				.regex(/^\/[a-z0-9/-]*$/, "hide_nav: a sidebar path like /customers"),
		)
		.max(20)
		.default([]),
	/**
	 * A payment method it adds to the shop while it is switched on
	 * (Catalog › Payments, every pay dialog).
	 * The shop may rename it.
	 * The picked method reaches the extension by its key
	 * (slot `pos.display`).
	 */
	payment_method: z
		.object({
			/**
			 * The method's name, at most 50 characters.
			 * A key of its dictionary is translated.
			 */
			name: z.string().trim().min(1).max(50),
			/** The method's icon: a lucide icon name. Left out = `Wallet`. */
			icon: z.enum(PAYMENT_ICON_NAMES).default("Wallet"),
			/** The button's colour as `#rrggbb`. null = no colour. */
			color: z
				.string()
				.regex(/^#[0-9a-fA-F]{6}$/)
				.nullable()
				.default(null),
		})
		.optional(),
	/**
	 * UI it adds to the app's own pages (product form, …).
	 * One script per slot.
	 */
	slots: z
		.array(
			z.object({
				/**
				 * The place the script mounts in: `product.form`,
				 * `product.side`, `order.show`, `pos.display` or `store.page`.
				 */
				name: z.enum(EXTENSION_SLOTS),
				/** The browser script that mounts there. */
				script: asset,
				/**
				 * `store.page` only.
				 * The store page stays hidden until the script has run
				 * (it decides what the visitor may see).
				 */
				wait: z.boolean().default(false),
			}),
		)
		.max(20)
		.default([]),
	/**
	 * A storefront theme.
	 * The shop picks it on /online-store › Template
	 * (the extension guide › Themes).
	 */
	theme: z
		.object({
			/** The theme's name in the template picker. At most 60 characters. */
			label: z.string().trim().min(1).max(60),
			/**
			 * A line under the name, at most 200 characters.
			 * Left out = "".
			 */
			description: z.string().trim().max(200).default(""),
			/**
			 * The Edge templates: `<views>/<page>.edge` for every store page,
			 * plus its own partials.
			 */
			views: viewsDir,
			/** The theme's stylesheet: a .css file under `assets/`. Optional. */
			css: stylesheet.optional(),
			/**
			 * Its own browser script (cart drawer, product sheet, sign-in),
			 * on every store page.
			 */
			script: asset.optional(),
			/** How many featured products the home page gets (0 = none). */
			featured: z.number().int().min(0).max(24).default(0),
			/**
			 * `light` / `dark` pin the page's colour scheme.
			 * A theme with a fixed palette must.
			 */
			scheme: z.enum(["light", "dark", "auto"]).default("auto"),
		})
		.optional(),
	/**
	 * A payment gateway.
	 * `fields` are the credentials.
	 * The module exports `payment` (hosted / tokenize).
	 * See the extension guide › Payment gateways.
	 */
	payment: z
		.object({
			/**
			 * `hosted` = the buyer pays on the provider's own page.
			 * `tokenize` = the provider's form opens over the checkout page.
			 * Left out = `hosted`.
			 */
			mode: z.enum(EXTENSION_PAYMENT_MODES).default("hosted"),
			/** Tokenize: the field the browser script may see. */
			public_field: z
				.string()
				.regex(/^[a-z0-9_]{1,50}$/)
				.optional(),
			/**
			 * Tokenize: the checkout script
			 * that opens the provider's form.
			 */
			script: asset.optional(),
		})
		.refine((p) => p.mode !== "tokenize" || (p.public_field && p.script), {
			message: "a tokenize payment needs public_field and script",
		})
		.optional(),
	/**
	 * Its own topic of the user guide.
	 * A Markdown file that starts with `# Title`
	 * (MCP tool `read_user_guide`).
	 */
	guide: z
		.string()
		.regex(
			/^(?!.*\.\.)[\w./-]+\.md$/,
			"guide must be a .md file inside the folder",
		)
		.optional(),
	/**
	 * Staff routes an AI assistant may call.
	 * One MCP tool each, named `<key>_<name>`.
	 */
	tools: z
		.array(
			z.object({
				/**
				 * The tool's name: the MCP tool is `<key>_<name>`.
				 * Lower-case letters, digits and underscores, 2 to 40.
				 */
				name: z
					.string()
					.regex(
						/^[a-z][a-z0-9_]{1,39}$/,
						"tool name: lower-case letters, digits and underscores",
					),
				/** One short line that says what the tool does. Needed. */
				summary: z.string().trim().min(1).max(100),
				/**
				 * More about the tool, at most 500 characters.
				 * Left out = "".
				 */
				description: z.string().trim().max(500).default(""),
				/**
				 * One key of the module's `routes` table:
				 * "POST /products/:id/kitchen".
				 */
				route: z
					.string()
					.regex(
						/^(GET|POST|PUT|PATCH|DELETE) \/[\w/:.-]*$/,
						'tool route: a key of `routes`, like "POST /items/:id"',
					),
				/** The least role whose key sees and calls the tool. */
				role: z.enum(ROLES).default("admin"),
				/**
				 * The arguments, each a JSON Schema:
				 * `{ "on": { "type": "boolean" } }`.
				 */
				input: z
					.record(
						z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
						z.record(z.string(), z.unknown()),
					)
					.default({}),
				/** The names of the arguments that must be given. Left out = none. */
				required: z.array(z.string()).max(50).default([]),
			}),
		)
		.max(50)
		.default([]),
});
/** A checked `ExtensionManifest`. */
export type ExtensionManifest = z.infer<typeof ExtensionManifest>;

/** One MCP tool of a manifest. */
export type ExtensionTool = ExtensionManifest["tools"][number];

/** One top-level setting field of a manifest. */
export type ExtensionField = ExtensionManifest["fields"][number];

/**
 * One saved setting value, by field type:
 * string (text / url / select), number,
 * boolean (switch / checkbox), string[] (multiselect).
 */
export const ConfigPrimitive = z.union([
	z.string().max(2000),
	z.number(),
	z.boolean(),
	z.array(z.string().max(100)).max(100),
]);
/** A checked `ConfigPrimitive`. */
export type ConfigPrimitive = z.infer<typeof ConfigPrimitive>;

/**
 * One saved setting value of any field.
 * For a list: rows of the simple values, keyed by the sub-field name.
 */
export const ConfigValue = z.union([
	ConfigPrimitive,
	z.array(z.record(z.string().max(50), ConfigPrimitive)).max(100),
]);
/** A checked `ConfigValue`. */
export type ConfigValue = z.infer<typeof ConfigValue>;

/**
 * PUT /extensions/:key: install / configure / switch one extension
 * of the active shop.
 * `config` holds the extension's fields
 * (blank secret = keep the stored one).
 * Leave it out to change only the switch.
 * Each value is checked against the field's type in ExtensionService.save.
 */
export const ExtensionInput = z.object({
	/**
	 * True = the extension is switched on for the shop.
	 * Left out = true.
	 */
	enabled: z.boolean().default(true),
	/**
	 * The values of the extension's fields, by field name.
	 * A blank secret keeps the stored one.
	 * Absent = change only the switch.
	 */
	config: z.record(z.string().max(50), ConfigValue).optional(),
});
/** A checked `ExtensionInput`. */
export type ExtensionInput = z.infer<typeof ExtensionInput>;

/**
 * The "Enabled for all shops" switch on Admin › Global Extensions.
 * PUT /admin/extensions/:key.
 */
export const GlobalExtensionInput = z.object({
	/** True = every shop may switch the extension on. */
	enabled: z.boolean(),
});

/**
 * Who may use an extension: the owners' emails, [] = every user.
 * PUT /admin/extensions/:key/users.
 */
export const GlobalExtensionUsersInput = z.object({
	/**
	 * The emails of the owners who may use it, 500 at most.
	 * [] = every user.
	 */
	users: z.array(email).max(500),
});
/** A checked `GlobalExtensionUsersInput`. */
export type GlobalExtensionUsersInput = z.infer<
	typeof GlobalExtensionUsersInput
>;
