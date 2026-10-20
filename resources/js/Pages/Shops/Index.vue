<script setup lang="ts">
import { computed } from "vue";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	Plus,
	Pencil,
	Trash2,
	ArrowRightLeft,
	Clock,
	Coins,
	Check,
	Store,
	Copy,
	MailCheck,
	MailWarning,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import ShopLogo from "@/components/ShopLogo.vue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import WithTooltip from "@/components/WithTooltip.vue";
import { t } from "@/lib/i18n";
import type { Shop, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
/** `invite` = the shop just created for a new owner (platform admin): the link, and why the email failed if it did. */
const props = defineProps<{
	shops: Shop[];
	invite?: { email: string; link: string; mail_error: string | null };
}>();

/**
 * Copy the invitation link, for the admin to send it themselves.
 */
async function copyLink() {
	await navigator.clipboard.writeText(props.invite!.link);
	toast.success(t("shops.link_copied"));
}

const page = usePage<SharedProps>();
const currentId = computed(() => page.props.shop?.id);

// create / edit are pages of their own (/shops/create, /shops/:id/edit — Shops/Form.vue)
// The server refuses some deletes (last shop, still has products) with errors.shop — toast it per attempt.
// Watching page.props.errors instead would stay silent on a second identical refusal (the value never changes).
const remove = (s: Shop) =>
	router.delete(`/shops/${s.id}`, {
		onSuccess: () => toast.success(t("shops.deleted", { name: s.name })),
		onError: (errors: Record<string, string>) =>
			toast.error(errors.shop ?? t("shops.delete_failed")),
	});
</script>

<template>
  <Head :title="t('shops.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("shops.title") }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ t("shops.subtitle") }}
          <span v-if="shops.length">{{ t(shops.length === 1 ? "shops.count_one" : "shops.count_other", { count: shops.length }) }}</span>
        </p>
      </div>
      <Button as-child><Link href="/shops/create"><Plus /> {{ t("shops.new") }}</Link></Button>
    </header>

    <Alert v-if="invite" :variant="invite.mail_error ? 'destructive' : 'default'" data-invite>
      <MailWarning v-if="invite.mail_error" />
      <MailCheck v-else />
      <AlertDescription class="grid gap-2">
        <p>{{ invite.mail_error ? t("shops.invite_not_sent", { email: invite.email, reason: invite.mail_error }) : t("shops.invite_sent", { email: invite.email }) }}</p>
        <div class="flex w-full gap-2">
          <Input :model-value="invite.link" readonly :aria-label="t('shops.invite_link')" class="font-mono text-xs" />
          <Button type="button" variant="outline" @click="copyLink"><Copy /> {{ t("common.copy") }}</Button>
        </div>
      </AlertDescription>
    </Alert>

    <div v-if="shops.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="s in shops" :key="s.id"
        class="gap-0 py-0 transition-shadow hover:shadow-md"
        :class="s.id === currentId && 'ring-2 ring-primary'"
      >
        <div class="flex items-start gap-4 p-5">
          <ShopLogo :shop="s" class="size-14 shrink-0 text-2xl" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex items-center gap-2">
              <h2 class="truncate text-base font-semibold">{{ s.name }}</h2>
              <Badge v-if="s.id === currentId" class="shrink-0"><Check /> {{ t("shops.current") }}</Badge>
            </div>
            <dl class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <div class="flex items-center gap-1.5"><dt class="sr-only">{{ t("shops.currency") }}</dt><Coins class="size-3.5" /><dd class="font-medium text-foreground">{{ s.currency }}</dd></div>
              <div class="flex items-center gap-1.5"><dt class="sr-only">{{ t("shops.timezone") }}</dt><Clock class="size-3.5" /><dd class="truncate">{{ s.timezone }}</dd></div>
            </dl>
          </div>
        </div>
        <CardFooter class="justify-between gap-2 py-2">
          <Button v-if="s.id !== currentId" size="sm" variant="outline" @click="router.post(`/shops/${s.id}/switch`)">
            <ArrowRightLeft /> {{ t("shops.switch") }}
          </Button>
          <span v-else class="px-1 text-xs text-muted-foreground">{{ t("shops.selling_here") }}</span>
          <div class="flex gap-1">
            <Button as-child size="sm" variant="ghost"><Link :href="`/shops/${s.id}/edit`" :aria-label="t('shops.edit_aria', { name: s.name })"><Pencil /> {{ t("common.edit") }}</Link></Button>
            <AlertDialog>
              <WithTooltip :label="t('shops.delete_aria', { name: s.name })">
                <AlertDialogTrigger as-child>
                  <Button size="icon-sm" variant="ghost" class="text-destructive hover:text-destructive" :aria-label="t('shops.delete_aria', { name: s.name })">
                    <Trash2 />
                  </Button>
                </AlertDialogTrigger>
              </WithTooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{{ t("shops.delete_title", { name: s.name }) }}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t("shops.delete_desc") }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" @click="remove(s)">{{ t("common.delete") }}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardFooter>
      </Card>
    </div>

    <Card v-else>
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Store class="size-5" />
        </span>
        <p class="font-medium">{{ t("shops.empty_title") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("shops.empty_text") }}</p>
        <Button as-child class="mt-2"><Link href="/shops/create"><Plus /> {{ t("shops.new") }}</Link></Button>
      </CardContent>
    </Card>
  </div>
</template>
