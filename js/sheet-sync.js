/* BDL PrepHub — js/sheet-sync.js — Purchase Sheet import + sheet sync engine, config, settings UI, leader, timer, issues, sources, health.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── PURCHASE SHEET IMPORT ─────────────────────────────────────────────────────
const SHEET_ID='1IG0BM8f2RIODPbUXu7hoXIUbqXTF2amCYCT5InZvMqU';
const SHEET_TAB='Q2 AMZ - OA';
const SHEET_CSV=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

let _importPending=[]; // rows fetched, waiting for user to confirm

function openImport(){
  _importPending=[];
  document.getElementById('importStep1').style.display='block';
  document.getElementById('importStep2').style.display='none';
  document.getElementById('importStatus').textContent='';
  document.getElementById('importCsvFile').value='';
  om('importModal');
}

function handleImportCSV(input){
  const file=input.files[0];
  if(!file)return;
  const status=document.getElementById('importStatus');
  status.textContent='Reading file…';
  status.style.color='var(--text3)';
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const csv=e.target.result;
      const parsed=parseCSV(csv);
      processImportRows(parsed);
    }catch(err){
      console.error('Import error:',err);
      status.textContent='❌ Error: '+err.message;
      status.style.color='var(--red)';
    }
  };
  reader.onerror=e=>{
    console.error('FileReader error:',e);
    status.textContent='❌ Could not read file.';
    status.style.color='var(--red)';
  };
  reader.readAsText(file);
}

function parseCSV(csv){
  csv=csv.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines=csv.split('\n');
  const headers=parseCSVLine(lines[0]);
  const result=[];
  for(let i=1;i<lines.length;i++){
    if(!lines[i].trim())continue;
    const cols=parseCSVLine(lines[i]);
    if(cols.length<2)continue;
    const row={};
    headers.forEach((h,idx)=>{row[h.trim()]=(cols[idx]||'').trim();});
    row._csvLine=i+1; // actual sheet row number (1-indexed, +1 for header)
    result.push(row);
  }
  return result;
}

function parseCSVLine(line){
  const result=[];
  let cur='',inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(inQ&&line[i+1]==='"'){cur+='"';i++;}
      else{inQ=!inQ;}
    }else if(ch===','&&!inQ){
      result.push(cur.trim());cur='';
    }else{
      // Skip bare \r inside fields
      if(ch!=='\r')cur+=ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function processImportRows(parsed){
  if(histGate())return;
  const status=document.getElementById('importStatus');

  // Existing SKUs in PrepHub — for dupe check
  const existingSkus=new Set(rows.map(r=>r.sku.trim().toLowerCase()));

  // Filter: Added To Home Prep Portal = Yes, Location = Home, not already imported
  _importPending=parsed.filter(row=>{
    const colW=(row['Added To Home Prep Portal']||row['Added To Home Sheet']||row['Added to Home Sheet']||'').trim();
    const sku=(row['SKU']||'').trim();
    const location=(row['Location']||'').trim();
    if(!sku)return false;
    if(colW.toLowerCase()!=='yes')return false;
    if(location.toLowerCase()!=='home')return false;
    if(existingSkus.has(sku.toLowerCase()))return false;
    return true;
  });

  if(!_importPending.length){
    status.textContent='✓ No new rows to import — everything is up to date.';
    status.style.color='var(--green)';
    return;
  }

  status.textContent=`Found ${_importPending.length} pending row${_importPending.length!==1?'s':''}.`;
  status.style.color='var(--green)';

  // Build preview table
  const body=document.getElementById('importPreviewBody');
  body.innerHTML=_importPending.map((row,i)=>{
    const sku=row['SKU']||'';
    const prod=row['Name']||'';
    const date=row['Date']||'';
    const sup=row['Bought From']||'';
    const qty=row['Quantity Bought']||row['Quanity Bought *']||'';
    const cost=row['Buy Price']||'';
    const dg=row['DG']||'';
    const prodShort=prod.length>45?prod.substring(0,42)+'…':prod;
    return`<tr>
      <td style="text-align:center;padding:5px 8px;"><input type="checkbox" class="import-check" data-idx="${i}" onchange="updateImportCount()" checked></td>
      <td class="td-left" style="padding:5px 8px;font-family:var(--mono);font-size:11px;color:var(--accent);">${sku}</td>
      <td class="td-left" style="padding:5px 8px;font-size:10px;" title="${prod}">${prodShort}</td>
      <td style="padding:5px 8px;font-size:10px;">${date}</td>
      <td style="padding:5px 8px;font-size:10px;">${sup}</td>
      <td style="padding:5px 8px;font-family:var(--mono);font-weight:700;color:var(--blue);">${qty}</td>
      <td style="padding:5px 8px;font-family:var(--mono);font-weight:700;color:var(--amber);">£${cost}</td>
      <td style="padding:5px 8px;font-size:10px;color:${dg==='Yes'?'var(--red)':'var(--text3)'};">${dg||'—'}</td>
      <td style="padding:5px 8px;font-size:10px;font-weight:700;color:#c084fc;">${row['Account']||'—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('importPreviewHeader').innerHTML=
    `<strong style="color:var(--text);">${_importPending.length} rows ready to import</strong> — all pre-checked. Untick any you don't want.`;
  updateImportCount();

  document.getElementById('importStep1').style.display='none';
  document.getElementById('importStep2').style.display='block';
  document.getElementById('importSelectAll').checked=true;
}

function toggleImportAll(checked){
  document.querySelectorAll('.import-check').forEach(c=>c.checked=checked);
  updateImportCount();
}

function updateImportCount(){
  const n=document.querySelectorAll('.import-check:checked').length;
  document.getElementById('importSelectedCount').textContent=n+' row'+( n!==1?'s':'')+' selected';
}

function confirmImport(){
  const selected=Array.from(document.querySelectorAll('.import-check:checked'))
    .map(c=>parseInt(c.dataset.idx));

  if(!selected.length){toast('No rows selected','er');return;}

  let imported=0;
  const newRows=[];
  selected.forEach(idx=>{
    const row=_importPending[idx];
    if(!row)return;

    const sku=(row['SKU']||'').trim();
    const dateRaw=(row['Date']||'').trim(); // DD/MM/YYYY
    const dateParts=dateRaw.split('/');
    const dateFormatted=dateParts.length===3?`${dateParts[0]}/${dateParts[1]}`:'';

    // Parse qty — use Total Units if available, else Quantity Bought
    const qty=_sheetQty(row);
    const bunVal=(row['In a Bundle?']||'No').trim();
    const bqtyVal=(row['How Many In a Bundle?']||'').trim();

    const newRow={
      uuid:(window.crypto&&crypto.randomUUID?crypto.randomUUID():undefined),
      _minted:!!(window.crypto&&crypto.randomUUID),
      id:++nid,
      date:dateFormatted,
      oid:(row['Order Id']||row['Order ID']||'').trim(),
      sup:(row['Bought From']||'').trim(),
      acct:(row['Account']||'').trim(),
      prod:(row['Name']||'').trim(),
      asin:(row['Asin']||row['ASIN']||'').trim(),
      sku:sku,
      dg:(row['DG']||'').trim(),
      sas:`https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${(row['Asin']||row['ASIN']||'').trim()}`,
      exp:sellableExp(qty,bunVal,bqtyVal),
      aqty:parseInt(row['Quanity Bought *']||row['Quantity Bought']||row['Quanity Bought']||1)||1,
      bun:bunVal,
      bqty:bqtyVal,
      subSave:(row['S&S (AC)']||'No').trim()==='Yes'?'Yes':'No',
      rcvd:0,
      issueType:'',
      issueQty:0,
      status:'In-Transit',
      ship:0,
      shipId:'',
      sent:'No',
      sentDate:'',
      reimb:'No',
      notes:'', // packing notes are portal-only — never imported from sheet
      pri:'No',
      prepStatus:'Pending',
      createdISO:todayISO(),
      createdAt:getNowUK(),
      importedFrom:'Purchase Sheet',
      sheetRow:row._csvLine||'',
    };

    rows.push(newRow);
    newRows.push(newRow);
    imported++;
  });

  // Save all imported rows to Supabase
  setSyncStatus('syncing');
  Promise.all(newRows.map(r=>saveRow(r))).then(()=>{
    setSyncStatus('synced');
  }).catch(()=>setSyncStatus('error'));

  cm('importModal');
  renderPrep();
  toast(`✓ ${imported} row${imported!==1?'s':''} imported from Purchase Sheet`);
}

// ── SHEET SYNC ENGINE ─────────────────────────────────────────────────────────
// Polls a Google Sheet (CSV export), finds rows where the trigger column = "Yes",
// and silently inserts genuinely-new rows into Supabase. Read-only — the sheet
// is never modified. Dedupe is by sheet_sync_id (SKU+OrderID composite) stored
// on the prep_rows record, enforced at DB level so simultaneous clients can't
// double-insert the same row.
//
// Config is stored in localStorage (app config, not user data) so it survives
// refreshes and is shared across tabs on the same machine.
//
// Architecture:
//   • The browser polls the Sheet CSV export URL directly.
//   • A "leader" tab election (BroadcastChannel) ensures only ONE tab polls at
//     a time, preventing races when multiple people have the portal open.
//   • All browsers receive the new rows via Supabase realtime (already wired).

// Config lives in Supabase `app_settings` so ALL browsers (yours, VA's,
// anyone on the team) share the same settings — change the sheet URL once
// in Settings and every client + the Edge Function picks it up immediately.
// Falls back to localStorage for the toggle/interval (UI preferences only).

const SS_KEY='prephub_sheet_sync';
let _ssConfig={url:'',tab:'',col:'Added To Prep Portal',interval:120,enabled:false};
let _ssTimer=null;
let _ssLeader=false;
let _ssBC=null;

// ── CONFIG PERSISTENCE (Supabase for shared config, localStorage for UI prefs)
async function loadSheetSyncConfig(){
  // Load UI prefs from localStorage first (instant, no network).
  try{const s=localStorage.getItem(SS_KEY);if(s){const p=JSON.parse(s);_ssConfig.interval=p.interval||120;_ssConfig.enabled=p.enabled||false;}}catch(e){}
  // Load shared config (sheet URL, tab, trigger col) from Supabase app_settings.
  try{
    const{data}=await sb.from('app_settings').select('value').eq('key','sheet_sync').maybeSingle();
    if(data?.value){
      const cfg=typeof data.value==='string'?JSON.parse(data.value):data.value;
      _ssConfig.url=cfg.url||'';
      _ssConfig.tab=cfg.tab||'';
      _ssConfig.col=cfg.col||'Added To Prep Portal';
    }
  }catch(e){console.warn('app_settings not yet created — run Settings → Database migration');}
}
async function saveSheetSyncConfig(){
  // Save UI prefs locally.
  try{localStorage.setItem(SS_KEY,JSON.stringify({interval:_ssConfig.interval,enabled:_ssConfig.enabled}));}catch(e){}
  // Save shared config to Supabase so all browsers + Edge Function see the change.
  try{
    await sb.from('app_settings').upsert({key:'sheet_sync',value:JSON.stringify({url:_ssConfig.url,tab:_ssConfig.tab,col:_ssConfig.col})},{onConflict:'key'});
  }catch(e){console.warn('Could not save sheet sync config to Supabase:',e);}
}

// ── SETTINGS UI ───────────────────────────────────────────────────────────────
function sheetSyncDirty(){
  const btn=document.getElementById('sheetSyncSaved');if(btn)btn.style.display='none';
}
async function loadSheetSyncUI(){
  await loadSheetSyncConfig();
  const i=document.getElementById('ss-interval');
  if(i)i.value=String(_ssConfig.interval||120);
  updateSheetSyncToggleUI();
  updateSyncHealthUI();
}
async function saveSheetSyncSettings(){
  const i=parseInt((document.getElementById('ss-interval')||{}).value||'120')||120;
  _ssConfig={..._ssConfig,interval:i};
  await saveSheetSyncConfig();
  await saveSyncSources();
  restartSheetSyncTimer();
  updateSyncHealthUI();
  const saved=document.getElementById('sheetSyncSaved');
  if(saved){saved.style.display='inline';setTimeout(()=>saved.style.display='none',2000);}
  toast('Sheet sync settings saved — all browsers updated');
}
async function toggleSheetSync(){
  _ssConfig.enabled=!_ssConfig.enabled;
  await saveSheetSyncConfig();
  updateSheetSyncToggleUI();
  if(_ssConfig.enabled){restartSheetSyncTimer();runSheetSync(false);}
  else{clearTimeout(_ssTimer);_ssTimer=null;setSheetSyncLog('Sync disabled');}
}
function updateSheetSyncToggleUI(){
  const wrap=document.getElementById('syncToggleWrap');
  const knob=document.getElementById('syncToggleKnob');
  const label=document.getElementById('syncToggleLabel');
  const badge=document.getElementById('syncStatusBadge');
  const on=_ssConfig.enabled;
  if(wrap)wrap.style.background=on?'rgba(34,197,94,.4)':'var(--bg3)';
  if(knob)knob.style.transform=on?'translateX(16px)':'translateX(0)';
  if(knob)knob.style.background=on?'#22c55e':'var(--text3)';
  if(label)label.textContent=on?'Enabled':'Disabled';
  if(label)label.style.color=on?'#22c55e':'var(--text3)';
  if(badge){badge.textContent=on?'LIVE':'OFF';badge.style.background=on?'rgba(34,197,94,.2)':'rgba(100,116,139,.2)';badge.style.color=on?'#22c55e':'var(--text3)';}
}
function setSheetSyncLog(msg,isErr){
  try{if(msg&&window.SyncUI){
    if(!isErr&&SyncUI._n===1&&/add|import|row|new/i.test(msg))SyncUI.stage(2);
    isErr?SyncUI.fail(msg):SyncUI.step(msg);
  }}catch(e){}
  const el=document.getElementById('sheetSyncLog');
  if(el){el.textContent=msg;el.style.color=isErr?'var(--red)':'var(--text2)';}
}
function setSheetSyncStatus(lastRun,next){
  const lr=document.getElementById('sheetSyncLastRun');
  const nx=document.getElementById('sheetSyncNext');
  if(lr&&lastRun)lr.textContent='Last sync: '+lastRun;
  if(nx&&next)nx.textContent='Next: '+next;
}

// ── LEADER ELECTION ───────────────────────────────────────────────────────────
// Only one browser tab should write to Supabase at a time. We use a
// BroadcastChannel so tabs coordinate without any extra infra.
function initSheetSyncLeader(){
  if(!window.BroadcastChannel){{_ssLeader=true;return;}} // fallback: always lead
  if(_ssBC)return;
  _ssBC=new BroadcastChannel('prephub_sync_leader');
  // Announce ourselves and claim leadership
  _ssLeader=true;
  _ssBC.postMessage({type:'claim'});
  _ssBC.onmessage=e=>{
    if(e.data?.type==='claim'){
      // Another tab just opened and claimed leadership. Yield if we're newer
      // (simpler: just yield — the latest tab to load leads).
      _ssLeader=false;
    }
    if(e.data?.type==='synced'){
      // Another tab just ran the sync — update our UI without polling again.
      setSheetSyncStatus(e.data.lastRun,'in ~'+Math.round(_ssConfig.interval/60)+'min');
      setSheetSyncLog(e.data.log||'');
    }
  };
  // Re-claim if we're the only tab left (detected via visibilitychange).
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&!_ssLeader){
      _ssLeader=true;_ssBC.postMessage({type:'claim'});
      /* Taking the lead is worth nothing without a clock to act on it. Make sure
         one is running, and pull the sheet straight away — coming back to the
         tab is exactly when somebody wants to see what has landed. */
      restartSheetSyncTimer();
      if(_ssConfig.enabled&&!_ssBusy)runSheetSync(false);
    }
  });
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
function restartSheetSyncTimer(){
  clearTimeout(_ssTimer);_ssTimer=null;
  /* AUTO SHEET-SYNC RETIRED — Jack, 30 Aug: "stop all this auto sync, it's
     becoming a pain. UK staff presses Sync." Manual only, like the Lavarion
     purchase sheet. Every call still clears any old timer; none is re-armed. */
  return;
  if(!_ssConfig.enabled)return;
  const ms=(_ssConfig.interval||120)*1000;
  _ssTimer=setTimeout(()=>{
    /* Nobody is looking, so don't wake the radio — note the debt and re-arm.
       The visibilitychange listener runs the catch-up sync the moment the tab
       is opened again, so the sheet is never stale when actually looked at. */
    if(document.hidden){_ssRanWhileHidden=true;restartSheetSyncTimer();return;}
    runSheetSync(false);
  },ms);
  const d=new Date(Date.now()+ms);
  const nextStr=d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  setSheetSyncStatus(null,nextStr);
  updateSyncHealthUI(); // keep health panel in sync
}

