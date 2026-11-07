/* People + prospects for the Claude connector: ops-people.ts and tools-people.ts, through the real
   registration path, real zod, the real commit(), and the app's REAL merge (src/sync-merge.ts).
   `ZOD_PATH=... node tools/mcp-people-test.mjs` */
import assert from 'assert/strict'
import { loadKit, fixture, clone, TODAY } from './mcp-test-kit.mjs'

const K = await loadKit({
  modules: ['ops-people.ts', 'tools-people.ts'],
  extra: ["export * as app_calc from './src/prospectcalc.ts'", "export * as app_layout from './src/peoplelayout.ts'"],
})
const { M, stateDb, fakeServer, refuses } = K
const O = M.ops_people
const A = M.app_calc, L = M.app_layout
const merge = (a, b) => JSON.parse(M.mergeStates(JSON.stringify(a), JSON.stringify(b)))
const DAYMS = 86_400_000
const dayAgo = (n) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date(Date.now() - n * DAYMS))

const person = (id, name, o = {}) => ({ id, name, rel: '', tier: 'friends', cadenceDays: 30, x: 0, y: -355, createdAt: 1000, updatedAt: 1000, ...o })
const prospect = (id, name, o = {}) => ({ id, name, source: 'found', stage: 'Ready to contact', people: [], touches: [], createdAt: 1000, updatedAt: 1000, ...o })
function world() {
  const b = fixture()
  b.people = [
    person('person-milan', 'Milan Šádek', { rel: 'accountant', tier: 'business', cadenceDays: 30, x: 450, y: 0, birthday: '03-27' }),
    person('person-ada', 'Ada Nováková', { rel: 'sister', tier: 'core', cadenceDays: 7, x: 0, y: -150 }),
    person('person-adam', 'Adam Novák', { tier: 'close', cadenceDays: 14, x: 255, y: 0 }),
    person('person-off', 'Quiet Quinn', { remindersOff: true }),
  ]
  b.personBonds = [{ id: 'bond-1', a: 'person-ada', b: 'person-adam', aToB: 'sister', bToA: 'brother', createdAt: 1000, updatedAt: 1000 }]
  b.personContacts = [{ id: 'contact-1', personId: 'person-ada', day: dayAgo(3), channel: 'call', createdAt: 1000 }]
  b.prospects = [
    prospect('prospect-1', 'Pekárna Svoboda', { domain: 'pekarna.cz', why: 'old site', people: [{ id: 'pp-1', name: 'Jan Svoboda', decides: true, email: 'jan@pekarna.cz' }] }),
    prospect('prospect-2', 'Kavárna Kočičí', { domain: 'kavarnakocici.cz', stage: 'Contacted', touches: [{ id: 'touch-a', step: 'work', day: dayAgo(5), subject: 'Hello' }] }),
    prospect('prospect-3', 'Old Lane Co', { stage: 'contacted' }),
    prospect('prospect-4', 'Closed Deal', { stage: 'Acquired' }),
  ]
  return b
}
const keys = (b) => (b.graveyard ?? []).map((g) => g.k)

/* ---------------- parity with the app's own tables and calculators ---------------- */
assert.deepEqual([...O.SHEET_STATUSES], [...A.SHEET_STATUSES])
assert.deepEqual(O.TIER_RADIUS, L.TIER_RADIUS); assert.deepEqual(O.TIER_CADENCE, L.TIER_CADENCE); assert.deepEqual(O.TIER_LABEL, L.TIER_LABEL)
assert.deepEqual([...O.SOURCES], A.SOURCES.map((s) => s.id)); assert.deepEqual([...O.STEPS], A.STEPS.map((s) => s.id))
for (const s of [...A.SHEET_STATUSES, 'Something New', 'reach', 'talking', '']) assert.equal(O.stageRank(s), A.stageRank(s), `stageRank ${s}`)
for (const s of ['reach', 'contacted', 'won', 'In conversation', 'Build: building', 'Prospect', '  Lost ', '', null, 42]) assert.equal(O.normStage(s), A.normStage(s), `normStage ${s}`)
for (const d of ['https://www.Pekarna.cz/kontakt', 'WWW.x.cz', 'a.cz?x=1', ' http://b.cz#f ']) assert.equal(O.cleanDomain(d), A.cleanDomain(d))
for (const ring of [[], [[0, -150]], [[0, -150], [150, 0]], [[0, -150], [150, 0], [0, 150]], [[10, 10], [-20, 5]]]) {
  const ps = ring.map(([x, y]) => ({ tier: 'core', x, y }))
  for (const t of Object.keys(L.TIER_RADIUS)) assert.deepEqual(O.nextPersonSlot(ps, t), L.nextPersonSlot(ps, t), `slot ${t} ${ring.length}`)
}
for (const st of ['Prospect', 'Ready to contact', 'Contacted', 'Responded waiting', 'Acquired', 'Call / visit']) {
  for (const touches of [[], [{ step: 'work', day: dayAgo(1) }], [{ step: 'work', day: dayAgo(4) }], [{ step: 'work', day: dayAgo(4) }, { step: 'reminder', day: dayAgo(3) }, { step: 'personal', day: dayAgo(3) }], [{ step: 'work', day: '2026-01-01' }, { step: 'call', day: '2026-01-02' }, { step: 'reminder', day: '2026-01-01' }, { step: 'personal', day: '2026-01-01' }]]) {
    const p = { stage: st, touches, createdAt: Date.now() - 9 * DAYMS }
    assert.equal(O.nextStep(p), A.nextStep(p), `nextStep ${st}`)
    assert.equal(O.isReady(p, TODAY), A.isReady(p, TODAY), `isReady ${st}`)
    assert.equal(O.age(p, TODAY).days, A.age(p, TODAY).days, `age ${st}`)
    assert.equal(O.age(p, TODAY).since, A.age(p, TODAY).since)
  }
}

/* ---------------- add_person ---------------- */
{
  const b = world(); const before = b.people.length
  const r = O.addPerson(b, { name: '  Eva Dvořáková ', tier: 'close', rel: ' friend ', job: 'doctor', birthday: '11-02', birthYear: 1990 })
  const row = b.people.at(-1)
  assert.equal(b.people.length, before + 1)
  const slot = L.nextPersonSlot(world().people, 'close')
  assert.deepEqual(row, { id: row.id, name: 'Eva Dvořáková', rel: 'friend', tier: 'close', cadenceDays: L.TIER_CADENCE.close, x: Math.round(slot.x), y: Math.round(slot.y), createdAt: row.createdAt, updatedAt: row.createdAt, job: 'doctor', birthday: '11-02', birthYear: 1990 })
  assert.match(row.id, /^person-[0-9a-z]+$/); assert.equal(r.id, row.id); assert.match(r.text, /Added to close: Eva Dvořáková/)
  refuses(() => O.addPerson(b, { name: 'eva dvorakova', tier: 'close' }), /already a person/)
  assert.doesNotThrow(() => O.addPerson(b, { name: 'eva dvorakova', tier: 'close', allowDuplicate: true }))
  refuses(() => O.addPerson(b, { name: '  ', tier: 'close' }), /cannot be empty/)
  refuses(() => O.addPerson(b, { name: 'X', tier: 'bestie' }), /tier must be one of/)
  refuses(() => O.addPerson(b, { name: 'Y', tier: 'core', birthday: '13-40' }), /MM-DD/)
  refuses(() => O.addPerson(b, { name: 'Z', tier: 'core', birthYear: 1800 }), /birthYear/)
  const empty = { schema: 'v1' }; O.addPerson(empty, { name: 'First', tier: 'core' }); assert.equal(empty.people.length, 1)
}

