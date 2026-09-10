/* BDL PrepHub — js/stock-moves.js — status change, shipment segments, counting in, undoing a send, confirm/shipment-id modals, all arrived/shipped, send-to-Amazon file.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── STATUS CHANGE HANDLER ─────────────────────────────────────────────────────
let _issuesFilterActive=false;
// When true, the prep sheet also shows archived rows (otherwise they're hidden
// from the active sheet but still kept on the shipments page + in stats).
let _showArchived=false;
let _lateFilterActive=false;
let _ssFilterActive=false;   /* Jack, 8 Sep: show only Subscribe & Save rows */
function toggleArchivedView(){
  _showArchived=!_showArchived;
  updateArchivedBtn();
  renderPrep();
  const n=rows.filter(r=>r.archived).length;
  toast(_showArchived?(_historyReady?`Showing ${n} archived row${n!==1?'s':''} (sent to Amazon)`
                                    :'Showing archived \u2014 history still loading\u2026')
                     :'Back to active prep sheet');
}
// Keep the Show/Hide Archived button label + count in sync.
function updateArchivedBtn(){
  const btn=document.getElementById('showArchivedBtn');
  if(!btn)return;
  const n=rows.filter(r=>r.archived).length; // only shipped rows get archived now
  btn.style.background=_showArchived?'rgba(96,165,250,.35)':'var(--bg2)';
  btn.style.color=_showArchived?'#fff':'var(--text3)';
  btn.textContent=_showArchived?'← Active Sheet':'Show Archived';
}
function toggleIssuesFilter(){
  _issuesFilterActive=!_issuesFilterActive;
  const btn=document.getElementById('showIssuesBtn');
  if(btn){
    btn.style.background=_issuesFilterActive?'rgba(248,113,113,.35)':'rgba(248,113,113,.15)';
    btn.style.borderColor=_issuesFilterActive?'#f87171':'rgba(248,113,113,.4)';
    btn.textContent=_issuesFilterActive?'⚑ Issues ✓':'⚑ Issues';
  }
  filterPrep();
}
function toggleSubSaveFilter(){
  _ssFilterActive=!_ssFilterActive;
  const btn=document.getElementById('showSSBtn');
  if(btn){
    btn.textContent=_ssFilterActive?'S&S ✓':'S&S';
    btn.style.background=_ssFilterActive?'rgba(96,165,250,.35)':'rgba(96,165,250,.13)';
    btn.style.borderColor=_ssFilterActive?'#60a5fa':'rgba(96,165,250,.4)';
  }
  renderPrep();
}
function toggleLateFilter(){
  _lateFilterActive=!_lateFilterActive;
  if(_lateFilterActive&&_issuesFilterActive){
    _issuesFilterActive=false;
    const ib=document.getElementById('showIssuesBtn');
    if(ib){ib.textContent='⚑ Issues';ib.style.background='rgba(248,113,113,.15)';ib.style.borderColor='rgba(248,113,113,.4)';}
  }
  const btn=document.getElementById('showLateBtn');
  if(btn){
    btn.textContent=_lateFilterActive?'⏱ Late ✓':'⏱ Late';
    btn.style.background=_lateFilterActive?'rgba(251,146,60,.35)':'rgba(251,146,60,.15)';
    btn.style.borderColor=_lateFilterActive?'#fb923c':'rgba(251,146,60,.4)';
  }
  renderPrep();
}

// Units actually sendable to Amazon = what we have (received, or expected if
// not yet counted) minus any units flagged as an issue (damaged/missing/
// incorrect). e.g. expected 30, 4 damaged → 26 sendable. Floored at 0.
/* What can actually go into a shipment.
   The old sum double-counted a shortfall. `issueQty` is set to exp − rcvd, i.e.
   the units that did NOT turn up — and the base is already `rcvd`, which counts
   only the ones that DID. Subtracting the shortfall from the arrived count
   removes real stock: 2 ordered, 1 arrived, 1 raised missing gave 1 − 1 = 0,
   and Part Send refused with "all available units are already in a shipment"
   while a GoPro sat on the shelf.
   Which issue it is decides whether it comes off:
     Missing   — never arrived, so `rcvd` has already excluded it. Do not subtract.
     Damaged   — arrived and counted in, but cannot be sent. Subtract.
     Incorrect — arrived and counted in, but is the wrong thing. Subtract.
   When nothing has been counted in yet the row still ships against what was
   expected, so the shortfall does come off there. */
function sendableQty(r){
  const got=parseInt(r.rcvd)||0;
  const exp=parseInt(r.exp)||0;
  const issues=Math.max(0,parseInt(r.issueQty)||0);
  if(got>0){
    const heldBack=/damag|incorrect|wrong/i.test(String(r.issueType||''))?issues:0;
    return Math.max(0,got-heldBack);
  }
  return Math.max(0,exp-issues);
}

// ── SHIPMENT SEGMENTS ─────────────────────────────────────────────────────────
// A "segment" records that N units of this row went into a specific FBA
// shipment on a specific date: {shipId, units, date, type}. This is what lets a
// single SKU row be split across multiple shipments (8u → FBA1 yesterday, 2u →
// FBA2 today) instead of collapsing everything under one shipId.
//
// normaliseSegments returns a clean array for a row. If the row has no explicit
// segments yet (old data, or a row sent before this feature existed) it
// synthesises a single segment from the legacy shipId/ship fields so nothing in
// the shipments view changes for existing rows.
function normaliseSegments(r){
  let segs=Array.isArray(r.shipSegments)?r.shipSegments.filter(s=>s&&s.shipId&&(s.units||0)>0):[];
  if(!segs.length&&r.shipId&&(r.ship||0)>0){
    segs=[{shipId:r.shipId,units:r.ship||0,date:r.sentDate||'',type:r.shipType||'Standard'}];
  }
  return segs;
}

// Total units already committed to shipments for a row.
function segmentsSentTotal(r){
  return normaliseSegments(r).reduce((a,s)=>a+(s.units||0),0);
}

// Units of this row NOT yet attached to any shipment — what's still in the
// warehouse and available to send in a fresh shipment.
function remainingToShip(r){
  return Math.max(0,sendableQty(r)-segmentsSentTotal(r));
}

// Add (or merge) a segment onto a row and keep legacy fields coherent.
// The row's primary shipId/ship/allShipIds are kept in sync so older code paths
// and the prep-sheet display continue to work, while shipSegments stays the
// authoritative breakdown for the shipments page.
// A shipment's date belongs to the shipment, not to the day you touched it.
// Adding an ASIN to (or editing) an existing FBA shipment must NOT drag that
// shipment forward to today — a 27 July shipment stays 27 July forever.
// Returns the earliest date already recorded against this shipId, or today if
// it is genuinely a brand-new shipment.

/* A shipment's date can drift — a line added weeks later used to drag the whole
   thing to today. New lines now inherit the shipment's own date, but anything
   already dragged forward needs putting back, so the date is editable and the
   correction lands on every line at once. */
