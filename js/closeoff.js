/* BDL PrepHub — js/closeoff.js — Action centre + the Close-off popup: proposing, which SKU, save & come back, Jack approving, qty correction, history lookup.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── THE ACTION CENTRE ─────────────────────────────────────────────────────────
async function addVaActions(row,tasks,detail){
  const now=new Date().toISOString();
  const rid=row.uuid||row.id;
  tasks.filter(t=>t&&t!=='No further action required').forEach(t=>{
    /* belt and braces on top of the double-submit guard — the same job on the
       same row can only be outstanding once */
    const _n=x=>String(x||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    const _t=_n(t);
    if(VA_ACTIONS.some(a=>{if(a.done||a.rid!==rid)return false;const o=_n(a.task);
      return o===_t||(o.length>12&&_t.length>12&&(o.includes(_t)||_t.includes(o)));}))return;
    VA_ACTIONS.unshift({
      id:'a'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36),
      rid:row.uuid||row.id,sku:row.sku||'',asin:row.asin||'',prod:row.prod||'',
      sup:row.sup||'',oid:row.oid||'',sheetRow:row.sheetRow||'',
      task:t,detail:detail||'',by:_who(),at:now,edited:now,done:false
    });
  });
  await saveVaActions();
}
/* Jack, 9 Sep: yes, move them. He presses the button — the app never rewrites
   live rows on its own. Match = the row's packing note still contains the exact
   text of the send-to-Jack question stored on the resolution. */
function pnFixList(){
  try{
    return (rows||[]).filter(r=>{
      const n=String(r.notes||'').trim(); if(!n) return false;
      const an=String(((r.resolution||{}).note)||'').trim();
      return !!an && n.indexOf(an)!==-1;
    });
  }catch(e){return [];}
}
function pnFixPaint(){
  const c=document.getElementById('pnFixCount'),w=document.getElementById('pnFixWhich'),b=document.getElementById('pnFixGo');
  if(!c)return;
  const l=pnFixList();
  c.textContent=l.length?`${fmt(l.length)} row${l.length===1?'':'s'} to move`:'Nothing to move';
  if(w)w.textContent=l.length?'each one keeps its text — it just moves to the right column':'every send-to-Jack note is already on the VA note';
  if(b){b.disabled=!l.length;b.style.opacity=l.length?'1':'.45';b.style.cursor=l.length?'pointer':'not-allowed';}
}
function pnFixPreview(){
  const l=pnFixList();
  if(!l.length){toast('Nothing to move — they are all on the VA note already','ok');return;}
  showConfirm('The notes that would move',
    l.slice(0,25).map(r=>`<b>${esc(r.sku||r.prod||'—')}</b><br>${esc(String(r.notes||'').replace(/\n/g,' · ').slice(0,110))}`).join('<br><br>')
    +(l.length>25?`<br><br>…and ${fmt(l.length-25)} more.`:'')
    +'<br><br>Nothing has changed yet.',null,{icon:'\uD83D\uDCCB',hideOk:true,cancel:'Close'});
}
async function pnFixRun(){
  const l=pnFixList();
  if(!l.length){toast('Nothing to move','ok');return;}
  showConfirm('Move them to the VA note?',
    `<b>${fmt(l.length)} row${l.length===1?'':'s'}.</b><br>The text is copied to the VA note with who wrote it and when, then taken out of packing notes. Undo is not automatic — take a backup first if you want one.`,
    async ()=>{
      let done=0,failed=0;
      for(const r of l){
        const an=String(((r.resolution||{}).note)||'').trim();
        const n=String(r.notes||'');
        if(!an||n.indexOf(an)===-1)continue;
        const who=((r.resolution||{}).by)||'Sarah';
        const at=(r.resolution||{}).at?new Date(r.resolution.at):null;
        const dd=at&&!isNaN(at)?_ddUK(at):'';
        r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${who}${dd?' '+dd:''} \u2192 Jack: ${an}`;
        r.vaNoteBy=who;r.vaNoteAt=(r.resolution||{}).at||new Date().toISOString();
        /* anything the warehouse typed alongside it stays where it is */
        r.notes=n.replace(an,'').replace(/\n{2,}/g,'\n').trim();
        r._dirty=true;
        try{await saveRow(r);done++;}catch(e){failed++;}
      }
      logAudit('Packing notes tidied',`${done} moved to the VA note${failed?' · '+failed+' failed':''}`);
      toast(failed?`${done} moved — ${failed} did not save, try again`:`\u2713 ${done} note${done===1?'':'s'} moved to the VA note`,failed?'er':'ok');
      pnFixPaint();try{renderPrep();}catch(e){}try{renderAdmin();}catch(e){}
    },{icon:'\u2192',ok:'Move them'});
}
function psFixPaint(){
  const c=document.getElementById('psFixCount'),w=document.getElementById('psFixWhich'),b=document.getElementById('psFixGo');
  if(!c)return;
  const l=_limboRows(),st=_staleLateRows(),si=_staleIssueRows(),sn=_shippedNotSentRows();
  const traced=l.filter(r=>!_settleClosedUnits(_psClone(r),(r.resolution||{}).what).toBecki).length;
  const toBecki=l.length-traced;
  const v=l.reduce((a,r)=>a+(parseSKU(r.sku).cogs||0)*_owedUnits(r),0);
  const n=l.length+st.length+si.length+sn.length;
  c.textContent=n?`${fmt(n)} row${n===1?'':'s'} to put right`:'Nothing to put right';
  if(w)w.textContent=n?[traced?`${fmt(traced)} settled here`:'',toBecki?`${fmt(toBecki)} to Becki to check the shelves`:'',st.length?`${fmt(st.length)} stale “Late” label${st.length===1?'':'s'}`:'',si.length?`${fmt(si.length)} resolved issue flag${si.length===1?'':'s'} still showing red`:'',sn.length?`${fmt(sn.length)} fully shipped but still marked Part Sent`:''].filter(Boolean).join(' · ')+(v?` — ${fmtGBP2(v)} at COG`:''):'every closed row balances';
  if(b){b.disabled=!n;b.style.opacity=n?'1':'.45';b.style.cursor=n?'pointer':'not-allowed';}
}
function _psClone(r){return JSON.parse(JSON.stringify({exp:r.exp,rcvd:r.rcvd,ship:r.ship,cancelledQty:r.cancelledQty,status:r.status,archived:r.archived,transitAction:r.transitAction,resolution:r.resolution,sku:r.sku}));}
function _psPreviewLine(r){
  const st=_settleClosedUnits(_psClone(r),(r.resolution||{}).what);
  return `<b>${esc(r.prod||r.sku||'—')}</b><br>${esc(_resText((r.resolution||{}).what))} · ${fmt(_owedUnits(r))} still out → ${st.toBecki?'<span style="color:#22d3ee;">to Becki to check the shelves</span>':esc(st.note||'no change')}`;
}
function psFixPreview(){
  const l=_limboRows(),st=_staleLateRows(),si=_staleIssueRows(),sn=_shippedNotSentRows();
  if(!l.length&&!st.length&&!si.length&&!sn.length){toast('Nothing to put right','ok');return;}
  const body=l.slice(0,25).map(_psPreviewLine).join('<br><br>')
    +(l.length>25?`<br><br>…and ${fmt(l.length-25)} more.`:'')
    +(st.length?`<br><br><b>Stale “Late” labels to clear</b><br>`+st.slice(0,10).map(r=>esc(r.prod||r.sku||'—')+' — nothing outstanding').join('<br>'):'')
    +(si.length?`<br><br><b>Resolved issues still showing red on the Prep Sheet</b><br>`+si.slice(0,12).map(r=>esc(r.prod||r.sku||'—')+' — '+esc(r.issueType||'')+(r.issueQty?' · '+fmt(r.issueQty):'')+', claim closed, nothing owed').join('<br>'):'')
    +(sn.length?`<br><br><b>Fully shipped, still marked Part Sent → Sent to Amazon</b><br>`+sn.slice(0,12).map(r=>esc(r.prod||r.sku||'—')+' — '+fmt(r.ship)+' shipped, nothing owed, nothing left to ship').join('<br>'):'');
  showConfirm('What this would do',body+'<br><br>Nothing has changed yet.',null,{icon:'\uD83D\uDCCB',hideOk:true,cancel:'Close'});
}
async function psFixRun(){
  const l=_limboRows(),stale=_staleLateRows(),si=_staleIssueRows(),sn=_shippedNotSentRows();
  const _tot=l.length+stale.length+si.length+sn.length;
  if(!_tot){toast('Nothing to put right','ok');return;}
  showConfirm('Put these rows right?',`<b>${fmt(_tot)} row${_tot===1?'':'s'}.</b><br>Units Sarah traced to another SKU are accounted for and those rows come off the Prep Sheet. Units nothing accounts for go to Becki to check the shelves. Stale “Late” labels and red issue flags left on rows whose claim is already closed are cleared. Nothing is deleted — every claim stays in the record.`,
    async()=>{let done=0,becki=0,labels=0,failed=0;
      for(const r of l){
        const st=_settleClosedUnits(r,(r.resolution||{}).what);
        if(st.toBecki){await _sendToBeckiShelves(r,`${fmt(_owedUnits(r))} unaccounted for after \u201C${_resText((r.resolution||{}).what)}\u201D`);
          try{await saveRow(r);becki++;try{logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — ${st.note}`);}catch(e){}}catch(e){failed++;}
          continue;}
        if(!st.changed)continue;
        r._dirty=true;
        try{await saveRow(r);done++;try{logAudit('Closed row settled',`${r.sku||r.asin||''} — ${st.note}`);}catch(e){}}catch(e){failed++;}}
      for(const r of stale){r.transitAction='';r._dirty=true;
        try{await saveRow(r);labels++;try{logAudit('Stale Late label cleared',`${r.sku||r.asin||''} — nothing outstanding`);}catch(e){}}catch(e){failed++;}}
      let flags=0;
      for(const r of si){const was=(r.issueType||'')+(r.issueQty?' · '+r.issueQty:'');
        r.issueType='';r.issueQty='';r._dirty=true;
        try{await saveRow(r);flags++;try{logAudit('Resolved issue flag cleared',`${r.sku||r.asin||''} — ${was}, claim closed and nothing owed`);}catch(e){}}catch(e){failed++;}}
      let sentN=0;
      for(const r of sn){r.status='Sent to Amazon';r.sent='Yes';if(!r.sentDate)r.sentDate=((r.shipSegments||[]).slice(-1)[0]||{}).date||new Date().toISOString().slice(0,10);r._dirty=true;
        try{await saveRow(r);sentN++;try{logAudit('Status moved to Sent to Amazon',`${r.sku||r.asin||''} — everything it held had shipped, nothing owed`);}catch(e){}}catch(e){failed++;}}
      const bits=[done?`${done} settled`:'',becki?`${becki} to Becki`:'',labels?`${labels} label${labels===1?'':'s'} cleared`:'',flags?`${flags} issue flag${flags===1?'':'s'} cleared`:'',sentN?`${sentN} moved to Sent to Amazon`:''].filter(Boolean).join(' · ');
      toast(failed?`${bits} — ${failed} did not save, try again`:`\u2713 ${bits}`,failed?'er':'ok');
      psFixPaint();try{renderPrep();renderAdmin();renderDashboard();}catch(e){}
    },{icon:'\u2192',ok:'Put them right'});
}
/* several copies of one job, one press, one save */
async function doneVaActions(ids){
  const hit=(ids||[]).map(id=>VA_ACTIONS.find(x=>x.id===id)).filter(Boolean);
  if(!hit.length)return;
  const now=new Date().toISOString();
  hit.forEach(a=>{a.done=true;a.doneBy=_who();a.doneAt=now;a.edited=now;});
  await saveVaActions();
  renderAdmin();
  try{renderDashboard();}catch(e){}
  logAudit('Follow-up done',hit[0].task+' · '+(hit[0].sku||hit[0].prod||'')+(hit.length>1?' · '+hit.length+' copies':''));
}
async function doneVaAction(id){
  const a=VA_ACTIONS.find(x=>x.id===id);if(!a)return;
  a.done=!a.done;
  a.doneBy=a.done?_who():'';
  a.doneAt=a.done?new Date().toISOString():'';
  a.edited=new Date().toISOString();
  await saveVaActions();
  renderAdmin();
  try{renderDashboard();}catch(e){}
  logAudit(a.done?'Follow-up done':'Follow-up reopened',a.task+' · '+(a.sku||a.prod||''));
}

// ── PROPOSING A CLOSURE ───────────────────────────────────────────────────────
let _srtRid=null;
let _tfuSort='priority',_tfuDir=1,_admQ='',_admKind='all',_jkQ='',_jkKind='all',_jkSort='oldest',_jkSup='all',_jkAcct='all';
/* ── THE PRIORITY ORDER — built with Jack, 16 Aug, from his own worked example.
   His answer, in his words: the Wagner he sent back yesterday first; this
   morning's damage next (newer AND worth more); the 6-day-old shortage third;
   the dead DJI claim last ("way too late to claim"). So: how recently it
   landed on Sarah AND how much it costs to leave, never age alone.
   Lower score = higher up the page. Bands, then ordering inside each band: */
