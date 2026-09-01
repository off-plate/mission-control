import { useState } from 'react'
import { useStore } from './store'
import { TARGET_HABIT_NAME, getHevyLastSync, hasHevyKey, syncHevy } from './hevy'
import * as Icon from './icons'
import type { HabitDef } from './types'

/* The gym habit pulls itself, and he presses the button.

   Two things he said, and they are one decision. First: the once-a-day
   automatic sync does not work, so he has been going to Settings and pressing
   Sync now, which is four clicks away from the habit it updates. Second, and
   the more important one: "I shouldn't be able to click them." A tick he can
   make by hand is a tick he can make by mistake or by wishful thinking, and
   then the number is worth nothing. Hevy knows which workouts happened.

   So the habit's own row carries the sync, and it carries nothing else: no
   checkbox, no way in by hand. Correcting a wrong day is a re-sync, not a
   click, because the correction has to come from the same place the truth
   does. syncHevy backfills every day it finds, so a day missed while the
   laptop was shut still lands. */

export function isHevyHabit(h: HabitDef): boolean {
  return h.name.trim().toLowerCase() === TARGET_HABIT_NAME
}

/** How long ago, said the way a person would. */
function ago(at: number | null): string {
  if (!at) return 'never synced'
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 2) return 'synced just now'
  if (mins < 60) return `synced ${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `synced ${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hrs / 24)
  return `synced ${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** Stale enough to say so. A day's workouts do not change after the day, so
 *  anything older than one is a sync that did not happen rather than a quiet
 *  period. */
const STALE_MS = 20 * 3600_000

export function HevySync() {
  const { habits, markHabitDaysOn } = useStore()
  const [spinning, setSpinning] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(() => getHevyLastSync())

  if (!hasHevyKey()) {
    return <span className="hevy-none">Add your Hevy key in Settings to fill this.</span>
  }

  const run = async () => {
    if (spinning) return
    setSpinning(true)
    setSaid(null)
    const res = await syncHevy(habits, markHabitDaysOn)
    setSpinning(false)
    setAt(getHevyLastSync())
    if (res.ok) {
      /* What it actually found, not "done". A sync that reports success and
         changed nothing is the shape of the bug he has been living with. */
      setSaid(res.days === 0 ? 'No workouts found' : `${res.days} ${res.days === 1 ? 'day' : 'days'} from Hevy`)
    } else {
      setSaid(
        res.reason === 'bad-key' ? 'Hevy refused that key'
          : res.reason === 'rate-limit' ? 'Hevy is rate limiting; try in a minute'
            : res.reason === 'no-habit' ? 'No habit named “workout / gym / fitness”'
              : res.reason === 'no-key' ? 'No Hevy key saved'
                : 'Hevy could not be reached',
      )
    }
  }

  const stale = !!at && Date.now() - at > STALE_MS

  return (
    <span className="hevy-sync">
      <button
        className={`hevy-btn${spinning ? ' is-spinning' : ''}`}
        onClick={() => void run()}
        disabled={spinning}
        aria-label="Pull today's workouts from Hevy"
        title="Pull from Hevy now"
      >
        <Icon.Rewind size={15} />
      </button>
      <span className={`hevy-when${stale && !spinning ? ' is-stale' : ''}`}>
        {spinning ? 'Syncing' : (said ?? ago(at))}
      </span>
    </span>
  )
}
