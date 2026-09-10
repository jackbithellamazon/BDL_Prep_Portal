/* BDL PrepHub — js/insights.js — Insights + engine + detail popups.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── INSIGHTS ─────────────────────────────────────────────────────────────────
let insightRange='mtd';

function getInsightRange(){
  const now=new Date();
  const todayStr=todayISO();
  function localISO(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  if(insightRange==='week'){const{s,e}=getWeekRange();return{s:localISO(s),e:localISO(e),label:'This Week'};}
  if(insightRange&&insightRange.indexOf('m:')===0){
    const[y,mo]=insightRange.slice(2).split('-').map(Number);
    const s=new Date(y,mo-1,1),e=new Date(y,mo,0);
    return{s:localISO(s),e:localISO(e),label:new Date(y,mo-1,1).toLocaleString('en-GB',{month:'long',year:'numeric'})};
  }
  if(insightRange==='mtd'){const s=new Date(now.getFullYear(),now.getMonth(),1);return{s:localISO(s),e:todayStr,label:'Month to Date'};}
  if(insightRange==='30d'){const s=new Date();s.setDate(s.getDate()-29);return{s:localISO(s),e:todayStr,label:'Last 30 Days'};}
  if(insightRange==='90d'){const s=new Date();s.setDate(s.getDate()-89);return{s:localISO(s),e:todayStr,label:'Last 90 Days'};}
  if(insightRange==='ytd'){return{s:`${now.getFullYear()}-01-01`,e:todayStr,label:'Year to Date'};}
  if(insightRange==='custom'){
    const f=document.getElementById('insightFrom')?.value||`${now.getFullYear()}-01-01`;
    const t=document.getElementById('insightTo')?.value||todayStr;
    return{s:f,e:t,label:`${f} → ${t}`};
  }
  return{s:'2000-01-01',e:todayStr,label:'All Time'};
}

function renderInsights(){
  const w=document.getElementById('insightsWrap');
  const{s:rs,e:re,label:rlabel}=getInsightRange();
  const inRange=d=>{if(!d)return false;return d>=rs&&d<=re;};
  const inRangeISO=iso=>{if(!iso)return false;const d=new Date(iso);return d>=rs&&d<=re;};

  // ── UNIFIED SENT DATA LAYER ────────────────────────────────────────────────
  // One row per shipment allocation, segment-aware, with OA + Lavarion + Returns
  // all treated as sent volume. Every section aggregates from this.
  // line = {kind, units, value, sup, acct, type, shipId, date, sku, asin, prod}
  const lines=[];
  rows.filter(r=>r.sent==='Yes'||r.status==='Part Sent').forEach(r=>{
    const cogs=parseSKU(r.sku).cogs;
    const segs=normaliseSegments(r);
    if(segs.length){
      segs.forEach(sg=>{ if(!inRange(sg.date||r.sentDate))return;
        lines.push({kind:'oa',units:sg.units||0,value:cogs*(sg.units||0),sup:r.sup||'Unknown',acct:r.acct||'—',
          type:_shipTypeCache[sg.shipId]||sg.type||r.shipType||'Standard',shipId:sg.shipId,date:sg.date||r.sentDate,sku:r.sku,asin:r.asin,prod:r.prod}); });
    }else if(inRange(r.sentDate)){
      lines.push({kind:'oa',units:r.ship||0,value:cogs*(r.ship||0),sup:r.sup||'Unknown',acct:r.acct||'—',
        type:r.shipType||'Standard',shipId:r.shipId,date:r.sentDate,sku:r.sku,asin:r.asin,prod:r.prod});
    }
  });
  lavShipments.filter(s=>inRange(s.date)).forEach(s=>lines.push({kind:'lav',units:s.units||0,value:(s.cost||0)*(s.units||0),
    sup:'Lavarion',acct:'Lavarion',type:_shipTypeCache[s.shipId]||'Standard',shipId:s.shipId,date:s.date,sku:s.sku,asin:s.asin,prod:s.prod}));
  returnShipments.filter(s=>inRange(s.date)).forEach(s=>lines.push({kind:'return',units:s.units||0,value:(s.cost||0)*(s.units||0),
    sup:'Return',acct:'Returns',type:_shipTypeCache[s.shipId]||'Standard',shipId:s.shipId,date:s.date,sku:s.sku,asin:s.asin,prod:s.prod}));

  const sum=(arr,f)=>arr.reduce((a,x)=>a+(f(x)||0),0);
  const byKind=k=>lines.filter(l=>l.kind===k);
  const oaLines=byKind('oa'),lavLines=byKind('lav'),retLines=byKind('return');

  const totalUnits=sum(lines,l=>l.units);
  // COG excludes Returns to match the Shipments page (source of truth): returns are
  // stock coming back, counted as units but not as new outbound COG value. retValue
  // is still computed separately below for the Returns KPI.
  const totalValue=sum(lines.filter(l=>l.kind!=='return'),l=>l.value);
  const allShipIds=new Set(lines.filter(l=>l.shipId).map(l=>l.shipId));
  const totalBoxes=Object.entries(shipBoxes).reduce((t,[sid,b])=>allShipIds.has(sid)?t+(b||0):t,0);
  const avgUPS=allShipIds.size?Math.round(totalUnits/allShipIds.size):0;
  const avgBPS=allShipIds.size?(totalBoxes/allShipIds.size).toFixed(1):0;
  const avgCogUnit=totalUnits?(totalValue/totalUnits):0;

  const stockUnits=sum(oaLines,l=>l.units),stockValue=sum(oaLines,l=>l.value);
  const lavUnits=sum(lavLines,l=>l.units),lavValue=sum(lavLines,l=>l.value);
  const retUnits=sum(retLines,l=>l.units),retValue=sum(retLines,l=>l.value);
  const stockShipIds=new Set(oaLines.filter(l=>l.shipId).map(l=>l.shipId));
  const lavShipIds=new Set(lavLines.filter(l=>l.shipId).map(l=>l.shipId));
  const retShipIds=new Set(retLines.filter(l=>l.shipId).map(l=>l.shipId));

  // Type breakdown (OA only — lav/returns shown separately)
  let stdUnits=0,dgUnits=0,osUnits=0;
  oaLines.forEach(l=>{ if(l.type==='DG')dgUnits+=l.units; else if(l.type==='Oversize')osUnits+=l.units; else stdUnits+=l.units; });

  // Pipeline (not range-bound — current state)
  /* the pipeline is what is moving NOW — archived rows are finished with */
  const pipe=st=>{const rr=rows.filter(r=>r.status===st&&!r.archived);return{u:rr.reduce((a,r)=>a+(r.exp||0),0),v:rr.reduce((a,r)=>a+parseSKU(r.sku).cogs*(r.exp||0),0),n:rr.length};};
  const transit=pipe('In-Transit'),warehouse=pipe('In Warehouse'),delivered=pipe('Delivered');

  // ── SUPPLIER ANALYSIS (segment-based) ──────────────────────────────────────
  const supMap={};
  const ensureSup=s=>{if(!supMap[s])supMap[s]={units:0,value:0,orders:new Set(),issues:0,issueVal:0,days:[],claims:0,claimVal:0};return supMap[s];};
  oaLines.forEach(l=>{const m=ensureSup(l.sup);m.units+=l.units;m.value+=l.value;});
  rows.filter(r=>r.issueQty>0).forEach(r=>{const m=ensureSup(r.sup||'Unknown');m.issues+=r.issueQty||0;m.issueVal+=parseSKU(r.sku).cogs*(r.issueQty||0);if(r.oid)m.orders.add(r.oid);});
  rows.filter(r=>r.sentDate&&r.date).forEach(r=>{const[dd,mm]=(r.date||'').split('/');if(!dd||!mm)return;const ordered=new Date(`${new Date().getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);const sent=new Date(r.sentDate);const days=Math.round((sent-ordered)/864e5);if(days>=0&&days<200)ensureSup(r.sup||'Unknown').days.push(days);});
  claims.forEach(c=>{const m=ensureSup(c.sup||'Unknown');m.claims++;m.claimVal+=c.claimValue||0;});
  const supEntries=Object.entries(supMap).filter(([s])=>s!=='Lavarion'&&s!=='Return').sort((a,b)=>b[1].value-a[1].value);

  // ── ACCOUNT ANALYSIS (new) ─────────────────────────────────────────────────
  const acctMap={};
  const ensureAcct=a=>{if(!acctMap[a])acctMap[a]={units:0,value:0,ships:new Set(),issues:0,issueVal:0};return acctMap[a];};
  lines.forEach(l=>{const m=ensureAcct(l.acct||'—');m.units+=l.units;m.value+=l.value;if(l.shipId)m.ships.add(l.shipId);});
  rows.filter(r=>r.issueQty>0).forEach(r=>{const m=ensureAcct(r.acct||'—');m.issues+=r.issueQty||0;m.issueVal+=parseSKU(r.sku).cogs*(r.issueQty||0);});
  const acctEntries=Object.entries(acctMap).sort((a,b)=>b[1].value-a[1].value);
  const acctMaxU=Math.max(...acctEntries.map(e=>e[1].units),1);

  // ── CLAIMS (from claims array, correct statuses) ───────────────────────────
  const cStatus=c=>c.cst||'Open';
  const openClaims=claims.filter(c=>cStatus(c)!=='Resolved');
  const resolvedClaims=claims.filter(c=>cStatus(c)==='Resolved');
  const byIssue=t=>claims.filter(c=>(c.issT||'').toLowerCase()===t);
  const missingC=byIssue('missing'),damagedC=byIssue('damaged'),incorrectC=byIssue('incorrect');
  const missingUnits=sum(missingC,c=>c.dif||0),damagedUnits=sum(damagedC,c=>c.dif||0),incorrectUnits=sum(incorrectC,c=>c.dif||0);
  const missingVal=sum(missingC,c=>c.claimValue||0),damagedVal=sum(damagedC,c=>c.claimValue||0);
  const totalAtRisk=sum(openClaims,c=>c.claimValue||0);
  const recovered=sum(resolvedClaims.filter(c=>c.reimbursed==='Yes'),c=>c.claimValue||0);
  const stillOwed=sum(resolvedClaims.filter(c=>(c.reimbursed||'No')==='No'),c=>c.claimValue||0);

  // ── WEEKLY TREND (units + value, all-in) ───────────────────────────────────
  const weekTrend=[];
  for(let i=7;i>=0;i--){
    const base=new Date();base.setDate(base.getDate()-i*7);
    const dow=base.getDay()||7;
    const ws2=new Date(base);ws2.setDate(base.getDate()-dow+1);ws2.setHours(0,0,0,0);
    const we2=new Date(ws2);we2.setDate(ws2.getDate()+6);
    const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const wss=iso(ws2),wes=iso(we2);
    const inW=d=>d&&d>=wss&&d<=wes;
    let u=0,v=0;
    rows.filter(r=>r.sent==='Yes'||r.status==='Part Sent').forEach(r=>{const cogs=parseSKU(r.sku).cogs;normaliseSegments(r).forEach(sg=>{if(inW(sg.date||r.sentDate)){u+=sg.units||0;v+=cogs*(sg.units||0);}});});
    lavShipments.forEach(s=>{if(inW(s.date)){u+=s.units||0;v+=(s.cost||0)*(s.units||0);}});
    returnShipments.forEach(s=>{if(inW(s.date)){u+=s.units||0;v+=(s.cost||0)*(s.units||0);}});
    const m=ws2.getMonth()+1;
    weekTrend.push({lbl:`${ws2.getDate()} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]}`,u,v});
  }
  const weekMaxU=Math.max(...weekTrend.map(x=>x.u),1);
  const weekMaxV=Math.max(...weekTrend.map(x=>x.v),1);

  // ── MONTHLY HISTORY (permanent) ────────────────────────────────────────────
  const monthMap={};
  const addMonth=(date,u,v,pc)=>{if(!date)return;const k=date.slice(0,7);if(!monthMap[k])monthMap[k]={units:0,value:0,prep:0};monthMap[k].units+=u;monthMap[k].value+=v;};
  rows.filter(r=>r.sent==='Yes'||r.status==='Part Sent').forEach(r=>{const cogs=parseSKU(r.sku).cogs;normaliseSegments(r).forEach(sg=>{const d=sg.date||r.sentDate;if(d)addMonth(d,sg.units||0,cogs*(sg.units||0));});});
  lavShipments.forEach(s=>{if(s.date)addMonth(s.date,s.units||0,(s.cost||0)*(s.units||0));});
  returnShipments.forEach(s=>{if(s.date)addMonth(s.date,s.units||0,(s.cost||0)*(s.units||0));});
  // Prep cost per month
  Object.keys(monthMap).forEach(k=>{
    const mRows=rows.filter(r=>(r.sent==='Yes'||r.status==='Part Sent')&&normaliseSegments(r).some(sg=>(sg.date||r.sentDate||'').slice(0,7)===k)).map(r=>{const segU=normaliseSegments(r).filter(sg=>(sg.date||r.sentDate||'').slice(0,7)===k).reduce((a,sg)=>a+(sg.units||0),0);return{...r,_segUnits:segU};});
    const mLav=lavShipments.filter(s=>(s.date||'').slice(0,7)===k);
    const mIds=new Set([...mRows.filter(r=>r.shipId).map(r=>r.shipId),...mLav.filter(s=>s.shipId).map(s=>s.shipId)]);
    const mBoxes=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>mIds.has(sid)));
    monthMap[k].prep=calcImpliedPrepCost(mRows,mLav,mBoxes).withVat;
  });
  const monthEntries=Object.entries(monthMap).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);

  // ── MONTH-OVER-MONTH ANALYSIS (for the trends/insights strip) ──────────────
  const _curM=monthEntries[0]?monthEntries[0][1]:{units:0,value:0,prep:0};
  const _prevM=monthEntries[1]?monthEntries[1][1]:{units:0,value:0,prep:0};
  const momPct=(a,b)=>b>0?((a-b)/b*100):(a>0?100:0);
  const ppuCur=_curM.units?(_curM.prep/_curM.units):0;
  const ppuPrev=_prevM.units?(_prevM.prep/_prevM.units):0;
  const ratioCur=_curM.prep>0?(_curM.value/_curM.prep):0;

  // ── PREP COST (range) ──────────────────────────────────────────────────────
  const oaForPrep=(()=>{const map={};oaLines.forEach(l=>{const key=l.sku+'|'+l.shipId;if(!map[key])map[key]={sku:l.sku,shipType:l.type,shipId:l.shipId,inBundle:'No',_segUnits:0,ship:0};map[key]._segUnits+=l.units;});
    // attach inBundle from source rows
    return Object.values(map).map(o=>{const src=rows.find(r=>r.sku===o.sku);return{...o,inBundle:src?src.inBundle:'No'};});})();
  const prepBoxes=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>stockShipIds.has(sid)||lavShipIds.has(sid)));
  const pc=calcImpliedPrepCost(oaForPrep,lavLines.map(l=>({...l,cost:l.units?l.value/l.units:0})),prepBoxes);
  const prepDays=new Set(lines.map(l=>l.date)).size;
  const prepShips=allShipIds.size;
  const prepTotal=pc.withVat;
  const efficiency=prepTotal>0?(totalValue/prepTotal):0;

  // ── UI HELPERS ─────────────────────────────────────────────────────────────
  const filterBtns=[['week','This Week'],['mtd','MTD'],['30d','30 Days'],['90d','90 Days'],['ytd','YTD'],['all','All Time'],['custom','Custom']]
    .map(([v,l])=>`<button onclick="insightRange='${v}';renderInsights();" style="padding:5px 12px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${insightRange===v?'var(--accent)':'var(--border)'};background:${insightRange===v?'var(--btn-amber-bg)':'var(--bg2)'};color:${insightRange===v?'var(--btn-amber-text)':'var(--text3)'};">${l}</button>`).join('');
  // Quick-pick buttons for each recent calendar month — clicking re-renders the
  // whole page for that month (Jan, Feb, last month, etc.).
  const _MON=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthBtns=monthEntries.slice(0,8).map(([k])=>{const[y,m]=k.split('-');const v='m:'+k;const active=insightRange===v;return `<button onclick="insightRange='${v}';renderInsights();" style="padding:5px 10px;border-radius:14px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;border:1px solid ${active?'var(--accent)':'var(--border2)'};background:${active?'var(--btn-amber-bg)':'var(--bg3)'};color:${active?'var(--btn-amber-text)':'var(--text2)'};">${_MON[+m]} '${y.slice(2)}</button>`;}).join('');
  const sectionHead=t=>`<div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.1em;padding-bottom:6px;border-bottom:2px solid var(--border);margin-top:6px;">${t}</div>`;
  const kpi=(t,v,sub,c='var(--text)',borderC='')=>`<div class="ic" style="${borderC?`border-color:${borderC};border-top:3px solid ${borderC};`:''}"><div class="ic-title">${t}</div><div class="ic-val" style="color:${c};">${v}</div><div class="ic-sub">${sub||''}</div></div>`;
  const bar=(label,val,max,col,valText,lblW=80)=>`<div class="brow"><div class="blabel" style="width:${lblW}px;font-size:11px;">${label}</div><div class="btrack"><div class="bfill" style="width:${Math.round((val/max)*100)}%;background:${col};"></div></div><div class="bval" style="font-size:11px;">${valText}</div></div>`;

  // Last-6-calendar-month series for the overview sparklines + compare popup.
  const _mm=buildMonthMap(null);
  const _recent=Object.keys(_mm).sort().slice(-6);
  const _series={units:[],cog:[],ships:[],prep:[]};
  _recent.forEach(k=>{const md=_mm[k];const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>md.shipIds.has(sid)));const mm=calcInsMetrics(md.rows,md.lavRows,bm);_series.units.push(mm.totalUnits||0);_series.cog.push(mm.cog||0);_series.ships.push(mm.ships||0);_series.prep.push(mm.withVat||0);});
  const spark=(vals,color)=>{
    if(!vals||vals.length<2||!vals.some(v=>v>0))return'';
    const max=Math.max(...vals),min=Math.min(...vals,0),rng=(max-min)||1,W=120,H=24;
    const pts=vals.map((v,i)=>`${((i/(vals.length-1))*W).toFixed(1)},${(H-((v-min)/rng)*H).toFixed(1)}`).join(' ');
    const lx=W,ly=(H-((vals[vals.length-1]-min)/rng)*H).toFixed(1);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="20" preserveAspectRatio="none" style="margin-top:6px;display:block;overflow:visible;opacity:.85;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="2.2" fill="${color}"/></svg>`;
  };

  w.innerHTML=`<div style="padding:14px;display:flex;flex-direction:column;gap:14px;">

    <!-- DATE FILTER -->
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      ${filterBtns}
      ${insightRange==='custom'?`
        <input type="date" id="insightFrom" onchange="renderInsights()" style="padding:4px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px;">
        <span style="color:var(--text3);font-size:11px;">→</span>
        <input type="date" id="insightTo" onchange="renderInsights()" style="padding:4px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px;">
      `:''}
      <span style="font-size:11px;color:var(--accent);font-weight:700;margin-left:4px;">${rlabel}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:-4px;">
      <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-right:2px;">Jump to month:</span>
      ${monthBtns||'<span style="font-size:10px;color:var(--text3);">no months yet</span>'}
    </div>

    <!-- HEADLINE -->
    ${sectionHead('Overview — '+rlabel)}
    <div class="ig-row ig-4">
      <div onclick="openUnitsExplorer()" style="cursor:pointer;" title="Click for units trend & breakdown">${kpi('Total Units Sent ▸',fmt(totalUnits),`Stock ${fmt(stockUnits)} · Lav ${fmt(lavUnits)} · Ret ${fmt(retUnits)}`+spark(_series.units,'#55ff55'),'#55ff55','#55ff55')}</div>
      <div onclick="openCogExplorer()" style="cursor:pointer;" title="Click for COG trend & by-supplier">${kpi('Total COG Value ▸',fmtGBP2(totalValue),`avg £${avgCogUnit.toFixed(2)}/unit`+spark(_series.cog,'#ffaa33'),'#ffaa33','#ffaa33')}</div>
      <div onclick="openInsCompare()" style="cursor:pointer;" title="Click to compare months">${kpi('Shipments ▸',fmt(allShipIds.size),`${fmt(totalBoxes)} boxes · ${avgUPS} units/ship`+spark(_series.ships,'#5599ff'),'#5599ff','#5599ff')}</div>
      <div onclick="openPrepExplorer('mtd')" style="cursor:pointer;" title="Click for the Prep Fee Explorer — breakdown, trend and any month">${kpi('Prep Cost (inc VAT) ▸',fmtGBP2(prepTotal),`COG:Prep ratio ${efficiency?efficiency.toFixed(0)+'×':'—'} · click for detail`+spark(_series.prep,'#cc99ff'),'#cc99ff','#cc99ff')}</div>
    </div>

    <!-- TRENDS & ANALYSIS (top) -->
    ${sectionHead('Trends & Analysis — latest months')}
    ${(()=>{
      const aCard=(label,big,sub,deltaPct,goodWhenDown)=>{
        const col=(deltaPct==null)?'var(--text3)':(((goodWhenDown?deltaPct<-0.5:deltaPct>0.5))?'#4ade80':((goodWhenDown?deltaPct>0.5:deltaPct<-0.5)?'#f87171':'var(--text3)'));
        const arrow=deltaPct==null?'':(deltaPct>0.5?'▲':deltaPct<-0.5?'▼':'→');
        return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
          <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">${label}</div>
          <div style="font-size:26px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:var(--text);line-height:1;">${big}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:7px;">${deltaPct==null?'':`<span style="font-size:11px;font-weight:800;font-family:var(--mono);color:${col};">${arrow} ${Math.abs(deltaPct).toFixed(0)}%</span>`}<span style="font-size:10px;color:var(--text3);">${sub}</span></div>
        </div>`;
      };
      const topSup=supEntries[0];
      const supShare=topSup&&stockValue>0?Math.round(topSup[1].value/stockValue*100):0;
      return `<div class="ig-row ig-4" style="margin-bottom:8px;">
        ${aCard('Units (this mo, so far)',fmt(_curM.units),'vs last month',momPct(_curM.units,_prevM.units),false)}
        <div onclick="openPrepEfficiency()" style="cursor:pointer;" title="Click for prep efficiency over time">${aCard('Prep £/unit ▸',ppuCur?'£'+ppuCur.toFixed(2):'—','vs last month'+(ppuPrev?` (was £${ppuPrev.toFixed(2)})`:''),ppuPrev?momPct(ppuCur,ppuPrev):null,true)}</div>
        <div onclick="openPrepEfficiency()" style="cursor:pointer;" title="Click for prep efficiency over time">${aCard('COG : Prep ratio ▸',ratioCur?ratioCur.toFixed(1)+'×':'—','higher = leaner prep',null)}</div>
        ${aCard('Top supplier share',topSup?supShare+'%':'—',topSup?topSup[0].slice(0,18):'by COG value',null)}
      </div>`;
    })()}

    <!-- PREP SUMMARY (top) -->
    <div style="background:var(--bg2);border:1px solid rgba(251,191,36,.25);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.1em;">Prep Fee — ${rlabel}</div>
        <button onclick="openPrepExplorer('mtd')" style="padding:6px 14px;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);color:#fbbf24;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">🧮 Prep Fee Explorer — breakdown · trend · any month ▸</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
        ${[['Total inc. VAT',fmtGBP2(prepTotal),'#fbbf24'],['Per unit',pc.tieredUnits>0?'£'+(prepTotal/(totalUnits||1)).toFixed(2):'—','#fb923c'],['Per shipment',prepShips>0?'£'+(prepTotal/prepShips).toFixed(2):'—','#34d399'],['COG : Prep ratio',efficiency?efficiency.toFixed(1)+'×':'—','#cc99ff']].map(([l,v,col])=>`<div style="background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1;">${v}</div><div style="font-size:9.5px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.06em;">${l}</div></div>`).join('')}
      </div>
    </div>

    <!-- COG VALUE BY MONTH (clickable) -->
    ${(()=>{const chron=[...monthEntries].reverse();if(!chron.length)return'';const mx=Math.max(...chron.map(([,v])=>v.value),1);
      return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;">
        <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;">COG Value by Month — tap a month to drill in</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:120px;">
          ${chron.map(([k,v])=>{const[y,m]=k.split('-');const h=Math.max(4,Math.round((v.value/mx)*92));const active=insightRange==='m:'+k;return `<div onclick="insightRange='m:${k}';renderInsights();" title="${_MON[+m]} ${y}: ${fmtGBP2(v.value)} · ${fmt(v.units)} units" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;min-width:0;"><div style="font-size:8px;font-family:var(--mono);color:${active?'#ffaa33':'var(--text3)'};white-space:nowrap;">${v.value>=1000?'£'+(v.value/1000).toFixed(0)+'k':'£'+Math.round(v.value)}</div><div style="width:76%;height:${h}px;background:${active?'#ffaa33':'rgba(255,170,51,.35)'};border-radius:3px 3px 0 0;transition:height .2s;"></div><div style="font-size:10.5px;color:${active?'#ffaa33':'var(--text3)'};font-weight:${active?'800':'400'};">${_MON[+m]} '${y.slice(2)}</div></div>`;}).join('')}
        </div>
      </div>`;})()}

    <!-- TREND -->
    <div class="ig-row ig-2">
      <div class="ic" style="align-items:stretch;text-align:left;">
        <div class="ic-title" style="text-align:left;">Weekly Units Sent — Last 8 Weeks</div>
        ${weekTrend.map(x=>bar(x.lbl,x.u,weekMaxU,'#55ff55',fmt(x.u),52)).join('')}
      </div>
      <div class="ic" style="align-items:stretch;text-align:left;">
        <div class="ic-title" style="text-align:left;">Weekly COG Value — Last 8 Weeks</div>
        ${weekTrend.map(x=>bar(x.lbl,x.v,weekMaxV,'#ffaa33',fmtGBP(x.v),52)).join('')}
      </div>
    </div>

    <!-- COMPOSITION -->
    <div class="ig-row ig-2">
      <div class="ic" style="align-items:stretch;text-align:left;">
        <div class="ic-title" style="text-align:left;">Volume Composition (units)</div>
        ${[['Stock',stockUnits,'#5599ff'],['Lavarion',lavUnits,'#cc99ff']].map(([l,u,c])=>bar(l,u,totalUnits||1,c,`${fmt(u)} · ${Math.round(u/(totalUnits||1)*100)}%`,70)).join('')}
      </div>
      <div class="ic" style="align-items:stretch;text-align:left;">
        <div class="ic-title" style="text-align:left;">Stock Type Breakdown (units)</div>
        ${[['Standard',stdUnits,'#5599ff'],['DG',dgUnits,'#ff5555'],['Oversize',osUnits,'#ffaa33']].map(([l,u,c])=>bar(l,u,stockUnits||1,c,`${fmt(u)} · ${Math.round(u/(stockUnits||1)*100)}%`,70)).join('')}
      </div>
    </div>

    <!-- SUPPLIER ANALYSIS -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:6px;border-bottom:2px solid var(--border);margin-top:6px;">
      <div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.1em;">Supplier Analysis</div>
      <button onclick="openAllSuppliersModal()" style="padding:6px 16px;background:var(--btn-amber-bg);border:1px solid var(--btn-amber-border);color:var(--btn-amber-text);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.04em;">View All Suppliers ↗</button>
    </div>
    <div class="ig-row ig-3" style="margin-top:8px;">
      ${supEntries.slice(0,3).map(([s,v])=>{const avgCog=v.units?(v.value/v.units).toFixed(2):'—';const avgDays=v.days.length?Math.round(v.days.reduce((a,b)=>a+b,0)/v.days.length):'—';return`<div class="ic" style="cursor:pointer;border-top:3px solid var(--accent);" onclick="openSupplierModal('${s.replace(/'/g,"\\'")}')"><div class="ic-title">${s}</div><div class="ic-val" style="color:#55ff55;font-size:22px;">${fmt(v.units)}</div><div class="ic-sub">units · ${fmtGBP2(v.value)}</div><div style="display:flex;gap:8px;margin-top:6px;justify-content:center;flex-wrap:wrap;"><span style="font-size:11px;color:var(--text3);">£${avgCog}/u</span>${avgDays!=='—'?`<span style="font-size:11px;color:var(--text3);">${avgDays}d transit</span>`:''}${v.issues>0?`<span style="font-size:11px;color:#ff5555;">${v.issues} issues</span>`:''}</div></div>`;}).join('')}
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      <table style="min-width:unset;width:100%;"><thead style="position:static;"><tr>
        <th class="th-left">Supplier</th><th>Units</th><th>COG Value</th><th>Avg COG/U</th><th>Avg Transit</th><th>Issues</th><th>Issue Value</th><th>Issue Rate</th>
      </tr></thead><tbody>
      ${(()=>{const active=supEntries.filter(([,v])=>v.units>0||v.issues>0).slice(0,5);return active.length?active.map(([s,v])=>{const avgCog=v.units?(v.value/v.units).toFixed(2):'—';const avgDays=v.days.length?Math.round(v.days.reduce((a,b)=>a+b,0)/v.days.length):'—';const ir=v.units?(v.issues/v.units*100).toFixed(1)+'%':'—';return`<tr onclick="openSupplierModal('${s.replace(/'/g,"\\'")}')" style="cursor:pointer;" onmouseover="this.style.background='rgba(245,158,11,.05)'" onmouseout="this.style.background=''"><td class="td-left" style="font-weight:600;">${s} <span style="font-size:11px;color:var(--accent);opacity:.7;">↗</span></td><td style="font-family:var(--mono);font-weight:700;color:#55ff55;">${fmt(v.units)}</td><td style="font-family:var(--mono);font-weight:700;color:#ffaa33;">${fmtGBP(v.value)}</td><td style="font-family:var(--mono);">£${avgCog}</td><td style="font-family:var(--mono);color:${avgDays>10?'#ffaa33':avgDays!=='—'?'#55ff55':'var(--text3)'};">${avgDays!=='—'?avgDays+'d':'—'}</td><td style="font-family:var(--mono);color:${v.issues>0?'#ff5555':'#55ff55'};">${fmt(v.issues)}</td><td style="font-family:var(--mono);color:${v.issueVal>0?'#ff5555':'var(--text3)'};">${v.issueVal>0?fmtGBP(v.issueVal):'—'}</td><td style="font-family:var(--mono);color:${parseFloat(ir)>5?'#ff5555':parseFloat(ir)>0?'#ffaa33':'#55ff55'};">${ir}</td></tr>`;}).join('')+(supEntries.filter(([,v])=>v.units>0||v.issues>0).length>5?`<tr><td colspan="8" style="text-align:center;padding:10px;"><button onclick="openAllSuppliersModal()" style="padding:5px 14px;background:var(--btn-amber-bg);border:1px solid var(--btn-amber-border);color:var(--btn-amber-text);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">View all ${supEntries.filter(([,v])=>v.units>0||v.issues>0).length} suppliers ↗</button></td></tr>`:''):`<tr><td colspan="8"><div style="padding:16px;color:var(--text3);text-align:center;">No sent data for this period</div></td></tr>`;})()}
      </tbody></table>
    </div>

    <!-- ACCOUNT ANALYSIS (new) -->
    ${sectionHead('Account Analysis')}
    <div class="ig-row ig-2">
      <div class="ic" style="align-items:stretch;text-align:left;"><div class="ic-title" style="text-align:left;">Units Sent by Account</div>
        ${acctEntries.length?acctEntries.map(([a,v])=>bar(a,v.units,acctMaxU,'#60a5fa',`${fmt(v.units)} · ${fmtGBP(v.value)}`,90)).join(''):`<div style="color:var(--text3);font-size:11px;padding:8px;text-align:center;">No account data</div>`}
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <table style="min-width:unset;width:100%;"><thead style="position:static;"><tr><th class="th-left">Account</th><th>Units</th><th>COG Value</th><th>Shipments</th><th>Issues</th></tr></thead><tbody>
        ${acctEntries.length?acctEntries.map(([a,v])=>`<tr onclick="openAccountModal('${a.replace(/'/g,"\\'")}')" style="cursor:pointer;" onmouseover="this.style.background='rgba(96,165,250,.06)'" onmouseout="this.style.background=''"><td class="td-left" style="font-weight:600;">${a} <span style="font-size:11px;color:var(--accent);opacity:.7;">↗</span></td><td style="font-family:var(--mono);font-weight:700;color:#55ff55;">${fmt(v.units)}</td><td style="font-family:var(--mono);color:#ffaa33;">${fmtGBP(v.value)}</td><td style="font-family:var(--mono);color:var(--text2);">${v.ships.size}</td><td style="font-family:var(--mono);color:${v.issues>0?'#ff5555':'var(--text3)'};">${v.issues||'—'}</td></tr>`).join(''):`<tr><td colspan="5"><div style="padding:16px;color:var(--text3);text-align:center;">No account data</div></td></tr>`}
        </tbody></table>
      </div>
    </div>

    <!-- CLAIMS & ISSUES (from claims array) -->
    ${sectionHead('Claims & Issues')}
    <div class="ig-row ig-4">
      ${kpi('Missing',fmt(missingUnits),`${fmtGBP2(missingVal)} · ${missingC.length} claim${missingC.length!==1?'s':''}`,missingUnits>0?'#ff5555':'#55ff55',missingUnits>0?'#ff5555':'')}
      ${kpi('Damaged',fmt(damagedUnits),`${fmtGBP2(damagedVal)} · ${damagedC.length} claim${damagedC.length!==1?'s':''}`,damagedUnits>0?'#ff5555':'#55ff55',damagedUnits>0?'#ff5555':'')}
      ${kpi('Open £ At Risk',fmtGBP2(totalAtRisk),`${openClaims.length} open claim${openClaims.length!==1?'s':''}`,totalAtRisk>0?'#ff5555':'#55ff55',totalAtRisk>0?'#ff5555':'')}
      ${kpi('Recovered',fmtGBP2(recovered),stillOwed>0?`${fmtGBP2(stillOwed)} still owed`:`${resolvedClaims.length} resolved`,'#55ff55','#55ff55')}
    </div>
    ${claims.length?`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      <div style="padding:10px 14px;font-size:10px;font-weight:800;color:var(--accent);border-bottom:1px solid var(--border);">All Actions &amp; Claims (${claims.length})</div>
      <table style="min-width:unset;width:100%;"><thead style="position:static;"><tr>
        <th>Raised</th><th class="th-left">Supplier</th><th class="th-left">Account</th><th class="th-left">SKU</th><th>Type</th><th>Units</th><th>Value</th><th>Status</th><th>Days Open</th>
      </tr></thead><tbody>
      ${[...claims].sort((a,b)=>(b.raisedAt||'').localeCompare(a.raisedAt||'')).map(c=>{const daysOpen=c.raisedAt?Math.floor((new Date()-new Date(c.raisedAt))/864e5):0;const st=cStatus(c);const isOpen=st!=='Resolved';const statusCol=st==='Issue'?'#ff5555':st==='Open'?'#f97316':st==='Chasing'?'#fbbf24':'#4ade80';return`<tr><td style="font-size:10px;">${(c.raisedAt||c.date||'—').toString().slice(0,10)}</td><td class="td-left" style="font-weight:600;">${c.sup||'—'}</td><td class="td-left" style="font-size:10px;color:var(--text2);">${c.acct||'—'}</td><td class="td-left" style="font-size:10px;font-family:var(--mono);">${(c.sku||'').substring(0,22)}</td><td style="font-size:10px;color:#ff9999;">${c.issT||'—'}</td><td style="font-family:var(--mono);color:#ff5555;">${c.dif||0}</td><td style="font-family:var(--mono);color:#ffaa33;">${fmtGBP(c.claimValue||0)}</td><td style="font-size:10px;font-weight:700;color:${statusCol};">${st}</td><td style="font-family:var(--mono);color:${isOpen&&daysOpen>14?'#ff5555':isOpen?'#ffaa33':'var(--text3)'};">${isOpen?daysOpen+'d':'—'}</td></tr>`;}).join('')}
      </tbody></table>
    </div>`:`<div style="color:var(--text3);font-size:11px;padding:8px 0;">No claims or actions raised yet</div>`}

    <!-- LAVARION DEEP DIVE -->
    ${sectionHead('Lavarion Deep-Dive')}
    <div class="ig-row ig-4">
      ${kpi('Lavarion Units ('+rlabel+')',fmt(lavUnits),fmtGBP2(lavValue),'#cc99ff','#cc99ff')}
      ${kpi('Lavarion Shipments',fmt(lavShipIds.size),'FBA IDs','#cc99ff')}
      ${kpi('Active ASINs',fmt(lavAsins.length),'products on file','#cc99ff')}
      ${kpi('All-Time Lavarion',fmt(lavShipments.reduce((a,s)=>a+(s.units||0),0)),fmtGBP2(lavShipments.reduce((a,s)=>a+((s.cost||0)*(s.units||0)),0)),'#55ff55','#55ff55')}
    </div>
    <div class="ig-row ig-2">
      <div class="ic" style="align-items:stretch;text-align:left;"><div class="ic-title" style="text-align:left;">Lavarion Shipments (last 10)</div>
        ${lavShipments.length?`<table style="width:100%;min-width:unset;border:none;"><thead style="position:static;"><tr><th style="font-size:11px;padding:3px 6px;background:none;border:none;color:var(--text3);text-align:left;">Date</th><th class="th-left" style="font-size:11px;padding:3px 6px;background:none;border:none;color:var(--text3);">Product</th><th style="font-size:11px;padding:3px 6px;background:none;border:none;color:var(--text3);">Units</th><th style="font-size:11px;padding:3px 6px;background:none;border:none;color:var(--text3);">Total</th></tr></thead><tbody>${[...lavShipments].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,10).map(s=>`<tr><td style="font-size:10px;font-family:var(--mono);color:var(--text3);padding:3px 6px;border-color:var(--border);">${s.date||'—'}</td><td class="td-left" style="font-size:10px;padding:3px 6px;border-color:var(--border);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.prod}">${s.prod}</td><td style="font-family:var(--mono);font-weight:700;color:#55ff55;padding:3px 6px;border-color:var(--border);">${s.units}</td><td style="font-family:var(--mono);font-weight:700;color:#ffaa33;padding:3px 6px;border-color:var(--border);">${fmtGBP2((s.cost||0)*(s.units||0))}</td></tr>`).join('')}</tbody></table>`:`<div style="color:var(--text3);font-size:11px;padding:8px 0;text-align:center;">No Lavarion shipments yet</div>`}
      </div>
      <div class="ic" style="align-items:stretch;text-align:left;"><div class="ic-title" style="text-align:left;">Top Lavarion ASINs (all-time units)</div>
        ${(()=>{const g={};lavShipments.forEach(s=>{const k=s.asin||s.sku||s.prod||'?';if(!g[k])g[k]={u:0,v:0,prod:s.prod||k};g[k].u+=s.units||0;g[k].v+=(s.cost||0)*(s.units||0);});const e=Object.values(g).sort((a,b)=>b.u-a.u).slice(0,8);const mx=Math.max(...e.map(x=>x.u),1);return e.length?e.map(x=>bar((x.prod||'').slice(0,16),x.u,mx,'#cc99ff',`${fmt(x.u)} · ${fmtGBP(x.v)}`,100)).join(''):`<div style="color:var(--text3);font-size:11px;padding:8px;text-align:center;">No data</div>`;})()}
      </div>
    </div>

    <!-- PREP COST -->
    <div style="background:var(--bg2);border:1px solid rgba(251,191,36,.25);border-radius:8px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.1em;">Implied Prep Cost — ${rlabel}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
        ${[['Total inc. VAT',fmtGBP2(prepTotal),'#fbbf24'],['Per prep day',prepDays>0?'£'+(prepTotal/prepDays).toFixed(2):'—','#60a5fa'],['Per shipment',prepShips>0?'£'+(prepTotal/prepShips).toFixed(2):'—','#34d399'],['COG : Prep ratio',efficiency?efficiency.toFixed(1)+'×':'—','#cc99ff']].map(([l,v,col])=>`<div style="background:var(--bg3);border-radius:6px;padding:10px;text-align:center;"><div style="font-size:18px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};">${v}</div><div style="font-size:10.5px;color:#94a3b8;margin-top:2px;">${l}</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:6px;">Cost breakdown</div>
          ${[[fmt(pc.tieredUnits)+' units × '+(pc.unitRate<1?(pc.unitRate*100).toFixed(0)+'p':fmtGBP2(pc.unitRate))+' (band '+pc.unitRateBand+')',fmtGBP2(pc.baseCost),'#fbbf24'],...(pc.osCost>0?[[pc.osUnits+' OS × £'+prepFees.osCostPerUnit,fmtGBP2(pc.osCost),'#fb923c']]:[]),...(pc.bundleCost>0?[[pc.bundleUnits+' bundle × £'+prepFees.bundleCostPerUnit,fmtGBP2(pc.bundleCost),'#34d399']]:[]),[pc.totalBoxes+' boxes × £'+prepFees.boxCost,fmtGBP2(pc.boxCostTotal),'#60a5fa'],...(pc.dgExtra>0?[[pc.dgBoxes+' DG boxes × £'+prepFees.dgExtraPerBox,fmtGBP2(pc.dgExtra),'#f87171']]:[]),['VAT 20%','£'+(pc.withVat-pc.subtotal).toFixed(2),'#94a3b8'],['Total inc. VAT',fmtGBP2(pc.withVat),'#fbbf24']].map(([l,v,col])=>`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:10px;color:#94a3b8;">${l}</span><span style="font-size:11px;font-weight:700;font-family:var(--mono);color:${col};">${v}</span></div>`).join('')}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:6px;">Cost by prep day (recent)</div>
          ${[...new Set(lines.map(l=>l.date))].filter(Boolean).sort().reverse().slice(0,8).map(ds=>{const dR=oaForPrep.filter(o=>oaLines.some(l=>l.date===ds&&l.sku===o.sku&&l.shipId===o.shipId));const dRb=oaLines.filter(l=>l.date===ds).reduce((m,l)=>{const key=l.sku+'|'+l.shipId;if(!m[key])m[key]={sku:l.sku,shipType:l.type,shipId:l.shipId,inBundle:(rows.find(r=>r.sku===l.sku)||{}).inBundle||'No',_segUnits:0};m[key]._segUnits+=l.units;return m;},{});const dRows=Object.values(dRb);const dL=lavLines.filter(l=>l.date===ds).map(l=>({...l,cost:l.units?l.value/l.units:0}));const dIds=new Set([...dRows.filter(r=>r.shipId).map(r=>r.shipId),...dL.filter(s=>s.shipId).map(s=>s.shipId)]);const dB=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>dIds.has(sid)));const dc=calcImpliedPrepCost(dRows,dL,dB);return`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:10px;color:#94a3b8;">${ds}</span><span style="font-size:11px;font-weight:700;font-family:var(--mono);color:#fbbf24;">${fmtGBP2(dc.withVat)}</span></div>`;}).join('')}
        </div>
      </div>
    </div>

    <!-- MONTHLY HISTORY (permanent) -->
    ${sectionHead('Monthly History (all-in) — tap a month to view it')}
    ${(()=>{
      const chron=[...monthEntries].reverse(); // oldest → newest
      if(!chron.length)return'';
      const mxU=Math.max(...chron.map(([,v])=>v.units),1);
      return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:10px;">
        <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;">Units Sent by Month — tap a bar</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:130px;">
          ${chron.map(([k,v])=>{const[y,m]=k.split('-');const h=Math.max(4,Math.round((v.units/mxU)*100));const active=insightRange==='m:'+k;return `<div onclick="insightRange='m:${k}';renderInsights();" title="${_MON[+m]} ${y}: ${fmt(v.units)} units · prep ${fmtGBP2(v.prep)}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;min-width:0;">
            <div style="font-size:9px;font-family:var(--mono);color:${active?'#55ff55':'var(--text3)'};font-weight:700;white-space:nowrap;">${fmt(v.units)}</div>
            <div style="width:76%;height:${h}px;background:${active?'#55ff55':'rgba(85,255,85,.35)'};border-radius:3px 3px 0 0;transition:height .2s;"></div>
            <div style="font-size:9px;color:${active?'#55ff55':'var(--text3)'};font-weight:${active?'800':'400'};white-space:nowrap;">${_MON[+m]} '${y.slice(2)}</div>
          </div>`;}).join('')}
        </div>
      </div>`;
    })()}
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      <table style="min-width:unset;width:100%;"><thead style="position:static;"><tr><th class="th-left">Month</th><th>Units Sent</th><th>COG Value</th><th>Prep Cost</th><th>COG : Prep</th></tr></thead><tbody>
      ${monthEntries.length?monthEntries.map(([k,v])=>{const[y,m]=k.split('-');const lbl=_MON[+m]+' '+y;const ratio=v.prep>0?(v.value/v.prep).toFixed(1)+'×':'—';const active=insightRange==='m:'+k;return`<tr onclick="insightRange='m:${k}';renderInsights();" style="cursor:pointer;${active?'background:rgba(85,255,85,.06);':''}" onmouseover="this.style.background='rgba(245,158,11,.05)'" onmouseout="this.style.background='${active?'rgba(85,255,85,.06)':''}'"><td class="td-left" style="font-weight:600;">${lbl} <span style="font-size:11px;color:var(--accent);opacity:.7;">↗</span></td><td style="font-family:var(--mono);font-weight:700;color:#55ff55;">${fmt(v.units)}</td><td style="font-family:var(--mono);color:#ffaa33;">${fmtGBP(v.value)}</td><td style="font-family:var(--mono);color:#cc99ff;">${fmtGBP2(v.prep)}</td><td style="font-family:var(--mono);color:var(--text2);">${ratio}</td></tr>`;}).join(''):`<tr><td colspan="5"><div style="padding:16px;color:var(--text3);text-align:center;">No history yet</div></td></tr>`}
      </tbody></table>
    </div>

  </div>`;
}

// ── INSIGHTS ENGINE ───────────────────────────────────────────────────────────
let _insTab='all';

function openPrepHistory(){
  om('prepHistoryModal');
  switchInsTab('all');
  // Keyboard nav for insights modal
  document.getElementById('prepHistoryModal')._kbHandler=function(e){
    if(!document.getElementById('prepHistoryModal').classList.contains('active'))return;
    const tabs=['week','mtd','lastmonth','30d','90d','ytd','all','custom','monthly'];
    const cur=tabs.indexOf(_insTab);
    if(e.key==='ArrowLeft'&&cur>0){switchInsTab(tabs[cur-1]);e.preventDefault();}
    else if(e.key==='ArrowRight'&&cur<tabs.length-1){switchInsTab(tabs[cur+1]);e.preventDefault();}
    else if(e.key==='Escape'){cm('prepHistoryModal');}
    else{
      const num=parseInt(e.key);
      if(num>=1&&num<=tabs.length){switchInsTab(tabs[num-1]);e.preventDefault();}
    }
  };
  document.addEventListener('keydown',document.getElementById('prepHistoryModal')._kbHandler);
}

function switchInsTab(tab){
  _insTab=tab;
  const tabs=['week','mtd','lastmonth','30d','90d','ytd','all','custom','monthly'];
  tabs.forEach(t=>{
    const btn=document.getElementById('insModalTab-'+t);
    if(btn){
      btn.style.background=t===tab?'var(--accent)':'var(--bg3)';
      btn.style.color=t===tab?'#000':'var(--text3)';
      btn.style.borderColor=t===tab?'var(--accent)':'var(--border2)';
    }
  });
  // Show/hide custom date fields
  const customDates=document.getElementById('insModalCustomDates');
  if(customDates)customDates.style.display=tab==='custom'?'flex':'none';
  renderInsightsTab(tab);
}

function buildMonthMap(filterFn){
  const map={};
  const addRow=(key,label,r)=>{
    if(!map[key])map[key]={label,rows:[],lavRows:[],shipIds:new Set()};
    map[key].rows.push(r);
    if(r.shipId)map[key].shipIds.add(r.shipId);
  };
  const addLav=(key,label,s)=>{
    if(!map[key])map[key]={label,rows:[],lavRows:[],shipIds:new Set()};
    map[key].lavRows.push(s);
    if(s.shipId)map[key].shipIds.add(s.shipId);
  };
  /* Part Sent rows shipped real units too — they count in the month they went */
  rows.filter(r=>r.sentDate&&(r.sent==='Yes'||(parseInt(r.ship)||0)>0)&&(!filterFn||filterFn(r.sentDate))).forEach(r=>{
    const[y,m]=r.sentDate.split('-');
    const key=y+'-'+m;
    addRow(key,new Date(+y,+m-1,1).toLocaleString('en-GB',{month:'long',year:'numeric'}),r);
  });
  lavShipments.filter(s=>s.date&&(!filterFn||filterFn(s.date))).forEach(s=>{
    const[y,m]=s.date.split('-');
    const key=y+'-'+m;
    addLav(key,new Date(+y,+m-1,1).toLocaleString('en-GB',{month:'long',year:'numeric'}),s);
  });
  return map;
}

function calcInsMetrics(sentRowsArr,lavArr,boxMap,rateUnits){
  const pc=calcImpliedPrepCost(sentRowsArr,lavArr,boxMap||{},rateUnits);
  const skus=new Set(sentRowsArr.map(r=>r.sku)).size;
  const asins=new Set(sentRowsArr.map(r=>r.asin).filter(Boolean)).size;
  const cog=sentRowsArr.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.ship||0)),0);
  const lavCog=lavArr.reduce((a,s)=>a+((s.cost||0)*(s.units||0)),0);
  const ships=new Set([...sentRowsArr.map(r=>r.shipId),...lavArr.map(s=>s.shipId)].filter(Boolean)).size;
  return{...pc,skus,asins,cog:cog+lavCog,ships};
}

function kpiCard(label,value,sub,col){
  return`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px 16px;flex:1;min-width:120px;">
    <div style="font-size:10px;font-weight:700;color:${col||'var(--accent)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${label}</div>
    <div style="font-size:20px;font-weight:800;color:var(--text);font-family:var(--num);font-variant-numeric:tabular-nums;">${value}</div>
    ${sub?`<div style="font-size:10px;color:var(--text3);margin-top:3px;">${sub}</div>`:''}
  </div>`;
}

function insBarChart(monthData,valueKey,label,col){
  if(!monthData.length)return'';
  const max=Math.max(...monthData.map(d=>d[valueKey]||0),1);
  return`<div style="margin-top:16px;">
    <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">${label} — Monthly Trend</div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:80px;padding:0 2px;">
      ${monthData.slice().reverse().map(d=>{
        const h=Math.round(((d[valueKey]||0)/max)*72);
        return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;" title="${d.label}: ${d[valueKey]}">
          <div style="width:100%;background:${col||'var(--accent)'};border-radius:2px 2px 0 0;height:${h}px;min-height:2px;opacity:.8;transition:opacity .2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.8"></div>
          <div style="font-size:8px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center;">${d.shortLabel}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderInsightsTab(tab){
  const body=document.getElementById('prepHistoryBody');

  if(tab==='monthly'){renderInsMonthly(body);return;}

  // Use existing insightRange system — temporarily set insightRange to match tab
  const prevRange=insightRange;
  const tabToRange={week:'week',mtd:'mtd',lastmonth:'lastmonth','30d':'30d','90d':'90d',ytd:'ytd',all:'all',custom:'custom'};

  // lastmonth not in insightRange system — handle manually
  if(tab==='lastmonth'){
    const now=new Date();
    const lastM=now.getMonth()===0?12:now.getMonth();
    const lastMY=now.getMonth()===0?now.getFullYear()-1:now.getFullYear();
    const lastMStr=String(lastM).padStart(2,'0');
    const lastMYStr=String(lastMY);
    const filter=d=>d&&d>=`${lastMYStr}-${lastMStr}-01`&&d<=`${lastMYStr}-${lastMStr}-31`;
    const map=buildMonthMap(filter);
    const allRows=Object.values(map).flatMap(m=>m.rows);
    const allLav=Object.values(map).flatMap(m=>m.lavRows);
    const allShipIds=new Set(Object.values(map).flatMap(m=>[...m.shipIds]));
    const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>allShipIds.has(sid)));
    renderInsPanel(body,allRows,allLav,bm,'Last Month',false);
    return;
  }

  // For custom — read from modal date inputs
  let rs,re,label;
  if(tab==='custom'){
    rs=document.getElementById('insModalFrom')?.value||todayISO();
    re=document.getElementById('insModalTo')?.value||todayISO();
    label=`${rs} → ${re}`;
  }else{
    insightRange=tabToRange[tab]||'all';
    const range=getInsightRange();
    rs=range.s;re=range.e;label=range.label;
    insightRange=prevRange;
  }

  const filter=d=>d&&d>=rs&&d<=re;
  const map=buildMonthMap(filter);
  const allRows=Object.values(map).flatMap(m=>m.rows);
  const allLav=Object.values(map).flatMap(m=>m.lavRows);
  const allShipIds=new Set(Object.values(map).flatMap(m=>[...m.shipIds]));
  const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>allShipIds.has(sid)));
  const showChart=tab==='all'||tab==='ytd'||tab==='90d'||tab==='custom';
  renderInsPanel(body,allRows,allLav,bm,label,showChart);
}

// Month-by-month PREP COST comparison. Powers the "Month by Month" tab in the
// Insights popup (the renderer was previously missing, so the tab showed nothing).
// Prep-focused per request: each month's prep cost inc. VAT, units, £/unit and the
// change vs the previous month. Uses the same prep helpers as the rest of Insights.
/* Jack, 30 Aug: "I'd like Prep Cost MTD clickable — this month, last month,
   2 months ago…" The table already existed on Insights; now it opens right
   off the Dashboard card. */
function openPrepHistory(){
  let el=document.getElementById('prepHistModal');
  if(!el){el=document.createElement('div');el.id='prepHistModal';el.className='overlay';
    el.style.zIndex='130';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)el.style.display='none';});}
  el.innerHTML=`<div class="modal" style="max-width:1040px;max-height:88vh;overflow:auto;padding:20px 22px;">
    <div class="pcmHdr">
      <div>
        <div class="pcmTtl">Prep cost — month by month</div>
        <div class="pcmSub">What the warehouse bill should come to, worked out from what was sent. Click a month for the full breakdown.</div>
      </div>
      <button class="pcmX" onclick="document.getElementById('prepHistModal').style.display='none'" title="Close">&#10005;</button></div>
    <div id="prepHistBody"></div></div>`;
  el.style.display='flex';
  try{renderInsMonthly(document.getElementById('prepHistBody'));}
  catch(e){document.getElementById('prepHistBody').innerHTML='<div class="pmeta">Could not build the history: '+String(e).slice(0,120)+'</div>';}
}
/* Jack, 5 Sep: "I wanna know each month's in-depth info — units, shipments,
   boxes, cost, VAT etc." One row per month; open it and the whole bill is
   there: every unit type at its rate, the boxes, ex-VAT, VAT, inc-VAT, what
   went out, and the shipments that made it up. */
let _pcmOpen=null;
function pcmToggle(key){_pcmOpen=(_pcmOpen===key)?null:key;const b=document.getElementById('prepHistBody');if(b)renderInsMonthly(b);}
function _pcmShipments(md,key){
  /* the shipments inside one month — rows may be split across shipments, so
     each segment is placed under its own ID with only its own units */
  const S={};
  const put=(sid,date,type)=>{if(!S[sid])S[sid]={id:sid,date:date||'',type:type||'Standard',units:0,lav:0,boxes:(typeof shipBoxes!=='undefined'&&shipBoxes[sid])||0,skus:new Set()};return S[sid];};
  md.rows.forEach(r=>{
    const segs=normaliseSegments(r);
    if(segs.length){segs.forEach(seg=>{if(!seg.shipId)return;const d=String(seg.date||r.sentDate||'');if(d.slice(0,7)!==key)return;
      const x=put(seg.shipId,d,_shipTypeCache[seg.shipId]||seg.type||r.shipType);x.units+=seg.units||0;if(r.sku)x.skus.add(r.sku);});}
    else if(r.shipId){const x=put(r.shipId,r.sentDate,_shipTypeCache[r.shipId]||r.shipType);x.units+=r.ship||0;if(r.sku)x.skus.add(r.sku);}
  });
  md.lavRows.forEach(l=>{if(!l.shipId)return;const x=put(l.shipId,l.date,_shipTypeCache[l.shipId]);x.lav+=l.units||0;});
  return Object.values(S).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
/* Jack, 8 Sep: "information on the popup is great, the UI/UX design is a bit
   meh… looks cartoony." Same numbers, house style: colour on the top border and
   on the figure, never a wash; slim bars with their value on top, an average
   line to read them against, and the running month marked as partial. */
function _pcmKpi(label,value,sub,col){
  return `<div class="pcmKpi" style="border-top-color:${col};">
    <div class="pcmKpiL">${label}</div>
    <div class="pcmKpiV" style="color:${col};">${value}</div>
    ${sub?`<div class="pcmKpiS">${sub}</div>`:''}
  </div>`;
}
function _pcmChart(months,avg){
  if(months.length<2)return '';
  const data=months.slice().reverse();                 // oldest → newest, left to right
  const max=Math.max(...data.map(d=>d.prep),1);
  const now=new Date();const curKey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const gbp0=v=>'£'+Math.round(v||0).toLocaleString('en-GB');
  return `<div class="pcmChart">
    <div class="pcmChartH"><span>Prep cost inc. VAT — month by month</span>
      <span class="pcmAvg">average ${gbp0(avg)} a month</span></div>
    <div class="pcmPlot">
      ${data.map(d=>{
        const h=Math.max(3,Math.round((d.prep/max)*100));
        const part=d.key===curKey;
        return `<div class="pcmB${part?' part':''}" title="${esc(d.label)} — ${gbp0(d.prep)} inc. VAT · ${fmt(d.units)} units · ${fmt(d.ships)} shipments">
          <span class="pcmBv">${gbp0(d.prep)}</span>
          <span class="pcmBk" style="height:${h}%;"></span>
          <span class="pcmBl">${esc(d.shortLabel)}${part?' <i>so far</i>':''}</span>
        </div>`;}).join('')}
    </div>
  </div>`;
}
function renderInsMonthly(body){
  const map=buildMonthMap(null);
  const entries=Object.entries(map).sort(([a],[b])=>b.localeCompare(a)); // newest first
  if(!entries.length){body.innerHTML='<div style="color:var(--text3);text-align:center;padding:40px;">No shipment history yet.</div>';return;}
  const months=entries.map(([key,md])=>{
    const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>md.shipIds.has(sid)));
    const m=calcInsMetrics(md.rows,md.lavRows,bm);
    const[y,mm]=key.split('-');
    return{key,md,m,label:md.label,
      shortLabel:new Date(+y,+mm-1,1).toLocaleString('en-GB',{month:'short'})+" '"+y.slice(2),
      units:m.totalUnits||0,boxes:m.totalBoxes||0,ships:m.ships||0,prep:m.withVat||0,ex:m.subtotal||0,cog:m.cog||0,
      ppu:(m.totalUnits>0)?(m.withVat/m.totalUnits):0};
  });
  if(_pcmOpen===null&&months.length)_pcmOpen=months[0].key;
  const totPrep=months.reduce((a,m)=>a+m.prep,0),totUnits=months.reduce((a,m)=>a+m.units,0);
  const totShips=months.reduce((a,m)=>a+m.ships,0),totBoxes=months.reduce((a,m)=>a+m.boxes,0);
  const avgPrep=months.length?totPrep/months.length:0,avgPerUnit=totUnits>0?totPrep/totUnits:0;
  const maxPrep=Math.max(...months.map(m=>m.prep),1);
  const vatPct=Math.round(((prepFees.vatRate||1.2)-1)*100);
  const money=v=>fmtGBP2(v||0);
  const pct=(cur,prev)=>prev>0?((cur-prev)/prev*100):null;
  const dChip=(cur,prev,goodDown,fmtFn)=>{const p=pct(cur,prev);if(p===null)return '<span class="pcmD n">—</span>';
    const up=p>0.05,dn=p<-0.05;const good=goodDown?dn:up;const bad=goodDown?up:dn;
    return `<span class="pcmD ${good?'g':bad?'b':'n'}" title="${prev!=null?'was '+(fmtFn?fmtFn(prev):prev):''}">${up?'▲':dn?'▼':'→'} ${Math.abs(p).toFixed(1)}%</span>`;};
  const head=`
    <div class="pcmKpis">
      ${_pcmKpi('Months tracked',fmt(months.length),'with shipment activity','#60a5fa')}
      ${_pcmKpi('Total prep',money(totPrep),`inc. VAT · ${money(totPrep/(prepFees.vatRate||1.2))} ex. VAT`,'#fbbf24')}
      ${_pcmKpi('Average a month',money(avgPrep),'across every month tracked','#f59e0b')}
      ${_pcmKpi('Average a unit','£'+avgPerUnit.toFixed(2),`over ${fmt(totUnits)} units`,'#34d399')}
      ${_pcmKpi('Shipments',fmt(totShips),`${fmt(totBoxes)} boxes · ${totShips?(totUnits/totShips).toFixed(0):'—'} units each`,'#c084fc')}
    </div>`;
  const chart=_pcmChart(months,avgPrep);
  const detail=(m,prev)=>{
    const M=m.m;const rateStr=r=>r==null?'—':(r<1?(r*100).toFixed(0)+'p':'£'+r.toFixed(2));
    const vat=(M.withVat||0)-(M.subtotal||0);
    const line=(lab,sub,val,col)=>`<div class="pcmLine"><div><b>${lab}</b>${sub?`<span>${sub}</span>`:''}</div><div class="pcmVal" style="${col?'color:'+col:''}">${val}</div></div>`;
    const bill=`<div class="pcmCol"><div class="pcmColH">The bill — how it is worked out</div>
      ${line('Volume-rate units',`${fmt(M.tieredUnits||0)} × ${rateStr(M.unitRate)} · ${esc(M.unitRateBand||'')} band · standard ${fmt(M.stdUnits||0)}, DG ${fmt(M.dgUnits||0)}, Lavarion ${fmt(M.lavUnits||0)}`,money(M.baseCost))}
      ${M.osUnits?line('Oversize',`${fmt(M.osUnits)} × £${(prepFees.osCostPerUnit||0).toFixed(2)}`,money(M.osCost)):''}
      ${M.bundleUnits?line('Bundled units',`${fmt(M.bundleUnits)} × £${(prepFees.bundleCostPerUnit||0).toFixed(2)}`,money(M.bundleCost)):''}
      ${line('Boxes',`${fmt(M.totalBoxes||0)} × £${(prepFees.boxCost||0).toFixed(2)}${M.dgBoxes?` · ${fmt(M.dgBoxes)} of them DG`:''}`,money(M.boxCostTotal))}
      ${line('Subtotal','ex. VAT',money(M.subtotal),'var(--text)')}
      ${line('VAT',vatPct+'%',money(vat))}
      <div class="pcmLine pcmTot"><div><b>Total inc. VAT</b></div><div class="pcmVal" style="color:#fbbf24">${money(M.withVat)}</div></div>
    </div>`;
    const out=`<div class="pcmCol"><div class="pcmColH">What went out</div>
      ${line('Units sent','all types',fmt(M.totalUnits||0),'#60a5fa')}
      ${line('Shipments',`${fmt(M.totalBoxes||0)} boxes · ${M.ships?(M.totalUnits/M.ships).toFixed(0):'—'} units each`,fmt(M.ships||0),'#c084fc')}
      ${line('Units per box',M.totalBoxes?'':'no box counts recorded',M.totalBoxes?(M.totalUnits/M.totalBoxes).toFixed(1):'—')}
      ${line('SKUs · ASINs','',`${fmt(M.skus||0)} · ${fmt(M.asins||0)}`)}
      ${line('Stock value sent','COG of what went to Amazon',money(M.cog),'#4ade80')}
      ${line('Prep as % of COG','',M.cog?((M.withVat/M.cog)*100).toFixed(1)+'%':'—')}
    </div>`;
    const per=`<div class="pcmCol"><div class="pcmColH">Per… and vs ${prev?esc(prev.shortLabel):'previous'}</div>
      ${line('Per unit','inc. VAT','£'+(m.ppu||0).toFixed(2),'#fb923c')}
      ${line('Per shipment','',M.ships?'£'+(M.withVat/M.ships).toFixed(2):'—')}
      ${line('Per box','',M.totalBoxes?'£'+(M.withVat/M.totalBoxes).toFixed(2):'—')}
      ${prev?`<div class="pcmLine"><div><b>Prep bill</b><span>${money(prev.prep)} → ${money(m.prep)}</span></div><div>${dChip(m.prep,prev.prep,true,money)}</div></div>
      <div class="pcmLine"><div><b>Units</b><span>${fmt(prev.units)} → ${fmt(m.units)}</span></div><div>${dChip(m.units,prev.units,false,fmt)}</div></div>
      <div class="pcmLine"><div><b>Boxes</b><span>${fmt(prev.boxes)} → ${fmt(m.boxes)}</span></div><div>${dChip(m.boxes,prev.boxes,true,fmt)}</div></div>
      <div class="pcmLine"><div><b>Per unit</b><span>£${prev.ppu.toFixed(2)} → £${m.ppu.toFixed(2)}</span></div><div>${dChip(m.ppu,prev.ppu,true,v=>'£'+v.toFixed(2))}</div></div>`
      :'<div class="pcmLine"><div><span>first month tracked — nothing to compare</span></div></div>'}
    </div>`;
    const ships=_pcmShipments(m.md,m.key);
    const typeCol={Standard:'#60a5fa',DG:'#f87171',Oversize:'#fb923c'};
    const shipTbl=ships.length?`<div class="pcmShips">
      <div class="pcmShipH"><span>Shipment</span><span>Date</span><span>Type</span><span class="r">Units</span><span class="r">Lavarion</span><span class="r">Boxes</span><span class="r">SKUs</span></div>
      ${ships.map(x=>`<div class="pcmShip" onclick="event.stopPropagation();try{openShipment('${esc(x.id)}')}catch(e){}" title="Open this shipment">
        <span class="pcmSid">${esc(x.id)}</span><span>${x.date?_pcmDmy(x.date):'—'}</span>
        <span><i class="pcmType" style="color:${typeCol[x.type]||'#94a3b8'};border-color:${(typeCol[x.type]||'#94a3b8')}55">${esc(x.type||'Standard')}</i></span>
        <span class="r">${fmt(x.units)}</span><span class="r" style="color:${x.lav?'#38bdf8':'var(--text3)'}">${x.lav?fmt(x.lav):'—'}</span>
        <span class="r" style="color:${x.boxes?'var(--text)':'#f87171'}">${x.boxes?fmt(x.boxes):'none'}</span><span class="r">${fmt(x.skus.size)}</span></div>`).join('')}
      </div>`:'<div class="pmeta" style="padding:6px 0 0;">No shipment IDs recorded for this month.</div>';
    return `<div class="pcmDet"><div class="pcmGrid">${bill}${out}${per}</div>${shipTbl}</div>`;
  };
  const rowsHtml=months.map((m,i)=>{
    const prev=months[i+1]||null;const open=_pcmOpen===m.key;
    const barW=Math.round((m.prep/maxPrep)*100);
    return `<div class="pcmRow ${open?'open':''}" onclick="pcmToggle('${m.key}')">
      <div class="pcmMon"><span class="pcmCh">${open?'▾':'▸'}</span>${m.label}</div>
      <div class="pcmBar"><div style="width:${barW}%"></div></div>
      <div class="pcmVal" style="color:#fbbf24">${money(m.prep)}</div>
      <div class="pcmVal" style="color:#60a5fa">${fmt(m.units)}<small>units</small></div>
      <div class="pcmVal" style="color:#c084fc">${fmt(m.ships)}</div>
      <div class="pcmVal">${m.boxes?fmt(m.boxes):'<span style="color:#f87171">none</span>'}</div>
      <div class="pcmVal" style="color:var(--text2)">£${m.ppu.toFixed(2)}</div>
      <div class="pcmVal">${dChip(m.prep,prev?prev.prep:null,true,money)}</div>
    </div>${open?detail(m,prev):''}`;
  }).join('');
  const table=`<div class="pcmTbl">
      <div class="pcmRow pcmHead"><div>Month</div><div></div><div class="pcmVal">Prep inc. VAT</div><div class="pcmVal">Units</div><div class="pcmVal">Shipments</div><div class="pcmVal">Boxes</div><div class="pcmVal">£ / unit</div><div class="pcmVal">vs prev</div></div>
      ${rowsHtml}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.4;">“vs prev” compares each month’s bill to the month before — <span style="color:#f87171;">red ▲</span> spent more, <span style="color:#34d399;">green ▼</span> spent less. Boxes showing <span style="color:#f87171;">none</span> means nobody typed a box count for those shipments, so that month’s bill is missing its box charges. Rates live in Settings → Prep Fees.</div>`;
  body.innerHTML=head+chart+table;
}
function _pcmDmy(iso){const d=new Date(String(iso).slice(0,10)+'T00:00:00');return isNaN(d)?String(iso):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});}

