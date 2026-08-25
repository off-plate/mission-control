import { useEffect, useState } from 'react'
import { Band } from './pages1'
import { useStore } from './store'
import { getAiKey, hasAiKey, setAiKey } from './ai'
import { getTtsKey, hasTtsKey, setTtsKey } from './speech'
import { SUPABASE_ENABLED, currentAccount, onAccountChange, sendSignInCode, signInWithCode, signOutAccount, type Account } from './supabase'
import { describe, useSyncStatus } from './sync'
import { getOpenAtLogin, isDesktop, setOpenAtLogin } from './desktop'

/* ---------------- SETTINGS ---------------- */

/* Sync is what makes the same day show up on the laptop and the phone, and it is
   also the only backup. It runs behind a login because the key that reaches the
   database ships inside this page: without a session on the request, the database
   cannot tell him apart from anyone who opened the site. */
function AccountField() {
  const [me, setMe] = useState<Account | null>(null)
  const sync = useSyncStatus()
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentAccount().then((a) => { setMe(a); setReady(true) })
    return onAccountChange((a) => setMe(a))
  }, [])

  if (!SUPABASE_ENABLED) {
    return (
      <div className="source-row">
        <span className="status-dot off" />
        <span className="info">
          <span className="name">Sync</span>
          <span className="detail" style={{ display: 'block' }}>Off in this build. Everything stays in this browser.</span>
        </span>
      </div>
    )
  }

  const send = async () => {
    setBusy(true); setErr(null)
    const e = await sendSignInCode(email)
    setBusy(false)
    if (e) setErr(e); else { setSent(true); setCode('') }
  }
  const verify = async () => {
    setBusy(true); setErr(null)
    const e = await signInWithCode(email, code)
    setBusy(false)
    if (e) setErr(e)
  }

  return (
    <div className="ai-key">
      <div className="source-row">
        <span className={`status-dot ${!me ? 'off' : (sync.phase === 'offline' || sync.phase === 'error' || sync.phase === 'waiting') ? 'warn' : 'connected'}`} />
        <span className="info">
          <span className="name">Sync across your devices</span>
          <span className="detail" style={{ display: 'block' }}>
            {!ready ? 'Checking...'
              : me ? `${me.email}. ${describe(sync)}.`
              : 'Signed out. This browser only, and nothing is backed up.'}
          </span>
        </span>
        {me
          ? <button className="btn btn-quiet" onClick={() => void signOutAccount()}>Sign out</button>
          : null}
      </div>
      {ready && !me && !sent && (
        <>
          <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
            <input
              className="textinput grow" type="email" placeholder="you@example.com" value={email}
              onChange={(e) => { setEmail(e.target.value); setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@') && !busy) void send() }}
              aria-label="Email for the sign-in code"
            />
            <button className="btn btn-primary" disabled={!email.includes('@') || busy} onClick={() => void send()}>
              {busy ? 'Sending...' : 'Email me a code'}
            </button>
          </div>
          <p className="assist-note" style={{ marginTop: 6 }}>
            {err ?? 'No password. A code arrives, you type it back, and this device stays signed in.'}
          </p>
        </>
      )}
      {ready && !me && sent && (
        <>
          <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
            <input
              className="textinput grow mono" inputMode="numeric" autoComplete="one-time-code"
              placeholder="00000000" value={code}
              onChange={(e) => { setCode(e.target.value); setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.trim().length >= 6 && !busy) void verify() }}
              aria-label="The code from the email"
            />
            <button className="btn btn-primary" disabled={code.trim().length < 6 || busy} onClick={() => void verify()}>
              {busy ? 'Checking...' : 'Sign in'}
            </button>
          </div>
          <p className="assist-note" style={{ marginTop: 6 }}>
            {err ?? `Sent to ${email}. The email is titled "Your Magic Link" and holds the code.`}
            {' '}
            <button className="linkish" onClick={() => { setSent(false); setErr(null) }}>Use a different address</button>
          </p>
        </>
      )}
      <OpenAtLogin />
    </div>
  )
}

/* macOS only. Renders nothing in a browser tab, where there is no such thing as
   launching at login. */
