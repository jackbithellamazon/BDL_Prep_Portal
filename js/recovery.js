/* BDL PrepHub — js/recovery.js — Recovery Stock.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
/* ═══════════════════════════════════════════════════════════════════════════
   RECOVERY STOCK — stock Bithell Distribution still owns but is NOT sending back
   to Amazon: eBay, Vinted, Facebook, clearance/liquidator, disposal, donation.
   Spec: ~/Downloads/BDL-Recovery-Stock-Developer-Spec.md (Jack, 2 Sep 2026).

   Four questions the page must answer in seconds:
     what have we got · where is it · have we listed/sent it · how long has it sat.

   Decisions from Jack's answers (2 Sep):
     · locations OPTIONAL in phase 1 — no racking exists yet; "no rack yet" is a
       quiet chip, not a warning, until the first real location is used
     · one physical product = ONE row, locations are chips on it (split qty)
     · Sold on a marketplace → "To pack — Becki" → "Packed & sent" → gone.
       Becki packs; Jack lists. A row never vanishes the moment it sells.
     · clearance: items leave active stock when the BATCH is marked Sent
     · duplicates are EXPECTED (the same product comes back) — soft warning,
       one click to add anyway
     · eBay comebacks are simply re-added; no special un-sell flow
     · cost auto-fills from a PrepHub SKU (SKU encodes COG); never a sale price
     · hard delete = Jack only, typed confirmation, audit line
   ═══════════════════════════════════════════════════════════════════════════ */
let REC=[],REC_BATCH=[],_recLoaded=false,_recErr='',_recTab='all',_recQ='',_recSel=new Set();
let _recSort='sitting',_recF={loc:'',cond:''},_recOpen=null,_recEvCache={},_recShowRemoved=false;
/* Jack, 5 Sep: "just a stocktake of what we currently have" — three states.
   Legacy statuses (sorting / ready / topack) read as 'here'. */
const REC_WORK_ORDER={here:0,listed:1,gone:2,archived:3};
const REC_STATUS={here:['Sitting here','#fbbf24'],listed:['Listed','#60a5fa'],gone:['Gone','#94a3b8'],archived:['Removed','#64748b']};
const REC_GONE_HOW={sold:'Sold',cleared:'Cleared — given away / binned / bulk',amazon:'Back to Amazon'};
const recStatusOf=st=>(st==='sorting'||st==='ready'||st==='topack'||!st)?'here':(st==='archived'?'gone':st);
const REC_COND=['New','Good','Used — damaged','Used — OOD','Used — bad'];
function recCondMatch(t){t=String(t||'').trim().toLowerCase();if(!t)return '';const x=REC_COND.find(c=>c.toLowerCase()===t);if(x)return x;if(/ood/.test(t))return 'Used — OOD';if(/dam|dent|scratch|crack/.test(t))return 'Used — damaged';if(/bad|fault|broke|poor|parts|incomplete/.test(t))return 'Used — bad';if(/new|sealed|unopened/.test(t))return 'New';if(/good|like|open|fine|ok/.test(t))return 'Good';return '';}
const REC_CHANNELS=['eBay','Vinted','Facebook Marketplace','Other Marketplace','Other'];
const REC_IDTYPES=['ASIN','EAN','UPC','Internal SKU','eBay SKU','Other','None'];
const REC_MARKETPLACES=['eBay','Vinted','Facebook Marketplace','Other Marketplace'];   // sold here → Becki packs

/* ── tiny helpers ──────────────────────────────────────────────────────────── */
const recDays=iso=>{if(!iso)return 0;const d=new Date(iso);return isNaN(d)?0:Math.max(0,Math.floor((Date.now()-d.getTime())/864e5));};
/* Jack, 3 Sep: on eBay 30-45 days is NORMAL and healthy, and he would not drop
   a price before 90 days. The old 30+ = red painted every healthy listing red
   within a month, which is how a warning turns into wallpaper. Two clocks:
   a LISTED item is judged on how long the listing has been up, an UNLISTED one
   on how long it has sat here doing nothing — that is dead money from day one,
   so it goes amber far sooner. */
const recListedOn=i=>{if(i.listed_at)return i.listed_at;const d=recChs(i).map(c=>c.date).filter(Boolean).sort();return d[0]||null;};
const recClock=i=>{const on=(i.status==='listed')?recListedOn(i):null;
  return on?{days:recDays(on),listed:true}:{days:recDays(i.created_at),listed:false};};
const recAgeCol=(d,listed)=>listed?(d>=TM.recListedRed?'#f87171':d>=TM.recListedAmber?'#fbbf24':'var(--text2)')
                                  :(d>=TM.recUnlistedRed?'#f87171':d>=TM.recUnlistedAmber?'#fbbf24':'var(--text2)');
/* "Get the money back" — a listing nobody has bought in 90 days, or anything
   still not listed after a month. */
const recNeedsClearing=i=>{if(!recActive(i))return false;const c=recClock(i);
  return c.listed?c.days>=TM.recListedRed:c.days>=TM.recUnlistedRed;};
const recActive=i=>i.status!=='gone'&&i.status!=='archived'&&!i.archived;
/* Removed = pressed Remove after it was Gone, or Gone and untouched for 30 days
   (the automatic tidy). Kept in the record; "Show removed" brings them back. */
const recRemoved=i=>!!i.archived||i.status==='archived'||(i.status==='gone'&&!!i.gone_at&&recDays(i.gone_at)>30);
const recGoneHow=i=>{const m=/^gone:(\w+)/.exec(i.last_action||'');return (i.gone_how||(m&&m[1])||'');};
const recQty=i=>Math.max(0,parseInt(i.qty)||0);
const recPackQty=i=>(i.pack||[]).reduce((t,p)=>t+(parseInt(p.qty)||0),0);
const recLocs=i=>(Array.isArray(i.locations)?i.locations:[]).filter(l=>l&&l.loc);
const recLocStr=i=>recLocs(i).map(l=>l.loc+(recLocs(i).length>1?' ×'+l.qty:'')).join(', ')||'';
const recChs=i=>(Array.isArray(i.channels)?i.channels:[]).filter(c=>c&&c.ch);
const recUid=()=>(window.crypto&&crypto.randomUUID)?crypto.randomUUID():('rec_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8));
const recNow=()=>new Date().toISOString();
const recWhen=iso=>{const d=new Date(iso);return isNaN(d)?'—':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});};
const recDay=iso=>{const d=new Date(iso);return isNaN(d)?'—':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});};
function recNormLoc(s){return String(s||'').trim().toUpperCase().replace(/\s+/g,'');}
/* PrepHub SKUs encode cost: Amuk_108.04_… → £108.04. Free cost, no typing. */
function recCostFromSku(sku){
  try{const p=parseSKU(String(sku||''));if(p&&p.cogs>0)return +p.cogs;}catch(e){}
  const m=String(sku||'').match(/^[A-Za-z]+_(\d+(?:\.\d+)?)_/);return m?+m[1]:null;
}
/* what kind of identifier is this? Nobody should have to pick from a dropdown. */
function recDetectIdType(v){
  v=String(v||'').trim();
  if(!v)return 'None';
  if(/^B0[A-Z0-9]{8}$/i.test(v))return 'ASIN';
  if(/^\d{13}$/.test(v))return 'EAN';
  if(/^\d{12}$/.test(v))return 'UPC';
  if(/^[A-Za-z]{2,6}_\d/.test(v))return 'Amazon SKU';
  return 'Internal SKU';
}
/* an Amazon return carries its PrepHub SKU — that one string knows the product
   name, the ASIN and the cost. Look it up on the Prep Sheet rows. */
function recPrepRowBySku(sku){
  const k=String(sku||'').trim().toLowerCase();if(!k||typeof rows==='undefined')return null;
  return rows.find(r=>String(r.sku||'').toLowerCase()===k)||null;
}
/* any location ever used → phase 2 has started → missing location becomes a warning */
/* the ⚠ no-rack warning waits until racking is clearly in use — the first
   racked line on day one must not turn every other line amber */
function recRackingLive(){return REC.filter(i=>recActive(i)&&recLocs(i).length).length>=5;}

/* ── data ──────────────────────────────────────────────────────────────────── */
function recRowFromDb(d){
  return {id:d.id,name:d.name||'',id_type:d.id_type||'None',id_value:d.id_value||'',amz_sku:d.amz_sku||'',extra_ids:d.extra_ids||[],
    qty:d.qty||0,locations:d.locations||[],condition:d.condition||'New',condition_notes:d.condition_notes||'',
    cost:d.cost==null?null:+d.cost,status:recStatusOf(d.status),gone_how:d.gone_how||'',gone_qty:parseInt(d.gone_qty)||0,channels:d.channels||[],notes:d.notes||'',
    batch_id:d.batch_id||'',pack:d.pack||[],added_by:d.added_by||'',created_at:d.created_at,last_action_at:d.last_action_at||d.created_at,
    last_action:d.last_action||'',archived:!!d.archived||d.status==='archived',gone_at:d.gone_at||null,
    listed_at:d.listed_at||null,sold_price:d.sold_price==null?null:+d.sold_price,
    source:d.source||'',source_ref:d.source_ref||'',rack:d.rack||''};
}
function recRowToDb(i){
  return {id:i.id,name:i.name,id_type:i.id_type,id_value:i.id_value,amz_sku:i.amz_sku||'',extra_ids:i.extra_ids||[],qty:recQty(i),locations:recLocs(i),
    condition:i.condition,condition_notes:i.condition_notes||'',cost:i.cost==null||i.cost===''?null:+i.cost,status:i.status,
    channels:recChs(i),notes:i.notes||'',batch_id:i.batch_id||null,pack:i.pack||[],added_by:i.added_by||'',
    created_at:i.created_at,last_action_at:i.last_action_at,last_action:i.last_action||'',archived:!!i.archived,gone_at:i.gone_at||null,
    listed_at:i.listed_at||null,sold_price:i.sold_price==null||i.sold_price===''?null:+i.sold_price,
    gone_how:i.gone_how||'',gone_qty:parseInt(i.gone_qty)||0,
    source:i.source||'',source_ref:i.source_ref||'',rack:i.rack||''};
}
async function recLoad(){
  /* Jack, 5 Sep: "it just takes 3 seconds to load, why." Two queries one after
     the other, each a slow 404 while the tables do not exist yet. Both go at
     once, and the page is pre-loaded at login so opening it is instant. */
  try{
    const [a,b]=await Promise.all([
      sb.from('recovery_items').select('*').order('created_at',{ascending:false}),
      sb.from('recovery_batches').select('*').order('created_at',{ascending:false})]);
    if(a.error)throw a.error;
    REC=(a.data||[]).map(recRowFromDb);
    REC_BATCH=b.error?[]:(b.data||[]);
    _recErr='';_recLoaded=true;
  }catch(e){
    const msg=String((e&&e.message)||e||'');
    _recErr=/does not exist|42P01|relation|schema cache|Could not find the table/i.test(msg)?'setup':msg;
    _recLoaded=true;
    console.warn('[recovery] load',msg);
  }
}
/* every mutation goes through here: stamp, persist, audit, event. Saves that
   fail (offline / test mode) keep the change on screen and say so once. */
