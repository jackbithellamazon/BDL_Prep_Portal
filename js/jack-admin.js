/* BDL PrepHub — js/jack-admin.js — Jack’s Admin: money promised, his cards, ask Jack, triage + due dates.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
/* ── MONEY PROMISED BUT NOT PAID ────────────────────────────────────────────
   Jack, 16 Aug: "turns grey as it's sorted and that gets put on my sheets
   after 24 hours… it goes off her sheet but stays on mine so I know I'm owed
   money." A supplier's promise closes Sarah's job, but the cash has not
   landed — so when the 24-hour undo window runs out the row leaves her queue
   and appears here instead. Deliberately NOT counted in `n`: this is not work
   waiting on him, it is a debt he is watching. Same row, his side of it —
   nothing is duplicated. */
function moneyOwed(){
  return rows.filter(r=>{
    const q=r.resolution;
    if(!q||q.state!=='approved')return false;
    if(q.what!=='refund-done'&&q.what!=='no-refund')return false;
    if(q.moneyIn)return false;                       // he has confirmed it landed
    if(q.moneyOff)return false;                      // written off — no money is coming
    const at=new Date(q.approvedAt||q.at||0).getTime();
    return Date.now()-at>=864e5;                     // after the undo window
  }).map(r=>{
    const q=r.resolution;
    const at=new Date(q.approvedAt||q.at||0).getTime();
    const cogs=parseSKU(r.sku).cogs||0;
    /* the claim is for the units that went missing. Once they are written off
       the row balances, so the live sum reads 0 — falling back to the whole
       order then billed Amazon for stock that actually turned up. */
    const units=(parseInt(q.refundUnits)||0)||Math.max(0,(r.exp||r.ship||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0))||(r.exp||0);
    return{r,q,units,waiting:Math.floor((Date.now()-at)/864e5),
      value:cogs*units};
  }).sort((a,b)=>b.waiting-a.waiting);
}
/* He has seen the money. This is the only thing that closes the debt. */
/* the refund has been raised in the Amazon account — job done, off the list */
async function refundRaised(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  r.resolution.refundRaised={by:_who(),at:new Date().toISOString()};
  const ch=r.resolution.chase;if(ch)ch.log=(ch.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:'Refund raised in the Amazon account'}]);
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded','er');return;}
  logAudit('Refund raised',`${r.sku||r.asin||''} — by ${_who()}`);
  toast('Refund raised — done','ok');
  renderJack();try{renderAdmin();renderDashboard();}catch(e){}
}
/* a refund that is never going to be paid — off the money list, still on the
   record. Never silent: it says so in the log and the audit trail. */
async function amzWriteOff(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  const now=new Date().toISOString();
  const ch=r.resolution.chase||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Written off — Amazon would not refund'}]);
  r.resolution=Object.assign({},r.resolution,{moneyOff:{by:_who(),at:now,why:'Amazon would not refund'},chase:ch});
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Refund written off',`${r.sku||r.asin||''} — no money coming, by ${_who()}`);
  toast('Written off — off the money list, still in the record','ok');
  renderJack();try{renderAdmin();renderDashboard();}catch(e){}
}
async function moneyLanded(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  r.resolution.moneyIn={by:_who(),at:new Date().toISOString()};
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded','er');return;}
  logAudit('Refund received',`${r.sku||r.asin||''} — confirmed by ${_who()}`);
  toast('Marked as received — off the money list','ok');
  renderJack();try{renderAdmin();renderDashboard();}catch(e){}
}
/* Jack, 16 Aug, on a refund that never lands: "I move it back on her sheet to
   escalate." The closure is undone, the row returns to her queue at the chase
   step carrying its whole history, and his reason is on it. */
async function escalateMoney(rid){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  const keep=r.resolution.chase||{path:'never-arrived',step:'waiting',log:[]};
  keep.step='waiting';keep.due='';
  keep.log=(keep.log||[]).concat([{at:new Date().toISOString(),by:_who(),
    what:'Refund was promised but never arrived — sent back to escalate'}]);
  r.resolution={state:'rejected',kind:'check',what:'jack-check',chase:keep,
    rejectedBy:_who(),rejectNote:'The refund never landed — chase them again and escalate it.',
    at:new Date().toISOString()};
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded','er');return;}
  logAudit('Refund escalated',r.sku||r.asin||'');
  try{fireWebhook(`${_who()} sent "${r.prod||r.sku||''}" back to Sarah — the promised refund never arrived`,{event:'money_escalated'});}catch(e){}
  toast('Back on Sarah\'s sheet to escalate','ok');
  renderJack();try{renderAdmin();renderDashboard();}catch(e){}
}

// ── JACK'S ADMIN ──────────────────────────────────────────────────────────────
/* Jack, 08 Aug: "I absolutely hate the current Issues page… it feels messy and
   doesn't fit how the process actually works." It was a list of problems with
   nobody's name on it, sitting beside a queue organised by who owns things, so
   the same row appeared twice and the two drifted apart.
   Every live item belongs to exactly one of them. This is his half. */