// ── CORE SYNC ─────────────────────────────────────────────────────────────────

/* ── live feedback while the sheet sync runs ── */
const SyncUI={
  /* Jack, 30 Aug: "a polished staged loading experience with animated
     progress" — and above all, DONE must mean the screen matches the
     database, so nobody ever double-checks finished work again. */
  _t:null,_n:0,
  _stages:['Reading the Purchase Sheet','Importing anything new','Waking up &amp; pulling everything down','Double-checking nothing is missing','Painting the screen'],
  show(title){const p=document.getElementById('syncPanel');if(!p)return;
    clearTimeout(this._t);this._n=0;
    p.className='on';
    p.innerHTML=`<div class="sp-top"><span class="sp-spin"></span><span class="sp-title" id="spTitle">${title||'Syncing with the Purchase Sheet'}</span>
      <button class="sp-x" title="Hide — the sync carries on" onclick="SyncUI.hide()">&#10005;</button></div>
      <div class="sp-stages">${this._stages.map((s,i)=>`<div class="sp-stage" id="spStg${i+1}"><span class="sp-ico"></span><span>${s}</span></div>`).join('')}</div>
      <div class="sp-log" id="spLog"></div>
      <div class="sp-bar"><div class="sp-fill" id="spFill"></div></div>`;
    this.stage(1);},
  stage(n){this._n=n;
    for(let i=1;i<=this._stages.length;i++){const el=document.getElementById('spStg'+i);if(!el)continue;
      el.className='sp-stage'+(i<n?' ok':i===n?' run':'');}
    const f=document.getElementById('spFill');
    if(f)f.style.width=Math.min(100,Math.round((n-0.5)/this._stages.length*100))+'%';},
  step(msg){const l=document.getElementById('spLog');if(!l||!msg)return;l.textContent=msg;},
  done(msg){const p=document.getElementById('syncPanel');if(!p)return;
    this.stage(this._stages.length+1);
    const f=document.getElementById('spFill');if(f)f.style.width='100%';
    p.classList.add('done');const t=document.getElementById('spTitle');if(t)t.textContent='All synced';
    if(msg)this.step(msg);
    clearTimeout(this._t);this._t=setTimeout(()=>this.hide(),4000);},
  fail(msg){const p=document.getElementById('syncPanel');if(!p)return;
    p.classList.add('err');const t=document.getElementById('spTitle');if(t)t.textContent='Sync problem';
    this.step(msg||'Something went wrong — check Settings');
    clearTimeout(this._t);this._t=setTimeout(()=>this.hide(),10000);},
  hide(){const p=document.getElementById('syncPanel');if(p)p.className='';}
};

function paintSyncAge(){
  try{
    const el=document.getElementById('prepSyncAge');if(!el)return;
    const at=window._sheetSyncAt&&window._sheetSyncAt.at;
    if(!at){el.textContent='';return;}
    const m=Math.floor((Date.now()-new Date(at).getTime())/60000);
    const t=m<1?'just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';
    el.textContent='· '+t;
    el.style.color=m>=1440?'#f87171':m>=240?'#fbbf24':'var(--text3)';
    const btn2=document.getElementById('prepSyncBtn');
    if(btn2)btn2.title='Last sheet sync: '+t+(window._sheetSyncAt.by?' by '+window._sheetSyncAt.by:'')+'. Auto-sync is off — pressing this is the only way sheet rows come in.';
  }catch(e){}
}
async function triggerManualSync(){
  const btn=document.getElementById('prepSyncBtn');
  const icon=document.getElementById('prepSyncIcon');
  const label=document.getElementById('prepSyncLabel');
  if(btn){btn.disabled=true;btn.style.opacity='.6';btn.style.cursor='not-allowed';}
  if(label)label.textContent='Syncing…';
  SyncUI.show('Syncing with the sheet');
  // Spin the icon — CSS does the animating, zero JS wake-ups
  if(icon)icon.style.animation='prepSpin 1.2s linear infinite';
  let _syncErr=null;
  const _before=rows.length;
  try{await runSheetSync(true);}catch(e){_syncErr=e;}finally{
    _ssBusy=false;                      // a throw must never leave sync jammed shut
    let _verifyBad='';
    if(!_syncErr){
      /* pull-back: what the sync wrote must be ON SCREEN before "done" */
      SyncUI.stage(3);SyncUI.step('Waking the live connection to the other laptops\u2026');
      try{await reviveRealtime();}catch(e){}
      SyncUI.step('Pulling the freshest copy of everything\u2026');
      try{await resyncNow('after Sync Now',true);}catch(e){}
      /* the never-again guarantee: count the database, compare to the screen.
         A mismatch re-pulls once; still wrong = say so in red, never "done". */
      SyncUI.stage(4);SyncUI.step('Counting the database against the screen\u2026');
      try{
        /* Jack, 3 Sep: "sync issue?" — it cried wolf. This counted EVERY row
           in the table including archived ones, but boot deliberately loads
           only the active ones (`archived.is.null,archived.eq.false`), with
           archived pulled later in Phase B. So a healthy app with 237 archived
           rows reported "1374 in the database, 1137 on screen" and went red.
           Count and compare the SAME population — active rows — which is right
           whether or not Phase B has merged the archived ones in yet. */
        const _c=await sb.from('prep_rows').select('id',{count:'exact',head:true})
          .or('archived.is.null,archived.eq.false');
        const dbN=_c&&_c.count;
        const memN=rows.filter(r=>!r.archived).length;
        if(dbN!=null&&dbN!==memN){
          try{await dbLoad();renderPrep();}catch(e){}
          const memN2=rows.filter(r=>!r.archived).length;
          if(dbN!==memN2)_verifyBad='The database holds '+dbN+' active rows but the screen shows '+memN2+' \u2014 press Sync Now again, and tell Jack if it repeats.';
        }
      }catch(e){}
      SyncUI.stage(5);
      window._sheetSyncAt={at:new Date().toISOString(),by:(window.currentUserName||'')};
      try{_putSetting('sheet_sync_at',window._sheetSyncAt);}catch(e){}
      paintSyncAge();
    }
    const _newN=Math.max(0,rows.length-_before);
    if(_syncErr)SyncUI.fail(_syncErr.message);
    else if(_verifyBad)SyncUI.fail(_verifyBad);
    else SyncUI.done((_newN>0?_newN+' new row'+(_newN===1?'':'s')+' \u2014 on screen now':'No new rows')+' \u00b7 '+fmt(rows.length)+' rows total \u00b7 screen matches the database \u2713');
    if(icon){icon.style.animation='';icon.style.transform='rotate(0deg)';}
    if(label)label.textContent='Sync Now';
    if(btn){btn.disabled=false;btn.style.opacity='1';btn.style.cursor='pointer';}
  }
}
// One-click snapshot of every piece of portal data. This is the "undo button
// for everything" — Supabase remains the live source of truth, but a local
// file means even a worst-case mistake is recoverable.
/* One backup, not two. This was here first and is the button people know, but
   it missed the Lavarion stock batches and purchases — the data that carries
   money. It now runs the complete one. */
function exportBackup(){return downloadBackup();}
function _exportBackupOld(){
  try{
    const data={
      exportedAt:new Date().toISOString(),
      app:'prep-portal',
      rows:rows,
      claims:claims,
      lavAsins:typeof lavAsins!=='undefined'?lavAsins:[],
      lavShipments:typeof lavShipments!=='undefined'?lavShipments:[],
      lv2Components:typeof lv2Components!=='undefined'?lv2Components:[],
      lv2Recipes:typeof lv2Recipes!=='undefined'?lv2Recipes:{},
      shipBoxes:typeof shipBoxes!=='undefined'?shipBoxes:{},
      syncSources:typeof _ssSources!=='undefined'?_ssSources:[],
      syncExcluded:typeof _syncExcluded!=='undefined'?_syncExcluded:[],
      prepFees:typeof prepFees!=='undefined'?prepFees:{},
    };
    const counts=`${(data.rows||[]).length} rows · ${(data.claims||[]).length} issues · ${(data.lavAsins||[]).length} bundles · ${(data.lv2Components||[]).length} components`;
    const blob=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='prep-portal-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    toast('Backup downloaded — '+counts);
    logAudit('Backup exported',counts);
  }catch(e){toast('Backup failed: '+e.message,'er');}
}
let _ssBusy=false,_ssBusyAt=0;
/* ── SYNC ISSUES ────────────────────────────────────────────────────────────
   Jack's most important failsafe: "the Purchase Sheet says Added To Prep Hub =
   YES, but it never appeared in PrepHub — we need to KNOW."
   Until now every way a row could fail was silent. A blank SKU, a placeholder in
   the SKU cell, a row excluded months ago, a save that returned false — all
   dropped with no counter, no log line and nothing on screen. The VA ticks Yes,
   assumes it worked, and nobody finds out for days.
   After every pass the sync now RECONCILES: every row it judged eligible is
   checked against what is actually in the app, and anything missing is recorded
   with the reason. Kept in app_settings so it survives a refresh and is the same
   list for everyone. Reasons are written for the person reading them, not for a
   developer. */
