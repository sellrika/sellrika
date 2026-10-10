<script setup lang="ts">
import { ref, watch } from "vue";
import { Link, router, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { LoaderCircle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import type { ReportSchedule, SharedProps } from "@/types";

/**
 * The daily report's settings: on or off, at what time, to which chat channels.
 * The channels are the ones filled in the Chat alerts extension.
 */
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ schedule: ReportSchedule }>();

/** The channels' own names. They are brand names, so never translated. */
const NAMES = { slack: "Slack", discord: "Discord", line: "LINE" };

const page = usePage<SharedProps>();
const { isAdmin } = useAuth();
const enabled = ref(false);
const time = ref("");
const channels = ref<string[]>([]);
const error = ref("");
const saving = ref(false);

watch(open, reset);

/**
 * Start from the saved settings each time the dialog opens.
 * @param isOpen The dialog's new state.
 */
function reset(isOpen: boolean) {
	if (!isOpen) return;
	enabled.value = props.schedule.enabled;
	time.value = props.schedule.time;
	channels.value = props.schedule.channels.filter(isAvailable);
	error.value = "";
}

/**
 * Can the shop get a report on this channel right now?
 * @param name The channel.
 * @returns True when Chat alerts has it filled in.
 */
function isAvailable(name: string) {
	return (props.schedule.available as string[]).includes(name);
}

/**
 * Tick or untick one channel.
 * @param name The channel.
 * @param on True = the report goes there.
 */
function pick(name: string, on: boolean | "indeterminate") {
	channels.value = channels.value.filter(function other(c) {
		return c !== name;
	});
	if (on === true) channels.value.push(name);
}

/**
 * Save the settings; the page reloads with them.
 */
async function save() {
	saving.value = true;
	error.value = "";
	try {
		const res = await fetch("/reports/schedule", {
			method: "PUT",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				enabled: enabled.value,
				time: time.value,
				channels: channels.value,
			}),
		});
		const data = await res.json();
		if (res.ok) {
			open.value = false;
			toast.success(t("reports.daily_saved"));
			router.reload();
		} else
			error.value =
				Object.values(data.errors ?? {})[0]?.toString() ??
				t("reports.daily_failed");
	} catch {
		error.value = t("reports.daily_failed");
	} finally {
		saving.value = false;
	}
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("reports.daily_title") }}</DialogTitle>
        <DialogDescription>{{ t("reports.daily_help") }}</DialogDescription>
      </DialogHeader>
      <form class="grid gap-4 pt-1" @submit.prevent="save">
        <div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <Label for="daily-report-switch">{{ t("reports.daily_switch") }}</Label>
          <Switch id="daily-report-switch" v-model="enabled" />
        </div>
        <div class="grid gap-1.5">
          <Label for="daily-report-time">{{ t("reports.daily_time") }}</Label>
          <Input id="daily-report-time" v-model="time" type="time" required class="w-32" />
          <p class="text-xs text-muted-foreground">{{ t("reports.daily_time_hint", { tz: page.props.shop?.timezone ?? "UTC" }) }}</p>
        </div>
        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">{{ t("reports.daily_channels") }}</legend>
          <div v-if="schedule.available.length" class="flex flex-wrap gap-2 text-sm">
            <Label v-for="name in schedule.available" :key="name" class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-normal">
              <Checkbox :model-value="channels.includes(name)" @update:model-value="pick(name, $event)" />
              {{ NAMES[name] }}
            </Label>
          </div>
          <div v-else class="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
            <p>{{ t("reports.daily_no_channels") }}</p>
            <Link v-if="isAdmin" href="/extensions" class="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline">{{ t("reports.daily_open_extensions") }}</Link>
          </div>
        </fieldset>
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" :disabled="saving"><LoaderCircle v-if="saving" class="animate-spin" /> {{ t("common.save") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
