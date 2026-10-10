<script setup lang="ts">
import { ref } from "vue";
import { Head, router, useForm } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	BookOpen,
	ChevronDown,
	Link2,
	LoaderCircle,
	Plus,
	Puzzle,
	Trash2,
	Upload,
	Users,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChipPicker from "@/components/ChipPicker.vue";
import { t } from "@/lib/i18n";
import type { PlatformExtensionRow } from "@/types";

defineOptions({ layout: AppLayout });
defineProps<{
	extensions: PlatformExtensionRow[];
	/** The guide for extension authors. */
	guide_url: string;
}>();

/** Where every form of this page goes. */
const BASE = "/admin/extensions";

// Upload zip: the file input is hidden behind the menu item; picking a file sends it at once (multipart).
const picker = ref<HTMLInputElement | null>(null);
const upload = useForm({ file: null as File | null });
// Add from URL: a small dialog with the link to a zip, which the server downloads.
const urlOpen = ref(false);
const link = useForm({ url: "" });
// errors of the switch and of Delete (`errors.key`)
const rowErrors = ref<Record<string, string>>({});
// "Available to": the extension being edited and the users picked for it ([] = every user)
const usersFor = ref<PlatformExtensionRow | null>(null);
const usersForm = useForm({ users: [] as string[] });

/**
 * Open the "Available to" dialog of one extension.
 * @param e The extension.
 */
function editUsers(e: PlatformExtensionRow) {
	usersForm.clearErrors();
	usersForm.users = [...e.users];
	usersFor.value = e;
}

/**
 * Users to offer in the picker: owners by name or email, from the server.
 * @param q What was typed.
 * @returns Their emails, and whether more match.
 */
async function findUsers(q: string) {
	const res = await fetch(`${BASE}/users?q=${encodeURIComponent(q)}`, {
		headers: { Accept: "application/json" },
	});
	return res.ok
		? ((await res.json()) as { places: string[]; more: boolean })
		: { places: [], more: false };
}

/**
 * Save who may use the extension being edited.
 */
function saveUsers() {
	const e = usersFor.value!;
	usersForm.put(`${BASE}/${e.key}/users`, {
		preserveScroll: true,
		onSuccess() {
			usersFor.value = null;
			toast.success(t("global_extensions.users_saved", { name: e.name }));
		},
	});
}

/**
 * Send the zip the admin picked.
 * @param e The file input's change event.
 */
function pick(e: Event) {
	const f = (e.target as HTMLInputElement).files?.[0];
	if (!f) return;
	upload.file = f;
	upload.post(BASE, {
		forceFormData: true,
		preserveScroll: true,
		onSuccess: added,
		onFinish: clearPicker,
	});
}

/** Empty the file input, so the same file can be picked again. */
function clearPicker() {
	upload.file = null;
	if (picker.value) picker.value.value = "";
}

/** Add the zip behind the link (the server downloads it). */
function fromUrl() {
	link.post(BASE, { preserveScroll: true, onSuccess: linked });
}

/** The link was added: close the dialog. */
function linked() {
	urlOpen.value = false;
	link.reset();
	added();
}

/** Say the extension was added. */
function added() {
	toast.success(t("global_extensions.added_toast"));
}

/** Open the file picker. */
function openPicker() {
	picker.value?.click();
}

/** Open the link dialog. */
function openUrl() {
	urlOpen.value = true;
}

/**
 * The "Enabled for all shops" switch.
 * @param e The extension.
 * @param on The new state.
 */
function toggle(e: PlatformExtensionRow, on: boolean) {
	router.put(
		`${BASE}/${e.key}`,
		{ enabled: on },
		{
			preserveScroll: true,
			onSuccess() {
				toast.success(
					t(on ? "global_extensions.on_toast" : "global_extensions.off_toast", {
						name: e.name,
					}),
				);
			},
			onError(errors) {
				rowErrors.value = errors;
			},
		},
	);
}

/**
 * Delete an uploaded extension's code, after asking.
 * @param e The extension.
 */
function remove(e: PlatformExtensionRow) {
	if (!confirm(t("global_extensions.delete_confirm", { name: e.name }))) return;
	router.delete(`${BASE}/${e.key}`, {
		preserveScroll: true,
		onSuccess() {
			toast.success(t("global_extensions.deleted_toast", { name: e.name }));
		},
		onError(errors) {
			rowErrors.value = errors;
		},
	});
}
</script>

