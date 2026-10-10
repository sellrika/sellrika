<script setup lang="ts">
import { t } from "@/lib/i18n";
import { computed, onMounted, ref, watch } from "vue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CountrySelect from "./CountrySelect.vue";
import OptionSelect from "./OptionSelect.vue";
import { deliveryCountries } from "@validators/StoreCustomer.Validator";
import type { StoreInfo } from "@/types";

/**
 * The delivery address boxes: the checkout and the account page ask the same way.
 * The country box offers only the countries the shop's zones name
 * (one country = locked to it).
 * With the shop's postal codes downloaded (`store.guided_address` + `states`),
 * State → City are picked from lists (`GET …/address`, City searched on the server)
 * and the postal code follows the city. Else they are plain text boxes.
 * `form` is the caller's reactive object; the boxes write straight into it.
 * Every value is also a named form field (hidden inputs for the pickers),
 * so a plain HTML form (the account page) posts it.
 * Box ids are `<idPrefix>-<field>` with `_` → `-` (addr-address-1, addr-postal-code).
 */
export type AddressForm = {
	phone: string;
	address_1: string;
	address_2: string;
	city: string;
	state: string;
	country: string;
	postal_code: string;
};
const props = defineProps<{
	store: StoreInfo;
	form: AddressForm;
	errors: Partial<Record<keyof AddressForm, string>>;
	/** The shop country's states when its postal codes are downloaded (else []), so the first paint is right. */
	states?: string[];
	/** Ask for the receiver's phone too (the account's address dialog; the checkout asks it with the buyer's details). */
	withPhone?: boolean;
	/** The start of every box id (default `addr`); several forms on a page need their own. */
	idPrefix?: string;
}>();
const id = props.idPrefix ?? "addr";

const countries = deliveryCountries(props.store.delivery_zones);
const locked = countries?.length === 1;
const states = ref<string[]>(props.states ?? []);
const cities = ref<{ place: string; postal_code: string }[]>([]); // the first page (A–Z) of the state's cities, or the matches of what was typed
const citiesMore = ref(false); // the state holds more than one page — the City box then searches the server as the buyer types
const guided = computed(
	() => props.store.guided_address && states.value.length > 0,
);
const mounted = ref(false); // the watchers only run in the browser, after the caller filled the form
async function lookup(
	country: string,
	state = "",
	q = "",
): Promise<{
	states: string[];
	cities: { place: string; postal_code: string }[];
	more: boolean;
}> {
	if (!props.store.guided_address)
		return { states: [], cities: [], more: false }; // the shop asked for plain text boxes
	try {
		const res = await fetch(
			`${props.store.base}/address?country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}&q=${encodeURIComponent(q)}`,
		);
		if (res.ok) return await res.json();
	} catch {
		/* offline → text boxes */
	}
	return { states: [], cities: [], more: false };
}
/** The state's cities (`q` = what the buyer typed in the City box). A chosen city that isn't on the page is dropped only when the
 * page is the whole list — past one page the remembered city may simply be further down (the server takes the name as typed anyway). */
async function loadCities(state: string, q = "") {
	({ cities: cities.value, more: citiesMore.value } = state
		? await lookup(props.form.country || props.store.country || "", state, q)
		: { cities: [], more: false });
	if (
		guided.value &&
		!q &&
		!citiesMore.value &&
		!cities.value.some((c) => c.place === props.form.city)
	)
		props.form.city = "";
}
/**
 * The country to use instead of one the shop doesn't deliver to
 * (an address remembered from before the zones changed, or the caller filling the form after this mounted).
 * @param country - the country in the form
 * @returns the same country when it is fine, else the shop's own (when delivered to) or the first one delivered to
 */
function deliverable(country: string) {
	if (!countries || !country || countries.includes(country)) return country;
	return countries.includes(props.store.country)
		? props.store.country
		: countries[0]!;
}
watch(
	() => props.form.country,
	async (country) => {
		if (!mounted.value) return;
		const fixed = deliverable(country);
		if (fixed !== country) {
			props.form.country = fixed; // this watcher runs again with it, and clears the state and city that don't fit
			return;
		}
		states.value = (await lookup(country)).states;
		cities.value = [];
		if (guided.value && !states.value.includes(props.form.state))
			props.form.state = "";
		if (guided.value) await loadCities(props.form.state);
	},
);
watch(
	() => props.form.state,
	(state) => mounted.value && guided.value && loadCities(state),
);
/** A city picked from the list brings its postal code along (the box is read-only then — the list is the source of truth; a place with
 * no code (Myanmar…) leaves it blank and editable, whatever the buyer types into it). */
