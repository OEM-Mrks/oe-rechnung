// Rechnungs-PDF (A4, Anschriftfeld nach DIN 5008) mit jsPDF + AutoTable, optional GiroCode
import { jsPDF } from 'jspdf'
import { autoTable, type CellDef, type RowInput } from 'jspdf-autotable'
import qrcode from 'qrcode-generator'
import { calc, dueIso, fillText, modeNote, subject, type Totals } from '../calc'
import { buildCii } from '../einvoice/cii'
import { countryCode, countryName } from '../einvoice/codes'
import type { InvoiceData, Sender } from '../types'
import { cleanIban, deDate, eur, fmtIban, fmtNum, fmtPct, ibanOk, num } from '../util'
import { addFonts, loadAssets, type PdfAssets } from './assets'
import { finishPdf } from './pdfa'

type RGB = [number, number, number]
export const INK: RGB = [30, 36, 48], NAVY: RGB = [42, 65, 91], GREY: RGB = [105, 112, 125], RULE: RGB = [222, 226, 232], HEADBG: RGB = [241, 243, 246]

interface Party { name: string; street: string; zip: string; city: string; country: string }
const cityLine = (o: Party) => [o.zip, o.city].map((s) => s.trim()).filter(Boolean).join(' ')
const foreign = (country: string) => {
  const c = countryCode(country)
  return c && c !== 'DE' ? countryName(c) : !c && country.trim() ? country.trim() : ''
}

