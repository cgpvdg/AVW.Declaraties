import JSZip from 'jszip'
import template from './declaration-template.xlsx?url'
import { fields, summarize, today } from './model'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const serial = date => Date.parse(date + 'T00:00:00Z') / 86400000 + 25569

export async function makeDeclaration(templateBytes, month, header, entries) {
  const zip = await JSZip.loadAsync(templateBytes)
  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  async function updateSheet(path, update) {
    const xml = parser.parseFromString(await zip.file(path).async('string'), 'application/xml')
    const cells = new Map(Array.from(xml.getElementsByTagNameNS(ns, 'c'), c => [c.getAttribute('r'), c]))
    const rows = new Map(Array.from(xml.getElementsByTagNameNS(ns, 'row'), r => [r.getAttribute('r'), r]))
    update((address, value, formula) => {
      let cell = cells.get(address)
      if (!cell) {
        const number = address.match(/\d+$/)[0]
        const column = address.replace(/\d/g, '')
        const row = rows.get(number)
        const next = Array.from(row.children).find(c => {
          const col = c.getAttribute('r').replace(/\d/g, '')
          return col.length > column.length || (col.length === column.length && col > column)
        })
        cell = xml.createElementNS(ns, 'c')
        cell.setAttribute('r', address)
        cell.setAttribute('s', cells.get('E' + number)?.getAttribute('s') ?? '24')
        row.insertBefore(cell, next ?? null)
      }
      cell.replaceChildren()
      cell.removeAttribute('t')
      const append = (parent, tag, text) => {
        const node = xml.createElementNS(ns, tag)
        node.textContent = text
        parent.append(node)
        return node
      }
      if (formula) append(cell, 'f', formula)
      if (typeof value === 'number') append(cell, 'v', value)
      if (typeof value === 'string') {
        cell.setAttribute('t', formula ? 'str' : 'inlineStr')
        if (formula) append(cell, 'v', value)
        else append(append(cell, 'is', ''), 't', value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''))
          .setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
      }
    })
    zip.file(path, serializer.serializeToString(xml))
  }
  const [year, number] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate()
  const byDate = new Map(entries.map(row => [row.date, row]))
  const { units, prices, amounts, total } = summarize(entries, header.rates, header.level)
  await updateSheet('xl/worksheets/sheet1.xml', set => {
    set('D2', number)
    set('I2', year)
    set('F10', header.name)
    set('F11', 'Niveau ' + header.level)
    set('F12', number + '-' + year, 'D2&"-"&I2')
    set('B58', serial(today()))
    set('H58', null)
    for (let day = 1; day <= 31; day++) {
      const row = day + 16
      if (day > count) continue
      const date = month + '-' + String(day).padStart(2, '0')
      const entry = byDate.get(date)
      set('A' + row, serial(date))
      set('B' + row, days[new Date(date + 'T00:00:00Z').getUTCDay()])
      fields.forEach(([key], index) => set('CDEFG'[index] + row, entry?.[key] || null))
      set('H' + row, entry?.notes || null)
    }
    for (const [index, col] of [...'CDEFG'].entries()) {
      set(col + '48', units[index], 'SUM(' + col + '17:' + col + '47)')
      if (index < 4) {
        const rateFormula = index < 2 ? 'VLOOKUP(F11,Blad1!A:B,2,0)' : undefined
        set(col + '50', prices[index], rateFormula)
      }
      set(col + '52', amounts[index], index === 4 ? 'G48' : col + '48*' + col + '50')
    }
    set('I52', total, 'SUM(C52:G52)')
  })
  await updateSheet('xl/worksheets/sheet2.xml', set => {
    for (let level = 1; level <= 4; level++) set('B' + (level + 2), header.rates['level' + level])
    set('B1', 'Vergoeding ' + year)
  })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export async function downloadDeclaration(month, header, entries) {
  const response = await fetch(template)
  if (!response.ok) throw new Error('Sjabloon niet beschikbaar')
  const bytes = await makeDeclaration(await response.arrayBuffer(), month, header, entries)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'AVW Declaratie ' + month + ' - ' + header.name.replace(/[\\/:*?"<>|]/g, '_') + '.xlsx'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
