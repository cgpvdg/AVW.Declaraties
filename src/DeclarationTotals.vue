<script setup>
import { euro } from './model'

defineProps({ totals: { type: Object, required: true }, compactLabels: Boolean })
</script>

<template>
  <div class="summary">
    <article class="card"><span>{{ compactLabels ? 'Uren' : 'Geregistreerde uren' }}</span><strong>{{ (totals.units[0] + totals.units[1] + totals.units[2]).toLocaleString('nl-NL') }} uur</strong></article>
    <article class="card"><span>Afstand</span><strong>{{ totals.units[3].toLocaleString('nl-NL') }} km</strong></article>
    <article class="card total"><span>{{ compactLabels ? 'Vergoeding' : 'Totale vergoeding' }}</span><strong>{{ euro.format(totals.total) }}</strong></article>
  </div>
</template>
