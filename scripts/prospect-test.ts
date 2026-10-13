/* The Business view's derived numbers.
     node --experimental-strip-types scripts/prospect-test.ts */
import { age, applyEvents, applySheet, normProspects, normStage, sheetId, cleanDomain, isReady, matchProspect, nextStep, replyOdds, stepForSent } from '../src/prospectcalc.ts'

const fails: string[] = []
const ok = (n: string, c: boolean, d = ''): void => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`)
  if (!c) fails.push(n)
}
const t = (step: any, day = '2026-10-01') => ({ id: step, step, day })
const base = { stage: 'Contacted', source: 'found' as const, people: [], touches: [] as any[], createdAt: new Date('2026-09-20T12:00:00').getTime() }

ok('domain cleaned', cleanDomain(' https://www.Pekarna.cz/kontakt?x=1 ') === 'pekarna.cz')
ok('next is work email first', nextStep(base) === 'work')
ok('next skips what is done', nextStep({ ...base, touches: [t('work'), t('reminder')] }) === 'personal')
ok('call or visit after three emails', nextStep({ ...base, touches: [t('work'), t('reminder'), t('personal')] }) === 'callOrVisit')
ok('nothing after a call', nextStep({ ...base, touches: [t('work'), t('reminder'), t('personal'), t('call')] }) === null)
ok('no next step in conversation', nextStep({ ...base, stage: 'In conversation' }) === null)
ok('age from last touch', age({ ...base, touches: [t('work', '2026-09-25'), t('reminder', '2026-10-01')] }, '2026-10-04').days === 3)
ok('age from added', age(base, '2026-10-04').days === 14 && age(base, '2026-10-04').since === 'added')
ok('found, cold', replyOdds(base) === 15)
ok('inbound with a decider', replyOdds({ ...base, source: 'inbound', people: [{ id: 'a', name: 'J', decides: true, email: 'j@x.cz' }] as any }) === 70)
ok('decider without a way to reach them adds nothing', replyOdds({ ...base, people: [{ id: 'a', name: 'J', decides: true }] as any }) === 15)
ok('each unanswered touch costs 10, floor 5', replyOdds({ ...base, touches: [t('work'), t('reminder')] }) === 5)
ok('hidden once answered', replyOdds({ ...base, stage: 'In conversation' }) === null)

// The Gmail sync (2026-10-11)
const pr = (o: any) => ({ id: 'p', name: 'Biz', source: 'found', stage: 'Email to prepare', people: [], touches: [], createdAt: 0, updatedAt: 0, ...o })
const owner = pr({ id: 'a', domain: 'pekarna.cz', people: [{ id: 'o', name: 'Jana', email: 'Jana@Pekarna.cz' }] })
const free = pr({ id: 'b', domain: 'gmail.com', people: [{ id: 'q', name: 'Petr', email: 'petr@gmail.com' }] })
ok('match by exact email, any case', matchProspect([free, owner], 'jana@pekarna.cz')?.id === 'a')
ok('match by business domain', matchProspect([owner], 'info@pekarna.cz')?.id === 'a')
ok('freemail domain never matches strangers', matchProspect([free], 'someone@gmail.com') === undefined)
ok('alias: first email, then reminder', stepForSent({ touches: [] }, 'offplate') === 'work' && stepForSent({ touches: [t('work')] as any }, 'offplate') === 'reminder')
ok('personal address is the personal email', stepForSent({ touches: [t('work')] as any }, 'personal') === 'personal')
ok('alias after the reminder is conversation', stepForSent({ touches: [t('work'), t('reminder')] as any }, 'offplate') === null)
const ev = (id: string, kind: 'sent' | 'reply', day: string, o: any = {}) => ({ id, kind, day, via: 'offplate', counterpart: 'jana@pekarna.cz', ...o })
const r1 = applyEvents([owner as any], [ev('m2', 'sent', '2026-10-10', { subject: 'RE: Web' }), ev('m1', 'sent', '2026-10-08', { subject: 'Web' })], 5)
const p1 = r1.prospects[0]
ok('sent emails become work then reminder, by day', p1.touches.map((x) => x.step).join() === 'work,reminder' && p1.touches[0].day === '2026-10-08')
ok('first email moves it to Contacted', p1.stage === 'Contacted' && p1.updatedAt === 5)
ok('touch goes to the matching person', p1.touches[0].to === 'o')
ok('both events done', r1.done.join() === 'm1,m2')
ok('applying twice adds nothing', applyEvents(r1.prospects, [ev('m1', 'sent', '2026-10-08')]).prospects[0].touches.length === 2)
const r2 = applyEvents(r1.prospects, [ev('m3', 'reply', '2026-10-11', { subject: 'Re: Web', via: null })])
ok('a reply waits for his yes, stage unchanged', r2.prospects[0].replied?.day === '2026-10-11' && r2.prospects[0].stage === 'Contacted')
const r3 = applyEvents([owner as any], [ev('m9', 'sent', '2026-10-08', { counterpart: 'x@unknown.cz' })])
ok('no prospect yet: event stays open', r3.done.length === 0)
const r4 = applyEvents([{ ...owner, stage: 'In conversation' } as any], [ev('m5', 'sent', '2026-10-08')])
ok('in conversation: seen, no touch', r4.done.join() === 'm5' && r4.prospects[0].touches.length === 0)
ok('ready 2 days after the last touch', isReady(p1, '2026-10-12') && !isReady(p1, '2026-10-11'))
ok('never contacted is not "ready"', !isReady(owner as any, '2026-10-30'))

// Statuses are the Sheet's (2026-10-13)
ok('old lanes map to Sheet statuses', ['reach', 'contacted', 'talking', 'won', 'lost'].map(normStage).join() === 'Email to prepare,Contacted,In conversation,Acquired,Lost')
ok('an unknown Sheet status is kept', normStage('Waiting on Pavel') === 'Waiting on Pavel')
const kept = [pr({ stage: 'Contacted' })]
ok('nothing to migrate keeps the same list', normProspects(kept as any) === kept)
ok('prep statuses have no next email and no odds', nextStep({ ...base, stage: 'Audit to review' }) === null && replyOdds({ ...base, stage: 'Build' }) === null)
ok('Email to prepare starts the sequence', nextStep({ ...base, stage: 'Email to prepare' }) === 'work')
const r5 = applyEvents([{ ...owner, stage: 'Ready to contact' } as any], [ev('m6', 'sent', '2026-10-08')])
ok('first email moves Ready to contact to Contacted', r5.prospects[0].stage === 'Contacted')
const r6 = applyEvents([{ ...owner, stage: '2nd reminder sent (personal)' } as any], [ev('m7', 'sent', '2026-10-08')])
ok('a sent email never pulls a status back', r6.prospects[0].stage === '2nd reminder sent (personal)')

// The Sheet sync (2026-10-13)
const row = (o: any) => ({ name: 'Pekárna U Jany', domain: 'pekarna.cz', status: 'Contacted', country: 'Czech Republic', niche: 'Bakery', row: 0, ...o })
const s1 = applySheet([owner as any], [row({}), row({ name: 'Nová firma', domain: 'https://www.Nova.cz/', status: 'Audit to create', row: 1 })], 9)
ok('matched by domain, Sheet columns and status land', s1.prospects[0].sheet?.niche === 'Bakery' && s1.prospects[0].stage === 'Contacted' && s1.changed === 1)
ok('his own fields survive', s1.prospects[0].people[0].name === 'Jana' && s1.prospects[0].name === 'Biz')
ok('a new row becomes a card with a stable id', s1.added === 1 && s1.prospects[1].id === 'prospect-sheet-nova-cz' && s1.prospects[1].domain === 'nova.cz' && s1.prospects[1].stage === 'Audit to create')
ok('same snapshot twice changes nothing', (() => { const s = applySheet(s1.prospects, [row({}), row({ name: 'Nová firma', domain: 'nova.cz', status: 'Audit to create', row: 1 })], 10); return s.changed + s.added === 0 })())
ok('matched by name when there is no domain', applySheet([pr({ id: 'n', name: 'Pekárna u Jany' })] as any, [row({ domain: '' })]).prospects.length === 1)
const talking = applySheet([{ ...owner, stage: 'In conversation' } as any], [row({ status: 'Responded waiting' })])
ok('a card moved past the Sheet keeps its status', talking.prospects[0].stage === 'In conversation' && talking.prospects[0].sheet?.niche === 'Bakery')
ok('the Sheet wins over his MC status otherwise', applySheet([{ ...owner, stage: 'Contacted' } as any], [row({ status: 'Ready to contact' })]).prospects[0].stage === 'Ready to contact')
ok('a card he deleted is not brought back', applySheet([], [row({})], 1, (id) => id === sheetId(row({}))).added === 0)
ok('freemail domain matches by name, not domain', applySheet([free as any], [row({ name: 'Other', domain: 'gmail.com' })]).added === 1)

if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1) }
console.log('\nall passed')
