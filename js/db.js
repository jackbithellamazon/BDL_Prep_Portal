/* BDL PrepHub — js/db.js — Supabase: DB helpers, two-phase boot, row converters, save helpers, realtime, catch-up.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── DB HELPERS ────────────────────────────────────────────────────────────────
/* PostgREST silently caps an unranged select at 1000 rows. prep_rows is at
   ~974 and rising — the day it crosses 1000, every boot would quietly load an
   incomplete sheet and the app would look normal while missing the oldest
   rows. Page through in 1000s until a short page says we have everything. */
/* ── TWO-PHASE BOOT (v27.0) ────────────────────────────────────────────────
   The browser used to download the entire table — active AND archived — before
   painting anything. Boot time therefore grew with the archive, forever. Now:
   Phase A loads only what the prep team works on (active rows) plus every side
   table, paints immediately, and Phase B streams the archive in behind. Until
   the archive has fully landed, _historyReady is false and:
   - destructive full-history actions are gated (histGate) with a polite toast,
   - the sheet sync queues itself instead of running half-blind,
   - realtime events for rows not in memory yet are buffered (_pendingRt) and
     replayed at finalize, so nothing another laptop does in the gap is lost.
   localStorage ph_boot_mode='legacy' boots the old single-phase path. */
let _historyReady=false;
/* Jack, 6 Sep: "when it's syncing it moves stuff down and then back up."
   Sync Now re-runs dbLoad: Phase A swaps `rows` for the ACTIVE ones and paints
   at once, Phase B streams the archive back in over the next few seconds. The
   stats strip above the Prep Sheet painted in that gap with most of the sent
   rows missing, so its subtitles shortened, a tile un-wrapped, the strip lost a
   line and the whole table jumped — then jumped back when the archive landed.
   While the archive is streaming the strip keeps the last complete picture. */
let _histStreaming=false;
let _pendingRt=[];       // realtime events for rows not yet merged
let _pendingEan=[];      // EAN lookups deferred until history lands (no Keepa waste)
let _syncQueued=false;   // a sync requested mid-gap fires at finalize
let _totalRowCount=0;    // server head-count taken at boot
const _sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* Keyset pager. .range() paging breaks under concurrent writes: a row archived
   mid-walk shifts every offset after it, so one row appears twice and another
   never appears at all. A keyset cursor (created_at,id) never shifts.
   RULE for every consumer: reference the global `rows` binding inline
   (rows.push / rows.some) — never a captured alias — so an in-place splice by
   a realtime DELETE is always visible mid-loop. */
async function _fetchRowsWhere(table,applyFilter,idOnly){
  const out=[];const STEP=1000;let cur=null;
  for(;;){
    let q=sb.from(table).select('*');
    if(!idOnly)q=q.order('created_at',{ascending:true});
    q=q.order('id',{ascending:true}).limit(STEP);
    if(applyFilter)q=applyFilter(q);
    if(cur)q=idOnly?q.gt('id',cur.id)
                   :q.or(`created_at.gt.${cur.ca},and(created_at.eq.${cur.ca},id.gt.${cur.id})`);
    const r=await q;
    if(r.error)return r;
    out.push(...(r.data||[]));
    if((r.data||[]).length<STEP)break;
    const last=r.data[r.data.length-1];
    cur={ca:last.created_at,id:last.id};
  }
  return{data:out,error:null};
}
async function _fetchAllRows(table,orderCol,asc){
  const out=[];let from=0;const STEP=1000;
  for(;;){
    /* A tiebreaker is not optional once a table passes one page. Rows saved in
       one batch share a created_at to the microsecond, and Postgres gives no
       fixed order among equal keys — so the row that sat at position 999 on
       page one can come back again on page two while a different row is never
       returned at all. A row missing from memory reads as "not on the prep
       sheet yet" and gets imported a second time: the duplicate bug through a
       different door. prep_rows passed 1,000 rows (297 active + 743 archived)
       this month, so this boundary is live. `id` is unique, so ties resolve. */
    const r=await sb.from(table).select('*').order(orderCol,{ascending:asc}).order('id',{ascending:true}).range(from,from+STEP-1);
    if(r.error)return r;                       // caller keeps its error handling
    out.push(...(r.data||[]));
    if((r.data||[]).length<STEP)break;
    from+=STEP;
  }
  return{data:out,error:null};
}
async function dbLoad(){
  /* once, shortly after the first load: does the table have every column this build writes? */
  if(!window._colChecked){window._colChecked=1;setTimeout(()=>{try{checkColumnsAtBoot();}catch(e){}},4000);}
  setSyncStatus('syncing');
  const LEGACY=(function(){try{return localStorage.getItem('ph_boot_mode')==='legacy';}catch(e){return false;}})();
  try{
    /* Phase A. Actives only (null-inclusive: the column is boolean DEFAULT
       false with no NOT NULL, so a null must count as active). maxId comes
       from the SERVER, not from the loaded slice — the highest local_id lives
       on an archived row, and seeding nid from actives alone would mint
       colliding ids for the whole session. Every side table goes through the
       keyset pager: the old bare .select('*') silently capped each of them at
       PostgREST's 1,000-row default — ship_boxes would have crossed it first
       and box counts would simply have gone missing with nothing on screen. */
    const [rowsRes,maxIdRes,countRes,claimsRes,lavAsinRes,lavShipRes,boxesRes]=await Promise.all([
      LEGACY?_fetchAllRows('prep_rows','created_at',true)
            :_fetchRowsWhere('prep_rows',q=>q.or('archived.is.null,archived.eq.false')),
      sb.from('prep_rows').select('local_id').order('local_id',{ascending:false,nullsFirst:false}).limit(1),
      sb.from('prep_rows').select('id',{count:'exact',head:true}),
      _fetchRowsWhere('actions'),
      _fetchRowsWhere('lavarion_asins'),
      _fetchRowsWhere('lavarion_shipments'),
      _fetchRowsWhere('ship_boxes',null,true),
    ]);
    if(rowsRes.error)throw rowsRes.error;
    /* nid mis-seeded is the phantom-row bug class — fail LOUDLY, never guess. */
    if(!LEGACY){
      if(maxIdRes.error)throw maxIdRes.error;
      if(countRes.error)throw countRes.error;
    }
    _totalRowCount=(countRes&&countRes.count)||0;
    rows=(rowsRes.data||[]).map(dbToRow);
    if(!LEGACY)_histStreaming=true;
    {
      const dbMax=parseInt(maxIdRes&&maxIdRes.data&&maxIdRes.data[0]&&maxIdRes.data[0].local_id)||0;
      const memMax=rows.reduce((m,r)=>{const n=parseInt(r.id);return(Number.isFinite(n)&&n>m)?n:m;},0);
      nid=Math.max(nid,dbMax,memMax);
    }
    /* The one-time bundle correction MOVED to finalize (_bundleFixOnce): it
       scans and saves rows, and running it against half the table would both
       miss archived rows and race Phase B's merge. Legacy boot runs it inline
       below, exactly where it used to live. */
    claims=(claimsRes.data||[]).map(dbToClaim).reverse();  // pager is asc; claims list expects newest first
    // Returns tables — load separately, graceful if not yet created in Supabase
    try{
      const [retSkuRes,retShipRes]=await Promise.all([
        _fetchRowsWhere('returns_skus'),
        _fetchRowsWhere('returns_shipments'),
      ]);
      returnSkus=(retSkuRes.data||[]).map(d=>({uuid:d.id,sku:d.sku||'',asin:d.asin||'',prod:d.product_name||'',cog:d.cog||0,units:d.units||1,notes:d.notes||''}));
      returnShipments=(retShipRes.data||[]).map(d=>({uuid:d.id,shipId:d.ship_id||'',sku:d.sku||'',prod:d.product_name||'',units:d.units||0,cost:d.cost||0,date:(d.date||'').slice(0,10)})).reverse();
    }catch(e){console.warn('Returns tables not yet created — run SQL to enable Returns tab');}
    shipBoxes={};
    (boxesRes.data||[]).forEach(b=>{shipBoxes[b.ship_id]=b.boxes;if(b.ship_type)_shipTypeCache[b.ship_id]=b.ship_type;});
    rows.forEach(r=>{if(r.shipId&&r.shipType&&r.shipType!=='Standard')if(!_shipTypeCache[r.shipId]||_shipTypeCache[r.shipId]==='Standard')_shipTypeCache[r.shipId]=r.shipType;});
    lavAsins=(lavAsinRes.data||[]).map(dbToLav);
    lavShipments=(lavShipRes.data||[]).map(dbToLavShip).reverse();
    setSyncStatus('synced');
    // Clear any previous error state
    renderPrep();renderDashboard();updateCB();
    /* the Lavarion page builds its product list from lavAsins — refresh it now the data is here */
    try{if(window.LV3&&LV3.rehydrate&&LV3.isReady&&LV3.isReady())LV3.rehydrate();}catch(e){}
    // Auto-clean any legacy return rows that still have " - name" stuck in the SKU.
    repairLegacyReturnSkus(true);
    if(LEGACY){
      /* the untouched old path: everything is already in memory */
      _bundleFixOnce();
      _historyReady=true;
      bootSheetSync();
    }else{
      bootSheetSyncPrep();   // row-independent setup only; syncing starts at finalize
      setTimeout(()=>{_loadHistory().then(ok=>{if(ok)return _finalizeHistory();}).catch(e=>{console.error('[boot] history phase:',e);_histFail();});},0);
    }
  }catch(err){
    _histStreaming=false;
    console.error('Load error:',err);
    // Only show offline if it's a real network error, not a schema issue
    const isNetworkErr=err.message&&(err.message.includes('fetch')||err.message.includes('network')||err.message.includes('Failed to fetch'));
    if(isNetworkErr){
      setSyncStatus('error');
      toast('Could not connect to database','er');
    } else {
      setSyncStatus('error');
      toast('Load error: '+err.message,'er');
    }
  }
}

