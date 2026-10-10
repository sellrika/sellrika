<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, router, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	BookOpen,
	Bot,
	ChevronRight,
	Copy,
	KeyRound,
	Plus,
	Trash2,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
import { fmtDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ApiKey, Role, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	keys: ApiKey[];
	docs_url: string;
	/** Where AI assistants connect: the MCP server on the shop's own address (the app's while its store is off). */
	mcp_url: string;
}>();

/** How to add the MCP server to Claude Code with a sign-in: the address alone. */
const mcpCommand = computed(function command() {
	return `claude mcp add --transport http sellrika ${props.mcp_url}`;
});

/** The same with a key. The key is typed by the reader, never filled in here. */
const mcpKeyCommand = computed(function command() {
	return `${mcpCommand.value} --header "X-API-Key: srk_…"`;
});

/**
 * Copy a line of the MCP box.
 * @param text The server URL or the command.
 */
async function copyText(text: string) {
	await navigator.clipboard.writeText(text);
	toast.success(t("common.copied"));
}

const page = usePage<SharedProps>();
const ROLES: Role[] = ["admin", "manager", "cashier"];
const roles = computed(function options() {
	return ROLES.map(function option(r) {
		return {
			value: r,
			label: t(`users.role_${r}`),
			hint: t(`api_keys.role_${r}_hint`),
		};
	});
});

/** Is the "Create key" dialog open? */
const creating = ref(false);
/**
 * The key the dialog shows after it was made; "" = the dialog shows the inputs.
 * It lives only here: closing the dialog forgets it, and the server keeps only its hash.
 */
const made = ref("");
const name = ref("");
const role = ref<Role>("manager");
const errors = ref<Record<string, string>>({});
const saving = ref(false);

/** Open the dialog with empty inputs. */
function open() {
	name.value = "";
	role.value = "manager";
	errors.value = {};
	made.value = "";
	creating.value = true;
}

/** Forget the key as soon as the dialog closes. */
watch(creating, function forget(isOpen) {
	if (!isOpen) made.value = "";
});

/**
 * Make the key. The answer is JSON, not a page:
 * a page's props are kept in the browser's history, and the key must not be.
 */
async function add() {
	saving.value = true;
	errors.value = {};
	try {
		const res = await fetch("/api-keys", {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ name: name.value, role: role.value }),
		});
		const data = await res.json();
		if (res.status === 201) {
			made.value = data.token;
			router.reload({ only: ["keys"] });
		} else errors.value = data.errors ?? { name: t("api_keys.failed") };
	} catch {
		errors.value = { name: t("api_keys.failed") };
	} finally {
		saving.value = false;
	}
}

/** Copy the new key, the only time it can be copied. */
async function copyKey() {
	await navigator.clipboard.writeText(made.value);
	toast.success(t("common.copied"));
}

/**
 * Delete a key.
 * @param k The key.
 */
function remove(k: ApiKey) {
	router.delete(`/api-keys/${k.id}`, {
		preserveScroll: true,
		onSuccess: function gone() {
			toast.success(t("api_keys.deleted", { name: k.name }));
		},
	});
}
</script>

