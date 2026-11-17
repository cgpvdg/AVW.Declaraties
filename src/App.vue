<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { createUserWithEmailAndPassword, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth'
import { collection, deleteField, doc, getDoc, getDocs, runTransaction, setDoc, deleteDoc, updateDoc } from 'firebase/firestore/lite'
import { auth, createManagedAccount, db } from './firebase'
import { dateLabel, euro, fields, initialRates, monthLabel, monthName, summarize, today } from './model'
import logo from './logo.png'
import DeclarationFields from './DeclarationFields.vue'
import { finishDecimal, formatDecimal, maskDecimal, parseDecimal } from './decimal'
import DeclarationTotals from './DeclarationTotals.vue'
import EditIcon from './EditIcon.vue'
import NavigationIcon from './NavigationIcon.vue'
import ProfileNameFields from './ProfileNameFields.vue'
import RecurringDeclarations from './RecurringDeclarations.vue'
import { isOccurrence, occurrenceDates } from './recurringOccurrences'
import { fullProfileName, legacyNameMigration, profileNameParts } from './profileName'

const registering = ref(false)
const registration = ref({ name: profileNameParts(), level: 1 })
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
const rejectionDraft = ref(null)
const declarationStatuses = { concept: 'Concept', submitted: 'Ingediend', approved: 'Goedgekeurd', rejected: 'Afgewezen' }
const declarationStatus = computed(() => sheet.value?.status ?? 'concept')
const canEditEntries = computed(() => !isAdmin.value && ['concept', 'rejected'].includes(declarationStatus.value))
const entryDialog = ref(null)
const rateDraft = ref(formatRates(initialRates))
const editing = ref(null)
const panel = ref('declarations')
const pageTitle = computed(() => ({
  profile: 'Profiel',
  password: 'Wachtwoord wijzigen',
  annual: 'Jaaroverzicht',
  overview: 'Maandoverzicht',
  annualAdmin: 'Jaaroverzicht',
  matrix: 'Matrix',
  trainers: 'Trainers',
  trainerEdit: trainerDraft.value?.pending ? 'Trainer verifiëren' : 'Trainer wijzigen',
  administrators: 'Beheerders',
  rates: 'Vergoedingen',
  recurring: 'Terugkerende declaraties',
  notifications: 'Te accorderen declaraties',
  declarations: isAdmin.value ? 'Declaraties' : 'Mijn declaraties',
})[panel.value])
const menu = ref(null)
const notificationMenu = ref(null)
const monthNotifications = ref([])
const notifications = computed(() => [
  ...administratorNotifications.value,
  ...(!isAdmin.value && canReviewOccurrences.value && pendingOccurrences.value.length ? [{
    id: 'recurring', destination: 'notifications', icon: 'recurring',
    label: pendingOccurrences.value.length + (pendingOccurrences.value.length === 1 ? ' declaratie accorderen' : ' declaraties accorderen'),
  }] : []),
  ...monthNotifications.value,
])
function openNotification(notification) {
  if (notification.period) {
    month.value = notification.period
    if (notification.owner) uid.value = notification.owner
  }
  navigate(notification.destination)
}

let notificationVersion = 0
async function refreshMonthNotifications() {
  const version = ++notificationVersion
  if (!account.value || !profile.value) {
    monthNotifications.value = []
    return
  }
  const admin = isAdmin.value
  const owners = admin ? declarationTrainers.value : [{ ...profile.value, id: account.value.uid }]
  try {
    const results = await Promise.all(owners.map(async owner => {
      const months = await getDocs(collection(db, 'profiles', owner.id, 'months'))
      const items = await Promise.all(months.docs.map(async item => {
        const status = item.data().status ?? 'concept'
        if (admin ? status !== 'submitted' : item.id >= today().slice(0, 7) || !['concept', 'rejected'].includes(status)) return null
        if (!admin && (await getDocs(collection(item.ref, 'entries'))).empty) return null
        const caption = monthLabel.format(new Date(item.id + '-01T00:00:00Z'))
        return {
          id: owner.id + '-' + item.id, owner: owner.id, period: item.id, destination: 'declarations', icon: 'declarations',
          label: admin ? fullProfileName(owner) + ' · ' + caption + ' beoordelen' : caption + ' indienen',
        }
      }))
      return items.filter(Boolean)
    }))
    if (version !== notificationVersion) return
    let items = results.flat()
    if (admin) {
      const counts = new Map()
      for (const item of items) counts.set(item.period, (counts.get(item.period) ?? 0) + 1)
      items = [...counts].map(([period, count]) => ({
        id: period, period, destination: 'overview', icon: 'declarations',
        label: count + (count === 1 ? ' declaratie van ' : ' declaraties van ') +
          monthLabel.format(new Date(period + '-01T00:00:00Z')) + ' beoordelen',
      }))
    }
    monthNotifications.value = items.sort((a, b) => a.period.localeCompare(b.period))
  } catch (failure) {
    console.error('Maandmeldingen laden mislukt.', failure)
  }
}
const administratorNotifications = computed(() => {
  if (!isAdmin.value) return []
  const count = trainers.value.filter(trainer => trainer.status === 'pending').length
  return count ? [{
    id: 'pending-trainers',
    icon: 'trainers',
    destination: 'trainers',
    label: count === 1 ? '1 nieuwe trainer verifiëren' : count + ' nieuwe trainers verifiëren',
  }] : []
})
const profileDraft = ref({ name: profileNameParts(), level: null })
const passwordDraft = ref(null)

function navigate(destination) {
  if (notificationMenu.value) notificationMenu.value.open = false
  menu.value.open = false
  passwordDraft.value = destination === 'password' ? { current: '', next: '', confirmation: '' } : null
  panel.value = destination
  error.value = ''
  notice.value = ''
  administratorDraft.value = null
  if (destination === 'profile') {
    profileDraft.value = { name: profileNameParts(profile.value), level: profile.value.level ?? null }
  }
}

function changePassword() {
  const { current, next, confirmation } = passwordDraft.value
  const user = auth.currentUser
  return action(async () => {
    if (next !== confirmation) throw { userMessage: 'De nieuwe wachtwoorden komen niet overeen.' }
    if (!user?.email) throw { userMessage: 'Log opnieuw in om je wachtwoord te wijzigen.' }
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))
    } catch (failure) {
      if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(failure.code)) {
        throw { userMessage: 'Het huidige wachtwoord is onjuist.' }
      }
      throw failure
    }
    try {
      await updatePassword(user, next)
    } catch (failure) {
      if (['auth/weak-password', 'auth/password-does-not-meet-requirements'].includes(failure.code)) {
        throw { userMessage: 'Het nieuwe wachtwoord voldoet niet aan de wachtwoordvereisten.' }
      }
      throw failure
    }
    if (auth.currentUser?.uid === user.uid) {
      navigate('profile')
      notice.value = 'Je wachtwoord is gewijzigd.'
    }
  }, 'Het wachtwoord kon niet worden gewijzigd. Probeer het opnieuw.')
}

