/**
 * "Forecast vs Plan" report for a Notion embed: two coverage KPI cards (current
 * quarter + next) above a stacked weighted-forecast-vs-target bar chart. The chart
 * shows a rolling window — the two prior quarters plus the next two by default, with
 * a "Next 2 / Next 4" toggle that extends the future horizon. Weighted split into
 * Signed / Continuation / Net-new, with a target marker and a colour-coded % label.
 * No headings, prose, or table — just the numbers. Brand palette (blue s2/s3/s4),
 * NB fonts. The chart is (re)built by inline JS from an embedded data array.
 */

import type { PlanRow } from "./planVsPipeline.js";
import { BRAND_FONTS } from "./brandFonts.js";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Last calendar day of a "YYYY.Q#" quarter, UTC. */
function quarterEnd(q: string): Date | null {
  const m = /(\d{4})\.Q([1-4])/.exec(q);
  if (!m) return null;
  const endMonth0 = [2, 5, 8, 11][Number(m[2]) - 1]!; // Mar, Jun, Sep, Dec (0-based)
  return new Date(Date.UTC(Number(m[1]), endMonth0 + 1, 0));
}
function weeksToEnd(q: string): number | null {
  const e = quarterEnd(q);
  return e ? Math.round((e.getTime() - Date.now()) / (7 * 864e5)) : null;
}

