import { useState } from 'react'
import { useStore } from '../store'
import { Sheet } from '../modals'
import { Segmented, Select } from '../ui'
import { HABIT_FREQUENCIES, SLOTS, focusNeedMin, COUNT_PERIODS, type HabitDef, type HabitFrequency, type CountPeriod, type HabitKind, type TimeSlot } from '../types'
import { localDateKey } from '../util'

/* One sheet for adding and editing. A habit a routine drives keeps its name and
   frequency in step with that routine, so those fields are read-only here. */
export function HabitSheet({ onClose, habit, drivenBy }: { onClose: () => void; habit?: HabitDef; drivenBy?: string }) {
  const { addHabit, updateHabit } = useStore()
  const [name, setName] = useState(habit?.name ?? '')
  // Editing keeps whatever it had, including none. Only a new habit defaults.
  const [daypart, setDaypart] = useState<TimeSlot | ''>(habit ? (habit.daypart ?? '') : 'morning')
  const [frequency, setFrequency] = useState<HabitFrequency>(habit?.frequency ?? 'daily')
  const [perWeek, setPerWeek] = useState(habit?.targetPerWeek ?? 3)
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? 'build')
  const [targetMin, setTargetMin] = useState(habit ? (habit.auto?.from === 'focus' ? focusNeedMin(habit) : habit.dailyTargetMin ?? 60) : 60)
  const [measure, setMeasure] = useState<'minutes' | 'times'>((habit?.measure === 'amount' ? 'times' : habit?.measure) ?? 'times')
  const [per, setPer] = useState<CountPeriod>(habit?.per ?? 'day')
  const [count, setCount] = useState(habit?.targetCount ?? 1)
  const [since, setSince] = useState(habit?.quitSince ?? localDateKey())
  const [startedOn, setStartedOn] = useState(habit?.startedOn ?? localDateKey())
  const locked = !!drivenBy
  const quitting = kind === 'break'
  const measured = kind === 'measured'
  const focusKept = habit?.auto?.from === 'focus'

  const submit = () => {
    if (!name.trim()) return
    const shape = {
      name: name.trim(),
      daypart: quitting ? undefined : (daypart || undefined),
      frequency,
      targetPerWeek: frequency === 'times-per-week' ? perWeek : undefined,
      kind,
      measure: measured ? measure : undefined,
      per: measured && measure === 'times' ? per : undefined,
      targetCount: measured && measure === 'times' ? Math.max(1, count) : undefined,
      dailyTargetMin: (measured && measure === 'minutes') || focusKept ? Math.max(5, targetMin) : undefined,
      // Focus blocks fill minutes. A count is his to log, so it has no source.
      source: measured && measure === 'minutes' ? ('focus' as const) : undefined,
      quitSince: quitting ? (since || localDateKey()) : undefined,
      startedOn: quitting ? undefined : (startedOn || localDateKey()),
    }
    if (habit) updateHabit(habit.id, locked ? { daypart: shape.daypart } : shape)
    else addHabit(shape)
    onClose()
  }

  return (
    <Sheet
      steady
      title={habit ? 'Edit this habit' : 'Add a habit'}
      onClose={onClose}
    >
      {/* Only when it is locked, and only because the form is about to refuse
          him: the fields are disabled and nothing else on screen says why. The
          other half of this was a definition of the word "habit". */}
      {locked && (
        <p className="sheet-warn" style={{ marginTop: 0 }}>
          The {drivenBy} routine keeps this habit, so its name and frequency follow that routine. You can still move it to a different part of the day.
        </p>
      )}
      <span className="field-label">Which kind is this?</span>
      <Segmented
        label="Which kind is this?"
        value={kind}
        options={[
          { id: 'build', label: 'Keep', hint: 'Something you want to do', disabled: locked },
          { id: 'break', label: 'Quit', hint: 'Something you want to stop', disabled: locked },
          { id: 'measured', label: 'Amount', hint: 'A number to hit, in times or minutes', disabled: locked },
        ]}
        onPick={(id) => setKind(id as HabitKind)}
      />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="hname">
        {quitting ? 'What are you quitting?' : measured ? 'What are you measuring?' : 'What is the habit?'}
      </label>
      <input
        id="hname" className="textinput" style={{ width: '100%' }} autoFocus={!locked} disabled={locked}
        placeholder={quitting ? 'e.g. Scrolling in bed' : 'e.g. 20 minutes of movement'}
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />

      {/* A thing you are quitting has no hour of the day; it has a day you
          stopped, and a rhythm for checking in on it. */}
      {quitting ? (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hsince">Not since</label>
            <input id="hsince" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="hfreqq">Check in</label>
            <Select id="hfreqq" style={{ width: '100%' }} value={frequency} disabled={locked}
              onChange={(v) => setFrequency(v)}
              options={HABIT_FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))} />
          </div>
        </div>
      ) : (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hpart">When in the day?</label>
            <Select id="hpart" style={{ width: '100%' }} value={daypart} onChange={(v) => setDaypart(v)}
              options={[...SLOTS.map((s) => ({ value: s.id as TimeSlot | '', label: `${s.label}, ${s.hint}` })), { value: '' as TimeSlot | '', label: 'Anytime' }]} />
          </div>
          <div>
            {measured ? (
              <>
                <label className="field-label" htmlFor="hmeasure">Counting what?</label>
                <Select id="hmeasure" style={{ width: '100%' }} value={measure}
                  onChange={(v) => setMeasure(v)}
                  options={[
                    { value: 'times' as const, label: 'Times you do it' },
                    { value: 'minutes' as const, label: 'Minutes of focus time' },
                  ]} />
              </>
            ) : frequency === 'times-per-week' ? (
              <>
                <label className="field-label" htmlFor="hper">Days a week</label>
                <input id="hper" className="textinput" style={{ width: '100%' }} type="number" min={1} max={7} value={perWeek}
                  onChange={(e) => setPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} />
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="hfreq">How often?</label>
                <Select id="hfreq" style={{ width: '100%' }} value={frequency} disabled={locked}
                  onChange={(v) => setFrequency(v)}
                  options={HABIT_FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))} />
              </>
            )}
          </div>
        </div>
      )}

      {/* The target itself, once he has said what he is counting. */}
      {(measured || focusKept) && (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          {measure === 'times' && !focusKept ? (
            <>
              <div>
                <label className="field-label" htmlFor="hcount">How many times?</label>
                <input id="hcount" className="textinput" style={{ width: '100%' }} type="number" min={1} max={99} value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <label className="field-label" htmlFor="hcper">In what stretch?</label>
                <Select id="hcper" style={{ width: '100%' }} value={per}
                  onChange={(v) => setPer(v)}
                  options={COUNT_PERIODS.map((o) => ({ value: o.id, label: o.label }))} />
              </div>
            </>
          ) : (
            <div>
              <label className="field-label" htmlFor="htarget">Minutes a day</label>
              <input id="htarget" className="textinput" style={{ width: '100%' }} type="number" min={5} max={600} step={5} value={targetMin}
                onChange={(e) => setTargetMin(Math.max(5, Math.min(600, Number(e.target.value) || 5)))} />
            </div>
          )}
        </div>
      )}

      {/* A Keep or an Amount gets the same date a Quit gets. Without it, one
          added today reads as ninety days of nothing, and a habit he has in
          fact been keeping since spring starts its count on the wrong day. */}
      {!quitting && (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hstart">Started on</label>
            <input id="hstart" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>{habit ? 'Save changes' : 'Add habit'}</button>
      </div>
    </Sheet>
  )
}
