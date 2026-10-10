/**
 * JSX in browser scripts (assets/*.tsx).
 * The app compiles `<tag>` to __h(...), see tsconfig.json › jsxFactory.
 * It puts the runtime, app/xcore/extensions/jsx-runtime.txt, in front of every .tsx
 * it serves or bundles, so there is nothing to import.
 * Elements are real DOM nodes: <input /> is an HTMLInputElement you
 * append, query and wire like any other.
 */

/**
 * Anything you may put inside a tag.
 */
type JsxChild =
	| Node
	| string
	| number
	| boolean
	| null
	| undefined
	| JsxChild[];

/**
 * What a tag accepts.
 * That is typed `on<event>` handlers, `class` and `style` strings,
 * `ref`, and any other attribute.
 */
type JsxProps<T extends HTMLElement> = {
	[K in keyof HTMLElementEventMap as `on${K}`]?: (
		this: T,
		e: HTMLElementEventMap[K],
	) => void;
} & {
	class?: string;
	style?: string;
	/**
	 * Called with the element once it is made.
	 */
	ref?: (el: T) => void;
	/**
	 * What goes inside the tag.
	 */
	children?: JsxChild;
	/**
	 * Any other attribute: id, placeholder, aria-*, data-*, and so on.
	 * `true` means the attribute is present.
	 * false or null leaves it out.
	 */
	[attr: string]: unknown;
};

/**
 * Makes one element for a plain tag such as `<div>`.
 * @param tag The tag name.
 * @param props The attributes and handlers, or null when there are none.
 * @param children What goes inside.
 * @returns The DOM element for that tag.
 */
declare function __h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: JsxProps<HTMLElementTagNameMap[K]> | null,
	...children: JsxChild[]
): HTMLElementTagNameMap[K];
/**
 * Makes one node from a function used as a tag.
 * @param tag The function that builds the node.
 * @param props What is passed to it, or null when there is nothing.
 * @param children What goes inside.
 * @returns The node the function built.
 */
declare function __h<P>(
	tag: (props: P & { children: JsxChild[] }) => Node,
	props: P | null,
	...children: JsxChild[]
): Node;
/**
 * Makes the node for a `<>…</>` fragment.
 * @param props Holds only the fragment's children.
 * @returns A fragment holding those children.
 */
declare function __F(props: { children: JsxChild[] }): DocumentFragment;

declare namespace JSX {
	/**
	 * Every JSX expression is an element you can append.
	 * A `<>…</>` fragment is a DocumentFragment at runtime, so pass it
	 * on as a Node.
	 */
	type Element = HTMLElement;
	/**
	 * What may stand as a tag: a plain tag name, or a function.
	 */
	type ElementType = keyof HTMLElementTagNameMap | ((props: never) => Node);
	/**
	 * Tells TypeScript that nested tags arrive as `children`.
	 */
	interface ElementChildrenAttribute {
		children: unknown;
	}
	/**
	 * The props every plain HTML tag accepts.
	 */
	type IntrinsicElements = {
		[K in keyof HTMLElementTagNameMap]: JsxProps<HTMLElementTagNameMap[K]>;
	};
}
