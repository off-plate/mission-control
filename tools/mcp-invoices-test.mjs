/* Invoices for the Claude connector. `ZOD_PATH=... node tools/mcp-invoices-test.mjs`
   1. numbering, totals, status, IBAN equal src/invoicecalc.ts
   2. what the connector writes is what the app's own pull (src/invoicecloud.ts mergeRows) takes
   3. create, edit, status, delete, contacts through the fake server, all on the tables;
      a delete is buried in the blob so a stale app copy cannot bring it back */
import assert from 'assert/strict'
import { loadKit, TODAY } from './mcp-test-kit.mjs'

const K = await loadKit({
  modules: ['tools-invoices.ts', 'ops-invoices.ts'],
  extra: [
    "export { nextNumber as appNext, vsFromNumber as appVs, totals as appTotals, shownStatus as appShown, czIban as appIban, pickAccount as appPick, invoiceTotal as appInvTotal } from './src/invoicecalc.ts'",
    "export { mergeRows as appMergeRows } from './src/invoicecloud.ts'",
  ],
})
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const I = M.ops_invoices
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

/* ---- 1. parity ---- */
const nums = [{ number: 'PM375' }, { number: 'PM376' }, { number: '2026-0007' }, { number: 'X' }]
for (const f of ['PMNNN', 'YYYY-NNNN', 'YY/MM/NN', 'INV']) assert.equal(I.nextNumber(nums, f, TODAY), M.appNext(nums, f, TODAY), `nextNumber ${f}`)
assert.equal(I.nextNumber(nums, 'PMNNN', TODAY), 'PM377')
for (const n of ['PM377', '2026-0042', 'abc']) assert.equal(I.vsFromNumber(n), M.appVs(n))
const lines = [{ qty: 3, price: 1200.5, vat: 21 }, { qty: 1, price: 99.99, vat: 12 }, { qty: 0.5, price: 10, vat: 21 }]
for (const v of [true, false]) assert.deepEqual(I.totals(lines, v), M.appTotals(lines, v), `totals vatPayer=${v}`)
for (const i of [{ status: 'open', due: addDays(TODAY, -1) }, { status: 'sent', due: TODAY }, { status: 'paid', due: '2020-01-01' }, { status: 'cancelled', due: '2020-01-01' }]) assert.equal(I.shownStatus(i, TODAY), M.appShown(i, TODAY))
for (const a of ['19-2000145399/0800', '2000145399/2010', 'nonsense']) assert.equal(I.czIban(a), M.appIban(a))
const accs = [{ id: 'a', label: 'Fio', isDefault: true }, { id: 'b', label: 'Wise EUR', currency: 'EUR' }]
for (const c of ['CZK', 'EUR', 'USD']) assert.equal(I.pickAccount(accs, c)?.id, M.appPick(accs, c)?.id)

/* ---- the world ---- */
const T0 = Date.parse('2026-11-01T10:00:00Z')
const profile = { name: 'Michael Florian', ico: '12345678', street: 'Ulice 1', city: 'Praha', zip: '110 00', country: 'Česká republika', vatPayer: false, regNote: 'Fyzická osoba zapsaná v živnostenském rejstříku.', dueDays: 14, numberFormat: 'PMNNN', footer: '' }
const tables = {
  mc_invoice_settings: [{ owner: 'u1', profile, updated_at: new Date(T0).toISOString() }],
  mc_invoice_accounts: [{ id: 'acc-fio', label: 'Fio VF', account: '2000145399/2010', currency: 'CZK', is_default: true, updated_at: new Date(T0).toISOString(), deleted_at: null }],
  mc_invoice_contacts: [{ id: 'ivc-rvlt', name: 'RVLT Digital s.r.o.', ico: '87654321', city: 'Praha', due_days: 30, created_at: new Date(T0).toISOString(), updated_at: new Date(T0).toISOString(), deleted_at: null }],
  mc_invoices: [
    { id: 'fk-1', number: 'PM375', status: 'sent', client_id: 'ivc-rvlt', client: { name: 'RVLT Digital s.r.o.' }, supplier: { name: 'Michael Florian', vatPayer: false }, issued: addDays(TODAY, -40), taxable: addDays(TODAY, -40), due: addDays(TODAY, -10), sent_on: addDays(TODAY, -40), method: 'bank', currency: 'CZK', lang: 'cs', vs: '375', lines: [{ id: 'l1', name: 'Konzultace', qty: 10, unit: 'h', price: 1000, vat: 21 }], total: 10000, created_at: new Date(T0).toISOString(), updated_at: new Date(T0).toISOString(), deleted_at: null },
    { id: 'fk-2', number: 'PM376', status: 'paid', client: { name: 'Small client' }, supplier: { name: 'Michael Florian', vatPayer: false }, issued: addDays(TODAY, -20), due: addDays(TODAY, -6), paid_on: addDays(TODAY, -7), method: 'bank', currency: 'CZK', lang: 'cs', vs: '376', lines: [{ id: 'l2', name: 'Web', qty: 1, unit: '', price: 5000, vat: 21 }], total: 5000, created_at: new Date(T0).toISOString(), updated_at: new Date(T0).toISOString(), deleted_at: null },
    { id: 'fk-gone', number: 'PM300', status: 'open', client: { name: 'Gone' }, supplier: { name: 'M' }, issued: '2025-01-01', due: '2025-01-15', method: 'bank', currency: 'CZK', lang: 'cs', lines: [], created_at: new Date(T0).toISOString(), updated_at: new Date(T0).toISOString(), deleted_at: new Date(T0).toISOString() },
  ],
}
const blob = fixture()
blob.invoices = [{ ...I.rowToInv(tables.mc_invoices[2]), status: 'open' }] // a stale device copy of a row deleted in the table
blob.invoiceClients = []; blob.invoiceProfile = []
const db = stateDb(clone(blob))
for (const [k, v] of Object.entries(tables)) db.tables[k] = clone(v)
const srv = fakeServer(K, M.tools_invoices.register, db)

