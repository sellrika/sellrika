<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	Fingerprint,
	KeyRound,
	LoaderCircle,
	Printer,
	Trash2,
	UserRound,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
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
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import MicrosoftConnect from "@/components/MicrosoftConnect.vue";
import WithTooltip from "@/components/WithTooltip.vue";
import type { GoogleConfig } from "@/lib/google";
import { RAWBT_APP, rawbtCols, rawbtOn } from "@/lib/rawbt";
import { t } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { passkeyCreate, passkeysSupported } from "@/lib/passkey";
import type { PasskeyInfo, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	section: string | null;
	/** The user's own passkeys: name and dates only. */
	passkeys: PasskeyInfo[];
	/** The Microsoft section: null = Microsoft sign-in is off. */
	microsoft: { connected: boolean; firebase: GoogleConfig } | null;
}>();

const page = usePage<SharedProps>();

/** Right-hand section rail (deep-linkable via ?section=, e.g. /settings?section=printing). */
const sections = computed(() => [
	{ key: "profile", label: t("settings.profile") },
	{ key: "printing", label: t("settings.printing") },
	{ key: "password", label: t("settings.password") },
	{ key: "passkeys", label: t("settings.passkeys") },
	...(props.microsoft
		? [{ key: "microsoft", label: t("settings.microsoft") }]
		: []),
]);
const section = ref(
	props.section && sections.value.some((s) => s.key === props.section)
		? props.section
		: "profile",
);
watch(section, (s) =>
	history.replaceState(
		null,
		"",
		s === "profile" ? location.pathname : `?section=${s}`,
	),
);

const profile = useForm({ name: page.props.auth.user?.name ?? "" });
const saveProfile = () =>
	profile.put("/settings/profile", {
		onSuccess: () => toast.success(t("settings.name_updated")),
	});

const pw = useForm({
	current_password: "",
	password: "",
	password_confirmation: "",
});
const savePassword = () =>
	pw.put("/settings/password", {
		onSuccess: () => {
			pw.reset();
			toast.success(t("settings.password_changed"));
		},
	});

const pwFields = [
	{
		key: "current_password",
		label: "settings.current_password",
		autocomplete: "current-password",
	},
	{
		key: "password",
		label: "settings.new_password",
		autocomplete: "new-password",
	},
	{
		key: "password_confirmation",
		label: "settings.confirm_password",
		autocomplete: "new-password",
	},
] as const;

/** The "add a passkey" form: the password proves it is really them. */
const passkeyName = ref("");
const passkeyPassword = ref("");
const passkeyErrors = ref<Record<string, string>>({});
const passkeyBusy = ref(false);
const canPasskey = ref(true);

/** Checked after mount: old browsers have no passkeys. */
function detectPasskeys() {
	canPasskey.value = passkeysSupported();
}
onMounted(detectPasskeys);

/**
 * The name shown for a passkey.
 * @param p The passkey.
 * @returns Its name, or "Passkey" when it has none.
 */
function passkeyLabel(p: PasskeyInfo) {
	return p.name || t("settings.passkey_default_name");
}

/**
 * Show the server's errors under the form.
 * @param errors The errors.
 */
function passkeyFailed(errors: Record<string, string>) {
	passkeyErrors.value = errors;
}

/** The new passkey is saved: empty the form. */
function passkeyAdded() {
	passkeyName.value = "";
	passkeyPassword.value = "";
	toast.success(t("settings.passkey_added"));
}

/** The request is over, whatever the answer. */
function passkeyDone() {
	passkeyBusy.value = false;
}

/**
 * Add a passkey: the server checks the password, the device makes the
 * passkey, then it is saved.
 */
async function addPasskey() {
	passkeyErrors.value = {};
	passkeyBusy.value = true;
	const made = await passkeyCreate(passkeyPassword.value).catch(() => null);
	if (!made) return passkeyDone();
	if (made === "exists") {
		passkeyFailed({ passkey: t("settings.passkey_exists") });
		return passkeyDone();
	}
	if ("errors" in made) {
		passkeyFailed(made.errors);
		return passkeyDone();
	}
	router.post(
		"/settings/passkeys",
		{ name: passkeyName.value, ...made.passkey },
		{
			preserveScroll: true,
			onSuccess: passkeyAdded,
			onError: passkeyFailed,
			onFinish: passkeyDone,
		},
	);
}