/* ---------------- edit_person: the case that failed in real use ---------------- */
{
  const b = world(); b.people.find((p) => p.id === 'person-milan').name = 'Milan Shadek' // as typed wrong in the app
  const r = O.editPerson(b, { title: 'Milan Shadek' }, { name: 'Milan Šádek' })
  const row = b.people.find((p) => p.id === 'person-milan')
  assert.equal(row.name, 'Milan Šádek'); assert.ok(row.updatedAt > 1000); assert.equal(row.tier, 'business'); assert.match(r.text, /Updated Milan Shadek \(now Milan Šádek\)/)
  // accents and word order do not matter, and typing the stored name with the accent finds a row typed without
  const c = world()
  O.editPerson(c, { title: 'shadek milan' }, { rel: 'tax accountant' })
  assert.equal(c.people.find((p) => p.id === 'person-milan').rel, 'tax accountant')
  // the stored name is "Milan Šádek": "Shadek" (sh for š) and a one-letter typo both find him, never someone else
  O.editPerson(c, { title: 'Milan Shadek' }, { rel: 'by transliteration' }); assert.equal(c.people.find((p) => p.id === 'person-milan').rel, 'by transliteration')
  O.editPerson(c, { title: 'Milan Sadec' }, { rel: 'by typo' }); assert.equal(c.people.find((p) => p.id === 'person-milan').rel, 'by typo')
  refuses(() => O.editPerson(c, { title: 'Milan Sadecek' }, { rel: 'x' }), /No person matches/) // two letters off is not a guess we make
  O.editPerson(c, { title: 'Šádek' }, { job: 'ARSTAS' }); assert.equal(c.people.find((p) => p.id === 'person-milan').job, 'ARSTAS')
  // ambiguity names candidates, no match suggests close ones, and nothing changed
  const snap = JSON.stringify(c)
  refuses(() => O.editPerson(c, { title: 'Nov' }, { rel: 'x' }), /matches 2 persons.*person-ada.*person-adam/)
  refuses(() => O.editPerson(c, { title: 'Milan Novotny' }, { rel: 'x' }), /No person matches "Milan Novotny".*Similar: person-milan/)
  refuses(() => O.editPerson(c, { id: 'person-nope' }, { rel: 'x' }), /No person has the id/)
  refuses(() => O.editPerson(c, { title: 'Ada N' }, {}), /Nothing to change/)
  refuses(() => O.editPerson(c, { title: 'Ada N' }, { birthday: '02-99' }), /MM-DD/)
  refuses(() => O.editPerson(c, { title: 'Ada N' }, { cadenceDays: 0 }), /cadenceDays/)
  assert.equal(JSON.stringify(c), snap, 'refusals change nothing')
  // exact full name beats the contains-match ("Ada Nováková" is not blocked by a longer name)
  assert.doesNotThrow(() => O.editPerson(c, { title: 'adam novak' }, { rel: 'cousin' }))
  // clearing, and the explicit fields
  O.editPerson(c, { id: 'person-milan' }, { job: null, birthday: null, cadenceDays: 45, remindersOff: true, nameDayAs: 'Miloslav' })
  const m = c.people.find((p) => p.id === 'person-milan')
  assert.ok(!('job' in m) && !('birthday' in m)); assert.equal(m.cadenceDays, 45); assert.equal(m.remindersOff, true); assert.equal(m.nameDayAs, 'Miloslav')
  // a circle change moves the dot to the new ring and leaves the cadence (people.tsx onTier)
  const d = world(); O.editPerson(d, { id: 'person-milan' }, { tier: 'core' })
  const mm = d.people.find((p) => p.id === 'person-milan')
  assert.equal(mm.tier, 'core'); assert.equal(mm.cadenceDays, 30)
  const dist = Math.hypot(mm.x, mm.y); assert.ok(dist >= 82 && dist <= 202, `core band, got ${dist}`)
  assert.equal(Math.atan2(mm.y, mm.x).toFixed(3), '0.000')
  O.editPerson(d, { id: 'person-milan' }, { tier: 'core', rel: 'same circle' }) // same tier: position untouched
  assert.deepEqual([d.people.find((p) => p.id === 'person-milan').x, d.people.find((p) => p.id === 'person-milan').y], [mm.x, mm.y])
}

/* ---------------- log_contact / remove_contact ---------------- */
{
  const b = world()
  const r = O.logContact(b, { title: 'Milan' }, {})
  const row = b.personContacts.at(-1)
  assert.deepEqual(row, { id: row.id, personId: 'person-milan', day: TODAY, channel: 'inperson', createdAt: row.createdAt }); assert.match(row.id, /^contact-/); assert.equal(r.id, row.id)
  O.logContact(b, { title: 'Milan' }, { channel: 'email', date: dayAgo(2) })
  assert.equal(b.personContacts.length, 3)
  refuses(() => O.logContact(b, { title: 'Milan' }, {}), /already logged/)
  refuses(() => O.logContact(b, { title: 'Milan' }, { date: '2999-01-01' }), /not happened yet/)
  refuses(() => O.logContact(b, { title: 'Milan' }, { date: '2026-13-45', channel: 'call' }), /YYYY-MM-DD/)
  refuses(() => O.logContact(b, { title: 'Milan' }, { channel: 'pigeon' }), /channel must be one of/)
  refuses(() => O.logContact(b, { title: 'nobody' }, {}), /No person matches/)
  // remove: buried with the app's own key
  const n = b.personContacts.length
  const rm = O.removeContact(b, { person: { title: 'Milan' }, date: dayAgo(2) })
  assert.equal(b.personContacts.length, n - 1); assert.ok(keys(b).includes(M.appRowKey('personContacts', { id: rm.id }))); assert.match(rm.text, /Removed the .* contact with Milan/)
  refuses(() => O.removeContact(b, { person: { title: 'Milan' }, date: dayAgo(40) }), /No contact with Milan Šádek is logged/)
  refuses(() => O.removeContact(b, { contactId: 'contact-zzz' }), /No logged contact/)
  refuses(() => O.removeContact(b, {}), /Pass contact_id/)
}