// Holds the metrics + label for the currently-rendered insights panel so the
// "Prep Cost ▸" card can open a detailed breakdown on click.
let _lastInsMet=null,_lastInsLabel='';
let _prepExpPeriod='mtd';
// Sent Mix card: 'week' or 'month' view of the stacked composition bar.
let _mixPeriod='week';
function setMixPeriod(p){_mixPeriod=p;renderDashboard();}

// Resolve a period key to a {s,e,label} date range. Keys: 'mtd', 'lastmonth',
// or a 'YYYY-MM' month key.
function prepExpRange(key){
  const now=new Date();
  if(key==='mtd'){return{s:new Date(now.getFullYear(),now.getMonth(),1),e:now,label:'This Month (MTD)'};}
  if(key==='lastmonth'){return{s:new Date(now.getFullYear(),now.getMonth()-1,1),e:new Date(now.getFullYear(),now.getMonth(),0,23,59,59),label:'Last Month'};}
  const[y,m]=key.split('-').map(Number);
  return{s:new Date(y,m-1,1),e:new Date(y,m,0,23,59,59),label:new Date(y,m-1,1).toLocaleString('en-GB',{month:'long',year:'numeric'})};
}
// Prep metrics for a date range.
function prepExpMetrics(s,e){
  const inR=d=>{if(!d)return false;const x=new Date(d);return x>=s&&x<=e;};
  const sr=rows.filter(r=>r.sent==='Yes'&&inR(r.sentDate));
  const lv=lavShipments.filter(x=>inR(x.date));
  const ids=new Set([...sr.filter(r=>r.shipId).map(r=>r.shipId),...lv.filter(x=>x.shipId).map(x=>x.shipId)]);
  const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>ids.has(sid)));
  return calcInsMetrics(sr,lv,bm);
}
// The detailed cost rows for a metrics object.
function prepBreakdownRows(m){
  const vatAmt=(m.withVat||0)-(m.subtotal||0);
  const rateStr=m.unitRate!=null?(m.unitRate<1?(m.unitRate*100).toFixed(0)+'p':fmtGBP2(m.unitRate)):'rate';
  const row=(label,val,sub,col)=>`<div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--border);">
    <div><div style="font-size:12px;color:var(--text2);font-weight:600;">${label}</div>${sub?`<div style="font-size:11px;color:var(--text3);">${sub}</div>`:''}</div>
    <div style="font-family:var(--mono);font-size:12px;font-weight:700;color:${col||'var(--text)'};">${val}</div>
  </div>`;
  return `
    ${row('Volume base rate',fmtGBP2(m.baseCost||0),`${fmt(m.tieredUnits||0)} units (Standard + DG + Lavarion) × ${rateStr} (volume band ${m.unitRateBand||'—'})`,'#fbbf24')}
    ${(m.osCost>0)?row('Oversize surcharge',fmtGBP2(m.osCost),`${fmt(m.osUnits||0)} oversize units`,'#fb923c'):''}
    ${(m.bundleCost>0)?row('Bundle handling',fmtGBP2(m.bundleCost),`${fmt(m.bundleUnits||0)} bundled units`,'#34d399'):''}
    ${(m.boxCostTotal>0)?row('Boxes',fmtGBP2(m.boxCostTotal),`${fmt(m.stdBoxes||0)} standard + ${fmt(m.dgBoxes||0)} DG`,'#60a5fa'):''}
    ${row('Subtotal (ex. VAT)',fmtGBP2(m.subtotal||0),'','var(--text)')}
    ${row('VAT',fmtGBP2(vatAmt),'','#94a3b8')}
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0 2px;border-top:2px solid var(--accent);margin-top:4px;">
      <div style="font-size:13px;font-weight:800;color:var(--text);">Total inc. VAT</div>
      <div style="font-family:var(--mono);font-size:16px;font-weight:900;color:#fbbf24;">${fmtGBP2(m.withVat||0)}</div>
    </div>`;
}
// Open / refresh the Prep Fee Explorer for a given period.
function openPrepExplorer(key){
  if(key)_prepExpPeriod=key;
  const box=document.getElementById('insPrepBreakdownBody');
  if(!box)return;
  const{s,e,label}=prepExpRange(_prepExpPeriod);
  const m=prepExpMetrics(s,e);

  // Build the list of selectable periods: This Month, Last Month, then recent months.
  const monthMap=buildMonthMap(null);
  const monthKeys=Object.keys(monthMap).sort((a,b)=>b.localeCompare(a)).slice(0,8);
  const now=new Date();
  const thisKey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const lastD=new Date(now.getFullYear(),now.getMonth()-1,1);
  const lastKey=lastD.getFullYear()+'-'+String(lastD.getMonth()+1).padStart(2,'0');
  const periods=[['mtd','This Month'],['lastmonth','Last Month'],...monthKeys.filter(k=>k!==thisKey&&k!==lastKey).map(k=>{const[y,mm]=k.split('-');return[k,new Date(+y,+mm-1,1).toLocaleString('en-GB',{month:'short'})+" '"+y.slice(2)];})];
  const pillRow=periods.map(([k,lbl])=>{
    const active=k===_prepExpPeriod;
    return `<button onclick="openPrepExplorer('${k}')" style="padding:5px 11px;border-radius:14px;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;border:1px solid ${active?'var(--accent)':'var(--border2)'};background:${active?'rgba(251,191,36,.15)':'var(--bg3)'};color:${active?'#fbbf24':'var(--text2)'};">${lbl}</button>`;
  }).join('');

  // Month-by-month prep trend (clickable bars), oldest→newest.
  const trend=monthKeys.slice().reverse().map(k=>{
    const md=monthMap[k];const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>md.shipIds.has(sid)));
    const mm=calcInsMetrics(md.rows,md.lavRows,bm);
    const[y,mo]=k.split('-');
    return{key:k,short:new Date(+y,+mo-1,1).toLocaleString('en-GB',{month:'short'}),prep:mm.withVat||0};
  });
  const maxPrep=Math.max(...trend.map(t=>t.prep),1);
  const trendBars=trend.map(t=>{
    const h=Math.max(4,Math.round((t.prep/maxPrep)*90));
    const sel=t.key===_prepExpPeriod;
    return `<div onclick="openPrepExplorer('${t.key}')" title="${t.short}: ${fmtGBP2(t.prep)}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-width:0;">
      <div style="font-size:8px;font-family:var(--mono);color:${sel?'#fbbf24':'var(--text3)'};white-space:nowrap;">${t.prep>=1000?'£'+(t.prep/1000).toFixed(1)+'k':'£'+Math.round(t.prep)}</div>
      <div style="width:70%;height:${h}px;background:${sel?'#fbbf24':'rgba(251,191,36,.3)'};border-radius:3px 3px 0 0;transition:height .2s;"></div>
      <div style="font-size:10.5px;color:${sel?'#fbbf24':'var(--text3)'};font-weight:${sel?'800':'400'};">${t.short}</div>
    </div>`;
  }).join('');

  const empty=!(m.totalUnits||0);

  // Month-end projection (only meaningful for the live month-to-date view).
  let projBlock='';
  if(_prepExpPeriod==='mtd'&&!empty){
    const pn=new Date();
    const pdim=new Date(pn.getFullYear(),pn.getMonth()+1,0).getDate();
    const pf=Math.max(pn.getDate()/pdim,0.0001);
    const projCost=(m.withVat||0)/pf;
    const projUnits2=Math.round((m.totalUnits||0)/pf);
    projBlock=`<div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.28);border-radius:8px;padding:10px 13px;margin-bottom:12px;font-size:11px;line-height:1.5;color:var(--text2);">📈 At the current pace (${Math.round(pf*100)}% of the month elapsed), you're on track for roughly <b style="color:#60a5fa;">${fmtGBP2(projCost)}</b> in prep this month across about <b style="color:#60a5fa;">${fmt(projUnits2)}</b> units.</div>`;
  }

  let py,pmo;
  if(_prepExpPeriod==='mtd'||_prepExpPeriod==='lastmonth'){
    const base=_prepExpPeriod==='mtd'?new Date(now.getFullYear(),now.getMonth(),1):new Date(now.getFullYear(),now.getMonth()-1,1);
    const p=new Date(base.getFullYear(),base.getMonth()-1,1);py=p.getFullYear();pmo=p.getMonth();
  }else{const[yy,mm]=_prepExpPeriod.split('-').map(Number);const p=new Date(yy,mm-2,1);py=p.getFullYear();pmo=p.getMonth();}
  const prevM=prepExpMetrics(new Date(py,pmo,1),new Date(py,pmo+1,0,23,59,59));
  const prevLbl=new Date(py,pmo,1).toLocaleString('en-GB',{month:'short'});
  const ppuCur=m.totalUnits?m.withVat/m.totalUnits:0, ppuPrev=prevM.totalUnits?prevM.withVat/prevM.totalUnits:0;
  const ratioCur=m.withVat?(m.cog/m.withVat):0;
  const rateStr=r=>r==null?'—':(r<1?(r*100).toFixed(0)+'p':'£'+r.toFixed(2));
  const delta=(cur,prev,goodDown)=>{const pct=prev>0?((cur-prev)/prev*100):(cur>0?100:0);const col=((goodDown?pct<-0.5:pct>0.5))?'#4ade80':((goodDown?pct>0.5:pct<-0.5)?'#f87171':'var(--text3)');return prev>0?`<span style="font-family:var(--mono);font-weight:800;color:${col};">${pct>0.5?'▲':pct<-0.5?'▼':'→'} ${Math.abs(pct).toFixed(0)}%</span>`:'<span style="color:var(--text3);">—</span>';};

  // Volume-band insight.
  const tu=m.tieredUnits||0;
  const bands=[{max:prepFees.tier1Units,rate:prepFees.tier1p,label:'1–'+fmt(prepFees.tier1Units)},{max:prepFees.tier2Units,rate:prepFees.tier2p,label:fmt(prepFees.tier1Units+1)+'–'+fmt(prepFees.tier2Units)},{max:prepFees.tier3Units,rate:prepFees.tier3p,label:fmt(prepFees.tier2Units+1)+'–'+fmt(prepFees.tier3Units)},{max:Infinity,rate:prepFees.tier4p,label:fmt(prepFees.tier3Units+1)+'+'}];
  const ci=Math.max(0,bands.findIndex(b=>tu<=b.max));const cur=bands[ci],nb=bands[ci+1];
  const bandInsight=tu<=0?'':(nb?`You're in the <b style="color:#fbbf24;">${cur.label}</b> band at <b>${rateStr(cur.rate)}/unit</b>. <b style="color:#4ade80;">${fmt((cur.max+1)-tu)} more units</b> this period would reach the <b>${nb.label}</b> band at <b>${rateStr(nb.rate)}/unit</b> — that lower rate applies to <i>every</i> unit, not just the new ones.`:`You're in the top <b style="color:#4ade80;">${cur.label}</b> band at <b>${rateStr(cur.rate)}/unit</b> — best available rate.`);

  // Cost composition (% of ex-VAT subtotal).
  const sub=m.subtotal||1;
  const comp=[['Volume base',m.baseCost||0,'#fbbf24'],['Oversize',m.osCost||0,'#fb923c'],['Bundle',m.bundleCost||0,'#34d399'],['Boxes',m.boxCostTotal||0,'#60a5fa']].filter(c=>c[1]>0);

  const kpiTile=(v,l,c)=>`<div style="background:var(--bg3);border-radius:8px;padding:11px 8px;text-align:center;"><div style="font-size:18px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${c};line-height:1;">${v}</div><div style="font-size:9.5px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.05em;">${l}</div></div>`;

  box.innerHTML=`
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">${pillRow}</div>
    ${trend.length>1?`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px 10px 8px;margin-bottom:14px;">
      <div style="font-size:9.5px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Prep Cost Trend (inc. VAT) — tap a month</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:120px;">${trendBars}</div>
    </div>`:''}
    <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:2px;">${label}</div>
    ${empty?`<div style="color:var(--text3);padding:24px;text-align:center;">No prep activity in this period.</div>`:`
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">${fmt(m.totalUnits||0)} units · ${fmt(m.totalBoxes||0)} box${(m.totalBoxes||0)!==1?'es':''} · ${fmt(m.ships||0)} shipments</div>
    <div style="font-size:30px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#fbbf24;line-height:1;margin-bottom:2px;">${fmtGBP2(m.withVat||0)}</div>
    <div style="font-size:10px;color:var(--text3);margin-bottom:12px;">inc. VAT · ${fmtGBP2(m.subtotal||0)} ex. VAT</div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px;">
      ${kpiTile(fmtGBP2(m.withVat||0),'Total inc VAT','#fbbf24')}
      ${kpiTile('£'+ppuCur.toFixed(2),'Per unit','#fb923c')}
      ${kpiTile(m.ships>0?'£'+(m.withVat/m.ships).toFixed(2):'—','Per shipment','#34d399')}
      ${kpiTile(ratioCur?ratioCur.toFixed(1)+'×':'—','COG : Prep','#cc99ff')}
    </div>

    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-around;gap:8px;">
      <div style="text-align:center;"><div style="font-size:9.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Prep vs ${prevLbl}</div><div style="font-size:12px;">${delta(m.withVat||0,prevM.withVat||0,true)}</div></div>
      <div style="text-align:center;"><div style="font-size:9.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">£/unit vs ${prevLbl}</div><div style="font-size:12px;">${delta(ppuCur,ppuPrev,true)}</div></div>
      <div style="text-align:center;"><div style="font-size:9.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${prevLbl} total</div><div style="font-size:12px;font-family:var(--mono);color:var(--text2);">${prevM.withVat?fmtGBP2(prevM.withVat):'—'}</div></div>
    </div>

    ${bandInsight?`<div style="background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.25);border-radius:8px;padding:11px 13px;margin-bottom:12px;font-size:11px;line-height:1.5;color:var(--text2);">💡 ${bandInsight}</div>`:''}
    ${projBlock}

    ${comp.length>1?`<div style="margin-bottom:14px;">
      <div style="font-size:9.5px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Cost Composition (ex. VAT)</div>
      ${comp.map(([l,v,c])=>`<div style="display:flex;align-items:center;gap:8px;padding:3px 0;"><div style="width:80px;font-size:10px;color:var(--text2);">${l}</div><div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(v/sub*100)}%;background:${c};border-radius:4px;"></div></div><div style="width:84px;text-align:right;font-size:10px;font-family:var(--mono);color:${c};font-weight:700;">${fmtGBP2(v)} · ${Math.round(v/sub*100)}%</div></div>`).join('')}
    </div>`:''}

    <div style="font-size:9.5px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Line-by-line</div>
    ${prepBreakdownRows(m)}`}
    <div style="font-size:11px;color:var(--text3);margin-top:12px;line-height:1.4;">Each month is priced at its own actual volume (volume-based flat rate). Rates configurable in Settings → Prep Fees.</div>`;
  om('insPrepModal');
}

// Back-compat: the Insights prep KPI card opens the explorer at the current month.
function showInsPrepBreakdown(){openPrepExplorer('mtd');}

// ── Insights detail popups (Units / COG / Account / Prep efficiency) ──────────
const _MONA=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _insMonthSeries(){
  const mm=buildMonthMap(null);
  return Object.keys(mm).sort().slice(-10).map(k=>{
    const md=mm[k];const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>md.shipIds.has(sid)));
    const _curKey=new Date().toISOString().slice(0,7);
    const m=calcInsMetrics(md.rows,md.lavRows,bm,k===_curKey?smartExpectedUnits():null);const[y,mo]=k.split('-');
    // per-month sent mix: OA rows bucketed by shipType, all Lavarion its own bucket
    const _u=r=>(r.ship||r.shi||0);let _std=0,_dg=0,_os=0;
    md.rows.forEach(r=>{const t=(r.shipType||(typeof _shipTypeCache!=='undefined'&&_shipTypeCache[r.shipId])||'Standard');if(t==='DG')_dg+=_u(r);else if(t==='Oversize')_os+=_u(r);else _std+=_u(r);});
    const _lav=md.lavRows.reduce((a,s)=>a+(s.units||0),0);
    return{key:k,short:_MONA[+mo]+" '"+y.slice(2),units:m.totalUnits||0,cog:m.cog||0,prep:m.withVat||0,
      lav:m.lavUnits||0,stock:(m.totalUnits||0)-(m.lavUnits||0),
      skus:m.skus||0,asins:m.asins||0,ships:m.ships||0,boxes:m.totalBoxes||0,
      mixStd:_std,mixDG:_dg,mixOS:_os,mixLav:_lav,
      cogPerUnit:m.totalUnits?(m.cog/m.totalUnits):0,
      ppu:m.totalUnits?(m.withVat/m.totalUnits):0,ratio:m.withVat?(m.cog/m.withVat):0};
  });
}
function _insBars(series,key,color,fmtFn,onClickMonth){
  if(!series.length)return'<div style="color:var(--text3);padding:20px;text-align:center;">No data yet</div>';
  const mx=Math.max(...series.map(s=>s[key]),1);
  return `<div style="display:flex;align-items:flex-end;gap:5px;height:130px;">${series.map(s=>{const h=Math.max(4,Math.round((s[key]/mx)*100));return `<div ${onClickMonth?`onclick="${onClickMonth}('${s.key}')"`:''} title="${s.short}: ${fmtFn(s[key])}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;${onClickMonth?'cursor:pointer;':''}min-width:0;"><div style="font-size:8px;font-family:var(--mono);color:var(--text3);white-space:nowrap;">${fmtFn(s[key])}</div><div style="width:74%;height:${h}px;background:${color};border-radius:3px 3px 0 0;opacity:.82;"></div><div style="font-size:10.5px;color:var(--text3);">${s.short}</div></div>`;}).join('')}</div>`;
}
function _deltaBadge(cur,prev,goodWhenDown){
  const pct=prev>0?((cur-prev)/prev*100):(cur>0?100:0);
  const col=((goodWhenDown?pct<-0.5:pct>0.5))?'#4ade80':((goodWhenDown?pct>0.5:pct<-0.5)?'#f87171':'var(--text3)');
  const arrow=pct>0.5?'▲':pct<-0.5?'▼':'→';
  return `<span style="font-family:var(--mono);font-weight:800;color:${col};">${arrow} ${Math.abs(pct).toFixed(0)}%</span>`;
}
function _insShow(title,html){document.getElementById('insDetailTitle').textContent=title;document.getElementById('insDetailBody').innerHTML=html;om('insDetailModal');}
function _drillMonth(k){cm('insDetailModal');insightRange='m:'+k;renderInsights();}

function openUnitsExplorer(){
  const s=_insMonthSeries();const cur=s[s.length-1]||{units:0,stock:0,lav:0},prev=s[s.length-2]||{units:0};
  const tot=cur.units||1;
  _insShow('Units Sent — Trend & Breakdown',`
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Units sent per month — tap a bar to open that month.</div>
    ${_insBars(s,'units','#55ff55',fmt,'_drillMonth')}
    <div style="display:flex;gap:8px;margin:16px 0 14px;">
      <div style="flex:1;background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#55ff55;">${fmt(cur.units)}</div><div style="font-size:11px;color:var(--text3);margin-top:3px;">This month · ${_deltaBadge(cur.units,prev.units,false)} vs last</div></div>
      <div style="flex:1;background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#5599ff;">${fmt(cur.stock)}</div><div style="font-size:11px;color:var(--text3);margin-top:3px;">Stock · ${Math.round(cur.stock/tot*100)}%</div></div>
      <div style="flex:1;background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#cc99ff;">${fmt(cur.lav)}</div><div style="font-size:11px;color:var(--text3);margin-top:3px;">Lavarion · ${Math.round(cur.lav/tot*100)}%</div></div>
    </div>
    <div style="font-size:11px;color:var(--text3);">"This month" = latest calendar month so far.</div>`);
}
function openCogExplorer(){
  const s=_insMonthSeries();const cur=s[s.length-1]||{cog:0},prev=s[s.length-2]||{cog:0};
  const sup={};rows.filter(r=>r.sent==='Yes').forEach(r=>{const k=r.sup||'—';if(!sup[k])sup[k]={u:0,c:0};const u=r.ship||0;sup[k].u+=u;sup[k].c+=(parseSKU(r.sku).cogs||0)*u;});
  const se=Object.entries(sup).filter(([,v])=>v.c>0).sort((a,b)=>b[1].c-a[1].c).slice(0,10);const mx=Math.max(...se.map(([,v])=>v.c),1);
  _insShow('COG Value — Trend & By Supplier',`
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">COG value sent per month — tap a bar to open that month.</div>
    ${_insBars(s,'cog','#ffaa33',v=>v>=1000?'£'+(v/1000).toFixed(0)+'k':'£'+Math.round(v),'_drillMonth')}
    <div style="background:var(--bg3);border-radius:8px;padding:12px;margin:16px 0 6px;text-align:center;"><div style="font-size:24px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#ffaa33;">${fmtGBP2(cur.cog)}</div><div style="font-size:11px;color:var(--text3);margin-top:3px;">This month · ${_deltaBadge(cur.cog,prev.cog,false)} vs last</div></div>
    <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 8px;">COG by Supplier (all-time)</div>
    ${se.length?se.map(([s2,v])=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;"><div style="width:120px;font-size:11px;font-weight:600;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s2}</div><div style="flex:1;height:7px;background:var(--bg);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(v.c/mx*100)}%;background:#ffaa33;border-radius:4px;"></div></div><div style="width:64px;text-align:right;font-size:11px;font-family:var(--mono);font-weight:700;color:#ffaa33;">${fmtGBP(v.c)}</div></div>`).join(''):'<div style="color:var(--text3);padding:10px;text-align:center;">No supplier data</div>'}`);
}
function openPrepEfficiency(){
  const s=_insMonthSeries();const cur=s[s.length-1]||{ppu:0,ratio:0},prev=s[s.length-2]||{ppu:0};
  _insShow('Prep Efficiency Over Time',`
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <div style="flex:1;background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#fb923c;">${cur.ppu?'£'+cur.ppu.toFixed(2):'—'}</div><div style="font-size:11px;color:var(--text3);margin-top:3px;">Prep £/unit · ${_deltaBadge(cur.ppu,prev.ppu,true)} vs last</div></div>
      <div style="flex:1;background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#cc99ff;">${cur.ratio?cur.ratio.toFixed(1)+'×':'—'}</div><div style="font-size:11px;color:var(--text3);margin-top:3px;">COG : Prep ratio</div></div>
    </div>
    <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Prep £/unit by month (lower = better)</div>
    ${_insBars(s,'ppu','#fb923c',v=>v?'£'+v.toFixed(2):'£0','_drillMonth')}
    <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin:16px 0 8px;">COG : Prep ratio by month (higher = leaner)</div>
    ${_insBars(s,'ratio','#cc99ff',v=>v?v.toFixed(0)+'×':'—','_drillMonth')}`);
}
function openAccountModal(acct){
  const a=String(acct);
  const sent=rows.filter(r=>r.sent==='Yes'&&(r.acct||'—')===a);
  const units=sent.reduce((x,r)=>x+(r.ship||0),0);
  const cog=sent.reduce((x,r)=>x+(parseSKU(r.sku).cogs||0)*(r.ship||0),0);
  const ships=new Set(sent.filter(r=>r.shipId).map(r=>r.shipId)).size;
  const issues=rows.filter(r=>(r.acct||'—')===a&&r.issueQty>0).reduce((x,r)=>x+(r.issueQty||0),0);
  const mser={};sent.forEach(r=>{const k=(r.sentDate||'').slice(0,7);if(!k)return;mser[k]=(mser[k]||0)+(r.ship||0);});
  const keys=Object.keys(mser).sort().slice(-10);
  const series=keys.map(k=>{const[y,mo]=k.split('-');return{key:k,short:_MONA[+mo]+" '"+y.slice(2),units:mser[k]};});
  _insShow('Account — '+a,`
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
      ${[['Units',fmt(units),'#55ff55'],['COG Value',fmtGBP2(cog),'#ffaa33'],['Shipments',fmt(ships),'#5599ff'],['Issue Units',fmt(issues),issues>0?'#f87171':'#64748b']].map(([l,v,c])=>`<div style="background:var(--bg3);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${c};line-height:1;">${v}</div><div style="font-size:9.5px;color:var(--text3);margin-top:4px;text-transform:uppercase;letter-spacing:.06em;">${l}</div></div>`).join('')}
    </div>
    <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Units sent by month — ${a}</div>
    ${_insBars(series,'units','#60a5fa',fmt,null)}`);
}

