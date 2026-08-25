/* Prague, out the window.

   Open-Meteo, chosen because it needs NO KEY AND NO ACCOUNT. There is nothing
   to sign up for, so there is nothing that can start charging: the same reason
   the device voice is the default for speaking. Free for non-commercial use,
   which this is, being one man's own dashboard.

   The app fetches this and the app says the numbers. That is the same rule as
   everywhere else here, for the same reason. */

const PRAGUE = { lat: 50.088, lon: 14.42 }
const URL = `https://api.open-meteo.com/v1/forecast?latitude=${PRAGUE.lat}&longitude=${PRAGUE.lon}`
  + '&current=temperature_2m,apparent_temperature,weather_code'
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
  + '&timezone=Europe/Prague&forecast_days=1'

export interface Weather {
  nowC: number
  feelsC: number
  highC: number
  lowC: number
  rainPct: number
  /* Said the way a person says it, not a code. */
  sky: string
}

/* WMO codes, grouped the way it matters when deciding whether to walk. The full
   table has 28 entries and splits hairs this does not need. */
function skyOf(code: number): string {
  if (code === 0) return 'clear'
  if (code <= 2) return 'mostly clear'
  if (code === 3) return 'overcast'
  if (code <= 48) return 'foggy'
  if (code <= 57) return 'drizzling'
  if (code <= 67) return 'raining'
  if (code <= 77) return 'snowing'
  if (code <= 82) return 'showery'
  if (code <= 86) return 'snow showers'
  return 'stormy'
}

/* One call a quarter of an hour is plenty for a morning brief, and it keeps a
   page left open overnight from hammering a free service. */
const TTL = 15 * 60 * 1000
let cached: { at: number; value: Weather } | null = null

export async function getWeather(): Promise<Weather | null> {
  if (cached && Date.now() - cached.at < TTL) return cached.value
  try {
    const res = await fetch(URL)
    if (!res.ok) return null
    const d = await res.json()
    const c = d?.current
    const day = d?.daily
    if (typeof c?.temperature_2m !== 'number') return null
    const value: Weather = {
      nowC: Math.round(c.temperature_2m),
      feelsC: Math.round(c.apparent_temperature ?? c.temperature_2m),
      highC: Math.round(day?.temperature_2m_max?.[0] ?? c.temperature_2m),
      lowC: Math.round(day?.temperature_2m_min?.[0] ?? c.temperature_2m),
      rainPct: Math.round(day?.precipitation_probability_max?.[0] ?? 0),
      sky: skyOf(Number(c.weather_code ?? 0)),
    }
    cached = { at: Date.now(), value }
    return value
  } catch {
    /* No weather is not an error worth showing. The brief is about his day and
       the sky is the garnish. */
    return null
  }
}

/** One line, in the app's own words, with the app's own numbers. */
export function weatherLine(w: Weather): string {
  const rain = w.rainPct >= 40 ? `, ${w.rainPct}% chance of rain` : ''
  const feels = Math.abs(w.feelsC - w.nowC) >= 2 ? `, feels like ${w.feelsC}` : ''
  return `Prague is ${w.sky}, ${w.nowC} degrees${feels}, up to ${w.highC} today${rain}.`
}
