<script setup lang="ts">
import { Head, Link, router, useForm } from "@inertiajs/vue3";
import { LoaderCircle } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import AuthShell from "@/components/AuthShell.vue";
import ProviderButtons from "@/components/ProviderButtons.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CurrencySelect from "@/components/CurrencySelect.vue";
import TimezoneSelect from "@/components/TimezoneSelect.vue";
import {
	type GoogleConfig,
	type SignedIn,
	type SignInProvider,
	providerSignIn,
	takeForSignup,
} from "@/lib/google";
import { t } from "@/lib/i18n";

// ponytail: no layout, like Auth/Login — the person has no session yet.
/**
 * `timezones` = the zones a shop may use.
 * `signup` = an add-on's line over the form, and whether to ask for the terms.
 * `google` = the Firebase web config: offer sign-up with Google.
 * `microsoft` = offer sign-up with Microsoft too.
 */
const props = defineProps<{
	timezones: string[];
	signup: { note: string | null; terms: boolean };
	google?: GoogleConfig | null;
	microsoft?: boolean;
}>();
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const form = useForm({
	name: "",
	email: "",
	password: "",
	password_confirmation: "",
	shop_name: "",
	currency: "THB",
	timezone: props.timezones.includes(browserZone) ? browserZone : "UTC",
});

/** Send the form. */
/**
 * The line about the terms, cut at its two links.
 * The translation decides where `{terms}` and `{privacy}` stand.
 * They open in a new tab, so a half-filled form is not lost.
 */
const agree = computed(function agree() {
	return t("register.agree").split(/(\{terms\}|\{privacy\})/);
});

function submit() {
	if (signedIn.value) return submitProvider();
	form.post("/register", { onError: accountFailed });
}

/**
 * The page has two steps.
 * 1 = who you are: Google, Microsoft, or name + email + password.
 * 2 = your first shop.
 */
const step = ref<1 | 2>(1);

/**
 * Step 1 with a password: check it here, then go on to the shop.
 * The server checks everything again at the end.
 */
function toShop() {
	form.clearErrors();
	if (form.password.length < 8)
		return form.setError("password", t("validation.password_min_8"));
	if (form.password !== form.password_confirmation)
		return form.setError(
			"password_confirmation",
			t("validation.passwords_do_not_match"),
		);
	step.value = 2;
}

/**
 * The server refused the password sign-up.
 * An error on a box of step 1 goes back there, so it can be seen.
 * @param errors The errors from the server.
 */
function accountFailed(errors: Record<string, string>) {
	for (const f of fields) if (errors[f.key]) step.value = 1;
}

/**
 * Go on to the shop for someone who picked their account.
 * The shop name starts from their first name.
 * @param who The person, with their token.
 */
function startShop(who: SignedIn) {
	signedIn.value = who;
	step.value = 2;
	const first = who.name.trim().split(/\s+/)[0];
	if (!form.shop_name && first)
		form.shop_name = t("register.shop_default", { name: first });
}

/**
 * The sign-in page sends a new person here:
 * they already picked their account, so only the shop is left.
 */
function resume() {
	const who = takeForSignup();
	if (who && props.google) startShop(who);
}
onMounted(resume);

/** Back to step 1, whichever way was picked. */
function back() {
	step.value = 1;
	signedIn.value = null;
	providerErrors.value = {};
	form.clearErrors();
}

/** Which pop-up is open now, and what went wrong per button. */
const providerBusy = ref<SignInProvider | null>(null);
const providerErrors = ref<Record<string, string>>({});
/**
 * Who signed in with Google or Microsoft, if anyone.
 * While set, the page asks only for the shop.
 */
const signedIn = ref<SignedIn | null>(null);
/** The provider's name as shown: a brand, not translated. */
const providerName = computed(function providerName() {
	return signedIn.value?.via === "microsoft" ? "Microsoft" : "Google";
});

/**
 * Step 1 of signing up with Google or Microsoft: pick the account.
 * The page then asks only for the shop, with a name filled in.
 * Closing the pop-up does nothing.
 * @param via The button pressed.
 */
async function pickProvider(via: SignInProvider) {
	if (!props.google) return;
	form.clearErrors();
	providerErrors.value = {};
	providerBusy.value = via;
	try {
		const who = await providerSignIn(props.google, via);
		if (!who) return;
		startShop(who);
	} catch (e) {
		providerErrors.value = { [via]: (e as Error).message };
	} finally {
		providerBusy.value = null;
	}
}

/**
 * Show the server's errors of step 2: the shop's under their boxes,
 * the rest under the "signed in as" line.
 * @param errors The errors from the server.
 */
function providerFailed(errors: Record<string, string>) {
	form.setError(errors);
	providerErrors.value = { provider: errors.provider ?? errors.token ?? "" };
}

/** The request is over, whatever the answer. */
function providerDone() {
	form.processing = false;
}

/**
 * Step 2: create the account and the shop.
 * The name and email come from the provider, and there is no password.
 */
function submitProvider() {
	const who = signedIn.value;
	if (!who) return;
	form.clearErrors();
	providerErrors.value = {};
	form.processing = true;
	const { shop_name, currency, timezone } = form;
	router.post(
		`/register/${who.via}`,
		{ token: who.token, shop_name, currency, timezone },
		{ onError: providerFailed, onFinish: providerDone },
	);
}

