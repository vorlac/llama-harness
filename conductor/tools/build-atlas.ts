// conductor/tools/build-atlas.ts — renders conductor/tools/atlas.ts into one
// self-contained interactive HTML page.
//
//   node conductor/tools/build-atlas.ts [out.html]
//
// Two layers, in the tools/replay.ts mould: PURE derivations (the atlas graph ->
// band layout, adjacency, the log index) plus a renderer over them, and exactly
// one I/O call (writeFileSync) in a thin argv shell at the bottom, guarded by an
// argv[1] suffix so importing this module does nothing at all.
//
// G1: node built-ins only. G2: erasable TypeScript. The page it emits has no
// external asset except the Google Fonts stylesheet, so it opens from a file://
// path with no server and no network beyond the type.
//
// The LAYOUT is bands, not a raw DAG. A topological left-to-right layout of ~95
// nodes is a hairball nobody reads; the bands follow the journey a prompt takes,
// which is the order a person actually asks their questions in.

import { writeFileSync } from "node:fs";

import { ATLAS } from "./atlas.ts";
import type { AtlasEdge, AtlasNode } from "./atlas.ts";

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

export interface Band {
  id: string;
  title: string;
  blurb: string;
  nodeIds: readonly string[];
}

// Which band a node belongs to, by id prefix. Ordered: the first match wins, so
// the more specific prefixes are listed before the general ones.
const BAND_RULES: readonly { band: string; test: (n: AtlasNode) => boolean }[] = [
  { band: "arrival", test: (n) => n.kind === "entry" || n.kind === "hook" },
  { band: "init", test: (n) => n.kind === "init" },
  { band: "inject", test: (n) => n.kind === "inject" },
  { band: "router", test: (n) => n.kind === "router" },
  { band: "gates", test: (n) => n.kind === "gate" || n.kind === "hatch" },
  { band: "runfsm", test: (n) => n.kind === "runState" || n.id === "engine.fsm" },
  { band: "tools", test: (n) => n.kind === "tool" },
  { band: "itemfsm", test: (n) => n.kind === "itemState" },
  {
    band: "engines",
    test: (n) =>
      n.id === "engine.schedule" ||
      n.id === "engine.fanout" ||
      n.id === "engine.evidence" ||
      n.id === "engine.state",
  },
  { band: "closing", test: (n) => n.kind === "stop" || n.kind === "engine" },
  { band: "sinks", test: (n) => n.kind === "sink" },
];

const BAND_META: readonly { id: string; title: string; blurb: string }[] = [
  {
    id: "arrival",
    title: "1 · Arrival",
    blurb:
      "A prompt enters an opencode session. Conductor is passive until one of six registered hooks fires — everything below hangs off these.",
  },
  {
    id: "init",
    title: "2 · Session init",
    blurb:
      "Doctrine loads before the workspace opens, and the workspace opens behind an OS-level single-writer lock. If this stalls, nothing downstream runs.",
  },
  {
    id: "inject",
    title: "3 · Doctrine injection (§6.4)",
    blurb:
      "The model is never trusted to remember the process. Its role's rules and the run's live position are re-stated on every single request.",
  },
  {
    id: "router",
    title: "4 · The router crossing",
    blurb:
      "Every model request crosses llama-router: tags read, structured output observed, admission control applied, then relayed to llama-server.",
  },
  {
    id: "gates",
    title: "5 · The gate stack",
    blurb:
      "The model answers with a tool call, and every call passes one choke point. Gates run in a fixed order; the first refusal wins.",
  },
  {
    id: "runfsm",
    title: "6 · The run FSM (§3.1)",
    blurb: "Eight forward-only positions. Two of them branch; everything else is a single gated edge.",
  },
  {
    id: "tools",
    title: "7 · The 22 tools (§3.4)",
    blurb:
      "The whole inventory. A tool with no row in the legality table is refused rather than run, so this set is closed by construction.",
  },
  {
    id: "itemfsm",
    title: "8 · The item FSM (§3.3)",
    blurb:
      "The TDD discipline as a state machine. Two chains share one tail: behavioral items must go red first, non-behavioral items skip to green.",
  },
  {
    id: "engines",
    title: "9 · The work engine",
    blurb:
      "What drives items between tool calls: wave computation, sub-session fan-out, and the evidence layer that actually runs the tests.",
  },
  {
    id: "closing",
    title: "10 · Closing and stops",
    blurb:
      "How a run ends, and who decides. One total closer maps six causes onto six stop kinds — and `done` is the hardest of them to reach.",
  },
  {
    id: "sinks",
    title: "11 · Where everything is written",
    blurb:
      "Every telemetry surface in the harness. This is the band to read before a live test — it says which file answers which question.",
  },
];

