import { jsPDF } from 'jspdf'
import logoUrl from './logo.png?url'
import daysOneUrl from './fonts/days-one.regular.ttf?url'
import montserratUrl from './fonts/Montserrat-Regular.ttf?url'
import { euro, fields, monthLabel, summarize } from './model'

const number = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 })
const signingDate = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam',
})
const statusLabels = { concept: 'Concept', submitted: 'Ingediend', approved: 'Goedgekeurd', rejected: 'Afgewezen' }
const ink = '#17353d'
const muted = '#43575b'
const pale = '#eef4f4'
const left = 15
const right = 195
const width = right - left
const valuesX = [67, 94, 124, 152, 192]

async function readAsset(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Een PDF-bestandsonderdeel kon niet worden geladen.')
  return new Uint8Array(await response.arrayBuffer())
}

function addFont(pdf, bytes, name) {
  const filename = name + '.ttf'
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  pdf.addFileToVFS(filename, btoa(binary))
  pdf.addFont(filename, name, 'normal')
}

export function makeDeclarationPdf(month, header, entries, approvalName, { logo, daysOne, montserrat }) {
  const pdf = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'mm', compress: true, putOnlyUsedFonts: true })
  addFont(pdf, daysOne, 'Days One')
  addFont(pdf, montserrat, 'Montserrat')
  pdf.setProperties({ title: 'AVW Declaratie ' + month, author: 'AVW Atletiekvereniging Wieringermeer e.o.' })
  const period = monthLabel.format(new Date(month + '-01T00:00:00Z'))
  const name = header.name ?? ''
  const { units, prices, amounts, total } = summarize(entries, header.rates, header.level)
  const notes = entries.filter(row => row.notes?.trim())

  function font(size, color = ink, family = 'Montserrat') {
    pdf.setFont(family).setFontSize(size).setTextColor(color)
  }

  function image(source, x, y, maxWidth, maxHeight, align = 'left') {
    const { width: imageWidth, height: imageHeight } = pdf.getImageProperties(source)
    const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight)
    const displayWidth = imageWidth * scale
    pdf.addImage(source, 'PNG', align === 'right' ? x - displayWidth : x, y, displayWidth, imageHeight * scale)
  }

  function columns(values, y) {
    values.forEach((value, index) => pdf.text(String(value), valuesX[index], y, { align: 'right' }))
  }

  function wrappedName(value, x, y, maxWidth, maxHeight, size) {
    font(size)
    let lines = pdf.splitTextToSize(value, maxWidth)
    let lineHeight = size * 0.405
    while (lines.length * lineHeight > maxHeight) {
      size -= 0.5
      font(size)
      lines = pdf.splitTextToSize(value, maxWidth)
      lineHeight = size * 0.405
    }
    pdf.text(lines, x, y)
    return (lines.length - 1) * lineHeight
  }

  function signature(x, label, signed, fallbackName) {
    const y = 246
    pdf.setDrawColor('#91a6a9').setLineWidth(0.25).line(x, y, x + 85, y)
    font(8, ink, 'Days One')
    pdf.text(label, x, y + 5)
    font(8)
    if (!signed) {
      pdf.text('Geen handtekening beschikbaar', x, y + 10)
      return
    }
    const nameHeight = wrappedName(signed.signerName || fallbackName || 'Naam niet beschikbaar', x, y + 10, 85, 12, 8)
    const dateY = y + 14 + nameHeight
    font(8)
    const date = signed.signedAt?.toDate()
    if (date) pdf.text(signingDate.format(date), x, dateY)
    if (signed.image) image(signed.image, x, dateY + 1, 65, 282 - dateY)
  }

  image(logo, right, 18.25, 36, 14.3, 'right')
  font(22, ink, 'Days One')
  pdf.text('Declaratieformulier', left, 24)
  font(10, muted)
  pdf.text(period + '  /  ' + (statusLabels[header.status] ?? 'Concept'), left, 32)
  wrappedName(name, left, 42, 154, 15, 9)
  font(9)
  pdf.text('Niveau ' + header.level, right, 42, { align: 'right' })

  const tableTop = 56
  const rowHeight = 4.65
  pdf.setFillColor(ink).rect(left, tableTop, width, 7, 'F')
  font(8, '#ffffff')
  pdf.text('Datum', left + 3, tableTop + 4.7)
  columns(['Voorber. (u)', 'Training (u)', 'Begeleiding (u)', 'Afstand (km)', 'Onkosten'], tableTop + 4.7)

  let y = tableTop + 7
  for (const [index, row] of entries.entries()) {
    if (index % 2 === 0) pdf.setFillColor(pale).rect(left, y, width, rowHeight, 'F')
    font(8)
    const [year, monthNumber, day] = row.date.split('-')
    pdf.text(day + '-' + monthNumber + '-' + year, left + 3, y + 3.2)
    columns(fields.map(([key], index) => index === 4 ? euro.format(row[key]) : number.format(row[key])), y + 3.2)
    y += rowHeight
  }
  if (!entries.length) {
    font(8, muted)
    pdf.text('Geen regels in deze periode', left + 3, y + 4)
    y += 7
  }

  pdf.setDrawColor('#91a6a9').line(left, y, right, y)
  font(8)
  pdf.text('Eenheden', left + 3, y + 4.2)
  columns(units.map((value, index) => index === 4 ? euro.format(value) : number.format(value)), y + 4.2)
  pdf.text('Tarief', left + 3, y + 9)
  columns([...prices.slice(0, 4).map(value => euro.format(value)), ''], y + 9)
  pdf.text('Bedrag', left + 3, y + 13.8)
  columns(amounts.map(value => euro.format(value)), y + 13.8)

  pdf.setFillColor(pale).rect(left, y + 17, width, 9, 'F')
  font(10, ink, 'Days One')
  pdf.text('Totaal te declareren', left + 3, y + 23)
  font(11)
  pdf.text(euro.format(total), right - 3, y + 23, { align: 'right' })
  if (notes.length) {
    font(8, muted)
    pdf.text('Opmerkingen staan in de bijlage.', left + 3, y + 31)
  }

  signature(left, 'Goedgekeurd door penningmeester', header.approvalSignature, approvalName)
  signature(110, header.submissionSignature?.representedUid ? 'Ingediend namens trainer' : 'Ingediend door trainer',
    header.submissionSignature, name)

  function notesPage() {
    pdf.addPage()
    font(18, ink, 'Days One')
    pdf.text('Opmerkingen', left, 22)
    font(9, muted)
    pdf.text(period, left, 29)
    return 40
  }
  if (notes.length) {
    let noteY = notesPage()
    for (const { date, notes: text } of notes) {
      if (noteY > 267) noteY = notesPage()
      font(9, ink, 'Days One')
      pdf.text(date.split('-').reverse().join('-'), left, noteY)
      noteY += 5
      font(9)
      for (const line of pdf.splitTextToSize(text.trim(), width)) {
        if (noteY > 278) {
          noteY = notesPage()
          font(9)
        }
        pdf.text(line, left, noteY)
        noteY += 4.4
      }
      noteY += 5
    }
  }
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page)
    font(8, muted)
    pdf.text('Atletiekvereniging Wieringermeer e.o.', left, 289)
    pdf.text(page + ' / ' + pages, right, 289, { align: 'right' })
  }
  return pdf
}

export async function preparePdfDownload(month, header, entries, approvalName) {
  const [logo, daysOne, montserrat] = await Promise.all([logoUrl, daysOneUrl, montserratUrl].map(readAsset))
  const pdf = makeDeclarationPdf(month, header, entries, approvalName, { logo, daysOne, montserrat })
  const url = URL.createObjectURL(pdf.output('blob'))
  const name = 'AVW Declaratie ' + month + ' - ' + header.name.replace(/[\\/:*?"<>|]/g, '_') + '.pdf'
  return { url, name }
}
