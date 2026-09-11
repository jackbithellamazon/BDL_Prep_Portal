/* BDL PrepHub — js/admin-queue.js — the case file, warehouse questions, claims worked in place, the sections + NOW queue Sarah and Jack work from, issue types.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
/* ── THE CASE FILE ──────────────────────────────────────────────────────────
   Jack, 16 Aug: "Sarah shouldn't just mark NEVER TURNED UP and then have
   nowhere to go. That's only the DIAGNOSIS. After that, there needs to be an
   actual progress workflow showing what Sarah has done and what we're
   currently waiting for." So every issue now runs

        DIAGNOSIS → ACTION → WAITING → OUTCOME → RESOLUTION

   one click per step, each stamped with who did it and when, so the row can
   always answer: what has happened, what is being waited on, what is next.

   It lives inside the EXISTING `resolution` jsonb under state:'working' — a
   state nothing else in the app tests for, so there is no migration and none
   of the proposed/asked/rejected/approved logic can see it. */
const CASE_PATHS={
  'never-arrived':{
    label:'Never arrived',
    steps:{
      /* Amazon orders start here and nowhere else — she cannot see the account,
         so the first move is always his, not a check she is not allowed to do. */
      'to-jack':{
        now:'Amazon order — Jack has to check this one',
        why:'Sarah has no access to the Amazon accounts, so there is nothing for her to look up. It goes straight to Jack and comes back with his answer.',
        amazonOnly:true,
        acts:[
          {k:'_jack',t:'Send to Jack',tone:'go',log:'Sent to Jack — Amazon account check'},
          /* Jack, 30 Aug: "sometimes VA will message me rather than sending to
             Jack — they know the answer anyway as I've already told them, so
             let them put the date in, or send to Jack — either or." */
          {k:'due-date',t:'Jack already told me — set the date',tone:'plain',log:'Date from Jack directly — recording it',due:7},
          /* Jack, 3 Sep: "I already told her — this hasn't arrived and needs a
             refund sorting, no date for it coming at all, it's missing." The
             only "already told me" route was a DATE, so a row he had already
             ruled dead had nowhere to go but back to him. This is the other
             half of that answer. */
          {k:'amazon-lost',t:'Jack already told me — it never arrived',tone:'plain',log:'Jack had already confirmed it never arrived — refund route'}]},
      /* Where an Amazon row lands once he has answered. She cannot open a case
         on his account either, so her last job is to close it as a refund
         claim — which the existing rules route back to him to action. */
      /* Jack, 9 Sep: "Amazon cancelled and refunded — should tell Sarah to
         close it as it's been refunded." On an Amazon order the money comes
         back by itself and lands on his side; a lost parcel he claims himself
         from his own page and it never comes here. So the only job left for
         her is the sheet and the close. One button. */
      'amazon-lost':{
        now:'Jack has checked — Amazon cancelled or refunded it',
        why:'On an Amazon order the refund comes back by itself and lands on Jack’s side — nothing for you to chase. Write the cancelled units on the Purchase Sheet and close it.',
        acts:[
          {k:'_close',t:'Note the sheet and close it',tone:'good',log:'Jack confirmed nothing is coming — Amazon cancelled or refunded it',close:'cancelled'},
          {k:'_jack',t:'Ask Jack something else',tone:'plain',log:'Back to Jack'}]},
      'check-refund':{
        now:'Is it still on its way? Then check for a refund',
        why:'Jack, 30 Aug: "if it\'s not arrived it might still be arriving — don\'t jump too quickly to refund." A promised date parks the row; only a dead order goes down the refund road.',
        acts:[
          {k:'due-date',t:'It is still coming — set the date',tone:'go',log:'Still on its way — recording the delivery date',due:7},
          {k:'_close',t:'Already refunded',tone:'good',log:'Checked — it had already been refunded automatically',close:'refund-done'},
          {k:'contact',t:'Not refunded',tone:'plain',log:'Checked — no refund had been issued'}]},
      /* Parked on a promised date — nobody's job until the date slips. The date
         input writes the row's real expectedDelivery (caseDate), so the Prep
         Sheet shows it and the overdue machinery brings it back by itself. */
      'due-date':{
        now:'Expected — nothing to do until the date',
        why:'The account or the supplier has given a delivery date. It sits on the Prep Sheet row, this stops counting as late, and it comes straight back here the moment the date passes.',
        date:{label:'Expected date',days:7,log:'Delivery date recorded'},
        acts:[
          {k:'_close',t:'It has arrived',tone:'good',log:'Arrived as promised',close:'arrived-ok'},
          {k:'check-refund',t:'Date passed — still nothing',tone:'warn',log:'The promised date slipped — nothing delivered'}]},
      'contact':{
        now:'Open a case or email the supplier',
        why:'Nothing moves until they have actually been asked.',
        acts:[
          {k:'waiting',t:'I have contacted them',tone:'go',log:'Contacted the supplier',dueW:2}]},
      'waiting':{
        now:'Waiting for the supplier to come back',
        why:'Chase every 2 working days until they answer — a quiet thread never pays out. It goes red here the moment a chase is overdue.',
        acts:[
          /* Jack, 16 Aug: "If the supplier says they're going to send the
             refund, that's SORTED from Sarah's action point of view. She
             doesn't need to keep actively chasing it." So a promise closes her
             job — and the money then lives on Jack's Money-owed list, which is
             what stops a promise quietly never landing. */
          {k:'_close',t:'They are refunding it',tone:'good',log:'Supplier confirmed a refund is coming',close:'refund-done'},
          {k:'replacement',t:'They are replacing it',tone:'go',log:'Supplier is sending a replacement',due:7},
          {k:'waiting',t:'No reply — chase again',tone:'warn',log:'Chased again — still no reply',dueW:2},
          /* the two ways a refusal ends: written off, or his problem */
          {k:'_close',t:'They refused — take the loss',tone:'plain',log:'Supplier refused to refund — written off, recover on the next order',close:'refused-loss'},
          {k:'_jack',t:'They refused — escalate to Jack',tone:'warn',log:'Supplier refused to refund — sent to Jack to escalate'}]},
      'replacement':{
        now:'Replacement promised — when is it due?',
        why:'A replacement normally lands inside seven days. Putting the date in tells the Prep Sheet to expect the stock, and brings this row back the moment the date passes.',
        date:{label:'Expected date',days:7,log:'Replacement set up'},
        acts:[
          {k:'_close',t:'It has arrived',tone:'good',log:'Replacement arrived',close:'arrived-ok'},
          {k:'waiting',t:'Overdue — back to the supplier',tone:'warn',log:'Replacement never turned up — back to the supplier',due:3}]}
    }}
};
/* The case IS the issue; the resolution state only says who is holding it.
   'working' = hers. 'rejected' = Jack has answered and handed it back, so it
   is hers again and the chase resumes on the spot — no re-diagnosing, no
   acknowledge step. 'asked'/'proposed' = Jack has it. 'approved' = finished. */
function _caseOf(r){
  const res=r&&r.resolution;
  if(!res||!res.chase)return null;
  if(res.state==='asked'||res.state==='proposed'||res.state==='approved')return null;
  return res.chase;
}
/* ── QUESTIONS FROM THE WAREHOUSE ─────────────────────────────────────────────
   Jack, 4 Sep (UK staff feedback): "the essence mascara order was for 9, only
   7 arrived. I can only raise an issue, but I can't check whether more is on
   the way — that has to go to Jack or Sarah." A query is that question and
   nothing more: no claim, no clock, no money at risk. It rides on the row's
   resolution until Sarah (or Jack) answers, and closes itself the moment the
   rest is booked in. The answer goes where the warehouse already looks — the
   VA Note on the row. */
function _qryOwed(r){return Math.max(0,(parseInt(r.exp)||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0));}
function _ukQuery(r){
  const res=r&&r.resolution,q=res&&res.query;
  if(!q||q.answeredAt)return null;
  if(res.state==='approved')return null;
  if(_qryOwed(r)<=0)return null;            /* the rest turned up — the stock answered it */
  return q;
}
/* working days a question has sat unanswered */
function _queryWait(q){return q&&q.at?Math.floor(_workMsSince(q.at)/864e5):0;}
function _qryWhen(t){const d=new Date(t);return isNaN(d)?'':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}
function _qryAskText(got,exp,short){
  return got?`${got} of ${exp} booked in — ${short===1?'is the other one':'are the other '+short} still on the way, or does the order say fully delivered?`
            :`Nothing booked in yet — has this order been dispatched, and when is it due?`;
}
/* Sarah's answer, appended to the VA Note so the warehouse sees it on the row */
function _qryReplyNote(r,text){
  const d=new Date(),dd=_ddUK(d);
  const line=`${_who()} ${dd}: ${text}`;
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+line;
  r.vaNoteBy=_who();r.vaNoteAt=new Date().toISOString();
}
/* the question is answered: an approved, filed record on the row — kept, never deleted */
function _qryClose(r,answer,what,logWhat){
  const who=_who(),at=new Date().toISOString();
  const res=r.resolution||{};const q=res.query||{};
  const ch=res.chase;
  if(ch)ch.log=(ch.log||[]).concat([{at,by:who,what:logWhat}]);
  r.resolution=Object.assign({},res,{state:'approved',kind:'query',what,by:who,at,approvedBy:who,approvedAt:at,filed:true,
    note:logWhat,query:Object.assign({},q,{answer,answeredAt:at,answeredBy:who})});
  r.sentToJack=null;
  r._dirty=true;
}
async function _qryFinish(r,audit,toastMsg){
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return false;}
  logAudit('Query answered',`${r.sku||r.asin||''} — ${audit}`);
  toast(toastMsg,'ok');
  try{renderAdmin();}catch(e){}try{renderPrep();}catch(e){}try{renderJack();paintJackBadge();}catch(e){}
  try{renderClaims();}catch(e){}try{renderDashboard();}catch(e){}
  return true;
}
/* "Nothing more — fully delivered": the shortfall is real, so it becomes the
   Missing issue the warehouse would otherwise have raised — one press, no
   round trip. Amazon orders: only Jack can raise the refund in the account,
   so the claim is his from the start (Sarah still sees it grey on hers). */
function queryNoneComing(rid){
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  const exp=parseInt(r.exp)||0,got=parseInt(r.rcvd)||0,short=_qryOwed(r);
  if(short<=0){toast('Nothing is owed on this row any more','er');return;}
  const cog=parseSKU(r.sku).cogs||0,amz=_amazonRow(r);
  showConfirm(`Nothing more is coming — raise Missing ${short}?`,
    `${r.prod||r.sku||''}\n\nThe order shows fully delivered but only ${got} of ${exp} were booked in. This raises a Missing issue for ${short} unit${short===1?'':'s'} (${fmtGBP2(cog*short)} at cost) against the row — the same as the warehouse pressing Raise Issue — ${amz?'and puts the refund claim on Jack\'s list, because only he can raise it in the Amazon account.':'and puts the claim on your list to chase.'}\n\nThe Prep Sheet row is updated so the warehouse can see the answer.`,
    async()=>{
      const who=_who();
      try{await _createIssueClaim(r,'Missing',short,{
        note:`Query answered by ${who} — order shows fully delivered, ${short} of ${exp} never arrived`,
        logMsg:'Raised from a warehouse query — nothing more coming',
        owner:amz?'Jack':undefined,
        sentToJack:amz?{by:who,at:new Date().toISOString(),why:'Amazon order — the refund has to go through the account'}:undefined});}
      catch(e){toast('Issue save failed: '+((e&&e.message)||e),'er');return;}
      const open=claims.filter(c=>(c.prepRowId===(r.uuid||r.id)||c.prepRowId===r.id||c.prepRowId===r.uuid)&&c.cst!=='Resolved'&&c.cst!=='Closed');
      if(!r.issueType||r.issueType==='—')r.issueType='Missing';
      r.issueQty=open.reduce((a,c)=>a+(parseInt(c.dif)||0),0)||short;
      _qryReplyNote(r,`nothing more is coming — the order shows fully delivered. ${short} raised as Missing${amz?' (refund with Jack)':''}.`);
      _qryClose(r,'none-coming','query-missing',`Answered the warehouse — nothing more coming, ${short} raised as Missing`);
      await _qryFinish(r,`nothing more coming, Missing ${short} raised`,`✓ Missing ${short} raised — ${amz?'on Jack\'s list for the refund':'on your list to chase'}`);
    });
}
/* the supplier cancelled (or already refunded) the rest: nothing is missing,
   so the row balances by recording those units as cancelled */
/* Jack, 8 Sep — asked for, then reversed the same hour, and the reversal is
   the rule: "no I want to wait for Sarah, that is how it should work — Sarah
   needs to confirm it." His answer travels back to her as a finding; SHE
   records the cancellation and closes the row. Nothing on his page closes a
   row on her behalf. Her side is already one press: her triage reads "Jack
   checked the account" and offers "Cancelled — note the sheet, close it". */
function queryBalance(rid,how){
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  const short=_qryOwed(r);if(short<=0){toast('Nothing is owed on this row any more','er');return;}
  const refunded=how==='refunded';
  showConfirm(refunded?`Already refunded for the ${short} short?`:`Supplier cancelled the other ${short}?`,
    `${r.prod||r.sku||''}\n\n${short} unit${short===1?'':'s'} recorded as cancelled so the row balances — nothing is missing and no claim is raised.${refunded?' The refund is noted on the row.':''}\n\nThe Prep Sheet row is updated so the warehouse can see the answer.`,
    async()=>{
      r.cancelledQty=(parseInt(r.cancelledQty)||0)+short;
      if(r.transitAction==='Late — Needs Chasing')r.transitAction='';
      try{_statusFollowsStock(r);}catch(e){}
      _qryReplyNote(r,refunded?`the other ${short} ${short===1?'was':'were'} refunded — nothing more is coming.`:`the supplier cancelled the other ${short} — nothing more is coming.`);
      _qryClose(r,refunded?'refunded':'cancelled',refunded?'query-refunded':'query-cancelled',
        refunded?`Answered the warehouse — the ${short} short already refunded, recorded as cancelled`:`Answered the warehouse — supplier cancelled the other ${short}`);
      await _qryFinish(r,refunded?`${short} refunded`:`${short} cancelled by supplier`,'✓ Recorded — the row balances, nothing missing');
    });
}
/* the warehouse asks — from the Prep Sheet row or the Raise Issue popup */
let _qryRid=null;
function openQuery(rid){
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  const exp=parseInt(r.exp)||0,got=parseInt(r.rcvd)||0,short=_qryOwed(r);
  if(short<=0){toast('Nothing is outstanding on this row','er');return;}
  const open=_ukQuery(r);
  _qryRid=rid;
  let el=document.getElementById('qryModal');
  if(!el){el=document.createElement('div');el.id='qryModal';el.className='overlay';el.style.zIndex='125';document.body.appendChild(el);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeQuery();});}
  const withJack=!!(r.resolution&&r.resolution.state==='asked');
  const ask=_qryAskText(got,exp,short);
  el.innerHTML=`<div class="modal" style="max-width:440px;">
    <div class="mh"><div class="mh-title">Ask the admin team</div><button class="mh-close" onclick="closeQuery()">✕</button></div>
    <div class="mb" style="padding:16px;">
      <div style="font-size:13px;font-weight:800;color:var(--text);line-height:1.35;">${esc(r.prod||r.sku||'')}</div>
      <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:3px;">${esc(r.sup||'')}${r.acct?' · '+esc(r.acct):''}${r.oid?' · '+esc(r.oid):''}</div>
      <div class="riMaths">
        <div><span>Ordered</span><b>${exp}</b></div>
        <div><span>Booked in</span><b style="color:${got?'var(--green)':'var(--text3)'};">${got}</b></div>
        <div><span>Unaccounted for</span><b style="color:#fbbf24;">${short}</b></div>
      </div>
      ${open?`<div class="riAsk open"><b>Already asked</b> — ${esc(open.by||'')} on ${_qryWhen(open.at)}. It is with ${withJack?'Jack':'Sarah'}; the answer will appear in the VA Note on the row.${open.note?`<div class="riAskSub">&ldquo;${esc(open.note)}&rdquo;</div>`:''}</div>`
      :`<div class="riAsk"><div class="riAskQ">&ldquo;${esc(ask)}&rdquo;</div>
         <input type="text" id="qryNote" class="fi-in" maxlength="160" placeholder="Anything useful (optional) — e.g. one box only, courier said 1 parcel" style="margin-top:8px;font-size:12px;">
         <div class="riAskSub">A question, not an issue — nothing goes on the Issues page. It lands on Sarah&rsquo;s Admin page and her answer comes back in the VA Note on this row. Raise Missing only once someone confirms nothing more is due.</div></div>`}
    </div>
    <div class="mf" style="justify-content:flex-end;gap:8px;">
      <button class="btn-cancel" onclick="closeQuery()">${open?'Close':'Cancel'}</button>
      ${open?'':`<button class="btn-save" onclick="raiseQuery()">Ask Sarah</button>`}
    </div></div>`;
  el.style.display='flex';
  const inp=document.getElementById('qryNote');if(inp)setTimeout(()=>inp.focus(),40);
}
function closeQuery(){const el=document.getElementById('qryModal');if(el)el.style.display='none';_qryRid=null;}
async function raiseQuery(){
  const r=_rowById(_qryRid);if(!r){toast('Row not found','er');return;}
  const exp=parseInt(r.exp)||0,got=parseInt(r.rcvd)||0,short=_qryOwed(r);
  if(short<=0){toast('Nothing is outstanding on this row','er');return;}
  if(_ukQuery(r)){toast('Already asked — it is on Sarah\'s list');closeQuery();return;}
  const who=_who(),at=new Date().toISOString();
  const note=((document.getElementById('qryNote')||{}).value||'').trim();
  const ask=_qryAskText(got,exp,short);
  const q={by:who,at,got,exp,short,ask,note};
  const res=r.resolution;
  const line={at,by:who,what:`Warehouse asked — ${got?got+' of '+exp+' booked in, is more on the way?':'nothing booked in, has it been dispatched?'}${note?' — "'+note+'"':''}`};
  if(res&&res.state!=='approved'){
    /* a live case, or with Jack: the question rides on it */
    res.query=q;if(res.chase)res.chase.log=(res.chase.log||[]).concat([line]);
  }else{
    const keep=res&&res.chase?Object.assign({},res.chase,{step:'',due:'',log:(res.chase.log||[]).concat([line])}):undefined;
    r.resolution={state:'working',kind:'query',what:'uk-query',ask,by:who,at,query:q,chase:keep};
  }
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — check the connection and try again','er');return;}
  closeQuery();
  try{cm('issueModal');}catch(e){}
  try{renderPrep();}catch(e){}try{renderAdmin();}catch(e){}try{renderDashboard();}catch(e){}
  toast('✓ Asked — it is on Sarah\'s Admin page. Her answer will show in the VA Note.','ok');
  logAudit('Query raised',`${r.sku||''} — ${got} of ${exp} in, is more coming?${note?' — '+note:''}`);
  try{fireWebhook(`${who} asked about "${r.prod||r.sku||''}": ${ask}${note?' — '+note:''}`,{event:'query_raised',sku:r.sku||'',by:who});}catch(e){}
}
/* Jack, 16 Aug: "Sarah is NOT allowed to deal with the Amazon account side
   herself. Anything that requires checking something on Amazon gets sent
   STRAIGHT TO ME." One test, used everywhere the path forks. */
/* Jack, 8 Sep: a Starbucks row whose supplier cell on the sheet read "538.73"
   was not treated as Amazon. The order number is the honest tell — the
   3-7-7 pattern is Amazon's and nobody else's. */
function _amazonRow(r){
  if(!r)return false;
  if(typeof _jackSupplier==='function'&&_jackSupplier(r.sup))return true;
  return /^\d{3}-\d{7}-\d{7}$/.test(String(r.oid||'').trim());
}
/* saveRow signals failure by RETURNING FALSE, not by throwing — so a plain
   try/catch around it is dead code and the caller sails on to a green toast
   and a log line that never reached the database. Every case action goes
   through this instead, so a failed write actually stops the step. */
async function _mustSave(r){
  const ok=await saveRow(r);
  if(ok===false)throw new Error('save-failed');
  return ok;
}
function _caseSet(r,chase){
  r.resolution=Object.assign({},r.resolution||{},{state:'working',chase});
  r._dirty=true;
}
function _caseStep(c){
  const p=CASE_PATHS[c&&c.path];
  return p?(p.steps[c.step]||null):null;
}
/* How overdue the next look is, in days. Negative = still has time. */
/* n WORKING days from now — weekends don't count as chasing time */
function _wdays(n){const d=new Date();let a=0;while(a<n){d.setDate(d.getDate()+1);const w=d.getDay();if(w!==0&&w!==6)a++;}return d.toISOString().split('T')[0];}
/* elapsed WORKING-hours ms since t0 — Sat/Sun contribute nothing */
function _workMsSince(t0){
  const a=new Date(t0),b=new Date();
  if(isNaN(a)||a>=b)return 0;
  let ms=0;const d=new Date(a);d.setHours(0,0,0,0);
  while(d<b){
    const w=d.getDay();
    if(w!==0&&w!==6){
      const s=Math.max(d.getTime(),a.getTime());
      const e=Math.min(d.getTime()+864e5,b.getTime());
      if(e>s)ms+=e-s;
    }
    d.setDate(d.getDate()+1);
  }
  return ms;
}
function _caseDue(c){
  if(!c||!c.due)return null;
  return Math.floor((Date.now()-new Date(c.due).getTime())/864e5);
}
async function caseGo(rid,actKey,stepKey){
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  markSeen(rid);
  const c=_caseOf(r);if(!c)return;
  /* two laptops: if this row moved on since the page painted, a stale click
     must not act on the OLD step's buttons */
  if(stepKey&&c.step&&stepKey!==c.step){toast('This row has moved on — refreshed it for you','er');renderAdmin();return;}
  const def=CASE_PATHS[c.path];const step=def&&def.steps[stepKey||c.step];if(!step)return;
  const act=(step.acts||[]).find(a=>a.k===actKey);if(!act)return;
  /* The hand-off writes its own line, carrying the reason he was asked — this
     one would only say the same thing twice. */
  if(act.k!=='_jack')c.log=(c.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:act.log}]);
  if(act.k==='_jack'){
    /* Straight into the existing handover — same issue, other side of it. */
    _caseSet(r,c);
    try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
    renderAdmin();
    return askJackAsk(rid);
  }
  if(act.close){
    /* An ending. The close-off popup still runs — it carries the approval
       rules, the Purchase Sheet note and the audit trail — but it opens on the
       right outcome with the whole history already written into the note, so
       it is one press to confirm rather than a form to fill in. */
    _caseSet(r,c);
    try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
    logAudit('Case step',`${r.sku||r.asin||''} — ${act.log}`);
    renderAdmin();
    /* a cancellation on a row that partly arrived is a PART cancellation */
    return openSorted(rid,(act.close==='cancelled'&&(parseInt(r.rcvd)||0)>0)?'part-cancelled':act.close);
  }
  if(act.k==='due-date'&&c.step!=='due-date'){c.prevStep=c.step;c.parkedAt=new Date().toISOString();}
  c.step=act.k;
  /* Jack, 5 Sep: Sarah works this page every Monday — a 2-working-day clock
     made every case red by Wednesday. A step gets a week before it shouts. */
  c.due=act.due?new Date(Date.now()+act.due*864e5).toISOString().split('T')[0]:(act.dueW?_wdays(Math.max(act.dueW,TM.caseWorkDays)):'');
  _caseSet(r,c);
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit('Case step',`${r.sku||r.asin||''} — ${act.log}`);
  toast(act.log,'ok');
  renderAdmin();
}
/* The replacement's expected date. It goes into the row's REAL
   expectedDelivery field — the one the Prep Sheet and every late calculation
   already read — so Jack's "Sarah's sheet and the Prep Hub record can talk to
   each other" is one field, not two that can disagree. When it passes, the
   normal overdue machinery brings the row back on its own. */
async function caseDate(rid,val){
  const r=_rowById(rid);const c=_caseOf(r);if(!c)return;
  if(!val){toast('Pick the date first, then Confirm','er');return;}
  if(!saneDate(val))return;               /* half-typed year — let them finish */
  if(val===r.expectedDelivery&&c.due===val)return;  /* no-op — no log spam */
  markSeen(rid);
  if(c.step==='due-date'&&!c.parkedAt)c.parkedAt=new Date().toISOString();
  /* same rule as setDueDate: a typed date clears OUR auto-flag — a chase
     status a person picked still holds the row on purpose */
  if(r.transitAction==='Late — Needs Chasing')r.transitAction='';
  const step=_caseStep(c);
  r.expectedDelivery=val;
  r.chaseSnoozeUntil='';
  c.due=val;
  c.log=(c.log||[]).concat([{at:new Date().toISOString(),by:_who(),
    what:((step&&step.date&&step.date.log)||'Date set')+' — expected '+
      new Date(val).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}]);
  _caseSet(r,c);
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit('Replacement expected',`${r.sku||r.asin||''} — ${val}`);
  toast('Set — the Prep Sheet is expecting it on '+new Date(val).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}),'ok');
  renderAdmin();try{renderPrep();}catch(e){}
}
/* A free-text line on the case — what the supplier actually said, what she
   checked. It is the answer to "where is all that progress being stored". */
async function caseNote(rid,txt){
  const r=_rowById(rid);const c=_caseOf(r);if(!c||!txt.trim())return;
  c.log=(c.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:txt.trim(),note:true}]);
  _caseSet(r,c);
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  renderAdmin();
}
/* ── CLAIMS, WORKED IN PLACE ────────────────────────────────────────────────
   Jack, 16 Aug: "As soon as I press OPEN it takes me to ISSUES — OLD VIEW.
   Why? That isn't even a page anymore." Claims used to bounce her out of her
   own page onto the retired Issues screen. They are worked here now, in the
   same shape as everything else: what is wrong, what has happened so far,
   what happens next. */
let _claimCaseId=null;
/* Log lines have been stamped by two different clocks over the years — ISO
   from the check-in path, dd/mm HH:MM from getNowUK. One reader, so a history
   never looks like two histories stitched together. */