function _prioScore(i){
  const v=Math.min(Math.round(i.value||0),999999);
  if(i.sortedGrace)return 9e9;                       // done, undoable — bottom
  if(i.parkedRow)return 8.9e9;                       // parked on a date — bottom, undoable
  if(i.waiting)return 8e9+(i.days||0);               // with Jack — locked, sinks
  if(i.sentBack)return 0+(i.days||0)*1e3;            // 1. Jack replied — newest first
  if(i.kind==='job')return 1e8+(i.days||0)*1e3;      // 1b. jobs Jack sent over
  const L=refundLeft(i.date,i);
  /* Bands step by 1e8 so nothing inside a band can ever outscore the next one. */
  if(L!==null&&L>=0&&L<=7)return 2e8+L*1e6+(999999-v);      // 2. claim window shutting — money about to be lost
  if((i.days||0)<=7)return 3e8+(999999-v)*10+(i.days||0);   // 3. fresh (last 7 days) — biggest money first
  if(L!==null&&L>7)return 4e8+L*1e6+(999999-v);             // 4. still claimable — closest to shutting first
  return 5e8+(999999-v);                                     // 5. window gone — biggest money first
}
function tfuSort(k){
  /* Jack, 11 Sep: "add NEWEST FIRST" — the same age sort, the other way up */
  if(k==='newest'){_tfuSort='days';_tfuDir=-1;renderAdmin();return;}
  if(k==='days'){_tfuSort='days';_tfuDir=1;renderAdmin();return;}
  if(_tfuSort===k)_tfuDir=-_tfuDir; else{_tfuSort=k;_tfuDir=1;}
  renderAdmin();
}
function _rowById(rid){return rows.find(x=>x.uuid===String(rid)||String(x.id)===String(rid));}
function openSorted(rid,preset){
  logOpened(rid,'close it off');markSeen(rid);
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  /* The popup already knows what she answered on the row. Arrived + wrong SKU
     → that outcome, ready to confirm or change. Arrived with nothing else said
     → arrived and correct. Never arrived → the refund path. Arrived + wrongSku
     = No is a live stock hunt — nothing is assumed, she picks what she found. */
  if(!preset){
    if(r.delivered==='Yes'&&r.wrongSku==='Yes')preset='wrong-sku';
    else if(r.delivered==='Yes'&&!r.wrongSku)preset='arrived-ok';
    else if(r.delivered==='No')preset='no-refund';
  }
  _srtRid=rid;
  const units=r.exp||r.ship||0, got=parseInt(r.rcvd)||0, cx=parseInt(r.cancelledQty)||0;
  let el=document.getElementById('sortedModal');
  if(!el){el=document.createElement('div');el.id='sortedModal';el.className='overlay';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)closeSorted();});}
  el.innerHTML=`<div class="modal srtMod">
    <div class="srtHd">
      <div style="min-width:0;">
        <div class="srtTtl">Close this off</div>
        <div class="srtSub">${esc(r.prod||r.sku||'')}</div>
      </div>
      <button class="srtX" onclick="closeSorted()">✕</button>
    </div>
    <div class="srtFacts">${(()=>{
      const cell=(lab,v,cp)=>!v?'':`<div class="srtFact"><span class="srtFactL">${lab}</span>`+
        (cp?`<span class="srtFactV srtCopy" onclick="copyVal('${String(v).replace(/'/g,"\\'")}',this)" title="Click to copy">${esc(v)}</span>`
           :`<span class="srtFactV">${esc(v)}</span>`)+`</div>`;
      return [cell('Supplier',r.sup||'—'),
              cell('Order number',r.oid||'no order id',!!r.oid),
              cell('Account',r.acct),
              cell('Purchase Sheet line',r.sheetRow),
              cell('ASIN',r.asin,true),
              cell('Our SKU',r.sku,true)].filter(Boolean).join('');
    })()}
    </div>

    <div class="srtBody">
      <div id="srtDraftBar" class="srtDraft" style="display:none;"></div>
      ${(()=>{
        const left=refundLeft(r.date,r);
        if(left===null)return'';
        const cls=left<0?'gone':(left<=7?'warn':'ok');
        return`<div class="srtClock ${cls}">${left<0?`<b>${Math.abs(left)}</b> days past the ${REFUND_DAYS}-day refund window — a claim may no longer be possible`
          :left===0?`<b>Last day</b> to claim a refund on this order — the ${REFUND_DAYS}-day window shuts tonight`
          :`<b>${left}</b> day${left===1?'':'s'} left to claim a refund on this order`}</div>`;
      })()}
      <label class="srtLab" style="margin-top:14px;">What happened?
        <button type="button" id="srtChange" onclick="srtChangePick()" style="display:none;float:right;
          background:none;border:none;cursor:pointer;font:inherit;font-size:11px;font-weight:800;
          color:var(--accent);text-transform:none;letter-spacing:0;">change</button></label>
      <input type="hidden" id="srtWhat" value="">
      <div class="srtPick">
        ${RESOLUTIONS.map(o=>`<button type="button" class="srtCard k-${o.kind}" data-v="${o.v}" onclick="srtPick('${o.v}')">
          <span class="srtCardT">${esc(o.t)}</span>
          <span class="srtCardD">${esc(o.d||'')}</span>
          <span class="srtCardK">${o.kind==='gated'?'Jack decides':o.kind==='biz'?'Jack decides':o.kind==='date'?'Not a closure':'You can close it'}</span>
        </button>`).join('')}
      </div>
      <div id="srtRest" style="display:none;">
      <div id="srtColL">
      <div id="srtKind" class="srtWarn" style="display:none;background:rgba(96,165,250,.1);border-color:rgba(96,165,250,.4);color:#93c5fd;"></div>
      <div id="srtAmzGate" class="srtWarn" style="display:none;margin-top:14px;background:rgba(96,165,250,.1);border-color:rgba(96,165,250,.45);color:#93c5fd;"></div>
      <div id="srtClaimWarn" class="srtWarn" style="display:none;">
        Stock is genuinely gone. Jack sees this flagged so the refund gets claimed.
      </div>

      <div id="srtAskPaid" style="display:none;margin-top:14px;">
        <label class="srtLab">Had the money already left the account?</label>
        <select id="srtPaid" class="srtSel" onchange="srtSync()">
          <option value="">— pick one —</option>
          <option value="no">No — cancelled before payment</option>
          <option value="yes">Yes — paid for, then refunded</option>
        </select>
        <div class="srtHint" id="srtPaidHint"></div>
      </div>
      <div id="srtAmzCx" class="srtWarn" style="display:none;margin-top:14px;background:rgba(74,222,128,.1);border-color:rgba(74,222,128,.4);color:#86efac;">
        Amazon order — cancelled units are refunded by Amazon automatically. Nothing to chase: note it on the Purchase Sheet and close it off.
      </div>

      <!-- Only asked when the money did leave the account. "Cancelled" and
           "refunded" are not the same thing, and the gap between them is the
           only part of a cancellation that can quietly cost money. -->
      <div id="srtAskRefund" style="display:none;margin-top:14px;">
        <label class="srtLab">Has the refund actually come back?</label>
        <select id="srtRefund" class="srtSel" onchange="srtSync()">
          <option value="">— pick one —</option>
          <option value="yes">Yes — the money is back in the account</option>
          <option value="no">No — we are still owed it</option>
        </select>
        <div class="srtHint" id="srtRefundHint"></div>
      </div>

      <div id="srtAskSku" style="display:none;margin-top:14px;">
        <label class="srtLab">Which SKU did it go out under? <span style="color:#f87171;">required</span></label>
        <div class="srtCombo">
          <input id="srtSku" class="srtSel" autocomplete="off" placeholder="Pick this product’s SKU from the list"
            oninput="srtSkuSearch()" onfocus="srtSkuSearch()" onkeydown="srtSkuKey(event)"
            onblur="setTimeout(srtSkuShut,130)">
          <div class="srtComboList" id="srtSkuList" style="display:none;"></div>
        </div>
        <div class="srtHint" id="srtSkuHint"></div>
        <div id="srtSkuWarn" class="srtSkuWarn" style="display:none;">
          <div id="srtSkuWarnTxt"></div>
          <input id="srtSkuWhy" class="srtSel" autocomplete="off" placeholder="Override — why is it still right? (it goes in the history)" oninput="srtSync()">
        </div>
      </div>

      <div id="srtAskShipid" style="display:none;margin-top:14px;">
        <label class="srtLab">Which FBA shipment did it go on?</label>
        <input id="srtShipId" class="srtSel" autocomplete="off" placeholder="FBA15ABCDEFG"
          style="text-transform:uppercase;font-family:var(--mono);letter-spacing:.04em;"
          oninput="this.value=this.value.toUpperCase();srtSync()">
        <div class="srtHint">The row is stamped as <b>Sent to Amazon</b> and joins that shipment on the Shipments page, exactly as if it had been stamped there.</div>
      </div>

      <div id="srtAskArrived" style="display:none;margin-top:14px;">
        <label class="srtLab">Has the stock actually arrived?</label>
        <select id="srtArrived" class="srtSel" onchange="srtSync()">
          <option value="">— pick one —</option>
          <option value="yes">Yes — it's here</option>
          <option value="no">No — nothing turned up</option>
        </select>
        <div class="srtHint" id="srtArrHint"></div>
      </div>

      <div id="srtDateBox" style="display:none;margin-top:14px;">
        <label class="srtLab">When is it due?</label>
        <input type="date" id="srtDate" class="srtSel" onchange="srtSync()">
        <div class="srtHint">This isn't a closure — the row stays live and drops off until that date.</div>
      </div>

      <div id="srtUnitsWrap">
      <label class="srtLab" style="margin-top:16px;" id="srtUnitsLab">The units</label>
      <div class="srtQty" id="srtUnitsBox">
        <div><span>Ordered</span><input type="number" id="srtOrd" value="${units}" readonly tabindex="-1" title="What the Purchase Sheet says was ordered. Wrong? Use “The sheet quantity is wrong…” — it records old → new and tells Jack." style="opacity:.75;cursor:not-allowed;"><a href="#" onclick="event.preventDefault();openQtyFix(_srtRid)" style="display:block;margin-top:3px;font-size:10.5px;font-weight:700;color:#93c5fd;">Sheet quantity wrong?</a></div>
        <div title="Becki’s count, booked in on the Prep Sheet — the close-off can’t change it"><span>Arrived</span><input type="number" id="srtGot" value="${got}" readonly tabindex="-1" style="cursor:not-allowed;color:var(--text2);"></div>
        <div><span>Cancelled</span><input type="number" id="srtCx" value="${cx}" onchange="srtSync()"></div>
        <div class="srtOut"><span>Still outstanding</span><b id="srtLeft">0</b></div>
        <div id="srtSettleNote" class="srtSettleNote" style="display:none;"></div>
      </div>
      <div class="srtHint" id="srtQtyHint"></div>
      <div class="srtHint" id="srtGotAsk" style="display:none;"></div>
      </div>
      </div>

      <div id="srtColR">
      <div id="srtFollowWrap">
      <label class="srtLab" style="margin-top:0;">What you need to do next</label>
      <ol class="srtSteps" id="srtSteps"></ol>
      <div class="srtHint" id="srtTodoHint" style="margin-top:8px;"></div>
      <details class="srtMore">
        <summary>Something else needs doing</summary>
        <div class="srtFollow">
          ${FOLLOW_UPS.map((f,n)=>`<label class="srtChk"><input type="checkbox" id="srtF${n}" value="${esc(f)}" onchange="srtSync()"><span>${esc(f)}</span></label>`).join('')}
        </div>
      </details>
      </div>

      <div id="srtNoteWrap">
        <label class="srtLab" style="margin-top:16px;">What did you find out? <span id="srtNoteReq" style="color:var(--text3);">optional</span></label>
        <textarea id="srtNote" class="srtNote" rows="4" oninput="srtSync()" placeholder="What the supplier said, what you checked, what actually happened…">${esc((()=>{
          /* Everything the case already knows, written out — she should not be
             retyping a history the app watched her create. */
          const c=_caseOf(r);
          if(!c||!(c.log||[]).length)return r.notes||'';
          return c.log.map(e=>`${new Date(e.at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'Europe/London'})} — ${e.what}${e.by?' ('+e.by+')':''}`).join('\n');
        })())}</textarea>
      </div>

      <div id="srtFixBox" style="display:none;">
        <label class="srtLab" style="margin-top:16px;">What do you suggest we do? <span id="srtFixReq" style="color:#f87171;">required</span></label>
        <!-- oninput, not just onchange. Without it "Send to Jack" stayed greyed
             out while she was looking straight at the recommendation she had
             just typed, until she happened to click something else. -->
        <textarea id="srtFix" class="srtNote" rows="2" oninput="srtSync()" placeholder="e.g. write it off, or claim the refund before the window shuts"></textarea>
      </div>
      </div>
      </div>
    </div>

    <div class="srtFoot">
      <div class="srtFootMsg" id="srtMsg"></div>
      <!-- Jack: "wanna be able to save on here… if i need to go off this to
           action xyz then come back to it". Everything typed and every step
           ticked is kept, and the next person to open the row picks it up. -->
      <button class="srtGhost" id="srtSaveBtn" style="display:none;" onclick="srtSaveDraft()"
        title="Keep what you've done so far and come back to it later">Save &amp; come back</button>
      <button class="srtGhost" onclick="closeSorted()">Cancel</button>
      <button class="srtGo" id="srtGo" onclick="srtAskClose()">Close it off</button>
    </div>
  </div>`;
  /* Paint once, settled. Showing it first meant a frame of unstyled layout
     before the picker sized itself — the flicker on open. */
  el.style.display='flex';
  el.style.opacity='0';
  _srtTicks={};
  const _draft=srtDraft(rid);
  if(_draft)_srtApplyDraft(_draft);
  else if(preset){srtPick(preset);
    if(preset==='part-cancelled'||preset==='cancelled'){
      const _cx=document.getElementById('srtCx');
      const _owed=Math.max(0,(parseInt(r.exp)||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0));
      if(_cx&&!(parseInt(_cx.value)||0)&&_owed>0){_cx.value=_owed;try{srtSync();}catch(e){}}
    }}
  else srtSync();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{el.style.transition='opacity .12s';el.style.opacity='1';}));
}
/* Picking is a click on a card, not a dropdown — it shows what each outcome
   means and who ends up owning it before you commit to one. */
function srtPick(v){
  const el=document.getElementById('srtWhat'); if(!el)return;
  el.value=(el.value===v)?'':v;
  const picked=el.value;
  /* One class per card. No inline display, no timers, no measuring — CSS hides
     the ones you didn't choose, so the swap is a single layout pass. */
  document.querySelectorAll('#sortedModal .srtCard').forEach(b=>{
    b.classList.toggle('on',b.dataset.v===picked);
  });
  const chg=document.getElementById('srtChange');
  if(chg)chg.style.display=picked?'inline':'none';
  const grid=document.querySelector('#sortedModal .srtPick');
  if(grid)grid.classList.toggle('picked',!!picked);
  /* The outcome already decides what happens next — spell it out rather than
     making her tick boxes to tell the app what it knows. */
  if(picked){
    const want=_resTodo(picked);
    FOLLOW_UPS.forEach((f,i)=>{const c=document.getElementById('srtF'+i);if(c)c.checked=want.includes(f);});
    _srtPaintSteps(picked,want);
  }
  const rest=document.getElementById('srtRest');
  if(rest){
    if(picked){
      /* Laid out and faded in together. The fade is opacity only, so it cannot
         move anything — there is nothing left to stagger with a timer. */
      rest.style.display='grid';
      requestAnimationFrame(()=>{const e=document.getElementById('srtRest');if(e)e.classList.add('in');});
    }
    else{rest.classList.remove('in');rest.style.display='none';}
  }
  /* The card grid just shrank from eleven rows to one, so whatever the body was
     scrolled to no longer exists. Put it back at the top deliberately, in the
     same pass, rather than leaving the browser to guess — guessing is what left
     the refund warning cut in half behind the header. */
  const body=document.querySelector('#sortedModal .srtBody');
  if(body)body.scrollTop=0;
  srtSync();
}
/* ── WHICH SKU DID IT GO OUT UNDER ────────────────────────────────────────────
   This was a <datalist>. Click it with the box empty and it offered every SKU
   in the app — four hundred of them, alphabetical, no context. Jack's point is
   that when something ships on the wrong SKU it is nearly always the SAME ASIN,
   so that is the only thing it offers until you type. Typing widens it to
   everything and matches SKU, product name or ASIN, same-ASIN rows still first.
   Jack, 29 Oct (the OneBlade): the answer has to be a SKU of THIS product. Anything
   else — another product's SKU, a SKU the app doesn't have — needs a reason in the
   override box, and a shipment ID is refused (_srtSkuJudge). */
let _srtSkuIx=-1;
function _srtSkuRows(q){
  const r=_rowById(_srtRid)||{};
  /* Jack, 30 Aug: "loads of this SKU on the shipments page — why isn't it
     suggesting any?" Because this EXCLUDED archived rows — and the rows that
     actually shipped are the archived ones. History is the whole point.
     Include everything, de-dupe by SKU, rows that shipped units first. */
  const all=rows.filter(x=>x.sku&&x.sku!==r.sku);
  const isSame=x=>!!(x.asin&&r.asin&&x.asin===r.asin);
  const dedupe=list=>{const seen=new Set(),out=[];
    for(const x of list.slice().sort((a,b)=>(parseInt(b.ship)||0)-(parseInt(a.ship)||0))){
      if(seen.has(x.sku))continue;seen.add(x.sku);out.push(x);}
    return out;};
  const same=dedupe(all.filter(isSame));
  q=(q||'').trim().toLowerCase();
  if(!q)return{list:same.slice(0,60),scoped:true};
  const hit=x=>((x.sku||'')+' '+(x.prod||'')+' '+(x.asin||'')).toLowerCase().includes(q);
  return{list:same.filter(hit).concat(dedupe(all.filter(x=>!isSame(x)).filter(hit))).slice(0,60),scoped:false};
}
function srtSkuSearch(){
  const inp=document.getElementById('srtSku'),box=document.getElementById('srtSkuList');
  if(!inp||!box)return;
  const r=_rowById(_srtRid)||{};
  const {list,scoped}=_srtSkuRows(inp.value);
  /* Jack, 29 Oct: Sarah picked Repl_02 and was refused. Each SKU of this product shows what it has spare
     (sfSkuSpare, counted from this order's date), the ones with spare first, so she picks one that fits. */
  const _sp={};
  if(typeof sfSkuSpare==='function')list.forEach(x=>{if(x.asin&&r.asin&&x.asin===r.asin){const v=sfSkuSpare(x.sku,r);if(v!==null)_sp[x.sku]=v;}});
  if(scoped)list.sort((a,b)=>((_sp[b.sku]||0)>0)-((_sp[a.sku]||0)>0));
  const n=list.length;
  const head=scoped
    ? (n?`${n} SKU${n===1?'':'s'} on this ASIN — type to search every SKU`
        :`No other SKU on this ASIN — type to search every SKU`)
    : `${n} match${n===1?'':'es'}`;
  box.innerHTML=`<div class="srtComboHd">${head}</div>`+(n
    ? list.map(x=>`<button type="button" class="srtComboOpt" data-sku="${esc(x.sku)}"
        onmousedown="event.preventDefault();srtSkuTake(this.dataset.sku)">
        <span class="srtComboSku">${esc(x.sku)}</span>
        <span class="srtComboProd">${(x.asin&&r.asin&&x.asin===r.asin)?'<b>same ASIN</b> · ':''}${esc((x.prod||'').slice(0,60))}</span>
        ${_sp[x.sku]!=null?`<span class="srtComboSpare ${_sp[x.sku]>0?'y':'n'}">${_sp[x.sku]>0?fmt(_sp[x.sku])+' spare — Amazon got more than its own orders':'0 spare — sent only its own orders'}</span>`:''}
      </button>`).join('')
    : `<div class="srtComboNone">Nothing matches — you can still type it in free-hand.</div>`);
  box.style.display='block';
  _srtSkuIx=-1;
  _srtComboFit();
  srtSync();
}
function srtSkuTake(sku){
  const inp=document.getElementById('srtSku');if(!inp)return;
  inp.value=sku;srtSkuShut();srtSync();
}
function srtSkuShut(){const b=document.getElementById('srtSkuList');if(b)b.style.display='none';_srtSkuIx=-1;}
function srtSkuKey(e){
  const box=document.getElementById('srtSkuList');
  if(!box||box.style.display==='none')return;
  if(e.key==='Escape'){srtSkuShut();return;}
  const opts=[...box.querySelectorAll('.srtComboOpt')];
  if(!opts.length)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();
    _srtSkuIx=Math.max(0,Math.min(opts.length-1,_srtSkuIx+(e.key==='ArrowDown'?1:-1)));
    opts.forEach((o,i)=>o.classList.toggle('sel',i===_srtSkuIx));
    opts[_srtSkuIx].scrollIntoView({block:'nearest'});
  }else if(e.key==='Enter'&&_srtSkuIx>=0){
    e.preventDefault();srtSkuTake(opts[_srtSkuIx].dataset.sku);
  }
}
/* .srtBody scrolls, and a scroll container clips. A dropdown opening past its
   bottom edge is simply invisible, which reads as the picker being broken. */
function _srtComboFit(){
  const box=document.getElementById('srtSkuList'),body=document.querySelector('#sortedModal .srtBody');
  if(!box||!body||box.style.display==='none')return;
  const over=box.getBoundingClientRect().bottom-(body.getBoundingClientRect().bottom-10);
  if(over>0)body.scrollTop+=over;
}
function srtChangePick(){
  const el=document.getElementById('srtWhat'); if(el)el.value='';
  const grid=document.querySelector('#sortedModal .srtPick');
  if(grid)grid.classList.remove('picked');
  document.querySelectorAll('#sortedModal .srtCard').forEach(b=>b.classList.remove('on'));
  const chg=document.getElementById('srtChange'); if(chg)chg.style.display='none';
  const rest=document.getElementById('srtRest'); if(rest){rest.classList.remove('in');rest.style.display='none';}
  const body=document.querySelector('#sortedModal .srtBody');
  if(body)body.scrollTop=0;
  srtSync();
}
/* Plain instructions, in order, in her words — not a checklist she has to
   interpret. Jack, 08 Aug: they are tick boxes now, worked through for real,
   and the issue does not close until every one is ticked. A ticked step is
   DONE, so it does not also become an Action Centre job — only the ones left
   unticked under an explicit override do. That is the whole difference between
   a list of instructions and a record of what actually happened. */
let _srtTicks={};
function _srtStepList(picked,want){
  const r=_rowById(_srtRid)||{};
  const paid=(document.getElementById('srtPaid')||{}).value||'';
  const refunded=(document.getElementById('srtRefund')||{}).value||'';
  const wentAs=((document.getElementById('srtSku')||{}).value||'').trim();
  const line=r.sheetRow?(', line '+r.sheetRow):'';
  const how={
    'Update Purchase Sheet':(picked==='part-cancelled')?('Open the Purchase Sheet'+line+' and write against order '+(r.oid||'no order ref')+': '+(parseInt(r.rcvd)||0)+' arrived, '+(parseInt((document.getElementById('srtCx')||{}).value)||0)+' cancelled.'):(picked==='cancelled')?('Open the Purchase Sheet'+line+' and write against order '+(r.oid||'no order ref')+': order cancelled, nothing arrived.'):'Open the Purchase Sheet'+line+' and write what happened in the notes — include this order number ('+(r.oid||'no order ref')+')'+(picked==='wrong-sku'||picked==='cancel-wrong-sku'?' and the SKU it went out under'+(wentAs?' ('+wentAs+')':''):'')+'.',
    'Remove from Prep Sheet':'This row comes off the active prep sheet — the app does that when you close it, and the sheet sync will no longer bring it back. The record is kept.',
    'Remove outstanding quantity':'Set the outstanding units to zero so it stops showing as on its way.',
    'Mark order as cancelled':'Mark the order cancelled on the account so nobody chases it again.',
    'Raise a claim for the loss':'Raise the claim with the supplier or Amazon before the window shuts.',
    'No further action required':'Nothing else to do.'
  };
  const out=(want||[]).map(t=>({k:t,text:how[t]||t}));
  if(picked==='wrong-sku'||picked==='cancel-wrong-sku')
    out.push({k:'sku-recorded',text:'Record on the sheet which SKU it actually went out under'+(wentAs?' — '+wentAs+'.':', so the stock can be traced.')});
  if(_resFull(picked))
    out.push({k:'full-off',text:'Take the whole line off the Purchase Sheet. Nothing arrived and nothing is coming, so it was never really a purchase.'});
  if(paid==='no')
    out.push({k:'paid-no',text:'Nothing to do about the money — it never left the account.'});
  if(paid==='yes')
    out.push({k:'paid-yes',text:'Note the refund against the purchase so the money stays traceable. Whether it has actually landed is tracked on Jack\u2019s money-owed list, not here.'});
  /* Jack, 9 Sep: an Amazon cancellation is "a simple tick, click" for Sarah.
     The account is his, the refund comes back by itself, and the app zeroes
     the outstanding units when the row closes — so the ONLY job she has is
     the Purchase Sheet. Four steps became one. */
  if(_amazonRow(r)&&/cancel/.test(String(picked||''))){
    const keep=out.filter(x=>x.k==='Update Purchase Sheet'||x.k==='sku-recorded');
    if(keep.length)return keep;
  }
  return out;
}
function _srtPaintSteps(picked,want){
  const ol=document.getElementById('srtSteps');if(!ol)return;
  const steps=_srtStepList(picked,want);
  /* Forget ticks for steps that no longer exist. Change an answer and the old
     list is gone — carrying its ticks forward would have the form claiming
     work was done that it is no longer even asking for. */
  const live=new Set(steps.map(s=>s.k));
  Object.keys(_srtTicks).forEach(k=>{if(!live.has(k))delete _srtTicks[k];});
  ol.innerHTML=(steps.length
    ? steps.map(s=>`<li class="srtStep${_srtTicks[s.k]?' done':''}">
        <label class="srtStepChk"><input type="checkbox" data-k="${esc(s.k)}"
          ${_srtTicks[s.k]?'checked':''} onchange="srtTick(this)">
        <span>${esc(s.text)}</span></label></li>`).join('')
    : '<li class="srtNone">Nothing else to do — closing it off is enough.</li>')
    +`<li style="list-style:none;margin-top:9px;display:flex;gap:9px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="csAct go" style="margin:0;" onclick="srtCopyMsg(this)">Copy the sheet note</button>
        <span style="font-size:10.5px;color:var(--text3);">written for you — order number, what happened, SKU, numbers, who closed it. Paste it straight into the sheet.</span></li>`;
  const hint=document.getElementById('srtTodoHint');
  if(hint){
    const left=steps.filter(s=>!_srtTicks[s.k]).length;
    hint.textContent=!steps.length?''
      :left?`Tick each one off as you actually do it — ${left} still to go.`
           :'All done — you can close it off now.';
    hint.style.color=!steps.length?'var(--text2)':(left?'#fbbf24':'var(--green)');
  }
}
/* Jack, 30 Aug: "make it more automated — you make a message that is copyable
   to paste in a column." The note the checklist used to ask her to hand-write. */
function srtCopyMsg(btn){
  const r=_rowById(_srtRid)||{};
  const d=_srtCollect();
  const bits=[
    _resText(d.what)||'closed off',
    d.wentAs?'went out under '+d.wentAs:'',
    [d.ord?d.ord+' ordered':'',d.got?d.got+' arrived':'',d.cx?d.cx+' cancelled':''].filter(Boolean).join(' / '),
    d.due?'expected '+d.due:'',
    d.note?'“'+d.note+'”':'',
    'closed by '+_who()+' '+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'Europe/London'})
  ].filter(Boolean).join(' · ');
  copyVal((r.oid?r.oid+' — ':'')+bits,btn);
}
function srtTick(el){
  const k=el.dataset.k;if(!k)return;
  if(el.checked)_srtTicks[k]=1; else delete _srtTicks[k];
  const li=el.closest('.srtStep');if(li)li.classList.toggle('done',!!el.checked);
  srtSync();
}
/* ── SAVE AND COME BACK ───────────────────────────────────────────────────────
   Jack: "wanna be able to save on here… if i need to go off this to action xyz
   then come back to it". Everything typed and every step ticked is kept against
   the row, and it is SHARED — he asked to see Sarah's half-finished working, not
   have it sit invisibly in her browser. */
function _srtCollect(){
  const g=id=>String((document.getElementById(id)||{}).value||'');
  return{what:g('srtWhat'),paid:g('srtPaid'),refunded:g('srtRefund'),arrived:g('srtArrived'),
    due:g('srtDate'),wentAs:g('srtSku').trim(),ord:g('srtOrd'),got:g('srtGot'),cx:g('srtCx'),
    note:g('srtNote'),fix:g('srtFix'),
    follow:FOLLOW_UPS.filter((f,n)=>{const c=document.getElementById('srtF'+n);return c&&c.checked;}),
    ticks:Object.keys(_srtTicks),by:_who(),at:new Date().toISOString()};
}
/* Read-merge-write, like every other shared blob here. Both of them have the
   page open; a blind overwrite is exactly what ate her chase notes once before.
   Start from THEIR copy and lay ours on top, so a draft the other person began
   since this page loaded survives — and only ever remove the one row we have
   actually finished. */
let ROW_SEEN={};
let _seenT=null;
/* Jack, 3 Sep: "worth adding — only for Sarah's Admin page, I wanna know what
   she clicks." The audit log recorded what she DID but never what she LOOKED
   at, so the rows she opened and walked away from left no trace — and those
   are the interesting ones. Once per row per day, so a row she keeps coming
   back to in one sitting does not bury everything else. Jack's and Becki's
   looks are ignored, same rule as the seen flag. */
let _OPEN_LOG={};
function logOpened(rid,how){
  try{
    if(!rid)return;
    if(/^(jack|beck)/i.test(String(window.currentUserName||'').trim()))return;
    /* dayISO() lives in the Lavarion closure, not here — calling it threw and
       the try/catch swallowed it, so nothing was ever logged. Self-contained. */
    const k=String(rid),day=new Date().toISOString().slice(0,10);
    if(_OPEN_LOG[k]===day)return;
    _OPEN_LOG[k]=day;
    const r=rows.find(x=>String(x.uuid)===k||String(x.id)===k);
    const first=!ROW_SEEN[k]?' — first look':'';
    logAudit('Admin row opened',(r?`${String(r.prod||r.sku||'').slice(0,60)}${r.sku?' · '+r.sku:''}`:k)+(how?` (${how})`:'')+first);
  }catch(e){}
}
function markSeen(rid){
  try{
    if(!rid)return;
    if(/^(jack|beck)/i.test(String(window.currentUserName||'').trim()))return; /* only Sarah's look counts (Jack, 30 Aug) */
    const k=String(rid);
    if(ROW_SEEN[k])return;
    ROW_SEEN[k]={at:new Date().toISOString(),by:_who()};
    clearTimeout(_seenT);
    _seenT=setTimeout(async()=>{
      try{
        const r=await sb.from('app_settings').select('value').eq('key','row_seen').maybeSingle();
        let remote={};try{remote=JSON.parse((r.data&&r.data.value)||'{}')||{};}catch(e){}
        if(remote&&typeof remote==='object'&&!Array.isArray(remote))ROW_SEEN=Object.assign({},remote,ROW_SEEN);
        await _putSetting('row_seen',ROW_SEEN);
      }catch(e){}
    },1200);
  }catch(e){}
}
async function _saveDrafts(dropId){
  try{
    const r=await sb.from('app_settings').select('value').eq('key','srt_drafts').maybeSingle();
    let remote={};try{remote=JSON.parse((r.data&&r.data.value)||'{}')||{};}catch(e){}
    if(!remote||typeof remote!=='object'||Array.isArray(remote))remote={};
    const merged=Object.assign({},remote,SRT_DRAFTS);
    if(dropId)delete merged[String(dropId)];
    SRT_DRAFTS=merged;
    return await _putSetting('srt_drafts',merged);
  }catch(e){console.warn('[prephub] draft save',e);return false;}
}
function srtDraft(rid){return SRT_DRAFTS[String(rid)]||null;}
function srtDropDraft(rid){delete SRT_DRAFTS[String(rid)];return _saveDrafts(rid);}
async function srtSaveDraft(){
  const rid=_srtRid;if(!rid)return;
  const d=_srtCollect();
  if(!d.what){toast('Pick what happened first','er');return;}
  SRT_DRAFTS[String(rid)]=d;
  const btn=document.getElementById('srtSaveBtn');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const done=await _saveDrafts();
  const r=_rowById(rid);
  logAudit('Close-off saved for later',`${(r&&(r.sku||r.asin))||rid} — ${_resText(d.what)}`);
  closeSorted();
  if(done)toast('✓ Saved — pick it back up whenever you like');
  try{renderAdmin();}catch(e){}
}
function _srtApplyDraft(d){
  const set=(id,v)=>{const e=document.getElementById(id);if(e&&v!=null&&v!=='')e.value=v;};
  _srtTicks={};(d.ticks||[]).forEach(k=>{_srtTicks[k]=1;});
  set('srtPaid',d.paid);set('srtRefund',d.refunded);set('srtArrived',d.arrived);
  set('srtDate',d.due);set('srtSku',d.wentAs);
  set('srtCx',d.cx);   /* Ordered is the sheet's — never a saved draft's (b627) */   /* Arrived is Becki's live count, never a saved draft's (Jack, 29 Oct) */
  set('srtNote',d.note);set('srtFix',d.fix);
  if(d.what)srtPick(d.what);
  /* AFTER srtPick — it resets the follow-up boxes to the outcome's defaults,
     which would quietly undo anything she had changed by hand. */
  FOLLOW_UPS.forEach((f,n)=>{const c=document.getElementById('srtF'+n);if(c)c.checked=(d.follow||[]).includes(f);});
  const bar=document.getElementById('srtDraftBar');
  if(bar){
    const mine=(d.by||'')===_who();
    bar.innerHTML=`<b>Picked up where ${mine?'you':esc(d.by||'someone')} left off</b>
      <span>Saved ${d.at?esc(noteAgo(d.at)):'earlier'} — everything below is as ${mine?'you':'they'} left it.</span>
      <button type="button" onclick="srtStartAgain()">Start again</button>`;
    bar.style.display='flex';
  }
  srtSync();
}
/* Throwing away a draft is not the same as closing an issue, but it still
   destroys somebody's typing — so it asks, and it says whose. */
function srtStartAgain(){
  const rid=_srtRid;if(!rid)return;
  const d=srtDraft(rid);
  const who=(d&&d.by)||'someone';
  if(!confirm(`Clear the part-finished close-off ${who===_who()?'you':who} saved and start this again?\n\nNothing else is deleted — the row, its history and the audit log are untouched.`))return;
  srtDropDraft(rid);
  closeSorted();
  openSorted(rid);
  try{renderAdmin();}catch(e){}
}
/* The steps still outstanding, and the ones an override would turn into jobs. */
function _srtLeft(){
  const what=(document.getElementById('srtWhat')||{}).value||'';
  if(!what)return[];
  /* a step that says there is nothing to do is already done */
  return _srtStepList(what,_resTodo(what)).filter(s=>!_srtTicks[s.k]&&!/^nothing (to do|else)/i.test(String(s.text||''))
    &&!/the app does (that|it|this)/i.test(String(s.text||'')));   /* the tester, 29 Oct: Duplicate record asked her to tick 'the app does that' */
}
function closeSorted(){
  const el=document.getElementById('sortedModal');
  if(el){el.style.display='none';el.style.opacity='';el.style.transition='';}
  srtCfmShut();srtSkuShut();          // never leave a child popup orphaned on screen
  _srtTicks={};_srtOverride=false;
  _srtRid=null;
}
function srtSync(){
  const _rG=_rowById(_srtRid);
  const ord=parseInt((document.getElementById('srtOrd')||{}).value)||0;
  /* Jack, 29 Oct (the C920 — 2 typed into Arrived became 2 webcams that never existed): Arrived is Becki's count,
     read from the row. The box only shows it; nothing typed in this popup ever reaches r.rcvd. */
  const _gEl=document.getElementById('srtGot');
  const got=_rG?(parseInt(_rG.rcvd)||0):(parseInt((_gEl||{}).value)||0);
  if(_gEl&&String(_gEl.value)!==String(got))_gEl.value=got;
  const cx =parseInt((document.getElementById('srtCx') ||{}).value)||0;
  const left=ord-got-cx;
  const L=document.getElementById('srtLeft');
  const _pk=(document.getElementById('srtWhat')||{}).value||'';
  /* Jack, 29 Oct (the OneBlade): "that should be escalated to me" — an Amazon order's "it's here" outcomes wait
     for his account check (_srtAmzGate). Until then nothing settles, so nothing below says it will. */
  const _gate=_srtAmzGate(_pk,_rG);
  const _settles=!_gate&&left>0&&['arrived-ok','wrong-sku','cancel-wrong-sku','cancelled','duplicate'].includes(_pk);
  /* _settleClosedUnits (js/prep.js): "arrived and correct" traces nothing, so units still out go to Becki */
  const _toBecki=_settles&&_pk==='arrived-ok';
  if(L){L.textContent=left;L.style.color=_toBecki?'#22d3ee':(left===0||_settles?'var(--green)':(left<0?'#f87171':'#fbbf24'));L.title='';}
  /* Jack, 9 Sep: a closure used to leave the outstanding units exactly as they
     were, which is how five rows ended up closed on one page and open on the
     Prep Sheet. Now closing settles them — so the popup says so out loud
     rather than hiding it in a tooltip. */
  /* Jack, 29 Oct (the Canon SELPHY): it said "Closing books the 5 still out in as arrived" while the code sent
     them to Becki's shelf check. Each line now says what _settleClosedUnits actually does. */
  {const _sn=document.getElementById('srtSettleNote');
   if(_sn){
     const _sku=((document.getElementById('srtSku')||{}).value||'').trim();
     const _sj=_srtSkuJudge(_sku,_rG);
     const _skuW=_sj.kind==='same'?('<b>'+esc(_sj.sku)+'</b>'):'the other SKU';
     /* _statusFollowsStock files a row nothing ever landed on or left from; Remove from Prep Sheet archives the rest */
     const _off=['cancelled','duplicate'].includes(_pk)||(got===0&&!!_rG&&(parseInt(_rG.ship)||0)===0);
     _sn.style.display=_settles?'block':'none';
     _sn.style.color=_toBecki?'#67e8f9':'';_sn.style.background=_toBecki?'rgba(34,211,238,.08)':'';_sn.style.borderColor=_toBecki?'rgba(34,211,238,.4)':'';
     _sn.innerHTML=!_settles?'':(
       _pk==='arrived-ok'?`Closing does <b>not</b> book the <b>${fmt(left)}</b> still out in. They go to <b>Becki to check the shelves</b> &mdash; if she finds them she books them in and it clears; if not, it goes to Jack.`
       :(_pk==='wrong-sku'||_pk==='cancel-wrong-sku')?`Closing counts the <b>${fmt(left)}</b> still out as gone out under ${_skuW} &mdash; nothing stays owed on this row${_off?' and it comes off the Prep Sheet':''}.`
       :`Closing records the <b>${fmt(left)}</b> still out as cancelled &mdash; the row comes off the Prep Sheet.`);
   }}
  const hint=document.getElementById('srtQtyHint');
  if(hint){
    hint.textContent = left<0 ? 'That adds up to more than were ordered — check the numbers.'
      : left===0 ? 'Nothing outstanding — this stops showing as late anywhere in the app.'
      : _settles ? ''
      : left+' unit'+(left===1?'':'s')+' would still be treated as on the way.';
    hint.style.color = left<0?'#f87171':(left===0?'var(--green)':'#fbbf24');
  }
  const what=(document.getElementById('srtWhat')||{}).value||'';
  const warn=document.getElementById('srtClaimWarn');
  if(warn)warn.style.display=_resClaim(what)?'block':'none';
  const _r0=_rG;
  const kind=_resKind(what,_r0);
  const kEl=document.getElementById('srtKind');
  if(kEl&&what){
    kEl.style.display='block';
    kEl.textContent=_gate?'Amazon order — Jack checks the account first'
      :(kind==='biz'&&_r0&&_jackSupplier(_r0.sup)&&_resClaim(what))
      ? 'Amazon claim — Jack raises this, not you'
      : _kindWord(kind);
    const _blue=!!_gate||kind!=='ops';
    kEl.style.color=_blue?'#93c5fd':'#86efac';
    kEl.style.background=_blue?'rgba(96,165,250,.1)':'rgba(74,222,128,.1)';
    kEl.style.borderColor=_blue?'rgba(96,165,250,.4)':'rgba(74,222,128,.4)';
  }else if(kEl)kEl.style.display='none';
  /* Only ask what this outcome actually needs. Asking "did it arrive?" about a
     cancelled order is noise, and noise is why nobody fills these in. */
  const ask=_resAsk(what);
  const show=(id,on)=>{const e=document.getElementById(id);if(e)e.style.display=on?'block':'none';};
  /* Jack, 8 Sep: "if it's cancelled from Amazon the refund is n/a to her".
     Amazon refunds a cancelled unit by itself, so the money question is
     answered for her and hidden — one tick left: the Purchase Sheet. */
  /* Jack, 8 Sep, the rule: on an Amazon order anything refund-related is his —
     she sends it to him. So the money question never appears for her on an
     Amazon row, whichever cancellation outcome she picks. */
  const _amzCx=ask.includes('paid')&&_r0&&_amazonRow(_r0);
  if(_amzCx){const _p=document.getElementById('srtPaid');if(_p&&!_p.value)_p.value='no';}
  show('srtAskPaid',ask.includes('paid')&&!_amzCx);
  show('srtAmzCx',!!_amzCx);
  show('srtAskSku',ask.includes('sku'));
  show('srtAskArrived',ask.includes('arrived'));
  show('srtAskShipid',ask.includes('shipid'));
  show('srtDateBox',kind==='date');
  /* show() writes display:block; these are grid items whose column assignment
     only holds while the parent stays a grid — the parent is set in srtPick. */
  const uWrap=document.getElementById('srtUnitsWrap');
  const wantUnits=what&&kind!=='date'&&what!=='duplicate';
  if(uWrap)uWrap.style.display=wantUnits?'block':'none';
  /* the Amazon gate, said out loud */
  {const gb=document.getElementById('srtAmzGate');
   if(gb){gb.style.display=_gate?'block':'none';
     gb.innerHTML=!_gate?'':_gate.why==='not-arrived'
       ?`<b>Jack checked the account: it did not arrive.</b>${_gate.check&&_gate.check.note?` &ldquo;${esc(_gate.check.note)}&rdquo;`:''} &ldquo;${esc(_resText(what))}&rdquo; says it did, so it goes back to him with what you found. Nothing closes and no units move until he answers.`
       :`<b>Amazon order &mdash; Jack hasn&rsquo;t checked the account yet.</b> Only he can see whether it was delivered, so &ldquo;${esc(_resText(what))}&rdquo; goes to him first, with your note. Nothing closes and no units move until he answers &mdash; then it comes back to you to close.`;}}
  /* more arrived than Becki booked in? That is a shelf question, one press — never a number typed here */
  {const ga=document.getElementById('srtGotAsk');
   if(ga){const r0=_rG||{},owe=_owedUnits(r0),withB=!!(r0.resolution&&r0.resolution.amzDelivered&&!r0.resolution.amzDelivered.done);
     const on=!!what&&!!wantUnits&&owe>0;
     ga.style.display=on?'block':'none';
     if(on){const _amz=_amazonRow(r0),_ck=_amzJackCheck(r0),_jf=_amz&&!(typeof _isJack==='function'&&_isJack())&&!(_ck&&!_ck.no);
       ga.style.color='var(--text2)';
       ga.innerHTML=`Arrived is Becki&rsquo;s count &mdash; <b>${fmt(got)}</b> booked in. It can&rsquo;t be typed over here. `
         +(withB?'She is already checking the shelves for this one.'
           :_jf?`Think more arrived? It&rsquo;s an Amazon order, so Jack checks the account first. <button type="button" class="srtSwap" onclick="srtJackFirst()">Send to Jack &mdash; check the Amazon order first &rarr;</button>`
           :`Think more arrived? <button type="button" class="srtSwap" onclick="srtToBecki()">Ask Becki to check the shelves &rarr;</button>`);}}}

  const paid=(document.getElementById('srtPaid')||{}).value||'';
  /* Only worth asking once we know money left. "Cancelled" and "refunded" are
     two different events, and the gap between them is the only part of a
     cancellation that can quietly cost real money. */
  const refunded=(document.getElementById('srtRefund')||{}).value||'';
  /* Jack, 3 Sep: "has the refund come doesn't need to be there — that's not
     her job." Whether the money actually landed is watched on HIS Money-owed
     list, not asked of the person closing the row. */
  show('srtAskRefund',false);
  const rh=document.getElementById('srtRefundHint');
  if(rh){
    rh.textContent=refunded==='no'
      ?'The order still comes off the sheet — but this is logged as money owed back, and chasing it becomes a step below.'
      :refunded==='yes'?'Nothing outstanding. The refund gets noted against the purchase.':'';
    rh.style.color=refunded==='no'?'#fbbf24':'var(--text2)';
  }
  const wentAs=((document.getElementById('srtSku')||{}).value||'').trim();
  /* Jack, 29 Oct (the OneBlade: "FBA15M8T8MRG and FBA15MB9ZJ4L same SKU was sent" was accepted as a SKU):
     "went out under" is a SKU of THIS product, picked from the list (_srtSkuJudge). A shipment ID is refused
     outright; another product's SKU, this line's own SKU, or anything PrepHub doesn't know needs the override box
     with a reason — it goes in the history. */
  const _sj=ask.includes('sku')?_srtSkuJudge(wentAs,_rG):{kind:'na',sku:wentAs};
  const sh=document.getElementById('srtSkuHint');
  if(sh){
    const r0=_rG||{};
    const same=rows.filter(x=>!x.archived&&x.asin&&x.asin===r0.asin&&x.sku!==r0.sku).length;
    sh.textContent=!wentAs
      ? (same?`Goes on the Purchase Sheet note so it can be traced. ${same} other row${same===1?'':'s'} share this ASIN.`
             :'Goes on the Purchase Sheet note so it can be traced.')
      : _sj.kind==='same'?('Matched — a SKU of this product · '+String((_sj.row&&_sj.row.prod)||_sj.sku||'').slice(0,50))
      : _sj.kind==='shipid'?'That’s a shipment ID, not a SKU.'
      : _sj.kind==='other'?('A SKU of another product — '+String((_sj.row&&_sj.row.prod)||'').slice(0,50))
      : _sj.kind==='own'?'That is this line’s own SKU.'
      : 'Not a SKU PrepHub knows.';
    sh.style.color=!wentAs?'var(--text2)':(_sj.kind==='same'?'var(--green)':'#fbbf24');
  }
  /* Jack, 23 Oct — the Bosch: closed as "went out under Amg_12.44", but 12.44 was
     its own order of 5 and sent exactly 5. The answer could not have been right.
     Now the SKU named has to have sent MORE than its own orders (PrepHub, or
     SellerFuse via the latest check) — or someone overrides it with a reason. */
  const _rSku=_rG||{};
  const _need=Math.max(1,_owedUnits(_rSku)||0,(typeof _leftUnits==='function'?_leftUnits(_rSku):0)||0);
  const _spare=(_sj.kind==='same'&&typeof sfSkuSpare==='function')?sfSkuSpare(_sj.sku,_rSku):null;
  const _skuShort=_sj.kind==='same'&&_spare!==null&&_spare<_need;
  const _skuOther=['other','own','unknown'].includes(_sj.kind)?_sj.kind:'';
  const _skuShip=_sj.kind==='shipid';
  const _skuWhy=((document.getElementById('srtSkuWhy')||{}).value||'').trim();
  window._srtSkuCheck={sku:_sj.sku||wentAs,spare:_spare,need:_need,why:_skuWhy,short:_skuShort,other:_skuOther,shipid:_skuShip};
  {const w=document.getElementById('srtSkuWarn'),wt=document.getElementById('srtSkuWarnTxt'),wy=document.getElementById('srtSkuWhy');
    const _on=_skuShort||!!_skuOther||_skuShip;
    if(w)w.style.display=_on?'block':'none';
    if(wy)wy.style.display=_skuShip?'none':'';
    /* the C920: no SKU of the product had anything spare because the units never existed — say so */
    const _dupSk=_skuShort&&typeof _dupLineOf==='function'?_dupLineOf(_rSku):null;
    if(wt&&_on)wt.innerHTML=(_skuShip
        ?`<b>That's a shipment ID — pick the SKU it went out under.</b> ${(_sj.ids||[]).length>1?esc(_sj.ids.join(' and '))+' are shipments':'A shipment'} the units rode on, not the listing they went out as &mdash; the list shows this product&rsquo;s SKUs.`
        :_skuOther==='other'?`<b>${esc(_sj.sku)}</b> is a SKU of another product (${esc(String((_sj.row&&_sj.row.prod)||'').slice(0,60))}) &mdash; it can&rsquo;t be where this product went. Pick one of this product&rsquo;s SKUs from the list, or override with a reason.`
        :_skuOther==='own'?`<b>${esc(_sj.sku)}</b> is this line&rsquo;s own SKU, not another one. Pick the SKU it went out under, or override with a reason.`
        :_skuOther?`<b>${esc(wentAs)}</b> isn&rsquo;t a SKU PrepHub knows. Pick one of this product&rsquo;s SKUs from the list, or override with a reason.`
        :`<b>${esc(_sj.sku)}</b> only sent what its own order${_spare===0?'':'s'} had${_spare?` (${fmt(_spare)} spare, ${fmt(_need)} needed)`:''} — these can’t have gone out as it. Pick another SKU, or override with a reason.`)
      +(_dupSk?`<div class="srtDupHint">Order ${esc(_rSku.oid)} is also on <b>${esc(_dupSk.sku)}</b>, which arrived ${fmt(_dupSk.got)} of ${fmt(_dupSk.got)}. If the order was ${fmt(_dupSk.got)}, this line is a copy. <button type="button" class="srtSwap" onclick="srtPick('duplicate')">Use “Duplicate record” →</button></div>`:'');}
  const arrived=(document.getElementById('srtArrived')||{}).value||'';
  const due=(document.getElementById('srtDate')||{}).value||'';
  try{if(what)_srtPaintSteps(what,_resTodo(what));}catch(e){}
  const ph=document.getElementById('srtPaidHint');
  if(ph)ph.textContent=paid==='no'?'It never completed — the line comes off the Purchase Sheet.'
    :paid==='yes'?'The purchase stays on the sheet with the refund recorded against it.':'';
  const ah=document.getElementById('srtArrHint');
  /* Jack, 29 Oct: "yes, it's here" on a gated row no longer books anything in — Becki's count does */
  if(ah)ah.textContent=arrived==='yes'?(_rG&&_owedUnits(_rG)>0
      ?`The close-off doesn’t book anything in — ${fmt(got)} booked in by Becki. If more is here she counts it (the button under the units). The gated decision goes to Jack.`
      :'Already booked in. The gated decision goes to Jack.')
    :arrived==='no'?'Stays outstanding. Jack decides what happens next.':'';

  const cause=((document.getElementById('srtNote')||{}).value||'').trim();
  const fix=((document.getElementById('srtFix')||{}).value||'').trim();
  const fr=document.getElementById('srtFixReq');
  const go=document.getElementById('srtGo'),msg=document.getElementById('srtMsg');
  /* Jack, 10 Sep: "'wrong SKU' is not enough information by itself — we need
     the missing SKU AND the SKU Sarah confirmed it went out under, or when I
     ask later what she found, you don't know." So it is no longer optional. */
  /* the tester, 29 Oct: "paid — then refunded?" asked a dropdown that is always hidden (Jack, 3 Sep: not her
     job), so a non-Amazon cancellation paid with a card could never close. It no longer asks. */
  const _shipIdV=((document.getElementById('srtShipId')||{}).value||'').trim();
  const missingAsk=(ask.includes('paid')&&!paid)
    ||(ask.includes('shipid')&&!_shipIdV)
    ||(ask.includes('arrived')&&!arrived)||(kind==='date'&&!due)
    ||(ask.includes('sku')&&!wentAs)
    ||_skuShip
    ||((_skuShort||!!_skuOther)&&!_skuWhy);
  const ticked=FOLLOW_UPS.some((f,i)=>{const c=document.getElementById('srtF'+i);return c&&c.checked;});
  /* Sarah only has to write a recommendation when Jack is the one deciding, or
     when she has not ticked anything to say what happens next. Demanding it on
     an obvious admin closure is friction that makes the form get skipped. */
  /* Nothing to suggest on a gated item: eBay / ungate / hold / write off is
     Jack's call and she has already told him it is here. */
  const needFix=(kind==='biz');
  /* A whole-order cancellation and a partial one are different events with
     different consequences, so the units have to agree with the outcome chosen.
     Picking "the whole order" with 9 of 10 sitting on a shelf would take a real
     purchase off the Purchase Sheet. */
  const mism=(what==='cancelled'&&got>0)?'full'
            :(what==='part-cancelled'&&got===0&&ord>0)?'part':'';
  const todoLeft=(kind==='date')?[]:_srtLeft();
  const ok=!!what&&left>=0&&(!needFix||!!fix)&&!missingAsk&&!mism&&!todoLeft.length;
  /* Jack, 8 Sep (Sarah stuck on a grey button): the button always works —
     press it and it says exactly what still needs doing, then lets her close. */
  window._srtGate={ok,what,left,mism,missingAsk,needFix:!!(needFix&&!fix),todoLeft,paid,ask,refunded,arrived,due,kind,wentAs,skuShort:_skuShort,skuWhy:!!_skuWhy,shipid:_shipIdV,
    skuShip:_skuShip,skuOther:_skuOther,amzGate:_gate?_gate.why:''};
  if(go){
    go.disabled=!what;go.style.opacity=what?'1':'.45';go.style.cursor=what?'pointer':'not-allowed';
    /* nothing reaches Jack before the investigation is written down */
    go.textContent=_gate?'Send to Jack — check the Amazon order first':kind==='date'?'Set the date':(kind==='ops'?'Close it off':'Send to Jack');
  }
  const sv=document.getElementById('srtSaveBtn');
  if(sv)sv.style.display=what?'inline-block':'none';
  if(fr){fr.textContent=needFix?'required':'optional';fr.style.color=needFix?'#f87171':'var(--text3)';}
  const fx=document.getElementById('srtFixBox');
  if(fx)fx.style.display=needFix?'block':'none';
  if(msg){
    const plain=!what?'Pick what happened first.'
      :_gate?(_gate.why==='not-arrived'?'Jack’s check says it did not arrive — it goes back to him with your note.'
        :'Amazon order — Jack checks the account first. Your note goes with it.')
      :left<0?'The units don\'t add up.'
      :mism==='full'?`${got} unit${got===1?'':'s'} did arrive — that is a part cancellation, not the whole order.`
      :mism==='part'?'Nothing arrived at all — that is the whole order cancelled.'
      :missingAsk?(ask.includes('sku')&&!wentAs?'Say which SKU it went out under — pick it from the list.'
        :_skuShip?"That's a shipment ID — pick the SKU it went out under."
        :(_skuOther&&!_skuWhy)?'That isn’t a SKU of this product — pick one from the list, or give a reason to override.'
        :(_skuShort&&!_skuWhy)?'That SKU has no spare units — pick another, or give a reason to override.':'Answer the question above.')
      :(needFix&&!fix)?'Say what you suggest we do.'
      :todoLeft.length?`${todoLeft.length} step${todoLeft.length===1?'':'s'} still to tick off.`
      :kind==='date'?'Stays on the list, just not overdue until then.'
      :kind==='gated'?'Recorded, then the gated decision goes to Jack.'
      :kind==='ops'?'You can close this yourself — Jack is told, not asked.'
      :'Jack gets your findings and makes the call.';
    /* Offer the switch rather than just refusing — she knows what happened, the
       app is the one that picked the wrong word for it. */
    const swap=_gate?'':mism==='full'?`<button type="button" class="srtSwap" onclick="srtPick('part-cancelled')">Use “Part arrived, the rest cancelled” →</button>`
              :mism==='part'?`<button type="button" class="srtSwap" onclick="srtPick('cancelled')">Use “Cancelled — the whole order” →</button>`:'';
    /* Jack, 08 Aug: a step that genuinely cannot be done yet must not trap the
       row open forever. The override is always available, always recorded, and
       every unticked step becomes a real job in the Action Centre. */
    const over=(!_gate&&!mism&&todoLeft.length&&!missingAsk&&left>=0&&(!needFix||!!fix))
      ?`<button type="button" class="srtSwap" onclick="srtAskClose(true)">Can’t do one of these? Close anyway →</button>`:'';
    msg.innerHTML=esc(plain)+swap+over;
  }
}
/* ── ARE YOU SURE ─────────────────────────────────────────────────────────────
   Pressing the button used to be the last thing that happened. It takes a row
   out of two live queues and stops the sheet sync ever bringing it back, so it
   deserves a second press — and, more to the point, a plain list of what that
   actually does. The list always ends with what is KEPT: no history is ever
   fully deleted, and the popup that closes things should be the one that says
   so loudest. */
