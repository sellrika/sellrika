import { Container } from "@xcore/di";
import { sql } from "@xcore/database/Database";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";

/**
 * Empty the platform's extension catalog.
 * All test files share one process, one database and one upload folder.
 * So an extension one file uploads shows up in the next file's lists.
 * Each uploaded one is deleted through the service,
 * so the catalog's cache forgets it too.
 * Then every global switch goes, built-in ones included.
 * A file calls this to start empty, and again to leave nothing behind.
 */
export async function emptyCatalog() {
	const extensions = Container.get(ExtensionService);
	for (const ext of await extensions.platformList())
		if (!ext.builtin) await extensions.remove(ext.key);
	await sql`delete from platform_extensions`;
}
