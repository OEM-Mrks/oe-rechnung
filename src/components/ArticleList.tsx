// Artikel und Leistungen, die sich in Rechnungspositionen übernehmen lassen
import { useMemo, useState } from 'react'
import { UNIT_SUGGESTIONS } from '../lib/einvoice/codes'
import { getRepo, useSession } from '../lib/session'
import { emptyArticle, type Article } from '../lib/types'
import { eur, num } from '../lib/util'
import { Field, Icon, useConfirm, useToast } from './ui'

export function ArticleList() {
  const { version } = useSession()
  const repo = getRepo()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Article | null>(null)
  const list = useMemo(() => repo.articles(), [repo, version])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? list.filter((a) => [a.no, a.name, a.desc].some((v) => v.toLowerCase().includes(n))) : list
  }, [list, q])

  return (
    <div className="stack">
      <header className="page-head row">
        <div>
          <h1 className="page-title">Artikel und Leistungen</h1>
          <p className="oe-muted">Wiederkehrende Positionen mit Preis und Steuersatz. In der Rechnung über das Feld „Leistung“ auswählen.</p>
        </div>
        <button type="button" className="oe-btn oe-btn--primary" onClick={() => setEdit(emptyArticle())}>{Icon.plus}Neuer Artikel</button>
      </header>

      {edit && <ArticleForm key={edit.id ?? 'neu'} initial={edit} onDone={() => setEdit(null)} />}

      <section className="oe-card">
        <div className="list-tools">
          <input className="oe-input search" type="search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Artikel suchen" />
        </div>
        {!shown.length ? <p className="empty">{list.length ? 'Kein Artikel passt zur Suche.' : 'Noch keine Artikel angelegt.'}</p> : (
          <table className="tbl">
            <thead><tr><th>Nr.</th><th>Bezeichnung</th><th className="num">Preis netto</th><th className="num hide-sm">USt</th><th className="hide-sm">Einheit</th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setEdit(a)}>
                  <td className="oe-mono">{a.no}</td>
                  <td><strong>{a.name}</strong>{a.desc && <span className="sub">{a.desc}</span>}</td>
                  <td className="num">{eur(num(a.price))}</td>
                  <td className="num hide-sm">{a.vat} %</td>
                  <td className="hide-sm">{a.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function ArticleForm({ initial, onDone }: { initial: Article; onDone: () => void }) {
  const repo = getRepo()
  const toast = useToast()
  const confirm = useConfirm()
  const [a, setA] = useState<Article>(initial)
  const F = (k: keyof Article) => (v: string) => setA({ ...a, [k]: v })
  const isNew = a.id == null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!a.name.trim()) return toast('Bitte eine Bezeichnung eingeben.', 'negative')
    repo.saveArticle(a)
    toast(isNew ? 'Artikel angelegt.' : 'Artikel gespeichert.', 'positive')
    onDone()
  }
  async function remove() {
    if (a.id == null) return
    if ((await confirm({ title: 'Artikel „' + a.name + '“ löschen?', danger: true, ok: 'Löschen', body: <p>Bestehende Rechnungen bleiben unverändert.</p> })) === null) return
    repo.deleteArticle(a.id)
    toast('Artikel gelöscht.')
    onDone()
  }

  return (
    <form className="oe-card form-card" onSubmit={submit}>
      <h2 className="card-title">{isNew ? 'Neuer Artikel' : 'Artikel bearbeiten'}</h2>
      <div className="grid g6">
        <Field className="s4" label="Bezeichnung" value={a.name} onChange={F('name')} input={{ autoFocus: true }} />
        <Field className="s2" label="Artikelnummer" opt="optional" value={a.no} onChange={F('no')} input={{ className: 'oe-input oe-mono' }} />
        <Field className="s6" label="Beschreibung" opt="optional" value={a.desc} onChange={F('desc')} multiline={2} />
        <Field className="s2" label="Preis netto" value={a.price} onChange={F('price')} input={{ inputMode: 'decimal', className: 'oe-input num', placeholder: '0,00' }} />
        <div className="oe-field s2">
          <label className="oe-label" htmlFor="art-vat">USt-Satz</label>
          <select id="art-vat" className="oe-select" value={a.vat} onChange={(e) => setA({ ...a, vat: e.target.value })}>
            {['19', '7', '0'].map((v) => <option key={v} value={v}>{v} %</option>)}
          </select>
        </div>
        <Field className="s2" label="Einheit" value={a.unit} onChange={F('unit')} input={{ list: 'units' }} />
      </div>
      <datalist id="units">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="form-actions">
        {!isNew && <button type="button" className="oe-btn oe-btn--ghost danger-text" onClick={() => void remove()}>Löschen</button>}
        <span className="spacer" />
        <button type="button" className="oe-btn oe-btn--ghost" onClick={onDone}>Abbrechen</button>
        <button type="submit" className="oe-btn oe-btn--primary">Speichern</button>
      </div>
    </form>
  )
}
