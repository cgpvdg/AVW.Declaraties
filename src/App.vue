<script setup>
import { computed, ref, watch } from 'vue'
import { createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, runTransaction, setDoc, deleteDoc, updateDoc } from 'firebase/firestore/lite'
import { auth, db } from './firebase'
import { dateLabel, euro, fields, initialRates, monthLabel, summarize, today } from './model'
import logo from './logo.png'
import DeclarationTotals from './DeclarationTotals.vue'

const registering = ref(false)
const registration = ref({ name: '', level: 1 })
let submittingRegistration = false
const email = ref('')
const password = ref('')
const account = ref(null)
const profile = ref(null)
const trainers = ref([])
const declarationTrainers = computed(() => trainers.value.filter(trainer => trainer.status !== 'pending'))
const uid = ref('')
const month = ref(today().slice(0, 7))
const records = ref([])
const sheet = ref(null)
const entryDialog = ref(null)
const rateDraft = ref(formatRates(initialRates))
const editing = ref(null)
const panel = ref('declarations')
const pageTitle = computed(() => ({
  profile: 'Profiel',
  annual: 'Jaaroverzicht',
  overview: 'Maandoverzicht',
  annualAdmin: 'Jaaroverzicht',
  trainers: 'Trainers',
  rates: 'Vergoedingen',
  declarations: isAdmin.value ? 'Declaraties' : 'Mijn declaraties',
})[panel.value])
const menu = ref(null)
const profileDraft = ref({ name: '', level: null })

function navigate(destination) {
  menu.value.open = false
  panel.value = destination
  error.value = ''
  notice.value = ''
  if (destination === 'profile') {
    profileDraft.value = { name: profile.value.name, level: profile.value.level ?? null }
  }
}

function saveProfile() {
  const { name, level } = profileDraft.value
  return action(async () => {
    const changes = hasTrainerRole(profile.value) ? { name, level } : { name }
    await updateDoc(doc(db, 'profiles', account.value.uid), changes)
    profile.value = { ...profile.value, ...changes }
    trainers.value = trainers.value.map(trainer => trainer.id === account.value.uid
      ? { ...trainer, name, level } : trainer).sort((a, b) => a.name.localeCompare(b.name, 'nl'))
    notice.value = 'Profiel opgeslagen.'
  }, 'Je profiel kon niet worden opgeslagen.')
}
const loading = ref(Boolean(auth))
const reading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const mode = ref('beheerder')
const trainerDraft = ref(null)
const hasTrainerRole = current => current?.role === 'trainer' || current?.trainer === true
const canTrain = current => hasTrainerRole(current) && (current.status ?? 'active') === 'active' &&
  [1, 2, 3, 4].includes(current.level)
const isAdmin = computed(() => profile.value?.role === 'beheerder' && mode.value === 'beheerder')
const statusLabel = current => ({ pending: 'Wacht op verificatie', inactive: 'Inactief', deleted: 'Verwijderd' })[current.status] ?? 'Actief'

function switchMode(value) {
  navigate('declarations')
  mode.value = value
  panel.value = 'declarations'
  editing.value = null
  trainerDraft.value = null
  uid.value = value === 'trainer' ? account.value.uid : declarationTrainers.value[0]?.id ?? ''
  loadMonth()
}

function setTrainers(users) {
  trainers.value = users.docs.map(item => ({ ...item.data(), id: item.id }))
    .filter(hasTrainerRole).sort((a, b) => a.name.localeCompare(b.name, 'nl'))
}

function submitLogin() {
  if (!registering.value) {
    return action(() => signInWithEmailAndPassword(auth, email.value.trim(), password.value),
      'Inloggen mislukt. Controleer je e-mailadres en wachtwoord.')
  }
  const { name, level } = registration.value
  return action(async () => {
    submittingRegistration = true
    try {
      let credential
      try {
        credential = await createUserWithEmailAndPassword(auth, email.value.trim(), password.value)
      } catch (failure) {
        if (failure.code !== 'auth/email-already-in-use') throw failure
        credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value)
      }
      const target = doc(db, 'profiles', credential.user.uid)
      await runTransaction(db, async tx => {
        const existing = await tx.get(target)
        if (!existing.exists()) tx.set(target, { name, level, role: 'trainer', status: 'pending' })
        else if (existing.data().status !== 'pending') throw { userMessage: 'Dit account bestaat al. Kies Inloggen.' }
      })
      registering.value = false
      notice.value = 'Je account is aangemaakt en wacht op verificatie door een beheerder.'
    } finally {
      password.value = ''
      try { if (auth.currentUser) await signOut(auth) }
      finally { submittingRegistration = false }
    }
  }, 'Registreren is mislukt. Controleer je gegevens of neem contact op met de beheerder.')
}

