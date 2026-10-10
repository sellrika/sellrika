<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { SignInProvider } from "@/lib/google";
import { t } from "@/lib/i18n";

/**
 * "Continue with Google" and "Continue with Microsoft".
 * Shared by the sign-in and the sign-up page.
 * `microsoft` = show the Microsoft button too.
 * `busy` = the button whose pop-up is open now.
 * `errors` = what went wrong, by button.
 */
defineProps<{
	microsoft?: boolean;
	busy: SignInProvider | null;
	errors: Record<string, string>;
}>();
const emit = defineEmits<{ pick: [via: SignInProvider] }>();
</script>

<template>
  <div class="grid gap-3">
    <Button type="button" variant="outline" size="lg" class="h-11 w-full rounded-full" :disabled="!!busy" @click="emit('pick', 'google')">
      <LoaderCircle v-if="busy === 'google'" class="animate-spin" />
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
      </svg>
      {{ t("nav.login_google") }}
    </Button>
    <p v-if="errors.google" role="alert" class="-mt-1 text-sm text-destructive">{{ errors.google }}</p>

    <template v-if="microsoft">
      <Button type="button" variant="outline" size="lg" class="h-11 w-full rounded-full" :disabled="!!busy" @click="emit('pick', 'microsoft')">
        <LoaderCircle v-if="busy === 'microsoft'" class="animate-spin" />
        <svg v-else viewBox="0 0 23 23" aria-hidden="true">
          <path fill="#f25022" d="M1 1h10v10H1z" />
          <path fill="#7fba00" d="M12 1h10v10H12z" />
          <path fill="#00a4ef" d="M1 12h10v10H1z" />
          <path fill="#ffb900" d="M12 12h10v10H12z" />
        </svg>
        {{ t("nav.login_microsoft") }}
      </Button>
      <p v-if="errors.microsoft" role="alert" class="-mt-1 text-sm text-destructive">{{ errors.microsoft }}</p>
    </template>
  </div>
</template>
