<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, router, useForm, usePage } from "@inertiajs/vue3";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/components/ui/input-group";
import { randomPassword } from "@/lib/password";
import { toast } from "vue-sonner";
import { Copy, HandCoins, Plus, Pencil, RefreshCw, Trash2 } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { useAuth } from "@/lib/auth";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Role, SalesStaff, SharedProps, StaffUser } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	users: StaffUser[];
	sales_staff: SalesStaff[];
}>();

const page = usePage<SharedProps>();
const { user: me, isAdmin } = useAuth();
const currency = computed(() => page.props.shop?.currency ?? "USD");

// a manager may only give out the cashier role (the server refuses the rest)
const roles = computed<{ value: Role; label: string; hint: string }[]>(() =>
	(["admin", "manager", "cashier"] as const)
		.filter((r) => isAdmin.value || r === "cashier")
		.map((r) => ({
			value: r,
			label: t(`users.role_${r}`),
			hint: t(`users.role_${r}_hint`),
		})),
);

/**
 * Why this row can't be changed by me, or "" when it can.
 * A manager may only change cashiers.
 * @param u The staff row.
 * @returns The reason, or "".
 */
function lockedFor(u: StaffUser) {
	return isAdmin.value || u.role === "cashier"
		? ""
		: t("server.user_manager_cashiers_only");
}

// The server refuses some updates/deletes and re-renders this page with errors.user.
watch(
	() => page.props.errors?.user,
	(msg) => msg && toast.error(msg),
);
// role-rule refusals ("keep one admin", "can't remove your own admin access") also come from the list's Active switch
watch(
	() => page.props.errors?.role,
	(msg) => msg && toast.error(msg),
);
// a refused change or delete of a sales person
watch(
	() => page.props.errors?.sales,
	(msg) => msg && toast.error(msg),
);