async function recSave(i,action,detail,prev,next){
  i.last_action_at=recNow();i.last_action=action;
  const row=recRowToDb(i);
  let ok=true;
  try{const r=await sb.from('recovery_items').upsert(row,{onConflict:'id'});if(r.error)throw r.error;}
  catch(e){ok=false;console.warn('[recovery] save',e);toast('Not saved to the cloud — '+String((e&&e.message)||e).slice(0,60),'er');}
  const ev={id:recUid(),item_id:i.id,at:i.last_action_at,who:_who(),action,prev:prev==null?null:String(prev),next:next==null?null:String(next),note:detail||''};
  (_recEvCache[i.id]=_recEvCache[i.id]||[]).unshift(ev);
  try{await sb.from('recovery_events').insert(ev);}catch(e){}
  try{logAudit('Recovery: '+action,(i.name||i.id_value||'item')+(detail?' — '+detail:''));}catch(e){}
  return ok;
}
async function recEvents(id){
  if(_recEvCache[id]&&_recEvCache[id]._full)return _recEvCache[id];
  try{const r=await sb.from('recovery_events').select('*').eq('item_id',id).order('at',{ascending:false}).limit(200);
    if(!r.error){const list=r.data||[];list._full=true;_recEvCache[id]=list;return list;}}catch(e){}
  return _recEvCache[id]||[];
}
function recNextBatchId(){
  const n=REC_BATCH.map(b=>parseInt(String(b.id||'').replace(/\D/g,''))||0).reduce((m,x)=>Math.max(m,x),0)+1;
  return 'CLR-'+String(n).padStart(3,'0');
}

/* ── derived views ─────────────────────────────────────────────────────────── */
function recFiltered(){
  const q=_recQ.trim().toLowerCase();
  let list=REC.slice();
  const tab=_recTab;
  list=list.filter(i=>{
    if(recRemoved(i)&&!_recShowRemoved)return false;
    if(tab==='all')return recActive(i);
    if(tab==='here')return recActive(i)&&i.status==='here';
    if(tab==='listed')return recActive(i)&&i.status==='listed';
    if(tab==='stale')return recNeedsClearing(i);
    if(tab==='gone')return !recActive(i);
    return true;});
  if(q)list=list.filter(i=>[i.name,i.id_value,i.id_type,i.amz_sku,i.notes,i.condition_notes,recLocStr(i),i.source,i.source_ref,
    ...recChs(i).map(c=>c.ch+' '+(c.ref||'')+' '+(c.url||'')),...(i.extra_ids||[]).map(x=>x.value||x)]
    .join(' ').toLowerCase().includes(q));
  if(_recF.loc)list=list.filter(i=>_recF.loc==='__none'?!recLocs(i).length:recLocs(i).some(l=>l.loc===_recF.loc));
  if(_recF.cond)list=list.filter(i=>i.condition===_recF.cond);
  const s=_recSort;
  list.sort((a,b)=>{
    switch(s){
      case 'sitting':{const w=(REC_WORK_ORDER[a.status]??9)-(REC_WORK_ORDER[b.status]??9);if(w)return w;
        return recClock(b).days-recClock(a).days;}
      case 'money':return (recQty(b)*(b.cost||0))-(recQty(a)*(a.cost||0));
      case 'name':return String(a.name).localeCompare(String(b.name));
      case 'loc':return recLocStr(a).localeCompare(recLocStr(b))||String(a.name).localeCompare(String(b.name));
      case 'newest':return String(b.created_at).localeCompare(String(a.created_at));
      default:return String(b.created_at).localeCompare(String(a.created_at));
    }});
  return list;
}
function recKpis(){
  const act=REC.filter(recActive);
  const cash=a=>a.reduce((t,i)=>t+recQty(i)*(i.cost||0),0);
  const units=act.reduce((t,i)=>t+recQty(i),0);
  const here=act.filter(i=>i.status==='here'),listed=act.filter(i=>i.status==='listed');
  const stale=act.filter(recNeedsClearing);
  const m0=new Date();m0.setDate(1);m0.setHours(0,0,0,0);
  const goneMonth=REC.filter(i=>i.status==='gone'&&i.gone_at&&new Date(i.gone_at)>=m0);
  return {units,items:act.length,value:cash(act),
    notListed:here.reduce((t,i)=>t+recQty(i),0),idleCash:cash(here),hereOld:here.filter(i=>recClock(i).days>=TM.recUnlistedAmber).length,
    listed:listed.reduce((t,i)=>t+recQty(i),0),listedOld:listed.filter(i=>recClock(i).days>=TM.recListedRed).length,
    stale:stale.length,staleCash:cash(stale),
    goneMonth:goneMonth.reduce((t,i)=>t+(parseInt(i.gone_qty)||recQty(i)||0),0),goneMonthN:goneMonth.length};
}
function recLocCounts(){
  const m={};let none=0;
  REC.filter(recActive).forEach(i=>{const ls=recLocs(i);if(!ls.length){none+=recQty(i);return;}ls.forEach(l=>{m[l.loc]=(m[l.loc]||0)+(parseInt(l.qty)||0);});});
  return {m,none};
}

