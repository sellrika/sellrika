<script setup lang="ts">
import { ref } from "vue";
import { router } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { LoaderCircle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type GoogleConfig, providerSignIn } from "@/lib/google";
import { t } from "@/lib/i18n";

/**
 * The Microsoft section of /settings.
 * Connect a Microsoft account, so "Continue with Microsoft" signs you in.
 * `connected` = one is connected now.
 * `firebase` = the Firebase web config that opens Microsoft's pop-up.
 */
const props = defineProps<{
	microsoft: { connected: boolean; firebase: GoogleConfig };
}>();

/** The password proves it is really them. */
const password = ref("");
const errors = ref<Record<string, string>>({});
const busy = ref(false);

/**
 * Show why connecting did not work.
 * @param found The errors from the server.
 */
function failed(found: Record<string, string>) {
	errors.value = found;
}

/** The account is connected: empty the form. */
function connected() {
	password.value = "";
	toast.success(t("settings.microsoft_connected_toast"));
}

/** The request is over, whatever the answer. */
function done() {
	busy.value = false;
}

/**
 * Connect: pick the Microsoft account in its pop-up,
 * then the server checks the password and saves it.
 * Closing the pop-up does nothing.
 */
async function connect() {
	errors.value = {};
	busy.value = true;
	try {
		const who = await providerSignIn(props.microsoft.firebase, "microsoft");
		if (!who) return done();
		router.post(
			"/settings/microsoft",
			{ token: who.token, current_password: password.value },
			{
				preserveScroll: true,
				onError: failed,
				onSuccess: connected,
				onFinish: done,
			},
		);
	} catch (e) {
		errors.value = { microsoft: (e as Error).message };
		done();
	}
}

/** The account is taken off. */
function disconnected() {
	toast.success(t("settings.microsoft_disconnected_toast"));
}

/** Take the Microsoft account off. */
function disconnect() {
	router.delete("/settings/microsoft", {
		preserveScroll: true,
		onSuccess: disconnected,
	});
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <svg viewBox="0 0 23 23" class="size-5" aria-hidden="true">
          <path fill="#f25022" d="M1 1h10v10H1z" />
          <path fill="#7fba00" d="M12 1h10v10H12z" />
          <path fill="#00a4ef" d="M1 12h10v10H1z" />
          <path fill="#ffb900" d="M12 12h10v10H12z" />
        </svg>
        {{ t("settings.microsoft") }}
      </CardTitle>
      <CardDescription>{{ t("settings.microsoft_desc") }}</CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="microsoft.connected" class="grid max-w-sm gap-3">
        <p class="text-sm">{{ t("settings.microsoft_connected") }}</p>
        <Button type="button" variant="outline" class="w-fit" @click="disconnect">{{ t("settings.microsoft_disconnect") }}</Button>
        <p class="text-sm text-muted-foreground">{{ t("settings.microsoft_disconnect_help") }}</p>
      </div>
      <form v-else class="grid max-w-sm gap-4" @submit.prevent="connect">
        <div class="grid gap-2">
          <Label for="microsoft_password">{{ t("settings.microsoft_password") }}</Label>
          <Input id="microsoft_password" v-model="password" type="password" autocomplete="current-password" required :aria-invalid="!!errors.current_password" />
          <p v-if="errors.current_password" class="text-sm text-destructive">{{ errors.current_password }}</p>
          <p v-else class="text-sm text-muted-foreground">{{ t("settings.microsoft_password_help") }}</p>
        </div>
        <p v-if="errors.microsoft || errors.token" role="alert" class="text-sm text-destructive">{{ errors.microsoft || errors.token }}</p>
        <Button type="submit" class="w-fit" :disabled="busy">
          <LoaderCircle v-if="busy" class="animate-spin" />
          {{ t("settings.microsoft_connect") }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
