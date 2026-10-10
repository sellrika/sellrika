---
name: comments
description: How to write code comments in this POS — short JSDoc blocks, one idea per line, @param/@returns on functions, never a long one-line comment. Use whenever you add or change a comment, JSDoc, config object, constant or route file, and as a last pass before finishing any code change.
---

# Comments

Every comment is a JSDoc block. Short lines. One idea per line. Plain English.

## Rules

- **Use `/** … */` blocks, on several lines.** Never pack a long sentence into one `//` line or a one-line `/** */`.
- **Keep each line short**, about 80 characters at most. Split a longer thought into more lines, not a longer line.
- **One idea per line.** Say the problem, then what it causes, then what the code does about it.
- **Functions and methods** get a one-line summary, then `@param` per argument and `@returns` when something comes back.
- **Object fields, constants and config entries** get their own small block right above them.
- **`//` is only for a short remark inside a function body**, one line, under 80 characters. A `ponytail:` note is the same shape.
- **Explain the effect in normal words before naming code.** Keep identifiers as they are.

## Shape

```ts
/**
 * Where uploaded images go.
 * One flydrive service per driver. `STORAGE_DRIVER` picks one.
 * Only the chosen driver's settings need to be filled in.
 */
const drivers = {
	/**
	 * Files on this machine. The default.
	 * Tests override `UPLOAD_DIR` so they never touch real uploads.
	 */
	local: { dir: UPLOAD_DIR },
};

/**
 * Read a stored image back for `GET /uploads/<name>`.
 * The local folder is tried first, then the driver.
 * @param name The bare file name, `<uuid>.<ext>`.
 * @returns A long-cached response, or null when nobody has the file.
 */
export async function readUpload(name: string): Promise<Response | null> {
	// ponytail: whole file in memory, uploads are 5 MB at most.
}
```

## Not this

```ts
/** Where uploaded images go — one flydrive service per driver, picked by `STORAGE_DRIVER`. See `app/xcore/storage/Storage.ts`. */
const drivers = {
	// files on this machine (default); tests override `UPLOAD_DIR` so they never touch real uploads
	local: { dir: UPLOAD_DIR },
};
```

## Last pass

Before finishing, scan every comment you added or changed. Split anything over about 80 characters into a block. This holds for `config/`, `app/constants/`, `routes/` and test files too, not only services.