// ── TWO-PHASE BOOT: PHASE B + FINALIZE ────────────────────────────────────────
/* Small floating pill under the header clock: history load progress. */
function _histPill(txt){
  let el=document.getElementById('histPill');
  if(!txt){if(el)el.remove();return;}
  if(!el){
    el=document.createElement('div');el.id='histPill';
    el.style.cssText='position:fixed;top:46px;right:18px;z-index:9990;background:var(--bg2,#1c1c1c);border:1px solid var(--line,#3a3a3a);color:var(--text3,#9aa);font:600 11px var(--sans,system-ui);padding:4px 11px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent=txt;
}
/* Loud, persistent failure. A quietly incomplete history is exactly the kind
   of silent wrongness this app keeps getting bitten by — never allowed. */
function _histFail(){
  _histStreaming=false;
  setSyncStatus('error');
  try{toast('Could not load full history — reload when connected','er');}catch(e){}
  _histPill(null);
  let el=document.getElementById('histFailBar');
  if(!el){
    el=document.createElement('div');el.id='histFailBar';
    el.style.cssText='position:fixed;top:46px;right:18px;z-index:9995;background:#2a0f0f;border:1px solid #ef4444;color:#fecaca;font:600 12px var(--sans,system-ui);padding:8px 12px;border-radius:9px;display:flex;gap:10px;align-items:center;';
    el.innerHTML='&#9888; Full history could not load &mdash; totals and shipments are incomplete. <button onclick="location.reload()" style="background:#ef4444;border:0;color:#fff;border-radius:6px;padding:4px 10px;font-weight:800;cursor:pointer;font-size:12px">Reload</button>';
    document.body.appendChild(el);
  }
}
/* Gate for actions that scan or export FULL history. Everything the prep team
   does to visible rows (receive, ship, archive, edit) is NOT gated — Phase A
   loaded those rows. */
function histGate(){
  if(!_historyReady){
    try{toast('Still loading full history — try again in a few seconds','er');}catch(e){}
    return true;
  }
  return false;
}
/* ── PHASE B: stream the archive in behind the painted page ── */
async function _loadHistory(){
  const STEP=1000;
  const estPages=Math.max(1,Math.ceil(Math.max(0,_totalRowCount-rows.length)/STEP));
  let cur=null,page=0,attempt=0;
  const surfaceVisible=()=>{try{
    const sp=document.getElementById('page-shipments');
    return (sp&&sp.classList.contains('active'))||_showArchived;
  }catch(e){return false;}};
  for(;;){
    page++;
    _histPill('Loading history \u2014 page '+page+' of ~'+estPages);
    let q=sb.from('prep_rows').select('*').eq('archived',true)
      .order('created_at',{ascending:true}).order('id',{ascending:true}).limit(STEP);
    if(cur)q=q.or(`created_at.gt.${cur.ca},and(created_at.eq.${cur.ca},id.gt.${cur.id})`);
    const r=await q;
    if(r.error){
      attempt++;
      if(attempt>=5){_histFail();return false;}
      console.warn('[boot] history page failed (attempt '+attempt+'):',r.error.message);
      await _sleep(3000*Math.pow(2,attempt-1));
      page--;continue;
    }
    attempt=0;
    (r.data||[]).forEach(d=>{
      /* NEVER replace an existing object — it may carry _dirty or sit under an
         open editor. Merge is add-only; realtime owns updates. */
      if(!rows.some(x=>x.uuid===d.id)){
        const nr=dbToRow(d);
        rows.push(nr);
        if(nr.shipId&&nr.shipType&&nr.shipType!=='Standard'&&(!_shipTypeCache[nr.shipId]||_shipTypeCache[nr.shipId]==='Standard'))_shipTypeCache[nr.shipId]=nr.shipType;
      }
    });
    if(surfaceVisible()){try{rtRepaint();}catch(e){}}
    if((r.data||[]).length<STEP)break;
    const last=r.data[r.data.length-1];
    cur={ca:last.created_at,id:last.id};
  }
  return true;
}
/* The one-time bundle expected-units correction — verbatim from the old boot,
   now run at finalize when the WHOLE table is in memory. The signature test
   (exp === SKU-units × bundle-qty) makes it idempotent. */
function _bundleFixOnce(){
  const toFix=rows.filter(r=>{
    const bq=parseInt(r.bqty)||0;
    const su=parseSKU(r.sku).units||0;
    return String(r.bun).trim()==='Yes'&&bq>1&&su>0&&(parseInt(r.exp)||0)===su*bq;
  });
  if(toFix.length){
    toFix.forEach(r=>{
      const su=parseSKU(r.sku).units||0;
      logAudit('Bundle expected units corrected',`${r.sku}: ${r.exp} → ${su} (÷${r.bqty})`);
      r.exp=su;
      if((parseInt(r.rcvd)||0)===su*(parseInt(r.bqty)||1))r.rcvd=su;
      r._dirty=true;
    });
    setSyncStatus('syncing');
    Promise.all(toFix.map(r=>saveRow(r))).then(()=>setSyncStatus('synced')).catch(()=>setSyncStatus('error'));
    toast(`✓ Corrected ${toFix.length} bundle row${toFix.length!==1?'s':''} (Expected Units → saleable count)`);
  }
}
/* ── FINALIZE: runs once, after the last archive page ── */
async function _finalizeHistory(){
  /* (a) canonical order — the legacy boot delivered created_at asc. Stable
     sort; locally-created pre-echo rows (no _ca) sort last on purpose.
     Order is explicitly OUT of contract — every paint re-sorts anyway. */
  rows.sort((a,b)=>{
    const ka=(a._ca||'\uffff'), kb=(b._ca||'\uffff');
    if(ka<kb)return -1; if(ka>kb)return 1;
    const ua=(a.uuid||'\uffff'), ub=(b.uuid||'\uffff');
    return ua<ub?-1:ua>ub?1:0;
  });
  /* (b) nid can only ever rise */
  {
    const memMax=rows.reduce((m,r)=>{const n=parseInt(r.id);return(Number.isFinite(n)&&n>m)?n:m;},0);
    if(memMax>nid){console.warn('[boot] nid raised at finalize:',nid,'\u2192',memMax);nid=memMax;}
  }
  /* (c) bundle correction, whole table now present */
  try{_bundleFixOnce();}catch(e){console.warn('[boot] bundle fix:',e);}
  /* (d) replay buffered realtime events IN ARRIVAL ORDER. An UPDATE for a row
     we merged from an already-stale page must win over the page copy — apply
     it wholesale (no portal-field preservation: no local edit exists on a row
     that was absent when the event arrived), unless the row is mid-edit. */
  _pendingRt.forEach(pl=>{
    try{
      if(pl.eventType==='UPDATE'){
        const i=rows.findIndex(x=>x.uuid===pl.new.id);
        if(i>=0){if(!rows[i]._dirty)rows[i]=dbToRow(pl.new);}
        else rows.push(dbToRow(pl.new));
      }else if(pl.eventType==='DELETE'){
        const di=rows.findIndex(x=>x.uuid===pl.old.id);
        if(di>=0)rows.splice(di,1);
      }
    }catch(e){console.warn('[boot] replay:',e);}
  });
  _pendingRt=[];
  /* (e) integrity: fresh head-count vs what we hold. Transient churn gets one
     2s grace; a real gap is closed by an id-diff that fetches ONLY the missing
     rows. Never a silent shrug, never a full refetch. */
  try{
    const memCount=()=>rows.filter(x=>x.uuid).length;
    let c2=await sb.from('prep_rows').select('id',{count:'exact',head:true});
    if(!c2.error&&c2.count!==memCount()){
      await _sleep(2000);
      c2=await sb.from('prep_rows').select('id',{count:'exact',head:true});
      if(!c2.error&&c2.count!==memCount()){
        const srv=new Set();let cur=null;
        for(;;){
          let q=sb.from('prep_rows').select('id,created_at').order('created_at',{ascending:true}).order('id',{ascending:true}).limit(1000);
          if(cur)q=q.or(`created_at.gt.${cur.ca},and(created_at.eq.${cur.ca},id.gt.${cur.id})`);
          const r=await q;if(r.error)break;
          (r.data||[]).forEach(d=>srv.add(d.id));
          if((r.data||[]).length<1000)break;
          const last=r.data[r.data.length-1];cur={ca:last.created_at,id:last.id};
        }
        const have=new Set(rows.map(x=>x.uuid).filter(Boolean));
        const missing=[...srv].filter(id=>!have.has(id));
        const extras=[...have].filter(id=>!srv.has(id));
        if(extras.length)console.warn('[boot] finalize: '+extras.length+' in-memory row(s) no longer on the server (deleted remotely):',extras.slice(0,5));
        for(let o=0;o<missing.length;o+=100){
          const r=await sb.from('prep_rows').select('*').in('id',missing.slice(o,o+100));
          if(!r.error)(r.data||[]).forEach(d=>{if(!rows.some(x=>x.uuid===d.id))rows.push(dbToRow(d));});
        }
        if(missing.length){console.warn('[boot] finalize: fetched '+missing.length+' missed row(s)');try{logAudit('Boot self-heal',missing.length+' row(s) fetched at finalize');}catch(e){}}
      }
    }
  }catch(e){console.warn('[boot] integrity check:',e);}
  /* (f) open the gates */
  _historyReady=true;
  _histStreaming=false;
  _histPill(null);
  /* (g) EAN lookups deferred in the gap — cache-first, so archived rows that
     just arrived answer them without a single Keepa call */
  const eanQ=_pendingEan.splice(0);
  eanQ.forEach(r=>{try{ensureRowEan(r);}catch(e){}});
  /* (h) NOW start syncing — schedule first, then any queued manual ask */
  try{bootSheetSyncStart();}catch(e){console.warn('[boot] sync start:',e);}
  if(_syncQueued){_syncQueued=false;try{runSheetSync(false);}catch(e){}}
  /* (i) one repaint with the full picture */
  try{rtRepaint();}catch(e){}
  try{if(!document.hidden&&_pageActive('page-prep'))renderStats();}catch(e){}
  try{updateArchivedBtn();}catch(e){}
  try{updateCB();}catch(e){}
}

// ── ROW CONVERTERS ────────────────────────────────────────────────────────────
function rowToDb(r){
  return{
    id:r.uuid||undefined,
    local_id:r.id,
    archived:r.archived===true,
    date_ddmm:r.date,
    order_id:r.oid||'',
    supplier:r.sup||'',
    account:r.acct||'',
    product_name:r.prod||'',
    asin:r.asin||'',
    sku:r.sku||'',
    ean:r.ean||'',
    dg:r.dg||'',
    vat:r.vat||'',
    sas_url:r.sas||'',
    expected_qty:r.exp||0,
    bundle:r.bun||'No',
    bundle_qty:r.bqty||'',
    sub_save:r.subSave||'No',
    status:r.status||'In-Transit',
    qty_received:r.rcvd||0,
    rcvd_at:r.rcvdAt||null,
    issue_type:r.issueType||'',
    issue_qty:r.issueQty||0,
    shipped_qty:r.ship||0,
    ship_id:r.shipId||'',
    all_ship_ids:JSON.stringify(r.allShipIds||[]),
    ship_segments:JSON.stringify(r.shipSegments||[]),
    ship_type:r.shipType||'Standard',
    sent:r.sent||'No',
    sent_date:r.sentDate||null,
    sent_at:r.sentAt||null,          // the exact time it went; sent_date is only the day
    reimburse:r.reimb||'No',
    priority:r.pri||'No',
    /* notesBy/notesAt were set when a note was typed but never written, so who
       wrote it and when survived only until the next refresh. saveRow drops
       columns the database does not have yet and says so once, so this is safe
       to send either way — but the SQL is in Settings → Database. */
    notes:r.notes||'',note_by:r.notesBy||'',note_at:r.notesAt||null,
    va_note:r.vaNote||'',va_note_by:r.vaNoteBy||'',va_note_at:r.vaNoteAt||null,
    transit_action:r.transitAction||'',
    expected_delivery:r.expectedDelivery||null,
    chase_snooze_until:r.chaseSnoozeUntil||null,
    imported_from:r.importedFrom||'',
    sheet_sync_id:r.sheetSyncId||null,
    sheet_row:r.sheetRow||null,
    /* The resolution workflow. `resolution` and `qty_fix` are jsonb on purpose:
       any new field inside them needs no further migration — the lesson from
       notesBy/notesAt, which were set in JS, had no column, and vanished. */
    cancelled_qty:parseInt(r.cancelledQty)||0,
    resolution:r.resolution||null,
    qty_fix:r.qtyFix||null,
    delivered:r.delivered||'',
    wrong_sku:r.wrongSku||'',
  };
}
function dbToRow(d){
  return{
    uuid:d.id,
    id:d.local_id||d.id,
    _ca:(d.created_at||''),  // full-precision timestamp; rowToDb never writes it back
    // Soft-archive flag. Archived rows are HIDDEN from the active prep sheet but
    // KEPT in the database and still shown on the shipments page + counted in
    // stats, so archiving never destroys shipment history. (Replaces the old
    // behaviour where "Archive" hard-deleted the row.)
    archived:d.archived===true||d.archived==='true',
    date:d.date_ddmm||'',
    oid:d.order_id||'',
    sup:d.supplier||'',
    acct:d.account||'',
    prod:d.product_name||'',
    asin:d.asin||'',
    sku:d.sku||'',
    ean:d.ean||'',
    dg:d.dg||'',
    vat:d.vat||'',
    sas:d.sas_url||`https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${d.asin||''}`,
    exp:d.expected_qty||0,
    aqty:d.expected_qty||0,
    bun:d.bundle||'No',
    bqty:d.bundle_qty||'',
    subSave:d.sub_save||'No',
    status:d.status||'In-Transit',
    rcvd:d.qty_received||0,
    rcvdAt:d.rcvd_at||null,
    issueType:d.issue_type||'',
    issueQty:d.issue_qty||0,
    ship:d.shipped_qty||0,
    shipId:d.ship_id||'',
    allShipIds:(()=>{try{const a=JSON.parse(d.all_ship_ids||'[]');return Array.isArray(a)?a:[];}catch(e){return [];}})(),
    // Per-shipment unit allocation. Source of truth for how a row's units are
    // split across multiple FBA shipments (e.g. 8u → FBA1, 2u → FBA2). Stored
    // as JSON in the ship_segments column. Falls back to [] when the column
    // doesn't exist yet or is empty — normaliseSegments() then rebuilds a single
    // segment from the legacy shipId/ship fields so old rows render unchanged.
    shipSegments:(()=>{try{const a=JSON.parse(d.ship_segments||'[]');return Array.isArray(a)?a:[];}catch(e){return [];}})(),
    shipType:d.ship_type||'Standard',
    sent:d.sent||'No',
    sentDate:d.sent_date||'',
    sentAt:d.sent_at||'',
    reimb:d.reimburse||'No',
    pri:d.priority||'No',
    notes:d.notes||'',
    notesBy:d.note_by||'',
    notesAt:d.note_at||'',
    vaNote:d.va_note||'',
    vaNoteBy:d.va_note_by||'',
    vaNoteAt:d.va_note_at||'',
    updatedAt:d.updated_at||'',
    transitAction:d.transit_action||'',
    expectedDelivery:d.expected_delivery||'',
    chaseSnoozeUntil:d.chase_snooze_until||'',
    importedFrom:d.imported_from||'',
    sheetSyncId:d.sheet_sync_id||'',
    sheetRow:d.sheet_row||'',
    cancelledQty:parseInt(d.cancelled_qty)||0,
    resolution:d.resolution||null,
    qtyFix:d.qty_fix||null,
    delivered:d.delivered||'',
    wrongSku:d.wrong_sku||'',
    createdISO:d.created_at?d.created_at.split('T')[0]:'',
  };
}
function claimToDb(c){
  return{
    id:c.uuid||undefined,
    local_id:c.id,
    prep_row_id:c.prepRowId||null,
    date_ddmm:c.date||'',
    raised_at:c.raisedAt||todayISO(),
    supplier:c.sup||'',
    order_id:c.oid||'',
    product_name:c.prod||'',
    sku:c.sku||'',
    asin:c.asin||'',
    issue_type:c.issT||'',
    expected_qty:c.exp||0,
    received_qty:c.rec||0,
    difference:c.dif||0,
    cost_per_unit:c.cost||0,
    claim_value:c.claimValue||0,
    status:c.cst||'Open',
    notes:c.notes||'',
    account:c.acct||'',
    va_note:c.vaNote||'',
    jack_note:c.jackNote||'',
    reimbursed:c.reimbursed||'No',
    reimburse_note:c.reimburseNote||'',
    archived:!!c.archived,
    // Envelope carries the log entries PLUS follow-up fields (next action, due
    // date, last-chase date) — piggybacked in this JSON column so no database
    // migration is needed. Old rows are plain arrays; both shapes are read.
    contact_log:JSON.stringify({e:c.log||[],na:c.nextAction||'',nd:c.nextDue||'',lc:c.lastChase||'',ow:c.owner||'',dc:c.gatedDecision||'',sj:c.sentToJack||'',rb:c.raisedBy||'',dl:c.discordLink||''}),
  };
}
function dbToClaim(d){
  let log=[],na='',nd='',lc='',ow='',dc='',sj='',rb='',dl='';
  try{
    const parsed=JSON.parse(d.contact_log||'[]');
    if(Array.isArray(parsed))log=parsed;
    else if(parsed&&typeof parsed==='object'){log=parsed.e||[];na=parsed.na||'';nd=parsed.nd||'';lc=parsed.lc||'';ow=parsed.ow||'';dc=parsed.dc||'';sj=parsed.sj||'';rb=parsed.rb||'';dl=parsed.dl||'';}
  }catch(e){}
  // Map old statuses to new ones
  const statusMap={'In Progress':'Chasing','Refunded':'Resolved','Closed':'Resolved','Refund Required':'Chasing','Issue':'Needs Attention'};
  const rawStatus=d.status||'Open';
  const mappedStatus=statusMap[rawStatus]||rawStatus;
  return{
    uuid:d.id,id:d.local_id||d.id,prepRowId:d.prep_row_id,
    date:d.date_ddmm||'',raisedAt:d.raised_at||'',
    sup:d.supplier||'',oid:d.order_id||'',prod:d.product_name||'',
    sku:d.sku||'',asin:d.asin||'',issT:d.issue_type||'',
    exp:d.expected_qty||0,rec:d.received_qty||0,dif:d.difference||0,
    cost:d.cost_per_unit||0,claimValue:d.claim_value||0,
    cst:mappedStatus,notes:d.notes||'',acct:d.account||'',
    vaNote:d.va_note||'',jackNote:d.jack_note||'',
    reimbursed:d.reimbursed||'No',reimburseNote:d.reimburse_note||'',
    archived:!!d.archived,log,nextAction:na,nextDue:nd,lastChase:lc,
    /* Jack, 17 Aug: "if something is GATED, that's initially Sarah's job to
       deal with… if she needs Jack she presses SEND TO JACK." So nothing
       defaults to him any more — every issue starts with the VA and only moves
       when it is sent. */
    owner:ow||'VA',
    gatedDecision:dc,sentToJack:sj||null,raisedBy:rb||'',discordLink:dl||'',
  };
}
function dbToLav(d){
  return{uuid:d.id,id:d.id,asin:d.asin||'',sku:d.sku||'',prod:d.product_name||'',cost:d.cost||0,total:d.total_stock||0,dg:d.dg||'No',vat:(d.vat!=null&&d.vat!=='')?String(d.vat):'20',notes:d.notes||'',
    /* bundle vs private label — written but never read back, so type edits looked like they didn't save */
    ptype:d.product_type||'bundle',
    archived:!!d.archived};
}
function dbToLavShip(d){
  return{uuid:d.id,shipId:d.ship_id||'',asin:d.asin||'',sku:d.sku||'',prod:d.product_name||'',units:d.units||0,cost:d.cost||0,date:d.sent_date||''};
}

// ── SAVE HELPERS ──────────────────────────────────────────────────────────────
// Optional columns that may not exist in the Supabase schema yet. If a write
// fails because one is missing, we flag it, strip it, and retry — so the app
// keeps working before the user runs the migration SQL (Settings → Database).
const _missingCols=new Set();
let _missingColWarned=false;
/* saveRow returns false for every kind of failure, which leaves callers unable
   to tell "the database refused a duplicate" (fine, expected, nothing to do)
   from "the save genuinely did not happen" (needs saying out loud). The last
   error is parked here so the sync add path can tell the difference. */
let _lastSaveErr=null;
/* A column the database does not have yet is dropped from the write and the
   save then "succeeds" — which is right, it keeps the app working. What was
   wrong is that it said so ONCE, in a toast that fades in three seconds, and
   then quietly kept dropping that field for the rest of the session. That is
   the shape of every data-loss bug in this app: it still works, and nobody is
   told what stopped being saved. So it now stays on screen until it is fixed,
   names the fields, and hands over the SQL. */
/* A warning that covers the horizontal scrollbar has replaced one problem with
   another. It sits ABOVE the bottom edge, not on it, and folds down to a small
   tab that stays visible — so it can never be dismissed and forgotten, but it
   also never sits on top of something you need to use. */
let _missColMin=false;
function _missingColFold(){_missColMin=!_missColMin;_paintMissingCols();}
/* Jack, 10 Sep: "features that need a database column fail silently". Ask the
   table what columns it has BEFORE any save fails, and paint the same red bar. */
async function checkColumnsAtBoot(){
  try{
    const {data,error}=await sb.from('prep_rows').select('*').limit(1);
    if(error||!data||!data.length)return;
    const have=new Set(Object.keys(data[0]));
    const sample=(typeof rows!=='undefined'&&rows[0])||{};
    const want=Object.keys(rowToDb(sample)||{});
    let n=0;want.forEach(c=>{if(!have.has(c)){_missingCols.add(c);n++;}});
    if(n){_paintMissingCols();console.warn('[PrepHub] prep_rows is missing '+n+' column(s):',[...(_missingCols)].join(', '));}
  }catch(e){}
}
function _paintMissingCols(){
  let el=document.getElementById('missingColBar');
  if(!_missingCols.size){if(el)el.remove();return;}
  if(!el){
    el=document.createElement('div');
    el.id='missingColBar';
    document.body.appendChild(el);
  }
  const cols=[...(_missingCols)];
  const sql=cols.map(c=>`ALTER TABLE prep_rows ADD COLUMN IF NOT EXISTS ${c} text DEFAULT '';`).join('\n');
  const base='position:fixed;right:16px;z-index:9998;background:#2a0f0f;border:1px solid #ef4444;'
    +'font:600 12.5px var(--sans,system-ui);color:#fecaca;box-shadow:0 10px 26px rgba(0,0,0,.6);';
  if(_missColMin){
    /* folded: a small tab clear of the scrollbar, still impossible to miss */
    el.style.cssText=base+'bottom:34px;border-radius:8px;padding:7px 12px;display:flex;gap:9px;align-items:center;cursor:pointer;';
    el.title='Show what is not being saved';
    el.onclick=()=>_missingColFold();
    el.innerHTML=`<span style="font-size:14px">&#9888;</span>
      <span><b style="color:#fff">${cols.length}</b> field${cols.length===1?'':'s'} not saving</span>`;
    return;
  }
  el.style.cssText=base+'left:16px;bottom:34px;border-radius:9px;padding:11px 15px;display:flex;gap:13px;align-items:center;';
  el.onclick=null; el.title='';
  el.innerHTML=`<span style="font-size:17px;flex:0 0 auto">&#9888;</span>
    <div style="flex:1;min-width:0;line-height:1.5">
      <b style="color:#fff">${cols.length} field${cols.length===1?' is':'s are'} not being saved.</b>
      Everything else saves normally, but <b style="color:#fff">${cols.map(c=>esc(c)).join(', ')}</b>
      ${cols.length===1?'has':'have'} no column in the database yet — anything typed into
      ${cols.length===1?'it':'them'} is lost on refresh. Run the SQL in Settings → Database.
    </div>
    <button onclick="navigator.clipboard&&navigator.clipboard.writeText(${JSON.stringify(sql)});this.textContent='Copied'"
      style="flex:0 0 auto;background:#ef4444;border:0;color:#fff;border-radius:6px;padding:6px 13px;font-weight:800;cursor:pointer;font-size:12px">Copy the SQL</button>
    <button onclick="_missingColFold()" title="Fold it away — it stays as a small tab until the SQL is run"
      style="flex:0 0 auto;background:none;border:1px solid rgba(255,255,255,.25);color:#fecaca;border-radius:6px;padding:6px 11px;font-weight:700;cursor:pointer;font-size:12px">Fold away</button>`;
}
/* A UNIQUE constraint rejection — the database refusing a second copy of a row
   that already exists. This is a GOOD answer, not a fault, and it must never be
   confused with a schema problem. See the guard at the top of _missingColInErr:
   Postgres words a blocked duplicate as
     duplicate key value violates unique constraint "prep_rows_sheet_sync_id_key"
     Key (sheet_sync_id)=(SKU|ORDERID) already exists.
   The column name appears TWICE in that text, so the old substring scan below
   read it as "sheet_sync_id does not exist", stripped the fingerprint from the
   write and retried — and the retry SUCCEEDED, inserting the very duplicate the
   database had just refused, then stopped stamping fingerprints for the rest of
   the session. The unique index would have been silently disarmed the first
   time it ever did its job. */
function _isDupKeyErr(err){
  if(!err)return false;
  if(err.code==='23505')return true;
  const raw=((err.message||'')+' '+(err.details||'')+' '+(err.hint||'')).toLowerCase();
  return /duplicate key|violates unique constraint|already exists/.test(raw);
}
function _missingColInErr(err){
  if(!err)return null;
  if(_isDupKeyErr(err))return null;   // a refused duplicate is not a missing column
  const raw=(err.message||'')+' '+(err.details||'')+' '+(err.hint||'');
  // Supabase says: Could not find the 'COLUMN' column of 'TABLE' in the schema
  // cache. Parse the column name generically so ANY not-yet-migrated column
  // self-heals (drops from the write and retries) instead of flooding errors.
  const g=raw.match(/find the '([^']+)' column/i);
  if(g)return g[1];
  const m=raw.toLowerCase();
  /* The bare name scan is a last resort and it is indiscriminate — a column name
     mentioned anywhere in any error used to count. Require the error to actually
     be talking about schema before trusting it. */
  if(!/column|schema cache/.test(m))return null;
  for(const col of ['ship_segments','archived','vat','ean','sheet_sync_id','va_note','jack_note','reimbursed','reimburse_note','chase_snooze_until','cancelled_qty','resolution','qty_fix','delivered','wrong_sku']){if(m.includes(col))return col;}
  return null;
}
// Back-compat alias used elsewhere.
function _isMissingShipSegmentsErr(err){return _missingColInErr(err)==='ship_segments';}
async function saveRow(r){
  _lastSaveErr=null;
  /* Jack, 10 Sep: Starbucks — "has Becki said this has arrived? why is this at
     warehouse, how did that happen?" Nobody pressed anything: the status was
     switched to In Warehouse on the Prep Sheet, which fills Received to the
     order, and the "found it — all booked in" hook only listened to the
     Received cell. The agreed rule is that booking in clears the flag, so it
     runs on every save that leaves nothing owed. */
  /* v50.2: ALL the agreed rules, not just that one — see js/rules.js */
  try{const _rn=(typeof rowRules==='function')?rowRules(r,{source:'save'}):[];
    const _auto=_rn.filter(t=>!/^Amazon-says-delivered/.test(t));   /* R1 writes its own audit line */
    if(_auto.length)logAudit('Rules applied on save',`${r.sku||r.asin||''} — ${_auto.join(' · ')}`);
  }catch(e){}
  // ── Gated automation: if a row's issue type is Gated, the packing note must
  //    say so — auto-stamp it once so UK staff never type "gated" twice. This
  //    hook covers every save path (edit form, issue modal, sheet sync).
  if(r&&r.issueType==='Gated'&&!(r.notes||'').toLowerCase().includes('gated')){
    r.notes=r.notes?('Gated — '+r.notes):'Gated';
  }
  setSyncStatus('syncing');
  const buildData=()=>{
    const d=rowToDb(r);
    _missingCols.forEach(c=>delete d[c]);
    return d;
  };
  // Run a write; if it fails because an optional column doesn't exist yet, flag
  // that column and retry without it (retry up to twice for two missing cols).
  const runWrite=async(makeReq)=>{
    let out=await makeReq(buildData());
    let guard=0;
    while(out.error&&guard<3){
      const col=_missingColInErr(out.error);
      if(!col||_missingCols.has(col))break;
      _missingCols.add(col);
      if(!_missingColWarned){
        _missingColWarned=true;
        toast('A quick DB update is needed — see Settings → Database','er');
      }
      console.warn('[PrepHub] Missing column "'+col+'". Run the migration in Settings → Database.');
      try{_paintMissingCols();}catch(e){}   // and leave it on screen until it is dealt with
      out=await makeReq(buildData());
      guard++;
    }
    return out;
  };
  let res;
  if(r.uuid&&!r._minted){
    // Ask for the updated rows back so we can tell if it actually matched
    // anything. Supabase .update() does NOT error when it matches zero rows —
    // it silently succeeds — so a stale/missing uuid would "save" but write
    // nothing, and the value reverts on refresh. Verify the match count.
    res=await runWrite(data=>sb.from('prep_rows').update(data).eq('id',r.uuid).select());
    if(!res.error&&(!res.data||res.data.length===0)){
      // The uuid didn't match any DB row. Insert a fresh one and adopt its id
      // so future saves update correctly.
      console.warn('saveRow: uuid matched 0 rows, re-inserting',r.uuid,r.sku);
      const r2={...r,uuid:undefined};
      const ins=await runWrite(()=>{const d=rowToDb(r2);_missingCols.forEach(c=>delete d[c]);return sb.from('prep_rows').insert(d).select().single();});
      if(!ins.error&&ins.data)r.uuid=ins.data.id;
      res=ins;
    }
  }else{
    res=await runWrite(data=>sb.from('prep_rows').insert(data).select().single());
    if(res.data)r.uuid=res.data.id;
    if(!res.error)delete r._minted;
    else if(_isDupKeyErr(res.error)&&r._minted){
      /* Retrying an insert whose first attempt actually committed: the PK
         already exists because WE put it there. That is success. */
      delete r._minted;
      setTimeout(()=>{r._dirty=false;},1500);
      setSyncStatus('synced');return true;
    }
  }
  if(res.error){
    _lastSaveErr=res.error;
    console.error('Save row error:',res.error.message,res.error.details);
    r._dirty=false;
    /* The database refusing a second copy of a row that already exists is the
       system working, not breaking. Sarah must not get a red "Save failed"
       toast every two minutes because another laptop imported the line first.
       Reported quietly to the caller, which drops the phantom row instead. */
    if(_isDupKeyErr(res.error)){setSyncStatus('synced');return false;}
    setSyncStatus('error');
    toast('Save failed: '+res.error.message,'er');
    return false;
  }
  // Keep _dirty TRUE briefly so Supabase's realtime echo of THIS write
  // (which can arrive a few hundred ms after the update commits) doesn't
  // overwrite our fresh local value and snap the status back. Clear it on a
  // short delay instead of immediately. (Fixes status reverting after ~1s.)
  setTimeout(()=>{r._dirty=false;},1500);
  setSyncStatus('synced');return true;
}
async function deleteRow(r){
  if(!r.uuid)return;
  setSyncStatus('syncing');
  const res=await sb.from('prep_rows').delete().eq('id',r.uuid);
  if(res.error){setSyncStatus('error');return;}
  setSyncStatus('synced');
}
// Soft-archive: hide from the active prep sheet but KEEP the row in the database
// so its shipment history survives. This replaces the old behaviour where
// archiving hard-deleted the row (which wiped shipments off the Shipments page).
async function archiveRow(r){
  if(!r)return false;
  r.archived=true;r._dirty=true;
  return await saveRow(r);
}
async function unarchiveRow(r){
  if(!r)return false;
  r.archived=false;r._dirty=true;
  return await saveRow(r);
}
// Archive a single row from the prep sheet, with a one-tap Undo.
async function archiveRowUI(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  await archiveRow(r);
  renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();
  const label=(r.prod||r.sku||'Row').slice(0,28);
  toastUndo(`Archived ${label} — kept on Shipments`,async()=>{
    await unarchiveRow(r);
    renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();
    toast('Archive undone');
  });
}
async function saveClaim(c){
  /* the Prep Sheet's gated-off set is derived from claims — a claim that just
     changed must not be read from an 800ms-old cache (checks.js caught this) */
  try{if(typeof _gatedOffCache!=='undefined')_gatedOffCache={ids:null,at:0};}catch(e){}
  setSyncStatus('syncing');
  const buildData=()=>{const d=claimToDb(c);_missingCols.forEach(k=>delete d[k]);return d;};
  const runWrite=async(makeReq)=>{
    let out=await makeReq(buildData());let guard=0;
    while(out.error&&guard<4){
      const col=_missingColInErr(out.error);
      if(!col||_missingCols.has(col))break;
      _missingCols.add(col);
      if(!_missingColWarned){_missingColWarned=true;toast('A quick DB update is needed — see Settings → Database','er');}
      out=await makeReq(buildData());guard++;
    }
    return out;
  };
  let res;
  if(c.uuid){
    res=await runWrite(data=>sb.from('actions').update(data).eq('id',c.uuid));
  }else{
    res=await runWrite(data=>sb.from('actions').insert(data).select().single());
    if(res.data)c.uuid=res.data.id;
  }
  if(res.error){console.error('Save claim error:',res.error);setSyncStatus('error');return false;}
  setSyncStatus('synced');return true;
}
async function deleteClaim_db(c){
  if(!c.uuid)return;
  await sb.from('actions').delete().eq('id',c.uuid);
}
async function saveShipBoxes(shipId,boxes){
  await sb.from('ship_boxes').upsert({ship_id:shipId,boxes,ship_type:_shipTypeCache[shipId]||'Standard'},{onConflict:'ship_id'});
  try{renderNoBoxBanner();}catch(e){}
}
async function saveLavAsin(a){
  setSyncStatus('syncing');
  const base={id:a.uuid||undefined,asin:a.asin,sku:a.sku,product_name:a.prod,cost:a.cost,total_stock:a.total,dg:a.dg,notes:a.notes};
  const full={...base,vat:a.vat||'',archived:!!a.archived};
  const run=async data=>{
    if(a.uuid)return await sb.from('lavarion_asins').update(data).eq('id',a.uuid);
    return await sb.from('lavarion_asins').insert(data).select().single();
  };
  const missingCol=(res,col)=>res.error&&((res.error.message||'')+(res.error.details||'')+(res.error.hint||'')).toLowerCase().includes(col);
  let res=await run(full);
  // Graceful column fallbacks so a save never breaks on a not-yet-migrated schema,
  // while still trying to keep as much data as possible each step.
  if(missingCol(res,'archived')) res=await run({...base,vat:a.vat||''}); // archived col absent
  if(missingCol(res,'vat'))      res=await run({...base,archived:!!a.archived}); // vat col absent
  if(missingCol(res,'vat')||missingCol(res,'archived')) res=await run(base); // neither col
  if(!a.uuid&&res.data){
    /* same story as components — the product's stock batches follow its id */
    const oldId=String(a.id);
    a.uuid=res.data.id;a.id=res.data.id;
    if(typeof adoptId==='function')adoptId('product',oldId,res.data.id);
  }
  if(res.error){setSyncStatus('error');console.warn('saveLavAsin failed',res.error);toast('Lavarion save failed — check connection','er');return;}
  setSyncStatus('synced');
}
async function deleteLavAsin_db(a){
  if(!a.uuid)return;
  await sb.from('lavarion_asins').delete().eq('id',a.uuid);
}
async function saveLavShipment(s){
  const data={ship_id:s.shipId,asin:s.asin,sku:s.sku,product_name:s.prod,units:s.units,cost:s.cost,sent_date:s.date};
  const res=await sb.from('lavarion_shipments').insert(data).select().single();
  if(res.data)s.uuid=res.data.id;
}

