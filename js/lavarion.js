/* ═══════════════════════════════════════════════════════════════════════════
   LAVARION v3 — bundles + private label, FIFO stock batches, computed COG
   ---------------------------------------------------------------------------
   Replaces the old lv2 system. Everything lives inside this IIFE so nothing
   leaks into the rest of Prep Hub; the page's inline handlers call LV3.*.

   Data it owns:
     lavarion_stock_layers   — stock as priced FIFO batches   (NEW table)
     lavarion_purchases      — the sheet mirror + allocations  (NEW table)
     lavarion_asins          — products (+ product_type column)
     lavarion_components     — components (+ kind / tag columns)
     lavarion_recipes        — unchanged
   If the migration SQL hasn't been run yet, everything still works in memory
   and a banner says so — nothing is lost, nothing silently fails.
   ═══════════════════════════════════════════════════════════════════════════ */
window.LV3=(function(){
'use strict';
const BUILD='v50.8 · lav3 · 2026-09-10 · b568';
console.log('[Lavarion] build',BUILD);

let READY=false;          // true once the new tables are confirmed to exist
let MIGRATED=false;       // true once old onHand/orders have been turned into layers
let SCHEMA_MSG='',SCHEMA_ERR='';

/* the model the UI works against — hydrated from the app's live arrays */
let D={products:[],components:[],purchases:[],log:[],settings:{
  locations:'Warehouse, Prep Centre',targetDays:60,purchFrom:'2026-08-01',dense:false,startTab:'overview',
  /* Working days from a shipment leaving here to it being Prime-eligible at
     Amazon. It is a setting and not a constant because it is genuinely not a
     constant — Q4 is slower, the quiet months are quicker. */
  primeDays:10,
  cols:{pIncoming:true,pOrdered:false,pSold:true,pCog:true,pSendBy:true,
        cOnOrder:true,cOrdered:true,cUsed:true}}};

const TODAY=new Date();
const nowISO=()=>new Date().toISOString();
/* LOCAL date, built from parts. toISOString() is UTC, and in British Summer
   Time UTC is an hour behind — so anything logged between midnight and 1am was
   stamped with YESTERDAY'S date. Receipts, chases, stock counts: all off by a
   day for that hour, every night, silently. */
const localDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dayISO=()=>localDay(new Date());


/* ── components + recipes: this module now owns both stores ──────────────
   (they used to live in the lv2 block this replaces). Exposed on window so
   the backup export and realtime hooks keep working. */
let COMPS=[], RECIPES={};
window.lv2Components=COMPS; window.lv2Recipes=RECIPES;
function compRow(c){return{id:c.uuid||undefined,name:c.name||'',
  kind:c.kind||'component',                       // the column the loader reads first
  tag:c.tag||'complementary',
  type:(c.kind==='packaging'?'packing':(c.tag||'complementary')),   // keep the old column valid
  supplier:c.supplier||'',case_qty:(c.caseQty!=null?c.caseQty:null),size:c.size||'',
  /* never overwrite the legacy figures — the migration reads them, and once
     they're gone they're gone. Stock now lives in lavarion_stock_layers. */
  on_hand:(c._legacyOnHand!=null?c._legacyOnHand:0),
  orders:JSON.stringify(c._legacyOrders||[]),
  archived:!!c.archived};}
function rowToComp(d){return{uuid:d.id,id:d.id,name:d.name||'',
  /* d.kind defaults to 'component' in the schema, so a saved 'packing' in the
     old column has to win — otherwise packaging silently becomes a component */
  kind:(d.type==='packing')?'packaging':(d.kind||'component'),
  tag:d.tag||d.type||'complementary',caseQty:(d.case_qty!=null?d.case_qty:null),
  /* compRow writes `supplier` on every push; nothing ever read it back and
     nothing in LV3 assigns c.supplier, so it was permanently undefined and
     every save wrote '' over the column. All 87 components were already blank
     when this was found. Reading it back closes the loop. */
  supplier:d.supplier||'',
  size:d.size||'',archived:!!d.archived,
  _legacyOnHand:d.on_hand||0,
  _legacyOrders:(function(){try{return JSON.parse(d.orders||'[]');}catch(e){return[];}})()};}

let _crLoadedOK=false,_crLoadedCount=0;
async function loadCompsRecipes(){
  try{
    const cr=await sb.from('lavarion_components').select('*').order('created_at',{ascending:true});
    if(cr.error)throw cr.error;
    COMPS.length=0;(cr.data||[]).map(rowToComp).forEach(c=>COMPS.push(c));
    _crLoadedCount=COMPS.length;
    const rr=await sb.from('lavarion_recipes').select('*');
    if(rr.error)throw rr.error;
    const byUuid={};COMPS.forEach(c=>{byUuid[c.uuid]=String(c.id);});
    Object.keys(RECIPES).forEach(k=>delete RECIPES[k]);
    (rr.data||[]).forEach(d=>{const cid=byUuid[d.component_id];if(!cid)return;
      (RECIPES[d.asin]=RECIPES[d.asin]||[]).push({c:cid,q:d.qty||1});});
    _crLoadedOK=true;
    return true;
  }catch(e){console.warn('[lav3] components/recipes load failed',e);return false;}
}
let _crT=null;
function saveCompsRecipes(){clearTimeout(_crT);_crT=setTimeout(pushCompsRecipes,600);}
/* A row created in the UI gets a temporary id ("c1785…"). Supabase then hands
   back a permanent one, and after the next reload the component IS that id —
   but its stock batches and build-list lines still point at the temporary one,
   so they orphan and the stock silently disappears. Whether it survived came
   down to whether a reload happened first, which is why it only failed
   sometimes. Re-point everything the moment the real id arrives. */
function adoptId(kind,oldId,newId){
  if(!oldId||!newId||String(oldId)===String(newId))return;
  const o=String(oldId),nu=String(newId);
  let moved=0;
  LAYERS.forEach(l=>{
    if(l.kind===kind&&String(l.tid)===o){l.tid=nu;l._dirty=1;moved++;}
  });
  if(kind==='component'){
    Object.keys(RECIPES).forEach(k=>{
      (RECIPES[k]||[]).forEach(r=>{if(String(r.c)===o)r.c=nu;});
    });
    D.products.forEach(p=>(p.recipe||[]).forEach(r=>{if(String(r.c)===o)r.c=nu;}));
    if(D.settings.untracked&&D.settings.untracked[o]){
      D.settings.untracked[nu]=true;delete D.settings.untracked[o];savePrefs();}
    if(D.settings.aliases){Object.keys(D.settings.aliases).forEach(k=>{
      if(String(D.settings.aliases[k])===o)D.settings.aliases[k]=nu;});}
  }
  D.purchases.forEach(p=>(p.alloc||[]).forEach(a=>{if(String(a.to)===o)a.to=nu;}));
  const model=kind==='component'?D.components:D.products;
  const m=model.find(x=>String(x.id)===o);if(m)m.id=nu;
  if(moved){_dirty=true;clearTimeout(_pt);_pt=setTimeout(pushNow,400);}
}
async function pushCompsRecipes(){
  if(!_crLoadedOK){console.warn('[lav3] refusing to save — components never loaded');return;}
  _writing++;
  try{
    for(const c of COMPS){
      const row=compRow(c);
      const strip=o=>{const x={...o};delete x.kind;delete x.tag;return x;};
      if(c.uuid){
        let r=await sb.from('lavarion_components').update(row).eq('id',c.uuid);
        if(r.error&&/kind|tag/i.test(r.error.message||''))r=await sb.from('lavarion_components').update(strip(row)).eq('id',c.uuid);
        if(r.error)throw r.error;
      }else{
        let r=await sb.from('lavarion_components').insert(row).select('id').single();
        if(r.error&&/kind|tag/i.test(r.error.message||''))r=await sb.from('lavarion_components').insert(strip(row)).select('id').single();
        if(!r.error){
          const oldId=String(c.id);
          c.uuid=r.data.id;c.id=r.data.id;
          adoptId('component',oldId,r.data.id);   // batches and build lists follow the id
        }
      }
    }
    /* pruning is only ever safe when we hold the full loaded set — and never
       when memory looks suspiciously emptier than what we loaded */
    const keep=COMPS.map(c=>c.uuid).filter(Boolean);
    if(_crLoadedOK&&keep.length&&keep.length>=_crLoadedCount){
      const d=await sb.from('lavarion_components').delete().not('id','in','('+keep.join(',')+')');
      if(d.error)console.warn('[lav3] component prune',d.error);
    }else if(keep.length<_crLoadedCount){
      console.warn('[lav3] skipped prune — memory has fewer components than the database');
    }
    const rows=[];
    Object.keys(RECIPES).forEach(asin=>(RECIPES[asin]||[]).forEach(r=>{
      const c=COMPS.find(x=>String(x.id)===String(r.c));
      if(c&&c.uuid)rows.push({asin:asin,component_id:c.uuid,qty:parseInt(r.q)||1});}));
    const ex=await sb.from('lavarion_recipes').select('id');
    const old=(ex.data||[]).map(x=>x.id);
    if(rows.length){const ir=await sb.from('lavarion_recipes').insert(rows);
      if(ir.error)throw ir.error;
      if(old.length)await sb.from('lavarion_recipes').delete().in('id',old);}
    else if(old.length)await sb.from('lavarion_recipes').delete().in('id',old);
  }catch(e){console.warn('[lav3] components/recipes save failed',e);}
  finally{setTimeout(()=>{_writing=Math.max(0,_writing-1);},1500);}
}
window._lv2Reload=function(){loadCompsRecipes().then(()=>{try{paint();}catch(e){}});};
/* so the realtime listener can tell whether it is safe to rebuild from the database */
window._lv2HasUnsaved=function(){
  try{return _dirty||LAYERS.some(l=>!l.uuid)||PURCH.some(p=>!p.uuid);}catch(e){return false;}
};
window._lv2Flush=function(){try{clearTimeout(_pt);pushNow();}catch(e){}};
let _writing=0;
window._lv2IsSaving=function(){return _writing>0;};

/* ── hydrate: build D from what the app already has in memory ───────────── */
function hydrate(){
  D.products=(typeof lavAsins!=='undefined'?lavAsins:[]).map(a=>({
    archived:!!a.archived,
    id:String(a.id),uuid:a.uuid,asin:a.asin||'',sku:a.sku||'',name:a.prod||a.asin||'',
    type:a.ptype||'bundle',vat:(a.vat||a.vat==='0')?String(a.vat):'20',
    recipe:(RECIPES[a.asin]||[]).map(r=>({c:String(r.c),q:r.q})),
    layers:LAYERS.filter(l=>l.kind==='product'&&l.tid===String(a.id)),
    ship30:shipStats(a.asin).u30,lastSent:shipStats(a.asin).last,_src:a}));
  D.products.forEach(p=>{const a=p._src;if(a&&a._sig===undefined)
    a._sig=[p.name,p.asin,p.sku,p.vat,p.type,JSON.stringify(p.recipe)].join('|');});
  D.components=COMPS.map(c=>({
    archived:!!c.archived,
    id:String(c.id),uuid:c.uuid,name:c.name||'',
    kind:c.kind||(c.type==='packing'?'packaging':'component'),
    tag:c.tag||c.type||'complementary',caseQty:c.caseQty||null,
    untracked:isUntracked(c.id),
    layers:LAYERS.filter(l=>l.kind==='component'&&l.tid===String(c.id)),_src:c}));
  D.components.forEach(c=>{const x=c._src;if(x&&x._sig===undefined)
    x._sig=[c.name,c.kind,c.tag,c.caseQty].join('|');});
  D.purchases=PURCH;
}
function shipStats(asin){
  const cut=Date.now()-30*864e5;let u30=0,last='';
  (typeof lavShipments!=='undefined'?lavShipments:[]).forEach(s=>{
    if(s.asin!==asin)return;const d=(s.date||'').slice(0,10);if(!d)return;
    if(new Date(d).getTime()>=cut)u30+=parseInt(s.units)||0;
    if(d>last)last=d;});
  return{u30,last};
}

/* ── the two new tables, held flat and mirrored on change ───────────────── */
let _layersLoadedCount=0;
let LAYERS=[];   // {id,kind,tid,date,qty,rem,cost,sup,oid,loc,arr,src,note,uuid}
let PURCH=[];    // {id,uuid,tab,date,name,qty,price,sup,oid,loc,arr,alloc:[{to,kind,qty}]}

async function loadCloud(){
  try{
    const lr=await sb.from('lavarion_stock_layers').select('*').order('bought_on',{ascending:true});
    if(lr.error)throw lr.error;
    LAYERS=(lr.data||[]).map(d=>({uuid:d.id,id:d.id,kind:d.target_kind,tid:String(d.target_id||''),
      date:(d.bought_on||'').slice(0,10),qty:d.qty||0,rem:d.remaining||0,cost:Number(d.unit_cost)||0,
      sup:d.supplier||'',oid:d.order_ref||'',loc:d.location||'Warehouse',arr:d.arrived?1:0,
      src:d.source||'',note:d.note||'',
      ...(d.meta&&typeof d.meta==='object'?d.meta:{})}));
    /* Repair on the way in, for rows already written by the old code.
       `qty` means "still owed" once anything has been counted in, and `ord` is
       the original order — but ordQty() falls back to qty when ord is missing,
       so a part-received order reported what was LEFT as what was ORDERED.
       ord = what is still owed + what has already come in. Reading only; the
       corrected value is written back the next time the row is saved. */
    let _healed=0;
    LAYERS.forEach(l=>{
      const rc=parseInt(l.rcvd)||0;
      if(rc>0&&!(parseInt(l.ord)||0)){l.ord=(parseInt(l.qty)||0)+rc;_healed++;}
    });
    if(_healed)console.warn('[lav3] repaired the ordered quantity on '+_healed+' part-received order(s)');
    _layersLoadedCount=LAYERS.length;
    /* Jack, 7 Sep: his 60-hamper deduction reached the database and was back at
       300 minutes later. Every save pushed EVERY batch with whatever this tab
       held, so any other open tab's next save rewrote stock it never touched.
       Remember what each batch looked like when it loaded (or was last
       pushed) and only send the ones that differ. */
    LAYERS.forEach(l=>{l._pushed=JSON.stringify(layerRow(l));});
    const pr=await sb.from('lavarion_purchases').select('*').order('bought_on',{ascending:false});
    if(pr.error)throw pr.error;
    PURCH=(pr.data||[]).map(d=>({uuid:d.id,id:d.id,tab:d.sheet_tab||'',date:(d.bought_on||'').slice(0,10),
      name:d.name||'',qty:d.qty||0,price:Number(d.buy_price)||0,sup:d.supplier||'',oid:d.order_ref||'',
      loc:d.location||'',arr:d.arrived?1:0,alloc:(function(){try{return JSON.parse(d.alloc||'[]');}catch(e){return Array.isArray(d.alloc)?d.alloc:[];}})(),
      ...(d.meta&&typeof d.meta==='object'?d.meta:{})}));
    READY=true;SCHEMA_MSG='';
  }catch(e){
    READY=false;
    /* Name the table. "The tables don't exist" sent people hunting; knowing it
       is lavarion_stock_layers specifically turns it into a two-minute fix. */
    const which=/relation "?([a-z_]+)"? does not exist|Could not find the table '([^']+)'/i.exec(
      (e&&e.message||'')+' '+(e&&e.details||''));
    SCHEMA_MSG=which?`The table <b>${esc(which[1]||which[2])}</b> doesn't exist in the database yet.`
      :'The Lavarion tables don’t exist in the database yet.';
    SCHEMA_ERR=(e&&e.message)||'unknown error';
    console.warn('[lav3] tables missing — running in memory only',e&&e.message);
  }
}

/* one-time: turn the old on-hand figure and open orders into real stock batches */
async function migrateOld(){
  if(!READY||MIGRATED)return;
  if(LAYERS.length){MIGRATED=true;return;}          // already has batches — nothing to do
  const comps=COMPS;
  if(!comps.length){MIGRATED=true;return;}
  const made=[];
  comps.forEach(c=>{
    if((c._legacyOnHand||0)>0)made.push({kind:'component',tid:String(c.id),date:dayISO(),qty:c._legacyOnHand,rem:c._legacyOnHand,
      cost:0,sup:'Opening stock',oid:'—',loc:'Warehouse',arr:1,src:'migration',note:'price missing — set when the purchase is allocated'});
    (c._legacyOrders||[]).forEach(o=>{
      const q=parseInt(o.qty)||0;if(q<1)return;
      made.push({kind:'component',tid:String(c.id),date:(o.ordered_at||nowISO()).slice(0,10),qty:q,
        rem:o.delivered?q:0,cost:0,sup:'From old order log',oid:o.ref||'—',loc:'Warehouse',
        arr:o.delivered?1:0,src:'migration',note:'price missing — set when the purchase is allocated'});
    });
  });
  if(!made.length){MIGRATED=true;return;}
  for(const m of made){await insertLayer(m);}
  MIGRATED=true;
  try{logAudit('Lavarion migrated to stock batches',made.length+' batches created from old on-hand and orders');}catch(e){}
  hydrate();
}

/* ── persistence ────────────────────────────────────────────────────────── */
/* Everything the delivery and chase process records — the shipping method, the
   expected window, who marked it arrived, when it was counted in, whether it
   came up short and how that ended — had nowhere to go. The table only had the
   twelve core columns, so all of it was rebuilt or lost on every refresh: the
   How dropdown reset to Courier, expected dates were re-guessed, and a chase
   with a reply-by date vanished. One jsonb column carries the lot, so adding a
   field later never needs another migration. */
const LAYER_META=['mode','eta1','eta2','_etaTouched','_etaGuess',
  'arrivedOn','arrivedBy','recvOn','recvBy',
  'short','shortQty','shortOn','shortBy','chased','chasedBy','replyBy','shortEnd','writtenOff',
  /* the supplier put it right on their own — kept so reporting can tell that
     apart from a refund somebody had to go and chase */
  'autoRefund',
  /* Jack, 8 Sep: a late Alibaba order goes to him; he sends it back with a date.
     9 Sep: EVERY late Lavarion order starts with him — lateToSarah is the job
     he hands her, with his note, when he needs something done. */
  'lateToJack','lateToSarah',
  /* damaged units: arrived, so nothing outstanding — but never sellable stock */
  'dmg','dmgOn','dmgBy','dmgEnd',
  /* one order, many deliveries: what was ordered, what has come in so far, and
     every receipt that made it up. Without these a second box against the same
     order looked like a brand new order and the shortfall vanished. */
  'ord','rcvd','rcpts','repl','closed','ofOrd',
  /* which line of its purchase's allocation this layer is. The only stable way
     to find it again after a refresh — see setAlloc. */
  'allocIx',
  /* THE CHASE CONVERSATION. LAYER_META is a WHITELIST — layerMeta() copies only
     the keys named here — and `log` and `toJack` were never in it. So Sarah
     chased a supplier, got her green toast, saw it in the Progress log, and it
     was gone on the next refresh; a shortage she sent to Jack silently came
     back to her queue and dropped off his page. Exactly the "sent to Jack and
     it's gone" bug from the prep side, living over here.
     No new exposure: logIt() already writes the same names and messages into
     app_settings.lavarion_state, same project, same anon key.
     `evid` (the Discord photo link) is deliberately NOT here yet — that URL is
     the one genuinely new thing this table would carry, and it is Jack's call. */
  'log','toJack',
  'manual','why','whoAdded','leadLo','leadHi',
  /* a note left when stock was counted in stays OPEN until somebody deals with
     it — the order does not silently disappear just because the box arrived */
  'noteOpen','noteBy','noteOn'];
function layerMeta(l){const m={};LAYER_META.forEach(k=>{if(l[k]!==undefined&&l[k]!=='')m[k]=l[k];});return m;}
function layerRow(l){return{target_kind:l.kind,target_id:String(l.tid),bought_on:l.date,qty:l.qty,remaining:l.rem,
  unit_cost:l.cost,supplier:l.sup,order_ref:l.oid,location:l.loc,arrived:!!l.arr,source:l.src||'',note:l.note||'',
  meta:layerMeta(l)};}
let _layerErr=false;
const _layerTombs=new Set();   // rows this session deleted on purpose — see writeBack
async function insertLayer(l){
  l.id=l.id||newId('L');
  LAYERS.push(l);
  if(!READY)return l;
  if(l._failed&&Date.now()-l._failed<15000)return l;      // back off, don't give up
  const r=await sb.from('lavarion_stock_layers').insert(layerRow(l)).select('id').single();
  if(r.error){
    /* Parking a failed batch stops a retry storm, but parking it FOREVER meant
       one blip lost that stock at the next refresh. Park it, then let the next
       save try again — the storm guard is the timestamp, not a one-way flag. */
    l._failed=Date.now();
    if(!_layerErr){_layerErr=true;
      console.warn('[lav3] stock_layers rejected the insert',r.error);
      toast('A stock batch didn\'t save — checking again shortly. Settings → Check the database if it keeps happening','er');
      setTimeout(()=>{_layerErr=false;},20000);}
    return l;
  }
  l.uuid=r.data.id;return l;
}
let _pt=null,_dirty=false,_warned=false,_lastStatus=0;
/* the badge is shared with the whole app — never strobe it */
function status(st){
  const now=Date.now();
  if(st==='syncing'&&now-_lastStatus<3000)return;
  _lastStatus=now;
  try{setSyncStatus(st);}catch(e){}
}
function persist(){_dirty=true;clearTimeout(_pt);_pt=setTimeout(pushNow,900);}
async function pushNow(){
  if(!READY)return;
  const dirty=LAYERS.some(l=>!l.uuid)||PURCH.some(p=>!p.uuid)||_dirty;
  if(!dirty)return;                       // nothing changed — don't touch the badge
  /* Do NOT clear the flag up front. Clearing it here meant a pass that threw
     half way left the rest unsaved AND marked clean, so the change was gone at
     the next refresh with no error anyone would see. */
  try{
    status('syncing');
    for(const l of LAYERS){
      if(l._failed&&Date.now()-l._failed<15000)continue;   // recently failed — back off briefly
      if(l.uuid){const row=layerRow(l),sig=JSON.stringify(row);if(l._pushed===sig)continue;
        const r=await sb.from('lavarion_stock_layers').update(row).eq('id',l.uuid);if(r.error)throw r.error;l._pushed=sig;}
      else{const row=layerRow(l);const r=await sb.from('lavarion_stock_layers').insert(row).select('id').single();
        if(r.error){l._failed=true;if(!_layerErr){_layerErr=true;console.warn('[lav3] layer insert',r.error);}}
        else{l.uuid=r.data.id;l._pushed=JSON.stringify(row);}}
    }
    if(_layerTombs.size){
      const ids=[..._layerTombs];
      const d=await sb.from('lavarion_stock_layers').delete().in('id',ids);
      if(d.error)console.warn('[lav3] layer delete',d.error);
      else ids.forEach(id=>_layerTombs.delete(id));
    }
    for(const p of PURCH){
      /* Same hole as the stock table had. A purchase carries the account it was
         bought on, the invoice link, the notes column and — most importantly —
         SPEND, the sheet's own total. None of it was written, so after a refresh
         the line total went back to qty × price and the £11.90 on the sheet read
         as £11.88 again. It only ever looked right because the next sync
         refilled it. */
      const row={sheet_tab:p.tab||'',bought_on:p.date,name:p.name,qty:p.qty,buy_price:p.price,supplier:p.sup,
        order_ref:p.oid,location:p.loc,arrived:!!p.arr,alloc:JSON.stringify(p.alloc||[]),
        meta:{acct:p.acct||'',invoice:p.invoice||'',notes:p.notes||'',
              spend:(p.spend!=null?p.spend:null),mismatch:p.mismatch||0,link:p.link||'',
              /* "the sheet has two lines that look identical — are they?" The
                 answer has to survive a refresh or it gets asked forever. */
              dupCheck:p.dupCheck||null}};
      if(p.uuid){const r=await sb.from('lavarion_purchases').update(row).eq('id',p.uuid);if(r.error)throw r.error;}
      else{const r=await sb.from('lavarion_purchases').insert(row).select('id').single();
        if(!r.error){
          /* the batches this purchase created are tagged with its id — if the id
             changes underneath them they orphan, and re-allocating would leave
             the old stock behind as a duplicate */
          const oldTag='P:'+p.id;
          p.uuid=r.data.id;p.id=r.data.id;
          const newTag='P:'+r.data.id;
          LAYERS.forEach(l=>{if(l.src===oldTag){l.src=newTag;l._dirty=1;}});
        }}
    }
    _dirty=false;                          // only now is everything genuinely written
    status('synced');
  }catch(e){
    _dirty=true;                           // still unsaved — try again on the next tick
    clearTimeout(_pt);_pt=setTimeout(pushNow,4000);
    status('error');console.warn('[lav3] save failed',e);
    if(!_warned){_warned=true;toast('Lavarion save failed — retrying. If the badge stays red, Settings → Check the database','er');setTimeout(()=>{_warned=false;},15000);}}
}
/* products and components still save through the app's existing helpers */
function saveProductSrc(p){
  /* Lead time rides in prefs keyed by ASIN, the same shape the at-Amazon and
     sold-30 figures already use, so it needs no new database column. */
  try{const el=document.getElementById('e-lead');
    if(el&&p.asin)setLead(p.asin,el.value);}catch(e){}
  const a=p._src;if(!a)return;
  const oldAsin=a.asin;
  a.prod=p.name;a.asin=p.asin;a.sku=p.sku;a.vat=p.vat;a.ptype=p.type;
  if(oldAsin&&oldAsin!==p.asin)delete RECIPES[oldAsin];   // don't strand the old key
  RECIPES[p.asin]=p.recipe.map(r=>({c:r.c,q:r.q}));
  saveLavAsin(a);
  saveProductType(a);
  saveCompsRecipes();   // debounced — recipes live in lavarion_recipes
}
let _ptypeWarned=false;
async function saveProductType(a){
  if(!a.uuid)return;
  const r=await sb.from('lavarion_asins').update({product_type:a.ptype||'bundle'}).eq('id',a.uuid);
  if(!r.error)return;
  const missing=/product_type/.test((r.error.message||'')+(r.error.details||''));
  if(missing){
    /* Silently swallowing this is why "I changed it to private label and it
       didn't save" kept happening — say so instead. */
    if(!_ptypeWarned){_ptypeWarned=true;
      toast('Product type can\'t save — run the database update in Settings → Database','er');}
    console.warn('[lav3] product_type column missing — run the migration');
  }else console.warn('[lav3] ptype',r.error);
}
function saveComponentSrc(c){
  const s=c._src;if(!s)return;
  s.name=c.name;s.kind=c.kind;s.tag=c.tag;s.caseQty=c.caseQty;
  s.type=c.kind==='packaging'?'packing':(c.tag||'complementary');   // keep the old column valid
  saveCompsRecipes();
}


/* ═══════════════════════════════════════════════════════════════════════
   LAVARION PROTOTYPE — data model
   ---------------------------------------------------------------------
   products   : what we sell.  type = bundle | pl | single
                bundle  -> no stock of its own, availability = buildable
                pl/single -> has its own stock layers, no build step
   components : shared parts.  kind = component | packaging
   layers     : EVERY stock movement in is a layer {qty, remaining, cost}
                consumed strictly OLDEST FIRST (FIFO). A layer is the same
                thing as a row on the Lavarion purchase sheet.
   purchases  : the raw sheet rows, linked to a component or a product.
   ═══════════════════════════════════════════════════════════════════════ */

/* Ids were the timestamp alone. Two components created in the same millisecond —
   bulk add, a quick pair of saves — ended up sharing an id, and every lookup
   after that returned whichever came first. That is how a Dove lotion started
   pointing at a foam nozzle. */
let _idSeq=0;
function newId(prefix){
  _idSeq=(_idSeq+1)%100000;
  return prefix+Date.now().toString(36)+_idSeq.toString(36)+Math.floor(Math.random()*1296).toString(36);
}
function isEmpty(){return !D.products.length&&!D.components.length;}
function clearAll(){toast('Not available in the live app — delete items individually','er');}

let TAB='overview',Q='',pFilter='all',cFilter='all',uFilter='all',openRows={};
let _firstPaint=true;

/* ── helpers ───────────────────────────────────────────── */
const $=id=>document.getElementById(id);
const comp=id=>D.components.find(c=>c.id===id);
const prod=id=>D.products.find(p=>p.id===id);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt=n=>(n==null||isNaN(n))?'—':Number(n).toLocaleString('en-GB');
const gbp=n=>'£'+Number(n||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
const gbp3=n=>'£'+Number(n||0).toFixed(3);

function ago(d){if(!d)return'—';const n=Math.floor((TODAY-new Date(d))/864e5);return n<=0?'today':n===1?'1d ago':n<31?n+'d ago':n<365?Math.round(n/30.4)+'mo ago':Math.round(n/365)+'y ago';}
/* dd/mm everywhere on this page — the same way the purchase sheet writes dates,
   so a figure here can be matched against a row there without translating. */
function dshort(d){
  if(!d)return'—';
  const iso=String(d).slice(0,10),p=iso.split('-');
  if(p.length===3&&p[0].length===4){
    const yr=+p[0],now=TODAY.getFullYear();
    return `${p[2]}/${p[1]}`+(yr!==now?`/${String(yr).slice(2)}`:'');
  }
  const x=new Date(d);if(isNaN(x))return'—';
  const dd=String(x.getDate()).padStart(2,'0'),mm=String(x.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}`+(x.getFullYear()!==TODAY.getFullYear()?`/${String(x.getFullYear()).slice(2)}`:'');
}
function toast(m,k){const t=$('lav3Toast');t.innerHTML=esc(m);t.className='on '+(k||'');clearTimeout(window._tt);window._tt=setTimeout(()=>t.className='',2600);}
/* ── undo: snapshot before anything destructive, offer 6s to take it back ── */
let _undoState=null;
function snap(){_undoState=JSON.stringify(D);}
function toastUndo(m,k){
  const t=$('lav3Toast');
  t.innerHTML=`<span>${esc(m)}</span><button class="tundo" onclick="LV3.doUndo()">Undo</button>`;
  t.className='on '+(k||'');
  clearTimeout(window._tt);window._tt=setTimeout(()=>{t.className='';_undoState=null;},6000);
}
function doUndo(){
  if(!_undoState){toast('Nothing to undo','er');return;}
  D=JSON.parse(_undoState);_undoState=null;
  cm('lav3Ov1');cm('lav3Ov2');render();toast('Undone','ok');
}
function om(id){const e=$(id);if(e){e.classList.add('on');e.classList.add('open');}}
function cm(id){const e=$(id);if(e){e.classList.remove('on');e.classList.remove('open');}}
function logIt(k,txt){D.log.unshift({t:new Date().toISOString(),k,txt,who:(window.currentUserName||'someone')});
  if(D.log.length>4000)D.log.length=4000;saveState();}

/* stock of a component or a product's own layers */
/* Which date decides "oldest". Sorting on the ORDER date meant an Alibaba order
   placed 60 days ago was consumed before a Temu order placed 40 days ago, even
   though the Temu one physically landed months earlier — so the wrong price went
   out on the units. Arrival date is the honest answer and is now the default;
   Settings can put it back to order date for anyone who wants the old behaviour. */
const layerWhen=l=>((D.settings.fifoBy==='order')?(l.date||'')
  :(l.recvOn||l.arrivedOn||l.date||''));
/* An order that closed across several deliveries leaves a 0-qty shell holding
   the receipt history. It is arrived, but it is not a batch — showing it puts
   an empty "0 left" row in every batch list. */
/* A closed multi-delivery order leaves a 0/0 shell holding the receipt
   history. It belongs in the timeline and NOWHERE else — as a batch it is an
   empty row, and as an order it is finished. */
const isShell=l=>!!(l.closed&&!l.qty);
const realLayers=o=>(o.layers||[]).filter(l=>!isShell(l));
const arrLayers=o=>(o.layers||[]).filter(l=>l.arr&&!isShell(l))
  .sort((a,b)=>String(layerWhen(a)).localeCompare(String(layerWhen(b)))
             ||String(a.date||'').localeCompare(String(b.date||'')));
const onHand=o=>arrLayers(o).reduce((s,l)=>s+l.rem,0);
const onOrder=o=>(o.layers||[]).filter(l=>!l.arr&&!l.writtenOff).reduce((s,l)=>s+l.qty,0);
const nextIn=o=>{const p=(o.layers||[]).filter(l=>!l.arr).sort((a,b)=>a.date.localeCompare(b.date))[0];return p||null;};
function avgCost(o){const ls=arrLayers(o).filter(l=>l.rem>0);const u=ls.reduce((s,l)=>s+l.rem,0);
  if(!u){const all=(o.layers||[]);return all.length?all[all.length-1].cost:0;}
  return ls.reduce((s,l)=>s+l.rem*l.cost,0)/u;}

/* FIFO — returns the exact layers a quantity would consume, oldest first */
function fifo(o,qty){
  const out=[];let need=qty;let unpriced=0;
  for(const l of arrLayers(o)){
    if(need<=0)break;
    if(l.rem<=0)continue;
    const take=Math.min(l.rem,need);
    if(!(l.cost>0))unpriced+=take;      // booked in with no price — not the same as free
    out.push({layer:l,take,cost:l.cost});need-=take;
  }
  return{parts:out,short:need,got:qty-need,unpriced,value:out.reduce((s,x)=>s+x.take*x.cost,0)};
}

/* ── ONE SHIPMENT, ONE COG ────────────────────────────────────────────────
   Blending two purchase prices into one average makes every figure downstream
   an approximation. So a shipment must draw from a single price. Layers that
   happen to have cost the same are treated as one run — it is the price that
   matters, not how many delivery lines it arrived on.
   Oldest run always goes first. Packaging is ignored here: it never counts
   toward COG, so its price can change without making the shipment "mixed". */
function priceRuns(o){
  const runs=[];
  for(const l of arrLayers(o)){
    if(l.rem<=0)continue;
    const last=runs[runs.length-1];
    if(last&&Math.abs(last.cost-l.cost)<0.0001){last.qty+=l.rem;last.lines++;}
    else runs.push({cost:l.cost,qty:l.rem,date:l.date,sup:l.sup||'',oid:l.oid||'',lines:1});
  }
  return runs;
}
/* What a unit will cost once the stock at today's price is gone. Stock is
   eaten oldest-batch-first, so the next price is already known — it is sitting
   in the next price run. Worth seeing before it lands in the margin. */
/* What the "Add Lavarion to shipment" picker needs, in one call. The modal
   lives in the main app and the products live in here, so it had nothing to
   work from — which is why its COG box sat at 0.00 and had to be typed by
   hand every time. */
function lavShipList(){
  return (D.products||[]).filter(x=>!x.archived).map(x=>{
    const av=avail(x)||{};
    let per=null;try{const c=cogOf(x,1);per=(c&&c.per)||null;}catch(e){}
    return{asin:x.asin||'',sku:x.sku||'',name:x.name||'',
      available:(av.n==null?null:av.n),kind:av.kind||'',cog:per};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
function lavShipInfo(asin,units){
  const key=String(asin||'').toLowerCase();
  const x=(D.products||[]).find(y=>String(y.asin||'').toLowerCase()===key);
  if(!x)return null;
  const av=avail(x)||{};
  /* Cost the REAL quantity. Oldest stock goes first, so five units can straddle
     two purchase prices — one unit's cost times five would be the wrong number,
     and it is the number that gets stamped on the shipment forever. */
  const n=Math.max(1,parseInt(units)||1);
  /* blocked entries are {o,need,have,short} — the name is on .o, and mapping
     b.name over them is what printed "[object Object]" in the modal. The
     quantities travel with it now: the modal has to say need 28 / have 24, not
     just "something is short". */
  let per=null,blocked=[],unpriced=[],mixed=false,cleanMax=null,nextPer=null;
  try{const c=cogOf(x,n);
    per=(c&&c.per)||null;
    blocked=((c&&c.blocked)||[]).map(b=>({name:(b&&b.o&&b.o.name)||'',need:b.need||0,have:b.have||0,short:b.short||0}));
    unpriced=((c&&c.unpriced)||[]).map(u=>({name:(u&&u.name)||'',units:u.units||0}));
    try{const chk=cogCheck(x,n);
      mixed=!!(chk&&chk.mixed&&chk.mixed.length);
      /* how many can go at ONE price before the next purchase run starts —
         the app's own "one shipment, one COG" rule, finally visible */
      cleanMax=(chk&&chk.cleanMax!=null)?chk.cleanMax:null;
    }catch(e){}
    /* what a unit costs once today's price run is gone */
    try{const nx=nextCog(x);if(nx&&nx.next!=null)nextPer=nx.next;}catch(e){}
  }catch(e){}
  /* the cost of only what can actually be built — so a short line can still
     show a real figure for the part that is covered */
  let coveredPer=null,coveredN=null;
  try{
    const canDo=(av.n==null)?null:Math.min(n,av.n);
    if(canDo&&canDo>0&&canDo<n){const c2=cogOf(x,canDo);if(c2&&c2.per)  {coveredPer=c2.per;coveredN=canDo;}}
  }catch(e){}
  return{asin:x.asin||'',sku:x.sku||'',name:x.name||'',
    available:(av.n==null?null:av.n),kind:av.kind||'',cog:per,blocked,unpriced,mixed,
    cleanMax,nextPer,coveredPer,coveredN,limiter:av.limiter||null};
}
/* A quantity that straddles two purchase prices gets one blended figure today
   and nobody is told it happened. This is the honest alternative: two lines,
   each at the price it was actually bought at. The person chooses. */
function lavShipSplit(asin,units){
  const x=(D.products||[]).find(y=>String(y.asin||'').toLowerCase()===String(asin||'').toLowerCase());
  if(!x)return null;
  const n=Math.max(1,parseInt(units)||1);
  let chk=null;try{chk=cogCheck(x,n);}catch(e){return null;}
  if(!chk||!chk.mixed||!chk.mixed.length)return null;
  const first=Math.max(0,Math.min(n,chk.cleanMax||0));
  const rest=n-first;
  if(first<=0||rest<=0)return null;
  let aPer=null,bPer=null;
  try{const a=cogOf(x,first);aPer=(a&&a.per)||null;}catch(e){}
  try{const nx=nextCog(x);bPer=(nx&&nx.next!=null)?nx.next:null;}catch(e){}
  return{first:{units:first,per:aPer},rest:{units:rest,per:bPer}};
}
function nextCog(p){
  const items=[];
  if(p.type!=='bundle')items.push({o:p,per:1});
  else (p.recipe||[]).forEach(r=>{const c=comp(r.c);
    if(!c||c.untracked||c.kind==='packaging')return;      // packaging is never costed
    items.push({o:c,per:r.q});});
  if(!items.length)return null;
  let now=0,next=0,changed=false;const changes=[];
  for(const it of items){
    const runs=priceRuns(it.o);
    if(!runs.length)return null;                          // nothing priced — no honest answer
    const a=runs[0].cost,b=runs.length>1?runs[1].cost:runs[0].cost;
    now+=a*it.per;next+=b*it.per;
    if(runs.length>1&&Math.abs(a-b)>0.0001){changed=true;
      changes.push({name:it.o.name,from:a,to:b,left:runs[0].qty,per:it.per});}
  }
  if(!changed)return null;                                // the price is not going anywhere
  return{now,next,diff:next-now,after:cogCheck(p,1).cleanMax,changes};
}
/* What can go out at a single price, and what would be mixed if we sent `units`. */
function cogCheck(p,units){
  const items=[];
  if(p.type!=='bundle')items.push({o:p,per:1,name:p.name,isComp:false});
  else p.recipe.forEach(r=>{const c=comp(r.c);
    if(!c||c.untracked||c.kind==='packaging')return;   // packaging never affects COG
    items.push({o:c,per:r.q,name:c.name,isComp:true});});
  let cleanMax=Infinity;const mixed=[];
  items.forEach(it=>{
    const runs=priceRuns(it.o),first=runs[0];
    const canClean=first?Math.floor(first.qty/it.per):0;
    if(canClean<cleanMax)cleanMax=canClean;
    const need=it.per*units;
    if(first&&runs.length>1&&need>first.qty)
      mixed.push({...it,need,runs,atFirst:first.qty,canClean});
  });
  return{mixed,cleanMax:items.length?(cleanMax===Infinity?0:cleanMax):units,items};
}

/* availability: bundles are limited by components, everything else by own stock */
function avail(p){
  if(p.type!=='bundle'){return{n:onHand(p),kind:'stock',limiter:null};}
  if(!p.recipe.length)return{n:null,kind:'norecipe',limiter:null};
  let m=Infinity,lim=null;
  for(const r of p.recipe){const c=comp(r.c);if(!c){return{n:0,kind:'broken',limiter:null};}
    if(c.untracked)continue;                      // not stock-controlled — can never block
    const can=Math.floor(onHand(c)/r.q);if(can<m){m=can;lim=c.id;}}
  return{n:m===Infinity?0:m,kind:'build',limiter:lim};
}

/* COG of N units, FIFO, per component. Never mutates. */
function cogOf(p,units){
  /* packaging is deducted from stock and can block a build, but never counts toward COG */
  const lines=[];let total=0,blocked=[];
  if(p.type!=='bundle'){
    const f=fifo(p,units);
    lines.push({name:p.name,q:1,need:units,parts:f.parts,short:f.short,unpriced:f.unpriced,value:f.value});
    total=f.value;if(f.short>0)blocked.push({o:p,need:units,have:units-f.short,short:f.short});
  }else{
    for(const r of p.recipe){
      const c=comp(r.c);if(!c)continue;
      if(c.untracked)continue;                   // no stock, no cost, no block
      const need=r.q*units;const f=fifo(c,need);const isPack=c.kind==='packaging';
      lines.push({name:c.name,kind:c.kind,pack:isPack,q:r.q,need,parts:f.parts,short:f.short,unpriced:isPack?0:f.unpriced,value:f.value,cid:c.id});
      if(!isPack)total+=f.value;
      if(f.short>0)blocked.push({o:c,need,have:need-f.short,short:f.short});
    }
  }
  /* A COG built from parts you do not have is a fiction. Always Size 2 needs
     two Always Ultra and only one is on the shelf — costing it off that one
     gave £2.63 for a unit that cannot be made. If anything is short, there is
     no cost to show. */
  /* A batch booked in without a price used to be costed at £0, so COG came out
     confidently too low with nothing to say it was wrong. No price is missing
     information, not free stock — it blocks exactly like a missing part.
     Packaging is exempt: £0 there is correct, it is a business expense. */
  const unpriced=lines.filter(l=>!l.pack&&l.unpriced>0).map(l=>({name:l.name,units:l.unpriced,cid:l.cid}));
  const short=blocked.length>0||unpriced.length>0;
  return{lines,total,per:(short||!units)?0:total/units,blocked,unpriced,short,
    noPrice:unpriced.length>0,
    batches:lines.filter(l=>!l.pack).reduce((s,l)=>s+l.parts.length,0)};
}

/* Amazon sales aren't in this app — it only knows what we SENT. So the sold
   figure is typed in per ASIN and kept in settings, and everything that used
   to key off "shipped 30d" now prefers it when it's there.
   60-day target = twice the 30-day sale rate: what should be sitting at Amazon. */
/* Units sitting at Amazon right now. Counted by hand off Seller Central every
   week or two and pasted in as a batch — see openAtAmz. Kept beside the sold
   figure because the two are read together: what is there, and how fast it goes. */
/* ── STOCK AT AMAZON ─────────────────────────────────────────────────────────
   Twenty-nine boxes typed one at a time is how a figure ends up half filled in
   and three weeks old. One paste, straight out of Seller Central, everything
   stamped with today's date — and it says up front what it matched and what it
   could not, because a silent miss is worse than no figure at all. */
let _amzRows=[];
/* Put a part straight into a product's build list without hunting for the
   product first — the question is nearly always "what is this for". */
function openUseIn(cid){
  const c=comp(cid);if(!c)return;
  const used=usedIn(cid);
  const opts=D.products.filter(x=>x.type==='bundle'&&!x.archived&&!used.some(u=>u.id===x.id));
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>Use ${esc(c.name)} in a product</h3>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      ${used.length?`<div class="dsec"><span class="lab">Already in ${used.length} product${used.length===1?'':'s'}</span></div>
        <div class="uiList">${used.map(u=>`<span class="chip">${esc(u.name)}</span>`).join('')}</div>`:''}
      ${opts.length?`<div class="frow" style="margin-top:11px"><span class="lab">Add it to</span>
        <select class="in" id="uiProd">${opts.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="frow"><span class="lab">How many in one finished unit</span>
        <input class="in num" id="uiQty" type="number" min="1" value="1" style="width:96px;text-align:center"></div>
      <div class="note info">This only changes what the product is made of from now on. Past shipments keep the cost they were sent at.</div>`
      :`<div class="pmeta" style="padding:6px 2px">Every bundle already uses this part.</div>`}
    </div>
    <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
      ${opts.length?`<button class="btn pri" onclick="LV3.saveUseIn('${cid}')">Add to build list</button>`:''}</div></div>`;
  om('lav3Ov2');
}
function saveUseIn(cid){
  const pid=($('uiProd')||{}).value, q=Math.max(1,parseInt(($('uiQty')||{}).value)||1);
  const p=prod(pid),c=comp(cid);
  if(!p||!c){toast('Pick a product','er');return;}
  snap();
  p.recipe=p.recipe||[];
  const ex=p.recipe.find(r=>String(r.c)===String(cid));
  if(ex)ex.q=q; else p.recipe.push({c:cid,q});
  saveLavAsin&&0;
  save();logIt('edit',`${c.name} added to ${p.name} (×${q})`);
  cm('lav3Ov2');render();
  toastUndo(`${esc(c.name)} added to ${esc(p.name)}`,'ok');
}
let _amzMode='grid';
function amzMode(m){_amzMode=m;openAtAmz(true);}
/* A count is true at the moment it was READ off Seller Central, which is not
   the moment the Save button gets pressed — 29 ASINs takes a while and things
   sell in between. So the count carries its own date and time, it defaults to
   now, and it can be corrected. */
const localDT=d=>`${localDay(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
let _amzWhen='';
function amzWhen(v){_amzWhen=v||'';}
function whenTxt(iso,short){
  if(!iso)return '';
  const s=String(iso);
  const d=new Date(s.length>10?s:s+'T00:00:00');
  if(isNaN(d.getTime()))return s.slice(0,10);
  const day=`${d.getDate()} ${MONTHNM[d.getMonth()]}`;
  if(s.length<=10)return day;                      // an older count, date only
  const hm=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return short?hm:`${day} ${hm}`;
}
const SAS_DEFAULT='https://sas.selleramp.com/sas/lookup?search_term={ASIN}&asin={ASIN}';
/* every {ASIN}, not just the first — SAS wants it twice */
const sasUrl=asin=>String(D.settings.sasUrl||SAS_DEFAULT).split('{ASIN}').join(encodeURIComponent(asin||''));
function openAtAmz(keepWhen){
  _amzRows=[];
  if(!keepWhen||!_amzWhen)_amzWhen=localDT(new Date());
  /* Jack, 3 Sep: "can this popup be sorted from highest sales to lowest." A-Z
     put 151 Filler Wall Repair Kit above everything that actually sells, so the
     count started on the things that matter least. Anything with no sales
     figure sits at the bottom, still in name order. */
  const live=D.products.filter(x=>!x.archived&&x.asin)
    .sort((a,b)=>{const sa=sold30(a),sb=sold30(b);
      const na=(sa==null||!(sa>0)),nb=(sb==null||!(sb>0));
      if(na!==nb)return na?1:-1;
      if(!na&&sb!==sa)return sb-sa;
      return a.name.localeCompare(b.name);});
  $('lav3Mod2').className='mod xl';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>Stock at Amazon</h3>
      <span class="pmeta" style="margin:0">${fmt(live.length)} ASINs</span>
      <div class="segs" style="margin-left:auto">
        <button class="seg ${_amzMode==='grid'?'on':''}" onclick="LV3.amzMode('grid')">One by one</button>
        <button class="seg ${_amzMode==='paste'?'on':''}" onclick="LV3.amzMode('paste')">Paste a list</button>
      </div>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      <div class="amzWhen">
        <span class="k">Counted at</span>
        <input class="in" type="datetime-local" id="amzWhenIn" value="${esc(_amzWhen)}"
          onchange="LV3.amzWhen(this.value)">
        <button class="btn sm" onclick="LV3.amzWhen('${esc(localDT(new Date()))}');document.getElementById('amzWhenIn').value='${esc(localDT(new Date()))}'">Now</button>
        <span class="pmeta" style="margin:0">These counts are stamped with this time, not the time you press Save.
          If you read them off Seller Central earlier, set it back — otherwise everything downstream thinks the numbers are fresher than they are.</span>
      </div>
    ${_amzMode==='grid'?`
      <div class="amzHelp">Open <b>SAS</b> next to an ASIN and copy both numbers it shows —
        <b>Your Available Stock</b> and <b>Stock Inbound</b> — then press <b>Tab</b> to move on.
        Leave anything you don't check blank; blank is left exactly as it was, it is not a zero.
        <div style="margin-top:6px">Inbound counts toward the ${D.settings.targetDays||60}-day target but is kept separate,
        because <b>3 available with 70 inbound is not the same as 73 available</b> — the first is out of stock today.</div></div>
      <div class="amzGrid two">
        <div class="amzHead"><span>Product</span><span>ASIN</span><span>Last count</span><span>Available</span><span>Inbound</span><span></span></div>
        ${live.map((x,i)=>{const was=atAmz(x),wasIn=amzIn(x),age=atAmzAge(x),sent=sentSince(x);
          return `<div class="amzRow" id="amzRow-${i}">
            <span class="amzNm">${esc(x.name)}
              ${sent.units?`<span class="amzSent" title="We have sent this much since the last count — it should be showing as inbound, or already checked in">we sent ${fmt(sent.units)}</span>`:''}</span>
            <span class="amzAsin mono">${asinBtn(x.asin)}</span>
            <span class="amzWas">${was==null?'<span class="dim">never</span>'
              :`${fmt(was)}${wasIn?` <span style="color:var(--blu)">+${fmt(wasIn)}</span>`:''}<span class="amzAge">${esc(whenTxt((D.settings.atAmzAt||{})[x.asin]))||(age===0?'today':age+'d')}</span>`}</span>
            <input class="in num amzQ" type="number" min="0" inputmode="numeric" data-i="${i}" data-asin="${esc(x.asin)}"
              placeholder="—" oninput="LV3.amzGridSum()"
              onkeydown="if(event.key==='Enter'){event.preventDefault();const n=document.querySelector('.amzI[data-i=&quot;${i}&quot;]');if(n){n.focus();n.select();}}">
            <input class="in num amzI" type="number" min="0" inputmode="numeric" data-i="${i}" data-asin="${esc(x.asin)}"
              placeholder="—" oninput="LV3.amzGridSum()"
              onkeydown="if(event.key==='Enter'){event.preventDefault();const n=document.querySelector('.amzQ[data-i=&quot;${i+1}&quot;]');if(n){n.focus();n.select();}}">
            <a class="btn sm amzSas" href="${sasUrl(x.asin)}" target="_blank" rel="noopener"
              title="Open this ASIN in SAS">SAS ↗</a>
          </div>`;}).join('')}
      </div>`
    :`<div class="pasteWrap">
        <div class="pasteSide">
          <div class="lab">How</div>
          <ol class="pasteSteps">
            <li>Seller Central → <b>Inventory</b></li>
            <li>Show the <b>Available</b> and <b>Inbound</b> columns</li>
            <li>Copy the rows and paste them in</li>
          </ol>
          <div class="pmeta">This is the quick way — one paste does all ${fmt(live.length)} instead of ${fmt(live.length)} SAS lookups.
            Any order, any separator. It finds the ASIN or SKU on each line, takes the <b>first number as available</b>
            and a <b>second number, if there is one, as inbound</b>. Lines it cannot place are listed back to you
            rather than dropped.</div>
        </div>
        <div class="pasteMain">
          <textarea id="amzIn" class="in pasteBox" spellcheck="false"
            placeholder="B0DW5HPRWB   90&#10;B0DW4Y68XZ, 42&#10;LAV-WED30 8"
            oninput="LV3.amzParse(this.value)"></textarea>
          <div id="amzOut" class="pasteOut"></div>
        </div>
      </div>`}
    </div>
    <div class="mf"><span id="amzSum" class="pmeta" style="margin:0">Nothing entered yet</span>
      <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
      <button class="btn pri" id="amzGo" disabled onclick="LV3.amzSave()">Save counts</button></div></div>`;
  om('lav3Ov2');
  setTimeout(()=>{const t=document.getElementById(_amzMode==='grid'?'':'amzIn');
    const first=document.querySelector('.amzQ');
    if(_amzMode==='grid'&&first)first.focus(); else if(t)t.focus();},60);
  if(_amzMode==='grid')amzGridSum();
}
/* the grid builds the same _amzRows the paste box does, so Save is one path */
function amzGridSum(){
  const byAsin={};
  D.products.forEach(x=>{if(x.asin)byAsin[String(x.asin).toUpperCase()]=x;});
  _amzRows=[];
  const inbBy={};
  document.querySelectorAll('.amzI').forEach(el=>{
    const v=el.value.trim();if(v==='')return;
    const n=parseInt(v,10);if(n>=0)inbBy[el.dataset.i]=n;
  });
  document.querySelectorAll('.amzQ').forEach(el=>{
    const v=el.value.trim();
    const row=el.closest('.amzRow');
    const inb=inbBy[el.dataset.i];
    if(row)row.classList.toggle('done',v!==''||inb!=null);
    const p=byAsin[String(el.dataset.asin||'').toUpperCase()];
    if(!p)return;
    const n=v===''?null:parseInt(v,10);
    /* either number on its own is worth saving — inbound can change without
       the available count moving at all */
    if(n==null&&inb==null)return;
    if(n!=null&&!(n>=0))return;
    _amzRows.push({p,qty:n,inb:inb==null?null:inb,line:p.asin+' '+(n==null?'—':n)});
  });
  const sum=$('amzSum');
  const uAv=_amzRows.reduce((t,r)=>t+(r.qty||0),0),uIn=_amzRows.reduce((t,r)=>t+(r.inb||0),0);
  if(sum)sum.innerHTML=_amzRows.length
    ? `<b style="color:var(--grn)">${fmt(_amzRows.length)}</b> counted · ${fmt(uAv)} available${uIn?` · <span style="color:var(--blu)">${fmt(uIn)} inbound</span>`:''} · the rest are left as they were`
    : 'Nothing entered yet';
  const go=$('amzGo');if(go){go.disabled=!_amzRows.length;go.style.opacity=_amzRows.length?'1':'.45';}
}
/* paste mode — same _amzRows, same Save path as the grid */
function amzParse(txt){
  const live=D.products.filter(x=>!x.archived);
  const byAsin={},bySku={};
  live.forEach(x=>{if(x.asin)byAsin[String(x.asin).toUpperCase()]=x;
    if(x.sku)bySku[String(x.sku).toUpperCase()]=x;});
  const seen={};
  _amzRows=String(txt||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(line=>{
    const up=line.toUpperCase();
    let hit=null,at=-1;
    (up.match(/[A-Z0-9][A-Z0-9\-_.]{4,}/g)||[]).forEach(tok=>{
      if(hit)return;
      const pr=byAsin[tok]||bySku[tok];
      if(pr){hit=pr;at=up.indexOf(tok)+tok.length;}});
    if(!hit)return{line,err:'no ASIN or SKU on this line'};
    /* Seller Central's inventory export puts Available and Inbound side by
       side, so a paste can fill both at once — which is what turns the weekly
       job from 29 SAS lookups into one copy. First number is available; a
       second, if there is one, is inbound. */
    const rest=line.slice(at);
    const nums=(rest.match(/-?\d[\d,]*/g)||[]).map(x=>parseInt(String(x).replace(/,/g,''),10)).filter(n=>n>=0);
    if(!nums.length)return{line,err:'no number after '+(hit.asin||hit.sku)};
    const qty=nums[0];
    const inb=nums.length>1?nums[1]:null;
    if(!(qty>=0))return{line,err:'that number does not read as units'};
    if(seen[hit.id])return{line,err:hit.name+' is on more than one line'};
    seen[hit.id]=1;
    return{line,p:hit,qty,inb};});
  const ok=_amzRows.filter(r=>r.p),bad=_amzRows.filter(r=>!r.p);
  const missing=live.filter(x=>!seen[x.id]);
  const out=$('amzOut');
  if(out)out.innerHTML=!_amzRows.length?'':`
    ${ok.length?`<div class="pasteGrp ok"><b>${fmt(ok.length)} matched</b>
      <div class="pasteList">${ok.map(r=>{const was=atAmz(r.p);const d=was==null?null:r.qty-was;
        return `<div class="pasteRow"><span class="pn">${esc(r.p.name)}</span>
          <span class="pq">${fmt(r.qty)}${r.inb?` <span style="color:var(--blu);font-size:11px">+${fmt(r.inb)}</span>`:''}</span>
          <span class="pd">${was==null?'first count':d===0?'no change':`${d>0?'+':''}${fmt(d)}`}</span></div>`;}).join('')}</div></div>`:''}
    ${bad.length?`<div class="pasteGrp bad"><b>${fmt(bad.length)} could not be placed</b>
      <div class="pasteList">${bad.map(r=>`<div class="pasteRow"><span class="pn">${esc(r.line.slice(0,60))}</span>
        <span class="pd" style="color:var(--red)">${esc(r.err)}</span></div>`).join('')}</div></div>`:''}
    ${missing.length?`<div class="pasteGrp warn"><b>${fmt(missing.length)} not in this paste</b>
      <div class="pmeta" style="margin:6px 0 0">Their last count is left exactly as it was — nothing is zeroed.</div></div>`:''}`;
  const sum=$('amzSum');
  if(sum)sum.innerHTML=ok.length
    ? `<b style="color:var(--grn)">${fmt(ok.length)}</b> to save · ${fmt(ok.reduce((t,r)=>t+r.qty,0))} units${bad.length?` · <b style="color:var(--red)">${fmt(bad.length)} skipped</b>`:''}`
    : (_amzRows.length?'<span style="color:var(--red)">Nothing on those lines matched a product</span>':'Nothing entered yet');
  const go=$('amzGo');if(go){go.disabled=!ok.length;go.style.opacity=ok.length?'1':'.45';}
}
function amzSave(){
  const ok=_amzRows.filter(r=>r.p);
  if(!ok.length){toast('Nothing to save','er');return;}
  snap();
  D.settings.atAmz=D.settings.atAmz||{};
  D.settings.atAmzAt=D.settings.atAmzAt||{};
  /* the time the count was TAKEN, which the person can correct — not save-time */
  const when=_amzWhen||localDT(new Date());
  D.settings.atAmzIn=D.settings.atAmzIn||{};
  ok.forEach(r=>{
    if(r.qty!=null)D.settings.atAmz[r.p.asin]=r.qty;
    if(r.inb!=null)D.settings.atAmzIn[r.p.asin]=r.inb;
    D.settings.atAmzAt[r.p.asin]=when;});
  savePrefs();save();
  const uIn=ok.reduce((t,r)=>t+(r.inb||0),0);
  logIt('edit',`Stock at Amazon counted ${whenTxt(when)} — ${ok.length} product${ok.length===1?'':'s'}, ${ok.reduce((t,r)=>t+(r.qty||0),0)} available${uIn?`, ${uIn} inbound`:''}`);
  cm('lav3Ov2');render();
  toastUndo(`${fmt(ok.length)} count${ok.length===1?'':'s'} saved`,'ok');
}
/* What to send and what to buy for one product, in one place — the number on the
   target column is only useful if you can act on it. */
function openOrderPlan(pid){
  const p=prod(pid);if(!p)return;
  const t=target60(p)||0, at=atAmz(p), inb=amzIn(p), have=avail(p).n||0;
  const cover=(at||0)+(inb||0)+have, gap=Math.max(0,t-cover);
  const canSend=Math.min(have,gap||have);
  const stillShort=Math.max(0,gap-have);
  const cg=cogOf(p,1);
  const need=[];
  if(p.type==='bundle'&&stillShort>0){
    (p.recipe||[]).forEach(r=>{const c=comp(r.c);if(!c||c.untracked)return;
      const wanted=r.q*stillShort, hold=onHand(c), coming=onOrder(c);
      const buy=Math.max(0,wanted-hold-coming);
      need.push({c,wanted,hold,coming,buy});});
  }
  const row=(k,v,sub,col)=>`<div class="opRow"><span class="opK">${k}</span>
    <span class="opV" ${col?`style="color:${col}"`:''}>${v}</span>${sub?`<span class="opS">${sub}</span>`:''}</div>`;
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>${esc(p.name)}</h3>
      <span class="pmeta" style="margin:0">${D.settings.targetDays||60}-day plan</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      ${sold30(p)==null?`<div class="note bad" style="margin:0 0 11px"><b>No sales figure for this one.</b>
        The BDL hub's monthly report has no units against ${esc(p.asin||'this ASIN')}, so everything below is worked back from what you have
        sent rather than what actually sold — treat it as a rough shape.
        <button class="btn sm warn" style="margin-top:7px" onclick="LV3.cm('lav3Ov2');LV3.openHubReview()">Sort the sales link</button></div>`:''}
      <div class="opBox">
        ${row('Target for '+(D.settings.targetDays||60)+' days',fmt(t),sold30(p)!=null?`${fmt(sold30(p))} sold in ${ymName(hubMonth().ym)}`:'estimated')}
        ${row('Sellable at Amazon',at==null?'never counted':fmt(at),atAmzAge(p)!=null?`counted ${whenTxt((D.settings.atAmzAt||{})[p.asin])||atAmzAge(p)+'d ago'}`:'',at==null?'var(--text3)':(amzDry(p)?'var(--amb)':atAmzAge(p)>=14?'var(--amb)':''))}
        ${inb?row('Inbound to Amazon',fmt(inb),'sent, not checked in yet — counts toward the target','var(--blu)'):''}
        ${row('Backstock here',fmt(have),p.type==='bundle'?'buildable from parts':'on the shelf')}
        ${(()=>{const d=amzDry(p);return d?`<div class="note bad" style="margin:9px 0 0"><b>Out on the shelf${d.days>0?` in about ${d.days} day${d.days===1?'':'s'}`:' now'}.</b>
          Only ${fmt(d.have)} sellable at the current rate${d.coming?`, with ${fmt(d.coming)} inbound — the target is covered but the listing runs dry before it lands`:''}.</div>`:'';})()}
        ${row('Shortfall',gap?fmt(gap):'none',gap?'against the target':'covered',gap?'var(--amb)':'var(--grn)')}
      </div>
      <div class="opAct">
        ${gap?(have>0
          ? `<div class="opDo"><b>Send ${fmt(canSend)} now</b><span>you can build ${fmt(have)} today</span>
             <button class="btn go" onclick="LV3.cm('lav3Ov2');LV3.openShip('${p.id}')">Ship units</button></div>`
          : `<div class="opDo none"><b>Nothing to send</b><span>no backstock — it all has to be bought first</span></div>`)
        : `<div class="opDo ok"><b>Nothing to do</b><span>${fmt(cover)} against a target of ${fmt(t)}</span></div>`}
      </div>
      ${stillShort>0?`<div class="dsec"><span class="lab">To cover the other ${fmt(stillShort)} you need</span></div>
        ${need.length?`<table class="opTbl"><thead><tr><th class="l">Part</th><th>Per unit</th><th>Needed</th><th>Have</th><th>Coming</th><th>Buy</th></tr></thead><tbody>
        ${need.map(n=>`<tr class="${n.buy>0?'short':''}">
          <td class="l">${esc(n.c.name)}</td>
          <td class="mono">×${fmt(n.wanted/stillShort)}</td>
          <td class="mono">${fmt(n.wanted)}</td>
          <td class="mono" style="color:${n.hold?'var(--text)':'var(--red)'}">${fmt(n.hold)}</td>
          <td class="mono">${n.coming?fmt(n.coming):'—'}</td>
          <td class="mono b" style="color:${n.buy>0?'var(--amb)':'var(--grn)'}">${n.buy>0?fmt(n.buy):'enough'}</td></tr>`).join('')}
        </tbody></table>`:`<div class="pmeta" style="padding:4px 2px">No build list, so there is nothing to work out. Add one first.</div>`}`:''}
      ${cg.short?`<div class="note bad" style="margin:11px 0 0"><b>COG is unknown.</b>
        ${esc(cg.blocked.map(b=>b.name).slice(0,3).join(', '))}${cg.blocked.length>3?` +${cg.blocked.length-3} more`:''}
        ${cg.blocked.length===1?'has':'have'} no priced stock, so this cannot be costed until ${cg.blocked.length===1?'it turns':'they turn'} up.</div>`:''}
    </div>
    <div class="mf"><span class="pmeta" style="margin:0">${cg.short?'COG unavailable':`COG ${gbp(cg.per)} per unit`}</span>
      <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Close</button>
      <button class="btn" onclick="LV3.cm('lav3Ov2');LV3.openProduct('${p.id}')">Full detail</button></div></div>`;
  om('lav3Ov2');
}
function atAmz(p){const m=D.settings.atAmz||{};const v=m[p.asin];return (v===0||v)?v:null;}
/* Stock Inbound off the same SAS panel — units on their way to Amazon that are
   not yet sellable. Becki found the hole: the target counted the 3 sellable and
   ignored the 70 landing, so it asked for a reorder of stock already in flight.
   Kept as its OWN number, not folded into "at Amazon": 3 available + 70 inbound
   and 73 available are the same total and completely different problems — the
   first is out of stock right now. Merging them would have hidden that. */
function amzIn(p){const m=D.settings.atAmzIn||{};const v=m[p.asin];return (v===0||v)?v:null;}
/* everything Amazon has or is about to have */
const atAmzAll=p=>{const a=atAmz(p),i=amzIn(p);return (a==null&&i==null)?null:(a||0)+(i||0);};
/* What we have sent since the last count — the cross-check on the number typed
   in. If we shipped 70 and SAS shows nothing inbound, that shipment is worth
   chasing; the app already knows every shipment, so it can say so. */
function sentSince(p){
  const at=(D.settings.atAmzAt||{})[p.asin];
  const rows=(typeof lavShipments!=='undefined'?lavShipments:[]).filter(x=>x.asin===p.asin);
  if(!rows.length)return{n:0,units:0};
  const cut=at?String(at).slice(0,10):'';
  const after=rows.filter(x=>!cut||String(x.date||'').slice(0,10)>=cut);
  return{n:after.length,units:after.reduce((t,x)=>t+(x.units||0),0)};
}
/* Out on the shelf right now, whatever is on its way. This is the thing that
   merging the two numbers would have buried. */
function amzDry(p){
  const a=atAmz(p);if(a==null)return null;
  const s=sold30(p);if(s==null||!s)return null;
  const daysLeft=a/(s/30);
  if(daysLeft>=10)return null;
  return{days:Math.floor(daysLeft),have:a,coming:amzIn(p)||0};
}
function atAmzAge(p){const at=(D.settings.atAmzAt||{})[p.asin];return at?daysSince(at):null;}
/* ── WHEN FRESH STOCK HAS TO LEAVE ────────────────────────────────────────
   Amazon does not switch a shipment on the day it lands — it takes working
   days to be checked in and become Prime-eligible. So the useful date is not
   "when do we run out", it is "when does the box have to leave here", and that
   is a WORKING-day count backwards from the day the shelf goes empty.
   Counting in calendar days is the trap: ten calendar days back from a Monday
   is a Friday two weekends earlier, and the stock would have missed by four
   days without anything on screen looking wrong. */
const PRIME_MAX=60;
function primeDays(){const n=parseInt(D.settings.primeDays);return (n>0&&n<=PRIME_MAX)?n:10;}
const _isoOf=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function addCalDays(iso,n){const d=new Date(String(iso).slice(0,10)+'T00:00:00');d.setDate(d.getDate()+n);return _isoOf(d);}
function workDaysBefore(iso,n){
  const d=new Date(String(iso).slice(0,10)+'T00:00:00');
  let left=n,guard=0;
  while(left>0&&guard<600){d.setDate(d.getDate()-1);guard++;
    const w=d.getDay();if(w>=1&&w<=5)left--;}
  return _isoOf(d);
}
/* Working days from a to b. Negative when b is already behind us — which is
   the number that matters, because "4 working days late" is the whole point. */
function workDaysBetween(a,b){
  if(!a||!b)return 0;
  a=String(a).slice(0,10);b=String(b).slice(0,10);
  if(a===b)return 0;
  const sign=b<a?-1:1;
  const from=new Date((sign>0?a:b)+'T00:00:00'),to=new Date((sign>0?b:a)+'T00:00:00');
  let n=0,guard=0;
  while(from<to&&guard<3000){from.setDate(from.getDate()+1);guard++;
    const w=from.getDay();if(w>=1&&w<=5)n++;}
  return n*sign;
}
/* Null means "we genuinely do not know", never a guessed date. No count at
   Amazon and no sales figure are two different kinds of not knowing, and
   inventing a Tuesday for either is worse than an empty cell. */
function sendBy(p){
  const at=atAmz(p);            if(at==null)return null;
  const s=sold30(p);            if(s==null||s<=0)return null;
  const perDay=s/30;
  /* whatever is already on its way lands long before this runs out, so it
     counts — the same basis the target column uses */
  const cover=(at+(amzIn(p)||0))/perDay;
  const outOn=addCalDays(dayISO(),Math.floor(cover));
  const send=workDaysBefore(outOn,primeDays());
  return{send,outOn,cover:Math.floor(cover),left:workDaysBetween(dayISO(),send)};
}
/* one place decides the colour, so the cell, the sort and any banner agree */
/* Past this, printing a specific Monday is false precision: the whole date is
   projected from ONE month of sales, and two months out that rate will have
   moved. It still sorts by the real number — it just stops pretending. */
const SEND_FAR=40;
function sendState(sb){
  if(!sb)return{k:'none',col:'var(--text3)'};
  if(sb.left<0) return{k:'late',col:'var(--red)'};
  if(sb.left===0)return{k:'today',col:'var(--red)'};
  if(sb.left<=3) return{k:'soon',col:'var(--amb)'};
  if(sb.left<=10)return{k:'near',col:'var(--text)'};
  if(sb.left<=SEND_FAR)return{k:'ok',col:'var(--grn)'};
  return{k:'far',col:'var(--text3)'};
}
/* ═══════════════ SALES — READ FROM THE BDL HUB ═══════════════
   "Sold last month" is not typed in here and never should be. The Amazon
   numbers are reconciled once a month in the Ads & Monthly Report hub, and that
   is the only place they are worked out. This reads that hub's report directly.

   READ ONLY. Nothing here writes so much as a byte back to the hub — the same
   arrangement the hub already has pointing the other way at this app.

   The report is written up by hand around the 5th–6th of the month, so for the
   first week LAST month genuinely is not in there yet. That is normal and must
   not be dressed up as a fault. What must never happen is the other thing:
   quietly serving a two-month-old figure under a heading that says "last
   month". Every number on screen carries the month it belongs to. */
const HUB_SB={url:'https://ffbdazepqrsyurhouxif.supabase.co',
  key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmRhemVwcXJzeXVyaG91eGlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM5MjIsImV4cCI6MjA5MDQ2OTkyMn0.BAuodLUDGzO9A7IfoRRn0HZ1MgWOXNPeYKPDBNaNWeg'};
const HUB_CACHE='lv3_hub_sales';
const MONTHNM=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let HUB={state:'idle',months:{},order:[],at:null,err:'',cached:false};

async function hubGet(){
  const r=await fetch(HUB_SB.url+'/rest/v1/settings?id=eq.monthly_report_v1&select=value',
    {headers:{apikey:HUB_SB.key,Authorization:'Bearer '+HUB_SB.key}});
  if(!r.ok)throw new Error('the hub said '+r.status);
  const j=await r.json();
  const v=j&&j[0]&&j[0].value;
  const raw=typeof v==='string'?JSON.parse(v):v;
  if(!raw||!Array.isArray(raw.months))throw new Error('the monthly report is not in the shape this expects');
  return raw;
}
function hubIngest(raw,cached){
  const months={},order=[];
  (raw.months||[]).forEach(m=>{
    const ym=m.ym||m.id;if(!ym)return;
    const by={};
    (m.rows||[]).forEach(row=>{
      const a=String(row.asin||'').trim().toUpperCase();if(!a)return;
      /* units is total units sold. adUnits is only the PPC-attributed slice —
         never use that one here, it would undercount every product. */
      by[a]={units:(row.units===0||row.units)?row.units:null,name:row.name||''};
    });
    months[ym]={ym,label:m.label||ym,by,rows:(m.rows||[]).length};
    order.push(ym);
  });
  order.sort();
  HUB={state:order.length?'ok':'none',months,order,at:raw._at||null,err:'',cached:!!cached};
}
async function hubLoad(force){
  if(HUB.state==='loading')return HUB;
  if(HUB.state==='ok'&&!HUB.cached&&!force)return HUB;
  HUB.state='loading';
  try{
    const raw=await hubGet();
    raw._at=new Date().toISOString();
    hubIngest(raw,false);
    try{localStorage.setItem(HUB_CACHE,JSON.stringify(raw));}catch(e){}
  }catch(e){
    /* Being offline is not the same as selling nothing. Fall back to the last
       copy we saw and say plainly that it is a copy — showing nothing would
       empty every target on the page and read as a collapse in sales. */
    let used=false;
    try{const c=localStorage.getItem(HUB_CACHE);
      if(c){hubIngest(JSON.parse(c),true);used=true;}}catch(e2){}
    if(!used)HUB={state:'err',months:{},order:[],at:null,err:String(e.message||e),cached:false};
    else HUB.err=String(e.message||e);
  }
  return HUB;
}
function hubRefresh(){
  toast('Reading the hub…');
  hubLoad(true).then(()=>{
    const good=HUB.state==='ok'&&!HUB.cached;
    paint();
    toast(good?`Sales in — ${ymName(hubMonth().ym)}`:'Could not reach the hub',good?'ok':'er');
  });
}
const ymName=ym=>{if(!ym)return '—';const p=String(ym).split('-');
  return (MONTHNM[+p[1]-1]||p[1])+' '+p[0];};
/* Which month the page is actually showing, and whether it is the one we asked
   for. The status is the whole point: 'ok' we have last month; 'due' last month
   is not in yet but it is only the first week, which is expected; 'late' it
   should have been in by now. */
function hubMonth(){
  const want=lastFullMonth();
  if(HUB.state==='loading')return{ym:HUB.order[HUB.order.length-1]||null,want,status:'loading'};
  if(!HUB.order.length)return{ym:null,want,status:HUB.state==='err'?'off':'none'};
  if(HUB.months[want])return{ym:want,want,status:'ok'};
  return{ym:HUB.order[HUB.order.length-1],want,status:TODAY.getDate()<=7?'due':'late'};
}
/* Same product, a different ASIN on each system — a relist, or a parent/child
   split. Set by hand in the review. Never guessed: a wrong guess here puts one
   product's sales against another and every target downstream is wrong. */
const hubAsin=p=>((D.settings.hubMap||{})[p.asin])||p.asin;
const hubSkipped=p=>!!((D.settings.hubSkip||{})[p.asin]);
function hubUnits(p,ym){
  const m=HUB.months[ym||hubMonth().ym];if(!m)return null;
  const row=m.by[String(hubAsin(p)||'').toUpperCase()];
  if(!row)return null;
  return row.units;                     // may be null — in the report, but no figure
}
const hubHas=p=>HUB.order.some(ym=>!!HUB.months[ym].by[String(hubAsin(p)||'').toUpperCase()]);
/* every ASIN the hub has ever reported, with its newest figure — the pick list */
function hubAll(){
  const out={};
  HUB.order.forEach(ym=>{const M=HUB.months[ym];
    Object.keys(M.by).forEach(a=>{const r=M.by[a];
      if(!out[a])out[a]={asin:a,name:''};
      if(r.name)out[a].name=r.name;
      if(r.units===0||r.units)out[a].last={ym,n:r.units};});});
  return Object.values(out).sort((x,y)=>(x.name||x.asin).localeCompare(y.name||y.asin));
}

/* The hub is the source. Anything typed in before the two were joined up is
   kept as a fallback so no work is lost, but it can never override a real
   figure from the hub. */
function sold30(p){
  const h=hubUnits(p);
  if(h===0||h)return h;
  const m=D.settings.sold30||{};const v=m[p.asin];return (v===0||v)?v:null;
}
function soldSrc(p){
  const h=hubUnits(p);
  if(h===0||h)return 'hub';
  const m=D.settings.sold30||{};const v=m[p.asin];return (v===0||v)?'manual':null;
}
/* the month a figure describes — entered in August, it is July's number */
function lastFullMonth(d){
  const t=d?new Date(d):new Date(TODAY);
  const y=t.getFullYear(),m=t.getMonth();          // 0-based
  const pm=m===0?11:m-1, py=m===0?y-1:y;
  return `${py}-${String(pm+1).padStart(2,'0')}`;
}
function setSold30(asin,v){
  D.settings.sold30=D.settings.sold30||{};
  D.settings.sold30At=D.settings.sold30At||{};
  D.settings.soldHist=D.settings.soldHist||{};
  const n=parseInt(v);
  if(n>0||n===0){
    D.settings.sold30[asin]=n;D.settings.sold30At[asin]=dayISO();
    /* Keep every month, keyed by the month it describes. Holding one number
       meant "two months" could only ever be last month doubled — a projection
       dressed up as a total. Two real months make a real sum. */
    (D.settings.soldHist[asin]=D.settings.soldHist[asin]||{})[lastFullMonth()]=n;
  }
  else{delete D.settings.sold30[asin];delete D.settings.sold30At[asin];}
  savePrefs();render();
}
/* Last two full months added together — only when we genuinely have both.
   Returns {n, real} so the UI never has to guess whether it is a fact. */
function sold60(p){
  /* The hub carries every month back to January, so the moment it is connected
     two real months exist — no more doubling one month and calling it two.
     They must be the two CONSECUTIVE most recent months, not simply the last
     two the product happens to appear in: skipping a gap would add June to
     April and label it "two months". */
  const cur=hubMonth().ym;
  if(cur){
    const upto=HUB.order.filter(y=>y<=cur).slice(-2);
    if(upto.length===2){
      const a=hubUnits(p,upto[0]),b=hubUnits(p,upto[1]);
      if((a===0||a)&&(b===0||b))return{n:a+b,real:true,months:upto};
    }
  }
  const h=(D.settings.soldHist||{})[p.asin]||{};
  const keys=Object.keys(h).sort().slice(-2);
  if(keys.length>=2)return{n:h[keys[0]]+h[keys[1]],real:true,months:keys};
  const one=sold30(p);
  return one==null?{n:null,real:false,months:[]}:{n:one*2,real:false,months:keys};
}
/* ── what needs a human to look at it ──
   Deliberately no automatic matching. Two ASINs that look alike are not the
   same product, and a wrong link here feeds a wrong target into ordering. It
   lists what it found and waits. */
/* Why a product has no sales figure is usually already knowable from what this
   app holds: have we ever sent it in, is anything on order, was it only just
   set up. "Not selling yet" should be something you can see, not something you
   have to take on faith. */
function noSaleWhy(p){
  const sent=p.ship30||0,everSent=sent>0||!!p.lastSent;
  const onOrd=p.type==='bundle'
    ? (p.recipe||[]).reduce((t,r)=>{const c=comp(r.c);return t+(c?onOrder(c):0);},0)
    : onOrder(p);
  if(!everSent&&onOrd>0)return{k:'ordered',txt:`nothing sent in yet · ${fmt(onOrd)} on order`};
  if(!everSent)return{k:'new',txt:'never been sent in — nothing to sell yet'};
  if(everSent&&p.lastSent)return{k:'sent',txt:`we sent ${fmt(sent)} in · last on ${dshort(p.lastSent)}`};
  return{k:'sent',txt:`we sent ${fmt(sent)} in`};
}
function hubReview(){
  const live=D.products.filter(p=>!p.archived);
  const cur=hubMonth().ym;
  const missing=[],blank=[],ok=[],skipped=[];
  live.forEach(p=>{
    if(hubSkipped(p)){skipped.push(p);return;}
    if(!p.asin){missing.push({p,why:'no ASIN on this product'});return;}
    if(!hubHas(p)){missing.push({p,why:'not in the report at all'});return;}
    const u=hubUnits(p,cur);
    if(u===0||u)ok.push(p);
    else blank.push({p,why:'in the report, but no figure for '+ymName(cur)});
  });
  const known=new Set(live.map(p=>String(hubAsin(p)||'').toUpperCase()));
  const extra=hubAll().filter(h=>!known.has(h.asin));
  return{missing,blank,ok,skipped,extra,cur};
}
let _hbRows=[];
function openHubReview(){
  const rv=hubReview();
  _hbRows=rv.missing.concat(rv.blank).map(r=>({asin:r.p.asin,name:r.p.name,why:r.why,to:'',
    ev:noSaleWhy(r.p),blank:rv.blank.some(b=>b.p===r.p)}));
  const M=hubMonth();
  $('lav3Mod2').className='mod xl fit';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>Sales that need a look</h3>
      <span class="pmeta" style="margin:0">${ymName(M.ym)} · ${fmt(rv.ok.length)} product${rv.ok.length===1?'':'s'} already have a figure · nothing is saved until you press the button</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      <div class="amzHelp"><b>The ASIN is what joins the two apps.</b> The titles are written differently in each —
        that is fine and expected — but the ASIN is identical, so a product with no figure has almost always
        simply <b>not sold yet</b>. Mark it and it stops asking.
        <div style="margin-top:7px">The link below is for the rare case where the hub carries the same product under a
        <b>different ASIN</b> — a relist, or a parent/child split. <b>Match on the ASIN, never the name.</b>
        Two separate listings can read almost the same (“Gluten Free Biscuit &amp; Snack Hamper” and
        “Gluten Free Snack Bundle” are different products), and linking the wrong one puts one product's sales
        against another and every target after it is wrong.</div>
        <div style="margin-top:7px"><b>Nothing here changes the hub.</b> This app only ever reads it.</div></div>
      ${_hbRows.length?`<div class="fxList">
        ${_hbRows.map((r,i)=>`<div class="fxRow" id="hbRow-${i}">
          <div class="fxWhat">
            <span class="pname">${esc(r.name)}</span>
            <div class="pmeta mono">${asinBtn(r.asin)} · ${esc(r.why)}</div>
            <div class="hbWhy k-${r.ev.k}">${esc(r.ev.txt)}</div>
          </div>
          <div class="fxPick">
            <input class="in fxIn" id="hbIn-${i}" autocomplete="off" placeholder="Paste the hub's ASIN, or search by name…"
              oninput="LV3.hbFind(${i},this.value)" onfocus="LV3.hbFind(${i},this.value)">
            <div class="fxPop" id="hbPop-${i}"></div>
            <button class="btn sm" style="margin-top:6px" onclick="LV3.hbSkip(${i})">Not selling yet — stop asking</button>
          </div>
          <span class="fxState" id="hbState-${i}">${r.blank?'no figure':'not linked'}</span>
        </div>`).join('')}
      </div>`:`<div class="note good" style="margin:0">Every product has a sales figure for ${ymName(M.ym)}. Nothing to do.</div>`}
      ${rv.extra.length?`<div class="note info" style="margin-top:12px"><b>${fmt(rv.extra.length)} ASIN${rv.extra.length===1?'':'s'} in the hub ${rv.extra.length===1?'is':'are'} not on this page.</b>
        They sell on Amazon but nothing here is built for them — that is fine if they are not Lavarion.
        <div class="hbChips">${rv.extra.map(h=>
          `<span class="hbChip" title="${esc(h.asin)} — ${esc(h.name||'')}"><b class="hbAs">${esc(h.asin)}</b><i>${esc(h.name||'')}</i><b>${h.last?fmt(h.last.n):'—'}</b></span>`).join('')}</div></div>`:''}
      ${rv.skipped.length?`<div class="note" style="margin-top:12px"><b>${fmt(rv.skipped.length)} marked as not selling yet.</b>
        <div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px">${rv.skipped.map(p=>
          `<button class="btn sm" onclick="LV3.hbUnskip('${esc(p.asin)}')">${esc(p.name)} — start asking again</button>`).join('')}</div></div>`:''}
    </div>
    <div class="mf"><span class="pmeta" id="hbSum" style="margin:0">${fmt(_hbRows.length)} waiting</span>
      <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Close</button>
        <button class="btn pri" onclick="LV3.hbSaveAll()">Save the links</button></div></div>`;
  om('lav3Ov2');
}
function hbFind(i,v){
  const pop=document.getElementById('hbPop-'+i);if(!pop)return;
  const q=(v||'').toLowerCase().trim();
  const all=hubAll();
  const hits=(q?all.filter(h=>(h.name+' '+h.asin).toLowerCase().includes(q)):all).slice(0,40);
  /* The ASIN leads, not the name. Amazon titles are near-identical across
     genuinely different products — "Gluten Free Biscuit & Snack Hamper" and
     "Gluten Free Snack Bundle" are two separate listings — so a name is a way
     to FIND the row, never proof it is the right one. */
  pop.innerHTML=hits.length
    ? hits.map(h=>`<button type="button" class="alopt" onclick="LV3.hbPick(${i},'${esc(h.asin)}')">
        <span class="alnm"><b class="hbAs">${esc(h.asin)}</b>${esc(h.name||'')}</span>
        <span class="altag t-comp">${h.last?`${fmt(h.last.n)} · ${ymName(h.last.ym)}`:'no figure'}</span></button>`).join('')
    : `<div class="alnone">No ASIN in the hub matches “${esc(v)}”</div>`;
  pop.classList.add('on');
}
function hbPick(i,asin){
  const r=_hbRows[i];if(!r)return;
  r.to=asin;r.skip=false;
  const h=hubAll().find(x=>x.asin===asin);
  /* Show the ASIN it is actually linked to, not just the friendly name — the
     ASIN is the thing being saved and the thing worth double-checking. */
  const inp=document.getElementById('hbIn-'+i);if(inp)inp.value=asin+(h&&h.name?' — '+h.name:'');
  const pop=document.getElementById('hbPop-'+i);if(pop)pop.classList.remove('on');
  const st=document.getElementById('hbState-'+i);
  if(st){st.innerHTML=`→ <b class="hbAs">${esc(asin)}</b>`;st.className='fxState ok';}
  const row=document.getElementById('hbRow-'+i);if(row)row.classList.add('done');
  hbSum();
}
function hbSkip(i){
  const r=_hbRows[i];if(!r)return;
  r.skip=true;r.to='';
  const st=document.getElementById('hbState-'+i);
  if(st){st.textContent='not selling';st.className='fxState ok';}
  const row=document.getElementById('hbRow-'+i);if(row)row.classList.add('done');
  hbSum();
}
function hbSum(){
  const n=_hbRows.filter(r=>r.to||r.skip).length;
  const el=document.getElementById('hbSum');
  if(el)el.textContent=n?`${fmt(n)} ready · ${fmt(_hbRows.length-n)} still waiting`:`${fmt(_hbRows.length)} waiting`;
}
function hbUnskip(asin){
  if(D.settings.hubSkip)delete D.settings.hubSkip[asin];
  savePrefs();openHubReview();paint();
}
/* Two of our products pointed at ONE hub ASIN is the worst outcome this screen
   can produce: both read the same units, both get a target built on sales that
   only one of them made, and nothing on the page looks wrong. Caught here
   before it saves, and caught again in the health check for anything already
   set. */
function hubClashes(){
  const live=D.products.filter(p=>!p.archived&&p.asin&&!hubSkipped(p));
  const by={};
  live.forEach(p=>{const a=String(hubAsin(p)||'').toUpperCase();if(a)(by[a]=by[a]||[]).push(p);});
  return Object.keys(by)
    /* a shared raw ASIN is already reported by the duplicate-ASIN banner — this
       is only about links somebody set by hand */
    .filter(a=>by[a].length>1&&by[a].some(p=>(D.settings.hubMap||{})[p.asin]))
    .map(a=>({asin:a,list:by[a]}));
}
function hbSaveAll(){
  const ready=_hbRows.filter(r=>r.to||r.skip);
  if(!ready.length){toast('Nothing picked yet','er');return;}
  D.settings.hubMap=D.settings.hubMap||{};
  D.settings.hubSkip=D.settings.hubSkip||{};
  /* what each hub ASIN is already spoken for by, ignoring the rows being saved */
  const editing=new Set(ready.map(r=>r.asin));
  const taken={};
  D.products.filter(p=>!p.archived&&p.asin&&!editing.has(p.asin)&&!hubSkipped(p))
    .forEach(p=>{const a=String(hubAsin(p)||'').toUpperCase();if(a)taken[a]=p;});
  const clash=[];
  ready.filter(r=>r.to).forEach(r=>{
    const a=String(r.to).toUpperCase();
    if(taken[a])clash.push({r,other:taken[a]});
    else taken[a]=({name:r.name});
  });
  if(clash.length){
    toast(`${esc(clash[0].r.name)} points at the same ASIN as ${esc(clash[0].other.name)}`,'er');
    clash.forEach(c=>{
      const i=_hbRows.indexOf(c.r);
      const st=document.getElementById('hbState-'+i);
      if(st){st.innerHTML=`already used by <b>${esc(c.other.name)}</b>`;st.className='fxState';}
      const row=document.getElementById('hbRow-'+i);if(row)row.classList.remove('done');
      c.r.to='';
      const inp=document.getElementById('hbIn-'+i);if(inp)inp.value='';
    });
    hbSum();
    return;                       // nothing saves — a half-applied batch is worse
  }
  let links=0,skips=0;
  ready.forEach(r=>{
    if(!r.asin)return;
    if(r.skip){D.settings.hubSkip[r.asin]=true;delete D.settings.hubMap[r.asin];skips++;}
    else{D.settings.hubMap[r.asin]=r.to;delete D.settings.hubSkip[r.asin];links++;}
  });
  savePrefs();cm('lav3Ov2');paint();
  toast(`${links?`${fmt(links)} linked`:''}${links&&skips?' · ':''}${skips?`${fmt(skips)} set aside`:''}`,'ok');
}
/* the caption under the Sold column — never a bare number without its month */
function salesStrip(){
  const M=hubMonth(),rv=(HUB.state==='ok')?hubReview():null;
  const todo=rv?(rv.missing.length+rv.blank.length):0;
  const bad=M.status==='off'||M.status==='none'||M.status==='late'||HUB.cached;
  let msg;
  if(M.status==='loading')msg='<b>Reading sales from the BDL hub…</b>';
  else if(M.status==='off')msg=`<b>Cannot reach the BDL hub.</b> <span>No sales figures, so no targets. ${esc(HUB.err)}</span>`;
  else if(M.status==='none')msg='<b>The hub has no monthly report yet.</b>';
  else if(M.status==='due')msg=`<b>Showing ${ymName(M.ym)}.</b> <span>${ymName(M.want)} is written up in the hub around the 6th — it is not late.</span>`;
  else if(M.status==='late')msg=`<b>Still showing ${ymName(M.ym)}.</b> <span>${ymName(M.want)} should be in the hub by now — every target on this page is running a month behind until it is.</span>`;
  else msg=`<b>Sales from the BDL hub · ${ymName(M.ym)}.</b> <span>${fmt(rv?rv.ok.length:0)} product${(rv&&rv.ok.length===1)?'':'s'} with a figure.</span>`;
  if(HUB.cached&&M.status!=='off')msg+=' <span>Working from the last copy that came down — the hub did not answer.</span>';
  return `<div class="salesBar${bad?' warn':''}">
    <span class="sbDot"></span>
    <div class="sbTxt">${msg}</div>
    ${todo?`<button class="btn sm warn" onclick="LV3.openHubReview()">${fmt(todo)} to review</button>`:''}
    <button class="btn sm" onclick="LV3.hubRefresh()">Refresh</button></div>`;
}
/* Everything downstream leans on this one number, so how old it is
   matters as much as what it says. */
function sold30Age(p){
  const at=(D.settings.sold30At||{})[p.asin];
  return at?daysSince(at):null;
}
function demand30(p){const s=sold30(p);return s!=null?s:(p.ship30||0);}   // sales if known, else what we sent
/* No guessing. The target used to fall back to units SENT when no sales figure
   was in, and dressed it up as "≈776 · guess". A made-up number in an orange box
   gets acted on like a real one. Until last month's sales are in, there is no
   target — the column says so and waits. */
function target60(p){const d=sold30(p);if(d==null||!d)return null;
  const days=D.settings.targetDays||60;
  return Math.round(d/30*days);}
/* ══════════════ REPLENISHMENT — WHEN, AND HOW MUCH ══════════════════════
   From the UK team's brief, 19 Aug. The whole point is that these are TWO
   questions and the old page answered them with one number.

     WHEN  = (current relevant stock / average daily sales) - lead time
     HOW MUCH = average daily sales x the period you pick (normally 60 days)

   What it replaces: "we are 19 below the 60-day target, so order 19". Order 19
   and thirty days later you are 73 down and ordering again — a small top-up
   every single month, forever. Existing stock decides WHEN the next order goes
   in; it does not decide how big it is.

   Sales land from the hub on the 5th-6th for the month before, so this is
   LAST FULL MONTH, not a rolling 30 days. Every label says which month. */
function adsOf(p){const s=sold30(p);return (s==null||s<=0)?null:s/30;}
/* Lead time is per product and typed in by hand — never guessed from the
   supplier, the country or the components. Blank means blank: the row says so
   rather than borrowing a number from somewhere else. */
function leadOf(p){
  const m=D.settings.leadDays||{};
  const v=m[p.asin];
  const n=parseInt(v);
  return Number.isFinite(n)&&n>0?n:null;
}
/* Every product needs a lead time before "Reorder in" can say anything, and
   they were only settable one at a time inside the product editor — so none of
   the 38 had one and the whole column read "set a lead time". The app already
   knows who supplies a product and how they ship, so it can PROPOSE a number.
   Proposed, not applied: a suggestion you accept is not the same as a guess
   made behind your back. */
function supplierOf(p){
  const names={};
  const add=o=>(o&&o.layers||[]).forEach(l=>{const n=(l.sup||'').trim();if(n)names[n]=(names[n]||0)+1;});
  if(p.type!=='bundle')add(p);
  else (p.recipe||[]).forEach(r=>{const c=comp(r.c);if(c)add(c);});
  const best=Object.keys(names).sort((a,b)=>names[b]-names[a])[0];
  return best||'';
}
function leadSuggest(p){
  const sup=supplierOf(p);
  if(!sup)return null;
  const k=guessMode(sup);
  if(!k)return {days:null,sup,why:`${sup} has no usual route set`};
  const m=shipMode(k);
  if(!m)return null;
  /* the slow end of the window, because ordering late costs more than early */
  return {days:m.hi,sup,why:`${sup} · ${m.label.split('—')[0].trim()} · ${m.lo}–${m.hi} days`};
}
function leadApplyAll(){
  const live=D.products.filter(x=>!x.archived&&x.asin&&leadOf(x)==null);
  let n=0;
  live.forEach(p=>{const s=leadSuggest(p);if(s&&s.days){setLead(p.asin,s.days);n++;}});
  render();
  toast(n?`${fmt(n)} lead time${n===1?'':'s'} set from each supplier's route — change any of them on the product`:'Nothing to set — no supplier route to work from','ok');
  if(n)logIt('edit',`Lead times set from supplier routes on ${n} product(s)`);
}
function leadPanel(){
  const live=D.products.filter(x=>!x.archived&&x.asin);
  const missing=live.filter(x=>leadOf(x)==null);
  const canSuggest=missing.map(p=>({p,s:leadSuggest(p)})).filter(x=>x.s&&x.s.days);
  const stuck=missing.length-canSuggest.length;
  return `<div class="panel">
    <div class="ph"><span class="t">How long each product takes to arrive</span>
      <span class="sub">${missing.length?`${fmt(missing.length)} of ${fmt(live.length)} still to set`:'all set'}</span>
      ${canSuggest.length?`<div class="r"><button class="btn sm pri" onclick="LV3.leadApplyAll()">Set ${fmt(canSuggest.length)} from supplier routes</button></div>`:''}</div>
    <div style="padding:12px">
      <div class="pmeta" style="margin:0 0 10px">Nothing can say <b>when to reorder</b> until it knows how long a delivery takes.
        These are proposals from each product's supplier and their usual route — accept them here and change any single one on the product itself.</div>
      ${missing.length?`<div class="supGrid">
        ${canSuggest.slice(0,12).map(x=>`<div class="supRow">
          <div class="supNm">${esc(x.p.name)}<div class="pmeta">${esc(x.s.why)}</div></div>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="in" style="width:70px" type="number" min="1" value="${x.s.days}"
              onchange="LV3.setLead('${esc(x.p.asin)}',this.value);LV3.render();">
            <span class="pmeta" style="margin:0">days</span></div>
        </div>`).join('')}
        ${canSuggest.length>12?`<div class="pmeta" style="margin:6px 0 0">+${fmt(canSuggest.length-12)} more — the button sets them all</div>`:''}
      </div>`:`<div class="pmeta" style="margin:0;color:var(--grn)">Every product has one.</div>`}
      ${stuck?`<div class="pmeta" style="margin:10px 0 0;color:var(--amb)">${fmt(stuck)} product${stuck===1?' has':'s have'} no supplier route to work from — set the supplier's method above, or type a lead time on the product.</div>`:''}
    </div>
  </div>`;
}
function setLead(asin,v){
  D.settings.leadDays=D.settings.leadDays||{};
  const n=parseInt(v);
  if(Number.isFinite(n)&&n>0)D.settings.leadDays[asin]=n; else delete D.settings.leadDays[asin];
  savePrefs();
}
/* Sellable at Amazon + already landing there + what we could build here now.
   Components ON ORDER are deliberately excluded (Jack, 19 Aug): they are not
   finished units, and counting them would report cover that does not exist. */
function relStock(p){
  const at=atAmz(p),inb=amzIn(p);
  if(at==null&&inb==null&&p.type!=='bundle')return null;
  return (at||0)+(inb||0)+((avail(p)||{}).n||0);
}
function daysCover(p){const a=adsOf(p);if(a==null)return null;
  const st=relStock(p);if(st==null)return null;return st/a;}
/* Live, every render — never a countdown from a date worked out weeks ago.
   Sales move, so the answer moves. */
function reorderIn(p){
  const ads=adsOf(p);
  if(ads==null)return{k:'nosales',days:null,ads:null,cover:null,lead:leadOf(p),stock:relStock(p)};
  const lead=leadOf(p);
  const cover=daysCover(p);
  if(cover==null)return{k:'nostock',days:null,ads,cover:null,lead,stock:null};
  if(lead==null)return{k:'nolead',days:null,ads,cover,lead:null,stock:relStock(p)};
  const days=cover-lead;
  return{k:days<=0?'due':'ok',days,ads,cover,lead,stock:relStock(p)};
}
/* How much to order when it IS due — the period's worth of forecast demand,
   NOT the gap to a target. Rounded up: you cannot build 145.2 of something. */
function replenQty(p,days){
  const ads=adsOf(p);if(ads==null)return null;
  return Math.ceil(ads*(days||D.settings.replenDays||60));
}
/* One place decides the colour so the cell and the sort agree. Never dims with
   opacity — a settled row gets an explicit colour. */
function reorderState(r){
  if(!r||r.k==='nosales')return{col:'var(--muted2)',txt:'no recent sales'};
  if(r.k==='nostock')return{col:'var(--muted2)',txt:'not counted yet'};
  if(r.k==='nolead')return{col:'var(--muted2)',txt:'set a lead time'};
  if(r.days<=0)return{col:'var(--red)',txt:'DUE NOW'};
  if(r.days<=7)return{col:'var(--amb)',txt:fmt(Math.round(r.days))+' days'};
  if(r.days<=30)return{col:'var(--text)',txt:fmt(Math.round(r.days))+' days'};
  return{col:'var(--grn)',txt:fmt(Math.round(r.days))+' days'};
}
/* weekly usage from shipped-30d -> cover in weeks */
function coverWeeks(p){const a=avail(p);const wk=demand30(p)/4.35;if(!wk)return null;return (a.n||0)/wk;}
function compWeekUse(c){
  let per30=0;
  D.products.forEach(p=>{if(p.type!=='bundle')return;const r=p.recipe.find(x=>x.c===c.id);if(r)per30+=r.q*demand30(p);});
  return per30/4.35;
}
function compCover(c){const w=compWeekUse(c);if(!w)return null;return onHand(c)/w;}
/* What this part actually needs to hold: 60 days' worth of every product that
   uses it. Weeks-of-cover was too abstract to act on — a number of units short
   is not. */
function compNeed60(c){
  let need=0;
  D.products.forEach(p=>{if(p.archived||p.type!=='bundle')return;
    const r=p.recipe.find(x=>x.c===c.id);if(!r)return;
    need+=r.q*(target60(p)||0);});
  return need;
}
function compShort60(c){const need=compNeed60(c);if(!need)return 0;return Math.max(0,need-onHand(c)-onOrder(c));}
const usedIn=cid=>D.products.filter(p=>!p.archived&&p.recipe.some(r=>r.c===cid));

/* ── global search: one box that finds anything and opens it ── */
function gsRun(q){
  const box=$('gsOut');q=(q||'').trim().toLowerCase();
  if(q.length<2){box.className='';box.innerHTML='';return;}
  const hit=[];
  D.products.filter(p=>(p.name+p.asin+p.sku).toLowerCase().includes(q)).slice(0,6).forEach(p=>{
    const a=avail(p);
    hit.push({g:'Products',n:p.name,s:`${p.asin} · ${a.kind==='build'?fmt(a.n)+' buildable':fmt(a.n)+' in stock'}`,f:`openProduct('${p.id}')`});});
  D.components.filter(c=>c.name.toLowerCase().includes(q)).slice(0,6).forEach(c=>{
    hit.push({g:'Components',n:c.name,s:`${fmt(onHand(c))} on hand · used in ${usedIn(c.id).length} product${usedIn(c.id).length===1?'':'s'}`,f:`openComp('${c.id}')`});});
  D.purchases.filter(x=>(x.name+x.sup+x.oid).toLowerCase().includes(q)).slice(0,6).forEach(x=>{
    hit.push({g:'Purchases',n:x.name,s:`${fmt(x.qty)} @ ${gbp(x.price)} · ${dshort(x.date)} · ${allocState(x).label}`,f:`openLink('${x.id}')`});});
  if(!hit.length){box.className='on';box.innerHTML='<div class="gsrow"><span class="n dim">Nothing matches</span></div>';return;}
  let out='',last='';
  hit.forEach(h=>{if(h.g!==last){out+=`<div class="gshead">${h.g}</div>`;last=h.g;}
    out+=`<div class="gsrow" onclick="LV3.gsGo(&quot;${h.f.replace(/"/g,'&quot;')}&quot;)">
      <span class="n">${esc(h.n)}<span class="s">${esc(h.s)}</span></span></div>`;});
  box.className='on';box.innerHTML=out;
}
function gsGo(fn){$('gsIn').value='';$('gsOut').className='';try{eval(fn.replace(/LV3\./g,''));}catch(e){console.warn(e);}}
document.addEventListener('click',e=>{if(!e.target.closest('.gs')){const b=$('gsOut');if(b)b.className='';}});

/* ═══════════════ PLANNER β — THE REPLENISHMENT ENGINE ═══════════════════
   From the 29 Aug spec. This is the calculation engine plus its debug view,
   deliberately built BEFORE any redesign of the existing pages: the numbers
   have to be trusted first (spec §82). Nothing on this tab writes anywhere
   except its own settings; Products/Restocks are untouched until the numbers
   are proven against real ASINs.

   The one principle everything below serves (spec §1):
     lead time decides WHEN we act; demand + projected stock + the cycle
     decide HOW MUCH; safety stock covers the uncertainty.

   Stage discipline (spec §3): sellable, inbound, buildable and on-order are
   four different things and are never summed into one comforting number.  */

/* ── planner settings — reuses targetDays + primeDays, adds only the three
   the spec needs. Fallbacks are the spec's agreed starting values (§78). */
function plNum(key,def,min,max){const n=parseFloat((D.settings||{})[key]);
  return (Number.isFinite(n)&&n>=min&&n<=max)?n:def;}
const safetyDays=()=>plNum('safetyDays',14,0,60);
const prepDaysN =()=>plNum('prepDays',3,0,30);
const cycleDaysN=()=>plNum('cycleDays',60,7,365);
function plSet(key,v){const n=parseFloat(v);
  if(Number.isFinite(n)&&n>0)D.settings[key]=n;else delete D.settings[key];
  savePrefs();render();}

/* working days FORWARD — the mirror of workDaysBefore, for "sent today,
   sellable when?" */
function workDaysAfter(iso,n){
  const d=new Date(String(iso).slice(0,10)+'T00:00:00');
  let left=n,guard=0;
  while(left>0&&guard<600){d.setDate(d.getDate()+1);guard++;
    const w=d.getDay();if(w>=1&&w<=5)left--;}
  return _isoOf(d);
}
/* the FBA pipeline in calendar days, honestly derived from the working-day
   setting rather than a second number that could drift from the first */
function fbaCalDays(){
  const t=dayISO(),p=workDaysAfter(t,primeDays());
  return Math.round((new Date(p+'T00:00:00')-new Date(t+'T00:00:00'))/864e5);
}

/* ── demand: hub sales first, the owner's planning figure second, never a
   guess (spec §63). Zero sales is its own honest state, not a blank. */
function planDemandOf(p){
  /* Becki, 7 Sep: three bundles marked "not selling yet" in the July review
     sold in August, and the planner still ignored them. The mark means "no
     sales yet, stop asking" — the moment the hub shows real sales, the sales
     win. The mark stays on the row (and can be cleared) but no longer blocks. */
  if(hubSkipped(p)&&!(hubUnits(p)>0))return{m:0,src:'skip',label:'marked as not selling'};
  const s=sold30(p);
  if(s!=null&&s>0)return{m:s,src:'hub',label:ymName(hubMonth().ym)+' sales'};
  const v=parseFloat((D.settings.planDemand||{})[p.asin]);
  if(Number.isFinite(v)&&v>0)return{m:v,src:'manual',label:'your planning figure'};
  if(s===0)return{m:0,src:'zero',label:'sold none in '+ymName(hubMonth().ym)};
  return null;
}
function setRouteGroup(keys,mode){
  String(keys||'').split('|').filter(Boolean).forEach(k=>setSupplierMode(k,mode));
}
function plSkip(asin){
  D.settings.hubSkip=D.settings.hubSkip||{};
  D.settings.hubSkip[asin]=true;
  savePrefs();render();
  toast('Marked as not selling — it stops nagging everywhere. Press “Selling again” on its row when it comes back.','ok');
}
/* Becki, 7 Sep: "where is the sales review part to unmark this product as
   not selling?" — the only way back was a button at the bottom of the hub
   review popup, which nobody could find. One click, from the product's row,
   its popup, or the Planner. */
function plUnskip(asin){
  if(D.settings.hubSkip)delete D.settings.hubSkip[asin];
  savePrefs();render();
  const p=D.products.find(x=>x.asin===asin);
  toast('Selling again — the planner is back on '+(p?p.name:'it'),'ok');
}
function setPlanDemand(asin,v){
  D.settings.planDemand=D.settings.planDemand||{};
  const n=parseFloat(v);
  if(Number.isFinite(n)&&n>0)D.settings.planDemand[asin]=n;
  else delete D.settings.planDemand[asin];
  savePrefs();render();
}

/* ── production time (spec §7.1): OFF for everything by default — UK
   off-the-shelf is production 0. A component is ticked "made to order" and
   THEN the days are filled in; ticked-but-unfilled is a visible gap, never a
   silent zero. Stored in settings, so no schema change. */
function prodTimeOf(c){const m=D.settings.prodTime||{};const v=m[c.id];
  return v===undefined?null:(parseInt(v)||0);}
function toggleProdTime(cid){
  D.settings.prodTime=D.settings.prodTime||{};
  if(D.settings.prodTime[cid]===undefined)D.settings.prodTime[cid]=0;
  else delete D.settings.prodTime[cid];
  savePrefs();render();
}
function setProdTime(cid,v){
  D.settings.prodTime=D.settings.prodTime||{};
  const n=parseInt(v);
  D.settings.prodTime[cid]=(Number.isFinite(n)&&n>0)?n:0;
  savePrefs();render();
}

/* ── who supplies a thing, and how long their route takes. The supplier
   column plus the layer history; the route comes from "Who ships how".
   An ask-every-time supplier deliberately has no planning route — that is
   surfaced as a gap, never guessed around (spec §7.3). */
function compSupplier(c){
  /* "Stock correction" and "Opening stock" are bookkeeping, not suppliers —
     counting them made the glove's "usual supplier" an accounting artifact,
     which then had no route, which kept the part unpriced everywhere. */
  const junk=/^(opening stock|stock (correction|adjust)|stocktake|—|-|n\/a|unknown)$/i;
  const own=(c.supplier||'').trim();
  if(own&&!junk.test(own))return own;
  const names={};
  (c.layers||[]).forEach(l=>{const n=(l.sup||'').trim();
    if(n&&!junk.test(n))names[n]=(names[n]||0)+1;});
  return Object.keys(names).sort((a,b)=>names[b]-names[a])[0]||'';
}
function routeDaysFor(sup){
  const s=(sup||'').trim();if(!s)return null;
  if(supplierAsks(s))return null;
  /* only a route Jack has actually SET counts for planning — guessMode's
     pattern-matching fallback is fine for dating one purchase, but a BUY
     deadline built on a guessed route is the silent assumption the spec
     forbids. Unset suppliers go to the route screen instead. */
  const SM=D.settings.supplierModes||{};
  let k=SM[s.toLowerCase()];
  if(!k){
    /* spelling drift on the sheet — "Alibab", "Love Pub Snacks" — must not
       strand a part unrouted when the real supplier IS set. Exact squashed
       match first, then one-typo tolerance on names 6+ characters. */
    const _sq=x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,'');
    const _l1=(a,b)=>{if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
      if(a.length<6||b.length<6)return false;
      let i=0,j=0,d=0;
      while(i<a.length&&j<b.length){
        if(a[i]===b[j]){i++;j++;continue;}
        d++;if(d>1)return false;
        if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
      return d+(a.length-i)+(b.length-j)<=1;};
    const sq=_sq(s);
    const hit=Object.keys(SM).find(x=>_sq(x)===sq)||Object.keys(SM).find(x=>_l1(_sq(x),sq));
    if(hit){if(SM[hit]===ASK_MODE)return null;k=SM[hit];}}
  if(!k)return null;
  const m=modeDays(k);if(!m)return null;
  const lbl=(shipModes().find(x=>x.k===k)||{}).label||k;
  return{hi:m.hi,lo:m.lo,k,label:String(lbl).split('—')[0].trim()};
}
/* every supplier the data has ever seen — the route screen works off this */
function plSuppliers(){
  /* stock adjustments masquerade as suppliers in old rows — nobody ships from
     "Stock correction", so it never belongs on the route screen */
  return knownSuppliers().map(x=>x.name)
    .filter(n=>!/^stock (correction|adjust)/i.test(n));
}

/* ═══ A. AMAZON REPLENISHMENT (spec §13-14) — build & send? when? how many? */
function plAmazonRow(p){
  const d=planDemandOf(p);
  const sell=atAmz(p),inb=amzIn(p)||0;
  const out={p,demand:d,sell,inb,alloc:0,rec:0};
  if(!d){out.state='nodata';
    out.why='No sales figure and no planning demand. Nothing is planned for it — type a monthly estimate below and it joins in.';return out;}
  if(d.m===0){out.state='paused';
    out.why=d.src==='skip'
      ?'Marked as not selling, so the planner leaves it alone completely. Press “Selling again” below when it comes back.'
      :'Sold none in '+ymName(hubMonth().ym)+', so nothing is planned. Give it a planning figure if it should still be stocked.';return out;}
  if(sell==null){out.state='nocount';
    out.why='Amazon stock has never been counted for this one, so there is no starting point to plan from.';return out;}
  const ads=d.m/30;out.ads=ads;
  const fba=fbaCalDays(),saf=safetyDays();
  /* when does the inbound become sellable? Worked from the latest real
     shipment date (spec §32) plus the FBA pipeline — never taken on faith
     as already-sellable, never discounted either (spec §9.2). */
  let inbEta=null;
  if(inb>0){
    const ships=(typeof lavShipments!=='undefined'?lavShipments:[])
      .filter(x=>x.asin===p.asin&&x.date)
      .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const base=ships.length?String(ships[0].date).slice(0,10)
      :String((D.settings.atAmzAt||{})[p.asin]||dayISO()).slice(0,10);
    inbEta=workDaysAfter(base,primeDays());
  }
  const sellDry=addCalDays(dayISO(),Math.floor(sell/ads));
  const inbInTime=inb>0&&inbEta!=null&&inbEta<=sellDry;
  const protUnits=sell+(inbInTime?inb:0);
  out.protDays=protUnits/ads;
  out.inbEta=inbEta;out.inbInTime=inbInTime;out.sellDry=sellDry;
  out.stockout=addCalDays(dayISO(),Math.floor(out.protDays));
  out.trigger=out.protDays<=fba+saf;
  /* how many: land the shipment with roughly targetDays of cover ON ARRIVAL
     (spec §14) — projected position when it becomes sellable, not today's */
  const landIso=workDaysAfter(dayISO(),primeDays());
  const landDays=Math.round((new Date(landIso+'T00:00:00')-new Date(dayISO()+'T00:00:00'))/864e5);
  const inbByLand=(inb>0&&inbEta!=null&&inbEta<=landIso)?inb:0;
  const projAtLand=Math.max(0,sell-ads*landDays)+inbByLand;
  const want=ads*(D.settings.targetDays||60);
  out.rec=out.trigger?Math.max(0,Math.ceil(want-projAtLand)):0;
  out.landIso=landIso;out.projAtLand=Math.round(projAtLand);out.want=Math.round(want);
  if(!out.trigger){
    out.state=(inb>0&&!inbInTime)?'watch':'safe';
    out.why=(out.state==='watch')
      ?fmt(inb)+' inbound is expected sellable ~'+dshort(inbEta)+', AFTER the shelf empties ~'+dshort(sellDry)+' — protection holds for now but this needs watching.'
      :Math.round(out.protDays)+' days of protection against a '+(fba+saf)+'-day trigger ('+fba+' FBA + '+saf+' safety). Nothing to do.';
  }else if(out.rec===0){
    out.state='waiting';
    out.why=(inb>0?fmt(inb)+' already inbound (sellable ~'+dshort(inbEta)+') — ':'')
      +'the projected position when a shipment sent today became sellable is already at target. Sending more now would just overstock.';
  }else{
    out.state=out.protDays<=fba?'critical':'act';
  }
  return out;
}
/* shared components are allocated ONCE, most-urgent product first — the same
   12 gloves can never be promised to sixteen products (spec §16/§57). */
function planAmazon(){
  const live=D.products.filter(x=>!x.archived);
  const rows=live.map(plAmazonRow);
  const act=rows.filter(r=>(r.state==='act'||r.state==='critical')&&r.rec>0)
    /* Jack, 30 Aug: "it doesn't matter if it's a slow seller — if we're going
       to run out, it needs to go." No sinking; closest to empty leads. */
    .sort((a,b)=>a.protDays-b.protDays);
  const pool={};
  const poolGet=o=>{if(pool[o.id]===undefined)pool[o.id]=onHand(o);return pool[o.id];};
  act.forEach(r=>{
    const p=r.p;
    if(p.type!=='bundle'){
      const have=poolGet(p);
      r.buildCap=have;r.alloc=Math.min(have,r.rec);
      if(r.alloc>0)pool[p.id]-=r.alloc;
      return;
    }
    let cap=Infinity,lim=null;
    (p.recipe||[]).forEach(rc=>{const c=comp(rc.c);if(!c||c.untracked)return;
      const can=Math.floor(poolGet(c)/rc.q);
      if(can<cap){cap=can;lim=c;}});
    cap=(cap===Infinity)?0:cap;
    r.buildCap=cap;r.lim=lim;r.alloc=Math.min(cap,r.rec);
    if(r.alloc>0)(p.recipe||[]).forEach(rc=>{const c=comp(rc.c);if(!c||c.untracked)return;
      pool[c.id]-=rc.q*r.alloc;});
  });
  act.forEach(r=>{
    if(r.alloc>=r.rec||!r.lim)return;
    r.limTakers=act.filter(x=>x!==r&&x.alloc>0&&x.p.type==='bundle'
      &&(x.p.recipe||[]).some(rc=>rc.c===r.lim.id)&&x.protDays<=r.protDays)
      .map(x=>x.p.name);
  });
  return{rows,act};
}
/* when a product cannot be fully built: is the limiting component's incoming
   order going to save it, and in time? (spec §10 — "incoming in time") */
function plGapInfo(r){
  const c=r.lim;if(!c)return null;
  const pend=(c.layers||[]).filter(l=>!l.arr&&!l.writtenOff);
  /* Jack, 3 Sep: "way way way too overcomplicated". Every card carried a full
     sentence of reasoning. The long version still exists for the details pane
     and the why-line; the card face gets `short`. */
  if(!pend.length)return{kind:'none',short:'none on order',
    txt:'nothing on order for '+c.name+' — the shortfall has no incoming cover at all'};
  const qty=pend.reduce((t,l)=>t+(l.qty||0),0);
  const withEta=pend.filter(l=>l.eta1||l.eta2);
  if(!withEta.length)return{kind:'noeta',qty,short:fmt(qty)+' on order &middot; no ETA set',
    txt:fmt(qty)+' × '+c.name+' on order but NO delivery method or ETA is set, so nobody can say if it lands in time. Set the method on the Purchases tab.'};
  const eta=withEta.map(l=>String(l.eta2||l.eta1).slice(0,10)).sort()[0];
  const usable=workDaysAfter(addCalDays(eta,prepDaysN()),primeDays());
  const late=usable>r.stockout;
  return{kind:late?'late':'intime',eta,usable,qty,
    short:fmt(qty)+' due '+dshort(eta)+(late?' &mdash; too late':''),
    txt:fmt(qty)+' × '+c.name+' due '+dshort(eta)+' → built and sellable ~'+dshort(usable)
      +(late?' — AFTER the projected stock-out on '+dshort(r.stockout)+'. That is a supply gap this order cannot close.'
             :' — before the projected stock-out on '+dshort(r.stockout)+'.')};
}

/* ═══ B. COMPONENT PURCHASING (spec §15-22) — buy? by when? how much? ═══ */
function planComponents(){
  const live=D.products.filter(x=>!x.archived);
  const cd={},drv={},selfLines=[];
  live.forEach(p=>{
    const d=planDemandOf(p);if(!d||!d.m)return;
    const ads=d.m/30;
    if(p.type!=='bundle'){selfLines.push({o:p,isProd:true,daily:ads,drivers:[p.name]});return;}
    (p.recipe||[]).forEach(rc=>{const c=comp(rc.c);if(!c||c.untracked)return;
      cd[c.id]=(cd[c.id]||0)+ads*rc.q;
      (drv[c.id]=drv[c.id]||[]).push(p.name+(rc.q>1?' ×'+rc.q:''));});
  });
  const lines=selfLines.concat(Object.keys(cd)
    .map(id=>({o:comp(id),isProd:false,daily:cd[id],drivers:drv[id]}))
    .filter(x=>x.o&&!x.o.archived));
  const today=dayISO();
  lines.forEach(L=>{
    const o=L.o,dly=L.daily;
    L.hand=onHand(o);
    L.cover=dly?L.hand/dly:null;
    L.sup=compSupplier(o);
    const route=routeDaysFor(L.sup);
    const pt=L.isProd?null:prodTimeOf(o);
    L.prodOn=pt!==null;L.prodDays=pt||0;
    L.prodMissing=L.prodOn&&!pt;
    if(!L.sup){L.state='nosup';return;}
    if(!route){L.state='noroute';return;}
    L.route=route;
    L.lead=route.hi+L.prodDays;
    const pend=(o.layers||[]).filter(l=>!l.arr&&!l.writtenOff);
    L.pendQty=pend.reduce((t,l)=>t+(l.qty||0),0);
    L.pendNoEta=pend.filter(l=>!(l.eta1||l.eta2)).reduce((t,l)=>t+(l.qty||0),0);
    L.overdue=pend.some(l=>{const e=String(l.eta2||'').slice(0,10);return e&&e<today;});
    const arriveIso=addCalDays(today,L.lead);
    const inTime=pend.filter(l=>{const e=String(l.eta2||l.eta1||'').slice(0,10);
      return e&&e<=arriveIso;}).reduce((t,l)=>t+(l.qty||0),0);
    L.inTime=inTime;
    /* buy enough that AFTER it lands we hold cycle + safety of cover, from
       the projected position — never a flat top-up to a target (spec §18) */
    const projAtArrival=Math.max(0,L.hand-dly*L.lead)+inTime;
    const want=dly*(cycleDaysN()+safetyDays());
    L.want=Math.ceil(want);L.projAtArrival=Math.round(projAtArrival);
    const need=Math.max(0,want-projAtArrival);
    L.needRaw=Math.ceil(need);
    const cq=(!L.isProd&&o.caseQty>0)?o.caseQty:null;
    L.caseQty=cq;
    L.cases=(cq&&need>0)?Math.ceil(need/cq):null;
    L.buyQty=need>0?(cq?L.cases*cq:Math.ceil(need)):0;
    L.cost=L.buyQty>0?L.buyQty*(avgCost(o)||0):0;
    const runoutDays=dly?(L.hand+inTime)/dly:Infinity;
    L.buyByDays=Math.floor(runoutDays-(L.lead+safetyDays()));
    L.buyBy=addCalDays(today,Math.max(0,L.buyByDays));
    if(L.buyQty<=0)L.state=(L.pendQty>0)?'waiting':'safe';
    else if(L.buyByDays<=0)L.state='buy';
    else if(L.buyByDays<=7)L.state='soon';
    else L.state='upcoming';
    if(L.overdue)L.chase=true;
    L.skip=_buySkip(o);
  });
  const rank={buy:0,soon:1,noroute:2,nosup:2,upcoming:3,waiting:4,safe:5};
  return lines.sort((a,b)=>{
    const d=(rank[a.state]!==undefined?rank[a.state]:6)-(rank[b.state]!==undefined?rank[b.state]:6);
    if(d)return d;
    const ax=a.buyByDays==null?999:a.buyByDays,bx=b.buyByDays==null?999:b.buyByDays;
    return ax-bx;
  });
}

/* one engine run per render pass — every panel reads the SAME answer, which
   is the entire point of the rebuild: four surfaces, one brain */
let _plCache=null,_plStamp=0;
function plData(){
  if(_plCache&&Date.now()-_plStamp<800)return _plCache;
  const az=planAmazon(),buys=planComponents();
  const byComp={},azBy={};
  buys.forEach(L=>{if(!L.isProd)byComp[L.o.id]=L;});
  az.rows.forEach(r=>{azBy[r.p.id]=r;});
  _plCache={az,buys,byComp,azBy};_plStamp=Date.now();
  return _plCache;
}
/* ═══ THE DEBUG VIEW (spec §82) ═══ */
function plStateCol(k){
  const M={critical:'#f87171',act:'#fbbf24',gap:'#f87171',parts:'#fb923c',
    waiting:'#60a5fa',watch:'#fbbf24',safe:'#4ade80',buy:'#f87171',soon:'#fbbf24',
    noroute:'#7d7568',nosup:'#7d7568',upcoming:'#7d7568',paused:'#7d7568',chase:'#c084fc',
    nodata:'#f87171',nocount:'#f87171'};
  return M[k]||'#7d7568';
}
function plStateChip(k){
  const M={critical:['CRITICAL — BUILD & SEND NOW','#f87171'],
    act:['BUILD & SEND','#fbbf24'],waiting:['WAITING','#60a5fa'],
    watch:['WATCH','#fbbf24'],safe:['SAFE','#4ade80'],
    paused:['NOT PLANNED','#7d7568'],nodata:['SALES DATA REQUIRED','#f87171'],
    nocount:['UPDATE AMAZON STOCK','#f87171'],
    buy:['BUY NOW','#f87171'],soon:['BUY THIS WEEK','#fbbf24'],
    upcoming:['UPCOMING','#a8a196'],chase:['CHASE','#c084fc'],
    parts:['GET PARTS FIRST','#fb923c'],
    noroute:['SET ROUTE','#f87171'],
    nosup:['NO SUPPLIER','#f87171'],gap:['SUPPLY GAP','#f87171']};
  const x=M[k]||[k,'#a8a196'];
  return '<span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10.5px;font-weight:800;letter-spacing:.04em;white-space:nowrap;color:#14120f;background:'+x[1]+'">'+x[0]+'</span>';
}
/* the Action cell's popup — what the old 60d-target button used to answer
   ("what do I send, what do I buy?") but from the engine, with the working */
function openPlanRow(pid){
  const p=prod(pid);if(!p)return;
  const R=(plData().azBy||{})[p.id];if(!R)return;
  const blocked=(R.state==='act'||R.state==='critical')&&R.buildCap===0;
  const gap=(R.alloc<R.rec&&(R.state==='act'||R.state==='critical'))?plGapInfo(R):null;
  let doTxt='';
  if(R.state==='act'||R.state==='critical')
    doTxt=R.alloc>0?('<b>BUILD & SEND '+fmt(R.alloc)+'</b>'+(R.alloc<R.rec?' of the '+fmt(R.rec)+' wanted':'')):'<b>nothing can be built yet</b>';
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>${esc(p.name)}</h3>
      <span style="margin-left:8px">${plStateChip(blocked?'parts':R.state)}</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      ${doTxt?`<div style="font-size:13.5px;color:var(--text);margin:0 0 8px;">${doTxt}</div>`:''}
      <div style="font-size:12px;color:var(--text3);line-height:1.6;margin:0 0 4px;">${R.why||''}
        ${gap?' '+esc(gap.txt):''}</div>
      ${plDebugPre(R)}
    </div>
    <div class="mf"><span class="pmeta" style="margin:0">the same row, with the same working, lives on the Planner</span>
      <div class="sp">
        ${R.alloc>0?`<button class="btn go" onclick="LV3.cm('lav3Ov2');LV3.openShip('${p.id}')">Ship units</button>`:''}
        ${hubSkipped(p)?`<button class="btn pri" onclick="LV3.cm('lav3Ov2');LV3.plUnskip('${esc(p.asin)}')" title="Take the not-selling mark off — the planner picks it up again on the spot">Selling again</button>`:''}
        <button class="btn" onclick="LV3.cm('lav3Ov2');LV3.go('planner')">Planner</button>
        <button class="btn" onclick="LV3.cm('lav3Ov2')">Close</button></div></div>`;
  om('lav3Ov2');
}
function plDebugPre(r){
  const d=r.demand||{};
  const rows=[
    ['Demand',d.m!=null?fmt(d.m)+'/month ('+d.label+') = '+(r.ads?r.ads.toFixed(2):'—')+'/day':'—'],
    ['Amazon sellable',r.sell==null?'never counted':fmt(r.sell)],
    ['Amazon inbound',fmt(r.inb||0)+(r.inbEta?' · expected sellable ~'+dshort(r.inbEta)+(r.inbInTime?' (in time)':' (after the shelf empties)'):'')],
    ['Buildable now',r.buildCap!=null?fmt(r.buildCap):fmt((avail(r.p)||{}).n||0)],
    ['FBA pipeline',primeDays()+' working days = '+fbaCalDays()+' calendar'],
    ['Safety reserve',safetyDays()+' days'],
    ['Trigger at',(fbaCalDays()+safetyDays())+' days of protection'],
    ['Protection now',r.protDays!=null?Math.round(r.protDays)+' days':'—'],
    ['Projected stock-out',r.stockout?dshort(r.stockout):'—'],
    ['Sent today → sellable',r.landIso?dshort(r.landIso):'—'],
    ['Projected position then',r.projAtLand!=null?fmt(r.projAtLand):'—'],
    ['Aim when it lands',r.want!=null?fmt(r.want)+' units — '+(D.settings.targetDays||60)+' days\u2019 worth':'—'],
    ['Recommended send',r.rec?fmt(r.rec):'0'],
    ['Allocated from parts',r.alloc!=null?fmt(r.alloc):'—']];
  return '<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 14px;padding:10px 12px;background:var(--bg3);border-radius:7px;margin:7px 0 3px;font-size:11.5px;">'
    +rows.map(x=>'<span style="color:var(--text3)">'+x[0]+'</span><span class="mono" style="color:var(--text)">'+x[1]+'</span>').join('')+'</div>';
}
/* ═══ THE PLANNER — the maths behind the Overview (Jack, 5 Sep: "needs
   work, as is shit"). One row per product, one row per part, the same
   numbers the Overview prints, and the working one click away. */
function _plannerTable(az,buys,gaps,fba,saf,setBox){
  const M=ovModel();const trig=fba+saf;
  const rows=az.rows.filter(r=>r.demand&&['nodata','nocount','paused'].indexOf(r.state)<0)
    .sort((a,b)=>(a.protDays==null?1e9:a.protDays)-(b.protDays==null?1e9:b.protDays));
  const live=rows.filter(r=>r.state!=='safe'),safe=rows.filter(r=>r.state==='safe');
  const paused=az.rows.filter(r=>r.state==='paused').length;
  const covCol=d=>d==null?'var(--text3)':d<=fba?'#ef4444':d<=trig?'#fbbf24':'#4ade80';
  const stateOf=r=>{
    if(r.state==='act'||r.state==='critical'){
      if(r.alloc>0&&r.alloc>=r.rec)return['SEND '+fmt(r.alloc),'#4ade80'];
      const g=plGapInfo(r);
      if(r.alloc>0)return['SEND '+fmt(r.alloc)+' · '+fmt(r.rec-r.alloc)+' SHORT','#fbbf24'];
      if(g&&g.kind==='intime')return['PARTS LAND '+dshort(g.eta),'#60a5fa'];
      if(g&&g.kind==='late')return['PARTS LAND '+dshort(g.eta)+' — LATE',(r.sell||0)<=0?'#ef4444':'#fb923c'];
      if(g&&g.kind==='noeta')return['ON ORDER · NO ETA','#fbbf24'];
      return['BUY PARTS',(r.sell||0)<=0?'#ef4444':'#fb923c'];}
    if(r.state==='waiting')return['INBOUND COVERS IT','#60a5fa'];
    if(r.state==='watch')return['WATCH','#fbbf24'];
    return['SAFE','#4ade80'];};
  const pRow=r=>{const sc=stateOf(r);const st=sc[0],col=sc[1];
    const g=(r.alloc<r.rec&&(r.state==='act'||r.state==='critical'))?plGapInfo(r):null;
    return `<div class="plnRow" onclick="LV3.openPlanRow('${r.p.id}')" style="border-left-color:${col};">
      <span class="plnName">${esc(r.p.name)}${r.demand&&r.demand.m?`<small>${fmt(r.demand.m)}/month</small>`:''}</span>
      <span class="plnNum" style="color:${(r.sell||0)<=0?'#ef4444':'var(--text)'}">${r.sell==null?'—':fmt(r.sell)}</span>
      <span class="plnNum" style="color:var(--blu)">${r.inb?fmt(r.inb)+`<small>${r.inbEta?'~'+dshort(r.inbEta):''}</small>`:'—'}</span>
      <span class="plnNum" style="color:${covCol(r.protDays)};font-weight:800;">${r.protDays==null?'—':fmt(Math.round(r.protDays))+'d'}<small>${r.stockout?'empty ~'+dshort(r.stockout):''}</small></span>
      <span class="plnNum">${r.buildCap!=null?fmt(r.buildCap):fmt((avail(r.p)||{}).n||0)}</span>
      <span class="plnNum" style="color:${r.rec?'var(--text)':'var(--text3)'}">${r.rec?fmt(r.rec):'—'}</span>
      <span class="plnPart">${(r.lim&&r.alloc<r.rec)?esc(r.lim.name)+(g?`<small>${g.short}</small>`:''):'<span class="ovDim">—</span>'}</span>
      <span class="plnState" style="color:${col};border-color:${col}55;background:${col}1a;">${st}</span></div>`;};
  const head=`<div class="plnRow plnHead"><span class="plnName">Product</span><span class="plnNum">At Amazon</span><span class="plnNum">Inbound</span><span class="plnNum">Cover</span><span class="plnNum">Buildable</span><span class="plnNum">Wanted</span><span class="plnPart">Held up by</span><span class="plnState plnHeadState">Action</span></div>`;
  const bRows=buys.filter(L=>!L.isProd&&['buy','soon','upcoming','waiting'].indexOf(L.state)>=0);
  const bRow=L=>{const onway=(L.pendQty||0)>0,skip=!!L.skip;
    const sc=skip?['SET ASIDE','#7f8896']:onway?['ON ORDER · '+fmt(L.pendQty),'#60a5fa']
      :L.state==='buy'?[L.buyByDays<0?fmt(-L.buyByDays)+'D OVERDUE':'ORDER TODAY','#ef4444']
      :L.state==='soon'?['ORDER BY '+dshort(L.buyBy),'#fbbf24']
      :L.state==='upcoming'?['BY '+dshort(L.buyBy),'#7f8896']:['COVERED','#4ade80'];
    const st=sc[0],col=sc[1];
    return `<div class="plnRow plnB" style="border-left-color:${col};${skip?'opacity:.6;':''}">
      <span class="plnName">${esc(L.o.name)}<small>${esc(L.sup||'—')} · used by ${esc((L.drivers||[]).slice(0,3).join(', '))}${(L.drivers||[]).length>3?' +'+((L.drivers||[]).length-3):''}</small></span>
      <span class="plnNum" style="color:${L.hand===0?'#ef4444':'var(--text)'}">${fmt(L.hand)}<small>${L.cover!=null?(L.cover>365?'1yr+ cover':Math.round(L.cover)+'d cover'):''}</small></span>
      <span class="plnNum" style="color:var(--blu)">${L.pendQty?fmt(L.pendQty):'—'}</span>
      <span class="plnNum" style="font-weight:800;color:${(L.buyQty>0&&!onway&&!skip)?'var(--amb)':'var(--text3)'}">${L.buyQty>0?fmt(L.buyQty):'—'}${(L.cases&&L.caseQty>1&&L.buyQty>0)?`<small>${fmt(L.cases)} × ${fmt(L.caseQty)}</small>`:''}</span>
      <span class="plnNum">${(L.cost>0&&!onway)?gbp(L.cost):'—'}</span>
      <span class="plnState" style="color:${col};border-color:${col}55;background:${col}1a;">${st}</span>
      <span class="plnBtns">${(!onway&&!skip&&L.buyQty>0)?`<button class="btn sm pri" onclick="LV3.openLogOrder('${L.o.id}')">Log order</button><button class="btn sm ghost" title="Not buying this again — until its stock changes" onclick="LV3.buySkipSet('${L.o.id}','skip')">Not reordering</button>`:''}${skip?`<button class="btn sm ghost" onclick="LV3.buySkipSet('${L.o.id}','clear')">Bring back</button>`:''}</span></div>`;};
  const bHead=`<div class="plnRow plnHead plnB"><span class="plnName">Part</span><span class="plnNum">On hand</span><span class="plnNum">On order</span><span class="plnNum">Buy</span><span class="plnNum">Cost</span><span class="plnState plnHeadState">When</span><span class="plnBtns"></span></div>`;
  return `<div style="max-width:none;margin:0;">
    <div class="plnStrip"><span><b style="color:#ef4444">${fmt(M.oosBlocked.length)}</b> empty at Amazon</span><span><b style="color:#4ade80">${fmt(M.send.length)}</b> to send · ${fmt(M.sendUnits)} units</span><span><b style="color:#fbbf24">${fmt(M.buys.length)}</b> part${M.buys.length===1?'':'s'} to order · ${gbp(M.buyCost)}</span>
      <span class="ovDim" style="margin-left:auto;font-size:11.5px;">cover = days until the Amazon shelf empties, counting inbound that lands in time · trigger at <b>${trig}d</b> (${fba} FBA + ${saf} safety)</span></div>
    <div class="panel"><div class="ph"><span class="t">Products</span><span class="sub">${fmt(live.length)} need watching · ${fmt(safe.length)} safe · click a row for the working</span></div>
      <div class="plnTbl">${head}${live.map(pRow).join('')||'<div class="ovEmpty"><span class="ovTick">✓</span>Everything is protected.</div>'}</div>
      ${safe.length?`<details class="plnMore"><summary>SAFE — ${fmt(safe.length)} products, nothing to do ▾</summary><div class="plnTbl">${safe.map(pRow).join('')}</div></details>`:''}
      ${paused?`<div class="pmeta" style="padding:6px 14px 10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${fmt(paused)} marked not selling — hidden. Selling again?
        ${az.rows.filter(r=>r.state==='paused'&&hubSkipped(r.p)).map(r=>`<button class="btn sm" onclick="LV3.plUnskip('${esc(r.p.asin)}')" title="Take the not-selling mark off">${esc(r.p.name)}</button>`).join('')}</div>`:''}</div>
    <div class="panel"><div class="ph"><span class="t">Parts</span><span class="sub">what to buy, how much, by when · full detail on Purchases</span></div>
      <div class="plnTbl">${bHead}${bRows.map(bRow).join('')||'<div class="ovEmpty"><span class="ovTick">✓</span>Every part is covered.</div>'}</div></div>
    ${gaps?`<details class="plnMore panel" style="margin-top:8px;"><summary>Setup gaps — routes, sales figures, counts the planner is missing ▾</summary><div style="display:grid;gap:10px;padding:10px 14px 12px;">${gaps}</div></details>`:''}
    <details class="plnMore panel" style="margin-top:8px;"><summary>Assumptions ▾</summary><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;padding:10px 14px 12px;">${setBox('safetyDays',safetyDays(),'Safety reserve','days')}${setBox('prepDays',prepDaysN(),'Warehouse prep','days')}${setBox('cycleDays',cycleDaysN(),'Purchase cycle','days')}<span class="pmeta" style="margin:0 0 4px;">FBA pipeline: <b>${primeDays()} working days = ${fba} calendar</b> — set in Settings</span></div></details>
  </div>`;
}
function vPlanner(){
  const az=planAmazon();
  const buys=planComponents();
  const fba=fbaCalDays(),saf=safetyDays();
  /* data gaps first — the engine refuses to guess, so the gaps ARE the UI */
  /* "Alibab", "Love Pub Snacks"/"LovePubSnacks" — variants of one supplier
     each demanding their own answer was four questions for one fact. Group by
     a squashed name (plus one-typo tolerance) so one pick covers the lot. */
  const _sq=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const _lev1=(a,b)=>{if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
    if(a.length<6||b.length<6)return false;
    let i=0,j=0,d=0;
    while(i<a.length&&j<b.length){
      if(a[i]===b[j]){i++;j++;continue;}
      d++;if(d>1)return false;
      if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
    return d+(a.length-i)+(b.length-j)<=1;};
  const unrouted=plSuppliers().filter(s=>!routeDaysFor(s)&&!supplierAsks(s));
  const groups=[];
  unrouted.forEach(s=>{const q=_sq(s);
    const g=groups.find(G=>G.qs.some(x=>x===q||_lev1(x,q)));
    if(g){g.names.push(s);g.qs.push(q);}else groups.push({names:[s],qs:[q]});});
  const noRoute=groups;
  const askSup=plSuppliers().filter(s=>supplierAsks(s));
  const noDemand=az.rows.filter(r=>r.state==='nodata');
  const noCount=az.rows.filter(r=>r.state==='nocount');
  const noEtaLines=buys.filter(L=>L.pendNoEta>0);
  const actRows=az.act||[];
  const shown=az.rows.filter(r=>['critical','act','waiting','watch'].indexOf(r.state)>=0)
    .sort((a,b)=>(a.protDays==null?999:a.protDays)-(b.protDays==null?999:b.protDays));
  const safeRows=az.rows.filter(r=>r.state==='safe');
  const buyRows=buys.filter(L=>['buy','soon'].indexOf(L.state)>=0);
  const routeRows=buys.filter(L=>L.state==='noroute'||L.state==='nosup');
  const laterRows=buys.filter(L=>['upcoming','waiting'].indexOf(L.state)>=0);
  const buyCost=buyRows.reduce((t,L)=>t+(L.cost||0),0);

  const setBox=(key,val,lab,hint)=>'<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text3)">'+lab
    +'<span style="display:flex;align-items:center;gap:5px"><input class="in" style="width:58px" type="number" value="'+val+'" onchange="LV3.plSet(\''+key+'\',this.value)"><span>'+hint+'</span></span></label>';

  const gapCard=(title,body)=>'<div style="background:var(--bg2);border:1px solid var(--border2);border-left:3px solid var(--amb);border-radius:9px;padding:11px 13px;">'
    +'<div style="font-size:11.5px;font-weight:800;color:var(--amb);margin-bottom:6px;">'+title+'</div>'+body+'</div>';

  let gaps='';
  if(noRoute.length)gaps+=gapCard('Set each supplier\u2019s route — no BUY date without one',
    noRoute.map(g=>{const s=g.names[0];const extra=g.names.slice(1);
      return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;">'
      +'<span style="flex:1;min-width:0;color:var(--text)">'+esc(s)
      +(extra.length?'<div class="pmeta" style="margin:0">also covers: '+esc(extra.join(', '))+'</div>':'')+'</span>'
      +'<select class="in" style="width:220px" onchange="if(this.value)LV3.setRouteGroup(\''+esc(g.names.map(n=>n.toLowerCase().trim()).join('|')).replace(/'/g,"\\'")+'\',this.value)">'
      +'<option value="">'+(guessMode(s)?'guess: '+esc(String((shipModes().find(m=>m.k===guessMode(s))||{}).label||guessMode(s)).split('—')[0].trim().replace(' / parcel','')):'pick\u2026')+'</option>'
      +shipModes().map(m=>'<option value="'+m.k+'">'+esc(String(m.label).split('—')[0].trim())+' · '+m.lo+'–'+m.hi+'d</option>').join('')
      +'</select></div>';}).join('')
    +'<div class="pmeta" style="margin:6px 0 0">One-time job — the same answer then covers everything that supplier sends, and you can change it in Settings later.</div>');
  if(noDemand.length)gaps+=gapCard('No sales history and no planning figure — these are invisible to the planner',
    noDemand.map(r=>'<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;">'
      +'<span style="flex:1;color:var(--text)">'+esc(r.p.name)+'</span>'
      +'<input class="in" style="width:80px" type="number" placeholder="e.g. 50" value="" onchange="LV3.setPlanDemand(\''+esc(r.p.asin)+'\',this.value)">'
      +'<span class="pmeta" style="margin:0">/month</span>'
      +'<button class="btn sm" title="Dead line? One click and it stops nagging everywhere." onclick="LV3.plSkip(\''+esc(r.p.asin)+'\')">Not selling</button></div>').join('')
    +'<div class="pmeta" style="margin:6px 0 0">Your estimate, clearly labelled as yours — the moment real sales land from the hub they take over automatically.</div>');
  if(noEtaLines.length)gaps+=gapCard('Orders with no delivery method — the engine cannot tell if they land in time',
    noEtaLines.map(L=>'<div style="font-size:12px;padding:2px 0;color:var(--text)">'+fmt(L.pendNoEta)+' × '+esc(L.o.name)+' <span class="pmeta" style="margin:0">('+esc(L.sup||'?')+')</span></div>').join('')
    +'<div class="pmeta" style="margin:6px 0 0">Until a method is picked these count as NOT protecting you — deliberately harsh, so a late order can never hide. Set them on the <a href="javascript:void(0)" onclick="LV3.go(\'purchases\')" style="color:var(--blu)">Purchases tab</a>.</div>');
  if(noCount.length)gaps+=gapCard('Never counted at Amazon',
    noCount.map(r=>'<div style="font-size:12px;padding:2px 0;color:var(--text)">'+esc(r.p.name)+'</div>').join(''));
  /* Jack, 30 Aug: "the engine can be sophisticated — SHE sees BUY NOW / SEND
     NOW / dates." The simple action list replaces everything below; the old
     deep view still opens per product (openPlanRow). */
  $('lav3View').innerHTML=_plannerTable(az,buys,gaps,fba,saf,setBox);
}

/* ═══════════════ TABS + ROUTER ═══════════════ */
function render(){
  if(TAB==='guide')TAB='overview';        // the tab is gone; anyone parked on it lands home
  setTimeout(()=>{const b=$('dlvBtn');if(!b)return;const n=inboundCount();
    b.innerHTML='Deliveries'+(n?` <span class="chip info" style="margin-left:5px">${fmt(n)}</span>`:'');},0);
  const t=[['overview','Action centre',''],['products','Products',D.products.length],
           ['components','Components',D.components.length],
           ['restocks','Restocks',''],
           ['planner','Planner',''],
           ['purchases','Purchases',(()=>{const n=D.purchases.filter(x=>allocState(x).k==='none').length;return n?'· '+n+' to link':'';})()],
           ['history','History',''],   // the count was noise — nobody acts on "301"

           ['settings','Settings','']];   // How it works retired — the pages explain themselves now
  $('lav3Tabs').innerHTML=t.map(([k,l,c])=>`<button class="${TAB===k?'on':''}" onclick="LV3.go('${k}')">${l}${c!==''?`<span class="cnt">${c}</span>`:''}</button>`).join('');
  ({overview:vOverview,products:vProducts,components:vComponents,restocks:vRestocks,planner:vPlanner,purchases:vPurchases,history:vHistory,settings:vSettings,guide:vGuide})[TAB]();
  try{paintHealth();}catch(e){console.warn('health paint',e);}
  stickWatch();          // after layout, not mid-render
  save();
}
/* NO auto-sync on opening Purchases — Jack, 30 Aug: "let UK staff sync it as
   she can move, we had issues last time it auto-synced." The button is the only
   trigger; the top bar makes it one obvious click. */
function go(t){TAB=t;Q='';render();window.scrollTo(0,0);}

/* The tab bar's height and where it sticks both change with the window, so the
   filter bar and table headings can't sit at hardcoded offsets — rows were
   scrolling through the gap. Measure once per render and let CSS follow. */
/* Reading the CSS `top` value guessed where the tab bar WOULD stick. What
   matters is where it actually is, which changes with the app header above it —
   so measure its real bottom edge, and keep measuring as the page scrolls.
   Anything else leaves a band where rows scroll past in the open. */
let _stickRaf=0,_stickRO=null,_stickBusy=0;
/* Where the filter bar and column headings pin. #page-lavarion has
   overflow-y:auto, so it is its own scrollport and these offsets are measured
   from IT, not the window.

   The measurement itself was never the hard part — keeping it CURRENT was. The
   filter bar wraps to two lines at some window widths (it holds filters, a
   search box, a sort menu and four buttons), and when it did, the headings
   stayed pinned at the old height and rows scrolled through the gap. So both
   bars are watched with a ResizeObserver: change height for any reason and the
   offsets follow in the same frame. */
function syncSticky(){
  const root=document.getElementById('page-lavarion')||document.querySelector('.lav3');
  if(!root)return;
  const bar=root.querySelector('.lav3bar');
  if(!bar)return;
  const barBox=bar.getBoundingClientRect();
  if(!barBox.height)return;              // page hidden — nothing to measure yet
  /* Where the bar's bottom edge ACTUALLY sits inside the scrollport. Reading the
     CSS `top` and adding the height assumed the bar was stuck; if it has scrolled
     away (it un-sticks on narrow windows) that guess is too big and everything
     below it hangs in mid-air. Clamped at 0 so the bars never pin off-screen. */
  const phTop=Math.max(0,Math.round(barBox.bottom-root.getBoundingClientRect().top));
  if(root.style.getPropertyValue('--lavPh')!==phTop+'px')
    root.style.setProperty('--lavPh',phTop+'px');
  const ph=root.querySelector('.panel.stick>.ph');
  /* floor, not round: a filter strip 55.5px tall rounded up to 56 pinned the
     headings half a pixel BELOW its bottom edge, and rows showed through the
     hairline. Rounding down overlaps instead, and the strip sits on top. */
  const phH=Math.floor(ph?ph.getBoundingClientRect().height:0)||47;
  const thTop=phTop+phH;
  if(root.style.getPropertyValue('--lavTh')!==thTop+'px')
    root.style.setProperty('--lavTh',thTop+'px');
  watchStickyBars(bar,ph);
}
function watchStickyBars(bar,ph){
  if(typeof ResizeObserver==='undefined')return;
  if(!_stickRO)_stickRO=new ResizeObserver(()=>{stickWatch();});
  /* re-observing the same element is a no-op, and the panel header is a new
     node after every render, so this has to run each time */
  try{_stickRO.disconnect();
    if(bar)_stickRO.observe(bar);
    if(ph)_stickRO.observe(ph);
  }catch(e){}
}
/* This used to defer the measurement to requestAnimationFrame behind a latch.
   requestAnimationFrame does not fire while the tab is in the background, so if
   the first call happened before the page was on screen the latch stayed shut
   and EVERY later call returned immediately. The offsets were never written at
   all, both bars fell back to their hardcoded CSS values (52px / 99px) against a
   47px tab bar, and rows scrolled through the leftover band. That is the gap.
   Measuring is two getBoundingClientRect calls and only writes when a number
   really changed, so it is cheap enough to just do. */
function stickWatch(){
  if(_stickBusy)return;                 // re-entrancy only; always released below
  _stickBusy=1;
  try{syncSticky();}catch(e){}
  _stickBusy=0;
}
window.addEventListener('resize',stickWatch,{passive:true});
document.addEventListener('scroll',stickWatch,{passive:true,capture:true});
/* a tab measured while hidden measures nothing — redo it when it comes forward */
document.addEventListener('visibilitychange',()=>{if(!document.hidden)stickWatch();});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(stickWatch).catch(()=>{});

/* ═══════════════ OVERVIEW ═══════════════ */
/* The morning question is "what do I do", not "what are the numbers". This
   answers it: one line per job, biggest consequence first, each one a click
   away from the place it gets done. It disappears when there is nothing to do,
   which is the point. */
/* ═══ THE MODEL EVERY LAVARION SURFACE READS ═══
   Jack, 5 Sep: "the numbers disagree with each other" — 6 vs 4 out of stock,
   4 vs 5 to send, 9 jobs vs 46 things. One function now works the answers
   out; Overview, Planner and the top strip all print from it. */
function _isCollect(l){
  const m=l.mode||(D.settings.supplierModes||{})[String(l.sup||'').toLowerCase().trim()];
  return m==='collect';
}
/* "Not reordering" — Jack, 5 Sep: the buy list nagged for ever about parts he
   had decided not to buy again. Set aside until the part's stock actually
   changes (or for 7 days with "Later"). */
function _buySkip(o){
  const S=(D.settings.buySkip||{})[o.id];if(!S)return null;
  if(S.hand!=null&&S.hand!==onHand(o)){delete D.settings.buySkip[o.id];return null;}
  if(S.until&&S.until<dayISO()){delete D.settings.buySkip[o.id];return null;}
  return S;
}
function buySkipSet(id,mode){
  const o=comp(id)||prod(id);if(!o)return;
  D.settings.buySkip=D.settings.buySkip||{};
  const by=window.currentUserName||'someone';
  if(mode==='later')D.settings.buySkip[id]={until:addCalDays(dayISO(),7),by,at:dayISO()};
  else if(mode==='clear')delete D.settings.buySkip[id];
  else D.settings.buySkip[id]={until:null,hand:onHand(o),by,at:dayISO()};
  savePrefs();
  try{logIt('edit',mode==='later'?('Buy list: “'+o.name+'” — ask again in 7 days')
    :mode==='clear'?('Buy list: “'+o.name+'” back on the list')
    :('Buy list: “'+o.name+'” — not reordering until its stock changes'));}catch(e){}
  render();
}
function ovModel(){
  const PE=plData();const act=PE.az.act||[];
  const send=act.filter(r=>r.alloc>0).slice().sort((a,b)=>a.protDays-b.protDays);
  const sendUnits=send.reduce((t,r)=>t+r.alloc,0);
  const short=act.filter(r=>r.alloc<r.rec);
  const oosBlocked=short.filter(r=>(r.sell||0)<=0&&r.alloc===0);
  const oosSendable=act.filter(r=>(r.sell||0)<=0&&r.alloc>0);
  /* one row per blocking part — order that ONE part and everything under it
     unblocks; "if stuff is on the way it's n/a" is decided here, once */
  const by={};short.forEach(r=>{const k=r.lim?r.lim.id:'—';(by[k]=by[k]||{part:r.lim||null,rows:[]}).rows.push(r);});
  const parts=Object.keys(by).map(k=>{const g=by[k];
    g.rows.sort((a,b)=>a.protDays-b.protDays);
    g.worst=g.rows[0];g.gap=g.part?plGapInfo(g.worst):null;
    g.oos=g.rows.some(r=>(r.sell||0)<=0&&r.alloc===0);
    g.missing=g.rows.reduce((t,r)=>t+Math.max(0,(r.rec||0)-(r.alloc||0)),0);
    return g;}).sort((a,b)=>(a.oos===b.oos?0:(a.oos?-1:1))||(a.worst.protDays-b.worst.protDays));
  const buysAll=PE.buys.filter(L=>!L.isProd&&L.buyQty>0&&(L.state==='buy'||L.state==='soon'));
  const onWay=buysAll.filter(L=>(L.pendQty||0)>0);
  const skipped=buysAll.filter(L=>!((L.pendQty||0)>0)&&L.skip);
  const buys=buysAll.filter(L=>!((L.pendQty||0)>0)&&!L.skip);
  /* "LovePubSnacks" and "Love Pub Snacks" are one supplier and one order —
     group on the squashed name, show the first spelling seen */
  const bySup={};buys.forEach(L=>{const raw=(L.sup||'?').trim();const k=raw.toLowerCase().replace(/[^a-z0-9]/g,'')||'?';(bySup[k]=bySup[k]||{sup:raw,lines:[]}).lines.push(L);});
  const sups=Object.keys(bySup).map(k=>{const g=bySup[k];
    g.cost=g.lines.reduce((t,L)=>t+(L.cost||0),0);
    g.byDays=Math.min.apply(null,g.lines.map(L=>L.buyByDays==null?999:L.buyByDays));
    g.lines.sort((a,b)=>(a.buyByDays==null?999:a.buyByDays)-(b.buyByDays==null?999:b.buyByDays));
    return g;}).sort((a,b)=>a.byDays-b.byDays);
  const buyCost=buys.reduce((t,L)=>t+(L.cost||0),0);
  const inbound=inboundAll().filter(x=>!x.l.short).map(x=>{let st=null;try{st=etaState(x.l);}catch(e){}
    const due=String(x.l.eta2||x.l.eta1||'').slice(0,10);
    const collect=_isCollect(x.l);
    return{x,due:due||'9999',st,late:!!(st&&st.k==='late')&&!collect,soon:!!(st&&st.k==='soon'),collect};})
    .sort((a,b)=>a.due.localeCompare(b.due));
  const week=inbound.filter(g=>g.soon||g.late).length;
  return{PE,act,send,sendUnits,short,oosBlocked,oosSendable,parts,buys,onWay,skipped,sups,buyCost,inbound,week};
}
/* the jobs that are NOT stock movements — link a purchase, set a route, and
   Jack's data fixes. Stock jobs (send / parts / buy) live in the Overview
   panels and clear themselves; these keep their DONE tick. */
function houseList(){
  const jobs=[];
  const orders=reviewOrders();
  const live=D.products.filter(p=>!p.archived);
  const stale=live.filter(p=>{const a=sold30Age(p);return a!=null&&a>=30;}).length;
  const owed=[];
  Object.keys((D.settings||{}).overSent||{}).forEach(asin=>{
    const n=overSentFor(asin);if(!n)return;
    const pr=live.find(x=>x.asin===asin);
    owed.push({asin,n,name:(pr&&pr.name)||asin});
  });
  const owedUnits=owed.reduce((a,b)=>a+b.n,0);
  if(owed.length)jobs.push({k:'owed',o:'jack',sev:1,n:owedUnits,
    t:`${fmt(owedUnits)} unit${owedUnits===1?'':'s'} went out that we did not have`,
    s:owed.slice(0,3).map(o=>`${esc(o.name)} (${o.n})`).join(', ')+(owed.length>3?` +${owed.length-3} more`:'')
      +' — approved at the time; settle it once the delivery lands',
    btn:'Settle',go:"openOverSent()"});
  if(orders.length)jobs.push({k:'link',o:'wh',sev:2,n:orders.length,
    t:`${fmt(orders.length)} order${orders.length===1?'':'s'} waiting to be linked`,
    s:'They are not stock until someone says what they are',btn:'Review',go:"go('purchases')"});
  const ra=routeAsks();
  if(ra.lines.length)jobs.push({k:'route',o:'wh',sev:2,n:ra.lines.length,
    t:`${fmt(ra.lines.length)} deliver${ra.lines.length===1?'y':'ies'} — nobody has said how ${ra.lines.length===1?'it is':'they are'} coming`,
    s:`${esc(ra.sups.slice(0,3).join(', '))}${ra.sups.length>3?` +${ra.sups.length-3} more`:''} — pick the route once per supplier on Deliveries and every order from them dates itself.`,
    btn:'Deliveries',go:"openDeliveries()"});
  const _orph=D.components.filter(c=>!c.archived&&!c.untracked&&!usedIn(c.id).length&&(onHand(c)>0||onOrder(c)>0));
  if(_orph.length){const _ov=_orph.reduce((t,c)=>t+arrLayers(c).reduce((a,l)=>a+l.rem*l.cost,0),0);
    jobs.push({k:'orphans',o:'jack',sev:3,n:_orph.length,
      t:`${fmt(_orph.length)} component${_orph.length===1?' holds':'s hold'} stock but ${_orph.length===1?"isn't":"aren't"} in any product`,
      s:_orph.slice(0,3).map(c=>esc(c.name)).join(', ')+(_orph.length>3?` +${_orph.length-3} more`:'')+(_ov?` — ${gbp(_ov)} sitting idle`:''),
      btn:'Components',go:"setFilter('c','all');go('components')"});}
  if(stale)jobs.push({k:'stale',o:'jack',sev:3,n:stale,
    t:`${fmt(stale)} sales figure${stale===1?'':'s'} over a month old`,
    s:'Worth refreshing from Seller Central',btn:'Update',go:"go('products')"});
  try{
    healthCheck().forEach(i=>jobs.push({
      k:'h_'+String(i.label||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40),
      o:'jack',sev:i.sev==='bad'?1:2,t:i.label,
      s:String(i.detail||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(),
      btn:i.fix?(i.btn||'Repair'):'Show me',go:i.fix?null:i.go,fix:i.fix||null}));
  }catch(e){console.warn('worklist health',e);}
  jobs.sort((a,b)=>a.sev-b.sev);
  D.settings.wlAck=D.settings.wlAck||{};
  const parked=jobs.filter(j=>j.k&&D.settings.wlAck[j.k]);
  const show=jobs.filter(j=>!(j.k&&D.settings.wlAck[j.k]));
  return{wh:show.filter(j=>j.o==='wh'),jack:show.filter(j=>j.o!=='wh'),parked};
}
function wlRowHtml(j,dim){
  return `<div class="wlRow s${j.sev}"${dim?' style="opacity:.55"':''}>
      <span class="wlDot"></span>
      <div class="wlTxt"><b>${j.t}</b><span>${dim?('done — '+esc((D.settings.wlAck[j.k]||{}).by||'someone')):j.s}</span></div>
      ${dim?`<button class="btn sm" onclick="LV3.wlUntick('${j.k}')">Bring back</button>`
        :`<button class="btn sm ${j.sev===1?'warn':''}" onclick="event.stopPropagation();${j.fix?j.fix:'LV3.'+j.go}">${esc(j.btn)}</button>
      ${j.k?`<button class="btn sm ghost" title="Done — it leaves the list" onclick="event.stopPropagation();LV3.wlTick('${j.k}')">DONE</button>`:''}`}</div>`;
}
function workList(){return '';}   /* retired 5 Sep — the Action centre replaced it */
/* Snooze — Jack, 5 Sep: "SNOOZE 3 DAYS, or choose." Snoozed lines sit in a
   strip at the bottom and come back at the top when their date arrives. */
function acSnooze(k,days,btn){
  D.settings.acSnooze=D.settings.acSnooze||{};
  if(days==='pick'){
    const host=btn&&btn.parentElement;if(!host||host.querySelector('.acPick'))return;
    const inp=document.createElement('input');inp.type='date';inp.className='acPick in';inp.min=dayISO();
    inp.onchange=()=>{if(inp.value){D.settings.acSnooze[k]={until:inp.value,by:window.currentUserName||'someone'};savePrefs();render();}};
    host.appendChild(inp);setTimeout(()=>inp.focus(),30);return;}
  D.settings.acSnooze[k]={until:addCalDays(dayISO(),+days||3),by:window.currentUserName||'someone'};
  savePrefs();
  try{logIt('edit','Action centre: snoozed “'+String(k).replace(/_/g,' ')+'” for '+days+' days');}catch(e){}
  render();
}
function acUnsnooze(k){if(D.settings.acSnooze)delete D.settings.acSnooze[k];savePrefs();render();}
let _wlWho=(function(){try{return localStorage.getItem('lv3_wlwho')||'all';}catch(e){return 'all';}})();
function wlWho(k){_wlWho=k;try{localStorage.setItem('lv3_wlwho',k);}catch(e){}render();}
function wlTick(k){
  D.settings.wlAck=D.settings.wlAck||{};
  D.settings.wlAck[k]={d:dayISO(),by:(window.currentUserName||'someone')};
  savePrefs();
  try{logIt('edit','Action centre: ticked off \u201c'+k.replace(/_/g,' ')+'\u201d for today');}catch(e){}
  render();
}
function wlUntick(k){
  D.settings.wlAck=D.settings.wlAck||{};
  delete D.settings.wlAck[k];
  savePrefs();render();
}
function vOverview(){
  const live=D.products.filter(p=>!p.archived);
  const blockedAll=live.filter(p=>{const a=avail(p);return a.kind!=='norecipe'&&a.n===0;});
  const blocked=blockedAll.filter(p=>!acked(p));
  const ackedCount=blockedAll.length-blocked.length;
  const low=live.filter(p=>{const t=target60(p);return t&&(avail(p).n||0)<t&&avail(p).n>0;});
  const incoming=D.components.reduce((s,c)=>s+onOrder(c),0)+live.reduce((s,p)=>s+onOrder(p),0);
  const shipped=live.reduce((s,p)=>s+(p.ship30||0),0);
  const stockVal=D.components.reduce((s,c)=>s+arrLayers(c).reduce((a,l)=>a+l.rem*l.cost,0),0)
                +live.reduce((s,p)=>s+arrLayers(p).reduce((a,l)=>a+l.rem*l.cost,0),0);
  const sendable=live.reduce((s,p)=>{const a=avail(p);return s+(a.n||0);},0);
  const unlinked=D.purchases.filter(p=>['none','broken'].includes(allocState(p).k)).length;

  const RAIL={'var(--grn)':'c-grn','var(--red)':'c-red','var(--blu)':'c-blue','var(--amb)':'c-amb','var(--vio)':'c-vio','var(--accent)':'c-acc'};
  const kpi=(k,v,s,col,click,on)=>`<div class="kpi ${RAIL[col]||'c-acc'} ${click?'clk':''}${on?' on':''}" ${click?`onclick="${click}"`:''}>
    <div class="k">${k}</div><div class="v" style="color:${col||'var(--text)'}">${v}</div><div class="s">${s}</div></div>`;

  /* OUT OF STOCK — the only list that actually stops work */
  const sendableProds=live.filter(p=>(avail(p).n||0)>0);
  /* stock sitting in components nothing is built from — invisible money */
  const orphans=D.components.filter(c=>!c.archived&&!c.untracked&&!usedIn(c.id).length&&(onHand(c)>0||onOrder(c)>0));
  const orphanVal=orphans.reduce((t,c)=>t+arrLayers(c).reduce((a,l)=>a+l.rem*l.cost,0),0);
  const oosComps=D.components.filter(c=>!c.archived&&!c.untracked&&onHand(c)===0&&usedIn(c.id).length&&!acked(c));
  const oosOwn=D.products.filter(p=>p.type!=='bundle'&&onHand(p)===0);

  const inbound=[];
  D.components.forEach(c=>(c.layers||[]).filter(l=>!l.arr).forEach(l=>inbound.push({o:c,l,type:'component'})));
  D.products.forEach(p=>(p.layers||[]).filter(l=>!l.arr).forEach(l=>inbound.push({o:p,l,type:'product'})));
  inbound.sort((a,b)=>a.l.date.localeCompare(b.l.date));

  if(isEmpty()){
    const s1=D.components.length>0,s2=D.products.length>0,s3=D.products.some(p=>p.recipe.length);
    $('lav3View').innerHTML=`
    <div class="panel" style="max-width:760px">
      <div class="ph"><span class="t">Set Lavarion up</span><span class="sub">four steps, then it runs itself</span></div>
      <div class="setup ${s1?'done':''}"><span class="n">${s1?'✓':'1'}</span>
        <span class="tx"><b>Add your components</b><span class="s">Every part and box that goes into a bundle — paste the lot in one go.</span></span>
        <button class="btn ${s1?'':'pri'}" onclick="LV3.openBulkComp()">Bulk add components</button></div>
      <div class="setup ${s2?'done':''}"><span class="n">${s2?'✓':'2'}</span>
        <span class="tx"><b>Add your products</b><span class="s">Every Lavarion ASIN, each tagged bundle or private label.</span></span>
        <button class="btn ${s2?'':(s1?'pri':'')}" onclick="LV3.openBulkProd()">Bulk add products</button></div>
      <div class="setup ${s3?'done':''}"><span class="n">${s3?'✓':'3'}</span>
        <span class="tx"><b>Set what each bundle is made of</b><span class="s">Pick the parts for a bundle and how many go into one unit. Do several at a time.</span></span>
        <button class="btn ${s3?'':(s2?'pri':'')}" onclick="LV3.openBulkRecipe()">Bulk build lists</button></div>
      <div class="setup"><span class="n">4</span>
        <span class="tx"><b>Link the purchase sheet</b><span class="s">Stock and cost then arrive on their own from Lavarion Q1–Q4.</span></span>
        <button class="btn" onclick="LV3.go('settings')">Settings</button></div>

    </div>`;
    return;
  }
  /* ═══ THE ACTION CENTRE (Jack, 5 Sep) ═══
     "The whole reason we're building these systems is to remove the need for
     her to work out what to do next." One list, ranked: LATE → TODAY → NEXT 3
     DAYS → THIS WEEK → CAN WAIT. Every line says what to do and why, and
     carries its own button plus Snooze and DONE. DONE means done — it hides
     the line and trusts her; it does not wait for the Purchase Sheet to catch
     up (an Alibaba order takes weeks to cost). Everything here is Becky's. */
  const M=ovModel();const H=houseList();
  const today=dayISO();const fba=fbaCalDays(),trig=fba+safetyDays();
  D.settings.acSnooze=D.settings.acSnooze||{};D.settings.wlAck=D.settings.wlAck||{};
  Object.keys(D.settings.acSnooze).forEach(k=>{const z=D.settings.acSnooze[k];if(!z||!z.until||z.until<today)delete D.settings.acSnooze[k];});
  const A=[];const add=o=>A.push(o);
  const bandOf=d=>d<0?'late':d===0?'today':d<=3?'soon':d<=7?'week':'wait';
  /* SEND */
  M.send.forEach(r=>{const oos=(r.sell||0)<=0;const cov=Math.round(r.protDays||0);
    add({k:'send_'+r.p.id,band:oos?'late':cov<=fba?'today':cov<=trig?'soon':'week',
      do:`Build &amp; send <b>${fmt(r.alloc)}</b> × ${esc(r.p.name)}`,
      why:(oos?'Amazon is empty — losing sales now':`${cov}d of cover left`)+(r.alloc<r.rec?` · only ${fmt(r.alloc)} of ${fmt(r.rec)} can be built${r.lim?' — short of '+esc(r.lim.name):''}`:''),
      col:oos?'#ef4444':cov<=fba?'#fb923c':'#4ade80',btn:'Ship',go:`openShip('${r.p.id}')`});});
  /* PARTS holding products up */
  M.parts.forEach(g=>{const g2=g.gap||{kind:'none'};const names=g.rows.map(r=>r.p.name);
    const who=g.part?esc(g.part.name):esc(names[0]);
    const list=g.rows.length===1?esc(names[0]):fmt(g.rows.length)+' products — '+esc(names.slice(0,3).join(', '))+(names.length>3?' +'+(names.length-3):'');
    const key='part_'+(g.part?g.part.id:g.worst.p.id);
    if(!g.part){add({k:key,band:g.oos?'late':'today',col:g.oos?'#ef4444':'#fb923c',do:`Buy <b>${who}</b> — none in stock`,why:(g.oos?'Amazon is empty':'nothing to build from')+(g.missing?` · ${fmt(g.missing)} wanted`:''),btn:'Order it',go:`openLogOrder('${g.worst.p.id}')`});return;}
    if(g2.kind==='intime'){add({k:key,band:'wait',col:'#60a5fa',do:`Nothing to do — <b>${fmt(g2.qty)} ${who}</b> land ${dshort(g2.eta)}, in time`,why:`then build ${list}`,btn:'Open',go:`openPlanRow('${g.worst.p.id}')`});return;}
    if(g2.kind==='late'){add({k:key,band:g.oos?'late':'week',col:g.oos?'#ef4444':'#fb923c',do:`Waiting on <b>${fmt(g2.qty)} ${who}</b> — land ${dshort(g2.eta)}`,why:(g.oos?'Amazon is empty until then · ':`after the shelf empties ~${dshort(g.worst.stockout)} · `)+`holds up ${list}`,btn:'Open',go:`openPlanRow('${g.worst.p.id}')`});return;}
    if(g2.kind==='noeta'){add({k:key,band:'today',col:'#fbbf24',do:`Set the delivery method on <b>${fmt(g2.qty)} ${who}</b> on order`,why:`nobody can say if it lands in time · holds up ${list}`,btn:'Deliveries',go:'openDeliveries()'});return;}
    add({k:key,band:g.oos?'late':'today',col:g.oos?'#ef4444':'#fb923c',do:`Order <b>${who}</b> — nothing on order`,why:(g.oos?'Amazon is empty · ':'')+`holds up ${list}`+(g.missing?` · ${fmt(g.missing)} units waiting`:''),btn:'Order it',go:`openLogOrder('${g.part.id}')`});});
  /* BUY — one line per supplier; the key changes when the set of parts does */
  M.sups.forEach(g=>{const d=g.byDays,lines=g.lines;
    add({k:'buy_'+g.sup.toLowerCase().replace(/[^a-z0-9]/g,'')+'_'+lines.map(L=>String(L.o.id)).sort().join('.'),band:bandOf(d),
      col:d<0?'#ef4444':d===0?'#fb923c':d<=3?'#fbbf24':'#7f8896',
      do:`Order from <b>${esc(g.sup)}</b> — ${lines.slice(0,4).map(L=>fmt(L.buyQty)+' × '+esc(L.o.name)).join(', ')}${lines.length>4?' +'+(lines.length-4)+' more':''}`,
      why:(d<0?`should have gone ${fmt(-d)}d ago`:d===0?'order today':`order by ${dshort(addCalDays(today,d))}`)+` · ${fmt(lines.length)} part${lines.length===1?'':'s'}`,
      money:g.cost,parts:lines,btn:'Log order',go:`openLogOrder('${lines[0].o.id}')`});});
  /* ARRIVING — a delivery is an action when it is due or overdue */
  M.inbound.forEach(g=>{const x=g.x;const due=g.due;
    const d=due==='9999'?99:Math.round((new Date(due)-new Date(today))/864e5);
    const band=g.late?'late':bandOf(d);
    if(band==='wait'&&d>14)return;
    add({k:'arr_'+x.l.id,band,col:g.late?'#ef4444':d<=0?'#fb923c':d<=3?'#fbbf24':'#60a5fa',
      do:`Receive <b>${fmt(x.l.qty)} × ${esc(x.o.name)}</b> from ${esc(x.l.sup||'?')}`,
      why:g.collect?'collection'+(due!=='9999'?' · '+dshort(due):''):g.late?(((g.st&&g.st.sub)||'overdue')+' — chase the supplier for a date'):due!=='9999'?'due '+dshort(due):'no date set',
      btn:'Receive',go:`markArrived('${x.kind}','${x.o.id}','${x.l.id}')`});});
  /* a purchase to name, a route to set */
  H.wh.forEach(j=>add({k:j.k,band:'week',col:'#fbbf24',do:j.t,why:j.s,btn:j.btn,go:j.go}));
  /* DONE and snoozed — acks for lines that no longer exist clean themselves up */
  const ack=D.settings.wlAck,snz=D.settings.acSnooze;
  const liveKeys=new Set(A.map(a=>a.k).concat(H.jack.map(j=>j.k)));
  Object.keys(ack).forEach(k=>{if(!liveKeys.has(k))delete ack[k];});
  const todo=A.filter(a=>!ack[a.k]&&!snz[a.k]);
  const doneN=A.filter(a=>ack[a.k]).length;const snoozed=A.filter(a=>snz[a.k]&&!ack[a.k]);
  const BANDS=[['late','LATE','#ef4444','should already have happened'],['today','TODAY','#fb923c','do these before anything else'],['soon','NEXT 3 DAYS','#fbbf24','becoming urgent'],['week','THIS WEEK','#60a5fa','plan them in'],['wait','CAN WAIT','#7f8896','nothing to do yet — here so you know']];
  const order={late:0,today:1,soon:2,week:3,wait:4};
  /* inside a band: an empty Amazon shelf outranks a late purchase order */
  const pri=a=>a.k.startsWith('send_')?0:a.k.startsWith('part_')?1:a.k.startsWith('arr_')?2:a.k.startsWith('buy_')?3:4;
  todo.sort((a,b)=>order[a.band]-order[b.band]||pri(a)-pri(b)||(b.money||0)-(a.money||0));
  const nB=b=>todo.filter(a=>a.band===b).length;
  /* Jack, 10 Sep: "make the KPIs interactive — clickable like filters". One
     press shows only that band; pressing it again shows everything. */
  const _only=_acOnly;
  const row=a=>`<div class="acRow" style="border-left-color:${a.col};">
      <div class="acMain"><div class="acDo">${a.do}</div>${a.why?`<div class="acWhy">${a.why}</div>`:''}
        ${a.parts?`<details class="acParts"><summary>${fmt(a.parts.length)} part${a.parts.length===1?'':'s'} — log or set aside one at a time ▾</summary>${a.parts.map(L=>`<div class="acPart"><span class="acPartName">${esc(L.o.name)}</span><b>${fmt(L.buyQty)}${(L.cases&&L.caseQty>1)?` <small>${fmt(L.cases)} × ${fmt(L.caseQty)}</small>`:''}</b><span class="ovMoney sm">${gbp(L.cost||0)}</span>${L.buyByDays<0?`<span class="ovChip" style="color:#ef4444;border-color:#ef444455;background:#ef44441a;">${fmt(-L.buyByDays)}d overdue</span>`:''}<span class="ovGap"></span><button class="btn sm" onclick="LV3.openLogOrder('${L.o.id}')">Log order</button><button class="btn sm ghost" onclick="LV3.buySkipSet('${L.o.id}','skip')" title="Not buying this again — until its stock changes">Not reordering</button></div>`).join('')}</details>`:''}
      </div>
      ${a.money?`<span class="ovMoney">${gbp(a.money)}</span>`:''}
      <div class="acBtns">
        <button class="btn sm pri" onclick="LV3.${a.go}">${esc(a.btn)}</button>
        <button class="btn sm ghost" title="Snooze 3 days — it comes back at the top when the time is up" onclick="LV3.acSnooze('${a.k}',3)">Snooze 3d</button>
        <button class="btn sm ghost" title="Pick the day it should come back" onclick="LV3.acSnooze('${a.k}','pick',this)">&hellip;</button>
        <button class="btn sm ok" title="Done — it leaves the list and stays gone. Nothing checks the Purchase Sheet." onclick="LV3.wlTick('${a.k}')">DONE</button>
      </div></div>`;
  const sections=BANDS.map(([b,lab,col,sub])=>{if(_only&&b!==_only)return '';const g=todo.filter(a=>a.band===b);if(!g.length)return '';
    return `<details class="acSec" id="ac-${b}" ${b!=='wait'?'open':''}><summary><span class="acSecLab" style="color:${col}">${lab}</span><span class="acSecN" style="color:${col};border-color:${col}55;background:${col}1a;">${fmt(g.length)}</span><span class="ovDim">${sub}</span></summary>${g.map(row).join('')}</details>`;}).join('');
  const buyFoot=(M.onWay.length||M.skipped.length)?`<div class="ovFoot">
      ${M.onWay.length?`<span>Already on order — nothing to do: ${esc(M.onWay.slice(0,5).map(L=>L.o.name).join(', '))}${M.onWay.length>5?' +'+(M.onWay.length-5):''}</span>`:''}
      ${M.skipped.length?`<span>Set aside: ${M.skipped.map(L=>`${esc(L.o.name)} <a href="javascript:void(0)" onclick="LV3.buySkipSet('${L.o.id}','clear')">bring back</a>`).join(' · ')}</span>`:''}</div>`:'';
  const jackN=H.jack.length;
  const jackHtml=`<details class="panel ovJack">
      <summary><span class="ovJackT">For Jack</span>
        <span class="ovJackN" style="color:${jackN?'#fbbf24':'var(--text3)'}">${fmt(jackN)} ${jackN===1?'thing':'things'}</span>
        <span class="ovDim">stock value <b>${gbp(stockVal)}</b> · shipped 30d <b>${fmt(shipped)}</b> · on order <b>${fmt(incoming)}</b> units</span>
        ${H.parked.length?`<span class="ovDim" style="color:var(--grn)">${fmt(H.parked.length)} done</span>`:''}
        <span class="ovDim" style="margin-left:auto;">open ▾</span></summary>
      ${H.jack.map(j=>wlRowHtml(j)).join('')||'<div class="ovEmpty"><span class="ovTick">✓</span>Nothing for Jack.</div>'}
      ${H.parked.map(j=>wlRowHtml(j,true)).join('')}
      <div class="pmeta" style="padding:7px 14px;border-top:1px solid var(--border);">Sarah’s chases are not listed here — they land on her Admin page automatically.</div>
    </details>`;
  $('lav3View').innerHTML=`
  <div class="kpis">
    ${kpi('Late',fmt(nB('late')),_only==='late'?'showing only these — press again for all':(nB('late')?'should already have happened':'nothing late'),nB('late')?'var(--red)':'var(--grn)',"LV3.acOnly('late')",_only==='late')}
    ${kpi('Today',fmt(nB('today')),_only==='today'?'showing only these — press again for all':(nB('today')?'do these first':'nothing due today'),nB('today')?'var(--amb)':'var(--grn)',"LV3.acOnly('today')",_only==='today')}
    ${kpi('Next 3 days',fmt(nB('soon')),_only==='soon'?'showing only these — press again for all':(nB('soon')?'becoming urgent':'clear'),'var(--accent)',"LV3.acOnly('soon')",_only==='soon')}
    ${kpi('This week',fmt(nB('week')),_only==='week'?'showing only these — press again for all':(nB('week')?'plan them in':'clear'),'var(--blu)',"LV3.acOnly('week')",_only==='week')}
  </div>
  <div class="panel acPanel">
    <div class="ph"><span class="t">Action centre</span><span class="sub">${fmt(todo.length)} thing${todo.length===1?'':'s'} · work top to bottom · DONE means done · Snooze brings it back later</span>
      ${doneN?`<div class="r"><span class="ovDim" style="color:var(--grn)">${fmt(doneN)} done</span></div>`:''}</div>
    ${todo.length?sections:'<div class="ovEmpty"><span class="ovTick">✓</span>Nothing needs doing. Everything is stocked, ordered or on its way.</div>'}
    ${snoozed.length?`<details class="acSec" id="ac-snoozed"><summary><span class="acSecLab" style="color:#7f8896">SNOOZED</span><span class="acSecN" style="color:#7f8896;border-color:#7f889655;background:#7f88961a;">${fmt(snoozed.length)}</span><span class="ovDim">back on their date</span></summary>${snoozed.map(a=>`<div class="acRow" style="border-left-color:#3a4048;opacity:.75"><div class="acMain"><div class="acDo">${a.do}</div><div class="acWhy">back ${dshort(snz[a.k].until)} · snoozed by ${esc(snz[a.k].by||'')}</div></div><div class="acBtns"><button class="btn sm ghost" onclick="LV3.acUnsnooze('${a.k}')">Bring back now</button></div></div>`).join('')}</details>`:''}
    ${buyFoot}
  </div>
  ${jackHtml}`;
}
const typeLabel=t=>t==='bundle'?'Bundle':t==='pl'?'Private label':'Single';   // 'single' kept only for legacy rows

/* ═══════════════ PRODUCTS ═══════════════ */
/* Two products on one ASIN is silent poison: sales and stock split across
   them, so both look quiet and neither number is right. Flag it loudly, name
   the rows, and let someone look. */
function dupeAsins(){
  const by={};
  D.products.filter(p=>!p.archived&&p.asin).forEach(p=>{
    const k=p.asin.trim().toUpperCase();(by[k]=by[k]||[]).push(p);});
  return Object.keys(by).filter(k=>by[k].length>1).map(k=>({asin:k,list:by[k]}));
}
function dupeBanner(){
  const d=dupeAsins();
  if(!d.length)return '';
  const total=d.reduce((t,x)=>t+x.list.length,0);
  return `<div class="dupbar">
    <span class="dupIcon">!</span>
    <div class="dupTxt">
      <b>${fmt(d.length)} ASIN${d.length===1?' is':'s are'} on this page more than once</b>
      <span>${fmt(total)} products share ${d.length===1?'it':'them'}. Stock and sales split across the copies, so every figure for
      ${d.length===1?'that ASIN':'those ASINs'} is wrong until one is removed.</span>
      <div class="dupList">
        ${d.map(x=>`<div class="dupRow">
          <span class="dupAsin">${esc(x.asin)}</span>
          ${x.list.map(p=>`<button class="dupChip" onclick="LV3.openProduct('${p.id}')" title="Open this one">
            ${esc(p.name)}${p.sku?` · ${esc(p.sku)}`:''}
            <span>${p.recipe.length?`${p.recipe.length} part${p.recipe.length===1?'':'s'}`:'no build list'}</span></button>`).join('')}
        </div>`).join('')}
      </div>
    </div>
    <button class="btn sm" onclick="LV3.setQ('${esc(d[0].asin)}')">Show ${d.length===1?'them':'the first'}</button>
  </div>`;
}
/* Sorting. Alphabetical is fine for finding something you already know the name
   of; it is useless for deciding what to do next. Default stays A–Z so nothing
   moves under anyone unexpectedly. */
let pSort=(typeof localStorage!=='undefined'&&localStorage.getItem('lav3_pSort'))||'name';
let cSort=(typeof localStorage!=='undefined'&&localStorage.getItem('lav3_cSort'))||'urgent';
let pDir=+((typeof localStorage!=='undefined'&&localStorage.getItem('lav3_pDir'))||1)||1;
let cDir=+((typeof localStorage!=='undefined'&&localStorage.getItem('lav3_cDir'))||1)||1;
function setSort(which,v){
  if(which==='p'){pSort=v;pDir=1;try{localStorage.setItem('lav3_pSort',v);localStorage.setItem('lav3_pDir','1');}catch(e){}}
  else{cSort=v;cDir=1;try{localStorage.setItem('lav3_cSort',v);localStorage.setItem('lav3_cDir','1');}catch(e){}}
  render();
}
/* Click the heading to sort by it; click it again to turn it round. The
   dropdown stays — it names the sorts a heading cannot ("furthest below
   target") — but nobody looks for a dropdown when there is a column right
   there. */
function sortCol(which,k){
  if(which==='p'){pDir=(pSort===k)?-pDir:1;pSort=k;
    try{localStorage.setItem('lav3_pSort',k);localStorage.setItem('lav3_pDir',String(pDir));}catch(e){}}
  else{cDir=(cSort===k)?-cDir:1;cSort=k;
    try{localStorage.setItem('lav3_cSort',k);localStorage.setItem('lav3_cDir',String(cDir));}catch(e){}}
  render();
}
/* the heading itself: a button, with an arrow only on the one in use */
/* The ASIN is the join key between this app, the BDL hub and Seller Central —
   the titles differ everywhere, the ASIN never does. So it always copies. */
function copyAsin(a,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  if(!a){toast('No ASIN on this one','er');return;}
  const done=()=>toast(a+' copied','ok');
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(a).then(done,()=>fallback());}
    else fallback();
  }catch(e){fallback();}
  function fallback(){
    try{const t=document.createElement('textarea');t.value=a;t.style.position='fixed';t.style.opacity='0';
      document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();done();}
    catch(e2){toast('Could not copy — select it by hand','er');}
  }
}
const asinBtn=(a,cls)=>a
  ? `<button class="asinC ${cls||''}" title="Copy ${esc(a)}" onclick="LV3.copyAsin('${esc(a)}',event)">${esc(a)}</button>`
  : '<span class="dim">no ASIN</span>';
const sortTh=(which,k,label,sub)=>{
  const on=(which==='p'?pSort:cSort)===k, dir=(which==='p'?pDir:cDir);
  return `<button class="thSort${on?' on':''}" onclick="event.stopPropagation();LV3.sortCol('${which}','${k}')"
    title="Sort by this${on?' — click again to reverse':''}">${label}<span class="thArr">${on?(dir>0?'▲':'▼'):'↕'}</span>
    ${sub?`<span class="thSub">${sub}</span>`:''}</button>`;
};
const P_SORTS=[['name','Name A–Z'],['reorder','Action — most urgent first'],
               ['avail','Least available'],['atamz','Least at Amazon'],['sold','Best selling'],
               ['cog','Highest COG'],['incoming','Most incoming']];
const C_SORTS=[['urgent','What needs doing first'],['name','Name A–Z'],['short','Biggest buy first'],['cover','Least cover'],
               ['low','Least on hand'],['used','Used in most'],['order','Most on order']];
const incOf=p=>p.type==='bundle'
  ? p.recipe.reduce((t,r)=>{const c=comp(r.c);return t+(c?onOrder(c):0);},0) : onOrder(p);
function sortProducts(rows){
  const by={
    name:(a,b)=>a.name.localeCompare(b.name),
    avail:(a,b)=>(avail(a).n||0)-(avail(b).n||0),
    atamz:(a,b)=>(atAmz(a)||0)-(atAmz(b)||0),
    sold:(a,b)=>demand30(b)-demand30(a),
    cog:(a,b)=>(cogOf(b,1).per||0)-(cogOf(a,1).per||0),
    incoming:(a,b)=>incOf(b)-incOf(a),
    /* numeric, so 2 days sorts above 10 days. DUE NOW keeps its negative value
       internally so the most overdue leads; anything we cannot work out sorts
       to the bottom rather than pretending to be urgent. */
    reorder:(a,b)=>{const P=plData().azBy;
      const x=(P[a.id]||{}).protDays,y=(P[b.id]||{}).protDays;
      if(x==null&&y==null)return 0; if(x==null)return 1; if(y==null)return -1; return x-y;},
    /* soonest deadline first — the one that has to leave today comes above the
       one that has to leave in a fortnight */
    send:(a,b)=>{const x=sendBy(a),y=sendBy(b);return (x?x.left:1e9)-(y?y.left:1e9);}
  };
  /* A blank is not a small number. "Never counted" and "no sales figure" sink to
     the bottom whichever way the column is turned, rather than pretending to be
     a zero and topping a "least at Amazon" sort. */
  const blank={atamz:p=>atAmz(p)==null,sold:p=>sold30(p)==null,
    cog:p=>cogOf(p,1).short,send:p=>!sendBy(p)};
  const isBlank=blank[pSort],f=by[pSort]||by.name;
  return rows.slice().sort((a,b)=>{
    if(isBlank){const na=isBlank(a),nb=isBlank(b);if(na!==nb)return na?1:-1;}
    return pDir*f(a,b);
  });
}
function sortComponents(rows){
  /* the page's job is "what needs doing" — buys first (most overdue first),
     then routes to set, then the covered and the unknown. A–Z is one click
     away for anyone hunting a name; it is no longer the front door. */
  const _rank=c=>{
    if(c.untracked)return 9;
    const L=(function(){try{return (plData().byComp||{})[c.id];}catch(e){return null;}})();
    if(!L)return 8;
    return {buy:0,soon:1,noroute:2,nosup:2,upcoming:4,waiting:5,safe:6}[L.state]!==undefined
      ?{buy:0,soon:1,noroute:2,nosup:2,upcoming:4,waiting:5,safe:6}[L.state]:7;
  };
  const _urg=c=>{const L=(function(){try{return (plData().byComp||{})[c.id];}catch(e){return null;}})();
    return L&&L.buyByDays!=null?L.buyByDays:9999;};
  const by={
    urgent:(a,b)=>_rank(a)-_rank(b)||_urg(a)-_urg(b)||a.name.localeCompare(b.name),
    name:(a,b)=>a.name.localeCompare(b.name),
    short:(a,b)=>compShort60(b)-compShort60(a),
    low:(a,b)=>onHand(a)-onHand(b),
    used:(a,b)=>usedIn(b.id).length-usedIn(a.id).length,
    order:(a,b)=>onOrder(b)-onOrder(a),
    /* a part with no known demand has no cover — it sorts last rather than
       pretending to be the best-covered thing on the page */
    cover:(a,b)=>{const A=compCover(a),B=compCover(b);
      if(A==null&&B==null)return 0; if(A==null)return 1; if(B==null)return -1; return A-B;}
  };
  const f=by[cSort]||by.name;
  return rows.slice().sort((a,b)=>cDir*f(a,b));
}
const sortPicker=(which,val,opts)=>`<select class="in srt" title="Change the order" onchange="LV3.setSort('${which}',this.value)">
  ${opts.map(([k,l])=>`<option value="${k}" ${val===k?'selected':''}>${l}</option>`).join('')}</select>`;
function vProducts(){
  setTimeout(selBar,0);
  const liveP=D.products.filter(p=>!p.archived);
  const archP=D.products.filter(p=>p.archived);
  const _AZF=(function(){try{return plData().azBy;}catch(e){return{};}})();
  const _needsAct=p=>{const r=_AZF[p.id];return !!r&&(r.state==='act'||r.state==='critical');};
  const counts={all:liveP.length,act:0,bundle:0,pl:0,single:0,blocked:0,archived:archP.length};
  liveP.forEach(p=>{counts[p.type]++;if(avail(p).n===0)counts.blocked++;if(_needsAct(p))counts.act++;});
  const basis=pFilter==='archived'?archP:liveP;
  let rows=sortProducts(basis.filter(p=>(pFilter==='all'||pFilter==='archived'||(pFilter==='act'?_needsAct(p):pFilter==='blocked'?avail(p).n===0:p.type===pFilter))
    &&(!Q||(p.name+p.asin+p.sku).toLowerCase().includes(Q))));

  $('lav3View').innerHTML=`
  ${dupeBanner()}
  ${salesStrip()}
  <div class="panel stick">
    <div class="ph">
      <div class="seg">${[['all','All'],['act','Needs action'],['bundle','Bundles'],['pl','Private label'],['blocked','Out of stock']]
        /* Jack, 3 Sep: "where is active and not filter?" — it was here all
           along, but it only appeared once something had been archived, so
           there was no way to discover it. Always shown now. */
        .concat([['archived','Archived']])
        .map(([k,l])=>`<button class="${pFilter===k?'on':''}" onclick="LV3.setFilter('p','${k}')">${l}<span class="cnt">${fmt(counts[k])}</span></button>`).join('')}</div>
      <input class="srch" placeholder="Search product, ASIN, SKU…" value="${esc(Q)}" oninput="LV3.setQ(this.value)">
      ${sortPicker('p',pSort,P_SORTS)}
      <div class="r"><button class="btn" onclick="LV3.openBulkRecipe()" title="Set several bundles' build lists in one go">Bulk build lists</button>
        <button class="btn" onclick="LV3.openMatrix()" title="Fill every bundle's build list on one grid">Build list grid</button>
        <button class="btn" onclick="LV3.openAtAmz()" title="Paste this week's Seller Central count for every ASIN at once">Stock at Amazon</button>
        <button class="btn" onclick="LV3.openBulkProd()">Bulk add</button>
        <button class="btn pri" onclick="LV3.editProduct(null)">+ Add product</button></div>
    </div>
    <div id="selBar"></div>
    <table><thead><tr>
      <th style="width:30px;text-align:center"><input type="checkbox" onclick="LV3.selAll(this.checked)"></th>
      ${/* No percentage width here. A % column collapses when the table is
           squeezed, and the dead space was never this column being too wide —
           it was the name DIV inside it capped at 290px while the cell stretched. */''}
      <th class="l" style="min-width:300px">${sortTh('p','name','Product')}</th>
      <th style="width:104px" title="Counted by hand off Seller Central. Use Stock at Amazon to enter them all in one go.">${sortTh('p','atamz','At Amazon',D.products.filter(x=>!x.archived).every(x=>atAmz(x)==null)?'never counted':'')}</th>
      <th style="width:104px" title="What you hold here — buildable from parts, or on the shelf for a private-label product.">${sortTh('p','avail','Backstock')}</th>
      ${/* Incoming is the flexible column now — it holds the longest text and was
           the one clipping mid-word, while Product sat on 500px of nothing. */''}
      ${COL('pIncoming')?`<th style="width:190px">${sortTh('p','incoming','Incoming')}</th>`:''}
      ${COL('pOrdered')?'<th style="width:84px">Ordered</th>':''}
      ${COL('pSold')?`<th style="width:110px" title="Total units sold on Amazon, read straight from the BDL hub's monthly report. Nothing is typed in here and this app never writes back to the hub.">${sortTh('p','sold','Sold',(()=>{const M=hubMonth();return M.ym?esc(ymName(M.ym)):'last month';})())}</th>`:''}
      ${COL('pSendBy')?`<th style="width:150px" title="The Planner's verdict: protection is how many days until the shelf at Amazon runs empty at the current selling rate, counting inbound that lands in time. The chip is what to do about it.">${sortTh('p','reorder','Action','protection · from the Planner')}</th>`:''}
      ${COL('pCog')?`<th style="width:86px">${sortTh('p','cog','COG / unit')}</th>`:''}<th class="acts" style="width:132px"></th>
    </tr></thead><tbody>
    ${rows.length?rows.map(p=>prodRow(p)).join(''):`<tr><td colspan="${5+['pIncoming','pOrdered','pSold','pSendBy','pCog'].filter(COL).length}" class="empty">${D.products.length?'Nothing matches this filter.':
   'No products yet.<div style="margin-top:10px;display:flex;gap:7px;justify-content:center"><button class="btn pri" onclick="LV3.openBulkProd()">Bulk add products</button><button class="btn" onclick="LV3.editProduct(null)">Add one</button></div>'}</td></tr>`}
    </tbody></table>
  </div>
  <div style="font-size:11px;color:var(--text3);padding:0 2px;" id="pFoot">Tick products to set their type, archive or delete them in bulk. Click a row to see what it's made of. Bundles show what they can <b>build</b>; private-label and single products show stock <b>on hand</b>.</div>`;
  selBar();
}
let SEL=new Set();
let _oosAll=false,_logAll=false;
function toggleLog(){_logAll=!_logAll;render();}
/* things you've seen and dealt with — hidden until their stock actually moves */
let ACK={};
function ack(id){
  /* remembered across refreshes */
  const o=prod(id)||comp(id);if(!o)return;
  ACK[id]=(prod(id)?avail(o).n:onHand(o))+'|'+onOrder(o);
  saveState();render();toast('Marked as dealt with — it comes back if the numbers change');
}
function acked(o){
  const id=o.id;if(!(id in ACK))return false;
  const now=(prod(id)?avail(o).n:onHand(o))+'|'+onOrder(o);
  if(ACK[id]!==now){delete ACK[id];return false;}      // something changed — surface it again
  return true;
}
function ackClear(){ACK={};saveState();render();toast('Showing everything again');}
function toggleOos(){_oosAll=!_oosAll;render();}
function selOne(id,on){on?SEL.add(id):SEL.delete(id);vProducts();}
function selAll(on){
  const shown=D.products.filter(p=>(pFilter==='all'||(pFilter==='blocked'?avail(p).n===0:p.type===pFilter))
    &&(!Q||(p.name+p.asin+p.sku).toLowerCase().includes(Q)));
  SEL=new Set(on?shown.map(p=>p.id):[]);vProducts();
}
function selClear(){SEL.clear();vProducts();}
function selBar(){
  const el=$('selBar');if(!el)return;
  if(!SEL.size){el.innerHTML='';return;}
  el.innerHTML=`<div class="selbar">
    <b>${fmt(SEL.size)}</b> selected
    <span class="lab" style="margin-left:10px">Set type</span>
    ${['bundle','pl'].map(t=>`<button class="btn sm" onclick="LV3.selType('${t}')">${typeLabel(t)}</button>`).join('')}
    <span class="lab" style="margin-left:10px">VAT</span>
    ${['20','5','0'].map(v=>`<button class="btn sm" onclick="LV3.selVat('${v}')">${v}%</button>`).join('')}
    <span class="lab" style="margin-left:10px">Then</span>
    <button class="btn sm" onclick="LV3.selArchive(true)">Archive</button>
    ${pFilter==='archived'?`<button class="btn sm go" onclick="LV3.selArchive(false)">Restore</button>`:''}
    <button class="btn sm dgr" onclick="LV3.selDelete()">Delete</button>
    <button class="btn sm" style="margin-left:auto" onclick="LV3.selClear()">Clear</button></div>`;
}
function selType(t){
  snap();let n=0;
  D.products.forEach(p=>{if(SEL.has(p.id)&&p.type!==t){p.type=t;n++;}});
  save();SEL.clear();render();
  toastUndo(`${fmt(n)} product${n===1?'':'s'} set to ${typeLabel(t)}`,'ok');
}
function selVat(v){
  snap();let n=0;
  D.products.forEach(p=>{if(SEL.has(p.id)&&p.vat!==v){p.vat=v;n++;}});
  save();SEL.clear();render();
  toastUndo(`${fmt(n)} product${n===1?'':'s'} set to ${v}% VAT`,'ok');
}
/* Bulk archive / delete. Deleting several at once is exactly when a mistake
   costs the most, so it spells out the total and goes one row at a time
   through the same permanent delete a single row uses. */
function selArchive(on){
  snap();let n=0;
  D.products.forEach(p=>{if(SEL.has(p.id)&&!!p.archived!==on){p.archived=on;n++;}});
  save();SEL.clear();render();
  toastUndo(`${fmt(n)} product${n===1?'':'s'} ${on?'archived':'restored'}`,'ok');
}
function selDelete(){
  const list=D.products.filter(p=>SEL.has(p.id));
  if(!list.length)return;
  const withRecipe=list.filter(p=>p.recipe.length).length;
  confirmBox(`Delete ${fmt(list.length)} product${list.length===1?'':'s'} for good?`,
    `<div style="margin-bottom:10px">These are removed from the database permanently — they will not come back after a refresh.</div>
     <div style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px">
       ${list.map(p=>`<div style="font-size:12px;padding:2px 0">${esc(p.name)} <span class="pmeta" style="margin:0">${esc(p.asin||'')}</span></div>`).join('')}
     </div>
     ${withRecipe?`<div class="note bad" style="margin:0">${withRecipe} of them ${withRecipe===1?'has a build list':'have build lists'} — those are deleted too. The components themselves are kept.</div>`:''}`,
    async()=>{
      const ids=list.map(p=>p.id);
      for(const id of ids){await delProductNow(id);}
      SEL.clear();render();
      toast(`${fmt(ids.length)} product${ids.length===1?'':'s'} deleted`,'ok');
    },{danger:true,ok:`Delete ${fmt(list.length)} permanently`});
}
/* the delete itself, without the per-row confirmation */
async function delProductNow(id){
  const p=prod(id);if(!p)return;
  const src=p._src;
  D.products=D.products.filter(x=>x.id!==id);
  if(src){const i=lavAsins.indexOf(src);if(i>=0)lavAsins.splice(i,1);}
  delete RECIPES[p.asin];
  for(let i=LAYERS.length-1;i>=0;i--)if(LAYERS[i].kind==='product'&&String(LAYERS[i].tid)===String(id))LAYERS.splice(i,1);
  logIt('edit','Deleted product '+p.name);
  await deleteProduct_db(src,p);
  saveCompsRecipes();
}

/* ── the same, for components ── */
let CSEL=new Set();
function cselOne(id,on){on?CSEL.add(id):CSEL.delete(id);vComponents();}
function cselAll(on){
  const live=D.components.filter(c=>cFilter==='archived'?c.archived:!c.archived);
  const _plc=(function(){try{return plData().byComp||{};}catch(e){return{};}})();
  const shown=live.filter(c=>(cFilter==='all'||cFilter==='archived'||(cFilter==='low'?((_plc[c.id]||{}).buyQty>0):c.kind===cFilter))
    &&(!Q||c.name.toLowerCase().includes(Q)));
  CSEL=new Set(on?shown.map(c=>c.id):[]);vComponents();
}
function cselClear(){CSEL.clear();vComponents();}
function cselBar(){
  const el=$('cselBar');if(!el)return;
  if(!CSEL.size){el.innerHTML='';return;}
  const picked=D.components.filter(c=>CSEL.has(c.id));
  const withStock=picked.filter(c=>onHand(c)>0).length;
  const inUse=picked.filter(c=>usedIn(c.id).length).length;
  el.innerHTML=`<div class="selbar">
    <b>${fmt(CSEL.size)}</b> selected
    ${withStock?`<span class="chip warn">${withStock} hold${withStock===1?'s':''} stock</span>`:''}
    ${inUse?`<span class="chip">${inUse} in use</span>`:''}
    <span class="lab" style="margin-left:10px">Set kind</span>
    <button class="btn sm" onclick="LV3.cselKind('component')">Component</button>
    <button class="btn sm" onclick="LV3.cselKind('packaging')">Packaging</button>
    <span class="lab" style="margin-left:10px">Track stock</span>
    <button class="btn sm" onclick="LV3.cselTrack(true)">Yes</button>
    <button class="btn sm" title="For things shared with OA — poly bags, tape, labels. Never blocks a build, never counts toward COG." onclick="LV3.cselTrack(false)">No</button>
    <span class="lab" style="margin-left:10px">Then</span>
    <button class="btn sm" onclick="LV3.cselArchive(true)">Archive</button>
    ${cFilter==='archived'?`<button class="btn sm go" onclick="LV3.cselArchive(false)">Restore</button>`:''}
    <button class="btn sm dgr" onclick="LV3.cselDelete()">Delete</button>
    <button class="btn sm" style="margin-left:auto" onclick="LV3.cselClear()">Clear</button></div>`;
}
function cselKind(k){
  snap();let n=0;
  D.components.forEach(c=>{if(CSEL.has(c.id)&&c.kind!==k){c.kind=k;n++;}});
  save();CSEL.clear();render();
  toastUndo(`${fmt(n)} set to ${k==='packaging'?'Packaging':'Component'}`,'ok');
}
function cselTrack(on){
  let n=0;
  D.settings.untracked=D.settings.untracked||{};
  D.components.forEach(c=>{if(!CSEL.has(c.id))return;
    if(on)delete D.settings.untracked[String(c.id)];else D.settings.untracked[String(c.id)]=true;
    c.untracked=!on;n++;});
  savePrefs();CSEL.clear();render();
  toast(`${fmt(n)} component${n===1?'':'s'} ${on?'now tracked':'no longer tracked'}`,'ok');
}
function cselArchive(on){
  snap();let n=0;
  D.components.forEach(c=>{if(CSEL.has(c.id)&&!!c.archived!==on){c.archived=on;n++;}});
  save();CSEL.clear();render();
  toastUndo(`${fmt(n)} component${n===1?'':'s'} ${on?'archived':'restored'}`,'ok');
}
function cselDelete(){
  const list=D.components.filter(c=>CSEL.has(c.id));
  if(!list.length)return;
  const stock=list.reduce((t,c)=>t+onHand(c),0);
  const used=list.filter(c=>usedIn(c.id).length);
  confirmBox(`Delete ${fmt(list.length)} component${list.length===1?'':'s'} for good?`,
    `<div style="margin-bottom:10px">These are removed from the database permanently — they will not come back after a refresh.</div>
     <div style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px">
       ${list.map(c=>`<div style="font-size:12px;padding:2px 0">${esc(c.name)}
         ${onHand(c)?`<span style="color:var(--amb)">· ${fmt(onHand(c))} in stock</span>`:''}
         ${usedIn(c.id).length?`<span style="color:var(--red)">· used in ${usedIn(c.id).length}</span>`:''}</div>`).join('')}
     </div>
     ${stock?`<div class="note bad" style="margin:0 0 8px"><b>${fmt(stock)} units of stock</b> will be written off.</div>`:''}
     ${used.length?`<div class="note bad" style="margin:0">${used.length} of them ${used.length===1?'is':'are'} still used in a bundle — those recipes lose the line.</div>`
       :'<div class="pmeta" style="margin:0">None of them are used in a bundle.</div>'}`,
    async()=>{
      const ids=list.map(c=>c.id);
      for(const id of ids){await delCompNow(id);}
      CSEL.clear();render();
      toast(`${fmt(ids.length)} component${ids.length===1?'':'s'} deleted`,'ok');
    },{danger:true,ok:`Delete ${fmt(list.length)} permanently`});
}
async function delCompNow(id){
  const c=comp(id);if(!c)return;
  const src=c._src;
  D.products.forEach(p=>p.recipe=p.recipe.filter(r=>r.c!==id));
  D.components=D.components.filter(x=>x.id!==id);
  const ci=COMPS.findIndex(x=>String(x.id)===String(id));if(ci>=0)COMPS.splice(ci,1);
  for(let i=LAYERS.length-1;i>=0;i--)if(LAYERS[i].kind==='component'&&String(LAYERS[i].tid)===String(id))LAYERS.splice(i,1);
  Object.keys(RECIPES).forEach(k=>{RECIPES[k]=(RECIPES[k]||[]).filter(r=>String(r.c)!==String(id));});
  logIt('edit','Deleted component '+c.name);
  await deleteComponent_db(src&&src.uuid?src:{uuid:(src||{}).uuid,id});
  saveCompsRecipes();
}
function prodRow(p){
  const a=avail(p),cw=coverWeeks(p),nx=nextIn(p);
  const cg=cogOf(p,1);
  let nextComp=null;
  if(p.type==='bundle'){const cands=p.recipe.map(r=>nextIn(comp(r.c))).filter(Boolean).sort((x,y)=>x.date.localeCompare(y.date));nextComp=cands[0]||null;}
  const nn=nx||nextComp;
  /* what the incoming stock actually unlocks — not a raw sum of component units */
  const potential=p.type==='bundle'
    ? (p.recipe.length?Math.min(...p.recipe.map(r=>{const c=comp(r.c);return c?Math.floor((onHand(c)+onOrder(c))/r.q):0;})):0)
    : onHand(p)+onOrder(p);
  const oo=Math.max(0,potential-(a.n||0));
  const col=a.n===0?'var(--red)':(cw!==null&&cw<2)?'var(--amber)':'var(--green)';
  const lim=a.limiter?comp(a.limiter):null;
  const open=openRows[p.id];
  const _R=(function(){try{return (plData().azBy||{})[p.id];}catch(e){return null;}})();
  const _rail=_R?plStateCol(((_R.state==='act'||_R.state==='critical')&&_R.buildCap===0)?'parts':_R.state):'transparent';
  const main=`<tr class="${open?'open':''}" style="cursor:pointer" onclick="LV3.togRow('${p.id}')">
    <td style="text-align:center;box-shadow:inset 3px 0 0 ${_rail}" onclick="event.stopPropagation()">
      <input type="checkbox" ${SEL.has(p.id)?'checked':''} onclick="LV3.selOne('${p.id}',this.checked)"></td>
    <td class="l"><span class="chev">&#9654;</span>
      <div style="display:inline-block;vertical-align:middle;max-width:none">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="pname">${esc(p.name)}</span>
          <span class="chip ${p.type}">${typeLabel(p.type)}</span></div>
        <div class="pmeta mono" onclick="event.stopPropagation()">${asinBtn(p.asin)}${p.sku?' · '+esc(p.sku):''}${p.type==='bundle'?' · '+p.recipe.length+' part'+(p.recipe.length===1?'':'s'):''}</div>
        ${lim&&a.n===0?`<div class="blocked">out of ${esc(lim.name)}${onOrder(lim)?` · ${fmt(onOrder(lim))} on order`:' · nothing on order'}</div>`
          :lim?`<div class="pmeta" style="color:var(--amb)">${esc(lim.name)} limits it</div>`:''}
      </div></td>
    <td onclick="event.stopPropagation()">${(()=>{const v=atAmz(p),inb=amzIn(p),age=atAmzAge(p);
      if(v==null&&inb==null)return `<span class="dim" style="font-size:14px">—</span>`;
      const stale=age!=null&&age>=14;
      const dry=amzDry(p);
      return `<span class="mono b" style="font-size:14px;color:${v===0?'var(--red)':dry?'var(--amb)':stale?'var(--amb)':'var(--text)'}">${v==null?'—':fmt(v)}</span>
        ${inb?`<div class="amzInb" title="On its way to Amazon — counted toward the target, but not sellable yet">+${fmt(inb)} inbound</div>`:''}
        <div class="sldSub" title="${esc(whenTxt((D.settings.atAmzAt||{})[p.asin]))}">${
          dry?`<span style="color:var(--amb)">${dry.days<=0?'out on the shelf':dry.days+'d left'}</span>`
          :age==null?'counted'
          :stale?`<span style="color:var(--amb)">${age}d old</span>`
          :age===0?esc(whenTxt((D.settings.atAmzAt||{})[p.asin],true)||'today')
          :`${age}d ago`}</div>`;})()}</td>
    <td><span class="num" style="color:${col}">${a.kind==='norecipe'?'—':fmt(a.n)}</span>
      <div class="pmeta">${a.kind==='build'?'buildable':a.kind==='norecipe'?'on the shelf':'in stock'}</div>
      </td>
    ${COL('pIncoming')?`<td>${(()=>{
      /* This column used to print a paragraph per line — two product names, two
         dates — in a 130px cell, so it wrapped, clipped and told you nothing at
         a glance. What you want to know is HOW MANY are coming and WHEN the
         first lands. The detail is one click away in the expanded row. */
      const inc=[];
      if(p.type==='bundle')p.recipe.forEach(r=>{const c=comp(r.c);if(!c||c.untracked)return;
        (c.layers||[]).filter(l=>!l.arr).forEach(l=>inc.push({n:c.name,q:l.qty,d:l.date}));});
      else (p.layers||[]).filter(l=>!l.arr).forEach(l=>inc.push({n:p.name,q:l.qty,d:l.date}));
      if(!inc.length)return '<span class="dim">—</span>';
      inc.sort((a,b)=>(a.d||'').localeCompare(b.d||''));
      const units=inc.reduce((t,x)=>t+(x.q||0),0);
      const names=[...new Set(inc.map(x=>x.n))];
      const tip=inc.map(x=>`${fmt(x.q)} ${x.n} — ordered ${dshort(x.d)}`).join('\n');
      return `<span class="incN" title="${esc(tip)}">${fmt(units)}</span>
        <div class="incS"><span class="incNm" title="${esc(names.join(', '))}">${inc.length===1?esc(names[0]):`${fmt(inc.length)} lines`}</span> · from ${dshort(inc[0].d)}</div>
        ${oo?`<div class="incU">unlocks +${fmt(oo)}</div>`:''}`;})()}</td>`:''}
    ${COL('pOrdered')?`<td>${nn?`<span class="mono" style="font-size:12.5px;color:var(--text2)">${dshort(nn.date)}</span><div class="pmeta">${esc(nn.sup.split('—')[0].trim())}</div>`:'<span class="dim">—</span>'}</td>`:''}
    ${COL('pSold')?`<td onclick="event.stopPropagation()">
      ${/* Read-only. The figure is coming from elsewhere, so a box anyone can
            type into would only ever disagree with the real number. */''}
      ${sold30(p)!=null
        ? `<span class="mono b" style="font-size:14px">${fmt(sold30(p))}</span>`
        : `<span class="dim" style="font-size:14px">—</span>`}
      <div class="sldSub">${(()=>{
        /* Blank is not zero. Zero says it did not sell; blank says we do not
           know — and the two lead to opposite decisions. */
        const src=soldSrc(p);
        if(!src)return hubSkipped(p)?`<button class="sldFix" title="Marked as not selling. Click if it is selling again — the planner picks it up on the spot." onclick="event.stopPropagation();LV3.plUnskip('${esc(p.asin)}')">not selling — selling again?</button>`
          :`<button class="sldFix" onclick="event.stopPropagation();LV3.openHubReview()">no figure — check</button>`;
        if(src==='hub')return esc(ymName(hubMonth().ym))+(hubSkipped(p)?` · <button class="sldFix" title="Was marked not selling in the review; it is selling now, so the planner uses these sales. Click to clear the old mark." onclick="event.stopPropagation();LV3.plUnskip('${esc(p.asin)}')">clear old not-selling mark</button>`:'');
        const age=sold30Age(p);
        return `<span class="est">typed in${age!=null?` ${age}d ago`:''}</span>`;})()}</div></td>`:''}
    ${COL('pSendBy')?`<td onclick="event.stopPropagation()">${(()=>{
      const R=(plData().azBy||{})[p.id];
      if(!R)return '<span class="dim">&mdash;</span>';
      const blockedBuild=(R.state==='act'||R.state==='critical')&&R.buildCap===0;
      const k=blockedBuild?'parts':R.state;
      const SHORT={critical:'SEND NOW',act:'SEND',parts:'GET PARTS',gap:'GAP',waiting:'WAIT',watch:'WATCH',safe:'SAFE',paused:'NOT PLANNED',nodata:'NO SALES',nocount:'COUNT IT'};
      const chip='<span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:800;white-space:nowrap;color:#14120f;background:'+plStateCol(k)+'">'+(SHORT[k]||k)+'</span>';
      if(R.protDays==null)return `<div style="display:flex;flex-direction:column;gap:3px;align-items:center;cursor:pointer" onclick="LV3.openPlanRow('${p.id}')">${chip}${(k==='paused'&&hubSkipped(p))?`<button class="sldFix" title="Marked as not selling. Click if it is selling again — the planner picks it up on the spot." onclick="event.stopPropagation();LV3.plUnskip('${esc(p.asin)}')">selling again?</button>`:''}</div>`;
      const trig=fbaCalDays()+safetyDays();
      const col=R.protDays<=fbaCalDays()?'var(--red)':R.protDays<=trig?'var(--amb)':'var(--grn)';
      /* Becki, 7 Sep: "show the restock number straight off the bat here
         without having to click into each one." The recommended send, and
         how much of it the bench can build, under the chip. */
      const _rec=R.rec||0,_al=R.alloc||0;
      const _need=_rec>0?`<span class="pmeta" style="margin:0;white-space:nowrap;color:${_al>=_rec?'var(--grn)':_al>0?'var(--amb)':'var(--text3)'}" title="Recommended send: ${fmt(_rec)} units${R.want!=null?' · aim for '+fmt(R.want)+' at Amazon when it lands ('+(D.settings.targetDays||60)+' days\u2019 worth)':''}${_al<_rec?' · only '+fmt(_al)+' buildable now':''}">send <b>${fmt(_rec)}</b>${_al<_rec?` · ${fmt(_al)} now`:''}</span>`:'';
      return `<div style="display:flex;flex-direction:column;gap:3px;align-items:center;cursor:pointer"
        onclick="LV3.openPlanRow('${p.id}')"
        title="${Math.round(R.protDays)} days of protection against a ${trig}-day trigger. Click for the full working.">
        <span class="num b" style="font-size:13.5px;color:${col}">${fmt(Math.round(R.protDays))}d</span>
        ${chip}${_need}</div>`;})()}</td>`:''}
    ${COL('pCog')?`<td>${cg.short
      ? (cg.noPrice
        ? `<span style="font-size:12px;color:var(--red)">!</span><div class="pmeta" style="text-align:center;color:var(--red);font-weight:700">price missing</div>`
        : `<span class="dim" style="font-size:12px">—</span><div class="pmeta" style="text-align:center;color:var(--amb)">${p.type==='bundle'?'parts missing':'no stock yet'}</div>`)
      : `<span class="num" style="color:var(--accent)">${cg.per?gbp(cg.per):'—'}</span>${cg.batches>1?`<div class="pmeta" title="Stock was bought at ${cg.batches} different prices. Sending always uses the oldest first, so this is the cost of the next one out.">${cg.batches} prices in stock</div>`:''}`}</td>`:''}
    <td class="acts" onclick="event.stopPropagation()"><div style="display:flex;gap:4px;justify-content:flex-end">
      ${p.archived?`<button class="btn sm go" onclick="LV3.setArchived('product','${p.id}',false)">Restore</button>`
        :`<button class="btn sm go" onclick="LV3.openShip('${p.id}')">Ship</button>
          <button class="btn sm" onclick="LV3.openProduct('${p.id}')">Open</button>
          <button class="btn sm dots" title="More" onclick="LV3.rowMenu(event,'product','${p.id}')">⋯</button>`}</div></td></tr>`;
  if(!open)return main;

  /* expanded: the plan first, then what it's made of + live COG */
  let inner='',planStrip='';
  if(_R){
    const _blocked=(_R.state==='act'||_R.state==='critical')&&_R.buildCap===0;
    planStrip=`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 12px;margin:0 0 10px;background:var(--bg3);border-radius:8px;border-left:3px solid ${_rail};">
      ${plStateChip(_blocked?'parts':_R.state)}
      ${_R.protDays!=null?`<span class="num b" style="font-size:13px;">${fmt(Math.round(_R.protDays))}d protection</span>`:''}
      ${(_R.state==='act'||_R.state==='critical')&&_R.alloc>0?`<span style="font-size:12px;color:var(--text);"><b>send ${fmt(_R.alloc)}</b>${_R.alloc<_R.rec?' of '+fmt(_R.rec)+' wanted':''}</span>`:''}
      <span style="flex:1;min-width:200px;font-size:11.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(_R.why||'')}">${esc((_R.why||'').slice(0,140))}</span>
      <button class="btn sm" onclick="event.stopPropagation();LV3.openPlanRow('${p.id}')">Full working</button>
    </div>`;
  }
  if(p.type==='bundle'){
    const parts=p.recipe.filter(r=>comp(r.c)&&comp(r.c).kind!=='packaging');
    const pack=p.recipe.filter(r=>comp(r.c)&&comp(r.c).kind==='packaging');
    const line=r=>{const c=comp(r.c);const h=onHand(c);const can=Math.floor(h/r.q);const isLim=a.limiter===c.id;
      return `<div class="rline" onclick="LV3.openComp('${c.id}')"><span class="q">×${r.q}</span>
        <span class="nm">${esc(c.name)}<span class="chip ${c.kind}">${c.kind==='packaging'?'Packaging':'Component'}</span>
        ${isLim?'<span class="chip bad">limits build</span>':''}</span>
        <span class="st">${c.untracked?'<span class="dim">not tracked</span>'
          :(()=>{
            /* "72 on hand · next out £2.95 →36units" — three facts jammed
               together with no space and an arrow doing unexplained work.
               Nobody could tell that 36 meant BUNDLES, not units of the part. */
            const l=arrLayers(c).filter(x=>x.rem>0)[0];
            const _oo=onOrder(c),_nx=nextIn(c);
            let _inc='';
            if(_oo){let st=null;try{st=_nx?etaState(_nx):null;}catch(e){}
              const due=_nx&&(_nx.eta2||_nx.eta1);
              _inc=` <span class="stSep">·</span> <span style="color:${st&&st.k==='late'?'var(--red)':'var(--blu)'}">+${fmt(_oo)} ${st&&st.k==='late'?'late':due?'due '+dshort(String(due).slice(0,10)):'coming'}</span>`;}
            const EL2=(function(){try{return (plData().byComp||{})[c.id]||null;}catch(e){return null;}})();
            let _buy='';
            if(EL2&&EL2.buyQty>0)_buy=` <span class="stSep">·</span> <b style="color:var(--amb)">buy&nbsp;${fmt(EL2.buyQty)}</b>&nbsp;${EL2.buyByDays<0?'<span style="color:var(--red)">'+fmt(-EL2.buyByDays)+'d&nbsp;overdue</span>':EL2.buyByDays===0?'today':'by&nbsp;'+dshort(EL2.buyBy)}`;
            else if(EL2&&(EL2.state==='noroute'))_buy=` <span class="stSep">·</span> <a href="javascript:void(0)" onclick="event.stopPropagation();LV3.go('planner')" style="color:var(--amb)">set&nbsp;route</a>`;
            return `<span class="stHave">${fmt(h)}</span>&nbsp;in stock`
              +(l&&l.cost>0?` <span class="stSep">·</span> ${gbp(l.cost)}&nbsp;each`:'')
              +` <span class="stSep">·</span> enough for&nbsp;<b style="color:${can?'var(--text2)':'var(--red)'}">${fmt(can)}</b>&nbsp;${can===1?'build':'builds'}`+_inc+_buy;
          })()}</span></div>`;};
    inner=`<div class="rsh">Components</div>${parts.map(line).join('')||'<div class="pmeta">None</div>'}
      ${pack.length?`<div class="rsh">Packaging</div>${pack.map(line).join('')}`:''}`;
  }else{
    const ls=arrLayers(p).filter(l=>l.rem>0);
    inner=`<div class="rsh">Stock on hand — oldest used first</div>
      ${ls.length?`<table class="ltab"><thead><tr><th>Batch</th><th>Bought</th><th>Qty</th><th>Left</th><th>Unit cost</th><th>Value</th></tr></thead><tbody>
      ${ls.map((l,i)=>`<tr><td>${i===0?'<span class="chip warn">next out</span> ':''}${esc(l.sup)}</td><td>${dshort(l.date)}</td>
        <td>${fmt(l.qty)}</td><td>${fmt(l.rem)}</td><td>${gbp(l.cost)}</td><td>${gbp(l.rem*l.cost)}</td></tr>`).join('')}
      </tbody></table>`:'<div class="pmeta">No stock on hand.</div>'}`;
  }
  const c1=cogOf(p,1);
  /* A private-label product is bought in finished: its cost is simply what the
     last batch cost, and it has no parts at all. Showing it the bundle way — a
     one-line "recipe" of itself, reading "no stock · not until every part is in
     stock" — made an empty shelf look like a broken build list. Say what is
     actually true and what to do about it. */
  const isPL=p.type!=='bundle';
  const cogHtml=isPL?`<div class="cogbox">
    <div class="lab" style="margin-bottom:6px">What this cost</div>
    ${(()=>{const ls=arrLayers(p).filter(l=>l.rem>0);
      if(!ls.length)return `<div class="plNote">
        <b>Nothing in stock yet — so there is no cost to show.</b>
        <span>This is bought in finished, so its COG is whatever you paid for the batch. Nothing is missing and
        nothing is broken: book a batch in, or link the purchase on the Purchases tab, and the figure appears.</span>
        <div class="plBtns">
          <button class="btn sm pri" onclick="event.stopPropagation();LV3.openAddBatch('${p.id}','product')">+ Add a batch</button>
          <button class="btn sm" onclick="event.stopPropagation();LV3.go('purchases')">Go to Purchases</button>
        </div></div>`;
      const val=ls.reduce((t,l)=>t+l.rem*l.cost,0),qty=ls.reduce((t,l)=>t+l.rem,0);
      return `<div class="cogHead"><span>Batch</span><span>Left</span><span>Unit cost</span><span>Value</span></div>
        ${ls.map((l,i)=>`<div class="cogrow4">
          <span class="cgN">${i===0?'<span class="chip warn">next out</span> ':''}${esc(l.sup||'—')}</span>
          <span class="cgQ mono">${fmt(l.rem)}</span>
          <span class="cgU mono">${gbp(l.cost)}</span>
          <span class="cgL mono b">${gbp(l.rem*l.cost)}</span></div>`).join('')}
        <div class="cogtot"><span>Next unit out costs</span><span class="mono" style="color:var(--accent)">${gbp(ls[0].cost)}</span></div>
        <div class="pmeta" style="margin-top:5px">${fmt(qty)} units on hand worth ${gbp(val)} — each unit keeps the price of the batch it came from.</div>`;})()}
  </div>`:`<div class="cogbox">
    <div class="lab" style="margin-bottom:6px">Cost of one unit — oldest stock first</div>
    <div class="cogHead"><span>Part</span><span>In one</span><span>Unit cost</span><span>Line</span></div>
    ${c1.lines.map(l=>{const line=l.pack?0:l.parts.reduce((t,pt)=>t+pt.take*pt.cost,0);
      return `<div class="cogrow4${l.pack?' pk':''}">
      <span class="cgN">${esc(l.name)}${l.pack?' <span class="chip packaging">not in COG</span>':''}</span>
      <span class="cgQ mono">×${fmt(l.q||1)}</span>
      <span class="cgU mono">${l.pack?'—':(l.parts.length
        ? l.parts.map(pt=>pt.cost>0?gbp(pt.cost):'<span style="color:var(--red)">no price</span>').join(' + ')
        : '<span style="color:var(--red)">no stock</span>')}</span>
      ${/* £0.00 read like a real cost. An unpriced line says so instead. */''}
      <span class="cgL mono b">${l.pack?'—':(!l.parts.length?'—'
        : l.unpriced>0?'<span style="color:var(--red)">—</span>' : gbp(line))}</span></div>`;}).join('')}
    <div class="cogtot"><span>COG per unit</span>${c1.short
      ? `<span style="color:${c1.noPrice?'var(--red)':'var(--amb)'};font-size:12px;font-weight:700">${
          c1.noPrice?'a batch has no price':'not until every part is in stock'}</span>`
      : `<span class="mono" style="color:var(--accent)">${gbp(c1.per)}</span>`}</div>
    ${c1.noPrice?`<div class="note bad" style="margin:9px 0 0"><b>Stock booked in with no price.</b>
      ${esc(c1.unpriced.map(u=>u.name).slice(0,3).join(', '))}${c1.unpriced.length>3?` +${c1.unpriced.length-3} more`:''} —
      there is nothing to cost from, so COG can't be shown. Put the price on the batch and it comes straight back.
      ${c1.unpriced[0]&&c1.unpriced[0].cid?`<div style="margin-top:7px"><button class="btn sm warn" onclick="event.stopPropagation();LV3.openComp('${c1.unpriced[0].cid}')">Fix ${esc(c1.unpriced[0].name)}</button></div>`:''}</div>`:''}
    </div>`;
  return main+`<tr class="sub-row"><td colspan="${5+['pIncoming','pOrdered','pSold','pSendBy','pCog'].filter(COL).length}" style="padding:0"><div class="rbox">${planStrip}<div class="rgrid"><div>${inner}</div><div>${cogHtml}</div></div>
    <div style="margin-top:9px;display:flex;gap:6px">
    ${isPL?`<button class="btn sm" onclick="LV3.openAddBatch('${p.id}','product')">+ Add a batch</button>
            <button class="btn sm" onclick="LV3.editProduct('${p.id}')">Edit product</button>`
          :`<button class="btn sm" onclick="LV3.editProduct('${p.id}')">Edit build list</button>`}
    <button class="btn sm" onclick="LV3.openProduct('${p.id}')">Full detail</button>
    <button class="btn sm" style="margin-left:auto" onclick="LV3.setArchived('product','${p.id}',true)">Archive</button>
    <button class="btn sm dgr" onclick="LV3.delProduct('${p.id}')">Delete</button></div></div></td></tr>`;
}
/* Four buttons per row never fitted, and the one that fell off the edge was
   always Ship. Two stay visible; the rest live behind ⋯ in a menu anchored to
   the button and positioned in the viewport, so nothing can clip it. */
function rowMenu(ev,kind,id){
  ev.stopPropagation();
  const o=kind==='component'?comp(id):prod(id);
  if(!o)return;
  let m=document.getElementById('lav3RowMenu');
  if(!m){m=document.createElement('div');m.id='lav3RowMenu';m.className='rowmenu';document.body.appendChild(m);}
  const items=kind==='component'
    ? [['Add a batch',`LV3.openAddBatch('${id}','component')`,''],
       ['Edit component',`LV3.editComp('${id}')`,''],
       ['Correct stock',`LV3.openAdjust('component','${id}')`,''],
       ['Archive',`LV3.setArchived('component','${id}',true)`,''],
       ['Delete for good',`LV3.delComp('${id}')`,'dgr']]
    : [['Open',`LV3.openProduct('${id}')`,''],
       ['Edit product',`LV3.editProduct('${id}')`,''],
       ['Archive',`LV3.setArchived('product','${id}',true)`,''],
       ['Delete for good',`LV3.delProduct('${id}')`,'dgr']];
  m.innerHTML=`<div class="rmhead">${esc(o.name)}</div>`+
    items.map(([label,fn,cls])=>`<button class="rmi ${cls}" onclick="LV3.closeRowMenu();${fn}">${label}</button>`).join('');
  const r=ev.currentTarget.getBoundingClientRect();
  m.style.display='block';
  const w=m.offsetWidth||190,h=m.offsetHeight||160;
  let left=r.right-w, top=r.bottom+6;
  if(top+h>window.innerHeight-8)top=Math.max(8,r.top-h-6);
  m.style.left=Math.max(8,left)+'px';m.style.top=top+'px';
  setTimeout(()=>{document.addEventListener('click',closeRowMenu,{once:true});
    window.addEventListener('scroll',closeRowMenu,{once:true,capture:true});},0);
}
function closeRowMenu(){const m=document.getElementById('lav3RowMenu');if(m)m.style.display='none';}
function togRow(id){openRows[id]=!openRows[id];vProducts();}

/* ═══════════════ PRODUCT DETAIL ═══════════════ */
function openProduct(id){
  const p=prod(id),a=avail(p),cg=cogOf(p,1);
  const isB=p.type==='bundle';
  const lim=a.limiter?comp(a.limiter):null;
  const cw=coverWeeks(p);

  /* what a full delivery would unlock */
  const potential=isB
    ? (p.recipe.length?Math.min(...p.recipe.map(r=>{const c=comp(r.c);return c?(c.untracked?1e9:Math.floor((onHand(c)+onOrder(c))/r.q)):0;})):0)
    : onHand(p)+onOrder(p);
  const unlock=Math.max(0,potential-(a.n||0));

  /* everything on its way in */
  const inbound=[];
  if(isB)p.recipe.forEach(r=>{const c=comp(r.c);if(!c||c.untracked)return;
    (c.layers||[]).filter(l=>!l.arr).forEach(l=>inbound.push({name:c.name,l,per:r.q}));});
  else (p.layers||[]).filter(l=>!l.arr).forEach(l=>inbound.push({name:p.name,l,per:1}));
  inbound.sort((x,y)=>(x.l.date||'').localeCompare(y.l.date||''));

  const stockVal=isB
    ? p.recipe.reduce((t,r)=>{const c=comp(r.c);return t+(c&&!c.untracked?arrLayers(c).reduce((v,l)=>v+l.rem*l.cost,0)*0:0);},0)
    : arrLayers(p).reduce((v,l)=>v+l.rem*l.cost,0);

  const hist=D.log.filter(l=>l.k==='ship'&&l.txt.includes(p.name)).slice(0,8);

  const stat=(k,v,col,sub)=>`<div class="dstat">
    <div class="k">${k}</div><div class="v" ${col?`style="color:${col}"`:''}>${v}</div>
    ${sub?`<div class="s">${sub}</div>`:''}</div>`;

  /* ── what it's made of, or what stock it holds ── */
  let made='';
  if(isB){
    made=p.recipe.length?`<table class="dtab"><thead><tr>
        <th class="l">Component</th><th>Per unit</th><th>On hand</th><th>On order</th>
        <th>Makes</th><th>${D.settings.targetDays||60}d need</th><th>Oldest price</th></tr></thead><tbody>
      ${p.recipe.map(r=>{const c=comp(r.c);if(!c)return'';
        const h=onHand(c),can=c.untracked?'∞':fmt(Math.floor(h/r.q));
        const cn60=compNeed60(c),cs60=compShort60(c);const isLim=a.limiter===c.id;
        return `<tr class="${isLim?'lim':''}" onclick="LV3.cm('lav3Ov1');LV3.openComp('${c.id}')" style="cursor:pointer">
          <td class="l"><b>${esc(c.name)}</b>
            <span class="chip ${c.kind}">${c.kind==='packaging'?'Pack':'Comp'}</span>
            ${c.untracked?'<span class="chip">not tracked</span>':''}
            ${isLim?'<span class="chip bad">limits build</span>':''}</td>
          <td>×${fmt(r.q)}</td>
          <td><b style="color:${h?'var(--grn)':'var(--red)'}">${c.untracked?'—':fmt(h)}</b></td>
          <td>${onOrder(c)?`<b style="color:var(--blu)">${fmt(onOrder(c))}</b>`:'—'}</td>
          <td>${can}</td>
          <td>${cn60?`${fmt(cn60)}${cs60?` <span style="color:var(--amb)">(${fmt(cs60)} short)</span>`:''}`:'—'}</td>
          <td>${c.untracked?'—':(()=>{const l=arrLayers(c).filter(x=>x.rem>0)[0];return l&&l.cost>0?gbp(l.cost):'<span class="dim">n/a</span>';})()}</td></tr>`;}).join('')}
      </tbody></table>`
      :`<div class="empty">No components yet.<div style="margin-top:9px">
        <button class="btn pri" onclick="LV3.cm('lav3Ov1');LV3.editProduct('${p.id}')">Add its components</button></div></div>`;
  }else{
    const ls=realLayers(p).slice().sort((x,y)=>x.date.localeCompare(y.date));
    made=ls.length?`<table class="dtab"><thead><tr>
        <th class="l">Batch</th><th>Bought</th><th>Qty</th><th>Left</th><th>Unit</th><th>Value</th><th>Status</th></tr></thead><tbody>
      ${ls.map(l=>{const nextOut=l.arr&&l.rem>0&&arrLayers(p).filter(x=>x.rem>0)[0]===l;
        return `<tr class="${l.arr&&!l.rem?'spent':''} ${nextOut?'lim':''}">
        <td class="l">${esc(l.sup||'—')}${l.oid&&l.oid!=='—'?`<div class="pmeta">${esc(l.oid)}</div>`:''}</td>
        <td>${dshort(l.date)}</td><td>${fmt(l.qty)}</td><td>${l.arr?fmt(l.rem):'—'}</td>
        <td>${l.cost>0?gbp(l.cost):'<span class="dim">n/a</span>'}</td>
        <td>${l.arr?gbp(l.rem*l.cost):'—'}</td>
        <td>${!l.arr?'<span class="chip info">On order</span>':nextOut?'<span class="chip warn">Next out</span>'
          :l.rem?'<span class="chip ok">In stock</span>':'<span class="chip">Used up</span>'}</td></tr>`;}).join('')}
      </tbody></table>`:'<div class="empty">No stock batches yet.</div>';
  }

  $('lav3Mod1').className='mod wide';
  $('lav3Mod1').innerHTML=`
  <div class="mh"><h3>${esc(p.name)}</h3>
    <span class="chip ${p.type}">${typeLabel(p.type)}</span>
    <span class="chip vat">${p.vat}% VAT</span>
    <span class="pmeta" style="margin:0">${asinBtn(p.asin)}${p.sku?' · '+esc(p.sku):''}</span>
    <button class="x" onclick="LV3.cm('lav3Ov1')">&#10005;</button></div>

  <div class="mb">
    <div class="dstats">
      ${stat(isB?'Buildable now':'In stock',fmt(a.n),a.n?'var(--grn)':'var(--red)',
        lim&&!a.n?`out of ${esc(lim.name)}`:lim?`${esc(lim.name)} limits it`:'')}
      ${stat('Unlocked by arrivals','+'+fmt(unlock),unlock?'var(--blu)':null,
        inbound.length?`${inbound.length} delivery${inbound.length===1?'':'s'} due`:'nothing on order')}
      ${stat('Sold last month',sold30(p)!=null?fmt(sold30(p)):'—',sold30(p)?'var(--grn)':null,
        sold30(p)!=null?`${ymName(hubMonth().ym)} · we sent ${fmt(p.ship30)} in`:'no figure in the BDL hub for this ASIN')}
      ${stat(`${D.settings.targetDays||60}d target`,target60(p)?fmt(target60(p)):'—',null,(()=>{const t=target60(p);if(!t)return'needs a sold figure';
        const gap=t-(avail(p).n||0);return gap>0?`${fmt(gap)} short of it`:'covered';})())}
      ${stat('COG / unit',cg.short?'—':(cg.per>0?gbp(cg.per):'—'),cg.short?'var(--amb)':'var(--accent)',
        cg.short?'needs every part in stock':(cg.batches>1?`${cg.batches} price batches`:''))}
      ${(()=>{const nx=nextCog(p);
        if(!nx)return stat(isB?'Sendable value':'Stock value',gbp(cg.per*(a.n||0)||stockVal),null,'at what you paid');
        const up=nx.diff>0;
        return `${stat('COG after that',gbp(nx.next),up?'var(--red)':'var(--grn)',
          `${up?'+':''}${gbp(nx.diff)} a unit · in ${fmt(nx.after)} unit${nx.after===1?'':'s'}`)}
          ${stat(isB?'Sendable value':'Stock value',gbp(cg.per*(a.n||0)||stockVal),null,'at what you paid')}`;})()}
    </div>
    ${hubSkipped(p)?`<div class="note warn" style="margin:0 0 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="flex:1"><b>Marked as not selling.</b> The planner leaves it alone: no send, no parts, no restock.</span><button class="btn sm pri" onclick="LV3.plUnskip('${esc(p.asin)}');LV3.openProduct('${p.id}')">Selling again</button></div>`:''}
    ${(()=>{const nx=nextCog(p);if(!nx)return '';
      const up=nx.diff>0;
      return `<div class="note ${up?'warn':'good'}" style="margin:0 0 13px">
        <b>The cost changes after the next ${fmt(nx.after)} unit${nx.after===1?'':'s'}.</b>
        Stock goes out oldest batch first, so once today's price runs out this becomes
        <b>${gbp(nx.next)}</b> a unit — ${up?'up':'down'} ${gbp(Math.abs(nx.diff))}.
        <div class="nxList">${nx.changes.map(c=>`<div class="nxRow">
          <span class="nxNm">${esc(c.name)}</span>
          <span class="nxQ">${fmt(c.left)} left at</span>
          <span class="nxP">${gbp(c.from)}</span>
          <span class="nxArr">→</span>
          <span class="nxP ${c.to>c.from?'up':'down'}">${gbp(c.to)}</span></div>`).join('')}</div></div>`;})()}

    <div class="dsec"><span class="lab">${isB?'Made from':'Stock batches — oldest used first'}</span>
      ${isB?`<button class="btn sm" onclick="LV3.cm('lav3Ov1');LV3.editProduct('${p.id}')">Edit build list</button>`:''}</div>
    ${made}

    ${inbound.length?`<div class="dsec"><span class="lab">On the way in</span>
        <button class="btn sm" onclick="LV3.cm('lav3Ov1');LV3.openDeliveries()">Deliveries</button></div>
      <table class="dtab"><thead><tr><th class="l">Item</th><th class="l">Supplier</th><th>Ordered</th><th>Qty</th><th>Unit</th><th>Waiting</th></tr></thead><tbody>
      ${inbound.map(x=>{const d=Math.floor((TODAY-new Date(x.l.date))/864e5);
        return `<tr><td class="l">${esc(x.name)}</td><td class="l">${esc(x.l.sup||'—')}</td>
        <td>${dshort(x.l.date)}</td><td><b style="color:var(--blu)">${fmt(x.l.qty)}</b></td>
        <td>${x.l.cost>0?gbp(x.l.cost):'<span class="dim">n/a</span>'}</td>
        <td>${d>=21?`<b style="color:var(--red)">${d}d</b>`:d+'d'}</td></tr>`;}).join('')}
      </tbody></table>`:''}

    ${p.type!=='bundle'&&!arrLayers(p).filter(l=>l.rem>0).length?`<div class="note bad" style="margin:0 0 12px">
      <b>No stock, so no cost — this is not a missing build list.</b> A private-label product is bought in finished:
      its COG is whatever the batch cost. Book one in with <b>+ Add a batch</b>, or link the purchase on Purchases.</div>`:''}
    <div class="dsec"><span class="lab">${p.type!=='bundle'?'What this cost':'Cost of one unit — oldest stock first'}</span></div>
    <div class="cogbox">
      ${cg.lines.map(l=>`<div class="cogrow" ${l.pack?'style="opacity:.6"':''}>
        <span>${esc(l.name)}${l.q>1?` ×${fmt(l.q)}`:''}${l.pack?' <span class="chip packaging">not in COG</span>':''}</span>
        <b>${l.pack?'—':(l.parts.length?l.parts.map(pt=>`${fmt(pt.take)}@${pt.cost>0?gbp(pt.cost):'—'}`).join(' + '):'<span style="color:var(--red)">no stock</span>')}</b></div>`).join('')}
      <div class="cogtot"><span>Total COG</span>${cg.short
        ? `<span style="color:var(--amb);font-size:12px;font-weight:700">${p.type==='bundle'?'not until every part is in stock':'nothing in stock yet'}</span>`
        : `<span class="mono" style="color:var(--accent)">${gbp(cg.per)}</span>`}</div></div>
    ${cg.lines.some(l=>l.pack)?'<div class="pmeta" style="margin-top:6px">Packaging is deducted from stock but left out of COG.</div>':''}

    <div class="dsec"><span class="lab">Shipment history</span></div>
    ${hist.length?hist.map(h=>`<div class="att" style="padding:9px 0">
        <span class="dot" style="background:var(--vio)"></span>
        <span class="tx">${esc(h.txt)}<span class="s">${ago(h.t.slice(0,10))} · ${esc(h.who)}</span></span></div>`).join('')
      :`<div class="pmeta">Nothing sent yet${p.ship30?` — the ${fmt(p.ship30)} in "shipped 30d" came from the Shipments page before this log started.`:'.'}</div>`}
  </div>

  <div class="mf">
    <button class="btn dgr" onclick="LV3.delProduct('${p.id}')">Delete</button>
    <button class="btn" onclick="LV3.setArchived('product','${p.id}',true)">Archive</button>
    <div class="sp">
      <button class="btn" onclick="LV3.cm('lav3Ov1');LV3.editProduct('${p.id}')">Edit</button>
      <button class="btn pri" onclick="LV3.cm('lav3Ov1');LV3.openShip('${p.id}')">Ship units</button></div></div>`;
  om('lav3Ov1');
}

/* ═══════════════ PRODUCT EDIT (type + recipe) ═══════════════ */
let EDIT=null;
function editProduct(id){
  const p=id?JSON.parse(JSON.stringify(prod(id))):{id:newId('pr'),asin:'',sku:'',name:'',type:'bundle',vat:'20',recipe:[],layers:[],ship30:0,lastSent:null};
  EDIT=p;EDIT._id=id||null;
  const others=D.products.filter(x=>x.id!==id&&x.recipe.length);
  $('lav3Mod2').className='mod wide';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>${id?'Edit':'Add'} product</h3>
    ${id?`<span class="pmeta" style="margin:0">${esc(p.asin)}</span>`:''}
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb" style="padding:12px 14px">
    <div class="ed2">
      <div>
        <div class="edrow"><span class="lab">Type</span>
          <div class="seg" style="width:100%">${['bundle','pl'].map(t=>`<button style="flex:1" class="${p.type===t?'on':''}" onclick="LV3.setType('${t}')">${typeLabel(t)}</button>`).join('')}</div>
          <div class="pmeta" style="margin-top:4px;white-space:normal" id="typeHint"></div></div>
        <div class="edrow"><span class="lab">Product name</span><input class="in" id="e-name" value="${esc(p.name)}" placeholder="e.g. Pub Snack Box"></div>
        <div class="edrow" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><span class="lab">ASIN</span><input class="in mono" id="e-asin" value="${esc(p.asin)}"></div>
          <div><span class="lab">SKU</span><input class="in mono" id="e-sku" value="${esc(p.sku)}"></div></div>
        <div class="edrow" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><span class="lab">VAT</span><select class="in" id="e-vat">${['20','5','0'].map(v=>`<option ${p.vat===v?'selected':''}>${v}%</option>`).join('')}</select></div>
          <div><span class="lab">Shipped 30d <span style="text-transform:none;font-weight:600">(demo)</span></span><input class="in mono" id="e-s30" type="number" value="${p.ship30||0}" oninput="LV3.recipePreview()"></div></div>
        ${/* Lead time is entered by hand, per product, and nothing infers it —
             it already accounts for the supplier, the build, the trip to Amazon
             and Amazon switching it on. Calendar days, not working days. */''}
        <div class="edrow"><span class="lab">Lead time (days)</span>
          <input class="in mono" id="e-lead" type="number" min="1" step="1"
            value="${leadOf(p)!=null?leadOf(p):''}" placeholder="e.g. 10">
          <div class="pmeta" style="margin-top:4px;white-space:normal">Calendar days from placing the order to it being on sale at Amazon — supplier, build, shipping and Amazon check-in all included. Nothing is added on top.</div></div>
        <div id="livePrev"></div>
      </div>
      <div id="recipeWrap"></div>
    </div>
  </div>
  <div class="mf">${id?`<button class="btn dgr" onclick="LV3.delProduct('${id}')">Delete</button>`:''}
    <span class="pmeta" style="margin:0 0 0 4px">Editing never rewrites past shipments.</span>
    <div class="sp">
      ${others.length?`<select class="in" id="copyFrom" style="width:auto;font-size:11px;padding:5px 8px" onchange="LV3.copyRecipe(this.value)">
        <option value="">Copy components from…</option>${others.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>`:''}
      <button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
      <button class="btn pri" onclick="LV3.saveProduct('${id||''}')">Save product</button></div></div>`;
  om('lav3Ov2');setType(p.type);
  setTimeout(()=>{const el=$('e-name');if(el)el.focus();},50);
}
function setType(t){
  EDIT.type=t;
  document.querySelectorAll('#lav3Mod2 .seg button').forEach((b,i)=>b.classList.toggle('on',['bundle','pl'][i]===t));
  $('typeHint').innerHTML=t==='bundle'?'Built here from components. Availability = how many you can build.'
    :t==='pl'?'Arrives finished under our brand. Availability = its own stock; components optional.'
    :'Bought and sent as-is. Availability = its own stock.';
  const w=$('recipeWrap');
  w.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="lab">Components in one unit${t!=='bundle'?' — optional':''}</span>
      <button class="btn sm" style="margin-left:auto" onclick="LV3.addRecipeRow()">+ Add</button></div>
    <div id="recipeRows"></div>
    ${t==='bundle'?`<div class="note info" style="margin-top:12px">
       <b>What goes into one unit.</b> Add each part and how many of it a single finished unit uses —
       lotion ×1, glove ×1, mitt ×1, poly bag ×1. Packaging counts here too; it comes off stock but
       stays out of COG.<br><br>
       Building a near-identical product? Use <b>Copy components from…</b> at the bottom and change the one line that differs.</div>`:''}
    ${t!=='bundle'?`<div class="note info" style="margin-top:9px">Stock for this product comes from the purchase sheet — link its rows on the <b>Purchases</b> tab. Components here are only used to work out COG.</div>`:''}`;
  $('recipeRows').innerHTML='';
  (EDIT.recipe.length?EDIT.recipe:(t==='bundle'?[{c:'',q:1}]:[])).forEach(r=>addRecipeRow(r.c,r.q));
  recipePreview();
}
function copyRecipe(pid){
  if(!pid)return;const src=prod(pid);
  EDIT.recipe=JSON.parse(JSON.stringify(src.recipe));
  $('recipeRows').innerHTML='';EDIT.recipe.forEach(r=>addRecipeRow(r.c,r.q));
  $('copyFrom').value='';recipePreview();toast('Copied components from '+src.name);
}
function compOptions(sel,filter){
  const q=(filter||'').toLowerCase();
  const hit=c=>!q||c.name.toLowerCase().includes(q);
  return `<optgroup label="Components">${D.components.filter(c=>c.kind!=='packaging'&&(hit(c)||c.id===sel))
      .map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.name)}</option>`).join('')}</optgroup>
    <optgroup label="Packaging">${D.components.filter(c=>c.kind==='packaging'&&(hit(c)||c.id===sel))
      .map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
}
/* One box, not two. Click it to see every component; type to narrow it down.
   The list only grows over time, so scrolling was never going to hold up. */
function compDatalist(){
  let dl=document.getElementById('lav3CompList');
  if(!dl){dl=document.createElement('datalist');dl.id='lav3CompList';document.body.appendChild(dl);}
  const live=D.components.filter(c=>!c.archived);
  dl.innerHTML=live.filter(c=>c.kind!=='packaging').map(c=>`<option value="${esc(c.name)}"></option>`).join('')
    +live.filter(c=>c.kind==='packaging').map(c=>`<option value="${esc(c.name)}" label="packaging"></option>`).join('');
  return dl.id;
}
function _compByExact(n){const k=(n||'').toLowerCase().replace(/\s+/g,' ').trim();if(!k)return null;
  const live=D.components.filter(c=>!c.archived);
  return live.find(c=>c.name.toLowerCase().replace(/\s+/g,' ').trim()===k)
      ||live.find(c=>c.name.toLowerCase().includes(k))||null;}
/* kept so older markup and the harness keep working */
function rcSearch(inp){rcPick(inp);}
function rcPick(inp){
  const row=inp.closest('.rrow');const hid=row.querySelector('.rc-c');
  const c=_compByExact(inp.value);
  hid.value=c?c.id:'';
  row.classList.toggle('unmatched',!c&&!!inp.value.trim());
  const mk=row.querySelector('.rc-make');
  if(mk)mk.style.display=(!c&&inp.value.trim())?'':'none';
  recipePreview();
}
/* typed a name that doesn't exist yet — make it, right here */
function rcMake(btn){
  const row=btn.closest('.rrow');const inp=row.querySelector('.rc-find');
  const name=(inp.value||'').trim();if(!name)return;
  if(_compByExact(name)){rcPick(inp);return;}
  const c={id:newId('c'),name,kind:/box|sleeve|bag|card|label|wrap|tissue/i.test(name)?'packaging':'component',
    tag:'complementary',caseQty:null,layers:[]};
  D.components.push(c);save();compDatalist();
  inp.value=c.name;rcPick(inp);
  toast(`"${c.name}" created${c.kind==='packaging'?' as packaging':''} — no stock yet`,'ok');
}
function addRecipeRow(cid,q){
  compDatalist();
  const c=cid?comp(cid):null;
  const d=document.createElement('div');d.className='rrow';
  d.innerHTML=`<div class="rcPick">
      <input class="in rc-find" list="lav3CompList" autocomplete="off" placeholder="Search or pick a component…"
             value="${c?esc(c.name):''}" oninput="LV3.rcPick(this)" onchange="LV3.rcPick(this)">
      <input type="hidden" class="rc-c" value="${c?c.id:''}">
      <button class="btn sm rc-make" style="display:none" onclick="LV3.rcMake(this)">Create it</button></div>
    <input class="in num rc-q" type="number" min="1" value="${q||1}" style="text-align:center" oninput="LV3.recipePreview()">
    <span class="rcinfo"></span>
    <button class="btn sm dgr" title="Remove" onclick="this.parentElement.remove();LV3.recipePreview()">✕</button>`;
  $('recipeRows').appendChild(d);
  recipePreview();
}
/* selecting "create new" swaps the row into a tiny inline creator */
function rcChange(sel){
  if(sel.value==='__new'){
    const row=sel.parentElement;
    row.classList.add('newc');
    row.innerHTML=`<input class="in rc-new" placeholder="New component name…" oninput="LV3.recipePreview()">
      <input class="in mono rc-q" type="number" min="1" value="1" style="text-align:center" oninput="LV3.recipePreview()">
      <span class="rcinfo"><label style="display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--text3)">
        <input type="checkbox" class="rc-pack"> packaging</label></span>
      <button class="btn sm dgr" onclick="this.parentElement.remove();LV3.recipePreview()">✕</button>`;
    const nw=row.querySelector('.rc-new');if(nw)nw.focus();
  }
  recipePreview();
}
/* live: what this recipe would build and cost, updated on every keystroke */
function recipePreview(){
  if(!$('recipeRows'))return;
  const rows=readRecipeRows();
  document.querySelectorAll('#recipeRows .rrow').forEach(r=>{
    const sel=r.querySelector('.rc-c');if(!sel)return;
    const c=comp(sel.value),info=r.querySelector('.rcinfo');
    const q=parseInt(r.querySelector('.rc-q').value)||1;
    if(!c){info.innerHTML='';r.classList.remove('lim');return;}
    if(c.untracked){info.innerHTML='<span style="color:var(--text3)">not tracked — never blocks</span>';return;}
    const can=Math.floor(onHand(c)/q);
    info.innerHTML=`<span class="mono" style="color:${onHand(c)?'var(--text2)':'var(--red)'}">${fmt(onHand(c))}</span>
      <span style="color:var(--text3)">in stock · ${gbp(avgCost(c))}</span>
      <span class="mono" style="color:${can?'var(--text3)':'var(--red)'}">→ ${fmt(can)}</span>`;
  });
  const dupe=rows.map(r=>r.c).filter(c=>c&&!c.startsWith('new:'));
  const hasDupe=new Set(dupe).size!==dupe.length;
  let buildable=null,cog=0,limName=null;
  const real=rows.filter(r=>comp(r.c));
  if(real.length){
    buildable=Infinity;
    real.forEach(r=>{const c=comp(r.c);const can=Math.floor(onHand(c)/r.q);
      if(can<buildable){buildable=can;limName=c.name;}
      if(c.kind==='packaging')return;                    // packaging never counts toward COG
      const f=fifo(c,r.q);cog+=f.value+(f.short?f.short*avgCost(c):0);});
  }
  const t=EDIT.type;
  const s30=parseInt(($('e-s30')||{}).value)||0;
  const cw=s30?(buildable||0)/(s30/4.35):null;
  $('livePrev').innerHTML=`
    <div class="prevbox">
      <div class="lab" style="margin-bottom:7px">Live preview</div>
      <div class="prevgrid">
        <div><div class="k">${t==='bundle'?'Buildable now':'Stock'}</div>
          <div class="v" style="color:${buildable?'var(--grn)':'var(--red)'}">${t==='bundle'?(real.length?fmt(buildable):'—'):fmt(onHand(EDIT))}</div></div>
        <div><div class="k">COG / unit</div><div class="v" style="color:var(--accent)">${real.length?gbp(cog):'—'}</div></div>
        <div><div class="k">${D.settings.targetDays||60}d target</div><div class="v">${target60(EDIT)?fmt(target60(EDIT)):'—'}</div></div>
      </div>
      ${limName&&buildable!==null?`<div class="pmeta" style="margin-top:8px;white-space:normal">${buildable?'Limited by':'Out of stock:'} <b style="color:${buildable?'var(--amb)':'var(--red)'}">${esc(limName)}</b></div>`:''}
      ${hasDupe?`<div class="note bad" style="margin-top:8px;padding:7px 9px">The same component is listed twice — combine them into one line with a higher quantity.</div>`:''}
    </div>`;
}
function readRecipeRows(){
  return [...document.querySelectorAll('#recipeRows .rrow')].map(r=>{
    const q=parseInt(r.querySelector('.rc-q').value)||1;
    const sel=r.querySelector('.rc-c');
    if(sel)return{c:sel.value,q};
    const nm=(r.querySelector('.rc-new')||{}).value||'';
    return{c:nm.trim()?'new:'+nm.trim():'',q,pack:!!(r.querySelector('.rc-pack')||{}).checked};
  }).filter(r=>r.c&&r.c!=='__new');
}
function saveProduct(id){
  const form=readProductForm();
  const name=form.name,asin=form.asin;
  if(!name||!asin){toast('Name and ASIN required','er');return;}
  /* stop the duplicate being created rather than flagging it afterwards */
  const clash=D.products.find(p=>p.id!==id&&!p.archived&&(p.asin||'').trim().toUpperCase()===asin);
  if(clash){
    confirmBox('That ASIN is already here',
      `<div style="margin-bottom:10px"><b>${esc(asin)}</b> is already used by <b>${esc(clash.name)}</b>${clash.sku?` (${esc(clash.sku)})`:''}.</div>
       <div style="margin-bottom:10px">Two products on one ASIN split its stock and its sales between them, so neither figure is right.
         If this is the same thing, edit the existing one instead.</div>
       <div class="note bad" style="margin:0">Saving anyway leaves both in the list, flagged in red at the top of Products until one is removed.</div>`,
      ()=>{saveProductForce(id,form);},{danger:true,ok:'Save it anyway'});
    return;
  }
  saveProductForce(id,form);
}
/* The form is read BEFORE anything can close it — the duplicate warning lives in
   the same modal, so reading the fields afterwards found an empty page. */
function readProductForm(){
  return{name:$('e-name').value.trim(),asin:$('e-asin').value.trim().toUpperCase(),
    sku:$('e-sku').value.trim(),vat:($('e-vat').value||'20').replace('%',''),
    ship30:parseInt($('e-s30').value)||0,rows:readRecipeRows(),type:EDIT.type};
}
function saveProductForce(id,form){
  const name=form.name,asin=form.asin;
  const rows=form.rows.map(r=>{
    if(r.c.startsWith('new:')){                     // create components typed inline
      const nm=r.c.slice(4);
      let ex=D.components.find(c=>c.name.toLowerCase()===nm.toLowerCase());
      if(!ex){ex={id:newId('c'),name:nm,kind:r.pack?'packaging':'component',tag:'complementary',caseQty:null,layers:[]};
        D.components.push(ex);logIt('edit','Added component '+nm);}
      return{c:ex.id,q:r.q};
    }
    return{c:r.c,q:r.q};
  });
  const seen={};rows.forEach(r=>{seen[r.c]=(seen[r.c]||0)+r.q;});      // merge duplicate lines
  const merged=Object.keys(seen).map(c=>({c,q:seen[c]}));
  const obj={...EDIT,name,asin,sku:form.sku,vat:form.vat,type:form.type||EDIT.type,
    ship30:form.ship30,recipe:merged};
  delete obj._id;
  if(id){const i=D.products.findIndex(x=>x.id===id);obj.layers=D.products[i].layers;obj.lastSent=D.products[i].lastSent;D.products[i]=obj;}
  else D.products.push(obj);
  logIt('edit',(id?'Updated product ':'Added product ')+name);
  cm('lav3Ov2');cm('lav3Ov1');render();toast(id?'Product updated':'Product added','ok');
}
function setArchived(kind,id,on){
  const o=kind==='product'?prod(id):comp(id);if(!o)return;
  const apply=()=>{
    snap();o.archived=on;if(o._src)o._src.archived=on;
    if(kind==='product'&&o._src&&typeof saveLavAsin==='function')saveLavAsin(o._src);
    save();render();
    toastUndo(on?`${o.name} archived — find it under the Archived filter`:`${o.name} restored`,'ok');
  };
  if(!on){apply();return;}                       // restoring needs no ceremony
  let extra='';
  if(kind==='component'){
    const uses=usedIn(id);
    if(uses.length)extra=`<br><br>It's used in <b>${uses.length} product${uses.length===1?'':'s'}</b> (${uses.slice(0,3).map(u=>esc(u.name)).join(', ')}${uses.length>3?` +${uses.length-3} more`:''}). Their recipes keep it — they'll just show it as archived.`;
  }else if(o.ship30){
    extra=`<br><br>It shipped <b>${fmt(o.ship30)} units</b> in the last 30 days, so it's still active.`;
  }
  showConfirm(`Archive ${esc(o.name)}?`,
    `Archiving <b>hides it from the list</b>. Nothing is deleted — stock, build lists and history all stay, and you can bring it back any time from the <b>Archived</b> filter.${extra}`,
    apply);
}
/* What this ASIN has already sent. Shipments live in their own table and are
   never touched by a delete — but "trust me" is not good enough when someone is
   about to clear the board, so the dialog counts them out loud. */
function shipHistoryOf(p){
  const rows=(typeof lavShipments!=='undefined'?lavShipments:[]).filter(x=>x.asin===p.asin);
  return{n:rows.length,units:rows.reduce((t,x)=>t+(x.units||0),0),
    ids:[...new Set(rows.map(x=>x.shipId).filter(Boolean))]};
}
function delProduct(id){
  const p=prod(id);
  const stock=p.type!=='bundle'?onHand(p):0;
  confirmBox('Delete this product for good?',
    `<div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:8px">${esc(p.name)}</div>
     <div style="margin-bottom:10px">This removes the ASIN from the database permanently. It will not come back after a refresh.</div>
     <ul style="margin:0 0 10px 16px;padding:0;line-height:1.75">
       <li>${p.asin?esc(p.asin):'no ASIN'}${p.sku?' · '+esc(p.sku):''}</li>
       ${p.recipe.length?`<li>Its recipe of <b>${p.recipe.length} part${p.recipe.length===1?'':'s'}</b> is deleted — the components themselves are kept</li>`:''}
       ${stock?`<li><b style="color:var(--amb)">${fmt(stock)} in stock</b> will be written off</li>`:''}
       ${(()=>{const h=shipHistoryOf(p);
         return h.n
           ? `<li><b style="color:var(--grn)">${fmt(h.units)} units already sent across ${fmt(h.n)} shipment${h.n===1?'':'s'} are kept</b> — they stay on the Shipments page and in the monthly figures${h.ids.length?` (${esc(h.ids.slice(0,3).join(', '))}${h.ids.length>3?'…':''})`:''}</li>`
           : `<li>Nothing has been sent under this ASIN yet</li>`;})()}
     </ul>
     <div class="note bad" style="margin:0">Finished with it but want the history? Use <b>Archive</b> instead.</div>`,
    async()=>{
      snap();
      const src=p._src;
      D.products=D.products.filter(x=>x.id!==id);
      /* explicit removal — a render must never delete, so deletes say so out loud */
      if(src){
        const i=lavAsins.indexOf(src);
        if(i>=0)lavAsins.splice(i,1);
      }
      delete RECIPES[p.asin];
      for(let i=LAYERS.length-1;i>=0;i--)if(LAYERS[i].kind==='product'&&String(LAYERS[i].tid)===String(id))LAYERS.splice(i,1);
      logIt('edit','Deleted product '+p.name);
      cm('lav3Ov2');cm('lav3Ov1');render();
      const res=await deleteProduct_db(src,p);
      if(res.ok)toast(`"${p.name}" deleted permanently`,'ok');
      else toast('Deleted here, but the database refused — it may come back on refresh','er');
      saveCompsRecipes();
    },{danger:true,ok:'Delete permanently'});
}
async function deleteProduct_db(src,p){
  try{
    if(p&&p.asin){
      const rr=await sb.from('lavarion_recipes').delete().eq('asin',p.asin);
      if(rr.error)console.warn('[lav3] recipe cleanup',rr.error);
    }
    const lr=await sb.from('lavarion_stock_layers').delete().eq('target_id',String(p.id));
    if(lr.error)console.warn('[lav3] layer cleanup',lr.error);
    if(!src||!src.uuid)return{ok:true,skipped:'never saved'};
    const d=await sb.from('lavarion_asins').delete().eq('id',src.uuid);
    if(d.error){console.warn('[lav3] product delete',d.error);return{ok:false,err:d.error.message};}
    if(_layersLoadedCount>0)_layersLoadedCount=Math.max(0,_layersLoadedCount-1);
    return{ok:true};
  }catch(e){console.warn('[lav3] product delete failed',e);return{ok:false,err:e.message};}
}

/* ═══════════════ SHIP FLOW ═══════════════ */
let SHIP=null;
function openShip(id){
  const p=prod(id);
  /* default to what can go out at one price — the normal, clean shipment */
  const clean=cogCheck(p,1).cleanMax;
  const start=clean>0?Math.min(clean,avail(p).n||clean):Math.max(1,avail(p).n||1);
  SHIP={id,units:Math.max(1,start),override:false,reason:''};
  drawShip();om('lav3Ov1');}
function drawShip(){
  const p=prod(SHIP.id),a=avail(p),n=SHIP.units;
  const cg=cogOf(p,n);
  const chk=cogCheck(p,n);
  const blocked=cg.blocked.length>0;
  /* A batch booked in without a price is missing information, not free stock —
     cogOf says so in a SEPARATE array, and testing only `blocked` let it ship
     under a green chip at a COG of £0.00. */
  const noprice=!blocked&&(cg.unpriced||[]).length>0;
  const mixed=!blocked&&!noprice&&chk.mixed.length>0;   // stock is fine, but prices would mix
  const stopped=blocked||noprice||(mixed&&!SHIP.override);
  $('lav3Mod1').className='mod wide';
  $('lav3Mod1').innerHTML=`
  <div class="mh"><h3>Ship — ${esc(p.name)}</h3><span class="chip ${p.type}">${typeLabel(p.type)}</span><button class="x" onclick="LV3.cm('lav3Ov1')">&#10005;</button></div>
  <div class="mb">
    <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:13px;flex-wrap:wrap">
      <div style="width:150px"><span class="lab">Units to send</span>
        <input class="in mono" id="shipQty" type="number" min="1" value="${n}" style="font-size:18px;text-align:center;font-weight:700"
          oninput="LV3.shipQty(this.value)"></div>
      <div style="width:200px"><span class="lab">FBA shipment ID <span style="color:var(--red)">*</span></span>
        <input class="in mono ${SHIP.fba?'':'unset'}" id="shipId" placeholder="FBA15…" value="${esc(SHIP.fba||'')}" oninput="LV3.shipFba(this)">
        <div class="pmeta" style="margin-top:4px">${SHIP.fba
          ? `goes on the Shipments page as ${esc(SHIP.fba)}`
          : 'needed — this is what puts it on the Shipments page'}</div></div>
      <div class="stat" style="margin-left:auto;min-width:170px">
        <div class="k">${p.type==='bundle'?'You can build':'In stock'}</div>
        <div class="v" style="color:${a.n?'var(--green)':'var(--red)'}">${fmt(a.n)}</div></div>
    </div>
    ${blocked?shipBlock(p,cg,n):noprice?`<div class="mixWrap">
      <div class="mixHead">
        <span class="mixIcon">!</span>
        <div><div class="mixT">Blocked — no purchase price on record</div>
          <div class="mixS">Sending now would stamp this shipment £0.00 a unit, for good. Put the cost on the delivery in Purchases and it will price itself.</div></div>
      </div>
      ${cg.unpriced.map(u=>`<div class="att"><span class="dot" style="background:var(--amb)"></span>
        <span>${esc(u.name)} — ${fmt(u.units)} unit${u.units===1?'':'s'} booked in with no cost</span></div>`).join('')}
    </div>`:(mixed?shipMixed(p,chk,n):'')}
    ${stopped?'':shipOk(p,cg,n,mixed)}
  </div>
  <div class="mf">
    ${blocked?`<span class="pmeta" style="margin:0">Fix the shortfall or lower the quantity.</span>`
      :noprice?`<span class="pmeta" style="margin:0;color:var(--amb);font-weight:700">Blocked — a part has no price, so this cannot be costed.</span>`
      :mixed&&!SHIP.override?`<span class="pmeta" style="margin:0;color:var(--red);font-weight:700">Blocked — this would mix two costs in one shipment.</span>`
      :SHIP.override?`<span class="pmeta" style="margin:0;color:var(--amb);font-weight:700">Override on — mixed costs will be recorded against this shipment.</span>`
      :`<span class="pmeta" style="margin:0">Stock comes off oldest-first the moment you send.</span>`}
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov1')">Cancel</button>
    <button class="btn ${SHIP.override?'warn':'pri'}" ${stopped||n<1?'disabled':''} onclick="LV3.doShip()">Send ${fmt(n)} &amp; deduct</button></div></div>`;
}
/* The block screen. It has to say three things without being read twice:
   what stops it, what to send instead, and how to get out of it anyway. */
function chkRuns(p,n){const m=cogCheck(p,n).mixed;return m.length?Math.max(...m.map(x=>x.runs.length)):1;}
function shipMixed(p,chk,n){
  const worst=chk.mixed[0];
  const clean=chk.cleanMax;
  return `<div class="mixWrap">
    <div class="mixHead${SHIP.override?' ovr':''}">
      <span class="mixIcon">!</span>
      <div><div class="mixT">${SHIP.override?'Override on — sending two costs as one':'Blocked — this would send two different costs in one shipment'}</div>
        <div class="mixS">${SHIP.override
          ?`These ${fmt(n)} units will go out with an averaged cost of what you actually paid. It is recorded as an override in the log.`
          :`${fmt(n)} units can't come from one purchase price. Amazon gets one COG per shipment, so send each price separately.`}</div></div>
    </div>

    <div class="mixFix">
      <div class="mixFixT">Send this instead</div>
      <div class="mixFixR">
        <div class="mixOpt">
          <div class="k">Now, at one price</div>
          <div class="v">${fmt(clean)}<span> units</span></div>
          <div class="s">@ ${gbp(worst.runs[0].cost)} · bought ${dshort(worst.runs[0].date)}${worst.runs[0].sup?' · '+esc(worst.runs[0].sup):''}</div>
          <button class="btn pri sm" ${clean<1?'disabled':''} onclick="LV3.shipSetQty(${clean})">Send ${fmt(clean)} instead</button>
        </div>
        <div class="mixArrow">then</div>
        <div class="mixOpt">
          <div class="k">Next shipment</div>
          <div class="v">${fmt(Math.max(0,n-clean))}<span> units</span></div>
          <div class="s">@ ${gbp(worst.runs[1].cost)} · bought ${dshort(worst.runs[1].date)}${worst.runs[1].sup?' · '+esc(worst.runs[1].sup):''}</div>
          <div class="pmeta" style="margin:6px 0 0">Send it as its own FBA shipment with its own COG.</div>
        </div>
      </div>
    </div>

    <div class="mixWhy">
      <div class="lab" style="margin-bottom:6px">Why it's blocked</div>
      <table class="ltab" style="margin:0"><thead><tr><th style="padding-left:12px">Component</th><th>Per unit</th><th>Needed</th><th>At oldest price</th><th style="padding-right:12px">Would also take</th></tr></thead><tbody>
      ${chk.mixed.map(m=>`<tr>
        <td style="padding-left:12px"><b>${esc(m.name)}</b></td>
        <td>×${fmt(m.per)}</td>
        <td>${fmt(m.need)}</td>
        <td><b style="color:var(--grn)">${fmt(m.atFirst)}</b> @ ${gbp(m.runs[0].cost)}</td>
        <td style="padding-right:12px"><b style="color:var(--amb)">${fmt(Math.min(m.need-m.atFirst,m.runs[1].qty))}</b> @ ${gbp(m.runs[1].cost)}</td></tr>`).join('')}
      </tbody></table>
      <div class="pmeta" style="margin:8px 12px 0">Oldest stock always goes first. Batches that cost the same are treated as one — only a genuine price change blocks a shipment.</div>
    </div>

    ${SHIP.asking?`
      <div class="mixOv ask">
        <div style="flex:1">
          <b style="color:var(--amb)">Why does this have to go out mixed?</b>
          <div class="pmeta" style="margin:3px 0 8px">It is recorded on the shipment and counted in Settings, so the pattern is visible later.</div>
          <select class="in" id="ovWhy" style="max-width:420px">
            <option value="">Pick a reason…</option>
            ${OV_REASONS.map(r=>`<option value="${r[0]}">${esc(r[1])}</option>`).join('')}
          </select>
          <input class="in" id="ovNote" placeholder="Anything worth knowing (optional unless 'something else')" style="margin-top:7px">
        </div>
        <div style="display:grid;gap:6px">
          <button class="btn warn sm" onclick="LV3.shipOvConfirm()">Confirm override</button>
          <button class="btn sm" onclick="LV3.shipOverride(false)">Cancel</button>
        </div>
      </div>`
    :SHIP.override?`
      <div class="mixOv on">
        <div><b style="color:var(--amb)">Override on</b> — this shipment will go out with a blended cost and be flagged in the log.
          <div class="pmeta" style="margin:4px 0 0">Reason: ${esc(SHIP.reason||'—')}</div></div>
        <button class="btn sm" onclick="LV3.shipOverride(false)">Turn override off</button>
      </div>`:`
      <div class="mixOv">
        <div><b>Really need to send them together?</b>
          <div class="pmeta" style="margin:4px 0 0">Only for fixing a mistake — for example the units are already inside one Amazon shipment. It records a blended cost, which is less accurate.</div></div>
        <button class="btn warn sm" onclick="LV3.shipOverride(true)">Override the block</button>
      </div>`}
  </div>`;
}
function shipSetQty(n){SHIP.units=Math.max(1,n);SHIP.override=false;SHIP.reason='';drawShip();}
/* There are real reasons to send mixed — the units are already inside one Amazon
   shipment, a supplier corrected a price, a batch is being closed out. A free-text
   browser prompt recorded them as unsearchable prose, so nobody could ever ask
   "how often does this happen, and why". A reason CODE plus the detail can be
   counted; the note alone can't. */
const OV_REASONS=[
  ['already-in','Units are already inside one Amazon shipment'],
  ['price-fix','Supplier corrected the price after the fact'],
  ['close-out','Closing out the tail of an old batch'],
  ['deadline','Amazon deadline — cannot split it in time'],
  ['other','Something else']];
function shipOverride(on){
  if(!on){SHIP.override=false;SHIP.reason='';SHIP.reasonK='';SHIP.asking=false;drawShip();return;}
  SHIP.asking=true;drawShip();
  setTimeout(()=>{const e=document.getElementById('ovNote');if(e)e.focus();},60);
}
function shipOvConfirm(){
  const k=(document.getElementById('ovWhy')||{}).value||'';
  const note=((document.getElementById('ovNote')||{}).value||'').trim();
  if(!k){toast('Pick a reason','er');return;}
  if(k==='other'&&!note){toast('Say what the reason is','er');return;}
  const label=(OV_REASONS.find(r=>r[0]===k)||[])[1]||k;
  SHIP.override=true;SHIP.reasonK=k;
  SHIP.reason=label+(note?' — '+note:'');
  SHIP.asking=false;drawShip();
  toast('Override on — recorded against this shipment','er');
}

function shipOk(p,cg,n,mixed){
  const costLines=cg.lines.filter(l=>!l.pack).length;   // packaging isn't a cost line
  const blended=!!mixed;                                 // only a real price mix counts
  return `<div class="panel" style="margin-bottom:11px">
    <div class="ph"><span class="t">Cost of this shipment</span><span class="sub">oldest stock first${blended?` · two prices averaged`:''}</span>
      <div class="r"><button class="btn sm" onclick="LV3.copyCog('${cg.per.toFixed(2)}')">Copy £${cg.per.toFixed(2)}</button></div></div>
    <table class="ltab" style="margin:0"><thead><tr><th style="padding-left:12px">Component</th><th>Per unit</th><th>Needed</th><th>Batches used</th><th style="padding-right:12px">Cost</th></tr></thead><tbody>
    ${cg.lines.map(l=>`<tr ${l.pack?'style="opacity:.62"':''}><td style="padding-left:12px">${esc(l.name)}${l.pack?' <span class="chip packaging">not in COG</span>':''}</td><td>${l.q?'×'+l.q:''}</td><td>${fmt(l.need)}</td>
      <td style="font-size:11.5px">${l.parts.map(pt=>`${fmt(pt.take)} @ ${gbp(pt.cost)}`).join('  +  ')}</td>
      <td style="padding-right:12px">${l.pack?'—':gbp(l.value)}</td></tr>`).join('')}
    </tbody></table>
    <div style="display:flex;align-items:center;gap:16px;padding:10px 12px;border-top:1px solid var(--border);background:var(--bg3)">
      <span class="lab">COG per unit</span><span class="num" style="font-size:20px;color:var(--accent)">${gbp(cg.per)}</span>
      <span class="lab" style="margin-left:10px">Shipment total</span><span class="num" style="font-size:16px">${gbp(cg.total)}</span>
      ${blended?`<span class="chip bad" style="margin-left:auto">blended across ${chkRuns(p,n)} prices</span>`
        :`<span class="chip ok" style="margin-left:auto">single price</span>`}
    </div></div>
  ${blended?`<div class="note bad">This figure is a <b>weighted average</b> of two different purchase prices. It is not what you paid for any one unit — it is only here because the block was overridden.</div>`
    :`<div class="note">Every unit in this shipment came from the same purchase price, so this COG is exactly what you paid.</div>`}`;
}
function shipBlock(p,cg,n){
  return `<div class="note bad" style="margin-bottom:12px">
    <div style="font-size:13.5px;font-weight:800;color:var(--red);margin-bottom:4px">Can't send ${fmt(n)} unit${n===1?'':'s'}</div>
    ${p.type==='bundle'?`There are only enough components for <b>${fmt(avail(p).n)}</b>.`:`There are only <b>${fmt(onHand(p))}</b> in stock.`}
    Lower the quantity, receive a delivery, or correct the stock if the count is wrong.</div>
  ${cg.blocked.map(b=>{
    const o=b.o;const isC=!!comp(o.id);
    const last=arrLayers(o).slice(-1)[0];
    const inc=nextIn(o);
    const uses=isC?usedIn(o.id).filter(u=>u.id!==p.id):[];
    return `<div class="panel">
      <div class="ph"><span class="t" style="color:var(--red)">${esc(o.name)}</span>
        <span class="sub">short by ${fmt(b.short)}</span>
        <div class="r"><button class="btn sm" onclick="LV3.openAdjust('${isC?'component':'product'}','${o.id}')">Correct stock</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding:11px 12px">
        <div class="stat"><div class="k">Needed</div><div class="v">${fmt(b.need)}</div></div>
        <div class="stat"><div class="k">System stock</div><div class="v" style="color:var(--amber)">${fmt(b.have)}</div></div>
        <div class="stat"><div class="k">Shortfall</div><div class="v" style="color:var(--red)">${fmt(b.short)}</div></div>
      </div>
      <div style="padding:0 12px 11px">
        <div class="lab" style="margin-bottom:4px">Where the number comes from</div>
        <table class="ltab" style="margin-top:0"><tbody>
        <tr><td>Last purchase</td><td colspan="2">${last?`${fmt(last.qty)} @ ${gbp(last.cost)} · ${dshort(last.date)} · ${esc(last.sup)}`:'none recorded'}</td></tr>
        <tr><td>On order</td><td colspan="2">${inc?`${fmt(inc.qty)} ordered ${dshort(inc.date)} — not marked arrived yet`:'nothing on order'}</td></tr>
        ${uses.length?`<tr><td>Also used by</td><td colspan="2">${uses.map(u=>esc(u.name)+' (×'+u.recipe.find(r=>r.c===o.id).q+')').join(', ')}</td></tr>`:''}
        <tr><td>Recent movement</td><td colspan="2">${D.log.filter(l=>l.txt.includes(o.name.split(' ')[0])).slice(0,2).map(l=>esc(l.txt)).join('<br>')||'—'}</td></tr>
        </tbody></table>
        ${inc?`<button class="btn sm go" style="margin-top:9px" onclick="LV3.markArrived('${isC?'component':'product'}','${o.id}','${inc.id}')">Mark that delivery arrived (+${fmt(inc.qty)})</button>`:''}
      </div></div>`;}).join('')}`;
}
function copyCog(v){navigator.clipboard&&navigator.clipboard.writeText(v);toast('COG £'+v+' copied','ok');}
function doShip(){
  const p=prod(SHIP.id),n=SHIP.units,cg=cogOf(p,n);
  if(n<1){toast('Blocked','er');return;}
  if(cg.blocked.length){toast('Blocked — not enough stock to build '+fmt(n),'er');return;}
  /* cg.per is 0 whenever anything is unpriced, and that 0 used to be written
     onto the shipment as its COG, permanently. */
  if((cg.unpriced||[]).length){
    toast('Blocked — no price on '+cg.unpriced.map(u=>u.name).join(', ')+'. Price the delivery in Purchases first, or this ships at £0.00.','er');
    return;
  }
  const chk=cogCheck(p,n);
  if(chk.mixed.length&&!SHIP.override){toast('Blocked — mixed costs. Send '+fmt(chk.cleanMax)+' instead, or override.','er');return;}
  /* Without an FBA ID this took stock off the shelf and told the Shipments page
     nothing — the two halves of the app then disagreed about what had been sent,
     and the month's reporting was short. */
  const fba=(SHIP.fba||'').trim().toUpperCase();
  if(!fba){
    toast('Enter the FBA shipment ID — without it this would not reach the Shipments page','er');
    const el=document.getElementById('shipId');if(el)el.focus();
    return;
  }
  snap();
  /* The FIFO draw used to happen here AND again inside saveLavShipment, which
     is monkey-patched to call shipConsume — so every send from this modal took
     the stock off twice. One send, one deduction: the patch owns it now, and
     it is the same path the Shipments page uses. */
  p.ship30=(p.ship30||0)+n;p.lastSent=localDay(TODAY);
  /* record it where the rest of the app looks: the Shipments page, the monthly
     numbers and the COG history all read lavShipments */
  const rec={shipId:fba,asin:p.asin,sku:p.sku||'',prod:p.name,units:n,
    /* an existing FBA ID keeps its own date — a line added later must not drag
       the whole shipment forward to today */
    /* A blend lands on fractions of a penny. It rounds UP — a COG guessed high
       costs nothing, a COG guessed low flatters every margin downstream. */
    cost:chk.mixed.length?Math.ceil(cg.per*100)/100:Number(cg.per.toFixed(4)),
    date:(typeof shipDateFor==='function')?shipDateFor(fba):dayISO()};
  try{
    if(typeof lavShipments!=='undefined')lavShipments.push(rec);
    if(typeof saveLavShipment==='function')saveLavShipment(rec);
    if(typeof renderShipments==='function')setTimeout(renderShipments,0);
    if(typeof renderDashboard==='function')setTimeout(renderDashboard,0);
  }catch(e){console.warn('[lav3] shipment record',e);}
  /* The reason was only ever written into a log line, which cannot be counted.
     Stored as a record so Settings can answer "how often, and why". */
  if(chk.mixed.length&&SHIP.override){
    D.settings.overrides=D.settings.overrides||[];
    D.settings.overrides.unshift({on:dayISO(),by:(window.currentUserName||'someone'),
      shipId:fba,prod:p.name,units:n,k:SHIP.reasonK||'other',why:SHIP.reason||'',
      cost:Number(cg.per.toFixed(4))});
    D.settings.overrides=D.settings.overrides.slice(0,300);
    savePrefs();
  }
  const mixNote=chk.mixed.length?` — MIXED COSTS, override: ${SHIP.reason||'no reason given'}`:'';
  logIt('ship',`Sent ${n} × ${p.name} to ${fba} — COG ${gbp(cg.per)}/unit${mixNote}`);
  cm('lav3Ov1');render();
  toastUndo(`Sent ${fmt(n)} × ${p.name} — COG ${gbp(cg.per)}/unit${chk.mixed.length?' (blended — overridden)':''}`,chk.mixed.length?'er':'ok');
}

/* ═══════════════ COMPONENTS ═══════════════ */
function vComponents(){
  const liveC=D.components.filter(c=>!c.archived);
  const archC=D.components.filter(c=>c.archived);

  const counts={all:liveC.length,component:0,packaging:0,low:0,archived:archC.length,
    branded:0,'private-label':0,complementary:0};
  const _plc2=(function(){try{return plData().byComp||{};}catch(e){return{};}})();
  liveC.forEach(c=>{counts[c.kind]++;if((_plc2[c.id]||{}).buyQty>0)counts.low++;
    const t=c.tag||'complementary';if(counts[t]!==undefined)counts[t]++;});
  const basisC=cFilter==='archived'?archC:liveC;
  const TAGS=['branded','private-label','complementary'];
  let rows=sortComponents(basisC.filter(c=>{
    if(cFilter==='all'||cFilter==='archived')return !Q||c.name.toLowerCase().includes(Q);
    const hit=cFilter==='low'?(((function(){try{return plData().byComp||{};}catch(e){return{};}})()[c.id]||{}).buyQty>0)
      :TAGS.includes(cFilter)?((c.tag||'complementary')===cFilter)
      :c.kind===cFilter;
    return hit&&(!Q||c.name.toLowerCase().includes(Q));
  }));
  const _stat=(function(){
    const _M=(function(){try{return plData().byComp||{};}catch(e){return{};}})();
    const Ls=Object.values(_M);
    const buys=Ls.filter(L=>L.buyQty>0&&['buy','soon'].indexOf(L.state)>=0);
    const overdue=buys.filter(L=>L.buyByDays<0).length;
    const spend=buys.reduce((t,L)=>t+(L.cost||0),0);
    let incU=0,incV=0,stockV=0;
    liveC.forEach(c=>{const oo=onOrder(c);incU+=oo;
      const nx=nextIn(c);if(oo&&nx)incV+=oo*(nx.cost||0);
      stockV+=arrLayers(c).reduce((a,l)=>a+l.rem*l.cost,0);});
    const card=(v,lab,sub,col)=>`<div style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-top:2px solid ${col};border-radius:10px;padding:11px 14px;">
      <div style="font-size:23px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1.1;">${v}</div>
      <div style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);margin-top:4px;">${lab}</div>
      <div style="font-size:10.5px;color:var(--text3);margin-top:1px;">${sub}</div></div>`;
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
      ${card(fmt(buys.length),'to buy',spend?('about '+gbp(spend)):'nothing due',buys.length?'#fbbf24':'#4ade80')}
      ${card(fmt(overdue),'overdue orders','should already be placed',overdue?'#f87171':'#4ade80')}
      ${card(fmt(incU),'units incoming',incV?gbp(incV)+' on the way':'nothing on order','#60a5fa')}
      ${card(gbp(stockV),'on the shelf','at what you paid','#22d3ee')}
    </div>`;})();
  $('lav3View').innerHTML=`
  ${_stat}
  <div class="panel stick">
    <div class="ph">
      <div class="seg">${[['all','All'],['component','Components'],['packaging','Packaging'],
          ['branded','Branded'],['private-label','Private label'],['complementary','Complementary'],
          ['low','To buy']]
        .concat(archC.length?[['archived','Archived']]:[])
        .map(([k,l])=>`<button class="${cFilter===k?'on':''}" onclick="LV3.setFilter('c','${k}')">${l}<span class="cnt">${fmt(counts[k])}</span></button>`).join('')}</div>
      <input class="srch" placeholder="Search components…" value="${esc(Q)}" oninput="LV3.setQ(this.value)">
      ${sortPicker('c',cSort,C_SORTS)}
      <div class="r"><button class="btn" onclick="LV3.openBulkComp()">Bulk add</button>
        <button class="btn pri" onclick="LV3.editComp(null)">+ Add component</button></div>
    </div>
    <div id="cselBar"></div>
    <table><thead><tr>
      <th style="width:30px;text-align:center"><input type="checkbox" onclick="LV3.cselAll(this.checked)"></th>
      ${/* Every column had a fixed width and none of them added up to the table,
           so the browser inflated all seven proportionally — that is where the
           dead space came from. Now only "Used in" is free, so the slack goes
           to the one column that has something to say with it. */''}
      <th class="l" style="width:238px">${sortTh('c','name','Component')}</th>
      <th style="width:104px">${sortTh('c','low','On hand')}<span class="thS">value at cost</span></th>
      ${/* ON ORDER and ORDERED were fed by the same unarrived-layer set, so they
           were guaranteed to be blank TOGETHER — 85 of 87 rows, two columns,
           about 160 near-white em-dashes as the loudest thing on the page.
           compShort60 and compCover are computed for every row on every render
           and were spent tinting one number amber. Now they are printed, and
           on-order rides inside On hand where it belongs. */''}
      <th style="width:92px">${sortTh('c','order','Incoming')}<span class="thS">on order</span></th>
      <th style="width:96px">${sortTh('c','short','To buy')}<span class="thS">from the Planner</span></th>
      <th style="width:80px">${sortTh('c','cover','Cover')}<span class="thS">days left</span></th>
      ${COL('cUsed')?`<th class="l" style="min-width:130px;max-width:260px">${sortTh('c','used','Used in')}</th>`:''}
      <th class="l" style="width:132px">Supplier<span class="thS">last paid</span></th>
      <th class="acts" style="width:150px">Action</th>
    </tr></thead><tbody>
    ${rows.length?rows.map(c=>{
      const h=onHand(c),oo=onOrder(c),nx=nextIn(c),need=compNeed60(c),short=compShort60(c),old=arrLayers(c).filter(l=>l.rem>0)[0];
      const uses=usedIn(c.id);
      /* ONE colour rail carries the state; the figures stay plain. Jack, 19 Aug:
         "don't over complicate it with loads of colours". Untracked and
         no-demand parts are grey on purpose — a green "covered" on a part whose
         demand nobody knows is a guess wearing a fact's clothes. */
      const wk=(function(){try{return compWeekUse(c);}catch(e){return null;}})();
      const cov=(function(){try{return compCover(c);}catch(e){return null;}})();
      const unknown=c.untracked||need==null||(wk==null&&!short);
      const EL=(function(){try{return (plData().byComp||{})[c.id]||null;}catch(e){return null;}})();
      const rail=c.untracked?'var(--muted2)'
        :EL?(EL.state==='buy'?'var(--red)':EL.state==='soon'?'var(--amb)'
          :(EL.state==='noroute'||EL.state==='nosup')?'var(--amb)':'var(--grn)')
        :(h===0&&!unknown?'var(--red)':'var(--muted2)');
      let sup=(function(){try{return usualSupplier(c)||'';}catch(e){return '';}})();
      if(/^(stock (correction|adjust)|opening stock|stocktake)/i.test(sup))sup='';
      if(!sup&&EL&&EL.sup)sup=EL.sup;
      const avg=(function(){try{return avgCostOf(c);}catch(e){return 0;}})();
      return `<tr style="cursor:pointer${(!EL&&!c.untracked)?';opacity:.62':''}" class="${CSEL.has(c.id)?'picked':''}" onclick="LV3.openComp('${c.id}')">
        <td onclick="event.stopPropagation()" style="text-align:center">
          <input type="checkbox" ${CSEL.has(c.id)?'checked':''} onclick="LV3.cselOne('${c.id}',this.checked)"></td>
        <td class="l cRail" style="box-shadow:inset 3px 0 0 ${rail};padding-top:8px;padding-bottom:8px;">
          <div style="display:flex;gap:7px;align-items:baseline;flex-wrap:wrap;">
            <span class="pname" style="font-size:12.5px">${esc(c.name)}</span>
            <span class="pmeta" style="margin:0;font-size:10.5px;">${c.kind==='packaging'?'packaging':({branded:'branded','private-label':'private label',complementary:'complementary'})[c.tag||'complementary']}${c.caseQty?` · case of ${fmt(c.caseQty)}`:''}${c.untracked?' · not tracked':''}</span>
          </div></td>
        <td><span class="num" style="font-size:14.5px;font-weight:800;">${fmt(h)}</span>
          <div class="pmeta">${avg?gbp(h*avg)+' at cost':(arrLayers(c).filter(l=>l.rem>0).length+' batch'+(arrLayers(c).filter(l=>l.rem>0).length===1?'':'es'))}</div></td>
        <td>${oo?`<span class="num" style="color:var(--blu)">${fmt(oo)}</span><div class="pmeta">${(function(){
            if(!nx)return 'on order';
            var st=null;try{st=etaState(nx);}catch(e){}
            var due=nx.eta2||nx.eta1||'';
            if(st&&st.k==='late')return '<b style="color:var(--red)">late — was '+dshort(due)+'</b>';
            if(due)return 'due '+dshort(due);
            return '<span style="color:var(--amb)">no ETA</span>';})()}</div>`
          :'<span class="num dimNum">—</span>'}</td>
        <td>${c.untracked
            ? `<span class="num dimNum">?</span><div class="pmeta">not tracked</div>`
            : !EL
              ? `<span class="num dimNum">—</span><div class="pmeta">${(function(){const us=usedIn(c.id);return us.length&&us.every(p=>hubSkipped(p))?'not selling':'no sales figure';})()}</div>`
              : (EL.state==='noroute'||EL.state==='nosup')
                ? `<span class="num dimNum">—</span><div class="pmeta" style="color:var(--amb)">${EL.state==='nosup'?'no supplier':'<a href="javascript:void(0)" onclick="event.stopPropagation();LV3.go(\'planner\')" style="color:var(--amb)">set the route</a>'}</div>`
                : EL.buyQty>0
                  ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-family:var(--num);font-variant-numeric:tabular-nums;font-weight:900;font-size:13.5px;color:#14120f;background:${EL.buyByDays<=0?'#f87171':'#fbbf24'}">${fmt(EL.buyQty)}</span><div class="pmeta" style="color:${EL.buyByDays<0?'var(--red)':'var(--text3)'}">${EL.buyByDays<0?fmt(-EL.buyByDays)+'d overdue':EL.buyByDays<=0?'order today':'by '+dshort(EL.buyBy)}</div>`
                  : `<span class="num dimNum">—</span><div class="pmeta">${EL.state==='waiting'?'on order covers it':'covered'}</div>`}</td>
        <td>${c.untracked||!EL||EL.cover==null
            ? '<span class="num dimNum">—</span>'
            : `<span class="num">${EL.cover>365?'1yr+':fmt(Math.round(EL.cover))}</span><div class="pmeta">day${Math.round(EL.cover)===1?'':'s'}</div>`}</td>
        ${COL('cUsed')?`<td class="l">${uses.length?`<div class="useWrap">${uses.slice(0,2).map(u=>
            `<button class="useChip" title="Open ${esc(u.name)}" onclick="event.stopPropagation();LV3.openProduct('${u.id}')">${esc(u.name)}</button>`).join('')}${
            uses.length>2?`<span class="pmeta" style="margin:0">+${uses.length-2} more</span>`:''}</div>`
          :'<span class="dimNum">not used yet</span>'}</td>`:''}
        <td class="l">${sup?`<div style="font-size:12px;font-weight:600;color:var(--text)">${esc(sup)}</div>`:'<span class="dimNum">—</span>'}
          <div class="pmeta">${[
            avg?`<span style="color:${'var(--accent)'}">${gbp(avg)} each</span>`:'',
            (function(){const r=sup?routeDaysFor(sup):null;
              if(r)return esc(String(r.label).replace(' / parcel',''))+' '+r.hi+'d';
              if(sup&&EL&&EL.state!=='safe'&&!c.untracked)return '<a href="javascript:void(0)" onclick="event.stopPropagation();LV3.go(\'planner\')" style="color:var(--amb)">route not set</a>';
              return '';})()
          ].filter(Boolean).join(' · ')||'&nbsp;'}</div></td>
        <td class="acts" onclick="event.stopPropagation()"><div style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
          ${c.archived?`<button class="btn sm go" onclick="LV3.setArchived('component','${c.id}',false)">Restore</button>`
            : (function(){
                /* ONE action that changes with the situation, and the rest in the
                   menu. Four buttons on 87 rows was 348 buttons on one screen,
                   and not one of them was "buy more of this" — the thing you
                   have just been told to do. */
                const eq=EL&&EL.buyQty>0?EL.buyQty:0;
                const cases=EL&&EL.cases?EL.cases:0;
                const primary=eq>0
                  ? `<button class="btn sm pri" title="Log an order for this part — the Planner's quantity" onclick="LV3.openLogOrder('${c.id}')">${cases?`Order ${fmt(cases)} case${cases===1?'':'s'}`:`Order ${fmt(eq)}`}</button>`
                  : (oo?`<button class="btn sm" title="Book in what has arrived" onclick="LV3.openAddBatch('${c.id}','component')">Receive</button>`
                       :`<button class="btn sm" title="Book in stock you already have" onclick="LV3.openAddBatch('${c.id}','component')">+ Batch</button>`);
                return primary+`<button class="btn sm dots" title="Adjust, add to a build list, archive or delete" onclick="LV3.rowMenu(event,'component','${c.id}')">⋯</button>`;
              })()}</div></td></tr>`;}).join('')
      :`<tr><td colspan="${7+['cUsed'].filter(COL).length}" class="empty">${D.components.length?'Nothing matches this filter.':
   'No components yet.<div style="margin-top:10px;display:flex;gap:7px;justify-content:center"><button class="btn pri" onclick="LV3.openBulkComp()">Bulk add components</button><button class="btn" onclick="LV3.editComp(null)">Add one</button></div>'}</td></tr>`}
    </tbody></table>
  </div>
  <div style="font-size:11px;color:var(--text3);padding:0 2px;">Tick components to change their kind, stop tracking them, archive or delete in bulk. Stock is held as batches — sending always consumes the <b>oldest batch first</b>.</div>`;
  cselBar();
}
/* ── WHAT HAPPENED TO THIS PART ───────────────────────────────────────────
   Batches say what is there now. This says how it got there — the trail you
   need when a count is wrong and nobody can explain it. Built from the batches
   themselves plus anything in the movement log that names this part. */
/* One order that arrived in three boxes has to read as ONE order and three
   deliveries. Built naively off the batches it read as three separate orders —
   "Ordered 44 · Ordered 30 · Ordered 14" — because every receipt is its own
   batch and `qty` on an open order now means what is still owed. */
function compTimeline(c){
  const ev=[];
  (c.layers||[]).forEach(l=>{
    const isBatch=!!l.ofOrd;                 // a delivery against an order, not an order
    const shell=!!(l.closed&&!l.qty);        // an order that closed across several deliveries
    if(!isBatch)ev.push({on:l.date,k:'order',txt:`Ordered ${fmt(ordQty(l))}${l.cost>0?` @ ${gbp(l.cost)}`:''}`,
      sub:`${esc(l.sup||'—')}${l.oid&&l.oid!=='—'?' · '+esc(l.oid):''}`});
    /* Every receipt against this order, each on the day it landed. This is the
       history — "78 of 100, then 22 a week later" — and it is the only thing
       that explains a batch list with three rows and one order number. */
    if(l.rcpts&&l.rcpts.length){
      const ord=ordQty(l);let run=0;
      l.rcpts.forEach((r,i)=>{run+=r.got;
        ev.push({on:r.on,k:'recv',
          txt:`Delivery ${i+1} — ${fmt(r.got)} in${r.dmg?`, ${fmt(r.dmg)} damaged`:''}`,
          sub:`${fmt(run)} of ${fmt(ord)}${run<ord?` · ${fmt(ord-run)} still owed`:' · order complete'}${r.by?' · '+esc(r.by):''}`});});
    }
    else if(l.arr&&l.recvOn&&!isBatch)ev.push({on:l.recvOn,k:'recv',
      txt:`Received ${fmt(l.qty)}${l.cost>0?` @ ${gbp(l.cost)}`:''}`,
      sub:`${esc(l.sup||'—')}${l.recvBy?' · taken in by '+esc(l.recvBy):''}`});
    else if(l.arr&&!shell&&!isBatch)ev.push({on:l.date,k:'recv',txt:`In stock — ${fmt(l.qty)}${l.cost>0?` @ ${gbp(l.cost)}`:''}`,
      sub:esc(l.sup||'opening stock')});
    if(l.dmg>0)ev.push({on:l.dmgOn||l.recvOn||l.date,k:'dmg',
      txt:`${fmt(l.dmg)} damaged${l.cost>0?` · ${gbp(l.dmg*l.cost)}`:''}`,
      sub:l.dmgEnd?`${({refund:'refunded',ret:'sent back',keep:'kept',binned:'written off'})[l.dmgEnd.k]||'closed'} ${dshort(l.dmgEnd.on)}${l.dmgEnd.by?' · '+esc(l.dmgEnd.by):''}`
        :'held out of stock — still open with the supplier'});
    if(l.short&&l.shortQty)ev.push({on:l.shortOn||l.date,k:'short',
      txt:`Declared ${fmt(l.shortQty)} short`,
      sub:`${l.shortBy?esc(l.shortBy)+' said the delivery was finished':'delivery finished'} — ${esc(l.sup||'the supplier')} owes them`});
    if(l.repl&&l.repl.qty>0)ev.push({on:l.repl.on,k:'repl',
      txt:`${fmt(l.repl.qty)} replacement${l.repl.qty===1?'':'s'} agreed`,
      sub:`${esc(l.sup||'the supplier')} sending more${l.repl.by?' · '+esc(l.repl.by):''}${l.repl.note?' · '+esc(l.repl.note):''}`});
    if(l.writtenOff)ev.push({on:l.writtenOff,k:'off',txt:`Written off`,sub:`accepted it was not coming`});
  });
  /* the log holds corrections and sends; match on the name */
  const nm=c.name.toLowerCase();
  (D.log||[]).forEach(g=>{
    const t=(g.txt||'').toLowerCase();
    if(!t.includes(nm))return;
    if(g.k==='adj')ev.push({on:(g.t||'').slice(0,10),k:'adj',txt:g.txt,sub:g.who||''});
    else if(g.k==='ship')ev.push({on:(g.t||'').slice(0,10),k:'ship',txt:g.txt,sub:g.who||''});
  });
  /* builds consume it silently, so name the products that drew it down */
  return ev.filter(e=>e.on).sort((a,b)=>b.on.localeCompare(a.on)).slice(0,60);
}
const TL_ICON={order:'○',recv:'✓',short:'!',dmg:'⚠',repl:'↻',off:'✕',adj:'±',ship:'→'};
const TL_COL={order:'var(--blu)',recv:'var(--grn)',short:'var(--red)',dmg:'var(--amb)',repl:'var(--vio)',
  off:'var(--text3)',adj:'var(--amb)',ship:'var(--vio)'};
function timelineHtml(c){
  const ev=compTimeline(c);
  if(!ev.length)return `<div class="pmeta" style="padding:10px 0">Nothing has happened to this one yet.</div>`;
  return `<div class="tl">${ev.map(e=>`<div class="tlRow">
    <span class="tlDot" style="background:${TL_COL[e.k]||'var(--text3)'}">${TL_ICON[e.k]||'·'}</span>
    <div class="tlTxt"><b>${e.txt}</b>${e.sub?`<span>${e.sub}</span>`:''}</div>
    <span class="tlWhen">${dshort(e.on)}<i>${daysSince(e.on)===0?'today':daysSince(e.on)+'d ago'}</i></span>
  </div>`).join('')}</div>`;
}
function openComp(id){
  const c=comp(id),uses=usedIn(id);
  const ls=realLayers(c).slice().sort((a,b)=>a.date.localeCompare(b.date));
  $('lav3Mod1').className='mod wide';
  $('lav3Mod1').innerHTML=`
  <div class="mh"><h3>${esc(c.name)}</h3><span class="chip ${c.kind}">${c.kind==='packaging'?'Packaging':'Component'}</span><button class="x" onclick="LV3.cm('lav3Ov1')">&#10005;</button></div>
  <div class="mb">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:13px">
      <div class="stat"><div class="k">On hand</div><div class="v" style="color:${onHand(c)?'var(--grn)':'var(--red)'}">${fmt(onHand(c))}</div></div>
      <div class="stat"><div class="k">On order</div><div class="v" ${onOrder(c)?'style="color:var(--blu)"':''}>${fmt(onOrder(c))}</div></div>
      <div class="stat"><div class="k">Latest batch</div><div class="v" style="color:var(--accent)">${(()=>{const l=arrLayers(c).filter(x=>x.rem>0).slice(-1)[0];return l?gbp(l.cost):'—';})()}</div>
        <div class="pmeta" style="margin:3px 0 0">every batch keeps its own price</div></div>
      <div class="stat"><div class="k">Needed for ${D.settings.targetDays||60} days</div>
        <div class="v" style="color:${compShort60(c)>0?'var(--amb)':'var(--grn)'}">${compNeed60(c)?fmt(compNeed60(c)):'—'}</div>
        <div class="pmeta" style="margin:3px 0 0">${compNeed60(c)?(compShort60(c)>0?`${fmt(compShort60(c))} short, counting what's on order`:'covered'):'no product needs it yet'}</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="lab" style="margin:0">Stock batches — consumed oldest first</span>
      <button class="btn sm pri" style="margin-left:auto" title="Backstock you already hold at a different price"
        onclick="LV3.openAddBatch('${c.id}','component')">+ Add a batch</button>
    </div>
    <table class="ltab"><thead><tr><th>Supplier</th><th>Bought</th><th>Order</th><th>Qty</th><th>Left</th><th>Unit</th><th>Where</th><th>Status</th></tr></thead><tbody>
    ${ls.map((l,i)=>{const nextOut=l.arr&&l.rem>0&&arrLayers(c).filter(x=>x.rem>0)[0]===l;
      return `<tr class="${l.arr&&l.rem===0?'spent':''} ${nextOut?'used':''}"><td>${esc(l.sup)}</td><td>${dshort(l.date)}</td>
      <td style="font-size:10px">${esc(l.oid)}</td><td>${fmt(l.qty)}</td><td>${l.arr?fmt(l.rem):'—'}</td><td>${gbp(l.cost)}</td>
      <td style="font-size:10.5px">${esc(l.loc)}</td>
      <td>${!l.arr?`<button class="btn sm go" onclick="LV3.markArrived('component','${c.id}','${l.id}')">Receive</button>`
        :nextOut?'<span class="chip warn">next out</span>':l.rem?'<span class="chip ok">in stock</span>':'<span class="chip vat">used up</span>'}</td></tr>`;}).join('')}
    </tbody></table>
    <div class="lab" style="margin:16px 0 6px">What has happened to it</div>
    ${timelineHtml(c)}
    ${uses.length?`<div class="lab" style="margin:14px 0 4px">Used in ${uses.length} product${uses.length===1?'':'s'}</div>
    <table class="ltab"><thead><tr><th>Product</th><th>Per unit</th><th>Buildable from this</th><th>30d demand</th></tr></thead><tbody>
    ${uses.map(u=>{const r=u.recipe.find(x=>x.c===id);return `<tr><td>${esc(u.name)}</td><td>×${r.q}</td>
      <td>${fmt(Math.floor(onHand(c)/r.q))}</td><td>${fmt(r.q*(u.ship30||0))}</td></tr>`;}).join('')}
    </tbody></table>
    ${uses.length>1?`<div class="note" style="margin-top:10px">Shared part — every one of these products draws from the same ${fmt(onHand(c))} units.</div>`:''}`
    :'<div class="note info" style="margin-top:13px">Not used in any product yet. Add it to a build list from the product editor.</div>'}
  </div>
  <div class="mf"><button class="btn dgr" onclick="LV3.delComp('${c.id}')">Delete</button>
    <div class="sp"><button class="btn" onclick="LV3.openAdjust('component','${c.id}')">Correct stock</button>
    <button class="btn" onclick="LV3.editComp('${c.id}')">Edit</button></div></div>`;
  om('lav3Ov1');
}
function editComp(id){
  const c=id?comp(id):{id:newId('c'),name:'',kind:'component',tag:'complementary',caseQty:null,layers:[]};
  $('lav3Mod2').className='mod slim';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>${id?'Edit component':'Add component'}</h3><button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    <div class="frow"><span class="lab">Name</span><input class="in" id="c-name" value="${esc(c.name)}" placeholder="e.g. Exfoliating Glove"></div>
    <div class="frow"><span class="lab">Kind</span>
      <div class="seg" style="width:100%" id="ckSeg">${['component','packaging'].map(k=>`<button style="flex:1" class="${c.kind===k?'on':''}" onclick="LV3.pickKind('${k}')">${k==='packaging'?'Packaging':'Component'}</button>`).join('')}</div>
      <div class="pmeta" style="margin-top:5px">Packaging = the box/sleeve inside the finished product, not the shipping carton.</div></div>
    <div class="g2 frow">
      <div id="ckCat"><span class="lab">What kind of component</span>
        <select class="in" id="c-tag">${[['branded','Branded — e.g. Dove'],['private-label','Private label — e.g. Lavarion'],['complementary','Complementary — mitt, scraper, sandpaper']]
          .map(([v,l])=>`<option value="${v}" ${c.tag===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div><span class="lab">Case qty <span style="text-transform:none;font-weight:600">(optional)</span></span><input class="in mono" id="c-case" type="number" value="${c.caseQty||''}"></div></div>
    <label style="display:flex;gap:9px;align-items:flex-start;margin:2px 0 12px;font-size:12.5px;color:var(--text2);cursor:pointer">
      <input type="checkbox" id="c-untracked" ${c.untracked?'checked':''} style="margin-top:2px">
      <span>Don't track stock for this one
        <span class="pmeta" style="margin-top:2px">For things you always have and share with OA — poly bags, tape, labels. It still shows in the recipe, but never blocks a build and never counts toward COG.</span></span></label>
    ${id?`<div class="note info">Stock comes from batches — each delivery keeps its own price. Use <b>Correct stock</b> if a physical count disagrees, or <b>Log an order</b> for a new delivery.</div>`
      :`<div class="panel" style="margin-top:4px">
        <div class="ph"><span class="t">What you have right now</span><span class="sub">optional — this becomes its first batch</span></div>
        <div class="g2" id="c-open-grid" style="padding:12px">
          <div><span class="lab">Units in stock</span><input class="in num" id="c-open-qty" type="number" min="0" placeholder="0"></div>
          <div id="c-open-cost-wrap"><span class="lab">What they cost each</span><input class="in num" id="c-open-cost" type="number" step="0.01" min="0" placeholder="0.00"></div>
        </div>
        <div class="pmeta" id="c-open-hint" style="padding:0 12px 12px">Every later delivery is added as its own batch at its own price. <b>On hand</b> always shows the total across all batches — order 30, 40, 10 and 20 and it reads 100.</div>
      </div>`}
  </div>
  <div class="mf">${id?`<button class="btn dgr" onclick="LV3.delComp('${id}')">Delete</button>`:''}
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.saveComp('${id||''}')">Save</button></div></div>`;
  window._ck=c.kind;om('lav3Ov2');setTimeout(()=>pickKind(c.kind||'component'),0);
}
function setCol(k,on){D.settings.cols=D.settings.cols||{};D.settings.cols[k]=!!on;savePrefs();render();}
/* Typed by hand, so it is guarded here rather than trusted. A blank box or a
   zero would put every Send by date on today and quietly turn the column into
   a permanent red panic. */
function setPrimeDays(v){
  const n=parseInt(v);
  if(!(n>0&&n<=PRIME_MAX)){
    toast(`Enter a number between 1 and ${PRIME_MAX} working days`,'er');
    render();return;
  }
  const was=primeDays();
  D.settings.primeDays=n;
  savePrefs();render();
  if(n!==was)logIt('edit',`Prime lead time changed from ${was} to ${n} working days — every Send by date moves`);
  toast(`${n} working days — Send by dates updated`,'ok');
}
function setPref(k,v){
  D.settings[k]=v;savePrefs();
  /* Re-rendering on every keystroke steals the caret, so text fields save quietly. */
  if(typeof v==='string')return;
  render();
}
/* One search box, one place it is handled. These used to be inline handlers
   poking module-scope variables, which silently did nothing from the page. */
function setQ(v){
  Q=(v||'').toLowerCase();
  render();
  const box=document.querySelector('#page-lavarion .srch, .lav3 .srch');
  if(box){box.value=v;box.focus();
    try{box.setSelectionRange(v.length,v.length);}catch(e){}}
  /* jump back to the top so the first match is on screen, not below the fold */
  const sc=document.querySelector('#page-lavarion .wrap, .lav3 .wrap')||document.scrollingElement;
  if(sc&&sc.scrollTop>0)sc.scrollTo({top:0,behavior:'smooth'});
  else window.scrollTo({top:0,behavior:'smooth'});
}
function shipQty(v){SHIP.units=parseInt(v)||0;SHIP.override=false;SHIP.reason='';drawShip();
  const q=document.getElementById('shipQty');if(q){q.focus();try{q.setSelectionRange(q.value.length,q.value.length);}catch(e){}}}
function shipFba(el){SHIP.fba=(el.value||'').toUpperCase();el.value=SHIP.fba;}
/* Settings live in Supabase so everyone sees the same hub — but this used to
   write the WHOLE settings object straight over whatever was there. Two people
   with the page open meant last-save-wins on every setting at once: Becki set a
   supplier's method, Jack changed a column, and one of them silently lost it.
   That is why the two pages drifted apart. Read first, merge, then write — the
   maps (supplier methods, sales figures, aliases) are combined key by key so a
   save can only ever add to what the other person did. */
let _prefsQ=null;
function savePrefs(){
  if(_prefsQ)return _prefsQ;                   // collapse a burst into one round trip
  _prefsQ=(async()=>{
    try{
      let remote={};
      try{const r=await sb.from('app_settings').select('value').eq('key','lavarion_prefs').maybeSingle();
        if(r&&r.data&&r.data.value)remote=JSON.parse(r.data.value)||{};}catch(e){}
      const MAPS=['supplierModes','supplierModesBy','sold30','sold30At','untracked','aliases','modeDays','hubMap','hubSkip','atAmz','atAmzIn','atAmzAt','buySkip','acSnooze','wlAck'];
      const merged={...remote,...D.settings};
      MAPS.forEach(k=>{
        const a=remote[k],b=D.settings[k];
        if(a&&typeof a==='object'&&b&&typeof b==='object')merged[k]={...a,...b};
      });
      D.settings=merged;
      await sb.from('app_settings').upsert({key:'lavarion_prefs',value:JSON.stringify(merged)},{onConflict:'key'})
        .then(r=>{if(r&&r.error)console.warn('prefs save',r.error);});
    }catch(e){console.warn('prefs save',e);}
    finally{_prefsQ=null;}
  })();
  return _prefsQ;
}
/* movement log + "dealt with" ticks — small, so they ride along in app_settings */
let _stateT=null;
function saveState(){clearTimeout(_stateT);_stateT=setTimeout(()=>{
  try{sb.from('app_settings').upsert({key:'lavarion_state',
    value:JSON.stringify({log:D.log.slice(0,300),ack:ACK})},{onConflict:'key'})
    .then(r=>{if(r.error)console.warn('state save',r.error);});}catch(e){}
},1200);}
async function loadState(){
  try{const r=await sb.from('app_settings').select('value').eq('key','lavarion_state').maybeSingle();
    if(r&&r.data&&r.data.value){const v=JSON.parse(r.data.value);
      if(Array.isArray(v.log))D.log=v.log;
      if(v.ack&&typeof v.ack==='object')ACK=v.ack;}}catch(e){}
}
async function loadPrefs(){
  try{const r=await sb.from('app_settings').select('value').eq('key','lavarion_prefs').maybeSingle();
    if(r&&r.data&&r.data.value){const v=JSON.parse(r.data.value);
      D.settings=Object.assign({},D.settings,v);
      D.settings.cols=Object.assign({},{pIncoming:true,pOrdered:false,pSold:true,pCog:true,pSendBy:true,
        cOnOrder:true,cOrdered:true,cUsed:true},v.cols||{});}}catch(e){}
}
function pickKind(k){
  window._ck=k;
  [...document.querySelectorAll('#ckSeg button')].forEach((b,i)=>b.classList.toggle('on',['component','packaging'][i]===k));
  const cat=$('ckCat');if(cat)cat.style.display=k==='packaging'?'none':'';   // packaging just needs a name
  /* packaging never reaches COG, so asking what it cost is a question with no
     consequence — just how many there are */
  const pack=k==='packaging';
  const costWrap=$('c-open-cost-wrap');if(costWrap)costWrap.style.display=pack?'none':'';
  const grid=$('c-open-grid');if(grid)grid.style.gridTemplateColumns=pack?'1fr':'1fr 1fr';
  const hint=$('c-open-hint');
  if(hint)hint.innerHTML=pack
    ? 'Packaging is deducted from stock but never counts toward COG, so there is no price to enter.'
    : 'Every later delivery is added as its own batch at its own price. <b>On hand</b> always shows the total across all batches — order 30, 40, 10 and 20 and it reads 100.';
}
function saveComp(id){
  const name=$('c-name').value.trim();if(!name){toast('Name required','er');return;}
  const untracked=!!($('c-untracked')||{}).checked;
  const obj={name,kind:window._ck||'component',tag:$('c-tag').value,caseQty:parseInt($('c-case').value)||null,untracked};
  const cid=id||newId('c');
  D.settings.untracked=D.settings.untracked||{};
  if(untracked)D.settings.untracked[String(cid)]=true;else delete D.settings.untracked[String(cid)];
  savePrefs();
  let opened=0;
  if(id){Object.assign(comp(id),obj);}
  else{
    const layers=[];
    /* Whatever is on the shelf today becomes batch one, at the price paid for it.
       Every later delivery lands as its own batch — on hand is always the sum. */
    const oq=parseInt(($('c-open-qty')||{}).value)||0;
    const oc=parseFloat(($('c-open-cost')||{}).value)||0;
    if(oq>0){opened=oq;
      layers.push({id:newId('O'),date:localDay(TODAY),qty:oq,rem:oq,cost:oc,
        sup:'Opening stock',oid:'—',loc:'Warehouse',arr:1});}
    D.components.push({id:cid,layers,...obj});
  }
  logIt('edit',(id?'Updated component ':'Added component ')+name+(opened?` — opening stock ${fmt(opened)}`:''));
  cm('lav3Ov2');cm('lav3Ov1');render();
  toast(id?'Component updated':(opened?`Component added — ${fmt(opened)} in stock`:'Component added'),'ok');
}
/* A delete has to actually delete. The bulk prune deliberately refuses to run
   when memory holds fewer rows than the database — that guard is what stops a
   half-loaded page wiping real data, and it is staying. So a deliberate delete
   goes straight at the one row by id, says so out loud, and keeps the loaded
   count honest afterwards so the guard still works. */
async function deleteComponent_db(c){
  if(!c||!c.uuid)return{ok:true,skipped:'never saved'};
  try{
    /* recipe lines pointing at it go first, or they'd be orphans */
    const rr=await sb.from('lavarion_recipes').delete().eq('component_id',c.uuid);
    if(rr.error)console.warn('[lav3] recipe cleanup',rr.error);
    /* its stock batches */
    const lr=await sb.from('lavarion_stock_layers').delete().eq('target_id',String(c.id));
    if(lr.error)console.warn('[lav3] layer cleanup',lr.error);
    const d=await sb.from('lavarion_components').delete().eq('id',c.uuid);
    if(d.error){console.warn('[lav3] component delete',d.error);return{ok:false,err:d.error.message};}
    if(_crLoadedCount>0)_crLoadedCount--;          // keep the prune guard coherent
    if(_layersLoadedCount>0)_layersLoadedCount=Math.max(0,_layersLoadedCount-1);
    return{ok:true};
  }catch(e){console.warn('[lav3] component delete failed',e);return{ok:false,err:e.message};}
}
function delComp(id){
  const c=comp(id),uses=usedIn(id);
  const stock=onHand(c),onOrd=onOrder(c);
  confirmBox('Delete this component for good?',
    `<div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:8px">${esc(c.name)}</div>
     <div style="margin-bottom:10px">This removes it from the database permanently. It will not come back after a refresh.</div>
     <ul style="margin:0 0 10px 16px;padding:0;line-height:1.75">
       ${stock?`<li><b style="color:var(--amb)">${fmt(stock)} in stock</b> will be written off</li>`:''}
       ${onOrd?`<li><b style="color:var(--amb)">${fmt(onOrd)} on order</b> will be forgotten</li>`:''}
       ${uses.length?`<li>Used in <b style="color:var(--red)">${uses.length} product${uses.length===1?'':'s'}</b> — ${uses.map(u=>esc(u.name)).join(', ')} — those recipes lose this line</li>`:'<li>Not used in any product</li>'}
       <li>Its purchase batches and prices are deleted with it</li>
     </ul>
     ${(stock||uses.length)?`<div class="note bad" style="margin:0">If this was a duplicate, deleting is right. If it is a real part you have finished with, <b>Archive</b> keeps the history instead.</div>`:''}`,
    async()=>{
      snap();
      const src=c._src;
      D.products.forEach(p=>p.recipe=p.recipe.filter(r=>r.c!==id));
      D.components=D.components.filter(x=>x.id!==id);
      /* drop it from the arrays the writeback reads, so it can't be resurrected */
      const ci=COMPS.findIndex(x=>String(x.id)===String(id));if(ci>=0)COMPS.splice(ci,1);
      for(let i=LAYERS.length-1;i>=0;i--)if(LAYERS[i].kind==='component'&&String(LAYERS[i].tid)===String(id))LAYERS.splice(i,1);
      Object.keys(RECIPES).forEach(k=>{RECIPES[k]=(RECIPES[k]||[]).filter(r=>String(r.c)!==String(id));});
      logIt('edit','Deleted component '+c.name);
      cm('lav3Ov2');cm('lav3Ov1');render();
      const res=await deleteComponent_db(src&&src.uuid?src:{uuid:(src||{}).uuid,id});
      if(res.ok)toast(`"${c.name}" deleted permanently`,'ok');
      else toast('Deleted here, but the database refused — it may come back on refresh','er');
      saveCompsRecipes();
    },{danger:true,ok:'Delete permanently'});
}

/* ── receive a delivery / correct stock ── */
/* Receiving one line, straight from the table. The modal was the only way to
   take a part delivery, which meant opening a dialog to change one number. */
/* Booking stock in is the one action nobody can check afterwards — the order
   leaves the list either way, and a wrong count only surfaces weeks later when
   the shelf does not match. The button used to take whatever number happened to
   be pre-filled and commit it: one click, row gone, nothing asked. So it asks
   first, states what it is about to record, and says what happens to anything
   missing BEFORE it is recorded. */
let _rcvCtx=null,_rcvThat=false;
/* A component's id can be swapped underneath us — a temp id becomes the real
   uuid the moment the row reaches the database. The popup captured the id it
   was opened with, so pressing "Book it in" a few seconds later looked up a
   component that no longer existed and did NOTHING: modal closed, no stock
   booked, no error, and the preview left saying "nothing to chase" about a
   delivery that was never recorded. Layer ids never move, so find the layer
   first and take its owner from that. */
function findLayer(kind,oid,lid){
  const direct=kind==='component'?comp(oid):(kind==='product'?prod(oid):(comp(oid)||prod(oid)));
  if(direct){const l=(direct.layers||[]).find(x=>String(x.id)===String(lid));
    if(l)return{o:direct,l,kind:direct.recipe?'product':'component'};}
  let hit=null;
  D.components.forEach(o=>(o.layers||[]).forEach(l=>{if(!hit&&String(l.id)===String(lid))hit={o,l,kind:'component'};}));
  if(!hit)D.products.forEach(o=>(o.layers||[]).forEach(l=>{if(!hit&&String(l.id)===String(lid))hit={o,l,kind:'product'};}));
  return hit;
}
/* Jack, 8 Sep (Sarah: "I'm just checking the item and it turned to landed"):
   Lavarion stock is checked in by the UK team. Sarah is stopped with a
   Cancel / Proceed box on every receive or arrived button; Jack and Becki
   are not. A deliberate Proceed still works — it is a stop, not a lock. */
let _lavGateOk=false;
function _lavIsSarah(){return /^sarah/i.test(String(window.currentUserName||'').trim());}
function lavGate(retry){
  if(!_lavIsSarah())return false;
  if(_lavGateOk){_lavGateOk=false;return false;}
  confirmBox('Checking stock in is the UK team\u2019s job',
    `<div style="margin-bottom:10px">Receiving and marking arrived on the Lavarion page is Becki\u2019s. A press here moves real stock on the bench.</div>
     <div class="pmeta" style="margin:0">If you are doing it on purpose, carry on \u2014 it is logged under your name.</div>`,
    ()=>{_lavGateOk=true;try{retry();}finally{_lavGateOk=false;}},
    {danger:true,ok:'Proceed anyway'});
  return true;
}
function openReceive(kind,oid,lid){
  if(lavGate(()=>openReceive(kind,oid,lid)))return;
  const found=findLayer(kind,oid,lid);
  if(!found){toast('That order is no longer on the list — refresh and try again','er');return;}
  const o=found.o,l=found.l;kind=found.kind;oid=o.id;
  const ordered=ordQty(l),already=rcvdQty(l),outstanding=outQty(l);
  const inp=document.getElementById('rcv-'+lid);
  const pre=Math.max(0,parseInt(inp?inp.value:outstanding)||outstanding);
  _rcvCtx={kind,oid,lid};_rcvThat=false;
  const eta=l.eta1?dshort(l.eta1)+((l.eta2&&l.eta2!==l.eta1)?' – '+dshort(l.eta2):''):'—';
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>${esc(o.name)}</h3>
      <span class="pmeta" style="margin:0">${esc(l.sup||'no supplier')}${(l.oid&&l.oid!=='—')?' · '+esc(l.oid):''} · ordered ${dshort(l.date)}</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      ${/* Outstanding is always on screen. It is the one number that decides
            whether this order is finished, and it used to be worked out in
            somebody's head from two others. */''}
      <div class="rcvFacts">
        <div><i>Ordered</i><b>${fmt(ordered)}</b></div>
        <div><i>Received so far</i><b ${already?'style="color:var(--grn)"':''}>${fmt(already)}</b></div>
        <div><i>Outstanding</i><b ${outstanding?'style="color:var(--amb)"':''}>${fmt(outstanding)}</b></div>
        <div><i>Unit cost</i><b>${l.cost>0?gbp(l.cost):'—'}</b></div>
        <div><i>Expected</i><b>${esc(eta)}</b></div>
      </div>
      ${(l.rcpts&&l.rcpts.length)?`<div class="rcvHist">
        <b>Already counted in on this order</b>
        ${l.rcpts.map(r=>`<div class="rcvHistRow"><span class="num">${fmt(r.got)}</span>
          <span>${dshort(r.on)}${r.by?' · '+esc(r.by):''}${r.dmg?` · <b style="color:var(--red)">${fmt(r.dmg)} damaged</b>`:''}</span></div>`).join('')}
      </div>`:''}

      <div class="rcvAsk">
        <label for="rcvGot">How many actually arrived?</label>
        <div class="rcvStep">
          <button class="rcvPm" onclick="LV3.rcvBump(-1)" title="One less">&minus;</button>
          <input class="in num" id="rcvGot" type="number" min="0" value="${pre}"
            oninput="LV3.rcvPreview()" onkeydown="if(event.key==='Enter'){event.preventDefault();LV3.rcvConfirm();}">
          <button class="rcvPm" onclick="LV3.rcvBump(1)" title="One more">+</button>
          <button class="rcvAll" onclick="LV3.rcvSet(${outstanding})" title="Everything still owed turned up">All ${fmt(outstanding)}</button>
          <button class="rcvAll" onclick="LV3.rcvSet(0)" title="Nothing turned up">None</button>
        </div>
        <div class="rcvTip">Count everything that came out of the box — damaged included.</div>
        <div class="rcvDmg">
          <button type="button" id="rcvDmgLink" onclick="LV3.rcvShowDmg()">Any of them damaged?</button>
          <div id="rcvDmgBox" style="display:none;">
            <label for="rcvDmg">How many are damaged?</label>
            <div class="rcvStep">
              <button class="rcvPm" onclick="LV3.rcvDmgBump(-1)" title="One less">&minus;</button>
              <input class="in num" id="rcvDmg" type="number" min="0" value="${parseInt(l.dmg)||0}" oninput="LV3.rcvPreview()">
              <button class="rcvPm" onclick="LV3.rcvDmgBump(1)" title="One more">+</button>
            </div>
            <div class="rcvTip">They arrived, so there is nothing to chase the courier for — but they never go into stock.</div>
          </div>
        </div>
      </div>

      <div id="rcvSay"></div>

      ${/* Only shown when the count is under what is owed, so it means something
            every single time it is on screen. Nothing else in the app can know
            the boxes have stopped coming. */''}
      <div class="rcvThat" id="rcvThatBox" style="display:none">
        <button type="button" class="rcvThatBtn" id="rcvThatBtn" onclick="LV3.rcvThatsIt()">
          <span class="rcvThatTick">&#10003;</span>
          <span class="rcvThatTxt"><b>THAT'S IT</b><i id="rcvThatSub">nothing else is coming for this order</i></span>
        </button>
      </div>

      <div class="rcvNote">
        <label for="rcvNote">Anything worth noting? <span>optional — damage, wrong item, why it was short, who dropped it off</span></label>
        <textarea id="rcvNote" rows="2" placeholder="e.g. 2 boxes crushed, driver left them next door">${esc(l.note||'')}</textarea>
      </div>
    </div>
    <div class="mf"><span class="pmeta" style="margin:0">Nothing is booked in until you press the button.</span>
      <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
        <button class="btn pri" id="rcvGo" onclick="LV3.rcvConfirm()">Book it in</button></div></div>`;
  om('lav3Ov2');
  rcvPreview();
  setTimeout(()=>{const e=document.getElementById('rcvGot');if(e){e.focus();e.select();}},60);
}
function rcvSet(n){const e=document.getElementById('rcvGot');if(!e)return;e.value=Math.max(0,n);rcvPreview();e.focus();e.select();}
/* Damage is the exception, so it costs one click and never sits there as a
   field somebody has to zero out. */
function rcvShowDmg(){
  const b=document.getElementById('rcvDmgBox'),k=document.getElementById('rcvDmgLink');
  if(!b)return;
  b.style.display='block'; if(k)k.style.display='none';
  const e=document.getElementById('rcvDmg'); if(e){e.focus();e.select();}
  rcvPreview();
}
function rcvDmgBump(d){const e=document.getElementById('rcvDmg');if(!e)return;
  e.value=Math.max(0,(parseInt(e.value)||0)+d);rcvPreview();}
function _rcvDmgVal(){
  const b=document.getElementById('rcvDmgBox');
  if(!b||b.style.display==='none')return 0;
  return Math.max(0,parseInt((document.getElementById('rcvDmg')||{}).value)||0);
}
function rcvBump(d){const e=document.getElementById('rcvGot');if(!e)return;
  e.value=Math.max(0,(parseInt(e.value)||0)+d);rcvPreview();}
/* Nobody else can know. Pressing it declares the delivery finished and turns
   whatever is left into a shortfall — reversible, because a late box is far
   more likely than a misclick worth protecting against. */
function rcvThatsIt(){
  _rcvThat=!_rcvThat;
  const b=document.getElementById('rcvThatBtn');
  if(b)b.classList.toggle('on',_rcvThat);
  rcvPreview();
}
/* say what the number means before it is committed, not after */
function rcvPreview(){
  if(!_rcvCtx)return;
  const found=findLayer(_rcvCtx.kind,_rcvCtx.oid,_rcvCtx.lid);
  /* Leaving the previous preview on screen is worse than saying nothing — it
     was still reading "nothing to chase" for a delivery that could not be
     recorded at all. */
  if(!found){
    const box=document.getElementById('rcvSay');
    if(box)box.innerHTML='<div class="note bad" style="margin:11px 0 0"><b>This order has moved.</b> Close this and open it again from the list — nothing has been booked in.</div>';
    const go=document.getElementById('rcvGo');if(go){go.disabled=true;go.style.opacity='.45';}
    return;
  }
  const o=found.o,l=found.l;
  _rcvCtx.oid=o.id;_rcvCtx.kind=found.kind;   // keep the handle fresh
  const out=outQty(l),ord=ordQty(l),before=rcvdQty(l);
  const got=Math.max(0,parseInt((document.getElementById('rcvGot')||{}).value)||0);
  const box=document.getElementById('rcvSay');if(!box)return;
  const go=document.getElementById('rcvGo');
  const dmg=Math.min(got,_rcvDmgVal());
  const usable=got-dmg;
  /* got===0 used to disable the button AND hide the declaration below, so a
     delivery where NOTHING turned up could not be recorded at all — the "None"
     button led to a dead end and the only writable field left was the free-text
     note. That is why two of the open notes read "Missing - images sent to
     Sarah": it was the only thing the app allowed. Zero is now a real answer,
     as long as the person holding the boxes says the delivery is finished. */
  if(go){const bad=(got<1&&!_rcvThat)||dmg>got;go.disabled=bad;go.style.opacity=bad?'.45':'1';
    go.textContent=(got<1&&_rcvThat)?'Nothing arrived \u2014 raise it as short'
                  :(got<out&&_rcvThat)?'Book it in and close the order':'Book it in';}
  /* the declaration only exists when there is something left to declare */
  const tb=document.getElementById('rcvThatBox'),sub=document.getElementById('rcvThatSub');
  if(tb){
    const shows=got<out;   // including zero — see the note above
    tb.style.display=shows?'block':'none';
    if(!shows&&_rcvThat){_rcvThat=false;
      const b=document.getElementById('rcvThatBtn');if(b)b.classList.remove('on');}
    if(shows&&sub)sub.textContent=_rcvThat
      ? `${fmt(out-got)} will be raised as short with Sarah`
      : `nothing else is coming — the other ${fmt(out-got)} are not on their way`;
  }
  if(got<1){box.innerHTML='<div class="note" style="margin:11px 0 0">Type how many came out of the box.</div>';return;}
  /* Damaged units arrived — so there is nothing outstanding for them — but they
     never become stock. Say all three numbers rather than leaving it implied. */
  const dmgLine=dmg>0
    ? `<div class="rcvSplit"><span><b>${fmt(got)}</b> arrived</span>
        <span class="ok"><b>${fmt(usable)}</b> into stock</span>
        <span class="bad"><b>${fmt(dmg)}</b> damaged${l.cost>0?` · ${gbp(dmg*l.cost)}`:''}</span></div>`
    : '';
  /* Running total, always. "78 of 100 · 22 outstanding" is the sentence that
     decides whether the order is finished, so it is never left to be worked out. */
  const tally=`<div class="rcvTally"><span>${fmt(before+got)} of ${fmt(ord)} counted in</span>
    <b style="color:${Math.max(0,ord-before-got)?'var(--amb)':'var(--grn)'}">${fmt(Math.max(0,ord-before-got))} outstanding</b></div>`;
  if(got===out){
    box.innerHTML=dmgLine+tally+(dmg>0
      ? `<div class="note warn" style="margin:11px 0 0"><b>Nothing outstanding — but ${fmt(dmg)} cannot be used.</b>
         Everything owed turned up, so there is nothing to chase for. The ${fmt(dmg)} damaged
         go to Sarah to get the money back or arrange a return.</div>`
      : `<div class="note good" style="margin:11px 0 0"><b>Nothing to chase.</b>
         That is the whole order accounted for — ${fmt(usable)} into stock and it comes off the list.</div>`);
  }else if(got<out){
    const left=out-got;
    box.innerHTML=dmgLine+tally+(_rcvThat
      ? `<div class="note bad" style="margin:11px 0 0">
          <b>Delivery finished ${fmt(left)} short.</b>
          ${fmt(usable)} go into stock. The ${fmt(left)} missing${l.cost>0?` — ${gbp(left*l.cost)}`:''} go to Sarah to
          get the money back or a replacement sent, and stay owed until one of those happens.${
            dmg>0?` The ${fmt(dmg)} damaged go on the same conversation.`:''}</div>`
      : `<div class="note info" style="margin:11px 0 0">
          <b>${fmt(left)} still expected.</b>
          ${fmt(usable)} go into stock now and the order stays open — nothing is written off and nobody is chased yet.
          <br>If the delivery is <b>finished</b> and the rest is not coming, press <b>THAT'S IT</b> above.${
            dmg>0?`<br>The ${fmt(dmg)} damaged go to Sarah either way.`:''}</div>`);
  }else{
    const over=got-out;
    box.innerHTML=dmgLine+`<div class="note warn" style="margin:11px 0 0"><b>Check the invoice — ${fmt(over)} more than owed.</b>
      All ${fmt(got)} go into stock and the extra is noted on the batch, so the COG is right either way.</div>`;
  }
}
function rcvConfirm(){
  if(!_rcvCtx)return;
  /* Check the row is still findable BEFORE closing anything. This used to shut
     the popup and call a function that quietly returned. */
  const found=findLayer(_rcvCtx.kind,_rcvCtx.oid,_rcvCtx.lid);
  if(!found){toast('That order has moved — close this and open it again. Nothing was booked in.','er');return;}
  _rcvCtx.oid=found.o.id;_rcvCtx.kind=found.kind;
  const got=Math.max(0,parseInt((document.getElementById('rcvGot')||{}).value)||0);
  const note=((document.getElementById('rcvNote')||{}).value||'').trim();
  const dmg=Math.min(got,_rcvDmgVal());
  const that=_rcvThat;
  /* NOTHING ARRIVED. Not a receipt — there is no box, no batch and no stock to
     book in — so this does not go through receiveRow at all. It is exactly the
     declaration the THAT'S IT button already makes, applied to the whole
     outstanding quantity, through the same declareShort the partial case uses.
     From here the existing machinery takes over untouched: the line joins
     shortLines(), joins supplierIssues(), and starts a chase. */
  if(got<1){
    if(!that){toast('Enter how many arrived \u2014 or press None, then tick that the delivery is finished','er');return;}
    const o=found.o,l=found.l;
    const who=(window.currentUserName||'someone');
    const landed=dayISO();
    _rcvCtx=null;_rcvThat=false;
    cm('lav3Ov2');
    snap();
    const n=declareShort(l,who,landed);
    if(note){l.note=note;l.noteOpen=1;l.noteBy=who;l.noteOn=landed;}
    logIt('recv',`Nothing arrived \u2014 ${fmt(n)} \u00d7 ${o.name} raised as SHORT from ${l.sup||'supplier'}`);
    save();render();
    toastUndo(`Nothing arrived \u00b7 ${fmt(n)} short \u2014 raised with Sarah`,'er');
    return;
  }
  const c=_rcvCtx;_rcvCtx=null;_rcvThat=false;
  cm('lav3Ov2');
  receiveRow(c.kind,c.oid,c.lid,got,note,dmg,that);
}
/* A receipt, not THE receipt. Whatever turns up is recorded against the order
   and the order works out what is left. Only the person holding the boxes can
   say the delivery has finished — thatsIt is that sentence, and nothing else
   in the app is allowed to assume it. */
function receiveRow(kind,oid,lid,qtyIn,noteIn,dmgIn,thatsIt,opts){
  opts=opts||{};
  /* Booking stock in is the one action nobody can check afterwards, so it is
     the last place that should ever fail without saying so. */
  const found=findLayer(kind,oid,lid);
  if(!found){toast('Could not find that order — nothing has been booked in','er');return;}
  const o=found.o,l=found.l;
  const who=(window.currentUserName||'someone');
  const landed=opts.landed||dayISO();
  const quiet=!!opts.quiet;                 // one snap/save/render for the whole batch
  const say=(msg,tone)=>{if(!quiet)toastUndo(msg,tone);};   // `kind` is taken
  const ordered=ordQty(l), before=rcvdQty(l), outstanding=Math.max(0,ordered-before);
  const first=!(l.rcpts&&l.rcpts.length);
  const inp=document.getElementById('rcv-'+lid);
  const got=(qtyIn!=null)?Math.max(0,parseInt(qtyIn)||0)
    :Math.max(0,parseInt(inp?inp.value:outstanding)||0);
  if(got<1){toast('Enter how many arrived','er');return;}
  const dmg=Math.max(0,Math.min(got,parseInt(dmgIn)||0));
  const usable=got-dmg;
  if(!quiet)snap();
  /* whatever was written on the way in stays with the batch — note is a real
     column on lavarion_stock_layers, so it survives a refresh */
  const noteTxt=(noteIn!=null)?noteIn:null;
  const stamp=layer=>{
    if(noteTxt==null)return;
    layer.note=noteTxt;
    /* Written at the moment of counting in, so it is always about something
       that happened to this delivery. It stays flagged until it is cleared. */
    if(noteTxt){layer.noteOpen=1;layer.noteBy=who;layer.noteOn=landed;}
    else{delete layer.noteOpen;delete layer.noteBy;delete layer.noteOn;}
  };
  l.ord=ordered;
  l.rcvd=before+got;
  (l.rcpts=l.rcpts||[]).push({on:landed,by:who,got,dmg,note:noteTxt||''});
  const left=Math.max(0,ordered-l.rcvd);

  if(first&&got>=outstanding){
    /* The 95% case: it all came, first time. The order simply becomes the batch,
       exactly as before — no shell row, nothing extra in the database. */
    const over=got-ordered;
    stamp(l);
    /* qty is what arrived; rem is what can actually be sold. Damaged units are
       received — nothing to chase the courier for — but they never become
       sellable stock, so they are recorded and held back. */
    l.arr=1;l.rem=usable;l.qty=got;l.recvOn=landed;l.recvBy=who;
    if(dmg){l.dmg=(l.dmg||0)+dmg;l.dmgOn=landed;l.dmgBy=who;}
    if(over)l.note=((l.note?l.note+' · ':'')+`${over} more than ordered`);
    logIt('recv',`Received ${fmt(got)} × ${o.name}${l.cost>0?' @ '+gbp(l.cost):''}${l.sup?' — '+l.sup:''} · ${who}${over?` · ${over} over`:''}${dmg?` · ${dmg} DAMAGED, held out of stock`:''}`);
    say(`${fmt(got)} × ${o.name} received${dmg?` · ${fmt(dmg)} damaged, ${fmt(usable)} into stock`:''}${over?` · ${fmt(over)} more than ordered`:''}`,dmg?'er':'ok');
  }else{
    /* Every later box gets its own batch — its own arrival date, its own damage,
       its own note — and the order keeps the running total. */
    const batch={id:newId('R'),date:l.date,qty:got,rem:usable,cost:l.cost,
      sup:l.sup,oid:l.oid,loc:l.loc,arr:1,src:l.src||'',note:l.note||'',mode:l.mode,
      recvOn:landed,recvBy:who,ofOrd:l.id,...(dmg?{dmg,dmgOn:landed,dmgBy:who}:{})};
    stamp(batch);
    (o.layers=o.layers||[]).push(batch);
    l.qty=left;                              // what is still owed on this order
    /* Some of a declared shortfall turning up makes it smaller, not stale.
       Leaving shortQty alone had the history and the write-off dialog quoting
       the original number long after half of it had arrived. */
    if(l.short&&left>0){l.shortQty=left;}
    if(l.repl&&l.repl.qty)l.repl.qty=Math.max(0,l.repl.qty-got);
    if(l.repl&&!l.repl.qty)delete l.repl;
    if(left<=0){
      /* Everything is accounted for. The order stops being an order — no recvOn,
         so it never shows up as a delivery of its own. */
      l.arr=1;l.rem=0;l.qty=0;l.closed=landed;
      delete l.short;delete l.shortQty;delete l.chased;delete l.replyBy;delete l.repl;
      logIt('recv',`Received ${fmt(got)} × ${o.name} — order complete, ${fmt(l.rcvd)} of ${fmt(ordered)} in${dmg?` · ${dmg} DAMAGED, held out of stock`:''}`);
      say(`${fmt(got)} in · order complete at ${fmt(l.rcvd)} of ${fmt(ordered)}`,dmg?'er':'ok');
    }else if(thatsIt){
      declareShort(l,who,landed);
      logIt('recv',`Received ${fmt(got)} × ${o.name} — delivery finished ${fmt(left)} SHORT from ${l.sup||'supplier'}${dmg?` · ${dmg} DAMAGED`:''}`);
      say(`${fmt(got)} in · ${fmt(left)} short — raised with Sarah`,'er');
    }else{
      logIt('recv',`Received ${fmt(got)} × ${o.name} — ${fmt(l.rcvd)} of ${fmt(ordered)} in, ${fmt(left)} still expected${dmg?` · ${dmg} DAMAGED`:''}`);
      say(`${fmt(got)} in · ${fmt(left)} still expected on this order`,'ok');
    }
  }
  if(!quiet){save();render();}
  return{got,dmg,left,closed:left<=0,short:!!l.short};
}
function markArrived(kind,oid,lid){
  if(lavGate(()=>markArrived(kind,oid,lid)))return;
  const o=kind==='component'?comp(oid):prod(oid);
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  snap();
  /* Keep the running total honest — otherwise an order part-received earlier
     ends up marked arrived while `rcvd` still says 30 of 44, and the receipt
     history stops adding up. */
  l.ord=ordQty(l);l.rcvd=(l.rcvd||0)+l.qty;
  l.arr=1;l.rem=l.qty;
  logIt('recv',`Received ${fmt(l.qty)} × ${o.name} @ ${gbp(l.cost)} — ${l.sup}`);
  save();                                     // a receive must reach the database, not just the screen
  /* a delivery arriving marks its sheet row arrived, and releases every other
     destination that same purchase was split across */
  const ps=D.purchases.find(x=>x.oid===l.oid&&allocOf(x).some(a=>a.to===oid));
  if(ps&&!ps.arr){ps.arr=1;
    D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(x=>{
      if(x.src==='P:'+ps.id&&!x.arr){x.ord=ordQty(x);x.rcvd=(x.rcvd||0)+x.qty;x.arr=1;x.rem=x.qty;}}));}
  render();if($('lav3Ov1').classList.contains('on')){kind==='component'?openComp(oid):openProduct(oid);}
  toastUndo(`${fmt(l.qty)} × ${o.name} received into stock`,'ok');
}
/* ── ADD A BATCH ──────────────────────────────────────────────────────────
   Backstock that is already on the shelf at a price of its own. Correcting the
   count would fold it into an existing batch at the wrong cost, and logging a
   delivery would say it is still coming — neither is true. This puts the units
   straight in as their own priced batch, which is what FIFO needs. */
function openAddBatch(oid,kind){
  kind=kind||'component';
  const o=kind==='component'?comp(oid):prod(oid);
  if(!o)return;
  const ls=arrLayers(o).filter(l=>l.rem>0);
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Add a batch — ${esc(o.name)}</h3>
    <span class="pmeta" style="margin:0">stock already here, at its own price</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    <div class="note info" style="margin-bottom:12px">Use this for backstock you already hold that was bought at a
      different price. It goes straight in as usable stock — nothing to receive.<br>
      Still on its way? Use <b>+ Order</b> instead. Miscount on an existing batch? Use <b>Correct stock</b>.</div>
    ${ls.length?`<div class="lab" style="margin-bottom:5px">Batches it already has</div>
      <table class="ltab" style="margin-bottom:13px"><thead><tr><th>Bought</th><th>Supplier</th><th>Left</th><th>Unit</th></tr></thead><tbody>
      ${ls.map(l=>`<tr><td>${dshort(l.date)}</td><td>${esc(l.sup||'—')}</td><td>${fmt(l.rem)}</td><td>${l.cost>0?gbp(l.cost):'<span class="dim">no price</span>'}</td></tr>`).join('')}
      </tbody></table>`:''}
    <div class="${o.kind==='packaging'?'frow':'g2 frow'}">
      <div><span class="lab">How many</span><input class="in num" id="ab-qty" type="number" min="1" placeholder="10" style="font-size:17px;text-align:center"></div>
      ${o.kind==='packaging'?'':`<div><span class="lab">What they cost each <span style="text-transform:none;font-weight:600">(inc VAT)</span></span>
        <input class="in num" id="ab-cost" type="number" step="0.01" min="0" placeholder="0.00" style="font-size:17px;text-align:center"></div>`}
    </div>
    <div class="g2 frow">
      <div><span class="lab">Supplier</span><input class="in" id="ab-sup" placeholder="Superdrug, Alibaba…"></div>
      <div><span class="lab">Order ref <span style="text-transform:none;font-weight:600">(optional)</span></span><input class="in" id="ab-ref" placeholder="PO-104"></div>
    </div>
    <div class="g2 frow">
      <div><span class="lab">When it was bought</span><input class="in" id="ab-date" type="date" value="${dayISO()}" max="${dayISO()}">
        <div class="pmeta" style="margin-top:4px">Oldest stock goes out first, so this decides where it sits in the queue.</div></div>
      <div><span class="lab">Where it is</span>
        <select class="in" id="ab-loc">${(D.settings.locations||'Warehouse').split(',').map(l=>`<option>${esc(l.trim())}</option>`).join('')}</select></div>
    </div>
    <div class="frow"><span class="lab">Note <span style="text-transform:none;font-weight:600">(optional)</span></span>
      <input class="in" id="ab-note" placeholder="e.g. found in the back, older stock"></div>
    <div id="ab-preview" class="note" style="margin:0"></div>
  </div>
  <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.doAddBatch('${oid}','${kind}')">Add the batch</button></div></div>`;
  om('lav3Ov2');
  ['ab-qty','ab-cost','ab-date'].forEach(id=>{const el=$(id);if(el)el.oninput=()=>abPreview(oid,kind);});
  abPreview(oid,kind);
  setTimeout(()=>{const q=$('ab-qty');if(q)q.focus();},60);
}
function abPreview(oid,kind){
  const o=(kind==='component'?comp(oid):prod(oid));if(!o)return;
  const box=$('ab-preview');if(!box)return;
  const q=parseInt(($('ab-qty')||{}).value)||0;
  const c=parseFloat(($('ab-cost')||{}).value)||0;
  const d=($('ab-date')||{}).value||dayISO();
  if(!q){box.innerHTML='<span class="pmeta" style="margin:0">Enter how many and it will show what changes.</span>';return;}
  const now=onHand(o);
  const older=arrLayers(o).filter(l=>l.rem>0&&l.date<d).length;
  box.innerHTML=`On hand goes from <b>${fmt(now)}</b> to <b style="color:var(--grn)">${fmt(now+q)}</b>${c?` · this batch is worth <b>${gbp(q*c)}</b>`:''}.
    ${older?`It sits <b>behind ${fmt(older)}</b> older batch${older===1?'':'es'} in the queue.`
      :'<b>It is the oldest batch</b>, so it goes out first.'}
    ${(!c&&o.kind!=='packaging')?'<br><span style="color:var(--amb)">No price — it will not count toward COG until you set one.</span>':''}`;
}
function doAddBatch(oid,kind){
  const o=(kind==='component'?comp(oid):prod(oid));if(!o)return;
  const qty=parseInt(($('ab-qty')||{}).value)||0;
  if(qty<1){toast('Enter how many','er');const q=$('ab-qty');if(q)q.focus();return;}
  const cost=parseFloat(($('ab-cost')||{}).value)||0;
  const date=($('ab-date')||{}).value||dayISO();
  const sup=(($('ab-sup')||{}).value||'').trim()||'Backstock';
  const ref=(($('ab-ref')||{}).value||'').trim()||'—';
  const loc=($('ab-loc')||{}).value||'Warehouse';
  const note=(($('ab-note')||{}).value||'').trim();
  snap();
  (o.layers=o.layers||[]).push({id:newId('B'),date,qty,rem:qty,cost,sup,oid:ref,loc,arr:1,
    src:'backstock',note:note||(cost>0?'':'price missing'),
    recvOn:dayISO(),recvBy:(window.currentUserName||'someone')});
  logIt('recv',`Batch added: ${fmt(qty)} × ${o.name}${cost>0?' @ '+gbp(cost):' (no price)'} — ${sup}${note?' · '+note:''}`);
  save();cm('lav3Ov2');render();
  if($('lav3Ov1').classList.contains('on')){kind==='component'?openComp(oid):openProduct(oid);}
  toastUndo(`${fmt(qty)} added${cost>0?` at ${gbp(cost)}`:''} — now ${fmt(onHand(o))} on hand`,'ok');
}
function openAdjust(kind,oid){
  const o=kind==='component'?comp(oid):prod(oid);
  $('lav3Mod2').className='mod slim';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Correct stock — ${esc(o.name)}</h3><button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    <div class="note" style="margin-bottom:12px">Only use this when a physical count disagrees with the system — a supplier overshipped, breakages, or a purchase never made it onto the sheet. Every correction is logged with your reason.</div>
    <div class="g2 frow">
      <div class="stat"><div class="k">System says</div><div class="v">${fmt(onHand(o))}</div></div>
      <div><span class="lab">Actual counted</span><input class="in mono" id="adj-n" type="number" value="${onHand(o)}" style="font-size:17px;text-align:center"></div></div>
    <div class="frow"><span class="lab">Reason</span>
      <select class="in" id="adj-r"><option>Physical count differs</option><option>Supplier overshipped</option>
      <option>Damaged / written off</option><option>Purchase missing from sheet</option><option>Other</option></select></div>
    <div class="frow"><span class="lab">Note <span style="text-transform:none;font-weight:600">(optional)</span></span><input class="in" id="adj-note" placeholder="e.g. counted 300, box said 280"></div>
  </div>
  <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.doAdjust('${kind}','${oid}')">Save correction</button></div></div>`;
  om('lav3Ov2');
}
function doAdjust(kind,oid){
  const o=kind==='component'?comp(oid):prod(oid);
  const want=parseInt($('adj-n').value);if(isNaN(want)||want<0){toast('Enter a number','er');return;}
  const have=onHand(o),diff=want-have;
  if(!diff){cm('lav3Ov2');toast('No change');return;}
  snap();
  if(diff>0){
    /* extra units join as a new batch at the newest known cost, dated today */
    const cost=avgCost(o)||0;
    (o.layers=o.layers||[]).push({id:newId('A'),date:localDay(TODAY),qty:diff,rem:diff,cost,
      sup:'Stock correction',oid:'—',loc:'Warehouse',arr:1});
  }else{
    let need=-diff;
    for(const l of arrLayers(o)){if(need<=0)break;const t=Math.min(l.rem,need);l.rem-=t;need-=t;}
  }
  logIt('adj',`Stock corrected: ${o.name} ${fmt(have)} → ${fmt(want)} (${diff>0?'+':''}${diff}) — ${$('adj-r').value}${$('adj-note').value?': '+$('adj-note').value:''}`);
  cm('lav3Ov2');render();
  if($('lav3Ov1').classList.contains('on')){kind==='component'?openComp(oid):openProduct(oid);}
  toastUndo(`${o.name} corrected to ${fmt(want)}`,'ok');
}

/* ═══════════════ PURCHASES (sheet feed) ═══════════════
   A purchase row is never linked automatically. You allocate its units —
   possibly split across several components or products, possibly only
   partly — and can change that at any time. Suggestions are offered,
   never applied. */
const allocOf=p=>Array.isArray(p.alloc)?p.alloc:(p.link?[{to:p.link,qty:p.qty}]:[]);
const allocated=p=>allocOf(p).reduce((s,a)=>s+(parseInt(a.qty)||0),0);
const unalloc=p=>Math.max(0,p.qty-allocated(p));
/* ═══════════════ THE PURCHASE SHEET ═══════════════
   spend.dash reads the Lavarion Q1–Q4 tabs straight from Google with the Sheets
   API. Rather than have two apps talk to each other, this reads exactly the same
   tabs the same way — one less moving part, and it still works if spend.dash is
   never opened.

   Importing a row NEVER creates stock. Every row lands in a review queue and a
   person links it to a component or product; only then does it become a priced
   batch. That is why the whole sheet can be pulled in safely — years of history
   included — without inventing stock that was built and sent months ago. */
let _syncing=false,_syncMsg='',_purchAll=false;
function togglePurchAll(){_purchAll=!_purchAll;render();}
/* The purchase sheet's address deliberately does NOT live in this file. The
   app is served from public GitHub Pages, so anything written here can be read
   by anyone with View Source — no login needed. The address lives in
   app_settings (lavarion_prefs.lavSheet), which only a signed-in user can
   read. Paste it once in Lavarion → Settings → Purchase sheet. */
const LAV_TABS=['Lavarion Q1','Lavarion Q2','Lavarion Q3','Lavarion Q4'];

/* Reading the purchase sheet goes through the sheet-sync Edge Function this app
   already uses for the OA sheet: Supabase fetches Google server-side and hands
   back CSV. No key sits in this page, nothing here can write to the sheet, and
   spend.dash is not involved at all. */
function lavSheetId(){
  const u=(D.settings.lavSheet||'').trim();
  if(!u)return '';
  const m=String(u).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m?m[1]:String(u).trim();
}
function sheetNum(v){const x=parseFloat(String(v==null?'':v).replace(/[£,\s]/g,''));return isNaN(x)?0:x;}
function parseSheetRows(rows,tab){
  const out=[];
  (rows||[]).forEach(raw=>{
    const r={};Object.keys(raw).forEach(k=>{r[k.trim().toLowerCase()]=raw[k];});
    const get=k=>(r[k]==null?'':String(r[k])).trim();
    const ds=get('date');if(!ds)return;
    /* build the ISO date from the parts — toISOString() shifts to UTC and in
       British Summer Time that moved 02/08 back to the 1st */
    let iso='';const p=ds.split('/');
    if(p.length===3&&p[0].length<=2){
      const dd=+p[0],mm=+p[1];let yy=+p[2];
      if(!dd||!mm||!yy)return;
      /* "29/07/28" is a two-digit year, not the year 28. Left as-is it sorted
         after 2026 and slipped straight past the import cut-off. */
      if(yy<100)yy+=2000;
      iso=`${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }else{const d=new Date(ds);if(isNaN(d))return;
      iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
    const name=get('name').replace(/\s+/g,' ').trim();if(!name)return;
    const qty=Math.round(sheetNum(get('quanity bought')||get('quantity bought')||get('qty')))||0;
    let price=sheetNum(get('buy price'));
    let spend=sheetNum(get('spent'));
    if(!price&&qty&&spend)price=spend/qty;
    if(!spend)spend=price*qty;
    if(spend<=0)return;
    out.push({tab,date:iso,name,qty,price:price||0,spend,
      /* the sheet rounds to whole figures deliberately, so Spent differing from
         price × qty is expected — Spent is what actually left the account */
      mismatch:0,
      sup:get('bought from')||'—',oid:get('order id')||'—',
      acct:get('account')||'',invoice:get('link to invoice')||'',notes:get('notes')||''});
  });
  return out;
}
/* the review list starts folded — see reviewPanel */
let _revOpen=false;
function revToggle(){_revOpen=!_revOpen;render();}
const purchKey=r=>[r.date,(r.oid||'—').toLowerCase(),r.name.toLowerCase(),r.qty].join('|');
/* ── LINES A HUMAN HAS ALREADY RULED ON ───────────────────────────────────
   Becki, 20 Aug: "past couple of times i have refreshed app and then synced
   purchase sheet ... both of these keep coming up despite being cleared".

   She was right and the loop was unwinnable. dropReview forgets the row and
   deletes it — its own comment admits the rest: "syncing again fetches it
   afresh". The sheet still holds the line, so the next sync re-imports it, it
   lands back in To review, she clears it, and round it goes. Nothing recorded
   that a person had already looked at that line and said no.

   The prep sheet solved exactly this with a persistent exclusion list; the
   Lavarion purchase sync never had one. This is that list, keyed on the same
   purchKey the sync matches with, riding in prefs so it survives a refresh.
   Nothing is hidden silently — the page says how many lines are being ignored
   and any of them can be put back. */
const purchKilled=()=>((D.settings||{}).purchKilled)||{};
function killPurchLine(p,why){
  if(!p)return;
  D.settings.purchKilled=D.settings.purchKilled||{};
  D.settings.purchKilled[purchKey(p)]={on:dayISO(),by:(window.currentUserName||''),
    name:p.name||'',sup:p.sup||'',qty:p.qty||0,why:why||'removed from To review'};
  savePrefs();
}
/* A permanent home for the ignore list. It used to be reachable only from one
   sentence inside the duplicate panel, which disappears the moment there are no
   duplicates — so the way to undo an ignore vanished exactly when you had
   nothing else to go on. */
function ignoredPanel(){
  const k=Object.entries(purchKilled());
  return `<div class="panel">
    <div class="ph"><span class="t">Sheet lines being ignored</span>
      <span class="sub">${k.length?`${fmt(k.length)} line${k.length===1?'':'s'} the sync will not bring back`:'nothing is being ignored'}</span>
      ${k.length?`<div class="r"><button class="btn sm" onclick="LV3.openKilled()">Show them</button></div>`:''}</div>
    <div style="padding:12px">
      <div class="pmeta" style="margin:0">A line on the purchase sheet that somebody removed here stays removed, however many times the sheet is synced. Use <b>Ignore</b> on any line in Purchases to add one, and open this list to put one back.</div>
      ${k.length?`<div class="pmeta" style="margin:8px 0 0">Most recent: <b>${esc((k[k.length-1][1]||{}).name||'—')}</b>${(k[k.length-1][1]||{}).why?` — ${esc(k[k.length-1][1].why)}`:''}</div>`:''}
    </div>
  </div>`;
}
function openKilled(){
  const k=Object.entries(purchKilled());
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Sheet lines being ignored</h3>
    <span class="pmeta" style="margin:0">${fmt(k.length)} line${k.length===1?'':'s'} the sync will not bring back</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb" style="padding:12px 14px">
    ${k.length?`<table class="rsTbl tight"><thead><tr>
        <th class="l">The line</th><th>Qty</th><th class="l">Supplier</th><th class="l">Removed</th><th></th>
      </tr></thead><tbody>
      ${k.map(([key,v])=>`<tr>
        <td class="l"><span class="pname">${esc(v.name||key)}</span><div class="pmeta">${esc(v.why||'')}</div></td>
        <td class="mono">${fmt(v.qty||0)}</td>
        <td class="l">${esc(v.sup||'—')}</td>
        <td class="l"><span class="pmeta" style="margin:0">${esc(dshort(v.on)||v.on||'')}${v.by?' · '+esc(v.by):''}</span></td>
        <td class="l"><button class="btn sm" title="Let the next sync bring this line back in"
          onclick="LV3.revivePurchLine('${key.replace(/'/g,"\\'")}')">Put it back</button></td>
      </tr>`).join('')}
      </tbody></table>`
    :'<div class="pmeta">Nothing is being ignored.</div>'}
    <div class="ordNote" style="margin-top:10px">A line lands here when somebody removes it from To review. The sheet is never touched — the line is still on it, the sync just stops handing it back. Put one back and the next sync will import it again.</div>
  </div>
  <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Close</button></div></div>`;
  om('lav3Ov2');
}
function revivePurchLine(key){
  if(!D.settings.purchKilled)return;
  delete D.settings.purchKilled[key];
  savePrefs();render();
  toast('Back in play — the next sync will bring it in again','ok');
}
let killedSkipped=0;   // lines this sync passed over because a human removed them
/* the same line WITHOUT its name — used to spot a rename on the sheet instead
   of treating it as a new purchase */
const purchId=r=>[r.date,(r.oid||'—').toLowerCase(),r.qty,Number(r.price||0).toFixed(4)].join('|');

/* Its own call rather than borrowing the prep-sheet helper — one less thing
   that breaks if that code moves. Supabase fetches Google server-side, so no
   key is exposed here and there is no write path. */
/* Own CSV reader, for the same reason as the fetch — self-contained. Handles
   quoted cells and commas inside them, which supplier names do have. */
function lavCsvRows(csv){
  const txt=String(csv||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const rows=[];let cur=[],val='',q=false;
  for(let i=0;i<txt.length;i++){
    const ch=txt[i];
    if(q){
      if(ch==='"'){ if(txt[i+1]==='"'){val+='"';i++;} else q=false; }
      else val+=ch;
    }else if(ch==='"')q=true;
    else if(ch===','){cur.push(val);val='';}
    else if(ch==='\n'){cur.push(val);rows.push(cur);cur=[];val='';}
    else val+=ch;
  }
  if(val!==''||cur.length){cur.push(val);rows.push(cur);}
  if(!rows.length)return [];
  const hdr=rows[0].map(h=>(h||'').trim());
  return rows.slice(1).filter(r=>r.some(c=>(c||'').trim())).map(r=>{
    const o={};hdr.forEach((h,i)=>{o[h]=(r[i]||'').trim();});return o;});
}
async function lavFetchCsv(sheetId,tab){
  const base=(typeof SUPA_URL!=='undefined')?SUPA_URL:'';
  const key=(typeof SUPA_KEY!=='undefined')?SUPA_KEY:'';
  if(!base||!key)throw new Error('no database connection');
  const url=`${base}/functions/v1/sheet-sync?sheetId=${encodeURIComponent(sheetId)}&tab=${encodeURIComponent(tab)}`;
  const res=await fetch(url,{cache:'no-store',headers:{'Authorization':`Bearer ${key}`}});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const json=await res.json();
  if(json&&json.error)return null;              // tab missing — not an error worth shouting about
  return (json&&json.csv)?String(json.csv):null;
}
let _lastPurchSync=0;
async function syncPurchases(){
  if(_syncing)return;_syncing=true;_lastPurchSync=Date.now();
  /* the same job can be started from the Purchases page or the top bar, so both
     buttons have to show it running */
  const btns=['purchSyncBtn','lavSyncTop','purchSyncTop'].map(i=>document.getElementById(i)).filter(Boolean);
  btns.forEach(b=>{b.dataset.was=b.textContent;b.disabled=true;b.textContent='Reading the sheet…';});
  const btn=btns[0]||null;
  const say=t=>{_syncMsg=t;['purchSyncNote','purchSyncNoteTop'].forEach(i=>{const el=document.getElementById(i);if(el)el.innerHTML=t;});};
  try{
    /* The copies Jack found were born here: a sync that ran before the saved
       purchases had loaded saw an empty list, so every sheet line looked new and
       was added — and saved — a second time. No data, no sync. */
    if(!READY||!Array.isArray(D.purchases)||(_layersLoadedCount===0&&!D.purchases.length&&!(D.components||[]).length)){
      say('<span style="color:var(--red)"><b>Not synced — the saved purchases have not loaded yet.</b> Reload the page and press this again. Syncing now would import every line a second time.</span>');
      try{toast('Purchases not loaded — reload before syncing','er');}catch(e){}
      return;
    }
    const id=lavSheetId(),from=D.settings.purchFrom||'2026-08-01';
    if(!id){
      say('<b>No purchase sheet linked.</b> Paste the sheet link in <b>Settings → Purchase sheet</b> and press this again. Nothing is wrong — the address just is not saved yet.');
      try{toast('No purchase sheet linked — paste it in Lavarion Settings','er');}catch(e){}
      return;
    }
    /* a year ahead of today is generous for a lead time and still catches 2028 */
    const fd=new Date(TODAY);fd.setFullYear(fd.getFullYear()+1);
    const future=fd.toISOString().slice(0,10);
    const all=[],failed=[],absent=[];let skipped=0,ahead=0;
    for(const tab of LAV_TABS){
      let csv=null;
      try{csv=await lavFetchCsv(id,tab);}catch(e){failed.push(`${tab} — ${e.message}`);continue;}
      if(!csv){absent.push(tab);continue;}            // tab not created yet — normal
      parseSheetRows(lavCsvRows(csv),tab).forEach(r=>{
        if(r.date>future){ahead++;return;}             // dated years out — a sheet typo, not a buy
        if(r.date<from){skipped++;return;}
        all.push(r);});
    }
    if(!all.length){
      /* A wrong link does not error — the server hands back an EMPTY sheet, so
         every tab "reads" and yields nothing. The tell is zero rows of any age:
         the real tracker's tabs hold hundreds. This used to fall through to
         "nothing dated \u2026 or later" \u2014 dangerously reassuring to somebody who
         has just pasted a typo'd address into Settings. */
      if(!failed.length&&skipped===0&&ahead===0){
        say(`<span style="color:var(--red)"><b>That link doesn't look like the purchase sheet.</b> None of the tabs (${esc(LAV_TABS.join(', '))}) exist on it. Check the link in Settings \u2192 Purchase sheet \u2014 it should be the 2026 Purchase Tracker.</span>`);
        return;
      }
      say(failed.length
        ? `<span style="color:var(--red)">Couldn't read the sheet — ${esc(failed.join('; '))}</span>`
        : `<span class="pmeta" style="margin:0">Read ${fmt(LAV_TABS.length-absent.length)} tab${LAV_TABS.length-absent.length===1?'':'s'}, nothing dated ${dshort(from)} or later.${skipped?` ${fmt(skipped)} older row${skipped===1?'':'s'} skipped.`:''}</span>`);
      return;
    }
    const have=new Set(D.purchases.map(purchKey));
    const claimed=new Set();
    let added=0,updated=0,renamed=0,dupAsk=0;
    all.forEach(r=>{
      const k=purchKey(r);
      if(have.has(k)){
        /* Becki, 10 Aug: two real Tesco purchases, same day, same amount, no
           order id — so IDENTICAL keys. The second sheet row matched the first
           purchase and was thrown away, and she had to falsify a date to get
           her own data in. A key collision is not proof of a duplicate.
           An existing purchase can only be claimed by ONE sheet row per sync.
           If it is already taken, this is a second real line: it gets added and
           flagged, so the question is asked in To review instead of being
           answered silently and wrongly. Never drop somebody's purchase. */
        const ex=D.purchases.find(x=>purchKey(x)===k&&!claimed.has(x.id));
        if(ex){
          claimed.add(ex.id);
          if(ex.price!==r.price||ex.sup!==r.sup){ex.price=r.price;ex.sup=r.sup;updated++;}
          ex.spend=r.spend;ex.mismatch=r.mismatch;
          return;
        }
        /* every stored copy already spoken for — fall through and add this one,
           marked so somebody confirms it rather than the app deciding */
        /* somebody already looked at this exact line and removed it — do not
           hand it back to them on every sync */
        if(purchKilled()[k]){have.add(k);killedSkipped++;return;}
        const twinId=(D.purchases.find(x=>purchKey(x)===k)||{}).id||'';
        have.add(k);added++;dupAsk++;
        D.purchases.push({id:newId('P'),uuid:null,tab:r.tab,date:r.date,name:r.name,
          qty:r.qty,price:r.price,sup:r.sup,oid:r.oid,loc:'Warehouse',arr:0,alloc:[],
          acct:r.acct,invoice:r.invoice,notes:r.notes,spend:r.spend,mismatch:r.mismatch,
          /* Jack, 8 Sep: "99.999% of the time Becki won't do it as a dup — it's
             super rare." So the app no longer asks: both lines are kept as
             separate purchases, it says so, and "Same one — remove it" stays
             one click away for the once-a-year case. */
          dupCheck:{of:twinId,on:dayISO(),answered:'separate',by:'auto'}});
        logIt('edit',`Kept as a second purchase — ${r.name} ${dshort(r.date)} · ${r.sup||'supplier'} (an identical line on the sheet — two shops in one day)`);
        return;
      }
      /* Renamed on the sheet. A row's identity WAS its name, so changing
         "Borders Biscuit Assortment" to "Borders Assorted Biscuits" read as a
         brand new purchase: the new one was added and the old one left sitting
         there, which is how one order showed up twice. Same day, same order,
         same quantity, same price is the same line — rename it in place.
         Only acted on when exactly ONE line matches, so two different products
         bought in the same quantity at the same price are never merged. */
      const idk=purchId(r);
      const cand=D.purchases.filter(x=>purchId(x)===idk&&!claimed.has(x.id));
      if(cand.length===1){
        const ex=cand[0];
        claimed.add(ex.id);
        if(ex.name!==r.name){
          logIt('edit',`Purchase renamed on the sheet — “${ex.name}” is now “${r.name}”`);
          ex.name=r.name;renamed++;
        }
        ex.sup=r.sup;ex.acct=r.acct;ex.invoice=r.invoice;ex.notes=r.notes;
        ex.spend=r.spend;ex.mismatch=r.mismatch;
        have.add(purchKey(ex));
        return;
      }
      have.add(k);added++;
      D.purchases.push({id:newId('P'),uuid:null,tab:r.tab,date:r.date,name:r.name,
        qty:r.qty,price:r.price,sup:r.sup,oid:r.oid,loc:'Warehouse',arr:0,alloc:[],
        acct:r.acct,invoice:r.invoice,notes:r.notes,spend:r.spend,mismatch:r.mismatch});
    });
    /* Exact copies — same date, order, name AND quantity as a line that is
       already linked — cannot be a second real purchase: the sheet holds that
       line once. They are removed here, quietly, and said so below. A near
       copy (name differs by a typo) is left for a person, with its own Remove. */
    const healed=healExactCopies('sync');
    PURCH=D.purchases;
    save();
    const un=D.purchases.filter(x=>allocState(x).k==='none'&&!dupTwin(x)).length;
    say(`<b style="color:var(--grn)">${fmt(added)} new</b>${updated?` · ${fmt(updated)} price${updated===1?'':'s'} refreshed`:''}${renamed?` · <b style="color:var(--blu)">${fmt(renamed)} renamed on the sheet</b>`:''} · ${fmt(all.length)} row${all.length===1?'':'s'} read
      ${un?` · <b style="color:var(--amb)">${fmt(un)} waiting to be linked</b>`:''}
      ${healed?` · <b style="color:var(--red)">${fmt(healed)} leftover cop${healed===1?'y':'ies'} removed</b> <span class="pmeta" style="margin:0">(the same line was already on order — nothing on the sheet changed)</span>`:''}
      ${skipped?`<br><span class="pmeta" style="margin:0">${fmt(skipped)} row${skipped===1?'':'s'} before ${dshort(from)} left out — that stock is covered by the physical count.</span>`:''}
      ${ahead?`<br><span style="color:var(--amb)">${fmt(ahead)} row${ahead===1?'':'s'} dated years in the future left out — check the date column on the sheet, it's usually a typo.</span>`:''}
      ${absent.length?`<br><span class="pmeta" style="margin:0">${esc(absent.join(', '))} ${absent.length===1?'does':'do'} not exist on the sheet yet — that's normal.</span>`:''}
      ${failed.length?`<br><span style="color:var(--red)">Couldn't read: ${esc(failed.join('; '))}</span>`:''}`);
    logIt('edit',`Purchase sheet read — ${added} new row${added===1?'':'s'}`);
    render();
  }catch(e){
    say(`<span style="color:var(--red)">Sync failed — ${esc(e.message||'')}</span>`);
    console.warn('[lav3] purchase sync',e);
  }finally{
    _syncing=false;
    ['purchSyncBtn','lavSyncTop','purchSyncTop'].forEach(i=>{const b=document.getElementById(i);
      if(b){b.disabled=false;b.textContent=b.dataset.was||(i==='lavSyncTop'?'Sync sheet':'Sync the purchase sheet');}});
  }
}

/* ── EXACT COPIES CLEAR THEMSELVES ────────────────────────────────────────
   Jack, 3 Sep: "why does the UK staff have to do it and it isn't auto done —
   this is a huge bug." He is right. An EXACT copy — identical date, order,
   name AND quantity to a line that is already linked — cannot be a second real
   purchase, because the sheet only holds that line once. There is no judgement
   to make, so there is nothing to ask a person. It now runs on LOAD as well as
   on sync, so nobody ever meets one.
   It is not silent: every removal is written to the audit log, and the row is
   removed with keep=true so the sheet line is never added to the ignore list —
   a genuine re-order of the same thing on another day still comes in.
   NEAR copies (the name differs by a typo) are deliberately NOT touched: those
   might be a real second purchase, so they stay on the strip for a human. */
function healExactCopies(why){
  try{healSentBelowReceived(why);}catch(e){console.warn('[heal] rcvd',e);}
  if(!READY||!Array.isArray(D.purchases))return 0;
  let n=0;
  D.purchases.slice().forEach(p=>{
    /* Becki, 8 Sep: two real Tesco purchases, same day, same line — the sync
       added the second one and flagged it to be ASKED about (dupCheck), and
       this then removed it as a "leftover copy" before anyone saw the
       question. A flagged second line is a question, never a copy. */
    if(p.dupCheck)return;
    const tw=dupTwin(p);
    if(tw&&purchKey(tw)===purchKey(p)){dropReview(p.id,true,true);n++;}
  });
  if(n){
    PURCH=D.purchases;
    logIt('edit',`Removed ${n} exact cop${n===1?'y':'ies'} of purchases already on order (${why})`);
    try{logAudit('Duplicate purchases removed',`${n} exact cop${n===1?'y':'ies'} — ${why}`);}catch(e){}
    console.warn('[lav3] removed '+n+' exact duplicate purchase line(s) on '+why);
  }
  return n;
}
function allocState(p){
  const a=allocOf(p),n=allocated(p);
  if(!a.length||n===0)return{k:'none',label:'Not linked',chip:'warn'};
  /* A purchase counted as Linked purely because it had an allocation, without
     checking the thing it pointed AT still exists. When a component was saved
     its temporary id was replaced by the database one, and any allocation made
     against the old id was left pointing at nothing. setAlloc then skipped the
     batch in silence, so the purchase read "Linked" while the component showed
     0 on order and the whole order never reached On order. Now a dead link is
     its own state and goes back in the review queue where it can be fixed. */
  const dead=a.filter(x=>!targetOf(x.to));
  if(dead.length)return{k:'broken',label:'Link is broken',chip:'bad'};
  if(n<p.qty)return{k:'part',label:`${fmt(n)} of ${fmt(p.qty)}`,chip:'info'};
  return a.length>1?{k:'split',label:`Split ${a.length} ways`,chip:'ok'}:{k:'full',label:'Linked',chip:'ok'};
}
const targetOf=id=>comp(id)||prod(id);
/* a name we've linked before → offer it again, but only as a suggestion */
/* What the sheet calls something and what we call it are rarely identical —
   "Replacemen Foam Nozzles" against "Replacement Foam Nozzle" is a typo away
   from never matching. So: remember what a VA chose last time (that is the
   strongest signal there is), then fall back to comparing the words rather
   than the exact string. */
const _norm=x=>(x||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const _words=x=>_norm(x).split(' ').filter(w=>w.length>1);
function rememberAlias(sheetName,targetId){
  const k=_norm(sheetName);if(!k||!targetId)return;
  D.settings.aliases=D.settings.aliases||{};
  D.settings.aliases[k]=targetId;
  savePrefs();
}
function forgetAlias(sheetName){
  const k=_norm(sheetName);
  if(D.settings.aliases&&D.settings.aliases[k]){delete D.settings.aliases[k];savePrefs();}
}
/* how alike two names are, 0–1, on shared words weighted by length */
function nameScore(a,b){
  const A=_words(a),B=_words(b);
  if(!A.length||!B.length)return 0;
  let hit=0,tot=0;
  A.forEach(w=>{
    tot+=w.length;
    if(B.includes(w)){hit+=w.length;return;}
    /* near-miss: one is a prefix of the other and both are reasonably long */
    const near=B.find(x=>(x.length>3&&w.length>3)&&(x.startsWith(w)||w.startsWith(x)));
    if(near)hit+=Math.min(w.length,near.length)*0.85;
  });
  const cover=hit/tot;
  const back=B.filter(w=>A.includes(w)).length/B.length;
  return cover*0.7+back*0.3;
}
function suggestFor(p){
  const targets=D.components.filter(c=>!c.archived)
    .concat(D.products.filter(x=>!x.archived&&x.type!=='bundle'));
  /* 1. taught explicitly */
  const alias=(D.settings.aliases||{})[_norm(p.name)];
  if(alias){const t=targets.find(x=>x.id===alias);if(t)return{id:t.id,why:'matched this name before',sure:1};}
  /* 2. the same sheet name was linked on another row */
  const prev=D.purchases.find(x=>x.id!==p.id&&_norm(x.name)===_norm(p.name)&&allocOf(x).length);
  if(prev){const t=targets.find(x=>x.id===allocOf(prev)[0].to);
    if(t)return{id:t.id,why:'linked before',sure:1};}
  /* 3. compare the words */
  let best=null,bestScore=0;
  targets.forEach(t=>{const sc=nameScore(p.name,t.name);if(sc>bestScore){bestScore=sc;best=t;}});
  if(best&&bestScore>=0.92)return{id:best.id,why:'name looks the same',sure:1};
  if(best&&bestScore>=0.6)return{id:best.id,why:`looks like it (${Math.round(bestScore*100)}% match)`,sure:0};
  return null;
}

/* The review queue. Everything the sheet brings in lands here first — a person
   decides what it actually is, because the names on the sheet are written by
   whoever bought it, not by this app. A suggestion is offered when the name
   looks right, but it is always a click, never automatic. */
/* Practice runs and bad syncs need an undo. Removing here only forgets the row;
   nothing on the sheet changes, and syncing again fetches it afresh. */
/* quiet: the caller is removing a batch and has already taken ONE snapshot.
   Snapshotting per row meant Undo after "remove 5 leftovers" put back exactly
   one of them — an Undo that only half works is worse than none. */
function dropReview(pid,quiet,keep){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  if(!quiet)snap();
  D.purchases=D.purchases.filter(x=>x.id!==pid);
  PURCH=D.purchases;
  /* Deleting the row was only ever half the job — the sheet still holds the
     line, so the next sync brought it straight back. Record the decision too,
     unless the caller explicitly wants it to return (keep=true). */
  if(!keep)killPurchLine(p);
  if(p.uuid)sb.from('lavarion_purchases').delete().eq('id',p.uuid)
    .then(r=>{if(r.error)console.warn('[lav3] drop purchase',r.error);});
  if(quiet)return;
  save();render();
  toastUndo(`${p.name} removed — the sync will not bring it back`,'ok');
}
function clearReview(){
  /* A broken link is work waiting, same as an unlinked purchase. Excluding it
   meant the health banner said "5 purchases" and there was nowhere on the whole
   app you could actually see or fix those five. */
  const todo=D.purchases.filter(p=>['none','broken'].includes(allocState(p).k));
  if(!todo.length){toast('Nothing to clear','er');return;}
  confirmBox(`Clear ${fmt(todo.length)} line${todo.length===1?'':'s'} from the list?`,
    `<div style="margin-bottom:10px">This empties the review list. Nothing already linked is touched, and
       <b>nothing on the Google Sheet changes</b> — syncing again brings these straight back.</div>
     <div class="note" style="margin:0">Handy after a practice run, or when a sync pulled in the wrong dates.</div>`,
    ()=>{
      snap();
      const ids=todo.map(p=>p.uuid).filter(Boolean);
      D.purchases=D.purchases.filter(p=>allocState(p).k!=='none');
      PURCH=D.purchases;
      for(let i=0;i<ids.length;i+=60)
        sb.from('lavarion_purchases').delete().in('id',ids.slice(i,i+60))
          .then(r=>{if(r.error)console.warn('[lav3] clear review',r.error);});
      _syncMsg='';
      save();render();
      toastUndo(`${fmt(todo.length)} line${todo.length===1?'':'s'} cleared`,'ok');
    },{danger:true,ok:`Clear ${fmt(todo.length)}`});
}
function reviewOrders(){
  /* The sheet writes one line per product but they arrive as one order — the
     order ref proves it. Grouping by it is what makes Purchases and Deliveries
     line up: link an order here, receive that same order there. */
  /* A broken link is work waiting, same as an unlinked purchase. Excluding it
   meant the health banner said "5 purchases" and there was nowhere on the whole
   app you could actually see or fix those five. */
  /* Jack, 2 Sep: six exact copies of an order already linked sat here as a
     6-line order with a green "Link this order" — one click would have booked
     1,368 units never bought. A copy is not work waiting; it is a duplicate.
     It is excluded from the list, every count built from it, and every link
     path — and offered a Remove button of its own instead. */
  const todo=D.purchases.filter(p=>['none','broken'].includes(allocState(p).k)&&!dupTwin(p));
  const by={};
  todo.forEach(p=>{
    const k=(p.oid&&p.oid!=='—')?('o:'+p.oid.toLowerCase()) : ('x:'+p.id);
    (by[k]=by[k]||{ref:p.oid&&p.oid!=='—'?p.oid:'',sup:p.sup||'—',date:p.date,tab:p.tab,lines:[]}).lines.push(p);
  });
  return Object.values(by).map(o=>{
    o.date=o.lines.map(l=>l.date).sort()[0];
    o.units=o.lines.reduce((t,l)=>t+l.qty,0);
    o.value=o.lines.reduce((t,l)=>t+(l.spend||l.qty*l.price),0);
    o.sugs=o.lines.map(l=>suggestFor(l));
    o.ready=o.sugs.filter(x=>x&&x.sure).length;
    return o;
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
function reviewPanel(){
  const orders=reviewOrders();
  const dupes=staleDupes();
  /* Becki, 10 Sep: "my only option is to remove them… it should flag anything
     that could be a possible duplicate but then that is for us to say yes or
     no to. Once answered it should not show up again." The strip only ever
     offered Remove. Each line now gets both answers, and Keep is remembered
     on the line (dupCheck.answered) so it never comes back. */
  const dupStrip=dupes.length?`<div class="panel" id="dupStrip" style="border-color:var(--red);display:block;">
    <div class="ph" style="align-items:center">
      <span class="t" style="color:var(--red)">${fmt(dupes.length)} possible duplicate${dupes.length===1?'':'s'} — your call</span>
      <span class="sub">Same day, quantity, price and supplier as an order you have <b>already linked</b>, but the name is spelt slightly differently — so this app cannot be certain whether it is a copy or a second real purchase, and will not guess. <b>Exact</b> copies are now deleted on their own; only these need an eye. Removing them changes nothing on the Google Sheet.<br>${esc(dupes.slice(0,3).map(x=>x.p.name).join(', '))}${dupes.length>3?` and ${dupes.length-3} more`:''}</span>
      <div class="r"><button class="btn sm go" title="None of these are copies — keep every one and stop asking" onclick="LV3.dupKeepAll()">Keep ${dupes.length===1?'it':'all '+fmt(dupes.length)}</button>
        <button class="btn sm dgr" title="Every one of these is the same purchase written twice — remove the copies" onclick="LV3.dropDupes()">Remove ${dupes.length===1?'it':'all '+fmt(dupes.length)}</button></div>
    </div>
    <div style="padding:2px 12px 12px;display:flex;flex-direction:column;gap:6px;">
      ${dupes.map(x=>`<div class="dupLine">
        <div style="min-width:0;">
          <div class="dupName">${esc(x.p.name)}</div>
          <div class="dupMeta">${fmt(x.p.qty)} @ ${gbp(x.p.price)} &middot; ${esc(x.p.sup||'—')} &middot; ${dshort(x.p.date)}${x.p.oid?` &middot; order <b>${esc(x.p.oid)}</b>`:' &middot; <i>no order number</i>'}</div>
          <div class="dupMeta">looks like: <b>${esc(x.twin.name)}</b>${x.twin.oid?` &middot; order <b>${esc(x.twin.oid)}</b>`:' &middot; <i>no order number</i>'}</div>
        </div>
        <div style="display:flex;gap:6px;flex:none;">
          <button class="btn sm go" title="A second real purchase — keep it and never ask again" onclick="LV3.mergeKeepBoth('${x.p.id}')">Not a duplicate</button>
          <button class="btn sm dgr" title="The same purchase written on the sheet twice — remove this copy. The sync will not bring it back." onclick="LV3.dropOneDupe('${x.p.id}')">Remove this copy</button>
        </div></div>`).join('')}
    </div></div>`:'';
  if(!orders.length)return dupStrip;   /* the strip already says 0 · all linked */
  const lines=orders.reduce((t,o)=>t+o.lines.length,0);
  const value=orders.reduce((t,o)=>t+o.value,0);
  const ready=orders.filter(o=>o.ready===o.lines.length).length;
  /* Folded away by default. It is a long list you work through when you sit
     down to it, not something that should be in the way every time Purchases
     is opened. The header still says exactly what is waiting. */
  const revHead=`<span class="t">To review</span>
      <span class="sub">${fmt(orders.length)} order${orders.length===1?'':'s'} · ${fmt(lines)} line${lines===1?'':'s'} · ${gbp(value)}</span>
      ${ready?`<span class="chip info">${fmt(ready)} ready to go</span>`:''}`;
  if(!_revOpen)return dupStrip+`<div class="panel" id="revPanel">
    <div class="ph" style="cursor:pointer" onclick="LV3.revToggle()">${revHead}
      <div class="r"><button class="btn sm" onclick="event.stopPropagation();LV3.revToggle()">Show the list</button></div>
    </div></div>`;
  return dupStrip+`<div class="panel" id="revPanel">
    <div class="ph" style="cursor:pointer" onclick="LV3.revToggle()">${revHead}
      <div class="r" onclick="event.stopPropagation()">
        ${ready?`<button class="btn sm pri" onclick="LV3.applyAllSuggestions()">Link all ${fmt(ready)}</button>`:''}
        <button class="btn sm dgr" title="Empty this list — the sheet is untouched and a re-sync brings it back" onclick="LV3.clearReview()">Clear list</button>
        <button class="btn sm" onclick="LV3.revToggle()">Hide</button>
      </div></div>
    <div class="rvWrap">
      ${orders.map(o=>{
        const allMatched=o.ready===o.lines.length&&o.sugs.every(x=>!x||x.sure);
        return `<div class="rvOrder ${allMatched?'ok':''}">
          <div class="rvHead">
            <div class="rvWho">
              <span class="rvSup">${esc(o.sup)}</span>
              <span class="rvMeta">${dshort(o.date)}${o.ref?` · order ${esc(o.ref)}`:' · no order ref'} · ${esc(o.tab||'')}</span>
            </div>
            <div class="rvNums">
              <div><b>${fmt(o.lines.length)}</b><span>line${o.lines.length===1?'':'s'}</span></div>
              <div><b>${fmt(o.units)}</b><span>units</span></div>
              <div><b>${gbp(o.value)}</b><span>total</span></div>
            </div>
            <div class="rvAct">
              ${allMatched
                ? `<button class="btn sm go" onclick="LV3.linkOrder('${esc(o.ref)||o.lines[0].id}')">Link this order</button>`
                : `<span class="rvWarn">${fmt(o.lines.length-o.ready)} of ${fmt(o.lines.length)} need a match</span>`}
              <button class="btn sm dots" title="Remove this order from the list" onclick="LV3.dropOrder('${esc(o.ref)||o.lines[0].id}')">&#10005;</button>
            </div>
          </div>
          <div class="rvLines">
            <div class="rvLine rvHdr">
              <div>What the sheet calls it</div>
              <div class="r">Qty</div>
              <div class="r">Unit</div>
              <div class="r">Line total</div>
              <div>Link it to</div>
              <div></div>
            </div>
            ${o.lines.map((p,ix)=>{
              const sug=o.sugs[ix];const t=sug?(comp(sug.id)||prod(sug.id)):null;
              const total=p.spend||(p.qty*p.price);
              const isBroken=allocState(p).k==='broken';
              const twin=dupTwin(p);
              const chgTwin=twin?null:changedTwin(p);
              return `<div class="rvLine ${isBroken?'broken':t?'':'nomatch'}">
                <div class="rvName">${esc(p.name)}
                  ${isBroken?'<span class="chip bad" title="This was linked once, but the part it pointed at has changed. Pick it again.">link broken</span>':''}</div>
                <div class="rvNum">${fmt(p.qty)}</div>
                <div class="rvNum">${gbp(p.price)}</div>
                <div class="rvNum">${gbp(p.spend||total)}</div>
                <div class="rvTo">${twin
                  ? `<span class="rvNone" style="color:var(--red)">already on order as <b>${esc(twin.name)}</b></span>
                     <span class="rvWhy">this is a leftover copy — do not link it</span>`
                  : chgTwin
                  ? `<span class="rvNone" style="color:var(--amb)">the sheet has changed <b>${esc(chgTwin.name)}</b></span>
                     <span class="rvWhy">${fmt(chgTwin.qty||0)} → ${fmt(p.qty||0)} units — probably a correction</span>`
                  : t
                  ? `<span class="brTag ${sug.sure?'':'maybe'}">${esc(t.name)}</span><span class="rvWhy">${esc(sug.why)}</span>`
                  : `<span class="rvNone">nothing matches</span>`}</div>
                <div class="rvBtns">
                  ${twin
                    ? `<button class="btn sm dgr" title="Same day, same quantity, same supplier as one already on order — linking it would book stock you never bought"
                         onclick="LV3.dropReview('${p.id}')">Remove the copy</button>`
                    : chgTwin
                    ? `<button class="btn sm pri" title="Same day, same supplier, same product — the figures changed on the sheet"
                         onclick="LV3.openMerge('${p.id}')">Merge or keep both</button>`
                    : t?`<button class="btn sm go" onclick="LV3.quickLink('${p.id}','${sug.id}')">Link</button>
                         <button class="btn sm" onclick="LV3.openLink('${p.id}')">Change</button>`
                       :`<button class="btn sm pri" onclick="LV3.openLink('${p.id}')">Pick one</button>`}
                  <button class="btn sm dots" title="Remove this line" onclick="LV3.dropReview('${p.id}')">&#10005;</button>
                </div>
              </div>`;}).join('')}
          </div>
        </div>`;}).join('')}
    </div>
    <div class="rvFoot">
      Linking turns a line into a <b>priced stock batch on order</b>. The whole order then appears together in
      <b>Deliveries</b>, so when the box turns up you receive it in one go. Nothing counts as stock until then.
    </div>
  </div>`;
}
function _orderLines(key){
  /* A broken link is work waiting, same as an unlinked purchase. Excluding it
   meant the health banner said "5 purchases" and there was nowhere on the whole
   app you could actually see or fix those five. */
  const todo=D.purchases.filter(p=>['none','broken'].includes(allocState(p).k));
  const byRef=todo.filter(p=>(p.oid||'').toLowerCase()===String(key).toLowerCase()&&p.oid&&p.oid!=='—');
  return (byRef.length?byRef:todo.filter(p=>p.id===key)).filter(p=>!dupTwin(p));
}
function linkOrder(key){
  const lines=_orderLines(key);
  if(!lines.length)return;
  snap();let n=0;
  lines.forEach(p=>{const s=suggestFor(p);if(s&&quickLinkSilent(p.id,s.id))n++;});
  save();render();
  toastUndo(`${fmt(n)} line${n===1?'':'s'} linked — the order is now in Deliveries`,'ok');
}
function dropOrder(key){
  const lines=_orderLines(key);
  if(!lines.length)return;
  confirmBox(`Remove ${fmt(lines.length)} line${lines.length===1?'':'s'} from the list?`,
    `<div style="margin-bottom:10px">This takes the order off the review list. <b>Nothing on the Google Sheet changes</b> —
       syncing again brings it straight back.</div>
     <div style="max-height:140px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px 10px">
       ${lines.map(p=>`<div style="font-size:12px;padding:2px 0">${esc(p.name)} <span class="pmeta" style="margin:0">${fmt(p.qty)} @ ${gbp(p.price)}</span></div>`).join('')}
     </div>`,
    ()=>{
      snap();
      const ids=lines.map(p=>p.uuid).filter(Boolean);
      const lids=new Set(lines.map(p=>p.id));
      D.purchases=D.purchases.filter(p=>!lids.has(p.id));
      PURCH=D.purchases;
      for(let i=0;i<ids.length;i+=60)
        sb.from('lavarion_purchases').delete().in('id',ids.slice(i,i+60))
          .then(r=>{if(r.error)console.warn('[lav3] drop order',r.error);});
      save();render();
      toastUndo(`${fmt(lines.length)} line${lines.length===1?'':'s'} removed`,'ok');
    },{danger:true,ok:'Remove'});
}
/* accept every suggestion at once — still a deliberate click, just one of them */
function applyAllSuggestions(){
  /* A broken link is work waiting, same as an unlinked purchase. Excluding it
   meant the health banner said "5 purchases" and there was nowhere on the whole
   app you could actually see or fix those five. */
  const todo=D.purchases.filter(p=>['none','broken'].includes(allocState(p).k)&&!dupTwin(p));
  const withSug=todo.map(p=>({p,s:suggestFor(p)})).filter(x=>x.s&&x.s.sure);
  if(!withSug.length){toast('No suggestions to accept','er');return;}
  confirmBox(`Accept ${fmt(withSug.length)} suggestion${withSug.length===1?'':'s'}?`,
    `<div style="margin-bottom:10px">Each of these is linked because the name on the sheet matches a component, or because the same name was linked this way before.</div>
     <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px 10px">
       ${withSug.slice(0,40).map(({p,s})=>{const o=comp(s.id)||prod(s.id);
         return `<div style="font-size:12px;padding:3px 0">${esc(p.name)} <span style="color:var(--text3)">→</span> <b>${esc(o?o.name:'?')}</b>
           <span class="pmeta" style="margin:0">${fmt(p.qty)} @ ${gbp(p.price)}</span></div>`;}).join('')}
       ${withSug.length>40?`<div class="pmeta">+${fmt(withSug.length-40)} more</div>`:''}
     </div>
     <div class="note" style="margin:10px 0 0">Only the ones it is sure about. Anything it merely thinks looks similar is left for you —
       link one by hand and it will remember that name from then on.</div>`,
    ()=>{
      snap();let n=0;
      withSug.forEach(({p,s})=>{quickLinkSilent(p.id,s.id);n++;});
      save();render();
      toastUndo(`${fmt(n)} purchase${n===1?'':'s'} linked`,'ok');
    },{ok:`Link ${fmt(withSug.length)}`});
}
/* ── RESTOCKS ────────────────────────────────────────────────────────────────
   Pick a bundle, say how many you want to build, and it works out every part:
   how many are needed, what is already here, what is already coming, and how
   many CASES to order for the rest. Cases round up, because half a case is not
   a thing you can buy. Nobody should be doing this on paper. */
/* Bundles share parts. Planning them one at a time meant working out the same
   component three times and adding it up by hand — and worse, each pass saw the
   whole of stock, so three bundles each "covered" by the same 90 gloves looked
   fine and were not. Picking several at once counts every part ONCE against
   what is actually on the shelf. */
const RS_KEY='lav3_restock_picks';
let RS_PICKS=(()=>{
  try{
    /* a build plan left for over an hour is stale on purpose — Jack: "if I go
       off the webapp it should auto clear after 1 hour". Fresh visits start
       clean; a refresh mid-planning keeps everything. */
    const raw=localStorage.getItem(RS_KEY);
    if(!raw)return{};
    const at=parseInt(localStorage.getItem('lv3_rs_at')||'0');
    /* no stamp = saved before the expiry existed = stale by definition */
    if(!at||Date.now()-at>60*60*1000){
      localStorage.removeItem(RS_KEY);localStorage.removeItem('lv3_rs_dates');localStorage.removeItem('lv3_rs_at');
      return{};
    }
    const o=JSON.parse(raw);
    return (o&&typeof o==='object'&&!Array.isArray(o))?o:{};
  }catch(e){return{};}
})(),RS_Q='';
/* Called on every change to the basket. Silent on purpose — a toast per
   keystroke would be worse than the bug. */
/* THE RESTOCK GOAL (spec §6): "I want 1,000 ready by 15 October." A date and
   what it means — ready to send, or actually sellable at Amazon — per picked
   bundle. From that, each part gets a latest safe order date, worked BACK
   through prep, the FBA pipeline where it applies, production and freight. */
let RS_DATES=(function(){try{return JSON.parse(localStorage.getItem('lv3_rs_dates')||'{}');}catch(e){return{};}})();
function rsDatesSave(){try{localStorage.setItem('lv3_rs_dates',JSON.stringify(RS_DATES));}catch(e){}}
function rsDate(id,v){
  if(v)RS_DATES[id]=Object.assign({mode:'prime'},RS_DATES[id]||{},{date:v});
  else delete RS_DATES[id];
  rsDatesSave();render();
}
function rsGoalMode(id,v){RS_DATES[id]=Object.assign({},RS_DATES[id]||{},{mode:v});rsDatesSave();render();}
function rsSave(){
  try{
    if(Object.keys(RS_PICKS).length){localStorage.setItem(RS_KEY,JSON.stringify(RS_PICKS));localStorage.setItem('lv3_rs_at',String(Date.now()));}
    else{localStorage.removeItem(RS_KEY);localStorage.removeItem('lv3_rs_at');}
  }catch(e){}
}
/* WAS: sold60 — the two most recent months ADDED UP, i.e. what actually sold,
   which is why Restocks said 167 while the Products page said 146. That is
   history, not a forecast, and the brief asks for a forecast.
   NOW: the latest month's daily rate x the replenishment period. And no more
   inventing 50 when there is no sales figure — a made-up number in a costed
   plan is the thing the team keeps getting bitten by. */
function rsDefaultQty(p){return replenQty(p,D.settings.replenDays||60)||0;}
function rsSet(id){
  const p=prod(id);if(!p)return;
  if(!RS_PICKS[id])RS_PICKS[id]=rsDefaultQty(p);
  rsSave();
  RS_Q='';render();
}
function rsQty(id,v){RS_PICKS[id]=Math.max(0,parseInt(v)||0);rsSave();render();}
function rsDrop(id){delete RS_PICKS[id];delete RS_DATES[id];rsSave();rsDatesSave();render();}
function rsPicked(){return Object.keys(RS_PICKS).map(id=>prod(id)).filter(Boolean);}
/* Incoming, judged. "On order" used to count toward a plan whatever its
   state — including the order that is 40 days late and the one nobody has
   dated. A plan built on those is a plan built on hope. Only units with a
   real, still-future ETA count; the rest are shown, named, and excluded. */
function rsIncoming(c){
  const t=dayISO();
  let ok=0,late=0,blind=0,eta='';
  (c.layers||[]).filter(l=>!l.arr&&!l.writtenOff).forEach(l=>{
    const q=l.qty||0;
    const e=String(l.eta2||l.eta1||'').slice(0,10);
    if(!e){blind+=q;return;}
    if(e<t){late+=q;return;}
    ok+=q;if(!eta||e>eta)eta=e;
  });
  return{ok,late,blind,eta};
}
/* Every part across every picked bundle, added up, with stock counted once. */
function restockPlanMulti(){
  const byComp={};
  rsPicked().forEach(p=>{
    if(p.type!=='bundle')return;
    const target=RS_PICKS[p.id]||0;
    (p.recipe||[]).forEach(r=>{
      const c=comp(r.c);if(!c)return;
      const per=r.q||1;
      const e=byComp[c.id]||(byComp[c.id]={c,need:0,from:[],kind:c.kind==='packaging'?'Packaging':'Component'});
      e.need+=per*target;
      e.from.push({p,per,qty:target,need:per*target});
    });
  });
  const today=dayISO();
  return Object.values(byComp).map(e=>{
    const stock=onHand(e.c)||0,inc=rsIncoming(e.c);
    /* the strictest deadline this part serves: each dated pick's need-by, less
       prep, less the FBA pipeline when the goal is "sellable by then" */
    let arriveBy=null;
    e.from.forEach(f=>{
      const g=RS_DATES[f.p.id];if(!g||!g.date)return;
      let d=String(g.date).slice(0,10);
      d=addCalDays(d,-prepDaysN());
      if((g.mode||'prime')==='prime')d=addCalDays(d,-fbaCalDays());
      if(arriveBy==null||d<arriveBy)arriveBy=d;
    });
    /* with a deadline, incoming only counts if it lands BEFORE the parts are
       needed on the bench — the whole Wedding Cards failure in one rule */
    const coming=arriveBy==null?inc.ok
      :(e.c.layers||[]).filter(l=>!l.arr&&!l.writtenOff).reduce((t,l)=>{
        const et=String(l.eta2||l.eta1||'').slice(0,10);
        return t+((et&&et>=today&&et<=arriveBy)?(l.qty||0):0);},0);
    const shortfall=Math.max(0,e.need-stock-coming);
    const caseQty=parseInt(e.c.caseQty)||0;
    const cases=shortfall>0?(caseQty>1?Math.ceil(shortfall/caseQty):shortfall):0;
    const buying=caseQty>1?cases*caseQty:cases;
    /* latest safe order date = arrival deadline minus production minus route */
    let orderBy=null,orderLate=false,routeMissing=false;
    if(arriveBy!=null&&shortfall>0){
      const route=routeDaysFor(compSupplier(e.c));
      if(!route)routeMissing=true;
      else{
        const lead=route.hi+(prodTimeOf(e.c)||0);
        orderBy=addCalDays(arriveBy,-lead);
        orderLate=orderBy<today;
      }
    }
    return{...e,stock,coming,cLate:inc.late,cBlind:inc.blind,cEta:inc.eta,shortfall,caseQty,cases,buying,
      ok:shortfall===0,shared:e.from.length>1,arriveBy,orderBy,orderLate,routeMissing,goal:arriveBy!=null};
  }).sort((a,b)=>(b.orderLate?1:0)-(a.orderLate?1:0)||b.shortfall-a.shortfall||a.c.name.localeCompare(b.c.name));
}
function restockPlan(p,target){
  if(!p||p.type!=='bundle')return[];
  return (p.recipe||[]).map(r=>{
    const c=comp(r.c);if(!c)return null;
    const per=r.q||1;
    const need=per*target;
    const stock=onHand(c)||0;
    const inc=rsIncoming(c),coming=inc.ok;
    /* what is here and what is credibly on its way both count — but an overdue
       or undated order counts for nothing until it actually lands */
    const shortfall=Math.max(0,need-stock-coming);
    const caseQty=parseInt(c.caseQty)||0;
    const cases=shortfall>0?(caseQty>1?Math.ceil(shortfall/caseQty):shortfall):0;
    const buying=caseQty>1?cases*caseQty:cases;
    return{c,per,need,stock,coming,cLate:inc.late,cBlind:inc.blind,cEta:inc.eta,shortfall,caseQty,cases,buying,
      ok:shortfall===0,kind:c.kind==='packaging'?'Packaging':'Component'};
  }).filter(Boolean).sort((a,b)=>b.shortfall-a.shortfall||a.c.name.localeCompare(b.c.name));
}
function rsCopyList(){
  const plan=restockPlanMulti().filter(x=>!x.ok&&x.buying>0);
  if(!plan.length){toast('Everything is covered — nothing to copy');return;}
  const txt='Part\tUnits\tCases\tSupplier\n'+plan.map(x=>[x.c.name,x.buying,x.cases||'',compSupplier(x.c)||''].join('\t')).join('\n');
  try{navigator.clipboard.writeText(txt).then(
    ()=>toast('\u2713 '+plan.length+' lines copied — paste straight into the purchase sheet','ok'),
    ()=>toast('Could not reach the clipboard','er'));}
  catch(e){toast('Could not reach the clipboard','er');}
}
function rsClear(){RS_PICKS={};RS_Q='';rsSave();render();}
/* The list was being filled and left hidden. On the opening screen the markup
   hardcodes .on so it worked; once something was picked the class was only set
   at render time, and typing never re-renders — so "Add another bundle" looked
   completely dead. Show it here, where the typing happens. */
function rsFind(v){
  RS_Q=v;
  const box=document.getElementById('rsPop');
  if(!box)return;
  box.innerHTML=rsHits(v);
  box.classList.add('on');
}
function rsCloseFind(){const b=document.getElementById('rsPop');
  if(b&&!document.querySelector('.rsStart'))b.classList.remove('on');}
document.addEventListener('click',e=>{if(!e.target.closest('.rsSearch'))rsCloseFind();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')rsCloseFind();});
/* Which restock logs are opened out. Collapsed by default — the point of a log
   is that it sits there until the ordering is done, and eight of them expanded
   is a page you cannot use. */
let RS_OPEN={},RS_TBL=true;
function rsToggle(pid){RS_OPEN[pid]=!RS_OPEN[pid];render();}
function rsToggleTbl(){RS_TBL=!RS_TBL;render();}
function rsHits(v){
  const q=(v||'').toLowerCase().trim();
  const list=D.products.filter(x=>x.type==='bundle'&&!x.archived&&!RS_PICKS[x.id])
    .filter(x=>!q||x.name.toLowerCase().includes(q)||String(x.asin||'').toLowerCase().includes(q)||String(x.sku||'').toLowerCase().includes(q))
    .sort((a,b)=>((b.recipe||[]).length?1:0)-((a.recipe||[]).length?1:0)||a.name.localeCompare(b.name))
    .slice(0,40);
  if(!list.length)return `<div class="rsNone">Nothing matches “${esc(v)}”</div>`;
  return list.map(x=>{const n=(x.recipe||[]).length;
    return `<button type="button" class="rsOpt${n?'':' noList'}" onclick="LV3.rsSet('${x.id}')">
      <span class="rsOptN">${esc(x.name)}</span>
      <span class="rsOptM">${n?`${n} part${n===1?'':'s'}`:'no build list'}</span></button>`;}).join('');
}
function vRestocks(){
  const bundles=D.products.filter(x=>x.type==='bundle'&&!x.archived);
  if(!bundles.length){
    $('lav3View').innerHTML=`<div class="panel"><div class="rsEmpty">
      <div class="rsEmT">No bundles yet</div>
      <div class="rsEmB">Restocks works out what to buy for a bundle. Add one and give it a build list first.</div>
      <button class="btn pri" onclick="LV3.editProduct(null)">Add a product</button></div></div>`;
    return;
  }
  const picks=rsPicked();

  /* Nothing is picked until you pick it. Landing on whatever happened to be
     first meant the page opened showing numbers for a product nobody asked
     about — and looked broken when that one had no build list. */
  if(!picks.length){
    $('lav3View').innerHTML=`<div class="rsStart">
      <div class="pmeta" style="max-width:760px;margin:0 auto 12px;padding:9px 13px;background:var(--bg2);border:1px solid var(--border2);border-left:3px solid var(--blu);border-radius:9px;text-align:left;">This page works out parts for a target <b>you pick</b> \u2014 a planning tool. For what to buy day-to-day, timing included, the <a href="javascript:void(0)" onclick="LV3.go('planner')" style="color:var(--blu)">Planner</a> is the authority.</div>
      <div class="rsStartT">What do you want to build?</div>
      <div class="rsStartB">Pick one bundle or several. It adds up every part across all of them, counts what you
        already have and what is on its way <b>once</b>, and tells you how many cases to order for the rest.</div>
      <div class="rsSearch big">
        <input class="in rsIn" id="rsIn" autocomplete="off" placeholder="Type a product, ASIN or SKU…"
          value="${esc(RS_Q||'')}" oninput="LV3.rsFind(this.value)">
        <div class="rsPop on" id="rsPop">${rsHits(RS_Q||'')}</div>
      </div>
    </div>`;
    setTimeout(()=>{const e=document.getElementById('rsIn');if(e)e.focus();},50);
    return;
  }

  const plan=restockPlanMulti();
  const short=plan.filter(x=>!x.ok);
  const spend=short.reduce((t,x)=>t+x.buying*(avgCostOf(x.c)||0),0);
  /* "366 cases" for three parts that do not come in cases was simply wrong.
     Cases and loose units are different things and are counted separately. */
  const nCases=short.filter(x=>x.caseQty>1).reduce((t,x)=>t+x.cases,0);
  const nLoose=short.filter(x=>x.caseQty<=1).reduce((t,x)=>t+x.buying,0);
  const shared=plan.filter(x=>x.shared);
  const noList=picks.filter(x=>!(x.recipe||[]).length);
  const totalUnits=picks.reduce((t,x)=>t+(RS_PICKS[x.id]||0),0);
  const multi=picks.length>1;

  $('lav3View').innerHTML=`
    <div class="pmeta" style="max-width:1560px;margin:0 auto 10px;padding:9px 13px;background:var(--bg2);border:1px solid var(--border2);border-left:3px solid var(--blu);border-radius:9px;">
      This page works out parts for a target <b>you pick</b> — a planning tool. For what to buy day-to-day, timing included, the <a href="javascript:void(0)" onclick="LV3.go('planner')" style="color:var(--blu)">Planner</a> is the authority: this page counts stock on order as available even when it lands too late.</div>
    <div class="rsPicks">
      <div class="rsPicksH">
        <span class="t">Building ${fmt(picks.length)} product${picks.length===1?'':'s'}</span>
        <span class="sub">${fmt(totalUnits)} units in total</span>
        <div class="rsPicksAdd">
          <div class="rsSearch">
            <input class="in rsIn" id="rsIn" autocomplete="off" placeholder="Add another bundle…"
              value="${esc(RS_Q||'')}" oninput="LV3.rsFind(this.value)" onfocus="LV3.rsFind(this.value)">
            <div class="rsPop${RS_Q?' on':''}" id="rsPop">${rsHits(RS_Q||'')}</div>
          </div>
          <button class="btn sm" onclick="LV3.rsClear()" title="Start again">Clear all</button>
        </div>
      </div>
      ${picks.map(x=>{
        const s2=sold60(x),sold=sold30(x),at=atAmz(x),have=avail(x).n||0,q=RS_PICKS[x.id]||0;
        const own=restockPlan(x,q),ownShort=own.filter(y=>!y.ok);
        const open=!!RS_OPEN[x.id];
        return `<div class="rsPick2${(x.recipe||[]).length?'':' noList'}${open?' open':''}">
          ${(()=>{
            /* Step by the smallest case on this build, not a hardcoded 25 — on a
               plan of 22 the old buttons could only reach 0 or 47, never the
               number the page itself recommends. */
            const cq=own.map(y=>parseInt(y.caseQty)||0).filter(v=>v>1);
            const step=cq.length?Math.min.apply(null,cq):10;
            /* one rate for every option — the planner's own (last full month,
               or the typed planning figure). The old 2-month option summed
               actual Jun+Jul while 1 and 3 extrapolated July, so "2 months"
               could suggest LESS than 1 month twice over. */
            const pd=planDemandOf(x);
            const per=n=>(pd&&pd.m>0)?Math.round(pd.m*n):null;
            const opts=[1,2,3].map(n=>{const v=per(n);
              return `<option value="${v==null?'':v}"${v!=null&&v===q?' selected':''}${v==null?' disabled':''}>${n} month${n===1?'':'s'}${v==null?'':' · '+fmt(v)}</option>`;}).join('');
            return `
          <div class="rsHd">
            <div class="rsHdN" style="display:flex;gap:8px;align-items:flex-start">
              <button class="rsChev" onclick="LV3.rsToggle('${x.id}')"
                title="${open?'Fold this log away':'Open this log and check the parts'}">${open?'&#9662;':'&#9656;'}</button>
              <div>
                <span class="nm2">${esc(x.name)}</span>
                <span class="mt2">${asinBtn(x.asin)} · ${(x.recipe||[]).length} component${(x.recipe||[]).length===1?'':'s'}</span>
                ${ownShort.length?`<span class="ordn" style="color:var(--red)"><i class="dt"></i>${fmt(ownShort.length)} component${ownShort.length===1?'':'s'} need ordering</span>`
                  :(own.length?`<span class="ordn" style="color:var(--grn)"><i class="dt"></i>everything covered</span>`:'')}
              </div>
            </div>
            <div class="rsMx">
              <span><i class="k">Sold ${esc(ymName(hubMonth().ym))}</i><b class="v${sold!=null?'':' none'}">${sold!=null?fmt(sold):'—'}</b><i class="u">${sold!=null?'units':'no figure'}</i></span>
              <span><i class="k">2-month actual</i><b class="v${s2.n==null?' none':''}">${s2.n==null?'—':fmt(s2.n)}</b><i class="u">${s2.n==null?'no figure':'Jun+Jul, for reference'}</i></span>
              <span><i class="k">At Amazon</i><b class="v${at==null?' none':''}">${at==null?'—':fmt(at)}${amzIn(x)?`<span style="color:var(--blu);font-size:11px"> +${fmt(amzIn(x))}</span>`:''}</b><i class="u">${at==null?'never counted':'units'}</i></span>
              <span><i class="k">Backstock</i><b class="v">${fmt(have)}</b><i class="u">unit${have===1?'':'s'}</i></span>
            </div>
            <div class="rsCtl">
              <div><span class="k">Target stock</span>
                <div class="rsStep">
                  <button class="rsPm" title="Down one case (${fmt(step)})" onclick="LV3.rsQty('${x.id}',${Math.max(0,q-step)})">&minus;</button>
                  <input class="rsQty" type="number" min="0" step="${step}" value="${q}" onchange="LV3.rsQty('${x.id}',this.value)">
                  <button class="rsPm" title="Up one case (${fmt(step)})" onclick="LV3.rsQty('${x.id}',${q+step})">+</button>
                </div><i class="rsStepU">units</i></div>
              <div><span class="k">Target period</span>
                <select class="rsSel" ${per(1)==null&&per(2)==null?'disabled title="No sales figure for this product yet"':''}
                  onchange="if(this.value)LV3.rsQty('${x.id}',this.value)">
                  ${/* Custom is what the box SAYS when the number matches no
                       period — it was selectable and did nothing, because its
                       value is empty and the handler guards on truthiness.
                       Disabled: it can be shown, never chosen. */''}
                  <option value="" disabled${[1,2,3].every(n=>per(n)!==q)?' selected':''}>Custom</option>
                  ${opts}
                </select></div>
              <div><span class="k">Need by <i style="font-weight:400;color:var(--text3)">(optional)</i></span>
                <div style="display:flex;gap:5px;align-items:center">
                  <input class="in" type="date" style="width:130px" value="${esc((RS_DATES[x.id]||{}).date||'')}"
                    onchange="LV3.rsDate('${x.id}',this.value)">
                  ${(RS_DATES[x.id]||{}).date?`<select class="in" style="width:150px" onchange="LV3.rsGoalMode('${x.id}',this.value)">
                    <option value="prime" ${((RS_DATES[x.id]||{}).mode||'prime')==='prime'?'selected':''}>sellable by then</option>
                    <option value="send" ${(RS_DATES[x.id]||{}).mode==='send'?'selected':''}>ready to send by then</option>
                  </select>`:''}
                </div></div>
              <div><span class="k">&nbsp;</span>
                <button class="btn sm dots" title="Take this one out" onclick="LV3.rsDrop('${x.id}')">&#10005;</button></div>
            </div>
          </div>`;})()}
          ${open?`<div class="rsLog">
            ${!own.length?`<div class="pmeta">No build list — nothing to work out for this one.</div>`
            :`<table class="rsTbl tight mini"><thead><tr>
                <th class="l">Part</th><th>In one</th><th>Need</th><th>Have</th><th>To order</th></tr></thead><tbody>
              ${own.map(y=>`<tr class="${y.ok?'':'short'}">
                <td class="l"><span class="pname">${esc(y.c.name)}</span>
                  <div class="pmeta">${y.kind}${y.caseQty>1?` · case of ${fmt(y.caseQty)}`:' · singles'}</div></td>
                <td class="mono">&times;${fmt(y.per)}</td>
                <td class="mono b">${fmt(y.need)}</td>
                <td class="mono">${fmt(y.stock)}${y.coming?`<div class="pmeta" style="color:var(--blu)">+${fmt(y.coming)} due ${dshort(y.cEta)}</div>`:''}${y.cLate?`<div class="pmeta" style="color:var(--red)">+${fmt(y.cLate)} late</div>`:''}${y.cBlind?`<div class="pmeta" style="color:var(--amb)">+${fmt(y.cBlind)} no ETA</div>`:''}</td>
                <td class="mono">${y.ok?'<span class="chip ok">covered</span>'
                  :`<b style="color:var(--amb)">${fmt(y.cases)}</b> ${y.caseQty>1?`case${y.cases===1?'':'s'}`:'units'}`}</td>
              </tr>`).join('')}
              </tbody></table>
              ${multi?`<div class="pmeta" style="margin-top:7px">This is <b>${esc(x.name)} on its own</b>. Where a part is shared with
                another log, the order list below counts the stock once — use that to actually buy from.</div>`:''}`}
          </div>`:''}
        </div>`;}).join('')}
    </div>

    ${noList.length?`<div class="note bad" style="margin:0 0 10px"><b>${esc(noList.map(x=>x.name).join(', '))}
      ${noList.length===1?'has':'have'} no build list.</b> Nothing can be worked out for
      ${noList.length===1?'it':'them'} until the app knows what goes in — ${noList.length===1?'it is':'they are'}
      not counted in anything below.
      ${noList.map(x=>`<button class="btn sm warn" style="margin:7px 7px 0 0" onclick="LV3.editProduct('${x.id}')">Add parts to ${esc(x.name)}</button>`).join('')}</div>`:''}

    ${!plan.length?`<div class="panel"><div class="rsEmpty">
        <div class="rsEmT">Nothing to work out yet</div>
        <div class="rsEmB">None of the products picked have a build list.</div>
      </div></div>`
    :`${(()=>{
        /* Inline SVG, currentColor, no emoji and no image files — the icon has
           to theme with the card and survive with no network. The carton is
           drawn face-on so it can never be mistaken for the isometric cube. */
        const I={cart:'<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.3L21 7H6"/></svg>',
                 box:'<svg viewBox="0 0 24 24"><path d="M2.6 8.6h18.8v10.3a1.5 1.5 0 0 1-1.5 1.5H4.1a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M2.6 8.6 4.9 4.3A1.5 1.5 0 0 1 6.2 3.5h11.6a1.5 1.5 0 0 1 1.3.8l2.3 4.3"/><path d="M12 3.5v5.1"/><path d="M9.4 13.2h5.2"/></svg>',
                 coin:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M14.2 9.1a2.9 2.9 0 0 0-4.9 2.1V16h5.3"/><path d="M9 13h4.4"/></svg>',
                 cube:'<svg viewBox="0 0 24 24"><path d="M12 2.8 20.2 7v10L12 21.2 3.8 17V7z"/><path d="M3.8 7 12 11.4 20.2 7"/><path d="M12 11.4v9.8"/></svg>',
                 tick:'<svg viewBox="0 0 24 24"><path d="M9 5h6a1.6 1.6 0 0 1 1.6 1.6V7H7.4v-.4A1.6 1.6 0 0 1 9 5z"/><path d="M16.6 6.2H18a1.8 1.8 0 0 1 1.8 1.8v10.6A1.8 1.8 0 0 1 18 20.4H6A1.8 1.8 0 0 1 4.2 18.6V8A1.8 1.8 0 0 1 6 6.2h1.4"/><path d="m8.8 13.4 2.2 2.2 4.2-4.4"/></svg>'};
        const card=(cls,ico,val,lab,sub)=>`<span class="rsS ${cls}"><span class="rsIco">${ico}</span>
          <span class="rsTx"><b>${val}</b><em>${lab}</em><i>${sub}</i></span></span>`;
        /* the middle line is the metric's NAME. It was "roughly" on the money
           card (an adverb left over from an inline sentence) and bare unit
           words on the buy card, which only repeated the figure's own unit. */
        const buy=(!nCases&&!nLoose)?card('ok',I.box,'0','nothing to buy','every part is covered')
          :(nCases&&nLoose)?card('warn',I.box,fmt(nCases),'cases to buy','plus '+fmt(nLoose)+' loose units')
          :nCases?card('warn',I.box,fmt(nCases),'cases to buy',"rounded up — you can't buy part of a case")
          :card('warn',I.box,fmt(nLoose),'units to buy','none of these come in cases');
        return `<div class="rsSum">
        ${card(short.length?'bad':'ok',I.cart,short.length?fmt(short.length):'0',
               short.length?('component'+(short.length===1?'':'s')+' to order'):'nothing to order',
               short.length?('of '+fmt(plan.length)+' in this build'):('all '+fmt(plan.length)+' parts covered'))}
        ${buy}
        ${card('cash',I.coin,gbp(spend),'estimated spend','at what you last paid')}
        ${multi
          ? card(shared.length?'shared':'info',I.cube,fmt(shared.length),'shared parts','counted once, not once each')
          : card('info',I.cube,fmt(avail(picks[0]).n||0),'can build now','from backstock, of '+fmt(totalUnits)+' asked for')}

      </div>`;})()}
      <div class="panel">
        <div class="ph"><button class="rsChev" onclick="LV3.rsToggleTbl()"
            title="${RS_TBL?'Fold the order list away':'Open the order list'}">${RS_TBL?'&#9662;':'&#9656;'}</button>
          <span class="t">What to order${multi?` — all ${fmt(picks.length)} logs`:''}</span>
          <div class="r"><button class="btn sm" title="Copies part · units · cases · supplier, ready to paste into the Google Sheet" onclick="LV3.rsCopyList()">Copy for the sheet</button></div>
          <span class="sub">to build ${fmt(totalUnits)} unit${totalUnits===1?'':'s'}</span>
          ${short.length?`<span class="chip bad">${fmt(short.length)} to order</span>`:'<span class="chip ok">all covered</span>'}
          ${plan.some(x=>x.orderLate)?`<span class="chip bad">${fmt(plan.filter(x=>x.orderLate).length)} already late for the date</span>`:''}
          ${plan.some(x=>x.goal&&x.routeMissing&&!x.ok)?`<span class="chip warn">${fmt(plan.filter(x=>x.goal&&x.routeMissing&&!x.ok).length)} need a route set</span>`:''}
</div>
        ${!RS_TBL?'':`
        ${/* Nine columns for a five-column question. "In one" and "Case size" are
             facts about the part, so they sit with the part. "Still short" and
             "Order" were the same number twice whenever nothing came in cases. */''}
        <table class="rsTbl tight"><thead><tr>
          <th class="l">Component</th>${multi?'<th class="l">Needed by</th>':''}
          <th>Required<span>to build ${fmt(totalUnits)}</span></th>
          <th>In stock<span>available</span></th>
          <th>Buy<span>to order</span></th>
          ${plan.some(x=>x.goal)?'<th>Order by<span>to hit the date</span></th>':''}
        </tr></thead><tbody>
        ${plan.map(x=>{
          const per=x.from[0]?x.from[0].per:1;
          const spare=x.buying-x.shortfall;
          return `<tr class="${x.ok?'':'short'}">
          <td class="l"><span class="pname">${esc(x.c.name)}</span>
            <div class="pmeta">${x.kind}${multi?'':` · ×${fmt(per)} each`}${x.caseQty>1?` · case of ${fmt(x.caseQty)}`:' · singles'}${(function(){const s=compSupplier(x.c);return s?` · ${esc(s)}`:'';})()}${x.shared?' · <b style="color:var(--accent)">shared</b>':''}</div></td>
          ${multi?`<td class="l"><div class="rsFrom">${x.from.map(f=>
              `<span class="rsFromC" title="${esc(f.p.name)} — ${fmt(f.per)} each &times; ${fmt(f.qty)} = ${fmt(f.need)}">
                ${esc(f.p.name)}<b>${fmt(f.need)}</b></span>`).join('')}</div></td>`:''}
          <td class="mono b">${fmt(x.need)}</td>
          <td class="mono"><span style="color:${x.stock?'var(--text)':'var(--red)'}">${fmt(x.stock)}</span>
            ${x.coming?`<div class="pmeta" style="color:var(--blu)">+${fmt(x.coming)} due by ${dshort(x.cEta)}</div>`:''}
            ${x.cLate?`<div class="pmeta" style="color:var(--red)">+${fmt(x.cLate)} late — not counted</div>`:''}
            ${x.cBlind?`<div class="pmeta" style="color:var(--amb)">+${fmt(x.cBlind)} no ETA — not counted</div>`:''}</td>
          <td class="rsCases">${x.ok
            ? `<span class="chip ok">Covered</span><div class="pmeta">${x.coming&&x.stock<x.need?'once the '+dshort(x.cEta)+' order lands':'sufficient stock'}${x.goal&&x.coming&&x.stock<x.need?' — in time for the date':''}</div>`
            : `<span class="rsBig">${fmt(x.cases)}</span>
               <div class="pmeta">${x.caseQty>1?`case${x.cases===1?'':'s'} · ${fmt(x.buying)} units${spare>0?` · ${fmt(spare)} spare`:''}`:'units'}${(function(){const a=avgCostOf?avgCostOf(x.c):0;return (a&&x.buying)?` · <span style="color:var(--accent)">${gbp(a*x.buying)}</span>`:'';})()}</div>`}</td>
          ${plan.some(y=>y.goal)?`<td>${!x.goal||x.ok?'<span class="dim">—</span>'
            :x.routeMissing?'<span style="font-size:11.5px;color:var(--amb);font-weight:700">SET ROUTE</span><div class="pmeta">no lead time known</div>'
            :x.orderLate?`<span style="font-size:12px;color:var(--red);font-weight:800">ALREADY LATE</span><div class="pmeta">was ${dshort(x.orderBy)} — needs a faster route or a later date</div>`
            :`<span class="num b" style="color:${workDaysBetween(dayISO(),x.orderBy)<=5?'var(--amb)':'var(--text)'}">${dshort(x.orderBy)}</span><div class="pmeta">parts on the bench by ${dshort(x.arriveBy)}</div>`}</td>`:''}
        </tr>`;}).join('')}
        </tbody></table>
        <div class="pmeta" style="padding:9px 14px;border-top:1px solid var(--border)">
          <b>need &minus; what you have &minus; what is credibly on its way</b>${plan.some(x=>x.caseQty>1)?', divided by the case size and rounded up':''}.
          An order that is overdue or has no delivery date counts for <b>nothing</b> here — it is shown in red or amber on its row instead of quietly promising stock that may never come.
          ${multi?'Stock and on-order count <b>once per part</b>, not once per product — that is the point of keeping several logs.':''}
        </div>`}
      </div>`}`;
}
/* Walk the shortages one at a time rather than making the person hunt down the
   row again after each order form closes. */
function rsLogAll(){
  const short=restockPlanMulti().filter(x=>!x.ok);
  if(!short.length){toast('Nothing needs ordering','ok');return;}
  _rsQueue=short.map(x=>x.c.id);
  rsNextOrder();
}
let _rsQueue=[];
function rsNextOrder(){
  const id=_rsQueue.shift();
  if(!id){toast('That is every part done','ok');render();return;}
  openLogOrder(id);
}

function lavLateCount(){
  try{return lavLateList().length;}catch(e){return 0;}
}
/* Jack, 4 Sep: "this should be on Sarah's sheet — all late on the prep hub
   sheet and any issues should go on hers too." An overdue Lavarion delivery was
   a purple banner she had to click through; it is a supplier who has not
   delivered, which is exactly her job. Exposed as data so her queue can list it
   as a row like everything else. */
function lavLateList(){
  try{
    return inboundAll().filter(x=>!x.l.short&&etaState(x.l).k==='late').map(x=>{
      const owed=outQty(x.l)||0;
      /* Jack, 8 Sep: "hold the account from the Lavarion sheet too — Sarah and I
         need to know which account, Becki doesn't." The batch remembers which
         purchase it came from, and the purchase carries the sheet's Account. */
      const _pu=(D.purchases||[]).find(p=>('P:'+p.id)===x.l.src)||(x.l.oid?(D.purchases||[]).find(p=>p.oid===x.l.oid):null);
      return{key:String(x.kind)+':'+String(x.o.id)+':'+String(x.l.id),
        kind:x.kind,oid2:String(x.o.id),lid:String(x.l.id),toJack:x.l.lateToJack||'',toSarah:x.l.lateToSarah||'',
        acct:(_pu&&_pu.acct)||'',
        name:x.o.name||'',sup:x.l.sup||'',oid:x.l.oid||'',
        owed,cost:(x.l.cost||0)*owed,
        ordered:x.l.date||'',eta:String(x.l.eta2||x.l.eta1||'').slice(0,10),
        days:x.l.date?Math.max(0,Math.floor((Date.now()-new Date(x.l.date).getTime())/864e5)):0};
    });
  }catch(e){return [];}
}
let _acOnly='';
function acOnly(b){_acOnly=(_acOnly===b)?'':b;render();}
function ppGo(id){
  const e=document.getElementById(id);
  if(e){e.scrollIntoView({behavior:'smooth',block:'start'});
    e.style.transition='box-shadow .5s';e.style.boxShadow='0 0 0 2px var(--accent)';
    setTimeout(()=>{e.style.boxShadow='';},1200);}
  else toast('Nothing there right now — that stage is empty','ok');
}
function vPurchases(){
  const unl=D.purchases.filter(p=>['none','broken'].includes(allocState(p).k));
  const part=D.purchases.filter(p=>allocState(p).k==='part');
  const rows=D.purchases
    .filter(p=>uFilter==='all'||(uFilter==='todo'?allocState(p).k==='none':uFilter==='part'?allocState(p).k==='part':allocState(p).k==='full'||allocState(p).k==='split'))
    .filter(p=>!Q||(p.name+p.sup+p.oid).toLowerCase().includes(Q))
    .slice().sort((a,b)=>b.date.localeCompare(a.date));
  const done=D.purchases.filter(p=>['full','split'].includes(allocState(p).k)).length;
  const spend=D.purchases.reduce((s,p)=>s+(p.spend||p.price*p.qty),0);
  /* A purchase has a life: it arrives from the sheet, someone says what it is,
     it sits on order, then it lands. Four unrelated tiles hid that. This is the
     same journey left to right, and each step jumps to the panel that handles it. */
  const inb=inboundAll().filter(x=>!x.l.short);   /* shorts have their own stage */
  const shorts=shortLines();
  const orders=reviewOrders();
  const recent=D.purchases.filter(p=>allocState(p).k!=='none').length;
  const step=(k,v,s,col,go,alert)=>`<div class="ppStep ${alert?'alert':''}" onclick="LV3.${go}">
    <div class="k">${k}</div><div class="v" ${col?`style="color:${col}"`:''}>${v}</div><div class="s">${s}</div></div>`;
  $('lav3View').innerHTML=`
  <div class="ppStack">
  <div class="ppFlow">
    ${step('To review',fmt(orders.length),orders.length?`${fmt(orders.reduce((t,o)=>t+o.lines.length,0))} lines · ${gbp(orders.reduce((t,o)=>t+o.value,0))}`:'all linked',
      orders.length?'var(--amb)':'var(--text3)',"ppGo('revPanel')",orders.length)}
    <span class="ppArrow">→</span>
    ${step('On order',fmt(inb.length),inb.length?`${fmt(inb.reduce((t,x)=>t+x.l.qty,0))} units on the way`:'nothing outstanding',
      inb.length?'var(--blu)':'var(--text3)',"ppGo('onOrderPanel')",0)}
    <span class="ppArrow">→</span>
    ${step('Received',fmt(recent),'linked and accounted for','var(--grn)',"ppGo('arrivedPanel')",0)}
    ${shorts.length?`<span class="ppArrow">·</span>
      ${step('Short',fmt(shorts.length),`${fmt(shorts.reduce((t,x)=>t+x.l.qty,0))} units never arrived`,'var(--red)',"ppGo('shortPanel')",1)}`:''}
  </div>
  <div class="panel" style="border-left:3px solid var(--accent);display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:11px 14px;">
    <button class="btn pri" id="purchSyncTop" onclick="LV3.syncPurchases()" style="font-size:13px;padding:9px 18px;">Sync the purchase sheet</button>
    <span style="flex:1;min-width:260px;font-size:12px;color:var(--text2);" id="purchSyncNoteTop">${_syncMsg||`Reads <b>${esc(LAV_TABS.join(', '))}</b> from ${dshort(D.settings.purchFrom||'2026-08-01')} onwards — new lines land in <b>To review</b> below, ready to link.`}</span>
    <button class="btn sm" onclick="if(!_purchAll)LV3.togglePurchAll();setTimeout(function(){var e=document.getElementById('allPurch');if(e)e.scrollIntoView({behavior:'smooth'});},60);">All ${fmt(D.purchases.length)} lines</button>
  </div>
  ${/* the panels follow the strip's journey: review it, receive it, buy what's
        next, then the problems and the paperwork */''}
  ${reviewPanel()}
  ${deliveriesPanel()}
  ${buyPanel()}
  ${shortPanel()}
  ${damagedPanel()}
  ${notesPanel()}
  ${dupPanel()}
  ${historyPanel()}
  <div class="panel" id="allPurch">
    <div class="ph">
      <span class="t">Every purchase line</span>
      <span class="sub">${fmt(D.purchases.length)} from the sheet · ${gbp(spend)} inc VAT</span>
      <button class="btn sm" onclick="LV3.togglePurchAll()">${_purchAll?'Hide':'Show'}</button>
      <div class="r"><input class="srch" placeholder="Search purchases…" value="${esc(Q)}" oninput="LV3.setQ(this.value)"></div></div>
    ${_purchAll?`<div class="ph" style="border-top:1px solid var(--border)">
      <div class="seg">${[['all','All',D.purchases.length],['todo','To allocate',unl.length],['part','Part done',part.length],['done','Allocated',done]]
        .map(([k,l,n])=>`<button class="${uFilter===k?'on':''}" onclick="LV3.setFilter('u','${k}')">${l}<span class="cnt">${fmt(n)}</span></button>`).join('')}</div></div>`:''}
    <div style="padding:9px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2)" id="purchSyncNote">${_syncMsg||`Reads <b>${esc(LAV_TABS.join(', '))}</b> from ${dshort(D.settings.purchFrom||'2026-08-01')} onwards. Nothing becomes stock until someone links it below.`}</div>
    ${!_purchAll?'':rows.length?`<table><thead><tr>
      <th class="l" style="width:82px">Date</th><th class="l" style="width:250px">Name on sheet</th><th style="width:66px">Qty</th>
      <th style="width:86px">Buy price</th><th class="l" style="width:140px">Supplier</th><th style="width:104px">Arrived</th>
      <th class="l" style="width:250px">Allocated to</th><th class="acts" style="width:158px"></th>
    </tr></thead><tbody>
    ${rows.map(p=>{
      const st=allocState(p),als=allocOf(p),wait=Math.floor((TODAY-new Date(p.date))/864e5),stale=!p.arr&&wait>=21;
      const sug=st.k==='none'?suggestFor(p):null;
      return `<tr>
        <td class="l mono" style="font-size:12px;color:var(--text2)">${dshort(p.date)}</td>
        <td class="l"><div class="pname">${esc(p.name)}</div><div class="pmeta">${esc(p.oid)}</div></td>
        <td class="mono" style="font-weight:500">${fmt(p.qty)}</td>
        <td class="mono">${gbp(p.price)}</td>
        <td class="l" style="font-size:12px;color:var(--text2)">${esc(p.sup)}</td>
        <td>${p.arr?'<span class="chip ok">Arrived</span>':`<span class="chip ${stale?'bad':'info'}">${stale?wait+'d waiting':'On order'}</span>`}</td>
        <td class="l">${als.length?als.map(a=>{const t=targetOf(a.to);
            return `<div style="display:flex;gap:7px;align-items:baseline;margin-bottom:2px">
              <span class="mono" style="font-size:12px;color:var(--text2)">${fmt(a.qty)}</span>
              <span style="font-size:12.5px">${t?esc(t.name):'<i style="color:var(--red)">missing</i>'}</span>
              ${t&&prod(a.to)?'<span class="chip" style="font-size:10px">product</span>':''}</div>`;}).join('')
            +(unalloc(p)?`<div class="pmeta" style="color:var(--amb)">${fmt(unalloc(p))} still unallocated</div>`:'')
          :`<span class="chip ${st.chip}">${st.label}</span>
            ${sug?`<span class="sug" onclick="LV3.quickLink('${p.id}','${sug.id}')" title="One click to allocate all ${fmt(p.qty)} — ${sug.why}">→ ${esc((targetOf(sug.id)||{}).name||'')}</span>`:''}`}</td>
        <td class="acts"><button class="btn sm ${st.k==='none'?'pri':''}" onclick="LV3.openLink('${p.id}')">${st.k==='none'?'Allocate':'Change'}</button>
          <button class="btn sm dgr" title="Take this line off the hub and stop the sync bringing it back. The Purchase Sheet is not touched, and it can be put back from Settings." onclick="LV3.killPurch('${p.id}')">Ignore</button></td></tr>`;}).join('')}
    </tbody></table>`:`<div class="empty">${D.purchases.length?'Nothing in this view.':'No purchase rows yet.<div class="pmeta" style="margin-top:8px">Rows appear here once the sheet is synced — Lavarion Q1&ndash;Q4.</div>'}</div>`}
  </div>
  <div class="note info">Nothing is ever linked for you. Sheet names won't always match ("Dove MD Tanning Lotion 75ml" vs "Dove MD 75"), so you decide where every unit goes and can change it whenever things move around.<br>
  <b>A part used in several bundles only needs one allocation</b> — put the whole purchase on that component and every bundle draws from the same pool. Split a purchase only when the units genuinely go to <i>different</i> things.</div>
  </div>`;
}
/* THE OVERRIDE. Anything that keeps coming back off the sheet can be killed
   from here by hand, without waiting for someone to work out which code path
   forgot to write a tombstone. Same store the sync already checks, same list
   in Settings, same "Put it back" if it was a mistake. Nothing is deleted from
   the Purchase Sheet — this only stops the hub asking about it. */
function killPurch(pid){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  const als=allocOf(p)||[];
  confirmBox('Ignore this purchase line?',
    `<div style="margin-bottom:10px"><b>${esc(p.name)}</b> — ${fmt(p.qty)} @ ${gbp(p.price)} from <b>${esc(p.sup||'supplier')}</b> on ${dshort(p.date)}.</div>
     <div class="pmeta" style="margin:0 0 8px">It comes off the hub and the sync will not bring it back, however many times the sheet is read. The Purchase Sheet itself is untouched.</div>
     ${als.length?`<div class="pmeta" style="margin:0;color:var(--amb)"><b>This line is allocated.</b> Ignoring it removes ${fmt(p.qty)} unit${p.qty===1?'':'s'} of stock that ${als.map(a=>esc((targetOf(a.to)||{}).name||'something')).join(', ')} ${als.length===1?'is':'are'} built from.</div>`
       :`<div class="pmeta" style="margin:0">Nothing is allocated to it, so no stock moves.</div>`}
     <div class="pmeta" style="margin:8px 0 0">You can put it back any time from <b>Settings → Sheet lines being ignored</b>.</div>`,
    ()=>{
      snap();
      killPurchLine(p,'ignored by hand');
      const i=D.purchases.findIndex(x=>x.id===pid);
      if(i>=0)D.purchases.splice(i,1);
      logIt('edit',`Ignored a purchase line by hand — “${p.name}” ${dshort(p.date)} from ${p.sup||'supplier'} — the sync will skip it`);
      save();render();
      toastUndo('Ignored — the sync will not bring it back','ok');
    },{danger:true,ok:'Yes, ignore it'});
}
function quickLink(pid,to){
  const p=D.purchases.find(x=>x.id===pid);
  if(!p)return;
  if(dupTwin(p)){toast('This is a leftover copy of a line already on order — remove it instead of linking it','er');return;}
  snap();rememberAlias(p.name,to);setAlloc(p,[{to,qty:p.qty}]);
  render();toastUndo(`All ${fmt(p.qty)} allocated to ${(targetOf(to)||{}).name}`,'ok');
}
/* same thing without the snapshot/toast, for accepting a batch of suggestions */
function quickLinkSilent(pid,to){
  const p=D.purchases.find(x=>x.id===pid);
  if(p&&dupTwin(p))return false;             /* a leftover copy is never linked */
  if(p){rememberAlias(p.name,to);setAlloc(p,[{to,qty:p.qty}]);}
  return !!p;
}
/* rebuild the stock batches this purchase created — always from scratch, so
   changing an allocation can never leave orphaned stock behind */
/* Which way stock from this supplier usually travels. Saved per supplier the
   first time someone corrects it, so it only has to be taught once. */
/* Some suppliers genuinely have no usual route. Jack, 29 Aug: Alibaba goes air,
   rail OR sea depending on the order, so guessing "sea" quietly dates it five
   to ten weeks out when it might be three. ASK_MODE means: no default, the
   person logging the order picks — and nothing is dated until they do. */
/* The line under the method dropdown. Either "this supplier has no usual
   route, pick one", or — once a method is chosen and it differs from the
   supplier's saved default — a one-click way to make it the default. The
   decision gets made here, looking at a real order, instead of two thousand
   pixels down a settings page. */
function modeHint(l,needsPick){
  const sup=(l.sup||'').trim();
  if(needsPick&&!supplierAsks(sup)){
    /* Jack, 3 Sep: this was a paragraph, repeated on every row, and it was the
       single biggest thing making the table tall. The dropdown next to it
       already says "pick how it's coming"; this only has to say why. */
    return '<div class="pmeta" style="margin:3px 0 0;color:var(--amb)" title="Nobody has said how '
      +esc(sup||'this supplier')+' sends things, so the dates are worked out from a guess. Pick once and every future order from them is dated automatically."><b>Not confirmed</b> &mdash; dates are a guess</div>';
  }
  if(needsPick)
    return '<div class="pmeta" style="margin:3px 0 0;color:var(--amb)">'
      +esc(sup||'this supplier')+' uses more than one route — pick one and it will date itself</div>';
  if(!l.mode||!sup)return '';
  const key=sup.toLowerCase();
  /* HARD RULE (Jack, 30 Aug): Alibaba freight is chosen per order when it is
     synced — never remembered, never offered as a future default. The saved
     route stays for PLANNING maths only. */
  if(/alibab/i.test(sup))return '';
  const saved=(D.settings.supplierModes||{})[key];
  if(saved===ASK_MODE)return '';
  const label=((shipMode(l.mode)||{}).label||l.mode).split('—')[0].trim();
  const on=saved===l.mode;
  return '<div class="pmeta" style="margin:3px 0 0">'
    +'<label style="cursor:pointer;display:inline-flex;gap:5px;align-items:center;" onclick="event.stopPropagation()"'
    +' title="'+(on?('Confirmed'+(supplierModeBy(sup)?' by '+esc(supplierModeBy(sup).by)+' on '+dshort(supplierModeBy(sup).on):'')+' — every order from '+esc(sup)+' is dated as '+esc(label)+' automatically. Untick to stop that.'):('Tick it and every future order from '+esc(sup)+' is dated as '+esc(label)+' automatically'))+'">'
    +'<input type="checkbox" '+(on?'checked':'')
    +' onchange="LV3.setSupplierMode(&quot;'+esc(key)+'&quot;,this.checked?&quot;'+esc(l.mode)+'&quot;:&quot;&quot;)">'
    +'<span style="color:'+(on?'var(--grn)':'var(--blu)')+'">'+(on?'&#10003; always for '+esc(sup):'always for '+esc(sup))+'</span></label>'
    +'</div>';
}
const ASK_MODE='__ask';
const supplierAsks=sup=>((D.settings.supplierModes||{})[(sup||'').toLowerCase().trim()])===ASK_MODE;
/* Jack, 2 Sep: a supplier nobody has answered for showed "Courier / parcel" as
   if somebody had chosen it. A guess must LOOK like a guess. Confirmed means a
   person saved a route for this supplier (any route, including "ask me"). */
const supplierConfirmed=sup=>{const k=(sup||'').toLowerCase().trim();return !!k&&Object.prototype.hasOwnProperty.call(D.settings.supplierModes||{},k);};
const supplierModeBy=sup=>((D.settings.supplierModesBy||{})[(sup||'').toLowerCase().trim()])||null;
/* Does this line still need a person to say how it is coming? ASK suppliers:
   until this line has a mode. Everyone else: until the supplier is confirmed. */
const lineNeedsRoute=l=>!l.arr&&!l.writtenOff&&(supplierAsks(l.sup)?!l.mode:!supplierConfirmed(l.sup));
function routeAsks(){
  const lines=[],sups={};
  D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{
    if(!lineNeedsRoute(l))return;
    if(!(parseInt(l.qty)||0)&&!(parseInt(l.ord)||0))return;
    lines.push(l);const k=(l.sup||'—').trim();sups[k]=(sups[k]||0)+1;}));
  return {lines,sups:Object.keys(sups).sort((a,b)=>sups[b]-sups[a])};
}
function guessMode(sup){
  const s=(sup||'').toLowerCase().trim();
  const learned=(D.settings.supplierModes||{})[s];
  if(learned===ASK_MODE)return '';        // deliberately unanswered
  if(learned)return learned;
  if(/alibaba|aliexpress|temu|1688|dhgate|shein/.test(s))return 'sea';
  if(/amazon|ebay|superdrug|boots|tesco|asda|savers|wilko|argos|home ?bargains|b&m/.test(s))return 'courier';
  if(/wholesal|direct|supplies|trading|cash ?and ?carry|stax/.test(s))return 'road';
  return 'courier';
}
/* Every supplier the hub has ever seen, with the method it uses. Superdrug is
   always a courier and Alibaba is always sea freight, so the expected window
   should never have to be typed twice for the same supplier — set it once here
   and every future order from them is dated automatically. */
function knownSuppliers(){
  const seen={};
  /* "Opening stock" is the stocktake, not somebody who ships to us */
  const notReal=/^(opening stock|stock (correction|adjustment|adjust)|stocktake|—|-|n\/a|unknown)$/i;
  const add=n=>{const k=(n||'').trim();if(!k||notReal.test(k))return;const lk=k.toLowerCase();
    if(!seen[lk])seen[lk]={name:k,key:lk,orders:0};seen[lk].orders++;};
  D.purchases.forEach(p=>add(p.sup));
  D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>add(l.sup)));
  Object.keys(D.settings.supplierModes||{}).forEach(k=>{if(!seen[k])seen[k]={name:k,key:k,orders:0};});
  return Object.values(seen).sort((a,b)=>b.orders-a.orders||a.name.localeCompare(b.name));
}
/* Changing a supplier's method re-dates everything still on order from them
   that nobody has typed a date on — the whole point of setting it. */
function setSupplierMode(key,mode){
  D.settings.supplierModes=D.settings.supplierModes||{};
  if(mode)D.settings.supplierModes[key]=mode; else delete D.settings.supplierModes[key];
  savePrefs();
  const m=shipMode(mode)||null;
  let touched=0;
  D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{
    if(l.arr||l.writtenOff||l._etaTouched)return;
    if((l.sup||'').toLowerCase().trim()!==key)return;
    if(mode===ASK_MODE){l.mode='';l.eta1='';l.eta2='';delete l._etaGuess;touched++;return;}
    l.mode=mode||guessMode(l.sup);
    const mm=shipMode(l.mode);if(!mm||!l.date)return;
    const add=n=>{const x=new Date(l.date);x.setDate(x.getDate()+n);
      return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
    l.eta1=add(mm.lo);l.eta2=add(mm.hi);l._etaGuess=1;touched++;
  }));
  save();
  if(TAB==='settings'){
    /* no repaint: a full render resets this panel's own scrollbar AND re-sorts
       the row out from under the cursor — the two things that made editing
       here miserable. The select already shows the new value on its own. */
    const c=document.getElementById('supSetCount');
    if(c)c.textContent=`${fmt(knownSuppliers().length)} suppliers · ${fmt(Object.keys(D.settings.supplierModes||{}).length)} set by hand`;
  }else{
    _keepScroll(render);
  }
  toast(touched?`${fmt(touched)} order${touched===1?'':'s'} re-dated`:'Saved','ok');
}
/* answering one dropdown used to hurl the page back to the top — remember the
   scroll, repaint, put it back */
function _keepScroll(fn){
  const el=document.getElementById('page-lavarion');
  const t=el?el.scrollTop:0;
  fn();
  if(el)requestAnimationFrame(()=>{el.scrollTop=t;});
}
let _supQ='',_supAll=false;
function supFind(v){_supQ=v||'';_keepScroll(render);}
function supToggleAll(){_supAll=!_supAll;_keepScroll(render);}
/* How often the mixed-COG block gets overridden, and why. A control nobody can
   audit is not a control — if one reason dominates, that is a process problem to
   fix rather than a button to keep pressing. */
function overridePanel(){
  const list=D.settings.overrides||[];
  if(!list.length)return '';
  const by={};
  list.forEach(o=>{const k=o.k||'other';(by[k]=by[k]||{n:0,units:0,label:(OV_REASONS.find(r=>r[0]===k)||[])[1]||k}).n++;by[k].units+=o.units||0;});
  const ranked=Object.entries(by).sort((a,b)=>b[1].n-a[1].n);
  const last30=list.filter(o=>daysSince(o.on)<=30).length;
  return `<div class="panel">
    <div class="ph"><span class="t">Mixed-cost overrides</span>
      <span class="sub">${fmt(list.length)} recorded · ${fmt(last30)} in the last 30 days</span>
      ${last30>=5?`<span class="chip bad">happening often</span>`:''}</div>
    <div style="padding:12px">
      <div class="pmeta" style="margin-bottom:10px">Every time the block was overridden and a shipment went out with two
        costs averaged. A handful is normal. A pattern means something upstream needs fixing, not a button pressing.</div>
      <div class="ovBars">
        ${ranked.map(([k,v])=>`<div class="ovBar">
          <span class="ovL">${esc(v.label)}</span>
          <span class="ovTrack"><span class="ovFill" style="width:${Math.round(v.n/list.length*100)}%"></span></span>
          <span class="ovN">${fmt(v.n)}</span></div>`).join('')}
      </div>
      <div class="dsec" style="margin-top:14px"><span class="lab">Most recent</span></div>
      <table><thead><tr><th>When</th><th class="l">Shipment</th><th class="l">Product</th><th>Units</th><th class="l">Reason</th><th class="l">Who</th></tr></thead><tbody>
      ${list.slice(0,12).map(o=>`<tr>
        <td class="mono">${dshort(o.on)}</td>
        <td class="l mono">${esc(o.shipId||'—')}</td>
        <td class="l">${esc(o.prod||'—')}</td>
        <td class="mono">${fmt(o.units||0)}</td>
        <td class="l">${esc(o.why||'—')}</td>
        <td class="l">${esc(o.by||'—')}</td></tr>`).join('')}
      </tbody></table>
    </div></div>`;
}
function supplierPanel(){
  const sups=knownSuppliers();
  if(!sups.length)return '';
  const modes=shipModes();
  const set=Object.keys(D.settings.supplierModes||{}).length;
  /* A hundred suppliers is a scroll, not a settings page. Show the ones that
     have been set by hand plus the busiest handful; everything else is one
     search away. */
  const q=_supQ.toLowerCase().trim();
  const setKeys=D.settings.supplierModes||{};
  /* NOT-TOUCHED-YET FIRST (Jack, 30 Aug: "sort by newest or not touched yet")
     — the unset ones are the actual work, busiest first so a new supplier off
     the sheet surfaces immediately; then ask-every-time; then the done ones,
     quickest route first. All 27 shown — hiding rows hid the job. */
  /* spelling drift ("Alibab", "Fre From direct") must not show as untouched
     work — the engine already routes those through their twin, so the panel
     says so instead of asking UK staff to set them again. Same squash +
     one-typo matching routeDaysFor uses. */
  const _sq2=x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,'');
  const _lv2=(a,b)=>{if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
    if(a.length<6||b.length<6)return false;
    let i=0,j=0,d=0;
    while(i<a.length&&j<b.length){
      if(a[i]===b[j]){i++;j++;continue;}
      d++;if(d>1)return false;
      if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
    return d+(a.length-i)+(b.length-j)<=1;};
  const _smk=Object.keys(setKeys);
  const _twin={};
  sups.forEach(x=>{
    if(setKeys[x.key])return;
    const sq=_sq2(x.key);
    const hit=_smk.find(k=>_sq2(k)===sq)||_smk.find(k=>_lv2(_sq2(k),sq));
    if(hit)_twin[x.key]=hit;
  });
  const _twinNm=k=>{const y=sups.find(z=>z.key===k);return y?y.name:k;};
  const _effMode=x=>setKeys[x.key]||(_twin[x.key]?setKeys[_twin[x.key]]:null);
  const _band=x=>{
    const m=_effMode(x);
    if(!m)return 0;
    if(m===ASK_MODE)return 1;
    return 2;
  };
  const _spd=x=>{const d=modeDays(_effMode(x));return d?d.hi:999;};
  const filtered=(q?sups.filter(x=>x.name.toLowerCase().includes(q)):sups.slice())
    .sort((a,b)=>_band(a)-_band(b)||( _band(a)===2?(_spd(a)-_spd(b)):(b.orders-a.orders))||a.name.localeCompare(b.name));
  const hidden=0;
  const _spCol=x=>{
    const m=_effMode(x);
    if(m===ASK_MODE)return '#c084fc';
    if(!m)return '#7d7568';
    const d=modeDays(m);if(!d)return '#7d7568';
    return d.hi<=2?'#4ade80':d.hi<=6?'#60a5fa':d.hi<=15?'#fbbf24':d.hi<=60?'#fb923c':'#f87171';
  };
  return `<div class="panel" id="supPanel">
    <div class="ph"><span class="t">Who ships how</span>
      <span class="sub" id="supSetCount">${fmt(sups.length)} supplier${sups.length===1?'':'s'} · ${fmt(set)} set by hand</span>
      <div class="r"><input class="in" style="width:220px" placeholder="Search suppliers…" value="${esc(_supQ)}"
        oninput="LV3.supFind(this.value)"></div></div>
    <div style="padding:12px">
      <div class="pmeta" style="margin-bottom:9px">Set a supplier's method once and every order from them is dated
        automatically — the ones already on order get re-dated too, unless someone typed a date on them.</div>
      <div class="supGrid">
        ${filtered.map(x=>{
          const cur=(D.settings.supplierModes||{})[x.key]||'';
          const auto=guessMode(x.name);
          return `<div class="supRow" style="border-left:3px solid ${_spCol(x)};padding-left:10px;">
            <div class="supNm" style="font-weight:700;">${esc(x.name)}<div class="pmeta">${x.orders?`${fmt(x.orders)} order${x.orders===1?'':'s'}`:'no orders yet'}${_twin[x.key]?` · <span style="color:var(--blu)" title="Spelling twin — the engine already treats this as ${esc(_twinNm(_twin[x.key]))}. Fix the name on the sheet when convenient.">same as ${esc(_twinNm(_twin[x.key]))}</span>`:''}</div></div>
            <select class="in" onchange="LV3.setSupplierMode('${esc(x.key).replace(/'/g,"\\'")}',this.value)">
              <option value="">Work it out (${esc((modes.find(m=>m.k===auto)||{label:auto}).label.split('—')[0].trim())})</option>
              <option value="${ASK_MODE}" ${cur===ASK_MODE?'selected':''}>Ask every time — no usual route</option>
              ${modes.map(m=>`<option value="${m.k}" ${cur===m.k?'selected':''}>${esc(m.label.split('—')[0].trim())} · ${m.lo}–${m.hi}d</option>`).join('')}
            </select></div>`;}).join('')}
      </div>
      ${!q&&hidden>0?`<div style="text-align:center;padding:9px 0 0">
        <button class="btn sm" onclick="LV3.supToggleAll()">${_supAll?'Show fewer':`Show all ${fmt(sups.length)} — ${fmt(hidden)} more`}</button></div>`:''}
      ${q&&!filtered.length?`<div class="pmeta" style="padding:8px 2px">No supplier matches “${esc(_supQ)}”.</div>`:''}
    </div>
  </div>`;
}
function rememberMode(sup,mode){
  const s=(sup||'').toLowerCase().trim();if(!s)return;
  D.settings.supplierModes=D.settings.supplierModes||{};
  D.settings.supplierModes[s]=mode;
  D.settings.supplierModesBy=D.settings.supplierModesBy||{};
  D.settings.supplierModesBy[s]={by:(window.currentUserName||'').trim()||'UK staff',on:dayISO()};
  savePrefs();
}
/* Repair pass. A dead allocation is nearly always repairable: the component it
   meant still exists under the same name, it just has a different id now. Match
   on the exact name first, then on the name the purchase carries, and re-point
   it. Anything that cannot be matched is left broken ON PURPOSE so it shows up
   in the review queue rather than being quietly guessed at. */
/* ── HEALTH CHECK ────────────────────────────────────────────────────────────
   Every bug that has cost us a day here had the same shape: the app was quietly
   wrong and looked fine. A purchase said Linked with no stock behind it. A batch
   was booked in with no price and COG came out confidently too low. A build list
   pointed at a component that had been deleted. None of them threw an error and
   none of them showed on screen.
   So: one pass, every load, over everything that can be silently inconsistent —
   and a red banner that will not go away until it is dealt with. */
function healthCheck(){
  const issues=[];
  /* Not everything deserves red. Red is for something quietly wrong with the
     numbers — a cost that cannot be worked out, a product that can never be
     built. Amber is for work waiting: a link to re-point, a shortfall to decide.
     Red used to mean "five names do not match", which is how a warning becomes
     wallpaper. */
  /* btn: what the button is about to do, in its own words. "Repair" on every
     single issue told you nothing about what was going to happen. */
  const add=(k,n,label,detail,go,fix,sev,btn)=>{if(n>0)issues.push({k,n,label,detail,go,fix,sev:sev||'warn',btn:btn||'Repair'});};

  const dupes=staleDupes();
  const dupIds=new Set(dupes.map(x=>x.p.id));
  add('dupe',dupes.length,
    `${fmt(dupes.length)} leftover cop${dupes.length===1?'y':'ies'} of a purchase you already have`,
    `${esc(dupes.slice(0,4).map(x=>x.p.name).join(', '))}${dupes.length>4?` +${dupes.length-4} more`:''} —
     same day, same quantity, same price, same supplier as one already on order. A rename on the sheet used to leave
     these behind. <b>Do not link them</b> — that would book stock you never bought. Remove them instead.`,
    "showReview()",'LV3.dropDupes()','warn');

  /* leftovers are excluded here so the same row is not offered as both
     "match it" and "delete it" — one of those answers is wrong */
  const broken=D.purchases.filter(p=>(p.alloc||[]).length&&(p.alloc||[]).some(a=>!targetOf(a.to))&&!dupIds.has(p.id));
  add('links',broken.length,
    `${fmt(broken.length)} purchase${broken.length===1?'':'s'} ${broken.length===1?'is':'are'} not showing as on order`,
    `${esc(broken.slice(0,4).map(p=>p.name).join(', '))}${broken.length>4?` +${broken.length-4} more`:''}.
     Somebody said what these were, but the part they were pointed at has since changed, so the stock never appeared.
     <b>Repair</b> tries to match them back up by name. Anything it cannot match goes to <b>Purchases → To review</b> for you to pick by hand.`,
    "showReview()",'LV3.fixHealth(\'links\')','warn');

  const ghosts=ghostAllocs();
  add('ghost',ghosts.length,
    `${fmt(ghosts.length)} purchase${ghosts.length===1?'':'s'} say linked but their stock does not exist`,
    `${esc(ghosts.slice(0,4).map(p=>p.name).join(', '))}${ghosts.length>4?` +${ghosts.length-4} more`:''} —
     the link is fine but the stock it should have created is missing, so nothing shows on order. Repair rebuilds it.`,
    "showReview()",'LV3.fixHealth(\'links\')','bad');

  /* A missing sales figure is not a wrong number, so it is never red — but it
     does stop a target being worked out, which is work waiting on somebody. */
  if(HUB.state==='ok'){
    const rv=hubReview(),n=rv.missing.length+rv.blank.length;
    add('sales',n,
      `${fmt(n)} product${n===1?' has':'s have'} no sales figure for ${ymName(rv.cur)}`,
      `${esc(rv.missing.concat(rv.blank).slice(0,4).map(x=>x.p.name).join(', '))}${n>4?` +${n-4} more`:''}.
       The hub's monthly report has no units against ${n===1?'it':'them'}, so ${n===1?'it has':'they have'} no ${D.settings.targetDays||60}-day target.
       Usually the hub knows the product under a different ASIN — point it at the right one, or mark it as not selling yet.`,
      "openHubReview()",'LV3.openHubReview()','warn','Review them');

    /* This one IS red: the figures on screen are wrong, not merely missing. */
    const cl=hubClashes();
    add('salesClash',cl.length,
      `${fmt(cl.length)} sales link${cl.length===1?'':'s'} ${cl.length===1?'points':'point'} two products at the same ASIN`,
      `${esc(cl.slice(0,3).map(c=>c.list.map(p=>p.name).join(' + ')).join('; '))}${cl.length>3?` +${cl.length-3} more`:''}.
       They are both reading one product's units, so both their ${D.settings.targetDays||60}-day targets are built on sales only one of them made.
       Open the review and point the wrong one somewhere else, or mark it as not selling yet.`,
      "openHubReview()",'LV3.openHubReview()','bad','Review them');
  }
  const M_=hubMonth();
  add('salesLate',M_.status==='late'?1:0,
    `Sales are still showing ${ymName(M_.ym)}`,
    `${ymName(M_.want)} has not been written up in the BDL hub yet, so every target on the Products page is
     working off month-old sales. Nothing here is wrong — it is just behind. Once the hub's monthly report is done it comes in on its own.`,
    "go('products')",'LV3.hubRefresh()','warn','Read the hub again');
  add('salesOff',(M_.status==='off'||M_.status==='none')?1:0,
    `No sales figures — the BDL hub did not answer`,
    `Without last month's units there are no targets and the order plan cannot work anything out.
     ${esc(HUB.err||'')} Try again; if it keeps failing the hub itself may be down.`,
    "go('products')",'LV3.hubRefresh()','warn','Try again');

  const deadParts=[];
  D.products.forEach(p=>(p.recipe||[]).forEach(r=>{if(!comp(r.c))deadParts.push(p);}));
  const dp=[...new Set(deadParts)];
  add('recipe',dp.length,
    `${fmt(dp.length)} build list${dp.length===1?'':'s'} point at a deleted component`,
    `${esc(dp.slice(0,3).map(x=>x.name).join(', '))}${dp.length>3?` +${dp.length-3} more`:''} — those products can never be costed or built.`,
    "go('products')",'','bad');

  const noPrice=[];
  D.components.concat(D.products).forEach(o=>{
    if(o.kind==='packaging')return;                 // £0 packaging is correct
    if((o.layers||[]).some(l=>l.arr&&l.rem>0&&!(l.cost>0)))noPrice.push(o);});
  add('price',noPrice.length,
    `${fmt(noPrice.length)} thing${noPrice.length===1?'':'s'} hold stock with no price on it`,
    `${esc(noPrice.slice(0,3).map(x=>x.name).join(', '))}${noPrice.length>3?` +${noPrice.length-3} more`:''} — COG cannot be worked out until the batch has a cost.`,
    "go('components')",'','bad');

  const sl=(typeof shortLines==='function')?shortLines():[];
  const decide=sl.filter(x=>shortState(x.l).k==='decide');
  const noreply=sl.filter(x=>shortState(x.l).k==='noreply');
  add('decide',decide.length,
    `${fmt(decide.length)} shortfall${decide.length===1?'':'s'} ${decide.length===1?'has':'have'} been open 21 days`,
    `${esc(decide.slice(0,3).map(x=>x.o.name).join(', '))}${decide.length>3?` +${decide.length-3} more`:''} — stop chasing and decide: refund, write off, or it was a miscount.`,
    "go('purchases')",'');
  add('noreply',noreply.length,
    `${fmt(noreply.length)} chase${noreply.length===1?'':'s'} had no reply by the date set`,
    'Chase again or close it — the reply-by date has passed.',
    "go('purchases')",'');

  const seen={},dups=[];
  D.products.filter(x=>!x.archived&&x.asin).forEach(x=>{
    const k=String(x.asin).toUpperCase();
    if(seen[k])dups.push(x); else seen[k]=x;});
  add('asin',dups.length,
    `${fmt(dups.length)} duplicate ASIN${dups.length===1?'':'s'}`,
    `${esc(dups.slice(0,3).map(x=>x.name).join(', '))} — stock and sales get split between two records.`,
    "go('products')",'');

  return issues;
}
/* Being told "it is in To review" while already standing on that page is not
   help. Go there, open it, scroll to it, and light it up long enough to find. */
function showReview(){
  _revOpen=true;TAB='purchases';render();
  setTimeout(()=>{
    const el=document.getElementById('revPanel');
    if(!el)return;
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.classList.add('flashHi');
    setTimeout(()=>el.classList.remove('flashHi'),10000);
  },160);
}
/* Fix them here. Being handed a list and told to go somewhere else and repeat
   the work is not a repair — it is a to-do list with extra steps. Every purchase
   the matcher could not place gets a search box and a Save, in the same dialog. */
let _fxRows=[];
function openFixLinks(){
  const ghosts=ghostAllocs();
  _fxRows=D.purchases.filter(p=>
      ((p.alloc||[]).length&&(p.alloc||[]).some(a=>!targetOf(a.to)))
      || ghosts.some(g=>g.id===p.id))
    .map(p=>{
      /* offer the closest name up front — the maybe-match it was not confident
         enough to apply on its own is still the right starting point */
      /* whatever the old automatic pass would have chosen, offered rather than
         applied — including the link it already has, for a ghost whose target is
         fine and whose stock simply went missing */
      let guess='';
      const live=(p.alloc||[]).find(a=>targetOf(a.to));
      if(live)guess=live.to;
      if(!guess){try{const sug=suggestFor(p);if(sug&&sug.sure&&sug.id&&targetOf(sug.id))guess=sug.id;}catch(e){}}
      let maybe='';
      if(!guess){try{const sug=suggestFor(p);if(sug&&sug.id&&targetOf(sug.id))maybe=sug.id;}catch(e){}}
      return{p,to:guess||'',guess:guess||maybe,sure:!!guess};
    });
  if(!_fxRows.length){toast('Nothing left to fix','ok');return;}
  $('lav3Mod2').className='mod xl';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>Check these before anything changes</h3>
      <span class="pmeta" style="margin:0">${fmt(_fxRows.length)} to review · nothing is applied until you press the button</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      <div class="amzHelp">These purchases are not showing as on order. Where the app is confident it has
        <b>filled in its suggestion</b> — read it, change it if it is wrong, clear it if you would rather leave the
        purchase alone. <b>Nothing is saved until you press the button</b>, and nothing is ever written to the sheet.</div>
      <div class="fxList">
        ${_fxRows.map((r,i)=>`<div class="fxRow" id="fxRow-${i}">
          <div class="fxWhat">
            <span class="pname">${esc(r.p.name)}</span>
            <div class="pmeta">${fmt(r.p.qty)} @ ${gbp(r.p.price)} · ${esc(r.p.sup||'—')}${r.p.oid&&r.p.oid!=='—'?' · '+esc(r.p.oid):''} · ${dshort(r.p.date)}</div>
          </div>
          <div class="fxPick">
            <input class="in fxIn" id="fxIn-${i}" autocomplete="off" placeholder="Type a component…"
              value="${r.to?esc(allocLabel(r.to)):''}"
              oninput="LV3.fxFind(${i},this.value)" onfocus="LV3.fxFind(${i},this.value)">
            <div class="fxPop" id="fxPop-${i}"></div>
            ${(r.guess&&!r.to)?`<button class="btn sm go" style="margin-top:6px" onclick="LV3.fxPick(${i},'${r.guess}')">
              Closest is <b>${esc(allocLabel(r.guess))}</b> — use it</button>`:''}
            ${r.to?`<button class="btn sm" style="margin-top:6px" onclick="LV3.fxClear(${i})">Leave this one alone</button>`:''}
          </div>
          <span class="fxState${r.to?' ok':''}" id="fxState-${i}">${r.to?'suggested':'not set'}</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="mf"><span id="fxSum" class="pmeta" style="margin:0">Nothing matched yet</span>
      <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Close</button>
      <button class="btn pri" id="fxGo" disabled onclick="LV3.fxSaveAll()">Apply what I have checked</button></div></div>`;
  om('lav3Ov2');
  setTimeout(()=>{const e=document.getElementById('fxIn-0');if(e)e.focus();},60);
  fxSum();
}
function fxFind(i,v){
  const pop=document.getElementById('fxPop-'+i);if(!pop)return;
  const q=(v||'').toLowerCase().trim();
  const all=allocTargets();
  const hits=(q?all.filter(t=>t.name.toLowerCase().includes(q)):all).slice(0,40);
  pop.innerHTML=hits.length
    ? hits.map(t=>`<button type="button" class="alopt" onclick="LV3.fxPick(${i},'${t.id}')">
        <span class="alnm">${esc(t.name)}</span><span class="altag t-${t.tag}">${t.tag}</span></button>`).join('')
    : `<div class="alnone">Nothing matches “${esc(v)}” — add it in Components first</div>`;
  pop.classList.add('on');
}
function fxPick(i,id){
  const r=_fxRows[i];if(!r)return;
  r.to=id;
  const inp=document.getElementById('fxIn-'+i);if(inp)inp.value=allocLabel(id);
  const pop=document.getElementById('fxPop-'+i);if(pop)pop.classList.remove('on');
  const st=document.getElementById('fxState-'+i);
  if(st){st.textContent='ready';st.className='fxState ok';}
  const row=document.getElementById('fxRow-'+i);if(row)row.classList.add('done');
  fxSum();
}
function fxClear(i){
  const r=_fxRows[i];if(!r)return;
  r.to='';
  const inp=document.getElementById('fxIn-'+i);if(inp)inp.value='';
  const st=document.getElementById('fxState-'+i);if(st){st.textContent='left alone';st.className='fxState';}
  const row=document.getElementById('fxRow-'+i);if(row)row.classList.remove('done');
  fxSum();
}
function fxSum(){
  const n=_fxRows.filter(r=>r.to).length;
  const el=$('fxSum');
  if(el)el.innerHTML=n?`<b style="color:var(--grn)">${fmt(n)}</b> of ${fmt(_fxRows.length)} matched · ${fmt(_fxRows.reduce((t,r)=>t+(r.to?r.p.qty:0),0))} units going back on order`
    :'Nothing matched yet';
  const go=$('fxGo');if(go){go.disabled=!n;go.style.opacity=n?'1':'.45';}
}
function fxSaveAll(){
  const ready=_fxRows.filter(r=>r.to);
  if(!ready.length){toast('Match at least one first','er');return;}
  snap();
  let done=0;
  ready.forEach(r=>{try{setAlloc(r.p,[{to:r.to,qty:r.p.qty}]);done++;}catch(e){console.warn('fx',e);}});
  save();cm('lav3Ov2');render();
  logIt('edit',`${done} broken purchase link${done===1?'':'s'} matched by hand`);
  toastUndo(`${fmt(done)} put back on order`,'ok');
}
function fixHealth(kind){
  if(kind!=='links')return;
  /* Show the work, do not do the work. */
  openFixLinks();
}
function _unusedRepairReport(){
  const before=D.purchases.filter(p=>(p.alloc||[]).length&&(p.alloc||[]).some(a=>!targetOf(a.to)));
  const r={fixed:0};
  const after=before;
  _revOpen=true;
  render();
  /* Silence after pressing a button is exactly the fault this banner exists to
     catch. Say what was fixed, what was not, and what to do about the rest. */
  confirmBox(after.length?'Some could not be matched':'All repaired',
    `${r.fixed?`<div style="margin-bottom:10px"><b style="color:var(--grn)">${fmt(r.fixed)} repaired.</b>
       Their stock is back on order and shows in Deliveries.</div>`:''}
     ${after.length?`<div class="note bad" style="margin:0 0 10px">
       <b>${fmt(after.length)} could not be matched automatically.</b>
       The purchase is called something the components list does not have, so the app will not guess.
       <div style="margin-top:7px">${after.slice(0,8).map(p=>`<div class="pmeta" style="margin:2px 0">${esc(p.name)} — ${fmt(p.qty)} @ ${gbp(p.price)} · ${esc(p.sup||'—')}</div>`).join('')}</div></div>
       <div><b>What to do:</b> they are now listed in <b>Purchases → To review</b>. For each one press
       <b>Pick one</b>, type the component it should go to, and save. If the component does not exist yet,
       add it in <b>Components</b> first — then it will match.</div>`
     :'<div>Nothing left to fix.</div>'}`,
    ()=>{if(after.length)openFixLinks();else showReview();},
    {ok:after.length?`Match ${fmt(after.length)} now`:'Done'});
}
function paintHealth(){
  const el=document.getElementById('lav3Health');
  if(!el)return;
  /* Overview folds all of this into "What needs doing" — showing both was the
     same list twice, one above the other. */
  if(TAB==='overview'){el.innerHTML='';return;}
  let issues=[];
  try{issues=healthCheck();}catch(e){console.warn('health',e);return;}
  if(!issues.length){el.innerHTML='';return;}
  const total=issues.reduce((t,i)=>t+i.n,0);
  const worst=issues.some(i=>i.sev==='bad')?'bad':'warn';
  /* the full list lives ONCE, on Overview — repeating it on five tabs pushed
     every page down and taught everyone to scroll past it */
  el.innerHTML=`<div class="hlth ${worst}" style="cursor:pointer" onclick="LV3.go('overview')">
    <div class="hlthTop"><span class="hlthDot">${worst==='bad'?'!':'i'}</span>
      <b>${fmt(total)} data fix${total===1?'':'es'} for Jack</b>
      <span class="hlthSub">the list is on Overview under “For Jack” — click to see it</span></div>
  </div>`;
}
/* The Kingdom Coffee hole, level two. A purchase can point at a component that
   EXISTS and still have no stock behind it — the batch was skipped or lost, and
   every check that only asked "does the link resolve" waved it through. So ask
   the only question that matters: does the stock this purchase should have
   created actually exist? */
/* A leftover from the old rename bug. Before the sync learned to spot a rename,
   correcting a name on the sheet ADDED a second purchase and left the original
   behind — "Replacemen Foam Nozzles" and "Replacement Foam Nozzles", same day,
   same 60, same £0.20, same supplier. One of them is real and already linked;
   the other is a ghost of a typo. Linking it would book 60 units of stock that
   were never bought, so it must be offered as something to REMOVE, never as
   something to match. */
/* One purchase, asked about a single row. The sweep below uses it too, so the
   banner and the row can never disagree. */
/* Numbers alone are NOT enough to call two rows the same purchase. Pure Gusto
   order 6102771 has Lotus Biscoff Minis 300 @ £0.05 and Bonito Vanilla Spoons
   300 @ £0.05 — same day, same supplier, same quantity, same price, same order,
   and two completely different products. Matching on figures would have offered
   to delete a real purchase. The names have to be near-identical too: this is
   only ever meant to catch a TYPO that was later corrected. */
function nameClose(a,b){
  const norm=x=>(x||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const A=norm(a),B=norm(b);
  if(!A||!B)return false;
  if(A===B)return true;
  /* Word overlap alone said "Galaxy Hot Chocolate Sachet" and "Luxury Hot
     Chocolate Sachet" were the same thing, and so were Dove MD and Dove LM.
     Those differ by exactly one word — and that word is the whole product.
     So the rule is narrower: everything must match EXCEPT one word on each side,
     and those two words must be a typo of each other, not two different words. */
  const wa=A.split(' ').filter(Boolean),wb=B.split(' ').filter(Boolean);
  const ra=wa.filter(w=>!wb.includes(w)),rb=wb.filter(w=>!wa.includes(w));
  if(!ra.length&&!rb.length)return true;                 // only spacing/case differed
  if(ra.length>1||rb.length>1)return false;              // more than one word apart
  if(ra.length!==rb.length)return false;                 // an extra word is a different product
  return typoOf(ra[0],rb[0]);
}
/* edit distance, with a threshold that scales — one slip in a long word is a
   typo, one slip in a two-letter code (MD vs LM) is a different product */
function typoOf(a,b){
  a=String(a||'');b=String(b||'');
  if(a===b)return true;
  const allow=Math.max(1,Math.floor(Math.max(a.length,b.length)/7));
  if(Math.abs(a.length-b.length)>allow)return false;
  if(Math.min(a.length,b.length)<5)return false;         // short words are never "close enough"
  const m=a.length,n=b.length;
  let prev=Array.from({length:n+1},(_,j)=>j),cur=new Array(n+1),pp=new Array(n+1).fill(0);
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++){
      cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      /* a swapped pair of letters is one slip, not two — "Mulitpack" for
         "Multipack" is the single most common way a name gets mistyped */
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])cur[j]=Math.min(cur[j],(pp[j-2]||0)+1);
    }
    pp=prev.slice();
    [prev,cur]=[cur,prev];
  }
  return prev[n]<=allow;
}
function dupTwin(p){
  const norm=x=>(x||'').toLowerCase().replace(/\s+/g,' ').trim();
  /* answered "a separate purchase" — it is its own line from here on, and it
     can be linked like any other */
  if(p&&p.dupCheck&&p.dupCheck.answered==='separate')return null;
  const st=allocState(p).k;
  if(st!=='none'&&st!=='broken')return null;
  /* Becki, 10 Sep: "they do all have different order IDs so not sure why it
     hasn't read that anyway." Right — one purchase has one order number. If
     both lines carry one and they differ, they are two purchases and there is
     nothing to ask about. Only lines with no order number, or the same one,
     can be copies of each other. */
  const _oid=x=>String((x&&x.oid)||'').trim().toLowerCase();
  const _po=_oid(p);
  return D.purchases.find(q=>q.id!==p.id
    && !(_po&&_oid(q)&&_oid(q)!==_po)
    && (q.alloc||[]).length && (q.alloc||[]).every(a=>targetOf(a.to))
    && q.date===p.date
    && (parseInt(q.qty)||0)===(parseInt(p.qty)||0)
    && norm(q.sup)===norm(p.sup)
    /* a penny of slack: the sheet stores the total, so 60 for £11.97 comes back
       as £0.1995 on one row and £0.20 on the other. Same purchase. */
    && Math.abs((+q.price||0)-(+p.price||0))<0.02
    && nameClose(q.name,p.name))||null;
}
/* ── "THE SAME PURCHASE, WITH THE NUMBERS CHANGED" ────────────────────────
   dupTwin insists on an identical quantity, so a line somebody CORRECTED on
   the sheet (4 units becomes 5) matches nothing and arrives looking like a
   brand new purchase. Same day, same supplier, same product, different figures
   is almost always a correction — but only almost, so the app asks instead of
   deciding, and the answer can be overruled. */
function changedTwin(p){
  const norm=x=>(x||'').toLowerCase().replace(/\s+/g,' ').trim();
  const st=allocState(p).k;
  if(st!=='none'&&st!=='broken')return null;
  const _oid=x=>String((x&&x.oid)||'').trim().toLowerCase();
  const _po=_oid(p);
  return D.purchases.find(q=>q.id!==p.id
    && !(_po&&_oid(q)&&_oid(q)!==_po)
    && (q.alloc||[]).length && (q.alloc||[]).every(a=>targetOf(a.to))
    && q.date===p.date
    && norm(q.sup)===norm(p.sup)
    && nameClose(q.name,p.name)
    /* something must actually differ, or dupTwin already has it */
    && ((parseInt(q.qty)||0)!==(parseInt(p.qty)||0)
        || Math.abs((+q.price||0)-(+p.price||0))>=0.02))||null;
}
/* The popup. It explains what changed, in both directions, before anything
   moves — and the UK team can overrule it and keep both. */
function openMerge(pid){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  const tw=changedTwin(p);
  if(!tw){toast('Nothing on order matches this line any more','er');return;}
  const oldTot=tw.spend||((tw.qty||0)*(tw.price||0));
  const newTot=p.spend||((p.qty||0)*(p.price||0));
  const dq=(p.qty||0)-(tw.qty||0);
  const row=(lab,a,b)=>`<tr><td class="l" style="color:var(--text3)">${lab}</td>
    <td class="mono">${a}</td><td class="mono" style="color:var(--accent)">${b}</td></tr>`;
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>The sheet has changed this purchase</h3>
    <span class="pmeta" style="margin:0">${esc(p.name)} · ${esc(p.sup||'—')} · ${esc(dshort(p.date)||p.date)}</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb" style="padding:12px 14px">
    <div class="ordNote" style="margin-bottom:10px">A line already on order matches this one on the day, the supplier and the product — but the figures are different. That is usually somebody correcting the sheet, not a second purchase.</div>
    <table class="rsTbl tight"><thead><tr>
      <th class="l">&nbsp;</th><th>Already on order</th><th>The sheet now says</th>
    </tr></thead><tbody>
      ${row('Quantity',fmt(tw.qty||0),fmt(p.qty||0)+(dq?` <span style="color:${dq>0?'var(--grn)':'var(--red)'}">(${dq>0?'+':''}${fmt(dq)})</span>`:''))}
      ${row('Unit price',gbp(tw.price||0),gbp(p.price||0))}
      ${row('Line total',gbp(oldTot),gbp(newTot))}
    </tbody></table>
    <div class="ordNote" style="margin-top:10px"><b>Update the existing line</b> keeps one purchase and moves it to the sheet's figures — the stock it created follows. <b>Keep both</b> treats them as two separate purchases on the same day, and stops this being asked again.</div>
  </div>
  <div class="mf">
    <button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <div class="sp">
      <button class="btn" title="These really are two different purchases made on the same day"
        onclick="LV3.mergeKeepBoth('${p.id}')">Keep both &mdash; separate purchases</button>
      <button class="btn pri" onclick="LV3.mergeIntoTwin('${p.id}')">Update the existing line</button>
    </div>
  </div>`;
  om('lav3Ov2');
}
function mergeIntoTwin(pid){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  const tw=changedTwin(p);if(!tw){toast('That line has moved on — reopen it','er');return;}
  snap();
  const oldQty=parseInt(tw.qty)||0, newQty=parseInt(p.qty)||0;
  tw.qty=newQty; tw.price=p.price; tw.spend=p.spend; tw.mismatch=p.mismatch;
  /* the stock this purchase created has to follow the correction, but only
     when the allocation plainly covered the whole line — a split allocation is
     somebody's deliberate work and is left alone with a word about it */
  const al=tw.alloc||[];
  if(al.length===1&&(parseInt(al[0].qty)||0)===oldQty){al[0].qty=newQty;setAlloc(tw,al);}
  else if(al.length)toast('Figures updated — check the allocation, it was split across more than one thing','er');
  logIt('edit',`Merged a corrected sheet line — ${p.name}: ${fmt(oldQty)} → ${fmt(newQty)} units`);
  cm('lav3Ov2');
  dropReview(p.id,true);           // tombstoned, so the old figures stop coming back
  save();render();
  toastUndo(`Updated to ${fmt(newQty)} units — one purchase, the sheet's figures`,'ok');
}
function mergeKeepBoth(pid){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  snap();
  p.dupCheck={...(p.dupCheck||{}),answered:'separate',by:(window.currentUserName||''),on:dayISO()};
  logIt('edit',`Kept as a separate purchase — ${p.name} ${dshort(p.date)}`);
  cm('lav3Ov2');save();render();
  toastUndo('Kept as its own purchase — you will not be asked again','ok');
}
/* ── "THE SHEET HAS TWO LINES THAT LOOK THE SAME" ──────────────────────────
   Two Tescos, same day, same product, same money, no order number. The sync
   used to decide on its own that the second one wasn't real. It now adds it and
   asks, because only a person knows whether they went to two shops. */
function dupPending(){return D.purchases.filter(p=>p.dupCheck&&!p.dupCheck.answered);}
function dupConfirm(pid,separate){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  const twin=D.purchases.find(x=>x.id===(p.dupCheck||{}).of);
  if(separate){
    p.dupCheck={...p.dupCheck,answered:'separate',by:(window.currentUserName||'someone'),on:dayISO()};
    logIt('edit',`Confirmed a real second purchase — “${p.name}” ${dshort(p.date)} from ${p.sup||'supplier'}`);
    save();render();toastUndo('Kept — two separate purchases','ok');
    return;
  }
  confirmBox('Same purchase, listed twice?',
    `<div style="margin-bottom:10px"><b>${esc(p.name)}</b> — ${fmt(p.qty)} @ ${gbp(p.price)} from <b>${esc(p.sup||'supplier')}</b> on ${dshort(p.date)}.</div>
     <div class="pmeta" style="margin:0">This copy is removed from the hub and the sync will not bring it back. The Purchase Sheet is not touched${twin?` — the one already linked stays exactly as it is`:''}.</div>`,
    ()=>{
      snap();
      /* Two things have to happen and this path only ever did one of them.
         The tombstone stops the SHEET SYNC handing the line back — that was
         the first fix. But the row also lives in lavarion_purchases, and a
         reload reads it straight back out of there, which is why it kept
         reappearing after a hard refresh even once it was being ignored.
         Delete the stored row as well, exactly as dropReview does. */
      killPurchLine(p,'removed as a duplicate');
      const i=D.purchases.findIndex(x=>x.id===pid);
      if(i>=0)D.purchases.splice(i,1);
      PURCH=D.purchases;
      if(p.uuid)sb.from('lavarion_purchases').delete().eq('id',p.uuid)
        .then(r=>{if(r.error){console.warn('[lav3] drop duplicate',r.error);
          toast('Removed here, but the database refused: '+r.error.message,'er');}});
      logIt('edit',`Removed a duplicate purchase line — “${p.name}” ${dshort(p.date)} — deleted and the sync will skip it`);
      save();render();toastUndo('Removed as a duplicate — it will not come back','ok');
    },{danger:true,ok:'Yes, remove this copy'});
}
const dupAnswered=()=>D.purchases.filter(p=>p.dupCheck&&p.dupCheck.answered);
function dupPanel(){
  const list=dupPending();
  const done=dupAnswered().slice().sort((a,b)=>String((b.dupCheck||{}).on||'').localeCompare(String((a.dupCheck||{}).on||''))).slice(0,6);
  /* Always on screen, even at zero. Jack: "get a review queue there so we know
     there are no issues" — a panel that only appears when something is wrong
     cannot tell you that nothing is wrong, and after being silently robbed of a
     purchase once, "no news" is not reassuring. */
  if(!list.length){
    return `<div class="panel">
      <div class="ph"><span class="t">Duplicate checks</span>
        <span class="sub">nothing waiting — every purchase line on the sheet has come through</span>
        ${(()=>{const k=Object.keys(purchKilled()).length;
          return k?`<span class="chip warn">${fmt(k)} ignored line${k===1?'':'s'}</span>`:'';})()}
        <span class="chip ok">all clear</span></div>
      <div class="ordNote">When two sheet lines look identical — same day, same product, same money, no order number — both are kept as separate purchases automatically; two shops in one day is normal. If one really is the same purchase written twice, remove it here.${
      (()=>{const k=Object.entries(purchKilled());
        return k.length?` <b style="color:var(--amb)">${fmt(k.length)} sheet line${k.length===1?'':'s'}</b> ${k.length===1?'is':'are'} being ignored because somebody removed ${k.length===1?'it':'them'} — <button class="btn sm" style="padding:1px 8px" onclick="LV3.openKilled()">show ${k.length===1?'it':'them'}</button>`:'';})()}${
        ''}</div>
      ${done.length?`<div style="padding:4px 14px 12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span class="pmeta" style="margin:0">Kept as separate purchases:</span>
        ${done.map(p=>`<span class="chip info" style="display:inline-flex;gap:6px;align-items:center;">${esc(p.name)} · ${fmt(p.qty)} · ${dshort(p.date)}${(p.dupCheck||{}).by==='auto'?'':' · '+esc((p.dupCheck||{}).by||'')}
          <button class="btn sm dgr" style="padding:1px 7px;" title="One purchase written on the sheet twice — remove this copy. The sync will not bring it back." onclick="LV3.dupConfirm('${p.id}',false)">Same one — remove it</button></span>`).join('')}</div>`:''}
    </div>`;
  }
  return `<div class="panel">
    <div class="ph"><span class="t" style="color:var(--amb)">Is this the same purchase twice?</span>
      <span class="sub">${fmt(list.length)} line${list.length===1?' on the sheet looks':'s on the sheet look'} identical to one already here — nothing has been thrown away</span>
      <span class="chip warn">${fmt(list.length)} to review</span>
    </div>
    <div class="ordNote">Same day, same product, same money and no order number to tell them apart. Two shops on one day is normal, so the sync no longer guesses — it adds both and asks.</div>
    <div class="tblScroll"><table><thead><tr>
      <th class="l" style="min-width:230px">The line</th>
      <th style="width:80px">Qty</th>
      <th style="width:90px">Unit</th>
      <th class="l" style="width:150px">Supplier</th>
      <th style="width:90px">Date</th>
      <th class="acts" style="width:250px"></th>
    </tr></thead><tbody>
    ${list.map(p=>{
      /* The stored twin can be gone — somebody removed it, or it was relinked.
         Fall back to finding any other line that reads the same, and if there
         genuinely is not one, say so and stop calling it a duplicate: there is
         nothing to compare it against, so the honest answer is to keep it. */
      let twin=D.purchases.find(x=>x.id===(p.dupCheck||{}).of);
      if(!twin)twin=D.purchases.find(x=>x.id!==p.id&&purchKey(x)===purchKey(p));
      return `<tr>
        <td class="l"><div class="pname" style="font-size:12.5px">${esc(p.name)}</div>
          <div class="pmeta">${twin?`already here: ${fmt(twin.qty)} @ ${gbp(twin.price)}${twin.oid&&twin.oid!=='—'?' · '+esc(twin.oid):''}`
            :`<span style="color:var(--amb)">nothing else here matches it — it is not a duplicate, keep it</span>`}</div></td>
        <td><span class="num b">${fmt(p.qty)}</span></td>
        <td><span class="num quiet">${gbp(p.price)}</span></td>
        <td class="l">${esc(p.sup||'—')}</td>
        <td><span class="pmeta" style="margin:0">${dshort(p.date)}</span></td>
        <td class="acts">
          <button class="btn sm go" title="${twin?'Two genuine purchases — keep both':'Nothing matches it, so there is nothing to remove'}" onclick="LV3.dupConfirm('${p.id}',true)">${twin?'Two separate purchases':'Keep it'}</button>
          <button class="btn sm dgr" title="One purchase written on the sheet twice — remove this copy. The sync will not bring it back." onclick="LV3.dupConfirm('${p.id}',false)">Same one — remove it</button>
        </td></tr>`;}).join('')}
    </tbody></table></div>
  </div>`;
}
function staleDupes(){
  const norm=x=>(x||'').toLowerCase().replace(/\s+/g,' ').trim();
  const linked=D.purchases.filter(p=>(p.alloc||[]).length&&(p.alloc||[]).every(a=>targetOf(a.to)));
  return D.purchases.map(p=>({p,twin:dupTwin(p)})).filter(x=>x.twin);
}
/* answer one line either way, from the strip */
function dropOneDupe(pid){
  const p=D.purchases.find(x=>x.id===pid);if(!p)return;
  const tw=dupTwin(p);
  confirmBox('Remove this copy?',
    `<div style="margin-bottom:8px"><b>${esc(p.name)}</b> — ${fmt(p.qty)} @ ${gbp(p.price)} · ${esc(p.sup||'—')}</div>
     ${tw?`<div class="pmeta">already on order as <b>${esc(tw.name)}</b></div>`:''}
     <div class="note bad" style="margin:10px 0 0">Nothing changes on the Google Sheet. The sync will not bring this copy back.</div>`,
    ()=>{snap();dropReview(p.id,true);save();render();toastUndo('Copy removed','ok');});
}
function dupKeepAll(){
  const list=staleDupes();
  if(!list.length){toast('Nothing waiting','ok');return;}
  snap();
  list.forEach(x=>{x.p.dupCheck={...(x.p.dupCheck||{}),answered:'separate',by:(window.currentUserName||'someone'),on:dayISO()};});
  logIt('edit',`Kept ${list.length} flagged line${list.length===1?'':'s'} as separate purchases`);
  save();render();
  toastUndo(`Kept ${fmt(list.length)} as separate purchases — you will not be asked again`,'ok');
}
function dropDupes(){
  const list=staleDupes();
  if(!list.length){toast('No leftovers found','ok');return;}
  confirmBox('Remove these leftovers?',
    `<div style="margin-bottom:10px">Each of these is the same purchase you already have linked — same day, same
      quantity, same price, same supplier. They are what a rename on the sheet used to leave behind.</div>
     ${list.map(x=>`<div class="pmeta" style="margin:4px 0">
       <b>${esc(x.p.name)}</b> — ${fmt(x.p.qty)} @ ${gbp(x.p.price)} · ${esc(x.p.sup||'—')}
       <div style="opacity:.8">already on order as <b>${esc(x.twin.name)}</b></div></div>`).join('')}
     <div class="note bad" style="margin:10px 0 0">Linking one of these instead would book
       <b>${fmt(list.reduce((t,x)=>t+(parseInt(x.p.qty)||0),0))} units</b> of stock that were never bought.
       The sheet is not touched.</div>`,
    ()=>{
      snap();                                   // one snapshot for the whole batch
      list.forEach(x=>dropReview(x.p.id,true));
      save();render();
      toastUndo(`${fmt(list.length)} leftover${list.length===1?'':'s'} removed`,'ok');},
    {danger:true,ok:`Remove ${fmt(list.length)}`});
}
function ghostAllocs(){
  return D.purchases.filter(p=>{
    const a=(p.alloc||[]).filter(x=>targetOf(x.to));
    if(!a.length)return false;
    const want=a.reduce((t,x)=>t+(parseInt(x.qty)||0),0);
    let have=0;
    const tag='P:'+p.id;
    D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{if(l.src===tag)have+=l.qty||0;}));
    return have<want;         // linked on paper, missing in stock
  });
}
function repairAllocLinks(){
  const byName={};
  D.components.concat(D.products).forEach(o=>{const k=_norm(o.name);if(k&&!byName[k])byName[k]=o;});
  let fixed=0,broke=0;
  D.purchases.forEach(p=>{
    const a=p.alloc||[];
    if(!a.length)return;
    let changed=false;
    a.forEach(x=>{
      if(targetOf(x.to))return;
      /* Exact names only was too strict. "Dove MD Tanning Lotion 75ml" on the
         sheet is "Dove MD 75ml Tanning Lotion" here — same part, different word
         order — and "Replacement Foam Nozzles" is the singular plus an s. Fall
         back to the same word-overlap matcher the review queue already uses, and
         only accept it when that matcher is SURE. Anything less stays broken and
         goes to a human. */
      let hit=byName[_norm(p.name)];
      if(!hit){
        try{const sug=suggestFor(p);
          if(sug&&sug.sure&&sug.id)hit=targetOf(sug.id)||null;}catch(e){}
      }
      if(hit){x.to=hit.id;changed=true;fixed++;}
      else broke++;
    });
    if(changed){
      /* rebuilding the allocation is what actually recreates the stock batch */
      try{setAlloc(p,a.map(x=>({to:x.to,qty:x.qty})));}catch(e){console.warn('repair',e);}
    }
  });
  /* and the ghosts: linked, targets fine, stock missing — rebuild those too */
  ghostAllocs().forEach(p=>{
    try{setAlloc(p,(p.alloc||[]).map(x=>({to:x.to,qty:x.qty})));fixed++;}
    catch(e){console.warn('ghost rebuild',e);}
  });
  if(fixed){
    save();
    logIt('edit',`Repaired ${fixed} broken purchase link${fixed===1?'':'s'} — their stock is back on order`);
    console.log('[lav3] repaired',fixed,'alloc links,',broke,'left for review');
  }
  return{fixed,broke};
}
function setAlloc(p,alloc){
  const tag='P:'+p.id;
  /* Keep what already exists. This used to DELETE every layer belonging to the
     purchase and build fresh ones with arrived:0 — so anything that had been
     received went back to "on order", and because the new layer had no uuid it
     was inserted again alongside the old row. Re-running an allocation for any
     reason silently undid a receipt. Existing layers are now updated in place,
     keeping their uuid, their arrived flag and what is left of them. */
  /* Keyed BOTH ways on purpose. The synthetic 'P<pid>_<i>' id only survives
     until the next refresh — hydrate overwrites l.id with the database uuid —
     so after any reload the old lookup missed every time, built a brand new
     layer at the allocation quantity, and threw the received one away. That is
     how an order of 30 with 15 counted in came back as an order of 15 with no
     receipts. allocIx is stored on the layer and persists, so it still matches
     tomorrow. */
  const keep={},byIx={};
  D.components.concat(D.products).forEach(o=>{if(!o.layers)return;
    o.layers.forEach(l=>{if(l.src!==tag)return;
      keep[l.id]=l;
      if(l.allocIx!=null&&byIx[l.allocIx]===undefined)byIx[l.allocIx]=l;});
    o.layers=o.layers.filter(l=>l.src!==tag);});
  /* Anything with a receipt against it, a shortfall or a note is somebody's
     work — it is never rebuilt from scratch and never dropped. */
  const hasHistory=l=>!!(rcvdQty(l)||(l.rcpts&&l.rcpts.length)||l.short||l.arr||l.dmg||l.note);
  p.alloc=alloc.filter(a=>a.to&&(parseInt(a.qty)||0)>0).map(a=>({to:a.to,qty:parseInt(a.qty)}));
  delete p.link;
  let missed=0;
  p.alloc.forEach((a,i)=>{
    const o=targetOf(a.to);
    if(!o){missed++;return;}                 // counted, not swallowed — see below
    /* A synced purchase has no shipping method on the sheet, so a linked order
       arrived in Deliveries with no idea when it was due. Guess from who sold
       it — overseas suppliers are weeks, UK shops are days — and let anyone
       change it on the row. */
    const mode=guessMode(p.sup);
    const m=shipMode(mode)||SHIPMODES[0];
    const add=nd=>{const x=new Date(p.date);x.setDate(x.getDate()+nd);
      return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
    const lid='P'+p.id+'_'+i;
    const was=keep[lid]||byIx[i];
    if(was){
      /* it already exists — only the things the allocation actually owns change */
      was.date=p.date;was.cost=p.price;was.sup=p.sup;was.oid=p.oid;
      was.allocIx=i;
      /* ORDERED and STILL OWED are two different numbers and the allocation only
         owns the first. Writing a.qty straight into qty was what made a
         part-received order forget it had ever been 30 — qty means "what is
         still owed" the moment anything is counted in. */
      was.ord=a.qty;
      was.qty=Math.max(0,a.qty-rcvdQty(was));
      if(was.short&&was.qty>0)was.shortQty=was.qty;
      if(!was.arr)was.rem=0;                       // still on order: nothing on the shelf
      else if(was.rem>a.qty)was.rem=a.qty;         // received: keep what is left of it
      was.loc=p.loc==='Home'?'Warehouse':p.loc;
      if(!was.mode)was.mode=mode;
      if(!was.eta1)was.eta1=add(m.lo);
      if(!was.eta2)was.eta2=add(m.hi);
      (o.layers=o.layers||[]).push(was);
      delete keep[was.id];delete byIx[i];
      return;
    }
    (o.layers=o.layers||[]).push({id:lid,src:tag,allocIx:i,date:p.date,
      ord:a.qty,qty:a.qty,rem:p.arr?a.qty:0,cost:p.price,
      sup:p.sup,oid:p.oid,loc:p.loc==='Home'?'Warehouse':p.loc,arr:p.arr?1:0,
      mode,eta1:add(m.lo),eta2:add(m.hi)});
  });
  /* a layer the new allocation no longer covers, but which has already been
     received, is real stock — put it back rather than lose it */
  /* `arr` alone was the wrong test. It is only set when an order COMPLETES, so
     a part-received one — 15 of 30 counted in, the rest still owed, possibly
     already raised as a shortfall with Sarah — read as "not arrived" and was
     dropped on the floor with its receipts. Anything anybody has touched comes
     back. */
  Object.values(keep).forEach(l=>{
    if(!hasHistory(l))return;
    const o=targetOf(l.tid)||targetOf((l.tid||'').toString());
    if(o)(o.layers=o.layers||[]).push(l);
    else console.warn('[lav3] kept a received layer with no home',l.id);
  });
  logIt('edit',`Purchase “${p.name}” allocated: ${p.alloc.length?p.alloc.map(a=>fmt(a.qty)+' → '+((targetOf(a.to)||{}).name||'MISSING')).join(', '):'nothing'}`);
  if(missed){
    /* Silence here is what hid the Kingdom Coffee orders for days: the purchase
       looked linked and the stock simply never appeared anywhere. */
    console.warn('[lav3] alloc target missing on',p.name);
    try{toast(`${p.name}: ${missed} allocation${missed===1?'':'s'} point at something that no longer exists — it is back in To review`,'er');}catch(e){}
  }
}

let LINKP=null;
function openLink(pid){
  LINKP=D.purchases.find(x=>x.id===pid);
  const sug=suggestFor(LINKP);
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Allocate purchase</h3><span class="pmeta" style="margin:0">${dshort(LINKP.date)} · ${esc(LINKP.sup)}</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div class="pname" style="font-size:15px">${esc(LINKP.name)}</div>
        <div class="pmeta">${fmt(LINKP.qty)} units @ ${gbp(LINKP.price)} · order ${esc(LINKP.oid)} · ${LINKP.arr?'arrived':'still on order'}</div>
      </div>
      <div class="stat" style="min-width:130px"><div class="k">Total value</div><div class="v">${gbp(LINKP.qty*LINKP.price)}</div></div>
    </div>
    <div class="lab">Where did these units go?</div>
    <div id="alRows" style="margin-top:7px"></div>
    <div style="display:flex;gap:7px;align-items:center;margin-top:6px;flex-wrap:wrap">
      <button class="btn sm" onclick="LV3.addAllocRow()">+ Split across another</button>
      <button class="btn sm" onclick="LV3.fillRest()">Put the rest on the first line</button>
      ${sug?`<span class="sug" onclick="LV3.useSuggestion('${sug.id}')">Suggested: ${esc((targetOf(sug.id)||{}).name||'')} · ${sug.why}</span>`:''}
    </div>
    <div id="alSum"></div>
    ${(()=>{const same=D.purchases.filter(x=>x.id!==LINKP.id&&x.name.toLowerCase()===LINKP.name.toLowerCase());
      return same.length?`<label style="display:flex;gap:9px;align-items:flex-start;margin-top:12px;font-size:12.5px;color:var(--text2);cursor:pointer">
        <input type="checkbox" id="alAll" style="margin-top:2px">
        <span>Apply to the other <b>${same.length}</b> row${same.length===1?'':'s'} called "${esc(LINKP.name)}"
          <span class="pmeta" style="margin-top:2px">Each keeps its own quantity and price — same destinations, split in the same proportion.</span></span></label>`:'';})()}
    <div class="note info" style="margin-top:12px">One purchase can feed more than one thing — 600 gloves might be 400 for MD bundles and 200 for LM. Anything you leave unallocated is simply ignored, and you can come back and change this at any time.</div>
  </div>
  <div class="mf">${allocOf(LINKP).length?`<button class="btn dgr" onclick="LV3.clearAlloc()">Unlink all</button>`:''}
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.saveAlloc()">Save allocation</button></div></div>`;
  om('lav3Ov2');
  const cur=allocOf(LINKP);
  $('alRows').innerHTML='';
  (cur.length?cur:[{to:'',qty:LINKP.qty}]).forEach(a=>addAllocRow(a.to,a.qty));
}
/* Everything a purchase can be allocated to, in one list. Kept as a function so
   a component added five minutes ago is in it. */
function allocTargets(){
  const out=[];
  D.components.filter(c=>!c.archived).forEach(c=>out.push({id:c.id,name:c.name,
    tag:c.kind==='packaging'?'packaging':'component'}));
  D.products.filter(x=>x.type!=='bundle'&&!x.archived).forEach(x=>out.push({id:x.id,name:x.name,tag:'product'}));
  return out;
}
const allocLabel=id=>{const t=allocTargets().find(x=>String(x.id)===String(id));return t?t.name:'';};
/* A dropdown of forty-odd parts is a scroll, not a choice — Becki could only
   hunt down the list for the one she wanted. Type-to-search, with the id held
   separately so two parts sharing a name can't be confused for each other. */
function alFind(inp){
  const row=inp.closest('.alrow');if(!row)return;
  const pop=row.querySelector('.alpop'),hid=row.querySelector('.al-to');
  const q=(inp.value||'').toLowerCase().trim();
  const all=allocTargets();
  const hits=(q?all.filter(t=>t.name.toLowerCase().includes(q)):all).slice(0,50);
  if(!hits.length){pop.innerHTML=`<div class="alnone">Nothing matches “${esc(inp.value)}”</div>`;pop.classList.add('on');
    hid.value='';row.classList.add('unmatched');allocSum();return;}
  pop.innerHTML=hits.map((t,i)=>`<button type="button" class="alopt${i===0?' first':''}" onclick="LV3.alPick(this,'${t.id}')">
    <span class="alnm">${esc(t.name)}</span><span class="altag t-${t.tag}">${t.tag}</span></button>`).join('');
  pop.classList.add('on');
  /* an exact typed name still counts as chosen, so tabbing straight past works */
  const exact=all.find(t=>t.name.toLowerCase()===q);
  hid.value=exact?exact.id:'';
  row.classList.toggle('unmatched',!!q&&!exact);
  allocSum();
}
function alPick(btn,id){
  const row=btn.closest('.alrow');if(!row)return;
  row.querySelector('.al-to').value=id;
  row.querySelector('.al-find').value=allocLabel(id);
  row.querySelector('.alpop').classList.remove('on');
  row.classList.remove('unmatched');
  allocSum();
}
function alKey(ev,inp){
  const row=inp.closest('.alrow');if(!row)return;
  const pop=row.querySelector('.alpop');
  if(ev.key==='Escape'){pop.classList.remove('on');return;}
  if(ev.key==='Enter'){const f=pop.querySelector('.alopt');if(f){ev.preventDefault();f.click();}}
}
document.addEventListener('click',e=>{
  if(e.target.closest('.alpick'))return;
  document.querySelectorAll('.alpop.on').forEach(p=>p.classList.remove('on'));
});
function addAllocRow(to,qty){
  const d=document.createElement('div');d.className='alrow';
  d.innerHTML=`<div class="alpick">
      <input class="in al-find" value="${esc(allocLabel(to))}" placeholder="Type to search — part, packaging or product…"
        autocomplete="off" oninput="LV3.alFind(this)" onfocus="LV3.alFind(this)" onkeydown="LV3.alKey(event,this)">
      <input type="hidden" class="al-to" value="${to||''}">
      <div class="alpop"></div>
    </div>
    <input class="in mono al-q" type="number" min="0" value="${qty!=null?qty:''}" placeholder="qty" style="text-align:center" oninput="LV3.allocSum()">
    <button class="btn sm dgr" title="Remove" onclick="this.parentElement.remove();LV3.allocSum()">✕</button>
    <div class="alwhere"></div>`;
  $('alRows').appendChild(d);allocSum();
}
function useSuggestion(id){
  const rows=[...document.querySelectorAll('#alRows .alrow')];
  const empty=rows.find(r=>!r.querySelector('.al-to').value);
  if(empty){
    empty.querySelector('.al-to').value=id;
    const f=empty.querySelector('.al-find');if(f)f.value=allocLabel(id);   // keep the box and the id in step
    empty.classList.remove('unmatched');
    if(!empty.querySelector('.al-q').value)empty.querySelector('.al-q').value=unallocLive();
  }
  else addAllocRow(id,unallocLive());
  allocSum();
}
function readAlloc(){return [...document.querySelectorAll('#alRows .alrow')]
  .map(r=>({to:r.querySelector('.al-to').value,qty:parseInt(r.querySelector('.al-q').value)||0}));}
function unallocLive(){return LINKP?Math.max(0,LINKP.qty-readAlloc().reduce((s,a)=>s+a.qty,0)):0;}
function allocSum(){
  if(!LINKP)return;              // rows can outlive the modal that opened them
  /* explain what each chosen destination actually feeds — this is where the
     "a scraper is in five bundles" question gets answered */
  document.querySelectorAll('#alRows .alrow').forEach(r=>{
    const id=r.querySelector('.al-to').value,box=r.querySelector('.alwhere');
    if(!box)return;
    const c=comp(id);
    if(!c){const pr=prod(id);
      box.innerHTML=pr?`<span class="dim">Finished stock of ${esc(pr.name)} — sent as-is.</span>`:'';return;}
    const uses=usedIn(id);
    box.innerHTML=uses.length>1
      ? `<b style="color:var(--grn)">Shared pool</b> — feeds ${uses.map(u=>esc(u.name)).join(', ')}. Put the whole lot here; whichever bundle gets built draws from it.`
      : uses.length===1 ? `Used in ${esc(uses[0].name)}.`
      : `<span style="color:var(--amb)">Not in any product yet</span> — fine to allocate now, but the stock does nothing until you add it to a build list.`;
  });
  const rows=readAlloc(),used=rows.reduce((s,a)=>s+a.qty,0),left=LINKP.qty-used;
  const segs=rows.filter(a=>a.qty>0).map((a,i)=>`<i style="width:${Math.min(100,a.qty/LINKP.qty*100)}%;background:${['var(--blu)','var(--vio)','var(--grn)','var(--amb)'][i%4]}"></i>`).join('');
  $('alSum').innerHTML=`
    <div class="albar">${segs}${left>0?`<i style="width:${left/LINKP.qty*100}%;background:var(--bg5)"></i>`:''}</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3)">
      <span><b class="mono" style="color:var(--text)">${fmt(used)}</b> of ${fmt(LINKP.qty)} allocated</span>
      <span style="color:${left<0?'var(--red)':left>0?'var(--amb)':'var(--grn)'}">${left<0?`${fmt(-left)} over — reduce a line`:left>0?`${fmt(left)} left unallocated`:'All units allocated'}</span></div>`;
}
function saveAlloc(){
  if(LINKP&&dupTwin(LINKP)){toast('This is a leftover copy of a line already on order — remove it instead of linking it','er');return;}
  const rows=readAlloc().filter(a=>a.to&&a.qty>0);
  snap();
  const used=rows.reduce((s,a)=>s+a.qty,0);
  if(used>LINKP.qty){toast(`That's ${fmt(used-LINKP.qty)} more than the purchase`,'er');return;}
  const dupe=rows.map(r=>r.to);
  if(new Set(dupe).size!==dupe.length){toast('The same destination is listed twice','er');return;}
  setAlloc(LINKP,rows);
  let extra=0;
  if(($('alAll')||{}).checked&&rows.length){
    const share=rows.map(r=>({to:r.to,frac:r.qty/LINKP.qty}));
    D.purchases.filter(x=>x.id!==LINKP.id&&x.name.toLowerCase()===LINKP.name.toLowerCase()).forEach(x=>{
      let run=0;
      const spread=share.map((sh,i)=>{const q=(i===share.length-1)?x.qty-run:Math.round(x.qty*sh.frac);run+=q;return{to:sh.to,qty:q};});
      setAlloc(x,spread.filter(y=>y.qty>0));extra++;
    });
  }
  cm('lav3Ov2');render();
  toastUndo(rows.length?`Allocated ${fmt(used)} of ${fmt(LINKP.qty)} units${extra?` · ${extra} matching row${extra===1?'':'s'} too`:''}`:'Allocation cleared','ok');
}
function fillRest(){
  const rows=[...document.querySelectorAll('#alRows .alrow')];
  if(!rows.length)return;
  const q=rows[0].querySelector('.al-q');
  q.value=(parseInt(q.value)||0)+unallocLive();allocSum();
}
function clearAlloc(){snap();setAlloc(LINKP,[]);cm('lav3Ov2');render();toastUndo('Unlinked');}



/* ── LOG AN ORDER ────────────────────────────────────────────────────────
   Until the purchase sheet feeds this automatically, there has to be a way
   to say "I've ordered 600 gloves". That creates an on-order batch, which is
   what Deliveries receives against. */
/* How stock travels, and roughly how long each takes. Days are from the order
   date; anything from the Far East is the reason this exists at all. */
const SHIPMODE_DEFAULTS=[
  {k:'courier', label:'Courier / parcel — UK',      lo:1,  hi:4,   hint:'Next day to a few days.'},
  {k:'road',    label:'Road freight — UK / Europe', lo:3,  hi:10,  hint:'Pallets by lorry.'},
  {k:'air',     label:'Air freight — overseas',     lo:7,  hi:21,  hint:'Fastest way in from China. Dearer, but weeks not months.'},
  {k:'sea',     label:'Sea freight — overseas',     lo:35, hi:70,  hint:'Cheapest and slowest. Five to ten weeks from China is normal — order well ahead.'},
  {k:'rail',    label:'Rail freight — overseas',    lo:21, hi:42,  hint:'Between air and sea on both price and time.'},
  {k:'collect', label:'Collection / in person',     lo:0,  hi:2,   hint:'Picked up ourselves.'}
];
/* The day ranges are yours to set — what sea freight from your supplier really
   takes is something only you know, and it changes. Settings overrides these. */
Object.defineProperty(window,'__lavModes',{value:1,configurable:true});
/* The list of methods is yours as well as the timings — different suppliers,
   different routes. Held in settings, so nothing to migrate. */
function shipModes(){
  const custom=D.settings.modes;
  if(Array.isArray(custom)&&custom.length)return custom;
  return SHIPMODE_DEFAULTS.map(m=>({k:m.k,label:m.label,lo:m.lo,hi:m.hi,hint:m.hint}));
}
function modeDays(k){
  const m=shipModes().find(x=>x.k===k);
  if(m)return{lo:m.lo,hi:m.hi};
  const base=SHIPMODE_DEFAULTS.find(x=>x.k===k)||SHIPMODE_DEFAULTS[0];
  const d=(D.settings.modeDays||{})[k];
  return{lo:(d&&d.lo!=null)?d.lo:base.lo,hi:(d&&d.hi!=null)?d.hi:base.hi};
}
/* the editor works on a draft so nothing changes until Save is pressed */
let _modeDraft=null;
function modeDraft(){
  if(!_modeDraft)_modeDraft=JSON.parse(JSON.stringify(shipModes()));
  return _modeDraft;
}
function modeEdit(i,field,v){
  const d=modeDraft();if(!d[i])return;
  d[i][field]=(field==='label')?v:(Math.max(0,parseInt(v)||0));
  if(d[i].hi<d[i].lo)d[i].hi=d[i].lo;
  markModesDirty();
}
function modeAdd(){
  const d=modeDraft();
  d.push({k:'m'+Date.now().toString(36),label:'New method',lo:3,hi:10,hint:''});
  _modesDirty=true;render();
}
function modeRemove(i){
  const d=modeDraft();
  if(d.length<=1){toast('Keep at least one method','er');return;}
  const gone=d[i];
  const inUse=(function(){let n=0;
    D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{if(l.mode===gone.k&&!l.arr)n++;}));
    return n;})();
  if(inUse&&!confirm(`${inUse} order${inUse===1?' is':'s are'} still using "${gone.label}". Remove it anyway?\nThose keep the dates they were given.`))return;
  d.splice(i,1);_modesDirty=true;render();
}
let _modesDirty=false;
function markModesDirty(){
  _modesDirty=true;
  const b=document.getElementById('modeSaveBtn');
  if(b){b.disabled=false;b.textContent='Save changes';b.classList.add('pri');}
}
function modesSave(){
  const d=modeDraft();
  if(d.some(m=>!(m.label||'').trim())){toast('Every method needs a name','er');return;}
  D.settings.modes=d.map(m=>({k:m.k,label:m.label.trim(),lo:m.lo,hi:m.hi,hint:m.hint||''}));
  savePrefs();
  _modesDirty=false;_modeDraft=null;
  render();toast('Delivery times saved','ok');
}
function modesReset(){
  if(!confirm('Put the delivery methods back to the built-in list?'))return;
  delete D.settings.modes;delete D.settings.modeDays;
  savePrefs();_modeDraft=null;_modesDirty=false;
  render();toast('Back to the defaults','ok');
}
function setModeDays(k,which,v){
  D.settings.modeDays=D.settings.modeDays||{};
  D.settings.modeDays[k]=Object.assign({},modeDays(k));
  const num=parseInt(v);
  D.settings.modeDays[k][which]=isNaN(num)?null:Math.max(0,num);
  if(D.settings.modeDays[k].hi<D.settings.modeDays[k].lo)
    D.settings.modeDays[k].hi=D.settings.modeDays[k].lo;
  savePrefs();
}
const SHIPMODES=SHIPMODE_DEFAULTS;               // kept for anything still naming it
const shipMode=k=>{
  const m=shipModes().find(x=>x.k===k);
  if(m)return m;
  const b=SHIPMODE_DEFAULTS.find(x=>x.k===k);
  return b?Object.assign({},b,modeDays(k)):null;
};
function openLogOrder(prefill){
  /* "Log the order" on a buy suggestion pre-picks the part and the quantity */
  const sugg=prefill?buyLine(comp(prefill)):null;
  const opts=D.components.filter(c=>!c.archived).map(c=>({id:c.id,name:c.name,k:'component'}))
    .concat(D.products.filter(p=>!p.archived&&p.type!=='bundle').map(p=>({id:p.id,name:p.name,k:'product'})));
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>Log an order</h3><span class="pmeta" style="margin:0">something you've bought that hasn't arrived</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      <div class="frow"><span class="lab">What did you order?</span>
        <input class="in" id="lo-find" placeholder="Type to filter…" oninput="LV3.loFilter(this.value)" style="margin-bottom:6px">
        <select class="in" id="lo-to">
          <optgroup label="Components">${opts.filter(o=>o.k==='component').map(o=>`<option value="${o.id}" ${prefill===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</optgroup>
          <optgroup label="Finished product stock">${opts.filter(o=>o.k==='product').map(o=>`<option value="${o.id}" ${prefill===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</optgroup>
        </select></div>
      <div class="g2 frow">
        <div><span class="lab">Quantity</span><input class="in mono" id="lo-qty" type="number" min="1" placeholder="600"></div>
        <div><span class="lab">Unit cost <span style="text-transform:none;font-weight:600">(inc VAT, optional)</span></span>
          <input class="in mono" id="lo-cost" type="number" step="0.01" min="0" placeholder="0.42"></div></div>
      <div class="g2 frow">
        <div><span class="lab">Supplier</span><input class="in" id="lo-sup" placeholder="Alibaba, Superdrug…"></div>
        <div><span class="lab">Order ref <span style="text-transform:none;font-weight:600">(optional)</span></span>
          <input class="in mono" id="lo-ref" placeholder="PO-104"></div></div>
      <div class="g2 frow">
        <div><span class="lab">Date ordered</span><input class="in" id="lo-date" type="date" value="${dayISO()}" onchange="LV3.loEta()"></div>
        <div><span class="lab">Where will it land</span>
          <select class="in" id="lo-loc">${(D.settings.locations||'Warehouse').split(',').map(l=>`<option>${esc(l.trim())}</option>`).join('')}</select></div></div>
      <div class="g2 frow">
        <div><span class="lab">How is it coming</span>
          <select class="in" id="lo-ship" onchange="LV3.loEta(1)">${shipModes().map(m=>`<option value="${m.k}">${m.label}</option>`).join('')}</select>
          <div class="pmeta" id="lo-shipHint" style="margin-top:5px"></div></div>
        <div><span class="lab">How long does it usually take</span>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="in num" id="lo-lo" type="number" min="0" style="width:74px" onchange="LV3.loEta(2)">
            <span class="pmeta" style="margin:0">to</span>
            <input class="in num" id="lo-hi" type="number" min="0" style="width:74px" onchange="LV3.loEta(2)">
            <span class="pmeta" style="margin:0">days</span>
          </div>
          <div class="loQuick" id="lo-quick">${[7,15,21,30,45,60,75,90].map(d=>`<button type="button" onclick="LV3.loDays(${d})">${d}d</button>`).join('')}</div></div></div>
      <div class="frow"><span class="lab">Expected between</span>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="in" id="lo-eta1" type="date" style="flex:1">
          <span class="pmeta" style="margin:0">and</span>
          <input class="in" id="lo-eta2" type="date" style="flex:1"></div>
        <div class="pmeta" style="margin-top:5px">Worked out from the days above. Type over them if the supplier has given you real dates.</div></div>
      <div class="frow"><span class="lab">Why is this being added by hand?</span>
        <select class="in" id="lo-why" onchange="LV3.loWhy()">
          <option value="">Choose a reason…</option>
          <option value="Not on the purchase sheet yet">Not on the purchase sheet yet</option>
          <option value="Bought outside the usual process">Bought outside the usual process</option>
          <option value="Sample or free stock">Sample or free stock</option>
          <option value="Replacement for damaged stock">Replacement for a damaged or missing delivery</option>
          <option value="Correcting a missed purchase">Correcting a purchase that never got logged</option>
          <option value="other">Something else — I'll explain</option>
        </select>
        <input class="in" id="lo-why2" placeholder="Say what happened…" style="margin-top:6px;display:none">
        <div class="pmeta" style="margin-top:5px">Almost everything should come from the purchase sheet. This is recorded against the delivery so the odd one out can be explained later.</div></div>
      <div class="note info">It shows as <b>on order</b> until you receive it in Deliveries. Leave the cost blank if you don't know it yet — it can be set later.</div>
    </div>
    <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
      <button class="btn pri" onclick="LV3.saveOrder()">Log order</button></div></div>`;
  om('lav3Ov2');
  if(sugg&&sugg.qty>0){const q=$('lo-qty');if(q)q.value=sugg.qty;
    const sp=$('lo-sup');if(sp&&sugg.sup)sp.value=sugg.sup;
    const sh=$('lo-ship');if(sh&&sugg.mode)sh.value=sugg.mode;
    /* last price paid, so the batch isn't costed at zero */
    const last=avgCostOf(sugg.c);
    const co=$('lo-cost');if(co&&last>0)co.value=last.toFixed(2);
    const w=$('lo-why');if(w)w.value='Not on the purchase sheet yet';}
  loEta(0);setTimeout(()=>{const q=$('lo-qty');if(q){q.focus();q.select&&q.select();}},60);
}
/* Sea freight from China is weeks, a UK courier is days. Rather than make
   anyone work that out, the method suggests a window and they can overrule it. */
/* src: 1 = the method changed (reset the days to its default), 2 = the days
   were typed, anything else = first draw. The dates always follow the days. */
function loEta(src){
  const m=shipMode(($('lo-ship')||{}).value)||shipMode('courier');
  const hint=$('lo-shipHint');if(hint)hint.textContent=m.hint;
  const lo=$('lo-lo'),hi=$('lo-hi');
  if(lo&&hi){
    if(src!==2||lo.value===''||hi.value===''){lo.value=m.lo;hi.value=m.hi;}
    if(+hi.value<+lo.value)hi.value=lo.value;
  }
  const from=$('lo-eta1'),to=$('lo-eta2');if(!from||!to)return;
  const base=new Date(($('lo-date')||{}).value||dayISO());
  if(isNaN(base))return;
  const add=n=>{const x=new Date(base);x.setDate(x.getDate()+n);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
  from.value=add(parseInt(lo?lo.value:m.lo)||0);
  to.value=add(parseInt(hi?hi.value:m.hi)||0);
}
/* the quick day buttons — a fortnight either side of the figure you picked */
function loDays(d){
  const lo=$('lo-lo'),hi=$('lo-hi');if(!lo||!hi)return;
  const spread=d<=14?2:d<=30?7:14;
  lo.value=Math.max(0,d-spread);hi.value=d+spread;
  loEta(2);
}
function loWhy(){
  const sel=$('lo-why'),other=$('lo-why2');
  if(!sel||!other)return;
  other.style.display=sel.value==='other'?'':'none';
  if(sel.value==='other')other.focus();
}
function loFilter(q){
  q=(q||'').toLowerCase();
  const sel=$('lo-to');if(!sel)return;
  [...sel.querySelectorAll('option')].forEach(o=>{o.style.display=!q||o.textContent.toLowerCase().includes(q)?'':'none';});
  const first=[...sel.querySelectorAll('option')].find(o=>o.style.display!=='none');
  if(first&&q)sel.value=first.value;
}
function saveOrder(){
  const id=$('lo-to').value,qty=parseInt($('lo-qty').value)||0;
  if(!id||qty<1){toast('Pick something and enter a quantity','er');return;}
  const whySel=($('lo-why')||{}).value||'';
  const why=whySel==='other'?(($('lo-why2')||{}).value||'').trim():whySel;
  if(!why){toast('Say why this is being added by hand','er');const w=$('lo-why');if(w)w.focus();return;}
  const o=comp(id)||prod(id);if(!o){toast('Not found','er');return;}
  snap();
  (o.layers=o.layers||[]).push({id:newId('O'),date:$('lo-date').value||dayISO(),qty,rem:0,
    cost:parseFloat($('lo-cost').value)||0,sup:($('lo-sup').value||'').trim()||'—',
    oid:($('lo-ref').value||'').trim()||'—',loc:$('lo-loc').value||'Warehouse',arr:0,src:'manual',
    mode:($('lo-ship')||{}).value||'courier',
    leadLo:parseInt(($('lo-lo')||{}).value)||null,leadHi:parseInt(($('lo-hi')||{}).value)||null,
    eta1:($('lo-eta1')||{}).value||'',eta2:($('lo-eta2')||{}).value||'',
    manual:1,why,whoAdded:(window.currentUserName||'someone'),
    note:parseFloat($('lo-cost').value)>0?'':'price missing'});
  logIt('order',`Ordered ${fmt(qty)} × ${o.name}${$('lo-sup').value?' from '+$('lo-sup').value:''}`);
  save();cm('lav3Ov2');render();
  toastUndo(`${fmt(qty)} × ${o.name} logged as on order`,'ok');
}

/* ═══════════════ DELIVERIES ═══════════════
   Everything ordered and not yet arrived, in one place. Works off stock
   batches, so it covers migrated orders, purchase-sheet rows and anything
   added by hand. Tick what turned up; edit the received box for a partial
   and the remainder stays on order. */
function inboundAll(){
  const out=[];
  D.components.forEach(c=>(c.layers||[]).filter(l=>!l.arr&&!l.writtenOff).forEach(l=>out.push({o:c,l,kind:'component'})));
  D.products.forEach(p=>(p.layers||[]).filter(l=>!l.arr&&!l.writtenOff).forEach(l=>out.push({o:p,l,kind:'product'})));
  /* Anything on order without a window gets one, worked out from who sold it
     and how long that method usually takes, counted from the order date. An
     order logged by hand arrived here with the method box showing the first
     option and Expected reading "no date set" — which meant it could never be
     late, never be chased, and never appear in the follow-up queue. Typing over
     either date marks it touched and the typed dates win from then on. */
  let filled=0;
  out.forEach(({l})=>{
    if(l.eta1||l.eta2||l._etaTouched||!l.date)return;
    /* an "ask every time" supplier gets no method and no dates — the row will
       say so rather than showing a window nobody chose */
    if(supplierAsks(l.sup)&&!l.mode)return;
    if(!l.mode)l.mode=guessMode(l.sup);
    if(!l.mode)return;
    const m=shipMode(l.mode);
    if(!m)return;
    const add=n=>{const x=new Date(l.date);x.setDate(x.getDate()+n);
      return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
    l.eta1=add(m.lo);l.eta2=add(m.hi);l._etaGuess=1;filled++;
  });
  if(filled)save();
  return out.sort((a,b)=>(a.l.date||'').localeCompare(b.l.date||''));
}
/* The badge said 36 when three things actually needed anyone today — a number
   that always looks urgent teaches people to ignore it. It now counts what is
   due this week, overdue, or arrived-and-waiting-to-be-counted. */
function inboundCount(){
  return inboundAll().filter(x=>{
    if(x.l.arrivedOn)return true;                  // waiting to be counted in
    const b=dlvBucket(x.l);
    return b.k==='late'||b.k==='today'||b.k==='week';
  }).length;
}
/* Everything on order, as a table you can actually look at — not buried in a
   modal. Sea freight from China lands months after it is ordered, so "when is
   it due" needs to be visible next to what was bought. */
function etaState(l){
  const t=localDay(TODAY);
  const e1=l.eta1||'',e2=l.eta2||'';
  if(!e1&&!e2){
    const m=shipMode(l.mode);
    if(!m)return{txt:'no date set',col:'var(--text2)',k:'none'};
    const add=n=>{const x=new Date(l.date);x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    return{txt:`${dshort(add(m.lo))} – ${dshort(add(m.hi))}`,col:'var(--text2)',k:'guess',sub:'estimated from '+m.label.split('—')[0].trim()};
  }
  const end=e2||e1;
  const days=Math.round((new Date(end)-new Date(t))/864e5);
  const range=e1&&e2&&e1!==e2?`${dshort(e1)} – ${dshort(e2)}`:dshort(end);
  /* an auto-filled window says so, so nobody chases a supplier over a date the
     app guessed rather than one they were given */
  const est=l._etaGuess?' · estimated':'';
  if(days<0)return{txt:range,col:'var(--red)',k:'late',sub:`${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`+est};
  if(days<=7)return{txt:range,col:'var(--amb)',k:'soon',sub:(days===0?'due today':`due in ${days} day${days===1?'':'s'}`)+est};
  return{txt:range,col:'var(--grn)',k:'ok',sub:`in ${days} days`+est};
}
function modeChip(l){
  const m=shipMode(l.mode);if(!m)return'';
  const short=m.label.split('—')[0].trim();
  return `<span class="mchip m-${m.k}">${esc(short)}</span>`;
}
/* Change the method or the window on an order that's already been logged. */
/* Native date inputs always render dd/mm/yyyy and eat half the row. Two small
   dd/mm boxes are all anyone types — the year is worked out from the order
   date, rolling into next year when a long lead time crosses December. */
const dmOf=iso=>{if(!iso)return '';const p=String(iso).slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:'';};
function dmToIso(txt,anchorIso){
  const m=String(txt||'').trim().match(/^(\d{1,2})\s*[\/\-. ]\s*(\d{1,2})$/);
  if(!m)return '';
  const dd=+m[1],mm=+m[2];
  if(dd<1||dd>31||mm<1||mm>12)return '';
  const a=anchorIso?new Date(anchorIso+'T00:00:00'):new Date();
  let yr=a.getFullYear();
  /* an expected date before the order date means it has rolled into next year */
  const cand=new Date(yr,mm-1,dd);
  if(cand<a)yr++;
  return `${yr}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
function setEtaDM(kind,oid,lid,field,txt){
  const o=kind==='component'?comp(oid):prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  const iso=dmToIso(txt,l.date);
  if(!iso&&String(txt||'').trim()){toast('Use day/month, like 14/09','er');render();return;}
  setEta(kind,oid,lid,field,iso);
}
function setEta(kind,oid,lid,field,v){
  const o=kind==='component'?comp(oid):prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  l[field]=v;
  if(field==='mode'){                       // re-suggest the window unless it was typed by hand
    /* Learning the supplier's route from one order is right for Superdrug and
       wrong for Alibaba: picking "air" on a single order would overwrite the
       "ask every time" setting and silently re-date every other order from
       them. A supplier with no usual route stays that way — the choice sticks
       to THIS order only. */
    if(!supplierAsks(l.sup)&&!/alibab/i.test(l.sup||''))rememberMode(l.sup,v);
    const m=shipMode(v);
    if(m&&!l._etaTouched){const add=n=>{const x=new Date(l.date);x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
      l.eta1=add(m.lo);l.eta2=add(m.hi);}
  }else l._etaTouched=1;
  save();render();
}
/* ── short deliveries ────────────────────────────────────────────────────
   Every line that arrived light, still outstanding, oldest first. It is the
   one thing on this page that costs money quietly: the stock was paid for and
   never turned up, and without a list nobody remembers to ask for it. */
/* Whole days between two dates. Subtracting timestamps compared "now" against
   midnight, so anything done today read as 1 day ago after 00:00 UTC. */
function daysSince(iso){
  if(!iso)return 0;
  const a=new Date(String(iso).slice(0,10)+'T00:00:00Z').getTime();
  const t=TODAY, b=Date.UTC(t.getFullYear(),t.getMonth(),t.getDate());
  return Math.max(0,Math.round((b-a)/864e5));
}
/* ── ONE ORDER, MANY DELIVERIES ───────────────────────────────────────────
   Receiving used to be a single yes/no: whatever number was typed became the
   whole story and the order left the list. Real deliveries do not work that
   way — 40 today, 35 on Friday, 25 never — and the old model had to lie about
   at least one of them. An order now carries what was ordered, what has come
   in so far, and every receipt that made it up. It closes when every unit is
   ACCOUNTED FOR, not when a box turns up. */
const ordQty =l=>Math.max(0,parseInt(l.ord)||parseInt(l.qty)||0);
const rcvdQty=l=>Math.max(0,parseInt(l.rcvd)||0);
const outQty =l=>Math.max(0,ordQty(l)-rcvdQty(l));
/* Four states, from two questions: is anything still coming, and is anybody
   owed anything. Colour, chip and which buttons appear all come from here, so
   there is one answer to "where is this order up to" and not four. */
function orderState(l){
  const ord=ordQty(l),got=rcvdQty(l),out=outQty(l);
  if(l.arr||l.writtenOff||out<=0)return{k:'done',label:'Complete',col:'var(--grn)',ord:9};
  if(l.short&&l.repl&&l.repl.qty>0)
    return{k:'repl',label:`${fmt(l.repl.qty)} replacement${l.repl.qty===1?'':'s'} due`,
      col:'var(--text3)',grey:1,ord:3,
      why:'Investigated, actioned, replacement expected — nothing to chase today.'};
  if(l.short)return{k:'short',label:`${fmt(out)} short`,col:'var(--red)',ord:0,
      why:'The delivery is finished and these never came. It is with Sarah.'};
  if(got>0)return{k:'part',label:`${fmt(got)} of ${fmt(ord)} in`,col:'var(--amb)',ord:1,
      why:'Part of it has been counted in. The rest is still expected.'};
  return{k:'open',label:'On order',col:'var(--blu)',ord:2,why:''};
}
/* Nothing but the person holding the boxes can know the delivery has finished,
   so nothing but a person may declare it. Reversible — a late box is far more
   likely than a misclick worth protecting against. */
function declareShort(l,who,on){
  const out=outQty(l);
  if(out<=0)return 0;
  l.short=1;l.shortQty=out;l.shortOn=on;l.shortBy=who;
  return out;
}
function undeclareShort(oid,lid){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  snap();
  delete l.short;delete l.shortQty;delete l.shortOn;delete l.shortBy;
  delete l.chased;delete l.chasedBy;delete l.replyBy;delete l.repl;
  logIt('edit',`Reopened ${o.name} — more of the order is coming after all`);
  save();render();toastUndo('Back on order — the shortfall is withdrawn','ok');
}
/* Sarah's answer when the supplier agrees to send more. It does not close
   anything: the units are still owed, they just stop needing chasing. */
function openRepl(oid,lid){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  const out=outQty(l);
  $('lav3Mod2').className='mod';
  $('lav3Mod2').innerHTML=`
    <div class="mh"><h3>Replacement coming — ${esc(o.name)}</h3>
      <span class="pmeta" style="margin:0">${esc(l.sup||'no supplier')}${(l.oid&&l.oid!=='—')?' · '+esc(l.oid):''}</span>
      <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
    <div class="mb">
      <div class="note info" style="margin:0 0 12px">${fmt(out)} unit${out===1?'':'s'} are still owed on this order.
        Saying a replacement is coming stops it being chased — it does <b>not</b> close it. The units stay owed until
        they are counted in.</div>
      <div class="frow"><span class="lab">How many are they sending?</span>
        <input class="in num" id="rplQty" type="number" min="1" max="${out}" value="${out}"
          style="font-size:17px;text-align:center"></div>
      <div class="frow"><span class="lab">Note <span style="text-transform:none;font-weight:600">(optional)</span></span>
        <input class="in" id="rplNote" placeholder="e.g. reorder raised, due next week"></div>
    </div>
    <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
      <button class="btn pri" onclick="LV3.saveRepl('${oid}','${lid}')">Replacement is coming</button></div></div>`;
  om('lav3Ov2');
  setTimeout(()=>{const e=$('rplQty');if(e){e.focus();e.select();}},60);
}
function saveRepl(oid,lid){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  const n=Math.max(1,Math.min(outQty(l),parseInt(($('rplQty')||{}).value)||0));
  const note=(($('rplNote')||{}).value||'').trim();
  snap();
  l.short=1;                                        // still owed, just not chased
  l.repl={qty:n,on:dayISO(),by:(window.currentUserName||'someone'),note};
  cm('lav3Ov2');
  logIt('edit',`Replacement agreed — ${fmt(n)} × ${o.name} from ${l.sup||'supplier'}${note?' · '+note:''}`);
  save();render();
  toastUndo(`${fmt(n)} replacement${n===1?'':'s'} expected — off the chase list`,'ok');
}
/* ── DAMAGED STOCK ────────────────────────────────────────────────────────
   Damaged units arrived, so there is nothing to chase a courier for, but they
   never become sellable stock. They sit outside it as a loss until somebody
   gets the money back or sends them away — and they stay on this list until
   that happens, at any value. No threshold: a supplier who is casual about
   £2 of breakage is the problem either way. */
function damagedLines(){
  const out=[];
  D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{
    const n=Math.max(0,parseInt(l.dmg)||0);
    if(n>0&&!l.dmgEnd)out.push({o,l,n,val:n*(l.cost||0),kind:o.recipe?'product':'component'});
  }));
  return out.sort((a,b)=>String(a.l.dmgOn||a.l.date||'').localeCompare(String(b.l.dmgOn||b.l.date||'')));
}
const DMG_ENDS={
  refund :{t:'Refunded',      q:'Money back for the damaged units?', ok:'Yes, refunded'},
  ret    :{t:'Sent back',     q:'Returned to the supplier?',          ok:'Yes, sent back'},
  keep   :{t:'Kept anyway',   q:'Keeping them?',                      ok:'Yes, keeping them'},
  binned :{t:'Written off',   q:'Write these off?',                   ok:'Write them off'}
};
function dmgEnd(oid,lid,kind){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  const e=DMG_ENDS[kind];if(!e)return;
  const n=Math.max(0,parseInt(l.dmg)||0);
  const val=l.cost>0?gbp(n*l.cost):'';
  confirmBox(e.q,
    `<div style="margin-bottom:10px"><b>${fmt(n)} damaged × ${esc(o.name)}</b> from
       <b>${esc(l.sup||'the supplier')}</b>${val?` — ${val}`:''}.</div>
     <div class="pmeta" style="margin:0">${kind==='keep'
       ? 'They stay out of sellable stock. Use this when the money is already back and the units are not worth returning.'
       : kind==='binned'
       ? 'Nothing comes back for these. Worth asking for a credit note first.'
       : 'This closes the damage off. The stock stays out of the sellable count either way.'}</div>`,
    ()=>{
      snap();
      l.dmgEnd={k:kind,on:dayISO(),by:(window.currentUserName||'someone')};
      logIt('edit',`${e.t} — ${fmt(n)} damaged × ${o.name} from ${l.sup||'supplier'}${val?' ('+val+')':''}`);
      save();render();toastUndo(e.t,'ok');
    },{ok:e.ok,danger:kind==='binned'});
}
/* ── ONE ORDER, ONE CONVERSATION ──────────────────────────────────────────
   A short delivery and a damaged box on the same order from the same supplier
   is ONE email, so it is ONE item here. Sarah's page reads this. */
/* Sarah's short/damaged popup writes through these. A supplier issue is a
   GROUP of layers (one order, several lines), so a note or a field goes onto
   every layer in the group — whichever line she opens it from, the whole
   conversation carries the same history. Stored in the layer's own fields,
   saved by the existing save(); nothing new in the database. */
function _issueLayers(key){
  const out=[];
  shortLines().concat(damagedLines().map(({o,l})=>({o,l}))).forEach(({o,l})=>{
    const k=(l.oid&&l.oid!=='—')?('o:'+String(l.oid).toLowerCase()):('l:'+l.id);
    if(k===key)out.push({o,l});
  });
  return out;
}
function logSupplierIssue(key,entry){
  const hits=_issueLayers(key); if(!hits.length)return false;
  hits.forEach(({l})=>{
    l.log=Array.isArray(l.log)?l.log:[];
    l.log.push(entry);
    if(/chased/i.test(entry.msg||''))l.chased=entry.at.slice(0,10);
  });
  save();
  return true;
}
function setSupplierIssueField(key,field,val){
  const hits=_issueLayers(key); if(!hits.length)return false;
  hits.forEach(({l})=>{l[field]=val;});
  save();
  return true;
}
function supplierIssues(){
  const by={};
  const grab=l=>{
    const k=(l.oid&&l.oid!=='—')?('o:'+String(l.oid).toLowerCase()):('l:'+l.id);
    return by[k]=by[k]||{key:k,ref:(l.oid&&l.oid!=='—')?l.oid:'',sup:l.sup||'—',
      on:l.shortOn||l.dmgOn||l.date||'',short:0,dmg:0,val:0,chased:'',replyBy:'',repl:0,lines:[],
      /* the popup's context: where the photos are, the conversation so far,
         and whether the whole conversation is currently in Jack's hands */
      evid:l.evid||'',toJack:l.toJack||'',toSarah:l.toSarah||'',log:Array.isArray(l.log)?l.log.slice():[],
      /* Becki's note travels with the problem. It was collected on the layer,
         shown only on the Lavarion Purchases page, and dropped here — which is
         why two of them read "images sent to Sarah": she was writing a routing
         instruction into a field that went nowhere. Same rule as the claim row
         three blocks down, which already carries srcNote for exactly this. */
      note:(l.note||'').trim()};
  };
  shortLines().forEach(({o,l})=>{
    const g=grab(l),n=outQty(l);
    g.short+=n;g.val+=n*(l.cost||0);
    if(l.repl&&l.repl.qty>0)g.repl+=l.repl.qty;
    if(l.chased&&l.chased>g.chased)g.chased=l.chased;
    if(l.replyBy&&(!g.replyBy||l.replyBy<g.replyBy))g.replyBy=l.replyBy;
    const d=l.shortOn||l.date||'';if(d&&(!g.on||d<g.on))g.on=d;
    g.lines.push({name:o.name,short:n,dmg:0,oid:o.id,lid:l.id,
      kind:o.recipe?'product':'component',repl:(l.repl&&l.repl.qty)||0});
  });
  damagedLines().forEach(({o,l,n,val})=>{
    const g=grab(l);
    g.dmg+=n;g.val+=val;
    const d=l.dmgOn||l.date||'';if(d&&(!g.on||d<g.on))g.on=d;
    const hit=g.lines.find(x=>x.oid===o.id);
    if(hit)hit.dmg+=n;
    else g.lines.push({name:o.name,short:0,dmg:n,oid:o.id,lid:l.id,
      kind:o.recipe?'product':'component',repl:0});
  });
  return Object.values(by).map(g=>{
    g.age=daysSince(g.on);
    /* everything owed is covered by a promised replacement — actioned, quiet */
    g.quiet=g.dmg===0&&g.short>0&&g.repl>=g.short;
    return g;
  }).sort((a,b)=>(a.quiet?1:0)-(b.quiet?1:0)||b.age-a.age);
}
function shortLines(){
  const out=[];
  D.components.concat(D.products).forEach(o=>{
    (o.layers||[]).forEach(l=>{
      if(l.short&&!l.arr&&!l.writtenOff&&l.qty>0)out.push({o,l});
    });
  });
  /* oldest first, always. Sorting by value would teach everyone to ignore the
     small ones, and the small ones are exactly how it becomes a habit. */
  return out.sort((a,b)=>(a.l.shortOn||'').localeCompare(b.l.shortOn||''));
}
/* ── WHAT TO BUY ──────────────────────────────────────────────────────────
   Knowing you are short is half of it. The half that stops a stockout is
   knowing you had to order it three weeks ago — which only makes sense once
   lead times exist. Usage comes from the sales figures, cover is what is on
   hand plus what is already coming, and the deadline is cover minus how long
   that supplier takes. */
function usualSupplier(c){
  const ls=realLayers(c).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const l=ls.find(x=>x.sup&&x.sup!=='—'&&x.sup!=='Opening stock');
  return l?l.sup:'';
}
function buyLine(c){
  const days=D.settings.targetDays||60;
  const need=compNeed60(c);                    // units for the whole target window
  if(!need)return null;                        // nothing uses it
  const perDay=need/days;
  if(perDay<=0)return null;
  const have=onHand(c),coming=onOrder(c);
  const coverDays=(have+coming)/perDay;
  const sup=usualSupplier(c);
  const mode=guessMode(sup);
  const lead=modeDays(mode);
  /* order enough to cover the target window plus the wait for the next one */
  let qty=Math.max(0,Math.round(perDay*(days+lead.hi))-(have+coming));
  if(c.caseQty>0&&qty>0)qty=Math.ceil(qty/c.caseQty)*c.caseQty;
  const slack=Math.round(coverDays-lead.hi);   // days before you must order
  if(qty<=0&&slack>14)return null;             // comfortable — nothing to say
  return{c,need,perDay,have,coming,coverDays:Math.round(coverDays),sup,mode,lead,qty,slack,
    urgency:slack<0?'late':slack<=7?'now':slack<=21?'soon':'ok'};
}
function buyList(){
  return D.components.filter(c=>!c.archived&&!c.untracked)
    .map(buyLine).filter(Boolean)
    .sort((a,b)=>a.slack-b.slack);
}
/* ── WHAT ARRIVED ─────────────────────────────────────────────────────────
   Once an order is received it disappeared, so "what happened to 10251385332"
   had no answer. Same grouping as everywhere else — the batches that landed,
   what they cost, who took them in and whether anything was missing. */
function receivedOrders(){
  const by={};
  D.components.concat(D.products).forEach(o=>{
    (o.layers||[]).forEach(l=>{
      if(!l.arr||!l.recvOn)return;
      const k=(l.oid&&l.oid!=='—')?('o:'+l.oid.toLowerCase()):('l:'+l.id);
      (by[k]=by[k]||{ref:l.oid&&l.oid!=='—'?l.oid:'',sup:l.sup||'—',on:l.recvOn,by:l.recvBy||'',lines:[]})
        .lines.push({o,l});
      if(l.recvOn<by[k].on)by[k].on=l.recvOn;
    });
  });
  return Object.values(by).map(g=>{
    g.units=g.lines.reduce((t,x)=>t+(x.l.qty||0),0);
    g.value=g.lines.reduce((t,x)=>t+(x.l.qty||0)*(x.l.cost||0),0);
    g.ordered=g.lines.map(x=>x.l.date).sort()[0];
    g.wait=daysSince(g.ordered)-daysSince(g.on);
    return g;
  }).sort((a,b)=>b.on.localeCompare(a.on));
}
/* Notes left when stock was counted in. The order itself is finished — the
   goods are on the shelf — but "2 boxes crushed" is not finished, so it stays
   on screen until somebody says it has been dealt with. Both halves of what
   was asked for: it does not vanish, and it is a thing you clear. */
function openNotes(){
  const out=[];
  D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{
    if(l.noteOpen&&l.note)out.push({o,l});}));
  return out.sort((a,b)=>String(b.l.noteOn||'').localeCompare(String(a.l.noteOn||'')));
}
function clearNote(oid,lid,kind){
  const o=kind==='product'?prod(oid):comp(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  snap();
  delete l.noteOpen;
  logIt('edit',`Delivery note cleared — ${o.name}: ${String(l.note).slice(0,60)}`);
  save();render();
  toastUndo('Note cleared','ok');
}
function notesPanel(){
  const list=openNotes();
  if(!list.length)return '';
  return `<div class="panel">
    <div class="ph"><span class="t">Notes on deliveries</span>
      <span class="sub">${fmt(list.length)} left when stock was counted in · still open</span>
      <span class="chip warn">${fmt(list.length)} to deal with</span></div>
    <div class="noteList">
      ${list.map(x=>`<div class="noteRow">
        <div class="noteMain">
          <div class="noteWhat"><span class="pname">${esc(x.o.name)}</span>
            <span class="pmeta">${fmt(x.l.qty)} units${x.l.sup?' · '+esc(x.l.sup):''}${(x.l.oid&&x.l.oid!=='—')?' · '+esc(x.l.oid):''}</span></div>
          <div class="noteTxt">${esc(x.l.note)}</div>
          <div class="noteWho">${x.l.noteBy?esc(x.l.noteBy):'someone'}${x.l.noteOn?' · '+dshort(x.l.noteOn):''}</div>
        </div>
        <button class="btn sm go" onclick="LV3.clearNote('${x.o.id}','${x.l.id}','${x.o.recipe?'product':'component'}')"
          title="Mark this as dealt with — it comes off the list">Dealt with</button>
      </div>`).join('')}
    </div>
  </div>`;
}
let _histAll=false;
function toggleHist(){_histAll=!_histAll;render();}
function historyPanel(){
  const all=receivedOrders();
  if(!all.length)return '';
  const show=_histAll?all:all.slice(0,6);
  const val=all.reduce((t,g)=>t+g.value,0);
  const units=all.reduce((t,g)=>t+g.units,0);
  /* This was seven columns of four different colours — blue units, white value,
     amber days, white names in UPPERCASE — with the widest column holding the
     least. Nothing said which number mattered.

     One rule now: the goods are the content, so they read as plain sentence
     case and get the room. Numbers are white. Amber appears once, and only when
     an order genuinely dragged. Everything else is quiet. */
  return `<div class="panel" id="arrivedPanel">
    <div class="ph"><span class="t">What has arrived</span>
      <span class="sub">${fmt(all.length)} order${all.length===1?'':'s'} · ${fmt(units)} units · ${gbp(val)}</span>
      ${all.length>6?`<div class="r"><button class="btn sm" onclick="LV3.toggleHist()">${_histAll?'Recent only':`All ${fmt(all.length)}`}</button></div>`:''}
    </div>
    <table class="arvTbl"><thead><tr>
      <th class="l" style="width:132px">Landed</th>
      <th class="l" style="width:168px">Supplier</th>
      <th class="l">What came</th>
      <th style="width:74px">Units</th>
      <th style="width:92px">Value</th>
      <th style="width:96px">Took</th>
    </tr></thead><tbody>
    ${show.map(g=>{
      const age=daysSince(g.on), took=Math.max(0,g.wait), slow=took>21;
      return `<tr>
      <td class="l"><span class="arvDay">${dshort(g.on)}</span>
        <span class="arvAgo">${age===0?'today':age===1?'yesterday':age+'d ago'}</span></td>
      <td class="l"><span class="arvSup">${esc(g.sup)}</span>
        <span class="arvRef">${g.ref?esc(g.ref):'no order ref'}${g.by?' · '+esc(g.by):''}</span></td>
      <td class="l"><div class="arvGoods">${g.lines.slice(0,4).map(x=>
          `<span class="arvItem">${esc(x.o.name)}<b>${fmt(x.l.qty)}</b></span>`).join('')}
        ${g.lines.length>4?`<span class="arvMore">+${g.lines.length-4} more</span>`:''}</div></td>
      <td class="arvNum">${fmt(g.units)}</td>
      <td class="arvNum quiet">${g.value?gbp(g.value):'—'}</td>
      <td class="arvTook${slow?' slow':''}">${fmt(took)}<i>days</i></td>
    </tr>`;}).join('')}
    </tbody></table>
    <div class="pmeta" style="padding:9px 14px;border-top:1px solid var(--border)">
      <b>Order to door</b> is how long each one really took — the honest version of the lead times in Settings.
      Anything over 21 days is marked, and it is worth correcting the estimate if a supplier keeps showing up there.
    </div>
  </div>`;
}
/* The buy list is sorted worst-first, so the first handful IS the job. Showing
   all 32 meant scrolling past thirty rows nobody was going to act on today to
   reach the rest of the page. */
let _buyAll=false;
const BUY_SHOW=8;
function buyToggle(){_buyAll=!_buyAll;render();}
function copyBuyList(){
  const P=plData();
  const list=P.buys.filter(L=>!L.isProd&&L.buyQty>0&&['buy','soon'].indexOf(L.state)>=0);
  if(!list.length){toast('Nothing due to order right now');return;}
  const lines=list.map(L=>[L.o.name,L.buyQty,(L.sup||''),L.cases?L.cases+' cases':''].join('\t'));
  const txt='Part\tUnits\tSupplier\tCases\n'+lines.join('\n');
  try{navigator.clipboard.writeText(txt).then(
    ()=>toast('\u2713 '+list.length+' lines copied — paste straight into the purchase sheet','ok'),
    ()=>toast('Could not reach the clipboard','er'));}
  catch(e){toast('Could not reach the clipboard','er');}
}
function buyPanel(){
  /* Rebuilt 29 Aug: this list IS the Planner's buy list — same engine, same
     numbers. The old version ran its own 60-day-target maths with guessed
     freight routes and disagreed with the Planner by thousands of pounds. */
  const P=plData();
  const list=P.buys.filter(L=>!L.isProd&&L.buyQty>0&&['buy','soon','upcoming'].indexOf(L.state)>=0);
  const gated=P.buys.filter(L=>!L.isProd&&(L.state==='noroute'||L.state==='nosup'));
  if(!list.length&&!gated.length)return '';
  const shown=_buyAll?list:list.slice(0,BUY_SHOW);
  const hidden=list.length-shown.length;
  const now=list.filter(x=>x.buyByDays<=0).length;
  const week=list.filter(x=>x.buyByDays>0&&x.buyByDays<=7).length;
  const spend=list.reduce((t,x)=>t+(x.cost||0),0);
  return `<div class="panel" id="buyPanel" style="border-left:3px solid var(--amb);">
    <div class="ph"><span class="t">What to buy</span>
      <span class="sub">${fmt(list.length)} part${list.length===1?'':'s'} · about ${gbp(spend)} — the Planner's numbers</span>
      ${now?`<span class="chip bad">${fmt(now)} order now</span>`:''}
      ${week?`<span class="chip warn">${fmt(week)} this week</span>`:''}
      <div class="r"><button class="btn sm" title="Copies part · units · supplier · cases, ready to paste into the Google Sheet" onclick="LV3.copyBuyList()">Copy for the sheet</button></div>
    </div>
    <table><thead><tr>
      <th class="l" style="width:220px">Part</th>
      <th style="width:78px">On hand</th>
      <th style="width:84px">Coming</th>
      <th style="width:74px">Cover</th>
      <th class="l" style="width:168px">Route</th>
      <th style="width:104px">Order by</th>
      <th style="width:104px">Order</th>
      <th class="acts" style="width:112px"></th>
    </tr></thead><tbody>
    ${shown.map(x=>{
      const col=x.buyByDays<=0?'var(--red)':x.buyByDays<=7?'var(--amb)':'var(--text2)';
      const drv=(x.drivers||[]);
      return `<tr>
        <td class="l"><div class="pname" style="font-size:12.5px">${esc(x.o.name)}${x.chase?' <span class="chip" style="background:#2b1a3d;color:#c084fc">CHASE</span>':''}</div>
          <div class="pmeta">${esc(drv.slice(0,2).join(', '))}${drv.length>2?' +'+(drv.length-2):''} · ${(x.daily*7).toFixed(1)}/wk</div></td>
        <td><span class="num" style="color:${x.hand?'var(--text)':'var(--red)'}">${fmt(x.hand)}</span></td>
        <td>${x.inTime?`<span class="num" style="color:var(--blu)">${fmt(x.inTime)}</span>`:'<span class="dim">—</span>'}
          ${x.pendNoEta?`<div class="pmeta" style="color:var(--amb)">+${fmt(x.pendNoEta)} no ETA</div>`:''}</td>
        <td><span class="num" style="color:${col}">${x.cover!=null?fmt(Math.round(x.cover))+'d':'—'}</span></td>
        <td class="l" style="font-size:12px;color:var(--text2)">${esc(x.sup)}
          <div class="pmeta">${esc(x.route?x.route.label:'')} · ${x.lead}d${x.prodDays?' incl. '+x.prodDays+'d made-to-order':''}</div></td>
        <td><span class="num" style="color:${col};font-size:12.5px">${x.buyByDays<0?fmt(-x.buyByDays)+'d overdue':x.buyByDays===0?'today':dshort(x.buyBy)}</span>
          ${x.buyByDays<0&&x.inTime?`<div class="pmeta" style="color:var(--text3)" title="The ${fmt(x.inTime)} on the way is already counted — even after it lands, stock runs out before another order on this route could arrive. This is the order AFTER the one that's coming.">next batch — ${fmt(x.inTime)} counted</div>`:''}</td>
        <td><span class="num b">${fmt(x.buyQty)}</span>
          ${x.cases?`<div class="pmeta" style="text-align:center">${fmt(x.cases)} case${x.cases===1?'':'s'}</div>`:''}</td>
        <td class="acts"><button class="btn sm ${x.buyByDays<=0?'warn':'pri'}" onclick="LV3.openLogOrder('${x.o.id}')">Log the order</button></td>
      </tr>`;}).join('')}
    </tbody></table>
    ${(hidden>0||_buyAll)?`<div style="padding:8px 14px;border-top:1px solid var(--border);text-align:center">
      <button class="btn sm" onclick="LV3.buyToggle()">${_buyAll?`Show just the ${BUY_SHOW} most urgent`:`Show all ${fmt(list.length)} — ${fmt(hidden)} more`}</button></div>`:''}
    ${gated.length?`<div class="pmeta" style="padding:9px 14px;border-top:1px solid var(--border)">
      <b style="color:var(--amb)">${fmt(gated.length)} more part${gated.length===1?'':'s'} cannot be given a date</b> — the supplier has no route yet.
      <a href="javascript:void(0)" onclick="LV3.go('planner')" style="color:var(--blu)">Set the routes</a> and they appear here, priced and dated.</div>`:''}
    <div class="pmeta" style="padding:9px 14px;border-top:1px solid var(--border)">
      Buy enough that after it lands you hold ${cycleDaysN()} + ${safetyDays()} days, worked from the position projected at arrival and rounded to cases. Routes and timings live in <b>Settings → Who ships how</b>.</div>
  </div>`;
}
const avgCostOf=c=>{const ls=arrLayers(c).filter(l=>l.rem>0&&l.cost>0);
  if(!ls.length){const any=realLayers(c).filter(l=>l.cost>0);return any.length?any[any.length-1].cost:0;}
  return ls.reduce((s,l)=>s+l.rem*l.cost,0)/ls.reduce((s,l)=>s+l.rem,0);};
/* Damaged units, still unresolved. They arrived, so nothing is outstanding and
   nothing is being chased — which is exactly how they used to disappear. They
   are held out of sellable stock and stay here until somebody gets the money
   back, sends them away, or writes them off. The same list appears on Sarah's
   Admin page, because that is where supplier conversations happen. */
function damagedPanel(){
  const list=damagedLines();
  if(!list.length)return '';
  const units=list.reduce((t,x)=>t+x.n,0);
  const value=list.reduce((t,x)=>t+x.val,0);
  return `<div class="panel">
    <div class="ph"><span class="t" style="color:var(--amb)">Damaged stock</span>
      <span class="sub">${fmt(list.length)} deliver${list.length===1?'y':'ies'} · ${fmt(units)} unit${units===1?'':'s'} held out of stock${value?` · ${gbp(value)}`:''}</span>
      <span class="chip warn">${fmt(list.length)} to deal with</span></div>
    <div class="ordNote">These arrived, so there is nothing to chase a courier for — but they never went into sellable stock.
      They stay here until the money is back, they go away, or they are written off. <b>COG does not move</b>: the usable
      units keep their original cost and the damage sits outside it as a loss.</div>
    <table><thead><tr>
      <th style="width:74px">Counted in</th>
      <th class="l" style="min-width:220px">What is damaged</th>
      <th style="width:70px">Units</th>
      <th style="width:80px">Value</th>
      <th class="l" style="width:160px">Supplier</th>
      <th class="acts" style="width:250px"></th>
    </tr></thead><tbody>
    ${list.map(x=>{const l=x.l,age=daysSince(l.dmgOn||l.date);
      return `<tr>
        <td><span class="num" style="font-size:12.5px">${dshort(l.dmgOn||l.date)}</span>
          <div class="pmeta" style="text-align:center;color:${age>=14?'var(--red)':age>=7?'var(--amb)':'var(--text3)'}">${age===0?'today':age+'d ago'}</div></td>
        <td class="l"><div class="pname" style="font-size:12.5px">${esc(x.o.name)}</div>
          <div class="pmeta">${l.oid&&l.oid!=='—'?esc(l.oid)+' · ':''}${l.dmgBy?'found by '+esc(l.dmgBy):'ordered '+dshort(l.date)}</div>
          ${l.note?`<div class="pmeta" style="color:var(--amb)">${esc(l.note)}</div>`:''}</td>
        <td><span class="num b" style="color:var(--amb)">${fmt(x.n)}</span></td>
        <td><span class="num">${x.val>0?gbp(x.val):'—'}</span></td>
        <td class="l">${esc(l.sup||'—')}</td>
        <td class="acts">
          <button class="btn sm" title="They gave the money back" onclick="LV3.dmgEnd('${x.o.id}','${l.id}','refund')">Refunded</button>
          <button class="btn sm" title="Gone back to the supplier" onclick="LV3.dmgEnd('${x.o.id}','${l.id}','ret')">Sent back</button>
          <button class="btn sm" title="Keeping them — usually because the money is already back" onclick="LV3.dmgEnd('${x.o.id}','${l.id}','keep')">Kept</button>
          <button class="btn sm dgr" title="Nothing comes back for these" onclick="LV3.dmgEnd('${x.o.id}','${l.id}','binned')">Write off</button>
        </td></tr>`;}).join('')}
    </tbody></table>
  </div>`;
}
function shortPanel(){
  const list=shortLines();
  if(!list.length)return '';
  const units=list.reduce((t,x)=>t+x.l.qty,0);
  const value=list.reduce((t,x)=>t+x.l.qty*(x.l.cost||0),0);
  const bySup={};
  list.forEach(x=>{const k=x.l.sup||'—';bySup[k]=(bySup[k]||0)+x.l.qty;});
  const worst=Object.keys(bySup).sort((a,b)=>bySup[b]-bySup[a]).slice(0,3);
  return `<div class="panel" id="shortPanel" style="border-left:3px solid var(--red);">
    <div class="ph"><span class="t" style="color:var(--red)">Short deliveries</span>
      <span class="sub">${fmt(list.length)} order${list.length===1?'':'s'} arrived light · ${fmt(units)} units · ${gbp(value)} paid for and not here</span>
      ${worst.length>1?`<span class="chip warn" title="${worst.map(w=>esc(w)+': '+fmt(bySup[w])).join(' · ')}">worst: ${esc(worst[0])}</span>`:''}
    </div>
    <div class="tblScroll"><table><thead><tr>
      <th style="width:74px">Noticed</th>
      <th class="l" style="width:220px">What's missing</th>
      <th style="width:70px">Short</th>
      <th style="width:80px">Value</th>
      <th class="l" style="width:150px">Supplier</th>
      <th class="l" style="width:150px">Chasing</th>
      <th class="acts" style="width:186px"></th>
    </tr></thead><tbody>
    ${list.map(x=>{const l=x.l;
      const age=daysSince(l.shortOn||l.date);
      const chased=l.chased?daysSince(l.chased):null;
      return `<tr class="${(l.repl&&l.repl.qty>0)?'ordRow st-repl':''}">
        <td><span class="num" style="font-size:12.5px">${dshort(l.shortOn||l.date)}</span>
          <div class="pmeta" style="text-align:center;color:${age>=14?'var(--red)':age>=7?'var(--amb)':'var(--text3)'}">${age===0?'today':age+'d ago'}</div></td>
        <td class="l"><div class="pname" style="font-size:12.5px">${esc(x.o.name)}</div>
          <div class="pmeta">${l.oid&&l.oid!=='—'?esc(l.oid)+' · ':''}ordered ${dshort(l.date)}</div></td>
        <td><span class="num b" style="color:var(--red)">${fmt(l.qty)}</span></td>
        <td><span class="num">${l.cost>0?gbp(l.qty*l.cost):'—'}</span></td>
        <td class="l">${esc(l.sup||'—')}</td>
        <td class="l">${(()=>{
          /* A promised replacement is an ANSWER, not a stall — it stops being
             chased and goes quiet grey until the box turns up. */
          if(l.repl&&l.repl.qty>0)return `<span style="color:var(--text3);font-weight:700;font-size:12px">Replacement due</span>
            <div class="pmeta" style="margin:2px 0 0">${fmt(l.repl.qty)} agreed ${dshort(l.repl.on)}${l.repl.by?' · '+esc(l.repl.by):''}${l.repl.note?`<br>${esc(l.repl.note)}`:''}</div>`;
          const st=shortState(l);
          return `<span style="color:${st.col};font-weight:700;font-size:12px">${st.label}</span>
            <div class="pmeta" style="margin:2px 0 0">${
              st.k==='decide'?`${age} days old — chase it again or close it off`
              :st.k==='noreply'?`reply was due ${dshort(l.replyBy)}`
              :l.chased?`chased ${chased===0?'today':chased+'d ago'}${l.replyBy?` · reply due ${dshort(l.replyBy)}`:''}`
              :'nobody has asked yet'}</div>`;})()}</td>
        <td class="acts">
          <button class="btn sm" title="Record that you've asked — sets a reply-by date three working days out"
            onclick="LV3.markChased('${x.o.id}','${l.id}')">${l.chased?'Chased again':'Chased'}</button>
          <button class="btn sm go" title="It turned up after all" onclick="LV3.openReceive('${comp(x.o.id)?'component':'product'}','${x.o.id}','${l.id}')">Receive</button>
          <select class="in" style="width:98px;font-size:12px" title="How it was resolved"
            onchange="if(this.value)LV3.shortMore('${x.o.id}','${l.id}',this.value);this.value=''">
            <option value="">More…</option>
            <option value="repl">${l.repl?'Change replacement':'Replacement coming'}</option>
            <option value="auto">Auto refunded</option>
            <option value="refund">Refunded</option>
            <option value="miscount">Miscount</option>
            <option value="writeoff">Write off</option>
          </select>
        </td></tr>`;}).join('')}
    </tbody></table></div>
    <div class="pmeta" style="padding:9px 14px;border-top:1px solid var(--border)">
      These are still counted as <b>on order</b>, so they still show as incoming. Write one off and it stops counting.</div>
  </div>`;
}
/* Three working days from today — the only extra thing anyone has to think
   about when they chase, and the thing that stops a shortfall drifting. */
function replyByDate(days){
  const d=new Date(TODAY);let left=days||3;
  while(left>0){d.setDate(d.getDate()+1);const w=d.getDay();if(w!==0&&w!==6)left--;}
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
/* Where a shortfall is up to. Age is measured from the day it was noticed and
   NEVER from its value — £1 missing and £400 missing hit the same wall on the
   same day, because a supplier who is casual about £1 is the problem either way. */
function shortState(l){
  const age=daysSince(l.shortOn||l.date);
  if(age>=21)return{k:'decide',label:'Needs a decision',col:'var(--red)',ord:0};
  if(l.replyBy&&l.replyBy<dayISO())return{k:'noreply',label:'No reply',col:'var(--red)',ord:1};
  if(!l.chased)return{k:'new',label:'Not chased yet',col:'var(--amb)',ord:2};
  return{k:'waiting',label:'Waiting on them',col:'var(--text2)',ord:3};
}
function shortMore(oid,lid,k){
  if(k==='repl')return openRepl(oid,lid);
  if(k==='writeoff')return writeOffShort(oid,lid);
  return shortEnd(oid,lid,k);
}
function markChased(oid,lid){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  l.chased=dayISO();l.chasedBy=(window.currentUserName||'someone');
  l.replyBy=replyByDate(3);
  logIt('edit',`Chased ${o.name} — ${fmt(l.qty)} short from ${l.sup||'supplier'}, reply due ${dshort(l.replyBy)}`);
  save();render();toast(`Chase recorded — reply due ${dshort(l.replyBy)}`,'ok');
}
/* The endings. Without them "resolved" only ever meant somebody deleted the row,
   and you lost the one thing worth knowing: which suppliers actually make good. */
function shortEnd(oid,lid,kind){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  const who=(window.currentUserName||'someone');
  /* Becki: Amazon and some suppliers refund short units automatically, before
     anybody has asked. Those are not a problem anybody needs to chase — and
     sending them to Sarah as "missing" costs her real time on something that is
     already settled. It closes on the spot and never reaches her. */
  const words={refund:'Refunded or credited',miscount:'Miscount — it was here all along',
    auto:'Auto refunded by the supplier — no chase needed'};
  const val=l.cost>0?gbp(l.qty*l.cost):'';
  const titles={refund:'Money back?',miscount:'Was it a miscount?',auto:'Auto refunded?'};
  const blurb={
    refund:'This closes the shortfall and stops it counting as incoming. Record it once the credit is actually confirmed.',
    miscount:'This closes the shortfall and stops it counting as incoming. The stock was never missing, so nothing is written off.',
    auto:'The supplier refunded these on their own — nothing was ever wrong and nobody needs to chase it. It closes here and never reaches Sarah.'};
  confirmBox(titles[kind]||'Close this off?',
    `<div style="margin-bottom:10px"><b>${fmt(l.qty)} × ${esc(o.name)}</b> from <b>${esc(l.sup||'the supplier')}</b>${val?` — ${val}`:''}.</div>
     <div class="pmeta" style="margin:0">${blurb[kind]||''}</div>`,
    ()=>{
      snap();
      l.short=0;l.writtenOff=1;
      l.shortEnd={k:kind,on:dayISO(),by:who};
      /* flagged so the reporting can tell "the supplier put it right on their
         own" apart from "we had to go and get our money back" */
      if(kind==='auto')l.autoRefund={on:dayISO(),by:who,units:l.qty,value:l.cost>0?l.qty*l.cost:0};
      logIt('edit',`${words[kind]} — ${fmt(l.qty)} × ${o.name} from ${l.sup||'supplier'}${val?' ('+val+')':''} · ${who}`);
      save();render();
      toastUndo(kind==='auto'?'Recorded as auto refunded — not sent to Sarah'
        :kind==='refund'?'Recorded as refunded':'Recorded as a miscount','ok');
    },{ok:kind==='auto'?'Yes, it was auto refunded':kind==='refund'?'Yes, it was refunded':'Yes, it was a miscount'});
}
function writeOffShort(oid,lid){
  const o=comp(oid)||prod(oid);if(!o)return;
  const l=(o.layers||[]).find(x=>x.id===lid);if(!l)return;
  confirmBox('Write this off?',
    `<div style="margin-bottom:10px"><b>${fmt(l.qty)} × ${esc(o.name)}</b> from <b>${esc(l.sup||'the supplier')}</b>${l.oid&&l.oid!=='—'?` (${esc(l.oid)})`:''}.</div>
     <div style="margin-bottom:10px">This says it is never turning up. It stops counting as incoming, so anything relying on it
       — buildable numbers, targets — drops accordingly.</div>
     ${l.cost>0?`<div class="note bad" style="margin:0"><b>${gbp(l.qty*l.cost)}</b> was paid for this. Worth a refund or credit note before writing it off.</div>`:''}`,
    ()=>{
      snap();
      l.writtenOff=dayISO();l.qty=0;l.short=0;
      logIt('edit',`Wrote off ${fmt(l.shortQty||0)} × ${o.name} — never arrived from ${l.sup||'supplier'}`);
      save();render();toastUndo('Written off','ok');
    },{danger:true,ok:'Write it off'});
}
/* Why this delivery matters. 600 gloves that free up four blocked bundles is a
   different thing from 60 nozzles nothing uses, and the table said neither. */
function unlocks(x){
  if(x.kind!=='component'){
    const p=x.o;const a=avail(p);
    return{blocked:a.n===0?[p]:[],adds:x.l.qty,uses:[]};
  }
  const c=x.o,users=usedIn(c.id);
  const blocked=users.filter(p=>{const a=avail(p);return a.kind!=='norecipe'&&a.n===0&&a.limiter===c.id;});
  /* how many more of each bundle this delivery makes possible */
  const adds=users.map(p=>{const r=p.recipe.find(y=>y.c===c.id);
    return r?Math.floor(x.l.qty/r.q):0;}).sort((a,b)=>b-a)[0]||0;
  return{blocked,adds,uses:users};
}
function deliveriesPanel(){
  /* Becki: pressing "Book it in and close the order" left the order sitting in
     On order. It was doing what it said — the units ARE still owed, so they
     still count as incoming — but the delivery is finished and nobody is
     waiting for a van any more. It belongs in Short deliveries, where it is
     being chased, and nowhere else. It stays out of this table and is counted
     separately in the heading, so the units are never lost, just not pretending
     to be an outstanding delivery.
     Filtered HERE and not in inboundAll(), because restock forecasting still
     needs to know those units are owed. */
  const shortLines_=inboundAll().filter(x=>x.l.short&&!x.l.writtenOff);
  const shortUnits=shortLines_.reduce((t,x)=>t+outQty(x.l),0);
  const open=inboundAll().filter(x=>!x.l.short).slice().sort((a,b)=>{
    /* keep an order's lines together, soonest order first */
    const ka=(a.l.oid||'~')+'',kb=(b.l.oid||'~')+'';
    const ea=(a.l.eta2||a.l.eta1||'9999'),eb=(b.l.eta2||b.l.eta1||'9999');
    return ea.localeCompare(eb)||ka.localeCompare(kb)||a.l.date.localeCompare(b.l.date);});
  const late=open.filter(x=>etaState(x.l).k==='late').length;
  const orderCount=new Set(open.map(x=>(x.l.oid&&x.l.oid!=='—')?x.l.oid:'x'+x.l.id)).size;
  const soon=open.filter(x=>etaState(x.l).k==='soon').length;
  const units=open.reduce((t,x)=>t+(x.l.qty||0),0);
  const value=open.reduce((t,x)=>t+(x.l.qty||0)*(x.l.cost||0),0);
  return `<div class="panel" id="onOrderPanel">
    <div class="ph"><span class="t">On order</span>
      <span class="sub">${open.length?`${fmt(orderCount)} order${orderCount===1?'':'s'} · ${fmt(open.length)} line${open.length===1?'':'s'} · ${fmt(units)} units${value?` · ${gbp(value)}`:''}`:'nothing outstanding'}</span>
      ${late?`<span class="chip bad">${fmt(late)} overdue</span>`:''}
      ${soon?`<span class="chip warn">${fmt(soon)} due this week</span>`:''}
      ${shortLines_.length?`<span class="chip" style="background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.45);color:#fca5a5"
        title="Finished deliveries that came up short. Still owed and still counted — being chased in Short deliveries above, not waiting on a van.">+${fmt(shortUnits)} short, being chased</span>`:''}
      <div class="r"><button class="btn sm" onclick="LV3.openLogOrder()">+ Log an order</button>
        ${open.length>1?`<button class="btn sm" title="Tick several at once instead of one row at a time" onclick="LV3.openDeliveries()">Receive several</button>`:''}</div></div>
    ${open.length?`<div class="ordNote">Grouped by order — the same orders you linked above. Change the number if only part of it turned up, then press <b>Receive</b>. For a whole box at once use <b>Receive several</b>.</div>
    <div class="tblScroll"><table class="stickHead dlvTbl"><thead><tr>
      <th class="l" style="min-width:230px">What's coming</th>
      <th style="width:104px" title="The original order. This never changes as deliveries come in — what has been counted in and what is still owed are shown underneath it.">Ordered</th>
      <th style="width:82px">Unit</th>
      <th class="l" style="width:140px">Supplier</th>
      <th style="width:96px">Order date</th>
      <th class="l" style="width:158px">How</th>
      <th class="l" style="width:190px">Expected</th>
      <th style="width:104px" title="How many are being counted in RIGHT NOW. It is filled in with everything still owed — change it if only part of that has turned up. It is not a record of what has already arrived; that is under Ordered.">Arriving now</th>
      <th class="acts" style="width:96px"></th></tr></thead><tbody>
    ${open.map(x=>{const l=x.l,e=etaState(l),st=orderState(l);
      return `<tr class="ordRow st-${st.k}">
        <td class="l"><div class="pname" style="font-size:12.5px">${esc(x.o.name)}</div>
          <div style="margin-top:3px"><span class="chip ${x.kind==='product'?'pl':'component'}">${x.kind==='product'?'Finished stock':'Component'}</span>
            ${st.k!=='open'?`<span class="ordSt ${st.k}" title="${esc(st.why||'')}">${st.label}</span>`:''}
            ${l.manual?`<span class="chip warn" title="Typed in by hand — ${esc(l.why||'no reason given')}${l.whoAdded?' · '+esc(l.whoAdded):''}">added by hand</span>`:''}
            ${l.oid&&l.oid!=='—'?`<span class="pmeta" style="margin:0 0 0 5px">${esc(l.oid)}</span>`:''}</div>
          ${l.manual&&l.why?`<div class="pmeta" style="margin-top:3px;color:var(--amb)">${esc(l.why)}</div>`:''}
          ${st.why&&st.k!=='part'?`<div class="pmeta" style="margin-top:3px">${esc(st.why)}</div>`:''}</td>
        ${/* Ordered on top, then what has come in and what is still owed. The
              outstanding number is never something anybody has to work out. */''}
        ${/* The original order, and it stays the original order. It used to fall
              back to `qty`, which becomes "what is still owed" the moment
              anything is counted in — so an order of 30 with 15 received
              reported itself as an order of 15. */''}
        <td><span class="num">${fmt(ordQty(l))}</span>
          ${rcvdQty(l)?`<div class="ordSplit"><span class="ok">${fmt(rcvdQty(l))} in</span>
            <span class="${outQty(l)?'out':''}">${fmt(outQty(l))} left</span></div>`
            :`<div class="pmeta" style="margin:2px 0 0;text-align:center">ordered</div>`}
          ${/* Jack, 3 Sep: "400 units — is that 4 cases of 100 or 2 of 200?"
                Counting a delivery is counting BOXES, so the box maths is done
                here rather than in his head. Case size already lives on the
                component (caseQty), so nothing new had to be stored. */''}
          ${(()=>{const cq=parseInt(x.o&&x.o.caseQty)||0;if(cq<2)return'';
            const n=ordQty(l),full=Math.floor(n/cq),rem=n%cq;
            if(full<1)return'';                       /* under a full case — "0 × 100" helps nobody */
            return `<div class="ordCases" title="Case size ${fmt(cq)} — set on the component">${fmt(full)} case${full===1?'':'s'} of ${fmt(cq)}${rem?` + ${fmt(rem)}`:''}</div>`;})()}</td>
        <td>${l.cost>0?`<span class="num quiet">${gbp(l.cost)}</span>`:'<span class="dim" style="font-size:11.5px">no price</span>'}</td>
        <td class="l">${esc(l.sup||'—')}
          ${(()=>{const u=unlocks(x);
            if(u.blocked.length)return `<div class="unlk bad" title="${esc(u.blocked.map(p=>p.name).join(', '))}">frees up ${fmt(u.blocked.length)} blocked product${u.blocked.length===1?'':'s'}</div>`;
            if(u.uses.length)return `<div class="unlk">makes ~${fmt(u.adds)} more · used in ${fmt(u.uses.length)}</div>`;
            return `<div class="unlk dim">not used in anything yet</div>`;})()}</td>
        <td><span class="pmeta" style="margin:0">${dshort(l.date)}</span></td>
        <td class="l" onclick="event.stopPropagation()">
          ${(()=>{
            /* The dropdown used to fall back to "courier" when nothing was
               chosen, so an Alibaba order silently claimed it would land in
               1–4 days. When the supplier is set to ask every time, the cell
               starts empty and says so until somebody picks. */
            const needsPick=lineNeedsRoute(l);
            return `<select class="in etaSel${needsPick?' needPick':''}"
              onchange="LV3.setEta('${x.kind}','${x.o.id}','${l.id}','mode',this.value)">
              ${needsPick?`<option value="" selected>${supplierAsks(l.sup)?'— how did it come? —':'— pick how it\'s coming —'}</option>`:''}
              ${shipModes().map(m=>`<option value="${m.k}" ${((needsPick?'':(l.mode||'courier'))===m.k)?'selected':''}>${esc(m.label.split('—')[0].trim())}</option>`).join('')}
            </select>${modeHint(l,needsPick)}`;})()}</td>
        <td class="l" onclick="event.stopPropagation()">
          <div style="display:flex;gap:5px;align-items:center">
            <input class="in etaDM" value="${dmOf(l.eta1)}" placeholder="dd/mm" title="Earliest it might arrive"
              onchange="LV3.setEtaDM('${x.kind}','${x.o.id}','${l.id}','eta1',this.value)">
            <span class="pmeta" style="margin:0">–</span>
            <input class="in etaDM" value="${dmOf(l.eta2)}" placeholder="dd/mm" title="Latest it should arrive"
              onchange="LV3.setEtaDM('${x.kind}','${x.o.id}','${l.id}','eta2',this.value)">
          </div>
          <div class="pmeta" style="margin:4px 0 0;color:${e.col};font-weight:700">${e.sub||e.txt}</div></td>
        <td onclick="event.stopPropagation()">
          <input class="in num rcvQty" type="number" min="0" value="${l.qty}" id="rcv-${l.id}"
            title="How many are being counted in now — change it if only part of what is owed has turned up">
          <div class="pmeta" style="margin:3px 0 0;text-align:center">of ${fmt(outQty(l))} still owed</div></td>
        <td class="acts" onclick="event.stopPropagation()">
          <button class="btn sm go" title="Count it in — asks what actually arrived before anything is booked"
            onclick="LV3.openReceive('${x.kind}','${x.o.id}','${l.id}')">${rcvdQty(l)?'Receive more':'Receive'}</button>
          ${l.short?`<button class="btn sm" style="margin-top:4px" title="More turned up after all — withdraws the shortfall and puts it back on order"
            onclick="LV3.undeclareShort('${x.o.id}','${l.id}')">More came</button>`:''}</td>
      </tr>`;}).join('')}
    </tbody></table></div>`
    :`<div class="empty">Nothing on order.
       <div class="pmeta" style="margin-top:7px">Log what's been bought and it sits here with its expected dates until it turns up.</div></div>`}
  </div>`;
}
/* Two jobs, not one. Whoever is in the unit says "this turned up" the moment a
   box lands — that is all they know and all they should have to do. Counting it
   in is a separate job, done against the box, and only that second step turns it
   into usable stock. Doing both in one action meant a delivery either sat
   unrecorded until someone had time to count it, or got waved through at the
   ordered quantity and the shortfall was never noticed. */
function dlvArrived(lid,on){
  if(lavGate(()=>dlvArrived(lid,on)))return;
  let hit=null;
  D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{if(l.id===lid)hit={o,l};}));
  if(!hit)return;
  const who=(window.currentUserName||'someone');
  if(on===false){delete hit.l.arrivedOn;delete hit.l.arrivedBy;}
  else{hit.l.arrivedOn=dayISO();hit.l.arrivedBy=who;
    logIt('recv',`Arrived — ${hit.o.name}${hit.l.sup?' from '+hit.l.sup:''} · marked by ${who}, not counted yet`);}
  save();openDeliveries();
}
function dlvArrivedOrder(key){
  if(lavGate(()=>dlvArrivedOrder(key)))return;
  (window._dlvWait||[]).forEach(x=>{
    const k=(x.l.oid&&x.l.oid!=='—')?x.l.oid:('#'+x.l.id);
    if(k!==key)return;
    x.l.arrivedOn=dayISO();x.l.arrivedBy=(window.currentUserName||'someone');
  });
  save();openDeliveries();
}
/* which week a delivery falls in, so the list reads as "what is coming and when" */
let _dlvPast=false;
function dlvPast(){_dlvPast=!_dlvPast;openDeliveries();}
function dlvBucket(l){
  const e=l.eta2||l.eta1;
  if(!e)return{k:'none',label:'No date given',ord:5};
  const d=Math.round((new Date(e+'T00:00:00Z')-new Date(dayISO()+'T00:00:00Z'))/864e5);
  if(d<0)return{k:'late',label:'Overdue',ord:0};
  if(d===0)return{k:'today',label:'Due today',ord:1};
  if(d<=7)return{k:'week',label:'This week',ord:2};
  if(d<=14)return{k:'next',label:'Next week',ord:3};
  return{k:'later',label:'Later',ord:4};
}
function openDeliveries(){
  const all=inboundAll().slice().sort((a,b)=>{
    const ea=(a.l.eta2||a.l.eta1||'9999'),eb=(b.l.eta2||b.l.eta1||'9999');
    return ea.localeCompare(eb)||(a.l.date||'').localeCompare(b.l.date||'');});
  const open=all.filter(x=>x.l.arrivedOn);        // arrived, waiting to be counted in
  const waiting=all.filter(x=>!x.l.arrivedOn);    // still out there
  window._dlv=open;window._dlvWait=waiting;
  const late=waiting.filter(x=>etaState(x.l).k==='late').length;
  const gval=list=>list.reduce((t,x)=>t+(x.l.qty||0)*(x.l.cost||0),0);
  const gunits=list=>list.reduce((t,x)=>t+(x.l.qty||0),0);

  /* section 2 — everything still out there, grouped by when it is due */
  const groups={};
  waiting.forEach(x=>{const b=dlvBucket(x.l);(groups[b.k]=groups[b.k]||{...b,rows:[]}).rows.push(x);});
  const waitHtml=Object.values(groups).sort((a,b)=>a.ord-b.ord).map(g=>{
    const byOrd={};
    g.rows.forEach(x=>{const k=(x.l.oid&&x.l.oid!=='—')?x.l.oid:('#'+x.l.id);
      (byOrd[k]=byOrd[k]||{key:k,sup:x.l.sup||'—',date:x.l.date,rows:[]}).rows.push(x);});
    return `<div class="dvGrp dv-${g.k}">
      <div class="dvGrpHead"><span class="dvDot"></span><b>${g.label}</b>
        <span class="dvGrpSub">${fmt(g.rows.length)} line${g.rows.length===1?'':'s'} · ${fmt(gunits(g.rows))} units · ${gbp(gval(g.rows))}</span></div>
      ${Object.values(byOrd).map(o=>`<div class="dvOrd">
        <div class="dvOrdHead">
          <b>${esc(o.sup)}</b>
          <span>${o.key.startsWith('#')?'no order ref':'order '+esc(o.key)} · ordered ${dshort(o.date)}</span>
          <button class="btn sm go" onclick="LV3.dlvArrivedOrder('${esc(o.key).replace(/'/g,"\\'")}')">Whole order arrived</button>
        </div>
        ${o.rows.map(x=>{const e=etaState(x.l);
          return `<div class="dvRow">
            <div class="dvNm"><span class="pname">${esc(x.o.name)}</span>
              <div class="pmeta">${fmt(outQty(x.l))} units${rcvdQty(x.l)?` still owed of ${fmt(ordQty(x.l))}`:''}${x.l.cost>0?' @ '+gbp(x.l.cost):''}
                ${(()=>{const u=unlocks(x);
                  if(u.blocked.length)return `· <b style="color:var(--grn)">unblocks ${esc(u.blocked[0].name)}</b>`;
                  if(u.uses.length)return `· makes ~${fmt(u.adds)} more ${esc(u.uses[0].name)}`;return'';})()}</div></div>
            <div class="dvEta" style="color:${e.col}">${e.txt}<div class="pmeta" style="margin:0">${e.sub||''}</div></div>
            <div class="dvQty"><span class="num">${fmt(outQty(x.l))}</span><div class="pmeta" style="margin:0">${rcvdQty(x.l)?'still owed':'ordered'}</div></div>
            <button class="btn sm hereBtn" onclick="LV3.dlvArrived('${x.l.id}')">It's here</button>
          </div>`;}).join('')}
      </div>`).join('')}
    </div>`;}).join('');

  const body=(open.length||waiting.length)?`
    ${/* The two jobs, as numbers, before any prose. This used to open with three
         stacked paragraphs and a sentence pointing at "the step above" that was
         not on screen when nothing had arrived yet. */''}
    <div class="dvTop">
      <div class="dvTile ${open.length?'act':''}">
        <i>To count in</i><b>${fmt(open.length)}</b>
        <span>${open.length?`${fmt(gunits(open))} units · ${gbp(gval(open))}`:'nothing waiting'}</span>
      </div>
      <div class="dvTile">
        <i>Still on its way</i><b>${fmt(waiting.length)}</b>
        <span>${fmt(gunits(waiting))} units · ${gbp(gval(waiting))}</span>
      </div>
      <div class="dvTile ${late?'bad':''}">
        <i>Overdue</i><b>${fmt(late)}</b>
        <span>${late?'past the expected date':'all on time'}</span>
      </div>
    </div>
    ${open.length?`<div class="dvSecHead"><b>Arrived — waiting to be counted in</b>
      <span>${fmt(open.length)} line${open.length===1?'':'s'} · ${fmt(gunits(open))} units · ${gbp(gval(open))}</span>
      <span class="dvHint">Count what is actually in the box, then <b>Receive selected</b>. Anything short stays on order to chase.</span></div>
    <div class="dvCount">
    ${open.map((x,i)=>{
      const days=Math.floor((TODAY-new Date(x.l.date))/864e5);
      const late=days>=21;
      const key=(x.l.oid&&x.l.oid!=='—')?x.l.oid:('#'+x.l.id);
      const prev=i>0?((open[i-1].l.oid&&open[i-1].l.oid!=='—')?open[i-1].l.oid:('#'+open[i-1].l.id)):null;
      const head=key!==prev?`<div class="dlvOrd">
        <b>${esc(x.l.sup||'—')}</b>
        <span>${x.l.oid&&x.l.oid!=='—'?'order '+esc(x.l.oid):'no order ref'} · ordered ${dshort(x.l.date)}</span>
        <button class="btn sm" onclick="LV3.dlvPickOrder('${esc(key)}')">Tick this order</button></div>`:'';
      const e=etaState(x.l);
      return head+`<div style="display:grid;grid-template-columns:26px minmax(0,1fr) 96px 128px 128px 118px;gap:11px;align-items:center;
        padding:11px 13px;border-bottom:1px solid var(--border);${e.k==='late'?'background:rgba(248,113,113,.08);':''}">
        <input type="checkbox" id="dlv-ck-${i}" checked onchange="LV3.dlvSum()">
        <div style="min-width:0">
          <div class="pname" style="font-size:13px">${esc(x.o.name)}
            <span class="chip ${x.kind==='product'?'pl':'component'}">${x.kind==='product'?'Finished stock':'Component'}</span></div>
          <div class="pmeta">${esc(x.l.sup||'—')}${x.l.oid&&x.l.oid!=='—'?' · '+esc(x.l.oid):''} · ordered ${dshort(x.l.date)}
            ${late?`· <b style="color:var(--red)">${days}d waiting</b>`:`· ${days}d ago`}</div>
          ${x.l.manual&&x.l.why?`<div class="pmeta" style="color:var(--amb)">added by hand — ${esc(x.l.why)}${x.l.whoAdded?` (${esc(x.l.whoAdded)})`:''}</div>`:''}
          ${(()=>{const u=unlocks(x);
            if(u.blocked.length)return `<div class="unlk bad">unblocks ${esc(u.blocked.map(p=>p.name).slice(0,2).join(', '))}${u.blocked.length>2?` +${u.blocked.length-2}`:''}</div>`;
            if(u.uses.length)return `<div class="unlk">makes ~${fmt(u.adds)} more ${esc(u.uses[0].name)}</div>`;
            return '';})()}
          <div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${modeChip(x.l)}
            ${(()=>{const e=etaState(x.l);return `<span class="pmeta" style="margin:0;color:${e.col};font-weight:700">${e.txt}${e.sub?` · ${e.sub}`:''}</span>`;})()}</div></div>
        <div style="text-align:right"><span class="pmeta" style="margin:0">${rcvdQty(x.l)?'still owed':'ordered'}</span>
          <div class="num">${fmt(outQty(x.l))}</div>
          ${(()=>{const cq=parseInt(x.o&&x.o.caseQty)||0;if(cq<2)return'';
            const n=outQty(x.l),full=Math.floor(n/cq),rem=n%cq;
            if(full<1)return'';
            return `<div class="pmeta" style="margin:1px 0 0;color:#93c5fd;font-weight:700" title="Case size ${fmt(cq)}">${fmt(full)} case${full===1?'':'s'} of ${fmt(cq)}${rem?` + ${fmt(rem)}`:''}</div>`;})()}
          ${rcvdQty(x.l)?`<div class="pmeta" style="margin:2px 0 0;color:var(--grn)">${fmt(rcvdQty(x.l))} of ${fmt(ordQty(x.l))} already in</div>`:''}</div>
        <div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
          <span class="pmeta" style="margin:0">received</span>
          <input class="in num" type="number" min="0" value="${x.l.qty}" id="dlv-q-${i}"
            style="width:70px;text-align:center;padding:6px" oninput="LV3.dlvSum()"
            onkeydown="if(event.key==='Enter'){event.preventDefault();const n=document.getElementById('dlv-q-${i+1}');if(n){n.focus();n.select();}else{const g=document.getElementById('dlvGo');if(g&&!g.disabled)g.focus();}}"></div>
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <span class="pmeta" style="margin:0">landed</span>
          <input class="in" type="date" id="dlv-d-${i}" value="${x.l.arrivedOn||dayISO()}" max="${dayISO()}"
            style="width:120px;padding:5px 6px;font-size:11px" onchange="LV3.dlvSum()"></div>
        <div id="dlv-n-${i}" style="font-size:11.5px;text-align:right;color:var(--text2)"></div>
      </div>`;}).join('')}
    </div>`:''}
    ${(()=>{
      /* Everything received, newest first. "Did that Superdrug box ever land?"
         was a question this screen could not answer — you had to go hunting
         through History. Folded by default so it never gets in the way of the
         two live jobs above it. */
      const done=[];
      D.components.concat(D.products).forEach(o=>(o.layers||[]).forEach(l=>{
        if(l.arr&&l.recvOn)done.push({o,l});}));
      done.sort((a,b)=>String(b.l.recvOn).localeCompare(String(a.l.recvOn)));
      if(!done.length)return '';
      const units=done.reduce((t,x)=>t+(x.l.qty||0),0);
      const val=done.reduce((t,x)=>t+(x.l.qty||0)*(x.l.cost||0),0);
      const show=_dlvPast?done.slice(0,80):[];
      return `<div class="dvSecHead" style="margin-top:${(open.length||waiting.length)?'18px':'0'};cursor:pointer"
          onclick="LV3.dlvPast()">
          <b>${_dlvPast?'&#9662;':'&#9656;'} Already received</b>
          <span>${fmt(done.length)} line${done.length===1?'':'s'} · ${fmt(units)} units · ${gbp(val)}</span>
          <span class="dvHint">${_dlvPast?'hide':'show'}</span></div>
        ${_dlvPast?`<div class="dvGrp"><div class="dvGrpHead"><span class="dvDot" style="background:var(--grn)"></span>
          <b>Most recent first</b><span class="dvGrpSub">showing ${fmt(show.length)} of ${fmt(done.length)}</span></div>
          ${show.map(x=>`<div class="dvRow">
            <div class="dvNm"><span class="pname">${esc(x.o.name)}</span>
              <div class="pmeta">${fmt(x.l.qty)} units${x.l.cost>0?' @ '+gbp(x.l.cost):''}${x.l.sup?' · '+esc(x.l.sup):''}${x.l.oid&&x.l.oid!=='—'?' · '+esc(x.l.oid):''}</div></div>
            <div class="dvEta" style="color:var(--grn)">landed ${dshort(x.l.recvOn)}
              <div class="pmeta" style="margin:0">${x.l.recvBy?'by '+esc(x.l.recvBy):''}${x.l.short?' · was short':''}</div></div>
            <div class="dvQty"><span class="num">${fmt(x.l.rem)}</span><div class="pmeta" style="margin:0">left</div></div>
            <span></span>
          </div>`).join('')}
          ${done.length>show.length?`<div class="pmeta" style="padding:9px 12px">${fmt(done.length-show.length)} older not shown — the full record is on the History tab.</div>`:''}
        </div>`:''}`;})()}
    ${waiting.length?`<div class="dvHint" style="margin:0 0 10px">Press <b>It's here</b> the moment a box lands${open.length?' — then count it in at the top':''}.${late?` If a supplier is always late, set their method in <b>Settings</b> so the dates stop lying.`:''}</div>
    ${waitHtml}`:''}`
    :(()=>{
        const waiting=reviewOrders();
        /* Empty here almost always means the purchases exist but nobody has said
           what they are yet — saying so beats a shrug. */
        if(waiting.length){
          const lines=waiting.reduce((t,o)=>t+o.lines.length,0);
          const val=waiting.reduce((t,o)=>t+o.value,0);
          return `<div class="dlvEmpty">
            <div class="deIcon" style="opacity:.85">🔗</div>
            <div class="deT">Nothing on order — but ${fmt(waiting.length)} order${waiting.length===1?'':'s'} ${waiting.length===1?'is':'are'} waiting to be linked</div>
            <div class="deB">${fmt(lines)} line${lines===1?'':'s'} worth <b>${gbp(val)}</b> came off the sheet but nobody has said what
              they are yet. A purchase only becomes <b>on order</b> once it is linked to a component or product — that is what puts it here.</div>
            <div class="deSteps">
              <div><b>1</b> Purchases → <b>To review</b> → say what each line is</div>
              <div><b>2</b> It becomes <b>on order</b> with an expected date</div>
              <div><b>3</b> When the box turns up, receive it here</div>
            </div>
            <div class="deBtns">
              <button class="btn pri" onclick="LV3.cm('lav3Ov1');LV3.go('purchases')">Link them now</button>
              <button class="btn" onclick="LV3.cm('lav3Ov1');LV3.openLogOrder()">+ Log an order</button>
            </div></div>`;
        }
        return `<div class="dlvEmpty">
          <div class="deIcon">📦</div>
          <div class="deT">Nothing waiting to be received</div>
          <div class="deB">This is where stock <b>becomes usable</b>. Anything on order turns up here, you tick what
            physically arrived, and it lands as priced stock ready to build with.</div>
          <div class="deSteps">
            <div><b>1</b> A purchase is logged — synced from the sheet, or typed in with <b>+ Order</b></div>
            <div><b>2</b> It is linked, and shows as <b>on order</b> on the Purchases tab</div>
            <div><b>3</b> When the box arrives, you receive it here</div>
          </div>
          <div class="deBtns">
            <button class="btn pri" onclick="LV3.cm('lav3Ov1');LV3.openLogOrder()">+ Log an order</button>
            <button class="btn" onclick="LV3.cm('lav3Ov1');LV3.go('purchases')">Go to Purchases</button>
          </div></div>`;})();
  $('lav3Mod1').className='mod xl';
  $('lav3Mod1').innerHTML=`
    <div class="mh"><h3>Deliveries</h3>
      ${(open.length||waiting.length)?`<span class="pmeta" style="margin:0">${open.length?`<b style="color:var(--grn)">${fmt(open.length)} to count in</b> · `:''}${fmt(waiting.length)} on the way${late?` · <b style="color:var(--red)">${fmt(late)} overdue</b>`:''}</span>
        <button class="btn sm" style="margin-left:auto" onclick="LV3.openLogOrder()">+ Log an order</button>`:''}
      <button class="x" onclick="LV3.cm('lav3Ov1')">&#10005;</button></div>
    <div class="mb">${body}</div>
    ${open.length?`<div class="mf"><span id="dlvSum" class="pmeta" style="margin:0"></span>
      <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov1')">Cancel</button>
      <button class="btn go" id="dlvGo" onclick="LV3.dlvReceive()">Receive selected</button></div></div>`
     :`<div class="mf"><span class="pmeta" style="margin:0">${waiting.length?'Nothing has been marked as arrived yet.':''}</span>
       <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov1')">Close</button></div></div>`}`;
  om('lav3Ov1');dlvSum();
}
/* tick every line of one order at once — an order arrives as one box */
function dlvPickOrder(key){
  const open=window._dlv||[];
  open.forEach((x,i)=>{
    const k=(x.l.oid&&x.l.oid!=='—')?x.l.oid:('#'+x.l.id);
    const ck=$('dlv-ck-'+i);
    if(ck)ck.checked=(k===key)?true:ck.checked;
  });
  dlvSum();
}
function dlvSum(){
  const open=window._dlv||[];let items=0,units=0;
  open.forEach((x,i)=>{
    const ck=$('dlv-ck-'+i),q=$('dlv-q-'+i),n=$('dlv-n-'+i);
    if(!ck||!q)return;
    const v=Math.max(0,parseInt(q.value)||0);
    const owed=outQty(x.l);
    if(n)n.innerHTML=!ck.checked?'<span class="dim">skipped</span>'
      :v>owed?`<span style="color:var(--blu)">${fmt(v-owed)} more than owed</span>`
      :v===owed?'<span style="color:var(--grn)">that closes it</span>'
      :v>0?`<span style="color:var(--amb)">${fmt(owed-v)} still expected</span>`:'<span style="color:var(--red)">nothing arrived</span>';
    if(ck.checked&&v>0){items++;units+=v;}
  });
  const s=$('dlvSum');
  if(s){
    let val=0;
    open.forEach((x,i)=>{const ck=$('dlv-ck-'+i),q=$('dlv-q-'+i);
      if(ck&&ck.checked&&q)val+=(Math.max(0,parseInt(q.value)||0))*(x.l.cost||0);});
    s.innerHTML=items
      ?`Receiving <b style="color:var(--grn)">${fmt(units)}</b> unit${units===1?'':'s'} across ${fmt(items)} line${items===1?'':'s'}${val?` · <b>${gbp(val)}</b> of stock`:''}`
      :'Nothing selected';
  }
  const g=$('dlvGo');if(g){g.disabled=!items;g.style.opacity=items?'1':'.45';}
}
/* Ticking ten boxes at once has to mean exactly what pressing Receive ten
   times means. This used to be its own copy of the receiving logic — and its
   copy DECLARED A SHORTFALL on every partial, which is the one thing only the
   person holding the boxes is allowed to do. Somebody counting in 30 of 44 on
   a Monday raised a supplier problem for Sarah about 14 units that were still
   on the road. It now runs the same function the single button does, with
   thatsIt FALSE — a partial here means "part of it is in", nothing more. */
function dlvReceive(){
  if(lavGate(()=>dlvReceive()))return;
  const open=window._dlv||[];let items=0,units=0,partials=0,dmgTot=0,done=0;
  snap();
  open.forEach((x,i)=>{
    const ck=$('dlv-ck-'+i),q=$('dlv-q-'+i);
    if(!ck||!ck.checked)return;
    const got=Math.max(0,parseInt(q.value)||0);
    if(got<1)return;
    const landed=($('dlv-d-'+i)||{}).value||dayISO();
    const before=outQty(x.l);
    const r=receiveRow(x.kind,x.o.id,x.l.id,got,null,0,false,{landed,quiet:true});
    if(!r)return;
    items++;units+=r.got;dmgTot+=r.dmg;
    if(r.closed)done++; else partials++;
    const lateBy=(()=>{const e=x.l.eta2||x.l.eta1;if(!e)return'';
      const d=Math.round((new Date(landed)-new Date(e))/864e5);return d>0?` · ${d} day${d===1?'':'s'} later than expected`:'';})();
    logIt('recv',`Received ${fmt(got)} of ${fmt(before)} owed × ${x.o.name}${x.l.cost>0?' @ '+gbp(x.l.cost):''}${x.l.sup?' — '+x.l.sup:''} · landed ${dshort(landed)}${lateBy}${r.closed?' · order complete':` · ${fmt(r.left)} still expected`}`);
  });
  if(!items){toast('Nothing selected','er');return;}
  save();cm('lav3Ov1');render();
  /* Say what is still owed. "3 partial" used to read as three problems; it is
     three orders with more still coming, and nobody has been chased. */
  toastUndo(`${fmt(units)} unit${units===1?'':'s'} in across ${fmt(items)} line${items===1?'':'s'}${done?` · ${done} order${done===1?'':'s'} complete`:''}${partials?` · ${partials} still part-open`:''}${dmgTot?` · ${fmt(dmgTot)} damaged`:''}`,'ok');
}

/* ═══════════════ BULK SETUP ═══════════════
   Getting 28 products and their parts in by hand is the reason the old page
   never got used. Three tools: paste components, paste products, then fill
   every recipe on one grid. */
function splitLine(l){return l.split(/\t|\s*\|\s*/).map(x=>x.trim()).filter((x,i)=>i===0||x!=='');}


/* Two ways in: type it (the default — nobody should have to learn a pipe
   format to add three components) or paste a block from the sheet. Both feed
   the same preview and the same save. */
let _bulkMode={comp:'type',prod:'type',rec:'type'};

function bulkTabs(which,fn){
  const m=_bulkMode[which];
  return `<div class="bkTabs">
    <button class="bkTab ${m==='type'?'on':''}" onclick="LV3.${fn}('type')">Type them in</button>
    <button class="bkTab ${m==='paste'?'on':''}" onclick="LV3.${fn}('paste')">Paste from a sheet</button>
  </div>`;
}

/* ── components ── */
function openBulkComp(){_bulkMode.comp='type';_bcDraft=[{},{},{}];drawBulkComp();om('lav3Ov2');}
function bcMode(m){_bcDraft=bcReadDraft();_bulkMode.comp=m;drawBulkComp();
  setTimeout(()=>{const el=m==='paste'?$('bcTxt'):document.getElementById('bc-n-0');if(el)el.focus();},40);}
let _bcDraft=[];
function bcReadDraft(){
  if(_bulkMode.comp!=='type')return _bcDraft;
  const out=[];document.querySelectorAll('[id^="bc-n-"]').forEach(el=>{
    const i=el.id.split('-').pop();
    out.push({name:el.value.trim(),
      pack:document.getElementById('bc-k-'+i)?.value==='packaging',
      qty:document.getElementById('bc-q-'+i)?.value||'',
      cost:document.getElementById('bc-c-'+i)?.value||''});
  });return out;
}
function bcAddRow(n){_bcDraft=bcReadDraft();for(let k=0;k<(n||1);k++)_bcDraft.push({});drawBulkComp();
  setTimeout(()=>document.getElementById('bc-n-'+(_bcDraft.length-(n||1)))?.focus(),40);}
function bcDelRow(i){_bcDraft=bcReadDraft();_bcDraft.splice(i,1);if(!_bcDraft.length)_bcDraft=[{}];drawBulkComp();}
function drawBulkComp(){
  const typing=_bulkMode.comp==='type';
  $('lav3Mod2').className='mod wide';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Add several components</h3>
    <span class="pmeta" style="margin:0">parts and packaging that go into your bundles</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    ${bulkTabs('comp','bcMode')}
    ${typing?`
      <table class="bkGrid"><thead><tr>
        <th class="l">Component name</th><th style="width:150px">Kind</th>
        <th style="width:110px">On hand</th><th style="width:120px">Unit cost £</th><th style="width:34px"></th>
      </tr></thead><tbody>
      ${_bcDraft.map((r,i)=>`<tr>
        <td><input class="in" id="bc-n-${i}" value="${esc(r.name||'')}" placeholder="${i===0?'Exfoliating Glove':''}"
             oninput="LV3.bcPreview()" onkeydown="if(event.key==='Enter'){event.preventDefault();LV3.bcAddRow()}"></td>
        <td><select class="in" id="bc-k-${i}" onchange="LV3.bcPreview()">
              <option value="component" ${r.pack?'':'selected'}>Component</option>
              <option value="packaging" ${r.pack?'selected':''}>Packaging</option></select></td>
        <td><input class="in num" id="bc-q-${i}" type="number" min="0" value="${r.qty||''}" placeholder="0" oninput="LV3.bcPreview()"></td>
        <td><input class="in num" id="bc-c-${i}" type="number" step="0.01" min="0" value="${r.cost||''}" placeholder="0.00" oninput="LV3.bcPreview()"></td>
        <td><button class="bkX" title="Remove this line" onclick="LV3.bcDelRow(${i})">&#10005;</button></td></tr>`).join('')}
      </tbody></table>
      <div class="bkAdd"><button class="btn sm" onclick="LV3.bcAddRow()">+ Add line</button>
        <button class="btn sm" onclick="LV3.bcAddRow(5)">+ 5 lines</button>
        <span class="pmeta" style="margin:0">On hand and cost are optional — you can leave them blank and receive stock later.</span></div>
    `:`
      <div class="note info" style="margin-bottom:10px">Copy the cells straight out of the sheet and paste below — one component per line.
        Columns can be separated by tabs or <b>|</b>, in this order:<br>
        <b style="color:var(--text)">Name &nbsp;|&nbsp; on hand &nbsp;|&nbsp; unit cost &nbsp;|&nbsp; packaging</b><br>
        Only the name is needed. Put <b>packaging</b> at the end for boxes and sleeves.</div>
      <textarea class="in" id="bcTxt" rows="9" style="resize:vertical;line-height:1.7"
        placeholder="Exfoliating Glove | 118 | 0.44&#10;Self Tan Mitt | 96 | 0.58&#10;Gift Box — Medium | 392 | 0.31 | packaging&#10;Dove MD Tanning Lotion 75ml" oninput="LV3.bcPreview()"></textarea>
    `}
    <div id="bcOut" style="margin-top:12px"></div>
  </div>
  <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.bcSave()">Add components</button></div></div>`;
  bcPreview();
  if(typing)setTimeout(()=>document.getElementById('bc-n-0')?.focus(),50);
}
function bcParse(){
  const mk=(name,qty,cost,pack)=>({name,qty:parseInt(qty)||0,cost:parseFloat(cost)||0,pack:!!pack,
    dupe:!!D.components.find(c=>c.name.toLowerCase()===(name||'').toLowerCase())});
  if(_bulkMode.comp==='type')
    return bcReadDraft().filter(r=>r.name).map(r=>mk(r.name,r.qty,r.cost,r.pack));
  return (($('bcTxt')||{}).value||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const p=splitLine(l);
    const pack=p.some(x=>/^pack(aging)?$/i.test(x));
    const rest=p.filter(x=>!/^pack(aging)?$/i.test(x));
    return mk(rest[0],rest[1],rest[2],pack);
  }).filter(r=>r.name);
}
function bcPreview(){
  const rows=bcParse(),n=rows.filter(r=>!r.dupe).length,d=rows.length-n;
  const odd=rows.filter(r=>!r.dupe&&r.cost>50).length;
  const el=$('bcOut');if(!el)return;
  if(!rows.length){el.innerHTML=`<div class="bkNil">Nothing to add yet — ${_bulkMode.comp==='type'?'fill in a name above':'paste your lines above'}.</div>`;return;}
  el.innerHTML=`<div class="bkSum"><b>${fmt(n)}</b> will be added${d?` · <span style="color:var(--amb)">${d} already exist and will be skipped</span>`:''}${odd?` · <span style="color:var(--amb)">${odd} unit cost${odd===1?'':'s'} over £50 — check the columns</span>`:''}</div>
    ${_bulkMode.comp==='paste'?`<table class="ltab"><thead><tr><th>Component</th><th>Kind</th><th>On hand</th><th>Unit cost</th></tr></thead><tbody>
    ${rows.slice(0,60).map(r=>`<tr ${r.dupe?'style="opacity:.4"':''}><td>${esc(r.name)}${r.dupe?' <span class="chip vat">exists</span>':''}</td>
      <td>${r.pack?'<span class="chip packaging">Packaging</span>':'<span class="chip component">Component</span>'}</td>
      <td>${r.qty?fmt(r.qty):'—'}</td><td>${r.cost?gbp(r.cost):'—'}</td></tr>`).join('')}
    </tbody></table>`:(d?`<div class="pmeta">Already-existing names are skipped, so nothing gets duplicated.</div>`:'')}`;
}
function bcSave(){
  const rows=bcParse().filter(r=>!r.dupe);
  if(!rows.length){toast('Nothing new to add','er');return;}
  rows.forEach((r,i)=>{
    const c={id:newId('c'),name:r.name,kind:r.pack?'packaging':'component',tag:'complementary',caseQty:null,layers:[]};
    if(r.qty>0)c.layers.push({id:newId('O'),date:localDay(TODAY),qty:r.qty,rem:r.qty,cost:r.cost,
      sup:'Opening stock',oid:'—',loc:'Warehouse',arr:1});
    D.components.push(c);
  });
  logIt('edit',`Bulk added ${rows.length} components`);
  cm('lav3Ov2');render();toast(`${rows.length} component${rows.length===1?'':'s'} added`,'ok');
}

/* ── products ── */
let _bpDraft=[];
function openBulkProd(){_bulkMode.prod='type';_bpDraft=[{},{},{}];drawBulkProd();om('lav3Ov2');}
function bpMode(m){_bpDraft=bpReadDraft();_bulkMode.prod=m;drawBulkProd();
  setTimeout(()=>{const el=m==='paste'?$('bpTxt'):document.getElementById('bp-a-0');if(el)el.focus();},40);}
function bpReadDraft(){
  if(_bulkMode.prod!=='type')return _bpDraft;
  const out=[];document.querySelectorAll('[id^="bp-a-"]').forEach(el=>{
    const i=el.id.split('-').pop();
    out.push({asin:el.value.trim().toUpperCase(),
      sku:document.getElementById('bp-s-'+i)?.value.trim()||'',
      name:document.getElementById('bp-p-'+i)?.value.trim()||'',
      type:document.getElementById('bp-t-'+i)?.value||'bundle',
      vat:document.getElementById('bp-v-'+i)?.value||'20'});
  });return out;
}
function bpAddRow(n){_bpDraft=bpReadDraft();for(let k=0;k<(n||1);k++)_bpDraft.push({});drawBulkProd();
  setTimeout(()=>document.getElementById('bp-a-'+(_bpDraft.length-(n||1)))?.focus(),40);}
function bpDelRow(i){_bpDraft=bpReadDraft();_bpDraft.splice(i,1);if(!_bpDraft.length)_bpDraft=[{}];drawBulkProd();}
function drawBulkProd(){
  const typing=_bulkMode.prod==='type';
  $('lav3Mod2').className='mod wide';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Add several products</h3>
    <span class="pmeta" style="margin:0">Lavarion ASINs — bundles you build, or private label that arrives finished</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    ${bulkTabs('prod','bpMode')}
    ${typing?`
      <table class="bkGrid"><thead><tr>
        <th class="l" style="width:150px">ASIN</th><th class="l" style="width:170px">SKU</th><th class="l">Product name</th>
        <th style="width:150px">Type</th><th style="width:90px">VAT %</th><th style="width:34px"></th>
      </tr></thead><tbody>
      ${_bpDraft.map((r,i)=>`<tr>
        <td><input class="in" id="bp-a-${i}" value="${esc(r.asin||'')}" placeholder="${i===0?'B0DW5HPRWB':''}"
             style="text-transform:uppercase" oninput="LV3.bpPreview()"></td>
        <td><input class="in" id="bp-s-${i}" value="${esc(r.sku||'')}" placeholder="${i===0?'LAV-DOVEMD':''}" oninput="LV3.bpPreview()"></td>
        <td><input class="in" id="bp-p-${i}" value="${esc(r.name||'')}" placeholder="${i===0?'Dove 75ml MD Bundle':''}"
             oninput="LV3.bpPreview()" onkeydown="if(event.key==='Enter'){event.preventDefault();LV3.bpAddRow()}"></td>
        <td><select class="in" id="bp-t-${i}" onchange="LV3.bpPreview()">
              <option value="bundle" ${r.type==='pl'?'':'selected'}>Bundle — we build it</option>
              <option value="pl" ${r.type==='pl'?'selected':''}>Private label — arrives finished</option></select></td>
        <td><input class="in num" id="bp-v-${i}" type="number" min="0" max="20" value="${r.vat!=null&&r.vat!==''?r.vat:'20'}" oninput="LV3.bpPreview()"></td>
        <td><button class="bkX" title="Remove this line" onclick="LV3.bpDelRow(${i})">&#10005;</button></td></tr>`).join('')}
      </tbody></table>
      <div class="bkAdd"><button class="btn sm" onclick="LV3.bpAddRow()">+ Add line</button>
        <button class="btn sm" onclick="LV3.bpAddRow(5)">+ 5 lines</button>
        <span class="pmeta" style="margin:0">Components come next — add the products first, then use <b>Bulk build lists</b>.</span></div>
    `:`
      <div class="note info" style="margin-bottom:10px">One product per line, tabs or <b>|</b> between columns:<br>
        <b style="color:var(--text)">ASIN &nbsp;|&nbsp; SKU &nbsp;|&nbsp; Product name &nbsp;|&nbsp; type &nbsp;|&nbsp; VAT</b><br>
        Type is <b>bundle</b> or <b>pl</b> — it defaults to bundle. VAT defaults to 20.</div>
      <textarea class="in" id="bpTxt" rows="9" style="resize:vertical;line-height:1.7"
        placeholder="B0DW5HPRWB | LAV-DOVEMD-BDL | Dove 75ml MD Bundle | bundle&#10;B0G8R16QMB | LAV-WED30 | Wedding Cones 30 | pl&#10;B0GJ68VNM2 | LAV-GFBOX | GF Biscuit Hamper | bundle | 0" oninput="LV3.bpPreview()"></textarea>
    `}
    <div id="bpOut" style="margin-top:12px"></div>
  </div>
  <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.bpSave()">Add products</button></div></div>`;
  bpPreview();
  if(typing)setTimeout(()=>document.getElementById('bp-a-0')?.focus(),50);
}
function bpParse(){
  const mk=(asin,sku,name,type,vat)=>({asin:(asin||'').toUpperCase(),sku:sku||'',name:name||sku||asin,
    type:type==='pl'?'pl':'bundle',vat:String(vat==null||vat===''?'20':vat).replace('%',''),
    bad:!/^B0[A-Z0-9]{8}$/.test((asin||'').toUpperCase()),
    dupe:!!D.products.find(x=>(x.asin||'').toUpperCase()===(asin||'').toUpperCase())});
  if(_bulkMode.prod==='type')
    return bpReadDraft().filter(r=>r.asin).map(r=>mk(r.asin,r.sku,r.name,r.type,r.vat));
  return (($('bpTxt')||{}).value||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const p=splitLine(l);
    const t=(p[3]||'bundle').toLowerCase();
    return mk(p[0],p[1],p[2],t.startsWith('p')?'pl':'bundle',p[4]);
  }).filter(r=>r.asin);
}
function bpPreview(){
  const rows=bpParse(),n=rows.filter(r=>!r.dupe).length,d=rows.length-n,bad=rows.filter(r=>r.bad&&!r.dupe).length;
  const el=$('bpOut');if(!el)return;
  if(!rows.length){el.innerHTML=`<div class="bkNil">Nothing to add yet — ${_bulkMode.prod==='type'?'enter an ASIN above':'paste your lines above'}.</div>`;return;}
  el.innerHTML=`<div class="bkSum"><b>${fmt(n)}</b> will be added${d?` · <span style="color:var(--amb)">${d} already exist and will be skipped</span>`:''}${bad?` · <span style="color:var(--amb)">${bad} ASIN${bad===1?" doesn't":"s don't"} look right</span>`:''}</div>
    ${_bulkMode.prod==='paste'?`<table class="ltab"><thead><tr><th>ASIN</th><th>Product</th><th>Type</th><th>VAT</th></tr></thead><tbody>
    ${rows.slice(0,60).map(r=>`<tr ${r.dupe?'style="opacity:.4"':''}>
      <td>${esc(r.asin)}${r.dupe?' <span class="chip vat">exists</span>':''}${r.bad&&!r.dupe?' <span class="chip warn">check</span>':''}</td>
      <td style="text-align:right">${esc(r.name)}</td>
      <td><span class="chip ${r.type}">${typeLabel(r.type)}</span></td><td>${r.vat}%</td></tr>`).join('')}
    </tbody></table>`:''}
    ${bad?`<div class="note" style="margin-top:10px">Lines marked <b>check</b> don't match the usual ASIN shape (B0 followed by 8 characters). They'll still be added — just make sure they're right.</div>`:''}`;
}
function bpSave(){
  const rows=bpParse().filter(r=>!r.dupe);
  if(!rows.length){toast('Nothing new to add','er');return;}
  rows.forEach((r,i)=>D.products.push({id:newId('pr'),asin:r.asin,sku:r.sku,name:r.name,type:r.type,vat:r.vat,
    recipe:[],layers:[],ship30:0,lastSent:null}));
  logIt('edit',`Bulk added ${rows.length} products`);
  cm('lav3Ov2');render();toast(`${rows.length} product${rows.length===1?'':'s'} added — now set their build lists`,'ok');
}

/* ── BULK RECIPES ──────────────────────────────────────────────────────────
   The grid is fine for tweaking one number, but hopeless for filling 26
   bundles from scratch. This does a whole product per line:
     Dove 75ml MD | Dove Lotion 75ml x1 | Exfoliating Glove x1 | Gift Box x1
   Components are matched on name (case and spacing ignored). Anything it
   can't find is offered as "create these too" rather than silently dropped. */
let _brDraft=[];
function openBulkRecipe(){
  if(!D.products.filter(p=>!p.archived).length){toast('Add some products first','er');return;}
  _bulkMode.rec='type';_brDraft=[{}];drawBulkRecipe();om('lav3Ov2');
}
function brMode(m){_brDraft=brReadDraft();_bulkMode.rec=m;drawBulkRecipe();}
function brReadDraft(){
  if(_bulkMode.rec!=='type')return _brDraft;
  const out=[];document.querySelectorAll('[id^="br-p-"]').forEach(el=>{
    const i=el.id.split('-').pop();
    const parts=[];
    document.querySelectorAll(`[id^="br-c-${i}-"]`).forEach(cs=>{
      const k=cs.id.split('-').pop();
      parts.push({c:cs.value,q:document.getElementById(`br-q-${i}-${k}`)?.value||'1'});
    });
    out.push({p:el.value,parts:parts.length?parts:[{c:'',q:'1'}]});
  });return out;
}
function brAddProd(){_brDraft=brReadDraft();_brDraft.push({});drawBulkRecipe();}
function brDelProd(i){_brDraft=brReadDraft();_brDraft.splice(i,1);if(!_brDraft.length)_brDraft=[{}];drawBulkRecipe();}
function brAddPart(i){_brDraft=brReadDraft();const d=_brDraft[i];d.parts=(d.parts||[]).concat([{c:'',q:'1'}]);drawBulkRecipe();}
function brDelPart(i,k){_brDraft=brReadDraft();_brDraft[i].parts.splice(k,1);if(!_brDraft[i].parts.length)_brDraft[i].parts=[{c:'',q:'1'}];drawBulkRecipe();}
function _compByName(n){const k=(n||'').toLowerCase().replace(/\s+/g,' ').trim();
  return D.components.find(c=>c.name.toLowerCase().replace(/\s+/g,' ').trim()===k);}
function _prodByRef(n){const k=(n||'').toLowerCase().trim();if(!k)return null;
  return D.products.find(p=>p.asin.toLowerCase()===k)||D.products.find(p=>(p.sku||'').toLowerCase()===k)
    ||D.products.find(p=>p.name.toLowerCase()===k)||D.products.find(p=>p.name.toLowerCase().includes(k));}
function drawBulkRecipe(){
  const typing=_bulkMode.rec==='type';
  const comps=D.components.filter(c=>!c.archived).sort((a,b)=>a.name.localeCompare(b.name));
  const prods=D.products.filter(p=>!p.archived&&p.type==='bundle').sort((a,b)=>a.name.localeCompare(b.name));
  $('lav3Mod2').className='mod wide';
  $('lav3Mod2').innerHTML=`
  <div class="mh"><h3>Bulk build lists</h3>
    <span class="pmeta" style="margin:0">what goes into each bundle, and how many of it</span>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    ${bulkTabs('rec','brMode')}
    ${typing?`
      ${_brDraft.map((d,i)=>{const parts=d.parts&&d.parts.length?d.parts:[{c:'',q:'1'}];
        return `<div class="brCard">
        <div class="brHead">
          <select class="in" id="br-p-${i}" onchange="LV3.brPreview()">
            <option value="">Choose a bundle…</option>
            ${prods.map(p=>`<option value="${p.id}" ${d.p===p.id?'selected':''}>${esc(p.name)} — ${p.asin}${p.recipe.length?` (${p.recipe.length} part${p.recipe.length===1?'':'s'} already)`:''}</option>`).join('')}
          </select>
          <button class="bkX" title="Remove this bundle" onclick="LV3.brDelProd(${i})">&#10005;</button>
        </div>
        <div class="brParts">
          ${parts.map((pt,k)=>`<div class="brPart">
            <select class="in" id="br-c-${i}-${k}" onchange="LV3.brPreview()">
              <option value="">Choose a component…</option>
              ${comps.map(c=>`<option value="${c.id}" ${pt.c===c.id?'selected':''}>${esc(c.name)}${c.kind==='packaging'?' (packaging)':''}</option>`).join('')}
            </select>
            <span class="brX">×</span>
            <input class="in num" id="br-q-${i}-${k}" type="number" min="1" value="${pt.q||1}" oninput="LV3.brPreview()">
            <button class="bkX" title="Remove this part" onclick="LV3.brDelPart(${i},${k})">&#10005;</button>
          </div>`).join('')}
          <button class="btn sm" onclick="LV3.brAddPart(${i})">+ Add a part</button>
        </div></div>`;}).join('')}
      <div class="bkAdd"><button class="btn sm pri" onclick="LV3.brAddProd()">+ Another bundle</button>
        <span class="pmeta" style="margin:0">Saving replaces that bundle's whole build list — leave a bundle out and it isn't touched.</span></div>
    `:`
      <div class="note info" style="margin-bottom:10px">One bundle per line. Start with the product (name, ASIN or SKU), then each component after a <b>|</b>.
        Put the quantity after the component with an <b>x</b> — leave it off and it means one.<br>
        <b style="color:var(--text)">Dove 75ml MD | Dove Lotion 75ml x1 | Exfoliating Glove x1 | Gift Box — Medium</b><br>
        Component names are matched loosely, so capitals and extra spaces don't matter.</div>
      <textarea class="in" id="brTxt" rows="9" style="resize:vertical;line-height:1.7"
        placeholder="Dove 75ml MD | Dove MD Tanning Lotion 75ml | Exfoliating Glove | Self Tan Mitt | Gift Box — Medium&#10;Wedding 60 | Lavarion Wedding Cones (30pc) x2 | Gift Box — Medium" oninput="LV3.brPreview()"></textarea>
    `}
    <div id="brOut" style="margin-top:12px"></div>
  </div>
  <div class="mf">
    <div id="brMake"></div>
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn pri" onclick="LV3.brSave()">Save build lists</button></div></div>`;
  brPreview();
}
function brParse(){
  if(_bulkMode.rec==='type'){
    return brReadDraft().filter(d=>d.p).map(d=>{
      const p=D.products.find(x=>x.id===d.p);
      return{p,ref:p?p.name:'',parts:(d.parts||[]).filter(pt=>pt.c).map(pt=>{
        const c=D.components.find(x=>x.id===pt.c);
        return{c,name:c?c.name:'',q:Math.max(1,parseInt(pt.q)||1)};})};
    });
  }
  return (($('brTxt')||{}).value||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const p=splitLine(l);
    const ref=p[0];
    const parts=p.slice(1).map(seg=>{
      const m=seg.match(/^(.*?)\s*[x×*]\s*(\d+)$/i);
      const name=(m?m[1]:seg).trim(),q=m?parseInt(m[2]):1;
      return{c:_compByName(name),name,q:Math.max(1,q||1)};
    }).filter(x=>x.name);
    return{p:_prodByRef(ref),ref,parts};
  }).filter(r=>r.ref);
}
function brPreview(){
  const rows=brParse(),el=$('brOut');if(!el)return;
  const mk=$('brMake');
  if(!rows.length){el.innerHTML=`<div class="bkNil">Nothing yet — ${_bulkMode.rec==='type'?'pick a bundle above':'paste your lines above'}.</div>`;if(mk)mk.innerHTML='';return;}
  const missing=[...new Set(rows.flatMap(r=>r.parts.filter(pt=>!pt.c).map(pt=>pt.name)))];
  const noProd=rows.filter(r=>!r.p).length;
  const ok=rows.filter(r=>r.p&&r.parts.length).length;
  el.innerHTML=`<div class="bkSum"><b>${fmt(ok)}</b> build list${ok===1?'':'s'} will be set${noProd?` · <span style="color:var(--red)">${noProd} product${noProd===1?'':'s'} not recognised</span>`:''}${missing.length?` · <span style="color:var(--amb)">${missing.length} component${missing.length===1?'':'s'} not found</span>`:''}</div>
    <table class="ltab"><thead><tr><th>Bundle</th><th>Makes one unit from</th><th style="width:90px">Replaces</th></tr></thead><tbody>
    ${rows.slice(0,40).map(r=>`<tr>
      <td>${r.p?esc(r.p.name)+` <span class="pmeta" style="margin:0">${r.p.asin}</span>`:`<span style="color:var(--red)">${esc(r.ref)} — not found</span>`}</td>
      <td style="text-align:right">${r.parts.length?r.parts.map(pt=>pt.c
        ?`<span class="brTag">${esc(pt.c.name)}${pt.q>1?` ×${pt.q}`:''}</span>`
        :`<span class="brTag miss">${esc(pt.name)}${pt.q>1?` ×${pt.q}`:''}</span>`).join(' '):'<span class="dim">no parts</span>'}</td>
      <td>${r.p&&r.p.recipe.length?`<span class="chip warn">${r.p.recipe.length} part${r.p.recipe.length===1?'':'s'}</span>`:'—'}</td></tr>`).join('')}
    </tbody></table>
    ${noProd?`<div class="note" style="margin-top:10px">Products in red weren't matched. Check the name against the Products page, or use the ASIN instead — those lines will be skipped.</div>`:''}`;
  if(mk)mk.innerHTML=missing.length
    ?`<button class="btn warn" onclick="LV3.brMakeMissing()">Create ${missing.length} missing component${missing.length===1?'':'s'}</button>`:'';
}
function brMakeMissing(){
  const rows=brParse();
  const missing=[...new Set(rows.flatMap(r=>r.parts.filter(pt=>!pt.c).map(pt=>pt.name)))];
  if(!missing.length)return;
  missing.forEach((n,i)=>D.components.push({id:newId('c'),name:n,kind:/box|sleeve|bag|card|label|wrap/i.test(n)?'packaging':'component',
    tag:'complementary',caseQty:null,layers:[]}));
  logIt('edit',`Created ${missing.length} components from bulk build lists`);
  save();toast(`${missing.length} component${missing.length===1?'':'s'} created — no stock yet`,'ok');
  drawBulkRecipe();
}
function brSave(){
  const rows=brParse().filter(r=>r.p&&r.parts.length);
  if(!rows.length){toast('Nothing to save','er');return;}
  const stillMissing=rows.some(r=>r.parts.some(pt=>!pt.c));
  if(stillMissing&&!confirm('Some components were not found and will be left out. Create them first, or carry on without them?'))return;
  let n=0;
  rows.forEach(r=>{
    const recipe=r.parts.filter(pt=>pt.c).map(pt=>({c:pt.c.id,q:pt.q}));
    if(!recipe.length)return;
    r.p.recipe=recipe;n++;
  });
  logIt('edit',`Bulk build lists — ${n} bundle${n===1?'':'s'} set`);
  cm('lav3Ov2');render();toast(`${n} build list${n===1?'':'s'} saved`,'ok');
}

/* ── RECIPE GRID: every bundle × every component on one screen ── */
let MXCols=[];
function openMatrix(){
  const bundles=D.products.filter(p=>p.type==='bundle'||p.recipe.length);
  if(!bundles.length){toast('Add some products first','er');return;}
  if(!D.components.length){toast('Add some components first','er');return;}
  const used=new Set();bundles.forEach(p=>p.recipe.forEach(r=>used.add(r.c)));
  MXCols=D.components.filter(c=>used.has(c.id)).map(c=>c.id);
  if(!MXCols.length)MXCols=D.components.slice(0,8).map(c=>c.id);
  MXMode='grid';MXi=0;
  $('lav3Mod1').className='mod wide';
  $('lav3Mod1').innerHTML=`<div class="mh"><h3>Recipes</h3>
    <div class="seg" style="margin-left:4px">
      <button id="mxTabG" class="on" onclick="LV3.mxSetMode('grid')">Grid</button>
      <button id="mxTabO" onclick="LV3.mxSetMode('one')">One at a time</button></div>
    <span class="pmeta" id="mxCount" style="margin:0"></span>
    <button class="x" onclick="LV3.cm('lav3Ov1')">&#10005;</button></div>
  <div class="mb" style="padding:12px"><div id="mxWrap"></div></div>
  <div class="mf" id="mxFoot"></div>`;
  om('lav3Ov1');mxSetMode('grid');
}
let MXMode='grid',MXi=0;
function mxSetMode(m){
  if(MXMode==='grid'&&m==='one')mxStash=mxRead();       // keep grid edits when switching
  MXMode=m;
  $('mxTabG').classList.toggle('on',m==='grid');
  $('mxTabO').classList.toggle('on',m==='one');
  if(m==='grid')mxRender(mxStash);else mxOne();
}
let mxStash=null;
/* keyboard-first entry: one product at a time, type-ahead, Enter to add */
function mxOne(){
  const list=D.products.filter(p=>p.type==='bundle'||p.recipe.length);
  if(!list.length){$('mxWrap').innerHTML='<div class="empty">No products yet.</div>';return;}
  MXi=Math.max(0,Math.min(MXi,list.length-1));
  const p=list[MXi],a=avail(p),cg=cogOf(p,1);
  const done=list.filter(x=>x.recipe.length).length;
  $('mxCount').textContent=`${done} of ${list.length} products have a build list`;
  $('mxWrap').innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <button class="btn sm" onclick="LV3.mxStep(-1)" ${MXi===0?'disabled':''}>←</button>
      <div style="flex:1">
        <div class="pname" style="font-size:15px">${esc(p.name)}</div>
        <div class="pmeta">${esc(p.asin)} · product ${MXi+1} of ${list.length}</div></div>
      <div class="stat" style="min-width:118px"><div class="k">Buildable</div>
        <div class="v" style="color:${a.n?'var(--grn)':'var(--red)'}">${p.recipe.length?fmt(a.n):'—'}</div></div>
      <div class="stat" style="min-width:118px"><div class="k">COG</div>
        <div class="v" style="color:var(--accent)">${p.recipe.length?gbp(cg.per):'—'}</div></div>
      <button class="btn sm" onclick="LV3.mxStep(1)" ${MXi===list.length-1?'disabled':''}>→</button>
    </div>
    <div class="lab" style="margin-bottom:6px">Components in one unit</div>
    <div id="mxOneList">${p.recipe.length?p.recipe.map((r,i)=>{const c=comp(r.c);if(!c)return'';
      return `<div class="rline" style="cursor:default">
        <input class="in mono" style="width:56px;text-align:center;padding:5px" value="${r.q}" onchange="LV3.mxOneQty(${i},this.value)">
        <span class="nm">${esc(c.name)}<span class="chip ${c.kind}">${c.kind==='packaging'?'Packaging':'Component'}</span></span>
        <span class="st">${fmt(onHand(c))} on hand</span>
        <button class="btn sm dgr" onclick="LV3.mxOneDel(${i})">✕</button></div>`;}).join('')
      :'<div class="pmeta" style="padding:6px 2px">Nothing yet — start typing below.</div>'}</div>
    <div style="display:grid;grid-template-columns:1fr 74px auto;gap:8px;margin-top:12px">
      <input class="in" id="mxQ" placeholder="Type a component name, then Enter…" autocomplete="off"
        oninput="LV3.mxSug()" onkeydown="LV3.mxKey(event)">
      <input class="in mono" id="mxQty" type="number" min="1" value="1" style="text-align:center">
      <button class="btn" onclick="LV3.mxAdd()">Add</button></div>
    <div id="mxSugBox"></div>`;
  $('mxFoot').innerHTML=`<span class="pmeta" style="margin:0">Enter adds · → moves to the next product</span>
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov1')">Close</button></div>`;
  setTimeout(()=>{const q=$('mxQ');if(q)q.focus();},40);
}
function mxList(){return D.products.filter(p=>p.type==='bundle'||p.recipe.length);}
function mxStep(d){MXi+=d;mxOne();}
function mxOneQty(i,v){const p=mxList()[MXi];p.recipe[i].q=Math.max(1,parseInt(v)||1);save();mxOne();}
function mxOneDel(i){snap();const p=mxList()[MXi];p.recipe.splice(i,1);save();mxOne();toastUndo('Removed');}
function mxSug(){
  const q=($('mxQ').value||'').trim().toLowerCase();const box=$('mxSugBox');
  if(!q){box.innerHTML='';return;}
  const p=mxList()[MXi];
  const hits=D.components.filter(c=>c.name.toLowerCase().includes(q)&&!p.recipe.some(r=>r.c===c.id)).slice(0,5);
  box.innerHTML=hits.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    ${hits.map(c=>`<button class="btn sm" onclick="LV3.mxPick('${c.id}')">${esc(c.name)}<span class="pmeta" style="margin:0 0 0 6px;display:inline">${fmt(onHand(c))}</span></button>`).join('')}</div>`
    :`<div class="pmeta" style="margin-top:8px">No match — press Enter to create <b style="color:var(--accent)">${esc($('mxQ').value.trim())}</b> as a new component.</div>`;
}
function mxPick(id){mxAdd(id);}
function mxKey(e){if(e.key==='Enter'){e.preventDefault();mxAdd();}}
function mxAdd(forceId){
  const p=mxList()[MXi];const nm=($('mxQ').value||'').trim();
  const qty=Math.max(1,parseInt($('mxQty').value)||1);
  let id=forceId;
  if(!id){
    if(!nm)return;
    const ex=D.components.find(c=>c.name.toLowerCase()===nm.toLowerCase())
      ||D.components.find(c=>c.name.toLowerCase().includes(nm.toLowerCase()));
    if(ex)id=ex.id;
    else{const c={id:newId('c'),name:nm,kind:'component',tag:'complementary',caseQty:null,layers:[]};
      D.components.push(c);id=c.id;logIt('edit','Added component '+nm);}
  }
  if(p.recipe.some(r=>r.c===id)){toast('Already in this recipe','er');return;}
  snap();p.recipe.push({c:id,q:qty});save();
  $('mxQ').value='';$('mxQty').value='1';mxOne();
}

function mxRender(preserve){
  const bundles=D.products.filter(p=>p.type==='bundle'||p.recipe.length);
  const cells=preserve||{};
  $('mxCount').textContent=`${bundles.length} products × ${MXCols.length} components`;
  $('mxFoot').innerHTML=`<select class="in" id="mxAdd" style="width:auto;font-size:11.5px;padding:5px 8px" onchange="LV3.mxAddCol(this.value)">
      <option value="">+ Add a component column…</option></select>
    <span class="pmeta" style="margin:0 0 0 6px">Blank or 0 = not used</span>
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov1')">Cancel</button>
    <button class="btn pri" onclick="LV3.mxSave()">Save all build lists</button></div>`;
  $('mxWrap').innerHTML=`<div style="overflow:auto;max-height:60vh;border:1px solid var(--border);border-radius:8px">
    <table class="mx"><thead><tr><th class="stick">Product<div class="pmeta" style="margin-top:2px">how many per unit</div></th>
    ${MXCols.map(id=>{const c=comp(id);return `<th title="${esc(c.name)}"><div class="mxh">${esc(c.name)}</div>
      ${c.kind==='packaging'?'<div class="pmeta" style="margin:2px 0 0">pack</div>':''}</th>`;}).join('')}</tr></thead><tbody>
    ${bundles.map(p=>`<tr><td class="stick l"><div class="pname" style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
      <div class="pmeta mono">${esc(p.asin)}</div></td>
      ${MXCols.map(id=>{const r=p.recipe.find(x=>x.c===id);
        const k=p.id+'|'+id;const v=(k in cells)?cells[k]:(r?r.q:'');
        return `<td style="padding:4px"><input class="mxc" data-p="${p.id}" data-c="${id}" value="${v}" inputmode="numeric"></td>`;}).join('')}
    </tr>`).join('')}
    </tbody></table></div>`;
  const sel=$('mxAdd');
  sel.innerHTML='<option value="">+ Add a component column…</option>'+
    D.components.filter(c=>!MXCols.includes(c.id)).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
}
function mxRead(){const o={};document.querySelectorAll('.mxc').forEach(i=>{o[i.dataset.p+'|'+i.dataset.c]=i.value;});return o;}
function mxAddCol(id){if(!id)return;const cells=mxRead();MXCols.push(id);mxRender(cells);}
function mxSave(){
  snap();const cells=mxRead();let touched=0;
  D.products.forEach(p=>{
    const keys=MXCols.filter(id=>(p.id+'|'+id) in cells);
    if(!keys.length)return;
    let rec=p.recipe.filter(r=>!MXCols.includes(r.c));        // keep components not shown as columns
    keys.forEach(id=>{const q=parseInt(cells[p.id+'|'+id])||0;if(q>0)rec.push({c:id,q});});
    if(JSON.stringify(rec)!==JSON.stringify(p.recipe))touched++;
    p.recipe=rec;
  });
  logIt('edit',`Build list grid saved — ${touched} product${touched===1?'':'s'} changed`);
  cm('lav3Ov1');render();toastUndo(`Saved — ${touched} product${touched===1?'':'s'} updated`,'ok');
}

/* ── data menu ── */
function openData(){
  $('lav3Mod2').className='mod slim';
  $('lav3Mod2').innerHTML=`<div class="mh"><h3>Data</h3><button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb">
    <div class="lab" style="margin-bottom:6px">Lavarion currently holds</div>
    <table class="ltab" style="margin-top:0"><tbody>
      <tr><td>Products</td><td>${fmt(D.products.length)}</td></tr>
      <tr><td>Components</td><td>${fmt(D.components.length)}</td></tr>
      <tr><td>Purchase rows</td><td>${fmt(D.purchases.length)}</td></tr>
      <tr><td>Movements logged</td><td>${fmt(D.log.length)}</td></tr></tbody></table>
    <div style="display:flex;flex-direction:column;gap:7px;margin-top:14px">
      <button class="btn" onclick="LV3.exportCsv()">Export components + products as CSV</button>
      <button class="btn dgr" onclick="LV3.clearAll()">Clear everything</button>
    </div>
    <div class="note info" style="margin-top:12px">Products, components and build lists live in Supabase with the rest of Prep Hub. The purchase sheet is only ever read, never written to.</div>
  </div>
  <div class="mf"><div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Close</button></div></div>`;
  om('lav3Ov2');
}
/* A full snapshot before anyone starts clearing things out. Everything the
   Lavarion area holds, in one file, so a bad afternoon is recoverable. */
function backupAll(){
  const stamp=dayISO();
  const data={
    saved:new Date().toISOString(),build:BUILD,
    settings:D.settings,
    products:D.products.map(p=>({asin:p.asin,sku:p.sku,name:p.name,type:p.type,vat:p.vat,archived:!!p.archived,
      recipe:p.recipe.map(r=>{const c=comp(r.c);return{component:c?c.name:r.c,qty:r.q};}),
      layers:(p.layers||[]).map(l=>({date:l.date,qty:l.qty,rem:l.rem,cost:l.cost,sup:l.sup,oid:l.oid,arr:l.arr}))})),
    components:D.components.map(c=>({name:c.name,kind:c.kind,tag:c.tag,caseQty:c.caseQty,archived:!!c.archived,
      layers:(c.layers||[]).map(l=>({date:l.date,qty:l.qty,rem:l.rem,cost:l.cost,sup:l.sup,oid:l.oid,arr:l.arr,
        recvOn:l.recvOn,recvBy:l.recvBy,short:l.short,shortQty:l.shortQty}))})),
    purchases:D.purchases,
    shipments:(typeof lavShipments!=='undefined'?lavShipments:[]),
    log:D.log
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download=`lavarion-backup-${stamp}.json`;a.click();
  toast('Backup downloaded — keep it somewhere safe','ok');
}
function exportCsv(){
  const rows=[['type','name','asin_or_kind','sku_or_onhand','product_type_or_cost']];
  D.components.forEach(c=>rows.push(['component',c.name,c.kind,onHand(c),avgCost(c).toFixed(2)]));
  D.products.forEach(p=>{rows.push(['product',p.name,p.asin,p.sku,p.type]);
    p.recipe.forEach(r=>{const c=comp(r.c);if(c)rows.push(['recipe',p.name,c.name,r.q,'']);});});
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='lavarion-setup.csv';a.click();toast('CSV downloaded','ok');
}


/* migration the real Prep Hub needs — shown in Settings so it can be copied */
const SQL=`-- 1. products gain a type
ALTER TABLE lavarion_asins      ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'bundle';

-- 2. components: Component vs Packaging, plus a descriptive tag
ALTER TABLE lavarion_components ADD COLUMN IF NOT EXISTS kind text DEFAULT 'component';
ALTER TABLE lavarion_components ADD COLUMN IF NOT EXISTS tag  text;

-- everything the deliveries and chase process records, in one column
ALTER TABLE lavarion_stock_layers ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
ALTER TABLE lavarion_purchases    ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- 3. stock held as FIFO batches (the core of the rewrite)
CREATE TABLE IF NOT EXISTS lavarion_stock_layers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind text NOT NULL,              -- 'component' | 'product'
  target_id   text,                       -- TEXT: the app's own ids aren't uuids
  bought_on   date NOT NULL,
  qty         int  NOT NULL,
  remaining   int  NOT NULL,
  unit_cost   numeric(10,4) NOT NULL,     -- inc VAT, as typed on the sheet
  supplier    text,
  order_ref   text,
  location    text,
  arrived     boolean DEFAULT false,
  source      text,                       -- purchase row this came from
  note        text,                       -- reason, for stock corrections
  meta        jsonb DEFAULT '{}'::jsonb,   -- method, expected window, arrival, chase, shortfall
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lav_layers_fifo
  ON lavarion_stock_layers (target_id, bought_on);

-- 4. the purchase-sheet mirror and your allocations
CREATE TABLE IF NOT EXISTS lavarion_purchases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_tab  text,
  bought_on  date,
  name       text,
  qty        int,
  buy_price  numeric(10,4),
  supplier   text,
  order_ref  text,
  location   text,
  arrived    boolean DEFAULT false,
  alloc      jsonb DEFAULT '[]'::jsonb,   -- [{to, kind, qty}]
  synced_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lav_purch_key
  ON lavarion_purchases (bought_on, name, order_ref, qty);

-- 5. shipments keep the cost they were sent with, forever
ALTER TABLE lavarion_shipments  ADD COLUMN IF NOT EXISTS cog_per_unit numeric(10,4);
ALTER TABLE lavarion_shipments  ADD COLUMN IF NOT EXISTS layers_used  jsonb;
-- 6. repair an earlier install that used uuid here (safe if already text)
ALTER TABLE lavarion_stock_layers ALTER COLUMN target_id TYPE text USING target_id::text;
ALTER TABLE lavarion_stock_layers ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE lavarion_stock_layers ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE lavarion_stock_layers ADD COLUMN IF NOT EXISTS note   text;`;
function copySql(){navigator.clipboard&&navigator.clipboard.writeText(SQL);toast('SQL copied — paste into the Supabase SQL editor','ok');}

/* ═══════════════ HOW IT WORKS ═══════════════
   Written for whoever is actually doing the job, not for whoever built it. */
function vGuide(){
  const step=(n,t,b)=>`<div class="gstep"><span class="gnum">${n}</span>
    <div><div class="gt">${t}</div><div class="gb">${b}</div></div></div>`;
  const q=(t,b)=>`<div class="gq"><div class="gt">${t}</div><div class="gb">${b}</div></div>`;
  const P=(...t)=>t.map(x=>`<p>${x}</p>`).join('');

  $('lav3View').innerHTML=`
  <div class="gwrap">

    <div class="ghero">
      <div>
        <div class="gh1">How Lavarion works</div>
        <div class="gh2">Everything on this page is our own brand. This is what it does, what you do, and why.</div>
      </div>
      <div class="ghero-k">
        <div><b>${fmt(D.products.filter(p=>!p.archived).length)}</b><span>products</span></div>
        <div><b>${fmt(D.components.filter(c=>!c.archived).length)}</b><span>components</span></div>
        <div><b>${fmt(inboundCount())}</b><span>on order</span></div>
      </div>
    </div>

    <div class="gcols">
      <div class="gcolL">

        <div class="panel"><div class="ph"><span class="t">The two kinds of product</span></div>
          <div class="gbody">
            <div class="gtwo">
              <div class="gcard"><span class="chip bundle">Bundle</span>
                ${P('<b>We build it here.</b> Dove 75ml MD is lotion + exfoliating glove + tanning mitt + poly bag. Four separate things that leave as one.',
                    'Its <b>Available</b> number is how many complete bundles the current parts allow. Whichever part we have least of decides it — that one gets a <span class="chip bad">limits build</span> tag.',
                    'If any single part hits zero, the whole bundle stops. That is why the Overview leads with what we are out of.')}
              </div>
              <div class="gcard"><span class="chip pl">Private label</span>
                ${P('<b>It arrives finished.</b> Wedding Cones 30 turns up as a complete pack. We label it and send it — no building.',
                    'Its <b>Available</b> number is simply what is in stock.',
                    'These usually have no components at all, so they never show a blocker.')}
              </div>
            </div>
          </div></div>

        <div class="panel"><div class="ph"><span class="t">The loop</span><span class="sub">the same six steps, every time</span></div>
          <div class="gbody">
            ${step(1,'Something gets bought',
              `Jack buys a component (lotion, gloves, mitts, boxes) or a finished private-label product.
               It goes on the <b>purchase sheet</b> exactly as it always has — nothing changes there.`)}
            ${step(2,'You log the order here',
              `<b>+ Order</b> at the top, or <b>+ Log an order</b> on the Purchases tab. Enter what was bought,
               how many, the unit price if you know it, and the supplier.<br><br>
               Then two things that matter for anything coming from abroad:<br>
               <b>How is it coming</b> — courier, road, air, rail, sea or collection.<br>
               <b>Expected between</b> — two dates. Pick the method and the window fills itself in:
               a UK courier is a few days, <b>sea freight from China is five to ten weeks</b>. If the supplier
               has given you real dates, type them over the top and yours are kept from then on.<br><br>
               It now reads <b>on order</b>. That is deliberate — it is not stock and it cannot be built with yet.
               If you do not know the price, leave it blank; it can be filled in later and nothing breaks.`)}
            ${step(3,'It turns up — you receive it',
              `Everything outstanding sits in the <b>On order</b> table at the top of <b>Purchases</b>, soonest
               first, with the method and the expected window on every line. Underneath the dates it counts
               down — <b>in 34 days</b>, <b>due in 3 days</b>, or <b style="color:var(--red)">12 days overdue</b>
               in red. Both the method and the dates can be changed straight from that table.<br><br>
               Press <b>Arrived</b> on the line, or <b>Receive a delivery</b> for several at once: tick what
               turned up and press <b>Receive selected</b>.<br>
               <b>Only part of it came?</b> Change the <b>received</b> box to what actually landed. The rest stays
               on order automatically — you do not need to do anything else.`)}
            ${step(4,'Stock and cost arrive together',
              `Receiving creates a <b>batch</b> — a quantity at a price. If we buy gloves twice at different
               prices, that is two batches sitting side by side. Keeping them separate is what makes the
               cost figure honest rather than a guess.`)}
            ${step(5,'Build and send',
              `Send from the <b>Shipments</b> page as normal, or press <b>Ship</b> here. Either way the parts come
               off stock automatically and the cost per unit is worked out for you — copy it straight into Amazon.<br><br>
               <b>Two things can stop you, and they are different.</b><br>
               <b>Not enough stock</b> — it shows exactly what is short, what was last bought, what is on order
               and which other products use the same part.<br>
               <b>Mixed costs</b> — the units you are sending would come from two different purchase prices.
               One shipment carries one cost, so it offers to send the older price on its own and leave the rest
               for a second shipment. There is an override for the odd time it has to go out mixed; it asks why.`)}
            ${step(6,'The numbers move on their own',
              `Available drops, the <b>${D.settings.targetDays||60}-day target</b> updates, and anything now out
               of stock appears at the top of <b>Overview</b>. Nothing to update by hand. Back to step 1.`)}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Knowing how much to send</span><span class="sub">Sold 30d, and the ${D.settings.targetDays||60}-day target</span></div>
          <div class="gbody">
            ${P('This page can see everything we <b>sent</b> to Amazon. It cannot see what Amazon <b>sold</b> — nothing here is plugged into Seller Central. So the sales figure is typed in, and it is the one number the whole page leans on.')}
            <div class="gex">
              <div class="gexrow"><span>You type <b>Sold 30d</b> from Seller Central</span><span><b>150</b></span></div>
              <div class="gexrow"><span>Target is that rate over ${D.settings.targetDays||60} days</span><span><b>${Math.round(150/30*(D.settings.targetDays||60))}</b></span></div>
              <div class="gexrow"><span>Buildable right now</span><span><b>60</b></span></div>
              <div class="gexrow tot"><span>So the page says</span><span><b style="color:var(--amb)">send ${Math.round(150/30*(D.settings.targetDays||60))-60} more</b></span></div>
            </div>
            ${P('Leave <b>Sold 30d</b> empty and it falls back to how many units we sent in the last 30 days. That is better than nothing, but it is not the same thing — a single big shipment makes it look like demand jumped. The box underneath says which one you are looking at: <b>sold</b>, or <b>sent 316</b>.',
                'The same figure drives components. <b>Short for ${D.settings.targetDays||60} days</b> on the Components tab adds up ${D.settings.targetDays||60} days of every product that uses a part, takes off what is on hand <i>and</i> on order, and lists whatever still comes up short. A part used in five bundles is counted across all five.',
                'How many days to aim for is in <b>Settings</b> — 30, 45, ${D.settings.targetDays||60} or 90. Change it and every target on the page moves with it.')}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Setting things up in bulk</span><span class="sub">adding a lot at once, without typing it twice</span></div>
          <div class="gbody">
            ${P('Adding parts and build lists one at a time is fine for the odd change. For anything bigger there are three tools, and they are meant to be used <b>in this order</b>.')}

            ${step(1,'Components first — Components → Bulk add',
              `Nothing else can be set up until the parts exist. Two ways in, and they do exactly the same thing:<br><br>
               <b>Type them in</b> (the default) — a grid with a line per component. Name, whether it is a
               <b>Component</b> or <b>Packaging</b>, how many you have right now, and what they cost each.
               Press <b>Enter</b> to drop to a new line, or <b>+ 5 lines</b> if you have a lot.<br><br>
               <b>Paste from a sheet</b> — copy the cells straight out of the spreadsheet. Columns separated by
               tabs or <b>|</b>, in this order:<br>
               <span style="color:var(--accent)"><b>Name | on hand | unit cost | packaging</b></span><br>
               Only the name is needed. Put the word <b>packaging</b> at the end for boxes and sleeves.<br><br>
               Either way it counts up what will be added before you commit, and anything whose name already
               exists is skipped, so running it twice cannot duplicate your list.`)}

            ${step(2,'Products next — Products → Bulk add',
              `Same two ways in. Typed: ASIN, SKU, name, <b>Bundle</b> or <b>Private label</b>, and VAT.
               Pasted:<br>
               <span style="color:var(--accent)"><b>ASIN | SKU | Product name | type | VAT</b></span><br>
               Type defaults to bundle and VAT to 20. Anything that does not look like an ASIN
               (B0 followed by 8 characters) gets a <b>check</b> flag — it is still added, it just wants a second look.`)}

            ${step(3,'Then the build lists — Products → Bulk build lists',
              `This is the one that saves the most time: a whole bundle per line.<br><br>
               <b>Type them in</b> — pick a bundle, pick its parts, set how many of each go into one unit,
               then <b>+ Another bundle</b> and carry on. It shows how many parts a bundle already has, so you
               can see at a glance what still needs doing.<br><br>
               <b>Paste from a sheet</b> — the product first, then each component after a <b>|</b>, with the
               quantity after an <b>x</b>:<br>
               <span style="color:var(--accent)"><b>Dove 75ml MD | Dove Lotion 75ml x1 | Exfoliating Glove x1 | Gift Box — Medium</b></span><br>
               Leave the quantity off and it means one. Names are matched loosely, so capitals and extra
               spaces do not matter, and a product can be named by its ASIN or SKU instead.<br><br>
               Anything it cannot find is shown in <b>amber</b> rather than dropped quietly, with a
               <b>Create the missing components</b> button. Saving <b>replaces</b> that bundle's whole build list —
               leave a bundle out of the list and it is not touched.`)}

            <div class="note" style="margin-top:4px"><b>The order matters.</b> Recipes can only point at parts
              that already exist, and products can only be given a build list once they exist. Components → products
              → build lists, every time. If you do get it out of order, the missing-components button in Bulk build lists
              digs you out.</div>
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Worked example</span><span class="sub">why the cost changes</span></div>
          <div class="gbody">
            ${P('Say we hold two batches of Dove lotion: <b>20 bought at £1.87</b> and <b>100 bought at £1.89</b>.')}
            <div class="gex">
              <div class="gexrow"><span>You try to send 70</span><span><b style="color:var(--red)">blocked</b></span></div>
              <div class="gexrow"><span>send the older batch first</span><span><b>20</b> @ £1.87 — COG <b>£1.87</b></span></div>
              <div class="gexrow"><span>then a second shipment</span><span><b>50</b> @ £1.89 — COG <b>£1.89</b></span></div>
              <div class="gexrow tot"><span>two shipments, two exact costs</span><span><b>no averaging</b></span></div>
            </div>
            ${P('Stock is <b>always</b> used oldest first, and <b>one shipment carries one cost</b>. If the units you are sending would come from two different purchase prices, the page stops you and offers to send the older price on its own.',
                'That is why the same product can cost slightly different amounts week to week — it is not a bug, it is exactly what we paid. Keeping them apart means every profit figure is real rather than an average.',
                'Batches that happened to cost <b>the same</b> are treated as one, so only a genuine price change ever blocks a shipment.',
                'There is an <b>override</b> for the odd time units have already gone into one Amazon shipment by mistake. It asks for a reason, records a blended cost and flags it in the log. Use it to fix a mistake, never as the normal route.',
                '<b>Packaging is left out of the cost</b> on purpose — boxes, sleeves and poly bags come off stock but do not count toward COG.')}
          </div></div>

      </div>

      <div class="gcolR">

        <div class="panel gpri"><div class="ph"><span class="t">Your daily routine</span><span class="sub">five minutes</span></div>
          <div class="gbody">
            ${q('1. Open Overview','Read the top row. <b>Sendable now</b> is what we could ship today. <b>Out of stock</b> is what is blocking us.')}
            ${q('2. Deal with the red list','Each blocked product says what it is out of and whether anything is on order. If it says <b style="color:var(--red)">nothing on order</b>, that needs Jack.')}
            ${q('3. Tick off what you have handled','Green ✓ hides it. If the stock figure changes it comes back on its own, so nothing gets forgotten.')}
            ${q('4. Check Deliveries','If the button shows a number, something is outstanding. Anything red has been waiting over three weeks — chase it.')}
            ${q('5. Send what needs sending','Ship from the Shipments page as normal. The stock and cost look after themselves.')}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Once a week</span></div>
          <div class="gbody">
            ${q('Update Sold 30d','Take the last 30 days of sales out of Seller Central and type them into the <b>Sold 30d</b> box on Products. Everything else — the target, what is short, which parts to buy — is worked out from that one number, so it is worth five minutes. Under each box it says how old the figure is: amber past a fortnight, red past a month.')}
            ${q('Check what is short','Anything amber on Products says <b>send N more</b> to reach ${D.settings.targetDays||60} days. Components → <b>Short for ${D.settings.targetDays||60} days</b> does the same for parts. Tell Jack before it gets to zero, not after.')}
            ${q('Spot-count the fast movers','Components → Adjust if the shelf disagrees with the screen. Always give a reason — it is logged.')}
            ${q('Look for "price missing"','Those batches came over without a price, so their cost is not counted. Worth chasing so the COG figures mean something.')}
            ${q('Check nothing is stranded','Overview flags components holding stock that are not in any product — usually a build list that never got finished.')}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Each tab, and what to look at</span></div>
          <div class="gbody">
            ${q('Overview','The morning check. Out of stock, what is landing, what moved recently.')}
            ${q('Products','Every Lavarion ASIN. <b>Sold 30d</b> is typed in by you; <b>${D.settings.targetDays||60}d target</b> and <b>send N more</b> follow from it. Click a row to see what it is made of and what one unit costs. <b>Open</b> gives the full picture — stock, incoming, cost build-up, history.')}
            ${q('Components','Every part and box. A part used in five bundles is <b>one shared pool</b> — building any of them draws from the same stock, so it does not need splitting up.')}
            ${q('Purchases','Two things. At the top, <b>On order</b> — everything bought and not yet arrived, with how it is coming and when it is due. Underneath, rows from the purchase sheet waiting to be pointed at the right component or product. Nothing is ever linked automatically — that is deliberate, because names on the sheet do not always match.')}
            ${q('Settings','Hide columns you never use, set how many days of stock to aim for at Amazon, pick which tab opens first. The build number lives here too — quote it in any bug report.')}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Common jobs</span></div>
          <div class="gbody">
            ${q('Something arrived','Deliveries → tick → Receive selected. Partial? Change the received number.')}
            ${q('We ordered something','+ Order. Price optional.')}
            ${q('A bundle is missing a part','Open the product → Edit build list → type the component name and how many go into one unit.')}
            ${q('Lots of new parts to add','Components → <b>Bulk add</b>. Type them in a grid or paste them from a sheet.')}
            ${q('Lots of build lists to set','Products → <b>Bulk build lists</b>. Do several bundles in one go.')}
            ${q('A component was added twice','Open it → Delete. It asks what will be lost, then removes it from the database for good.')}
            ${q('The count is wrong','Components → Adjust. Enter what you counted, pick a reason.')}
            ${q('A product is finished for good','Archive it. Nothing is deleted — it moves to the Archived filter.')}
            ${q('I clicked the wrong thing','Almost everything shows <b>Undo</b> for six seconds. Use it straight away.')}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">When a number looks wrong</span></div>
          <div class="gbody">
            ${q('"price missing"','That batch came over from the old system without a price. It fills in when the purchase is allocated, or re-log the order with the price.')}
            ${q('Buildable is 0 but we have stock','One part is at zero — look for the red text under the product name. A bundle needs every part.')}
            ${q('"send 300 more" looks wrong','The target is worked out from <b>Sold 30d</b>. If nobody has typed the sales figure in, it falls back to how many we sent, which is not the same thing. Put the real number in from Seller Central.')}
            ${q('Still on order but it arrived','It was never received here. Deliveries → tick it.')}
            ${q('Something you cannot explain','Screenshot it <b>with the build number</b> from Settings and send it over. The build number matters — it saves chasing things already fixed.')}
          </div></div>

        <div class="panel"><div class="ph"><span class="t">Tell Jack when…</span></div>
          <div class="gbody">
            ${q('A blocker has nothing on order','Nothing can be built until it is bought. This is the one that costs sales.')}
            ${q('A product is well short of its target','The Products tab says how many more to send. Early enough to do something about it.')}
            ${q('A delivery is three weeks late','It shows red in Deliveries.')}
            ${q('A count is badly out','Small corrections are normal. A large one usually means a purchase never got logged.')}
          </div></div>

      </div>
    </div>
  </div>`;
}

/* ═══════════════ SETTINGS ═══════════════ */
/* "Why isn't it saving?" should be answerable in one click rather than F12.
   Each table is probed on its own so the answer is a table name, not a shrug. */
const LAV_TABLES=[
  {t:'lavarion_asins',        what:'Products'},
  {t:'lavarion_components',   what:'Components'},
  {t:'lavarion_recipes',      what:'What each bundle is made of'},
  {t:'lavarion_stock_layers', what:'Stock batches, prices, deliveries'},
  {t:'lavarion_purchases',    what:'Purchase sheet rows'},
  {t:'lavarion_shipments',    what:'Units sent to Amazon'}
];
async function dbCheck(){
  const box=document.getElementById('dbCheckOut');
  if(box)box.innerHTML='<div class="pmeta" style="padding:10px 12px">Checking…</div>';
  const out=[];
  for(const row of LAV_TABLES){
    let state,msg='';
    try{
      const r=await sb.from(row.t).select('id').limit(1);
      if(r.error){state='missing';msg=r.error.message||'';}
      else state='ok';
    }catch(e){state='missing';msg=e.message||'';}
    out.push({...row,state,msg});
  }
  const bad=out.filter(x=>x.state!=='ok');
  if(box)box.innerHTML=`
    ${bad.length?`<div class="note bad" style="margin:0 0 10px">
        <b>${bad.length} table${bad.length===1?'':'s'} missing.</b> Anything that lives in ${bad.length===1?'it':'them'} works on screen
        but is <b>not saved</b> — it disappears on refresh. Copy the SQL below into Supabase and run it once.</div>`
      :`<div class="note" style="margin:0 0 10px;border-color:var(--grn)"><b style="color:var(--grn)">All six tables are there.</b>
        Everything is being saved. If something still vanishes on refresh, screenshot it with the build number.</div>`}
    ${out.map(x=>`<div class="dbrow">
      <span style="width:16px;text-align:center;color:${x.state==='ok'?'var(--grn)':'var(--red)'};font-weight:800">${x.state==='ok'?'✓':'✕'}</span>
      <span class="nm">${x.t}</span>
      <span class="pmeta" style="margin:0;flex:1;text-align:right">${esc(x.what)}</span>
      <span style="font-size:11px;font-weight:700;color:${x.state==='ok'?'var(--grn)':'var(--red)'}">${x.state==='ok'?'saving':'MISSING'}</span>
    </div>`).join('')}`;
  return out;
}
/* ═══════════════ HISTORY ═══════════════
   Everything that has happened, in one place. The per-component timeline
   answers "what happened to this part"; this answers "what happened at all" —
   and it outlives the products and components themselves, because it is text
   written at the time rather than a join onto rows that may be gone. */
let hFilter='all',hQ='',hWho='';
function setHWho(v){hWho=v||'';render();}
const H_KINDS=[['all','Everything'],['recv','Received'],['order','Ordered'],['ship','Sent'],
               ['adj','Corrections'],['edit','Changes']];
function setHFilter(k){hFilter=k;render();}
function setHQ(v){
  hQ=(v||'').toLowerCase();render();
  const box=document.getElementById('hSearch');
  if(box){box.value=v;box.focus();try{box.setSelectionRange(v.length,v.length);}catch(e){}}
}
function historyRows(){
  return (D.log||[]).filter(g=>{
    if(hFilter!=='all'&&g.k!==hFilter)return false;
    if(hQ&&!((g.txt||'')+(g.who||'')).toLowerCase().includes(hQ))return false;
    if(hWho&&g.who!==hWho)return false;
    return true;
  });
}
function exportHistory(){
  const rows=[['when','what happened','type','who']];
  historyRows().forEach(g=>rows.push([(g.t||'').slice(0,19).replace('T',' '),g.txt||'',g.k||'',g.who||'']));
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`lavarion-history-${dayISO()}.csv`;a.click();
  toast('History downloaded','ok');
}
function vHistory(){
  const all=D.log||[];
  const rows=historyRows();
  const counts={all:all.length};
  H_KINDS.slice(1).forEach(([k])=>{counts[k]=all.filter(g=>g.k===k).length;});
  /* group by day so it reads like a diary rather than a list */
  const byDay={};
  rows.slice(0,400).forEach(g=>{const d=(g.t||'').slice(0,10);(byDay[d]=byDay[d]||[]).push(g);});
  const days=Object.keys(byDay).sort().reverse();
  const oldest=all.length?(all[all.length-1].t||'').slice(0,10):'';
  $('lav3View').innerHTML=`
  <div class="panel stick">
    <div class="ph">
      <div class="seg">${H_KINDS.map(([k,l])=>`<button class="${hFilter===k?'on':''}" onclick="LV3.setHFilter('${k}')">${l}<span class="cnt">${fmt(counts[k]||0)}</span></button>`).join('')}</div>
      ${(()=>{const people=[...new Set(all.map(g=>g.who).filter(Boolean))].sort();
        return people.length>1?`<select class="in" style="width:auto" onchange="LV3.setHWho(this.value)">
          <option value="">Everyone</option>
          ${people.map(w=>`<option value="${esc(w)}" ${hWho===w?'selected':''}>${esc(w)}</option>`).join('')}
        </select>`:'';})()}
      <input class="srch" id="hSearch" placeholder="Search what happened…" value="${esc(hQ)}" oninput="LV3.setHQ(this.value)">
      <div class="r"><button class="btn" onclick="LV3.exportHistory()">Download CSV</button></div>
    </div>
    ${!all.length?'<div class="empty" style="padding:22px">Nothing has happened yet. Everything anyone does here is recorded from now on.</div>':''}
    ${all.length&&!rows.length?'<div class="empty" style="padding:22px">Nothing matches that.</div>':''}
    ${days.map(d=>`<div class="hDay">
      <div class="hDayHead">${dshort(d)}<span>${daysSince(d)===0?'today':daysSince(d)===1?'yesterday':daysSince(d)+' days ago'} · ${fmt(byDay[d].length)} thing${byDay[d].length===1?'':'s'}</span></div>
      ${byDay[d].map(g=>`<div class="hRow">
        <span class="hDot" style="background:${TL_COL[g.k]||'var(--text3)'}">${TL_ICON[g.k]||'·'}</span>
        <div class="hTxt">${esc(g.txt||'')}</div>
        <span class="hWho">${esc(g.who||'')}<i>${(g.t||'').slice(11,16)}</i></span>
      </div>`).join('')}
    </div>`).join('')}
  </div>
  <div style="font-size:11px;color:var(--text3);padding:0 2px;">
    ${all.length?`Showing ${fmt(Math.min(rows.length,400))} of ${fmt(rows.length)} · oldest kept: ${dshort(oldest)} · up to 4,000 entries are stored.`:''}
    Deleting a product or component does <b>not</b> remove its history — these lines are written at the time and stay whatever happens to the item.
  </div>`;
}
/* Where the sales figures come from, in plain terms, plus the one button that
   matters. Deliberately says READS in bold — the first question anyone asks
   about two systems talking is which one can change the other. */
function salesPanel(){
  const M=hubMonth(),rv=HUB.state==='ok'?hubReview():null;
  const todo=rv?(rv.missing.length+rv.blank.length):0;
  const when=HUB.at?new Date(HUB.at):null;
  return `<div class="panel">
    <div class="ph"><span class="t">Sales figures</span><span class="sub">read from the BDL hub</span>
      <div class="r"><button class="btn sm" onclick="LV3.hubRefresh()">Read it again</button>
        ${todo?`<button class="btn sm warn" onclick="LV3.openHubReview()">${fmt(todo)} to review</button>`:''}</div></div>
    <div style="padding:12px">
      <div class="frow"><span class="lab">Showing</span>
        <div style="font:800 15px var(--num);color:${M.status==='ok'?'var(--grn)':'var(--amb)'}">${esc(ymName(M.ym))}</div>
        <div class="pmeta" style="margin-top:4px">${
          M.status==='ok'?'Last full month, as it should be.'
          :M.status==='due'?`${esc(ymName(M.want))} is not in the hub yet. It is written up around the 6th, so this is normal — the page keeps using ${esc(ymName(M.ym))} and says so.`
          :M.status==='late'?`<b style="color:var(--amb)">${esc(ymName(M.want))} should be in the hub by now.</b> Every target is a month behind until the monthly report is done.`
          :M.status==='loading'?'Reading…'
          :`<b style="color:var(--amb)">Nothing came back.</b> ${esc(HUB.err||'')}`}</div></div>
      <div class="frow"><span class="lab">Products with a figure</span>
        <div style="font:800 15px var(--num)">${rv?`${fmt(rv.ok.length)} of ${fmt(rv.ok.length+todo)}`:'—'}</div>
        <div class="pmeta" style="margin-top:4px">${todo?`${fmt(todo)} have none — usually the hub knows them under a different ASIN. <b>Review</b> to point them at the right one.`
          :'Every live product is matched.'}</div></div>
      <div class="frow"><span class="lab">Months held</span>
        <div class="pmeta">${HUB.order.length?`${fmt(HUB.order.length)} — ${esc(ymName(HUB.order[0]))} to ${esc(ymName(HUB.order[HUB.order.length-1]))}. Two full months make the real two-month figure, so nothing has to be doubled.`:'none yet'}</div></div>
      <div class="note info">This <b>reads</b> the hub's monthly report and nothing else. It cannot write to it, change it, or
        delete from it — the sales numbers are worked out in one place and only one place.
        ${when?`Last read ${esc(dshort(localDay(when)))} at ${esc(String(when.getHours()).padStart(2,'0'))}:${esc(String(when.getMinutes()).padStart(2,'0'))}${HUB.cached?' — from the saved copy, the hub did not answer':''}.`:''}</div>
    </div>
  </div>`;
}
function vSettings(){
  const _eng=(key,val,unit,what)=>`<div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
      <input class="in" style="width:64px;text-align:center;font-weight:800;" type="number" value="${val}" onchange="LV3.plSet('${key}',this.value)">
      <span style="flex:0 0 92px;font-size:11px;color:var(--text3);font-weight:700;">${unit}</span>
      <span style="flex:1;font-size:12px;color:var(--text);">${what}</span></div>`;
  $('lav3View').innerHTML=`
  <div class="panel" style="border-left:3px solid var(--accent);margin-bottom:12px;">
    <div class="ph"><span class="t">The engine numbers</span>
      <span class="sub">every Planner recommendation is built from these five — check them once, they rarely change</span></div>
    <div style="padding:6px 16px 12px;">
      ${_eng('primeDays',primeDays(),'working days','From pressing send to SELLABLE at Amazon — courier + check-in. Everything late/early is judged against this.')}
      ${_eng('safetyDays',safetyDays(),'days','The panic buffer. Stock must never be planned to land with less than this to spare.')}
      ${_eng('targetDays',D.settings.targetDays||60,'days of cover','How much Amazon stock a send should leave behind when it lands. Bigger = fewer sends, more Amazon storage.')}
      ${_eng('cycleDays',cycleDaysN(),'days of cover','How much a PURCHASE should cover when it arrives. Bigger = fewer orders, more cash in stock.')}
      ${_eng('prepDays',prepDaysN(),'days','How long building/prepping takes in the warehouse before something can ship.')}
      <div class="pmeta" style="margin-top:8px;">Change one and every date and quantity on the Planner, Purchases and Overview recalculates instantly.</div>
    </div>
  </div>
  <div class="cols2">
      <div class="panel">
        <div class="ph"><span class="t">Purchase sheet</span><span class="sub">the same Lavarion tabs spend.dash reads</span>
          <div class="r"><button class="btn sm pri" onclick="LV3.go('purchases')">Go and sync</button></div></div>
        <div style="padding:12px">
          <div class="frow"><span class="lab">Sheet link</span>
            <input class="in mono" value="${esc(D.settings.lavSheet||'')}" placeholder="Paste the 2026 Purchase Tracker link\u2026" onchange="LV3.setPref('lavSheet',this.value.trim());LV3.go('settings')">
            <div class="pmeta" style="margin-top:4px">${(D.settings.lavSheet||'').trim()?`Saved \u2014 behind the login, not in the app file. Tabs read: <b>${esc(LAV_TABS.join(', '))}</b>.`:`<b style="color:var(--accent)">Nothing linked yet.</b> The address is kept behind the login on purpose \u2014 paste it here once and everyone gets it.`}</div></div>
          <div class="frow"><span class="lab">Import purchases from</span>
            <input class="in" type="date" value="${esc(D.settings.purchFrom||'2026-08-01')}" onchange="LV3.setPref('purchFrom',this.value)">
            <div class="pmeta" style="margin-top:4px">Anything older is ignored — that stock comes from the physical count you type in when adding a component.</div></div>
          <div class="note info">Reading only, and it goes through the same server-side helper this app already uses for the prep sheet — no key sits in this page and nothing here can change a cell.</div>
        </div>
      </div>
      <!-- "Who ships how" sat fifth, nearly 2,000px down, and went unfound for
           weeks. It decides every expected date on the page, so it goes first. -->
      ${supplierPanel()}
      ${salesPanel()}
      ${overridePanel()}
      ${ignoredPanel()}

      <div class="panel">
        <div class="ph"><span class="t">How long deliveries take</span><span class="sub">your methods and your timings</span>
          <div class="r">
            <button class="btn sm" onclick="LV3.modeAdd()">+ Add a method</button>
            <button class="btn sm" onclick="LV3.modesReset()" title="Back to the built-in list">Reset</button>
            <button class="btn sm ${_modesDirty?'pri':''}" id="modeSaveBtn" ${_modesDirty?'':'disabled'} onclick="LV3.modesSave()">${_modesDirty?'Save changes':'Saved'}</button>
          </div></div>
        <div style="padding:12px">
          <div class="pmeta" style="margin-bottom:9px">Used to work out the expected window when an order is logged or linked.
            Nothing changes until you press <b>Save changes</b> — and anything already on order keeps the dates it was given.</div>
          <div class="mdHead"><span>Method</span><span>Usually takes</span><span></span></div>
          ${modeDraft().map((m,i)=>`<div class="mdRow">
            <input class="in" value="${esc(m.label)}" oninput="LV3.modeEdit(${i},'label',this.value)" placeholder="What to call it">
            <span class="mdDays">
              <input class="in num" type="number" min="0" value="${m.lo}" onchange="LV3.modeEdit(${i},'lo',this.value)">
              <span class="pmeta" style="margin:0">to</span>
              <input class="in num" type="number" min="0" value="${m.hi}" onchange="LV3.modeEdit(${i},'hi',this.value)">
              <span class="pmeta" style="margin:0">days</span>
            </span>
            <button class="bkX" title="Remove this method" onclick="LV3.modeRemove(${i})">&#10005;</button>
          </div>`).join('')}
          <div class="note info" style="margin-top:11px">Sea freight from China is the one worth getting right — it is the
            difference between ordering in good time and running out.</div>
        </div>
      </div>

      <div class="panel">
        <div class="ph"><span class="t">Stock locations</span></div>
        <div style="padding:12px">
          <div class="frow"><span class="lab">Locations</span><input class="in" value="${esc(D.settings.locations)}" oninput="LV3.setPref('locations',this.value)"></div>
          <div class="note">Recorded per batch and shown in component detail. Availability is pooled across locations — a mitt at the prep centre still counts toward what you can build.</div>
        </div>
      </div>
      <div class="panel">
        <div class="ph"><span class="t">What you see</span><span class="sub">hide anything you don't use</span></div>
        <div style="padding:12px 14px">
          <div class="lab" style="margin-bottom:7px">Products table</div>
          <div class="colgrid">
            ${[['pIncoming','Incoming'],['pOrdered','Ordered date'],['pSold','Sold 30d'],['pSendBy','Action'],['pCog','COG / unit']]
              .map(([k,l])=>`<label><input type="checkbox" ${COL(k)?'checked':''} onchange="LV3.setCol('${k}',this.checked)"> ${l}</label>`).join('')}
          </div>
          <div class="lab" style="margin:14px 0 7px">Components table</div>
          <div class="colgrid">
            ${[['cOnOrder','On order'],['cOrdered','Ordered date'],['cUsed','Used in']]
              .map(([k,l])=>`<label><input type="checkbox" ${COL(k)?'checked':''} onchange="LV3.setCol('${k}',this.checked)"> ${l}</label>`).join('')}
          </div>
          <div class="lab" style="margin:14px 0 7px">SAS lookup link</div>
          <input class="in" value="${esc(D.settings.sasUrl||SAS_DEFAULT)}" oninput="LV3.setPref('sasUrl',this.value)">
          <div class="pmeta" style="margin-top:5px">Used by the SAS button on the stock count screen.
            <b>{ASIN}</b> is swapped for the ASIN, in every place it appears.</div>
          <div class="lab" style="margin:14px 0 7px">Oldest stock is decided by</div>
          <select class="in" onchange="LV3.setPref('fifoBy',this.value)">
            <option value="arrival" ${(D.settings.fifoBy||'arrival')==='arrival'?'selected':''}>The date it arrived — recommended</option>
            <option value="order" ${D.settings.fifoBy==='order'?'selected':''}>The date it was ordered</option>
          </select>
          <div class="pmeta" style="margin-top:5px">Sea freight ordered in June can land after a courier order placed in July.
            Going by arrival puts the price of the stock you actually have on the shelf onto the units you send.
            Changing this never re-costs anything already shipped.</div>
          <div class="lab" style="margin:14px 0 7px">Layout</div>
          <div class="colgrid">
            <label><input type="checkbox" ${D.settings.dense?'checked':''} onchange="LV3.setPref('dense',this.checked)"> Tighter rows</label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:14px">
            <div><span class="lab">Stock to aim for at Amazon</span>
              <select class="in" onchange="LV3.setPref('targetDays',parseInt(this.value))">
                ${[30,45,60,90].map(d=>`<option value="${d}" ${(D.settings.targetDays||60)===d?'selected':''}>${d} days of sales</option>`).join('')}</select></div>
            <div><span class="lab">Working days to become Prime-eligible</span>
              <input class="in num" type="number" min="1" max="${PRIME_MAX}" step="1" value="${primeDays()}"
                style="text-align:center" onchange="LV3.setPrimeDays(this.value)">
              <div class="pmeta" style="margin-top:4px">Mon&ndash;Fri only &mdash; weekends are never counted. Drives the
                <b>Send by</b> column. Put it up when Amazon slows down in Q4 and back down when it speeds up.</div></div>
            <div><span class="lab">Open Lavarion on</span>
              <select class="in" onchange="LV3.setPref('startTab',this.value)">
                ${[['overview','Overview'],['products','Products'],['components','Components'],['purchases','Purchases']]
                  .map(([v,l])=>`<option value="${v}" ${(D.settings.startTab||'overview')===v?'selected':''}>${l}</option>`).join('')}</select></div>
          </div>
          <div class="note info" style="margin-top:12px">Everyday screens stay simple — the full detail is always one click away in a product or component.</div>
        </div>
      </div>

      <div class="panel">
        <div class="ph"><span class="t">Backup</span><span class="sub">every product, component, build list, batch, purchase, shipment and log entry in one file</span>
          <div class="r"><button class="btn sm pri" onclick="LV3.backupAll()">Download a backup</button></div></div>
      </div>
      <div class="panel">
        <div class="ph"><span class="t">Build</span><span class="sub">${BUILD}</span></div>
        <div style="padding:11px 14px;font-size:12px;color:var(--text2)">
          If the sync badge flickers or something looks stale, check this line matches what you were told —
          Chrome caches local files hard, so a plain reload can serve an older copy. Use <b>Shift + ⌘ + R</b>.
          <div style="margin-top:8px;"><button class="btn sm" onclick="LV3.dbCheck()">Check the database is saving</button></div>
          <div id="dbCheckOut"></div>
        </div>
      </div>

  </div>`;
}

/* ── confirm ── */
function confirmBox(title,body,fn,opt){
  opt=opt||{};
  $('lav3Mod2').className='mod slim';
  $('lav3Mod2').innerHTML=`<div class="mh"><h3${opt.danger?' style="color:var(--red)"':''}>${title}</h3>
    <button class="x" onclick="LV3.cm('lav3Ov2')">&#10005;</button></div>
  <div class="mb"><div style="font-size:12.5px;line-height:1.65;color:var(--text)">${body}</div></div>
  <div class="mf"><span class="pmeta" style="margin:0">${opt.danger?'This cannot be undone once it reaches the database.':''}</span>
    <div class="sp"><button class="btn" onclick="LV3.cm('lav3Ov2')">Cancel</button>
    <button class="btn ${opt.danger?'dgr':'pri'}" id="cfOk">${esc(opt.ok||'Confirm')}</button></div></div>`;
  om('lav3Ov2');$('cfOk').onclick=()=>{cm('lav3Ov2');fn();};
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){cm('lav3Ov2');cm('lav3Ov1');}});


/* the UI calls save() after every change — but a repaint must never write */
let _painting=false;
function save(){if(_painting)return;writeBack();}

/* ── write everything the UI changed back to the app + Supabase ─────────── */
function writeBack(){
  /* anything created in the UI has no backing record yet — make one, so it
     survives the next hydrate and reaches Supabase */
  D.components.forEach(c=>{
    if(!c._src){
      const rec={id:c.id,uuid:null,name:c.name,kind:c.kind,tag:c.tag,caseQty:c.caseQty,archived:false};
      COMPS.push(rec);c._src=rec;
    }
  });
  D.products.forEach(p=>{
    if(!p._src){
      const a={id:p.id,uuid:null,asin:p.asin,sku:p.sku,prod:p.name,vat:p.vat,ptype:p.type,
        cost:0,total:0,dg:'No',notes:'',archived:false};
      lavAsins.push(a);p._src=a;
    }
  });
  /* and anything deleted in the UI must leave the store too */
  const liveC=new Set(D.components.map(c=>String(c.id)));
  for(let i=COMPS.length-1;i>=0;i--)if(!liveC.has(String(COMPS[i].id))&&!COMPS[i].archived)COMPS.splice(i,1);
  /* products are only ever removed by an explicit Delete, never by a sync pass */
  /* only push what genuinely changed — writing all 28 products on every save
     was what produced a wall of "save failed" toasts */
  let compsDirty=false;
  D.products.forEach(p=>{
    const a=p._src;if(!a)return;
    const rec=JSON.stringify(p.recipe);
    const sig=[p.name,p.asin,p.sku,p.vat,p.type,rec].join('|');
    if(a._sig===sig)return;
    a._sig=sig;
    saveProductSrc(p);compsDirty=true;
  });
  D.components.forEach(c=>{
    const src=c._src;if(!src)return;
    const sig=[c.name,c.kind,c.tag,c.caseQty].join('|');
    if(src._sig===sig)return;
    src._sig=sig;
    saveComponentSrc(c);compsDirty=true;
  });
  /* layers hang off the model objects — flatten them back into LAYERS */
  const flat=[];
  D.products.forEach(p=>(p.layers||[]).forEach(l=>{l.kind='product';l.tid=p.id;flat.push(l);}));
  D.components.forEach(c=>(c.layers||[]).forEach(l=>{l.kind='component';l.tid=c.id;flat.push(l);}));
  /* Record exactly which saved rows THIS SESSION removed. The push used to
     delete every database row not in this session's list — so with two people
     working, whoever saved second deleted whatever the other had just added,
     because their page hadn't loaded it yet. That is how stock vanished with
     both of you doing everything right. Now a row is only ever deleted if the
     person deleting it did so on purpose, here. */
  const now=new Set(flat.map(l=>l.uuid).filter(Boolean));
  /* …and the other half of the same hole. A batch is only ever flattened back
     if its product or component is loaded, so a batch whose owner is NOT on
     this page fell straight through into the delete list. That happens for
     reasons nobody would ever call "deleting stock": an ASIN removed from the
     catalogue (which leaves its batches behind on purpose), a component the
     other person added since this page loaded, or an asin/component read that
     came back short. Silent, and delayed until somebody else pressed save.
     A batch we cannot account for is not ours to delete — leave it alone. */
  const owned=new Set();
  D.products.forEach(p=>owned.add(String(p.id)));
  D.components.forEach(c=>owned.add(String(c.id)));
  LAYERS.forEach(l=>{
    if(!l.uuid||now.has(l.uuid))return;
    if(!owned.has(String(l.tid)))return;      // owner isn't here — not our call
    _layerTombs.add(l.uuid);
  });
  LAYERS=flat;
  PURCH=D.purchases;
  persist();
}

/* undo has to snapshot the real stores, not the hydrated view */
function snap(){
  _undoState=JSON.stringify({L:LAYERS,P:PURCH,
    R:JSON.parse(JSON.stringify(RECIPES)),
    T:D.products.map(p=>({id:p.id,type:p.type,name:p.name,vat:p.vat}))});
}
function doUndo(){
  if(!_undoState){toast('Nothing to undo','er');return;}
  const s=JSON.parse(_undoState);_undoState=null;
  LAYERS=s.L;PURCH=s.P;
  Object.keys(RECIPES).forEach(k=>delete RECIPES[k]);Object.assign(RECIPES,s.R);
  hydrate();
  s.T.forEach(t=>{const p=prod(t.id);if(p){p.type=t.type;p.name=t.name;p.vat=t.vat;}});
  writeBack();
  cm('lav3Ov1');cm('lav3Ov2');render();toast('Undone','ok');
}

/* the app's Shipments page still owns sending — make it deduct FIFO and
   record the COG it actually consumed */
/* Sending more than can be built used to deduct NOTHING. cogOf refuses to
   price a build it cannot make, and this bailed out on that same flag — so
   fourteen units could leave the building while the stock still read twelve,
   permanently, with nothing downstream to reconcile it. Stock has to move when
   stock moves. Take what is genuinely on the shelf, and hand the gap back so
   the caller can record it instead of losing it. */
function shipConsume(asin,units){
  const p=_prodByAsin(asin);
  if(!p||!units)return null;
  const av=avail(p)||{};
  const have=(av.n==null)?units:av.n;              // no recipe = no ceiling to enforce
  const take=Math.max(0,Math.min(units,have));
  const over=units-take;
  /* cost it BEFORE the layers move — afterwards the answer is a different one */
  const cg=take>0?cogOf(p,take):null;
  if(take>0){
    if(p.type!=='bundle')fifo(p,take).parts.forEach(pt=>{pt.layer.rem-=pt.take;});
    else p.recipe.forEach(r=>{const c=comp(r.c);if(c)fifo(c,r.q*take).parts.forEach(pt=>{pt.layer.rem-=pt.take;});});
    writeBack();
  }
  return{blocked:[],consumed:take,over,partial:over>0,
    per:(cg&&cg.per)||null,total:(cg&&cg.total)||0,batches:(cg&&cg.batches)||0,
    unpriced:(cg&&cg.unpriced)||[],
    layers:((cg&&cg.lines)||[]).map(l=>({name:l.name,parts:l.parts.map(x=>({qty:x.take,cost:x.cost}))}))};
}

/* Taking a line off a shipment has to put the stock back, or the units are
   gone for good. Layers carry both what was bought (qty) and what is left
   (rem), so the inverse of a FIFO draw is exact: refill oldest-first, capped
   at what that batch ever held, so a restore can never invent stock. */
function shipRestore(asin,units){
  const p=_prodByAsin(asin);
  if(!p||!units||units<=0)return null;
  const give=(o,n)=>{
    let need=n;
    for(const l of arrLayers(o)){
      if(need<=0)break;
      const room=Math.max(0,(l.qty||0)-(l.rem||0));
      if(room<=0)continue;
      const back=Math.min(room,need);l.rem+=back;need-=back;
    }
    return n-need;
  };
  let restored=0;
  if(p.type!=='bundle')restored=give(p,units);
  else{p.recipe.forEach(r=>{const c=comp(r.c);if(c)give(c,r.q*units);});restored=units;}
  writeBack();
  return{restored,short:units-restored};
}

/* Who sent what they did not have, when, and on which shipment. Append-only:
   settling marks a line settled, it never removes it. */
function openOverSent(){
  const map=(D.settings||{}).overSent||{};
  const rows=[];
  Object.keys(map).forEach(asin=>{
    const pr=D.products.find(x=>x.asin===asin);
    (map[asin]||[]).forEach(e=>rows.push({asin,name:(pr&&pr.name)||asin,...e}));
  });
  rows.sort((a,b)=>String(b.on).localeCompare(String(a.on)));
  const open=rows.filter(r=>!r.settled),done=rows.filter(r=>r.settled);
  const line=r=>`<tr>
    <td class="l"><div class="pname" style="font-size:12.5px;">${esc(r.name)}</div>
      <div class="psub">${esc(r.asin)}${r.shipId?' · '+esc(r.shipId):''}</div></td>
    <td style="text-align:right;font-weight:800;color:${r.settled?'var(--text3)':'var(--red)'};">${fmt(r.units)}</td>
    <td style="font-size:12px;color:var(--text2);">${esc(String(r.on||'').slice(0,10))} · ${esc(r.by||'—')}</td>
    <td style="text-align:right;">${r.settled
      ? `<span style="font-size:11.5px;color:var(--grn);">settled ${esc(String(r.settledOn||'').slice(0,10))}</span>`
      : `<button class="btn sm" onclick="LV3.settleOverSent('${r.asin}')">Settle</button>`}</td></tr>`;
  $('lav3Mod1').className='mod wide';
  $('lav3Mod1').innerHTML=`
  <div class="mh"><h3>Sent over stock</h3>
    <button class="x" onclick="LV3.cm('lav3Ov1')">&#10005;</button></div>
  <div class="mb">
    <div style="font-size:12.5px;color:var(--text2);line-height:1.55;margin-bottom:14px;">
      Someone sent more units than the shelf held and approved it at the time. Whatever stock
      existed was taken; what is listed here is the gap. Settle a line once the delivery that
      covers it has been booked in — the record stays either way.</div>
    ${open.length?`<table class="tbl"><thead><tr><th class="l">Product</th><th style="text-align:right;">Over</th><th>When · who</th><th></th></tr></thead>
      <tbody>${open.map(line).join('')}</tbody></table>`
     :`<div style="font-size:13px;color:var(--grn);padding:10px 0;">Nothing outstanding.</div>`}
    ${done.length?`<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 6px;">Settled</div>
      <table class="tbl"><tbody>${done.slice(0,25).map(line).join('')}</tbody></table>`:''}
  </div>`;
  om('lav3Ov1');
}

/* Settings can already answer "how often do we blend a COG, and why" for this
   page's own Ship modal. The Shipments-page modal was writing a log line only,
   which cannot be counted — same shape, same store. */
function noteOverride(o){
  D.settings.overrides=D.settings.overrides||[];
  const label=(OV_REASONS.find(r=>r[0]===o.k)||[])[1]||'';
  D.settings.overrides.unshift({on:dayISO(),by:(window.currentUserName||'someone'),
    shipId:o.shipId||'',prod:o.prod||'',units:o.units||0,k:o.k||'other',
    why:o.note||label||'blended across two purchase prices',
    cost:Number(o.cost||0)});
  D.settings.overrides=D.settings.overrides.slice(0,300);
  savePrefs();
}

/* An overdraw is a fact about the business, not a warning that scrolls away.
   Appended, never overwritten, and settled by a person on the Lavarion page.
   Lives in settings so it needs no migration. */
function noteOverSent(asin,units,shipId,who){
  if(!units||units<=0)return;
  D.settings.overSent=D.settings.overSent||{};
  const list=D.settings.overSent[asin]=D.settings.overSent[asin]||[];
  list.push({on:new Date().toISOString(),units:units,shipId:shipId||'',
             by:who||(window.currentUserName||'someone'),settled:false});
  savePrefs();
}
function overSentFor(asin){
  const l=((D.settings||{}).overSent||{})[asin]||[];
  return l.filter(x=>!x.settled).reduce((s,x)=>s+(x.units||0),0);
}
function settleOverSent(asin){
  const l=((D.settings||{}).overSent||{})[asin]||[];
  l.forEach(x=>{if(!x.settled){x.settled=true;x.settledOn=new Date().toISOString();
                               x.settledBy=(window.currentUserName||'someone');}});
  savePrefs();render();
}
/* what a shipment would cost / whether it can go — no mutation */
/* Jack, 7 Sep, live: "Tea & Biscuits Hamper is not a product the Lavarion
   page knows" — on a tab that had never opened the Lavarion page. hydrate()
   runs at boot (before login, so lavAsins is still empty) and again only on
   paint. Anything that touches stock from another page must hydrate first.
   This is the 6 Sep hole too: same tab state, same empty list, no deduction. */
function _prodByAsin(asin){
  let p=D.products.find(x=>x.asin===asin);
  if(!p&&typeof lavAsins!=='undefined'&&lavAsins.length){hydrate();p=D.products.find(x=>x.asin===asin);}
  return p||null;
}
function shipCheck(asin,units){
  const p=_prodByAsin(asin);
  if(!p)return null;
  const cg=cogOf(p,units||1);
  return{ok:!cg.blocked.length,per:cg.per,available:avail(p).n,type:p.type,
    short:cg.blocked.map(b=>({name:b.o.name,need:b.need,have:b.have,short:b.short}))};
}

/* ── boot ───────────────────────────────────────────────────────────────── */
let _booted=false;
async function boot(){
  if(_booted)return;_booted=true;
  await loadPrefs();
  await loadState();
  await loadCompsRecipes();
  await loadCloud();
  await migrateOld();
  hydrate();
  /* Nothing is repaired on load any more. Quietly re-pointing links is how this
     went wrong in the first place: the app decided, nobody saw it, and when it
     decided wrongly there was no trace. It flags what it found and a person
     approves it — see openFixLinks.
     The ONE exception, and only because there is no judgement in it: a line
     identical to an already-linked one in date, order, name, quantity, price
     AND supplier is a copy of that line, full stop — the sheet holds it once.
     Jack, 3 Sep: "why does the UK staff have to do it?" They should not.
     It still leaves a trace: the audit log, the console and a toast. */
  try{const _h=healExactCopies('page load');
    if(_h){save();toast(`${fmt(_h)} duplicate purchase line${_h===1?'':'s'} cleared automatically`,'ok');}
  }catch(e){console.warn('[lav3] heal on load',e);}
  /* lines the old sync flagged as a question are answered the way Jack says
     they always are — kept as separate purchases; removable in one click */
  try{const _pend=dupPending();
    if(_pend.length){_pend.forEach(p=>{p.dupCheck={...(p.dupCheck||{}),answered:'separate',by:'auto',on:dayISO()};
      logIt('edit',`Kept as a second purchase — ${p.name} ${dshort(p.date)} (identical sheet line, answered automatically)`);});save();}
  }catch(e){console.warn('[lav3] dup auto-keep',e);}
  paint();
  /* Sales come from the hub, over the network, so they are not held up behind
     the page drawing. The page appears with the sold column reading "reading
     the hub…", then fills in. */
  hubLoad().then(()=>{try{paint();}catch(e){}}).catch(e=>console.warn('hub sales',e));
}
const isUntracked=id=>!!(D.settings&&D.settings.untracked&&D.settings.untracked[String(id)]);
const COL=k=>{const c=(D.settings&&D.settings.cols)||{};return c[k]!==false;};
function paint(){
  if(!document.getElementById('lav3View'))return;
  if(_firstPaint){_firstPaint=false;const t=D.settings.startTab;if(t&&t!=='overview')TAB=t;}
  const pg=document.getElementById('page-lavarion');
  if(pg)pg.classList.toggle('dense',!!D.settings.dense);
  _painting=true;
  hydrate();
  render();
  _painting=false;
  const b=document.getElementById('lav3Schema');
  if(b)b.innerHTML=SCHEMA_MSG
    ?`<div class="schemabar bad">
        <span class="sbIcon">!</span>
        <div class="sbTxt"><b>Nothing on this page is being saved.</b>
          <span>${SCHEMA_MSG} Everything you type works on screen, but it is held in memory only and is lost the moment you refresh.</span></div>
        <button class="btn warn sm" onclick="LV3.go('settings')">Fix it — run the SQL</button></div>`:'';
}

/* everything the page's inline handlers need */
const API={go,render:paint,boot,dupConfirm,__layers:()=>LAYERS,__purch:()=>PURCH,
  openProduct,editProduct,setType,setSold30,rowMenu,closeRowMenu,dupeAsins,setSort,saveProductForce,addRecipeRow,rcChange,rcSearch,rcPick,rcMake,recipePreview,copyRecipe,saveProduct,delProduct,togRow,setArchived,
  openShip,drawShip,doShip,copyCog,shipSetQty,shipOverride,shipQty,shipFba,setQ,selOne,selAll,selClear,selType,selVat,
  openComp,editComp,saveComp,delComp,pickKind,openAddBatch,abPreview,doAddBatch,selArchive,selDelete,cselOne,cselAll,cselClear,cselKind,cselTrack,cselArchive,cselDelete,markArrived,openAdjust,doAdjust,
  openLink,saveAlloc,clearAlloc,quickLink,killPurch,guessMode,forgetAlias,pFilter,togglePurchAll,syncPurchases,applyAllSuggestions,dropReview,clearReview,linkOrder,dropOrder,addAllocRow,allocSum,useSuggestion,fillRest,
  openBulkComp,bcPreview,bcSave,bcMode,bcAddRow,bcDelRow,openBulkProd,bpPreview,bpSave,bpMode,bpAddRow,bpDelRow,
  openBulkRecipe,brMode,brPreview,brSave,brAddProd,brDelProd,brAddPart,brDelPart,brMakeMissing,
  openMatrix,mxSetMode,mxRender,mxAddCol,mxSave,mxStep,mxOne,mxAdd,mxPick,mxKey,mxSug,mxOneQty,mxOneDel,
  openData,exportCsv,backupAll,exportHistory,setHFilter,setHQ,setHWho,copySql,dbCheck,clearAll,doUndo,gsRun,gsGo,toggleOos,toggleLog,openLogOrder,loFilter,loEta,loDays,loWhy,saveOrder,setEta,setEtaDM,setModeDays,shipModes,modeDraft,modeEdit,modeAdd,modeRemove,modesSave,modesReset,markChased,shortEnd,shortState,writeOffShort,orderState,ordQty,rcvdQty,outQty,
  sendBy,sendState,primeDays,setPrimeDays,workDaysBefore,workDaysBetween,
  undeclareShort,openRepl,saveRepl,damagedLines,dmgEnd,acOnly,supplierIssues,logSupplierIssue,setSupplierIssueField,rcvThatsIt,shortLines,showReview,ghostAllocs,staleDupes,dropDupes,dropOneDupe,dupKeepAll,dupTwin,nameClose,typoOf,openFixLinks,fxFind,fxPick,fxClear,fxSaveAll,buyToggle,revToggle,shipOvConfirm,repairAllocLinks,healthCheck,fixHealth,setSupplierMode,knownSuppliers,dlvArrived,dlvArrivedOrder,dlvPast,openAtAmz,amzParse,amzSave,amzMode,amzGridSum,sold60,openOrderPlan,atAmz,
  hubLoad,hubRefresh,openHubReview,hbFind,hbPick,hbSkip,hbUnskip,hbSaveAll,hubMonth,ymName,hubClashes,
  sortCol,amzWhen,localDT,copyAsin,nextCog,lavShipList,lavShipInfo,amzIn,atAmzAll,sentSince,amzDry,openUseIn,saveUseIn,rsSet,rsQty,rsClear,rsDrop,rsFind,setLead,reorderIn,replenQty,openKilled,revivePurchLine,openMerge,mergeIntoTwin,mergeKeepBoth,restockPlanMulti,rsLogAll,rsToggle,rsToggleTbl,supFind,supToggleAll,alFind,alPick,alKey,openDeliveries,dlvSum,dlvPickOrder,dlvReceive,receiveRow,openReceive,rcvPreview,rcvConfirm,rcvShowDmg,rcvDmgBump,rcvSet,rcvBump,clearNote,openNotes,toggleHist,ack,ackClear,compOptions,setCol,setPref,
  shipCheck,shipConsume,shipRestore,supplierAsks,leadApplyAll,leadSuggest,noteOverSent,overSentFor,settleOverSent,openOverSent,noteOverride,lavShipSplit,plSet,setPlanDemand,plUnskip,toggleProdTime,setProdTime,plSkip,setRouteGroup,shortMore,openPlanRow,rsDate,rsGoalMode,wlTick,wlUntick,wlWho,ppGo,buySkipSet,ovModel,acSnooze,acUnsnooze,build:()=>BUILD,copyBuyList,lavLateCount,lavLateList,rsCopyList,
  ovReasons:()=>OV_REASONS.map(r=>[r[0],r[1]]),
  cm:id=>cm(id),om:id=>om(id),
  setFilter:(k,v)=>{if(k==='p'){pFilter=v;SEL.clear();}if(k==='c')cFilter=v;if(k==='u')uFilter=v;render();},
  rehydrate:()=>{try{hydrate();}catch(e){}},
  flush:()=>{clearTimeout(_pt);return pushNow();},
  isReady:()=>READY};
return API;
})();

/* ── page wiring ────────────────────────────────────────────────────────── */
(function(){
  function open(){ try{ LV3.boot(); }catch(e){ console.warn('lav3 boot',e); } }
  if(typeof window.goPage==='function'){
    const _g=window.goPage;
    window.goPage=function(n){const r=_g.apply(this,arguments);if(n==='lavarion')open();return r;};
  }
  window.renderLavarion=function(){ try{ LV3.render(); }catch(e){} };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(open,900));
  else setTimeout(open,900);
  ['lav3Ov1','lav3Ov2'].forEach(id=>{const o=document.getElementById(id);
    if(o)o.addEventListener('click',e=>{if(e.target===o)cm(id);});});
})();

/* ── Shipments page: same stock truth, same COG ─────────────────────────────
   The old hook simply subtracted qty×units with no cost and no guard. This
   replaces it: FIFO consumption, a computed COG written onto the shipment
   line, and a loud warning (not a hard block) when stock is short — Becki is
   mid-send there, so she is told rather than stopped. */
(function(){
  if(typeof saveLavShipment!=='function')return;
  const _orig=saveLavShipment;
  window.saveLavShipment=async function(sh){
    try{
      const n=parseInt(sh.units)||0;
      if(n>0&&window.LV3){
        /* Becki, 7 Sep: FBA15MCJBV68 — 60 hampers recorded, not one teabag
           taken off. The Lavarion data had not loaded in that tab, so
           shipConsume found no product, returned nothing, and the line was
           written anyway. Stock has to move when stock moves: load first,
           and if it still cannot, refuse the line rather than write a lie. */
        if(!(LV3.isReady&&LV3.isReady())){try{await LV3.boot();}catch(e){}}
        if(!(LV3.isReady&&LV3.isReady())){
          toast('BLOCKED — the Lavarion stock is not loaded in this tab, so the parts cannot be taken off. Reload the page and send again.','er');
          try{logAudit('Lavarion send refused',`${sh.asin} x${n} on ${sh.shipId} — stock not loaded, nothing recorded`);}catch(e){}
          return false;
        }
        /* Jack, 30 Aug: oversending is a HARD BLOCK now, not a warning. */
        try{
          const pre=LV3.shipCheck?LV3.shipCheck(sh.asin,n):null;
          if(pre&&pre.available!=null&&n>pre.available){
            toast(`BLOCKED — only ${pre.available} in stock, cannot send ${n}. Receive the delivery or correct the count first.`,'er');
            return false;
          }
        }catch(e){}
        /* shipConsume now reports what it actually took and what it could not,
           so the warning is driven off what happened rather than off a check
           that ran beforehand and could disagree with it. */
        const res=LV3.shipConsume(sh.asin,n);
        if(!res){
          toast(`⚠ ${sh.prod||sh.asin} is not a product the Lavarion page knows — recorded, but no parts were taken off. Check the ASIN on the Products tab.`,'er');
          try{logAudit('Lavarion sent — parts NOT taken off',`${sh.asin} x${n} on ${sh.shipId} — ASIN not found on the Lavarion page`);}catch(e){}
        }
        if(res){
          if(res.per!=null&&res.per>0&&(!sh.cost||sh.cost===0))sh.cost=Math.round(res.per*10000)/10000;
          if(res.per!=null)sh.cogAuto=res.per;
          sh.layersUsed=res.layers;
          if(res.over>0){
            sh.overSent=res.over;
            try{LV3.noteOverSent(sh.asin,res.over,sh.shipId);}catch(e){}
            toast(`⚠ ${sh.prod||sh.asin} — only ${res.consumed} were in stock. ${res.over} more went out than exists; recorded as owed, settle it on the Lavarion page when the delivery lands.`,'er');
            try{logAudit('Lavarion sent short',`${sh.asin} x${n} on ${sh.shipId} — ${res.consumed} in stock, ${res.over} overdrawn`);}catch(e){}
          }
          /* the quiet one: enough stock, but a part was booked in with no
             price, so the COG came out as nothing and nobody was told */
          if((res.unpriced||[]).length){
            const names=res.unpriced.map(u=>u.name).filter(Boolean).join(', ');
            toast(`⚠ ${sh.prod||sh.asin} — no purchase price on ${names||'a component'}, so the COG could not be worked out. Check the figure on the line.`,'er');
            try{logAudit('Lavarion sent unpriced',`${sh.asin} x${n} on ${sh.shipId} — no price on ${names}`);}catch(e){}
          }
        }
      }
    }catch(e){console.warn('[lav3] ship hook',e);}
    return _orig(sh);
  };
})();


/* ── MONTH HISTORY POPUP ──────────────────────────────────────────────────────
   Opened from the "This Month" tile. Navigable per-month view that reuses the
   real figures from _insMonthSeries() so it can never disagree with the tiles.
   Layout is fixed-height and the arrows are edge-pinned so nothing shifts as you
   change month. ← / → keys navigate; click any bar to jump. */
let _mhKey=null;
function openMonthHistory(key){
  const ser=(typeof _insMonthSeries==='function'?_insMonthSeries():[]);
  if(!ser.length){toast('No month history yet');return;}
  _mhKey=key||ser[ser.length-1].key;
  if(!ser.some(s=>s.key===_mhKey))_mhKey=ser[ser.length-1].key;
  _mhRender(ser);
  om('monthHistModal');
}
function _mhNav(d){
  const ser=(typeof _insMonthSeries==='function'?_insMonthSeries():[]);
  const i=ser.findIndex(s=>s.key===_mhKey);
  const ni=Math.min(ser.length-1,Math.max(0,i+d));
  if(ni===i)return;
  _mhKey=ser[ni].key;_mhRender(ser);
}
function _mhPick(key){if(key===_mhKey)return;_mhKey=key;_mhRender(_insMonthSeries());}
document.addEventListener('keydown',function(e){
  const m=document.getElementById('monthHistModal');
  if(!m||!m.classList.contains('open'))return;
  if(e.key==='ArrowLeft'){e.preventDefault();_mhNav(-1);}
  else if(e.key==='ArrowRight'){e.preventDefault();_mhNav(1);}
});
/* The month popup had thirteen colours competing — every tile tinted, every
   figure a different hue — so "Units / SKU" shouted as loudly as "COG value"
   and nothing led the eye. Rebuilt around what the month actually is: two
   headline numbers, everything else quiet underneath, and one chart instead of
   two stacked. Colour now means something — amber is money, cyan is volume,
   green and red are only ever direction of travel. */
let _mhChart='units';
function _mhSetChart(k){_mhChart=k;_mhRender(_insMonthSeries());}

function _mhRender(ser){
  const GOLD='#f59e0b', CYAN='#22d3ee';
  const TXT='#e8e4dc', SUB='#a8a196', MUTE='#7d7568', LINE='rgba(255,255,255,.07)';
  const i=ser.findIndex(s=>s.key===_mhKey);
  const m=ser[i]||ser[ser.length-1];
  const prev=ser[i-1]||null;
  const [y,mo]=m.key.split('-');
  const full=new Date(+y,+mo-1,1).toLocaleString('en-GB',{month:'long',year:'numeric'});
  const isCurrent=i===ser.length-1;

  const others=ser.filter((s,idx)=>idx!==i && idx!==ser.length-1);
  const avgU=others.length?others.reduce((a,s)=>a+s.units,0)/others.length:0;
  let verdict=null;
  if(avgU){const r=m.units/avgU;
    verdict = r>=1.10?{t:`${Math.round((r-1)*100)}% above your average`,c:'#4ade80'}
            : r>=0.90?{t:'around your average',c:SUB}
            :          {t:`${Math.round((1-r)*100)}% below your average`,c:'#fb923c'};}
  const isPeak=ser.length>1 && m.units===Math.max(...ser.map(s=>s.units)) && m.units>0;
  const prepPctCog=m.cog?(m.prep/m.cog*100):0;
  const upshp=m.ships?(m.units/m.ships):0;

  /* one delta treatment everywhere: an arrow and a number, green or red purely
     for direction — never decoration */
  const delta=(cur,pv,lowerIsBetter)=>{
    if(!pv)return `<span style="color:${MUTE};font-size:12px;">first month</span>`;
    const pc=((cur-pv)/pv)*100;
    if(!isFinite(pc))return '';
    const up=pc>=0, good=lowerIsBetter?!up:up;
    const col=Math.abs(pc)<1?SUB:(good?'#4ade80':'#f87171');
    return `<span style="color:${col};font-size:12.5px;font-weight:700;">${up?'▲':'▼'} ${Math.abs(pc).toFixed(0)}%</span>
            <span style="color:${MUTE};font-size:12px;"> vs ${prev?prev.short:'last month'}</span>`;
  };

  /* the two numbers the month is actually judged on */
  const hero=(label,val,col,d)=>`
    <div style="background:var(--bg2);border:1px solid var(--border2);border-left:3px solid ${col};
      border-radius:10px;padding:15px 17px;">
      <div style="font-size:11px;font-weight:700;color:${SUB};text-transform:uppercase;letter-spacing:.07em;">${label}</div>
      <div style="font-size:30px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;
        color:${col};line-height:1.15;margin:5px 0 6px;white-space:nowrap;">${val}</div>
      <div>${d}</div>
    </div>`;

  /* everything else is supporting detail: same weight, no tint, no competing
     colours — readable in a glance down the column */
  const cell=(label,val,note)=>`
    <div style="padding:10px 12px;border-right:1px solid ${LINE};border-bottom:1px solid ${LINE};">
      <div style="font-size:11px;color:${SUB};margin-bottom:4px;">${label}</div>
      <div style="font-size:16px;font-weight:800;font-family:var(--num);font-variant-numeric:tabular-nums;color:${TXT};line-height:1.1;">${val}</div>
      ${note?`<div style="font-size:11px;color:${MUTE};margin-top:3px;">${note}</div>`:''}
    </div>`;

  const segs=[['Standard',m.mixStd||0,'#60a5fa'],['DG',m.mixDG||0,'#f87171'],
              ['Oversize',m.mixOS||0,'#fb923c'],['Lavarion',m.mixLav||0,'#c084fc']];
  const mixTot=segs.reduce((a,s)=>a+s[1],0), mixDen=mixTot||1;
  const mixBar=segs.filter(s=>s[1]>0).map(([l,u,c])=>{
    const pc=u/mixDen*100;
    return `<div title="${l}: ${fmt(u)} (${pc.toFixed(1)}%)" style="width:${pc}%;background:${c};"></div>`;}).join('');
  const mixLegend=segs.filter(s=>s[1]>0).map(([l,u,c])=>`
    <div style="display:flex;align-items:center;gap:7px;font-size:12px;">
      <span style="width:8px;height:8px;border-radius:2px;background:${c};flex-shrink:0;"></span>
      <span style="color:${SUB};flex:1;">${l}</span>
      <span style="font-family:var(--num);font-variant-numeric:tabular-nums;font-weight:800;color:${TXT};">${fmt(u)}</span>
      <span style="color:${MUTE};width:38px;text-align:right;">${Math.round(u/mixDen*100)}%</span>
    </div>`).join('');

  /* one chart, switchable — two stacked charts said the same thing twice and
     ate the height that made everything else feel cramped */
  const isU=_mhChart==='units';
  const field=isU?'units':'cog', accent=isU?CYAN:GOLD;
  const fmtFn=isU?fmt:(v=>fmtGBP2(v).replace(/\.00$/,''));
  const mx=Math.max(...ser.map(s=>s[field]),1);
  const chart=`
    <div style="display:flex;align-items:flex-end;gap:8px;height:112px;">
      ${ser.map(s=>{const h=Math.max(4,Math.round(s[field]/mx*88));const on=s.key===m.key;
        return `<div onclick="_mhPick('${s.key}')" title="${s.short}: ${fmtFn(s[field])}"
          style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;cursor:pointer;min-width:0;">
          <div style="font-size:11px;font-family:var(--num);font-variant-numeric:tabular-nums;
            font-weight:${on?'800':'600'};color:${on?accent:MUTE};white-space:nowrap;">${fmtFn(s[field])}</div>
          <div style="width:100%;height:${h}px;background:${on?accent:'#332f29'};border-radius:5px 5px 0 0;transition:background .15s;"></div>
        </div>`;}).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:7px;border-top:1px solid ${LINE};padding-top:7px;">
      ${ser.map(s=>{const on=s.key===m.key;
        return `<div style="flex:1;text-align:center;font-size:11px;font-weight:${on?'800':'500'};
          color:${on?TXT:MUTE};white-space:nowrap;">${s.short}</div>`;}).join('')}
    </div>`;
  const tab=(k,label,col)=>`<button onclick="_mhSetChart('${k}')" style="padding:4px 11px;border-radius:6px;cursor:pointer;
    font-size:12px;font-weight:800;border:1px solid ${_mhChart===k?col:'var(--border2)'};
    background:${_mhChart===k?col+'22':'transparent'};color:${_mhChart===k?col:SUB};">${label}</button>`;

  const navBtn=(dir,dis,ch)=>`<button onclick="_mhNav(${dir})" ${dis?'disabled':''}
    style="width:34px;height:34px;border-radius:9px;border:1px solid var(--border2);background:var(--bg2);
    color:${dis?MUTE:TXT};font-size:17px;cursor:${dis?'default':'pointer'};opacity:${dis?'.4':'1'};">${ch}</button>`;

  document.getElementById('monthHistBody').innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;">
      ${navBtn(-1,i<=0,'&lsaquo;')}
      <div style="text-align:center;flex:1;min-width:0;">
        <div style="display:flex;align-items:center;justify-content:center;gap:9px;flex-wrap:wrap;">
          <span style="font-size:20px;font-weight:800;color:${TXT};">${full}</span>
          ${isPeak?`<span style="font-size:11px;font-weight:800;color:#1a1a18;background:${GOLD};padding:2px 8px;border-radius:5px;">BEST MONTH</span>`:''}
        </div>
        <div style="font-size:12px;margin-top:4px;color:${isCurrent?CYAN:(verdict?verdict.c:MUTE)};font-weight:${isCurrent?'700':'400'};">
          ${isCurrent?'Still in progress':(verdict?verdict.t:'')}</div>
      </div>
      ${navBtn(1,i>=ser.length-1,'&rsaquo;')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:11px;">
      ${hero('Units sent',fmt(m.units),CYAN,delta(m.units,prev&&prev.units,false))}
      ${hero('Stock value sent',fmtGBP2(m.cog),GOLD,delta(m.cog,prev&&prev.cog,false))}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;">
      <div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden;
          display:grid;grid-template-columns:1fr 1fr 1fr;">
          ${cell('Shipments',fmt(m.ships))}
          ${cell('SKU lines',fmt(m.skus))}
          ${cell('ASINs',fmt(m.asins))}
          ${cell('Boxes',fmt(m.boxes))}
          ${cell('Units / shipment',upshp?upshp.toFixed(0):'—')}
          ${cell('Units / SKU',m.skus?(m.units/m.skus).toFixed(1):'—')}
          ${cell('COG / unit',m.units?fmtGBP2(m.cogPerUnit):'—','average stock value')}
          ${cell('Prep cost',fmtGBP2(m.prep),'inc VAT')}
          ${cell('Prep / unit',m.units?fmtGBP2(m.ppu):'—',prepPctCog?prepPctCog.toFixed(1)+'% of COG':'')}
        </div>
        <div style="font-size:11.5px;color:${MUTE};line-height:1.55;margin-top:9px;">
          Prep per unit is blended — the 50p base rate plus oversize (£1.50/unit) and box (£1/box) extras, incl. VAT.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:11px;">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px;">
          <div style="font-size:11px;font-weight:700;color:${SUB};text-transform:uppercase;letter-spacing:.07em;margin-bottom:9px;">
            What went out · ${fmt(mixTot)} units</div>
          <div style="display:flex;height:9px;width:100%;border-radius:5px;overflow:hidden;background:rgba(255,255,255,.05);margin-bottom:11px;">
            ${mixBar||`<div style="width:100%"></div>`}</div>
          <div style="display:flex;flex-direction:column;gap:7px;">${mixLegend||`<div style="font-size:12px;color:${MUTE};">Nothing sent this month</div>`}</div>
          <div style="font-size:11.5px;color:${MUTE};margin-top:10px;line-height:1.5;">
            Lavarion ships as standard but is counted on its own, so it is never doubled into the Standard figure.</div>
        </div>

        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:13px 15px;">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:12px;">
            ${tab('units','Units',CYAN)}${tab('cog','Stock value',GOLD)}
            <span style="margin-left:auto;font-size:11px;color:${MUTE};">click a bar, or ← →</span>
          </div>
          ${chart}
        </div>
      </div>
    </div>`;
}
