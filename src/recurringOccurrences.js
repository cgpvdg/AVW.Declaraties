const dayMs = 86400000
const weekday = date => (date.getUTCDay() + 6) % 7

function matches(rule, start, date) {
  const elapsed = (date - start) / dayMs
  if (rule.unit === 'dag') return elapsed % rule.interval === 0
  if (rule.unit === 'week') {
    const week = Math.floor((elapsed + weekday(start)) / 7)
    return week % rule.interval === 0 && rule.days.includes(weekday(date) + 1)
  }
  const months = (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + date.getUTCMonth() - start.getUTCMonth()
  const interval = rule.unit === 'jaar' ? 12 * rule.interval : rule.interval
  return date.getUTCDate() === start.getUTCDate() && months % interval === 0
}

export function isOccurrence(rule, date) {
  return rule.repeat && date >= rule.startDate && (!rule.endDate || date <= rule.endDate) &&
    matches(rule, new Date(rule.startDate + 'T00:00:00Z'), new Date(date + 'T00:00:00Z'))
}

export function occurrenceDates(rule, through) {
  const last = rule.endDate && rule.endDate < through ? rule.endDate : through
  if (!rule.repeat || rule.startDate > last) return []
  const start = new Date(rule.startDate + 'T00:00:00Z')
  const end = new Date(last + 'T00:00:00Z')
  const dates = []
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (matches(rule, start, date)) dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}
