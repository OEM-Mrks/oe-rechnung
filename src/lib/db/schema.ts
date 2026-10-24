// Aufbau der SQLite-Datei. Bei Änderungen SCHEMA_VERSION erhöhen und eine Migration in repo.ts ergänzen.
export const FORMAT = 'oe-rechnung'
export const SCHEMA_VERSION = 1

export const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'DE',
  vatid TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  buyer_ref TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE INDEX customers_name ON customers(name COLLATE NOCASE);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  vat TEXT NOT NULL DEFAULT '19',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);

-- data = kompletter Rechnungsstand als JSON (InvoiceData), sender = Absender beim Festschreiben.
-- Die übrigen Spalten sind Kennzahlen für Listen und Auswertungen.
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'offen', 'bezahlt', 'storniert')),
  date TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer TEXT NOT NULL DEFAULT '',
  net REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  sender TEXT,
  finalized TEXT NOT NULL DEFAULT '',
  paid TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE UNIQUE INDEX invoices_no ON invoices(no) WHERE no <> '';
CREATE INDEX invoices_date ON invoices(date);

-- Festgeschriebene Rechnungen sind unveränderlich, bis sie ausdrücklich entsperrt werden (siehe Protokoll)
CREATE TRIGGER invoices_lock BEFORE UPDATE OF no, date, data, sender, net, tax, total ON invoices
WHEN OLD.finalized <> '' AND NEW.finalized <> ''
BEGIN SELECT RAISE(ABORT, 'Rechnung ist festgeschrieben'); END;
CREATE TRIGGER invoices_nodelete BEFORE DELETE ON invoices
WHEN OLD.finalized <> ''
BEGIN SELECT RAISE(ABORT, 'Festgeschriebene Rechnungen lassen sich nicht löschen'); END;

-- Protokoll für die Nachvollziehbarkeit (festgeschrieben, Status geändert, entsperrt, importiert)
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  invoice_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
`
