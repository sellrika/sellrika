import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names. A later Tailwind class wins over an earlier one.
 * @param inputs Class names, lists or `{ class: condition }` objects.
 * @returns One class string.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