function openShipDate(shipId){
  if(histGate())return;
  const cur=shipDateFor(shipId);
  const counts={oa:0,lav:0,ret:0};
  rows.forEach(r=>{if((r.allShipIds||[]).includes(shipId)||r.shipId===shipId)counts.oa++;});
  lavShipments.forEach(x=>{if(x.shipId===shipId)counts.lav++;});
  returnShipments.forEach(x=>{if(x.shipId===shipId)counts.ret++;});
  const total=counts.oa+counts.lav+counts.ret;
  let host=document.getElementById('shipDateModal');
  if(!host){host=document.createElement('div');host.id='shipDateModal';host.className='overlay';
    host.addEventListener('click',e=>{if(e.target===host)cm('shipDateModal');});
    document.body.appendChild(host);}
  host.innerHTML=`<div class="modal" style="max-width:430px">
    <div class="mh"><div class="mh-title">Shipment date</div>
      <button class="mh-close" onclick="cm('shipDateModal')">✕</button></div>
    <div style="padding:16px 18px">
      <div style="font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:800;margin-bottom:10px">${shipId}</div>
      <p style="margin:0 0 12px;font-size:12.5px;line-height:1.6;color:var(--text)">The date this shipment actually went to Amazon.
        Changing it moves <b>every line in it</b> — ${counts.oa} prep row${counts.oa===1?'':'s'}${counts.lav?`, ${counts.lav} Lavarion line${counts.lav===1?'':'s'}`:''}${counts.ret?`, ${counts.ret} return line${counts.ret===1?'':'s'}`:''} — so the whole shipment stays on one date.</p>
      <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:5px">Shipment date</label>
      <input type="date" id="shipDateFix" value="${cur}" style="width:100%;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:15px;font-weight:700">
      <p style="margin:11px 0 0;font-size:11.5px;color:var(--text3);line-height:1.55">Monthly reporting follows the date, so this puts the units back in the month they were really sent.</p>
    </div>
    <div class="mf" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--border)">
      <button onclick="cm('shipDateModal')" style="padding:7px 14px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>
      <button onclick="applyShipDate('${shipId.replace(/'/g,"\\'")}')" style="padding:7px 14px;background:var(--btn-amber-bg);border:1px solid var(--btn-amber-border);color:var(--btn-amber-text);border-radius:6px;font-size:12px;font-weight:800;cursor:pointer">Set the date</button>
    </div></div>`;
  om('shipDateModal');
  setTimeout(()=>{const el=document.getElementById('shipDateFix');if(el)el.focus();},60);
}
function applyShipDate(shipId){
  const v=(document.getElementById('shipDateFix')||{}).value||'';
  if(!v){toast('Pick a date','er');return;}
  cm('shipDateModal');
  setShipmentDate(shipId,v);
}
function setShipmentDate(shipId,iso){
  if(histGate())return;
  let touched=0;
  rows.forEach(r=>{
    let hit=false;
    (r.shipSegments||[]).forEach(sg=>{if(sg.shipId===shipId){sg.date=iso;hit=true;}});
    if(r.shipId===shipId||(r.allShipIds||[]).includes(shipId)){
      /* only move the row's own sent date when this shipment is the only one on it */
      const others=(r.shipSegments||[]).filter(sg=>sg.shipId!==shipId);
      if(!others.length){r.sentDate=iso;}
      hit=true;
    }
    if(hit){r._dirty=true;saveRow(r);touched++;}
  });
  lavShipments.forEach(x=>{if(x.shipId===shipId){x.date=iso;updateLavShipmentDate(x);touched++;}});
  returnShipments.forEach(x=>{if(x.shipId===shipId){x.date=iso;
    if(x.uuid)sb.from('returns_shipments').update({sent_date:iso}).eq('id',x.uuid)
      .then(r=>{if(r.error)console.warn('[ship date] return',r.error);});
    touched++;}});
  logAudit('Shipment date',`${shipId} → ${iso} (${touched} line${touched===1?'':'s'})`);
  renderShipments();
  toast(`${shipId} moved to ${new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`,'ok');
}
async function updateLavShipmentDate(x){
  if(!x.uuid)return;
  const r=await sb.from('lavarion_shipments').update({sent_date:x.date}).eq('id',x.uuid);
  if(r.error)console.warn('[ship date] lav',r.error);
}
/* Becki, 20 Aug: added a Lavarion ASIN to today's shipment, pressed confirm,
   and the whole shipment jumped to yesterday and vanished off the Today tab.

   This function collected EVERY date attached to a shipment id — segment dates,
   Lavarion dates, RETURN dates, and bare `sentDate` off the legacy mirrors —
   and returned the earliest of the lot. `sentDate` is the date of a row's FIRST
   send and is never updated when that row ships again, so it frequently does
   not describe this shipment at all; a return is stock coming BACK and never
   dated a shipment even before this.
   One of those older dates won the sort, the new Lavarion line was stamped with
   it, and because a shipment is dated by the earliest of its lines the entire
   shipment moved with it.

   The Shipments page read path was taught this rule in v26.9 (returns and stale
   sentDates carry units but never vote on the date); the WRITE path never was.
   Same rule both sides now: segments and Lavarion decide the date, and the
   others are only consulted when there is nothing authoritative at all — which
   is what keeps a returns-only or brand-new shipment from defaulting to today
   and losing its real date. */
/* The last three places that turned a row's own `sentDate` into a segment date
   without asking the shipment. Narrower than what bit Becki — they only fire
   when a row has no segment yet — but it is the same ingredient, so they go
   through the same rule: if the shipment already has an authoritative date, use
   THAT; only fall back to the row's own date when the shipment has none. */
function _segDateFor(r,shipId){
  const d=shipId?shipDateFor(shipId):'';
  if(d&&d!==todayISO())return d;
  return (r&&r.sentDate)||d||todayISO();
}
/* And the alarm. A segment dated before the shipment it belongs to is the
   signature of every version of this bug; say so in the console rather than
   quietly moving a shipment off Today again. */
function _assertSegDate(shipId,date,where){
  try{
    if(!shipId||!date)return;
    const auth=shipDateFor(shipId);
    if(auth&&date<auth)console.warn('[ship-date] '+(where||'')+': segment dated '+date+
      ' is earlier than shipment '+shipId+' ('+auth+') — this is the bug that moved a shipment to yesterday');
  }catch(e){}
}
function shipDateFor(shipId){
  if(!shipId)return todayISO();
  const auth=[],fallback=[];
  (rows||[]).forEach(r=>{
    (r.shipSegments||[]).forEach(sg=>{if(sg.shipId===shipId&&sg.date)auth.push(sg.date);});
    if(r.shipId===shipId&&r.sentDate)fallback.push(r.sentDate);
    if((r.allShipIds||[]).includes(shipId)&&r.sentDate)fallback.push(r.sentDate);
  });
  (lavShipments||[]).forEach(x=>{if(x.shipId===shipId&&x.date)auth.push(x.date);});
  (returnShipments||[]).forEach(x=>{if(x.shipId===shipId&&x.date)fallback.push(x.date);});
  if(auth.length)return auth.sort()[0];
  if(fallback.length)return fallback.sort()[0];
  return todayISO();
}

