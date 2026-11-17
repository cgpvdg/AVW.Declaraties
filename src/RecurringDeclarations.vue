<script setup>
import { onMounted, ref } from 'vue'
import { addDoc, collection, deleteField, doc, getDocs, updateDoc } from 'firebase/firestore/lite'
import { db } from './firebase'
import { fields, today } from './model'
import { formatDecimal, parseDecimal } from './decimal'
import DeclarationFields from './DeclarationFields.vue'

const props = defineProps({ owner: { type: String, required: true } })
const declarations = collection(db, 'profiles', props.owner, 'recurringDeclarations')
const units = ['dag', 'week', 'maand', 'jaar']
const days = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag']
const rows = ref([])
const draft = ref(null)
const loading = ref(true)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const snapshot = await getDocs(declarations)
    rows.value = snapshot.docs.map(item => ({ ...item.data(), id: item.id }))
    loaded.value = true
  } catch {
    error.value = 'Terugkerende declaraties konden niet worden geladen.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function open(row) {
  error.value = ''
  const date = today()
  draft.value = row
    ? { ...row, days: [...row.days] }
    : { name: '', startDate: date, endDate: '', interval: 1, unit: 'week', days: [] }
  for (const [key] of fields) draft.value[key] = formatDecimal(row?.[key] ?? 0)
}

async function save() {
  const { id, name, startDate, endDate, interval, unit, days } = draft.value
  error.value = ''
  if (!name.trim()) {
    error.value = 'Vul een naam in.'
    return
  }
  const weekly = unit === 'week'
  if (weekly && !days.length) {
    error.value = 'Kies minstens één dag van de week.'
    return
  }
  const amounts = Object.fromEntries(fields.map(([key]) => [key, parseDecimal(draft.value[key] || '0')]))
  if (Object.values(amounts).some(value => !Number.isFinite(value) || value < 0 || value > 100000)) {
    error.value = 'Voer geldige waarden in tussen 0 en 100.000.'
    return
  }
  if (amounts.prep + amounts.training + amounts.guidance > 24) {
    error.value = 'Voorbereiding, training en begeleiding mogen samen maximaal 24 uur zijn.'
    return
  }
  const data = {
    name: name.trim(), startDate, endDate, repeat: true, interval, unit, ...amounts,
    days: weekly ? [...days].sort() : [],
  }
  saving.value = true
  try {
    if (id) {
      await updateDoc(doc(declarations, id), { ...data, startTime: deleteField() })
      rows.value = rows.value.map(row => row.id === id ? { ...data, id } : row)
    } else {
      const created = await addDoc(declarations, data)
      rows.value.push({ ...data, id: created.id })
    }
    draft.value = null
  } catch {
    error.value = 'Opslaan is mislukt. Probeer het opnieuw.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <button v-if="loaded && !draft" type="button" class="primary add-declaration" @click="open()">Toevoegen</button>
  <section class="card recurring">
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">Laden…</p>
    <button v-else-if="!loaded" type="button" class="secondary" @click="load">Opnieuw proberen</button>
    <form v-else-if="draft" class="recurring" @submit.prevent="save">
      <h2>{{ draft.id ? 'Terugkerende declaratie wijzigen' : 'Nieuwe terugkerende declaratie' }}</h2>
      <fieldset class="recurring-fields" :disabled="saving">
        <label>Naam<input v-model="draft.name" maxlength="120" required></label>
        <div class="form-grid">
          <label>Begindatum<input v-model="draft.startDate" type="date" max="9999-12-31" required></label>
          <label>Einddatum (optioneel)<input v-model="draft.endDate" type="date" :min="draft.startDate" max="9999-12-31"></label>
        </div>
        <div class="form-grid">
          <label>Herhalen elke<input v-model.number="draft.interval" type="number" min="1" max="100" step="1" required></label>
          <label>Periode<select v-model="draft.unit">
            <option v-for="unit in units" :key="unit">{{ unit }}</option>
          </select></label>
        </div>
        <fieldset v-if="draft.unit === 'week'" class="recurring-fields">
          <legend>Dagen</legend>
          <div class="weekdays">
            <button v-for="(day, index) in days" :key="day" type="button" class="secondary"
              :aria-label="day" :aria-pressed="draft.days.includes(index + 1)"
              @click="draft.days = draft.days.includes(index + 1) ? draft.days.filter(value => value !== index + 1) : [...draft.days, index + 1]">
              {{ day.slice(0, 2).toLowerCase() }}
            </button>
          </div>
        </fieldset>
        <div class="form-grid"><DeclarationFields :draft="draft" /></div>
      </fieldset>
      <div class="form-actions">
        <button class="primary" :disabled="saving">{{ saving ? 'Opslaan…' : 'Opslaan' }}</button>
        <button type="button" class="secondary" :disabled="saving" @click="draft = null; error = ''">Annuleren</button>
      </div>
    </form>
    <template v-else>
      <p v-if="!rows.length" class="muted">Je hebt nog geen terugkerende declaraties.</p>
      <button v-for="row in rows" :key="row.id" type="button" class="secondary recurring-name" @click="open(row)">
        {{ row.name }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.recurring, .recurring-fields { display: grid; gap: 12px; }
.recurring-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.weekdays { display: flex; flex-wrap: wrap; gap: 4px; }
.weekdays button { min-width: 44px; padding-inline: 5px; }
.weekdays button[aria-pressed='true'] { background: var(--accent); color: white; }
.recurring-name { text-align: left; overflow-wrap: anywhere; }
</style>