let SYNC_ISSUES=[];
let _syncIssuesLoadP=null;
function loadSyncIssues(){
  /* Idempotent on purpose. The first sync fires on a 2s timer that does not
     wait for boot loads, so recordSyncIssues awaits this before its first
     write — otherwise a fresh tab starts from [] and its first save wipes
     whatever the team's list held. One network read, shared by every caller. */
  if(_syncIssuesLoadP)return _syncIssuesLoadP;
  _syncIssuesLoadP=(async()=>{
    try{
      const r=await sb.from('app_settings').select('value').eq('key','sync_issues').maybeSingle();
      const v=JSON.parse((r.data&&r.data.value)||'[]');
      if(Array.isArray(v))SYNC_ISSUES=v;
    }catch(e){}
  })();
  return _syncIssuesLoadP;
}
async function saveSyncIssues(){
  try{await _putSetting('sync_issues',SYNC_ISSUES.slice(0,300));}catch(e){}
}
function renderSyncIssues(){
  const el=document.getElementById('syncIssuesCard');if(!el)return;
  const n=SYNC_ISSUES.length;
  if(!n){
    el.innerHTML=`<div style="background:var(--bg2);border:1px solid rgba(52,211,153,.3);border-radius:8px;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="font-size:12.5px;font-weight:800;color:#34d399;">Sync issues</div>
        <span style="font-size:10px;font-weight:800;color:#34d399;background:rgba(52,211,153,.14);border:1px solid rgba(52,211,153,.4);padding:2px 9px;border-radius:10px;letter-spacing:.04em;">ALL CLEAR</span>
        <span style="font-size:11.5px;color:var(--text3);">Every row the sheet ticked has come through.</span>
      </div></div>`;
    return;
  }
  /* Deliberately NOT a <table>: the app's global table rules set a 1280px
     min-width and white-space:nowrap for the prep grid, which cut this text off.
     A grid owns its own widths and wraps. */
  const cell='padding:9px 12px;border-bottom:1px solid var(--border);min-width:0;';
  const rowsHtml=SYNC_ISSUES.slice(0,60).map(i=>`
    <div style="${cell}">
      <div style="font:700 12px var(--mono);color:var(--text);overflow-wrap:anywhere;line-height:1.45;">${esc(i.sku||'(blank SKU)')}</div>
      ${i.oid?`<div style="font-size:10.5px;color:var(--text3);margin-top:3px;overflow-wrap:anywhere;">${esc(i.oid)}</div>`:''}
    </div>
    <div style="${cell}"><span style="font-size:11.5px;font-weight:800;color:var(--accent);line-height:1.45;">${esc(i.why)}</span></div>
    <div style="${cell}font-size:11.5px;color:var(--text2);line-height:1.55;">${esc(i.detail||'')}</div>
    <div style="${cell}font-size:10.5px;color:var(--text3);line-height:1.45;overflow-wrap:anywhere;">${esc(i.source||'')}</div>`).join('');
  /* Say the right thing: a tab that could not be read is a different problem
     from a row that did not come through, and reading "these rows are ticked"
     over a connection failure would send somebody hunting the wrong thing. */
  const unread=SYNC_ISSUES.filter(i=>i.why==='Could not read this sheet').length;
  const blurb=unread===n
    ? 'The sheet could not be read, so <b>nothing was checked</b>. Anything ticked since the last good sync is not here yet.'
    : (unread
      ? 'A sheet could not be read, and other rows are ticked on the sheet but are <b>not</b> in PrepHub.'
      : 'These rows are ticked on the sheet but are <b>not</b> in PrepHub. Nothing is lost \u2014 they simply have not come through.');
  const hd='padding:7px 12px;font-size:10px;font-weight:800;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;background:var(--bg3);';
  el.innerHTML=`<div style="background:var(--bg2);border:1px solid rgba(251,191,36,.45);border-radius:8px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:13px 16px;border-bottom:1px solid var(--border);">
      <div style="font-size:12.5px;font-weight:800;color:var(--accent);">Sync issues</div>
      <span style="font-size:10px;font-weight:800;color:#1a1400;background:var(--accent);padding:2px 9px;border-radius:10px;">${n}</span>
      <span style="font-size:11.5px;color:var(--text2);flex:1 1 220px;min-width:170px;line-height:1.5;">${blurb}</span>
      <button onclick="runSheetSync(true)" style="padding:6px 13px;background:rgba(96,165,250,.16);border:1px solid rgba(96,165,250,.45);color:#60a5fa;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;">Retry sync</button>
      <button onclick="clearSyncIssues()" style="padding:6px 11px;background:var(--bg3);border:1px solid var(--border2);color:var(--text3);border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">Clear list</button>
    </div>
    <div style="display:grid;grid-template-columns:minmax(150px,1.5fr) minmax(120px,1.1fr) minmax(200px,2.6fr) minmax(90px,.9fr);">
      <div style="${hd}">SKU</div><div style="${hd}">What happened</div><div style="${hd}">What to do</div><div style="${hd}">Source</div>
      ${rowsHtml}
    </div>
    ${n>60?`<div style="padding:9px 14px;font-size:11px;color:var(--text3);">\u2026and ${n-60} more.</div>`:''}
  </div>`;
}
function clearSyncIssues(){
  SYNC_ISSUES=[];saveSyncIssues();
  try{renderSyncIssues();toast('Sync issues cleared');}catch(e){}
}
function _issueKey(i){return (i.sku||'')+'|'+(i.oid||'')+'|'+(i.source||'');}
/* Replace this source's issues wholesale each pass: a row that has since come
   through must stop being reported, or the list becomes noise nobody reads. */
