import type { InvoiceData, Sender } from './types'
import { addDays, deDate, eur, num, round2 } from './util'

export interface Line {
  i: number
  q: number
  p: number
  r: number
  rate: number
  amt: number // Anzeige: netto bzw. brutto
  net: number // Zeilen-Nettobetrag, Grundlage aller Summen (EN 16931)
  pNet: number
  base: number
  allow: number
  used: boolean
}
export interface VatGroup {
  rate: number
  lines: number
  allow: number
  base: number
  tax: number
}
export interface Totals {
  std: boolean
  gross: boolean
  lines: Line[]
  sum: number
  discPct: number
  discAmt: number
  net: number
  vat: VatGroup[]
  taxes: VatGroup[]
  taxTotal: number
  total: number
  rates: number[]
}

export function calc(inv: InvoiceData): Totals {
  const std = inv.mode === 'std'
  const gross = std && inv.gross === '1'
  const disc = Math.min(Math.max(num(inv.discount), 0), 100) / 100
  const lines: Line[] = []
  const groups: Record<number, number> = {}
  let sum = 0
  inv.items.forEach((it, i) => {
    const q = num(it.q), p = num(it.p), r = Math.min(Math.max(num(it.r), 0), 100) / 100
    const rate = std ? num(it.v) : 0, f = gross ? 1 + rate / 100 : 1
    const amt = round2(q * p * (1 - r))
    const net = gross ? round2(amt / f) : amt
    let pNet = p / f, base = round2(q * pNet)
    if (gross && !r && q) { pNet = net / q; base = net }
    const used = !!(String(it.t).trim() || p)
    lines.push({ i, q, p, r, rate, amt, net, pNet, base, allow: r ? round2(base - net) : 0, used })
    if (!used) return
    groups[rate] = round2((groups[rate] || 0) + net)
    sum = round2(sum + net)
  })
  const rates = Object.keys(groups).map(Number).sort((a, b) => b - a)
  const vat: VatGroup[] = []
  let basis = 0, taxTotal = 0, allow = 0
  for (const rate of rates) {
    const a = round2(groups[rate] * disc), b = round2(groups[rate] - a), t = round2(b * rate / 100)
    vat.push({ rate, lines: groups[rate], allow: a, base: b, tax: t })
    allow = round2(allow + a); basis = round2(basis + b); taxTotal = round2(taxTotal + t)
  }
  return {
    std, gross, lines, sum, discPct: disc * 100, discAmt: allow, net: basis, vat,
    taxes: vat.filter((g) => g.rate > 0), taxTotal, total: round2(basis + taxTotal), rates,
  }
}

export function dueIso(inv: InvoiceData): string {
  return addDays(inv.date, num(inv.days))
}
export function subject(inv: InvoiceData, no: string): string {
  return String(inv.subject || '').trim() || 'Rechnung Nr. ' + (no || '')
}
export function modeNote(inv: InvoiceData): string {
  if (inv.mode === 'klein') return 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'
  if (inv.mode === 'rc') return 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).'
  return ''
}
export const PLACEHOLDERS = ['betrag', 'faellig', 'nummer', 'name', 'datum', 'kunde'] as const
export function fillText(txt: string, inv: InvoiceData, no: string, T: Totals, sender: Sender): string {
  const map: Record<string, string> = {
    betrag: eur(T.total), faellig: deDate(dueIso(inv)), nummer: no || '', name: sender.name || '',
    datum: deDate(inv.date), kunde: inv.client.name || '',
  }
  return String(txt || '').replace(/\{(betrag|faellig|nummer|name|datum|kunde)\}/g, (_, k: string) => map[k])
}
