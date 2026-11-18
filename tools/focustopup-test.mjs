// node --experimental-strip-types tools/focustopup-test.mjs
import assert from 'assert/strict'
import { focusTopUp } from '../src/focustopup.ts'
const S = [{ day: '2026-11-18', label: 'Write report', minutes: 25 }, { day: '2026-11-17', label: 'Write report', minutes: 40 }, { day: '2026-11-18', label: 'Other', minutes: 15 }]
assert.equal(focusTopUp(S, 'Write report', '2026-11-18', 30), 5, 'timer 25 + logged 30 tops up 5')
assert.equal(focusTopUp(S, ' write REPORT ', '2026-11-18', 20), 0, 'logged less than tracked adds nothing')
assert.equal(focusTopUp(S, 'New task', '2026-11-18', 30), 30, 'no timer = all of it')
assert.equal(focusTopUp(S, 'Write report', '2026-11-19', 30), 30, 'only today counts')
console.log('focusTopUp: all checks passed')