function saveProfile() {
  const { name, level } = profileDraft.value
  return action(async () => {
    const changes = hasTrainerRole(profile.value) ? { ...name, level } : name
    await updateDoc(doc(db, 'profiles', account.value.uid), { ...changes, name: deleteField() })
    profile.value = { ...profile.value, ...changes }
    trainers.value = trainers.value.map(trainer => trainer.id === account.value.uid
      ? { ...trainer, ...changes } : trainer).sort((a, b) => fullProfileName(a).localeCompare(fullProfileName(b), 'nl'))
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

function setProfileLists(users) {
  trainers.value = users.filter(user => hasTrainerRole(user) && user.status !== 'deleted')
    .sort((a, b) => fullProfileName(a).localeCompare(fullProfileName(b), 'nl'))
  administrators.value = users.filter(user => user.role === 'beheerder' &&
    (user.hidden !== true || user.id === account.value?.uid))
    .sort((a, b) => fullProfileName(a).localeCompare(fullProfileName(b), 'nl'))
}

const administrators = ref([])
const administratorDraft = ref(null)

function createAdministrator() {
  const { name, email, password } = administratorDraft.value
  return action(async () => {
    try {
      await createManagedAccount(email, password, id =>
        setDoc(doc(db, 'profiles', id), { ...name, role: 'beheerder', status: 'active' }))
    } catch (failure) {
      if (failure.code === 'auth/email-already-in-use') {
        throw { userMessage: 'Dit e-mailadres is al in gebruik.' }
      }
      throw failure
    }
    administratorDraft.value = null
    await refreshProfileLists()
    notice.value = 'Beheerder aangemaakt.'
  }, 'De beheerder kon niet worden aangemaakt.')
}

function saveAdministrator() {
  const { id, name, status } = administratorDraft.value
  const ownAccount = id === account.value.uid
  return action(async () => {
    const changes = { ...name, name: deleteField() }
    if (!ownAccount) changes.status = status
    const target = doc(db, 'profiles', id)
    await runTransaction(db, async tx => {
      const current = (await tx.get(target)).data()
      if (current?.role !== 'beheerder') throw { userMessage: 'Dit account is geen beheerder meer.' }
      tx.update(target, changes)
    })
    if (ownAccount) profile.value = { ...profile.value, ...name }
    administratorDraft.value = null
    await refreshProfileLists()
    notice.value = 'Beheerder opgeslagen.'
  }, 'De beheerder kon niet worden opgeslagen.')
}

function removeAdministrator() {
  const { id, name } = administratorDraft.value
  if (id === account.value.uid || !window.confirm('Beheerder ' + fullProfileName(name) + ' verwijderen?')) return
  return action(async () => {
    const target = doc(db, 'profiles', id)
    await runTransaction(db, async tx => {
      const current = (await tx.get(target)).data()
      if (current?.role !== 'beheerder') throw { userMessage: 'Dit account is geen beheerder meer.' }
      if (current.trainer === true) {
        tx.update(target, { role: 'trainer', trainer: deleteField() })
      } else {
        tx.delete(target)
      }
    })
    administratorDraft.value = null
    await refreshProfileLists()
    notice.value = 'Beheerder verwijderd.'
  }, 'De beheerder kon niet worden verwijderd.')
}

async function refreshProfileLists() {
  const users = await getDocs(collection(db, 'profiles'))
  setProfileLists(users.docs.map(item => ({ ...item.data(), id: item.id })))
}

async function refreshAdministratorNotifications() {
  if (!account.value || !isAdmin.value) return
  const owner = account.value.uid
  try {
    const users = await getDocs(collection(db, 'profiles'))
    if (account.value?.uid === owner && isAdmin.value) {
      setProfileLists(users.docs.map(item => ({ ...item.data(), id: item.id })))
    }
  } catch (failure) {
    console.error('Beheerdersmeldingen verversen mislukt.', failure)
  }
}

let administratorRefreshTimer
onMounted(() => {
  window.addEventListener('focus', refreshAdministratorNotifications)
  administratorRefreshTimer = window.setInterval(() => {
    refreshAdministratorNotifications()
    refreshMonthNotifications()
    loadOccurrences()
  }, 60000)
  window.addEventListener('focus', refreshMonthNotifications)
})
onUnmounted(() => {
  window.removeEventListener('focus', refreshAdministratorNotifications)
  window.clearInterval(administratorRefreshTimer)
  window.removeEventListener('focus', refreshMonthNotifications)
})

async function migrateProfileName(owner, profile) {
  if (!legacyNameMigration(profile)) return profile
  try {
    const target = doc(db, 'profiles', owner)
    return await runTransaction(db, async tx => {
      const current = (await tx.get(target)).data()
      if (!current) return profile
      const name = legacyNameMigration(current)
      if (!name) return current
      tx.update(target, { ...name, name: deleteField() })
      return { ...current, ...name }
    })
  } catch (failure) {
    console.error(failure)
    return profile
  }
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
        if (!existing.exists()) tx.set(target, { ...name, level, role: 'trainer', status: 'pending' })
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
  if (!window.confirm('Aanvraag van ' + fullProfileName(trainer) + ' afkeuren?')) return
  return action(async () => {
    const target = doc(db, 'profiles', trainer.id)
    await runTransaction(db, async tx => {
      const current = await tx.get(target)
      if (current.data()?.status !== 'pending') throw { userMessage: 'Deze aanvraag wacht niet meer op verificatie.' }
      tx.set(doc(db, 'rejectedTrainers', trainer.id), { rejected: true })
      tx.delete(target)
    })
    await refreshProfileLists()
    if (uid.value === trainer.id) uid.value = declarationTrainers.value[0]?.id ?? ''
    if (trainerDraft.value?.id === trainer.id) trainerDraft.value = null
    notice.value = 'Aanvraag afgekeurd en trainerprofiel verwijderd.'
  }, 'De aanvraag kon niet worden afgekeurd.')
}

function openTrainer(trainer) {
  trainerDraft.value = {
    ...trainer,
    name: profileNameParts(trainer),
    level: trainer.level ?? 1,
    pending: trainer.status === 'pending',
    status: trainer.status === 'pending' ? 'active' : (trainer.status ?? 'active'),
  }
  navigate('trainerEdit')
}

function saveTrainer() {
  const { id, name, level, status, pending } = trainerDraft.value
  const target = doc(db, 'profiles', id)
  return action(async () => {
    await runTransaction(db, async tx => {
      const found = await tx.get(target)
      if (!found.exists() || (found.data().status === 'pending') !== pending) throw { userMessage: 'Dit profiel is gewijzigd of bestaat al. Open het profiel opnieuw.' }
      tx.update(target, { ...name, name: deleteField(), level, status })
    })
    if (id === account.value.uid) profile.value = { ...profile.value, ...name, level, status }
    await refreshProfileLists()
    if (!uid.value) uid.value = declarationTrainers.value[0]?.id ?? ''
    trainerDraft.value = null
    navigate('trainers')
    notice.value = 'Trainerprofiel opgeslagen.'
  }, 'Het trainerprofiel kon niet worden opgeslagen.')
}

function removeTrainer() {
  const trainer = trainerDraft.value
  if (!window.confirm('Trainer ' + fullProfileName(trainer.name) + ' verwijderen? De declaratiegegevens blijven bewaard.')) return
  return action(async () => {
    const target = doc(db, 'profiles', trainer.id)
    await runTransaction(db, async tx => {
      const current = (await tx.get(target)).data()
      if (current?.role !== 'trainer') throw { userMessage: 'Dit account kan niet als trainer worden verwijderd.' }
      tx.update(target, { status: 'deleted' })
    })
    await refreshProfileLists()
    if (uid.value === trainer.id) uid.value = declarationTrainers.value[0]?.id ?? ''
    trainerDraft.value = null
    navigate('trainers')
    notice.value = 'Trainer verwijderd.'
  }, 'De trainer kon niet worden verwijderd.')
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
    const monthly = months.get(item.period) ?? { period: item.period, status: item.status, units: [0, 0, 0, 0, 0], total: 0 }
    item.units.forEach((value, index) => { monthly.units[index] += value })
    monthly.total += item.total
    months.set(item.period, monthly)
  }
  return [...months.values()]
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
      const { rates, level, status = 'concept' } = header.data()
      return { period: header.id, status, ...summarize(entries.docs.map(entry => entry.data()), rates, level) }
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

const displayRecords = computed(() => [...records.value].reverse())
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
  passwordDraft.value = null
  profile.value = null
  uid.value = ''
  trainers.value = []
  administrators.value = []
  administratorDraft.value = null
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
    if (current.role === 'beheerder' && (current.status ?? 'active') !== 'active') {
      if (version === authVersion) {
        await signOut(auth)
        error.value = 'Je beheerdersaccount is inactief.'
      }
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
    const owners = users ? users.docs.map(item => ({ id: item.id, data: item.data() })) : [{ id: user.uid, data: current }]
    const migrated = await Promise.all(owners.map(async ({ id, data }) => ({ ...await migrateProfileName(id, data), id })))
    if (version !== authVersion) return
    if (users) setProfileLists(migrated)
    profile.value = migrated.find(owner => owner.id === user.uid) ?? current
    uid.value = current.role === 'trainer' ? user.uid : declarationTrainers.value[0]?.id ?? ''
  } catch (failure) {
    if (version === authVersion) error.value = 'De profielgegevens konden niet worden geladen.'
    console.error(failure)
  } finally { if (version === authVersion) loading.value = false }
})

const monthRef = (owner, period) => doc(db, 'profiles', owner, 'months', period)
watch([account, profile, isAdmin, panel, trainers], () => {
  monthNotifications.value = []
  refreshMonthNotifications()
})
const pendingOccurrences = ref([])
const occurrenceLoadError = ref(false)
const occurrencesLoading = ref(false)
const canReviewOccurrences = computed(() => !!account.value && !!profile.value && !isAdmin.value && canTrain(profile.value))
let occurrenceRead = 0

async function loadOccurrences() {
  const read = ++occurrenceRead
  occurrenceLoadError.value = false
  if (!canReviewOccurrences.value) {
    pendingOccurrences.value = []
    occurrencesLoading.value = false
    return
  }
  occurrencesLoading.value = true
  const owner = account.value.uid
  const through = today()
  try {
    const [rules, decisions] = await Promise.all([
      getDocs(collection(db, 'profiles', owner, 'recurringDeclarations')),
      getDocs(collection(db, 'profiles', owner, 'recurringDecisions')),
    ])
    const handled = new Set(decisions.docs.map(item => item.id))
    const occurrences = rules.docs.flatMap(item => {
      const rule = item.data()
      if (!fields.every(([key]) => Number.isFinite(rule[key]))) return []
      const amounts = Object.fromEntries(fields.map(([key]) => [key, rule[key]]))
      return occurrenceDates(rule, through).map(date => ({
        id: item.id + '_' + date, ruleId: item.id, date, name: rule.name, amounts,
      }))
    }).filter(item => !handled.has(item.id))
    const periods = [...new Set(occurrences.map(item => item.date.slice(0, 7)))]
    const months = new Map(await Promise.all(periods.map(async period => {
      const target = monthRef(owner, period)
      const [header, entries] = await Promise.all([getDoc(target), getDocs(collection(target, 'entries'))])
      return [period, {
        editable: ['concept', 'rejected'].includes(header.data()?.status ?? 'concept'),
        days: new Set(entries.docs.map(item => item.id)),
      }]
    })))
    if (read !== occurrenceRead) return
    pendingOccurrences.value = occurrences.flatMap(item => {
      const month = months.get(item.date.slice(0, 7))
      return month.days.has(item.date.slice(-2)) ? [] : [{ ...item, editable: month.editable }]
    }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'nl'))
  } catch (failure) {
    if (read === occurrenceRead) occurrenceLoadError.value = true
    console.error(failure)
  } finally {
    if (read === occurrenceRead) occurrencesLoading.value = false
  }
}

