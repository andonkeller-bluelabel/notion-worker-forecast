/**
 * "Forecast vs Plan" report (artifact-faithful) for a Notion embed. Per quarter a
 * stacked WEIGHTED bar — Signed / Continuation / Net-new — with a target marker and
 * a colour-coded % label, over an out-year wash and a NOW divider. Matches the
 * artifact's palette (blue s2/s3/s4), NB brand fonts, and hover interactivity:
 * hovering (or focusing) a quarter highlights its band and shows a breakdown tooltip.
 * The chart + interactivity are built by inline JS from an embedded data array.
 */

import type { PlanRow } from "./planVsPipeline.js";
import { BRAND_FONTS } from "./brandFonts.js";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
const pct = (t: number, tot: number) => `${Math.round((tot / (t || 1)) * 100)}%`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function table(rows: PlanRow[]): string {
  const body = rows
    .map((r) => {
      const tot = r.signed + r.contW + r.newW;
      const gap = r.target - tot;
      return `<tr><td>${esc(r.q)}</td><td class="num r">${money(r.target)}</td><td class="num r">${money(r.signed)}</td><td class="num r">${r.contW ? money(r.contW) : "&ndash;"}</td><td class="num r">${r.newW ? money(r.newW) : "&ndash;"}</td><td class="num r b">${money(tot)}</td><td class="num r ${gap > 0 ? "neg" : "pos"}">${money(-gap)}</td><td class="num r">${pct(r.target, tot)}</td></tr>`;
    })
    .join("");
  return `<div class="tbl-scroll"><table><thead><tr><th>Quarter</th><th class="r">Target</th><th class="r">Signed</th><th class="r">Continuation</th><th class="r">Net-new</th><th class="r">Weighted</th><th class="r">Gap</th><th class="r">% plan</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderPlanHtml(rows: PlanRow[], meta: { asOf: string; nowQuarter?: string }): string {
  const range = rows.length ? `${rows[0]!.q}&ndash;${rows[rows.length - 1]!.q}` : "";
  const data = rows.map((r) => {
    const tot = r.signed + r.contW + r.newW;
    return { q: r.q, t: r.target, s: r.signed, cw: r.contW, nw: r.newW, tot, gap: r.target - tot, pc: (tot / (r.target || 1)) * 100 };
  });
  const nowIdx = meta.nowQuarter ? rows.findIndex((r) => r.q === meta.nowQuarter) : -1;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forecast vs Plan</title>
<style>
${BRAND_FONTS}
  :root{
    --surface:#FFFFFF; --ink:#1E293B; --ink-2:#64748B; --ink-3:#94A3B8;
    --hair:#E2E8F0; --hair-strong:#CBD5E1; --brand:#2424FC;
    --s2:#2424FC; --s3:#6E6EFD; --s4:#A3A3FE; --grid:#E9EDF3; --axis:#CBD5E1;
    --good-ink:#046904; --warn-ink:#8A5A00; --crit-ink:#B02525; --wash-crit:rgba(208,59,59,.07);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);font-family:"NB International Pro","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto;padding:26px 26px 22px}
  .sec-label{font-family:"NB Book","Helvetica Neue",Arial,sans-serif;text-transform:uppercase;letter-spacing:3px;font-size:10px;color:var(--ink-3)}
  .rule{border:0;border-top:1px solid var(--hair);margin:9px 0 14px}
  h2{font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-weight:400;color:var(--brand);font-size:clamp(1.4rem,3vw,2rem);line-height:1.1;letter-spacing:-.02em;margin:0}
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:3px;padding:22px 22px 18px;margin-top:20px}
  .card-head{display:flex;align-items:baseline;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:4px}
  .card-title{font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-size:14px;letter-spacing:.2px;color:var(--ink)}
  .card-sub{font-size:12.5px;color:var(--ink-3)}
  .legend{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 6px;font-size:11.5px;color:var(--ink-2)}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:2px;flex:0 0 auto}
  .line{width:15px;height:0;border-top:2px solid var(--ink);border-radius:0}
  .chart{overflow-x:auto}
  .chart svg{max-width:100%;height:auto;display:block}
  .tbl-scroll{overflow-x:auto;border:1px solid var(--hair);border-radius:3px;margin-top:20px}
  table{border-collapse:collapse;width:100%;font-size:13px;background:var(--surface)}
  thead th{font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-weight:400;font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:var(--ink-3);text-align:left;padding:11px 13px;border-bottom:1.5px solid var(--hair-strong);white-space:nowrap}
  tbody td{padding:10px 13px;border-bottom:1px solid var(--hair);white-space:nowrap}
  tbody tr:last-child td{border-bottom:0}
  th.r,td.r{text-align:right}
  td.num{font-family:"NB Mono","SFMono-Regular",Menlo,monospace;font-variant-numeric:tabular-nums}
  td.b{font-weight:500;color:var(--ink)}
  td.neg{color:var(--crit-ink)} td.pos{color:var(--good-ink)}
  .foot{margin-top:16px;padding-top:12px;border-top:1px solid var(--hair);font-size:11px;color:var(--ink-3);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .tt{position:fixed;z-index:80;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--surface);border:1px solid var(--hair-strong);border-radius:3px;box-shadow:0 8px 26px rgba(15,23,42,.14);padding:10px 12px;font-size:12px;min-width:190px}
  .tt.on{opacity:1}
  .tt-h{font-family:"NB Book","Helvetica Neue",Arial,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
  .tt-r{display:flex;align-items:center;gap:8px;justify-content:space-between;line-height:1.7}
  .tt-r .l{display:flex;align-items:center;gap:7px;color:var(--ink-2)}
  .tt-r .v{font-family:"NB Mono","SFMono-Regular",Menlo,monospace;color:var(--ink)}
  .tt-r .sw{width:9px;height:9px;border-radius:2px}
</style>
</head>
<body>
<div class="wrap">
  <div class="sec-label">Forecast vs Plan</div>
  <hr class="rule">
  <h2>The plan keeps climbing.</h2>
  <div class="card">
    <div class="card-head"><span class="card-title">Weighted forecast vs target</span><span class="card-sub">USD &middot; ${range} &middot; as of ${esc(meta.asOf)}</span></div>
    <div class="legend">
      <span><i class="sw" style="background:var(--s2)"></i>Signed (100%)</span>
      <span><i class="sw" style="background:var(--s3)"></i>Continuation, weighted</span>
      <span><i class="sw" style="background:var(--s4)"></i>Net-new, weighted</span>
      <span><i class="line"></i>Target</span>
    </div>
    <div class="chart"><div id="c-plan"></div></div>
  </div>
  ${table(rows)}
  <div class="foot">
    <div>Signed = won deals. Continuation = pipeline on accounts that already have a win. Net-new = pipeline on new accounts.</div>
    <div>Targets: Revenue Targets DB &middot; Pipeline: Deal Revenue Schedules</div>
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

  var W=1040,H=380,PL=58,PR=18,PT=34,PB=52,pw=W-PL-PR,ph=H-PT-PB;
  var band=pw/PLAN.length, bw=Math.min(46,band*0.5);
  var rawMax=Math.max.apply(null,PLAN.map(function(p){return Math.max(p.t,p.tot);}));
  var YMAX=Math.ceil(rawMax/5e5)*5e5||5e5, y=function(v){return PT+ph-(v/YMAX)*ph;};
  var svg=el("svg",{viewBox:"0 0 "+W+" "+H,width:W,role:"img","aria-label":"Weighted forecast vs target by quarter"});

  var Y0=PLAN.length?PLAN[0].q.slice(0,4):"",OWS=-1;for(var k=0;k<PLAN.length;k++){if(PLAN[k].q.slice(0,4)!==Y0){OWS=k;break;}}
  if(OWS>=0){svg.appendChild(el("rect",{x:PL+band*OWS,y:PT,width:band*(PLAN.length-OWS),height:ph,fill:"var(--wash-crit)"}));}
  for(var g=0;g<=4;g++){var tv=YMAX*g/4;svg.appendChild(el("line",{x1:PL,x2:W-PR,y1:y(tv),y2:y(tv),stroke:g===0?"var(--axis)":"var(--grid)","stroke-width":g===0?1.3:1}));var yl=el("text",{x:PL-9,y:y(tv)+3.5,"text-anchor":"end",fill:"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});yl.textContent=g===0?"0":usdS(tv);svg.appendChild(yl);}

  var hl=el("rect",{x:PL,y:PT,width:band,height:ph,fill:"var(--brand)","fill-opacity":".06",opacity:0,"pointer-events":"none"});
  svg.appendChild(hl);

  PLAN.forEach(function(p,i){
    var cx=PL+band*i+band/2, x=cx-bw/2, acc=0;
    [["var(--s2)",p.s],["var(--s3)",p.cw],["var(--s4)",p.nw]].forEach(function(sg){
      if(sg[1]<=0)return;var h=(sg[1]/YMAX)*ph;if(h<1.2)h=1.2;
      svg.appendChild(el("rect",{x:x,y:y(acc+sg[1]),width:bw,height:h,fill:sg[0]}));
      if(acc>0)svg.appendChild(el("rect",{x:x,y:y(acc+sg[1])+h-1,width:bw,height:2,fill:"var(--surface)"}));
      acc+=sg[1];
    });
    svg.appendChild(el("line",{x1:x-7,x2:x+bw+7,y1:y(p.t),y2:y(p.t),stroke:"var(--ink)","stroke-width":2.5}));
    var pl=el("text",{x:cx,y:y(Math.max(p.t,p.tot))-8,"text-anchor":"middle",fill:p.pc>=95?"var(--good-ink)":(p.pc>=70?"var(--warn-ink)":"var(--crit-ink)"),"font-size":12,"font-family":'"NB Mono",monospace'});
    pl.textContent=Math.round(p.pc)+"%";svg.appendChild(pl);
    var lb=el("text",{x:cx,y:H-PB+18,"text-anchor":"middle",fill:i>=NOWIDX&&NOWIDX>=0?"var(--ink-2)":"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});
    lb.textContent=p.q;svg.appendChild(lb);

    var hit=el("rect",{x:PL+band*i,y:PT,width:band,height:ph,fill:"transparent",tabindex:0,role:"button","aria-label":p.q+" at "+Math.round(p.pc)+"% of target"});
    hit.style.cursor="crosshair";
    var html='<div class="tt-h">'+p.q+'</div>'+row(null,"<b>Target</b>","<b>"+usd(p.t)+"</b>")
      +row("var(--s2)","Signed",usd(p.s))+(p.cw>0?row("var(--s3)","Continuation",usd(p.cw)):"")
      +(p.nw>0?row("var(--s4)","Net-new",usd(p.nw)):"")+row(null,"Weighted total",usd(p.tot))
      +row(null,p.gap>0?"<b>Gap</b>":"<b>Over plan</b>","<b>"+usd(Math.abs(p.gap))+"</b>")
      +row(null,"% of plan",Math.round(p.pc)+"%");
    hit.addEventListener("mouseenter",function(e){hl.setAttribute("x",PL+band*i);hl.setAttribute("opacity",1);ttShow(e,html);});
    hit.addEventListener("mousemove",ttMove);
    hit.addEventListener("mouseleave",function(){hl.setAttribute("opacity",0);ttHide();});
    hit.addEventListener("focus",function(){hl.setAttribute("x",PL+band*i);hl.setAttribute("opacity",1);var b=hit.getBoundingClientRect();ttShow({clientX:b.left+b.width/2,clientY:b.top+30},html);});
    hit.addEventListener("blur",function(){hl.setAttribute("opacity",0);ttHide();});
    svg.appendChild(hit);
  });

  if(NOWIDX>0){var nx=PL+band*NOWIDX;svg.appendChild(el("line",{x1:nx,x2:nx,y1:PT-8,y2:PT+ph,stroke:"var(--ink)","stroke-width":1.4,opacity:.45}));var nl=el("text",{x:nx+6,y:PT-12,fill:"var(--ink-2)","font-size":9.5,"font-family":'"NB Book",sans-serif'});nl.setAttribute("letter-spacing","1.4px");nl.textContent="NOW";svg.appendChild(nl);}
  document.getElementById("c-plan").appendChild(svg);
})();
</script>
</body>
</html>`;
}
