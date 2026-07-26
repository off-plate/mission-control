import { Band } from './pages1'
import { useStore } from './store'

/* The design system, documented on a page reachable only from Settings. This is the
   current state, gathered from the app's own tokens, so we can review it together and
   then adjust. It eats its own dog food: built with the same tokens it describes. */

type Swatch = { name: string; hex: string; use: string; ink?: string }

const SURFACES: Swatch[] = [
  { name: 'Page', hex: '#f4f1e9', use: 'The warm paper background behind everything' },
  { name: 'Surface', hex: '#fdfcf8', use: 'Cards and panels, one step lighter than the page' },
  { name: 'Surface 2', hex: '#ece8dc', use: 'Insets, wells, the meditation stage' },
]
const INK: Swatch[] = [
  { name: 'Ink', hex: '#16150f', use: 'Primary text and headings', ink: '#fdfcf8' },
  { name: 'Muted', hex: '#57534a', use: 'Secondary text, labels', ink: '#fdfcf8' },
  { name: 'Faint', hex: '#6e6a5b', use: 'Captions, timestamps, fine print', ink: '#fdfcf8' },
]
const SEMANTIC: Swatch[] = [
  { name: 'Accent', hex: '#0b3d91', use: 'Interactive: anything you can click. Also the active space identity', ink: '#fff' },
  { name: 'Alert / coral', hex: '#b23415', use: 'Urgent, out of band, debt and overdue. Never decorative', ink: '#fff' },
  { name: 'Progress / green', hex: '#23624a', use: 'Positive, done, yours, money you have. Never used for debt', ink: '#fff' },
  { name: 'Info / slate', hex: '#55606e', use: 'Plain data, so information reads as information', ink: '#fff' },
  { name: 'Warn / amber', hex: '#b06612', use: 'At risk, needs attention but not urgent', ink: '#fff' },
]
const SPACES: Swatch[] = [
  { name: 'Personal', hex: '#0b3d91', use: 'Flight blue, the default accent', ink: '#fff' },
  { name: 'Work', hex: '#0f5f5a', use: 'Teal, when the Work space is active', ink: '#fff' },
  { name: 'Off-Plate', hex: '#8a6410', use: 'Gold, when the Off-Plate space is active', ink: '#fff' },
]
const CATEGORY: Swatch[] = [
  { name: 'Call', hex: '#b5654a', use: 'Category dot only', ink: '#fff' },
  { name: 'Admin', hex: '#5b6e8c', use: 'Category dot only', ink: '#fff' },
  { name: 'Deep', hex: '#8a6a4f', use: 'Category dot only', ink: '#fff' },
  { name: 'Quick', hex: '#4e8a88', use: 'Category dot only', ink: '#fff' },
]

