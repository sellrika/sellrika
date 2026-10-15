import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { CategoryRepository } from "@repositories/Category.Repository";
import { ProductService } from "./Product.Service";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { ProductInput } from "@validators/Product.Validator";
import { validate } from "@validators/validate";
import { parseCsv, toCsv, unguardCell } from "@helpers/csv";
import { slugify } from "@helpers/slug";
import { CSV_COLUMNS, CSV_MAX_ROWS } from "@constants/Product.Constant";

/**
 * One row of the export, by column name.
 * A column left out is written empty.
 */
type CsvRow = Partial<Record<(typeof CSV_COLUMNS)[number], string>>;

/**
 * One product to import.
 * A standalone row, or every row that shares a `variant_group`.
 * `n` = the spreadsheet line number of its first row.
 */
type Unit = { n: number; rows: { n: number; r: string[] }[] };

/**
 * The numbers and codes of one row, read and checked.
 */
type Line = {
	price: number;
	cost: number | null;
	stock: number;
	sku: string | null;
	barcode: string | null;
	vname: string;
};

/**
 * What `import` answers.
 */
type Imported = { created: number; errors: string[] };

/**
 * Why the whole file is refused.
 * Nothing is imported. The message is ready to show.
 */
class CsvFileError extends Error {}

/**
 * Why one row, or one variant group, is skipped.
 * The other rows still import. The message is ready to show.
 */
class CsvRowError extends Error {}

/**
 * One import run: the file, read and checked, and what the rows need.
 */
type ImportJob = {
	shopId: number;
	userId: number;
	sheet: CsvSheet;
	units: Unit[];
	/** The shop's categories by lower-case name. New ones are added. */
	cats: Map<string, number>;
	/** How many more products the plan allows. */
	room: number;
};

/**
 * An uploaded sheet's header row.
 * It reads a cell of a row by its column name.
 */
class CsvSheet {
	/**
	 * @param header The column names, trimmed and in lower case.
	 */
	constructor(private header: string[]) {}

	/**
	 * Is this column in the file?
	 * @param name The column name.
	 * @returns True when the header has it.
	 */
	has(name: string): boolean {
		return this.header.includes(name);
	}

	/**
	 * One cell of a row.
	 * @param r The row.
	 * @param name The column name.
	 * @returns The cell's text, trimmed. "" when the column is not there.
	 */
	get(r: string[], name: string): string {
		const i = this.header.indexOf(name);
		return i < 0 ? "" : unguardCell(r[i] ?? "").trim();
	}

	/**
	 * Is this row priced in another currency than the shop's?
	 * @param r The row.
	 * @param shopCurrency The shop's currency code.
	 * @returns True when the row names another currency.
	 */
	isForeign(r: string[], shopCurrency: string): boolean {
		const currency = this.get(r, "currency");
		return !!currency && currency.toUpperCase() !== shopCurrency.toUpperCase();
	}
}

/**
 * Import / export of the catalogue.
 * The format is Universal POS Product CSV v1.
 */
@Service()
export class ProductCsvService {
	constructor(
		private products: ProductService,
		private categories: CategoryRepository,
		private limits: PlanLimitService,
	) {}