// ── REAL-TIME SUBSCRIPTIONS ───────────────────────────────────────────────────
/* ── CATCH UP AFTER SLEEP ─────────────────────────────────────────────────
   24 Aug: the sheet sync added 13 rows at 08:07; Becki's tab had been open
   since before that. A slept laptop kills the live-updates connection, and on
   waking the app just carried on showing the old sheet — so she marked the 12
   rows she could see, all 13 invisible ones were missed, and a 96-unit
   shipment reached Amazon with 52 units in the hub. Everything she typed saved
   perfectly; the screen was the stale part.
   So: a heartbeat notices any gap the page slept through (a suspended machine
   freezes timers, which is exactly the tell), and on waking, coming back to
   the foreground, or the network returning, the app re-pulls everything and
   says so — it never again trusts a connection that has been dead. */
/* The catch-up used to announce itself with a toast after the fact. Jack, 24
   Aug: make the moment itself something to look at — a card that appears while
   the app heals, walks its three steps, lands on a tick and leaves. */
(function(){
  const css=document.createElement('style');
  css.textContent=`
  #resyncOv{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
    background:rgba(8,8,7,.55);backdrop-filter:blur(3px);opacity:0;pointer-events:none;
    transition:opacity .28s ease;}
  #resyncOv.on{opacity:1;pointer-events:auto;}
  #resyncCard{width:340px;max-width:88vw;background:linear-gradient(180deg,#201e1a,#131210);
    border:1px solid rgba(245,158,11,.3);
    border-radius:14px;padding:26px 26px 22px;
    box-shadow:0 24px 70px rgba(0,0,0,.75),0 0 0 1px rgba(0,0,0,.4),0 0 42px rgba(245,158,11,.07);
    transform:translateY(10px) scale(.97);transition:transform .28s ease;text-align:center;}
  #resyncOv.on #resyncCard{transform:translateY(0) scale(1);}
  #resyncRing{width:52px;height:52px;margin:0 auto 16px;border-radius:50%;position:relative;
    background:conic-gradient(var(--accent) 0 25%,rgba(245,158,11,.12) 25% 100%);
    -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 calc(100% - 5px));
    mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 calc(100% - 5px));
    animation:rsSpin .9s linear infinite;}
  #resyncOv.ok #resyncRing{animation:none;background:conic-gradient(var(--green,#4ade80) 0 100%);
    -webkit-mask:none;mask:none;display:flex;align-items:center;justify-content:center;
    transition:background .3s;}
  #resyncTick{display:none;font-size:26px;color:#0d0d0b;font-weight:900;line-height:1;}
  #resyncOv.ok #resyncTick{display:block;animation:rsPop .35s cubic-bezier(.2,1.6,.4,1);}
  @keyframes rsSpin{to{transform:rotate(360deg)}}
  @keyframes rsPop{0%{transform:scale(.3);opacity:0}100%{transform:scale(1);opacity:1}}
  #resyncTitle{font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px;}
  #resyncStep{font-size:12px;color:var(--text2);min-height:17px;margin-bottom:15px;transition:opacity .2s;}
  #resyncBarWrap{height:7px;border-radius:5px;background:var(--bg4);overflow:hidden;position:relative;}
  #resyncBar{height:100%;width:5%;border-radius:5px;background:linear-gradient(90deg,var(--accent),#ffb020);
    transition:width .5s cubic-bezier(.3,.8,.3,1);position:relative;overflow:hidden;}
  #resyncBar::after{content:'';position:absolute;inset:0;
    background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.35) 50%,transparent 70%);
    animation:rsSheen 1.1s linear infinite;}
  #resyncOv.ok #resyncBar{background:var(--green,#4ade80);}
  #resyncOv.ok #resyncBar::after{animation:none;}
  @keyframes rsSheen{from{transform:translateX(-100%)}to{transform:translateX(100%)}}`;
  document.head.appendChild(css);
  const ov=document.createElement('div');
  ov.id='resyncOv';
  ov.innerHTML=`<div id="resyncCard">
    <div id="resyncRing"><span id="resyncTick">✓</span></div>
    <div id="resyncTitle">Catching up</div>
    <div id="resyncStep"></div>
    <div id="resyncBarWrap"><div id="resyncBar"></div></div>
  </div>`;
  document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(ov));
  if(document.body)document.body.appendChild(ov);
})();
const resyncUI={
  show(why){const o=document.getElementById('resyncOv');if(!o)return;
    o.classList.remove('ok');
    const t=document.getElementById('resyncTitle');if(t)t.textContent='Catching up';
    this.step(8,`This tab was ${why} — bringing it up to date`);
    o.classList.add('on');},
  step(pct,txt){const b=document.getElementById('resyncBar'),st=document.getElementById('resyncStep');
    if(b)b.style.width=Math.min(100,pct)+'%';
    if(st&&txt)st.textContent=txt;},
  done(){const o=document.getElementById('resyncOv');if(!o)return;
    this.step(100,'Everything that happened meanwhile is now on screen');
    const t=document.getElementById('resyncTitle');if(t)t.textContent='All caught up';
    o.classList.add('ok');
    setTimeout(()=>o.classList.remove('on','ok'),1600);},
  hide(){const o=document.getElementById('resyncOv');if(o)o.classList.remove('on','ok');}
};
let _aliveTick=Date.now(),_resyncBusy=false,_resyncQueued=false;
async function resyncNow(why,quiet){
  if(_resyncBusy)return;
  /* mid-edit is a bad moment to swap the data out from under a modal — wait */
  if(document.querySelector('.overlay.open')){
    if(!quiet&&!_resyncQueued){_resyncQueued=true;
      setTimeout(()=>{_resyncQueued=false;resyncNow(why);},60000);}
    return;
  }
  _resyncBusy=true;
  try{
    if(!quiet)resyncUI.show(why);
    if(!quiet)resyncUI.step(18,'Saving anything you typed that had not gone up yet');
    try{flushPending();}catch(e){}
    if(!quiet)resyncUI.step(38,'Downloading the latest of everything');
    await dbLoad();
    if(!quiet)resyncUI.step(82,'Redrawing every page');
    ['renderPrep','renderShipments','renderDashboard','renderReturns','renderAdmin','renderStats']
      .forEach(f=>{try{window[f]&&window[f]()}catch(e){}});
    try{if(window.LV3&&LV3.isReady&&LV3.isReady())LV3.render();}catch(e){}
    /* dbLoad can resolve while rows is still filling (paged fetch) — a paint
       at that moment shows a near-empty page and nothing repaints (Jack's
       "gone blank after 60 seconds"). Wait for the row count to settle, then
       paint once more. Every render is visibility-gated, so this is cheap. */
    setTimeout(async()=>{try{
      let last=-1;
      for(let i=0;i<10&&rows.length!==last;i++){last=rows.length;await new Promise(r2=>setTimeout(r2,700));}
      ['renderPrep','renderShipments','renderDashboard','renderReturns','renderAdmin','renderStats']
        .forEach(f=>{try{window[f]&&window[f]()}catch(e){}});
      try{if(window.LV3&&LV3.isReady&&LV3.isReady())LV3.render();}catch(e){}
    }catch(e){}},600);
    if(!quiet){
      resyncUI.done();
      try{logAudit('Refreshed after a gap',why);}catch(e){}
    }
  }catch(e){
    console.warn('[resync]',e);
    resyncUI.hide();
    if(!quiet)toast('Could not refresh after reconnecting — reload the page to be safe','er');
  }
  _resyncBusy=false;
}
function watchForSleep(){
  _aliveTick=Date.now();
  /* a machine that suspends cannot run this timer, so a large gap between two
     beats IS the sleep — no browser event needed */
  setInterval(()=>{
    const gap=Date.now()-_aliveTick;
    _aliveTick=Date.now();
    if(gap>3*60*1000)resyncNow(`${Math.round(gap/60000)} minutes asleep`);
  },20000);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;
    const gap=Date.now()-_aliveTick;
    if(gap>3*60*1000){_aliveTick=Date.now();resyncNow('sitting in the background');}
  });
  window.addEventListener('online',()=>resyncNow('the connection coming back'));
  /* the backstop for whatever we have not thought of: whatever else fails —
     a live connection dying quietly while the machine stays awake, an event
     that never fires — a full quiet re-pull every 15 minutes caps how stale
     any screen can possibly be at 15 minutes, instead of a whole morning */
  setInterval(()=>{if(!document.hidden)resyncNow('routine check',true);},15*60*1000);
}

