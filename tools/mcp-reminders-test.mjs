/* Reminders area, through the real registration path, real zod, real commit(), the app's real merge,
   and PARITY of the repeat arithmetic against the app's own src/store/reminders.ts (run in Prague time).
   ZOD_PATH=... node tools/mcp-reminders-test.mjs */
process.env.TZ = 'Europe/Prague' // the app runs in his zone; the browser's Date is the spec for nextRepeat
import assert from 'assert/strict'
import { loadKit } from './mcp-test-kit.mjs'

const K = await loadKit({
  modules: ['tools-reminders.ts', 'ops-reminders.ts', 'tools-core.ts'],
  extra: ["export { nextRepeat as appNextRepeat, toLocalStamp as appToLocal, fromLocalStamp as appFromLocal, DEFAULT_LIST_ID as appDefaultListId } from './src/store/reminders.ts'"],
})
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const R = M.ops_reminders
assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), -120, 'test runs in Prague time')
assert.equal(R.DEFAULT_LIST_ID, M.appDefaultListId)

const base = () => {
  const b = fixture()
  b.reminderLists = [
    { id: 'rl-reminders', name: 'Reminders', color: 'blue', createdAt: 0, updatedAt: 0 },
    { id: 'rl-home', name: 'Home', color: 'green', createdAt: 5, updatedAt: 5 },
  ]
  b.reminders = [
    { id: 'rem-a', title: 'Call mum', notes: '', listId: 'rl-reminders', remindAt: '2026-11-07T09:00', flagged: false, createdAt: 1, updatedAt: 1 },
    { id: 'rem-b', title: 'Water plants', notes: 'all of them', listId: 'rl-home', remindAt: '2026-11-09T18:30', repeat: 'weekly', flagged: true, createdAt: 2, updatedAt: 2 },
    { id: 'rem-c', title: 'Buy gift', notes: '', listId: 'rl-home', flagged: false, createdAt: 3, updatedAt: 3 },
    { id: 'rem-d', title: 'Old thing', notes: '', listId: 'rl-home', flagged: false, doneAt: 50, createdAt: 4, updatedAt: 50 },
  ]
  return b
}
const J = (x) => JSON.parse(JSON.stringify(x))

/* ---------- surface ---------- */
{
  const srv = fakeServer(K, [M.tools_core.register, M.tools_reminders.register], stateDb(base()))
  const rem = fakeServer(K, M.tools_reminders.register, stateDb(base()))
  assert.deepEqual(rem.names().sort(), ['add_reminder', 'add_reminder_list', 'add_reminders', 'complete_reminder', 'complete_reminders', 'delete_reminder', 'delete_reminder_list', 'edit_reminder', 'edit_reminder_list', 'list_reminder_lists', 'list_reminders', 'reopen_reminder'])
  for (const n of rem.names()) { const c = rem.tools[n].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, n) }
  assert.deepEqual(rem.names().filter((n) => rem.tools[n].cfg.annotations.destructiveHint).sort(), ['delete_reminder', 'delete_reminder_list'])
  assert.deepEqual(rem.names().filter((n) => rem.tools[n].cfg.annotations.readOnlyHint).sort(), ['list_reminder_lists', 'list_reminders'])
  assert.ok(srv.names().length > 12)
}

/* ---------- PARITY with the app's nextRepeat over many dates ---------- */
{
  const reps = ['daily', 'weekly', 'monthly']
  let n = 0
  const check = (stamp) => {
    for (const rep of reps) {
      const want = M.appNextRepeat(stamp, rep)
      assert.equal(R.nextRepeat(stamp, rep), want, `${stamp} ${rep}`)
      n++
    }
  }
  // every day of 2024 to 2028 at awkward hours, so month ends, leap days (2024, 2028), both DST changes and the gap hour are all hit
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2029, 0, 1); t += 864e5) {
    const d = new Date(t)
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    for (const hm of ['00:00', '02:30', '03:00', '09:00', '23:59']) check(`${day}T${hm}`)
  }
  for (const s of ['2026-01-31T09:00', '2026-03-31T10:15', '2025-12-31T23:59', '2024-02-29T08:00', '2026-03-28T02:30', '2026-03-29T02:00', '2026-10-24T02:30', '2026-10-25T02:30', '2026-10-31T03:00']) check(s)
  // the app's own helpers agree with the stamp format we validate
  assert.equal(M.appToLocal(M.appFromLocal('2026-11-07T09:05')), '2026-11-07T09:05')
  // spot values spelled out
  assert.equal(R.nextRepeat('2026-01-31T09:00', 'monthly'), '2026-03-03T09:00', 'JS month overflow, as the app')
  assert.equal(R.nextRepeat('2024-02-29T09:00', 'weekly'), '2024-03-07T09:00')
  assert.equal(R.nextRepeat('2026-03-28T02:30', 'daily'), '2026-03-29T03:30', 'the spring-forward gap moves forward')
  assert.equal(R.nextRepeat('2026-10-24T02:30', 'weekly'), '2026-10-31T02:30')
  assert.ok(n > 27000)
}

