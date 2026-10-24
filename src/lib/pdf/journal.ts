// Rechnungsjournal (Liste aller Rechnungen eines Zeitraums) als PDF/A
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { STATUS_LABEL, type InvoiceRow, type Sender } from '../types'
import { deDate, eur, round2, today } from '../util'
import { addFonts, loadAssets } from './assets'
import { GREY, HEADBG, INK, NAVY, RULE } from './invoice'
import { finishPdf } from './pdfa'

export function journalSums(rows: InvoiceRow[]) {
  const s = { n: 0, net: 0, tax: 0, total: 0, open: 0 }
  for (const j of rows) {
    if (j.status === 'storniert' || j.status === 'entwurf') continue
    s.n++; s.net = round2(s.net + j.net); s.tax = round2(s.tax + j.tax); s.total = round2(s.total + j.total)
    if (j.status !== 'bezahlt') s.open = round2(s.open + j.total)
  }
  return s
}

export async function journalPdf(rows: InvoiceRow[], label: string, sender: Sender): Promise<Uint8Array> {
  const assets = await loadAssets()
  const s = journalSums(rows)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  addFonts(doc, assets)
  const title = 'Rechnungsjournal' + (label ? ' ' + label : '')
  doc.setFont('NotoSans', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY)
  doc.text(title, 20, 24)
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY)
  doc.text([sender.name, [sender.street, [sender.zip, sender.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean), 20, 31, { lineHeightFactor: 1.35 })
  doc.text('Stand: ' + deDate(today()) + ' · ' + s.n + ' Rechnungen', 190, 31, { align: 'right' })
  autoTable(doc, {
    startY: 42, margin: { left: 20, right: 20, top: 20, bottom: 20 }, theme: 'plain',
    head: [['Nr.', 'Datum', 'Kunde', 'Netto', 'USt', 'Brutto', 'Status', 'Bezahlt am']],
    body: rows.map((j) => [j.no, deDate(j.date), j.customer || '', eur(j.net), eur(j.tax), eur(j.total), STATUS_LABEL[j.status], j.status === 'bezahlt' && j.paid ? deDate(j.paid) : '']),
    foot: [['', '', 'Summe', eur(s.net), eur(s.tax), eur(s.total), '', '']],
    styles: { font: 'NotoSans', fontSize: 8.5, textColor: INK, cellPadding: 1.6, lineColor: RULE, overflow: 'linebreak' },
    headStyles: { fillColor: HEADBG, textColor: NAVY, fontStyle: 'bold' }, footStyles: { fontStyle: 'bold', textColor: NAVY },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 19 }, 3: { halign: 'right', cellWidth: 21 }, 4: { halign: 'right', cellWidth: 18 }, 5: { halign: 'right', cellWidth: 21 }, 6: { cellWidth: 17 }, 7: { cellWidth: 21 } },
    didParseCell: (d) => {
      if ((d.section === 'head' || d.section === 'foot') && d.column.index >= 3 && d.column.index <= 5) d.cell.styles.halign = 'right'
      if (d.section === 'body' && rows[d.row.index]?.status === 'storniert') d.cell.styles.textColor = GREY
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 0) { doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(20, d.cell.y + d.cell.height, 190, d.cell.y + d.cell.height) }
    },
  })
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  if (y > 270) { doc.addPage(); y = 24 }
  doc.setFontSize(9); doc.setTextColor(...INK)
  doc.text('Summe ohne Entwürfe und stornierte Rechnungen · davon offen: ' + eur(s.open), 20, y)
  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.text('Seite ' + p + ' von ' + n, 190, 290, { align: 'right' }) }
  return finishPdf(doc.output('arraybuffer'), '', { title, subject: 'Rechnungsjournal', author: sender.name }, assets)
}