/* ── render ────────────────────────────────────────────────────────────────── */
function renderRecovery(){
  const w=document.getElementById('recWrap');if(!w)return;
  if(document.hidden||!_pageActive('page-recovery'))return;
  if(!_recLoaded){recLoad().then(()=>renderRecovery());return;}
  const k=recKpis();
  const counts={all:REC.filter(recActive).length,here:REC.filter(i=>recActive(i)&&i.status==='here').length,
    listed:REC.filter(i=>recActive(i)&&i.status==='listed').length,stale:k.stale,
    gone:REC.filter(i=>!recActive(i)&&(_recShowRemoved||!recRemoved(i))).length};
  const list=recFiltered();
  const lc=recLocCounts();
  const rackLive=recRackingLive();
  const kpi=(key,label,val,sub,col,tab)=>`<div class="recKpi ${_recTab===tab?'on':''}" style="--kc:${col}" onclick="_recTab='${tab}';_recSel.clear();renderRecovery();" title="Click to filter">
      <div class="l">${label}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`;
  const tabBtn=(key,label)=>`<button class="recTab ${_recTab===key?'on':''}" onclick="_recTab='${key}';_recSel.clear();renderRecovery();">${label} <b>${fmt(counts[key]||0)}</b></button>`;
  const opt=(v,l,cur)=>`<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(l)}</option>`;
  const locOpts=Object.keys(lc.m).sort().map(l=>opt(l,l+' · '+fmt(lc.m[l])+' units',_recF.loc)).join('')+(lc.none?opt('__none','No rack yet · '+fmt(lc.none)+' units',_recF.loc):'');
  const selUnits=[...list.filter(i=>_recSel.has(i.id))].reduce((t,i)=>t+recQty(i),0);

  const setup=_recErr==='setup'?`<div class="recSetup"><b>One-time setup needed.</b> The Recovery Stock tables are not in the database yet. Run
      <code>BDL-Recovery-Stock-run-in-supabase.sql</code> (in your Downloads) once in the Supabase SQL editor, then reload. Until then nothing on this page saves. Nothing else in the app is affected.</div>`
    :_recErr?`<div class="recSetup"><b>Could not load Recovery Stock:</b> ${esc(_recErr)}</div>`:'';

  const rowHtml=i=>{
    const st=REC_STATUS[i.status]||REC_STATUS.here;
    const clk=recClock(i),age=clk.days;
    const locs=recLocs(i);
    const gone=!recActive(i),removed=recRemoved(i);
    const locHtml=locs.length?locs.map(l=>`<span class="recLoc" title="${fmt(l.qty)} units here">${esc(l.loc)}${locs.length>1?' <span style="opacity:.7">×'+fmt(l.qty)+'</span>':''}</span>`).join('')
      :(rackLive?`<span class="recLoc none" title="No location — assign one">⚠ no rack</span>`:`<span class="recDash" title="Racking not set up yet">—</span>`);
    const chs=recChs(i);
    const chLabel=chs.length?chs.map(c=>c.ch==='Facebook Marketplace'?'Facebook':c.ch).join(' · '):'';
    const link=chs.find(c=>c.url);
    const stripe=gone?'#94a3b8':recNeedsClearing(i)?'#f87171':i.status==='listed'?'#60a5fa':'#fbbf24';
    const src=i.source==='Gated Amazon stock'?'from Jack’s Admin (gated)':(i.source||'');
    const stateHtml=gone
      ?`<span class="recState gone">GONE</span><div class="recSub">${esc(REC_GONE_HOW[recGoneHow(i)]||'gone')}${i.gone_at?' · '+recDay(i.gone_at):''}${removed?' · removed':''}</div>`
      :i.status==='listed'
        ?`<span class="recState listed">LISTED<span class="recEb">${esc(chLabel||'—')}</span></span>${link?` <a href="${esc(link.url)}" target="_blank" onclick="event.stopPropagation()" class="recLink">open ↗</a>`:(chs[0]&&chs[0].ref?` <span class="recSub" style="display:inline;font-family:var(--mono)">${esc(chs[0].ref)}</span>`:'')}`
        :`<span class="recState here">SITTING HERE</span>`;
    const sinceHtml=gone?''
      :`<div class="recSince"><span class="recAge" style="color:${recAgeCol(age,clk.listed)}">${age===0?'today':age+'d'}</span><span class="recSub" style="display:inline">${clk.listed?' · listed '+recDay(recListedOn(i)):' · not listed'}${recNeedsClearing(i)?' · <b style="color:#f87171">needs clearing</b>':''}</span></div>`;
    return `<tr class="row ${_recSel.has(i.id)?'sel':''} ${_recOpen===i.id?'open':''} ${gone?'dim':''} ${(!gone&&recNeedsClearing(i))?'late':''}" onclick="recOpen('${i.id}')">
      <td class="recStripeTd"><span class="recStripe" style="background:${stripe}"></span></td>
      <td class="c" onclick="event.stopPropagation()"><input type="checkbox" ${_recSel.has(i.id)?'checked':''} onchange="recToggle('${i.id}',this.checked)"></td>
      <td class="recProdTd"><div class="recName" title="${esc(i.name||'')}">${esc(i.name||'(no name)')}</div><div class="recId">${i.id_value?esc(i.id_value):''}${i.amz_sku?(i.id_value?' · ':'')+esc(i.amz_sku):''}${src?` <span style="opacity:.75">· ${esc(src)}</span>`:''}</div>${i.notes?`<div class="recNoteLine" title="${esc(i.notes)}">${esc(i.notes)}</div>`:''}</td>
      <td class="r"><div class="recNum">${fmt(recQty(i))}</div></td>
      <td>${locHtml}</td>
      <td><span class="recCond" style="color:${/^new|^good/i.test(i.condition)?'#4ade80':/bad|ood/i.test(i.condition)?'#f87171':'#e2c68a'}">${esc(i.condition||'New')}</span>${i.condition_notes?`<div class="recSub" title="${esc(i.condition_notes)}">${esc(i.condition_notes)}</div>`:''}</td>
      <td class="r"><span class="recNum" style="color:${gone?'var(--text3)':'var(--accent)'}">${i.cost!=null&&i.cost!==''?fmtGBP2(recQty(i)*i.cost):'<span class="recDash" title="No cost recorded — open ··· to add it">—</span>'}</span>${i.cost!=null&&i.cost!==''&&recQty(i)>1?`<div class="recSub">${fmtGBP2(i.cost)} each</div>`:''}</td>
      <td class="recStateTd">${stateHtml}${sinceHtml}</td>
      <td class="r recActsTd" onclick="event.stopPropagation()"><div class="recRowActs">
        ${!gone&&i.status==='here'?`<button class="go" onclick="recListModal(['${i.id}'])" title="It is on eBay / Vinted — say where and since when">Listed on…</button>`:''}
        ${!gone?`<button class="ok" onclick="recGoneModal(['${i.id}'])" title="Sold, cleared or back to Amazon — no price asked">Gone</button>`:''}
        ${gone&&!removed?`<button class="ok" onclick="recRemove(['${i.id}'])" title="Off every view and every number. Kept in the audit log — Show removed brings it back">Remove</button><button onclick="recUnarchive('${i.id}')" title="It is back on the shelf after all">Undo</button>`:''}
        ${removed?`<button onclick="recUnarchive('${i.id}')">Bring back</button>`:''}
        <button onclick="recOpen('${i.id}')" title="Move rack · change qty · condition · note · split · everything else">&middot;&middot;&middot;</button></div></td>
    </tr>`;};

  w.innerHTML=`
  <div class="recHead">
    <div><h2>Recovery Stock</h2><p>Stock that isn’t going back to Amazon. What we’ve got · how many · where · listed or not · how long it has sat. <b>Sitting here → Listed → Gone.</b></p></div>
    <div class="recActs">
      <button class="recBtn" onclick="recExport()">&#8681; Export CSV</button>
      <button class="recBtn pri" onclick="recAddModal(10)">+ Add stock (paste a list)</button>
    </div>
  </div>
  ${setup}
  <div class="recKpis">
    ${kpi('units','Sitting in recovery',fmtGBP2(k.value),fmt(k.units)+' unit'+(k.units===1?'':'s')+' across '+fmt(k.items)+' line'+(k.items===1?'':'s')+', at cost','#f4b942','all')}
    ${kpi('not','Not listed anywhere',fmtGBP2(k.idleCash),fmt(k.notListed)+' unit'+(k.notListed===1?'':'s')+' earning nothing'+(k.hereOld?' · '+fmt(k.hereOld)+' over '+TM.recUnlistedAmber+' days':''),'#f87171','here')}
    ${kpi('listed','Listed',fmt(k.listed),'unit'+(k.listed===1?'':'s')+' on eBay / Vinted'+(k.listedOld?' · '+fmt(k.listedOld)+' listed over '+TM.recListedRed+' days':''),'#60a5fa','listed')}
    ${kpi('gone','Gone this month',fmt(k.goneMonth),fmt(k.goneMonthN)+' line'+(k.goneMonthN===1?'':'s')+' sold or cleared since the 1st','#4ade80','gone')}
  </div>
  <div class="recTabs">
    ${tabBtn('all','All')}${tabBtn('here','Sitting here')}${tabBtn('listed','Listed')}${tabBtn('stale','Needs clearing')}${tabBtn('gone','Gone')}
  </div>
  <div class="recBar">
    <div class="recSearch"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="6" r="4"/><path d="M9 9l3.5 3.5"/></svg>
      <input id="recQ" value="${esc(_recQ)}" placeholder="Search product, ASIN, EAN, SKU, location, note…" oninput="_recQ=this.value;renderRecovery();setTimeout(()=>{const b=document.getElementById('recQ');if(b){b.focus();b.setSelectionRange(b.value.length,b.value.length);}},0);"></div>
    <select class="recSel" onchange="_recF.loc=this.value;renderRecovery()"><option value="">All locations</option>${locOpts}</select>
    <select class="recSel" onchange="_recF.cond=this.value;renderRecovery()"><option value="">All conditions</option>${REC_COND.map(c=>opt(c,c,_recF.cond)).join('')}</select>
    <select class="recSel" onchange="_recSort=this.value;renderRecovery()">${opt('sitting','Sort: longest sitting first',_recSort)}${opt('money','Sort: most money first',_recSort)}${opt('name','Sort: product A–Z',_recSort)}${opt('loc','Sort: location',_recSort)}${opt('newest','Sort: newest added',_recSort)}</select>
    ${(_recQ||_recF.loc||_recF.cond)?`<button class="recBtn sm" onclick="_recQ='';_recF={loc:'',cond:''};renderRecovery()">&#10005; Clear filters</button>`:''}
  </div>
  ${_recSel.size?`<div class="recBulk"><span class="n">${fmt(_recSel.size)} line${_recSel.size===1?'':'s'} · ${fmt(selUnits)} units selected</span>
    <button class="recBtn sm good" onclick="recListModal([..._recSel])">Mark listed…</button>
    <button class="recBtn sm good" onclick="recGoneModal([..._recSel])">Gone</button>
    <button class="recBtn sm" onclick="recMoveModal([..._recSel])">Move location</button>
    <button class="recBtn sm" onclick="recNoteModal([..._recSel])">Add note</button>
    <button class="recBtn sm bad" onclick="recRemove([..._recSel])" title="Only lines already Gone can be removed">Remove</button>
    <button class="recBtn sm" onclick="_recSel.clear();renderRecovery()" style="margin-left:auto">Clear selection</button></div>`:''}
  <div class="recBody ${_recOpen?'hasDrawer':''}">
    <div>
      <div class="recTableWrap"><table class="rec"><thead><tr>
        <th class="recStripeTd"></th>
        <th class="c" style="width:30px"><input type="checkbox" ${list.length&&list.every(i=>_recSel.has(i.id))?'checked':''} onchange="recToggleAll(this.checked)" title="Select all shown"></th>
        <th onclick="_recSort='name';renderRecovery()" class="${_recSort==='name'?'on':''}">Product</th>
        <th class="r" style="width:60px">Qty</th>
        <th onclick="_recSort='loc';renderRecovery()" class="${_recSort==='loc'?'on':''}">Where</th>
        <th>Condition</th>
        <th class="r" onclick="_recSort='money';renderRecovery()" class="${_recSort==='money'?'on':''}">Cost sitting</th>
        <th onclick="_recSort='sitting';renderRecovery()" class="${_recSort==='sitting'?'on':''}">State · since</th>
        <th class="r recActsTh">Actions</th>
      </tr></thead><tbody>
        ${list.length?list.map(rowHtml).join(''):`<tr><td colspan="9"><div class="recEmpty">${REC.length?'Nothing matches these filters.':'Nothing here yet.'}<small>${REC.length?'Clear the filters or pick another tab.':'Use <b>+ Add stock</b> to paste the stocktake, or send a gated item over from Jack’s Admin.'}</small></div></td></tr>`}
      </tbody></table></div>
      <div class="recFoot" style="margin-top:8px"><span>Showing ${fmt(list.length)} of ${fmt(counts[_recTab]||0)} in this view · ${fmt(REC.filter(i=>!recRemoved(i)).length)} lines${REC.some(recRemoved)?` · <label style="cursor:pointer;color:var(--text2)"><input type="checkbox" ${_recShowRemoved?'checked':''} onchange="_recShowRemoved=this.checked;renderRecovery()"> show removed (${fmt(REC.filter(recRemoved).length)})</label>`:''}</span>
        <span style="margin-left:auto">Not listed: <b style="color:#fbbf24">${TM.recUnlistedAmber}d</b> amber · <b style="color:#f87171">${TM.recUnlistedRed}d</b> red &nbsp;·&nbsp; Listed: <b style="color:#fbbf24">${TM.recListedAmber}d</b> amber · <b style="color:#f87171">${TM.recListedRed}d</b> red &nbsp;· Gone lines tidy themselves away after 30 days · Settings → Timings</span></div>
    </div>
    <div class="recDrawer" id="recDrawer">${_recOpen?recDrawerHtml(REC.find(i=>i.id===_recOpen)):''}</div>
  </div>`;
  if(_recOpen)recEvents(_recOpen).then(()=>{const d=document.getElementById('recTL');if(d)d.innerHTML=recTimelineHtml(_recOpen);});
}
function recToggle(id,on){if(on)_recSel.add(id);else _recSel.delete(id);renderRecovery();}
function recToggleAll(on){recFiltered().forEach(i=>on?_recSel.add(i.id):_recSel.delete(i.id));renderRecovery();}
function recOpen(id){_recOpen=(_recOpen===id)?null:id;renderRecovery();}
function recClose(){_recOpen=null;renderRecovery();}

/* ── drawer ────────────────────────────────────────────────────────────────── */
function recTimelineHtml(id){
  const ev=_recEvCache[id]||[];
  const i=REC.find(x=>x.id===id);
  const head=i?`<div class="recEv"><span class="w">${recWhen(i.created_at)}</span><span><b>Added</b>${i.added_by?' by '+esc(i.added_by):''} · ${recDays(i.created_at)}d in recovery</span></div>`:'';
  return (ev.length?ev.map(e=>`<div class="recEv"><span class="w">${recWhen(e.at)}</span><span><b>${esc(e.action)}</b>${e.who?' · '+esc(e.who):''}${e.note?' — '+esc(e.note):''}${(e.prev||e.next)&&!e.note?` — ${esc(e.prev||'—')} → ${esc(e.next||'—')}`:''}</span></div>`).join(''):'')+head;
}
function recDrawerHtml(i){
  if(!i)return '';
  const st=REC_STATUS[i.status]||REC_STATUS.here;
  const chs=recChs(i),locs=recLocs(i),gone=!recActive(i);
  const chBtn=c=>{const on=chs.find(x=>x.ch===c);return `<button class="recCh ${on?'on':''}" onclick="recToggleChannel('${i.id}','${esc(c)}')">${esc(c)}</button>`;};
  const clk=recClock(i);
  return `<div class="recDH"><div><b>${esc(i.name||'(no name)')}</b><div class="recId" style="margin-top:3px">${esc(i.id_value||'')}${i.amz_sku?(i.id_value?' · ':'')+esc(i.amz_sku):''}${i.source?' · '+esc(i.source):''}</div></div><button class="x" onclick="recClose()">&#10005;</button></div>
  <div class="recDLine"><span class="recState ${gone?'gone':i.status==='listed'?'listed':'here'}">${esc(st[0].toUpperCase())}</span>
    <span class="recSub" style="display:inline">${gone?esc((REC_GONE_HOW[recGoneHow(i)]||'')+(i.gone_at?' · '+recDay(i.gone_at):'')):(i.status==='listed'?'listed '+recDay(recListedOn(i))+' · '+clk.days+'d':'sitting here '+clk.days+'d')}${recRemoved(i)?' · removed':''}</span></div>
  <div class="recDSec"><div class="recF">
    <label>Name</label><input value="${esc(i.name)}" onchange="recField('${i.id}','name',this.value)">
    <label>Qty</label><input type="number" min="0" value="${recQty(i)}" onchange="recSetQty('${i.id}',this.value)" ${gone?'disabled':''}>
    <label>Rack</label><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${locs.length?locs.map(l=>`<span class="recLoc">${esc(l.loc)}${locs.length>1?' <span style="opacity:.7">×'+fmt(l.qty)+'</span>':''}</span>`).join(''):'<span class="recLoc none">—</span>'}${!gone?`<button class="recBtn sm" onclick="recMoveModal(['${i.id}'])">Move / split</button>`:''}</div>
    <label>Condition</label><div>${recPickBtn('cond',i.condition||'New','data-id="'+i.id+'"')}</div>
    <label>Cost / unit</label><input type="number" step="0.01" value="${i.cost==null?'':i.cost}" placeholder="£" onchange="recField('${i.id}','cost',this.value===''?null:+this.value)">
    <label>Identifier</label><input value="${esc(i.id_value)}" placeholder="ASIN / EAN / SKU" onchange="recField('${i.id}','id_value',this.value);recField('${i.id}','id_type',recDetectIdType(this.value))">
    <label>Note</label><textarea placeholder="anything worth remembering — a line is enough" onchange="recField('${i.id}','notes',this.value)">${esc(i.notes||'')}</textarea>
  </div></div>
  ${i.status==='listed'?`<div class="recDSec"><h4>Listed on</h4><div class="recChs">${REC_CHANNELS.map(chBtn).join('')}</div>
    ${chs.map((c,n)=>`<div class="recChRef" style="margin-top:6px"><input value="${esc(c.ref||'')}" placeholder="${/ebay/i.test(c.ch)?'eBay SKU / item no.':'reference'}" onchange="recChannelField('${i.id}',${n},'ref',this.value)"><input value="${esc(c.url||'')}" placeholder="listing link (optional)" onchange="recChannelField('${i.id}',${n},'url',this.value)"></div>`).join('')}</div>`:''}
  <div class="recDSec"><h4>History · added ${recDay(i.created_at)}${i.added_by?' by '+esc(i.added_by):''}</h4><div class="recTL" id="recTL">${recTimelineHtml(i.id)}</div></div>
  <div class="recDActs">
    ${!gone&&i.status==='here'?`<button class="recBtn good" onclick="recListModal(['${i.id}'])">Listed on…</button>`:''}
    ${!gone?`<button class="recBtn" onclick="recGoneModal(['${i.id}'])">Gone</button>`:''}
    ${gone&&!recRemoved(i)?`<button class="recBtn bad" onclick="recRemove(['${i.id}'])">Remove</button>`:''}
    ${gone?`<button class="recBtn good" onclick="recUnarchive('${i.id}')">Bring back to stock</button>`:''}
    ${/^jack/i.test(String(window.currentUserName||''))?`<button class="recBtn span bad" style="opacity:.7" onclick="recDelete('${i.id}')">Delete permanently (Jack only)</button>`:''}
  </div>`;
}

/* ── field edits ───────────────────────────────────────────────────────────── */
const REC_FIELD_LABEL={name:'Name',id_type:'Identifier type',id_value:'Identifier',amz_sku:'Amazon SKU',cost:'Cost / unit',condition:'Condition',condition_notes:'Condition notes',notes:'Notes'};
async function recField(id,field,val){
  const i=REC.find(x=>x.id===id);if(!i)return;
  const prev=i[field];if(String(prev==null?'':prev)===String(val==null?'':val))return;
  i[field]=val;
  await recSave(i,(REC_FIELD_LABEL[field]||field)+' changed','',prev,val);
  renderRecovery();
}
async function recSetQty(id,v){
  const i=REC.find(x=>x.id===id);if(!i)return;
  const n=Math.max(0,parseInt(v)||0),prev=recQty(i);if(n===prev)return;
  i.qty=n;
  /* keep a single location in step; multi-location edits go through Move / split */
  const ls=recLocs(i);if(ls.length===1){ls[0].qty=n;i.locations=ls;}
  await recSave(i,n>prev?'Quantity added':'Quantity removed',`${fmt(prev)} → ${fmt(n)}`,prev,n);
  if(n===0&&recActive(i))await recMarkGone(i,'cleared','quantity set to 0',prev);
  renderRecovery();
}
async function recSetStatus(id,s){
  const i=REC.find(x=>x.id===id);if(!i||!REC_STATUS[s])return;
  if(s==='gone'){return recGoneModal([id]);}
  if(s==='archived'){return recRemove([id]);}
  const prev=i.status;if(prev===s)return;
  i.status=s;i.archived=false;
  await recSave(i,'Status changed','',REC_STATUS[prev]?REC_STATUS[prev][0]:prev,REC_STATUS[s][0]);
  renderRecovery();
}
async function recToggleChannel(id,ch){
  const i=REC.find(x=>x.id===id);if(!i)return;
  const chs=recChs(i);const at=chs.findIndex(c=>c.ch===ch);
  if(at>=0){chs.splice(at,1);i.channels=chs;await recSave(i,'Channel removed',ch);}
  else{chs.push({ch,ref:'',url:'',date:recNow(),note:''});i.channels=chs;
    if(!i.listed_at)i.listed_at=recNow();      /* the clock the 90-day rule reads */
    if(i.status==='here')i.status='listed';   // a channel IS a route
    await recSave(i,'Channel added',ch);}
  renderRecovery();
}
async function recChannelField(id,n,field,val){
  const i=REC.find(x=>x.id===id);if(!i)return;const chs=recChs(i);if(!chs[n])return;
  chs[n][field]=val;i.channels=chs;
  await recSave(i,(field==='ref'?'Channel reference':'Listing link')+' set',chs[n].ch+': '+val);
  renderRecovery();
}

/* ── modal plumbing ────────────────────────────────────────────────────────── */
/* a picker that reads like the app, not the browser: click → list, click → set */
function recPickOpen(btn,kind,cb){
  document.querySelectorAll('.recPickPop').forEach(p=>p.remove());
  const opts=kind==='cond'?REC_COND:kind==='status'?['here','listed'].map(s=>[s,REC_STATUS[s][0]]):[];
  const cur=btn.dataset.v||'';
  const pop=document.createElement('div');pop.className='recPickPop';
  pop.innerHTML=opts.map(o=>{const v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;
    return `<div class="recPickOpt ${v===cur?'on':''}" data-v="${esc(v)}">${esc(l)}</div>`;}).join('');
  document.body.appendChild(pop);
  const r=btn.getBoundingClientRect();
  pop.style.left=Math.min(r.left,window.innerWidth-260)+'px';
  pop.style.top=(r.bottom+4+pop.offsetHeight>window.innerHeight?r.top-pop.offsetHeight-4:r.bottom+4)+'px';
  const close=()=>{pop.remove();document.removeEventListener('mousedown',outside,true);};
  const outside=e=>{if(!pop.contains(e.target)&&e.target!==btn)close();};
  setTimeout(()=>document.addEventListener('mousedown',outside,true),0);
  pop.querySelectorAll('.recPickOpt').forEach(el=>el.onmousedown=e=>{e.preventDefault();const v=el.dataset.v;
    btn.dataset.v=v;btn.innerHTML=esc(el.textContent)+' <span style="opacity:.5">&#9662;</span>';close();if(cb)cb(v);});
}
function recPickBtn(kind,v,attrs){
  const label=kind==='status'?(REC_STATUS[v]||[v])[0]:v;
  return `<button type="button" class="recPk" ${attrs||''} data-v="${esc(v)}" onclick="recPickOpen(this,'${kind}',${kind==='status'?'v=>recSetStatus(this.dataset.id,v)':'this.dataset.id?v=>recField(this.dataset.id,\'condition\',v):null'})">${esc(label)} <span style="opacity:.5">&#9662;</span></button>`;
}
function recModal(html,wide){
  let el=document.getElementById('recModalHost');
  if(!el){el=document.createElement('div');el.id='recModalHost';el.className='overlay recModal';el.style.zIndex='150';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)recModalClose();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&el.style.display==='flex')recModalClose();});}
  el.innerHTML=`<div class="modal ${wide?'wide':''}">${html}</div>`;el.style.display='flex';
  setTimeout(()=>{const f=el.querySelector('input,select,textarea');if(f)f.focus();},40);
}
function recModalClose(){const el=document.getElementById('recModalHost');if(el)el.style.display='none';}