/* ---------- stamp validation ---------- */
{
  for (const ok of ['2026-11-07T00:00', '2026-11-07T23:59', '2024-02-29T12:00']) assert.equal(R.isStamp(ok), true, ok)
  for (const bad of ['2026-11-07', '2026-11-07T24:00', '2026-11-07T09:60', '2026-02-29T09:00', '2026-13-01T09:00', '2026-11-31T09:00', '2026-11-07 09:00', '2026-11-07T9:00', '2026-11-07T09:00:00', '2026-11-07T09:00Z', '', 'tomorrow', '2026-00-10T09:00']) assert.equal(R.isStamp(bad), false, bad)
  assert.match(R.nowStamp(new Date('2026-11-07T22:30:00Z')), /^2026-11-07T23:30$/, 'Prague wall time')
  assert.match(R.nowStamp(new Date('2026-07-07T22:30:00Z')), /^2026-07-08T00:30$/)
}

/* ---------- add / edit ---------- */
{
  const b = base()
  const a = R.addReminder(b, { title: '  Pay rent  ', notes: ' flat ', remind_at: '2026-12-01T08:00', repeat: 'monthly', flagged: true })
  const row = b.reminders.at(-1)
  assert.deepEqual(J(row), { id: a.id, title: 'Pay rent', notes: 'flat', listId: 'rl-reminders', remindAt: '2026-12-01T08:00', repeat: 'monthly', flagged: true, createdAt: row.createdAt, updatedAt: row.createdAt })
  assert.match(a.id, /^rem-/)
  R.addReminder(b, { title: 'Pay rent' }) // duplicates allowed, as in the app
  const plain = b.reminders.at(-1)
  assert.deepEqual(J(plain), { id: plain.id, title: 'Pay rent', notes: '', listId: 'rl-reminders', flagged: false, createdAt: plain.createdAt, updatedAt: plain.updatedAt })
  R.addReminder(b, { title: 'In home', list: 'home' }); assert.equal(b.reminders.at(-1).listId, 'rl-home')
  R.addReminder(b, { title: 'By id', list: 'rl-home' }); assert.equal(b.reminders.at(-1).listId, 'rl-home')
  refuses(() => R.addReminder(b, { title: ' ' }), /needs a title/)
  refuses(() => R.addReminder(b, { title: 'x', remind_at: '2026-02-30T09:00' }), /real local time/)
  refuses(() => R.addReminder(b, { title: 'x', remind_at: '2026-11-07T25:00' }), /real local time/)
  refuses(() => R.addReminder(b, { title: 'x', repeat: 'daily' }), /repeat needs a time/)
  refuses(() => R.addReminder(b, { title: 'x', remind_at: '2026-11-07T09:00', repeat: 'yearly' }), /repeat must be/)
  refuses(() => R.addReminder(b, { title: 'x', list: 'nowhere' }), /No reminder list matches/)
  // default list when none is stored: the app's fixed one is created with the app's fixed id
  const e = fixture(); R.addReminder(e, { title: 'first' })
  assert.deepEqual(J(e.reminderLists), [{ id: 'rl-reminders', name: 'Reminders', color: 'blue', createdAt: 0, updatedAt: 0 }])
  assert.equal(e.reminders[0].listId, 'rl-reminders')
  // default falls back to the first list when the fixed one is gone
  const f = base(); f.reminderLists = f.reminderLists.slice(1); R.addReminder(f, { title: 'x' }); assert.equal(f.reminders.at(-1).listId, 'rl-home')

  // edit
  const c = b.reminders.find((x) => x.id === 'rem-c')
  R.editReminder(b, { id: 'rem-c' }, { new_title: ' Gift ', notes: ' card ', flagged: true, list: 'Reminders', remind_at: '2026-11-20T12:00', repeat: 'daily' })
  assert.deepEqual(J(c), { id: 'rem-c', title: 'Gift', notes: 'card', listId: 'rl-reminders', remindAt: '2026-11-20T12:00', repeat: 'daily', flagged: true, createdAt: 3, updatedAt: c.updatedAt })
  assert.ok(c.updatedAt > 3)
  R.editReminder(b, { title: 'gift' }, { remind_at: null }) // clearing the time clears the repeat, as the page does
  assert.deepEqual([c.remindAt, c.repeat, 'remindAt' in c, 'repeat' in c], [undefined, undefined, false, false])
  refuses(() => R.editReminder(b, { id: 'rem-c' }, { repeat: 'weekly' }), /needs a time/)
  R.editReminder(b, { id: 'rem-b' }, { repeat: 'none' }); assert.equal('repeat' in b.reminders.find((x) => x.id === 'rem-b'), false)
  R.editReminder(b, { id: 'rem-d' }, { flagged: true }); assert.equal(b.reminders.find((x) => x.id === 'rem-d').flagged, true, 'completed ones can be edited')
  refuses(() => R.editReminder(b, { id: 'rem-c' }, { remind_at: null, repeat: 'daily' }), /contradict/)
  refuses(() => R.editReminder(b, { id: 'rem-c' }, {}), /Nothing to change/)
  refuses(() => R.editReminder(b, { id: 'rem-c' }, { new_title: '  ' }), /needs a title/)
  refuses(() => R.editReminder(b, { id: 'rem-c' }, { remind_at: '2026-11-07' }), /real local time/)
  refuses(() => R.editReminder(b, { id: 'rem-c' }, { list: 'zzz' }), /No reminder list/)
  refuses(() => R.editReminder(b, { id: 'nope' }, { flagged: true }), /No reminder has the id/)
  refuses(() => R.editReminder(b, { title: 'rent' }, { flagged: true }), /matches 2 reminders/)
  refuses(() => R.editReminder(b, { title: 'zzz' }, { flagged: true }), /No reminder matches/)
  // a refused edit changed nothing
  const snap = JSON.stringify(b.reminders.find((x) => x.id === 'rem-a'))
  try { R.editReminder(b, { id: 'rem-a' }, { new_title: 'changed', remind_at: 'bad' }) } catch { /* expected */ }
  assert.equal(JSON.stringify(b.reminders.find((x) => x.id === 'rem-a')), snap)
}

