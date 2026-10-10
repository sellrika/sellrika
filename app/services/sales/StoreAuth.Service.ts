import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { Shop } from "@models/Shop";
import type { Customer, CustomerAddress } from "@models/Customer";
import { CustomerAddressRepository } from "@repositories/CustomerAddress.Repository";
import { CustomerRepository } from "@repositories/Customer.Repository";
import { OrderRepository } from "@repositories/Order.Repository";
import {
	FirebaseApi,
	type FirebaseUser,
} from "@gateways/firebase/Firebase.Api";
import {
	ACCOUNT_ADDRESSES_MAX,
	ACCOUNT_ORDERS_PER_PAGE,
	FIREBASE_FIELDS,
	type CustomerLogin,
	type FirebaseConfig,
} from "@constants/Store.Constant";
import type {
	StoreAddressInput,
	StoreProfileInput,
} from "@validators/Store.Validator";

type Errors = Record<string, string>;
/**
 * What the storefront needs to offer sign-in.
 * The providers switched on, and the Firebase web config to open them with.
 */
export type StoreLogin = {
	providers: CustomerLogin[];
	firebase: FirebaseConfig;
};

/**
 * Customer accounts on the online store.
 * They sign in through the shop's Firebase project
 * (email + password, Google, Microsoft).
 * Then the customer sees their orders and keeps their name, phone and
 * delivery address on /account.
 * A Firebase user is tied to one `customers` row per shop
 * (`firebase_uid`).
 * An existing customer record with the same email is claimed on the
 * first sign-in, only when Firebase says the email is verified.
 * So nobody can read another buyer's history by signing up with their
 * address.
 */
@Service()
export class StoreAuthService {
	constructor(
		private customers: CustomerRepository,
		private orderRepo: OrderRepository,
		private addressRepo: CustomerAddressRepository,
		private firebase: FirebaseApi,
	) {}

	/**
	 * Lower case for the letters A to Z only.
	 * @param text The text.
	 * @returns The text with only its plain letters lowered.
	 */
	static asciiLower(text: string): string {
		return text.replace(/[A-Z]/g, function lower(c) {
			return c.toLowerCase();
		});
	}

	/**
	 * Whether (and how) customers may sign in to this store.
	 * @param shop The selling shop.
	 * @returns The providers and the public Firebase config.
	 *   Null while accounts are off or the Firebase config is incomplete.
	 */
	logins(shop: Shop): StoreLogin | null {
		const cfg = shop.firebase_config;
		if (
			!shop.customer_logins.length ||
			!cfg ||
			FIREBASE_FIELDS.some((f) => !cfg[f.name])
		)
			return null;
		return { providers: shop.customer_logins, firebase: cfg };
	}

	/**
	 * Sign a customer in.
	 * Verify the Firebase token, then find or create their customer
	 * record in this shop.
	 * @param shop The shop whose store they sign in to.
	 * @param token The Firebase ID token from the browser.
	 * @returns `{customer}`, or `{errors}` (accounts off, bad token,
	 *   unverified email).
	 *   `unverified` says the email is not verified yet,
	 *   so the page can offer to resend the link.
	 */
	async login(
		shop: Shop,
		token: string,
	): Promise<
		| { customer: Customer; errors?: never; unverified?: never }
		| { errors: Errors; unverified?: boolean; customer?: never }
	> {
		const login = this.logins(shop);
		if (!login)
			return {
				errors: { token: t("server.account_logins_off") },
			};
		let user: FirebaseUser | null;
		try {
			user = await this.firebase.lookup(login.firebase.api_key, token);
		} catch {
			return {
				errors: { token: t("server.account_verify_failed") },
			};
		}
		if (!user)
			return {
				errors: {
					token: t("server.account_token_stale"),
				},
			};
		if (!user.email)
			return {
				errors: {
					token: t("server.account_no_email"),
				},
			};
		// A letter that only looks like another one (the Kelvin sign "K")
		// becomes that other letter in lower case. Such an email would
		// claim the record of the plain address, so it is refused.
		if (user.email.toLowerCase() !== StoreAuthService.asciiLower(user.email))
			return {
				errors: {
					token: t("server.account_email_unsupported"),
				},
			};
		if (!user.email_verified)
			return {
				errors: {
					token: t("server.account_verify_email"),
				},
				unverified: true,
			};
		let customer = await this.customers.byFirebaseUid(shop.id, user.uid);
		if (!customer) {
			// First sign-in: the record earlier orders were attached to
			// (matched by the verified email), else a new one.
			const existing = await this.customers.byEmail(shop.id, user.email);
			if (existing) {
				await this.customers.linkFirebase(existing.id, shop.id, user.uid);
				customer = { ...existing, firebase_uid: user.uid };
			} else {
				customer = await this.customers.create(shop.id, {
					name: user.name || user.email,
					phone: null,
					email: user.email,
					note: "",
				});
				await this.customers.linkFirebase(customer.id, shop.id, user.uid);
				customer.firebase_uid = user.uid;
			}
		}
		return { customer };
	}

