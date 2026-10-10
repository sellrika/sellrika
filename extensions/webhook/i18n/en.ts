/**
 * English texts for this extension.
 * Every other language falls back to this file.
 * The manifest names these keys where it shows text.
 */
export default {
	name: "Webhook",
	description:
		"Sends events to URLs of yours as JSON, so other systems (accounting, a courier, a spreadsheet) hear about them right away. Each webhook picks its own events.",

	"field.secret": "Signing secret",
	"field.secret_hint":
		"Any long random string — each request is signed with it",
	"field.hooks": "Webhooks",
	"field.hooks_add": "Add webhook",
	"field.url": "URL",
	"field.events": "Events",

	"option.order.created": "Order created",
	"option.order.updated": "Order updated",
	"option.order.status_changed": "Order status changed",
	"option.order.paid": "Order paid",
	"option.order.refunded": "Order refunded",
	"option.order.voided": "Order voided",
	"option.product.created": "Product created",
	"option.product.updated": "Product updated",
	"option.product.deleted": "Product deleted",
	"option.customer.created": "Customer created",
	"option.customer.updated": "Customer updated",
	"option.customer.deleted": "Customer deleted",
	"option.stock.updated": "Stock updated",
	"option.staff.created": "Staff created",
	"option.staff.updated": "Staff updated",
	"option.staff.deleted": "Staff deleted",
};
