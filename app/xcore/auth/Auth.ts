import { Account } from "@xcore/auth/Account";
import type { BunRequest } from "bun";
import { app } from "@config/app";
import type { User } from "@models/User";
import { Container } from "@xcore/di";
import { SessionRepository } from "@repositories/Session.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import {
	CUSTOMER_COOKIE,
	SESSION_COOKIE,
	SESSION_TTL_DAYS,
} from "@constants/Auth.Constant";
import { CUSTOMER_SESSION_TTL_DAYS } from "@constants/Store.Constant";
import { DAY_SECONDS } from "@constants/Time.Constant";
import { CustomerRepository } from "@repositories/Customer.Repository";
import { CustomerSessionRepository } from "@repositories/CustomerSession.Repository";

/** What both session tables can do with a session id. */
type SessionStore = { delete(id: string): Promise<unknown> };

/**
 * Who is signed in: staff sessions and store customer sessions.
 * Every method is static: nothing here keeps state of its own.
 * The class has no decorator, so the repositories are taken
 * from the container by hand.
 */
export class Auth {
	static #sessions = Container.get(SessionRepository);
	static #users = Container.get(UserRepository);
	static #shops = Container.get(ShopRepository);
	static #customerSessions = Container.get(CustomerSessionRepository);
	static #customers = Container.get(CustomerRepository);

	/**
	 * Sign a staff user in: a fresh session on the first shop of their account.
	 * Whatever session this browser arrived with is dropped, never reused.
	 * That stops session fixation.
	 * @param req The current request (its cookie jar is written).
	 * @param user The user who signed in.
	 */
	static async login(req: BunRequest, user: Pick<User, "id" | "owner_id">) {
		await Auth.#dropSession(req, SESSION_COOKIE, Auth.#sessions);
		const shop = await Auth.#shops.first(Account.id(user));
		const session = await Auth.#sessions.create(
			user.id,
			shop?.id ?? null,
			SESSION_TTL_DAYS,
		);
		Auth.#setSessionCookie(req, SESSION_COOKIE, session.id, SESSION_TTL_DAYS);
	}

	/**
	 * Sign the staff user out of this browser.
	 * @param req The current request.
	 */
	static async logout(req: BunRequest) {
		await Auth.#dropSession(req, SESSION_COOKIE, Auth.#sessions);
		req.cookies.delete(SESSION_COOKIE, { path: "/" });
	}

	/**
	 * Find the user and the shop from the session cookie.
	 * The session's shop only counts while it belongs to the user's account.
	 * An account always keeps one shop, so no shop means its shops were deleted.
	 * @param req The current request.
	 * @returns The user, the session and the shop.
	 *   Null when nobody is signed in, or the account is switched off.
	 */
	static async current(req: BunRequest) {
		const sid = req.cookies.get(SESSION_COOKIE);
		const session = sid ? await Auth.#sessions.findValid(sid) : null;
		if (!session) return null;
		const user = await Auth.#users.find(session.user_id);
		if (!user?.active) return null;
		const account = Account.id(user);
		const shop =
			(session.shop_id &&
				(await Auth.#shops.findOwned(session.shop_id, account))) ||
			(await Auth.#shops.first(account));
		if (!shop) return null;
		return { user, session, shop };
	}

	/**
	 * Sign a customer in to one shop's store, with a fresh session.
	 * Store customers are the online store accounts (migration 0046).
	 * They have a second cookie, never mixed with the staff one.
	 * Whatever `csid` the browser arrived with is dropped.
	 * @param req The current request (its cookie jar is written).
	 * @param customerId The customer record they signed in as.
	 * @param shopId The shop whose store this is. The session only counts there.
	 */
	static async customerLogin(
		req: BunRequest,
		customerId: number,
		shopId: number,
	) {
		await Auth.#dropSession(req, CUSTOMER_COOKIE, Auth.#customerSessions);
		const session = await Auth.#customerSessions.create(
			customerId,
			shopId,
			CUSTOMER_SESSION_TTL_DAYS,
		);
		Auth.#setSessionCookie(
			req,
			CUSTOMER_COOKIE,
			session.id,
			CUSTOMER_SESSION_TTL_DAYS,
		);
	}

	/**
	 * Sign the customer out of this browser.
	 * @param req The current request.
	 */
	static async customerLogout(req: BunRequest) {
		await Auth.#dropSession(req, CUSTOMER_COOKIE, Auth.#customerSessions);
		req.cookies.delete(CUSTOMER_COOKIE, { path: "/" });
	}

	/**
	 * The customer signed in to this shop's store, from the `csid` cookie.
	 * @param req The current request.
	 * @param shopId The shop being served.
	 *   A session on another shop's store does not count here.
	 * @returns The customer, or null: no cookie, expired, another shop,
	 *   or the record was deleted.
	 */
	static async currentCustomer(req: BunRequest, shopId: number) {
		const sid = req.cookies.get(CUSTOMER_COOKIE);
		const session = sid ? await Auth.#customerSessions.findValid(sid) : null;
		if (!session || session.shop_id !== shopId) return null;
		return Auth.#customers.find(session.customer_id, shopId);
	}

	/**
	 * Delete the session a browser arrived with, if it has one.
	 * The cookie itself is left alone.
	 * @param req The current request.
	 * @param cookie The cookie that holds the session id.
	 * @param store The table the session lives in.
	 */
	static async #dropSession(
		req: BunRequest,
		cookie: string,
		store: SessionStore,
	) {
		const sid = req.cookies.get(cookie);
		if (sid) await store.delete(sid);
	}

	/**
	 * Write a session cookie.
	 * Scripts can not read it, and it is sent over https only in production.
	 * @param req The current request (its cookie jar is written).
	 * @param cookie The cookie name.
	 * @param id The session id.
	 * @param days How many days the cookie lives.
	 */
	static #setSessionCookie(
		req: BunRequest,
		cookie: string,
		id: string,
		days: number,
	) {
		req.cookies.set(cookie, id, {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			maxAge: days * DAY_SECONDS,
			secure: app.isProd,
		});
	}
}