function rejectTrainer(trainer) {
  if (!window.confirm('Aanvraag van ' + trainer.name + ' afkeuren?')) return
  return action(async () => {
    const target = doc(db, 'profiles', trainer.id)
    await runTransaction(db, async tx => {
      const current = await tx.get(target)
      if (current.data()?.status !== 'pending') throw { userMessage: 'Deze aanvraag wacht niet meer op verificatie.' }
      tx.set(doc(db, 'rejectedTrainers', trainer.id), { rejected: true })
      tx.delete(target)
    })
    setTrainers(await getDocs(collection(db, 'profiles')))
    if (uid.value === trainer.id) uid.value = declarationTrainers.value[0]?.id ?? ''
    if (trainerDraft.value?.id === trainer.id) trainerDraft.value = null
    notice.value = 'Aanvraag afgekeurd en trainerprofiel verwijderd.'
  }, 'De aanvraag kon niet worden afgekeurd.')
}

function saveTrainer() {
  const { id, name, level, status, pending } = trainerDraft.value
  const target = doc(db, 'profiles', id)
  return action(async () => {
    await runTransaction(db, async tx => {
      const found = await tx.get(target)
      if (!found.exists() || (found.data().status === 'pending') !== pending) throw { userMessage: 'Dit profiel is gewijzigd of bestaat al. Open het profiel opnieuw.' }
      const data = { name: name.trim(), level, status }
      tx.update(target, data)
    })
    if (id === account.value.uid) profile.value = { ...profile.value, name: name.trim(), level, status }
    setTrainers(await getDocs(collection(db, 'profiles')))
    if (!uid.value) uid.value = declarationTrainers.value[0]?.id ?? ''
    trainerDraft.value = null
    notice.value = 'Trainerprofiel opgeslagen.'
  }, 'Het trainerprofiel kon niet worden opgeslagen.')
}
const annualMonths = ref([])
const annualYear = ref('')
const annualLoading = ref(false)
const annualError = ref(false)
const annualYears = computed(() => [...new Set(annualMonths.value.map(item => item.period.slice(0, 4)))])
const yearMonths = computed(() => {
  const months = new Map()
  for (const item of annualMonths.value) {
    if (!item.period.startsWith(annualYear.value + '-')) continue
    const monthly = months.get(item.period) ?? { period: item.period, units: [0, 0, 0, 0, 0], total: 0 }
    item.units.forEach((value, index) => { monthly.units[index] += value })
    monthly.total += item.total
    months.set(item.period, monthly)
  }
  return isAdmin.value ? [...months.values()] : [...months.values()].reverse()
})
const annualTotals = computed(() => yearMonths.value.reduce((sum, item) => {
  item.units.forEach((value, index) => { sum.units[index] += value })
  sum.total += item.total
  return sum
}, { units: [0, 0, 0, 0, 0], total: 0 }))

watch([panel, account, isAdmin], async ([destination, user, admin], _, onCleanup) => {
  if (!user || destination !== (admin ? 'annualAdmin' : 'annual')) return
  let active = true
  onCleanup(() => { active = false })
  annualMonths.value = []
  annualError.value = false
  annualLoading.value = true
  try {
    const owners = admin ? declarationTrainers.value.map(trainer => trainer.id) : [user.uid]
    const headers = await Promise.all(owners.map(owner => getDocs(collection(db, 'profiles', owner, 'months'))))
    if (!active) return
    const months = await Promise.all(headers.flatMap(snapshot => snapshot.docs).map(async header => {
      const entries = await getDocs(collection(header.ref, 'entries'))
      if (entries.empty) return null
      const { rates, level } = header.data()
      return { period: header.id, ...summarize(entries.docs.map(entry => entry.data()), rates, level) }
    }))
    if (!active) return
    annualMonths.value = months.filter(Boolean).sort((a, b) => b.period.localeCompare(a.period))
    if (!annualYears.value.includes(annualYear.value)) annualYear.value = annualYears.value[0] ?? ''
  } catch (failure) {
    if (active) annualError.value = true
    console.error(failure)
  } finally {
    if (active) annualLoading.value = false
  }
})