/* ---------------- delete_person ---------------- */
{
  const b = world()
  // Ada has 1 contact and 1 bond: the most the safety stop allows. Everything goes, everything is buried.
  const db = stateDb(b)
  const r = await M.commit(db, 'u1', (x) => O.deletePerson(x, { title: 'Ada Nováková' }))
  const out = db.tables.mc_state[0].data
  assert.ok(!out.people.some((p) => p.id === 'person-ada')); assert.equal(out.personBonds.length, 0); assert.equal(out.personContacts.length, 0)
  for (const k of ['people:person-ada', 'personBonds:bond-1', 'personContacts:contact-1']) assert.ok(keys(out).includes(k), k)
  assert.equal(M.appRowKey('people', { id: 'person-ada' }), 'people:person-ada')
  assert.match(r.text, /Removed Ada Nováková \(and 1 contact, 1 link\)/)
  // a stale app copy (still has Ada) merged with the result does not bring her back, in either direction
  for (const m of [merge(world(), out), merge(out, world())]) {
    assert.ok(!m.people.some((p) => p.id === 'person-ada')); assert.equal(m.personContacts.length, 0); assert.equal(m.personBonds.length, 0)
    assert.equal(m.people.length, 3)
  }
  // LIFTED in v3: a person with several contacts and links used to be refused; the cascade now declares its allowance
  // (the old assertion "/2 logged contacts.*in the app/" is deliberately replaced by the cascade checks in the v3 section below)
  // a person with nothing attached
  const e = world(); O.deletePerson(e, { title: 'Quiet' }); assert.deepEqual(keys(e), ['people:person-off'])
  refuses(() => O.deletePerson(world(), { title: 'Nov' }), /matches 2/)
}

/* ---------------- list_people ---------------- */
{
  const b = world()
  b.personContacts.push({ id: 'contact-2', personId: 'person-adam', day: dayAgo(30), channel: 'message', createdAt: 5 }) // 30 > 14
  b.personContacts.push({ id: 'contact-3', personId: 'person-milan', day: dayAgo(1), channel: 'call', createdAt: 5 })
  const l = O.listPeople(b, {})
  assert.equal(l.total, 4)
  assert.deepEqual(l.people.map((p) => p.id), ['person-adam', 'person-ada', 'person-milan', 'person-off'], 'overdue first, untracked last')
  const adam = l.people[0]; assert.equal(adam.overdue, true); assert.equal(adam.daysOverdue, 16); assert.deepEqual(adam.lastContact, { day: dayAgo(30), channel: 'message', daysAgo: 30 })
  const ada = l.people[1]; assert.equal(ada.overdue, false); assert.equal(ada.lastContact.daysAgo, 3)
  assert.deepEqual(ada.knows, [{ with: 'Adam Novák', withId: 'person-adam', isToThem: 'brother' }]); assert.deepEqual(adam.knows, [{ with: 'Ada Nováková', withId: 'person-ada', isToThem: 'sister' }]) // v3 added withId
  const off = l.people[3]; assert.equal(off.tracked, false); assert.equal(off.overdue, false)
  assert.equal(l.overdueNow, 1)
  assert.deepEqual(O.listPeople(b, { tier: 'core' }).people.map((p) => p.id), ['person-ada'])
  assert.deepEqual(O.listPeople(b, { overdueOnly: true }).people.map((p) => p.id), ['person-adam'])
  assert.deepEqual(O.listPeople(b, { query: 'ACCOUNTANT' }).people.map((p) => p.id), ['person-milan'])
  assert.equal(O.listPeople(b, { limit: 2 }).people.length, 2)
  const bd = O.listPeople(b, { birthdaysWithinDays: 366 }); assert.deepEqual(bd.people.map((p) => p.id), ['person-milan']); assert.ok(bd.people[0].birthdayInDays >= 0 && bd.people[0].birthdayInDays <= 366)
  const never = world(); assert.equal(O.listPeople(never, { tier: 'close' }).people[0].lastContact, null); assert.equal(O.listPeople(never, { tier: 'close' }).people[0].overdue, true)
}

