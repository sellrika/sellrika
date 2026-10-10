import { Service } from "@xcore/di";
import { Storage } from "@xcore/storage/Storage";
import { UploadRepository } from "@repositories/Upload.Repository";

/**
 * Cleaning up uploaded pictures.
 * A picture leaves storage once nothing uses it any more.
 */
@Service()
export class UploadCleaner {
	constructor(private uploads: UploadRepository) {}

	/**
	 * Delete the pictures nothing uses any more.
	 * Run it after the database change is saved.
	 * Never throws: a failure is logged and the save stays done.
	 * @param urls The pictures something just stopped using.
	 * @param tag Who is asking, for the log line (`products`).
	 */
	async dropUnused(urls: Iterable<string>, tag: string) {
		for (const url of urls)
			try {
				if (!(await this.uploads.inUse(url))) await Storage.delete(url);
			} catch (e) {
				console.warn(`[${tag}] could not clean up ${url}:`, e);
			}
	}
}
