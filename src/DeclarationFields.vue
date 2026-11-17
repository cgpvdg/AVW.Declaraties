<script setup>
import { fields } from './model'
import { finishDecimal, maskDecimal } from './decimal'

defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <label v-for="[key, label, unit] in fields" :key="key">{{ label }}
    <span class="currency-field">
      <span v-if="draft[key] && unit === '€'" class="currency-prefix" aria-hidden="true">€</span>
      <input :value="draft[key]" :class="{ 'unit-input': draft[key] && unit !== '€' }" type="text" inputmode="decimal" :placeholder="unit === '€' ? '€ 0,00' : '0,00 ' + unit" @input="maskDecimal($event, draft, key)" @blur="finishDecimal(draft, key)">
      <span v-if="draft[key] && unit !== '€'" class="unit-suffix" aria-hidden="true">{{ unit }}</span>
    </span>
  </label>
</template>