export function bandOf(node: AtlasNode): string {
  for (const rule of BAND_RULES) if (rule.test(node)) return rule.band;
  return "closing";
}

export function bandsOf(nodes: readonly AtlasNode[]): Band[] {
  return BAND_META.map((meta) => ({
    ...meta,
    nodeIds: nodes.filter((n) => bandOf(n) === meta.id).map((n) => n.id),
  }));
}

export interface Adjacency {
  out: Record<string, readonly AtlasEdge[]>;
  in: Record<string, readonly AtlasEdge[]>;
}

export function adjacencyOf(edges: readonly AtlasEdge[]): Adjacency {
  const out: Record<string, AtlasEdge[]> = {};
  const inbound: Record<string, AtlasEdge[]> = {};
  for (const e of edges) {
    (out[e.from] ??= []).push(e);
    (inbound[e.to] ??= []).push(e);
  }
  return { out, in: inbound };
}

export interface LogIndexRow {
  component: string;
  event: string;
  level: string;
  nodeId: string;
  nodeLabel: string;
  means: string;
  emitted: boolean;
}

// Every journal event in the atlas, flattened and sorted — the grep index an
// operator reads while watching a live run.
export function logIndexOf(nodes: readonly AtlasNode[]): LogIndexRow[] {
  const rows: LogIndexRow[] = [];
  for (const n of nodes) {
    for (const l of n.logs ?? []) {
      rows.push({
        component: l.component,
        event: l.event,
        level: l.level,
        nodeId: n.id,
        nodeLabel: n.label,
        means: l.means,
        emitted: l.emitted !== false,
      });
    }
  }
  rows.sort((a, b) => a.component.localeCompare(b.component) || a.event.localeCompare(b.event));
  return rows;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// The page. Colors come from the repository's own design system
// (.claude/rules/diagrams/diagram-standards.md), which pins a warm-neutral
// palette against a #262B33 ground. That standard is dark-targeted, so this page
// commits to one visual world deliberately rather than deriving a second palette
// the project has never specified — and paints every color explicitly so it holds
// whatever ground it is rendered on.
// ---------------------------------------------------------------------------

const CSS = `
:root{
  --bg:#262B33; --surface:#2f343c; --card:#3a3f47; --card-hi:#454b54;
  --border:#565c65; --border-hi:#6a6f77;
  --ink:#C1C4CA; --ink-dim:#9096a0; --ink-mute:#767c86; --ink-hi:#EDEFF2;
  --blue:#779DC9; --blue-fill:#2b4268;
  --green:#8c9c81; --green-fill:#425f5f;
  --purple:#8983a5; --purple-fill:#4d4962;
  --amber:#c7c19b; --amber-fill:#7a7253;
  --red:#ac9696; --red-fill:#724848;
  --teal:#6d9c9c; --teal-fill:#2b5f5f;
  --tan:#c7ac9b; --tan-fill:#7a6253;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --sans:"IBM Plex Sans",system-ui,-apple-system,Segoe UI,sans-serif;
  --serif:"IBM Plex Serif",Georgia,serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}

/* ---- header ---- */
header{position:sticky;top:0;z-index:40;background:rgba(38,43,51,.94);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.hwrap{max-width:1500px;margin:0 auto;padding:14px 24px;display:flex;
  align-items:center;gap:20px;flex-wrap:wrap}
.brand{font-family:var(--serif);font-size:19px;color:var(--ink-hi);font-weight:600;
  letter-spacing:-.01em;white-space:nowrap}
.brand span{color:var(--ink-mute);font-family:var(--mono);font-size:12px;
  font-weight:400;letter-spacing:.04em;margin-left:10px}
.spacer{flex:1}
input[type=search]{background:var(--surface);border:1px solid var(--border);
  border-radius:6px;color:var(--ink);font-family:var(--mono);font-size:13px;
  padding:7px 12px;min-width:260px;outline:none}
input[type=search]:focus{border-color:var(--blue)}
input[type=search]::placeholder{color:var(--ink-mute)}
.tabs{display:flex;gap:2px;background:var(--surface);border:1px solid var(--border);
  border-radius:6px;padding:2px}
.tab{background:none;border:0;color:var(--ink-dim);font-family:var(--mono);
  font-size:12px;letter-spacing:.03em;padding:6px 14px;border-radius:4px;cursor:pointer}
.tab:hover{color:var(--ink)}
.tab[aria-selected=true]{background:var(--blue-fill);color:var(--ink-hi)}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.filt{background:var(--surface);border:1px solid var(--border);color:var(--ink-dim);
  font-family:var(--mono);font-size:11px;letter-spacing:.04em;padding:5px 11px;
  border-radius:999px;cursor:pointer;text-transform:uppercase}
.filt[aria-pressed=true]{color:var(--ink-hi)}
.filt[data-layer=opencode][aria-pressed=true]{background:var(--purple-fill);border-color:var(--purple)}
.filt[data-layer=conductor][aria-pressed=true]{background:var(--blue-fill);border-color:var(--blue)}
.filt[data-layer=router][aria-pressed=true]{background:var(--teal-fill);border-color:var(--teal)}
.filt[data-layer=workspace][aria-pressed=true]{background:var(--tan-fill);border-color:var(--tan)}

/* ---- layout ---- */
main{max-width:1500px;margin:0 auto;padding:28px 24px 120px}
.view[hidden]{display:none}
.lede{max-width:70ch;margin:0 0 34px;color:var(--ink-dim);font-size:15.5px}
.lede strong{color:var(--ink);font-weight:600}
.warn{border-left:3px solid var(--amber);background:rgba(122,114,83,.16);
  padding:13px 17px;border-radius:0 6px 6px 0;margin:0 0 34px;max-width:75ch;
  color:var(--ink-dim);font-size:14px}
.warn b{color:var(--amber);font-weight:600}

/* ---- bands ---- */
.band{margin:0 0 40px;scroll-margin-top:90px}
.band-h{display:flex;align-items:baseline;gap:14px;margin:0 0 4px;
  border-bottom:1px solid var(--border);padding-bottom:9px}
.band-h h2{font-family:var(--serif);font-size:20px;color:var(--ink-hi);margin:0;font-weight:600}
.band-n{font-family:var(--mono);font-size:11px;color:var(--ink-mute);margin-left:auto;white-space:nowrap}
.band-b{color:var(--ink-dim);font-size:14px;max-width:82ch;margin:9px 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:11px}

/* ---- node cards ---- */
.node{background:var(--card);border:1px solid var(--border);border-left-width:3px;
  border-radius:7px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;
  color:inherit;font:inherit;transition:background .12s,border-color .12s,transform .12s}
.node:hover{background:var(--card-hi);border-color:var(--border-hi);transform:translateY(-1px)}
.node:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.node[data-layer=opencode]{border-left-color:var(--purple)}
.node[data-layer=conductor]{border-left-color:var(--blue)}
.node[data-layer=router]{border-left-color:var(--teal)}
.node[data-layer=workspace]{border-left-color:var(--tan)}
.node[aria-current=true]{background:var(--blue-fill);border-color:var(--blue)}
.node.rel{border-color:var(--amber)}
.node.dim{opacity:.26}
.node[hidden]{display:none}
.n-top{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.n-label{font-weight:600;color:var(--ink-hi);font-size:14px;line-height:1.35}
.n-what{color:var(--ink-dim);font-size:12.5px;line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.n-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}
.chip{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;
  padding:2px 7px;border-radius:3px;border:1px solid var(--border-hi);color:var(--ink-mute)}
.chip.gate{border-color:var(--amber);color:var(--amber)}
.chip.stop{border-color:var(--red);color:var(--red)}
.chip.sink{border-color:var(--tan);color:var(--tan)}
.chip.log{border-color:var(--green);color:var(--green)}
.chip.warnc{border-color:var(--amber);color:var(--amber)}

/* ---- graph view ---- */
#graphwrap{position:relative;border:1px solid var(--border);border-radius:9px;
  background:var(--surface);height:74vh;overflow:hidden;cursor:grab}
#graphwrap.drag{cursor:grabbing}
#gsvg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
.gnode rect{stroke-width:1.5px}
.gnode text{font-family:var(--mono);font-size:10px;fill:var(--ink-hi);pointer-events:none}
.gnode{cursor:pointer}
.gnode.dim{opacity:.15}
.gedge{fill:none;stroke:var(--ink-mute);stroke-width:1.1px;opacity:.42}
.gedge.hot{stroke:var(--amber);stroke-width:2px;opacity:1}
.gedge.dim{opacity:.05}
.ghint{position:absolute;left:14px;bottom:12px;font-family:var(--mono);font-size:11px;
  color:var(--ink-mute);background:rgba(38,43,51,.86);padding:6px 11px;border-radius:5px;
  border:1px solid var(--border)}
.zoom{position:absolute;right:14px;bottom:12px;display:flex;gap:5px}
.zoom button{width:30px;height:30px;background:var(--card);border:1px solid var(--border);
  color:var(--ink);border-radius:5px;cursor:pointer;font-family:var(--mono);font-size:15px;line-height:1}
.zoom button:hover{background:var(--card-hi)}

/* ---- log index ---- */
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.07em;
  text-transform:uppercase;color:var(--ink-mute);padding:9px 11px;
  border-bottom:1px solid var(--border-hi);position:sticky;top:66px;background:var(--bg);z-index:5}
td{padding:10px 11px;border-bottom:1px solid var(--border);vertical-align:top}
tr:hover td{background:var(--surface)}
tr[hidden]{display:none}
code,.mono{font-family:var(--mono);font-size:12px}
td .ev{color:var(--ink-hi);white-space:nowrap}
.lvl{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;
  padding:2px 7px;border-radius:3px;border:1px solid;white-space:nowrap}
.lvl.error{color:var(--red);border-color:var(--red)}
.lvl.warn{color:var(--amber);border-color:var(--amber)}
.lvl.info{color:var(--blue);border-color:var(--blue)}
.lvl.debug{color:var(--ink-mute);border-color:var(--border-hi)}
.lvl.trace{color:var(--ink-mute);border-color:var(--border-hi)}
.never{color:var(--red);font-family:var(--mono);font-size:10px;letter-spacing:.05em}
.tblwrap{overflow-x:auto}

/* ---- detail drawer ---- */
#drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,94vw);background:var(--surface);
  border-left:1px solid var(--border-hi);z-index:60;overflow-y:auto;
  transform:translateX(100%);transition:transform .2s ease;box-shadow:-18px 0 46px rgba(0,0,0,.42)}
#drawer.open{transform:none}
.d-head{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--border);
  padding:18px 22px 14px;z-index:2}
.d-head h3{font-family:var(--serif);font-size:20px;color:var(--ink-hi);margin:0 0 8px;
  padding-right:36px;line-height:1.3}
.d-close{position:absolute;top:16px;right:18px;background:none;border:0;color:var(--ink-mute);
  font-size:24px;cursor:pointer;line-height:1;padding:2px 6px;border-radius:4px}
.d-close:hover{color:var(--ink-hi);background:var(--card)}
.d-body{padding:18px 22px 60px}
.sec{margin:0 0 22px}
.sec h4{font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute);margin:0 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)}
.sec p{margin:0 0 9px;font-size:14px;color:var(--ink);line-height:1.62}
.enf{border-left:3px solid var(--green);background:rgba(66,95,95,.2);padding:11px 15px;
  border-radius:0 5px 5px 0;font-size:13.5px;color:var(--ink-dim)}
.cav{border-left:3px solid var(--amber);background:rgba(122,114,83,.17);padding:11px 15px;
  border-radius:0 5px 5px 0;font-size:13.5px;color:var(--ink-dim)}
.fork{border:1px solid var(--border);border-radius:6px;padding:10px 13px;margin:0 0 8px;
  background:var(--card);border-left-width:3px}
.fork.allow,.fork.advance{border-left-color:var(--green)}
.fork.deny{border-left-color:var(--red)}
.fork.hold{border-left-color:var(--amber)}
.fork.fail{border-left-color:var(--red)}
.fork-w{font-size:13px;color:var(--ink-hi);font-weight:600;margin-bottom:4px}
.fork-e{font-size:12.5px;color:var(--ink-dim);font-family:var(--mono);line-height:1.55}
.fork-to{font-family:var(--mono);font-size:11px;color:var(--blue);margin-top:6px;
  background:none;border:0;padding:0;cursor:pointer;text-align:left}
.fork-to:hover{text-decoration:underline}
.logrow{border:1px solid var(--border);border-radius:6px;padding:10px 13px;margin:0 0 8px;background:var(--card)}
.logrow .ev{font-family:var(--mono);font-size:12.5px;color:var(--ink-hi)}
.logrow p{font-size:12.5px;color:var(--ink-dim);margin:6px 0 0;line-height:1.55}
.srcs{display:flex;flex-direction:column;gap:5px}
.srcs code{color:var(--blue);font-size:11.5px}
.links{display:flex;flex-wrap:wrap;gap:6px}
.lk{background:var(--card);border:1px solid var(--border);border-radius:5px;
  font-family:var(--mono);font-size:11px;color:var(--ink-dim);padding:5px 10px;cursor:pointer}
.lk:hover{border-color:var(--blue);color:var(--ink-hi)}
.lk em{color:var(--ink-mute);font-style:normal}
#scrim{position:fixed;inset:0;background:rgba(20,23,28,.55);z-index:55;opacity:0;
  pointer-events:none;transition:opacity .2s}
#scrim.open{opacity:1;pointer-events:auto}
.empty{color:var(--ink-mute);font-family:var(--mono);font-size:13px;padding:34px 0;text-align:center}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}
  html{scroll-behavior:auto}}
`;

const JS = `
const $=(s,r)=>(r||document).querySelector(s), $$=(s,r)=>[...(r||document).querySelectorAll(s)];
const NODES=DATA.nodes, EDGES=DATA.edges;
const BY_ID=Object.fromEntries(NODES.map(n=>[n.id,n]));
const OUT={},IN={};
for(const e of EDGES){(OUT[e.from]=OUT[e.from]||[]).push(e);(IN[e.to]=IN[e.to]||[]).push(e);}

let selected=null;
const layersOff=new Set();

/* ---------- graph layout: BFS depth from the entry node ---------- */
function layout(){
  const depth={}; const q=['entry.prompt']; depth['entry.prompt']=0;
  while(q.length){const id=q.shift();
    for(const e of (OUT[id]||[])){ if(depth[e.to]===undefined){depth[e.to]=depth[id]+1;q.push(e.to);} }}
  let max=0; for(const id in depth) max=Math.max(max,depth[id]);
  for(const n of NODES) if(depth[n.id]===undefined) depth[n.id]=max+1;

  const cols={};
  for(const n of NODES){(cols[depth[n.id]]=cols[depth[n.id]]||[]).push(n);}
  const CW=210, RH=46, PAD=40;
  const pos={}; let height=0;
  for(const d of Object.keys(cols).map(Number).sort((a,b)=>a-b)){
    const list=cols[d].sort((a,b)=>a.layer.localeCompare(b.layer)||a.id.localeCompare(b.id));
    list.forEach((n,i)=>{ pos[n.id]={x:PAD+d*CW, y:PAD+i*RH, w:180, h:30}; });
    height=Math.max(height,PAD+list.length*RH);
  }
  return {pos,width:PAD*2+(Object.keys(cols).length)*CW,height:height+PAD};
}

const LAYER_FILL={opencode:'var(--purple-fill)',conductor:'var(--blue-fill)',
  router:'var(--teal-fill)',workspace:'var(--tan-fill)'};
const LAYER_STROKE={opencode:'var(--purple)',conductor:'var(--blue)',
  router:'var(--teal)',workspace:'var(--tan)'};

function renderGraph(){
  const {pos,width,height}=layout();
  const svg=$('#gsvg');
  const parts=['<g id="gpan">'];
  for(const e of EDGES){
    const a=pos[e.from],b=pos[e.to]; if(!a||!b)continue;
    const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2;
    const mx=(x1+x2)/2;
    parts.push('<path class="gedge" data-from="'+e.from+'" data-to="'+e.to+'" d="M'+x1+','+y1+
      ' C'+mx+','+y1+' '+mx+','+y2+' '+x2+','+y2+'"/>');
  }
  for(const n of NODES){
    const p=pos[n.id]; if(!p)continue;
    const label=n.label.length>26?n.label.slice(0,25)+'…':n.label;
    parts.push('<g class="gnode" data-id="'+n.id+'" data-layer="'+n.layer+'" transform="translate('+p.x+','+p.y+')">'+
      '<rect width="'+p.w+'" height="'+p.h+'" rx="5" fill="'+LAYER_FILL[n.layer]+'" stroke="'+LAYER_STROKE[n.layer]+'"/>'+
      '<text x="9" y="19">'+esc(label)+'</text></g>');
  }
  parts.push('</g>');
  svg.innerHTML=parts.join('');
  svg.setAttribute('viewBox','0 0 '+width+' '+height);
  $$('.gnode',svg).forEach(g=>g.addEventListener('click',()=>select(g.dataset.id)));
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ---------- pan + zoom ---------- */
let vb=null;
function initPanZoom(){
  const wrap=$('#graphwrap'), svg=$('#gsvg');
  const read=()=>svg.getAttribute('viewBox').split(' ').map(Number);
  const write=v=>svg.setAttribute('viewBox',v.join(' '));
  let drag=null;
  wrap.addEventListener('pointerdown',e=>{ if(e.target.closest('.gnode'))return;
    drag={x:e.clientX,y:e.clientY,vb:read()}; wrap.classList.add('drag'); wrap.setPointerCapture(e.pointerId);});
  wrap.addEventListener('pointermove',e=>{ if(!drag)return;
    const v=[...drag.vb], k=v[2]/wrap.clientWidth;
    write([v[0]-(e.clientX-drag.x)*k, v[1]-(e.clientY-drag.y)*k, v[2], v[3]]);});
  const stop=e=>{drag=null;wrap.classList.remove('drag');};
  wrap.addEventListener('pointerup',stop); wrap.addEventListener('pointercancel',stop);
  wrap.addEventListener('wheel',e=>{e.preventDefault();
    const v=read(), f=e.deltaY>0?1.12:0.89;
    const r=wrap.getBoundingClientRect();
    const px=v[0]+(e.clientX-r.left)/r.width*v[2], py=v[1]+(e.clientY-r.top)/r.height*v[3];
    write([px-(px-v[0])*f, py-(py-v[1])*f, v[2]*f, v[3]*f]);},{passive:false});
  $('#zin').addEventListener('click',()=>{const v=read();write([v[0],v[1],v[2]*.82,v[3]*.82]);});
  $('#zout').addEventListener('click',()=>{const v=read();write([v[0],v[1],v[2]*1.22,v[3]*1.22]);});
  $('#zfit').addEventListener('click',()=>{ if(vb) write(vb); });
  vb=read();
}

/* ---------- selection ---------- */
function select(id){
  selected=id; const n=BY_ID[id]; if(!n)return;
  const rel=new Set([id]);
  for(const e of (OUT[id]||[])) rel.add(e.to);
  for(const e of (IN[id]||[])) rel.add(e.from);

  $$('.node').forEach(el=>{ el.setAttribute('aria-current',String(el.dataset.id===id));
    el.classList.toggle('rel', el.dataset.id!==id && rel.has(el.dataset.id));
    el.classList.toggle('dim', !rel.has(el.dataset.id)); });
  $$('.gnode').forEach(el=>el.classList.toggle('dim',!rel.has(el.dataset.id)));
  $$('.gedge').forEach(el=>{ const hot=el.dataset.from===id||el.dataset.to===id;
    el.classList.toggle('hot',hot); el.classList.toggle('dim',!hot); });

  drawer(n); 
}
function clearSel(){ selected=null;
  $$('.node').forEach(el=>{el.removeAttribute('aria-current');el.classList.remove('rel','dim');});
  $$('.gnode').forEach(el=>el.classList.remove('dim'));
  $$('.gedge').forEach(el=>el.classList.remove('hot','dim'));
  $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open');
}

function drawer(n){
  $('#d-title').textContent=n.label;
  const b=[];
  b.push('<div class="sec"><h4>What it does</h4><p>'+esc(n.what)+'</p></div>');
  if(n.enforces) b.push('<div class="sec"><h4>What it is for</h4><div class="enf">'+esc(n.enforces)+'</div></div>');
  if(n.forks&&n.forks.length){
    b.push('<div class="sec"><h4>Every way out ('+n.forks.length+')</h4>');
    for(const f of n.forks){
      b.push('<div class="fork '+f.outcome+'"><div class="fork-w">'+esc(f.when)+'</div>'+
        (f.effect?'<div class="fork-e">'+esc(f.effect)+'</div>':'')+
        (f.to?'<button class="fork-to" data-go="'+f.to+'">→ '+esc(BY_ID[f.to]?BY_ID[f.to].label:f.to)+'</button>':
             '<div class="fork-to" style="color:var(--ink-mute)">→ leaves the system</div>')+'</div>');
    }
    b.push('</div>');
  }
  if(n.logs&&n.logs.length){
    b.push('<div class="sec"><h4>What it writes to the journal</h4>');
    for(const l of n.logs){
      b.push('<div class="logrow"><span class="ev">'+esc(l.component)+' / '+esc(l.event)+'</span> '+
        '<span class="lvl '+l.level+'">'+l.level+'</span>'+
        (l.emitted===false?' <span class="never">NEVER EMITTED</span>':'')+
        '<p>'+esc(l.means)+'</p></div>');
    }
    b.push('</div>');
  }
  if(n.caveat) b.push('<div class="sec"><h4>Where it surprises you</h4><div class="cav">'+esc(n.caveat)+'</div></div>');
  const ins=(IN[n.id]||[]), outs=(OUT[n.id]||[]);
  if(ins.length){ b.push('<div class="sec"><h4>Reached from</h4><div class="links">'+
    ins.map(e=>'<button class="lk" data-go="'+e.from+'">'+esc(BY_ID[e.from]?BY_ID[e.from].label:e.from)+
      (e.label?' <em>· '+esc(e.label)+'</em>':'')+'</button>').join('')+'</div></div>'); }
  if(outs.length){ b.push('<div class="sec"><h4>Leads to</h4><div class="links">'+
    outs.map(e=>'<button class="lk" data-go="'+e.to+'">'+esc(BY_ID[e.to]?BY_ID[e.to].label:e.to)+
      (e.label?' <em>· '+esc(e.label)+'</em>':'')+'</button>').join('')+'</div></div>'); }
  b.push('<div class="sec"><h4>In the code</h4><div class="srcs">'+
    n.source.map(s=>'<code>'+esc(s)+'</code>').join('')+'</div></div>');
  $('#d-body').innerHTML=b.join('');
  $$('#d-body [data-go]').forEach(el=>el.addEventListener('click',()=>select(el.dataset.go)));
  $('#d-body').scrollTop=0;
  $('#drawer').classList.add('open'); $('#scrim').classList.add('open');
}

/* ---------- search + filters ---------- */
function applyFilters(){
  const q=$('#q').value.trim().toLowerCase();
  let shown=0;
  for(const el of $$('.node')){
    const n=BY_ID[el.dataset.id];
    const okLayer=!layersOff.has(n.layer);
    const hay=(n.label+' '+n.id+' '+n.what+' '+(n.enforces||'')+' '+(n.caveat||'')+' '+
      n.source.join(' ')+' '+(n.logs||[]).map(l=>l.component+'/'+l.event+' '+l.means).join(' ')+' '+
      (n.forks||[]).map(f=>f.when+' '+(f.effect||'')).join(' ')).toLowerCase();
    const okQ=!q||hay.includes(q);
    el.hidden=!(okLayer&&okQ); if(!el.hidden)shown++;
  }
  for(const band of $$('.band')){
    const vis=$$('.node',band).filter(e=>!e.hidden).length;
    band.hidden=vis===0;
    const c=$('.band-n',band); if(c)c.textContent=vis+(vis===1?' node':' nodes');
  }
  $('#noresults').hidden=shown>0;
  for(const tr of $$('#logtable tbody tr')){
    const hay=tr.textContent.toLowerCase();
    tr.hidden=!!q&&!hay.includes(q);
  }
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded',()=>{
  $$('.node').forEach(el=>el.addEventListener('click',()=>select(el.dataset.id)));
  $('#q').addEventListener('input',applyFilters);
  $$('.filt').forEach(b=>b.addEventListener('click',()=>{
    const l=b.dataset.layer, on=b.getAttribute('aria-pressed')==='true';
    b.setAttribute('aria-pressed',String(!on));
    if(on)layersOff.add(l); else layersOff.delete(l);
    applyFilters();
  }));
  $$('.tab').forEach(t=>t.addEventListener('click',()=>{
    $$('.tab').forEach(x=>x.setAttribute('aria-selected',String(x===t)));
    $$('.view').forEach(v=>v.hidden=v.id!==('view-'+t.dataset.view));
    if(t.dataset.view==='graph'&&!$('#gsvg').innerHTML){renderGraph();initPanZoom();}
  }));
  $('#d-close').addEventListener('click',clearSel);
  $('#scrim').addEventListener('click',clearSel);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')clearSel();
    if(e.key==='/'&&document.activeElement!==$('#q')){e.preventDefault();$('#q').focus();}
  });
  $$('#logtable [data-go]').forEach(el=>el.addEventListener('click',()=>select(el.dataset.go)));
});
`;

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

const KIND_CHIP: Record<string, string> = {
  gate: "gate",
  stop: "stop",
  sink: "sink",
  hatch: "gate",
};

function nodeCard(n: AtlasNode): string {
  const chips: string[] = [`<span class="chip ${KIND_CHIP[n.kind] ?? ""}">${esc(n.kind)}</span>`];
  const logCount = (n.logs ?? []).length;
  if (logCount > 0) chips.push(`<span class="chip log">${logCount} log${logCount === 1 ? "" : "s"}</span>`);
  const forkCount = (n.forks ?? []).length;
  if (forkCount > 0) chips.push(`<span class="chip">${forkCount} forks</span>`);
  if (n.caveat !== undefined) chips.push(`<span class="chip warnc">caveat</span>`);
  return (
    `<button class="node" data-id="${esc(n.id)}" data-layer="${esc(n.layer)}">` +
    `<div class="n-top"><span class="n-label">${esc(n.label)}</span></div>` +
    `<div class="n-what">${esc(n.what)}</div>` +
    `<div class="n-meta">${chips.join("")}</div>` +
    `</button>`
  );
}

function logTable(rows: readonly LogIndexRow[]): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td class="ev"><code>${esc(r.component)} / ${esc(r.event)}</code>` +
        (r.emitted ? "" : ` <span class="never">NEVER EMITTED</span>`) +
        `</td><td><span class="lvl ${esc(r.level)}">${esc(r.level)}</span></td>` +
        `<td><button class="lk" data-go="${esc(r.nodeId)}">${esc(r.nodeLabel)}</button></td>` +
        `<td>${esc(r.means)}</td></tr>`,
    )
    .join("");
  return (
    `<div class="tblwrap"><table id="logtable"><thead><tr>` +
    `<th style="width:22%">component / event</th><th style="width:8%">level</th>` +
    `<th style="width:20%">emitted by</th><th>what it means when you see it</th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>`
  );
}

export function renderAtlasHtml(): string {
  const nodes = ATLAS.nodes;
  const bands = bandsOf(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rows = logIndexOf(nodes);
  const emitted = rows.filter((r) => r.emitted).length;

  const bandHtml = bands
    .map((b) => {
      const cards = b.nodeIds
        .map((id) => byId.get(id))
        .filter((n): n is AtlasNode => n !== undefined)
        .map(nodeCard)
        .join("");
      return (
        `<section class="band" id="band-${esc(b.id)}">` +
        `<div class="band-h"><h2>${esc(b.title)}</h2>` +
        `<span class="band-n">${b.nodeIds.length} nodes</span></div>` +
        `<p class="band-b">${esc(b.blurb)}</p>` +
        `<div class="grid">${cards}</div></section>`
      );
    })
    .join("");

  const data = JSON.stringify({ nodes, edges: ATLAS.edges }).replace(/</g, "\\u003c");

  return `<title>Conductor Prompt Atlas</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@600&display=swap">
<style>${CSS}</style>

<header><div class="hwrap">
  <div class="brand">Conductor Prompt Atlas <span>${nodes.length} NODES · ${ATLAS.edges.length} EDGES</span></div>
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-view="map" aria-selected="true">Map</button>
    <button class="tab" role="tab" data-view="graph" aria-selected="false">Graph</button>
    <button class="tab" role="tab" data-view="logs" aria-selected="false">Log index</button>
  </div>
  <div class="spacer"></div>
  <div class="filters">
    <button class="filt" data-layer="opencode" aria-pressed="true">opencode</button>
    <button class="filt" data-layer="conductor" aria-pressed="true">conductor</button>
    <button class="filt" data-layer="router" aria-pressed="true">router</button>
    <button class="filt" data-layer="workspace" aria-pressed="true">workspace</button>
  </div>
  <input type="search" id="q" placeholder="Search everything  ( / )" aria-label="Search the atlas">
</div></header>

<main>
  <section class="view" id="view-map">
    <p class="lede">Everything that happens to a prompt between the moment you press enter in opencode and the
    moment work lands in your workspace — <strong>every gate, every fork, every log line</strong>, in the order
    it happens. Click any node for what it does, what it is there to prevent, how it can refuse you, what it
    writes to the journal, and where it lives in the code.</p>
    <div class="warn"><b>Read this as a specification, not a recording.</b> Every claim below is pinned to the
    code by <code>conductor/tests/atlas.test.ts</code>, which fails if a tool, state, stop kind, hook or journal
    event exists without a node here. But task 13.2 — the live smoke — has not been run, so no path on this page
    has been observed end to end against a live model. Nodes carrying a <b>caveat</b> chip are the places the
    code is known to depart from the obvious reading; read those first.</div>
    ${bandHtml}
    <p class="empty" id="noresults" hidden>Nothing matches that search.</p>
  </section>

  <section class="view" id="view-graph" hidden>
    <p class="lede">The same ${nodes.length} nodes as a directed graph, laid out left to right by distance from
    the arriving prompt. Drag to pan, scroll to zoom, click a node to trace its neighbourhood.</p>
    <div id="graphwrap">
      <svg id="gsvg" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="ghint">drag to pan · scroll to zoom · click to trace</div>
      <div class="zoom"><button id="zout" title="Zoom out">−</button><button id="zfit" title="Fit">▣</button><button id="zin" title="Zoom in">+</button></div>
    </div>
  </section>

  <section class="view" id="view-logs" hidden>
    <p class="lede">Every record conductor can write, what it means, and which node writes it. The vocabulary is
    closed: an event not on this list cannot be logged, because the journal adapter checks each write against it.
    <strong>${emitted} of ${rows.length}</strong> log points are actually emitted by a call site — the rest are
    declared names no code writes, flagged so you never wait for one.</p>
    <div class="warn"><b>The default file level is <code>info</code>.</b> Debug and trace records are absent
    unless you raise it: <code>CONDUCTOR_LOG=trace</code>, or per component as
    <code>CONDUCTOR_LOG=gates:debug,fanout:trace</code>. <code>error</code> and <code>warn</code> are always
    written regardless. An unknown level in that variable is ignored rather than allowed to silence a component
    by typo.</div>
    ${logTable(rows)}
  </section>
</main>

<div id="scrim"></div>
<aside id="drawer" aria-label="Node detail">
  <div class="d-head"><h3 id="d-title"></h3><button class="d-close" id="d-close" aria-label="Close">×</button></div>
  <div class="d-body" id="d-body"></div>
</aside>

<script>const DATA=${data};${JS}</script>
`;
}

// ---------------------------------------------------------------------------
// argv shell — runs only when this file is the entry point
// ---------------------------------------------------------------------------

const isEntry = process.argv[1] !== undefined && process.argv[1].endsWith("build-atlas.ts");
if (isEntry) {
  const out = process.argv[2] ?? "docs/atlas.html";
  writeFileSync(out, renderAtlasHtml(), "utf8");
  const rows = logIndexOf(ATLAS.nodes);
  process.stdout.write(
    `wrote ${out}\n` +
      `  nodes=${ATLAS.nodes.length} edges=${ATLAS.edges.length} ` +
      `logPoints=${rows.length} (emitted=${rows.filter((r) => r.emitted).length})\n`,
  );
}
