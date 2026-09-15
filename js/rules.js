/* BDL PrepHub — js/rules.js — THE ONE DOOR.
   Jack, 10 Sep 2026: "when somebody performs an action I need to know the correct
   thing actually happens — not random behaviour depending on which page or person".
   Rows used to be changed in ~125 places and the agreed rules were bolted onto a
   few of them. Now every persisted change passes rowRules() inside saveRow(), so a
   rule agreed once holds on every button, for every login, on every page.
   Loaded right after core.js. Classic script: shared global scope. */

/* The rules that hold whenever a row is saved. Returns what changed (for the audit). */
function rowRules(r,ctx){
  const notes=[];
  if(!r||r.__noRules)return notes;
  const exp=parseInt(r.exp)||0;
  /* R1 · booking in clears the Amazon-says-delivered flag (was only on the Received cell) */
  try{if(typeof _amzFoundBySave==='function'&&_amzFoundBySave(r))notes.push('Amazon-says-delivered cleared — all booked in');}catch(e){}
  /* R5 · the part-arrival clock needs to know WHEN the first units were counted.
     Only the Received cell stamped it; the count-in box and the status dropdown
     did not, so a part-arrived row could sit with no clock at all (L'Oréal PS_12,
     15 Sep). A row with units in and no stamp gets one now — better late than never. */
  if((parseInt(r.rcvd)||0)>0&&!r.rcvdAt){r.rcvdAt=new Date().toISOString();}
  /* R4 · received can never be below what has gone out on a shipment —
     units on a shipment IS saying they were here (matches the Received cell) */
  try{
    const out=(typeof _sentOut==='function')?_sentOut(r):(parseInt(r.ship)||0);
    if(out>0&&(parseInt(r.rcvd)||0)<out){notes.push(`received raised ${parseInt(r.rcvd)||0} → ${out} to match what shipped`);r.rcvd=out;}
  }catch(e){}
  if(exp>0&&!r.archived&&_owedUnits(r)===0){
    /* R2 · nothing owed → status follows the stock (Jack, 10 Sep, decision B).
       Never backwards, never touches Issue/Returned, never archives — archiving
       stays a close-off decision. */
    const got=parseInt(r.rcvd)||0,ship=parseInt(r.ship)||0;
    const left=(typeof remainingToShip==='function')?remainingToShip(r):Math.max(0,got-ship);
    if(ship>0&&left===0&&r.status!=='Sent to Amazon'){
      r.status='Sent to Amazon';r.sent='Yes';
      if(!r.sentDate)r.sentDate=((r.shipSegments||[]).slice(-1)[0]||{}).date||new Date().toISOString().slice(0,10);
      notes.push('status → Sent to Amazon (everything it holds has shipped)');
    }else if(got>0&&left>0&&['In-Transit',''].includes(r.status||'')){
      r.status='In Warehouse';notes.push(`status → In Warehouse (${fmt(left)} on the shelf, nothing owed)`);
    }
    /* R3 · nothing owed → a stale Late label goes */
    if(/^(Late|Urgent)/.test(String(r.transitAction||''))){r.transitAction='';notes.push('Late label cleared — nothing owed');}
  }
  return notes;
}

/* The door for new code: change a row, run the rules, save, audit — in one call.
   applyRow(r,{rcvd:10},{why:'Counted in',by:'Becki'}) */
async function applyRow(r,patch,ctx){
  ctx=ctx||{};
  if(patch&&typeof patch==='object')Object.assign(r,patch);
  else if(typeof patch==='function')patch(r);
  r._dirty=true;
  if(ctx.why){try{logAudit(ctx.why,`${r.sku||r.asin||''}${ctx.detail?' — '+ctx.detail:''}`);}catch(e){}}
  return saveRow(r);   /* saveRow runs rowRules and audits what they changed */
}

/* ONE ANSWER to "is this row finished, and whose is it?" — every list reads this.
   Jack, 10 Sep: the Corsair was hidden by one rule (an open gated claim owned by
   Jack) and brought back by another (Recovery closes the claim). Four pages had
   four definitions. This is the definition; the checks' audit flags any page
   that disagrees with it. Returns {owner:'jack'|'sarah'|'becki'|'none', finished, why}. */
/* The 48-hour part-arrival clock (Jack, 6 Sep: "9 of 10 arrive — if the other
   one hasn't within 48 hours it gets flagged"), in one place. Working hours;
   S&S the same. When the count time is unknown the last shipment date stands in. */