function buildPdf(inv: InvoiceData, no: string, s: Sender, T: Totals, assets: PdfAssets): jsPDF {
  const c = inv.client
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  addFonts(doc, assets)
  const L = 20, R = 190, W = R - L, BOTTOM = 262
  const title = subject(inv, no)
  doc.setProperties({ title, subject: 'Rechnung ' + no, author: s.name || '', creator: 'oe-rechnung' })
  doc.setFont('NotoSans', 'normal')
  doc.setTextColor(...INK)
  const lh = (pt: number, f = 1.35) => pt * f * 0.3528
  const txt = (lines: string | string[], x: number, y: number, opt: Record<string, unknown> = {}) =>
    doc.text(lines, x, y, { lineHeightFactor: 1.35, ...opt })

  // Kopf: Logo oder Name
  if (s.logo && s.logoW) {
    let lw = 62, lh2 = (lw * s.logoH) / s.logoW
    if (lh2 > 24) { lh2 = 24; lw = (lh2 * s.logoW) / s.logoH }
    try { doc.addImage(s.logo, 'PNG', R - lw, 14, lw, lh2) } catch { /* kaputtes Bild: ohne Logo weiter */ }
  } else if (s.name) {
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY)
    txt(doc.splitTextToSize(s.name, 100), R, 22, { align: 'right' })
    doc.setFont('NotoSans', 'normal'); doc.setTextColor(...INK)
  }

  // Absenderzeile + Empfänger (Anschriftfeld DIN 5008)
  let sline = [s.name, s.street, cityLine(s)].map((v) => v.trim()).filter(Boolean).join(' · ')
  doc.setFontSize(7); doc.setTextColor(...GREY)
  if (sline) {
    sline = doc.splitTextToSize(sline, 85)[0]
    doc.text(sline, L, 50)
    doc.setDrawColor(...GREY); doc.setLineWidth(0.1)
    doc.line(L, 51, L + Math.min(doc.getTextWidth(sline), 85), 51)
  }
  doc.setFontSize(10); doc.setTextColor(...INK)
  const addr = [c.name, c.contact, c.street, cityLine(c), foreign(c.country)].map((v) => v.trim()).filter(Boolean)
  let ay = 57
  addr.forEach((line, i) => {
    const parts = doc.splitTextToSize(line, 85)
    if (i === 0) doc.setFont('NotoSans', 'bold')
    txt(parts, L, ay); ay += parts.length * lh(10)
    doc.setFont('NotoSans', 'normal')
  })
  if (c.vatid.trim()) {
    doc.setFontSize(8.5); doc.setTextColor(...GREY); txt('USt-IdNr.: ' + c.vatid.trim(), L, ay + 1); ay += lh(8.5) + 1
    doc.setFontSize(10); doc.setTextColor(...INK)
  }

  // Rechnungsdaten rechts
  const meta: [string, string][] = [['Rechnungsnummer', no], ['Rechnungsdatum', deDate(inv.date)]]
  const sd = inv.sdate || inv.date
  if (inv.edate && inv.edate !== sd) meta.push(['Leistungszeitraum', deDate(sd) + ' – ' + deDate(inv.edate)])
  else meta.push(['Leistungsdatum', deDate(sd)])
  if (c.no.trim()) meta.push(['Kundennummer', c.no.trim()])
  if (inv.orderNo.trim()) meta.push(['Bestellnummer', inv.orderNo.trim()])
  if (inv.ref.trim()) meta.push(['Ihre Referenz', inv.ref.trim()])
  meta.push(['Fällig am', num(inv.days) > 0 ? deDate(dueIso(inv)) : 'sofort'])
  let my = 57
  const MX = 118
  doc.setFontSize(9)
  for (const [k, v] of meta) {
    doc.setTextColor(...GREY); doc.text(k, MX, my)
    const vl = doc.splitTextToSize(String(v), Math.max(R - MX - doc.getTextWidth(k) - 4, 20))
    doc.setTextColor(...INK); txt(vl, R, my, { align: 'right' })
    my += 5.2 + (vl.length - 1) * lh(9)
  }

  // Betreff + Einleitung
  let y = Math.max(ay, my, 90) + 10
  doc.setFont('NotoSans', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY)
  const sub = doc.splitTextToSize(title, W)
  txt(sub, L, y, { lineHeightFactor: 1.2 }); y += sub.length * lh(15, 1.2) + 3
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK)
  const intro = fillText(inv.intro, inv, no, T, s).trim()
  if (intro) {
    const il = doc.splitTextToSize(intro, W)
    txt(il, L, y); y += il.length * lh(10) + 3
  }

  // Positionstabelle
  const showVat = T.std && T.rates.length > 1
  const showDisc = T.lines.some((l) => l.used && l.r > 0)
  const cols: { h: string; w?: number; r?: boolean }[] = [{ h: 'Pos.', w: 10 }, { h: 'Leistung' }, { h: 'Menge', w: 22, r: true },
    { h: T.std ? (T.gross ? 'Einzelpreis brutto' : 'Einzelpreis netto') : 'Einzelpreis', w: 27, r: true }]
  if (showDisc) cols.push({ h: 'Rabatt', w: 15, r: true })
  if (showVat) cols.push({ h: 'USt', w: 13, r: true })
  cols.push({ h: T.std ? (T.gross ? 'Gesamt brutto' : 'Gesamt netto') : 'Gesamt', w: 27, r: true })
  const body: RowInput[] = [], ends: boolean[] = []
  let pos = 0
  for (const l of T.lines) {
    if (!l.used) continue
    const it = inv.items[l.i]
    pos++
    const row = [String(pos), String(it.t || ''), (fmtNum.format(l.q) + ' ' + (it.u || '')).trim(), eur(l.p)]
    if (showDisc) row.push(l.r ? fmtPct.format(l.r * 100) + ' %' : '')
    if (showVat) row.push(fmtPct.format(l.rate) + ' %')
    row.push(eur(l.amt))
    const d = String(it.d || '').trim()
    if (d) {
      body.push(row.map((v): CellDef => ({ content: v, styles: { cellPadding: { top: 2.4, bottom: 0.6, left: 1.5, right: 1.5 } } })))
      ends.push(false)
      body.push([{ content: '' }, { content: d, colSpan: cols.length - 1, styles: { fontSize: 8.5, textColor: GREY, cellPadding: { top: 0, bottom: 2.6, left: 1.5, right: 1.5 } } }])
    } else body.push(row)
    ends.push(true)
  }
  const colStyles: Record<number, { halign: 'left' | 'right'; cellWidth?: number }> = {}
  cols.forEach((cl, i) => { colStyles[i] = { halign: cl.r ? 'right' : 'left' }; if (cl.w) colStyles[i].cellWidth = cl.w })
  autoTable(doc, {
    startY: y + 2, margin: { left: L, right: 210 - R, top: 22, bottom: 297 - BOTTOM + 4 }, theme: 'plain',
    head: [cols.map((cl) => cl.h)], body, columnStyles: colStyles,
    styles: { font: 'NotoSans', fontSize: 9.5, textColor: INK, cellPadding: { top: 2.4, bottom: 2.4, left: 1.5, right: 1.5 }, overflow: 'linebreak', valign: 'top', lineColor: RULE },
    headStyles: { fillColor: HEADBG, textColor: NAVY, fontStyle: 'bold', fontSize: 8.5 },
    rowPageBreak: 'avoid',
    didParseCell: (d) => { if (d.section === 'head' && cols[d.column.index]?.r) d.cell.styles.halign = 'right' },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 0 && ends[d.row.index]) {
        doc.setDrawColor(...RULE); doc.setLineWidth(0.2)
        doc.line(L, d.cell.y + d.cell.height, R, d.cell.y + d.cell.height)
      }
    },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  const room = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = 22 } }

  // Summen
  const trows: [string, string][] = []
  if (T.discAmt) {
    trows.push([T.gross ? 'Summe Positionen netto' : 'Summe Positionen', eur(T.sum)])
    trows.push(['Rabatt ' + fmtPct.format(T.discPct) + ' %', '-' + eur(T.discAmt)])
  }
  if (T.std) {
    trows.push(['Nettobetrag', eur(T.net)])
    for (const t of T.taxes) trows.push(['zzgl. USt ' + fmtPct.format(t.rate) + ' %', eur(t.tax)])
  }
  room(trows.length * 5.4 + 12)
  const TX = 112
  doc.setFontSize(9.5)
  for (const [k, v] of trows) {
    doc.setTextColor(...GREY); doc.text(k, TX, y)
    doc.setTextColor(...INK); doc.text(v, R, y, { align: 'right' })
    y += 5.4
  }
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.5)
  doc.line(TX, y - 2.6, R, y - 2.6)
  y += 2.6
  doc.setFont('NotoSans', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...NAVY)
  doc.text('Gesamtbetrag', TX, y); doc.text(eur(T.total), R, y, { align: 'right' })
  doc.setFont('NotoSans', 'normal'); doc.setTextColor(...INK)
  y += 9

  const note = modeNote(inv)
  if (note) { room(8); doc.setFontSize(9.5); txt(doc.splitTextToSize(note, W), L, y); y += 8 }

  // Schlusstext + GiroCode
  const giro = inv.giro && ibanOk(s.iban) && T.total > 0 && T.total <= 999999999.99
  const QR = 28, tw = giro ? W - QR - 8 : W
  doc.setFontSize(10)
  const ol: string[] = doc.splitTextToSize(fillText(inv.outro, inv, no, T, s).trim(), tw)
  const oh = ol.length && ol[0] !== '' ? ol.length * lh(10) : 0
  room(Math.max(oh, giro ? QR + 6 : 0) + 2)
  y += 2
  if (oh) txt(ol, L, y)
  if (giro) {
    drawGiro(doc, R - QR, y - 3.5, QR, T.total, s, no)
    doc.setFontSize(7); doc.setTextColor(...GREY)
    doc.text('Mit Banking-App scannen', R - QR / 2, y - 3.5 + QR + 3.5, { align: 'center' })
    doc.setTextColor(...INK)
  }

  // Fußzeile auf jeder Seite
  const f1 = [s.name, s.street, cityLine(s), foreign(s.country)].map((v) => v.trim()).filter(Boolean)
  const f2 = [s.phone.trim() && 'Tel. ' + s.phone.trim(), s.email.trim(), s.web.trim(), s.taxno.trim() && 'Steuernr. ' + s.taxno.trim(), s.vatid.trim() && 'USt-IdNr. ' + s.vatid.trim()].filter(Boolean) as string[]
  const owner = s.owner.trim()
  const f3 = [s.bank.trim(), s.iban.trim() && 'IBAN ' + fmtIban(s.iban), s.bic.trim() && 'BIC ' + s.bic.trim().toUpperCase(), owner && owner !== s.name && 'Inhaber ' + owner].filter(Boolean) as string[]
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(L, 270, R, 270)
    doc.setFontSize(7.2); doc.setTextColor(...GREY)
    for (const [lines, cx] of [[f1, L], [f2, 82], [f3, 138]] as [string[], number][]) {
      lines.slice(0, 5).forEach((line, i) => doc.text(doc.splitTextToSize(String(line), 54)[0], cx, 274.5 + i * 3.3))
    }
    if (pages > 1) doc.text('Seite ' + p + ' von ' + pages, R, 292, { align: 'right' })
  }
  return doc
}