/* ---------- complete / reopen: the repeat rule ---------- */
{
  const b = base()
  const w = b.reminders.find((x) => x.id === 'rem-b')
  const r = R.completeReminders(b, [{ id: 'rem-b' }])
  assert.equal(typeof w.doneAt, 'number'); assert.deepEqual(r.ids, ['rem-b'])
  const next = b.reminders.at(-1)
  assert.notEqual(next.id, 'rem-b'); assert.match(next.id, /^rem-/)
  assert.deepEqual(J(next), { id: next.id, title: 'Water plants', notes: 'all of them', listId: 'rl-home', remindAt: M.appNextRepeat('2026-11-09T18:30', 'weekly'), repeat: 'weekly', flagged: true, createdAt: next.createdAt, updatedAt: next.createdAt })
  assert.equal(next.remindAt, '2026-11-16T18:30'); assert.equal('doneAt' in next, false)
  assert.match(r.text, /Completed "Water plants"; the next one is set for 2026-11-16T18:30/)
  assert.equal(b.reminders.length, 5)
  // non-repeating: no new row
  R.completeReminders(b, [{ id: 'rem-a' }]); assert.equal(b.reminders.length, 5)
  // repeat without a time never repeats (toggleReminder needs both)
  b.reminders.push({ id: 'rem-x', title: 'odd', notes: '', listId: 'rl-home', repeat: 'daily', flagged: false, createdAt: 9, updatedAt: 9 })
  R.completeReminders(b, [{ id: 'rem-x' }]); assert.equal(b.reminders.length, 6)
  // title picks only OPEN ones: "water plants" is now one open (the new one) + one done: not ambiguous
  const again = R.completeReminders(b, [{ title: 'water plants' }]); assert.equal(again.ids[0], next.id)
  assert.equal(b.reminders.at(-1).remindAt, '2026-11-23T18:30')
  // already done by id: no-op, no new row
  const n0 = b.reminders.length
  assert.match(R.completeReminders(b, [{ id: 'rem-d' }]).text, /already completed/); assert.equal(b.reminders.length, n0)
  refuses(() => R.completeReminders(b, [{ title: 'old thing' }]), /No open reminder matches/)
  // reopen
  const o = R.reopenReminder(b, { title: 'old thing' }); assert.equal('doneAt' in b.reminders.find((x) => x.id === 'rem-d'), false); assert.match(o.text, /Reopened/)
  refuses(() => R.reopenReminder(b, { title: 'old thing' }), /No completed reminder matches/)
  assert.match(R.reopenReminder(b, { id: 'rem-d' }).text, /not completed/)
  const before = b.reminders.length
  const ro = R.reopenReminder(b, { id: 'rem-b' }); assert.match(ro.text, /next occurrence/); assert.equal(b.reminders.length, before, 'reopening removes nothing')
  // bulk: all or nothing, two repeating ones, month-end overflow honoured
  const c = base()
  c.reminders.push({ id: 'rem-m', title: 'Rent', notes: '', listId: 'rl-home', remindAt: '2026-01-31T09:00', repeat: 'monthly', flagged: false, createdAt: 7, updatedAt: 7 })
  const cs = JSON.stringify(c)
  refuses(() => R.completeReminders(c, [{ id: 'rem-m' }, { title: 'nope' }]), /Item 2/)
  refuses(() => R.completeReminders(c, [{ id: 'rem-m' }, { id: 'rem-m' }]), /listed twice/)
  refuses(() => R.completeReminders(c, []), /at least one/)
  refuses(() => R.completeReminders(c, Array.from({ length: 41 }, () => ({ id: 'rem-m' }))), /At most 40/)
  assert.equal(JSON.stringify(c), cs, 'a failed bulk changed nothing')
  const bulk = R.completeReminders(c, [{ id: 'rem-m' }, { id: 'rem-b' }])
  assert.equal(c.reminders.length, 7); assert.deepEqual(c.reminders.slice(-2).map((x) => x.remindAt), ['2026-03-03T09:00', '2026-11-16T18:30'])
  assert.equal(bulk.ids.length, 2)
}