/** The passkey is gone. */
function passkeyDeleted() {
	toast.success(t("settings.passkey_deleted"));
}

/**
 * Delete one passkey.
 * @param p The passkey.
 */
function removePasskey(p: PasskeyInfo) {
	router.delete(`/settings/passkeys/${p.id}`, {
		preserveScroll: true,
		onSuccess: passkeyDeleted,
	});
}

// Receipt printing is a per-device choice (RawBT must be installed here), so it lives in localStorage.
const paperSizes = [
	{ value: "32", label: "settings.paper_58" },
	{ value: "48", label: "settings.paper_80" },
] as const;

/** The RawBT help line: one sentence with the app's link inside it (fixed text, no user data). */
const rawbtHelp = computed(function help() {
	return t("settings.rawbt_help", {
		link: `<a href="${RAWBT_APP}" target="_blank" rel="noopener" class="underline underline-offset-4">RawBT</a>`,
	});
});
const cols = computed({
	get: () => String(rawbtCols.value),
	set: (v: string) => (rawbtCols.value = Number(v)),
});
</script>

<template>
  <Head :title="t('settings.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">{{ t("settings.title") }}</h1>
      <p class="text-sm text-muted-foreground">{{ page.props.auth.user?.email }}</p>
    </div>

    <div class="flex flex-col gap-6 md:flex-row">
      <!-- content -->
      <div class="order-2 min-w-0 flex-1 md:order-1">
        <Card v-show="section === 'profile'">
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><UserRound class="size-5" /> {{ t("settings.profile") }}</CardTitle>
            <CardDescription>{{ t("settings.profile_desc") }}</CardDescription>
          </CardHeader>
          <CardContent>
            <form class="grid max-w-sm gap-4" @submit.prevent="saveProfile">
              <div class="grid gap-2">
                <Label for="name">{{ t("common.name") }}</Label>
                <Input id="name" v-model="profile.name" autocomplete="name" :aria-invalid="!!profile.errors.name" />
                <p v-if="profile.errors.name" class="text-sm text-destructive">{{ profile.errors.name }}</p>
              </div>
              <Button type="submit" class="w-fit" :disabled="profile.processing || !profile.isDirty">
                <LoaderCircle v-if="profile.processing" class="animate-spin" />
                {{ t("settings.save_name") }}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card v-show="section === 'printing'">
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><Printer class="size-5" /> {{ t("settings.receipt_printing") }}</CardTitle>
            <CardDescription>{{ t("settings.printing_desc") }}</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4">
            <div class="flex items-start justify-between gap-4">
              <div class="grid gap-1">
                <Label for="rawbt">{{ t("settings.rawbt_label") }}</Label>
                <!-- one fixed sentence with the RawBT link inside it — no user data goes in here -->
                <p class="text-sm text-muted-foreground" v-html="rawbtHelp" />
              </div>
              <Switch id="rawbt" v-model="rawbtOn" :aria-label="t('settings.rawbt_switch')" />
            </div>
            <div v-if="rawbtOn" class="grid max-w-sm gap-2">
              <Label for="paper">{{ t("settings.paper_width") }}</Label>
              <Select v-model="cols">
                <SelectTrigger id="paper"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="s in paperSizes" :key="s.value" :value="s.value">{{ t(s.label) }}</SelectItem>
                </SelectContent>
              </Select>
              <p class="text-sm text-muted-foreground">{{ t("settings.paper_help") }}</p>
            </div>
          </CardContent>
        </Card>

        <Card v-show="section === 'password'">
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><KeyRound class="size-5" /> {{ t("settings.change_password") }}</CardTitle>
            <CardDescription>{{ t("settings.password_desc") }}</CardDescription>
          </CardHeader>
          <CardContent>
            <form class="grid max-w-sm gap-4" @submit.prevent="savePassword">
              <div v-for="f in pwFields" :key="f.key" class="grid gap-2">
                <Label :for="f.key">{{ t(f.label) }}</Label>
                <Input :id="f.key" v-model="pw[f.key]" type="password" :autocomplete="f.autocomplete" :aria-invalid="!!pw.errors[f.key]" />
                <p v-if="pw.errors[f.key]" class="text-sm text-destructive">{{ pw.errors[f.key] }}</p>
              </div>
              <Button type="submit" class="w-fit" :disabled="pw.processing">
                <LoaderCircle v-if="pw.processing" class="animate-spin" />
                {{ pw.processing ? t("common.saving") : t("settings.update_password") }}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card v-show="section === 'passkeys'">
          <CardHeader>
            <CardTitle class="flex items-center gap-2"><Fingerprint class="size-5" /> {{ t("settings.passkeys") }}</CardTitle>
            <CardDescription>{{ t("settings.passkeys_desc") }}</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-6">
            <ul v-if="passkeys.length" :aria-label="t('settings.passkeys')" class="divide-y rounded-lg border">
              <li v-for="p in passkeys" :key="p.id" class="flex items-center justify-between gap-4 px-3 py-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">{{ passkeyLabel(p) }}</p>
                  <p class="text-sm text-muted-foreground">
                    {{ t("settings.passkey_created", { date: fmtDate(p.created_at, { dateStyle: "medium" }) }) }}
                    ·
                    {{ p.last_used_at ? t("settings.passkey_last_used", { date: fmtDate(p.last_used_at) }) : t("settings.passkey_never_used") }}
                  </p>
                </div>
                <WithTooltip :label="t('settings.passkey_delete', { name: passkeyLabel(p) })">
                  <Button type="button" variant="ghost" size="icon" :aria-label="t('settings.passkey_delete', { name: passkeyLabel(p) })" @click="removePasskey(p)">
                    <Trash2 />
                  </Button>
                </WithTooltip>
              </li>
            </ul>
            <p v-else class="text-sm text-muted-foreground">{{ t("settings.passkeys_empty") }}</p>

            <p v-if="!canPasskey" class="text-sm text-muted-foreground">{{ t("settings.passkey_unsupported") }}</p>
            <form v-else class="grid max-w-sm gap-4" @submit.prevent="addPasskey">
              <div class="grid gap-2">
                <Label for="passkey_name">{{ t("settings.passkey_name") }}</Label>
                <Input id="passkey_name" v-model="passkeyName" maxlength="60" :placeholder="t('settings.passkey_name_placeholder')" />
              </div>
              <div class="grid gap-2">
                <Label for="passkey_password">{{ t("settings.passkey_password") }}</Label>
                <Input id="passkey_password" v-model="passkeyPassword" type="password" autocomplete="current-password" required :aria-invalid="!!passkeyErrors.current_password" />
                <p v-if="passkeyErrors.current_password" class="text-sm text-destructive">{{ passkeyErrors.current_password }}</p>
                <p v-else class="text-sm text-muted-foreground">{{ t("settings.passkey_password_help") }}</p>
              </div>
              <p v-if="passkeyErrors.passkey" role="alert" class="text-sm text-destructive">{{ passkeyErrors.passkey }}</p>
              <Button type="submit" class="w-fit" :disabled="passkeyBusy">
                <LoaderCircle v-if="passkeyBusy" class="animate-spin" />
                {{ t("settings.passkey_add") }}
              </Button>
            </form>
          </CardContent>
        </Card>

        <MicrosoftConnect v-if="microsoft" v-show="section === 'microsoft'" :microsoft="microsoft" />
      </div>

      <!-- section rail: same docs-style hairline as /online-store -->
      <nav :aria-label="t('settings.sections_aria')" class="order-1 shrink-0 md:order-2 md:w-40 md:pt-1">
        <p class="mb-2 hidden text-xs font-medium tracking-widest text-muted-foreground/70 uppercase md:block">{{ t("settings.manage") }}</p>
        <ul class="flex gap-4 overflow-x-auto border-b md:sticky md:top-6 md:flex-col md:gap-0 md:border-b-0 md:border-l">
          <li v-for="s in sections" :key="s.key">
            <button type="button" :aria-current="section === s.key ? 'true' : undefined"
              class="-mb-px block border-b-2 px-1 pb-2 text-sm whitespace-nowrap transition-colors md:-ml-px md:border-b-0 md:border-l-2 md:px-3 md:py-1.5"
              :class="section === s.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
              @click="section = s.key">{{ s.label }}</button>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>