/* ---------------- prospects ---------------- */
{
  const b = world(); const n = b.prospects.length
  const r = O.addProspect(b, { name: ' Zubař Novák ', source: 'friend', domain: 'https://www.Zubar.cz/kontakt', value: 70, why: 'no booking', contact: 'Dr. Novák', role: 'owner', email: 'd@zubar.cz', decides: true })
  const row = b.prospects.at(-1)
  assert.equal(b.prospects.length, n + 1)
  assert.deepEqual(row, { stage: 'Ready to contact', id: row.id, name: 'Zubař Novák', source: 'friend', touches: [], createdAt: row.createdAt, updatedAt: row.createdAt, domain: 'zubar.cz', value: 70, why: 'no booking', people: [{ id: row.people[0].id, name: 'Dr. Novák', role: 'owner', email: 'd@zubar.cz', decides: true }] })
  assert.match(row.id, /^prospect-/); assert.match(row.people[0].id, /^pp-/)
  refuses(() => O.addProspect(b, { name: 'zubar novak', source: 'found' }), /already a prospect/)
  refuses(() => O.addProspect(b, { name: 'Other', source: 'found', domain: 'zubar.cz' }), /already a prospect/)
  refuses(() => O.addProspect(b, { name: 'Pekarna Svoboda', source: 'found' }), /already a prospect/)
  refuses(() => O.addProspect(b, { name: 'Q', source: 'carrier pigeon' }), /source must be/)
  refuses(() => O.addProspect(b, { name: 'Q', source: 'found', value: 101 }), /value must be/)
  refuses(() => O.addProspect(b, { name: 'Q', source: 'found', email: 'a@b.cz' }), /pass contact/)
  refuses(() => O.addProspect(b, { name: 'Q', source: 'found', domain: ' / ' }), /not a usable domain/)
  assert.equal(r.id, row.id)

  // edit: found by domain too; stage normalised through the app's own table; contact updated by name, else added
  const e = world()
  O.editProspect(e, { title: 'pekarna.cz' }, { stage: 'contacted', value: 40, lostReason: 'x' })
  const p1 = e.prospects[0]; assert.equal(p1.stage, 'Contacted'); assert.equal(p1.value, 40); assert.ok(p1.updatedAt > 1000)
  O.editProspect(e, { id: 'prospect-1' }, { contact: 'jan svoboda', phone: '+420 1' })
  assert.deepEqual(e.prospects[0].people, [{ id: 'pp-1', name: 'jan svoboda', email: 'jan@pekarna.cz', decides: true, phone: '+420 1' }]) // app: fields spread over the match
  O.editProspect(e, { id: 'prospect-1' }, { contact: 'Eva K', decides: false })
  assert.equal(e.prospects[0].people.length, 2)
  O.editProspect(e, { title: 'Closed' }, { stage: 'lost' }); assert.equal(e.prospects[3].stage, 'Lost')
  assert.match(O.editProspect(e, { title: 'Closed' }, { stage: 'Rejected' }).text, /No lostReason is recorded yet/)
  refuses(() => O.editProspect(e, { title: 'Pekarna' }, { stage: 'Won big' }), /is not a stage/)
  refuses(() => O.editProspect(e, { title: 'Pekarna' }, {}), /Nothing to change/)
  refuses(() => O.editProspect(e, { title: 'nobody here' }, { value: 1 }), /No prospect matches/)
  refuses(() => O.editProspect(e, { title: 'a' }, { value: 1 }), /matches \d+ prospects/)

  // touch: first touch moves the stage, picks the decider, appends, and a repeat is refused
  const t = world()
  const tr = O.logTouch(t, { title: 'Pekarna' }, { step: 'work', subject: 'Hi', body: 'Dear Jan,\nword for word' })
  const p = t.prospects[0]
  assert.equal(p.stage, 'Contacted'); assert.equal(p.touches.length, 1); assert.ok(p.updatedAt > 1000)
  assert.deepEqual(p.touches[0], { step: 'work', day: TODAY, to: 'pp-1', subject: 'Hi', body: 'Dear Jan,\nword for word', id: p.touches[0].id }); assert.match(p.touches[0].id, /^touch-/); assert.equal(tr.id, p.touches[0].id)
  assert.match(tr.text, /Logged work email for Pekárna Svoboda.*Contacted/)
  refuses(() => O.logTouch(t, { title: 'Pekarna' }, { step: 'work', subject: 'Hi' }), /already logged/)
  O.logTouch(t, { title: 'Pekarna' }, { step: 'reminder', to: 'svoboda', date: dayAgo(1) }); assert.equal(t.prospects[0].touches[1].day, dayAgo(1))
  refuses(() => O.logTouch(t, { title: 'Pekarna' }, { step: 'call', to: 'Nobody' }), /no contact matching "Nobody"/)
  refuses(() => O.logTouch(t, { title: 'Pekarna' }, { step: 'fax' }), /step must be/)
  refuses(() => O.logTouch(t, { title: 'Pekarna' }, { step: 'call', date: '2999-01-01' }), /not happened yet/)
  // a later stage is kept, an earlier one moves; Acquired stays
  O.logTouch(t, { title: 'Closed' }, { step: 'call' }); assert.equal(t.prospects[3].stage, 'Acquired')
  const earlier = world(); earlier.prospects[0].stage = 'Audited'; O.logTouch(earlier, { id: 'prospect-1' }, { step: 'personal' }); assert.equal(earlier.prospects[0].stage, 'Contacted')

  // lists: byStage counts everything (legacy lane name normalised), filters, cap
  const l = O.listProspects(world(), {})
  assert.equal(l.total, 4); assert.deepEqual(l.byStage, { 'Ready to contact': 1, Contacted: 2, Acquired: 1 })
  assert.deepEqual(O.listProspects(world(), { stage: 'contacted' }).prospects.map((x) => x.id).sort(), ['prospect-2', 'prospect-3'])
  assert.deepEqual(O.listProspects(world(), { openOnly: true }).prospects.map((x) => x.id).sort(), ['prospect-1', 'prospect-2', 'prospect-3'])
  assert.deepEqual(O.listProspects(world(), { needsFollowUp: true }).prospects.map((x) => x.id), ['prospect-2'])
  const k2 = O.listProspects(world(), { query: 'kočičí' }).prospects[0]
  assert.equal(k2.nextStep, 'reminder'); assert.equal(k2.daysSince, 5); assert.equal(k2.daysSinceIs, 'touch'); assert.equal(k2.followUpDue, true); assert.equal(k2.touches, 1)
  assert.deepEqual(O.listProspects(world(), { query: 'jan svoboda' }).prospects.map((x) => x.id), ['prospect-1'])
  assert.equal(O.listProspects(world(), { source: 'found', limit: 2 }).prospects.length, 2)
  refuses(() => O.listProspects(world(), { stage: 'nope' }), /is not a stage/)
  const big = world(); for (let i = 0; i < 300; i++) big.prospects.push(prospect(`prospect-x${i}`, `Biz ${i}`, { why: 'w'.repeat(900) }))
  const bl = O.listProspects(big, {}); assert.equal(bl.shown, 30); assert.equal(bl.total, 304); assert.ok(JSON.stringify(bl).length < 30_000, 'a read stays small')
  assert.equal(O.listProspects(big, { limit: 100 }).shown, 100)
  // get_prospect
  const g = O.getProspect(t, { title: 'Pekarna' }); assert.equal(g.touches.length, 2); assert.equal(g.touches[0].to, 'Jan Svoboda'); assert.equal(g.people[0].email, 'jan@pekarna.cz')
  const long = world(); O.logTouch(long, { id: 'prospect-1' }, { step: 'work', body: 'x'.repeat(2000) })
  assert.ok(O.getProspect(long, { id: 'prospect-1' }).touches[0].body.length < 400); assert.equal(O.getProspect(long, { id: 'prospect-1' }, true).touches[0].body.length, 2000)
}

