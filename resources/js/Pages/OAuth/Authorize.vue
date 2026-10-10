<script setup lang="ts">
import { computed, ref } from "vue";
import { Head } from "@inertiajs/vue3";
import { Bot, CircleAlert, LoaderCircle } from "@lucide/vue";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import type { Role } from "@/types";

// ponytail: no layout, like Auth/Login — the person comes from their assistant, not from the app.
/**
 * The consent page of the MCP server's OAuth sign-in.
 * `client` = the assistant that asks and the host it sends the person back to,
 * `shop` = the shop it will work in, `params` = what it asked (sent back on Allow),
 * `deny_url` = where Cancel goes, `error` = why the link can not be used.
 */
const props = defineProps<{
	error: string | null;
	client?: { name: string; host: string };
	shop?: { name: string };
	params?: Record<string, string>;
	deny_url?: string;
}>();

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

/**
 * The role the admin picked. None at first:
 * a link from a stranger must not come with a role already chosen.
 */
const role = ref<Role | null>(null);
const failed = ref("");
const saving = ref(false);

/**
 * Allow the assistant.
 * The answer is the address to go back to, with a one-time code.
 * The browser is sent there by hand: it is another site.
 */
async function allow() {
	saving.value = true;
	failed.value = "";
	try {
		const res = await fetch("/oauth/authorize", {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ ...props.params, role: role.value }),
		});
		const data = await res.json();
		if (res.ok && data.url) {
			window.location.href = data.url;
			return;
		}
		failed.value = data.errors?.role ?? t("oauth.failed");
	} catch {
		failed.value = t("oauth.failed");
	}
	saving.value = false;
}

/** Say no: back to the assistant, with no code. */
function deny() {
	if (props.deny_url) window.location.href = props.deny_url;
}
</script>

<template>
  <Head :title="client ? t('oauth.title', { client: client.name }) : t('oauth.error_title')" />

  <AuthShell>
    <div v-if="error || !client || !shop" class="flex flex-col items-center text-center">
      <span class="mb-5 flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert class="size-8" />
      </span>
      <h1 class="font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("oauth.error_title") }}</h1>
      <p class="mt-2 text-sm text-muted-foreground" role="alert">{{ error }}</p>
    </div>

    <div v-else class="flex flex-col">
      <span class="mb-5 flex size-16 items-center justify-center self-center rounded-full bg-primary text-primary-foreground ring-8 ring-primary/20">
        <Bot class="size-8" />
      </span>
      <h1 class="text-center font-bricolage text-[28px] leading-[1.1] font-bold tracking-[-0.02em]">{{ t("oauth.title", { client: client.name }) }}</h1>
      <p class="mt-2 text-center text-sm text-muted-foreground">
        {{ t("oauth.body", { client: client.name, shop: shop.name }) }}
      </p>

      <div class="mt-6 grid gap-2">
        <Label>{{ t("api_keys.role") }}</Label>
        <div class="grid gap-2">
          <button v-for="r in roles" :key="r.value" type="button"
            class="rounded-md border p-3 text-left transition-colors"
            :class="role === r.value ? 'border-primary bg-primary/5' : 'hover:bg-accent'"
            :aria-pressed="role === r.value"
            @click="role = r.value">
            <span class="text-sm font-medium">{{ r.label }}</span>
            <span class="block text-xs text-muted-foreground">{{ r.hint }}</span>
          </button>
        </div>
        <p v-if="failed" class="text-sm text-destructive" role="alert">{{ failed }}</p>
      </div>

      <!-- Where the code goes: the one thing a made-up name can not fake. -->
      <div class="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="note">
        <p class="text-muted-foreground">{{ t("oauth.redirect") }}</p>
        <p class="font-mono font-semibold break-all" data-testid="oauth-host">{{ client.host }}</p>
        <p class="mt-2 text-xs text-muted-foreground">{{ t("oauth.warning") }}</p>
      </div>

      <Button size="lg" class="mt-4 h-11 w-full rounded-full" :disabled="saving || !role" @click="allow">
        <LoaderCircle v-if="saving" class="animate-spin" />
        {{ t("oauth.allow") }}
      </Button>
      <Button variant="ghost" class="mt-2 w-full" :disabled="saving" @click="deny">{{ t("oauth.deny") }}</Button>

      <p class="mt-5 text-center text-xs text-muted-foreground">{{ t("oauth.revoke_hint") }}</p>
    </div>
  </AuthShell>
</template>
