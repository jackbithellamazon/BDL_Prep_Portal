/* BDL PrepHub — js/audit-ean.js — Audit log page, Keepa EAN lookup.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── AUDIT LOG (persisted to Supabase · paginated · filtered) ──────────────────
// Each entry is saved to the audit_log table so it survives refresh and is
// shared across all 3 laptops. The page loads only ~50 at a time, so the table
// can hold millions of rows without the browser ever slowing down.
let audit=[];                 // entries currently loaded into the page
let _auditOffset=0;           // how many rows pulled from the DB so far
let _auditHasMore=true;       // is there an older page to load?
let _auditLoading=false;
let _auditFirstLoad=false;    // have we loaded from the DB at least once?
const AUDIT_PAGE=50;
const _auditFilters={user:'all',type:'all',range:'all',q:''};

// Record an action: show it instantly AND save it to Supabase in the background.
/* ── KEEPA EAN LOOKUP ───────────────────────────────────────────────────────
   Fetches a product's EAN from its ASIN via Keepa. Keepa blocks direct browser
   calls (CORS) AND your API key must never live in this downloadable file, so
   the call routes through a Supabase edge function ("keepa-ean") that holds the
   key server-side and returns { ean }. Marketplace → Keepa domain id mapping:
   UK=2, DE=3, FR=4, IT=8, ES=9, US=1. */
const _KEEPA_DOMAIN={'Amazon UK':2,'Amazon Germany':3,'Amazon France':4,'Amazon Italy':8,'Amazon Spain':9,'Amazon US':1};
async function _keepaEan(asin,acct){
  if(!asin)return null;
  const domain=_KEEPA_DOMAIN[acct]||2;
  /* Send the SIGNED-IN USER's token, not the anon key. The anon key sits in
     this file in a public repo, so anything accepting it is open to anyone who
     finds the page — they could not read the Keepa key, but they could spend
     the tokens. The user's token proves it is one of the real logins, and the
     function checks that before it will spend anything. */
  let tok=SUPA_KEY;
  try{const{data}=await sb.auth.getSession();
      if(data&&data.session&&data.session.access_token)tok=data.session.access_token;}catch(e){}
  const r=await fetch(`${SUPA_URL}/functions/v1/keepa-ean?asin=${encodeURIComponent(asin)}&domain=${domain}`,
    {cache:'no-store',headers:{'Authorization':`Bearer ${tok}`,'apikey':SUPA_KEY}});
  if(r.status===401||r.status===403)throw new Error('not allowed — sign in with an approved account');
  if(!r.ok)throw new Error('lookup failed ('+r.status+')');
  const j=await r.json();
  if(j.error)throw new Error(j.error);
  return j.ean||null;
}
// Fill EAN for one row (used from the row editor and on new rows).
async function _editorFetchEan(){
  const asin=(document.getElementById('f-asin')||{}).value.trim();
  const acct=(document.getElementById('f-acct')||{}).value||'';
  if(!asin){toast('Enter the ASIN first','er');return;}
  toast('Looking up EAN…');
  try{const ean=await _keepaEan(asin,acct);
    if(ean){document.getElementById('f-ean').value=ean;toast('EAN: '+ean);}
    else toast('No EAN on Keepa for '+asin,'er');
  }catch(e){toast('Keepa: '+e.message,'er');}
}
async function fetchRowEan(r,silent){
  if(!r||!r.asin){if(!silent)toast('No ASIN on this row','er');return;}
  try{
    const ean=await _keepaEan(r.asin,r.acct);
    if(ean){r.ean=ean;await saveRow(r);renderPrep();if(!silent)toast('EAN found: '+ean);logAudit('EAN fetched (Keepa)',r.asin+' → '+ean);}
    else if(!silent)toast('No EAN on Keepa for '+r.asin,'er');
  }catch(e){if(!silent)toast('Keepa: '+e.message,'er');}
}
// Backfill every row missing an EAN — throttled so we stay under Keepa tokens.
let _eanBackfillRunning=false;
async function backfillEans(){
  if(_eanBackfillRunning){toast('Backfill already running');return;}
  const todo=rows.filter(r=>!r.archived&&r.asin&&!r.ean);
  if(!todo.length){toast('Every row already has an EAN ✓');return;}
  /* This looped once per ROW, so an ASIN sitting on twenty rows was twenty
     Keepa tokens for one answer — on the live sheet, 253 rows for only 136
     distinct products. A barcode belongs to the ASIN, not to one purchase, so
     ask once per ASIN and paint the answer across every row that shares it.
     The auto-fetch path already worked this way; this one did not. */
  const byAsin={};
  todo.forEach(r=>{(byAsin[r.asin]=byAsin[r.asin]||[]).push(r);});
  const asins=Object.keys(byAsin);
  const saved=todo.length-asins.length;
  if(!confirm(`Look up barcodes for ${asins.length} product${asins.length===1?'':'s'}?\n\n`
    +`${todo.length} row${todo.length===1?'':'s'} are missing one, but they are only ${asins.length} different `
    +`ASIN${asins.length===1?'':'s'} — so this costs about ${asins.length} Keepa token${asins.length===1?'':'s'}`
    +`${saved>0?`, not ${todo.length}. ${saved} lookup${saved===1?'':'s'} saved.`:'.'}`))return;
  _eanBackfillRunning=true;
  let ok=0,fail=0,free=0,rowsFilled=0;
  for(let i=0;i<asins.length;i++){
    const asin=asins[i], group=byAsin[asin];
    toast(`Barcodes… ${i+1}/${asins.length}`);
    /* it may already be answered on a row we have not looked at — free */
    let ean=_eanFromRows(asin);
    if(ean)free++;
    else{
      try{ean=await _keepaEan(asin,group[0].acct);if(ean)ok++;else fail++;}
      catch(e){fail++;if(/429|token|not allowed/i.test(e.message)){
        toast('Keepa stopped: '+e.message+' — run again later.','er');break;}}
      await new Promise(res=>setTimeout(res,350)); // gentle on the token bucket
    }
    if(ean)for(const r of group){r.ean=ean;r._srch=null;await saveRow(r);rowsFilled++;}
  }
  _eanBackfillRunning=false;renderPrep();
  toast(`Barcodes done — ${rowsFilled} row${rowsFilled===1?'':'s'} filled from ${ok} lookup${ok===1?'':'s'}`
    +`${free?`, ${free} free from ones we already knew`:''}${fail?`, ${fail} had none`:''} ✓`);
  logAudit('EAN backfill (Keepa)',`${asins.length} ASINs asked, ${ok} fetched, ${free} cached, ${rowsFilled} rows filled`);
}

