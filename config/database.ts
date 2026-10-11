const env = process.env;

/** The name of a connection: one of the keys of `connections`. */
export type Connection = keyof typeof connections;

/** The connection pool of a database server. */
const pool = {
	max: Number(env.DB_POOL_MAX ?? 10),
	idleTimeout: Number(env.DB_IDLE_TIMEOUT ?? 30),
	connectionTimeout: Number(env.DB_CONNECT_TIMEOUT ?? 10),
};

/**
 * Every database the app can talk to.
 * `DB_CONNECTION` picks one.
 */
const connections = {
	/**
	 * A SQLite file. The default.
	 * `DB_FILE` names it.
	 */
	sqlite: {
		url: `sqlite://${env.DB_FILE ?? "./data/pos.db"}`,
		options: {},
	},
	/** PostgreSQL. */
	postgres: {
		/**
		 * `DATABASE_URL` wins (hosting providers set it).
		 * Otherwise the address is built from its parts.
		 */
		url:
			env.DATABASE_URL ??
			`postgres://${env.DB_USERNAME ?? "postgres"}:${env.DB_PASSWORD ?? ""}@${env.DB_HOST ?? "localhost"}:${env.DB_PORT ?? 5432}/${env.DB_DATABASE ?? "pos"}`,
		options: {
			...pool,
			/**
			 * The app stores and compares every time in UTC.
			 * Without this, `current_timestamp` follows the server's time zone:
			 * a new row gets local time, and a link that lives one hour
			 * is expired at once on a server east of UTC.
			 */
			connection: { TimeZone: "UTC" },
		},
	},
	/** MySQL 8 or MariaDB. */
	mysql: {
		/** The same rule as Postgres: `DATABASE_URL` wins. */
		url:
			env.DATABASE_URL ??
			`mysql://${env.DB_USERNAME ?? "root"}:${env.DB_PASSWORD ?? ""}@${env.DB_HOST ?? "localhost"}:${env.DB_PORT ?? 3306}/${env.DB_DATABASE ?? "pos"}`,
		options: {
			...pool,
			/**
			 * MySQL 8 signs a user in over TLS, or with its public key.
			 * `DB_ALLOW_PUBLIC_KEY_RETRIEVAL=1` lets the app ask for that key
			 * on a connection without TLS. Only for a server on a network you trust.
			 */
			allowPublicKeyRetrieval: env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL === "1",
		},
	},
};

/** The chosen connection and every connection's settings. */
export const database = {
	default: (env.DB_CONNECTION ?? "sqlite") as Connection,
	connections,
};

if (!(database.default in connections)) {
	throw new Error(
		`DB_CONNECTION must be one of: ${Object.keys(connections).join(", ")}`,
	);
}