let _srtOverride=false,_srtOverrideWhy='';
function srtCfmShut(){const el=document.getElementById('srtConfirm');if(el)el.style.display='none';}
function srtAskClose(override){
  const r=_rowById(_srtRid);if(!r)return;
  const what=(document.getElementById('srtWhat')||{}).value||'';
  if(!what)return;
  /* Jack, 29 Oct (the OneBlade): an Amazon "it's here" he hasn't checked goes to him first, with her note */
  if(_srtAmzGate(what,r))return srtJackFirst();
  const kind=_resKind(what,r);
  /* Say what is in the way, in her words, on the button she just pressed. */
  const G=window._srtGate||{};
  if(!override&&G.ok===false){
    const need=[];let focusId='';
    if(G.left<0)need.push('The units don\u2019t add up — arrived plus cancelled is more than ordered.');
    if(G.mism==='full')need.push('Some units did arrive — pick “Part arrived, the rest cancelled” instead.');
    if(G.mism==='part')need.push('Nothing arrived at all — pick “Cancelled — the whole order” instead.');
    /* Jack, 29 Oct (the C920): it said "Set the date" on a close-off with no date. It took the first question
       on the form, not the one actually unanswered — each is checked for real now, and the SKU ones are named. */
    if(G.missingAsk){
      const A=G.ask||[],n0=need.length;
      if(A.includes('paid')&&!G.paid){need.push('Answer “Had the money already left the account?” — the dropdown on the left.');focusId=focusId||'srtPaid';}
      if(A.includes('shipid')&&!G.shipid){need.push('Type the FBA shipment ID it went on — the box on the left.');focusId=focusId||'srtShipId';}
      if(A.includes('arrived')&&!G.arrived){need.push('Say whether the stock arrived — the question on the left.');focusId=focusId||'srtArrived';}
      if(G.kind==='date'&&!G.due){need.push('Set the date.');focusId=focusId||'srtDate';}
      if(A.includes('sku')&&!G.wentAs){need.push('Say which SKU it went out under — pick it from the list.');focusId=focusId||'srtSku';}
      else if(G.skuShip){need.push("That's a shipment ID — pick the SKU it went out under.");focusId=focusId||'srtSku';}
      else if(G.skuOther&&!G.skuWhy){need.push(`${G.wentAs} isn’t a SKU of this product — pick one of its SKUs from the list, or type why it’s still right in the override box.`);focusId=focusId||'srtSkuWhy';}
      else if(G.skuShort&&!G.skuWhy){need.push(`${G.wentAs} only sent what its own order had, so these can’t have gone out under it — pick another SKU, or type why it’s still right in the override box.`);focusId=focusId||'srtSkuWhy';}
      if(need.length===n0)need.push('Answer the question on the left.');
    }
    if(G.needFix){need.push('Say what you suggest we do — the box on the right.');focusId=focusId||'srtFix';}
    /* a step that says there is nothing to do is not a job — it never blocks */
    const jobs=(G.todoLeft||[]).filter(j=>!/^nothing (to do|else)/i.test(String(j.text||'')));
    const msg=document.getElementById('srtMsg');
    if(need.length){
      if(msg)msg.innerHTML=`<div class="srtNeed"><b>Before this can close:</b><ul>${need.map(t=>'<li>'+esc(t)+'</li>').join('')}</ul></div>`;
      const f=focusId&&document.getElementById(focusId);if(f){try{f.scrollIntoView({block:'center'});f.focus();}catch(e){}}
      toast(need[0],'er');
      return;
    }
    if(jobs.length){
      if(msg)msg.innerHTML=`<div class="srtNeed"><b>To close this off you need to:</b><ul>${jobs.map(j=>'<li>'+esc(j.text)+'</li>').join('')}</ul>
        <div>Tick each one as you do it, then press Close it off — or <button type="button" class="srtSwap" onclick="srtAskClose(true)">close it anyway and log ${jobs.length===1?'it':'them'} as jobs still to do →</button></div></div>`;
      try{msg.scrollIntoView({block:'nearest'});}catch(e){}
      return;
    }
  }
  /* "Still in transit" only puts a date on the row. Nothing closes, nothing
     leaves a queue — a confirmation there is just a click tax. */
  if(kind==='date'){submitSorted();return;}
  /* Jack, 17 Aug: "no need for a 2nd popup — just when press close it off,
     have a progress bar in the middle with Undo bottom-left and Close now
     bottom-right, watch it for 3 seconds." The are-you-sure dialog was a
     click tax; the 3-second undo IS the confirmation. The only dialog that
     survives is the override — closing with jobs outstanding still demands a
     typed reason. */
  if(!override){submitSorted();return;}
  const toJack=(kind!=='ops');
  let el=document.getElementById('srtConfirm');
  if(!el){
    el=document.createElement('div');el.id='srtConfirm';el.className='overlay';
    el.style.zIndex='140';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)srtCfmShut();});
  }
  const goes=toJack
    ?['It leaves your active follow-up list straight away',
      'Jack owns it from that moment — it shows on his side as waiting on him',
      'Your findings and your recommendation go across with it',
      'Nothing is closed yet. Jack decides, and he can send it back to you']
    :['It comes off your active follow-up list',
      'It comes off the active Prep Sheet',
      'The sheet sync will not bring it back',
      'Anything still to do lands in your Action Centre'];
  const kept=['The resolution and everything you wrote is saved to history',
              'The audit record is kept — no history is ever deleted'];
  /* The override path. Every step left unticked becomes a real job rather than
     quietly evaporating, and the reason is required — "close anyway" with no
     explanation is just the old one-click close wearing a hat. */
  const undone=override?_srtLeft():[];
  el.innerHTML=`<div class="modal srtCfm">
    <div class="srtCfmTtl">${undone.length?'Close it with jobs still outstanding?'
      :toJack?'Send this to Jack?':'Are you sure you want to close this issue?'}</div>
    <div class="srtCfmSub">${esc(_resText(what))} · ${esc(r.sku||r.asin||r.prod||'')}</div>
    ${undone.length?`<div class="srtCfmOpen"><b>${undone.length} step${undone.length===1?'':'s'} not done</b>
      <ul>${undone.map(s=>`<li>${esc(s.text)}</li>`).join('')}</ul>
      <span>${undone.length===1?'It stays':'They stay'} on the books as ${undone.length===1?'a job':'jobs'} in the Action Centre — not forgotten, just not done yet.</span></div>
      <div class="srtCfmLab">Why can’t ${undone.length===1?'it':'they'} be done now?</div>
      <textarea id="srtCfmWhy" class="srtNote" rows="2" oninput="srtCfmCheck()"
        placeholder="e.g. the Purchase Sheet isn’t connected yet"></textarea>`:''}
    <div class="srtCfmLab">What happens</div>
    <ul class="srtCfmList">${goes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
    <div class="srtCfmKeep"><b>Kept either way</b>
      <ul>${kept.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="srtCfmFoot">
      <button class="srtGhost" onclick="srtCfmShut()">Cancel</button>
      <button class="srtGo" id="srtCfmGo" onclick="srtCfmTake(${undone.length?'true':'false'})">${
        undone.length?'Close with jobs outstanding':toJack?'Send to Jack':'Close issue'}</button>
    </div>
  </div>`;
  el.style.display='flex';
  if(undone.length)srtCfmCheck();
  setTimeout(()=>{const b=document.getElementById(undone.length?'srtCfmWhy':'srtCfmGo');if(b)b.focus();},50);
}
function srtCfmCheck(){
  const t=document.getElementById('srtCfmWhy'),b=document.getElementById('srtCfmGo');
  if(!t||!b)return;
  const ok=t.value.trim().length>2;
  b.disabled=!ok;b.style.opacity=ok?'1':'.45';b.style.cursor=ok?'pointer':'not-allowed';
}
function srtCfmTake(override){
  const t=document.getElementById('srtCfmWhy');
  if(override&&(!t||t.value.trim().length<3))return;
  _srtOverride=!!override;
  _srtOverrideWhy=t?t.value.trim():'';
  srtCfmShut();
  submitSorted();
}
let _srtBusy=false;
async function submitSorted(){
  if(_srtBusy)return;                       // one closure per click, not three
  const rid=_srtRid,r=_rowById(rid);if(!r)return;
  const _go=document.getElementById('srtGo');
  if(_go){_go.disabled=true;_go.textContent='Saving…';}
  _srtBusy=true;
  /* Every early return below used to leave _srtBusy stuck true, and the guard
     at the top then swallowed EVERY later close-off for the rest of the
     session — the button just went dead, no toast, no error. One routine
     "Still in transit" was enough to do it. Nothing leaves here without
     putting the latch back. */
  const _unlatch=()=>{_srtBusy=false;const g=document.getElementById('srtGo');
    if(g){g.disabled=false;g.textContent='Close it off';}};
  const what=(document.getElementById('srtWhat')||{}).value||'';
  if(!what){_unlatch();return;}
  const ord=parseInt((document.getElementById('srtOrd')||{}).value)||0;
  const got=parseInt(r.rcvd)||0;   /* Becki's count, never a box (Jack, 29 Oct — the C920) */
  const cx =parseInt((document.getElementById('srtCx') ||{}).value)||0;
  if(ord-got-cx<0){_unlatch();return;}
  /* an Amazon "it's here" Jack hasn't checked never closes — the button sends it to him (srtJackFirst) */
  if(_srtAmzGate(what,r)){_unlatch();toast('Amazon order — Jack checks the account first: press “Send to Jack”','er');return;}
  const follow=FOLLOW_UPS.filter((f,n)=>{const c=document.getElementById('srtF'+n);return c&&c.checked;});
  const note=((document.getElementById('srtNote')||{}).value||'').trim();
  const fix=((document.getElementById('srtFix')||{}).value||'').trim();
  const kind=_resKind(what,r);
  const paid=(document.getElementById('srtPaid')||{}).value||'';
  const arrived=(document.getElementById('srtArrived')||{}).value||'';
  const due=(document.getElementById('srtDate')||{}).value||'';
  let wentAs=((document.getElementById('srtSku')||{}).value||'').trim();
  /* Jack, 29 Oct (the OneBlade): "went out under" is a SKU of this product — checked again here, on the press */
  const _sjS=_resAsk(what).includes('sku')&&wentAs?_srtSkuJudge(wentAs,r):null;
  const _whyS=((document.getElementById('srtSkuWhy')||{}).value||'').trim();
  if(_sjS&&_sjS.kind==='shipid'){_unlatch();toast("That's a shipment ID — pick the SKU it went out under.",'er');return;}
  const _otherS=!!_sjS&&['other','own','unknown'].includes(_sjS.kind);
  if(_otherS&&!_whyS){_unlatch();toast('That isn’t a SKU of this product — pick one from the list, or give a reason to override','er');return;}
  if(_sjS&&_sjS.kind==='same')wentAs=_sjS.sku;
  const _needS=Math.max(1,_owedUnits(r)||0,(typeof _leftUnits==='function'?_leftUnits(r):0)||0);
  const _spS=(_sjS&&_sjS.kind==='same'&&typeof sfSkuSpare==='function')?sfSkuSpare(wentAs,r):null;
  const _shortS=_spS!==null&&_spS<_needS;
  if(_shortS&&!_whyS){_unlatch();toast(`${wentAs} only sent what its own order had — pick another SKU, or give a reason to override`,'er');return;}
  const refunded=(document.getElementById('srtRefund')||{}).value||'';
  /* Snapshot the ticks BEFORE anything calls closeSorted — that clears them,
     and the whole record of what was actually done would go with it. */
  const ticks=Object.assign({},_srtTicks);
  const stepsAll=_srtStepList(what,_resTodo(what));
  const stepsDone=stepsAll.filter(s=>ticks[s.k]).map(s=>s.text);
  const stepsOpen=stepsAll.filter(s=>!ticks[s.k]).map(s=>s.text);
  const override=_srtOverride,overrideWhy=_srtOverrideWhy;
  /* b627: looks wrong → Jack. A SKU check overridden ("only sent what its own order had", or not this product's SKU)
     never closes — it goes to Jack as a decision with her reason. Jack's own close is his call. */
  const _looksWrong=(_shortS||_otherS)&&!(typeof _isJack==='function'&&_isJack())
    ?{why:_otherS?`“went out under ${wentAs}” — not a SKU of this product`:`“went out under ${wentAs}” — that SKU only sent what its own order${_spS===0?'':'s'} had (${fmt(_spS||0)} spare, ${fmt(_needS)} needed)`,her:_whyS,by:_who(),at:new Date().toISOString()}:null;

  /* "Still in transit" is not a closure at all — it just dates the row. */
  if(kind==='date'){
    r.notes=note;r.notesBy=_who();r.notesAt=new Date().toISOString();
    closeSorted();
    await setDueDate(rid,due);
    logAudit('Still in transit',`${r.sku||r.asin||''} — due ${due}`);
    _unlatch();
    return;
  }
  /* Jack, 29 Oct: Undo puts the units back — what the row held before this close, taken before anything moves */
  const _snapB=_snapTake(r,_SNAP_COUNT.concat(_SNAP_LABEL)),_snapP=_snapPrevRes(r);
  /* whose account check stands behind an Amazon close (the gate let it through, so there is one) */
  const _jcS=(typeof _amazonRow==='function'&&_amazonRow(r))?((typeof _isJack==='function'&&_isJack())?{how:'closed-by-jack',by:_who(),at:new Date().toISOString()}:_amzJackCheck(r)):null;
  /* Gated stock that has turned up: the close-off never books it in (Jack, 29 Oct — Becki's count does). Her
     "yes, it's here" rides on the resolution (arrived) and marks the row delivered only where it can't be a
     guess: a supplier order she checks herself, or one already booked in in full. */
  if(kind==='gated'&&arrived==='yes'&&(!_amazonRow(r)||_owedUnits(r)===0))r.delivered='Yes';
  /* Admin closes on the spot. A business decision or a gated product goes to
     Jack — but only WITH the investigation and a recommendation attached. */
  /* The chase that got here is history, and history is never dropped — the
     whole log rides into the closed resolution so the audit trail reads end to
     end: diagnosed, chased, replied, resolved. */
  const _priorCase=_caseOf(r);
  /* Stamp it onto the shipment before the row is closed off, so the Shipments
     page and the Prep Sheet tell the same story. Same fields the Prep Sheet's
     own Stamp ID uses — nothing bespoke to drift. */
  if(what==='sent-not-stamped'){
    const _cs=_cleanShipId((document.getElementById('srtShipId')||{}).value||'');
    const sid=_cs.id;
    if(!sid){toast('Enter the FBA shipment ID','er');_unlatch();return;}
    if(!_cs.ok){toast('That isn\u2019t an FBA shipment ID — it looks like FBA15 and 7 letters/numbers','er');_unlatch();return;}
    /* Jack, 29 Oct: "SF would say if it has — only we say it hasn't until we're told otherwise" */
    if(!_sfShowsOnShip(r,sid)){_unlatch();
      toast(`SellerFuse doesn’t show ${String(r.prod||r.sku||'this product').slice(0,40)} on ${sid} — it stays late. If it went, it shows on Jack’s Fix-it list after the next check.`,'er');return;}
    /* no typed booking-in (Jack, 29 Oct): the shipment it names is what books the units in — addSegment raises
       Qty Received to what went out, with its own audit line, as on the Prep Sheet */
    const remain=remainingToShip(r);
    if(remain>0)addSegment(r,sid,remain,r.shipType||'Standard');
    else{const ids=r.allShipIds||[];if(!ids.includes(sid))ids.push(sid);r.allShipIds=ids;r.shipId=sid;}
    r.status='Sent to Amazon';r.sent='Yes';r.sentDate=shipDateFor(sid);r.sentAt=getNowUK();
    try{logAudit('Shipment ID added from Admin',`${r.sku||''} → ${sid}`);}catch(e){}
  }
  r.resolution={notDup:(r.resolution&&r.resolution.notDup)||undefined,state:(kind==='ops'&&!_looksWrong)?'approved':'proposed',looksWrong:_looksWrong||undefined,kind,what,note,fix,followUps:follow,
    paid,refunded,arrived,wentAs,by:_who(),at:new Date().toISOString(),claim:_resClaim(what),
    /* the SKU check behind a wrong-SKU close, and the reason if someone overrode it */
    wentAsCheck:(_sjS&&wentAs)?{spare:_spS,need:_needS,override:(_shortS||_otherS)?_whyS:'',notThisProduct:_otherS?_sjS.kind:undefined,by:_who(),at:new Date().toISOString()}:null,
    /* the account check behind an Amazon close: Jack's answer, his tick, or Jack closing it himself */
    jackCheck:_jcS||undefined,
    chase:_priorCase||undefined,
    /* What she actually did, not just what she was told to do. stepsOpen is the
       honest bit — the jobs that went out of this popup unfinished, and why. */
    stepsDone,stepsOpen,override,overrideWhy};
  /* Cancelled is not the same as refunded. If the money left and has not come
     back, this is a live loss and Jack sees it flagged as one. */
  if(paid==='yes'&&refunded==='no'){
    r.resolution.claim=true;
    if(!follow.includes('Raise a claim for the loss'))follow.push('Raise a claim for the loss');
  }
  /* A whole order that never arrived was never really a purchase — off the
     active prep sheet, and the sync will not bring it back. The record stays,
     as it always does. A PARTIAL cancellation is the opposite case: nine units
     genuinely arrived, so that row stays exactly where it is. */
  if(_resFull(what)&&!follow.includes('Remove from Prep Sheet'))follow.push('Remove from Prep Sheet');
  /* The units live on the row they actually shipped under. Leaving them at 0
     here is what stops the same 2 drones being counted twice in Sent This Month. */
  if(wentAs)r.wrongSku='Yes';
  /* The Purchase Sheet note. The live sheet isn't connected yet, so this is
     recorded as a job rather than written anywhere automatically. */
  let sheetNote=_resSheet(what)|| (paid==='no'?'Remove from the Purchase Sheet — cancelled before payment':'');
  /* Jack's rule: the sheet must always be traceable back to the order. Build
     the line she pastes rather than leaving her to retype it. */
  if(sheetNote){
    const ref=r.oid?('order '+r.oid):'no order ref on file';
    const line=[
      _resText(what),
      ref,
      r.sku?('ordered as '+r.sku):'',
      wentAs?('went out as '+wentAs):'',
      note
    ].filter(Boolean).join(' · ');
    sheetNote='Open the Purchase Sheet'+(r.sheetRow?(', line '+r.sheetRow):'')
      +' and put this in the notes: "'+line+'"'
      +(paid==='no'?' Then remove the line — the money never left the account.':'');
  }
  if(sheetNote&&!follow.includes('Update Purchase Sheet'))follow.push('Update Purchase Sheet');
  if(sheetNote)r.resolution.sheetNote=sheetNote;
  /* Archiving happens at APPROVAL, never at proposal. Doing it here hid the
     row from Jack's queue (which filters !archived) the instant Sarah proposed
     it — the row was waiting on a decision nobody could see. Ops self-closures
     need no approval, so those still archive immediately, below. */
  if(kind==='ops'&&follow.includes('Remove from Prep Sheet'))r.archived=true;
  if(kind==='ops'){
    r.resolution.approvedBy=_who();
    r.resolution.approvedAt=new Date().toISOString();
    /* Only what is NOT already done becomes a job. A step she ticked off in the
       popup has genuinely happened — sending it to the Action Centre anyway is
       how a to-do list stops being believed. */
    const jobs=stepsOpen.slice();
    /* Jack, 8 Sep: "Raise a claim for the loss" and "Raise the claim with the
       supplier or Amazon before the window shuts" landed as two jobs on the
       same row — they are one job, the short name and its own wording. A
       follow-up that already has a step of its own is never added twice. */
    const stepKeys=new Set(stepsAll.map(s=>s.k));
    follow.forEach(f=>{
      if(ticks[f]||stepKeys.has(f))return;
      if(jobs.some(j=>j===f||j.indexOf(f)===0))return;
      jobs.push(f);});
    await addVaActions(r,jobs,[overrideWhy?('Left open: '+overrideWhy):'',sheetNote,fix].filter(Boolean).join(' — ')||_resText(what));
  }
  r.cancelledQty=cx;
  /* Jack, 29 Oct (the C920): the close-off never writes Qty Received. It copied its "Arrived" box onto the row,
     so 2 typed in became 2 webcams PrepHub believed were on the shelf. Becki's count is the only source; "more
     arrived" is her shelf check (srtToBecki). The only booking-in a close does is _settleClosedUnits' own. */
  if(ord!==(r.exp||0))r.exp=ord;
  /* an ops close is final the moment it is pressed — settle the row now */
  if(kind==='ops'&&!_looksWrong){const _st=_settleClosedUnits(r,what);
    if(_st.toBecki){await _sendToBeckiShelves(r,`${fmt(_owedUnits(r))} unaccounted for after "${_resText(what)}"`);
      try{logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}
    else if(_st.changed&&_st.note){try{logAudit('Row settled on close',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}}
  /* the snapshot Undo reads: the row before, the counted fields after, and the resolution this one replaced */
  if(r.resolution)r.resolution.closeSnap={v:1,at:new Date().toISOString(),by:_who(),before:_snapB,after:_snapTake(r,_SNAP_COUNT),prev:_snapP};
  r._dirty=true;
  closeSorted();
  /* the row leaves the list straight away — the save carries on behind it
     rather than freezing the dialog while three round trips finish */
  renderAdmin();
  try{
    await saveRow(r);
    /* Only now. Dropping the part-finished copy before the save had actually
       landed would throw away her working on the one occasion it still mattered
       — the occasion where the save failed. */
    if(srtDraft(rid))srtDropDraft(rid);
    showUndoBar(kind==='ops'?'Closed off — Jack has been told':'Sent to Jack with your findings',
      ()=>reopenResolution(rid,true));
    logAudit(kind==='ops'?'Closed by VA':'Decision sent to Jack',
      [`${r.sku||r.asin||''} — ${_resText(what)}${wentAs?' · went out under '+wentAs:''}${(_shortS||_otherS)&&_whyS?' · override'+(_otherS?' (not a SKU of this product)':'')+': '+_whyS:''}`,fix,
       stepsDone.length?`${stepsDone.length} step${stepsDone.length===1?'':'s'} done`:'',
       override?`CLOSED WITH ${stepsOpen.length} OUTSTANDING: ${overrideWhy}`:''
      ].filter(Boolean).join(' · '));
    fireWebhook(kind==='ops'
      ? `${_who()} closed off "${r.prod||r.sku||''}" — ${_resText(what)}. ${fix}`
      : `${_who()} needs a decision on "${r.prod||r.sku||''}" — ${_resText(what)}. She suggests: ${fix}`,
      {event:kind==='ops'?'closed_by_va':'decision_needed',kind,sku:r.sku||'',asin:r.asin||'',by:_who()});
  }catch(e){toast('Didn\'t save — check the connection','er');}
  finally{_srtBusy=false;}
  renderAdmin();
  /* only redraw the dashboard if it is the page you are actually on */
  try{if(document.querySelector('#page-dashboard.active'))renderDashboard();}catch(e){}
}

// ── JACK APPROVING ────────────────────────────────────────────────────────────
/* b627: does SellerFuse show this product (any of its SKUs) on that shipment? — the run's shipments, the 60-day
   product lines, and the late-order lines all count. No sighting = not sent. */
function _sfShowsOnShip(r,sid){
  const S=(typeof SFRUN!=='undefined'&&SFRUN)?SFRUN:window.SFRUN;if(!S||!r)return false;   /* the app's own binding — window.SFRUN can lag a reassignment */
  const same=(a,b)=>typeof _sfSameShip==='function'?_sfSameShip(a,b):a===b;
  const A=String(r.asin||'').toUpperCase(),hit=l=>(l.sku&&l.sku===r.sku)||(A&&String(l.asin||'').toUpperCase()===A);
  if((S.shipments||[]).some(s=>same(s.id,sid)&&!/cancel/i.test(s.status||'')&&(s.lines||[]).some(l=>hit(l)&&(parseInt(l.units)||0)>0)))return true;
  const B=(S.summary||{}).asinBal;if(B&&B.by&&A&&(B.by[A]||[]).some(l=>same(l.id,sid)&&(parseInt(l.units)||0)>0))return true;
  const rid=r.uuid||String(r.id),e=(S.late||[]).find(x=>x.rowId===rid);
  if(e&&[].concat(e.own||[],e.asinSkus||[]).some(l=>same(l.id,sid)&&(parseInt(l.units)||0)>0))return true;
  return false;
}
async function approveResolution(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  r.resolution.state='approved';
  r.resolution.approvedBy=_who();
  r.resolution.approvedAt=new Date().toISOString();
  /* Undo's snapshot: anything that moved since her proposal is the new starting point (never undo Becki's count) */
  const _sn=r.resolution.closeSnap&&r.resolution.closeSnap.after?r.resolution.closeSnap:null;
  if(_sn)_snapRebase(_sn,r);
  /* Now it is genuinely closed, honour the follow-up she ticked. */
  if((r.resolution.followUps||[]).includes('Remove from Prep Sheet'))r.archived=true;
  {const _st=_settleClosedUnits(r,r.resolution.what);
   if(_st.toBecki){await _sendToBeckiShelves(r,`${fmt(_owedUnits(r))} unaccounted for after "${_resText(r.resolution.what)}"`);
     try{logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}
   else if(_st.changed&&_st.note){try{logAudit('Row settled on approval',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}}
  if(_sn)_sn.after=_snapTake(r,_SNAP_COUNT);
  r._dirty=true;
  await addVaActions(r,r.resolution.followUps||[],_resText(r.resolution.what));
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  toast('Approved — closed off'+((r.resolution.followUps||[]).filter(f=>f!=='No further action required').length?' and the follow-up work is on Sarah\'s list':''),'ok');
  logAudit('Closure approved',`${r.sku||r.asin||''} — ${_resText(r.resolution.what)}`);
  fireWebhook(`${_who()} approved the close-off on "${r.prod||r.sku||''}" — ${_resText(r.resolution.what)}`,
    {event:'closure_approved',sku:r.sku||'',by:_who()});
  renderAdmin();renderJack();
  try{renderDashboard();paintJackBadge();}catch(e){}
}
/* "Not my call" — Jack, 15 Aug. Distinct from sending it back with a note:
   there is nothing for him to decide, so it returns to her queue as an ordinary
   piece of work rather than as a rejection with a lecture attached. */
async function backToSarah(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  if(!confirm('Send this back to Sarah to handle herself?'))return;
  r.resolution.state='rejected';
  r.resolution.rejectedBy=_who();
  r.resolution.rejectedAt=new Date().toISOString();
  r.resolution.rejectNote='Not my call — you can handle this one.';
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  toast('Back with Sarah','ok');
  logAudit('Sent back to Sarah (no decision needed)',r.sku||r.asin||'');
  fireWebhook(`${_who()} sent "${r.prod||r.sku||''}" back to Sarah — no decision needed`,{event:'back_to_sarah'});
  renderJack();renderAdmin();try{renderDashboard();paintJackBadge();}catch(e){}
}
async function rejectResolution(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  askText('Send it back to Sarah','Your note lands on the row with the red Sent-back banner.',
    'What needs doing first?','Send back',why=>{_rejectGo(rid,why);});
}
async function _rejectGo(rid,why){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  r.resolution.state='rejected';
  r.resolution.rejectedBy=_who();
  r.resolution.rejectedAt=new Date().toISOString();
  r.resolution.rejectNote=(why||'').trim();
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  toast('Sent back to Sarah','ok');
  logAudit('Closure sent back',`${r.sku||r.asin||''} — ${(why||'').slice(0,60)}`);
  fireWebhook(`Jack sent "${r.prod||r.sku||''}" back — ${(why||'no reason given')}`,{event:'closure_rejected'});
  renderAdmin();renderJack();
  try{renderDashboard();paintJackBadge();}catch(e){}
}
/* ── THE CLOSE-OFF GUARDS (Jack, 29 Oct 2026: a guess can never become a fact) ─────────────────────────────
   Two close-offs went wrong on the older build. The C920 (202-5081951-0344342, a line typed twice) was closed
   "Arrived and correct" by typing 2 into Arrived — PrepHub then held 2 webcams that never existed. The Philips
   OneBlade (Amf_57.56_07106_90_Repl_02, Amazon France) was closed "went out under another SKU" with two
   shipment IDs typed into the SKU box, and Jack had never checked the account: "that should be escalated to
   me." So: Arrived is Becki's count, read-only; "went out under" is a SKU of this product; an Amazon order's
   "it's here" outcomes wait for Jack's account check; Undo puts the units back. Jack's triage order is
   unchanged — Sarah → (Amazon) Jack checks the account → Sarah → wrong SKU → Becki's shelf. */
const _AMZ_NO=/not arrived|never arrived|nothing (?:is )?coming|cancelled or refunded|still coming/i;
const _isJackName=s=>/^jack/i.test(String(s||'').trim());
/* the latest thing Jack said about the order in its case log (it survives a re-send rebuilding the resolution) */
function _jackLogHit(log){
  const e=(log||[]).slice().reverse().find(x=>x&&(/^Jack answered/i.test(String(x.what||''))||(_isJackName(x.by)&&/checked the account/i.test(String(x.what||'')))));
  return e?{how:'case-log',by:e.by||'Jack',at:e.at||'',note:String(e.what||'').slice(0,160),no:_AMZ_NO.test(String(e.what||''))}:null;
}
/* Has Jack checked this Amazon order on the account? His answer on the row (anything he sent back — Arrived YES,
   "it was 2 — a duplicate", a typed note, "not my call"), his answer in the case log, "it was 4" (notDup), his
   tick on every order of the ASIN, or Arrived = Yes while nothing is booked in (only his YES sets it then — once
   units are booked in, Becki's count-in sets it too, so on its own it says nothing about the account).
   {no:true} = he checked and it did NOT arrive (or is still coming). null = no check on record. */
function _amzJackCheck(r){
  if(!r)return null;
  const res=r.resolution||{};
  /* b630: his ticked meaning (delivered / cancelled / note) wins over the words */
  if(res.state==='rejected'&&(_isJackName(res.rejectedBy)||res.what==='jack-check')&&(res.rejectNote||res.dupOf))
    return{how:'answer',by:res.rejectedBy||'Jack',at:res.at||'',note:String(res.rejectNote||'').slice(0,160),
      no:res.meant?res.meant==='cancelled':_AMZ_NO.test(String(res.rejectNote||''))};
  const h=_jackLogHit(res.chase&&res.chase.log);if(h)return h;
  if(res.notDup)return{how:'answer',by:'Jack',at:res.at||'',note:'the order was the full amount — all delivered'};
  try{const k=typeof asinCheckFor==='function'?asinCheckFor(r):null;if(k&&k.covered)return{how:'asin-tick',by:k.c.by||'Jack',at:k.c.at||''};}catch(e){}
  if(r.delivered==='Yes'&&!(parseInt(r.rcvd)||0))return{how:'delivered',by:'Jack',at:''};
  return null;
}
/* The outcomes that say the stock is here, or went out as another SKU — gated only while they would account for
   units nobody has counted: "arrived and correct" / "Already sent" while units are still owed (what Becki booked
   in was counted), "went out under another SKU" while units are owed or booked in and never sent (Jack's leftover
   question). Cancelled / refunded / duplicate are left as they are: Jack's own answers route those. */
const _SRT_HERE=['arrived-ok','wrong-sku','cancel-wrong-sku','sent-not-stamped'];
function _srtAmzGate(what,r){
  if(!what||!r||!_SRT_HERE.includes(what))return null;
  if(!(typeof _amazonRow==='function'&&_amazonRow(r)))return null;
  const _ow=_owedUnits(r),_lf=(typeof _leftUnits==='function')?_leftUnits(r):0;
  if((what==='arrived-ok'||what==='sent-not-stamped')?!(_ow>0):!(_ow>0||_lf>0))return null;
  if(typeof _isJack==='function'&&_isJack())return null;            /* he IS the account check */
  /* b627: "Already sent" with SellerFuse showing this product on the shipment typed in — Amazon has them, so the
     account check has nothing to add (Jack, 29 Oct: "SF would say if it has") */
  if(what==='sent-not-stamped'){const _sid=(typeof _cleanShipId==='function')?_cleanShipId(((document.getElementById('srtShipId')||{}).value)||'').id:'';
    if(_sid&&typeof _sfShowsOnShip==='function'&&_sfShowsOnShip(r,_sid))return null;}
  const c=_amzJackCheck(r);
  if(c&&!c.no)return null;
  return{why:c?'not-arrived':'unchecked',check:c};
}
/* "Went out under" is a SKU of THIS product — the same ASIN, picked from the list. kind: same (fine) · shipid
   (refused: "FBA15" + 7) · own (this line's own SKU) · other (another product's SKU) · unknown (not a SKU
   PrepHub has) — the last three need a reason in the override box. */
const _SHIPID_RX=/FBA15[A-Z0-9]{7}/g;
function _srtSkuJudge(txt,r){
  const t=String(txt||'').trim();if(!t)return{kind:'empty',sku:''};
  const lc=t.toLowerCase(),me=String((r&&r.sku)||'').trim().toLowerCase(),A=String((r&&r.asin)||'').trim().toUpperCase();
  const hits=(rows||[]).filter(x=>x&&x.sku&&String(x.sku).trim().toLowerCase()===lc);
  const same=A?hits.find(x=>String(x.asin||'').trim().toUpperCase()===A&&String(x.sku).trim().toLowerCase()!==me):null;
  if(same)return{kind:'same',sku:same.sku,row:same};
  const ids=t.toUpperCase().replace(/\s+/g,'').match(_SHIPID_RX);
  if(ids)return{kind:'shipid',sku:t,ids:[...new Set(ids)]};
  if(me&&lc===me)return{kind:'own',sku:(r&&r.sku)||t};
  if(hits.length)return{kind:'other',sku:hits[0].sku,row:hits[0]};
  return{kind:'unknown',sku:t};
}
/* the close-off button on a gated outcome: to Jack (amzAskJack) with what she wanted and what she wrote */
async function srtJackFirst(){
  const rid=_srtRid,r=_rowById(rid);if(!r)return;
  const g=id=>String((document.getElementById(id)||{}).value||'').trim();
  const what=g('srtWhat'),sku=g('srtSku'),ta=document.getElementById('srtNote');
  /* only what she wrote — the box opens filled in with the case's own history */
  const mine=ta&&String(ta.value||'').trim()!==String(ta.defaultValue||'').trim()?String(ta.value||'').trim():'';
  const note=[what?`${_who()} wanted to close it as “${_resText(what)}”`:'',sku?`went out under: ${sku}`:'',mine].filter(Boolean).join(' — ');
  closeSorted();
  await amzAskJack(rid,note);
}
/* "more arrived than Becki booked in" — her shelf check, never a number typed into the close-off. Amazon rows
   use the same hand-over as Sarah's card (amzToBecki); other suppliers the close-off's own (_sendToBeckiShelves). */
async function srtToBecki(){
  const rid=_srtRid,r=_rowById(rid);if(!r)return;
  const got=parseInt(r.rcvd)||0,owe=_owedUnits(r);
  closeSorted();
  if(typeof _amazonRow==='function'&&_amazonRow(r)){await amzToBecki(rid);return;}
  await _sendToBeckiShelves(r,`${_who()} thinks more arrived than the ${fmt(got)} booked in (${fmt(owe)} still out)`);
  try{await _mustSave(r);}catch(e){toast('Didn’t save — nothing was recorded','er');return;}
  try{logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — ${fmt(got)} booked in, ${fmt(owe)} still out (from the close-off)`);}catch(e){}
  toast('Sent to Becki — it is flagged on the Prep Sheet for her to check the shelves','ok');
  renderAdmin();try{renderPrep();}catch(e){}
}

/* ── UNDO PUTS THE UNITS BACK (Jack, 29 Oct) ──────────────────────────────────────────────────────────────────
   Undo used to restore only the resolution: the counts the close changed stayed changed (cancelled, archived,
   wentAsQty, a shipment stamped by "Already sent"…). Every close now carries resolution.closeSnap:
     before — the counted fields and their labels as they were, taken before anything moved
     after  — the counted fields as the close left them
     prev   — the resolution it replaced (its chase rides on the new one, so it is not stored twice)
   Undo puts back each counted field that still holds what the close left in it. One that has moved since
   (Becki booked in, a shipment went) is left alone and named in the audit line — a count made after the close is
   never undone. The labels (status, Late, issue flag…) go back only when no count has moved. */
const _SNAP_COUNT=['rcvd','exp','cancelledQty','archived','shipSegments','allShipIds','shipId'];
const _SNAP_LABEL=['ship','status','sent','sentDate','sentAt','shipType','transitAction','rcvdAt','issueType','issueQty','wrongSku','delivered'];
const _SNAP_NUM=['rcvd','exp','cancelledQty','ship','issueQty'];
const _SNAP_WORD={rcvd:'Qty Received',exp:'Ordered',cancelledQty:'Cancelled'};
const _snapNorm=(k,v)=>_SNAP_NUM.includes(k)?(parseInt(v)||0):k==='archived'?!!v
  :(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length))?null:v;
const _snapSame=(k,a,b)=>JSON.stringify(_snapNorm(k,a))===JSON.stringify(_snapNorm(k,b));
function _snapTake(r,keys){const o={};keys.forEach(k=>{const v=_snapNorm(k,r[k]);o[k]=v===null?null:JSON.parse(JSON.stringify(v));});return o;}
function _snapBack(k,v){
  if(v!==null&&v!==undefined)return JSON.parse(JSON.stringify(v));
  return ['shipSegments','allShipIds'].includes(k)?[]:_SNAP_NUM.includes(k)?0:k==='archived'?false:'';
}
function _snapPrevRes(r){
  if(!r||!r.resolution)return null;
  const p=JSON.parse(JSON.stringify(r.resolution));delete p.closeSnap;
  if(typeof _caseOf==='function'&&_caseOf(r)){delete p.chase;p._chaseRides=1;}
  return p;
}
/* Jack approving a proposal: whatever moved since she proposed it becomes the new starting point */
function _snapRebase(sn,r){
  if(!sn||!sn.before||!sn.after)return;
  const moved=_SNAP_COUNT.filter(k=>!_snapSame(k,r[k],sn.after[k]));
  moved.forEach(k=>{sn.before[k]=_snapTake(r,[k])[k];});
  if(moved.length)Object.assign(sn.before,_snapTake(r,_SNAP_LABEL));
}
function _snapSay(k,from,to){
  if(_SNAP_WORD[k])return `${_SNAP_WORD[k]} ${fmt(parseInt(from)||0)} → ${fmt(parseInt(to)||0)}`;
  if(k==='archived')return to?'off the Prep Sheet again':'back on the Prep Sheet';
  if(k==='shipSegments'){const ids=a=>(a||[]).map(s=>s&&s.shipId).filter(Boolean),gone=ids(from).filter(x=>!ids(to).includes(x));
    return gone.length?`taken off ${gone.join(', ')}`:'';}
  return '';
}
async function reopenResolution(rid,skipConfirm){
  const r=_rowById(rid);if(!r)return;
  if(!skipConfirm&&!confirm('Put this back on the follow-up queue?'))return;
  /* Undo used to null the resolution outright, which took the whole chase log
     with it — weeks of "who was contacted, when, what they said" gone behind a
     button that only promised to move the row. The closure is undone; the
     history it was built on is kept and the case simply becomes hers again. */
  const res=r.resolution||null,sn=res&&res.closeSnap&&res.closeSnap.before&&res.closeSnap.after?res.closeSnap:null;
  const now=new Date().toISOString(),put=[],kept=[];let check='';
  if(sn){
    const moved=_SNAP_COUNT.filter(k=>!_snapSame(k,r[k],sn.after[k]));
    _SNAP_COUNT.forEach(k=>{
      if(moved.includes(k)){if(_SNAP_WORD[k]||k==='shipSegments')kept.push(_SNAP_WORD[k]||'shipments');return;}
      if(_snapSame(k,r[k],sn.before[k]))return;
      const s=_snapSay(k,r[k],sn.before[k]);if(s)put.push(s);
      r[k]=_snapBack(k,sn.before[k]);});
    if(!moved.length)_SNAP_LABEL.forEach(k=>{if(!_snapSame(k,r[k],sn.before[k]))r[k]=_snapBack(k,sn.before[k]);});
  }else if(res){
    /* a close-off from before 29 Oct has no snapshot. What it recorded exactly is put back — the units it
       counted as gone out under another SKU (wentAsQty, held in Cancelled). A count it typed is not guessed
       at: it is named, for Jack to correct. */
    const wa=parseInt(res.wentAsQty)||0,cx=parseInt(r.cancelledQty)||0;
    if(wa>0&&cx>0){const to=Math.max(0,cx-wa);put.push(`Cancelled ${fmt(cx)} → ${fmt(to)} (the ${fmt(cx-to)} it said went out as ${res.wentAs||'another SKU'})`);r.cancelledQty=to;}
    const bi=_closeBookedIn(r);if(bi)check=`check Qty Received: the close-off booked in ${fmt(bi.n)}`;
  }
  const line={at:now,by:_who(),what:'Closure undone — back on the queue'+(put.length?' · units put back: '+put.join(', '):'')
    +(kept.length?' · changed since the close, left as they are: '+kept.join(', '):'')+(check?' · '+check:'')};
  const wasBecki=!!(res&&res.amzDelivered&&!res.amzDelivered.done);
  if(sn&&('prev' in sn)){
    /* back exactly where it was — with Jack's answer on it, or on his page if he was the one asked */
    const p=sn.prev?JSON.parse(JSON.stringify(sn.prev)):null;
    const ch=(p&&p._chaseRides)?((res&&res.chase)||null):((p&&p.chase)||null);
    if(p){delete p._chaseRides;if(ch)p.chase=Object.assign({},ch,{log:(ch.log||[]).concat([line])});else delete p.chase;}
    r.resolution=p;
  }else{
    const _keep=(res&&res.chase)||null;
    r.resolution=_keep?{state:'working',chase:Object.assign({},_keep,{log:(_keep.log||[]).concat([line])})}:null;
  }
  /* the close had sent units to Becki's shelf check — that flag went with it, so her note says so */
  if(wasBecki&&!(r.resolution&&r.resolution.amzDelivered&&!r.resolution.amzDelivered.done)){
    r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${_ddUK(new Date())}: close-off undone — no need to check the shelves`;
    r.vaNoteBy=_who();r.vaNoteAt=now;}
  r._dirty=true;
  try{await saveRow(r);}catch(e){}
  toast(check?`Reopened — ${check}`:put.length?'Back on the queue — the units it changed are put back':'Back on the queue');
  logAudit('Closure reopened',`${r.sku||r.asin||''} — ${put.length?'units put back: '+put.join(', '):'no units to put back'}`
    +(kept.length?` · changed since the close, left as they are: ${kept.join(', ')}`:'')+(check?` · ${check}`:''));
  renderAdmin();try{renderDashboard();}catch(e){}try{renderJack();}catch(e){}
}

/* ── CLOSE-OFFS THAT LOOK WRONG (Jack, 29 Oct: "make sure any mistakes are back on Jack's sheet so I can
   reopen them") — every close-off of the last 30 days, read against the rules the guards above now enforce:
     a · "went out under" isn't a SKU of this product, or is a shipment ID (the OneBlade)
     b · an Amazon order closed as here / gone out under another SKU, with units traced or booked in by it,
         and no account check by Jack on record (_closedJackChecked)
     c · a close that booked in units nobody counted (the C920 — _closeBookedIn)
   Each line: Reopen (reopenResolution, the units put back) or Looks right (stamped, never listed again).
   Jack only. closeMistakesHtml() is the panel for his page. */
const _CM_DAYS=30;
const _CM_ARRIVED=['arrived-ok','wrong-sku','cancel-wrong-sku','part-cancelled','gated'];
/* (c) How a count typed into the old close-off is recognised. It wrote r.rcvd straight in, with no stamp of its
   own; rule R5 (js/rules.js) then stamped rcvdAt in that same save, because the row now had units and no stamp.
   Every real booking path (count-in, the Received cell, the issue popup, SellerFuse) stamps rcvdAt when the count
   moves. So: the row holds units, NONE have gone out (units on a shipment existed), and rcvdAt sits 0–2 minutes
   after the close → the close-off put them there and nobody has counted since. Becki's own find on the row
   (her "found it" note, a count-in line of hers in the case log) clears it.
   Not caught: a close that raised a count already stamped earlier (4 counted Monday, 6 typed Tuesday) — the
   stamp doesn't move. Possible false alarm: a row booked in before R5 (mid-Sep) and never saved again until its
   close-off — on an order from before 16 Sep the line says "Possibly". Close-offs from this build carry a
   snapshot and are read from it exactly (and can no longer book anything in). */
function _closeBookedIn(r){
  const res=r&&r.resolution;if(!res||res.state!=='approved')return null;
  const n=x=>parseInt(x)||0,got=n(r.rcvd);
  if(got<=0||_sentOut(r)>0)return null;
  const sn=res.closeSnap;
  if(sn&&sn.before&&sn.after){const up=n(sn.after.rcvd)-n(sn.before.rcvd);return up>0?{n:up,sure:true,how:'snapshot'}:null;}
  if(!_CM_ARRIVED.includes(res.what))return null;
  const t0=Date.parse(res.at||''),t1=Date.parse(r.rcvdAt||'');if(!t0||!t1)return null;
  const d=t1-t0;if(d<-5e3||d>120e3)return null;
  const lg=(res.chase&&res.chase.log)||[];
  if(lg.some(e=>/^beck/i.test(String(e.by||''))&&/count|book|found/i.test(String(e.what||''))))return null;
  if(/found it/i.test(String(r.vaNote||'')))return null;
  const od=typeof _sfOrderISO==='function'?_sfOrderISO(r):'';
  return{n:got,sure:!!od&&od>='2026-09-16',how:'stamp'};
}
/* (b) Jack's account check, read off a close that is already done. A close from this build records it
   (resolution.jackCheck). An older one threw his answer away when it rebuilt the resolution, so what is left is
   used: Jack closing it himself, "it was 4" (notDup), his answer in the case log, his ASIN tick, or Arrived = Yes
   (his YES or Becki's count — either way not a guess). */
function _closedJackChecked(r){
  const res=(r&&r.resolution)||{};
  if(res.jackCheck)return !res.jackCheck.no;
  if(_isJackName(res.by)||_isJackName(res.approvedBy))return true;
  if(res.notDup)return true;
  const h=_jackLogHit(res.chase&&res.chase.log);if(h)return !h.no;
  if(r.delivered==='Yes')return true;
  try{const k=typeof asinCheckFor==='function'?asinCheckFor(r):null;if(k&&k.covered)return true;}catch(e){}
  return false;
}
function closeMistakes(){
  const since=Date.now()-_CM_DAYS*864e5,out=[],n=x=>parseInt(x)||0;
  (rows||[]).forEach(r=>{
    const res=r&&r.resolution;if(!res||res.state!=='approved'||res.closeOk)return;
    const t=Date.parse(res.approvedAt||res.at||'');if(!(t>=since))return;
    const why=[];
    /* a */
    if(res.wentAs){
      const j=_srtSkuJudge(res.wentAs,r),ov=res.wentAsCheck&&res.wentAsCheck.notThisProduct&&res.wentAsCheck.override;
      if(j.kind==='shipid')why.push({k:'a',t:`“Went out under” says “${res.wentAs}” — ${j.ids.length>1?fmt(j.ids.length)+' shipment IDs':'a shipment ID'}, not a SKU`});
      else if(j.kind!=='same'&&!ov)why.push({k:'a',t:j.kind==='other'?`Went out under ${j.sku} — a SKU of another product (${String((j.row&&j.row.prod)||'').slice(0,50)})`
        :j.kind==='own'?`Went out under ${j.sku} — this line’s own SKU`:`Went out under “${res.wentAs}” — not a SKU PrepHub knows`});
    }
    const bi=_closeBookedIn(r),traced=n(res.wentAsQty)+n(res.elsewhereShipped);
    /* b — only where the close made something a fact: units traced to another SKU, or booked in */
    if(typeof _amazonRow==='function'&&_amazonRow(r)&&['arrived-ok','wrong-sku','cancel-wrong-sku'].includes(res.what)&&(traced>0||bi)&&!_closedJackChecked(r))
      why.push({k:'b',t:`Amazon order closed as “${_resText(res.what)}” — Jack never checked the account`});
    /* c */
    if(bi)why.push({k:'c',n:bi.n,t:`${bi.sure?'':'Possibly: '}the close-off booked in ${fmt(bi.n)} that nobody counted — nothing has been sent`});
    if(why.length)out.push({r,rid:String(r.uuid||r.id),what:res.what,by:res.by||'',at:res.approvedAt||res.at,why,kinds:why.map(w=>w.k),
      ord:n(r.exp),got:n(r.rcvd),sent:_sentOut(r),cx:_cxParts(r),away:n(res.elsewhereShipped),snap:!!(res.closeSnap&&res.closeSnap.before),bookedIn:bi?bi.n:0});
  });
  return out.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
}
function closeMistakesHtml(){
  if(!(typeof _isJack==='function'&&_isJack()))return '';
  let L=[];try{L=closeMistakes();}catch(e){console.warn('[close-off mistakes]',e);return '';}
  if(!L.length)return '';
  const line=m=>{const r=m.r,cx=m.cx,id=esc(m.rid);
    const nums=[`${fmt(m.ord)} ordered`,`${fmt(m.got)} booked in`,`${fmt(m.sent)} sent`,cx.cancelled?`${fmt(cx.cancelled)} cancelled`:'',
      cx.wentAs?`${fmt(cx.wentAs)} counted as gone out under ${esc(cx.sku||'another SKU')}`:'',
      m.away?`${fmt(m.away)} booked in, counted as shipped under ${esc((r.resolution&&r.resolution.wentAs)||'another SKU')}`:''].filter(Boolean).join(' &middot; ');
    const tip=m.snap?'Back on the queue — the units this close-off changed are put back exactly, and the row goes back to where it was'
      :m.bookedIn?`Back on the queue. This close-off is older than the units snapshot, so Qty Received stays at ${m.got} — it tells you to check it`
      :'Back on the queue — what it counted as gone out under another SKU is owed again';
    return `<div class="jkDoneRow" style="display:block;padding:9px 0;border-top:1px solid var(--border);">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
        <b style="font-size:12.5px;">${esc(String(r.prod||r.sku||'').slice(0,70))}</b>
        <span style="font-size:11px;color:var(--text3);">${esc(r.sku||'')}${r.oid?' &middot; '+esc(r.oid):''}${r.sup?' &middot; '+esc(r.sup):''}</span>
        <span style="font-size:11px;color:var(--text2);">closed as &ldquo;${esc(_resText(m.what))}&rdquo;${m.by?' by '+esc(m.by):''} &middot; ${esc(_logWhen(m.at))}</span></div>
      <ul style="margin:5px 0 4px 18px;padding:0;font-size:12px;line-height:1.45;color:#fca5a5;">${m.why.map(w=>`<li>${esc(w.t)}</li>`).join('')}</ul>
      <div style="font-size:11.5px;color:var(--text2);margin-bottom:6px;">Now: ${nums}</div>
      <div class="csActs"><button class="csAct warn" onclick="closeMistakeReopen('${id}')" title="${esc(tip)}">Reopen</button>
        <button class="csAct plain" onclick="closeMistakeOk('${id}')" title="You have checked it — it stays closed and is not listed again">Looks right &mdash; keep it closed</button></div>
    </div>`;};
  return `<details class="jkInfo" open style="border-color:rgba(248,113,113,.45);"><summary><span class="jkInfoT">Close-offs that look wrong</span><span class="jkInfoN">${fmt(L.length)}</span><span class="ovDim2">the last ${_CM_DAYS} days, checked against the close-off guards &mdash; Reopen puts it back on the queue with the units it changed put back</span></summary>
    ${L.map(line).join('')}</details>`;
}
async function closeMistakeReopen(rid){
  if(!(typeof _isJack==='function'&&_isJack())){toast('Only Jack can reopen these here','er');return;}
  await reopenResolution(rid,true);
}
async function closeMistakeOk(rid){
  if(!(typeof _isJack==='function'&&_isJack())){toast('Only Jack can do this','er');return;}
  const r=_rowById(rid);if(!r||!r.resolution)return;
  const was=((closeMistakes().find(m=>m.rid===String(r.uuid||r.id))||{}).why||[]).map(w=>w.t);
  r.resolution.closeOk={by:_who(),at:new Date().toISOString(),saw:was};
  r._dirty=true;
  try{await _mustSave(r);}catch(e){delete r.resolution.closeOk;toast('Didn’t save — nothing was recorded','er');return;}
  try{logAudit('Close-off checked — looks right',`${r.sku||r.asin||''} — ${was.join(' · ')}`);}catch(e){}
  toast('Kept closed — it won’t be listed again','ok');
  try{renderJack();}catch(e){}
}

// ── FIXING A WRONG EXPECTED QUANTITY ──────────────────────────────────────────
/* The sheet said 3, there were only ever 2. That is an entry mistake, not
   missing stock — it must not sit in the queue looking like a loss. Sarah can
   correct it, but old → new, who and why are recorded on the row and in the
   audit log, and Jack gets it in his list so nothing moves behind his back. */
let _qfRid=null;
function openQtyFix(rid,preset){
  const r=_rowById(rid);if(!r)return;
  _qfRid=rid;preset=preset||null;
  let el=document.getElementById('qtyFixModal');
  if(!el){el=document.createElement('div');el.id='qtyFixModal';el.className='overlay';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)closeQtyFix();});}
  el.innerHTML=`<div class="modal srtMod" style="max-width:520px;height:auto;max-height:88vh;">
    <div class="srtHd">
      <div style="min-width:0;">
        <div class="srtTtl">Correct the expected quantity</div>
        <div class="srtSub">${esc(r.prod||r.sku||'')}</div>
      </div>
      <button class="srtX" onclick="closeQtyFix()">✕</button>
    </div>
    <div class="srtBody">
      ${preset&&preset.banner?`<div class="srtWarn" style="background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.45);color:#86efac;margin-bottom:10px;">${esc(preset.banner)}</div>`:''}
      <div class="srtWarn" style="background:rgba(96,165,250,.1);border-color:rgba(96,165,250,.4);color:#93c5fd;">
        This records an admin correction — an entry mistake, not missing stock. No claim is raised.
      </div>
      <div class="srtQty" style="grid-template-columns:1fr 1fr;margin-top:14px;">
        <div><span>Sheet says</span><input type="number" value="${r.exp||0}" disabled style="opacity:.6;"></div>
        <div><span>Actually ordered</span><input type="number" id="qfNew" value="" placeholder="${r.exp||0}" min="0" oninput="qfSync()" onchange="qfSync()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveQtyFix();}"></div>
      </div>
      <div class="srtHint" id="qfHint"></div>
      <label id="qfRcvdWrap" class="srtChk" style="display:none;margin-top:8px;"><input type="checkbox" id="qfRcvd" ${(typeof _amazonRow==='function'&&_amazonRow(r))?'checked':''}><span id="qfRcvdT"></span></label>
      ${r.sheetRow?`<div class="srtHint" style="margin-top:8px;color:var(--text3);">Purchase Sheet row <b style="color:var(--text2);">${esc(r.sheetRow)}</b> needs the same correction — it'll be added to your list.</div>`:''}
      <label class="srtLab" style="margin-top:14px;">Why is it different? <span style="color:var(--text3);font-weight:600;">optional</span></label>
      <textarea id="qfWhy" class="srtNote" rows="2" oninput="qfSync()" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();saveQtyFix();}" placeholder="e.g. purchase sheet was typed wrong — only 9 were ever ordered"></textarea>
    </div>
    <div class="srtFoot">
      <div class="srtFootMsg" id="qfMsg"></div>
      <button class="srtGhost" onclick="closeQtyFix()">Cancel</button>
      <button class="srtGo" id="qfGo" onclick="saveQtyFix()">Save correction</button>
    </div>
  </div>`;
  el.style.display='flex';
  if(preset){const _n=document.getElementById('qfNew'),_w=document.getElementById('qfWhy');
    if(_n&&preset.to!=null)_n.value=String(preset.to);if(_w&&preset.why)_w.value=preset.why;}
  qfSync();
  setTimeout(()=>{const n=document.getElementById('qfNew');if(n)n.focus();},40);
}
function closeQtyFix(){const el=document.getElementById('qtyFixModal');if(el)el.style.display='none';_qfRid=null;}
function qfSync(){
  const r=_rowById(_qfRid);if(!r)return;
  const nv=parseInt((document.getElementById('qfNew')||{}).value);
  const got=parseInt(r.rcvd)||0;
  const h=document.getElementById('qfHint'),go=document.getElementById('qfGo'),msg=document.getElementById('qfMsg');
  const why=((document.getElementById('qfWhy')||{}).value||'').trim();
    const ok=!isNaN(nv)&&nv>=0&&nv!==(r.exp||0);
  if(h){
    if(isNaN(nv)||nv<0){h.textContent='Enter a number.';h.style.color='#f87171';}
    else if(nv===got){h.textContent='That matches what arrived — the row goes clear and can carry on to Amazon.';h.style.color='var(--green)';}
    else if(nv<got){h.textContent='That is fewer than the '+got+' already booked in.';h.style.color='#f87171';}
    else{h.textContent=(nv-got)+' unit'+(nv-got===1?'':'s')+' would still be outstanding.';h.style.color='#fbbf24';}
  }
  /* 22 Oct 2026, Centrum: if fewer were ordered than were booked in, the count is wrong too —
     Becki's box was filled with the order quantity. Offered, never silent; on an Amazon order
     it starts ticked, because more cannot arrive than were ordered. */
  {const wr=document.getElementById('qfRcvdWrap'),t=document.getElementById('qfRcvdT'),sent=parseInt(r.ship)||0;
   if(wr){const show=!isNaN(nv)&&nv<got&&nv>=sent;wr.style.display=show?'flex':'none';
     if(show&&t)t.innerHTML=`Booked in says <b>${got}</b> — only ${nv} can have come. Set booked in to <b>${nv}</b> as well.`;
     if(show&&h){h.textContent='Fewer than the '+got+' booked in — the box below puts that right too.';h.style.color='#fbbf24';}}
   if(h&&!isNaN(nv)&&nv<sent){h.textContent='That is fewer than the '+sent+' already sent to Amazon — check the number.';h.style.color='#f87171';}}
  if(go){go.disabled=!ok;go.style.opacity=ok?'1':'.45';}
  if(msg)msg.textContent=ok?'Enter saves it.':(isNaN(nv)?'Type the real number.':'Change the number to save.');
}
async function saveQtyFix(){
  const r=_rowById(_qfRid);if(!r)return;
  const nv=parseInt((document.getElementById('qfNew')||{}).value);
  if(isNaN(nv)||nv<0||nv===(r.exp||0))return;
  const why=((document.getElementById('qfWhy')||{}).value||'').trim();
  const from=r.exp||0;
  r.qtyFix={from,to:nv,by:_who(),at:new Date().toISOString(),why,seen:false};
  r.exp=nv;r.aqty=nv;
  {const was=parseInt(r.rcvd)||0,box=document.getElementById('qfRcvd'),wrap=document.getElementById('qfRcvdWrap');
   if(nv<was&&nv>=(parseInt(r.ship)||0)&&box&&box.checked&&wrap&&wrap.style.display!=='none'){
     r.rcvd=nv;r.qtyFix.rcvdFrom=was;
     try{logAudit('Booked-in count corrected',`${r.sku||r.asin||''} — ${was} → ${nv} (only ${nv} ordered) by ${_who()}`);}catch(e){}}}
  try{_statusFollowsStock(r);}catch(e){}
  /* A claim raised only because the sheet was wrong is not a real claim. */
  const got=parseInt(r.rcvd)||0;
  let cleared=0;
  if(nv<=got){
    if(r.issueType&&r.issueType!=='None'){r.issueType='';r.issueQty=0;cleared++;}
    if(['Late — Needs Chasing','Urgent — Chase Now','Chasing Supplier','Awaiting Update','Delayed'].includes(r.transitAction))r.transitAction='';
    try{
      (claims||[]).filter(c=>String(c.prepRowId)===String(r.uuid||r.id)&&c.cst!=='Resolved').forEach(c=>{
        c.cst='Resolved';c.resolvedAt=c.resolvedAt||todayISO();
        if(!c.log)c.log=[];
        c.log.push({t:getNowUK(),msg:'Closed automatically — expected quantity corrected from '+from+' to '+nv+' by '+_who()});
        saveClaim(c);cleared++;
      });
    }catch(e){}
  }
  /* If the real number leaves nothing outstanding there is no longer anything
     to check — the row should not sit on Jack's page asking what happened to
     units that were never ordered. Sarah still gets the Purchase Sheet job. */
  let _ended=false;
  if(nv<=got&&r.resolution&&['asked','proposed','rejected','working'].includes(r.resolution.state)){
    const _ch=r.resolution.chase||null;
    if(_ch)_ch.log=(_ch.log||[]).concat([{at:new Date().toISOString(),by:_who(),
      what:`Sheet quantity corrected ${from} → ${nv} — nothing was missing`}]);
    r.resolution=Object.assign({},r.resolution,{state:'approved',kind:'ops',what:'qty-fixed',
      approvedBy:_who(),approvedAt:new Date().toISOString(),chase:_ch||undefined});
    _ended=true;
  }
  r._dirty=true;
  closeQtyFix();
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  /* Jack, 10 Sep: "fix the sheet and close it" — the sheet job is the point,
     not a bonus for rows that happen to remember their sheet row number. */
  try{await addVaActions(r,['Update Purchase Sheet'],'Expected quantity corrected '+from+' → '+nv+(why?' — '+why:''));}catch(e){}
  toast(_ended?`Corrected to ${nv} — nothing is missing, it closes on every page`:(cleared?'Corrected — the false issue is cleared':'Expected quantity corrected'),'ok');
  logAudit('Expected qty corrected',`${r.sku||r.asin||''} — ${from} → ${nv}${why?' ('+why+')':''}`);
  fireWebhook(`${_who()} corrected the expected quantity on "${r.prod||r.sku||''}" from ${from} to ${nv}.${why?' Reason: '+why:''}`,
    {event:'qty_corrected',sku:r.sku||'',from,to:nv});
  try{renderPrepRows&&renderPrep&&renderPrep();}catch(e){}
  renderAdmin();
  try{renderJack();}catch(e){}
  try{renderDashboard();}catch(e){}
}
async function ackQtyFix(rid){
  const r=_rowById(rid);if(!r||!r.qtyFix)return;
  r.qtyFix.seen=true;r._dirty=true;
  try{await saveRow(r);}catch(e){}
  renderAdmin();try{renderDashboard();}catch(e){}
}

// ── WHAT IS WAITING ON WHOM ───────────────────────────────────────────────────
/* ── HISTORY LOOKUP (Jack, 30 Aug): search SKU/ASIN/order → matching records
   (archived included) → one click → the row's whole story, written out and
   copyable for pasting into the Purchase Sheet. Pre-June rows never entered
   the hub, so they can't be reconstructed here — by design. */
function lkFind(q){
  const out=document.getElementById('lkOut');if(!out)return;
  q=String(q||'').trim().toLowerCase();
  if(q.length<4){out.innerHTML='<div class="pmeta">Type at least 4 characters of a SKU, ASIN or order number.</div>';return;}
  const hits=rows.filter(r=>((r.sku||'')+' '+(r.asin||'')+' '+(r.oid||'')).toLowerCase().includes(q)).slice(0,25);
  if(!hits.length){out.innerHTML='<div class="pmeta">Nothing matches — if it was bought before the Prep Hub started (June), it was never in here.</div>';return;}
  out.innerHTML='<div class="pmeta" style="margin-bottom:8px;">'+fmt(hits.length)+' match'+(hits.length===1?'':'es')+(hits.length===25?' (first 25)':'')+'</div>'
    +hits.map(r=>`<div onclick="lkOpen('${r.uuid||r.id}')" style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:9px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;${r.archived?'opacity:.6;':''}" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
      <span class="num" style="font-size:11px;color:var(--text3);">${esc(r.date||'—')}</span>
      <b style="font-size:12px;">${esc((r.prod||'').slice(0,60)||r.sku||'')}</b>
      <span class="s-sku" style="font-size:10.5px;">${esc(r.sku||'')}</span>
      <span style="font-size:10.5px;color:var(--text2);">${esc(r.sup||'')} · ${esc(r.status||'—')} · ${fmt(r.exp||0)} ordered${r.archived?' · archived':''}</span>
    </div>`).join('');
}
function lkStory(r){
  const seg=(r.shipSegments||[]).map(s=>`${fmt(s.units||0)} units → shipment ${s.shipId||'?'}${s.date?' on '+s.date:''}`);
  const cls=(claims||[]).filter(c=>String(c.prepRowId)===String(r.uuid||r.id));
  const cl=_squashBounces((r.resolution&&r.resolution.chase&&r.resolution.chase.log)||[]);
  const L=[];
  L.push(`${r.prod||r.sku||''}`);
  L.push(`SKU ${r.sku||'—'} · ASIN ${r.asin||'—'} · ${r.sup||'—'} · ${r.acct||'—'}${r.oid?' · order '+r.oid:''}`);
  L.push(`ordered ${r.date||'—'} · ${fmt(r.exp||0)} ordered / ${fmt(parseInt(r.rcvd)||0)} arrived / ${fmt(parseInt(r.ship)||0)} shipped${_cxLabel(r,' / ')} · status ${r.status||'—'}${r.archived?' · ARCHIVED':''}`);
  if(r.expectedDelivery)L.push(`expected delivery ${r.expectedDelivery}`);
  seg.forEach(s=>L.push(s));
  if(r.issueType&&r.issueType!=='—')L.push(`issue: ${r.issueType}${r.issueQty?' ('+r.issueQty+' units)':''}`);
  cls.forEach(c=>L.push(`claim: ${c.issT||''} · ${c.cst||''}${c.claimValue?' · '+fmtGBP2(c.claimValue):''}${c.resolvedAt?' · resolved '+c.resolvedAt:''}`));
  if(r.resolution&&r.resolution.what)L.push(`closed as: ${_resText(r.resolution.what)}${r.resolution.by?' — '+r.resolution.by:''}`);
  cl.slice(-6).forEach(x=>L.push(`${_logWhen(x.at)} · ${x.by||''} — ${x.what||''}`));
  if(r.notes)L.push(`note: "${r.notes}"`);
  return L.filter(Boolean).join('\n');
}
function lkOpen(rid){
  const r=_rowById(rid);if(!r)return;
  const out=document.getElementById('lkOut');if(!out)return;
  const story=lkStory(r);
  out.innerHTML=`<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
        <b style="font-size:13px;">${esc(r.prod||r.sku||'')}</b>
        <button class="btn sm pri" onclick="copyVal(${JSON.stringify(story).replace(/"/g,'&quot;')},this)">Copy the story — paste into the sheet</button>
        <button class="btn sm" onclick="lkFind(document.getElementById('lkQ').value)">&larr; back to results</button>
      </div>
      <pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11.5px;line-height:1.6;color:var(--text2);margin:0;">${esc(story)}</pre>
    </div>`;
}