const displayRecords = computed(() => isAdmin.value ? records.value : [...records.value].reverse())
const totals = computed(() => summarize(records.value, sheet.value?.rates, sheet.value?.level))
const caption = computed(() => month.value ? monthLabel.format(new Date(month.value + '-01T00:00:00Z')) : 'Kies een maand')
const rateRef = () => doc(db, 'settings', 'rates')

async function action(callback, message) {
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await callback() } catch (failure) {
    console.error(failure)
    error.value = failure.userMessage || message
  } finally { busy.value = false }
}

let authVersion = 0
if (auth) onAuthStateChanged(auth, async (user) => {
  if (submittingRegistration && user) return
  const version = ++authVersion
  loading.value = true
  if (menu.value) menu.value.open = false
  account.value = user
  profile.value = null
  uid.value = ''
  trainers.value = []
  editing.value = null
  panel.value = 'declarations'
  trainerDraft.value = null
  try {
    if (!user) return
    const current = (await getDoc(doc(db, 'profiles', user.uid))).data()
    if (!current || !['trainer', 'beheerder'].includes(current.role)) {
      if (version === authVersion) error.value = 'Voor dit account is nog geen AVW-profiel ingesteld.'
      return
    }
    if (current.role !== 'beheerder' && !canTrain(current)) {
      if (version === authVersion) {
        await signOut(auth)
        error.value = current.status === 'pending'
          ? 'Je account is nog niet geverifieerd door een beheerder.'
          : 'Je trainerprofiel is inactief of nog niet volledig ingesteld.'
      }
      return
    }
    mode.value = current.role
    const [rateSnap, users] = await Promise.all([
      getDoc(rateRef()),
      current.role === 'beheerder' ? getDocs(collection(db, 'profiles')) : null,
    ])
    if (version !== authVersion) return

    rateDraft.value = formatRates(rateSnap.data() ?? initialRates)
    if (users) setTrainers(users)
    profile.value = current
    uid.value = current.role === 'trainer' ? user.uid : declarationTrainers.value[0]?.id ?? ''
  } catch (failure) {
    if (version === authVersion) error.value = 'De profielgegevens konden niet worden geladen.'
    console.error(failure)
  } finally { if (version === authVersion) loading.value = false }
})

const monthRef = (owner, period) => doc(db, 'profiles', owner, 'months', period)
let readVersion = 0
const overviewRows = ref([])
const overviewTotal = computed(() => overviewRows.value.reduce((sum, row) => sum + row.total, 0))
const overviewLoading = ref(false)
const overviewError = ref(false)

watch([panel, month, isAdmin], async ([destination, period, admin], _, onCleanup) => {
  if (destination !== 'overview' || !admin) return
  let active = true
  onCleanup(() => { active = false })
  overviewRows.value = []
  overviewError.value = false
  overviewLoading.value = Boolean(period)
  if (!period) return
  try {
    const rows = await Promise.all(declarationTrainers.value.map(async trainer => {
      const target = monthRef(trainer.id, period)
      const header = (await getDoc(target)).data()
      if (!header) return { trainer, total: 0 }
      const entries = await getDocs(collection(target, 'entries'))
      return { trainer, total: summarize(entries.docs.map(entry => entry.data()), header.rates, header.level).total }
    }))
    if (active) overviewRows.value = rows
  } catch (failure) {
    if (active) overviewError.value = true
    console.error(failure)
  } finally {
    if (active) overviewLoading.value = false
  }
})

