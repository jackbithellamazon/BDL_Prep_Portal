/* BDL PrepHub — js/sarah-admin.js — Sarah’s Admin: VA follow-up hub, notebook, timings, VA state, 48h, webhook, closure types.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── SARAH'S ADMIN (VA FOLLOW-UP HUB) ──────────────────────────────────────────
// Aggregates every colour-flagged prep row that needs the VA to chase / follow up
// (late-in-transit, delayed, chasing supplier, awaiting update, urgent) plus a
// roll-up of open Issues. Anything red/amber on the Prep Sheet lands here.
const ADMIN_CHASE_STATES=['Urgent — Chase Now','Late — Needs Chasing','Delayed','Chasing Supplier','Awaiting Update'];

const _dmy=iso=>{const p=String(iso||'').slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}`:String(iso||'');};
function _adminItems(){
  const today=new Date();
  /* one-time sweep: the year-0002 dates the old input let through poisoned
     every clock they touched ("refund gone 739180d"). Corrupt = cleared. */
  if(!window._datesHealed){window._datesHealed=1;rows.forEach(r=>{
    if(r.expectedDelivery&&!saneDate(r.expectedDelivery)){r.expectedDelivery='';r._dirty=true;debounce('healx_'+r.id,()=>saveRow(r),3000);}
    const hc=r.resolution&&r.resolution.chase;
    if(hc&&hc.due&&!saneDate(hc.due)){hc.due='';r._dirty=true;debounce('healy_'+r.id,()=>saveRow(r),3000);}
  });}
  const out=[];
  rows.forEach(r=>{
    if(r.archived)return;
    /* v50.5: the one owner rule (js/rules.js) decides "finished" for every page —
       a finished row is nobody's job here, whatever the older tests below say. */
    try{if(typeof _rowOwner==='function'&&_rowOwner(r).finished)return;}catch(e){}
    // Mirror the Prep Sheet colour logic so this stays in lock-step with it.
    let rowAgeDate=null;
    /* The sheet only carries dd/mm. Stamping it with the CURRENT year put every
       order from last year in the FUTURE — days-in-transit went negative and it
       silently stopped being chased. Roll back a year when that happens, so
       December orders keep counting through January. */
    if(r.date){
      const[dd,mm]=r.date.split('/');
      if(dd&&mm){
        rowAgeDate=new Date(`${today.getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
        if(!isNaN(rowAgeDate)&&rowAgeDate>today)rowAgeDate.setFullYear(rowAgeDate.getFullYear()-1);
      }
    }
    const days=rowAgeDate&&!isNaN(rowAgeDate)?Math.floor((today-rowAgeDate)/864e5):0;
    const expDate=r.expectedDelivery?new Date(r.expectedDelivery):null;
    /* one definition of "the promised date has passed" (checks' audit caught two):
       a promise of the 10th holds all day on the 10th and slips on the 11th —
       the same rule _parkedOnDate uses for Jack's page and the owner rule */
    const expPassed=!expDate||!(typeof _parkedOnDate==='function'&&_parkedOnDate(r));
    const isSubSave=r.subSave==='Yes';
    /* Jack, 4 Sep: letting Part Sent through the status gate was not enough —
       "stuck" itself demanded In-Transit, so a Part Sent row with nothing
       received still qualified for nothing and stayed invisible. What makes a
       row stuck is that stock is owed and time has passed, not the label on it. */
    const _stillOwed=(r.exp||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0);
    const isStuck=days>(isSubSave?TM.ssLateDays:TM.lateDays)&&expPassed&&
      (r.status==='In-Transit'||((r.status==='Part Sent'||r.status==='Sent to Amazon')&&_stillOwed>0));
    const ta=r.transitAction||'';
    /* Arrived/shipped rows are never "in transit to chase" — keep them out.
       Jack, 4 Sep: "where is this late but not on Sarah's page?" — Part Sent was
       in this list, but it describes what went OUT to Amazon, not what came IN
       from the supplier. So a row that shipped 4 units onward while NOTHING ever
       arrived was invisible to her: three of his were 70+ days old. Part Sent is
       judged on what is still owed, like any other row — the outstanding test a
       few lines down drops it the moment nothing is left. */
    if(['Delivered','In Warehouse','Returned'].includes(r.status))return;
    /* Jack, 4 Sep: two OneBlade rows — 3 ordered, 2 in, both sent on — went
       "Sent to Amazon" because everything received had shipped, and the unit
       Amazon France still owed fell off her page (the warehouse had typed
       "awaiting last one — check if on way" into a packing note for want of
       anywhere else). Sent, like Part Sent, is judged on what is still owed. */
    if((r.status==='Part Sent'||r.status==='Sent to Amazon')&&((r.exp||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0))<=0)return;
    /* Sorted AND approved by Jack. Sarah proposes a closure, Jack approves it —
       nothing leaves the queue on the VA's say-so alone. Approved rows keep
       everything they had; they just stop being someone's job. This is what
       stops rows sitting at 94 days with nobody able to do anything about them. */
    /* Jack, 10 Sep 22:13 (three Amazon Germany rows parked on the 10th): "they
       go on Sarah's sheet then, don't they?" Yes — a promised date that slips
       is a chase, and chasing is hers, whoever put the date on. */
    if(r.resolution&&r.resolution.state==='asked'&&r.resolution.chase&&r.resolution.chase.step==='due-date'&&expDate&&expPassed){
      const _ch=r.resolution.chase;_ch.step='due-date';_ch.due=r.expectedDelivery||_ch.due||'';
      _ch.log=(_ch.log||[]).concat([{at:new Date().toISOString(),by:'PrepHub',what:'The promised date passed with nothing booked in — back with Sarah to chase'}]);
      r.resolution=Object.assign({},r.resolution,{state:'working',slippedAt:new Date().toISOString(),chase:_ch});
      r._dirty=true;debounce('slip_'+(r.uuid||r.id),()=>saveRow(r),2000);
    }
    if(r.resolution&&r.resolution.state==='approved'&&r.resolution.what==='in-transit'&&expDate&&expPassed){
      /* Parked on a promised date by "Amazon says it'll arrive…" — and once
         that date passed nothing ever looked again, so the row was gone for
         good. A slipped promise is a live chase again. */
      const _ch=r.resolution.chase||{path:'never-arrived',step:'due-date',due:r.expectedDelivery||'',log:[]};
      _ch.step='due-date';_ch.due=r.expectedDelivery||_ch.due||'';
      _ch.log=(_ch.log||[]).concat([{at:new Date().toISOString(),by:'PrepHub',what:'The promised date passed with nothing booked in — back on the list'}]);
      r.resolution=Object.assign({},r.resolution,{state:'working',slippedAt:new Date().toISOString(),chase:_ch});
      r._dirty=true;debounce('slip_'+(r.uuid||r.id),()=>saveRow(r),2000);
    }
    if(r.resolution&&r.resolution.state==='approved'){
      const at=new Date(r.resolution.approvedAt||r.resolution.at||0).getTime();
      if(!r.resolution.filed&&_workMsSince(at)<TM.undoHours*3600e3){
        out.push({rid:r.uuid||r.id,sku:r.sku,asin:r.asin,prod:r.prod,sup:r.sup,oid:r.oid,
          date:r.date,acct:r.acct||'',units:0,got:0,cancelled:0,outstanding:0,
          sortedGrace:true,sortedAt:at,sortedWhat:(r.resolution.what||''),sev:0,col:'#94a3b8',
          /* a row parked on a promised date is not "sorted" — say what it is */
          reason:(r.expectedDelivery&&new Date(r.expectedDelivery)>today&&(r.resolution.what==='in-transit'))
            ? ('Parked until '+_dmy(r.expectedDelivery)+(_amazonRow(r)?' — the date Amazon gave':' — the date the supplier gave'))
            : 'Sorted — still undoable',
          value:0,waiting:false,delivered:r.delivered||'',wrongSku:r.wrongSku||''});
      }
      return;
    }
    /* Nothing outstanding left to chase. The Wagner case: 12 ordered, 6 arrived,
       6 cancelled by the supplier. Those 6 are never coming, so the row must stop
       counting as late — but the original 12 stays on the row, untouched. */
    const _units=r.exp||r.ship||0;
    const _got=parseInt(r.rcvd)||0;
    const _cx=parseInt(r.cancelledQty)||0;
    /* Was `_cx>0 && …`, so a row that simply arrived in full — nothing
       cancelled — never satisfied it and sat in the chase queue forever if the
       status was not flipped by hand. Anything with nothing left outstanding
       leaves, however it got there. */
    if((_units-_got-_cx)<=0&&(_got>0||_cx>0))return;
    // Snoozed by the VA ("Done" = chased, come back later) — hide until it lapses.
    if(r.chaseSnoozeUntil&&today<new Date(r.chaseSnoozeUntil))return;
    // Past its expected delivery date and still not received → chase it.
    const expOverdue=!!expDate&&today>expDate&&(r.status==='In-Transit'||r.status==='Not Arrived')&&(!isSubSave||days>TM.ssLateDays);
    const inChase=ADMIN_CHASE_STATES.includes(ta);
    /* An open case OUTRANKS the late rules. Recording a promised replacement
       date pushes the expected date into the future, which stopped the row
       counting as late — so a live case with a chase log silently left the
       page and belonged to nobody: not on Jack's list, not on hers. Anything
       still being worked, or just handed back by Jack, stays put. */
    const _c0=_caseOf(r);
    /* parked on a promised delivery date = nobody's job until it slips —
       but it goes grey to the BOTTOM for 3 days first, undoable ("it went
       too quick — what if we need to undo it", Jack 30 Aug) */
    const _parked=!!(expDate&&!expPassed&&((_c0&&_c0.step==='due-date')||(r.resolution&&r.resolution.state==='asked')));
    const _parkGrace=_parked&&!!_c0&&!_c0.filed&&!!_c0.parkedAt&&(_workMsSince(_c0.parkedAt)<TM.undoHours*3600e3);
    const _liveCase=(!!_c0&&!_parked)||_parkGrace;
    const _handedBack=!!(r.resolution&&r.resolution.state==='rejected');
    /* a question from the warehouse — "is more on the way?" — is hers to
       answer whether or not the row is late yet */
    const _q=_ukQuery(r);
    /* Jack, 6 Sep: "9 out of 10 arrive — if the other one hasn't arrived within
       48 hours it gets flagged on Sarah's page." Working hours, S&S longer. */
    /* Jack, 7 Sep: "is this not going on Sarah's admin page now?" — the
       received-time column only exists from today, so every older Part Sent
       row had no clock and never qualified. When the count time is unknown,
       the day the part went to Amazon is a safe floor: it was booked in before
       it was shipped. Rows with neither stay on the late rule as before. */
    const _partSince=r.rcvdAt||(r.sentDate?String(r.sentDate).slice(0,10)+'T12:00:00Z':'');
    const _partMs=_partSince?_workMsSince(_partSince):0;
    const _partDays=TM.partDays;   /* Jack, 6 Sep: S&S arrives together — same clock as everything else */
    const _part=_got>0&&(_units-_got-_cx)>0&&!!_partSince&&_partMs>=_partDays*24*3600e3&&!_q;
    const _partRed=_part&&_partMs>=(_partDays+1)*24*3600e3;
    if(!isStuck&&!inChase&&!expOverdue&&!_liveCase&&!_handedBack&&!_q&&!_part)return;
    let sev,col;
    if(ta==='Urgent — Chase Now'){sev=4;col='#ef4444';}
    else if(ta==='Late — Needs Chasing'||isStuck){sev=3;col='#ef4444';}
    else if(expOverdue){sev=3;col='#ef4444';}
    else if(ta==='Delayed'||ta==='Chasing Supplier'){sev=2;col='#fb923c';}
    else{sev=1;col='#fbbf24';}
    if(_q){const _qw=_queryWait(_q);if(_qw>=TM.queryRedDays){sev=4;col='#ef4444';}else if(sev<=2){sev=2;col='#38bdf8';}}
    if(_part&&sev<=2){sev=_partRed?3:2;col=_partRed?'#ef4444':'#fb923c';}
    /* a chase gone quiet past its 2-working-day due is the most actionable
       thing here — it rises to the top instead of fading (Jack, 30 Aug) */
    if(_c0&&!_parked){const _od=_caseDue(_c0);if(_od!==null&&_od>0){sev=4;col='#ef4444';}}
    if(_parkGrace){sev=0;col='#94a3b8';}
    const expStr=expDate?expDate.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}):'';
    /* "(threshold: 20 days)" was printed on all nineteen rows. It is one fact
       about the whole queue, so it is said once in the heading instead. */
    const reason=_q?`${_q.by||'Warehouse'} asked — ${_q.got?_q.short+' of '+_q.exp+' still to come?':'has it been dispatched?'}${_queryWait(_q)>=TM.queryRedDays?' · '+_queryWait(_q)+'d unanswered':''}`
      :_part?`${_got} of ${_units} in${r.rcvdAt?' '+_dmy(r.rcvdAt):(r.sentDate?' by '+_dmy(r.sentDate):'')} — the other ${_units-_got-_cx} never followed`
      :(isStuck?`${days} days in transit`:(expOverdue?`Past expected (${expStr}) — confirm arrival`:(ta||'Needs follow-up')));
    const cogs=parseSKU(r.sku).cogs||0;
    const units=_units,got=_got,cancelled=_cx;
    const outstanding=Math.max(0,units-got-cancelled);
    /* "Nothing has turned up" and "half of it turned up" are different jobs:
       one is chasing a whole order, the other is chasing a shortfall. The queue
       treated both as simply late, so the VA had to open the row to find out. */
    const partArrived=got>0&&got<units;
    const missing=partArrived?outstanding:0;
    out.push({rid:r.uuid||r.id,sku:r.sku,asin:r.asin,prod:r.prod,sup:r.sup,oid:r.oid,date:r.date,
      parkedRow:_parkGrace===true,query:_q||null,partOverdue:_part,partSince:_part?_dmy(r.rcvdAt):'',
      acct:r.acct||'',units,got,cancelled,outstanding,partArrived,missing,
      sheetRow:r.sheetRow||'',expDate:r.expectedDelivery||'',
      /* where the row came from — the Purchase Sheet (Sarah types it) or straight
         into the portal. She asks the two suppliers different questions. */
      source:r.sheetSyncId?'Sheet':(r.importedFrom||'PrepHub'),
      delivered:r.delivered||'',wrongSku:r.wrongSku||'',
      /* Jack, 4 Sep: "what SKU did it go out under — I need to know this."
         The closure already records it (`resolution.wentAs`); the row just
         never said it out loud. */
      wentAs:(r.resolution&&r.resolution.wentAs)||'',wentAsQty:(r.resolution&&parseInt(r.resolution.wentAsQty))||0,
      qtyFix:(r.qtyFix&&r.qtyFix.to!==undefined)?r.qtyFix:null,
      caseC:_caseOf(r),
      sentBack:(r.resolution&&r.resolution.state==='rejected')?r.resolution:null,
      /* Jack, 8 Sep: "a filter for Sarah when I send stuff back to her — newer
         stuff — make it easier for her." When his answer landed. */
      backAt:(r.resolution&&r.resolution.state==='rejected')?(r.resolution.at||''):'',
      /* 'asked' is Sarah handing an Amazon order over for Jack to look at — not
         a closure she is proposing. It still locks the row: she cannot close
         something she has just told him she cannot check. */
      waiting:(r.resolution&&(r.resolution.state==='proposed'||r.resolution.state==='asked'))?r.resolution:null,
      /* Jack, 9 Sep: "a button that the VA sends to Becki to check and then it
         greys out — that's the last thing she needs to do." Same grey row as
         with-Jack; nothing for Sarah to press until Becki answers. */
      withBecki:(typeof _isAmzDel==='function'&&_isAmzDel(r))?(r.resolution.amzDelivered||{}):null,
      draft:srtDraft(r.uuid||r.id),
      packNote:(r.notes||'').trim(),vaNote:(r.vaNote||'').trim(),
      days,isStuck,ta,reason,sev,col,value:cogs*(outstanding||units)});
  });
  /* Ordered by how close the refund window is to shutting. Age alone was
     ranking a 114-day-old order — where the money is long gone — above one with
     three days left to claim. */
  const dir=_tfuDir;
  const key={
    /* Default. A 28-day-old order with 2 days left to claim is worth more of
       her morning than a 115-day-old one whose window shut months ago — the
       money on that is already gone. */
    refund:i=>{const L=refundLeft(i.date,i);return (L!=null&&L>=0)?L:9999;},
    days:i=>-i.days, units:i=>-i.units, outstanding:i=>-i.outstanding,
    product:i=>(i.prod||'').toLowerCase(), supplier:i=>(i.sup||'').toLowerCase(),
    due:i=>i.expDate||'9999', flagged:i=>-i.sev
    ,kind:i=>({transit:0,lav:1,claim:2,job:3}[i.kind||'transit'])
  }[_tfuSort]||(i=>0);
  out.sort((a,b)=>{
    /* a question is a two-minute answer with someone waiting on it — top,
       whatever the sort (Jack, 4 Sep) */
    if(!!a.query!==!!b.query)return a.query?-1:1;
    const ka=key(a),kb=key(b);
    if(ka<kb)return -1*dir; if(ka>kb)return 1*dir;
    return b.sev-a.sev||b.days-a.days;
  });
  return out;
}

/* The chase queue as a file. CSV, not a write into Google Sheets: this app only
   ever READS that sheet, and a CSV opens in Sheets anyway (File → Import, or
   just open it) without needing permission to write anything.

   Everything needed to work the list away from the screen goes in, including
   the note and who left it — the note is usually the whole point. */
function _csvCell(v){
  let s=v==null?'':String(v);
  /* A cell beginning =, +, - or @ is executed as a FORMULA by Sheets and Excel.
     Order refs and free-text notes are typed by people, so they are prefixed to
     stay text — otherwise a note reading "-cancelled" arrives as an error. */
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function exportTransitCsv(){
  const items=_adminItems();
  if(!items.length){toast('Nothing in the queue to export','er');return;}
  const head=['Product','ASIN','SKU','Supplier','Order ref','Account','Sheet row','Ordered','Units',
    'Received','Cancelled','Still outstanding','Days in transit','Refund days left','Arrived?','Wrong SKU?',
    'Expected date','Why flagged','Status','Chase note','Note by','Note at','Value at risk'];
  const body=items.map(i=>{
    const r=rows.find(x=>x.uuid===String(i.rid)||String(x.id)===String(i.rid))||{};
    const L=refundLeft(i.date,i);
    return[i.prod||'',i.asin||'',i.sku||'',i.sup||'',i.oid||'',i.acct||'',i.sheetRow||'',i.date||'',i.units||0,
      i.got||0,i.cancelled||0,i.outstanding||0,i.days,(L===null?'':L),i.delivered||'',i.wrongSku||'',
      i.expDate||'',i.reason||'',i.ta||'',
      r.notes||'',r.notesBy||'',
      r.notesAt?new Date(r.notesAt).toLocaleString('en-GB'):'',
      (i.value||0).toFixed(2)];
  });
  const csv=[head].concat(body).map(r=>r.map(_csvCell).join(',')).join('\r\n');
  const d=new Date();
  const stamp=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const a=document.createElement('a');
  // BOM so Sheets and Excel read the £ signs and any accents correctly
  a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));
  a.download=`transit-follow-up-${stamp}.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  toast(`✓ ${items.length} row${items.length===1?'':'s'} exported`,'ok');
  try{logAudit('Transit queue exported',`${items.length} rows to CSV`);}catch(e){}
}

/* A note against one chased row. Free text, saved to Supabase on the row
   itself, so Jack reads exactly what Sarah wrote without asking. Saves when
   she clicks away or presses Enter — no button to forget. */
function _transitNote(i){
  const r=rows.find(x=>x.uuid===String(i.rid)||String(x.id)===String(i.rid));
  const val=(r&&r.notes)?r.notes:'';
  const who=(r&&r.notesBy)?r.notesBy:'';
  const when=(r&&r.notesAt)?r.notesAt:'';
  const stamp=when?`${esc(who||'')} · ${new Date(when).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} ${new Date(when).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`:'';
  return`<div style="display:flex;flex-direction:column;gap:2px;min-width:190px;">
    <textarea id="tn-${i.rid}" rows="${val?(val.length>60?3:2):1}" placeholder="Add a note…"
      onfocus="this.rows=4;this.style.borderColor='var(--accent)'"
      onblur="this.rows=this.value?(this.value.length>60?3:2):1;this.style.borderColor='var(--border2)';saveTransitNote('${i.rid}',this.value)"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur();}"
      style="width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);
        padding:5px 7px;font:inherit;font-size:11px;line-height:1.45;resize:vertical;">${esc(val)}</textarea>
    ${stamp?`<div style="font-size:11px;color:var(--text3);">${stamp}</div>`:''}
  </div>`;
}
async function saveTransitNote(rid,val){
  const r=rows.find(x=>x.uuid===String(rid)||String(x.id)===String(rid));
  if(!r)return;
  const txt=(val||'').trim();
  if((r.notes||'')===txt)return;                 // nothing changed — don't churn the database
  r.notes=txt;
  r.notesBy=txt?(window.currentUserName||'someone'):'';
  r.notesAt=txt?new Date().toISOString():'';
  r._dirty=true;
  try{
    /* the app's own row save — it already copes with columns that may not
       exist yet and keeps the sync badge honest */
    await saveRow(r);
    toast('Note saved');
    logAudit('Note',`${r.sku||r.asin||''} — ${txt.slice(0,60)}`);
  }catch(e){
    console.warn('[note] save',e);
    toast('Note didn\'t save — check the connection','er');
  }
  renderAdmin();
}
function _adminTransitSelect(i){
  const opts=['','On Its Way','Delayed','Awaiting Update','Chasing Supplier','Late — Needs Chasing','Urgent — Chase Now'];
  /* Short labels, same stored values — the full text was being clipped to
     "Late — Needs C" which reads as a broken app. */
  const shortOf={'':'— set status —','On Its Way':'On its way','Delayed':'Delayed',
    'Awaiting Update':'Awaiting update','Chasing Supplier':'Chasing','Late — Needs Chasing':'Needs chasing',
    'Urgent — Chase Now':'Urgent'};
  const bg={'Urgent — Chase Now':'rgba(239,68,68,.2)','Late — Needs Chasing':'rgba(239,68,68,.15)','Delayed':'rgba(251,146,60,.15)','Chasing Supplier':'rgba(251,146,60,.12)','Awaiting Update':'rgba(251,146,60,.1)','On Its Way':'rgba(34,197,94,.08)'}[i.ta]||'var(--bg3)';
  const fg={'Urgent — Chase Now':'#f87171','Late — Needs Chasing':'#f87171','Delayed':'#fb923c','Chasing Supplier':'#fb923c','Awaiting Update':'#fbbf24','On Its Way':'var(--green)'}[i.ta]||'var(--text2)';
  return`<select onchange="uf('${i.rid}','transitAction',this.value);renderAdmin();logAudit('Transit action (Admin)',this.value+' · ${(i.sku||'').replace(/'/g,"")}')" style="width:100%;box-sizing:border-box;font-size:10px;padding:3px 7px;background:${bg};color:${fg};border:1px solid var(--border2);border-radius:4px;cursor:pointer;font-weight:600;">
    ${opts.map(o=>`<option value="${o}" ${i.ta===o?'selected':''}>${shortOf[o]||o}</option>`).join('')}
  </select>`;
}

// VA clicked "Chased" — snooze this row for 4 days. It returns to the queue
// after that if it still hasn't been received. (UK staff marking it received on
// the Prep Sheet is what clears it permanently.)
/* Jack, 8 Sep: "she should be checking in 48 hours my emails to see if it's
   been processed." A promised refund is a wait, not a job for him: the row
   parks for two days and comes back to her to confirm it landed. */
async function refundWait(rid){
  const r=_rowById(rid);if(!r)return;
  const until=new Date();until.setDate(until.getDate()+2);
  r.chaseSnoozeUntil=until.toISOString();
  const ch=(r.resolution&&r.resolution.chase)||null;
  if(ch)ch.log=(ch.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:'Refund promised — checking the emails on '+until.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}]);
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Refund wait 48h',`${r.sku||r.asin||''} — back ${until.toISOString().slice(0,10)}`);
  toast('Parked for 2 days — it comes back for you to check the emails','ok');
  renderAdmin();
}
function snoozeChase(rid){
  const r=rows.find(x=>x.uuid===String(rid)||String(x.id)===String(rid));
  if(!r)return;
  const until=new Date();until.setDate(until.getDate()+4);
  r.chaseSnoozeUntil=until.toISOString();
  r._dirty=true;
  if(typeof saveRow==='function')saveRow(r);
  renderAdmin();
  toast('Chased — back in 4 days if not received');
  logAudit('Chase snoozed 4d',`${r.sku||''}`);
}

// One-tap follow-up actions for Sarah's Admin — the answers to "has anyone
// contacted the supplier?" and "what's next?" live on the claim itself.
function adminMarkReviewed(id){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  c.cst='Open';
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Reviewed — plan to be actioned'});
  saveClaim(c);updateCB();renderAdmin();renderClaims();
  toast('Marked reviewed — now decide the next action');
  logAudit('Issue reviewed',c.sku||c.sup||'');
}
function adminQuickChase(id){
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  if(!c.log)c.log=[];
  c.log.push({t:getNowUK(),msg:'Chased (quick log from Admin)'});
  c.lastChase=todayISO();
  if(c.cst==='Needs Attention'||c.cst==='Open')c.cst='Chasing';
  saveClaim(c);updateCB();renderAdmin();renderClaims();
  toast('Chase logged — status: '+c.cst);
  logAudit('Issue chased',c.sku||c.sup||'');
}
function _claimChaseInfo(c){
  // "Has anyone contacted the supplier?" — derived from the log itself.
  const touched=(c.log||[]).some(e=>!/raised|awaiting review/i.test(e.msg||''));
  if(!touched)return{txt:'No contact yet',col:'#f87171',days:999};
  if(c.lastChase){
    const days=Math.max(0,Math.round((new Date(todayISO())-new Date(c.lastChase))/864e5));
    return{txt:days===0?'Chased today':`Chased ${days}d ago`,col:days>=10?'#f87171':days>=7?'#fbbf24':'#4ade80',days};
  }
  return{txt:'Contacted (date unknown)',col:'#fbbf24',days:4};
}

// ── SARAH'S NOTEBOOK ────────────────────────────────────────────────────────
// A shared pad between Sarah and Jack. It lives in Supabase, not this browser,
// so whatever she writes is readable from anywhere — and it survives a cleared
// cache, a new laptop, or someone else opening the app.
let ADMIN_NOTES=[];
let _notesLoaded=false,_notesBusy=false;

async function loadAdminNotes(){
  try{
    const r=await sb.from('app_settings').select('value').eq('key','admin_notes').maybeSingle();
    if(r&&r.data&&r.data.value){
      const v=JSON.parse(r.data.value);
      if(Array.isArray(v))ADMIN_NOTES=v;
    }
    _notesLoaded=true;
  }catch(e){console.warn('[notes] load',e);}
}
async function saveAdminNotes(){
  // read-modify-write: Sarah and Jack can both be looking at this, and a blind
  // overwrite would silently bin whatever the other one just wrote
  try{
    const r=await sb.from('app_settings').select('value').eq('key','admin_notes').maybeSingle();
    let remote=[];
    if(r&&r.data&&r.data.value){try{remote=JSON.parse(r.data.value)||[];}catch(e){}}
    const byId={};
    remote.forEach(x=>{byId[x.id]=x;});
    ADMIN_NOTES.forEach(x=>{
      const ex=byId[x.id];
      if(!ex||(x.edited||'')>=(ex.edited||''))byId[x.id]=x;   // newest edit wins
    });
    ADMIN_NOTES=Object.values(byId)
      .filter(x=>!x.deleted)
      .sort((a,b)=>(b.at||'').localeCompare(a.at||''));
    const res=await sb.from('app_settings')
      .upsert({key:'admin_notes',value:JSON.stringify(ADMIN_NOTES)},{onConflict:'key'});
    if(res.error)throw res.error;
    setSyncStatus&&setSyncStatus('synced');
    return true;
  }catch(e){
    console.warn('[notes] save',e);
    toast('Note didn\'t save — check the connection','er');
    return false;
  }
}
function noteAuthor(){return window.currentUserName||'someone';}
async function addAdminNote(){
  const box=document.getElementById('noteInput');
  const txt=(box?box.value:'').trim();
  if(!txt){toast('Write something first','er');if(box)box.focus();return;}
  if(_notesBusy)return; _notesBusy=true;
  const now=new Date().toISOString();
  ADMIN_NOTES.unshift({id:'n'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36),
    txt,by:noteAuthor(),at:now,edited:now,done:false});
  if(box)box.value='';
  await saveAdminNotes();
  _notesBusy=false;
  renderAdminNotes();
  logAudit&&logAudit('Note added',txt.slice(0,80));
}
async function toggleAdminNote(id){
  const nt=ADMIN_NOTES.find(x=>x.id===id);if(!nt)return;
  nt.done=!nt.done;
  nt.doneBy=nt.done?noteAuthor():'';
  nt.doneAt=nt.done?new Date().toISOString():'';
  nt.edited=new Date().toISOString();
  renderAdminNotes();
  await saveAdminNotes();
}
async function deleteAdminNote(id){
  const nt=ADMIN_NOTES.find(x=>x.id===id);if(!nt)return;
  if(!confirm('Delete this note?\n\n"'+nt.txt.slice(0,90)+'"'))return;
  nt.deleted=true;nt.edited=new Date().toISOString();
  ADMIN_NOTES=ADMIN_NOTES.filter(x=>x.id!==id);
  renderAdminNotes();
  await saveAdminNotes();
}
async function refreshAdminNotes(){
  await loadAdminNotes();
  renderAdminNotes();
  toast('Notes refreshed');
}
function noteAgo(iso){
  if(!iso)return '';
  const then=new Date(iso),mins=Math.round((Date.now()-then.getTime())/60000);
  if(mins<1)return 'just now';
  if(mins<60)return mins+'m ago';
  const hrs=Math.round(mins/60);
  if(hrs<24)return hrs+'h ago';
  const days=Math.round(hrs/24);
  if(days<8)return days+'d ago';
  return then.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}
function renderAdminNotes(){
  const el=document.getElementById('adminNotesBody');
  if(!el)return;
  const open=ADMIN_NOTES.filter(x=>!x.done);
  const done=ADMIN_NOTES.filter(x=>x.done).slice(0,15);
  const row=nt=>`<div class="noteRow ${nt.done?'done':''}">
    <button class="noteTick" title="${nt.done?'Put it back on the list':'Mark it done'}" onclick="toggleAdminNote('${nt.id}')">${nt.done?'✓':''}</button>
    <div class="noteBody">
      <div class="noteTxt">${esc(nt.txt).replace(/\n/g,'<br>')}</div>
      <div class="noteMeta">${esc(nt.by||'')} · ${noteAgo(nt.at)}${nt.done&&nt.doneBy?` · done by ${esc(nt.doneBy)} ${noteAgo(nt.doneAt)}`:''}</div>
    </div>
    <button class="noteDel" title="Delete" onclick="deleteAdminNote('${nt.id}')">✕</button>
  </div>`;
  el.innerHTML=`
    <div class="noteNew">
      <textarea id="noteInput" rows="2" placeholder="What needs doing, what you've done, anything Jack should know…"
        onkeydown="if(event.key==='Enter'&&(event.metaKey||event.ctrlKey))addAdminNote()"></textarea>
      <button class="noteAdd" onclick="addAdminNote()">Add note</button>
    </div>
    ${open.length?`<div class="noteHead">To do <span>${open.length}</span></div>${open.map(row).join('')}`
      :'<div class="noteEmpty">Nothing outstanding. Anything you add here, Jack can read.</div>'}
    ${done.length?`<div class="noteHead muted">Done <span>${done.length}</span></div>${done.map(row).join('')}`:''}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RESOLUTION WORKFLOW — check-in, closures, approvals, action centre
// ══════════════════════════════════════════════════════════════════════════════
// Rows used to have exactly one way out of the follow-up queue: the goods had to
// physically arrive. Anything cancelled, mis-SKU'd or mis-counted had nowhere to
// go, so it sat there — hence orders at 94 days with a note and no way to close
// them. This adds the missing exits, and puts every one of them past Jack.
//
//   Sarah presses Sorted  →  proposes a closure (what happened + what's left to do)
//   Jack approves         →  the row leaves her queue, the follow-up work lands
//                            in her Action Centre
//   Jack sends it back    →  it returns to the queue with his note
//
// Nothing closes on the VA's say-so alone, by Jack's instruction.

let WEBHOOK_CFG={url:'',on:false,checkHours:48,lastAt:'',lastOk:null,lastMsg:'',digestOn:''};
let ADMIN_CHECK={at:'',by:'',alertedFor:''};
let VA_ACTIONS=[];
let _vaStateLoaded=false;
/* Part-finished close-offs, keyed by row id. Jack's call (08 Aug): SHARED, not
   private — if Sarah gets half way through one he wants to see her working, and
   a draft nobody else can see is just a note she left on her own desk. */
let SRT_DRAFTS={};

/* How something was closed. The first group is admin tidy-up; "Lost in transit"
   is the one where money is actually gone, so it is marked and shown differently
   to Jack — a real loss must never be quietly filed as sorted. */
/* kind decides who finishes the job:
     ops   — admin. Sarah investigates AND closes it. Jack is told, not asked.
     biz   — a commercial call (write it off? claim? what do we do with it?).
             Sarah still does the investigation; Jack makes the decision.
     gated — always Jack. Ungate / eBay / hold / return / write off is a
             business decision and never the VA's to make.
   Jack's rule: nothing reaches him before the basic investigation is done. */
/* Jack's eighteen live cases reduced to these. `ask` lists the extra questions
   that outcome needs — everything else stays hidden, because asking "did it
   arrive?" about a cancelled order is noise. `sheet` is the note that has to
   land against the SKU on the Purchase Sheet: an order cancelled BEFORE payment
   never completed and comes off the sheet, whereas one that was paid for and
   later refunded must stay traceable. */
let RESOLUTIONS=[
  {v:'arrived-ok',    t:'Arrived and correct',                 kind:'ops',  ask:[],
   d:'It turned up, nothing wrong',todo:[],sheet:''},
  {v:'wrong-sku',     t:'Arrived, but sent under the wrong SKU',kind:'ops', ask:['sku'],
   d:'Stock is here — it went out on another listing',todo:['Update Purchase Sheet'],sheet:'Note against the SKU: stock arrived and went out under a different SKU'},
  {v:'cancel-wrong-sku',t:'Cancelled — so it went out on another order',kind:'ops',ask:['sku','paid'],
   d:'This order was cancelled, so the stock shipped against a different order and SKU',
   todo:['Update Purchase Sheet','Mark order as cancelled'],sheet:'Note against the SKU: this order was cancelled, stock went out on another order'},
  /* Jack, 08 Aug: a WHOLE order cancelled is not the same event as one unit of
     ten being refunded, and the old single "Cancelled" made them the same.
     Full: nothing arrived, none of it is coming, so it was never really a
     purchase — off the Purchase Sheet and out of the active data whether or not
     the money left the account. Partial: the purchase genuinely happened and
     nine units are on a shelf, so the row stays and shows its real outcome. */
  {v:'cancelled',     t:'Cancelled — the whole order',           kind:'ops', ask:['paid'],full:true,
   d:'Nothing arrived and nothing is coming — the order comes off the sheet',
   todo:['Update Purchase Sheet','Mark order as cancelled','Remove outstanding quantity'],sheet:''},
  {v:'part-cancelled',t:'Part arrived, the rest cancelled',      kind:'ops', ask:['paid'],
   d:'Some came, the rest never will — the row stays with its real numbers',
   todo:['Update Purchase Sheet'],sheet:'Note against the SKU: part delivered, remainder cancelled'},
  {v:'duplicate',     t:'Duplicate record',                     kind:'ops', ask:[],
   d:'The same order twice — this one is not real',todo:['Remove from Prep Sheet','Update Purchase Sheet'],sheet:'Remove the duplicate line from the Purchase Sheet'},
  {v:'gated',         t:'Gated — business decision',            kind:'gated',ask:['arrived'],
   d:'Cannot be sold — Jack decides what happens',todo:[],sheet:''},
  {v:'no-refund',     t:'Never arrived — refund required',      kind:'biz', ask:[], claim:true,
   d:'Money is gone — a claim is needed',todo:['Raise a claim for the loss'],sheet:'Keep the purchase record — money left the account'},
  /* Jack, 3 Sep: "add in how they refused to refund it and we have to take the
     loss — or she can send it to me to escalate. Most of the time with that,
     next time we say X amount are missing." So a refusal is a real ending, not
     a dead chase: either it is written off here, or it goes to him. The note
     reminds whoever reads it that the usual recovery is on the NEXT order. */
  /* Jack, 3 Sep: May and June rows that were dealt with in real life long
     before PrepHub tracked any of it. Closing them as "arrived and correct"
     would put a fact in the history that nobody actually checked, so they get
     their own honest outcome. */
  {v:'cleared-old',   t:'Sorted outside the app',                kind:'ops', ask:[],
   d:'Dealt with before PrepHub was tracking it — cleared to start clean. History kept.',
   todo:[],sheet:''},
  {v:'refused-loss',  t:'They refused — we take the loss',      kind:'ops', ask:[],
   d:'Supplier will not refund. Written off here, and normally recovered on the next order.',
   todo:['Update Purchase Sheet'],sheet:'Note against the SKU: supplier refused the refund — written off, recover on the next order'},
  {v:'refund-done',   t:'Refund claimed',                       kind:'ops', ask:[],
   d:'Already claimed — money coming back',todo:['Update Purchase Sheet'],sheet:'Keep the purchase record and note the refund'},
  /* Jack, 3 Sep: "sometimes we sent it but it didn't make it on PrepHub as the
     UK staff forgot to add it." The stock is at Amazon and the row is sitting
     in Sarah's queue looking lost. She types the FBA shipment ID, the row is
     stamped exactly as the Prep Sheet would stamp it — so it appears on the
     Shipments page under that shipment — and it closes through the normal
     sorted flow. */
  {v:'sent-not-stamped',t:'Already sent — the shipment ID was never added',kind:'ops',ask:['shipid'],
   d:'It went to Amazon, nobody stamped it here — add the ID and it lands on the Shipments page',
   todo:[],sheet:''},
  {v:'qty-wrong',     t:'Expected quantity corrected',          kind:'ops', ask:[],
   d:'The sheet was wrong — not missing stock',todo:['Update Purchase Sheet'],sheet:'Correct the quantity on the Purchase Sheet'},
  {v:'in-transit',    t:'Still in transit — not late yet',      kind:'date',ask:[],
   d:'On its way — give it a date',todo:[],sheet:''},
  {v:'other',         t:'Something else',                       kind:'biz', ask:[],
   d:'Explain it and send it to Jack',todo:[],sheet:''}
];
/* Settings can replace this whole list from the database, and any list saved
   before today has no `full` flag on it — which would silently switch the
   whole-order cancellation behaviour back off, with nothing on screen to say
   so. Remember the built-in behaviour flags and re-apply them by outcome id
   after loading: Jack's wording still wins, the code's behaviour survives. */
const _RES_FLAGS={};
RESOLUTIONS.forEach(r=>{_RES_FLAGS[r.v]={full:!!r.full,claim:!!r.claim};});
function _reapplyResFlags(){
  RESOLUTIONS.forEach(r=>{
    const f=_RES_FLAGS[r.v];if(!f)return;
    if(f.full&&!r.full)r.full=true;
    if(f.claim&&!r.claim)r.claim=true;
  });
}
const _resAsk=v=>(RESOLUTIONS.find(x=>x.v===v)||{}).ask||[];
const _resTodo=v=>(RESOLUTIONS.find(x=>x.v===v)||{}).todo||[];
const _resSheet=v=>(RESOLUTIONS.find(x=>x.v===v)||{}).sheet||'';
const _resFull=v=>!!(RESOLUTIONS.find(x=>x.v===v)||{}).full;
/* 30 days is the refund window on ~99% of orders. Losing it because nobody
   looked is the single most expensive thing this queue can do. */
let REFUND_DAYS=30;
/* ── TIMINGS ─────────────────────────────────────────────────────────────────
   Jack, 5 Sep: "every clock in plain English" on the Settings page. Each
   number below used to be a literal somewhere in the code; the sites now read
   TM.* so one edit moves every page. Saved in app_settings.timings. */
/* Jack, 9 Sep: "Late showing all this but not all late — overview/dashboard
   doesn't match." The Late button had its own private rule: In-Transit and
   more than 20 days since the order date, full stop. It ignored a delivery
   date still in the future (the Asus rows due 9 Oct), the 35-day clock for
   Subscribe & Save, a row Jack had already closed, and rows where nothing is
   owed any more — while the dashboard's Stuck list checked all of those. Same
   question, two answers. This is the one answer, and both ask it. */
/* Jack, 9 Sep — sweep after the settle work: two rows still carried
   "Late — Needs Chasing" with everything received (both gated items booked in
   months ago). The label means "chase the supplier for what is missing", so it
   cannot outlive the shortage. Cleared wherever the row is read, saved quietly
   once — it is a label, never a decision. */
/* Jack's standing rule: the app does not change things on its own. This used
   to clear the label and save as the dashboard painted; it is now a list the
   Settle button works through, like everything else. */
/* Jack, 10 Sep, reading his Prep Sheet: "thought some of these should have
   been cleared." They were — the CLAIM was resolved, but the red chip on the
   row is its own pair of fields (`issueType` / `issueQty`) and nothing ever
   cleared them. So a settled row still shouted "Missing · 1" at the warehouse.
   Only ever a leftover: a row with an open claim, or one still owing units,
   keeps its chip. */
function _staleIssueRows(){
  try{
    return (rows||[]).filter(r=>{
      if(!r||r.archived)return false;
      if(!String(r.issueType||'').trim())return false;
      if(_owedUnits(r)>0)return false;
      const rid=r.uuid||r.id;
      const live=(typeof claims!=='undefined')&&claims.some(c=>(c.prepRowId===rid||c.prepRowId===r.id)&&c.cst!=='Resolved'&&!c.archived);
      return !live;
    });
  }catch(e){return [];}
}
/* Jack, 10 Sep: "why are these on the prep sheet then?" — Ninja and Starbucks
   had shipped every unit they held, nothing was owed, but nobody had moved the
   status on, so they stayed Part Sent on Becki's sheet for ever. Status follows
   the stock: nothing owed + nothing left to ship + something shipped = sent. */
function _shippedNotSentRows(){
  try{return (rows||[]).filter(r=>r&&!r.archived&&r.status==='Part Sent'&&(parseInt(r.ship)||0)>0&&_owedUnits(r)<=0&&(typeof remainingToShip==='function'?remainingToShip(r):1)===0);}catch(e){return [];}
}
function _staleLateRows(){
  try{return (rows||[]).filter(r=>r&&!r.archived&&/^Late/.test(String(r.transitAction||''))&&_owedUnits(r)<=0);}catch(e){return [];}
}
function _prepRowLate(r){
  if(!r||r.archived)return false;
  if(['Delivered','In Warehouse','Returned'].includes(r.status))return false;
  const owed=(r.exp||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0);
  if(r.status==='In-Transit'){if((r.exp||0)>0&&owed<=0)return false;}
  else if(r.status==='Part Sent'||r.status==='Sent to Amazon'){if(owed<=0)return false;}
  else return false;
  if(r.resolution&&r.resolution.state==='approved')return false;
  const today=new Date();
  let d=null;
  if(r.date){const[dd,mm]=String(r.date).split('/');if(dd&&mm){
    d=new Date(`${today.getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
    if(!isNaN(d)&&d>today)d.setFullYear(d.getFullYear()-1);}}
  if(!d||isNaN(d))return false;
  const days=Math.floor((today-d)/864e5);
  const after=r.subSave==='Yes'?TM.ssLateDays:TM.lateDays;
  if(days<=after)return false;
  const exp=r.expectedDelivery?new Date(r.expectedDelivery):null;
  if(exp&&!isNaN(exp)&&typeof _parkedOnDate==='function'&&_parkedOnDate(r))return false;   /* promised day still running — one rule everywhere */
  return true;
}
const TM_DEF={lateDays:20,ssLateDays:35,partDays:2,refundDays:30,caseWorkDays:5,queryRedDays:2,undoHours:48,recListedAmber:46,recListedRed:90,recUnlistedAmber:14,recUnlistedRed:30};
let TM=Object.assign({},TM_DEF);
function _tmApply(v){
  if(v&&typeof v==='object')Object.keys(TM_DEF).forEach(k=>{const n=parseInt(v[k]);if(Number.isFinite(n)&&n>0)TM[k]=n;});
  REFUND_DAYS=TM.refundDays;
}
function paintTimings(){
  Object.keys(TM_DEF).forEach(k=>{const el=document.getElementById('tm-'+k);if(el)el.value=TM[k];});
  const b=document.getElementById('aboutBuild');if(b)b.textContent=(window.LV3&&LV3.build)?LV3.build():'';
  const hb=document.querySelector('.setBuild b');if(hb&&window.LV3&&LV3.build){const _p=LV3.build().split(' · ');hb.textContent=_p[0]+' · '+_p[_p.length-1];}
  const t=document.getElementById('aboutTest');if(t)t.textContent=window.__TESTMODE__?'ON — nothing here saves':'off — this is the real app';
  const dz=document.getElementById('dangerZone');if(dz)dz.hidden=!(cu&&(cu.id==='jack'||/^jack/i.test(String(cu.name||''))));
  const pg=document.getElementById('peopleGrid');
  if(pg){const LAND={jack:'Jack’s Admin',uk:'Prep Sheet',va:'Sarah’s Admin'},DOES={jack:'Amazon accounts · decisions · danger zone',uk:'books stock in · Packing Notes · asks the admin team',va:'chases suppliers · VA Notes · works the page on Mondays'};
    pg.innerHTML=USERS.map(u=>`<div class="setPerson ${cu&&cu.id===u.id?'me':''}"><div class="av" style="background:${u.col}">${esc(u.init)}</div><b>${esc(u.name)}</b><span>${esc(u.role)} · lands on ${LAND[u.id]||'Prep Sheet'}</span><span>${DOES[u.id]||''}</span></div>`).join('');}
}
async function saveTimings(){
  const v={};Object.keys(TM_DEF).forEach(k=>{const el=document.getElementById('tm-'+k);if(el)v[k]=parseInt(el.value);});
  const bad=Object.keys(v).filter(k=>!Number.isFinite(v[k])||v[k]<=0);
  if(bad.length){toast('Every timing needs a whole number above 0','er');return;}
  if(v.recListedAmber>=v.recListedRed||v.recUnlistedAmber>=v.recUnlistedRed){toast('Amber must come before red on the Recovery clocks','er');return;}
  _tmApply(v);
  const ok=await _putSetting('timings',TM);
  if(ok===false){toast('Didn\'t save — check the connection','er');return;}
  const sv=document.getElementById('tmSaved');if(sv){sv.hidden=false;setTimeout(()=>{sv.hidden=true;},2000);}
  logAudit('Timings changed',Object.keys(TM_DEF).map(k=>k+'='+TM[k]).join(' '));
  toast('Timings saved — every page now uses them','ok');
  try{renderPrep();renderAdmin();renderJack();renderDashboard();}catch(e){}
}
function resetTimings(){_tmApply(TM_DEF);paintTimings();toast('Back to the defaults — press Save timings to keep them','ok');}
/* Jack, 16 Aug, asked which date starts the claim clock: "date of delivery."
   It used to run from the ORDER date, so a slow order could read CLAIM WINDOW
   GONE before the goods were even due. It now counts from when the stock
   landed — or, for something that never turned up, from when it was DUE to
   land. The order date is only a last resort, for rows carrying no delivery
   date at all. `row` is optional so every existing caller still works. */