<template>
  <Head :title="t('global_extensions.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Puzzle class="size-6" /> {{ t("global_extensions.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("global_extensions.subtitle") }}</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- a plain link: the guide is a page outside the app shell -->
        <Button as-child variant="outline"><a :href="guide_url" target="_blank" rel="noopener"><BookOpen /> {{ t("global_extensions.guide") }}</a></Button>
        <!-- one button, two ways in: a zip from this computer, or a link the server downloads -->
        <input ref="picker" type="file" accept=".zip,application/zip" class="hidden" :aria-label="t('extensions.zip_aria')" @change="pick" />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button type="button" :disabled="upload.processing">
              <LoaderCircle v-if="upload.processing" class="animate-spin" /><Plus v-else /> {{ t("extensions.add") }} <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @select="openPicker"><Upload /> {{ t("extensions.upload_zip") }}</DropdownMenuItem>
            <DropdownMenuItem @select="openUrl"><Link2 /> {{ t("extensions.from_url") }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <p v-if="upload.errors.file" class="text-sm text-destructive" role="alert">{{ upload.errors.file }}</p>

    <Dialog v-model:open="urlOpen">
      <DialogContent class="sm:max-w-md">
        <form class="space-y-4" @submit.prevent="fromUrl">
          <DialogHeader>
            <DialogTitle>{{ t("extensions.url_title") }}</DialogTitle>
            <DialogDescription>{{ t("extensions.url_desc") }}</DialogDescription>
          </DialogHeader>
          <div class="grid gap-2">
            <Label for="extension-url">{{ t("extensions.zip_url") }}</Label>
            <Input id="extension-url" v-model="link.url" type="url" placeholder="https://…/extension.zip" :disabled="link.processing" autofocus />
            <p v-if="link.errors.url" class="text-sm text-destructive" role="alert">{{ link.errors.url }}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="urlOpen = false">{{ t("common.cancel") }}</Button>
            <Button type="submit" :disabled="link.processing || !link.url"><LoaderCircle v-if="link.processing" class="animate-spin" /> {{ t("extensions.add") }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- one row per extension of the platform; no settings here, each shop configures its own -->
    <Card class="py-0">
      <CardHeader v-if="rowErrors.key" class="pt-4">
        <p class="text-sm text-destructive" role="alert">{{ rowErrors.key }}</p>
      </CardHeader>
      <CardContent class="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-6">{{ t("extensions.extension") }}</TableHead>
              <TableHead class="w-40 text-center">{{ t("global_extensions.enabled_all") }}</TableHead>
              <TableHead class="w-48">{{ t("global_extensions.available_to") }}</TableHead>
              <TableHead class="w-32 pr-6 text-right">{{ t("common.actions") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!extensions.length">
              <TableCell colspan="4" class="py-8 text-center text-muted-foreground">{{ t("global_extensions.empty") }}</TableCell>
            </TableRow>
            <TableRow v-for="e in extensions" :key="e.key">
              <TableCell class="pl-6 align-top">
                <p class="flex flex-wrap items-center gap-2 font-medium">
                  <img v-if="e.icon" :src="e.icon" alt="" class="size-6 rounded-md object-contain" />
                  <Puzzle v-else class="size-6 rounded-md bg-muted p-1 text-muted-foreground" />
                  {{ e.name }}
                  <span class="text-xs font-normal text-muted-foreground">v{{ e.version }}</span>
                  <Badge variant="secondary" class="font-normal">{{ e.builtin ? t("global_extensions.builtin") : t("global_extensions.uploaded") }}</Badge>
                </p>
                <p class="max-w-xl text-sm whitespace-normal text-muted-foreground">{{ e.description }}</p>
              </TableCell>
              <TableCell class="text-center align-middle">
                <Switch :model-value="e.enabled" :aria-label="t('global_extensions.enabled_all_aria', { name: e.name })" @update:model-value="(v: boolean) => toggle(e, v)" />
              </TableCell>
              <TableCell class="align-middle">
                <Button type="button" variant="outline" size="sm" class="max-w-full" :aria-label="t('global_extensions.edit_users_aria', { name: e.name })" @click="editUsers(e)">
                  <Users />
                  <span class="truncate">{{ !e.users.length ? t("global_extensions.all_users") : e.users.length === 1 ? e.users[0] : t("global_extensions.users_count", { count: e.users.length }) }}</span>
                </Button>
              </TableCell>
              <TableCell class="pr-6 text-right align-middle whitespace-nowrap">
                <Button v-if="!e.builtin" type="button" variant="ghost" size="sm" class="text-destructive" :aria-label="t('global_extensions.delete_aria', { name: e.name })" @click="remove(e)"><Trash2 /> {{ t("common.delete") }}</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- Available to: the users an extension is for; none picked = every user -->
    <Dialog :open="!!usersFor" @update:open="(o: boolean) => !o && (usersFor = null)">
      <DialogContent v-if="usersFor">
        <DialogHeader>
          <DialogTitle>{{ t("global_extensions.users_title", { name: usersFor.name }) }}</DialogTitle>
          <DialogDescription>{{ t("global_extensions.users_desc") }}</DialogDescription>
        </DialogHeader>
        <form id="extension-users" class="grid gap-2" @submit.prevent="saveUsers">
          <Label for="extension-users-picker">{{ t("global_extensions.available_to") }}</Label>
          <ChipPicker id="extension-users-picker" v-model="usersForm.users" :label="t('global_extensions.available_to')" :find="findUsers" :placeholder="t('global_extensions.users_placeholder')" :search-placeholder="t('global_extensions.search_users')" :hint="t('global_extensions.no_user_found')" :invalid="!!usersForm.errors.users" />
          <p v-if="usersForm.errors.users" class="text-sm text-destructive">{{ usersForm.errors.users }}</p>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" @click="usersFor = null">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="extension-users" :disabled="usersForm.processing">{{ t("common.save") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
