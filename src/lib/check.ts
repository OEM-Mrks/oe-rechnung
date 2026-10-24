// Fehlende Pflichtangaben, getrennt nach Rechnung allgemein (§ 14 UStG), ZUGFeRD und XRechnung
import type { Totals } from './calc'
import { countryCode, isLeitwegId } from './einvoice/codes'
import type { InvoiceData, Sender } from './types'
import { ibanOk } from './util'

export interface Missing {
  invoice: string[] // ohne diese Angaben keine ordnungsgemäße Rechnung
  zugferd: string[] // zusätzlich für die eingebettete E-Rechnung
  xrechnung: string[] // zusätzlich für XRechnung
}

export function missing(inv: InvoiceData, s: Sender, T: Totals): Missing {
  const m: string[] = [], c = inv.client
  if (!s.name.trim()) m.push('Ihr Name oder Firmenname')
  if (!s.street.trim() || !s.zip.trim() || !s.city.trim()) m.push('Ihre Anschrift')
  if (!s.taxno.trim() && !s.vatid.trim()) m.push('Ihre Steuernummer oder USt-IdNr.')
  if (!c.name.trim()) m.push('Name des Kunden')
  if (!c.street.trim() || !c.zip.trim() || !c.city.trim()) m.push('Anschrift des Kunden')
  if (!inv.date) m.push('Rechnungsdatum')
  if (!T.lines.some((l) => l.used && String(inv.items[l.i].t).trim())) m.push('mindestens eine Position mit Bezeichnung')
  if (inv.mode === 'rc') {
    if (!s.vatid.trim()) m.push('Ihre USt-IdNr.')
    if (!c.vatid.trim()) m.push('USt-IdNr. des Kunden')
  }
  if (s.iban.trim() && !ibanOk(s.iban)) m.push('eine gültige IBAN')

  const z: string[] = []
  if (!countryCode(s.country)) z.push('Ihr Land')
  if (!countryCode(c.country)) z.push('Land des Kunden')

  const x: string[] = [...z]
  if (!inv.ref.trim()) x.push('Käuferreferenz bzw. Leitweg-ID des Kunden')
  if (s.phone.replace(/\D/g, '').length < 3) x.push('Ihre Telefonnummer')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email.trim())) x.push('Ihre E-Mail-Adresse')
  if (!c.email.trim() && !isLeitwegId(inv.ref)) x.push('E-Mail-Adresse des Kunden (oder eine Leitweg-ID als Käuferreferenz)')
  if (!ibanOk(s.iban)) x.push('Ihre IBAN')
  return { invoice: m, zugferd: z, xrechnung: x }
}