watch([canReviewOccurrences, account, panel], ([, user], [, previousUser]) => {
  if (user !== previousUser) pendingOccurrences.value = []
  loadOccurrences()
})
onMounted(() => window.addEventListener('focus', loadOccurrences))
onUnmounted(() => window.removeEventListener('focus', loadOccurrences))

async function initializeDeclarationMonth(tx, target, trainer) {
  const currentRates = await tx.get(rateRef())
  if (!currentRates.exists()) throw { userMessage: 'De beheerder moet eerst de vergoedingenstaffel opslaan.' }
  tx.set(target, { name: fullProfileName(trainer), level: trainer.level, rates: currentRates.data() })
}

function reviewOccurrence(item, approved) {
  const owner = account.value.uid
  const trainer = profile.value
  const target = monthRef(owner, item.date.slice(0, 7))
  const entry = doc(target, 'entries', item.date.slice(-2))
  const decision = doc(db, 'profiles', owner, 'recurringDecisions', item.id)
  return action(async () => {
    await runTransaction(db, async tx => {
      const previous = await tx.get(decision)
      if (previous.exists()) return
      const existing = await tx.get(entry)
      if (existing.exists()) return
      const schedule = await tx.get(doc(db, 'profiles', owner, 'recurringDeclarations', item.ruleId))
      const current = schedule.data()
      if (!current || item.date > today() || !isOccurrence(current, item.date) ||
        fields.some(([key]) => current[key] !== item.amounts[key])) {
        throw { userMessage: 'Deze terugkerende declaratie is gewijzigd. Open de meldingen opnieuw.' }
      }
      if (approved) {
        const header = await tx.get(target)
        if (!['concept', 'rejected'].includes(header.data()?.status ?? 'concept')) {
          throw { userMessage: 'Deze maanddeclaratie kan niet worden gewijzigd.' }
        }
        if (!header.exists()) await initializeDeclarationMonth(tx, target, trainer)
        tx.set(entry, { ...item.amounts, date: item.date, notes: '' })
      }
      tx.set(decision, {
        ruleId: item.ruleId, period: item.date.slice(0, 7), day: item.date.slice(-2), approved,
      })
    })
    pendingOccurrences.value = pendingOccurrences.value.filter(row => row.id !== item.id && (!approved || row.date !== item.date))
    await loadOccurrences()
  }, 'De keuze kon niet worden opgeslagen.')
}
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
      if (!header) return { trainer, total: 0, status: 'concept' }
      const entries = await getDocs(collection(target, 'entries'))
      return { trainer, status: header.status ?? 'concept', total: summarize(entries.docs.map(entry => entry.data()), header.rates, header.level).total }
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
  rejectionDraft.value = null
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
watch([uid, month, panel], ([, , destination]) => {
  if (destination === 'declarations') loadMonth()
})
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
const matrixWeekday = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', timeZone: 'UTC' })
const hourFields = fields.filter(([, , unit]) => unit === 'uur')
const matrixRows = ref([])
const matrixDays = computed(() => {
  const dates = new Set(matrixRows.value.flatMap(({ days }) => [...days.keys()]))
  return [...dates].filter(date => date.startsWith(month.value + '-')).sort()
    .map(date => ({ date, number: Number(date.slice(-2)) }))
})
const matrixLoading = ref(false)
const matrixError = ref(false)
const selectedMatrixNote = ref(null)