/* setupRealtime runs ONCE at boot. A laptop that sleeps for hours can come
   back with dead websockets — the page then looks fine and quietly stops
   hearing anything the other staff do. Pressing Sync now tears the old
   channels down and builds fresh ones, so "Sync" really does mean "wake up".
   Duplicate channels would double-process every event, so the removal is not
   optional. */
async function reviveRealtime(){
  try{
    if(typeof sb==='undefined'||!sb)return false;
    if(sb.getChannels&&sb.removeChannel){
      const chans=sb.getChannels()||[];
      for(const ch of chans){try{await sb.removeChannel(ch);}catch(e){}}
    }else if(sb.removeAllChannels){try{await sb.removeAllChannels();}catch(e){}}
    setupRealtime();
    return true;
  }catch(e){console.warn('[realtime] revive failed',e);return false;}
}
function setupRealtime(){
  sb.channel('prep_rows').on('postgres_changes',{event:'*',schema:'public',table:'prep_rows'},payload=>{
    if(payload.eventType==='INSERT'){
      const r=dbToRow(payload.new);
      // Dedupe on uuid AND local_id: a row we just created locally may still
      // be mid-insert (no uuid yet), so a uuid-only check would let the echo
      // push a duplicate. Match either key.
      const exists=rows.find(x=>(r.uuid&&x.uuid===r.uuid)||(r.id!=null&&String(x.id)===String(r.id)));
      if(exists){
        // Backfill the uuid onto our local row if it was still pending.
        if(!exists.uuid&&r.uuid)exists.uuid=r.uuid;
      }else{
        rows.push(r);
        const n=parseInt(r.id);if(Number.isFinite(n)&&n>nid)nid=n;
      }
    }else if(payload.eventType==='UPDATE'){
      const i=rows.findIndex(x=>x.uuid===payload.new.id);
      if(i>=0){
        // Ignore the realtime echo of our own in-flight write — but if it is
        // a REAL update from the other laptop crossing our edit, discarding it
        // forever was the last staleness hole (the audit's "_dirty drop").
        // Note it and quietly re-pull once our edit has had time to save.
        const incoming=dbToRow(payload.new);
        /* Jack, 7 Sep: "the whole page is very glitchy and jumpy." Every save
           held _dirty for 1.5s; the echo of OUR OWN write landed inside that
           window, was read as another laptop crossing the edit, and booked a
           full re-pull 25s later — so every count typed rebuilt every page.
           An echo that matches what we hold is ours: nothing to catch up. */
        const _sameAsMine=(a,b)=>a.status===b.status&&a.rcvd===b.rcvd&&a.ship===b.ship&&a.sent===b.sent
           &&a.notes===b.notes&&a.delivered===b.delivered&&a.wrongSku===b.wrongSku
           &&a.expectedDelivery===b.expectedDelivery
           &&JSON.stringify(a.resolution||null)===JSON.stringify(b.resolution||null)
           &&JSON.stringify(a.shipSegments||[])===JSON.stringify(b.shipSegments||[]);
        if(rows[i]._dirty){
          if(!_sameAsMine(rows[i],incoming)){
            clearTimeout(window._dirtyCatchT);
            window._dirtyCatchT=setTimeout(()=>{try{resyncNow('catching up a crossed edit',true);}catch(e){}},25000);
          }
          return;
        }
        // If nothing actually changed, don't repaint — a stale/no-op echo
        // arriving mid-edit would otherwise rebuild the table and reset the
        // status dropdown the user just changed.
        /* The guard never looked at `resolution`, so a case step taken on one
           laptop was invisible on the other — and worse, that laptop's copy
           stayed stale and then wrote the old value back over the top on its
           next save, silently deleting the case. Triage answers and the
           expected date had the same hole. */
        if(rows[i].status===incoming.status
           &&rows[i].rcvd===incoming.rcvd
           &&rows[i].ship===incoming.ship
           &&rows[i].sent===incoming.sent
           &&rows[i].notes===incoming.notes
           &&rows[i].delivered===incoming.delivered
           &&rows[i].wrongSku===incoming.wrongSku
           &&rows[i].expectedDelivery===incoming.expectedDelivery
           &&JSON.stringify(rows[i].resolution||null)===JSON.stringify(incoming.resolution||null)
           &&JSON.stringify(rows[i].shipSegments||[])===JSON.stringify(incoming.shipSegments||[]))return;
        incoming._dirty=rows[i]._dirty;  // preserve edit flag across rehydrate
        // Preserve portal-owned fields — never let a realtime echo overwrite them
        incoming.notes=rows[i].notes;
        incoming.vaNote=rows[i].vaNote;
        incoming.vaNoteBy=rows[i].vaNoteBy;incoming.vaNoteAt=rows[i].vaNoteAt;
        incoming.transitAction=rows[i].transitAction||incoming.transitAction;
        rows[i]=incoming;
      }else if(!_historyReady){
        /* Row not in memory YET — it is on an archive page Phase B has not
           merged. Dropping this event would hand the stale page copy the win
           at merge time; buffer it and replay at finalize. (After finalize a
           miss means a genuinely unknown row — same silent drop as always.) */
        _pendingRt.push(payload);
      }
    }else if(payload.eventType==='DELETE'){
      /* In-place splice, never reassignment: Phase B's merge loop reads the
         global `rows` binding mid-walk, and a reassignment would leave it
         pushing into an orphaned array. Buffered too while history loads, so
         the replay re-filters any copy an already-fetched page sneaks back. */
      const di=rows.findIndex(x=>x.uuid===payload.old.id);
      if(di>=0)rows.splice(di,1);
      if(!_historyReady)_pendingRt.push(payload);
    }
    /* One coalesced repaint per burst — the mid-type protection lives inside
       rtRepaint now, checked at flush time when it actually matters. */
    rtRepaint();
  }).subscribe();

  sb.channel('actions').on('postgres_changes',{event:'*',schema:'public',table:'actions'},payload=>{

    if(payload.eventType==='INSERT'){
      const c=dbToClaim(payload.new);
      // Dedup: match by uuid, or by local_id (the Date.now() id set before Supabase confirms)
      const loc=claims.find(x=>
        (c.uuid && x.uuid===c.uuid) ||
        (payload.new.local_id && (String(x.id)===String(payload.new.local_id)||String(x.uuid)===String(payload.new.local_id)))
      );
      if(loc){if(!loc.uuid)loc.uuid=c.uuid;if(!loc.id||loc.id===loc.uuid)loc.id=c.uuid;}
      else{claims.unshift(c);}

    }else if(payload.eventType==='UPDATE'){
      const i=claims.findIndex(x=>x.uuid===payload.new.id);
      if(i>=0)claims[i]=dbToClaim(payload.new);
    }else if(payload.eventType==='DELETE'){
      claims=claims.filter(x=>x.uuid!==payload.old.id);
    }
    renderClaims();updateCB();
    if(document.getElementById('page-admin')&&document.getElementById('page-admin').classList.contains('active'))renderAdmin();
  }).subscribe();

  sb.channel('ship_boxes').on('postgres_changes',{event:'*',schema:'public',table:'ship_boxes'},payload=>{
    setTimeout(()=>{try{renderNoBoxBanner();}catch(e){}},50);
    if(payload.new)shipBoxes[payload.new.ship_id]=payload.new.boxes;
  }).subscribe();

  sb.channel('lavarion_asins').on('postgres_changes',{event:'*',schema:'public',table:'lavarion_asins'},payload=>{
    if(payload.eventType==='INSERT'){const a=dbToLav(payload.new);if(!lavAsins.find(x=>x.uuid===a.uuid))lavAsins.push(a);}
    else if(payload.eventType==='UPDATE'){const i=lavAsins.findIndex(x=>x.uuid===payload.new.id);if(i>=0)lavAsins[i]=dbToLav(payload.new);}
    else if(payload.eventType==='DELETE'){lavAsins=lavAsins.filter(x=>x.uuid!==payload.old.id);}
    if(document.getElementById('page-lavarion').classList.contains('active'))renderLavarion();
  }).subscribe();

  // Lavarion components & component lists — keep this browser in step when another device
  // edits them. Guarded: ignore echoes of our own in-flight saves, and debounce
  // so a burst of row changes triggers a single reload.
  var _lv2RtT=null,_lv2RtPending=false;
  function _lv2ModalOpen(){
    return ['lav3Ov1','lav3Ov2']
      .some(function(id){var o=document.getElementById(id);return o&&o.classList.contains('open');});
  }
  function _lv2RemoteRefresh(){
    if(window._lv2IsSaving&&window._lv2IsSaving())return; // our own write echoing back
    /* A reload rebuilds the whole model from the database. If this page still
       holds changes that haven't been written yet, that reload would quietly
       throw them away — so flush first, then refresh. */
    if(window._lv2HasUnsaved&&window._lv2HasUnsaved()){
      if(window._lv2Flush)window._lv2Flush();
      clearTimeout(_lv2RtT);_lv2RtT=setTimeout(_lv2RemoteRefresh,1200);return;
    }
    clearTimeout(_lv2RtT);
    _lv2RtT=setTimeout(function _run(){
      // Don't reload out from under an open editor — it would discard the user's
      // in-progress edit. Defer until the modal closes, then apply the fresh data.
      if(_lv2ModalOpen()){_lv2RtPending=true;setTimeout(_run,1000);return;}
      _lv2RtPending=false;
      if(typeof window._lv2Reload==='function')window._lv2Reload();
      if(window.LV3&&LV3.render)LV3.render();
    },400);
  }
  sb.channel('lavarion_components').on('postgres_changes',{event:'*',schema:'public',table:'lavarion_components'},_lv2RemoteRefresh).subscribe();
  sb.channel('lavarion_recipes').on('postgres_changes',{event:'*',schema:'public',table:'lavarion_recipes'},_lv2RemoteRefresh).subscribe();
  /* Recovery Stock — quiet re-pull on any change from the other laptop */
  try{sb.channel('recovery_items').on('postgres_changes',{event:'*',schema:'public',table:'recovery_items'},()=>{
    if(typeof recLoad!=='function')return;
    clearTimeout(window._recRtT);window._recRtT=setTimeout(()=>{recLoad().then(()=>{if(_pageActive('page-recovery'))renderRecovery();});},600);
  }).subscribe();}catch(e){console.warn('[recovery] realtime',e);}
}

// ── PATCH UF() TO ALSO SAVE TO SUPABASE ──────────────────────────────────────
