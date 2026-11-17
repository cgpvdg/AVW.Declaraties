<script setup>
import { computed, onMounted, ref } from 'vue'
import { collection, getDocs } from 'firebase/firestore/lite'
import { db } from './firebase'
import { dateLabel, euro, fields, summarize, today } from './model'
import NavigationIcon from './NavigationIcon.vue'
import { declarationRates, rateReader } from './rates'

const props = defineProps({ owner: String, profile: Object })
defineEmits(['open-month', 'add', 'view-all'])
const year = ref(today().slice(0, 4))
const months = ref([])
const ratesByYear = ref({})
const rates = computed(() => ratesByYear.value[year.value])
const loading = ref(true)
const failed = ref(false)
const statuses = { concept: 'Concept', submitted: 'Ingediend', approved: 'Goedgekeurd', rejected: 'Afgewezen' }
const years = computed(() => [...new Set([today().slice(0, 4), ...months.value.map(row => row.period.slice(0, 4))])].sort().reverse())
const selected = computed(() => months.value.filter(row => row.period.startsWith(year.value + '-')))
const total = computed(() => selected.value.reduce((sum, row) => sum + row.total, 0))
const recent = computed(() => selected.value.flatMap(month => month.entries)
  .sort((a, b) => b.created - a.created || b.date.localeCompare(a.date)).slice(0, 3))

async function load() {
  loading.value = true
  failed.value = false
  try {
    const headers = await getDocs(collection(db, 'profiles', props.owner, 'months'))
    const readRates = rateReader()
    const yearsWithRates = new Set([today().slice(0, 4), ...headers.docs.map(header => header.id.slice(0, 4))])
    const [configured, declarations] = await Promise.all([
      Promise.all([...yearsWithRates].map(async year => [year, (await readRates(year)).rates])),
      Promise.all(headers.docs.map(async header => {
        const entries = await getDocs(collection(header.ref, 'entries'))
        if (entries.empty) return null
        const data = header.data()
        const rates = await declarationRates(header.id, data, readRates)
        return {
          period: header.id, status: data.status ?? 'concept',
          total: summarize(entries.docs.map(entry => entry.data()), rates, data.level).total,
          entries: entries.docs.map(entry => {
            const row = entry.data()
            return { ...row, created: row.createdAt?.toMillis() ?? Date.parse(row.date + 'T00:00:00Z'),
              total: summarize([row], rates, data.level).total }
          }),
        }
      })),
    ])
    months.value = declarations.filter(Boolean).sort((a, b) => b.period.localeCompare(a.period))
    ratesByYear.value = Object.fromEntries(configured)
  } catch (failure) {
    console.error(failure)
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="dashboard">
    <div class="dashboard-filter">
      <h1 class="page-heading-with-icon"><NavigationIcon name="dashboard" />Dashboard</h1>
      <label>Jaar<select v-model="year" :disabled="loading"><option v-for="option in years" :key="option">{{ option }}</option></select></label>
    </div>
    <p v-if="loading" role="status">Dashboard laden…</p>
    <div v-else-if="failed" class="card">
      <p role="alert">Het dashboard kon niet worden geladen.</p>
      <button class="secondary" @click="load">Opnieuw proberen</button>
    </div>
    <template v-else>
      <div class="dashboard-statuses">
        <div v-for="(label, status) in statuses" :key="status" class="card dashboard-status" :class="'declaration-' + status">
          <strong>{{ selected.filter(row => row.status === status).length }}</strong><span>{{ label }}</span>
        </div>
      </div>
      <button class="primary" @click="$emit('add')">Declaratie toevoegen</button>
      <section class="card">
        <div class="section-header"><h2>Recente declaraties</h2><button class="link" @click="$emit('view-all', year)">Alles bekijken</button></div>
        <p v-if="!selected.length" class="muted">Nog geen declaraties in {{ year }}.</p>
        <ul class="entry-list">
          <li v-for="row in recent" :key="row.date">
            <button class="secondary dashboard-month" @click="$emit('open-month', row.date.slice(0, 7))">
              <span><strong class="entry-date">{{ dateLabel.format(new Date(row.date + 'T00:00:00Z')) }}</strong>
                <span class="metrics"><span v-for="[key, label, unit] in fields.filter(([key]) => row[key] > 0)" :key="key" :class="{ 'hour-type': unit === 'uur' }" :data-type="key">{{ label }} · {{ unit === '€' ? euro.format(row[key]) : row[key].toLocaleString('nl-NL') + ' ' + unit }}</span></span>
              </span>
              <strong>{{ euro.format(row.total) }}</strong>
            </button>
          </li>
        </ul>
      </section>
      <section class="card dashboard-total">
        <h2>Totale vergoeding {{ year }}</h2>
        <strong>{{ euro.format(total) }}</strong>
        <p class="muted">{{ selected.length }} {{ selected.length === 1 ? 'maanddeclaratie' : 'maanddeclaraties' }}</p>
      </section>
      <section class="card dashboard-rates">
        <h2>Vergoedingen · Niveau {{ profile.level }}</h2>
        <template v-if="rates">
          <p>Voorbereiding <strong>{{ euro.format(rates['level' + profile.level]) }} / uur</strong></p>
          <p>Training <strong>{{ euro.format(rates['level' + profile.level]) }} / uur</strong></p>
          <p>Begeleiding <strong>{{ euro.format(rates.guidance) }} / uur</strong></p>
          <p>Kilometers <strong>{{ euro.format(rates.kilometers) }} / km</strong></p>
        </template>
        <p v-else class="muted">De vergoedingen zijn nog niet ingesteld.</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.dashboard { display: grid; gap: 10px; }
.dashboard .card { padding: 10px 12px; }
.dashboard h2 { font-size: 1rem; }
.dashboard-filter { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.dashboard-filter label { display: flex; align-items: center; gap: 8px; color: #526166; }
.dashboard-statuses { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.dashboard .dashboard-status { display: grid; gap: 0; padding: 8px 4px; text-align: center; }
.dashboard-status span { font-size: .78rem; overflow-wrap: anywhere; }
.dashboard-status strong, .dashboard-total > strong { font-size: 1.35rem; }
.dashboard .entry-list { margin: 0; }
.dashboard .entry-list li { padding: 4px 0; }
.dashboard .section-header { gap: 4px; }
.dashboard .section-header button { padding: 6px 0; }
.dashboard-month { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: left; }
.dashboard-total, .dashboard-rates { display: grid; gap: 4px; }
.dashboard-total { grid-template-columns: 1fr auto; align-items: center; }
.dashboard-total p { grid-column: 1 / -1; }
.dashboard-rates p { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
@media (max-width: 360px) { .dashboard-statuses { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