watch([panel, month, isAdmin, declarationTrainers], async ([destination, period, admin, owners], _, onCleanup) => {
  if (destination !== 'matrix' || !admin) return
  let active = true
  onCleanup(() => { active = false })
  matrixRows.value = []
  selectedMatrixNote.value = null
  matrixError.value = false
  matrixLoading.value = Boolean(period)
  if (!period) return
  try {
    const rows = await Promise.all(owners.map(async trainer => {
      const entries = await getDocs(collection(monthRef(trainer.id, period), 'entries'))
      const days = new Map()
      for (const entry of entries.docs) {
        const record = entry.data()
        const note = record.notes?.trim()
        const hours = hourFields.flatMap(([key, label]) => record[key] > 0
          ? [{ key, label, note, value: Number(record[key]).toLocaleString('nl-NL') }]
          : [])
        if (hours.length) days.set(record.date, hours)
      }
      return { trainer, days }
    }))
    if (active) matrixRows.value = rows
  } catch (failure) {
    if (active) matrixError.value = true
    console.error(failure)
  } finally {
    if (active) matrixLoading.value = false
  }
})

function formatRates(rates) {
  return Object.fromEntries(Object.entries(initialRates).map(([key, fallback]) => [key, formatDecimal(rates[key] ?? fallback)]))
}
function openEntry(row) {
  if (!canEditEntries.value) return
  error.value = ''
  editing.value = row ? { ...row, original: row.date } : {
    date: today().startsWith(month.value + '-') ? today() : month.value + '-01',
    notes: '',
  }
  for (const [key] of fields) editing.value[key] = row ? formatDecimal(row[key]) : ''
}
function changeDeclarationStatus(status) {
  const previous = declarationStatus.value
  const rejectionNote = status === 'rejected' ? rejectionDraft.value?.trim() : ''
  if (status === 'rejected' && !rejectionNote) {
    error.value = 'Vul een reden voor de afwijzing in.'
    return
  }
  const target = monthRef(uid.value, month.value)
  return action(async () => {
    try {
      await runTransaction(db, async tx => {
        const header = await tx.get(target)
        if (!header.exists() || (header.data().status ?? 'concept') !== previous) {
          throw { userMessage: 'De declaratiestatus is gewijzigd. Het overzicht is vernieuwd.' }
        }
        tx.update(target, { status, rejectionNote })
      })
    } catch (failure) {
      if (failure.userMessage) await loadMonth()
      if (failure.code === 'permission-denied') {
        await loadMonth()
        throw { userMessage: 'Firestore weigert deze statuswijziging. Laat de beheerder de accorderingsregels controleren.' }
      }
      throw failure
    }
    await loadMonth()
    await refreshMonthNotifications()
    notice.value = 'Declaratiestatus bijgewerkt.'
  }, 'De declaratiestatus kon niet worden bijgewerkt.')
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
      if (!header.exists()) await initializeDeclarationMonth(tx, target, profile.value)
      tx.set(dest, row)
      if (source && original !== row.date) tx.delete(source)
    })
    await loadMonth()
    await refreshMonthNotifications()
    notice.value = 'Regel opgeslagen.'
    await loadOccurrences()
  }, 'De regel kon niet worden opgeslagen.')
}
function removeEntry() {
  if (!window.confirm('Deze regel verwijderen?')) return
  const target = doc(monthRef(uid.value, month.value), 'entries', editing.value.original.slice(-2))
  return action(async () => {
    await deleteDoc(target)
    await loadMonth()
    await refreshMonthNotifications()
    notice.value = 'Regel verwijderd.'
    await loadOccurrences()
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
const preparedExport = ref(null)
let exportVersion = 0
function clearPreparedExport() {
  exportVersion++
  if (preparedExport.value) URL.revokeObjectURL(preparedExport.value.url)
  preparedExport.value = null
}
watch([month, uid, records, sheet, panel, account], clearPreparedExport)
onUnmounted(clearPreparedExport)

function exportSheet() {
  clearPreparedExport()
  const version = exportVersion
  return action(async () => {
    try {
      const { prepareDeclarationDownload } = await import('./export')
      const result = await prepareDeclarationDownload(month.value, sheet.value, records.value)
      if (version !== exportVersion) {
        URL.revokeObjectURL(result.url)
        return
      }
      preparedExport.value = result
    } catch (failure) {
      console.error(failure)
      const detail = failure?.message || failure?.name || String(failure)
      throw { userMessage: 'De Excel-export is mislukt. ' + detail }
    }
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
      <div class="header-actions">
      <details v-if="notifications.length" ref="notificationMenu" class="notification-menu"
        @keydown.esc.stop="notificationMenu.open = false; notificationMenu.querySelector('summary').focus()"
        @toggle="notificationMenu?.open && (menu.open = false)">
        <summary class="secondary notification-bell" aria-label="Meldingen">
          <NavigationIcon name="notifications" />
        </summary>
        <div class="notification-backdrop" aria-hidden="true" @click="notificationMenu.open = false"></div>
        <nav class="notification-items" aria-label="Meldingen">
          <button v-for="notification in notifications" :key="notification.id" type="button"
            class="secondary" :disabled="busy" @click="openNotification(notification)">
            <NavigationIcon :name="notification.icon" />
            <span>{{ notification.label }}</span>
          </button>
        </nav>
      </details>
      <details v-if="account" ref="menu" class="header-menu" @keydown.esc.stop="menu.open = false; menu.querySelector('summary').focus()">
        <summary aria-label="Navigatiemenu"><span aria-hidden="true">☰</span></summary>
        <div class="menu-backdrop" aria-hidden="true" @click="menu.open = false"></div>
        <nav class="menu-links" aria-label="Hoofdnavigatie">
          <img class="menu-logo" :src="logo" alt="AVW Atletiekvereniging Wieringermeer e.o.">
          <template v-if="profile">
            <span class="menu-user">{{ fullProfileName(profile) }} · {{ isAdmin ? 'Beheerder' : 'Trainer' }}{{ hasTrainerRole(profile) && profile.level ? ' · Niveau ' + profile.level : '' }}</span>
            <button :aria-current="panel === 'declarations' ? 'page' : undefined" :disabled="busy" @click="navigate('declarations')"><NavigationIcon name="declarations" />Declaraties</button>
            <button v-if="!isAdmin" :aria-current="panel === 'annual' ? 'page' : undefined" :disabled="busy" @click="navigate('annual')"><NavigationIcon name="annual" />Jaaroverzicht</button>
            <template v-if="isAdmin">
              <button :aria-current="panel === 'overview' ? 'page' : undefined" :disabled="busy" @click="navigate('overview')"><NavigationIcon name="overview" />Maandoverzicht</button>
              <button :aria-current="panel === 'annualAdmin' ? 'page' : undefined" :disabled="busy" @click="navigate('annualAdmin')"><NavigationIcon name="annual" />Jaaroverzicht</button>
              <button :aria-current="panel === 'matrix' ? 'page' : undefined" :disabled="busy" @click="navigate('matrix')"><NavigationIcon name="matrix" />Matrix</button>
            </template>
            <button v-if="profile.role === 'beheerder' && canTrain(profile)" :disabled="busy" @click="switchMode(isAdmin ? 'trainer' : 'beheerder')"><NavigationIcon name="switch" />Verder als {{ isAdmin ? 'trainer' : 'beheerder' }}</button>
          </template>
          <div class="menu-bottom">
            <template v-if="profile && isAdmin">
              <button :aria-current="panel === 'trainers' ? 'page' : undefined" :disabled="busy" @click="navigate('trainers')"><NavigationIcon name="trainers" />Trainers</button>
              <button :aria-current="panel === 'administrators' ? 'page' : undefined" :disabled="busy" @click="navigate('administrators')"><NavigationIcon name="administrators" />Beheerders</button>
              <button :aria-current="panel === 'rates' ? 'page' : undefined" :disabled="busy" @click="navigate('rates')"><NavigationIcon name="rates" />Vergoedingen</button>
            </template>
            <button v-if="profile && !isAdmin && canTrain(profile)" :aria-current="panel === 'recurring' ? 'page' : undefined" :disabled="busy" @click="navigate('recurring')"><NavigationIcon name="recurring" />Terugkerende declaraties</button>
            <hr class="menu-divider">
            <button v-if="profile" :aria-current="panel === 'profile' ? 'page' : undefined" :disabled="busy" @click="navigate('profile')"><NavigationIcon name="profile" />Profiel</button>
            <button class="menu-logout" :disabled="busy" @click="action(() => signOut(auth), 'Uitloggen is mislukt.')"><NavigationIcon name="logout" />Uitloggen</button>
          </div>
        </nav>
      </details>
      </div>
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
          <ProfileNameFields v-model="registration.name" :disabled="busy" />
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
      <h1 class="page-heading page-heading-with-icon">
        <NavigationIcon :name="panel === 'trainerEdit' ? 'trainers' : panel === 'annualAdmin' ? 'annual' : panel === 'password' ? 'profile' : panel" />
        {{ pageTitle }}
      </h1>
      <section v-if="panel === 'notifications' && canReviewOccurrences" class="card occurrence-list">
        <p v-if="occurrencesLoading" role="status">Meldingen laden…</p>
        <template v-else-if="occurrenceLoadError">
          <p role="alert">De meldingen konden niet worden geladen.</p>
          <button type="button" class="secondary" @click="loadOccurrences">Opnieuw proberen</button>
        </template>
        <p v-else-if="!pendingOccurrences.length" class="muted">Er zijn geen declaraties om te accorderen.</p>
        <article v-for="item in pendingOccurrences" :key="item.id" class="occurrence-row">
          <div>
            <h2>{{ item.name }}</h2>
            <p class="entry-date"><time :datetime="item.date">{{ dateLabel.format(new Date(item.date)) }} {{ item.date.slice(0, 4) }}</time></p>
            <div v-if="fields.some(([key]) => item.amounts[key] > 0)" class="metrics">
              <span v-for="[key, label, unit] in fields.filter(([key]) => item.amounts[key] > 0)" :key="key"
                :class="{ 'hour-type': unit === 'uur' }" :data-type="key">
                {{ label }} · {{ unit === '€' ? euro.format(item.amounts[key]) : item.amounts[key].toLocaleString('nl-NL') + ' ' + unit }}
              </span>
            </div>
            <p v-if="!item.editable" class="muted">Deze maanddeclaratie kan niet worden gewijzigd.</p>
          </div>
          <div class="occurrence-actions">
            <button type="button" class="secondary declaration-approved" :aria-label="'Goedkeuren: ' + item.name + ', ' + item.date"
              :disabled="busy || !item.editable || occurrencesLoading || occurrenceLoadError" @click="reviewOccurrence(item, true)"><span aria-hidden="true">✓</span> Goedkeuren</button>
            <button type="button" class="secondary declaration-rejected" :aria-label="'Afkeuren: ' + item.name + ', ' + item.date"
              :disabled="busy || occurrencesLoading || occurrenceLoadError" @click="reviewOccurrence(item, false)"><span aria-hidden="true">✕</span> Afkeuren</button>
          </div>
        </article>
      </section>
      <RecurringDeclarations v-else-if="panel === 'recurring' && !isAdmin && canTrain(profile)" :key="account.uid" :owner="account.uid" />
      <form v-else-if="panel === 'profile'" class="card settings" @submit.prevent="saveProfile">
        <ProfileNameFields v-model="profileDraft.name" :disabled="busy" />
        <label v-if="hasTrainerRole(profile)">Niveau<select v-model="profileDraft.level" :disabled="busy" required>
          <option :value="null" disabled>Kies een niveau</option>
          <option v-for="level in 4" :key="level" :value="level">{{ level }}</option>
        </select></label>
        <button class="primary" :disabled="busy">Opslaan</button>
        <button type="button" class="link" :disabled="busy" @click="navigate('password')">Wachtwoord wijzigen</button>
      </form>
      <form v-else-if="panel === 'password' && passwordDraft" class="card settings" @submit.prevent="changePassword">
        <label>Huidig wachtwoord<input v-model="passwordDraft.current" type="password" autocomplete="current-password" :disabled="busy" required></label>
        <label>Nieuw wachtwoord<input v-model="passwordDraft.next" type="password" autocomplete="new-password" :disabled="busy" minlength="6" required></label>
        <label>Nieuw wachtwoord herhalen<input v-model="passwordDraft.confirmation" type="password" autocomplete="new-password" :disabled="busy" minlength="6" required></label>
        <div class="form-actions">
          <button class="primary" :disabled="busy">Wachtwoord opslaan</button>
          <button type="button" class="secondary" :disabled="busy" @click="navigate('profile')">Terug naar profiel</button>
        </div>
      </form>
      <section v-else-if="panel === 'trainerEdit' && trainerDraft && isAdmin" class="card settings">
        <form class="settings" @submit.prevent="saveTrainer">
          <ProfileNameFields v-model="trainerDraft.name" :disabled="busy" />
          <label>Niveau<select v-model.number="trainerDraft.level" required>
            <option v-for="level in 4" :key="level" :value="level">{{ level }}</option>
          </select></label>
          <label v-if="!trainerDraft.pending && trainerDraft.role === 'trainer'">Status<select v-model="trainerDraft.status">
            <option value="active">Actief</option><option value="inactive">Inactief</option>
          </select></label>
          <div class="form-actions">
            <button class="primary" :disabled="busy">{{ trainerDraft.pending ? 'Verifiëren' : 'Opslaan' }}</button>
            <button type="button" class="secondary" :disabled="busy" @click="trainerDraft = null; navigate('trainers')">Annuleren</button>
            <button v-if="trainerDraft.role === 'trainer'" type="button" class="link danger" :disabled="busy" @click="removeTrainer">Verwijderen</button>
          </div>
        </form>
      </section>
      <section v-else-if="panel === 'trainers'" class="card settings">
        <ul class="entry-list trainer-list">
          <li v-for="trainer in trainers" :key="trainer.id">
            <div><strong>{{ fullProfileName(trainer) }}</strong><p class="muted">{{ statusLabel(trainer) }} · Niveau {{ trainer.level ?? 'instellen' }}</p></div>
            <button class="secondary" :disabled="busy" :aria-label="trainer.status === 'pending' ? undefined : 'Trainer bewerken'" @click="openTrainer(trainer)">
              <template v-if="trainer.status === 'pending'">Verifiëren</template>
              <EditIcon v-else />
            </button>
            <button v-if="trainer.status === 'pending'" class="secondary danger" :disabled="busy" @click="rejectTrainer(trainer)">Afkeuren</button>
          </li>
        </ul>
      </section>
      <template v-else-if="panel === 'administrators' && isAdmin">
        <button v-if="!administratorDraft" type="button" class="primary add-declaration" :disabled="busy"
          @click="administratorDraft = { name: profileNameParts(), email: '', password: '' }">Beheerder toevoegen</button>
        <section class="card settings">
          <form v-if="administratorDraft" class="settings" @submit.prevent="administratorDraft.id ? saveAdministrator() : createAdministrator()">
            <h2>{{ administratorDraft.id ? 'Beheerder wijzigen' : 'Nieuwe beheerder' }}</h2>
            <ProfileNameFields v-model="administratorDraft.name" :disabled="busy" />
            <template v-if="!administratorDraft.id">
              <label>E-mailadres<input v-model.trim="administratorDraft.email" type="email" maxlength="254" autocomplete="off" :disabled="busy" required></label>
              <label>Wachtwoord<input v-model="administratorDraft.password" type="password" minlength="6" autocomplete="new-password" :disabled="busy" required></label>
            </template>
            <label v-if="administratorDraft.id && administratorDraft.id !== account.uid">Status
              <select v-model="administratorDraft.status" :disabled="busy">
                <option value="active">Actief</option>
                <option value="inactive">Inactief</option>
              </select>
            </label>
            <div class="form-actions">
              <button class="primary" :disabled="busy">{{ administratorDraft.id ? 'Opslaan' : 'Aanmaken' }}</button>
              <button type="button" class="secondary" :disabled="busy" @click="administratorDraft = null">Annuleren</button>
              <button v-if="administratorDraft.id && administratorDraft.id !== account.uid" type="button" class="link danger" :disabled="busy" @click="removeAdministrator">Verwijderen</button>
            </div>
          </form>
          <ul v-else class="entry-list trainer-list">
            <li v-for="administrator in administrators" :key="administrator.id">
              <div>
                <strong>{{ fullProfileName(administrator) }}</strong>
                <p v-if="administrator.id === account.uid" class="muted">{{ account.email }} • Eigen account</p>
                <p v-if="(administrator.status ?? 'active') !== 'active'" class="muted">Inactief</p>
              </div>
              <button type="button" class="secondary" :disabled="busy" :aria-label="'Beheerder wijzigen: ' + fullProfileName(administrator)"
                @click="administratorDraft = { id: administrator.id, name: profileNameParts(administrator), status: administrator.status ?? 'active' }">
                <EditIcon />
              </button>
            </li>
          </ul>
        </section>
      </template>
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
                <button type="button" class="secondary annual-month-link" :class="!isAdmin && 'declaration-' + item.status" @click="month = item.period; navigate(isAdmin ? 'overview' : 'declarations')">
                  <strong>{{ monthName.format(new Date(item.period + '-01T00:00:00Z')) }}</strong>
                  <span v-if="!isAdmin">{{ (item.units[0] + item.units[1] + item.units[2]).toLocaleString('nl-NL') }} uur</span>
                  <strong>{{ euro.format(item.total) }}</strong>
                </button>
              </li>
            </ul>
          </section>
        </template>
      </template>
      <template v-else-if="isAdmin && (panel === 'overview' || panel === 'matrix')">
        <section class="card period">
          <label>
            <span class="month-picker">
              <button class="secondary" aria-label="Vorige maand" @click="changeMonth(-1)">‹</button>
              <input v-model="month" type="month" aria-label="Maand">
              <button class="secondary" aria-label="Volgende maand" @click="changeMonth(1)">›</button>
            </span>
          </label>
        </section>
        <template v-if="panel === 'matrix'">
          <p v-if="matrixLoading" role="status">Matrix laden…</p>
          <p v-else-if="matrixError" class="banner error" role="alert">De matrix kon niet worden geladen.</p>
          <p v-else-if="!month" class="card">Kies een maand.</p>
          <p v-else-if="!matrixRows.length" class="card">Er zijn nog geen trainers.</p>
          <p v-else-if="!matrixDays.length" class="card">Er zijn deze maand geen uren geregistreerd.</p>
          <template v-else>
            <ul class="matrix-legend" aria-label="Legenda urentypen">
              <li v-for="[key, label] in hourFields" :key="key" class="matrix-badge hour-type" :data-type="key">{{ label }}</li>
            </ul>
            <h2 id="matrix-period" class="matrix-period">{{ caption }}</h2>
            <div class="matrix-scroll" role="region" aria-label="Urenmatrix" tabindex="0">
              <table class="matrix-table" aria-labelledby="matrix-period">
                <thead>
                  <tr>
                    <th scope="col">Trainer</th>
                    <th v-for="day in matrixDays" :key="day.date" scope="col" :aria-label="dateLabel.format(new Date(day.date))">
                      <span class="matrix-weekday">{{ matrixWeekday.format(new Date(day.date)) }}</span>
                      {{ day.number }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="{ trainer, days } in matrixRows" :key="trainer.id">
                    <th scope="row">{{ profileNameParts(trainer).firstName }}</th>
                    <td v-for="day in matrixDays" :key="day.date">
                      <div v-for="hours in days.get(day.date)" :key="hours.key" class="matrix-hours">
                        <button v-if="hours.note" type="button" class="matrix-badge matrix-note-button hour-type" :data-type="hours.key"
                          :aria-label="`${hours.label}, ${hours.value} uur. Opmerking tonen of verbergen`"
                          :aria-expanded="selectedMatrixNote === hours"
                          @click="selectedMatrixNote = selectedMatrixNote === hours ? null : hours"
                          @keydown.esc.stop="selectedMatrixNote = null">{{ hours.value }}</button>
                        <div v-else class="matrix-badge hour-type" :data-type="hours.key">
                          <span class="matrix-sr-only">{{ hours.label }} </span>{{ hours.value }}<span class="matrix-sr-only"> uur</span>
                        </div>
                        <p v-if="hours.note" class="matrix-note" :class="{ 'matrix-note-open': selectedMatrixNote === hours }">{{ hours.note }}</p>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
        <p v-else-if="overviewLoading" role="status">Overzicht laden…</p>
        <p v-else-if="overviewError" class="banner error" role="alert">Het overzicht kon niet worden geladen.</p>
        <template v-else-if="month">
          <div class="summary overview-summary">
            <article class="card total"><span>Totale vergoeding</span><strong>{{ euro.format(overviewTotal) }}</strong></article>
          </div>
          <section class="card entries">
            <h2 class="overview-heading">Vergoeding per trainer</h2>
            <p v-if="!overviewRows.length" class="empty">Er zijn nog geen trainers.</p>
            <ul v-else class="entry-list">
              <li v-for="{ trainer, total, status } in overviewRows" :key="trainer.id" class="annual-month">
                <button type="button" class="secondary annual-month-link" :class="'declaration-' + status" @click="uid = trainer.id; navigate('declarations')">
                  <strong>{{ fullProfileName(trainer) }}</strong>
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
              <option v-for="trainer in declarationTrainers" :key="trainer.id" :value="trainer.id">{{ fullProfileName(trainer) }}{{ trainer.status && trainer.status !== 'active' ? ' · ' + statusLabel(trainer) : '' }}</option>
            </select>
          </label>
          <label>
            <span class="month-picker">
              <button class="secondary" aria-label="Vorige maand" :disabled="busy" @click="changeMonth(-1)">‹</button>
              <input v-model="month" type="month" aria-label="Declaratiemaand" :disabled="busy">
              <button class="secondary" aria-label="Volgende maand" :disabled="busy" @click="changeMonth(1)">›</button>
            </span>
          </label>
          <a v-if="preparedExport" class="secondary export-download" :href="preparedExport.url" :download="preparedExport.name">Excel downloaden</a>
          <button v-else class="secondary" :disabled="!sheet || reading || busy" @click="exportSheet">
            <svg class="export-icon" viewBox="0 0 20 20" aria-hidden="true">
              <rect x="2" y="2" width="16" height="16" rx="3" fill="#107c41"/>
              <path d="m6.5 6.5 7 7m0-7-7 7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Exporteren
          </button>
        </section>
        <p v-if="reading" role="status">Declaratie laden…</p>
        <template v-else>
          <section v-if="uid && month" class="card declaration-status" :class="'declaration-' + declarationStatus" aria-label="Declaratiestatus">
            <div class="section-header">
              <strong>{{ declarationStatuses[declarationStatus] }}</strong>
              <div class="form-actions">
                <button v-if="canEditEntries && records.length" type="button" class="secondary" :disabled="busy" @click="changeDeclarationStatus('submitted')">Declaratie indienen</button>
                <button v-if="!isAdmin && declarationStatus === 'submitted'" type="button" class="secondary" :disabled="busy" @click="changeDeclarationStatus('concept')">Indiening intrekken</button>
                <template v-if="isAdmin && declarationStatus === 'submitted'">
                  <button type="button" class="secondary declaration-approved" :disabled="busy" @click="changeDeclarationStatus('approved')">Goedkeuren</button>
                  <button type="button" class="secondary danger declaration-rejected" :disabled="busy" @click="rejectionDraft = ''">Afwijzen</button>
                </template>
                <button v-if="isAdmin && ['approved', 'rejected'].includes(declarationStatus)" type="button" class="secondary" :disabled="busy" @click="changeDeclarationStatus('submitted')">{{ declarationStatus === 'approved' ? 'Goedkeuring intrekken' : 'Afwijzing intrekken' }}</button>
              </div>
            </div>
            <p v-if="declarationStatus === 'rejected'" class="notes">{{ sheet.rejectionNote }}</p>
            <form v-if="isAdmin && declarationStatus === 'submitted' && rejectionDraft !== null" class="settings" @submit.prevent="changeDeclarationStatus('rejected')">
              <label>Reden voor afwijzing<textarea v-model="rejectionDraft" maxlength="1000" required :disabled="busy"></textarea></label>
              <div class="form-actions">
                <button class="primary" :disabled="busy || !rejectionDraft.trim()">Afwijzing opslaan</button>
                <button type="button" class="secondary" :disabled="busy" @click="rejectionDraft = null">Annuleren</button>
              </div>
            </form>
          </section>
          <DeclarationTotals :totals="totals" compact-labels />
          <button v-if="canEditEntries" class="primary add-declaration" :disabled="!month || busy" @click="openEntry()">Declaratie toevoegen</button>
          <section class="card entries">
            <div class="section-header">
              <div><span class="eyebrow month-caption">{{ caption }}</span></div>
            </div>
            <p v-if="!records.length" class="empty">Voor deze maand zijn er nog geen regels.</p>
            <ul v-else class="entry-list declaration-list">
              <li v-for="row in displayRecords" :key="row.date">
                <div><strong class="entry-date">{{ dateLabel.format(new Date(row.date + 'T00:00:00Z')) }}</strong>
                  <div class="metrics">
                    <span v-for="[key, label, unit] in fields" :key="key" v-show="row[key]" :class="{ 'hour-type': unit === 'uur' }" :data-type="key">
                      {{ label }} · {{ unit === '€' ? euro.format(row[key]) : row[key].toLocaleString('nl-NL') + ' ' + unit }}
                    </span>
                  </div>
                  <p v-if="row.notes" class="notes">{{ row.notes }}</p>
                </div>
                <button v-if="canEditEntries" class="secondary" :disabled="busy" aria-label="Declaratie bewerken" @click="openEntry(row)"><EditIcon /></button>
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
            <DeclarationFields :draft="editing" />
            <label class="wide">Opmerkingen<textarea v-model="editing.notes" rows="2" maxlength="1000"></textarea></label>
          </fieldset>
          <div class="form-actions"><button class="primary" :disabled="busy">Opslaan</button><button v-if="editing.original" type="button" class="link danger" :disabled="busy" @click="removeEntry">Verwijderen</button></div>
        </form>
      </dialog>
    </template>
  </main>
  <footer>AVW · Atletiekvereniging Wieringermeer e.o.</footer>
</template>
