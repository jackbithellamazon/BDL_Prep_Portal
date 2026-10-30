/* BDL PrepHub — js/sfcheck.js — the SellerFuse check (Jack, 23 Oct 2026: "go").
   Claude runs on Jack's Mac Sun + Tue + Thu 20:00 UK (Jack, 29 Oct — was Mon + Thu 07:00), reads SellerFuse and writes what
   it saw into sf_check_runs — one row per run. The run only CARRIES data; this
   file decides what it means, so the rules can be checked like everything else.
   PREP ONLY: Amazon receiving claims, costs and write-offs belong to the
   reimbursement system, not here.
   Automatic: the late-order answer on Sarah's cards, PLUB stock at Amazon and
   sold-in-30-days (lavarion.js sfApplyFromRun), and an order removed from the
   sheet that Amazon shows shipped comes back. Everything else is listed with a
   button — a person presses it. */
let SFRUN=null;
const SF_STALE_DAYS=4;   /* Thu → Sun is 3 days */
/* Amazon's shipment date from SellerFuse — OFF until Jack confirms SellerFuse's "created" is the UK day (29 Oct:
   it would move 12 rows on FBA15MS5FS83 from 28 to 27 Oct, and Becki stamped them at 11:18 on the 28th). */
let SF_DATES_TRUSTED=true;   /* Jack, 29 Oct: Seller Central shows FBA15MS5FS83 created 27 Oct — SellerFuse's date is the UK day */
/* Jack, 29 Oct: Sun / Tue / Thu at 20:00 UK — the evening before Sarah's Monday, Wednesday and Friday (she starts
   04:00 UK), inside his awake hours so the Mac is on. "3 is better than 2 — up to 4 when needed": add a day here
   (Monday next, for Becki's post-weekend sends) and in the scheduled task. */
const SF_SLOT_DAYS=[0,2,4],SF_SLOT_HOUR=20,SF_GRACE_H=2;
/* 20:00 UK on that day — counted from UTC, so a clock-change Sunday (23 or 25 hours long) is still 20:00 */
const _sfSlotAt=iso=>{const p=iso.split('-').map(Number),g=Date.UTC(p[0],p[1]-1,p[2],SF_SLOT_HOUR);return g-_ukOffMin(g)*6e4;};
function _sfLastSlot(now){now=now==null?Date.now():now;const t=ukDayISO(now);
  for(let k=0;k<8;k++){const d=ukAddDays(t,-k);if(!SF_SLOT_DAYS.includes(ukWeekdayOf(d)))continue;const s=_sfSlotAt(d);if(s<=now)return s;}
  return 0;}
/* the slot being judged: tonight's from 22:00, until then the one before */
function _sfDueSlot(now){now=now==null?Date.now():now;let s=_sfLastSlot(now);if(s&&now<s+SF_GRACE_H*36e5)s=_sfLastSlot(s-1);return s;}
/* missed: no count from that slot (a Run now earlier the same day still counts) */
function _sfMissed(now,atMs){const s=_sfDueSlot(now);return !!s&&(!atMs||atMs<s-6*36e5);}

async function sfLoad(){
  try{
    const {data,error}=await sb.from('sf_check_runs').select('*').order('run_at',{ascending:false}).limit(1);
    if(error)throw error;
    SFRUN=(data&&data[0])?sfNorm(data[0]):null;
  }catch(e){SFRUN=null;}            /* table not made yet, or offline — the app works exactly as before */
  window.SFRUN=SFRUN;try{sfStaleBanner();}catch(e){}
  if(SFRUN){
    try{await sfPutBackExcluded();}catch(e){console.warn('[sf] put back',e);}
    try{await sfFixShipDates();}catch(e){console.warn('[sf] ship dates',e);}
    try{if(window.LV3&&LV3.__booted&&LV3.__booted())LV3.sfApplyFromRun(SFRUN);}catch(e){console.warn('[sf] plub',e);}
  }
  try{if(_pageActive('page-admin'))renderAdmin();}catch(e){}
  return SFRUN;
}
function sfNorm(d){
  return{id:d.id,at:d.run_at,from:d.covers_from||'',to:d.covers_to||'',
    shipments:d.shipments||[],late:d.late||[],stock:d.stock||[],sold:d.sold||[],
    excluded:d.excluded||[],summary:d.summary||{}};
}
function sfWhen(){if(!SFRUN)return '';const d=new Date(SFRUN.at);
  return d.toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'short',day:'2-digit',month:'short'})
    +' '+d.toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'});}
function sfStale(){if(!SFRUN)return true;const at=new Date(SFRUN.at).getTime();return _sfMissed(Date.now(),at)||(Date.now()-at)>SF_STALE_DAYS*864e5;}

/* ── what PrepHub has recorded on a shipment, per SKU and per PLUB product ── */
/* an ID saved with its label ("SHIPMENT ID: FBA15M720K7G") is still that shipment */
function _sfSameShip(a,b){if(a===b)return true;try{return _cleanShipId(a).id===_cleanShipId(b).id;}catch(e){return false;}}
function _sfPhOn(shipId,sku){
  let n=0;
  rows.forEach(r=>{if(r.sku!==sku)return;
    (typeof normaliseSegments==='function'?normaliseSegments(r):(r.shipSegments||[]))
      .forEach(s=>{if(_sfSameShip(s.shipId,shipId))n+=parseInt(s.units)||0;});});
  (typeof lavShipments!=='undefined'?lavShipments:[]).forEach(x=>{if(x.shipId===shipId&&x.sku&&x.sku===sku)n+=parseInt(x.units)||0;});
  (typeof returnShipments!=='undefined'?returnShipments:[]).forEach(x=>{if(x.shipId===shipId&&x.sku===sku)n+=parseInt(x.units||x.qty)||0;});
  return n;
}
function _sfPlubAsins(){
  const s=new Set();
  try{const D=window.LV3&&LV3.__D?(typeof LV3.__D==='function'?LV3.__D():LV3.__D):null;
    if(D&&D.products)D.products.forEach(p=>{if(p.asin)s.add(p.asin);});}catch(e){}
  (typeof lavShipments!=='undefined'?lavShipments:[]).forEach(x=>{if(x.asin)s.add(x.asin);});
  return s;
}
function _sfIsReturnSku(sku){
  if(/_Ret/i.test(sku||''))return true;
  return (typeof returnShipments!=='undefined'?returnShipments:[]).some(x=>x.sku===sku);
}
function _sfExcluded(){return (typeof _syncExcluded!=='undefined'?_syncExcluded:[])||[];}

