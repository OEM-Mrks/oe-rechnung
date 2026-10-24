// Erzeugt Beispielrechnungen für die externe Prüfung (KoSIT-Validator, Mustang/veraPDF):
//   SAMPLES_OUT=pfad npx vitest run scripts/samples.test.ts
// Ohne SAMPLES_OUT wird der Test übersprungen.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { calc } from '../src/lib/calc'
import { buildCii } from '../src/lib/einvoice/cii'
import { invoicePdf } from '../src/lib/pdf/invoice'
import { sampleInvoice, sampleSender } from '../src/lib/samples'
import type { InvoiceData, Sender } from '../src/lib/types'

const OUT = process.env.SAMPLES_OUT

function cases(): [string, InvoiceData, Sender][] {
  const std = sampleInvoice()
  std.sdate = '2026-10-01'; std.edate = '2026-10-15'; std.discount = '3'
  std.items.push({ t: 'Wartung', d: '', q: '1', u: 'Monat', p: '49,00', v: '19', r: '10' })

  const gross = sampleInvoice()
  gross.gross = '1'
  gross.items = [{ t: 'Fotoshooting', d: 'inkl. Bearbeitung', q: '1', u: 'Pauschal', p: '595', v: '19', r: '' }, { t: 'Fotobuch', d: '', q: '3', u: 'Stk', p: '32,10', v: '7', r: '5' }]

  const klein = sampleInvoice()
  klein.mode = 'klein'
  klein.items = [{ t: 'Nachhilfe', d: '', q: '6', u: 'Std', p: '25', v: '19', r: '' }]
  const kleinSender = { ...sampleSender(), vatid: '' }

  const rc = sampleInvoice()
  rc.mode = 'rc'
  rc.client = { ...rc.client, name: 'Wiener Werbe GmbH', street: 'Ringstraße 10', zip: '1010', city: 'Wien', country: 'AT', vatid: 'ATU12345678' }
  rc.ref = 'PO-2026-17'
  rc.items = [{ t: 'Kampagnenkonzept', d: '', q: '1', u: 'Pauschal', p: '2400', v: '19', r: '' }]

  const sofort = sampleInvoice()
  sofort.days = '0'
  sofort.items = [{ t: 'Softwarelizenz', d: '', q: '1', u: 'Lizenz', p: '0', v: '0', r: '' }, { t: 'Einrichtung', d: '', q: '1', u: 'Pauschal', p: '150', v: '19', r: '' }]

  return [['standard', std, sampleSender()], ['brutto-rabatt', gross, sampleSender()], ['kleinunternehmer', klein, kleinSender], ['reverse-charge-at', rc, sampleSender()], ['sofort-nullsatz', sofort, sampleSender()]]
}

it.skipIf(!OUT)('Beispielrechnungen schreiben', async () => {
  const dir = OUT as string
  mkdirSync(dir, { recursive: true })
  let n = 1
  for (const [name, inv, s] of cases()) {
    const no = '2026-' + String(100 + n++)
    const T = calc(inv)
    writeFileSync(join(dir, name + '_xrechnung.xml'), buildCii(inv, no, s, T, 'xrechnung'))
    writeFileSync(join(dir, name + '_zugferd.xml'), buildCii(inv, no, s, T, 'en16931'))
    writeFileSync(join(dir, name + '_zugferd.pdf'), await invoicePdf(inv, no, s, true))
  }
}, 60000)
