/**
 * "Forecast vs Plan" report for a Notion embed:
 *   • Two coverage KPI cards (current quarter + next) on top — gap to target on the
 *     left, Coverage % / Closed % on the right — each expandable to that quarter's
 *     coverage glidepath (weighted pipeline + closed vs target, by weeks to close).
 *   • A stacked weighted-forecast-vs-target bar chart below, over a rolling window
 *     (2 prior quarters + current + next) with a "Next 2 / Next 4" toggle. Each bar
 *     is coloured by its quarter: the current quarter matches the first KPI card
 *     (blue), the next matches the second (teal); every other quarter is grey.
 * No headings, prose, or table. Brand fonts. Charts are built by inline JS.
 */

import type { PlanRow } from "./planVsPipeline.js";
import type { GlideSeries } from "./glidepath.js";
import { BRAND_FONTS } from "./brandFonts.js";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const qid = (q: string) => q.replace(/\./g, "_");
const tlabel = (t: number) => `$${(t / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}M`;

function quarterEnd(q: string): Date | null {
  const m = /(\d{4})\.Q([1-4])/.exec(q);
  if (!m) return null;
  const endMonth0 = [2, 5, 8, 11][Number(m[2]) - 1]!;
  return new Date(Date.UTC(Number(m[1]), endMonth0 + 1, 0));
}
function weeksToEnd(q: string): number | null {
  const e = quarterEnd(q);
  return e ? Math.round((e.getTime() - Date.now()) / (7 * 864e5)) : null;
}

const CUR = "#2424FC";
const NXT = "#0D9488";

