<script setup lang="ts">
import { Head, Link } from "@inertiajs/vue3";
import { SearchX } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
</script>

<template>
  <Head :title="t('nav.notfound_title')" />
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
    <span class="flex size-14 items-center justify-center rounded-full bg-muted"><SearchX class="size-7 text-muted-foreground" /></span>
    <div>
      <h1 class="text-2xl font-semibold">{{ t("nav.notfound_heading") }}</h1>
      <p class="mt-1 text-sm text-muted-foreground">{{ t("nav.notfound_text") }}</p>
    </div>
    <Button as-child variant="outline"><Link href="/pos">{{ t("nav.go_home") }}</Link></Button>
  </div>
</template>