function _logWhen(t){
  const s=String(t||'').trim();
  if(!s)return '—';
  const d=new Date(s.includes('T')||/^\d{4}-/.test(s)?s:s.replace(' ','T'));
  if(!isNaN(d))return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' '+
    d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  return s.slice(0,16);
}
function openClaimCase(id){
  const c=claims.find(x=>String(x.id)===String(id));
  if(!c){toast('Claim not found','er');return;}
  _claimCaseId=c.id;
  let el=document.getElementById('claimCaseModal');
  if(!el){el=document.createElement('div');el.id='claimCaseModal';el.className='overlay';
    el.style.zIndex='150';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)closeClaimCase();});}
  paintClaimCase();
  el.style.display='flex';
}
function closeClaimCase(){const el=document.getElementById('claimCaseModal');if(el)el.style.display='none';_claimCaseId=null;}
function paintClaimCase(){
  const el=document.getElementById('claimCaseModal');if(!el)return;
  const c=claims.find(x=>String(x.id)===String(_claimCaseId));if(!c)return;
  const ch=_claimChaseInfo(c);
  const log=(c.log||[]).slice().reverse();
  const raised=c.created_at||c.raised||c.raisedAt;
  el.innerHTML=`<div class="modal csMod">
    <div class="csHd">
      <div style="min-width:0;">
        <div class="csTtl">${esc(c.sup||'Claim')}</div>
        <div class="csSub">${esc(c.prod||c.sku||'')}</div>
        <div class="csSub2">${esc(c.oid||'no order id')}${raised?' · raised '+esc(noteAgo(raised)):''}</div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div class="csMoney">${fmtGBP2(c.claimValue||0)}</div>
        <div class="csMoneyCap">at stake</div>
      </div>
      <button class="srtX" onclick="closeClaimCase()">✕</button>
    </div>
    <div class="csBody">
      <div class="csRow">
        <span class="csChip bad">${esc(c.issT||'Issue')} · ${c.dif||0} unit${(c.dif||0)===1?'':'s'}</span>
        <span class="csChip ${ch.days>=5?'bad':ch.days>=3?'warn':'ok'}">${esc(ch.txt)}</span>
        <span class="csChip">${esc(c.cst||'Open')}</span>
      </div>

      <div class="csSec">
        <div class="csSecT">What has happened so far</div>
        ${log.length?`<div class="csLog">${log.map(e=>`<div class="csLogRow">
          <span class="csLogWhen">${esc(_logWhen(e.t))}</span>
          <span class="csLogWhat">${esc(e.msg||'')}</span></div>`).join('')}</div>`
        :`<div class="csEmpty">Nothing recorded yet — the first thing below writes the first line.</div>`}
      </div>

      <div class="csSec">
        <div class="csSecT">What did you just do?</div>
        <div class="csQuick">
          <button class="csAct go" onclick="claimLog('opened a case with the supplier')">Opened a case</button>
          <button class="csAct plain" onclick="claimLog('chased the supplier again')">Chased again</button>
          <button class="csAct plain" onclick="claimLog('supplier replied')">They replied</button>
        </div>
        <textarea id="claimNote" class="srtNote" rows="2" placeholder="What did they say? What did you send them?"></textarea>
        <button class="csAdd" onclick="claimLog()">Add to the record</button>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
          ${c.discordLink?`<button class="csAct go" style="padding:5px 12px;" onclick="window.open('${esc(c.discordLink)}','_blank')">&#128247; View photos in Discord</button>`:''}
          <input id="claimDl" placeholder="${c.discordLink?'Replace the Discord link…':'Paste the Discord photos link…'}" style="flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:11px;font-family:var(--mono);padding:6px 8px;"
            onchange="claimSetLink('${c.id}',this.value)">
        </div>
      </div>

      <div class="csSec">
        <div class="csSecT">How does it end?</div>
        <div class="csQuick">
          <button class="csAct good" onclick="claimEnd('refunded')">Money received — done</button>
          <button class="csAct go" onclick="claimEnd('replacement')">Replacement coming</button>
          <button class="csAct warn" onclick="claimEnd('chasing')">Still chasing</button>
        </div>
        <div class="csFoot2">Finishing it keeps every line above — nothing is deleted, it just stops being your job.</div>
      </div>
    </div>
    <div class="csFt">
      <button class="tfuAsk" style="width:auto;margin:0;padding:9px 16px;" onclick="claimToJack('${c.id}')">Send to Jack</button>
      <div style="flex:1;"></div>
      <button class="srtGhost" onclick="closeClaimCase()">Close</button>
    </div></div>`;
}
function claimSetLink(id,val){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  c.discordLink=(val||'').trim();
  saveClaim(c);toast(c.discordLink?'Photos link saved':'Link cleared','ok');
  paintClaimCase();renderAdmin();
}
function claimLog(preset){
  const c=claims.find(x=>String(x.id)===String(_claimCaseId));if(!c)return;
  const box=document.getElementById('claimNote');
  const msg=preset||(box?box.value.trim():'');
  if(!msg)return;
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:msg+' — '+_who()});
  c.lastChase=todayISO();
  if(c.cst==='Needs Attention'||c.cst==='Open')c.cst='Chasing';
  if(box&&!preset)box.value='';
  saveClaim(c);try{updateCB();}catch(e){}
  logAudit('Claim progress',`${c.sku||c.sup||''} — ${msg}`);
  paintClaimCase();renderAdmin();
}
function claimEnd(how){
  const c=claims.find(x=>String(x.id)===String(_claimCaseId));if(!c)return;
  if(!c.log)c.log=[];
  if(how==='refunded'){
    c.log.push({t:getNowUK(),msg:'Refund received — closed by '+_who()});
    c.cst='Resolved';c.resolvedAt=todayISO();
    toast('Closed — money back','ok');
  }else if(how==='replacement'){
    c.log.push({t:getNowUK(),msg:'Replacement agreed — waiting for it to arrive ('+_who()+')'});
    c.cst='Chasing';c.nextAction='Waiting for the replacement to arrive';
    toast('Recorded — waiting on the replacement','ok');
  }else{
    c.log.push({t:getNowUK(),msg:'Still chasing ('+_who()+')'});
    c.cst='Chasing';
    toast('Still chasing','ok');
  }
  c.lastChase=todayISO();
  saveClaim(c);try{updateCB();}catch(e){}
  logAudit('Claim outcome',`${c.sku||c.sup||''} — ${how}`);
  if(how==='refunded'){closeClaimCase();}else{paintClaimCase();}
  renderAdmin();try{renderClaims();}catch(e){}
}
/* One-press claim moves straight off the row — the same actions the modal
   offers, without opening it. */
function claimQuick(id,act){
  _claimCaseId=id;
  if(act==='refunded')return claimEnd('refunded');
  if(act==='contacted')return claimLog('opened a case with the supplier');
  if(act==='chased')return claimLog('chased the supplier again');
  if(act==='replied')return claimLog('supplier replied');
  if(act==='promised'){
    const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
    /* Jack, 5 Sep: "if the company says they're processing the refund, that's
       sorted — close it and move on." No reconciliation admin; he watches the
       bank himself. */
    (c.log=c.log||[]).push({t:getNowUK(),msg:'Refund confirmed by the supplier — closed by '+_who()});
    c.cst='Resolved';c.resolvedAt=todayISO();
    saveClaim(c);logAudit('Refund confirmed',c.sku||c.sup||'');
    toast('Closed — refund confirmed, nothing more to do','ok');
    renderAdmin();try{renderJack();}catch(e){}
    return;
  }
  if(act==='invoices')return claimLog('submitted invoices for ungating');
  if(act==='ungated'){
    const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
    if(!c.log)c.log=[];
    c.log.push({t:getNowUK(),msg:'Ungated — resolved by '+_who()});
    c.cst='Resolved';c.resolvedAt=todayISO();
    saveClaim(c);logAudit('Gated resolved',c.sku||c.sup||'');
    toast('Ungated — done','ok');renderAdmin();return;
  }
}
/* The 3-second undo bar. Small, centred, a progress fill she can watch:
   Undo bottom-left, Close now bottom-right, gone on its own at 3s. */
let _ubT=null,_ubCb=null;
function showUndoBar(msg,undoCb){
  _ubCb=undoCb;
  let el=document.getElementById('undoBar');
  if(!el){el=document.createElement('div');el.id='undoBar';el.className='overlay';
    el.style.zIndex='190';document.body.appendChild(el);}
  el.innerHTML=`<div class="modal ubMod">
    <div class="ubTtl">${esc(msg)}</div>
    <div class="ubTrack"><div class="ubFill" id="ubFill"></div></div>
    <div class="ubFoot">
      <button class="ubUndo" onclick="ubUndo()">Undo</button>
      <button class="ubNow" onclick="ubDone()">Close now</button>
    </div></div>`;
  el.style.display='flex';
  const fill=document.getElementById('ubFill');
  requestAnimationFrame(()=>{requestAnimationFrame(()=>{fill.style.width='100%';});});
  clearTimeout(_ubT);_ubT=setTimeout(ubDone,3100);
}
function ubDone(){clearTimeout(_ubT);_ubCb=null;
  const el=document.getElementById('undoBar');if(el)el.style.display='none';}
function ubUndo(){clearTimeout(_ubT);const cb=_ubCb;_ubCb=null;
  const el=document.getElementById('undoBar');if(el)el.style.display='none';
  if(cb)cb();}

/* One in-app dialog for every "type an answer" moment. The grey browser
   prompt() box looked like a crash, could not be styled, and swallowed the
   Escape key state — Jack has called every stock popup in this app ugly, and
   prompt() was the ugliest of the lot. */
let _atCb=null;
function askText(title,sub,placeholder,btn,cb){
  _atCb=cb;
  let el=document.getElementById('askTextModal');
  if(!el){el=document.createElement('div');el.id='askTextModal';el.className='overlay';
    el.style.zIndex='170';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)atShut();});}
  el.innerHTML=`<div class="modal srtCfm" style="max-width:480px;">
    <div class="srtCfmTtl">${esc(title)}</div>
    ${sub?`<div class="srtCfmSub" style="margin-bottom:10px;">${esc(sub)}</div>`:''}
    <textarea id="atBox" class="srtNote" rows="3" placeholder="${esc(placeholder||'')}"></textarea>
    <div class="atHint">A line is enough — what happened and what you did. No essays.</div>
    <div class="srtCfmFoot">
      <button class="srtGhost" onclick="atShut()">Cancel</button>
      <button class="srtGo" onclick="atGo()">${esc(btn||'Send')}</button>
    </div></div>`;
  el.style.display='flex';
  setTimeout(()=>{const b=document.getElementById('atBox');if(b)b.focus();},60);
}
function atShut(){const el=document.getElementById('askTextModal');if(el)el.style.display='none';_atCb=null;}
function atGo(){const v=((document.getElementById('atBox')||{}).value||'').trim();const cb=_atCb;atShut();if(cb)cb(v);}

/* Pulling something back from Jack — same one-press ease as sending it. */
async function undoSend(kind,id){
  if(kind==='claim'){
    const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
    c.owner='VA';c.sentToJack=null;
    (c.log=c.log||[]).push({t:getNowUK(),msg:'Pulled back from Jack by '+_who()});
    saveClaim(c);logAudit('Claim pulled back',c.sku||c.sup||'');
    toast('Back with you','ok');renderAdmin();try{renderJack();paintJackBadge();}catch(e){}
    return;
  }
  if(kind==='lav'){
    try{LV3.setSupplierIssueField(id,'toJack','');
      LV3.logSupplierIssue(id,{by:_who(),at:new Date().toISOString(),msg:'Pulled back from Jack'});}catch(e){}
    toast('Back with you','ok');renderAdmin();try{renderJack();paintJackBadge();}catch(e){}
    return;
  }
  const r=_rowById(id);if(!r||!r.resolution)return;
  if(r.resolution.state!=='asked'){toast('This one is a proposed closure — undo it from the popup','er');return;}
  const keep=r.resolution.chase||null;
  if(keep)keep.log=(keep.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:'Pulled back from Jack'}]);
  const _kq=r.resolution.query||null;
  r.resolution=(keep||_kq)?Object.assign({state:'working'},keep?{chase:keep}:{},_kq?{query:_kq,kind:'query',what:'uk-query'}:{}):null;
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded','er');return;}
  logAudit('Ask withdrawn',r.sku||r.asin||'');
  toast('Back with you','ok');renderAdmin();try{renderJack();paintJackBadge();}catch(e){}
}
/* Jack's two-click contact recording: CONTACTED SUPPLIER → Email/Chat/Case/
   Phone → saved with who and when. The system already knows everything else. */
let _ctFor=null,_ctAct=null;
function askMethod(key,act){_ctFor=key;_ctAct=act;renderAdmin();}
function ctMethod(m){
  const k=_ctFor,act=_ctAct;_ctFor=null;_ctAct=null;
  if(!k)return renderAdmin();
  const via=(m&&m!=='skip')?' by '+m.toLowerCase():'';
  if(k.startsWith('claim:')){
    _claimCaseId=k.slice(6);
    claimLog((act==='contacted'?'Opened a case with the supplier':'Chased the supplier again')+via);
  }else if(k.startsWith('lav:')){
    const key=k.slice(4);
    try{LV3.logSupplierIssue&&LV3.logSupplierIssue(key,{by:_who(),at:new Date().toISOString(),msg:'Chased today'+via});}catch(e){}
    logAudit('Supplier issue',key+' — chased'+via);
    toast('Logged — chased'+(via||''),'ok');
    renderAdmin();
  }
}
/* Same for a Lavarion shortage — the log line lands on every layer in the
   group via the existing LV3 fan-out. */
function lavQuick(key,act){
  const msg=act==='chased'?'Chased today':'They replied';
  try{LV3.logSupplierIssue&&LV3.logSupplierIssue(key,{by:_who(),at:new Date().toISOString(),msg});}catch(e){}
  logAudit('Supplier issue',key+' — '+msg);
  toast('Logged — '+msg,'ok');
  renderAdmin();
}
/* A late Lavarion order handed to Jack. He usually answers with a date: the
   order's window moves, it stops being late, and it leaves her list by itself. */
function _lavLateParts(key){const p=String(key||'').split(':');return{kind:p[0],oid:p[1],lid:p[2]};}
function lavLateToJack(key,note){
  const k=_lavLateParts(key);
  try{
    LV3.setEta(k.kind,k.oid,k.lid,'lateToJack',JSON.stringify({by:_who(),at:new Date().toISOString(),note:String(note||'').trim()}));
    LV3.setEta(k.kind,k.oid,k.lid,'lateToSarah','');
  }catch(e){toast('Could not send it — open the order instead','er');return;}
  logAudit('Late Lavarion order back to Jack',key+(note?' — '+note:''));
  try{fireWebhook(`${_who()} finished a job on a late Lavarion order${note?' — '+note:''}`,{event:'lav_late_to_jack'});}catch(e){}
  toast('Back with Jack — off your list','ok');
  renderAdmin();try{renderJack();}catch(e){}
}
/* Sarah's "Done" on a job Jack sent: one line back on what she found */
function lavLateDoneBox(key,btn){
  const host=btn&&btn.closest('td');if(!host)return;
  const k=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");  /* esc1 lives inside the renderers, not here */
  host.innerHTML=`<div class="jkAnsBox" data-jk-edit="1" style="align-items:stretch;">
    <div class="jkAnsT">What did you find?</div>
    <textarea class="jkAnsNote" rows="2" placeholder="e.g. Nisbets say it ships Friday" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();lavLateToJack('${k}',this.value);}"></textarea>
    <button class="csAct go" onclick="lavLateToJack('${k}',this.parentNode.querySelector('textarea').value)">Done &mdash; back to Jack</button>
    <button class="csAct plain" onclick="renderAdmin()">Back</button></div>`;
  setTimeout(()=>{const el=host.querySelector('textarea');if(el)el.focus();},30);
}
function lavLateNewDate(key,v){
  if(!v||!saneDate(v)){toast('Pick the date the supplier gave','er');return;}
  const k=_lavLateParts(key);
  try{
    LV3.setEta(k.kind,k.oid,k.lid,'eta1',v);
    LV3.setEta(k.kind,k.oid,k.lid,'eta2',v);
    LV3.setEta(k.kind,k.oid,k.lid,'_etaTouched',1);
    LV3.setEta(k.kind,k.oid,k.lid,'lateToJack','');
    LV3.setEta(k.kind,k.oid,k.lid,'lateToSarah','');
  }catch(e){toast('Could not set the date','er');return;}
  logAudit('Late Lavarion order — new date',key+' → '+v+' · '+_who());
  toast('New date '+new Date(v).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' — it stops being late, off both lists until then','ok');
  try{renderJack();}catch(e){}try{renderAdmin();}catch(e){}
}
/* Jack, 9 Sep: a late Lavarion order is his first. When he needs Sarah to do
   something on it — chase, check the invoice, ring them — he writes the job
   here and it lands on her Admin with his note; Done brings it back to him. */
function lavLateSarahBox(key,btn){
  const td=btn&&btn.closest('td');if(!td)return;
  const k=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");  /* esc1 lives inside the renderers, not here */
  td.innerHTML=`<div class="jkAnsBox" data-jk-edit="1">
    <div class="jkAnsT">What do you need Sarah to do?</div>
    <textarea id="jkLS_${String(key).replace(/[^a-z0-9]/gi,'_')}" class="jkAnsNote" rows="2" placeholder="e.g. Chase Nisbets for a date — order UK18964986" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();lavLateToSarah('${k}',this.value);}"></textarea>
    <button class="csAct go" onclick="lavLateToSarah('${k}',this.parentNode.querySelector('textarea').value)">Send to Sarah</button>
    <button class="csAct plain" onclick="renderJack()">Back</button></div>`;
  setTimeout(()=>{const el=td.querySelector('textarea');if(el)el.focus();},30);
}
function lavLateToSarah(key,note){
  note=String(note||'').trim();
  if(note.length<3){toast('Say what she needs to do','er');return;}
  const k=_lavLateParts(key);
  try{
    LV3.setEta(k.kind,k.oid,k.lid,'lateToSarah',JSON.stringify({by:_who(),at:new Date().toISOString(),note}));
    LV3.setEta(k.kind,k.oid,k.lid,'lateToJack','');
  }catch(e){toast('Could not send it','er');return;}
  logAudit('Late Lavarion order — job to Sarah',key+' — '+note);
  try{fireWebhook(`${_who()} sent Sarah a job on a late Lavarion order — ${note}`,{event:'lav_late_to_sarah'});}catch(e){}
  toast('Sent to Sarah — on her Admin with your note','ok');
  renderJack();try{renderAdmin();}catch(e){}
}
function lavIssueSarahBox(key,btn){
  const td=btn&&btn.closest('td');if(!td)return;
  const k=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  td.innerHTML=`<div class="jkAnsBox" data-jk-edit="1">
    <div class="jkAnsT">What do you need Sarah to do?</div>
    <textarea id="jkLI_${String(key).replace(/[^a-z0-9]/gi,'_')}" class="jkAnsNote" rows="2" placeholder="e.g. Chase Nisbets for the 58 missing — order UK18964986" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();lavIssueToSarah('${k}',this.value);}"></textarea>
    <button class="csAct go" onclick="lavIssueToSarah('${k}',this.parentNode.querySelector('textarea').value)">Send to Sarah</button>
    <button class="csAct plain" onclick="renderJack()">Back</button></div>`;
  setTimeout(()=>{const el=td.querySelector('textarea');if(el)el.focus();},30);
}
function lavIssueToSarah(key,note){
  note=String(note||'').trim();
  if(note.length<3){toast('Say what she needs to do','er');return;}
  try{
    LV3.setSupplierIssueField(key,'toSarah',JSON.stringify({by:_who(),at:new Date().toISOString(),note}));
    LV3.setSupplierIssueField(key,'toJack','');
    LV3.logSupplierIssue(key,{by:_who(),at:new Date().toISOString(),msg:'Job to Sarah — '+note});
  }catch(e){toast('Could not send it','er');return;}
  logAudit('Lavarion shortage — job to Sarah',key+' — '+note);
  try{fireWebhook(`${_who()} sent Sarah a job on a Lavarion shortage — ${note}`,{event:'lav_issue_to_sarah'});}catch(e){}
  toast('Sent to Sarah — on her Admin with your note','ok');
  renderJack();try{renderAdmin();}catch(e){}
}
function lavLateBack(key){
  const k=_lavLateParts(key);
  try{LV3.setEta(k.kind,k.oid,k.lid,'lateToJack','');}catch(e){toast('Could not hand it back','er');return;}
  logAudit('Late Lavarion order handed back',key);
  toast('Back with Sarah — no new date','ok');
  renderJack();try{renderAdmin();}catch(e){}
}
/* Jack, 11 Sep: after a promised date slips and nothing is here, an Amazon
   order goes to Jack (only he can see the account); a supplier order carries
   on down the never-arrived road. One press, no popup. */
async function slipStillNothing(rid){
  const r=_rowById(rid);if(!r)return;
  const c=_caseOf(r);
  if(!(typeof _amazonRow==='function'&&_amazonRow(r))){caseGo(rid,'check-refund','due-date');return;}
  const when=r.expectedDelivery?_dmy(r.expectedDelivery):'the promised date';
  const why='Check whether this order actually arrived';
  const note=`Promised ${when} — nothing booked in`;
  if(c){c.log=(c.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:'Date slipped, still nothing — sent to Jack to check the account'}]);c.step='to-jack';c.due='';}
  r.resolution=Object.assign({},r.resolution||{},{state:'asked',kind:'check',what:'jack-check',ask:why,note,chase:c||undefined,by:_who(),at:new Date().toISOString()});
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Asked Jack to check',`${r.sku||r.asin||''} — ${why} (${note})`);
  try{fireWebhook(`${_who()} needs you to check "${r.prod||r.sku||''}" — ${why}. ${note}`,{event:'ask_jack',sku:r.sku||''});}catch(e){}
  toast('Sent to Jack — grey at the bottom of your list until he answers','ok');
  renderAdmin();try{renderJack();paintJackBadge();}catch(e){}
}
/* A Lavarion shortage handed to Jack — same two-sides rule as everything else:
   grey and locked on her page, a card on his, back with his answer. */
function lavToJack(key){
  try{
    LV3.setSupplierIssueField(key,'toJack',JSON.stringify({by:_who(),at:new Date().toISOString()}));
    LV3.setSupplierIssueField(key,'toSarah','');   /* back with him — off her page */
    LV3.logSupplierIssue(key,{by:_who(),at:new Date().toISOString(),msg:'Sent to Jack'});
  }catch(e){toast('Could not send it — try from the popup','er');return;}
  logAudit('Supplier issue to Jack',key);
  try{fireWebhook(`${_who()} sent a supplier shortage to Jack`,{event:'lav_to_jack'});}catch(e){}
  toast('Sent to Jack — the row is grey at the bottom of your list until he answers','ok');
  renderAdmin();try{renderJack();paintJackBadge();}catch(e){}
}
function lavBackFromJack(key){
  askText('Answer & hand back','Your answer goes on the shortage and it returns to Sarah\u2019s queue.',
    'What did you find? What should she do?','Hand back',note=>_lavBackGo(key,note));
}
function _lavBackGo(key,note){
  try{
    LV3.setSupplierIssueField(key,'toJack','');
    LV3.logSupplierIssue(key,{by:_who(),at:new Date().toISOString(),msg:'Jack answered — '+(note||'handed back')});
  }catch(e){toast('Could not hand it back','er');return;}
  logAudit('Supplier issue answered',key);
  toast('Back with Sarah','ok');
  renderJack();try{renderAdmin();paintJackBadge();}catch(e){}
}
/* A claim Jack hands back, with his answer attached. */
function claimBackFromJack(id){
  askText('Answer & hand back','Your answer goes on the claim and it returns to Sarah\u2019s queue.',
    'What did you find? What should she do?','Hand back',note=>_claimBackGo(id,note));
}
function _claimBackGo(id,note){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  c.owner='VA';c.sentToJack=null;
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Jack answered — '+(note||'handed back')});
  saveClaim(c);
  logAudit('Claim answered',c.sku||c.sup||'');
  toast('Back with Sarah','ok');
  renderJack();try{renderAdmin();paintJackBadge();}catch(e){}
}
function claimToJack(id){
  const c=claims.find(x=>String(x.id)===String(id||_claimCaseId));if(!c)return;
  c.owner='Jack';
  /* Jack, 16 Aug: "the issue still needs to show on Sarah's side… light grey,
     waiting on me. It should NOT just disappear." This stamp is what keeps it
     on her page — and it also separates a claim she SENT from one that simply
     defaults to Jack (gated), which was never hers to watch. */
  c.sentToJack={by:_who(),at:new Date().toISOString()};
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Sent to Jack by '+_who()});
  saveClaim(c);try{updateCB();}catch(e){}
  logAudit('Claim sent to Jack',c.sku||c.sup||'');
  try{fireWebhook(`${_who()} sent the "${c.prod||c.sku||''}" claim to Jack`,{event:'claim_to_jack'});}catch(e){}
  toast('Sent to Jack — the row is grey at the bottom of your list until he answers','ok');
  closeClaimCase();renderAdmin();try{renderClaims();paintJackBadge();}catch(e){}
}

/* The one-line answer to "where does this stand" — last thing that happened,
   who did it, and whether the next look is overdue. */
/* the Where-it-stands dropdown — which rows are open, kept across repaints */
const _stOpen=new Set();
function stToggle(el,ev){
  if(ev){ev.stopPropagation();ev.preventDefault();}
  const k=String((el&&el.dataset&&el.dataset.rid)||'');if(!k)return;
  if(_stOpen.has(k))_stOpen.delete(k);else _stOpen.add(k);
  if(k.startsWith('jk:')){try{renderJack();}catch(e){}}else renderAdmin();
}
function caseStanding(c){
  if(!c)return null;
  const last=(c.log||[])[(c.log||[]).length-1];
  const step=_caseStep(c);
  const od=_caseDue(c);
  return{
    was:last?last.what:'',
    by:last?last.by:'',
    at:last?last.at:'',
    now:step?step.now:'',
    overdue:od!==null&&od>0?od:0,
    dueIn:od!==null&&od<=0?Math.abs(od):null
  };
}
/* The supplier gives a new date; it goes in the row's real expected-delivery
   field, the same one the Prep Sheet and every late calculation already read.
   One field, so the whole app agrees — and it comes back louder if it slips. */
/* Jack, 4 Sep: on a "check the Amazon order" row the useful answer is often a
   DATE — Amazon has told him when it will land. A date is not a note: it parks
   the row until then and brings it back on its own if it passes, which is what
   setDueDate already does. This just puts it one click from his queue. */
function jackAmzDate(rid,btn){
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  const host=btn&&btn.parentElement;if(!host)return;
  if(host.querySelector('.amzDateBox'))return;
  const box=document.createElement('div');
  box.className='amzDateBox';
  const min=new Date().toISOString().slice(0,10);
  const _Q=_ukQuery(r),_says=_amazonRow(r)?'Amazon':'The supplier';
  box.innerHTML=`<div class="amzDateT">When did ${_amazonRow(r)?'Amazon':'the supplier'} say?</div>
    <input type="date" class="amzDateIn" min="${min}" max="2030-12-31">
    ${_Q?`<input type="text" class="amzDateNote" maxlength="140" placeholder="Reply to the warehouse (optional) — e.g. parcel 2 arriving Thursday">`:''}
    <div class="amzDateActs">
      <button class="csAct plain" data-x="1">Cancel</button>
      <button class="csAct good" data-go="1">Save the date</button>
    </div>
    <div class="amzDateHint">It comes off the chase list until then, and comes back on its own if the date passes.</div>`;
  host.appendChild(box);
  const inp=box.querySelector('.amzDateIn');setTimeout(()=>inp.focus(),30);
  box.querySelector('[data-x]').onclick=()=>box.remove();
  box.querySelector('[data-go]').onclick=async()=>{
    const v=inp.value;
    if(!v||!saneDate(v)){toast('Pick a date first','er');return;}
    box.remove();
    /* Answering through jackAnswered marks the case REJECTED, which is the
       "here you go, carry on" route and puts the row straight back on her chase
       list — the opposite of parking it. A date is not a job: record it, take it
       off his queue, and let setDueDate hold the row until the date passes. */
    const _res=r.resolution||{};
    const _rep=((box.querySelector('.amzDateNote')||{}).value||'').trim();
    const _nice=new Date(v).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    r.resolution=Object.assign({},_res,{
      state:'approved',kind:'ops',what:'in-transit',
      answeredBy:_who(),answeredAt:new Date().toISOString(),
      rejectNote:_says+' says it will arrive '+v});
    if(_Q){
      /* the warehouse's question is answered: more is coming, on this date */
      r.resolution.query=Object.assign({},_Q,{answer:'more-coming',answeredAt:new Date().toISOString(),answeredBy:_who(),due:v,reply:_rep});
      _qryReplyNote(r,`more is still coming — expected ${_nice}${_rep?'. '+_rep:''}.`);
    }
    const _ch=r.resolution.chase||{path:'never-arrived',step:'due-date',due:'',log:[]};
    _ch.log=(_ch.log||[]).concat([{at:new Date().toISOString(),by:_who(),
      what:(_Q?'Answered the warehouse — more still coming, expected '+v:_says+' says it will arrive '+v+' — parked until then')+(_rep?' — '+_rep:'')}]);
    _ch.step='due-date';_ch.due=v;r.resolution.chase=_ch;
    r.sentToJack=null;
    r._dirty=true;
    try{await _mustSave(r);}catch(e){}
    await setDueDate(rid,v);
    try{renderJack();renderAdmin();renderPrep();paintJackBadge();}catch(e){}
    try{logAudit('Amazon delivery date set',`${r.sku||''} → ${v}`);}catch(e){}
    toast('Parked until '+v+' — back on the list if it slips','ok');
  };
}
async function setDueDate(rid,val){
  const r=_rowById(rid);if(!r)return;
  if(val&&!saneDate(val))return;         /* half-typed year — let them finish */
  const was=r.expectedDelivery||'';
  r.expectedDelivery=val||'';
  r.chaseSnoozeUntil='';                 // the date is the snooze now
  /* The app auto-flags stuck rows 'Late — Needs Chasing', and that flag counts
     as "being chased" — which held rows on Sarah's queue even after she typed
     the new date (Jack: "it should go off her sheet — it's not late, it has an
     expected date now"). Clear OUR auto-flag; a chase status a person picked,
     or a live supplier case, still holds the row on purpose. The flag comes
     straight back the moment the date slips. */
  if(val&&r.transitAction==='Late — Needs Chasing')r.transitAction='';
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit('Due date set',`${r.sku||r.asin||''} — ${was||'none'} → ${val||'cleared'}`);
  toast(val?('Off the list until '+new Date(val).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' — back if it slips'):'Date cleared','ok');
  renderAdmin();
  try{renderPrep();}catch(e){}
  try{renderDashboard();}catch(e){}
}
function bumpDue(rid,days){
  const d=new Date();d.setDate(d.getDate()+days);
  setDueDate(rid,d.toISOString().split('T')[0]);
}

// ── THE SECTIONS SARAH AND JACK WORK FROM ────────────────────────────────────
function checkInStrip(){
  const st=checkInState();
  const late=st.late;
  /* Past 20 days with nothing written against it means nobody has looked. That
     is the state that let orders reach 114 days, so it is named here rather
     than left to be noticed. */
  const items=_adminItems();
  const untouched=items.filter(i=>{
    const r=_rowById(i.rid);
    return i.days>=20&&!(r&&(r.notes||'').trim())&&!i.expDate&&!i.delivered&&!i.wrongSku;
  });
  const expiring=items.filter(i=>{const L=refundLeft(i.date,i);return L!==null&&L>=0&&L<=7;});
  /* The early-warning band: past halfway, still time to act. These are the ones
     that turn into write-offs if nobody looks. */
  const warming=items.filter(i=>{const L=refundLeft(i.date,i);return L!==null&&L>7&&L<=REFUND_DAYS/2;});
  return`<div class="ciBar ${late?'late':'ok'}">
    <div class="ciDot"></div>
    <div class="ciTxt">
      <div class="ciTtl">${late
        ? (st.never?'This page has never been checked off':'Overdue — this page hasn\'t been checked')
        : 'Checked off'}</div>
      <div class="ciSub">${late
        ? `Give everything below a look, then press Checked. ${WEBHOOK_CFG.on&&WEBHOOK_CFG.url?'Jack gets a message while this is outstanding.':'Turn alerts on in Settings to be reminded.'}`
        : `${esc(st.by||'')} · ${st.ago} — next check ${_dueWord(st.due)}`}</div>
      ${(untouched.length||expiring.length)?`<div class="ciFlags">
        ${expiring.length?`<span class="ciFlag hot">${expiring.length} losing the claim window within 7 days — do these first</span>`:''}
        ${warming.length?`<span class="ciFlag">${warming.length} over halfway through the claim window</span>`:''}
        ${untouched.length?`<span class="ciFlag">${untouched.length} past 20 days with nothing recorded</span>`:''}
      </div>`:''}
    </div>
    <button class="ciBtn ${late?'':'done'}" onclick="adminCheckIn()">${late?'Checked':'Check again'}</button>
  </div>`;
}
function approvalsSection(){
  const j=jackTodo();
  if(!j.n)return'';
  const row=r=>{
    const res=r.resolution||{};
    return`<div class="vaRow">
      <div class="vaMain">
        <div class="vaTask">${esc(r.prod||r.sku||'')}${res.claim?'<span class="vaChip claim">money at risk</span>':''}</div>
        <div class="vaWho"><b>${esc(_resText(res.what))}</b> · investigated by ${esc(res.by||'')} ${noteAgo(res.at)}</div>
        ${res.note?`<div class="vaWhat" title="${esc(res.note)}"><b>Found:</b> ${esc(res.note)}</div>`:''}
        ${res.fix?`<div class="vaWhat" style="color:#93c5fd;" title="${esc(res.fix)}"><b>She suggests:</b> ${esc(res.fix)}</div>`:''}
        ${(res.followUps||[]).length?`<div class="vaWhat">Then: ${esc((res.followUps||[]).join(' · '))}</div>`:''}
      </div>
      <div class="vaBtns">
        <button class="vaBtn no" onclick="rejectResolution('${r.uuid||r.id}')">Send back</button>
        <button class="vaBtn go" onclick="approveResolution('${r.uuid||r.id}')">Approve</button>
      </div>
    </div>`;
  };
  const fix=r=>`<div class="vaRow">
    <div class="vaMain">
      <div class="vaTask">${esc(r.prod||r.sku||'')}<span class="vaChip">quantity corrected</span></div>
      <div class="vaWho">Expected <b>${r.qtyFix.from}</b> → <b>${r.qtyFix.to}</b> by ${esc(r.qtyFix.by||'')} ${noteAgo(r.qtyFix.at)}</div>
      ${r.qtyFix.why?`<div class="vaWhat">&ldquo;${esc(r.qtyFix.why)}&rdquo;</div>`:''}
    </div>
    <div class="vaBtns"><button class="vaBtn" onclick="ackQtyFix('${r.uuid||r.id}')">Seen</button></div>
  </div>`;
  return`<div class="vaSec jack" id="secApprovals">
    <div class="vaHd">
      <h4>Decisions for Jack</h4><span class="vaN">${j.n}</span>
      <span class="vaWhy">Already investigated — these need a commercial call</span>
    </div>
    ${j.closures.map(row).join('')}${j.fixes.map(fix).join('')}
  </div>`;
}
/* Everything closed off in the last month, with a way back. An approval that
   cannot be undone is how a row gets quietly buried instead of chased — the
   whole failure this rework exists to stop. */
function closedSection(){
  const cut=Date.now()-31*864e5;
  /* No !archived filter — approving with "Remove from Prep Sheet" archives the
     row, and it must still be listed here so it can be put back. */
  const done=rows.filter(r=>r.resolution&&r.resolution.state==='approved'
      &&new Date(r.resolution.approvedAt||r.resolution.at||0).getTime()>cut)
    .sort((a,b)=>String(b.resolution.approvedAt||'').localeCompare(String(a.resolution.approvedAt||'')));
  if(!done.length)return'';
  return`<div class="vaSec" style="border-left:4px solid var(--green);" id="secClosed">
    <div class="vaHd">
      <h4>Closed off recently</h4><span class="vaN">${done.length}</span>
      <span class="vaWhy">Last 31 days — put anything back if it was closed too early</span>
    </div>
    ${done.map(r=>`<div class="vaRow">
      <div class="vaMain">
        <div class="vaTask">${esc(r.prod||r.sku||'')}${r.resolution.claim?'<span class="vaChip claim">was a loss</span>':''}</div>
        <div class="vaWho"><b>${esc(_resText(r.resolution.what))}</b> · closed by ${esc(r.resolution.by||'')}, approved by ${esc(r.resolution.approvedBy||'')} ${noteAgo(r.resolution.approvedAt)}</div>
        ${r.cancelledQty?`<div class="vaWhat">${r.exp||0} ordered · ${r.rcvd||0} arrived${_cxLabel(r)}</div>`:''}
        ${r.resolution.note?`<div class="vaWhat" title="${esc(r.resolution.note)}">&ldquo;${esc(r.resolution.note)}&rdquo;</div>`:''}
      </div>
      <div class="vaBtns"><button class="vaBtn" onclick="reopenResolution('${r.uuid||r.id}')">Put back</button></div>
    </div>`).join('')}
  </div>`;
}
function actionCentre(){
  const open=VA_ACTIONS.filter(a=>!a.done);
  const done=VA_ACTIONS.filter(a=>a.done).slice(0,8);
  if(!open.length&&!done.length)return'';
  const row=a=>`<div class="vaRow ${a.done?'done':''}">
    <div class="vaMain">
      <div class="vaTask">${esc(a.task)}${a.sheetRow?`<span class="vaChip">sheet row ${esc(a.sheetRow)}</span>`:''}</div>
      <div class="vaWho">${esc(a.prod||a.sku||'')}${a.oid?' · '+esc(a.oid):''}</div>
      ${a.detail?`<div class="vaWhat" title="${esc(a.detail)}">${esc(a.detail)}</div>`:''}
      <div class="vaWho">from ${esc(a.by||'')} ${noteAgo(a.at)}${a.done&&a.doneBy?` · done by ${esc(a.doneBy)} ${noteAgo(a.doneAt)}`:''}</div>
    </div>
    <div class="vaBtns"><button class="vaBtn ${a.done?'':'go'}" onclick="doneVaAction('${a.id}')">${a.done?'Undo':'Done'}</button></div>
  </div>`;
  return`<div class="vaSec todo" id="secActions">
    <div class="vaHd">
      <h4>Action Centre</h4><span class="vaN">${open.length}</span>
      <span class="vaWhy">The admin left over once something is closed off</span>
    </div>
    ${open.length?open.map(row).join(''):'<div class="vaEmpty">Nothing outstanding — everything closed off has been finished.</div>'}
    ${done.length?done.map(row).join(''):''}
  </div>`;
}

/* ── LAVARION: SHORT AND DAMAGED ──────────────────────────────────────────
   Short deliveries and damaged stock on the Lavarion side are supplier
   conversations, same as everything else on this page — so they live here
   rather than on a page of their own that nobody would open. One order is one
   item, because a short box and a damaged box from the same supplier on the
   same order is one email.
   Lavarion loads its own data on demand. If nobody has opened it this session,
   this asks it to load, once, and redraws when it has. */
let _lavAdminBooting=false,_lavAdminFailed=false;
/* goPage wants the sidebar button it was clicked from, so press the real one
   rather than half-navigating and leaving the sidebar showing the wrong page. */
function openLavPurchases(){
  const b=document.querySelector('.sb-item[onclick*="lavarion"]');
  if(b)b.click();
  try{if(window.LV3&&LV3.go)LV3.go('purchases');}catch(e){}
}
/* passive = read it if it is already loaded, never send anybody to fetch it.
   The Dashboard opens for everyone including people who never touch Lavarion,
   and making the first paint of the day wait on a stock load nobody asked for
   is how a summary tile becomes the slowest thing in the app. Sarah's Admin
   asks for the data, because that is the page where the work is. */
function _lavIssues(passive){
  try{
    if(!window.LV3||!LV3.supplierIssues)return null;
    if(!LV3.isReady||!LV3.isReady()){
      if(_lavAdminFailed)return [];          // asked once, it never came — say nothing
      if(passive)return null;
      if(!_lavAdminBooting){
        _lavAdminBooting=true;
        Promise.resolve(LV3.boot())
          .then(()=>{if(!(LV3.isReady&&LV3.isReady()))_lavAdminFailed=true;})
          .catch(()=>{_lavAdminFailed=true;})
          /* redraw whatever is actually on screen, not whichever page happened
             to ask — the boot can finish after the user has moved on */
          .then(()=>{try{
            const p=document.querySelector('.page.active');
            const id=p&&p.id;
            if(id==='page-admin')renderAdmin();
            else if(id==='page-dashboard')renderDashboard();
          }catch(e){}});
      }
      return null;
    }
    return LV3.supplierIssues();
  }catch(e){console.warn('lav issues',e);return null;}
}
let _lavIssueKey=null;
function openLavIssue(key){
  _lavIssueKey=key;
  let el=document.getElementById('lavIssueModal');
  if(!el){el=document.createElement('div');el.id='lavIssueModal';el.className='overlay';
    el.style.zIndex='150';document.body.appendChild(el);}
  el.style.display='flex';
  paintLavIssue();
}
function closeLavIssue(){const el=document.getElementById('lavIssueModal');if(el)el.style.display='none';_lavIssueKey=null;}
function paintLavIssue(){
  const el=document.getElementById('lavIssueModal'); if(!el||!_lavIssueKey)return;
  const list=_lavIssues(true)||[];
  const g=list.find(x=>x.key===_lavIssueKey);
  if(!g){closeLavIssue();return;}
  const money=n=>'£'+(n||0).toFixed(2);
  const log=(g.log||[]);
  const chip=(t,c)=>`<span style="font-size:10.5px;font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:5px;color:${c};background:${c}1f;border:1px solid ${c}55;">${t}</span>`;
  const step=(n,title,body)=>`<div style="display:flex;gap:11px;padding:11px 0;border-bottom:1px solid var(--border);">
      <div style="flex:0 0 22px;height:22px;border-radius:50%;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;">${n}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:5px;">${title}</div>
        ${body}
      </div></div>`;
  const btn=(txt,fn,col)=>`<button onclick="${fn}" style="padding:6px 13px;border-radius:6px;font-size:11.5px;font-weight:800;cursor:pointer;color:${col};background:${col}1f;border:1px solid ${col}66;">${txt}</button>`;
  el.innerHTML=`<div class="mod" style="max-width:720px;width:94vw;max-height:88vh;overflow:auto;background:var(--bg2);border:1px solid var(--border);border-radius:12px;">
    <div style="display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:800;color:var(--text);">${esc(g.sup)}</div>
        <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:2px;">${g.ref?'order '+esc(g.ref):'no order reference'} · raised ${g.age===0?'today':g.age+' days ago'}</div>
      </div>
      <div style="text-align:right;">
        <div style="font:800 18px var(--num);font-variant-numeric:tabular-nums;color:#fbbf24;">${money(g.val)}</div>
        <div style="font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;">at stake</div>
      </div>
      <button onclick="closeLavIssue()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1;">×</button>
    </div>
    <div style="padding:14px 18px 4px;display:flex;gap:7px;flex-wrap:wrap;">
      ${g.short?chip(g.short+' SHORT','#ef4444'):''}
      ${g.dmg?chip(g.dmg+' DAMAGED','#fbbf24'):''}
      ${g.repl?chip(g.repl+' REPLACEMENT AGREED','#4ade80'):''}
      ${g.chased?chip('CHASED '+g.chased.slice(8,10)+'/'+g.chased.slice(5,7),'#60a5fa'):chip('NOT CHASED YET','#94a3b8')}
    </div>
    <div style="padding:4px 18px 16px;">
      ${step(1,'What is wrong',
        `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:9px 11px;">
          ${g.lines.map(x=>`<div style="display:flex;justify-content:space-between;gap:10px;font-size:11.5px;padding:3px 0;">
            <span style="color:var(--text);font-weight:600;">${esc(x.name)}</span>
            <span style="color:#fbbf24;font-weight:800;white-space:nowrap;">${[x.short?x.short+' short':'',x.dmg?x.dmg+' damaged':''].filter(Boolean).join(' · ')}</span></div>`).join('')}
        </div>`)}
      ${(()=>{
        /* Jack, 17 Aug: "don't need 2" — the Evidence step is gone. Photos
           live in Discord; one small row holds the link and jumps to it. */
        const isUrl=/^https?:\/\//.test((g.evid||'').trim());
        return `<div style="display:flex;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);">
          ${isUrl?`<button onclick="window.open('${esc(g.evid.trim())}','_blank')" style="padding:6px 12px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;color:#93c5fd;background:rgba(96,165,250,.14);border:1px solid rgba(96,165,250,.5);white-space:nowrap;">&#128247; View photos</button>`:''}
          <input id="lavEvid" value="${esc(g.evid||'')}" placeholder="Paste the Discord photos link (right-click the message &rarr; Copy Message Link)"
            style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:11px;font-family:var(--mono);box-sizing:border-box;"
            onchange="try{LV3.setSupplierIssueField(_lavIssueKey,'evid',this.value.trim());toast('Photos link saved','ok');paintLavIssue();}catch(e){}">
        </div>`;})()}
      ${step(2,'Talk to the supplier',
        `<div style="display:flex;gap:7px;flex-wrap:wrap;">
          ${(()=>{
            /* The popup now SHOWS what the row already recorded — pressing
               Chased today on the row and opening this used to look like
               nothing had happened, which read as "not saving". Same data,
               same day, shown done. */
            const today=new Date().toISOString().slice(0,10);
            const doneToday=(g.chased||'')===today;
            return doneToday
              ?`<span style="padding:6px 13px;border-radius:6px;font-size:11.5px;font-weight:800;color:#4ade80;background:rgba(74,222,128,.13);border:1px solid rgba(74,222,128,.5);">&#10003; Chased today${(()=>{const last=(g.log||[]).slice().reverse().find(e=>/chased today/i.test(e.msg||''));const m=last&&(last.msg.match(/by (email|live chat|case|phone)/i)||[])[0];return m?' '+m:'';})()}</span>`
              :btn('Chased today','lavIssueChase()','#60a5fa');
          })()}
          ${btn('They replied','lavIssueLog(\'They replied\')','#94a3b8')}
          <span style="font-size:11px;font-weight:600;color:var(--text3);align-self:center;">${g.replyBy?'reply promised by '+esc(g.replyBy):'no reply date set'}</span>
        </div>
        <textarea id="lavNote" placeholder="What did they say? What did you send them?"
          style="width:100%;margin-top:8px;padding:8px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px;min-height:52px;box-sizing:border-box;"></textarea>
        <button onclick="lavIssueLog()" style="margin-top:6px;padding:5px 12px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Add to the log</button>`)}
      ${step(3,'How it ends',
        `<div style="display:flex;gap:7px;flex-wrap:wrap;">
          ${btn('Refunded','lavIssueOutcome(\'refunded\')','#4ade80')}
          ${btn('Replacement coming','lavIssueOutcome(\'replacement\')','#38bdf8')}
          ${btn('Still chasing','lavIssueOutcome(\'chasing\')','#fbbf24')}
          ${btn('Send to Jack','lavIssueOutcome(\'jack\')','#60a5fa')}
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);margin-top:6px;line-height:1.5;">Refunded or a replacement agreed closes it here and stops it being chased. It stays undoable for 48 working hours.</div>`)}
      ${log.length?`<div style="margin-top:12px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--text3);text-transform:uppercase;margin-bottom:6px;">Progress log</div>
        ${log.slice().reverse().map(e=>`<div style="font-size:11.5px;color:var(--text2);padding:5px 0;border-bottom:1px solid var(--border);"><b style="color:var(--text);">${esc(e.by||'')}</b> <span style="color:var(--text3);">${esc((e.at||'').slice(0,10))}</span> — ${esc(e.msg||'')}</div>`).join('')}
      </div>`:''}
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;padding:12px 18px;border-top:1px solid var(--border);">
      <button onclick="openLavPurchases()" style="padding:7px 14px;background:transparent;border:1px solid var(--border2);color:var(--text3);border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;">Open in Lavarion</button>
      <button onclick="lavIssueSave()" style="padding:7px 18px;background:var(--accent);border:1px solid var(--accent);color:#1a1400;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer;">Save</button>
    </div>
  </div>`;
}
function lavIssueChase(){lavIssueLog('Chased today');}
function lavIssueLog(preset){
  const box=document.getElementById('lavNote');
  const msg=preset||(box?box.value.trim():'');
  if(!msg){toast('Write what happened first','er');return;}
  try{LV3.logSupplierIssue&&LV3.logSupplierIssue(_lavIssueKey,{by:_who(),at:new Date().toISOString(),msg});}catch(e){}
  if(box&&!preset)box.value='';
  toast('Logged','ok');
  paintLavIssue();try{renderAdmin();}catch(e){}
}
function lavIssueOutcome(kind){
  /* The native "This page says…" confirm box is gone — Jack: "wtf is this".
     One press does the real thing; the 3-second bar is the safety net. And
     Send to Jack now performs the ACTUAL hand-over (grey row on Sarah's,
     lands on his page) — before this it only wrote a log line saying it had. */
  const key=_lavIssueKey;
  if(kind==='jack'){closeLavIssue();lavToJack(key);return;}
  const label={refunded:'Refunded — money back',replacement:'Replacement agreed',
    chasing:'Still chasing'}[kind]||kind;
  lavIssueLog(label);
  if(kind!=='chasing'){
    closeLavIssue();
    showUndoBar(label,()=>{
      try{const l=null;LV3.logSupplierIssue(key,{by:_who(),at:new Date().toISOString(),msg:'Undone — '+label+' was pressed by mistake'});}catch(e){}
      _lavIssueKey=key;openLavIssue(key);
    });
  }
}
function lavIssueSave(){
  const ev=document.getElementById('lavEvid');
  if(ev){try{LV3.setSupplierIssueField&&LV3.setSupplierIssueField(_lavIssueKey,'evid',ev.value.trim());}catch(e){}}
  toast('Saved','ok');closeLavIssue();try{renderAdmin();}catch(e){}
}
/* ── THE WORK MODAL ─────────────────────────────────────────────────────────
   Jack, 16 Aug: rows had become entire editing forms — "dozens of buttons and
   dropdowns visible simultaneously… nothing has a clear primary action."
   The row now says where things stand; THIS is where she works. One record,
   640px, the guided flow top to bottom, every control the same handler the
   old row used. Escape closes. */
let _workRid=null;
function openWork(rid){
  _workRid=rid;logOpened(rid,'work it');markSeen(rid);
  let el=document.getElementById('workModal');
  if(!el){el=document.createElement('div');el.id='workModal';el.className='overlay';
    el.style.zIndex='120';document.body.appendChild(el);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeWork();});}
  el.style.display='flex';
  paintWork();
}
function closeWork(){const el=document.getElementById('workModal');if(el)el.style.display='none';_workRid=null;}
function _workAnd(fn){return `${fn};paintWork();`}
function paintWork(){
  const el=document.getElementById('workModal'); if(!el||!_workRid)return;
  const i=_adminItems().find(x=>x.rid===_workRid);
  const r=_rowById(_workRid);
  if(!r){closeWork();return;}
  const it=i||{};
  const waiting=it.waiting;
  const isAmz=typeof _jackSupplier==='function'&&_jackSupplier(r.sup);
  const left=refundLeft(r.date,r);
  const days=it.days||'';
  const supCol={'amazon uk':'#60a5fa','amazon france':'#c084fc','amazon germany':'#34d399','amazon italy':'#f472b6','qogita':'#38bdf8'}[String(r.sup||'').toLowerCase()]||'#94a3b8';
  const chip=(t,c)=>`<span style="font-size:10.5px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:10px;color:${c};background:${c}1a;border:1px solid ${c}50;white-space:nowrap;">${t}</span>`;
  const sel=(field,val)=>`<select onchange="${_workAnd(`setTriage('${_workRid}','${field}',this.value)`)}"
      style="padding:8px 12px;background:var(--bg);border:1px solid ${val==='Yes'?'rgba(74,222,128,.5)':'var(--border2)'};color:${val==='Yes'?'#4ade80':'var(--text)'};border-radius:7px;font-size:12.5px;font-weight:700;cursor:pointer;">
      ${['','Yes','No'].map(o=>`<option value="${o}" ${val===o?'selected':''}>${o||'— pick —'}</option>`).join('')}</select>`;
  const stepTitle=t=>`<div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin:0 0 7px;">${t}</div>`;
  const units=parseInt(r.exp||0)||0,got=parseInt(r.rcvd)||0,cx=parseInt(r.cancelledQty)||0;
  const out=Math.max(0,units-got-cx);
  const arrived=r.delivered==='Yes', notArrived=r.delivered==='No', ws=r.wrongSku;

  let flow='';
  if(waiting){
    flow=`<div style="padding:14px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.35);border-radius:9px;font-size:12px;font-weight:600;color:var(--text2);line-height:1.6;">
      <b style="color:#93c5fd;">With Jack.</b> ${waiting.state==='asked'?'You asked him to check whether it arrived.':'Your close-off is waiting for his decision.'}
      It unlocks the moment he answers — nothing for you to do here.</div>`;
  }else{
    const stepA=`<div style="margin-bottom:16px;">${stepTitle('Step 1 — has it arrived?')}
      ${isAmz
        ? (arrived||notArrived
            ? `<div style="display:flex;align-items:center;gap:9px;">${chip(arrived?'ARRIVED — Jack confirmed':'NOT ARRIVED — Jack confirmed',arrived?'#4ade80':'#f87171')}</div>`
            : `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <button onclick="closeWork();askJackAsk('${_workRid}')" style="padding:9px 16px;border-radius:8px;font-size:12.5px;font-weight:800;cursor:pointer;background:rgba(96,165,250,.15);border:1px solid rgba(96,165,250,.5);color:#93c5fd;">Send to Jack — has it arrived?</button>
                <span style="font-size:11.5px;font-weight:600;color:var(--text3);">Amazon order — only Jack can see the account.</span></div>`)
        : `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">${sel('delivered',r.delivered||'')}
            <span style="font-size:11.5px;font-weight:600;color:var(--text3);">Yours to check — emails, order history, tracking.</span></div>`}
    </div>`;
    const stepB=arrived?`<div style="margin-bottom:16px;">${stepTitle('Step 2 — did it go out on the wrong SKU?')}
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">${sel('wrongSku',ws||'')}
        ${ws==='Yes'?`<span style="font-size:11.5px;font-weight:700;color:#4ade80;">You know this one — press Sorted below and write it up.</span>`
         :ws==='No'?`<span style="font-size:11.5px;font-weight:700;color:#f87171;">Arrived but not wrong SKU — where has it gone? Send it to Jack and hunt together.</span>`
         :`<span style="font-size:11.5px;font-weight:600;color:var(--text3);">Your usual check.</span>`}
      </div>
      ${ws==='No'?`<button onclick="closeWork();askJackAsk('${_workRid}')" style="margin-top:9px;padding:9px 16px;border-radius:8px;font-size:12.5px;font-weight:800;cursor:pointer;background:rgba(239,68,68,.13);border:1px solid rgba(239,68,68,.5);color:#fca5a5;">Send to Jack — stock missing</button>`:''}
    </div>`:'';
    const stepC=`<div style="margin-bottom:16px;">${stepTitle(arrived?'Step 3 — notes':'Step 2 — chase and notes')}
      <textarea id="workNote" placeholder="What did they say? What have you done?"
        style="width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:12.5px;min-height:64px;box-sizing:border-box;line-height:1.5;">${esc(r.notes||'')}</textarea>
      <div style="display:flex;gap:7px;margin-top:7px;flex-wrap:wrap;">
        <button onclick="workSaveNote()" style="padding:7px 14px;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;background:var(--bg3);border:1px solid var(--border2);color:var(--text);">Save note</button>
        <span style="flex:1;"></span>
        <span style="font-size:11px;font-weight:600;color:var(--text3);align-self:center;">They promised a date?</span>
        <button onclick="${_workAnd(`bumpDue('${_workRid}',7)`)}" class="wq">1 wk</button>
        <button onclick="${_workAnd(`bumpDue('${_workRid}',14)`)}" class="wq">2 wks</button>
        <button onclick="${_workAnd(`bumpDue('${_workRid}',30)`)}" class="wq">1 mth</button>
        <input type="date" value="${esc(r.expectedDelivery||'')}" min="2024-01-01" max="2030-12-31" onchange="${_workAnd(`setDueDate('${_workRid}',this.value)`)}"
          style="padding:6px 9px;background:var(--bg);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:11px;">
      </div>
    </div>`;
    flow=stepA+stepB+stepC;
  }

  el.innerHTML=`<div class="mod" style="max-width:640px;width:94vw;max-height:88vh;overflow:auto;background:var(--bg2);border:1px solid var(--border);border-radius:14px;">
    <div style="display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14.5px;font-weight:800;color:var(--text);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(r.prod||r.sku||'')}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:7px;">
          ${chip(esc(r.sup||'—'),supCol)}
          ${r.oid?`<span style="font:600 11px var(--mono);color:var(--text3);cursor:pointer;" onclick="copyVal('${(r.oid||'').replace(/'/g,"\\'")}',this)">${esc(r.oid)}</span>`:''}
          ${r.acct?`<span style="font-size:11px;font-weight:600;color:var(--text3);">${esc(r.acct)}</span>`:''}
        </div>
      </div>
      <div style="text-align:right;flex:0 0 auto;">
        ${days?`<div style="font:900 22px var(--num);color:${it.col||'var(--text)'};line-height:1;">${days}d</div>
        <div style="font-size:9.5px;font-weight:800;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;">in transit</div>`:''}
      </div>
      <button onclick="closeWork()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1;padding:2px 4px;">×</button>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02);">
      <div><span style="font:800 15px var(--num);color:var(--text);">${units}</span> <span style="font-size:11px;color:var(--text3);">ordered</span></div>
      <div><span style="font:800 15px var(--num);color:#4ade80;">${got}</span> <span style="font-size:11px;color:var(--text3);">in</span></div>
      ${cx?`<div><span style="font:800 15px var(--num);color:#94a3b8;">${cx}</span> <span style="font-size:11px;color:var(--text3);">cancelled</span></div>`:''}
      <div><span style="font:800 15px var(--num);color:#fbbf24;">${out}</span> <span style="font-size:11px;color:var(--text3);">still out</span></div>
      <span style="flex:1;"></span>
      ${left!==null?chip(left<0?`CLAIM WINDOW GONE ${Math.abs(left)}D AGO`:`${left}D LEFT TO CLAIM`,left<0?'#94a3b8':(left<=7?'#ef4444':'#4ade80')):''}
    </div>
    <div style="padding:16px 18px;">${flow}</div>
    <div style="display:flex;gap:8px;align-items:center;padding:13px 18px;border-top:1px solid var(--border);flex-wrap:wrap;">
      <button onclick="closeWork();gsJump('prep','${(r.oid||r.sku||'').replace(/'/g,"\\'")}')" style="padding:8px 14px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;background:transparent;border:1px solid var(--border2);color:var(--text3);">View in Prep</button>
      <button ${waiting?'disabled':''} onclick="closeWork();openQtyFix('${_workRid}')" style="padding:8px 14px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;background:transparent;border:1px solid var(--border2);color:var(--text3);${waiting?'opacity:.4;':''}">Wrong qty</button>
      <span style="flex:1;"></span>
      <button ${waiting?'disabled':''} onclick="closeWork();openSorted('${_workRid}')" style="padding:9px 20px;border-radius:8px;font-size:12.5px;font-weight:800;cursor:pointer;background:var(--accent);border:1px solid var(--accent);color:#1a1400;${waiting?'opacity:.4;':''}">Sorted — close it off</button>
    </div>
  </div>`;
}
function workSaveNote(){
  const r=_rowById(_workRid); const box=document.getElementById('workNote');
  if(!r||!box)return;
  r.notes=box.value.trim();
  r.notesAt=new Date().toISOString(); r.notesBy=_who(); r._dirty=true;
  saveRow(r); toast('Note saved','ok');
  paintWork(); try{renderAdmin();}catch(e){}
}
function lavSupplierBlock(){
  const list=_lavIssues();
  if(list===null)return `<div class="lavSup loading">
    <div class="lavSupHead"><b>Lavarion — short and damaged</b><span>reading the stock records…</span></div></div>`;
  if(!list.length)return '';
  const live=list.filter(g=>!g.quiet), quiet=list.filter(g=>g.quiet);
  const short=list.reduce((t,g)=>t+g.short,0);
  const dmg=list.reduce((t,g)=>t+g.dmg,0);
  const val=list.reduce((t,g)=>t+g.val,0);
  const money=n=>'£'+(n||0).toFixed(2);
  const card=g=>{
    const bits=[];
    if(g.short)bits.push(`<span class="lavTag short">${g.short} short</span>`);
    if(g.dmg)bits.push(`<span class="lavTag dmg">${g.dmg} damaged</span>`);
    if(g.repl)bits.push(`<span class="lavTag repl">${g.repl} replacement${g.repl===1?'':'s'} agreed</span>`);
    return `<div class="lavRow${g.quiet?' quiet':''}">
      <div class="lavWho">
        <b>${esc(g.sup)}</b>
        <span>${g.ref?'order '+esc(g.ref):'no order ref'} · ${g.age===0?'today':g.age+' days ago'}</span>
      </div>
      <div class="lavWhat">
        <div class="lavTags">${bits.join('')}</div>
        ${g.lines.map(x=>`<div class="lavLine"><span>${esc(x.name)}</span>
          <i>${[x.short?x.short+' short':'',x.dmg?x.dmg+' damaged':''].filter(Boolean).join(' · ')}</i></div>`).join('')}
      </div>
      <div class="lavMoney">${val?money(g.val):'—'}
        <span>${g.chased?'chased '+g.chased.slice(8,10)+'/'+g.chased.slice(5,7):'not chased yet'}</span></div>
      <button class="lavGo" onclick="openLavIssue('${String(g.key).replace(/'/g,"\\'")}')" title="Open this issue — evidence, supplier log and how it ends">Open</button>
    </div>`;
  };
  return `<div class="lavSup">
    <div class="lavSupHead">
      <b>Lavarion — short and damaged</b>
      <span>${list.length} supplier conversation${list.length===1?'':'s'}${short?` · ${short} short`:''}${dmg?` · ${dmg} damaged`:''}${val?` · ${money(val)}`:''}</span>
      ${live.length?`<span class="lavChip">${live.length} need${live.length===1?'s':''} you</span>`:'<span class="lavChip ok">all actioned</span>'}
    </div>
    <div class="lavSupNote" style="color:var(--text2);font-size:11.5px;font-weight:600;line-height:1.55;">Damaged stock is <b style="color:var(--text);">always</b> raised, whatever it is worth. Short units stay owed until the money
      is back or a replacement is agreed — agreeing a replacement moves the line to the bottom and stops it being chased.</div>
    ${live.map(card).join('')}
    ${quiet.length?`<div class="lavQuietHead">Actioned — replacement agreed, nothing to do today</div>${quiet.map(card).join('')}`:''}
  </div>`;
}
/* ── THE NOW QUEUE ─────────────────────────────────────────────────────────
   Jack, 15 Aug: "a small TO-DO / ACTION CENTRE at the top… WHAT NEEDS DOING
   NOW?" Everything that was scattered across five panels — chases, claims,
   supplier problems, jobs, and the rows Jack sent back — merges into ONE list,
   ordered by band then by age. Oldest first inside every band: his standing
   rule is that age decides, never value.
   Nothing here invents state. Every card reads existing fields, and every
   button calls a handler that already exists. */
const NOW_BANDS={
  refund:  {n:1,label:'REFUND WINDOW',col:'#ef4444',why:'the claim window is closing'},
  sentback:{n:2,label:'SENT BACK',   col:'#f59e0b',why:'Jack has sent this back to you'},
  answered:{n:2,label:'ANSWERED',    col:'#f59e0b',why:'Jack has answered your question'},
  arrived: {n:3,label:'ARRIVED — CLOSE IT OFF',col:'#22c55e',why:'it turned up and needs closing off'},
  chase:   {n:4,label:'CHASE',       col:'var(--accent)',why:'still outstanding with the supplier'},
  supplier:{n:5,label:'SUPPLIER',    col:'#38bdf8',why:'a Lavarion delivery problem'},
  job:     {n:6,label:'JOBS',        col:'#94a3b8',why:'a job from Jack'},
  sorted:  {n:9,label:'SORTED',      col:'#4ade80',why:'done — in the 24-hour undo window'},
};
/* Grey-out-until-refresh: Jack asked that an actioned card does not vanish
   under the cursor. Ids collected here render dimmed and inert; the next full
   page load starts clean. Session-only, nothing stored. */
let _nowDone=new Set(), _nowSkip=new Set();
/* Focus mode. Jack's "work through these one by one". A cursor over the same
   array — no new state on any row, so leaving it changes nothing.
   The position survives a refresh (his Q4) via sessionStorage: she can reload
   or be interrupted without losing her place. Session-only on purpose — a new
   day should start at the top. */
let _focus=false, _focusIx=0;
try{const st=JSON.parse(sessionStorage.getItem('nowFocus')||'null');
  if(st){_focus=!!st.on;_focusIx=st.ix||0;
    (st.done||[]).forEach(x=>_nowDone.add(x));(st.skip||[]).forEach(x=>_nowSkip.add(x));}}catch(e){}
function _focusSave(){
  try{sessionStorage.setItem('nowFocus',JSON.stringify({on:_focus,ix:_focusIx,
    done:[..._nowDone],skip:[..._nowSkip]}));}catch(e){}
}
function focusStart(){_focus=true;_focusIx=0;_focusSave();renderAdmin();}
function focusExit(){_focus=false;_focusSave();renderAdmin();}
function focusNext(){_focusIx++;_focusSave();renderAdmin();}
function focusSkip(id){_nowSkip.add(String(id));_focusSave();renderAdmin();}
function nowMarkDone(id){
  _nowDone.add(String(id));
  /* In focus mode an action means "finished with this one" — move on rather
     than leaving her looking at a greyed-out card. */
  if(_focus)_focusIx++;
  _focusSave();
  renderAdmin();
}

/* days since anyone last touched this row — the staleness engine */
function _lastTouch(r){
  const c=[r.notesAt,r.resolution&&r.resolution.at,r.qtyFix&&r.qtyFix.at]
    .filter(Boolean).map(x=>new Date(x).getTime()).filter(n=>!isNaN(n));
  if(c.length)return Math.max.apply(null,c);
  const d=_rowDateObj(r); return d?d.getTime():Date.now();
}
function _rowDateObj(r){
  if(!r.date)return null;
  const[dd,mm]=String(r.date).split('/');
  if(!dd||!mm)return null;
  const t=new Date();
  let d=new Date(`${t.getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
  if(isNaN(d))return null;
  if(d>t)d.setFullYear(d.getFullYear()-1);
  return d;
}
const _daysSince=ms=>Math.floor((Date.now()-ms)/864e5);