/* ── AUTO-EAN — fetch & cache EANs from Keepa automatically ──────────────────
   New rows fetch their EAN once, the moment they're added (manual add + sheet
   sync). ASIN→EAN is reused across rows for free, so each ASIN costs at most one
   Keepa token ever. Token-aware, throttled, and toggleable in Settings. */
let _autoEan=true,_autoEanStop=false,_autoEanSweeping=false;
const _eanTried=new Set();
(async function(){try{const r=await sb.from('app_settings').select('value').eq('key','keepa_autofill').maybeSingle();
  if(r&&r.data&&r.data.value!=null)_autoEan=(r.data.value!=='0'&&r.data.value!=='false');
  const cb=document.getElementById('autoEanToggle');if(cb)cb.checked=_autoEan;}catch(e){}})();
function setAutoEan(on){_autoEan=!!on;_autoEanStop=false;
  try{sb.from('app_settings').upsert({key:'keepa_autofill',value:_autoEan?'1':'0'},{onConflict:'key'}).then(r=>{if(r&&r.error)console.warn('autoEan save',r.error);});}catch(e){}
  toast(_autoEan?'Auto-EAN on — new rows fetch their EAN automatically':'Auto-EAN off');}
function _eanFromRows(asin){if(!asin)return null;const hit=rows.find(x=>x.asin===asin&&x.ean&&String(x.ean).trim());return hit?String(hit.ean).trim():null;}
async function ensureRowEan(r){try{
  /* Mid-gap the EAN might sit on an archived row we have not merged yet —
     asking Keepa now would spend tokens on an answer we already own. Park it;
     finalize drains the queue through this same cache-first path. */
  if(!_historyReady){if(_pendingEan.indexOf(r)<0)_pendingEan.push(r);return;}
  if(!r||!r.asin||(r.ean&&String(r.ean).trim()))return;
  const cached=_eanFromRows(r.asin);
  if(cached){r.ean=cached;await saveRow(r);renderPrep();return;}
  if(!_autoEan||_autoEanStop)return;
  const ean=await _keepaEan(r.asin,r.acct);
  if(ean){r.ean=ean;await saveRow(r);renderPrep();logAudit('EAN auto (Keepa)',r.asin+' → '+ean);}
  else _eanTried.add(r.asin);
}catch(e){if(/429|token/i.test(e.message||''))_autoEanStop=true;}}
async function autoEanSweep(quiet){
  /* Every reason this could not run used to be a silent return, so "Keepa did
     not pull the EAN" had no answer on screen. Say which one it was. */
  if(!_historyReady)return;                       // it will run again once loaded
  if(_autoEanSweeping)return;
  const todo=rows.filter(r=>!r.archived&&r.asin&&!(r.ean&&String(r.ean).trim()));
  if(!todo.length)return;
  if(!_autoEan){if(!quiet)toast(`${todo.length} row${todo.length===1?'':'s'} have no barcode — auto-fetch is switched off in Settings`,'er');return;}
  if(_autoEanStop){if(!quiet)toast('Keepa stopped earlier this session — reload the page to try again','er');return;}
  _autoEanSweeping=true;let n=0;
  try{for(const r of todo){
    const cached=_eanFromRows(r.asin);
    if(cached){r.ean=cached;await saveRow(r);n++;continue;}
    if(_eanTried.has(r.asin))continue;
    try{const ean=await _keepaEan(r.asin,r.acct);
      if(ean){r.ean=ean;await saveRow(r);n++;logAudit('EAN auto (Keepa)',r.asin+' → '+ean);}else _eanTried.add(r.asin);}
    catch(e){if(/429|token/i.test(e.message||'')){_autoEanStop=true;break;}_eanTried.add(r.asin);}
    await new Promise(res=>setTimeout(res,350));
  }}finally{_autoEanSweeping=false;if(n)renderPrep();}
}

