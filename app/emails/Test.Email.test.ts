import { expect, test } from "bun:test";
import { t } from "@xcore/i18n/I18n";
import { TestEmail } from "./Test.Email";

test("test email: the html is rendered from emails/test.edge", async () => {
	const mail = await new TestEmail("a@x.io").build();
	expect(mail.subject).toBe(t("server.mail_test_subject"));
	expect(mail.html).toContain(t("server.mail_test_body"));
	expect(mail.html).toContain("<h1");
});
