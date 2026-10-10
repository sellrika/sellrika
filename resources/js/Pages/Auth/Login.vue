<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Head, Link, router, useForm } from "@inertiajs/vue3";
import { Fingerprint, LoaderCircle } from "@lucide/vue";
import AuthShell from "@/components/AuthShell.vue";
import ProviderButtons from "@/components/ProviderButtons.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import {
	type GoogleConfig,
	type SignedIn,
	type SignInProvider,
	keepForSignup,
	providerSignIn,
} from "@/lib/google";
import { passkeyLogin, passkeysSupported } from "@/lib/passkey";

// ponytail: no layout here on purpose — login is the one page outside the app shell.
/**
 * `signup` = self sign-up is on: show the "Create an account" link.
 * `google` = the Firebase web config: show "Continue with Google".
 * `microsoft` = show "Continue with Microsoft" too.
 * `notice` = a message from the server, like "Your email is confirmed".
 */
const props = defineProps<{
	signup?: boolean;
	google?: GoogleConfig | null;
	microsoft?: boolean;
	notice?: string | null;
}>();
const form = useForm({ email: "", password: "" });

/** The passkey button shows only where the browser can use passkeys. */
const canPasskey = ref(false);
const passkeyBusy = ref(false);
const passkeyError = ref("");

/** Checked after mount: the server has no `window` to ask. */
function detectPasskeys() {
	canPasskey.value = passkeysSupported();
}
onMounted(detectPasskeys);

/**
 * Show why the passkey sign-in did not work.
 * A rate limit answers under `email`, like the password form.
 * @param errors The errors from the server.
 */
function passkeyFailed(errors: Record<string, string>) {
	passkeyError.value = errors.passkey ?? errors.email ?? "";
}

/** The request is over, whatever the answer. */
function passkeyDone() {
	passkeyBusy.value = false;
}

/**
 * Sign in with a passkey: ask the device, then post its answer.
 * Closing the device's dialog does nothing.
 */
async function signInWithPasskey() {
	passkeyError.value = "";
	passkeyBusy.value = true;
	try {
		const answer = await passkeyLogin();
		if (!answer) return passkeyDone();
		router.post("/login/passkey", answer, {
			onError: passkeyFailed,
			onFinish: passkeyDone,
		});
	} catch (e) {
		passkeyError.value = (e as Error).message;
		passkeyDone();
	}
}

/** Which pop-up is open now, and what went wrong per button. */
const signInBusy = ref<SignInProvider | null>(null);
const signInErrors = ref<Record<string, string>>({});

/** The request is over, whatever the answer. */
function signInDone() {
	signInBusy.value = null;
}

/**
 * Sign in with Google or Microsoft: open the pop-up, then post the token.
 * Closing the pop-up does nothing.
 * A rate limit answers under `email`, like the password form.
 * @param via The button pressed.
 */
async function signInWith(via: SignInProvider) {
	if (!props.google) return;
	/**
	 * Show why the sign-in did not work.
	 * @param errors The errors from the server.
	 */
	function failed(errors: Record<string, string>) {
		// nobody has this sign-in yet: go on to the create-shop step
		if (errors.signup && who) {
			keepForSignup(who);
			return router.visit("/register");
		}
		signInErrors.value = { [via]: errors[via] ?? errors.email ?? "" };
	}
	let who: SignedIn | null = null;
	signInErrors.value = {};
	signInBusy.value = via;
	try {
		who = await providerSignIn(props.google, via);
		if (!who) return signInDone();
		router.post(
			`/login/${via}`,
			{ token: who.token },
			{ onError: failed, onFinish: signInDone },
		);
	} catch (e) {
		signInErrors.value = { [via]: (e as Error).message };
		signInDone();
	}
}
</script>

<template>
  <Head :title="t('nav.login_title')" />

  <AuthShell>
        <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("nav.login_heading") }}</h1>
        <p class="mt-1.5 text-sm text-muted-foreground">{{ t("nav.login_sub") }}</p>

        <p v-if="notice" class="mt-6 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">{{ notice }}</p>

        <form class="mt-8 grid gap-5" @submit.prevent="form.post('/login')">
          <div class="grid gap-2">
            <Label for="email">{{ t("common.email") }}</Label>
            <Input
              id="email"
              v-model="form.email"
              type="email"
              autocomplete="username"
              autofocus
              class="h-11"
              :placeholder="t('nav.login_email_placeholder')"
              :aria-invalid="!!form.errors.email"
            />
            <p v-if="form.errors.email" class="text-sm text-destructive">{{ form.errors.email }}</p>
          </div>

          <div class="grid gap-2">
            <Label for="password">{{ t("nav.password") }}</Label>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              class="h-11"
              :aria-invalid="!!form.errors.password"
            />
            <p v-if="form.errors.password" class="text-sm text-destructive">{{ form.errors.password }}</p>
            <!-- under the box, so Tab goes from the email straight to the password -->
            <Link href="/forgot-password" class="justify-self-end text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">{{ t("forgot.link") }}</Link>
          </div>

          <Button type="submit" size="lg" class="mt-1 h-11 w-full rounded-full" :disabled="form.processing">
            <LoaderCircle v-if="form.processing" class="animate-spin" />
            {{ form.processing ? t("nav.login_progress") : t("nav.login_submit") }}
          </Button>
        </form>

        <div v-if="google || canPasskey" class="mt-6 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span class="h-px flex-1 bg-border" />{{ t("nav.login_or") }}<span class="h-px flex-1 bg-border" />
        </div>

        <ProviderButtons v-if="google" class="mt-6" :microsoft="microsoft" :busy="signInBusy" :errors="signInErrors" @pick="signInWith" />

        <template v-if="canPasskey">
          <Button type="button" variant="outline" size="lg" class="mt-3 h-11 w-full rounded-full" :class="{ 'mt-6': !google }" :disabled="passkeyBusy" @click="signInWithPasskey">
            <LoaderCircle v-if="passkeyBusy" class="animate-spin" />
            <Fingerprint v-else />
            {{ t("nav.login_passkey") }}
          </Button>
          <p v-if="passkeyError" role="alert" class="mt-2 text-sm text-destructive">{{ passkeyError }}</p>
        </template>

        <p v-if="signup" class="mt-6 text-center text-sm text-muted-foreground">
          {{ t("nav.login_no_account") }}
          <Link href="/register" class="font-medium text-foreground underline underline-offset-4">{{ t("nav.login_signup") }}</Link>
        </p>
  </AuthShell>
</template>
