import { useState } from 'react'
import { sendSignInCode, signInWithCode } from './supabase'

/* The sign-in screen, shown before the app when there is no session and this
   device has not chosen to stay local. Signing in reloads rather than swapping
   state in place, so the saved row is hydrated by the normal boot path instead
   of being merged into a store that has already read localStorage. */

export const LOCAL_ONLY_KEY = 'mc-local-only'

export function SignIn({ onLocalOnly }: { onLocalOnly: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async () => {
    setBusy(true); setErr(null)
    const e = await sendSignInCode(email)
    setBusy(false)
    if (e) setErr(e); else { setSent(true); setCode('') }
  }
  const verify = async () => {
    setBusy(true); setErr(null)
    const e = await signInWithCode(email, code)
    if (e) { setBusy(false); setErr(e); return }
    location.reload()
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <span className="signin-mark">Mission Control</span>
        <h1 className="signin-h">Sign in</h1>

        {!sent ? (
          <>
            <label className="signin-label" htmlFor="si-email">Your email</label>
            <input
              id="si-email" className="textinput" type="email" autoComplete="email"
              placeholder="you@example.com" value={email} autoFocus
              onChange={(e) => { setEmail(e.target.value); setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@') && !busy) void send() }}
            />
            <button className="btn btn-primary signin-go" disabled={!email.includes('@') || busy} onClick={() => void send()}>
              {busy ? 'Sending...' : 'Email me a code'}
            </button>
          </>
        ) : (
          <>
            <label className="signin-label" htmlFor="si-code">The code from the email</label>
            <input
              id="si-code" className="textinput mono signin-code" inputMode="numeric" autoComplete="one-time-code"
              placeholder="00000000" value={code} autoFocus
              onChange={(e) => { setCode(e.target.value); setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.trim().length >= 6 && !busy) void verify() }}
            />
            <button className="btn btn-primary signin-go" disabled={code.trim().length < 6 || busy} onClick={() => void verify()}>
              {busy ? 'Checking...' : 'Sign in'}
            </button>
            <p className="signin-note">
              Sent to {email}. It expires in an hour.{' '}
              <button className="linkish" onClick={() => { setSent(false); setErr(null) }}>Change the address</button>
            </p>
          </>
        )}

        {err && <p className="signin-err">{err}</p>}

        <div className="signin-foot">
          <button className="linkish" onClick={onLocalOnly}>Use this device only</button>
          <span className="signin-foot-why">Nothing is backed up and the phone shows a different day.</span>
        </div>
      </div>
    </div>
  )
}