async function recordSyncIssues(source,list){
  await loadSyncIssues();   // never write over a list we have not read
  SYNC_ISSUES=SYNC_ISSUES.filter(i=>i.source!==source);
  list.forEach(i=>SYNC_ISSUES.push({...i,source,at:new Date().toISOString()}));
  saveSyncIssues();
  try{renderSyncIssues();}catch(e){}
}
async function runSheetSync(manual){
  /* Two-phase boot: a sync mid-gap would see the archive as absent and re-add
     rows the pre-insert check then has to bounce. Queue it; finalize runs it.
     restartSheetSyncTimer is MANDATORY on this early return — file convention:
     every early exit re-arms or the schedule dies for the session. */
  if(!_historyReady){
    _syncQueued=true;
    if(manual)toast('Loading history \u2014 sync will run automatically in a moment');
    restartSheetSyncTimer();
    return;
  }
  /* No guard here meant the two-minute timer fired again while a slow sync was
     still working, and the runs stacked — each one writing into the same little
     progress box, which is why it looked like it ran fifty times and never
     finished. One at a time; a background trigger that lands mid-run is simply
     skipped, because the run already in flight is reading the same sheet. */
  /* A stuck "busy" flag is why a sync can die for the rest of the day.
     runSheetSync has no try/finally — the comment below claiming one is wrong —
     so a single throw anywhere in it leaves _ssBusy true forever: the timer is
     never re-armed AND every manual press bounces off this guard. The only cure
     was reloading the page, which is exactly the "just press Sync Now again in
     the morning" ritual. A run that has been going longer than five minutes is
     not running, it is dead: stand it back up rather than block forever. */
  if(_ssBusy&&_ssBusyAt&&(Date.now()-_ssBusyAt)>300000){
    console.warn('[sync] previous run never finished — clearing the stuck busy flag');
    _ssBusy=false;
    try{addSyncHistory('Previous sync never finished — recovered automatically',false);}catch(e){}
  }
  if(_ssBusy){
    if(manual)toast('Already syncing — give it a second','er');
    /* Re-arm before leaving. restartSheetSyncTimer() only runs at the very END
       of this function, so EVERY early return below used to kill the schedule
       permanently — one skipped poll and that tab never synced again on its
       own for the rest of the session. It is safe to call on any path: it
       no-ops when sync is switched off. */
    restartSheetSyncTimer();
    return;
  }
  if(LOCAL_FILE){
    if(manual){
      try{SyncUI.show('Sync unavailable');SyncUI.fail(_sheetsBlockedMsg());}catch(e){}
      toast('Sheet sync needs the hosted app — Google blocks local files','er');
    }
    setSheetSyncLog&&setSheetSyncLog(_sheetsBlockedMsg(),true);
    return;
  }
  if(!_ssConfig.enabled&&!manual){return;}
  /* Only one tab per browser polls, so two tabs don't both write the same rows.
     But a tab that is NOT the leader still has to keep its own clock running —
     it may become the leader the moment the other tab is closed or hidden, and
     without a live timer it would then sit there doing nothing while the staff
     member wonders why they have to keep pressing Sync Now. */
  if(!_ssLeader&&!manual){restartSheetSyncTimer();return;} // only leader polls
  _ssBusy=true;_ssBusyAt=Date.now();
  /* NOTE: there is no try/finally here — see the stale-flag recovery above. */
  // Run all active sources
  const activeSources=_ssSources.filter(s=>s.active&&s.url);
  if(!activeSources.length&&!_ssConfig.url){_ssBusy=false;if(manual)toast('No sync sources configured — add one in Settings','er');restartSheetSyncTimer();return;}
  // Fall back to legacy single config if no sources defined yet
  const sources=activeSources.length?activeSources:[{url:_ssConfig.url,tab:_ssConfig.tab,col:_ssConfig.col||'Added To Prep Portal',label:'Primary'}];
  let totalAdded=0,totalUpdated=0,totalDeactivated=0,totalReactivated=0,totalErrors=0;
  // One source can list many tabs (comma-separated). Expand into one pass per
  // tab — each pass fetches and processes that tab independently, with its own
  // log line. Safe: deactivation only acts on rows a tab explicitly shows with
  // the trigger unticked, so tabs can never clobber each other's rows.
  const passes=[];
  sources.forEach(s=>{
    const tabs=String(s.tab||'').split(',').map(t=>t.trim()).filter(Boolean);
    if(tabs.length<=1)passes.push(s);
    else tabs.forEach(t=>passes.push({...s,tab:t,label:(s.label||'Source')+' · '+t}));
  });
  /* All sources are FETCHED at once — three tabs used to mean three Google
     round trips strictly one after the other. Processing stays sequential and
     in the same order, so nothing about what lands changes; only the waiting
     overlaps. */
  const _fetchCsv=async src=>{
    if(!src.url)return{err:'Enter a Sheet URL in Settings → Sheet Sync'};
    const m2=String(src.url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if(!m2)return{err:'Invalid Sheet URL — paste the full share link'};
    try{
      const efUrl=`${SUPA_URL}/functions/v1/sheet-sync?sheetId=${encodeURIComponent(m2[1])}&tab=${encodeURIComponent(src.tab||'')}`;
      const res=await fetch(efUrl,{cache:'no-store',headers:{'Authorization':`Bearer ${SUPA_KEY}`}});
      if(!res.ok)throw new Error(`Edge Function error: ${res.status} ${res.statusText}`);
      const json=await res.json();
      if(json.error)throw new Error(json.error);
      if(!json.csv)throw new Error('No CSV returned from Edge Function');
      return{csv:json.csv};
    }catch(e){return{err:'Could not fetch sheet: '+(e.message||e)}}
  };
  const _csvFetches=passes.map(src=>_fetchCsv(src));
  let _passN=0;
  for(const src of passes){
    const{url,tab,col}=src;
    const srcLabel=src.label||(src.tab?src.tab+' tab':'Sheet');
    _passN++;
    try{SyncUI.step(`Reading ${srcLabel}${passes.length>1?` (${_passN} of ${passes.length})`:''}\u2026`);}catch(e){}

  setSheetSyncLog('Checking sheet…');
  /* A bad source used to `return` out of the whole function from INSIDE this
     loop — with _ssBusy still true and no timer re-armed. From then on every
     sync, manual included, bounced off "already syncing" until the page was
     reloaded: one bad URL jammed the whole sync system, permanently. A bad
     source now costs exactly one pass, like every other per-source failure. */
  let csv;
  {
    const got=await _csvFetches[_passN-1];
    if(got.err){
      setSheetSyncLog(got.err,true);
      addSyncHistory((src.label||src.tab||'Source')+': '+got.err,false);
      if(manual)toast(got.err,'er');
      /* Say it on the Settings page too. Before this, a sheet that could not be
         read left the issues panel reading "ALL CLEAR" — the most misleading
         thing it could possibly say, because nothing at all had been checked. */
      recordSyncIssues(srcLabel,[{sku:'\u2014 whole tab \u2014',oid:'',why:'Could not read this sheet',
        detail:'Nothing was checked from this tab, so anything ticked on it since the last good sync is not here yet. '+got.err}]);
      totalErrors++;
      continue; // try next source
    }
    csv=got.csv;
  }

  // Parse CSV
  let parsed;
  try{parsed=parseCSV(csv);}catch(e){
    const msg='['+srcLabel+'] CSV parse error: '+e.message;
    setSheetSyncLog(msg,true);addSyncHistory(msg,false);totalErrors++;continue;
  }
  if(!parsed.length){
    const msg='['+srcLabel+'] Sheet appears empty';
    setSheetSyncLog(msg,true);addSyncHistory(msg,false);totalErrors++;continue;
  }

  // Find trigger column
  const triggerCol=col||'Added To Prep Portal';
  const headers=parsed.length?Object.keys(parsed[0]).filter(k=>k!=='_csvLine'):[];
  const triggerFound=headers.includes(triggerCol);
  if(!triggerFound){
    const msg=`[${srcLabel}] ⚠ Trigger column "${triggerCol}" not found in sheet. Headers: ${headers.slice(0,6).join(', ')}${headers.length>6?'…':''}`;
    setSheetSyncLog(msg,true);addSyncHistory(msg,false);totalErrors++;
    /* On the wrong column name this source imports NOTHING, forever, with only
       a log line to say so. Put it where somebody will actually look. */
    recordSyncIssues(srcLabel,[{sku:'\u2014 whole tab \u2014',oid:'',
      why:'The tick column is named wrong',
      detail:`This source looks for a column called "${triggerCol}", but this tab has no such header. Open the source in Settings and set the Trigger column to the exact header on the sheet \u2014 on the 2026 tracker that is "Added To PrepHub".`}]);
    continue;
  }

  /* ONLY the named column decides. There used to be a fallback chain through
     the old column names, which meant a blank cell in the new column let a
     stale "Yes" in a retired column import the row — a tick nobody made. */
  const getTrigger=row=>(row[triggerCol]||'').trim().toLowerCase();
  const mkSyncId=(sku,oid)=>oid?sku+'|'+oid:sku+'|nooid';
  const sheetFields=row=>{
    const sku=(row['SKU']||'').trim();
    const dateRaw=(row['Date']||'').trim();
    const dateParts=dateRaw.split('/');
    const dateFormatted=dateParts.length>=2?`${dateParts[0].padStart(2,'0')}/${dateParts[1].padStart(2,'0')}`:'';
    const qty=_sheetQty(row);
    const asin=(row['Asin']||row['ASIN']||'').trim();
    // VAT — purchase sheet Column H. Prefer a named VAT header; fall back to the
    // 8th column (A=0 … H=7) so it works even if the header text differs.
    const vatColH=headers[7];
    const vatRaw=(row['VAT']||row['Vat']||row['VAT %']||row['VAT Rate']||row['Vat Rate']||row['VAT Status']||(vatColH?row[vatColH]:'')||'');
    return{sku,date:dateFormatted,oid:(row['Order Id']||row['Order ID']||'').trim(),sup:(row['Bought From']||'').trim(),acct:(row['Account']||'').trim(),prod:(row['Name']||'').trim(),asin,dg:(row['DG']||'').trim(),vat:normVat(vatRaw),sas:`https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${encodeURIComponent(asin)}`,exp:sellableExp(qty,(row['In a Bundle?']||'No').trim(),(row['How Many In a Bundle?']||'').trim()),aqty:qty,bun:(row['In a Bundle?']||'No').trim(),bqty:(row['How Many In a Bundle?']||'').trim(),subSave:(row['S&S (AC)']||row['SAS (AC)']||'No').trim()==='Yes'?'Yes':'No',vaNoteSheet:(row['VA Note']||'').trim()}; // notes NOT mapped — portal packing notes are owned by prep team
  };

  const allRowsBySyncId=new Map();
  const allRowsBySku=new Map();
  /* Jack, 31 Aug: "SKU should always stay the same unless she changes it,
     which sometimes happens." A renamed SKU used to look like a brand-new row
     AND leave the old one to be archived — taking its received qty, notes,
     shipments and case file with it. Index by order id as well so a rename can
     be recognised as the SAME row. One Amazon order can hold several products,
     so this fallback only fires when the order id points at exactly one row
     AND the ASIN matches — a true rename, never a guess. */
  const allRowsByOid=new Map();
  rows.forEach(r=>{if(r.sheetSyncId)allRowsBySyncId.set(r.sheetSyncId,r);
    /* 7 archived rows share a SKU with a live one (old reorders). The SKU
       fallback must always find the LIVE row, never its archived twin. */
    const _k=(r.sku||'').toLowerCase();
    const _prev=allRowsBySku.get(_k);
    if(!_prev||(_prev.archived&&!r.archived))allRowsBySku.set(_k,r);
    const _o=(r.oid||'').trim();
    if(_o&&!r.archived){const a=allRowsByOid.get(_o)||[];a.push(r);allRowsByOid.set(_o,a);}});
  const _claimedRows=new Set();   // one existing row can only be claimed by ONE sheet line per pass

  window._noOidSeen={};
  const toAdd=[],toUpdate=[],toDeactivate=[],toReactivate=[];
  /* every row the sheet says YES to, and what became of it */
  const _eligible=[],_issues=[];
  const _flag=(sku,oid,why,detail)=>_issues.push({sku:sku||'(blank SKU)',oid:oid||'',why,detail:detail||''});
  let _untickedInApp=0;   // in the app but not ticked on the sheet — reported, never acted on
  const skuWarnings=[]; // track rows with issues

  /* "Only rows from this date" — Jack, moving onto the real 2026 Purchase
     Tracker: the Q3 tab holds months of history he does NOT want pulled in, he
     just wants to start from today. Lavarion has worked this way for months
     (`purchFrom`), so this is the same idea on the prep side.
     It gates the row ENTIRELY — an older row is neither added nor removed. That
     matters: without it, a row dated in June sitting on the tab with its tick
     box on N/A would be read as "take this off the prep sheet".
     Unreadable dates are LET THROUGH, never skipped — when we cannot tell, the
     safe answer is to behave exactly as before rather than silently drop a row. */
  const _fromISO=(src.from||'').trim();
  let _tooOld=0;
  const _rowISO=raw=>{
    const t=String(raw||'').trim(); if(!t)return '';
    const p2=t.split('/');
    if(p2.length<3)return '';
    let[d1,m1,y1]=p2.map(x=>x.trim());
    if(y1.length===2)y1='20'+y1;
    if(!/^\d{1,2}$/.test(d1)||!/^\d{1,2}$/.test(m1)||!/^\d{4}$/.test(y1))return '';
    return y1+'-'+m1.padStart(2,'0')+'-'+d1.padStart(2,'0');
  };
  parsed.forEach(row=>{
    const sku=(row['SKU']||'').trim();
    if(!sku){
      if(getTrigger(row)==='yes')_flag('', (row['Order Id']||row['Order ID']||'').trim(),
        'No SKU on the sheet','This row is ticked for PrepHub but its SKU cell is empty. Add the SKU, then it will come through.');
      return;
    }
    /* "trans codes don't add yet", "thibk jack" — notes people park in the SKU
       cell. A real SKU never contains a space, so if one does it is a note, and
       ticking that row by mistake would create a row whose SKU is an English
       sentence. Warned about rather than dropped silently. */
    if(/\s/.test(sku)){
      if(getTrigger(row)==='yes'){
        skuWarnings.push('Not a SKU, skipped: "'+sku.slice(0,40)+'"');
        _flag(sku,(row['Order Id']||row['Order ID']||'').trim(),'That is a note, not a SKU',
          'The SKU cell reads "'+sku.slice(0,50)+'". Replace it with the real SKU and it will come through.');
      }
      return;
    }
    /* Asymmetric on purpose, and this is the important bit.
       A readable date before the start date: skip entirely.
       An UNREADABLE date while a start date is set: it may still be ADDED (so a
       new purchase is never silently missed because someone typed the date
       oddly), but it must never cause a REMOVAL. Uncertainty is allowed to cost
       an extra row on screen; it is never allowed to delete one. */
    let _rowOld=false,_rowUndated=false;
    if(_fromISO){
      const iso=_rowISO(row['Date']);
      if(!iso)_rowUndated=true;
      else if(iso<_fromISO){_tooOld++;return;}
    }
    // Warn if SKU has no qty
    const qty=_sheetQty(row);
    if(qty===0&&getTrigger(row)==='yes')skuWarnings.push('No qty: '+sku);
    const oid=(row['Order Id']||row['Order ID']||'').trim();
    const syncId=mkSyncId(sku,oid);
    if(_syncExcluded.some(x=>_exId(x)===syncId)){
      if(getTrigger(row)==='yes')_flag(sku,oid,'Removed from PrepHub on purpose',
        'Somebody used "Remove & exclude from sync" on this row, so it will not come back even though the sheet says Yes. Re-allow it in Settings if that was a mistake.');
      return;
    }
    const trigger=getTrigger(row);
    const fields=sheetFields(row);
    let existing=allRowsBySyncId.get(syncId)||allRowsBySku.get(sku.toLowerCase());
    if(!existing&&oid){
      /* SKU renamed on the sheet? Same order, same ASIN, one candidate only. */
      const asinS=String(fields.asin||'').trim().toUpperCase();
      const cands=(allRowsByOid.get(oid)||[]).filter(r=>!_claimedRows.has(r)
        &&asinS&&String(r.asin||'').trim().toUpperCase()===asinS);
      if(cands.length===1){
        existing=cands[0];
        _flag(sku,oid,'SKU changed on the sheet — history kept',
          'This line used to be "'+(existing.sku||'?')+'". Matched on the order number and ASIN, so the row keeps everything already recorded against it — units received, notes, shipments and any open issue. Nothing was duplicated.');
      }else if(cands.length>1){
        _flag(sku,oid,'Could not tell which row this is',
          'The order number '+oid+' has more than one row with this ASIN, so a renamed SKU cannot be matched safely. It has been left alone — fix the SKU on the sheet to match the app, or tell Jack.');
      }
    }
    if(existing)_claimedRows.add(existing);
    if(trigger==='yes'){
      /* no order id means identity is the SKU alone — two such lines would
         quietly collapse into one row. Name it rather than merge it. */
      if(!oid){
        window._noOidSeen=window._noOidSeen||{};
        const k=sku.toLowerCase();
        if(window._noOidSeen[k])_flag(sku,'','Two sheet lines share this SKU and have no order number',
          'Without an order number the app can only tell rows apart by SKU, so these two lines look like one row and only the first is kept. Put the order number on the sheet (or make the SKUs different) and sync again.');
        window._noOidSeen[k]=1;
      }
      _eligible.push({sku,oid,syncId,qty});
      /* It still comes through — but at 0 units, which reads as "nothing
         ordered" on the floor. Worth saying out loud rather than leaving
         somebody to notice the count is wrong three days later. */
      if(qty===0)_flag(sku,oid,'Came through with 0 units',
        'No number in the quantity column for this row, so PrepHub shows 0 expected. Put the quantity on the sheet and sync again.');
      if(!existing)toAdd.push({fields,syncId});
      else if(existing.sent==='Yes'||existing.status==='Sent to Amazon'){}  // already sent — never touch
      /* A row someone deliberately closed off must not be resurrected by the
         next sync just because the line is still on the sheet. Before this,
         closing a row in the portal lasted until the next sync and no longer —
         the only rows sync respected were ones marked Sent to Amazon.

         This guarded 'approved' ONLY, which left a hole: a closure waiting on
         Jack is 'proposed', and if Sarah also ticked "Remove from Prep Sheet"
         the row was archived — so the next sync REACTIVATED it, un-archived
         it and put it back on the active sheet while Jack still had it in his
         approvals queue. Any resolution that has not been rejected is a
         deliberate state and the sheet does not get to overrule it. A rejected
         one is back in play, so it syncs normally again. */
      else if(existing.resolution&&existing.resolution.state&&existing.resolution.state!=='rejected'){}
      else if(existing.archived)toReactivate.push({existing,fields,syncId});
      else toUpdate.push({existing,fields,syncId});
    }else if(trigger==='no'||trigger==='n/a'||trigger===''){
      /* ── THE SHEET NEVER REMOVES ANYTHING ─────────────────────────────
         Jack, 15 Aug: "nothing gets removed at all!".
         It used to: a cell reading anything other than "Yes" — N/A, No, Old, or
         a cell somebody tabbed through by accident — pulled that row straight
         off the prep sheet. Renaming a column, or pasting over the wrong range,
         could take out dozens at once.
         Adding and removing are not the same kind of act and should not share
         one dropdown. Ticking Yes is a person saying "put this in". Something
         merely ABSENT is never an instruction to delete. Removal is now a
         deliberate click inside the app, where it asks first.
         Still counted so the log can report it — visibility without the risk. */
      if(existing&&!existing.archived&&existing.status!=='Sent to Amazon')_untickedInApp++;
    }
  });

  let added=0,updated=0,deactivated=0,reactivated=0;
  const saveErrors=[];
  if(_tooOld)addSyncHistory(`[${srcLabel}] ${_tooOld} row${_tooOld===1?'':'s'} dated before ${_fromISO} skipped`,true);
  if(_untickedInApp)addSyncHistory(`[${srcLabel}] ${_untickedInApp} row${_untickedInApp===1?'':'s'} in the app are not ticked on the sheet — left alone (the sheet never removes)`,true);
  /* Say the shape of the job before starting it, so a long sync reads as busy
     rather than broken. */
  try{
    const _n=toAdd.length+toUpdate.length+toReactivate.length;
    SyncUI.step(_n?`${_n} row${_n===1?'':'s'} to save — ${toAdd.length} new, ${toUpdate.length} changed, ${toReactivate.length} back on the sheet`
                  :'Nothing changed on the sheet');
  }catch(e){}

  /* Why the sync took minutes: every row was saved with its own `await`, one
     strictly after the other. Each save is a separate round trip to Supabase,
     so 200 changed rows meant 200 sequential round trips — at ~200ms each that
     is over a minute of doing nothing but waiting, and it grows with the sheet.
     Same saves, same order of work, just several in the air at once. Capped at
     6 so a big sheet cannot flood Supabase or trip its rate limit. saveRow is
     untouched, so the missing-column healing and every retry still apply. */
  async function _saveMany(items,worker,limit,label){
    let i=0,done=0;
    const total=items.length;
    /* The staff complaint was that it "just does the animation" — the spinner
       turned while the panel sat on a stale message, so a sync that was working
       hard looked identical to one that had hung. The saving phase is the slow
       part and it was the one phase saying nothing at all. Now it counts.
       Throttled to every 5 (and always the last) so a 500-row sheet doesn't
       spend its time writing to the DOM instead of saving. */
    const tick=()=>{ if(!label||!total)return;
      try{SyncUI.step(label+' — '+done+' of '+total);}catch(e){} };
    tick();
    const lanes=Array.from({length:Math.min(limit||6,total)},async()=>{
      while(i<total){
        const idx=i++;
        await worker(items[idx],idx);
        done++;
        if(done%5===0||done===total)tick();
      }
    });
    await Promise.all(lanes);
  }
  /* One request carrying up to 100 rows instead of one request per row. On ANY
     error — a missing column, a short reply, anything — the whole phase falls
     back to the per-row path above, which carries saveRow's missing-column
     healing and its verify-the-match check. A bad column costs speed, never
     data. Insert results come back in input order (Postgres RETURNING on a
     multi-row VALUES insert), which is what makes adopting the new ids safe. */
  async function _batchRows(list,kind){
    if(!list.length)return true;
    try{
      for(let o=0;o<list.length;o+=100){
        const chunk=list.slice(o,o+100);
        chunk.forEach(r=>{if(r&&r.issueType==='Gated'&&!(r.notes||'').toLowerCase().includes('gated'))r.notes=r.notes?('Gated — '+r.notes):'Gated';});
        const datas=chunk.map(r=>{const d=rowToDb(r);_missingCols.forEach(c=>delete d[c]);if(kind==='update')d.id=r.uuid;return d;});
        const res=await(kind==='insert'
          ? sb.from('prep_rows').insert(datas).select('id')
          : sb.from('prep_rows').upsert(datas,{onConflict:'id'}).select('id'));
        if(res.error)throw res.error;
        if(!Array.isArray(res.data)||res.data.length!==chunk.length)
          throw new Error('batch answered for '+((res.data||[]).length)+' of '+chunk.length+' rows');
        if(kind==='insert')res.data.forEach((d,i)=>{if(d&&d.id)chunk[i].uuid=d.id;});
        /* same echo shield saveRow uses — the realtime reflection of this write
           must not overwrite the fresh local values */
        chunk.forEach(r=>{r._dirty=true;setTimeout(()=>{r._dirty=false;},1500);});
      }
      return true;
    }catch(e){
      console.warn('[sync] batch '+kind+' fell back to per-row:',e&&e.message||e);
      try{SyncUI.step('Batch save unavailable — saving row by row\u2026');}catch(_){}
      return false;
    }
  }

  /* ── ASK THE DATABASE, NOT JUST THIS BROWSER ─────────────────────────────
     18 Aug: one LEGO line on the purchase sheet became THREE identical prep
     rows. Nobody did anything wrong. The dedupe above is a lookup into `rows`,
     which is this tab's own memory, loaded once when the page opened. Three
     machines had the portal open; each looked in its own memory, each honestly
     saw nothing, each added the line. Nothing at the database said no, because
     the unique index on sheet_sync_id lives in a migration that was never run.

     So before inserting anything, ask the database what it already holds for
     these SKUs. One extra read per sync, and only when there is something to
     add. It shrinks the window for a double-import from "however long this tab
     has been open" to the few hundred ms between this read and the insert —
     the unique index closes the rest, once it exists.

     Archived rows COUNT as present on purpose: the sheet saying Yes to a row
     that was archived means reactivate, never insert a second copy. This tab
     cannot reactivate what it has never loaded, so it leaves it alone and the
     next page load handles it through toReactivate with the notes intact.

     Fails OPEN: if this read errors, the sync proceeds exactly as before. A
     missed import is worse than a duplicate, and the index is the real net. */
  if(toAdd.length){
    try{
      const _skus=[...new Set(toAdd.map(x=>(x.fields.sku||'').trim()).filter(Boolean))];
      const _inDb=new Set();
      const _key=(sku,oid)=>(String(sku||'').trim().toLowerCase())+'|'+(String(oid||'').trim()||'nooid');
      for(let o=0;o<_skus.length;o+=80){
        const{data,error}=await sb.from('prep_rows').select('sku,order_id').in('sku',_skus.slice(o,o+80));
        if(error)throw error;
        (data||[]).forEach(d=>_inDb.add(_key(d.sku,d.order_id)));
      }
      let _dropped=0;
      for(let i=toAdd.length-1;i>=0;i--){
        if(_inDb.has(_key(toAdd[i].fields.sku,toAdd[i].fields.oid))){toAdd.splice(i,1);_dropped++;}
      }
      if(_dropped)console.warn('[sync] '+_dropped+' row(s) already in the database — not re-added (stale tab memory)');
    }catch(e){console.warn('[sync] pre-insert existence check unavailable, continuing:',e&&e.message||e);}
  }

  // ADD
  const _addRows=toAdd.map(({fields,syncId})=>({fields,row:{uuid:(window.crypto&&crypto.randomUUID?crypto.randomUUID():undefined),_minted:!!(window.crypto&&crypto.randomUUID),id:++nid,sheetSyncId:syncId,...fields,notes:'',rcvd:0,issueType:'',issueQty:0,status:'In-Transit',ship:0,shipId:'',sent:'No',sentDate:'',reimb:'No',pri:'No',archived:false,shipSegments:[],allShipIds:[],createdISO:todayISO(),createdAt:getNowUK(),importedFrom:'Sheet Sync',sheetRow:''}}));
  _addRows.forEach(x=>rows.push(x.row));
  /* Failures used to be undone with rows.pop() — fine when saves ran one at a
     time, silently wrong the moment they overlap, because pop() removes
     whatever happens to be last rather than the row that actually failed.
     Removed by identity instead. */
  const _addFailed=[];
  let _addDupes=0;
  if(await _batchRows(_addRows.map(x=>x.row),'insert')){
    added+=_addRows.length;
  }else await _saveMany(_addRows,async x=>{
    /* A row the database REFUSES as a duplicate is not an error to report — it
       means another machine imported this line first, which is exactly what we
       want to happen. The phantom local row is dropped either way (below), and
       the real one arrives on the next load. Counted, never shouted about. */
    try{const ok=await saveRow(x.row);
      if(ok)added++;
      else if(_isDupKeyErr(_lastSaveErr)){_addDupes++;_addFailed.push(x.row);}
      else{saveErrors.push('Save failed: '+x.fields.sku);_addFailed.push(x.row);}}
    catch(e){saveErrors.push('Save error: '+x.fields.sku+' — '+e.message);_addFailed.push(x.row);}
  },6,'Adding new rows');
  if(_addDupes)console.warn('[sync] '+_addDupes+' row(s) refused by the database as already present — correct, not an error');
  _addFailed.forEach(bad=>{const i=rows.indexOf(bad);if(i>=0)rows.splice(i,1);});

  /* The only fields the sheet owns. Everything else on a row — notes, what was
     received, issues, shipments, status — is portal-side work and a sync must
     never touch it. Declared once here because BOTH update and reactivate need
     it; it used to live inside the update loop, and reactivate having no
     allow-list is what wiped the notes. */
  /* `aqty` was in this list but has no database column — dbToRow rebuilds it
   from expected_qty, so on every bundle row the sheet's raw figure (98) never
   matched the rebuilt one (49) and EVERY bundle row was reported "changed" on
   EVERY sync, forever, rewriting rows from the polling tab's memory. It is
   read from the sheet into the row elsewhere; it does not belong in the
   change-detection list. */
const sheetOnly=['sku','date','oid','sup','acct','prod','asin','dg','vat','sas','exp','bun','bqty','subSave','vaNoteSheet'];

  // UPDATE
  /* Work out what actually changed first — comparing is instant, and only the
     rows that genuinely differ are worth a round trip. */
  const _toSave=[];
  for(const{existing,fields,syncId}of toUpdate){
    let changed=false;
    /* `vaNoteSheet` is never persisted by rowToDb and never rebuilt by
       dbToRow, so after every page load it is undefined locally while the
       sheet supplies '' — and `undefined !== ''` marked EVERY ticked row as
       changed on the first sync after every refresh. That turned a rare
       overwrite race into one that fired constantly, on every laptop, and
       buried real changes in a "hundreds updated" report. An empty sheet
       value against a never-loaded field is not a change. */
    sheetOnly.forEach(k=>{
      if(fields[k]===undefined)return;
      /* Jack, 8 Sep: a "Wrong qty" fix on the row was undone by the very next
         sync while the sheet still said the old number. Keep the fix until the
         sheet is corrected; the moment the sheet changes, the sheet wins. */
      if(k==='exp'&&existing.qtyFix&&!existing.qtyFix.sheetDone){
        if(parseInt(fields[k])===parseInt(existing.qtyFix.from))return;
        existing.qtyFix.sheetDone=true;
      }
      const was=existing[k];
      if(was===undefined&&(fields[k]===''||fields[k]==null)){existing[k]=fields[k];return;}
      if(was!==fields[k]){existing[k]=fields[k];changed=true;}
    });
    /* This is the vaNoteSheet bug again, one line below the fix for it, and
       worse. sheet_sync_id has no column in the database, so dbToRow rebuilds
       every row with '' while syncId is always non-empty — meaning this
       condition was TRUE for every ticked row on every pass of every sync,
       forever, from every laptop. Not just the first sync after a refresh:
       every single one. That is a permanent whole-table write storm and a
       permanent overwrite race against whatever the prep team is typing.
       A row that has no fingerprint yet simply adopts one in memory; only a
       genuine change of fingerprint is worth a write. Once the migration has
       run and the value is stored, this stops being reachable at all. */
    if(existing.sheetSyncId&&syncId!==existing.sheetSyncId){existing.sheetSyncId=syncId;changed=true;}
    else if(!existing.sheetSyncId)existing.sheetSyncId=syncId;
    if(changed){existing._dirty=true;_toSave.push(existing);}
  }
  const _updId=_toSave.filter(r=>r.uuid),_updRest=_toSave.filter(r=>!r.uuid);
  let _updLeft=_toSave;
  if(_updId.length&&await _batchRows(_updId,'update')){updated+=_updId.length;_updLeft=_updRest;}
  await _saveMany(_updLeft,async existing=>{
    try{const ok=await saveRow(existing);if(ok){updated++;}else saveErrors.push('Update failed: '+existing.sku);}
    catch(e){saveErrors.push('Update error: '+existing.sku+' — '+e.message);}
  },6,'Updating changed rows');

  // REACTIVATE
  const _toReact=[];
  for(const{existing,fields,syncId}of toReactivate){
    /* This was Object.assign(existing, fields) — a blanket copy. `fields` carries
       the defaults a NEW row needs (notes:'', rcvd:0, issueType:'', ship:0,
       shipId:'', sent:'No', reimb:'No', status:'In-Transit'), so any row that
       dropped off the sheet and came back had every piece of portal-side work
       wiped: the chase notes, what had been received, what had been shipped.
       Silently, on an ordinary sync — which is exactly how Sarah's notes went.

       The sheet owns sheet columns and nothing else. Same allow-list the UPDATE
       branch above has always used. */
    sheetOnly.forEach(k=>{if(fields[k]!==undefined)existing[k]=fields[k];});
    existing.sheetSyncId=syncId;
    existing.archived=false;
    // back on the sheet means in transit again — unless it had already moved on,
    // in which case that status is the truer one and is left alone
    if(!existing.status||existing.status==='Deactivated')existing.status='In-Transit';
    existing._dirty=true;
    _toReact.push(existing);
  }
  await _saveMany(_toReact,async existing=>{
    try{await saveRow(existing);reactivated++;}
    catch(e){saveErrors.push('Reactivate error: '+existing.sku+' — '+e.message);}
  },6,'Putting rows back');

  // ── CIRCUIT BREAKER ─────────────────────────────────────────────────────
  // Deactivation DELETES never-shipped rows. If a sync suddenly wants to
  // remove many rows at once, that almost always means the sheet is broken
  // (wrong tab, renamed trigger column, mass-untick) — not a real decision.
  // Hold the removals: a manual "Sync Now" asks for explicit confirmation;
  // an automatic background sync never mass-deletes, it just warns.
  let _deactHeld=0;
  if(toDeactivate.length>=5){
    const ok=manual&&confirm(`⚠ SAFETY CHECK\n\nThis sync wants to REMOVE ${toDeactivate.length} rows from the prep sheet (rows no longer ticked in the source sheet).\n\nThat's a lot at once — it usually means the sheet/tab/trigger column changed by accident.\n\nRemove them anyway?`);
    if(!ok){
      _deactHeld=toDeactivate.length;
      toDeactivate.length=0;
      saveErrors.push(`⚠ Held ${_deactHeld} removals — mass-deactivation blocked (run Sync Now to review & confirm)`);
      if(!manual)toast(`⚠ Sync held ${_deactHeld} row removals — check the sheet, then Sync Now to confirm`,'er');
    }
  }
  /* DEACTIVATE — archive anything anybody has touched, only ever delete a row
     that is genuinely untouched.
     The old test was "has it shipped?" — so a row with 40 units counted in, a
     packing note and a raised issue, but no shipment yet, was DELETED outright
     from the database the moment its tick box changed on the sheet. All of that
     work gone, with no trace even under Show Archived. Untick by accident, or
     retype a SKU, and it is unrecoverable.
     A row nobody has touched is just sheet noise and can go. Everything else
     gets archived: off the active sheet, still there, still findable. */
  const _hasWork=r=>!!(
    (parseInt(r.rcvd)||0)>0 ||
    (parseInt(r.cancelledQty)||0)>0 ||
    (r.notes||'').trim() ||
    (r.vaNote||'').trim() ||
    (r.issueType&&r.issueType!=='—') ||
    (parseInt(r.issueQty)||0)>0 ||
    r.resolution ||
    r.expectedDelivery ||
    r.delivered==='Yes' || r.wrongSku==='Yes' ||
    r.shipId || (r.allShipIds||[]).length || (r.shipSegments||[]).length ||
    r.sent==='Yes'
  );
  let _kept=0;
  for(const r of toDeactivate){
    try{
      if(_hasWork(r)){
        r.archived=true;r._dirty=true;
        await saveRow(r);
        _kept++;
      }else{
        // genuinely untouched — nothing to lose, remove it properly
        if(r.uuid){await sb.from('prep_rows').delete().eq('id',r.uuid);}
        rows.splice(rows.indexOf(r),1);
      }
      deactivated++;
    }catch(e){saveErrors.push('Remove error: '+r.sku+' — '+e.message);}
  }
  if(_kept)addSyncHistory(`[${srcLabel}] ${_kept} removed row${_kept===1?'':'s'} had work on them — archived, not deleted`,true);

  /* THE FAILSAFE. Everything the sheet said Yes to is now checked against what
     is genuinely in the app. Anything missing is reported with a reason rather
     than disappearing quietly. */
  _eligible.forEach(e=>{
    const landed=rows.some(r=>(r.sheetSyncId&&r.sheetSyncId===e.syncId)
      ||String(r.sku||'').toLowerCase()===String(e.sku||'').toLowerCase());
    if(!landed)_flag(e.sku,e.oid,'Did not make it into PrepHub',
      'The sheet says Yes and nothing rejected it, but no row exists here. Press Sync Now to retry — if it keeps failing, tell Jack.');
  });
  saveErrors.forEach(msg=>{
    const m=/([A-Za-z0-9._-]{4,})\s*$/.exec(String(msg)) ;
    _flag(m?m[1]:'', '', 'Could not be saved', String(msg).slice(0,160));
  });
  recordSyncIssues(srcLabel,_issues);
  // Per-source log entry with full detail
  const srcParts=[];
  if(added>0)srcParts.push(added+' added');
  if(updated>0)srcParts.push(updated+' updated');
  if(reactivated>0)srcParts.push(reactivated+' reactivated');
  if(deactivated>0)srcParts.push(deactivated+' removed');
  if(saveErrors.length)srcParts.push(saveErrors.length+' save error(s)');
  if(skuWarnings.length)srcParts.push(skuWarnings.length+' warning(s)');
  const srcMsg=`[${srcLabel}] `+(srcParts.length?srcParts.join(', '):'up to date');
  const srcOk=saveErrors.length===0;
  addSyncHistory(srcMsg,srcOk,true); // skip if nothing changed
  // Log individual errors
  saveErrors.forEach(e=>addSyncHistory('└ '+e,false));
  skuWarnings.slice(0,5).forEach(w=>addSyncHistory('└ ⚠ '+w,false));

  totalAdded+=added;totalUpdated+=updated;totalDeactivated+=deactivated;totalReactivated+=reactivated;
  if(saveErrors.length)totalErrors+=saveErrors.length;
  } // end sources loop

  if(totalAdded>0||totalUpdated>0||totalDeactivated>0||totalReactivated>0)renderPrep();
  const now=new Date();
  const nowStr=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const anyChange=totalAdded>0||totalUpdated>0||totalDeactivated>0||totalReactivated>0;
  const logParts=[];
  if(totalAdded>0)logParts.push(totalAdded+' added');
  if(totalUpdated>0)logParts.push(totalUpdated+' updated');
  if(totalReactivated>0)logParts.push(totalReactivated+' reactivated');
  if(totalDeactivated>0)logParts.push(totalDeactivated+' removed');
  if(totalErrors>0)logParts.push(totalErrors+' error(s)');
  const logMsg=logParts.length?logParts.join(', '):'Up to date — no changes';
  setSheetSyncLog(totalErrors>0?logMsg+' ⚠':logMsg,totalErrors>0);
  setSheetSyncStatus(nowStr,null);
  if(manual&&(anyChange||totalErrors>0))toast((totalErrors>0?'⚠ ':'')+'Sheet sync: '+logMsg,totalErrors>0?'er':null);
  if(manual&&!anyChange&&!totalErrors)toast('Sheet is up to date — no new rows');
  if(_ssBC)_ssBC.postMessage({type:'synced',lastRun:nowStr,log:logMsg});
  /* This only fired when the sync ADDED rows, so a sync that changed nothing
     left every existing row without a barcode and looked like Keepa was
     broken. The sweep is cache-first and returns immediately when there is
     nothing to do, so it is safe to run after every sync. */
  autoEanSweep();
  try{firstInDone(totalAdded);}catch(e){}
  _ssBusy=false;
  restartSheetSyncTimer();
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
// ── HTML ESCAPE HELPER ───────────────────────────────────────────────────────
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── MULTI-SOURCE MANAGEMENT ────────────────────────────────────────────────────────────────────
// Sources: [{id, label, url, tab, col, active}]
let _ssSources=[];

// SKUs/orders permanently excluded from sheet sync (tombstones). Lives in the
// shared app_settings table so it sticks for every device/user, not just here.
let _syncExcluded=[];
// Entries may be a legacy string ("sku|oid") or an object {syncId,sku,asin,prod,oid}.
function _exId(x){return typeof x==='string'?x:(x&&x.syncId)||'';}
async function loadSyncExcluded(){
  try{
    const{data}=await sb.from('app_settings').select('value').eq('key','sync_excluded').maybeSingle();
    if(data&&data.value){_syncExcluded=JSON.parse(data.value)||[];}
  }catch(e){console.warn('sync_excluded not loaded',e);}
  if(typeof renderSyncExcludedList==='function')renderSyncExcludedList();
}
async function saveSyncExcluded(){
  try{await sb.from('app_settings').upsert({key:'sync_excluded',value:JSON.stringify(_syncExcluded)},{onConflict:'key'});}
  catch(e){console.warn('sync_excluded save failed',e);}
}

async function loadSyncSources(){
  try{
    const{data}=await sb.from('app_settings').select('value').eq('key','sync_sources').maybeSingle();
    if(data?.value)_ssSources=JSON.parse(data.value);
  }catch(e){}
  // Migrate legacy single-source config into sources array
  if(!_ssSources.length&&_ssConfig.url){
    _ssSources=[{id:'src_1',label:'Primary Sheet',url:_ssConfig.url,tab:_ssConfig.tab||'',col:_ssConfig.col||'Added To Prep Portal',active:true}];
    await saveSyncSources();
  }
  renderSyncSourcesList();
  updateSyncHealthUI();
}

async function saveSyncSources(){
  try{
    const res=await sb.from('app_settings').upsert({key:'sync_sources',value:JSON.stringify(_ssSources)},{onConflict:'key'});
    if(res.error)throw res.error;
  }catch(e){
    console.error('[SyncSources] save failed:',e);
    toast('Failed to save sync sources: '+e.message,'er');
    return false;
  }
  const first=_ssSources.find(s=>s.active);
  if(first){_ssConfig.url=first.url;_ssConfig.tab=first.tab;_ssConfig.col=first.col||'Added To Prep Portal';}
  return true;
}

let _srcOwedT=null;
function renderSyncSourcesList(force){
  const el=document.getElementById('syncSourcesList');
  if(!el)return;
  /* Background events — a tab check finishing, the sheet's tab list arriving —
     were rebuilding this card while somebody was TYPING in it, stealing the
     cursor mid-word. If focus is inside the card, background repaints wait;
     the retry fires once typing stops. Direct user actions pass force=true. */
  const ae=document.activeElement;
  if(!force&&ae&&el.contains(ae)&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)){
    clearTimeout(_srcOwedT);
    _srcOwedT=setTimeout(()=>renderSyncSourcesList(false),900);
    return;
  }
  clearTimeout(_srcOwedT);
  if(!_ssSources.length){el.innerHTML='<div style="font-size:10px;color:var(--text3);padding:8px 0;">No sources configured — click + Add Source</div>';return;}
  // Two ACTIVE sources sharing one trigger column would double-pull the same
  // ticked rows from two different sheets — surface that as a clear warning
  // right on the cards involved, rather than letting it fail silently.
  const activeCols={};
  _ssSources.forEach(s=>{if(s.active&&s.col){const k=s.col.trim().toLowerCase();(activeCols[k]=activeCols[k]||[]).push(s.id);}});
  // Kick off tab discovery per sheet the first time sources render, so the
  // chips grade themselves (and typos surface) without opening the picker.
  _ssSources.forEach(s=>{const sid=_srcSheetId(s);
    if(sid&&window._sheetTabsCache&&_sheetTabsCache[sid]===undefined){
      _sheetTabsCache[sid]='loading';
      _fetchSheetTabs(sid).catch(()=>{});
    }});
  /* Jack: "reorder them so the old demo sheet is out of sight." A source that
     is switched off is history, not configuration — it should not sit above the
     one that is actually running. Live sources first, switched-off ones folded
     into a single line underneath. Display order only: `_ssSources` itself is
     untouched, so nothing about what is saved changes. */
  const _live=_ssSources.filter(x=>x.active), _off=_ssSources.filter(x=>!x.active);
  const card=(src,i)=>{
    const key=(src.col||'').trim().toLowerCase();
    const clash=src.active&&key&&activeCols[key]&&activeCols[key].length>1;
    return `
    <div style="background:var(--bg3);border:1px solid ${clash?'rgba(248,113,113,.55)':(src.active?'rgba(96,165,250,.4)':'var(--border)')};border-radius:6px;padding:10px 12px;">
      ${clash?`<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px 8px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);border-radius:5px;font-size:11px;color:#f87171;font-weight:700;">⚠ Same trigger column as another active source — both will pull the same ticked rows. Give this one its own column.</div>`:''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <input value="${esc(src.label)}" onchange="setSyncSourceField('${src.id}','label',this.value)"
          title="Click to rename this source \u2014 e.g. 2026 Purchase Tracker" class="srcName"
          style="font-size:13px;font-weight:800;color:var(--text);background:transparent;border:none;border-bottom:1px dashed transparent;outline:none;flex:1;cursor:text;padding:1px 2px;">
        <span style="font-size:10px;color:var(--text3);margin:0 8px 0 4px;white-space:nowrap;">\u270e click name to rename</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;padding:2px 6px;border-radius:10px;background:${src.active?'rgba(96,165,250,.2)':'rgba(100,116,139,.15)'};color:${src.active?'#60a5fa':'var(--text3)'};">${src.active?'ACTIVE':'OFF'}</span>
          <button onclick="toggleSyncSource('${src.id}')" style="padding:2px 8px;background:var(--bg4);border:1px solid var(--border2);color:var(--text2);border-radius:4px;font-size:10px;cursor:pointer;">${src.active?'Disable':'Enable'}</button>
          <button onclick="removeSyncSource('${src.id}')" style="padding:2px 6px;background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:4px;font-size:10px;cursor:pointer;">✕</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:2px;">Sheet URL</div>
          <input value="${esc(src.url)}" onchange="setSyncSourceField('${src.id}','url',this.value)" placeholder="https://docs.google.com/spreadsheets/d/…"
            style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);font-size:10px;font-family:var(--mono);">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:2px;">Tabs synced from this sheet</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;min-height:26px;padding:4px 6px;background:var(--bg);border:1px solid var(--border2);border-radius:5px;">
              ${_srcTabs(src).map(t=>{
                const st=window._tabCheck[_srcSheetId(src)+'|'+t];
                const bd=st==='bad'?'rgba(248,113,113,.5)':st==='ok'?'rgba(74,222,128,.4)':(st==='maybe'||st==='case')?'rgba(251,191,36,.5)':'rgba(96,165,250,.35)';
                const mk=st==='ok'?'<span title="Tab found on sheet" style="color:#4ade80;font-weight:900;">✓</span>':st==='bad'?'<span title="Tab NOT found on sheet — check spelling and capitals" style="color:#f87171;font-weight:900;">✗</span>':st==='maybe'?'<span title="Cannot confirm this tab — Google returns the FIRST tab for unknown names, and this looks identical to it. If this is not the first tab on your sheet, it is probably a typo — check the exact name." style="color:#fbbf24;font-weight:900;">?</span>':st==='case'?`<span onclick="event.stopPropagation();fixSrcTab('${src.id}','${esc(t).replace(/'/g,"\\'")}')" title="Found on the sheet as &quot;${esc(window._tabFix[_srcSheetId(src)+'|'+t]||'')}&quot; — click to auto-fix the capitalisation" style="cursor:pointer;color:#fbbf24;font-weight:900;">✎</span>`:st==='checking'?'<span title="Checking sheet…" style="color:#94a3b8;">⏳</span>':'';
                return `<span title="${st==='bad'?'Not found on the sheet — check spelling/capitals':''}" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;font-family:var(--mono);color:#60a5fa;background:rgba(96,165,250,.12);border:1px solid ${bd};border-radius:11px;padding:2px 8px;">${esc(t)}${mk}<span onclick="removeSrcTab('${src.id}','${esc(t).replace(/'/g,"\\'")}')" title="Remove tab" style="cursor:pointer;color:#f87171;font-weight:900;font-size:11px;line-height:1;">×</span></span>`;
              }).join('')}
              ${_srcTabs(src).length?'':'<span style="font-size:11px;color:var(--text3);">No tabs yet — add one</span>'}
              <button onclick="toggleTabPicker('${src.id}')" style="padding:2px 9px;background:rgba(96,165,250,.14);border:1px dashed rgba(96,165,250,.5);color:#60a5fa;border-radius:11px;font-size:10px;font-weight:800;cursor:pointer;">+ Add tab</button>
            </div>
            ${_tabPickerOpen===src.id?`
            <div style="margin-top:5px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px;">
              <input id="tabPickerSearch" value="${esc(_tabPickerQ)}" oninput="_tabPickerQ=this.value;_renderTabPickerList('${src.id}')" placeholder="Search tabs… or type a new tab name"
                style="width:100%;padding:6px 9px;background:var(--bg);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-size:11px;box-sizing:border-box;"
                onkeydown="if(event.key==='Enter'&&this.value.trim()){addSrcTab('${src.id}',this.value.trim());}if(event.key==='Escape'){toggleTabPicker(null);}">
              <div id="tabPickerList" style="max-height:170px;overflow-y:auto;margin-top:6px;"></div>
            </div>`:''}
          </div>
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:2px;">Trigger column</div>
            <input value="${esc(src.col||'Added To Prep Portal')}" onchange="setSyncSourceField('${src.id}','col',this.value)" placeholder="Added To Prep Portal"
              style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);font-size:10px;font-family:var(--mono);">
            <div style="font-size:10px;color:var(--text3);margin-top:3px;line-height:1.4;">Only <b style="color:#4ade80;">Yes</b> brings a row in. Anything else — N/A, blank, No, Old — simply does nothing.</div>
          </div>
        </div>

        ${/* Start-from date. The whole point of the move onto the real tracker:
              start from today rather than dragging in months of history. */''}
        <div style="margin-top:2px;padding:9px 10px;background:rgba(96,165,250,.07);border:1px solid rgba(96,165,250,.28);border-radius:6px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="flex:1;min-width:190px;">
              <div style="font-size:11px;font-weight:700;color:#93c5fd;margin-bottom:3px;">Only bring in rows dated from</div>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="date" value="${esc(src.from||'')}" onchange="setSyncFrom('${src.id}',this.value)"
                  style="padding:5px 8px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);font-size:11px;">
                <button onclick="setSyncFrom('${src.id}',todayISO())" title="Start from today — ignore everything already on the tab"
                  style="padding:5px 10px;background:rgba(96,165,250,.16);border:1px solid rgba(96,165,250,.45);color:#60a5fa;border-radius:4px;font-size:10.5px;font-weight:800;cursor:pointer;">Start from today</button>
                ${src.from?`<button onclick="setSyncFrom('${src.id}','')" title="Read the whole tab, however far back it goes"
                  style="padding:5px 9px;background:var(--bg4);border:1px solid var(--border2);color:var(--text3);border-radius:4px;font-size:10.5px;font-weight:700;cursor:pointer;">Clear</button>`:''}
              </div>
            </div>
          </div>
          <div style="font-size:10.5px;color:${src.from?'#93c5fd':'#fbbf24'};margin-top:7px;line-height:1.5;">
            ${src.from
              ? `Rows dated before <b>${esc(src.from)}</b> are not imported. Nothing is removed either way — this only limits what comes IN.`
              : `<b>No start date set</b> — every ticked row is imported, however far back it goes. Backdated orders come in fine. Set a date only if you want to ignore old ticked rows on a first import.`}
          </div>
        </div>

        ${/* One plain sentence saying what this source will actually do — the
              settings above are four separate boxes and it was easy to have the
              wrong file, right tab, and not notice. */''}
        ${/* The promise, stated where the settings are, because this is the
              thing that decides whether a mistake on the sheet can cost data. */''}
        <div style="margin-top:2px;padding:9px 11px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.3);border-radius:6px;font-size:11px;color:#9fe8bd;line-height:1.55;">
          <b style="color:#34d399;">The sheet can only ADD.</b>
          Nothing you type, clear, rename or paste on the sheet can take a row out of PrepHub.
          Un-ticking a row does nothing. To remove one, use <b>Remove &amp; exclude from sync</b> on the row itself.
        </div>
        <div style="margin-top:2px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--text2);line-height:1.55;">
          <b style="color:var(--text);">In plain English:</b>
          ${src.active?'':'<b style="color:#fbbf24;">This source is switched OFF, so nothing happens. </b>'}
          Reads <b style="color:#60a5fa;">${_srcTabs(src).length?esc(_srcTabs(src).join(', ')):'(no tab set)'}</b>
          from <b>${(()=>{const id=_srcSheetId(src);return id?(id.slice(0,10)+'…'):'(no sheet)';})()}</b>,
          and brings in every row where <b style="color:#4ade80;">${esc(src.col||'Added To Prep Portal')}</b> says <b style="color:#4ade80;">Yes</b>${src.from?` and the date is <b>${esc(src.from)}</b> or later`:''}.
          Quantity is read from <b>Total units **</b>, falling back to <b>Quanity Bought *</b> when that says N/A.
          Rows whose SKU contains a space are treated as notes and skipped.
        </div>
      </div>
    </div>
  `;};
  el.innerHTML=_live.map(card).join('')
    +(_off.length?`<details style="margin-top:4px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;">
      <summary style="cursor:pointer;list-style:none;padding:10px 12px;font-size:11.5px;font-weight:700;color:var(--text3);display:flex;align-items:center;gap:8px;">
        <span style="font-size:9px;">\u25b6</span>
        ${_off.length} switched-off source${_off.length===1?'':'s'}
        <span style="font-weight:400;color:var(--text3);">\u2014 ${esc(_off.map(x=>x.label||'Unnamed').join(', '))} \u00b7 not read, every row already brought in is kept</span>
      </summary>
      <div style="padding:0 10px 10px;">${_off.map(card).join('')}</div>
    </details>`:'')
    +(!_live.length?`<div style="margin-top:6px;padding:10px 12px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.4);border-radius:6px;font-size:11.5px;color:var(--accent);font-weight:700;">No source is switched on \u2014 nothing is being read from any sheet.</div>`:'');
}

function renderSyncExcludedList(){
  const el=document.getElementById('syncExcludedList');
  if(!el)return;
  if(!_syncExcluded.length){el.innerHTML='<div style="font-size:10px;color:var(--text3);padding:4px 0;">Nothing excluded.</div>';return;}
  const q=(document.getElementById('syncExcludedSearch')||{}).value||'';
  const term=q.trim().toLowerCase();
  // Normalise to objects (legacy entries are bare "sku|oid" strings).
  const items=_syncExcluded.map(x=>typeof x==='string'?{syncId:x,sku:x.split('|')[0],asin:'',prod:'',oid:x.split('|')[1]||''}:x);
  const filtered=term?items.filter(it=>((it.sku||'')+' '+(it.asin||'')+' '+(it.prod||'')).toLowerCase().includes(term)):items;
  if(!filtered.length){el.innerHTML=`<div style="font-size:10px;color:var(--text3);padding:4px 0;">No excluded rows match "${q}".</div>`;return;}
  el.innerHTML=filtered.map(it=>{
    const oid=it.oid&&it.oid!=='nooid'?'Order '+it.oid:'no order id';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:7px 10px;">
      <div style="min-width:0;">
        <div style="font-size:11px;font-family:var(--mono);font-weight:700;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.sku||'—'}</div>
        <div style="font-size:8px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.asin?'ASIN '+it.asin+' · ':''}${it.prod?it.prod.slice(0,40)+' · ':''}${oid}</div>
      </div>
      <button onclick="unExcludeSync('${_exId(it).replace(/'/g,"\\'")}')" style="flex-shrink:0;padding:3px 10px;background:var(--btn-blue-bg);border:1px solid var(--btn-blue-border);color:var(--btn-blue-text);border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;">Re-allow</button>
    </div>`;
  }).join('');
}
async function unExcludeSync(id){
  _syncExcluded=_syncExcluded.filter(x=>_exId(x)!==id);
  await saveSyncExcluded();
  renderSyncExcludedList();
  toast('Re-allowed — it can sync back from the sheet again');
}

