import { expect, test } from "@playwright/test";
import { enableGlobally, login } from "./helpers";

// The daily report: the gear button on /reports opens its settings. Without the Chat alerts extension no channel
// can be picked, so it can't be switched on. With Slack filled in there, the admin picks a time and Slack, and it stays saved.
test("daily report: needs a Chat alerts channel, then keeps its time and channel", async ({
	page,
}) => {
	await login(page);
	await page.goto("/reports");
	const gear = page.getByRole("button", { name: "Daily report", exact: true });
	const dlg = page.getByRole("dialog", { name: "Daily report" });
	const toggle = dlg.getByLabel("Send a daily report");
	const save = dlg.getByRole("button", { name: "Save", exact: true });

	// no channel yet: the time starts at 10 PM, the dialog says what to do and refuses to switch on
	await gear.click();
	await expect(dlg.getByLabel("Time", { exact: true })).toHaveValue("22:00");
	await expect(dlg.getByText("No channel is set up yet.")).toBeVisible();
	await expect(
		dlg.getByRole("link", { name: "Open Extensions" }),
	).toHaveAttribute("href", "/extensions");
	await toggle.click();
	await save.click();
	await expect(dlg.getByRole("alert")).toHaveText("Pick at least one channel.");
	await dlg.getByRole("button", { name: "Cancel" }).click();

	// Chat alerts on, with a Slack webhook
	await enableGlobally(page, "Chat alerts");
	const config = {
		events: ["order.voided"],
		slack_url: "https://hooks.slack.com/services/T/B/x",
	};
	const saved = await page.request.put("/extensions/chat-alerts", {
		data: { enabled: true, config },
	});
	expect(saved.ok()).toBeTruthy();

	try {
		// only the filled channel is offered
		await page.goto("/reports");
		await gear.click();
		await expect(dlg.getByLabel("Slack")).toBeVisible();
		await expect(dlg.getByLabel("Discord")).toHaveCount(0);
		await toggle.click();
		await dlg.getByLabel("Time", { exact: true }).fill("21:30");
		await dlg.getByLabel("Slack").click();
		await save.click();
		await expect(page.getByText("Daily report saved")).toBeVisible();
		await expect(dlg).toBeHidden();

		// it is kept
		await page.reload();
		await gear.click();
		await expect(toggle).toBeChecked();
		await expect(dlg.getByLabel("Time", { exact: true })).toHaveValue("21:30");
		await expect(dlg.getByLabel("Slack")).toBeChecked();

		// a wrong time is refused by the server
		const bad = await page.request.put("/reports/schedule", {
			data: { enabled: true, time: "25:00", channels: ["slack"] },
		});
		expect(bad.status()).toBe(422);
	} finally {
		// off again, so no later spec posts to the made-up webhook
		await page.request.put("/reports/schedule", {
			data: { enabled: false, time: "22:00", channels: [] },
		});
		await page.request.put("/extensions/chat-alerts", {
			data: { enabled: false, config },
		});
	}
});