/* ---- reads ---- */
const ov = await srv.call('invoice_overview')
assert.ok(!ov.isError, ov.text)
assert.equal(ov.json.overdue.count, 1, 'PM375 is overdue')
assert.equal(ov.json.unpaid.totals[0].total, 10000)
assert.equal(ov.json.paidLast12Months.count, 1)
assert.equal(ov.json.nextNumber, 'PM377')
const ls = await srv.call('list_invoices', { status: 'all' })
assert.deepEqual(ls.json.invoices.map((x) => x.number), ['PM376', 'PM375'], 'a deleted row never shows, even when a device copy still has it')
assert.equal(ls.json.invoices[1].daysLate, 10)
assert.equal((await srv.call('get_invoice', { invoice: 'PM375' })).json.lines[0].sum, 10000)
assert.ok((await srv.call('get_invoice', { invoice: 'PM999' })).isError)

/* ---- create ---- */
const c1 = await srv.call('create_invoice', { contact: 'RVLT', lines: [{ name: 'Automatizace', qty: 12, unit: 'h', price: 1100 }, { name: 'Setup', price: 2500 }] })
assert.ok(!c1.isError, c1.text)
const made = db.tables.mc_invoices.find((x) => x.number === 'PM377')
assert.ok(made, 'written to the invoice table')
assert.equal(made.total, 15700); assert.equal(made.vs, '377'); assert.equal(made.status, 'open')
assert.equal(made.client_id, 'ivc-rvlt'); assert.equal(made.client.name, 'RVLT Digital s.r.o.')
assert.equal(made.due, addDays(TODAY, 30), "the contact's own due days")
assert.equal(made.account_id, 'acc-fio'); assert.equal(made.supplier.iban, I.czIban('2000145399/2010'), 'supplier carries the account and its IBAN')
assert.equal(made.issued, TODAY); assert.equal(made.deleted_at, null)
// the app's own pull takes it
const pushed = new Map()
const appSide = M.appMergeRows([], db.tables.mc_invoices, (r) => I.rowToInv(r), () => false, pushed)
const appMade = appSide.find((x) => x.number === 'PM377')
assert.ok(appMade && appMade.lines.length === 2 && appMade.status === 'open', 'the app pull reads it as an open invoice')
assert.equal(M.appInvTotal(appMade), 15700, 'the app computes the same total')
assert.ok(!appSide.some((x) => x.id === 'fk-gone'), 'and drops the deleted row')
// refusals
assert.match((await srv.call('create_invoice', { lines: [{ name: 'x', price: 1 }] })).text, /Who is the invoice for/)
assert.match((await srv.call('create_invoice', { contact: 'RVLT', lines: [{ name: 'x', price: 1 }], number: 'PM375' })).text, /already used/)
assert.match((await srv.call('create_invoice', { contact: 'RVLT', lines: [{ name: 'x', price: 1 }], issued: TODAY, due: addDays(TODAY, -1) })).text, /before the issue date/)
assert.match((await srv.call('create_invoice', { contact: 'Nobody', lines: [{ name: 'x', price: 1 }] })).text, /No invoice contact/)
const oneOff = await srv.call('create_invoice', { client: { name: 'Jana Nová', city: 'Brno' }, lines: [{ name: 'Lekce', price: 800, qty: 2 }], due_days: 7, lang: 'en' })
assert.ok(!oneOff.isError, oneOff.text)
const one = db.tables.mc_invoices.find((x) => x.number === 'PM378')
assert.deepEqual([one.total, one.due, one.lang, one.client_id], [1600, addDays(TODAY, 7), 'en', null])

/* ---- edit ---- */
const e1 = await srv.call('update_invoice', { invoice: 'PM378', lines: [{ name: 'Lekce', price: 900, qty: 2 }], note_after: 'Děkuji' })
assert.ok(!e1.isError, e1.text)
const one2 = db.tables.mc_invoices.find((x) => x.number === 'PM378')
assert.equal(one2.total, 1800); assert.equal(one2.note_after, 'Děkuji')
assert.ok(Date.parse(one2.updated_at) > Date.parse(one.updated_at), 'updatedAt moves forward, so the app takes the edit')
const sentSupplier = clone(db.tables.mc_invoices.find((x) => x.id === 'fk-1').supplier)
await srv.call('update_invoice', { invoice: 'PM375', note_before: 'x' })
assert.deepEqual(db.tables.mc_invoices.find((x) => x.id === 'fk-1').supplier, sentSupplier, 'a sent invoice keeps the supplier copy the client received')

