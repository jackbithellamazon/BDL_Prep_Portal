/* BDL PrepHub — js/claims.js — claims: raising, listing, statuses.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── COMPLETE / CLAIM ──────────────────────────────────────────────────────────
function openComp(id){pendComp=id;om('compModal');}
function doComplete(){
  const r=rows.find(x=>x.uuid===String(pendComp)||String(x.id)===String(pendComp));if(!r)return;
  // Soft-archive: hide from the active prep sheet but keep the row in the DB so
  // it stays on the Shipments page and survives a refresh. (Previously this only
  // removed the row from memory, so it vanished from shipments and reappeared on
  // reload — and was never persisted.)
  r.archived=true;r._dirty=true;
  archiveRow(r);
  logAudit('Marked Complete',r.sku);
  cm('compModal');renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();
  toast('Row completed & archived ✓ — kept on Shipments page');
}
function openClaim(id){pendClaim=id;document.getElementById('claimInitNote').value='';const _dl=document.getElementById('claimDiscordLink');if(_dl)_dl.value='';om('claimModal');}
function doClaim(){
  const r=rows.find(x=>x.uuid===String(pendClaim)||String(x.id)===String(pendClaim));if(!r)return;
  const it=document.getElementById('claimType').value;
  const initNote=document.getElementById('claimInitNote').value.trim();
  const discordLink=((document.getElementById('claimDiscordLink')||{}).value||'').trim();
  const cost=parseSKU(r.sku).cogs;
  const dif=Math.max(0,(r.exp||0)-(r.rcvd||0));
  // Check not already raised (match by uuid or local id)
  if(claims.find(c=>(c.prepRowId===(r.uuid||r.id)||c.prepRowId===r.id||c.prepRowId===r.uuid)&&c.cst!=='Resolved'&&c.cst!=='Closed')){
    toast('Action already raised for this row','er');cm('claimModal');return;
  }
  claims.unshift({
    id:Date.now(),
    prepRowId:r.uuid||r.id, // link back to prep row by unique uuid
    raisedBy:_who(),        // the source Sarah sees on her row
    date:r.date,raisedAt:todayISO(),
    sku:r.sku,asin:r.asin,
    sup:r.sup,oid:r.oid||'',prod:r.prod||'',acct:r.acct||'',
    issT:it,exp:r.exp,rec:r.rcvd,dif,
    cost,claimValue:cost*dif,
    /* An auto refund is a record, not a job. The supplier has already put it
       right, so it is filed closed and never reaches Sarah's queue — but it is
       still on the row, still in the numbers, and still shows in history. */
    discordLink:discordLink||'',
    cst:_isAutoRefund(it)?'Resolved':'Needs Attention',
    autoRefund:_isAutoRefund(it)||undefined,
    resolvedAt:_isAutoRefund(it)?todayISO():undefined,
    notes:initNote,
    owner:_issueDefaults(it.includes('Gated')?'Gated':it.includes('Missing')?'Missing':it.includes('Damaged')?'Damaged':it.includes('Overdue')||it.includes('Tracking')?'Not Arrived':'Incorrect').owner,
    nextAction:_issueDefaults(it.includes('Gated')?'Gated':it.includes('Missing')?'Missing':it.includes('Damaged')?'Damaged':it.includes('Overdue')||it.includes('Tracking')?'Not Arrived':'Incorrect').na,
    nextDue:_issueDefaults(it.includes('Gated')?'Gated':it.includes('Missing')?'Missing':it.includes('Damaged')?'Damaged':it.includes('Overdue')||it.includes('Tracking')?'Not Arrived':'Incorrect').nd,
    log:[{t:getNowUK(),msg:'Action raised from Prep Sheet'+(initNote?` — ${initNote}`:'')}],
  });
  logAudit('Action raised',r.sku);
  // Flag the prep row with issue type so it shows the red badge
  if(!r.issueType||r.issueType==='—'){
    r.issueType=it==='Missing'?'Missing':it==='Damaged'?'Damaged':'Incorrect';
    r.issueQty=dif||1;
    r._dirty=true;saveRow(r);
  }
  cm('claimModal');
  const newClaim=claims[0];
  saveClaim(newClaim);
  renderClaims();updateCB();
  toast('Action raised ⚑ — visible in Actions tab');
}

// ── CLAIMS ────────────────────────────────────────────────────────────────────
let claimEditId=null;
let _claimLogId=null;