/* ---------------- through the real registration path ---------------- */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_people.register, db)
  const names = srv.names()
  assert.deepEqual(names.sort(), ['add_person', 'add_prospect', 'delete_person', 'delete_prospect', 'edit_contact', 'edit_link', 'edit_person', 'edit_prospect', 'edit_prospect_contact', 'get_prospect', 'link_people', 'list_people', 'list_prospects', 'log_contact', 'log_touch', 'mark_meeting_prep_ready', 'remove_contact', 'remove_prospect_contact', 'remove_touch', 'resolve_prospect_reply', 'unlink_people'])
  for (const n of names) { const c = srv.tools[n].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, n); assert.match(n, /^[a-z]+(_[a-z]+)+$/) }
  assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.readOnlyHint).sort(), ['get_prospect', 'list_people', 'list_prospects'])
  assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.destructiveHint).sort(), ['delete_person', 'delete_prospect', 'edit_contact', 'remove_contact', 'remove_prospect_contact', 'remove_touch', 'unlink_people'])
  const data = () => db.tables.mc_state[0].data

  // the example that failed in real use
  data().people.find((p) => p.id === 'person-milan').name = 'Milan Shadek'
  const fix = await srv.call('edit_person', { person: 'Milan Shadek', new_name: 'Milan Šádek' })
  assert.equal(fix.isError, false, fix.text); assert.equal(data().people.find((p) => p.id === 'person-milan').name, 'Milan Šádek'); assert.equal(data().lastWrite.name, 'Claude')

  const added = await srv.call('add_person', { name: 'Tom', tier: 'wider', rel: 'neighbour', birthday: '05-05' })
  assert.equal(added.isError, false); assert.equal(data().people.at(-1).name, 'Tom')
  assert.equal((await srv.call('add_person', { name: 'Tom', tier: 'wider' })).isError, true)
  assert.equal((await srv.call('log_contact', { person: 'Tom', channel: 'call' })).isError, false)
  assert.equal(data().personContacts.at(-1).channel, 'call')
  const lp = await srv.call('list_people', { query: 'tom' }); assert.equal(lp.json.people[0].lastContact.daysAgo, 0)
  const lpr = await srv.call('list_prospects', {}); assert.equal(lpr.json.total, 4)
  assert.equal((await srv.call('add_prospect', { name: 'New Biz', source: 'met', contact: 'Boss', decides: true })).isError, false)
  assert.equal((await srv.call('log_touch', { prospect: 'New Biz', step: 'call' })).isError, false)
  assert.equal(data().prospects.at(-1).stage, 'Contacted')
  assert.equal((await srv.call('edit_prospect', { prospect: 'New Biz', stage: 'Meeting planned' })).isError, false)
  assert.equal((await srv.call('get_prospect', { prospect: 'New Biz' })).json.stage, 'Meeting planned')
  assert.equal((await srv.call('remove_contact', { person: 'Tom', date: TODAY })).isError, false)
  // the safety stop in delete is explained, nothing written
  const snap = JSON.stringify(data())
  data().personContacts.push({ id: 'contact-9', personId: 'person-ada', day: dayAgo(9), channel: 'call', createdAt: 1 })
  const snap2 = JSON.stringify(data())
  const del = await srv.call('delete_person', { person: 'Ada Nováková' }); assert.equal(del.isError, false, del.text) // v3: cascades through the safety stop
  assert.ok(!data().personContacts.some((c) => c.personId === 'person-ada')); assert.ok(keys(data()).includes('personContacts:contact-9'))
  assert.equal((await srv.call('delete_person', { person: 'Quiet' })).isError, false); assert.ok(keys(data()).includes('people:person-off'))

  // bad input is refused by the real schema before any handler runs
  if (K.zodReal) {
    await assert.rejects(() => srv.call('add_person', { name: 'X' }), /tier|Invalid|required/i)
    await assert.rejects(() => srv.call('add_person', { name: 'X', tier: 'friends', birthday: '2020-01-01' }), /Invalid|regex|string/i)
    await assert.rejects(() => srv.call('log_contact', { person: 'a', channel: 'pigeon' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('edit_prospect', { prospect: 'a', value: 500 }), /too_big|<=100|Too big/i)
    await assert.rejects(() => srv.call('list_prospects', { limit: 5000 }), /too_big|Too big/i)
    await assert.rejects(() => srv.call('add_prospect', { name: 'X', source: 'pigeon' }), /Invalid|enum/i)
  }
}

/* ---------------- the app's REAL merge keeps what the connector did ---------------- */
{
  const app = world() // a stale phone: has not heard of any of it
  app.savedAt = 500
  const db = stateDb(clone(app))
  await M.commit(db, 'u1', (b) => {
    O.editPerson(b, { title: 'Milan' }, { name: 'Milan Šádek ml.', rel: 'new rel' })
    O.logContact(b, { title: 'Ada N' }, { channel: 'video', date: dayAgo(1) })
    O.addPerson(b, { name: 'Fresh Face', tier: 'friends' })
    O.editProspect(b, { title: 'Pekarna' }, { stage: 'Meeting planned', value: 55 })
    O.logTouch(b, { title: 'Kavárna' }, { step: 'reminder' })
    O.addProspect(b, { name: 'Brand New Biz', source: 'inbound' })
    return { text: 'ok' }
  })
  const mine = db.tables.mc_state[0].data
  for (const m of [merge(app, mine), merge(mine, app)]) {
    const milan = m.people.find((p) => p.id === 'person-milan'); assert.equal(milan.name, 'Milan Šádek ml.'); assert.equal(milan.rel, 'new rel')
    assert.ok(m.people.some((p) => p.name === 'Fresh Face')); assert.ok(m.personContacts.some((c) => c.channel === 'video'))
    assert.equal(m.prospects.find((p) => p.id === 'prospect-1').stage, 'Meeting planned')
    assert.equal(m.prospects.find((p) => p.id === 'prospect-2').touches.length, 2)
    assert.ok(m.prospects.some((p) => p.name === 'Brand New Biz'))
  }
  // a delete then a stale copy that still edits that person (newer updatedAt than ours would be only if later; here older): stays deleted
  const db2 = stateDb(clone(app))
  await M.commit(db2, 'u1', (b) => O.deletePerson(b, { title: 'Quiet' }))
  const gone = db2.tables.mc_state[0].data
  const staleEdit = world(); staleEdit.savedAt = 9e15; staleEdit.people.find((p) => p.id === 'person-off').updatedAt = Date.now() + 1000 // even a "newer" stale row is buried
  for (const m of [merge(staleEdit, gone), merge(gone, staleEdit)]) assert.ok(!m.people.some((p) => p.id === 'person-off'), 'a buried person stays buried')
}

/* =====================================================================================
   v3: everything the People page, the Business pipeline and the Business room can do
   ===================================================================================== */
const regAll = () => { const db = stateDb(world()); const srv = fakeServer(K, M.tools_people.register, db); return { db, srv, data: () => db.tables.mc_state[0].data } }

/* ---- delete_person: a person with MANY contacts and links (was refused), cascade declared exactly ---- */
{
  const w = world()
  w.people.push(person('person-eve', 'Eva Dvořáková', { x: 355, y: 0 }))
  w.personBonds.push({ id: 'bond-2', a: 'person-eve', b: 'person-ada', aToB: 'friend', createdAt: 1, updatedAt: 1 }, { id: 'bond-3', a: 'person-milan', b: 'person-eve', bToA: 'client', createdAt: 1, updatedAt: 1 })
  for (let n = 0; n < 4; n++) w.personContacts.push({ id: `contact-e${n}`, personId: 'person-eve', day: dayAgo(n + 1), channel: 'call', createdAt: n })
  const stale = clone(w)
  const db = stateDb(w)
  const r = await M.commit(db, 'u1', (b) => O.deletePerson(b, { title: 'Eva Dvorakova' })) // forgiving name
  const out = db.tables.mc_state[0].data
  assert.match(r.text, /Removed Eva Dvořáková \(and 4 contacts, 2 links\)/)
  assert.ok(!out.people.some((p) => p.id === 'person-eve'))
  assert.deepEqual(out.personBonds.map((x) => x.id), ['bond-1']) // Ada/Adam's untouched
  assert.deepEqual(out.personContacts.map((c) => c.id), ['contact-1'])
  const want = ['people:person-eve', 'personBonds:bond-2', 'personBonds:bond-3', 'personContacts:contact-e0', 'personContacts:contact-e1', 'personContacts:contact-e2', 'personContacts:contact-e3']
  for (const k of want) assert.ok(keys(out).includes(k), k)
  assert.equal(keys(out).length, want.length) // nothing else buried
  for (const m of [merge(stale, out), merge(out, stale)]) {
    assert.ok(!m.people.some((p) => p.id === 'person-eve')); assert.equal(m.personContacts.length, 1); assert.deepEqual(m.personBonds.map((x) => x.id), ['bond-1'])
  }
  // the allowance never reaches the saved row
  assert.ok(!JSON.stringify(out).includes('allowShrink'))
  // a BUG that removes one more contact than the cascade declared is still stopped
  await assert.rejects(() => M.commit(stateDb(clone(stale)), 'u1', (b) => { O.deletePerson(b, { id: 'person-eve' }); b.personContacts = b.personContacts.filter((c) => c.id !== 'contact-1'); return { text: 'x' } }), /Safety stop: "personContacts"/)
  // and a different person's rows are not collateral: removing two people at once is stopped by the people collection
  await assert.rejects(() => M.commit(stateDb(clone(stale)), 'u1', (b) => { O.deletePerson(b, { id: 'person-eve' }); O.deletePerson(b, { id: 'person-milan' }); return { text: 'x' } }), /Safety stop: "people"/)
}

/* ---- MUTATION CHECK on the riskiest rule (the declared cascade): drop the declaration, the real writer must stop it ---- */
{
  const fs = await import('fs'); const path = await import('path')
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'functions', 'mc-mcp')
  const src = fs.readFileSync(path.join(dir, 'ops-people.ts'), 'utf8')
  const mutated = src.replace("allowShrink(b, 'personContacts', contacts.length - 1)", '/* mutation: declaration removed */')
  assert.notEqual(mutated, src, 'the mutation must actually change the source')
  const tmp = path.join(dir, 'ops-people-mut.ts')
  fs.writeFileSync(tmp, mutated)
  try {
    const K2 = await loadKit({ modules: ['ops-people-mut.ts'] })
    const w = world(); for (let n = 0; n < 3; n++) w.personContacts.push({ id: `contact-m${n}`, personId: 'person-ada', day: dayAgo(n + 5), channel: 'call', createdAt: n })
    await assert.rejects(() => K2.M.commit(K2.stateDb(w), 'u1', (b) => K2.M.ops_people_mut.deletePerson(b, { title: 'Ada N' })), /Safety stop: "personContacts"/, 'without the allowance the cascade must be stopped')
    // and the real module passes the very same scenario
    const db = stateDb(w); await M.commit(db, 'u1', (b) => O.deletePerson(b, { title: 'Ada N' }))
    assert.equal(db.tables.mc_state[0].data.personContacts.length, 0)
  } finally { fs.unlinkSync(tmp) }
}

