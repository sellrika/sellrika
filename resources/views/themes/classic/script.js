/**
 * Classic theme — the interactive parts of the store pages.
 * The server prints the pages; this script adds the cart drawer,
 * the product sheet, the option picker, sign-in, share and small helpers.
 * All rules (cart, stock, options, sign-in) live in `window.Store`.
 * This file only draws them. See docs/features/store-themes.md.
 *
 * To make a new theme, copy this file:
 * - sections 1, 2, 8, 9 and 10 are plumbing — keep them as they are;
 * - sections 3 to 7 draw markup — change the classes and element shapes
 *   to your theme, but keep the accessible names and the data-* hooks.
 * The dialogs themselves are printed by layout.edge.
 */
(function classicTheme() {
	const Store = window.Store;
	if (!Store) return;

	/* ── 1. Helpers ─────────────────────────────────────── */

	/**
	 * Translated text (the store's words, the theme's own merged in by the server).
	 * @param {string} key The dictionary key.
	 * @param {object} [params] Values for the `{placeholders}`.
	 * @returns {string} The text.
	 */
	function t(key, params) {
		return Store.t(key, params);
	}

	/**
	 * Build an element. Text goes in as text, never as HTML.
	 * @param {string} tag The tag name.
	 * @param {object} [attrs] Attributes; `on<event>` keys add listeners,
	 *   `false` / null / undefined values are left out.
	 * @param {Array|string} [children] Child nodes or strings (falsy ones skipped).
	 * @returns {HTMLElement} The element.
	 */
	function h(tag, attrs, children) {
		const el = document.createElement(tag);
		Object.keys(attrs || {}).forEach(function set(name) {
			const value = attrs[name];
			if (value === false || value == null) return;
			if (name.slice(0, 2) === "on") el.addEventListener(name.slice(2), value);
			else el.setAttribute(name, value === true ? "" : String(value));
		});
		[].concat(children == null ? [] : children).forEach(function add(child) {
			if (child || child === 0)
				el.append(typeof child === "object" ? child : String(child));
		});
		return el;
	}

	/** SVG paths of the few icons the script draws (same as icon.edge). */
	const ICONS = {
		minus: '<path d="M5 12h14"/>',
		plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
		trash:
			'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
		bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
	};

	/**
	 * A small line icon.
	 * @param {string} name A key of ICONS.
	 * @returns {SVGElement} The icon, hidden from screen readers.
	 */
	function icon(name) {
		const wrap = document.createElement("span");
		wrap.innerHTML =
			'<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			ICONS[name] +
			"</svg>";
		return wrap.firstChild;
	}

	/**
	 * Redraw part of the page without losing keyboard focus.
	 * Controls carry `data-key`; the one that had focus gets it back.
	 * @param {HTMLElement} root The part that is redrawn.
	 * @param {Function} draw Replaces the children of `root`.
	 */
	function redraw(root, draw) {
		const active = document.activeElement;
		const key =
			active && root.contains(active) ? active.getAttribute("data-key") : null;
		draw();
		if (!key) return;
		const again = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
		if (again && !again.disabled) again.focus();
	}

	/**
	 * Open a <dialog> as a modal (once).
	 * @param {HTMLDialogElement} dialog The dialog.
	 */
	function openDialog(dialog) {
		if (dialog && !dialog.open) dialog.showModal();
	}

	/* ── 2. Forms that submit on change (currency, sort, in stock) ── */

	document
		.querySelectorAll("form[data-autosubmit]")
		.forEach(function watch(form) {
			form.addEventListener("change", function submit() {
				if (form.requestSubmit) form.requestSubmit();
				else form.submit();
			});
		});

	/* ── 3. Cart button + cart drawer ───────────────────── */

	const cartDialog = document.querySelector("[data-cart]");
	const cartLines = document.querySelector("[data-cart-lines]");

	/** Draw the badge and every line of the drawer from `Store.cart`. */
	function drawCart() {
		const lines = Store.cart.lines();
		const count = Store.cart.count();
		document.querySelectorAll("[data-cart-count]").forEach(function badge(el) {
			el.textContent = String(count);
			el.hidden = !count;
		});
		if (!cartDialog) return;
		cartDialog.querySelector("[data-cart-empty]").hidden = lines.length > 0;
		cartDialog.querySelector("[data-cart-foot]").hidden = !lines.length;
		cartDialog.querySelector("[data-cart-subtotal]").textContent = Store.money(
			Store.cart.subtotal(),
		);
		cartLines.hidden = !lines.length;
		redraw(cartLines, function fill() {
			cartLines.replaceChildren.apply(cartLines, lines.map(drawLine));
		});
	}

	/**
	 * One cart line: picture, name (opens the sheet to edit), qty, remove, price.
	 * @param {object} line A `StoreCartLine`.
	 * @returns {HTMLElement} The <li>.
	 */
	function drawLine(line) {
		const full = line.stock !== null && line.qty >= line.stock;
		const name = line.name;
		/** Open this line again in the product sheet. */
		function edit() {
			editLine(line);
		}
		return h("li", { class: "line" }, [
			// the picture is a mouse-only twin of the name button
			h(
				"button",
				{
					type: "button",
					class: "line-thumb",
					tabindex: "-1",
					"aria-hidden": "true",
					onclick: edit,
				},
				line.image
					? h("img", { src: line.image, alt: "" })
					: name.charAt(0).toUpperCase(),
			),
			h("div", { class: "line-body" }, [
				h(
					"button",
					{
						type: "button",
						class: "line-name",
						"data-key": `edit:${line.key}`,
						"aria-label": Store.t("store.edit_x", { name: name }),
						onclick: edit,
					},
					[
						h("span", { class: "line-title" }, name),
						line.variant_name &&
							h("span", { class: "line-variant muted" }, line.variant_name),
					],
				),
				h("div", { class: "line-qty" }, [
					h("div", { class: "stepper" }, [
						h(
							"button",
							{
								type: "button",
								"data-key": `dec:${line.key}`,
								"aria-label": Store.t("store_ui.decrease_x", { name: name }),
								onclick: function dec() {
									if (line.qty > 1) Store.cart.setQty(line.key, line.qty - 1);
									else Store.cart.remove(line.key);
								},
							},
							icon("minus"),
						),
						h("span", {}, line.qty),
						h(
							"button",
							{
								type: "button",
								"data-key": `inc:${line.key}`,
								"aria-label": Store.t("store_ui.increase_x", { name: name }),
								disabled: full,
								onclick: function inc() {
									Store.cart.setQty(line.key, line.qty + 1);
								},
							},
							icon("plus"),
						),
					]),
					h(
						"button",
						{
							type: "button",
							class: "icon-button line-remove",
							"aria-label": Store.t("store.remove_x", { name: name }),
							onclick: function remove() {
								Store.cart.remove(line.key);
							},
						},
						icon("trash"),
					),
				]),
				full &&
					h(
						"p",
						{ class: "line-note muted" },
						Store.t("store_ui.only_available", { count: line.stock }),
					),
			]),
			h("span", { class: "line-price" }, Store.money(line.price * line.qty)),
			// the buyer's custom request: its own row, the line above keeps its layout
			line.note &&
				h("p", { class: "line-request muted" }, [
					`${Store.t("store_ui.custom_request")}: `,
					line.note,
				]),
		]);
	}

	/**
	 * Reopen a cart line in the product sheet, with its options and qty.
	 * A product that is not on this page opens on its own page instead.
	 * @param {object} line A `StoreCartLine`.
	 */
	function editLine(line) {
		const product = Store.product(line.product_id);
		if (!product) {
			if (line.slug) location.href = Store.url.product(line.slug);
			return;
		}
		cartDialog.close();
		openSheet(product, {
			preset: {
				variantId: line.variant_id,
				choices: line.choices,
				note: line.note,
				editing: line.key, // the line counts as 0 in the stock check: it gets replaced
			},
			qty: line.qty,
			editing: line.key,
		});
	}

	/** Open the drawer. */
	function openCart() {
		drawCart();
		openDialog(cartDialog);
	}

	/**
	 * Replay the badge's pop animation.
	 * Removing the class and reading a layout value restarts it.
	 */
	function bump() {
		document.querySelectorAll("[data-cart-count]").forEach(function pop(el) {
			el.classList.remove("is-bump");
			void el.offsetWidth;
			el.classList.add("is-bump");
		});
	}

	document.addEventListener("store:cart", function onCart(e) {
		drawCart();
		if (e.detail?.added) bump();
	});

	/* ── 4. Option picker (product sheet + product page) ─── */

	/**
	 * Draw the options, quantity and "Add to cart" of one product into `root`.
	 * The rules come from `Store.picker()`; every click redraws.
	 * @param {HTMLElement} root Where to draw.
	 * @param {object} product A `StoreProduct`.
	 * @param {object} opts `inline` (product page: no details, they are on the page),
	 *   `preset` + `qty` + `editing` (reopened from the cart),
	 *   `onChosen(unit)` (the gallery follows the pick), `onAdded(wasEditing)`.
	 */
	function mountPicker(root, product, opts) {
		let pick = Store.picker(product, opts.preset);
		let qty = opts.qty || 1;
		const bundle = product.kind === "bundle";

		/** Draw everything again. */
		function draw() {
			redraw(root, function all() {
				const body = h(
					"div",
					{ class: "picker-body" },
					[drawOptions(), drawNote()].concat(opts.inline ? [] : drawDetails()),
				);
				root.replaceChildren(h("div", { class: "picker" }, [body, drawFoot()]));
			});
			if (opts.onChosen) opts.onChosen(pick.chosen());
		}

		/**
		 * One row of option buttons with its heading.
		 * @param {string} title The heading.
		 * @param {string} state What is picked, or "Required".
		 * @param {HTMLElement[]} buttons The buttons.
		 * @returns {HTMLElement} The section.
		 */
		function group(title, state, buttons) {
			return h("section", {}, [
				h("div", { class: "opt-head" }, [
					h("h3", { class: "label" }, title),
					h(
						"span",
						{ class: `small${state ? "" : " muted"}` },
						state || t("common.required"),
					),
				]),
				h("div", { class: "opt-values" }, buttons),
			]);
		}

		/**
		 * One option button (a value, a package choice).
		 * @param {string} key Focus key.
		 * @param {string} label The text.
		 * @param {boolean} on Is it picked?
		 * @param {boolean} off Is it unavailable?
		 * @param {Function} onclick What a click does.
		 * @returns {HTMLElement} The button.
		 */
		function option(key, label, on, off, onclick) {
			const colour = Store.swatch(label);
			return h(
				"button",
				{
					type: "button",
					class: "opt",
					"data-key": key,
					"aria-pressed": on ? "true" : "false",
					"aria-label": label,
					disabled: off,
					onclick: function choose() {
						onclick();
						draw();
					},
				},
				[
					colour &&
						h("span", { class: "swatch", style: `background:${colour}` }),
					label,
				],
			);
		}

		/** @returns {HTMLElement} The options: package slots, attribute groups or a plain list. */
		function drawOptions() {
			const wrap = h("div", { class: "stack" });
			if (bundle) {
				pick.slots.forEach(function slot(s) {
					const picked = s.options.find(function mine(o) {
						return o.variant_id === pick.choices[s.id];
					});
					wrap.append(
						group(
							`${s.qty} × ${s.name}`,
							picked?.name,
							s.options.map(function one(o) {
								return option(
									`slot:${s.id}:${o.variant_id}`,
									o.name,
									pick.choices[s.id] === o.variant_id,
									pick.optionLeft(s.id, o.variant_id) === 0,
									function go() {
										pick.pickSlot(s.id, o.variant_id);
									},
								);
							}),
						),
					);
				});
			} else if (pick.guided) {
				pick.groups.forEach(function each(g) {
					wrap.append(
						group(
							g.name,
							pick.picked[g.name],
							g.values.map(function one(value) {
								return option(
									`g:${g.name}:${value}`,
									value,
									pick.picked[g.name] === value,
									!pick.available(g.name, value),
									function go() {
										pick.choose(g.name, value);
									},
								);
							}),
						),
					);
				});
			} else if (product.variants.length) {
				wrap.append(
					h(
						"section",
						{ class: "opt-list" },
						[h("h3", { class: "label" }, Store.t("store_ui.option"))].concat(
							product.variants.map(drawRow),
						),
					),
				);
			}
			return wrap;
		}

		/**
		 * One row of the plain option list (variants without attributes).
		 * @param {object} v A `StoreVariant`.
		 * @returns {HTMLElement} The row button.
		 */
		function drawRow(v) {
			return h(
				"button",
				{
					type: "button",
					class: "opt-row",
					"data-key": `v:${v.id}`,
					"aria-pressed": pick.variantId === v.id ? "true" : "false",
					disabled: v.sold_out,
					onclick: function go() {
						pick.pickVariant(v.id);
						draw();
					},
				},
				[
					h("span", { class: "opt-row-name" }, [
						h("span", { class: "opt-mark", "aria-hidden": "true" }),
						v.name,
						v.sold_out &&
							h("span", { class: "tag tag--out" }, Store.t("store.sold_out")),
					]),
					h("span", { class: "muted" }, Store.money(v.price)),
				],
			);
		}

		/** @returns {HTMLElement[]} Additional data, description and package contents (sheet only). */
		function drawDetails() {
			const out = [];
			if (product.extra.length || product.description) {
				const details = h("section", { class: "details" }, [
					h("h3", { class: "label" }, Store.t("store_ui.details")),
				]);
				if (product.extra.length) {
					const dl = h("dl", {
						class: "extra",
						"aria-label": Store.t("shared.additional_data"),
					});
					product.extra.forEach(function row(r) {
						dl.append(h("dt", {}, r.title), h("dd", {}, r.value));
					});
					details.append(dl);
				}
				if (product.description) {
					const text = h("div", { class: "rich-html muted" });
					// sanitised on the server when saved; the product page prints it the same way
					text.innerHTML = product.description;
					details.append(text);
				}
				out.push(details);
			} else if (!product.variants.length && !bundle) {
				out.push(
					h("p", { class: "muted small" }, Store.t("store_ui.no_description")),
				);
			}
			if (bundle) {
				out.push(
					h("section", { class: "details" }, [
						h("h3", { class: "label" }, Store.t("store_ui.in_this_package")),
						h(
							"ul",
							{ class: "plain-list muted small" },
							product.bundle_items.map(function slot(s) {
								const names = s.options.map(function n(o) {
									return o.name;
								});
								const plain =
									s.options.length === 1 && s.options[0].variant_id === null;
								return h(
									"li",
									{},
									`${s.qty} × ${s.name}${plain ? "" : ` (${names.join(` ${t("products.or_joiner")} `)})`}`,
								);
							}),
						),
					]),
				);
			}
			return out;
		}

		/**
		 * The buyer's custom request (like the name to engrave).
		 * Typing keeps the text without a redraw, so the caret stays.
		 * @returns {HTMLElement|null} The box, or null when the product asks for none.
		 */
		function drawNote() {
			if (!pick.asksNote) return null;
			return h("label", { class: "field note-field" }, [
				h("span", {}, pick.noteLabel),
				h(
					"textarea",
					{
						rows: 3,
						maxlength: pick.noteMax,
						required: true,
						"data-key": "note",
						"data-note": "",
						oninput: function type(e) {
							pick.setNote(e.target.value);
						},
					},
					pick.note,
				),
			]);
		}

		/** @returns {HTMLElement} Qty stepper, "Add to cart" with the running total, and the hint line. */
		function drawFoot() {
			const unit = pick.chosen();
			const error = pick.error(qty);
			const label = opts.editing
				? product.variants.length || bundle
					? Store.t("store_ui.update_line")
					: Store.t("store_ui.ok")
				: Store.t("store.add_to_cart");
			return h("div", { class: "picker-foot" }, [
				h("div", { class: "picker-add" }, [
					h("div", { class: "stepper stepper--big" }, [
						h(
							"button",
							{
								type: "button",
								"data-key": "qty-",
								"aria-label": Store.t("store_ui.decrease_quantity"),
								disabled: qty <= 1,
								onclick: function less() {
									qty--;
									draw();
								},
							},
							icon("minus"),
						),
						h("span", {}, qty),
						h(
							"button",
							{
								type: "button",
								"data-key": "qty+",
								"aria-label": Store.t("store_ui.increase_quantity"),
								onclick: function more() {
									qty++;
									draw();
								},
							},
							icon("plus"),
						),
					]),
					h(
						"button",
						{
							type: "button",
							class: "btn add-button",
							"data-key": "add",
							disabled: !pick.canAdd() || !!error,
							onclick: add,
						},
						[
							h("span", { class: "add-text" }, [icon("bag"), label]),
							h(
								"span",
								{ class: "add-price" },
								unit ? Store.money(unit.price * qty) : "",
							),
						],
					),
				]),
				h("p", { class: "small muted" }, hint(unit, error)),
			]);
		}

		/**
		 * The line under the Add button: what is missing, or price per unit and stock.
		 * @param {object|null} unit The chosen unit.
		 * @param {string|null} error The stock message.
		 * @returns {Array} Text and nodes.
		 */
		function hint(unit, error) {
			const and = ` ${Store.t("store_ui.and")} `;
			if (bundle) {
				const open = pick.slots.filter(function unanswered(s) {
					return pick.choices[s.id] == null;
				});
				if (open.length)
					return [
						Store.t("store_ui.choose_to_continue", {
							what: names(open).join(and),
						}),
					];
			}
			if (unit && error)
				return [h("span", { class: "error" }, error), ` · ${unit.name}`];
			if (unit) {
				const left = pick.left();
				return [
					Store.t("store_ui.each_price", { price: Store.money(unit.price) }) +
						(product.variants.length ? ` · ${unit.name}` : "") +
						(left !== null
							? ` · ${Store.t("store_ui.n_in_stock", { count: left })}`
							: ""),
				];
			}
			if (pick.guided) {
				const missing = pick.groups.filter(function empty(g) {
					return !pick.picked[g.name];
				});
				return [
					missing.length
						? Store.t("store_ui.choose_to_continue", {
								what: names(missing).join(and),
							})
						: Store.t("store_ui.combo_unavailable"),
				];
			}
			return [Store.t("store_ui.select_option")];
		}

		/**
		 * @param {Array} list Groups or slots.
		 * @returns {string[]} Their names.
		 */
		function names(list) {
			return list.map(function name(x) {
				return x.name;
			});
		}

		/** Put the chosen unit in the cart (or replace the line being edited). */
		function add() {
			const editing = opts.editing;
			const box = root.querySelector("[data-note]");
			if (box && !box.value.trim()) box.value = "";
			if (box && !box.reportValidity()) return;
			if (!pick.addToCart(qty, editing)) return;
			if (editing) {
				opts.editing = null;
				opts.preset = null;
			}
			qty = 1;
			pick = Store.picker(product);
			if (opts.onAdded) opts.onAdded(!!editing);
			draw();
		}

		draw();
	}

	/* ── 5. Product sheet (tap a product card) ──────────── */

	const sheet = document.querySelector("[data-sheet]");

	/**
	 * Open the sheet for one product.
	 * @param {object} product A `StoreProduct`.
	 * @param {object} [edit] `preset`, `qty`, `editing` when reopened from the cart.
	 */
	function openSheet(product, edit) {
		if (!sheet) return;
		const prices = product.variants.map(function p(v) {
			return v.price;
		});
		const lo = prices.length ? Math.min.apply(null, prices) : product.price;
		const hi = prices.length ? Math.max.apply(null, prices) : product.price;
		const off =
			product.original_price && product.original_price > product.price
				? Math.round((1 - product.price / product.original_price) * 100)
				: null;
		sheet.querySelector("[data-sheet-name]").textContent = product.name;
		sheet.querySelector("[data-sheet-pack]").textContent =
			product.amount == null
				? ""
				: `${product.amount} ${product.unit || ""}`.trim();
		sheet
			.querySelector("[data-sheet-price]")
			.replaceChildren(
				lo === hi ? Store.money(lo) : `${Store.money(lo)} – ${Store.money(hi)}`,
				off
					? h("s", { class: "muted" }, Store.money(product.original_price))
					: "",
				off ? h("span", { class: "off" }, `−${off}%`) : "",
			);
		sheet.querySelector("[data-sheet-kind]").textContent =
			product.kind === "bundle"
				? Store.t("store.package")
				: product.variants.length
					? Store.t("store.options_count", { count: product.variants.length })
					: "";
		sheet.querySelector("[data-sheet-link]").href = Store.url.product(
			product.slug,
		);
		const share = sheet.querySelector("[data-share]");
		share.setAttribute("data-share-url", Store.url.product(product.slug));
		share.setAttribute("data-share-title", product.name);
		sheet.querySelector("[data-share-note]").textContent = "";

		const gallery = sheet.querySelector("[data-gallery]");
		mountPicker(sheet.querySelector("[data-sheet-picker]"), product, {
			preset: edit?.preset,
			qty: edit?.qty,
			editing: edit?.editing,
			onChosen: function follow(unit) {
				drawGallery(gallery, product, unit);
			},
			onAdded: function added(wasEditing) {
				sheet.close();
				if (wasEditing) openCart();
			},
		});
		openDialog(sheet);
	}

	document.addEventListener("click", function tapCard(e) {
		const card = e.target.closest?.("a[data-product]");
		if (!card || e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const product = Store.product(Number(card.getAttribute("data-product")));
		// sold out, or not in the page data: follow the link to the product page
		if (!product || product.sold_out) return;
		e.preventDefault();
		openSheet(product);
	});

	/* ── 6. Gallery ─────────────────────────────────────── */

	/**
	 * Draw the sheet's gallery: the chosen unit's photos first,
	 * then the product's, then every variant's (no repeats).
	 * @param {HTMLElement} root The [data-gallery] box.
	 * @param {object} product A `StoreProduct`.
	 * @param {object|null} unit The chosen unit.
	 */
	function drawGallery(root, product, unit) {
		const all = [].concat(
			unit?.images || [],
			product.images,
			product.variants.reduce(function flat(list, v) {
				return list.concat(v.images);
			}, []),
		);
		const photos = all.filter(function first(src, i) {
			return all.indexOf(src) === i;
		});
		const main = h(
			"div",
			{ class: "gallery-main hatch" },
			photos.length
				? h("img", {
						"data-gallery-main": true,
						src: photos[0],
						alt: product.name,
					})
				: h(
						"span",
						{ class: "card-letter", "aria-hidden": "true" },
						product.name.trim().charAt(0).toUpperCase(),
					),
		);
		const thumbs =
			photos.length > 1 &&
			h(
				"div",
				{ class: "gallery-thumbs" },
				photos.map(function thumb(src, n) {
					return h(
						"button",
						{
							type: "button",
							class: "gallery-thumb",
							"data-gallery-thumb": src,
							"aria-label": t("shared.photo_n", { n: n + 1 }),
							"aria-pressed": n === 0 ? "true" : "false",
						},
						h("img", { src: src, alt: "" }),
					);
				}),
			);
		root.replaceChildren.apply(root, thumbs ? [main, thumbs] : [main]);
	}

	/**
	 * Show one photo big in a gallery.
	 * @param {HTMLElement} root The [data-gallery] box.
	 * @param {string} src The photo.
	 */
	function showPhoto(root, src) {
		const main = root.querySelector("[data-gallery-main]");
		if (main) main.src = src;
		root.querySelectorAll("[data-gallery-thumb]").forEach(function mark(b) {
			b.setAttribute(
				"aria-pressed",
				b.getAttribute("data-gallery-thumb") === src ? "true" : "false",
			);
		});
	}

	document.addEventListener("click", function thumb(e) {
		const button = e.target.closest?.("[data-gallery-thumb]");
		if (!button) return;
		showPhoto(
			button.closest("[data-gallery]"),
			button.getAttribute("data-gallery-thumb"),
		);
	});

	/* ── 7. Product page: the picker inline ─────────────── */

	document.querySelectorAll("[data-picker]").forEach(function inline(root) {
		const product = Store.product(Number(root.getAttribute("data-picker")));
		if (!product) return;
		const gallery = document.querySelector("main [data-gallery]");
		mountPicker(root, product, {
			inline: true,
			onChosen: function follow(unit) {
				if (gallery && unit?.images?.[0]) showPhoto(gallery, unit.images[0]);
			},
		});
	});

	/* ── 8. Share (native share sheet, else copy the link) ─ */

	document.addEventListener("click", function share(e) {
		const button = e.target.closest?.("[data-share]");
		if (!button) return;
		const note = button.parentElement.querySelector("[data-share-note]");
		const url = new URL(
			button.getAttribute("data-share-url") || location.href,
			location.origin,
		).href;
		const title = button.getAttribute("data-share-title") || document.title;
		/**
		 * Say what happened for two seconds.
		 * @param {string} text The message ("" = nothing).
		 */
		function say(text) {
			if (!note) return;
			note.textContent = text;
			setTimeout(function clear() {
				note.textContent = "";
			}, 2000);
		}
		const done = navigator.share
			? navigator.share({ title: title, url: url }).then(function shared() {
					return "";
				})
			: navigator.clipboard.writeText(url).then(function copied() {
					return Store.t("store_ui.link_copied");
				});
		done.then(say, function failed() {
			say(Store.t("store_ui.share_failed"));
		});
	});

	/* ── 9. Sign-in dialog ──────────────────────────────── */

	const login = document.querySelector("[data-login]");
	if (login) setUpLogin(login);

	/**
	 * Sign in, create an account or reset the password — whichever the shop allows.
	 * `Store.auth` does the work; a successful sign-in reloads the page.
	 * @param {HTMLDialogElement} dialog The sign-in dialog.
	 */
	function setUpLogin(dialog) {
		const form = dialog.querySelector("[data-login-form]");
		const errorBox = dialog.querySelector("[data-login-error]");
		const noteBox = dialog.querySelector("[data-login-note]");
		const resend = dialog.querySelector("[data-login-resend]");
		let mode = "signin";
		let busy = false;

		/**
		 * Switch between "signin", "signup" and "reset".
		 * @param {string} next The mode.
		 */
		function setMode(next) {
			mode = next;
			dialog.querySelector("[data-login-title]").textContent =
				mode === "signup"
					? Store.t("store_ui.create_account")
					: mode === "reset"
						? Store.t("store_ui.reset_password")
						: Store.t("store.sign_in");
			const social = dialog.querySelector("[data-login-social]");
			if (social) social.hidden = mode !== "signin";
			if (!form) return;
			form.querySelector("[data-login-password]").hidden = mode === "reset";
			form.querySelector("[data-login-confirm]").hidden = mode !== "signup";
			form.elements.password.autocomplete =
				mode === "signup" ? "new-password" : "current-password";
			form.querySelector("[data-login-submit]").textContent =
				mode === "signup"
					? Store.t("store_ui.create_account_button")
					: mode === "reset"
						? Store.t("store_ui.send_reset_link")
						: Store.t("store.sign_in");
			form.querySelectorAll("[data-login-mode]").forEach(function show(b) {
				const target = b.getAttribute("data-login-mode");
				b.hidden =
					mode === "signin" ? target === "signin" : target !== "signin";
			});
			ready();
		}

		/** Allow the submit button only when the needed boxes are filled. */
		function ready() {
			if (!form) return;
			const f = form.elements;
			form.querySelector("[data-login-submit]").disabled =
				busy ||
				!f.email.value.trim() ||
				(mode !== "reset" && !f.password.value) ||
				(mode === "signup" && !f.confirm.value);
		}

		/**
		 * Show a message (or clear both).
		 * @param {string} [error] An error text.
		 * @param {string} [note] A notice text.
		 * @param {boolean} [unverified] Offer "Send the link again".
		 */
		function message(error, note, unverified) {
			errorBox.hidden = !error;
			errorBox.querySelector("span").textContent = error || "";
			resend.hidden = !unverified;
			noteBox.hidden = !note;
			noteBox.textContent = note || "";
		}

		/**
		 * Run one sign-in call with the buttons locked.
		 * @param {Function} call Returns a promise of `{ error, notice, unverified }`.
		 */
		function run(call) {
			if (busy) return;
			busy = true;
			message();
			dialog.querySelectorAll("button").forEach(function lock(b) {
				if (!b.hasAttribute("data-close")) b.disabled = true;
			});
			Promise.resolve()
				.then(call)
				.then(function result(r) {
					if (r?.error) message(r.error, "", !!r.unverified);
					else if (r?.notice) {
						message("", r.notice);
						setMode("signin");
					}
				})
				.catch(function failed(err) {
					message(err?.message || String(err));
				})
				.then(function unlock() {
					busy = false;
					dialog.querySelectorAll("button").forEach(function open(b) {
						b.disabled = false;
					});
					ready();
				});
		}

		/** Open the dialog in "sign in" mode. */
		function open() {
			message();
			setMode("signin");
			openDialog(dialog);
		}

		document.addEventListener("click", function opener(e) {
			if (e.target.closest?.("[data-login-open]")) open();
		});
		document.addEventListener("store:login", open);

		dialog.querySelectorAll("[data-provider]").forEach(function provider(b) {
			b.addEventListener("click", function signIn() {
				run(function go() {
					return Store.auth.signIn(b.getAttribute("data-provider"));
				});
			});
		});
		resend.addEventListener("click", function again() {
			run(function go() {
				return Store.auth.resendVerification().then(function sent(r) {
					return r?.error
						? r
						: { notice: r?.notice || Store.t("store_ui.verification_sent") };
				});
			});
		});
		if (!form) return;
		form.addEventListener("input", ready);
		form.querySelectorAll("[data-login-mode]").forEach(function switcher(b) {
			b.addEventListener("click", function go() {
				message();
				setMode(b.getAttribute("data-login-mode"));
			});
		});
		form.addEventListener("submit", function submit(e) {
			e.preventDefault();
			const email = form.elements.email.value.trim();
			const password = form.elements.password.value;
			if (mode === "signup" && password !== form.elements.confirm.value) {
				message(Store.t("store_ui.passwords_mismatch"));
				return;
			}
			run(function go() {
				if (mode === "reset")
					return Store.auth.resetPassword(email).then(function sent(r) {
						return r?.error
							? r
							: { notice: r?.notice || Store.t("store_ui.reset_sent") };
					});
				if (mode === "signup")
					return Store.auth.signUp({ email: email, password: password });
				return Store.auth.signIn("email", { email: email, password: password });
			});
		});
	}

	/* ── 10. Dialog plumbing + start ────────────────────── */

	/**
	 * The cart's button: the checkout page.
	 * A store with no payment option sends the order itself;
	 * a refusal is shown under the button.
	 */
	function checkout() {
		const error = document.querySelector("[data-cart-error]");
		if (error) error.hidden = true;
		Store.checkout().then(function done(message) {
			if (!message || !error) return;
			error.textContent = message;
			error.hidden = false;
		});
	}

	document.addEventListener("click", function plumbing(e) {
		const target = e.target;
		if (!target.closest) return;
		if (target.closest("[data-cart-open]")) openCart();
		else if (target.closest("[data-checkout]")) checkout();
		else if (target.closest("[data-close]")) target.closest("dialog").close();
		else if (target.tagName === "DIALOG") {
			// a click on the backdrop (outside the dialog box) closes it
			const box = target.getBoundingClientRect();
			const inside =
				e.clientX >= box.left &&
				e.clientX <= box.right &&
				e.clientY >= box.top &&
				e.clientY <= box.bottom;
			if (!inside) target.close();
		}
	});

	drawCart();
})();