function logAudit(act,det){
  const e={user_id:cu.id,user_name:cu.name,user_role:cu.role,user_init:cu.init,user_col:cu.col,
           action:act,detail:det||'',created_at:new Date().toISOString()};
  audit.unshift(e); // instant local display
  if(document.getElementById('page-audit')?.classList.contains('active'))renderAudit();
  // Persist (fire-and-forget — never blocks the UI).
  sb.from('audit_log').insert({
    user_id:e.user_id,user_name:e.user_name,user_role:e.user_role,user_init:e.user_init,
    user_col:e.user_col,action:e.action,detail:e.detail,created_at:e.created_at
  }).then(({error})=>{if(error)console.warn('audit save:',error.message);});
}

// Pull one page of history from Supabase using the current filters.
async function loadAuditPage(reset){
  if(_auditLoading)return;
  _auditLoading=true;
  if(reset){_auditOffset=0;_auditHasMore=true;audit=[];}
  try{
    let q=sb.from('audit_log').select('*').order('created_at',{ascending:false});
    const f=_auditFilters;
    if(f.user!=='all')q=q.eq('user_id',f.user);
    if(f.type!=='all')q=q.ilike('action','%'+f.type+'%');
    if(f.range!=='all'){
      const days=f.range==='today'?1:(f.range==='7d'?7:30);
      q=q.gte('created_at',new Date(Date.now()-days*864e5).toISOString());
    }
    if(f.q){const s=f.q.replace(/[%,()]/g,' ');q=q.or(`action.ilike.%${s}%,detail.ilike.%${s}%`);}
    q=q.range(_auditOffset,_auditOffset+AUDIT_PAGE-1);
    const {data,error}=await q;
    if(error)throw error;
    audit=audit.concat(data||[]);
    _auditOffset+=(data||[]).length;
    _auditHasMore=(data||[]).length===AUDIT_PAGE;
    _auditFirstLoad=true;
  }catch(e){console.warn('audit load:',e.message);}
  _auditLoading=false;
  renderAudit();
}

function setAuditFilter(kind,val){_auditFilters[kind]=val;loadAuditPage(true);}
let _auditSearchT=null;
function onAuditSearch(v){_auditFilters.q=v.trim();clearTimeout(_auditSearchT);_auditSearchT=setTimeout(()=>loadAuditPage(true),250);}

// Populate the "person" filter from whoever actually appears in recent history,
// so new seats show up automatically with no code changes.
async function buildAuditSeatFilter(){
  const sel=document.getElementById('auditFilterUser');
  if(!sel)return;
  try{
    const {data}=await sb.from('audit_log').select('user_id,user_name,user_role')
      .order('created_at',{ascending:false}).limit(2000);
    const seen=new Map();
    (data||[]).forEach(r=>{if(r.user_id&&!seen.has(r.user_id))seen.set(r.user_id,r.user_name||r.user_id);});
    const cur=sel.value;
    sel.innerHTML='<option value="all">All people</option>'+
      [...seen.entries()].sort((a,b)=>a[1].localeCompare(b[1]))
        .map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
    if([...sel.options].some(o=>o.value===cur))sel.value=cur;
  }catch(e){/* leave the default option */}
}

function _auditDayLabel(iso){
  const d=new Date(iso),now=new Date();
  const diff=Math.round((new Date(now.getFullYear(),now.getMonth(),now.getDate())
    -new Date(d.getFullYear(),d.getMonth(),d.getDate()))/864e5);
  if(diff===0)return'Today';
  if(diff===1)return'Yesterday';
  return d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});
}

