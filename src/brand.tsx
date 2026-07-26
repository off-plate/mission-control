import { useStore } from './store'

/* Brand & guidelines for the production site, in the WARM direction explored in
   Claude Design. This page is rendered in that direction (its own scoped tokens and
   fonts) so it is both the spec and a live preview. Review it, we fix what's wrong,
   then apply it to the rest of the app. Nothing here changes the other pages yet. */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');
.bg-guide{
  --bg:#f4efe4;--card:#fbf8f1;--surf2:#ece6d8;--ink:#1a1712;--muted:#6d6656;--faint:#9a9282;
  --line:rgba(26,23,18,.10);--line2:rgba(26,23,18,.16);
  --accent:#d1502a;--accent-soft:rgba(209,80,42,.10);
  --alert:#9e2b12;--green:#3f6b46;--green-soft:rgba(63,107,70,.12);--amber:#b06612;--amber-soft:rgba(176,102,18,.12);--info:#55606e;--info-soft:rgba(85,96,110,.10);
  --disp:'Bricolage Grotesque',system-ui,sans-serif;--sans:'Instrument Sans',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,monospace;
  background:var(--bg);color:var(--ink);font-family:var(--sans);border:1px solid var(--line);border-radius:22px;padding:clamp(28px,4vw,64px);margin-top:12px;
  background-image:radial-gradient(circle at 1px 1px,rgba(26,23,18,.035) 1px,transparent 0);background-size:22px 22px;
}
.bg-guide *{box-sizing:border-box}
.bg-guide .top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:26px}
.bg-guide .ey{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.bg-guide h1{font-family:var(--disp);font-weight:800;font-size:clamp(34px,4.4vw,56px);line-height:.98;letter-spacing:-.025em;margin-top:8px}
.bg-guide h1 em{font-style:normal;color:var(--accent)}
.bg-guide .lede{color:var(--muted);font-size:16px;max-width:56ch;line-height:1.55;margin-top:16px}
.bg-guide .back{font-family:var(--sans);font-weight:600;font-size:13.5px;color:var(--ink);background:var(--card);border:1px solid var(--line2);border-radius:11px;padding:10px 15px;cursor:pointer;white-space:nowrap}
.bg-guide section{margin-top:52px}
.bg-guide .sh{display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:22px}
.bg-guide .sh h2{font-family:var(--disp);font-weight:700;font-size:22px;letter-spacing:-.01em}
.bg-guide .sh span{font-family:var(--mono);font-size:11.5px;color:var(--faint)}

/* swatches */
.bg-guide .sw{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.bg-guide .chip{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card)}
.bg-guide .chip .col{height:78px;display:flex;align-items:flex-end;padding:10px 12px}
.bg-guide .chip .hex{font-family:var(--mono);font-size:11px;background:rgba(255,255,255,.82);color:#1a1712;padding:3px 7px;border-radius:5px}
.bg-guide .chip .cb{padding:12px 14px}
.bg-guide .chip .nm{font-weight:700;font-size:14px}
.bg-guide .chip .us{font-size:12.5px;color:var(--muted);line-height:1.4;margin-top:3px}

/* type */
.bg-guide .spec{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:26px;margin-bottom:14px}
.bg-guide .spec .role{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.bg-guide .spec .big{margin:6px 0 10px;letter-spacing:-.02em}
.bg-guide .spec .use{font-size:13.5px;color:var(--muted)}
.bg-guide .scale{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:14px;font-family:var(--mono);font-size:11.5px;color:var(--faint)}

/* components preview */
.bg-guide .cprev{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}
.bg-guide .demo{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:22px}
.bg-guide .demo .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-bottom:14px}
.bg-guide .btn{border:none;font-family:var(--sans);font-weight:600;font-size:14px;padding:12px 18px;border-radius:12px;cursor:pointer;display:inline-flex;gap:8px;align-items:center}
.bg-guide .btn.acc{background:var(--accent);color:#fff}
.bg-guide .btn.ink{background:var(--ink);color:var(--bg)}
.bg-guide .btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line2)}
.bg-guide .pills{display:flex;gap:8px;flex-wrap:wrap}
.bg-guide .pill{font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:5px 10px;border-radius:7px}
.bg-guide .pill.now{background:var(--accent-soft);color:var(--accent)}
.bg-guide .pill.done{background:var(--green-soft);color:var(--green)}
.bg-guide .pill.warn{background:var(--amber-soft);color:var(--amber)}
.bg-guide .pill.data{background:var(--info-soft);color:var(--info)}
.bg-guide .focus{background:var(--ink);color:var(--bg);border-radius:16px;padding:22px 24px;position:relative;overflow:hidden}
.bg-guide .focus::after{content:'';position:absolute;right:-40px;top:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(209,80,42,.5),transparent 65%)}
.bg-guide .focus .t{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(244,239,228,.6)}
.bg-guide .focus .h{font-family:var(--disp);font-weight:700;font-size:20px;line-height:1.15;margin-top:8px;max-width:22ch}
.bg-guide .barwrap{height:6px;border-radius:99px;background:rgba(26,23,18,.08);overflow:hidden;margin-top:16px}
.bg-guide .barwrap i{display:block;height:100%;border-radius:99px;background:var(--accent)}
.bg-guide .barwrap.g i{background:var(--green)}
.bg-guide .card-demo{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:18px 20px}
.bg-guide .card-demo h4{font-family:var(--disp);font-weight:700;font-size:14px;display:flex;align-items:center}
.bg-guide .card-demo h4 .k{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--faint)}
.bg-guide .card-demo .kpi{font-family:var(--disp);font-weight:800;font-size:32px;margin:8px 0 2px}

