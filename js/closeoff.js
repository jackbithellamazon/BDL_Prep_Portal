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
          <input id="srtSku" class="srtSel" autocomplete="off" placeholder="Pick the SKU from the list, or type it"
            oninput="srtSkuSearch()" onfocus="srtSkuSearch()" onkeydown="srtSkuKey(event)"
            onblur="setTimeout(srtSkuShut,130)">
          <div class="srtComboList" id="srtSkuList" style="display:none;"></div>
        </div>
        <div class="srtHint" id="srtSkuHint"></div>
      </div>

      <div id="srtAskShipid" style="display:none;margin-top:14px;">
        <label class="srtLab">Which FBA shipment did it go on?</label>
        <input id="srtShipId" class="srtSel" autocomplete="off" placeholder="FBA15ABCDEFG"
          style="text-transform:uppercase;font-family:var(--mono);letter-spacing:.04em;"
          oninput="this.value=this.value.toUpperCase()">
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
        <div><span>Ordered</span><input type="number" id="srtOrd" value="${units}" onchange="srtSync()"></div>
        <div><span>Arrived</span><input type="number" id="srtGot" value="${got}" onchange="srtSync()"></div>
        <div><span>Cancelled</span><input type="number" id="srtCx" value="${cx}" onchange="srtSync()"></div>
        <div class="srtOut"><span>Still outstanding</span><b id="srtLeft">0</b></div>
        <div id="srtSettleNote" class="srtSettleNote" style="display:none;"></div>
      </div>
      <div class="srtHint" id="srtQtyHint"></div>
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
          return c.log.map(e=>`${new Date(e.at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} — ${e.what}${e.by?' ('+e.by+')':''}`).join('\n');
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
   Free text is still accepted — the field is optional and the answer might be a
   SKU that isn't in the app at all. */
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
    'closed by '+_who()+' '+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short'})
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
  set('srtOrd',d.ord);set('srtGot',d.got);set('srtCx',d.cx);
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
  return _srtStepList(what,_resTodo(what)).filter(s=>!_srtTicks[s.k]&&!/^nothing (to do|else)/i.test(String(s.text||'')));
}
function closeSorted(){
  const el=document.getElementById('sortedModal');
  if(el){el.style.display='none';el.style.opacity='';el.style.transition='';}
  srtCfmShut();srtSkuShut();          // never leave a child popup orphaned on screen
  _srtTicks={};_srtOverride=false;
  _srtRid=null;
}
function srtSync(){
  const ord=parseInt((document.getElementById('srtOrd')||{}).value)||0;
  const got=parseInt((document.getElementById('srtGot')||{}).value)||0;
  const cx =parseInt((document.getElementById('srtCx') ||{}).value)||0;
  const left=ord-got-cx;
  const L=document.getElementById('srtLeft');
  const _pk=(document.getElementById('srtWhat')||{}).value||'';
  const _settles=left>0&&['arrived-ok','wrong-sku','cancel-wrong-sku','cancelled','duplicate'].includes(_pk);
  if(L){L.textContent=left;L.style.color=left===0||_settles?'var(--green)':(left<0?'#f87171':'#fbbf24');L.title='';}
  /* Jack, 9 Sep: a closure used to leave the outstanding units exactly as they
     were, which is how five rows ended up closed on one page and open on the
     Prep Sheet. Now closing settles them — so the popup says so out loud
     rather than hiding it in a tooltip. */
  {const _sn=document.getElementById('srtSettleNote');
   if(_sn){
     const _sku=((document.getElementById('srtSku')||{}).value||'').trim();
     _sn.style.display=_settles?'block':'none';
     _sn.innerHTML=!_settles?'':(
       _pk==='arrived-ok'?`Closing books the <b>${fmt(left)}</b> still out in as arrived &mdash; nothing stays outstanding.`
       :(_pk==='wrong-sku'||_pk==='cancel-wrong-sku')?`Closing accounts for the <b>${fmt(left)}</b> still out on ${_sku?('<b>'+esc(_sku)+'</b>'):'the other SKU'} &mdash; the row comes off the Prep Sheet.`
       :`Closing records the <b>${fmt(left)}</b> still out as cancelled &mdash; the row comes off the Prep Sheet.`);
   }}
  const hint=document.getElementById('srtQtyHint');
  if(hint){
    hint.textContent = left<0 ? 'That adds up to more than were ordered — check the numbers.'
      : left===0 ? 'Nothing outstanding — this stops showing as late anywhere in the app.'
      : left+' unit'+(left===1?'':'s')+' would still be treated as on the way.';
    hint.style.color = left<0?'#f87171':(left===0?'var(--green)':'#fbbf24');
  }
  const what=(document.getElementById('srtWhat')||{}).value||'';
  const warn=document.getElementById('srtClaimWarn');
  if(warn)warn.style.display=_resClaim(what)?'block':'none';
  const _r0=_rowById(_srtRid);
  const kind=_resKind(what,_r0);
  const kEl=document.getElementById('srtKind');
  if(kEl&&what){
    kEl.style.display='block';
    kEl.textContent=(kind==='biz'&&_r0&&_jackSupplier(_r0.sup)&&_resClaim(what))
      ? 'Amazon claim — Jack raises this, not you'
      : _kindWord(kind);
    kEl.style.color=kind==='ops'?'#86efac':'#93c5fd';
    kEl.style.background=kind==='ops'?'rgba(74,222,128,.1)':'rgba(96,165,250,.1)';
    kEl.style.borderColor=kind==='ops'?'rgba(74,222,128,.4)':'rgba(96,165,250,.4)';
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
  const sh=document.getElementById('srtSkuHint');
  if(sh){
    const r0=_rowById(_srtRid)||{};
    const hit=wentAs?rows.find(x=>(x.sku||'').toLowerCase()===wentAs.toLowerCase()):null;
    const same=rows.filter(x=>!x.archived&&x.asin&&x.asin===r0.asin&&x.sku!==r0.sku).length;
    sh.textContent=!wentAs
      ? (same?`Goes on the Purchase Sheet note so it can be traced. ${same} other row${same===1?'':'s'} share this ASIN.`
             :'Goes on the Purchase Sheet note so it can be traced.')
      : hit?('Matched — '+(hit.prod||hit.sku||'').slice(0,50))
      : 'Not a row in the app — still recorded on the note.';
    sh.style.color=!wentAs?'var(--text2)':(hit?'var(--green)':'#fbbf24');
  }
  const arrived=(document.getElementById('srtArrived')||{}).value||'';
  const due=(document.getElementById('srtDate')||{}).value||'';
  try{if(what)_srtPaintSteps(what,_resTodo(what));}catch(e){}
  const ph=document.getElementById('srtPaidHint');
  if(ph)ph.textContent=paid==='no'?'It never completed — the line comes off the Purchase Sheet.'
    :paid==='yes'?'The purchase stays on the sheet with the refund recorded against it.':'';
  const ah=document.getElementById('srtArrHint');
  if(ah)ah.textContent=arrived==='yes'?'Booked in as received, so it stops showing as late. The gated decision goes to Jack.'
    :arrived==='no'?'Stays outstanding. Jack decides what happens next.':'';

  const cause=((document.getElementById('srtNote')||{}).value||'').trim();
  const fix=((document.getElementById('srtFix')||{}).value||'').trim();
  const fr=document.getElementById('srtFixReq');
  const go=document.getElementById('srtGo'),msg=document.getElementById('srtMsg');
  /* Jack, 10 Sep: "'wrong SKU' is not enough information by itself — we need
     the missing SKU AND the SKU Sarah confirmed it went out under, or when I
     ask later what she found, you don't know." So it is no longer optional. */
  const missingAsk=(ask.includes('paid')&&!paid)
    ||(ask.includes('paid')&&paid==='yes'&&!refunded)
    ||(ask.includes('arrived')&&!arrived)||(kind==='date'&&!due)
    ||(ask.includes('sku')&&!wentAs);
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
  window._srtGate={ok,what,left,mism,missingAsk,needFix:!!(needFix&&!fix),todoLeft,paid,ask};
  if(go){
    go.disabled=!what;go.style.opacity=what?'1':'.45';go.style.cursor=what?'pointer':'not-allowed';
    /* nothing reaches Jack before the investigation is written down */
    go.textContent=kind==='date'?'Set the date':(kind==='ops'?'Close it off':'Send to Jack');
  }
  const sv=document.getElementById('srtSaveBtn');
  if(sv)sv.style.display=what?'inline-block':'none';
  if(fr){fr.textContent=needFix?'required':'optional';fr.style.color=needFix?'#f87171':'var(--text3)';}
  const fx=document.getElementById('srtFixBox');
  if(fx)fx.style.display=needFix?'block':'none';
  if(msg){
    const plain=!what?'Pick what happened first.'
      :left<0?'The units don\'t add up.'
      :mism==='full'?`${got} unit${got===1?'':'s'} did arrive — that is a part cancellation, not the whole order.`
      :mism==='part'?'Nothing arrived at all — that is the whole order cancelled.'
      :missingAsk?(ask.includes('sku')&&!wentAs?'Say which SKU it went out under — pick it from the list.':'Answer the question above.')
      :(needFix&&!fix)?'Say what you suggest we do.'
      :todoLeft.length?`${todoLeft.length} step${todoLeft.length===1?'':'s'} still to tick off.`
      :kind==='date'?'Stays on the list, just not overdue until then.'
      :kind==='gated'?'Recorded, then the gated decision goes to Jack.'
      :kind==='ops'?'You can close this yourself — Jack is told, not asked.'
      :'Jack gets your findings and makes the call.';
    /* Offer the switch rather than just refusing — she knows what happened, the
       app is the one that picked the wrong word for it. */
    const swap=mism==='full'?`<button type="button" class="srtSwap" onclick="srtPick('part-cancelled')">Use “Part arrived, the rest cancelled” →</button>`
              :mism==='part'?`<button type="button" class="srtSwap" onclick="srtPick('cancelled')">Use “Cancelled — the whole order” →</button>`:'';
    /* Jack, 08 Aug: a step that genuinely cannot be done yet must not trap the
       row open forever. The override is always available, always recorded, and
       every unticked step becomes a real job in the Action Centre. */
    const over=(!mism&&todoLeft.length&&!missingAsk&&left>=0&&(!needFix||!!fix))
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
  const kind=_resKind(what,r);
  /* Say what is in the way, in her words, on the button she just pressed. */
  const G=window._srtGate||{};
  if(!override&&G.ok===false){
    const need=[];let focusId='';
    if(G.left<0)need.push('The units don\u2019t add up — arrived plus cancelled is more than ordered.');
    if(G.mism==='full')need.push('Some units did arrive — pick “Part arrived, the rest cancelled” instead.');
    if(G.mism==='part')need.push('Nothing arrived at all — pick “Cancelled — the whole order” instead.');
    if(G.missingAsk){
      if((G.ask||[]).includes('paid')&&!G.paid){need.push('Answer “Had the money already left the account?” — the dropdown on the left.');focusId=focusId||'srtPaid';}
      else if((G.ask||[]).includes('paid')&&G.paid==='yes'){need.push('Say whether it has been refunded — the dropdown under the money question.');focusId=focusId||'srtRefund';}
      else if((G.ask||[]).includes('arrived')){need.push('Say whether the stock arrived — the question on the left.');focusId=focusId||'srtArrived';}
      else need.push('Set the date.');
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
  const got=parseInt((document.getElementById('srtGot')||{}).value)||0;
  const cx =parseInt((document.getElementById('srtCx') ||{}).value)||0;
  if(ord-got-cx<0){_unlatch();return;}
  const follow=FOLLOW_UPS.filter((f,n)=>{const c=document.getElementById('srtF'+n);return c&&c.checked;});
  const note=((document.getElementById('srtNote')||{}).value||'').trim();
  const fix=((document.getElementById('srtFix')||{}).value||'').trim();
  const kind=_resKind(what,r);
  const paid=(document.getElementById('srtPaid')||{}).value||'';
  const arrived=(document.getElementById('srtArrived')||{}).value||'';
  const due=(document.getElementById('srtDate')||{}).value||'';
  const wentAs=((document.getElementById('srtSku')||{}).value||'').trim();
  const refunded=(document.getElementById('srtRefund')||{}).value||'';
  /* Snapshot the ticks BEFORE anything calls closeSorted — that clears them,
     and the whole record of what was actually done would go with it. */
  const ticks=Object.assign({},_srtTicks);
  const stepsAll=_srtStepList(what,_resTodo(what));
  const stepsDone=stepsAll.filter(s=>ticks[s.k]).map(s=>s.text);
  const stepsOpen=stepsAll.filter(s=>!ticks[s.k]).map(s=>s.text);
  const override=_srtOverride,overrideWhy=_srtOverrideWhy;

  /* "Still in transit" is not a closure at all — it just dates the row. */
  if(kind==='date'){
    r.notes=note;r.notesBy=_who();r.notesAt=new Date().toISOString();
    closeSorted();
    await setDueDate(rid,due);
    logAudit('Still in transit',`${r.sku||r.asin||''} — due ${due}`);
    _unlatch();
    return;
  }
  /* Gated stock that HAS turned up must be booked in, or it keeps showing as
     missing while the real question (what do we do with it?) goes unanswered. */
  if(kind==='gated'&&arrived==='yes'){
    const units=ord||r.exp||0;
    if((parseInt(r.rcvd)||0)<units)r.rcvd=units;
    r.delivered='Yes';
  }
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
    const sid=((document.getElementById('srtShipId')||{}).value||'').trim().toUpperCase();
    if(!sid){toast('Enter the FBA shipment ID','er');_unlatch();return;}
    if(!r.rcvd||r.rcvd===0)r.rcvd=r.exp||0;
    const remain=remainingToShip(r);
    if(remain>0)addSegment(r,sid,remain,r.shipType||'Standard');
    else{const ids=r.allShipIds||[];if(!ids.includes(sid))ids.push(sid);r.allShipIds=ids;r.shipId=sid;}
    r.status='Sent to Amazon';r.sent='Yes';r.sentDate=shipDateFor(sid);r.sentAt=getNowUK();
    try{logAudit('Shipment ID added from Admin',`${r.sku||''} → ${sid}`);}catch(e){}
  }
  r.resolution={state:kind==='ops'?'approved':'proposed',kind,what,note,fix,followUps:follow,
    paid,refunded,arrived,wentAs,by:_who(),at:new Date().toISOString(),claim:_resClaim(what),
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
  /* The close-off popup wrote its "Arrived" figure straight onto the row with
     no floor, so closing a part-sent row as "nothing arrived" erased the
     received count out from under a live shipment. */
  if(got!==(parseInt(r.rcvd)||0)&&!_blockRcvdBelowSent(r,got))r.rcvd=got;
  if(ord!==(r.exp||0))r.exp=ord;
  /* an ops close is final the moment it is pressed — settle the row now */
  if(kind==='ops'){const _st=_settleClosedUnits(r,what);
    if(_st.toBecki){await _sendToBeckiShelves(r,`${fmt(_owedUnits(r))} unaccounted for after "${_resText(what)}"`);
      try{logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}
    else if(_st.changed&&_st.note){try{logAudit('Row settled on close',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}}
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
      [`${r.sku||r.asin||''} — ${_resText(what)}${wentAs?' · went out under '+wentAs:''}`,fix,
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
async function approveResolution(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  r.resolution.state='approved';
  r.resolution.approvedBy=_who();
  r.resolution.approvedAt=new Date().toISOString();
  /* Now it is genuinely closed, honour the follow-up she ticked. */
  if((r.resolution.followUps||[]).includes('Remove from Prep Sheet'))r.archived=true;
  {const _st=_settleClosedUnits(r,r.resolution.what);
   if(_st.toBecki){await _sendToBeckiShelves(r,`${fmt(_owedUnits(r))} unaccounted for after "${_resText(r.resolution.what)}"`);
     try{logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}
   else if(_st.changed&&_st.note){try{logAudit('Row settled on approval',`${r.sku||r.asin||''} — ${_st.note}`);}catch(e){}}}
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
async function reopenResolution(rid,skipConfirm){
  const r=_rowById(rid);if(!r)return;
  if(!skipConfirm&&!confirm('Put this back on the follow-up queue?'))return;
  /* Undo used to null the resolution outright, which took the whole chase log
     with it — weeks of "who was contacted, when, what they said" gone behind a
     button that only promised to move the row. The closure is undone; the
     history it was built on is kept and the case simply becomes hers again. */
  const _keep=(r.resolution&&r.resolution.chase)||null;
  r.resolution=_keep?{state:'working',chase:Object.assign({},_keep,{
    log:(_keep.log||[]).concat([{at:new Date().toISOString(),by:_who(),
      what:'Closure undone — back on the queue'}])})}:null;
  r._dirty=true;
  try{await saveRow(r);}catch(e){}
  toast('Back on the queue');
  logAudit('Closure reopened',r.sku||r.asin||'');
  renderAdmin();try{renderDashboard();}catch(e){}
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
  const cl=(r.resolution&&r.resolution.chase&&r.resolution.chase.log)||[];
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
