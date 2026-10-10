import { UPLOAD_DIR } from "@constants/Storage.Constant";

const env = process.env;

/** The name of a storage driver: one of the keys of `drivers`. */
export type StorageDriver = keyof typeof drivers;

/**
 * Where uploaded images go.
 * One flydrive service per driver. `STORAGE_DRIVER` picks one.
 * Only the chosen driver's settings need to be filled in.
 * See `drive` in `app/xcore/storage/Storage.ts`.
 */
const drivers = {
	/**
	 * Files on this machine. The default.
	 * `UPLOAD_DIR` is the root; files sit under its `uploads/` folder.
	 * Tests override `UPLOAD_DIR` so they never touch real uploads.
	 */
	local: { dir: UPLOAD_DIR },

	/**
	 * AWS S3, or an S3-compatible service
	 * (Cloudflare R2, MinIO, DigitalOcean Spaces).
	 * Set `S3_ENDPOINT` for the compatible ones.
	 */
	s3: {
		bucket: env.S3_BUCKET ?? "",
		region: env.S3_REGION ?? "auto",
		endpoint: env.S3_ENDPOINT || undefined,
		/**
		 * The access key pair.
		 * When `S3_ACCESS_KEY_ID` is empty the AWS SDK looks on its own:
		 * `AWS_*` env vars, then the machine's instance role.
		 */
		credentials: env.S3_ACCESS_KEY_ID
			? {
					accessKeyId: env.S3_ACCESS_KEY_ID,
					secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
				}
			: undefined,
	},

	/**
	 * Azure Blob Storage, through `flydrive-azure`.
	 * Either the connection string from the portal,
	 * or the account name plus its key.
	 */
	azure: {
		connectionString: env.AZURE_STORAGE_CONNECTION_STRING || undefined,
		name: env.AZURE_STORAGE_ACCOUNT || undefined,
		key: env.AZURE_STORAGE_KEY || undefined,
		container: env.AZURE_STORAGE_CONTAINER ?? "",
	},

	/**
	 * Google Cloud Storage.
	 * A service-account JSON file, else the machine's default credentials.
	 */
	gcs: {
		bucket: env.GCS_BUCKET ?? "",
		keyFilename: env.GCS_KEY_FILE || undefined,
	},
};

/** The chosen driver and every driver's settings. */
export const storage = {
	default: (env.STORAGE_DRIVER ?? "local") as StorageDriver,
	drivers,
};

if (!(storage.default in drivers)) {
	throw new Error(
		`STORAGE_DRIVER must be one of: ${Object.keys(drivers).join(", ")}`,
	);
}
