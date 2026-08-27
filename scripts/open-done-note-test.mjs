import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const KEY = 'mission-control-demo-v12'
const CAL_KEY = 'mc-calendar-read-v1'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

/* His report: "Write it up" makes a note, the button becomes "Open the
   note", he ticks the linked note done, and the button stops doing
   anything. Reproduced by seeding a meeting note already marked done and
   clicking the real button MeetingPrompt renders -- not a stand-in for it. */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const now = new Date()
const mins = now.getHours() * 60 + now.getMinutes()
const EVENT = {
  uid: 'test-meeting-1', day: dayKey(now), start: Math.max(0, mins - 5), end: mins + 30,
  title: 'Chatbot CTP', allDay: false, people: ['Petra'],
}

await page.goto(URL); await page.waitForTimeout(400)
// Seed the calendar cache BEFORE the app's own init effect can read it, and
// mark it fresh enough that no real network call ever fires -- this device
// is never signed into a real account, so that call would just fail anyway.
await page.evaluate(({ CAL_KEY, EVENT }) => {
  localStorage.setItem(CAL_KEY, JSON.stringify({ events: [EVENT], readAt: Date.now() }))
}, { CAL_KEY, EVENT })
await page.goto(URL); await page.waitForTimeout(400)

const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }

// A note already written for this meeting, already ticked done, filed in a
// real folder -- exactly the state his report describes.
await page.evaluate(({ KEY, EVENT }) => {
  const s = JSON.parse(localStorage.getItem(KEY))
  s.noteFolders = [{ id: 'nf-work-notes', name: 'Work notes' }]
  s.notes = [{
    id: 'meet-note-1',
    folderId: 'nf-work-notes',
    space: 'personal',
    body: `Chatbot CTP, meeting notes\n\n**Petra**\n\n- talked through the flow\n\n<!-- meeting:${EVENT.uid} -->`,
    when: new Date().toISOString().slice(0, 10),
    updatedAt: Date.now(),
    done: true,
  }]
  localStorage.setItem(KEY, JSON.stringify(s))
}, { KEY, EVENT })

await page.goto(`${URL}/#/notes`); await page.reload(); await page.waitForTimeout(1200)

const prompt = page.locator('.meet-prompt')
ok('the meeting write-up prompt renders at all (the calendar seed worked)', await prompt.count() === 1)
const btn = prompt.locator('.meet-go')
const label = await btn.textContent().catch(() => '')
ok('the button already reads "Open the note", not "Write it up"', (label ?? '').includes('Open the note'), label)

await btn.click()
await page.waitForTimeout(500)

const titleVal = await page.locator('.nt-title').first().inputValue().catch(() => '')
ok('clicking it actually opens the linked note, not nothing',
  titleVal.includes('Chatbot CTP'), `open note title: "${titleVal}"`)

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
