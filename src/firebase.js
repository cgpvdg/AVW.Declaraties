import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, deleteUser, inMemoryPersistence, initializeAuth, getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore/lite'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const app = Object.values(config).every(Boolean) ? initializeApp(config) : null
export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app, 'avw-declarations') : null

export async function createManagedAccount(email, password, saveProfile) {
  const secondaryApp = initializeApp(config, 'managed-account')
  try {
    const secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence })
    const { user } = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    try {
      await saveProfile(user.uid)
    } catch (failure) {
      try {
        await deleteUser(user)
      } catch (cleanupFailure) {
        console.error(failure, cleanupFailure)
        throw { userMessage: 'Het aanmeldaccount is aangemaakt, maar het profiel kon niet worden opgeslagen. Controleer het account in Firebase Authentication.' }
      }
      throw failure
    }
  } finally {
    await deleteApp(secondaryApp)
  }
}