const codeFromList = ref(false);
function pickCity(place: string) {
	props.form.city = place;
	const hit = cities.value.find((c) => c.place === place);
	props.form.postal_code = hit?.postal_code || "";
	codeFromList.value = !!hit?.postal_code;
}
onMounted(async () => {
	mounted.value = true;
	props.form.country = locked
		? countries![0]!
		: deliverable(props.form.country);
	// a form that already holds an address (the account page): its country's states, then its state's cities (the watchers only see changes)
	if (props.form.country && props.form.country !== props.store.country)
		states.value = (await lookup(props.form.country)).states;
	if (guided.value && props.form.state) loadCities(props.form.state);
});
</script>

<template>
  <div v-if="withPhone" class="space-y-1.5">
    <Label :for="`${id}-phone`">{{ t("store.phone_number") }}</Label>
    <Input :id="`${id}-phone`" v-model="form.phone" name="phone" type="tel" autocomplete="tel" :aria-invalid="!!errors.phone" />
    <p v-if="errors.phone" class="text-xs text-destructive">{{ errors.phone }}</p>
  </div>
  <div class="space-y-1.5">
    <Label :for="`${id}-address-1`">{{ t("store_ui.address_1") }}</Label>
    <Input :id="`${id}-address-1`" v-model="form.address_1" name="address_1" autocomplete="address-line1" :placeholder="t('store_ui.street_and_number')" :aria-invalid="!!errors.address_1" />
    <p v-if="errors.address_1" class="text-xs text-destructive">{{ errors.address_1 }}</p>
  </div>
  <div class="space-y-1.5">
    <Label :for="`${id}-address-2`">{{ t("store_ui.address_2") }} <span class="font-normal text-muted-foreground">{{ t("store.optional_paren") }}</span></Label>
    <Input :id="`${id}-address-2`" v-model="form.address_2" name="address_2" autocomplete="address-line2" :placeholder="t('store_ui.apartment_placeholder')" :aria-invalid="!!errors.address_2" />
    <p v-if="errors.address_2" class="text-xs text-destructive">{{ errors.address_2 }}</p>
  </div>
  <div class="grid gap-4 sm:grid-cols-2">
    <!-- State first, then City: with the country's postal codes downloaded both are picked from a list and the postal code follows -->
    <div class="space-y-1.5">
      <Label :for="`${id}-state`">{{ t("store_ui.state_province") }}</Label>
      <input v-if="guided" type="hidden" name="state" :value="form.state" />
      <OptionSelect v-if="guided" :id="`${id}-state`" v-model="form.state" :options="states" :placeholder="t('store_ui.choose_state')" :search-placeholder="t('store_ui.search_state')" :empty="t('store_ui.no_state')" :invalid="!!errors.state" />
      <Input v-else :id="`${id}-state`" v-model="form.state" name="state" autocomplete="address-level1" :aria-invalid="!!errors.state" />
      <p v-if="errors.state" class="text-xs text-destructive">{{ errors.state }}</p>
    </div>
    <div class="space-y-1.5">
      <Label :for="`${id}-city`">{{ t("store_ui.city") }}</Label>
      <input v-if="guided" type="hidden" name="city" :value="form.city" />
      <OptionSelect v-if="guided" :id="`${id}-city`" :model-value="form.city" :options="cities.map((c) => c.place)" remote :more="citiesMore" :placeholder="form.state ? t('store_ui.choose_city') : t('store_ui.choose_state_first')" :search-placeholder="t('store_ui.search_city')" :empty="t('store_ui.no_city')" :disabled="!form.state" :invalid="!!errors.city" @update:model-value="pickCity" @search="(q) => loadCities(form.state, q)" />
      <Input v-else :id="`${id}-city`" v-model="form.city" name="city" autocomplete="address-level2" :aria-invalid="!!errors.city" />
      <p v-if="errors.city" class="text-xs text-destructive">{{ errors.city }}</p>
    </div>
    <div class="space-y-1.5">
      <Label :for="`${id}-country`">{{ t("store_ui.country") }}</Label>
      <input type="hidden" name="country" :value="form.country" />
      <CountrySelect :id="`${id}-country`" v-model="form.country" :invalid="!!errors.country" :disabled="locked" :only="countries" />
      <p v-if="errors.country" class="text-xs text-destructive">{{ errors.country }}</p>
      <p v-else-if="locked" class="text-xs text-muted-foreground">{{ t("store_ui.deliver_within_only", { country: countries?.[0] ?? "" }) }}</p>
    </div>
    <div class="space-y-1.5">
      <Label :for="`${id}-postal-code`">{{ t("store_ui.postal_code") }} <span v-if="!guided" class="font-normal text-muted-foreground">{{ t("store_ui.if_any") }}</span></Label>
      <Input :id="`${id}-postal-code`" v-model="form.postal_code" name="postal_code" autocomplete="postal-code" :readonly="guided && codeFromList" :placeholder="guided ? t('store_ui.postal_from_city') : undefined" :aria-invalid="!!errors.postal_code" :class="guided && codeFromList && 'opacity-80'" />
      <p v-if="errors.postal_code" class="text-xs text-destructive">{{ errors.postal_code }}</p>
    </div>
  </div>
</template>
