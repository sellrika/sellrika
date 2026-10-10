<script setup lang="ts">
import { ref, watch } from "vue";
import { router } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n";

/**
 * The platform admin's self sign-up switch.
 * `enabled` = sign-up is on right now.
 */
const props = defineProps<{ enabled: boolean }>();
const on = ref(props.enabled);
watch(
	() => props.enabled,
	function sync(v) {
		on.value = v;
	},
);

/**
 * Save the new value at once.
 * @param v True = anyone may sign up.
 */
function save(v: boolean) {
	on.value = v;
	router.put(
		"/owners/signup",
		{ enabled: v },
		{
			preserveScroll: true,
			onSuccess() {
				toast.success(t(v ? "register.signup_on" : "register.signup_off"));
			},
		},
	);
}
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="grid gap-1">
      <Label for="signup-switch">{{ t("register.signup_label") }}</Label>
      <p class="text-sm text-muted-foreground">{{ t("register.signup_help") }}</p>
    </div>
    <Switch id="signup-switch" :model-value="on" @update:model-value="save" />
  </div>
</template>
