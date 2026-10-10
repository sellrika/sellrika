/**
 * The message of something that was thrown.
 * @param error What was caught.
 * @param fallback The text when it is not an Error.
 * Left out = the value as text.
 * @returns One line for the log or for the person.
 */
export function messageOf(error: unknown, fallback?: string): string {
	if (error instanceof Error) return error.message;
	return fallback ?? String(error);
}