function _partOverdue(r){
  if(!r||r.archived)return false;
  const got=parseInt(r.rcvd)||0,owed=_owedUnits(r);
  if(got<=0||owed<=0)return false;
  if(typeof _ukQuery==='function'&&_ukQuery(r))return false;   /* a live question to the warehouse outranks it */
  const since=r.rcvdAt||(r.sentDate?String(r.sentDate).slice(0,10)+'T12:00:00Z':'');
  if(!since)return false;
  const ms=(typeof _workMsSince==='function')?_workMsSince(since):(Date.now()-new Date(since).getTime());
  return ms>=(TM.partDays||2)*24*3600e3;
}
/* Jack, 11 Sep, Cadbury: 70 in, 23 shipped on 27 Aug, 47 'on the shelf' two
   weeks later (the note says they went out under the old SKU). Parts of one
   order ship within 2–3 days of each other; a remainder that never follows is
   a question for the warehouse: still here, or sent under another SKU? */
function _partShipStale(r){
  if(!r||r.archived)return false;
  const exp=parseInt(r.exp)||0,ship=parseInt(r.ship)||0;
  if(exp<=0||ship<=0||_owedUnits(r)>0)return false;
  const left=(typeof remainingToShip==='function')?remainingToShip(r):Math.max(0,(parseInt(r.rcvd)||0)-ship);
  if(left<=0)return false;
  const last=(r.shipSegments||[]).map(s=>s.date).filter(Boolean).sort().pop()||r.sentDate||'';
  if(!last)return false;
  const ms=(typeof _workMsSince==='function')?_workMsSince(String(last).slice(0,10)+'T12:00:00Z'):(Date.now()-new Date(last).getTime());
  return ms>=(TM.partDays||2)*24*3600e3;
}
/* Jack, 15 Sep, Gtech: "10 of 10 booked in — what happened to the other 0?"
   A question about missing stock that the stock has since answered. Same rule
   as the Becki flag: booking in clears it, nothing to press. Files the question
   with a line on the row; never touches a proposed closure or an open claim. */
function _stockAnsweredCheck(r){
  const res=r&&r.resolution;if(!r||r.archived||!res)return false;
  if(!['asked','rejected'].includes(res.state)||res.what!=='jack-check')return false;
  const exp=parseInt(r.exp)||0;if(exp<=0||_owedUnits(r)>0)return false;
  if(typeof _partShipStale==='function'&&_partShipStale(r))return false;
  const now=new Date().toISOString();
  const ch=res.chase||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:'PrepHub',what:`All ${fmt(exp)} booked in — the stock answered the question, nothing left to ask`}]);
  ch.step='';
  r.resolution=Object.assign({},res,{state:'approved',kind:'ops',what:'stock-answered',approvedBy:'PrepHub',approvedAt:now,chase:ch});
  r._dirty=true;
  try{logAudit('Question closed by the stock',`${r.sku||r.asin||''} — all ${fmt(exp)} booked in; the check sent ${res.by?'by '+res.by:''} is filed`);}catch(e){}
  return true;
}
/* Jack, 15 Sep, Corsair: the gated claim went to Recovery Stock on 7 Sep and the
   row stayed on the Prep Sheet (the Recovery fix on 10 Sep only covered new
   ones). Derived from the claim's own log — nothing new stored. */