/* ── Tab chips & picker ─────────────────────────────────────────────────────
   Tabs are still stored as a comma-separated string in src.tab (so the sync
   engine and saved settings are untouched) — the chips UI is purely a nicer
   way to edit that string. The picker tries to auto-discover the sheet's tab
   list via the sync edge function (listTabs=1); if the function doesn't
   support that yet, it falls back to suggesting tabs already configured on
   the same sheet, plus free-typing any tab name. */
let _tabPickerOpen=null,_tabPickerQ='';
/* Tab verification: we can't LIST a private sheet's tabs from the browser
   (Google blocks that), but we CAN test any tab name against the real sheet
   through the same edge function the sync uses. Each chip shows its state:
   ⏳ checking → ✓ found on sheet / ✗ not found (typo or wrong case). */
window._tabCheck=window._tabCheck||{};
window._tabSentinel=window._tabSentinel||{};
async function _fetchTabCsv(sheetId,tab){
  const efUrl=`${SUPA_URL}/functions/v1/sheet-sync?sheetId=${encodeURIComponent(sheetId)}&tab=${encodeURIComponent(tab)}`;
  const res=await fetch(efUrl,{cache:'no-store',headers:{'Authorization':`Bearer ${SUPA_KEY}`}});
  const json=res.ok?await res.json():{error:'http '+res.status};
  return (json&&json.csv&&!json.error)?String(json.csv):null;
}
async function _verifyTab(sheetId,tab){
  const key=sheetId+'|'+tab;
  if(!sheetId||!tab)return;
  if(_tabCheck[key]==='ok'||_tabCheck[key]==='checking')return;
  _tabCheck[key]='checking';renderSyncSourcesList();
  try{
    // Google quirk: asking the export for a tab that DOESN'T exist silently
    // returns the sheet's FIRST tab instead of an error. So "CSV came back"
    // proves nothing. We fetch a sentinel (a tab name that cannot exist) once
    // per sheet — that gives us the "fallback fingerprint". A real tab returns
    // something different from the fingerprint; a typo returns the same bytes.
    if(_tabSentinel[sheetId]===undefined){
      _tabSentinel[sheetId]=await _fetchTabCsv(sheetId,'__no_such_tab_'+Math.random().toString(36).slice(2,8));
    }
    const csv=await _fetchTabCsv(sheetId,tab);
    const sen=_tabSentinel[sheetId];
    if(csv===null)_tabCheck[key]='bad';
    else if(sen!==null&&csv.slice(0,2000)===sen.slice(0,2000))_tabCheck[key]='maybe'; // identical to the fallback — typo, or this IS the first tab
    else _tabCheck[key]='ok';
  }catch(e){_tabCheck[key]='bad';}
  renderSyncSourcesList();
}
function verifyAllTabs(){
  _ssSources.forEach(s=>{const sid=_srcSheetId(s);_srcTabs(s).forEach(t=>_verifyTab(sid,t));});
}
window._sheetTabsCache=window._sheetTabsCache||{};
function _srcTabs(src){return String(src.tab||'').split(',').map(t=>t.trim()).filter(Boolean);}
function _srcSheetId(src){const m=String(src.url||'').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);return m?m[1]:'';}
function addSrcTab(id,tab){
  const s=_ssSources.find(x=>x.id===id);if(!s||!tab)return;
  tab=tab.trim();if(!tab)return;
  const tabs=_srcTabs(s);
  if(tabs.some(t=>t.toLowerCase()===tab.toLowerCase())){toast('Tab already added');return;}
  tabs.push(tab);s.tab=tabs.join(', ');
  _tabPickerQ='';sheetSyncDirty();renderSyncSourcesList(true);
  _verifyTab(_srcSheetId(s),tab);  // live-check it against the sheet
  // keep the picker open so several tabs can be added in one go
  setTimeout(()=>{const i=document.getElementById('tabPickerSearch');if(i)i.focus();},40);
}
function removeSrcTab(id,tab){
  const s=_ssSources.find(x=>x.id===id);if(!s)return;
  s.tab=_srcTabs(s).filter(t=>t!==tab).join(', ');
  sheetSyncDirty();renderSyncSourcesList(true);
}
function toggleTabPicker(id){
  _tabPickerOpen=(_tabPickerOpen===id)?null:id;
  _tabPickerQ='';
  renderSyncSourcesList();
  if(_tabPickerOpen){
    const s=_ssSources.find(x=>x.id===_tabPickerOpen);
    _renderTabPickerList(_tabPickerOpen);
    setTimeout(()=>{const i=document.getElementById('tabPickerSearch');if(i)i.focus();},40);
    const sheetId=s?_srcSheetId(s):'';
    if(sheetId&&!_sheetTabsCache[sheetId]){
      _fetchSheetTabs(sheetId).then(()=>{if(_tabPickerOpen===id)_renderTabPickerList(id);});
    }
  }
}
async function _fetchSheetTabs(sheetId){
  try{
    const r=await fetch(`${SUPA_URL}/functions/v1/sheet-sync?sheetId=${encodeURIComponent(sheetId)}&listTabs=1`,
      {cache:'no-store',headers:{'Authorization':`Bearer ${SUPA_KEY}`}});
    if(r.ok){const j=await r.json();
      if(Array.isArray(j.tabs)&&j.tabs.length){_sheetTabsCache[sheetId]=j.tabs;_reconcileTabsWithList(sheetId,j.tabs);return j.tabs;}}
  }catch(e){}
  try{
    const tabs=await _discoverTabsXlsx(sheetId);
    if(tabs){_sheetTabsCache[sheetId]=tabs;_reconcileTabsWithList(sheetId,tabs);return tabs;}
  }catch(e){}
  _sheetTabsCache[sheetId]='unsupported';
  return null;
}
/* ── REAL TAB DISCOVERY — no server changes needed ──────────────────────────
   Google's XLSX export of a sheet is a ZIP file, and xl/workbook.xml inside it
   lists every tab name. Browsers can inflate ZIP entries natively via
   DecompressionStream, so we can read the true tab list entirely client-side
   (works whenever the sheet is link-readable, which this one is — the legacy
   CSV sync fetched it client-side). Order of attempts:
     1) edge function listTabs=1 (if you ever add it — fastest)
     2) XLSX export parse (works today)
     3) fallback: type + live-verify (unchanged)
   Once the real list is known, every chip is re-checked against it — including
   catching wrong capitalisation, which becomes a one-click fix. */