function saneDate(v){const y=parseInt(String(v||'').slice(0,4),10);return y>=2020&&y<=2035;}
function refundLeft(dateDDMM,row){
  const t=new Date();
  let d=null;
  /* _adminItems carries the expected date as `expDate`, rows as
     `expectedDelivery` — both read, so the clock shows the same number
     wherever it appears. */
  const iso=row&&(row.deliveredDate||row.arrivedAt||row.expectedDelivery||row.expDate);
  if(iso){const x=new Date(iso);if(!isNaN(x))d=x;}
  if(!d){
    if(!dateDDMM)return null;
    const[dd,mm]=String(dateDDMM).split('/');
    if(!dd||!mm)return null;
    d=new Date(`${t.getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
    if(isNaN(d))return null;
    if(d>t)d.setFullYear(d.getFullYear()-1);
  }
  return REFUND_DAYS-Math.floor((t-d)/864e5);
}
let FOLLOW_UPS=[
  'Remove from Prep Sheet',
  'Update Purchase Sheet',
  'Remove outstanding quantity',
  'Mark order as cancelled',
  'Raise a claim for the loss',
  'No further action required',
  'Other'
];
const _RES_EXTRA={'qty-fixed':'Sheet quantity corrected — nothing was missing',
  'jack-check':'With Jack','amz-missing':'Amazon say delivered — not on the shelves','amz-claim':'Amazon claim'};
const _resText=v=>(RESOLUTIONS.find(x=>x.v===v)||{}).t||_RES_EXTRA[v]||v||'—';
const _resClaim=v=>!!(RESOLUTIONS.find(x=>x.v===v)||{}).claim;
let JACK_SUPPLIERS=['Amazon'];
const _resKindRaw=v=>(RESOLUTIONS.find(x=>x.v===v)||{}).kind||'biz';
/* Sarah cannot raise a claim against Amazon — that is Jack's account and his
   call. She still does the investigation; the hand-over is automatic. */
function _jackSupplier(sup){
  const t=(sup||'').toLowerCase();
  return JACK_SUPPLIERS.some(x=>x&&t.includes(String(x).toLowerCase()));
}
function _resKind(v,row){
  const k=_resKindRaw(v);
  if(k==='ops'&&_resClaim(v)&&row&&_jackSupplier(row.sup))return 'biz';
  if(v==='no-refund'&&row&&!_jackSupplier(row.sup))return 'ops';   // she owns other suppliers
  return k;
}
const _kindWord=k=>k==='gated'?'Gated — always Jack\'s decision'
  :k==='biz'?'A business decision — Jack decides'
  :k==='date'?'Not late — just needs its expected date'
  :'Admin — you can finish this yourself';
function _who(){return window.currentUserName||'someone';}

// ── LOADING / SAVING ──────────────────────────────────────────────────────────
async function loadVaState(){
  try{recLoad().catch(()=>{});}catch(e){}   /* Recovery Stock pre-loads so its page opens instantly */
  try{
    const r=await sb.from('app_settings').select('key,value').in('key',['webhook_cfg','admin_checkin','va_actions','resolution_types','follow_up_types','jack_suppliers','srt_drafts','row_seen','lav_cleared','sheet_sync_at','timings']);
    (r.data||[]).forEach(row=>{
      let v=null;try{v=JSON.parse(row.value||'null');}catch(e){return;}
      if(row.key==='srt_drafts'&&v&&typeof v==='object')SRT_DRAFTS=v;
      if(row.key==='timings'&&v&&typeof v==='object')_tmApply(v);
      if(row.key==='row_seen'&&v&&typeof v==='object'&&!Array.isArray(v))ROW_SEEN=v;
      if(row.key==='lav_cleared'&&v&&typeof v==='object'&&!Array.isArray(v))LAV_CLEARED=v;
      if(row.key==='sheet_sync_at'&&v&&typeof v==='object'){window._sheetSyncAt=v;setTimeout(paintSyncAge,500);}
      if(row.key==='webhook_cfg'&&v)WEBHOOK_CFG=Object.assign(WEBHOOK_CFG,v);
      if(row.key==='admin_checkin'&&v)ADMIN_CHECK=Object.assign(ADMIN_CHECK,v);
      if(row.key==='va_actions'&&Array.isArray(v))VA_ACTIONS=v;
      /* saved closure types replace the built-ins entirely — Jack edits them in
         Settings, so his list wins. Falls back to the defaults if empty. */
      if(row.key==='resolution_types'&&Array.isArray(v)&&v.length){
        /* A list saved before today cannot know about outcomes added since, so
           replacing wholesale silently drops them — his wording is kept, but
           anything new in the code is appended rather than lost. */
        const _seen=new Set(v.map(x=>x&&x.v));
        const _missing=RESOLUTIONS.filter(x=>!_seen.has(x.v));
        RESOLUTIONS=v.concat(_missing);_reapplyResFlags();
        if(_missing.length)console.warn('[admin] kept '+_missing.length+' newer outcome(s) the saved list did not have: '+_missing.map(x=>x.v).join(', '));
      }
      if(row.key==='follow_up_types'&&Array.isArray(v)&&v.length)FOLLOW_UPS=v;
      if(row.key==='jack_suppliers'&&Array.isArray(v))JACK_SUPPLIERS=v;
    });
  }catch(e){console.warn('[prephub] follow-up settings did not load',e);}
  _vaStateLoaded=true;   // set either way — a retry loop would be worse than stale
}
async function _putSetting(key,val){
  try{
    const r=await sb.from('app_settings').upsert({key,value:JSON.stringify(val)},{onConflict:'key'});
    if(r&&r.error)throw r.error;
    return true;
  }catch(e){console.warn('[prephub] save '+key,e);toast('That didn\'t save — check the connection','er');return false;}
}
const saveWebhookCfg=()=>_putSetting('webhook_cfg',WEBHOOK_CFG);
const saveAdminCheck=()=>_putSetting('admin_checkin',ADMIN_CHECK);
/* Read-merge-write. Jack and Sarah both have the page open; a blind overwrite
   would drop whichever of them saved first (the bug that ate her chase notes). */
async function saveVaActions(){
  try{
    const r=await sb.from('app_settings').select('value').eq('key','va_actions').maybeSingle();
    let remote=[];try{remote=JSON.parse((r.data&&r.data.value)||'[]')||[];}catch(e){}
    const byId={};
    (Array.isArray(remote)?remote:[]).forEach(a=>{byId[a.id]=a;});
    VA_ACTIONS.forEach(a=>{
      const old=byId[a.id];
      byId[a.id]=(old&&new Date(old.edited||0)>new Date(a.edited||0))?old:a;
    });
    VA_ACTIONS=Object.values(byId).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
  }catch(e){}
  return _putSetting('va_actions',VA_ACTIONS);
}

// ── 48 WORKING HOURS ──────────────────────────────────────────────────────────
/* "48 working hours, Monday to Friday" — weekend hours do not count. A Thursday
   morning check-in is therefore due back Monday morning, not Saturday. */
function addWorkingHours(from,hrs){
  const d=new Date(from);
  let left=hrs,guard=0;
  while(left>0&&guard<24*60){
    d.setHours(d.getHours()+1);guard++;
    const dow=d.getDay();
    if(dow>=1&&dow<=5)left--;
  }
  return d;
}
function checkInState(){
  const hrs=WEBHOOK_CFG.checkHours||48;
  if(!ADMIN_CHECK.at)return{never:true,late:true,due:null,ago:''};
  const at=new Date(ADMIN_CHECK.at);
  if(isNaN(at))return{never:true,late:true,due:null,ago:''};
  const due=addWorkingHours(at,hrs);
  const now=new Date();
  const mins=Math.round((now-at)/60000);
  const ago=mins<60?mins+'m ago':(mins<1440?Math.round(mins/60)+'h ago':Math.round(mins/1440)+'d ago');
  return{never:false,late:now>due,due,ago,by:ADMIN_CHECK.by||''};
}
function _dueWord(due){
  if(!due)return '';
  const now=new Date();
  const h=Math.round((due-now)/3600000);
  if(h<0)return 'overdue';
  if(h<24)return 'due in '+h+'h';
  return 'due '+due.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})+' '+
    due.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}

// ── WEBHOOK ───────────────────────────────────────────────────────────────────
/* One POST of plain JSON. `text` / `content` / `message` all carry the same
   sentence so it lands readably in Slack, Discord, Make or Zapier without the
   user having to map fields. Some endpoints refuse cross-origin reads; a no-cors
   retry still delivers, we just can't see the reply — hence "sent (no reply)". */
async function fireWebhook(text,extra){
  if(!WEBHOOK_CFG.on)return{ok:false,why:'Alerts are switched off'};
  if(!WEBHOOK_CFG.url)return{ok:false,why:'No webhook address saved'};
  const body=JSON.stringify(Object.assign({
    text,content:text,message:text,
    source:'BDL PrepHub',at:new Date().toISOString()
  },extra||{}));
  let out;
  try{
    const r=await fetch(WEBHOOK_CFG.url,{method:'POST',headers:{'Content-Type':'application/json'},body});
    out=r.ok?{ok:true,status:r.status}:{ok:false,why:'The webhook replied '+r.status};
  }catch(e){
    try{
      await fetch(WEBHOOK_CFG.url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body});
      out={ok:true,opaque:true};
    }catch(e2){out={ok:false,why:'Could not reach that address'};}
  }
  WEBHOOK_CFG.lastAt=new Date().toISOString();
  WEBHOOK_CFG.lastOk=out.ok;
  WEBHOOK_CFG.lastMsg=out.ok?(out.opaque?'Sent (no reply from the other end)':'Sent'):(out.why||'Failed');
  saveWebhookCfg();
  return out;
}
/* Fires when ANY of you opens the app and the check-in has lapsed — a page in a
   browser cannot send anything while nobody has it open. In practice someone
   opens PrepHub most working days, so it gets out. If it ever needs to be
   guaranteed, the same call belongs in a scheduled Supabase function. */
const DIGEST_HOUR=14;               // 2pm UK
async function jackDigestWatch(){
  if(!WEBHOOK_CFG.on||!WEBHOOK_CFG.url)return;
  const now=new Date();
  if(now.getHours()<DIGEST_HOUR)return;                 // not yet
  /* Local date, built from parts — NOT toISOString(), which is UTC and would
     roll the "sent today" stamp over an hour early in British Summer Time.
     (LV3 has its own localDay but it is private to that module.) */
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  if(WEBHOOK_CFG.digestOn===today)return;               // already sent today
  const{closures,checks,fixes}=jackTodo();
  const gated=claims.filter(c=>!c.archived&&c.cst!=='Resolved'&&((c.owner)||('VA'))==='Jack');
  const n=closures.length+checks.length+gated.length;
  /* Silent on a zero day — his call. An alert that fires when there is nothing
     to do is an alert people learn to ignore. */
  if(!n){WEBHOOK_CFG.digestOn=today;saveWebhookCfg();return;}
  const bits=[];
  if(checks.length)bits.push(`${checks.length} question${checks.length===1?'':'s'} from Sarah`);
  if(closures.length)bits.push(`${closures.length} close-off${closures.length===1?'':'s'} to approve`);
  if(gated.length)bits.push(`${gated.length} gated`);
  if(fixes.length)bits.push(`${fixes.length} quantity fix${fixes.length===1?'':'es'} to glance at`);
  /* how long the oldest has been sitting — the bit that makes it land */
  let oldest=0;
  [...closures,...checks].forEach(r=>{
    const t=(r.resolution||{}).askedAt||(r.resolution||{}).at;
    if(t)oldest=Math.max(oldest,Math.floor((Date.now()-new Date(t).getTime())/864e5));
  });
  const res=await fireWebhook(
    `@Jack — ${n} thing${n===1?'':'s'} need you on PrepHub: ${bits.join(', ')}.`+
    (oldest>=3?` Oldest has been waiting ${oldest} days.`:''),
    {event:'jack_daily_digest',count:n,checks:checks.length,closures:closures.length,gated:gated.length});
  if(res.ok){WEBHOOK_CFG.digestOn=today;saveWebhookCfg();}
}
async function checkInWatch(){
  const st=checkInState();
  if(!st.late)return;
  const stamp=st.due?st.due.toISOString():'never';
  if(ADMIN_CHECK.alertedFor===stamp)return;            // already sent for this lapse
  const res=await fireWebhook("Please check Sarah's Admin page on the Prep Portal.",{
    event:'admin_checkin_overdue',
    lastChecked:ADMIN_CHECK.at||'never checked',
    lastCheckedBy:ADMIN_CHECK.by||'',
    waiting:_adminItems().length,
    untouchedPast20:_adminItems().filter(i=>i.days>=20).length,
    refundWindowClosingSoon:_adminItems().filter(i=>{const L=refundLeft(i.date,i);return L!==null&&L>=0&&L<=7;}).length
  });
  if(res.ok){ADMIN_CHECK.alertedFor=stamp;await saveAdminCheck();}
}
async function adminCheckIn(){
  ADMIN_CHECK={at:new Date().toISOString(),by:_who(),alertedFor:''};
  await saveAdminCheck();
  renderAdmin();
  try{renderDashboard();}catch(e){}
  toast('Checked — thanks. Next check '+_dueWord(checkInState().due),'ok');
  logAudit('Admin checked',_who());
}
async function testWebhook(btn){
  if(btn){btn.disabled=true;btn.textContent='Sending…';}
  const cfg=document.getElementById('whUrl');
  if(cfg)WEBHOOK_CFG.url=(cfg.value||'').trim();
  WEBHOOK_CFG.on=true;
  const r=await fireWebhook('Test from BDL PrepHub — alerts are working.',{event:'test'});
  if(btn){btn.disabled=false;btn.textContent='Send test';}
  toast(r.ok?('Test sent'+(r.opaque?' — the other end gave no reply, check it arrived':'')):('Test failed — '+(r.why||'')),r.ok?'ok':'er');
  renderWebhookCard();
}
async function saveWebhookSettings(){
  const u=document.getElementById('whUrl'),o=document.getElementById('whOn'),h=document.getElementById('whHours');
  if(u)WEBHOOK_CFG.url=(u.value||'').trim();
  if(o)WEBHOOK_CFG.on=!!o.checked;
  if(h)WEBHOOK_CFG.checkHours=Math.max(1,parseInt(h.value)||48);
  if(await saveWebhookCfg())toast('Alert settings saved','ok');
  renderWebhookCard();
}
// ── EDITING THE CLOSURE TYPES ────────────────────────────────────────────────
const RES_KINDS=[['ops','Admin — Sarah closes it'],['biz','Business decision — Jack'],
                 ['gated','Gated — always Jack'],['date','Not a closure, sets a date']];
function renderResTypes(){
  const el=document.getElementById('resTypes'); if(!el)return;
  el.innerHTML=RESOLUTIONS.map((o,i)=>`<div class="rtRow">
    <div class="rtGrid">
      <input class="fi-in" value="${esc(o.t||'')}" placeholder="What happened" oninput="RESOLUTIONS[${i}].t=this.value">
      <select class="fi-in" onchange="RESOLUTIONS[${i}].kind=this.value;renderResTypes()">
        ${RES_KINDS.map(([k,lab])=>`<option value="${k}" ${o.kind===k?'selected':''}>${lab}</option>`).join('')}
      </select>
      <button class="rtDel" title="Remove this option" onclick="RESOLUTIONS.splice(${i},1);renderResTypes()">✕</button>
    </div>
    <input class="fi-in" style="font-size:11px;" value="${esc(o.d||'')}" placeholder="One-line description shown on the card" oninput="RESOLUTIONS[${i}].d=this.value">
    <input class="fi-in" style="font-size:11px;" value="${esc(o.sheet||'')}" placeholder="Purchase Sheet note this creates (optional)" oninput="RESOLUTIONS[${i}].sheet=this.value">
    <input class="fi-in" style="font-size:11px;" value="${esc((o.todo||[]).join(', '))}" placeholder="Jobs ticked automatically — comma separated, must match the list below" oninput="RESOLUTIONS[${i}].todo=this.value.split(',').map(x=>x.trim()).filter(Boolean)">
  </div>`).join('');
}
function addResType(){
  RESOLUTIONS.push({v:'r'+Date.now().toString(36),t:'',d:'',kind:'ops',ask:[],sheet:''});
  renderResTypes();
}
async function saveResTypes(){
  const clean=RESOLUTIONS.filter(o=>(o.t||'').trim());
  if(!clean.length){toast('Keep at least one option','er');return;}
  RESOLUTIONS=clean;
  if(await _putSetting('resolution_types',RESOLUTIONS)){
    toast('Closure options saved','ok');
    logAudit('Closure options edited',RESOLUTIONS.length+' options');
  }
  renderResTypes();
}
async function resetResTypes(){
  if(!confirm('Put the closure options back to the built-in list?'))return;
  await _putSetting('resolution_types',[]);
  toast('Reset — reload to see the defaults','ok');
}
function renderFollowUps(){
  const el=document.getElementById('fuTypes'); if(!el)return;
  el.innerHTML=FOLLOW_UPS.map((f,i)=>`<div class="rtGrid" style="grid-template-columns:1fr 30px;margin-bottom:6px;">
    <input class="fi-in" value="${esc(f)}" placeholder="What still needs doing" oninput="FOLLOW_UPS[${i}]=this.value">
    <button class="rtDel" title="Remove" onclick="FOLLOW_UPS.splice(${i},1);renderFollowUps()">✕</button>
  </div>`).join('');
}
function addFollowUp(){FOLLOW_UPS.push('');renderFollowUps();}
async function saveJackSuppliers(){
  const el=document.getElementById('jackSups');
  JACK_SUPPLIERS=((el&&el.value)||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(await _putSetting('jack_suppliers',JACK_SUPPLIERS))toast('Saved','ok');
}
async function saveFollowUps(){
  const clean=FOLLOW_UPS.map(f=>(f||'').trim()).filter(Boolean);
  if(!clean.length){toast('Keep at least one','er');return;}
  FOLLOW_UPS=clean;
  if(await _putSetting('follow_up_types',FOLLOW_UPS)){
    toast('Follow-up jobs saved','ok');
    logAudit('Follow-up jobs edited',FOLLOW_UPS.length+' options');
  }
  renderFollowUps();
}
function renderWebhookCard(){
  const el=document.getElementById('whState');
  if(!el)return;
  const st=checkInState();
  el.innerHTML=`
    <div style="font-size:11px;color:var(--text2);font-weight:600;">
      ${WEBHOOK_CFG.on&&WEBHOOK_CFG.url
        ? `<span style="color:var(--green);">On</span> — an alert goes out if Sarah's Admin isn't checked within ${WEBHOOK_CFG.checkHours||48} working hours`
        : `<span style="color:#fbbf24;">Off</span> — nothing will be sent`}
    </div>
    <div style="font-size:11px;color:var(--text3);font-weight:600;margin-top:3px;">
      ${st.never?'Never checked yet':`Last checked ${esc(st.by||'')} · ${st.ago} · next ${_dueWord(st.due)}`}
      ${WEBHOOK_CFG.lastAt?` · last alert: ${esc(WEBHOOK_CFG.lastMsg||'')}`:''}
    </div>`;
}