	/**
	 * Change a customer's name and phone (the phone stays unique per shop).
	 * @param customer The signed-in customer.
	 * @param d Validated name and phone.
	 * @returns `{errors}` when the phone belongs to someone else, `{}` when saved.
	 */
	async updateProfile(
		customer: Customer,
		d: StoreProfileInput,
	): Promise<{ errors?: Errors }> {
		const other = await this.customers.phoneOwner(
			customer.shop_id,
			d.phone,
			customer.id,
		);
		if (other)
			return {
				errors: { phone: t("server.account_phone_taken") },
			};
		await this.customers.updateProfile(customer.id, customer.shop_id, d);
		return {};
	}

	/**
	 * The delivery addresses kept on the account, oldest first.
	 * The first is the checkout's default.
	 * @param customer The signed-in customer.
	 * @returns The addresses.
	 */
	addresses(customer: Customer): Promise<CustomerAddress[]> {
		return this.addressRepo.list(customer.id, customer.shop_id);
	}

	/**
	 * Add a delivery address to the account.
	 * @param customer The signed-in customer.
	 * @param d Validated address.
	 * @returns `{errors}` when the list is full, `{}` when saved.
	 */
	async addAddress(
		customer: Customer,
		d: StoreAddressInput,
	): Promise<{ errors?: Errors }> {
		if ((await this.addresses(customer)).length >= ACCOUNT_ADDRESSES_MAX)
			return {
				errors: {
					address_1: t("server.account_address_limit", {
						max: ACCOUNT_ADDRESSES_MAX,
					}),
				},
			};
		await this.addressRepo.create(customer.id, customer.shop_id, d);
		return {};
	}

	/**
	 * Change one of the account's addresses.
	 * @param customer The signed-in customer.
	 * @param id The address.
	 * @param d Validated address.
	 * @returns The updated address, or null when it isn't theirs.
	 */
	updateAddress(customer: Customer, id: number, d: StoreAddressInput) {
		return this.addressRepo.update(id, customer.id, d);
	}

	/**
	 * Remove one of the account's addresses.
	 * @param customer The signed-in customer.
	 * @param id The address.
	 * @returns When it is removed.
	 */
	removeAddress(customer: Customer, id: number) {
		return this.addressRepo.delete(id, customer.id);
	}

	/**
	 * One page of the customer's orders, newest first.
	 * @param customer The signed-in customer.
	 * @param page 1-based page number.
	 * @returns A page of their orders.
	 */
	orders(customer: Customer, page: number) {
		return this.orderRepo.forCustomer(
			customer.id,
			customer.shop_id,
			page,
			ACCOUNT_ORDERS_PER_PAGE,
		);
	}

	/**
	 * One of the customer's orders by its public code.
	 * Never another customer's.
	 * @param customer The signed-in customer.
	 * @param reference The public order code (normalised).
	 * @returns The order with its lines, or null.
	 */
	async order(customer: Customer, reference: string) {
		const o = await this.orderRepo.byReference(reference, customer.shop_id);
		return o && o.customer_id === customer.id ? o : null;
	}
}
