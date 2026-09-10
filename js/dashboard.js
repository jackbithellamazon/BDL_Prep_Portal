/* BDL PrepHub — js/dashboard.js — Dashboard.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── DASHBOARD ─────────────────────────────────────────────────────────────────
const fmt=n=>n.toLocaleString('en-GB');
const fmtGBP=n=>'£'+Math.round(n).toLocaleString('en-GB');
const fmtGBP2=n=>'£'+(+n).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});

function renderDashboard(){
  if(document.hidden||!_pageActive('page-dashboard')){_dirtyR.dash=true;return;}
  _dirtyR.dash=false;
  const w=document.getElementById('dashboardWrap');
  const todayStr=todayISO();
  const yesterdayStr=yesterdayISO();
  const{s:ws,e:we}=getWeekRange();

  // ── SENT CALCS ───────────────────────────────────────────────────────────────
  function calcSentStock(isoDate){
    const sent=allSentRows().filter(r=>r.isoDate===isoDate);
    const stockOnly=[...rows.filter(r=>r.sent==='Yes'&&r.sentDate===isoDate),...completed.filter(r=>r.dsISO===isoDate)];
    return{units:sent.reduce((a,r)=>a+(r.units||r.ship||r.shi||0),0),value:stockOnly.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.ship||r.shi||0)),0),skus:stockOnly.length};
  }
  function calcSentStockRange(start,end){
    const sent=allSentRows().filter(r=>{const d=r.isoDate?new Date(r.isoDate):null;return d&&d>=start&&d<=end;});
    const stockOnly=[...rows.filter(r=>{if(r.sent!=='Yes'||!r.sentDate)return false;const d=new Date(r.sentDate);return d>=start&&d<=end;}),...completed.filter(r=>{if(!r.dsISO)return false;const d=new Date(r.dsISO);return d>=start&&d<=end;})];
    const shipIds=new Set(stockOnly.filter(r=>r.shipId).map(r=>r.shipId));
    return{units:sent.reduce((a,r)=>a+(r.units||r.ship||r.shi||0),0),value:stockOnly.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.ship||r.shi||0)),0),skus:stockOnly.length,shipments:shipIds.size};
  }
  function calcSentLavRange(start,end){
    const s=typeof start==='string'?start:start.toISOString().split('T')[0];
    const e=typeof end==='string'?end:end.toISOString().split('T')[0];
    const sent=lavShipments.filter(ls=>ls.date&&ls.date>=s&&ls.date<=e);
    return{units:sent.reduce((a,s)=>a+(s.units||0),0),value:sent.reduce((a,s)=>a+((s.cost||0)*(s.units||0)),0)};
  }
  function calcSentReturnRange(start,end){
    const s=typeof start==='string'?start:start.toISOString().split('T')[0];
    const e=typeof end==='string'?end:end.toISOString().split('T')[0];
    const sent=returnShipments.filter(rs=>rs.date&&rs.date>=s&&rs.date<=e);
    return{units:sent.reduce((a,r)=>a+(r.units||0),0),value:0};
  }
  // Shipment type breakdown — use cache, include Lavarion shipments
  function calcShipTypeRange(start,end){
    let std=0,dg=0,os=0;
    // OA/stock rows
    const sentShipIds=new Set(rows.filter(r=>{if(r.sent!=='Yes'||!r.sentDate)return false;const d=new Date(r.sentDate);return d>=start&&d<=end;}).filter(r=>r.shipId).map(r=>r.shipId));
    sentShipIds.forEach(sid=>{
      const type=_shipTypeCache[sid]||rows.find(r=>r.shipId===sid)?.shipType||'Standard';
      const units=rows.filter(r=>r.shipId===sid&&r.sent==='Yes').reduce((a,r)=>a+(r.ship||0),0);
      if(type==='DG')dg+=units;
      else if(type==='Oversize')os+=units;
      else std+=units;
    });
    // Lavarion shipments
    const lavSentIds=new Set(lavShipments.filter(s=>{if(!s.date)return false;const d=new Date(s.date);return d>=start&&d<=end;}).filter(s=>s.shipId).map(s=>s.shipId));
    lavSentIds.forEach(sid=>{
      const type=_shipTypeCache[sid]||'Standard';
      const units=lavShipments.filter(s=>s.shipId===sid).reduce((a,s)=>a+(s.units||0),0);
      if(type==='DG')dg+=units;
      else if(type==='Oversize')os+=units;
      // Note: Lavarion units already counted in weekLav — only add to type breakdown
      // We don't add to std here as Lavarion is its own category in the display
    });
    return{std,dg,os};
  }

  // Mutually-exclusive split of sent units for the stacked Sent Mix bar. Stock
  // (OA) units are bucketed by their shipment type (Standard/DG/Oversize); ALL
  // Lavarion units are their own bucket so nothing is double-counted — even the
  // Lavarion shipments that happen to be DG- or oversize-typed (tracked in lavDG
  // /lavOS for the detail note). The four buckets sum to total.
  function calcSentMix(start,end){
    let std=0,dg=0,os=0;
    const sentShipIds=new Set(rows.filter(r=>{if(r.sent!=='Yes'||!r.sentDate)return false;const d=new Date(r.sentDate);return d>=start&&d<=end;}).filter(r=>r.shipId).map(r=>r.shipId));
    sentShipIds.forEach(sid=>{
      const type=_shipTypeCache[sid]||rows.find(r=>r.shipId===sid)?.shipType||'Standard';
      const units=rows.filter(r=>r.shipId===sid&&r.sent==='Yes').reduce((a,r)=>a+(r.ship||0),0);
      if(type==='DG')dg+=units;else if(type==='Oversize')os+=units;else std+=units;
    });
    let lav=0,lavDG=0,lavOS=0;const lavByShip={};
    lavShipments.filter(s=>{if(!s.date)return false;const d=new Date(s.date);return d>=start&&d<=end;}).forEach(s=>{lav+=(s.units||0);lavByShip[s.shipId]=(lavByShip[s.shipId]||0)+(s.units||0);});
    Object.entries(lavByShip).forEach(([sid,u])=>{const t=_shipTypeCache[sid]||'Standard';if(t==='DG')lavDG+=u;else if(t==='Oversize')lavOS+=u;});
    return{std,dg,os,lav,lavDG,lavOS,total:std+dg+os+lav};
  }

  const todayStock=calcSentStock(todayStr);
  const ydStock=calcSentStock(yesterdayStr);
  const weekStock=calcSentStockRange(ws,we);
  const weekLav=calcSentLavRange(ws,we);
  const weekTypes=calcShipTypeRange(ws,we);
  const todayLav=calcSentLavRange(todayStr,todayStr);

  const todayRet=calcSentReturnRange(todayStr,todayStr);
  const ydRet=calcSentReturnRange(yesterdayStr,yesterdayStr);
  const weekRet=calcSentReturnRange(ws,we);
  const ydLav=calcSentLavRange(yesterdayStr,yesterdayStr);

  // Canonical rollups (OA + Lavarion + Returns) keep the dashboard tile in step
  // with the prep sheet and shipments page.
  const todayRoll=sentRollup(todayStr,todayStr);
  const ydRoll=sentRollup(yesterdayStr,yesterdayStr);
  const weekRoll=sentRollup(ws,we);

  const todayTotal={units:todayRoll.units,value:todayRoll.value};
  const ydTotal={units:ydRoll.units,value:ydRoll.value};
  const weekTotal={units:weekRoll.units,value:weekRoll.value};

  // Boxes
  // ── ONE canonical box counter ──────────────────────────────────────────
  // Boxes belong to a shipment exactly once. Every tile, row and comparison
  // now counts via the same segment-aware rollup, so Today/Yesterday tiles,
  // Weekly Activity rows and the Week/Month tiles can never disagree again.
  function boxesForRoll(start,end){
    const roll=sentRollup(start,end);
    const ids=new Set(roll.rows.map(r=>r.shipId).filter(Boolean));
    return Array.from(ids).reduce((t,sid)=>t+(shipBoxes[sid]||0),0);
  }
  function boxesForDate(isoDate){return boxesForRoll(isoDate,isoDate);}
  function boxesForRange(start,end){
    // Delegates to the canonical rollup counter. Accepts Date objects or ISO
    // strings (callers pass both).
    const iso=v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:String(v).slice(0,10);
    return boxesForRoll(iso(start),iso(end));
  }
  const todayBoxes=boxesForDate(todayStr);
  const ydBoxes=boxesForDate(yesterdayStr);
  const weekBoxes=boxesForRange(ws,we);
  const weekShipments=weekRoll.shipments; // unique shipment IDs incl. Lavarion + Part-Sent, matches the Weekly Activity total

  // ── TRANSIT ──────────────────────────────────────────────────────────────────
  /* Jack, 4 Sep: "KPIs not matching" — Dashboard said 1,149 units / £26,407 in
     transit while the Prep Sheet said 477 / £14,497 for the same thing. This
     line counted ARCHIVED rows too, so every old cleared row still read as
     stock on the road. Archived is not in transit. */
  const transitRows=rows.filter(r=>r.status==='In-Transit'&&!r.archived);
  const transit={units:transitRows.reduce((a,r)=>a+(r.exp||0),0),value:transitRows.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.exp||0)),0),skus:transitRows.length,asins:new Set(transitRows.map(r=>r.asin)).size};

  // ── PIPELINE ─────────────────────────────────────────────────────────────────
  const pipelineStages=[
    {label:'In Transit',status:'In-Transit',color:'#5599ff'},
    {label:'Delivered',status:'Delivered',color:'#86efac'},
    {label:'In Warehouse',status:'In Warehouse',color:'#cc99ff'},
    {label:'Issue',status:'Issue',color:'#ff5555'},
    {label:'Not Arrived',status:'Not Arrived',color:'#ffaa33'},
  ];

  // ── CLAIMS ───────────────────────────────────────────────────────────────────
  const openClaimsList=claims.filter(c=>c.cst!=='Resolved'&&c.cst!=='Closed');  // includes Issue, Open, Chasing
  const issuedClaimsList=claims.filter(c=>c.cst==='Needs Attention');
  const chasingClaimsList=claims.filter(c=>c.cst==='Chasing');
  const resolvedClaimsList=claims.filter(c=>c.cst==='Resolved'||c.cst==='Closed');
  const openClaims=openClaimsList.length;
  const missingClaims=openClaimsList.filter(c=>c.issT==='Missing');
  const damagedClaims=openClaimsList.filter(c=>c.issT==='Damaged');
  const incorrectClaims=openClaimsList.filter(c=>c.issT==='Incorrect');
  const missingUnits=missingClaims.reduce((a,c)=>a+(c.dif||0),0);
  const damagedUnits=damagedClaims.reduce((a,c)=>a+(c.dif||0),0);
  const incorrectUnits=incorrectClaims.reduce((a,c)=>a+(c.dif||0),0);
  const totalIssueUnits=missingUnits+damagedUnits+incorrectUnits;
  const missingVal=missingClaims.reduce((a,c)=>a+(c.claimValue||0),0);
  const damagedVal=damagedClaims.reduce((a,c)=>a+(c.claimValue||0),0);
  const incorrectVal=incorrectClaims.reduce((a,c)=>a+(c.claimValue||0),0);
  const totalAtRisk=missingVal+damagedVal+incorrectVal;
  const resolvedVal=resolvedClaimsList.reduce((a,c)=>a+(c.claimValue||0),0);
  const resolvedReimbursedVal=resolvedClaimsList.filter(c=>c.reimbursed==='Yes').reduce((a,c)=>a+(c.claimValue||0),0);
  const resolvedOwedVal=resolvedClaimsList.filter(c=>(c.reimbursed||'No')==='No').reduce((a,c)=>a+(c.claimValue||0),0);
  const resolvedUnits=resolvedClaimsList.reduce((a,c)=>a+(c.dif||0),0);
  // Unique counts
  const affectedSkus=new Set(openClaimsList.map(c=>c.sku).filter(Boolean)).size;
  const affectedSuppliers=new Set(openClaimsList.map(c=>c.sup).filter(Boolean)).size;
  const resolvedSuppliers=new Set(resolvedClaimsList.map(c=>c.sup).filter(Boolean)).size;

  // ── STUCK ────────────────────────────────────────────────────────────────────
  /* Jack, 9 Sep: "overview/dashboard doesn't match" the Prep Sheet's Late
     button. It had a third private rule (In-Transit only, no S&S ever, 20
     hard-coded). One rule now — `_prepRowLate` — and the money counts what is
     still OWED, not the whole order. */
  const stuckRows=rows.filter(r=>_prepRowLate(r)&&!(r.resolution&&r.resolution.filed));
  const stuckValue=stuckRows.reduce((a,r)=>a+(parseSKU(r.sku).cogs*Math.max(0,_owedUnits(r))),0);
  const stuckUnits=stuckRows.reduce((a,r)=>a+Math.max(0,_owedUnits(r)),0);

  // ── WEEKLY PER-DAY ────────────────────────────────────────────────────────────
  const weekDays=[];
  const dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for(let i=0;i<7;i++){
    const d=new Date(ws);d.setDate(ws.getDate()+i);
    // Use local date not UTC
    const dy=d.getFullYear();
    const dm=String(d.getMonth()+1).padStart(2,'0');
    const dd2=String(d.getDate()).padStart(2,'0');
    const ds=`${dy}-${dm}-${dd2}`;
    // Canonical per-day rollup (segment-aware, includes Part-Sent + Lavarion +
    // Returns) so the daily rows and TOTAL match the "This Week" tile. The old
    // method used r.sent==='Yes' + whole-row r.ship on r.sentDate and dropped
    // Part-Sent/segment/return units, under-counting the week.
    const dayRoll=sentRollup(ds,ds);
    const dayShipIds=new Set(dayRoll.rows.map(r=>r.shipId).filter(Boolean));
    const ships=dayShipIds.size;
    const boxes=Array.from(dayShipIds).reduce((t,sid)=>t+(shipBoxes[sid]||0),0);
    const isFuture=ds>todayStr;
    weekDays.push({day:dayNames[i],ds,units:dayRoll.units,skus:dayRoll.skus,asins:dayRoll.asins,ships,boxes,cog:dayRoll.value||0,isToday:ds===todayStr,isFuture});
  }

  // Last week totals for comparison — clone ws/we properly
  const lastWs=new Date(ws.getTime());lastWs.setDate(lastWs.getDate()-7);
  const lastWe=new Date(we.getTime());lastWe.setDate(lastWe.getDate()-7);
  function localISOd(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  const lastWss=localISOd(lastWs),lastWes=localISOd(lastWe);
  const lwStock=calcSentStockRange(lastWs,lastWe);
  const lwLav=calcSentLavRange(lastWss,lastWes);
  const lwTotal={units:lwStock.units+lwLav.units,value:lwStock.value+lwLav.value};
  const lwBoxes=boxesForRange(lastWs,lastWe);
  const lwShipments=new Set(rows.filter(r=>r.sent==='Yes'&&r.sentDate&&r.sentDate>=lastWss&&r.sentDate<=lastWes&&r.shipId).map(r=>r.shipId)).size;
  const lwAsins=new Set(rows.filter(r=>r.sent==='Yes'&&r.sentDate&&r.sentDate>=lastWss&&r.sentDate<=lastWes).map(r=>r.asin)).size;
  const lwSkus=rows.filter(r=>r.sent==='Yes'&&r.sentDate&&r.sentDate>=lastWss&&r.sentDate<=lastWes).length
               +lavShipments.filter(s=>s.date&&s.date>=lastWss&&s.date<=lastWes).length;
  function vsLW(curr,prev){
    if(!prev)return'';
    const diff=curr-prev;
    const pct=Math.abs(Math.round(diff/prev*100));
    const col=diff>0?'#55ff55':diff<0?'#ff5555':'var(--text3)';
    const arrow=diff>0?'↑':diff<0?'↓':'→';
    return`<span style="color:${col};font-size:11px;font-weight:700;">${arrow}${pct}%</span>`;
  }

  // ── DASHBOARD CONSTANTS ──────────────────────────────────────────────────────
  const GOLD='#fbbf24';
  const COL={transit:'#38bdf8',today:'#4ade80',yday:'#fb923c',week:'#a78bfa',
             sku:'#60a5fa',asin:'#c084fc',box:'#fb923c',ship:'#34d399',cog:'#fbbf24'};

  // Centred KPI tile — hero units top, £ second, then stat pills
  const kTile=(title,col,units,unitLabel,gbp,gbpLabel,pills,badge,badgeCol,onClick,foot)=>`
    <div ${onClick?`onclick="${onClick}" role="button" tabindex="0" onkeydown="if(event.key==='Enter'){${onClick}}"`:''} style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 12px 10px;box-shadow:0 2px 10px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;text-align:center;gap:0;position:relative;${onClick?'cursor:pointer;':''}" ${onClick?'onmouseover="this.style.borderColor=\''+col+'88\'" onmouseout="this.style.borderColor=\'var(--border)\'"':''}>
      <span style="position:absolute;top:0;left:14px;right:14px;height:2px;background:${col};opacity:.5;border-radius:0 0 3px 3px;"></span>
      <div style="font-size:10px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;display:flex;align-items:center;gap:5px;">
        ${title}${onClick?'<span style="font-size:10px;color:#9aa7ba;">▾</span>':''}${badge?`<span style="font-size:14px;color:${badgeCol||col};">${badge}</span>`:''}
      </div>
      <div style="font-size:36px;font-weight:900;color:${col};font-family:var(--num);font-variant-numeric:tabular-nums;line-height:1;">${units}</div>
      <div style="font-size:10px;color:#aeb9c9;margin:3px 0 8px;">${unitLabel}</div>
      <div style="font-size:16px;font-weight:800;color:${GOLD};font-family:var(--num);font-variant-numeric:tabular-nums;margin-bottom:2px;">${gbp}</div>
      <div style="font-size:11px;color:#aeb9c9;margin-bottom:10px;">${gbpLabel}</div>
      <div style="width:100%;display:flex;flex-direction:column;gap:0;">
        ${pills}
      </div>
      <div style="width:100%;margin-top:6px;padding-top:6px;border-top:1px solid var(--border);font-size:10.5px;color:#8b96a6;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(foot||'').replace(/<[^>]+>/g,'')}">${foot||''}</div>
    </div>`;

  const _pillSemantic=[GOLD,'#4ade80','#f87171','#fb923c','#22c55e','#ef4444'];
  const pill=(label,val,col)=>{
    const vc=_pillSemantic.includes(col)?col:'#cbd5e1';   // neutralise decorative colours
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 8px;background:rgba(255,255,255,.03);border-radius:4px;margin-bottom:2px;">
      <span style="font-size:11px;color:#aeb9c9;font-weight:500;">${label}</span>
      <span style="font-size:12px;font-weight:700;font-family:var(--mono);color:${vc};">${val}</span>
    </div>`;};

  loadPrepFees();

  // ── PREP COST (MTD) ───────────────────────────────────────────────────────
  const{s:ms,e:me}=getMonthRange();
  function localISOm(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  const mss=localISOm(ms),mes=localISOm(me);
  const mtdSentRows=rows.filter(r=>r.sent==='Yes'&&r.sentDate&&r.sentDate>=mss&&r.sentDate<=mes);
  const mtdSentLav=lavShipments.filter(s=>s.date&&s.date>=mss&&s.date<=mes);
  const mtdShipIds=new Set([...mtdSentRows.filter(r=>r.shipId).map(r=>r.shipId),...mtdSentLav.filter(s=>s.shipId).map(s=>s.shipId)]);
  const mtdBoxMap=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>mtdShipIds.has(sid)));
  _smartExpCache=null;
  const prepCost=calcImpliedPrepCost(mtdSentRows,mtdSentLav,mtdBoxMap,smartExpectedUnits());

  // Per-shipment costs this week
  function calcShipmentPrepCost(shipId){
    const sRows=rows.filter(r=>r.sent==='Yes'&&r.shipId===shipId);
    const sLav=lavShipments.filter(s=>s.shipId===shipId);
    const sBoxMap=shipBoxes[shipId]?{[shipId]:shipBoxes[shipId]}:{};
    return calcImpliedPrepCost(sRows,sLav,sBoxMap,smartExpectedUnits());
  }

  // Per-day costs this week
  const dayPrepCosts={};
  weekDays.filter(d=>!d.isFuture&&d.units>0).forEach(d=>{
    const dRows=rows.filter(r=>r.sent==='Yes'&&r.sentDate===d.ds);
    const dLav=lavShipments.filter(s=>s.date===d.ds);
    const dShipIds=new Set([...dRows.filter(r=>r.shipId).map(r=>r.shipId),...dLav.filter(s=>s.shipId).map(s=>s.shipId)]);
    const dBoxMap=Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>dShipIds.has(sid)));
    dayPrepCosts[d.ds]=calcImpliedPrepCost(dRows,dLav,dBoxMap,smartExpectedUnits());
  });

  // Per-tile prep costs
  const mkTilePC=(sentDate,yd)=>{
    const r=rows.filter(x=>x.sent==='Yes'&&x.sentDate===sentDate);
    const l=lavShipments.filter(x=>x.date===sentDate);
    const ids=new Set([...r.filter(x=>x.shipId).map(x=>x.shipId),...l.filter(x=>x.shipId).map(x=>x.shipId)]);
    return calcImpliedPrepCost(r,l,Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>ids.has(sid))),smartExpectedUnits());
  };
  const todayPC=mkTilePC(todayStr);
  const ydPC=mkTilePC(yesterdayStr);
  const weekShipIdSet=new Set([...rows.filter(r=>r.sent==='Yes'&&r.sentDate&&new Date(r.sentDate)>=ws&&new Date(r.sentDate)<=we&&r.shipId).map(r=>r.shipId),...lavShipments.filter(s=>s.date&&new Date(s.date)>=ws&&new Date(s.date)<=we&&s.shipId).map(s=>s.shipId)]);
  const weekPC=calcImpliedPrepCost(rows.filter(r=>r.sent==='Yes'&&r.sentDate&&new Date(r.sentDate)>=ws&&new Date(r.sentDate)<=we),lavShipments.filter(s=>s.date&&new Date(s.date)>=ws&&new Date(s.date)<=we),Object.fromEntries(Object.entries(shipBoxes).filter(([sid])=>weekShipIdSet.has(sid))),smartExpectedUnits());

  // MTD totals — use the canonical sentRollup so the dashboard tile matches the
  // Shipments page (source of truth) and Prep Sheet exactly. The old logic used
  // r.sent==='Yes' (dropping Part-Sent rows), whole-row r.ship totals on r.sentDate
  // (instead of per-segment units/dates) and omitted Returns, which under-counted
  // units, COG and shipments. sentRollup is segment-aware and includes OA (incl.
  // Part-Sent) + Lavarion + Returns, with Return COG excluded — exactly like Shipments.
  const monthRoll=sentRollup(ms,me);
  const mtdSentRowsFull=rows.filter(r=>r.sent==='Yes'&&r.sentDate&&r.sentDate>=mss&&r.sentDate<=mes);
  const mtdSentLavFull=lavShipments.filter(s=>s.date&&s.date>=mss&&s.date<=mes);
  const mtdUnits=monthRoll.units;
  const mtdCOG=monthRoll.value;
  const mtdShipCount=monthRoll.shipments;
  const mtdSkus=monthRoll.skus;
  const mtdAsins=monthRoll.asins;
  const mtdBoxesCount=Array.from(new Set(monthRoll.rows.map(r=>r.shipId).filter(Boolean))).reduce((a,sid)=>a+(shipBoxes[sid]||0),0);
  const mtdPrepDays=new Set(monthRoll.rows.map(r=>r.isoDate).filter(Boolean)).size;
  const todaySkus=todayRoll.skus;
  const weekAsins=weekRoll.asins;
  const weekSkus=weekRoll.skus;
  const weekLavAsins=new Set(lavShipments.filter(s=>s.date&&new Date(s.date)>=ws&&new Date(s.date)<=we).map(s=>s.asin)).size;
  const todayAsins=todayRoll.asins;
  const ydSkus=ydRoll.skus;

  // Yesterday vs day before
  const db2=new Date();db2.setDate(db2.getDate()-2);
  const db2s=`${db2.getFullYear()}-${String(db2.getMonth()+1).padStart(2,'0')}-${String(db2.getDate()).padStart(2,'0')}`;
  const db2u=rows.filter(r=>r.sent==='Yes'&&r.sentDate===db2s).reduce((a,r)=>a+(r.ship||0),0)+lavShipments.filter(s=>s.date===db2s).reduce((a,s)=>a+(s.units||0),0);
  const ydDiff=ydTotal.units-db2u;
  const ydArrow=ydDiff>0?'↑':ydDiff<0?'↓':'→';
  const ydACol=ydDiff>0?COL.today:ydDiff<0?'#f87171':'#64748b';

  // Today trend
  const trendArrow=todayTotal.units>ydTotal.units?'↑':todayTotal.units<ydTotal.units?'↓':'→';
  const trendCol=todayTotal.units>ydTotal.units?COL.today:todayTotal.units<ydTotal.units?'#f87171':'#64748b';
  const todayDiff=Math.abs(todayTotal.units-ydTotal.units);

  // ── SENT MIX (week + month, mutually-exclusive buckets) ──────────────────────
  const mixWeek=calcSentMix(ws,we);
  const mixMonth=calcSentMix(ms,me);
  // Reconcile the mix to the canonical sent totals: OA units sent without a
  // shipId/type default to Standard, so fold any remainder in rather than
  // letting the bar under-count vs the Sent-this-week / month tiles.
  (function(){
    const wkRem=weekTotal.units-mixWeek.total; if(wkRem>0){mixWeek.std+=wkRem;mixWeek.total=weekTotal.units;}
    const moRem=monthRoll.units-mixMonth.total; if(moRem>0){mixMonth.std+=moRem;mixMonth.total=monthRoll.units;}
  })();

  // ── MONTH PACE / HEALTH ──────────────────────────────────────────────────────
  // Project the month-end pace from what's gone out so far and compare it to the
  // recent monthly average, separately for total units, Lavarion and OA (stock).
  const mtdLavUnits=calcSentLavRange(mss,mes).units;
  const mtdStockUnits=Math.max(0,mtdUnits-mtdLavUnits);
  const _now=new Date();
  const _dim=new Date(_now.getFullYear(),_now.getMonth()+1,0).getDate();
  const _frac=Math.max(_now.getDate()/_dim,0.0001);
  const projUnits=Math.round(mtdUnits/_frac);
  const projLav=Math.round(mtdLavUnits/_frac);
  const projStock=Math.round(mtdStockUnits/_frac);
  // Recent monthly averages from history, excluding the current (partial) month.
  let avgUnits=0,avgLav=0,avgStock=0,histN=0;
  try{
    const ser=(typeof _insMonthSeries==='function'?_insMonthSeries():[]);
    const prior=ser.slice(0,-1).slice(-3); // up to 3 completed months
    histN=prior.length;
    if(histN){
      avgUnits=prior.reduce((a,s)=>a+(s.units||0),0)/histN;
      avgLav=prior.reduce((a,s)=>a+(s.lav||0),0)/histN;
      avgStock=prior.reduce((a,s)=>a+(s.stock||0),0)/histN;
    }
  }catch(e){}
  const paceVerdict=(proj,base)=>{
    if(!base)return{label:'No baseline',col:'#64748b',sub:'not enough history yet',r:0};
    const r=proj/base;
    if(r>=1.10)return{label:'Strong',col:'#4ade80',sub:`pacing ${Math.round((r-1)*100)}% above your recent average`,r};
    if(r>=0.90)return{label:'On track',col:'#fbbf24',sub:'in line with your recent average',r};
    if(r>=0.75)return{label:'A bit behind',col:'#fb923c',sub:`pacing ${Math.round((1-r)*100)}% below average`,r};
    return{label:'Slow',col:'#f87171',sub:`pacing ${Math.round((1-r)*100)}% below average`,r};
  };
  const vUnits=paceVerdict(projUnits,avgUnits);
  const vLav=paceVerdict(projLav,avgLav);
  const vStock=paceVerdict(projStock,avgStock);

  /* Two mini banners: what is waiting on Jack, and what Sarah has not actioned.
     Each jumps straight to the section that fixes it — the whole point is that
     nobody has to remember to go and look. */
  const _jt=jackTodo(),_st=sarahTodo();
  const _ban=(col,ttl,sub,btn,go)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:9px;
      background:${col}14;border:1px solid ${col}55;">
    <div style="width:8px;height:8px;border-radius:50%;background:${col};flex:none;"></div>
    <div style="min-width:0;">
      <div style="font-size:12.5px;font-weight:800;color:${col};">${ttl}</div>
      <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:1px;">${sub}</div>
    </div>
    <button onclick="${go}" style="margin-left:auto;flex:none;padding:7px 15px;border-radius:7px;cursor:pointer;
      font-size:11.5px;font-weight:800;background:${col};border:1px solid ${col};color:#12100a;">${btn}</button>
  </div>`;
  const _banners=[
    (()=>{const gated=claims.filter(c=>!c.archived&&c.cst!=='Resolved'&&(c.owner||'VA')==='Jack');
      return gated.length?_ban('#c084fc','Gated — '+gated.length+' waiting on your decision',
        'eBay it, ungate it, hold it or write it off — nobody else can move these',
        'Open','navToPage(\'claims\')'):'';})(),
    _jt.n?_ban('#60a5fa','Waiting on you — '+_jt.n,
      [_jt.closures.length?_jt.closures.length+' closure'+(_jt.closures.length===1?'':'s')+' to approve':'',
       _jt.fixes.length?_jt.fixes.length+' quantity correction'+(_jt.fixes.length===1?'':'s')+' to see':''].filter(Boolean).join(' · '),
      'Review','goAdminSection(\'secApprovals\')'):'',
    (_st.n||_st.late)?_ban('#fbbf24','Sarah — '+(_st.late?'page not checked':_st.n+' not actioned'),
      [_st.late?'overdue check-in':'',
       _st.open.length?_st.open.length+' follow-up job'+(_st.open.length===1?'':'s'):'',
       _st.sentBack.length?_st.sentBack.length+' sent back':'',
       _st.chase?_st.chase+' still to chase':''].filter(Boolean).join(' · '),
      'Open','goAdminSection(\'secActions\')'):''
  ].filter(Boolean).join('');

  w.innerHTML=`<div style="padding:12px;display:flex;flex-direction:column;gap:10px;">
    ${_banners}

    <!-- ROW 1: 5 KPI tiles -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;">

      ${kTile('In Transit',COL.transit,
        fmt(transit.units),'units in transit',
        fmtGBP2(transit.value),'COG value in transit',
        pill('SKUs',fmt(transit.skus),COL.sku)+pill('ASINs',fmt(transit.asins),COL.asin)+pill('Boxes','—',COL.box)+pill('COG/unit',transit.units?fmtGBP2(transit.value/transit.units):'—',GOLD)+pill('Suppliers',fmt(new Set(transitRows.map(r=>r.sup).filter(Boolean)).size),COL.ship),
        '','',null,'on the road — not yet checked in at Amazon')
      }

      ${kTile('Sent Today',COL.today,
        fmt(todayTotal.units),'units sent today',
        fmtGBP2(todayTotal.value),'COG value sent',
        pill('SKUs',fmt(todaySkus),COL.sku)+pill('ASINs',fmt(todayAsins),COL.asin)+pill('Boxes',fmt(todayBoxes),COL.box)+pill('COG/unit',todayTotal.units?fmtGBP2(todayTotal.value/todayTotal.units):'—',GOLD)+pill('vs Yesterday',`${trendArrow} ${todayDiff} units`,trendCol),
        trendArrow,trendCol,null,
        `COG ${(todayTotal.value-ydTotal.value>=0?'+':'−')}${fmtGBP2(Math.abs(todayTotal.value-ydTotal.value)).replace('£','£')} vs yesterday${todayPC.totalUnits>0?` · prep ${fmtGBP2(todayPC.withVat)}`:''}`)
      }

      ${kTile('Yesterday',COL.yday,
        fmt(ydTotal.units),'units sent',
        fmtGBP2(ydTotal.value),'COG value sent',
        pill('SKUs',fmt(ydSkus),COL.sku)+pill('ASINs',fmt(ydRoll.asins),COL.asin)+pill('Boxes',fmt(ydBoxes),COL.box)+pill('COG/unit',ydTotal.units?fmtGBP2(ydTotal.value/ydTotal.units):'—',GOLD)+pill('vs Day Before',`${ydArrow} ${Math.abs(ydDiff)} units`,ydACol),
        '','',null,ydPC.totalUnits>0?`prep ${fmtGBP2(ydPC.withVat)}`:'')
      }

      ${kTile('This Week',COL.week,
        fmt(weekTotal.units),'units sent this week',
        fmtGBP2(weekTotal.value),'COG value sent',
        pill('SKUs',fmt(weekSkus),COL.sku)+pill('ASINs',fmt(weekAsins),COL.asin)+pill('Boxes',fmt(weekBoxes),COL.box)+pill('COG/unit',weekTotal.units?fmtGBP2(weekTotal.value/weekTotal.units):'—',GOLD)+(lwTotal.units>0?pill('vs Last Week',`${weekTotal.units>=lwTotal.units?'\u2191':'\u2193'} ${Math.abs(weekTotal.units-lwTotal.units)} units`,weekTotal.units>=lwTotal.units?'#4ade80':'#f87171'):pill('vs Last Week','—','#cbd5e1')),
        '','',null,
        `${fmt(weekShipments)} shipment${weekShipments===1?'':'s'}${weekLavAsins?` · ${fmt(weekLav.units)} Lavarion`:''}${weekPC.totalUnits>0?` · prep ${fmtGBP2(weekPC.withVat)}`:''}`)
      }

      ${kTile('This Month',`#06b6d4`,
        fmt(mtdUnits),'units sent this month',
        fmtGBP2(mtdCOG),'COG value sent',
        pill('SKUs',fmt(mtdSkus),COL.sku)+pill('ASINs',fmt(mtdAsins),COL.asin)+pill('Boxes',fmt(mtdBoxesCount),COL.box)+pill('COG/unit',mtdUnits?fmtGBP2(mtdCOG/mtdUnits):'—',GOLD)+((()=>{try{/* Jack, 9 Sep: "pro rate it." Month-to-date was being measured against last month's FULL total, so the 9th of the month always looked like a collapse. Same days, same question — and the full month is on the tooltip. */const n=new Date(),pS=new Date(n.getFullYear(),n.getMonth()-1,1),pLast=new Date(n.getFullYear(),n.getMonth(),0).getDate(),dN=Math.min(n.getDate(),pLast),pE=new Date(n.getFullYear(),n.getMonth()-1,dN,23,59,59,999),pr=sentRollup(pS,pE),nm=pS.toLocaleDateString('en-GB',{month:'short'});if(pr&&pr.units){const d=mtdUnits-pr.units,full=sentRollup(pS,new Date(n.getFullYear(),n.getMonth(),0,23,59,59,999));return pill(`<span title="${fmt(mtdUnits)} units by day ${dN} this month against ${fmt(pr.units)} by day ${dN} of ${nm}. ${nm} finished on ${fmt(full.units)} units.">vs ${nm} 1&ndash;${dN}</span>`,`${d>=0?'\u2191':'\u2193'} ${fmt(Math.abs(d))} units`,d>=0?'#4ade80':'#f87171');}}catch(e){}return pill('vs Last Month','—','#cbd5e1');})()),
        '','','openMonthHistory()',
        `${fmt(mtdShipCount)} shipment${mtdShipCount===1?'':'s'}${prepCost.lavUnits>0?` · ${fmt(prepCost.lavUnits)} Lavarion`:''} · ${fmt(mtdPrepDays)} prep day${mtdPrepDays===1?'':'s'}${prepCost.totalUnits>0?` · prep ${fmtGBP2(prepCost.withVat)}`:''}`)
      }
    </div>

    <!-- ROW 2: Equal 3-col tetris — weekly+stock | type+pipeline+claims+ops | stuck -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start;">

      <!-- Col 1: how we are tracking — Weekly Activity + Month Pace -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px;">
            <div>
              <div style="font-size:12px;font-weight:700;color:#f1f5f9;letter-spacing:.01em;">Weekly Activity</div>
              <div style="font-size:10.5px;color:var(--text3);margin-top:2px;">${(()=>{const{s:a,e:b}=getWeekRange();
                const f=d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
                /* Loud when you are NOT on this week. Every week before the app
                   went live is empty, so a past week rendered in the same quiet
                   grey was indistinguishable from an arrow that did nothing. */
                const lbl=WEEK_OFFSET===0?'this week':WEEK_OFFSET===1?'last week':WEEK_OFFSET+' weeks ago';
                return WEEK_OFFSET===0?lbl+' · '+f(a)+' – '+f(b)
                  :`<b style="color:var(--accent);font-weight:800;">${lbl}</b> · ${f(a)} – ${f(b)}`;})()}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;color:#9aa7ba;">${weekDays.filter(d=>!d.isFuture&&d.units>0).length} active day${weekDays.filter(d=>!d.isFuture&&d.units>0).length===1?'':'s'}</span>
              ${/* data-week is the real handler — see wireWeekArrows(). The inline
                    onclick is kept as a belt-and-braces fallback, but it is no
                    longer the thing this depends on: an inline handler has to
                    resolve `shiftWeek` off the global scope at the moment of the
                    click, and it is bigger and sits above its neighbours now
                    because a 26px target with something overlapping it is
                    indistinguishable from a dead button. */''}
              ${/* Pick any week directly — pressing ‹ six times meant re-aiming
                    six times, because the This-week button used to appear
                    BETWEEN the arrows and shove them sideways. The picker jumps
                    straight there, and every control now keeps its position:
                    This-week reserves its space even when hidden. */''}
              <select onchange="weekPick(this.value)" title="Jump to a week"
                style="height:32px;padding:0 8px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;max-width:190px;">
                ${Array.from({length:26},(_,k)=>{const{s:a,e:b}=getWeekRange(k);
                  const f=d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
                  const nm=k===0?'This week':k===1?'Last week':k+' weeks ago';
                  return `<option value="${k}" ${k===WEEK_OFFSET?'selected':''}>${nm} · ${f(a)} – ${f(b)}</option>`;}).join('')}
              </select>
              <button type="button" data-week="1" title="The week before"
                style="position:relative;z-index:5;width:32px;height:32px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:6px;font-size:15px;cursor:pointer;line-height:1;">‹</button>
              <button type="button" data-week="0" title="Back to this week" style="position:relative;z-index:5;padding:0 10px;height:32px;background:var(--bg3);border:1px solid var(--accent);color:var(--accent);border-radius:6px;font-size:10.5px;font-weight:800;cursor:pointer;visibility:${WEEK_OFFSET>0?'visible':'hidden'};">This week</button>
              <button type="button" data-week="-1" ${WEEK_OFFSET===0?'disabled':''} title="The week after"
                style="position:relative;z-index:5;width:32px;height:32px;background:var(--bg3);border:1px solid var(--border2);color:${WEEK_OFFSET===0?'var(--text3)':'var(--text2)'};border-radius:6px;font-size:15px;cursor:${WEEK_OFFSET===0?'default':'pointer'};line-height:1;opacity:${WEEK_OFFSET===0?'.4':'1'};">›</button>
            </div>
          </div>
          ${(()=>{
            // Cohesive, slightly-muted palette. Each metric keeps ONE consistent
            // colour identity (so colour = meaning, not decoration) — lively but
            // not neon, and no glows/gradients beyond today's accent bar.
            const AC='#38bdf8', COG='#34d399', SKU='#818cf8', SHIP='#f472b6', BOX='#fbbf24';
            const TXT='#e8edf4', DIM='#94a3b8', FAINT='#5c6675', LINE='rgba(255,255,255,.06)';
            const wmax=Math.max(...weekDays.filter(d=>!d.isFuture).map(d=>d.units),1);
            const daysHtml=weekDays.map(d=>{
              const isT=d.isToday,isF=d.isFuture,isW=d.day==='Sat'||d.day==='Sun';
              /* A day with nothing in it is a day with nothing in it, whatever
                 day of the week it falls on. Only WEEKEND zeros used to say "no
                 activity"; a quiet Thursday printed a full row of \u00a30.00, 0 SKUs,
                 0 ships, 0 boxes \u2014 and a bar \u2014 which reads as broken data rather
                 than a quiet day. */
              if(isF||d.units===0){
                return `<div style="display:flex;align-items:center;gap:12px;padding:9px 2px;border-bottom:1px solid ${LINE};">
                  <span style="width:40px;font-size:12px;font-weight:600;color:${FAINT};">${d.day}</span>
                  <span style="flex:1;font-size:11px;color:${FAINT};">${isF?'upcoming':'no activity'}</span>
                  <span style="font-size:12px;font-family:var(--mono);color:${FAINT};">\u2014</span></div>`;
              }
              /* The 3% floor exists so a tiny day is still visible \u2014 but it was
                 applied to zero as well, so a day with 0 units drew the same bar
                 as a day with 8. Zero days never reach here now, and the floor
                 only protects genuine activity. */
              const bar=Math.max(3,Math.round(d.units/wmax*100));
              return `<div style="display:flex;align-items:center;gap:13px;padding:10px 4px;border-radius:8px;margin-bottom:2px;${isT?'background:rgba(56,189,248,.07);':''}border-bottom:1px solid ${LINE};">
                <span style="width:42px;font-size:12.5px;font-weight:${isT?'700':'600'};color:${isT?AC:TXT};line-height:1.15;">${d.day}${isT?'<span style="display:block;font-size:9.5px;font-weight:800;color:'+AC+';letter-spacing:.06em;">TODAY</span>':''}</span>
                <div style="flex:1;">
                  <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.05);overflow:hidden;margin-bottom:6px;">
                    <div style="width:${bar}%;height:100%;border-radius:4px;background:${isT?'linear-gradient(90deg,#38bdf8,#0ea5e9)':'rgba(56,189,248,.45)'};"></div>
                  </div>
                  <div style="font-size:11.5px;color:#c3cde0;display:flex;gap:14px;">
                    <span style="color:${COG};font-weight:600;">${fmtGBP2(d.cog)}</span>
                    <span><span style="color:${SKU};font-weight:700;">${d.skus}</span> SKUs</span>
                    <span><span style="color:${SHIP};font-weight:700;">${d.ships}</span> ships</span>
                    <span><span style="color:${BOX};font-weight:700;">${d.boxes}</span> boxes</span>
                  </div>
                </div>
                <span style="font-size:16px;font-family:var(--mono);font-weight:800;color:${isT?AC:TXT};min-width:46px;text-align:right;">${fmt(d.units)}</span>
              </div>`;
            }).join('')
            /* An entirely empty week said nothing at all, so pressing ‹ into one
               looked identical to pressing a dead button. Say it plainly. */
            +(WEEK_OFFSET>0&&!weekDays.some(d=>d.units>0)
              ? `<div style="padding:16px 2px;text-align:center;">
                   <div style="font-size:12px;font-weight:700;color:${DIM};">Nothing went out this week</div>
                   <div style="font-size:11px;color:${FAINT};margin-top:3px;">No shipments recorded between these dates.</div>
                 </div>`:'');

            const act=weekDays.filter(d=>!d.isFuture&&d.units>0);
            const nD=act.length||1;
            const tU=act.reduce((a,d)=>a+d.units,0),tSh=act.reduce((a,d)=>a+d.ships,0),tBx=act.reduce((a,d)=>a+d.boxes,0),tSk=act.reduce((a,d)=>a+d.skus,0),tCog=act.reduce((a,d)=>a+d.cog,0),tAs=weekRoll.asins;
            const best=act.slice().sort((a,b)=>b.units-a.units)[0];

            const avgCard=(label,val,col)=>`<div style="flex:1;background:rgba(255,255,255,.025);border:1px solid ${LINE};border-radius:8px;padding:9px 6px;text-align:center;">
              <div style="font-size:10px;color:${DIM};text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px;">${label}</div>
              <div style="font-size:15px;font-family:var(--mono);font-weight:800;color:${col};line-height:1;">${val}</div>
            </div>`;

            const lw=lwTotal.units>0||lwSkus>0;
            const cmp=(l,cur,prv,col,ff)=>{
              const f=ff||fmt;
              const dd=cur-prv,p=prv?Math.abs(Math.round(dd/prv*100)):0;
              const ac=dd>0?'#4ade80':dd<0?'#f87171':FAINT,ar=dd>0?'\u25b2':dd<0?'\u25bc':'\u2013';
              return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid ${LINE};">
                <span style="font-size:12px;color:#c3cde0;width:58px;">${l}</span>
                <span style="font-size:13px;font-family:var(--mono);font-weight:800;color:${col};flex:1;text-align:right;padding-right:10px;">${f(cur)}</span>
                <span style="font-size:11.5px;color:#b6c2d4;font-family:var(--mono);width:64px;text-align:right;">${f(prv)}</span>
                <span style="font-size:11px;font-weight:700;color:${ac};width:56px;text-align:right;">${ar} ${p}%</span>
              </div>`;
            };
            /* Pace against the week before, projected from the days gone so
               far. Only meaningful on the CURRENT week: on a finished week every
               day is already counted, so the projection was just the total
               written out twice — "718 units · projecting ~718" — under a heading
               that said "Week so far" about a week that ended days ago. */
            const isNow=WEEK_OFFSET===0;
            const elapsedD=weekDays.filter(d=>!d.isFuture).length||1;
            const projU=Math.round(tU/elapsedD*7);
            const partWeek=isNow&&elapsedD<7;
            const cmpR=lwTotal.units?((partWeek?projU:tU)/lwTotal.units):1;
            /* "Behind last week" is a nonsense when last week is the thing you
               are looking at. Name the week it is actually measured against. */
            const vs=isNow?'last week':'the week before';
            const pace=lw?(cmpR>=1.05?{t:'Ahead of '+vs,c:'#4ade80',ar:'\u25b2'}
              :cmpR<=0.95?{t:'Behind '+vs,c:'#f87171',ar:'\u25bc'}
              :{t:'On pace with '+vs,c:'#7dd3fc',ar:'\u2192'}):null;

            return `<div style="margin-bottom:16px;">${daysHtml}</div>

            <div style="background:linear-gradient(135deg,rgba(56,189,248,.06),rgba(52,211,153,.04));border:1px solid rgba(56,189,248,.14);border-radius:10px;padding:14px 15px;margin-bottom:14px;">
              <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:14px;">
                <div>
                  <div style="font-size:10px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px;">${isNow?(partWeek?'Week so far':'This week'):'That week — total'}</div>
                  <div style="font-size:28px;font-family:var(--mono);font-weight:900;color:${TXT};line-height:1;">${fmt(tU)}<span style="font-size:12px;color:${DIM};font-weight:500;margin-left:6px;">units</span></div>
                  ${pace?`<div style="font-size:11px;font-weight:600;color:${pace.c};margin-top:7px;">${pace.ar} ${pace.t}${partWeek?` <span style="color:${FAINT};font-weight:500;">\u00b7 projecting ~${fmt(projU)}</span>`:''}</div>`:''}
                </div>
                <div style="text-align:right;">
                  <div style="font-size:10px;color:${DIM};text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">COG value</div>
                  <div style="font-size:17px;font-family:var(--mono);font-weight:800;color:${COG};line-height:1;">${fmtGBP2(tCog)}</div>
                  ${best?`<div style="font-size:10.5px;color:${FAINT};margin-top:6px;">Best: <span style="color:${DIM};">${best.day} \u00b7 ${fmt(best.units)}</span></div>`:''}
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                ${avgCard('Units/day',fmt(Math.round(tU/nD)),AC)}
                ${avgCard('COG/day',fmtGBP2(tCog/nD),COG)}
                ${avgCard('Boxes/day',(tBx/nD).toFixed(1),BOX)}
                ${avgCard('Ships/day',(tSh/nD).toFixed(1),SHIP)}
              </div>
            </div>

            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;">
                <span style="font-size:10px;font-weight:700;color:#b6c2d4;text-transform:uppercase;letter-spacing:.07em;">This week vs last</span>
                <div style="display:flex;font-size:10px;color:${FAINT};text-transform:uppercase;letter-spacing:.04em;">
                  <span style="width:52px;text-align:right;">now</span><span style="width:52px;text-align:right;">last</span><span style="width:56px;text-align:right;">change</span>
                </div>
              </div>
              ${lw?cmp('Units',tU,lwTotal.units,AC)+cmp('COG',tCog,lwTotal.value,COG,fmtGBP2)+cmp('SKUs',tSk,lwSkus,SKU)+cmp('Ships',tSh,lwShipments,SHIP)+cmp('ASINs',tAs,lwAsins,'#38bdf8')+cmp('Boxes',tBx,lwBoxes,BOX)
                :`<div style="font-size:11px;color:${FAINT};text-align:center;padding:10px 0;">No last-week data to compare yet</div>`}
            </div>`})()}
        </div>
        <!-- Month Pace / Health verdict -->
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
            <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Month Pace</div>
            <div style="font-size:10px;color:#b6c2d4;">${histN?`vs avg of last ${histN} mo`:'building history'}</div>
          </div>
          <div style="display:flex;align-items:baseline;gap:8px;">
            <span style="font-size:22px;font-weight:900;color:${vUnits.col};line-height:1;">${vUnits.label}</span>
            <span style="font-size:12.5px;color:#dbe3ee;">month for units sent</span>
          </div>
          <div style="font-size:12.5px;color:#dbe3ee;margin:5px 0 11px;line-height:1.5;">${fmt(mtdUnits)} sent so far · projecting <b style="color:${vUnits.col};">${fmt(projUnits)}</b> by month-end — ${vUnits.sub}.</div>
          ${[['Units sent',mtdUnits,projUnits,avgUnits,vUnits,COL.week],['Lavarion',mtdLavUnits,projLav,avgLav,vLav,COL.asin],['OA / stock',mtdStockUnits,projStock,avgStock,vStock,COL.sku]].map(([l,mtdv,proj,avg,v,col])=>`
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <span style="flex:1;font-size:12.5px;color:${col};font-weight:700;">${l}</span>
              <span style="font-size:12.5px;font-family:var(--mono);color:#f1f5f9;" title="sent so far → projected month-end · recent monthly avg">${fmt(mtdv)} → ${fmt(proj)}${avg?` <span style="color:#aeb9c9;">/ ${fmt(Math.round(avg))} avg</span>`:''}</span>
              <span style="font-size:11px;font-weight:800;color:${v.col};min-width:64px;text-align:right;">${v.label}</span>
            </div>`).join('')}
          <div style="font-size:11px;color:#aeb9c9;margin-top:9px;line-height:1.5;">Projection = sent-so-far ÷ share of month elapsed (${Math.round(_frac*100)}%). Recent avg = mean of completed months.</div>
        </div>
      </div>

      <!-- Col 2: what needs attention — Claims + Stuck + Active Inventory -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:var(--bg2);border:1px solid ${totalAtRisk>0?'rgba(248,113,113,.3)':'var(--border)'};border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <!-- Header -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:11px;font-weight:800;color:#e2e8f0;text-transform:uppercase;letter-spacing:.1em;">⚑ Claims & Issues</div>
            ${totalAtRisk>0?`<div style="font-size:14px;font-weight:900;font-family:var(--mono);color:#fbbf24;">${fmtGBP2(totalAtRisk)}</div>`:''}
          </div>

          ${openClaims===0&&resolvedClaimsList.length===0?`<div style="color:#4ade80;font-size:12px;font-weight:700;padding:6px 0;">✓ All clear — no open issues</div>`:`

          <!-- Status breakdown hero row -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px;">
            ${[
              ['Issue',issuedClaimsList.length,'#ff6b6b'],
              ['Open',openClaimsList.filter(c=>c.cst==='Open').length,'#f97316'],
              ['Chasing',chasingClaimsList.length,'#fbbf24'],
              ['Resolved',resolvedClaimsList.length,'#4ade80'],
            ].map(([l,n,col])=>`<div style="background:${col}18;border:2px solid ${col}55;border-radius:6px;padding:6px 4px;text-align:center;">
              <div style="font-size:18px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1;">${n}</div>
              <div style="font-size:11px;color:#b6c2d4;margin-top:2px;font-weight:600;">${l}</div>
            </div>`).join('')}
          </div>

          <!-- By issue type -->
          ${(missingClaims.length+damagedClaims.length+incorrectClaims.length)>0?`
          <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08);">
            <div style="font-size:10px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px;">By Type</div>
            ${[['Missing',missingClaims.length,missingUnits,missingVal,'#f87171'],['Damaged',damagedClaims.length,damagedUnits,damagedVal,'#fb923c'],['Incorrect',incorrectClaims.length,incorrectUnits,incorrectVal,'#60a5fa']].filter(([,cnt])=>cnt>0).map(([l,cnt,u,val,col])=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;margin-bottom:3px;background:${col}10;border-radius:4px;border-left:3px solid ${col};">
              <div>
                <span style="font-size:11px;font-weight:800;color:${col};">${l}</span>
                <span style="font-size:10px;color:#b6c2d4;margin-left:5px;">${cnt} claim${cnt!==1?'s':''}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:11px;font-weight:700;color:#e2e8f0;font-family:var(--mono);">${fmt(u)} units</span>
                <span style="font-size:11px;color:#fbbf24;font-family:var(--mono);margin-left:6px;font-weight:700;">${fmtGBP2(val)}</span>
              </div>
            </div>`).join('')}
          </div>`:``}

          <!-- Stats grid -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-bottom:${resolvedClaimsList.length>0?'8px':'0'};">
            ${[
              ['SKUs affected',fmt(affectedSkus),'#c084fc'],
              ['Suppliers',fmt(affectedSuppliers),'#60a5fa'],
              ['Units at risk',fmt(totalIssueUnits),'#f87171'],
              ['£ at risk',fmtGBP2(totalAtRisk),'#fbbf24'],
            ].map(([l,v,col])=>`<div style="padding:4px 0;">
              <div style="font-size:10px;color:#c3cde0;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:1px;">${l}</div>
              <div style="font-size:13px;font-weight:900;font-family:var(--mono);color:${col};">${v}</div>
            </div>`).join('')}
          </div>

          <!-- Resolved -->
          ${resolvedClaimsList.length>0?`
          <div style="padding-top:8px;border-top:1px solid rgba(255,255,255,.08);">
            <div style="font-size:10px;font-weight:800;color:#4ade80;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px;">✓ Resolved</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;">
              ${[
                ['Claims closed',fmt(resolvedClaimsList.length),'#4ade80'],
                ['Suppliers resolved',fmt(resolvedSuppliers),'#60a5fa'],
                ['£ reimbursed',fmtGBP2(resolvedReimbursedVal),'#34d399'],
                ['£ still owed',fmtGBP2(resolvedOwedVal),resolvedOwedVal>0?'#f87171':'#64748b'],
              ].map(([l,v,col])=>`<div style="padding:3px 0;">
                <div style="font-size:10px;color:#9aa7ba;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:1px;">${l}</div>
                <div style="font-size:13px;font-weight:900;font-family:var(--mono);color:${col};">${v}</div>
              </div>`).join('')}
            </div>
          </div>`:``}
          `}
        </div>
        <div style="background:var(--bg2);border:1px solid ${stuckRows.length>0?'rgba(248,113,113,.35)':'var(--border)'};border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Stuck In Transit <span style="color:#f87171;">&gt;${TM.lateDays} days</span> <span style="font-weight:600;letter-spacing:.02em;text-transform:none;color:var(--text3);" title="Still owed, past the late clock, no delivery date ahead — the same rows the Prep Sheet's Late button shows">&middot; ${TM.ssLateDays} for S&amp;S</span></div>
          ${stuckRows.length?`
          <div style="display:flex;gap:16px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.07);justify-content:center;width:100%;">
            <div style="text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#f87171;">${fmt(stuckUnits)}</div><div style="font-size:10px;color:#b6c2d4;text-transform:uppercase;font-weight:600;">units at risk</div></div>
            <div style="text-align:center;"><div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${GOLD};">${fmtGBP2(stuckValue)}</div><div style="font-size:10px;color:#b6c2d4;text-transform:uppercase;font-weight:600;">value at risk</div></div>
          </div>
          <div style="max-height:320px;overflow-y:auto;">
            ${stuckRows.map(r=>{const[dd,mm]=(r.date||'').split('/');const yr=new Date().getFullYear();const d=new Date(`${yr}-${(mm||'01').padStart(2,'0')}-${(dd||'01').padStart(2,'0')}`);const days=Math.floor((new Date()-d)/864e5);const cog=parseSKU(r.sku).cogs*(r.exp||0);return`<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1px;">
                  <div style="font-size:11px;font-weight:600;color:#f87171;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:155px;" title="${r.prod||r.sku}">${r.prod||r.sku}</div>
                  <div style="font-size:11px;color:${GOLD};font-weight:800;flex-shrink:0;margin-left:4px;">${days}d</div>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <div style="font-size:10px;color:#9aa7ba;">${r.sup}</div>
                  <div style="font-size:10px;font-family:var(--mono);color:#b6c2d4;">${fmt(r.exp||0)} ${(r.exp||0)===1?'unit':'units'} · ${fmtGBP2(cog)}</div>
                </div>
              </div>`;}).join('')}
          </div>`:`<div style="color:${COL.today};font-size:11px;padding:4px 0;text-align:center;">✓ Nothing stuck</div>`}
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Active Inventory</div><div style="font-size:10px;color:#aeb9c9;margin:-3px 0 7px;">In-Transit + Delivered + In-Warehouse + Part-Sent</div>
          ${(()=>{
            /* Jack, 4 Sep KPI sweep: "Active Inventory" was counting ARCHIVED
               rows — 1,622 units instead of 950. Archived is by definition not
               active. Same omission as the in-transit tile. */
            const inTR=rows.filter(r=>['In-Transit','Delivered','In Warehouse','Part Sent'].includes(r.status)&&!r.archived);
            const inTU=inTR.reduce((a,r)=>a+(r.exp||0),0);
            const inTC=inTR.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.exp||0)),0);
            const issR=rows.filter(r=>r.status==='Issue'&&!r.archived);
            const issU=issR.reduce((a,r)=>a+(r.exp||0),0);
            const issC=issR.reduce((a,r)=>a+(parseSKU(r.sku).cogs*(r.exp||0)),0);
            const actA=new Set(inTR.map(r=>r.asin)).size;
            return[
              ['Active pipeline units',fmt(inTU),COL.transit],
              ['Active pipeline ASINs',fmt(actA),COL.asin],
              ['Active pipeline COG',fmtGBP2(inTC),GOLD],
              ['Issue Units',fmt(issU),issU>0?'#f87171':COL.today],
              ['Issue COG at Risk',fmtGBP2(issC),issU>0?'#f87171':GOLD],
              ['Open Actions',fmt(openClaims),openClaims>0?'#f87171':COL.today],
            ].map(([l,v,col])=>`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:11px;color:#b6c2d4;">${l}</span><span style="font-size:11px;font-weight:800;font-family:var(--mono);color:${col};">${v}</span></div>`).join('');
          })()}
        </div>
      </div>

      <!-- Col 3: what went out and what it cost — Prep Cost + Sent Mix + Pipeline + Stock -->
      <div style="display:flex;flex-direction:column;gap:8px;">
        <!-- Implied Prep Cost MTD -->
        <div style="background:var(--bg2);border:1px solid rgba(251,191,36,.25);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div onclick="openPrepHistory()" title="Click for the month-by-month prep cost history" style="cursor:pointer;font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;display:flex;justify-content:space-between;gap:8px;">
            <span>Implied Prep Cost — MTD</span><span style="color:var(--accent);font-weight:800;text-transform:none;letter-spacing:0;">history &#9656;</span></div>
          <div style="font-size:28px;font-weight:900;color:${GOLD};font-family:var(--num);font-variant-numeric:tabular-nums;line-height:1;">${fmtGBP2(prepCost.withVat)}</div>
          <div style="font-size:11px;color:#cbd5e1;margin-bottom:10px;">inc. VAT · ${fmtGBP2(prepCost.subtotal)} ex. VAT</div>

          <!-- Volume rate breakdown -->
          <div style="font-size:10px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Unit rate (volume-based, ex. VAT)</div>
          ${(()=>{
            const rateStr=prepCost.unitRate<1?(prepCost.unitRate*100).toFixed(0)+'p':fmtGBP2(prepCost.unitRate);
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                <span style="font-size:11px;color:#cbd5e1;">${fmt(prepCost.tieredUnits)} units so far × ${rateStr}/unit</span>
              <div style="font-size:10px;color:#aeb9c9;margin-top:3px;line-height:1.5;">${rateStr}/unit comes from pricing the month at <b style="color:#aeb9c9;">${fmt(smartExpectedUnits())}/mo</b> (${prepCost.unitRateBand} band) — ${smartExpectedInfo().src}. Even one unit on the 1st is priced at the volume you actually run; if the month overtakes it, the real figure wins.</div>
                <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:#fbbf24;">${fmtGBP2(prepCost.baseCost)}</span>
              </div>`;
          })()}

          <!-- Extras -->
          ${(prepCost.osCost>0||prepCost.bundleCost>0||prepCost.boxCostTotal>0||prepCost.dgExtra>0)?`
          <div style="font-size:10px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.08em;margin:8px 0 4px;">Extras (ex. VAT)</div>`:''}
          ${[
            ...(prepCost.osCost>0?[[prepCost.osUnits+' OS units × £'+prepFees.osCostPerUnit+'/unit',fmtGBP2(prepCost.osCost),'#fb923c']]:[]),
            ...(prepCost.bundleCost>0?[[prepCost.bundleUnits+' bundle units × £'+prepFees.bundleCostPerUnit+'/unit',fmtGBP2(prepCost.bundleCost),'#34d399']]:[]),
            [prepCost.stdBoxes+' std boxes × £'+prepFees.boxCost+'/box',fmtGBP2(prepCost.boxCostTotal),'#60a5fa'],
            ...(prepCost.dgExtra>0?[[prepCost.dgBoxes+' DG boxes × £'+prepFees.dgExtraPerBox+'/box (DG rate)',fmtGBP2(prepCost.dgExtra),'#f87171']]:[]),
          ].map(([l,v,col])=>`
            <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <span style="font-size:11px;color:#cbd5e1;">${l}</span>
              <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:${col};">${v}</span>
            </div>`).join('')}

          <!-- Subtotal + VAT + Total -->
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.1);">
            <div style="display:flex;justify-content:space-between;padding:2px 0;">
              <span style="font-size:11px;color:#b6c2d4;">Subtotal ex. VAT</span>
              <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:#b6c2d4;">${fmtGBP2(prepCost.subtotal)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.08);">
              <span style="font-size:11px;color:#b6c2d4;">VAT 20%</span>
              <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:#b6c2d4;">${fmtGBP2((prepCost.withVat-prepCost.subtotal))}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;margin-top:2px;">
              <span style="font-size:11px;font-weight:800;color:#fbbf24;">Total inc. VAT</span>
              <span style="font-size:14px;font-weight:900;font-family:var(--mono);color:#fbbf24;">${fmtGBP2(prepCost.withVat)}</span>
            </div>
          </div>

          ${(()=>{
            const activeDays=Object.keys(dayPrepCosts).length;
            const todayCost=dayPrepCosts[todayStr];
            if(!activeDays)return'';
            return`<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);">
              ${todayCost&&todayCost.totalUnits>0?`<div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="font-size:10px;color:#cbd5e1;">Today's cost inc. VAT</span><span style="font-size:11px;font-weight:800;font-family:var(--mono);color:#fbbf24;">${fmtGBP2(todayCost.withVat)}</span></div>`:''}
              <div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="font-size:10px;color:#cbd5e1;">Cost per prep day inc. VAT</span><span style="font-size:11px;font-weight:800;font-family:var(--mono);color:#fbbf24;">${fmtGBP2((prepCost.withVat/activeDays))}</span></div>
            </div>`;
          })()}
        </div>
        <!-- Sent Mix stacked bar (week / month) -->
        ${(()=>{
          const mix=_mixPeriod==='month'?mixMonth:mixWeek;
          const segs=[['Standard (stock)',mix.std,COL.sku],['DG (stock)',mix.dg,'#f87171'],['Oversize (stock)',mix.os,COL.box],['Lavarion',mix.lav,COL.asin]];
          const tot=mix.total||0;
          const tabBtn=(k,lbl)=>`<button onclick="setMixPeriod('${k}')" style="padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid ${_mixPeriod===k?'var(--accent)':'var(--border2)'};background:${_mixPeriod===k?'rgba(251,191,36,.15)':'var(--bg3)'};color:${_mixPeriod===k?'#fbbf24':'var(--text2)'};">${lbl}</button>`;
          const bar=tot>0?segs.filter(s=>s[1]>0).map(([l,u,col])=>{
            const pc=u/tot*100;
            return `<div title="${l}: ${fmt(u)} (${pc.toFixed(1)}%)" style="width:${pc}%;background:${col};display:flex;align-items:center;justify-content:center;">${pc>=10?`<span style="font-size:11px;font-weight:800;color:#000;">${Math.round(pc)}%</span>`:''}</div>`;
          }).join(''):`<div style="width:100%;display:flex;align-items:center;justify-content:center;color:#b6c2d4;font-size:11px;">No units sent ${_mixPeriod==='month'?'this month':'this week'}</div>`;
          const overlap=(mix.lavDG+mix.lavOS)>0?`<div style="font-size:10px;color:#b6c2d4;margin-top:8px;line-height:1.45;">Of ${fmt(mix.lav)} Lavarion units, ${mix.lavDG?fmt(mix.lavDG)+' are DG-typed':''}${mix.lavDG&&mix.lavOS?' and ':''}${mix.lavOS?fmt(mix.lavOS)+' oversize-typed':''} — kept under Lavarion, not double-counted in DG/Oversize.</div>`:'';
          return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">
              <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Sent Mix · ${tot>0?fmt(tot)+' units':'—'}</div>
              <div style="display:flex;gap:5px;">${tabBtn('week','Week')}${tabBtn('month','Month')}</div>
            </div>
            <div style="display:flex;height:28px;width:100%;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.05);">${bar}</div>
            <div style="font-size:11px;color:#aeb9c9;margin:10px 0 6px;line-height:1.55;">Standard / DG / Oversize are your <b style="color:#aeb9c9;">OA stock</b> shipments. Lavarion is shown separately — it also ships as standard, so it’s <b style="color:#aeb9c9;">not</b> counted in the Standard figure.</div>
            <div style="display:flex;flex-direction:column;gap:0;margin-top:5px;">
              ${segs.map(([l,u,col])=>{
                const pc=tot?(u/tot*100):0;
                return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                  <span style="width:9px;height:9px;border-radius:2px;background:${col};flex-shrink:0;"></span>
                  <span style="flex:1;font-size:12px;color:${col};font-weight:700;">${l}</span>
                  <span style="font-size:14px;font-family:var(--mono);font-weight:800;color:${col};">${fmt(u)} <span style="font-size:11px;color:#cbd5e1;font-weight:600;margin-left:2px;">${pc.toFixed(1)}%</span></span>
                </div>`;
              }).join('')}
            </div>
            ${overlap}
          </div>`;
        })()}
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Pipeline</div>
          ${(()=>{const st=[['In-Transit',transit.units,COL.transit],['Delivered',rows.filter(r=>r.status==='Delivered'&&!r.archived).reduce((a,r)=>a+(r.exp||0),0),COL.today],['In Warehouse',rows.filter(r=>r.status==='In Warehouse'&&!r.archived).reduce((a,r)=>a+(r.exp||0),0),COL.asin],['Part Sent',rows.filter(r=>r.status==='Part Sent'&&!r.archived).reduce((a,r)=>a+(r.exp||0),0),COL.box],['Issue',rows.filter(r=>r.status==='Issue'&&!r.archived).reduce((a,r)=>a+(r.exp||0),0),'#f87171']];
            const pmax=Math.max(...st.map(s=>s[1]),1);
            return st.map(([l,u,col])=>`
            <div style="padding:5px 0 6px;border-bottom:1px solid rgba(255,255,255,.05);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-size:11px;color:#c3cde0;font-weight:600;">${l}</span>
                <span style="font-size:12px;font-weight:800;font-family:var(--mono);color:${u>0?col:'#5a6b82'};">${u>0?fmt(u):'—'}</span>
              </div>
              <div style="height:4px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden;">${u>0?`<div style="width:${Math.max(3,u/pmax*100)}%;height:100%;background:${col};border-radius:3px;"></div>`:''}</div>
            </div>`).join('');})()}
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
          <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Stock vs Lavarion</div>
          ${(()=>{const stockU=Math.max(0,weekTotal.units-weekLav.units-(weekRet.units||0));const den=(stockU+weekLav.units)||1;const sPc=stockU/den*100,lPc=weekLav.units/den*100;
            return `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.06);margin-bottom:10px;">
              ${sPc>0?`<div title="Stock (OA) ${fmt(stockU)}" style="width:${sPc}%;background:${COL.sku};"></div>`:''}
              ${lPc>0?`<div title="Lavarion ${fmt(weekLav.units)}" style="width:${lPc}%;background:${COL.asin};"></div>`:''}
            </div>`
            +[['Stock (OA)',stockU,weekStock.value,COL.sku],['Lavarion',weekLav.units,weekLav.value,COL.asin],['Total',weekTotal.units,weekTotal.value,'#e6ecf5']].map(([l,u,v,col])=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <span style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:${col};font-weight:${l==='Total'?'800':'700'};">${l==='Total'?'':`<span style="width:8px;height:8px;border-radius:2px;background:${col};"></span>`}${l}</span>
              <span style="font-size:12px;font-family:var(--mono);font-weight:800;color:${col};">${fmt(u)} <span style="font-size:10.5px;color:${GOLD};">${fmtGBP2(v)}</span></span>
            </div>`).join('');})()}
        </div>
      </div>

    </div>

    ${lavProblemStrip()}

    <!-- Activity widget: added to prep portal (condensed, lower section) -->
    <div id="dashActivity"></div>

  </div>`;
  renderActivityWidget();
}
/* Low on the Dashboard on purpose. Stock that was paid for and is not here is
   worth knowing about every day and worth being shouted at about on none of
   them — so it sits under the day's work, not over it. The list itself, and
   every button that resolves anything, is on Sarah's Admin. */
function lavProblemStrip(){
  const list=_lavIssues(true);              // passive — never boots Lavarion for this
  if(!list||!list.length)return '';
  const short=list.reduce((t,g)=>t+g.short,0);
  const dmg=list.reduce((t,g)=>t+g.dmg,0);
  const val=list.reduce((t,g)=>t+g.val,0);
  const live=list.filter(g=>!g.quiet).length;
  const oldest=list.reduce((m,g)=>Math.max(m,g.age||0),0);
  const tile=(n,label,col,sub)=>`<div style="flex:1;min-width:104px;text-align:center;">
    <div style="font-size:22px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1;">${n}</div>
    <div style="font-size:10px;color:#b6c2d4;text-transform:uppercase;font-weight:700;letter-spacing:.05em;margin-top:4px;">${label}</div>
    ${sub?`<div style="font-size:10px;color:#8b98ab;margin-top:2px;">${sub}</div>`:''}</div>`;
  return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;
      padding:13px 16px;box-shadow:0 2px 10px rgba(0,0,0,.3);">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:11px;">
      <div style="font-size:10.5px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;">
        Lavarion — paid for, not here</div>
      <div style="font-size:11px;color:#8b98ab;">${list.length} supplier conversation${list.length===1?'':'s'}${oldest?` · oldest ${oldest} day${oldest===1?'':'s'}`:''}</div>
      <button onclick="document.querySelector('.sb-item[onclick*=&quot;admin&quot;]').click()"
        style="margin-left:auto;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;
        background:var(--bg3);border:1px solid var(--border2);color:var(--text2);">Sarah's Admin</button>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
      ${tile(fmt(short),'units short','#f87171',short?'never turned up':'')}
      ${tile(fmt(dmg),'damaged','#fbbf24',dmg?'held out of stock':'')}
      ${tile('£'+val.toFixed(2),'value','#fbbf24','')}
      ${tile(fmt(live),'need actioning',live?'#f87171':'#4ade80',live?'':'all actioned')}
    </div>
  </div>`;
}