async function loadMonth() {
  const version = ++readVersion
  editing.value = null
  records.value = []
  sheet.value = null
  reading.value = false
  if (!uid.value || !month.value || !profile.value) return
  reading.value = true
  const target = monthRef(uid.value, month.value)
  try {
    const [header, lines] = await Promise.all([getDoc(target), getDocs(collection(target, 'entries'))])
    if (version !== readVersion) return
    sheet.value = header.data() ?? null
    records.value = lines.docs.map(item => item.data()).sort((a, b) => a.date.localeCompare(b.date))
  } catch (failure) {
    if (version === readVersion) error.value = 'De maand kon niet worden geladen.'
    console.error(failure)
  } finally { if (version === readVersion) reading.value = false }
}
watch([uid, month], loadMonth)
watch(entryDialog, dialog => dialog?.showModal(), { flush: 'post' })
function changeMonth(offset) {
  const date = new Date((month.value || today().slice(0, 7)) + '-01T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + offset)
  month.value = date.toISOString().slice(0, 7)
}
const lastDate = computed(() => {
  if (!month.value) return ''
  const [year, number] = month.value.split('-').map(Number)
  return month.value + '-' + new Date(Date.UTC(year, number, 0)).getUTCDate()
})
function formatDecimal(value) {
  return value.toFixed(2).replace('.', ',')
}
function parseDecimal(value) {
  return Number(value.replace(',', '.'))
}
function formatRates(rates) {
  return Object.fromEntries(Object.entries(initialRates).map(([key, fallback]) => [key, formatDecimal(rates[key] ?? fallback)]))
}
function maskDecimal(event, draft, key) {
  const input = event.target
  const value = input.value.replace('.', ',')
  if (/^\d{0,6}(,\d{0,2})?$/.test(value)) draft[key] = value
  input.value = draft[key]
}
function finishDecimal(draft, key) {
  const value = draft[key]
  if (value && value !== ',') draft[key] = formatDecimal(parseDecimal(value))
  else draft[key] = ''
}
function openEntry(row) {
  error.value = ''
  editing.value = row ? { ...row, original: row.date } : {
    date: today().startsWith(month.value + '-') ? today() : month.value + '-01',
    notes: '',
  }
  for (const [key] of fields) editing.value[key] = row ? formatDecimal(row[key]) : ''
}
function saveEntry() {
  const { original, ...row } = editing.value
  if (!row.date.startsWith(month.value + '-') || row.date > lastDate.value) {
    error.value = 'Kies een datum binnen de geselecteerde maand.'
    return
  }
  for (const [key, label, unit] of fields) {
    const value = row[key] === ',' ? 0 : parseDecimal(row[key])
    const max = unit === 'uur' ? 24 : 100000
    if (!Number.isFinite(value) || value > max) {
      error.value = label + ' mag maximaal ' + max + ' zijn.'
      return
    }
    row[key] = value
  }
  if (row.prep + row.training + row.guidance > 24) {
    error.value = 'De totale tijd mag maximaal 24 uur per dag zijn.'
    return
  }
  const target = monthRef(uid.value, month.value)
  const dest = doc(target, 'entries', row.date.slice(-2))
  const source = original && doc(target, 'entries', original.slice(-2))
  return action(async () => {
    await runTransaction(db, async tx => {
      const header = await tx.get(target)
      const existing = await tx.get(dest)
      if (existing.exists() && original !== row.date) {
        throw { userMessage: 'Er bestaat al een regel voor deze datum. Open die regel om hem aan te passen.' }
      }
      if (!header.exists()) {
        const currentRates = await tx.get(rateRef())
        if (!currentRates.exists()) throw { userMessage: 'De beheerder moet eerst de vergoedingenstaffel opslaan.' }
        tx.set(target, { name: profile.value.name, level: profile.value.level, rates: currentRates.data() })
      }
      tx.set(dest, row)
      if (source && original !== row.date) tx.delete(source)
    })
    await loadMonth()
    notice.value = 'Regel opgeslagen.'
  }, 'De regel kon niet worden opgeslagen.')
}
function removeEntry() {
  if (!window.confirm('Deze regel verwijderen?')) return
  const target = doc(monthRef(uid.value, month.value), 'entries', editing.value.original.slice(-2))
  return action(async () => {
    await deleteDoc(target)
    await loadMonth()
    notice.value = 'Regel verwijderd.'
  }, 'De regel kon niet worden verwijderd.')
}
function saveRates() {
  return action(async () => {
    const values = Object.entries(rateDraft.value).map(([key, value]) => [key, value ? parseDecimal(value) : NaN])
    if (values.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 100000)) {
      throw { userMessage: 'Vul voor elk tarief een bedrag tussen 0,00 en 100.000,00 in.' }
    }
    const rates = Object.fromEntries(values)
    await setDoc(rateRef(), rates)
    rateDraft.value = formatRates(rates)

    notice.value = 'Vergoedingen opgeslagen.'
  }, 'De staffel kon niet worden opgeslagen.')
}
function exportSheet() {
  return action(async () => {
    const { downloadDeclaration } = await import('./export')
    await downloadDeclaration(month.value, sheet.value, records.value)
  }, 'De Excel-export is mislukt.')
}
function resetPassword() {
  if (!document.querySelector('#email').reportValidity()) return
  return action(async () => {
    await sendPasswordResetEmail(auth, email.value.trim())
    notice.value = 'Als dit adres bekend is, ontvang je een e-mail om je wachtwoord te wijzigen.'
  }, 'De wachtwoordmail kon niet worden aangevraagd.')
}
</script>