window._tabFix=window._tabFix||{};
async function _inflateRaw(u8){
  const ds=new DecompressionStream('deflate-raw');
  const s=new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function _zipOpen(buf){
  const u8=new Uint8Array(buf),dv=new DataView(buf);
  let e=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-70000);i--){
    if(dv.getUint32(i,true)===0x06054b50){e=i;break;}
  }
  if(e<0)return null;
  const count=dv.getUint16(e+10,true);
  let off=dv.getUint32(e+16,true);
  const entries=[];
  for(let i=0;i<count;i++){
    if(dv.getUint32(off,true)!==0x02014b50)break;
    const method=dv.getUint16(off+10,true);
    const csize=dv.getUint32(off+20,true);
    const nlen=dv.getUint16(off+28,true),xlen=dv.getUint16(off+30,true),clen=dv.getUint16(off+32,true);
    const lho=dv.getUint32(off+42,true);
    const name=new TextDecoder().decode(u8.subarray(off+46,off+46+nlen));
    entries.push({name,method,csize,lho});
    off+=46+nlen+xlen+clen;
  }
  return{u8,dv,entries};
}
async function _zipRead(z,name){
  const ent=z.entries.find(x=>x.name===name);if(!ent)return null;
  if(z.dv.getUint32(ent.lho,true)!==0x04034b50)return null;
  const nlen=z.dv.getUint16(ent.lho+26,true),xlen=z.dv.getUint16(ent.lho+28,true);
  const start=ent.lho+30+nlen+xlen;
  const data=z.u8.subarray(start,start+ent.csize);
  if(ent.method===0)return data;
  if(ent.method===8)return await _inflateRaw(data);
  return null;
}
function _xmlUnesc(s){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}