function paintJackBadge(){/* badge retired — Jack, 30 Aug: "get rid of the 4" */}
function renderJack(){
  const w=document.getElementById('jackWrap');if(!w)return;
  /* Same gate as every other page: skip while unseen, note the debt, repaint on
     return. */
  if(document.hidden||!_pageActive('page-jack')){_dirtyR.jack=true;return;}
  _dirtyR.jack=false;
  const _st=w.scrollTop||0;   /* a repaint must not throw him back to the top */
  /* Jack, 17 Aug: "jack's admin needs a whole redesign — make it more table
     like, like Sarah's… way too much wasted space, but like the idea of having
     KPIs there." So: a slim KPI strip of real numbers, then ONE table in the
     same anatomy as her page — product, who sent it, the money, what is wrong,
     and his move inline on the row. No cards, no dead columns of air. */
  const{closures,checks,fixes,claimsQ,lavQ,lavLate,owed,n}=jackTodo();
  const esc1=s=>String(s).replace(/'/g,"\\'");
  const items=[];
  const days=t=>t?Math.floor((Date.now()-new Date(t).getTime())/864e5):0;
  (lavLate||[]).forEach(g=>{let tj={};try{tj=JSON.parse(g.toJack||'{}');}catch(e){}
    const _id='jkLD_'+String(g.key).replace(/[^a-z0-9]/gi,'_');
    /* a late order is his the day it goes late — nobody "sent" it */
    const _since=tj.at||(g.eta?g.eta+'T12:00:00Z':'');
    items.push({kind:'lavlate',id:g.key,prod:g.name,sup:g.sup,oid:g.oid,acct:g.acct||'',sku:'',asin:'',
      by:tj.by||'Late order',at:_since,wait:days(_since),type:['LATE ORDER','#c084fc','A Lavarion order past its window with nothing booked in — yours first. A date clears it; a job goes to Sarah with your note.'],
      why:esc(`${fmt(g.owed)} still owed · ordered ${g.ordered?_dmy(g.ordered):'—'} · ${g.eta?'was due '+_dmy(g.eta):'no window'} · ${g.days}d`),
      note:'',value:g.cost||0,left:null,
      acts:`<input type="date" id="${_id}" class="jkAnsDate" min="2024-01-01" max="2030-12-31" title="The date the supplier gave" onkeydown="if(event.key==='Enter'){event.preventDefault();lavLateNewDate('${esc1(g.key)}',this.value);}">
        <button class="csAct good" onclick="lavLateNewDate('${esc1(g.key)}',document.getElementById('${_id}').value)" title="The order's window moves to this date, it stops being late and clears everywhere">New date &mdash; done</button>
        <button class="csAct plain" onclick="lavLateSarahBox('${esc1(g.key)}',this)" title="Something for Sarah to do on this one — chase, check an invoice, ring them. It lands on her Admin with your note.">Send Sarah a job&hellip;</button>`});});
  checks.forEach(r=>{const q=r.resolution||{};const Q=_ukQuery(r);const _id=r.uuid||r.id;
    if(q.what==='amz-missing'||q.what==='amz-claim'){
      const _owe=Math.max(0,(r.exp||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0));
      items.push({kind:'check',id:_id,prod:r.prod||r.sku||'',sup:r.sup,oid:r.oid,acct:r.acct,sku:r.sku,asin:r.asin||'',
        by:q.by||'someone',at:q.at,wait:days(q.at),
        type:q.what==='amz-claim'
          ?['AMAZON — WITH YOU','#22d3ee','Amazon say it was never delivered — yours to claim']
          :['AMAZON SAYS DELIVERED','#22d3ee','Becki checked the shelves — not there. Raise it with Amazon.'],
        why:esc(q.what==='amz-claim'
          ?`${fmt(_owe)} unit${_owe===1?'':'s'} never delivered — refund or reimbursement to raise`
          :`${fmt(_owe)} unit${_owe===1?'':'s'} Amazon say ${_owe===1?'was':'were'} delivered — not in the warehouse`),note:'',
        clog:(q.chase&&q.chase.log)||[],expDate:r.expectedDelivery||'',
        value:(parseSKU(r.sku).cogs||0)*_owe,left:refundLeft(r.date,r),
          acts:`<button class="csAct good" onclick="amzMoneyBox('${_id}',this)" title="Sorted with Amazon — it asks what happened to the money so a refund that never lands does not quietly disappear">Sorted with Amazon&hellip;</button>
          <button class="csAct plain" onclick="jackAmzDate('${_id}',this)" title="Amazon are sending it again — record the date, the row parks">Replacement coming &mdash; date&hellip;</button>
          <button class="csAct plain" onclick="jackAnswerAsk('${_id}')">Back to Sarah with a note</button>`});
      return;
    }
    /* a warehouse question Sarah passed over is answered in its own terms —
       "is more on the way?" — not with Arrived YES/NO */
    items.push({kind:'check',id:_id,prod:r.prod||r.sku||'',sup:r.sup,oid:r.oid,acct:r.acct,sku:r.sku,
      asin:r.asin||'',by:q.by||'someone',at:q.at,wait:days(q.at),
      type:Q?['QUERY','#38bdf8','The warehouse asked whether more is on the way — Sarah passed it to you']:['CHECK','#60a5fa','An Amazon order she cannot see — did it arrive?'],
      why:Q?esc(`${Q.by||'Warehouse'} asked: ${Q.got?Q.got+' of '+Q.exp+' booked in — is more on the way?':'nothing booked in — has it been dispatched?'}${Q.note?' — “'+Q.note+'”':''}${q.ask?' · Sarah: '+q.ask:''}`)
         :(q.note?`${esc(q.note)}<div style="font-size:9.5px;font-weight:700;color:var(--text3);margin-top:3px;">${esc(q.ask||'')}</div>`:esc(q.ask||'Check this order')),
      note:q.note||'',
      /* a fresh question has no chase yet — the question itself is the latest line */
      clog:((q.chase&&q.chase.log&&q.chase.log.length)?q.chase.log:(Q?[{at:Q.at,by:Q.by,what:'Asked — '+(Q.ask||'')+(Q.note?' — “'+Q.note+'”':'')}]:[])),expDate:r.expectedDelivery||'',
      value:(parseSKU(r.sku).cogs||0)*Math.max(0,(r.exp||r.ship||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0)),
      left:refundLeft(r.date,r),
      owedU:Math.max(0,(r.exp||r.ship||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0)),
      age:_ordAge(r),odate:r.date||'',
      acts:_jkCheckActs(r,_id)});});
  /* Jack, 10 Sep, the Wella: one order number, two rows, 24 units shipped
     against 20 ordered. Not a decision the app can make — a card that puts the
     rows side by side so he can. Only fires when the rows between them have
     received MORE than the biggest order quantity among them. */
  (()=>{try{
    const byO={};rows.forEach(r=>{const o=String(r.oid||'').trim();if(!o||o==='—')return;if(!((parseInt(r.rcvd)||0)>0||(parseInt(r.ship)||0)>0))return;(byO[o]=byO[o]||[]).push(r);});
    Object.entries(byO).forEach(([o,list])=>{
      if(list.length<2)return;
      if(list.every(r=>r.archived))return;
      const gotSum=list.reduce((t,r)=>t+(parseInt(r.rcvd)||0),0);
      const skus=new Set(list.map(r=>String(r.sku||'').trim().toLowerCase()));
      const expMax=skus.size>1?list.reduce((t,r)=>t+(parseInt(r.exp)||0),0):Math.max(...list.map(r=>parseInt(r.exp)||0));
      if(gotSum<=expMax)return;
      const live=list.find(r=>!r.archived)||list[0];
      items.push({kind:'fix',id:live.uuid||live.id,prod:live.prod||live.sku||'',sup:live.sup,oid:o,acct:live.acct,sku:'',asin:live.asin||'',
        by:'Sheet',at:live.updated_at||live.date||'',wait:0,noNag:true,
        type:['ONE ORDER · TWO ROWS','#f97316','The same order number is on more than one row and, between them, more units have been booked than were ordered'],
        why:esc(`${fmt(gotSum)} units received across ${list.length} rows against ${fmt(expMax)} ordered${skus.size>1?' (different SKUs — counted as separate purchases)':''}`),
        note:list.map(r=>`${r.sku||'—'}: ${fmt(parseInt(r.rcvd)||0)} in · ${fmt(parseInt(r.ship)||0)} shipped${r.shipId?' on '+r.shipId:''}${r.archived?' · archived':''}`).join('  |  '),
        value:0,left:null,
        acts:list.map(r=>`<button class="csAct plain" onclick="openWork('${r.uuid||r.id}')" title="Open this row">${esc((r.sku||'row').slice(-14))}${r.archived?' (archived)':''}</button>`).join('')});
    });
  }catch(e){}})();
  closures.forEach(r=>{const q=r.resolution||{};
    items.push({kind:'dec',id:r.uuid||r.id,prod:r.prod||r.sku||'',sup:r.sup,oid:r.oid,acct:r.acct,sku:r.sku,
      asin:r.asin||'',by:q.by||'someone',at:q.at,wait:days(q.at),type:['DECISION','#c084fc','She investigated — your call'],
      why:esc(_resText(q.what))+(q.claim?' · money at risk':''),note:q.note||'',fix:q.fix||'',
      clog:(q.chase&&q.chase.log)||[],expDate:r.expectedDelivery||'',
      value:(parseSKU(r.sku).cogs||0)*(r.exp||r.ship||0),left:refundLeft(r.date,r),
      acts:`<button class="csAct good" onclick="approveResolution('${r.uuid||r.id}')">Approve &amp; close</button>
        <button class="csAct warn" onclick="rejectResolution('${r.uuid||r.id}')">Send back</button>
        <button class="csAct plain" onclick="backToSarah('${r.uuid||r.id}')" title="No decision needed from me">Not my call</button>`});});
  (claimsQ||[]).forEach(c=>{const gated=(c.issT||'')==='Gated';const sj=c.sentToJack||{};
    items.push({kind:'claim',id:c.id,prod:c.prod||c.sku||'',sup:c.sup,oid:c.oid,acct:c.acct,sku:c.sku,asin:c.asin||'',
      claimLog:(c.log||[]).slice(-3).reverse(),units:c.dif||c.exp||0,
      perUnit:(c.claimValue&&(c.dif||c.exp))?(c.claimValue/(c.dif||c.exp)):0,
      raisedDays:c.raisedAt?Math.max(0,Math.floor((Date.now()-new Date(c.raisedAt).getTime())/864e5)):null,
      na:c.nextAction||'',
      /* a gated claim he took off Sarah himself is his, not something she is waiting on */
      by:sj.at?(sj.by||c.raisedBy||'someone'):(gated?'Yours — gated':(c.raisedBy||'someone')),at:sj.at||c.raisedAt,wait:days(sj.at||c.raisedAt),noNag:!sj.at,
      type:gated?['GATED','#c084fc','Cannot be sold — eBay it or ungate it']:['CLAIM','#fbbf24','A claim she sent over'],
      why:esc((c.issT||'Issue')+' · '+(c.dif||0)+' unit'+((c.dif||0)===1?'':'s')),note:c.notes||'',
      value:c.claimValue||0,left:null,
      acts:(gated?`<button class="csAct go" onclick="recFromClaimModal('${c.id}')" title="Fill in what it is, then it lands in Recovery Stock under Needs Sorting">eBay it &rarr; Recovery</button>
          <button class="csAct go" onclick="setGatedDecision('${c.id}','Ungate')">Ungate</button>
          <button class="csAct plain" onclick="takeGatedMine('${c.id}')" title="Nobody but you can act on a gated item — this takes it off Sarah's Admin and off the Prep Sheet and leaves it here. Undo puts it back.">Off their lists</button>`:'')+
        `<button class="csAct good" onclick="claimBackFromJack('${c.id}')">Answer &amp; hand back</button>`});});
  (lavQ||[]).forEach(g=>{let tj={};try{tj=JSON.parse(g.toJack||'{}');}catch(e){}
    items.push({kind:'lav',id:g.key,prod:g.lines.map(x=>x.name).join(', '),sup:g.sup,oid:g.ref,acct:'',sku:'',
      by:tj.by||'Check-in',at:tj.at||(g.on?g.on+'T12:00:00Z':''),wait:days(tj.at||(g.on?g.on+'T12:00:00Z':'')),
      type:['SHORTAGE','#38bdf8','Short or damaged at a Lavarion check-in — yours first. Send Sarah a job with your note, or clear it.'],
      why:esc([g.short?g.short+' short':'',g.dmg?g.dmg+' damaged':''].filter(Boolean).join(' · ')+(g.sup?' · '+g.sup:'')),
      note:(g.log&&g.log.length?g.log[g.log.length-1].msg:''),value:g.val||0,left:null,
      acts:(g.toJack?`<button class="csAct good" onclick="lavBackFromJack('${esc1(g.key)}')" title="Sarah sent this back to you — your answer goes on it and it returns to her">Answer &amp; hand back</button>`:'')
        +`<button class="csAct go" onclick="lavIssueSarahBox('${esc1(g.key)}',this)" title="Something for Sarah to do — chase the supplier, get a credit, ring them. It lands on her Admin with your note.">Send Sarah a job&hellip;</button>
          <button class="csAct plain" onclick="clearOldLav('${esc1(g.key)}')" title="Dealt with — off every list. Undo from the toast.">Sorted &mdash; clear it</button>
          <button class="csAct plain" onclick="openLavIssue('${esc1(g.key)}')" title="Photos, the conversation so far, every line">Open it</button>`});});
  fixes.forEach(r=>{const f=r.qtyFix||{};
    items.push({kind:'fix',id:r.uuid||r.id,prod:r.prod||r.sku||'',sup:r.sup,oid:r.oid,acct:r.acct,sku:r.sku,asin:r.asin||'',
      by:f.by||'someone',at:f.at,wait:days(f.at),type:['QTY FIX','#94a3b8','The sheet was wrong — read and wave through'],
      why:esc(String(f.from??'?'))+' &rarr; '+esc(String(f.to??'?'))+' units',note:f.why||'',value:0,left:null,
      acts:`<button class="csAct plain" onclick="ackQtyFix('${r.uuid||r.id}')">Seen it</button>`});});
  (owed||[]).forEach(o=>{const r=o.r;const _u=o.units||Math.max(0,(r.exp||r.ship||0)-(parseInt(r.rcvd)||0)-(parseInt(r.cancelledQty)||0));
    /* two different jobs on one list: a refund nobody has raised yet, and one
       you raised that Amazon has not paid. Only the second needs watching. */
    const _waitingOnMoney=o.q.what==='refund-done'&&o.q.refundRaised;
    items.push({kind:'refund',id:r.uuid||r.id,prod:r.prod||r.sku||'',sup:r.sup,oid:r.oid,acct:r.acct,sku:r.sku,asin:r.asin||'',
      by:o.q.by||'someone',at:o.q.approvedAt||o.q.at,wait:o.waiting,
      type:_waitingOnMoney?['WAITING ON THE MONEY','#fbbf24','You raised this with Amazon — it stays here until you say the money has landed']
        :['REFUND TO RAISE','#34d399','Sarah closed it as never arrived — only you can raise the refund in the Amazon account'],
      why:esc(_waitingOnMoney?`Raised ${o.waiting}d ago · ${fmt(_u)} unit${_u===1?'':'s'} · nothing received yet`
        :`Never arrived · ${fmt(_u)} unit${_u===1?'':'s'} · closed by ${o.q.by||'someone'}`),
      note:(o.q.chase&&(o.q.chase.log||[]).length)?o.q.chase.log.slice(-1)[0].what:'',
      clog:(o.q.chase&&o.q.chase.log)||[],expDate:'',
      value:o.value||0,left:refundLeft(r.date,r),
      acts:_waitingOnMoney
        ?`<button class="csAct good" onclick="moneyLanded('${r.uuid||r.id}')" title="The money is in the account — this is the only thing that closes the debt">Money landed &#10003;</button>
          <button class="csAct warn" onclick="amzWriteOff('${r.uuid||r.id}')" title="Amazon are not paying — written off. It stays in the record as a loss.">No money coming &mdash; write it off</button>
          <button class="csAct plain" onclick="escalateMoney('${r.uuid||r.id}')" title="Back on Sarah's sheet with the history, to chase and escalate">Back to Sarah</button>`
        :`<button class="csAct good" onclick="refundRaised('${r.uuid||r.id}')" title="Raised in the Amazon account — it moves to Waiting on the money">Refund raised &#10003;</button>
          <button class="csAct warn" onclick="escalateMoney('${r.uuid||r.id}')" title="Back on Sarah's sheet with the history, to chase and escalate">Back to Sarah</button>`});});
  const order={check:0,dec:1,refund:2,claim:3,lav:4,fix:5};
  items.sort((a,b)=>{
    switch(_jkSort){
      case 'oldest':return (b.wait||0)-(a.wait||0);
      case 'newest':return (a.wait||0)-(b.wait||0);
      case 'money':return (b.value||0)-(a.value||0);
      case 'claim':{const ax=a.left==null?9e9:(a.left<0?9e8:a.left),bx=b.left==null?9e9:(b.left<0?9e8:b.left);return ax-bx;}
      case 'supplier':return String(a.sup||'').localeCompare(String(b.sup||''))||(b.wait||0)-(a.wait||0);
      default:return (order[a.kind]-order[b.kind])||(b.wait-a.wait);
    }
  });
  /* Same toolbar language as Sarah's page — search, chips with counts. */
  const _jkCounts={all:items.length};
  items.forEach(it=>{_jkCounts[it.kind]=(_jkCounts[it.kind]||0)+1;});
  let shown=items;
  const _q=(_jkQ||'').toLowerCase();
  if(_q)shown=shown.filter(it=>[it.prod,it.sup,it.oid,it.sku,it.by,it.note,it.why].filter(Boolean).join(' ').toLowerCase().includes(_q));
  if(_jkKind!=='all')shown=shown.filter(it=>it.kind===_jkKind);
  if(_jkSup!=='all')shown=shown.filter(it=>String(it.sup||'')===_jkSup);
  if(_jkAcct!=='all')shown=shown.filter(it=>String(it.acct||'')===_jkAcct);
  const owedTotal=(owed||[]).reduce((a,o)=>a+(o.value||0),0);
  const atRisk=items.filter(i=>i.kind!=='fix').reduce((a,i)=>a+(i.value||0),0);
  const needs=shown.filter(it=>it.kind!=='fix'),info=shown.filter(it=>it.kind==='fix');
  const needsAll=items.filter(it=>it.kind!=='fix');
  const fromSarah=needsAll.filter(it=>!/^jack/i.test(String(it.by||''))).length;
  const refundsN=(owed||[]).length,refundsVal=(owed||[]).reduce((a,o)=>a+(o.value||0),0);
  const decN=closures.length+(claimsQ||[]).filter(c=>(c.issT||'')==='Gated').length;
  const oldest=needsAll.length?Math.max(...needsAll.map(i=>i.wait||0)):0;
  /* A KPI you can press IS the filter — click "to check" and the table shows
     only checks; click it again for everything. */
  /* Jack, 30 Aug: "more KPIs — how many sent to Jack, gated, waiting on
     reimbursements and refunds and replacements — what is Sarah doing or not
     done — what do I need to chase — do I need to tell her off?" */
  const _ps={chasing:0,quiet:0,quietOld:0,replacement:0,parked:0};
  rows.forEach(r=>{
    if(r.archived)return;
    const c=_caseOf(r);if(!c||c.path!=='never-arrived')return;
    if(c.step==='due-date')_ps.parked++;
    else if(c.step==='replacement')_ps.replacement++;
    else if(c.step==='waiting'||c.step==='contact'||c.step==='check-refund'){
      _ps.chasing++;
      const od=_caseDue(c);
      if(od!==null&&od>0){_ps.quiet++;_ps.quietOld=Math.max(_ps.quietOld,od);}
    }
  });
  const _gatedList=claims.filter(c=>!c.archived&&c.cst!=='Resolved'&&/gated/i.test(c.issT||''));
  const _gated=_gatedList.length;
  /* rolling 30 days — "what has been happening RECENTLY", not all-time */
  const _cut30=Date.now()-30*864e5;
  const _in30=s=>{const d=new Date(s||0).getTime();return d>=_cut30;};
  const _raised30=claims.filter(c=>_in30(c.raisedAt)).length;
  const _res30=claims.filter(c=>c.cst==='Resolved'&&_in30(c.resolvedAt));
  const _rec30=_res30.filter(c=>c.reimbursed==='Yes').reduce((t,c)=>t+(c.claimValue||0),0);
  const _stuck30=claims.filter(c=>!c.archived&&c.cst!=='Resolved'&&!/gated/i.test(c.issT||'')&&!_in30(c.raisedAt)).length;
  const _cut7=Date.now()-7*864e5;
  const _in7=s=>{const d=new Date(s||0).getTime();return d>=_cut7;};
  const _res7=claims.filter(c=>c.cst==='Resolved'&&_in7(c.resolvedAt));
  const _rec7=_res7.filter(c=>c.reimbursed==='Yes').reduce((t,c)=>t+(c.claimValue||0),0);
  const _new7=claims.filter(c=>_in7(c.raisedAt)).length;
  const _gAsins=new Set(_gatedList.map(c=>c.asin).filter(Boolean)).size;
  const _gUnits=_gatedList.reduce((t,c)=>t+(c.dif||c.exp||0),0);
  const _gVal=_gatedList.reduce((t,c)=>t+(c.claimValue||0),0);
  /* her page, summarised for him: open work, money tied up, untouched rows,
     oldest row, and when she last pressed Checked */
  let _sq=[],_sqVal=0,_sqNew=0,_sqOld=0;
  try{_sq=_adminItems();_sqVal=_sq.reduce((t,x)=>t+(x.value||0),0);
    _sqNew=_sq.filter(x=>!ROW_SEEN[String(x.rid)]&&!x.waiting&&x.kind!=='job').length;
    _sqOld=Math.max(0,..._sq.map(x=>x.days||0));}catch(e){}
  let _chk='never';try{const ck=ADMIN_CHECK&&ADMIN_CHECK.at;if(ck){const dd=Math.floor((Date.now()-new Date(ck).getTime())/864e5);_chk=dd<=0?'today':dd+'d ago';}}catch(e){}
  if(window._jkFreshVisit){
    try{
      const last=parseInt(localStorage.getItem('jk_lastSeen')||'0');
      window._jkSince=last?{
        res:claims.filter(c=>c.cst==='Resolved'&&c.resolvedAt&&new Date(c.resolvedAt).getTime()>=last-864e5).length,
        newIn:items.filter(x=>x.at&&new Date(x.at).getTime()>last).length}:null;
      localStorage.setItem('jk_lastSeen',String(Date.now()));
    }catch(e){window._jkSince=null;}
    window._jkFreshVisit=false;
  }
  const _mrow=(l,v,c,tip,go)=>`<div ${go?`onclick="${go}" onmouseenter="this.style.background='var(--bg3)'" onmouseleave="this.style.background=''"`:''} style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;${go?'cursor:pointer;border-radius:5px;margin:0 -5px;padding:0 5px;':''}" ${tip?`title="${tip}"`:''}>
      <span style="font-size:10.5px;color:var(--text3);font-weight:600;">${l}${go?' &#8599;':''}</span>
      <span class="num" style="font-size:12.5px;font-weight:800;color:${c};white-space:nowrap;">${v}</span></div>`;
  const _mpanel=(t,tc,rows2)=>`<div style="flex:1;min-width:215px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:9px 13px;display:flex;flex-direction:column;gap:5px;">
      <div style="font-size:9.5px;font-weight:800;letter-spacing:.08em;color:${tc};margin-bottom:2px;">${t}</div>${rows2.join('')}</div>`;
  /* Jack, 10 Sep: "looks a mess — you're gonna have to redesign it." Eight
     table columns with a six-button stack in the last one: every row grew to
     the height of the stack, and the middle was empty. Now one card per item,
     three panels — what it is, what has happened, what you do — with the
     answers in two columns so six of them take three lines, not six. */
  const _jkRow=(it,x)=>{
    const late=it.wait>=2&&it.kind!=='fix'&&!it.noNag;
    const _w=(String(it.acts).match(/<div class="jkWhere">[\s\S]*?<\/div>/)||[''])[0];
    const _b=(String(it.acts).match(/<button[\s\S]*?<\/button>/g)||[]);
    const _cl=(it.clog||[]).slice().reverse();const _open=_stOpen.has('jk:'+String(it.id));
    const _line=L=>`<div class="stLog"><span class="stLogWhen">${esc(_logWhen(L.at))}</span>${L.by?` · <b>${esc(L.by)}</b>`:''} — ${esc(L.what||'')}</div>`;
    const _r=(it.kind==='claim'||it.kind==='lav')?null:_rowById(it.id);
    const _story=[
      it.note?`<div class="tfuRaiseNote" title="What was written when it was raised or sent">&ldquo;${esc(it.note)}&rdquo;</div>`:'',
      it.fix?`<div class="tfuRaiseNote" style="color:#93c5fd;border-left-color:#60a5fa;">She suggests: ${esc(it.fix)}</div>`:'',
      it.expDate?(()=>{const aw=Math.round((new Date(it.expDate)-new Date())/864e5);const ds=new Date(it.expDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
        return `<div class="stExp" style="color:${aw<0?'#f87171':'#4ade80'};">&#128197; expected ${ds}${aw<0?` — slipped ${Math.abs(aw)}d ago`:aw===0?' — today':` — in ${aw}d`}</div>`;})():'',
      _cl.length?(_open?_cl.map(_line).join(''):_line(_cl[0]))+(_cl.length>1?`<button class="stMore" data-rid="jk:${esc(String(it.id))}" onclick="stToggle(this,event)">${_open?'&#9652; Less':'&#9662; More · '+(_cl.length-1)+' earlier'}</button>`:''):'',
      it.kind==='claim'?`<div class="stExp" style="color:var(--text2);">${it.raisedDays!=null?`gated/raised ${it.raisedDays}d ago`:''}${it.units?` · ${fmt(it.units)} unit${it.units===1?'':'s'}`:''}${it.perUnit?` · ${fmtGBP2(it.perUnit)}/unit`:''}</div>`:'',
      (it.claimLog&&it.claimLog.length)?it.claimLog.map(L=>`<div class="stLog"><span class="stLogWhen">${esc(String(L.t||'').slice(0,17))}</span> — ${esc(L.msg||'')}</div>`).join(''):'',
      it.na?`<div class="stNext">&#10132; ${esc(it.na)}</div>`:'',
      (_r&&_r.notes)?`<div class="tfuRaiseNote" style="border-left-color:#fbbf24;color:#fde68a;" title="Packing note${_r.notesBy?' — '+esc(_r.notesBy):''}">&#128230; ${esc(_r.notes)}</div>`:'',
      /* Jack, 10 Sep: "where are these va notes here" — the card showed the FIRST
         220 characters of the row's VA Note column, which on the Wella was the
         close-off message Sarah pasted on 8 Sept. The note is a running column;
         only its latest line belongs here, and not when it is the same words as
         the quote above it. */
      (_r&&_r.vaNote)?(()=>{const _ls=String(_r.vaNote).split('\n').map(t=>t.trim()).filter(Boolean);const _last=_ls[_ls.length-1]||'';
        if(!_last||(it.note&&_last.endsWith(String(it.note).trim())))return '';
        return `<div class="tfuRaiseNote" style="border-left-color:#60a5fa;color:#93c5fd;" title="The VA Note column on the Prep Sheet row — latest line${_ls.length>1?' of '+_ls.length:''}">VA note: ${esc(_last.slice(0,220))}${_last.length>220?'…':''}${_ls.length>1?` <span style="color:var(--text3);font-weight:600;">· ${_ls.length-1} earlier on the row</span>`:''}</div>`;})():''
    ].filter(Boolean).join('');
    return `<tr class="jkCardRow${late?' jkLate':''}"><td colspan="8">
      <div class="jkCard" style="border-left-color:${it.type[1]};">
        <div class="jkC1">
          <div class="jkTop">
            <span class="jkNum">${x+1}</span>
            <span class="jkType" style="color:${it.type[1]};background:${it.type[1]}1a;border-color:${it.type[1]}50;" title="${esc(it.type[2])}">${it.type[0]}</span>
            <span class="jkBy"><b>${esc(it.by)}</b> · ${it.wait===0?'today':it.wait+'d ago'}</span>
          </div>
          <div class="jkProd" title="${esc(it.prod||'')}">${esc(it.prod)}</div>
          ${(it.sku||it.asin)?`<div class="jkIds">${it.sku?`<span onclick="copyVal('${esc1(it.sku)}',this)" title="Click to copy">${esc(it.sku)}</span>`:''}${it.asin?`<span class="s-asin" style="font-size:10.5px;" onclick="copyVal('${esc1(it.asin)}',this)" title="Click to copy">${esc(it.asin)}</span>`:''}</div>`:''}
          <div class="jkOrd">${esc(it.sup||'—')}${it.oid?` · <span class="tfuOid" title="Click to copy" onclick="copyVal('${esc1(it.oid)}',this)">${esc(it.oid)}</span>`:''}${it.acct?` <span class="tfuAcct">${esc(it.acct)}</span>`:''}</div>
          ${it.age?`<div class="jkAge">Ordered ${it.odate?esc(it.odate)+' &middot; ':''}${it.age.days} day${it.age.days===1?'':'s'} ago${it.age.late>0?` &middot; <b style="color:#f87171;">${it.age.late} day${it.age.late===1?'':'s'} past the ${it.age.clock}-day late clock</b>`:it.age.late===0?' &middot; <b style="color:#fbbf24;">hits the late clock today</b>':` &middot; ${Math.abs(it.age.late)} day${Math.abs(it.age.late)===1?'':'s'} before it counts as late`}</div>`:''}
          <div class="jkMoney">${it.value?`<span class="tfuVal">${it.owedU?`<span class="jkUnits">${fmt(it.owedU)} unit${it.owedU===1?'':'s'}</span> `:''}${fmtGBP2(it.value)}</span>`:'<span style="color:var(--text3);font-size:12px;">no money at stake</span>'}
            ${(it.left!==null&&it.left>=0&&it.left<=7)?`<span class="tfuClock" style="color:#ef4444;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.5);" title="The Amazon claim window on this order — it closes ${it.left===0?'today':'in '+it.left+' day'+(it.left===1?'':'s')}">${_claimWords(it.left)}</span>`:(it.left!==null&&it.left>=0)?`<span class="tfuClock" style="color:#94a3b8;background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.35);" title="The Amazon claim window on this order — it closes in ${it.left} days">${_claimWords(it.left)}</span>`:(it.left!==null&&it.left<0)?`<span class="tfuClock" style="color:#f87171;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.4);">claim window shut</span>`:''}</div>
          ${late?`<div class="jkNag">Waiting on you for ${it.wait} days</div>`:''}
        </div>
        <div class="jkC2">
          <div class="jkWhy">${it.why}</div>
          <div class="jkWhySub">${esc(it.type[2])}</div>
          ${_story||`<div style="font-size:10.5px;color:var(--text3);font-weight:600;">Nothing written yet</div>`}
          <button class="stMore" style="margin-top:8px;" onclick="jkStory('${it.kind}','${esc1(String(it.id))}')" title="Everything on this one — order, units, notes, every step, who and when">&#9656; Full story</button>
        </div>
        <div class="jkC3">
          ${_w}
          <div class="csActs">${_b.join('')}</div>
        </div>
      </div>
    </td></tr>`;};
  /* Jack, 5 Sep: "a grey done line for the rest of the day" + the 48-hour undo
     Sarah has. Approvals he made in the last 48 working hours can be pulled
     back; answers he gave today are listed so he can see what he dealt with. */
  const _doneHtml=(()=>{
    const ap=rows.filter(r=>r.resolution&&r.resolution.state==='approved'&&/^jack/i.test(String(r.resolution.approvedBy||''))&&!r.resolution.filed&&r.resolution.approvedAt&&_workMsSince(r.resolution.approvedAt)<TM.undoHours*3600e3&&!['in-transit','query-missing','query-cancelled','query-refunded'].includes(r.resolution.what));
    const T=new Date().toISOString().slice(0,10);
    const an=rows.filter(r=>r.resolution&&r.resolution.state==='rejected'&&/^jack/i.test(String(r.resolution.rejectedBy||''))&&String(r.resolution.at||'').slice(0,10)===T);
    if(!ap.length&&!an.length)return '';
    const line=(r,what,btn)=>`<div class="jkDoneRow"><span class="jkDoneP">${esc(r.prod||r.sku||'')}</span><span class="jkDoneW">${what}</span>${btn||''}</div>`;
    return `<details class="jkDone" open><summary><span class="jkInfoT">Done</span><span class="jkInfoN">${fmt(ap.length+an.length)}</span><span class="ovDim2">what you dealt with — approvals stay undoable for 48 working hours</span></summary>
      ${ap.map(r=>line(r,`approved — ${esc(_resText(r.resolution.what))} · ${esc(_logWhen(r.resolution.approvedAt))}`,`<button class="csAct plain" onclick="reopenResolution('${r.uuid||r.id}',true)" title="Bring it back — everything it knew is still on it">Undo</button>`)).join('')}
      ${an.map(r=>line(r,`answered — ${esc((r.resolution.rejectNote||'').slice(0,90))} · ${esc(_logWhen(r.resolution.at))}`,'')).join('')}
    </details>`;})();
  const kpi=(v,l,cls,kind)=>`<div class="jkKpi ${cls||''}" style="flex:1;${kind?'cursor:pointer;':''}" ${kind?`onclick="_jkKind=_jkKind==='${kind}'?'all':'${kind}';renderJack();" title="Click to show only these"`:''}><b>${v}</b><span>${l}</span></div>`;
  w.innerHTML=`
    <div class="jkHero" style="padding:12px 16px 14px;margin-bottom:10px;flex-direction:column;align-items:stretch;gap:10px;">
      <div style="display:flex;align-items:baseline;gap:12px;">
        <h2 style="margin:0;">Jack's Admin</h2>
        <p style="margin:0;">${needsAll.length?`${needsAll.length} thing${needsAll.length===1?'':'s'} need your answer — oldest first, work top to bottom.`:'Nothing needs your answer. Nobody is blocked on you.'}</p>
        ${window._jkSince&&(window._jkSince.res||window._jkSince.newIn)?`<span style="font-size:11px;font-weight:700;color:#93c5fd;white-space:nowrap;">Since you last looked: <b style="color:#4ade80;">${fmt(window._jkSince.res)}</b> resolved · <b>${fmt(window._jkSince.newIn)}</b> new</span>`:''}
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:var(--text2);white-space:nowrap;" title="The last 7 days at a glance">This week: <b style="color:#4ade80;">${fmt(_res7.length)}</b> resolved · <b style="color:#4ade80;">${fmtGBP2(_rec7)}</b> recovered · <b style="color:#93c5fd;">${fmt(_new7)}</b> new</span>
      </div>
      <div class="jkKpis" style="width:100%;display:flex;gap:9px;">
        ${kpi(fmt(needsAll.length),'need your answer',needsAll.length?(oldest>=2?'bad':'hot'):'ok')}
        ${kpi(oldest?oldest+'d':'—','oldest waiting',oldest>=2?'bad':oldest?'warn':'ok')}
        ${kpi(fmt(fromSarah),'blocking Sarah',fromSarah?'hot':'ok')}
        ${kpi(fmtGBP2(atRisk),'£ at risk','warn')}
        ${kpi(refundsN?fmt(refundsN):'0','refunds to raise'+(refundsN?' · '+fmtGBP2(refundsVal):''),(refundsN?'owed':'ok')+(_jkKind==='refund'?' on':''),'refund')}
        ${kpi(fmt(decN),'decisions',(decN?'hot':'ok')+(_jkKind==='dec'?' on':''),'dec')}
      </div>
      <details class="jkMore"><summary>Sarah’s page &amp; the pipeline — <b>${fmt(_sq.length)}</b> on her queue · <b style="color:${_ps.quiet?'#ef4444':'#4ade80'}">${fmt(_ps.quiet)}</b> gone quiet · <b>${fmt(_ps.parked)}</b> parked · <b style="color:#c084fc">${fmt(_gated)}</b> gated <span class="jkMoreHint">open ▾</span></summary>
      <div style="display:flex;gap:9px;flex-wrap:wrap;align-items:stretch;padding-top:8px;">
        ${_mpanel('THE PIPELINE','var(--text3)',[
          _mrow('Being chased by Sarah',fmt(_ps.chasing),'#60a5fa','Open her page at the chase rows',"goPage('admin',null)"),
          _mrow('Gone quiet — chase overdue',_ps.quiet?fmt(_ps.quiet)+(_ps.quietOld?' · '+_ps.quietOld+'d':''):'0',_ps.quiet?'#ef4444':'#4ade80','Chases past their 2-working-day due — your tell-Sarah number. Click Nudge below to flag them all.',"goPage('admin',null)"),
          _mrow('Refunds to raise',fmt((owed||[]).length),'#34d399'),
          _mrow('Replacements promised',fmt(_ps.replacement),'#c084fc'),
          _mrow('Parked on a date',fmt(_ps.parked),'#93c5fd')]
          .concat(_ps.quiet?[`<button class="csAct warn" style="margin-top:4px;" onclick="jackNudgeQuiet()" title="Writes 'Jack flagged this — chase it today' into every overdue chase's log — it shows on her rows immediately">&#9889; Nudge Sarah — flag all ${fmt(_ps.quiet)}</button>`]:[]))}
        ${_mpanel("SARAH'S PAGE",'var(--text3)',[
          _mrow('Open on her queue',fmt(_sq.length),_sq.length>25?'#fbbf24':'#93c5fd','Open her page',"goPage('admin',null)"),
          _mrow('Tied up',fmtGBP2(_sqVal),'#fbbf24'),
          _mrow('Never opened by her',fmt(_sqNew),_sqNew>8?'#ef4444':_sqNew?'#fbbf24':'#4ade80','Rows with no open, no triage, no action — probably not seen. Click to open her page.',"goPage('admin',null)"),
          _mrow('Oldest row',_sqOld?_sqOld+'d':'—',_sqOld>30?'#ef4444':'#93c5fd'),
          ])}
        ${_mpanel('LAST 30 DAYS','var(--text3)',[
          _mrow('Issues raised',fmt(_raised30),'#93c5fd'),
          _mrow('Resolved',fmt(_res30.length),'#4ade80'),
          _mrow('Recovered — processed',fmtGBP2(_rec30),'#4ade80'),
          _mrow('Stuck over 30d (not gated)',fmt(_stuck30),_stuck30?'#ef4444':'#4ade80')])}
        ${_mpanel('GATED STOCK','#c084fc',[
          _mrow('ASINs',fmt(_gAsins),'#c084fc','See the gated rows on her page',"goPage('admin',null);setTimeout(()=>{_admKind='GATED';renderAdmin();},60)"),
          _mrow('Units',fmt(_gUnits),'#c084fc'),
          _mrow('Tied up',fmtGBP2(_gVal),'#c084fc'),
          _mrow('Its own clock','sits longer by nature','var(--text3)','Gated can stay unresolved far longer than normal admin — watched here, never counted as stuck')])}
      </div></details>
    </div>
    ${items.length?`
    <div class="admBar" style="padding:0 2px 10px;">
      <div class="admSearch">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="4"/><line x1="10" y1="10" x2="13" y2="13"/></svg>
        <input id="jkSrch" value="${esc(_jkQ||'')}" placeholder="Search product, supplier, order, SKU or note"
          oninput="_jkQ=this.value;renderJack();setTimeout(()=>{const b=document.getElementById('jkSrch');if(b){b.focus();b.setSelectionRange(b.value.length,b.value.length);}},0);" autocomplete="off">
      </div>
      ${(()=>{const _selCss='padding:8px 11px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:11.5px;font-weight:700;cursor:pointer;';
        const sups=[...new Set(items.map(x=>String(x.sup||'')).filter(Boolean))].sort();
        const accts=[...new Set(items.map(x=>String(x.acct||'')).filter(Boolean))].sort();
        return (sups.length>1?`<select onchange="_jkSup=this.value;renderJack();" title="Only this supplier" style="${_selCss}">
            <option value="all">All suppliers</option>
            ${sups.map(s=>`<option value="${esc(s)}" ${_jkSup===s?'selected':''}>${esc(s)} (${items.filter(x=>String(x.sup||'')===s).length})</option>`).join('')}</select>`:'')
          +(accts.length>1?`<select onchange="_jkAcct=this.value;renderJack();" title="Only this account" style="${_selCss}">
            <option value="all">All accounts</option>
            ${accts.map(s=>`<option value="${esc(s)}" ${_jkAcct===s?'selected':''}>${esc(s)} (${items.filter(x=>String(x.acct||'')===s).length})</option>`).join('')}</select>`:'');})()}
      <select onchange="_jkSort=this.value;renderJack();" title="How the table is ordered"
        style="padding:8px 11px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:11.5px;font-weight:700;cursor:pointer;">
        ${[['priority','Sort: type — checks first, oldest within'],
           ['oldest','Sort: waiting longest first'],
           ['newest','Sort: newest first'],
           ['money','Sort: biggest money first'],
           ['claim','Sort: closest to the claim deadline'],
           ['supplier','Sort: supplier A–Z']]
          .map(([k,l])=>`<option value="${k}" ${_jkSort===k?'selected':''}>${l}</option>`).join('')}
      </select>
      <div class="admChips">
        ${[['all','All'],['check','Checks'],['dec','Decisions'],['refund','Refunds to raise'],['claim','Claims'],['lav','Shortages'],['fix','Qty fixes']]
          .filter(([k])=>k==='all'||_jkCounts[k])
          .map(([k,l])=>`<button class="admChip${_jkKind===k?' on':''}" onclick="_jkKind='${k}';renderJack();">${l} <b>${_jkCounts[k]||0}</b></button>`).join('')}
      </div>
    </div>
    <div class="admKey" style="padding:0 4px 8px;">
      <span class="admKeyT">The stripe</span>
      ${[['#60a5fa','Check an Amazon order'],['#c084fc','A decision or gated call'],['#34d399','A refund only you can raise'],['#fbbf24','A claim sent to you'],['#38bdf8','Short or damaged at check-in'],['#94a3b8','Qty fix — read and wave through']]
        .map(([c,t])=>`<span class="admKeyI"><span class="admKeyD" style="background:${c};"></span>${t}</span>`).join('')}
    </div>
    ${/* Jack, 4 Sep: "my sheet only goes to 4 — scrolling issue on Jack's admin
         page." `.tfuScroll` caps itself at calc(100vh - 250px), a guess made
         when this page was just a table. It now carries the KPI row, four stat
         panels, a search bar and the stripe legend above it — well over 250px —
         so the box ran off the bottom of the window while its own scrollbar
         thought it had already reached the end, and the last rows were
         unreachable. Two nested scrollers, neither able to finish the job.
         Here the outer #jackWrap does the scrolling and the table lays out in
         full; the sticky header still sticks, just to the outer one. */''}
    <div class="tfuScroll" style="margin:0;max-height:none;overflow:visible;">
    <table class="tfu">
      <tbody class="jkCards">
      ${needs.map(_jkRow).join('')}
      </tbody>
    </table>
    </div>
    ${!needs.length&&shown.length?`<div style="text-align:center;padding:18px;color:var(--text2);font-weight:700;font-size:12.5px;">Nothing needs your answer — the rest is information.</div>`:''}
    ${info.length?`<details class="jkInfo" ${_jkKind==='fix'?'open':''}><summary><span class="jkInfoT">For your information</span><span class="jkInfoN">${fmt(info.length)}</span><span class="ovDim2">quantity fixes Sarah made on the sheet — read and wave through · they clear themselves after a week</span></summary>
      <div class="tfuScroll" style="margin:0;max-height:none;overflow:visible;"><table class="tfu"><tbody>${info.map(_jkRow).join('')}</tbody></table></div></details>`:''}
    ${_doneHtml}
    ${!shown.length?`<div style="text-align:center;padding:26px;color:var(--text3);font-weight:700;font-size:12.5px;">Nothing matches — clear the search or press All.</div>`:''}`
    :`<div class="jkEmpty"><b>All clear</b><span>When Sarah sends something over it lands here.</span></div>`}
    `;/* Issues page killed — Jack, 30 Aug: "issues are split into Sarah Admin + Jack Admin. Remove it." */
  paintJackBadge();
  if(_st)w.scrollTop=_st;
}
/* Jack, 7 Sep: "buggy — typed date and then it went off this page." A live
   event from another laptop (or his own echo) rebuilt the page under his
   hands and threw away the half-typed date. Automatic repaints wait while a
   date pad or an answer box is open, or a field on the page has focus; the
   debt is paid the moment the box closes. His own button presses still
   repaint at once through renderJack(). */
/* which cards have their extra answers showing — survives every repaint */
const _jkOpen=new Set();
function jkMoreTog(btn,id){
  const p=btn&&btn.parentElement;if(!p)return;
  const open=p.classList.toggle('open');
  if(open)_jkOpen.add(String(id));else _jkOpen.delete(String(id));
  btn.innerHTML=open?'less &#9652;':'more &#9662;';
}
function _jkBusy(){
  const ae=document.activeElement;
  const typing=!!(ae&&ae.closest&&ae.closest('#page-jack')&&['INPUT','SELECT','TEXTAREA'].includes(ae.tagName));
  return typing||!!document.querySelector('#jackWrap .amzDateBox,#jackWrap [data-jk-edit]');
}
function renderJackAuto(){
  if(_pageActive('page-jack')&&!document.hidden&&_jkBusy()){
    _dirtyR.jack=true;
    const ae=document.activeElement;
    if(ae&&ae.closest&&ae.closest('#page-jack'))ae.addEventListener('blur',()=>{setTimeout(()=>{if(_dirtyR.jack&&!_jkBusy())renderJack();},150);},{once:true});
    return;
  }
  renderJack();
}
/* Answering is a real reply, not a status flip — he types what he found and it
   goes back to her with the answer attached. */
function jackAnswerAsk(rid){
  const r=_rowById(rid);if(!r)return;
  _askRid=rid;
  const q=r.resolution||{};
  let el=document.getElementById('askModal');
  if(!el){
    el=document.createElement('div');el.id='askModal';el.className='overlay';
    el.style.zIndex='140';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)askShut();});
  }
  el.innerHTML=`<div class="modal srtCfm">
    <div class="srtCfmTtl">What did you find?</div>
    <div class="srtCfmSub">${esc(r.prod||r.sku||'')} · ${esc(r.oid||'no order id')}</div>
    <div class="srtCfmOpen"><b>${esc(q.by||'someone')} asked</b>
      <ul><li>${esc(q.ask||'Check this order')}</li></ul>
      ${q.note?`<span>${esc(q.note)}</span>`:''}</div>
    <div class="srtCfmLab">Still coming? Answer with the date — it parks the order and comes back by itself if it slips</div>
    <div style="display:flex;gap:8px;align-items:center;margin:2px 0 12px;">
      <input type="date" id="askDate" min="2024-01-01" max="2030-12-31" style="flex:0 0 150px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:12.5px;">
      <button class="csAct go" style="margin:0;" onclick="askStillComing()">Record the date</button>
    </div>
    <div class="srtCfmLab">Or answer in words</div>
    <textarea id="askNote" class="srtNote" rows="3" oninput="jackAnsCheck()"
      placeholder="e.g. Amazon shows it delivered on 12 July, signed for — book it in"></textarea>
    <div class="srtCfmKeep"><b>What happens</b><ul>
      <li>It goes straight back to ${esc(q.by||'someone')} with your answer on the row</li>
      <li>She can act on it and close it off herself</li>
      <li>The audit record is kept — no history is ever deleted</li></ul></div>
    <div class="srtCfmFoot">
      <button class="srtGhost" onclick="askShut()">Cancel</button>
      <button class="srtGo" id="jkAnsGo" onclick="jackAnsSend()">Send the answer back</button>
    </div></div>`;
  el.style.display='flex';
  jackAnsCheck();
  setTimeout(()=>{const t=document.getElementById('askNote');if(t)t.focus();},50);
}
function askStillComing(){
  const v=(document.getElementById('askDate')||{}).value;
  if(!v||!saneDate(v)){toast('Pick the date first','er');return;}
  const rid=_askRid;askShut();jackStillComing(rid,v);
}
function jackAnsCheck(){
  const t=document.getElementById('askNote'),b=document.getElementById('jkAnsGo');
  if(!t||!b)return;
  const ok=t.value.trim().length>2;
  b.disabled=!ok;b.style.opacity=ok?'1':'.45';b.style.cursor=ok?'pointer':'not-allowed';
}
function jackAnsSend(){
  const t=document.getElementById('askNote');
  if(!t||t.value.trim().length<3)return;
  const rid=_askRid,ans=t.value.trim();
  askShut();
  jackAnswered(rid,ans,{fromNote:true});
}

// ── ASK JACK TO CHECK ─────────────────────────────────────────────────────────
/* Jack, 08 Aug: "if supplier is Amazon, Sarah often CAN'T properly check the
   order details herself." So the triage stops pretending every supplier is the
   same. Amazon rows get a hand-over button; everything else stays hers to
   investigate, because she genuinely can — emails, order history, tracking,
   contacting the supplier.
   This is NOT a proposed closure. She is not saying what happened, she is
   asking him to find out — so it gets its own state ('asked') and never lands
   in the approve/reject queue. It rides in `resolution`, which already
   round-trips to the database, so there is no migration to run. */
let _askRid=null;
/* Jack, 9 Sep: "don't need the required if the tick says what she needs from
   me — add other where she can freehand write the note, get rid of 3." The
   tick IS the message on the three named reasons; the note is only compulsory
   when she picks Something else, because then it is the only thing he gets. */
const ASK_REASONS=[
  'Check whether this order actually arrived',
  'Check whether it was cancelled or refunded',
  'Gated — this one is your decision',
  'Something else — I’ll explain below'
];
const ASK_FREE='Something else — I’ll explain below';
function askShut(){const el=document.getElementById('askModal');if(el)el.style.display='none';_askRid=null;}
function askJackAsk(rid,pick){
  const r=_rowById(rid);if(!r){toast('Row not found','er');return;}
  _askRid=rid;
  let el=document.getElementById('askModal');
  if(!el){
    el=document.createElement('div');el.id='askModal';el.className='overlay';
    el.style.zIndex='140';document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el)askShut();});
  }
  el.innerHTML=`<div class="modal srtCfm">
    <div class="srtCfmTtl">Send this to Jack</div>
    <div class="srtCfmSub">${esc(r.prod||r.sku||'')} · ${esc(r.oid||'no order id')}${r.sup?' · '+esc(r.sup):''}${r.acct?' · '+esc(r.acct):''}</div>
    ${!_amazonRow(r)?`<div class="srtNeed" style="margin:0 0 10px;"><b>Not an Amazon order.</b> A refund from ${esc(r.sup||'this supplier')} is yours to see through: if they have promised it, wait 48 hours, check the emails, then close it as <b>Refund being processed — done</b> or chase again. Only send it to Jack if you need something only he can do.</div>`:''}
    <div class="srtCfmLab">What is it about?</div>
    <div class="askOpts">${ASK_REASONS.map((o,n)=>`<label class="srtChk">
      <input type="radio" name="askWhy" value="${esc(o)}" ${n===0?'checked':''} onchange="askNoteCheck()"><span>${esc(o)}</span></label>`).join('')}</div>
    <div class="srtCfmLab">Anything to add? <span id="askReq" style="color:#f87171;display:none;">required</span><span id="askOpt" style="color:var(--text3);font-weight:600;">optional</span></div>
    <textarea id="askNote" class="srtNote" rows="3" oninput="askNoteCheck()"
      placeholder="e.g. Argos say the refund went to a gift card on 06/09 — can you check it landed on the account?"></textarea>
    <div class="srtHint" id="askNoteHint">The option you ticked already tells Jack what you need. Add a line only if there is something he would not work out himself.</div>
    <div class="srtCfmKeep"><b>What happens</b><ul>
      <li>This row moves to Jack — it shows as waiting on him and you can’t close it until he answers</li>
      <li>It lands on his Admin page as a job with your name on it</li>
      <li>He answers it, or sends it straight back to you with a note</li>
      <li>Nothing is closed and nothing is deleted</li></ul></div>
    <div class="srtCfmFoot">
      <button class="srtGhost" onclick="askShut()">Cancel</button>
      <button class="srtGo" id="askGo" onclick="askSend()">Send to Jack</button>
    </div></div>`;
  el.style.display='flex';
  if(pick==='free'){const fr=[...el.querySelectorAll('input[name="askWhy"]')].find(x=>x.value===ASK_FREE);if(fr)fr.checked=true;}
  askNoteCheck();
  setTimeout(()=>{const t=document.getElementById('askNote');if(t)t.focus();},60);
}
/* Jack, 8 Sep: "if she is sending it to me — a reason why; this should say
   what I need to do." The line is required, and it is the headline on his row. */
function askNoteCheck(){
  const t=document.getElementById('askNote'),go=document.getElementById('askGo'),h=document.getElementById('askNoteHint');
  if(!t||!go)return;
  const picked=document.querySelector('#askModal input[name="askWhy"]:checked');
  const free=picked&&picked.value===ASK_FREE;
  const req=document.getElementById('askReq'),opt=document.getElementById('askOpt');
  if(req)req.style.display=free?'':'none';
  if(opt)opt.style.display=free?'none':'';
  const ok=free?t.value.trim().length>=3:true;
  go.disabled=!ok;go.style.opacity=ok?'1':'.45';go.style.cursor=ok?'pointer':'not-allowed';
  if(h)h.textContent=free?'Say what you need Jack to do — a sentence is enough.'
    :'The option you ticked already tells Jack what you need. Add a line only if there is something he would not work out himself.';
}
async function askSend(){
  const rid=_askRid,r=_rowById(rid);if(!r)return;
  const picked=document.querySelector('#askModal input[name="askWhy"]:checked');
  let why=picked?picked.value:ASK_REASONS[0];
  const note=((document.getElementById('askNote')||{}).value||'').trim();
  /* she picked Something else — her own sentence is the headline on his card */
  if(why===ASK_FREE)why=note.split('\n')[0].slice(0,120)||'Something else — see the note';
  /* Jack, 16 Aug: "It shouldn't be SARAH → SEND TO JACK → DISAPPEARS… it's the
     same underlying issue moving between us." This used to REPLACE the whole
     resolution, so a row with a live case lost every line of its chase the
     moment she handed it over — and came back to her blank. The case rides
     along untouched and picks up exactly where it left off. */
  const _riding=_caseOf(r);
  if(_riding)_riding.log=(_riding.log||[]).concat([{at:new Date().toISOString(),by:_who(),
    what:'Sent to Jack — '+why}]);
  r.resolution={state:'asked',kind:'check',what:'jack-check',ask:why,note,
    chase:_riding||undefined,query:(r.resolution&&r.resolution.query)||undefined,
    by:_who(),at:new Date().toISOString()};
  /* Jack, 8 Sep: this line used to land in PACKING NOTES — Becki's column —
     which is where the twelve order references and "refund issued in gift
     card" came from. It is Sarah's finding, so it is a VA note. */
  if(note){
    const d=new Date(),dd=_ddUK(d);
    r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd} → Jack: ${note}`;
    r.vaNoteBy=_who();r.vaNoteAt=new Date().toISOString();
  }
  r._dirty=true;
  askShut();
  renderAdmin();                 // it leaves her queue immediately
  try{
    await saveRow(r);
    toast('✓ Sent to Jack — the row is grey at the bottom of your list until he answers');
    logAudit('Asked Jack to check',`${r.sku||r.asin||''} — ${why}`);
    fireWebhook(`${_who()} needs you to check "${r.prod||r.sku||''}" — ${why}${note?'. '+note:''}`,
      {event:'asked_jack',sku:r.sku||'',asin:r.asin||'',by:_who()});
  }catch(e){toast('Didn\'t save — check the connection','er');}
  try{renderDashboard();}catch(e){}
}
/* Jack answering. Either he records what he found and it goes back to her with
   the answer attached, or he hands it straight back untouched. */
/* Jack, 30 Aug: "if it's not arrived it might still be arriving — don't jump
   too quickly to refund." NO forks on the row: the account often shows a new
   delivery date, and that date parks the order (off both lists, date on the
   Prep Sheet, straight back the moment it slips). Only "nothing coming" starts
   the chase-or-claim road. */
/* Jack, 30 Aug: "let her click OK before it clears so it doesn't go mid-work."
   Filing is HER action; the 48-working-hour clock is only the tidy-up backstop.
   Nothing is deleted — the row, its case and its history all stay. */
async function fileAway(rid){
  const r=_rowById(rid);if(!r)return;
  if(r.resolution&&r.resolution.state==='approved')r.resolution.filed=true;
  else{const c=_caseOf(r);if(c)c.filed=true;}
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit('Filed away',`${r.sku||r.asin||''} — cleared from Recently actioned by ${_who()}`);
  toast('Filed away — nothing deleted, History keeps the lot','ok');
  renderAdmin();
}
/* Jack's yes, 30 Aug: the chase email writes itself — order, what's missing,
   last contact, what we want. One copy, one paste. */
function copyChaseMsg(rid,btn){
  const r=_rowById(rid);if(!r)return;
  const c=_caseOf(r);
  const units=r.exp||r.ship||0,got=parseInt(r.rcvd)||0;
  const short=got>0?`${units-got} of ${units} units are missing (we received ${got})`:`nothing has arrived — ${units} unit${units===1?'':'s'} ordered`;
  const lastChase=c?(c.log||[]).slice().reverse().find(x=>/chas|contact/i.test(x.what||'')):null;
  const msg='Hello,\n\n'
    +`We are chasing order ${r.oid||'(no order id)'} placed on ${r.date||'—'} — ${r.prod||r.sku||''}. `
    +short.charAt(0).toUpperCase()+short.slice(1)+'.'
    +(lastChase?`\nWe last contacted you on ${_logWhen(lastChase.at)} and have not heard back.`:'')
    +'\n\nPlease confirm the delivery status and an expected date, or issue a refund for the outstanding units.'
    +'\n\nThank you.';
  copyVal(msg,btn);
}
/* Jack's yes, 30 Aug: one press flags every overdue chase in its own case
   log — the tell-Sarah moment, on the record where she works. */
async function jackNudgeQuiet(){
  const hit=[];
  rows.forEach(r=>{
    if(r.archived)return;
    const c=_caseOf(r);if(!c||c.path!=='never-arrived')return;
    if(!['contact','waiting','check-refund'].includes(c.step))return;
    const od=_caseDue(c);if(od===null||od<=0)return;
    if((c.log||[]).slice(-1)[0]&&/Flagged from Jack/.test((c.log||[]).slice(-1)[0].what||''))return; /* no double-flag spam */
    c.log=(c.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:'\u26a1 Flagged from Jack\u2019s page — chase it today'}]);
    r._dirty=true;hit.push(r);
  });
  if(!hit.length){toast('Nothing is overdue a chase right now','ok');return;}
  for(const r of hit){try{await _mustSave(r);}catch(e){}}
  logAudit('Nudged Sarah',hit.length+' overdue chase'+(hit.length===1?'':'s')+' flagged');
  toast('&#9889; Flagged '+hit.length+' — it is on her rows now','ok');
  renderJack();try{renderAdmin();}catch(e){}
}
async function unparkDate(rid){
  const r=_rowById(rid);if(!r)return;
  const c=_caseOf(r);if(!c)return;
  r.expectedDelivery='';
  c.step=c.prevStep||'check-refund';c.due='';c.parkedAt='';
  c.log=(c.log||[]).concat([{at:new Date().toISOString(),by:_who(),what:'Date cleared — brought back to work'}]);
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit('Date cleared',`${r.sku||r.asin||''} — un-parked`);
  toast('Back on the list — the date is cleared','ok');
  renderAdmin();try{renderPrep();}catch(e){}
}
function jackNoSplit(rid,btn){
  const td=btn&&btn.closest('td');if(!td)return;
  /* Jack, 7 Sep: the three buttons sat on one line off the right edge of the
     cell — only the date box showed. Stack it, centre it, Enter saves. */
  td.innerHTML=`<div class="jkAnsBox" data-jk-edit="1">
    <div class="jkAnsT">Not arrived — is it still coming?</div>
    <input type="date" id="jkD_${rid}" min="2024-01-01" max="2030-12-31" class="jkAnsDate" onkeydown="if(event.key==='Enter'){event.preventDefault();jackStillComing('${rid}');}">
    <button class="csAct go" onclick="jackStillComing('${rid}')" title="The account shows a delivery date — it comes off your list and Sarah's until then, the date shows on the Prep Sheet">Still coming — save the date</button>
    ${_amazonRow(_rowById(rid))
      ?`<button class="csAct warn" onclick="amzClaimMine('${rid}')" title="Amazon say it was never delivered — it stays with you for the refund. Sarah sees the status, nothing lands on her list.">Not arrived &mdash; I&rsquo;ll claim it with Amazon</button>`
      :`<button class="csAct warn" onclick="jackAnswered('${rid}','NOT arrived — cancelled or nothing coming. Chase or claim.')" title="Cancelled, or no delivery showing — it goes back to Sarah with your answer and she closes it off">Cancelled / nothing coming — chase or claim</button>`}
    <button class="csAct plain" onclick="renderJack()">Back</button></div>`;
  setTimeout(()=>{const el=document.getElementById('jkD_'+rid);if(el)el.focus();},30);
}
/* Jack, 9 Sep: "can we have an option to say the rest is cancelled or not
   coming if missing some?" The Tefal row: 5 on the sheet, 3 in, and the truth
   was that only 3 were ever ordered. His only buttons were Arrived YES (which
   sent Sarah down the wrong-SKU road and on to Becki) or a typed note (which
   Sarah could not act on with one press). This is the structured answer:
   which of the two it is, and it hands Sarah a single close-it button. */
