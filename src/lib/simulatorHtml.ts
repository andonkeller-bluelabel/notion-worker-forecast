/**
 * Interactive gap-closing simulator embed: client revenue-arc templates + the coverage
 * baseline, all driven client-side. Generated from the prototype; data injected at render.
 */

import type { Template, BaselineQuarter } from "./simulator.js";
import { BRAND_FONTS } from "./brandFonts.js";

export function renderSimulatorHtml(
  templates: Template[],
  baseline: BaselineQuarter[],
  meta: { asOf: string; curQuarter: string; today: string },
): string {
  return `<title>Gap-Closing Simulator</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
${BRAND_FONTS}
  :root{
    --surface:#FFFFFF; --panel:#F8F9FC; --panel-2:#F1F3F9; --ink:#1E293B; --ink-2:#5B6472; --ink-3:#94A3B8;
    --hair:#E4E8F0; --hair-strong:#CBD5E1; --grid:#EDF0F6;
    --base:#2424FC; --add:#0D9488; --target:#334155;
    --good:#046904; --crit:#B02525; --warn:#8A5A00;
    --font:"NB International Pro","Helvetica Neue",Arial,sans-serif; --book:"NB Book","Helvetica Neue",Arial,sans-serif; --mono:"NB Mono","SFMono-Regular",Menlo,monospace;
  }
  :root:not([data-theme="light"]){@media (prefers-color-scheme:dark){
    --surface:#0E1017; --panel:#161922; --panel-2:#1C212C; --ink:#E7EAF1; --ink-2:#A6AEBE; --ink-3:#6B7688;
    --hair:#242938; --hair-strong:#333B4D; --grid:#1E2330;
    --base:#8A8AFF; --add:#2DD4BF; --target:#94A3B8; --good:#5FD08A; --crit:#F0857A; --warn:#E0B15A;
  }}
  :root[data-theme="dark"]{
    --surface:#0E1017; --panel:#161922; --panel-2:#1C212C; --ink:#E7EAF1; --ink-2:#A6AEBE; --ink-3:#6B7688;
    --hair:#242938; --hair-strong:#333B4D; --grid:#1E2330;
    --base:#8A8AFF; --add:#2DD4BF; --target:#94A3B8; --good:#5FD08A; --crit:#F0857A; --warn:#E0B15A;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased}
  .wrap{max-width:1000px;margin:0 auto;padding:24px 22px 30px}
  .eyebrow{font-family:var(--book);text-transform:uppercase;letter-spacing:3px;font-size:10.5px;color:var(--ink-3)}
  h1{font-family:var(--book);font-weight:400;color:var(--base);font-size:clamp(1.4rem,3vw,2rem);line-height:1.1;letter-spacing:-.02em;margin:8px 0 0;text-wrap:balance}
  .sub{color:var(--ink-2);font-size:13.5px;margin:8px 0 0;max-width:66ch;line-height:1.5}
  .rule{border:0;border-top:1px solid var(--hair);margin:16px 0}
  .modes{display:inline-flex;border:1px solid var(--hair-strong);border-radius:20px;overflow:hidden}
  .modes button{appearance:none;border:0;background:transparent;color:var(--ink-2);font-family:var(--book);font-size:12.5px;padding:6px 15px;cursor:pointer}
  .modes button.on{background:var(--base);color:#fff}
  .hint{font-size:12px;color:var(--ink-3);margin:12px 0 8px}
  /* Card picker */
  .picker{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px}
  .tcard{border:1px solid var(--hair);border-radius:6px;padding:10px 11px;background:var(--panel);cursor:pointer;transition:border-color .12s, box-shadow .12s;position:relative}
  .tcard:hover{border-color:var(--base)}
  .tcard.sel{border-color:var(--add);box-shadow:inset 0 0 0 1px var(--add);background:var(--surface)}
  .tcard:focus-visible{outline:2px solid var(--base);outline-offset:1px}
  .tcard .an{font-family:var(--book);font-size:13px;color:var(--ink);padding-right:20px}
  .tcard .am{font-size:10.5px;color:var(--ink-3);margin-top:2px;font-family:var(--mono)}
  .tcard svg{width:100%;height:auto;display:block;margin-top:7px}
  .badge{position:absolute;top:9px;right:10px;font-family:var(--mono);font-size:11px;color:var(--add);font-weight:600}
  .tctl{display:flex;gap:6px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed var(--hair);flex-wrap:nowrap}
  .tctl input[type=number]{width:34px}
  .tctl input[type=date]{width:118px;padding-left:5px;padding-right:2px}
  .tctl .lx{font-size:11px;color:var(--ink-3)}
  .tcard.sel .feas{display:flex}
  .feas{display:none;align-items:center;gap:5px;font-size:10.5px;font-family:var(--book);color:var(--ink-2);width:100%;margin-top:6px}
  .fdot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
  select,input[type=number],input[type=date]{font-family:var(--font);font-size:12px;color:var(--ink);background:var(--surface);border:1px solid var(--hair-strong);border-radius:5px;padding:4px 7px}
  input[type=number]{width:48px}
  input[type=date]{font-size:11px}
  /* Readout + chart */
  .readout{display:flex;gap:22px;flex-wrap:wrap;margin:16px 0 2px;align-items:baseline}
  .ro .n{font-family:var(--mono);font-size:23px;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
  .ro .k{display:block;font-family:var(--book);text-transform:uppercase;letter-spacing:1.1px;font-size:9px;color:var(--ink-3);margin-top:5px}
  .card{border:1px solid var(--hair);border-radius:6px;padding:16px 16px 10px;margin-top:12px;background:var(--surface)}
  .legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-2);margin-bottom:6px}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:2px}.ln{width:15px;height:0;border-top:2px dashed var(--target)}
  .chart{overflow-x:auto}.chart svg{width:100%;height:auto;display:block;min-width:560px}
  .revbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--hair);border-radius:6px;padding:12px 14px;margin-bottom:4px}
  .revbar .big{font-family:var(--mono);font-size:20px;color:var(--base)}
  .revbar .lx{font-size:12.5px;color:var(--ink-3)}
  .tt{position:fixed;z-index:50;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--surface);border:1px solid var(--hair-strong);border-radius:5px;box-shadow:0 8px 26px rgba(15,23,42,.16);padding:8px 11px;font-size:12px;min-width:150px}
  .tt.on{opacity:1}.tt .h{font-family:var(--book);text-transform:uppercase;letter-spacing:1.2px;font-size:10px;color:var(--ink-3);margin-bottom:5px}
  .tt .r{display:flex;justify-content:space-between;gap:14px;line-height:1.7}.tt .v{font-family:var(--mono);color:var(--ink)}
  .foot{margin-top:16px;font-size:11px;color:var(--ink-3);line-height:1.6}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <div class="eyebrow">Gap-closing simulator · BlueLabel</div>
  <h1>What would it take to close the gap?</h1>
  <p class="sub">Pick clients modeled on real ones we've landed — each card is that client's actual revenue arc (discovery → expansion), all drawn on one scale so sizes compare. Revenue starts at close, so a new client's near-quarter impact is small and builds over the following year.</p>
  <hr class="rule">

  <div class="modes"><button id="mFwd" class="on" type="button">Forward · what-if</button><button id="mRev" type="button">Reverse · solve</button></div>

  <div id="revbar" class="revbar" hidden style="margin-top:14px">
    <span class="lx">Pick a client below, then: cover</span>
    <select id="rQuarter"></select>
    <span class="lx">by closing</span>
    <input type="date" id="rClose" value="2026-12-31">
    <span id="rResult" class="lx">— select a client card.</span>
  </div>

  <div class="hint" id="hint">Click a client to add it to your scenario. Selected clients show a count and close date.</div>
  <div class="picker" id="picker"></div>

  <div class="readout" id="readout"></div>

  <div class="card">
    <div class="legend">
      <span><i class="sw" style="background:var(--base)"></i>Current weighted pipeline</span>
      <span><i class="sw" style="background:var(--add)"></i>Simulated (new clients)</span>
      <span><i class="ln"></i>Target</span>
    </div>
    <div class="chart"><div id="chart"></div></div>
  </div>

  <div class="foot" id="foot"></div>
</div>
<div class="tt" id="tt"></div>

<script>
(function(){
  var TEMPLATES=${JSON.stringify(templates)};
  var BASELINE=${JSON.stringify(baseline)};
  var TODAY=${JSON.stringify(meta.today)}, CURQ=${JSON.stringify(meta.curQuarter)}, COHORT_CYCLE=8, ASOF=${JSON.stringify(meta.asOf)};
  var QS=BASELINE.filter(function(b){return b.target>0 && b.q>=CURQ;});
  var byName={}; TEMPLATES.forEach(function(t){byName[t.name]=t;});
  var GMAX=0; TEMPLATES.forEach(function(t){t.arc.forEach(function(v){if(v>GMAX)GMAX=v;});}); // shared arc scale

  var NS="http://www.w3.org/2000/svg";
  function el(t,a){var e=document.createElementNS(NS,t);for(var k in a)e.setAttribute(k,a[k]);return e;}
  function usdS(n){var a=Math.abs(n);return a>=1e6?"$"+(n/1e6).toFixed(a>=1e7?1:2).replace(/\\.?0+$/,"")+"M":a>=1e3?"$"+Math.round(n/1e3)+"K":"$"+Math.round(n);}
  function signed(n){return (n<0?"−":"+")+usdS(Math.abs(n));}
  var TT=document.getElementById("tt");
  function tip(ev,html){TT.innerHTML=html;TT.classList.add("on");var p=14,w=TT.offsetWidth,h=TT.offsetHeight,x=ev.clientX+p,y=ev.clientY+p;if(x+w>innerWidth)x=ev.clientX-w-p;if(y+h>innerHeight)y=ev.clientY-h-p;TT.style.left=x+"px";TT.style.top=y+"px";}
  function tipOff(){TT.classList.remove("on");}

  function addMonths(y,m,n){var t=y*12+(m-1)+n;return [Math.floor(t/12), t%12+1];}
  function quarterOf(y,m){return y+".Q"+(Math.ceil(m/3));}
  function minusWeeks(dateStr,w){var d=new Date(dateStr+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-w*7);return d.toISOString().slice(0,10);}
  function arcToQuarters(arc, closeDateStr){var y=+closeDateStr.slice(0,4), m=+closeDateStr.slice(5,7), out={};for(var i=0;i<arc.length;i++){var ymo=addMonths(y,m,i);var q=quarterOf(ymo[0],ymo[1]);out[q]=(out[q]||0)+arc[i];}return out;}
  function cycleOf(t){return t.cycleWeeks!=null?t.cycleWeeks:COHORT_CYCLE;}

  var mode="fwd";
  var sel={"Assurity":{count:3,close:"2026-12-12"}}; // forward selections
  var revPick="Assurity";

  // shared-scale arc sparkline
  function drawArc(host,t){
    var W=196,H=54,P=3,pw=W-2*P,ph=H-2*P, n=t.arc.length, bw=pw/n;
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H});
    t.arc.forEach(function(v,i){var h=(v/GMAX)*ph;if(v>0&&h<1)h=1;svg.appendChild(el("rect",{x:P+i*bw,y:P+ph-h,width:Math.max(1,bw-1),height:h,fill:"var(--base)","fill-opacity":.85}));});
    host.appendChild(svg);
  }

  var picker=document.getElementById("picker");
  function renderCards(){
    picker.innerHTML="";
    TEMPLATES.forEach(function(t){
      var isSel = mode==="fwd" ? !!sel[t.name] : revPick===t.name;
      var c=document.createElement("div"); c.className="tcard"+(isSel?" sel":""); c.tabIndex=0; c.dataset.name=t.name;
      c.innerHTML='<div class="an">'+t.name+'</div><div class="am">'+usdS(t.total)+' · '+t.deals+' deal'+(t.deals>1?"s":"")+' · ~'+cycleOf(t)+'w'+(t.cycleWeeks==null?" est":"")+'</div>'+(mode==="fwd"&&isSel?'<div class="badge">×'+sel[t.name].count+'</div>':'');
      var arcHost=document.createElement("div"); c.appendChild(arcHost); drawArc(arcHost,t);
      if(mode==="fwd"&&isSel){
        var s=sel[t.name];
        var ctl=document.createElement("div"); ctl.className="tctl";
        ctl.innerHTML='<span class="lx">×</span><input type="number" min="1" max="99" value="'+s.count+'" data-f="count"><input type="date" value="'+s.close+'" data-f="close">';
        var cyc=cycleOf(t), sb=minusWeeks(s.close,cyc), late=sb<TODAY;
        var feas=document.createElement("div"); feas.className="feas"; feas.style.display="flex";
        feas.innerHTML='<span class="fdot" style="background:'+(late?"var(--warn)":"var(--good)")+'"></span>source by '+sb.slice(0,7)+(late?" — past":"")+(t.cycleWeeks==null?" (est cycle)":"");
        ctl.querySelectorAll("input").forEach(function(inp){
          inp.addEventListener("click",function(e){e.stopPropagation();});
          inp.addEventListener("change",function(e){e.stopPropagation();s[inp.dataset.f]=inp.dataset.f==="count"?Math.max(1,+inp.value||1):inp.value;renderCards();render();});
        });
        c.appendChild(ctl); c.appendChild(feas);
      }
      c.addEventListener("click",function(){
        if(mode==="fwd"){ if(sel[t.name])delete sel[t.name]; else sel[t.name]={count:1,close:"2026-12-31"}; }
        else { revPick=t.name; renderReverse(); }
        renderCards(); render();
      });
      c.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();c.click();}});
      picker.appendChild(c);
    });
  }

  function simulate(){var add={};for(var name in sel){var t=byName[name],l=sel[name];if(!t)continue;var q=arcToQuarters(t.arc,l.close);for(var k in q)add[k]=(add[k]||0)+q[k]*l.count;}return add;}

  function drawChart(add){
    var host=document.getElementById("chart");host.innerHTML="";
    var W=940,H=340,L=54,R=16,T=26,B=42,pw=W-L-R,ph=H-T-B;
    var band=pw/QS.length, bw=Math.min(0.08*W,band*0.5);
    var maxV=Math.max.apply(null,QS.map(function(q){return Math.max(q.target,q.weighted+(add[q.q]||0));}).concat([5e5]));
    var YMAX=Math.ceil(maxV/5e5)*5e5, y=function(v){return T+ph-(v/YMAX)*ph;};
    var svg=el("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":"Coverage with simulated new clients"});
    for(var g=0;g<=4;g++){var tv=YMAX*g/4;svg.appendChild(el("line",{x1:L,x2:W-R,y1:y(tv),y2:y(tv),stroke:g===0?"var(--hair-strong)":"var(--grid)","stroke-width":1}));var yl=el("text",{x:L-8,y:y(tv)+3.5,"text-anchor":"end",fill:"var(--ink-3)","font-size":10,"font-family":'"NB Mono",monospace'});yl.textContent=g===0?"0":usdS(tv);svg.appendChild(yl);}
    QS.forEach(function(q,i){
      var cx=L+band*i+band/2, x=cx-bw/2, a=add[q.q]||0, tot=q.weighted+a, gap=q.target-tot;
      svg.appendChild(el("rect",{x:x,y:y(q.weighted),width:bw,height:(q.weighted/YMAX)*ph,fill:"var(--base)"}));
      if(a>0){var hA=(a/YMAX)*ph;svg.appendChild(el("rect",{x:x,y:y(tot),width:bw,height:hA,fill:"var(--add)"}));svg.appendChild(el("rect",{x:x,y:y(tot),width:bw,height:Math.min(2,hA),fill:"var(--surface)"}));}
      svg.appendChild(el("line",{x1:x-7,x2:x+bw+7,y1:y(q.target),y2:y(q.target),stroke:"var(--target)","stroke-width":2,"stroke-dasharray":"5 3"}));
      var gl=el("text",{x:cx,y:y(Math.max(tot,q.target))-8,"text-anchor":"middle",fill:gap>0?"var(--crit)":"var(--good)","font-size":11.5,"font-family":'"NB Mono",monospace'});gl.textContent=signed(-gap);svg.appendChild(gl);
      var lb=el("text",{x:cx,y:H-B+18,"text-anchor":"middle",fill:"var(--ink-2)","font-size":10,"font-family":'"NB Mono",monospace'});lb.textContent=q.q;svg.appendChild(lb);
      var hit=el("rect",{x:L+band*i,y:T,width:band,height:ph,fill:"transparent"});hit.style.cursor="crosshair";
      var html='<div class="h">'+q.q+'</div><div class="r"><span>Target</span><span class="v">'+usdS(q.target)+'</span></div><div class="r"><span>Current</span><span class="v">'+usdS(q.weighted)+'</span></div>'+(a>0?'<div class="r"><span>+ Simulated</span><span class="v">'+usdS(a)+'</span></div>':'')+'<div class="r"><span>'+(gap>0?"Gap":"Surplus")+'</span><span class="v">'+usdS(Math.abs(gap))+'</span></div>';
      hit.addEventListener("mouseenter",function(e){tip(e,html);});hit.addEventListener("mousemove",function(e){tip(e,html);});hit.addEventListener("mouseleave",tipOff);
      svg.appendChild(hit);
    });
    host.appendChild(svg);
  }

  function render(){
    var add= mode==="fwd" ? simulate() : (function(){var t=byName[revPick];if(!t)return {};var q=arcToQuarters(t.arc,document.getElementById("rClose").value);var need=revNeed();var o={};for(var k in q)o[k]=q[k]*need;return o;})();
    drawChart(add);
    if(mode==="fwd"){
      var inWin=QS.reduce(function(s,q){return s+(add[q.q]||0);},0), totAll=0;for(var k in add)totAll+=add[k];
      var nD=0;for(var n in sel)nD+=sel[n].count;
      document.getElementById("readout").innerHTML='<div class="ro"><span class="n">'+nD+'</span><span class="k">new clients</span></div><div class="ro"><span class="n" style="color:var(--add)">'+usdS(inWin)+'</span><span class="k">added in window</span></div><div class="ro"><span class="n">'+usdS(totAll)+'</span><span class="k">added total (thru arc)</span></div>';
    } else document.getElementById("readout").innerHTML="";
  }

  // reverse
  var rQuarter=document.getElementById("rQuarter"), rClose=document.getElementById("rClose"), rResult=document.getElementById("rResult");
  rQuarter.innerHTML=QS.map(function(q){return '<option value="'+q.q+'"'+(q.q==="2026.Q4"?" selected":"")+'>'+q.q+'</option>';}).join("");
  function revNeed(){var t=byName[revPick];if(!t)return 0;var base=QS.filter(function(x){return x.q===rQuarter.value;})[0];if(!base)return 0;var per=(arcToQuarters(t.arc,rClose.value)[rQuarter.value]||0),gap=base.target-base.weighted;if(gap<=0||per<=0)return 0;return Math.ceil(gap/per);}
  function renderReverse(){
    var t=byName[revPick]; if(!t){rResult.innerHTML="— select a client card.";render();return;}
    var q=rQuarter.value, base=QS.filter(function(x){return x.q===q;})[0], per=(arcToQuarters(t.arc,rClose.value)[q]||0), gap=base.target-base.weighted;
    var cyc=cycleOf(t), sb=minusWeeks(rClose.value,cyc), late=sb<TODAY;
    if(gap<=0) rResult.innerHTML='<span style="color:var(--good)">'+q+' already covered ('+usdS(-gap)+' surplus).</span>';
    else if(per<=0) rResult.innerHTML='<span style="color:var(--crit)">A '+t.name+' closing then adds ~$0 to '+q+' — its revenue lands in other quarters.</span>';
    else rResult.innerHTML='<span class="big">'+Math.ceil(gap/per)+'× '+t.name+'</span> to close '+q+"'s "+usdS(gap)+' gap · <span class="fdot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+(late?"var(--warn)":"var(--good)")+'"></span> source by '+sb.slice(0,7)+(late?" (past)":"");
    render();
  }
  [rQuarter,rClose].forEach(function(e){e.addEventListener("change",renderReverse);});

  var mF=document.getElementById("mFwd"),mR=document.getElementById("mRev");
  function setMode(m){mode=m;mF.classList.toggle("on",m==="fwd");mR.classList.toggle("on",m==="rev");
    document.getElementById("revbar").hidden=m!=="rev";
    document.getElementById("hint").textContent=m==="fwd"?"Click a client to add it to your scenario. Selected clients show a count and close date.":"Click one client, then set the quarter and close date above to see how many you'd need.";
    renderCards(); if(m==="rev")renderReverse(); else render();}
  mF.addEventListener("click",function(){setMode("fwd");});
  mR.addEventListener("click",function(){setMode("rev");});

  document.getElementById("foot").innerHTML="Cards share one revenue scale (peak ≈ "+usdS(GMAX)+"/mo). Arc = each client's real committed revenue by month since landing. Baseline = current weighted pipeline vs target · as of "+ASOF+". Cycle from Deal Stage Changes where tracked, else ~"+COHORT_CYCLE+"w est.";
  renderCards(); render();
})();
</script>
`;
}
