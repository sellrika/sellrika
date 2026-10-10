<script setup lang="ts">
import { Head, Link, useForm } from "@inertiajs/vue3";
import { LoaderCircle, MailCheck } from "@lucide/vue";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

// ponytail: no layout, like Auth/Login — the person has no session.
/**
 * "Forgot password": ask for the link by email.
 * `sent` = the form was taken. The page says the same for every email,
 * so nobody learns which emails have an account.
 */
defineProps<{ sent: boolean }>();
const form = useForm({ email: "" });
</script>

<template>
  <Head :title="t('forgot.title')" />

  <AuthShell>
    <div v-if="sent" class="flex flex-col items-center text-center" role="status">
      <span class="mb-5 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground ring-8 ring-primary/20">
        <MailCheck class="size-8" aria-hidden="true" />
      </span>
      <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("forgot.sent_title") }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ t("forgot.sent_text", { email: form.email }) }}</p>
    </div>
    <template v-else>
      <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("forgot.title") }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ t("forgot.sub") }}</p>
      <form class="mt-8 grid gap-5" @submit.prevent="form.post('/forgot-password')">
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
        <Button type="submit" size="lg" class="mt-1 h-11 w-full rounded-full" :disabled="form.processing">
          <LoaderCircle v-if="form.processing" class="animate-spin" />
          {{ t("forgot.submit") }}
        </Button>
      </form>
    </template>
    <p class="mt-6 text-center text-sm text-muted-foreground">
      <Link href="/login" class="font-medium text-foreground underline underline-offset-4">{{ t("forgot.back") }}</Link>
    </p>
  </AuthShell>
</template>
