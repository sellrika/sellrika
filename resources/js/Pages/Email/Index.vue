<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Check, ExternalLink, LoaderCircle, Mail, Send } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { t } from "@/lib/i18n";
import type { MailSettings, MailerInfo, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
/**
 * One mail setup.
 * `/email` = the platform's (the platform admin only): a sender domain.
 * `/shop-email` = the active shop's own (`shop_mail` set): a sender address; without it the shop sends through the platform's.
 * Not named `shop`: that is the shared active shop, whose logo the sidebar shows.
 */
const props = defineProps<{
	mail: MailSettings;
	mailers: MailerInfo[];
	shop_mail: { name: string; fallback: string | null } | null;
}>();

/** The page's URL: PUT saves here, POST `<url>/test` sends the test. */
const url = props.shop_mail ? "/shop-email" : "/email";

/** A shop can test even without its own setup: then the test goes out the platform's way. */
const canTest = computed(function canTest() {
	return props.mail.configured || !!props.shop_mail?.fallback;
});

const page = usePage<SharedProps>();

/**
 * Every provider's credentials are saved; `driver` is the one switched on ("" = nothing delivers).
 * Secret fields arrive blank; blank on save = keep the stored one.
 */
const mailForm = useForm({
	driver: props.mail.driver ?? "",
	from_email: props.mail.from_email ?? "",
	credentials: Object.fromEntries(
		props.mailers.map((m) => [
			m.key,
			{ ...(props.mail.credentials[m.key] ?? {}) },
		]),
	) as Record<string, Record<string, string>>,
});

/**
 * Whether a secret field already has a stored value.
 * @param key The provider key.
 * @param field The field name.
 * @returns True when a value is stored.
 */
function mailSet(key: string, field: string) {
	return !!props.mail.secret_set[key]?.[field];
}

/**
 * Delivery is exclusive: switching one on switches the other off.
 * @param key The provider key.
 * @param v The picked value, "enabled" or "disabled".
 */
function setDelivery(key: string, v: unknown) {
	if (v === "enabled") mailForm.driver = key;
	else if (mailForm.driver === key) mailForm.driver = "";
}

/**
 * Save the sender and every provider; clear the typed secrets after.
 */
function saveMail() {
	mailForm.put(url, {
		onSuccess() {
			for (const m of props.mailers)
				for (const f of m.fields)
					if (f.secret) mailForm.credentials[m.key]![f.name] = "";
			toast.success(t("settings.email_saved"));
		},
	});
}

// "Send test" opens a dialog asking where to send it, prefilled with the signed-in admin.
const testOpen = ref(false);
const testForm = useForm({ to: page.props.auth.user?.email ?? "" });
watch(testOpen, function clearOnOpen(o) {
	if (o) testForm.clearErrors();
});
const enabledMailer = computed(function enabled() {
	return props.mailers.find((m) => m.key === props.mail.driver);
});

/**
 * Send one test message to the typed address.
 */
function sendTest() {
	testForm.post(`${url}/test`, {
		onSuccess() {
			testOpen.value = false;
			toast.success(t("settings.test_sent"));
		},
	});
}
</script>

<template>
  <Head :title="t(shop_mail ? 'nav.shop_email' : 'nav.outgoing_email')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ shop_mail ? `${t("nav.shop_email")} · ${shop_mail.name}` : t("nav.outgoing_email") }}</h1>

    <!-- one sender, one card per provider (app/mail) -->
    <form class="space-y-6" @submit.prevent="saveMail">
      <Card>
        <CardHeader class="flex flex-row items-start justify-between gap-4 space-y-0">
          <div class="grid gap-1.5">
            <CardTitle class="flex items-center gap-2"><Mail class="size-5" /> {{ t("settings.sender") }}</CardTitle>
            <CardDescription>{{ t(shop_mail ? "settings.shop_sender_desc" : "settings.sender_desc") }}</CardDescription>
          </div>
          <Dialog v-model:open="testOpen">
            <DialogTrigger as-child>
              <Button type="button" variant="outline" size="sm" :disabled="!canTest">
                <Send class="size-4" /> {{ t("settings.send_test") }}
              </Button>
            </DialogTrigger>
            <DialogContent class="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{{ t("settings.send_test_title") }}</DialogTitle>
                <DialogDescription>
                  {{ t("settings.send_test_desc", { provider: enabledMailer?.label ?? t("settings.enabled_provider") }) }}
                </DialogDescription>
              </DialogHeader>
              <form id="test-mail-form" class="grid gap-2" @submit.prevent="sendTest">
                <Label for="test_to">{{ t("settings.test_to") }}</Label>
                <Input id="test_to" v-model="testForm.to" type="email" :placeholder="t('settings.test_to_placeholder')" autocomplete="off" :aria-invalid="!!testForm.errors.to" />
                <p v-if="testForm.errors.to" class="text-sm text-destructive">{{ testForm.errors.to }}</p>
              </form>
              <DialogFooter>
                <Button type="button" variant="outline" @click="testOpen = false">{{ t("common.cancel") }}</Button>
                <Button type="submit" form="test-mail-form" :disabled="testForm.processing">
                  <LoaderCircle v-if="testForm.processing" class="animate-spin" />
                  {{ t("settings.send_test") }}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="from_email">{{ t("settings.from_email") }}</Label>
            <Input id="from_email" v-model="mailForm.from_email" type="email" :placeholder="t('settings.from_email_placeholder')" autocomplete="off" :aria-invalid="!!mailForm.errors.from_email" />
            <p v-if="mailForm.errors.from_email" class="text-sm text-destructive">{{ mailForm.errors.from_email }}</p>
          </div>
          <p v-if="!shop_mail" class="text-sm text-muted-foreground sm:col-span-2">
            {{ t("settings.from_address_help", { address: mailForm.from_email || "noreply@example.com" }) }}
          </p>
          <p v-if="mailForm.errors.driver" class="text-sm text-destructive sm:col-span-2">{{ mailForm.errors.driver }}</p>
          <p v-if="shop_mail && !mail.configured" class="text-sm text-muted-foreground sm:col-span-2">
            {{ shop_mail.fallback ? t("settings.shop_fallback", { address: shop_mail.fallback }) : t("settings.shop_fallback_off") }}
          </p>
          <p v-else-if="!mail.configured" class="text-sm text-muted-foreground sm:col-span-2">{{ t("settings.mail_not_configured") }}</p>
        </CardContent>
      </Card>

      <!-- the provider that delivers gets the same active ring as the current shop on /shops -->
      <Card v-for="m in mailers" :key="m.key" :class="mailForm.driver === m.key && 'ring-2 ring-primary'">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            {{ m.label }}
            <Badge v-if="mailForm.driver === m.key" class="shrink-0"><Check /> {{ t("settings.delivering") }}</Badge>
          </CardTitle>
          <CardDescription>
            <template v-if="m.help_url">
              {{ t("settings.mail_get_key") }}
              <a :href="m.help_url" target="_blank" rel="noopener" class="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:opacity-80">
                {{ t("settings.mail_dashboard", { name: m.label }) }} <ExternalLink class="size-3" /></a>.
            </template>
            {{ t("settings.mail_secrets") }}
            <p v-if="m.note" class="mt-2 text-amber-700 dark:text-amber-400">{{ m.note }}</p>
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-4 sm:grid-cols-2">
          <div class="grid max-w-xs gap-2 sm:col-span-2">
            <Label :for="`${m.key}-delivery`">{{ t("settings.mail_delivery", { name: m.label }) }}</Label>
            <Select :model-value="mailForm.driver === m.key ? 'enabled' : 'disabled'" @update:model-value="setDelivery(m.key, $event)">
              <SelectTrigger :id="`${m.key}-delivery`"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">{{ t("settings.enabled") }}</SelectItem>
                <SelectItem value="disabled">{{ t("settings.disabled") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-for="f in m.fields" :key="f.name" class="grid gap-2">
            <div class="flex items-center gap-2">
              <Label :for="`${m.key}-${f.name}`">{{ f.label }}</Label>
              <Badge v-if="f.secret && mailSet(m.key, f.name)" variant="outline" class="border-emerald-300 text-emerald-700 dark:text-emerald-400">{{ t("common.saved") }}</Badge>
            </div>
            <Input :id="`${m.key}-${f.name}`" v-model="mailForm.credentials[m.key]![f.name]" :type="f.secret ? 'password' : 'text'"
              :placeholder="f.secret && mailSet(m.key, f.name) ? t('settings.secret_blank') : f.placeholder"
              autocomplete="off" :aria-invalid="!!mailForm.errors[`credentials.${m.key}.${f.name}`]" />
            <p v-if="mailForm.errors[`credentials.${m.key}.${f.name}`]" class="text-sm text-destructive">{{ mailForm.errors[`credentials.${m.key}.${f.name}`] }}</p>
          </div>
        </CardContent>
      </Card>

      <div class="flex justify-end">
        <Button type="submit" :disabled="mailForm.processing">
          <LoaderCircle v-if="mailForm.processing" class="animate-spin" />
          {{ t("settings.save_email") }}
        </Button>
      </div>
    </form>
  </div>
</template>