// EPC-QR-Code (GiroCode). Felder sind zeilengetrennt: Steuerzeichen (z. B. Zeilenumbrüche aus einer
// fremden Datei) würden die Felder verschieben, etwa eine andere IBAN in den Code schieben als gedruckt.
function drawGiro(doc: jsPDF, x: number, y: number, size: number, amount: number, s: Sender, no: string): void {
  const epc = (v: string) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  const name = (epc(s.owner) || epc(s.name)).slice(0, 70)
  const data = ['BCD', '002', '1', 'SCT', epc(s.bic).replace(/\s/g, '').toUpperCase(), name, cleanIban(s.iban),
    'EUR' + amount.toFixed(2), '', '', epc('Rechnung ' + no).slice(0, 140)].join('\n')
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']
  const qr = qrcode(0, 'M')
  qr.addData(data, 'Byte'); qr.make()
  const n = qr.getModuleCount(), m = size / (n + 2), ox = x + m, oy = y + m
  doc.setFillColor(255, 255, 255); doc.rect(x, y, size, size, 'F')
  doc.setFillColor(0, 0, 0)
  for (let r = 0; r < n; r++) {
    let start = -1
    for (let col = 0; col <= n; col++) {
      const dark = col < n && qr.isDark(r, col)
      if (dark && start < 0) start = col
      if (!dark && start >= 0) { doc.rect(ox + start * m, oy + r * m, (col - start) * m + 0.01, m + 0.01, 'F'); start = -1 }
    }
  }
}

// Fertiges PDF/A-3; mit einvoice zusätzlich ZUGFeRD-XML (Profil EN 16931) eingebettet
export async function invoicePdf(inv: InvoiceData, no: string, s: Sender, einvoice: boolean): Promise<Uint8Array> {
  const assets = await loadAssets()
  const T = calc(inv)
  const doc = buildPdf(inv, no, s, T, assets)
  return finishPdf(doc.output('arraybuffer'), einvoice ? buildCii(inv, no, s, T, 'en16931') : '',
    { title: subject(inv, no), subject: 'Rechnung ' + no, author: s.name }, assets)
}
