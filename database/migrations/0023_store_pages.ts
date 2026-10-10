import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Free-form online-store pages (WYSIWYG HTML), replacing the fixed store_terms/store_privacy
// columns: existing policy text moves in as pages with slugs "terms" / "privacy".
export async function up(db: SQL) {
	await db.unsafe(`create table store_pages (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    slug text not null,
    title text not null,
    body text not null default '',
    css text not null default '',
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_store_pages_shop_slug on store_pages (shop_id, slug)`,
	);
	// the old columns held plain text — escape it and turn blank lines into paragraphs
	const esc = (s: string) =>
		s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const html = (t: string) =>
		t
			.split(/\n{2,}/)
			.map((p) => `<p>${esc(p).replaceAll("\n", "<br>")}</p>`)
			.join("");
	for (const s of await db.unsafe(
		`select id, store_terms, store_privacy from shops`,
	)) {
		if (s.store_terms)
			await db`insert into store_pages (shop_id, slug, title, body) values (${s.id}, 'terms', 'Terms of Use', ${html(s.store_terms)})`;
		if (s.store_privacy)
			await db`insert into store_pages (shop_id, slug, title, body) values (${s.id}, 'privacy', 'Privacy Policy', ${html(s.store_privacy)})`;
	}
	await db.unsafe(`alter table shops drop column store_terms`);
	await db.unsafe(`alter table shops drop column store_privacy`);
}
