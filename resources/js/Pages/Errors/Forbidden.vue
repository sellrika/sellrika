<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import { ShieldOff } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

defineOptions({ layout: AppLayout });
</script>

<template>
  <Head :title="t('nav.forbidden_title')" />
  <div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
    <span class="flex size-12 items-center justify-center rounded-full bg-muted"><ShieldOff class="size-5 text-muted-foreground" /></span>
    <div>
      <p class="font-medium">{{ t("nav.forbidden_heading") }}</p>
      <p class="text-sm text-muted-foreground">{{ t("nav.forbidden_text") }}</p>
    </div>
    <Button as-child variant="outline"><Link href="/pos">{{ t("nav.back_to_sell") }}</Link></Button>
  </div>
</template>
