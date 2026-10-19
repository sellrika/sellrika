import { expect, test } from "bun:test";
import { encrypt } from "@helpers/crypto";
import {
	maskFields,
	openFields,
	type SecretField,
} from "@helpers/secretFields";

const FIELDS: SecretField[] = [
	{ name: "public_key", secret: false },
	{ name: "secret_key", secret: true },
	{ name: "note", secret: false, required: false },
];

/**
 * Run a test body with a known `APP_KEY`, then put the old one back.
 * @param body The test body.
 */
function withKey(body: () => void) {
	const prev = process.env.APP_KEY;
	process.env.APP_KEY = "unit-test-key";
	try {
		body();
	} finally {
		if (prev !== undefined) process.env.APP_KEY = prev;
		else delete process.env.APP_KEY;
	}
}

test("maskFields: a secret comes back empty, secret_set says if one is stored", () => {
	const out = maskFields(FIELDS, { public_key: "pk_1", secret_key: "v1.abc" });
	expect(out.credentials).toEqual({
		public_key: "pk_1",
		secret_key: "",
		note: "",
	});
	expect(out.secret_set).toEqual({ secret_key: true });
	expect(maskFields(FIELDS, {}).secret_set).toEqual({ secret_key: false });
});

test("openFields: decrypts secrets, null while a required field is empty", () => {
	withKey(() => {
		const stored = { public_key: "pk_1", secret_key: encrypt("sk_1") };
		expect(openFields(FIELDS, stored)).toEqual({
			public_key: "pk_1",
			secret_key: "sk_1",
			note: "",
		});
		expect(openFields(FIELDS, { public_key: "pk_1" })).toBeNull();
		expect(openFields(FIELDS, { secret_key: stored.secret_key })).toBeNull();
	});
});