// "This Month vs Last Month" comparison popup — opened from the overview tiles.
function openInsCompare(){
  const box=document.getElementById('insCompareBody');if(!box)return;
  const now=new Date();
  const tm=prepExpMetrics(new Date(now.getFullYear(),now.getMonth(),1),now);
  const lm=prepExpMetrics(new Date(now.getFullYear(),now.getMonth()-1,1),new Date(now.getFullYear(),now.getMonth(),0,23,59,59));
  const dayNo=now.getDate();
  // 6-month series per metric for the mini trend.
  const mm=buildMonthMap(null);const keys=Object.keys(mm).sort().slice(-6);
  const ser={units:[],cog:[],ships:[],prep:[]};
  keys.forEach(k=>{const md=mm[k];const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>md.shipIds.has(sid)));const x=calcInsMetrics(md.rows,md.lavRows,bm);ser.units.push(x.totalUnits||0);ser.cog.push(x.cog||0);ser.ships.push(x.ships||0);ser.prep.push(x.withVat||0);});
  const miniTrend=(vals,color)=>{
    if(!vals.length)return'';const max=Math.max(...vals,1);
    return `<div style="display:flex;align-items:flex-end;gap:3px;height:34px;">${vals.map((v,i)=>`<div title="${keys[i]}: ${v}" style="flex:1;height:${Math.max(3,Math.round((v/max)*34))}px;background:${i===vals.length-1?color:color+'66'};border-radius:2px 2px 0 0;"></div>`).join('')}</div>`;
  };
  const card=(label,thisV,lastV,fmtFn,color,series)=>{
    const pct=lastV>0?((thisV-lastV)/lastV*100):(thisV>0?100:0);
    const up=pct>0.5,down=pct<-0.5;
    const dCol=up?'#4ade80':down?'#f87171':'var(--text3)';
    const arrow=up?'▲':down?'▼':'→';
    return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;">${label}</div>
        <div style="font-size:11px;font-weight:800;font-family:var(--mono);color:${dCol};">${arrow} ${Math.abs(pct).toFixed(0)}%</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">
        <div><div style="font-size:10.5px;color:var(--text3);">This month (to day ${dayNo})</div><div style="font-size:20px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${color};line-height:1.1;">${fmtFn(thisV)}</div></div>
        <div style="text-align:right;"><div style="font-size:10.5px;color:var(--text3);">Last month (full)</div><div style="font-size:14px;font-weight:700;font-family:var(--mono);color:var(--text2);line-height:1.1;">${fmtFn(lastV)}</div></div>
      </div>
      ${miniTrend(series,color)}
    </div>`;
  };
  box.innerHTML=`
    <div style="font-size:11px;color:var(--text3);margin-bottom:14px;line-height:1.4;">This calendar month so far vs all of last month. The % is a running pace check — early in the month it'll naturally trail a full month. Bars show the last ${keys.length} months.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${card('Units Sent',tm.totalUnits||0,lm.totalUnits||0,fmt,'#55ff55',ser.units)}
      ${card('COG Value',tm.cog||0,lm.cog||0,fmtGBP2,'#ffaa33',ser.cog)}
      ${card('Shipments',tm.ships||0,lm.ships||0,fmt,'#5599ff',ser.ships)}
      ${card('Prep (inc VAT)',tm.withVat||0,lm.withVat||0,fmtGBP2,'#cc99ff',ser.prep)}
    </div>
    <div style="margin-top:12px;text-align:center;"><button onclick="cm('insCompareModal');openPrepExplorer('mtd')" style="padding:7px 14px;background:rgba(204,153,255,.12);border:1px solid rgba(204,153,255,.35);color:#cc99ff;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Open full Prep Fee Explorer →</button></div>`;
  om('insCompareModal');
}