/* ── 1 · the late-order answer for Sarah's card (automatic) ────────────────── */
function sfLateFor(r){
  if(!SFRUN||!r)return null;
  const rid=r.uuid||String(r.id);
  const e=SFRUN.late.find(x=>x.rowId===rid)||SFRUN.late.find(x=>x.sku===r.sku&&(!x.oid||x.oid===r.oid));
  if(!e)return{state:'unchecked'};
  /* Jack, 29 Oct (HIGH5 Zero, Natures Aid): look at the product as a whole on each shipment. If PrepHub already
     has as many of it there as Amazon — under any SKU — nothing on that shipment belongs to this order. */
  const n=x=>parseInt(x)||0;
  const sfOn=id=>(e.own||[]).filter(s=>s.id===id).reduce((t,s)=>t+n(s.units),0)+(e.asinSkus||[]).filter(x=>x.id===id).reduce((t,x)=>t+n(x.units),0);
  const gapOn=id=>r.asin?sfOn(id)-_sfPhOnAsin(id,r.asin):Infinity;
  const own=(e.own||[]).map(s=>{const ph=_sfPhOn(s.id,r.sku);return{...s,ph,x:Math.min(n(s.units)-ph,gapOn(s.id))};}).filter(s=>s.x>0);
  const ownExtra=own.reduce((t,s)=>t+s.x,0);
  const sisters=(e.asinSkus||[]).filter(x=>x.sku&&x.sku!==r.sku);
  const other=sisters.map(z=>{const ph=_sfPhOn(z.id,z.sku);return{...z,ph,x:Math.min(n(z.units)-ph,gapOn(z.id))};}).filter(z=>z.x>0);
  if(ownExtra>0){const room=_sfRoom(r);return{state:'shipped',units:ownExtra,ships:own,at:SFRUN.at,room,fits:ownExtra<=room};}
  if(other.length)return{state:'other',ships:other,at:SFRUN.at};
  return{state:'clear',sisters:sisters.length,at:SFRUN.at};
}
function _sfWrongId(toId,sku,asin,units){
  if(!SFRUN)return null;
  const known=id=>SFRUN.shipments.find(z=>_sfSameShip(z.id,id)&&!/cancel/i.test(z.status||''));
  const hits=[];
  rows.forEach(r=>{if(r.sku!==sku)return;
    (typeof normaliseSegments==='function'?normaliseSegments(r):(r.shipSegments||[])).forEach(g=>{
      if(_sfSameShip(g.shipId,toId))return;
      const A=known(g.shipId);if(!A)return;                                  /* only a shipment SellerFuse has read */
      if((A.lines||[]).some(l=>l.sku===sku||(asin&&l.asin===asin)))return;  /* Amazon has this product there */
      if((parseInt(g.units)||0)===units)hits.push({row:r,fromId:g.shipId});});});
  return hits.length===1?hits[0]:null;
}
async function sfMoveIt(itemId){
  const it=sfPrepIssues().find(x=>x.id===itemId);
  if(!it||it.kind!=='moved'){toast('That one has already been dealt with','ok');return;}
  await moveShipLines([{kind:'oa',row:it.row,from:it.fromId}],it.fromId,it.shipId);
  _sfRepaint();
}
/* what PrepHub has on a shipment for a product, under any of its SKUs */
function _sfPhOnAsin(shipId,asin){
  if(!asin)return 0;let n=0;
  rows.forEach(r=>{if(r.asin!==asin)return;
    (typeof normaliseSegments==='function'?normaliseSegments(r):(r.shipSegments||[])).forEach(s=>{if(_sfSameShip(s.shipId,shipId))n+=parseInt(s.units)||0;});});
  return n;
}
/* which other SKUs of the product PrepHub has on that shipment */
function _sfUnderWhich(shipId,asin,sku){
  const out=new Set();
  rows.forEach(r=>{if(r.asin!==asin||r.sku===sku)return;
    (typeof normaliseSegments==='function'?normaliseSegments(r):(r.shipSegments||[])).forEach(s=>{if(_sfSameShip(s.shipId,shipId)&&(parseInt(s.units)||0)>0)out.add(r.sku);});});
  return [...out];
}
/* what one order can still take: units owed, plus units booked in and not sent yet */
function _sfRoom(r){
  if(!r)return 0;
  const shelf=(parseInt(r.rcvd)>0)?Math.max(0,sendableQty(r)-_sentOut(r)):0;
  return Math.max(0,_owedUnits(r)||0)+shelf;
}
/* Jack, 28 Oct: "we ordered X in the past 60 days and SellerFuse says X of this ASIN was on a shipment —
   leaving an X discrepancy or not". The check carries, per product, every shipment line of the last 60 days;
   PrepHub holds the orders. Compared SHIPMENT BY SHIPMENT, so a shipment the check has not seen yet (sent after
   it ran) never reads as a discrepancy. */