/* Rows whose claim window has already gone with nothing received are not work
   — nobody can chase them and the money is already lost. They are history that
   was never filed. This finds them; clearBacklog() files them. */
function _deadBacklog(){
  return rows.filter(r=>{
    if(r.archived||r.resolution)return false;
    const left=refundLeft(r.date,r);
    if(left===null||left>=0)return false;               // window still open
    const units=parseInt(r.exp||r.ship||0)||0;
    const got=parseInt(r.rcvd)||0;
    return units>0&&got===0;                            // nothing ever arrived
  });
}
async function clearBacklog(){
  const dead=_deadBacklog();
  if(!dead.length){toast('Nothing to clear — no expired rows with nothing received');return;}
  const money=dead.reduce((a,r)=>{
    const u=(parseInt(r.exp||r.ship||0)||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0);
    return a+Math.max(0,u)*(parseSKU(r.sku).cogs||0);},0);
  const oldest=Math.max.apply(null,dead.map(r=>{const l=refundLeft(r.date,r);return l===null?0:-l;}));
  if(!confirm(
`Clear ${dead.length} row${dead.length===1?'':'s'} off the active list?

Every one of these is past the ${REFUND_DAYS}-day claim window with nothing received — the oldest by ${oldest} days. Together they hold ${fmtGBP2(money)}.

They are ARCHIVED, not deleted: still on Shipments, in the audit log, and under Show Archived. Each is stamped "written off — claim window had already closed" so the history says why.

This is a one-off tidy-up. New rows are unaffected.`))return;
  const stamp=new Date().toISOString(), who=_who();
  dead.forEach(r=>{
    r.resolution={state:'approved',what:'written-off',by:who,at:stamp,
      approvedBy:who,approvedAt:stamp,
      note:'Backlog tidy-up — the claim window had already closed with nothing received.',
      followUps:[]};
    r.archived=true; r._dirty=true;
  });
  logAudit('Backlog cleared',`${dead.length} rows written off — ${fmtGBP2(money)}`);
  try{await _saveMany(dead,async r=>{try{await saveRow(r);}catch(e){}},6,'Filing the backlog');}
  catch(e){for(const r of dead){try{await saveRow(r);}catch(_){}}}
  toast(`${dead.length} filed into history — the list is clear`,'ok');
  renderAdmin();try{renderPrep();renderDashboard();}catch(e){}
}
function _allAdminRows(){
  const out=_adminItems().map(i=>Object.assign({kind:'transit'},i));
  /* Lavarion shortages and damage — one row per supplier conversation */
  try{
    (_lavIssues(true)||[]).filter(g=>!g.quiet&&!lavCleared()[String(g.key)]).forEach(g=>{
      /* Jack, 10 Sep: Lavarion is his first — a shortage reaches Sarah only as
         a job he has written, with his note as the brief. */
      if(!g.toSarah)return;
      let _ts={};try{_ts=JSON.parse(g.toSarah||'{}');}catch(e){}
      const _last=(g.log&&g.log.length)?g.log[g.log.length-1]:null;
      let _tj=null;try{_tj=g.toJack?JSON.parse(g.toJack):null;}catch(e){_tj={at:''};}
      out.push({kind:'lav',rid:'lav:'+g.key,lavKey:g.key,
        prod:g.lines.map(x=>x.name).join(', '),sku:'',asin:'',
        sup:g.sup,oid:g.ref||'',acct:'',date:'',
        units:g.short+g.dmg,got:0,cancelled:0,outstanding:g.short+g.dmg,
        value:g.val,days:g.age||0,sev:3,col:'#38bdf8',
        lavShort:g.short,lavDmg:g.dmg,
        reason:[g.short?g.short+' short':'',g.dmg?g.dmg+' damaged':''].filter(Boolean).join(' · '),
        src:'Lavarion check-in',
        sentBack:{rejectedBy:_ts.by||'Jack',rejectNote:_ts.note||'',at:_ts.at||''},backAt:_ts.at||'',jobNote:_ts.note||'',
        photos:/^https?:\/\//.test((g.evid||'').trim())?(g.evid||'').trim():'',
        waiting:_tj?{state:'asked',at:_tj.at||''}:null,
        lastLog:_last?{what:_last.msg||'',by:_last.by||'',at:_last.at||''}:null,
        notes:'',srcNote:g.note||'',
        chased:g.chased});
    });
  }catch(e){}
  /* Overdue Lavarion deliveries — a supplier who has not delivered is hers to
     chase, the same as any late prep row. It was only ever a banner. */
  try{
    ((window.LV3&&LV3.lavLateList)?LV3.lavLateList():[]).forEach(g=>{
      /* Jack, 9 Sep: a late Lavarion order goes straight to HIM. It reaches
         Sarah only as a job he has written — with his note as the brief. */
      if(!g.toSarah)return;
      let _ts={};try{_ts=JSON.parse(g.toSarah||'{}');}catch(e){}
      const _lid='adLD_'+String(g.key).replace(/[^a-z0-9]/gi,'_');
      out.push({kind:'lavlate',rid:'lavlate:'+g.key,lavLateKey:g.key,
        sentBack:{rejectedBy:_ts.by||'Jack',rejectNote:_ts.note||'',at:_ts.at||''},backAt:_ts.at||'',jobNote:_ts.note||'',
        prod:g.name,sku:'',asin:'',sup:g.sup,oid:g.oid,acct:g.acct||'',
        date:'',units:g.owed,got:0,cancelled:0,outstanding:g.owed,
        value:g.cost||0,days:g.days,sev:3,col:'#c084fc',
        reason:g.eta?('due '+g.eta+' — nothing booked in'):'past its window — nothing booked in',
        src:'Lavarion order',notes:'',srcNote:'',left:null,
        /* Jack, 8 Sep: "Alibaba stuff — she sends it to me and most of the time
           I'll send it back with an updated date." Same two-sides rule. */
        waiting:null,
        acts:`<input type="date" id="${_lid}" class="jkAnsDate" min="2024-01-01" max="2030-12-31" title="If the supplier gave you a date, put it here — it clears everywhere" onkeydown="if(event.key==='Enter'){event.preventDefault();lavLateNewDate('${String(g.key).replace(/'/g,"\\'")}',this.value);}">
          <button class="tfuWork" onclick="lavLateNewDate('${String(g.key).replace(/'/g,"\\'")}',document.getElementById('${_lid}').value)" title="The order's window moves to this date and it stops being late on every page">New date</button>
          <button class="tfuAsk" onclick="lavLateDoneBox('${String(g.key).replace(/'/g,"\\'")}',this)" title="Job done — one line on what you found, and it goes back to Jack">Done &mdash; back to Jack</button>
          <button class="tfuMore" onclick="LV3.openDeliveries&&LV3.openDeliveries()" title="Open the delivery">Open the order</button>`});
    });
  }catch(e){}
  /* Claims she owns */
  try{
    claims.filter(c=>{
      if(c.archived||c.cst==='Resolved')return false;
      const own=(c.owner)||('VA');
      /* Hers — plus anything SHE sent to Jack, which stays visible on her page
         as a grey waiting row instead of vanishing (his 16 Aug rule). Gated
         claims that simply default to Jack were never hers and stay off. */
      return own!=='Jack'||!!c.sentToJack;
    }).forEach(c=>{
      const t=new Date(c.created_at||c.raisedAt||c.raised||Date.now()).getTime();
      const _cl=(c.log||[]).slice(-1)[0]||null;
      /* Jack, 4 Sep: "it should merge as it's one issue to one supplier." The
         same order was listed twice — once as the late delivery, once as the
         claim raised against it — so the same job could be chased twice by two
         people. If the claim points at a row already in this queue, it rides on
         that row instead of creating a second one. */
      const _host=out.find(x=>x.kind==='transit'&&c.prepRowId&&String(x.rid)===String(c.prepRowId));
      if(_host){
        _host.claimId=c.id;_host.claimC=c;_host.claimVal=c.claimValue||0;
        _host.claimType=c.issT||'Claim';_host.claimState=c.cst||'';
        if((c.claimValue||0)>(_host.value||0))_host.value=c.claimValue;
        return;
      }
      out.push({kind:'claim',rid:'claim:'+c.id,claimId:c.id,claimC:c,
        prod:c.prod||c.sku||'(claim)',sku:c.sku||'',asin:c.asin||'',
        sup:c.sup||'',oid:c.oid||'',acct:c.acct||'',
        units:c.dif||0,got:0,cancelled:0,outstanding:c.dif||0,
        value:c.claimValue||0,days:Math.floor((Date.now()-t)/864e5),sev:2,col:'#fbbf24',
        reason:(c.issT||'Issue')+(c.cst?' · '+c.cst:''),
        /* Jack: "If the UK employee has specifically written something
           explaining the problem, I want Sarah to be able to see that useful
           context without having to go digging." The note typed when the issue
           was raised at check-in travels with the row. */
        src:'Check-in'+(c.raisedBy?' — '+c.raisedBy:''),
        srcNote:(c.notes||c.vaNote||'').trim(),
        photos:(c.discordLink||'').trim(),
        waiting:c.sentToJack?{state:'asked',at:c.sentToJack.at||''}:null,
        lastLog:_cl?{what:_cl.msg||'',by:'',at:_cl.t||''}:null,
        notes:''});
    });
  }catch(e){}
  /* Jobs Jack sent over */
  try{
    /* Jack, 4 Sep: "shouldn't it all be done on one row, not more tasks?"
       Right — closing ONE issue was spawning THREE rows, so finishing work made
       her queue longer. The follow-ups belong to the item, not beside it: they
       are grouped onto a single row as a checklist, and the row clears once the
       last one is ticked.
       (Earlier bug in the same place: `prod:a.what` — a field that does not
       exist on a job — fell through to `a.detail`, printing the whole
       instruction paragraph where the product name goes.) */
    const _byRow={};
    (typeof VA_ACTIONS!=='undefined'?VA_ACTIONS:[]).filter(a=>!a.done).forEach(a=>{
      const k=String(a.rid||a.id);(_byRow[k]=_byRow[k]||[]).push(a);});
    /* Jack, 9 Sep: "Raise a claim for the loss" and "Raise the claim with the
       supplier or Amazon before the window shuts" were both on the list. The
       add-time guard (8 Sep) stops new pairs; rows written before it still
       carry both. Fold them at render — one line, Done ticks every copy. */
    const _jn=x=>String(x||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    /* the short step name and its long wording are the same job */
    const _jk=t=>/^raise (a|the) claim/.test(t)?'claim':/purchase sheet/.test(t)?'sheet':/outstanding (quantity|units)/.test(t)?'outstanding':/order (as )?cancelled/.test(t)?'cancelled':/remove from prep sheet|comes off the active prep sheet/.test(t)?'prep':'';
    Object.keys(_byRow).forEach(k=>{
      const raw=_byRow[k],a=raw[0];
      const list=[];raw.forEach(x=>{const t=_jn(x.task),tk=_jk(t);
        const hit=list.find(j=>{const o=_jn(j.task);return o===t||(tk&&tk===_jk(o))||(o.length>12&&t.length>12&&(o.includes(t)||t.includes(o)));});
        if(hit){hit.ids.push(x.id);if(String(x.task||'').length>String(hit.task||'').length)hit.task=x.task||'';}
        else list.push({id:x.id,ids:[x.id],task:x.task||''});});
      const t=new Date(a.at||Date.now()).getTime();
      const by=String(a.by||'').trim();
      out.push({kind:'job',rid:'job:'+k,jobId:a.id,jobList:list,
        prod:a.prod||a.task||'Job',sku:a.sku||'',asin:a.asin||'',
        sup:a.sup||'',oid:a.oid||'',acct:'',units:0,got:0,cancelled:0,outstanding:0,
        value:0,days:Math.floor((Date.now()-t)/864e5),sev:1,col:'#94a3b8',
        jobBy:by,src:/^jack/i.test(by)?'From Jack':(by?'Follow-up · '+by:'Follow-up'),
        srcNote:'',reason:list.length===1?(a.task||'Job'):list.length+' things to finish off',
        notes:a.detail||''});
    });
  }catch(e){}
  /* The sort belongs HERE, on the merged list — sorting only the transit rows
     left every supplier shortage and claim trailing at the bottom regardless
     of how new or expensive it was. */
  const dir=_tfuDir;
  const key={
    priority:i=>_prioScore(i),
    refund:i=>{const L=refundLeft(i.date,i);return (L!=null&&L>=0)?L:9999;},
    days:i=>-i.days, units:i=>-i.units, outstanding:i=>-i.outstanding,
    product:i=>(i.prod||'').toLowerCase(), supplier:i=>(i.sup||'').toLowerCase(),
    due:i=>i.expDate||'9999', flagged:i=>-i.sev,
    kind:i=>_typeOf(i)[0]
  }[_tfuSort]||(i=>0);
  out.sort((a,b)=>{
    /* a question from the warehouse is a two-minute answer with someone
       waiting on it — top, whatever the sort (Jack, 4 Sep) */
    if(!!a.query!==!!b.query)return a.query?-1:1;
    /* then whatever Jack has just answered — she is unblocked on those and he
       is waiting to see them moved on. Newest answer first (Jack, 8 Sep). */
    if(_tfuSort==='priority'&&!!a.withBecki!==!!b.withBecki)return a.withBecki?1:-1;
    if(_tfuSort==='priority'&&!!a.sentBack!==!!b.sentBack)return a.sentBack?-1:1;
    if(_tfuSort==='priority'&&a.sentBack&&b.sentBack)return String(b.backAt||'').localeCompare(String(a.backAt||''));
    const ka=key(a),kb=key(b);
    if(ka<kb)return -1*dir; if(ka>kb)return 1*dir;
    return (b.sev||0)-(a.sev||0)||(b.days||0)-(a.days||0);
  });
  return out;
}
/* ── ISSUE TYPES, Jack's taxonomy (16 Aug): the label says WHAT IS WRONG, not
   where it came from — the source line already covers that. "Missing at a UK
   check-in" and "short at Lavarion" are the same real-world event, so they
   share a label. */
function _typeOf(i){
  if(i.kind==='job')return['JOB','#94a3b8','A job Jack sent over'];
  if(i.kind==='transit'&&i.query)return['QUERY','#38bdf8','The warehouse asked whether more is on the way — answer it here, or send it to Jack'];
  if(i.kind==='transit'&&i.partShip)return['PART SHIPPED','#fb923c','Some went out and the rest never followed — still on the shelf, or sent under another SKU?'];
  if(i.kind==='transit'&&i.partOverdue)return['PART ARRIVED','#fb923c','Some of it arrived and the rest has not followed in time — more coming, or is it missing?'];
  if(i.kind==='transit')return['LATE','#f87171','Still in transit past when it should have landed — needs chasing'];
  if(i.kind==='lavlate')return['JOB FROM JACK','#f87171','A late Lavarion order — Jack has looked at it and needs this from you'];
  if(i.kind==='lav'){
    if(i.lavDmg&&i.lavShort)return['MISSING + DMG','#fb7185','Units short AND damaged at check-in'];
    if(i.lavDmg)return['DAMAGED','#fb7185','Stock arrived damaged — the supplier has to put it right'];
    return['MISSING','#fbbf24','Fewer units arrived than were bought'];
  }
  const t=(i.claimC&&i.claimC.issT)||'';
  if(/damag/i.test(t))return['DAMAGED','#fb7185','Stock arrived damaged — the supplier has to put it right'];
  if(/incorrect|wrong/i.test(t))return['WRONG ITEM','#fb923c','The wrong product arrived'];
  if(/gated/i.test(t))return['GATED','#c084fc','Cannot be sold on the account — needs a decision'];
  if(/not arrived/i.test(t))return['NOT ARRIVED','#f87171','The order never turned up'];
  return['MISSING','#fbbf24','Fewer units arrived than were bought'];
}
function nowQueue(){
  const out=[];
  const seen=new Set();
  const push=o=>{const k=o.band+':'+o.id;if(seen.has(k))return;seen.add(k);out.push(o);};

  rows.forEach(r=>{
    const id=r.uuid||r.id;
    const res=r.resolution;
    /* P1 — Jack has acted. Deliberately NOT gated on the chase rules: a row he
       sent back must reach her whether or not it still counts as "late". */
    if(res&&res.state==='rejected'&&!res.acked){
      push({band:res.kind==='check'?'answered':'sentback',id,r,
        title:r.prod||r.sku||'(no name)',
        line:(res.rejectNote||'').trim()||'No note left',
        who:res.rejectedBy||'Jack',
        age:_daysSince(new Date(res.rejectedAt||res.at||Date.now()).getTime())});
      return;
    }
    if(res&&(res.state==='proposed'||res.state==='asked'))return;   // with Jack
    if(r.archived)return;
  });

  /* P2-P4 come off the existing chase engine, so every exclusion Sarah already
     relies on (snoozed, sub-save, settled, sent) still applies untouched. */
  _adminItems().forEach(i=>{
    const r=rows.find(x=>(x.uuid||x.id)===i.rid); if(!r)return;
    /* sorted-within-24h rides at the very bottom, grey, undoable */
    if(i.sortedGrace){push({band:'sorted',id:i.rid,r,title:i.prod||i.sku||'(no name)',
      line:'Sorted '+(Math.round((Date.now()-i.sortedAt)/36e5)||1)+'h ago — undo is one press away for 48 working hours',
      age:-(Date.now()-i.sortedAt)});return;}
    /* waiting on Jack stays exactly where it was, blue and locked */
    if(i.waiting){push({band:i.origBand||'chase',id:i.rid,r,waiting:true,
      title:i.prod||i.sku||'(no name)',
      sup:i.sup,oid:i.oid,acct:i.acct,units:i.units,got:i.got,cancelled:i.cancelled,
      outstanding:i.outstanding,value:i.value||0,
      line:(r.resolution&&r.resolution.state==='asked')
        ? 'Sent to Jack to check — has it arrived?'
        : 'Close-off sent to Jack for approval',
      age:0,askedAt:(r.resolution||{}).askedAt||(r.resolution||{}).at});return;}
    const left=refundLeft(r.date,r);
    const stale=_daysSince(_lastTouch(r));
    const base={id:i.rid,r,title:i.prod||i.sku||'(no name)',
      sup:i.sup,oid:i.oid,acct:i.acct,units:i.units,got:i.got,
      cancelled:i.cancelled,outstanding:i.outstanding,value:i.value||0,
      stale,left};
    if(left!==null&&left>=0&&left<=REFUND_DAYS/2)push({...base,band:'refund',age:REFUND_DAYS-left,
      line:left===0
        ? `Last day to claim — the window shuts tonight`
        : left<=7
        ? `Only ${left} day${left===1?'':'s'} left to claim — this is how the last lot were lost`
        : `${left} days left to claim — worth doing now while there is still time`});
    else if(r.delivered==='Yes'&&!r.resolution)push({...base,band:'arrived',age:stale,
      line:'Marked as arrived — close it off so it leaves the queue'});
    else push({...base,band:'chase',age:stale,
      line:i.reason||'Needs following up'});
  });

  /* ── LAVARION DELIVERY PROBLEMS ──────────────────────────────────────────
     NOW_BANDS has carried a 'supplier' band ("a Lavarion delivery problem")
     since it was written and nothing ever pushed into it, so the band was
     unreachable and every shortage and damaged unit lived only in the merged
     table below the queue — the part of the page nobody works from.
     Jack, 18 Aug: Sarah owns ALL of it, shortages and damage alike; she gets
     the photos from Becki. So there is no owner routing here on purpose.
     `quiet` groups (settled/written off) stay out, and anything already handed
     to Jack keeps its blue waiting state exactly like a prep row. */
  try{
    const _lav=(typeof _lavIssues==='function')?_lavIssues(true):null;
    (_lav||[]).forEach(g=>{
      if(g.quiet)return;
      const both=[g.short?g.short+' short':'',g.dmg?g.dmg+' damaged':''].filter(Boolean).join(' · ');
      push({band:'supplier',id:'lav:'+g.key,lav:g,
        title:(g.lines||[]).map(x=>x.name).join(', ')||'(delivery)',
        sup:g.sup,oid:g.ref||'',units:(g.short||0)+(g.dmg||0),
        outstanding:(g.short||0)+(g.dmg||0),value:g.val||0,
        waiting:!!g.toJack,
        line:g.toJack?'Sent to Jack — waiting on him'
             :g.dmg&&!g.short?both+' — get the photos off Becki and raise it'
             :both+(g.chased?' — chased, waiting on them':' — nobody has asked yet'),
        stale:g.age||0,age:g.age||0});
    });
  }catch(e){}

  /* claims Sarah owns */
  claims.forEach(c=>{
    if(c.archived||c.cst==='Resolved')return;
    if(((c.owner)||('VA'))==='Jack')return;
    const t=new Date(c.created_at||c.raised||Date.now()).getTime();
    push({band:'chase',id:'claim:'+c.id,claim:c,title:c.prod||c.sku||'(claim)',
      line:(c.issT||'Issue')+' — '+(c.cst||'open'),stale:_daysSince(t),age:_daysSince(t)});
  });

  /* jobs from Jack */
  (typeof VA_ACTIONS!=='undefined'?VA_ACTIONS:[]).forEach(a=>{
    if(a.done)return;
    const t=new Date(a.at||Date.now()).getTime();
    push({band:'job',id:'job:'+a.id,job:a,title:a.what||a.detail||'Job',
      line:a.detail||'',stale:_daysSince(t),age:_daysSince(t)});
  });

  return out.sort((a,b)=>{
    const ba=NOW_BANDS[a.band].n, bb=NOW_BANDS[b.band].n;
    if(ba!==bb)return ba-bb;
    return (b.age||0)-(a.age||0);      // oldest first inside the band
  });
}
/* One card, one anatomy, every band — so the eye learns it once. House style:
   §2 card chrome, §3 type roles, §5 tint chips, §6 small table CTAs. */
function nowCard(it,big){
  const B=NOW_BANDS[it.band];
  const done=_nowDone.has(String(it.id));
  const chip=(txt,col)=>`<span style="font-size:10.5px;font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:5px;color:${col};background:${col}1f;border:1px solid ${col}55;white-space:nowrap;">${esc(txt)}</span>`;
  const btn=(txt,act,col)=>`<button data-now="${esc(act)}" data-id="${esc(String(it.id))}" style="padding:5px 11px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;color:${col};background:${col}1f;border:1px solid ${col}66;">${esc(txt)}</button>`;
  const r=it.r;
  const nums=r?`<span style="font:800 13px var(--num);font-variant-numeric:tabular-nums;color:var(--text);">${it.units||0}</span><span style="color:var(--text3);"> ordered · </span>
      <span style="font:800 13px var(--num);font-variant-numeric:tabular-nums;color:#4ade80;">${it.got||0}</span><span style="color:var(--text3);"> in</span>
      ${it.cancelled?`<span style="color:var(--text3);"> · </span><span style="font:800 13px var(--num);color:#94a3b8;">${it.cancelled}</span><span style="color:var(--text3);"> cancelled</span>`:''}
      ${it.outstanding?`<span style="color:var(--text3);"> · </span><span style="font:800 13px var(--num);color:#fbbf24;">${it.outstanding}</span><span style="color:var(--text3);"> still out</span>`:''}`:'';
  const meta=[it.sup,it.oid,it.acct].filter(Boolean).map(esc).join(' · ');
  /* the nag: nothing should sit for days with nobody touching it */
  /* Was ">=4 days" flat, which lit up all 20 rows of a 124-day backlog — when
     everything shouts, nothing does. Only flag a row that is still worth
     chasing AND has gone quiet; anything past the window says so plainly. */
  const expired=it.r?refundLeft(it.r.date):null;
  const stale=it.band==='job'?'':
    (expired!==null&&expired<0) ? chip('CLAIM WINDOW GONE','#94a3b8')
    : ((it.stale||0)>=7 ? chip(`NO CONTACT FOR ${it.stale} DAYS`,'#fbbf24') : '');
  const rid=it.r?(it.r.uuid||it.r.id):null;
  const sel=(field,val,goodVal)=>`<select onchange="setTriage('${rid}','${field}',this.value);"
      style="padding:5px 9px;background:var(--bg);border:1px solid ${val===goodVal?'rgba(74,222,128,.5)':'var(--border2)'};color:${val===goodVal?'#4ade80':'var(--text)'};border-radius:5px;font-size:11.5px;font-weight:700;cursor:pointer;">
      ${['','Yes','No'].map(o=>`<option value="${o}" ${val===o?'selected':''}>${o||'—'}</option>`).join('')}</select>`;
  const lbl=t=>`<span style="font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;">${t}</span>`;
  const isAmz=it.r&&typeof _jackSupplier==='function'&&_jackSupplier(it.sup||it.r.sup);
  let actions='', guide='';
  if(it.waiting){
    /* locked, blue, in place — her turn is over until Jack answers */
    actions=`<span style="font-size:11px;font-weight:800;color:#93c5fd;">Nothing for you to do — it comes back here the moment Jack answers.</span> `+btn('View in Prep','open','#60a5fa');
  }
  else if(it.band==='sorted'){actions=btn('Undo — bring it back','undo','#94a3b8');}
  else if(it.band==='sentback'||it.band==='answered'){
    /* Jack has answered. If it arrived, the next step is right here. */
    const saidArrived=/arrived[^a-z]*yes|yes[^a-z]*arrived/i.test(it.line||'');
    guide=saidArrived||it.r&&it.r.delivered==='Yes'
      ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 2px;">${lbl('Arrived ✓ — wrong SKU?')} ${sel('wrongSku',it.r?it.r.wrongSku:'','Yes')} <span style="font-size:11px;color:var(--text3);">Yes → press Sorted and close it yourself · No → send it to Jack, the stock hunt starts</span></div>`
      :'';
    actions=btn('Got it','ack','#4ade80')+btn('Sorted — close it off','close','#4ade80')+btn('Send to Jack','ask','#60a5fa')+btn('View in Prep','open','#94a3b8');
  }
  else if(it.band==='refund'||it.band==='chase'||it.band==='arrived'){
    const d=it.r?it.r.delivered:'';
    const w=it.r?it.r.wrongSku:'';
    if(d==='Yes'&&w==='Yes'){
      guide=`<div style="margin:6px 0 2px;font-size:11.5px;font-weight:700;color:#4ade80;">Arrived ✓ · wrong SKU ✓ — you know this one. Press Sorted and write it up.</div>`;
      actions=btn('Sorted','close','#4ade80')+btn('View in Prep','open','#94a3b8');
    }else if(d==='Yes'&&w==='No'){
      guide=`<div style="margin:6px 0 2px;font-size:11.5px;font-weight:700;color:#f87171;">Arrived but NOT wrong SKU — so where has the stock gone? Send it to Jack and hunt it together.</div>`;
      actions=btn('Send to Jack — stock missing','ask','#ef4444')+btn('View in Prep','open','#94a3b8');
    }else if(d==='Yes'){
      guide=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 2px;">${lbl('Arrived ✓ — wrong SKU?')} ${sel('wrongSku',w,'Yes')} <span style="font-size:11px;color:var(--text3);">your usual check — did it go out under another listing?</span></div>`;
      actions=btn('Sorted','close','#4ade80')+btn('View in Prep','open','#94a3b8');
    }else if(isAmz){
      guide=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 2px;">${lbl('Has it arrived?')} <span style="font-size:11.5px;font-weight:700;color:#93c5fd;">Amazon order — you can't check this one. Jack can.</span></div>`;
      actions=btn('Send to Jack — has it arrived?','ask','#60a5fa')+btn('Chased today','chased','#94a3b8')+btn('Sorted','close','#4ade80');
    }else{
      guide=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 2px;">${lbl('Has it arrived?')} ${sel('delivered',d,'Yes')} <span style="font-size:11px;color:var(--text3);">yours to check — emails, order history, tracking, or ask the supplier</span></div>`;
      actions=btn('Chased today','chased','#60a5fa')+btn('Sorted','close','#4ade80')+btn('View in Prep','open','#94a3b8');
    }
  }
  else if(it.band==='supplier')actions=btn('Open in Lavarion','lav','#38bdf8');
  else if(it.band==='job')actions=btn('Done','job','#4ade80');
  const spine=it.waiting?'#60a5fa':B.col;
  return `<div style="border-left:3px solid ${spine};background:${it.waiting?'rgba(96,165,250,.05)':(it.band==='sorted'?'rgba(148,163,184,.05)':(big?'var(--bg3)':'var(--bg2)'))};border:1px solid ${it.waiting?'rgba(96,165,250,.3)':'var(--border)'};border-left-width:${big?'4px':'3px'};border-radius:8px;padding:${big?'16px 18px':'11px 14px'};margin-bottom:8px;${done?'opacity:.35;pointer-events:none;':''}${it.band==='sorted'?'opacity:.6;':''}">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:5px;">
      ${chip(B.label,B.col==='var(--accent)'?'#f59e0b':B.col)}
      <span style="font-size:12.5px;font-weight:700;color:var(--text);flex:1;min-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(it.title)}">${esc(it.title)}</span>
      ${it.waiting?chip('WAITING ON JACK'+(it.askedAt?' · '+Math.max(0,Math.floor((Date.now()-new Date(it.askedAt).getTime())/864e5))+'d':''),'#60a5fa'):stale}
      ${done?chip('DONE','#4ade80'):''}
    </div>
    ${it.line?`<div style="font-size:11.5px;font-weight:600;color:var(--text2);line-height:1.5;margin-bottom:5px;">${esc(it.line)}${it.who?` <span style="color:var(--text3);">— ${esc(it.who)}</span>`:''}</div>`:''}
    ${meta?`<div style="font-size:11px;color:var(--text3);margin-bottom:5px;">${meta}</div>`:''}
    ${nums?`<div style="font-size:11px;margin-bottom:8px;">${nums}${it.value?`<span style="float:right;font:800 14px var(--num);font-variant-numeric:tabular-nums;color:#fbbf24;">${fmtGBP2(it.value)}</span>`:''}</div>`:''}
    ${guide||''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${actions}</div>
  </div>`;
}
/* One press to retire the dead backlog, stating plainly what it is. Shown only
   while there IS one, so it disappears for good once she has used it. */
function backlogStrip(){
  const dead=_deadBacklog();
  if(!dead.length)return '';
  const money=dead.reduce((a,r)=>{
    const u=(parseInt(r.exp||r.ship||0)||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0);
    return a+Math.max(0,u)*(parseSKU(r.sku).cogs||0);},0);
  return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:14px;border-radius:11px;background:rgba(148,163,184,.10);border:1px solid rgba(148,163,184,.45);flex-wrap:wrap;">
    <div style="width:9px;height:9px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 4px rgba(148,163,184,.15);flex:0 0 auto;"></div>
    <div style="min-width:0;flex:1;">
      <div style="font-size:12.5px;font-weight:800;color:#cbd5e1;">${dead.length} old row${dead.length===1?'':'s'} can be filed away</div>
      <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:2px;">Past the ${REFUND_DAYS}-day claim window with nothing received — ${fmtGBP2(money)}. Nobody can chase these now. Filing them clears the list without deleting anything.</div>
    </div>
    <button data-now="backlog" data-id="all" style="padding:6px 14px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:7px;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap;">File them away</button>
  </div>`;
}
let _showAllTransit=true;
function toggleAllTransit(){_showAllTransit=!_showAllTransit;renderAdmin();}
function transitToggle(){
  const n=_adminItems().length;
  if(!n)return '';
  return `<div style="margin:-6px 0 14px;">
    <button data-now="alltransit" data-id="t" style="padding:5px 12px;background:transparent;border:1px solid var(--border2);color:var(--text3);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">${_showAllTransit?'Hide the full table':'Show the full table ('+n+') — every row, sort and export'}</button>
  </div>`;
}
function nowQueuePanel(){
  const q=nowQueue().filter(x=>!_nowSkip.has(String(x.id)));
  const live=q.filter(x=>!_nowDone.has(String(x.id)));
  if(!q.length)return `<div style="background:var(--bg2);border:1px solid rgba(52,211,153,.35);border-radius:10px;padding:26px;text-align:center;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:800;color:#34d399;">Nothing waiting — you are completely clear.</div>
      <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:4px;">Anything new from the sheet or from Jack will appear here on its own.</div>
    </div>`;
  const hdr=(right)=>`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 15px;background:rgba(255,255,255,.02);border-bottom:1px solid var(--border);">
      <span style="font-size:13px;font-weight:800;color:var(--text);">What needs doing now</span>
      <span style="font-size:11px;font-weight:800;padding:2px 9px;border-radius:9px;background:rgba(255,255,255,.08);color:var(--text);">${live.length}</span>
      ${right}
    </div>`;

  /* ── FOCUS MODE ── one card, full width, act and move on. */
  if(_focus){
    const list=q.filter(x=>!_nowDone.has(String(x.id)));
    if(_focusIx>=list.length){
      return `<div style="background:var(--bg2);border:1px solid rgba(52,211,153,.35);border-left:4px solid #34d399;border-radius:10px;margin-bottom:16px;overflow:hidden;">
        ${hdr('')}
        <div style="padding:34px 20px;text-align:center;">
          <div style="font-size:15px;font-weight:800;color:#34d399;">That is the lot — you have been through every one.</div>
          <div style="font-size:12px;font-weight:600;color:var(--text2);margin-top:6px;">${_nowDone.size} dealt with${_nowSkip.size?` · ${_nowSkip.size} skipped for now`:''}. Press Checked at the top when you are happy.</div>
          <button data-now="exit" data-id="x" style="margin-top:14px;padding:8px 18px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:7px;font-size:12px;font-weight:800;cursor:pointer;">Back to the list</button>
        </div></div>`;
    }
    const it=list[_focusIx];
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:10px;margin-bottom:16px;overflow:hidden;">
      ${hdr(`<span style="font-size:11.5px;font-weight:700;color:var(--text2);">${_focusIx+1} of ${list.length}</span>
        <span style="flex:1;"></span>
        <button data-now="skip" data-id="${esc(String(it.id))}" style="padding:5px 12px;background:var(--bg3);border:1px solid var(--border2);color:var(--text3);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Skip for now</button>
        <button data-now="exit" data-id="x" style="padding:5px 12px;background:transparent;border:1px solid var(--border2);color:var(--text3);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Exit</button>`)}
      <div style="padding:14px 14px 6px;">${nowCard(it,true)}</div>
    </div>`;
  }

  const shown=q.slice(0,8), rest=q.length-shown.length;
  return `<div style="background:var(--bg2);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:10px;margin-bottom:16px;overflow:hidden;">
    ${hdr(`<span style="font-size:11.5px;font-weight:600;color:var(--text2);flex:1;min-width:150px;">Worked top to bottom — the oldest thing in each group comes first.</span>
      <button data-now="focus" data-id="go" style="padding:7px 16px;background:var(--accent);border:1px solid var(--accent);color:#1a1400;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;">Work through these</button>`)}
    <div style="padding:11px 12px 4px;">
      ${shown.map(x=>nowCard(x)).join('')}
      ${rest>0?`<div style="font-size:11.5px;font-weight:600;color:var(--text3);padding:4px 2px 10px;">…and ${rest} more below the top eight.</div>`:''}
    </div>
  </div>`;
}
/* pointerdown, never click: this panel is rebuilt by realtime traffic and a
   click needs press AND release on the same element (the v20.7 dead-button). */
document.addEventListener('pointerdown',function(e){
  const b=e.target&&e.target.closest?e.target.closest('[data-now]'):null;
  if(!b)return;
  e.preventDefault();
  const act=b.getAttribute('data-now'), id=b.getAttribute('data-id');
  const it=nowQueue().find(x=>String(x.id)===String(id));
  if(!it)return;
  try{
    if(act==='ack'&&it.r&&it.r.resolution){
      it.r.resolution.acked={by:_who(),at:new Date().toISOString()};
      it.r._dirty=true; saveRow(it.r); nowMarkDone(id);
    }else if(act==='open'&&it.r){ openRow&&openRow(it.r.id); }
    else if(act==='close'&&it.r){ openSorted&&openSorted(it.r.id); }
    else if(act==='chased'){
      if(it.claim){adminQuickChase&&adminQuickChase(it.claim.id);}
      else if(it.r){ it.r.notesAt=new Date().toISOString(); it.r.notesBy=_who();
        it.r._dirty=true; saveRow(it.r); }
      nowMarkDone(id);
    }
    else if(act==='job'&&it.job){ doneVaAction&&doneVaAction(it.job.id); nowMarkDone(id); }
    else if(act==='lav'){ goPage('lavarion'); }
    else if(act==='alltransit'){ toggleAllTransit(); }
    else if(act==='ask'&&it.r){ askJackAsk(it.r.uuid||it.r.id); }
    else if(act==='undo'&&it.r){ reopenResolution(it.r.uuid||it.r.id); }
    else if(act==='focus'){ focusStart(); }
    else if(act==='exit'){ focusExit(); }
    else if(act==='skip'){ focusSkip(id); }
  }catch(err){ console.warn('[now]',err); }
});
let _showDone=false;   /* Jack, 5 Sep: the done rows live behind one strip */
function renderAdmin(){
  if(document.hidden||!_pageActive('page-admin')){_dirtyR.admin=true;return;}
  _dirtyR.admin=false;
  const wrap=document.getElementById('adminWrap');
  if(!wrap)return;
  /* Jack, 16 Aug: "the page glitched and took me straight back to the top."
     Answering a triage question rebuilds this whole panel, and a rebuilt DOM
     starts at scroll 0 — so every answer threw her back to row 1. Remember
     where both scrollers were and put them back after the repaint. */
  const _keepPage=window.scrollY||0;
  const _oldSc=wrap.querySelector('.tfuScroll');
  const _keepTbl=_oldSc?{t:_oldSc.scrollTop,l:_oldSc.scrollLeft}:null;
  const _restoreScroll=()=>{
    const sc=wrap.querySelector('.tfuScroll');
    if(sc&&_keepTbl){sc.scrollTop=_keepTbl.t;sc.scrollLeft=_keepTbl.l;}
    if(_keepPage)window.scrollTo(0,_keepPage);
  };
  /* Overdue Lavarion deliveries are Sarah's to chase but live outside her
     table's row types — a banner keeps them on her page without touching the
     table (Jack, 30 Aug: "nothing for Sarah on Becki's action centre"). */
  let _lavLateBanner='';
  try{const n=(typeof LV3!=='undefined'&&LV3.lavLateCount)?LV3.lavLateCount():0;
    if(n)_lavLateBanner=`<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;margin-bottom:10px;border-radius:9px;background:rgba(192,132,252,.08);border:1px solid rgba(192,132,252,.4);">
      <div style="width:8px;height:8px;border-radius:50%;background:#c084fc;flex:none;"></div>
      <div style="min-width:0;"><div style="font-size:12.5px;font-weight:800;color:#c084fc;">${n} Lavarion deliver${n===1?'y is':'ies are'} overdue</div>
        <div style="font-size:11.5px;color:var(--text2);">Past the expected window and not marked short — worth chasing the supplier</div></div>
      <button onclick="goPage('lavarion',null);setTimeout(function(){try{LV3.go('purchases')}catch(e){}},250);" style="margin-left:auto;flex:none;padding:7px 15px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:800;background:#c084fc;border:1px solid #c084fc;color:#12100a;">Open orders</button>
    </div>`;}catch(e){}
  let items=_allAdminRows();
  /* Jack: "filters for customisation and a search bar here". Same shape as the
     Returns toolbar — one search, chips carrying their own counts. */
  const _aq=(_admQ||'').toLowerCase();
  /* Filters follow Jack's taxonomy — by what is WRONG, not by which module the
     issue came out of. */
  items.forEach(i=>{i.typeL=_typeOf(i)[0];});
  const _counts={all:items.length};
  items.forEach(i=>{_counts[i.typeL]=(_counts[i.typeL]||0)+1;});
  _counts.WITHJACK=items.filter(i=>i.waiting).length;
  _counts.WITHBECKI=items.filter(i=>i.withBecki&&!i.waiting).length;
  _counts.AMZCHASE=items.filter(i=>i.waiting&&(i.waiting.what==='amz-claim'||i.waiting.what==='amz-missing')).length;
  _counts.FROMJACK=items.filter(i=>i.sentBack).length;
  if(_aq)items=items.filter(i=>[i.prod,i.sku,i.asin,i.sup,i.oid,i.acct,i.reason,i.notes,i.srcNote,i.src,i.packNote,i.vaNote]
    .filter(Boolean).join(' ').toLowerCase().includes(_aq));
  if(_admKind==='WITHJACK')items=items.filter(i=>i.waiting);
  else if(_admKind==='WITHBECKI')items=items.filter(i=>i.withBecki&&!i.waiting);
  else if(_admKind==='AMZCHASE')items=items.filter(i=>i.waiting&&(i.waiting.what==='amz-claim'||i.waiting.what==='amz-missing'));
  else if(_admKind==='FROMJACK')items=items.filter(i=>i.sentBack);
  else if(_admKind!=='all')items=items.filter(i=>i.typeL===_admKind);
  const openIssues=claims.filter(c=>c.cst&&c.cst!=='Resolved');

  const cUrgent=items.filter(i=>i.ta==='Urgent — Chase Now').length;
  const cLate=items.filter(i=>i.isStuck||i.ta==='Late — Needs Chasing').length;
  const cDelay=items.filter(i=>['Delayed','Chasing Supplier','Awaiting Update'].includes(i.ta)&&!i.isStuck).length;
  const lateValue=items.reduce((a,i)=>a+(i.value||0),0);

  const card=(label,val,col,sub,onclick)=>`<div ${onclick?`onclick="${onclick}"`:''} style="${onclick?'cursor:pointer;':''}background:var(--bg2);border:1px solid var(--border);border-top:3px solid ${col};border-radius:8px;padding:12px 14px;flex:1;min-width:130px;">
    <div style="font-size:9.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700;">${label}</div>
    <div style="font-size:28px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1;">${val}</div>
    ${sub?`<div style="font-size:11px;color:var(--text3);margin-top:4px;font-weight:600;">${sub}</div>`:''}
  </div>`;

  const totalToDo=items.length;
  const allClear=totalToDo===0&&openIssues.length===0;

  /* The shared notes pad is gone — notes now live on the row they are about,
     where whoever picks that row up will actually see them. */
  let html=_lavLateBanner+`
    ${(()=>{
      /* Title first — the page used to open on a banner, so you could not tell
         at a glance whose page it was or how much was waiting. */
      const toChase=items.filter(x=>!x.waiting&&!x.sortedGrace&&!x.parkedRow).length;
      const withJack=items.filter(x=>x.waiting).length;
      const unseenN=items.filter(x=>!ROW_SEEN[String(x.rid)]&&!x.waiting&&x.kind!=='job'&&!x.sortedGrace&&!x.parkedRow).length;
      const doneN=items.filter(x=>x.sortedGrace||x.parkedRow).length;
      const kc=(v,l,cls)=>`<div class="jkKpi ${cls||''}" style="flex:1;"><b>${v}</b><span>${l}</span></div>`;
      return`<div class="jkHero" style="padding:12px 16px 14px;margin-bottom:10px;flex-direction:column;align-items:stretch;gap:10px;">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;">Sarah's Admin</h2>
        <p style="margin:0;">${toChase?`Work the queue top to bottom — it is already in order.`:'Nothing to chase. All quiet.'}</p>
      </div>
      <div class="jkKpis" style="width:100%;display:flex;gap:9px;">
        ${kc(fmt(toChase),'to chase',toChase?'warn':'ok')}
        ${cUrgent?kc(fmt(cUrgent),'urgent','bad'):''}
        ${kc(fmt(unseenN),'not opened yet',unseenN>8?'bad':unseenN?'warn':'ok')}
        ${kc(fmtGBP2(lateValue),'tied up','warn')}
        ${withJack?kc(fmt(withJack),'with Jack','hot'):''}
        ${doneN?kc(fmt(doneN),'recently actioned',''):''}
      </div>
    </div>`;})()}
    ${''/* Checked ritual removed for the 31 Aug trial — Jack, 30 Aug. checkInStrip() kept in code for later. */}
`;

  if(allClear){
    html+=`<div class="empty" style="margin-top:30px;"><div class="empty-ico">✅</div><div class="empty-t">All clear — nothing needs chasing right now.</div></div>`;
    wrap.innerHTML=html;
    return;
  }

  // ── FOLLOW-UP QUEUE ─────────────────────────────────────────────────────────
  /* Built as a string rather than appended, so the sections can be ordered by
     who has to act rather than by the order they happen to be coded in. */
  let _transitSec='';
  /* Jack, 4 Sep: "I was typing in search — where the fuck did it all go." A
     search that matched nothing emptied `items`, and the whole panel — SEARCH
     BOX INCLUDED — stopped rendering. The term stayed set with no way to clear
     it, so the page read "Nothing to chase. All quiet." while 23 jobs sat
     behind the filter. The panel now stays put whenever a search or a tab
     filter is on, so there is always a way back. */
  const _filtering=!!((_admQ||'').trim())||_admKind!=='all';
  if(items.length||_filtering){
    const _dLate=items.filter(i=>i.sev>=3).length;
    _transitSec=`<div class="tfuPanel" style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;margin-bottom:16px;padding:0 6px 6px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(239,68,68,.06);gap:10px;flex-wrap:wrap;">
        <div style="font-size:13.5px;font-weight:800;color:var(--text);">Everything to sort out — ${items.filter(x=>!x.waiting&&!x.withBecki).length} open${(()=>{
          const w=items.filter(x=>x.waiting).length;
          return w?` <span onclick="_admKind='WITHJACK';renderAdmin();" title="Show only the grey rows that are with Jack" style="font-size:11.5px;font-weight:700;color:#b6c2d4;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">· ${w} with Jack</span>`:'';})()}${(()=>{
          const b=items.filter(x=>x.withBecki&&!x.waiting).length;
          return b?` <span onclick="_admKind='WITHBECKI';renderAdmin();" title="Show only the grey rows Becki is checking" style="font-size:11.5px;font-weight:700;color:#22d3ee;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">· ${b} with Becki</span>`:'';})()}${(()=>{
          const pa=items.filter(x=>x.partArrived).length;
          return pa?` <span style="font-size:11.5px;font-weight:700;color:#fbbf24;">&middot; ${pa} part arrived</span>`:'';})()}
          <span class="tfuHint" style="font-weight:600;color:var(--text2);margin-left:8px;" title="Jack’s replies first, money about to be lost next, newest & biggest after that, dead claims last">${
            _tfuSort==='priority'
              ? 'priority order — work top to bottom'
              : _tfuSort==='days'
              ? (_tfuDir<0?'newest first':'oldest first')
              : _tfuSort==='refund'
              ? 'closest to losing the refund first'
              : 'sorted by '+({product:'product',supplier:'supplier',units:'units',due:'due date',kind:'type'}[_tfuSort]||_tfuSort)
          } &middot; <b style="cursor:pointer;color:var(--accent);" onclick="tfuSort('priority')">${_tfuSort==='priority'?'':'back to priority order'}</b></span></div>
        <div style="display:flex;align-items:center;gap:9px;">
          <button onclick="exportTransitCsv()" title="Download the whole queue as a CSV — opens straight in Google Sheets or Excel. Nothing is written back to any sheet."
            style="padding:5px 11px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">&#8595; Export CSV</button>
          <div style="font-size:11px;font-weight:700;color:#f87171;background:rgba(239,68,68,.12);padding:3px 11px;border-radius:10px;white-space:nowrap;">${_dLate} red</div>
        </div>
      </div>
      <div class="admBar">
        <div class="admSearch">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="4"/><line x1="10" y1="10" x2="13" y2="13"/></svg>
          <input id="admSrch" value="${esc(_admQ||'')}" placeholder="Search product, SKU, supplier, order or note"
            oninput="_admQ=this.value;renderAdmin();setTimeout(()=>{const b=document.getElementById('admSrch');if(b){b.focus();b.setSelectionRange(b.value.length,b.value.length);}},0);" autocomplete="off">
        </div>
        <select class="admSort" onchange="tfuSort(this.value)" title="Sort the list — priority is the order Sarah should work in">
          ${[['priority','Sort: priority — work top to bottom'],['days','Sort: oldest first'],['newest','Sort: newest first'],['refund','Sort: claim window'],['kind','Sort: type'],
             ['product','Sort: product'],['supplier','Sort: supplier'],['units','Sort: units'],['due','Sort: due date']]
            .map(([k,l])=>`<option value="${k}" ${(k==='newest'?(_tfuSort==='days'&&_tfuDir<0):(_tfuSort===k&&!(k==='days'&&_tfuDir<0)))?'selected':''}>${l}</option>`).join('')}
        </select>
        <div class="admChips">
          ${[['all','All'],['FROMJACK','Jack answered'],['QUERY','Queries'],['LATE','Late'],['MISSING','Missing'],['DAMAGED','Damaged'],['MISSING + DMG','Missing + dmg'],['WRONG ITEM','Wrong item'],['NOT ARRIVED','Not arrived'],['GATED','Gated'],['JOB','Jobs'],['WITHJACK','With Jack'],['WITHBECKI','With Becki'],['AMZCHASE','Jack chasing Amazon']]
            .filter(([k])=>k==='all'||_counts[k])
            .map(([k,l])=>`<button class="admChip${k==='FROMJACK'?' fromJack':''}${_admKind===k?' on':''}"${k==='FROMJACK'?' title="Rows Jack has answered — newest first. Act on his answer and close them off."':''} onclick="_admKind='${k.replace(/'/g,"\\'")}';renderAdmin();">${l} <b>${_counts[k]||0}</b></button>`).join('')}
        </div>
      </div>
      ${/* Jack: "What do the colours on the left-hand side actually mean?" */''}
      <div class="admKey">
        <span class="admKeyT">The stripe down the left</span>
        ${[['#ef4444','Late or urgent — money at risk'],
           ['#fb923c','Delayed, being chased'],
           ['#fbbf24','Needs a follow-up'],
           ['#38bdf8','Supplier short or damaged'],
           ['#94a3b8','Light grey — with Jack, from Jack, or just sorted']]
          .map(([c,t])=>`<span class="admKeyI"><span class="admKeyD" style="background:${c};"></span>${t}</span>`).join('')}
      </div>
      <div class="tfuScroll">
      <table class="tfu">
        <thead><tr>
          ${(()=>{const H=(k,label,w,extra,tip)=>{
              const on=_tfuSort===k;
              return`<th style="width:${w};${extra||''}" ${k?`class="tfuSortable${on?' on':''}" onclick="tfuSort('${k}')" title="${tip||('Sort by '+label.toLowerCase())}"`:(tip?`title="${tip}"`:'')}>${label}${
                on?`<span class="tfuArrow">${_tfuDir===1?'▲':'▼'}</span>`:''}</th>`;};
            return H('priority','#','2%','text-align:center;','Priority order — 1 is the most important thing on the page')
              +H('product','Product','19%')
              +H('supplier','Supplier / order','10%')
              +H('units','Units','6%','text-align:center;')
              +H('kind','What\'s wrong','11%','text-align:center;','The issue type and what put this row on the page, worked out by the app from the numbers — plus the note written by whoever raised it, and the refund-window clock. Click to sort by type.')
              +H('','Triage','15%','text-align:center;','Work the first questions and steps right here on the row — the popup is only for detail.')
              +H('','Where it stands','28%','','The current state of the issue: the last thing anyone recorded, who did it, when, and what is being waited on. Written automatically as the row is worked.')
              +H('','Actions','9%','text-align:center;');})()}
        </tr></thead>
        <tbody>
        ${(()=>{
        const _rowHtml=(i,n)=>{
          const jumpTerm=(i.oid||i.sku||'').replace(/'/g,"\\'");
          const sentBack=i.sentBack, waiting=i.waiting;
          const isAmz=i.kind==='transit'&&typeof _jackSupplier==='function'&&_jackSupplier(i.sup);
          /* Jack: "if I hover over those colours, it doesn't tell me what any of
             them actually mean." Every coloured edge explains itself. */
          const edgeCol=waiting?'#94a3b8':i.col;
          const edgeTip=waiting?'Light grey — with Jack, waiting for his answer':({'#ef4444':'Red — late or urgent, money at risk','#fb923c':'Orange — delayed or being chased','#fbbf24':'Amber — needs following up','#38bdf8':'Blue — a question from the warehouse, or a supplier shortage','#94a3b8':'Grey — job from Jack or already sorted'}[i.col]||'');
          /* Jack, 4 Sep: "these should be hoverable and tell you the current
             status." The stripe only said what its colour meant. It now reports
             where the row actually stands — who has it, how old, what is at
             stake and why it is here — so the colour can be interrogated
             without opening anything. */
          const _sb=[];
          if(waiting)_sb.push('With Jack'+(i.wait?' — '+i.wait+' day'+(i.wait===1?'':'s'):''));
          else if(i.sortedGrace)_sb.push('Sorted — still undoable');
          else if(i.parkedRow)_sb.push('Parked on a date');
          else if(i.kind==='job')_sb.push((i.jobList&&i.jobList.length>1)?i.jobList.length+' things to finish off':'One thing to finish off');
          if(i.days!=null&&i.days>0)_sb.push(i.days+' day'+(i.days===1?'':'s')+' old');
          if(i.value>0)_sb.push(fmtGBP2(i.value)+' at stake');
          if(i.outstanding>0)_sb.push(fmt(i.outstanding)+' still owed');
          if(i.reason&&i.kind!=='job')_sb.push(String(i.reason));
          const edgeTitle=edgeTip+(_sb.length?' — '+_sb.join(' · '):'');
          /* Jack, 5 Sep: eleven grey "with Jack" rows, each five lines tall, all
             saying the same thing. While he has it there is nothing for her to
             read here — one line: what it is, what was asked, how long. */
          if(i.withBecki&&!waiting&&!i.sortedGrace&&!i.parkedRow){
            const _bAge=i.withBecki.at?Math.max(0,Math.floor((Date.now()-new Date(i.withBecki.at).getTime())/864e5)):null;
            return`<tr class="tfuWaiting tfuCompact">
              <td class="tfuNumCell" style="text-align:center;"><span class="tfuStripe" style="background:#22d3ee;" title="With Becki — Amazon say delivered, she is checking the shelves"></span><span style="font:800 12px var(--mono);color:var(--text3);">${n+1}</span>
              <td colspan="6"><div class="tfuCmp">
                <span class="tfuCmpName" title="${esc(i.prod||'')}">${esc(i.prod||i.sku||'')}</span>
                <span class="tfuCmpMeta">${esc(i.sup||'')}${i.oid?' · '+esc(i.oid):''}${i.acct?' · '+esc(i.acct):''}</span>
                <span class="tfuCmpChip" style="background:rgba(34,211,238,.14);border-color:rgba(34,211,238,.5);color:#22d3ee;" title="With Becki — checking the shelves">With Becki &middot; checking the shelves${_bAge!=null?' &middot; '+_bAge+'d':''}</span>
                <span class="tfuCmpAsk" title="Sent ${esc(i.withBecki.sentBy||'')}${i.withBecki.at?' '+esc(_logWhen(i.withBecki.at)):''}">Amazon say delivered &mdash; Becki is checking the shelves. Found: it books in and clears. Not there: it goes to Jack for the refund.</span>
                ${i.value?`<span class="tfuCmpVal">${fmtGBP2(i.value)}</span>`:''}
              </div></td>
              <td class="tfuActs">
                <button class="tfuAsk" style="margin-top:0;" onclick="amzBackToJack('${i.rid}')" title="Nothing for the warehouse to find — the order or the Purchase Sheet is wrong. It goes to Jack to answer and comes off Becki's list.">Back to Jack</button>
                <button class="tfuAsk" style="margin-top:0;" onclick="amzUndoBecki('${i.rid}')" title="Sent by mistake — pull it back off Becki's list. Jack's answer stays on the row and your Yes / No buttons come back.">Undo</button>
                <button class="tfuMore" onclick="openWork('${i.rid}')" title="Everything on this issue — nothing to do until Becki answers">Details</button>
              </td></tr>`;
          }
          if(waiting&&!i.sortedGrace&&!i.parkedRow){
            const _e1=s=>String(s).replace(/'/g,"\\'");
            const _wAge=waiting.at?Math.max(0,Math.floor((Date.now()-new Date(waiting.at).getTime())/864e5)):null;
            const _wWhat=waiting.state==='asked'?(waiting.ask||'Amazon order check'):_resText(waiting.what);
            /* Jack, 8 Sep: an Amazon claim is his until it is sorted — she can
               see where it stands, but there is nothing for her to undo. */
            const _jackOwned=waiting.what==='amz-claim'||waiting.what==='amz-missing';
            /* Jack, 9 Sep: "she still needs visibility of where the issue
               currently sits, even when she isn't responsible for the next
               action." Every stage said "With Jack" — checking the account and
               chasing a refund read identically. */
            const _stage=_jackOwned?'With Jack · chasing Amazon':'With Jack · checking the account';
            const _q=i.query;
            return`<tr class="tfuWaiting tfuCompact">
              <td class="tfuNumCell" style="text-align:center;"><span class="tfuStripe" style="background:#94a3b8;" title="${esc(edgeTitle)}"></span><span style="font:800 12px var(--mono);color:var(--text3);cursor:help;" title="${esc(edgeTitle)}">${n+1}</span></td>
              <td colspan="6"><div class="tfuCmp">
                <span class="tfuCmpName" title="${esc(i.prod||'')}">${esc(i.prod||i.sku||'')}</span>
                <span class="tfuCmpMeta">${esc(i.sup||'')}${i.oid?' · '+esc(i.oid):''}${i.acct?' · '+esc(i.acct):''}</span>
                <span class="tfuCmpChip"${_jackOwned?' style="background:rgba(34,211,238,.14);border-color:rgba(34,211,238,.5);color:#22d3ee;"':''} title="${esc(_stage)}">${esc(_stage)}${_wAge!=null?' &middot; '+_wAge+'d':''}</span>
                <span class="tfuCmpAsk" title="${esc(_wWhat)}">${_q?'Warehouse asked: '+esc(_q.got?_q.got+' of '+_q.exp+' in — is more coming?':'has it been dispatched?')+' · ':''}${esc(_wWhat)}</span>
                ${i.value?`<span class="tfuCmpVal">${fmtGBP2(i.value)}</span>`:''}
              </div></td>
              <td class="tfuActs" style="text-align:center;">
                ${_jackOwned?'':`<button class="tfuAsk" style="margin-top:0;" onclick="undoSend('${i.kind}','${i.kind==='claim'?i.claimId:i.kind==='lav'?_e1(i.lavKey):i.rid}')" title="Changed your mind — pull it back off Jack's list and carry on yourself">Undo</button>`}
                <button class="tfuMore" onclick="${i.kind==='claim'?`openClaimCase('${i.claimId}')`:i.kind==='lav'?`openLavIssue('${_e1(i.lavKey)}')`:`openWork('${i.rid}')`}" title="Everything on this issue — it is locked while Jack has it">Details</button>
              </td></tr>`;
          }
          return`<tr class="${(waiting||i.sortedGrace||i.parkedRow)?'tfuWaiting':''}"${sentBack?' style="background:rgba(239,68,68,.05);"':''}>
            <td class="tfuNumCell" style="text-align:center;padding-top:13px;">
              <span class="tfuStripe" style="background:${edgeCol};" title="${esc(edgeTitle)}"></span>
              <span style="font:800 12px var(--mono);color:var(--text3);cursor:help;" title="${esc(edgeTitle)}">${n+1}</span>
            </td>
            <td>
              <div class="tfuProd2" title="${esc(i.prod||'')}">${esc(i.prod||i.sku||'')}</div>
              ${i.sku?`<div class="s-sku" onclick="copyVal('${(i.sku||'').replace(/'/g,"\\'")}',this)" style="font-size:10.5px;font-weight:700;letter-spacing:.03em;white-space:normal;overflow-wrap:anywhere;display:block;text-align:left;margin-top:6px;" title="Click to copy">${i.sku}</div>`:''}
              ${i.asin?`<div style="margin-top:7px;text-align:left;"><span class="s-asin" onclick="copyVal('${i.asin}',this)" style="font-size:10.5px;opacity:.85;">${i.asin}</span></div>`:''}
              ${sentBack?`<div class="tfuBack tfuBackChip${sentBack.jackNote?' req':''}" title="${esc(sentBack.rejectNote||'')}">&#8617; <b>${esc(sentBack.rejectedBy||'Jack')}</b> ${sentBack.jackNote?'needs a check':'answered'}${sentBack.at?' · '+esc(_logWhen(sentBack.at)):''} &mdash; see Triage</div>`:''}
              ${waiting?`<div class="tfuWait">${waiting.state==='asked'?'Asked Jack to check':'Sent to Jack — awaiting decision'}${waiting.at?` · ${noteAgo(waiting.at)}`:''}<span>${esc(waiting.state==='asked'?(waiting.ask||'Amazon order check'):_resText(waiting.what))}</span></div>`:''}
              ${i.draft?`<div class="tfuDraftChip" title="${esc((i.draft.by||'Someone')+' started closing this off')}">Part done — ${esc(i.draft.by||'someone')} saved it ${esc(noteAgo(i.draft.at))}<span>${esc(_resText(i.draft.what))}</span></div>`:''}
            </td>
            <td>
              <div class="tfuSup">${esc(i.sup||'—')}</div>
              <div class="tfuOid${i.oid?'':' none'}" ${i.oid?'title="Select to copy — this is the reference to quote"':''}>${esc(i.oid||'no order id')}</div>
              <div style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:5px;flex-wrap:wrap;">
                ${i.acct?`<span class="tfuAcct">${esc(i.acct)}</span>`:''}
                ${i.sheetRow?`<span class="tfuSheet" title="Line ${esc(i.sheetRow)} on the Purchase Sheet">sheet line ${esc(i.sheetRow)}</span>`:''}
              </div>
              ${/* Jack: "What's the ordered bit about? Ordered what?" It is the
                    date the order was PLACED — and on rows that never came off
                    an order (a shortage found at check-in, a claim) there is no
                    such date, so it said "ordered —" and meant nothing. Those
                    rows now say when the issue was raised instead. */''}
              ${i.date
                ? `<div class="tfuWhen" title="The date this order was placed with the supplier">ordered <b>${esc(i.date)}</b></div>`
                : `<div class="tfuWhen" title="When this issue was raised">raised <b>${esc(i.days===0?'today':i.days+(i.days===1?' day':' days')+' ago')}</b></div>`}
              ${/* Jack: "It would be nice to have that information clearly
                    visible so Sarah immediately knows the SOURCE of the issue."
                    Where each row came from: the Purchase Sheet feed, a
                    check-in by UK staff, the Lavarion area, or Jack himself. */''}
              ${(()=>{const s=i.src||(i.source==='Sheet'?'Purchase Sheet':(i.kind==='transit'?'Prep Hub':''));
                return s?`<div class="tfuSrcLine" title="Where this issue came from">${esc(s)}</div>`:'';})()}
            </td>
            <td style="text-align:center;">
              ${/* Jack: "If NOTHING has arrived, why is it showing 0 UNITS?" —
                   claims and jobs were pushed with units:0 and then given the
                   transit row's "nothing arrived" line. Each type now says what
                   its number actually is. */''}
              ${/* Jack, 3 Sep: "10 nothing arrived haha". The big number had no
                    label, so it ran straight into the line under it. Every
                    number now says what it IS, on the same line as itself. */''}
              ${(()=>{const lbl=t=>`<span style="font-size:9.5px;font-weight:700;color:var(--text3);margin-left:4px;letter-spacing:.02em;">${t}</span>`;
                if(i.kind==='job')return `<div class="tfuBig" style="color:var(--text3);">&mdash;</div>`;
                const claim=i.kind==='lav'||i.kind==='claim';
                if(claim)return `<div class="tfuBig">${i.units}${lbl('affected')}</div>`;
                return `<div class="tfuBig">${i.units}${lbl('ordered')}</div>
                  <div class="tfuUnits">
                  ${i.got
                    ? `<span style="color:var(--green);">${i.got} in</span> &middot; <b>${i.outstanding} still out</b>`
                    : `<span style="color:#fca5a5;">none arrived yet</span>`}
                  ${i.cancelled?`<br><span style="color:#fca5a5;">${i.cancelled} cancelled</span>`:''}
                  </div>`;})()}
              ${i.value?`<div class="tfuVal" title="Money tied up in this line">${fmtGBP2(i.value)}<span style="display:block;font-size:9.5px;font-weight:700;color:var(--text3);letter-spacing:.02em;">at stake</span></div>`:''}
            </td>
            <td class="tfuWrong" style="text-align:center;">
              ${(()=>{const K=_typeOf(i);
                return `<span style="font-size:9.5px;font-weight:800;letter-spacing:.06em;padding:3px 8px;border-radius:9px;color:${K[1]};background:${K[1]}1a;border:1px solid ${K[1]}50;white-space:nowrap;cursor:default;margin-right:5px;" title="${K[2]}">${K[0]}</span>`;})()}
              ${i.kind==='claim'||i.kind==='job'?'':`<span class="tfuWhy" style="color:${i.col};background:${i.col}1f;border:1px solid ${i.col}55;cursor:default;" title="Why this row is on the page — worked out by the app from the numbers">${esc(i.reason)}</span>`}
              ${/* The note typed by whoever RAISED it — the context Jack wants
                    Sarah to see without digging. Different from the chase notes:
                    this is why it exists, those are what has happened since. */''}
              ${i.claimId&&i.kind==='transit'?`<div class="tfuRaiseNote" style="border-left-color:#fbbf24;color:#fcd34d" title="A claim is already open on this same order — one job, not two">&#163;${(i.claimVal||0).toFixed(2)} claim open &middot; ${esc(i.claimType||'')}${i.claimState?' &middot; '+esc(i.claimState):''}</div>`:''}
              ${i.srcNote?`<div class="tfuRaiseNote" title="Written when the issue was raised">&ldquo;${esc(i.srcNote)}&rdquo;</div>`:''}
              ${i.packNote?`<div class="tfuRaiseNote" style="border-left-color:#fb923c;color:#fdba74;" title="The packing note from the Prep Sheet row">&#128230; ${esc(i.packNote)}</div>`:''}
              ${i.vaNote?`<div class="tfuRaiseNote" style="border-left-color:#60a5fa;color:#93c5fd;" title="The VA note from the Prep Sheet row">VA: ${esc(i.vaNote)}</div>`:''}
              ${i.photos?`<button class="csAct go" style="margin-top:5px;padding:3px 10px;" onclick="window.open('${esc(i.photos)}','_blank')" title="Opens the Discord message with the photos">&#128247; View photos</button>`:''}
              ${(()=>{const L=refundLeft(i.date,i);
                if(L===null)return'';
                const c=L<0?'#f87171':(L<=7?'#fbbf24':'#4ade80');
                return`<div class="tfuClock" style="color:${c};background:${c}1a;border:1px solid ${c}55;"
                  title="${REFUND_DAYS}-day refund window from the order date">${
                  _claimWords(L)}</div>`;})()}

            </td>
            <td>
              ${(()=>{
                /* Triage lives ON the row and reads like the OG tracker: the
                   select IS the status — green Yes, red No, amber until it is
                   answered. Answering never opens anything; the popup waits
                   for Sorted and arrives pre-filled with what she said here. */
                /* Jack: "I want to be able to START WORKING THROUGH THE ISSUE
                   DIRECTLY FROM TRIAGE. I don't want to have to press Open
                   first." So claims and check-in shortages get their first
                   moves right here too — the popup is only for detail. */
                /* Two clicks, his spec: CONTACTED SUPPLIER → method → saved.
                   The method chips replace the buttons in place — nothing
                   opens, nothing to type, Skip if she can't be bothered. */
                const methods=(k,act)=>`<div class="csNow">
                    <div class="csNowCap">How?</div>
                    <div class="ctMethods">${['Email','Live chat','Case','Phone'].map(m=>
                      `<button class="csAct go" onclick="ctMethod('${m}')">${m}</button>`).join('')}
                      <button class="csAct plain" onclick="ctMethod('skip')">Skip</button>
                    </div></div>`;
                if(i.kind==='claim'){
                  if(_ctFor==='claim:'+i.claimId)return methods();
                  const gated2=/gated/i.test((i.claimC&&i.claimC.issT)||'');
                  if(gated2)return `<div class="csNow">
                    <div class="csNowCap">Next step</div>
                    <div class="csNowTxt" title="Gated is yours first — if you hold invoices for the brand, submit them. Send to Jack only if you need him.">Got invoices? Submit them</div>
                    <div class="csActs">
                      <button class="csAct go" onclick="claimQuick('${i.claimId}','invoices')">Invoices submitted</button>
                      <button class="csAct plain" onclick="claimQuick('${i.claimId}','replied')">They replied</button>
                      <button class="csAct good" onclick="claimQuick('${i.claimId}','ungated')">Ungated — done</button>
                    </div></div>`;
                  const ch2=typeof _claimChaseInfo==='function'&&i.claimC?_claimChaseInfo(i.claimC):{txt:''};
                  const fresh2=ch2.txt==='No contact yet';
                  return `<div class="csNow">
                    <div class="csNowCap">Next step</div>
                    <div class="csNowTxt" title="Check whether they already refunded it before you open a case — it saves the whole conversation.">${
                      fresh2?'Check for a refund, then chase':'Chasing the supplier'}</div>
                    <div class="csActs">
                      ${fresh2
                        ? `<button class="csAct good" onclick="claimQuick('${i.claimId}','refunded')" title="They already refunded it — done">Already refunded</button>
                           <button class="csAct go" onclick="askMethod('claim:${i.claimId}','contacted')" title="Then one press for how — email, chat, case or phone">I&rsquo;ve contacted them</button>`
                        : `<button class="csAct good" onclick="claimQuick('${i.claimId}','promised')" title="They have said the refund is coming — that is sorted. Closes it; nothing else to do.">Refund confirmed &mdash; close it</button>
                           <button class="csAct warn" onclick="askMethod('claim:${i.claimId}','chased')">Chased again</button>`}
                    </div></div>`;
                }
                if(i.kind==='lav'){
                  if(_ctFor==='lav:'+i.lavKey)return methods();
                  return `<div class="csNow">
                    ${i.jobNote?`<div class="csNowCap" style="color:#f87171;">Job from Jack</div><div class="csNowTxt" title="${esc(i.jobNote)}">${esc(i.jobNote)}</div>`:''}
                    <div class="csNowCap">Next step</div>
                    <div class="csNowTxt" title="Shortage or damage found at check-in — the supplier has to put it right.">${i.chased?'Waiting on the supplier':'Tell the supplier'}</div>
                    <div class="csActs">
                      <button class="csAct go" onclick="askMethod('lav:${String(i.lavKey).replace(/'/g,"\\'")}','chased')">Chased today</button>
                      <button class="csAct plain" onclick="lavQuick('${String(i.lavKey).replace(/'/g,"\\'")}','replied')">They replied</button>
                    </div></div>`;
                }
                if(i.sortedGrace)return '<div class="tfuSelf" style="text-align:center;">Closed — undoable for 48 working hours. Undo is on the right.</div>';
                if(i.parkedRow)return '<div class="tfuSelf" style="text-align:center;">Parked — expected '+(i.expDate?new Date(i.expDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}):'')+'. It comes back by itself if the date slips. Undo is on the right.</div>';
                if(i.kind==='lavlate')return `<div class="csNow">
                    <div class="csNowCap" style="color:#f87171;">Job from Jack</div>
                    <div class="csNowTxt" title="${esc(i.jobNote||'')}">${esc(i.jobNote||'Late order — see the right')}</div>
                    <div class="tfuGuide">A date clears it everywhere. Otherwise press Done (right) and say what you found.</div>
                  </div>`;
                if(i.kind!=='transit')return '<div class="tfuSelf" style="text-align:center;">Open it to work through this one.</div>';
                if(waiting)return '<div class="tfuSelf" style="color:#93c5fd;font-weight:700;text-align:center;">Waiting on Jack</div>';
                /* a question from the warehouse: four answers, each one press;
                   the row parks or balances itself and the VA Note carries the
                   reply back to the Prep Sheet */
                /* Jack, 7 Sep: "why is this asking if things arrived in triage when
                   I've just sent it back saying nothing is coming — this is a mess."
                   His answer settles the question. What belongs here now is the
                   move that follows from it, not the question again. */
                {const _rr=_rowById(i.rid);if(_rr&&typeof _isAmzDel==='function'&&_isAmzDel(_rr))return '<div class="tfuSelf" style="color:#22d3ee;font-weight:700;text-align:center;">Amazon say delivered &mdash; Becki is checking the shelves. It comes back by itself.</div>';}
                /* Sarah, 9 Sep (Discord): "I haven't sent to Becki yet because
                   there is no note like the one above." The row was LATE with
                   nothing booked in, so it missed this branch and showed the old
                   dropdowns. On an Amazon order his answer is the whole story,
                   whatever state the row was in. */
                if(sentBack&&sentBack.rejectNote&&(i.query||i.partOverdue||_amazonRow(_rowById(i.rid)))){
                  const a=String(sentBack.rejectNote||'');
                  const notComing=/not arrived|nothing coming|cancel/i.test(a);
                  const arrivedYes=!notComing&&/arrived\s*[—-]\s*yes|shows it delivered|delivered/i.test(a);
                  const short=i.outstanding||Math.max(0,(i.units||0)-(i.got||0));
                  const _amzR=_amazonRow(_rowById(i.rid));
                  /* Jack, 10 Sep: he typed "please double-check this… then
                     send the evidence back to me" and her page called it an
                     ANSWER with a green close button. A typed note is a job. */
                  if(sentBack.jackNote){
                    return `<div class="csNow">
                      <div class="csNowCap" style="color:#fbbf24;">Jack needs you to check</div>
                      <div class="csNowTxt jkReq" title="${esc(a)}">${esc(a)}</div>
                      <div class="csActs">
                        <button class="csAct good" onclick="askJackAsk('${i.rid}','free')" title="Write what you found and send it to Jack — it lands on his page with your evidence">Send what I found to Jack</button>
                        ${_amzR?`<button class="csAct go" onclick="amzToBecki('${i.rid}')" title="Becki checks the shelves, back stock and anywhere else. It comes back with her answer.">Ask Becki to check the shelves</button>`:''}
                        <button class="csAct plain" onclick="openSorted('${i.rid}')" title="The full Close-off popup — every outcome">Close it off another way&hellip;</button>
                      </div>
                    </div>`;
                  }
                  if(sentBack.restGone){
                    const rg=sentBack.restGone;
                    return `<div class="csNow">
                      <div class="csNowCap" style="color:#f87171;">Jack checked the account</div>
                      <div class="csNowTxt" title="${esc(a)}">${esc(a)}</div>
                      <div class="csActs">
                        ${rg.why==='sheet'
                          ?`<button class="csAct good" onclick="openQtyFixAnswered('${i.rid}')" title="A sheet correction, not a cancellation: the popup opens filled in with ${fmt(rg.ordered)} — Enter saves it, the row corrects to ${fmt(rg.ordered)} and the Purchase Sheet job lands on your list.">Correct the sheet to ${fmt(rg.ordered)} &mdash; nothing is missing</button>`
                          :`<button class="csAct good" onclick="openSorted('${i.rid}','${(i.got||0)>0?'part-cancelled':'cancelled'}')" title="The popup opens filled in: ${fmt(i.got||0)} arrived, ${fmt(short)} cancelled. One job — the Purchase Sheet.">Note the sheet and close it &mdash; ${fmt(short)} cancelled</button>`}
                      </div>
                      <div class="tfuGuide">${rg.why==='sheet'?`Jack checked the account: the sheet says ${fmt(i.units)}, only ${fmt(rg.ordered)} were ordered. Nothing is missing, nothing was cancelled — correct the number here, then write it on the Purchase Sheet.`:'Amazon refund a cancelled unit by themselves — nothing to chase.'}</div>
                    </div>`;
                  }
                  /* Jack, 9 Sep: "way too many buttons for irrelevant stuff." On
                     an Amazon order his answer leaves ONE move: nothing coming →
                     Amazon refund it themselves, so note the sheet and close;
                     any other answer → record it and close. Sorted and Send to
                     Jack already sit on the right, so no third copy here. */
                  if(_amzR&&!arrivedYes)return `<div class="csNow">
                    <div class="csNowCap" style="color:#f87171;">Jack checked the account</div>
                    <div class="csNowTxt" title="${esc(a)}">${esc(a)}</div>
                    <div class="csActs">
                      ${notComing
                        ?`<button class="csAct good" onclick="openSorted('${i.rid}','${(i.got||0)>0?'part-cancelled':'cancelled'}')" title="Amazon refund a cancelled or undelivered order by themselves — nothing to chase. The popup opens filled in: ${fmt(short)} cancelled, one job: write it on the Purchase Sheet.">Amazon refund it themselves &mdash; note the sheet and close</button>`
                        :`<button class="csAct good" onclick="openSorted('${i.rid}')" title="Record what Jack found and close it off — the popup opens with his answer already in the note">Close it off with Jack&rsquo;s answer</button>`}
                    </div>
                    <div class="tfuGuide">Amazon order &mdash; the refund is Jack&rsquo;s side, not yours.</div>
                  </div>`;
                  return `<div class="csNow">
                    <div class="csNowCap" style="color:#f87171;">Jack checked the account</div>
                    <div class="csNowTxt" title="${esc(a)}">${esc(a)}</div>
                    <div class="csActs">
                      ${notComing?`${/cancel/i.test(a)?`<button class="csAct good" onclick="openSorted('${i.rid}','${(i.got||0)>0?'part-cancelled':'cancelled'}')" title="Jack says it was cancelled — the popup opens filled in: ${fmt(short)} cancelled, one tick for the Purchase Sheet, then close">Cancelled &mdash; note the sheet, close it</button>`:''}
                        <button class="csAct ${/cancel/i.test(a)?'plain':'warn'}" onclick="openSorted('${i.rid}','no-refund')" title="Nothing more is coming and there is no refund yet — close it as never arrived so the claim starts">Never arrived &mdash; close it, claim the ${fmt(short)}</button>
                        <button class="csAct good" onclick="openSorted('${i.rid}','refund-done')" title="They have said the refund is coming — that is processed. Close it; Jack watches the bank himself.">Refund being processed &mdash; done</button>
                        <button class="csAct plain" onclick="queryBalance('${i.rid}','cancelled')" title="The supplier cancelled the rest — the row balances, nothing missing">Supplier cancelled the rest</button>`
                      :arrivedYes?`<div class="csNowTxt" style="margin:2px 0 4px;color:#fbbf24;">Has it gone out on the wrong SKU?</div>
                        <button class="csAct good" onclick="openSorted('${i.rid}','wrong-sku')" title="The unit is accounted for — it went out on another listing. Close it off here; the popup asks which SKU if you know it.">Yes &mdash; sort it and close it</button>
                        <button class="csAct go" onclick="amzToBecki('${i.rid}')" title="Not the wrong SKU — Becki checks the shelves, back stock and anywhere it could have been put. It is flagged on the Prep Sheet and comes back with her answer.">No &mdash; send to Becki to check the warehouse</button>
                        ${!_amazonRow(_rowById(i.rid))?`<button class="csAct warn" onclick="queryNoneComing('${i.rid}')" title="Delivered but ${fmt(short)} never reached the warehouse — raise them as Missing">Delivered &mdash; raise ${fmt(short)} missing</button>`:''}`
                      :`<button class="csAct go" onclick="jackAmzDate('${i.rid}',this)">More still coming &mdash; date&hellip;</button>
                        <button class="csAct warn" onclick="queryNoneComing('${i.rid}')">Nothing more &mdash; raise ${fmt(short)} missing</button>
                        <button class="csAct good" onclick="openSorted('${i.rid}','refund-done')">Refund being processed &mdash; done</button>
                        <button class="csAct plain" onclick="queryBalance('${i.rid}','cancelled')">Supplier cancelled the rest</button>`}
                      ${_amzR?'':`<button class="csAct plain" onclick="refundWait('${i.rid}')" title="They have promised a refund — park it two days and come back to check the emails">Refund promised &mdash; check emails in 2 days</button>`}
                      <button class="csAct plain" onclick="openSorted('${i.rid}')" title="The full Close-off popup — every outcome, including a wrong quantity on the sheet">Close it off another way&hellip;</button>
                    </div>
                  </div>`;
                }
                if(i.partShip)return `<div class="csNow">
                  <div class="csNowCap" style="color:#fb923c;">Some went &mdash; the rest never followed</div>
                  <div class="csNowTxt">Still on the shelf, or sent under another SKU?</div>
                  <div class="csActs">
                    <button class="csAct go" onclick="wentOutUnder('${i.rid}')" title="They went out on another SKU's shipment — record it here; you then confirm it in Seller Central">Went out under another SKU&hellip;</button>
                    <button class="csAct plain" onclick="openSorted('${i.rid}')" title="The full Close-off popup — every outcome">Close it off another way&hellip;</button>
                  </div>
                  <div class="tfuGuide">Becki sees the same question on the Prep Sheet row &mdash; if the units are still here she sends them and this clears itself.</div>
                </div>`;
                if(i.query||i.partOverdue){
                  const Q=i.query||{got:i.got,exp:i.units,ask:`${i.got} of ${i.units} arrived ${i.partSince} — the rest has not followed`,note:''};
                  return `<div class="csNow">
                    <div class="csNowCap" style="color:${i.query?'#38bdf8':'#fb923c'};">${i.query?'Question from the warehouse':'Part arrived — rest overdue'}</div>
                    <div class="csNowTxt" title="${esc(Q.ask||'')}">${Q.got?`${Q.got} of ${Q.exp} booked in — is more on the way?`:`Nothing booked in yet — has it been dispatched?`}</div>
                    ${Q.note?`<div class="csNote" title="${esc(Q.note)}">&ldquo;${esc(Q.note)}&rdquo;</div>`:''}
                    <div class="csActs">
                      ${isAmz
                        /* Jack, 8 Sep: on an Amazon order every one of these is an
                           answer only he can give — the date is on the account, a
                           cancellation or a refund is his to confirm, and raising
                           the short units as Missing is his claim. One press. */
                        ?`<button class="csAct go" onclick="amzAskJack('${i.rid}')" title="An Amazon order — Jack checks the account first and answers. One press, nothing to type.">Send to Jack &mdash; has Amazon delivered it?</button>
                          <button class="csAct plain" onclick="openSorted('${i.rid}')" title="You already know exactly what happened — record it yourself">Close it off another way&hellip;</button>`
                        :`<button class="csAct go" onclick="jackAmzDate('${i.rid}',this)" title="It is still coming — record the date. The row parks until then and the warehouse sees the date on the Prep Sheet.">More still coming &mdash; date&hellip;</button>
                          <button class="csAct warn" onclick="queryNoneComing('${i.rid}')" title="The order shows fully delivered — the ${i.outstanding} short become a Missing issue">Nothing more &mdash; fully delivered</button>
                          <button class="csAct plain" onclick="queryBalance('${i.rid}','cancelled')" title="The supplier cancelled the rest — the row balances, nothing missing">Supplier cancelled the rest</button>
                          <button class="csAct plain" onclick="queryBalance('${i.rid}','refunded')" title="Already refunded for the shortfall — the row balances, nothing missing">Already refunded</button>
                          <button class="csAct plain" onclick="refundWait('${i.rid}')" title="They have promised a refund — park it two days and come back to check the emails">Refund promised &mdash; check emails in 2 days</button>`}
                    </div>
                    ${isAmz?`<div class="tfuGuide">Amazon order &mdash; Jack checks the account. Every other answer here is his to give.</div>`:''}
                  </div>`;
                }
                /* A live case takes the column over: the verdict is settled, so
                   what belongs here is the next move, not the question again. */
                if(i.caseC){
                  const st=_caseStep(i.caseC);
                  if(st){
                    const set=!!i.expDate;
                    /* A step that needs a date asks for it FIRST and hides the
                       outcome buttons until it has one — "replacement coming"
                       with no date is exactly how one gets forgotten. */
                    const dflt=new Date(Date.now()+((st.date&&st.date.days)||7)*864e5).toISOString().split('T')[0];
                    /* Jack, 11 Sep, SanDisk/Canon/Philips: "the promised date was the
                       10th — the first question should be HAS IT ARRIVED?" */
                    if(i.caseC.step==='due-date'&&set&&!(typeof _parkedOnDate==='function'&&_parkedOnDate(_rowById(i.rid)))){
                      const _amz=(typeof _amazonRow==='function')&&_amazonRow(_rowById(i.rid));
                      return `<div class="csNow">
                    <div class="csNowCap" style="color:#f87171;">The promised date has passed — ${esc(_dmy(i.expDate))}</div>
                    <div class="csNowTxt">Has it arrived?</div>
                    <div class="csActs">
                      <button class="csAct good" onclick="caseGo('${i.rid}','_close','due-date')" title="It turned up — close it off (the popup opens filled in)">Yes &mdash; it&rsquo;s here</button>
                      <button class="csAct warn" onclick="slipStillNothing('${i.rid}')" title="${_amz?'Nothing booked in — Jack checks the account: delivered? refunded? wrong SKU?':'Nothing booked in — chase the supplier'}">No &mdash; still nothing</button>
                    </div>
                    <div class="tfuGuide">${_amz?'Still nothing → Jack checks the Amazon account (delivered, refunded, or gone out under another SKU) and it comes back with his answer.':'Still nothing → chase the supplier for a date or a refund.'}</div>
                    <div class="csDate" style="margin-top:6px;">
                      <span class="csDateL">${_amz?'Amazon':'They'} gave a new date?</span>
                      <input type="date" id="cd_${i.rid}" value="" min="2024-01-01" max="2030-12-31">
                      <button class="csAct plain" style="width:100%;" onclick="caseDate('${i.rid}',(document.getElementById('cd_${i.rid}')||{}).value)" title="Parks it again until that date">Park it on this date</button>
                    </div></div>`;
                    }
                    return `<div class="csNow">
                    <div class="csNowCap">Next step</div>
                    <div class="csNowTxt" title="${esc(st.why||'')}">${esc(st.now)}</div>
                    ${st.date?`<div class="csDate">
                      <span class="csDateL">${esc(st.date.label)}</span>
                      <input type="date" id="cd_${i.rid}" value="${esc(i.expDate||'')}" min="2024-01-01" max="2030-12-31">
                      <button class="csAct go" style="width:100%;" onclick="caseDate('${i.rid}',(document.getElementById('cd_${i.rid}')||{}).value)" title="Nothing saves until you press this — type the date, check it, confirm">Confirm the date &#10003;</button>
                      ${!set?`<button class="csAct plain" style="width:100%;" onclick="caseDate('${i.rid}','${dflt}')">Set ${(st.date&&st.date.days)||7} days from today</button>`:''}
                    </div>`:''}
                    ${(!st.date||set)?`<div class="csActs">${(st.acts||[]).map(a=>
                      `<button class="csAct ${a.tone}" onclick="caseGo('${i.rid}','${a.k}','${i.caseC.step}')"
                        title="${esc(a.log)}">${esc(a.t)}</button>`).join('')}</div>`:''}
                    ${(i.caseC&&['contact','waiting','check-refund'].includes(i.caseC.step))?`<button class="csAct plain" style="width:100%;margin-top:4px;" onclick="copyChaseMsg('${i.rid}',this)" title="Writes the supplier chase for you — order number, what's missing, what we want. Paste it into the email or case.">&#9998; Copy the chase message</button>`:''}
                  </div>`;}
                }
                const arrived=i.delivered==='Yes';
                const cls=v=>v==='Yes'?'yes':v==='No'?'no':'pend';
                const q=(cap,field,val)=>`<div class="tfuQ">
                  <span class="tfuCap" style="margin:0;">${cap}</span>
                  <select class="tfuTri ${cls(val)}" onchange="setTriage('${i.rid}','${field}',this.value)"
                    title="${cap} Green = yes, red = no, amber = not answered yet.">
                    ${['','Yes','No'].map(o=>`<option value="${o}" ${val===o?'selected':''}>${o||'—'}</option>`).join('')}
                  </select></div>`;
                let h=q('Has it arrived?','delivered',i.delivered);
                if(arrived)h+=q('Wrong SKU?','wrongSku',i.wrongSku);
                if(arrived&&i.wrongSku==='Yes')h+=`<button class="csAct good" style="width:100%;margin-top:4px;" onclick="openSorted('${i.rid}','wrong-sku')" title="Nothing is lost — close it off right here">Sorted — nothing lost</button>`;
                else if(arrived&&i.wrongSku==='No')h+=`<div class="tfuGuide bad">Stock unaccounted for — dig in.</div>`;
                else if(i.delivered==='No')h+=`<button class="csAct warn" style="width:100%;margin-top:4px;" onclick="openSorted('${i.rid}')" title="Starts the refund close-off">Sorted — start the refund</button>`;
                else if(arrived)h+=`<div class="tfuGuide">Arrived — was it a wrong SKU? Answer above.</div>`;
                else if(isAmz)h+=`<div class="tfuGuide">Amazon order — can't tell? Send it to Jack.</div>`;
                else h+=`<div class="tfuGuide">Check emails, order history, tracking.</div>`;
                return h;})()}
            </td>
            <td style="vertical-align:middle;">
              ${(()=>{
                /* Jack's spec, near-verbatim: "Current status · Last action ·
                   Date of last action · Who owns it · What we're waiting for ·
                   Next action · When it's due." Three lines, built from the
                   issue's own log — never typed as a status. */
                let state,scol,last='',next='';
                const lw=t=>t?_logWhen(t):'';
                if(waiting){
                  const _jo=waiting.what==='amz-claim'||waiting.what==='amz-missing';
                  state=_jo?'JACK IS CHASING AMAZON':'WITH JACK — CHECKING THE ACCOUNT';scol=_jo?'#22d3ee':'#b6c2d4';
                  last=(_jo?'Becki checked the shelves — not here':'Sent to Jack')+(waiting.at?' · '+lw(waiting.at):'');
                  next=_jo?'Nothing for you — Jack raises the refund with Amazon':'Nothing for you — it comes back with his answer';
                }else if(i.kind==='transit'){
                  const sd=caseStanding(i.caseC);
                  if(sentBack&&sentBack.rejectNote&&(i.query||i.partOverdue||isAmz)){
                    /* Jack, 9 Sep: the panel still said "check the order — or
                       send to Jack" on rows he had already answered. His answer
                       is the latest line; the next move follows from it. */
                    const _a=String(sentBack.rejectNote||'');
                    const _rg=!!sentBack.restGone,_jn=!!sentBack.jackNote;
                    const _nc=!_rg&&!_jn&&/not arrived|nothing coming|cancel/i.test(_a);
                    const _ay=!_nc&&/arrived\s*[—-]\s*yes|shows it delivered|delivered/i.test(_a);
                    state=_jn?'JACK NEEDS A CHECK':'JACK ANSWERED';scol=_jn?'#fbbf24':'#f87171';
                    last=(_jn?'Asked':'Answered')+(sentBack.at?' · '+lw(sentBack.at):'')+(_jn?' — what he needs is in Triage':' — his answer is in Triage');
                    next=_jn?'Do the check, then send what you found to Jack (left)':_rg?'Note the sheet and close it — one press (left)':isAmz
                      ?(_nc?'Amazon refund it themselves — note the sheet and close it (left)':_ay?'Answer “wrong SKU?” on the left':'Record his answer and close it off (left)')
                      :(_nc?'Close it as cancelled or never arrived (left)':_ay?'Answer “wrong SKU?” on the left':'Pick the move that follows from his answer (left)');
                  }
                  else if(i.query){
                    const _qw=_queryWait(i.query);
                    state=_qw>=TM.queryRedDays?`QUESTION — ${_qw}D UNANSWERED`:'QUESTION FROM THE WAREHOUSE';scol=_qw>=TM.queryRedDays?'#ef4444':'#38bdf8';
                    last=`${i.query.by||'Warehouse'} — ${i.query.got?i.query.got+' of '+i.query.exp+' booked in. Is more on the way?':'Nothing booked in. Has it been dispatched?'}`+(i.query.at?' · '+lw(i.query.at):'');
                    next=isAmz?'Check the order \u2014 or Send to Jack if you can\u2019t see the account':'Check with the supplier \u2014 more coming (set the date) or nothing more (raise the shortfall)';
                  }
                  else if(i.partOverdue){
                    state='PART ARRIVED \u2014 REST OVERDUE';scol=i.col;
                    last=`${i.got} of ${i.units} booked in ${i.partSince} \u2014 nothing since`;
                    next=isAmz?'Check the order \u2014 or Send to Jack if you can\u2019t see the account':'Ask the supplier \u2014 more coming (set the date) or nothing more (raise the shortfall)';
                  }
                  else if(sd){
                    state=sd.overdue?`CHASE — ${sd.overdue}D OVERDUE`:(sd.dueIn!==null?'WAITING ON SUPPLIER':'BEING WORKED');
                    scol=sd.overdue?'#ef4444':(sd.dueIn!==null?'#60a5fa':'#fbbf24');
                    last=sd.was+(sd.by?' — '+sd.by:'')+(sd.at?' · '+lw(sd.at):'');
                    next=sd.now+(sd.dueIn!==null&&!sd.overdue&&i.caseC.due?` · by ${lw(i.caseC.due)}`:'');
                    /* a parked date that has slipped must not keep saying
                       "nothing to do" next to a red CHASE flag */
                    if(sd.overdue&&i.caseC.step==='due-date')next='The promised date has passed — arrived, or still nothing?';
                  }
                  else if(i.delivered==='Yes'&&i.wrongSku==='Yes'){state='WRONG SKU';scol='#fbbf24';
                    last=i.wentAs?('Arrived — it went out under <b>'+esc(i.wentAs)+'</b>'):'Arrived, went out under another SKU';
                    next=i.wentAs?'Press Sorted — nothing is lost':'Press Sorted — say which SKU if you know it';}
                  else if(i.delivered==='Yes'&&i.wrongSku==='No'){state='STOCK HUNT';scol='#ef4444';last='Arrived — but not a wrong SKU';next='Dig in, then send it to Jack';}
                  else if(i.delivered==='Yes'){state='ARRIVED \u2713';scol='#4ade80';last='Marked as arrived';next='Answer Wrong SKU? on the row';}
                  else if(i.delivered==='No'){state='NOT ARRIVED';scol='#f87171';last='Confirmed it never turned up';next='Work the refund steps in Triage';}
                  else if(i.expDate){const away=Math.round((new Date(i.expDate)-new Date())/864e5);
                    state=away<0?`WAS DUE ${Math.abs(away)}D AGO`:'DATE PROMISED';scol=away<0?'#f87171':'#4ade80';
                    last='Supplier promised '+lw(i.expDate);next=away<0?'It slipped — chase them':'Nothing until the date';}
                  else if(!ROW_SEEN[String(i.rid)]){
                    /* the trial starts 31 Aug — pre-trial history must not
                       count against her (Jack, 30 Aug) */
                    const _trialD=Math.max(0,Math.floor((Date.now()-new Date('2026-08-31').getTime())/864e5));
                    const loud=(Math.min(i.days||0,_trialD)>=7)||(i.value>=100)||(i.left!==null&&i.left>=0&&i.left<=7);
                    state='NEW — NOT OPENED';scol=loud?'#ef4444':'var(--text3)';
                    last=`Sitting ${i.days||0}d · ${fmtGBP2(i.value||0)} at stake${loud?' — nobody has opened it':''}`;
                    next='Answer \u201cHas it arrived?\u201d';
                  }else{
                    const sn=ROW_SEEN[String(i.rid)];
                    state='SEEN — NOT ANSWERED';scol='#fbbf24';
                    last='Opened by '+(sn.by||'')+' · '+lw(sn.at)+' — no answer recorded';
                    next='Answer \u201cHas it arrived?\u201d';
                  }
                }else if(i.kind==='claim'){
                  const ch3=i.claimC?_claimChaseInfo(i.claimC):{txt:'',col:'#f87171',days:0};
                  const fresh3=ch3.txt==='No contact yet';
                  state=fresh3?'NO CONTACT YET':'CHASING SUPPLIER';scol=fresh3?'#f87171':ch3.col;
                  if(i.lastLog&&i.lastLog.what)last=i.lastLog.what+(i.lastLog.at?' · '+lw(i.lastLog.at):'');
                  next=fresh3?'Check for a refund, then open a case':(ch3.days>=7?'Quiet for '+ch3.days+' days — chase again':'Wait for the reply, then record it');
                }else if(i.kind==='lav'){
                  state=i.jobNote?'JOB FROM JACK':(i.chased?'CHASING SUPPLIER':'NOT CHASED YET');scol=i.chased?'#4ade80':'#f87171';
                  if(i.lastLog&&i.lastLog.what)last=i.lastLog.what+(i.lastLog.by?' — '+i.lastLog.by:'')+(i.lastLog.at?' · '+lw(i.lastLog.at):'');
                  next=i.chased?'Wait for the reply, then record it':'Tell the supplier today';
                }else if(i.kind==='lavlate'){
                  state='JOB FROM JACK';scol='#f87171';
                  last=(sentBack&&sentBack.rejectNote?('Jack — '+sentBack.rejectNote+(sentBack.at?' · '+lw(sentBack.at):'')):(i.reason||''));
                  next='Got a date? Put it in (right). Otherwise do the job, then Done \u2014 back to Jack';
                }else{
                  state=/^jack/i.test(String(i.jobBy||''))?'JOB FROM JACK'
                        :(i.jobBy?'FOLLOW-UP FROM CLOSING A ROW':'JOB');
                  /* Jack, 4 Sep: "the notes look a mess." The whole closing
                     instruction was dumped in at full length above the
                     checklist, burying the three things she actually has to do.
                     It is reference, so it is clamped to two lines with the
                     rest on hover — the checklist is the point of this cell. */
                  scol='#94a3b8';last='';next='';
                }
                const note=(i.notes||'').trim();
                /* Jack, 30 Aug: "this needs to be super informative — the vital
                   part of the whole process and page." So: the expected date
                   with how far away it is, then the last three things that
                   actually happened, who did them and when — the row's story,
                   not just its label. */
                const _ds=s=>{const d=new Date(s);return isNaN(d)?String(s):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});};
                let expLine='';
                if(i.expDate){const aw=Math.round((new Date(i.expDate)-new Date())/864e5);
                  expLine=`<div class="stExp" style="color:${aw<0?'#f87171':'#4ade80'};">&#128197; expected ${_ds(i.expDate)}${aw<0?` — slipped ${Math.abs(aw)}d ago`:aw===0?' — today':` — in ${aw}d`}</div>`;}
                const _cl=(i.caseC&&i.caseC.log)||[];
                /* Jack, 4 Sep: "this column needs improving — it's a mega notes
                   section, maybe a dropdown with notes and more detail." Closed:
                   the state, the latest line in full, the next move. Open: the
                   whole story — every line, every note, the order's facts. */
                const _all=_cl.slice().reverse();
                const _open=_stOpen.has(String(i.rid));
                /* Jack, 9 Sep. The line already says who, so "· Jack — Jack
                   answered — Arrived — YES" said his name twice and buried the
                   answer behind two dashes. The name stays where it is; the
                   repeat comes off the front of what he said. */
                const _line=L=>{
                  let w=String(L.what||'');
                  if(L.by){const b=String(L.by).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
                    w=w.replace(new RegExp('^\\s*'+b+'\\s+(answered|said|confirmed)\\s*[—-]\\s*','i'),'')
                       .replace(new RegExp('^\\s*'+b+'\\s*[—-]\\s*','i'),'');}
                  return `<div class="stLog"><span class="stLogWhen">${esc(lw(L.at))}</span>${L.by?` · <b>${esc(L.by)}</b>`:''} — ${esc(w)}</div>`;};
                const hist=_open?_all.map(_line).join(''):(_all.length?_line(_all[0]):'');
                /* Jack, 9 Sep: "this looks horrible now." Five sentences of the
                   same size and weight stacked on top of each other, every one
                   repeating its own label in prose. Same facts, read as a list:
                   a quiet label on the left, the value on the right, and only
                   the one that costs money in red. */
                const _facts=[];
                if(i.kind==='transit'||i.kind==='lavlate'){const _wq=i.wentAsQty||0,_cq=Math.max(0,(i.cancelled||0)-_wq);
                  _facts.push(['Units',`${fmt(i.units)} ordered${i.qtyFix?` <span style="color:#fbbf24;">(sheet said ${fmt(i.qtyFix.from)} &mdash; corrected by ${esc(i.qtyFix.by||'Jack')})</span>`:''} &middot; ${fmt(i.got)} in &middot; ${fmt(i.outstanding)} still out${_cq?' &middot; '+fmt(_cq)+' cancelled':''}${_wq?' &middot; '+fmt(_wq)+' went out as '+(i.wentAs?esc(i.wentAs):'another SKU'):''}`]);}
                if(i.kind==='claim'||i.kind==='lav')_facts.push(['Units',`${fmt(i.units)} affected`]);
                if(i.oid)_facts.push(['Order',esc(i.oid)+(i.acct?' <span style="color:var(--text3);">&middot; '+esc(i.acct)+'</span>':'')]);
                if(i.sup)_facts.push(['Supplier',esc(i.sup)+(i.source?' <span style="color:var(--text3);">&middot; from the '+esc(i.source)+'</span>':'')]);
                if(i.date)_facts.push(['Ordered',esc(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(String(i.date))?String(i.date):_ds(i.date))+(i.days?' <span style="color:var(--text3);">&middot; '+i.days+'d ago</span>':'')]);
                if(i.expDate)_facts.push(['Expected',esc(_ds(i.expDate))]);
                {const L2=refundLeft(i.date,i);if(L2!==null)_facts.push(['Refund',L2<0?`<span style="color:#f87171;">window shut ${Math.abs(L2)}d ago</span>`:`${L2}d left to claim`]);}
                if(i.wentAs)_facts.push(['Went out as',esc(i.wentAs)]);
                if(i.query)_facts.push(['Question',esc(i.query.ask||'')+(i.query.note?' <span style="color:var(--text3);">&ldquo;'+esc(i.query.note)+'&rdquo;</span>':'')]);
                if(i.claimId&&i.kind==='transit')_facts.push(['Claim',`${esc(i.claimType||'')} ${fmtGBP2(i.claimVal||0)}${i.claimState?' <span style="color:var(--text3);">&middot; '+esc(i.claimState)+'</span>':''}`]);
                const _notes=[];
                if(i.srcNote)_notes.push(['When it was raised',i.srcNote,'#fcd34d']);
                if(i.packNote)_notes.push(['Packing note',i.packNote,'#fdba74']);
                if(i.vaNote)_notes.push(['VA note',i.vaNote,'#93c5fd']);
                if(note&&i.kind==='transit'&&note!==i.packNote)_notes.push(['Note',note,'#b6c2d4']);
                const _hasMore=i.kind!=='job'&&(_all.length>1||_facts.length||_notes.length||i.photos);
                const _ridAttr=esc(String(i.rid));
                const _more=!_hasMore?'':(_open?`
                  ${_facts.length?`<div class="stSec">The order</div><div class="stGrid">${_facts.map(([k,v])=>`<span class="stK">${k}</span><span class="stV">${v}</span>`).join('')}</div>`:''}
                  ${_notes.length?`<div class="stSec">Notes</div>${_notes.map(([k,v,c])=>`<div class="stNote" style="border-left-color:${c};"><b style="color:${c};">${k}:</b> ${esc(v)}</div>`).join('')}`:''}
                  ${i.photos?`<button class="csAct go" style="margin-top:6px;padding:3px 10px;" onclick="event.stopPropagation();window.open('${esc(i.photos)}','_blank')">&#128247; View photos</button>`:''}
                  <button class="stMore" data-rid="${_ridAttr}" onclick="stToggle(this,event)">&#9652; Less</button>`
                  :`<button class="stMore" data-rid="${_ridAttr}" onclick="stToggle(this,event)">&#9662; More${_all.length>1?' · '+(_all.length-1)+' earlier':''}${_notes.length?' · notes':''}</button>`);
                return `<div class="standBox" style="border-left-color:${scol};">
                  <div class="stState" style="color:${scol};">${state}</div>
                  ${i.qtyFix?`<div class="stFixNote" title="${esc(i.qtyFix.why||'')}"><b>${esc(i.qtyFix.by||'Jack')} corrected the quantity${i.qtyFix.at?' · '+esc(lw(i.qtyFix.at)):''}:</b> the sheet said <b>${fmt(i.qtyFix.from)}</b>, only <b>${fmt(i.qtyFix.to)}</b> were ordered. ${(String(i.sku||'').match(/_(\d+)$/)||[])[1]===String(i.qtyFix.from)?`The SKU still ends in <b>_${fmt(i.qtyFix.from)}</b> and the Purchase Sheet still says ${fmt(i.qtyFix.from)} &mdash; both need changing to ${fmt(i.qtyFix.to)}.`:`The Purchase Sheet still says ${fmt(i.qtyFix.from)} &mdash; change it to ${fmt(i.qtyFix.to)}.`}${i.qtyFix.why?` <i>&ldquo;${esc(i.qtyFix.why)}&rdquo;</i>`:''}</div>`:''}
                  ${expLine}
                  ${hist||(last?`<div class="stLast">${(i.wentAs&&/<b>/.test(last))?last:esc(last)}</div>`:'')}
                  ${next?`<div class="stNext">&#10132; ${esc(next)}</div>`:''}
                  ${(i.kind==='job'&&note)?`<div class="jobWhy" title="${note.replace(/"/g,'&quot;')}">${esc(note)}</div>`:''}
                  ${(i.kind==='job'&&i.jobList&&i.jobList.length)?`<div class="jobList">${i.jobList.map((j,n)=>
                    `<div class="jobLi"><span class="jobN">${n+1}</span><span class="jobT">${esc(j.task||'')}</span>
                      <button class="jobTick" title="Tick this one off" onclick="event.stopPropagation();doneVaActions(${JSON.stringify(j.ids||[j.id]).replace(/"/g,'&quot;')})">Done</button></div>`).join('')}
                    <div class="jobFoot">The row clears once all ${i.jobList.length} are ticked.</div></div>`:''}
                  ${(note&&i.kind==='transit'&&!waiting&&!_open)?`<div class="csNote" title="${note.replace(/"/g,'&quot;')}">&ldquo;${esc(note)}&rdquo;</div>`:''}
                  ${_more}
                </div>`;
              })()}
            </td>
            <td class="tfuActs" style="text-align:center;">
              ${(()=>{
                /* Jack: "MINIMAL CLICKS. SORTED DIRECTLY AVAILABLE. SEND TO
                   JACK ALWAYS EASY TO ACCESS." Every open row gets the same
                   stack: Sorted (amber, closes it), Send to Jack (blue, hands
                   it over), Details (the full case module — his rename of the
                   old "More\u2026"). A row that is with Jack shows only Details. */
                const esc1=s=>String(s).replace(/'/g,"\\'");
                if(i.acts)return i.acts;   /* a row that brought its own buttons (late Lavarion order) */
                if(i.sortedGrace)return `<button class="tfuAsk" style="margin-top:0;" onclick="reopenResolution('${i.rid}',true)" title="Bring it straight back — everything it knew is still on it">Undo — bring it back</button>
                  <button class="tfuWork" onclick="fileAway('${i.rid}')" title="Happy with it — files off this page. Nothing is deleted.">OK — file it</button>`;
                if(i.parkedRow)return `<button class="tfuAsk" style="margin-top:0;" onclick="unparkDate('${i.rid}')" title="Clears the date and brings the chase straight back">Undo — clear the date</button>
                  <button class="tfuWork" onclick="fileAway('${i.rid}')" title="Happy with it — files off this page until the date. Nothing is deleted.">OK — file it</button>`;
                if(waiting)return `<button class="tfuAsk" style="margin-top:0;" onclick="undoSend('${i.kind}','${i.kind==='claim'?i.claimId:i.kind==='lav'?esc1(i.lavKey):i.rid}')" title="Changed your mind — pull it back off Jack's list and carry on yourself">Undo — pull it back</button>
                  <button class="tfuMore" onclick="${
                  i.kind==='claim'?`openClaimCase('${i.claimId}')`:
                  i.kind==='lav'?`openLavIssue('${esc1(i.lavKey)}')`:
                  `openWork('${i.rid}')`}" title="Everything on this issue — it is locked while Jack has it">Details</button>`;
                /* Jack, 10 Sep: on a row he has just answered, Triage already
                   holds the one close that follows from his answer — a second
                   Sorted and a Send to Jack beside it were noise. */
                if(i.kind==='transit'&&sentBack)return `<button class="tfuMore" onclick="openWork('${i.rid}')" title="The full issue — source, notes, dates, history">Details</button>
                  <button class="tfuMore" onclick="askJackAsk('${i.rid}')" title="Something else for Jack on this one">Ask Jack again</button>
                  ${i.claimId?`<button class="tfuMore" style="border-color:rgba(251,191,36,.5);color:#fcd34d" onclick="openClaimCase('${i.claimId}')" title="The claim on this same order — chase it here">Claim &#163;${(i.claimVal||0).toFixed(2)}</button>`:''}`;
                if(i.kind==='transit')return `<button class="tfuWork" onclick="openSorted('${i.rid}')" title="Close it off — the popup opens already filled in with everything recorded">Sorted</button>
                  <button class="tfuAsk" onclick="askJackAsk('${i.rid}')" title="${isAmz?'Amazon order — only Jack can see this account':'Hand it to Jack — the row goes grey until he answers'}">Send to Jack</button>
                  <button class="tfuMore" onclick="openWork('${i.rid}')" title="The full issue — source, notes, dates, history">Details</button>
                  ${i.claimId?`<button class="tfuMore" style="border-color:rgba(251,191,36,.5);color:#fcd34d" onclick="openClaimCase('${i.claimId}')" title="The claim on this same order — chase it here">Claim &#163;${(i.claimVal||0).toFixed(2)}</button>`:''}`;
                if(i.kind==='claim')return `<button class="tfuWork" onclick="openClaimCase('${i.claimId}')" title="Everything on this claim in one place — how it ends is one press inside">Sorted</button>
                  <button class="tfuAsk" onclick="claimToJack('${i.claimId}')" title="Hand this claim to Jack — the row goes grey until he answers">Send to Jack</button>`;
                if(i.kind==='lav')return `<button class="tfuWork" onclick="openLavIssue('${esc1(i.lavKey)}')" title="Everything on this shortage in one place — how it ends is one press inside">Sorted</button>
                  <button class="tfuAsk" onclick="lavToJack('${esc1(i.lavKey)}')" title="Hand it to Jack — the row goes grey until he answers">Send to Jack</button>`;
                if(i.kind==='job')return (i.jobList&&i.jobList.length>1)
                  ? `<button class="tfuWork" onclick="if(confirm('Tick off all ${i.jobList.length}?'))doneVaActions(${JSON.stringify(i.jobList.flatMap(j=>j.ids||[j.id])).replace(/"/g,'&quot;')})" title="All of them are done">All done</button>`
                  : `<button class="tfuWork" onclick="doneVaAction('${i.jobId}')" title="Tell Jack it is done">Mark done</button>`;
                return `<button class="tfuWork" onclick="openWork('${i.rid}')">Details</button>`;
              })()}
            </td>
          </tr>`;
        };
        /* Jack, 30 Aug: "stuff she actions should stay in another section for
           48 working hours like the prep sheet — so we can undo" */
        const _work=items.filter(i=>!(i.sortedGrace||i.parkedRow));
        const _done=items.filter(i=>i.sortedGrace||i.parkedRow);
        if(!items.length)return `<tr><td colspan="99" style="padding:26px 16px;text-align:center;color:var(--text2);">
          <div style="font-size:13px;font-weight:800;margin-bottom:5px;">Nothing matches ${(_admQ||'').trim()?`&ldquo;${esc((_admQ||'').trim())}&rdquo;`:'that filter'}</div>
          <div style="font-size:12px;color:var(--text3);margin-bottom:11px;">The queue is not empty — this is just the search.</div>
          <button class="tfuWork" onclick="_admQ='';_admKind='all';renderAdmin();">Clear the search</button></td></tr>`;
        /* Jack, 10 Sep: "Sarah needs visibility of the whole journey — if her
           view makes items disappear whenever they leave her hands she won't
           know where the issue is, who owns it, or what has been checked. The
           system needs to separate ACTION OWNERSHIP from VISIBILITY."
           Same rows, same order within each group: what is hers to do, then
           the greyed-out ones she can only watch, each under its own heading
           with a count. */
        const _grp=i=>i.withBecki&&!i.waiting?'becki'
          :(i.waiting&&(i.waiting.what==='amz-claim'||i.waiting.what==='amz-missing'))?'chase'
          :i.waiting?'jack':'mine';
        const _order=['mine','jack','chase','becki'];
        const _head={mine:['Yours to sort out','#fbbf24','Work these top to bottom'],
          jack:['With Jack — checking the account','#b6c2d4','Nothing for you until he answers'],
          chase:['With Jack — chasing Amazon','#22d3ee','Becki checked the shelves and it is not there. Jack is claiming it.'],
          becki:['With Becki — checking the shelves','#22d3ee','Found: it books in and clears itself. Not there: it goes straight to Jack.']};
        const _sec=(k,n)=>`<tr class="admSecRow"><td colspan="8">
            <div class="admSec" style="border-left-color:${_head[k][1]};">
              <span class="admSecT" style="color:${_head[k][1]};">${_head[k][0]}</span>
              <span class="admSecN">${fmt(n)}</span>
              <span class="admSecW">${_head[k][2]}</span>
            </div></td></tr>`;
        {
          const by={};_work.forEach(i=>{(by[_grp(i)]=by[_grp(i)]||[]).push(i);});
          const live=_order.filter(k=>(by[k]||[]).length);
          if(live.length>1&&_admKind==='all'&&!(_admQ||'').trim()){
            let n=0,html='';
            live.forEach(k=>{html+=_sec(k,by[k].length)+by[k].map(i=>_rowHtml(i,n++)).join('');});
            return html+(_done.length?`<tr><td colspan="8" style="background:transparent;border:none;padding:12px 12px 4px;">
              <div class="doneStrip"><span class="doneLab">RECENTLY ACTIONED — ${fmt(_done.length)}</span>
                <span class="doneSub">yours to clear — OK files it, Undo brings it back · files itself after 48 working hours</span>
                <button class="tfuMore" style="margin:0" onclick="_showDone=!_showDone;renderAdmin();">${_showDone?'Hide':'Show'}</button></div></td></tr>`
              +(_showDone?_done.map((i,x)=>_rowHtml(i,_work.length+x)).join(''):''):'');
          }
        }
        return _work.map(_rowHtml).join('')
          +(_done.length?`<tr><td colspan="8" style="background:transparent;border:none;padding:12px 12px 4px;">
              <div class="doneStrip"><span class="doneLab">RECENTLY ACTIONED — ${fmt(_done.length)}</span>
                <span class="doneSub">yours to clear — OK files it, Undo brings it back · files itself after 48 working hours</span>
                <button class="tfuMore" style="margin:0" onclick="_showDone=!_showDone;renderAdmin();">${_showDone?'Hide':'Show'}</button></div></td></tr>`
            +(_showDone?_done.map((i,x)=>_rowHtml(i,_work.length+x)).join(''):''):'');
        })()}
        </tbody>
      </table>
      </div>
    </div>`;
  }

  // ── OPEN ISSUES — SPLIT QUEUES ──────────────────────────────────────────────
  // VA queue: Missing / Damaged / Not Arrived / Incorrect — investigate & chase.
  // Jack's queue: Gated — a decision (eBay vs ungate), not a chase.
  const _own=c=>c.owner||'VA';
  const vaIssues=openIssues.filter(c=>_own(c)!=='Jack');
  const jackIssues=openIssues.filter(c=>_own(c)==='Jack');
  const _issueRow=(c)=>{
          const sc=c.cst==='Needs Attention'?'#ff6b6b':c.cst==='Open'?'#f97316':c.cst==='Chasing'?'#fbbf24':'#64748b';
          const ch=_claimChaseInfo(c);
          const due=c.nextDue&&c.nextDue<todayISO();
          const chases=(c.log||[]).filter(e=>/chase|contact|emailed|called|messaged/i.test(e.msg||'')).length;
          const needsChase=_own(c)!=='Jack'&&c.cst!=='Resolved'&&ch.days>=4;
          const escalate=chases>=2&&c.cst==='Chasing';
          const gatedUndecided=c.issT==='Gated'&&!c.gatedDecision;
          return`<div style="padding:8px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                <span style="font-size:9px;font-weight:800;color:#0f172a;background:${sc};padding:2px 8px;border-radius:4px;white-space:nowrap;">${(c.cst||'').toUpperCase()}</span>
                <span style="font-size:11px;color:var(--text2);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px;">${c.prod||c.sku||'Issue'}</span>
                <span style="font-size:11px;color:var(--text2);font-weight:600;white-space:nowrap;">${c.issT||''} · ${c.dif||0} unit${(c.dif||0)===1?'':'s'}</span>
                ${needsChase?'<span style="font-size:8.5px;font-weight:800;color:#f87171;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);padding:1px 7px;border-radius:8px;white-space:nowrap;">CHASE AGAIN</span>':''}
                ${escalate?'<span style="font-size:8.5px;font-weight:800;color:#fb923c;background:rgba(251,146,60,.12);border:1px solid rgba(251,146,60,.35);padding:1px 7px;border-radius:8px;white-space:nowrap;">2+ CHASES — ESCALATE?</span>':''}
                ${gatedUndecided?'<span style="font-size:8.5px;font-weight:800;color:#c084fc;background:rgba(192,132,252,.12);border:1px solid rgba(192,132,252,.35);padding:1px 7px;border-radius:8px;white-space:nowrap;">NO DECISION YET</span>':''}
              </div>
              <div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
                <span style="font-size:11px;font-family:var(--mono);font-weight:700;color:#fbbf24;">${fmtGBP2(c.claimValue||0)}</span>
                ${c.cst==='Needs Attention'?`<button onclick="adminMarkReviewed('${c.id}')" style="padding:3px 9px;background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.4);color:#f97316;border-radius:4px;font-size:11px;font-weight:800;cursor:pointer;">✓ Reviewed</button>`:''}
                ${_own(c)!=='Jack'&&c.cst!=='Resolved'?`<button onclick="adminQuickChase('${c.id}')" style="padding:3px 9px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.35);color:#60a5fa;border-radius:4px;font-size:11px;font-weight:800;cursor:pointer;">📞 Chased today</button>`:''}
                ${c.issT==='Gated'&&c.cst!=='Resolved'&&!c.gatedDecision?`<button onclick="setGatedDecision('${c.id}','eBay')" style="padding:3px 9px;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);color:#34d399;border-radius:4px;font-size:11px;font-weight:800;cursor:pointer;">eBay</button><button onclick="setGatedDecision('${c.id}','Ungate')" style="padding:3px 9px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.35);color:#60a5fa;border-radius:4px;font-size:11px;font-weight:800;cursor:pointer;">Ungate</button>`:''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:14px;margin-top:5px;padding-left:2px;">
              <span style="font-size:10px;font-weight:700;color:${ch.col};">${ch.txt}</span>
              <span style="font-size:10px;color:${c.nextAction?'var(--text2)':'#f87171'};font-weight:${c.nextAction?'500':'800'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px;">⭢ ${c.nextAction?c.nextAction:'No next action set'}${c.nextDue?` <span style="color:${due?'#f87171':'var(--text3)'};font-weight:700;">(due ${c.nextDue}${due?' — OVERDUE':''})</span>`:''}</span>
            </div>
          </div>`;
  };
  let _jackSec='';
  if(jackIssues.length){
    _jackSec=`<div style="background:var(--bg2);border:1px solid var(--border);border-left:4px solid #c084fc;border-radius:8px;overflow:hidden;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(192,132,252,.06);">
        <div style="font-size:13px;font-weight:800;color:var(--text);">🔒 Jack — Gated decisions (${jackIssues.length})</div>
        <div style="font-size:10px;font-weight:700;color:#c084fc;background:rgba(192,132,252,.12);padding:3px 10px;border-radius:10px;">eBay it or ungate it</div>
      </div>
      <div style="padding:6px 14px 12px;">
        ${jackIssues.slice().sort((a,b)=>(a.gatedDecision?1:0)-(b.gatedDecision?1:0)).map(_issueRow).join('')}
      </div>
    </div>`;
  }
  let _vaSec='';
  if(vaIssues.length){
    _vaSec=`<div style="background:var(--bg2);border:1px solid var(--border);border-left:4px solid #fbbf24;border-radius:8px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(251,191,36,.06);">
        <div style="font-size:13px;font-weight:800;color:var(--text);">⚑ VA — Investigate &amp; chase (${vaIssues.length})</div>
        <button onclick="navToPage('claims')" style="font-size:10px;font-weight:700;color:#fbbf24;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3);padding:3px 10px;border-radius:10px;cursor:pointer;">Open Issues page →</button>
      </div>
      <div style="padding:6px 14px 12px;">
        ${/* vaIssues, NOT openIssues — the heading counted the VA's own issues
             while the body listed everyone's, so Jack's five gated decisions
             appeared as Sarah's work under a heading that said "(1)". */
          vaIssues.slice().sort((a,b)=>(({'Needs Attention':0,'Open':1,'Chasing':2})[a.cst]??1)-(({'Needs Attention':0,'Open':1,'Chasing':2})[b.cst]??1)||(_claimChaseInfo(b).days-_claimChaseInfo(a).days)).slice(0,12).map(c=>{
          const sc=c.cst==='Needs Attention'?'#ff6b6b':c.cst==='Open'?'#f97316':c.cst==='Chasing'?'#fbbf24':'#64748b';
          const ch=_claimChaseInfo(c);
          const due=c.nextDue&&c.nextDue<todayISO();
          return`<div style="padding:8px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                <span style="font-size:9px;font-weight:800;color:#0f172a;background:${sc};padding:2px 8px;border-radius:4px;white-space:nowrap;">${(c.cst||'').toUpperCase()}</span>
                <span style="font-size:11px;color:var(--text2);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px;">${c.prod||c.sku||'Issue'}</span>
                <span style="font-size:11px;color:var(--text2);font-weight:600;white-space:nowrap;">${c.issT||c.issueType||''} · ${c.dif||0} unit${(c.dif||0)===1?'':'s'}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
                <span style="font-size:11px;font-family:var(--mono);font-weight:700;color:#fbbf24;">${fmtGBP2(c.claimValue||0)}</span>
                ${c.cst==='Needs Attention'?`<button onclick="adminMarkReviewed('${c.id}')" style="padding:3px 9px;background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.4);color:#f97316;border-radius:4px;font-size:11px;font-weight:800;cursor:pointer;">✓ Reviewed</button>`:''}
                ${c.cst!=='Resolved'?`<button onclick="adminQuickChase('${c.id}')" style="padding:3px 9px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.35);color:#60a5fa;border-radius:4px;font-size:11px;font-weight:800;cursor:pointer;">📞 Chased today</button>`:''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:14px;margin-top:5px;padding-left:2px;">
              <span style="font-size:10px;font-weight:700;color:${ch.col};">${ch.txt}</span>
              <span style="font-size:10px;color:${c.nextAction?'var(--text2)':'#f87171'};font-weight:${c.nextAction?'500':'800'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px;">⭢ ${c.nextAction?c.nextAction:'No next action set — decide one on the Issues page'}${c.nextDue?` <span style="color:${due?'#f87171':'var(--text3)'};font-weight:700;">(due ${c.nextDue}${due?' — OVERDUE':''})</span>`:''}</span>
            </div>
          </div>`;
        }).join('')}
        ${openIssues.length>12?`<div style="font-size:10px;color:var(--text3);text-align:center;padding-top:8px;">+${openIssues.length-12} more on the Issues page</div>`:''}
      </div>
    </div>`;
  }

  /* Order = who has to act, not the order it happens to be coded in. Sarah's
     own issues used to render dead last, below the fold, which is why they sat
     unactioned for weeks. Hers first, Jack's gated decisions after. */
  /* _jackSec is deliberately NOT rendered here. Gated decisions are Jack's and
     Sarah can do nothing with them — sitting on her page they were noise she had
     to scroll past, and they made her own queue look longer than it was. They
     reach Jack from the Dashboard banner instead. */
  /* Gated appears NOWHERE on this page. A strip saying "nothing for you to do
     here" is still something she has to read and scroll past. It lives on the
     Dashboard (Jack's landing page) and the Issues page, and nowhere else. */
  /* Queue-only by default. `_vaSec` is gone entirely — those claims are in the
     queue now. The transit table is kept behind a toggle: it is still the best
     surface for scanning and sorting everything at once, it just must not sit
     under the queue repeating it. */
  /* Jack, 17 Aug: "get rid of this" — the Closed-off-recently list is gone.
     The grey 24h row with its own Undo button replaced it; closedSection()
     is kept for the History work but no longer composed onto the page. */
  const _sections=(_showAllTransit?_transitSec:'');
  /* Three sections can all be empty at once. Say so once, rather than leaving
     a check-in strip floating above a page of nothing. */
  html+=_sections||`<div class="vaSec" style="border-left:4px solid var(--green);">
    <div class="vaHd"><h4>Nothing outstanding</h4>
      <span class="vaWhy">Nothing to chase, nothing to finish off. Press Checked and you're done.</span></div>
  </div>`;

  wrap.innerHTML=html;
  _restoreScroll();
  /* fires the reminder if this page has gone unchecked past the deadline */
  checkInWatch();
  try{jackDigestWatch();}catch(e){}
}

