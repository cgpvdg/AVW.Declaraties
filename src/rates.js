import { collection, doc, getDoc } from 'firebase/firestore/lite'
import { db } from './firebase'

export const annualRatesRef = () => collection(db, 'settings', 'rates', 'years')
export const annualRateRef = year => doc(annualRatesRef(), year)
export const legacyRateRef = () => doc(db, 'settings', 'rates')

export function rateReader(read = getDoc) {
  const years = new Map()
  let legacy
  return year => {
    if (!years.has(year)) {
      years.set(year, read(annualRateRef(year)).then(snapshot => {
        if (snapshot.exists()) return { rates: snapshot.data(), annual: true }
        legacy ??= read(legacyRateRef()).then(document => document.data())
        return legacy.then(rates => ({ rates, annual: false }))
      }))
    }
    return years.get(year)
  }
}

export async function declarationRates(period, header, readRates) {
  if (header.status === 'approved') return header.rates
  return (await readRates(period.slice(0, 4))).rates ?? header.rates
}