/* ---------- delete + burial ---------- */
{
  const b = base()
  const r = R.deleteReminder(b, { title: 'gift' })
  assert.equal(b.reminders.length, 3); assert.ok(b.graveyard.some((t) => t.k === 'reminders:rem-c')); assert.match(r.text, /Deleted reminder "Buy gift"/)
  assert.equal(M.appRowKey('reminders', { id: 'x' }), 'reminders:x'); assert.equal(M.appRowKey('reminderLists', { id: 'x' }), 'reminderLists:x')
  refuses(() => R.deleteReminder(b, { id: 'nope' }), /No reminder has the id/)
}

/* ---------- lists ---------- */
{
  const b = base()
  const l = R.addReminderList(b, '  Garden ', 'teal')
  assert.deepEqual(J(b.reminderLists.at(-1)), { id: l.id, name: 'Garden', color: 'teal', createdAt: b.reminderLists.at(-1).createdAt, updatedAt: b.reminderLists.at(-1).createdAt })
  assert.match(l.id, /^rl-/)
  R.addReminderList(b, 'Plain'); assert.equal(b.reminderLists.at(-1).color, 'purple', "the page's default")
  refuses(() => R.addReminderList(b, ' '), /needs a name/)
  refuses(() => R.addReminderList(b, 'X', 'pink'), /color must be/)
  const e = fixture(); R.addReminderList(e, 'Work stuff')
  assert.deepEqual(e.reminderLists.map((x) => x.id).slice(0, 1), ['rl-reminders'], 'the app shows the default list first, so it is stored first')
  assert.equal(e.reminderLists.length, 2)
  // edit
  R.editReminderList(b, 'garden', { name: ' Yard ', color: 'red' })
  const g = b.reminderLists.find((x) => x.id === l.id); assert.deepEqual([g.name, g.color], ['Yard', 'red']); assert.ok(g.updatedAt >= g.createdAt)
  R.editReminderList(b, 'rl-home', { color: 'brown' }); assert.equal(b.reminderLists[1].color, 'brown')
  refuses(() => R.editReminderList(b, 'rl-home', {}), /Nothing to change/)
  refuses(() => R.editReminderList(b, 'rl-home', { name: ' ' }), /cannot be empty/)
  refuses(() => R.editReminderList(b, 'rl-home', { color: 'x' }), /color must be/)
  refuses(() => R.editReminderList(b, 'zzz', { color: 'red' }), /No reminder list matches/)
  // ambiguity
  R.addReminderList(b, 'Yard too')
  refuses(() => R.editReminderList(b, 'yar', { color: 'red' }), /matches 2 reminder lists/)
  // delete: cascade, exact shrink declaration, burial
  const d = base()
  d.reminders.push({ id: 'rem-e', title: 'More home', notes: '', listId: 'rl-home', flagged: false, createdAt: 8, updatedAt: 8 })
  const out = R.deleteReminderList(d, 'home')
  assert.deepEqual(d.reminders.map((x) => x.id), ['rem-a']); assert.deepEqual(d.reminderLists.map((x) => x.id), ['rl-reminders'])
  assert.match(out.text, /and its 4 reminders/)
  for (const k of ['reminderLists:rl-home', 'reminders:rem-b', 'reminders:rem-c', 'reminders:rem-d', 'reminders:rem-e']) assert.ok(d.graveyard.some((t) => t.k === k), k)
  assert.equal(M.shrinkAllowance(d).reminders, 3, 'four rows removed = one free + exactly three declared')
  refuses(() => R.deleteReminderList(d, 'rl-reminders'), /last list/)
  refuses(() => R.deleteReminderList(d, 'zzz'), /No reminder list matches/)
  // the stored-nothing case: only the virtual default exists, so it is the last list
  refuses(() => R.deleteReminderList(fixture(), 'reminders'), /last list/)
  // an empty list deletes with nothing declared
  const z = base(); z.reminders = []; R.deleteReminderList(z, 'home'); assert.equal(M.shrinkAllowance(z).reminders, undefined)
}