const initials = (name: string) =>
	name
		.split(" ")
		.map((p) => p[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();

// the two lists share the page: the staff who sign in, and the sales staff who do not (`?tab=sales` opens the second)
const tab = ref<"staff" | "sales">(
	new URLSearchParams(window.location.search).get("tab") === "sales"
		? "sales"
		: "staff",
);

/* create */
const creating = ref(false);
// a fresh password each time the dialog opens: shown as text so the admin can pass it on
watch(creating, function fill(open) {
	if (open && !form.password) form.password = randomPassword();
});

/**
 * Put a new random password in the field.
 */
function regenerate() {
	form.password = randomPassword();
}

/**
 * Copy the password, to send it to the new staff member.
 */
async function copyPassword() {
	await navigator.clipboard.writeText(form.password);
	toast.success(t("common.copied"));
}
const form = useForm({
	name: "",
	email: "",
	password: "",
	role: "cashier" as Role,
});
const create = () =>
	form.post("/users", {
		onSuccess: () => {
			creating.value = false;
			form.reset();
			toast.success(t("users.added_toast"));
		},
	});

/* edit */
const editing = ref<StaffUser | null>(null);
const draft = ref({
	name: "",
	email: "",
	role: "cashier" as Role,
	active: true,
	password: "",
});
function startEdit(u: StaffUser) {
	editing.value = u;
	draft.value = {
		name: u.name,
		email: u.email,
		role: u.role,
		active: u.active,
		password: "",
	};
}
function saveEdit() {
	if (!editing.value) return;
	router.put(
		`/users/${editing.value.id}`,
		{ ...draft.value },
		{
			onSuccess: () => {
				editing.value = null;
				toast.success(t("users.updated_toast"));
			},
		},
	);
}

/** Flip active straight from the list; everything else stays as it is. */
const toggle = (u: StaffUser, active: boolean) =>
	router.put(
		`/users/${u.id}`,
		{ name: u.name, email: u.email, role: u.role, active, password: "" },
		{
			preserveScroll: true,
			onSuccess: () =>
				toast.success(
					t(active ? "users.activated" : "users.deactivated", {
						name: u.name,
					}),
				),
		},
	);

const remove = (u: StaffUser) =>
	router.delete(`/users/${u.id}`, {
		onSuccess: () => toast.success(t("users.deleted_toast", { name: u.name })),
	});

/** Why delete is off for this row, or "" when it's allowed. */
const deleteBlocked = (u: StaffUser) =>
	u.id === me.value?.id
		? t("users.cant_delete_self")
		: lockedFor(u)
			? lockedFor(u)
			: u.owner_id === null
				? t("server.user_owner_stays_admin")
				: u.activity > 0
					? t("users.has_history")
					: "";

/* sales staff: no login, only a name and a commission */
const salesOpen = ref(false);
const salesEditing = ref<SalesStaff | null>(null);
const salesForm = useForm({ name: "", commission: "0", active: true });

/**
 * The commission as the server stores it.
 * @param percent What was typed, like "2.5".
 * @returns Hundredths of a percent, like 250.
 */
function toRate(percent: string) {
	return Math.round(Number(String(percent).trim() || 0) * 100);
}

/**
 * The commission as people read it.
 * @param rate Hundredths of a percent, like 250.
 * @returns The percent, like "2.5%".
 */
function percent(rate: number) {
	return `${rate / 100}%`;
}

/**
 * Open the dialog, empty for a new sales person or filled for an old one.
 * @param s The sales person to edit, or null to add one.
 */
function openSales(s: SalesStaff | null) {
	salesEditing.value = s;
	salesForm.clearErrors();
	salesForm.name = s?.name ?? "";
	salesForm.commission = String((s?.commission ?? 0) / 100);
	salesForm.active = s?.active ?? true;
	salesOpen.value = true;
}

/**
 * The form with the commission in hundredths of a percent.
 * @param d The form as typed.
 * @returns What the server takes.
 */
function salesPayload(d: {
	name: string;
	commission: string;
	active: boolean;
}) {
	return { ...d, commission: toRate(d.commission) };
}

/**
 * Close the dialog and say it worked.
 */
function salesSaved() {
	salesOpen.value = false;
	toast.success(
		t(
			salesEditing.value
				? "users.sales_updated_toast"
				: "users.sales_added_toast",
		),
	);
}

/**
 * Save the dialog: add a sales person, or change the one being edited.
 */
function saveSales() {
	const form = salesForm.transform(salesPayload);
	const options = {
		preserveScroll: true,
		preserveState: true,
		onSuccess: salesSaved,
	};
	if (salesEditing.value)
		form.put(`/sales-staff/${salesEditing.value.id}`, options);
	else form.post("/sales-staff", options);
}

/**
 * Flip a sales person on or off straight from the list.
 * @param s The sales person.
 * @param active The new state.
 */
function toggleSales(s: SalesStaff, active: boolean) {
	router.put(
		`/sales-staff/${s.id}`,
		{ name: s.name, commission: s.commission, active },
		{
			preserveScroll: true,
			preserveState: true, // the Sales staff tab stays open
			onSuccess: function done() {
				toast.success(
					t(active ? "users.activated" : "users.deactivated", { name: s.name }),
				);
			},
		},
	);
}

/**
 * Pay a sales person's commission.
 * The server works out the amount and saves it to the history.
 * The amount due starts again from zero.
 * @param s The sales person.
 */
function paySales(s: SalesStaff) {
	router.post(
		`/sales-staff/${s.id}/pay`,
		{},
		{
			preserveScroll: true,
			preserveState: true,
			onSuccess: function done() {
				toast.success(t("users.sales_paid_toast", { name: s.name }));
			},
		},
	);
}

/**
 * Delete a sales person no sale names.
 * @param s The sales person.
 */
function removeSales(s: SalesStaff) {
	router.delete(`/sales-staff/${s.id}`, {
		preserveScroll: true,
		preserveState: true,
		onSuccess: function done() {
			toast.success(t("users.deleted_toast", { name: s.name }));
		},
	});
}
</script>

<template>
  <Head :title="t('users.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("users.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ tab === "staff" ? t("users.subtitle") : t("users.sales_subtitle") }}</p>
      </div>
      <Button v-if="tab === 'staff'" @click="creating = true"><Plus /> {{ t("users.add") }}</Button>
      <Button v-else @click="openSales(null)"><Plus /> {{ t("users.sales_add") }}</Button>
    </header>

    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="staff">{{ t("users.title") }}</TabsTrigger>
        <TabsTrigger value="sales">{{ t("users.sales_title") }}</TabsTrigger>
      </TabsList>
    </Tabs>

    <p v-if="page.props.errors?.user" class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ page.props.errors.user }}</p>

    <Card v-if="tab === 'staff'" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("users.person") }}</TableHead>
            <TableHead class="w-24">{{ t("users.role") }}</TableHead>
            <TableHead class="w-20">{{ t("users.active") }}</TableHead>
            <TableHead class="hidden w-36 md:table-cell">{{ t("users.added") }}</TableHead>
            <TableHead class="pr-4 text-right sm:w-40">{{ t("common.actions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="u in users" :key="u.id">
            <TableCell class="pl-4">
              <div class="flex items-center gap-3" :class="!u.active && 'opacity-60'">
                <Avatar class="size-8 shrink-0"><AvatarFallback class="text-xs">{{ initials(u.name) }}</AvatarFallback></Avatar>
                <div class="min-w-0">
                  <div class="truncate font-medium">
                    {{ u.name }}
                    <span v-if="u.id === me?.id" class="text-xs font-normal text-muted-foreground">{{ t("users.you") }}</span>
                  </div>
                  <div class="hidden truncate text-xs text-muted-foreground sm:block">{{ u.email }}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="u.role === 'admin' ? 'default' : u.role === 'manager' ? 'outline' : 'secondary'">{{ t(`users.role_${u.role}`) }}</Badge>
            </TableCell>
            <TableCell>
              <Switch
                :model-value="u.active"
                :disabled="u.id === me?.id || u.owner_id === null || !!lockedFor(u)"
                :aria-label="t('users.active_aria', { name: u.name })"
                :title="u.id === me?.id ? t('users.cant_deactivate_self') : u.owner_id === null ? t('server.user_owner_stays_admin') : lockedFor(u) || undefined"
                @update:model-value="(v: boolean) => toggle(u, v)" />
            </TableCell>
            <TableCell class="hidden text-muted-foreground md:table-cell">{{ fmtDate(u.created_at, { dateStyle: "medium" }) }}</TableCell>
            <TableCell class="pr-4 text-right">
              <div class="flex justify-end gap-1">
                <Button size="sm" variant="ghost" :disabled="!!lockedFor(u)" :title="lockedFor(u) || undefined" :aria-label="t('users.edit_aria', { name: u.name })" @click="startEdit(u)">
                  <Pencil /> <span class="hidden sm:inline">{{ t("common.edit") }}</span>
                </Button>
                <span v-if="deleteBlocked(u)" :title="deleteBlocked(u)" class="inline-flex">
                  <Button size="icon-sm" variant="ghost" disabled :aria-label="t('users.delete_blocked_aria', { name: u.name, reason: deleteBlocked(u) })"><Trash2 /></Button>
                </span>
                <AlertDialog v-else>
                  <AlertDialogTrigger as-child>
                    <Button size="icon-sm" variant="ghost" :aria-label="t('users.delete_aria', { name: u.name })"><Trash2 class="text-destructive" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{{ t("users.delete_title", { name: u.name }) }}</AlertDialogTitle>
                      <AlertDialogDescription>{{ t("users.delete_desc") }}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" @click="remove(u)">{{ t("common.delete") }}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- Sales staff: named on a sale, never sign in -->
    <section v-if="tab === 'sales'" :aria-label="t('users.sales_title')">
      <Card v-if="sales_staff.length" class="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-4">{{ t("users.person") }}</TableHead>
              <TableHead class="w-28">{{ t("users.sales_commission") }}</TableHead>
              <TableHead class="w-28">{{ t("users.sales_due") }}</TableHead>
              <TableHead class="hidden w-32 md:table-cell">{{ t("users.sales_last_paid") }}</TableHead>
              <TableHead class="w-20">{{ t("users.active") }}</TableHead>
              <TableHead class="pr-4 text-right sm:w-64">{{ t("common.actions") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="s in sales_staff" :key="s.id">
              <TableCell class="pl-4">
                <div class="flex items-center gap-3" :class="!s.active && 'opacity-60'">
                  <Avatar class="size-8 shrink-0"><AvatarFallback class="text-xs">{{ initials(s.name) }}</AvatarFallback></Avatar>
                  <Link :href="`/sales-staff/${s.id}`" class="truncate font-medium hover:underline" :aria-label="t('users.sales_open_aria', { name: s.name })">{{ s.name }}</Link>
                </div>
              </TableCell>
              <TableCell class="tabular-nums">{{ percent(s.commission) }}</TableCell>
              <TableCell class="font-medium tabular-nums">{{ money(s.due, currency) }}</TableCell>
              <TableCell class="hidden text-muted-foreground md:table-cell">{{ s.last_paid_at ? fmtDate(s.last_paid_at, { dateStyle: "medium" }) : t("users.sales_never_paid") }}</TableCell>
              <TableCell>
                <Switch :model-value="s.active" :aria-label="t('users.active_aria', { name: s.name })" @update:model-value="(v: boolean) => toggleSales(s, v)" />
              </TableCell>
              <TableCell class="pr-4 text-right">
                <div class="flex justify-end gap-1">
                  <AlertDialog>
                    <AlertDialogTrigger as-child>
                      <Button size="sm" variant="outline" :disabled="!s.due" :aria-label="t('users.sales_pay_aria', { name: s.name })"><HandCoins /> <span class="hidden sm:inline">{{ t("users.sales_pay") }}</span></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{{ t("users.sales_pay_title", { name: s.name }) }}</AlertDialogTitle>
                        <AlertDialogDescription>{{ t("users.sales_pay_desc", { amount: money(s.due, currency), sold: money(s.unpaid_sales, currency), rate: percent(s.commission), count: s.unpaid_orders }) }}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                        <AlertDialogAction @click="paySales(s)">{{ t("users.sales_pay_confirm") }}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button size="sm" variant="ghost" :aria-label="t('users.edit_aria', { name: s.name })" @click="openSales(s)">
                    <Pencil /> <span class="hidden sm:inline">{{ t("common.edit") }}</span>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger as-child>
                      <Button size="icon-sm" variant="ghost" :aria-label="t('users.delete_aria', { name: s.name })"><Trash2 class="text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{{ t("users.delete_title", { name: s.name }) }}</AlertDialogTitle>
                        <AlertDialogDescription>{{ t("users.sales_delete_desc") }}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" @click="removeSales(s)">{{ t("common.delete") }}</AlertDialogAction>
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
        <CardContent class="py-8 text-center text-sm text-muted-foreground">{{ t("users.sales_empty") }}</CardContent>
      </Card>
    </section>

    <!-- Sales staff: add / edit -->
    <Dialog v-model:open="salesOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ salesEditing ? t("users.sales_edit_title") : t("users.sales_add") }}</DialogTitle>
          <DialogDescription>{{ t("users.sales_add_desc") }}</DialogDescription>
        </DialogHeader>
        <form id="sales-form" class="grid gap-4" @submit.prevent="saveSales">
          <div class="grid gap-2">
            <Label for="sales-name">{{ t("common.name") }}</Label>
            <Input id="sales-name" v-model="salesForm.name" autofocus :aria-invalid="!!salesForm.errors.name" />
            <p v-if="salesForm.errors.name" class="text-sm text-destructive">{{ salesForm.errors.name }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="sales-commission">{{ t("users.sales_commission") }}</Label>
            <InputGroup>
              <InputGroupInput id="sales-commission" v-model="salesForm.commission" inputmode="decimal" placeholder="0" :aria-invalid="!!salesForm.errors.commission" />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            <p v-if="salesForm.errors.commission" class="text-sm text-destructive">{{ salesForm.errors.commission }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("users.sales_commission_help") }}</p>
          </div>
          <Label v-if="salesEditing" class="flex items-center gap-2 font-normal">
            <Switch v-model="salesForm.active" />
            {{ t("users.sales_active_label") }}
          </Label>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" @click="salesOpen = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="sales-form" :disabled="salesForm.processing">{{ salesEditing ? t("common.save") : t("users.sales_add") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Add -->
    <Dialog v-model:open="creating">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("users.add") }}</DialogTitle>
          <DialogDescription>{{ t("users.add_desc") }}</DialogDescription>
        </DialogHeader>
        <form id="user-create" class="grid gap-4" @submit.prevent="create">
          <div class="grid gap-2">
            <Label for="new-name">{{ t("common.name") }}</Label>
            <Input id="new-name" v-model="form.name" autofocus :placeholder="t('users.name_placeholder')" :aria-invalid="!!form.errors.name" />
            <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="new-email">{{ t("common.email") }}</Label>
            <Input id="new-email" v-model="form.email" type="email" autocomplete="off" :placeholder="t('users.email_placeholder')" :aria-invalid="!!form.errors.email" />
            <p v-if="form.errors.email" class="text-sm text-destructive">{{ form.errors.email }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="new-password">{{ t("settings.password") }}</Label>
            <InputGroup>
              <InputGroupInput id="new-password" v-model="form.password" type="text" autocomplete="off" spellcheck="false" class="font-mono" :aria-invalid="!!form.errors.password" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" :aria-label="t('users.generate_password')" :title="t('users.generate_password')" @click="regenerate"><RefreshCw /></InputGroupButton>
                <InputGroupButton size="icon-xs" :aria-label="t('users.copy_password')" :title="t('users.copy_password')" :disabled="!form.password" @click="copyPassword"><Copy /></InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <p v-if="form.errors.password" class="text-sm text-destructive">{{ form.errors.password }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("users.password_min") }}</p>
          </div>
          <div class="grid gap-2">
            <Label>{{ t("users.role") }}</Label>
            <div class="grid gap-2" :class="roles.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
              <button v-for="r in roles" :key="r.value" type="button"
                class="rounded-md border p-3 text-left transition-colors"
                :class="form.role === r.value ? 'border-primary bg-primary/5' : 'hover:bg-accent'"
                @click="form.role = r.value">
                <span class="text-sm font-medium">{{ r.label }}</span>
                <span class="block text-xs text-muted-foreground">{{ r.hint }}</span>
              </button>
            </div>
            <p v-if="form.errors.role" class="text-sm text-destructive">{{ form.errors.role }}</p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" @click="creating = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="user-create" :disabled="form.processing">{{ t("users.add") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Edit -->
    <Dialog :open="!!editing" @update:open="(o: boolean) => !o && (editing = null)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("users.edit_title") }}</DialogTitle>
          <DialogDescription>{{ t("users.edit_desc") }}</DialogDescription>
        </DialogHeader>
        <form id="user-edit" class="grid gap-4" @submit.prevent="saveEdit">
          <p v-if="page.props.errors?.user" class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ page.props.errors.user }}</p>
          <div class="grid gap-2">
            <Label for="edit-name">{{ t("common.name") }}</Label>
            <Input id="edit-name" v-model="draft.name" autofocus :aria-invalid="!!page.props.errors?.name" />
            <p v-if="page.props.errors?.name" class="text-sm text-destructive">{{ page.props.errors.name }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="edit-email">{{ t("common.email") }}</Label>
            <Input id="edit-email" v-model="draft.email" type="email" :aria-invalid="!!page.props.errors?.email" />
            <p v-if="page.props.errors?.email" class="text-sm text-destructive">{{ page.props.errors.email }}</p>
          </div>
          <div class="grid gap-2">
            <Label>{{ t("users.role") }}</Label>
            <div class="grid gap-2" :class="roles.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
              <button v-for="r in roles" :key="r.value" type="button"
                class="rounded-md border p-3 text-left transition-colors"
                :class="draft.role === r.value ? 'border-primary bg-primary/5' : 'hover:bg-accent'"
                @click="draft.role = r.value">
                <span class="text-sm font-medium">{{ r.label }}</span>
                <span class="block text-xs text-muted-foreground">{{ r.hint }}</span>
              </button>
            </div>
            <p v-if="page.props.errors?.role" class="text-sm text-destructive">{{ page.props.errors.role }}</p>
          </div>
          <Label class="flex items-center gap-2 font-normal">
            <Switch v-model="draft.active" :disabled="editing?.id === me?.id" />
            {{ t("users.active_label") }}
          </Label>
          <div class="grid gap-2">
            <Label for="edit-password">{{ t("users.new_password") }}</Label>
            <Input id="edit-password" v-model="draft.password" type="password" autocomplete="new-password" placeholder="••••••••" :aria-invalid="!!page.props.errors?.password" />
            <p v-if="page.props.errors?.password" class="text-sm text-destructive">{{ page.props.errors.password }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("users.password_keep") }}</p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" @click="editing = null">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="user-edit">{{ t("common.save") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
