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
function _rowOwner(r){
  if(!r)return{owner:'none',finished:true,why:'no row'};
  const res=r.resolution||null,st=(res&&res.state)||'';
  const exp=parseInt(r.exp)||0,owed=_owedUnits(r);
  if(r.archived)return{owner:'none',finished:true,why:'filed'};
  if(st==='proposed')return{owner:'jack',finished:false,why:'closure proposed — Jack approves'};
  if(st==='approved')return{owner:'none',finished:true,why:'closed: '+(res.what||'')};
  /* parked on a promised delivery date — off every list until the date slips (Jack, 7 Sep) */
  if(typeof _parkedOnDate==='function'&&_parkedOnDate(r))return{owner:'none',finished:false,why:'parked on a promised date — comes back by itself if it slips'};
  /* a live question to Jack outranks the claim paperwork on the same row */
  if(st==='asked')return{owner:'jack',finished:false,why:'with Jack: '+(res.ask||'check')};
  /* an open claim on the row (damage, short, gated…) is somebody's job even when the stock itself is fine */
  const _cl=(typeof claims!=='undefined'?claims:[]).filter(c=>c&&!c.archived&&c.cst!=='Resolved'&&c.cst!=='Closed'&&String(c.prepRowId)===String(r.uuid||r.id));
  if(_cl.some(c=>String(c.owner||'VA')==='Jack'))return{owner:'jack',finished:false,why:'claim with Jack: '+(_cl.find(c=>String(c.owner||'VA')==='Jack').issT||'claim')};
  if(_cl.length)return{owner:'sarah',finished:false,why:'claim in hand: '+(_cl[0].issT||'claim')};
  if(typeof _offPrepSheet==='function'&&_offPrepSheet(r))return{owner:'jack',finished:false,why:'gated — Jack took it off their lists'};
  /* the stock answers a question about missing stock — nothing left to ask */
  if(exp>0&&owed<=0)return{owner:'none',finished:true,why:'nothing owed — the stock answered it'+(st==='asked'||st==='rejected'?' (question still open on the row)':'')};
  if(typeof _isAmzDel==='function'&&_isAmzDel(r))return{owner:'becki',finished:false,why:'Amazon say delivered — Becki checks the shelves'};
  if(st==='rejected')return{owner:'sarah',finished:false,why:'Jack answered — Sarah closes'};
  if(st==='working')return{owner:'sarah',finished:false,why:'Sarah is chasing it'};
  if(typeof _prepRowLate==='function'&&_prepRowLate(r))return{owner:'sarah',finished:false,why:'late — Sarah chases'};
  return{owner:'none',finished:false,why:'in transit — nothing to do yet'};
}
