import type { ExtensionDicts } from "@xcore/extensions/ExtensionI18n";
import type { User } from "@models/User";
import type { OrderFull } from "@models/Order";
import type { Customer, CustomerAddress } from "@models/Customer";
import type { PaymentMethod } from "@models/PaymentMethod";
import type {
	ConfigValue,
	ExtensionManifest,
} from "@validators/Extension.Validator";
import type {
	ExtensionAppSetting,
	ExtensionSlot,
} from "@constants/Extension.Constant";

/**
 * Field name → message.
 * The shape Inertia shows next to the form's inputs.
 */
export type Errors = Record<string, string>;

/**
 * One extension's settings as the admin saved them.
 * Field name → value, stored by the field's type.
 */
export type Config = Record<string, ConfigValue>;

/**
 * An extension of the platform catalog (built in or uploaded).
 * Its manifest has every text resolved to English.
 * That is the stable form: it is stored on orders and matched by tests.
 * `raw` is the manifest as written, with dictionary keys in place of texts.
 */
export type ExtensionInfo = ExtensionManifest & {
	dir: string;
	raw: ExtensionManifest;
	i18n: ExtensionDicts;
};

/**
 * One extension as it runs for a shop.
 * The code it was uploaded with, and its settings decrypted.
 */
export type RunningExtension = { ext: ExtensionInfo; config: Config };

/**
 * The shop's state of one extension's settings.
 * This is what the /extensions page reads. It never carries a secret value.
 */
export type ConfigState = {
	/**
	 * The values as saved, by field type. Secrets come as "".
	 */
	config: Config;
	/**
	 * Which secrets have a stored value, so the form can say "already set".
	 */
	secret_set: Record<string, boolean>;
	/**
	 * Why the extension does not run although it is installed.
	 * Today the only reason is stored secrets the current APP_KEY can't read.
	 */
	problem: string | null;
	/**
	 * Every required field is filled.
	 * An extension that is switched on only runs when it is ready.
	 */
	ready: boolean;
};

/**
 * What the /extensions page shows for one extension.
 * The definition of the extension, plus this shop's state of it.
 */
export type ExtensionRow = Omit<
	ExtensionInfo,
	"dir" | "main" | "help_url" | "icon" | "payment" | "raw" | "i18n"
> &
	ConfigState & {
		help_url: string | null;
		/**
		 * The payment block of a gateway extension (`{ mode }`), or null.
		 * The /online-store page lists these.
		 */
		payment: ExtensionManifest["payment"] | null;
		/**
		 * The logo's URL (`/ext/<key>/assets/…`), or null.
		 */
		icon: string | null;
		/**
		 * The script of its own settings form (slot `extension.config`),
		 * or null: the dialog then draws the manifest's fields.
		 */
		config_script: string | null;
		/**
		 * Its dictionary in the page's language, for that script (`api.t`).
		 */
		strings: Record<string, string>;
		installed: boolean;
		enabled: boolean;
	};

/**
 * What Admin › Global Extensions shows for one extension of the platform.
 */
export type PlatformExtensionRow = {
	key: string;
	name: string;
	version: string;
	description: string;
	/**
	 * The logo's URL (`/ext/<key>/assets/…`), or null.
	 */
	icon: string | null;
	/**
	 * Ships with the app (the repo's `extensions/`): it can't be deleted.
	 */
	builtin: boolean;
	/**
	 * The "Enabled for all shops" switch.
	 */
	enabled: boolean;
	/**
	 * The emails of the users it is for; [] = every user.
	 */
	users: string[];
};

/**
 * The running extensions' UI, shared with every page of the app.
 * The sidebar links, and the script to mount in each slot.
 */
export type ExtensionUi = {
	key: string;
	name: string;
	version: string;
	icon: string | null;
	/** `icon` = the page's own icon, else the extension's logo (null = none). */
	pages: {
		path: string;
		title: string;
		href: string;
		group: string;
		/**
		 * The app section its own section sits above (`group_before`).
		 * Null = at the end.
		 */
		before: string | null;
		icon: string | null;
	}[];
	slots: Partial<Record<ExtensionSlot, string>>;
	/**
	 * The extension's dictionary in the page's language.
	 * Its browser scripts read it as `api.t`.
	 */
	strings: Record<string, string>;
	/**
	 * The app settings it sets (manifest `app` and `fields[].app`).
	 * By name: `{ "pos.primary": "pay_later" }`.
	 */
	app: Partial<Record<ExtensionAppSetting, unknown>>;
	/** The app's sidebar links it hides, by path: `["/customers"]`. */
	hide_nav: string[];
	/**
	 * True when its payment method must be approved by the extension
	 * before a pay dialog can be confirmed (manifest
	 * `payment_method.confirm`).
	 */
	payment_confirm: boolean;
};

/**
 * One extension script on the online store (slot `store.page`).
 * This is the shape the data island carries.
 * `base` is the extension's public mount.
 * `strings` is its dictionary in the page's language.
 */
export type StoreScript = {
	key: string;
	script: string;
	base: string;
	strings: Record<string, string>;
	/** True = the page stays hidden until this script has run (slot `wait`). */
	wait: boolean;
};

/**
 * The customers handle every extension route gets as `customers`.
 * Mirror of `RouteContext.customers` in `extensions/types.ts`.
 * ExtensionController builds it: CustomerService injects the extension
 * service, so the service can't inject CustomerService back.
 */
export type ExtensionCustomers = {
	create: (input: unknown) => Promise<Customer>;
	update: (id: number, input: unknown) => Promise<Customer>;
	get: (id: number) => Promise<Customer | null>;
	addresses: (id: number) => Promise<CustomerAddress[]>;
	search: (q: string) => Promise<Customer[]>;
};

/**
 * The functions an extension route gets that are not API routes, by area.
 * `ExtensionService.handle` joins them with the API's own functions
 * of the same area.
 * ExtensionController builds them: OrderService and CustomerService inject the
 * extension service, so the service can't inject them back.
 */
export type ExtensionOwnHandles = {
	products: { idBySku: (sku: string) => Promise<number | null> };
	orders: {
		openFor: (customerId: number) => Promise<OrderFull | null>;
		/**
		 * What a pay dialog offers, like the Sell screen's.
		 * The payment methods switched on and the active sales staff.
		 */
		payOptions: () => Promise<{
			methods: PaymentMethod[];
			sales_staff: { id: number; name: string }[];
		}>;
		/** Give an open order to another customer (staff routes only). */
		move?: (orderId: number, customerId: number) => Promise<OrderFull>;
		/** Join the open order `fromId` into `intoId` (staff routes only). */
		join?: (fromId: number, intoId: number) => Promise<OrderFull>;
	};
	customers: ExtensionCustomers;
};

/**
 * What `ExtensionService.handle` is told about the caller of a route.
 * `user` = the signed-in staff member (staff routes).
 * `actor` = who the API functions run as when nobody is signed in (public routes).
 * `handles` = the functions with no API route.
 * `customer` = the store's signed-in customer, on public routes.
 */
export type ExtensionRouteExtra = {
	user?: User;
	actor?: () => Promise<User>;
	handles?: Partial<ExtensionOwnHandles>;
	/**
	 * The customer signed in to the shop's online store (public routes).
	 * Null = a guest.
	 */
	customer?: Pick<Customer, "id" | "name" | "email"> | null;
};