function _sfOrderISO(r){
  const m=String(r&&r.date||'').match(/^(\d{1,2})\/(\d{1,2})/);if(!m)return '';
  const t=(typeof ukDayISO==='function')?ukDayISO():new Date().toISOString().slice(0,10);let y=+t.slice(0,4);
  let iso=`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  if(iso>t)iso=`${y-1}-${iso.slice(5)}`;
  return iso;
}
function sfAsinBalance(r){
  if(!r||!r.asin||!SFRUN)return null;
  const B=(SFRUN.summary||{}).asinBal;if(!B||!B.by)return null;
  const A=String(r.asin).toUpperCase(),since=B.since;
  const lines=B.by[A]||B.by[r.asin]||[];
  const mine=rows.filter(x=>String(x.asin||'').toUpperCase()===A&&_sfOrderISO(x)>=since);
  if(!mine.length)return null;
  const n=x=>parseInt(x)||0;
  const ordered=mine.reduce((t,x)=>t+Math.max(0,n(x.exp)-n(x.cancelledQty)),0);
  const booked=mine.reduce((t,x)=>t+n(x.rcvd),0);
  const sent=mine.reduce((t,x)=>t+((typeof _sentOut==='function')?_sentOut(x):n(x.ship)),0);
  const notIn=mine.map(x=>({x,left:Math.max(0,n(x.exp)-n(x.cancelledQty)-n(x.rcvd))})).filter(o=>o.left>0);
  /* per shipment and SKU: what Amazon was sent beyond what PrepHub recorded on that same shipment */
  const extra=[];let sfSent=0;
  lines.forEach(l=>{const u=n(l.units);sfSent+=u;const ph=_sfPhOn(l.id,l.sku);if(u>ph)extra.push({id:l.id,sku:l.sku,date:l.date,units:u-ph,ph});});
  const unrec=extra.reduce((t,e)=>t+e.units,0);
  return{since,ordered,booked,sent,notIn,orders:mine.length,sfSent,extra,unrec,at:B.at||SFRUN.at};
}
function sfFactHtml(r){
  const v=sfLateFor(r);if(!v)return '';
  if(v.state==='unchecked')return `<span style="color:var(--text3)">not checked yet${SFRUN?' · last check '+esc(sfWhen()):''}</span>`;
  if(v.state==='clear')return `<span style="color:#86efac">✓ not on any shipment${v.sisters?`, not under its ${v.sisters} other SKU${v.sisters===1?'':'s'}`:''}</span> <span style="color:var(--text3)">· Claude, ${esc(sfWhen())}</span>`;
  if(v.state==='shipped')return `<span style="color:#fbbf24"><b>${fmt(v.units)} shipped under this SKU</b> on ${v.ships.map(s=>esc(s.id)).join(', ')} — PrepHub has no record. See SellerFuse check at the top.</span>`;
  return `<span style="color:#fbbf24"><b>Possibly under another SKU:</b> ${v.ships.map(s=>`${esc(s.sku)} sent ${fmt(s.units)} on ${esc(s.id)}, PrepHub has ${fmt(s.ph)}`).join(' · ')}</span>`;
}
/* the wrong-SKU step, answered by the check: nothing on any shipment, nothing extra under a sister SKU */
async function sfCheckedToBecki(rid){
  const r=_rowById(rid);if(!r)return;
  const v=sfLateFor(r);
  if(!v||v.state!=='clear'){toast('The SellerFuse check has not cleared this one — use the check instead','er');return;}
  const now=new Date().toISOString(),n=_skuSiblings?_skuSiblings(r).length:0;
  r.resolution=Object.assign({},r.resolution||{},{skuCheck:{by:'SellerFuse check (Claude)',at:now,run:SFRUN.at,others:n,pressedBy:_who()}});
  const ch=r.resolution.chase;
  if(ch)ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:`SellerFuse checked by Claude ${sfWhen()}: not on any shipment, nothing extra under its ${v.sisters} other SKU${v.sisters===1?'':'s'}`}]);
  try{logAudit('Wrong-SKU check done',`${r.sku||r.asin||''} — SellerFuse check (Claude, ${sfWhen()}): not shipped`);}catch(e){}
  await amzToBecki(rid);
}

/* ── 6 + 7 · sends Amazon has that nobody stamped (Sarah's list) ───────────── */
function _sfCandidate(sku){
  const mine=rows.filter(r=>r.sku===sku);
  if(!mine.length)return null;
  const shelf=r=>(parseInt(r.rcvd)>0)?Math.max(0,sendableQty(r)-_sentOut(r)):0;
  const pick=mine.find(r=>!r.archived&&shelf(r)>0)||mine.find(r=>!r.archived&&_owedUnits(r)>0)
    ||mine.find(r=>!r.archived)||mine.find(r=>shelf(r)>0||_owedUnits(r)>0)||mine[0];
  return pick;
}
function sfPrepIssues(){
  if(!SFRUN)return [];
  const plub=_sfPlubAsins(),ex=new Set(_sfExcluded().map(x=>x.sku)),out=[];
  SFRUN.shipments.forEach(s=>{
    if(/cancel/i.test(s.status||''))return;
    const by={};
    (s.lines||[]).forEach(l=>{if(!l.sku)return;(by[l.sku]=by[l.sku]||{sku:l.sku,asin:l.asin,units:0}).units+=parseInt(l.units)||0;});
    /* the tester, 29 Oct: two SKUs of one product each missing 2, PrepHub 2 short in total — both were "sure"
       and Fix all recorded 6 against Amazon's 4. Add up what every SKU of the product is missing first. */
    const missA={};
    Object.values(by).forEach(l=>{if(!l.asin)return;missA[l.asin]=(missA[l.asin]||0)+Math.max(0,l.units-_sfPhOn(s.id,l.sku));});
    Object.values(by).forEach(l=>{
      if(plub.has(l.asin))return;                 /* PLUB — Becki's list */
      if(_sfIsReturnSku(l.sku))return;            /* returns re-sends — not the prep team (Jack, 23 Oct) */
      if(ex.has(l.sku))return;                    /* removed from the sheet — put back automatically */
      const ph=_sfPhOn(s.id,l.sku),miss=l.units-ph;
      if(miss<=0)return;
      /* the product on this shipment, any SKU: if PrepHub has as many as Amazon, nothing is missing — it was
         recorded against another order of the same product, or under the app's _010 SKU (Amazon never has it) */
      const sfA=(s.lines||[]).filter(x=>x.asin===l.asin).reduce((t,x)=>t+(parseInt(x.units)||0),0);
      const phA=_sfPhOnAsin(s.id,l.asin),gap=l.asin?Math.min(miss,Math.max(0,sfA-phA)):miss;
      const r=_sfCandidate(l.sku);
      const base={shipId:s.id,date:s.created||'',sku:l.sku,asin:l.asin,sf:l.units,ph};
      /* recorded on the wrong shipment ID: exactly these units of this SKU sit on a shipment SellerFuse knows,
         and Amazon has none of this product there — they are here, under the wrong ID (Jack, 29 Oct) */
      if(gap===miss){const w=_sfWrongId(s.id,l.sku,l.asin,miss);
        if(w){out.push(Object.assign(base,{id:'move|'+s.id+'|'+l.sku,kind:'moved',row:w.row,miss,fromId:w.fromId}));return;}}
      if(gap<=0){out.push(Object.assign(base,{id:'match|'+s.id+'|'+l.sku,kind:'matched',row:r||null,miss,under:_sfUnderWhich(s.id,l.asin,l.sku)}));return;}
      if(!r){out.push(Object.assign(base,{id:'send|'+s.id+'|'+l.sku,kind:'noorder',row:null,miss:gap}));return;}
      const late=!(parseInt(r.rcvd)>0)&&_owedUnits(r)>0,room=_sfRoom(r);
      /* Jack, 29 Oct: "if it's not 100%, let Sarah look over them and decide". One press only when the order can
         take exactly what is missing and none of it is already recorded under another SKU of the product. */
      const shared=l.asin&&(missA[l.asin]||0)>Math.max(0,sfA-phA);
      const sure=gap===miss&&gap<=room&&!shared;
      out.push(Object.assign(base,{id:'send|'+s.id+'|'+l.sku,kind:sure?(late?'late':'send'):'look',row:r,miss:gap,room,
        whyLook:sure?'':shared?`${fmt((missA[l.asin]||0)-Math.max(0,sfA-phA))} of the units missing across this product’s SKUs on this shipment are already recorded under another SKU — which order were they?`
          :gap>room?`${fmt(gap)} went to Amazon on this shipment — this order can only take ${fmt(room)}`
          :`${fmt(miss-gap)} of the ${fmt(miss)} ${miss-gap===1?'is':'are'} recorded under another SKU of this product`}));
    });
  });
  return out;
}
async function sfRecord(itemId){
  const it=sfPrepIssues().find(x=>x.id===itemId);
  if(!it||!it.row){toast('That one has already been dealt with','ok');return;}
  if(it.kind!=='late'&&it.kind!=='send'){toast('Not sure enough to fix in one press — it’s on Sarah’s list to look at','er');return;}
  return _sfRecordIt(it);
}
/* Sarah's "doesn't add up" card: book in only what this order is owed — her call, not the app's */
async function sfBookOwed(itemId){
  const it=sfPrepIssues().find(x=>x.id===itemId);
  if(!it||!it.row||!(it.room>0)){toast('Nothing left on this order to book in','er');return;}
  return _sfRecordIt(it,{max:it.room});
}
/* ...and the question only the Amazon account answers */
function sfAskJackLook(itemId){
  const it=sfPrepIssues().find(x=>x.id===itemId);
  if(!it||!it.row){toast('That one has already been dealt with','ok');return;}
  const r=it.row,exp=parseInt(r.exp)||0,extra=Math.max(0,it.miss-(it.room||0));
  askJackAsk(r.uuid||r.id,'free');
  setTimeout(()=>{const box=document.getElementById('askNote');if(!box)return;
    box.value=`SellerFuse: Amazon got ${it.sf} under ${it.sku} on ${it.shipId}${it.date?' ('+_dmy(it.date)+')':''} — PrepHub has ${it.ph} there, and the order is for ${exp}. Was the order ${exp+extra}?`;
    try{askNoteCheck();}catch(e){}},0);
}
/* the same Fix it, from a late card: the check found units this SKU sent on a shipment PrepHub never recorded.
   Never more than the order can take — the rest is a question for Jack, not a booking. */
function sfRecordRow(rid){
  const r=_rowById(rid),v=r&&sfLateFor(r);
  if(!v||v.state!=='shipped'||!(v.ships||[]).length){toast('Nothing for the check to record on this one','er');return;}
  const s=v.ships[0],room=_sfRoom(r),n=Math.min(Math.max(1,s.x||((parseInt(s.units)||0)-(s.ph||0))),room);
  if(!(n>0)){toast('This order has nothing left to book in','er');return;}
  return _sfRecordIt({row:r,shipId:s.id,date:s.date||'',miss:n,more:v.ships.length-1});
}
function _sfSnap(r){return JSON.parse(JSON.stringify(r));}
function _sfRestore(r,snap){Object.keys(r).forEach(k=>{if(!(k in snap))delete r[k];});Object.assign(r,snap);r._dirty=true;}
/* each fix on a row gets a number; only the newest one can be undone (the tester, 29 Oct: undoing the older of two
   fixes brought the newer one's undone state back) */
function _sfBump(r){r.__sfGen=(r.__sfGen||0)+1;return r.__sfGen;}
function _sfRepaint(){try{renderAdmin();}catch(e){}try{renderJack();}catch(e){}try{renderPrep();renderStats();}catch(e){}}
/* books in what isn't booked in, stamps the send with Amazon's date — and never more than the order can take */
async function _sfApply(it,n){
  const r=it.row;
  n=Math.min(n,_sfRoom(r));                       /* what the order can take NOW — an earlier fix may have filled it */
  if(!(n>0))throw new Error('nothing left on this order to take');
  const rcv=parseInt(r.rcvd)||0,shelf=rcv>0?Math.max(0,sendableQty(r)-_sentOut(r)):0,need=Math.max(0,n-shelf);
  if(need>0){r.rcvd=rcv+need;r.rcvdAt=r.rcvdAt||new Date().toISOString();}
  addSegment(r,it.shipId,n,r.shipType||'Standard');
  const seg=(r.shipSegments||[]).find(s=>s.shipId===it.shipId);if(seg&&it.date)seg.date=String(it.date).slice(0,10);
  if(!r.sentDate)r.sentDate=String(it.date||todayISO()).slice(0,10);
  /* Jack, 6 Sep: a row still owed units is Part Sent, whatever went out */
  if(_owedUnits(r)>0){r.status='Part Sent';r.sent='No';}
  else{r.sent='Yes';try{_statusFollowsStock(r);}catch(e){}}
  r.notes=((r.notes||'').trim()?(r.notes.trim()+'\n'):'')+`${_who()} ${_ddUK()}: ${fmt(n)} recorded from the SellerFuse check — on ${it.shipId}, Amazon has them, PrepHub had no record`;
  r._dirty=true;
  await _mustSave(r);
  try{logAudit('Fixed from SellerFuse',`${r.sku||''} — ${fmt(n)} on ${it.shipId}${need?` (${need} booked in)`:''}`);}catch(e){}
}
/* Jack, 17 Aug: one press does it, Undo is the safety net — no "are you sure" */
async function _sfRecordIt(it,opts){
  opts=opts||{};
  const r=it.row,n=Math.min(it.miss,opts.max!=null?opts.max:it.miss);
  if(!r||!(n>0))return;
  const snap=_sfSnap(r);
  try{await _sfApply(it,n);}catch(e){_sfRestore(r,snap);toast(/nothing left/.test(e&&e.message||'')?'This order has nothing left to take — nothing was changed':'Didn’t save — nothing was changed','er');_sfRepaint();return;}
  const g=_sfBump(r);
  _sfRepaint();
  toastUndo(`${fmt(n)} × ${String(r.prod||r.sku).slice(0,40)} recorded on ${it.shipId}`,async()=>{
    if((r.__sfGen||0)!==g){toast('Undo the newer fix on this order first','er');return;}
    _sfRestore(r,snap);
    try{await _mustSave(r);}catch(e){toast('Undo didn’t save','er');return;}
    try{logAudit('Undone — SellerFuse fix',`${r.sku||''} — ${it.shipId}`);}catch(e){}
    _sfRepaint();});
  if(it.more)toast(`${it.more} more shipment${it.more===1?'':'s'} to record — press Fix it again`,'ok');
}
/* every sure one at once, one Undo for all of them */
async function sfFixAll(){
  const ids=sfPrepIssues().filter(i=>i.kind==='late'||i.kind==='send').map(i=>i.id);
  if(!ids.length){toast('Nothing to fix','ok');return;}
  const done=[];
  /* worked out again before each one: after the first fix a second line on the same order may no longer be sure */
  for(const id of ids){const it=sfPrepIssues().find(x=>x.id===id);
    if(!it||(it.kind!=='late'&&it.kind!=='send'))continue;
    const snap=_sfSnap(it.row);
    try{await _sfApply(it,it.miss);_sfBump(it.row);done.push([it.row,snap,it.row.__sfGen]);}catch(e){_sfRestore(it.row,snap);}}
  _sfRepaint();
  if(!done.length){toast('Didn’t save — nothing was changed','er');return;}
  toastUndo(`${fmt(done.length)} fixed from SellerFuse`,async()=>{
    for(const [r,snap,g] of done.slice().reverse()){if((r.__sfGen||0)!==g)continue;_sfRestore(r,snap);try{await _mustSave(r);}catch(e){}}
    try{logAudit('Undone — SellerFuse fix all',`${done.length} rows`);}catch(e){}
    _sfRepaint();});
}
/* Jack, 29 Oct (the Lenovo): Sarah added FBA15MSCMKCT on the 29th, so the send was dated the day she typed it —
   Amazon made the shipment on the 28th. "We should be fixing it automatically, showing what SellerFuse shows."
   Amazon's creation date is a fact: every send on a shipment SellerFuse knows takes that date. */
async function sfFixShipDates(){
  if(!SFRUN||!SF_DATES_TRUSTED)return 0;let n=0;const touched=new Set();
  for(const s of SFRUN.shipments){
    if(/cancel/i.test(s.status||''))continue;
    const d=String(s.created||'').slice(0,10);if(!/^\d{4}-\d\d-\d\d$/.test(d))continue;
    for(const r of rows){
      const segs=(r.shipSegments||[]).filter(g=>_sfSameShip(g.shipId,s.id)&&g.date&&g.date!==d);
      if(!segs.length)continue;
      const was=[...new Set(segs.map(g=>g.date))];
      segs.forEach(g=>{g.date=d;});
      {const ds=(r.shipSegments||[]).map(g=>g.date).filter(Boolean).sort();if(ds.length)r.sentDate=ds[0];}   /* the first send */
      r._dirty=true;touched.add(r);
      try{logAudit('Send date set to Amazon’s',`${r.sku||''} — ${s.id}: ${was.map(_dmy).join(', ')} → ${_dmy(d)} (SellerFuse)`);}catch(e){}
    }
  }
  for(const r of touched){try{await saveRow(r);n++;}catch(e){}}
  if(n){toast(`${fmt(n)} send date${n===1?'':'s'} set to the day Amazon made the shipment`,'ok');try{renderPrep();renderStats();}catch(e){}}
  return n;
}
/* when the next Sun / Tue / Thu 20:00 check runs, in words */
function sfNextCheck(now){now=now==null?Date.now():now;const t=ukDayISO(now);
  for(let k=0;k<8;k++){const d=ukAddDays(t,k),wd=ukWeekdayOf(d);
    if(SF_SLOT_DAYS.includes(wd)&&_sfSlotAt(d)>now)
      return (k===0?'today':k===1?'tomorrow':['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][wd])+' '+_p2(SF_SLOT_HOUR)+':00';}
  return 'Sun '+_p2(SF_SLOT_HOUR)+':00';
}

/* ── 4 · an order removed from the sheet that Amazon shows shipped comes back ─ */
async function sfPutBackExcluded(){
  if(!SFRUN||!(SFRUN.excluded||[]).length)return 0;
  let n=0;
  for(const e of SFRUN.excluded){
    const ships=(e.shipments||[]).filter(s=>(parseInt(s.units)||0)>0);
    if(!ships.length)continue;
    const exIdx=_sfExcluded().findIndex(x=>(x.syncId||'')===e.syncId);
    if(exIdx<0)continue;                                   /* another laptop already did it */
    if(rows.some(r=>(r.sheetSyncId||'')===e.syncId))continue;
    const units=ships.reduce((t,s)=>t+(parseInt(s.units)||0),0);
    const ex=_sfExcluded()[exIdx];
    _syncExcluded.splice(exIdx,1);
    try{await saveSyncExcluded();}catch(err){continue;}
    const r={uuid:(window.crypto&&crypto.randomUUID?crypto.randomUUID():undefined),_minted:true,id:++nid,
      date:(typeof skuDateDDMM==='function'&&skuDateDDMM(e.sku))||'',oid:ex.oid||'',sup:'',acct:'',prod:ex.prod||'',
      asin:ex.asin||'',sku:e.sku,exp:units,rcvd:units,ship:0,cancelledQty:0,status:'In Warehouse',
      issueType:'',issueQty:0,shipSegments:[],allShipIds:[],sent:'No',subSave:'No',notes:'',
      importedFrom:'SellerFuse check',sheetSyncId:e.syncId,resolution:null};
    rows.push(r);
    ships.forEach(s=>{try{addSegment(r,s.id,parseInt(s.units)||0,'Standard');}catch(err){}
      const seg=(r.shipSegments||[]).find(x=>x.shipId===s.id);if(seg&&s.date)seg.date=s.date;});
    r.sent='Yes';r.sentDate=ships[0].date||todayISO();
    try{_statusFollowsStock(r);}catch(err){}
    r.notes=`Put back by the SellerFuse check ${sfWhen()}: it had been removed from the sheet, but Amazon received ${fmt(units)} on ${ships.map(s=>s.id).join(', ')}`;
    r._dirty=true;
    try{await saveRow(r);}catch(err){}
    try{logAudit('Put back on the sheet by the SellerFuse check',`${e.sku} (${e.syncId}) — ${fmt(units)} shipped on ${ships.map(s=>s.id).join(', ')}`);}catch(err){}
    n++;
  }
  if(n){toast(`${fmt(n)} order${n===1?'':'s'} put back on the Prep Sheet — Amazon shows ${n===1?'it':'them'} shipped`,'ok');try{renderPrep();renderStats();}catch(e){}}
  return n;
}

/* ── 8 + 9 · PLUB (Becki's Action centre) ──────────────────────────────────── */
function _sfDupOf(recs,extra){
  for(let i=0;i<recs.length;i++)for(let j=i+1;j<recs.length;j++){
    const a=recs[i],b=recs[j];
    if((a.units||0)===(b.units||0)&&String(a.date||'')===String(b.date||'')&&String(a.sku||'')===String(b.sku||'')&&(b.units||0)===extra)return b;
  }
  return null;
}
function sfPlubIssues(){
  if(!SFRUN)return [];
  const plub=_sfPlubAsins(),out=[];
  const name=a=>{try{const p=LV3.__prodByAsin&&LV3.__prodByAsin(a);return p?p.name:a;}catch(e){return a;}};
  SFRUN.shipments.forEach(s=>{
    if(/cancel/i.test(s.status||''))return;
    const sfBy={};(s.lines||[]).forEach(l=>{if(plub.has(l.asin))sfBy[l.asin]=(sfBy[l.asin]||0)+(parseInt(l.units)||0);});
    const ls=(typeof lavShipments!=='undefined'?lavShipments:[]).filter(x=>x.shipId===s.id);
    const phBy={};ls.forEach(x=>{phBy[x.asin]=(phBy[x.asin]||0)+(parseInt(x.units)||0);});
    new Set([...Object.keys(sfBy),...Object.keys(phBy)]).forEach(a=>{
      if(!plub.has(a))return;
      const sf=sfBy[a]||0,ph=phBy[a]||0;
      if(sf>ph)out.push({id:'plmiss|'+s.id+'|'+a,kind:'missing',shipId:s.id,date:s.created||'',asin:a,name:name(a),sf,ph,miss:sf-ph});
      else if(ph>sf){const copy=_sfDupOf(ls.filter(x=>x.asin===a),ph-sf);
        if(copy)out.push({id:'pldup|'+s.id+'|'+a,kind:'dup',shipId:s.id,date:s.created||'',asin:a,name:name(a),sf,ph,copy});}
    });
  });
  return out;
}

/* ── the two lists ──────────────────────────────────────────────────────────── */
function _sfHead(title,col,why){
  return `<div class="vaHd"><h4 style="color:${col}">${title}</h4><span class="vaWhy">${why}</span></div>`;
}
function _sfLine(chip,col,what,det,nums,btn){
  return `<div class="sfLine"><span class="sfChip" style="color:${col};border-color:${col}66;background:${col}1f">${chip}</span>
    <div class="sfWhat"><b>${what}</b><div class="sfDet">${det}</div></div>
    <div class="sfNums">${nums}</div><div class="sfBtns">${btn}</div></div>`;
}
/* Jack, 29 Oct: on HIS page — the sure ones, one press each or all at once */
function sfAdminHtml(){
  if(!SFRUN)return '';
  const all=sfPrepIssues();
  const sure=all.filter(i=>i.kind==='late'||i.kind==='send'),look=all.filter(i=>i.kind==='look'&&_sfSarahOwns(i.row)),   /* the same list as her page */
        noord=all.filter(i=>i.kind==='noorder'),match=all.filter(i=>i.kind==='matched'),moved=all.filter(i=>i.kind==='moved');
  const lateRows=(typeof _adminItems==='function'?_adminItems():[]).map(i=>_rowById(i.rid)).filter(Boolean);
  const checked=lateRows.filter(r=>{const v=sfLateFor(r);return v&&v.state!=='unchecked';}).length;
  const stale=sfStale();
  const why=stale?`<b style="color:#f87171">Not checked since ${esc(sfWhen())}</b> — is the Mac on with Claude open?`
    :`Checked by Claude ${esc(sfWhen())} · ${fmt(checked)} of Sarah’s orders checked against Amazon`;
  const matchHtml=match.length?`<details class="sfMatch"><summary>${fmt(match.length)} recorded under another SKU of the same product — nothing missing</summary>${match.map(it=>`<div class="sfDet">${esc(String((it.row&&it.row.prod)||it.sku).slice(0,60))} · Amazon has ${fmt(it.sf)} under <b>${esc(it.sku)}</b> on ${esc(it.shipId)}; PrepHub has them under ${esc((it.under||[]).join(', ')||'another SKU')}</div>`).join('')}</details>`:'';
  const lookHtml=look.length?`<div class="sfDet sfLookNote">${fmt(look.length)} more ${look.length===1?'doesn’t':'don’t'} add up for certain — on Sarah’s page for her to look at: ${look.map(it=>esc(String((it.row&&it.row.prod)||it.sku).slice(0,40))).join(' · ')}</div>`:'';
  if(!sure.length&&!noord.length&&!moved.length&&!stale)return `<div class="vaSec sfSec" style="border-left:4px solid #a78bfa">${_sfHead('SellerFuse check','#c4b5fd',why+' · nothing to fix ✓')}${lookHtml}${matchHtml}</div>`;
  const sf=s=>`<a class="sfLink" href="https://app.sellerfuse.com/shipment-manager?search=${encodeURIComponent(s)}" target="_blank" rel="noopener">SellerFuse ↗</a>`;
  const lines=sure.map(it=>{
    const r=it.row,prod=esc(String((r&&r.prod)||it.sku).slice(0,70));
    return _sfLine(it.kind==='late'?'LATE ORDER SHIPPED':'NOT STAMPED',it.kind==='late'?'#fbbf24':'#c4b5fd',
      `${fmt(it.miss)} × ${prod}`,
      `${esc(it.sku)} · went out on ${esc(it.shipId)}${it.date?' ('+_dmy(it.date)+')':''}${r&&r.archived?' · order is filed':''}${it.kind==='late'?' · the order still shows nothing booked in':''}`,
      `Amazon ${fmt(it.sf)} · PrepHub ${fmt(it.ph)}`,
      `<button class="csAct good" onclick="sfRecord('${esc(it.id)}')" title="Books in what isn't booked in and stamps the ${fmt(it.miss)} on ${esc(it.shipId)} with Amazon's date. Undo for 7 seconds.">Fix it</button>${sf(it.shipId)}`);
  }).concat(moved.map(it=>{
    const r=it.row,prod=esc(String((r&&r.prod)||it.sku).slice(0,70));
    return _sfLine('WRONG SHIPMENT ID','#38bdf8',`${fmt(it.miss)} × ${prod}`,
      `${esc(it.sku)} · PrepHub has them on <b>${esc(it.fromId)}</b>, where Amazon has none of this product · Amazon has exactly ${fmt(it.miss)} on ${esc(it.shipId)}${it.date?' ('+_dmy(it.date)+')':''}`,
      `Amazon ${fmt(it.sf)} · PrepHub ${fmt(it.ph)}`,
      `<button class="csAct good" onclick="sfMoveIt('${esc(it.id)}')" title="Moves the ${fmt(it.miss)} from ${esc(it.fromId)} to ${esc(it.shipId)} — numbers and history intact. Undo for 7 seconds.">Move it</button>${sf(it.shipId)}`);
  })).concat(noord.map(it=>_sfLine('NO ORDER','#f87171',`${fmt(it.miss)} sent under ${esc(it.sku)} — no order on the Prep Sheet`,
      `${esc(it.shipId)}${it.date?' · '+_dmy(it.date):''} · Amazon has them; nothing on the sheet matches this SKU`,`Amazon ${fmt(it.sf)} · PrepHub ${fmt(it.ph)}`,sf(it.shipId)))).join('');
  const fixAll=sure.length>1?`<div class="sfFixAll"><button class="csAct good" onclick="sfFixAll()" title="Every line with a Fix it button, in one go — one Undo for all of them">Fix all ${fmt(sure.length)}</button></div>`:'';
  return `<div class="vaSec sfSec" style="border-left:4px solid #a78bfa">${_sfHead('SellerFuse check · '+fmt(sure.length+noord.length+moved.length),'#c4b5fd',why)}${fixAll}${lines}${lookHtml}${matchHtml}</div>`;
}
/* b630: hers to look at only while it is hers — the Canon SELPHY (Amuk_109_06106_154_Jac_02) was still listed
   after it was closed and with Becki. Closed, filed, with Becki or waiting on Jack: not on her list. */
function _sfSarahOwns(r){
  if(!r||r.archived)return false;
  const st=(r.resolution||{}).state;
  if(st==='approved'||st==='asked'||st==='proposed')return false;
  if(typeof _isAmzDel==='function'&&_isAmzDel(r))return false;
  try{const o=typeof _rowOwner==='function'?_rowOwner(r):null;if(o&&(o.owner==='jack'||o.owner==='becki'))return false;}catch(e){}
  return true;
}
/* b630 — what SellerFuse found for one order, on Jack's check card, so Sarah never types "No shipment found in SF"
   into the question. The same facts as her card's steps (sfLateFor, sfAsinBalance). */
function sfJackFacts(r){
  if(!SFRUN||!r)return null;
  const v=sfLateFor(r);if(!v)return null;
  const owed=_owedUnits(r)||0,left=owed>0?owed:((typeof _leftUnits==='function')?_leftUnits(r):0);
  let sku;
  if(v.state==='unchecked')sku=`not checked yet — the next check is ${sfNextCheck()}`;
  else if(v.state==='clear')sku=`not on any shipment under this SKU${v.sisters?`, nothing extra under its ${fmt(v.sisters)} other SKU${v.sisters===1?'':'s'}`:', and no other SKU of it went out'}`;
  else if(v.state==='shipped')sku=`${fmt(v.units)} went out under this SKU on ${v.ships.map(s=>s.id).join(', ')} — PrepHub has no record of ${v.units===1?'it':'them'}`;
  else sku=`possibly under another SKU — ${v.ships.map(s=>`${s.sku} sent ${fmt(s.units)} on ${s.id}, PrepHub has ${fmt(s.ph)}`).join(' · ')}`;
  let bal='';
  const b=left>0&&typeof sfAsinBalance==='function'?sfAsinBalance(r):null;
  if(b){
    const od=_sfOrderISO(r),ex=b.extra.filter(e=>!od||!e.date||e.date>=od),un=ex.reduce((t,e)=>t+e.units,0);
    const others=b.notIn.filter(o=>o.x!==r).length;
    bal=un>0?`Amazon got ${fmt(un)} more of this product than PrepHub recorded since this order (${ex.map(e=>`${fmt(e.units)} × ${e.sku} on ${e.id}`).join(' · ')})`
      :`nothing extra of this product went to Amazon since this order — ${left===1?'it isn’t':'they aren’t'} hidden in another shipment`;
    if(others)bal+=` · ${fmt(others)} other order${others===1?'':'s'} of it ${others===1?'is':'are'} missing too`;
  }
  return{state:v.state,sku,bal,when:sfWhen()};
}
function sfJackText(r){const f=sfJackFacts(r);return f?`SellerFuse: ${f.sku}${f.bal?'; '+f.bal:''} (Claude, ${f.when})`:'';}
function sfJackHtml(r){
  const f=sfJackFacts(r);if(!f)return '';
  const col=f.state==='clear'?'#86efac':f.state==='unchecked'?'var(--text3)':'#fcd34d';
  return `<div class="jkSf"><span class="tcSf" style="margin-left:0">SELLERFUSE</span> <span style="color:${col}">${esc(f.sku)}</span>${f.bal?`<br><span class="jkSfBal">${esc(f.bal)}</span>`:''} <span class="jkSfWho">· checked by Claude ${esc(f.when)}</span></div>`;
}
/* ...and on Sarah's: only the ones that don't add up for certain — she looks and decides */
function sfSarahHtml(){
  if(!SFRUN)return '';
  const look=sfPrepIssues().filter(i=>i.kind==='look'&&_sfSarahOwns(i.row));
  if(!look.length)return '';
  const sf=s=>`<a class="sfLink" href="https://app.sellerfuse.com/shipment-manager?search=${encodeURIComponent(s)}" target="_blank" rel="noopener">SellerFuse ↗</a>`;
  const lines=look.map(it=>{
    const r=it.row,prod=esc(String(r.prod||it.sku).slice(0,70)),amz=typeof _amazonRow==='function'&&_amazonRow(r);
    const exp=parseInt(r.exp)||0,extra=Math.max(0,it.miss-(it.room||0));
    const det=`${esc(it.sku)} · Amazon got ${fmt(it.sf)} on ${esc(it.shipId)}${it.date?' ('+_dmy(it.date)+')':''}, PrepHub has ${fmt(it.ph)} there · this order: ${fmt(exp)} ordered${(parseInt(r.cancelledQty)||0)?', '+fmt(parseInt(r.cancelledQty))+' cancelled':''}, ${fmt(parseInt(r.rcvd)||0)} booked in, ${fmt(_sentOut(r))} sent${/ebay/i.test(String(r.issueType||''))&&(parseInt(r.issueQty)||0)?', '+fmt(parseInt(r.issueQty))+' set aside for eBay':''}`;
    /* the tester, 29 Oct: on a cancelled order or eBay-held units "was the order bigger?" is the wrong question */
    const cx=parseInt(r.cancelledQty)||0,held=/ebay|damag/i.test(String(r.issueType||''))?(parseInt(r.issueQty)||0):0,owed=_owedUnits(r)||0;
    const ask=cx>0?`Ask Jack: ${fmt(cx)} were cancelled — did they still go?`:held>0?`Ask Jack: did the ${fmt(held)} set aside for eBay go to Amazon?`:`Ask Jack: ${fmt(exp)} ordered or ${fmt(exp+extra)}?`;
    const bookLbl=owed>0?`Book in the ${fmt(Math.min(it.room,owed))} this order is owed`+(it.room>owed?` + stamp ${fmt(it.room-owed)} on the shelf`:''):`Stamp the ${fmt(it.room)} on the shelf`;
    const btns=(it.room>0?`<button class="csAct good" onclick="sfBookOwed('${esc(it.id)}')" title="Books in and stamps only what this order can still take. Undo for 7 seconds.">${bookLbl}</button>`:'')
      +(amz?`<button class="csAct go" onclick="sfAskJackLook('${esc(it.id)}')" title="Only the Amazon account shows this — it goes to Jack with the SellerFuse figures written in">${ask}</button>`
          :`<button class="csAct plain" onclick="openSorted('${r.uuid||r.id}')">Close it off&hellip;</button>`)+sf(it.shipId);
    return _sfLine('HAVE A LOOK','#fbbf24',`${prod}`,`${esc(it.whyLook||'')}<br>${det}`,`Amazon ${fmt(it.sf)} · PrepHub ${fmt(it.ph)}`,btns);
  }).join('');
  return `<div class="vaSec sfSec" style="border-left:4px solid #fbbf24">${_sfHead('SellerFuse doesn’t add up · '+fmt(look.length),'#fcd34d','Not certain enough to fix by itself — you look and decide · checked by Claude '+esc(sfWhen()))}${lines}</div>`;
}
function sfPlubHtml(){
  if(!SFRUN)return '';
  const items=sfPlubIssues();
  if(!items.length)return '';
  const lines=items.map(it=>it.kind==='missing'
    ?_sfLine('MISSED SEND','#f87171',`${fmt(it.miss)} × ${esc(it.name)} went to Amazon — not recorded in PLUB`,
      `${esc(it.shipId)}${it.date?' · '+_dmy(it.date):''} · the parts were never taken off, so stock reads high`,
      `Amazon ${fmt(it.sf)} · PLUB ${fmt(it.ph)}`,
      `<button class="btn sm go" onclick="LV3.sfShipPreset('${esc(it.asin)}',${it.miss},'${esc(it.shipId)}')">Record the send</button>`)
    :_sfLine('RECORDED TWICE','#fbbf24',`${esc(it.name)} — the same send is in PLUB twice`,
      `${esc(it.shipId)}${it.date?' · '+_dmy(it.date):''} · Amazon got ${fmt(it.sf)}; PLUB has ${fmt(it.ph)}`,
      `Amazon ${fmt(it.sf)} · PLUB ${fmt(it.ph)}`,
      `<button class="btn sm go" onclick="delLavShipLine('${esc(it.copy.uuid||'')}')">Remove the copy</button>`)).join('');
  return `<div class="panel sfSec" style="border-left:4px solid #22d3ee;margin-bottom:12px">
    <div class="ph"><span class="t" style="color:#67e8f9">SellerFuse says · ${fmt(items.length)}</span>
      <span class="sub">Amazon's shipments don't match PLUB · checked by Claude ${esc(sfWhen())}</span></div>${lines}</div>`;
}

/* ── 5 · shipment IDs: what people paste is "SHIPMENT ID: FBA15M720K7G" ───── */
function _cleanShipId(raw){
  const s=String(raw||'').toUpperCase().replace(/\s+/g,'');
  const m=s.match(/FBA15[A-Z0-9]{7}/);
  if(m)return{id:m[0],ok:true,changed:m[0]!==String(raw||'').trim()};
  return{id:String(raw||'').trim().toUpperCase(),ok:false,changed:false};
}

/* ── 10 · "went out under X": X must have sent more than its own orders ───── */
/* Jack, 29 Oct (G305): an extra unit Amazon got under X on 29 Sep can't be part of an order placed after
   29 Sep — only shipments on or after this order's date count (the late-card check already worked this way). */
function sfSkuSpare(sku,exceptRow){
  if(!sku)return null;
  const since=exceptRow&&typeof _sfOrderISO==='function'?_sfOrderISO(exceptRow):'';
  const mine=rows.filter(r=>r.sku===sku&&r!==exceptRow);
  let ordered=0,sent=0;
  mine.forEach(r=>{ordered+=Math.max(0,(parseInt(r.exp)||0)-(parseInt(r.cancelledQty)||0));sent+=_sentOut(r);});
  let spare=Math.max(0,sent-ordered);
  /* Amazon got more under X than PrepHub recorded — the strongest sign */
  if(SFRUN)SFRUN.shipments.forEach(s=>{if(/cancel/i.test(s.status||''))return;
    if(since&&s.created&&String(s.created).slice(0,10)<since)return;
    const u=(s.lines||[]).filter(l=>l.sku===sku).reduce((t,l)=>t+(parseInt(l.units)||0),0);
    if(u){const ph=_sfPhOn(s.id,sku);if(u>ph)spare+=u-ph;}});
  /* a SKU the app has never seen can't be judged — say nothing rather than block */
  if(!mine.length&&!(SFRUN&&SFRUN.shipments.some(s=>(s.lines||[]).some(l=>l.sku===sku))))return null;
  return spare;
}
window.sfSkuSpare=sfSkuSpare;

/* Jack, 26 Oct: "a banner when the check hasn't landed — on every page". The check only runs when the Mac
   is awake. Jack, 29 Oct: from 22:00 on a check evening Jack sees it while there is time to press Run now
   before bed (Sarah starts 04:00); after that everyone sees which check didn't land. Also any day once the
   last count is over SF_STALE_DAYS old. */
function sfStaleBanner(){
  let el=document.getElementById('sfStaleBar');
  const now=Date.now(),atMs=SFRUN?new Date(SFRUN.at).getTime():0,at=atMs?new Date(atMs):null;
  const missed=_sfMissed(now,atMs);
  const old=!at||(now-atMs)>SF_STALE_DAYS*864e5;
  if(!missed&&!old){if(el)el.remove();return;}
  if(!el){el=document.createElement('div');el.id='sfStaleBar';const tb=document.querySelector('.topbar');if(tb&&tb.parentNode)tb.parentNode.insertBefore(el,tb.nextSibling);else document.body.prepend(el);}
  const s=_sfDueSlot(now),sDay=s?ukDayISO(s):'',tonight=sDay===ukDayISO(now);
  const day=sDay?['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][ukWeekdayOf(sDay)]:'';
  const jack=typeof _isJack==='function'&&_isJack();
  const why=missed
    ?(tonight&&jack?"Tonight's 20:00 SellerFuse check hasn't landed — is the Mac awake with Claude open? Press <b>Run now</b> on the check before bed: Sarah starts at 04:00."
      :`The ${day} 20:00 SellerFuse check didn't land — is the Mac awake with Claude open?`)
    :'No check for over '+SF_STALE_DAYS+' days.';
  el.innerHTML=`<b>SellerFuse figures are from ${at?sfWhen():'— no SellerFuse check yet'}.</b> ${why} Next check ${sfNextCheck(now)}.`;
}
try{setInterval(sfStaleBanner,10*60*1000);}catch(e){}
window.sfStaleBanner=sfStaleBanner;window._sfLastSlot=_sfLastSlot;window._sfMissed=_sfMissed;
window.sfLoad=sfLoad;window.sfPlubHtml=sfPlubHtml;window.sfAdminHtml=sfAdminHtml;window.sfRecordRow=sfRecordRow;window.sfNextCheck=sfNextCheck;window.sfRecord=sfRecord;
window.sfCheckedToBecki=sfCheckedToBecki;window.sfFixAll=sfFixAll;window.sfMoveIt=sfMoveIt;window.sfBookOwed=sfBookOwed;window.sfAskJackLook=sfAskJackLook;window.sfSarahHtml=sfSarahHtml;window.sfFixShipDates=sfFixShipDates;window.sfLateFor=sfLateFor;window.sfFactHtml=sfFactHtml;
window.sfPrepIssues=sfPrepIssues;window.sfPlubIssues=sfPlubIssues;window._cleanShipId=_cleanShipId;
window.sfJackHtml=sfJackHtml;window.sfJackText=sfJackText;window._sfSarahOwns=_sfSarahOwns;