function SwatchRow({ title, note, items }: { title: string; note?: string; items: Swatch[] }) {
  return (
    <div className="brand-block">
      <div className="review-sec"><span className="microcap">{title}</span>{note && <span className="review-sec-note">{note}</span>}</div>
      <div className="brand-swatches">
        {items.map((s) => (
          <div className="brand-swatch" key={s.name}>
            <div className="brand-chip" style={{ background: s.hex, color: s.ink ?? '#16150f' }}>{s.hex}</div>
            <div className="brand-swatch-body">
              <span className="brand-swatch-name">{s.name}</span>
              <span className="brand-swatch-use">{s.use}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BrandPage() {
  const { setPage } = useStore()
  return (
    <div className="page">
      <Band title="Brand & guidelines" sub="how this app is built, on purpose" actions={<button className="btn btn-quiet" onClick={() => setPage('settings')}>Back to settings</button>} />

      <div className="panel" style={{ marginBottom: 'var(--s5)', maxWidth: '78ch' }}>
        <span className="microcap">The idea in one line</span>
        <p style={{ fontSize: 'var(--text-lg)', fontFamily: 'var(--font-display)', fontWeight: 700, marginTop: 'var(--s2)' }}>Flight console on warm paper. High contrast, one accent, colour only where it means something.</p>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginTop: 'var(--s3)', maxWidth: '68ch' }}>
          Colour is never decoration here. Each colour carries one meaning, so a glance tells you what to act on, what is yours, and what is just information. When in doubt, use a neutral and let the one accent do the work.
        </p>
      </div>

      <SwatchRow title="Surfaces" note="warm neutrals do most of the work" items={SURFACES} />
      <SwatchRow title="Ink" note="high contrast on the warm paper" items={INK} />
      <SwatchRow title="Meaning" note="the whole point: one colour, one job" items={SEMANTIC} />
      <SwatchRow title="Space accents" note="the accent shifts with the active space" items={SPACES} />
      <SwatchRow title="Category dots" note="muted identity, used as small dots, never as fills" items={CATEGORY} />

      <div className="brand-block">
        <div className="review-sec"><span className="microcap">Type</span><span className="review-sec-note">one family per job</span></div>
        <div className="grid-3">
          <div className="panel">
            <span className="brand-swatch-use">Display</span>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', lineHeight: 1.1, margin: 'var(--s2) 0' }}>Cabinet Grotesk</p>
            <span className="brand-swatch-use">Headings, big numbers, page titles</span>
          </div>
          <div className="panel">
            <span className="brand-swatch-use">Body</span>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.25rem', lineHeight: 1.3, margin: 'var(--s2) 0' }}>General Sans</p>
            <span className="brand-swatch-use">Everything you read: copy, labels, inputs</span>
          </div>
          <div className="panel">
            <span className="brand-swatch-use">Mono</span>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', lineHeight: 1.3, margin: 'var(--s2) 0' }}>JetBrains Mono</p>
            <span className="brand-swatch-use">Data only: times, counts, deltas, receipts</span>
          </div>
        </div>
      </div>

      <div className="brand-block">
        <div className="review-sec"><span className="microcap">Shape & motion</span></div>
        <div className="grid-3">
          <div className="panel">
            <span className="brand-swatch-use">Radius</span>
            <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s3)', alignItems: 'flex-end' }}>
              <div style={{ width: 56, height: 56, background: 'var(--surface-2)', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-sm)' }} />
              <div style={{ width: 56, height: 56, background: 'var(--surface-2)', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-md)' }} />
            </div>
            <span className="brand-swatch-use" style={{ display: 'block', marginTop: 'var(--s3)' }}>4px and 8px only. Nothing softer.</span>
          </div>
          <div className="panel">
            <span className="brand-swatch-use">Edges</span>
            <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--s2)' }}>Hairlines, not shadows. 1px borders separate things; drop shadows are avoided.</p>
          </div>
          <div className="panel">
            <span className="brand-swatch-use">Motion</span>
            <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--s2)' }}>Two curves, fast (160ms) and medium (220ms), on a single ease. No bounce, no decorative animation.</p>
          </div>
        </div>
      </div>

      <div className="brand-block">
        <div className="review-sec"><span className="microcap">Rules</span></div>
        <div className="grid-2">
          <div className="panel">
            <span className="brand-swatch-use" style={{ color: 'var(--progress)' }}>Do</span>
            <ul className="brand-rules">
              <li>One accent per screen. Let neutrals carry the layout.</li>
              <li>Colour only when it means something (act / yours / data / risk).</li>
              <li>High contrast: near-black ink on warm paper.</li>
              <li>Mono for numbers, sans for words.</li>
              <li>Full-bleed header; content on a comfortable measure.</li>
            </ul>
          </div>
          <div className="panel">
            <span className="brand-swatch-use" style={{ color: 'var(--alert)' }}>Never</span>
            <ul className="brand-rules">
              <li>Gradients, glow, or colour as decoration.</li>
              <li>Green for money owed or spent. Green is only what you have.</li>
              <li>More than one accent, or a second display font.</li>
              <li>Drop shadows where a hairline works.</li>
              <li>Stranded cards or capped widths that leave dead space.</li>
            </ul>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--faint)', marginTop: 'var(--s5)', maxWidth: '72ch' }}>
        This is the current system, gathered from the app as it stands. Tell me what to change, palette, fonts, the meanings, and I will update this page and then recolour the app to match it.
      </p>
    </div>
  )
}