/* ---- links between people (people.ts addPersonBond / setBondLabel / removePersonBond) ---- */
{
  const { db, srv, data } = regAll()
  // new link, one direction: bond.a = person, bToA = what the other is to person; no aToB key
  let r = await srv.call('link_people', { person: 'Milan', other: 'Quinn', other_is_to_person: 'client' })
  assert.equal(r.isError, false, r.text)
  let bond = data().personBonds.at(-1)
  assert.deepEqual({ ...bond, id: undefined, createdAt: undefined, updatedAt: undefined }, { id: undefined, a: 'person-milan', b: 'person-off', bToA: 'client', createdAt: undefined, updatedAt: undefined })
  assert.match(bond.id, /^bond-[0-9a-z]+$/); assert.ok(bond.createdAt > 1000 && bond.updatedAt === bond.createdAt)
  // the same pair from the other side sets the OTHER field on the same row (withLabel), no second row
  const n0 = data().personBonds.length
  r = await srv.call('link_people', { person: 'Quiet Quinn', other: 'Milan Shadek', other_is_to_person: 'accountant' }) // forgiving names
  assert.equal(r.isError, false, r.text); assert.equal(data().personBonds.length, n0)
  bond = data().personBonds.at(-1); assert.equal(bond.aToB, 'accountant'); assert.equal(bond.bToA, 'client')
  // both directions at once on a fresh pair
  r = await srv.call('link_people', { person: 'Ada N', other_id: 'person-milan', other_is_to_person: 'accountant', person_is_to_other: 'client' })
  assert.equal(r.isError, false, r.text); bond = data().personBonds.at(-1)
  assert.deepEqual([bond.a, bond.b, bond.bToA, bond.aToB], ['person-ada', 'person-milan', 'accountant', 'client'])
  // list_people shows both ways
  const lp = (await srv.call('list_people', { query: 'Milan' })).json.people[0]
  assert.deepEqual(lp.knows.map((k) => [k.with, k.isToThem]).sort(), [['Ada Nováková', 'client'], ['Quiet Quinn', 'client']].sort())
  // an empty word on an existing link changes nothing (the app's rule); self-link and unknown people are refused
  const snap = JSON.stringify(data().personBonds)
  r = await srv.call('link_people', { person: 'Ada N', other: 'Milan' }); assert.equal(r.isError, false); assert.equal(JSON.stringify(data().personBonds), snap)
  assert.equal((await srv.call('link_people', { person: 'Milan', other_id: 'person-milan' })).isError, true)
  assert.equal((await srv.call('link_people', { person: 'Milan', other: 'zzz nobody' })).isError, true)
  assert.equal((await srv.call('link_people', { person: 'Nov', other: 'Milan' })).isError, true) // ambiguous Ada/Adam
  // edit_link: either side, clear with ""
  r = await srv.call('edit_link', { person: 'Ada Nováková', other: 'Adam', other_is_to_person: 'twin', person_is_to_other: '' })
  assert.equal(r.isError, false, r.text); bond = data().personBonds.find((x) => x.id === 'bond-1')
  assert.equal(bond.bToA, 'twin'); assert.equal(bond.aToB, ''); assert.ok(bond.updatedAt > 1000)
  assert.equal((await srv.call('edit_link', { person: 'Ada N', other: 'Quiet', other_is_to_person: 'x' })).isError, true) // not linked
  assert.equal((await srv.call('edit_link', { person: 'Ada N', other: 'Adam' })).isError, true) // nothing to change
  // unlink: removed and buried, either order of names
  r = await srv.call('unlink_people', { person: 'Adam', other: 'Ada Nováková' }); assert.equal(r.isError, false, r.text)
  assert.ok(!data().personBonds.some((x) => x.id === 'bond-1')); assert.ok(keys(data()).includes('personBonds:bond-1'))
  assert.equal((await srv.call('unlink_people', { person: 'Adam', other: 'Ada Nováková' })).isError, true)
  // real merge: a stale phone keeps the new link and does not bring the removed one back
  const stale = world(); stale.savedAt = 500
  for (const m of [merge(stale, data()), merge(data(), stale)]) {
    assert.ok(!m.personBonds.some((x) => x.id === 'bond-1')); assert.ok(m.personBonds.some((x) => x.a === 'person-ada' && x.b === 'person-milan' && x.aToB === 'client'))
  }
}

/* ---- edit_contact (remove + re-log, as the card does it) ---- */
{
  const { srv, data } = regAll()
  const r = await srv.call('edit_contact', { person: 'Ada Novakova', date: dayAgo(3), new_date: dayAgo(5), new_channel: 'video' })
  assert.equal(r.isError, false, r.text)
  const c = data().personContacts.filter((x) => x.personId === 'person-ada'); assert.equal(c.length, 1)
  assert.deepEqual({ ...c[0], id: undefined, createdAt: undefined }, { id: undefined, personId: 'person-ada', day: dayAgo(5), channel: 'video', createdAt: undefined })
  assert.notEqual(c[0].id, 'contact-1'); assert.ok(keys(data()).includes('personContacts:contact-1'))
  assert.equal((await srv.call('list_people', { query: 'Ada Novakova' })).json.people[0].lastContact.daysAgo, 5)
  assert.equal((await srv.call('edit_contact', { contact_id: c[0].id, new_date: '2999-01-01' })).isError, true)
  assert.equal((await srv.call('edit_contact', { contact_id: c[0].id })).isError, true)
  assert.equal((await srv.call('edit_contact', { contact_id: c[0].id, new_channel: 'video' })).isError, true) // identical
  await srv.call('log_contact', { person: 'Ada N', channel: 'call', date: dayAgo(5) })
  const dup = await srv.call('edit_contact', { contact_id: c[0].id, new_channel: 'call' }); assert.equal(dup.isError, true); assert.match(dup.text, /already has a call contact/)
  assert.equal((await srv.call('edit_contact', { contact_id: c[0].id, new_channel: 'call', allow_duplicate: true })).isError, false)
  // log_contact twice is now allowed on request
  assert.equal((await srv.call('log_contact', { person: 'Ada N', channel: 'call', date: dayAgo(5) })).isError, true)
  assert.equal((await srv.call('log_contact', { person: 'Ada N', channel: 'call', date: dayAgo(5), allow_duplicate: true })).isError, false)
  // merge: the old contact stays gone on a stale phone
  const stale = world()
  for (const m of [merge(stale, data()), merge(data(), stale)]) assert.ok(!m.personContacts.some((x) => x.id === 'contact-1'))
}

