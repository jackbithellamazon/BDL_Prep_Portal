/* BDL PrepHub — js/sfcheck.js — the SellerFuse check (Jack, 23 Oct 2026: "go").
   Claude runs on Jack's Mac Mon + Thu 07:00 (Jack, 23 Oct: twice a week), reads SellerFuse and writes what
   it saw into sf_check_runs — one row per run. The run only CARRIES data; this
   file decides what it means, so the rules can be checked like everything else.
   PREP ONLY: Amazon receiving claims, costs and write-offs belong to the
   reimbursement system, not here.
   Automatic: the late-order answer on Sarah's cards, PLUB stock at Amazon and
   sold-in-30-days (lavarion.js sfApplyFromRun), and an order removed from the
   sheet that Amazon shows shipped comes back. Everything else is listed with a
   button — a person presses it. */
let SFRUN=null;
const SF_STALE_DAYS=5;   /* Thu → Mon is 4 days */

async function sfLoad(){
  try{
    const {data,error}=await sb.from('sf_check_runs').select('*').order('run_at',{ascending:false}).limit(1);
    if(error)throw error;
    SFRUN=(data&&data[0])?sfNorm(data[0]):null;
  }catch(e){SFRUN=null;}            /* table not made yet, or offline — the app works exactly as before */
  window.SFRUN=SFRUN;try{sfStaleBanner();}catch(e){}
  if(SFRUN){
    try{await sfPutBackExcluded();}catch(e){console.warn('[sf] put back',e);}
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
function sfStale(){return !SFRUN||(Date.now()-new Date(SFRUN.at).getTime())>SF_STALE_DAYS*864e5;}

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
  const own=(e.own||[]).map(s=>({...s,ph:_sfPhOn(s.id,r.sku)})).filter(s=>(parseInt(s.units)||0)>s.ph);
  const ownExtra=own.reduce((t,s)=>t+((parseInt(s.units)||0)-s.ph),0);
  const sisters=(e.asinSkus||[]).filter(x=>x.sku&&x.sku!==r.sku);
  const other=sisters.map(x=>({...x,ph:_sfPhOn(x.id,x.sku)})).filter(x=>(parseInt(x.units)||0)>x.ph);
  if(ownExtra>0)return{state:'shipped',units:ownExtra,ships:own,at:SFRUN.at};
  if(other.length)return{state:'other',ships:other,at:SFRUN.at};
  return{state:'clear',sisters:sisters.length,at:SFRUN.at};
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
    Object.values(by).forEach(l=>{
      if(plub.has(l.asin))return;                 /* PLUB — Becki's list */
      if(_sfIsReturnSku(l.sku))return;            /* returns re-sends — not the prep team (Jack, 23 Oct) */
      if(ex.has(l.sku))return;                    /* removed from the sheet — put back automatically */
      const ph=_sfPhOn(s.id,l.sku),miss=l.units-ph;
      if(miss<=0)return;
      const r=_sfCandidate(l.sku);
      const late=!!r&&!(parseInt(r.rcvd)>0)&&_owedUnits(r)>0;
      out.push({id:'send|'+s.id+'|'+l.sku,kind:r?(late?'late':'send'):'noorder',shipId:s.id,date:s.created||'',
        sku:l.sku,asin:l.asin,sf:l.units,ph,miss,row:r||null});
    });
  });
  return out;
}
async function sfRecord(itemId){
  const it=sfPrepIssues().find(x=>x.id===itemId);
  if(!it||!it.row){toast('That one has already been dealt with','ok');return;}
  _sfRecordIt(it);
}
/* the same "Record it", from a triage card: the check found units this SKU sent on a
   shipment PrepHub never recorded (it can be older than the run's window, so it comes
   from the row's own check rather than the window list) */