function renderAudit(){
  const host=document.getElementById('auditList');
  if(!host)return;
  const lm=document.getElementById('auditLoadMore');
  const ct=document.getElementById('auditCount');
  if(!_auditFirstLoad&&audit.length===0){host.innerHTML='<div class="audit-empty">Loading…</div>';if(lm)lm.style.display='none';return;}
  if(audit.length===0){host.innerHTML='<div class="audit-empty">No matching activity.</div>';if(lm)lm.style.display='none';if(ct)ct.textContent='0 shown';return;}
  // ── Group consecutive same-person + same-action runs (within a day) ──
  // Bulk operations write dozens of near-identical lines; one collapsed row
  // per run ("Bulk All Shipped × 5 ▸") keeps the log scannable. Click expands.
  window._auditOpen=window._auditOpen||new Set();
  const _t=x=>new Date(x.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  // Colour-code the action by what kind of thing happened — the chip colour is
  // scannable long before the words are.
  const _actCol=act=>{a=String(act).toLowerCase();
    if(/delete|removed|wipe|clear/.test(a))return '#f87171';
    if(/issue|claim|gated|chase|escalat/.test(a))return '#fb923c';
    if(/sent|ship|transit|part sent/.test(a))return '#60a5fa';
    if(/added|created|new |bulk-added|reorder|stocktake|deliver/.test(a))return '#4ade80';
    if(/status|revert|review/.test(a))return '#fbbf24';
    if(/sync|backup|setting|matrix|rate/.test(a))return '#94a3b8';
    return '#8b9bb3';};
  // ONE line per event: time · initial · name · action chip · detail.
  // ~26px tall instead of ~52px — half the scroll, and columns align so the
  // eye runs straight down.
  const _row=a=>{
    const col=a.user_col||'#f59e0b';const ac=_actCol(a.action);
    return `<div class="audit-r" title="${esc(a.detail||'')}${a.user_role?' · '+esc(a.user_role):''}">
      <span class="audit-r-t">${_t(a)}</span>
      <span class="audit-r-av" style="background:${col}22;color:${col};">${esc(a.user_init||'?')}</span>
      <span class="audit-r-n" style="color:${col};">${esc(a.user_name||'Unknown')}</span>
      <span class="audit-r-a" style="color:${ac};background:${ac}14;border-color:${ac}38;">${esc(a.action)}</span>
      <span class="audit-r-d">${esc(a.detail||'')}</span>
    </div>`;
  };
  // build day-aware runs
  const runs=[];
  for(const a of audit){
    const day=_auditDayLabel(a.created_at);
    const last=runs[runs.length-1];
    if(last&&last.day===day&&last.user===(a.user_name||'?')&&last.action===a.action)last.items.push(a);
    else runs.push({day,user:a.user_name||'?',action:a.action,items:[a]});
  }
  let html='',lastDay=null;
  runs.forEach((r,ri)=>{
    if(r.day!==lastDay){
      const dayCount=runs.filter(x=>x.day===r.day).reduce((n,x)=>n+x.items.length,0);
      const people=[...new Set(runs.filter(x=>x.day===r.day).map(x=>x.user))].length;
      html+=`<div class="audit-day">${r.day} <span style="font-weight:500;color:var(--text3);font-size:10px;">· ${dayCount} event${dayCount===1?'':'s'} · ${people} ${people===1?'person':'people'}</span></div>`;
      lastDay=r.day;
    }
    if(r.items.length<3){html+=r.items.map(_row).join('');return;}
    // collapsed group row
    const a0=r.items[0],aN=r.items[r.items.length-1];
    const col=a0.user_col||'#f59e0b';
    const open=window._auditOpen.has('g'+ri);
    const span=_t(aN)===_t(a0)?_t(a0):`${_t(aN)}–${_t(a0)}`;
    const ac=_actCol(r.action);
    html+=`<div class="audit-r" onclick="(function(){const s=window._auditOpen;s.has('g${ri}')?s.delete('g${ri}'):s.add('g${ri}');renderAudit();})()" style="cursor:pointer;" title="Click to ${open?'collapse':'expand'} all ${r.items.length}">
      <span class="audit-r-t">${span}</span>
      <span class="audit-r-av" style="background:${col}22;color:${col};">${esc(a0.user_init||'?')}</span>
      <span class="audit-r-n" style="color:${col};">${esc(r.user)}</span>
      <span class="audit-r-a" style="color:${ac};background:${ac}14;border-color:${ac}38;">${esc(r.action)}</span>
      <span class="audit-r-d"><span style="font-weight:800;color:${ac};">× ${r.items.length}</span> <span style="color:var(--text3);">${open?'▾ collapse':'▸ expand'}</span></span>
    </div>`;
    if(open)html+=`<div style="border-left:2px solid ${ac}44;margin-left:9px;">${r.items.map(_row).join('')}</div>`;
  });
  host.innerHTML=html;
  if(ct)ct.textContent=audit.length+' shown'+(_auditHasMore?'+':'');
  if(lm)lm.style.display=_auditHasMore?'block':'none';
}