/* ---- edit_person: position, birthday clears the year, everything the card edits ---- */
{
  const { srv, data } = regAll()
  const milan = () => data().people.find((p) => p.id === 'person-milan')
  // dragged far outside the business ring: clamped into the band (410.5..489.5), then rounded
  let r = await srv.call('edit_person', { person: 'Milan', x: 700, y: 0 }); assert.equal(r.isError, false, r.text)
  assert.deepEqual([milan().x, milan().y], [490, 0])
  r = await srv.call('edit_person', { person: 'Milan', x: 440, y: 20 }); assert.deepEqual([milan().x, milan().y], [440, 20]) // already inside: untouched
  assert.equal((await srv.call('edit_person', { person: 'Milan', x: 5 })).isError, true) // needs both
  // tier and position in one call: the position is clamped into the NEW ring
  await srv.call('edit_person', { person: 'Milan', tier: 'core', x: 10, y: 0 })
  assert.equal(milan().tier, 'core'); assert.equal(Math.hypot(milan().x, milan().y) >= 40 + 30 + 12, true)
  // birth year follows the date out
  await srv.call('edit_person', { person: 'Milan', birth_year: 1980 }); assert.equal(milan().birthYear, 1980)
  await srv.call('edit_person', { person: 'Milan', birthday: null }); assert.equal(milan().birthday, undefined); assert.equal(milan().birthYear, undefined)
  await srv.call('edit_person', { person: 'Milan', name_day_as: 'Veronika', job: 'tax', cadence_days: 11, reminders_off: true })
  assert.deepEqual([milan().nameDayAs, milan().job, milan().cadenceDays, milan().remindersOff], ['Veronika', 'tax', 11, true])
  await srv.call('edit_person', { person: 'Milan', reminders_off: false, name_day_as: null, job: null }); assert.equal(milan().remindersOff, false); assert.equal(milan().job, undefined); assert.equal(milan().nameDayAs, undefined)
}

/* ---- prospects: stage/source/notes/links/next at creation, every field in the pipeline edits ---- */
{
  const { srv, data } = regAll()
  const row = (n) => data().prospects.find((p) => p.name === n)
  let r = await srv.call('add_prospect', { name: 'Zubař Novák', source: 'friend', stage: 'contacted', domain: 'https://www.zubar.cz/x', value: 70, why: 'old site', notes: 'met at the gym', links: { drive: 'https://drive/x', proposal: '' }, next_step: 'Send the audit', waiting_on: 'me', contact: 'Dr. Novák', decides: true })
  assert.equal(r.isError, false, r.text)
  const Z = () => row('Zubař Novák')
  assert.equal(Z().stage, 'Contacted'); assert.equal(Z().source, 'friend'); assert.equal(Z().domain, 'zubar.cz'); assert.equal(Z().notes, 'met at the gym'); assert.deepEqual(Z().links, { drive: 'https://drive/x' })
  assert.deepEqual({ ...Z().next, at: 0 }, { text: 'Send the audit', on: 'me', at: 0 }); assert.ok(Z().next.at > 1000)
  assert.equal(Z().people.length, 1); assert.equal(Z().people[0].decides, true); assert.deepEqual(Z().touches, [])
  assert.equal((await srv.call('add_prospect', { name: 'Q1', source: 'found', stage: 'Won big' })).isError, true)
  assert.equal((await srv.call('add_prospect', { name: 'Q2', source: 'found' })).isError, false); assert.equal(row('Q2').stage, 'Ready to contact')

  // edit: notes, links merge + clear, next step keeps the other half, closed, clearing fields
  r = await srv.call('edit_prospect', { prospect: 'zubar', notes: 'second note', links: { outreach: 'https://doc/y', drive: null } }); assert.equal(r.isError, false, r.text)
  assert.equal(Z().notes, 'second note'); assert.deepEqual(Z().links, { outreach: 'https://doc/y' })
  await srv.call('edit_prospect', { prospect: 'zubar', links: { outreach: null } }); assert.equal(Z().links, undefined)
  await srv.call('edit_prospect', { prospect: 'zubar', waiting_on: 'client' }); assert.deepEqual([Z().next.text, Z().next.on], ['Send the audit', 'client'])
  await srv.call('edit_prospect', { prospect: 'zubar', next_step: 'Chase them' }); assert.deepEqual([Z().next.text, Z().next.on], ['Chase them', 'client'])
  await srv.call('edit_prospect', { prospect: 'zubar', stage: 'Acquired', closed: true }); assert.equal(Z().stage, 'Acquired'); assert.ok(Z().closed > 1000)
  assert.equal((await srv.call('get_prospect', { prospect: 'zubar' })).json.closed, new Date(Z().closed).toISOString().slice(0, 10))
  await srv.call('edit_prospect', { prospect: 'zubar', closed: false }); assert.equal('closed' in Z(), false)
  await srv.call('edit_prospect', { prospect: 'zubar', value: null, why: null, notes: null, domain: null }); for (const k of ['value', 'why', 'notes', 'domain']) assert.equal(k in Z(), false, k)
  await srv.call('edit_prospect', { prospect: 'zubar', source: 'met', stage: 'Lost', lost_reason: 'no budget' }); assert.deepEqual([Z().source, Z().stage, Z().lostReason], ['met', 'Lost', 'no budget'])
  await srv.call('edit_prospect', { prospect: 'zubar', lost_reason: null }); assert.equal('lostReason' in Z(), false)
  // the stage vocabulary is the app's own
  for (const st of ['reach', 'Build: building', 'In conversation']) { await srv.call('edit_prospect', { prospect: 'zubar', stage: st }); assert.equal(Z().stage, A.normStage(st)) }
  assert.match((await srv.call('edit_prospect', { prospect: 'zubar', stage: 'Won big' })).text, /is not a stage/)
  // Sheet columns stay read-only
  assert.equal((await srv.call('edit_prospect', { prospect: 'zubar', sheet: { niche: 'x' } }).catch((e) => ({ isError: true, text: String(e) }))).isError !== false || Z().sheet === undefined, true)
  assert.equal(Z().sheet, undefined)
}

/* ---- contacts at a business: rename, clear, unset decides, remove ---- */
{
  const { srv, data } = regAll()
  const p = () => data().prospects.find((x) => x.id === 'prospect-1')
  let r = await srv.call('edit_prospect_contact', { prospect: 'Pekarna', contact: 'jan', new_name: 'Jan Svoboda ml.', role: 'Owner', phone: '+420 111', email: null, decides: false })
  assert.equal(r.isError, false, r.text)
  assert.deepEqual(p().people, [{ id: 'pp-1', name: 'Jan Svoboda ml.', role: 'Owner', phone: '+420 111' }]) // email gone, decides gone (decides: checked || undefined)
  await srv.call('edit_prospect', { prospect: 'Pekarna', contact: 'Eva Černá', role: 'Manager' }); assert.equal(p().people.length, 2)
  assert.equal((await srv.call('edit_prospect_contact', { prospect: 'Pekarna', contact: 'Svoboda', role: 'x' })).isError, false)
  assert.equal((await srv.call('edit_prospect_contact', { prospect: 'Pekarna', contact: 'nobody', role: 'x' })).isError, true)
  assert.equal((await srv.call('edit_prospect_contact', { prospect: 'Pekarna', contact: 'Eva' })).isError, true) // nothing to change
  // a touch sent to Jan keeps working after Jan goes
  await srv.call('log_touch', { prospect: 'Pekarna', step: 'work', to: 'Jan' })
  r = await srv.call('remove_prospect_contact', { prospect: 'Pekarna', contact: 'pp-1' }); assert.equal(r.isError, false, r.text)
  assert.deepEqual(p().people.map((x) => x.name), ['Eva Černá'])
  assert.equal((await srv.call('get_prospect', { prospect: 'Pekarna' })).json.touches[0].to, undefined)
}