function sfRecordRow(rid){
  const r=_rowById(rid),v=r&&sfLateFor(r);
  if(!v||v.state!=='shipped'||!(v.ships||[]).length){toast('Nothing for the check to record on this one','er');return;}
  const s=v.ships[0];
  _sfRecordIt({row:r,shipId:s.id,date:s.date||'',miss:Math.max(1,(parseInt(s.units)||0)-(s.ph||0)),
    more:v.ships.length-1});
}
function _sfRecordIt(it){
  const r=it.row,n=it.miss;
  showConfirm('Record it?',
    `<b>${fmt(n)} × ${String(r.prod||r.sku).slice(0,60)}</b> went to Amazon on <b>${it.shipId}</b>${it.date?' ('+_dmy(it.date)+')':''}. SellerFuse shows it; PrepHub had no record.<br><br>`
    +`This books in what isn't booked in yet, stamps the send on the order and writes it into its history.${r.archived?' The order is filed, and it stays filed, with the numbers corrected.':''}`,
    async()=>{
      const rcv=parseInt(r.rcvd)||0,shelf=rcv>0?Math.max(0,sendableQty(r)-_sentOut(r)):0,need=Math.max(0,n-shelf);
      if(need>0){r.rcvd=rcv+need;r.rcvdAt=r.rcvdAt||new Date().toISOString();}
      try{addSegment(r,it.shipId,n,r.shipType||'Standard');}catch(e){toast('Could not record it: '+(e&&e.message||e),'er');return;}
      /* SellerFuse knows when the shipment really went */
      const seg=(r.shipSegments||[]).find(s=>s.shipId===it.shipId);if(seg&&it.date)seg.date=it.date;
      r.sent='Yes';if(!r.sentDate)r.sentDate=it.date||todayISO();
      try{_statusFollowsStock(r);}catch(e){}
      const dd=_ddUK();
      r.notes=((r.notes||'').trim()?(r.notes.trim()+'\n'):'')+`${_who()} ${dd}: ${fmt(n)} recorded from the SellerFuse check — on ${it.shipId}, Amazon has them, PrepHub had no record`;
      r._dirty=true;
      try{await _mustSave(r);}catch(e){toast('Didn’t save — nothing was recorded','er');return;}
      try{logAudit('Recorded from SellerFuse',`${r.sku||''} — ${fmt(n)} on ${it.shipId}${need?` (${need} booked in)`:''}`);}catch(e){}
      toast(`${fmt(n)} recorded on ${it.shipId}`,'ok');
      try{renderAdmin();renderPrep();renderStats();}catch(e){}
      if(it.more)toast(`${it.more} more shipment${it.more===1?'':'s'} to record — press Record it again`,'ok');
    },{ok:'Record it',icon:'📦'});
}
/* when the next Mon / Thu 07:00 check runs, in words */
function sfNextCheck(){
  const d=new Date();const u=_ukParts(d);
  for(let k=0;k<8;k++){const t=new Date(d.getTime()+k*864e5),p=_ukParts(t);
    if([1,4].includes(p.wd)&&(k>0||u.h<7))
      return (k===0?'today':k===1?'tomorrow':['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][p.wd])+' 07:00';}
  return 'Mon 07:00';
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
function sfAdminHtml(){
  if(!SFRUN)return '';
  const items=sfPrepIssues();
  const lateRows=(typeof _adminItems==='function'?_adminItems():[]).map(i=>_rowById(i.rid)).filter(Boolean);
  const checked=lateRows.filter(r=>{const v=sfLateFor(r);return v&&v.state!=='unchecked';}).length;
  const stale=sfStale();
  const why=stale?`<b style="color:#f87171">Not checked since ${esc(sfWhen())}</b> — is Jack's Mac on with Claude open?`
    :`Checked by Claude ${esc(sfWhen())} · ${fmt(checked)} of your orders checked against Amazon`;
  if(!items.length&&!stale)return `<div class="vaSec sfSec" style="border-left:4px solid #a78bfa">${_sfHead('SellerFuse check','#c4b5fd',why+' · nothing Amazon has that the Prep Sheet doesn’t ✓')}</div>`;
  const sf=s=>`<a class="sfLink" href="https://app.sellerfuse.com/shipment-manager?search=${encodeURIComponent(s)}" target="_blank" rel="noopener">SellerFuse ↗</a>`;
  const lines=items.map(it=>{
    const r=it.row,prod=esc(String((r&&r.prod)||it.sku).slice(0,70));
    if(it.kind==='noorder')return _sfLine('NO ORDER','#f87171',`${fmt(it.miss)} sent under ${esc(it.sku)} — no order on the Prep Sheet`,
      `${esc(it.shipId)}${it.date?' · '+_dmy(it.date):''} · Amazon has them; nothing on the sheet matches this SKU`,`Amazon ${fmt(it.sf)} · PrepHub ${fmt(it.ph)}`,sf(it.shipId));
    return _sfLine(it.kind==='late'?'LATE ORDER SHIPPED':'NOT STAMPED',it.kind==='late'?'#fbbf24':'#c4b5fd',
      `${fmt(it.miss)} × ${prod}`,
      `${esc(it.sku)} · went out on ${esc(it.shipId)}${it.date?' ('+_dmy(it.date)+')':''}${r&&r.archived?' · order is filed':''}${it.kind==='late'?' · the order still shows nothing booked in':''}`,
      `Amazon ${fmt(it.sf)} · PrepHub ${fmt(it.ph)}`,
      `<button class="csAct good" onclick="sfRecord('${esc(it.id)}')">Record it</button>${sf(it.shipId)}`);
  }).join('');
  return `<div class="vaSec sfSec" style="border-left:4px solid #a78bfa">${_sfHead('SellerFuse check · '+fmt(items.length),'#c4b5fd',why)}${lines}</div>`;
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
function sfSkuSpare(sku,exceptRow){
  if(!sku)return null;
  const mine=rows.filter(r=>r.sku===sku&&r!==exceptRow);
  let ordered=0,sent=0;
  mine.forEach(r=>{ordered+=Math.max(0,(parseInt(r.exp)||0)-(parseInt(r.cancelledQty)||0));sent+=_sentOut(r);});
  let spare=Math.max(0,sent-ordered);
  /* Amazon got more under X than PrepHub recorded — the strongest sign */
  if(SFRUN)SFRUN.shipments.forEach(s=>{if(/cancel/i.test(s.status||''))return;
    const u=(s.lines||[]).filter(l=>l.sku===sku).reduce((t,l)=>t+(parseInt(l.units)||0),0);
    if(u){const ph=_sfPhOn(s.id,sku);if(u>ph)spare+=u-ph;}});
  /* a SKU the app has never seen can't be judged — say nothing rather than block */
  if(!mine.length&&!(SFRUN&&SFRUN.shipments.some(s=>(s.lines||[]).some(l=>l.sku===sku))))return null;
  return spare;
}
window.sfSkuSpare=sfSkuSpare;

/* Jack, 26 Oct: "a banner when the 07:00 check hasn't landed — on every page". The check only
   runs when the Mac is awake; from 10:00 UK on a Monday or Thursday with no count from today,
   or any day once the last count is over 5 days old, a strip under the top bar says so. */
function sfStaleBanner(){
  let el=document.getElementById('sfStaleBar');
  const uk=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/London'}));
  const wd=uk.getDay(),hr=uk.getHours(),today=uk.toISOString().slice(0,10);
  const at=SFRUN?new Date(SFRUN.at):null;
  const atDay=at?new Date(at.toLocaleString('en-US',{timeZone:'Europe/London'})).toISOString().slice(0,10):'';
  const missed=(wd===1||wd===4)&&hr>=10&&atDay!==today;
  const old=!at||(Date.now()-at.getTime())>SF_STALE_DAYS*864e5;
  if(!missed&&!old){if(el)el.remove();return;}
  if(!el){el=document.createElement('div');el.id='sfStaleBar';const tb=document.querySelector('.topbar');if(tb&&tb.parentNode)tb.parentNode.insertBefore(el,tb.nextSibling);else document.body.prepend(el);}
  el.innerHTML=`<b>Stock count is from ${at?sfWhen():'— no SellerFuse check yet'}.</b> ${missed?"This morning's 07:00 SellerFuse check hasn't run — is the Mac awake?":'No check for over '+SF_STALE_DAYS+' days.'} Next check ${sfNextCheck()}.`;
}
try{setInterval(sfStaleBanner,10*60*1000);}catch(e){}
window.sfStaleBanner=sfStaleBanner;
window.sfLoad=sfLoad;window.sfPlubHtml=sfPlubHtml;window.sfAdminHtml=sfAdminHtml;window.sfRecordRow=sfRecordRow;window.sfNextCheck=sfNextCheck;window.sfRecord=sfRecord;
window.sfCheckedToBecki=sfCheckedToBecki;window.sfLateFor=sfLateFor;window.sfFactHtml=sfFactHtml;
window.sfPrepIssues=sfPrepIssues;window.sfPlubIssues=sfPlubIssues;window._cleanShipId=_cleanShipId;