/* rules */
.bg-guide .rules{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.bg-guide .rules .col{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:20px 22px}
.bg-guide .rules .rl{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.bg-guide .rules ul{list-style:none;margin-top:12px;display:flex;flex-direction:column;gap:9px}
.bg-guide .rules li{font-size:14px;line-height:1.4;padding-left:18px;position:relative}
.bg-guide .rules li::before{content:'';position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:50%;background:var(--line2)}

/* meta table */
.bg-guide .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.bg-guide .meta .m{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:16px 18px}
.bg-guide .meta .m .lab{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.bg-guide .meta .m .val{font-family:var(--mono);font-size:14px;margin-top:8px;color:var(--ink);line-height:1.6}
.bg-guide .note{font-size:12.5px;color:var(--faint);margin-top:26px;max-width:74ch;line-height:1.6}
@media(max-width:820px){.bg-guide .cprev,.bg-guide .rules{grid-template-columns:1fr}}
`

type Sw = { name: string; hex: string; use: string; ink?: string }
const SURFACES: Sw[] = [
  { name: 'Paper', hex: '#f4efe4', use: 'The warm background behind everything' },
  { name: 'Card', hex: '#fbf8f1', use: 'Panels and cards, one step lighter than paper' },
  { name: 'Surface 2', hex: '#ece6d8', use: 'Wells, insets, the meditation stage' },
]
const INK: Sw[] = [
  { name: 'Ink', hex: '#1a1712', use: 'Headings and primary text', ink: '#fbf8f1' },
  { name: 'Muted', hex: '#6d6656', use: 'Body, secondary text, labels', ink: '#fbf8f1' },
  { name: 'Faint', hex: '#9a9282', use: 'Captions, timestamps, fine print', ink: '#fbf8f1' },
]
const MEANING: Sw[] = [
  { name: 'Accent — burnt orange', hex: '#d1502a', use: 'Interactive: anything you can act on. The one accent.', ink: '#fff' },
  { name: 'Alert — brick', hex: '#9e2b12', use: 'Urgent and overdue. Rare, high alarm. Never decorative.', ink: '#fff' },
  { name: 'Progress — green', hex: '#3f6b46', use: 'Done, yours, money you have. Never for debt.', ink: '#fff' },
  { name: 'At risk — amber', hex: '#b06612', use: 'Behind or needs attention, not yet urgent.', ink: '#fff' },
  { name: 'Data — slate', hex: '#55606e', use: 'Plain information, so data reads as data.', ink: '#fff' },
]

function Swatches({ items }: { items: Sw[] }) {
  return (
    <div className="sw">
      {items.map((s) => (
        <div className="chip" key={s.name}>
          <div className="col" style={{ background: s.hex }}><span className="hex">{s.hex}</span></div>
          <div className="cb"><div className="nm">{s.name}</div><div className="us">{s.use}</div></div>
        </div>
      ))}
    </div>
  )
}

export function BrandPage() {
  const { setPage } = useStore()
  return (
    <div className="bg-guide">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="top">
        <div>
          <div className="ey">Mission Control · Brand &amp; guidelines</div>
          <h1>Warm console.<br /><em>Real paper, warm ink.</em></h1>
          <p className="lede">The production direction: a warm, editorial personal OS. Confident display type, a burnt-orange lead accent that others can join when a screen earns it, colour with intent, hairlines with the odd soft shadow. This system is now live across the whole app.</p>
        </div>
        <button className="back" onClick={() => setPage('settings')}>Back to settings</button>
      </div>

      <section>
        <div className="sh"><h2>Surfaces</h2><span>warm neutrals carry the layout</span></div>
        <Swatches items={SURFACES} />
      </section>
      <section>
        <div className="sh"><h2>Ink</h2><span>high contrast on warm paper</span></div>
        <Swatches items={INK} />
      </section>
      <section>
        <div className="sh"><h2>Meaning</h2><span>one colour, one job</span></div>
        <Swatches items={MEANING} />
      </section>

      <section>
        <div className="sh"><h2>Type</h2><span>one family per job</span></div>
        <div className="spec">
          <div className="role">Display — Bricolage Grotesque</div>
          <div className="big" style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: '46px', lineHeight: 1 }}>Good morning, Michael.</div>
          <div className="use">Page titles, greetings, big numbers. Weights 700 / 800. Tight tracking, one idea per line.</div>
          <div className="scale"><span>H1 48–64px</span><span>H2 28–32px</span><span>Card title 15px/700</span></div>
        </div>
        <div className="spec">
          <div className="role">Body — Instrument Sans</div>
          <div className="big" style={{ fontFamily: 'var(--sans)', fontSize: '22px', lineHeight: 1.4 }}>Three things move the needle today. The rest can wait.</div>
          <div className="use">Everything you read: copy, labels, inputs. Weights 400 / 500 / 600. Line length 45–75 characters.</div>
          <div className="scale"><span>Body 15–17px</span><span>Small 13px</span><span>Label 12px</span></div>
        </div>
        <div className="spec">
          <div className="role">Data — JetBrains Mono</div>
          <div className="big" style={{ fontFamily: 'var(--mono)', fontSize: '20px' }}>162 900 Kč · 09:40 · +25m · 4/7</div>
          <div className="use">Numbers only: times, counts, deltas, money, receipts. Tabular figures so columns line up. Never for prose.</div>
        </div>
      </section>

      <section>
        <div className="sh"><h2>Components</h2><span>how it composes</span></div>
        <div className="cprev">
          <div className="demo">
            <div className="lbl">Buttons · pills · progress</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              <button className="btn acc">Do it now</button>
              <button className="btn ink">Open Compass</button>
              <button className="btn ghost">Face a hard one</button>
            </div>
            <div className="pills" style={{ marginBottom: 18 }}>
              <span className="pill now">now</span><span className="pill done">done</span><span className="pill warn">behind</span><span className="pill data">admin</span>
            </div>
            <div className="card-demo">
              <h4>Debt payoff <span className="k">Compass</span></h4>
              <div className="kpi">162 900 <span style={{ fontSize: 14, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>Kč left</span></div>
              <div className="barwrap"><i style={{ width: '25%' }} /></div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>55 600 paid · 25% cleared</div>
            </div>
          </div>
          <div className="demo">
            <div className="lbl">The one thing</div>
            <div className="focus">
              <div className="t">The one thing</div>
              <div className="h">Send the tax transfer before the Aug 1 deadline.</div>
              <div style={{ marginTop: 12, color: 'rgba(244,239,228,.72)', fontSize: 13 }}>12 500 Kč · ~5 min</div>
            </div>
            <div className="card-demo" style={{ marginTop: 14 }}>
              <h4>Twelve gym sessions <span className="k">58%</span></h4>
              <div className="barwrap g"><i style={{ width: '58%' }} /></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="sh"><h2>Shape, space &amp; motion</h2></div>
        <div className="meta">
          <div className="m"><div className="lab">Radius</div><div className="val">Cards 16–22px<br />Pills 7px<br />Buttons 12px</div></div>
          <div className="m"><div className="lab">Spacing</div><div className="val">4 8 12 16 20 24<br />32 40 48 64 96</div></div>
          <div className="m"><div className="lab">Edges</div><div className="val">Hairlines, not shadows.<br />1px borders separate.</div></div>
          <div className="m"><div className="lab">Motion</div><div className="val">Two curves, 160ms &amp; 220ms.<br />No bounce, no decoration.</div></div>
        </div>
      </section>

      <section>
        <div className="sh"><h2>Rules</h2></div>
        <div className="rules">
          <div className="col">
            <div className="rl" style={{ color: 'var(--green)' }}>Do</div>
            <ul>
              <li>Accents can stack on one screen when it earns them. Keep them purposeful.</li>
              <li>Colour usually carries meaning, but a plain, near-monochrome page is fine too.</li>
              <li>Hairlines are the default separator; a soft shadow to lift a surface is allowed.</li>
              <li>Display font for headings and numbers, mono for data, sans for words.</li>
              <li>Big type, protected whitespace, full-bleed header, content on a comfortable measure.</li>
            </ul>
          </div>
          <div className="col">
            <div className="rl" style={{ color: 'var(--alert)' }}>Never</div>
            <ul>
              <li>Green for money owed or spent. Green is only what you have.</li>
              <li>A second display font.</li>
              <li>Colour with no reason behind it, or a rainbow of it for its own sake.</li>
              <li>Stranded cards or capped widths that leave dead space on wide screens.</li>
            </ul>
          </div>
        </div>
      </section>

      <p className="note">This system is now live across the app, Today, Plan, Routines, Habits, Goals, Money, Review, Coach and the rest all run on these tokens. Tell me anything to adjust (the accent, the fonts, a colour meaning, the density) and it changes everywhere at once.</p>
    </div>
  )
}