function openAddClaim(){
  document.getElementById('cl-refund').value='';
  document.getElementById('cl-chasing').value='';
  if(document.getElementById('cl-acct'))document.getElementById('cl-acct').value='';
  claimEditId=null;
  document.getElementById('addClaimTitle').textContent='Raise Action';
  document.getElementById('cl-date').value=todayISO();
  ['cl-sup','cl-oid','cl-prod','cl-sku','cl-asin','cl-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('cl-exp').value='';
  document.getElementById('cl-rec').value='';
  document.getElementById('cl-cost').value='';
  document.getElementById('cl-issT').value='Missing Items';
  document.getElementById('cl-cst').value='Needs Attention';
  om('addClaimModal');
}
function openEditClaim(id){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  claimEditId=id;
  document.getElementById('addClaimTitle').textContent='Edit Action';
  document.getElementById('cl-date').value=c.raisedAt||todayISO();
  document.getElementById('cl-sup').value=c.sup||'';
  document.getElementById('cl-oid').value=c.oid||'';
  if(document.getElementById('cl-acct'))document.getElementById('cl-acct').value=c.acct||'';
  document.getElementById('cl-prod').value=c.prod||'';
  document.getElementById('cl-sku').value=c.sku||'';
  document.getElementById('cl-asin').value=c.asin||'';
  document.getElementById('cl-issT').value=c.issT||'Missing Items';
  document.getElementById('cl-exp').value=c.exp||'';
  document.getElementById('cl-rec').value=c.rec||'';
  document.getElementById('cl-cost').value=c.cost||'';
  document.getElementById('cl-cst').value=c.cst||'Open';
  document.getElementById('cl-notes').value=c.notes||'';
  document.getElementById('cl-refund').value=c.refund||'';
  document.getElementById('cl-chasing').value=c.chasingDate||'';
  om('addClaimModal');
}
function saveClaimForm(){
  const exp=parseInt(document.getElementById('cl-exp').value)||0;
  const rec=parseInt(document.getElementById('cl-rec').value)||0;
  const cost=parseFloat(document.getElementById('cl-cost').value)||0;
  const dif=Math.max(0,exp-rec);
  const obj={
    id:claimEditId||Date.now(),
    date:document.getElementById('cl-date').value,
    raisedAt:document.getElementById('cl-date').value,
    sup:document.getElementById('cl-sup').value.trim(),
    oid:document.getElementById('cl-oid').value.trim(),
    prod:document.getElementById('cl-prod').value.trim(),
    sku:document.getElementById('cl-sku').value.trim(),
    asin:document.getElementById('cl-asin').value.trim(),
    issT:document.getElementById('cl-issT').value,
    exp,rec,dif,cost,claimValue:cost*dif,
    cst:document.getElementById('cl-cst').value,
    notes:document.getElementById('cl-notes').value.trim(),
    refund:parseFloat(document.getElementById('cl-refund').value)||0,
    chasingDate:document.getElementById('cl-chasing').value||'',
    acct:(document.getElementById('cl-acct')||{}).value?.trim()||'',
    log:claimEditId?(claims.find(x=>x.id===claimEditId)||{}).log||[]:[{t:getNowUK(),msg:'Claim created'}],
  };
  if(claimEditId){const i=claims.findIndex(x=>String(x.id)===String(claimEditId));if(i>=0)claims[i]=obj;}
  else claims.unshift(obj);
  saveClaim(obj);
  cm('addClaimModal');renderClaims();updateCB();
  toast(claimEditId?'Action updated':'Action added ✓');
  logAudit('Action '+(claimEditId?'updated':'added'),obj.sku||obj.sup);
}

function openClaimLog(id){
  _claimLogId=id;
  id=String(id);
  const c=claims.find(x=>x.id===id);if(!c)return;
  document.getElementById('claimLogTitle').textContent=`Contact Log — ${c.sup}`;
  document.getElementById('claimLogInput').value='';
  renderClaimLog(c);
  om('claimLogModal');
}
function renderClaimLog(c){
  const el=document.getElementById('claimLogList');
  if(!c.log||!c.log.length){el.innerHTML=`<div style="color:var(--text3);font-size:11px;padding:8px 0;">No contact entries yet</div>`;return;}
  el.innerHTML=[...c.log].reverse().map(l=>`
    <div style="padding:6px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:10px;color:var(--text3);margin-bottom:2px;">${l.t}</div>
      <div style="font-size:12px;color:var(--text);">${l.msg}</div>
    </div>`).join('');
}
function addClaimLog(){
  const msg=document.getElementById('claimLogInput').value.trim();
  if(!msg)return;
  const c=claims.find(x=>String(x.id)===String(_claimLogId));if(!c)return;
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg});
  c.lastChase=todayISO();
  // Contacting the supplier IS chasing — the status advances itself so it can
  // never drift out of sync with what's actually been done.
  if(c.cst==='Needs Attention'||c.cst==='Open'){
    c.cst='Chasing';
    c.log.push({t:getNowUK(),msg:'Status changed to: Chasing (auto — supplier contacted)'});
  }
  saveClaim(c);
  document.getElementById('claimLogInput').value='';
  renderClaimLog(c);
  renderClaims();updateCB();
  logAudit('Claim log entry',`${c.sup}: ${msg}`);
  toast('Entry logged — status: '+c.cst);
}
