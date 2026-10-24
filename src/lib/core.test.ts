import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { calc } from './calc'
import { missing } from './check'
import { Repo } from './db/repo'
import { exportJson, importJson } from './db/transfer'
import { buildCii } from './einvoice/cii'
import { sampleInvoice, sampleSender } from './samples'

let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs() })

describe('calc', () => {
  it('rechnet netto mit zwei Steuersätzen und Gesamtrabatt', () => {
    const d = sampleInvoice()
    d.items = [
      { t: 'Beratung', d: '', q: '2,5', u: 'Std', p: '100', v: '19', r: '' },
      { t: 'Buch', d: '', q: '1', u: 'Stk', p: '20', v: '7', r: '10' },
    ]
    d.discount = '5'
    const T = calc(d)
    expect(T.sum).toBe(268)
    expect(T.vat.map((g) => [g.rate, g.base, g.tax])).toEqual([[19, 237.5, 45.13], [7, 17.1, 1.2]])
    expect(T.total).toBe(300.93)
  })
  it('rechnet Bruttopreise auf netto zurück', () => {
    const d = sampleInvoice()
    d.gross = '1'
    d.items = [{ t: 'Paket', d: '', q: '1', u: 'Stk', p: '119', v: '19', r: '' }]
    const T = calc(d)
    expect([T.net, T.taxTotal, T.total]).toEqual([100, 19, 119])
  })
})

describe('Repo', () => {
  it('legt Kunden mit fortlaufender Nummer an und schreibt Rechnungen fest', () => {
    const r = Repo.create(SQL, sampleSender())
    const draft = r.newDraft(sampleInvoice())
    const no = r.finalize(draft)
    expect(no).toBe(new Date().getFullYear() + '-001')
    expect(r.settings().nextNo).toBe(new Date().getFullYear() + '-002')
    const inv = r.invoice(draft)!
    expect(inv.status).toBe('offen')
    expect(inv.sender?.name).toBe('Muster Design GmbH')
    // Kunde wurde in den Stamm übernommen
    expect(r.customers().map((c) => [c.no, c.name, c.buyerRef])).toEqual([['K-0001', 'Beispiel AG', '04011000-12345-03']])
    expect(inv.data.client.customerId).toBe(r.customers()[0].id)
    // Festgeschrieben: nicht mehr änderbar, nicht löschbar
    expect(() => r.run('UPDATE invoices SET total = 1 WHERE id = ?', [draft])).toThrow(/festgeschrieben/)
    expect(() => r.run('DELETE FROM invoices WHERE id = ?', [draft])).toThrow(/löschen/)
    r.setStatus(draft, 'bezahlt')
    expect(r.invoice(draft)!.paid).not.toBe('')
    expect(r.events(draft).map((e) => e.action)).toEqual(['festgeschrieben', 'status'])
  })
  it('verhindert doppelte Rechnungsnummern', () => {
    const r = Repo.create(SQL, sampleSender())
    const a = r.newDraft({ ...sampleInvoice(), no: 'R-1' })
    const b = r.newDraft({ ...sampleInvoice(), no: 'R-1' })
    r.finalize(a)
    expect(() => r.finalize(b)).toThrow(/schon vergeben/)
  })
  it('übersteht Speichern und Öffnen als SQLite-Datei', () => {
    const r = Repo.create(SQL, sampleSender())
    r.finalize(r.newDraft(sampleInvoice()))
    const r2 = Repo.open(SQL, r.export())
    expect(r2.invoices()).toHaveLength(1)
    expect(r2.settings().sender.iban).toBe(sampleSender().iban)
    expect(() => Repo.open(SQL, new TextEncoder().encode('kein sqlite'))).toThrow(/keine SQLite/)
  })
  it('exportiert und importiert JSON verlustfrei', () => {
    const r = Repo.create(SQL, sampleSender())
    r.finalize(r.newDraft(sampleInvoice()))
    r.newDraft(sampleInvoice())
    r.saveArticle({ id: null, no: 'A1', name: 'Webdesign', desc: '', unit: 'Std', price: '95', vat: '19' })
    const { repo } = importJson(SQL, exportJson(r))
    expect(repo.invoices().map((i) => i.status).sort()).toEqual(['entwurf', 'offen'])
    expect(repo.articles()[0].name).toBe('Webdesign')
    const fin = repo.invoices().find((i) => i.status === 'offen')!
    expect(fin.data.client.customerId).toBe(repo.customers()[0].id)
  })
  it('übernimmt das alte Rechnungsbuch', () => {
    const legacy = {
      format: 'oemedia-rechnungsbuch', version: 1, sender: { name: 'Alt GmbH', country: 'Deutschland', iban: 'DE89 3704 0044 0532 0130 00' },
      settings: { mode: 'klein', days: '30' }, nextNo: '2026-008',
      customers: [{ name: 'Kunde A', no: '17', country: 'Österreich' }],
      journal: [{ no: '2026-007', date: '2026-10-01', status: 'bezahlt', paid: '2026-10-05', created: '2026-10-01T10:00:00Z',
        invoice: { client: { name: 'Kunde A', no: '17', country: 'Österreich' }, inv: { no: '2026-007', date: '2026-10-01', days: '30' }, mode: 'klein', items: [{ t: 'X', q: '1', p: '50' }] } }],
    }
    const { repo, info } = importJson(SQL, JSON.stringify(legacy))
    expect(info).toMatch(/1 Rechnungen, 1 Kunden/)
    expect(repo.settings().nextNo).toBe('2026-008')
    expect(repo.settings().sender.country).toBe('DE')
    const inv = repo.invoices()[0]
    expect([inv.no, inv.status, inv.total, inv.data.client.country]).toEqual(['2026-007', 'bezahlt', 50, 'AT'])
  })
})

describe('E-Rechnung', () => {
  it('XRechnung enthält Kennung, Käuferreferenz und Kontakt', () => {
    const d = sampleInvoice(), s = sampleSender()
    const xml = buildCii(d, '2026-001', s, calc(d), 'xrechnung')
    expect(xml).toContain('urn:xeinkauf.de:kosit:xrechnung_3.0')
    expect(xml).toContain('<ram:BuyerReference>04011000-12345-03</ram:BuyerReference>')
    expect(xml).toContain('<ram:PersonName>Maria Muster</ram:PersonName>')
    expect(missing(d, s, calc(d)).xrechnung).toEqual([])
  })
  it('meldet fehlende Angaben für XRechnung', () => {
    const d = sampleInvoice(), s = { ...sampleSender(), phone: '', email: '' }
    d.ref = ''
    expect(missing(d, s, calc(d)).xrechnung).toEqual(['Käuferreferenz bzw. Leitweg-ID des Kunden', 'Ihre Telefonnummer', 'Ihre E-Mail-Adresse'])
  })
})