function addSegment(r,shipId,units,type){
  if(!shipId||!(units>0))return;
  const segs=normaliseSegments(r).slice();
  const sdate=shipDateFor(shipId);
  const existing=segs.find(s=>s.shipId===shipId&&(s.date||'')===sdate);
  if(existing){existing.units+=units;if(type)existing.type=type;}
  else{_assertSegDate(shipId,sdate,'addSegment');segs.push({shipId,units,date:sdate,type:type||r.shipType||'Standard'});}
  r.shipSegments=segs;
  // Keep legacy mirrors in sync.
  const ids=r.allShipIds||[];
  if(!ids.includes(shipId))ids.push(shipId);
  r.allShipIds=ids;
  r.shipId=shipId;                       // primary = most recent
  if(type)r.shipType=type;
  r.ship=segmentsSentTotal(r);           // legacy cumulative total
  /* THE INVARIANT — Jack, 17 Aug: "how can we received 0 but sent 2 out?"
     Stock cannot leave the building without having arrived in it. `sendableQty`
     falls back to the EXPECTED quantity when nothing has been booked in, so
     every path that ships through this function could put units on a shipment
     while received stayed 0. Attaching units to a shipment IS an assertion that
     they were here, so received is raised to match what has gone out — and the
     correction is named in the audit log rather than done quietly. */
  const _out=r.ship||0;
  if((parseInt(r.rcvd)||0)<_out){
    const _was=parseInt(r.rcvd)||0;
    r.rcvd=_out;
    try{logAudit('Received corrected to match what shipped',
      `${r.sku||r.asin||''} — was ${_was}, now ${_out} (${shipId})`);}catch(e){}
  }
}

// Open the shipment-ID modal to send units of a row to a shipment.
//  - isPartial=true  → asks for a quantity (1..remaining); row becomes Part Sent
//                      if units are still left afterwards, else Sent to Amazon.
//  - isPartial=false → sends ALL remaining units in one go (Sent to Amazon).
// Only units not already attached to a shipment are offered, so this is safe to
// call repeatedly on a Part-Sent row to send each subsequent batch to its own
// FBA shipment ID / date.
function openSendModal(r,isPartial,allowExtra){
  /* The "All shipped" button already asks this question — the send modal did
     not, so shipping via the status dropdown or "Send more" walked straight
     past it and produced rows reading 0 received / N sent. Same guard, same
     wording, so the answer is the same wherever she starts from. */
  if(!(parseInt(r.rcvd)>0)&&!r._sendOk){
    const want=parseInt(r.exp)||0;
    showConfirm('Nothing has been booked in yet',
      `This row still shows 0 of ${want} received. Sending it records the units as arrived and sent in one go. `
      +`If the stock is here that is fine — confirm and carry on. If it is not, count it in first with the arrived tick, then send.`,
      ()=>{r._sendOk=true;openSendModal(r,isPartial,allowExtra);});
    return;
  }
  delete r._sendOk;
  const remaining=remainingToShip(r);
  if(remaining<=0&&!allowExtra){toast('All available units are already in a shipment','er');return;}
  const alreadyOut=segmentsSentTotal(r);
  const forcePartial=isPartial||allowExtra;
  const maxUnits=remaining>0?remaining:9999; // allowExtra: don't clamp the typed qty
  showShipIdModal(
    forcePartial?'Partial Send — Enter Shipment ID':'Shipment ID Required',
    allowExtra
      ?`Everything expected is already shipped — this sends additional unit(s) to a shipment. Enter how many and the FBA ID for THIS shipment.`
      :isPartial
        ?`Sending partial units (${remaining} available to send${alreadyOut?`, ${alreadyOut} already shipped`:''}${r.issueQty?`, ${r.issueQty} held for issue`:''}). Enter the FBA ID for THIS shipment.`
        :`Enter the FBA Shipment ID for these ${remaining} units.${alreadyOut?` (${alreadyOut} already shipped separately)`:''}${r.issueQty?` (${r.issueQty} held for issue)`:''}`,
    r.shipType||'Standard',
    (shipId,type,partialUnits)=>{
      const sendQty=forcePartial?(allowExtra?(partialUnits||0):Math.min(partialUnits||0,maxUnits)):remaining;
      if(!(sendQty>0)){toast('Enter a quantity greater than 0','er');return;}
      // Record this shipment as its own segment — never merge into a prior one.
      addSegment(r,shipId,sendQty,type);
      r.sentDate=shipDateFor(shipId);r.sentAt=getNowUK();
      // Fully sent only when nothing is left to ship AND nothing is still owed
      // (Jack, 6 Sep: 3 expected, 2 in, 2 sent must read Part Sent, not Sent).
      if(remainingToShip(r)>0||_owedUnits(r)>0){
        r.status='Part Sent';r.sent='No';
      }else{
        r.status='Sent to Amazon';r.sent='Yes';
        if(!r.rcvd||r.rcvd===0)r.rcvd=r.exp||0;
      }
      r._dirty=true;
      saveRow(r);
      logAudit(r.status==='Part Sent'?'Part Sent':'Sent to Amazon',`${r.sku} → ${shipId} (${sendQty}u)`);
      renderPrep();
    },
    forcePartial,maxUnits
  );
}

// "↗ Send more" — send the NEXT batch of an already-Part-Sent row to a new
// shipment. Re-selecting "Part Sent" in the dropdown can't trigger this (the
// value hasn't changed, so no change event fires), so this gives a reliable,
// repeatable entry point for multi-shipment splits.
function sendMore(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  // If the maths says nothing is outstanding, still allow sending extra unit(s)
  // (e.g. you want to send 1 more on the same shipment for various reasons).
  const allowExtra=remainingToShip(r)<=0;
  openSendModal(r,true,allowExtra);
}
// Kept for the status-dropdown finalise path.
function sendMoreExtra(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  openSendModal(r,true,true);
}

// "Send more" on a row the maths says is fully shipped — lets the user push
// ADDITIONAL unit(s) to a shipment (e.g. just 1 more on the same FBA ID) for
// ad-hoc reasons. Opens the send modal in allow-extra mode so the typed qty
// isn't clamped to the (zero) remaining count.
function sendExtra(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  openSendModal(r,true,true);
}

