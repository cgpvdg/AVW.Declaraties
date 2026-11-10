export const fields = [
  ['prep', 'Voorbereiding', 'uur'],
  ['training', 'Training', 'uur'],
  ['guidance', 'Begeleiding', 'uur'],
  ['kilometers', 'Kilometers', 'km'],
  ['expenses', 'Onkosten', '€'],
]
export const initialRates = { level1: 4.8, level2: 5.75, level3: 5.75, level4: 5.75, guidance: 4.8, kilometers: 0.25 }
export const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
export const dateLabel = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const monthLabel = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const monthName = new Intl.DateTimeFormat('nl-NL', { month: 'long', timeZone: 'UTC' })
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(new Date())

export function summarize(entries, rates, level) {
  const hourly = rates?.['level' + level] ?? 0
  const units = fields.map(([key]) => entries.reduce((sum, row) => sum + row[key], 0))
  const prices = [hourly, hourly, rates?.guidance ?? 0, rates?.kilometers ?? 0, 1]
  const amounts = units.map((value, index) => value * prices[index])
  return { units, prices, amounts, total: amounts.reduce((sum, value) => sum + value, 0) }
}