<template>
  <Head :title="t('api_keys.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("api_keys.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("api_keys.subtitle", { shop: page.props.shop?.name ?? "" }) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button as-child variant="outline">
          <a :href="docs_url" target="_blank" rel="noopener"><BookOpen /> {{ t("api_keys.docs") }}</a>
        </Button>
        <Button @click="open"><Plus /> {{ t("api_keys.create") }}</Button>
      </div>
    </header>

    <!-- MCP server: the addresses in one row, the how-to folded away -->
    <Card class="gap-0 py-0" role="region" :aria-label="t('api_keys.mcp_title')">
      <div class="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-4">
        <div class="flex shrink-0 items-center gap-2.5">
          <span class="grid size-8 place-items-center rounded-md bg-primary/10 text-primary"><Bot class="size-4" /></span>
          <h2 class="text-sm font-semibold">{{ t("api_keys.mcp_title") }}</h2>
        </div>
        <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-3">
          <code class="min-w-0 flex-1 truncate font-mono text-xs" :title="mcp_url">{{ mcp_url }}</code>
          <Button size="icon-sm" variant="ghost" :aria-label="t('api_keys.mcp_copy_url')" @click="copyText(mcp_url)"><Copy /></Button>
        </div>
      </div>
      <details class="group border-t">
        <summary class="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight class="size-3.5 transition-transform group-open:rotate-90" />
          {{ t("api_keys.mcp_how") }}
        </summary>
        <div class="space-y-4 px-4 pb-4 text-sm text-muted-foreground">
          <p>{{ t("api_keys.mcp_text") }}</p>
          <div class="space-y-1.5">
            <h3 class="text-sm font-medium text-foreground">{{ t("api_keys.mcp_signin_title") }}</h3>
            <p>{{ t("api_keys.mcp_signin_text") }}</p>
            <p class="text-xs font-medium text-foreground">{{ t("api_keys.mcp_example") }}</p>
            <div class="flex items-start gap-2 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-3">
              <code class="min-w-0 flex-1 py-1.5 font-mono text-xs break-all text-foreground">{{ mcpCommand }}</code>
              <Button size="icon-sm" variant="ghost" :aria-label="t('api_keys.mcp_copy_command')" @click="copyText(mcpCommand)"><Copy /></Button>
            </div>
          </div>
          <div class="space-y-1.5">
            <h3 class="text-sm font-medium text-foreground">{{ t("api_keys.mcp_key_title") }}</h3>
            <p>{{ t("api_keys.mcp_key_text") }}</p>
            <p class="text-xs font-medium text-foreground">{{ t("api_keys.mcp_key_example") }}</p>
            <div class="flex items-start gap-2 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-3">
              <code class="min-w-0 flex-1 py-1.5 font-mono text-xs break-all text-foreground">{{ mcpKeyCommand }}</code>
              <Button size="icon-sm" variant="ghost" :aria-label="t('api_keys.mcp_copy_key_command')" @click="copyText(mcpKeyCommand)"><Copy /></Button>
            </div>
          </div>
        </div>
      </details>
    </Card>

    <Card class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("common.name") }}</TableHead>
            <TableHead>{{ t("api_keys.key") }}</TableHead>
            <TableHead class="w-28">{{ t("api_keys.role") }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t("api_keys.last_used") }}</TableHead>
            <TableHead class="hidden lg:table-cell">{{ t("api_keys.created") }}</TableHead>
            <TableHead class="w-16 pr-4 text-right">{{ t("common.actions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="!keys.length">
            <TableCell colspan="6" class="py-10 text-center text-muted-foreground">
              <KeyRound class="mx-auto mb-2 size-6 opacity-50" />
              {{ t("api_keys.empty") }}
            </TableCell>
          </TableRow>
          <TableRow v-for="k in keys" :key="k.id">
            <TableCell class="pl-4 font-medium">{{ k.name }}</TableCell>
            <TableCell class="font-mono text-sm text-muted-foreground">srk_…{{ k.last4 }}</TableCell>
            <TableCell>
              <Badge :variant="k.role === 'admin' ? 'default' : k.role === 'manager' ? 'outline' : 'secondary'">{{ t(`users.role_${k.role}`) }}</Badge>
            </TableCell>
            <TableCell class="hidden text-muted-foreground md:table-cell">{{ k.last_used_at ? fmtDate(k.last_used_at) : t("api_keys.never") }}</TableCell>
            <TableCell class="hidden text-muted-foreground lg:table-cell">
              {{ fmtDate(k.created_at, { dateStyle: "medium" }) }}<template v-if="k.created_by"> · {{ k.created_by }}</template>
            </TableCell>
            <TableCell class="pr-4 text-right">
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <Button size="icon-sm" variant="ghost" :aria-label="t('api_keys.delete_aria', { name: k.name })"><Trash2 class="text-destructive" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{{ t("api_keys.delete_title", { name: k.name }) }}</AlertDialogTitle>
                    <AlertDialogDescription>{{ t("api_keys.delete_desc") }}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" @click="remove(k)">{{ t("common.delete") }}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- Create: the form, then the new key (shown once) -->
    <Dialog v-model:open="creating">
      <DialogContent>
        <template v-if="made">
          <DialogHeader>
            <DialogTitle>{{ t("api_keys.new_title") }}</DialogTitle>
            <DialogDescription>{{ t("api_keys.new_hint") }}</DialogDescription>
          </DialogHeader>
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input :model-value="made" readonly class="font-mono text-sm" :aria-label="t('api_keys.new_title')" @focus="($event.target as HTMLInputElement).select()" />
            <Button type="button" @click="copyKey"><Copy /> {{ t("common.copy") }}</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="creating = false">{{ t("common.done") }}</Button>
          </DialogFooter>
        </template>
        <template v-else>
          <DialogHeader>
            <DialogTitle>{{ t("api_keys.create") }}</DialogTitle>
            <DialogDescription>{{ t("api_keys.create_desc") }}</DialogDescription>
          </DialogHeader>
          <form id="key-create" class="grid gap-4" @submit.prevent="add">
            <div class="grid gap-2">
              <Label for="key-name">{{ t("common.name") }}</Label>
              <Input id="key-name" v-model="name" autofocus :placeholder="t('api_keys.name_placeholder')" :aria-invalid="!!errors.name" />
              <p v-if="errors.name" class="text-sm text-destructive">{{ errors.name }}</p>
            </div>
            <div class="grid gap-2">
              <Label>{{ t("api_keys.role") }}</Label>
              <div class="grid gap-2 sm:grid-cols-3">
                <button v-for="r in roles" :key="r.value" type="button"
                  class="rounded-md border p-3 text-left transition-colors"
                  :class="role === r.value ? 'border-primary bg-primary/5' : 'hover:bg-accent'"
                  :aria-pressed="role === r.value"
                  @click="role = r.value">
                  <span class="text-sm font-medium">{{ r.label }}</span>
                  <span class="block text-xs text-muted-foreground">{{ r.hint }}</span>
                </button>
              </div>
              <p v-if="errors.role" class="text-sm text-destructive">{{ errors.role }}</p>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" @click="creating = false">{{ t("common.cancel") }}</Button>
            <Button type="submit" form="key-create" :disabled="saving || !name.trim()">{{ t("api_keys.create") }}</Button>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </div>
</template>
