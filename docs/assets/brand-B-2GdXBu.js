import{u as n,j as e}from"./index-zMLO2klV.js";import"./vendor_react-BRnhmgIC.js";import"./vendor_supabase-DECvRwsC.js";const r=`
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
/* minmax(230px, 1fr) has no ceiling: Surfaces/Ink have 3 swatches each,
   Meaning has 5, so at 3440px auto-fit was correctly adding columns (up to
   13, measured), but a 3-item section only has 3 items to put in them --
   each stretched to fill its share of the row instead, ~1071px for one
   small colour square and a line of text. A concrete max keeps the grid
   adding columns as space allows without individual cards growing past a
   sensible size. */
.bg-guide .sw{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,320px));gap:14px}
/* This reuses the app-wide .chip name (a small inline tag: white-space:
   nowrap, padding 1px 6px), which was never meant for a swatch card and
   leaked in by accident -- the row layout below was really that base
   rule's inline-flex, and the description was really its nowrap, which
   is why it hard-clipped mid-word with no ellipsis rather than wrapping.
   Made explicit here instead of staying accidentally dependent on it. */
.bg-guide .chip{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card);white-space:normal}
.bg-guide .chip .col{height:78px;display:flex;align-items:flex-end;padding:10px 12px;flex:none}
.bg-guide .chip .hex{font-family:var(--mono);font-size:11px;background:rgba(255,255,255,.82);color:#1a1712;padding:3px 7px;border-radius:5px}
.bg-guide .chip .cb{padding:12px 14px;min-width:0}
.bg-guide .chip .nm{font-weight:700;font-size:14px}
.bg-guide .chip .us{font-size:12.5px;color:var(--muted);line-height:1.4;margin-top:3px;white-space:normal}

/* type */
/* A type specimen is read, not spread across a monitor -- no cap meant it
   sat top-left of whatever the page's own width was, empty past a few
   hundred px of real content. */
.bg-guide .spec{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:26px;margin-bottom:14px;max-width:900px}
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
`,o=[{name:"Paper",hex:"#f4efe4",use:"The warm background behind everything"},{name:"Card",hex:"#fbf8f1",use:"Panels and cards, one step lighter than paper"},{name:"Surface 2",hex:"#ece6d8",use:"Wells, insets, the meditation stage"}],t=[{name:"Ink",hex:"#1a1712",use:"Headings and primary text",ink:"#fbf8f1"},{name:"Muted",hex:"#6d6656",use:"Body, secondary text, labels",ink:"#fbf8f1"},{name:"Faint",hex:"#9a9282",use:"Captions, timestamps, fine print",ink:"#fbf8f1"}],l=[{name:"Accent, burnt orange",hex:"#d1502a",use:"Interactive: anything you can act on. The one accent.",ink:"#fff"},{name:"Alert, brick",hex:"#9e2b12",use:"Urgent and overdue. Rare, high alarm. Never decorative.",ink:"#fff"},{name:"Progress, green",hex:"#3f6b46",use:"Done, yours, money you have. Never for debt.",ink:"#fff"},{name:"At risk, amber",hex:"#b06612",use:"Behind or needs attention, not yet urgent.",ink:"#fff"},{name:"Data, slate",hex:"#55606e",use:"Plain information, so data reads as data.",ink:"#fff"}];function i({items:s}){return e.jsx("div",{className:"sw",children:s.map(a=>e.jsxs("div",{className:"chip",children:[e.jsx("div",{className:"col",style:{background:a.hex},children:e.jsx("span",{className:"hex",children:a.hex})}),e.jsxs("div",{className:"cb",children:[e.jsx("div",{className:"nm",children:a.name}),e.jsx("div",{className:"us",children:a.use})]})]},a.name))})}function h(){const{setPage:s}=n();return e.jsxs("div",{className:"bg-guide",children:[e.jsx("style",{dangerouslySetInnerHTML:{__html:r}}),e.jsxs("div",{className:"top",children:[e.jsxs("div",{children:[e.jsx("div",{className:"ey",children:"Mission Control · Brand & guidelines"}),e.jsxs("h1",{children:["Warm console.",e.jsx("br",{}),e.jsx("em",{children:"Real paper, warm ink."})]}),e.jsx("p",{className:"lede",children:"The production direction: a warm, editorial personal OS. Confident display type, a burnt-orange lead accent that others can join when a screen earns it, colour with intent, hairlines with the odd soft shadow. This system is now live across the whole app."})]}),e.jsx("button",{className:"back",onClick:()=>s("settings"),children:"Back to settings"})]}),e.jsxs("section",{children:[e.jsxs("div",{className:"sh",children:[e.jsx("h2",{children:"Surfaces"}),e.jsx("span",{children:"warm neutrals carry the layout"})]}),e.jsx(i,{items:o})]}),e.jsxs("section",{children:[e.jsxs("div",{className:"sh",children:[e.jsx("h2",{children:"Ink"}),e.jsx("span",{children:"high contrast on warm paper"})]}),e.jsx(i,{items:t})]}),e.jsxs("section",{children:[e.jsxs("div",{className:"sh",children:[e.jsx("h2",{children:"Meaning"}),e.jsx("span",{children:"one colour, one job"})]}),e.jsx(i,{items:l})]}),e.jsxs("section",{children:[e.jsxs("div",{className:"sh",children:[e.jsx("h2",{children:"Type"}),e.jsx("span",{children:"one family per job"})]}),e.jsxs("div",{className:"spec",children:[e.jsx("div",{className:"role",children:"Display: Bricolage Grotesque"}),e.jsx("div",{className:"big",style:{fontFamily:"var(--disp)",fontWeight:800,fontSize:"46px",lineHeight:1},children:"Good morning, Michael."}),e.jsx("div",{className:"use",children:"Page titles, greetings, big numbers. Weights 700 / 800. Tight tracking, one idea per line."}),e.jsxs("div",{className:"scale",children:[e.jsx("span",{children:"H1 48–64px"}),e.jsx("span",{children:"H2 28–32px"}),e.jsx("span",{children:"Card title 15px/700"})]})]}),e.jsxs("div",{className:"spec",children:[e.jsx("div",{className:"role",children:"Body: Instrument Sans"}),e.jsx("div",{className:"big",style:{fontFamily:"var(--sans)",fontSize:"22px",lineHeight:1.4},children:"Three things move the needle today. The rest can wait."}),e.jsx("div",{className:"use",children:"Everything you read: copy, labels, inputs. Weights 400 / 500 / 600. Line length 45–75 characters."}),e.jsxs("div",{className:"scale",children:[e.jsx("span",{children:"Body 15–17px"}),e.jsx("span",{children:"Small 13px"}),e.jsx("span",{children:"Label 12px"})]})]}),e.jsxs("div",{className:"spec",children:[e.jsx("div",{className:"role",children:"Data: JetBrains Mono"}),e.jsx("div",{className:"big",style:{fontFamily:"var(--mono)",fontSize:"20px"},children:"162 900 Kč · 09:40 · +25m · 4/7"}),e.jsx("div",{className:"use",children:"Numbers only: times, counts, deltas, money, totals. Tabular figures so columns line up. Never for prose."})]})]}),e.jsxs("section",{children:[e.jsxs("div",{className:"sh",children:[e.jsx("h2",{children:"Components"}),e.jsx("span",{children:"how it composes"})]}),e.jsxs("div",{className:"cprev",children:[e.jsxs("div",{className:"demo",children:[e.jsx("div",{className:"lbl",children:"Buttons · pills · progress"}),e.jsxs("div",{style:{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18},children:[e.jsx("button",{className:"btn acc",children:"Do it now"}),e.jsx("button",{className:"btn ink",children:"Open Compass"}),e.jsx("button",{className:"btn ghost",children:"Face a hard one"})]}),e.jsxs("div",{className:"pills",style:{marginBottom:18},children:[e.jsx("span",{className:"pill now",children:"now"}),e.jsx("span",{className:"pill done",children:"done"}),e.jsx("span",{className:"pill warn",children:"behind"}),e.jsx("span",{className:"pill data",children:"admin"})]}),e.jsxs("div",{className:"card-demo",children:[e.jsxs("h4",{children:["Debt payoff ",e.jsx("span",{className:"k",children:"Compass"})]}),e.jsxs("div",{className:"kpi",children:["162 900 ",e.jsx("span",{style:{fontSize:14,color:"var(--faint)",fontFamily:"var(--mono)"},children:"Kč left"})]}),e.jsx("div",{className:"barwrap",children:e.jsx("i",{style:{width:"25%"}})}),e.jsx("div",{style:{fontSize:12.5,color:"var(--muted)",marginTop:8},children:"55 600 paid · 25% cleared"})]})]}),e.jsxs("div",{className:"demo",children:[e.jsx("div",{className:"lbl",children:"The one thing"}),e.jsxs("div",{className:"focus",children:[e.jsx("div",{className:"t",children:"The one thing"}),e.jsx("div",{className:"h",children:"Send the tax transfer before the Aug 1 deadline."}),e.jsx("div",{style:{marginTop:12,color:"rgba(244,239,228,.72)",fontSize:13},children:"12 500 Kč · ~5 min"})]}),e.jsxs("div",{className:"card-demo",style:{marginTop:14},children:[e.jsxs("h4",{children:["Twelve gym sessions ",e.jsx("span",{className:"k",children:"58%"})]}),e.jsx("div",{className:"barwrap g",children:e.jsx("i",{style:{width:"58%"}})})]})]})]})]}),e.jsxs("section",{children:[e.jsx("div",{className:"sh",children:e.jsx("h2",{children:"Shape, space & motion"})}),e.jsxs("div",{className:"meta",children:[e.jsxs("div",{className:"m",children:[e.jsx("div",{className:"lab",children:"Radius"}),e.jsxs("div",{className:"val",children:["Cards 16–22px",e.jsx("br",{}),"Pills 7px",e.jsx("br",{}),"Buttons 12px"]})]}),e.jsxs("div",{className:"m",children:[e.jsx("div",{className:"lab",children:"Spacing"}),e.jsxs("div",{className:"val",children:["4 8 12 16 20 24",e.jsx("br",{}),"32 40 48 64 96"]})]}),e.jsxs("div",{className:"m",children:[e.jsx("div",{className:"lab",children:"Edges"}),e.jsxs("div",{className:"val",children:["Hairlines, not shadows.",e.jsx("br",{}),"1px borders separate."]})]}),e.jsxs("div",{className:"m",children:[e.jsx("div",{className:"lab",children:"Motion"}),e.jsxs("div",{className:"val",children:["Two curves, 160ms & 220ms.",e.jsx("br",{}),"No bounce, no decoration."]})]})]})]}),e.jsxs("section",{children:[e.jsx("div",{className:"sh",children:e.jsx("h2",{children:"Rules"})}),e.jsxs("div",{className:"rules",children:[e.jsxs("div",{className:"col",children:[e.jsx("div",{className:"rl",style:{color:"var(--green)"},children:"Do"}),e.jsxs("ul",{children:[e.jsx("li",{children:"Accents can stack on one screen when it earns them. Keep them purposeful."}),e.jsx("li",{children:"Colour usually carries meaning, but a plain, near-monochrome page is fine too."}),e.jsx("li",{children:"Hairlines are the default separator; a soft shadow to lift a surface is allowed."}),e.jsx("li",{children:"Display font for headings and numbers, mono for data, sans for words."}),e.jsx("li",{children:"Big type, protected whitespace, full-bleed header, content on a comfortable measure."})]})]}),e.jsxs("div",{className:"col",children:[e.jsx("div",{className:"rl",style:{color:"var(--alert)"},children:"Never"}),e.jsxs("ul",{children:[e.jsxs("li",{children:[e.jsx("b",{children:"A subtitle under any title."})," Not on a page, not on a section, not on a card. No eyebrows, no “daily / weekly / before work” under a heading that already says it. Do not even add the prop."]}),e.jsx("li",{children:"Green for money owed or spent. Green is only what you have."}),e.jsx("li",{children:"A second display font."}),e.jsx("li",{children:"Colour with no reason behind it, or a rainbow of it for its own sake."}),e.jsx("li",{children:"Stranded cards or capped widths that leave dead space on wide screens."})]})]})]}),e.jsx("p",{className:"note",style:{marginTop:"var(--s4)"},children:"The subtitle rule has one exception, and only one: a line under a heading may stay if it carries a fact that appears nowhere else and that you can act on, such as a live number, a deadline or a count. “3 of 5 felt easier than you feared” is data. “Two minutes, honest” is a subtitle. If you cannot name the new fact, cut it."})]}),e.jsx("p",{className:"note",children:"This system is now live across the app, Today, Plan, Routines, Habits, Goals, Money, Review, Coach and the rest all run on these tokens. Tell me anything to adjust (the accent, the fonts, a colour meaning, the density) and it changes everywhere at once."})]})}export{h as BrandPage};