/* ---- remove_touch / resolve reply / prep / delete_prospect ---- */
{
  const w = world()
  w.prospects[1].touches.push({ id: 'touch-b', step: 'reminder', day: dayAgo(2), subject: 'Re: Hello' })
  w.prospects[1].replied = { day: dayAgo(1), subject: 'Re: Hello', body: 'yes?' }
  w.prospects[0].replied = { day: dayAgo(1), subject: 'Hi' }
  const stale = clone(w)
  const db = stateDb(w); const srv = fakeServer(K, M.tools_people.register, db); const data = () => db.tables.mc_state[0].data
  const kav = () => data().prospects.find((x) => x.id === 'prospect-2')
  // remove a touch by step+day, by id; the stage is not moved back
  let r = await srv.call('remove_touch', { prospect: 'Kavarna', step: 'reminder', date: dayAgo(2) }); assert.equal(r.isError, false, r.text)
  assert.deepEqual(kav().touches.map((t) => t.id), ['touch-a']); assert.equal(kav().stage, 'Contacted'); assert.ok(kav().updatedAt > 1000)
  assert.equal((await srv.call('remove_touch', { prospect: 'Kavarna', touch_id: 'touch-zzz' })).isError, true)
  assert.equal((await srv.call('remove_touch', { prospect: 'Kavarna' })).isError, true)
  assert.equal((await srv.call('remove_touch', { prospect: 'Kavarna', step: 'call', date: dayAgo(2) })).isError, true)
  r = await srv.call('remove_touch', { prospect: 'Kavarna', touch_id: 'touch-a' }); assert.deepEqual(kav().touches, [])
  for (const m of [merge(stale, data()), merge(data(), stale)]) assert.deepEqual(m.prospects.find((x) => x.id === 'prospect-2').touches, [])
  // replies: accept = stage Responded waiting + cleared; dismiss = cleared only
  r = await srv.call('resolve_prospect_reply', { prospect: 'Kavarna', action: 'accept' }); assert.equal(r.isError, false, r.text)
  assert.equal(kav().stage, 'Responded waiting'); assert.equal('replied' in kav(), false)
  r = await srv.call('resolve_prospect_reply', { prospect: 'Pekarna', action: 'dismiss' }); assert.equal(data().prospects[0].stage, 'Ready to contact'); assert.equal('replied' in data().prospects[0], false)
  assert.equal((await srv.call('resolve_prospect_reply', { prospect: 'Pekarna', action: 'accept' })).isError, true) // none waiting
  // prep
  r = await srv.call('mark_meeting_prep_ready', { prospect: 'Closed', event_uid: 'evt-1@google.com' }); assert.equal(r.isError, false, r.text)
  const closed = () => data().prospects.find((x) => x.id === 'prospect-4'); assert.deepEqual(closed().prep, ['evt-1@google.com'])
  await srv.call('mark_meeting_prep_ready', { prospect: 'Closed', event_uid: 'evt-1@google.com' }); await srv.call('mark_meeting_prep_ready', { prospect: 'Closed', event_uid: 'evt-2' })
  assert.deepEqual(closed().prep, ['evt-1@google.com', 'evt-2'])
  assert.deepEqual((await srv.call('get_prospect', { prospect: 'Closed' })).json.prepReadyFor, ['evt-1@google.com', 'evt-2'])
  // delete_prospect: gone, buried, a stale phone does not bring it back; a stale phone's own EDIT of it loses to the burial
  r = await srv.call('delete_prospect', { prospect: 'Old Lane' }); assert.equal(r.isError, false, r.text)
  assert.ok(!data().prospects.some((x) => x.id === 'prospect-3')); assert.deepEqual(keys(data()), ['prospects:prospect-3'])
  stale.prospects.find((x) => x.id === 'prospect-3').updatedAt = Date.now() + 5000
  for (const m of [merge(stale, data()), merge(data(), stale)]) assert.ok(!m.prospects.some((x) => x.id === 'prospect-3'))
  assert.equal((await srv.call('delete_prospect', { prospect: 'Old Lane' })).isError, true)
  // the Sheet note: a Sheet-born card is warned about
  data().prospects.find((x) => x.id === 'prospect-4').sheet = { country: 'CZ', row: 1 }
  assert.match((await srv.call('delete_prospect', { prospect: 'Closed Deal' })).text, /Prospects Sheet/)
  // deleting two at once would trip the writer's stop (no cascade is declared for prospects)
  await assert.rejects(() => M.commit(stateDb(world()), 'u1', (b) => { O.deleteProspect(b, { id: 'prospect-1' }); O.deleteProspect(b, { id: 'prospect-2' }); return { text: 'x' } }), /Safety stop: "prospects"/)
}

/* ---- the Sheet sync (src/prospectcalc.ts applySheet) against what the connector writes ---- */
{
  const w = world(); const db = stateDb(w)
  await M.commit(db, 'u1', (b) => { O.editProspect(b, { id: 'prospect-1' }, { stage: 'Meeting planned', notes: 'mine', value: 50, links: { drive: 'https://d' } }); return { text: 'ok' } })
  const mine = db.tables.mc_state[0].data.prospects
  const out = A.applySheet(mine, [{ name: 'Pekárna Svoboda', domain: 'pekarna.cz', status: 'Audited', country: 'CZ', row: 1 }], Date.now())
  const p = out.prospects.find((x) => x.id === 'prospect-1')
  assert.equal(p.stage, 'Audited') // the Sheet overwrites the stage, as the tool descriptions warn
  assert.deepEqual([p.notes, p.value, p.links], ['mine', 50, { drive: 'https://d' }]) // and leaves notes, value, links alone
}

/* ---- registered through zod: schemas reject nonsense ---- */
if (K.zodReal) {
  const { srv } = regAll()
  await assert.rejects(() => srv.call('link_people', { person: 'a', other: 'b', other_is_to_person: 'x'.repeat(81) }), /too_big|Too big|80/i)
  await assert.rejects(() => srv.call('resolve_prospect_reply', { prospect: 'a', action: 'maybe' }), /Invalid|enum/i)
  await assert.rejects(() => srv.call('edit_prospect', { prospect: 'a', waiting_on: 'nobody' }), /Invalid|enum/i)
  await assert.rejects(() => srv.call('remove_touch', { prospect: 'a', step: 'fax' }), /Invalid|enum/i)
  await assert.rejects(() => srv.call('edit_contact', { contact_id: 'x', new_date: 'yesterday' }), /Invalid|regex|string/i)
}

console.log(`MCP people + prospects: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
