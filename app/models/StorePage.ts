/** One custom page of a shop's online store (About, Shipping, …). */
export type StorePage = {
	id: number;
	shop_id: number;
	/** Public URL: <store>/pages/<slug>, unique per shop. */
	slug: string;
	title: string;
	/**
	 * Sanitised HTML (app/helpers/html.ts).
	 * Built in the GrapesJS editor.
	 */
	body: string;
	/**
	 * The page's stylesheet, also from GrapesJS.
	 * Rendered as textContent, never parsed as HTML.
	 */
	css: string;
	created_at: string;
	updated_at: string;
};