// When a Part-Sent row has nothing left to send (every sendable unit is already
// in a shipment — e.g. after the Expected qty was corrected down), flip it to
// fully "Sent to Amazon" instead of leaving it stuck on Part Sent with "0 left".
function markFullySent(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  if(remainingToShip(r)>0){toast('There are still units left to send','er');return;}
  r.status='Sent to Amazon';r.sent='Yes';
  if(!r.sentDate)r.sentDate=todayISO();
  if(!r.sentAt)r.sentAt=getNowUK();
  if(!r.rcvd||r.rcvd===0)r.rcvd=r.exp||0;
  r._dirty=true;
  saveRow(r);
  logAudit('Sent to Amazon',`${r.sku} — marked complete (0 left)`);
  renderPrep();
}

/* ── COUNTING IN ──────────────────────────────────────────────────────────
   "In Warehouse" is a claim that somebody physically has the stock. Setting it
   with nothing booked in was one click and left Qty Received on 0 — so the row
   read as arrived while every number that matters said none of it had. The
   status now cannot get ahead of the count. */
/* ── UNDOING A SEND ───────────────────────────────────────────────────────
   The shipment record lives on the prep row and nowhere else, so this is a
   one-way door. Everything about the dialog is built to slow it down. */
let _unsendCtx=null;
function unsendOpen(id,val){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  _unsendCtx={id,val};
  document.getElementById('unsendWho').textContent=r.prod||r.sku||r.asin||'this row';
  document.getElementById('unsendSub').textContent=
    [r.sku,r.oid?('order '+r.oid):'',r.sup].filter(Boolean).join(' · ');
  /* Every shipment this row went out on, named. "Some shipment data" is not
     something anybody can make a decision about. */
  let segs=(r.shipSegments||[]).filter(s=>s&&s.shipId&&(s.units||0)>0);
  if(!segs.length&&r.shipId&&(r.ship||0)>0)segs=[{shipId:r.shipId,units:r.ship,date:r.sentDate||''}];
  const total=segs.reduce((a,s)=>a+(s.units||0),0)||(r.ship||0);
  document.getElementById('unsendList').innerHTML=segs.length
    ? segs.map(s=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;
        border-bottom:1px solid rgba(248,113,113,.18);font-size:12.5px;">
        <span style="font-family:var(--mono);font-weight:800;color:var(--text);">${esc(s.shipId)}</span>
        <span style="color:var(--text2);">${s.date?esc(String(s.date).slice(0,10)):'no date'}</span>
        <span style="font-family:var(--num);font-weight:800;color:#fca5a5;">${s.units} units</span>
      </div>`).join('')
      +`<div style="display:flex;justify-content:space-between;padding:7px 0 0;font-size:12.5px;font-weight:800;">
        <span style="color:var(--text);">${segs.length} shipment${segs.length===1?'':'s'}</span>
        <span style="font-family:var(--num);color:#fca5a5;">${total} units in total</span></div>`
    : `<div style="font-size:12.5px;color:var(--text2);">This row is marked sent but has no shipment ID recorded
         against it — so there is little to lose here, but it will still go back to unsent.</div>`;
  const also=[];
  if(r.sentDate)also.push('the sent date ('+String(r.sentDate).slice(0,10)+')');
  if(val==='In-Transit'||val==='Not Arrived')also.push('the received count ('+(r.rcvd||0)+' back to 0)');
  document.getElementById('unsendAlso').textContent=also.length?('Also cleared: '+also.join(' · ')):'';
  om('unsendModal');
}
function unsendCancel(){cm('unsendModal');_unsendCtx=null;renderPrep();}
function unsendConfirm(){
  if(!_unsendCtx)return;
  const {id,val}=_unsendCtx;
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  _unsendCtx=null;cm('unsendModal');
  if(!r)return;
  const gone=(r.shipSegments||[]).map(s=>s.shipId).filter(Boolean).join(', ')||r.shipId||'none';
  const units=r.ship||0;
  r._dirty=true;
  r.status=val;r.sent='No';r.sentDate='';r.ship=0;r.shipId='';r.allShipIds=[];r.shipSegments=[];
  // Reverting to a "not here / not counted" state clears the received count
  // too, so the row is fully back to its pre-arrival state.
  if(val==='In-Transit'||val==='Not Arrived'){r.rcvd=0;}
  debounce('save_'+(r.uuid||r.id),()=>{saveRow(r);},300);
  /* Named in the audit log, because this is the one action with no undo — if it
     turns out to have been wrong, this line is the only way back to the facts. */
  logAudit(`Shipment record erased — status reverted to ${val}`,
    `${r.sku||r.asin||''} · ${units} units · was on ${gone}`);
  renderPrep();
  toast(`Shipment record erased — ${units} unit${units===1?'':'s'} back to unsent`,'er');
}
let _ciCtx=null;
function countInOpen(id,sel,val){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  _ciCtx={id,val,prev:r.status,sel};
  sel.value=r.status;                                   // don't move until it is counted
  document.getElementById('countInWho').textContent=r.prod||r.sku||r.asin||'this row';
  document.getElementById('countInSub').textContent=
    [r.sku,r.oid?('order '+r.oid):'',r.sup].filter(Boolean).join(' · ');
  const exp=parseInt(r.exp)||0;
  const q=document.getElementById('countInQty');
  q.value=exp||'';q.max='';
  const all=document.getElementById('countInAll');
  all.textContent=exp?('All '+exp):'—';
  all.style.display=exp?'':'none';
  om('countInModal');
  countInPreview();
  setTimeout(()=>{q.focus();q.select();},80);
}
function countInSet(){
  if(!_ciCtx)return;
  const r=rows.find(x=>x.uuid===String(_ciCtx.id)||String(x.id)===String(_ciCtx.id));
  const q=document.getElementById('countInQty');
  if(r&&q){q.value=parseInt(r.exp)||0;countInPreview();q.focus();q.select();}
}
function countInPreview(){
  if(!_ciCtx)return;
  const r=rows.find(x=>x.uuid===String(_ciCtx.id)||String(x.id)===String(_ciCtx.id));
  const box=document.getElementById('countInSay'),go=document.getElementById('countInGo');
  if(!r||!box)return;
  const exp=parseInt(r.exp)||0;
  const raw=(document.getElementById('countInQty')||{}).value;
  const n=parseInt(raw);
  const bad=!(n>=0)||raw==='';
  if(go){go.disabled=bad;go.style.opacity=bad?'.45':'1';}
  if(bad){box.innerHTML='<span style="color:var(--text2)">Type how many came out of the box.</span>';return;}
  if(n===0){box.innerHTML='<span style="color:#f87171;font-weight:700">Nothing arrived — so it is not in the warehouse.</span>'
    +'<div style="color:var(--text2);margin-top:3px">Leave the status where it is and raise an issue instead.</div>';
    if(go){go.disabled=true;go.style.opacity='.45';}return;}
  if(n<exp)box.innerHTML=`<span style="color:#fbbf24;font-weight:700">${n} of ${exp} counted in · ${exp-n} still outstanding.</span>`
    +'<div style="color:var(--text2);margin-top:3px">The shortfall stays on the row so it can be chased.</div>';
  else if(n>exp)box.innerHTML=`<span style="color:#60a5fa;font-weight:700">${n} counted in — ${n-exp} more than expected.</span>`
    +'<div style="color:var(--text2);margin-top:3px">Worth checking the invoice before it goes out.</div>';
  else box.innerHTML=`<span style="color:#4ade80;font-weight:700">All ${exp} counted in.</span>`;
}
function countInCancel(){cm('countInModal');_ciCtx=null;}
async function countInSave(){
  if(!_ciCtx)return;
  const {id,val}=_ciCtx;
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  const n=parseInt((document.getElementById('countInQty')||{}).value);
  if(!r||!(n>0)){toast('Enter how many were counted in','er');return;}
  _ciCtx=null;
  cm('countInModal');
  r.rcvd=n;r.delivered='Yes';r.status=val;r._dirty=true;
  logAudit('Counted in',`${r.sku||r.asin||''} — ${n} of ${r.exp||0} · status ${val}`);
  try{await saveRow(r);}catch(e){toast('Didn\'t save — check the connection','er');}
  renderPrep();renderStats();
  toast(`${n} counted in${n<(parseInt(r.exp)||0)?` · ${(parseInt(r.exp)||0)-n} still outstanding`:''}`,n<(parseInt(r.exp)||0)?'er':'ok');
}
function handleStatusChange(id,sel){
  const val=sel.value;
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  const prevStatus=r.status;
  /* Nothing is in the warehouse until somebody has counted it. */
  if((val==='In Warehouse'||val==='Delivered')&&!(parseInt(r.rcvd)>0)){
    countInOpen(id,sel,val);
    return;
  }
  // Only unarchive if the row hasn't been sent — sent rows stay archived permanently
  if(r.archived&&r.sent!=='Yes'&&r.status!=='Sent to Amazon'){r.archived=false;}
  else if(r.archived&&(r.sent==='Yes'||r.status==='Sent to Amazon')){
    // Don't allow status changes on sent+archived rows
    sel.value=r.status;
    toast('This row has been sent and archived — it cannot be edited','er');
    return;
  }
  // Use the row's actual local id for DOM element / debounce keys (the <tr>
  // element id is row-<localId>), while the row itself was resolved via the
  // unique uuid passed in — this prevents local-id collisions from saving the
  // wrong row.
  const domKey=r.id;
  const saveKey='save_'+(r.uuid||r.id);
  if(val==='Sent to Amazon'&&remainingToShip(r)<=0&&segmentsSentTotal(r)>0){
    // All sendable units are already in shipments (e.g. after the expected qty was
    // corrected to even out). Selecting "Sent to Amazon" should just finalise the
    // row — opening the send modal here would have nothing to send and would bounce
    // the dropdown back to the previous status (the bug being fixed).
    sel.value=r.status;
    markFullySent(r.uuid||r.id);
    return;
  }
  if(val==='Sent to Amazon'||val==='Part Sent'){
    sel.value=r.status;
    // Open the shared send modal. 'Part Sent' = partial (asks for a quantity),
    // 'Sent to Amazon' = send all remaining. Same code path is reused by the
    // "↗ Send more" button on already-Part-Sent rows (see sendMore / openSendModal).
    openSendModal(r,val==='Part Sent');
  }else if((r.status==='Sent to Amazon'||r.status==='Part Sent')&&val!=='Sent to Amazon'&&val!=='Part Sent'){
    /* This wipes sentDate, ship, shipId, allShipIds and shipSegments — and the
       prep row is the ONLY place that history lives. It used to happen on one
       click of a dropdown with nothing said. Ask, and name what is going. */
    sel.value=r.status;
    unsendOpen(r.uuid||r.id,val);
    return;
  }else{
    r._dirty=true;
    r.status=val;
    if(val==='In Warehouse'&&(!r.rcvd||r.rcvd===0))r.rcvd=r.exp||0;
    // Reverse an accidental "In Warehouse"/All-Arrived: if we're leaving
    // In Warehouse for a status that means "not counted in yet" and the
    // received qty was auto-filled to expected, clear it back to 0.
    if(prevStatus==='In Warehouse'&&(val==='Delivered'||val==='In-Transit'||val==='Not Arrived')&&r.rcvd===r.exp&&r.exp>0){
      /* The unsend gate above is keyed on STATUS, so a row that has shipped but
         is parked on "In Warehouse" slips past it and lands here — where the
         received count was zeroed with the shipment left attached. Send it
         through the proper one-way-door dialog instead. */
      if(_sentOut(r)>0){sel.value=r.status;unsendOpen(r.uuid||r.id,val);return;}
      r.rcvd=0;
      debounce(saveKey,()=>{saveRow(r);},300);
      logAudit('Status',val+' (received reset)');
      renderPrep();
      return;
    }
    debounce(saveKey,()=>{saveRow(r);},300);
    logAudit('Status',val);
    // Update row class in-place without full re-render
    const tr=document.getElementById('row-'+domKey);
    if(tr){
      const hasIssue=claims.some(cl=>(cl.prepRowId===(r.uuid||String(r.id))||cl.prepRowId===r.id)&&cl.cst!=='Resolved');
      const newClass=hasIssue?'st-issue':
        val==='Sent to Amazon'?'row-sent':
        val==='Part Sent'?'st-partsent':
        val==='In Warehouse'?'st-warehouse':
        val==='Delivered'?'st-delivered':
        val==='Issue'?'st-issue':'';
      tr.className='';
      if(newClass)tr.classList.add(newClass);
      // Update the select to show new value
      sel.value=val;
    } else {
      renderPrep();
    }
  }
}

// Flush all pending debounced saves before re-rendering
function flushPending(){
  Object.keys(_debTimers).forEach(key=>{
    if(_debTimers[key]){
      clearTimeout(_debTimers[key]);
      delete _debTimers[key];
    }
  });
  // Force save any dirty rows
  rows.forEach(r=>{if(r._dirty){r._dirty=true;saveRow(r);}});
}

/* The rows actually on screen. This used to re-run its own filter — status and
   search only — missing the archived split, the Issues filter and the Late
   filter that the renderer applies. It reported 743 where the sheet showed 33.
   There is one list now and the renderer owns it. */
function getFilteredRows(){
  if(_prepShown&&_prepShown.length)return _prepShown.slice();
  // nothing drawn yet (first paint) — fall back, still excluding archived
  const q=(document.getElementById('prepSrch')||{}).value?.toLowerCase()||'';
  const st=(document.getElementById('prepStF')||{}).value||'';
  return rows.filter(r=>{
    if(_showArchived?!r.archived:r.archived)return false;
    if(st&&r.status!==st)return false;
    if(q&&!(r.sku+r.asin+r.prod+r.sup+r.oid).toLowerCase().includes(q))return false;
    return true;
  });
}
const _debTimers={};
function debounce(key,fn,delay=400){
  clearTimeout(_debTimers[key]);
  _debTimers[key]=setTimeout(fn,delay);
}

// ── CONFIRM MODAL ─────────────────────────────────────────────────────────────
let _confirmCb=null;
/* The box wears a bin because most callers are deletions. One that is not —
   a preview, or a tidy-up that moves text rather than removing it — says so:
   a bin on a read-only list reads as "this is about to delete something". */
function showConfirm(title,text,cb,opts){
  opts=opts||{};
  const _i=document.getElementById('confirmIco');if(_i)_i.textContent=opts.icon||'🗑️';
  const _ok=document.getElementById('confirmOkBtn');
  if(_ok){_ok.textContent=opts.ok||'Confirm';_ok.style.display=opts.hideOk?'none':'';}
  const _cx=document.querySelector('#confirmModal .btn-cancel');
  if(_cx)_cx.textContent=opts.cancel||'Cancel';
  document.getElementById('confirmTitle').textContent=title;
  /* Jack, 7 Sep: the box showed "<b>60 × Tea &amp; Biscuits Hamper</b><br>" as
     letters. Our own emphasis and line breaks render; anything else is text. */
  const _ct=document.getElementById('confirmText'),_t=String(text||'');
  if(/<(b|br|i|u)\b[^>]*>/.test(_t))_ct.innerHTML=_t.replace(/\n/g,'<br>');else _ct.textContent=_t;
  _confirmCb=cb;
  om('confirmModal');
}
function confirmOk(){
  cm('confirmModal');
  if(_confirmCb)_confirmCb();
  _confirmCb=null;
}
let _selectedIds=(()=>{try{return new Set(JSON.parse(sessionStorage.getItem('bulkSel')||'[]'));}catch(e){return new Set();}})(); // survives re-renders AND a hard refresh (same tab)

function getSelectedRows(){
  return Array.from(_selectedIds);
}
function updateBulkUI(){
  try{sessionStorage.setItem('bulkSel',JSON.stringify([..._selectedIds]));}catch(e){}
  const selected=_selectedIds.size;
  const bulkEl=document.getElementById('bulkActions');
  const countEl=document.getElementById('bulkCount');
  if(selected>0){
    bulkEl.style.display='flex';
    if(countEl)countEl.textContent=selected+' selected';
  }else{bulkEl.style.display='none';}
}
function toggleSelectAll(checked){
  if(checked){
    getFilteredRows().forEach(r=>_selectedIds.add(r.uuid||r.id));
  }else{
    _selectedIds.clear();
  }
  // Update visible checkboxes
  document.querySelectorAll('.bulk-check').forEach(c=>{
    const rk=c.getAttribute('data-rk');
    c.checked=_selectedIds.has(rk);
  });
  updateBulkUI();
}
function doBulkAction(){
  const action=document.getElementById('bulkActionDropdown').value;
  if(!action)return;
  // Block Sent to Amazon via bulk dropdown — must use Stamp ID button instead
  if(action==='Sent to Amazon'){
    toast('Use "Stamp ID" to send to Amazon — Shipment ID is required','er');
    document.getElementById('bulkActionDropdown').value='';
    return;
  }
  const selected=getSelectedRows();
  selected.forEach(id=>{
    const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
    if(r){
      r.status=action;
      if(action==='In Warehouse'){
        if(!r.rcvd||r.rcvd===0)r.rcvd=r.exp||0;
      }
      // Reverting to In Warehouse from Sent to Amazon — clear shipment data
      if(action==='In Warehouse'&&r.sent==='Yes'){
        r.sent='No';r.sentDate='';r.ship=0;r.shipId='';
      }
      r._dirty=true;saveRow(r);logAudit('Bulk Status Update',r.sku);
    }
  });
  clearBulkSelect();renderPrep();
  toast(`${selected.length} row${selected.length!==1?'s':''} updated`);
}
function clearBulkSelect(){
  _selectedIds.clear();
  document.querySelectorAll('.bulk-check').forEach(c=>c.checked=false);
  document.getElementById('selectAll').checked=false;
  updateBulkUI();
  document.getElementById('bulkActionDropdown').value='';
  const sid=document.getElementById('bulkShipId');if(sid)sid.value='';
}

// ── SHIPMENT ID MODAL ─────────────────────────────────────────────────────────
let _shipIdCallback=null;
let _pendingPrepRender=false;
function showShipIdModal(title,desc,defaultType,callback,isPartial,maxUnits){
  document.getElementById('shipIdModalTitle').textContent=title;
  document.getElementById('shipIdModalDesc').textContent=desc;
  const inp=document.getElementById('shipIdModalInput');
  inp.value='';
  inp.style.borderColor='';                       // clear any prior red error border
  inp.placeholder='e.g. FBA15LPFRNPN';
  inp.oninput=function(){this.value=this.value.toUpperCase();}; // restore uppercasing
  const typeFi=document.getElementById('shipIdModalType').closest('.fi');
  if(typeFi)typeFi.style.display='';              // restore type field (editClaimNote hides it)
  document.getElementById('shipIdModalType').value=defaultType||'Standard';
  // Show/hide partial units field
  const partialRow=document.getElementById('shipIdPartialRow');
  const partialInp=document.getElementById('shipIdPartialUnits');
  if(partialRow){
    partialRow.style.display=isPartial?'flex':'none';
    if(partialInp){partialInp.value='';partialInp.max=maxUnits||999;partialInp.placeholder=`1–${maxUnits||'?'} units`;}
  }
  _shipIdCallback=callback;
  om('shipIdModal');
  setTimeout(()=>{const el=document.getElementById('shipIdModalInput');if(el)el.focus();},120);
}
function confirmShipIdModal(){
  const id=document.getElementById('shipIdModalInput').value.trim().toUpperCase();
  const type=document.getElementById('shipIdModalType').value;
  if(!id){document.getElementById('shipIdModalInput').style.borderColor='var(--red)';return;}
  // Detect partial mode from the partial row's actual visibility (robust —
  // the old .closest('[style*="flex"]') check could miss/throw, which made the
  // confirm silently no-op on the first click and only work on a retry).
  const partialRow=document.getElementById('shipIdPartialRow');
  const partialInp=document.getElementById('shipIdPartialUnits');
  const isPartialMode=partialRow&&partialRow.style.display!=='none';
  const partialUnits=(isPartialMode&&partialInp)?(parseInt(partialInp.value)||null):null;
  // Capture the callback locally BEFORE clearing/closing so nothing can race
  // it to null between close and invocation.
  const cb=_shipIdCallback;
  _shipIdCallback=null;
  cm('shipIdModal');
  if(cb)cb(id,type,partialUnits);
}
// Allow Enter key inside modal input to confirm — deferred so DOM is ready
// ── ROW TOOLTIP ──────────────────────────────────────────────────────────────
/* Amazon titles are a brand and model followed by a paragraph of specs.
   "DJI Mini 4K, Drone with Camera 4K Professional, Under 249 g, 3-Axis Gimbal…"
   — everything from the third comma on is noise. Cut at a real boundary rather
   than at character 27, so the name always ends on a whole word. */
function shortTitle(t){
  t=(t||'').trim();
  if(t.length<=74)return esc(t);
  const cut=t.slice(0,88);
  let i=Math.max(cut.lastIndexOf(', '),cut.lastIndexOf(' – '),cut.lastIndexOf(' - '),cut.lastIndexOf(' ('));
  if(i<22)i=cut.lastIndexOf(' ');
  if(i<22)i=42;
  return esc(t.slice(0,i).replace(/[,\-–(\s]+$/,''))+'<span class="s-more">…</span>';
}
function showRowTip(e,el){
  const tip=el.getAttribute('data-tip');
  if(!tip)return;
  let div=document.getElementById('_rowTip');
  if(!div){div=document.createElement('div');div.id='_rowTip';
    /* A 90-character product name on ONE line ran off the side of the screen
       and had to be read like a ticker. It wraps into a block now. */
    div.style.cssText='position:fixed;z-index:9999;background:#1e293b;border:1px solid rgba(96,165,250,.4);color:#e2e8f0;font-size:11.5px;line-height:1.45;padding:7px 11px;border-radius:6px;pointer-events:none;white-space:normal;max-width:330px;box-shadow:0 4px 12px rgba(0,0,0,.4);';
    document.body.appendChild(div);}
  div.textContent=tip;
  div.style.display='block';
  /* measure AFTER the text is in, or a wrapped tip is placed off the bottom */
  const w=div.offsetWidth,h=div.offsetHeight;
  const x=Math.min(e.clientX+14,window.innerWidth-w-8);
  const y=(e.clientY-h-10)<4?(e.clientY+18):(e.clientY-h-10);
  div.style.left=Math.max(8,x)+'px';
  div.style.top=Math.min(y,window.innerHeight-h-8)+'px';
}
function hideRowTip(){
  const div=document.getElementById('_rowTip');
  if(div)div.style.display='none';
}
document.addEventListener('DOMContentLoaded',()=>{
  const inp=document.getElementById('shipIdModalInput');
  if(inp){
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();confirmShipIdModal();}
      if(e.key==='Escape'){cm('shipIdModal');_shipIdCallback=null;}
    });
  }
});

// ── PER-ROW: ALL ARRIVED ──────────────────────────────────────────────────────
function doAllArrived(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));if(!r)return;
  // Toggle: if already all arrived, undo it
  /* Both halves of this toggle used to ignore shipments entirely: one click
     relabelled a row that was out the door as "In Warehouse", and a second
     click zeroed its received count while the FBA segments stayed attached.
     Two clicks of one button produced the impossible row. */
  if(_sentOut(r)>0){
    const ids=(r.allShipIds&&r.allShipIds.length?r.allShipIds:[r.shipId]).filter(Boolean).join(', ');
    toast(`${_sentOut(r)} unit${_sentOut(r)===1?'':'s'} are already on ${ids||'a shipment'} — undo the send first (↺), then change what arrived`,'er');
    return;
  }
  if(r.rcvd===r.exp&&r.status==='In Warehouse'){
    showConfirm('Undo All Arrived?','Resets Qty Received to 0 and Status back to In-Transit.',()=>{
      r.rcvd=0;r.status='In-Transit';
      r._dirty=true;saveRow(r);logAudit('Undo All Arrived',r.sku);renderPrep();toast('All Arrived undone — '+r.sku.split('_')[0]);
    });
  }else{
    showConfirm(
      'Mark All Arrived?',
      `Sets Qty Received to ${r.exp} and Status to In Warehouse. Click again to undo.`,
      ()=>{
        r.rcvd=r.exp||0;r.status='In Warehouse';r.issueType='';r.issueQty=0;
        r._dirty=true;saveRow(r);logAudit('All Arrived',r.sku);renderPrep();toast('All arrived ✈ — '+r.sku.split('_')[0]);
      }
    );
  }
}

// ── PER-ROW: ALL SHIPPED ──────────────────────────────────────────────────────
function doAllShipped(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));if(!r)return;
  /* Nothing booked in? Ask. This used to quietly set received = expected, which
     is how stock got shipped that the app had no record of receiving. */
  if(!r.rcvd||r.rcvd===0){
    const want=r.exp||0;
    /* This reached for LV3.confirmBox, which is not on LV3's API — so it threw
       every single time and fell through to the browser's own confirm() box.
       The guard worked; the dialog nobody wanted was the one they always got.
       showConfirm is this page's dialog and is right here. */
    showConfirm('Nothing has been booked in yet',
      `This row still shows 0 of ${want} received. Shipping it records all ${want} as arrived and sent in one go. `
      +`If the stock is here that is fine — confirm and carry on. If it is not, count it in first with the arrived tick, then ship.`,
      ()=>{r.rcvd=want;r._dirty=true;doAllShipped(id);});
    return;
  }
  const remaining=remainingToShip(r);
  const alreadyOut=segmentsSentTotal(r);
  // Nothing left to ship — already fully accounted for across its shipments.
  if(remaining<=0&&alreadyOut>0){
    if(r.status!=='Sent to Amazon'){r.status='Sent to Amazon';r.sent='Yes';r._dirty=true;saveRow(r);renderPrep();}
    toast('Already fully shipped — '+r.sku.split('_')[0]);
    return;
  }
  const finalise=(shipId,type)=>{
    addSegment(r,shipId,remaining>0?remaining:sendableQty(r),type);
    r.status='Sent to Amazon';r.sent='Yes';r.sentDate=shipDateFor(shipId);r.sentAt=getNowUK();
    r._dirty=true;saveRow(r);
    logAudit('All Shipped',`${r.sku} → ${shipId} (${remaining>0?remaining:sendableQty(r)}u)`);
    renderPrep();toast('All shipped ✓ — '+r.sku.split('_')[0]);
  };
  // PART-SENT ROW: the remaining units are going out in a SEPARATE shipment, so
  // we must ask for a NEW Shipment ID rather than silently reusing the original
  // one (which would wrongly merge yesterday's units into today's shipment).
  if(alreadyOut>0&&remaining>0){
    const prior=normaliseSegments(r).map(s=>`${s.shipId} (${s.units}u)`).join(', ');
    showShipIdModal(
      'Ship Remaining Units — New Shipment ID',
      `${alreadyOut} unit${alreadyOut!==1?'s':''} already shipped under: ${prior}. Enter a NEW FBA ID for the remaining ${remaining} unit${remaining!==1?'s':''}.`,
      r.shipType||'Standard',
      (shipId,type)=>{
        if(normaliseSegments(r).some(s=>s.shipId===shipId)){
          // Same ID re-used: warn but allow — merges into that shipment's segment.
          showConfirm('Reuse the same Shipment ID?',
            `${shipId} already holds units from this SKU. Sending the remaining ${remaining} unit${remaining!==1?'s':''} to it will combine them under one shipment. Use a different ID to keep them separate.`,
            ()=>finalise(shipId,type));
          return;
        }
        finalise(shipId,type);
      }
    );
    return;
  }
  // FRESH ROW (no shipment yet): send everything under one new ID.
  showShipIdModal('All Shipped — Enter Shipment ID','No Shipment ID on this row yet. Enter the FBA ID to confirm.',r.shipType||'Standard',(shipId,type)=>{
    finalise(shipId,type);
  });
}

// ── BULK: ALL ARRIVED ─────────────────────────────────────────────────────────
function doBulkAllArrived(){
  const selected=getSelectedRows();
  if(!selected.length){toast('No rows selected','er');return;}
  selected.forEach(id=>{
    const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
    if(r){r.rcvd=r.exp||0;r.status='In Warehouse';r.issueType='';r.issueQty=0;r._dirty=true;saveRow(r);logAudit('Bulk All Arrived',r.sku);}
  });
  clearBulkSelect();renderPrep();
  toast(`✈ All Arrived — ${selected.length} row${selected.length!==1?'s':''} set to In Warehouse`);
}

// ── BULK: ALL SHIPPED ─────────────────────────────────────────────────────────
function doBulkAllShipped(){
  const selected=getSelectedRows();
  if(!selected.length){toast('No rows selected','er');return;}
  showShipIdModal(
    `All Shipped — ${selected.length} Row${selected.length!==1?'s':''}`,
    `Enter one Shipment ID to stamp across all ${selected.length} selected row${selected.length!==1?'s':''}.`,
    'Standard',
    (shipId,type)=>{
      selected.forEach(id=>{
        const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
        if(r){
          if(!r.rcvd||r.rcvd===0)r.rcvd=r.exp||0;
          const remain=remainingToShip(r);
          if(remain>0)addSegment(r,shipId,remain,type);
          r.status='Sent to Amazon';r.sent='Yes';r.sentDate=shipDateFor(shipId);r.sentAt=getNowUK();
          r._dirty=true;saveRow(r);logAudit('Bulk All Shipped',`${r.sku} → ${shipId} (${type})`);
        }
      });
      if(shipBoxes)shipBoxes[shipId]=shipBoxes[shipId]||0;
      clearBulkSelect();renderPrep();
      toast(`✓ ${selected.length} row${selected.length!==1?'s':''} shipped → ${shipId}`);
    }
  );
}

// ── BULK SHIPMENT ID ──────────────────────────────────────────────────────────
/* ── AMAZON SEND-TO-AMAZON FILE ────────────────────────────────────────────
   Step 3 of the bench process was: copy a SKU, switch to Seller Central, paste,
   switch back — once per product. Twenty-seven round trips for one shipment,
   and a SKU missed in the shuffle is invisible until Amazon's count disagrees.
   Amazon's own upload accepts a tab-delimited file needing only Merchant SKU
   and Quantity, so the app can hand her the whole shipment in one file.
   Proven against the live Send to Amazon on 28 Aug: 16 of 16 real SKUs loaded
   as "Ready to pack" with correct units, so PrepHub SKUs are the MSKUs. No
   pre-flight guessing about which SKUs Amazon will accept — the file is always
   well formed, and Amazon is the only thing that knows the rest.
   Built from ticked rows only — Jack: "less work for her" — because a batch of
   stock is not always sent in one go. */
function doBulkAmazonFile(){
  const selected=getSelectedRows();
  if(!selected.length){toast('Tick the rows you are sending first','er');return;}
  const picked=[],skipped=[];
  selected.forEach(id=>{
    const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
    if(!r)return;
    const sku=String(r.sku||'').trim();
    /* quantity is what she actually counted in; expected only as a fallback */
    const qty=(r.rcvd&&r.rcvd>0)?r.rcvd:(r.exp||0);
    if(!sku||qty<1){skipped.push(sku||('row '+(r.id||'')));return;}
    picked.push({sku,qty});
  });
  if(!picked.length){toast('Nothing usable — those rows have no SKU or no quantity','er');return;}
  /* one line per SKU: Amazon adds duplicates together, but a single line reads
     better on screen when she checks it */
  const merged={};
  picked.forEach(p=>{merged[p.sku]=(merged[p.sku]||0)+p.qty;});
  const lines=[
    'Please review the Example tab before you complete this template','',
    'Default prep owner\tSeller','Default labeling owner\tSeller','','',
    '\t\tOptional\t\tOptional: Use only for case-packed SKUs',
    'Merchant SKU\tQuantity\tExpiration date (MM/DD/YYYY)\tManufacturing lot code\tUnits per box\tNumber of boxes\tBox length (cm)\tBox width (cm)\tBox height (cm)\tBox weight (kg)'
  ];
  Object.keys(merged).forEach(k=>lines.push(k+'\t'+merged[k]));
  const stamp=todayISO();
  const name=`send-to-amazon-${stamp}.txt`;
  const blob=new Blob([lines.join('\n')+'\n'],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);
  const nSku=Object.keys(merged).length;
  const nUnit=Object.values(merged).reduce((x,y)=>x+y,0);
  try{logAudit('Amazon file created',`${nSku} SKUs · ${nUnit} units → ${name}`);}catch(e){}
  toast(`✓ ${name} — ${nSku} SKU${nSku===1?'':'s'}, ${fmt(nUnit)} units. Upload it in Send to Amazon → File upload.`);
  if(skipped.length)toast(`${skipped.length} row${skipped.length===1?'':'s'} left out — no SKU or no quantity`,'er');
}
function doBulkShipId(){
  const shipId=document.getElementById('bulkShipId').value.trim().toUpperCase();
  if(!shipId){toast('Enter a Shipment ID first','er');return;}
  const shipType=(document.getElementById('bulkShipType')||{}).value||'Standard';
  const selected=getSelectedRows();
  if(!selected.length){toast('No rows selected','er');return;}
  selected.forEach(id=>{
    const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
    if(r){
      if(!r.rcvd||r.rcvd===0)r.rcvd=r.exp||0;
      r.shipType=shipType;
      const remain=remainingToShip(r);
      if(remain>0)addSegment(r,shipId,remain,shipType);
      else{ // already fully allocated — just (re)stamp the primary id/type
        const ids=r.allShipIds||[];if(!ids.includes(shipId))ids.push(shipId);r.allShipIds=ids;r.shipId=shipId;
      }
      r.status='Sent to Amazon';r.sent='Yes';r.sentDate=shipDateFor(shipId);r.sentAt=getNowUK();
      r._dirty=true;saveRow(r);logAudit('Bulk Shipment ID',`${r.sku} → ${shipId} (${shipType})`);
    }
  });
  clearBulkSelect();renderPrep();
  toast(`ID stamped on ${selected.length} row${selected.length!==1?'s':''} ✓`);
}
