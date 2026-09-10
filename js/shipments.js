/* BDL PrepHub — js/shipments.js — Shipments page.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── SHIPMENTS ─────────────────────────────────────────────────────────────────
/* Typing a box count used to redraw the whole list, which closed the shipment
   you were working in and destroyed the field under your cursor. The count only
   changes two things on screen — the red no-boxes flag on this row and the
   totals in the bar — so both are patched in place and the list is left alone. */
function _boxTouched(shipId,val,el){
  try{
    if(el){
      el.style.borderColor=(+val>0)?'var(--border2)':'var(--red)';
      const grp=el.closest('.hgroup');
      if(grp){
        const flag=grp.querySelector('[title="No box count entered for this shipment"]');
        if(+val>0){
          grp.removeAttribute('style');
          if(flag)flag.remove();
        }else if(!flag){
          grp.style.cssText='border:1px solid var(--red);border-left:4px solid var(--red);background:rgba(248,113,113,.06);border-radius:8px;';
        }
      }
    }
  }catch(e){}
  /* Open rows and scroll position now survive a redraw, so refreshing the
     figures no longer costs you your place. */
  try{renderShipments();}catch(e){}
  try{renderNoBoxBanner();}catch(e){}
}
function renderShipments(){
  /* Same story as renderClaims: prep actions rebuilt this page invisibly. */
  if(document.hidden||!_pageActive('page-shipments'))return;
  const w=document.getElementById('shipList');
  const q=(document.getElementById('shipSrch')||{}).value?.toLowerCase()||'';
  const typeF=(document.getElementById('shipTypeF')||{}).value||'';
  const{s:dateFrom,e:dateTo}=getShipDateRange();

  // Group OA rows by shipment SEGMENT. A single SKU row can be split across
  // several FBA shipments (e.g. 8u → FBA1, 2u → FBA2); each segment is placed
  // under its own shipment so units are never merged under one ID.
  const shipMap={};
  rows.filter(r=>(r.sent==='Yes'||r.status==='Part Sent')&&normaliseSegments(r).length).forEach(r=>{
    normaliseSegments(r).forEach(seg=>{
      const sid=seg.shipId;if(!sid)return;
      const segDate=seg.date||r.sentDate||'';
      const segType=_shipTypeCache[sid]||seg.type||r.shipType||'Standard';
      if(!shipMap[sid])shipMap[sid]={id:sid,date:segDate,minDate:segDate,skus:[],lavSkus:[],retSkus:[],units:0,value:0,boxes:shipBoxes[sid]||0,type:segType,hasLav:false};
      // Per-segment view of the row so the table shows this shipment's units only.
      shipMap[sid].skus.push({...r,_segUnits:seg.units||0,shipId:sid});
      shipMap[sid].units+=(seg.units||0);
      shipMap[sid].value+=parseSKU(r.sku).cogs*(seg.units||0);
      /* EARLIEST, not latest. Taking the max meant one line still carrying
         today's date dragged the whole shipment forward — so correcting a
         27 July shipment appeared to work and then sprang back to today. */
      if(segDate&&(!shipMap[sid].date||segDate<shipMap[sid].date))shipMap[sid].date=segDate;
      if(segDate&&(!shipMap[sid].minDate||segDate<shipMap[sid].minDate))shipMap[sid].minDate=segDate;
      if(segDate&&(!shipMap[sid].maxDate||segDate>shipMap[sid].maxDate))shipMap[sid].maxDate=segDate;
      if(seg.type&&!_shipTypeCache[sid])shipMap[sid].type=seg.type;
    });
  });

  // Add Lavarion shipments
  lavShipments.forEach(ls=>{
    if(!ls.shipId)return;
    if(!shipMap[ls.shipId])shipMap[ls.shipId]={id:ls.shipId,date:ls.date||'',minDate:ls.date||'',skus:[],lavSkus:[],retSkus:[],units:0,value:0,boxes:shipBoxes[ls.shipId]||0,type:_shipTypeCache[ls.shipId]||'Standard',hasLav:true};
    shipMap[ls.shipId].lavSkus.push(ls);
    shipMap[ls.shipId].units+=(ls.units||0);
    shipMap[ls.shipId].value+=(ls.cost||0)*(ls.units||0);
    shipMap[ls.shipId].hasLav=true;
    if(ls.date&&(!shipMap[ls.shipId].date||ls.date<shipMap[ls.shipId].date))shipMap[ls.shipId].date=ls.date;
    if(ls.date&&(!shipMap[ls.shipId].minDate||ls.date<shipMap[ls.shipId].minDate))shipMap[ls.shipId].minDate=ls.date;
    if(ls.date&&(!shipMap[ls.shipId].maxDate||ls.date>shipMap[ls.shipId].maxDate))shipMap[ls.shipId].maxDate=ls.date;
  });

  // Add Return shipments
  returnShipments.forEach(rs=>{
    if(!rs.shipId)return;
    if(!shipMap[rs.shipId])shipMap[rs.shipId]={id:rs.shipId,date:rs.date||'',minDate:rs.date||'',skus:[],lavSkus:[],retSkus:[],units:0,value:0,boxes:shipBoxes[rs.shipId]||0,type:_shipTypeCache[rs.shipId]||'Standard',hasLav:false};
    if(!shipMap[rs.shipId].retSkus)shipMap[rs.shipId].retSkus=[];
    shipMap[rs.shipId].retSkus.push(rs);
    shipMap[rs.shipId].units+=(rs.units||0);
    /* The units went into the header figure but the money never did, so a
       returns-only shipment read "12 units · £0.00" and looked like a fault.
       Tracked separately: it stays out of the outbound COG (returns are stock
       coming BACK, not value sent) but the row can now say what it is. */
    shipMap[rs.shipId].retUnits=(shipMap[rs.shipId].retUnits||0)+(rs.units||0);
    shipMap[rs.shipId].retValue=(shipMap[rs.shipId].retValue||0)+((rs.cost||0)*(rs.units||0));
    // Return COG is intentionally NOT added to the shipment's outbound COG total
    // (returns are stock coming back, tracked for reference, not new value sent).
  });

  /* newest first — today at the top, not at the bottom of the month */
  let shipments=Object.values(shipMap).sort((a,b)=>String(b.date).localeCompare(String(a.date)));

  // Date filter — a shipment shows if its date span (earliest line .. latest
  // line) overlaps the selected range. Using overlap instead of the single
  // latest date means one stray line (e.g. a timezone-rollover date a day off)
  // can't push the whole shipment out of view.
  /* The date window always applies — but if a search finds nothing inside it,
     we check the other dates and say so rather than showing an empty page. */
  const _allDated=shipments.slice();
  let _shipElsewhere=0;   // matches outside the chosen dates — reported on the page, not in the strip
  if(dateFrom&&dateTo){
    shipments=shipments.filter(s=>{
      const lo=((s.minDate||s.date)||'').slice(0,10);
      const hi=(s.date||'').slice(0,10);
      if(!lo&&!hi)return false;
      const a=lo||hi, b=hi||lo;
      return a<=dateTo&&b>=dateFrom; // ranges overlap
    });
  }

  // Type filter
  if(typeF)shipments=shipments.filter(s=>s.type===typeF);

  // LAV only filter
  if(_shipLavOnly)shipments=shipments.filter(s=>s.hasLav);

  // Search
  const _match=s=>(
    s.id.toLowerCase().includes(q)||
    s.skus.some(r=>(r.sku+r.asin+r.prod+r.sup).toLowerCase().includes(q))||
    s.lavSkus.some(ls=>((ls.sku||'')+(ls.asin||'')+(ls.prod||'')).toLowerCase().includes(q))||
    (s.retSkus||[]).some(rs=>((rs.sku||'')+(rs.asin||'')+(rs.prod||'')).toLowerCase().includes(q))
  );
  const _dateEl=document.getElementById('shipDateNote');
  if(_dateEl){
    if(!q)_dateEl.innerHTML='';
    else{
      const inPeriod=shipments.filter(_match).length;
      const elsewhere=_allDated.filter(_match).length-inPeriod;
      /* This message used to live in the filter strip, where it did not fit —
         it overflowed the search box and got clipped, so the one thing you
         needed to read was the one thing you could not. Only the short hint
         stays here; the real message is rendered on the page, in the empty
         state, which is where you are already looking. */
      _shipElsewhere=(!inPeriod&&elsewhere)?elsewhere:0;
      _dateEl.innerHTML=(inPeriod&&elsewhere)?`<span style="color:var(--text3)">+${elsewhere} outside this period</span>`:'';
    }
  }
  if(q)shipments=shipments.filter(s=>
    s.id.toLowerCase().includes(q)||
    s.skus.some(r=>(r.sku+r.asin+r.prod+r.sup).toLowerCase().includes(q))||
    s.lavSkus.some(ls=>((ls.sku||'')+(ls.asin||'')+(ls.prod||'')).toLowerCase().includes(q))||
    (s.retSkus||[]).some(rs=>((rs.sku||'')+(rs.asin||'')+(rs.prod||'')).toLowerCase().includes(q))
  );

  // Badge
  

  /* The totals and the bar are built BEFORE the empty-period check, because
     that branch paints the bar too — a quiet morning is exactly when you want
     to see how the week and month are doing, and it is the default view now
     the page opens on Today. Defined after it, the call hit the temporal dead
     zone and threw. */
  const sumUnits=shipments.reduce((a,s)=>a+s.units,0);
  const sumCOG=shipments.reduce((a,s)=>a+s.value,0);
  const sumBoxes=shipments.reduce((a,s)=>a+s.boxes,0);
  // SKU lines and ASINs include OA + Lavarion + Returns so this bar matches the
  // dashboard / prep-sheet "Sent" rollups.
  const sumSkus=shipments.reduce((a,s)=>a+s.skus.length+s.lavSkus.length+(s.retSkus||[]).length,0);
  const sumAsins=new Set([
    ...shipments.flatMap(s=>s.skus.map(r=>r.asin)),
    ...shipments.flatMap(s=>s.lavSkus.map(l=>l.asin)),
    ...shipments.flatMap(s=>(s.retSkus||[]).map(r=>r.asin))
  ].filter(Boolean)).size;
  const sumPrep=shipments.reduce((a,s)=>{
    /* Jack, 19 Aug: "it should be what on average we are hitting — if we are
       always in the 40p band it should be calculated at 40 + vat".
       Called with no band volume, this priced each shipment on ITS OWN units;
       a shipment is almost never over 1,000, so every unit fell in the dearest
       band no matter what the month actually did. The Dashboard has always
       passed the Typical monthly volume from Settings — this page never did,
       which is also why the two disagreed. Same argument now, same answer. */
    const pc=calcImpliedPrepCost(s.skus,s.lavSkus,shipBoxes[s.id]?{[s.id]:shipBoxes[s.id]}:{},smartExpectedUnits());
    return a+pc.withVat;
  },0);

  /* ── THE BAR ───────────────────────────────────────────────────────────────
     Jack, 19 Aug: "i mainly look at them at a glance and see how the week, day
     and month are doing", and "don't drop any info". So all seven metrics stay
     and each answers day/week/month on its own — big figure for the period on
     screen, the other two beneath it, and a 14-day trend behind it.

     The first cut of this was wrong in a way worth writing down: the tiles
     reduced over the FILTERED shipments while the trend and the footers called
     sentRollup, which knows only about dates. Turn LAV Only on and the Units
     tile narrowed to Lavarion while the line and the footer under it still drew
     the whole business — one measure over three periods is what it looked like,
     two different populations is what it was. Everything below is computed from
     ONE pool: every shipment matching the type / LAV / search filters, at every
     date, so the only thing that varies between the four numbers is the period.
     `_allDated` is the pre-date-filter snapshot, which is exactly that pool
     once the same non-date filters are applied to it. */
  const _pool=_allDated.filter(s2=>
    (!typeF||s2.type===typeF)&&(!_shipLavOnly||s2.hasLav)&&(!q||_match(s2)));
  const _mBox=s2=>shipBoxes[s2.id]||0;
  const _mAsin=s2=>[...s2.skus.map(r=>r.asin),...s2.lavSkus.map(l=>l.asin),
                    ...(s2.retSkus||[]).map(r=>r.asin)].filter(Boolean);
  const _mSku=s2=>s2.skus.length+s2.lavSkus.length+(s2.retSkus||[]).length;
  const _tot=list=>({
    shipments:list.length,
    units:list.reduce((a,x)=>a+(x.units||0),0),
    value:list.reduce((a,x)=>a+(x.value||0),0),
    boxes:list.reduce((a,x)=>a+_mBox(x),0),
    skus:list.reduce((a,x)=>a+_mSku(x),0),
    asins:new Set(list.flatMap(_mAsin)).size,
    prep:list.reduce((a,x)=>{try{return a+calcImpliedPrepCost(x.skus,x.lavSkus,
      shipBoxes[x.id]?{[x.id]:shipBoxes[x.id]}:{},smartExpectedUnits()).withVat;}catch(e){return a;}},0),
  });
  const _isoOf=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const _inRange=(x,a,b)=>{const d=x.date||x.minDate||'';return d&&d>=a&&d<=b;};
  const _per=(function(){
    const t=todayISO();
    let ws=t,we=t,ms=t,me=t;
    /* getWeekRange() with no argument inherits the DASHBOARD's week offset —
       step Weekly Activity back and every "week …" figure here silently became
       last week's. Pinned to 0, and ended at today so it matches the page's own
       This Week filter exactly rather than running to Sunday. */
    try{const r=getWeekRange(0);ws=_isoOf(r.s);we=t;}catch(e){}
    try{const r=getMonthRange();ms=_isoOf(r.s);me=_isoOf(r.e);}catch(e){}
    return{today:_tot(_pool.filter(x=>_inRange(x,t,t))),
           week:_tot(_pool.filter(x=>_inRange(x,ws,we))),
           month:_tot(_pool.filter(x=>_inRange(x,ms,me)))};})();
  const _cur=(_shipDateFilter==='today')?'today':(_shipDateFilter==='week')?'week':(_shipDateFilter==='mtd')?'month':'';
  /* The sparkline is gone. Fourteen points in 72px is a squiggle, not a fact —
     and it answered a question ("what shape was the fortnight") nobody asked.
     What IS asked, every morning, is "how are today, the week and the month
     doing", so those three become the graphic: labelled, aligned in a row,
     with the period currently on screen picked out in the tile's own colour
     and the other two quiet. Same three numbers as before, readable. */
  /* £4,660.63 does not fit a third of a tile — it was ellipsing to "£4,66…".
     The small cells get a compact form; the big figure above stays exact. */
  const _cash=v=>v>=1000?('£'+(v/1000).toFixed(v>=10000?0:1)+'k'):fmtGBP2(v);
  const _sc=(label,val,col,key,fmtFn)=>{
    const cells=['today','week','month'].map(k=>{
      const v=(_per[k]||{})[key];
      if(v==null)return '';
      const on=(k===_cur);
      return `<div class="shipKpiC${on?' on':''}">
        <i>${k==='month'?'mth':k}</i>
        <b style="${on?'color:'+col:''}">${fmtFn?fmtFn(v):fmt(v)}</b></div>`;}).filter(Boolean).join('');
    return `<div class="shipKpi">
      <div class="shipKpiV" style="color:${col}">${val}</div>
      <div class="shipKpiL">${label}</div>
      ${cells?`<div class="shipKpiG">${cells}</div>`:''}
    </div>`;};
  /* Named so the empty-period branch can paint it too — it used to be built
     after that branch's return, so a quiet morning showed no bar at all. */
  const _paintShipBar=()=>{
    const el=document.getElementById('shipSummary');
    if(!el)return;
    const period=({today:'today',yesterday:'yesterday',week:'this week','7d':'last 7 days',
      mtd:'this month',ytd:'this year',all:'all time',custom:'the dates you picked'})[_shipDateFilter]||'this period';
    el.innerHTML=`<div class="shipBarP">Showing <b>${esc(period)}</b>${
        typeF?` · ${esc(typeF)} only`:''}${_shipLavOnly?' · Lavarion only':''}${q?` · matching “${esc(q)}”`:''}</div>
      <div class="shipBar">
      ${_sc('Shipments',fmt(shipments.length),'#60a5fa','shipments')}
      ${_sc('Units',fmt(sumUnits),'#4ade80','units')}
      ${_sc('SKU Lines',fmt(sumSkus),'#60a5fa','skus')}
      ${_sc('ASINs',fmt(sumAsins),'#c084fc','asins')}
      ${_sc('COG',fmtGBP2(sumCOG),'#fbbf24','value',_cash)}
      ${_sc('Boxes',fmt(sumBoxes),'#fb923c','boxes')}
      ${_sc('Prep Cost inc. VAT',fmtGBP2(sumPrep),'#fbbf24','prep',_cash)}
    </div>`;};
  if(!shipments.length){
    w.innerHTML=`<div class="empty"><div class="empty-ico"><svg viewBox="0 0 24 24" style="width:34px;height:34px;stroke:var(--text3);fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round"><path d="M21 8v8.2a1.6 1.6 0 0 1-.9 1.4l-7 3.2a1.6 1.6 0 0 1-1.3 0l-7-3.2a1.6 1.6 0 0 1-.9-1.4V8"/><path d="M3 7.3 12 3l9 4.3-9 4.2z"/><path d="M12 11.5V21"/></svg></div>
      ${_shipElsewhere
        ? `<div class="empty-t">Nothing for “${esc(q)}” in this period</div>
           <div style="font-size:13px;color:var(--text2);margin-top:7px;line-height:1.6">
             It was sent <b style="color:var(--amber)">${_shipElsewhere} time${_shipElsewhere===1?'':'s'}</b> outside the dates you have picked.</div>
           <button onclick="setShipDateFilter('all')"
             style="margin-top:13px;background:var(--btn-amber-bg);border:1px solid var(--btn-amber-border);color:var(--btn-amber-text);border-radius:7px;padding:8px 16px;font-size:13px;font-weight:800;cursor:pointer;">Show all dates</button>`
        : q
        ? `<div class="empty-t">Nothing matches “${esc(q)}”</div>
           <div style="font-size:13px;color:var(--text2);margin-top:7px;">No shipment on record has that ASIN, SKU or FBA ID.</div>`
        : `<div class="empty-t">No shipments found for this period</div>`}
    </div>`;
    /* The bar was built AFTER this return, so an empty period did not blank it
       — it never built it at all. That is the one moment you most want to see
       how the week and the month are doing, and it becomes the normal view now
       the page opens on Today. */
    _paintShipBar();
    return;
  }

  /* Searching an ASIN and being shown whole-shipment totals answers the wrong
     question. What you want is: this thing — when did it go and how many. The
     bar below still totals the shipments; this totals the SEARCH. */
  const _hd=d=>d?new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}):'—';
  let _hitStrip='';
  if(q){
    const hits=[];
    shipments.forEach(s=>{
      const add=(u,name,sku)=>{if(u>0)hits.push({date:s.minDate||s.date,ship:s.id,units:u,name,sku:sku||''});};
      s.skus.forEach(r=>{if(((r.sku||'')+(r.asin||'')+(r.prod||'')+(r.sup||'')).toLowerCase().includes(q))
        add(r._segUnits||r.ship||r.exp||0, r.prod||r.sku, r.sku);});
      s.lavSkus.forEach(l=>{if(((l.sku||'')+(l.asin||'')+(l.prod||'')).toLowerCase().includes(q))
        add(l.units||0, l.prod||l.sku, l.sku);});
      (s.retSkus||[]).forEach(r=>{if(((r.sku||'')+(r.asin||'')+(r.prod||'')).toLowerCase().includes(q))
        add(r.units||0, r.prod||r.sku, r.sku);});
    });
    if(hits.length){
      hits.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const tot=hits.reduce((a,h)=>a+h.units,0);
      const first=hits[0].date, last=hits[hits.length-1].date;
      const nm=[...new Set(hits.map(h=>h.name))][0]||q;
      _hitStrip=`<div class="hitStrip">
        <div class="hitHead">
          <div><b>${esc(String(nm).slice(0,60))}</b>
            <span>${fmt(tot)} unit${tot===1?'':'s'} across ${hits.length} shipment${hits.length===1?'':'s'}${
              first&&last?` · ${_hd(first)}${first!==last?' → '+_hd(last):''}`:''}</span></div>
          <div class="hitTot"><b>${fmt(tot)}</b><i>units sent</i></div>
        </div>
        <details>
          <summary style="cursor:pointer;list-style:none;font-size:11px;font-weight:800;color:var(--blu);padding:5px 0 2px;">&#9656; Show the ${hits.length} line${hits.length===1?'':'s'} — dates, shipments &amp; SKUs</summary>
          <div class="hitRows">${hits.map(h=>`<div class="hitRow">
            <span class="hd">${_hd(h.date)}</span>
            <span class="hs">${esc(h.ship)}</span>
            ${h.sku?`<span class="hs" style="opacity:.65;overflow:hidden;text-overflow:ellipsis;" title="${esc(h.sku)}">${esc(h.sku)}</span>`:''}
            <span class="hu">${fmt(h.units)}</span></div>`).join('')}</div>
        </details>
      </div>`;
    }
  }

  // ── SUMMARY BAR ──────────────────────────────────────────────────────────────
  /* Rows saved as sent with units but a blank Ship ID have no segment, so this
     page never ingests them — while the totals above DO count them, because
     they carry their own date. The list and the bar disagreed and nothing said
     why. Named here, with a way through to them. */
  const _ghosts=(function(){
    try{
      const{s:ds,e:de}=getShipDateRange();
      return (rows||[]).filter(r=>
        (r.sent==='Yes'||r.status==='Sent to Amazon'||r.status==='Part Sent')&&
        (r.ship||0)>0 && !normaliseSegments(r).length &&
        (!ds||!de||(r.sentDate&&r.sentDate>=ds&&r.sentDate<=de)));
    }catch(e){return[];}
  })();
  const _ghostStrip=_ghosts.length?`<div style="margin-bottom:10px;padding:10px 13px;background:var(--bg2);
      border:1px solid var(--amb);border-left:3px solid var(--amb);border-radius:9px;
      font:600 12px var(--sans);color:var(--text2);">
      <b style="color:var(--amb)">${fmt(_ghosts.length)} sent row${_ghosts.length===1?'':'s'}
      (${fmt(_ghosts.reduce((a,r)=>a+(r.ship||0),0))} units) ${_ghosts.length===1?'has':'have'} no FBA shipment ID.</b>
      Counted in the totals above, but not listed below because there is no shipment to list them under.
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${_ghosts.slice(0,8).map(r=>
        `<span style="padding:2px 8px;border-radius:5px;background:var(--bg3);border:1px solid var(--border);
          font:600 11px var(--sans);color:var(--text2);">${esc(r.sku||r.prod||'(no sku)')} · ${fmt(r.ship||0)}u</span>`).join('')}
        ${_ghosts.length>8?`<span style="font:600 11px var(--sans);color:var(--text3);align-self:center">+${_ghosts.length-8} more</span>`:''}</div>
    </div>`:'';
  _paintShipBar();
  /* Which shipments were open, where the list was scrolled, and what had focus
     — all of it lived only as DOM state, and every save replaced the whole list.
     Open today's shipment, check the lines, type a box count: the row snapped
     shut under you and the field you were typing in was destroyed mid-keystroke. */
  const _openIds=new Set([...w.querySelectorAll('.hgroup.open')].map(el=>el.id));
  const _scrollTop=w.scrollTop;
  /* One unbounded map into a single innerHTML, with heavy inline style on every
     cell — around 9MB of HTML at 600 shipments before the browser parses any of
     it. Capped, with the number said out loud and a way to see the rest; a
     search always bypasses the cap so a hit strip reporting N matches shows N. */
  const _CAP=50;
  const _capped=(!q&&shipments.length>_CAP&&!_shipShowAll);
  const _hidden=_capped?shipments.length-_CAP:0;
  if(_capped)shipments=shipments.slice(0,_CAP);
  w.innerHTML=_hitStrip+_ghostStrip+shipments.map(s=>{
    const dateDisp=s.date?new Date(s.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
    const sfUrl=`https://app.sellerfuse.com/shipment-manager?search=${encodeURIComponent(s.id)}`;
    const skuCount=s.skus.length+(s.lavSkus||[]).length+(s.retSkus||[]).length;
    const safeId=s.id.replace(/[^a-z0-9]/gi,'_');
    const tc=s.type==='DG'?'var(--red)':s.type==='Oversize'?'var(--amber)':'var(--blue)';
    /* `background:${tc}22` emitted `var(--red)22`, which is not a colour, so
       BOTH the background and the border shorthand were invalid and painted
       nothing — the badge that flags dangerous goods rendered as plain text.
       The app already ships the tinted pair for exactly this. */
    const tbg=s.type==='DG'?'var(--red-bg)':s.type==='Oversize'?'var(--amber-bg)':'var(--blue-bg)';
    // Flag shipments with no box number entered — needs a box count before it's complete.
    const noBox=!s.boxes||s.boxes<=0;
    return`<div class="hgroup${_openIds.has('ship-'+safeId)?' open':''}" id="ship-${safeId}"${noBox?' style="border:1px solid var(--red);border-left:4px solid var(--red);background:rgba(248,113,113,.06);border-radius:8px;"':''}>
      <div class="hhead" onclick="this.parentElement.classList.toggle('open')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer;">
        <span class="hchev" style="font-size:20px;font-weight:900;line-height:1;">›</span>
        <span class="htitle" style="font-family:var(--mono);font-size:13px;font-weight:800;letter-spacing:.04em;display:inline-flex;align-items:center;gap:4px;">
          <span onclick="event.stopPropagation();copyShipId('${s.id}',this)" title="Click to copy this Shipment ID" style="color:var(--accent);cursor:copy;padding:1px 2px;border-radius:3px;">${s.id}</span>
          <span onclick="event.stopPropagation();copyShipId('${s.id}',this.previousElementSibling)" title="Copy Shipment ID" style="font-size:11px;opacity:.45;font-family:sans-serif;cursor:copy;">⎘</span>
        </span>
        ${noBox?`<span title="No box count entered for this shipment" style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:10px;background:rgba(248,113,113,.15);color:var(--red);border:1px solid var(--red);">⚠ NO BOXES</span>`:''}
        <span onclick="event.stopPropagation();openShipDate('${s.id.replace(/'/g,"\\'")}')"
          title="Click to correct the shipment date — this sets the date on every line in it"
          style="font-size:10px;color:var(--text3);cursor:pointer;border-bottom:1px dashed var(--border);padding-bottom:1px;">${dateDisp} <span style="opacity:.5">✎</span></span>
        <span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:10px;background:${tbg};color:${tc};border:1px solid ${tc};">${s.type||'Standard'}</span>
        ${s.hasLav?`<span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:10px;background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple);">LAV</span>`:''}
        ${s.retUnits?`<span title="${fmt(s.retUnits)} unit${s.retUnits===1?'':'s'} coming back on this shipment${s.retValue?` · ${fmtGBP2(s.retValue)} of stock`:''} — counted in the units above, deliberately not in the COG" style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:10px;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue);">RET</span>`:''}
        <span style="font-size:10px;color:var(--blue);font-weight:700;">${skuCount} SKU${skuCount!==1?'s':''}</span>
        <span style="font-size:10px;color:var(--green);font-weight:700;">${fmt(s.units)} units</span>
        <span style="font-size:10px;color:var(--amber);font-weight:700;">${fmtGBP2(s.value)}</span>

        <!-- Editable shipment type -->
        <select onclick="event.stopPropagation()" onchange="updateShipmentType('${s.id}',this.value);"
          style="padding:2px 6px;background:var(--bg2);border:1px solid var(--border);border-radius:3px;color:${tc};font-size:11px;font-weight:700;cursor:pointer;">
          <option value="Standard" ${s.type==='Standard'?'selected':''}>Standard</option>
          <option value="DG" ${s.type==='DG'?'selected':''}>DG</option>
          <option value="Oversize" ${s.type==='Oversize'?'selected':''}>Oversize</option>
        </select>
        <button onclick="event.stopPropagation();openLavShip('${s.id}')" style="padding:2px 8px;background:var(--btn-purple-bg);border:1px solid var(--btn-purple-border);color:var(--btn-purple-text);border-radius:3px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap;">+ Lavarion</button>
        <button onclick="event.stopPropagation();openRetShip('${s.id}')" style="padding:2px 8px;background:var(--btn-blue-bg);border:1px solid var(--btn-blue-border);color:var(--btn-blue-text);border-radius:3px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap;">+ Returns</button>
        <button onclick="event.stopPropagation();openEditShipment('${s.id.replace(/'/g,"\\'")}')" title="Rename this Shipment ID or remove it if added by mistake" style="padding:2px 8px;background:var(--btn-orange-bg);border:1px solid var(--btn-orange-border);color:var(--btn-orange-text);border-radius:3px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap;">✎ Edit / Delete</button>
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--text3);" onclick="event.stopPropagation()">
          📦
          <input type="number" min="0" value="${s.boxes||''}" placeholder="0"
            style="width:56px;padding:2px 6px;background:var(--bg);border:1px solid ${noBox?'var(--red)':'var(--border2)'};border-radius:3px;color:var(--text);font-size:11px;font-family:var(--mono);font-weight:700;outline:none;text-align:center;"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor=(+this.value>0)?'var(--border2)':'var(--red)'"
            onchange="shipBoxes['${s.id}']=+this.value;saveShipBoxes('${s.id}',+this.value);_boxTouched('${s.id}',+this.value,this);">
        </span>
        <a href="${sfUrl}" target="_blank" onclick="event.stopPropagation()" style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:var(--btn-sf-bg);color:var(--btn-sf-text);border:1px solid var(--btn-sf-border);border-radius:4px;font-size:10px;font-weight:700;font-family:var(--mono);text-decoration:none;white-space:nowrap;">SF ↗</a>
      </div>
      <div class="hbody">
        ${(()=>{
          const sc=calcImpliedPrepCost(
            s.skus,
            lavShipments.filter(ls=>ls.shipId===s.id),
            shipBoxes[s.id]?{[s.id]:shipBoxes[s.id]}:{},
            prepFees.expectedMonthlyUnits
          );
          if(!sc.totalUnits)return'';
          return`<div style="display:flex;gap:12px;align-items:center;padding:6px 10px;background:rgba(251,191,36,.06);border-bottom:1px solid rgba(251,191,36,.15);flex-wrap:wrap;">
            <div style="font-size:10px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;">Implied Prep Cost</div>
            <div style="font-family:var(--mono);font-size:13px;font-weight:900;color:#fbbf24;">${fmtGBP2(sc.withVat)} <span style="font-size:11px;font-weight:500;color:var(--text3);">inc. VAT</span></div>
            <div style="font-size:11px;color:var(--text3);">${fmtGBP2(sc.subtotal)} ex. VAT</div>
            <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;">
              ${[
                [sc.totalUnits+' units','#94a3b8'],
                ['Base £'+sc.baseCost.toFixed(2),'#fbbf24'],
                ...(sc.osCost>0?[['OS +£'+sc.osCost.toFixed(2),'#fb923c']]:[]),
                ...(sc.bundleCost>0?[['Bundle +£'+sc.bundleCost.toFixed(2),'#34d399']]:[]),
                ...(sc.boxCostTotal>0?[['Boxes £'+sc.boxCostTotal.toFixed(2),'#60a5fa']]:[]),
                ...(sc.dgExtra>0?[['DG +£'+sc.dgExtra.toFixed(2),'#f87171']]:[]),
              ].map(([l,c])=>`<span style="font-size:11px;color:${c};font-weight:600;">${l}</span>`).join('')}
            </div>
          </div>`;
        })()}
        <table style="min-width:unset;width:100%;">
          <thead style="position:static;"><tr>
            <th class="th-left">Product</th>
            <th>ASIN</th>
            <th class="th-left">SKU</th>
            <th>Supplier</th>
            <th>Units</th>
            <th>Cost/Unit</th>
            <th>Total COG</th>
            <th style="width:60px;"></th>
          </tr></thead>
          <tbody>
          ${s.skus.map(r=>{
            const cogs=parseSKU(r.sku).cogs;
            // _segUnits is this shipment's slice of the row; fall back to ship.
            const segUnits=(r._segUnits!=null)?r._segUnits:(r.ship||0);
            const rowVal=cogs*segUnits;
            // If this SKU is split across more than one shipment, note it.
            const splitNote=(Array.isArray(r.shipSegments)&&r.shipSegments.filter(x=>x&&x.shipId&&(x.units||0)>0).length>1)
              ?`<span style="font-size:10.5px;font-weight:700;padding:1px 5px;border-radius:8px;background:rgba(255,170,51,.15);color:var(--amber);border:1px solid rgba(255,170,51,.35);margin-left:5px;" title="This SKU is split across multiple shipments">SPLIT</span>`:'';
            return`<tr>
              <td class="td-left" style="font-size:11px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.prod}">${r.prod}${splitNote}</td>
              <td><span class="s-asin" onclick="copyVal('${r.asin}',this)" style="display:inline-flex;font-size:10px;">${r.asin}</span></td>
              <td class="td-left"><span class="s-sku" onclick="copyVal('${r.sku}',this)" style="display:inline-flex;font-size:10px;">${r.sku}</span>${vatTag(r.vat)}</td>
              <td style="font-size:11px;">${r.sup}</td>
              <td style="color:var(--green);font-family:var(--mono);font-weight:700;">${segUnits}</td>
              <td style="font-family:var(--mono);color:var(--text2);">${fmtGBP2(cogs)}</td>
              <td style="color:var(--amber);font-family:var(--mono);font-weight:700;">${fmtGBP2(rowVal)}</td>
              <td></td>
            </tr>`;
          }).join('')}
          ${(s.lavSkus||[]).map((ls,li)=>{
            const rowVal=(ls.cost||0)*(ls.units||0);
            const lavId=ls.uuid||li;
            // VAT comes from the Lavarion catalogue (source of truth); fall back
            // to anything stored on the line itself.
            const _lavCat=lavAsins.find(a=>a.asin===ls.asin||(ls.sku&&a.sku===ls.sku));
            const lavVat=_lavCat?_lavCat.vat:ls.vat;
            return`<tr style="background:rgba(204,153,255,.08);">
              <td class="td-left" style="font-size:11px;font-weight:500;">
                <span id="lav-prod-${lavId}">${ls.prod}</span>
                <span style="font-size:10.5px;padding:1px 5px;border-radius:8px;background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple);margin-left:4px;">LAV</span>
              </td>
              <td><span class="s-asin" onclick="copyVal('${ls.asin}',this)" style="display:inline-flex;font-size:10px;">${ls.asin}</span></td>
              <td class="td-left"><span class="s-sku" onclick="copyVal('${ls.sku}',this)" style="display:inline-flex;font-size:10px;">${ls.sku}</span>${vatTag(lavVat)}</td>
              <td style="font-size:11px;color:var(--text3);">Lavarion</td>
              <td style="color:var(--green);font-family:var(--mono);font-weight:700;">
                <span id="lav-units-disp-${lavId}">${ls.units||0}</span>
              </td>
              <td style="font-family:var(--mono);color:var(--text2);">
                <span id="lav-cog-disp-${lavId}">${fmtGBP2((ls.cost||0))}</span>
              </td>
              <td style="color:var(--amber);font-family:var(--mono);font-weight:700;">
                <span id="lav-total-disp-${lavId}">${fmtGBP2(rowVal)}</span>
              </td>
              <td>
                <button onclick="editLavShipLine('${lavId}')" style="padding:2px 6px;background:var(--btn-orange-bg);border:1px solid var(--btn-orange-border);color:var(--btn-orange-text);border-radius:3px;font-size:11px;cursor:pointer;">Edit</button>
                <button onclick="delLavShipLine('${lavId}')" title="Remove this Lavarion ASIN from this shipment" style="padding:2px 6px;background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:3px;font-size:11px;cursor:pointer;margin-left:3px;">✕</button>
              </td>
            </tr>`;
          }).join('')}
          ${(s.retSkus||[]).map(rs=>`<tr style="background:rgba(96,165,250,.06);">
              <td class="td-left" style="font-size:11px;font-weight:500;">${retProdDesc(rs)} <span style="font-size:10.5px;padding:1px 5px;border-radius:8px;background:rgba(96,165,250,.15);color:#60a5fa;border:1px solid rgba(96,165,250,.3);margin-left:4px;">RETURN</span></td>
              <td><span onclick="copyVal('${rs.asin||''}',this)" style="display:inline-flex;font-size:10px;">${rs.asin||'—'}</span></td>
              <td class="td-left"><span onclick="copyVal('${rs.sku}',this)" style="display:inline-flex;font-size:10px;">${rs.sku}</span></td>
              <td style="font-size:11px;color:var(--text3);">Return</td>
              <td style="color:#60a5fa;font-family:var(--mono);font-weight:700;">${rs.units||0}</td>
              <td style="font-family:var(--mono);color:var(--text2);">${fmtGBP2(rs.cost||0)}</td>
              <td style="color:var(--amber);font-family:var(--mono);font-weight:700;">${fmtGBP2((rs.cost||0)*(rs.units||0))}</td>
              <td>
                <button onclick="editRetShipLine('${rs.uuid}')" style="padding:2px 6px;background:var(--btn-orange-bg);border:1px solid var(--btn-orange-border);color:var(--btn-orange-text);border-radius:3px;font-size:11px;cursor:pointer;">Edit</button>
                <button onclick="deleteRetShipLine('${rs.uuid}')" title="Remove this return from this shipment" style="padding:2px 6px;background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:3px;font-size:11px;cursor:pointer;margin-left:3px;">✕</button>
              </td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr style="border-top:2px solid var(--accent);">
            <td colspan="4" class="td-left" style="font-size:11px;font-weight:700;color:var(--text2);padding:8px 14px;">TOTAL</td>
            <td style="color:var(--green);font-family:var(--mono);font-weight:900;">${fmt(s.units)}</td>
            <td></td>
            <td style="color:var(--amber);font-family:var(--mono);font-weight:900;">${fmtGBP2(s.value)}</td>
            <td style="color:var(--purple);font-family:var(--mono);font-weight:900;">${s.boxes?s.boxes+' box'+(s.boxes!==1?'es':''):'—'}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;
  }).join('');
  /* put the reader back where they were — a redraw that jumps you to the top of
     eighteen days of history is its own small bug */
  if(_hidden)w.innerHTML+=`<div style="padding:14px;text-align:center">
    <button onclick="_shipShowAll=true;renderShipments();"
      style="padding:9px 18px;background:var(--bg3);border:1px solid var(--border2);border-radius:9px;
      color:var(--text2);font:700 12px var(--sans);cursor:pointer;">Show all ${fmt(_hidden+_CAP)} shipments</button>
    <div style="font:600 11px var(--sans);color:var(--text3);margin-top:6px">${fmt(_hidden)} older shipment${_hidden===1?'':'s'} not shown</div></div>`;
  try{if(_scrollTop)w.scrollTop=_scrollTop;}catch(e){}
}