<template>
  <header class="topbar">
    <div class="top-inner">
      <img :src="logo" alt="AVW Atletiekvereniging Wieringermeer e.o.">
      <details v-if="account" ref="menu" class="header-menu" @keydown.esc.stop="menu.open = false; menu.querySelector('summary').focus()">
        <summary aria-label="Navigatiemenu"><span aria-hidden="true">☰</span></summary>
        <div class="menu-backdrop" aria-hidden="true" @click="menu.open = false"></div>
        <nav class="menu-links" aria-label="Hoofdnavigatie">
          <img class="menu-logo" :src="logo" alt="AVW Atletiekvereniging Wieringermeer e.o.">
          <template v-if="profile">
            <span class="menu-user">{{ profile.name }} · {{ isAdmin ? 'Beheerder' : 'Trainer' }}{{ hasTrainerRole(profile) && profile.level ? ' · Niveau ' + profile.level : '' }}</span>
            <button class="menu-profile" :aria-current="panel === 'profile' ? 'page' : undefined" :disabled="busy" @click="navigate('profile')">Profiel</button>
            <button :aria-current="panel === 'declarations' ? 'page' : undefined" :disabled="busy" @click="navigate('declarations')">Declaraties</button>
            <button v-if="!isAdmin" :aria-current="panel === 'annual' ? 'page' : undefined" :disabled="busy" @click="navigate('annual')">Jaaroverzicht</button>
            <template v-if="isAdmin">
              <button :aria-current="panel === 'overview' ? 'page' : undefined" :disabled="busy" @click="navigate('overview')">Maandoverzicht</button>
              <button :aria-current="panel === 'annualAdmin' ? 'page' : undefined" :disabled="busy" @click="navigate('annualAdmin')">Jaaroverzicht</button>
              <button :aria-current="panel === 'trainers' ? 'page' : undefined" :disabled="busy" @click="navigate('trainers')">Trainers</button>
              <button :aria-current="panel === 'rates' ? 'page' : undefined" :disabled="busy" @click="navigate('rates')">Vergoedingen</button>
            </template>
            <button v-if="profile.role === 'beheerder' && canTrain(profile)" :disabled="busy" @click="switchMode(isAdmin ? 'trainer' : 'beheerder')">Verder als {{ isAdmin ? 'trainer' : 'beheerder' }}</button>
          </template>
          <button class="menu-logout" :disabled="busy" @click="action(() => signOut(auth), 'Uitloggen is mislukt.')">Uitloggen</button>
        </nav>
      </details>
    </div>
  </header>
  <main>
    <div v-if="error" role="alert" class="banner error">{{ error }}</div>
    <div v-if="notice" role="status" class="banner success">{{ notice }}</div>
    <p v-if="loading" role="status">Gegevens laden…</p>
    <section v-else-if="!account" class="login">
      <h1 class="page-heading">{{ registering ? 'Traineraccount aanmaken' : 'Trainerdeclaraties' }}</h1>
      <form class="card login-form" @submit.prevent="submitLogin">
        <p v-if="registering" class="muted">Een beheerder moet je aanvraag goedkeuren voordat je declaraties kunt invoeren.</p>
        <template v-if="registering">
          <label>Naam<input v-model.trim="registration.name" autocomplete="name" required maxlength="120"></label>
          <label>Niveau<select v-model.number="registration.level" required><option v-for="level in 4" :key="level" :value="level">{{ level }}</option></select></label>
        </template>
        <div v-if="!auth" class="banner">De Firebase-verbinding moet nog worden ingesteld.</div>
        <label>E-mailadres<input id="email" v-model="email" type="email" autocomplete="username" required></label>
        <label>Wachtwoord<input v-model="password" type="password" :autocomplete="registering ? 'new-password' : 'current-password'" :minlength="registering ? 6 : undefined" required></label>
        <button class="primary" :disabled="!auth || busy">{{ registering ? 'Account aanmaken' : 'Inloggen' }} <span aria-hidden="true">→</span></button>
        <button type="button" class="link" :disabled="!auth || busy" @click="registering = !registering; password = ''; error = ''; notice = ''">{{ registering ? 'Terug naar inloggen' : 'Account aanmaken' }}</button>
        <button v-if="!registering" type="button" class="link" :disabled="!auth || busy" @click="resetPassword">Wachtwoord vergeten?</button>
      </form>
    </section>
    <template v-else-if="profile">
      <h1 class="page-heading">{{ pageTitle }}</h1>
      <form v-if="panel === 'profile'" class="card settings" @submit.prevent="saveProfile">
        <label>Naam<input v-model.trim="profileDraft.name" :disabled="busy" required maxlength="120"></label>
        <label v-if="hasTrainerRole(profile)">Niveau<select v-model="profileDraft.level" :disabled="busy" required>
          <option :value="null" disabled>Kies een niveau</option>
          <option v-for="level in 4" :key="level" :value="level">{{ level }}</option>
        </select></label>
        <button class="primary" :disabled="busy">Opslaan</button>
      </form>
      <section v-else-if="panel === 'trainers'" class="card settings">
        <form v-if="trainerDraft" class="settings" @submit.prevent="saveTrainer">
          <label>Naam<input v-model.trim="trainerDraft.name" maxlength="120" required></label>
          <label>Niveau<select v-model.number="trainerDraft.level" required>
            <option v-for="level in 4" :key="level" :value="level">{{ level }}</option>
          </select></label>
          <label v-if="!trainerDraft.pending">Status<select v-model="trainerDraft.status">
            <option value="active">Actief</option><option value="inactive">Inactief</option><option value="deleted">Verwijderd</option>
          </select></label>
          <div class="form-actions">
            <button class="primary" :disabled="busy">{{ trainerDraft.pending ? 'Verifiëren' : 'Opslaan' }}</button>
            <button type="button" class="secondary" :disabled="busy" @click="trainerDraft = null">Annuleren</button>
          </div>
        </form>
        <ul class="entry-list trainer-list">
          <li v-for="trainer in trainers" :key="trainer.id">
            <div><strong>{{ trainer.name }}</strong><p class="muted">{{ statusLabel(trainer) }} · Niveau {{ trainer.level ?? 'instellen' }}</p></div>
            <button class="secondary" :disabled="busy" @click="trainerDraft = { ...trainer, level: trainer.level ?? 1, pending: trainer.status === 'pending', status: trainer.status === 'pending' ? 'active' : (trainer.status ?? 'active') }">{{ trainer.status === 'pending' ? 'Verifiëren' : 'Bewerken' }}</button>
            <button v-if="trainer.status === 'pending'" class="secondary danger" :disabled="busy" @click="rejectTrainer(trainer)">Afkeuren</button>
          </li>
        </ul>
      </section>
      <template v-else-if="panel === 'annual' || panel === 'annualAdmin'">
        <p v-if="annualLoading" role="status">Jaaroverzicht laden…</p>
        <p v-else-if="annualError" class="banner error" role="alert">Het jaaroverzicht kon niet worden geladen.</p>
        <p v-else-if="!annualYears.length" class="card">{{ isAdmin ? 'Er zijn nog geen declaraties ingevoerd.' : 'Je hebt nog geen declaraties ingevoerd.' }}</p>
        <template v-else>
          <section class="card period">
            <label>
              <select v-model="annualYear" aria-label="Jaar">
                <option v-for="year in annualYears" :key="year" :value="year">{{ year }}</option>
              </select>
            </label>
          </section>
          <div v-if="isAdmin" class="summary overview-summary">
            <article class="card total"><span>Totale vergoeding</span><strong>{{ euro.format(annualTotals.total) }}</strong></article>
          </div>
          <DeclarationTotals v-else :totals="annualTotals" compact-labels />
          <section class="card entries">
            <h2 :class="isAdmin ? 'overview-heading' : 'eyebrow month-caption'">{{ isAdmin ? 'Vergoeding per maand' : 'Per maand' }}</h2>
            <ul class="entry-list" :class="{ 'year-month-list': !isAdmin }">
              <li v-for="item in yearMonths" :key="item.period" class="annual-month">
                <button type="button" class="secondary annual-month-link" @click="month = item.period; navigate(isAdmin ? 'overview' : 'declarations')">
                  <strong>{{ monthLabel.format(new Date(item.period + '-01T00:00:00Z')) }}</strong>
                  <span v-if="!isAdmin">{{ (item.units[0] + item.units[1] + item.units[2]).toLocaleString('nl-NL') }} uur</span>
                  <strong>{{ euro.format(item.total) }}</strong>
                </button>
              </li>
            </ul>
          </section>
        </template>
      </template>
      <template v-else-if="panel === 'overview'">
        <section class="card period">
          <label>
            <span class="month-picker">
              <button class="secondary" aria-label="Vorige maand" @click="changeMonth(-1)">‹</button>
              <input v-model="month" type="month" aria-label="Maand">
              <button class="secondary" aria-label="Volgende maand" @click="changeMonth(1)">›</button>
            </span>
          </label>
        </section>
        <p v-if="overviewLoading" role="status">Overzicht laden…</p>
        <p v-else-if="overviewError" class="banner error" role="alert">Het overzicht kon niet worden geladen.</p>
        <template v-else-if="month">
          <div class="summary overview-summary">
            <article class="card total"><span>Totale vergoeding</span><strong>{{ euro.format(overviewTotal) }}</strong></article>
          </div>
          <section class="card entries">
            <h2 class="overview-heading">Vergoeding per trainer</h2>
            <p v-if="!overviewRows.length" class="empty">Er zijn nog geen trainers.</p>
            <ul v-else class="entry-list">
              <li v-for="{ trainer, total } in overviewRows" :key="trainer.id" class="annual-month">
                <button type="button" class="secondary annual-month-link" @click="uid = trainer.id; navigate('declarations')">
                  <strong>{{ trainer.name }}</strong>
                  <strong>{{ euro.format(total) }}</strong>
                </button>
              </li>
            </ul>
          </section>
        </template>
      </template>
      <form v-else-if="panel === 'rates'" class="card settings" @submit.prevent="saveRates">
        <p class="muted">De ingestelde tarieven gelden voor nieuw aangemaakte maanddeclaraties.</p>
        <fieldset :disabled="busy" class="form-grid rate-grid">
          <label v-for="level in 4" :key="level">Niveau {{ level }} · €/uur
            <span class="currency-field"><span v-if="rateDraft['level' + level]" class="currency-prefix" aria-hidden="true">€</span><input :value="rateDraft['level' + level]" type="text" inputmode="decimal" placeholder="€ 0,00" @input="maskDecimal($event, rateDraft, 'level' + level)" @blur="finishDecimal(rateDraft, 'level' + level)" required></span>
          </label>
          <label>Begeleiding · €/uur<span class="currency-field"><span v-if="rateDraft['guidance']" class="currency-prefix" aria-hidden="true">€</span><input :value="rateDraft['guidance']" type="text" inputmode="decimal" placeholder="€ 0,00" @input="maskDecimal($event, rateDraft, 'guidance')" @blur="finishDecimal(rateDraft, 'guidance')" required></span></label>
          <label>Kilometervergoeding · €/km<span class="currency-field"><span v-if="rateDraft['kilometers']" class="currency-prefix" aria-hidden="true">€</span><input :value="rateDraft['kilometers']" type="text" inputmode="decimal" placeholder="€ 0,00" @input="maskDecimal($event, rateDraft, 'kilometers')" @blur="finishDecimal(rateDraft, 'kilometers')" required></span></label>
        </fieldset>
        <button class="primary" :disabled="busy">Staffel opslaan</button>
      </form>
      <template v-else>
        <section class="card period">
          <label v-if="isAdmin">
            <select v-model="uid" aria-label="Trainer" :disabled="busy">
              <option v-if="!declarationTrainers.length" value="">Geen trainers gevonden</option>
              <option v-for="trainer in declarationTrainers" :key="trainer.id" :value="trainer.id">{{ trainer.name }}{{ trainer.status && trainer.status !== 'active' ? ' · ' + statusLabel(trainer) : '' }}</option>
            </select>
          </label>
          <label>
            <span class="month-picker">
              <button class="secondary" aria-label="Vorige maand" :disabled="busy" @click="changeMonth(-1)">‹</button>
              <input v-model="month" type="month" aria-label="Declaratiemaand" :disabled="busy">
              <button class="secondary" aria-label="Volgende maand" :disabled="busy" @click="changeMonth(1)">›</button>
            </span>
          </label>
          <button class="secondary" :disabled="!sheet || reading || busy" @click="exportSheet">
            <svg class="export-icon" viewBox="0 0 20 20" aria-hidden="true">
              <rect x="2" y="2" width="16" height="16" rx="3" fill="#107c41"/>
              <path d="m6.5 6.5 7 7m0-7-7 7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Exporteren
          </button>
        </section>
        <p v-if="reading" role="status">Declaratie laden…</p>
        <template v-else>
          <DeclarationTotals :totals="totals" compact-labels />
          <button v-if="!isAdmin" class="primary add-declaration" :disabled="!month || busy" @click="openEntry()">Declaratie toevoegen</button>
          <section class="card entries">
            <div class="section-header">
              <div><span class="eyebrow month-caption">{{ caption }}</span></div>
            </div>
            <p v-if="!records.length" class="empty">Voor deze maand zijn er nog geen regels.</p>
            <ul v-else class="entry-list declaration-list">
              <li v-for="row in displayRecords" :key="row.date">
                <div><strong class="entry-date">{{ dateLabel.format(new Date(row.date + 'T00:00:00Z')) }}</strong>
                  <div class="metrics"><span v-for="[key, label, unit] in fields" :key="key" v-show="row[key]">{{ label }} · {{ unit === '€' ? euro.format(row[key]) : row[key].toLocaleString('nl-NL') + ' ' + unit }}</span></div>
                  <p v-if="row.notes" class="notes">{{ row.notes }}</p>
                </div>
                <button v-if="!isAdmin" class="secondary" :disabled="busy" @click="openEntry(row)">Bewerken</button>
              </li>
            </ul>
          </section>
        </template>
      </template>
      <dialog v-if="editing" ref="entryDialog" aria-labelledby="entry-title" @cancel.prevent="!busy && (editing = null)">
        <form @submit.prevent="saveEntry">
          <div class="section-header"><h2 id="entry-title">{{ editing.original ? 'Declaratie aanpassen' : 'Toevoegen' }}</h2><button type="button" class="secondary" :disabled="busy" @click="editing = null">Sluiten</button></div>
          <div v-if="error" class="banner error" role="alert">{{ error }}</div>
          <label>Datum<input v-model="editing.date" type="date" required :disabled="busy" :min="month + '-01'" :max="lastDate"></label>
          <fieldset class="form-grid" :disabled="busy">
            <label v-for="[key, label, unit] in fields" :key="key">{{ label }} ({{ unit }})
              <span class="currency-field">
                <span v-if="editing[key] && unit === '€'" class="currency-prefix" aria-hidden="true">€</span>
                <input :value="editing[key]" :class="{ 'unit-input': editing[key] && unit !== '€' }" type="text" inputmode="decimal" :placeholder="unit === '€' ? '€ 0,00' : '0,00 ' + unit" @input="maskDecimal($event, editing, key)" @blur="finishDecimal(editing, key)">
                <span v-if="editing[key] && unit !== '€'" class="unit-suffix" aria-hidden="true">{{ unit }}</span>
              </span>
            </label>
            <label class="wide">Opmerkingen<textarea v-model="editing.notes" rows="2" maxlength="1000"></textarea></label>
          </fieldset>
          <div class="form-actions"><button class="primary" :disabled="busy">Opslaan</button><button v-if="editing.original" type="button" class="link danger" :disabled="busy" @click="removeEntry">Verwijderen</button></div>
        </form>
      </dialog>
    </template>
  </main>
  <footer>AVW · Atletiekvereniging Wieringermeer e.o.</footer>
</template>
