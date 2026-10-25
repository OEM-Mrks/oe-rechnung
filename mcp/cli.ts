// Befehlszeile für den Skill: dieselben Werkzeuge wie der MCP-Server, aufgerufen von der KI per Shell.
//   node oe-rechnung.cjs --datei Rechnungen.sqlite <werkzeug> '<json>'
//   node oe-rechnung.cjs --datei Rechnungen.sqlite <werkzeug> - <<'JSON'   (JSON von der Standardeingabe)
//   node oe-rechnung.cjs werkzeuge [--markdown]      Werkzeuge mit Parametern
//   node oe-rechnung.cjs interview <name> ['<json>']  Ablauf eines Interviews
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { filePath, init, PROMPTS, TOOLS, VERSION } from './core'

function expand(p: string): string {
  const x = p.replace(/^~(?=$|\/|\\)/, homedir())
  return isAbsolute(x) ? x : resolve(x)
}
function die(msg: string, code = 2): never {
  process.stderr.write(msg + '\n')
  process.exit(code)
}

// Optionen (--name wert) von den übrigen Argumenten trennen
const opts: Record<string, string> = {}
const rest: string[] = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--markdown') opts.markdown = '1'
  else if (/^--(datei|export|json-datei)$/.test(a)) opts[a.slice(2)] = argv[++i] ?? die('Wert fehlt für ' + a)
  else rest.push(a)
}
const [cmd, payload] = rest

function readArgs(): Record<string, unknown> {
  const text = opts['json-datei'] ? readFileSync(expand(opts['json-datei']), 'utf8') : payload === '-' ? readFileSync(0, 'utf8') : payload || '{}'
  try {
    const v = JSON.parse(text.trim() || '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v
  } catch { return die('Parameter sind kein gültiges JSON-Objekt: ' + text.slice(0, 200)) }
}

function schemaOf(shape: z.ZodRawShape | undefined) {
  return z.toJSONSchema(z.object(shape || {}), { unrepresentable: 'any' }) as { properties?: Record<string, { description?: string; type?: string | string[]; enum?: unknown[] }>; required?: string[] }
}
function listTools(markdown: boolean): string {
  const out: string[] = []
  for (const t of TOOLS) {
    const js = schemaOf(t.config.inputSchema)
    const props = Object.entries(js.properties || {})
    if (markdown) {
      out.push('### `' + t.name + '` – ' + t.config.title, '', t.config.description, '')
      if (props.length) {
        out.push('| Parameter | Typ | Pflicht | Beschreibung |', '|---|---|---|---|')
        for (const [k, p] of props) {
          const type = p.enum ? p.enum.map((e) => '`' + String(e) + '`').join(' / ') : Array.isArray(p.type) ? p.type.join('/') : p.type || 'objekt'
          out.push('| `' + k + '` | ' + type + ' | ' + ((js.required || []).includes(k) ? 'ja' : '') + ' | ' + (p.description || '').replace(/\|/g, '/') + ' |')
        }
      } else out.push('Keine Parameter.')
      out.push('')
    } else out.push(t.name + ' – ' + t.config.title + (props.length ? '\n  Parameter: ' + JSON.stringify(js.properties) : ''))
  }
  return out.join('\n')
}

async function main() {
  if (!cmd || cmd === 'hilfe' || cmd === '--help') {
    process.stdout.write('oe-rechnung ' + VERSION + '\nAufruf: node oe-rechnung.cjs --datei <Datei.sqlite> <werkzeug> \'<json>\'\n' +
      'Weitere Befehle: werkzeuge [--markdown], interview <' + PROMPTS.map((p) => p.name).join('|') + '>, version\n')
    return
  }
  if (cmd === 'version') return void process.stdout.write(VERSION + '\n')
  if (cmd === 'werkzeuge') return void process.stdout.write(listTools(!!opts.markdown) + '\n')
  if (cmd === 'interview') {
    const p = PROMPTS.find((x) => x.name === payload)
    if (!p) die('Unbekanntes Interview. Verfügbar: ' + PROMPTS.map((x) => x.name).join(', '))
    const extra = rest[2] ? JSON.parse(rest[2]) : {}
    return void process.stdout.write(p.cb(extra).messages.map((m) => m.content.text).join('\n') + '\n')
  }
  const t = TOOLS.find((x) => x.name === cmd)
  if (!t) die('Unbekanntes Werkzeug „' + cmd + '“. Liste: node oe-rechnung.cjs werkzeuge')
  if (!opts.datei) die('Bitte mit --datei <Pfad zur .sqlite-Datei> aufrufen. Gibt es die Datei noch nicht, wird sie angelegt.')
  const parsed = z.object(t.config.inputSchema || {}).strict().safeParse(readArgs())
  if (!parsed.success) die('Ungültige Parameter für ' + t.name + ':\n' + parsed.error.issues.map((i) => '- ' + (i.path.join('.') || '(Objekt)') + ': ' + i.message).join('\n'))
  await init({ file: expand(opts.datei), exportDir: opts.export ? expand(opts.export) : undefined, wasmDir: dirname(process.argv[1]) })
  const r = await t.cb(parsed.data)
  process.stdout.write(r.content.map((c) => c.text).join('\n') + '\n' + (r.isError ? '' : '(Datei: ' + filePath() + ')\n'))
  if (r.isError) process.exit(1)
}
main().catch((e) => die(e instanceof Error ? e.stack || e.message : String(e), 1))
