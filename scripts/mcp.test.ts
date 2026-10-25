// Ende-zu-Ende-Test des gebündelten MCP-Servers über einen echten MCP-Client (stdio).
// Voraussetzung: node mcp/build.mjs (läuft in npm run build). Ohne Bündel wird übersprungen.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Repo } from '../src/lib/db/repo'

const BUNDLE = join(__dirname, '..', 'mcp', 'bundle', 'server', 'index.cjs')
const DIR = process.env.MCP_TEST_DIR || mkdtempSync(join(tmpdir(), 'oe-rechnung-mcp-'))
let client: Client

type Res = { content: { type: string; text: string }[]; isError?: boolean }
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; data: any; error: boolean }> {
  const r = (await client.callTool({ name, arguments: args })) as Res
  const text = r.content.map((c) => c.text).join('\n')
  const m = /```json\n([\s\S]*)\n```/.exec(text)
  return { text, data: m ? JSON.parse(m[1]) : null, error: !!r.isError }
}

describe.skipIf(!existsSync(BUNDLE))('MCP-Server', () => {
  beforeAll(async () => {
    client = new Client({ name: 'test', version: '1' })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BUNDLE, '--ordner', DIR, '--datei', 'Test.sqlite'], stderr: 'ignore' }))
  })
  afterAll(async () => { await client?.close() })

  it('meldet Werkzeuge, Interview-Vorlagen und Anleitung', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name)
    expect(tools).toEqual(expect.arrayContaining(['status', 'firma_speichern', 'kunde_speichern', 'rechnung_entwurf', 'rechnung_festschreiben', 'rechnung_exportieren']))
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name)
    expect(prompts).toEqual(['einrichtung', 'rechnung_schreiben'])
    const p = await client.getPrompt({ name: 'rechnung_schreiben', arguments: { worum_geht_es: '3 Stunden Beratung' } })
    expect(JSON.stringify(p.messages)).toContain('3 Stunden Beratung')
    expect(client.getInstructions()).toContain('Interview')
  })

  it('führt durch Einrichtung, Rechnung und Export', async () => {
    let r = await call('status')
    expect(r.data.neu).toBe(true)
    expect(r.data.fehlt_firma).toContain('Firmenname')

    r = await call('firma_speichern', { name: 'Muster Design GmbH', strasse: 'Musterweg 5', plz: '10115', ort: 'Berlin', land: 'Deutschland' })
    expect(r.text).toContain('Es fehlt noch: Steuernummer oder USt-IdNr., IBAN')
    r = await call('firma_speichern', { iban: 'DE89 3704 0044 0532 0130 01' })
    expect(r.error).toBe(true)
    r = await call('firma_speichern', { ust_idnr: 'de 123456789', iban: 'DE89370400440532013000', email: 'rechnung@muster.example', telefon: '+49 30 1234567', ansprechpartner: 'Maria Muster' })
    expect(r.text).toContain('vollständig')
    expect(r.data.firma.vatid).toBe('DE123456789')

    r = await call('kunde_speichern', { name: 'Stadtverwaltung Musterstadt', strasse: 'Rathausplatz 1', plz: '80331', ort: 'München', email: 'rechnung@musterstadt.example', leitweg_id_oder_referenz: '09162000-12345-67' })
    expect(r.text).toContain('Leitweg-ID erkannt')
    const kunde = r.data.id
    r = await call('artikel_speichern', { bezeichnung: 'Beratung', einheit: 'Std', preis_netto: '120', ust: '19' })
    const artikel = r.data.id

    r = await call('rechnung_entwurf', { kunde_id: kunde, positionen: [{ artikel_id: artikel, menge: '2,5' }, { bezeichnung: 'Fahrtkosten', menge: '1', einheit: 'Pauschal', preis: '30' }], leistungsdatum: '20.10.2026' })
    expect(r.error).toBe(false)
    const id = r.data.id
    expect(r.data.summen.gesamt).toBe('392,70 €')
    expect(r.data.referenz).toBe('09162000-12345-67')
    expect(r.data.fehlt).toEqual({ rechnung: [], zugferd: [], xrechnung: [] })

    r = await call('rechnung_exportieren', { id, format: 'zugferd' })
    expect(r.error).toBe(true) // Entwurf: erst festschreiben
    r = await call('rechnung_festschreiben', { id })
    expect(r.text).toMatch(/Rechnung \d{4}-001 ist festgeschrieben/)
    r = await call('rechnung_entwurf', { id, betreff: 'geändert' })
    expect(r.error).toBe(true)

    r = await call('rechnung_exportieren', { id, format: 'zugferd' })
    const pdf = r.text.replace('Gespeichert: ', '')
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    r = await call('rechnung_exportieren', { id, format: 'xrechnung' })
    expect(readFileSync(r.text.replace('Gespeichert: ', ''), 'utf8')).toContain('xrechnung_3.0')

    r = await call('rechnung_status_setzen', { id, status: 'bezahlt', bezahlt_am: '25.10.2026' })
    expect(r.text).toContain('Bezahlt')
    r = await call('status')
    expect(r.data.rechnungen).toBe(1)

    // Die Datei ist dieselbe, die die Web-App öffnet
    const SQL = await initSqlJs()
    const repo = Repo.open(SQL, new Uint8Array(readFileSync(join(DIR, 'Test.sqlite'))))
    expect(repo.invoices()[0].paid).toBe('2026-10-25')
    expect(repo.events(id).map((e) => e.action)).toEqual(['festgeschrieben', 'status'])
  })
})