export function renderPlanHtml(rows: PlanRow[], meta: { asOf: string; nowQuarter?: string }): string {
  const data = rows.map((r) => {
    const tot = r.signed + r.contW + r.newW;
    return { q: r.q, t: r.target, s: r.signed, cw: r.contW, nw: r.newW, tot, gap: tot - r.target, pc: (tot / (r.target || 1)) * 100 };
  });
  const nowIdx = meta.nowQuarter ? rows.findIndex((r) => r.q === meta.nowQuarter) : -1;

  // KPI card for a quarter index (current + next). Coverage = weighted ÷ target; Closed = signed ÷ target.
  function kpi(i: number, color: string): string {
    if (i < 0 || i >= data.length) return "";
    const d = data[i]!;
    const cov = Math.round(d.pc);
    const closed = Math.round((d.s / (d.t || 1)) * 100);
    const wte = weeksToEnd(d.q);
    const when = wte == null ? "" : wte <= 0 ? "closing now" : wte <= 14 ? `${wte} weeks to close` : `~${Math.round(wte / 13)} quarter${wte > 19 ? "s" : ""} out`;
    return `<div class="kpi">
      <div class="ktop"><span class="kdot" style="background:${color}"></span>${esc(d.q)}<span class="kwhen">${when}</span></div>
      <div class="krow">
        <div class="km"><span class="kn">${cov}%</span><span class="kk">Coverage</span></div>
        <div class="km"><span class="kn">${closed}%</span><span class="kk">Closed</span></div>
        <div class="kgap"><span class="kn ${d.gap < 0 ? "neg" : "pos"}">${d.gap < 0 ? "−" : "+"}${money(Math.abs(d.gap))}</span><span class="kk">gap to target</span></div>
      </div></div>`;
  }
  const kpis = kpi(nowIdx, "#2424FC") + kpi(nowIdx + 1, "#0D9488");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forecast vs Plan</title>
<style>
${BRAND_FONTS}
  :root{
    --surface:#FFFFFF; --panel:#FbFbFd; --ink:#1E293B; --ink-2:#64748B; --ink-3:#94A3B8;
    --hair:#E2E8F0; --hair-strong:#CBD5E1; --brand:#2424FC;
    --s2:#2424FC; --s3:#6E6EFD; --s4:#A3A3FE; --grid:#E9EDF3; --axis:#CBD5E1;
    --good-ink:#046904; --warn-ink:#8A5A00; --crit-ink:#B02525;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);font-family:"NB International Pro","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto;padding:20px}
  /* KPI cards */
  .kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .kpi{border:1px solid var(--hair);border-radius:4px;padding:15px 16px;background:var(--panel)}
  .ktop{display:flex;align-items:center;gap:9px;font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-size:13px;color:var(--ink)}
  .kdot{width:10px;height:10px;border-radius:2px;flex:0 0 auto}
  .kwhen{margin-left:auto;font-size:11.5px;color:var(--ink-3)}
  .krow{display:flex;gap:22px;margin-top:12px;align-items:baseline}
  .km .kn{font-family:"NB Mono","SFMono-Regular",Menlo,monospace;font-variant-numeric:tabular-nums;font-size:29px;line-height:1;letter-spacing:-.5px}
  .kn{font-family:"NB Mono","SFMono-Regular",Menlo,monospace}
  .kk{display:block;font-family:"NB Book","Helvetica Neue",Arial,sans-serif;text-transform:uppercase;letter-spacing:1.2px;font-size:9px;color:var(--ink-3);margin-top:6px}
  .kgap{margin-left:auto;text-align:right}
  .kgap .kn{font-size:17px}
  .kn.neg{color:var(--crit-ink)} .kn.pos{color:var(--good-ink)}
  /* Chart card */
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:4px;padding:16px 18px 14px;margin-top:14px}
  .card-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:8px}
  .seg{display:inline-flex;border:1px solid var(--hair-strong);border-radius:20px;overflow:hidden}
  .seg button{appearance:none;border:0;background:transparent;color:var(--ink-2);font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-size:12px;padding:5px 13px;cursor:pointer}
  .seg button.on{background:var(--brand);color:#fff}
  .seg button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
  .asof{font-size:12px;color:var(--ink-3)}
  .legend{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 4px;font-size:11.5px;color:var(--ink-2)}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:2px;flex:0 0 auto}
  .line{width:15px;height:0;border-top:2px solid var(--ink);border-radius:0}
  .chart{overflow-x:auto}
  .chart svg{max-width:100%;height:auto;display:block}
  .tt{position:fixed;z-index:80;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--surface);border:1px solid var(--hair-strong);border-radius:3px;box-shadow:0 8px 26px rgba(15,23,42,.14);padding:10px 12px;font-size:12px;min-width:190px}
  .tt.on{opacity:1}
  .tt-h{font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
  .tt-r{display:flex;align-items:center;gap:8px;justify-content:space-between;line-height:1.7}
  .tt-r .l{display:flex;align-items:center;gap:7px;color:var(--ink-2)}
  .tt-r .v{font-family:"NB Mono","SFMono-Regular",Menlo,monospace;color:var(--ink)}
  .tt-r .sw{width:9px;height:9px;border-radius:2px}
  @media(max-width:560px){.kpis{grid-template-columns:1fr}}
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
      <span><i class="sw" style="background:var(--s2)"></i>Signed (100%)</span>
      <span><i class="sw" style="background:var(--s3)"></i>Continuation, weighted</span>
      <span><i class="sw" style="background:var(--s4)"></i>Net-new, weighted</span>
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
  var NS="http://www.w3.org/2000/svg";
  function el(tag,attrs){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);return e;}
  function usd(n){return "$"+Math.round(n).toLocaleString("en-US");}
  function usdS(n){if(n>=1e6)return "$"+(n/1e6).toFixed(1)+"M";if(n>=1e3)return "$"+Math.round(n/1e3)+"K";return "$"+Math.round(n);}
  var TT=document.getElementById("tt");
  function ttMove(ev){var pad=14,w=TT.offsetWidth,h=TT.offsetHeight,x=ev.clientX+pad,y=ev.clientY+pad;if(x+w>innerWidth)x=ev.clientX-w-pad;if(y+h>innerHeight)y=ev.clientY-h-pad;TT.style.left=x+"px";TT.style.top=y+"px";}
  function ttShow(ev,html){TT.innerHTML=html;TT.classList.add("on");ttMove(ev);}
  function ttHide(){TT.classList.remove("on");}
  function row(sw,label,val){return '<div class="tt-r"><span class="l">'+(sw?'<i class="sw" style="background:'+sw+'"></i>':'')+label+'</span><span class="v">'+val+'</span></div>';}

  // Rolling window: the two prior quarters + the current one + N-1 future (N = 2 or 4).
  function windowFor(mode){
    var start=Math.max(0, NOWIDX-2);
    var end=Math.min(PLAN.length, (NOWIDX<0?PLAN.length:NOWIDX) + (mode==="4"?4:2));
    if(NOWIDX<0){start=0;end=Math.min(PLAN.length, mode==="4"?6:4);}
    return {rows:PLAN.slice(start,end), nowRel:NOWIDX-start};
  }

  function draw(mode){
    var host=document.getElementById("c-plan"); host.innerHTML="";
    var win=windowFor(mode), P=win.rows, nowRel=win.nowRel;
    var W=1040,H=360,PL=58,PR=18,PT=30,PB=46,pw=W-PL-PR,ph=H-PT-PB;
    var band=pw/Math.max(P.length,1), bw=Math.min(58,band*0.52);
    var rawMax=Math.max.apply(null,P.map(function(p){return Math.max(p.t,p.tot);}).concat([5e5]));
    var YMAX=Math.ceil(rawMax/5e5)*5e5, y=function(v){return PT+ph-(v/YMAX)*ph;};
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H,width:W,role:"img","aria-label":"Weighted forecast vs target by quarter"});

    for(var g=0;g<=4;g++){var tv=YMAX*g/4;svg.appendChild(el("line",{x1:PL,x2:W-PR,y1:y(tv),y2:y(tv),stroke:g===0?"var(--axis)":"var(--grid)","stroke-width":g===0?1.3:1}));var yl=el("text",{x:PL-9,y:y(tv)+3.5,"text-anchor":"end",fill:"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});yl.textContent=g===0?"0":usdS(tv);svg.appendChild(yl);}

    // NOW divider before the current quarter (if it's in view and not the first bar)
    if(nowRel>0){var nx=PL+band*nowRel;svg.appendChild(el("line",{x1:nx,x2:nx,y1:PT-8,y2:PT+ph,stroke:"var(--ink)","stroke-width":1.3,opacity:.4}));var nl=el("text",{x:nx+6,y:PT-12,fill:"var(--ink-2)","font-size":9.5,"font-family":'"NB Book",sans-serif'});nl.setAttribute("letter-spacing","1.4px");nl.textContent="NOW";svg.appendChild(nl);}

    var hl=el("rect",{x:PL,y:PT,width:band,height:ph,fill:"var(--brand)","fill-opacity":".06",opacity:0,"pointer-events":"none"});svg.appendChild(hl);

    P.forEach(function(p,i){
      var cx=PL+band*i+band/2, x=cx-bw/2, acc=0;
      [["var(--s2)",p.s],["var(--s3)",p.cw],["var(--s4)",p.nw]].forEach(function(sg){
        if(sg[1]<=0)return;var h=(sg[1]/YMAX)*ph;if(h<1.2)h=1.2;
        svg.appendChild(el("rect",{x:x,y:y(acc+sg[1]),width:bw,height:h,fill:sg[0]}));
        if(acc>0)svg.appendChild(el("rect",{x:x,y:y(acc+sg[1])+h-1,width:bw,height:2,fill:"var(--surface)"}));
        acc+=sg[1];
      });
      svg.appendChild(el("line",{x1:x-7,x2:x+bw+7,y1:y(p.t),y2:y(p.t),stroke:"var(--ink)","stroke-width":2.5}));
      var pl=el("text",{x:cx,y:y(p.tot)-8,"text-anchor":"middle",fill:p.pc>=95?"var(--good-ink)":(p.pc>=70?"var(--warn-ink)":"var(--crit-ink)"),"font-size":12,"font-family":'"NB Mono",monospace'});
      pl.textContent=Math.round(p.pc)+"%";svg.appendChild(pl);
      var lb=el("text",{x:cx,y:H-PB+18,"text-anchor":"middle",fill:i>=nowRel&&nowRel>=0?"var(--ink-2)":"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});lb.textContent=p.q;svg.appendChild(lb);

      var hit=el("rect",{x:PL+band*i,y:PT,width:band,height:ph,fill:"transparent",tabindex:0,role:"button","aria-label":p.q+" at "+Math.round(p.pc)+"% of target"});hit.style.cursor="crosshair";
      var html='<div class="tt-h">'+p.q+'</div>'+row(null,"<b>Target</b>","<b>"+usd(p.t)+"</b>")+row("var(--s2)","Signed",usd(p.s))+(p.cw>0?row("var(--s3)","Continuation",usd(p.cw)):"")+(p.nw>0?row("var(--s4)","Net-new",usd(p.nw)):"")+row(null,"Weighted total",usd(p.tot))+row(null,p.gap<0?"<b>Gap</b>":"<b>Over plan</b>","<b>"+usd(Math.abs(p.gap))+"</b>")+row(null,"% of plan",Math.round(p.pc)+"%");
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
})();
</script>
</body>
</html>`;
}