/* ---------- reading: the page's smart lists ---------- */
{
  const b = base()
  const at = new Date('2026-11-07T12:00:00Z') // 13:00 Prague, 7 Nov
  const all = R.listReminders(b, {}, at)
  assert.deepEqual(all.counts, { today: 1, scheduled: 2, all: 3, flagged: 1, completed: 1 })
  assert.equal(all.now, '2026-11-07T13:00'); assert.deepEqual(all.reminders.map((x) => x.id), ['rem-a', 'rem-b', 'rem-c'], 'by time, untimed last')
  const a = all.reminders[0]
  assert.deepEqual([a.list, a.remindAt, a.overdue], ['Reminders', '2026-11-07T09:00', true])
  assert.deepEqual([all.reminders[1].repeat, all.reminders[1].flagged, all.reminders[1].overdue], ['weekly', true, undefined])
  assert.deepEqual(R.listReminders(b, { view: 'today' }, at).reminders.map((x) => x.id), ['rem-a'])
  b.reminders.push({ id: 'rem-y', title: 'yesterday', notes: '', listId: 'rl-home', remindAt: '2026-11-05T09:00', flagged: false, createdAt: 10, updatedAt: 10 })
  assert.deepEqual(R.listReminders(b, { view: 'today' }, at).reminders.map((x) => x.id), ['rem-y', 'rem-a'], 'earlier ones are in Today, as the page')
  assert.deepEqual(R.listReminders(b, { view: 'scheduled' }, at).reminders.map((x) => x.id), ['rem-y', 'rem-a', 'rem-b'])
  assert.deepEqual(R.listReminders(b, { view: 'flagged' }, at).reminders.map((x) => x.id), ['rem-b'])
  assert.deepEqual(R.listReminders(b, { view: 'completed' }, at).reminders.map((x) => x.id), ['rem-d'])
  assert.equal(typeof R.listReminders(b, { view: 'completed' }, at).reminders[0].completedAt, 'string')
  assert.deepEqual(R.listReminders(b, { list: 'home' }, at).reminders.map((x) => x.id), ['rem-y', 'rem-b', 'rem-c'])
  assert.deepEqual(R.listReminders(b, { list: 'home', include_completed: true }, at).reminders.map((x) => x.id), ['rem-y', 'rem-b', 'rem-c', 'rem-d'])
  assert.deepEqual(R.listReminders(b, { query: 'PLANTS' }, at).reminders.map((x) => x.id), ['rem-b'])
  assert.deepEqual(R.listReminders(b, { query: 'all of' }, at).reminders.map((x) => x.id), ['rem-b'], 'notes are searched')
  assert.equal(R.listReminders(b, { limit: 1 }, at).shown, 1)
  assert.equal(R.listReminders(b, { limit: 1 }, at).count, 4)
  refuses(() => R.listReminders(b, { view: 'nope' }), /view must be/)
  refuses(() => R.listReminders(b, { list: 'nope' }), /No reminder list/)
  const lists = R.listReminderLists(b)
  assert.deepEqual(lists.lists.map((x) => [x.id, x.open, x.completed]), [['rl-reminders', 1, 0], ['rl-home', 3, 1]])
  assert.deepEqual(R.listReminderLists(fixture()).lists.map((x) => x.id), ['rl-reminders'], 'empty = the fixed default list, as the app shows')
  assert.equal(R.listReminders(fixture(), {}).count, 0)
}

