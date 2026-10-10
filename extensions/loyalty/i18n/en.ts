/**
 * English texts for this extension.
 * It is the fallback for every other language.
 */
export default {
	name: "Loyalty Points",
	description:
		"Customers earn points when they pay. When they reach the goal, they get a discount code.",
	"page.members": "Loyalty",

	"field.spend": "Money spent to earn 1 point",
	"field.spend_hint":
		"Example: 1 = one point for every 1.00 paid. 10 = one point for every 10.00 paid.",
	"field.goal": "Points needed for a reward",
	"field.goal_hint":
		"Example: 100 = at 100 points the customer gets a discount code. Those 100 points are then used up.",
	"field.reward_type": "Reward type",
	"field.reward_type_hint": "What the discount code gives.",
	"field.reward_value": "Reward size",
	"field.reward_value_hint":
		"Money off: 5 = 5.00 off. Percent off: 5 = 5% off.",
	"option.fixed": "Money off",
	"option.percent": "Percent off",

	"coupon.description": "Loyalty reward",

	"reward.percent": "{value}% off",
	"reward.fixed": "{amount} off",

	"config.on": "Loyalty points is on",
	"config.off": "Loyalty points is off",
	"config.on_hint": "Customers earn points on every paid order.",
	"config.switch_aria": "Loyalty Points enabled",
	"config.spend_question": "How much must a customer pay to get 1 point?",
	"config.spend_hint":
		"A {amount} order gives {points}. A smaller number gives points faster.",
	"config.spend_hint_empty": "A smaller number gives points faster.",
	"config.goal_question": "How many points does a customer need for a reward?",
	"config.goal_hint":
		"At {points} the customer gets a discount code. Those points are then used up.",
	"config.goal_hint_empty":
		"At this many points the customer gets a discount code.",
	"config.reward_question": "What does the discount code give?",
	"config.reward_size": "Reward size",
	"config.value_hint": "The code takes {reward} the bill.",
	"config.value_hint_empty": "Type how much the code takes off the bill.",
	"config.points_word": "points",
	"config.n_point": "{n} point",
	"config.n_points": "{n} points",
	"config.one_code": "1 discount code",
	"config.with_these": "With these settings",
	"config.summary": "About every {amount} paid gives one {reward} code.",
	"config.example": "Example",
	"config.order_paid": "Order paid {amount}",
	"config.collected": "Points collected",
	"config.gets": "Customer gets a code for {reward}",
	"config.used_up": "{points} are used up. Counting starts again.",
	"config.fill_in": "Answer the three questions to see an example.",

	"till.use": "Use reward: {reward}",
	"till.applied": "Reward applied: {reward}",

	"receipt.earned": "Points earned",
	"receipt.points": "Your points",
	"receipt.of": "{points} of {goal}",
	"receipt.reward": "Your reward: {reward}",
	"receipt.code": "Code: {code}",

	"mail.subject": "Your reward: {reward}",
	"mail.intro": "You collected {goal} points at {shop}. Thank you!",
	"mail.reward": "Your reward: {reward} your next order.",
	"mail.code": "Your code: {code}",
	"mail.how":
		"Tell us the code in the shop, or type it at the checkout of our online store. It works once.",

	"store.title": "Loyalty points",
	"store.reward": "Your reward: {reward}",
	"store.how": "Type the code at the checkout. Each code works once.",

	"search.placeholder": "Search by name or phone",
	"members.none": "No customer has points yet.",
	"members.none_found": "No member found.",
	"members.failed": "Could not load the members: {error}",
	"members.points": "{points} of {goal} points",
	"members.total": "{total} earned in all",
	"members.no_name": "Customer #{id}",
	"members.count": "{count} members",
	"pager.prev": "Previous",
	"pager.next": "Next",
	"pager.page": "Page {page} of {last}",

	"history.title": "Points of {name}",
	"history.none": "Nothing yet.",
	"history.earn": "Order {reference}",
	"history.take": "Order {reference} refunded or voided",
	"history.reward": "Reward: code {code}",
	"history.more": "Show more",
};
