const env = process.env;

/** The name of a connection: one of the keys of `connections`. */
export type Connection = keyof typeof connections;

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
			max: Number(env.DB_POOL_MAX ?? 10),
			idleTimeout: Number(env.DB_IDLE_TIMEOUT ?? 30),
			connectionTimeout: Number(env.DB_CONNECT_TIMEOUT ?? 10),
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
