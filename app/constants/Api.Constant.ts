/** The public REST API (`/api/v1`) and its keys. */

/** Where every API route starts. A breaking change gets a new number. */
export const API_PREFIX = "/api/v1";

/** The OpenAPI file. */
export const API_SPEC_PATH = `${API_PREFIX}/openapi.json`;

/**
 * Where the developer documentation is: the API reference
 * and the guide for extension authors.
 * It is not part of the source-available app.
 * An add-on that brings its own pages names them in `Hooks.docs`.
 */
export const DOCS_URL = "https://developer.sellrika.com";

/**
 * What every key starts with.
 * A leaked key is then easy to spot in a log or a repository.
 */
export const API_KEY_PREFIX = "srk_";

/** Random bytes in a key: 32 bytes = 256 bits, far too many to guess. */
export const API_KEY_BYTES = 32;

/** Keys one shop may have. */
export const API_KEY_MAX = 20;

/**
 * `api_keys.last_used_at` is written at most this often per key.
 * So a busy key costs no write per call.
 */
export const API_KEY_SEEN_EVERY_MS = 60_000;

/** Rows per page of an API list when the caller names none. */
export const API_PER_PAGE = 20;

/** The name the API docs show. */
export const API_TITLE = "Sellrika REST API";

/** The version the API docs show. */
export const API_VERSION = "1.0.0";

/**
 * The first text of the API docs.
 * Markdown and English: it is a reference for programmers.
 */
export const API_DESCRIPTION = `Read and change the data of one shop from your own program.

## Keys

Make a key in the app: **Settings › MCP & API keys**. A key works in one shop. It is shown once, so save it.

Send it with every call:

\`\`\`
Authorization: Bearer srk_…
\`\`\`

A key has a role: \`cashier\`, \`manager\` or \`admin\`. Each route says the role it needs.

## Rules

- **Money is whole cents.** \`450\` is 4.50 in the shop's currency.
- **Times are UTC.** Days (\`YYYY-MM-DD\`) are days on the shop's clock.
- **Bodies are JSON.** Send \`Content-Type: application/json\`.
- **Lists are paged**: \`?page=1&per_page=20\` (at most 100). The answer is \`{ data, total, page, per_page, last_page }\`.
- **An edit (\`PUT\`) takes the whole record**, the same fields as a create.

## Errors

Every failed call answers with the same shape:

\`\`\`json
{
  "error": {
    "type": "validation_error",
    "message": "Name is required",
    "fields": {
      "name": "Name is required"
    }
  }
}
\`\`\`

| Status | \`type\` | Meaning |
|---|---|---|
| 401 | \`unauthorized\` | The key is missing or wrong |
| 403 | \`forbidden\` | The key's role may not do this |
| 404 | \`not_found\` | No such record in this shop |
| 422 | \`validation_error\` | The input was refused; \`fields\` says why |
| 429 | \`rate_limited\` | Too many calls; wait \`Retry-After\` seconds |

## Limits

600 calls per minute per key.

## MCP

Every route here is also a tool of an **MCP server**, for AI assistants. It uses the same keys and the same roles.

- URL: \`{mcp_url}\`

There are two ways to connect.

**1. Sign in (OAuth 2.0), no key needed.** Give the assistant only the URL. It opens a page where an admin of the shop picks a role and allows it. The assistant then gets a key of its own. For example, in Claude Code:

\`\`\`
claude mcp add --transport http sellrika {mcp_url}
\`\`\`

**2. With a key.** The key goes in its own header, with no \`Bearer\` in front: \`X-API-Key: srk_…\`. For example, in Claude Code:

\`\`\`
claude mcp add --transport http sellrika {mcp_url} --header "X-API-Key: srk_…"
\`\`\`

A tool call counts as two calls against the limit.`;

/**
 * The MCP server: the same API as tools an AI assistant can call.
 * It takes the same keys.
 * One endpoint (MCP "Streamable HTTP").
 * It answers plain JSON and keeps no session.
 */
export const MCP_PATH = "/mcp";

/** The name of the MCP server. */
export const MCP_SERVER_NAME = "sellrika";

/** The name a client shows to people. */
export const MCP_SERVER_TITLE = "Sellrika";

/** The header an MCP client sends its key in: the key alone, no `Bearer`. */
export const MCP_KEY_HEADER = "x-api-key";

/** The most JSON-RPC messages one `POST /mcp` may carry. */
export const MCP_BATCH_MAX = 20;

/**
 * The MCP protocol versions this server speaks, newest first.
 * A client that asks for another one is offered the newest.
 */
export const MCP_PROTOCOL_VERSIONS = [
	"2025-11-25",
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
] as const;

/** What an assistant is told once, when it connects. */
export const MCP_INSTRUCTIONS =
	"Tools for one shop of the Sellrika POS. Money is whole cents (450 = 4.50 in the shop's currency). Times are UTC; days (YYYY-MM-DD) are on the shop's clock. Lists are paged with page and per_page. An update takes the whole record, the same fields as a create. Call who_am_i first to see the shop and the key's role. When the person asks how to do something in the app, call read_user_guide and answer from it. An extension the shop runs may add its own tools (named with the extension's key in front) and its own guide topic.";

/** The sections of the API docs, in the order they are shown. */
export const API_TAGS = [
	{ name: "Account", description: "Check a key." },
	{
		name: "Products",
		description:
			"The catalogue. A product with variants is sold as a variant. A package (`kind: bundle`) is made of other products.",
	},
	{ name: "Categories", description: "How products are grouped." },
	{
		name: "Stock",
		description:
			"Counts of tracked products. Every change is a row in the ledger; a count is never edited in place.",
	},
	{
		name: "Orders",
		description:
			"Sales. An order is created, then paid, moved along, refunded or voided. It is never deleted.",
	},
	{ name: "Coupons", description: "Discount codes, one per order." },
	{
		name: "Payment methods",
		description: "What the till offers. An order keeps the method's name.",
	},
	{
		name: "Staff",
		description: "The people who can sign in. Read only.",
	},
	{
		name: "Sales staff",
		description: "People named on a sale, with a commission and no login.",
	},
	{
		name: "Marketing",
		description: "Email campaigns and the abandoned-cart email.",
	},
	{ name: "Reports", description: "Sales numbers for a period." },
];

/**
 * How many built OpenAPI documents are kept in memory, one per origin.
 * The origin comes from the request's host, which a caller can make up.
 * So when the list is full it is emptied.
 */
export const OPENAPI_CACHE_MAX = 50;