function renderInsPanel(body,allRows,allLav,boxMap,label,showChart){
  if(!allRows.length&&!allLav.length){
    body.innerHTML=`<div style="color:var(--text3);text-align:center;padding:40px;">No data for ${label.toLowerCase()}.</div>`;
    return;
  }
  const met=calcInsMetrics(allRows,allLav,boxMap);
  _lastInsMet=met;_lastInsLabel=label;
  const cogPerUnit=met.totalUnits>0?(met.cog/met.totalUnits):0;
  const prepPct=met.cog>0?((met.withVat/met.cog)*100):0;

  // ── KPI CARDS ──────────────────────────────────────────────────────────────
  const kpis=`
    <div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:14px;">${label}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:20px;">
      ${kpiCard('Units Sent',fmt(met.totalUnits),'units shipped','#60a5fa')}
      ${kpiCard('COG',fmtGBP2(met.cog),'cost of goods','#f59e0b')}
      ${kpiCard('SKU Lines',met.skus,'unique SKUs','#a78bfa')}
      ${kpiCard('ASINs',met.asins,'unique ASINs','#34d399')}
      ${kpiCard('Shipments',met.ships,'FBA shipments','#60a5fa')}
      ${kpiCard('Boxes',met.totalBoxes,'total boxes','#fb923c')}
      <div onclick="showInsPrepBreakdown()" style="cursor:pointer;" title="Click to see full breakdown">
        ${kpiCard('Prep Cost ▸',fmtGBP2(met.withVat),'inc. VAT · click for detail','#fbbf24')}
      </div>
      ${kpiCard('COG / Unit','£'+cogPerUnit.toFixed(2),'avg cost per unit','#94a3b8')}
      ${kpiCard('Prep %',prepPct.toFixed(1)+'%','prep as % of COG','#f472b6')}
    </div>`;

  // ── BAR CHARTS ─────────────────────────────────────────────────────────────
  let chart='';
  if(showChart){
    const allMap=buildMonthMap(null);
    const chartData=Object.entries(allMap).sort(([a],[b])=>a.localeCompare(b)).map(([key,md])=>{
      const bm=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>md.shipIds.has(sid)));
      const mc=calcInsMetrics(md.rows,md.lavRows,bm);
      const[my,mm]=key.split('-');
      return{label:md.label,shortLabel:new Date(+my,+mm-1,1).toLocaleString('en-GB',{month:'short'})+' '+my.slice(2),units:mc.totalUnits,cog:mc.cog,prep:mc.withVat};
    });
    if(chartData.length>1){
      chart=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div>${insBarChart(chartData,'units','Units Sent','#60a5fa')}</div>
        <div>${insBarChart(chartData,'cog','COG Value','#f59e0b')}</div>
      </div>`;
    }
  }

  // ── SUPPLIERS + ASINS ──────────────────────────────────────────────────────
  const supMap={};
  allRows.forEach(r=>{
    const s=r.sup||'Unknown';
    if(!supMap[s])supMap[s]={sup:s,units:0,cog:0,skus:new Set(),orders:new Set()};
    supMap[s].units+=r.ship||0;
    supMap[s].cog+=parseSKU(r.sku).cogs*(r.ship||0);
    supMap[s].skus.add(r.sku);
    if(r.oid)supMap[s].orders.add(r.oid);
  });
  const topSups=Object.values(supMap).sort((a,b)=>b.units-a.units).slice(0,6);

  const asinMap={};
  allRows.forEach(r=>{
    if(!r.asin)return;
    if(!asinMap[r.asin])asinMap[r.asin]={asin:r.asin,prod:r.prod,units:0,cog:0,skus:new Set()};
    asinMap[r.asin].units+=r.ship||0;
    asinMap[r.asin].cog+=parseSKU(r.sku).cogs*(r.ship||0);
    asinMap[r.asin].skus.add(r.sku);
  });
  const topAsins=Object.values(asinMap).sort((a,b)=>b.units-a.units).slice(0,8);

  // ── TOP SKUS ───────────────────────────────────────────────────────────────
  const skuMap={};
  allRows.forEach(r=>{
    if(!skuMap[r.sku])skuMap[r.sku]={sku:r.sku,prod:r.prod,asin:r.asin,units:0,cog:0};
    skuMap[r.sku].units+=r.ship||0;
    skuMap[r.sku].cog+=parseSKU(r.sku).cogs*(r.ship||0);
  });
  const topSkus=Object.values(skuMap).sort((a,b)=>b.units-a.units).slice(0,10);
  const maxUnits=topSkus[0]?.units||1;

  const tables=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Top Suppliers</div>
        ${topSups.map(s=>`
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span style="font-size:11px;font-weight:600;color:var(--text2);">${s.sup}</span>
              <span style="font-size:11px;font-family:var(--mono);color:#60a5fa;font-weight:700;">${fmt(s.units)} u</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:10px;color:var(--text3);">${s.skus.size} SKUs · ${s.orders.size} orders</span>
              <span style="font-size:10px;font-family:var(--mono);color:#f59e0b;">${fmtGBP2(s.cog)}</span>
            </div>
            <div style="height:3px;background:var(--bg);border-radius:2px;">
              <div style="height:100%;width:${Math.round((s.units/(topSups[0]?.units||1))*100)}%;background:#60a5fa;border-radius:2px;"></div>
            </div>
          </div>`).join('')}
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Top ASINs</div>
        ${topAsins.map(a=>`
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span style="font-size:10px;font-family:var(--mono);color:var(--accent);">${a.asin}</span>
              <span style="font-size:11px;font-family:var(--mono);color:#34d399;font-weight:700;">${fmt(a.units)} u</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${a.prod||'—'}</span>
              <span style="font-size:10px;font-family:var(--mono);color:#f59e0b;">${fmtGBP2(a.cog)}</span>
            </div>
            <div style="height:3px;background:var(--bg);border-radius:2px;">
              <div style="height:100%;width:${Math.round((a.units/(topAsins[0]?.units||1))*100)}%;background:#34d399;border-radius:2px;"></div>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Top SKUs by Units</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:4px 6px;font-size:11px;color:var(--accent);">SKU</th>
          <th style="text-align:left;padding:4px 6px;font-size:11px;color:var(--accent);">Product</th>
          <th style="text-align:right;padding:4px 6px;font-size:11px;color:var(--accent);">Units</th>
          <th style="text-align:right;padding:4px 6px;font-size:11px;color:var(--accent);">COG</th>
          <th style="text-align:right;padding:4px 6px;font-size:11px;color:var(--accent);">COG/u</th>
          <th style="padding:4px 6px;min-width:80px;"></th>
        </tr></thead>
        <tbody>${topSkus.map(s=>`<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
          <td style="padding:5px 6px;font-size:10px;font-family:var(--mono);color:var(--text2);">${s.sku}</td>
          <td style="padding:5px 6px;font-size:10px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.prod||'—'}</td>
          <td style="padding:5px 6px;font-size:11px;font-family:var(--mono);font-weight:700;color:#60a5fa;text-align:right;">${fmt(s.units)}</td>
          <td style="padding:5px 6px;font-size:10px;font-family:var(--mono);color:#f59e0b;text-align:right;">${fmtGBP2(s.cog)}</td>
          <td style="padding:5px 6px;font-size:10px;font-family:var(--mono);color:#94a3b8;text-align:right;">£${s.units>0?(s.cog/s.units).toFixed(2):'—'}</td>
          <td style="padding:5px 6px;">
            <div style="height:4px;background:var(--bg);border-radius:2px;">
              <div style="height:100%;width:${Math.round((s.units/maxUnits)*100)}%;background:#60a5fa;border-radius:2px;"></div>
            </div>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  body.innerHTML=kpis+chart+tables;
}
function toggleInsMonth(key){
  const el=document.getElementById('ins-expand-'+key);
  if(el)el.style.display=el.style.display==='none'?'table-row':'none';
}

function saveSettingsPrepFees(){
  ['tier1p','tier2p','tier3p','tier4p','boxCost','dgExtraPerBox','osCostPerUnit','bundleCostPerUnit','expectedMonthlyUnits'].forEach(k=>{
    const el=document.getElementById('pf-'+k);
    if(el)prepFees[k]=parseFloat(el.value)||0;
  });
  savePrepFees();
  const saved=document.getElementById('prepFeeSaved');
  if(saved){saved.style.display='inline';setTimeout(()=>saved.style.display='none',2000);}
  toast('✓ Prep fee rates saved');
}
function resetPrepFees(){
  showConfirm('Reset prep fees?','This resets all rates to the Source 2 Store defaults.',()=>{
    prepFees={...PREP_FEE_DEFAULTS};
    savePrepFees();
    ['tier1p','tier2p','tier3p','tier4p','boxCost','dgExtraPerBox','osCostPerUnit','bundleCostPerUnit','expectedMonthlyUnits'].forEach(k=>{
      const el=document.getElementById('pf-'+k);
      if(el)el.value=prepFees[k];
    });
    toast('Prep fees reset to defaults');
  });
}
function updatePrepFeePreview(){}
function openAllSuppliersModal(){
  // Reuse the supplier modal with a full table of all suppliers
  document.getElementById('supplierModalTitle').textContent='All Supplier Analysis';
  const body=document.getElementById('supplierModalBody');
  // Build supplier map from all rows
  const supMap={};
  rows.forEach(r=>{
    const s=r.sup||'Unknown';
    if(!supMap[s])supMap[s]={units:0,value:0,orders:new Set(),issues:0,issueVal:0,days:[]};
    if(r.sent==='Yes'){supMap[s].units+=r.ship||0;supMap[s].value+=parseSKU(r.sku).cogs*(r.ship||0);}
    if(r.oid)supMap[s].orders.add(r.oid);
    if(r.issueQty>0){supMap[s].issues+=r.issueQty||0;supMap[s].issueVal+=parseSKU(r.sku).cogs*(r.issueQty||0);}
    if(r.sentDate&&r.date){
      const[dd,mm]=(r.date||'').split('/');
      if(dd&&mm){const ord=new Date(`${new Date().getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);const snt=new Date(r.sentDate);const d=Math.round((snt-ord)/(864e5));if(d>=0&&d<200)supMap[s].days.push(d);}
    }
  });
  const entries=Object.entries(supMap).sort((a,b)=>b[1].value-a[1].value);
  body.innerHTML=`
    <div style="margin-bottom:12px;font-size:11px;color:var(--text3);">${entries.length} suppliers · Click any row for full detail</div>
    <table style="min-width:unset;width:100%;">
      <thead style="position:static;"><tr>
        <th class="th-left">Supplier</th>
        <th>Units Sent</th><th>COG Value</th><th>Avg COG/Unit</th>
        <th>Avg Transit</th><th>Issues</th><th>Issue Value</th><th>Issue Rate</th>
      </tr></thead>
      <tbody>
      ${entries.map(([s,v])=>{
        const avgCog=v.units?((v.value/v.units).toFixed(2)):'—';
        const avgDays=v.days.length?Math.round(v.days.reduce((a,b)=>a+b,0)/v.days.length):'—';
        const issueRate=v.units?(v.issues/v.units*100).toFixed(1)+'%':'—';
        return`<tr onclick="openSupplierModal('${s.replace(/'/g,"\\'")}');cm('supplierModal');setTimeout(()=>openSupplierModal('${s.replace(/'/g,"\\'")}'),50);" style="cursor:pointer;" onmouseover="this.style.background='rgba(245,158,11,.05)'" onmouseout="this.style.background=''">
          <td class="td-left" style="font-weight:600;">${s} <span style="font-size:11px;color:var(--accent);">↗</span></td>
          <td style="font-family:var(--mono);font-weight:700;color:#55ff55;">${fmt(v.units)}</td>
          <td style="font-family:var(--mono);font-weight:700;color:#ffaa33;">${fmtGBP2(v.value)}</td>
          <td style="font-family:var(--mono);">£${avgCog}</td>
          <td style="font-family:var(--mono);color:${avgDays>10?'#ffaa33':avgDays!=='—'?'#55ff55':'var(--text3)'};">${avgDays!=='—'?avgDays+'d':avgDays}</td>
          <td style="font-family:var(--mono);color:${v.issues>0?'#ff5555':'#55ff55'};">${fmt(v.issues)}</td>
          <td style="font-family:var(--mono);color:${v.issueVal>0?'#ff5555':'var(--text3)'};">${v.issueVal>0?fmtGBP2(v.issueVal):'—'}</td>
          <td style="font-family:var(--mono);color:${parseFloat(issueRate)>5?'#ff5555':parseFloat(issueRate)>0?'#ffaa33':'#55ff55'};">${issueRate}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
  om('supplierModal');
}
function openSupplierModal(sup){
  document.getElementById('supplierModalTitle').textContent=sup+' — Supplier Insight';
  const body=document.getElementById('supplierModalBody');

  // All rows from this supplier
  const supRows=rows.filter(r=>r.sup===sup);
  const sentRows=supRows.filter(r=>r.sent==='Yes'&&r.sentDate);
  const activeRows=supRows.filter(r=>r.status!=='Sent to Amazon');
  const transitRows=supRows.filter(r=>r.status==='In-Transit');
  const issueRows=supRows.filter(r=>r.issueQty>0);
  const supClaims=claims.filter(c=>c.sup===sup);

  // Units
  const totalOrdered=supRows.reduce((a,r)=>a+(r.exp||0),0);
  const totalSent=sentRows.reduce((a,r)=>a+(r.ship||0),0);
  const totalInTransit=transitRows.reduce((a,r)=>a+(r.exp||0),0);
  const totalIssueUnits=issueRows.reduce((a,r)=>a+(r.issueQty||0),0);

  // Values
  const totalOrderedVal=supRows.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.exp||0)),0);
  const totalSentVal=sentRows.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.ship||0)),0);
  const totalIssueVal=issueRows.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.issueQty||0)),0);
  const totalClaimVal=supClaims.reduce((a,c)=>a+(c.claimValue||0),0);

  // Avg COG per unit
  const avgCog=totalSent?(totalSentVal/totalSent).toFixed(2):'—';

  // Avg days in transit
  const daysList=sentRows.filter(r=>r.date).map(r=>{
    const[dd,mm]=(r.date||'').split('/');
    if(!dd||!mm)return null;
    const ordered=new Date(`${new Date().getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
    const sent=new Date(r.sentDate);
    const d=Math.round((sent-ordered)/(864e5));
    return d>=0&&d<200?d:null;
  }).filter(x=>x!==null);
  const avgDays=daysList.length?Math.round(daysList.reduce((a,b)=>a+b,0)/daysList.length):'—';
  const minDays=daysList.length?Math.min(...daysList):'—';
  const maxDays=daysList.length?Math.max(...daysList):'—';

  // Unique ASINs and SKUs
  const uniqueAsins=new Set(supRows.map(r=>r.asin)).size;
  const uniqueSkus=new Set(supRows.map(r=>r.sku)).size;
  const shipIds=new Set(sentRows.filter(r=>r.shipId).map(r=>r.shipId));

  // Issue rate
  const issueRate=totalOrdered?(totalIssueUnits/totalOrdered*100).toFixed(1)+'%':'0%';

  body.innerHTML=`
    <!-- SUMMARY KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      ${[
        ['Total Ordered',fmt(totalOrdered)+' units',fmtGBP(totalOrderedVal),'#5599ff'],
        ['Total Sent',fmt(totalSent)+' units',fmtGBP(totalSentVal),'#55ff55'],
        ['In Transit',fmt(totalInTransit)+' units','currently','#ffaa33'],
        ['Avg COG/Unit','£'+avgCog,'per unit sent','#cc99ff'],
      ].map(([t,v,s,c])=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">${t}</div>
        <div style="font-size:20px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${c};">${v}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;">${s}</div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      ${[
        ['Unique SKUs',fmt(uniqueSkus),'product lines','#5599ff'],
        ['Unique ASINs',fmt(uniqueAsins),'ASINs','#5599ff'],
        ['Shipments',fmt(shipIds.size),'FBA IDs','#ffaa33'],
        ['Avg Transit',avgDays!=='—'?avgDays+'d':'—',minDays!=='—'?`${minDays}d min · ${maxDays}d max`:'no data','#86efac'],
      ].map(([t,v,s,c])=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">${t}</div>
        <div style="font-size:20px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${c};">${v}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;">${s}</div>
      </div>`).join('')}
    </div>

    <!-- ISSUES -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
      ${[
        ['Issue Units',fmt(totalIssueUnits),fmtGBP(totalIssueVal)+' value',totalIssueUnits>0?'#ff5555':'#55ff55'],
        ['Issue Rate',issueRate,'of total ordered',parseFloat(issueRate)>5?'#ff5555':parseFloat(issueRate)>0?'#ffaa33':'#55ff55'],
        ['Open Claims',fmt(supClaims.filter(c=>c.cst!=='Resolved').length),fmtGBP(totalClaimVal)+' at risk',supClaims.filter(c=>c.cst!=='Resolved').length>0?'#ff5555':'#55ff55'],
      ].map(([t,v,s,c])=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">${t}</div>
        <div style="font-size:20px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${c};">${v}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px;">${s}</div>
      </div>`).join('')}
    </div>

    <!-- CLAIMS LIST -->
    ${supClaims.length?`
    <div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Claims & Actions</div>
    <table style="min-width:unset;width:100%;margin-bottom:16px;">
      <thead style="position:static;"><tr>
        <th>Raised</th><th class="th-left">SKU</th><th>Type</th><th>Units</th><th>Value</th><th>Status</th><th>Days Open</th>
      </tr></thead>
      <tbody>${supClaims.map(c=>{
        const daysOpen=c.raisedAt?Math.floor((new Date()-new Date(c.raisedAt))/864e5):0;
        const isOpen=c.cst!=='Resolved'&&c.cst!=='Closed';
        return`<tr>
          <td style="font-size:10px;">${c.raisedAt||'—'}</td>
          <td class="td-left" style="font-size:10px;font-family:var(--mono);">${(c.sku||'').substring(0,28)}</td>
          <td style="color:#ff9999;font-size:10px;">${c.issT}</td>
          <td style="font-family:var(--mono);color:#ff5555;">${c.dif||0}</td>
          <td style="font-family:var(--mono);color:#ffaa33;">${fmtGBP(c.claimValue||0)}</td>
          <td style="font-size:10px;font-weight:700;color:${c.cst==='Open'?'#ff5555':c.cst==='In Progress'?'#ffaa33':'#55ff55'};">${c.cst}</td>
          <td style="font-family:var(--mono);color:${isOpen&&daysOpen>14?'#ff5555':'var(--text3)'};">${isOpen?daysOpen+'d':'—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`:''}

    <!-- ALL ROWS FROM THIS SUPPLIER -->
    <div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">All Stock Lines (${supRows.length})</div>
    <table style="min-width:unset;width:100%;">
      <thead style="position:static;"><tr>
        <th class="th-left">SKU</th><th class="th-left">Product</th><th>Status</th>
        <th>Ordered</th><th>Received</th><th>Shipped</th><th>COG/Unit</th><th>Total COG</th><th>Days Transit</th>
      </tr></thead>
      <tbody>
      ${[...supRows].sort((a,b)=>{
        const order=['Issue','Not Arrived','In-Transit','Delivered','In Warehouse','Sent to Amazon','Returned'];
        return order.indexOf(a.status)-order.indexOf(b.status);
      }).map(r=>{
        const cog=parseSKU(r.sku).cogs;
        const totalCog=cog*(r.ship||r.exp||0);
        const[dd,mm]=(r.date||'').split('/');
        let daysT='—';
        if(dd&&mm&&r.sentDate){
          const ord=new Date(`${new Date().getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
          const snt=new Date(r.sentDate);
          daysT=Math.round((snt-ord)/(864e5))+'d';
        }
        const statusCol=r.status==='Sent to Amazon'?'#55ff55':r.status==='In Warehouse'?'#cc99ff':r.status==='Delivered'?'#86efac':r.status==='Issue'?'#ff5555':r.status==='In-Transit'?'#5599ff':'var(--text3)';
        return`<tr>
          <td class="td-left"><span class="s-sku" onclick="copyVal('${r.sku}',this)" style="display:inline-flex;font-size:11px;">${r.sku}</span></td>
          <td class="td-left" style="font-size:10px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.prod}">${r.prod}</td>
          <td style="font-size:11px;font-weight:700;color:${statusCol};">${r.status}</td>
          <td style="font-family:var(--mono);font-size:10px;">${r.exp||0}</td>
          <td style="font-family:var(--mono);font-size:10px;color:${r.rcvd>0?'#55ff55':'var(--text3)'};">${r.rcvd||0}</td>
          <td style="font-family:var(--mono);font-size:10px;color:${r.ship>0?'#55ff55':'var(--text3)'};">${r.ship||0}</td>
          <td style="font-family:var(--mono);font-size:10px;">${fmtGBP2(cog)}</td>
          <td style="font-family:var(--mono);font-size:10px;color:#ffaa33;">${fmtGBP2(totalCog)}</td>
          <td style="font-family:var(--mono);font-size:10px;color:var(--text3);">${daysT}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  `;
  om('supplierModal');
}