	/**
	 * Dump the whole catalogue.
	 * Packages are skipped.
	 * A package is a recipe, not a sellable unit.
	 * The format has no place for it.
	 * @param shopId Owning shop.
	 * @param currency The shop's currency code, written into every row.
	 * @returns The CSV text, header row first.
	 */
	async export(shopId: number, currency: string): Promise<string> {
		const out: string[][] = [[...CSV_COLUMNS]];
		for (const p of await this.products.list(shopId)) {
			// a package is a recipe: the format has no place for it
			if (p.kind === "bundle") continue;
			const shared = {
				name: p.name,
				currency,
				category: p.categories[0]?.name ?? "",
				unit: p.unit ?? "",
				track_stock: p.track_stock ? "true" : "false",
				low_stock_threshold: p.track_stock ? String(p.low_stock_at) : "",
				description: p.description,
				active: "true",
			};
			if (!p.variants.length) {
				out.push(
					this.#csvRow({
						...shared,
						sku: p.sku ?? `P${p.id}`,
						price: this.#dec(p.price),
						cost: this.#dec(p.purchase_price),
						barcode: p.barcode ?? "",
						stock_quantity: p.track_stock ? String(p.stock) : "",
					}),
				);
			} else {
				const group = `${slugify(p.name) || "p"}-${p.id}`;
				for (const v of p.variants) {
					out.push(
						this.#csvRow({
							...shared,
							sku: v.sku ?? `P${p.id}-${v.id}`,
							price: this.#dec(v.price),
							cost: this.#dec(v.purchase_price ?? p.purchase_price),
							barcode: v.barcode ?? "",
							stock_quantity: p.track_stock ? String(v.stock) : "",
							variant_group: group,
							variant_name: v.name,
						}),
					);
				}
			}
		}
		return toCsv(out);
	}

	/**
	 * Load products from CSV.
	 * Creates new products only (no upsert).
	 * Every bad row or group is skipped and reported, the rest import.
	 * Rows sharing a `variant_group` become one product with variants.
	 * Unknown categories are created on the fly.
	 * @param shopId Owning shop.
	 * @param shopCurrency The shop's currency.
	 * A file in another currency is refused as a whole,
	 * since prices are taken as written.
	 * @param text The uploaded file's contents.
	 * @param userId Credited in the stock ledger for imported stock counts.
	 * @returns How many products were created.
	 * And one message per skipped row or group.
	 */
	async import(
		shopId: number,
		shopCurrency: string,
		text: string,
		userId: number,
	): Promise<Imported> {
		let job: ImportJob;
		try {
			job = await this.#open(shopId, shopCurrency, text, userId);
		} catch (e) {
			if (e instanceof CsvFileError) return { created: 0, errors: [e.message] };
			throw e;
		}
		const result: Imported = { created: 0, errors: [] };
		for (const unit of job.units) {
			try {
				await this.#importUnit(job, unit, result.created);
				result.created++;
			} catch (e) {
				result.errors.push(this.#skipped(job.sheet, unit, e));
			}
		}
		return result;
	}

	/**
	 * The category a row names, made on the fly when the shop has none.
	 * "Food > Drinks" means the deepest level: Drinks.
	 * @param shopId Owning shop.
	 * @param cats The shop's categories by lower-case name.
	 * A new one is added to it.
	 * @param raw The cell's text.
	 * @returns The category id, or null for an empty cell.
	 */
	async #categoryIdFor(
		shopId: number,
		cats: Map<string, number>,
		raw: string,
	): Promise<number | null> {
		const name = raw
			.split(">")
			.map((s) => s.trim())
			.filter(Boolean)
			.pop();
		if (!name) return null;
		let id = cats.get(name.toLowerCase());
		if (!id) {
			id = (
				await this.categories.create(shopId, {
					name: name.slice(0, 100),
					color: null,
					image: null,
				})
			).id;
			cats.set(name.toLowerCase(), id);
		}
		return id;
	}

	/**
	 * Read the file and check it as a whole.
	 * @param shopId Owning shop.
	 * @param shopCurrency The shop's currency.
	 * @param text The uploaded file's contents.
	 * @param userId Who imports.
	 * @returns The job the rows are imported with.
	 * @throws CsvFileError when the file can not be imported at all.
	 */
	async #open(
		shopId: number,
		shopCurrency: string,
		text: string,
		userId: number,
	): Promise<ImportJob> {
		const rows = parseCsv(text);
		const sheet = new CsvSheet(
			(rows.shift() ?? []).map((h) => h.trim().toLowerCase()),
		);
		if (!sheet.has("name") || !sheet.has("price"))
			throw new CsvFileError(t("server.csv_header_required"));
		if (!rows.length) throw new CsvFileError(t("server.csv_no_rows"));
		if (rows.length > CSV_MAX_ROWS)
			throw new CsvFileError(
				t("server.csv_too_many_rows", { max: CSV_MAX_ROWS }),
			);
		// prices are taken as written
		// a foreign currency would mis-price everything, so refuse instead
		const foreign = rows.find((r) => sheet.isForeign(r, shopCurrency));
		if (foreign)
			throw new CsvFileError(
				t("server.csv_currency_mismatch", {
					currency: sheet.get(foreign, "currency"),
					shop: shopCurrency,
				}),
			);
		const units = this.#groupRows(sheet, rows);
		const cats = new Map(
			(await this.categories.allForShop(shopId)).map((c) => [
				c.name.toLowerCase(),
				c.id,
			]),
		);
		const room = await this.limits.productsLeft(shopId);
		return { shopId, userId, sheet, units, cats, room };
	}

	/**
	 * Create the product of one unit.
	 * @param job The import run.
	 * @param unit The row, or the rows of one variant group.
	 * @param created How many products this run has made so far.
	 * @throws CsvRowError when the unit must be skipped.
	 */
	async #importUnit(job: ImportJob, unit: Unit, created: number) {
		const { sheet, shopId } = job;
		const lines = this.#readLines(sheet, unit);
		// the category is made before the row is checked, as it always was
		const catId = await this.#categoryIdFor(
			shopId,
			job.cats,
			sheet.get(unit.rows[0]!.r, "category"),
		);
		const v = validate(ProductInput, this.#toInput(sheet, unit, lines, catId));
		const refused =
			v.errors ?? (await this.products.barcodeErrors(shopId, v.data));
		if (refused)
			throw this.#rowError(sheet, unit, Object.values(refused).join("; "));
		if (created >= job.room)
			throw this.#rowError(sheet, unit, await this.limits.productError(shopId));
		await this.products.create(shopId, v.data!, job.userId);
	}

	/**
	 * How the messages name a unit: its line number, and its name if it has one.
	 * @param sheet The file's header.
	 * @param unit The unit.
	 * @returns For example "Row 5 (Cola)".
	 */
	#label(sheet: CsvSheet, unit: Unit): string {
		const name = sheet.get(unit.rows[0]!.r, "name");
		return name
			? t("server.csv_row_named", { row: unit.n, name })
			: t("server.csv_row", { row: unit.n });
	}

	/**
	 * The error for a unit that is skipped.
	 * @param sheet The file's header.
	 * @param unit The unit.
	 * @param why What is wrong with it.
	 * @returns The error to throw, with the unit's label in front.
	 */
	#rowError(sheet: CsvSheet, unit: Unit, why: string): CsvRowError {
		return new CsvRowError(
			t("server.csv_row_errors", {
				label: this.#label(sheet, unit),
				errors: why,
			}),
		);
	}

	/**
	 * The message for a unit that was not imported.
	 * A failure nobody planned for is logged, and the person gets a short text.
	 * So one broken row never stops the rows after it.
	 * @param sheet The file's header.
	 * @param unit The unit.
	 * @param error What was thrown.
	 * @returns The line shown on the product list.
	 */
	#skipped(sheet: CsvSheet, unit: Unit, error: unknown): string {
		if (error instanceof CsvRowError) return error.message;
		console.error(`[products] CSV import, row ${unit.n}:`, error);
		return this.#rowError(sheet, unit, t("common.something_went_wrong"))
			.message;
	}

	/**
	 * Cents as a decimal amount for a cell.
	 * @param cents The amount in cents, or null.
	 * @returns For example "12.50", or "" for null.
	 */
	#dec(cents: number | null) {
		return cents == null ? "" : (cents / 100).toFixed(2);
	}

	/**
	 * A decimal amount from a cell as cents.
	 * @param s The cell's text.
	 * @returns The cents, or null when it is blank or not a number of 0 or more.
	 */
	#toCents(s: string) {
		if (s.trim() === "") return null;
		const v = Number(s);
		return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
	}

	/**
	 * A whole number from a cell.
	 * @param s The cell's text.
	 * @returns The number, or null when it is not a whole number of 0 or more.
	 */
	#toInt(s: string) {
		const v = Number(s);
		return Number.isInteger(v) && v >= 0 ? v : null;
	}

	/**
	 * A yes / no from a cell.
	 * @param s The cell's text.
	 * @param dflt The answer for an empty cell.
	 * @returns True for "true", "1" or "yes".
	 */
	#bool(s: string, dflt: boolean) {
		return s ? /^(true|1|yes)$/i.test(s) : dflt;
	}

	/**
	 * One export row as cells, in column order.
	 * @param r The row, by column name.
	 * @returns One cell per column of the format.
	 */
	#csvRow(r: CsvRow): string[] {
		return CSV_COLUMNS.map((c) => r[c] ?? "");
	}

	/**
	 * Sort the rows into products.
	 * One unit per standalone row.
	 * Rows sharing a `variant_group` become one product with variants.
	 * @param sheet The file's header.
	 * @param rows The data rows.
	 * @returns The units, in file order.
	 */
	#groupRows(sheet: CsvSheet, rows: string[][]): Unit[] {
		const units: Unit[] = [];
		const groups = new Map<string, Unit>();
		for (const [i, r] of rows.entries()) {
			// spreadsheet line number (header = row 1)
			const n = i + 2;
			const g = sheet.get(r, "variant_group");
			if (!g) {
				units.push({ n, rows: [{ n, r }] });
				continue;
			}
			const u = groups.get(g);
			if (u) u.rows.push({ n, r });
			else {
				const nu = { n, rows: [{ n, r }] };
				groups.set(g, nu);
				units.push(nu);
			}
		}
		return units;
	}

	/**
	 * Read the price, cost, stock and codes of every row of one unit.
	 * @param sheet The file's header.
	 * @param u The unit.
	 * @returns The lines, one per row.
	 * @throws CsvRowError for the first bad cell.
	 */
	#readLines(sheet: CsvSheet, u: Unit): Line[] {
		return u.rows.map(({ n, r }) => this.#readLine(sheet, n, r));
	}

	/**
	 * Read the price, cost, stock and codes of one row.
	 * An empty cost means "no cost". An empty stock means 0.
	 * @param sheet The file's header.
	 * @param n The row's line number in the spreadsheet.
	 * @param r The row.
	 * @returns The line.
	 * @throws CsvRowError for the first cell that is not a valid number.
	 */
	#readLine(sheet: CsvSheet, n: number, r: string[]): Line {
		const price = this.#toCents(sheet.get(r, "price"));
		if (price == null)
			throw this.#badCell(sheet, n, r, "price", "server.csv_bad_price");
		const cost = sheet.get(r, "cost")
			? this.#toCents(sheet.get(r, "cost"))
			: null;
		if (sheet.get(r, "cost") && cost == null)
			throw this.#badCell(sheet, n, r, "cost", "server.csv_bad_cost");
		const stock = sheet.get(r, "stock_quantity")
			? this.#toInt(sheet.get(r, "stock_quantity"))
			: 0;
		if (stock == null)
			throw this.#badCell(
				sheet,
				n,
				r,
				"stock_quantity",
				"server.csv_bad_stock",
			);
		return {
			price,
			cost,
			stock,
			sku: sheet.get(r, "sku") || null,
			barcode: sheet.get(r, "barcode") || null,
			vname: sheet.get(r, "variant_name"),
		};
	}

	/**
	 * The error for a cell that holds no valid number.
	 * @param sheet The file's header.
	 * @param n The row's line number in the spreadsheet.
	 * @param r The row.
	 * @param column The column of the bad cell.
	 * @param key The message, which names the row and the value.
	 * @returns The error to throw.
	 */
	#badCell(
		sheet: CsvSheet,
		n: number,
		r: string[],
		column: string,
		key:
			| "server.csv_bad_price"
			| "server.csv_bad_cost"
			| "server.csv_bad_stock",
	): CsvRowError {
		return new CsvRowError(t(key, { row: n, value: sheet.get(r, column) }));
	}

	/**
	 * One line of a variant group as a variant of the product.
	 * @param l The line.
	 * @param i Its position in the group, from 0.
	 * @returns The variant input. A missing name becomes "Variant <n>".
	 */
	#variantOf(l: Line, i: number) {
		return {
			name: l.vname || t("server.csv_variant_name", { n: i + 1 }),
			price: l.price,
			purchase_price: l.cost,
			attributes: null,
			sku: l.sku,
			barcode: l.barcode,
			images: [],
			stock: l.stock,
		};
	}

	/**
	 * One unit as the product input the form would send.
	 * The first row gives the product's own fields.
	 * @param sheet The file's header.
	 * @param u The unit.
	 * @param lines Its rows, read by `readLines`.
	 * @param catId The product's category, or null.
	 * @returns The raw input, not validated yet.
	 */
	#toInput(sheet: CsvSheet, u: Unit, lines: Line[], catId: number | null) {
		const first = u.rows[0]!.r;
		const isVariant = sheet.get(first, "variant_group") !== "";
		return {
			name: sheet.get(first, "name"),
			description: sheet.get(first, "description"),
			price: lines[0]!.price,
			purchase_price: isVariant ? null : lines[0]!.cost,
			images: [],
			sku: isVariant ? null : lines[0]!.sku,
			barcode: isVariant ? null : lines[0]!.barcode,
			unit: sheet.get(first, "unit").slice(0, 20) || null,
			track_stock: u.rows.some(({ r }) =>
				this.#bool(
					sheet.get(r, "track_stock"),
					sheet.get(r, "stock_quantity") !== "",
				),
			),
			stock: isVariant ? 0 : lines[0]!.stock,
			low_stock_at: this.#toInt(sheet.get(first, "low_stock_threshold")) ?? 0,
			category_ids: catId ? [catId] : [],
			variants: isVariant ? lines.map((l, i) => this.#variantOf(l, i)) : [],
		};
	}
}
