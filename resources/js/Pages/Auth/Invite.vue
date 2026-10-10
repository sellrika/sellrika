<script setup lang="ts">
import { Head, Link, useForm, usePage } from "@inertiajs/vue3";
import { LoaderCircle } from "@lucide/vue";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

// ponytail: no layout, like Auth/Login — the person has no session yet.
/** `email` = who the invitation is for; null when the link was used or expired. */
defineProps<{ email: string | null }>();
const form = useForm({ name: "", password: "", password_confirmation: "" });
const path = usePage().url;
</script>

<template>
  <Head :title="t('invite.title')" />

  <AuthShell>
    <template v-if="!email">
      <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("invite.expired_title") }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ t("invite.expired_text") }}</p>
      <Button as-child variant="outline" size="lg" class="mt-8 h-11 w-full rounded-full"><Link href="/login">{{ t("invite.to_login") }}</Link></Button>
    </template>
    <template v-else>
      <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("invite.title") }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ t("invite.sub", { email }) }}</p>
          <form class="mt-8 grid gap-5" @submit.prevent="form.post(path)">
            <div class="grid gap-2">
              <Label for="name">{{ t("common.name") }}</Label>
              <Input id="name" v-model="form.name" autocomplete="name" autofocus class="h-11" :aria-invalid="!!form.errors.name" />
              <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
            </div>
            <div class="grid gap-2">
              <Label for="password">{{ t("settings.new_password") }}</Label>
              <Input id="password" v-model="form.password" type="password" autocomplete="new-password" class="h-11" :aria-invalid="!!form.errors.password" />
              <p v-if="form.errors.password" class="text-sm text-destructive">{{ form.errors.password }}</p>
            </div>
            <div class="grid gap-2">
              <Label for="password_confirmation">{{ t("settings.confirm_password") }}</Label>
              <Input id="password_confirmation" v-model="form.password_confirmation" type="password" autocomplete="new-password" class="h-11" :aria-invalid="!!form.errors.password_confirmation" />
              <p v-if="form.errors.password_confirmation" class="text-sm text-destructive">{{ form.errors.password_confirmation }}</p>
            </div>
            <Button type="submit" size="lg" class="mt-1 h-11 w-full rounded-full" :disabled="form.processing">
              <LoaderCircle v-if="form.processing" class="animate-spin" />
              {{ t("invite.submit") }}
            </Button>
          </form>
    </template>
  </AuthShell>
</template>