export function renderPlanHtml(rows: PlanRow[], meta: { asOf: string; nowQuarter?: string }, glide: GlideSeries[] = []): string {
  const data = rows.map((r) => {
    const tot = r.signed + r.contW + r.newW;
    return { q: r.q, t: r.target, s: r.signed, cw: r.contW, nw: r.newW, tot, gap: tot - r.target, pc: (tot / (r.target || 1)) * 100 };
  });
  const nowIdx = meta.nowQuarter ? rows.findIndex((r) => r.q === meta.nowQuarter) : -1;

  // Per-quarter glidepath series for the KPI charts (current = blue, next = teal).
  const GLIDE = glide
    .filter((s) => s.points.length > 1)
    .map((s, k) => {
      const maxWte = Math.max(...s.points.map((p) => p.wte), 4);
      return {
        quarter: s.quarter,
        color: k === 0 ? CUR : NXT,
        tlabel: tlabel(s.target),
        target: s.target,
        ymax: Math.ceil((s.target * 1.2) / 5e5) * 5e5,
        xmax: Math.ceil(maxWte / 4) * 4,
        points: s.points.map((p) => ({ w: p.wte, c: p.cov, x: p.closed, d: p.date })),
      };
    });
  const hasChart = new Set(GLIDE.map((g) => g.quarter));

  function kpi(i: number, color: string): string {
    if (i < 0 || i >= data.length) return "";
    const d = data[i]!;
    const cov = Math.round(d.pc);
    const closed = Math.round((d.s / (d.t || 1)) * 100);
    const wte = weeksToEnd(d.q);
    const when = wte == null ? "" : wte <= 0 ? "closing now" : wte <= 14 ? `${wte} weeks to close` : `~${Math.round(wte / 13)} quarter${wte > 19 ? "s" : ""} out`;
    const chart = hasChart.has(d.q);
    const chev = chart
      ? `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
      : "";
    const summary = `<div class="ktop"><span class="kdot" style="background:${color}"></span>${esc(d.q)}<span class="kwhen">${when}</span>${chev}</div>
      <div class="krow">
        <div class="kgap"><span class="kn ${d.gap < 0 ? "neg" : "pos"}">${d.gap < 0 ? "−" : "+"}${money(Math.abs(d.gap))}</span><span class="kk">Coverage Gap</span></div>
        <div class="kmetrics">
          <div class="km"><span class="kn">${cov}%</span><span class="kk">Coverage</span></div>
          <div class="km"><span class="kn">${closed}%</span><span class="kk">Closed</span></div>
        </div>
      </div>`;
    if (!chart) return `<div class="kpi">${summary}</div>`;
    return `<details class="kpi"><summary class="ksum">${summary}</summary>
      <div class="kbody">
        <div class="glegend"><span><i class="gl" style="border-top:2.5px solid ${color}"></i>Closed (won)</span><span><i class="gl" style="border-top:2.5px dashed ${color}"></i>Weighted pipeline</span><span><i class="gl" style="border-top:2px dashed #64748B"></i>Target</span></div>
        <div class="gchart" id="g-${qid(d.q)}"></div>
      </div></details>`;
  }
  const kpis = kpi(nowIdx, CUR) + kpi(nowIdx + 1, NXT);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forecast vs Plan</title>
<style>
${BRAND_FONTS}
  :root{
    --surface:#FFFFFF; --panel:#FbFbFd; --panel-hover:#F4F5F9; --ink:#1E293B; --ink-2:#64748B; --ink-3:#94A3B8;
    --hair:#E2E8F0; --hair-strong:#CBD5E1; --brand:#2424FC; --grid:#E9EDF3; --axis:#CBD5E1;
    --good-ink:#046904; --warn-ink:#8A5A00; --crit-ink:#B02525;
    --font:"NB International Pro","Helvetica Neue",Arial,sans-serif; --book:"NB Book","Helvetica Neue",Arial,sans-serif; --mono:"NB Mono","SFMono-Regular",Menlo,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto;padding:18px}
  /* KPI cards */
  .kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .kpi{border:1px solid var(--hair);border-radius:4px;background:var(--panel);overflow:hidden}
  details.kpi[open]{background:var(--surface)}
  .ksum,.kpi>.ktop{list-style:none}
  summary.ksum{list-style:none;cursor:pointer;padding:15px 16px;outline:none;display:block}
  summary.ksum::-webkit-details-marker{display:none}
  summary.ksum:hover{background:var(--panel-hover)}
  details.kpi[open] summary.ksum:hover{background:transparent}
  summary.ksum:focus-visible{box-shadow:inset 0 0 0 2px var(--brand)}
  div.kpi{padding:15px 16px}
  .ktop{display:flex;align-items:center;gap:9px;font-family:var(--book);font-size:13px;color:var(--ink)}
  .kdot{width:10px;height:10px;border-radius:2px;flex:0 0 auto}
  .kwhen{margin-left:auto;font-size:11.5px;color:var(--ink-3)}
  .chev{width:15px;height:15px;color:var(--ink-3);transition:transform .18s ease;flex:0 0 auto;margin-left:10px}
  details.kpi[open] .chev{transform:rotate(180deg)}
  .krow{display:flex;gap:16px;margin-top:12px;align-items:baseline}
  .kmetrics{display:flex;gap:22px;margin-left:auto;align-items:baseline}
  .km .kn,.kmetrics .kn{font-size:29px}
  .kn{font-family:var(--mono);font-variant-numeric:tabular-nums;line-height:1;letter-spacing:-.5px}
  .kk{display:block;font-family:var(--book);text-transform:uppercase;letter-spacing:1.2px;font-size:9px;color:var(--ink-3);margin-top:6px}
  .kgap .kn{font-size:23px}
  .kn.neg{color:var(--crit-ink)} .kn.pos{color:var(--good-ink)}
  .kbody{border-top:1px solid var(--hair);padding:12px 14px 6px}
  .glegend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px;font-size:11px;color:var(--ink-2)}
  .glegend span{display:flex;align-items:center;gap:6px}
  .gl{width:16px;height:0;border-top-width:2.5px;flex:0 0 auto}
  .gchart{overflow-x:auto}
  .gchart svg{width:100%;height:auto;display:block;min-width:440px}
  /* Chart card */
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:4px;padding:14px 16px 12px;margin-top:14px}
  .card-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:8px}
  .seg{display:inline-flex;border:1px solid var(--hair-strong);border-radius:20px;overflow:hidden}
  .seg button{appearance:none;border:0;background:transparent;color:var(--ink-2);font-family:var(--book);font-size:12px;padding:5px 13px;cursor:pointer}
  .seg button.on{background:var(--brand);color:#fff}
  .seg button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
  .asof{font-size:12px;color:var(--ink-3)}
  .legend{display:flex;gap:15px;flex-wrap:wrap;margin:4px 0 4px;font-size:11.5px;color:var(--ink-2)}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:2px;flex:0 0 auto}
  .line{width:15px;height:0;border-top:2px solid var(--ink)}
  .chart{overflow-x:auto}
  .chart svg{max-width:100%;height:auto;display:block}
  .tt{position:fixed;z-index:80;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--surface);border:1px solid var(--hair-strong);border-radius:3px;box-shadow:0 8px 26px rgba(15,23,42,.14);padding:10px 12px;font-size:12px;min-width:180px}
  .tt.on{opacity:1}
  .tt-h{font-family:var(--book);font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
  .tt-r{display:flex;align-items:center;gap:8px;justify-content:space-between;line-height:1.7}
  .tt-r .l{display:flex;align-items:center;gap:7px;color:var(--ink-2)}
  .tt-r .v{font-family:var(--mono);color:var(--ink)}
  .tt-r .sw{width:9px;height:9px;border-radius:2px}
  @media(max-width:560px){.kpis{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <div class="kpis">${kpis}</div>
  <div class="card">
    <div class="card-head">
      <div class="seg" role="group" aria-label="Forecast horizon">
        <button id="b2" class="on" type="button">Next 2 Qtrs</button>
        <button id="b4" type="button">Next 4 Qtrs</button>
      </div>
      <span class="asof">USD &middot; as of ${esc(meta.asOf)}</span>
    </div>
    <div class="legend">
      <span><i class="sw" style="background:#64748B"></i>Signed (100%)</span>
      <span><i class="sw" style="background:#94A3B8"></i>Continuation, weighted</span>
      <span><i class="sw" style="background:#CBD5E1"></i>Net-new, weighted</span>
      <span><i class="line"></i>Target</span>
    </div>
    <div class="chart"><div id="c-plan"></div></div>
  </div>
</div>
<div class="tt" id="tt" role="status" aria-live="polite"></div>
<script>
(function(){
  var PLAN = ${JSON.stringify(data)};
  var NOWIDX = ${nowIdx};
  var GLIDE = ${JSON.stringify(GLIDE)};
  var NS="http://www.w3.org/2000/svg";
  function el(tag,a){var e=document.createElementNS(NS,tag);for(var k in a)e.setAttribute(k,a[k]);return e;}
  function usd(n){return "$"+Math.round(n).toLocaleString("en-US");}
  function usdS(n){var a=Math.abs(n);if(a>=1e6)return "$"+(n/1e6).toFixed(a%1e6?(a>=1e7?1:2):0).replace(/\\.?0+$/,"")+"M";if(a>=1e3)return "$"+Math.round(n/1e3)+"K";return "$"+Math.round(n);}
  var TT=document.getElementById("tt");
  function ttMove(ev){var pad=14,w=TT.offsetWidth,h=TT.offsetHeight,x=ev.clientX+pad,y=ev.clientY+pad;if(x+w>innerWidth)x=ev.clientX-w-pad;if(y+h>innerHeight)y=ev.clientY-h-pad;TT.style.left=x+"px";TT.style.top=y+"px";}
  function ttShow(ev,html){TT.innerHTML=html;TT.classList.add("on");ttMove(ev);}
  function ttHide(){TT.classList.remove("on");}
  function row(sw,label,val){return '<div class="tt-r"><span class="l">'+(sw?'<i class="sw" style="background:'+sw+'"></i>':'')+label+'</span><span class="v">'+val+'</span></div>';}

  // ---- Plan bar chart (windowed) ----
  var BLUE=["#2424FC","#6E6EFD","#A3A3FE"], TEAL=["#0D9488","#59B3AB","#A7D8D2"], GREY=["#64748B","#94A3B8","#CBD5E1"];
  function windowFor(mode){
    var base=(NOWIDX<0?0:NOWIDX);
    var start=Math.max(0, base-2), end=Math.min(PLAN.length, base + (mode==="4"?4:2));
    return {rows:PLAN.slice(start,end), nowRel:NOWIDX-start};
  }
  function draw(mode){
    var host=document.getElementById("c-plan"); host.innerHTML="";
    var win=windowFor(mode), P=win.rows, nowRel=win.nowRel;
    function fam(i){return i===nowRel?BLUE:(i===nowRel+1?TEAL:GREY);}
    var W=1040,H=350,PL=58,PR=18,PT=30,PB=44,pw=W-PL-PR,ph=H-PT-PB;
    var band=pw/Math.max(P.length,1), bw=Math.min(60,band*0.52);
    var rawMax=Math.max.apply(null,P.map(function(p){return Math.max(p.t,p.tot);}).concat([5e5]));
    var YMAX=Math.ceil(rawMax/5e5)*5e5, y=function(v){return PT+ph-(v/YMAX)*ph;};
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H,width:W,role:"img","aria-label":"Weighted forecast vs target by quarter"});
    for(var g=0;g<=4;g++){var tv=YMAX*g/4;svg.appendChild(el("line",{x1:PL,x2:W-PR,y1:y(tv),y2:y(tv),stroke:g===0?"var(--axis)":"var(--grid)","stroke-width":g===0?1.3:1}));var yl=el("text",{x:PL-9,y:y(tv)+3.5,"text-anchor":"end",fill:"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});yl.textContent=g===0?"0":usdS(tv);svg.appendChild(yl);}
    if(nowRel>0){var nx=PL+band*nowRel;svg.appendChild(el("line",{x1:nx,x2:nx,y1:PT-8,y2:PT+ph,stroke:"var(--ink)","stroke-width":1.3,opacity:.4}));var nl=el("text",{x:nx+6,y:PT-12,fill:"var(--ink-2)","font-size":9.5,"font-family":'"NB Book",sans-serif'});nl.setAttribute("letter-spacing","1.4px");nl.textContent="NOW";svg.appendChild(nl);}
    var hl=el("rect",{x:PL,y:PT,width:band,height:ph,fill:"var(--brand)","fill-opacity":".06",opacity:0,"pointer-events":"none"});svg.appendChild(hl);
    P.forEach(function(p,i){
      var cx=PL+band*i+band/2, x=cx-bw/2, acc=0, cols=fam(i);
      [[cols[0],p.s],[cols[1],p.cw],[cols[2],p.nw]].forEach(function(sg){
        if(sg[1]<=0)return;var h=(sg[1]/YMAX)*ph;if(h<1.2)h=1.2;
        svg.appendChild(el("rect",{x:x,y:y(acc+sg[1]),width:bw,height:h,fill:sg[0]}));
        if(acc>0)svg.appendChild(el("rect",{x:x,y:y(acc+sg[1])+h-1,width:bw,height:2,fill:"var(--surface)"}));
        acc+=sg[1];
      });
      svg.appendChild(el("line",{x1:x-7,x2:x+bw+7,y1:y(p.t),y2:y(p.t),stroke:"var(--ink)","stroke-width":2.5}));
      var pl=el("text",{x:cx,y:y(p.tot)-8,"text-anchor":"middle",fill:p.pc>=95?"var(--good-ink)":(p.pc>=70?"var(--warn-ink)":"var(--crit-ink)"),"font-size":12,"font-family":'"NB Mono",monospace'});pl.textContent=Math.round(p.pc)+"%";svg.appendChild(pl);
      var lb=el("text",{x:cx,y:H-PB+18,"text-anchor":"middle",fill:i>=nowRel&&nowRel>=0?"var(--ink-2)":"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});lb.textContent=p.q;svg.appendChild(lb);
      var hit=el("rect",{x:PL+band*i,y:PT,width:band,height:ph,fill:"transparent",tabindex:0,role:"button","aria-label":p.q+" at "+Math.round(p.pc)+"% of target"});hit.style.cursor="crosshair";
      var html='<div class="tt-h">'+p.q+'</div>'+row(null,"<b>Target</b>","<b>"+usd(p.t)+"</b>")+row(cols[0],"Signed",usd(p.s))+(p.cw>0?row(cols[1],"Continuation",usd(p.cw)):"")+(p.nw>0?row(cols[2],"Net-new",usd(p.nw)):"")+row(null,"Weighted total",usd(p.tot))+row(null,p.gap<0?"<b>Gap</b>":"<b>Over plan</b>","<b>"+usd(Math.abs(p.gap))+"</b>")+row(null,"% of plan",Math.round(p.pc)+"%");
      hit.addEventListener("mouseenter",function(e){hl.setAttribute("x",PL+band*i);hl.setAttribute("opacity",1);ttShow(e,html);});
      hit.addEventListener("mousemove",ttMove);
      hit.addEventListener("mouseleave",function(){hl.setAttribute("opacity",0);ttHide();});
      hit.addEventListener("focus",function(){hl.setAttribute("x",PL+band*i);hl.setAttribute("opacity",1);var b=hit.getBoundingClientRect();ttShow({clientX:b.left+b.width/2,clientY:b.top+30},html);});
      hit.addEventListener("blur",function(){hl.setAttribute("opacity",0);ttHide();});
      svg.appendChild(hit);
    });
    host.appendChild(svg);
  }
  var b2=document.getElementById("b2"), b4=document.getElementById("b4");
  b2.addEventListener("click",function(){b2.classList.add("on");b4.classList.remove("on");draw("2");});
  b4.addEventListener("click",function(){b4.classList.add("on");b2.classList.remove("on");draw("4");});
  draw("2");

  // ---- Coverage glidepath (one per KPI card) ----
  function glide(host,q){
    var W=760,H=232,L=54,R=16,T=16,B=38,pw=W-L-R,ph=H-T-B,YMAX=q.ymax,XMAX=q.xmax,col=q.color,tgt=q.target;
    var x=function(w){return L+(XMAX-w)/XMAX*pw;}, y=function(v){return T+(1-v/YMAX)*ph;};
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":q.quarter+" coverage glidepath"});
    for(var gv=0;gv<=YMAX+1;gv+=5e5){svg.appendChild(el("line",{x1:L,x2:W-R,y1:y(gv),y2:y(gv),stroke:"var(--grid)","stroke-width":1}));var t=el("text",{x:L-8,y:y(gv)+3.5,"text-anchor":"end",fill:"var(--ink-3)","font-size":9.5,"font-family":'"NB Mono",monospace'});t.textContent=usdS(gv);svg.appendChild(t);}
    svg.appendChild(el("line",{x1:L,x2:W-R,y1:y(tgt),y2:y(tgt),stroke:"var(--ink-2)","stroke-width":1.5,"stroke-dasharray":"6 3"}));
    var tl=el("text",{x:W-R,y:y(tgt)-5,"text-anchor":"end",fill:"var(--ink-2)","font-size":9.5,"font-family":'"NB Book",sans-serif'});tl.setAttribute("letter-spacing","1px");tl.textContent="TARGET · "+q.tlabel;svg.appendChild(tl);
    for(var w=0;w<=XMAX+.01;w+=(XMAX<=16?2:4)){svg.appendChild(el("line",{x1:x(w),x2:x(w),y1:T,y2:T+ph,stroke:"var(--grid)","stroke-width":1}));var xt=el("text",{x:x(w),y:H-B+16,"text-anchor":"middle",fill:"var(--ink-3)","font-size":9.5,"font-family":'"NB Mono",monospace'});xt.textContent=w;svg.appendChild(xt);}
    var xl=el("text",{x:L,y:H-B+31,"text-anchor":"start",fill:"var(--ink-3)","font-size":9,"font-family":'"NB Book",sans-serif'});xl.setAttribute("letter-spacing","1px");xl.textContent="◄ WEEKS TO CLOSE";svg.appendChild(xl);
    function path(key){return q.points.map(function(p,i){return (i?"L":"M")+x(p.w).toFixed(1)+" "+y(p[key]*tgt).toFixed(1);}).join(" ");}
    svg.appendChild(el("path",{d:path("c"),fill:"none",stroke:col,"stroke-width":1.6,"stroke-dasharray":"4 3","stroke-opacity":.85,"stroke-linejoin":"round"}));
    svg.appendChild(el("path",{d:path("x"),fill:"none",stroke:col,"stroke-width":2.4,"stroke-linejoin":"round","stroke-linecap":"round"}));
    var last=q.points[q.points.length-1];
    svg.appendChild(el("circle",{cx:x(last.w),cy:y(last.x*tgt),r:4,fill:col,stroke:"var(--surface)","stroke-width":2}));
    var lb=el("text",{x:x(last.w),y:y(last.x*tgt)-8,fill:col,"font-size":11,"font-family":'"NB Mono",monospace',"font-weight":"600","text-anchor":"middle"});lb.textContent=usdS(last.x*tgt);svg.appendChild(lb);
    q.points.forEach(function(p){
      svg.appendChild(el("circle",{cx:x(p.w),cy:y(p.x*tgt),r:2.2,fill:col,"fill-opacity":.55}));
      var hit=el("circle",{cx:x(p.w),cy:y(p.x*tgt),r:11,fill:"transparent"});hit.style.cursor="crosshair";
      var html='<div class="tt-h">'+q.quarter+' · '+p.d+'</div>'+row(null,"Weeks out",p.w)+row(col,"Coverage",Math.round(p.c*100)+"% · "+usdS(p.c*tgt))+row(col,"Closed",Math.round(p.x*100)+"% · "+usdS(p.x*tgt))+row(null,"Target",q.tlabel);
      hit.addEventListener("mouseenter",function(e){ttShow(e,html);});
      hit.addEventListener("mousemove",ttMove);
      hit.addEventListener("mouseleave",ttHide);
      svg.appendChild(hit);
    });
    host.appendChild(svg);
  }
  GLIDE.forEach(function(q){var host=document.getElementById("g-"+q.quarter.replace(/\\./g,"_"));if(host)glide(host,q);});
})();
</script>
</body>
</html>`;
}
