import { computed } from "vue";
import { usePage } from "@inertiajs/vue3";
import type { SharedProps } from "@/types";

/**
 * `isAdmin` / `isManager` for hiding controls (the server enforces the same rules).
 * `isManager` is true for managers and admins.
 */
export function useAuth() {
	const page = usePage<SharedProps>();
	const user = computed(() => page.props.auth.user);
	const isAdmin = computed(() => user.value?.role === "admin");
	const isManager = computed(
		() => isAdmin.value || user.value?.role === "manager",
	);
	return { user, isAdmin, isManager };
}
