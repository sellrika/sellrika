<script setup lang="ts">
import { ref } from "vue";
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Plus, Pencil, Trash2, Tags } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import ColorPicker from "@/components/ColorPicker.vue";
import CategoryDot from "@/components/CategoryDot.vue";
import ImagesUpload from "@/components/products/ImagesUpload.vue";
import { Card, CardContent } from "@/components/ui/card";
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
import { t } from "@/lib/i18n";
import type { Category, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
defineProps<{ categories: Category[] }>();

const page = usePage<SharedProps>();

/** What the add and edit dialog starts from. */
const BLANK = {
	name: "",
	color: null as string | null,
	image: null as string | null,
};
const form = useForm({ ...BLANK });
const open = ref(false);
/** The category the dialog edits, null while it adds one. */
const editing = ref<Category | null>(null);
/**
 * The uploader keeps a list, a category has one picture.
 * So the list holds no entry or one, and `submit` copies it to the form.
 */
const images = ref<string[]>([]);

/**
 * Open the dialog for a new category.
 */
function startAdd() {
	editing.value = null;
	images.value = [];
	form.defaults({ ...BLANK });
	form.reset();
	form.clearErrors();
	open.value = true;
}

/**
 * Open the dialog for a category of the list.
 * @param c The category.
 */
function startEdit(c: Category) {
	editing.value = c;
	images.value = c.image ? [c.image] : [];
	form.defaults({ name: c.name, color: c.color, image: c.image });
	form.reset();
	form.clearErrors();
	open.value = true;
}

/**
 * The dialog saved: close it and say so.
 */
function saved() {
	open.value = false;
	toast.success(t(editing.value ? "categories.renamed" : "categories.added"));
}

/**
 * Send the dialog: a new category, or the edited one.
 */
function submit() {
	if (!form.name.trim()) return;
	form.image = images.value[0] ?? null;
	const options = { preserveScroll: true, onSuccess: saved };
	if (editing.value) form.put(`/categories/${editing.value.id}`, options);
	else form.post("/categories", options);
}

const remove = (c: Category) =>
	router.delete(`/categories/${c.id}`, {
		onSuccess: () => toast.success(t("categories.deleted", { name: c.name })),
	});
</script>

<template>
  <Head :title="t('categories.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1 space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("categories.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("categories.subtitle", { shop: page.props.shop?.name ?? t("categories.your_shop") }) }}</p>
      </div>
      <Button @click="startAdd"><Plus /> {{ t("categories.add") }}</Button>
    </header>

    <Card v-if="categories.length" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("common.name") }}</TableHead>
            <TableHead class="hidden w-32 sm:table-cell">{{ t("common.products") }}</TableHead>
            <TableHead class="pr-4 text-right sm:w-40">{{ t("common.actions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in categories" :key="c.id">
            <TableCell class="pl-4 font-medium">
              <span class="inline-flex items-center gap-2">
                <img v-if="c.image" :src="c.image" alt="" class="size-8 rounded-md border bg-muted object-cover" data-category-image />
                <CategoryDot :color="c.color" />{{ c.name }}
              </span>
            </TableCell>
            <TableCell class="hidden sm:table-cell">
              <Badge variant="secondary">{{ c.product_count ?? 0 }}</Badge>
            </TableCell>
            <TableCell class="pr-4 text-right">
              <div class="flex justify-end gap-1">
                <Button size="icon-sm" variant="ghost" :aria-label="t('categories.edit_aria', { name: c.name })" @click="startEdit(c)"><Pencil /></Button>
                <AlertDialog>
                  <AlertDialogTrigger as-child>
                    <Button size="icon-sm" variant="ghost" :aria-label="t('categories.delete_aria', { name: c.name })">
                      <Trash2 class="text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{{ t("categories.delete_title", { name: c.name }) }}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {{ t("categories.delete_desc") }}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" @click="remove(c)">{{ t("common.delete") }}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <Card v-else>
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Tags class="size-5" />
        </span>
        <p class="font-medium">{{ t("categories.empty_title") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("categories.empty_text") }}</p>
      </CardContent>
    </Card>
  </div>

  <!-- Add / edit -->
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex flex-wrap items-center gap-3 pr-8">
          {{ t(editing ? "categories.edit_title" : "categories.add") }}
        </DialogTitle>
        <DialogDescription class="sr-only">{{ t("categories.title") }}</DialogDescription>
      </DialogHeader>
      <!-- the footer sits inside the form, so the dialog pins it to the bottom edge -->
      <form class="grid gap-5" @submit.prevent="submit">
        <div class="grid gap-5">
          <div class="grid gap-2">
            <Label for="category-name">{{ t("common.name") }}</Label>
            <div class="flex items-center gap-2">
              <Input
                id="category-name"
                v-model="form.name"
                autofocus
                class="flex-1"
                :placeholder="t('categories.new_placeholder')"
                :aria-label="t(editing ? 'categories.name_aria' : 'categories.new_placeholder')"
                :aria-invalid="!!form.errors.name"
              />
              <ColorPicker v-model="form.color" />
            </div>
            <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
            <p v-if="form.errors.color" class="text-sm text-destructive">{{ form.errors.color }}</p>
          </div>

          <div class="grid gap-2">
            <Label>{{ t("categories.image") }}</Label>
            <ImagesUpload v-model="images" :max="1" folder="categories" />
            <p v-if="form.errors.image" class="text-sm text-destructive">{{ form.errors.image }}</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" :disabled="form.processing || !form.name.trim()">{{ t(editing ? "common.save" : "common.add") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
