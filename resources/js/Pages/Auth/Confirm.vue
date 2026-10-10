<script setup lang="ts">
import { Head, router, useForm } from "@inertiajs/vue3";
import {
	CircleAlert,
	CircleCheck,
	LoaderCircle,
	LogOut,
	MailCheck,
} from "@lucide/vue";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

// ponytail: no layout, like Auth/Login — nothing in the app works until the email is confirmed.
/**
 * Shown on every app page while a new owner has not confirmed their email.
 * `email` = where the link went, `resent` = a new link just went out,
 * `error` = why it did not (or why the opened link no longer works).
 */
defineProps<{ email: string; resent?: boolean; error?: string | null }>();
const form = useForm({});

/** Email a new link. */
function resend() {
	form.post("/confirm/resend");
}

/** Sign out, e.g. to use another account. */
function logout() {
	router.post("/logout");
}
</script>

<template>
  <Head :title="t('confirm.title')" />

  <AuthShell>
    <div class="flex flex-col items-center text-center">
          <span class="mb-5 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground ring-8 ring-primary/20">
            <MailCheck class="size-8" />
          </span>
          <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("confirm.title") }}</h1>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ t("confirm.body", { email }) }}
          </p>

          <p v-if="resent" class="mt-5 flex w-full items-start gap-2 rounded-md bg-muted px-3 py-2 text-left text-sm">
            <CircleCheck class="mt-0.5 size-4 shrink-0" />
            {{ t("confirm.resent") }}
          </p>
          <p v-if="error" class="mt-5 flex w-full items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            <CircleAlert class="mt-0.5 size-4 shrink-0" />
            {{ error }}
          </p>

          <Button size="lg" class="mt-6 h-11 w-full rounded-full" :disabled="form.processing" @click="resend">
            <LoaderCircle v-if="form.processing" class="animate-spin" />
            {{ t("confirm.resend") }}
          </Button>
          <p class="mt-3 text-xs text-muted-foreground">{{ t("confirm.help") }}</p>

          <Button variant="ghost" size="sm" class="mt-6 text-muted-foreground" @click="logout">
            <LogOut class="size-4" /> {{ t("nav.logout") }}
          </Button>
    </div>
  </AuthShell>
</template>