/* Opened straight off the Mac (file://) the browser gives us the origin "null",
   and Google refuses every cross-origin request from it. Nothing we can fix in
   code — so detect it, skip the doomed fetch, and say why. */
const LOCAL_FILE = (location.protocol === 'file:');
function _sheetsBlockedMsg(){
  return 'Sheet access needs the hosted app — a file opened from your Mac is blocked by Google (CORS).';
}

async function _discoverTabsXlsx(sheetId){
  if(LOCAL_FILE)return null;                       // would only produce a red console error
  const r=await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,{cache:'no-store'});
  if(!r.ok)return null;
  const buf=await r.arrayBuffer();
  const z=_zipOpen(buf);if(!z)return null;
  const wb=await _zipRead(z,'xl/workbook.xml');if(!wb)return null;
  const xml=new TextDecoder().decode(wb);
  const tabs=[...xml.matchAll(/<sheet[^>]*?\sname="([^"]+)"/g)].map(m=>_xmlUnesc(m[1]));
  return tabs.length?tabs:null;
}
/* With the true list in hand, re-grade every chip on sources for this sheet:
   exact match → ✓ · wrong capitalisation → one-click fix · absent → ✗ */
function _reconcileTabsWithList(sheetId,tabs){
  const lower=Object.create(null);
  tabs.forEach(t=>{lower[t.toLowerCase()]=t;});
  _ssSources.forEach(s=>{
    if(_srcSheetId(s)!==sheetId)return;
    _srcTabs(s).forEach(t=>{
      const key=sheetId+'|'+t;
      if(tabs.includes(t)){_tabCheck[key]='ok';delete _tabFix[key];}
      else if(lower[t.toLowerCase()]){_tabCheck[key]='case';_tabFix[key]=lower[t.toLowerCase()];}
      else{_tabCheck[key]='bad';delete _tabFix[key];}
    });
  });
  renderSyncSourcesList();
}
function fixSrcTab(id,oldTab){
  const s=_ssSources.find(x=>x.id===id);if(!s)return;
  const key=_srcSheetId(s)+'|'+oldTab;
  const canon=_tabFix[key];if(!canon)return;
  s.tab=_srcTabs(s).map(t=>t===oldTab?canon:t).join(', ');
  _tabCheck[_srcSheetId(s)+'|'+canon]='ok';
  sheetSyncDirty();renderSyncSourcesList(true);
  toast('Fixed to "'+canon+'" ✓');
}
function refreshSheetTabs(sheetId){
  delete _sheetTabsCache[sheetId];
  _fetchSheetTabs(sheetId).then(()=>_renderTabPickerList(_tabPickerOpen));
  _renderTabPickerList(_tabPickerOpen);
}