/* Jack, 9 Sep: "minimum clicks, very obvious actions, no unnecessary
   dropdowns." The card used to ask about the ORDER — "Arrived — YES" on a row
   where 6 of 8 had turned up, which he read (fairly) as "yes, some arrived".
   It asks about the units that have NOT turned up instead, every button says
   how many, and every common answer is one press: the sub-questions that used
   to live behind "Rest isn't coming" are buttons of their own. */
/* Jack, 10 Sep: "give me how many days the issue has been going on for —
   e.g. 2 days into the late period." Days since the order date, and how far
   past the late clock it is. */
/* Jack, 10 Sep: "0d to claim made me think it had gone to 0 to claim." The
   number alone read as "nothing to claim". Words, the same words everywhere:
   the clock is Amazon's claim window on the order and it never removes a row. */
function _claimWords(left){
  if(left===null||left===undefined||isNaN(left))return '';
  if(left<0)return 'claim window shut';
  if(left===0)return 'last day to claim';
  if(left===1)return '1 day left to claim';
  return left+' days left to claim';
}
function _ordAge(r){
  try{
    const today=new Date();let d=null;
    if(r&&r.date){const[dd,mm]=String(r.date).split('/');if(dd&&mm){d=new Date(`${today.getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);if(!isNaN(d)&&d>today)d.setFullYear(d.getFullYear()-1);}}
    if(!d||isNaN(d))return null;
    const days=Math.floor((today-d)/864e5);
    const after=(r.subSave==='Yes')?TM.ssLateDays:TM.lateDays;
    return{days,late:days-after,clock:after};
  }catch(e){return null;}
}
function _jkCheckActs(r,_id){
  const exp=parseInt(r.exp)||0,got=parseInt(r.rcvd)||0;
  const owe=_owedUnits(r)||Math.max(0,exp-got);
  const amz=(typeof _amazonRow==='function')&&_amazonRow(r);
  const who=amz?'Amazon':'the supplier';
  const B=[];
  B.push(`<div class="jkWhere"><b class="jkQ">${got>0?`${fmt(got)} of ${fmt(exp)} booked in &mdash; what happened to the other ${fmt(owe)}?`:`Nothing booked in &mdash; what happened to all ${fmt(exp)}?`}</b><span class="jkQsub">None of these close the row &mdash; your answer goes back to Sarah.</span></div>`);
  B.push(`<button class="csAct good" onclick="jackAnswered('${_id}','Arrived — YES, the account shows it delivered.')" title="The account shows the full order delivered, so the missing ${fmt(owe)} are somewhere. Sarah checks the wrong SKU next, then Becki the shelves.">All ${fmt(exp)} were delivered</button>`);
  if(got>0){
    B.push(`<button class="csAct warn" onclick="jackRestGoneSend('${_id}','cancelled')" title="${who} cancelled or refunded them — the money is back by itself. Sarah gets one button: note the sheet and close it.">The other ${fmt(owe)} ${owe===1?'was':'were'} cancelled or refunded</button>`);
    B.push(`<button class="csAct plain" style="border-color:rgba(251,191,36,.5);color:#fcd34d;" onclick="openQtyFixAnswered('${_id}')" title="The Purchase Sheet says ${fmt(exp)} but only ${fmt(got)} were actually ordered — a sheet correction, not a cancellation. The popup opens filled in with ${fmt(got)}; Enter saves it and Sarah gets the Purchase Sheet job.">Only ${fmt(got)} ${got===1?'was':'were'} ordered &mdash; the sheet is wrong</button>`);
  }else{
    B.push(`<button class="csAct warn" onclick="jackRestGoneSend('${_id}','cancelled')" title="${who} cancelled or refunded the order — the money is back by itself. Sarah gets one button: note the sheet and close it.">The order was cancelled or refunded</button>`);
    B.push(amz
      ?`<button class="csAct plain" style="border-color:rgba(248,113,113,.5);color:#fca5a5;" onclick="amzClaimMine('${_id}')" title="Amazon say it was never delivered — it stays with you for the refund. Sarah sees the status, nothing lands on her list.">Never arrived &mdash; I&rsquo;ll claim it with Amazon</button>`
      :`<button class="csAct plain" style="border-color:rgba(248,113,113,.5);color:#fca5a5;" onclick="jackAnswered('${_id}','NOT arrived — cancelled or nothing coming. Chase or claim.')" title="Nothing is coming — it goes back to Sarah with your answer and she closes it off">Never arrived &mdash; nothing is coming</button>`);
  }
  B.push(`<button class="csAct go" onclick="jackAmzDate('${_id}',this)" title="${who} gave a date — the row parks on the Prep Sheet with the date on it, off your list and Sarah's, and comes straight back if the date slips.">${got>0?`The other ${fmt(owe)} ${owe===1?'is':'are'} still coming`:'Still coming'}&hellip;</button>`);
  /* Jack, 10 Sep, on the BioEars: "there's been a mistake with the original
     order quantity — we only ordered 9, not 10. None of the buttons relate to
     this. We need to distinguish a PHYSICAL stock discrepancy from a SYSTEM
     quantity error." The correction already existed and does the whole job —
     it was reachable from one button buried inside the row's own popup. */
  B.push(`<button class="csAct plain" style="border-color:rgba(96,165,250,.5);color:#93c5fd;" onclick="openQtyFix('${_id}')" title="Nothing is missing — the Purchase Sheet quantity itself is wrong. Correct it here and the shortfall, the red flag and any claim raised off the back of it recalculate from the real number.">The sheet quantity is wrong&hellip;</button>`);
  /* Jack, 10 Sep, on the Wella: "can we just remove it from everyone's sheets
     as we are taking the loss on this now anyway". Nothing on this card said
     that — the only write-off sat behind Becki's Not-here → Sorted with Amazon. */
  if(owe>0)B.push(`<button class="csAct plain" style="border-color:rgba(248,113,113,.55);color:#fca5a5;" onclick="jackWriteOff('${_id}')" title="Nothing more is coming and nothing will be claimed — the ${fmt(owe)} ${owe===1?'unit is':'units are'} taken as a loss. The row closes for you, Sarah and Becki, and the loss stays on the row's story and in the Audit Log.">Write ${got>0?'the other '+fmt(owe):'all '+fmt(owe)} off &mdash; taking the loss</button>`);
  B.push(`<button class="csAct plain" onclick="jackAnswerAsk('${_id}')">Answer with a note</button>`);
  return B.join('\n        ');
}
/* Taking the loss. Same shape as the Amazon "no money coming" close so every
   list, filter and money report already understands it: approved, no-refund,
   moneyOff, the units stop being owed, status follows the stock, the row files
   itself after the usual window. Confirmed once because it cannot be undone. */
function jackWriteOff(rid){
  const r=_rowById(rid);if(!r)return;
  const owe=_owedUnits(r);if(!owe){toast('Nothing is owed on this row','er');return;}
  const val=(parseSKU(r.sku||'').cogs||0)*owe;
  showConfirm('Write it off?',
    `<b>${fmt(owe)} unit${owe===1?'':'s'} · ${fmtGBP2(val)}</b> taken as a loss.\nThe row closes for you, Sarah and Becki — nothing is chased or claimed.\nThe loss stays on the row's story and in the Audit Log.`,
    async()=>{
      const now=new Date().toISOString();
      const ch=(r.resolution&&r.resolution.chase)||{path:'never-arrived',step:'',due:'',log:[]};
      ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:`Written off — ${fmt(owe)} unit${owe===1?'':'s'} · ${fmtGBP2(val)} taken as a loss`}]);
      ch.step='';
      r.resolution=Object.assign({},r.resolution||{},{state:'approved',kind:'ops',what:'no-refund',
        approvedBy:_who(),approvedAt:now,refundUnits:owe,
        moneyOff:{by:_who(),at:now,why:'Written off — taking the loss'},chase:ch});
      r.cancelledQty=(parseInt(r.cancelledQty)||0)+owe;
      try{_statusFollowsStock(r);if(/^Late/.test(String(r.transitAction||'')))r.transitAction='';}catch(e){}
      const d=new Date(),dd=_ddUK(d);
      r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: written off — ${fmt(owe)} unit${owe===1?'':'s'} taken as a loss, nothing more coming`;
      r.vaNoteBy=_who();r.vaNoteAt=now;
      r._dirty=true;
      try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
      logAudit('Written off',`${r.sku||r.asin||''} — ${fmt(owe)} unit${owe===1?'':'s'} · ${fmtGBP2(val)} taken as a loss by ${_who()}`);
      toast('Written off — closed for everyone','ok');
      renderJack();try{renderAdmin();renderPrep();}catch(e){}
    },{icon:'\u26A0\uFE0F',ok:'Write it off'});
}
/* Jack, 10 Sep: "2 never cancelled — this automated wrong on the webapp's side".
   "Only N were ordered" is a sheet correction, not a cancellation. Whoever
   presses it — Jack on his card, Sarah on the answer he sent her — gets the
   correction popup already filled in: Enter saves, exp becomes the real
   number, nothing is marked cancelled, the sheet job lands on Sarah's list. */
function openQtyFixAnswered(rid){
  const r=_rowById(rid);if(!r)return;
  const got=parseInt(r.rcvd)||0,exp=parseInt(r.exp)||0;
  const rg=(r.resolution&&r.resolution.restGone)||null;
  const to=(rg&&rg.why==='sheet'&&rg.ordered!=null)?parseInt(rg.ordered):got;
  const by=(rg&&rg.why==='sheet')?'Jack':_who();
  openQtyFix(rid,{to,
    why:`${by} checked the account — only ${fmt(to)} ${to===1?'was':'were'} ordered`,
    banner:`${by} checked the account: only ${fmt(to)} ${to===1?'was':'were'} ordered, the sheet says ${fmt(exp)}. Nothing is missing and nothing was cancelled — this corrects the row to ${fmt(to)} and puts the Purchase Sheet on Sarah's list.`});
}
function jackRestGone(rid,btn){
  const td=btn&&btn.closest('td');if(!td)return;
  const r=_rowById(rid);if(!r)return;
  const got=parseInt(r.rcvd)||0,exp=r.exp||0,owed=Math.max(0,exp-got-(parseInt(r.cancelledQty)||0));
  td.innerHTML=`<div class="jkAnsBox" data-jk-edit="1">
    <div class="jkAnsT">${fmt(got)} in &middot; ${fmt(owed)} never coming &mdash; why?</div>
    <button class="csAct warn" onclick="jackRestGoneSend('${rid}','cancelled')" title="Amazon cancelled or refunded the rest — the money is back or coming back by itself, nothing for anyone to chase.">Amazon cancelled or refunded the rest</button>
    <button class="csAct go" onclick="openQtyFixAnswered('${rid}')" title="The Purchase Sheet says ${fmt(exp)} but only ${fmt(got)} were actually ordered — a sheet correction, not a cancellation. The popup opens filled in with ${fmt(got)}.">Only ${fmt(got)} ${got===1?'was':'were'} ordered &mdash; sheet is wrong</button>
    <button class="csAct plain" onclick="renderJack()">Back</button></div>`;
}
function jackRestGoneSend(rid,why){
  const r=_rowById(rid);if(!r)return;
  const got=parseInt(r.rcvd)||0,exp=r.exp||0,owed=Math.max(0,exp-got-(parseInt(r.cancelledQty)||0));
  const text=why==='sheet'
    ?`Only ${fmt(got)} were ordered — the sheet says ${fmt(exp)}. The other ${fmt(owed)} never existed; fix the sheet and close it.`
    :`Amazon cancelled or refunded the other ${fmt(owed)} — the money is back by itself. Note the sheet and close it.`;
  jackAnswered(rid,text,{restGone:{why,ordered:got,owed,at:new Date().toISOString()}});
}
async function jackStillComing(rid,vGiven){
  const el=document.getElementById('jkD_'+rid);const v=vGiven||(el&&el.value);
  if(!v||!saneDate(v)){toast('Pick the date the account shows','er');return;}
  const r=_rowById(rid);if(!r)return;
  const nice=new Date(v).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  const asked=r.resolution||{};
  /* not arrived YET is not never-arrived — the date carries the state */
  r.delivered='';
  r.expectedDelivery=v;r.chaseSnoozeUntil='';
  if(r.transitAction==='Late — Needs Chasing')r.transitAction='';
  const chase=asked.chase||{path:'never-arrived',step:'',due:'',log:[]};
  if(chase.step!=='due-date')chase.prevStep=chase.step||'check-refund';
  chase.parkedAt=new Date().toISOString();
  chase.step='due-date';chase.due=v;
  chase.log=(chase.log||[]).concat([{at:new Date().toISOString(),by:_who(),
    what:'Checked the account — still coming, delivery expected '+nice}]);
  /* state 'working': hers again but parked — no sent-back banner, no queue row.
     The date on the Prep Sheet and the case log ARE the message to Sarah; the
     overdue machinery returns it to her queue by itself if the date slips. */
  r.resolution=Object.assign({},asked,{state:'working',chase});
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit('Jack answered a check',`${r.sku||r.asin||''} — still coming, expected ${nice}`);
  toast('✓ Parked until '+nice+' — on the Prep Sheet, back with Sarah the moment it slips');
  renderJack();try{renderAdmin();renderPrep();renderDashboard();paintJackBadge();}catch(e){}
}
async function jackAnswered(rid,answer,extra){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  const asked=r.resolution;
  /* This used to build a fresh object from four fields, throwing away
     everything else Sarah had written — her findings, her suggested fix, the
     steps she had ticked. She then got the row back with his answer and none
     of her own work on it. Spread the original and overwrite only the state. */
  r.resolution=Object.assign({},asked,{
    state:'rejected',kind:'check',what:'jack-check',
    ask:asked.ask||'',askedBy:asked.by||'',askedAt:asked.at||'',
    /* a structured answer (rest cancelled / fewer ordered) rides on the
       resolution so Sarah's page can offer the one press that follows from it;
       a plain answer clears any earlier one */
    restGone:(extra&&extra.restGone)||undefined,
    /* typed by him rather than pressed — a request for her, not a finding */
    jackNote:!!(extra&&extra.fromNote)||undefined,
    rejectedBy:_who(),rejectNote:answer,at:new Date().toISOString()});
  /* A YES/NO delivery answer is also a triage FACT — write it to the row so
     Sarah's card moves straight to the next step (wrong SKU?) rather than
     making her re-enter what Jack just said. */
  if(/arrived — yes/i.test(answer))r.delivered='Yes';
  else if(/not arrived/i.test(answer))r.delivered='No';
  /* Jack, 8 Sep: his answer is a FINDING — Sarah decides what happens next and
     presses "Send to Becki" (amzToBecki). Nothing flags itself from his page. */
  /* His answer is a line in the case, not a separate note — and if he has just
     told her it never arrived, the chase opens itself on the next real step so
     the row lands back in her queue ready to work, not needing re-diagnosing. */
  let _back=r.resolution.chase;
  if(!_back&&r.delivered==='No')_back={path:'never-arrived',step:'check-refund',due:'',log:[]};
  if(_back){
    _back.log=(_back.log||[]).concat([{at:new Date().toISOString(),by:_who(),
      what:'Jack answered — '+answer}]);
    /* His answer moves the case on. It came to him BECAUSE she was stuck, so
       handing it back on the same step she was stuck at would just loop. */
    if(r.delivered==='No'&&(_back.step==='to-jack'||!_back.step))
      _back.step=_amazonRow(r)?'amazon-lost':'check-refund';
    else if(r.delivered==='Yes'&&_back.path==='never-arrived'){
      /* It turned up after all — so the never-arrived chase stops, but it is
         NOT deleted. A week of Sarah's chasing is exactly the history Jack
         asked for, and "no history should ever be fully deleted" does not
         stop applying because the diagnosis turned out wrong. */
      _back.path='closed-arrived';_back.step='';_back.closedWhy='Arrived after all';
    }
    if(_back)_back.due='';
    r.resolution.chase=_back||undefined;
  }
  r._dirty=true;
  try{
    await saveRow(r);
    logAudit('Jack answered a check',`${r.sku||r.asin||''} — ${answer}`);
    fireWebhook(`${_who()} answered "${r.prod||r.sku||''}": ${answer}`,
      {event:'jack_answered',sku:r.sku||'',by:_who()});
    toast('✓ Sent back with your answer');
  }catch(e){toast('Didn\'t save — check the connection','er');}
  renderJack();try{renderAdmin();renderDashboard();paintJackBadge();}catch(e){}
}
function sarahTodo(){
  const open=VA_ACTIONS.filter(a=>!a.done);
  const sentBack=rows.filter(r=>!r.archived&&r.resolution&&r.resolution.state==='rejected');
  const chase=_adminItems().length;
  const chk=checkInState();
  return{open,sentBack,chase,late:chk.late,n:open.length+sentBack.length};
}


// ── TRIAGE + DUE DATES (the controls that replaced "Chased") ──────────────────
/* "Sent on wrong SKU" happens constantly — usually because another order was
   cancelled and the stock went out under a different listing. Recording it on
   the row means the answer is there next time instead of being re-worked out. */
async function setTriage(rid,field,val){
  markSeen(rid);
  const r=_rowById(rid);if(!r)return;
  r[field]=val;r._dirty=true;
  /* Answering "no" IS the diagnosis — the case opens itself on the next step
     so she is never left holding a verdict with nowhere to take it. Clearing
     the answer closes an untouched case again; one that has been worked on is
     never thrown away. */
  if(field==='delivered'){
    if(val==='No'&&!_caseOf(r))_caseSet(r,{path:'never-arrived',
      /* Amazon never routes through the auto-refund check — she has no account
         to look in, so the first step is Jack's, not one she cannot do. */
      step:_amazonRow(r)?'to-jack':'check-refund',
      log:[{at:new Date().toISOString(),by:_who(),what:'Never arrived — confirmed on the row'}]});
    else if(!val){
      /* Clearing the answer throws away an untouched case — but ONLY one that
         is genuinely untouched and genuinely hers. Once _caseOf also matched
         rows Jack had answered, this one line was deleting his reply, his
         note and the whole handover on a single dropdown change, with no
         confirm and no undo. Never touch anything he has been near. */
      const res=r.resolution,c=_caseOf(r);
      if(c&&res&&res.state==='working'&&!res.rejectNote&&!res.askedBy&&(c.log||[]).length<=1)
        r.resolution=null;
    }
  }
  try{await _mustSave(r);}catch(e){toast('Didn\'t save — nothing was recorded. Check the connection and try again.','er');return;}
  logAudit(field==='wrongSku'?'Wrong-SKU flag':'Arrived flag',`${r.sku||r.asin||''} — ${val||'cleared'}`);
  renderAdmin();
  /* Jack, 16 Aug: "why is a pop-up immediately appearing? … nothing else needs
     to pop up yet." Answering a triage question changes the row and NOTHING
     opens. The popup waits for Sorted, where it arrives pre-filled. */
}