/** The account's text boxes, in order. */
const fields = [
	{ key: "name", label: "common.name", type: "text", autocomplete: "name" },
	{ key: "email", label: "common.email", type: "email", autocomplete: "email" },
	{
		key: "password",
		label: "register.password",
		type: "password",
		autocomplete: "new-password",
	},
	{
		key: "password_confirmation",
		label: "register.confirm_password",
		type: "password",
		autocomplete: "new-password",
	},
] as const;
</script>

<template>
  <Head :title="t('register.title')" />

  <AuthShell wide>
    <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("register.title") }}</h1>
    <p class="mt-1.5 text-sm text-muted-foreground">{{ t("register.sub") }}</p>
    <p v-if="signup.note" class="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium">{{ signup.note }}</p>

          <!-- step 1: who you are -->
          <template v-if="step === 1">
            <template v-if="google">
              <ProviderButtons class="mt-8" :microsoft="microsoft" :busy="providerBusy" :errors="providerErrors" @pick="pickProvider" />
              <div class="mt-6 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                <span class="h-px flex-1 bg-border" />{{ t("nav.login_or") }}<span class="h-px flex-1 bg-border" />
              </div>
            </template>
            <form class="grid gap-5" :class="google ? 'mt-6' : 'mt-8'" @submit.prevent="toShop">
              <div v-for="f in fields" :key="f.key" class="grid gap-2">
                <Label :for="f.key">{{ t(f.label) }}</Label>
                <Input :id="f.key" v-model="form[f.key]" :type="f.type" :autocomplete="f.autocomplete" required class="h-11" :aria-invalid="!!form.errors[f.key]" />
                <p v-if="form.errors[f.key]" class="text-sm text-destructive">{{ form.errors[f.key] }}</p>
              </div>
              <Button type="submit" size="lg" class="mt-1 h-11 w-full rounded-full">{{ t("common.continue") }}</Button>
            </form>
          </template>

          <!-- step 2: the first shop -->
          <template v-else>
            <div class="mt-8 rounded-lg border px-3 py-2.5 text-sm">
              <p v-if="signedIn" class="font-medium">{{ t("register.provider_as", { provider: providerName }) }}</p>
              <p class="truncate" :class="signedIn ? 'text-muted-foreground' : 'font-medium'">{{ signedIn ? signedIn.name : form.name }}</p>
              <p class="truncate text-muted-foreground">{{ signedIn ? signedIn.email : form.email }}</p>
              <button type="button" class="mt-1 text-sm underline underline-offset-4" @click="back">{{ signedIn ? t("register.provider_change") : t("common.back") }}</button>
              <p v-if="providerErrors.provider" role="alert" class="mt-2 text-destructive">{{ providerErrors.provider }}</p>
            </div>

          <form class="mt-6 grid gap-5" @submit.prevent="submit">
            <h2 class="font-bricolage text-[19px] leading-none font-bold tracking-[-0.01em]">{{ t("register.shop_heading") }}</h2>
            <div class="grid gap-2">
              <Label for="shop_name">{{ t("register.shop_name") }}</Label>
              <Input id="shop_name" v-model="form.shop_name" autocomplete="organization" class="h-11" :aria-invalid="!!form.errors.shop_name" />
              <p v-if="form.errors.shop_name" class="text-sm text-destructive">{{ form.errors.shop_name }}</p>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label for="currency">{{ t("shops.currency") }}</Label>
                <CurrencySelect id="currency" v-model="form.currency" :invalid="!!form.errors.currency" />
                <p v-if="form.errors.currency" class="text-sm text-destructive">{{ form.errors.currency }}</p>
              </div>
              <div class="grid gap-2">
                <Label for="timezone">{{ t("shops.timezone") }}</Label>
                <TimezoneSelect id="timezone" v-model="form.timezone" :zones="timezones" :invalid="!!form.errors.timezone" />
                <p v-if="form.errors.timezone" class="text-sm text-destructive">{{ form.errors.timezone }}</p>
              </div>
            </div>

            <Button type="submit" size="lg" class="mt-1 h-11 w-full rounded-full" :disabled="form.processing">
              <LoaderCircle v-if="form.processing" class="animate-spin" />
              {{ t("register.submit") }}
            </Button>
          </form>
          </template>

          <p v-if="signup.terms" class="mt-4 text-center text-xs text-muted-foreground">
            <template v-for="part in agree" :key="part">
              <a v-if="part === '{terms}'" href="/terms" target="_blank" class="underline underline-offset-4">{{ t("legal.terms") }}</a>
              <a v-else-if="part === '{privacy}'" href="/privacy" target="_blank" class="underline underline-offset-4">{{ t("legal.privacy") }}</a>
              <template v-else>{{ part }}</template>
            </template>
          </p>
          <p class="mt-6 text-center text-sm text-muted-foreground">
            {{ t("register.have_account") }}
            <Link href="/login" class="font-medium text-foreground underline underline-offset-4">{{ t("nav.login_submit") }}</Link>
          </p>
  </AuthShell>
</template>