/* ---------- through registration: zod, commit, safety stop ---------- */
{
  const db = stateDb(base())
  const srv = fakeServer(K, M.tools_reminders.register, db)
  const data = () => db.tables.mc_state[0].data
  const a = await srv.call('add_reminder', { title: 'Dentist', remind_at: '2026-12-02T10:00', list: 'home', flagged: true })
  assert.equal(a.isError, false, a.text); assert.equal(data().lastWrite.name, 'Claude')
  assert.equal(data().reminders.at(-1).listId, 'rl-home')
  const bulk = await srv.call('add_reminders', { reminders: [{ title: 'One' }, { title: 'Two', remind_at: '2026-12-03T09:00', repeat: 'daily' }] })
  assert.equal(bulk.isError, false, bulk.text); assert.equal(data().reminders.length, 7)
  const nb = JSON.stringify(data())
  const badbulk = await srv.call('add_reminders', { reminders: [{ title: 'Ok' }, { title: 'Bad', repeat: 'daily' }] })
  assert.equal(badbulk.isError, true); assert.match(badbulk.text, /Item 2/); assert.equal(JSON.stringify(data()), nb, 'all or nothing')
  const done = await srv.call('complete_reminder', { title: 'Water plants' })
  assert.match(done.text, /next one is set for 2026-11-16T18:30/); assert.equal(data().reminders.length, 8)
  assert.equal((await srv.call('complete_reminders', { reminders: [{ title: 'Call mum' }, { title: 'One' }] })).isError, false)
  assert.equal((await srv.call('reopen_reminder', { title: 'one' })).isError, false)
  const listed = await srv.call('list_reminders', { view: 'completed' }); assert.ok(listed.json.count >= 3)
  const ed = await srv.call('edit_reminder', { title: 'Dentist', remind_at: null }); assert.equal(ed.isError, false, ed.text)
  assert.equal('remindAt' in data().reminders.find((x) => x.title === 'Dentist'), false)
  assert.equal((await srv.call('list_reminder_lists')).json.count, 2)
  await srv.call('add_reminder_list', { name: 'Trip', color: 'orange' }); assert.equal(data().reminderLists.at(-1).color, 'orange')
  await srv.call('edit_reminder_list', { list: 'trip', new_name: 'Trip 2026' }); assert.equal(data().reminderLists.at(-1).name, 'Trip 2026')
  // cascade through the real safety stop
  const nLists = data().reminders.filter((x) => x.listId === 'rl-home').length
  const total = data().reminders.length
  const del = await srv.call('delete_reminder_list', { list: 'home' }); assert.equal(del.isError, false, del.text)
  assert.equal(data().reminders.length, total - nLists); assert.ok(nLists >= 4)
  assert.equal((await srv.call('delete_reminder_list', { list: 'trip' })).isError, false)
  const last = await srv.call('delete_reminder_list', { list: 'reminders' }); assert.equal(last.isError, true); assert.match(last.text, /last list/)
  const before = JSON.stringify(data())
  await srv.call('delete_reminder', { title: 'zzz' }); await srv.call('complete_reminder', { title: 'zzz' })
  assert.equal(JSON.stringify(data()), before, 'refused calls change nothing')
  if (K.zodReal) {
    await assert.rejects(() => srv.call('add_reminder', { title: 'x', repeat: 'yearly' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('add_reminder', {}), /title|Required|expected/i)
    await assert.rejects(() => srv.call('add_reminders', { reminders: Array.from({ length: 41 }, (_, i) => ({ title: `t${i}` })) }), /40|too_big|at most/i)
    await assert.rejects(() => srv.call('add_reminders', { reminders: [] }), /at least|too_small/i)
    await assert.rejects(() => srv.call('add_reminder_list', { name: 'x', color: 'pink' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('list_reminders', { view: 'tomorrow' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('edit_reminder', { id: 'a', repeat: 'hourly' }), /Invalid|enum/i)
  }
  // safety stop still guards a bug that drops two reminders
  const db3 = stateDb(base())
  await assert.rejects(() => M.commit(db3, 'u1', (b) => { b.reminders = [] }, { sleep: async () => {} }), /Safety stop/)
}

/* ---------- the app's REAL merge: a stale app copy keeps our changes, resurrects nothing ---------- */
{
  const app = base()
  const db = stateDb(clone(app))
  const srv = fakeServer(K, M.tools_reminders.register, db)
  await srv.call('delete_reminder', { id: 'rem-c' })
  await srv.call('delete_reminder_list', { list: 'home' }) // takes rem-b, rem-d with it
  await srv.call('add_reminder', { title: 'Fresh', remind_at: '2026-12-01T09:00', repeat: 'weekly' })
  await srv.call('edit_reminder', { id: 'rem-a', flagged: true })
  await srv.call('complete_reminder', { title: 'Fresh' })
  const head = db.tables.mc_state[0].data
  const stale = { ...app, savedAt: 500 }
  const merged = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(head)))
  const ids = merged.reminders.map((x) => x.id)
  for (const gone of ['rem-b', 'rem-c', 'rem-d']) assert.equal(ids.includes(gone), false, `${gone} stays deleted`)
  assert.equal(merged.reminderLists.some((l) => l.id === 'rl-home'), false, 'the deleted list stays deleted')
  assert.equal(merged.reminders.filter((x) => x.title === 'Fresh').length, 2, 'the done one and the next one both survive')
  assert.equal(merged.reminders.find((x) => x.id === 'rem-a').flagged, true)
  assert.ok(merged.reminders.some((x) => x.title === 'Fresh' && x.remindAt === '2026-12-08T09:00' && !x.doneAt))
  // a stale app that edited a row we buried does not bring it back either
  const stale2 = clone(app); stale2.reminders.find((x) => x.id === 'rem-c').title = 'edited on phone'; stale2.reminders.find((x) => x.id === 'rem-c').updatedAt = 99999999999999; stale2.savedAt = 500
  const m2 = JSON.parse(M.mergeStates(JSON.stringify(stale2), JSON.stringify(head)))
  assert.equal(m2.reminders.some((x) => x.id === 'rem-c'), false)
  // an empty-list blob written by us has the app's own default list id, so two devices agree
  const db2 = stateDb(fixture()); const srv2 = fakeServer(K, M.tools_reminders.register, db2)
  await srv2.call('add_reminder', { title: 'first ever' })
  const m3 = JSON.parse(M.mergeStates(JSON.stringify({ ...fixture(), reminderLists: [{ id: 'rl-reminders', name: 'Reminders', color: 'blue', createdAt: 0, updatedAt: 0 }], savedAt: 500 }), JSON.stringify(db2.tables.mc_state[0].data)))
  assert.equal(m3.reminderLists.length, 1); assert.equal(m3.reminders[0].listId, 'rl-reminders')
}

console.log(`MCP reminders area: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