function _renderTabPickerList(id){
  const el=document.getElementById('tabPickerList');if(!el)return;
  const s=_ssSources.find(x=>x.id===id);if(!s)return;
  const q=(_tabPickerQ||'').toLowerCase();
  const mine=new Set(_srcTabs(s).map(t=>t.toLowerCase()));
  const sheetId=_srcSheetId(s);
  const disc=_sheetTabsCache[sheetId];
  const discovered=Array.isArray(disc)?disc:[];
  // fallback pool: every tab configured on any source pointing at the same sheet
  const pool=new Set(discovered);
  _ssSources.forEach(o=>{if(_srcSheetId(o)===sheetId)_srcTabs(o).forEach(t=>pool.add(t));});
  const opts=[...pool].filter(t=>!mine.has(t.toLowerCase())&&(!q||t.toLowerCase().includes(q))).sort((a,b)=>a.localeCompare(b));
  let h='';
  if(Array.isArray(disc))h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 4px 7px;border-bottom:1px solid var(--border);margin-bottom:5px;">
      <span style="font-size:11px;font-weight:700;color:#4ade80;">✓ ${disc.length} tab${disc.length===1?'':'s'} found on this sheet</span>
      <span onclick="refreshSheetTabs('${sheetId}')" title="Re-read the sheet" style="font-size:11px;color:#60a5fa;cursor:pointer;font-weight:700;">↻ refresh</span>
    </div>`;
  h+=opts.map(t=>`<div onclick="addSrcTab('${id}','${esc(t).replace(/'/g,"\\'")}')" style="padding:6px 9px;border-radius:5px;cursor:pointer;font-size:11px;color:var(--text2);display:flex;align-items:center;gap:7px;" onmouseover="this.style.background='rgba(96,165,250,.12)'" onmouseout="this.style.background=''"><span style="color:#60a5fa;">▸</span>${esc(t)}</div>`).join('');
  const exact=[...pool].some(t=>t.toLowerCase()===q)||mine.has(q);
  if(q&&!exact)h+=`<div onclick="addSrcTab('${id}','${esc(_tabPickerQ.trim()).replace(/'/g,"\\'")}')" style="padding:6px 9px;border-radius:5px;cursor:pointer;font-size:11px;color:#4ade80;font-weight:700;" onmouseover="this.style.background='rgba(74,222,128,.12)'" onmouseout="this.style.background=''">＋ Add "${esc(_tabPickerQ.trim())}"</div>`;
  if(!opts.length&&Array.isArray(disc)&&!q)h+=`<div style="padding:8px;font-size:10px;color:var(--text3);">All tabs on this sheet are already added ✓</div>`;
  if(!h)h=`<div style="padding:8px;font-size:10px;color:var(--text3);">${(disc==='unsupported')?'Type the tab name and press Enter — it will be checked against the sheet (✓/✗ on the chip).':'Reading the sheet\u2019s tab list\u2026'}</div>`;
  if(disc==='unsupported'&&opts.length===0&&!q){h+=`<div style="padding:6px 9px 2px;font-size:11px;color:var(--text3);border-top:1px solid var(--border);margin-top:4px;">Google doesn\'t let the browser list a private sheet\'s tabs. Typed tabs are verified live (✓/✗). Full tab listing needs a one-line addition to your sync function.</div>`;}
  el.innerHTML=h;
}
function addSyncSource(){
  const id='src_'+Date.now();
  // A brand-new source must never silently share a trigger column with an
  // existing one — that would double-pull the same rows from two sheets.
  // Give it a unique blank-ish default and flag it for the user to set.
  const n=_ssSources.length+1;
  _ssSources.push({id,label:'New Source '+n,url:'',tab:'',col:'',active:true});
  renderSyncSourcesList(true);sheetSyncDirty();
  toast('New source added — set its own Sheet URL and Trigger column before enabling');
}
function removeSyncSource(id){
  if(!confirm('Remove this sync source?'))return;
  const idx=_ssSources.findIndex(x=>x.id===id);
  if(idx>-1){_ssSources.splice(idx,1);renderSyncSourcesList();sheetSyncDirty();}
}
function setSyncSourceField(id,field,val){
  const s=_ssSources.find(x=>x.id===id);
  if(s){s[field]=val;sheetSyncDirty();}
}
/* The date needs its own handler because it must REDRAW. setSyncSourceField
   only marks the panel unsaved — fine for a text box you are typing in (a
   redraw there would steal focus mid-edit), useless for a button, which would
   change the value and appear to do absolutely nothing. */
function setSyncFrom(id,val){
  const s=_ssSources.find(x=>x.id===id);
  if(!s)return;
  s.from=val||'';
  sheetSyncDirty();
  renderSyncSourcesList();
  try{toast(val?('Will only read rows dated '+val+' or later — press Save Settings'):'Start date cleared — the whole tab will be read');}catch(e){}
}
function toggleSyncSource(id){
  const s=_ssSources.find(x=>x.id===id);
  if(s){s.active=!s.active;renderSyncSourcesList();sheetSyncDirty();}
}

// ── SYNC HISTORY & HEALTH ────────────────────────────────────────────────────────────────────
const _syncHistory=[];
let _syncHealthTimer=null;

// FIX 3: Persist history to Supabase so it survives refresh
async function saveSyncHistory(){
  try{await sb.from('app_settings').upsert({key:'sync_history',value:JSON.stringify(_syncHistory.slice(0,200))},{onConflict:'key'});}catch(e){}
}
async function loadSyncHistory(){
  try{
    const{data}=await sb.from('app_settings').select('value').eq('key','sync_history').maybeSingle();
    if(data?.value){
      const h=JSON.parse(data.value);
      _syncHistory.length=0;
      h.forEach(x=>_syncHistory.push(x));
    }
  }catch(e){}
}

function addSyncHistory(msg,ok=true,skipIfNoChange=false){
  // Skip "up to date" entries unless there was an error — keeps log clean
  if(skipIfNoChange&&ok&&msg.toLowerCase().includes('up to date'))return;
  const now=new Date();
  const iso=now.toISOString();
  const t=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  // Prune entries older than 7 days before adding new one
  const cutoff=Date.now()-7*24*60*60*1000;
  while(_syncHistory.length&&new Date(_syncHistory[_syncHistory.length-1].iso||0).getTime()<cutoff){
    _syncHistory.pop();
  }
  _syncHistory.unshift({t,iso,msg,ok});
  saveSyncHistory();
  updateSyncHealthUI();
}

// FIX 1: Calculate next sync time directly from interval, not from DOM element
function getNextSyncStr(){
  if(!_ssConfig.enabled||!_ssTimer)return 'Off';
  const ms=(_ssConfig.interval||120)*1000;
  const d=new Date(Date.now()+ms);
  return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
}

/* ── FIRST IN TODAY ────────────────────────────────────────────────────────
   Auto-sync only ticks inside an OPEN tab. Nobody open overnight means nothing
   came in overnight — and the app used to say nothing about it, so the early
   shift could work off yesterday's sheet without knowing. Jack's VA starts at
   05:00 UK, so a last-sync older than that means nobody has been on.
   It does NOT hand out a chore: opening the app already fires a catch-up within
   ~2 seconds, so the banner reports what is happening. */
const SHIFT_START_HOUR=5;
function _shiftStart(){
  const d=new Date(); d.setHours(SHIFT_START_HOUR,0,0,0);
  if(Date.now()<d.getTime())d.setDate(d.getDate()-1);   // before 5am, yesterday's shift
  return d;
}
let _firstInState=null;
function paintFirstInBanner(){
  const el=document.getElementById('firstInBanner'); if(!el)return;
  if(!_firstInState||!_firstInState.stale){el.innerHTML='';return;}
  const{syncing,added}=_firstInState;
  const box=(tint,title,sub)=>`<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:14px;border-radius:11px;background:rgba(${tint},.10);border:1px solid rgba(${tint},.45);">
      <div style="width:9px;height:9px;border-radius:50%;background:rgb(${tint});box-shadow:0 0 0 4px rgba(${tint},.15);flex:0 0 auto;"></div>
      <div style="min-width:0;">
        <div style="font-size:12.5px;font-weight:800;color:rgb(${tint});">${title}</div>
        <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:2px;">${sub}</div>
      </div>
      <button onclick="runSheetSync(true)" style="margin-left:auto;flex:0 0 auto;padding:6px 14px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:7px;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap;">Sync now</button>
    </div>`;
  if(syncing)el.innerHTML=box('251,191,36','Morning \u2014 you are first in today.',
    'Nobody has had this open since the early shift started, so nothing came in overnight. Catching up with the sheet now\u2026');
  else el.innerHTML=box('52,211,153','Caught up.',
    added>0?`${added} new row${added===1?'':'s'} came in from the sheet.`:'Nothing new on the sheet since yesterday.');
}
/* Decided from the history BEFORE the boot catch-up runs — otherwise that very
   sync makes it look as though somebody had been on. */
function decideFirstIn(){
  const cutoff=_shiftStart().getTime();
  const last=_syncHistory.find(h=>h.ok&&h.iso);
  const lastMs=last?new Date(last.iso).getTime():0;
  _firstInState={stale:!lastMs||lastMs<cutoff,syncing:true,added:0};
  paintFirstInBanner();
}
function firstInDone(added){
  if(!_firstInState||!_firstInState.stale||!_firstInState.syncing)return;
  _firstInState.syncing=false;_firstInState.added=added||0;
  paintFirstInBanner();
}
function updateSyncHealthUI(){
  /* the 30s tick was repainting Settings DOM even while the page was hidden —
     the audit's known battery waste. Same visibility gate as every page;
     goPage('settings') repaints on entry so nothing is lost. */
  if(document.hidden||!_pageActive('page-settings'))return;
  // FIX 2: Read sources directly — always up to date
  const active=_ssSources.filter(s=>s.active&&s.url);
  const get=id=>document.getElementById(id);
  // Status
  get('shHealthStatus').innerHTML=_ssConfig.enabled
    ?'<span style="color:#55ff55;">● Live</span>'
    :'<span style="color:var(--text2);">manual — Sync is the button on the Prep Sheet</span>';
  // Last sync
  const lastEntry=_syncHistory.find(h=>h.ok);
  get('shHealthLast').textContent=lastEntry?lastEntry.t:'Never';
  // FIX 1: Next sync from interval calc
  get('shHealthNext').textContent=_ssConfig.enabled&&_ssTimer?getNextSyncStr():'—';
  // FIX 2: Sources from _ssSources directly
  get('shHealthSources').textContent=active.length
    ?active.map(s=>s.label||(s.tab?s.tab+' tab':'Sheet')).join(', ')
    :'None configured';
  /* The count used to be every error in the log, so a fault you fixed ten
     minutes ago still shouted in red for the rest of the day — Jack fixed a
     trigger-column typo and the banner kept accusing him of it. Only errors
     SINCE the last good sync are still true; anything older is history. */
  const _firstOkIx=_syncHistory.findIndex(h=>h.ok);
  const _liveErrs=(_firstOkIx<0?_syncHistory:_syncHistory.slice(0,_firstOkIx));
  const errCount=_liveErrs.filter(h=>!h.ok).length;
  const _oldErrs=_syncHistory.filter(h=>!h.ok).length-errCount;
  if(get('shHealthHistory')){
    get('shHealthHistory').innerHTML=_syncHistory.length
      ?_syncHistory.map(h=>`<div style="display:flex;gap:6px;align-items:baseline;"><span style="color:var(--text3);font-family:var(--mono);flex-shrink:0;">${h.t}</span><span style="color:${h.ok?'var(--text2)':'#f87171'}">${h.ok?'':'⚠ '}${h.msg}</span></div>`).join('')
      :'No history yet';
    if(errCount>0){
      get('shHealthHistory').insertAdjacentHTML('afterbegin',
        `<div style="color:#f87171;font-size:11.5px;font-weight:800;margin-bottom:6px;">${errCount} error${errCount>1?'s':''} on the latest sync — not fixed yet</div>`);
    }else if(_oldErrs>0){
      get('shHealthHistory').insertAdjacentHTML('afterbegin',
        `<div style="color:#34d399;font-size:11.5px;font-weight:800;margin-bottom:6px;">Latest sync was clean \u00b7 <span style="font-weight:400;color:var(--text3);">${_oldErrs} older error${_oldErrs>1?'s':''} below, already sorted</span></div>`);
    }
  }
}

// FIX 5: Poll health UI every 30s so Next Sync time stays accurate on settings page
function startHealthUITimer(){
  if(_syncHealthTimer)clearInterval(_syncHealthTimer);
  _syncHealthTimer=setInterval(updateSyncHealthUI,30000);
}

// Called once after app data loads (so rows[] is populated for deduplication).
function bootSheetSync(){bootSheetSyncPrep();bootSheetSyncStart();}
/* Row-independent parts — safe to run in Phase A before the archive lands. */
function bootSheetSyncPrep(){
  loadSheetSyncUI();
  Promise.all([loadSyncSources(),loadSyncHistory(),loadSyncExcluded(),loadSyncIssues()]).then(updateSyncHealthUI);
  startHealthUITimer(); // FIX 5: keep health UI ticking
  initSheetSyncLeader();
}
/* The enabled-tail — actually STARTS syncing. Runs at finalize (or legacy boot):
   a sync that fired mid-gap would see archived rows as absent and re-add them. */
function bootSheetSyncStart(){
  if(_ssConfig.enabled){
    restartSheetSyncTimer();
    try{decideFirstIn();}catch(e){}
    setTimeout(()=>runSheetSync(false),2000);
  }
}
const SUPA_URL='https://vsekpaibspetreadkxyi.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzZWtwYWlic3BldHJlYWRreHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDE0NzcsImV4cCI6MjA5NDI3NzQ3N30.DVDI1nsBTyDbRPJDw_fcc7oohmH94erM07626xC4MtY';
const sb=supabase.createClient(SUPA_URL,SUPA_KEY,{
  auth:{
    persistSession:true,        // keep each laptop logged in across refreshes
    autoRefreshToken:true,      // silently refresh the session before it expires
    storageKey:'bdl-prephub-auth'
  }
});

// ── SYNC STATUS ───────────────────────────────────────────────────────────────
function setSyncStatus(status){
  const dot=document.getElementById('syncDot');
  if(!dot)return;
  if(dot.dataset.status===status)return;
  dot.dataset.status=status;
  const txt=document.getElementById('syncText');
  const ind=document.getElementById('syncIndicator');
  const styles={
    synced:{bg:'rgba(85,255,85,.1)',border:'rgba(85,255,85,.3)',color:'#55ff55',dot:'#55ff55',text:'Synced'},
    syncing:{bg:'rgba(255,170,51,.1)',border:'rgba(255,170,51,.3)',color:'#ffaa33',dot:'#ffaa33',text:'Syncing…'},
    error:{bg:'rgba(255,85,85,.1)',border:'rgba(255,85,85,.3)',color:'#ff5555',dot:'#ff5555',text:'Offline'},
  };
  const s=styles[status]||styles.synced;
  if(ind){ind.style.background=s.bg;ind.style.borderColor=s.border;ind.style.color=s.color;}
  if(dot)dot.style.background=s.dot;
  if(txt)txt.textContent=s.text;
}