function _recoveryClaim(r){
  if(!r)return null;
  return (typeof claims!=='undefined'?claims:[]).find(c=>c&&!c.archived&&String(c.prepRowId)===String(r.uuid||r.id)&&/gated/i.test(c.issT||'')&&c.cst==='Resolved'&&(c.log||[]).some(l=>/^Sent to Recovery Stock/.test(String(l.msg||''))))||null;
}
function _recoveryFiled(r){
  if(!r||r.archived)return false;
  const c=_recoveryClaim(r);if(!c)return false;
  const left=(typeof remainingToShip==='function')?remainingToShip(r):Math.max(0,(parseInt(r.rcvd)||0)-(parseInt(r.ship)||0));
  if(left<=0)return false;
  const when=((c.log||[]).find(l=>/^Sent to Recovery Stock/.test(String(l.msg||'')))||{}).t||'';
  r.notes=((r.notes||'').trim()?(r.notes.trim()+'\n'):'')+`${_ddUK()}: ${fmt(left)} → Recovery Stock (gated${when?', '+when:''}) — filed`;
  r.archived=true;r._dirty=true;
  try{logAudit('Filed — units are in Recovery Stock',`${r.sku||r.asin||''} — ${fmt(left)} unit${left===1?'':'s'} · gated claim closed ${when}`);}catch(e){}
  return true;
}
/* one short label for the Prep Sheet's Issues column — what the row is waiting on */
function _rowStateTag(r){
  const c=_recoveryClaim(r);if(c)return{t:'Gated → Recovery Stock',col:'#c084fc',tip:'The gated units went to Recovery Stock — this row is filed'};
  const o=_rowOwner(r);
  if(o.finished)return null;
  if(o.owner==='jack')return{t:'With Jack',col:'#60a5fa',tip:o.why};
  if(o.owner==='becki')return null;   /* the Becki flag already says it */
  if(o.owner==='sarah'){const late=(typeof _prepRowLate==='function')&&_prepRowLate(r);
    return{t:(/Jack answered/.test(o.why)?'Jack answered — Sarah closes':/part shipped/.test(o.why)?'Part shipped — Sarah':/part arrived/.test(o.why)?'Part arrived — Sarah':/slipped/.test(o.why)?'Date slipped — Sarah':/claim/.test(o.why)?'Claim — Sarah':late?'Late — Sarah chasing':'With Sarah'),col:late?'#f87171':'#fbbf24',tip:o.why};}
  if(/parked/.test(o.why))return{t:'Parked — date '+(r.expectedDelivery?_dmy(r.expectedDelivery):''),col:'#94a3b8',tip:o.why};
  if(/snoozed/.test(o.why))return{t:'Snoozed',col:'#94a3b8',tip:o.why};
  return null;
}
function _rowOwner(r){
  if(!r)return{owner:'none',finished:true,why:'no row'};
  const res=r.resolution||null,st=(res&&res.state)||'';
  const exp=parseInt(r.exp)||0,owed=_owedUnits(r);
  if(r.archived)return{owner:'none',finished:true,why:'filed'};
  if(st==='proposed')return{owner:'jack',finished:false,why:'closure proposed — Jack approves'};
  if(st==='approved')return{owner:'none',finished:true,why:'closed: '+(res.what||'')};
  /* parked on a promised delivery date — off every list until the date slips (Jack, 7 Sep) */
  if(typeof _parkedOnDate==='function'&&_parkedOnDate(r))return{owner:'none',finished:false,why:'parked on a promised date — comes back by itself if it slips'};
  /* a promised date that has slipped is a chase — Sarah's, whoever put the date on */
  if(st==='asked'&&res.chase&&res.chase.step==='due-date'&&r.expectedDelivery)return{owner:'sarah',finished:false,why:'the promised date slipped — Sarah chases'};
  /* a live question to Jack outranks the claim paperwork on the same row */
  if(st==='asked')return{owner:'jack',finished:false,why:'with Jack: '+(res.ask||'check')};
  /* an open claim on the row (damage, short, gated…) is somebody's job even when the stock itself is fine */
  const _cl=(typeof claims!=='undefined'?claims:[]).filter(c=>c&&!c.archived&&c.cst!=='Resolved'&&c.cst!=='Closed'&&String(c.prepRowId)===String(r.uuid||r.id));
  if(_cl.some(c=>String(c.owner||'VA')==='Jack'))return{owner:'jack',finished:false,why:'claim with Jack: '+(_cl.find(c=>String(c.owner||'VA')==='Jack').issT||'claim')};
  if(_cl.length)return{owner:'sarah',finished:false,why:'claim in hand: '+(_cl[0].issT||'claim')};
  if(typeof _offPrepSheet==='function'&&_offPrepSheet(r))return{owner:'jack',finished:false,why:'gated — Jack took it off their lists'};
  /* the stock answers a question about missing stock — nothing left to ask */
  if(exp>0&&owed<=0&&!_partShipStale(r))return{owner:'none',finished:true,why:'nothing owed — the stock answered it'+(st==='asked'||st==='rejected'?' (question still open on the row)':'')};
  if(typeof _isAmzDel==='function'&&_isAmzDel(r))return{owner:'becki',finished:false,why:'Amazon say delivered — Becki checks the shelves'};
  /* snoozed by Sarah — nobody's until the snooze runs out */
  if(r.chaseSnoozeUntil&&new Date()<new Date(r.chaseSnoozeUntil))return{owner:'none',finished:false,why:'snoozed until '+String(r.chaseSnoozeUntil).slice(0,10)};
  if(st==='rejected')return{owner:'sarah',finished:false,why:'Jack answered — Sarah closes'};
  if(st==='working')return{owner:'sarah',finished:false,why:'Sarah is chasing it'};
  if(_partOverdue(r))return{owner:'sarah',finished:false,why:'part arrived — the rest never followed within '+(TM.partDays||2)+' working days'};
  if(_partShipStale(r))return{owner:'sarah',finished:false,why:'part shipped — the rest never followed: still on the shelf, or sent under another SKU?'};
  if(typeof _prepRowLate==='function'&&_prepRowLate(r))return{owner:'sarah',finished:false,why:'late — Sarah chases'};
  return{owner:'none',finished:false,why:'in transit — nothing to do yet'};
}