/* ── add / bulk add ────────────────────────────────────────────────────────── */
function recAddModal(rowsN){
  const locOpts=Object.keys(recLocCounts().m).sort();
  const today=new Date().toISOString().slice(0,10);
  /* Jack, 6 Sep: "where is listed in all of this?" — a stocktake line is often
     already on eBay, so it says so here and enters as LISTED with the right
     clock, instead of Sitting here and a second trip to press List it. */
  const row=n=>`<tr id="recAR${n}"><td class="n">${n+1}</td>
    <td><input data-f="name" placeholder="Product name" oninput="recGridCheck()"></td>
    <td><input data-f="amz_sku" placeholder="Amuk_… — fills the rest" oninput="recGridAmz(this)"></td>
    <td><input data-f="id_value" placeholder="ASIN / EAN" oninput="recGridCheck();recGridCost(this);recGridIdHint(this)"><div class="recIdHint"></div></td>
    <td><input data-f="qty" type="number" min="1" value="1" oninput="recGridCheck()"></td>
    <td>${recPickBtn('cond','New','data-f="condition"')}</td>
    <td><select data-f="listed" onchange="recGridListed(this);recGridCheck()"><option value="">Not listed</option>${REC_CHANNELS.map(c=>`<option value="${esc(c)}">${esc(c==='Facebook Marketplace'?'Facebook':c)}</option>`).join('')}</select></td>
    <td><input data-f="since" type="date" value="${today}" max="${today}" disabled title="When it went up — sets the listed clock"></td>
    <td><input data-f="cost" type="number" step="0.01" placeholder="£"></td>
    <td><input data-f="loc" list="recLocList" placeholder="${locOpts.length?'RACK-A1':'optional'}"></td>
    <td><input data-f="notes" placeholder="optional"></td></tr>`;
  recModal(`<h3>${rowsN>1?'Bulk add stock':'Add an item'}</h3>
    <div class="sub">One row per product. <b>Product</b>, <b>qty</b> and <b>condition</b> are required. Already on eBay? Pick it under <b>Listed on</b> and the line enters as Listed with its clock set from <b>Since</b>. ${recRackingLive()?'':'Racking isn&rsquo;t set up yet, so rack is optional.'}</div>
    <div class="recGridWrap"><table class="recGrid"><thead><tr><th></th><th class="req" style="min-width:220px">Product</th><th style="width:170px">Amazon SKU</th><th style="width:150px">Identifier</th><th class="req" style="width:64px">Qty</th><th class="req" style="width:120px">Condition</th><th style="width:118px">Listed on</th><th style="width:136px">Since</th><th style="width:88px">Cost / unit</th><th style="width:104px">Rack</th><th>Note</th></tr></thead>
      <tbody id="recGridBody">${Array.from({length:rowsN},(_,n)=>row(n)).join('')}</tbody></table></div>
    <datalist id="recLocList">${locOpts.map(l=>`<option value="${esc(l)}">`).join('')}</datalist>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <button class="recBtn sm" onclick="recGridAddRows(5)">+ 5 rows</button>
      <button class="recBtn sm" onclick="recGridAddRows(20)">+ 20 rows</button>
      <span class="recHint" style="margin:0">Tip: type the <b>Amazon SKU</b> from the return and the name, ASIN and cost fill themselves from the Prep Sheet. Identifiers are recognised automatically — no type to pick.</span></div>
    <details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;font-weight:800;color:var(--accent)">Paste from a spreadsheet instead &#9662;</summary>
      <div class="recHint" style="margin:6px 0">Copy the rows from your sheet and paste below. Columns in this order, tab-separated (blank cells are fine):<br>
        <code style="font-family:var(--mono)">Product · Amazon SKU · Identifier · Qty · Condition · Listed on · Since (dd/mm/yyyy) · Cost · Rack · Note</code> — the old 8-column order (Cost after Condition) still works.</div>
      <textarea class="recPaste" id="recPasteBox" placeholder="Paste here…" onpaste="setTimeout(recGridPaste,10)"></textarea></details>
    <div id="recGridWarn"></div>
    <div class="foot"><span class="left" id="recGridCount"></span>
      <button class="recBtn" onclick="recModalClose()">Cancel</button>
      <button class="recBtn pri" id="recGridGo" onclick="recGridCommit()">Add to Recovery Stock</button></div>`,true);
  recGridCheck();
}
function recGridRows(){
  return [...document.querySelectorAll('#recGridBody tr')].map(tr=>{
    const g=f=>{const el=tr.querySelector(`[data-f="${f}"]`);return el?String(el.dataset&&el.dataset.v!=null?el.dataset.v:(el.value||'')).trim():'';};
    return {tr,name:g('name'),amz_sku:g('amz_sku'),id_value:g('id_value'),id_type:recDetectIdType(g('id_value')),qty:parseInt(g('qty'))||0,condition:g('condition')||'New',cost:g('cost')===''?null:+g('cost'),loc:recNormLoc(g('loc')),notes:g('notes'),listed:g('listed'),since:g('since')};
  });
}
function recGridAddRows(n){
  const tb=document.getElementById('recGridBody');if(!tb)return;
  const start=tb.children.length;
  for(let k=0;k<n;k++){const tr=tb.children[0].cloneNode(true);tr.id='recAR'+(start+k);tr.querySelector('.n').textContent=start+k+1;
    tr.querySelectorAll('input').forEach(x=>{x.value=x.dataset.f==='qty'?'1':(x.dataset.f==='since'?new Date().toISOString().slice(0,10):'');if(x.dataset.f==='since')x.disabled=true;});
    tr.querySelectorAll('select').forEach(x=>{x.value='';});
    const pk=tr.querySelector('.recPk');if(pk){pk.dataset.v='New';pk.innerHTML='New <span style="opacity:.5">&#9662;</span>';}
    const h=tr.querySelector('.recIdHint');if(h)h.textContent='';tr.classList.remove('dupe','bad');tb.appendChild(tr);}
  recGridCheck();
}
function recGridListed(sel){const tr=sel.closest('tr');const d=tr.querySelector('[data-f="since"]');if(d){d.disabled=!sel.value;if(sel.value&&!d.value)d.value=new Date().toISOString().slice(0,10);}}
function recGridIdHint(inp){const h=inp.parentElement.querySelector('.recIdHint');if(!h)return;const t=recDetectIdType(inp.value);h.textContent=t==='None'?'':t;}
/* Amazon SKU typed → the Prep Sheet row fills the rest */
function recGridAmz(inp){
  const tr=inp.closest('tr');const r=recPrepRowBySku(inp.value);
  const set=(f,v)=>{const el=tr.querySelector(`[data-f="${f}"]`);if(el&&!el.value&&v!=null&&v!=='')el.value=v;};
  if(r){set('name',r.prod||'');set('id_value',r.asin||'');if(r.asin)recGridIdHint(tr.querySelector('[data-f="id_value"]'));
    const cost=parseSKU(String(r.sku||'')).cogs;if(cost>0)set('cost',cost);inp.title='matched Prep Sheet row — name, ASIN and cost filled';}
  else{const c=recCostFromSku(inp.value);if(c!=null)set('cost',c);}
  recGridCheck();
}
function recGridCost(inp){
  const tr=inp.closest('tr');const cost=tr.querySelector('[data-f="cost"]');if(!cost||cost.value)return;
  const c=recCostFromSku(inp.value);if(c!=null){cost.value=c;cost.title='filled from the SKU — edit if wrong';}
}
function recGridPaste(){
  const box=document.getElementById('recPasteBox');if(!box)return;
  const lines=box.value.split(/\r?\n/).map(l=>l.replace(/\s+$/,'')).filter(l=>l.trim());
  if(!lines.length)return;
  const tb=document.getElementById('recGridBody');
  let rows=recGridRows();
  let target=rows.findIndex(r=>!r.name);if(target<0)target=rows.length;
  const need=target+lines.length-rows.length;if(need>0)recGridAddRows(need);
  rows=recGridRows();
  lines.forEach((ln,k)=>{
    const cells=ln.split('\t').map(s=>s.trim());
    /* tolerate a header row */
    if(k===0&&/^product/i.test(cells[0]||''))return;
    const tr=rows[target+k].tr;const set=(f,v)=>{const el=tr.querySelector(`[data-f="${f}"]`);if(!el||v==null||v==='')return;
      if(el.tagName==='SELECT'){const o=[...el.options].find(o=>o.value.toLowerCase()===String(v).toLowerCase());if(o)el.value=o.value;}else el.value=v;};
    set('name',cells[0]);set('amz_sku',cells[1]);set('id_value',cells[2]);set('qty',cells[3]);
    const pk=tr.querySelector('.recPk');const cond=recCondMatch(cells[4]);
    if(pk&&cond){pk.dataset.v=cond;pk.innerHTML=esc(cond)+' <span style="opacity:.5">&#9662;</span>';}
    /* new order has Listed on + Since after Condition; the old order put Cost there */
    const chName=REC_CHANNELS.find(c=>c.toLowerCase()===String(cells[5]||'').toLowerCase()||(String(cells[5]||'').toLowerCase()==='facebook'&&c==='Facebook Marketplace'));
    const newOrder=!!chName||/^(not listed|—|-)$/i.test(String(cells[5]||''));
    if(newOrder){
      const sel=tr.querySelector('[data-f="listed"]');if(sel){sel.value=chName||'';recGridListed(sel);}
      const d=tr.querySelector('[data-f="since"]');const m=/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(String(cells[6]||'').trim());
      if(d&&m){const y=m[3].length===2?'20'+m[3]:m[3];d.value=`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}else if(d&&/^\d{4}-\d{2}-\d{2}$/.test(String(cells[6]||'')))d.value=cells[6];
      set('cost',cells[7]?String(cells[7]).replace(/[£,]/g,''):'');set('loc',cells[8]);set('notes',cells.slice(9).join(' '));
    }else{
      set('cost',cells[5]?String(cells[5]).replace(/[£,]/g,''):'');set('loc',cells[6]);set('notes',cells.slice(7).join(' '));
    }
    const amz=tr.querySelector('[data-f="amz_sku"]');if(amz&&amz.value)recGridAmz(amz);
    if(!cells[5]&&cells[2]){const c=recCostFromSku(cells[2]);if(c!=null)set('cost',c);}
    recGridIdHint(tr.querySelector('[data-f="id_value"]'));
  });
  box.value='';recGridCheck();toast(lines.length+' line'+(lines.length===1?'':'s')+' pasted — check them, then add','ok');
}
function recGridCheck(){
  const rows=recGridRows();let filled=0,bad=0,dupes=0;
  const active=REC.filter(recActive);
  rows.forEach(r=>{r.tr.classList.remove('dupe','bad');
    const any=r.name||r.id_value||r.amz_sku||r.notes||r.loc||r.cost!=null;
    if(!any)return;filled++;
    if(!r.name||r.qty<1){r.tr.classList.add('bad');bad++;}
    else if(r.id_value&&active.some(i=>(i.id_value||'').toLowerCase()===r.id_value.toLowerCase())){r.tr.classList.add('dupe');dupes++;}
  });
  const _u=rows.filter(r=>r.name).reduce((t,r)=>t+(r.qty||0),0),_c=rows.filter(r=>r.name).reduce((t,r)=>t+(r.qty||0)*(r.cost||0),0),_l=rows.filter(r=>r.name&&r.listed).length;
  const c=document.getElementById('recGridCount');if(c)c.innerHTML=filled?`<b>${filled}</b> line${filled===1?'':'s'} · <b>${fmt(_u)}</b> units · <b>${fmtGBP2(_c)}</b> at cost${_l?` · <b>${_l}</b> already listed`:''}${bad?` · <span style="color:#f87171">${bad} missing a name or qty</span>`:''}${dupes?` · <span style="color:#fbbf24">${dupes} already in stock</span>`:''}`:'Nothing entered yet';
  const go=document.getElementById('recGridGo');if(go)go.disabled=!filled||!!bad;
  const w=document.getElementById('recGridWarn');
  if(w)w.innerHTML=dupes?`<div class="recWarn"><b>${dupes} possible duplicate${dupes===1?'':'s'}</b> — the identifier is already in active Recovery Stock (amber rows). Returns come back, so this is usually fine: they'll be added as separate records. Use the drawer afterwards to merge quantities if it really is the same unit.</div>`:'';
}
async function recGridCommit(){
  const rows=recGridRows().filter(r=>r.name||r.id_value||r.amz_sku);
  if(!rows.length)return;
  if(rows.some(r=>!r.name||r.qty<1)){toast('Every filled row needs a name and a quantity','er');return;}
  const go=document.getElementById('recGridGo');if(go){go.disabled=true;go.textContent='Adding…';}
  let n=0;
  for(const r of rows){
    const _since=r.listed?(r.since?new Date(r.since+'T12:00:00').toISOString():recNow()):null;
    const i={id:recUid(),name:r.name,id_type:r.id_value?r.id_type:'None',id_value:r.id_value,amz_sku:r.amz_sku||'',extra_ids:[],qty:r.qty,
      locations:r.loc?[{loc:r.loc,qty:r.qty}]:[],condition:r.condition||'New',condition_notes:'',cost:r.cost,status:r.listed?'listed':'here',
      channels:r.listed?[{ch:r.listed,ref:'',url:'',date:_since,note:''}]:[],notes:r.notes||'',batch_id:'',pack:[],added_by:_who(),created_at:recNow(),last_action_at:recNow(),last_action:'Added',archived:false,gone_at:null,
      listed_at:r.listed?_since:null,sold_price:null,source:'Added by hand',source_ref:'',rack:''};
    REC.unshift(i);n++;
    await recSave(i,'Added',`${fmt(r.qty)} × ${r.condition}${r.loc?' @ '+r.loc:''}${r.cost!=null?' · '+fmtGBP2(r.cost)+'/unit':''}${r.listed?' · already listed on '+r.listed+' since '+recDay(_since):''}`);
  }
  recModalClose();toast(`${n} item${n===1?'':'s'} added to Recovery Stock`,'ok');
  _recTab='all';renderRecovery();
}

/* ── GATED AMAZON STOCK → RECOVERY STOCK ──────────────────────────────────
   Jack, 3 Sep: "I can send stuff to Recovery Stock then can't I?" — he could
   not: "eBay it" on his admin page only recorded the decision and handed the
   claim back to Sarah, so the units he had just decided to sell on eBay never
   appeared anywhere. One press now does both. It never invents a second copy:
   the same Amazon SKU already in recovery is left alone. */
async function recFromClaim(c){
  if(typeof REC==='undefined'||!c)return null;
  if(!_recLoaded){try{await recLoad();}catch(e){}}
  if(_recErr)return 'nosetup';
  const sku=(c.sku||'').trim();
  if(sku&&REC.some(i=>!i.archived&&(i.amz_sku||'').trim().toLowerCase()===sku.toLowerCase()))return 'dupe';
  const qty=parseInt(c.dif)||parseInt(c.exp)||1;
  const unit=(c.claimValue&&qty)?Math.round((c.claimValue/qty)*100)/100:null;   /* £36.70 / 10 is 3.6700000000000004 */
  let cost=unit;
  if(cost==null){try{cost=parseSKU(sku).cogs||null;}catch(e){cost=null;}}
  const i={id:recUid(),name:c.prod||sku||'(no name)',id_type:c.asin?'ASIN':'None',id_value:c.asin||'',
    amz_sku:sku,extra_ids:[],qty,locations:[],condition:'New',condition_notes:'',cost,
    status:'here',channels:[],notes:'Gated on Amazon'+(c.sup?' — '+c.sup:'')+(c.oid?' · '+c.oid:''),
    source:'Gated Amazon stock',source_ref:c.oid||'',listed_at:null,sold_price:null,rack:'',
    batch_id:'',pack:[],added_by:_who(),created_at:recNow(),last_action_at:recNow(),
    last_action:'Added',archived:false,gone_at:null};
  REC.unshift(i);
  await recSave(i,'Added','from a gated Amazon claim'+(c.oid?' · '+c.oid:''));
  try{if(_pageActive('page-recovery'))renderRecovery();}catch(e){}
  return i;
}

/* ── GATED → RECOVERY, WITH A FORM ────────────────────────────────────────
   Jack, 3 Sep: "button for recovery page and then a popup where I have to fill
   in the info". The one-click version guessed condition, quantity and cost from
   the claim; a gated item is often a part of the order, in a state only he can
   see. He fills it in, the claim's numbers just start it off. */
/* Jack, 3 Sep: "the stuff that is gated — I want a way to accept it going off
   Sarah's page and the Prep Sheet page so it's clear for UK staff and Sarah and
   not cramped full of stuff they won't deal with." Gated is his call alone, so
   it becomes his: ownership moves, the waiting flag clears (which is what her
   page keys off), and the Prep Sheet row is marked so it stops taking a line.
   Nothing is closed or deleted — Undo puts it straight back on their lists. */
async function takeGatedMine(claimId){
  const c=(typeof claims!=='undefined'?claims:[]).find(x=>String(x.id)===String(claimId));
  if(!c){toast('Claim not found','er');return;}
  const was={owner:c.owner,sentToJack:c.sentToJack};
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Taken off Sarah and the Prep Sheet — gated, Jack\u2019s call ('+_who()+')'});
  c.owner='Jack';c.sentToJack=null;
  const r=(typeof rows!=='undefined'?rows:[]).find(x=>String(x.uuid)===String(c.prepRowId)||String(x.id)===String(c.prepRowId));
  const wasGated=r?r.jackGated:null;
  if(r){r.jackGated=true;try{await saveRow(r);}catch(e){}}
  try{await saveClaim(c);}catch(e){}
  try{renderAdmin();renderJack();renderPrep();paintJackBadge();}catch(e){}
  try{logAudit('Gated taken off the team',`${c.sku||c.prod||''} — stays on Jack's Admin`);}catch(e){}
  toastUndo('Off their lists — still on yours',async()=>{
    c.owner=was.owner;c.sentToJack=was.sentToJack;
    if(r){r.jackGated=wasGated;try{await saveRow(r);}catch(e){}}
    try{await saveClaim(c);}catch(e){}
    try{renderAdmin();renderJack();renderPrep();paintJackBadge();}catch(e){}
    toast('Back on their lists','ok');});
}
function recFromClaimModal(claimId){
  const c=(typeof claims!=='undefined'?claims:[]).find(x=>String(x.id)===String(claimId));
  if(!c){toast('Claim not found','er');return;}
  if(typeof REC==='undefined'){toast('Recovery Stock is not loaded yet','er');return;}
  if(_recErr){toast('Recovery Stock needs its one-time setup first — run the SQL','er');return;}
  const qty=parseInt(c.dif)||parseInt(c.exp)||1;
  const unit=(c.claimValue&&qty)?Math.round((c.claimValue/qty)*100)/100:'';
  const dupe=(c.sku||'').trim()&&REC.some(i=>!i.archived&&(i.amz_sku||'').trim().toLowerCase()===(c.sku||'').trim().toLowerCase());
  recModal(`<div class="recMH"><h3>Send to Recovery Stock</h3>
      <button class="recX" onclick="recModalClose()">&#10005;</button></div>
    <div class="recMB">
      ${dupe?`<div class="recWarn">This Amazon SKU is already in Recovery Stock. Adding it again will make a second entry.</div>`:''}
      <div class="recFormRow"><label>Product</label>
        <input id="rfcName" value="${esc(c.prod||c.sku||'')}"></div>
      <div class="recFormRow"><label>Amazon SKU</label>
        <input id="rfcSku" value="${esc(c.sku||'')}" style="font-family:var(--mono)"></div>
      <div class="recFormRow"><label>ASIN</label>
        <input id="rfcAsin" value="${esc(c.asin||'')}" style="font-family:var(--mono)"></div>
      <div class="recFormRow"><label>How many</label>
        <input id="rfcQty" type="number" min="1" value="${qty}" style="max-width:120px">
        <span class="recHint">${fmt(qty)} on the claim</span></div>
      <div class="recFormRow"><label>Condition</label>
        <div>${recPickBtn('cond','New','id="rfcCond"')}</div></div>
      <div class="recFormRow"><label>Cost / unit</label>
        <input id="rfcCost" type="number" step="0.01" min="0" value="${unit}" style="max-width:140px">
        <span class="recHint">${c.claimValue?fmtGBP2(c.claimValue)+' over '+fmt(qty):'no value on the claim'}</span></div>
      <div class="recFormRow"><label>Where is it</label>
        <input id="rfcLoc" placeholder="Leave blank until racking is in" style="max-width:200px"></div>
      <div class="recFormRow"><label>Notes</label>
        <textarea id="rfcNote" rows="2">Gated on Amazon${c.sup?' — '+esc(c.sup):''}${c.oid?' · '+esc(c.oid):''}</textarea></div>
    </div>
    <div class="recMF">
      <span class="recHint">It lands under <b>Needs Sorting</b>. Listing it is a separate step.</span>
      <button class="recBtn" onclick="recModalClose()">Cancel</button>
      <button class="recBtn pri" onclick="recFromClaimGo('${String(claimId).replace(/'/g,"\\'")}')">Add to Recovery Stock</button>
    </div>`,true);
}
async function recFromClaimGo(claimId){
  const c=(typeof claims!=='undefined'?claims:[]).find(x=>String(x.id)===String(claimId));
  if(!c)return;
  const g=id=>(document.getElementById(id)||{}).value;
  const name=String(g('rfcName')||'').trim();
  const qty=parseInt(g('rfcQty'))||0;
  if(!name){toast('Give it a name','er');return;}
  if(qty<1){toast('How many?','er');return;}
  const costRaw=g('rfcCost');
  const loc=recNormLoc(g('rfcLoc'));
  const asin=String(g('rfcAsin')||'').trim();
  const i={id:recUid(),name,id_type:asin?'ASIN':'None',id_value:asin,
    amz_sku:String(g('rfcSku')||'').trim(),extra_ids:[],qty,
    locations:loc?[{loc,qty}]:[],
    condition:((document.getElementById('rfcCond')||{}).dataset||{}).v||'New',condition_notes:'',
    cost:costRaw===''||costRaw==null?null:+costRaw,
    status:'here',channels:[],notes:String(g('rfcNote')||'').trim(),
    source:'Gated Amazon stock',source_ref:c.oid||'',listed_at:null,sold_price:null,rack:'',
    batch_id:'',pack:[],added_by:_who(),created_at:recNow(),last_action_at:recNow(),
    last_action:'Added',archived:false,gone_at:null};
  REC.unshift(i);
  await recSave(i,'Added','from a gated Amazon claim'+(c.oid?' · '+c.oid:''));
  /* Jack, 7 Sep: "this has been removed to Recovery yet still on this page."
     Sending it to Recovery IS the decision — the claim closes with the note. */
  try{
    if(!c.log)c.log=[];
    c.log.push({t:getNowUK(),msg:`Sent to Recovery Stock — ${qty} × ${name.slice(0,40)} (${_who()})`});
    c.cst='Resolved';
    await saveClaim(c);
  }catch(e){console.warn('[recovery] claim close:',e);}
  /* Jack, 10 Sep, Corsair: "I thought this was marked as gated — why is it
     still here on this sheet?" The claim closed; the prep row stayed on the
     Prep Sheet as 1 in / 0 out, as if it were waiting to ship. Units that go
     to Recovery Stock have left the Amazon pipeline — the row files with the
     note, the same as any finished row. */
  try{
    const _pr=(typeof rows!=='undefined'?rows:[]).find(x=>String(x.uuid)===String(c.prepRowId)||String(x.id)===String(c.prepRowId));
    if(_pr&&!_pr.archived){
      const _left=Math.max(0,(parseInt(_pr.rcvd)||0)-(parseInt(_pr.ship)||0));
      const _d=new Date(),_dd=_ddUK(_d);
      _pr.notes=((_pr.notes||'').trim()?(_pr.notes.trim()+'\n'):'')+`${_dd}: ${fmt(qty)} → Recovery Stock (gated) — ${_who()}`;
      if(qty>=_left){_pr.archived=true;}
      _pr._dirty=true;
      await saveRow(_pr);
      try{logAudit(qty>=_left?'Filed — sent to Recovery Stock':'Part sent to Recovery Stock',`${_pr.sku||_pr.asin||''} — ${fmt(qty)} unit${qty===1?'':'s'}${qty>=_left?' · off the Prep Sheet':''}`);}catch(e){}
      try{renderPrep();}catch(e){}
    }
  }catch(e){console.warn('[recovery] prep row:',e);}
  try{renderJack();renderAdmin();paintJackBadge();}catch(e){}
  recModalClose();
  toast(`${fmt(qty)} × ${name.slice(0,28)} added to Recovery Stock`,'ok');
  try{if(_pageActive('page-recovery'))renderRecovery();}catch(e){}
}

/* ── sold / gone → to pack → packed ────────────────────────────────────────── */
/* ── List it ───────────────────────────────────────────────────────────────── */
function recListModal(ids){
  const items=ids.map(id=>REC.find(i=>i.id===id)).filter(Boolean).filter(i=>recActive(i)&&i.status==='here');
  if(!items.length){toast('Nothing here to list — pick lines that are sitting here','er');return;}
  const one=items.length===1?items[0]:null;
  const _today=new Date().toISOString().slice(0,10);
  recModal(`<h3>${one?'Listed on… — '+esc(one.name):'Mark '+fmt(items.length)+' lines as listed'}</h3>
    <div class="sub">Where is it up for sale, and since when? Already been on eBay a while — set the date and the clock is right from the start.</div>
    <div class="recF">
      <label>Listed on</label><select id="recLstCh">${REC_CHANNELS.map(c=>`<option>${c==='Facebook Marketplace'?'Facebook':c}</option>`).join('')}</select>
      <label>Since</label><input id="recLstSince" type="date" value="${_today}" max="${_today}">
      ${one?`<label>eBay SKU / item no.</label><input id="recLstRef" placeholder="optional">
      <label>Listing link</label><input id="recLstUrl" placeholder="paste it if you have it (optional)">`:''}
    </div>
    <div class="foot"><button class="recBtn" onclick="recModalClose()">Cancel</button><button class="recBtn good" onclick="recListGo(${JSON.stringify(items.map(i=>i.id))})">It’s listed &#10003;</button></div>`);
}
async function recListGo(ids){
  let ch=(document.getElementById('recLstCh')||{}).value||'eBay';if(ch==='Facebook')ch='Facebook Marketplace';
  const ref=((document.getElementById('recLstRef')||{}).value||'').trim(),url=((document.getElementById('recLstUrl')||{}).value||'').trim();
  const sinceV=((document.getElementById('recLstSince')||{}).value||'').trim();
  const since=sinceV?new Date(sinceV+'T12:00:00').toISOString():recNow();
  recModalClose();
  for(const id of ids){const i=REC.find(x=>x.id===id);if(!i||!recActive(i))continue;
    i.channels=[{ch,ref,url,date:since,note:''}];i.listed_at=since;i.status='listed';
    await recSave(i,'Listed',ch+(ref?' · '+ref:'')+' · since '+recDay(since));}
  _recSel.clear();toast(`Listed on ${ch}${sinceV?' since '+recDay(since):''}`,'ok');renderRecovery();
}
/* ── Gone ──────────────────────────────────────────────────────────────────── */
function recGoneModal(ids){
  const items=ids.map(id=>REC.find(i=>i.id===id)).filter(Boolean).filter(recActive);
  if(!items.length)return;
  const one=items.length===1?items[0]:null;
  const maxQ=one?recQty(one):0;
  recModal(`<h3>${one?'Gone — '+esc(one.name):fmt(items.length)+' lines gone'}</h3>
    <div class="sub">${one?`${fmt(maxQ)} unit${maxQ===1?'':'s'} on the line. No price asked — sold is sold.`:'Every unit of every selected line leaves. To take only part of a line, do it one line at a time.'}</div>
    <div class="recGoneHow">
      ${Object.keys(REC_GONE_HOW).map((k,n)=>`<label class="recHow ${n===0?'on':''}"><input type="radio" name="recHow" value="${k}" ${n===0?'checked':''} onchange="document.querySelectorAll('.recHow').forEach(l=>l.classList.toggle('on',l.querySelector('input').checked))"><span>${esc(REC_GONE_HOW[k])}</span></label>`).join('')}
    </div>
    <div class="recF" style="margin-top:8px">
      ${one&&maxQ>1?`<label>How many left?</label><input id="recGoneQty" type="number" min="1" max="${maxQ}" value="${maxQ}">`:''}
      <label>Note</label><input id="recGoneRef" placeholder="eBay order, buyer, who took it… (optional)">
    </div>
    <div class="foot"><button class="recBtn" onclick="recModalClose()">Cancel</button><button class="recBtn good" onclick="recGoneGo(${JSON.stringify(items.map(i=>i.id))})">Gone &#10003;</button></div>`);
}
async function recGoneGo(ids){
  const how=((document.querySelector('input[name="recHow"]:checked')||{}).value)||'sold';
  const ref=((document.getElementById('recGoneRef')||{}).value||'').trim();
  const qEl=document.getElementById('recGoneQty');
  recModalClose();
  for(const id of ids){
    const i=REC.find(x=>x.id===id);if(!i||!recActive(i))continue;
    const have=recQty(i);
    const n=(qEl&&ids.length===1)?Math.min(have,Math.max(1,parseInt(qEl.value)||have)):have;
    if(n<=0)continue;
    if(n<have){
      /* part of the line went: the rest stays as it was, the part that left
         becomes its own Gone line so the record is complete */
      const copy=Object.assign({},i,{id:recUid(),qty:n,locations:[],created_at:i.created_at,last_action_at:recNow()});
      REC.unshift(copy);
      await recMarkGone(copy,how,ref,n);
      const prev=have;i.qty=have-n;
      const ls=recLocs(i);let take=n;for(const l of ls){const t=Math.min(take,parseInt(l.qty)||0);l.qty=(parseInt(l.qty)||0)-t;take-=t;if(take<=0)break;}
      i.locations=ls.filter(l=>(parseInt(l.qty)||0)>0);
      await recSave(i,'Units left stock',`${fmt(n)} × ${REC_GONE_HOW[how]||how}${ref?' ('+ref+')':''} · ${fmt(i.qty)} remaining`,prev,i.qty);
    }else{
      await recMarkGone(i,how,ref,have);
    }
  }
  _recSel.clear();renderRecovery();
}
async function recMarkGone(i,how,ref,n){
  i.status='gone';i.gone_at=recNow();i.gone_how=how||'sold';i.gone_qty=n||recQty(i);i.pack=[];
  await recSave(i,'gone:'+(how||'sold'),`${fmt(n||recQty(i))} × ${REC_GONE_HOW[how]||how||'gone'}${ref?' — '+ref:''}`);
  if(_recOpen===i.id)_recOpen=null;
}
/* ── Remove — only once it is Gone ─────────────────────────────────────────── */
async function recRemove(ids){
  const items=ids.map(id=>REC.find(i=>i.id===id)).filter(Boolean).filter(i=>!recActive(i)&&!recRemoved(i));
  if(!items.length){toast('Only lines that are already Gone can be removed — mark them Gone first','er');return;}
  for(const i of items){i.archived=true;await recSave(i,'Removed','off the page — still in the audit log');}
  _recSel.clear();if(items.some(i=>i.id===_recOpen))_recOpen=null;
  toast(`${fmt(items.length)} line${items.length===1?'':'s'} removed — “show removed” at the bottom brings them back`,'ok');
  renderRecovery();
}

/* ── move / split ──────────────────────────────────────────────────────────── */
let _recMoveId=null;
function recMoveModal(ids){
  _recMoveId=ids.length===1?ids[0]:null;
  const items=ids.map(id=>REC.find(i=>i.id===id)).filter(Boolean);if(!items.length)return;
  const one=items.length===1?items[0]:null;
  const known=Object.keys(recLocCounts().m).sort();
  const dl=`<datalist id="recLocList2">${known.map(l=>`<option value="${esc(l)}">`).join('')}</datalist>`;
  if(one){
    const ls=recLocs(one).length?recLocs(one):[{loc:'',qty:recQty(one)}];
    recModal(`<h3>Move / split — ${esc(one.name)}</h3><div class="sub">${fmt(recQty(one))} units in total. Split across racks or move the lot — the quantities must add up.</div>
      <div id="recSplitRows">${ls.map((l,n)=>`<div class="recF" style="grid-template-columns:1fr 90px 34px;margin-bottom:6px"><input list="recLocList2" class="recSpL" value="${esc(l.loc)}" placeholder="REC-A1"><input type="number" min="0" class="recSpQ" value="${l.qty}"><button class="recBtn sm" onclick="this.parentElement.remove();recSplitSum()">&#10005;</button></div>`).join('')}</div>${dl}
      <button class="recBtn sm" onclick="recSplitAdd()">+ another rack</button>
      <div class="recHint" id="recSplitSum"></div>
      <div class="foot"><button class="recBtn" onclick="recModalClose()">Cancel</button><button class="recBtn pri" onclick="recMoveGo('${one.id}')">Save locations</button></div>`);
    recSplitSum();
  }else{
    recModal(`<h3>Move ${fmt(items.length)} items</h3><div class="sub">Every selected item moves in full to one rack.</div>
      <div class="recF"><label>New location</label><input id="recMoveTo" list="recLocList2" placeholder="REC-A1"></div>${dl}
      <div class="foot"><button class="recBtn" onclick="recModalClose()">Cancel</button><button class="recBtn pri" onclick="recBulkMoveGo(${JSON.stringify(ids)})">Move</button></div>`);
  }
}
function recSplitAdd(){const h=document.getElementById('recSplitRows');if(!h)return;h.insertAdjacentHTML('beforeend',`<div class="recF" style="grid-template-columns:1fr 90px 34px;margin-bottom:6px"><input list="recLocList2" class="recSpL" placeholder="REC-A2"><input type="number" min="0" class="recSpQ" value="0" oninput="recSplitSum()"><button class="recBtn sm" onclick="this.parentElement.remove();recSplitSum()">&#10005;</button></div>`);
  h.querySelectorAll('.recSpQ').forEach(q=>q.oninput=recSplitSum);recSplitSum();}
function recSplitSum(){
  const i=REC.find(x=>x.id===_recMoveId);
  const qs=[...document.querySelectorAll('.recSpQ')].map(x=>parseInt(x.value)||0);
  const total=qs.reduce((a,b)=>a+b,0);
  const el=document.getElementById('recSplitSum');
  document.querySelectorAll('.recSpQ').forEach(q=>q.oninput=recSplitSum);
  if(!el)return;
  const target=i?recQty(i):null;
  el.innerHTML=target==null?'':(total===target?`<span style="color:#4ade80">&#10003; ${fmt(total)} of ${fmt(target)} placed</span>`:`<span style="color:#fbbf24">${fmt(total)} placed — item holds ${fmt(target)}. ${total<target?'The rest will be "no rack".':'That is more than exists — it will be capped.'}</span>`);
}
async function recMoveGo(id){
  const i=REC.find(x=>x.id===id);if(!i)return;
  const rowsEl=[...document.querySelectorAll('#recSplitRows .recF')];
  let locs=rowsEl.map(r=>({loc:recNormLoc(r.querySelector('.recSpL').value),qty:parseInt(r.querySelector('.recSpQ').value)||0})).filter(l=>l.loc&&l.qty>0);
  const total=recQty(i);let placed=locs.reduce((a,l)=>a+l.qty,0);
  if(placed>total){let over=placed-total;for(let k=locs.length-1;k>=0&&over>0;k--){const t=Math.min(over,locs[k].qty);locs[k].qty-=t;over-=t;}locs=locs.filter(l=>l.qty>0);}
  const prev=recLocStr(i);i.locations=locs;
  recModalClose();
  await recSave(i,'Location moved',`${prev||'no rack'} → ${recLocStr(i)||'no rack'}`,prev,recLocStr(i));
  renderRecovery();
}
async function recBulkMoveGo(ids){
  const to=recNormLoc((document.getElementById('recMoveTo')||{}).value);if(!to){toast('Type a location','er');return;}
  recModalClose();let n=0;
  for(const id of ids){const i=REC.find(x=>x.id===id);if(!i)continue;const prev=recLocStr(i);i.locations=[{loc:to,qty:recQty(i)}];await recSave(i,'Location moved',`${prev||'no rack'} → ${to}`,prev,to);n++;}
  toast(`${n} item${n===1?'':'s'} moved to ${to}`,'ok');_recSel.clear();renderRecovery();
}

async function recBulkStatus(s){for(const id of [..._recSel]){const i=REC.find(x=>x.id===id);if(!i||!recActive(i)||i.status===s)continue;const p=i.status;i.status=s;await recSave(i,'Status changed','',REC_STATUS[p][0],REC_STATUS[s][0]);}_recSel.clear();renderRecovery();}
async function recBulkChannel(ch,add){for(const id of [..._recSel]){const i=REC.find(x=>x.id===id);if(!i)continue;const chs=recChs(i);const at=chs.findIndex(c=>c.ch===ch);
  if(add&&at<0){chs.push({ch,ref:'',url:'',date:recNow(),note:''});i.channels=chs;if(i.status==='here'){i.status='listed';i.listed_at=i.listed_at||recNow();}await recSave(i,'Channel added',ch);}
  else if(!add&&at>=0){chs.splice(at,1);i.channels=chs;await recSave(i,'Channel removed',ch);}}_recSel.clear();renderRecovery();}
function recNoteModal(ids){recModal(`<h3>Add a note to ${fmt(ids.length)} item${ids.length===1?'':'s'}</h3><div class="recF"><label>Note</label><textarea id="recNoteTxt" placeholder="appended to each item's notes"></textarea></div>
  <div class="foot"><button class="recBtn" onclick="recModalClose()">Cancel</button><button class="recBtn pri" onclick="recNoteGo(${JSON.stringify(ids)})">Add note</button></div>`);}
async function recNoteGo(ids){const t=((document.getElementById('recNoteTxt')||{}).value||'').trim();if(!t)return;recModalClose();
  for(const id of ids){const i=REC.find(x=>x.id===id);if(!i)continue;i.notes=(i.notes?i.notes+' · ':'')+t;await recSave(i,'Note added',t);}_recSel.clear();renderRecovery();}
async function recArchive(ids){
  const items=ids.map(id=>REC.find(i=>i.id===id)).filter(Boolean).filter(recActive);if(!items.length)return;
  if(!confirm(`Archive ${items.length} item${items.length===1?'':'s'}?\n\nThey leave the active list but keep every record. You can bring them back.`))return;
  for(const i of items){i.status='archived';i.archived=true;await recSave(i,'Archived','');}
  _recSel.clear();if(items.some(i=>i.id===_recOpen))_recOpen=null;renderRecovery();
}
async function recUnarchive(id){const i=REC.find(x=>x.id===id);if(!i)return;i.archived=false;i.status='here';i.gone_at=null;i.gone_how='';if(recQty(i)===0)i.qty=parseInt(i.gone_qty)||1;await recSave(i,'Brought back to stock','');renderRecovery();}
async function recDelete(id){
  if(!/^jack/i.test(String(window.currentUserName||''))){toast('Only Jack can delete permanently','er');return;}
  const i=REC.find(x=>x.id===id);if(!i)return;
  const typed=prompt(`PERMANENT DELETE — this cannot be undone and is only for genuine mistakes (a wrong row typed in). Archive instead for anything real.\n\nType DELETE to confirm removing "${i.name}".`);
  if(typed!=='DELETE')return;
  try{logAudit('Recovery: PERMANENT DELETE',`${i.name} (${i.id_value||'no id'}) · ${fmt(recQty(i))} units · by ${_who()}`);}catch(e){}
  try{await sb.from('recovery_items').delete().eq('id',id);}catch(e){}
  REC=REC.filter(x=>x.id!==id);_recOpen=null;toast('Deleted — an audit line records it','ok');renderRecovery();
}
function recExport(){
  const list=recFiltered();
  const cols=['Product','ID type','Identifier','Qty','Locations','Condition','Condition notes','Cost/unit','Cost value','State','Gone how','Gone on','Listed on','Channel refs','Date added','Age (days)','Last action','Days since action','Source','Notes'];
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const lines=[cols.join(',')].concat(list.map(i=>[i.name,i.id_type,i.id_value,recQty(i)||i.gone_qty||0,recLocStr(i),i.condition,i.condition_notes,i.cost==null?'':i.cost,((recQty(i)||i.gone_qty||0)*(i.cost||0)).toFixed(2),
    (REC_STATUS[i.status]||[''])[0],REC_GONE_HOW[recGoneHow(i)]||'',i.gone_at?recDay(i.gone_at):'',recChs(i).map(c=>c.ch).join(' | '),recChs(i).map(c=>c.ref||c.url).filter(Boolean).join(' | '),recDay(i.created_at),recDays(i.created_at),i.last_action,recDays(i.last_action_at),i.source,i.notes].map(q).join(',')));
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='Recovery-Stock-'+(_recTab==='all'?'all':_recTab)+'-'+todayISO()+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  toast(`Exported ${fmt(list.length)} rows`,'ok');
}

function _parkedOnDate(r){
  const v=r&&r.expectedDelivery;if(!v||!saneDate(v))return false;
  const t=new Date();t.setHours(0,0,0,0);return new Date(v)>t;
}
function jackTodo(){
  /* No !archived guard on the decisions: a row archived by some other path is
     still a decision he owes an answer to, and hiding it was how items got
     stuck with nobody able to act. Quantity fixes keep the guard — those are a
     read-only digest, not work. */
  const closures=rows.filter(r=>r.resolution&&r.resolution.state==='proposed');
  /* Jack, 7 Sep: "it should clear off both mine and Sarah's sheet, with the
     date on the Prep Sheet." A promised date that has not passed parks the
     row — however the date got there. It returns by itself if it slips. */
  const checks=rows.filter(r=>r.resolution&&r.resolution.state==='asked'&&!_parkedOnDate(r)
    &&!(r.resolution.chase&&r.resolution.chase.step==='due-date'&&r.expectedDelivery)   /* a slipped date is Sarah's chase, not his question */
    &&!(typeof _rowOwner==='function'&&_rowOwner(r).finished));   /* v50.5: the one owner rule */
  /* Jack, 5 Sep: qty fixes are read-and-wave-through — they vanish on their
     own after a week so they cannot pile up */
  const fixes=rows.filter(r=>!r.archived&&r.qtyFix&&!r.qtyFix.seen&&!/^jack/i.test(String(r.qtyFix.by||''))&&(Date.now()-new Date(r.qtyFix.at||0).getTime())<7*864e5);
  /* The other half of the round trip Jack demanded fixed: claims Sarah sends
     over and Lavarion shortages she hands across land HERE — before this they
     fell off her page and never appeared on his. Same issue, his side. */
  const claimsQ=claims.filter(c=>!c.archived&&c.cst!=='Resolved'
    &&(((c.owner)||('VA'))==='Jack')
    /* already sitting in Recovery Stock under this order = dealt with */
    &&!((c.issT||'')==='Gated'&&c.oid&&typeof REC!=='undefined'&&Array.isArray(REC)
        &&REC.some(i=>!i.archived&&i.source==='Gated Amazon stock'&&String(i.source_ref||'').trim()===String(c.oid).trim())));
  /* Jack, 10 Sep: "everything Lavarion comes to me first, then I send it to
     Sarah if and when I need to" — shortages and damage at check-in included. */
  let lavQ=[];try{lavQ=(_lavIssues(true)||[]).filter(g=>!g.quiet&&!lavCleared()[String(g.key)]&&!g.toSarah);}catch(e){}
  /* Jack, 5 Sep: "refund processed = done, I watch the bank myself." The
     waiting-to-land list is gone. What stays is the JOB: an Amazon order Sarah
     closed as never-arrived, whose refund only he can raise in the account. */
  /* Jack, 7 Sep: "idk why this got sent to me, it's Argos" — only an Amazon
     account refund is his to raise; a supplier refund is Sarah's road. */
  /* Jack, 9 Sep: "for Lavarion stuff get it to come straight to me first and
     I can send to Sarah if I need her to do a job for it." So every late
     Lavarion order is his from the moment it is late; only the ones he has
     handed her with a note are off his list. */
  let lavLate=[];try{lavLate=((window.LV3&&LV3.lavLateList)?LV3.lavLateList():[]).filter(g=>!g.toSarah);}catch(e){}
  return{closures,checks,fixes,claimsQ,lavQ,lavLate,owed:moneyOwed().filter(o=>_amazonRow(o.r)&&!o.q.moneyOff&&((o.q.what==='no-refund'&&!o.q.refundRaised)||(o.q.what==='refund-done'&&o.q.refundRaised))),
    n:closures.length+checks.length+fixes.length+claimsQ.length+lavQ.length+lavLate.length};
}