function OpenAtLogin() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => { void getOpenAtLogin().then(setOn) }, [])
  if (!isDesktop() || on === null) return null
  return (
    <div className="source-row" style={{ marginTop: 'var(--s2)' }}>
      <span className={`status-dot ${on ? 'connected' : 'off'}`} />
      <span className="info">
        <span className="name">Open Mission Control when the Mac starts</span>
      </span>
      <button
        className="btn btn-quiet"
        onClick={() => { void setOpenAtLogin(!on).then((v) => { if (v !== null) setOn(v) }) }}
      >
        {on ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}

function AiKeyField() {
  const [key, setKey] = useState(getAiKey())
  const [saved, setSaved] = useState(false)
  const live = hasAiKey()
  return (
    <div className="ai-key">
      <div className="source-row">
        <span className={`status-dot ${live ? 'connected' : 'off'}`} />
        <span className="info">
          <span className="name">Groq, for breaking tasks down and /help in Notes</span>
          <span className="detail" style={{ display: 'block' }}>
            {live ? 'Connected. Break it down reads the actual task, and /help works in Notes.' : 'Not set. Break it down falls back to a pattern library, and /help in Notes does nothing.'}
          </span>
        </span>
        <a className="btn btn-quiet" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free key ↗</a>
      </div>
      <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
        <input
          className="textinput grow" type="password" placeholder="gsk_…" value={key}
          onChange={(e) => { setKey(e.target.value); setSaved(false) }}
          aria-label="Groq API key"
        />
        <button className="btn btn-primary" onClick={() => { setAiKey(key); setSaved(true) }}>Save</button>
      </div>
      <p className="assist-note" style={{ marginTop: 6 }}>
        {saved ? 'Saved on this device.' : 'Kept in this browser only. Never synced, never in the code, so it cannot leak through the public repo. You paste it once per device.'}
      </p>
    </div>
  )
}

function VoiceKeyField() {
  const [key, setKey] = useState(getTtsKey())
  const [saved, setSaved] = useState(false)
  const live = hasTtsKey()
  return (
    <div className="ai-key">
      <div className="source-row">
        {/* Never "off". Without a key the play button still reads the answer,
            using the voice already on the machine, so the honest states are
            which voice you get, not whether the feature exists. */}
        <span className={`status-dot ${live ? 'connected' : 'partial'}`} />
        <span className="info">
          <span className="name">Gemini, for the voice that reads answers aloud</span>
          <span className="detail" style={{ display: 'block' }}>
            {live
              ? 'Connected. Play on an answer is read by Gemini, and it can be told how to deliver a line.'
              : 'Not set. Play still works, read by the voice built into this machine. Gemini sounds better.'}
          </span>
        </span>
        <a className="btn btn-quiet" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a free key ↗</a>
      </div>
      <div className="formrow" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
        <input
          className="textinput grow" type="password" placeholder="AIza…" value={key}
          onChange={(e) => { setKey(e.target.value); setSaved(false) }}
          aria-label="Gemini API key"
        />
        <button className="btn btn-primary" onClick={() => { setTtsKey(key); setSaved(true) }}>Save</button>
      </div>
      <p className="assist-note" style={{ marginTop: 6 }}>
        {saved ? 'Saved on this device.' : 'Same deal as the key above: this browser only, never synced, never in the code. Check the project is on the free tier before you lean on it.'}
      </p>
    </div>
  )
}

export function SettingsPage() {
  const { resetDemo, setPage } = useStore()
  return (
    <div className="page">
      <Band title="Settings" />
      {/* One column, the width of the page. Connected sources was the other
          half of this grid and it listed integrations that do not exist. */}
      <div className="settings-col">
        <div className="panel">
          <span className="microcap">Your account</span>
          <AccountField />
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>AI</span>
          <AiKeyField />
          <VoiceKeyField />
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>Design</span>
          <div className="source-row">
            <span className="info"><span className="name">Brand &amp; guidelines</span><span className="detail" style={{ display: 'block' }}>The colours, type and rules this app is built on</span></span>
            <button className="btn btn-quiet" onClick={() => setPage('brand')}>Open</button>
          </div>
          {/* Which build is on this screen, in plain sight.

              This exists because "still not fixed" and "it is fixed here" were
              both true at once for an afternoon: the fix was live and the
              browser was serving an older bundle, and neither of us could see
              which. Now the screen says so, and Reload gets past a cached copy
              without going anywhere near developer tools. */}
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>This build</span>
          <div className="source-row">
            <span className="info">
              <span className="name mono">{__BUILD__}</span>
              <span className="detail" style={{ display: 'block' }}>
                If a fix seems missing, check this number changed. If it has not, the browser is serving an old copy.
              </span>
            </span>
            <button className="btn btn-quiet" onClick={() => location.reload()}>Reload</button>
          </div>
          <span className="microcap" style={{ marginTop: 24, display: 'block' }}>Start over</span>
          <div className="source-row">
            <span className="info"><span className="name">Wipe everything</span><span className="detail" style={{ display: 'block' }}>Clears this device and the saved copy. There is no undo on this one.</span></span>
            <button className="btn btn-danger" style={{ border: '1px solid var(--alert)' }} onClick={resetDemo}>Wipe</button>
          </div>
        </div>
      </div>
    </div>
  )
}