/* ---- status ---- */
assert.match((await srv.call('set_invoice_status', { invoice: 'PM377', action: 'sent' })).text, /marked as sent/)
assert.equal(db.tables.mc_invoices.find((x) => x.number === 'PM377').sent_on, TODAY)
assert.ok((await srv.call('set_invoice_status', { invoice: 'PM377', action: 'sent' })).isError, 'cannot send twice')
assert.match((await srv.call('set_invoice_status', { invoice: 'PM375', action: 'paid', date: addDays(TODAY, -2) })).text, /Payment recorded/)
const paid = db.tables.mc_invoices.find((x) => x.id === 'fk-1')
assert.deepEqual([paid.status, paid.paid_on], ['paid', addDays(TODAY, -2)])
assert.ok((await srv.call('set_invoice_status', { invoice: 'PM375', action: 'paid', date: addDays(TODAY, 2) })).isError, 'no future payments')
await srv.call('set_invoice_status', { invoice: 'PM375', action: 'unpaid' })
assert.deepEqual([db.tables.mc_invoices.find((x) => x.id === 'fk-1').status, db.tables.mc_invoices.find((x) => x.id === 'fk-1').paid_on], ['sent', null])
await srv.call('set_invoice_status', { invoice: 'PM378', action: 'cancel' })
assert.equal(db.tables.mc_invoices.find((x) => x.number === 'PM378').status, 'cancelled')
await srv.call('set_invoice_status', { invoice: 'PM378', action: 'restore' })
assert.equal(db.tables.mc_invoices.find((x) => x.number === 'PM378').status, 'open')

/* ---- delete ---- */
const before = clone(db.tables.mc_state[0].data)
before.invoices = [...before.invoices, I.rowToInv(db.tables.mc_invoices.find((x) => x.number === 'PM378'))] // the app's copy has it
db.tables.mc_state[0].data = clone(before)
const d1 = await srv.call('delete_invoice', { invoice: 'PM378' })
assert.ok(!d1.isError, d1.text)
const delRow = db.tables.mc_invoices.find((x) => x.number === 'PM378')
assert.ok(delRow.deleted_at, 'table row stamped deleted')
const after = db.tables.mc_state[0].data
assert.ok(!after.invoices.some((x) => x.number === 'PM378'), 'gone from the app copy')
assert.ok(after.graveyard.some((g) => g.k === M.appRowKey('invoices', { id: delRow.id })), 'buried with the app key')
const merged = JSON.parse(M.mergeStates(JSON.stringify(before), JSON.stringify(after)))
assert.ok(!merged.invoices.some((x) => x.number === 'PM378'), 'a stale app copy cannot bring it back')
assert.ok(!(await srv.call('list_invoices', {})).json.invoices.some((x) => x.number === 'PM378'))
assert.equal(srv.tools.delete_invoice.cfg.annotations.destructiveHint, true)

/* ---- contacts ---- */
const lc = await srv.call('list_invoice_contacts', {})
assert.equal(lc.json.contacts[0].name, 'RVLT Digital s.r.o.'); assert.equal(lc.json.contacts[0].unpaid, 2)
assert.equal(lc.json.accounts[0].label, 'Fio VF'); assert.equal(lc.json.settings.numberFormat, 'PMNNN')
assert.match((await srv.call('save_invoice_contact', { name: 'Acme a.s.', ico: '11223344', due_days: 10 })).text, /Added/)
assert.ok(db.tables.mc_invoice_contacts.some((x) => x.name === 'Acme a.s.' && x.due_days === 10 && x.ico === '11223344'))
assert.ok((await srv.call('save_invoice_contact', { name: 'acme a.s.' })).isError, 'no duplicate names')
await srv.call('save_invoice_contact', { id: 'ivc-rvlt', email: 'fakturace@example.com', due_days: null })
const rv = db.tables.mc_invoice_contacts.find((x) => x.id === 'ivc-rvlt')
assert.deepEqual([rv.email, rv.due_days, rv.ico], ['fakturace@example.com', null, '87654321'])

/* ---- no supplier = refusal ---- */
const bare = stateDb(fixture()); bare.tables.mc_invoices = []; bare.tables.mc_invoice_contacts = []; bare.tables.mc_invoice_accounts = []; bare.tables.mc_invoice_settings = []
assert.match((await fakeServer(K, M.tools_invoices.register, bare).call('create_invoice', { client: { name: 'X' }, lines: [{ name: 'a', price: 1 }] })).text, /supplier details are not set up/)
assert.deepEqual(srv.names().sort(), ['create_invoice', 'delete_invoice', 'get_invoice', 'invoice_overview', 'list_invoice_contacts', 'list_invoices', 'save_invoice_contact', 'set_invoice_status', 'update_invoice'])
console.log(`mcp-invoices-test: all passed (${K.zodReal ? 'schemas validated' : 'schemas NOT validated'})`)