// Visual status pipeline — replaces the bare dropdown. Click a step to move
// the issue there; each stage says exactly what it means so nobody guesses.
let _expandedClaims=new Set();
function toggleClaim(id){
  id=String(id);
  if(_expandedClaims.has(id))_expandedClaims.delete(id);else _expandedClaims.add(id);
  renderClaims();
}
const CLAIM_STAGES=[
  {s:'Needs Attention',short:'NEW',col:'#ff6b6b',desc:'Just raised — nobody has reviewed this yet'},
  {s:'Open',short:'REVIEWED',col:'#f97316',desc:'Reviewed — plan decided, not yet chased'},
  {s:'Chasing',short:'CHASING',col:'#fbbf24',desc:'Waiting on supplier / Amazon to reply'},
  {s:'Resolved',short:'RESOLVED',col:'#4ade80',desc:'Closed — recovered, replaced or written off'},
];
function claimStepper(c){
  const idx=Math.max(0,CLAIM_STAGES.findIndex(st=>st.s===c.cst));
  const cur=CLAIM_STAGES[idx];
  return `<div>
    <div style="display:flex;align-items:center;">
      ${CLAIM_STAGES.map((st,i)=>{
        const done=i<idx,on=i===idx;
        const circ=on?`background:${st.col};color:#0b1220;border:2px solid ${st.col};box-shadow:0 0 8px ${st.col}55;`
                 :done?`background:${st.col}22;color:${st.col};border:2px solid ${st.col}66;`
                 :`background:transparent;color:#5c6675;border:2px solid rgba(255,255,255,.14);`;
        return `${i>0?`<div style="flex:1;height:2px;background:${i<=idx?cur.col+'66':'rgba(255,255,255,.1)'};min-width:6px;"></div>`:''}
        <div onclick="updateClaimSt('${c.id}','${st.s}')" title="${st.s} — ${st.desc}" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:44px;">
          <div style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;${circ}">${done?'✓':i+1}</div>
          <div style="font-size:7.5px;font-weight:800;letter-spacing:.04em;color:${on?st.col:done?st.col+'aa':'#5c6675'};white-space:nowrap;">${st.short}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:8px;font-size:10px;color:${cur.col};font-weight:600;line-height:1.4;background:${cur.col}12;border:1px solid ${cur.col}30;border-radius:5px;padding:5px 8px;">${cur.desc}</div>
  </div>`;
}
function renderClaims(){
  /* Realtime 'actions' events called this on every laptop even with the page
     hidden — a multi-line close-off meant 10-20 invisible rebuilds. goPage
     repaints on entry, so skipping while unseen loses nothing. (v21.3 pattern) */
  if(document.hidden||!_pageActive('page-claims'))return;
  const el=document.getElementById('claimList');
  const q=(document.getElementById('claimSrch')||{}).value?.toLowerCase()||'';
  const sf=(document.getElementById('claimStF')||{}).value||'';
  const of=(document.getElementById('claimOwnF')||{}).value||'';
  let d=claims.filter(r=>
    !r.archived&&
    (!q||(r.sku+r.asin+r.sup+r.prod+r.oid).toLowerCase().includes(q))&&
    (!sf||r.cst===sf)&&
    (!of||(r.owner||((r.issT==='Gated')?'Jack':'VA'))===of)
  );
  updateCB();
  // Work-queue order: unreviewed first, resolved last; oldest first within a
  // stage so nothing can hide at the bottom for weeks.
  const _stW={'Needs Attention':0,'Open':1,'Chasing':2,'Resolved':3};
  d.sort((a,b)=>((_stW[a.cst]??1)-(_stW[b.cst]??1))||String(a.raisedAt||'').localeCompare(String(b.raisedAt||'')));
  if(!d.length){
    el.innerHTML=`<div class="empty"><div class="empty-ico">✅</div><div class="empty-t">${q||sf?'No actions match your search':'No open actions — raise one from the Prep Sheet or use the button above'}</div></div>`;
    return;
  }

  // Summary bar
  const totalVal=d.filter(c=>c.cst!=='Resolved').reduce((a,c)=>a+(c.claimValue||0),0);
  const openCount=d.filter(c=>c.cst==='Open').length;
  const chasingCount=d.filter(c=>c.cst==='Chasing').length;
  const resolvedCount=d.filter(c=>c.cst==='Resolved').length;
  const totalUnits=d.filter(c=>c.cst!=='Resolved').reduce((a,c)=>a+(c.dif||0),0);

  // Tiles count ALL live claims (not the filtered view) so the totals never
  // lie when a search or status filter is active — and each tile IS the filter.
  const A=claims.filter(r=>!r.archived);
  const issueCount=A.filter(c=>c.cst==='Needs Attention').length;
  const openOnlyCount=A.filter(c=>c.cst==='Open').length;
  const chasingAll=A.filter(c=>c.cst==='Chasing').length;
  const resolvedAll=A.filter(c=>c.cst==='Resolved').length;

  // Reimbursed-aware recovery: a resolved claim only counts as recovered when
  // it was actually reimbursed. The rest is still owed.
  const resolvedClaimsD=d.filter(c=>c.cst==='Resolved');
  const reimbursedVal=resolvedClaimsD.filter(c=>c.reimbursed==='Yes').reduce((a,c)=>a+(c.claimValue||0),0);
  const owedVal=resolvedClaimsD.filter(c=>(c.reimbursed||'No')==='No').reduce((a,c)=>a+(c.claimValue||0),0);
  const partialCount=resolvedClaimsD.filter(c=>c.reimbursed==='Partial').length;
  const recSub=owedVal>0?(fmtGBP2(owedVal)+' still owed'+(partialCount?` · ${partialCount} partial`:'')):(reimbursedVal>0?'All recovered ✓':'—');

  const tile=(label,val,col,sub,fv)=>`<div onclick="(function(){const s=document.getElementById('claimStF');if(s){s.value=s.value==='${fv??''}'?'':'${fv??''}';renderClaims();}})()" title="Click to filter" style="cursor:pointer;background:${col}14;border:3px solid ${col}${(sf===(fv??''))&&fv?'':'88'};border-radius:8px;padding:12px 14px;flex:1;min-width:90px;">
    <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700;">${label}</div>
    <div style="font-size:26px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1;">${val}</div>
    ${sub?`<div style="font-size:11px;color:#94a3b8;margin-top:4px;font-weight:600;">${sub}</div>`:''}
  </div>`;

  // Money line: computed from ALL live claims so it never lies under a filter.
  const _live=A.filter(c=>c.cst!=='Resolved');
  const _atRisk=_live.reduce((a,c)=>a+(c.claimValue||0),0);
  const _oldest=_live.reduce((mx,c)=>{if(!c.raisedAt)return mx;const dd=Math.floor((new Date()-new Date(c.raisedAt))/864e5);return Math.max(mx,dd);},0);
  const _resA=A.filter(c=>c.cst==='Resolved');
  const _owedA=_resA.filter(c=>(c.reimbursed||'No')==='No').reduce((a,c)=>a+(c.claimValue||0),0);
  el.innerHTML=`
    ${/* the money strip said what the owner boxes below now say, twice over */''}
    ${(()=>{
      /* Six tiles counting statuses told you the shape of the list, not what to
         do with it — and four of them were one click away in the filter anyway.
         Split by who has to act instead, which is the rule we actually work to:
         Sarah investigates, Jack decides, gated is always Jack. */
      const own=c=>c.owner||'VA';
      const live=A.filter(c=>c.cst!=='Resolved');
      const gated=live.filter(c=>c.issT==='Gated');
      const jackOther=live.filter(c=>own(c)==='Jack'&&c.issT!=='Gated');
      const sarah=live.filter(c=>own(c)!=='Jack');
      const unpaid=A.filter(c=>c.cst==='Resolved'&&(c.reimbursed||'No')==='No');
      const unpaidVal=unpaid.reduce((a,c)=>a+(c.claimValue||0),0);
      const money=l=>l.reduce((a,c)=>a+(c.claimValue||0),0);
      const oldest=l=>l.reduce((m,c)=>{if(!c.raisedAt)return m;
        return Math.max(m,Math.floor((new Date()-new Date(c.raisedAt))/864e5));},0);
      const box=(col,who,list,what,filt)=>`<div class="iqBox" style="border-left:4px solid ${col};"
          onclick="const s=document.getElementById('claimOwnF');if(s){s.value=s.value==='${filt}'?'':'${filt}';renderClaims();}">
        <div class="iqN" style="color:${col};">${list.length}</div>
        <div class="iqWho">${who}</div>
        <div class="iqWhat">${what}</div>
        ${list.length?`<div class="iqMoney">${fmtGBP2(money(list))} · oldest ${oldest(list)}d</div>`:'<div class="iqMoney">nothing waiting</div>'}
      </div>`;
      return`<div class="iqGrid">
        ${box('#c084fc','Gated — yours',gated,'eBay it, ungate it, hold or write off','Jack')}
        ${box('#60a5fa','Decisions — yours',jackOther,'Investigated already, needs your call','Jack')}
        ${box('#fbbf24','Sarah',sarah,'Investigate, chase, record what happened','VA')}
        ${unpaid.length?`<div class="iqBox" style="border-left:4px solid #34d399;">
          <div class="iqN" style="color:#34d399;">${fmtGBP2(unpaidVal)}</div>
          <div class="iqWho">Owed to you</div>
          <div class="iqWhat">Resolved but never paid — the easiest money to collect</div>
          <div class="iqMoney">${unpaid.length} claim${unpaid.length===1?'':'s'} · nobody is chasing these</div>
        </div>`:''}
      </div>`;
    })()}

    ${(()=>{
      /* One flat list of thirteen rows told you nothing about who owns what.
         Grouped by whose job it is, in the order the work actually flows:
         Sarah investigates → escalates to Jack → money gets collected. */
      const _own=c=>c.owner||'VA';
      const _row=c=>{
      const skuParsed=parseSKU(c.sku);
      const statusCol=c.cst==='Needs Attention'?'#ff6b6b':c.cst==='Open'?'#f97316':c.cst==='Chasing'?'#fbbf24':c.cst==='Resolved'?'#4ade80':'#64748b';
      const borderCol=c.cst==='Needs Attention'?'#ff6b6b':c.cst==='Open'?'#f97316':c.cst==='Chasing'?'#fbbf24':c.cst==='Resolved'?'#4ade80':'var(--border)';
      const allLog=c.log||[];
      // Split log into status changes vs contact entries
      const statusLog=allLog.filter(e=>(e.msg||'').startsWith('Status changed'));
      const contactLog=allLog.filter(e=>!(e.msg||'').startsWith('Status changed')&&!(e.msg||'').startsWith('Action raised')&&!(e.msg||'').startsWith('Claim created'));
      const isHighValue=(c.claimValue||0)>=50;
      const account=c.acct||'';
      const cogUnit=c.cost||skuParsed.cogs||0;
      const daysOpen=c.raisedAt?(()=>{const d=new Date(c.raisedAt),now=new Date();return Math.floor((now-d)/864e5);})()||0:0;
      // ── Compact triage row: one scannable line, click to expand the full card ──
      const open=_expandedClaims.has(String(c.id))||d.length===1;
      const chInfo=_claimChaseInfo(c);
      const isJack=(c.owner||'VA')==='Jack';
      const chasesN=(c.log||[]).filter(e=>/chase|contact|emailed|called|messaged/i.test(e.msg||'')).length;
      const fChase=!isJack&&c.cst!=='Resolved'&&chInfo.days>=4;
      const fEsc=chasesN>=2&&c.cst==='Chasing';
      const fGated=c.issT==='Gated'&&!c.gatedDecision&&c.cst!=='Resolved';
      const fDue=c.nextDue&&c.nextDue<todayISO()&&c.cst!=='Resolved';
      const flagChip=(t,col)=>`<span style="font-size:8px;font-weight:800;color:${col};background:${col}1c;border:1px solid ${col}55;padding:1px 6px;border-radius:8px;white-space:nowrap;">${t}</span>`;
      return`<div style="background:var(--bg2);border:1px solid ${open?borderCol+'55':'var(--border)'};border-left:3px solid ${borderCol};border-radius:8px;margin-bottom:${open?'14':'6'}px;overflow:hidden;">
      <div onclick="toggleClaim('${c.id}')" style="display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:pointer;user-select:none;${open?`background:${statusCol}0d;border-bottom:1px solid var(--border);`:''}" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='${open?statusCol+'0d':''}'">
        <span style="font-size:10px;color:#8b9bb3;width:10px;">${open?'▾':'▸'}</span>
        ${(()=>{
          /* A status word tells you where a thing sits in a workflow. It does
             not tell you what to do, which is the only reason anyone opens this
             page. The next action leads the row now; status is a colour bar. */
          const act=c.cst==='Resolved'
              ? ((c.reimbursed||'No')==='No'?'Chase the money — resolved, never paid':'Done')
            : fGated ? 'Decide: eBay it or get ungated'
            : c.cst==='Needs Attention' ? 'Read it and decide what happens'
            : !c.nextAction ? 'Set what happens next'
            : fDue ? c.nextAction+' — overdue'
            : fChase ? 'Chase again — '+chInfo.txt.toLowerCase()
            : c.nextAction;
          const col=c.cst==='Resolved'
              ? ((c.reimbursed||'No')==='No'?'#34d399':'#64748b')
            : (fGated?'#c084fc':(fDue||fChase||c.cst==='Needs Attention')?'#f87171':'#fbbf24');
          return`<span class="iqAct" style="color:${col};" title="${esc(act)}">${esc(act)}</span>`;
        })()}
        <span class="iqDot" style="background:${statusCol};" title="${esc(c.cst||'')}"></span>
        <span class="iqHide" style="font-size:9px;font-weight:900;padding:3px 9px;border-radius:4px;background:${statusCol};color:#0f172a;letter-spacing:.03em;white-space:nowrap;">${(c.cst||'').toUpperCase()}</span>
        <span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:4px;white-space:nowrap;background:${isJack?'rgba(192,132,252,.16)':'rgba(52,211,153,.14)'};color:${isJack?'#c084fc':'#34d399'};">${isJack?'JACK':'VA'}</span>
        <span style="font-size:10px;font-weight:700;color:#cbd5e1;white-space:nowrap;">${c.issT||'Issue'} · ${c.dif||0} unit${(c.dif||0)===1?'':'s'}</span>
        <span class="iqProd" title="${(c.prod||'').replace(/"/g,'&quot;')}">${c.prod||c.sku||'—'}</span>
        ${fGated?flagChip('NO DECISION','#c084fc'):''}
        ${fChase?flagChip('CHASE AGAIN','#f87171'):''}
        ${fEsc?flagChip('ESCALATE?','#fb923c'):''}
        ${fDue?flagChip('OVERDUE','#f87171'):''}
        ${c.cst!=='Resolved'?`<span style="font-size:9.5px;color:${chInfo.col};font-weight:700;white-space:nowrap;">${chInfo.txt}</span>`:''}
        <span style="font-size:9.5px;color:#8b9bb3;white-space:nowrap;">${daysOpen}d open</span>
        <span style="font-size:11.5px;font-family:var(--mono);font-weight:800;color:#fbbf24;white-space:nowrap;">${fmtGBP2(c.claimValue||0)}</span>
      </div>
      ${open?`<div style="border-top:3px solid ${borderCol};margin-top:-1px;">

        <!-- ── TOP STRIP: status badges + meta ─────────────────────────────── -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:${statusCol}0d;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:900;padding:4px 12px;border-radius:4px;background:${statusCol};color:#0f172a;letter-spacing:.04em;">${c.cst.toUpperCase()}</span>
            <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;background:rgba(255,255,255,.08);color:#e2e8f0;">${c.issT||'Issue'}</span>
            ${isHighValue?`<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:4px;background:#fbbf2422;color:#fbbf24;border:1px solid #fbbf2444;">⚡ HIGH VALUE</span>`:''}
            ${c.prepRowId?`<span style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(96,165,250,.15);color:#60a5fa;border:1px solid rgba(96,165,250,.25);">⬆ From Prep Sheet</span>`:''}
            ${(()=>{const j=(c.owner||'VA')==='Jack';return `<span onclick="setClaimOwner('${c.id}')" title="Click to reassign" style="cursor:pointer;font-size:11px;font-weight:800;padding:3px 8px;border-radius:4px;background:${j?'rgba(192,132,252,.16)':'rgba(52,211,153,.14)'};color:${j?'#c084fc':'#34d399'};border:1px solid ${j?'rgba(192,132,252,.35)':'rgba(52,211,153,.3)'};">${j?'👤 JACK':'👤 VA'}</span>`;})()}
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="text-align:right;">
              <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:1px;">Raised</div>
              <div style="font-size:11px;font-weight:700;color:#cbd5e1;">${c.date||c.raisedAt||'—'}${daysOpen>0?` <span style="color:#94a3b8;">(${daysOpen}d ago)</span>`:''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:1px;">Claim Value</div>
              <div style="font-size:16px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${(c.claimValue||0)>0?'#fbbf24':'#475569'};">${fmtGBP2(c.claimValue||0)}</div>
            </div>
          </div>
        </div>

        <!-- ── MAIN BODY ───────────────────────────────────────────────────── -->
        <div style="display:grid;grid-template-columns:1fr 220px;min-height:0;">

          <!-- LEFT: all the product + order detail -->
          <div style="padding:12px 14px;border-right:1px solid var(--border);">

            <!-- Product name -->
            <div style="font-size:13px;font-weight:800;color:#f1f5f9;margin-bottom:10px;line-height:1.3;">${c.prod||c.sku||'—'}</div>

            <!-- Order info row -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:6px;border:1px solid rgba(255,255,255,.06);">
              ${c.sup?`<div>
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;font-weight:700;">Supplier</div>
                <div style="font-size:12px;font-weight:800;color:#38bdf8;">${c.sup}</div>
              </div>`:'<div></div>'}
              ${c.oid?`<div>
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;font-weight:700;">Order ID</div>
                <div style="font-size:12px;font-weight:700;color:#e2e8f0;font-family:var(--mono);">${c.oid}</div>
              </div>`:'<div></div>'}
              <div>
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;font-weight:700;">Account</div>
                <div style="font-size:12px;font-weight:800;color:#c084fc;">${account||'<span style=\"color:#475569;font-size:10px;\">—</span>'}</div>
              </div>
              <div>
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;font-weight:700;">COG / Unit</div>
                <div style="font-size:12px;font-weight:800;color:#fbbf24;font-family:var(--mono);">${fmtGBP2(cogUnit)}</div>
              </div>
              <div>
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;font-weight:700;">Issue Type</div>
                <div style="font-size:12px;font-weight:800;color:#f87171;">${c.issT||'—'}</div>
              </div>
            </div>

            <!-- SKU + ASIN chips -->
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
              <span class="s-sku" onclick="copyVal('${c.sku}',this)" style="display:inline-flex;font-size:11px;">${c.sku||'—'}</span>
              ${c.asin?`<span class="s-asin" onclick="copyVal('${c.asin}',this)" style="display:inline-flex;font-size:11px;">${c.asin}</span>`:''}
            </div>

            <!-- Units bar -->
            <div style="display:flex;align-items:stretch;gap:0;border:1px solid rgba(255,255,255,.08);border-radius:6px;overflow:hidden;margin-bottom:8px;">
              <div style="flex:1;padding:7px 8px;background:rgba(96,165,250,.08);text-align:center;border-right:1px solid rgba(255,255,255,.06);">
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700;">Expected</div>
                <div style="font-size:24px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#60a5fa;line-height:1;">${c.exp||0}</div>
              </div>
              <div style="display:flex;align-items:center;padding:0 10px;color:#334155;font-size:18px;">→</div>
              <div style="flex:1;padding:7px 8px;background:rgba(255,255,255,.04);text-align:center;border-right:1px solid rgba(255,255,255,.06);">
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700;">Received</div>
                <div style="font-size:24px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#e2e8f0;line-height:1;">${c.rec||0}</div>
              </div>
              <div style="display:flex;align-items:center;padding:0 10px;color:#334155;font-size:18px;">→</div>
              <div style="flex:1;padding:7px 8px;background:rgba(248,113,113,.08);text-align:center;border-right:1px solid rgba(255,255,255,.06);">
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700;">${c.issT||'Affected'}</div>
                <div style="font-size:24px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#f87171;line-height:1;">${c.dif||0}</div>
              </div>
              <div style="flex:1.2;padding:7px 10px;background:rgba(251,191,36,.07);text-align:center;">
                <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700;">£ at Risk</div>
                <div style="font-size:18px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:#fbbf24;line-height:1;">${fmtGBP2((c.dif||0)*(cogUnit||0))}</div>
              </div>
            </div>

            <!-- Notes -->
            ${c.notes?`<div style="padding:10px 12px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.18);border-radius:6px;margin-bottom:12px;">
              <div style="font-size:9.5px;font-weight:800;color:#fbbf24;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">📝 Notes</div>
              <div style="font-size:12px;color:#e2e8f0;line-height:1.5;">${c.notes}</div>
            </div>`:''}

            <!-- VA + Jack/Supplier notes (two separate boxes) -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
              <div style="background:rgba(96,165,250,.06);border:1px solid rgba(96,165,250,.18);border-radius:6px;padding:8px 10px;">
                <div style="font-size:9.5px;font-weight:800;color:#60a5fa;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">VA Notes</div>
                <textarea onchange="updateClaimField('${c.id}','vaNote',this.value)" placeholder="Follow-ups, tracking, escalations…" style="width:100%;min-height:46px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);border-radius:4px;color:#e2e8f0;font-size:11px;line-height:1.4;padding:6px 8px;resize:vertical;outline:none;box-sizing:border-box;font-family:inherit;">${(c.vaNote||'').replace(/</g,'&lt;')}</textarea>
              </div>
              <div style="background:rgba(192,132,252,.06);border:1px solid rgba(192,132,252,.18);border-radius:6px;padding:8px 10px;">
                <div style="font-size:9.5px;font-weight:800;color:#c084fc;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Jack / Supplier Notes</div>
                <textarea onchange="updateClaimField('${c.id}','jackNote',this.value)" placeholder="Supplier replies, decisions, refs…" style="width:100%;min-height:46px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);border-radius:4px;color:#e2e8f0;font-size:11px;line-height:1.4;padding:6px 8px;resize:vertical;outline:none;box-sizing:border-box;font-family:inherit;">${(c.jackNote||'').replace(/</g,'&lt;')}</textarea>
              </div>
            </div>

            <!-- Contact Log section -->
            <div style="border:1px solid rgba(255,255,255,.07);border-radius:6px;overflow:hidden;">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,.04);border-bottom:${contactLog.length>0?'1px solid rgba(255,255,255,.07)':'none'};">
                <div style="font-size:10px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">📋 Contact Log <span style="color:#475569;font-weight:600;">(${contactLog.length} entr${contactLog.length===1?'y':'ies'})</span></div>
                <button onclick="openClaimLog('${c.id}')" style="font-size:11px;padding:3px 8px;background:rgba(96,165,250,.15);border:1px solid rgba(96,165,250,.3);color:#60a5fa;border-radius:4px;cursor:pointer;font-weight:700;">+ Add Entry</button>
              </div>
              ${contactLog.length>0?`<div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;">
                ${contactLog.slice().reverse().map(e=>`<div style="display:flex;gap:12px;align-items:flex-start;padding:6px 8px;background:rgba(255,255,255,.03);border-radius:4px;border-left:2px solid #3b82f6;">
                  <span style="font-size:10px;color:#60a5fa;white-space:nowrap;font-family:var(--mono);font-weight:700;padding-top:1px;">${e.t||''}</span>
                  <span style="font-size:12px;color:#e2e8f0;flex:1;line-height:1.4;">${e.msg||''}</span>
                </div>`).join('')}
              </div>`:`<div style="padding:12px;text-align:center;font-size:11px;color:#475569;">No contact entries yet — add one when you've contacted the supplier</div>`}
            </div>

          </div>

          <!-- RIGHT: action panel -->
          <div style="padding:10px;display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,.01);">

            <!-- Status control -->
            <div style="padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;">
              <div style="font-size:10px;font-weight:800;color:#b6c2d4;text-transform:uppercase;letter-spacing:.11em;margin-bottom:10px;">Status</div>
              ${claimStepper(c)}
              <!-- Status history pills -->
              ${statusLog.length>0?`<div style="margin-top:8px;display:flex;flex-direction:column;gap:3px;">
                <div style="font-size:9.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">Status History</div>
                ${statusLog.slice().reverse().slice(0,4).map(e=>`<div style="display:flex;gap:6px;align-items:center;">
                  <span style="font-size:9px;color:#94a3b8;font-family:var(--mono);white-space:nowrap;font-weight:600;">${e.t||''}</span>
                  <span style="font-size:11px;color:#cbd5e1;">${(e.msg||'').replace('Status changed to: ','→ ')}</span>
                </div>`).join('')}
              </div>`:''}
            </div>

            ${c.cst!=='Resolved'?`<div style="padding:8px 10px;background:${c.nextAction?'rgba(96,165,250,.06)':'rgba(248,113,113,.07)'};border:1px solid ${c.nextAction?'rgba(96,165,250,.22)':'rgba(248,113,113,.3)'};border-radius:6px;">
              <div style="font-size:10px;font-weight:800;color:${c.nextAction?'#60a5fa':'#f87171'};text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">⭢ Next action ${c.nextAction?'':'— not set!'}</div>
              <input value="${(c.nextAction||'').replace(/"/g,'&quot;')}" onchange="setClaimNext('${c.id}','nextAction',this.value)" placeholder="e.g. Chase Amazon UK for refund reply" style="width:100%;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e2e8f0;font-size:11.5px;padding:6px 8px;outline:none;box-sizing:border-box;margin-bottom:5px;font-family:inherit;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:9px;color:#94a3b8;font-weight:700;white-space:nowrap;">Due</span>
                <input type="date" value="${c.nextDue||''}" onchange="setClaimNext('${c.id}','nextDue',this.value)" style="flex:1;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e2e8f0;font-size:11px;padding:4px 8px;outline:none;font-family:inherit;">
                ${c.nextDue&&c.nextDue<todayISO()?'<span style="font-size:9px;font-weight:800;color:#f87171;white-space:nowrap;">OVERDUE</span>':''}
              </div>
            </div>`:''}
            ${c.issT==='Gated'&&c.cst!=='Resolved'?`<div style="padding:8px 10px;background:rgba(192,132,252,.06);border:1px solid rgba(192,132,252,.25);border-radius:6px;">
              <div style="font-size:10px;font-weight:800;color:#c084fc;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">🔒 Gated — Jack's call</div>
              <div style="display:flex;gap:6px;">
                <button onclick="setGatedDecision('${c.id}','eBay')" style="flex:1;padding:6px 6px;background:${c.gatedDecision==='eBay'?'rgba(52,211,153,.2)':'rgba(255,255,255,.04)'};border:1px solid ${c.gatedDecision==='eBay'?'#34d39988':'rgba(255,255,255,.12)'};color:${c.gatedDecision==='eBay'?'#34d399':'#cbd5e1'};border-radius:5px;font-size:10px;font-weight:800;cursor:pointer;">Sell on eBay</button>
                <button onclick="setGatedDecision('${c.id}','Ungate')" style="flex:1;padding:6px 6px;background:${c.gatedDecision==='Ungate'?'rgba(96,165,250,.2)':'rgba(255,255,255,.04)'};border:1px solid ${c.gatedDecision==='Ungate'?'#60a5fa88':'rgba(255,255,255,.12)'};color:${c.gatedDecision==='Ungate'?'#60a5fa':'#cbd5e1'};border-radius:5px;font-size:10px;font-weight:800;cursor:pointer;">Get ungated</button>
              </div>
              ${!c.gatedDecision?'<div style="font-size:11px;color:#c084fc;margin-top:5px;font-weight:600;">No decision yet — pick a route</div>':''}
            </div>`:''}
                        ${c.cst==='Resolved'?`<div style="padding:8px 10px;background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.2);border-radius:6px;">
              <div style="font-size:10px;font-weight:800;color:#4ade80;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Outcome — reimbursed?</div>
              <select class="ci-sel" onchange="updateClaimField('${c.id}','reimbursed',this.value)" style="font-size:12px;padding:6px 10px;width:100%;font-weight:700;border-radius:5px;background:${c.reimbursed==='Yes'?'rgba(74,222,128,.15)':c.reimbursed==='Partial'?'rgba(251,191,36,.15)':c.reimbursed==='Write-off'?'rgba(148,163,184,.15)':'rgba(248,113,113,.12)'};color:${c.reimbursed==='Yes'?'#4ade80':c.reimbursed==='Partial'?'#fbbf24':c.reimbursed==='Write-off'?'#cbd5e1':'#f87171'};border:1px solid rgba(255,255,255,.12);margin-bottom:6px;">
                ${['No','Yes','Partial','Write-off'].map(o=>`<option${(c.reimbursed||'No')===o?' selected':''}>${o}</option>`).join('')}
              </select>
              <textarea onchange="updateClaimField('${c.id}','reimburseNote',this.value)" placeholder="${c.reimbursed==='Write-off'?'Why written off (supplier refused, not worth chasing…)':'Reimbursement notes (amount, ref, date)…'}" style="width:100%;min-height:40px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);border-radius:4px;color:#e2e8f0;font-size:11px;line-height:1.4;padding:6px 8px;resize:vertical;outline:none;box-sizing:border-box;font-family:inherit;">${(c.reimburseNote||'').replace(/</g,'&lt;')}</textarea>
            </div>`:''}

            <!-- Action buttons -->
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${c.cst!=='Resolved'?`<button onclick="resolveIssue('${c.id}')" style="padding:7px 10px;background:rgba(74,222,128,.15);border:1px solid #4ade8066;color:#4ade80;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;text-align:center;">✓ Mark Resolved</button>`:`<button onclick="archiveClaim('${c.id}')" title="Clear this resolved claim out of the active list (the record is kept)" style="padding:7px 10px;background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.3);color:#cbd5e1;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;text-align:center;">📦 Archive (clear)</button>`}
              <button onclick="openEditAction('${c.id}')" style="padding:7px 10px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.3);color:#60a5fa;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;text-align:center;">✏️ Edit Details</button>
              <button onclick="removeIssue('${c.id}')" style="padding:7px 10px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);color:#f87171;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;text-align:center;">🗑 Delete</button>
            </div>

            <!-- Quick stats -->
            <div style="padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:6px;margin-top:auto;">
              <div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:6px;">Summary</div>
              ${[
                ['Issue type',c.issT||'—','#e2e8f0'],
                ['Units affected',String(c.dif||0),'#f87171'],
                ['COG/unit',fmtGBP2(cogUnit),'#fbbf24'],
                ['Total at risk',fmtGBP2((c.dif||0)*(cogUnit||0)),'#fbbf24'],
                ['Contact entries',String(contactLog.length),'#60a5fa'],
              ].map(([l,v,col])=>`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);">
                <span style="font-size:10px;color:#94a3b8;">${l}</span>
                <span style="font-size:11px;font-weight:700;color:${col};font-family:var(--mono);">${v}</span>
              </div>`).join('')}
            </div>

          </div>
        </div>
      </div>`:''}
      </div>`;
    };
      const live=d.filter(c=>c.cst!=='Resolved');
      const sec=(title,sub,list,col)=>list.length?`<div class="iqSec">
        <div class="iqSecHd" style="border-left:3px solid ${col};">
          <h4>${title}</h4><span class="iqSecN">${list.length}</span>
          <span class="iqSecWhy">${sub}</span>
          <span class="iqSecMoney">${fmtGBP2(list.reduce((a,c)=>a+(c.claimValue||0),0))}</span>
        </div>
        ${list.map(_row).join('')}
      </div>`:'';
      const owed=d.filter(c=>c.cst==='Resolved'&&(c.reimbursed||'No')==='No');
      const done=d.filter(c=>c.cst==='Resolved'&&(c.reimbursed||'No')!=='No');
      return sec('Sarah — investigate &amp; chase','Work these, then send what needs a decision to Jack',
              live.filter(c=>_own(c)!=='Jack'),'#fbbf24')
           + sec('Jack — decide','Already investigated. Your call.',
              live.filter(c=>_own(c)==='Jack'),'#60a5fa')
           + sec('Money owed','Resolved but never paid back — chase it',owed,'#34d399')
           + sec('Done','Settled and paid',done,'#64748b');
    })()}`;
}
function filterClaims(){renderClaims();}

// Edit a single claim field (VA/Jack notes, reimbursed status/notes) and persist.
async function updateClaimField(id,field,val){
  const c=claims.find(x=>String(x.id)===String(id));
  if(!c)return;
  c[field]=val;
  await saveClaim(c);
  // Once a resolved claim has a final outcome (reimbursed / partial / written-off),
  // auto-archive it so nothing sits half-finished — with an undo.
  if(field==='reimbursed'&&c.cst==='Resolved'&&['Yes','Partial','Write-off'].includes(val)&&!c.archived){
    c.archived=true;await saveClaim(c);renderClaims();
    toastUndo(val==='Write-off'?'Written off & archived':'Outcome set & archived',async()=>{c.archived=false;await saveClaim(c);renderClaims();});
    return;
  }
  if(field==='reimbursed')renderClaims();
}

// Archive a resolved claim: clear it out of the active list but keep the record.
async function archiveClaim(id){
  const c=claims.find(x=>String(x.id)===String(id));
  if(!c)return;
  if(c.cst!=='Resolved'){toast('Only resolved claims can be archived','er');return;}
  c.archived=true;
  await saveClaim(c);
  renderClaims();
  toastUndo('Claim archived',async()=>{c.archived=false;await saveClaim(c);renderClaims();});
}

async function resolveIssue(id){
  if(histGate())return;
  const c=claims.find(x=>String(x.id)===String(id));
  if(!c)return;
  c.cst='Resolved';
  await saveClaim(c);
  // Clear issue flag on prep row if no more open issues
  if(c.prepRowId){
    const r=rows.find(x=>x.uuid===c.prepRowId||String(x.id)===String(c.prepRowId));
    const stillOpen=claims.filter(cl=>cl.prepRowId===c.prepRowId&&cl.cst!=='Resolved'&&cl.uuid!==c.uuid);
    if(r&&!stillOpen.length){r.issueType='';r.issueQty=0;await saveRow(r);}
  }
  renderClaims();renderPrep();
  toast('✓ Issue resolved');
}

async function removeIssue(id){
  if(histGate())return;
  const c=claims.find(x=>String(x.id)===String(id));
  if(!c)return;
  showConfirm('Remove this issue?','This will delete the issue from the Actions page and clear the red flag on the prep row.',async()=>{
    await deleteClaim_db(c);
    claims=claims.filter(x=>x.id!==id);
    if(c.prepRowId){
      const r=rows.find(x=>x.uuid===c.prepRowId||String(x.id)===String(c.prepRowId));
      const stillOpen=claims.filter(cl=>cl.prepRowId===c.prepRowId&&cl.cst!=='Resolved');
      if(r&&!stillOpen.length){r.issueType='';r.issueQty=0;await saveRow(r);}
    }
    renderClaims();renderPrep();
    toast('Issue removed');
  });
}

function openEditAction(id){const c=claims.find(x=>String(x.id)===String(id));if(!c)return;openEditClaim(c.id);}
function setClaimOwner(id){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  c.owner=(c.owner||'VA')==='Jack'?'VA':'Jack';
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Reassigned to '+c.owner});
  saveClaim(c);renderClaims();if(typeof renderAdmin==='function')renderAdmin();
  toast('Assigned to '+c.owner);
}
function setGatedDecision(id,dec){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  c.gatedDecision=dec;
  c.nextAction=dec==='eBay'?'List on eBay — remove from Amazon prep flow':'Source ungating invoice / buy extra units, then submit ungate';
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Decision: '+(dec==='eBay'?'Sell on eBay':'Get ungated')});
  if(c.cst==='Needs Attention')c.cst='Open';
  /* One click does the WHOLE job — Jack, 17 Aug: "more automation, one click".
     The decision is recorded AND the claim goes straight back to Sarah with
     the instruction attached, instead of sitting on his page with a decision
     nobody has told her about. */
  if(((c.owner)||'VA')==='Jack'){
    c.owner='VA';c.sentToJack=null;
    c.log.push({t:getNowUK(),msg:'Jack answered — '+(dec==='eBay'
      ?'eBay it: list it on eBay and take it out of the prep flow'
      :'Get it ungated: submit the invoices, buy extra units if needed')});
  }
  saveClaim(c);renderClaims();if(typeof renderAdmin==='function')renderAdmin();
  try{renderJack();paintJackBadge();}catch(e){}
  logAudit('Gated decision',(c.sku||'')+' → '+dec);
  if(dec!=='eBay'){toast('Decision: ungate — back with Sarah with the instruction');return;}
  /* eBay it also PUTS IT IN Recovery Stock, so the units land somewhere. */
  toast('Decision: eBay — back with Sarah with the instruction');
  if(typeof recFromClaim==='function')recFromClaim(c).then(r=>{
    if(r==='nosetup')toast('Recovery Stock needs its one-time setup before it can hold this — run the SQL, then add it there','er');
    else if(r==='dupe')toast('Already in Recovery Stock — not added twice','ok');
    else if(r)toast('Added to Recovery Stock — '+fmt(r.qty)+' unit'+(r.qty===1?'':'s')+' waiting to be sorted','ok');
  }).catch(e=>console.warn('[recovery] from claim',e));
}
function setClaimNext(id,field,val){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  c[field]=val;saveClaim(c);
  logAudit('Next action '+(field==='nextDue'?'due date':'set'),`${c.sup||c.sku}: ${val||'cleared'}`);
}
function updateClaimSt(id,v){
  const c=claims.find(x=>String(x.id)===String(id));
  if(c){
    c.cst=v;
    if(!c.log)c.log=[];
    c.log.push({t:getNowUK(),msg:`Status changed to: ${v}`});
    saveClaim(c);
    updateCB();logAudit('Action status',`${c.sup} → ${v}`);
    renderClaims();toast('Action updated');
  }
}
function deleteClaim(id){
  const c=claims.find(x=>x.id===id);
  showConfirm('Delete Action?',`This will permanently remove the action for ${c?.sup||'this item'}.`,()=>{
    deleteClaim_db(c);
    claims=claims.filter(x=>x.id!==id);
    renderClaims();updateCB();toast('Action deleted');
  });
}
function editClaimNote(id){
  const r=claims.find(x=>x.id===id);if(!r)return;
  showShipIdModal('Edit Claim Note','Update the note for this claim:','Standard',(val)=>{
    r.notes=val;renderClaims();toast('Notes updated');
  });
  // Repurpose the modal slightly for notes
  document.getElementById('shipIdModalTitle').textContent='Edit Claim Note';
  document.getElementById('shipIdModalDesc').textContent='Update the note for: '+r.sku;
  document.getElementById('shipIdModalInput').value=r.notes||'';
  document.getElementById('shipIdModalInput').placeholder='Enter note…';
  document.getElementById('shipIdModalType').closest('.fi').style.display='none';
  document.getElementById('shipIdModalInput').oninput=function(){this.value=this.value;};// override uppercase
  // restore after close
  const orig=_shipIdCallback;
  _shipIdCallback=(val)=>{
    document.getElementById('shipIdModalType').closest('.fi').style.display='';
    document.getElementById('shipIdModalInput').placeholder='e.g. FBA15LPFRNPN';
    r.notes=val;renderClaims();toast('Notes updated');
  };
}
function updateCB(){
  const n=claims.filter(c=>c.cst!=='Resolved').length;
  const na=claims.filter(c=>c.cst==='Needs Attention').length;
  const badge=document.getElementById('claimBadge');
  if(badge){
    badge.textContent=n;
    // Red badge = unreviewed issues exist (act now); amber = live but all reviewed.
    badge.style.background=na>0?'#ef4444':(n>0?'rgba(251,191,36,.9)':'');
    badge.style.color=na>0?'#fff':(n>0?'#0f172a':'');
    badge.title=na>0?(na+' issue'+(na===1?'':'s')+' awaiting review'):(n+' live issue'+(n===1?'':'s'));
  }
  const dot=document.getElementById('claimDot');
  if(dot)dot.style.display=n>0?'block':'none';
  // Stuck rows badge on Prep Sheet
  const stuck=rows.filter(r=>{
    if(['Delivered','In Warehouse','Sent to Amazon'].includes(r.status))return false;
    if(r.expectedDelivery&&new Date()<=new Date(r.expectedDelivery))return false;
    const[dd,mm]=(r.date||'').split('/');
    if(!dd||!mm)return false;
    const d=new Date(`${new Date().getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
    return!isNaN(d)&&Math.floor((new Date()-d)/864e5)>20;
  }).length;
  const sb=document.getElementById('stuckBadge');
  if(sb){sb.textContent=stuck;sb.style.display=stuck>0?'inline-flex':'none';}
}
