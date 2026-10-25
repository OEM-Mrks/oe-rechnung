// Test des gebündelten Skill-Programms (Befehlszeile), so wie eine KI es per Shell aufruft.
// Voraussetzung: node mcp/build.mjs (läuft in npm run build). Ohne Bündel wird übersprungen.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = join(__dirname, '..', 'mcp', 'bundle-skill', 'oe-rechnung', 'scripts', 'oe-rechnung.cjs')
const FILE = join(mkdtempSync(join(tmpdir(), 'oe-rechnung-skill-')), 'Rechnungen.sqlite')

function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' })
  return { out: r.stdout, err: r.stderr, code: r.status }
}
const tool = (name: string, json?: object) => run(['--datei', FILE, name, ...(json ? ['-'] : [])], json && JSON.stringify(json))

describe.skipIf(!existsSync(CLI))('Skill-Befehlszeile', () => {
  it('listet Werkzeuge und Interviews', () => {
    expect(run(['werkzeuge']).out).toContain('rechnung_festschreiben')
    expect(run(['interview', 'einrichtung']).out).toContain('Interview')
    expect(run(['--datei', FILE, 'gibtsnicht']).code).toBe(2)
  })

  it('schreibt eine Rechnung von der leeren Datei bis zum Export', () => {
    expect(tool('status').out).toContain('gibt es noch nicht')
    expect(tool('firma_speichern', { name: 'Bäckerei „Sonnenschein“', strasse: 'Markt 3', plz: '50667', ort: 'Köln', steuernummer: '215/5555/1234', iban: 'DE89370400440532013000' }).code).toBe(0)
    const bad = tool('kunde_speichern', { nme: 'Tippfehler' })
    expect([bad.code, bad.err]).toEqual([2, expect.stringContaining('nme')])
    expect(tool('kunde_speichern', { name: 'Müller & Co. KG', strasse: 'Weg 1', plz: '10115', ort: 'Berlin' }).out).toContain('K-0001')
    const d = tool('rechnung_entwurf', { kunde_id: 1, positionen: [{ bezeichnung: 'Torte', menge: '2', einheit: 'Stk', preis: '35', ust: '7' }] })
    expect(d.out).toContain('Gesamt 74,90 €')
    expect(tool('rechnung_festschreiben', { id: 1 }).out).toMatch(/Rechnung \d{4}-001 ist festgeschrieben/)
    const ex = tool('rechnung_exportieren', { id: 1, format: 'zugferd' })
    const pdf = /Gespeichert: (.+\.pdf)/.exec(ex.out)![1]
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    expect(tool('rechnung_entwurf', { id: 1, betreff: 'x' }).code).toBe(1)
  })
})
