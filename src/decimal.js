export function formatDecimal(value) {
  return value.toFixed(2).replace('.', ',')
}
export function parseDecimal(value) {
  return Number(value.replace(',', '.'))
}
export function maskDecimal(event, draft, key) {
  const input = event.target
  const value = input.value.replace('.', ',')
  if (/^\d{0,6}(,\d{0,2})?$/.test(value)) draft[key] = value
  input.value = draft[key]
}
export function finishDecimal(draft, key) {
  const value = draft[key]
  if (value && value !== ',') draft[key] = formatDecimal(parseDecimal(value))
  else draft[key] = ''
}
