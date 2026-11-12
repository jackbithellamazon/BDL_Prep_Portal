/* BDL PrepHub — workflow checks.
   Runs INSIDE the TEST MODE build (nothing saves). Every scenario is an agreed
   workflow, driven through the same functions the buttons call, on rows made
   up for the test, and the end state is asserted. A build ships only when
   every check is green.  Load: tests/checks.js → PrepChecks.run() */
window.PrepChecks=(function(){
  const R=[];let _n=900000;
  const iso=()=>new Date().toISOString();
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function who(n){window.cu={id:n.toLowerCase(),name:n,role:n==='Jack'?'admin':'va'};window.currentUserName=n;}
  function mkRow(f){const id=++_n;const r=Object.assign({uuid:'chk-'+id,id,_chk:true,date:'22/06',oid:'202-CHK-'+id,
    sup:'Amazon UK',acct:'Biz 01',prod:'CHECK ROW '+id,asin:'B0CHK'+id,sku:'Amuk_5.00_22066_0_CHK_'+id,
    exp:10,rcvd:0,ship:0,cancelledQty:0,status:'In-Transit',issueType:'',issueQty:0,notes:'',vaNote:'',
    archived:false,shipSegments:[],allShipIds:[],sent:'No',subSave:'No',resolution:null,transitAction:''},f);
    if((parseInt(r.ship)||0)>0&&!r.shipSegments.length){r.shipSegments=[{shipId:'FBA-CHK'+id,units:parseInt(r.ship),date:'2026-08-01',type:'Standard'}];r.allShipIds=['FBA-CHK'+id];}
    rows.push(r);return r;}
  function mkClaim(f){const id='chk-c'+(++_n);const c=Object.assign({id,_chk:true,cst:'Raised',owner:'Sarah',raisedAt:iso().slice(0,10),log:[],archived:false},f);claims.push(c);return c;}
  function cleanup(){
    for(const arr of [rows,(typeof claims!=='undefined'?claims:[]),(typeof REC!=='undefined'?REC:[])])
      for(let i=arr.length-1;i>=0;i--)if(arr[i]&&(arr[i]._chk||/CHECK ROW/.test(String(arr[i].name||''))))arr.splice(i,1);
    if(typeof VA_ACTIONS!=='undefined')for(let i=VA_ACTIONS.length-1;i>=0;i--)if(/^chk-/.test(String(VA_ACTIONS[i].rid||'')))VA_ACTIONS.splice(i,1);
    document.querySelectorAll('.overlay').forEach(o=>{o.style.display='none';});
    try{closeQtyFix();}catch(e){}
  }
  const rid=r=>r.uuid;
  const same=(i,r)=>[i.rid,i.id,i.r&&i.r.uuid,i.r&&i.r.id].some(x=>x!=null&&(String(x)===String(r.uuid)||String(x)===String(r.id)));
  const sarahItem=r=>_adminItems().find(i=>same(i,r))||null;
  const onSarahActive=r=>{const i=sarahItem(r);return !!(i&&!i.waiting);};
  const onJack=r=>{const t=jackTodo();return [].concat(t.checks||[],t.closures||[],t.fixes||[]).some(i=>same(i,r));};
  const onPrep=r=>!r.archived&&!_offPrepSheet(r);
  function eq(a,b,m){if(a!==b)throw new Error(m+' — got '+JSON.stringify(a)+', expected '+JSON.stringify(b));}
  function ok(v,m){if(!v)throw new Error(m);}
  function setVal(id,v){const el=document.getElementById(id);if(!el)throw new Error('#'+id+' not on screen');el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
  const asked=(f)=>Object.assign({state:'asked',kind:'check',what:'jack-check',ask:'Check whether it was cancelled or refunded',by:'Sarah',at:iso(),
    chase:{path:'never-arrived',step:'to-jack',due:'',log:[{at:iso(),by:'Sarah',what:'Never arrived — confirmed on the row'}]}},f||{});

  const S={};
  /* 1 · Amazon chain, found on the shelves: Sarah flags → Jack "delivered" → Sarah wrong-SKU No → Becki counts in → flag clears itself */
  S['amazon chain — found']=async()=>{
    who('Sarah');const r=mkRow({exp:10});
    await setTriage(rid(r),'delivered','No');
    eq(_caseOf(r).step,'to-jack','Amazon never-arrived goes to Jack first, not the refund check');
    askJackAsk(rid(r),'Check whether it was cancelled or refunded');await askSend();
    eq(r.resolution.state,'asked','sent to Jack');ok(!onSarahActive(r),'off Sarah’s active list while with Jack');ok(onJack(r),'on Jack’s page');
    who('Jack');await jackAnswered(rid(r),'Arrived — YES, the account shows it delivered.');
    eq(r.resolution.state,'rejected','back with Sarah');ok(!onJack(r),'off Jack’s page');ok(onSarahActive(r),'on Sarah’s list');
    who('Sarah');await setTriage(rid(r),'wrongSku','No');await amzToBecki(rid(r));
    ok(_isAmzDel(r),'Amazon-says-delivered flag is on');ok(sarahItem(r)&&sarahItem(r).withBecki,'Sarah sees it with Becki');
    who('Becki');countInOpen(rid(r),{value:'In Warehouse'},'In Warehouse');setVal('countInQty','10');await countInSave();
    eq(_owedUnits(r),0,'nothing owed');eq(r.resolution.amzDelivered.done.how,'found','flag cleared as found — no button');
    ok(/found it — all booked in/.test(r.vaNote),'VA note says found');ok(!_isAmzDel(r),'flag off');
    ok(!onSarahActive(r),'off Sarah');ok(!onJack(r),'off Jack');
  };
  /* 2 · Amazon chain, not here: Becki → straight to Jack (Sarah bypassed) → Sorted with Amazon → no money → written off */
  S['amazon chain — not here → Jack → write-off']=async()=>{
    who('Sarah');const r=mkRow({exp:10,resolution:asked({state:'rejected',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack'})});
    await amzToBecki(rid(r));ok(_isAmzDel(r),'with Becki');
    who('Becki');await amzNotHere(rid(r));
    ok(!onSarahActive(r),'Not here bypasses Sarah');ok(onJack(r),'lands on Jack');
    who('Jack');await amzMissingDone(rid(r),'refused');
    eq(r.resolution.state,'approved','closed');eq(r.resolution.what,'no-refund','no refund');ok(r.resolution.moneyOff,'written off');
    eq(_owedUnits(r),0,'nothing owed');ok(!onJack(r)&&!onSarahActive(r),'off both');
    ok(!jackTodo().owed.some(o=>same({rid:o.r&&o.r.uuid},r)),'not on the money list');
  };
  /* 3 · "Only N were ordered — the sheet is wrong" is a correction, never a cancellation (Jack's card) */
  S['sheet is wrong — Jack’s card corrects, never cancels']=async()=>{
    who('Jack');const r=mkRow({exp:5,rcvd:3,ship:3,status:'Part Sent',resolution:asked()});
    openQtyFixAnswered(rid(r));eq(document.getElementById('qfNew').value,'3','popup filled in with what arrived');
    await saveQtyFix();
    eq(r.exp,3,'order corrected');eq(parseInt(r.cancelledQty)||0,0,'NOTHING cancelled');eq(r.resolution.what,'qty-fixed','closed as a correction');
    eq(r.status,'Sent to Amazon','status follows stock');ok(!_prepRowLate(r),'not late');
    ok(VA_ACTIONS.some(a=>String(a.rid)===r.uuid&&/Purchase Sheet/i.test(a.task)&&!a.done),'Sarah gets the Purchase Sheet job');
    ok(!onJack(r)&&!onSarahActive(r),'off both');
  };
  /* 4 · the same answer already sitting on Sarah's page routes to the correction, not the close-off */
  S['sheet is wrong — Sarah’s row routes to the correction']=async()=>{
    const r=mkRow({exp:5,rcvd:3,ship:3,status:'Part Sent',resolution:asked({state:'rejected',rejectNote:'Only 3 were ordered — the sheet says 5.',rejectedBy:'Jack',restGone:{why:'sheet',ordered:3,owed:2,at:iso()}})});
    who('Sarah');goPage('admin');renderAdmin();await wait(200);
    const btns=[...document.querySelectorAll('#page-admin button')].filter(b=>(b.getAttribute('onclick')||'').includes(r.uuid));
    ok(btns.some(b=>/Correct the sheet to 3/.test(b.textContent)),'button says Correct the sheet to 3');
    ok(!btns.some(b=>/part-cancelled|'cancelled'/.test(b.getAttribute('onclick')||'')),'no cancel route offered');
    openQtyFixAnswered(rid(r));eq(document.getElementById('qfNew').value,'3','filled in from Jack’s answer');await saveQtyFix();
    eq(r.exp,3,'corrected');eq(parseInt(r.cancelledQty)||0,0,'nothing cancelled');eq(r.resolution.what,'qty-fixed','correction');
  };
  /* 5 · Jack says "cancelled or refunded" → Sarah's one tick closes it with the units cancelled */
  S['cancelled/refunded — Sarah’s one-tick close']=async()=>{
    who('Jack');const r=mkRow({exp:5,rcvd:3,ship:3,status:'Part Sent',resolution:asked()});
    jackRestGoneSend(rid(r),'cancelled');await wait(300);
    eq(r.resolution.state,'rejected','with Sarah');eq(r.resolution.restGone.why,'cancelled','answer recorded');
    who('Sarah');openSorted(rid(r),'part-cancelled');srtSync();
    const d=_srtCollect();eq(parseInt(d.cx),2,'popup pre-filled: 2 cancelled');
    document.querySelectorAll('#sortedModal input[data-k], .srtMod input[data-k]').forEach(c=>{c.checked=true;srtTick(c);});
    await submitSorted();await wait(400);
    eq(parseInt(r.cancelledQty)||0,2,'2 cancelled');eq(_owedUnits(r),0,'nothing owed');eq(r.resolution.state,'approved','closed');
    eq(r.status,'Sent to Amazon','status follows stock');ok(!_prepRowLate(r),'not late');
  };
  /* 6 · wrong SKU: the SKU it went out under is compulsory, recorded, and the other SKU's row is never touched */
  S['wrong SKU — names the SKU, never merges']=async()=>{
    const asin='B0CHKWELLA';
    const r1=mkRow({asin,sku:'Amg_8.26_22066_0_CHK_FFB2_20',exp:20,rcvd:4,ship:4,status:'Part Sent',resolution:asked({state:'rejected',rejectNote:'Arrived — YES. Carry on with the wrong-SKU check.',rejectedBy:'Jack'})});
    const r2=mkRow({asin,sku:'Amg_8.26_22066_0_CHK_FFB1_20',exp:20,rcvd:20,ship:20,status:'Sent to Amazon'});
    const snap=JSON.stringify([r2.exp,r2.rcvd,r2.ship,r2.cancelledQty,r2.status,r2.resolution]);
    who('Sarah');openSorted(rid(r1),'wrong-sku');srtSync();await wait(100);
    ok(window._srtGate&&window._srtGate.ok===false&&window._srtGate.missingAsk,'cannot close without the SKU');
    setVal('srtSku',r2.sku);srtSync();await wait(100);
    document.querySelectorAll('input[data-k]').forEach(c=>{c.checked=true;srtTick(c);});srtSync();
    /* 23 Oct (the Bosch): FFB1 sent exactly its own 20 — no spare, so naming it is not enough */
    ok(window._srtGate&&window._srtGate.missingAsk,'a SKU with no spare units does not open the gate');
    setVal('srtSkuWhy','test: Becki confirmed the 16 went in FFB1\u2019s carton');srtSync();await wait(50);
    ok(!(window._srtGate&&window._srtGate.missingAsk),'gate opens once the SKU is named and the override has a reason');
    await submitSorted();await wait(400);
    /* b627 (Jack, 29 Oct): an overridden SKU check doesn't close — it goes to Jack, and settles when he approves */
    eq(r1.resolution.state,'proposed','an overridden SKU check goes to Jack, not closed');ok(r1.resolution.looksWrong,'…marked looks wrong');
    who('Jack');await approveResolution(rid(r1));await wait(200);
    eq(r1.resolution.wentAs,r2.sku,'went-out-under SKU recorded');eq(r1.resolution.wentAsQty,16,'16 units recorded once Jack approves');
    ok(r1.resolution.wentAsCheck&&/Becki confirmed/.test(r1.resolution.wentAsCheck.override),'the override reason is kept with the close');
    eq(_owedUnits(r1),0,'nothing owed on the missing row');
    eq(JSON.stringify([r2.exp,r2.rcvd,r2.ship,r2.cancelledQty,r2.status,r2.resolution]),snap,'the other SKU’s row is untouched — no merge');
  };
  /* 7 · Jack writes the rest off — taking the loss */
  S['write-off from Jack’s card']=async()=>{
    who('Jack');const r=mkRow({exp:20,rcvd:4,ship:4,status:'Part Sent',resolution:asked()});
    jackWriteOff(rid(r));await wait(100);document.getElementById('confirmOkBtn').click();await wait(500);
    eq(r.resolution.what,'no-refund','no refund');ok(r.resolution.moneyOff,'written off');eq(parseInt(r.cancelledQty)||0,16,'16 never coming');
    eq(r.status,'Sent to Amazon','status follows');ok(!onJack(r)&&!onSarahActive(r),'off both');ok(!_prepRowLate(r),'not late');
    eq(acHold(r),null,'auto-clear will file it');
  };
  /* 8 · gated: off their lists, then Recovery Stock takes it off the Prep Sheet for good */
  S['gated → off their lists → Recovery files the row']=async()=>{
    who('Jack');const r=mkRow({exp:1,rcvd:1,status:'Issue',notes:'Gated'});
    const c=mkClaim({prepRowId:r.uuid,sku:r.sku,prod:r.prod,asin:r.asin,issT:'Gated',dif:1,exp:1,claimValue:49.99,oid:r.oid,sup:r.sup});
    ok(onPrep(r),'on the Prep Sheet to start');
    await takeGatedMine(c.id);
    ok(!onPrep(r),'off the Prep Sheet once Jack takes it');
    recFromClaimModal(c.id);await wait(150);setVal('rfcQty','1');
    await recFromClaimGo(c.id);await wait(400);
    eq(c.cst,'Resolved','claim closed');ok(r.archived,'prep row filed');ok(/Recovery Stock/.test(r.notes),'row says where it went');
    ok(!onPrep(r),'still off the Prep Sheet after the claim closes');
  };
  /* 9 · the late rule */
  S['late rule']=async()=>{
    const r=mkRow({exp:20,rcvd:4,ship:4,status:'Part Sent',date:'22/06'});
    ok(_prepRowLate(r),'80 days, 16 owed → late');
    r.resolution={state:'approved',kind:'ops',what:'no-refund'};ok(!_prepRowLate(r),'approved → not late');
    r.resolution=null;r.cancelledQty=16;ok(!_prepRowLate(r),'nothing owed → not late');
  };
  /* 10 · status follows stock */
  S['status follows stock']=async()=>{
    const a=mkRow({exp:10,rcvd:10,ship:10});_statusFollowsStock(a);eq(a.status,'Sent to Amazon','all shipped');
    const b=mkRow({exp:10,rcvd:6,ship:0,cancelledQty:4});_statusFollowsStock(b);eq(b.status,'In Warehouse','on the shelf, nothing owed');
    const c=mkRow({exp:10,rcvd:0,ship:0,cancelledQty:10});_statusFollowsStock(c);ok(c.archived,'nothing ever landed → filed');
    const d=mkRow({exp:10,rcvd:4,ship:0});const was=d.status;_statusFollowsStock(d);eq(d.status,was,'still owed → untouched');
  };
  /* 11 · a typed note from Jack is a job for Sarah, not an answer */
  S['Jack’s note is a job, not an answer']=async()=>{
    who('Jack');const r=mkRow({exp:20,rcvd:4,ship:4,status:'Part Sent',resolution:asked()});
    await jackAnswered(rid(r),'There were 3 orders on this ASIN — double-check Seller Central.',{fromNote:true});
    ok(r.resolution.jackNote,'flagged as a note');
    who('Sarah');goPage('admin');renderAdmin();await wait(200);
    const html=[...document.querySelectorAll('#page-admin button')].filter(b=>(b.getAttribute('onclick')||'').includes(r.uuid)).map(b=>b.closest('.csNow')?b.closest('.csNow').textContent:'').join(' ');
    ok(/Jack needs you to check/.test(html),'Sarah sees it as a job to do');
  };
  /* 12 · refunds never reach Sarah on Amazon orders; a supplier order does start with the refund check */
  S['Amazon refund questions are Jack’s']=async()=>{
    who('Sarah');const a=mkRow({exp:10});await setTriage(rid(a),'delivered','No');eq(_caseOf(a).step,'to-jack','Amazon → Jack first');
    const s=mkRow({exp:10,sup:'Nisbets',oid:'UK-CHK-1'});await setTriage(rid(s),'delivered','No');eq(_caseOf(s).step,'check-refund','supplier → refund check');
  };
  /* 13 · booking in by typing the Received cell clears the flag too */
  S['Received cell clears the flag']=async()=>{
    who('Becki');const r=mkRow({exp:10,rcvd:4,status:'In Warehouse',resolution:asked({state:'rejected',amzDelivered:{by:'Jack',at:iso(),sentBy:'Sarah'}})});
    ok(_isAmzDel(r),'flag on');uf(rid(r),'rcvd',10);await wait(100);
    eq(r.resolution.amzDelivered.done.how,'found','cleared as found');ok(!_isAmzDel(r),'flag off');
  };

  /* 14 · the PLUB pages lay out (b548 turned every panel into a flex row for two days) */
  S['PLUB panels lay out']=async()=>{
    who('Jack');goPage('lavarion');await wait(600);let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    for(const tab of ['products','components','overview']){LV3.go(tab);await wait(400);
      const p=document.querySelector('#lav3View .panel');ok(p,tab+': a panel rendered');
      const disp=getComputedStyle(p).display;ok(disp==='block','#lav3View .panel display is '+disp+' on '+tab+' — must be block');
      const t=document.querySelector('#lav3View .panel table');if(t){const x=t.getBoundingClientRect().x;ok(x<200,tab+': table starts at x='+Math.round(x)+' — shoved right');}}
    const dup=document.querySelector('#dupStrip');if(dup)ok(getComputedStyle(dup).display==='block','dup strip is block');
    goPage('jack');
  };

  /* 15 · THE ONE DOOR: status follows the stock on ANY save, whoever saved it */
  S['rules on save — status follows stock']=async()=>{
    who('Becki');
    const a=mkRow({exp:10,rcvd:10,ship:0,status:'In-Transit'});await saveRow(a);eq(a.status,'In Warehouse','all in, nothing shipped → In Warehouse');
    const b=mkRow({exp:10,rcvd:10,ship:10,status:'In Warehouse'});await saveRow(b);eq(b.status,'Sent to Amazon','everything shipped → Sent to Amazon');eq(b.sent,'Yes','sent flag');
    const c=mkRow({exp:1,rcvd:1,ship:0,status:'Issue',notes:'Gated'});await saveRow(c);eq(c.status,'Issue','Issue rows are left alone');
    const d=mkRow({exp:0,rcvd:0,ship:0,status:'In-Transit'});await saveRow(d);eq(d.status,'In-Transit','a row with no order is left alone');ok(!d.archived,'and never archived by the rule');
    const e=mkRow({exp:10,rcvd:4,ship:0,status:'In-Transit'});await saveRow(e);eq(e.status,'In-Transit','still owed → untouched');
    const f=mkRow({exp:10,rcvd:10,ship:10,status:'Sent to Amazon',archived:true});await saveRow(f);ok(f.archived,'archived rows stay archived');
  };
  /* 16 · a stale Late label clears the moment nothing is owed, on any save */
  S['rules on save — stale Late clears']=async()=>{
    const r=mkRow({exp:10,rcvd:10,ship:0,status:'In-Transit',transitAction:'Late — Needs Chasing'});await saveRow(r);
    eq(r.transitAction,'','Late label gone');ok(!_prepRowLate(r),'not late');
    const s=mkRow({exp:10,rcvd:4,ship:0,status:'In-Transit',transitAction:'Late — Needs Chasing'});await saveRow(s);
    eq(s.transitAction,'Late — Needs Chasing','still owed → label stays');
  };
  /* 17 · received can never sit below what has gone out on a shipment */
  S['rules on save — received never below shipped']=async()=>{
    const r=mkRow({exp:10,rcvd:2,ship:6,status:'Part Sent'});await saveRow(r);eq(parseInt(r.rcvd),6,'received raised to match the shipment');
  };

  /* THE AUDIT — not pass/fail: for every live row, what _rowOwner says vs what each page shows.
     Any disagreement is a Corsair-class bug waiting to happen. PrepChecks.audit() */
  function audit(){
    const live=rows.filter(r=>!r._chk&&!r.archived);
    const t=jackTodo();const onJ=new Set([].concat(t.checks||[],t.closures||[]).map(r=>String(r.uuid||r.id)));
    (t.claimsQ||[]).forEach(cl=>{if(cl.prepRowId)onJ.add(String(cl.prepRowId));});   /* gated claims are cards on his page too */
    const sa=_adminItems();const onS=new Set(sa.filter(i=>!i.waiting&&!i.sortedGrace&&!i.parkedRow).map(i=>String(i.rid)));   /* grey done/parked rows are not her job */const withB=new Set(sa.filter(i=>i.withBecki).map(i=>String(i.rid)));
    /* her open claims are rows on her page too — but claim paperwork may legitimately sit with her while the ROW is with Jack, so they only count for "is it shown", never for "shown but shouldn't be" */
    const onSc=new Set();(claims||[]).forEach(cl=>{if(cl&&!cl.archived&&cl.cst!=='Resolved'&&cl.cst!=='Closed'&&String(cl.owner||'VA')!=='Jack'&&cl.prepRowId)onSc.add(String(cl.prepRowId));});
    const rowsOut=[];const tally={};
    for(const r of live){
      const o=_rowOwner(r);const id=String(r.uuid||r.id);
      const shown={jack:onJ.has(id),sarah:onS.has(id),becki:withB.has(id),prep:!_offPrepSheet(r)};
      const problems=[];
      if(o.owner==='jack'&&!shown.jack)problems.push('owner is Jack but not on Jack’s page');
      if(o.owner!=='jack'&&shown.jack)problems.push('on Jack’s page but owner is '+o.owner);
      if(o.owner==='sarah'&&!shown.sarah&&!onSc.has(id))problems.push('owner is Sarah but not on her active list');
      if(o.owner!=='sarah'&&o.owner!=='becki'&&shown.sarah)problems.push('on Sarah’s active list but owner is '+o.owner);
      if(o.owner==='becki'&&!shown.becki)problems.push('owner is Becki but Sarah’s page does not show it with Becki');
      if(o.finished&&(shown.jack||shown.sarah))problems.push('finished ('+o.why+') but still listed');
      if(problems.length){rowsOut.push({sku:r.sku,status:r.status,exp:r.exp,rcvd:r.rcvd,cx:r.cancelledQty,state:(r.resolution||{}).state||'',owner:o.owner,why:o.why,problems});problems.forEach(p=>{tally[p]=(tally[p]||0)+1;});}
    }
    return {rows:live.length,disagreements:rowsOut.length,tally,list:rowsOut};
  }

  /* 18 · every dd/mm stamp is the UK date, whoever's clock wrote it */
  S['date stamps are UK dates']=async()=>{
    eq(_ddUK(new Date('2026-09-10T23:30:00Z')),'11/09','23:30 UTC in September is 00:30 BST the next day');
    eq(_ddUK(new Date('2026-01-10T23:30:00Z')),'10/01','in January UK = UTC');
    eq(_ddUK('2026-09-10T18:01:00Z'),'10/09','18:01 UTC on the 10th is the 10th in the UK (Sarah’s clock said 11th)');
    who('Sarah');const r=mkRow({exp:10,rcvd:4,status:'In Warehouse',resolution:asked({state:'rejected',amzDelivered:{by:'Jack',at:iso(),sentBy:'Sarah'}})});
    await amzNotHere(rid(r));ok(new RegExp('^Sarah '+_ddUK()+':').test(r.vaNote.split('\n').pop()),'note stamped with today’s UK date');
  };

  /* 19 · PLUB comes to Jack first; Sarah gets it only as a job with his note; her Send to Jack returns it */
  S['PLUB shortage — Jack first, Sarah only as a job']=async()=>{
    ok(window.LV3&&LV3.supplierIssues,'LV3 present');
    const fake={key:'o:chk-lav-1',ref:'UK-CHK-LAV',sup:'CHECK SUPPLIER',on:'2026-09-01',short:5,dmg:0,val:50,lines:[{name:'CHECK ROW LAV'}],evid:'',toJack:'',toSarah:'',log:[],chased:'',quiet:false};
    const o1=LV3.supplierIssues,o2=LV3.setSupplierIssueField,o3=LV3.logSupplierIssue;
    LV3.supplierIssues=()=>[fake];LV3.setSupplierIssueField=(k,f,v)=>{if(k===fake.key)fake[f]=v;return true;};LV3.logSupplierIssue=(k,e)=>{fake.log.push(e);};
    try{
      const onJ=()=>jackTodo().lavQ.some(g=>g.key===fake.key),onS=()=>_allAdminRows().some(i=>i.rid==='lav:'+fake.key);
      ok(onJ(),'a fresh shortage is on Jack’s page');ok(!onS(),'…and not on Sarah’s');
      who('Jack');lavIssueToSarah(fake.key,'Chase them for the 5');
      ok(!onJ(),'off Jack’s page once sent');ok(onS(),'on Sarah’s as a job');ok(_allAdminRows().find(i=>i.rid==='lav:'+fake.key).jobNote==='Chase them for the 5','with his note');
      who('Sarah');_lavToJackGo(fake.key,'Approve a write-off — Nisbets refused');
      ok(onJ(),'her Send to Jack puts it back on his page');ok(!onS(),'…and off hers');
      eq(JSON.parse(fake.toJack).ask,'Approve a write-off — Nisbets refused','what she needs travels with it');
    }finally{LV3.supplierIssues=o1;LV3.setSupplierIssueField=o2;LV3.logSupplierIssue=o3;}
  };

  /* 20 · a promised date parks the row for everyone; when it slips it is Sarah's chase, not Jack's question */
  S['promised date — parked, then slips to Sarah']=async()=>{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    const park=mkRow({exp:3,expectedDelivery:d(3),resolution:asked({chase:{path:'never-arrived',step:'due-date',due:d(3),log:[]}})});
    eq(_rowOwner(park).owner,'none','future date → nobody’s list');ok(!onJack(park),'not on Jack’s');ok(!onSarahActive(park),'not on Sarah’s');
    /* asked before the date (13 Oct: a question sent AFTER the date slipped is a new one, and Jack's — check 57) */
    const slip=mkRow({exp:3,expectedDelivery:d(-1),resolution:asked({at:new Date(Date.now()-5*864e5).toISOString(),chase:{path:'never-arrived',step:'due-date',due:d(-1),log:[]}})});
    eq(_rowOwner(slip).owner,'sarah','slipped date → Sarah');ok(!onJack(slip),'not on Jack’s page');
    ok(onSarahActive(slip),'on Sarah’s active list');eq(slip.resolution.state,'working','healed to a live chase');
  };

  /* 21 · the 48-hour part-arrival clock puts the row on Sarah's list; a snooze takes it off everyone's */
  S['part arrived — the rest never followed']=async()=>{
    const ago=n=>new Date(Date.now()-n*864e5).toISOString();
    /* dates relative to today — a fixed date ages past the 20-day late clock and the check starts lying */
    const dm=n=>{const x=new Date(Date.now()-n*864e5);return String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0');};
    const fresh=mkRow({exp:10,rcvd:8,ship:8,status:'Part Sent',date:dm(3),rcvdAt:ago(0.2)});
    eq(_rowOwner(fresh).owner,'none','just landed → nobody yet');ok(!onSarahActive(fresh),'not on Sarah’s yet');
    const old=mkRow({exp:10,rcvd:8,ship:8,status:'Part Sent',date:dm(8),rcvdAt:ago(5)});
    eq(_rowOwner(old).owner,'sarah','2 working days on → Sarah');ok(onSarahActive(old),'on Sarah’s list');
    old.chaseSnoozeUntil=new Date(Date.now()+3*864e5).toISOString();
    eq(_rowOwner(old).owner,'none','snoozed → nobody’s');ok(!onSarahActive(old),'off her list while snoozed');
  };

  /* 22 · a slipped promised date asks "Has it arrived?" first; "still nothing" on an Amazon row goes to Jack */
  S['slipped date — Has it arrived? then Jack']=async()=>{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    const r=mkRow({exp:2,expectedDelivery:d(-1),resolution:{state:'working',kind:'check',what:'jack-check',ask:'Check whether this order actually arrived',by:'Sarah',at:iso(),chase:{path:'never-arrived',step:'due-date',due:d(-1),log:[]}}});
    who('Sarah');goPage('admin');renderAdmin();await wait(200);
    const btn=[...document.querySelectorAll('#page-admin button')].find(b=>(b.getAttribute('onclick')||'').includes("slipStillNothing('"+r.uuid+"')"));
    ok(btn,'"No — still nothing" is offered');ok(/Has it arrived\?/.test(btn.closest('.csNow').textContent),'the first question is Has it arrived?');
    await slipStillNothing(rid(r));
    eq(r.resolution.state,'asked','sent to Jack');ok(onJack(r),'on Jack’s page');ok(!onSarahActive(r),'off Sarah’s active list');
  };
  /* 23 · part shipped, the rest never followed → Sarah; "went out under another SKU" records it and closes the row */
  S['part shipped — the rest never followed → another SKU']=async()=>{
    const r=mkRow({exp:70,rcvd:70,ship:23,status:'Part Sent',date:'25/08',sentDate:'2026-08-27',shipSegments:[{shipId:'FBA-CHK-OLD',units:23,date:'2026-08-27',type:'Standard'}],allShipIds:['FBA-CHK-OLD']});
    eq(_rowOwner(r).owner,'sarah','the remainder never followed → Sarah');ok(onSarahActive(r),'on Sarah’s list');
    ok(_partShipStale(r),'the row tag shows for Becki');
    who('Becki');await _wentOutGo(r,'Tesco_CHK_OLD','FBA-CHK-OLD',47);
    eq(parseInt(r.ship),70,'all 70 recorded as shipped');eq(r.status,'Sent to Amazon','status follows');ok(/went out under Tesco_CHK_OLD/.test(r.notes),'packing note says so');
    ok(VA_ACTIONS.some(a=>String(a.rid)===r.uuid&&/Seller Central/.test(a.task)),'Sarah gets the Seller Central job');
    ok(_rowOwner(r).finished,'finished');ok(!onSarahActive(r),'off her list');
  };

  /* 24 · a card that asks for a date draws its date box (b572: the splitter kept only the buttons) */
  S['late-order card has its date box']=async()=>{
    who('Jack');goPage('jack');let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);renderJack();await wait(400);
    const cards=[...document.querySelectorAll('.jkCard')].filter(k=>/LATE ORDER/.test((k.querySelector('.jkType')||{}).textContent));
    if(!cards.length)return;   /* nothing late today — nothing to prove */
    cards.forEach(k=>{ok(k.querySelector('input.jkAnsDate'),'the date box is on the card');ok([...k.querySelectorAll('button')].some(b=>/New date/.test(b.textContent)),'New date — done is there');});
  };

  /* 25 · a question about missing stock closes itself once all the stock is in */
  S['stock answers an open question']=async()=>{
    const r=mkRow({exp:10,rcvd:10,ship:0,status:'In Warehouse',resolution:asked()});
    ok(!onJack(r),'not on Jack’s page');ok(!onSarahActive(r),'not on Sarah’s');
    eq(r.resolution.state,'approved','filed');eq(r.resolution.what,'stock-answered','for the right reason');ok(_rowOwner(r).finished,'finished');
    const p=mkRow({exp:10,rcvd:4,ship:0,status:'In-Transit',resolution:asked()});
    ok(onJack(p),'still owed → still Jack’s question');
  };

  /* 26 · a gated row whose units went to Recovery Stock files itself; the Prep Sheet names whose a row is */
  S['recovery files the old gated row · row state tag']=async()=>{
    const r=mkRow({exp:1,rcvd:1,ship:0,status:'Issue',notes:'Gated'});
    mkClaim({prepRowId:r.uuid,sku:r.sku,prod:r.prod,issT:'Gated',cst:'Resolved',oid:r.oid,log:[{t:'07/09 19:16',msg:'Sent to Recovery Stock — 1 × CHECK (Jack)'}]});
    ok(_recoveryClaim(r),'the claim is recognised');ok(_rowStateTag(r)&&/Recovery/.test(_rowStateTag(r).t),'tag says Recovery');
    _adminItems();ok(r.archived,'filed');ok(/Recovery Stock/.test(r.notes),'note says where it went');
    const s=mkRow({exp:5,rcvd:0,date:'01/08',resolution:asked({state:'rejected',rejectNote:'x',rejectedBy:'Jack'})});
    eq((_rowStateTag(s)||{}).t,'Jack answered — Sarah closes','tag says whose it is');
    const j=mkRow({exp:5,rcvd:0,resolution:asked()});eq((_rowStateTag(j)||{}).t,'With Jack','with Jack');
  };

  /* 27 · a live issue flag with nothing open on it is Sarah's; a closed row loses its flag */
  S['a flag on the row is somebody\u2019s job']=async()=>{
    who('Becki');
    const r=mkRow({exp:2,rcvd:0,status:'In-Transit',date:'06/09',issueType:'Not Arrived',issueQty:2});
    eq(_rowOwner(r).owner,'sarah','flagged, nothing open → Sarah');ok(/^flagged/.test(_rowOwner(r).why),'the reason names the flag');
    ok(onSarahActive(r),'on Sarah’s active list');eq((_rowStateTag(r)||{}).t,'Flagged — Sarah','the Prep Sheet row says so');
    /* an open claim is the job instead — not the flag */
    const c2=mkRow({exp:2,rcvd:0,status:'In-Transit',issueType:'Damaged',issueQty:1});
    mkClaim({prepRowId:c2.uuid,sku:c2.sku,issT:'Damaged',cst:'Raised',owner:'VA'});
    eq(_liveFlag(c2),'','an open claim outranks the flag');
    /* the row closes → the flag goes on the next save */
    const d=mkRow({exp:2,rcvd:1,ship:1,status:'Sent to Amazon',issueType:'Missing',issueQty:1,
      resolution:{state:'approved',kind:'ops',what:'refund-done',approvedBy:'Jack',approvedAt:iso()}});
    await saveRow(d);
    eq(d.issueType,'','stale flag cleared when the row is closed');ok(_rowOwner(d).finished,'and it is finished');
  };
  /* 28 · closing the arrival does not account for units that never shipped */
  S['closed arrived-ok still owes the units it never shipped']=async()=>{
    const r=mkRow({exp:70,rcvd:70,ship:23,status:'Part Sent',date:'25/08',sentDate:'2026-08-27',
      shipSegments:[{shipId:'FBA-CHK-A',units:23,date:'2026-08-27',type:'Standard'}],allShipIds:['FBA-CHK-A'],
      resolution:{state:'approved',kind:'ops',what:'arrived-ok',approvedBy:'Sarah',approvedAt:iso()}});
    ok(!_rowOwner(r).finished,'not finished — 47 never went anywhere');
    eq(_rowOwner(r).owner,'sarah','it is Sarah’s to settle');ok(onSarahActive(r),'on her list');
    ok(_partShipStale(r),'and the Prep Sheet asks the warehouse');
  };

  /* 29 · a Not-Arrived claim closed "Refund received" settles the row and files it */
  S['a refunded claim settles its row']=async()=>{
    const r=mkRow({exp:2,rcvd:0,ship:0,status:'In-Transit',date:'06/09',issueType:'Not Arrived',issueQty:2});
    const cl=mkClaim({prepRowId:r.uuid,sku:r.sku,issT:'Not Arrived',dif:2,exp:2,claimValue:58.98,cst:'Resolved',
      raisedBy:'Jack',raisedAt:'2026-09-20',resolvedAt:'2026-09-20',log:[{t:'20/09 17:17',msg:'Refund received — closed by Jack'}]});
    ok(_claimSettledRow(r),'the row settles off its own claim');
    eq(parseInt(r.cancelledQty),2,'2 units taken off — not coming');eq(_owedUnits(r),0,'nothing owed');
    eq(r.issueType,'','the red flag is gone');eq(r.resolution.what,'refund-done','closed as refund-done');
    ok(r.archived,'nothing ever landed → filed');
    await wait(500);ok(cl.settledOnRow,'the claim is stamped so it runs once — after the row is saved (13 Oct)');
    ok(!onSarahActive(r)&&!onJack(r),'off both lists');
    /* a DAMAGED claim must not take units off — the stock is here */
    const d=mkRow({exp:5,rcvd:5,ship:0,status:'In Warehouse'});
    mkClaim({prepRowId:d.uuid,sku:d.sku,issT:'Damaged',dif:2,cst:'Resolved',log:[{t:'x',msg:'Refund received — closed by Jack'}]});
    ok(!_claimSettledRow(d),'damaged stock stays on the row');
  };

  /* 30 · raise an issue, Sarah closes it wrong-SKU — and the units that arrived but never shipped are accounted for too */
  S['wrong-SKU close settles units that never shipped']=async()=>{
    const r=mkRow({exp:70,rcvd:70,ship:23,status:'Part Sent',date:'25/08',sentDate:'2026-08-27',
      shipSegments:[{shipId:'FBA-CHK-A',units:23,date:'2026-08-27',type:'Standard'}],allShipIds:['FBA-CHK-A']});
    eq(remainingToShip(r),47,'47 look like they are still on the shelf');
    r.resolution={state:'approved',kind:'ops',what:'wrong-sku',wentAs:'Tesco_CHK_OLD',by:'Sarah',at:iso()};
    const out=_settleClosedUnits(r,'wrong-sku');
    ok(out.changed,'the close changed the numbers');ok(/went out under Tesco_CHK_OLD/.test(out.note),'the note names the SKU');
    eq(remainingToShip(r),0,'nothing left on this row to send');eq(r.status,'Sent to Amazon','status follows');
    eq(parseInt(r.cancelledQty)||0,0,'nothing pretended to be cancelled');eq(parseInt(r.rcvd),70,'all 70 still recorded as arrived');
    ok(!_partShipStale(r),'and it stops asking the warehouse');ok(_rowOwner(r).finished,'finished');
    /* the Wella shape must not change: 4 arrived of 20, 16 traced to another SKU — the 4 are still sendable */
    const w=mkRow({exp:20,rcvd:4,ship:0,cancelledQty:16,status:'In Warehouse',
      resolution:{state:'approved',kind:'ops',what:'wrong-sku',wentAs:'OTHER',wentAsQty:16,by:'Sarah',at:iso()}});
    eq(sendableQty(w),4,'units that never arrived do not eat the shelf');
  };

  /* 31 · Restocks flags a part used in more than one product — and only then */
  S['Restocks: shared part badge']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    ok(LV3.usedIn,'helper present');
    /* find one shared and one single-use part from the real build lists */
    const counts={};D_products().forEach(p=>(p.recipe||[]).forEach(r=>{counts[String(r.c)]=(counts[String(r.c)]||new Set()).add(p.id);}));
    const ids=Object.keys(counts);
    const shared=ids.find(k=>LV3.usedIn(k).length>1),single=ids.find(k=>LV3.usedIn(k).length===1);
    if(shared){ok(LV3.usedInBadge({id:shared,name:'x'}),'badge on a shared part');ok(/Used in \d+ Products/.test(LV3.usedInBadge({id:shared,name:'x'})),'says how many');}
    if(single)eq(LV3.usedInBadge({id:single,name:'x'}),'','no badge on a single-use part');
    ok(shared||single,'there were build lists to check against');
  };

  /* 32 · adding the other product to the plan makes the order cover the shared part, and the badge says so */
  S['Restocks: Add to plan covers a shared part']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const prods=D_products().filter(p=>!p.archived&&(p.recipe||[]).length);
    let cid=null,a=null,b=null;
    for(const p of prods){for(const r of p.recipe){const us=LV3.usedIn(r.c);if(us.length===2){cid=r.c;a=us[0];b=us[1];break;}}if(cid)break;}
    if(!cid)return;   /* no two-product part in today's data — nothing to prove */
    const was=(LV3.__rsPicks?LV3.__rsPicks():null);
    try{
      LV3.rsSet(a.id);await wait(200);
      ok(/Used in 2 Products/.test(LV3.usedInBadge({id:cid})),'amber while only one of the two is planned');
      LV3.usedInAdd(b.id);await wait(200);
      ok(/All 2 in this plan/.test(LV3.usedInBadge({id:cid})),'covered once both are planned');
    }finally{LV3.rsDrop(a.id);LV3.rsDrop(b.id);LV3.usedInShut();}
  };

  /* 33 · stock to hold, per product: default follows Settings; setting one moves only that product */
  S['per-product stock to hold']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const ps=D_products().filter(p=>!p.archived&&p.type==='bundle');if(ps.length<2)return;
    const [a,b]=ps;const def=LV3.coverDaysOf(b);
    try{
      LV3.coverSet(a.id,30);eq(LV3.coverDaysOf(a),30,'the product holds 30 days');eq(LV3.coverDaysOf(b),def,'another product is untouched');
      LV3.coverSet(a.id,0);eq(LV3.coverDaysOf(a),def,'back to the default');
    }finally{LV3.coverSet(a.id,0);}
  };

  /* 34 · a product set to hold fewer days buys fewer parts — its share only */
  S['stock to hold reaches part buying']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const L0=LV3.__planComponents();
    /* a part fed by exactly one product with sales */
    const pick=L0.find(L=>!L.isProd&&L.drivers&&L.drivers.length===1&&L.want>0);if(!pick)return;
    const p=D_products().find(x=>!x.archived&&(x.recipe||[]).some(r=>String(r.c)===String(pick.o.id)));if(!p)return;
    try{
      LV3.coverSet(p.id,30);
      const L1=LV3.__planComponents().find(L=>L.o&&String(L.o.id)===String(pick.o.id));
      ok(L1&&L1.want<pick.want,'30 days of stock → a smaller part target ('+pick.want+' → '+(L1&&L1.want)+')');
    }finally{LV3.coverSet(p.id,0);}
    const L2=LV3.__planComponents().find(L=>L.o&&String(L.o.id)===String(pick.o.id));
    eq(L2.want,pick.want,'back to the default puts it back exactly');
  };

  /* 35 · the Buy cell says what to buy if the other products sharing the part are covered too */
  S['Restocks: cover-the-others line']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const ps=D_products().filter(p=>!p.archived&&p.type==='bundle');
    let a=null,b=null,cid=null;
    for(const p of ps){for(const r of (p.recipe||[])){const us=LV3.usedIn(r.c);if(us.length===2){cid=r.c;a=p;b=us.find(x=>x.id!==p.id);break;}}if(cid)break;}
    if(!cid)return;
    const row=()=>[...document.querySelectorAll('#lav3View .rsTbl tbody tr')].find(tr=>tr.querySelector('.usedIn')&&tr.querySelector('.usedIn').getAttribute('onclick').includes(String(cid)));
    try{
      LV3.go('restocks');await wait(300);LV3.rsSet(a.id);await wait(400);
      const r1=row();ok(r1,'the shared part is on the list');
      const also=r1&&r1.querySelector('.rsAlso');ok(also,'the cover-the-others line is there');
      LV3.usedInAdd(b.id);await wait(400);
      const r2=row();ok(r2&&!r2.querySelector('.rsAlso'),'gone once the other product is in the plan');
    }finally{LV3.rsDrop(a.id);LV3.rsDrop(b.id);LV3.usedInShut();}
  };

  /* 36 · one click on the line buys that part for the other products too — that part only */
  S['Restocks: click the line to cover the others']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const ps=D_products().filter(p=>!p.archived&&p.type==='bundle');
    let a=null,cid=null;
    for(const p of ps){for(const r of (p.recipe||[])){const us=LV3.usedIn(r.c);if(us.length===2){cid=r.c;a=p;break;}}if(cid)break;}
    if(!cid)return;
    const row=()=>[...document.querySelectorAll('#lav3View .rsTbl tbody tr')].find(tr=>tr.querySelector('.usedIn')&&tr.querySelector('.usedIn').getAttribute('onclick').includes(String(cid)));
    const nRows=()=>document.querySelectorAll('#lav3View .rsTbl tbody tr').length;
    try{
      LV3.go('restocks');await wait(300);LV3.rsSet(a.id);await wait(400);
      const r1=row(),line=r1&&r1.querySelector('button.rsAlso');if(!line)return;   /* the part is already covered today */
      const want=(line.textContent.match(/(\d[\d,]*)\s+(cases?|units)/)||[])[1];const rows1=nRows();
      LV3.rsAlso(cid);await wait(400);
      const r2=row();const big=r2&&r2.querySelector('.rsBig');
      eq(big&&big.textContent.trim(),want,'the Buy figure becomes the covered number');
      ok(r2.querySelector('button.rsAlso.ok'),'the line says it is included, with undo');
      eq(nRows(),rows1,'no other parts were added to the order');
      ok(document.querySelector('#lav3View .rsMx')&&/COG \/ unit/.test(document.querySelector('#lav3View .rsMx').textContent),'COG per unit is on the header');
      LV3.rsAlso(cid);await wait(300);ok(row().querySelector('button.rsAlso:not(.ok)'),'undo puts it back');
    }finally{LV3.rsDrop(a.id);}
  };

  /* 37 · the purchase sheet: a different quantity is a new purchase; only a line that REPLACED one on the sheet is a correction */
  S['purchase sync: separate vs corrected vs identical']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D();const prodW=D.products.find(p=>!p.archived&&(p.recipe||[]).length);if(!prodW)return;
    const cid=prodW.recipe[0].c;
    const day=new Date().toISOString().slice(0,10),TAB='Lavarion Q3',SUP='CHECK SUP',NM='CHECK Nairn Bites';
    const row=(qty,extra)=>Object.assign({tab:TAB,date:day,name:NM,qty,price:0.9,sup:SUP,oid:'',acct:'',invoice:'',notes:'',spend:+(qty*0.9).toFixed(2),mismatch:0},extra||{});
    const clean=()=>{const A=LV3.__D().purchases;for(let i=A.length-1;i>=0;i--)if(A[i].sup===SUP)A.splice(i,1);
      D.components.concat(D.products).forEach(o=>{if(o.layers)o.layers=o.layers.filter(l=>!String(l.src||'').startsWith('P:chk-'));});};
    const seed=()=>{clean();LV3.__D().purchases.push({id:'chk-q1',uuid:null,tab:TAB,date:day,name:NM,qty:32,price:0.9,sup:SUP,oid:'',loc:'Warehouse',arr:0,
      alloc:[{to:cid,qty:32}],acct:'',invoice:'',notes:'',spend:28.8,mismatch:0});};
    const mine=()=>LV3.__D().purchases.filter(p=>p.sup===SUP);
    const q=()=>LV3.__D().purchases.find(p=>p.id==='chk-q1');
    const run=async rows=>{window.__lavSheetRowsHook=t=>t===TAB?rows:null;try{await LV3.syncPurchases();}finally{delete window.__lavSheetRowsHook;}};
    try{
      seed();await run([row(32),row(20)]);
      eq(q().qty,32,'A: the line already on order is untouched');
      const n20=mine().find(p=>p.id!=='chk-q1'&&p.qty===20);ok(n20,'A: the 20 comes in as its own purchase');
      ok(!(n20.alloc||[]).length,'A: waiting to be linked like any new line');
      seed();await run([row(20)]);
      eq(q().qty,20,'B: the existing purchase takes the sheet\u2019s new figure');
      eq(q().alloc[0].qty,20,'B: its stock follows');
      eq(mine().length,1,'B: nothing doubled');
      seed();await run([row(20),row(1)]);
      eq(q().qty,32,'C: not clear which one replaced it — the old line is left alone');
      eq(mine().filter(p=>p.id!=='chk-q1').length,2,'C: both new lines come in');
      seed();await run([row(32),row(32)]);
      const d2=mine().filter(p=>p.id!=='chk-q1');eq(d2.length,1,'D: the second identical line comes in');
      ok(!d2[0].dupCheck,'D: no flag, no question — just a second purchase (dup logic retired 13 Oct)');
      /* E · the invoice/order number changed on the sheet (Becki, 23 Sep) → corrected in place, not doubled */
      seed();await run([row(32,{oid:'INV-NEW-1'})]);
      eq(mine().length,1,'E: an order-number change does not double the purchase');eq(q().oid,'INV-NEW-1','E: the new order number is taken');eq(q().qty,32,'E: same units');
      /* F · a typo fixed in the name and the quantity changed → corrected in place */
      seed();await run([row(30,{name:'CHECK Nairn Bites.'})]);
      eq(mine().length,1,'F: a renamed line does not double');eq(q().qty,30,'F: new quantity');
    }finally{clean();}
  };

  /* 38 · browser storage full (27 Sep 2026: another app on the address filled the shared ~5 MB pot and
     Sourcing's saves failed with nothing on screen). Fakes a full pot and proves PrepHub carries on:
     our own throw-away copy goes first, the login is still kept, the fee rates still reach the database,
     a Restocks pick still holds, the red bar shows — and the slim hub copy reads exactly like the full one. */
  S['browser storage full: login, fee rates and Restocks carry on, bar shows']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const LS=window.localStorage,real=(typeof Storage!=='undefined'&&LS instanceof Storage);
    const tgt=real?Storage.prototype:LS,orig=tgt.setItem;
    const full=()=>{throw new DOMException('The quota has been exceeded.','QuotaExceededError');};
    const barOff=()=>{const b=document.getElementById('lsFullBar');if(b)b.remove();_lsFull=false;};
    const memBefore=Object.keys(LS_MEM),hubWas=LS.getItem('lv3_hub_sales'),barWas=!!document.getElementById('lsFullBar');
    const ownFrom=Object.prototype.hasOwnProperty.call(sb,'from'),oldFrom=sb.from;
    const D=LV3.__D(),pk=D.products.find(p=>!p.archived&&!(LV3.rsPicked?LV3.rsPicked():[]).some(x=>x.id===p.id));
    try{
      /* A · our own copy of the hub report is the first thing to go */
      barOff();orig.call(LS,'lv3_hub_sales','{"months":[]}');
      tgt.setItem=function(k,v){if(LS.getItem('lv3_hub_sales')!=null)full();return orig.call(this,k,v);};
      ok(lsSet('ph_chk_a','1')===true,'A: the save lands once our own copy is cleared');
      ok(LS.getItem('lv3_hub_sales')==null,'A: the throw-away hub copy went first');
      ok(!document.getElementById('lsFullBar'),'A: no bar — nothing was lost');
      /* B · truly full: held in memory for this tab, and the bar says so */
      tgt.setItem=full;
      ok(lsSet('ph_chk_b','held')===false,'B: the browser refused');
      eq(lsGet('ph_chk_b'),'held','B: the value is held in memory');
      ok(document.getElementById('lsFullBar'),'B: the red bar shows');
      /* C · the login — the one thing a full pot really broke */
      ok(sb.auth.storage===PH_AUTH_STORE,'C: the live login is kept through the guard');
      const sess={access_token:'chk',refresh_token:'chk',token_type:'bearer',expires_in:3600,
        expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'chk',aud:'authenticated'}};
      const mk=o=>supabase.createClient(SUPA_URL,SUPA_KEY,{auth:Object.assign({persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},o)});
      let threw=false;try{await mk({storageKey:'ph-chk-auth-old'}).auth._saveSession(sess);}catch(e){threw=true;}
      ok(threw,'C: control — the old setup could NOT keep a login with the pot full');
      const cl=mk({storageKey:'ph-chk-auth',storage:PH_AUTH_STORE});
      await cl.auth._saveSession(sess);
      const got=(await cl.auth.getSession()).data.session;
      ok(got&&got.access_token==='chk','C: with the guard the login is kept');
      /* D · prep fee rates still reach the database (recorded here, nothing sent) */
      const sent=[];sb.from=t=>({upsert:row=>{sent.push({t,row});return Promise.resolve({error:null});}});
      savePrepFees();
      ok(sent.some(x=>x.t==='app_settings'&&x.row&&x.row.key==='prep_fees'),'D: the fee rates still go to the database');
      /* E · a Restocks pick holds for this tab */
      if(pk){LV3.rsSet(pk.id);
        ok(String(lsGet('lav3_restock_picks')||'').includes(String(pk.id)),'E: the Restocks pick is held');}
      /* F · the slim hub copy reads exactly like the full report */
      const R=[{asin:'B0CHK00001',name:'Old name',units:5,profit:9,camps:[1,2]},{asin:' b0chk00002 ',name:'Two',units:0},{asin:'',name:'no asin',units:3},{asin:'B0CHK00003',units:null}];
      const raw={months:[{id:'2026-07',label:'Jul',rows:R},{ym:'2026-08',label:'Aug',rows:[{asin:'B0CHK00001',name:'New name',units:7,fees:1},{asin:'B0CHK00004',name:'',units:2}]}],_at:'x'};
      const t=LV3.__hubTest(raw);ok(t.same,'F: the slim copy gives the same units, months and names');
      let live=null;try{live=await LV3.__hubGet();}catch(e){}
      if(live){const tl=LV3.__hubTest(live);ok(tl.same,'F: the live hub report reads the same from the slim copy');
        ok(tl.slim<tl.full/4,'F: the slim copy is far smaller ('+tl.full+' → '+tl.slim+')');}
    }finally{
      tgt.setItem=orig;
      if(ownFrom)sb.from=oldFrom;else delete sb.from;
      if(pk&&LV3.rsDrop)LV3.rsDrop(pk.id);
      Object.keys(LS_MEM).filter(k=>!memBefore.includes(k)).forEach(k=>delete LS_MEM[k]);
      ['ph_chk_a','ph_chk_b','ph-chk-auth','ph-chk-auth-old'].forEach(lsDel);
      if(hubWas!=null)orig.call(LS,'lv3_hub_sales',hubWas);else LS.removeItem('lv3_hub_sales');
      if(!barWas)barOff();
    }
  };

  /* 39 · order numbers are click-to-copy text everywhere (Jack, 30 Sep: "copyable text, like on Jack's sheet and the Prep Sheet") */
  S['order numbers: click to copy, never a link']=async()=>{
    const h=oidHtml('402-4549727-3386732','Amazon Italy','EU 02');
    ok(!/href=/.test(h),'no link out, even on an Amazon order');
    ok(h.includes("copyVal('402-4549727-3386732'"),'a click copies the number');
    ok(h.includes('>402-4549727-3386732<'),'the number shows as plain text');
    ok(oidHtml('9517155567','Notino').includes("copyVal('9517155567'"),'Notino copies too');
    eq(oidHtml(''),'','no order number → nothing');
    ok(!oidHtml("12'3<b>").includes('<b>'),'odd characters are escaped');
    const box=document.createElement('div');box.innerHTML=oidHtml("AB'1");
    ok(box.firstChild&&box.firstChild.getAttribute('onclick').includes("copyVal('AB\\'1'"),'a quote in the number cannot break the click');
  };

  /* 40 · a claim with Jack can be written off from his page (Jack, 30 Sep, on Bob's Red Mill: "way for us to write it off") */
  S['claim write-off from Jack’s Admin']=async()=>{
    who('Jack');
    const r=mkRow({exp:36,rcvd:36,ship:36,status:'Sent to Amazon',issueType:'Damaged',issueQty:2});
    const c=mkClaim({prepRowId:r.uuid,sku:r.sku,prod:r.prod,issT:'Damaged',dif:2,exp:36,claimValue:7.12,cst:'Chasing',owner:'Jack',
      sentToJack:{by:'Sarah',at:iso()},oid:r.oid,sup:r.sup});
    const onJackC=()=>(jackTodo().claimsQ||[]).some(x=>String(x.id)===String(c.id));
    ok(onJackC(),'the claim is on Jack’s page');
    eq(_rowOwner(r).owner,'jack','its row waits on Jack');
    jackClaimWriteOff(c.id);await wait(50);confirmOk();await wait(400);
    eq(c.cst,'Resolved','claim closed');eq(c.reimbursed,'Write-off','recorded as a Write-off');ok(c.archived,'filed off the active claims');
    ok(/Written off — 2 units · £7\.12/.test(String(((c.log||[]).slice(-1)[0]||{}).msg||'')),'the loss is on the claim’s story');
    ok(!onJackC(),'off Jack’s page');
    ok(_rowOwner(r).finished,'its Prep Sheet row counts as finished');ok(!onSarahActive(r),'nothing lands on Sarah');
  };

  /* 41 · the prep-fee loop (v52.9): the Dashboard asked the database ~13×/second, all day.
     Redrawing the Dashboard must not ask again within 10 minutes, and an unchanged answer must not redraw. */
  S['prep fees: no request loop, redraw only on a real change']=async()=>{
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from,asked=[];let reply={data:{value:JSON.stringify(prepFees)},error:null};
    const keepFees=JSON.stringify(prepFees),keepAt=_pfAskedAt;let draws=0;const rd=window.renderDashboard;
    sb.from=t=>{const q={select:()=>q,eq:(k,v)=>{asked.push(t+':'+v);return q;},maybeSingle:()=>Promise.resolve(reply),
      upsert:()=>Promise.resolve({error:null})};return q;};
    window.renderDashboard=function(){draws++;};
    try{
      _pfAskedAt=0;loadPrepFees();await wait(30);
      eq(asked.length,1,'first look asks the database once');eq(draws,0,'same rates → no redraw');
      for(let i=0;i<20;i++)loadPrepFees();await wait(30);
      eq(asked.length,1,'twenty more redraws inside 10 minutes ask nothing');
      _pfAskedAt=Date.now()-11*60*1000;reply={data:{value:JSON.stringify(Object.assign({},prepFees,{boxCost:(+prepFees.boxCost||0)+1}))},error:null};
      loadPrepFees();await wait(30);
      eq(asked.length,2,'after 10 minutes it asks again');eq(draws,1,'a changed rate redraws once');
      loadPrepFees();await wait(30);eq(asked.length,2,'and the redraw does not ask again');
      _pfAskedAt=0;const before=JSON.stringify(prepFees);let seeded=0;
      sb.from=t=>{const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:null,error:{message:'timeout'}}),
        upsert:()=>{seeded++;return Promise.resolve({error:null});}};return q;};
      loadPrepFees();await wait(30);
      eq(seeded,0,'a failed read never overwrites the shared rates');eq(JSON.stringify(prepFees),before,'rates untouched');
    }finally{
      if(own)sb.from=orig;else delete sb.from;window.renderDashboard=rd;
      prepFees=JSON.parse(keepFees);lsSet('prepFees',keepFees);_pfAskedAt=keepAt;
    }
  };

  /* 42 · the Recovery Stock ping-pong (Oct 2026): Sync put Recovery-filed rows back, every load filed them again —
     72 times on one row. The sheet must leave them filed, and refiling never stacks the note or the audit line. */
  S['Recovery-filed rows stay filed; no note pile-up']=async()=>{
    const r=mkRow({exp:9,rcvd:9,ship:0,status:'In Warehouse'});
    mkClaim({prepRowId:r.uuid,sku:r.sku,prod:r.prod,issT:'Gated',cst:'Resolved',oid:r.oid,log:[{t:'07/09 19:16',msg:'Sent to Recovery Stock — 9 × CHECK (Jack)'}]});
    const plain=mkRow({exp:2,rcvd:0,archived:true});
    let audits=0;const la=window.logAudit;window.logAudit=function(a){if(/Recovery Stock/.test(String(a)))audits++;};
    try{
      ok(_recoveryFiled(r),'filed once');ok(r.archived,'archived');
      ok(_syncKeepClosed(r),'the sheet sync leaves a Recovery-filed row alone');
      ok(!_syncKeepClosed(plain),'an ordinary archived row can still come back from the sheet');
      for(let i=0;i<5;i++){r.archived=false;_recoveryFiled(r);}
      eq((String(r.notes).match(/→ Recovery Stock \(gated/g)||[]).length,1,'five refilings → still one note line');
      eq(audits,1,'and one audit line');ok(r.archived,'still filed');
    }finally{window.logAudit=la;}
  };
  /* 43 · the database watchdog (Oct 2026): a loop must put up the red bar, a normal burst must not */
  S['database watchdog: a loop shows the bar, a Sync burst does not']=async()=>{
    const keep=JSON.stringify(DBW),bar=()=>document.getElementById('dbwBar');
    const off=()=>{const b=bar();if(b)b.remove();};
    try{
      off();Object.assign(DBW,{min:0,n:0,by:{},run:0,tripped:false,paused:false});
      for(let i=0;i<120;i++)_dbwTick('https://x.supabase.co/rest/v1/prep_rows?id=eq.'+i);
      ok(!DBW.tripped&&!bar(),'a 120-request Sync burst is normal — no bar');
      for(let i=0;i<300;i++)_dbwTick('https://x.supabase.co/rest/v1/app_settings?select=value&key=eq.prep_fees');
      ok(DBW.tripped&&bar(),'400 in a minute → the red bar');
      ok(/app_settings prep_fees/.test(bar().textContent),'and it names what is being asked for');
      Object.assign(DBW,{min:0,n:0,by:{},run:0,tripped:true});
      await sb.from('app_settings').select('key').eq('key','prep_fees').maybeSingle();
      ok((DBW.by['app_settings prep_fees']||0)>=1,'real database requests are counted');
    }finally{off();Object.assign(DBW,JSON.parse(keep));}
  };

  /* 44 · PLUB settings: a laptop opened before someone else's change must not write its stale copy back
     (Oct 2026: Sarah's 12 Oct Stock at Amazon count lost; the screen said 5 Oct). */
  S['PLUB settings: a stale laptop never overwrites a newer count']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const M=LV3.__prefsMerge;
    const base={atAmz:{A:5,B:7},atAmzAt:{A:'2026-10-05T13:55',B:'2026-10-05T13:55'},acSnooze:{},targetDays:60,cols:{x:1}};
    const sarah={atAmz:{A:12,B:9},atAmzAt:{A:'2026-10-12T09:00',B:'2026-10-12T09:00'},acSnooze:{},targetDays:60};
    const becki=JSON.parse(JSON.stringify(base));becki.acSnooze={Z:'2026-10-20'};
    const m=M(sarah,becki,base);
    eq(m.atAmz.A,12,'Sarah’s newer count survives Becki’s save');eq(m.atAmzAt.B,'2026-10-12T09:00','and its date');
    eq(m.acSnooze.Z,'2026-10-20','Becki’s own change still lands');ok(m.cols&&m.cols.x===1,'local-only defaults are kept');
    const del=M({acSnooze:{Q:1,Z:2}},{acSnooze:{Q:1}},{acSnooze:{Q:1,Z:2}});ok(!('Z' in del.acSnooze),'a deletion made here goes through');
    const keepDel=M({acSnooze:{Q:1}},{acSnooze:{Q:1,Z:2}},{acSnooze:{Q:1,Z:2}});ok(!('Z' in keepDel.acSnooze),'a deletion made elsewhere is not undone');
    /* end to end through savePrefs, with the database faked */
    const D=LV3.__D(),keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase();
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null,readErr=false;
    sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,
      maybeSingle:()=>Promise.resolve(readErr?{data:null,error:{message:'timeout'}}:{data:{value:JSON.stringify(Object.assign({},JSON.parse(keepS),sarah))},error:null}),
      upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
    try{
      LV3.__setPrefsBase(Object.assign(JSON.parse(keepS),base));
      Object.assign(D.settings,JSON.parse(JSON.stringify(becki)));
      ok(await LV3.__savePrefs(),'the save reports it landed');
      eq(wrote.atAmz.A,12,'written: Sarah’s count, not the stale one');eq(wrote.acSnooze.Z,'2026-10-20','written: Becki’s snooze');
      eq(D.settings.atAmz.A,12,'and Becki’s screen now shows Sarah’s count');
      readErr=true;wrote=null;D.settings.targetDays=45;
      ok(!(await LV3.__savePrefs()),'a failed read reports failure');ok(wrote===null,'and writes nothing over the shared copy');
    }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));LV3.__setPrefsBase(keepB);
      document.querySelectorAll('.toast').forEach(t=>{if(/Didn.t save/.test(t.textContent))t.remove();});}
  };
  /* 45 · the PLUB activity log is merged, never overwritten by another laptop's copy */
  S['PLUB log: one laptop cannot wipe another’s lines']=async()=>{
    const D=LV3.__D(),keepLog=D.log.slice();
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
    const theirs={t:new Date(Date.now()-60000).toISOString(),k:'edit',txt:'CHECK Stock at Amazon counted 12 Oct — 41 products',who:'Sarah'};
    sb.from=t=>{const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:{value:JSON.stringify({log:[theirs].concat(keepLog.slice(0,5)),ack:{}})},error:null}),
      upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
    try{
      D.log.unshift({t:new Date().toISOString(),k:'recv',txt:'CHECK received 64 × thing',who:'Becki'});
      LV3.__saveState();await wait(1700);
      ok(wrote,'the log was saved');
      ok(wrote.log.some(l=>l.txt===theirs.txt),'Sarah’s line from the other laptop survives');
      ok(wrote.log.some(l=>/CHECK received 64/.test(l.txt)),'Becki’s new line is there too');
      eq(wrote.log.filter(l=>l.txt===theirs.txt).length,1,'no duplicates');
    }finally{if(own)sb.from=orig;else delete sb.from;D.log.length=0;keepLog.forEach(l=>D.log.push(l));}
  };
  /* 46 · a promised date that slips comes back to Sarah, even after Jack's "still coming" answer (Logitech X56, Oct 2026) */
  S['promised date: parked until the date, then Sarah’s chase']=async()=>{
    const past=new Date(Date.now()-12*864e5).toISOString().slice(0,10),fut=new Date(Date.now()+18*864e5).toISOString().slice(0,10);
    const mk=d=>mkRow({exp:6,rcvd:3,ship:3,status:'Part Sent',sup:'Amazon UK',expectedDelivery:d,
      resolution:{state:'approved',kind:'ops',what:'in-transit',by:'Sarah',answeredBy:'Jack',
        chase:{path:'never-arrived',step:'due-date',due:d,log:[{at:iso(),by:'Jack',what:'Amazon says it will arrive '+d+' — parked until then'}]}}});
    const park=mk(fut),slip=mk(past);
    eq(_rowOwner(park).owner,'none','future date → parked, nobody’s list');ok(!_rowOwner(park).finished,'parked is not finished');
    ok(!onSarahActive(park)&&!onJack(park),'not on either page while parked');
    eq(_rowOwner(slip).owner,'sarah','date passed → Sarah');
    ok(onSarahActive(slip),'on Sarah’s list to chase');ok(!onJack(slip),'not on Jack’s');
    eq(slip.resolution.state,'working','her list picks it up as a live chase');
  };

  /* 47 · ONE SAVE AT A TIME (13 Oct): two passes at once inserted a brand-new purchase twice — the app-made copies —
     and every pass rewrote all ~390 purchases. A new purchase is inserted once; an unchanged one is never rewritten. */
  S['PLUB saves: no double insert, no rewriting unchanged purchases']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const P=LV3.__PURCH(),own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;
    const ins=[],upd=[];let k=0;
    const fake={id:'chk-new-p',uuid:null,tab:'Lavarion Q3',date:new Date().toISOString().slice(0,10),name:'CHECK race line',qty:3,price:1,sup:'CHECK SUP',oid:'CHK-RACE',loc:'Warehouse',arr:0,alloc:[]};
    sb.from=t=>{const q={select:()=>q,eq:(c,v)=>{q._eq=v;return q;},in:()=>q,
      single:()=>new Promise(r=>setTimeout(()=>r({data:{id:'chk-uuid-'+(++k)},error:null}),120)),
      insert:row=>{if(t==='lavarion_purchases')ins.push(row.name);return q;},
      update:row=>({eq:(c,v)=>({select:()=>{if(t==='lavarion_purchases')upd.push({id:v,row});return Promise.resolve({data:[{id:v}],error:null});}})}),
      delete:()=>({in:()=>Promise.resolve({error:null}),eq:()=>Promise.resolve({error:null})})};return q;};
    try{
      P.push(fake);
      await Promise.all([LV3.__pushNow(),LV3.__pushNow(),LV3.__pushNow()]);await wait(300);
      eq(ins.filter(x=>x==='CHECK race line').length,1,'three saves at once → the new purchase is inserted ONCE');
      ok(fake.uuid&&/^chk-uuid-/.test(fake.uuid),'and it gets its database id');
      eq(upd.filter(x=>x.id!==fake.uuid).length,0,'no unchanged purchase was rewritten');
      fake.notes='changed';LV3.__persist();await wait(1600);
      const mineU=upd.filter(x=>x.id===fake.uuid);
      eq(mineU.length,1,'a real change is written once');
      eq(Object.keys(mineU[0].row).join(','),'meta','and ONLY the column that changed is sent — another laptop\u2019s change to the rest survives');
    }finally{if(own)sb.from=orig;else delete sb.from;const i=P.indexOf(fake);if(i>=0)P.splice(i,1);}
  };
  /* 48 · THE SHEET IS THE TRUTH (13 Oct): one sheet line = one purchase. Copies the app made go on Sync
     (never one with stock booked); Becki's Arrived + Notes follow the sheet onto the line. */
  S['purchase sync mirrors the sheet: copies go, Becki’s notes come through']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),TAB='Lavarion Q3',SUP='CHECK MIRROR',day=new Date().toISOString().slice(0,10);
    const base={tab:TAB,date:day,name:'CHECK Duster',qty:100,price:2.42,sup:SUP,oid:'CHK-UK189',loc:'Warehouse',arr:0,alloc:[],acct:'',invoice:'',notes:'',spend:242,mismatch:0};
    const comp=D.components.find(c=>!c.archived);
    const clean=()=>{for(let i=D.purchases.length-1;i>=0;i--)if(D.purchases[i].sup===SUP)D.purchases.splice(i,1);
      if(comp)comp.layers=(comp.layers||[]).filter(l=>!String(l.src||'').startsWith('P:chk-m'));};
    clean();
    D.purchases.push(Object.assign({},base,{id:'chk-m1',uuid:null}),Object.assign({},base,{id:'chk-m2',uuid:null}),Object.assign({},base,{id:'chk-m3',uuid:null}));
    if(comp){comp.layers=comp.layers||[];comp.layers.push({id:'chk-ml3',src:'P:chk-m3',qty:42,rem:42,arr:1,date:day,sup:SUP,oid:'CHK-UK189'});}
    window.__lavSheetRowsHook=t=>t===TAB?[Object.assign({},base,{notes:'OOS - auto refund on 58 units',sheetArr:'Issue'})]:null;
    try{
      await LV3.syncPurchases();
      const mine=D.purchases.filter(p=>p.sup===SUP);
      eq(mine.length,1,'one sheet line → one purchase: both copies with nothing booked are removed');
      ok(mine.some(p=>p.id==='chk-m3'),'the one kept is the one with stock booked');
      const kept=mine.find(p=>p.notes);
      ok(kept&&kept.notes==='OOS - auto refund on 58 units','Becki’s sheet note comes through');eq(kept&&kept.sheetArr,'Issue','and her Arrived status');
      ok(LV3.sheetSays('CHK-UK189').some(x=>/auto refund/.test(x.notes)),'Jack’s card can read it');
      ok(!D.purchases.some(p=>p.sup===SUP&&p.dupCheck),'no duplicate flags anywhere');
    }finally{delete window.__lavSheetRowsHook;clean();}
  };
  /* 49 · Jack's cards say what Sarah wants; a PLUB shortage closes from his card (13 Oct) */
  S['Jack’s cards: her ask on the tile, shortage auto refunded / written off']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    who('Sarah');const r=mkRow({exp:36,rcvd:36,ship:36,status:'Sent to Amazon'});
    const c=mkClaim({prepRowId:r.uuid,sku:r.sku,prod:r.prod,issT:'Damaged',dif:2,exp:36,claimValue:7.12,cst:'Chasing',owner:'VA',oid:r.oid,sup:r.sup});
    _claimToJackGo(c.id,'Approve a write-off — supplier refused');
    eq(c.sentToJack.ask,'Approve a write-off — supplier refused','her ask is stored');
    who('Jack');goPage('jack');await wait(300);
    const pg=document.getElementById('page-jack').textContent;
    ok(/is asking:\s*Approve a write-off — supplier refused/.test(pg),'and it is on his tile');
    const D=LV3.__D(),comp=D.components.find(x=>!x.archived);
    const mk=id=>({id,src:'',qty:58,rem:0,arr:0,short:1,cost:2.42,date:'2026-09-02',sup:'CHECK SHORT',oid:'CHK-ISS-'+id});
    const la=mk('a'),lb=mk('b');comp.layers=comp.layers||[];comp.layers.push(la,lb);
    try{
      const g=(LV3.supplierIssues()||[]).find(x=>x.key==='o:chk-iss-a');ok(g&&g.short===58,'the shortage shows as 58 short');
      const ra=LV3.settleIssue('o:chk-iss-a','auto');eq(ra.units,58,'auto refunded: 58 units');ok(!la.short&&la.autoRefund,'closed as auto refunded — nothing lost');
      const rb=LV3.settleIssue('o:chk-iss-b','writeoff');eq(rb.units,58,'written off: 58 units');ok(la.writtenOff&&lb.writtenOff&&lb.qty===0,'taken as a loss — no longer incoming');
      ok(!(LV3.supplierIssues()||[]).some(x=>/chk-iss/.test(x.key)),'both off every list');
    }finally{comp.layers=comp.layers.filter(l=>l!==la&&l!==lb);}
  };

  /* 50 · laptops never sit on old code: a newer live build puts up the blue refresh bar; the same build does not */
  S['new version bar: shows for a newer build only']=async()=>{
    const of=window.fetch,off=()=>{const b=document.getElementById('newVerBar');if(b)b.remove();};
    const cur=parseInt(PH_BUILD.slice(1));
    try{
      off();window.fetch=()=>Promise.resolve(new Response('Build: v99 · lav3 · b'+cur));
      eq(await phCheckVersion(true),null,'same build → no bar');ok(!document.getElementById('newVerBar'),'(none shown)');
      window.fetch=()=>Promise.resolve(new Response('Build: v99 · lav3 · b'+(cur+1)));
      eq(await phCheckVersion(true),'b'+(cur+1),'newer build → bar');ok(/new version of PrepHub is live/i.test(document.getElementById('newVerBar').textContent),'it says refresh');
    }finally{window.fetch=of;off();}
  };

  /* 51 · lost links and edited lines (13 Oct): an orphaned batch is re-attached, never rebuilt; an edited sheet
     line merges into the sheet's version without changing stock on the shelf */
  S['PLUB: orphaned stock re-attached, edited line merged']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),comp=D.components.find(x=>!x.archived),day='2026-08-30';
    const P=(id,oid,qty,extra)=>Object.assign({id,uuid:null,tab:'Lavarion Q3',date:day,name:'CHECK Walkers',qty,price:1,sup:'CHECK ORPH',oid,loc:'Warehouse',arr:0,alloc:[{to:comp.id,qty}]},extra||{});
    const keepL=(comp.layers||[]).slice();
    const p1=P('chk-o1','CHK-ORD-1',400);D.purchases.push(p1);
    const orphan={id:'chk-ol1',src:'P:Pm-gone-temp',qty:400,rem:400,arr:1,date:day,sup:'CHECK ORPH',oid:'CHK-ORD-1',cost:1};
    comp.layers=(comp.layers||[]).concat([orphan]);
    try{
      const r=LV3.relinkOrphans();
      ok(r.done.length>=1&&orphan.src==='P:chk-o1','the orphan is re-attached to its own purchase');eq(orphan.qty,400,'no quantity changed');
      /* the edited line: old version received, the sheet's version showing "on order" */
      const oldV=P('chk-o2','CHK-ORD-2',84),newV=P('chk-o3','CHK-ORD-3',84);D.purchases.push(oldV,newV);
      const got={id:'chk-ol2',src:'P:chk-o2',qty:88,rem:88,arr:1,date:day,sup:'CHECK ORPH',oid:'CHK-ORD-2',cost:1};
      const due={id:'chk-ol3',src:'P:chk-o3',qty:84,rem:84,arr:0,date:day,sup:'CHECK ORPH',oid:'CHK-ORD-3',cost:1};
      comp.layers=comp.layers.concat([got,due]);
      const onShelf=()=>comp.layers.filter(l=>l.arr).reduce((t,l)=>t+(l.rem||0),0),onOrder=()=>comp.layers.filter(l=>!l.arr&&!l.short&&!l.writtenOff).reduce((t,l)=>t+(l.qty||0),0);
      const shelf0=onShelf(),order0=onOrder();
      LV3.mergeIntoSheetLine('chk-o2','chk-o3');await wait(50);document.getElementById('cfOk').click();await wait(100);
      ok(!D.purchases.some(p=>p.id==='chk-o2'),'the old line is gone');eq(got.src,'P:chk-o3','its received stock now sits on the sheet’s line');
      eq(onShelf(),shelf0,'stock on the shelf did not change');eq(order0-onOrder(),84,'the phantom 84 "on order" is gone');
    }finally{comp.layers=keepL;for(let i=D.purchases.length-1;i>=0;i--)if(D.purchases[i].sup==='CHECK ORPH')D.purchases.splice(i,1);try{LV3.cm('lav3Ov2');}catch(e){}}
  };

  /* 52 · FIELD-LEVEL SAVES (13 Oct): a save sends only the columns this laptop changed; a change from another
     laptop merges in column by column — Becki's note and Sarah's unsaved count both survive */
  S['Prep rows: only changed columns are saved, other laptops’ changes merge in']=async()=>{
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;const sent=[];
    sb.from=t=>{const q={update:row=>({eq:(c,v)=>({select:()=>{if(t==='prep_rows')sent.push(row);return Promise.resolve({data:[{id:v}],error:null});}})}),
      insert:()=>({select:()=>({single:()=>Promise.resolve({data:{id:'x'},error:null})})}),select:()=>q,eq:()=>q};return q;};
    const r=mkRow({exp:10,rcvd:0,status:'In-Transit'});_setBase(r);
    try{
      ok(await saveRow(r),'an unchanged row saves fine');eq(sent.length,0,'…and writes nothing at all');
      r.rcvd=6;ok(await saveRow(r),'a count saves');
      eq(sent.length,1,'one write');ok('qty_received' in sent[0]&&!('notes' in sent[0])&&!('archived' in sent[0]),'only the changed column(s) — not the note, not archived');
      /* Becki's laptop changes the NOTE while Sarah has an unsaved count of 8 */
      const i=rows.indexOf(r);r.rcvd=8;
      const theirs=Object.assign({},r,{rcvd:6,notes:'2 damaged, kept aside'});const incoming=dbToRow(Object.assign(rowToDb(theirs),{id:r.uuid,created_at:r._ca||''}));
      _rtMergeUpdate(i,incoming);const now=rows[i];
      eq(now.notes,'2 damaged, kept aside','Becki’s note arrives');eq(now.rcvd,8,'Sarah’s unsaved count is kept');
      sent.length=0;ok(await saveRow(now),'Sarah saves');
      ok('qty_received' in sent[0]&&!('notes' in sent[0]),'her save sends the count only — Becki’s note is never overwritten');
    }finally{if(own)sb.from=orig;else delete sb.from;}
  };
  /* 53 · smaller ones (13 Oct): part to Recovery doesn't file the row; "refund confirmed" settles the row;
     → Actions survives the next Sync */
  S['Recovery part, refund confirmed, → Actions']=async()=>{
    const r=mkRow({exp:10,rcvd:10,ship:0,status:'In Warehouse'});
    mkClaim({prepRowId:r.uuid,sku:r.sku,prod:r.prod,issT:'Gated',cst:'Resolved',oid:r.oid,log:[{t:'13/10 10:00',msg:'Sent to Recovery Stock — 4 × CHECK (Jack)'}]});
    ok(!_recoveryFiled(r),'4 of 10 to Recovery — the row is NOT filed');ok(!r.archived,'the 6 on the shelf stay on the Prep Sheet');
    const r2=mkRow({exp:2,rcvd:0,status:'In-Transit'});
    mkClaim({prepRowId:r2.uuid,sku:r2.sku,issT:'Not Arrived',dif:2,exp:2,cst:'Resolved',outcome:'refunded',log:[{t:'x',msg:'Refund confirmed by the supplier — closed by Sarah'}]});
    ok(_refundedClaims(r2).length===1,'"refund confirmed" counts as refunded — the row can settle');
    const r3=mkRow({exp:1,rcvd:0,archived:true,resolution:{state:'approved',kind:'ops',what:'moved-to-actions'}});
    ok(_syncKeepClosed(r3),'a row moved to Actions stays off the Prep Sheet through a Sync');
  };

  /* 54 · the purchase sync, round 2 (13 Oct): removed stays removed; a new line can't take a sibling's purchase;
     a changed date is the same purchase; no quantity = set aside; quantities read properly */
  S['purchase sync: ignored lines, siblings, dates, quantities']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),TAB='Lavarion Q3',SUP='CHECK R2',comp=D.components.find(x=>!x.archived);
    const day=new Date(Date.now()-5*864e5).toISOString().slice(0,10),day2=new Date(Date.now()-6*864e5).toISOString().slice(0,10);
    const row=(name,qty,extra)=>Object.assign({tab:TAB,date:day,name,qty,price:1,sup:SUP,oid:'CHK-O1',acct:'',invoice:'',notes:'',sheetArr:'',spend:qty,mismatch:0},extra||{});
    const mine=()=>D.purchases.filter(p=>p.sup===SUP);
    const clean=()=>{for(let i=D.purchases.length-1;i>=0;i--)if(D.purchases[i].sup===SUP)D.purchases.splice(i,1);
      const k=D.settings.purchKilled||{};Object.keys(k).forEach(x=>{if(/check r2|chk-o1/i.test(x))delete k[x];});};
    const run=async rows=>{window.__lavSheetRowsHook=t=>t===TAB?rows:null;try{await LV3.syncPurchases();}finally{delete window.__lavSheetRowsHook;}};
    try{
      /* a line removed by hand stays removed */
      clean();D.settings.purchKilled=D.settings.purchKilled||{};
      const kr=row('CHECK Gift Bag',50);D.settings.purchKilled[[kr.date,'chk-o1','check gift bag',50].join('|')]={on:day,by:'Becki'};
      await run([kr]);eq(mine().length,0,'an ignored line does not come back');
      /* a new line ABOVE an existing one, same order/qty/price, does not take its purchase */
      clean();D.purchases.push({id:'chk-r2a',uuid:null,tab:TAB,date:day,name:'CHECK Foam Nozzle',qty:12,price:1,sup:SUP,oid:'CHK-O1',loc:'Warehouse',arr:0,alloc:[{to:comp.id,qty:12}],spend:12});
      await run([row('CHECK Pump Bottle',12),row('CHECK Foam Nozzle',12)]);
      ok(mine().some(p=>p.id==='chk-r2a'&&p.name==='CHECK Foam Nozzle'),'the nozzle keeps its own purchase');
      eq(mine().filter(p=>p.name==='CHECK Foam Nozzle').length,1,'the nozzle is not added twice');ok(mine().some(p=>p.name==='CHECK Pump Bottle'),'the pump bottle comes in as its own');
      /* the DATE was edited on the sheet — same purchase, not a second one */
      clean();D.purchases.push({id:'chk-r2b',uuid:null,tab:TAB,date:day,name:'CHECK Walkers',qty:400,price:1,sup:SUP,oid:'CHK-O1',loc:'Warehouse',arr:0,alloc:[],spend:400});
      await run([row('CHECK Walkers',400,{date:day2})]);
      eq(mine().length,1,'a changed date does not double the purchase');eq(mine()[0].date,day2,'the purchase takes the new date');
      /* a line with no quantity is set aside, not imported as 0 */
      clean();await run([row('CHECK No Qty',0,{spend:40})]);eq(mine().length,0,'no quantity → not imported');
    }finally{clean();}
    eq(_sheetQty({'Quantity Bought':'48 (2 cases)'}),48,'"48 (2 cases)" is 48 (was 482)');
    eq(_sheetQty({'Quantity Bought':'2x24'}),48,'"2x24" is 48');
    eq(_sheetQty({'Quantity Bought':'1,200'}),1200,'"1,200" is 1,200');
    eq(_sheetQty({'Quantity Bought':'36'}),36,'a plain number is unchanged');
  };

  /* 55 · STOCK SAFETY (13 Oct): a send goes to Supabase as "take 60 off", never "it is now 240" — and without the
     one-time SQL it falls back to the old way by itself */
  S['stock safety: remaining is sent as a change, not a total']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),comp=D.components.find(x=>!x.archived),keepRpc=LV3.__remRpc();
    const l={id:'chk-ss1',uuid:'chk-ss-uuid',src:'',qty:300,rem:300,arr:1,date:'2026-10-01',sup:'CHECK SS',oid:'CHK-SS',cost:1};
    comp.layers=(comp.layers||[]).concat([l]);LV3.__D();
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from,ownR=Object.prototype.hasOwnProperty.call(sb,'rpc'),origR=sb.rpc;
    const upd=[],rpc=[];let rpcMode='ok';
    sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,single:()=>Promise.resolve({data:{id:'x'},error:null}),
      insert:()=>q,update:row=>({eq:(c,v)=>{if(t==='lavarion_stock_layers'&&v==='chk-ss-uuid')upd.push(row);const p=Promise.resolve({data:[{id:v}],error:null});p.select=()=>Promise.resolve({data:[{id:v}],error:null});return p;}}),
      delete:()=>({in:()=>Promise.resolve({error:null}),eq:()=>Promise.resolve({error:null})})};return q;};
    sb.rpc=(fn,args)=>{rpc.push(args);return Promise.resolve(rpcMode==='ok'?{data:220,error:null}:{data:null,error:{code:'PGRST202',message:'Could not find the function public.lav_add_remaining'}});};
    try{
      LV3.__save();await LV3.__pushNow();await wait(200);              /* the new batch is written once, as a whole */
      upd.length=0;rpc.length=0;LV3.__setRemRpc(null);
      l.rem=240;LV3.__persist();await wait(1600);
      eq(rpc.length,1,'one "take off" call');eq(rpc[0]&&rpc[0].p_delta,-60,'it says −60, not "240"');
      ok(!upd.some(u=>'remaining' in u),'the total is never written over the top');
      eq(l.rem,220,'the screen shows Supabase’s answer — which includes the other laptop’s 20');
      rpcMode='missing';upd.length=0;rpc.length=0;LV3.__setRemRpc(null);
      l.rem=200;LV3.__persist();await wait(1600);
      ok(upd.some(u=>u.remaining===200),'without the SQL it saves the old way — nothing breaks');eq(LV3.__remRpc(),false,'and knows the SQL is not there yet');
    }finally{if(own)sb.from=orig;else delete sb.from;if(ownR)sb.rpc=origR;else delete sb.rpc;LV3.__setRemRpc(keepRpc);
      comp.layers=comp.layers.filter(x=>x!==l);LV3.__save();}
  };

  /* 56 · STOCK AT AMAZON IN UK TIME (13 Oct): Sarah counts from the Philippines. The count is stamped and
     shown in UK time on every laptop, and two presses of Save are one save */
  S['stock at Amazon: stamped and shown in UK time, saved once']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    eq(LV3.ukStamp('2026-10-13T14:18'),'2026-10-13T14:18+01:00','a summer count carries +01:00');
    eq(LV3.ukStamp('2026-12-01T10:00'),'2026-12-01T10:00+00:00','a winter count carries +00:00');
    eq(LV3.whenTxt('2026-10-13T21:18+08:00'),'13 Oct 14:18','a Manila-clock time reads as UK time');
    eq(LV3.whenTxt('2026-10-13T14:18+01:00',true),'14:18','and the short form');
    eq(LV3.whenTxt('2026-10-05T13:55'),'5 Oct 13:55','an old stamp reads as it was written');
    const D=LV3.__D(),base=LV3.__prefsBase(),logN=D.log.length;
    const keep={a:JSON.stringify(D.settings.atAmz||{}),i:JSON.stringify(D.settings.atAmzIn||{}),t:JSON.stringify(D.settings.atAmzAt||{})};
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let writes=0;
    sb.from=t=>{const q={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:{value:JSON.stringify(LV3.__prefsBase())},error:null}),
      upsert:()=>{if(t==='app_settings')writes++;return Promise.resolve({error:null});}};return q;};
    try{
      LV3.openAtAmz();await wait(300);
      /* b630: SellerFuse fills this in — a hand count is unlocked first, as when Jack asks for one */
      if(LV3.amzLocked&&LV3.amzLocked()){LV3.amzUnlock();await wait(150);}
      const box=document.querySelector('#lav3Mod2 .amzQ');ok(box,'the window opened');
      const asin=box.dataset.asin;
      box.value='7';box.dispatchEvent(new Event('input',{bubbles:true}));
      const w=document.getElementById('amzWhenIn');w.value='2026-10-13T14:18';w.dispatchEvent(new Event('change',{bubbles:true}));
      await Promise.all([LV3.amzSave(),LV3.amzSave()]);
      eq(D.settings.atAmzAt[asin],'2026-10-13T14:18+01:00','stamped in UK time, offset on the end');
      eq(D.log.slice(0,4).filter(l=>/^Stock at Amazon counted 13 Oct 14:18 UK/.test(l.txt)).length,1,'two presses of Save log it once');
    }finally{if(own)sb.from=orig;else delete sb.from;
      D.settings.atAmz=JSON.parse(keep.a);D.settings.atAmzIn=JSON.parse(keep.i);D.settings.atAmzAt=JSON.parse(keep.t);
      LV3.__setPrefsBase(base);if(D.log.length>logN)D.log.splice(0,D.log.length-logN);try{LV3.cm('lav3Ov2');}catch(e){}}
  };

  /* 57 · SEND TO JACK AFTER THE DATE SLIPPED (Logitech X56, 13 Oct): Sarah pressed it three times and each time
     her list put the row straight back — the old promise was still on it. A question asked after the date is Jack's;
     a promise still waiting on its date comes back to Sarah when it slips, as before. */
  S['send to Jack after a slipped date stays with Jack']=async()=>{
    const past=new Date(Date.now()-12*864e5).toISOString().slice(0,10);
    const slipped=mkRow({exp:6,rcvd:3,ship:3,status:'Part Sent',sup:'Amazon UK',acct:'Biz 02',expectedDelivery:past,
      resolution:{state:'working',kind:'check',what:'jack-check',slippedAt:iso(),
        chase:{path:'never-arrived',step:'due-date',due:past,log:[{at:iso(),by:'PrepHub',what:'The promised date passed with nothing booked in — back with Sarah to chase'}]}}});
    ok(onSarahActive(slipped),'the slipped promise starts on Sarah’s list');
    const keep=window._mustSave;window._mustSave=async()=>true;
    try{await amzAskJack(rid(slipped));}finally{window._mustSave=keep;}
    _adminItems();                                                    /* her list runs its slip check */
    eq(slipped.resolution.state,'asked','her list leaves the question alone');
    eq(_rowOwner(slipped).owner,'jack','Jack’s');ok(onJack(slipped),'on Jack’s page');ok(!onSarahActive(slipped),'off her active list');
    const old=mkRow({exp:6,rcvd:3,ship:3,status:'Part Sent',sup:'Amazon UK',expectedDelivery:past,
      resolution:{state:'asked',kind:'check',what:'jack-check',ask:'Still coming?',at:new Date(Date.now()-20*864e5).toISOString(),
        chase:{path:'never-arrived',step:'due-date',due:past,log:[]}}});
    eq(_rowOwner(old).owner,'sarah','a question from before the date is the old promise — Sarah chases');
  };

  /* 58 · OPENING PLUB WRITES NOTHING (13 Oct): the products' "last saved" mark was taken before the build lists had
     loaded, and the first save afterwards rewrote all 43 product rows, twice each. A build-list change goes to the
     build list only; a rename still saves the product. */
  S['PLUB: opening and build-list changes never rewrite product rows']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;const W=[];
    sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,single:()=>Promise.resolve({data:{id:'x'},error:null}),
      then:(a,b)=>Promise.resolve({data:[],error:null}).then(a,b),
      insert:row=>{W.push([t,'insert',row]);return q;},update:row=>{W.push([t,'update',row]);const p={eq:()=>p,select:()=>Promise.resolve({data:[{id:'x'}],error:null}),then:(a,b)=>Promise.resolve({data:null,error:null}).then(a,b)};return p;},
      upsert:()=>Promise.resolve({error:null}),delete:()=>({in:()=>Promise.resolve({error:null}),eq:()=>Promise.resolve({error:null})})};return q;};
    D.products.forEach(x=>{if(x._src){delete x._src._sig;delete x._src._rsig;}});
    LV3.rehydrate();                                                  /* rebuilds D.products — pick the product after */
    const p=D.products.find(x=>x.type==='bundle'&&x.recipe&&x.recipe.length);const was=p.recipe[0].q,wasName=p.name;
    try{
      LV3.__save();await wait(900);
      eq(W.filter(w=>w[0]==='lavarion_asins').length,0,'a fresh load writes no product rows');
      p.recipe[0].q=was+1;LV3.__save();await wait(900);
      eq(W.filter(w=>w[0]==='lavarion_asins').length,0,'a build-list change writes no product row');
      ok(W.some(w=>w[0]==='lavarion_recipes'),'it goes to the build list');
      p.name=wasName+' CHECK';LV3.__save();await wait(300);
      ok(W.some(w=>w[0]==='lavarion_asins'&&w[2].product_name===wasName+' CHECK'),'a rename still saves the product');
    }finally{p.recipe[0].q=was;p.name=wasName;LV3.__save();await wait(900);if(own)sb.from=orig;else delete sb.from;}
  };

  /* 59 · UK TIME + THE SKU DATE (13 Oct): Sarah is 7–8 hours ahead, so "today" and "now" are the UK's on every
     laptop; a promise is parked through the whole UK day it names. A row the sheet gave no date takes the order
     date from its SKU — in memory only, never sent as a change. */
  S['UK time, promised days and the SKU date']=async()=>{
    eq(skuDateDDMM('Amuk_3.2_02096_0_PS_30'),'02/09','SKU date read');eq(skuDateDDMM('Amuk_129.99_11096_197_Jac_06'),'11/09','another');
    eq(skuDateDDMM('not a sku'),'','nothing made up');
    eq(todayISO(),ukDayISO(),'today is the UK day');ok(/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(getNowUK()),'now reads dd/mm hh:mm');
    ok(_parkedOnDate({expectedDelivery:todayISO()}),'promised today → still parked');
    ok(!_parkedOnDate({expectedDelivery:yesterdayISO()}),'promised yesterday → slipped');
    eq(ukAddDays('2026-10-30',3),'2026-11-02','days add across a month');eq(ukWeekdayOf('2026-10-17'),6,'17 Oct 2026 is a Saturday');
    const r=dbToRow({id:'chk-sku-1',sku:'Amuk_3.2_02096_0_PS_30',date_ddmm:'',status:'In-Transit',exp:30});
    eq(r.date,'02/09','blank date takes the SKU’s');ok(r.dateFromSku,'and says so');
    eq(Object.keys(_rowDiff(r)||{}).length,0,'never sent to the database as a change');
    const r2=dbToRow({id:'chk-sku-2',sku:'Amuk_3.2_02096_0_PS_30',date_ddmm:'05/09'});
    eq(r2.date,'05/09','the sheet’s own date always wins');ok(!r2.dateFromSku,'not marked');
  };

  /* 60 · PREP SHEET BARCODE SEARCH (14 Oct): Becki types EANs as printed ("0 619659 204853") or just the last 4
     digits. Spaces/dashes in a number don't count, nor a leading 0; a background refresh while the cursor is in
     the search box must not freeze the search. */
  S['Prep Sheet search: barcodes as printed, last 4, leading 0']=async()=>{
    const r=mkRow({sku:'Amuk_99_14106_0_CHK_01',asin:'B0CHK00001',ean:'0619659204853',prod:'CHECK SanDisk',oid:'202-5524591-7700353',status:'In-Transit',exp:2});
    const u=mkRow({sku:'Amg_96_06106_0_CHK_01',asin:'B0CHK00002',ean:'192876749692',prod:'CHECK ASUS board',status:'In-Transit',exp:1});
    const m=(row,q)=>_prepMatch(row,q.trim().toLowerCase());
    ok(m(r,'0619659204853'),'the full number');ok(m(r,'0 619659 204853'),'typed as printed, with spaces');
    ok(m(r,'0-619659-204853'),'with dashes');ok(m(r,'0619659204853 '),'a stray space at the end');
    ok(m(r,'619659204853'),'without its leading 0');ok(m(r,'4853'),'the last 4 digits');
    ok(m(u,'0192876749692'),'the box’s 13 digits find the stored 12');ok(m(u,'0 192876 749692'),'and as printed');
    ok(m(r,'202-5524591-7700353'),'an order number with dashes still works');ok(m(r,'check sandisk'),'words still work');
    ok(!m(u,'0619659204853'),'and a different barcode does not match');
    r.ean='0000000012345';ok(m(r,'12345'),'a new EAN is searchable straight away');
    /* a refresh while the cursor is in the search box */
    goPage('prep');await wait(200);const box=document.getElementById('prepSrch');const was=box.value;
    try{box.focus();_rtFlush();await wait(150);
      ok(!_pendingPrepRender,'the search box is not treated as a cell being edited');
      box.value='CHECK ASUS board';applyPrepSearch();
      const shown=[...document.querySelectorAll('#prepBody tr[data-id]')].filter(tr=>tr.style.display!=='none').map(tr=>tr.dataset.id);
      ok(shown.includes(String(u.id))&&shown.length<5,'the search still filters');
    }finally{box.value=was;applyPrepSearch();box.blur();}
  };

  /* 61 · EDIT ROW KEEPS WHAT IT DOESN'T SHOW (14 Oct): Part Sent wasn't in the Status list, so opening a Part Sent row
     and saving wiped its status; the send date and "received at" were wiped or re-stamped on every save; Add New Row
     kept the last row's barcode; the order year was fixed at 2026. */
  S['Edit Row: Part Sent, send date, received-at, fresh Add New Row']=async()=>{
    goPage('prep');await wait(150);
    const r=mkRow({sku:'Amuk_5_01106_0_CHK_02',sup:'Amazon UK',status:'Part Sent',sent:'No',sentDate:'2026-10-01',rcvdAt:'2026-09-30T10:00:00.000Z',
      exp:6,rcvd:6,ship:3,ean:'0619659204853',asin:'B0CHK00003',prod:'CHECK edit row',date:'01/10'});
    /* only this row's save counts — an earlier check's delayed save (renderAdmin debounces
       its own saveRow by 1.5s) can land here while saveRow is swapped out */
    const keep=window.saveRow;let got=null;window.saveRow=async x=>{if(x&&x.uuid===r.uuid)got=x;return true;};
    try{
      openEdit(r.uuid);await wait(80);
      eq(document.getElementById('f-status').value,'Part Sent','Part Sent shows in the box');
      eq(document.getElementById('f-date').value,_ddmmToISO('01/10'),'the order date fills');
      saveRowForm();await wait(80);
      ok(got,'it saved');eq(got&&got.status,'Part Sent','status kept');eq(got&&got.sentDate,'2026-10-01','send date kept');
      eq(got&&got.rcvdAt,'2026-09-30T10:00:00.000Z','received-at kept');eq(got&&got.ean,'0619659204853','barcode kept');
      openAdd();await wait(50);eq(document.getElementById('f-ean').value,'','Add New Row starts with no barcode');
      eq(document.getElementById('f-date').value,todayISO(),'and today’s UK date');
      const t=todayISO(),fut=ukAddDays(t,10);const dm=fut.slice(8,10)+'/'+fut.slice(5,7);
      ok(_ddmmToISO(dm)<=t,'a dd/mm still to come this year is last year’s order');
    }finally{window.saveRow=keep;try{cm('addModal');}catch(e){}}
  };

  /* 62 · PLUB EXTRAS (21 Oct): 30 counted in against an order of 25 kept its 5 extras only until the purchase was
     re-applied, which capped it back at 25. And at packing, "We have extra parts" books the missing parts in first,
     so the send never takes stock the app does not have. */
  S['PLUB extras: counted-in extras survive; packing books the missing parts']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),c=D.components.find(x=>!x.archived&&!x.untracked);
    const pu={id:'chkx'+Date.now(),name:'CHECK extra purchase',date:'2026-10-20',qty:25,price:0.9,sup:'CHECK SUP',oid:'CHK-X1',loc:'Warehouse',arr:0,alloc:[]};
    const tag='P:'+pu.id,lay=()=>(c.layers||[]).find(x=>x.src===tag);
    try{
      LV3.__setAlloc(pu,[{to:c.id,qty:25}]);ok(lay(),'the order sits on the part');
      LV3.receiveRow('component',c.id,lay().id,30,'',0,false,{quiet:true});
      eq(lay().rem,30,'30 counted in against 25 ordered');eq(lay().extra,5,'5 remembered as extra');
      LV3.__setAlloc(pu,[{to:c.id,qty:25}]);
      eq(lay().rem,30,'a re-apply keeps all 30');eq(lay().qty,30,'and the batch quantity');
      LV3.__setAlloc(pu,[{to:c.id,qty:20}]);
      eq(lay().rem,25,'shrinking the allocation to 20 keeps 20 plus the 5 extra');
    }finally{c.layers=(c.layers||[]).filter(x=>x.src!==tag);}
    const p=D.products.find(x=>!x.archived&&x.type==='bundle'&&x.recipe&&x.recipe.length&&LV3.shipCheck(x.asin,1)&&LV3.shipCheck(x.asin,1).available!=null);
    if(p){
      const can=LV3.shipCheck(p.asin,1).available,want=can+3;
      const plan=LV3.extraPlan(p.asin,want);ok(plan.length,'the short parts are named');
      const keepL=new Map(D.components.map(x=>[x.id,(x.layers||[]).length]));
      try{
        const r=LV3.bookExtraForBuild(p.asin,want,'CHECK supplier sent extra','');
        eq(r.added.length,plan.length,'each short part booked in');
        eq(LV3.shipCheck(p.asin,want).available>=want,true,`now ${want} can be built`);
        ok(D.components.some(x=>(x.layers||[]).some(l=>l.sup==='Found extra'&&/CHECK supplier sent extra/.test(l.note||''))),'booked as Found extra, with the reason');
      }finally{D.components.forEach(x=>{if(x.layers)x.layers=x.layers.filter(l=>!(l.sup==='Found extra'&&/CHECK supplier sent extra/.test(l.note||'')));});
        (D.log||[]).splice(0,(D.log||[]).findIndex(l=>!/CHECK/.test(l.txt||''))>0?(D.log||[]).findIndex(l=>!/CHECK/.test(l.txt||'')):0);}
    }
    LV3.__save();
  };

  /* 63 · NUMBERS GO TO THE SEARCH (21 Oct): with a row selected, "0" used to set Expected Qty to 0 and save. */
  S['Prep Sheet: a typed number searches, never edits the selected row']=async()=>{
    const r=mkRow({exp:10,rcvd:0,status:'In-Transit',prod:'CHECK numbers row'});
    goPage('prep');await wait(250);renderPrep();await wait(200);
    const box=document.getElementById('prepSrch'),was=box.value;
    const trs=getRowEls();let ri=-1,ci=-1;
    trs.forEach((tr,i)=>{if(ri<0)getVisibleTds(tr).forEach((td,c)=>{const inp=td.querySelector('input');if(ci<0&&inp&&inp.type==='number'){ri=i;ci=c;}});});
    ok(ri>=0,'a number cell to select');
    const inp=getVisibleTds(trs[ri])[ci].querySelector('input'),before=inp.value;
    try{
      box.value='';setFocus(ri,ci);if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'0',bubbles:true}));
      await wait(80);
      eq(inp.value,before,'the cell was not touched');eq(box.value,'0','the digit went into the search box');
      eq(document.activeElement,box,'and the cursor is there, so the rest of the barcode types straight in');
    }finally{box.value=was;applyPrepSearch();box.blur();}
  };

  /* 64 · eBAY STOCK (Becki 15 Oct, Jack 21 Oct): stock we decide to sell on eBay — not a problem, nobody to chase.
     Raised at the bench, it goes straight to Recovery Stock, comes off "to send", and the row files once the rest is gone. */
  S['eBay stock: straight to Recovery Stock, off "to send", row files itself']=async()=>{
    const r=mkRow({exp:10,rcvd:10,ship:0,status:'In Warehouse',sku:'Amuk_5_14106_0_CHK_10',prod:'CHECK eBay row',asin:'B0CHKEBAY1',sup:'Amazon UK',oid:'202-CHK-EBAY'});
    const keep={cc:window._createIssueClaim,rfc:window.recFromClaim,sc:window.saveClaim,sr:window.saveRow};
    let recArgs=null,made=null;
    window._createIssueClaim=async(row,type,qty,opts)=>{made={id:'chk-c-ebay',prepRowId:row.uuid||row.id,issT:type,dif:qty,cst:'Needs Attention',log:[],_chk:true,sku:row.sku,oid:row.oid};claims.push(made);return made;};
    window.recFromClaim=async(c,o)=>{recArgs={c,o};return{qty:c.dif};};
    window.saveClaim=async()=>true;window.saveRow=async()=>true;
    try{
      openIssueModal(r.uuid);await wait(80);
      ok([...document.getElementById('il-type-0').options].some(o=>o.value==='eBay stock'),'eBay stock is on the list');
      document.getElementById('il-type-0').value='eBay stock';document.getElementById('il-qty-0').value='3';
      await saveIssueModal();await wait(80);
      ok(made&&made.cst==='Resolved','the record closes itself — nobody to chase');
      ok(recArgs&&recArgs.o&&recArgs.o.source==='eBay stock','the units go to Recovery Stock as eBay stock');
      eq(r.issueType,'eBay stock','the row knows');eq(sendableQty(r),7,'3 come off "to send" — 7 left for Amazon');
      ok(!_recoveryFiled(r),'with 7 still on the shelf the row stays');
      r.ship=7;r.shipSegments=[{shipId:'FBA15CHK',units:7,date:todayISO(),type:'Standard'}];
      ok(_recoveryFiled(r),'once the 7 have gone, the row files itself');ok(/eBay stock/.test(r.notes||''),'and says why');
    }finally{Object.assign(window,{_createIssueClaim:keep.cc,recFromClaim:keep.rfc,saveClaim:keep.sc,saveRow:keep.sr});try{cm('issueModal');}catch(e){}}
  };

  /* 65 · EVERY SEND ROUTE KNOWS ABOUT EXTRAS (22 Oct): the PLUB page's own Ship popup and raising a line on the
     Shipments page. The Ship popup offers "book them in & send"; raising a line past what can be built stops and asks
     instead of quietly logging the rest as owed. */
  S['extras: PLUB Ship popup and raising a shipment line']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D();
    const p=D.products.find(x=>!x.archived&&x.type==='bundle'&&x.recipe&&x.recipe.length&&LV3.shipCheck(x.asin,1)&&LV3.shipCheck(x.asin,1).available!=null);
    if(!p)return;
    const can=LV3.shipCheck(p.asin,1).available,want=can+2;
    const tidy=()=>D.components.forEach(x=>{if(x.layers)x.layers=x.layers.filter(l=>!(l.sup==='Found extra'&&/CHECK/.test(l.note||'')));});
    try{
      LV3.openShip(p.id);await wait(150);LV3.shipQty(want);await wait(120);
      const send=()=>[...document.getElementById('lav3Mod1').querySelectorAll('button')].find(b=>new RegExp('Send '+want).test(b.textContent));
      ok(send()&&send().disabled,`${want} is blocked to start with`);
      ok(document.getElementById('shipXWhy'),'the Ship popup offers the extra-parts way out');
      document.getElementById('shipXWhy').value='Something else';document.getElementById('shipXNote').value='CHECK extra';
      LV3.shipExtra();await wait(150);
      ok(!document.getElementById('shipXWhy')&&!/Can't send/.test(document.getElementById('lav3Mod1').textContent),'after booking them in, the stock block is gone');
      ok(/Ship —/.test(document.getElementById('lav3Mod1').textContent),'and you are still on the Ship popup');
    }finally{tidy();try{LV3.cm('lav3Ov1');}catch(e){}}
    const ls=(typeof lavShipments!=='undefined'?lavShipments:[]).find(s=>s.uuid&&s.asin===p.asin);
    if(ls){
      const keep=window.showConfirm,was=ls.units;let asked=null;window.showConfirm=(t)=>{asked=t;};
      try{
        editLavShipLine(ls.uuid);await wait(80);
        document.getElementById('editLavUnits').value=was+LV3.shipCheck(p.asin,1).available+3;
        saveEditLavLine();await wait(80);
        ok(asked&&/more can be built/.test(asked),'raising the line past what can be built stops and asks');
        eq(ls.units,was,'nothing changed while it asks');
      }finally{window.showConfirm=keep;try{cm('editLavLineModal');}catch(e){}}
    }
  };

  /* 66 · IMPOSSIBLE DATES (22 Oct): Jack typed 31/11/2026 into "When did Amazon say?" and got "Pick a date first" —
     the box shows the date but hands the app nothing. The message says what is wrong. */
  S['date boxes: an impossible date says so']=async()=>{
    ok(/doesn.t exist/.test(dateBoxMsg({validity:{badInput:true}},'Pick a date first')),'31 November is called out');
    eq(dateBoxMsg({validity:{badInput:false}},'Pick a date first'),'Pick a date first','an empty box still asks for a date');
    eq(dateBoxMsg(null,'Pick a date'),'Pick a date','no box, plain message');
  };

  /* 67 · RESTOCKS "LAST BOUGHT" (22 Oct): the newest real purchase of a part — never a found-extra or correction batch. */
  S['Restocks: last bought is the newest real purchase']=async()=>{
    const c={layers:[{sup:'Tesco',cost:0.85,date:'2026-09-01',qty:40,arr:1,rem:0},
      {sup:'Holleys Fine Foods',cost:0.87,date:'2026-10-12',qty:3010,arr:0,rem:0},
      {sup:'Found extra',cost:0.9,date:'2026-10-21',qty:9,arr:1,rem:0},
      {sup:'Stock correction',cost:0.9,date:'2026-10-20',qty:5,arr:1,rem:0}]};
    const lb=LV3.lastBuy(c);
    eq(lb&&lb.sup,'Holleys Fine Foods','newest real supplier');eq(lb&&lb.cost,0.87,'with its price');
    eq(LV3.lastBuy({layers:[]}),null,'nothing bought, nothing shown');
  };

  /* 68 · SENT OVER STOCK, SETTLED PROPERLY (22 Oct): Settle used to tick the line and nothing else, so the parts the
     over-sent units used never came off and the shelf read high for good. "Take the parts off now" takes them off;
     "Close" takes nothing and says so; both ask first. */
  S['sent over stock: Settle takes the parts off, Close takes nothing']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D();D.settings.overSent=D.settings.overSent||{};
    const p=D.products.find(x=>!x.archived&&x.type==='bundle'&&x.recipe&&x.recipe.length
      &&(LV3.shipCheck(x.asin,1)||{}).available>=2&&!LV3.overSentFor(x.asin));
    if(!p)return;
    const rems=[];D.components.forEach(c=>(c.layers||[]).forEach(l=>rems.push([l,l.rem])));
    const had=D.settings.overSent[p.asin],logN=D.log.length;
    const av0=LV3.shipCheck(p.asin,1).available;
    try{
      D.settings.overSent[p.asin]=[{on:new Date().toISOString(),units:1,shipId:'CHECK',by:'check',settled:false}];
      LV3.settleOverSent(p.asin,'take');await wait(60);
      ok(/Take the parts/.test(document.getElementById('lav3Mod2').textContent),'it asks before taking anything');
      eq(LV3.overSentFor(p.asin),1,'nothing settled while it asks');
      LV3.cm('lav3Ov2');
      LV3.settleOverSent(p.asin,'take',true);await wait(60);
      eq(LV3.shipCheck(p.asin,1).available,av0-1,'the parts for 1 came off the shelf');
      eq(LV3.overSentFor(p.asin),0,'and the line is settled');
      eq(D.settings.overSent[p.asin][0].settledHow,'parts taken off','it says how');
      D.settings.overSent[p.asin].push({on:new Date().toISOString(),units:3,shipId:'CHECK',by:'check',settled:false});
      LV3.settleOverSent(p.asin,'gone',true);await wait(60);
      eq(LV3.shipCheck(p.asin,1).available,av0-1,'Close takes nothing off');
      eq(LV3.overSentFor(p.asin),0,'but closes it');
      ok(/nothing to take off/.test((D.log[0]||{}).txt||''),'and the log says so');
    }finally{
      rems.forEach(([l,r])=>{l.rem=r;});
      if(had)D.settings.overSent[p.asin]=had;else delete D.settings.overSent[p.asin];
      D.log.splice(0,D.log.length-logN);
      try{LV3.cm('lav3Ov1');LV3.cm('lav3Ov2');}catch(e){}
    }
  };

  /* 69 · LEFTOVERS FOLLOW JACK'S PROCESS (22 Oct): booked in, never sent. Sarah first → Amazon order to Jack to
     check the account → back to Sarah: wrong SKU? → Becki checks the shelves → Not here corrects the count and it
     goes back to Jack to raise with Amazon. Before this, the leftover went round Sarah ↔ Jack and never reached Becki. */
  S['leftovers: Sarah → Jack → Sarah → Becki → Not here → Jack']=async()=>{
    const keep={s:window.saveRow,v:window.addVaActions};window.saveRow=async()=>true;window.addVaActions=async()=>{};
    const old=new Date(Date.now()-6*864e5).toISOString();
    const r=mkRow({exp:9,rcvd:9,ship:5,status:'Part Sent',rcvdAt:old,sentDate:old.slice(0,10)});
    r.shipSegments=[{shipId:'FBA-CHKL',units:5,date:old.slice(0,10),type:'Standard'}];
    try{
      eq(_rowOwner(r).owner,'sarah','Sarah first');
      who('Sarah');await amzAskJack(r.uuid);eq(_rowOwner(r).owner,'jack','an Amazon order goes to Jack to check the account');
      const T=jackTodo();ok((T.checks||[]).some(x=>same(x,r)),'it is on Jack’s page');
      who('Jack');await jackAnswered(r.uuid,'Arrived — YES, the account shows it delivered.');
      eq(_rowOwner(r).owner,'sarah','his answer goes back to Sarah');
      who('Sarah');await amzToBecki(r.uuid);
      eq(_rowOwner(r).owner,'becki','Sarah sends it to Becki — and it is Becki’s');
      ok(_isAmzDel(r)&&r.resolution.amzDelivered.kind==='leftover','on Becki’s shelf list as a leftover check');
      who('Becki');await amzNotHere(r.uuid);
      eq(r.rcvd,5,'Not here corrects the booked-in count to what went');
      eq(_rowOwner(r).owner,'jack','and it goes to Jack to raise with Amazon');eq(_owedUnits(r),4,'4 owed on the claim');
    }finally{window.saveRow=keep.s;window.addVaActions=keep.v;}
  };

  /* 70 · NOTHING CUT OFF (22 Oct): prep.css table{min-width:1280px} pushed PLUB popup columns off the edge (Settle was
     never visible), and Sarah's waiting rows lost Undo / Details off a 118px column. Tables fit their popup; every
     button on a waiting row sits inside its row. */
  S['layout: popup tables fit, waiting-row buttons are visible']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),p=D.products.find(x=>!x.archived&&x.type==='bundle'&&x.recipe&&x.recipe.length);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      if(p){
        LV3.openProduct(p.id);await wait(200);
        const mb=document.querySelector('#lav3Mod1 .mb'),W=mb.getBoundingClientRect().width;
        [...mb.querySelectorAll('table')].filter(t=>!t.classList.contains('mx')).forEach(t=>ok(t.getBoundingClientRect().width<=W+2,'a product-popup table fits the popup'));
        LV3.cm('lav3Ov1');
      }
      who('Sarah');mkRow({exp:10,resolution:asked()});
      goPage('admin');renderAdmin();await wait(80);
      const rowsC=[...document.querySelectorAll('#page-admin tr.tfuCompact')];
      ok(rowsC.length>0,'a waiting row is drawn');
      rowsC.forEach(tr=>{const R=tr.getBoundingClientRect();tr.querySelectorAll('button').forEach(b=>{const r=b.getBoundingClientRect();
        ok(r.width>0&&r.right<=R.right+1,`"${b.textContent.trim()}" sits inside its row`);});});
    }finally{try{LV3.cm('lav3Ov1');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 71 · READING TIDY (22 Oct): the X56's 12 bounced sends read as one line, and a written-off remainder (Dove MD ×2,
     Superdrug) is not "on the way in". */
  S['history: bounced sends read as one line; written-off is not on the way']=async()=>{
    const t0=Date.parse('2026-10-13T13:49:50Z'),L=[{at:'2026-09-17T14:46:11Z',by:'Jack',what:'parked'}];
    for(let k=0;k<4;k++){const a=new Date(t0+k*864e5).toISOString(),b=new Date(t0+k*864e5+2).toISOString();
      L.push({at:a,by:'Sarah',what:'Sent to Jack — Check whether it was cancelled or refunded'},{at:b,by:'PrepHub',what:'The promised date passed with nothing booked in — back with Sarah to chase'});}
    L.push({at:'2026-10-22T16:41:51Z',by:'Sarah',what:'Sent to Jack — has Amazon delivered it?'});
    const q=_squashBounces(L);
    eq(q.length,3,'nine lines become three');ok(/Sent to Jack 4 times/.test(q[1].what),'the bounces are counted');
    eq(q[2].what,'Sent to Jack — has Amazon delivered it?','a send that stuck is kept as it is');
    eq(_squashBounces([L[1],L[2]]).length,2,'a single bounce is left alone');
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),p=D.products.find(x=>!x.archived&&x.type==='bundle'&&x.recipe&&x.recipe.length);if(!p)return;
    const c=D.components.find(x=>x.id===p.recipe[0].c);if(!c)return;
    const l={id:'chk-wo',sup:'CHECK',date:'2026-08-02',qty:2,cost:1,rem:0,arr:0,writtenOff:1};c.layers=(c.layers||[]).concat([l]);
    try{LV3.openProduct(p.id);await wait(150);
      ok(!/CHECK/.test(document.getElementById('lav3Mod1').innerText),'a written-off line is not listed as on the way');}
    finally{c.layers=c.layers.filter(x=>x!==l);LV3.cm('lav3Ov1');}
  };

  /* 72 · WRITTEN OFF ON JACK'S PAGE (22 Oct): every loss in one list — a Prep Sheet write-off, a claim written off,
     a PLUB shortage written off — and a PLUB line closed as refunded is NOT a loss. */
  S['Jack: Written off lists every loss, never a refund']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const r=mkRow({exp:10,rcvd:4,cancelledQty:6,archived:true,prod:'CHECK WO row',
      resolution:{state:'approved',what:'no-refund',refundUnits:6,approvedBy:'Jack',approvedAt:iso(),moneyOff:{by:'Jack',at:iso(),why:'Written off — taking the loss'}}});
    mkClaim({prod:'CHECK WO claim',dif:3,claimValue:12.5,reimbursed:'Write-off',outcome:'written-off',cst:'Resolved',resolvedAt:iso().slice(0,10),archived:true});
    const D=LV3.__D(),c=D.components[0],L1={id:'chk-wo1',sup:'CHECK',date:'2026-10-01',qty:0,shortQty:5,cost:2,rem:0,arr:0,writtenOff:'2026-10-20',shortEnd:{k:'writeoff',on:'2026-10-20',by:'Jack'}},
      L2={id:'chk-wo2',sup:'CHECKREF',date:'2026-10-01',qty:4,shortQty:4,cost:2,rem:0,arr:0,writtenOff:1,shortEnd:{k:'refund',on:'2026-10-20',by:'Becki'}};
    c.layers=(c.layers||[]).concat([L1,L2]);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      const W=_writeOffs();
      const pr=W.find(x=>x.prod==='CHECK WO row');ok(pr&&pr.units===6&&pr.src==='Prep Sheet','the Prep Sheet write-off is listed with its 6 units');
      const cl=W.find(x=>x.prod==='CHECK WO claim');ok(cl&&cl.val===12.5&&cl.src==='Claim','the claim write-off is listed with its £');
      const pl=W.find(x=>x.sup==='CHECK'&&x.src==='PLUB short');ok(pl&&pl.units===5&&pl.val===10,'the PLUB shortage write-off is listed — 5 × £2');
      ok(!W.some(x=>x.sup==='CHECKREF'),'a PLUB line closed as refunded is not a loss');
      goPage('jack');renderJack();await wait(60);
      ok(/Written off/.test((document.querySelector('#page-jack details.jkWo summary')||{}).textContent||''),'the panel is on Jack’s page');
    }finally{c.layers=c.layers.filter(x=>x!==L1&&x!==L2);if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 73 · JACK'S ANSWERS ON A LEFTOVER (22 Oct): the Amazon question with the answers that apply — and "Only 5 were
     ordered" corrects the sheet AND the booked-in count, so the row closes clean. */
  S['leftovers: Jack answers the Amazon question; Only N ordered fixes sheet and count']=async()=>{
    who('Jack');const r=mkRow({exp:9,rcvd:9,ship:5,status:'Part Sent',resolution:asked()});
    const keep={s:window.saveRow,v:window.addVaActions,w:window.fireWebhook};
    window.saveRow=async x=>true;window.addVaActions=async()=>{};window.fireWebhook=async()=>{};
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('jack');renderJack();await wait(60);
      const tr=[...document.querySelectorAll('#page-jack tr')].find(t=>t.textContent.includes(r.prod)&&t.querySelector('.csActs'));
      ok(tr,'the row is on Jack’s page');
      const t=tr.innerText;
      ok(/What does the Amazon order show\?/.test(t),'it asks the Amazon question');ok(!/the other 0/.test(t),'never "the other 0"');
      ok(/All 9 were delivered/.test(t)&&/Only 5 were ordered/.test(t),'with delivered and sheet-wrong answers');
      openQtyFix(r.uuid,{to:5});await wait(40);
      ok(getComputedStyle(document.getElementById('qfRcvdWrap')).display!=='none'&&document.getElementById('qfRcvd').checked,'the booked-in fix is offered, ticked');
      await saveQtyFix();await wait(40);
      eq(r.exp,5,'sheet corrected');eq(r.rcvd,5,'booked-in count corrected');eq(r.resolution.state,'approved','the question closes');
    }finally{window.saveRow=keep.s;window.addVaActions=keep.v;window.fireWebhook=keep.w;try{closeQtyFix();}catch(e){}
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 74 · SHIPMENTS SEARCH MARKS THE LINE (22 Oct): paste a SKU (stray space and all) — its shipment opens and the
     line is highlighted at the top, not just the shipment listed. */
  S['Shipments: a pasted SKU highlights its line']=async()=>{
    const r=mkRow({exp:3,rcvd:3,ship:3,status:'Sent to Amazon',sent:'Yes'});
    const was=(document.querySelector('.page.active')||{}).id||'',keepF=_shipDateFilter,box=document.getElementById('shipSrch'),keepQ=box?box.value:'';
    try{
      goPage('shipments');box.value=r.sku+' ';setShipDateFilter('all');await wait(80);
      const tr=document.querySelector('#page-shipments tr.shHit');
      ok(tr&&tr.textContent.includes(r.sku),'the searched line is highlighted');
      ok(tr&&tr.closest('.hgroup').classList.contains('open'),'its shipment opens by itself');
      eq(tr&&tr.parentElement.querySelector('tr'),tr,'and it sits at the top of the shipment');
    }finally{if(box)box.value=keepQ;try{setShipDateFilter(keepF);}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 75 · A PART ARRIVAL IS SARAH'S WHATEVER THE STATUS (22 Oct, Shark vacuum): 1 of 2 booked in and the row set to
     "In Warehouse" — the missing one fell off every list for 9 days. */
  S['part arrived, status In Warehouse — still on Sarah’s list']=async()=>{
    who('Sarah');const old=new Date(Date.now()-6*864e5).toISOString();
    const r=mkRow({exp:2,rcvd:1,ship:0,status:'In Warehouse',rcvdAt:old});
    eq(_rowOwner(r).owner,'sarah','the rules say Sarah');
    ok(onSarahActive(r),'and it is on her list');
    const i=sarahItem(r);ok(i&&i.partOverdue,'as part arrived — the rest overdue');
  };

  /* 76 · THE WRONG-SKU CHECK IS REAL (23 Oct): "have these been 1000% checked by Sarah … that is her triage". Becki
     only after both ticks, and the check goes on record. */
  S['wrong-SKU check: Becki only after the ticks, and it is on record']=async()=>{
    who('Sarah');const r=mkRow({exp:3,rcvd:0,resolution:asked({state:'rejected',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack'})});
    try{
      skuCheckOpen(r.uuid);await wait(30);
      ok(document.getElementById('skcGo').disabled,'Becki is locked until both boxes are ticked');
      document.querySelectorAll('#skuChkModal .skcTick').forEach(c=>{c.checked=true;});skuCheckSync();
      ok(!document.getElementById('skcGo').disabled,'both ticked — unlocked');
      await skuCheckedToBecki(r.uuid);
      ok(r.resolution.skuCheck&&r.resolution.skuCheck.by==='Sarah','the check is on record, with who');
      eq(_rowOwner(r).owner,'becki','and it is with Becki');
    }finally{try{skuCheckShut();}catch(e){}}
  };

  /* 77 · PLUB ACTION CENTRE, BY JOB (23 Oct): Becki opened it five times in October and the same lines kept coming
     back. A send made after the Amazon count is on its way; a DONE survives a redraw; a part never shows twice;
     pause, snooze and a moved date are all on the record, with who. */
  S['PLUB Action centre: sends since the count, DONE sticks, no duplicates, everything on record']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),S0=JSON.stringify({a:D.settings.wlAck||{},z:D.settings.acSnooze||{},p:D.settings.acPause||{}}),logN=D.log.length;
    const p=D.products.find(x=>!x.archived&&(D.settings.atAmzAt||{})[x.asin]);
    const fake={asin:p&&p.asin,date:'2099-01-01',units:7,shipId:'FBA-CHK',prod:'CHECK'};
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      if(p){lavShipments.push(fake);const r=LV3.__plRow(p);ok(r.since>=7,'a send after the count is counted as on its way');lavShipments.splice(lavShipments.indexOf(fake),1);}
      D.settings.wlAck=D.settings.wlAck||{};D.settings.wlAck.chk_line={d:new Date().toISOString().slice(0,10),by:'Becki'};
      goPage('lavarion');LV3.go&&LV3.go('overview');await wait(200);
      ok(D.settings.wlAck.chk_line,'a DONE survives a redraw even when its line is not on the list');
      const pg=document.getElementById('page-lavarion');
      const buyText=[...pg.querySelectorAll('#ac-order .acx')].map(r=>r.textContent);
      const dup=buyText.filter(t=>/nothing on order/.test(t)).map(t=>(t.match(/\s([^—]+?) — nothing on order/)||[])[1]).filter(Boolean)
        .some(nm=>buyText.some(t=>!/nothing on order/.test(t)&&t.includes(nm.trim())));
      ok(!dup,'a part is never listed twice (supplier line and nothing-on-order line)');
      const q=D.products.find(x=>!x.archived&&x.type==='bundle');
      if(q){D.settings.acPause=D.settings.acPause||{};
        D.settings.acPause[q.asin]={by:'Becki',at:new Date().toISOString()};
        ok(LV3.__plRow(q).state==='paused','a paused product is left alone by the planner');delete D.settings.acPause[q.asin];}
      LV3.acSnoozeTo('chk_line2','2099-01-01');ok(/^Snoozed until/.test((D.log[0]||{}).txt||''),'a snooze is written into the record in plain words');
    }finally{
      const o=JSON.parse(S0);D.settings.wlAck=o.a;D.settings.acSnooze=o.z;D.settings.acPause=o.p;
      D.log.splice(0,D.log.length-logN);
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}
    }
  };

  /* 78 · IN TRANSIT IS UNITS STILL TO ARRIVE (23 Oct, the UK team): 100 ordered, 20 counted in — the other 80 stay
     in transit, whatever the status says, and the tile's filter shows the row. */
  S['In Transit: units still to arrive, whatever the status']=async()=>{
    const keep=window.saveRow;window.saveRow=async()=>true;
    try{
      const t0=_transitTotals().units;
      const r=mkRow({exp:100,rcvd:0,status:'In-Transit'});
      eq(_transitTotals().units,t0+100,'100 ordered — 100 more in transit');
      uf(r.uuid,'rcvd',20);
      eq(r.status,'In Warehouse','a part delivery is In Warehouse');
      eq(_transitTotals().units,t0+80,'20 in — the other 80 stay in transit');
      ok(_stMatches(r,'__toArrive'),'the tile filter shows it');
      uf(r.uuid,'rcvd',100);
      eq(_transitTotals().units,t0,'all 100 in — nothing left in transit');
    }finally{window.saveRow=keep;}
  };

  /* 79 — Jack, 23 Oct: "see what's being clicked and what's being used". */
  S['What gets used: clicks counted per control, row ids and numbers squashed, test mode never sends']=async()=>{
    const was=_usage,who={id:cu.id,name:cu.name};const host=document.querySelector('.page.active')||document.body;
    const box=document.createElement('div');host.appendChild(box);
    try{
      cu.id=cu.id||'check';cu.name='CheckUser';_usage=null;
      /* stand-in handlers: the controls must never run the real ones */
      window.chkStatusPick=()=>{};window.chkRcvdTyped=()=>{};
      box.innerHTML=`<button onclick="void 0">Send 12 more</button>
        <select id="st-9f3a1" onchange="chkStatusPick(this)"><option>In-Transit</option><option>In Warehouse</option></select>
        <input id="ufRcvd-77" onchange="chkRcvdTyped(this)">`;
      const [b,sel,inp]=box.children;
      b.click();b.click();
      sel.value='In Warehouse';sel.dispatchEvent(new Event('change',{bubbles:true}));
      inp.value='5';inp.dispatchEvent(new Event('change',{bubbles:true}));
      const place=_usagePlace(b),c=_usage.c;
      eq(c[place+' › Send N more'],2,'a button is counted by its words, the number squashed');
      eq(c[place+' › [chkStatusPick] = In Warehouse'],1,'a dropdown is counted by what it does and what was picked, not its row id');
      eq(c[place+' › typed in [chkRcvdTyped]'],1,'typing is counted, never what was typed');
      const tb=document.createElement('table');box.appendChild(tb);
      tb.innerHTML='<thead><tr><th>SKU</th><th>Status</th></tr></thead><tbody><tr><td>x</td><td><select id="st-77"><option>In-Transit</option><option>Issue</option></select></td></tr></tbody>';
      const rs=tb.querySelector('select');rs.value='Issue';rs.dispatchEvent(new Event('change',{bubbles:true}));
      eq(_usage.c[place+' › Status column = Issue'],1,'a row dropdown is named by its column heading');
      ok(!JSON.stringify(c).includes('5')||!Object.keys(c).some(k=>k.endsWith('5')),'the typed value is not recorded');
      eq(_usage.w,'CheckUser','counted against the person signed in');
      await usageFlush(true);
      eq(_usage.c[place+' › Send N more'],2,'test mode keeps the counts and sends nothing');
      ok(String(loadAuditPage).includes("neq('action','Usage')"),'the Audit list leaves the count lines out');
    }finally{box.remove();_usage=was;cu.id=who.id;cu.name=who.name;delete window.chkStatusPick;delete window.chkRcvdTyped;}
  };

  /* 80 — Jack, 23 Oct: Dashboard Pipeline counted whole orders by status (264 "In Warehouse",
     only 175 on the shelf). Every unit once, by where it is; "Delivered" retired. */
  S['Pipeline: each unit counted once by where it is; Delivered retired; bars open those rows']=async()=>{
    const keep=window.saveRow;window.saveRow=async()=>true;
    try{
      const a0=_transitTotals().units,s0=_unitTotals(_onShelf).units;
      const r=mkRow({exp:100,rcvd:0,status:'In-Transit'});
      eq(_transitTotals().units-a0,100,'ordered, nothing in: 100 still to arrive');
      eq(_unitTotals(_onShelf).units-s0,0,'nothing booked in = nothing on the shelf');
      uf(r.uuid,'rcvd',20);
      eq(_transitTotals().units-a0,80,'20 booked in: 80 still to arrive');
      eq(_unitTotals(_onShelf).units-s0,20,'… and 20 on the shelf — 100 in all, never 180');
      r.ship=5;r.shipSegments=[{shipId:'FBA-CHK80',units:5,date:'2026-10-23',type:'Standard'}];
      eq(_onShelf(r),15,'5 sent to Amazon leave the shelf');
      r.resolution={what:'wrong-sku',elsewhereShipped:15};
      eq(_onShelf(r),0,'units that went out under another SKU are not on the shelf');
      r.resolution=null;
      ok(_stMatches(r,'__onShelf')&&_stMatches(r,'__toArrive'),'the row shows under both Prep Sheet filters');
      const f=mkRow({exp:4,rcvd:4,ship:4,status:'Sent to Amazon',issueType:'Damaged',issueQty:2});
      const fin=(_rowOwner(f)||{}).finished;
      eq(_issueOpen(f),fin?0:2,'an issue flag counts only while somebody is still working it');
      /* Delivered: gone from the row dropdown, kept on an old row that still has it */
      const d=mkRow({exp:3,rcvd:0,status:'Delivered'});
      renderPrepRows([r,d]);
      const opts=x=>{const sel=document.querySelector('#row-'+x.id+' select.ci-sel');ok(sel,'row '+x.id+' drawn with its status dropdown');return [...sel.options].map(o=>o.text);};
      ok(!opts(r).includes('Delivered'),'a normal row is no longer offered Delivered');
      ok(opts(d).includes('Delivered'),'an old Delivered row keeps its status');
      ok(![...document.querySelectorAll('#bulkActionDropdown option,#f-status option')].some(o=>o.value==='Delivered'||o.text==='Delivered'),'bulk and Add Row lists no longer offer it');
      /* the Dashboard bar opens the Prep Sheet on exactly what it counted */
      dashToPrep('__onShelf');
      eq(document.getElementById('prepStF').value,'__onShelf','the bar sets the Prep Sheet filter');
      const shown=_prepBaseRows().filter(x=>!x._chk);
      const want=_unitTotals(_onShelf).rows.filter(x=>!x._chk);
      eq(shown.length,want.length,'the Prep Sheet shows the same orders the bar counted');
    }finally{window.saveRow=keep;const sel=document.getElementById('prepStF');if(sel)sel.value='';}
  };

  /* 81 — 23 Oct: v54.7 left the Dashboard using a name it had removed (transitRows), so the
     whole page failed to draw and no check noticed, because no check opened it. Every page now. */
  S['every page opens without an error']=async()=>{
    const pages=['dashboard','prep','shipments','lavarion','returns','recovery','admin','jack','audit','lookup','settings','insights'];
    const back=(document.querySelector('.page.active')||{id:'page-prep'}).id.slice(5);
    const errs=[];const onErr=e=>errs.push((e.message||String(e.reason||e))+'');
    window.addEventListener('error',onErr);window.addEventListener('unhandledrejection',onErr);
    try{
      for(const p of pages){
        if(!document.getElementById('page-'+p))continue;
        try{goPage(p,document.querySelector(`[onclick^="goPage('${p}'"]`));}catch(e){errs.push(p+': '+e.message);}
        await new Promise(r=>setTimeout(r,250));
        if(errs.length)throw new Error('opening '+p+' — '+errs.join(' · '));
        const pg=document.getElementById('page-'+p);
        ok(pg.classList.contains('active'),p+' is the page on screen');
      }
    }finally{
      window.removeEventListener('error',onErr);window.removeEventListener('unhandledrejection',onErr);
      try{goPage(back,document.querySelector(`[onclick^="goPage('${back}'"]`));}catch(e){}
    }
  };

  /* 82 — the SellerFuse check (Jack, 23 Oct "go"): a pretend run shaped like today's real finds */
  S['SellerFuse check: late answer, unstamped sends, PLUB misses and copies, stock, put-back, SKU rule, IDs']=async()=>{
    if(LV3.__booted&&!LV3.__booted())await LV3.boot();
    const keep={save:window.saveRow,sx:window.saveSyncExcluded,run:SFRUN,ex:_syncExcluded.slice(),ls:lavShipments.slice()};
    const D=typeof LV3.__D==='function'?LV3.__D():LV3.__D;const set0=JSON.stringify(D.settings||{});
    window.saveRow=async()=>true;window.saveSyncExcluded=async()=>true;
    try{
      /* a late order whose sister SKU sent exactly its own — the answer is "clear" */
      const L=mkRow({asin:'B0CHKSF001',sku:'CHK_SF_LATE',exp:6,rcvd:0,status:'In-Transit'});
      const sis=mkRow({asin:'B0CHKSF001',sku:'CHK_SF_SIS',exp:4,rcvd:4,ship:4,status:'Sent to Amazon',shipSegments:[{shipId:'FBA15CHKSF01',units:4,date:'2026-10-01',type:'Standard'}]});
      /* a late order Amazon actually received — PrepHub has nothing booked in */
      const M=mkRow({asin:'B0CHKSF002',sku:'CHK_SF_MISS',exp:5,rcvd:0,status:'In-Transit'});
      /* booked in 10, stamped 8 — Amazon got 10 */
      const U=mkRow({asin:'B0CHKSF003',sku:'CHK_SF_UNST',exp:10,rcvd:10,ship:8,status:'Part Sent',shipSegments:[{shipId:'FBA15CHKSF03',units:8,date:'2026-10-02',type:'Standard'}]});
      const pl='B0GJTS8MFL';
      lavShipments.push({uuid:'chk-ls-1',shipId:'FBA15CHKSF04',asin:pl,sku:'',prod:'Charlie',units:20,cost:6.88,date:'2026-10-03'},
                        {uuid:'chk-ls-2',shipId:'FBA15CHKSF04',asin:pl,sku:'',prod:'Charlie',units:20,cost:6.88,date:'2026-10-03'});
      _syncExcluded.push({syncId:'CHK_SF_EX|#1',sku:'CHK_SF_EX',asin:'B0CHKSF009',prod:'CHECK ROW put back',oid:'#1'});
      SFRUN={id:'chk-run',at:new Date().toISOString(),from:'2026-10-01',to:'2026-10-23',
        shipments:[{id:'FBA15CHKSF01',created:'2026-10-01',status:'CLOSED',lines:[{sku:'CHK_SF_SIS',asin:'B0CHKSF001',units:4}]},
                   {id:'FBA15CHKSF02',created:'2026-10-05',status:'CLOSED',lines:[{sku:'CHK_SF_MISS',asin:'B0CHKSF002',units:5}]},
                   {id:'FBA15CHKSF03',created:'2026-10-02',status:'CLOSED',lines:[{sku:'CHK_SF_UNST',asin:'B0CHKSF003',units:10}]},
                   {id:'FBA15CHKSF04',created:'2026-10-03',status:'CLOSED',lines:[{sku:'HA-J5IG-SEMD',asin:pl,units:20}]},
                   {id:'FBA15CHKSF05',created:'2026-10-19',status:'CLOSED',lines:[{sku:'HA-J5IG-SEMD',asin:pl,units:7}]}],
        late:[{rowId:L.uuid,sku:L.sku,own:[],asinSkus:[{sku:'CHK_SF_SIS',id:'FBA15CHKSF01',date:'2026-10-01',units:4}]}],
        stock:[{asin:pl,sku:'HA-J5IG-SEMD',available:44,inbound:0,pending:1}],sold:[{asin:pl,units30:30}],
        excluded:[{syncId:'CHK_SF_EX|#1',sku:'CHK_SF_EX',shipments:[{id:'FBA15CHKSF06',date:'2026-08-21',units:3}]}],summary:{}};
      window.SFRUN=SFRUN;
      eq(sfLateFor(L).state,'clear','late order: not shipped, sister SKU sent only its own — clear');
      ok(/not on any shipment/.test(sfFactHtml(L)),'Sarah’s card says so');
      const items=sfPrepIssues();
      const iM=items.find(i=>i.sku==='CHK_SF_MISS'),iU=items.find(i=>i.sku==='CHK_SF_UNST');
      ok(iM&&iM.kind==='late'&&iM.miss===5,'late order Amazon received is listed (5)');
      ok(iU&&iU.kind==='send'&&iU.miss===2,'unstamped send is listed (2)');
      ok(!items.some(i=>i.asin===pl),'PLUB lines are not on Sarah’s list');
      sfRecord(iM.id);await wait(60);document.getElementById('confirmOkBtn').click();await wait(400);
      eq(parseInt(M.rcvd),5,'Record it books the 5 in');eq(_sentOut(M),5,'and stamps them');
      ok((M.shipSegments||[]).some(x=>x.shipId==='FBA15CHKSF02'&&x.date==='2026-10-05'),'on the real shipment, with SellerFuse’s date');
      ok(!sfPrepIssues().some(i=>i.sku==='CHK_SF_MISS'),'and it leaves the list');
      const pi=sfPlubIssues();
      ok(pi.some(i=>i.kind==='dup'&&i.shipId==='FBA15CHKSF04'&&i.copy&&i.copy.uuid==='chk-ls-2'),'PLUB send recorded twice is found, with the copy');
      ok(pi.some(i=>i.kind==='missing'&&i.shipId==='FBA15CHKSF05'&&i.miss===7),'PLUB send missing from PLUB is found (7)');
      /* stock at Amazon: available less the pending order, applied once */
      D.settings.sfApplied='';D.settings.atAmzAt=D.settings.atAmzAt||{};delete D.settings.atAmzAt[pl];
      LV3.sfApplyFromRun(SFRUN);
      eq(D.settings.atAmz[pl],43,'stock at Amazon = 44 available − 1 pending');eq((D.settings.sfSold[pl]||{}).u30,30,'sold in 30 days filled');
      eq(LV3.sfApplyFromRun(SFRUN),0,'a run applies once');
      /* removed from the sheet, but Amazon has it — it comes back */
      eq(await sfPutBackExcluded(),1,'the removed order is put back');
      const back=rows.find(r=>r.sheetSyncId==='CHK_SF_EX|#1');back._chk=true;
      ok(back&&parseInt(back.rcvd)===3&&_sentOut(back)===3,'with 3 booked in and sent');
      ok(!_syncExcluded.some(x=>x.syncId==='CHK_SF_EX|#1'),'and no longer blocked from the sheet');
      /* went out under X: X must have sent more than its own orders */
      eq(sfSkuSpare('CHK_SF_SIS',L),0,'a sister that sent only its own has no spare');
      SFRUN.shipments[0].lines[0].units=7;
      eq(sfSkuSpare('CHK_SF_SIS',L),3,'Amazon got 3 more under it than PrepHub recorded — 3 spare');
      /* shipment IDs */
      eq(_cleanShipId('SHIPMENT ID: fba15m720k7g').id,'FBA15M720K7G','a pasted label is stripped');
      ok(!_cleanShipId('12345').ok,'anything else is refused');
    }finally{
      window.saveRow=keep.save;window.saveSyncExcluded=keep.sx;SFRUN=keep.run;window.SFRUN=keep.run;
      _syncExcluded.length=0;keep.ex.forEach(x=>_syncExcluded.push(x));
      lavShipments.length=0;keep.ls.forEach(x=>lavShipments.push(x));
      try{const s0=JSON.parse(set0);Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,s0);}catch(e){}
    }
  };

  /* 83 — Jack, 23 Oct: "why are these still on the prep sheet?" Finished rows that could never clear */
  S['ready to clear: resolved issue flags and units sent under another SKU no longer hold a finished row']=async()=>{
    const old=new Date(Date.now()-20*864e5).toISOString().slice(0,10);
    const seg=n=>[{shipId:'FBA15CHKCLR1',units:n,date:old,type:'Standard'}];
    const d=mkRow({exp:36,rcvd:36,ship:34,status:'Sent to Amazon',sent:'Yes',sentDate:old,issueType:'Damaged',issueQty:2,shipSegments:seg(34),allShipIds:['FBA15CHKCLR1'],shipId:'FBA15CHKCLR1'});
    ok(/has an issue/.test(acHold(d)||''),'an open damaged flag still holds the row');
    mkClaim({prepRowId:d.uuid,cst:'Resolved',issT:'Damaged'});
    ok(!/has an issue|numbers do not match/.test(acHold(d)||''),'once its claim is resolved, 34 sent + 2 damaged held back is finished');
    const w=mkRow({exp:70,rcvd:70,ship:23,status:'Sent to Amazon',sent:'Yes',sentDate:old,shipSegments:seg(23),allShipIds:['FBA15CHKCLR1'],shipId:'FBA15CHKCLR1',
      resolution:{what:'wrong-sku',state:'approved',elsewhereShipped:47,settled:{at:new Date(Date.now()-20*864e5).toISOString()}}});
    ok(!/numbers do not match/.test(acHold(w)||''),'23 sent here + 47 under another SKU = 70 — not a mismatch');
    const a=mkRow({exp:28,rcvd:28,ship:0,status:'In-Transit',resolution:{what:'wrong-sku',state:'approved',elsewhereShipped:28,settled:{at:new Date(Date.now()-20*864e5).toISOString()}}});
    eq(acHold(a),null,'everything went out under another SKU — clears from when it was settled');
    const sh=mkRow({exp:10,rcvd:10,ship:0,status:'In Warehouse'});
    eq(acHold(sh),'not sent to Amazon yet','stock still on the shelf never clears');
  };

  /* 84 — the PLUB rebuild (Jack, 23 Oct: A B C F H I J K L yes; M, N answered). Sales from SellerFuse
     lead (7-day spike, damped); a zero never wipes a real month; a dated figure beats both; Build &
     send has no "no sends" grey-out and Ship opens at the plan; Alibaba is Jack's lane; long-lead
     parts warn 30 days out; the Products page and the Planner draw their new columns and rows. */
  S['PLUB rebuild: SellerFuse pace, dated figure, ranking, money at stake, owner lanes, long leads, new Products columns, Planner table']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),set0=JSON.stringify(D.settings||{}),logN=D.log.length;
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      const p=D.products.find(x=>!x.archived&&x.type==='bundle'&&(D.settings.atAmzAt||{})[x.asin]);
      ok(p,'a counted bundle to test with');if(!p)return;
      D.settings.planSeason={};D.settings.acPause={};D.settings.hubSkip={};D.settings.stockOuts=[];
      const now=new Date().toISOString();D.settings.sfSold=D.settings.sfSold||{};
      /* C (b618, two clocks): 24 in 30 days, 13 in the last 7 — it runs out at the faster 13/7 a day */
      D.settings.sfSold[p.asin]={u30:24,u7:13,at:now};
      let d=LV3.__plRow(p).demand;
      ok(d&&d.src==='sf'&&Math.abs(d.m-55.7)<0.2&&/7 days/.test(d.label),'a Christmas ramp runs out on the 7-day pace (55.7 a month), labelled as such');
      D.settings.sfSold[p.asin]={u30:60,u7:10,at:now};d=LV3.__plRow(p).demand;
      ok(d&&Math.abs(d.m-60)<0.01,'a slow week does not drag a steady seller down — the 30-day pace stands');
      /* a stale check steps aside */
      D.settings.sfSold[p.asin]={u30:60,u7:10,at:'2026-01-01T00:00:00Z'};d=LV3.__plRow(p).demand;
      ok(!d||d.src!=='sf','a SellerFuse figure over a week old is not used');
      /* N: a dated figure beats the sales until its end date */
      D.settings.sfSold[p.asin]={u30:60,u7:10,at:now};
      D.settings.planSeason[p.asin]={m:9,until:'2099-03-31',by:'CHECK'};d=LV3.__plRow(p).demand;
      ok(d&&d.src==='season'&&d.m===9,'a planning figure with an end date wins');
      D.settings.planSeason[p.asin]={m:9,until:'2020-03-31',by:'CHECK'};d=LV3.__plRow(p).demand;
      ok(d&&d.src==='sf','and steps aside once the date has passed');
      delete D.settings.planSeason[p.asin];
      /* "good sales data": empty now, sold 3 this month but 60 the month before — plan at the month before */
      D.settings.atAmz[p.asin]=0;D.settings.sfSold[p.asin]={u30:3,u7:0,p30:60,at:now};d=LV3.__plRow(p).demand;
      ok(d&&d.m===60&&/ran out/.test(d.label),'a product that ran out is planned off the month before, not its empty month');
      /* the count is aged: 20 counted 2 days ago, selling 1 a day → about 18 now */
      D.settings.atAmz[p.asin]=20;D.settings.atAmzAt[p.asin]=new Date(Date.now()-2*864e5).toISOString();
      D.settings.sfSold[p.asin]={u30:30,u7:7,at:now};let rr=LV3.__plRow(p);
      ok(rr.counted===20&&rr.sell===18&&rr.soldSince===2,'sales since the count come off (20 counted, ~18 now)');
      /* a blip: 30 a month, 14 last week — the send covers the cover at the size pace, never under 3 weeks at the fast one */
      D.settings.sfSold[p.asin]={u30:30,u7:14,at:now};rr=LV3.__plRow(p);
      const cov=LV3.coverDaysOf(p);
      if(rr.trigger)ok(Math.abs(rr.want-Math.round(Math.max(rr.sizeAds*cov,rr.ads*21)))<=1&&rr.ads===2,'a jump in sales: runs out at the fast pace, sized on the middle, never under 3 weeks at the fast pace');
      /* the buffer: 60 units at 2 a day = 30 days; the send has to land with the 14-day buffer intact */
      const u0=LV3.sendUrgency({p,ads:2,sell:60,inb:0,alloc:10,landIso:rr.landIso});
      ok(u0&&!u0.losing&&u0.slack===Math.floor(30-Math.round((new Date(rr.landIso+'T00:00:00')-new Date(new Date().toISOString().slice(0,10)+'T00:00:00'))/864e5)-u0.saf),'the send-by date keeps the safety buffer');
      /* never last minute: lines come onto the list a week before they are due */
      D.settings.sfSold[p.asin]={u30:30,u7:7,at:now};D.settings.atAmzAt[p.asin]=new Date().toISOString();
      const fbaD=Math.round((new Date(rr.landIso+'T00:00:00')-new Date(new Date().toISOString().slice(0,10)+'T00:00:00'))/864e5);
      D.settings.atAmz[p.asin]=fbaD+14+5;D.settings.atAmzIn&&delete D.settings.atAmzIn[p.asin];
      ok(LV3.__plRow(p).trigger,'a line due in 5 days is already on the list');
      /* one ASIN, two SKUs (Gluten Free Snacks) — stock adds up instead of the second overwriting the first */
      D.settings.sfApplied='';if(D.settings.atAmzAt)delete D.settings.atAmzAt[p.asin];
      LV3.sfApplyFromRun({id:'chk-two-sku',at:new Date().toISOString(),sold:[],
        stock:[{asin:p.asin,sku:'A',available:1,inbound:0,pending:0,profit:7.37},{asin:p.asin,sku:'B',available:0,inbound:36,pending:0,profit:11.74}]});
      ok(D.settings.atAmz[p.asin]===1&&D.settings.atAmzIn[p.asin]===36,'two SKUs on one ASIN add up (1 available, 36 inbound)');
      /* F: Ship opens at the planned number, capped at what can be built */
      LV3.openShip(p.id,3);await wait(60);
      const q=document.getElementById('shipQty');ok(q&&+q.value===3,'Ship opens at the planned number');LV3.cm('lav3Ov1');
      /* A + I: the Action centre */
      goPage('lavarion');LV3.go('overview');await wait(250);
      const pg=document.getElementById('page-lavarion');
      ok(!/NO SENDS IN 30 DAYS/.test(pg.textContent),'nothing is greyed out for not having been sent');
      ok(pg.querySelector('#ac-order')&&pg.querySelector('#ac-orderj'),'two order lanes — Becki and Jack');
      const jRows=[...pg.querySelectorAll('#ac-orderj .acx')].map(r=>r.textContent),bRows=[...pg.querySelectorAll('#ac-order .acx')].map(r=>r.textContent);
      ok(!bRows.some(t=>/Alibaba/i.test(t))&&jRows.every(t=>/Alibaba|nothing on order/i.test(t)),'Alibaba orders are only in Jack’s lane');
      const ship=[...pg.querySelectorAll('#ac-send .acx .acxSendN')].map(b=>b.textContent);
      ok(ship.every(t=>/^Send \d/.test(t))&&!pg.querySelector('#ac-send .acx .acxBtns .btn.go'),'every Build & send line says how many to send — a figure, not a button');
      /* the send list (Jack, 23 Oct): numbered top-down; lines losing sales every day they wait come before ones that can still wait */
      const sl=[...pg.querySelectorAll('#ac-send .acx')];
      ok(sl.every((r,i)=>(r.querySelector('.acxNum')||{}).textContent===String(i+1)),'the send list is numbered from the top');
      const kinds=sl.map(r=>/EMPTY AT AMAZON|RUNS OUT BEFORE/.test(r.querySelector('.acxChip').textContent)?0:/COVERED/.test(r.querySelector('.acxChip').textContent)?2:1);
      ok(kinds.every((k,i)=>i===0||k>=kinds[i-1]),'losing-sales lines first, then send-by dates, then the covered ones');
      const fake={p,ads:2,sell:4,inb:0,alloc:10,landIso:LV3.__plRow(p).landIso};
      ok(LV3.sendUrgency(fake).losing,'2 days of stock with a 2-week trip to Amazon is losing sales now');
      ok(!LV3.sendUrgency(Object.assign({},fake,{sell:100})).losing,'50 days of stock can still wait');
      /* H: the noon check reads the right people */
      const today=new Date().toISOString().slice(0,10);
      ok(LV3.acUkMissing({Becki:today+'T09:00:00Z'})===false,'Becki opening it counts');
      const u=_ukParts(new Date());
      if(u.h>=12&&u.wd>0&&u.wd<6)ok(LV3.acUkMissing({Jack:today+'T09:00:00Z',Sarah:today+'T09:00:00Z'})===true,'Jack and Sarah opening it do not');
      /* J: a part with a long lead warns 30 days out */
      const L=LV3.__plData().buys.find(x=>x.lead>=30&&x.buyByDays!=null&&x.buyByDays>7&&x.buyByDays<=30);
      if(L)eq(L.state,'soon','a 60-day part shows 30 days before its order-by date');
      /* K: Products page */
      LV3.go('products');await wait(250);
      const heads=[...pg.querySelectorAll('thead th')].map(t=>t.textContent);
      ok(['Days left','Sold 7d','Per day','Last sent'].every(h=>heads.some(x=>x.includes(h))),'the new Products columns are there');
      /* L: Planner */
      /* audit, 23 Oct: lists rank by the money at stake — empty tomorrow beats empty in a week,
         a long part lead raises the stake, and a product with stock to spare loses nothing */
      D.settings.sfProfit=Object.assign({},D.settings.sfProfit,{B0CHKLOSSA:2,B0CHKLOSSB:2});
      const F=LV3.fbaCalDays(),fk=(asin,sell)=>({p:{asin,name:asin},sell,ads:3,inb:0});
      const La=LV3.lossOfRows([fk('B0CHKLOSSA',1)]),Lb=LV3.lossOfRows([fk('B0CHKLOSSB',3*(F-1))]),Lc=LV3.lossOfRows([fk('B0CHKLOSSB',3*(F+40))]);
      ok(La.lost===6&&Lb.lost===6,'both short products lose 3 a day × £2 = £6 a day');
      ok(La.stake>Lb.stake,'the one empty tomorrow has more at stake than the one that lasts almost to the trip');
      ok(LV3.lossOfRows([fk('B0CHKLOSSA',1)],30).stake>La.stake,'a 30-day part lead raises the stake');
      ok(Lc.lost===0&&Lc.stake===0,'a product with stock to spare loses nothing');
      ok(La.worst&&La.worst.name==='B0CHKLOSSA','the soonest to empty is named');
      LV3.go('planner');await wait(300);
      ok(pg.querySelector('table.plT tbody .plR'),'the Planner is one table of rows');
      ok(pg.querySelectorAll('.plT .plR .plWho').length>0,'every row says whose it is');
    }finally{
      try{const s0=JSON.parse(set0);Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,s0);}catch(e){}
      D.log.splice(0,D.log.length-logN);
      try{LV3.render();}catch(e){}
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}
    }
  };

  /* 85 — Sarah's triage as cards (Jack, 23 Oct: "yes love it"): the double check in order, answered
     by SellerFuse, and the button that matches the answer first */
  S['Triage cards: SellerFuse answers the two checks and the matching button leads']=async()=>{
    const keep=SFRUN;
    try{
      const R=mkRow({asin:'B0CHKTC001',sku:'CHK_TC_A',exp:9,rcvd:9,ship:5,status:'Part Sent',
        shipSegments:[{shipId:'FBA15CHKTC01',units:5,date:'2026-10-16',type:'Standard'}]});
      SFRUN={id:'chk-tc',at:new Date().toISOString(),shipments:[],stock:[],sold:[],excluded:[],summary:{},
        late:[{rowId:R.uuid,sku:'CHK_TC_A',kind:'shelf',own:[{id:'FBA15CHKTC01',date:'2026-10-16',units:5}],asinSkus:[]}]};
      window.SFRUN=SFRUN;
      eq(sfLateFor(R).state,'clear','sent only what PrepHub has, nothing under another SKU — clear');
      ok(/Send to Becki/.test(_tcSkuBtns(R.uuid))&&/tcBig/.test(_tcSkuBtns(R.uuid)),'the big button is Send to Becki');
      SFRUN.late[0].own[0].units=8;
      eq(sfLateFor(R).state,'shipped','3 more went out under this SKU than PrepHub has — found');
      ok(/Fix it/.test(_tcSkuBtns(R.uuid)),'the big button is Fix it');
      SFRUN.late[0].own[0].units=5;SFRUN.late[0].asinSkus=[{sku:'CHK_TC_B',id:'FBA15CHKTC02',date:'2026-10-17',units:4}];
      eq(sfLateFor(R).state,'other','4 under a sister SKU PrepHub never recorded — probably that');
      ok(/went out under CHK_TC_B/.test(_tcSkuBtns(R.uuid)),'the big button names the sister SKU');
      goPage('admin');await wait(300);
      ok(document.querySelector('#page-admin .tcard'),'Sarah’s page draws cards');
    }finally{SFRUN=keep;window.SFRUN=keep;}
  };

  function D_products(){try{return (LV3.allProducts&&LV3.allProducts())||[];}catch(e){return [];}}
  /* 86 — v55.5 (26 Oct): the SAS stock rule, a same-day send, days empty / lost so far / still
     to lose, the margin's source, the calmer wording and the stat chips */
  S['v55.5: SAS stock rule, same-day sends, days empty / lost so far / still to lose, calmer wording']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),set0=JSON.stringify(D.settings||{}),logN=D.log.length,shipN=lavShipments.length;
    const was=(document.querySelector('.page.active')||{}).id||'';
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    try{
      const p=D.products.find(x=>!x.archived&&x.asin&&x.type==='bundle');ok(p,'a bundle to test with');if(!p)return;
      const now=new Date(),at=now.toISOString(),today=isoDay(now);
      D.settings.sfApplied='';
      const k=LV3.sfApplyFromRun({id:'chk-555',at,from:'2026-10-20',to:'2026-10-26',shipments:[],late:[],excluded:[],summary:{},
        stock:[{asin:p.asin,sku:'CHK-A',available:5,inbound:3,transfer:7,processing:1,orders:2,price:10,profit:2,profitSrc:'sf',lastSold:'2026-10-20'},
               {asin:p.asin,sku:'CHK-B',available:0,inbound:4,transfer:0,processing:0,orders:0,price:9,profit:5,profitSrc:'hist',lastSold:'2026-10-18'}],
        sold:[{asin:p.asin,units30:30,units7:7}]});
      ok(k>0,'the run applied');
      eq(D.settings.atAmz[p.asin],5,'at Amazon = available (processing and customer orders not counted)');
      eq(D.settings.atAmzIn[p.asin],14,'on the way = inbound + moving between Amazon warehouses, both SKUs added up');
      eq(D.settings.atAmzMov[p.asin],7,'the moving figure is kept for the line');
      eq(D.settings.sfProfit[p.asin],2,'the costed SellerFuse margin beats the one from history');
      eq(D.settings.sfProfitSrc[p.asin],'sf','and is marked as SellerFuse\'s');
      eq(D.settings.sfLastSold[p.asin],'2026-10-20','the latest last-sold date across the SKUs');
      /* moving stock is its own tranche, ~3 days out; shipping stock keeps the FBA pipeline */
      {const r0=LV3.__plRow(p);ok(r0.tranches&&r0.tranches.length===2,'two tranches on the way — got '+JSON.stringify(r0.tranches));
        const mv=r0.tranches.find(x=>x.mov);ok(mv&&mv.q===7,'the moving tranche is the 7 moving units');
        ok(mv&&mv.eta<=isoDay(new Date(now.getTime()+4*864e5)),'and it is sellable within about 3 days — got '+(mv&&mv.eta));}
      /* a part only costs the gap after the units that can be built now have gone */
      {const fk={p,sell:7,ads:1.9,inb:0,alloc:69,rec:112,tranches:[]};const a=LV3.lossOfRows([fk],6,true),b=LV3.lossOfRows([fk],6);
        ok(a.lost===0&&a.stake===0,'69 sendable now + 7 at Amazon outlast a 6-day order + the trip: the part costs nothing yet');
        ok(b.lost>0,'while the plain figure (the product itself) still says it is losing');
        const fk2={p,sell:0,ads:1.9,inb:0,alloc:0,rec:112,tranches:[]};const c=LV3.lossOfRows([fk2],6,true);ok(c.lost>0&&c.stake>0,'with nothing buildable the part carries the whole gap');}
      /* a send recorded after the count, on the count's day, is on its way; one from before it is already in the count */
      const cMs=new Date(D.settings.atAmzAt[p.asin]).getTime();
      lavShipments.push({_chk:true,asin:p.asin,units:9,date:today,at:new Date(cMs+3600e3).toISOString(),shipId:'FBA-CHK555'});
      let r=LV3.__plRow(p);eq(r.since,9,'a send recorded after the count counts as on its way');
      lavShipments[lavShipments.length-1].at=new Date(cMs-3600e3).toISOString();
      r=LV3.__plRow(p);eq(r.since,0,'a send recorded before the count is already in it');
      lavShipments.pop();
      /* the three figures, on an empty line selling 1 a day at £2 */
      D.settings.planSeason={};D.settings.acPause={};D.settings.hubSkip={};D.settings.stockOuts=[];
      D.settings.sfSold[p.asin]={u30:30,u7:7,at};D.settings.atAmz[p.asin]=0;D.settings.atAmzIn[p.asin]=0;D.settings.atAmzMov[p.asin]=0;
      D.settings.sfLastSold[p.asin]=(()=>{const x=new Date(now);x.setDate(x.getDate()-4);return isoDay(x);})();   /* calendar days, not 4×24h (clocks change) */
      r=LV3.__plRow(p);const u=LV3.sendUrgency(r),L=LV3.lossLine(r,u);
      ok(L.empty&&L.emptyDays===4,'empty for 4 days, from the last-sold date — got '+L.emptyDays);
      ok(Math.abs(L.lostSoFar-4*1*2)<0.01,'lost so far = 4 days × 1 a day × £2 — got '+L.lostSoFar);
      ok(L.land>=10&&Math.abs(L.toLose-L.land*1*2)<0.01,'still to lose = the days until a send today sells × 1 a day × £2');
      eq(LV3.profitSrcOf(p),'sf','the margin source is known');
      delete D.settings.sfProfit[p.asin];eq(LV3.profitSrcOf(p),'typical','with no margin on record the line is marked typical');
      /* the page: calm chips, stat chips, the jump bar */
      LV3.go('overview');await wait(500);
      const all=document.getElementById('lav3View').textContent;
      ok(!/LOSING SALES|AT RISK|NOTHING ON ORDER|TOO LATE|AMAZON EMPTY/.test(all),'the old wording is gone');
      ok(document.querySelector('#ac-send .acxS .sGrid .sCell')&&document.querySelector('#ac-send .acxS .sAsin'),'send lines are cards — name, ASIN, a row of figures');
      ok(document.querySelector('.acJump'),'the jump bar is there');
    }finally{
      try{const s0=JSON.parse(set0);Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,s0);}catch(e){}
      D.log.splice(0,D.log.length-logN);
      for(let i=lavShipments.length-1;i>=shipN;i--)lavShipments.splice(i,1);
      try{LV3.render();}catch(e){}
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}
    }
  };

  /* 87 — v55.6 (Jack, 26 Oct: "we should never ever run out of stock — but not send or buy way too
     much"): two clocks, sales over sellable days (n/a when it mostly wasn't), the 10-unit floor and the
     extra day over 100 a month, part dates that never come after the send they hold up, the stock-out
     record opening and closing from the counts, the Stock health page, the late-orders snapshot */
  S['v55.6: two clocks, sellable days, the unit floor, part dates from sends, stock-out record, Stock health']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),set0=JSON.stringify(D.settings||{}),logN=D.log.length,shipN=lavShipments.length;
    const was=(document.querySelector('.page.active')||{}).id||'';
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    try{
      const p=D.products.find(x=>!x.archived&&x.asin&&x.type==='bundle');ok(p,'a bundle to test with');if(!p)return;
      const now=new Date(),at=now.toISOString(),today=isoDay(now),ago=k=>{const x=new Date(now);x.setDate(x.getDate()-k);return isoDay(x);};
      D.settings.planSeason={};D.settings.acPause={};D.settings.hubSkip={};D.settings.stockOuts=[];D.settings.sfSold=D.settings.sfSold||{};
      /* an old line (first send 200 days ago), so "new line" sizing stays out of it */
      lavShipments.push({_chk:true,asin:p.asin,units:1,date:ago(200),at:new Date(now.getTime()-200*864e5).toISOString(),shipId:'FBA-CHK556'});
      D.settings.atAmz[p.asin]=40;D.settings.atAmzAt[p.asin]=at;
      /* two clocks: 14 / 21 / 30 over 7 / 14 / 30 days — runs out at 2 a day, sized at 1.5 */
      D.settings.sfSold[p.asin]={u30:30,u14:21,u7:14,at};
      let pc=LV3.sfPace(p);
      ok(pc&&Math.abs(pc.perDay-2)<1e-9&&pc.fastW===7,'it runs out on the fastest clock (7 days, 2 a day)');
      ok(pc&&Math.abs(pc.size-1.5)<1e-9,'the send is sized on the 14-day pace (1.5 a day)');
      let r=LV3.__plRow(p);
      ok(Math.abs(r.ads-2)<0.01&&Math.abs(r.sizeAds-1.5)<0.01,'the planner carries both — run-out pace and size pace');
      if(r.trigger)ok(Math.abs(r.want-Math.round(Math.max(1.5*LV3.coverDaysOf(p),2*21)))<=1,'the send: the cover at 1.5 a day, never under 3 weeks at 2 a day');
      /* a slowing line is sized on the slower recent pace and says so */
      D.settings.sfSold[p.asin]={u30:60,u14:14,u7:4,at};pc=LV3.sfPace(p);
      ok(pc.slow&&Math.abs(pc.perDay-2)<1e-9&&Math.abs(pc.size-1)<1e-9,'slowing: runs out at the month (2 a day), sized at the 14 days (1 a day)');
      /* sellable days: 6 sold in a week it was empty 4 days of = 2 a day; empty all week = n/a */
      D.settings.sfSold[p.asin]={u30:30,u7:6,at};
      D.settings.stockOuts=[{id:'chk1',asin:p.asin,kind:'out',from:ago(4),to:ago(1),pace:1,pu:2}];
      pc=LV3.sfPace(p);
      ok(pc.empty[7]===4&&Math.abs(pc.p7-2)<1e-9,'6 sold in the 3 days it could be bought = 2 a day — got '+(pc&&pc.p7));
      D.settings.stockOuts=[{id:'chk2',asin:p.asin,kind:'out',from:ago(10),to:null,pace:1,pu:2}];
      pc=LV3.sfPace(p);
      ok(pc.p7==null&&pc.p14==null,'a week it could not be bought is n/a, not 0 and not blown up');
      D.settings.stockOuts=[{id:'chk3',asin:p.asin,kind:'out',from:ago(25),to:null,pace:1,pu:2}];
      D.settings.sfSold[p.asin]={u30:30,u7:6,p30:45,at};pc=LV3.sfPace(p);
      ok(pc.p30!=null&&pc.p30<=45/30+1e-9,'a mostly-empty month falls back to the month before, never a blown-up figure');
      D.settings.stockOuts=[];
      /* the floor: 14 days and 10 units (half a send for the very slow); +1 day at 100+ a month */
      const cov=LV3.coverDaysOf(p),sd=LV3.safetyFor;
      const base=sd(p,2,2);
      ok(base>=1&&sd(p,4,4)===base+1,'4 a day (120 a month) gets one more day than 2 a day ('+base+' → '+sd(p,4,4)+')');
      const slowU=Math.min(10,Math.max(1,Math.round(0.5*cov/2)));
      eq(sd(p,0.5,0.5),Math.max(base,Math.ceil(slowU/0.5)),'0.5 a day lands with at least '+slowU+' units');
      ok(sd(p,0.05,0.05)<120,'a 1-a-month line is not sent half a year');
      /* part dates: a part holding up a send is never due after that send needs it */
      const P=LV3.__plData(),sendL=(P.buys||[]).filter(L=>L.sendDriven);
      ok(sendL.every(L=>L.ownByDays==null||L.buyByDays<=L.ownByDays),'a part holding up a send takes the earlier of the two dates');
      ok(sendL.every(L=>L.state!=='upcoming'||L.buyByDays>14),'a part holding up a send shows 14 days ahead');
      /* the stock-out record: a count at 0 opens it from the day after the last sale; stock back closes it */
      D.settings.sfSold[p.asin]={u30:30,u7:7,at};delete D.settings.atAmzAt[p.asin];
      LV3.sfApplyFromRun({id:'chk-so-1',at:new Date(now.getTime()-3600e3).toISOString(),sold:[{asin:p.asin,units30:30,units7:7,units14:14}],
        stock:[{asin:p.asin,sku:'CHKSO',available:0,inbound:0,transfer:0,pending:0,profit:2,lastSold:ago(3)}]});
      let rec=(D.settings.stockOuts||[]).find(x=>x.asin===p.asin&&x.kind==='out'&&!x.to);
      ok(rec&&rec.from===ago(2),'a count at 0 opens a record from the day after the last sale — got '+(rec&&rec.from));
      ok(rec&&rec.pace>0&&rec.pu>0&&(rec.cause||[]).length&&/^confirmed/.test(rec.conf),'it keeps the pace, the profit, a cause and how sure it is');
      eq((D.settings.sfSold[p.asin]||{}).u14,14,'the 14-day sales are read from the check');
      LV3.sfApplyFromRun({id:'chk-so-1',at:new Date(now.getTime()-3600e3).toISOString(),sold:[],stock:[{asin:p.asin,sku:'CHKSO',available:0,inbound:0,pending:0}]});
      eq((D.settings.stockOuts||[]).filter(x=>x.asin===p.asin&&x.kind==='out'&&!x.to).length,1,'the same run twice opens one record');
      LV3.sfApplyFromRun({id:'chk-so-2',at,sold:[{asin:p.asin,units30:30,units7:7}],stock:[{asin:p.asin,sku:'CHKSO',available:12,inbound:0,pending:0,profit:2}]});
      rec=(D.settings.stockOuts||[]).find(x=>x.id===(rec&&rec.id));
      ok(rec&&rec.to&&rec.to>=rec.from&&rec.to<=today,'stock back closes it — got '+(rec&&rec.to));
      /* a line empty since before tracking keeps ONE record however many runs read it */
      D.settings.stockOuts.push({id:'so_'+p.asin+'_old',asin:p.asin,kind:'before',from:ago(80),to:null,name:p.name});
      D.settings.stockOuts=D.settings.stockOuts.filter(x=>!(x.asin===p.asin&&x.kind==='out'));
      D.settings.sfLastSold[p.asin]=ago(81);D.settings.planSeason[p.asin]={m:9,until:'2099-01-01',by:'CHECK'};   /* still planned to sell, like the Dove lines */
      LV3.sfApplyFromRun({id:'chk-so-b1',at,sold:[{asin:p.asin,units30:0,units7:0}],stock:[{asin:p.asin,sku:'CHKSO',available:0,inbound:0,pending:0}]});
      LV3.sfApplyFromRun({id:'chk-so-b2',at,sold:[{asin:p.asin,units30:0,units7:0}],stock:[{asin:p.asin,sku:'CHKSO',available:0,inbound:0,pending:0}]});
      eq((D.settings.stockOuts||[]).filter(x=>x.asin===p.asin&&!x.to).length,1,'a long-empty line keeps one open record across runs');
      /* Stock health */
      goPage('lavarion');LV3.go('health');await wait(300);
      const pg=document.getElementById('page-lavarion'),tx=pg.textContent;
      ok(/Running out — every stock-out/.test(tx)&&/In the warehouse now — PLUB/.test(tx)&&/Holding too much — at Amazon/.test(tx),'the Stock health page draws its sections');
      ok(pg.querySelector('table.shT tbody tr'),'with the record as a table');
      /* the Action centre keeps a snapshot of late orders for Jack's Dashboard */
      LV3.go('overview');await wait(300);
      ok(D.settings.acLateSnap==null||Array.isArray(D.settings.acLateSnap.list),'late orders are kept for the Dashboard');
      ok(['#ac-order','#ac-orderj'].every(id=>{const ch=[...pg.querySelectorAll(id+' .acx')].map(x=>/ORDER NOW|SHOP RUN NOW|NOT ON THE SHEET/.test((x.querySelector('.acxChip')||{}).textContent||''));
        return ch.every((c,i)=>!c||ch.slice(0,i).every(Boolean));}),'late orders sit at the top of their lane');
      ok(![...pg.querySelectorAll('#ac-order .acxChip,#ac-orderj .acxChip')].some(x=>/CHASE/.test(x.textContent)),'no CHASE on order lines — ORDER NOW instead');
    }finally{
      try{const s0=JSON.parse(set0);Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,s0);}catch(e){}
      D.log.splice(0,D.log.length-logN);
      for(let i=lavShipments.length-1;i>=shipN;i--)lavShipments.splice(i,1);
      try{LV3.render();}catch(e){}
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}
    }
  };

  /* 88 — v55.8 (Jack, 26 Oct): the send-to-sellable time only ever goes UP from his figure ("much rather
     overestimate"), stuck shipments are found, the Prep Sheet tile row is back to COG In Transit,
     the Dashboard knows what is empty at Amazon */
  S['v55.8: measured send time never lowers the plan, COG In Transit back, empty-at-Amazon line, Monday review, bank holidays']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),set0=JSON.stringify(D.settings||{});
    const was=(document.querySelector('.page.active')||{}).id||'';
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    try{
      const now=new Date(),ago=k=>{const x=new Date(now);x.setDate(x.getDate()-k);return isoDay(x);};
      const p=D.products.find(x=>!x.archived&&x.asin);ok(p,'a product to test with');if(!p)return;
      const set=LV3.primeSet();
      /* quick sends (2–4 working days) never pull the plan below Jack's figure */
      D.settings.sfRecv={at:'chk-1',list:[1,2,3,4].map(i=>({id:'FBACHK'+i,created:ago(20+i),lastReceived:ago(17+i),shipped:10,received:10,status:'RECEIVING',lines:[{asin:p.asin,sku:'X',units:10}]}))};
      let F=LV3.fbaLearn();
      ok(F.n===4&&F.slowest<set,'four quick sends measured ('+F.typical+' typical, '+F.slowest+' slowest)');
      eq(LV3.primeDays(),set,'quick sends never lower the plan — it stays on your figure');
      /* one slow send above Jack's figure raises it */
      D.settings.sfRecv={at:'chk-2',list:D.settings.sfRecv.list.concat([{id:'FBACHKSLOW',created:ago(40),lastReceived:ago(40-Math.ceil((set+6)*1.5)),shipped:10,received:10,status:'CLOSED',lines:[{asin:p.asin,sku:'X',units:10}]}])};
      F=LV3.fbaLearn();
      ok(F.slowest>set&&LV3.primeDays()===Math.min(60,F.slowest),'a slower send raises the plan to the slowest ('+F.slowest+' working days)');
      /* the Prep Sheet tile row */
      goPage('prep');await wait(300);try{renderStats();}catch(e){}
      const ps=document.getElementById('prepStats');
      ok(ps&&/COG In Transit/i.test(ps.textContent)&&!/Booked in today/i.test(ps.textContent)&&!ps.querySelector('.statPair'),'the Prep Sheet has COG In Transit back, not the two small tiles');
      /* the Dashboard line */
      D.settings.stockOuts=[{id:'chk-so',asin:p.asin,name:p.name,kind:'out',from:ago(2),to:null,pace:1,pu:2}];
      ok(typeof _plubEmpty!=='function'||!_isJack()||(_plubEmpty()||[]).length===1,'the Dashboard sees the product empty at Amazon');
      /* the Monday review: Monday 26 Oct looks back at 19–25 Oct */
      const W=_plubWeek([{kind:'out',name:'A',from:'2026-10-21',to:'2026-10-25',pace:2,pu:2,cause:['send late']},{kind:'out',name:'B',from:'2026-10-13',to:'2026-10-20',pace:1,pu:3,cause:['part not ordered — X']},{kind:'out',name:'C',from:'2026-10-01',to:'2026-10-05',pace:9,pu:9,cause:['send late']}],'2026-10-26');
      ok(!LV3.isWorkDay(new Date('2026-12-25T00:00:00'))&&!LV3.isWorkDay(new Date('2026-12-28T00:00:00'))&&LV3.isWorkDay(new Date('2026-12-29T00:00:00'))&&LV3.workDaysAfter('2026-12-24',1)==='2026-12-29','bank holidays are not working days (Christmas Day, the Boxing Day substitute)');
      ok(W&&W.mon==='2026-10-19'&&W.sun==='2026-10-25'&&W.n===2&&W.days===7&&Math.abs(W.lost-26)<0.01&&W.groups.send&&W.groups.part,'Monday review: last week only, 2 products, 7 empty days, £26, by cause');
    }finally{
      try{const s0=JSON.parse(set0);Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,s0);}catch(e){}
      try{LV3.render();}catch(e){}
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}
    }
  };

  /* 89 — b622 (27 Oct): Sarah's answers "came back again" — they had saved; her tab sat on an old copy because
     every refresh was skipped while a hung archive load said "still loading". A tab must heal itself. */
  S['v56.0: a stuck tab heals itself — time limits, skipped refreshes come back, stuck loads restart']=async()=>{
    const st=window.setTimeout;let caught=0;
    const noLater=async f=>{window.setTimeout=(fn,ms)=>{if(ms>=30000){caught++;return 0;}return st(fn,ms);};try{await f();}finally{window.setTimeout=st;}};
    try{
      const t=await _withTimeout(new Promise(()=>{}),200);
      ok(t&&t.error&&/timed out/.test(t.error.message),'a request that never answers gives up instead of hanging');
      const ov=document.createElement('div');ov.className='overlay open';document.body.appendChild(ov);
      _resyncQueued=false;caught=0;await noLater(()=>resyncNow('routine check',true));ov.remove();
      ok(caught===1,'the 15-minute refresh skipped for an open popup is tried again, not dropped');_resyncQueued=false;
      _histStreaming=true;_histStartAt=Date.now();caught=0;await noLater(()=>resyncNow('routine check',true));
      ok(caught===1,'a refresh asked for while the archive is loading is tried again shortly');_resyncQueued=false;
      /* the archive load that hung 3 minutes ago: the next refresh restarts it and reads the database again */
      const pick=await sb.from('prep_rows').select('id').eq('archived',false).order('created_at',{ascending:true}).limit(1);   /* a row that is really in the database — not a test row from an earlier check */
      const r=rows.find(x=>x.uuid===((pick.data||[])[0]||{}).id);ok(r,'a live row to test with');if(!r)return;
      r.delivered='__stale__';
      _histStreaming=true;_histStartAt=Date.now()-180000;const g0=_histGen,f0=_lastFresh;
      await resyncNow('routine check',true);
      let n=0;while(_histStreaming&&n++<60)await wait(250);
      const r2=rows.find(x=>x.uuid===r.uuid);
      ok(_histGen>g0&&_lastFresh>f0,'a load stuck for 3 minutes is restarted and the database is read again');
      const db=await sb.from('prep_rows').select('delivered,status').eq('id',r.uuid).single();
      ok(r2&&r2.delivered!=='__stale__'&&db&&db.data&&(r2.delivered||'')===(db.data.delivered||'')&&r2.status===db.data.status,'the stale copy on screen is replaced by what the database holds');
      ok(!_histStreaming&&_historyReady,'the archive finishes loading afterwards');
    }finally{window.setTimeout=st;_resyncQueued=false;_resyncBusy=false;}
  };

  /* 90 · Jack's tick: one press stamps every order of the ASIN; everyone sees it; a newer order is not covered */
  S['v56.1 b624: Jack’s “all orders of this ASIN checked” tick']=async()=>{
    const keepSave=window._saveAsinChecks,keepC=window.showConfirm,keepA=ASIN_CHECKS;let saved=null,pend=null;
    try{
      window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;saved={A,v};return true;};
      window.showConfirm=(t,x,cb)=>{pend=cb&&cb();};
      const td=todayDDMM();
      const a=mkRow({asin:'B0CHKTICK1',date:td,oid:'202-CHK-T1',exp:2,rcvd:0});
      const b=mkRow({asin:'B0CHKTICK1',date:td,oid:'202-CHK-T2',exp:3,rcvd:3,ship:3});
      who('Sarah');ok(!/asinChkBtn/.test(asinChkTile(a,'card')),'Sarah gets no stamp button');
      who('Jack');ok(/asinChkBtn/.test(asinChkTile(a,'card')),'Jack gets the button on an order with units owed');
      asinChkConfirm(a.uuid);await pend;
      ok(saved&&saved.A==='B0CHKTICK1'&&saved.v&&saved.v.orders.length===2,'both orders of the ASIN are stamped');
      who('Sarah');
      ok(/Jack checked all 2 orders/.test(asinChkTile(a,'card'))&&/Jack checked all 2 orders/.test(asinChkTile(b,'sheet')),'the tick shows on both orders, for Sarah too');
      const c=mkRow({asin:'B0CHKTICK1',date:td,oid:'202-CHK-T3',exp:1});
      ok(/1 newer not checked/.test(asinChkTile(a,'card')),'an order placed after the check counts as newer');
      eq(asinChkTile(c,'card'),'','the newer order itself carries no tick');
      who('Jack');ok(/asinChkBtn/.test(asinChkTile(c,'card')),'Jack can stamp again to cover it');
    }finally{window._saveAsinChecks=keepSave;window.showConfirm=keepC;ASIN_CHECKS=keepA;}
  };
  /* 91 · the C920: a line typed twice → Jack asked "2 or 4?" → Sarah one press; the close-off says the real reason */
  S['v56.1 b624: a line typed twice is spotted, Jack asked “2 or 4?”, Sarah closes it in one press']=async()=>{
    who('Sarah');
    const full=mkRow({asin:'B0CHKDUP01',oid:'202-5081951-0344342',sku:'Amuk_37.99_06106_55_VAS1_CHK',exp:2,rcvd:2,ship:2});
    const copy=mkRow({asin:'B0CHKDUP01',oid:'202-5081951-0344342',sku:'Amuk_37.99_06106_55_VAS_CHK',exp:2,rcvd:0,
      resolution:asked({ask:'Has Amazon delivered it?'})});
    const d=_dupLineOf(copy);
    ok(d&&d.got===2&&d.total===4&&d.sku===full.sku,'the copy is spotted: same order, same product, the other line arrived in full');
    ok(!_dupLineOf(full),'the line that arrived is not a suspect');
    mkRow({asin:'B0CHKDUP02',oid:'202-2650950-0406746',exp:2,rcvd:2,ship:2});mkRow({asin:'B0CHKDUP02',oid:'202-2650950-0406746',exp:2,rcvd:1});
    const s3=mkRow({asin:'B0CHKDUP02',oid:'202-2650950-0406746',exp:1,rcvd:0});
    ok(!_dupLineOf(s3),'another line of the order still short — a split order, not a copy');
    who('Jack');
    const card=_jkCheckActs(copy,copy.uuid);
    ok(/Is order 202-5081951-0344342 2 units or 4/.test(card)&&/jackDupAnswer/.test(card)&&/It was 4/.test(card),'Jack’s card asks 2 or 4, one press either way');
    await jackDupAnswer(copy.uuid);
    eq(copy.resolution.state,'rejected','back with Sarah');ok(copy.resolution.dupOf&&copy.resolution.dupOf.got===2,'his answer carries the duplicate');
    ok(copy.delivered!=='Yes','not recorded as delivered — those units never existed');
    who('Sarah');goPage('admin');renderAdmin();await wait(200);
    const btn=[...document.querySelectorAll('#page-admin button')].find(b=>{const o=b.getAttribute('onclick')||'';return o.includes(copy.uuid)&&o.includes("'duplicate'");});
    ok(btn&&/Close as Duplicate record/.test(btn.textContent),'Sarah gets one press: Close as Duplicate record');
    /* "it was 4" puts the question away for good */
    const copy2=mkRow({asin:'B0CHKDUP03',oid:'202-9925389-0399521',exp:2,rcvd:0,resolution:asked({ask:'Has Amazon delivered it?'})});
    mkRow({asin:'B0CHKDUP03',oid:'202-9925389-0399521',exp:2,rcvd:2,ship:2});
    who('Jack');await jackAnswered(copy2.uuid,'Arrived — YES, the account shows it delivered.',{notDup:true});
    ok(!_dupLineOf(copy2),'after "it was 4" it is no longer a suspect');
    /* the close-off: a sister SKU with nothing spare — the real reason, not "Set the date", and Duplicate offered */
    who('Sarah');openSorted(copy.uuid,'wrong-sku');await wait(50);
    setVal('srtSku',full.sku);srtSkuShut();srtSync();srtAskClose();
    const m=(document.getElementById('srtMsg')||{}).textContent||'';
    ok(!/Set the date/.test(m),'never "Set the date" on a close-off that has no date — got: '+m.slice(0,140));
    ok(/only sent what its own order had/.test(m),'it names the real reason');
    ok(/Duplicate record/.test((document.getElementById('srtSkuWarnTxt')||{}).innerHTML||''),'it offers Duplicate record');
    try{closeSorted();}catch(e){}
  };
  /* 92 · dated spare units + the new schedule */
  S['v56.1 b624: spare units count only after the order; check runs Sun/Tue/Thu 20:00; 04:00 shift']=async()=>{
    const keepRun=SFRUN;
    try{
      const o=mkRow({asin:'B0CHKSPR01',sku:'Amuk_1_01096_0_CHK_SPR',date:'01/09',exp:5,rcvd:5,ship:5});
      const late=mkRow({asin:'B0CHKSPR01',date:todayDDMM(),exp:1,rcvd:0}),older=mkRow({asin:'B0CHKSPR01',date:'01/09',exp:1,rcvd:0});
      SFRUN=Object.assign({late:[],stock:[],sold:[],excluded:[],summary:{}},keepRun||{},
        {shipments:[{id:o.shipSegments[0].shipId,created:'2026-09-02',status:'CLOSED',lines:[{sku:o.sku,asin:o.asin,units:6}]}]});
      eq(sfSkuSpare(o.sku,late),0,'1 extra on 2 Sep does not count for an order placed today');
      eq(sfSkuSpare(o.sku,older),1,'it does count for an order placed before that shipment');
    }finally{SFRUN=keepRun;window.SFRUN=keepRun;}
    eq(SHIFT_START_HOUR,4,'Sarah’s shift starts 04:00 UK');
    const at=(iso,h)=>{const p=iso.split('-').map(Number);return _ukDayStart(p[0],p[1],p[2])+h*36e5;};
    eq(ukWeekdayOf('2026-10-29'),4,'29 Oct 2026 is a Thursday');
    eq(_sfLastSlot(at('2026-10-29',21)),at('2026-10-29',20),'Thu 21:00 → tonight’s 20:00');
    eq(_sfLastSlot(at('2026-11-02',4)),at('2026-11-01',20),'Mon 04:00 → Sunday 20:00');
    eq(_sfLastSlot(at('2026-11-03',19)),at('2026-11-01',20),'Tue 19:00 → still Sunday’s');
    eq(sfNextCheck(at('2026-10-29',19)),'today 20:00','Thu 19:00 → today 20:00');
    eq(sfNextCheck(at('2026-10-29',21)),'Sun 20:00','after Thursday’s the next is Sunday');
    eq(sfNextCheck(at('2026-10-31',10)),'tomorrow 20:00','Saturday → tomorrow');
    eq(_sfMissed(at('2026-10-29',21),at('2026-10-27',20)+6e5),false,'21:00 — not missed yet, it has until 22:00');
    eq(_sfMissed(at('2026-10-29',22)+6e4,at('2026-10-27',20)+6e5),true,'22:01 with only Tuesday’s count → missed');
    eq(_sfMissed(at('2026-10-29',22)+6e4,at('2026-10-29',20)+6e5),false,'tonight’s count landed → fine');
    eq(_sfMissed(at('2026-10-30',4),at('2026-10-29',20)+6e5),false,'Sarah at 04:00 Friday with Thursday’s count');
    eq(_sfMissed(at('2026-11-02',4),at('2026-10-29',20)+6e5),true,'Monday 04:00 with only Thursday’s → Sunday’s was missed');
  };

  /* 93 · the 29 Oct audit's five real cases as fixtures: only the sure ones get one press */
  S['v56.1 b625: SellerFuse fixes — sure ones one press + Undo, the rest for Sarah, never more than the order']=async()=>{
    const keepRun=SFRUN,keepU=window.toastUndo;let undo=null;window.toastUndo=(m,f)=>{undo=f;};
    const seg=(id,u,d)=>({shipSegments:[{shipId:id,units:u,date:d,type:'Standard'}],allShipIds:[id],shipId:id,ship:u});
    try{
      who('Jack');
      const A=mkRow({asin:'B0CHKSFA01',sku:'Amuk_3_26106_0_CHK_SFA',exp:10,rcvd:10,status:'In Warehouse'});        // on the shelf, never stamped
      const B=mkRow({asin:'B0CHKSFB01',sku:'Amuk_99_06106_0_CHK_SFB',exp:2,rcvd:0});                                // late, went out
      const C1=mkRow(Object.assign({asin:'B0CHKSFC01',sku:'Amuk_16_25096_0_CHK_SFC1',exp:10,rcvd:10,status:'Sent to Amazon',sent:'Yes'},seg('FBA15CHKC001',10,'2026-10-28')));
      const C2=mkRow(Object.assign({asin:'B0CHKSFC01',sku:'Amuk_15_17096_0_CHK_SFC2',exp:10,rcvd:10,status:'Sent to Amazon',sent:'Yes'},seg('FBA15CHKC002',10,'2026-10-27')));
      const D=mkRow(Object.assign({asin:'B0CHKSFD01',sku:'Amuk_109_06106_0_CHK_SFD',exp:2,rcvd:1,status:'Part Sent'},seg('FBA15CHKD001',1,'2026-10-28')));
      const E=mkRow({asin:'B0CHKSFE01',sku:'Amuk_5_01106_0_CHK_SFE',exp:10,rcvd:0});                                // partial send
      const L=(id,c,lines)=>({id,created:c,status:'IN_TRANSIT',lines:lines.map(([r,u])=>({sku:r.sku,asin:r.asin,units:u}))});
      SFRUN=Object.assign({late:[],stock:[],sold:[],excluded:[],summary:{}},keepRun||{},{shipments:[
        L('FBA15CHKA001','2026-10-26',[[A,10]]),L('FBA15CHKB001','2026-10-28',[[B,2]]),
        L('FBA15CHKC001','2026-10-28',[[C1,10]]),L('FBA15CHKC002','2026-10-27',[[C1,10]]),     // Amazon has C2's 10 under C1's SKU
        L('FBA15CHKD001','2026-10-28',[[D,1]]),L('FBA15CHKD002','2026-10-28',[[D,2]]),          // 3 under an order of 2
        L('FBA15CHKE001','2026-10-28',[[E,4]])]});
      const mine=new Set([A,B,C1,C2,D,E].map(r=>r.sku));
      const its=()=>sfPrepIssues().filter(i=>mine.has(i.sku));
      const k=sku=>its().filter(i=>i.sku===sku).map(i=>i.kind).join(',');
      eq(k(A.sku),'send','on the shelf, never stamped → one press');
      eq(k(B.sku),'late','late order that went out → one press');
      eq(k(C1.sku),'matched','recorded under the other order’s SKU on the same shipment → nothing missing');
      eq(k(D.sku),'look','3 went under an order of 2 → Sarah looks');
      eq(k(E.sku),'late','part of a late order went → one press');
      /* Fix it, then Undo */
      await sfRecord(its().find(i=>i.sku===A.sku).id);
      eq(A.status,'Sent to Amazon','fixed: Sent to Amazon');eq(_sentOut(A),10,'10 stamped');
      ok(typeof undo==='function','an Undo is offered');await undo();
      eq(_sentOut(A),0,'Undo puts it back');eq(A.status,'In Warehouse','status back too');
      /* the look one is never booked in by Fix it */
      await sfRecord(its().find(i=>i.sku===D.sku).id);eq(D.rcvd,1,'Fix it refuses the one that doesn’t add up');
      await sfBookOwed(its().find(i=>i.sku===D.sku).id);
      eq(D.rcvd,2,'Sarah’s “book in the 1 owed” fills the order');eq(_sentOut(D),2,'…and no more than the order: 2 sent, not 3');
      /* partial: Part Sent, not In-Transit */
      await sfRecord(its().find(i=>i.sku===E.sku).id);
      eq(E.rcvd,4,'4 booked in');eq(E.status,'Part Sent','6 still owed → Part Sent');eq(E.sent,'No','…and not marked sent');
      /* Fix all only touches the sure ones; C stays as it was */
      await sfFixAll();
      eq(_sentOut(B),2,'Fix all fixed the late one');eq(C1.rcvd,10,'never 20 received on an order of 10');eq(_sentOut(C1),10,'C untouched');
      /* pages: the panel on Jack's, Sarah sees only the one to look at */
      SFRUN.shipments=SFRUN.shipments.concat([L('FBA15CHKD003','2026-10-29',[[D,1]])]);   // a fresh extra on D
      goPage('jack');renderJack();await wait(80);
      ok(/SellerFuse check/.test((document.getElementById('jackWrap')||{}).textContent||''),'the SellerFuse panel is on Jack’s page');
      who('Sarah');goPage('admin');renderAdmin();await wait(120);
      const sar=document.getElementById('adminWrap')||document.body;
      ok(![...sar.querySelectorAll('button')].some(b=>/sfRecord\(/.test(b.getAttribute('onclick')||'')),'no one-press Fix it on Sarah’s page');
      ok(/SellerFuse doesn’t add up/.test(sar.textContent||''),'Sarah gets the ones to look at');
    }finally{SFRUN=keepRun;window.SFRUN=keepRun;window.toastUndo=keepU;}
  };
  /* 94 · Amazon's date for a send, and wrong dates corrected */
  S['v56.1 b625: a send takes the day Amazon made the shipment; wrong dates are corrected']=async()=>{
    const keepRun=SFRUN,keepT=SF_DATES_TRUSTED;SF_DATES_TRUSTED=true;
    try{
      SFRUN=Object.assign({late:[],stock:[],sold:[],excluded:[],summary:{}},keepRun||{},{shipments:[{id:'FBA15CHKDT01',created:'2026-10-28',status:'IN_TRANSIT',lines:[]},{id:'FBA15CHKDT02',created:'2026-10-27',status:'IN_TRANSIT',lines:[]}]});
      eq(shipDateFor('FBA15CHKDT01'),'2026-10-28','a shipment nobody has recorded yet takes Amazon’s date, not today');
      const r=mkRow({exp:2,rcvd:2,shipSegments:[{shipId:'FBA15CHKDT02',units:2,date:'2026-10-29',type:'Standard'}],allShipIds:['FBA15CHKDT02'],ship:2,sentDate:'2026-10-29',status:'Sent to Amazon',sent:'Yes'});
      const n=await sfFixShipDates();
      ok(n>=1,'the wrong date is corrected');eq(r.shipSegments[0].date,'2026-10-27','the send now reads Amazon’s 27 Oct');eq(r.sentDate,'2026-10-27','and so does the sent date');
      eq(await sfFixShipDates(),0,'a second pass changes nothing');
      SF_DATES_TRUSTED=false;eq(await sfFixShipDates(),0,'with the switch off nothing moves');
    }finally{SFRUN=keepRun;window.SFRUN=keepRun;SF_DATES_TRUSTED=keepT;}
  };
  /* 95 · the Purchase Sheet's words suggest the button */
  S['v56.1 b625: PLUB shortage — the Purchase Sheet’s words suggest the button']=async()=>{
    const a=_lavSheetSuggest([{arrived:'Issue',notes:'OOS - auto refund on 58 units'}],58);
    ok(a&&a.kind==='auto'&&a.match===true,'“auto refund on 58 units” with 58 short → Auto refunded, numbers match');
    const b=_lavSheetSuggest([{arrived:'Issue',notes:'OOS - auto refund on 50 units'}],58);
    ok(b&&b.kind==='auto'&&b.match===false,'50 on the sheet, 58 short → suggested but flagged to check');
    const c=_lavSheetSuggest([{arrived:'',notes:'write off, not worth chasing'}],3);ok(c&&c.kind==='writeoff','write off → Write it off');
    eq(_lavSheetSuggest([{arrived:'Arrived',notes:'box a bit dented'}],2),null,'anything else suggests nothing');
  };
  /* 96 · eBay stock leaves the Prep Sheet the moment it goes to Recovery */
  S['v56.1 b625: eBay stock leaves the Prep Sheet at once; part of a shelf stays']=async()=>{
    const keep={rc:window.recFromClaim,sc:window.saveClaim};
    window.recFromClaim=async(cl,o)=>({qty:cl.dif});window.saveClaim=async()=>true;
    try{
      const r=mkRow({exp:10,rcvd:10,status:'In Warehouse'});
      const cl=mkClaim({prepRowId:r.uuid,issT:'eBay stock',dif:10,cst:'Needs Attention',log:[]});
      await _ebayToRecovery(cl,10);
      ok(r.archived,'all 10 to eBay → off the Prep Sheet straight away');
      const r2=mkRow({exp:10,rcvd:10,status:'In Warehouse'});
      const cl2=mkClaim({prepRowId:r2.uuid,issT:'eBay stock',dif:3,cst:'Needs Attention',log:[]});
      await _ebayToRecovery(cl2,3);
      ok(!r2.archived,'3 of 10 to eBay → stays, 7 still to send');
    }finally{window.recFromClaim=keep.rc;window.saveClaim=keep.sc;}
  };

  /* 97 · the tester's b624 findings */
  S['v56.1 b625: tester fixes — 3 copies, notDup kept, placeholder orders, tick by row, clock-change Sundays, close-off asks']=async()=>{
    who('Sarah');
    const f=mkRow({asin:'B0CHKTRI01',oid:'203-0271581-CHK1',exp:3,rcvd:3,ship:3});
    const c1=mkRow({asin:'B0CHKTRI01',oid:'203-0271581-CHK1',exp:3,rcvd:0}),c2=mkRow({asin:'B0CHKTRI01',oid:'203-0271581-CHK1',exp:3,rcvd:0});
    const d=_dupLineOf(c1);ok(d&&d.got===3&&d.total===9,'an order typed three times is flagged: 3 units or 9?');ok(_dupLineOf(c2),'…both copies');
    mkRow({asin:'B0CHKTRI02',oid:'N/A',exp:2,rcvd:2,ship:2});const na=mkRow({asin:'B0CHKTRI02',oid:'N/A',exp:2,rcvd:0});
    ok(!_dupLineOf(na),'"N/A" is not an order number — never matched');
    /* "It was 9" survives Sarah sending it to Jack again */
    c1.resolution=asked({ask:'Has Amazon delivered it?'});
    who('Jack');await jackAnswered(c1.uuid,'Arrived — YES, the account shows it delivered.',{notDup:true});
    who('Sarah');askJackAsk(c1.uuid,'free');setVal('askNote','one more question');await askSend();
    ok(c1.resolution.notDup,'his "it was 9" is kept when she sends it back');ok(!_dupLineOf(c1),'…so he is not asked again');
    /* the tick on a row with no order number */
    const keepSave=window._saveAsinChecks,keepC=window.showConfirm,keepA=ASIN_CHECKS;let pend=null;
    try{window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;return true;};
      window.showConfirm=(t,x,cb)=>{pend=cb&&cb();};
      who('Jack');const b=mkRow({asin:'B0CHKTRI03',oid:'',date:todayDDMM(),exp:2});asinChkConfirm(b.uuid);await pend;
      ok(/Jack checked all 1 order/.test(asinChkTile(b,'card')),'a row with no order number gets its tick');
      const old=mkRow({asin:'B0CHKTRI04',oid:'202-CHK-OLD1',date:(()=>{const x=ukAddDays(todayISO(),-70);return x.slice(8)+'/'+x.slice(5,7);})(),exp:2});
      eq(asinChkTile(old,'card'),'','no button on an order older than the 60 days it covers');
    }finally{window._saveAsinChecks=keepSave;window.showConfirm=keepC;ASIN_CHECKS=keepA;}
    /* clock-change Sundays: 20:00 and 04:00 are UK clock times */
    const uk=ms=>{const p=_ukParts(ms);return p.h+':'+String(p.mi).padStart(2,'0');};
    eq(uk(_sfLastSlot(Date.UTC(2026,9,25,23))),'20:00','25 Oct 2026 (clocks back): the slot is 20:00 UK');
    eq(uk(_sfLastSlot(Date.UTC(2027,2,28,22))),'20:00','28 Mar 2027 (clocks forward): the slot is 20:00 UK');
    /* close-off: no hidden refunded question; "Already sent" needs the shipment ID */
    const nz=mkRow({sup:'Argos',acct:'',exp:2,rcvd:0});
    openSorted(nz.uuid,'cancelled');await wait(40);setVal('srtPaid','yes');srtSync();
    ok(!(window._srtGate||{}).missingAsk,'paid "yes" on a cancellation no longer waits on a hidden question');
    try{closeSorted();}catch(e){}
    const st=mkRow({exp:2,rcvd:2});openSorted(st.uuid,'sent-not-stamped');await wait(40);srtSync();srtAskClose();
    ok(/shipment ID/i.test((document.getElementById('srtMsg')||{}).textContent||''),'"Already sent" with no ID says to type the shipment ID');
    try{closeSorted();}catch(e){}
    /* Duplicate record: the app's own step is not hers to tick */
    const dp=mkRow({exp:2,rcvd:0});openSorted(dp.uuid,'duplicate');await wait(40);srtSync();
    ok(!_srtLeft().some(s=>/the app does/i.test(s.text||'')),'"the app does that" is not a step to tick');
    try{closeSorted();}catch(e){}
  };

  /* Q4 prepping (a temporary tab — Jack, 29 Oct 2026): q4Calc on made-up parts and products. A part two bundles
     share is counted once (the one closest to running out at Amazon gets it first); parts on order count in the max
     but not in "of which arrived"; a single's own stock; sends before 1 Oct or with no shipment ID are ignored; an
     unlinked purchase line since 1 Oct is flagged. Then the tab draws, and working it out on the live data changes nothing. */
  S['Q4 prepping: max, a shared part counted once, of which arrived, singles, unlinked lines — the tab draws and changes nothing']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const L=(id,qty,rem,arr)=>({id,date:'2026-09-20',qty,rem,cost:1,arr:arr?1:0});
    const comps=[{id:'chkq4-tin',name:'CHECK Tin',layers:[L('t1',100,100,1),L('t2',60,0,0)]},    /* 100 here + 60 on order */
      {id:'chkq4-box',name:'CHECK Box',layers:[L('b1',500,500,1)]},
      {id:'chkq4-tea',name:'CHECK Tea',layers:[L('e1',50,50,1)]},
      {id:'chkq4-rib',name:'CHECK Ribbon',untracked:true,layers:[]}];
    const prods=[
      {id:'chkq4-a',asin:'B0CHKQ4A',name:'CHECK Hamper A',type:'bundle',recipe:[{c:'chkq4-tin',q:1},{c:'chkq4-box',q:1},{c:'chkq4-rib',q:1}],layers:[]},
      {id:'chkq4-b',asin:'B0CHKQ4B',name:'CHECK Hamper B',type:'bundle',recipe:[{c:'chkq4-tin',q:2},{c:'chkq4-tea',q:1}],layers:[]},
      {id:'chkq4-s',asin:'B0CHKQ4S',name:'CHECK Single',type:'pl',recipe:[],layers:[L('s1',30,30,1),L('s2',20,0,0)]}];
    const ships=[{shipId:'FBA15CHKQ4A1',asin:'B0CHKQ4A',units:25,date:'2026-10-05'},{shipId:'FBA15CHKQ4A0',asin:'B0CHKQ4A',units:99,date:'2026-09-30'},
      {shipId:'',asin:'B0CHKQ4A',units:7,date:'2026-10-06'},{shipId:'FBA15CHKQ4S1',asin:'B0CHKQ4S',units:10,date:'2026-10-02'}];
    const purch=[{id:'chkq4-u1',date:'2026-10-03',name:'CHECK unlinked',qty:5,alloc:[]},{id:'chkq4-u2',date:'2026-09-03',name:'CHECK old',qty:5,alloc:[]}];
    const R=LV3.q4Calc({products:prods,components:comps,purchases:purch,shipments:ships,owed:{},protDays:p=>({'chkq4-b':3,'chkq4-a':9})[p.id]});
    const A=R.bundles.find(r=>r.id==='chkq4-a'),B=R.bundles.find(r=>r.id==='chkq4-b'),G=R.singles.find(r=>r.id==='chkq4-s');
    ok(A&&B&&G,'every product is on the page');
    eq(R.bundles[0].id,'chkq4-b','the bundle closest to running out is first in the queue for the shared part');
    eq(B.left,50,'B can build 50 — limited by its tea');eq(B.lim.parts[0].id,'chkq4-tea','B is limited by the tea');
    eq(B.lim.say.kind,'none','B: more tea makes none on its own — B would take the tins Hamper A uses');eq(B.lim.say.next.id,'chkq4-tin','B: the tins are the real limit');
    eq(A.left,60,'A gets the 60 tins B left — never the same tin twice');eq(A.lim.parts[0].id,'chkq4-tin','A is limited by the tins');
    eq(B.arrived,50,'B’s 50 are all from parts on the shelf');eq(A.arrived,0,'B used the tins on the shelf, so A’s 60 wait on the order');
    eq(A.done,25,'A: only the send with a shipment ID dated 1 Oct onwards counts');eq(A.max,85,'A: max = 25 sent + 60 still to build');
    eq(A.pct,29,'A: 25 of 85 = 29%');
    eq(G.done,10,'single: 10 sent');eq(G.max,60,'single: 10 sent + 30 on the shelf + 20 on order');eq(G.arrived,30,'single: 30 of it arrived');
    eq(R.totals.max,85+50+60,'the page total adds the lines up');eq(R.totals.done,35,'the page total of sends');
    eq(R.unlinked.n,1,'one purchase line since 1 Oct not linked — the September one does not count');
    /* the live data: working it out writes nothing, and the tab draws */
    const D=LV3.__D();
    const sig=()=>JSON.stringify({c:D.components.map(c=>[c.id,(c.layers||[]).map(l=>[l.qty,l.rem,l.arr])]),
      p:D.products.map(p=>[p.id,p.archived,(p.layers||[]).map(l=>[l.qty,l.rem,l.arr])]),u:D.purchases.map(x=>[x.id,JSON.stringify(x.alloc||[])]),s:JSON.stringify(D.settings||{})});
    const s0=sig(),live=LV3.q4Calc();
    ok(live&&Array.isArray(live.bundles)&&Array.isArray(live.singles),'it runs on the live data');
    ok([...live.bundles,...live.singles].every(r=>r.max>=r.done&&r.arrived<=r.left),'live: max never below sent, arrived never above what is left');
    eq(sig(),s0,'working it out on the live data changed nothing');
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('q4');await wait(150);
      const pg=document.getElementById('page-lavarion');
      ok([...pg.querySelectorAll('#lav3Tabs button')].some(b=>/Q4 prepping/.test(b.textContent)),'the Q4 prepping tab is on the bar');
      ok(pg.querySelector('.q4Kpis')&&pg.querySelectorAll('table.q4T').length>=2,'the page draws its totals and its tables');
      ok(!/undefined|NaN/.test(pg.querySelector('.q4').textContent),'no undefined or NaN on the page');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 99 · Becki's 28 Oct sequence: wrong shipment → bulk In Warehouse → bulk ship again → shipped must be right */
  S['v56.1 b625: bulk undo clears the shipment record; shipped always matches its shipments']=async()=>{
    const keep={sel:window.getSelectedRows,modal:window.showShipIdModal};
    try{
      who('Becki');
      const r=mkRow({exp:10,rcvd:10,status:'In Warehouse'});
      window.getSelectedRows=()=>[r.uuid];
      window.showShipIdModal=(t,x,ty,cb)=>cb('FBA15CHKWRG1','Standard');doBulkAllShipped();
      eq(_sentOut(r),10,'bulk shipped to the wrong one');
      const dd=document.getElementById('bulkActionDropdown');ok(dd,'the bulk status dropdown is on the page');
      dd.value='In Warehouse';window.__bulkUnsendOk=true;try{doBulkAction();}finally{window.__bulkUnsendOk=false;}
      eq((r.shipSegments||[]).length,0,'bulk In Warehouse clears the shipment record');eq(parseInt(r.ship)||0,0,'…and the number');
      window.showShipIdModal=(t,x,ty,cb)=>cb('FBA15CHKRGT1','Standard');doBulkAllShipped();
      eq(_sentOut(r),10,'bulk ship again puts all 10 on the right one');eq(parseInt(r.ship)||0,10,'shipped reads 10, not 0');
      ok((r.shipSegments||[]).every(s=>s.shipId==='FBA15CHKRGT1'),'and only on the right shipment');
      /* a row fully on another shipment is skipped, not re-stamped */
      const done=mkRow({exp:4,rcvd:4,ship:4,status:'Sent to Amazon',sent:'Yes',sentDate:'2026-10-20'});
      window.getSelectedRows=()=>[done.uuid];window.showShipIdModal=(t,x,ty,cb)=>cb('FBA15CHKRGT2','Standard');doBulkAllShipped();
      eq(done.sentDate,'2026-10-20','a row already on another shipment keeps its date');ok(!(done.shipSegments||[]).some(s=>s.shipId==='FBA15CHKRGT2'),'…and isn’t put on the new one');
      /* R7 and the heal */
      const m=mkRow({exp:8,rcvd:8,status:'Sent to Amazon',sent:'Yes',shipSegments:[{shipId:'FBA15CHKMSC1',units:8,date:'2026-10-28',type:'Standard'}],allShipIds:['FBA15CHKMSC1'],ship:0});
      const notes=rowRules(m);eq(parseInt(m.ship),8,'save rule: shipped = what its shipments hold');ok(notes.some(n=>/shipped 0 → 8/.test(n)),'…noted for the audit');
      m.ship=0;eq(healShipFromSegments('check')>=1,true,'the heal finds it');eq(parseInt(m.ship),8,'…and puts it right');
    }finally{window.getSelectedRows=keep.sel;window.showShipIdModal=keep.modal;}
  };

  /* 100 · the second tester's b625 findings */
  S['v56.1 b625: Fix all never overfills, one gap two SKUs → Sarah, Undo newest first']=async()=>{
    const keepRun=SFRUN,keepU=window.toastUndo;const undos=[];window.toastUndo=(m,f)=>{undos.push(f);};
    const L=(id,lines)=>({id,created:'2026-10-28',status:'IN_TRANSIT',lines:lines.map(([r,u])=>({sku:r.sku,asin:r.asin,units:u}))});
    try{
      who('Jack');
      const X=mkRow({asin:'B0CHKFA001',sku:'Amuk_4_01106_0_CHK_FA',exp:4,rcvd:0});
      const A=mkRow({asin:'B0CHKFB001',sku:'Amuk_5_01106_0_CHK_FBA',exp:2,rcvd:0}),B=mkRow({asin:'B0CHKFB001',sku:'Amuk_5_01106_0_CHK_FBB',exp:2,rcvd:0});
      const C=mkRow({asin:'B0CHKFB001',sku:'Amuk_5_01106_0_CHK_FBC',exp:2,rcvd:2,ship:2,status:'Sent to Amazon',sent:'Yes',shipSegments:[{shipId:'FBA15CHKFB01',units:2,date:'2026-10-28',type:'Standard'}],allShipIds:['FBA15CHKFB01']});
      SFRUN=Object.assign({late:[],stock:[],sold:[],excluded:[],summary:{}},keepRun||{},{shipments:[L('FBA15CHKFA01',[[X,3]]),L('FBA15CHKFA02',[[X,3]]),L('FBA15CHKFB01',[[A,2],[B,2]])]});
      const mine=new Set([X,A,B,C].map(r=>r.sku));
      const kinds=()=>sfPrepIssues().filter(i=>mine.has(i.sku)).map(i=>i.sku.slice(-7)+':'+i.kind).sort().join(' ');
      ok(/CHK_FA:late.*CHK_FA:late/.test(kinds()),'two shipments on one order of 4 both look sure at first');
      ok(/CHK_FBA:look/.test(kinds())&&/CHK_FBB:look/.test(kinds()),'two SKUs sharing one product gap → Sarah decides, not one press');
      await sfFixAll();
      eq(parseInt(X.rcvd),3,'Fix all does the first shipment — 3 booked, not 6');eq(_sentOut(X),3,'…3 sent');
      ok(sfPrepIssues().some(i=>i.sku===X.sku&&i.shipId==='FBA15CHKFA02'&&i.kind==='look'),'the second shipment is now for Sarah: the order can only take 1');
      eq(parseInt(A.rcvd)||0,0,'the shared-gap SKUs are not booked by Fix all');
      /* undo newest first: two single fixes on one row */
      const Y=mkRow({asin:'B0CHKFC001',sku:'Amuk_6_01106_0_CHK_FC',exp:6,rcvd:0});
      SFRUN.shipments=[L('FBA15CHKFC01',[[Y,3]]),L('FBA15CHKFC02',[[Y,3]])];
      undos.length=0;
      await sfRecord(sfPrepIssues().find(i=>i.sku===Y.sku&&i.shipId==='FBA15CHKFC01').id);
      await sfRecord(sfPrepIssues().find(i=>i.sku===Y.sku&&i.shipId==='FBA15CHKFC02').id);
      eq(_sentOut(Y),6,'two fixes, 6 sent');
      await undos[0]();eq(_sentOut(Y),6,'undoing the OLDER one first is refused');
      await undos[1]();eq(_sentOut(Y),3,'undo the newer one → 3');await undos[0]();eq(_sentOut(Y),0,'…then the older one → 0');
    }finally{SFRUN=keepRun;window.SFRUN=keepRun;window.toastUndo=keepU;}
  };

  /* Q4 prepping, round 2 (Jack, 29 Oct 2026): "ignore the boxes — components always"; a target is 100% and the parts
     are checked against it; a hamper left with none of a shared component is amber, not finished; every "buying N more
     makes M more" is what running the whole queue again really gives; the plan pre-fills by exact name; a target saves
     through the normal PLUB settings (database faked here). */
  S['Q4 prepping round 2: boxes never limit, targets, starved lines amber, honest “buying N more”, pre-fill, a target saves']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const L=q=>[{id:'l'+q,date:'2026-09-20',qty:q,rem:q,cost:1,arr:1}];
    const comps=[{id:'q2-box',name:'CHECK Hamper Box',kind:'component',layers:L(5)},{id:'q2-wrap',name:'CHECK wrap',kind:'packaging',layers:[]},
      {id:'q2-crisp',name:'CHECK Crisps',layers:L(300)},{id:'q2-bisc',name:'CHECK Biscuits',layers:L(100)},{id:'q2-tea',name:'CHECK Tea',layers:L(40)},
      {id:'q2-mug',name:'CHECK Mug',layers:L(70)},{id:'q2-jam',name:'CHECK Jam',layers:L(50)},{id:'q2-scone',name:'CHECK Scone',layers:L(30)}];
    const B=(id,name,rec)=>({id,asin:'B0Q2'+id.slice(3).toUpperCase(),name,type:'bundle',recipe:rec.map(([c,q])=>({c,q})),layers:[]});
    const prods=[B('q2-s1','CHECK Snack',[['q2-box',1],['q2-wrap',1],['q2-crisp',3]]),B('q2-s2','CHECK Biscuit',[['q2-bisc',1],['q2-tea',1],['q2-mug',1]]),
      B('q2-s3','CHECK Tea Gift',[['q2-tea',1],['q2-bisc',1]]),B('q2-s4','CHECK Cream Tea',[['q2-jam',1],['q2-scone',1]]),B('q2-s5','CHECK Jam Pot',[['q2-jam',1]])];
    const ships=[['S1',20],['S3',5],['S5',12]].map(([a,u])=>({shipId:'FBA15CHKQ2'+a,asin:'B0Q2'+a,units:u,date:'2026-10-08'}));
    const R=LV3.q4Calc({products:prods,components:comps,purchases:[],shipments:ships,owed:{},
      targets:{'q2-s1':150,'q2-s4':25,'q2-s5':10},protDays:p=>+p.id.slice(-1)});
    const by=id=>R.bundles.find(r=>r.id===id),s1=by('q2-s1'),s2=by('q2-s2'),s3=by('q2-s3'),s4=by('q2-s4'),s5=by('q2-s5');
    /* 1 · the box (by name) and the wrap (by kind) never limit */
    eq(s1.left,100,'the 5 hamper boxes do not cap it — 300 crisps ÷ 3 = 100');eq(s1.lim.parts[0].id,'q2-crisp','limited by the crisps, not the box');
    eq(R.packaging.map(x=>x.name).join(', '),'CHECK Hamper Box, CHECK wrap','both are listed as left out');
    /* 2 · targets */
    eq(JSON.stringify([s1.max,s1.pct,s1.need,s1.cover]),JSON.stringify([150,13,130,-30]),'target 150: 20 sent = 13%, needs 130, parts for 100 — short by 30');
    eq(JSON.stringify([s4.max,s4.pct,s4.cover,s4.left]),JSON.stringify([25,0,2,27]),'target 25: the parts make 30, it takes 27 (target +5%) — covered');
    eq(JSON.stringify([s5.max,s5.pct,s5.need]),JSON.stringify([12,100,0]),'12 sent against a target of 10: reached, 100%');
    eq(JSON.stringify([s2.target,s2.max]),JSON.stringify([null,40]),'no target: sent + what the parts make');
    eq(JSON.stringify([R.totals.max,R.totals.done,R.totals.pct]),JSON.stringify([232,37,15]),'the page: targets + the rest’s max');
    /* 3 · starved of a shared component: amber, not a finished 100% */
    ok(s3.starved&&s3.pct===100,'Tea Gift: 5 sent, no tea left after the Biscuit bundle — 100% of its max, but starved');
    ok(/No <b>CHECK Tea<\/b> left for it — all allocated to <b>CHECK Biscuit<\/b>/.test(LV3.q4LimHtml(s3)),'it says where the tea went');
    /* 4 · every "buying N more" is a re-run of the queue */
    eq(JSON.stringify([s2.lim.say.kind,s2.lim.say.buy[0].qty,s2.lim.say.gl,s2.lim.say.gp,s2.lim.say.next.name]),JSON.stringify(['ok',30,30,30,'CHECK Mug']),'Biscuit: 30 more tea makes 30 more, then the mugs run out');
    eq(JSON.stringify([s3.lim.say.kind,s3.lim.say.buy[0].qty,s3.lim.say.gl,s3.lim.say.gp,s3.lim.say.to.join()]),JSON.stringify(['ahead',60,30,60,'CHECK Biscuit']),'Tea Gift: 60 more tea makes 30 here — the Biscuit bundle takes the first 30');
    eq(s4.lim,null,'Cream Tea: covered to target +5% — nothing limits it');
    eq(JSON.stringify([s5.left,s5.lim]),JSON.stringify([0,null]),'Jam Pot: 12 sent is already past its target +5% — it takes no more jam');
    eq(JSON.stringify([s1.lim.say.kind,s1.lim.say.buy[0].qty,s1.lim.say.gl,s1.lim.say.coverTo]),JSON.stringify(['ok',114,38,158]),'Snack: 114 more crisps make 38 more — covered to 158 (target +5%)');
    /* 5 · the plan pre-fills by exact name only */
    const pf=LV3.q4PlanFill([{id:'a',name:'Gluten Free Snack Bundle',type:'bundle'},{id:'b',name:'Hot Chocolate Gift Hamper',type:'bundle'},
      {id:'c',name:'GF Hot Chocolate Gift Set',type:'bundle'},{id:'d',name:'Tea & Biscuits Hamper',type:'pl'},{id:'e',name:'Pub Snacks Hamper',type:'bundle',archived:true}]);
    eq(JSON.stringify(pf),JSON.stringify({a:1500,b:1500}),'pre-fill: exact names, live bundles only');
    /* 6 · a target saves through the PLUB settings save, and comes off again */
    const D=LV3.__D(),p=D.products.find(x=>!x.archived&&x.type==='bundle');
    if(p){
      const keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase(),logN=D.log.length;
      const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
      sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:{value:keepS},error:null}),
        upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
      try{
        LV3.__setPrefsBase(JSON.parse(keepS));
        ok(await LV3.q4SetTarget(p.id,'1,234'),'the save reports it landed');
        ok(wrote&&wrote.q4Targets&&wrote.q4Targets[p.id]===1234,'lavarion_prefs gets q4Targets['+p.id+'] = 1234');
        eq(LV3.q4Calc().bundles.find(r=>r.id===String(p.id)).max,Math.max(1234,LV3.q4Calc().bundles.find(r=>r.id===String(p.id)).done),'the line now counts to its target');
        await LV3.q4SetTarget(p.id,'');
        ok(wrote&&wrote.q4Targets&&!(p.id in wrote.q4Targets),'cleared: the target comes off');
      }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));
        LV3.__setPrefsBase(keepB);D.log.splice(0,D.log.length-logN);}
    }
    /* 7 · the page draws the Settings dropdown with a box per bundle */
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('q4');await wait(150);
      const pg=document.getElementById('page-lavarion'),set=pg.querySelector('details.q4Set');
      ok(set&&/Settings/.test(set.querySelector('summary').textContent),'Settings ▾ is on the page');
      eq(set.querySelectorAll('input.q4TIn:not(.q4OverIn)').length,LV3.q4Calc().bundles.filter(r=>!r.archived).length,'one target box per bundle on the page');
      ok(!/undefined|NaN/.test(pg.querySelector('.q4').textContent),'no undefined or NaN on the page');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 101 · moving lines to another shipment */
  S['v56.1 b625: move lines to another shipment — Shipments page, bulk, the In Warehouse ask, SellerFuse spots a wrong ID']=async()=>{
    const keep={sel:window.getSelectedRows,modal:window.showShipIdModal,u:window.toastUndo};let undo=null;window.toastUndo=(m,f)=>{undo=f;};
    const keepRun=SFRUN;
    const seg=(id,u)=>({shipSegments:[{shipId:id,units:u,date:'2026-10-28',type:'Standard'}],allShipIds:[id],shipId:id,ship:u,sent:'Yes',status:'Sent to Amazon'});
    try{
      who('Becki');
      const a=mkRow(Object.assign({exp:10,rcvd:10},seg('FBA15CHKMVA1',10))),b=mkRow(Object.assign({exp:4,rcvd:4},seg('FBA15CHKMVA1',4)));
      openEditShipment('FBA15CHKMVA1');await wait(40);
      const box=document.getElementById('editShipMoveBox');ok(box&&box.querySelectorAll('input[type=checkbox]').length>=2,'the shipment popup lists its lines to move');
      const i=_shipMoveItems.findIndex(x=>x.row===a);box.querySelector(`input[data-i="${i}"]`).checked=true;document.getElementById('shipMoveTo').value='FBA15CHKMVB1';
      await shipMoveGo();
      ok(a.shipSegments.every(s=>s.shipId==='FBA15CHKMVB1'),'the ticked line moved to the right shipment');eq(parseInt(a.ship),10,'…with its 10 units');
      ok(b.shipSegments.every(s=>s.shipId==='FBA15CHKMVA1'),'the line not ticked stayed');
      ok(typeof undo==='function','an Undo is offered');await undo();ok(a.shipSegments.every(s=>s.shipId==='FBA15CHKMVA1'),'Undo puts it back');
      window.getSelectedRows=()=>[a.uuid,b.uuid];window.showShipIdModal=(t,x,ty,cb)=>cb('FBA15CHKMVC1','Standard');
      doBulkMoveShip();await wait(400);
      ok([a,b].every(r=>r.shipSegments.every(s=>s.shipId==='FBA15CHKMVC1')),'Prep Sheet bulk: both rows moved');eq((parseInt(a.ship)||0)+(parseInt(b.ship)||0),14,'…numbers intact');
      const dd=document.getElementById('bulkActionDropdown');dd.value='In Warehouse';doBulkAction();
      const ask=document.getElementById('bulkUnsendAsk');ok(ask&&ask.style.display!=='none','bulk In Warehouse on rows on a shipment asks first');
      eq(a.shipSegments.length,1,'…and changes nothing until she answers');ask.style.display='none';
      const c=mkRow(Object.assign({asin:'B0CHKMVD01',sku:'Amuk_7_28106_0_CHK_MVD',exp:6,rcvd:6},seg('FBA15CHKMVD1',6)));
      SFRUN=Object.assign({late:[],stock:[],sold:[],excluded:[],summary:{}},keepRun||{},{shipments:[
        {id:'FBA15CHKMVD1',created:'2026-10-28',status:'IN_TRANSIT',lines:[{sku:'Amuk_x_CHK_OTHER',asin:'B0CHKOTHER',units:5}]},
        {id:'FBA15CHKMVD2',created:'2026-10-28',status:'IN_TRANSIT',lines:[{sku:c.sku,asin:c.asin,units:6}]}]});
      const it=sfPrepIssues().find(x=>x.sku===c.sku);
      ok(it&&it.kind==='moved'&&it.fromId==='FBA15CHKMVD1','SellerFuse: Amazon has none of it on D1 and all 6 on D2 → wrong shipment ID');
      await sfMoveIt(it.id);ok(c.shipSegments.every(s=>s.shipId==='FBA15CHKMVD2'),'one press moves it');eq(parseInt(c.ship),6,'…6 units');
    }finally{window.getSelectedRows=keep.sel;window.showShipIdModal=keep.modal;window.toastUndo=keep.u;SFRUN=keepRun;window.SFRUN=keepRun;try{cm('editShipModal');}catch(e){}}
  };

  /* 98 · b628 prep cost engine (Jack, 29 Oct): every unit in the month it went, Part Sent included; the running month
     at the band of max(3-month average, the month so far); a finished month at its actual band; DG boxes at £2.50;
     the Dashboard, the Shipments page and the history popup all read the one engine */
  S['b628: prep cost — one engine, send-day months, 3-month average, finished months drop, DG boxes']=async()=>{
    const keepB=Object.assign({},shipBoxes),keepT=Object.assign({},_shipTypeCache);
    const seg=(sid,units,date)=>({shipId:sid,units,date,type:'Standard'});
    try{
      /* history: Jul 2,821 · Aug 3,109 · Sep 3,908 + 9 below = 3,917 → average 3,282 (35p) */
      mkRow({sent:'Yes',status:'Sent to Amazon',exp:2821,rcvd:2821,ship:2821,sentDate:'2026-07-10',shipType:'Standard',shipSegments:[seg('FBA-CHK628J',2821,'2026-07-10')]});
      mkRow({sent:'Yes',status:'Sent to Amazon',exp:3109,rcvd:3109,ship:3109,sentDate:'2026-08-10',shipType:'Standard',shipSegments:[seg('FBA-CHK628A',3109,'2026-08-10')]});
      mkRow({sent:'Yes',status:'Sent to Amazon',exp:3908,rcvd:3908,ship:3908,sentDate:'2026-09-10',shipType:'Standard',shipSegments:[seg('FBA-CHK628S',3908,'2026-09-10')]});
      /* a Part Sent row (it used to be left out of the prep) */
      mkRow({sent:'No',status:'Part Sent',exp:10,rcvd:10,ship:5,sentDate:'2026-10-16',shipType:'Standard',shipSegments:[seg('FBA-CHK628O',5,'2026-10-16')]});
      /* split across two months: 9 on 30 Sep, 11 on 2 Oct — its sent date is the LAST send */
      mkRow({sent:'Yes',status:'Sent to Amazon',exp:20,rcvd:20,ship:20,sentDate:'2026-10-02',shipType:'Standard',shipSegments:[seg('FBA-CHK628S',9,'2026-09-30'),seg('FBA-CHK628O',11,'2026-10-02')]});
      /* DG on its own shipment, oversize on the October one */
      mkRow({sent:'Yes',status:'Sent to Amazon',exp:26,rcvd:26,ship:26,sentDate:'2026-10-05',shipType:'DG',shipSegments:[seg('FBA-CHK628D',26,'2026-10-05')]});
      mkRow({sent:'Yes',status:'Sent to Amazon',exp:7,rcvd:7,ship:7,sentDate:'2026-10-02',shipType:'Oversize',shipSegments:[seg('FBA-CHK628O',7,'2026-10-02')]});
      lavShipments.push({_chk:true,shipId:'FBA-CHK628O',sku:'',asin:'',units:40,cost:1,date:'2026-10-02'});
      shipBoxes['FBA-CHK628O']=3;shipBoxes['FBA-CHK628D']=2;_shipTypeCache['FBA-CHK628D']='DG';
      const mine=allSentRows().filter(l=>/^FBA-CHK628/.test(l.shipId||''));
      const P=at=>prepEngineFrom(prepLinesFrom(mine,_shipFirstDates(mine)),{fees:prepFees,today:at,boxes:shipBoxes,shipTypes:_shipTypeCache});
      const E=P('2026-10-29');
      eq(E.vols['2026-09'],3917,'September: 3,908 + the 9 that went on 30 Sep');
      eq(E.vols['2026-10'],42,'October: 5 Part Sent + 11 + 26 DG — PLUB (b647) and oversize apart');
      const R=E.rate('2026-10');ok(Math.abs(R.avg-(2821+3109+3917)/3)<1e-9,'the average of Jul, Aug, Sep');
      const O=E.priceMonth('2026-10');
      eq(O.unitRate,prepFees.tier3p,'42 units ride on the 3,282 average → the 3,001–5,000 rate');
      eq(O.lavUnits,40,'40 PLUB');ok(Math.abs(O.lavCost-40*prepFees.plubCostPerUnit)<1e-9,'PLUB at its own flat rate (b647)');eq(O.basis,'estimate','…as an estimate');
      ok(/^ESTIMATE/.test(prepRateWhy(O.info)),'and says so');
      eq(O.osUnits,7,'7 oversize');eq(O.stdBoxes,3,'3 standard boxes');eq(O.dgBoxes,2,'2 DG boxes');
      ok(Math.abs(O.boxCostTotal-(3*prepFees.boxCost+2*prepFees.dgExtraPerBox))<1e-9,'DG boxes at the DG box cost');
      eq(E.priceShip('FBA-CHK628O').unitRate,O.unitRate,'one shipment is priced at its month’s rate');
      const F=P('2026-11-02').priceMonth('2026-10');
      eq(F.unitRate,prepFees.tier1p,'October finished on 42 → its actual band');eq(F.basis,'actual','not an estimate any more');
      /* the live engine sees exactly what the This Month card counts, and the pages agree */
      const PE=prepEngine(),ym=todayISO().slice(0,7),{s,e}=getMonthRange();
      eq(PE.linesMonth(ym).reduce((a,l)=>a+l.units,0),sentRollup(s,e).units,'prep counts every unit the This Month card counts');
      const shipped=PE.linesMonth(ym).filter(l=>l.shipId),ids=[...new Set(shipped.map(l=>l.shipId))];
      ok(Math.abs(ids.reduce((a,id)=>a+PE.priceShip(id).withVat,0)-PE.price(shipped).withVat)<0.01,'Shipments page shipments add up to the month');
      const d0=`${ym}-01`;
      ok(Math.abs(prepExpMetrics(new Date(+ym.slice(0,4),+ym.slice(5,7)-1,1),new Date(),PE).withVat-PE.priceRange(d0,todayISO()).withVat)<0.01,'Prep Fee Explorer = the engine');
      ok(Math.abs(calcInsMetrics([],[],{},ym,PE).withVat-PE.priceMonth(ym).withVat)<0.01,'Insights month = the engine');
      eq(unitRateBand(2000),'1,001–3,000','the 45p band label has its comma');
    }finally{
      for(let i=lavShipments.length-1;i>=0;i--)if(lavShipments[i]&&lavShipments[i]._chk&&/^FBA-CHK628/.test(lavShipments[i].shipId||''))lavShipments.splice(i,1);
      Object.keys(shipBoxes).forEach(k=>{if(!(k in keepB))delete shipBoxes[k];});Object.assign(shipBoxes,keepB);
      Object.keys(_shipTypeCache).forEach(k=>{if(!(k in keepT))delete _shipTypeCache[k];});Object.assign(_shipTypeCache,keepT);
    }
  };

  /* Q4 prepping, round 3 (Jack, 29 Oct 2026: "those 4 are priority … roughly within 5% of my plan, then the extras can be
     allocated elsewhere"): bundles with a target are handed shared components first, in the Action centre's order among
     themselves, and stop at target +5%; then everything else shares what is left. The live case in miniature: GF Biscuit
     (target) sat behind the GF Tea & Biscuits set (no target) for the Nairn, and Tea & Biscuits behind it for the Earl Grey. */
  S['Q4 prepping round 3: targets first up to target +5%, then the rest — priority marked, the % saves']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    /* q4 round 3 fixture */
    const L=q=>[{id:'l'+q,date:'2026-09-20',qty:q,rem:q,cost:1,arr:1}];
    const comps=[{id:'q3-nairn',name:'CHECK Nairn Multipack',layers:L(400)},{id:'q3-earl',name:'CHECK Earl Grey',layers:L(500)},
      {id:'q3-crisp',name:'CHECK Crisps',layers:L(50)},{id:'q3-oat',name:'CHECK Oatcakes',layers:L(900)},{id:'q3-mug',name:'CHECK Mug',layers:L(900)}];
    const B=(id,name,rec)=>({id,asin:'B0Q3'+id.slice(3).toUpperCase(),name,type:'bundle',recipe:rec.map(([c,q])=>({c,q})),layers:[]});
    const prods=[B('q3-snk','CHECK GF Snack',[['q3-nairn',4],['q3-crisp',1]]),B('q3-gftb','CHECK GF T&B Set',[['q3-nairn',4],['q3-earl',5]]),
      B('q3-tb','CHECK T&B Hamper',[['q3-earl',5],['q3-mug',1]]),B('q3-gfb','CHECK GF Biscuit',[['q3-nairn',4],['q3-oat',1]])];
    const pd={'q3-snk':13,'q3-gftb':26,'q3-tb':29,'q3-gfb':33};
    const calc=(t,over)=>LV3.q4Calc({products:prods,components:comps,purchases:[],shipments:[],owed:{},targets:t,over,protDays:p=>pd[p.id]});
    const left=R=>JSON.stringify(R.bundles.map(r=>[r.id,r.left]));
    const T={'q3-snk':100,'q3-tb':60,'q3-gfb':40};
    const R0=calc({},5),R1=calc(T,5),R2=calc(T,0);
    eq(left(R0),JSON.stringify([['q3-snk',50],['q3-gftb',50],['q3-tb',50],['q3-gfb',0]]),'no targets: the Action centre order — GF Biscuit gets no Nairn');
    eq(left(R1),JSON.stringify([['q3-snk',50],['q3-tb',63],['q3-gfb',42],['q3-gftb',8]]),'targets first, each stopping at target +5% (63, 42); the set gets what is left');
    eq(left(R2),JSON.stringify([['q3-snk',50],['q3-tb',60],['q3-gfb',40],['q3-gftb',10]]),'at +0% they stop at the target and the set gets 2 more');
    eq(JSON.stringify(R1.bundles.map(r=>r.priority)),JSON.stringify([true,true,true,false]),'the three with a target are marked priority');
    const by=id=>R1.bundles.find(r=>r.id===id),tb=by('q3-tb'),gfb=by('q3-gfb'),snk=by('q3-snk');
    eq(JSON.stringify([tb.allowTo,tb.lim,gfb.allowTo,gfb.lim]),JSON.stringify([63,null,42,null]),'covered to target +5% — nothing limits them');
    eq(JSON.stringify([tb.left,tb.allow]),JSON.stringify([63,63]),'Tea & Biscuits: covered to 63 (target +5%)');
    eq(JSON.stringify([snk.left,snk.need,snk.allow]),JSON.stringify([50,100,105]),'GF Snack: 50 of 100 — short by 50 (the crisps)');
    eq(JSON.stringify([snk.lim.parts[0].id,snk.lim.say.kind,snk.lim.say.gl,snk.lim.say.gp]),JSON.stringify(['q3-crisp','steal',50,0]),
      'GF Snack: 50 more crisps make 50 more there, but it takes the Nairn GF Biscuit and the set were getting — none in all');
    eq(R1.totals.max,100+60+40+8,'the page total: the three targets + the set’s max (sent + 8)');
    /* q4 round 3 page */
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('q4');await wait(150);
      const pg=document.getElementById('page-lavarion'),live=LV3.q4Calc(),nP=live.bundles.filter(r=>r.priority).length;
      ok(live.bundles.every((r,i,a)=>i===0||!(r.priority&&!a[i-1].priority)),'live: every bundle with a target comes before every one without');
      eq(pg.querySelectorAll('table.q4P tbody tr.q4Row').length,nP,'every priority bundle is a row in the Priority table, and only those');
      eq(!!pg.querySelector('.q4PriNote'),nP>0,'"Priority: targets first" shows when any bundle has a target');
      ok(/moves the bundle up the queue/.test((pg.querySelector('.q4SetHelp')||{}).textContent||''),'Settings says a target also moves it up the queue');
      ok(pg.querySelector('#q4t-over'),'the +% box is in Settings');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
    /* the % saves with the targets (database faked) */
    const keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase(),logN=D.log.length;
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
    sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:{value:keepS},error:null}),
      upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
    try{
      LV3.__setPrefsBase(JSON.parse(keepS));
      ok(await LV3.q4SetTarget('%over','8'),'the save reports it landed');
      eq(wrote&&wrote.q4Over,8,'lavarion_prefs gets q4Over = 8');
      eq(LV3.q4Calc().over,8,'the page now works to target +8%');
    }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));
      LV3.__setPrefsBase(keepB);D.log.splice(0,D.log.length-logN);}
  };

  /* edit629 — Jack, 29 Oct 2026: "Add a 10% increase to anything with gift or hamper in the name, October to
     December. From January it's gone … sales end 23rd December". PLUB only — never an OA / Prep Sheet row. */
  S['PLUB Christmas uplift: gift & hamper lines +10% to 23 Dec, plain after, nothing else changes']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),set0=JSON.stringify(D.settings||{}),prodN=D.products.length,compN=D.components.length,logN=D.log.length;
    const was=(document.querySelector('.page.active')||{}).id||'';
    const near=(a,b,m)=>ok(Math.abs(a-b)<1e-6,m+' — got '+a+', expected '+b);
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    try{
      D.settings.q4Uplift={pct:10,words:'gift, hamper',from:'10-01',to:'12-23',drop:0};   /* this check's numbers: 10%, no dip */
      const cfg=LV3.upliftCfg();eq(cfg.pct,10,'10% as set');eq(cfg.from+'|'+cfg.to,'10-01|12-23','1 Oct to 23 Dec by default');
      const lay=q=>[{id:'chkup-l'+(++n),date:'2026-09-20',qty:q,rem:q,cost:1,arr:1}];
      const mk=(id,name,type,extra)=>{const p=Object.assign({id:'chk-up-'+id,uuid:'chk-up-'+id,name,asin:'B0CHKUP'+id,sku:'CHKUP'+id,type,recipe:[],layers:type==='pl'?lay(500):[],archived:false},extra||{});D.products.push(p);return p;};
      const g=mk(1,'CHECK Hot Chocolate Gift Set','pl'),h=mk(2,'CHECK Tea & Biscuits HAMPER','pl'),gs=mk(3,'CHECK Giftset Deluxe','pl'),pl=mk(4,'CHECK Gluten Free Snack Bundle','pl');
      ok(LV3.upliftOf(g)&&LV3.upliftOf(g).word==='gift','"Gift Set" is a gift line');
      ok(LV3.upliftOf(h)&&LV3.upliftOf(h).word==='hamper','"HAMPER" counts, any case');
      ok(LV3.upliftOf(gs),'"Giftset" counts');
      eq(LV3.upliftOf(pl),null,'a bundle with neither word has no uplift');
      /* the helpers, on fixed dates */
      near(LV3.demandBetween(g,2,'2026-12-01',30),23*2.2+7*2,'gift set, 1 Dec, 30 days: 23 days × 2.2 + 7 × 2');
      near(LV3.daysCovered(g,2,23*2.2+7*2,'2026-12-01'),30,'and that stock lasts exactly 30 days');
      near(LV3.demandBetween(g,2,'2026-12-26',30),60,'from 26 Dec: no uplift');
      near(LV3.daysCovered(g,2,60,'2026-12-26'),30,'from 26 Dec: 60 last 30 days');
      near(LV3.demandBetween(g,2,'2026-09-21',20),10*2+10*2.2,'21 Sep for 20 days: 10 plain, 10 from 1 Oct at ×1.1');
      near(LV3.demandBetween(h,1,'2026-12-20',10),4*1.1+6,'hamper: 20–23 Dec at ×1.1, 24–29 Dec plain');
      eq(LV3.demandBetween(pl,2,'2026-12-01',30),2*30,'a plain bundle: exactly pace × days, as before');
      eq(LV3.daysCovered(pl,2,64.6,'2026-12-01'),64.6/2,'and stock ÷ pace, as before');
      /* not PLUB: an OA / Prep Sheet row named "… Gift Set" is never touched */
      const oa=mkRow({prod:'CHECK ROW Hot Chocolate Gift Set',name:'CHECK ROW Hot Chocolate Gift Set'});
      eq(LV3.upliftOf(oa),null,'an OA prep row named "… Gift Set" is not a PLUB product — no uplift');
      eq(LV3.demandBetween(oa,2,'2026-12-01',30),60,'its demand is plain pace × days');
      eq(LV3.daysCovered(oa,2,60,'2026-12-01'),30,'its days are plain stock ÷ pace');
      eq(LV3.upliftOf(Object.assign({},g)),null,'a copy of a PLUB product outside the PLUB list gets none either');
      /* the engine — the window set to start today so this runs any day of the year */
      const now=new Date(),at=now.toISOString(),today=isoDay(now),md=k=>{const x=new Date(now);x.setDate(x.getDate()+k);return isoDay(x).slice(5);};
      D.settings.atAmz=D.settings.atAmz||{};D.settings.atAmzAt=D.settings.atAmzAt||{};D.settings.sold30=D.settings.sold30||{};
      [g,pl].forEach(p=>{D.settings.sold30[p.asin]=60;D.settings.atAmz[p.asin]=40;D.settings.atAmzAt[p.asin]=at;});
      D.settings.q4Uplift={pct:10,words:'gift, hamper',from:md(0),to:md(6),drop:0};   /* today + 6 days */
      let rp=LV3.__plRow(pl),rg=LV3.__plRow(g);
      eq(rp.demand.src,'typed','the fixtures run on typed-in sales');
      near(rp.protDays,40/2,'plain twin: 40 at 2 a day = 20 days, as before');
      eq(rp.want,Math.round(Math.max(rp.sizeAds*LV3.coverDaysOf(pl),rp.ads*21)),'plain twin: the send is sized exactly as before');
      eq(rp.up,null,'plain twin: no note');
      near(rg.protDays,7+(40-7*2.2)/2,'gift twin: 7 days at 2.2, then the rest at 2 — runs out sooner');
      near(rg.ads,rp.ads,'the measured pace is the same for both');
      eq(rg.want,rp.want,'a send that lands after the uplift ends is NOT sized up');
      ok(rg.up&&/^\+10% Q4 \(gift\) until /.test(rg.up.txt),'gift twin: "+10% Q4 (gift) until …" — got '+(rg.up&&rg.up.txt));
      D.settings.q4Uplift={pct:10,words:'gift, hamper',from:md(0),to:md(300),drop:0};
      rg=LV3.__plRow(g);rp=LV3.__plRow(pl);
      eq(rg.want,Math.round(Math.max(LV3.demandBetween(g,rg.sizeAds,rg.landIso,LV3.coverDaysOf(g)),LV3.demandBetween(g,rg.ads,rg.landIso,21))),'inside the window the send covers the higher pace');
      near(rg.want,Math.round(2.2*LV3.coverDaysOf(g)),'= 2.2 a day × the cover');
      ok(rg.want>rp.want,'more than its plain twin');
      /* a shared part: only the gift share goes up */
      const sup='CHECK Uplift Supplier';D.settings.supplierModes=Object.assign({},D.settings.supplierModes||{},{[sup.toLowerCase()]:LV3.shipModes()[0].k});
      const part={id:'chkup-part',name:'CHECK Uplift Tin',supplier:sup,layers:lay(300)};D.components.push(part);
      const bg=mk(5,'CHECK Choc Gift Hamper','bundle',{recipe:[{c:part.id,q:1}]}),bp=mk(6,'CHECK Choc Bundle','bundle',{recipe:[{c:part.id,q:1}]});
      D.settings.sold30[bg.asin]=60;D.settings.sold30[bp.asin]=30;
      const Lp=(LV3.__planComponents()||[]).find(x=>x.o&&x.o.id===part.id);ok(Lp,'the shared part is planned');
      near(Lp.daily,3,'its pace is the measured 2 + 1 a day');
      near(Lp.cover,300/3.2,'300 tins at 2 × 1.1 + 1 a day');
      /* the pages still draw */
      goPage('lavarion');LV3.go('planner');await wait(300);
      const pg=document.getElementById('page-lavarion');
      ok(/\+10% Q4 \(gift\)/.test(pg.textContent),'the Planner row carries the note');
      LV3.go('overview');await wait(300);ok(pg.textContent.length>200,'the Action centre draws');
      ok(LV3.q4Calc&&Array.isArray(LV3.q4Calc().bundles),'Q4 prepping still works out');
      LV3.go('settings');await wait(300);ok(/Christmas uplift/.test(pg.textContent),'Settings has the Christmas uplift panel');
      delete D.settings.q4Uplift;LV3.setUplift('pct','15');eq(D.settings.q4Uplift.pct,15,'the % saves into D.settings.q4Uplift');
      eq(D.settings.q4Uplift.to,'12-23','the rest keep their defaults');
      LV3.setUplift('toD','31');eq(D.settings.q4Uplift.to,'12-31','the end day saves as month-day');
      LV3.setUplift('toM','2');eq(D.settings.q4Uplift.to,'02-29','a day past the month end is pulled back (31 Feb → 29 Feb)');
      LV3.setUplift('words','');eq(D.settings.q4Uplift.words,'gift, hamper, reindeer, decaf, chocolate, christmas, santa, festive, Gluten Free Snack Bundle, Gluten Free Biscuit Bundle','blank words go back to the defaults (b630: reindeer, decaf, chocolate, christmas, santa, festive added)');
      ok(D.log.length>logN&&/Christmas uplift/.test(D.log[0].txt),'each change goes in the History');
      /* it saves the way every PLUB setting does: savePrefs, three-way merged into lavarion_prefs (database faked) */
      if(LV3.__setPrefsBase&&LV3.__savePrefs&&LV3.__prefsBase){
        const keepB=LV3.__prefsBase(),base=JSON.stringify(D.settings),own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
        sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:{value:base},error:null}),
          upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
        try{LV3.__setPrefsBase(JSON.parse(base));LV3.setUplift('pct','12');ok(await LV3.__savePrefs(),'the save reports it landed');
          eq(wrote&&wrote.q4Uplift&&wrote.q4Uplift.pct,12,'lavarion_prefs gets q4Uplift.pct = 12');
          eq(wrote&&wrote.q4Uplift&&wrote.q4Uplift.from,'10-01','with the start as month-day');}
        finally{if(own)sb.from=orig;else delete sb.from;LV3.__setPrefsBase(keepB);}
      }
    }finally{
      try{const s0=JSON.parse(set0);Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,s0);}catch(e){}
      D.products.splice(prodN);D.components.splice(compN);D.log.splice(0,D.log.length-logN);
      cleanup();
      try{LV3.render();}catch(e){}
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}
    }
  };

  /* 102 · Jack's 29 Oct numbers: +5% to 23 Dec, −10% to 31 Jan, the two GF bundles included */
  S['PLUB uplift defaults: +5% to 23 Dec, then −10% to 31 Jan, GF Snack + Biscuit bundles included']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),keep=D.settings.q4Uplift,prodN=D.products.length;
    const near=(a,b,m)=>ok(Math.abs(a-b)<1e-6,m+' — got '+a+', expected '+b);
    try{
      delete D.settings.q4Uplift;
      const c=LV3.upliftCfg();eq(c.pct,5,'+5% by default');eq(c.drop,10,'−10% after by default');eq(c.dropTo,'01-31','…until 31 Jan');
      const mk=(id,name)=>{const p={id:'chk-up2-'+id,uuid:'chk-up2-'+id,name,asin:'B0CHKUQ'+id,sku:'CHKUQ'+id,type:'pl',recipe:[],layers:[],archived:false};D.products.push(p);return p;};
      const s=mk(1,'Gluten Free Snack Bundle CHECK'),b=mk(2,'CHECK Gluten Free Biscuit Bundle'),g=mk(3,'CHECK Hot Chocolate Gift Set'),x=mk(4,'CHECK Polyfilla Bundle');
      ok(LV3.upliftOf(s)&&LV3.upliftOf(b)&&LV3.upliftOf(g),'GF Snack Bundle, GF Biscuit Bundle and a gift set all take it');ok(!LV3.upliftOf(x),'another bundle does not');
      near(LV3.demandBetween(g,2,'2026-12-20',4),4*2*1.05,'20–23 Dec at +5%');
      near(LV3.demandBetween(g,2,'2026-12-24',8),8*2*0.9,'24–31 Dec at −10%');
      near(LV3.demandBetween(g,2,'2027-01-25',10),7*2*0.9+3*2,'25–31 Jan at −10%, then plain from 1 Feb');
      near(LV3.demandBetween(x,2,'2026-12-24',8),16,'a non-matching product is plain');
      near(LV3.daysCovered(g,2,7.2,'2026-12-24'),4,'7.2 units last 4 days at 1.8 a day after Christmas');
    }finally{if(keep===undefined)delete D.settings.q4Uplift;else D.settings.q4Uplift=keep;D.products.splice(prodN);}
  };

  /* Q4 prepping, round 4 (Jack, 29 Oct 2026: "target — buildable — sent — % bar done"): two tables; Build now (shelf) and
     When orders land (on order) apart; Will reach = sent + all buildable, "+5% cap" when the stop held it back; a short
     priority bundle gets a shopping list that really reaches its target (re-run here); a bundle out of a part is never a
     green 100%; Progress ▾ by day or Monday–Sunday week, a week straddling 1 Oct counting from 1 Oct only. */
  S['Q4 prepping round 4: build now / when orders land, will reach, shopping list, out of a part, Progress by Monday weeks']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    /* q4 round 4 fixture */
    const L=(h,o)=>[{id:'h',date:'2026-09-20',qty:h,rem:h,cost:1,arr:1}].concat(o?[{id:'o',date:'2026-09-21',qty:o,rem:0,cost:1,arr:0}]:[]);
    const comps=[{id:'q4-cocoa',name:'CHECK Cocoa sachet',layers:L(100)},{id:'q4-mug',name:'CHECK Mug',layers:L(300,400)},
      {id:'q4-nairn',name:'CHECK Nairn',layers:L(200,200)},{id:'q4-blk',name:'CHECK Black sachet',layers:[]}];
    const B=(id,name,rec)=>({id,asin:'B0Q4'+id.slice(3).toUpperCase(),name,type:'bundle',recipe:rec.map(([c,q])=>({c,q})),layers:[]});
    const prods=[B('q4-hc','CHECK Hot Choc',[['q4-cocoa',2],['q4-mug',1]]),B('q4-gs','CHECK GF Snack',[['q4-nairn',1],['q4-mug',1]]),
      B('q4-mini','CHECK Mini Choc',[['q4-blk',1],['q4-mug',1]]),B('q4-dove','CHECK Dove',[['q4-nairn',1]])];
    const sh=(a,u,d)=>({shipId:'FBA15CHKQ4'+a+d.slice(5).replace('-',''),asin:'B0Q4'+a,units:u,date:d});
    const ships=[sh('HC',30,'2026-09-30'),sh('HC',20,'2026-10-01'),sh('MINI',40,'2026-10-02'),sh('GS',60,'2026-10-04'),sh('GS',40,'2026-10-05'),sh('DOVE',10,'2026-10-06'),sh('HC',30,'2026-10-06')];
    const calc=cs=>LV3.q4Calc({products:prods,components:cs||comps,purchases:[],shipments:ships,owed:{},over:5,today:'2026-10-07',
      targets:{'q4-hc':200,'q4-gs':300},protDays:p=>({'q4-hc':5,'q4-gs':9,'q4-mini':2,'q4-dove':3})[p.id]});
    const R=calc(),by=id=>R.bundles.find(r=>r.id===id),hc=by('q4-hc'),gs=by('q4-gs'),mini=by('q4-mini'),dove=by('q4-dove');
    eq(JSON.stringify(R.bundles.map(r=>[r.id,r.done,r.left,r.arrived])),JSON.stringify([['q4-hc',50,50,50],['q4-gs',100,215,200],['q4-mini',40,0,0],['q4-dove',10,185,0]]),
      'priority first; build now (shelf) and when orders land (left − arrived) for every line');
    eq(JSON.stringify([gs.done+gs.left,!!gs.capHit,hc.done+hc.left,!!hc.capHit]),JSON.stringify([315,true,100,false]),'GF Snack will reach 315 (target +5% cap); Hot Choc only 100 — short 100');
    eq(JSON.stringify(hc.shop&&hc.shop.buy.map(x=>[x.id,x.qty])),JSON.stringify([['q4-cocoa',200]]),'Hot Choc: to reach 200, buy 200 cocoa sachets');
    const cs2=comps.map(c=>c.id==='q4-cocoa'?Object.assign({},c,{layers:c.layers.concat([{id:'x',date:'2026-10-07',qty:200,rem:0,cost:1,arr:0}])}):c);
    const h2=calc(cs2).bundles.find(r=>r.id==='q4-hc');eq(h2.done+h2.left,200,'…and buying them really reaches 200');
    eq(JSON.stringify([mini.left,mini.lim.parts[0].id,mini.starved]),JSON.stringify([0,'q4-blk',false]),'Mini: 0 more — out of the black sachet, not finished');
    ok(/none here or on order/.test(LV3.q4LimHtml(mini)),'…and says so');
    /* Progress: Monday weeks, newest first; 30 Sep is before the start and never counts */
    const W=R.progress.weeks,Dd=R.progress.days;
    eq(JSON.stringify(W.map(w=>[w.start,w.end,w.from,w.units,w.now])),JSON.stringify([['2026-10-05','2026-10-11','2026-10-05',80,true],['2026-09-28','2026-10-04','2026-10-01',120,false]]),
      'weeks start on Monday; the one straddling 1 Oct counts from 1 Oct only; this week is "so far"');
    ok(W.every(w=>new Date(w.start+'T00:00:00Z').getUTCDay()===1),'every week starts on a Monday');
    eq(R.progress.best.weeks,'2026-09-28','the best week is the one that moved the % most');
    eq(JSON.stringify([Dd.length,Dd[0].key,Dd[0].now,Dd[Dd.length-1].key,Dd[Dd.length-1].units]),JSON.stringify([7,'2026-10-07',true,'2026-10-01',20]),'days from 1 Oct to today, newest first');
    eq(Math.round(W[1].ptsBy['q4-gs']*10)/10,20,'GF Snack: 60 sent ÷ its target of 300 = +20%');
    ok(Math.abs(W[1].pts-100*120/R.totals.max)<1e-9,'% moved = units ÷ the page’s 100%, as on the KPI tile');
    /* q4 round 4 page */
    const was=(document.querySelector('.page.active')||{}).id||'';let keepPref=null;try{keepPref=localStorage.getItem('lv3.q4.progress');}catch(e){}
    try{
      goPage('lavarion');LV3.go('q4');await wait(150);
      const pg=document.getElementById('page-lavarion'),live=LV3.q4Calc(),nP=live.bundles.filter(r=>r.priority).length;
      eq(pg.querySelectorAll('table.q4P tbody tr.q4Row').length,nP,'every priority bundle is in the top table');
      eq(pg.querySelectorAll('table.q4O td.q4D.ok').length,0,'a bundle without a target is never a green 100%');
      ok(/When orders land = parts still on order|nothing is on order/.test((pg.querySelector('.q4Legend')||{}).textContent||''),'the legend is above the tables');
      eq(pg.querySelectorAll('details.q4Prog table.q4G').length,2,'Progress ▾ has its Days and Weeks tables');
      const p=LV3.q4SetOpen('days','progMode');eq(JSON.stringify([p.mode,pg.querySelector('details.q4Prog').getAttribute('data-mode')]),JSON.stringify(['days','days']),'Days / Weeks switches and is remembered');
      ok(!/undefined|NaN/.test(pg.querySelector('.q4').textContent),'no undefined or NaN on the page');
    }finally{try{if(keepPref==null)localStorage.removeItem('lv3.q4.progress');else localStorage.setItem('lv3.q4.progress',keepPref);}catch(e){}
      try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };


  /* 98 · b630 — one press to Jack (the audit of Sarah's clicks, 29 Oct) */
  S['b630: one press to Jack — the card, the case, Send these N, his card shows SellerFuse, Undo']=async()=>{
    /* test mode refuses every write, so a send would roll back — the saves are faked (as check 57 does) */
    const keepSF=SFRUN,keepMS=window._mustSave;window._mustSave=async()=>true;
    try{
      who('Sarah');_admKind='all';_admQ='';
      const a=mkRow({exp:3}),b=mkRow({exp:2}),c=mkRow({exp:4});
      ok(_tcAmzAsk(sarahItem(a)),'an Amazon order nobody has answered is one press to Jack');
      goPage('admin');renderAdmin();await wait(200);
      const mine=x=>[...document.querySelectorAll('#page-admin button')].filter(el=>(el.getAttribute('onclick')||'').includes("'"+x.uuid+"'"));
      ok(mine(a).some(el=>/amzAskJack\(/.test(el.getAttribute('onclick'))&&/has Amazon delivered it/.test(el.textContent)),'the main move is Send to Jack — has Amazon delivered it?');
      ok(!mine(a).some(el=>/start the refund/.test(el.textContent)),'no orange "Sorted — start the refund"');
      ok(mine(a).some(el=>/Close it off another way/.test(el.textContent)),'Close it off another way… is still there');
      ok(![...document.querySelectorAll('#page-admin select.tfuTri')].some(s=>(s.getAttribute('onchange')||'').includes("'"+a.uuid+"'")),'no Yes/No she cannot answer');
      ok(mine(a).some(el=>/askJackAsk\(/.test(el.getAttribute('onclick'))&&/something else/i.test(el.textContent)),'the popup is for something else');
      ok(document.querySelector('#page-admin .admBulk button[onclick^="amzAskJackAll"]'),'Send these N to Jack is on the page');
      /* "No" already picked: the case's first step is the same one press */
      await setTriage(rid(c),'delivered','No');eq(_caseOf(c).step,'to-jack','an Amazon "No" opens the case on Jack’s step');
      ok(_tcAmzAsk(sarahItem(c)),'…and it is still one press');
      renderAdmin();await wait(100);
      ok(mine(c).some(el=>/amzAskJack\(/.test(el.getAttribute('onclick'))),'the case step sends with amzAskJack, no popup');
      /* what Jack sees: SellerFuse's finding on his card */
      SFRUN={id:'chk-630',at:new Date().toISOString(),shipments:[],stock:[],sold:[],excluded:[],summary:{},
        late:[{rowId:a.uuid,sku:a.sku,kind:'late',own:[],asinSkus:[]}]};window.SFRUN=SFRUN;
      eq(sfLateFor(a).state,'clear','SellerFuse found nothing for it');
      /* one press for all of them — only these three, never the real rows on the page */
      await amzAskJackAll([a.uuid,b.uuid,c.uuid]);
      for(const x of [a,b,c]){eq(x.resolution.state,'asked',x.prod+' is with Jack');eq(x.resolution.ask,'Has Amazon delivered it?','the one question');
        ok(onJack(x),'on Jack’s page');ok(!onSarahActive(x),'off her active list');}
      ok((c.resolution.chase.log||[]).some(L=>/has Amazon delivered it/.test(L.what)),'the case carries the send');
      ok(/not on any shipment under this SKU/.test(_jkCheckFacts(a)),'his card says what SellerFuse found — she types nothing');
      who('Jack');goPage('jack');renderJack();await wait(200);
      ok(/SELLERFUSE/.test(document.getElementById('jackWrap').innerHTML)&&/not on any shipment under this SKU/.test(document.getElementById('jackWrap').innerHTML),'…drawn on the card');
      /* Undo puts all three back as they were */
      const u=[...document.querySelectorAll('#toasts button')].reverse().find(el=>/Undo/.test(el.textContent));ok(u,'one Undo for the lot');
      u.click();await wait(300);
      eq(a.resolution,null,'a is back as it was');eq(b.resolution,null,'b is back as it was');eq(c.resolution.state,'working','c is back on its case');
      ok(_tcAmzAsk(sarahItem(a)),'…and one press again');
    }finally{SFRUN=keepSF;window.SFRUN=keepSF;window._mustSave=keepMS;try{goPage('admin');}catch(e){}}
  };
  /* 99 · b630 — the rest of the audit: his ticked answers, her counts, links, the stale line, the SellerFuse box,
     the click counter's name, the Details date, the card's buttons */
  S['b630: Jack’s ticks, counts that are hers, links, SellerFuse clear, the doesn’t-add-up box, click names, date Confirm, buttons wrap']=async()=>{
    const keepSF=SFRUN,keepVA=window.addVaActions,keepMS=window._mustSave;window.addVaActions=async()=>{};window._mustSave=async()=>true;
    const send=async(r,m,txt,acct)=>{jackAnswerAsk(r.uuid);await wait(30);
      if(txt!=null)setVal('askNote',txt);
      const x=document.querySelector(`#askModal input[name="jkMeant"][value="${m}"]`);ok(x,'the tick "'+m+'" is offered');x.checked=true;
      if(acct)setVal('jkAcct',acct);jackAnsCheck();
      ok(!document.getElementById('jkAnsGo').disabled,'the send button opens with the tick');jackAnsSend();await wait(300);};
    try{
      /* 5 · his ticks */
      who('Jack');
      const d=mkRow({exp:4,resolution:asked({ask:'Has Amazon delivered it?'})});
      await send(d,'delivered','not arrived on EU 02 — it is on Biz 04, delivered 12 Oct');
      eq(d.resolution.meant,'delivered','the tick is on the answer');eq(d.delivered,'Yes','delivered — his tick, whatever the words say');
      ok(!d.resolution.jackNote,'not a "Jack needs you to check"');ok(_ansMeans(d.resolution).arrivedYes,'her card reads it as delivered');
      const cx=mkRow({exp:3,resolution:asked({ask:'Has Amazon delivered it?'})});
      await send(cx,'cancelled','refunded on 14 Oct');
      eq(cx.resolution.restGone&&cx.resolution.restGone.why,'cancelled','cancelled → the one-press close she already has');
      const nt=mkRow({exp:2,resolution:asked({ask:'Has Amazon delivered it?'})});
      await send(nt,'note','which account is this on?');ok(nt.resolution.jackNote,'a note is still a check for her');
      mkRow({acct:'Biz 04'});
      const ac=mkRow({exp:2,acct:'EU 02',resolution:asked({ask:'Has Amazon delivered it?'})});
      await send(ac,'account','not eu 02','Biz 04');
      eq(ac.resolution.state,'asked','wrong account: it stays with Jack to answer');eq(ac.resolution.acctFix&&ac.resolution.acctFix.to,'Biz 04','the account he picked is recorded');
      ok(/Biz 04/.test(_jkCheckFacts(ac)),'his card says which account');
      const qf=mkRow({exp:10,resolution:asked({ask:'Has Amazon delivered it?'})});
      await send(qf,'sheet','4 units not 10');
      eq((document.getElementById('qfNew')||{}).value,'4','sheet quantity wrong opens the quantity fix with his number');
      closeQtyFix();
      who('Sarah');goPage('admin');renderAdmin();await wait(200);
      const btns=x=>[...document.querySelectorAll('#page-admin button')].filter(el=>(el.getAttribute('onclick')||'').includes("'"+x.uuid+"'"));
      ok(btns(cx).some(el=>/Note the sheet and close it/.test(el.textContent)),'her card: Note the sheet and close it');
      ok(btns(d).some(el=>/skuCheckOpen|wentOutUnder|wrong-sku|sfCheckedToBecki/.test(el.getAttribute('onclick'))),'her card: the wrong-SKU step');
      /* 3 · her counts are hers */
      _admKind='all';_admQ='';
      const kpi=l=>{const k=[...document.querySelectorAll('#page-admin .jkKpi')].find(x=>(x.querySelector('span')||{}).textContent===l);return k?parseInt(k.querySelector('b').textContent.replace(/\D/g,''))||0:0;};
      const chip=()=>{const c=[...document.querySelectorAll('#page-admin .admChip')].find(x=>/Jack answered/.test(x.textContent));return c?parseInt(c.querySelector('b').textContent)||0:0;};
      const bk=mkRow({exp:5,resolution:asked({state:'rejected',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',amzDelivered:{by:'Jack',at:iso(),sentBy:'Sarah'}})});
      ok(sarahItem(bk)&&sarahItem(bk).withBecki,'a row with Becki');ok(!_admHers(sarahItem(bk)),'…is not hers');
      renderAdmin();await wait(100);
      const n1={chase:kpi('to chase'),unseen:kpi('not opened yet'),jack:chip(),becki:kpi('with Becki · not yours')};
      const keepAD=bk.resolution.amzDelivered;delete bk.resolution.amzDelivered;renderAdmin();await wait(100);
      eq(kpi('to chase'),n1.chase+1,'"to chase" counts only hers');eq(chip(),n1.jack+1,'"Jack answered" counts only hers');
      eq(kpi('not opened yet'),n1.unseen+1,'"not opened yet" counts only hers');
      bk.resolution.amzDelivered=keepAD;renderAdmin();await wait(100);
      ok(n1.becki>=1,'with Becki is counted on its own, as information');
      /* 4 · SellerFuse clear is the wrong-SKU check on record */
      SFRUN=null;window.SFRUN=null;ok(_skuCheckMissing(bk),'no check and no SellerFuse — the line shows');
      SFRUN={id:'chk-630b',at:new Date().toISOString(),shipments:[],stock:[],sold:[],excluded:[],summary:{},late:[{rowId:bk.uuid,sku:bk.sku,kind:'late',own:[],asinSkus:[]}]};window.SFRUN=SFRUN;
      ok(!_skuCheckMissing(bk),'SellerFuse clear counts as the check');
      renderAdmin();await wait(100);
      const bkRow=[...document.querySelectorAll('#page-admin .tfuCompact')].find(x=>x.innerHTML.includes(bk.uuid));
      ok(bkRow&&!/No wrong-SKU check on record/.test(bkRow.textContent),'the stale "Undo, check, send again" line is gone');
      /* 2 · the two links on every card */
      const op=mkRow({exp:2,asin:'B0CHK630LK',sku:'Amuk_5.00_22066_0_CHK_630LK'});renderAdmin();await wait(100);
      const card=[...document.querySelectorAll('#page-admin .tcard')].find(x=>x.innerHTML.includes(op.uuid));
      ok(card&&card.querySelector('a.tcLink[href*="shipment-manager?search=B0CHK630LK"]'),'SellerFuse ↗ searches the ASIN');
      ok(card&&[...card.querySelectorAll('a.tcLink')].some(x=>(x.getAttribute('onclick')||'').includes("tcPrepOpen('Amuk_5.00_22066_0_CHK_630LK')")),'Prep Sheet ↗ searches the SKU');
      /* the buttons wrap inside the card (td{white-space:nowrap}) — checked at the width the page is drawn at */
      const side=card.querySelector('.tcSide'),ask=card.querySelector('.tcActs .tfuAsk');
      eq(getComputedStyle(card).whiteSpace,'normal','the card does not inherit nowrap');
      ok(ask&&ask.getBoundingClientRect().right<=side.getBoundingClientRect().right+1,'Send to Jack sits inside the card, not off its edge');
      /* the "doesn't add up" box: only while the row is hers */
      const lk=mkRow({exp:2,asin:'B0CHK630SF',sku:'CHK_630_SF'});
      SFRUN.shipments=[{id:'FBA15CHK630X',created:'2026-10-20',status:'CLOSED',lines:[{sku:'CHK_630_SF',asin:'B0CHK630SF',units:3}]}];
      ok(sfPrepIssues().some(x=>x.kind==='look'&&x.row===lk),'3 went to Amazon on an order of 2 — hers to look at');
      ok(sfSarahHtml().includes(lk.prod),'listed while it is hers');
      lk.resolution=asked();ok(!sfSarahHtml().includes(lk.prod),'not while it waits on Jack');
      lk.resolution={state:'approved',kind:'ops',what:'arrived-ok',at:iso()};ok(!sfSarahHtml().includes(lk.prod),'not once it is closed');
      lk.resolution=asked({state:'rejected',rejectNote:'Arrived — YES',amzDelivered:{by:'Jack',at:iso(),sentBy:'Sarah'}});ok(!sfSarahHtml().includes(lk.prod),'not while Becki has it');
      /* the click counter names her dropdown */
      const was=_usage,cw={id:cu.id,name:cu.name};const box=document.createElement('div');document.querySelector('#page-admin').appendChild(box);
      try{cu.id=cu.id||'check';cu.name='CheckUser';_usage=null;window.chkTri=()=>{};
        box.innerHTML='<table><thead><tr><th colspan="8">Sort#▲ProductSupplier / order</th></tr></thead><tbody><tr><td colspan="8"><select data-u="Has it arrived?" onchange="chkTri(this)"><option value=""></option><option>No</option></select></td></tr></tbody></table>';
        const s=box.querySelector('select');s.value='No';s.dispatchEvent(new Event('change',{bubbles:true}));
        eq(JSON.stringify(Object.keys(_usage.c)),JSON.stringify([_usagePlace(s)+' › Has it arrived? = No']),'the triage dropdown is counted by its question');
      }finally{box.remove();_usage=was;cu.id=cw.id;cu.name=cw.name;delete window.chkTri;}
      /* 6 · the Details date saves on Confirm, not on every change */
      const dt=mkRow({sup:'Argos',acct:'',oid:'ARG-CHK-630',exp:2});
      openWork(dt.uuid);await wait(50);
      const inp=document.getElementById('workDue');ok(inp&&!inp.getAttribute('onchange'),'the box does not save on change');
      const day=ukAddDays(todayISO(),9);setVal('workDue',day);await wait(50);
      eq(dt.expectedDelivery||'','','typing a date saves nothing');
      await workDueConfirm();eq(dt.expectedDelivery,day,'Confirm saves it');
      closeWork();
    }finally{SFRUN=keepSF;window.SFRUN=keepSF;window.addVaActions=keepVA;window._mustSave=keepMS;try{askShut();closeQtyFix();closeWork();}catch(e){}}
  };

  /* 103 · the close-off guards (Jack, 29 Oct — the C920 and the OneBlade): a guess never becomes a fact */
  S['b631: close-off guards — Arrived is Becki’s count, went-out-under is this product’s SKU, Amazon waits for Jack, Undo puts the units back']=async()=>{
    who('Sarah');
    const _la=window.logAudit,LOG=[];window.logAudit=function(a,d){LOG.push({action:a,detail:String(d||'')});return _la.apply(this,arguments);};
    try{
    /* a + e · Arrived can't be typed over; "arrived and correct" with units out sends them to Becki — and says so */
    const sup=mkRow({sup:'Argos',acct:'',oid:'ARG-631-1',exp:3,rcvd:1,status:'In Warehouse'});
    openSorted(sup.uuid,'arrived-ok');await wait(40);
    const gotEl=document.getElementById('srtGot');ok(gotEl&&gotEl.readOnly,'the Arrived box is read-only');
    gotEl.value='3';srtSync();
    eq(String(document.getElementById('srtGot').value),'1','it shows what Becki booked in, whatever is typed');
    const sn=(document.getElementById('srtSettleNote')||{}).textContent||'';
    ok(/Becki to check the shelves/.test(sn)&&!/as arrived/.test(sn),'the text says the 2 go to Becki — got: '+sn.slice(0,140));
    ok(/Ask Becki to check the shelves/.test((document.getElementById('srtGotAsk')||{}).innerHTML||''),'one press to ask Becki');
    await submitSorted();await wait(300);
    eq(parseInt(sup.rcvd),1,'closing never books units in');ok(_isAmzDel(sup),'the 2 still out are on Becki’s shelf check');
    ok(sup.resolution.closeSnap&&sup.resolution.closeSnap.before,'the close carries its snapshot');
    await reopenResolution(sup.uuid,true);
    ok(!_isAmzDel(sup),'Undo takes the shelf check off');eq(sup.resolution,null,'…and the row is back where it was');
    ok(/close-off undone — no need to check the shelves/.test(sup.vaNote||''),'Becki’s note says so');
    const sup2=mkRow({sup:'Argos',acct:'',oid:'ARG-631-2',exp:2,rcvd:0});
    openSorted(sup2.uuid,'arrived-ok');await wait(40);await srtToBecki();
    ok(_isAmzDel(sup2),'“Ask Becki” puts a supplier row on her shelf check');eq(parseInt(sup2.rcvd)||0,0,'…and books nothing in');
    /* c · an Amazon order's "it's here" waits for Jack's account check — the button sends it, with her note */
    const amz=mkRow({exp:2,rcvd:0});
    openSorted(amz.uuid,'wrong-sku');await wait(40);srtSync();
    eq((document.getElementById('srtGo')||{}).textContent,'Send to Jack — check the Amazon order first','the button sends it to Jack');
    setVal('srtSku','FBA15M8T8MRG and FBA15MB9ZJ4L same SKU was sent');srtSkuShut();setVal('srtNote','Seller Central shows it on FBA15M8T8MRG');
    await srtAskClose();await wait(50);
    eq(amz.resolution&&amz.resolution.state,'asked','with Jack — nothing closed');eq(amz.resolution.what,'jack-check','an account check');
    ok(/Seller Central shows it/.test(amz.resolution.note||'')&&/FBA15M8T8MRG and FBA15MB9ZJ4L/.test(amz.resolution.note||''),'her note and what she typed go with it');
    eq(parseInt(amz.cancelledQty)||0,0,'no units moved');ok(onJack(amz),'on Jack’s page');
    ok(!_srtAmzGate('cancelled',amz)&&!_srtAmzGate('duplicate',amz),'cancelled / duplicate are left as they are');
    who('Jack');ok(!_srtAmzGate('wrong-sku',amz),'Jack closing it himself is the account check');
    await jackAnswered(amz.uuid,'Arrived — YES, the account shows it delivered.');
    who('Sarah');ok(!_srtAmzGate('wrong-sku',amz),'his YES opens it');
    const no=mkRow({exp:2,rcvd:0,resolution:asked({state:'rejected',rejectNote:'NOT arrived — cancelled or nothing coming. Chase or claim.',rejectedBy:'Jack'})});
    eq((_srtAmzGate('arrived-ok',no)||{}).why,'not-arrived','his “not arrived” sends an “it’s here” back to him');
    /* b · went out under: a SKU of this product — a shipment ID refused, anything else needs a reason */
    const A='B0CHK631SKU';
    const sis=mkRow({asin:A,sku:'Amuk_9.99_29106_0_CHK631_B',exp:2,rcvd:4,ship:4});
    const oth=mkRow({asin:'B0CHK631OTH',sku:'Amuk_9.99_29106_0_CHK631_O',exp:1,rcvd:1,ship:1});
    const ws=mkRow({asin:A,exp:2,rcvd:0,resolution:asked({state:'rejected',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack'})});
    openSorted(ws.uuid,'wrong-sku');await wait(40);
    setVal('srtSku','FBA15M8T8MRG and FBA15MB9ZJ4L same SKU was sent');srtSkuShut();srtSync();
    ok(window._srtGate.missingAsk&&window._srtGate.skuShip,'shipment IDs are refused');
    setVal('srtSkuWhy','test: it really did');srtSync();ok(window._srtGate.missingAsk,'…even with a reason');
    srtAskClose();
    ok(/That's a shipment ID — pick the SKU it went out under/.test((document.getElementById('srtMsg')||{}).textContent||''),'it says so in those words');
    setVal('srtSkuWhy','');setVal('srtSku',oth.sku);srtSkuShut();srtSync();
    ok(window._srtGate.missingAsk&&window._srtGate.skuOther==='other','another product’s SKU needs a reason');
    setVal('srtSkuWhy','test: Becki relabelled it');srtSync();ok(!window._srtGate.missingAsk,'…and opens with one');
    setVal('srtSkuWhy','');setVal('srtSku',sis.sku.toLowerCase());srtSkuShut();srtSync();
    ok(!window._srtGate.missingAsk,'this product’s SKU from the list needs nothing more');
    const closeWs=async()=>{document.querySelectorAll('#sortedModal input[data-k]').forEach(c=>{c.checked=true;srtTick(c);});srtSync();await submitSorted();await wait(300);};
    await closeWs();
    eq(ws.resolution.wentAs,sis.sku,'recorded as the real SKU');eq(parseInt(ws.cancelledQty),2,'the 2 counted as gone out under it');
    ok(ws.resolution.jackCheck&&ws.resolution.jackCheck.how==='answer','Jack’s check is kept with the close');
    /* d · Undo puts the units back and the row where it was — Jack's answer on it; recorded in the audit */
    await reopenResolution(ws.uuid,true);
    eq(parseInt(ws.cancelledQty)||0,0,'Undo: the 2 are owed again');eq(ws.resolution&&ws.resolution.state,'rejected','back with Sarah');
    ok(/Arrived — YES/.test(ws.resolution.rejectNote||''),'Jack’s answer is still on it');
    ok(LOG.some(e=>e.action==='Closure reopened'&&String(e.detail).includes(ws.sku)&&/Cancelled 2 → 0/.test(e.detail)),'the restore is in the audit log');
    /* d · a count made after the close is never undone */
    openSorted(ws.uuid,'wrong-sku');await wait(40);setVal('srtSku',sis.sku);srtSkuShut();srtSync();await closeWs();
    eq(parseInt(ws.cancelledQty),2,'closed again');
    ws.rcvd=1;ws.rcvdAt=new Date().toISOString();   /* Becki books one in afterwards */
    await reopenResolution(ws.uuid,true);
    eq(parseInt(ws.rcvd),1,'Becki’s count stays');eq(parseInt(ws.cancelledQty)||0,0,'the close’s 2 come back');
    ok(LOG.some(e=>e.action==='Closure reopened'&&String(e.detail).includes(ws.sku)&&/left as they are: Qty Received/.test(e.detail)),'…and the audit says the count was left alone');
    try{closeSorted();}catch(e){}
    }finally{window.logAudit=_la;}
  };
  /* 104 · Jack's list of close-offs that look wrong — the rules above, read off the last 30 days */
  S['b631: close-offs that look wrong are back on Jack’s page — shipment ID, no account check, booked in by the close-off']=async()=>{
    const at=new Date(Date.now()-3600e3).toISOString(),stamp=new Date(Date.parse(at)+1500).toISOString(),old=new Date(Date.now()-4*864e5).toISOString();
    const closed=f=>Object.assign({state:'approved',kind:'ops',by:'Sarah',at,approvedBy:'Sarah',approvedAt:at},f);
    const td=todayDDMM(),B='B0CHK631MB',SIS='Amuk_5_29106_0_CHK631_MB2';
    mkRow({asin:B,sku:SIS,exp:2,rcvd:4,ship:4});
    /* a · the OneBlade's words in the SKU box, on a supplier order (so only a applies) */
    const fa=mkRow({sup:'Argos',acct:'',oid:'ARG-631-A',date:td,exp:2,rcvd:0,cancelledQty:2,
      resolution:closed({what:'wrong-sku',wentAs:'FBA15M8T8MRG and FBA15MB9ZJ4L same SKU was sent',wentAsQty:2})});
    /* b · an Amazon order traced to a real sister SKU — Jack never asked */
    const fb=mkRow({asin:B,date:td,exp:2,rcvd:0,cancelledQty:2,resolution:closed({what:'wrong-sku',wentAs:SIS,wentAsQty:2})});
    /* c · a supplier order closed "arrived and correct" with 2 typed in: stamped in the close's own save, nothing sent */
    const fc=mkRow({sup:'Argos',acct:'',oid:'ARG-631-C',date:td,exp:2,rcvd:2,rcvdAt:stamp,status:'In Warehouse',resolution:closed({what:'arrived-ok'})});
    /* the C920 itself: an Amazon order, 2 typed in, nothing sent — b and c */
    const c920=mkRow({oid:'202-5081951-0344399',sku:'Amuk_37.99_06106_55_VAS_CHK631',date:td,exp:2,rcvd:2,rcvdAt:stamp,status:'In Warehouse',resolution:closed({what:'arrived-ok'})});
    /* clean: Jack's check on record with a real sister SKU; a supplier order Becki counted days before its close */
    const k1=mkRow({asin:B,date:td,exp:2,rcvd:0,cancelledQty:2,resolution:closed({what:'wrong-sku',wentAs:SIS,wentAsQty:2,jackCheck:{how:'answer',by:'Jack',at}})});
    const k2=mkRow({sup:'Argos',acct:'',oid:'ARG-631-K',date:td,exp:2,rcvd:2,rcvdAt:old,status:'In Warehouse',resolution:closed({what:'arrived-ok'})});
    const mine=[fa,fb,fc,c920,k1,k2].map(r=>r.uuid);
    const _la=window.logAudit,LOG=[];window.logAudit=function(a,d){LOG.push({action:a,detail:String(d||'')});return _la.apply(this,arguments);};
    try{
    const L=()=>closeMistakes().filter(m=>mine.includes(m.rid));
    const kinds=r=>JSON.stringify(((L().find(m=>m.rid===r.uuid)||{}).kinds)||[]);
    eq(kinds(fa),JSON.stringify(['a']),'a · a shipment ID in “went out under”');
    eq(kinds(fb),JSON.stringify(['b']),'b · an Amazon order closed without Jack’s account check');
    eq(kinds(fc),JSON.stringify(['c']),'c · booked in by the close-off, nothing sent');
    eq(kinds(c920),JSON.stringify(['b','c']),'the C920: both');
    eq(JSON.stringify(L().map(m=>m.rid).filter(id=>id===k1.uuid||id===k2.uuid)),JSON.stringify([]),'the clean close-offs are not listed');
    ok(/2 shipment IDs, not a SKU/.test(L().find(m=>m.rid===fa.uuid).why[0].t),'it says what looks wrong in plain words');
    ok(/booked in 2 that nobody counted/.test(L().find(m=>m.rid===fc.uuid).why[0].t),'…with the numbers');
    who('Sarah');eq(closeMistakesHtml(),'','Jack only');
    who('Jack');const h=closeMistakesHtml();
    ok(/Close-offs that look wrong/.test(h)&&h.includes(`closeMistakeReopen('${fc.uuid}')`)&&/Looks right/.test(h),'Jack gets the list, Reopen on each line');
    /* Reopen an old close-off (no snapshot): what it recorded exactly comes back; a typed count is named */
    await closeMistakeReopen(fb.uuid);eq(parseInt(fb.cancelledQty)||0,0,'the 2 it traced are owed again');
    await closeMistakeReopen(fc.uuid);eq(parseInt(fc.rcvd),2,'Qty Received is left for Jack to correct');
    ok(LOG.some(e=>e.action==='Closure reopened'&&String(e.detail).includes(fc.sku)&&/check Qty Received: the close-off booked in 2/.test(e.detail)),'…and named: check Qty Received, the close-off booked in 2');
    await closeMistakeOk(fa.uuid);ok(!L().some(m=>m.rid===fa.uuid),'“Looks right” keeps it closed and off the list');
    eq(JSON.stringify(L().map(m=>m.rid)),JSON.stringify([c920.uuid]),'only the C920 is left');
    }finally{window.logAudit=_la;}
  };

  /* 112 · b627: looks wrong → Jack; Already sent needs SellerFuse; Ordered locked */
  S['b627: a close-off that looks wrong goes to Jack; Already sent needs SellerFuse; Ordered is locked']=async()=>{
    const keepRun=SFRUN;
    try{
      who('Sarah');
      const own=mkRow({asin:'B0CHK627A1',sku:'Amuk_3_07076_0_CHK_627OLD',date:'07/07',exp:36,rcvd:36,ship:36,status:'Sent to Amazon',sent:'Yes'});
      const r=mkRow({asin:'B0CHK627A1',sku:'Amuk_3_29096_0_CHK_627NEW',exp:28,rcvd:0,sup:'Mifarma',acct:'BDL Account',date:'29/09'});
      SFRUN=Object.assign({late:[],stock:[],sold:[],excluded:[],summary:{}},keepRun||{},{shipments:[]});
      openSorted(r.uuid,'wrong-sku');await wait(40);
      const o=document.getElementById('srtOrd');ok(o&&o.readOnly,'Ordered is locked');
      setVal('srtSku',own.sku);try{srtSkuShut();}catch(e){}srtSync();
      setVal('srtSkuWhy','sure it went');srtSync();
      document.querySelectorAll('#sortedModal input[data-k], .srtMod input[data-k]').forEach(c=>{c.checked=true;try{srtTick(c);}catch(e){}});srtSync();
      await submitSorted();await wait(60);
      eq(r.resolution&&r.resolution.state,'proposed','an overridden SKU check does not close — it goes to Jack');
      ok(r.resolution.looksWrong&&/only sent what its own order/.test(r.resolution.looksWrong.why),'…marked looks wrong, with the reason');
      eq(parseInt(r.rcvd)||0,0,'nothing is booked in before Jack decides');
      who('Jack');ok(jackTodo().closures.some(x=>x===r),'it is on Jack’s page as a decision');
      /* Already sent: SellerFuse must show it */
      who('Sarah');const s=mkRow({asin:'B0CHK627B1',sku:'Amuk_5_20106_0_CHK_627S',exp:2,rcvd:0});
      openSorted(s.uuid,'sent-not-stamped');await wait(40);setVal('srtShipId','FBA15CHK627X');srtSync();
      document.querySelectorAll('#sortedModal input[data-k], .srtMod input[data-k]').forEach(c=>{c.checked=true;try{srtTick(c);}catch(e){}});srtSync();
      await submitSorted();await wait(60);
      eq(_sentOut(s),0,'Already sent with a shipment SellerFuse hasn’t seen this product on → stays late');
      try{closeSorted();}catch(e){}
      SFRUN.shipments=[{id:'FBA15CHK627X',created:'2026-10-28',status:'IN_TRANSIT',lines:[{sku:s.sku,asin:s.asin,units:2}]}];
      openSorted(s.uuid,'sent-not-stamped');await wait(40);setVal('srtShipId','FBA15CHK627X');srtSync();
      document.querySelectorAll('#sortedModal input[data-k], .srtMod input[data-k]').forEach(c=>{c.checked=true;try{srtTick(c);}catch(e){}});srtSync();
      await submitSorted();await wait(60);
      eq(_sentOut(s),2,'…and once SellerFuse shows it on that shipment, it closes');
    }finally{SFRUN=keepRun;window.SFRUN=keepRun;try{closeSorted();}catch(e){}}
  };

  /* 113 · b628: Q4 prepping is the Christmas lines only — Jack adds the rest (30 Oct) */
  S['b628: Q4 prepping is the Christmas lines only — Doves off, add / take off saves, a new Christmas line turns up']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const L=q=>[{id:'l'+q,date:'2026-09-20',qty:q,rem:q,cost:1,arr:1}];
    const comps=[{id:'q5-tin',name:'CHECK Tin',layers:L(100)},{id:'q5-oat',name:'CHECK Oats',layers:L(40)},
      {id:'q5-fill',name:'CHECK Filler',layers:L(30)},{id:'q5-key',name:'CHECK Magic Key',layers:L(20)}];
    const B=(id,name,rec)=>({id,asin:'B0Q5'+id.slice(3).toUpperCase(),name,type:'bundle',recipe:rec.map(([c,q])=>({c,q})),layers:[]});
    const prods=[B('q5-ham','CHECK Gift Hamper',[['q5-tin',1]]),B('q5-dove','CHECK Dove 75ml',[['q5-tin',1]]),
      B('q5-rein','CHECK Reindeer Food',[['q5-oat',1]]),B('q5-poly','CHECK Polyfilla Bundle',[['q5-fill',1]]),
      B('q5-xmas','CHECK Christmas Eve Box',[['q5-key',1]]),B('q5-dec','CHECK Decaf Tea Set',[['q5-oat',1]])];
    const ships=[{shipId:'FBA15CHKQ5D1',asin:'B0Q5DOVE',units:10,date:'2026-10-05'},{shipId:'FBA15CHKQ5H1',asin:'B0Q5HAM',units:20,date:'2026-10-05'}];
    const calc=inc=>LV3.q4Calc({products:prods,components:comps,purchases:[],shipments:ships,owed:{},targets:{},over:5,today:'2026-10-07',include:inc,
      protDays:p=>({'q5-dove':1,'q5-ham':5,'q5-rein':6,'q5-dec':7,'q5-xmas':8,'q5-poly':2})[p.id]});
    const ids=R=>R.bundles.map(r=>r.id).sort().join(',');
    const R0=calc({});
    eq(ids(R0),'q5-dec,q5-ham,q5-rein,q5-xmas','by itself: hamper, reindeer, decaf, Christmas — never the Dove or the Polyfilla');
    eq(R0.offPage.map(x=>x.id).join(','),'q5-dove,q5-poly','…and those two are in the "+ Add" list');
    eq(R0.bundles.find(r=>r.id==='q5-ham').left,100,'the Dove is out of the queue, so it never takes the hamper’s tins');
    eq(JSON.stringify([R0.totals.done,R0.sends.length]),JSON.stringify([20,1]),'its sends are out of the totals and Progress');
    ok(R0.bundles.some(r=>r.id==='q5-xmas'),'a new Christmas line turns up by itself');
    const R1=calc({on:['q5-dove']}),dv=R1.bundles.find(r=>r.id==='q5-dove');
    ok(dv,'Jack adds the Dove — it is on the page');eq(JSON.stringify([dv.left,R1.bundles.find(r=>r.id==='q5-ham').left,R1.totals.done]),JSON.stringify([100,0,30]),
      '…and shares the parts in the Action centre’s order like any line');
    const R2=calc({off:['q5-rein']});
    ok(!R2.bundles.some(r=>r.id==='q5-rein')&&R2.offPage.some(x=>x.id==='q5-rein'),'Jack takes the Reindeer Food off — it goes to the "+ Add" list');
    eq(calc(undefined).bundles.length,6,'a run on made-up products with no list counts them all (the older checks)');
    eq(calc('all').bundles.length,6,'…and so does "all"');
    /* the live data */
    const D=LV3.__D(),liveR=LV3.q4Calc({include:{}});
    ok(!liveR.bundles.concat(liveR.singles).some(r=>/\bdove\b|polyfilla/i.test(r.name)),'live: no Dove or Polyfilla on the page by itself');
    ok(D.products.filter(p=>!p.archived&&/hamper|gift|gluten free|decaf|hot choc|reindeer|fragrance|christmas|santa/i.test(p.name||''))
      .every(p=>liveR.bundles.concat(liveR.singles).some(r=>r.id===String(p.id))),'live: every hamper, gift, gluten free, decaf, hot chocolate, reindeer, fragrance and Christmas line is on');
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('q4');await wait(150);
      const pg=document.getElementById('page-lavarion'),set=pg.querySelector('details.q4Set'),cur=LV3.q4Calc();
      const names=new Set(cur.bundles.concat(cur.singles).map(r=>r.name));
      ok(set&&set.querySelector('select#q4add'),'Settings ▾ has the "+ Add to Q4 prepping" picker');
      eq(set.querySelectorAll('select#q4add option').length,cur.offPage.length+1,'…listing everything that is off the page');
      eq(set.querySelectorAll('.q4SetRow .q4Rm').length,cur.bundles.concat(cur.singles).filter(r=>!r.archived).length,'a × on every line that is on');
      ok([...pg.querySelectorAll('table.q4T td.q4N b')].every(b=>names.has(b.textContent)),'the tables show only what is on the page');
      eq([...pg.querySelectorAll('.q4Panel .ph .t')].some(t=>/Singles/.test(t.textContent)),cur.singles.length>0,'Singles shows only when one is on the page');
      ok(!/undefined|NaN/.test(pg.querySelector('.q4').textContent),'no undefined or NaN on the page');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
    /* add / take off saves (database faked) */
    const q4Norm=v=>{const c=v&&typeof v==='object'?v:{};return{on:(c.on||[]).map(String).sort(),off:(c.off||[]).map(String).sort()};};
    const keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase(),logN=D.log.length,inc0=JSON.stringify(q4Norm(D.settings.q4Include));
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
    sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:{value:keepS},error:null}),
      upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
    try{
      LV3.__setPrefsBase(JSON.parse(keepS));
      const add=LV3.q4Calc().offPage[0],has=id=>{const c=LV3.q4Calc();return c.bundles.concat(c.singles).some(r=>r.id===id);};
      if(add){
        ok(await LV3.q4Pick(add.id,true),'adding a line reports the save landed');
        ok(wrote&&has(add.id),'…it is on the page');
        ok(await LV3.q4Pick(add.id,false),'taking it off again saves');
        ok(!has(add.id)&&JSON.stringify(q4Norm(wrote.q4Include))===inc0,'…and the list is back as it was');
      }
      const s=LV3.q4Calc().bundles.find(r=>!r.archived&&!r.target);
      if(s){
        await LV3.q4Pick(s.id,false);ok(wrote&&wrote.q4Include&&wrote.q4Include.off.includes(s.id)&&!has(s.id),'a Christmas line taken off is saved as off — it stays off');
        await LV3.q4Pick(s.id,true);ok(has(s.id)&&JSON.stringify(q4Norm(wrote.q4Include))===inc0,'…and put back');
      }
      ok(D.log.slice(0,D.log.length-logN).some(x=>/Q4 prepping: .+ (added to|taken off) the page/.test(JSON.stringify(x))),'each change is in History');
    }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));
      LV3.__setPrefsBase(keepB);D.log.splice(0,D.log.length-logN);}
  };

  /* 114 · b629: Products — the Sold / Per day labels can be read, and Per day says how it leaves empty days out */
  S['b629: Products labels are never cut off; Per day shows “÷ N days in stock” only when that is the sum']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    /* the sum, on made-up paces */
    const sf=(pc)=>({src:'sf',pace:pc});
    eq(LV3.pdInStock(sf({fastW:7,empty:{7:1,14:1,30:7},sell:{7:6,14:13,30:23},u7:30,u14:60,u30:99,perDay:5})),'<span class="pdIn">÷ 6 days in stock</span>',
      'GF Snack: 30 sold in 7 days, empty 1 → ÷ 6 days in stock (5.0 a day)');
    eq(LV3.pdInStock(sf({fastW:7,empty:{7:0},sell:{7:7},u7:21,perDay:3})),'','never empty → no sum line');
    eq(LV3.pdInStock(sf({fastW:30,empty:{30:20},sell:{30:10},u30:5,perDay:4,why:'prev30'})),'','the month-before fallback is not a ÷ in-stock sum → no line');
    eq(LV3.pdInStock({src:'season',pace:null}),'','a typed or seasonal figure → no line');
    /* the page */
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('products');await wait(250);
      const pg=document.getElementById('page-lavarion'),subs=[...pg.querySelectorAll('.panel.stick tbody td .sldSub')].filter(s=>s.offsetParent);
      ok(subs.length>0,'the Products table draws its sub-labels');
      const cut=subs.filter(s=>s.scrollWidth>s.clientWidth+1);
      eq(cut.length,0,'no sub-label is cut off'+(cut.length?' — '+cut.slice(0,3).map(s=>'“'+s.textContent.trim()+'”').join(', '):''));
      ok(!subs.some(s=>/empty \d+ of (7|30) days/.test(s.textContent)),'the old “empty N of 7 days” wording is gone');
      ok(!/undefined|NaN/.test(pg.querySelector('.panel.stick').textContent),'no undefined or NaN in the table');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 115 · b629: the ASIN copies again; what is on its way in parts shows every part and the real empty days */
  S['b629: pressing an ASIN copies it (two copyAsin clashed); on its way in parts — every part, the real empty days, WAIT for what']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const W=LV3.shelfWalk(0,5,[{q:403,eta:'2026-11-13'},{q:9,eta:'2026-11-02'}],'2026-10-30');
    eq(JSON.stringify([W.gap,Math.floor(W.own),W.legs.length,W.tranches.map(x=>x.q)]),JSON.stringify([12,0,2,[9,403]]),
      'GF Snack: 9 land ~2 Nov, 403 ~13 Nov → about 12 days empty in two stretches, not 3');
    const W2=LV3.shelfWalk(100,5,[{q:50,eta:'2026-11-02'}],'2026-10-30');
    eq(JSON.stringify([W2.gap,W2.total]),JSON.stringify([0,30]),'lands before the shelf empties → no gap, days left counts it');
    eq(LV3.shelfWalk(2,5,[{q:30,eta:'2026-11-02'}],'2026-10-30').gap,3,'one part: the same answer as before (empty ~3 days)');
    const cb=navigator.clipboard;ok(cb&&cb.writeText,'the clipboard is there to test');
    let got=null;const had=Object.prototype.hasOwnProperty.call(cb,'writeText'),keepW=cb.writeText;
    cb.writeText=t=>{got=t;return Promise.resolve();};
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('products');await wait(250);
      const b=document.querySelector('#page-lavarion .panel.stick tbody .asinC');ok(b,'an ASIN button on Products');
      b.click();await wait(30);eq(got,b.textContent.trim(),'pressing the ASIN copies the ASIN');
      got=null;const el=document.createElement('span');el.innerHTML='<span class="sAsinT">B0CHK629CP</span>';
      LV3.copyAsinChip(el,'B0CHK629CP');await wait(30);
      eq(got,'B0CHK629CP','the send-card chip still copies');eq(el.querySelector('.sAsinT').textContent,'Copied','…and says Copied');
      ok(!/undefined|NaN/.test(document.querySelector('#page-lavarion .panel.stick').textContent),'no undefined or NaN in the table');
    }finally{if(had)cb.writeText=keepW;else delete cb.writeText;try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 116 · b629: Next step says when, the verdict, what to send and what stops it */
  S['b629: Products Next step — when to act on top, the verdict, what to send, what stops it, in words']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('products');await wait(250);
      const cells=[...document.querySelectorAll('#page-lavarion .panel.stick tbody .nsC')];
      ok(cells.length>0,'Next step cells are drawn');
      const by=k=>cells.filter(c=>{const s=c.querySelector('span[style*="background"]');return s&&s.textContent.trim()===k;});
      const top=c=>((c.querySelector('.nsTop')||{}).textContent||'').trim();
      by('SAFE').forEach(c=>ok(/^~\d\d\/\d\d/.test(top(c)),'SAFE says when the next send is due: '+top(c)));
      by('SEND NOW').forEach(c=>eq(top(c),'today','SEND NOW says today'));
      by('SEND').forEach(c=>ok(/^by \d\d\/\d\d/.test(top(c)),'SEND says the last day: '+top(c)));
      by('WAIT').forEach(c=>ok(/^~\d\d\/\d\d/.test(top(c))&&/on the way/.test(c.textContent),'WAIT says what for'));
      by('GET PARTS').forEach(c=>ok(/send \d/.test(c.textContent)&&!/none can be built/.test(c.textContent),'GET PARTS says what to send, without repeating that none can be built'));
      ok(!cells.some(c=>/\d+ now\b/.test(c.textContent)),'the old “· 0 now” is gone');
      ok(cells.every(c=>/days of stock/.test(c.getAttribute('title')||'')||!c.querySelector('.nsTop')),'the days of stock are in the tooltip');
      ok(!/undefined|NaN/.test(cells.map(c=>c.textContent+(c.getAttribute('title')||'')).join(' ')),'no undefined or NaN');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 117 · b630: shared parts — some for everyone first, the rest to the fastest seller; uplift words; empty days in SF's window */
  S['b630: shared parts — one each, then the 3-week minimum, then the fastest seller; Reindeer gets the uplift; empty days in SellerFuse’s window']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const C={w:{id:'w',name:'Wool'},t:{id:'t',name:'Tin'}};
    const run=(have,rows)=>LV3.shareParts(rows,{have:c=>have[c.id],comp:id=>C[id],floor:r=>r._fl});
    const mk=(id,rec,ads,pd,fl,rc)=>({p:{id,name:'CHECK '+id,type:'bundle',recipe:rc||[{c:'w',q:1}]},rec,ads,protDays:pd,_fl:fl});
    let A=mk('fast',200,100/30,10,70),B=mk('slow',3,1/30,5,1);run({w:100,t:1000},[B,A]);
    eq(JSON.stringify([A.alloc,B.alloc]),JSON.stringify([99,1]),'Jack’s wool: 100 wool, 100 a month vs 1 a month → 99 and 1');
    eq(JSON.stringify(B.limTakers),JSON.stringify(['CHECK fast']),'the slow one says who else gets the wool');
    A=mk('fast',200,100/30,10,70);B=mk('slow',3,1/30,5,1);run({w:50,t:1000},[B,A]);
    ok(A.alloc>0&&B.alloc>0&&A.alloc+B.alloc===50,'not enough for the minimums: both still get some, and never more than there is ('+A.alloc+' + '+B.alloc+')');
    A=mk('fast',200,100/30,10,70);B=mk('slow',3,1/30,5,1);const X=mk('urgent',20,0.5,0,15);run({w:30,t:1000},[X,B,A]);
    ok(X.alloc>=15&&B.alloc>=1&&A.alloc>=1&&X.alloc+B.alloc+A.alloc===30,'the minimums go closest-to-empty first ('+[X.alloc,B.alloc,A.alloc].join(', ')+')');
    A=mk('fast',200,100/30,10,70,[{c:'w',q:1},{c:'t',q:1}]);B=mk('slow',3,1/30,5,1);run({w:100,t:10},[B,A]);
    eq(JSON.stringify([A.alloc,A.lim&&A.lim.id,B.alloc]),JSON.stringify([10,'t',3]),'a second part still limits — the tin stops the fast one at 10, so the slow one gets all it asked for');
    /* uplift words — the defaults (nothing saved) */
    const D=LV3.__D(),keepU=D.settings.q4Uplift;delete D.settings.q4Uplift;
    try{
      const rf=D.products.find(p=>!p.archived&&/reindeer/i.test(p.name||''));
      if(rf)ok(LV3.upliftOf(rf),'Reindeer Food gets the Christmas uplift');
      D.products.filter(p=>!p.archived&&/decaf|chocolate|hamper|gift/i.test(p.name||'')).forEach(p=>ok(LV3.upliftOf(p),p.name+' gets the uplift'));
      const dv=D.products.find(p=>!p.archived&&/\bdove\b/i.test(p.name||''));if(dv)ok(!LV3.upliftOf(dv),'a Dove does not');
    }finally{if(keepU!==undefined)D.settings.q4Uplift=keepU;}
    /* empty days counted in SellerFuse's window: checked 2 days ago, empty 8–7 days ago = inside its 7 days */
    const p=D.products.find(x=>!x.archived&&x.asin&&x.type==='bundle'),keepS=JSON.stringify(D.settings.stockOuts||[]),keepF=JSON.stringify((D.settings.sfSold||{})[p.asin]||null);
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    const ago=k=>{const x=new Date();x.setDate(x.getDate()-k);return isoDay(x);};
    try{
      D.settings.sfSold=D.settings.sfSold||{};D.settings.sfSold[p.asin]={u30:30,u14:14,u7:10,at:new Date(Date.now()-2*864e5).toISOString()};
      D.settings.stockOuts=[{id:'chk630',asin:p.asin,kind:'out',from:ago(8),to:ago(7),pace:1,pu:2}];
      const pc=LV3.sfPace(p);eq(pc&&pc.empty[7],2,'checked 2 days ago: its 7 days run to that day, so 2 empty days 8 and 7 days ago count');
    }finally{D.settings.stockOuts=JSON.parse(keepS);const f=JSON.parse(keepF);if(f)D.settings.sfSold[p.asin]=f;else delete D.settings.sfSold[p.asin];}
  };

  /* 118 · b630: Stock at Amazon is SellerFuse's job — locked, one logged unlock; open when SellerFuse is 3+ days behind */
  S['b630: Stock at Amazon opens locked (SellerFuse fills it), one logged unlock, unlocked when SellerFuse is 3+ days behind']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),logN=D.log.length;
    D.settings.sfSold=D.settings.sfSold||{};D.settings.sfSold['B0CHK630AM']={u30:0,at:new Date(Date.now()-864e5).toISOString()};   /* a SellerFuse check a day ago */
    try{
      LV3.openAtAmz();await wait(60);
      const M=document.getElementById('lav3Mod2');
      ok(M.querySelector('.amzSfNote')&&/SellerFuse fills this in now/.test(M.querySelector('.amzSfNote').textContent),'it says SellerFuse fills it in');
      ok(M.classList.contains('amzLock')&&document.getElementById('amzGo').disabled,'locked: Save counts is off');
      ok([...M.querySelectorAll('.mb > :not(.amzSfNote)')].every(e=>e.inert),'the boxes cannot be reached, by mouse or keyboard');
      ok(LV3.amzLocked(),'amzLocked says so');
      LV3.amzUnlock();await wait(60);
      ok(!LV3.amzLocked()&&!M.classList.contains('amzLock'),'one press unlocks it');
      ok(/hand count unlocked by .+ Jack asked/.test(D.log[0].txt),'…and it is in History');
      try{LV3.cm('lav3Ov2');}catch(e){}
    }finally{D.log.splice(0,D.log.length-logN);delete D.settings.sfSold['B0CHK630AM'];}
  };

  /* 119 · b630: the Q4 page audit — one shopping list for every target together, four tiles, no empty column */
  S['b630: Q4 page — one shopping list takes every priority bundle to its target, a shared part bought once; tiles add up']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const L=q=>[{id:'l'+q,date:'2026-09-20',qty:q,rem:q,cost:1,arr:1}];
    const comps=[{id:'q6-tea',name:'CHECK Earl Grey',layers:L(100)},{id:'q6-mug',name:'CHECK Mug',layers:L(1000)},{id:'q6-coc',name:'CHECK Cocoa',layers:L(0)}];
    const B=(id,name,rec)=>({id,asin:'B0Q6'+id.slice(3).toUpperCase(),name,type:'bundle',recipe:rec.map(([c,q])=>({c,q})),layers:[]});
    const prods=[B('q6-tb','CHECK Tea Hamper',[['q6-tea',2],['q6-mug',1]]),B('q6-gf','CHECK GF Tea Gift',[['q6-tea',1],['q6-mug',1]]),B('q6-hc','CHECK Hot Choc Hamper',[['q6-coc',1],['q6-mug',1]])];
    const R=LV3.q4Calc({products:prods,components:comps,purchases:[],shipments:[],owed:{},over:0,targets:{'q6-tb':100,'q6-gf':50,'q6-hc':30},
      protDays:p=>({'q6-tb':1,'q6-gf':2,'q6-hc':3})[p.id],today:'2026-10-07'});
    const buy=R.shopAll.buy.map(x=>[x.id,x.qty]);
    eq(JSON.stringify(buy),JSON.stringify([['q6-tea',150],['q6-coc',30]]),'the two tea hampers need 200 + 50 = 250 Earl Grey, 100 here → buy 150 once; and 30 cocoa');
    ok(R.shopAll.ok&&R.shopAll.lines===3,'it gets all three there');
    const cs2=comps.map(c=>c.id==='q6-tea'?Object.assign({},c,{layers:L(250)}):c.id==='q6-coc'?Object.assign({},c,{layers:L(30)}):c);
    const R2=LV3.q4Calc({products:prods,components:cs2,purchases:[],shipments:[],owed:{},over:0,targets:{'q6-tb':100,'q6-gf':50,'q6-hc':30},
      protDays:p=>({'q6-tb':1,'q6-gf':2,'q6-hc':3})[p.id],today:'2026-10-07'});
    ok(R2.bundles.every(r=>r.done+r.left>=r.target)&&R2.shopAll.buy.length===0,'…and buying exactly that covers every target, nothing more to buy');
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('q4');await wait(200);
      const pg=document.getElementById('page-lavarion'),live=LV3.q4Calc();
      {const nP=live.bundles.some(r=>r.priority&&r.target);eq(pg.querySelectorAll('.q4Kpis .kpi').length,nP?6:5,nP?'six tiles — the fifth (b637) says when every target is done, Hours of prep left (b655) joined':'five tiles — the fifth says when every target is done (b637)');}
      const on=live.bundles.concat(live.singles).some(r=>r.left-r.arrived>0);
      eq([...pg.querySelectorAll('table.q4P thead th')].some(th=>/When orders land/.test(th.textContent)),on,'"When orders land" only when something is on order');
      eq(!!pg.querySelector('.q4Buy'),!!(live.shopAll&&live.shopAll.buy.length),'the shopping list shows when something is short');
      ok(!/undefined|NaN/.test(pg.querySelector('.q4').textContent),'no undefined or NaN on the page');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 120 · b631: a day SellerFuse saw a sale on is never an empty day (Autosol Kit, 30 Oct) */
  S['b631: a product still selling is not empty — an open stock-out record starts after the last sale']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),p=D.products.find(x=>!x.archived&&x.asin&&x.type==='bundle');ok(p,'a bundle to test with');if(!p)return;
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    const ago=k=>{const x=new Date();x.setDate(x.getDate()-k);return isoDay(x);};
    const keep={so:JSON.stringify(D.settings.stockOuts||[]),sf:JSON.stringify((D.settings.sfSold||{})[p.asin]||null),ls:(D.settings.sfLastSold||{})[p.asin]};
    try{
      D.settings.sfSold=D.settings.sfSold||{};D.settings.sfLastSold=D.settings.sfLastSold||{};
      D.settings.sfSold[p.asin]={u30:16,u14:12,u7:8,at:new Date().toISOString()};
      D.settings.stockOuts=[{id:'chk631',asin:p.asin,kind:'out',from:ago(4),to:null,pace:1,pu:2,src:'counts'}];
      delete D.settings.sfLastSold[p.asin];
      eq(LV3.sfPace(p).empty[7],5,'no sale since: empty 4 days ago to today = 5 days');
      D.settings.sfLastSold[p.asin]=ago(0);
      let pc=LV3.sfPace(p);eq(pc.empty[7],0,'it sold today: none of those days was empty');
      ok(Math.abs(pc.p7-8/7)<1e-9,'so 8 in 7 days = 1.1 a day, not 8 ÷ 2 = 4 a day');
      D.settings.sfLastSold[p.asin]=ago(2);eq(LV3.sfPace(p).empty[7],2,'last sale 2 days ago: only the 2 days since count');
      D.settings.sfLastSold[p.asin]=ago(6);eq(LV3.sfPace(p).empty[7],5,'a sale before the record opened changes nothing');
    }finally{D.settings.stockOuts=JSON.parse(keep.so);const f=JSON.parse(keep.sf);if(f)D.settings.sfSold[p.asin]=f;else delete D.settings.sfSold[p.asin];
      if(keep.ls)D.settings.sfLastSold[p.asin]=keep.ls;else delete D.settings.sfLastSold[p.asin];}
  };

  /* 121 · b632: a delivery that lands before the send sells too (Dog Treat, 31 Oct) */
  S['b632: what is there when a send lands — a delivery landing first sells too, never counted whole']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    const on=k=>{const x=new Date();x.setDate(x.getDate()+k);return isoDay(x);},t=on(0),near=(a,b)=>Math.abs(a-b)<1e-6;
    ok(near(LV3.stockAt(null,1.6,4,[{q:37,eta:on(10)}],t,13),37-3*1.6),'Dog Treat: 4 gone by day 3, 37 land day 10, 3 days of sales off them by day 13 = 32.2, not 37');
    ok(near(LV3.stockAt(null,1,20,[{q:10,eta:on(5)}],t,10),20),'still stocked when it lands: 20 − 10 + 10, as before');
    ok(near(LV3.stockAt(null,2,5,[],t,10),0)&&near(LV3.stockAt(null,2,30,[],t,10),10),'nothing landing: max(0, stock − sales), as before');
    ok(near(LV3.stockAt(null,1,0,[{q:5,eta:on(2)},{q:20,eta:on(8)}],t,10),20-2),'two deliveries: the 5 run out before the 20 land, the 20 sell 2 days');
    ok(near(LV3.stockAt(null,1,10,[{q:50,eta:on(20)}],t,10),0),'a delivery after the send lands does not count');
    ok(near(LV3.stockAt(null,1,3,[{q:7,eta:on(-4)}],t,5),5),'a delivery already due counts from today');
    const az=((LV3.__plData()||{}).az||{}).rows||[];
    ok(!az.some(r=>r.projAtLand!=null&&!(r.projAtLand>=0)),'no planner row has a negative or broken position');
  };

  /* 122 · b633: click a Q4 line for the days and weeks it went up */
  S['b633: Q4 — clicking a line opens its sends by week and by day, the bar adding up to what the page says']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'',pref=localStorage.getItem('lv3.q4.progress');
    try{
      goPage('lavarion');LV3.go('q4');await wait(250);
      const rows=[...document.querySelectorAll('#page-lavarion .q4T tr[data-q4r]')];
      ok(rows.length>0,'Q4 lines open');
      const R=LV3.q4Calc(),all=R.bundles.concat(R.singles);
      const r=all.filter(x=>x.done>0).sort((a,b)=>b.done-a.done)[0]||all[0];ok(r,'a line to open');if(!r)return;
      const tr=document.querySelector(`#page-lavarion .q4T tr[data-q4r="${r.id}"]`);ok(tr,'its row is on the page');
      const dw=document.querySelector(`#page-lavarion tr[data-q4d="${r.id}"] .q4DW`);ok(dw,'its dropdown has Days & weeks (b636)');
      dw.click();await wait(80);
      const M=document.getElementById('lav3Mod2');
      ok(document.getElementById('lav3Ov2').classList.contains('on')&&M.classList.contains('q4HMod'),'the window opens');
      ok(M.textContent.includes(r.name),'it is that line');
      LV3.q4History(r.id,'weeks');await wait(40);
      const wk=[...M.querySelectorAll('.q4HT tbody tr')];ok(wk.length>0,'weeks are listed');
      const sumW=wk.reduce((t,x)=>t+(parseInt(x.children[1].textContent.replace(/[^\d]/g,''))||0),0);
      eq(sumW,r.done,'the weeks add up to what the page says was sent');
      ok(/so far/.test(wk[0].textContent),'newest first — this week, so far, on top');
      eq(parseInt((wk[0].children[4].querySelector('small')||{textContent:''}).textContent.replace(/[^\d]/g,''))||0,r.done,'the newest row ends on the full total');
      LV3.q4History(r.id,'days');await wait(40);
      const dy=[...M.querySelectorAll('.q4HT tbody tr')];
      const sumD=dy.reduce((t,x)=>t+(parseInt(x.children[1].textContent.replace(/[^\d]/g,''))||0),0);
      eq(sumD,r.done,'the days add up too');
      ok(dy.every(x=>x.children[1].textContent.trim()!=='—'),'days lists only days something went out');
      if(dy.length)ok(/·/.test(dy[0].querySelector('td').textContent),'a day names its shipment');
      ok(!/undefined|NaN/.test(M.innerHTML),'no undefined or NaN');
      LV3.cm('lav3Ov2');
    }finally{try{if(pref==null)localStorage.removeItem('lv3.q4.progress');else localStorage.setItem('lv3.q4.progress',pref);}catch(e){}
      try{LV3.cm('lav3Ov2');}catch(e){}try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 123 · b634: Reindeer Food's Q4 target is 1,000 (Jack, 31 Oct) — by name or by ASIN */
  S['b634: Q4 plan — Reindeer Food 1,000, found by its name or its ASIN']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    eq(LV3.q4PlanFill([{id:'r',name:'Reindeer Food',type:'bundle'}]).r,1000,'by name');
    eq(LV3.q4PlanFill([{id:'r',name:'Magic Reindeer Food',asin:'B0HLB9BRMR',type:'bundle'}]).r,1000,'renamed: by its ASIN');
    eq(LV3.q4PlanFill([{id:'r',name:'Reindeer Food',type:'bundle',archived:true}]).r,undefined,'never an archived one');
    const D=LV3.__D(),p=D.products.find(x=>!x.archived&&String(x.asin||'').toUpperCase()==='B0HLB9BRMR');
    if(p&&!(D.settings.q4Targets&&typeof D.settings.q4Targets==='object')){
      const r=LV3.q4Calc().bundles.find(x=>x.id===String(p.id));
      ok(r&&r.priority&&r.target===1000,'on the page it is a priority bundle with a target of 1,000');}
  };

  /* 124 · b635: empty before a send could land is never "inside the buffer" (Always Size 2, 1 Nov) */
  S['b635: a line that is empty, or empties, before a send could land is losing — never "lands inside the buffer"']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),p=D.products.find(x=>!x.archived&&x.asin);ok(p,'a product to test with');if(!p)return;
    const isoDay=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    const on=k=>{const x=new Date();x.setDate(x.getDate()+k);return isoDay(x);};
    const base={p,ads:2.8,sell:0,inb:4,tranches:[{q:4,eta:on(11)}],landIso:on(12),saf:14};
    let u=LV3.sendUrgency(base);
    ok(u.losing&&!u.buffer,'0 at Amazon, 4 landing the day before a send could: losing, not the buffer');
    eq(Math.round(u.gap),11,'11 empty days before those 4 land');eq(u.firstEmpty,0,'empty from today');
    u=LV3.sendUrgency(Object.assign({},base,{sell:30,inb:0,tranches:[]}));
    ok(u.losing&&Math.round(u.gap)===1,'runs out on day 10.7, a send lands day 12: losing, 1 day short');
    u=LV3.sendUrgency(Object.assign({},base,{sell:50,inb:0,tranches:[]}));
    ok(!u.losing&&u.buffer&&u.gap===0,'stocked until after a send lands: that IS the buffer');
    u=LV3.sendUrgency(Object.assign({},base,{sell:5,inb:200,tranches:[{q:200,eta:on(5)}]}));
    ok(!u.losing&&u.gap>0&&!u.buffer,'empty a few days, then covered for weeks: not urgent, and never called the buffer');
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{goPage('lavarion');LV3.go('overview');await wait(300);
      const bad=[...document.querySelectorAll('#page-lavarion .acxS')].filter(c=>{const ch=(c.querySelector('.acxChip')||{}).textContent||'';
        const amz=[...c.querySelectorAll('.sCell')].find(x=>/at amazon/i.test((x.querySelector('i')||{}).textContent||''));
        return /BUFFER/.test(ch)&&amz&&(amz.querySelector('b')||{}).textContent.trim()==='0';});
      eq(bad.length,0,'no card with 0 at Amazon talks about the buffer');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 125 · b636: Q4 dropdowns, Left to do, By <last send day>, the chart, Complete column, copyable ASINs */
  S['b636: Q4 — lines open and close, Left to do = target − sent, on track for the last send day, the Complete chart']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'';let keepOpen=null,keepProg=null;
    try{keepOpen=localStorage.getItem('lv3.q4.open');keepProg=localStorage.getItem('lv3.q4.progress');}catch(e){}
    const keepBy=D.settings.q4SendBy;
    try{
      delete D.settings.q4SendBy;eq(LV3.q4SendBy(),'2026-12-10','the last send day is 10 Dec until it is changed (Jack, 1 Nov)');
      /* the pace on made-up sends: 140 in the last 14 days = 70 a week = 14 a working day (10 of them); 29 working days to 10 Dec */
      const R0={sends:[{id:'a',date:'2026-10-25',units:140},{id:'a',date:'2026-10-01',units:999},{id:'b',date:'2026-10-30',units:20}]};
      const tr=LV3.q4Track(R0,'2026-11-01');
      eq(tr.days,39,'1 Nov to 10 Dec = 39 days');eq(tr.wdLeft,29,'…29 of them Mon–Fri working days (b638)');eq(tr.paceWdOf('a'),14,'140 over 10 working days = 14 a working day');eq(tr.paceOf('a'),70,'140 in the last 14 days = 70 a week (1 Oct is too old)');eq(tr.paceOf(null),80,'the whole page: 160 = 80 a week');
      eq(tr.line({id:'a',target:1000,done:500,left:600}).state,'behind','500 left at 14 a working day (406 by 10 Dec): behind');
      eq(tr.line({id:'a',target:1000,done:500,left:600}).eta,'2026-12-21','…and all sent by ~21 Dec: 36 working days at 14 (b637/b638)');
      eq(tr.line({id:'zz',target:100,done:0,left:50}).eta,null,'nothing sent in 2 weeks: no finish date');
      eq(tr.line({id:'a',target:1000,done:700,left:600}).state,'ok','300 left, 406 at this pace, parts for 600: on track');
      eq(tr.line({id:'a',target:1000,done:700,left:100}).state,'parts','on pace, but the parts only make 800: needs parts');
      eq(tr.line({id:'a',target:1000,done:1000,left:50}).state,'done','target hit');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),P=R.bundles.filter(r=>r.priority);
      P.forEach(r=>{const c=pg.querySelector(`tr[data-q4r="${r.id}"] td.q4Lft`);
        ok(c&&(c.textContent.trim()===(r.target-r.done>0?String(r.target-r.done).replace(/\B(?=(\d{3})+(?!\d))/g,','):'✓')),r.name+': Left to do = target − sent');});
      ok([...pg.querySelectorAll('table.q4P thead th')].some(th=>/This week/.test(th.textContent)),'a This week column (b643: was Finish date)');
      ok(P.every(r=>/ of \d|Target hit/.test((pg.querySelector(`tr[data-q4r="${r.id}"] td.q4TW`)||{}).textContent||'')),'every target shows this week: sent of its share');
      const r=P[0]||R.bundles[0];if(r){
        const row=pg.querySelector(`tr[data-q4r="${r.id}"]`),drop=pg.querySelector(`tr[data-q4d="${r.id}"]`);
        const was0=row.classList.contains('open');row.click();await wait(30);
        eq(row.classList.contains('open'),!was0,'a click opens it (or closes it)');eq(drop.classList.contains('open'),!was0,'…and its dropdown with it');
        ok(drop.querySelector('.q4Wk')&&drop.querySelector('.q4DW'),'inside: its weeks and Days & weeks');
        row.click();await wait(30);eq(row.classList.contains('open'),was0,'a second click puts it back');
        const all=pg.querySelector('.q4PriPanel .q4AllBtn');if(all){all.click();await wait(30);
          ok([...pg.querySelectorAll('.q4PriPanel tr[data-q4r]')].every(t=>t.classList.contains('open')),'Open all opens every target');
          all.click();await wait(30);ok([...pg.querySelectorAll('.q4PriPanel tr[data-q4r]')].every(t=>!t.classList.contains('open')),'Close all closes them');}
        const chip=row.querySelector('.q4Asin');ok(chip&&/B0/.test(chip.textContent),'the ASIN is a copy button');
        const o=row.classList.contains('open');chip.click();await wait(30);eq(row.classList.contains('open'),o,'copying the ASIN does not open the line');}
      ok(pg.querySelector('.q4Prog .q4Chart svg polyline.ln'),'Progress ▾ opens with the Complete chart');
      ok(!/NaN|undefined|Infinity/.test(pg.querySelector('.q4Prog').innerHTML),'no NaN in the chart or tables');
      const wk=pg.querySelector('.q4GW-weeks tbody tr td.q4Cmp small.q4CTot');   /* b670: the running total is the small one */
      eq((wk||{}).textContent,(R.totals.pct==null?'':R.totals.pct+'% total'),'the newest week ends on the Complete tile');
      ok([...pg.querySelectorAll('.q4Kpis .kpi .k')].some(k=>/All done at your weekly average/.test(k.textContent)),'an All done at your weekly average tile (b644)');
      {const TR1=LV3.q4Track(R),tp=TR1.avg.avg,e=R.totals.toGo===0?null:tp>0?TR1.etaOf(R.totals.toGo,tp/5):null;
        const tv=([...pg.querySelectorAll('.q4Kpis .kpi')].find(k=>/All done at your weekly average/.test(k.textContent))||{}).querySelector('.v');
        if(e)ok(tv&&tv.textContent.trim()==='~'+LV3.q4DayY(e),'the tile is the whole page at the weekly average ('+tp+'): '+e);}
    }finally{if(keepBy===undefined)delete D.settings.q4SendBy;else D.settings.q4SendBy=keepBy;
      try{if(keepOpen==null)localStorage.removeItem('lv3.q4.open');else localStorage.setItem('lv3.q4.open',keepOpen);
        if(keepProg==null)localStorage.removeItem('lv3.q4.progress');else localStorage.setItem('lv3.q4.progress',keepProg);}catch(e){}
      try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 126 · b638: Q4 so far — days out of stock since 1 Oct per line, and Sold on Amazon when SellerFuse carries it */
  S['b638: Q4 so far — days out of stock since 1 Oct per line, sales missed, and Sold on Amazon once SellerFuse carries it']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'',keepQ=D.settings.sfQ4;
    try{
      delete D.settings.sfQ4;goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc();
      const box=pg.querySelector('details.q4Rec');ok(box,'a Q4 so far panel');if(!box)return;
      ok(![...box.querySelectorAll('thead th')].some(th=>/Sold on Amazon/.test(th.textContent)),'no Sold column until SellerFuse carries it');
      const days=Math.round((new Date(LV3.dayISO?LV3.dayISO():new Date().toISOString().slice(0,10))-new Date(R.from))/864e5)+1;
      const rows=[...box.querySelectorAll('tbody tr')];eq(rows.length,R.bundles.concat(R.singles).filter(r=>!r.archived).length,'one row per line on the page');
      R.bundles.concat(R.singles).filter(r=>!r.archived).slice(0,4).forEach(r=>{const p=D.products.find(x=>String(x.id)===r.id),want=LV3.emptyDaysIn(p,days);
        const tr=rows.find(t=>t.querySelector('td.q4N b').textContent===r.name);
        ok(tr&&tr.querySelector('td.q4Od').textContent.trim().startsWith(want?String(want):'—'),r.name+': days out of stock = the stock-out records ('+want+')');});
      const r0=R.bundles[0],p0=D.products.find(x=>String(x.id)===r0.id);
      D.settings.sfQ4={at:new Date().toISOString(),from:R.from,to:null,by:{[String(p0.asin).toUpperCase()]:123}};
      LV3.go('q4');await wait(200);
      const box2=pg.querySelector('details.q4Rec');
      ok([...box2.querySelectorAll('thead th')].some(th=>/Sold on Amazon/.test(th.textContent)),'a Sold on Amazon column once it comes');
      ok(/123/.test([...box2.querySelectorAll('tbody tr')].find(t=>t.querySelector('td.q4N b').textContent===r0.name).textContent),'…with SellerFuse\'s figure on its line');
      ok(!/NaN|undefined/.test(box2.innerHTML),'no NaN');
      ok(/a week/.test(([...pg.querySelectorAll('.q4Kpis .kpi')].find(k=>/All done at your weekly average/.test(k.textContent))||{}).textContent||''),'the tile counts weeks (b643: was working days)');
      {const all=[...pg.querySelectorAll('.q4 > *')],iRec=all.indexOf(box2),iPri=all.findIndex(e=>e.classList&&e.classList.contains('q4PriPanel'));
        ok(iRec>iPri&&iRec===all.length-1,'the record is the last thing on the page — under the build tables (prep hub first)');}
    }finally{if(keepQ===undefined)delete D.settings.sfQ4;else D.settings.sfQ4=keepQ;
      try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 127 · b639: one supplier spelt two ways is one supplier (Mini Cheddars, 1 Nov) */
  S['b639: a supplier spelt two ways ("LovePubSnacks" / "Love Pub Snacks") is one supplier, in its usual spelling']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const f=LV3.compSupplierOf||null;ok(f,'compSupplier is reachable');if(!f)return;
    eq(f({layers:[{sup:'LovePubSnacks'},{sup:'Love Pub Snacks'},{sup:'Tesco'}]}),'Love Pub Snacks','one each of three: the two spellings count together, the spaced one shown');
    eq(f({layers:[{sup:'CutPriceWholesaler'},{sup:'CutPriceWholesaler'},{sup:'Cut Price Wholesaler'}]}),'CutPriceWholesaler','the most used spelling is the one shown');
    eq(f({layers:[{sup:'Tesco'},{sup:'Tesco'},{sup:'LovePubSnacks'}]}),'Tesco','a different supplier with more lines still wins');
    eq(f({supplier:'Pure Gusto',layers:[{sup:'Tesco'}]}),'Pure Gusto','a supplier set on the part always wins');
    const D=LV3.__D(),c=D.components.find(x=>/Mini Cheddars/i.test(x.name)&&!x.supplier);
    if(c)ok(/^Love ?Pub ?Snacks$/i.test(f(c)),'Mini Cheddars goes on the Love Pub Snacks order (either spelling — whichever the lines use most)');
  };

  /* 128 · b640: Progress tables — units per line as shaded cells, quiet runs folded, the sums still add up */
  S['b640: Progress ▾ — each line\'s units per day/week, blank when none, quiet days folded, rows add up to Sent']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc();
      ['days','weeks'].forEach(m=>{const t=pg.querySelector('.q4GW-'+m+' table.q4G');ok(t,m+' table');if(!t)return;
        ok(![...t.querySelectorAll('tbody td.q4H0, tbody td.q4H')].some(td=>/—/.test(td.textContent)),m+': no dashes in the line cells');
        ok([...t.querySelectorAll('tbody td.q4H0')].every(td=>['0','✕','✓'].includes(td.textContent.trim())),m+': a line that sent nothing says 0, ✕ or ✓ (b650)');
        [...t.querySelectorAll('tbody tr:not(.q4Gap):not(.q4WkD)')].forEach(tr=>{const sent=parseInt(tr.querySelector('td.q4Snt b').textContent.replace(/[^\d]/g,''))||0;
          const parts=[...tr.querySelectorAll('td.q4H b')].reduce((a,b)=>a+(parseInt(b.textContent.replace(/[^\d]/g,''))||0),0);
          eq(parts,sent,m+' '+tr.querySelector('td b').textContent+': the line cells add up to Sent');});
        const quiet=(R.progress[m]||[]).filter(r=>!r.units).length,gaps=t.querySelectorAll('tbody tr.q4Gap').length;
        ok(quiet===0?gaps===0:gaps>0&&gaps<=quiet,m+': days with nothing sent are folded ('+quiet+' → '+gaps+' line'+(gaps===1?'':'s')+')');});
      ok(!/undefined|NaN/.test(pg.querySelector('.q4Prog').innerHTML),'no NaN');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 129 · b642: Progress ▾ open by default, a frozen Q4-so-far row, the chart key and hover, finish dates in plain words */
  S['b642: Progress ▾ open until closed, a frozen Q4-so-far row that adds up, the chart key + hover, plain Finish date wording']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';let keep=null;try{keep=localStorage.getItem('lv3.q4.progress');}catch(e){}
    try{
      localStorage.removeItem('lv3.q4.progress');eq(LV3.q4ProgPref().open,true,'Progress ▾ is open until someone closes it');
      localStorage.setItem('lv3.q4.progress',JSON.stringify({open:false,mode:'days'}));
      eq(JSON.stringify(LV3.q4ProgPref()),JSON.stringify({open:true,mode:'days'}),'an old saved "open: false" no longer keeps it shut (the mode is kept)');
      LV3.q4SetOpen(false,'prog');eq(LV3.q4ProgPref().open,false,'closing it is remembered on this browser');
      LV3.q4SetOpen('weeks','progMode');eq(LV3.q4ProgPref().open,false,'…and Days / Weeks leaves it closed');
      LV3.q4SetOpen(true,'prog');eq(LV3.q4ProgPref().open,true,'opening it again is remembered too');
      localStorage.removeItem('lv3.q4.progress');
      eq(LV3.q4DayY('2027-08-13','2026-11-02'),'13 Aug 2027','a finish date next year carries the year');
      eq(LV3.q4DayY('2026-11-25','2026-11-02'),'25 Nov','one this year does not');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),T=R.totals,num=e=>parseInt(((e||{}).textContent||'').replace(/[^\d]/g,''))||0;
      const box=pg.querySelector('details.q4Prog:not(.q4Rec)');ok(box&&box.open,'it draws open');
      ['days','weeks'].forEach(m=>{const t=pg.querySelector('.q4GW-'+m+' table.q4G');if(!t)return;
        const tot=t.querySelector('thead tr.q4Tot');ok(tot,m+': a Q4 so far row under the heads');if(!tot)return;
        eq(getComputedStyle(tot.querySelector('th')).position,'sticky',m+': it stays put as the table scrolls');
        eq(num(tot.querySelector('th.q4Snt b')),T.done,m+': its Sent is everything sent since the start ('+T.done+')');
        const cells=[...tot.querySelectorAll('th.q4H b')];eq(cells.reduce((a,b)=>a+num(b),0),T.done,m+': its lines add up to it');
        R.progress.pri.forEach((p,i)=>{const r=R.bundles.find(x=>x.id===p.id);eq(num(cells[i]),r.done,m+': '+p.name+' = its Sent in Priority bundles');});
        eq(t.querySelectorAll('tbody .q4Hb').length?getComputedStyle(t.querySelector('tbody .q4Hb')).overflow:'visible','visible',m+': the bars do not clip (Safari painted them over the frozen heads)');});
      const ch=box.querySelector('.q4Chart');ok(ch&&ch.querySelectorAll('.q4ChartK .k').length>=2,'the chart figures sit in a key above the plot');
      ok(!ch.querySelector('svg text.vl.n')&&![...ch.querySelectorAll('svg text')].some(t=>/working day/.test(t.textContent)),'nothing written across the plot');
      const now=[...ch.querySelectorAll('svg text.vl')].find(t=>/now$/.test(t.textContent));
      if(now&&now.getBBox().width){const a=now.getBBox();
        ok(![...ch.querySelectorAll('svg text.vl.sm')].some(t=>{const b=t.getBBox();return b.x<a.x+a.width&&a.x<b.x+b.width&&b.y<a.y+a.height&&a.y<b.y+b.height;}),'"now" sits on no week label');}
      const M=JSON.parse(ch.getAttribute('data-q4c')),hit=ch.querySelector('svg rect.hit'),hr=hit.getBoundingClientRect(),tip=ch.querySelector('.q4Tip');
      const at=d=>{const i=M.s.findIndex(s=>s[0]===d);hit.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:hr.left+hr.width*i/M.span+0.2,clientY:hr.top+hr.height/2}));};
      if(hr.width){at(M.today);ok(!tip.hidden&&tip.textContent.includes('today')&&tip.textContent.includes(Math.floor(100*T.done/T.max)+'%'),'hover today: '+tip.textContent);
        if(M.by>M.today&&T.toGo>0){at(M.by);ok(/Needed by then 100%/.test(tip.textContent),'hover the last send day: needed 100% — '+tip.textContent);}
        hit.dispatchEvent(new MouseEvent('mouseleave'));ok(tip.hidden,'the figures go when the pointer leaves');}
      const cells=[...pg.querySelectorAll('table.q4P td.q4TW, table.q4P td.q4W')];ok(cells.length>0,'This week and Parts cover cells');
      ok(!cells.some(td=>/% cap|parts short|\/day|short \d/.test(td.textContent)),'no "+5% cap", "parts short", "/day" or "short 602" left');
    }finally{try{if(keep==null)localStorage.removeItem('lv3.q4.progress');else localStorage.setItem('lv3.q4.progress',keep);}catch(e){}
      try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 130 · b643: weeks, not days — each target's share this week, last week, the team's pace, the This week panel */
  S['b643: Q4 in weeks — this week\'s share of what is left, last week, the team\'s pace, the This week panel, the parts limit']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'',keepBy=D.settings.q4SendBy;
    try{
      delete D.settings.q4SendBy;
      /* made-up sends on Wed 4 Nov: this week Mon 2 – Sun 8 Nov; 29 working days 2 Nov – 10 Dec, 5 of them this week */
      const R0={totals:{max:1000,done:540},sends:[{id:'a',date:'2026-10-20',units:40},{id:'a',date:'2026-10-27',units:300},{id:'a',date:'2026-11-03',units:200}]};
      const tr=LV3.q4Track(R0,'2026-11-04');
      eq(JSON.stringify([tr.wkStart,tr.wkEnd,tr.wkFri,tr.wdFromMon,tr.wdThisWk]),JSON.stringify(['2026-11-02','2026-11-08','2026-11-06',29,5]),'this week is Mon 2 – Sun 8 Nov: 29 working days to 10 Dec, 5 of them this week');
      const w=tr.week({id:'a',target:1000,done:540});
      eq(JSON.stringify([w.sent,w.before,w.leftMon,w.need,w.toGo,w.last,w.prev]),JSON.stringify([200,340,660,114,0,300,40]),'660 left on Monday × 5 ÷ 29 = 114 this week — 200 went, so done; 300 last week, 40 the week before');
      eq(w.perWk,114,'a full week needs the same');
      eq(LV3.q4Track(R0,'2026-11-09').week({id:'a',target:1000,done:540}).need,96,'next Monday: 460 left over 24 working days = 96 — the batch lowered next week\'s share');
      eq(tr.week(null).last,300,'the whole page: last week 300');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),T=R.totals,TR=LV3.q4Track(R),P=R.bundles.filter(r=>r.priority);
      const box=pg.querySelector('section.q4Week');ok(box,'a This week panel at the top');
      if(box&&P.length){const cards=[...box.querySelectorAll('.q4WC')];eq(cards.length,P.length,'a card per target');
        const open=cards.filter(c=>!c.classList.contains('done')&&!c.classList.contains('noParts')).map(c=>parseInt(((c.querySelector('.v b')||{}).textContent||'').replace(/[^\d]/g,''))||0);
        ok(open.every((v,i,a)=>i===0||a[i-1]>=v),'biggest job first: '+open.join(', '));
        const order=cards.map(c=>c.classList.contains('done')?2:c.classList.contains('noParts')?1:0);ok(order.every((v,i,a)=>i===0||a[i-1]<=v),'lines with no parts, then done ones, at the end');}
      P.forEach(r=>{const w=TR.week(r),c=pg.querySelector(`tr[data-q4r="${r.id}"] td.q4TW b`);
        if(r.target>r.done)ok(c&&c.textContent.replace(/\s+/g,' ').trim()===`${w.sent} of ${w.need}`.replace(/\B(?=(\d{3})+(?!\d))/g,','),r.name+': this week '+w.sent+' of '+w.need);});
      ok(!/a working day|\/day| a day\b/.test(pg.querySelector('table.q4P').textContent),'no per-day figures left in Priority bundles');
      ok([...pg.querySelectorAll('.q4Kpis .kpi .k')].some(k=>/weekly average/.test(k.textContent)),'the finish tile runs on the weekly average (b644)');
      const ch=pg.querySelector('.q4Prog .q4Chart');ok(ch&&/weekly average/.test(ch.querySelector('.q4ChartK').textContent),'the chart key says the weekly average (b644)');
      const ceil=100*R.bundles.concat(R.singles).reduce((t,r)=>t+Math.min(r.max,r.done+r.left),0)/T.max;
      if(ceil<100&&ch)ok(!ch.querySelector('svg line.cl')&&!/parts in hand/i.test(ch.textContent),'the chart has no parts in hand line (b651: '+Math.floor(ceil)+'% — parts are bought as needed)');
    }finally{if(keepBy===undefined)delete D.settings.q4SendBy;else D.settings.q4SendBy=keepBy;
      try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 131 · b644: the weekly average — recent weeks count most, the slow start and a one-off quiet week left out; parts are information */
  S['b644: Q4 weekly average — recent weeks count most, slow start and a one-off quiet week left out; parts shown as information']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      /* made-up weeks: a part week (1–4 Oct) 264, 5 Oct 0, 12 Oct 199, 19 Oct 619, 26 Oct 942 */
      const base=[{id:'a',date:'2026-10-02',units:264},{id:'a',date:'2026-10-13',units:199},{id:'a',date:'2026-10-20',units:619},{id:'a',date:'2026-10-27',units:942}];
      const mk=extra=>({from:'2026-10-01',totals:{max:9000,done:0},sends:base.concat(extra||[])});
      const a1=LV3.q4Track(mk(),'2026-11-02').avg;
      eq(JSON.stringify([a1.avg,a1.lead.map(w=>w.start),a1.dropped]),JSON.stringify([809,['2026-10-05','2026-10-12'],null]),'2 Nov: (942 + 619 × 0.7) ÷ 1.7 = 809 — the slow start (5 and 12 Oct) and the part week left out');
      const a2=LV3.q4Track(mk(),'2026-11-09').avg;
      eq(JSON.stringify([a2.avg,(a2.dropped||{}).start]),JSON.stringify([809,'2026-11-02']),'a week of nothing after them is a one-off — left out, still 809');
      eq(LV3.q4Track(mk(),'2026-11-16').avg.avg,368,'two weeks of nothing running is a real slowdown — it counts (368)');
      eq(LV3.q4Track(mk([{id:'a',date:'2026-11-04',units:700}]),'2026-11-09').avg.avg,759,'a 700 week after: (700 + 942 × 0.7 + 619 × 0.49) ÷ 2.19 = 759');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),TR=LV3.q4Track(R);
      const box=pg.querySelector('section.q4Week');ok(box,'the This week panel');if(!box)return;
      eq(box.querySelectorAll('.q4WkPage .q4WkC').length,(R.progress.weeks||[]).length,'a bar for every week since the start');
      if(TR.avg.avg>0)ok(box.querySelector('.q4WeekWhy').textContent.includes('~'+String(TR.avg.avg).replace(/\B(?=(\d{3})+(?!\d))/g,',')),'the panel gives the weekly average (~'+TR.avg.avg+')');
      ok(!box.querySelector('.q4WC .kv.parts.bad, .q4WC .kv.parts.w, .q4WC .kv.parts b.bad'),'no red or amber parts notes on the cards');
      ok(!pg.querySelector('table.q4P td.q4TW small.bad, table.q4P td.q4TW small.w'),'none in This week either');
      ok(![...pg.querySelectorAll('.q4Kpis .kpi .v')].some(v=>/fca5a5|f87171/.test(v.getAttribute('style')||'')),'no tile value in red');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 132 · b645: how long the stock at Amazon lasts, on each This week card — the order stays biggest job first */
  S['b645: Q4 This week cards — how long the stock at Amazon lasts; order stays biggest job first']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),TR=LV3.q4Track(R),AZ=LV3.__plData().azBy||{};
      const box=pg.querySelector('section.q4Week');ok(box,'the This week panel');if(!box)return;
      const cards=[...box.querySelectorAll('.q4WC')],idOf=c=>(c.getAttribute('onclick').match(/'([^']+)'/)||[])[1];
      cards.forEach(c=>{const id=idOf(c),z=AZ[id],az=c.querySelector('.az'),nm=c.querySelector('.h').textContent;
        if(!z||z.sell==null){ok(!az,nm+': no Amazon line without an Amazon row');return;}
        const u=LV3.sendUrgency(z);
        if(!u){ok(!az||/^\d/.test((az.querySelector('b')||{}).textContent||''),nm+': no sales figure — the count only');return;}
        ok(az,nm+': an At Amazon line');if(!az)return;
        if((+z.sell||0)<=0){ok(az.classList.contains('bad')&&/^Out/.test((az.querySelector('b')||{}).textContent||''),nm+': out at Amazon now — red');return;}
        const fe=u.firstEmpty!=null?Math.round(u.firstEmpty):null,days=Math.round(u.end),shown=fe!=null&&fe<days?fe:days;
        ok(az.textContent.includes('~'+shown+' day'),nm+': ~'+shown+' days ('+az.textContent+')');
        eq(az.classList.contains('bad'),!!u.losing,nm+': red only when a send today lands after it runs out');
        ok(az.title.includes('at Amazon'),nm+': the hover gives the sum');});
      /* the order is the b643 one — the biggest job this week first, Amazon stock never moves a card */
      const toGo=cards.filter(c=>!c.classList.contains('done')&&!c.classList.contains('noParts')).map(c=>TR.week(R.bundles.concat(R.singles).find(r=>r.id===idOf(c))).toGo);
      ok(toGo.every((v,i)=>i===0||v<=toGo[i-1]),'biggest job this week first ('+toGo.join(', ')+')');
      /* made-up rows: 56 at Amazon + 27 on the way at 4 a day lasts 20 days — amber (under 14 + 14) */
      const fake={p:{id:'x'},sell:56,inb:27,ads:4,tranches:[{q:27,d:9}],landIso:null};const fu=LV3.sendUrgency(fake);
      ok(fu&&Math.round(fu.end)===21&&fu.buffer&&!fu.losing,'56 + 27 at 4 a day: ~21 days, inside the cushion, not yet losing');
      ok(!box.querySelector('.q4WC .kv.parts.bad, .q4WC .kv.parts.w, .q4WC .kv.parts b.bad'),'parts notes stay neutral');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 133 · b646: 1% of each target in units; the Days table grouped by week, its blanks a quiet 0 */
  S['b646: Q4 — 1% of each target in units, Days grouped by week, a quiet 0 for the blanks']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      eq(LV3.q4One(1500),'1% = 15','1,500 → 1% = 15');eq(LV3.q4One(400),'1% = 4','400 → 1% = 4');
      eq(LV3.q4One(7145),'1% ≈ 71','7,145 → 1% ≈ 71');eq(LV3.q4One(450),'1% ≈ 4.5','450 → 1% ≈ 4.5');eq(LV3.q4One(0),'','no target, no 1%');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),PG=R.progress,num=e=>parseInt(((e||{}).textContent||'').replace(/[^\d]/g,''))||0;
      const t=pg.querySelector('.q4GW-days table.q4G');ok(t,'the Days table');if(!t)return;
      const heads=[...t.querySelectorAll('thead tr:first-child th.q4Hh')];
      PG.pri.forEach((p,i)=>{const h=heads[i];ok(h&&h.querySelector('.q4One').textContent===LV3.q4One(p.target),p.name+': '+LV3.q4One(p.target)+' under its head');});
      eq(t.querySelector('thead tr:first-child th.n .q4One').textContent,LV3.q4One(R.totals.max),'under Sent, the whole page\'s 1%');
      const pri=[...pg.querySelectorAll('table.q4P tbody tr.q4Row')];
      pri.forEach(tr=>{const tg=num(tr.querySelector('td.q4Tg b'));eq(tr.querySelector('td.q4Tg .q4One').textContent,LV3.q4One(tg),'Priority bundles: '+LV3.q4One(tg)+' under the '+tg+' target');});
      /* weeks: one divider per week that has a day on the page, its total = the Weeks table's */
      const divs=[...t.querySelectorAll('tbody tr.q4WkD')];
      const wks=new Set(PG.days.map(d=>{const x=new Date(d.start+'T00:00:00Z');x.setUTCDate(x.getUTCDate()-((x.getUTCDay()+6)%7));return x.toISOString().slice(0,10);}));
      eq(divs.length,wks.size,'a divider for each week ('+wks.size+')');
      divs.forEach(dv=>{const w=PG.weeks.find(x=>dv.textContent.includes(x.units.toLocaleString('en-GB')+' sent')&&dv.querySelector('.q4WkDd').textContent.startsWith(q4dm(x.from||x.start)));ok(w,'divider "'+dv.textContent.trim().slice(0,40)+'" matches a week');});
      /* a quiet run never crosses a Monday */
      [...t.querySelectorAll('tbody tr')].forEach((tr,i,all)=>{if(!tr.classList.contains('q4WkD'))return;const prev=all[i-1];ok(!prev||!prev.classList.contains('q4WkD'),'no empty week block');});
      const sumDays=[...t.querySelectorAll('tbody tr:not(.q4Gap):not(.q4WkD) td.q4Snt b')].reduce((a,b)=>a+num(b),0);
      eq(sumDays,R.totals.done,'the days still add up to everything sent');
      ok(!/undefined|NaN/.test(t.innerHTML),'no NaN');
      const vt=[...pg.querySelectorAll('.q4GW table.q4G')].find(x=>x.getBoundingClientRect().height>0);   /* the one showing, Days or Weeks */
      if(vt){const hd=vt.querySelector('thead tr:first-child th'),tot=vt.querySelector('thead tr.q4Tot th');
        ok(Math.abs(parseFloat(getComputedStyle(tot).top)-hd.getBoundingClientRect().height)<=1.5,'the frozen Q4 so far row sits right under the heads (no gap)');}
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };
  const q4dm=iso=>{const d=new Date(iso+'T00:00:00Z');return d.getUTCDate()+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];};

  /* 134 · b647: PLUB bundles a flat 50p a unit, outside the volume bands — every month, back-dated */
  S['b647: prep cost — PLUB a flat rate outside the bands, every month; its own line on the bill']=async()=>{
    eq(PREP_FEE_DEFAULTS.plubCostPerUnit,0.5,'the PLUB rate starts at 50p');
    ok(prepFees.plubCostPerUnit!=null&&prepFees.plubCostPerUnit>=0,'and is in the saved rates');
    ok(document.getElementById('pf-plubCostPerUnit'),'Settings → Prep fees has the PLUB rate');
    eq(PREP_STD_LABEL,'Standard units (incl. DG; PLUB and oversize priced separately)','the label');
    /* the live engine: every month's band leaves PLUB out, PLUB is at its flat rate, and it is in the bill */
    const PE=prepEngine();
    PE.months().forEach(ym=>{const b=_peBucket(PE.linesMonth(ym)),M=PE.priceMonth(ym);
      eq(PE.vols[ym],b.std+b.dg,ym+': the band is standard + DG only');
      ok(Math.abs(M.lavCost-b.lav*prepFees.plubCostPerUnit)<1e-6,ym+': '+b.lav+' PLUB at the flat rate');
      ok(Math.abs(M.baseCost-M.tieredUnits*M.unitRate)<1e-6,ym+': the band rate is on standard + DG only');
      ok(Math.abs(M.subtotal-(M.baseCost+M.osCost+M.bundleCost+M.lavCost+M.boxCostTotal))<1e-6,ym+': PLUB is in the bill');
      ok(Math.abs(M.withVat-M.subtotal*prepFees.vatRate)<1e-6,ym+': VAT on the lot');});
    /* October in miniature: 4,446 standard + 2,260 PLUB — the PLUB no longer lifts the band */
    const Ln=(day,units,o)=>Object.assign({day,ym:day.slice(0,7),units,kind:'oa',type:'Standard',bundle:false,shipId:'',cog:0,sku:'',asin:''},o||{});
    const X=prepEngineFrom([Ln('2026-10-10',4446),Ln('2026-10-10',2260,{kind:'lav',type:''})],{fees:prepFees,today:'2026-11-03'}).priceMonth('2026-10');
    eq(X.unitRate,prepFees.tier3p,'4,446 standard → the 3,001–5,000 band (with PLUB in it would have been 5,001+)');
    ok(Math.abs(X.lavCost-2260*prepFees.plubCostPerUnit)<1e-9,'2,260 PLUB at the flat rate');
    ok(Math.abs(X.subtotal-(4446*prepFees.tier3p+2260*prepFees.plubCostPerUnit))<1e-9,'the two add up');
    /* the month-by-month popup: PLUB has its own line; the standard line no longer counts it */
    const ym=PE.months().filter(k=>_peBucket(PE.linesMonth(k)).lav>0).pop();
    if(ym){const keep=_pcmOpen;
      try{openPrepHistory();_pcmOpen=ym;renderInsMonthly(document.getElementById('prepHistBody'));
        const det=document.querySelector('#prepHistBody .pcmDet');ok(det,'a month opens');
        const t=det?det.textContent:'';
        ok(/PLUB bundles/.test(t)&&t.includes(fmtGBP2(PE.priceMonth(ym).lavCost)),ym+': a PLUB bundles line with its cost');
        ok(!/PLUB \d/.test([...det.querySelectorAll('.pcmLine')].find(x=>/Standard units/.test(x.textContent)).textContent),'the standard line no longer counts PLUB');}
      finally{_pcmOpen=keep;const m=document.getElementById('prepHistModal');if(m)m.style.display='none';}}
  };

  /* 135 · b648: the Prep cost popup — split bars, the running month pro-rated, the rate in each row, each shipment's
     prep, and every click does what it looks like it does */
  S['b648: Prep cost popup — split bars, pro-rated month, priced at, shipment prep, every click works']=async()=>{
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{
      openPrepHistory();const B=document.getElementById('prepHistBody'),PE=prepEngine(),vr=prepFees.vatRate;
      const ms=PE.months().filter(k=>PE.linesMonth(k).some(l=>l.kind!=='return')),ym=todayISO().slice(0,7),run=ms.includes(ym);
      eq(_pcmOpen,ms[ms.length-1],'it opens on the newest month');
      /* 8: the first tile */
      const k1=B.querySelector('.pcmKpi');ok(/This month so far/.test(k1.textContent),'the first tile is This month so far');
      if(run){const so=PE.priceMonth(ym).withVat,d=+todayISO().slice(8,10),dim=new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate();
        ok(k1.textContent.includes(fmtGBP2(so)),'…at what this month has cost so far');
        ok(k1.textContent.includes('~£'+Math.round(so*dim/d).toLocaleString('en-GB')),'…and its pace, pro-rated');}
      const fin=ms.filter(k=>k!==ym),avg=fin.reduce((a,k)=>a+PE.priceMonth(k).withVat,0)/fin.length;
      ok([...B.querySelectorAll('.pcmKpi')][2].textContent.includes(fmtGBP2(avg)),'Average a month is the finished months');
      /* 2: the bars — one per month, the pieces add up to the bill */
      const bars=[...B.querySelectorAll('.pcmB')];eq(bars.length,ms.length,'one bar a month');
      bars.forEach(b=>{const k=b.dataset.k,sum=[...b.querySelectorAll('.pcmStk i')].reduce((a,i)=>a+(+i.dataset.v),0);
        ok(Math.abs(sum-PE.priceMonth(k).withVat)<0.05*[...b.querySelectorAll('.pcmStk i')].length+0.01,k+': the pieces add up to the bill inc. VAT');});
      ok([...B.querySelectorAll('.pcmLeg span')].some(s=>/PLUB/.test(s.textContent)),'the legend names PLUB');
      const big=bars.reduce((a,b)=>(+b.querySelector('.pcmStk').style.height.replace('%',''))>(+a.querySelector('.pcmStk').style.height.replace('%',''))?b:a);
      const named=[...big.querySelectorAll('.pcmStk i b')].map(x=>x.textContent);
      ok(named.includes('Stock')&&named.length>=2,'the tallest bar says in its colours what each piece is ('+named.join(', ')+')');
      ok(B.querySelector('.pcmAvgL'),'an average line');
      if(run)ok(B.querySelector(`.pcmB[data-k="${ym}"] .pcmGhost`)||PE.priceMonth(ym).withVat>0,'the running month shows its pace');
      const oct=fin.length?fin[fin.length-1]:ms[0];                         /* the last finished month */
      const bar=B.querySelector(`.pcmB[data-k="${oct}"]`);bar.dispatchEvent(new MouseEvent('mouseenter'));
      const tip=B.querySelector('.pcmTip');ok(tip.style.display==='block'&&tip.textContent.includes(fmtGBP2(PE.priceMonth(oct).withVat)),'hovering a bar shows what made it up');
      bar.dispatchEvent(new MouseEvent('mouseleave'));ok(tip.style.display==='none','and goes away');
      bar.click();eq(_pcmOpen,oct,'clicking a bar opens its month');ok(B.querySelector(`.pcmRow[data-k="${oct}"].open`)&&B.querySelector('.pcmDet'),'…below');
      /* 4: what each month was priced at */
      ms.forEach(k=>{const M=PE.priceMonth(k),at=B.querySelector(`.pcmRow[data-k="${k}"] .pcmAt`).textContent;
        if(M.tieredUnits>0)ok(at.includes(_peP(M.unitRate)),k+': priced at '+_peP(M.unitRate));
        if(M.lavUnits)ok(at.includes(fmt(M.lavUnits)+' PLUB'),k+': its PLUB');});
      /* 3: the running month on pace in the row */
      if(run){const r=B.querySelector(`.pcmRow[data-k="${ym}"]`).textContent;ok(/on pace/.test(r),'the running month says on pace');}
      /* every click: open another month keeps the row where it was; clicking the open month closes it */
      const target=ms.find(k=>k<oct)||ms.find(k=>k!==oct);                     /* an older month, below it */
      const rowT=()=>B.querySelector(`.pcmRow[data-k="${target}"]`);
      rowT().scrollIntoView({block:'center'});const y0=rowT().getBoundingClientRect().top;
      rowT().click();eq(_pcmOpen,target,'a row opens its month');
      ok(Math.abs(rowT().getBoundingClientRect().top-y0)<3,'the row you clicked stays where it was ('+Math.round(y0)+' → '+Math.round(rowT().getBoundingClientRect().top)+')');
      rowT().click();eq(_pcmOpen,null,'clicking the open month closes it — nothing opens in its place');
      ok(!B.querySelector('.pcmDet'),'every month closed');
      /* 6: each shipment's prep, and a shipment opens on the Shipments page with the popup out of the way */
      _pcmOpen=oct;renderInsMonthly(B);
      const sh=[...B.querySelectorAll('.pcmShip')];ok(sh.length,'the month lists its shipments');
      sh.slice(0,6).forEach(s=>{const id=s.querySelector('.pcmSid').firstChild.textContent;
        ok(s.querySelector('.pcmSp').textContent===fmtGBP2(PE.priceShip(id).withVat),id+': its prep inc. VAT');});
      sh[0].click();
      ok(document.getElementById('prepHistModal').style.display==='none','opening a shipment closes the popup');
      eq((document.querySelector('.page.active')||{}).id,'page-shipments','…and goes to the Shipments page');
    }finally{const m=document.getElementById('prepHistModal');if(m)m.style.display='none';
      if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 136 · b649: Jack's timed hours → what he builds in an hour → hours of building left, per priority line and in all */
  S['b649: Q4 — build speed from Jack’s timed hours, Hours left column and total, a timing saves']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'';
    const keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase(),logN=D.log.length;
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
    try{
      const hc=D.products.find(p=>p.name==='Hot Chocolate Gift Hamper'&&!p.archived);
      if(hc&&!D.settings.q4Rates){const r=LV3.q4RateOf(hc.id);ok(r&&r.n===2&&r.avg===22,'Hot Chocolate Gift Hamper starts at 23 and 21 → 22 an hour');}
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),TR=LV3.q4Track(R);
      const tb=pg.querySelector('table.q4P');ok(tb,'the Priority bundles table');if(!tb)return;
      ok([...tb.querySelectorAll('thead th')].some(th=>th.textContent==='Hours left'),'an Hours left column');
      const rows=[...tb.querySelectorAll('tbody tr.q4Row')];
      R.bundles.filter(r=>r.priority).forEach(r=>{
        const tr=rows.find(x=>x.querySelector('td')&&x.querySelector('td').textContent.includes(r.name));if(!tr)return;
        const cell=tr.querySelector('td.q4Hr'),rt=LV3.q4RateOf(r.id),left=TR.line(r).left;ok(cell,r.name+': an hours cell');
        if(!left)ok(cell.textContent.includes('—'),r.name+': target hit, no hours');
        else if(rt){const h=left/rt.avg,shown=h<10?(Math.round(h*10)/10).toFixed(1).replace(/\.0$/,''):Math.round(h).toLocaleString('en-GB');
          ok(cell.textContent.includes('~'+shown+' h'),r.name+': '+left+' ÷ '+rt.avg+' = ~'+shown+' h ('+cell.textContent+')');}
        else ok(/not timed/.test(cell.textContent),r.name+': not timed yet');});
      const sum=pg.querySelector('.q4HrSum');ok(sum&&/Hours of building left/.test(sum.textContent),'the total under the table');
      ok(tb.querySelector('.q4RateIn'),'each line has a timing box in its drop-down');
      /* a timing saves through the PLUB settings, the same way a target does */
      const p=R.bundles.filter(r=>r.priority)[0];
      sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:{value:keepS},error:null}),
        upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
      LV3.__setPrefsBase(JSON.parse(keepS));
      ok(await LV3.q4SetRate(p.id,'30, 26 ,28'),'the save reports it landed');
      ok(wrote&&wrote.q4Rates&&JSON.stringify(wrote.q4Rates[p.id])==='[30,26,28]','lavarion_prefs gets q4Rates['+p.id+'] = 30, 26, 28');
      eq(LV3.q4RateOf(p.id).avg,28,'averaged: 28 an hour');
      await LV3.q4SetRate(p.id,'');ok(wrote&&wrote.q4Rates&&!(p.id in wrote.q4Rates),'cleared: the line is not timed');
    }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));
      LV3.__setPrefsBase(keepB);D.log.splice(0,D.log.length-logN);
      try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 137 · b650: the number alone, a red ✕ when none of a target line went out, Priority bundles above the graph */
  S['b650: Progress tables — the number alone, a red ✕ when a target line had none go out; Priority bundles above the graph']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),PG=R.progress,num=e=>parseInt(((e||{}).textContent||'').replace(/[^\d]/g,''))||0;
      let nX=0;
      ['days','weeks'].forEach(m=>{const t=pg.querySelector('.q4GW-'+m+' table.q4G');ok(t,m+' table');if(!t)return;
        const rows=(PG[m]||[]).filter(r=>r.units>0),trs=[...t.querySelectorAll('tbody tr:not(.q4Gap):not(.q4WkD)')];
        eq(trs.length,rows.length,m+': a row for each one something went out');
        const cum={},at={};(PG[m]||[]).slice().reverse().forEach(r=>{PG.pri.forEach(p=>{cum[p.id]=(cum[p.id]||0)+(r.by[p.id]||0);});at[r.key]=Object.assign({},cum);});
        rows.forEach((r,i)=>{const tr=trs[i];if(!tr)return;const cells=[...tr.querySelectorAll('td.q4H, td.q4H0')];
          ok(!tr.querySelector('td.q4Snt small')&&!tr.querySelector('td.q4H small'),m+' '+r.key+': the numbers stand alone — no % beside them');
          PG.pri.forEach((p,j)=>{const td=cells[j],u=r.by[p.id]||0,tx=td?td.textContent.trim():'';if(!td){ok(false,p.name+': a cell');return;}
            if(u>0){eq(num(td),u,p.name+' '+r.key+': '+u);ok(/% of its/.test(td.title),p.name+' '+r.key+': its % is in the hover');}
            else if(r.now)eq(tx,'0',p.name+' '+r.key+': none yet today — a quiet 0, not a ✕');
            else if(p.target>0&&(at[r.key][p.id]||0)>=p.target)eq(tx,'✓',p.name+' '+r.key+': target already hit — a quiet ✓');
            else{eq(tx,'✕',p.name+' '+r.key+': none went out — ✕');ok(td.classList.contains('x')&&/none went out/.test(td.title),p.name+' '+r.key+': red, and the hover says so');nX++;}});
          const o=cells[PG.pri.length];eq(o?num(o):-1,r.others||0,m+' '+r.key+': Others');ok(o&&!o.classList.contains('x'),m+' '+r.key+': no ✕ under Others (no target to miss)');});});
      const x=pg.querySelector('.q4GW table.q4G td.q4H0.x b');
      if(nX){ok(x,'a ✕ on the page');if(x)eq(getComputedStyle(x).color,'rgb(248, 113, 113)','the ✕ is red');}
      ok(/none of that line went out/.test((pg.querySelector('.q4SegNote')||{}).textContent||''),'the note under Days / Weeks says what the ✕ means');
      /* the page order: This week … Settings ▾, then the key + Priority bundles, then Progress ▾ (the graph and tables), then Other bundles */
      const pri=pg.querySelector('.q4PriPanel'),prog=pg.querySelector('details.q4Prog:not(.q4Rec)'),leg=pg.querySelector('.q4Legend'),set=pg.querySelector('details.q4Set');
      const oth=[...pg.querySelectorAll('section.q4Panel')].find(s=>((s.querySelector('.ph .t')||{}).textContent||'')==='Other bundles');
      const after=(a,b)=>!!(a&&b&&(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING));
      ok(after(pri,prog),'Priority bundles sits above the graph and the tables');
      ok(after(leg,pri)&&leg.nextElementSibling===pri,'its Build now / Parts cover key sits just above it');
      ok(after(set,leg),'Settings ▾ stays above it');
      ok(after(prog,oth),'Other bundles stays below the graph');
      ok(!/undefined|NaN/.test(pg.querySelector('.q4Prog').innerHTML),'no NaN');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 138 · b651: the Complete chart's lines heavier, no parts in hand line */
  S['b651: Complete chart — thicker lines, no parts in hand line or key']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{goPage('lavarion');LV3.go('q4');await wait(250);
      const ch=document.querySelector('#page-lavarion .q4Prog .q4Chart');ok(ch,'the Complete chart');if(!ch)return;
      const sw=sel=>{const e=ch.querySelector(sel);return e?parseFloat(getComputedStyle(e).strokeWidth)||0:null;};
      ok(sw('polyline.ln')>=3.5,'Sent so far: 3.5 or more ('+sw('polyline.ln')+')');
      if(ch.querySelector('polyline.pj'))ok(sw('polyline.pj')>=3.5,'the weekly-average line: 3.5 or more ('+sw('polyline.pj')+')');
      if(ch.querySelector('line.nd'))ok(sw('line.nd')>=4.5,'the needed-to-finish dots: 4.5 or more ('+sw('line.nd')+')');
      ok(sw('line.by')>=2,'the last-send line: 2 or more');{const t=ch.querySelector('text.ax.by');if(t)eq(getComputedStyle(t).stroke,'none','its date is clean text — no dashed outline');}ok(sw('line.td')>=1.5,'the today line: 1.5 or more');
      const k=ch.querySelector('.q4ChartK .k.p i');if(k)ok(parseFloat(getComputedStyle(k).borderTopWidth)>=3,'the key swatches are as thick as the lines');
      ok(!ch.querySelector('svg line.cl')&&!ch.querySelector('.q4ChartK .k.c'),'no parts in hand line or key chip');
      ok(!/parts in hand/i.test(ch.textContent+(ch.querySelector('svg').getAttribute('aria-label')||'')),'"parts in hand" is nowhere on the chart');
      ok(!/undefined|NaN/.test(ch.innerHTML),'no NaN');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 139 · b652: sort (most done first), aligned names, a colour per line that never repaints, the drop-down and cards */
  S['b652: Q4 — Sort box (most done first), aligned names, a colour per line that never repaints, drop-down + card layout']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'';let keepSort=null;try{keepSort=localStorage.getItem('lv3.q4.sort');}catch(e){}
    const keepT=D.settings.q4Targets===undefined?undefined:JSON.stringify(D.settings.q4Targets);
    try{
      try{localStorage.removeItem('lv3.q4.sort');}catch(e){}
      eq(LV3.q4SortPref(),'most','nothing picked: most done first');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),TR=LV3.q4Track(R),byName={};R.bundles.filter(r=>r.priority).forEach(r=>{byName[r.name]=r;});
      const order=()=>[...document.querySelectorAll('#page-lavarion table.q4P tbody tr.q4Row td.q4N .q4NT>b')].map(b=>byName[b.textContent]),pc=r=>r&&r.pct!=null?r.pct:-1;
      let o=order();ok(o.length&&o.every(Boolean),'every row is a priority bundle');
      ok(o.every((r,i)=>i===0||pc(o[i-1])>=pc(r)),'most done first: '+o.map(pc).join(', '));
      const sel=pg.querySelector('.q4PriPanel select.q4SortSel');ok(sel&&sel.value==='most'&&sel.options.length===5,'a Sort box on Priority bundles, on Most done first');
      LV3.q4SetSort('least');await wait(150);o=order();ok(o.every((r,i)=>i===0||pc(o[i-1])<=pc(r)),'Least done first');
      LV3.q4SetSort('left');await wait(150);o=order();ok(o.every((r,i)=>i===0||TR.line(o[i-1]).left>=TR.line(r).left),'Most left to do');
      LV3.q4SetSort('week');await wait(150);o=order();ok(o.every((r,i)=>i===0||TR.week(o[i-1]).toGo>=TR.week(r).toGo),'Most to do this week');
      LV3.q4SetSort('name');await wait(150);o=order();ok(o.every((r,i)=>i===0||String(o[i-1].name).localeCompare(String(r.name))<=0),'A to Z');
      eq((()=>{try{return localStorage.getItem('lv3.q4.sort');}catch(e){return null;}})(),'name','the choice is kept on this browser');
      LV3.q4SetSort('most');await wait(150);
      /* names: the chevron beside a name block — the ASIN starts where the name starts */
      const nts=[...document.querySelectorAll('#page-lavarion table.q4T td.q4N .q4NW')];ok(nts.length&&nts.every(x=>x.querySelector('.q4Chev')&&x.querySelector('.q4NT>b')&&x.querySelector('.q4NT>small')),'every name cell is chevron + name block');
      const vis=nts.filter(x=>x.getBoundingClientRect().width>0);
      ok(vis.every(x=>Math.abs(x.querySelector('.q4NT>b').getBoundingClientRect().left-x.querySelector('.q4NT>small').getBoundingClientRect().left)<1.5),'the ASIN lines up under the name');
      /* colours: one each, and adding targets repaints nobody */
      const hueBy=()=>{const m={};document.querySelectorAll('#page-lavarion .q4Week .q4WC').forEach(c=>{const id=(c.getAttribute('onclick').match(/'([^']+)'/)||[])[1];m[id]=c.style.getPropertyValue('--c').trim();});return m;};
      const h0=hueBy(),ids0=Object.keys(h0);ok(ids0.length&&new Set(Object.values(h0)).size===ids0.length,'every target line has a colour of its own ('+ids0.length+')');
      const nameHue={};R.bundles.filter(r=>r.priority).forEach(r=>{nameHue[r.name]=h0[r.id];});
      [['Gluten Free Snack Bundle','#9085e9'],['Gluten Free Biscuit Bundle','#3987e5'],['Hot Chocolate Gift Hamper','#d55181'],['Tea & Biscuits Hamper','#c98500'],['Pub Snacks Hamper','#199e70'],['Reindeer Food','#d95926']]
        .forEach(([nm,h])=>{if(nameHue[nm]&&Object.keys(D.settings.q4Targets||{}).slice(0,6).some(k=>(R.bundles.find(r=>r.id===k)||{}).name===nm))eq(nameHue[nm],h,nm+' keeps its colour');});
      const extra=R.bundles.filter(r=>!r.priority&&r.max>0).slice(0,2);
      if(extra.length&&D.settings.q4Targets){const m=Object.assign({},D.settings.q4Targets);extra.forEach(r=>{m[String(r.id)]=50;});D.settings.q4Targets=m;LV3.render();goPage('lavarion');LV3.go('q4');await wait(250);
        const h1=hueBy();ok(ids0.every(id=>h1[id]===h0[id]),'adding '+extra.length+' targets repaints nobody');
        ok(new Set(Object.values(h1)).size===Object.keys(h1).length&&Object.keys(h1).length===ids0.length+extra.length,'and the new ones get colours of their own');
        D.settings.q4Targets=JSON.parse(keepT);LV3.render();goPage('lavarion');LV3.go('q4');await wait(250);}
      /* the drop-down: four cards, one row, the same height, in the order Left to do · Sent by week · Build speed · To buy */
      const tr=document.querySelector('#page-lavarion table.q4P tbody tr.q4Row'),id=tr&&tr.getAttribute('data-q4r');
      if(id){LV3.q4Toggle(id);await wait(150);
        const dr=[...document.querySelectorAll('#page-lavarion table.q4P tr.q4Drop')].find(x=>x.getAttribute('data-q4d')===id),cs=dr?[...dr.querySelectorAll('.q4DropIn>.q4DB')]:[];
        eq(cs.length,4,'four cards in the drop-down');
        if(cs.length===4&&innerWidth>1280){const b=cs.map(c=>c.getBoundingClientRect());
          ok(b.every(x=>Math.abs(x.top-b[0].top)<1.5&&Math.abs(x.height-b[0].height)<1.5),'one row, all the same height');
          eq(cs.map((c,i)=>[b[i].left,(c.className.match(/q4DB\w+/g)||['']).pop()]).sort((p,q)=>p[0]-q[0]).map(x=>x[1]).join(','),'q4DBLeft,q4DBWk,q4DBRate,q4DBBuy','Left to do, Sent by week, Build speed, To buy');}
        const bad=dr&&dr.querySelector('.q4Stack i.bad');if(bad)eq(getComputedStyle(bad).backgroundColor,'rgb(148, 163, 184)','parts still to buy: a calm grey, not red');
        ok(dr&&!dr.querySelector('.q4DBn.w'),'no amber notes in it');
        const inp=dr&&dr.querySelector('.q4RateIn');if(inp)ok(getComputedStyle(inp,'::placeholder').color!==getComputedStyle(inp).color,'the e.g. placeholder is muted — it does not read as a value');
        LV3.q4Toggle(id);await wait(100);}
      /* This week cards: Last week · Parts in hand · At Amazon as a labelled list on the bottom edge, rows balanced */
      const cards=[...document.querySelectorAll('#page-lavarion .q4Week .q4WC')],g=document.querySelector('#page-lavarion .q4WeekGrid');
      cards.forEach(c=>{const nm=c.querySelector('.h').textContent,k=[...c.querySelectorAll('.kvs .kv>span')].map(s=>s.textContent);
        eq(k[0],'Last week',nm+': Last week first');ok(!c.querySelector(':scope>.n, :scope>.s, :scope>.az'),nm+': no loose sentence lines');});
      if(g&&cards.length){const cols=parseInt(g.style.getPropertyValue('--cols'));eq(cols,Math.ceil(cards.length/Math.ceil(cards.length/6)),cards.length+' cards → '+cols+' a row');
        if(innerWidth>1180){const top0=cards[0].getBoundingClientRect().top,row=cards.filter(c=>Math.abs(c.getBoundingClientRect().top-top0)<1),kb=row.map(c=>c.querySelector('.kvs').getBoundingClientRect().bottom);
          ok(kb.every(v=>Math.abs(v-kb[0])<1.5),'the labelled rows sit on the bottom edge of every card in a row');}}
      ok(!/undefined|NaN/.test(pg.innerHTML),'no NaN');
    }finally{if(keepT===undefined)delete D.settings.q4Targets;else D.settings.q4Targets=JSON.parse(keepT);
      try{if(keepSort==null)localStorage.removeItem('lv3.q4.sort');else localStorage.setItem('lv3.q4.sort',keepSort);}catch(e){}
      try{LV3.render();LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 140 · b653: hours of building as build days — hours ÷ his hours a day (8 until he sets it) */
  S['b653: Q4 — hours left as build days at his hours a day (8 until set); the box saves']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),was=(document.querySelector('.page.active')||{}).id||'';
    const keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase(),logN=D.log.length;
    const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
    try{
      if(D.settings.q4HoursDay==null)eq(LV3.q4HoursDay(),8,'nothing set: 8 hours a day');
      goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),TR=LV3.q4Track(R),hpd=LV3.q4HoursDay();
      const fmtH=h=>h<10?(Math.round(h*10)/10).toFixed(1).replace(/\.0$/,''):Math.round(h).toLocaleString('en-GB');
      const P=R.bundles.filter(r=>r.priority),timed=P.filter(r=>LV3.q4RateOf(r.id)&&TR.line(r).left>0);
      timed.forEach(r=>{const h=TR.line(r).left/LV3.q4RateOf(r.id).avg,tr=[...pg.querySelectorAll('table.q4P tbody tr.q4Row')].find(t=>t.getAttribute('data-q4r')===r.id);
        const cell=tr&&tr.querySelector('td.q4Hr');ok(cell&&cell.textContent.includes('≈ '+fmtH(h/hpd)+' build day'),r.name+': ~'+fmtH(h)+' h ≈ '+fmtH(h/hpd)+' build days ('+(cell&&cell.textContent)+')');
        const dr=[...pg.querySelectorAll('table.q4P tr.q4Drop')].find(t=>t.getAttribute('data-q4d')===r.id);ok(dr&&dr.querySelector('.q4RateOut').textContent.includes('≈ '+fmtH(h/hpd)+' build day'),r.name+': the Build speed card gives the days too');});
      const sum=pg.querySelector('.q4HrSum');
      if(timed.length){const tot=timed.reduce((t,r)=>t+TR.line(r).left/LV3.q4RateOf(r.id).avg,0);
        ok(sum&&sum.querySelector('.q4HrD').textContent.includes(fmtH(tot/hpd)+' build day'),'the strip: ~'+fmtH(tot)+' h ≈ '+fmtH(tot/hpd)+' build days');
        ok(sum.querySelector('#q4t-hpd')&&+sum.querySelector('#q4t-hpd').value===hpd,'the hours-a-day box shows '+hpd);
        ok(sum.textContent.includes(TR.wdLeft+' working day'),'beside the '+TR.wdLeft+' working days left');
        /* the box saves through the PLUB settings */
        sb.from=t=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve({data:{value:keepS},error:null}),
          upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return q;};
        LV3.__setPrefsBase(JSON.parse(keepS));
        ok(await LV3.q4SetHoursDay('6.5'),'the save reports it landed');eq(wrote&&wrote.q4HoursDay,6.5,'lavarion_prefs gets q4HoursDay = 6.5');
        await wait(150);ok(document.querySelector('#page-lavarion .q4HrSum .q4HrD').textContent.includes(fmtH(tot/6.5)+' build day'),'redrawn at 6.5 a day: '+fmtH(tot/6.5));
        await LV3.q4SetHoursDay('');eq(LV3.q4HoursDay(),8,'cleared: back to 8');
        await LV3.q4SetHoursDay('30');eq(LV3.q4HoursDay(),8,'over 24 is ignored');}
      ok(!/undefined|NaN|Infinity/.test(pg.querySelector('.q4PriPanel').innerHTML),'no NaN');
    }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));
      LV3.__setPrefsBase(keepB);D.log.splice(0,D.log.length-logN);
      try{LV3.render();LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 141 · b654: the Priority bundles heading is frozen under the PLUB bar on a laptop-wide window */
  S['b654: Priority bundles — the heading stays at the top under the PLUB bar as the lines scroll']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),box=pg.querySelector('.q4PScroll'),t=box&&box.querySelector('table.q4P'),bar=pg.querySelector('.lav3bar');
      ok(box&&t,'the Priority table sits in its own box');if(!box||!t)return;
      if(innerWidth<1180){ok(/auto|scroll/.test(getComputedStyle(box).overflowX),'narrow window: it still scrolls sideways');return;}
      eq(getComputedStyle(box).overflowX,'clip','laptop-wide: the box clips, so it is not its own scroller');
      const th=t.querySelector('thead th');eq(getComputedStyle(th).position,'sticky','the heading cells are sticky');
      ok(bar&&Math.abs(parseFloat(getComputedStyle(th).top)-bar.offsetHeight)<1.5,'they stop under the PLUB bar ('+(bar&&bar.offsetHeight)+'px)');
      ok(/inset/.test(getComputedStyle(th).boxShadow),'the orange line is on the heading, so it moves with it');
      const keep=pg.scrollTop,rows=t.querySelectorAll('tbody tr.q4Row');
      if(rows.length>3){pg.scrollTop+=t.getBoundingClientRect().top-bar.getBoundingClientRect().bottom+200;await wait(60);
        ok(Math.abs(th.getBoundingClientRect().top-bar.getBoundingClientRect().bottom)<2,'scrolled 200px into the lines: the heading is still right under the bar');
        ok(t.getBoundingClientRect().top<th.getBoundingClientRect().top-100,'…while the table itself has moved up past it');
        pg.scrollTop=keep;}
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 142 · b655: Hours of prep left — timed lines at their own speed, the rest at the average of every timed hour */
  S['b655: Q4 — an Hours of prep left tile: timed lines plus an estimate for the rest, as build days against the days left']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const was=(document.querySelector('.page.active')||{}).id||'';
    try{goPage('lavarion');LV3.go('q4');await wait(250);
      const pg=document.getElementById('page-lavarion'),R=LV3.q4Calc(),TR=LV3.q4Track(R),P=R.bundles.filter(r=>r.priority&&r.target);
      const tiles=[...pg.querySelectorAll('.q4Kpis .kpi')],t=tiles.find(k=>/Hours of prep left/.test(k.textContent));
      if(!P.length){ok(!t,'no priority lines: no hours tile');return;}
      ok(t,'an Hours of prep left tile');if(!t)return;
      eq(tiles.indexOf(t),3,'it sits after Still to send');
      ok(pg.querySelector('.q4Kpis').classList.contains('q4K6'),'the row is laid out for six');
      const fmtH=h=>h<10?(Math.round(h*10)/10).toFixed(1).replace(/\.0$/,''):Math.round(h).toLocaleString('en-GB');
      const open=P.map(r=>({r,left:TR.line(r).left,rt:LV3.q4RateOf(r.id)})).filter(x=>x.left>0),on=open.filter(x=>x.rt),off=open.filter(x=>!x.rt);
      if(!open.length){ok(/None/.test(t.textContent),'everything sent: None');return;}
      if(!on.length){ok(/no line timed yet/.test(t.textContent),'nothing timed: it says so');return;}
      const tot=on.reduce((s,x)=>s+x.left/x.rt.avg,0),hrs=[].concat(...on.map(x=>x.rt.list)),rate=hrs.reduce((s,v)=>s+v,0)/hrs.length;
      const est=off.reduce((s,x)=>s+x.left,0)/rate,all=tot+est,hpd=LV3.q4HoursDay();
      ok(t.querySelector('.v').textContent.includes('~'+fmtH(all)+' h'),'~'+fmtH(tot)+' h timed + ~'+fmtH(est)+' h estimated = ~'+fmtH(all)+' h ('+t.querySelector('.v').textContent+')');
      ok(t.textContent.includes(fmtH(all/hpd)+' build day'),'≈ '+fmtH(all/hpd)+' build days at '+hpd+' h a day');
      ok(t.textContent.includes(TR.wdLeft+' working day'),'against the '+TR.wdLeft+' working days left');
      if(off.length){ok(t.textContent.includes(fmtH(tot)+' h timed')&&t.textContent.includes('~'+fmtH(est)+' h estimated'),'the split: '+fmtH(tot)+' h timed, ~'+fmtH(est)+' h estimated for the '+off.length+' not timed');
        const s=pg.querySelector('.q4HrSum .q4HrOff');ok(s&&s.textContent.includes('~'+fmtH(est)+' h more'),'the strip under the table gives the same estimate');}
      const fit=all/hpd<=TR.wdLeft;ok(fit?/4ade80/.test(t.getAttribute('style')):/fbbf24/.test(t.getAttribute('style')),fit?'it fits in the days left: green':'more than the days left: amber');
      ok(/÷/.test(t.getAttribute('title')||''),'the hover gives the sums');
      ok(!/NaN|undefined|Infinity/.test(t.outerHTML),'no NaN');
    }finally{try{LV3.go('overview');}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 143 · b656: Becki's "Ask Jack to check all orders" → one card per product → his answers → each stuck order goes
     where the sum says (cancelled → Sarah one press; booked against a cancelled order → Sarah; really missing → him) */
  S['b656: order check — Becki asks, Jack answers every order of the product, the card adds it up']=async()=>{
    const keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS,was=(document.querySelector('.page.active')||{}).id||'';let stamped=null;
    try{
      window._saveAsinChecks=async(A,v)=>{stamped={A,v};return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);};
      const setUp=tag=>{const A='B0CHKOC'+tag+(++_n),k=String(_n).padStart(7,'0').slice(-7),base={asin:A,prod:'CHECK ROW order check '+tag,sup:'Amazon UK'};
        const jk=()=>({state:'rejected',kind:'check',what:'jack-check',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',by:'Sarah',at:iso()});
        const o=(d,oid,acct,f)=>mkRow(Object.assign({},base,{date:dm(d),oid,acct},f));
        return{A,
          a:o(10,'202-'+k+'-0000001','Biz 01',{exp:1,rcvd:0,resolution:jk()}),
          b:o(70,'202-'+k+'-0000002','Biz 03 - WM',{exp:1,rcvd:0,resolution:jk()}),   /* stuck and older than 60 days */
          c:o(12,'202-'+k+'-0000003','Biz 01',{exp:1,rcvd:1,ship:1}),
          d:o(20,'302-'+k+'-0000004','EU 03',{sup:'Amazon Germany',exp:2,rcvd:2,ship:2}),
          e:o(100,'202-'+k+'-0000005','Biz 02',{exp:3,rcvd:3,ship:3})};};   /* older than 60 days and not stuck — b668: and well before the stuck one */
      /* 1 · the ask: one press, both stuck orders of the product go to Jack */
      let t=setUp('X');
      who('Sarah');await amzToBecki(t.a.uuid);await amzToBecki(t.b.uuid);ok(_isAmzDel(t.a)&&_isAmzDel(t.b),'both stuck orders are with Becki');
      {who('Jack');renderPrepRows([t.a]);const b=document.querySelector('#row-'+t.a.id+' .asinChkBtn');
        ok(b&&/124, 58, 237/.test(getComputedStyle(b).backgroundColor)&&getComputedStyle(b).borderTopStyle==='solid','b658: Jack’s tick button is a filled violet button — nothing like Becki’s cyan');who('Sarah');}
      renderPrepRows([t.a,t.b]);
      {const el=document.querySelector('#row-'+t.a.id);ok(el&&el.querySelector('button.qryOc')&&el.querySelector('button.qryNot'),'Becki’s card: Not here and “Ask Jack to check all orders”');
        const bc=el&&el.querySelector('button.qryOc')?getComputedStyle(el.querySelector('button.qryOc')).borderTopColor:'';ok(/245, 158, 11/.test(bc),'b660: “Ask Jack” is amber — not Becki’s cyan, not Jack’s violet tick ('+bc+')');}
      who('Becki');await ocAsk(t.a.uuid);
      ok(_ocAsked(t.a)&&_ocAsked(t.b),'one press puts BOTH stuck orders of the product with Jack');
      eq(_rowOwner(t.a).owner,'jack','the row is Jack’s');ok(onJack(t.a)&&onJack(t.b),'on Jack’s list');
      ok(!onSarahActive(t.a),'not on Sarah’s active list');
      {const it=sarahItem(t.a);ok(it&&it.waiting&&it.waiting.what==='asin-orders','Sarah sees it grey, with Jack');}
      renderPrepRows([t.a,t.b]);
      {const el=document.querySelector('#row-'+t.a.id);ok(el&&/With Jack · checking every order/.test(el.textContent)&&!el.querySelector('button.qryNot'),'Becki’s card: “With Jack · checking every order”, no Not here');
        ok(el&&el.querySelector('.qryTag.jk')&&!el.querySelector('.qryTag.amz'),'b657: in Jack’s colour, not Becki’s cyan');
        ok(el&&!el.querySelector('.ownTag'),'b657: no second “With Jack” chip');
        const bg=el&&getComputedStyle(el.querySelector('.qryTag.jk')).backgroundColor;ok(/139, 92, 246/.test(bg||''),'b658: the chip is violet ('+bg+')');}
      ok(/Jack is checking every order/.test(t.a.vaNote.split('\n').pop()),'the VA note says so');
      who('Jack');eq(asinChkTile(t.a,'sheet'),'','while he checks, the old one-press tick is off the sheet (the card has All delivered)');
      /* 2 · Undo puts it back exactly */
      await ocUndo(t.A);
      ok(!_ocAsked(t.a)&&!_ocAsked(t.b),'Undo: both off Jack’s list');eq(t.a.resolution.state,'rejected','back to Jack’s earlier answer');
      ok(_isAmzDel(t.a)&&_ocCan(t.a),'back on the shelf check, the button is back');ok(t.a.resolution.ordChkUndone&&t.a.resolution.ordChkUndone.length===1,'the ask stays in the history');
      /* 3 · his card: every order of the product, the stuck one over 60 days included, the old one not */
      who('Becki');await ocAsk(t.b.uuid);
      const P0=_ocPlan(t.A);
      eq(P0.orders.length,4,'4 orders on the card: the 2 stuck, 2 more from the last 60 days (the 100-day one left off)');
      ok(P0.orders.some(o=>o.old&&o.stuck.length),'the stuck order older than 60 days is on it');
      ok(!P0.orders.some(o=>o.oid===t.e.oid),'an old order that isn’t stuck is not');
      eq(_ocOrderUrl(t.d.oid,'Amazon Germany'),'https://www.amazon.de/gp/your-account/order-details?orderID='+t.d.oid,'an Amazon Germany order opens on amazon.de');
      who('Jack');goPage('jack');renderJack();await wait(150);
      {const cards=[...document.querySelectorAll('#jackWrap .ocCard')].filter(c=>c.textContent.includes(t.A));
        eq(cards.length,1,'ONE card for the product on Jack’s Admin');
        const c=cards[0];ok(c&&c.querySelectorAll('.ocT > tbody > tr').length===4,'with a line for each order');
        ok(c&&c.querySelector('.ocGo[disabled]'),'Send is off until every order is answered');
        ok(c&&[...c.querySelectorAll('td.ocAcct')].some(td=>td.textContent==='EU 03')&&/Amazon Germany/.test(c.textContent),'account and marketplace on each');}
      /* 4 · the misbooking: the order booked in (c) was the one Amazon cancelled; b was cancelled too */
      await ocAns(t.A,t.a.oid,'d');await ocAns(t.A,t.b.oid,'c');await ocAns(t.A,t.c.oid,'c');
      let P=_ocPlan(t.A);ok(!P.all,'3 of 4 answered — not done yet');
      await ocAllDel(t.A);P=_ocPlan(t.A);
      ok(P.all&&P.orders.find(o=>o.oid===t.d.oid).ans.a==='d','All delivered answers the one left');
      ok(t.a.resolution.ordChk.ans[t.c.oid]&&t.b.resolution.ordChk.ans[t.c.oid],'b662: his answers are on BOTH stuck rows');
      eq(P.orders.find(o=>o.oid===t.c.oid).ans.a,'c','…and leaves his Cancelled alone');
      eq(P.D,3,'Amazon delivered 3 (1 + 0 + 0 + 2)');eq(P.B,3,'3 booked in');eq(P.moved,1,'1 booked against the wrong order');eq(P.M,0,'nothing really missing');
      eq(P.rows.find(x=>x.r===t.a).route,'sarah','a → Sarah: booked against the cancelled order');eq(P.rows.find(x=>x.r===t.b).route,'cancelled','b → cancelled');
      renderJack();await wait(100);
      {const c=[...document.querySelectorAll('#jackWrap .ocCard')].find(c=>c.textContent.includes(t.A));
        ok(c&&/Delivered 3/.test(c.querySelector('.ocSum').textContent.replace(/\s+/g,' '))&&!c.querySelector('.ocGo[disabled]'),'the sum shows and Send is on');}
      await ocSend(t.A);
      ok(!_isAmzDel(t.a)&&!_isAmzDel(t.b),'off Becki’s shelf check');ok(!onJack(t.a)&&!onJack(t.b),'off Jack’s list');
      eq(t.a.resolution.state,'rejected','a: back with Sarah');ok(new RegExp(t.c.oid).test(t.a.resolution.rejectNote)&&new RegExp(t.c.sku).test(t.a.resolution.rejectNote),'a: his answer names the order and the SKU it was booked under');
      eq(t.b.resolution.restGone&&t.b.resolution.restGone.why,'cancelled','b: Sarah’s one press — note the sheet and close it');
      ok(onSarahActive(t.a)&&onSarahActive(t.b),'both on Sarah’s list');
      eq(t.a.resolution.ordChk.done.D,3,'the answers stay on the row');eq(t.a.resolution.amzDelivered.done.how,'orders-checked','the shelf flag says why it went');
      ok(!stamped,'not every order was delivered — no green tick');
      /* 5 · all delivered and still not here: really missing → his list to raise with Amazon, and his green tick */
      t=setUp('Y');who('Sarah');await amzToBecki(t.a.uuid);who('Becki');await ocAsk(t.a.uuid);
      who('Jack');await ocAllDel(t.A);P=_ocPlan(t.A);eq(P.M,1,'all delivered, 1 not booked in → 1 really missing');
      await ocSend(t.A);
      eq(t.a.resolution.what,'amz-missing','a: on his list to raise with Amazon');ok(onJack(t.a)&&!onSarahActive(t.a),'his, not Sarah’s');
      ok(stamped&&stamped.A===t.A&&stamped.v.orders.length===3,'every order delivered: his green tick on all 3');
      /* 6 · found on the shelf while he is checking → back where it was by itself */
      t=setUp('Z');who('Sarah');await amzToBecki(t.a.uuid);who('Becki');await ocAsk(t.a.uuid);
      t.a.rcvd=1;ok(_amzFoundBySave(t.a),'booked in: the flag clears as found');ok(!_ocAsked(t.a)&&!onJack(t.a),'and it comes off Jack’s list');
      /* 7 · not offered on a supplier order */
      const s=mkRow({sup:'Argos',oid:'AR-'+_n,exp:1,rcvd:0,resolution:{state:'rejected',kind:'check',what:'jack-check',rejectNote:'x',by:'Sarah',at:iso()}});
      s.resolution.amzDelivered={by:'Jack',at:iso(),sentBy:'Sarah'};ok(_isAmzDel(s)&&!_ocCan(s),'a supplier order gets no order check');
    }finally{window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;try{renderJack();}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 144 · b661: a part-booked order claims only what is really missing, Sarah gets the move; Send undoes; newest first */
  S['b661: order check — part-booked: claim only the really missing, Sarah gets the move; Send undoes; newest first']=async()=>{
    const keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS,keepSort=_jkSort,keepKind=_jkKind,was=(document.querySelector('.page.active')||{}).id||'';
    try{
      window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);};
      const jk=()=>({state:'rejected',kind:'check',what:'jack-check',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',by:'Sarah',at:iso()});
      const A='B0CHKOM'+(++_n),k=String(_n).padStart(7,'0').slice(-7);
      const s=mkRow({asin:A,prod:'CHECK ROW part-booked',date:dm(9),oid:'202-'+k+'-0000001',acct:'Biz 01',exp:2,rcvd:0,resolution:jk()});
      const c=mkRow({asin:A,prod:'CHECK ROW part-booked',date:dm(11),oid:'202-'+k+'-0000002',acct:'Biz 02',exp:1,rcvd:1,ship:1});
      who('Sarah');await amzToBecki(s.uuid);who('Becki');await ocAsk(s.uuid);
      who('Jack');await ocAns(A,s.oid,'d');await ocAns(A,c.oid,'c');
      let P=_ocPlan(A);eq(P.moved,1,'1 of the 2 booked against the cancelled order');eq(P.M,1,'1 really missing');eq(P.rows[0].route,'missing','the order goes on his raise list');
      const jobsOn=()=>VA_ACTIONS.filter(a=>!a.done&&a.rid===c.uuid);
      await ocSend(A);
      eq(s.resolution.what,'amz-missing','on his raise list');eq(s.resolution.ocClaim&&s.resolution.ocClaim.miss,1,'carrying the 1 really missing');
      eq(_amzClaimUnits(s),1,'the claim is 1 unit, not 2');
      {const j=jobsOn()[0];ok(j&&j.task.includes(c.oid)&&j.task.includes(s.oid),'Sarah has the move as a job, on the cancelled order’s row, both order numbers in it');}
      _jkSort='priority';_jkKind='all';goPage('jack');renderJack();await wait(150);
      {const card=[...document.querySelectorAll('#jackWrap .jkCard')].find(x=>x.textContent.includes(s.sku));const tx=card?card.textContent.replace(/\s+/g,' '):'';
        ok(/1 unit Amazon say was delivered/.test(tx)&&/1 more booked against another order — Sarah is moving it across/.test(tx),'his card: 1 unit, and 1 more Sarah is moving ('+tx.slice(0,160)+')');}
      /* Undo the Send from his Done list */
      let g=_ocSends().find(x=>x.A===A);ok(g&&g.ok,'the Send is on his Done list, undoable');
      ok([...document.querySelectorAll('#jackWrap .jkDone button')].some(b=>(b.getAttribute('onclick')||'').includes('ocUndoSend(\''+A)),'with an Undo button');
      await ocUndoSend(A,g.at);
      ok(_ocAsked(s),'undone: back on his order-check card');ok(_ocPlan(A).all,'with his answers still on it');
      eq(jobsOn().length,0,'Sarah’s move job is withdrawn');ok(!_ocSends().some(x=>x.A===A),'off the Done list');
      ok((s.resolution.ordChkUndoneSends||[]).length===1,'the undone answer stays in the row’s history');
      /* send again — Sorted with Amazon writes off only the 1 */
      await ocSend(A);await amzMissingDone(s.uuid,'raised');
      eq(parseInt(s.cancelledQty)||0,1,'Sorted with Amazon writes off 1, not 2 — the other is Sarah’s move');eq(s.resolution.refundUnits,1,'the refund is for 1');
      g=_ocSends().find(x=>x.A===A);ok(g&&!g.ok,'once it is sorted with Amazon, Undo is off');
      /* two order checks — at the top of his Admin, newest first */
      const B1='B0CHKON'+(++_n),B2='B0CHKON'+(++_n),k1=String(_n).padStart(7,'0').slice(-7);
      const x1=mkRow({asin:B1,prod:'CHECK ROW older ask',date:dm(8),oid:'203-'+k1+'-0000001',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
      const x2=mkRow({asin:B2,prod:'CHECK ROW newer ask',date:dm(8),oid:'203-'+k1+'-0000002',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
      who('Sarah');await amzToBecki(x1.uuid);await amzToBecki(x2.uuid);who('Becki');await ocAsk(x1.uuid);await wait(15);await ocAsk(x2.uuid);
      who('Jack');renderJack();await wait(150);
      {const trs=[...document.querySelectorAll('#jackWrap tbody.jkCards > tr')];
        ok(trs[0]&&trs[0].querySelector('.ocCard')&&trs[0].textContent.includes(B2),'the newest order check is the first card on his Admin');
        ok(trs[1]&&trs[1].querySelector('.ocCard')&&trs[1].textContent.includes(B1),'the older one right under it');}
    }finally{window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;_jkSort=keepSort;_jkKind=keepKind;try{renderJack();}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 145 · b662: the audit — split order, supplier orders, cancellations on the raise route, units held for an earlier
     check, Undo keeps history and won't half-undo, a failed save stops the Send, quotes in an order ID, who can be asked */
  S['b662: order check audit — split order, supplier orders, cancelled on the raise route, held units, safe Undo, failed save']=async()=>{
    const keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS,keepRow=window.saveRow,was=(document.querySelector('.page.active')||{}).id||'';
    try{
      window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);};
      const jk=()=>({state:'rejected',kind:'check',what:'jack-check',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',by:'Sarah',at:iso()});
      const kk=()=>String(++_n).padStart(7,'0').slice(-7);
      const ask=async(...rs)=>{who('Sarah');for(const r of rs)await amzToBecki(r.uuid);who('Becki');await ocAsk(rs[0].uuid);who('Jack');};
      /* 1 · split order: the other line booked 7 of 5 — the stuck line's 2 are there, not missing */
      {const A='B0CHKSP'+(++_n),k=kk(),oid='202-'+k+'-0000001';
        const r1=mkRow({asin:A,prod:'CHECK ROW split',date:dm(9),oid,acct:'Biz 01',exp:5,rcvd:7,ship:7});
        const r2=mkRow({asin:A,prod:'CHECK ROW split',date:dm(9),oid,acct:'Biz 01',exp:5,rcvd:3,resolution:jk()});
        await ask(r2);await ocAllDel(A);const P=_ocPlan(A);
        eq(P.rows[0].route,'sarah','split order: the stuck line goes to Sarah, not to a claim');eq(P.M,0,'nothing really missing');ok(P.rows[0].srcs[0]&&P.rows[0].srcs[0].inner,'covered by the other line of its own order');}
      /* 2 · supplier order on the card: no answer needed, Send lights up, nothing throws */
      {const A='B0CHKSU'+(++_n),k=kk();
        const s=mkRow({asin:A,prod:'CHECK ROW supplier',date:dm(9),oid:'202-'+k+'-0000001',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        const cu=mkRow({asin:A,prod:'CHECK ROW supplier',date:dm(10),oid:'CUR'+k,acct:'BDL Account',sup:'Currys',exp:4,rcvd:4,ship:4});
        await ask(s);const o=_ocPlan(A).orders.find(x=>x.oid==='CUR'+k);ok(o&&!o.amz,'the Currys order is a supplier order');
        await ocAns(A,'CUR'+k,'c');ok(!_ocPlan(A).orders.find(x=>x.oid==='CUR'+k).ans,'it can’t be answered');
        await ocAns(A,s.oid,'d');const P=_ocPlan(A);ok(P.all&&P.amzN===1,'answering the 1 Amazon order is enough');
        goPage('jack');renderJack();await wait(120);
        {const c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));
          ok(c&&/Supplier order — counted as booked in/.test(c.textContent)&&c.querySelector('tr.ocSup')&&!c.querySelector('tr.ocSup .ocChip'),'greyed on the card, no buttons');
          ok(c&&!c.querySelector('.ocGo[disabled]'),'Send is on');}
        await ocSend(A);eq(s.resolution.what,'amz-missing','sent without a hitch');}
      /* 3 · part cancelled on the raise route: the cancelled one closes with the claim, nothing left owing */
      {const A='B0CHKPC'+(++_n),k=kk();
        const s=mkRow({asin:A,prod:'CHECK ROW part',date:dm(9),oid:'202-'+k+'-0000001',acct:'Biz 01',exp:5,rcvd:2,resolution:jk()});
        await ask(s);await ocAns(A,s.oid,'p',1);await ocSend(A);
        eq(s.resolution.what,'amz-missing','on his raise list');eq(_amzClaimParts(s).claim,2,'claim 2');eq(_amzClaimParts(s).cx,1,'1 cancelled by Amazon');eq(_amzClaimParts(s).pending,0,'nothing being moved');
        goPage('jack');renderJack();await wait(120);
        {const c=[...document.querySelectorAll('#jackWrap .jkCard')].find(x=>x.textContent.includes(s.sku));ok(c&&/1 cancelled by Amazon/.test(c.textContent)&&!/Sarah is moving/.test(c.textContent),'his card says cancelled, not “Sarah is moving”');}
        await amzMissingDone(s.uuid,'raised');eq(_owedUnits(s),0,'closed with nothing left owing (2 claimed + 1 cancelled)');
        /* a later Not here doesn't inherit the old figure */
        s.resolution=Object.assign({},s.resolution,{state:'asked',what:'amz-missing',at:iso()});eq(_amzClaimParts(s).claim,_owedUnits(s),'a newer question ignores the old claim figure');}
      /* 4 · units an earlier check gave away aren't on offer again */
      {const A='B0CHKHD'+(++_n),k=kk();
        const r1=mkRow({asin:A,prod:'CHECK ROW held',date:dm(9),oid:'202-'+k+'-0000001',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        const cx=mkRow({asin:A,prod:'CHECK ROW held',date:dm(10),oid:'202-'+k+'-0000002',acct:'Biz 02',exp:1,rcvd:1,ship:1});
        await ask(r1);await ocAns(A,r1.oid,'d');await ocAns(A,cx.oid,'c');await ocSend(A);eq(r1.resolution.ordChk.done.route,'sarah','round 1: the cancelled order’s unit goes to r1');
        const r2=mkRow({asin:A,prod:'CHECK ROW held',date:dm(8),oid:'202-'+k+'-0000003',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        await ask(r2);await ocAllDel(A);await ocAns(A,cx.oid,'c');const P=_ocPlan(A);
        eq(P.rows[0].route,'missing','round 2: the same unit is not handed out again — r2 is really missing');eq(P.held,1,'the held unit is shown');}
      /* 5 · Undo keeps history, and won't half-undo once a row is filed */
      {const A='B0CHKUN'+(++_n),k=kk();
        const a=mkRow({asin:A,prod:'CHECK ROW undo',date:dm(9),oid:'202-'+k+'-0000001',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        const b=mkRow({asin:A,prod:'CHECK ROW undo',date:dm(9),oid:'202-'+k+'-0000002',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        await ask(a,b);await ocAns(A,a.oid,'c');await ocAns(A,b.oid,'c');await ocSend(A);
        const g=_ocSends().find(x=>x.A===A);ok(g&&g.ok,'undoable');
        await ocUndoSend(A,g.at);const u=(a.resolution.ordChkUndoneSends||[])[0];
        ok(u&&/cancelled/i.test(u.answer||'')&&u.route==='cancelled','the undone answer and its route stay on the row');
        ok((a.resolution.chase.log||[]).some(l=>/Jack answered/.test(l.what||'')),'the case log keeps the Send’s lines');
        await ocSend(A);b.archived=true;const g2=_ocSends().find(x=>x.A===A);ok(g2&&!g2.ok,'a filed row: Undo is off — nothing half-undone');b.archived=false;}
      /* 6 · a failed save stops the Send with nothing half-sent */
      {const A='B0CHKFS'+(++_n),k=kk();
        const a=mkRow({asin:A,prod:'CHECK ROW fail',date:dm(9),oid:'202-'+k+'-0000001',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        const b=mkRow({asin:A,prod:'CHECK ROW fail',date:dm(20),oid:'202-'+k+'-0000002',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        await ask(a,b);await ocAns(A,a.oid,'c');await ocAns(A,b.oid,'c');
        window.saveRow=async r=>r===b?false:keepRow(r);
        await ocSend(A);window.saveRow=keepRow;
        ok(_ocAsked(b)&&_ocAsked(a),'the save failed on the first one — both still on his card, nothing half-sent');
        ok(!(b.resolution.ordChk||{}).done,'and the failed row is exactly as it was');
        await ocSend(A);ok(!_ocAsked(a)&&!_ocAsked(b),'pressed again once it saves: both go');}
      /* 7 · quotes in an order ID can't break the buttons; who can be asked */
      {const A='B0CHKQT'+(++_n),k=kk(),odd='AB"C\'D'+k;
        const s=mkRow({asin:A,prod:'CHECK ROW quote',date:dm(9),oid:odd,acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
        await ask(s);goPage('jack');renderJack();await wait(120);
        const c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));const btn=c&&c.querySelector('.ocChip');
        ok(btn&&(btn.getAttribute('onclick')||'').includes("'AB\"C\\'D"+k+"'"),'the order ID reaches the button whole ('+(btn&&btn.getAttribute('onclick'))+')');
        const na=mkRow({asin:'',prod:'CHECK ROW no asin',date:dm(9),oid:'202-'+kk()+'-0000001',exp:1,rcvd:0,resolution:jk()});
        who('Sarah');await amzToBecki(na.uuid);ok(!_ocCan(na),'a row with no ASIN can’t be asked');
        const pk=mkRow({asin:'B0CHKPK'+(++_n),prod:'CHECK ROW parked',date:dm(9),oid:'202-'+kk()+'-0000001',exp:1,rcvd:0,resolution:jk()});
        await amzToBecki(pk.uuid);pk.expectedDelivery=ukAddDays(todayISO(),3);ok(!_ocCan(pk),'a row parked on a promised date can’t be asked');}
    }finally{window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;window.saveRow=keepRow;try{renderJack();}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 146 · b663: the mini sales run lays sales over the PLUB figures — never the counts, never an older run */
  S['b663: SellerFuse mini sales run — sales only, newer than the full run, once, keeps the month before']=async()=>{
    let n=0;while(!(window.LV3&&LV3.__sfSalesInto)&&n++<40)await wait(250);
    const into=LV3.__sfSalesInto,P={B0CHKMINI1:{asin:'B0CHKMINI1'},B0CHKMINI2:{asin:'B0CHKMINI2'}},by=a=>P[a]||null;
    const mk=()=>({atAmz:{B0CHKMINI1:7},sfSold:{B0CHKMINI1:{u30:30,u7:7,u14:14,p30:22,at:'2026-11-05T20:09:00Z'}},sfLastSold:{B0CHKMINI1:'2026-11-05',B0CHKMINI2:'2026-11-06'}});
    const run={id:901,at:'2026-11-06T20:05:00Z',sold:[{asin:'B0CHKMINI1',units30:31,units7:6,units14:0},{asin:'B0CHKOTHER',units30:9,units7:9}],
      summary:{kind:'sales',lastSold:{B0CHKMINI1:'2026-11-06',B0CHKMINI2:'2026-11-01',B0CHKOTHER:'2026-11-06'},q4:{from:'2026-10-01',to:'2026-11-06',by:{B0CHKMINI1:88}}}};
    let s=mk(),r=into(s,run,'2026-11-05T20:09:00Z',by);
    ok(r&&r.sold===1,'one PLUB product updated, the non-PLUB ASIN ignored');
    eq(s.sfSold.B0CHKMINI1.u30,31,'30 days from the mini run');eq(s.sfSold.B0CHKMINI1.u7,6,'7 days from the mini run');
    eq(s.sfSold.B0CHKMINI1.u14,0,'a known 0 for 14 days is kept as 0');
    eq(s.sfSold.B0CHKMINI1.p30,22,'the month before is kept from Thursday’s full run');
    eq(s.sfSold.B0CHKMINI1.at,run.at,'stamped with the mini run’s time');
    eq(s.sfLastSold.B0CHKMINI1,'2026-11-06','a newer last sale moves forward');
    eq(s.sfLastSold.B0CHKMINI2,'2026-11-06','an older last sale never moves it back');
    eq(s.atAmz.B0CHKMINI1,7,'stock at Amazon is never touched');
    eq(s.sfQ4&&s.sfQ4.by.B0CHKMINI1,88,'Q4 so far comes through');
    eq(into(s,run,'2026-11-05T20:09:00Z',by),null,'applied once — the same row again does nothing');
    s=mk();eq(into(s,run,'2026-11-07T20:09:00Z',by),null,'a full run newer than the mini run wins');eq(s.sfSold.B0CHKMINI1.u30,30,'…and its figures stay');
    s=mk();eq(into(s,Object.assign({},run,{summary:{lastSold:{}}}),null,by),null,'a row without kind "sales" is not a mini run');
    eq(SF_SLOT_DAYS.join(),'0,2,4','the full check stays Sun / Tue / Thu');
  };

  /* 147 · b664: both admin pages open newest first */
  S['b664: Jack’s and Sarah’s pages open sorted newest first']=async()=>{
    const src=x=>{const r=new XMLHttpRequest();r.open('GET',x+'?'+Date.now(),false);r.send();return r.responseText;};
    const co=src('/js/closeoff.js');
    ok(/let _tfuSort='days',_tfuDir=-1,/.test(co),'Sarah’s page starts on the age sort, newest first');
    ok(/_jkSort='newest'/.test(co),'Jack’s page starts newest first');
    const keep=[_tfuSort,_tfuDir];
    try{tfuSort('newest');eq(_tfuSort+'/'+_tfuDir,'days/-1','“Sort: newest first” is the same setting the page now opens on');}
    finally{_tfuSort=keep[0];_tfuDir=keep[1];}
    const ja=src('/js/jack-admin.js');
    ok(/case 'newest':\{[^}]*Date\.parse\(a\.at/.test(ja),'same-day items on Jack’s page go by the exact time');
  };

  /* 148 · b665: a failed save leaves nothing behind; a change made in place is really sent */
  S['b665: saves — in-place changes are sent, a failed press is put back, jobs and messages only after a save']=async()=>{
    const keepSave=window.saveRow,keepWh=window.fireWebhook,keepVa=window.addVaActions,keepAud=window.logAudit;
    let hooks=0,jobs=0,auds=[];
    const fail=async r=>{r._dirty=false;return false;},okSave=async r=>{_setBase(r);setTimeout(()=>{r._dirty=false;},0);return true;};
    const mk=(o)=>{const r=mkRow(Object.assign({asin:'B0CHK665AA',sku:'CHK_665_'+(Math.random()*1e6|0),exp:10,rcvd:7},o||{}));
      r.uuid=r.uuid||('00000000-0000-4000-8000-'+String(Date.now()%1e12).padStart(12,'0'));return r;};
    try{
      window.fireWebhook=()=>{hooks++;};window.addVaActions=async()=>{jobs++;};window.logAudit=(a)=>{auds.push(a);};
      /* 1 — the last-saved copy is a real copy: an in-place change is a difference */
      let r=mk();r.resolution={state:'proposed',kind:'ops',what:'cancelled',chase:{log:[{what:'a'}]}};_setBase(r);
      ok(r._base.resolution!==r.resolution,'the last-saved copy is its own object');
      eq(Object.keys(_rowDiff(r)).length,0,'a fresh copy reads as no change');
      r.resolution.state='approved';ok('resolution' in _rowDiff(r),'an approval made in place is now sent');
      r.resolution.state='proposed';r.resolution.chase.log.push({what:'b'});ok('resolution' in _rowDiff(r),'a chase-log line added in place is now sent');
      r.resolution.chase.log.pop();r.resolution.x=undefined;eq(Object.keys(_rowDiff(r)).length,0,'a key holding undefined is not a change (jsonb never stores it)');
      /* 2 — _rowBackToSaved puts the stored columns back, the working fields stay */
      r=mk();r.resolution={state:'working',chase:{step:'contact',log:[]}};r.cancelledQty=0;_setBase(r);
      r.cancelledQty=3;r.expectedDelivery='2026-12-01';r.resolution.chase.log.push({what:'x'});r._keep='mine';
      ok(_rowBackToSaved(r),'something was put back');
      eq(r.cancelledQty,0,'units back');eq(r.expectedDelivery||'',(dbToRow(Object.assign({},r._base,{id:r.uuid})).expectedDelivery)||'','date back');
      eq(r.resolution.chase.log.length,0,'the log line is gone');eq(r._keep,'mine','this laptop’s own working field is left alone');
      eq(Object.keys(_rowDiff(r)).length,0,'nothing left to ride along with the next save');
      /* …also when another laptop’s change swapped the object in rows[] during the save */
      r=mk();r.cancelledQty=0;_setBase(r);const twin=Object.assign(Object.create(Object.getPrototypeOf(r)),r);_setBase(twin,r._base);
      const ix=rows.indexOf(r);rows[ix]=twin;twin.cancelledQty=4;r.cancelledQty=4;_rowBackToSaved(r);
      eq(twin.cancelledQty,0,'the copy on screen is put back too');rows[ix]=r;
      /* 3 — Amazon missing sorted: fail, then press again — the units go off ONCE */
      window.saveRow=fail;
      r=mk({exp:10,rcvd:7});r.cancelledQty=0;r.resolution={state:'asked',kind:'check',what:'amz-missing',at:new Date().toISOString(),chase:{path:'never-arrived',log:[]}};_setBase(r);
      await amzMissingDone(r.uuid,'in');
      eq(parseInt(r.cancelledQty)||0,0,'a failed press leaves nothing cancelled');eq(r.resolution.state,'asked','…and the case still open');
      window.saveRow=okSave;await amzMissingDone(r.uuid,'in');
      eq(parseInt(r.cancelledQty)||0,3,'pressing again cancels the 3 once, not 6');eq(r.resolution.state,'approved','…and closes it');
      /* 4 — a case date that did not save is not left on the row */
      window.saveRow=fail;r=mk();r.resolution={state:'working',chase:{path:'never-arrived',step:'waiting',log:[]}};const ed0=r.expectedDelivery||'';_setBase(r);
      if(typeof caseDate==='function'){try{await caseDate(r.uuid,'2026-12-24');}catch(e){}
        eq(r.expectedDelivery||'',ed0,'the replacement date is not left on the row');eq((r.resolution.chase.log||[]).length,0,'no log line left');}
      /* 5 — Jack’s Approve: on a failed save no jobs, no message, no audit line; on a good one all three */
      window.saveRow=fail;hooks=0;jobs=0;auds=[];
      r=mk({exp:5,rcvd:3});r.resolution={state:'proposed',kind:'ops',what:'cancelled',by:'Sarah',at:new Date().toISOString(),followUps:['Update Purchase Sheet']};_setBase(r);
      await approveResolution(r.uuid);
      eq(r.resolution.state,'proposed','a failed approve leaves it proposed');eq(jobs,0,'no jobs');eq(hooks,0,'no message to Discord');
      ok(!auds.includes('Closure approved'),'no audit line');
      window.saveRow=okSave;await approveResolution(r.uuid);
      eq(r.resolution.state,'approved','approved once it saves');ok(jobs>0,'Sarah’s follow-up job made after the save');eq(hooks,1,'one message');
      /* 6 — bulk loops count what really saved (the Put-right loop, through _saveOk) */
      window.saveRow=fail;r=mk();_setBase(r);r.transitAction='Late — Needs Chasing';
      eq(await _saveOk(r),false,'_saveOk reports the failure');eq(r.transitAction||'',(dbToRow(Object.assign({},r._base,{id:r.uuid})).transitAction)||'','…and has put the row back');
      /* 7 — moving lines: a row that did not save is not moved */
      if(typeof moveShipLines==='function'){window.saveRow=fail;
        r=mk({ship:2});r.shipSegments=[{shipId:'FBA15CHK665A',units:2,date:'2026-11-01',type:'Standard'}];r.allShipIds=['FBA15CHK665A'];r.shipId='FBA15CHK665A';_setBase(r);
        const n=await moveShipLines([{kind:'oa',row:r,from:'FBA15CHK665A'}],'FBA15CHK665A','FBA15CHK665B',{noUndo:true});
        eq(n,0,'nothing counted as moved');eq(r.shipSegments[0].shipId,'FBA15CHK665A','the line stays on its shipment');}
      /* 8 — a duplicate on sheet_sync_id is another laptop's row, not our own retry */
      ok(/sheet_sync_id/i.test('duplicate key value violates unique constraint "prep_rows_sheet_sync_id_key"'),'the clash names the sheet line');
      const src=(x=>{const q=new XMLHttpRequest();q.open('GET',x+'?'+Date.now(),false);q.send();return q.responseText;})('/js/db.js');
      ok(/_isDupKeyErr\(res\.error\)&&r\._minted&&!\/sheet_sync_id\/i/.test(src),'only a clash on our own id counts as our earlier insert');
    }finally{window.saveRow=keepSave;window.fireWebhook=keepWh;window.addVaActions=keepVa;window.logAudit=keepAud;try{renderAdmin();renderJack();renderPrep();}catch(e){}}
  };

  /* 149 · b665, the second review: a newer case on another laptop wins, overlapping saves, a landed insert still saves */
  S['b665 review: another laptop’s newer case wins, overlapping saves settle first, a landed insert still saves']=async()=>{
    const keepFrom=sb.from,keepNow=window._saveRowNow;
    const src=x=>{const q=new XMLHttpRequest();q.open('GET',x+'?'+Date.now(),false);q.send();return q.responseText;};
    try{
      /* 1 — another laptop changed the case: ours is not sent, theirs is taken */
      let r=mkRow({asin:'B0CHK665BB',sku:'CHK_665_RV1',exp:4,rcvd:2});r.resolution={state:'proposed',kind:'ops',what:'cancelled'};_setBase(r);
      r.resolution.state='approved';
      let updated=0;const theirs={state:'rejected',kind:'ops',what:'cancelled',rejectNote:'Jack: escalate'};
      sb.from=function(t){if(t!=='prep_rows')return keepFrom.apply(sb,arguments);
        return{select:()=>({eq:()=>({maybeSingle:async()=>({data:{resolution:theirs},error:null})})}),
               update:()=>{updated++;return{eq:()=>({select:async()=>({data:[{id:r.uuid}],error:null})})};}};};
      const ok1=await window.saveRow(r);
      eq(ok1,false,'the save stops');eq(updated,0,'our old case record is never sent');
      eq(r.resolution.state,'rejected','the other laptop’s newer case is taken');ok(!('resolution' in _rowDiff(r)),'…and no case record is left waiting to go');
      /* …and when nobody else changed it, it goes as normal */
      r.resolution=Object.assign({},r.resolution,{state:'approved'});
      sb.from=function(t){if(t!=='prep_rows')return keepFrom.apply(sb,arguments);
        return{select:()=>({eq:()=>({maybeSingle:async()=>({data:{resolution:theirs},error:null})})}),
               update:(d)=>{updated++;return{eq:()=>({select:async()=>({data:[{id:r.uuid}],error:null})})};}};};
      const ok2=await window.saveRow(r);eq(ok2,true,'an unchanged case saves');eq(updated,1,'…once');
      sb.from=keepFrom;
      /* 2 — two saves of one row at once: a failed one waits, and keeps what the other one landed */
      r=mkRow({asin:'B0CHK665BB',sku:'CHK_665_RV2',exp:4,rcvd:2});r.cancelledQty=0;_setBase(r);r.cancelledQty=2;
      let rel=null;
      window._saveRowNow=async x=>{if(!rel)return await new Promise(res=>{rel=()=>{_setBase(x);res(true);};});return false;};
      const p2=window.saveRow(r);
      let threw=false;const p1=_mustSave(r).catch(()=>{threw=true;});
      await wait(30);eq(r.cancelledQty,2,'nothing is put back while the other save is still running');
      rel();await p2;await p1;
      ok(threw,'the failed press still reports it');eq(r.cancelledQty,2,'what the other save landed stays on screen');
      eq(Object.keys(_rowDiff(r)).length,0,'screen and database agree');
      window._saveRowNow=keepNow;
      /* 3 — the rest, by what the code now does */
      const db=src('/js/db.js'),ss=src('/js/sheet-sync.js'),aq=src('/js/admin-queue.js'),co=src('/js/closeoff.js'),sf=src('/js/sfcheck.js');
      ok(/delete chunk\[i\]\._minted/.test(ss),'a row the sync batch-inserted is no longer “new”');
      ok(/delete r\._minted;[\s\S]{0,400}return await _saveRowNow\(r\);/.test(db),'an insert that had landed still sends what changed since');
      {const f=(aq.split('function jackAmzDate(')[1]||'').split(/\n(?:async )?function /)[0];ok(f&&!/setDueDate\(/.test(f)&&/r\.expectedDelivery=v;/.test(f),'Jack’s Amazon date goes in the same write as his answer');}
      ok(/const _had=claims\.find/.test(aq),'a second “nothing more coming” press does not raise a second claim');
      ok(/existing\.qtyFix=Object\.assign\(\{\},existing\.qtyFix,\{sheetDone:true\}\);changed=true;/.test(ss),'the “sheet corrected” mark is saved on purpose');
      ok(/SRT_DRAFTS\[String\(rid\)\]=_d;[\s\S]{0,120}closeSorted\(\);/.test(co),'Sarah’s answers are kept before the popup closes');
      ok(/importedFrom==='SellerFuse check'\)\)\{_syncExcluded\.splice/.test(sf),'a leftover exclusion on a put-back order is lifted');
      eq(_canon([1,undefined]),_canon(JSON.parse(JSON.stringify([1,undefined]))),'an undefined array item matches what JSON stores');
    }finally{sb.from=keepFrom;window._saveRowNow=keepNow;}
  };

  /* 150 · b666: a line put first for shared parts */
  S['b666: a line put first — the Christmas Eve Box gets the reindeer parts before Reindeer Food']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    /* the Action centre */
    const C={s:{id:'s',name:'Seeds'},o:{id:'o',name:'Oats'},k:{id:'k',name:'Key'}};
    const share=(have,rows,hold)=>LV3.shareParts(rows,{have:c=>have[c.id],comp:id=>C[id],floor:r=>r._fl,hold});
    const mk=(id,rec,ads,pd,fl,rc)=>({p:{id,name:'CHECK '+id,type:'bundle',recipe:rc},rec,ads,protDays:pd,_fl:fl});
    const RF=()=>mk('rf',300,10,5,100,[{c:'s',q:2},{c:'o',q:2}]),BX=()=>mk('bx',50,2,40,20,[{c:'s',q:1},{c:'k',q:1}]);
    const HAVE={s:435,o:585,k:480},sig=a=>JSON.stringify(a.map(r=>[r.alloc,r.buildCap,r.lim&&r.lim.id,r.limTakers||null,r.limHeld||null]));
    let a=RF(),b=BX();share(HAVE,[a,b]);const before=sig([a,b]);
    a=RF();b=BX();share(HAVE,[a,b],[]);eq(sig([a,b]),before,'nothing put first: the Action centre shares the parts exactly as before');
    a=RF();b=BX();share(HAVE,[a,b],[{p:b.p,need:470}]);
    eq(b.alloc,50,'the box takes its own send first (50)');
    eq(a.alloc,0,'Reindeer Food gets none of the seeds — all 435 are the box’s');
    eq(b.buildCap,435,'the box can build all its held seeds make (435)');
    eq(JSON.stringify(a.limHeld),JSON.stringify(['CHECK bx']),'Reindeer Food says the seeds are kept for the box');
    a=RF();share(HAVE,[a],[{p:BX().p,need:470}]);
    eq(a.alloc,0,'the box needs no send today: its seeds are still kept for it');
    a=RF();share(HAVE,[a],[{p:BX().p,need:35}]);
    eq(a.alloc,200,'only what the box still needs is held — Reindeer Food gets (435 − 35) ÷ 2 = 200');
    a=RF();share(HAVE,[a],[{p:BX().p,need:0}]);
    eq(a.alloc,217,'a line that has hit its target holds nothing (217 as before)');
    /* the Q4 page queue */
    const P=[{id:'chk666-rf',name:'CHECK RF',asin:'BCHK666RF1',type:'bundle',recipe:[{c:'chk666-s',q:2}]},
             {id:'chk666-bx',name:'CHECK BOX',asin:'BCHK666BX1',type:'bundle',recipe:[{c:'chk666-s',q:1}]}];
    const comps=[{id:'chk666-s',name:'CHECK seeds',layers:[]}];
    const q=first=>{const R=LV3.q4Calc({products:P,components:comps,purchases:[],shipments:[],owed:{},targets:{'chk666-rf':1000,'chk666-bx':500},
      over:5,protDays:p=>p.id==='chk666-rf'?5:null,onHand:()=>435,onOrder:()=>0,first});
      return [R.bundles.find(r=>r.id==='chk666-rf'),R.bundles.find(r=>r.id==='chk666-bx')];};
    let [ra,rb]=q({});
    ok(ra.order<rb.order&&ra.left===217&&rb.left===1&&!rb.first,'nothing put first: Reindeer Food leads the Q4 queue (217 and 1)');
    [ra,rb]=q({'chk666-bx':'2026-11-07'});
    ok(rb.order<ra.order&&rb.left===435&&ra.left===0&&rb.first===true,'the box put first: it leads and gets all 435 seeds ('+rb.left+' / '+ra.left+')');
    /* real data: the pre-fill, the hold, the save */
    const D=LV3.__D(),box=D.products.find(p=>!p.archived&&String(p.asin||'').toUpperCase()==='B0HQ6VX412');
    if(box){
      const keepS=JSON.stringify(D.settings),keepB=LV3.__prefsBase(),logN=D.log.length;
      const own=Object.prototype.hasOwnProperty.call(sb,'from'),orig=sb.from;let wrote=null;
      try{
        delete D.settings.q4First;
        ok(LV3.q4FirstMap().map[box.id]&&!LV3.q4FirstMap().saved,'nothing saved yet: the Christmas Eve Box goes first');
        const t=+((D.settings.q4Targets||{})[box.id]);
        if(t>0){const h=LV3.q4Holds().find(x=>x.p.id===box.id);
          ok(h&&h.need===Math.max(0,t-LV3.q4SentOf(box.asin)),'the Action centre holds parts for target − sent ('+(h&&h.need)+')');
          const rb2=LV3.q4Calc().bundles.find(r=>r.id===String(box.id));ok(rb2&&rb2.first&&rb2.order===1,'on the Q4 page it is first in the queue');}
        sb.from=t2=>{const qq={select:()=>qq,eq:()=>qq,in:()=>qq,maybeSingle:()=>Promise.resolve({data:{value:keepS},error:null}),
          upsert:v=>{wrote=JSON.parse(v.value);return Promise.resolve({error:null});}};return qq;};
        LV3.__setPrefsBase(JSON.parse(keepS));
        ok(await LV3.q4SetFirst(box.id,false),'unticking saves');
        ok(wrote&&wrote.q4First&&!(box.id in wrote.q4First),'lavarion_prefs gets q4First without the box');
        ok(!LV3.q4Holds().some(x=>x.p.id===box.id),'unticked: nothing is held for it');
        await LV3.q4SetFirst(box.id,true);
        ok(wrote&&wrote.q4First&&wrote.q4First[box.id],'ticked again: it is saved back');
        /* the Products table's In stock 30d column */
        const was=(document.querySelector('.page.active')||{}).id||'';
        try{goPage('lavarion');LV3.go('products');await wait(400);
          const pg=document.querySelector('#page-lavarion');ok(pg&&/In stock 30d/i.test(pg.innerText)&&/\/ 30/.test(pg.innerText),'the Products table shows In stock 30d (“N / 30”)');
        }finally{if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
      }finally{if(own)sb.from=orig;else delete sb.from;Object.keys(D.settings).forEach(k=>delete D.settings[k]);Object.assign(D.settings,JSON.parse(keepS));
        LV3.__setPrefsBase(keepB);D.log.splice(0,D.log.length-logN);}
    }
  };

  /* 151 · b667: the new order of steps — Jack's "delivered" opens the check, twins first, squared early, Sarah's one
     tick, Becki for exactly how many, Not here to his claim with the evidence, not delivered yet parks, bring them over */
  S['b667: the new order of steps — Jack first, twins first, squared early, one tick, Becki’s count, the claim, parked']=async()=>{
    const keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS,was=(document.querySelector('.page.active')||{}).id||'',keepPull=window._ocPullable;
    try{
      window._ocPullable=()=>keepPull().filter(r=>r._chk);   /* b668: never pull the real rows over, even in test mode */
      window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);};
      const kk=()=>String(++_n).padStart(7,'0').slice(-7);
      const askJ=()=>({state:'asked',kind:'check',what:'jack-check',ask:'Check whether this order actually arrived',by:'Sarah',at:iso(),
        chase:{path:'never-arrived',step:'to-jack',due:'',log:[{at:iso(),by:'Sarah',what:'Sent to Jack — Check whether this order actually arrived'}]}});
      const jk=()=>({state:'rejected',kind:'check',what:'jack-check',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',by:'Sarah',at:iso()});
      /* 1 · his "delivered" opens the card; its own order is pre-ticked; the twin leads */
      const A='B0CHK67A'+(++_n),k=kk();
      const s=mkRow({asin:A,sku:'Amuk_149.96_26096_255_THC3_'+k,prod:'CHECK ROW twin',date:dm(30),oid:'203-'+k+'-0000001',acct:'Biz 03 - WM',exp:1,rcvd:0,resolution:askJ()});
      const tw=mkRow({asin:A,sku:'Amuk_149.96_26096_255_THC1_'+k,prod:'CHECK ROW twin',date:dm(30),oid:'203-'+k+'-0000002',acct:'Biz 03 - WM',exp:1,rcvd:1,ship:1});
      const o1=mkRow({asin:A,sku:'Amuk_139.99_20096_255_THC_'+k,prod:'CHECK ROW twin',date:dm(36),oid:'204-'+k+'-0000003',acct:'Biz 01',exp:1,rcvd:1,ship:1});
      const o2=mkRow({asin:A,sku:'Amuk_149.96_26096_255_THC2_'+k,prod:'CHECK ROW twin',date:dm(30),oid:'205-'+k+'-0000004',acct:'Biz 04',exp:1,rcvd:1,ship:1});
      who('Jack');await ocStartFromJack(s.uuid);
      ok(_ocAsked(s)&&_ocOrigin(s)==='jack','his “delivered” opens the order check, as his own (nobody has searched)');
      eq(s.delivered,'Yes','his answer is recorded as always');
      ok(((s.resolution.chase||{}).log||[]).some(l=>/Arrived — YES/.test(l.what||'')),'his answer is in the case log');
      let P=_ocPlan(A);
      eq((P.orders.find(o=>o.oid===s.oid).ans||{}).a,'d','its own order is pre-ticked Delivered');
      const am=P.orders.filter(o=>o.amz);
      ok(am[0]&&am[0].acct==='Biz 03 - WM'&&am.find(o=>o.oid===tw.oid).twin,'the twin (same day, same price) is marked, and its account leads');
      ok(!am.find(o=>o.oid===o1.oid).twin,'a different price or day is not a twin');
      ok(am.find(o=>o.oid===o2.oid).twin,'same day and price on another account is a twin too');
      ok(!P.ready,'nothing answered yet: not ready');
      /* 2 · squared early — the twin cancelled covers it; the rest don't need ticking */
      await ocAns(A,tw.oid,'c');P=_ocPlan(A);
      ok(P.ready&&P.squared&&!P.all&&P.M===0,'one tick squares it — ready, though 2 orders are not ticked');
      goPage('jack');renderJack();await wait(150);
      {const c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));
        ok(c&&!c.querySelector('.ocGo[disabled]')&&/squared/i.test(c.textContent),'his card: Send is on, and it says squared');
        ok(c&&/likely twin/.test(c.textContent)&&/Not needed/.test(c.textContent),'the twin is labelled, the untouched orders say not needed');
        ok(c&&c.querySelector('.ocLine'),'the 60-day line is on top');}
      await ocSend(A);
      eq(s.resolution.state,'rejected','to Sarah');ok(s.resolution.bookedAs&&s.resolution.bookedAs.srcs[0].oid===tw.oid&&s.resolution.bookedAs.srcs[0].sku===tw.sku,'booked in as the twin — its order and SKU');
      ok(onSarahActive(s),'on Sarah’s list');ok(!_isAmzDel(s),'not on Becki’s shelf check');
      ok(_ocProofSku(s,tw.sku)&&!_ocProofSku(s,o1.sku),'the close-off takes the twin’s SKU as proven — and only that one');
      eq(s.resolution.ordChk.done.squared,true,'the history says it squared early');
      /* Sarah's one tick: the wrong-SKU close, filled in, its SKU check satisfied */
      who('Sarah');srtBookedAs(s.uuid);await wait(60);
      {const inp=document.getElementById('srtSku');eq(inp&&inp.value,tw.sku,'the close-off opens with the twin’s SKU');
        ok(window._srtSkuCheck&&!window._srtSkuCheck.short,'its “did that SKU send more?” check is satisfied by Jack’s order check');
        ok(/Jack’s order check/.test((document.getElementById('srtNote')||{}).value||''),'the note says why');}
      try{closeSorted();}catch(e){}
      /* 3 · really missing on his own check → Becki for exactly how many; Not here → his claim with the evidence */
      const B='B0CHK67B'+(++_n),k2=kk();
      const b1=mkRow({asin:B,prod:'CHECK ROW becki',date:dm(20),oid:'306-'+k2+'-0000001',acct:'EU 01',sup:'Amazon Germany',exp:5,rcvd:0,resolution:askJ()});
      const b2=mkRow({asin:B,prod:'CHECK ROW becki',date:dm(20),oid:'302-'+k2+'-0000002',acct:'EU 03',sup:'Amazon Germany',exp:5,rcvd:5,ship:5});
      who('Jack');await ocStartFromJack(b1.uuid);await ocAllDel(B);P=_ocPlan(B);eq(P.M,5,'all delivered: 5 really missing');
      await ocSend(B);
      ok(!_ocAsked(b1)&&!_isAmzDel(b1)&&b1.resolution.ocBecki&&b1.resolution.ocBecki.need===5&&onSarahActive(b1),'b674: to Sarah first — 5 really missing, not on Becki’s list yet');
      ok(!_ocPullable().includes(b1),'with Sarah and his finding: never offered to bring back');
      {const g=_ocSends().find(x=>x.A===B);ok(g&&g.ok,'his Send can be undone while it is with Sarah');}
      who('Sarah');await ocSarahToBecki(b1.uuid);who('Jack');
      ok(!_ocAsked(b1)&&_isAmzDel(b1)&&b1.resolution.amzDelivered.how==='order-check'&&b1.resolution.amzDelivered.need===5,'Sarah sends it: Becki’s shelf check, for exactly 5');
      ok(!onJack(b1),'off his list while she looks');
      ok(!_ocPullable().includes(b1),'already checked by him: never offered to bring back');
      /* b668: and if it ever comes back (b667's button did, 15:44), his answers are remembered */
      {const keepR=JSON.stringify(b1.resolution);_ocIntoJack(b1,'Jack',iso(),'becki-queue',true);P=_ocPlan(B);
        ok(P.orders.filter(o=>o.amz).every(o=>o.ans&&o.ans.a==='d')&&P.ready,'back on his card with every earlier answer ticked — ready to Send');
        b1.resolution=JSON.parse(keepR);}
      {const g=_ocSends().find(x=>x.A===B);ok(g&&!g.ok,'b674: once Sarah has sent it on to Becki, his Send is never undone under her');}
      who('Becki');await amzNotHere(b1.uuid);
      eq(b1.resolution.what,'amz-missing','Not here → straight to his claim');eq(_amzClaimUnits(b1),5,'claiming the 5');
      {const f=_ocClaimFacts(b1);ok(/Every order of it checked/.test(f)&&/not here/.test(f),'the claim card shows how it is missing');
        const m=_ocClaimMsg(b1);ok(m.includes(b1.oid)&&/refund the 5 missing units/.test(m),'the message for Amazon names the order and the 5');}
      who('Jack');goPage('jack');renderJack();await wait(150);
      {const c=[...document.querySelectorAll('#jackWrap .jkCard')].find(x=>x.textContent.includes(b1.sku));
        ok(c&&/Copy message for Amazon/.test(c.textContent)&&/Every order of it checked/.test(c.textContent),'his claim card has the evidence and the copy button');}
      /* b668: his "delivered" answers still with Sarah come over too */
      {const k6=kk(),F='B0CHK68F'+(++_n);const f1=mkRow({asin:F,prod:'CHECK ROW with sarah',date:dm(15),oid:'202-'+k6+'-0000001',acct:'Biz 01',exp:2,rcvd:0,resolution:jk()});
        ok(_ocPullable().includes(f1),'his “delivered” answer waiting with Sarah can be brought over');
        await ocBringBack(null);await ocBringBack(null);ok(_ocAsked(f1)&&_ocOrigin(f1)==='jack','and comes over as his own check, without going via Becki');
        const f2=mkRow({asin:F,prod:'CHECK ROW cancelled',date:dm(15),oid:'202-'+k6+'-0000002',acct:'Biz 01',exp:2,rcvd:0,resolution:Object.assign(jk(),{rejectNote:'Amazon cancelled or refunded the order',meant:'cancelled'})});
        ok(!_ocPullable().includes(f2),'a cancelled answer is not brought over');}
      /* 4 · the twin not delivered yet → this order waits on Amazon's date; Undo puts it back */
      const C='B0CHK67C'+(++_n),k3=kk(),eta=ukAddDays(todayISO(),7);
      const c1=mkRow({asin:C,sku:'Amuk_18.99_06106_0_Repl1_'+k3,prod:'CHECK ROW park',date:dm(25),oid:'203-'+k3+'-0000001',acct:'Biz 03 - WM',exp:4,rcvd:0,resolution:askJ()});
      const c2=mkRow({asin:C,sku:'Amuk_18.99_06106_0_Repl_'+k3,prod:'CHECK ROW park',date:dm(25),oid:'204-'+k3+'-0000002',acct:'Biz 01',exp:4,rcvd:4,ship:4});
      await ocStartFromJack(c1.uuid);await ocAns(C,c2.oid,'n');P=_ocPlan(C);
      ok(P.etaMissing&&!P.ready,'“not delivered yet” needs Amazon’s date first');
      await ocEta(C,c2.oid,eta);P=_ocPlan(C);ok(P.ready&&P.rows[0].route==='park','with the date: it squares, and this order waits');
      const edWas=c1.expectedDelivery||'';
      await ocSend(C);
      eq(c1.resolution.what,'in-transit','parked');eq(String(c1.expectedDelivery).slice(0,10),eta,'on Amazon’s date for the twin');
      ok(/book the next one in here/.test(c1.resolution.rejectNote||''),'it says what happens next');
      {const g=_ocSends().find(x=>x.A===C);ok(g&&g.ok,'undoable');await ocUndoSend(C,g.at);
        ok(_ocAsked(c1)&&(c1.expectedDelivery||'')===edWas,'Undo: back on his card, the date taken off');}
      /* 5 · bring Becki's over — press twice; his earlier "delivered" is the tick */
      const D2='B0CHK67D'+(++_n),k4=kk();
      const d1=mkRow({asin:D2,prod:'CHECK ROW pull',date:dm(15),oid:'202-'+k4+'-0000001',acct:'Biz 02',exp:3,rcvd:0,resolution:jk()});
      who('Sarah');await amzToBecki(d1.uuid);ok(_ocPullable().includes(d1),'on Becki’s shelf check: can be brought over');
      who('Jack');await ocBringBack(null);ok(!_ocAsked(d1),'one press only arms it');
      await ocBringBack(null);ok(_ocAsked(d1)&&_ocOrigin(d1)==='jack','the second press brings it over, as his own check');
      eq((_ocPlan(D2).orders.find(o=>o.oid===d1.oid).ans||{}).a,'d','his earlier “delivered” is the tick on its own order');
      /* 6 · Becki's own ask still works exactly as before */
      const E='B0CHK67E'+(++_n),k5=kk();
      const e1=mkRow({asin:E,prod:'CHECK ROW old',date:dm(12),oid:'202-'+k5+'-0000001',acct:'Biz 01',exp:1,rcvd:0,resolution:jk()});
      who('Sarah');await amzToBecki(e1.uuid);who('Becki');await ocAsk(e1.uuid);ok(_ocOrigin(e1)==='becki','her ask is hers');
      who('Jack');await ocAllDel(E);await ocSend(E);eq(e1.resolution.what,'amz-missing','she already looked: really missing goes straight to his claim, as before');
    }finally{window._ocPullable=keepPull;window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;try{closeSorted();}catch(e){}try{renderJack();}catch(e){}if(was)try{goPage(was.replace(/^page-/,''));}catch(e){}}
  };

  /* 152 · b668: an old stuck order brings the orders placed alongside it; the never-delivered claim message */
  S['b668: an old stuck order brings the orders placed with it; a never-delivered claim says so']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS;
    try{
      window._saveAsinChecks=async(A,v)=>{const m=Object.assign({},ASIN_CHECKS);if(v)m[A]=v;else delete m[A];ASIN_CHECKS=m;return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);};
      const k=String(++_n).padStart(7,'0').slice(-7),A='B0CHK68A'+(++_n);
      const jk=()=>({state:'rejected',kind:'check',what:'jack-check',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',by:'Sarah',at:iso()});
      const s=mkRow({asin:A,prod:'CHECK ROW old',date:dm(65),oid:'202-'+k+'-0000001',acct:'Biz 02',exp:12,rcvd:0,resolution:jk()});
      const same=mkRow({asin:A,prod:'CHECK ROW old',date:dm(65),oid:'026-'+k+'-0000002',acct:'Biz 01',exp:4,rcvd:4,ship:4});
      const before=mkRow({asin:A,prod:'CHECK ROW old',date:dm(75),oid:'026-'+k+'-0000003',acct:'Biz 01',exp:2,rcvd:2,ship:2});
      const far=mkRow({asin:A,prod:'CHECK ROW old',date:dm(90),oid:'026-'+k+'-0000004',acct:'Biz 01',exp:2,rcvd:2,ship:2});
      who('Sarah');await amzToBecki(s.uuid);who('Becki');await ocAsk(s.uuid);who('Jack');
      const P=_ocPlan(A),has=r=>P.orders.some(o=>o.oid===r.oid);
      ok(has(same),'an order placed the same day as the 65-day-old stuck one is on the card');
      ok(has(before),'and one 10 days before it');ok(!has(far),'but not one 25 days before it');
      ok(P.orders.find(o=>o.oid===same.oid).old,'it is labelled older than 60 days');
      /* "Sheet says too many": the stuck order now owes nothing → to Sarah to close, not cancelled */
      s.exp=0;const P2=_ocPlan(A);eq(P2.rows.find(x=>x.r===s).route,'none','owing nothing after a quantity fix: route none, not cancelled');ok(P2.ready,'and the card is ready');s.exp=12;
      goPage('jack');renderJack();await wait(120);
      {const c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));ok(c&&/The sheet quantity is wrong/.test(c.textContent),'every Amazon order has “The sheet quantity is wrong…”, as on his single cards');}
      /* b668: a gated claim already in Recovery Stock shows on his page and closes with one press — nothing deleted */
      {const g=mkRow({prod:'CHECK ROW gated',oid:'203-'+k+'-0000009',exp:2,rcvd:2,status:'In Warehouse',issueType:'Gated'});
        const gc={id:'chk-g-'+k,uuid:null,prepRowId:g.uuid,date:g.date,raisedAt:todayISO(),sup:'Amazon UK',oid:g.oid,prod:g.prod,sku:g.sku,asin:g.asin,issT:'Gated',exp:2,rec:0,dif:2,cost:75,claimValue:150,cst:'Open',owner:'Jack',log:[]};
        const gi={id:'chk-rec-'+k,qty:2,source:'Gated Amazon stock',source_ref:g.oid,status:'here',archived:false,created_at:'2026-09-07T11:00:00Z'};
        claims.push(gc);REC.push(gi);
        try{ok(jackTodo().claimsQ.includes(gc),'already in Recovery Stock: it is on his page, not hidden');
          await closeGatedInRec(gc.id);eq(gc.cst,'Resolved','one press closes the claim');ok(g.archived&&/Recovery Stock/.test(g.notes||''),'and files the row, with a note — nothing deleted');
          ok(!jackTodo().claimsQ.includes(gc),'then it leaves his page');}
        finally{const i=claims.indexOf(gc);if(i>=0)claims.splice(i,1);const j=REC.indexOf(gi);if(j>=0)REC.splice(j,1);}}
      /* the claim message on "Amazon say it was never delivered" */
      const c=mkRow({prod:'CHECK ROW claim',exp:6,rcvd:0,resolution:{state:'asked',kind:'check',what:'amz-claim',ask:'x',by:'Jack',at:iso()}});
      const m=_ocClaimMsg(c);ok(/never delivered/.test(m)&&!/shows? as delivered/.test(m),'a never-delivered claim says never delivered ('+m.slice(0,80)+')');
    }finally{window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;}
  };

  /* 153 · b669: Stock needed = the Planner's own figures, summed the way the cell says */
  S['b669: Stock needed on Products is the Planner\'s want, against what you have']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const P=(LV3.__plData().az.rows||[]).filter(r=>r.want!=null&&r.ads>0&&r.landIso);ok(P.length>0,'the Planner has products to plan');
    P.forEach(r=>{const N=LV3.__needOf(r.p);ok(N&&!N.none,r.p.name+': has a figure');
      eq(N.need,N.toLand+Math.round(r.want),r.p.name+': needed = sells before a send lands + the cover it wants');
      eq(N.have,N.amz+N.inb+N.build,r.p.name+': have = at Amazon + on the way + can build');
      eq(N.short,N.need-N.have,r.p.name+': short = needed − have');
      ok(N.amz===Math.max(0,Math.round(r.sell||0))&&N.inb===(r.inb||0),r.p.name+': the same Amazon and on-the-way figures the Planner uses');});
    const off=(LV3.__plData().az.rows||[]).find(r=>r.state==='paused'||r.state==='nodata');
    if(off){const N=LV3.__needOf(off.p);ok(N&&N.none,'a product the Planner does not plan says so, with no number');}
  };

  /* 154 · b670: "wrong SKU — yes" is checked against SellerFuse */
  S['b670: Wrong SKU is checked against SellerFuse before it saves']=async()=>{
    ok(typeof sfWrongSkuDoubt==='function','the check exists');
    eq(sfWrongSkuDoubt({asin:'B000NOTREAL',sku:'NOPE'}),null,'a product with no other SKUs: says nothing');
    /* the case that started it, while it is still in the data: the twin SKUs sent only their own 2 + 2 */
    const p=rows.find(x=>x.oid==='171-5824393-5103563');
    if(p&&SFRUN&&(SFRUN.shipments||[]).some(s=>s.id==='FBA15MNT2Y47')){const d=sfWrongSkuDoubt(p);
      ok(d&&d.judged>=2&&d.spare===0,'Pro 360 171-5824393: its twin SKUs had nothing spare');}
    /* the dropdown: Cancel leaves the row as it was, and nothing is saved */
    const r=rows.find(x=>!x.archived&&x.asin&&x.wrongSku!=='Yes'&&(()=>{const d=sfWrongSkuDoubt(x);return d&&d.spare===0;})());
    if(r){const was=r.wrongSku,note=r.vaNote,oc=window.confirm;let asked=0;
      window.confirm=()=>{asked++;return false;};
      try{await setTriage(r.uuid||r.id,'wrongSku','Yes');}finally{window.confirm=oc;}
      eq(asked,1,'she is asked');eq(r.wrongSku,was,'Cancel: the row is unchanged');eq(r.vaNote,note,'Cancel: no note written');}
  };

  /* 155 · b670: Sarah can't wave a wrong SKU through — the overrides are Jack's */
  S['b670: Wrong SKU and early shipments are hard stops for anyone but Jack']=async()=>{
    ok(typeof canOverrideStock==='function'&&typeof sfShipBeforeOrder==='function','the checks exist');
    const who=window.currentUserName;
    try{
      window.currentUserName='Sarah';ok(!canOverrideStock(),'Sarah cannot override');
      const r=rows.find(x=>!x.archived&&x.asin&&x.wrongSku!=='Yes'&&(()=>{const d=sfWrongSkuDoubt(x);return d&&d.spare===0;})());
      if(r){const was=r.wrongSku,oc=window.confirm;let asked=0;window.confirm=()=>{asked++;return true;};
        try{await setTriage(r.uuid||r.id,'wrongSku','Yes');}finally{window.confirm=oc;}
        eq(asked,0,'Sarah gets no OK box to click through');eq(r.wrongSku,was,'Sarah: the row is unchanged');}
    }finally{window.currentUserName=who;}
    ok(canOverrideStock()===/^jack/i.test(String(who||'')),'Jack can override');
    /* a shipment that left before the order date */
    let seg=null;rows.some(x=>(x.shipSegments||[]).some(s=>{if(s.shipId&&s.date){seg=s;return true;}return false;}));
    if(seg){const d=String(seg.date).slice(0,10),dt=new Date(d+'T00:00:00');dt.setDate(dt.getDate()+10);
      const after={date:String(dt.getDate()).padStart(2,'0')+'/'+String(dt.getMonth()+1).padStart(2,'0')};
      if(_sfOrderISO(after)>d)ok(!!sfShipBeforeOrder(after,seg.shipId),seg.shipId+' ('+d+') is before an order placed 10 days later');
      const before={date:d.slice(8,10)+'/'+d.slice(5,7)};
      ok(!sfShipBeforeOrder(before,seg.shipId),'the same day is fine');}
    /* the case that started it: Sarah's note named FBA15M8T8MRG (28 Aug) for an order placed 7 Oct */
    if(sfShipDate('FBA15M8T8MRG'))ok(!!sfShipBeforeOrder({date:'07/10'},'FBA15M8T8MRG'),'FBA15M8T8MRG left before 7 Oct');
  };

  /* 156 · b670: escalations reach Jack pinned to the top; the Q4 weeks show what each week added */
  S['b670: an escalation is pinned to the top of Jack\'s page; weeks show what they added']=async()=>{
    const e=mkRow({exp:2,rcvd:0,resolution:asked({escalation:{why:'test: the check disagrees',by:'Sarah',at:iso()}})});
    const lw=mkRow({exp:2,rcvd:0,resolution:{state:'proposed',kind:'ops',what:'wrong-sku',looksWrong:{why:'only sent its own',by:'Sarah'},by:'Sarah',at:iso()}});
    const plain=mkRow({exp:2,rcvd:0,resolution:asked({})});
    ok(/the check disagrees/.test(_jkEscOf(e.uuid)),'an escalated question is an escalation');
    ok(!!_jkEscOf(lw.uuid),'a close-off that looks wrong is an escalation');
    eq(_jkEscOf(plain.uuid),'','an ordinary question is not');
    ok(!!_jkEscOf('oc:'+String(e.asin||'').toUpperCase())===!!e.asin,'an order-check card holding an escalated row is an escalation');
    const its=[{id:plain.uuid,n:1},{id:e.uuid,n:2,esc:true},{id:'x',n:3},{id:lw.uuid,n:4,esc:true}];
    eq(_jkEscFirst(its).map(x=>x.n).join(','),'2,4,1,3','escalations first, the chosen order kept inside each group');
    /* the weeks table: a row's own share, then the running total */
    if(window.LV3&&LV3.go){try{LV3.go('q4');}catch(_){}await wait(300);
      const c=document.querySelector('#page-lavarion .q4G td.q4Cmp');
      if(c)ok(/^\+[\d.]+%|^—/.test(c.querySelector('b').textContent)&&/total/.test(c.textContent),'a week shows +N% and the running total');}
  };

  /* 157 · b671: first targets before newer ones, every target before anyone's +5%, the buy list per ASIN with cases */
  S['b671: Q4 — oldest targets first, every target before the +5%, buy list per ASIN with cases and a full order list']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const Lr=q=>[{id:'l'+q,date:'2026-09-20',qty:q,rem:q,cost:1,arr:1,sup:'CHECK Supplier'}];
    const comps=[{id:'c671-p',name:'CHECK Shared part',caseQty:24,layers:Lr(300)},{id:'c671-q',name:'CHECK Part Q',layers:Lr(1000)},{id:'c671-r',name:'CHECK Part R',layers:Lr(1000)}];
    const B=(id,name,rec)=>({id,asin:'B0CHK671'+id.slice(-1).toUpperCase(),name,type:'bundle',recipe:rec.map(([c,q])=>({c,q})),layers:[]});
    const prods=[B('p671-a','CHECK Old target',[['c671-p',1],['c671-q',1]]),B('p671-b','CHECK New target',[['c671-p',1],['c671-r',1]]),B('p671-c','CHECK No target',[['c671-p',1]])];
    const calc=(t,ta,cs)=>LV3.q4Calc({products:prods,components:cs||comps,purchases:[],shipments:[],owed:{},over:5,targets:t,targetAt:ta,first:{},
      protDays:p=>({'p671-a':5,'p671-b':1,'p671-c':2})[p.id],today:'2026-11-09'});
    const left=R=>JSON.stringify(R.bundles.map(r=>[r.id,r.left]));
    /* the GF Snack case: the newer target is closer to running out, but the first target gets the shared part first */
    const R1=calc({'p671-a':200,'p671-b':150},{'p671-b':'2026-11-04'});
    eq(left(R1),JSON.stringify([['p671-a',200],['p671-b',100],['p671-c',0]]),'first target first (200), the newer one gets the rest (100)');
    eq(R1.bundles[1].setAt,'2026-11-04','the newer line carries the day it was set');
    const R0=calc({'p671-a':200,'p671-b':150},{});
    eq(left(R0),JSON.stringify([['p671-b',150],['p671-a',150],['p671-c',0]]),'with no dates the old order stands — closest to running out first');
    /* every target before anyone's +5% (before: the first in the queue took 105 and the second got 95) */
    const cs2=comps.map(c=>c.id==='c671-p'?Object.assign({},c,{layers:Lr(200)}):c);
    const R2=calc({'p671-a':100,'p671-b':100},{},cs2);
    eq(left(R2),JSON.stringify([['p671-b',100],['p671-a',100],['p671-c',0]]),'both reach their target — no +5% out of the other one’s target');
    const cs3=comps.map(c=>c.id==='c671-p'?Object.assign({},c,{layers:Lr(220)}):c);
    eq(left(calc({'p671-a':100,'p671-b':100},{},cs3)),JSON.stringify([['p671-b',105],['p671-a',105],['p671-c',10]]),'the spare then goes +5% each, in order, then to the rest');
    /* per ASIN: each line's own shortfall, adding up to the one list */
    eq(JSON.stringify(R1.shopBy.map(x=>[x.id,x.buy.map(b=>[b.id,b.qty,b.cq])])),JSON.stringify([['p671-a',[]],['p671-b',[['c671-p',50,24]]]]),
      'the first target needs nothing; the newer one needs 50 of the shared part (cases of 24)');
    const sum={};R1.shopBy.forEach(x=>x.buy.forEach(b=>{sum[b.id]=(sum[b.id]||0)+b.qty;}));
    eq(JSON.stringify(sum),JSON.stringify(Object.fromEntries(R1.shopAll.buy.map(b=>[b.id,b.qty]))),'per ASIN adds up to the one shopping list');
    const S=LV3.q4BuyShape(R1);
    eq(JSON.stringify(S.groups.map(g=>[g.label,g.lines.length])),JSON.stringify([['Your first targets',1],['Targets set 4 Nov',1]]),'grouped: first targets, then the day the newer one was set');
    const M=LV3.q4StaffMsg(R1);
    ok(/B0CHK671B · CHECK New target/.test(M)&&/CHECK Shared part: 50 = 3 cases of 24/.test(M),'the message: ASIN, what to buy, cases rounded up');
    ok(/CHECK Shared part: need 50 → buy 3 cases of 24 = 72 → 22 left over/.test(M),'the full order list: full cases only, and what is left over');
    ok(/FULL ORDER LIST/.test(M)&&/CHECK SUPPLIER/.test(M),'…and the full order list by supplier');
    ok(/Nothing to buy: B0CHK671A · CHECK Old target/.test(M),'…and says which need nothing');
    /* the live data: every line with a target before every one without; per ASIN adds up to the one list */
    const live=LV3.q4Calc(),ls={};(live.shopBy||[]).forEach(x=>x.buy.forEach(b=>{ls[b.id]=(ls[b.id]||0)+b.qty;}));
    ok(live.bundles.every((r,i,a)=>i===0||!(r.priority&&!a[i-1].priority)),'live: targets before the rest');
    eq(JSON.stringify(Object.keys(ls).sort().map(k=>[k,ls[k]])),JSON.stringify((live.shopAll.buy||[]).map(b=>[b.id,b.qty]).sort((a,b)=>a[0]<b[0]?-1:1)),'live: per ASIN adds up to the one list');
    /* the page: per ASIN cards, the toggle, the full order list */
    const was=(document.querySelector('.page.active')||{}).id||'';let keep=null;try{keep=localStorage.getItem('lv3.q4.buyView');}catch(e){}
    try{
      goPage('lavarion');LV3.go('q4');await wait(200);
      const pg=document.getElementById('page-lavarion'),sh=(live.shopBy||[]).filter(x=>x.buy.length);
      eq(pg.querySelectorAll('.q4Buy .q4BuyC').length,(LV3.q4BuyView()==='all'?q4BuyShapeN(live):sh.length),'one card per short ASIN (or per supplier)');
      LV3.q4BuyView('all');await wait(120);
      if(sh.length){ok(pg.querySelector('.q4Buy .q4Seg button.on').textContent==='Full order list','the toggle shows the full order list');
        eq(pg.querySelectorAll('.q4Buy .q4BuyC li').length,LV3.q4BuyShape(live).items.length,'one line per item, every ASIN added up');}
      LV3.q4BuyView('asin');await wait(120);
      if(sh.length)eq(pg.querySelectorAll('.q4Buy .q4BuyC').length,sh.length,'back to one card per short ASIN');
    }finally{try{if(keep===null)localStorage.removeItem('lv3.q4.buyView');else localStorage.setItem('lv3.q4.buyView',keep);}catch(e){}if(was)goPage(was.replace(/^page-/,''));}
    function q4BuyShapeN(R){return LV3.q4BuyShape(R).sups.length;}
  };

  /* 158 · b672 (9 Nov — Sarah's Lindt and the TCL TV): Amazon counting MORE than we sent is where the booked-in-not-sent
     ones went (fewer is never prep's); "Arrived and correct" never closes onto the same card or sends a unit already at
     Amazon to Becki's shelves; Jack's order check is the proof on the final press too */
  S['Arrived and correct says why; Amazon’s bigger count finds them; Jack’s check lets the wrong-SKU close through']=async()=>{
    const keep={run:SFRUN,t:window.toast,s:window.saveRow,v:window.addVaActions},ts=[];
    window.toast=m=>{ts.push(String(m));};window.saveRow=async()=>true;window.addVaActions=async()=>{};
    const v=id=>((document.getElementById(id)||{}).value||'');
    const shut=()=>{try{closeSorted();}catch(e){}};
    try{
      who('Sarah');
      const A=mkRow({exp:6,rcvd:6,ship:4,status:'Part Sent',sent:'No',delivered:'Yes',sentDate:'2026-10-20',
        shipSegments:[{shipId:'FBA15CHKA672',units:2,date:'2026-10-20',type:'Standard'},{shipId:'FBA15CHKB672',units:2,date:'2026-10-20',type:'Standard'}],
        allShipIds:['FBA15CHKA672','FBA15CHKB672']});
      ok(_partShipStale(A),'the fixture: some went, 2 booked in never followed');
      SFRUN={id:'chk-672',at:new Date().toISOString(),shipments:[],stock:[],sold:[],excluded:[],summary:{},
        late:[{rowId:A.uuid,sku:A.sku,kind:'shelf',own:[{id:'FBA15CHKA672',date:'2026-10-20',units:2},{id:'FBA15CHKB672',date:'2026-10-20',units:2}],asinSkus:[]}]};
      window.SFRUN=SFRUN;
      eq(sfLateFor(A).state,'clear','sent what PrepHub has — nothing found');
      SFRUN.late[0].own[0].received=1;
      eq(sfLateFor(A).state,'clear','Amazon counted FEWER than we sent — not prep’s (the claims team’s)');
      SFRUN.late[0].own[0].received=4;
      const f=sfLateFor(A);
      ok(f.state==='shipped'&&f.units===2&&f.ships[0].id==='FBA15CHKA672','Amazon counted 4 where we sent 2 — the 2 found on that box');
      ok(/Amazon counted <b>4<\/b> on <b>FBA15CHKA672<\/b> &mdash; we sent 2/.test(_tcOverLine(A.uuid,2)),'the card says it plainly');
      ok(/Fix it/.test(_tcFoundBtns(A.uuid)),'…with Fix it');
      SFRUN.summary.asinBal={since:'2026-06-01',at:'2026-11-09',by:{[A.asin]:[{id:'FBA15CHKA672',sku:A.sku,date:'2026-10-20',units:2,received:4},{id:'FBA15CHKB672',sku:A.sku,date:'2026-10-20',units:2}]}};
      const b=sfAsinBalance(A);
      ok(b&&b.extra.length===1&&b.extra[0].units===2&&b.extra[0].counted===4&&b.extra[0].sent===2,'the 60-day balance sees the 2 extra Amazon counted');
      /* the popup: opens on "Already sent" with the box filled in */
      openSorted(A.uuid);await wait(60);
      eq(v('srtWhat'),'sent-not-stamped','Sorted opens on “Already sent”');
      eq(v('srtShipId'),'FBA15CHKA672','…with the box SellerFuse found');
      srtPick('arrived-ok');srtSync();
      const tw=document.getElementById('srtTrap');
      ok(tw&&tw.style.display==='block'&&/won’t clear the card/.test(tw.textContent)&&/Amazon counted 4 on FBA15CHKA672/.test(tw.textContent),'“Arrived and correct” says it won’t clear it, and why');
      const was=JSON.stringify(A.resolution);srtAskClose();await wait(60);
      ok(ts.some(m=>/won’t clear this/.test(m)),'pressing it says so');
      eq(JSON.stringify(A.resolution),was,'…and nothing is saved');
      srtTrapUse();
      ok(v('srtWhat')==='sent-not-stamped'&&v('srtShipId')==='FBA15CHKA672','the orange box’s button puts the right one back');
      shut();
      delete SFRUN.late[0].own[0].received;
      openSorted(A.uuid);await wait(60);
      eq(v('srtWhat'),'','not found by SellerFuse — it opens on nothing, not on “Arrived and correct”');
      shut();
      const B=mkRow({exp:3,rcvd:3,ship:0,delivered:'Yes',status:'In Warehouse'});
      openSorted(B.uuid);await wait(60);
      eq(v('srtWhat'),'arrived-ok','nothing sent yet — still opens on “Arrived and correct”, as before');
      eq(_srtArrivedTrap('arrived-ok',B),null,'…and it closes as before');
      shut();
      /* the TCL TV: Jack's order check said booked in as another SKU of the product */
      const X=mkRow({exp:1,rcvd:1,ship:1,status:'Sent to Amazon',sent:'Yes',asin:'B0CHK672T'});
      const Cr=mkRow({exp:1,rcvd:0,delivered:'Yes',asin:'B0CHK672T'});
      Cr.resolution={state:'rejected',what:'jack-check',kind:'check',meant:'booked-as',at:new Date().toISOString(),by:'Jack',
        bookedAs:{at:new Date().toISOString(),by:'Jack',srcs:[{n:1,sku:X.sku,oid:X.oid,key:X.oid}]}};
      eq(_srtBaSku(Cr),X.sku,'Jack’s answer names the SKU it was booked in as');
      openSorted(Cr.uuid);await wait(80);
      ok(v('srtWhat')==='wrong-sku'&&v('srtSku')===X.sku,'Sorted opens Jack’s close: wrong SKU, with his SKU');
      srtPick('arrived-ok');srtSync();
      ok(/send it to Becki to search the shelves/.test((document.getElementById('srtTrap')||{}).textContent||''),'“Arrived and correct” says it would send it to Becki');
      const was2=JSON.stringify(Cr.resolution);srtAskClose();await wait(60);
      ok(ts.some(m=>/Jack found it went out under/.test(m))&&JSON.stringify(Cr.resolution)===was2,'…and won’t do it');
      srtTrapUse();await wait(40);
      ok(v('srtWhat')==='wrong-sku'&&v('srtSku')===X.sku,'the button puts Jack’s close back');
      for(let k=0;k<6;k++){const c=[...document.querySelectorAll('#sortedModal #srtSteps input')].find(i=>!i.checked);if(!c)break;c.click();await wait(30);}
      ts.length=0;srtSync();srtAskClose();await wait(300);
      ok(!ts.some(m=>/only sent what its own order had/.test(m)),'the final press reads Jack’s check — no “only sent what its own order had”');
      ok(Cr.resolution&&Cr.resolution.what==='wrong-sku'&&Cr.resolution.state==='approved','it closes as went out under his SKU — not a decision for Jack again');
      eq(_owedUnits(Cr),0,'nothing owed — nothing for Becki to search for');
    }finally{shut();SFRUN=keep.run;window.SFRUN=keep.run;window.toast=keep.t;window.saveRow=keep.s;window.addVaActions=keep.v;}
  };

  /* 159 · b673 (Jack, 9 Nov: "collapse this — how many due this week, the minimum — is it pro-rated?") */
  S['b673: Q4 — the buy list folds and remembers; This week’s minimum is the cards added up']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    let was=null;try{was=localStorage.getItem('lav3.q4BuyShut');localStorage.removeItem('lav3.q4BuyShut');}catch(e){}
    try{
      if(typeof goPage==='function')goPage('lavarion');await wait(300);LV3.go('q4');await wait(400);
      eq(LV3.q4BuyIsShut(),true,'with nothing saved the buy list starts folded');
      const B=document.querySelector('#page-lavarion .q4Buy');
      if(B){ok(B.classList.contains('shut'),'…and draws folded');
        LV3.q4BuyFold();ok(!B.classList.contains('shut')&&LV3.q4BuyIsShut()===false,'one press opens it and remembers');
        LV3.q4BuyFold();ok(B.classList.contains('shut')&&LV3.q4BuyIsShut()===true,'a second press folds it again');}
      else ok(true,'nothing to buy right now — no buy list to fold');
      const W=document.querySelector('#page-lavarion .q4Week');
      if(W){const num=t=>parseInt(String(t||'').replace(/[^0-9]/g,''))||0;
        const cards=[...W.querySelectorAll('.q4WC')].filter(c=>!c.querySelector('.v.ok'));
        const dueCards=[...W.querySelectorAll('.q4WC')].reduce((t,c)=>{const m=/of ([\d,]+) due/.exec(c.textContent);return t+(m?num(m[1]):0);},0);
        const v=W.querySelector('.q4WD.main .v'),tg=W.querySelector('.q4WD.left .v');
        ok(!!v,'This week opens on the minimum');
        eq(num(v&&v.textContent),dueCards,'the minimum = every card’s share added up');
        const toGo=cards.reduce((t,c)=>t+num((c.querySelector('.v b')||{}).textContent),0);
        if(toGo)eq(num(tg&&tg.textContent),toGo,'still to go = the cards’ “to go” added up');
        ok(/Pro-rated/.test(W.textContent),'it says how the share is worked out');}
      else ok(true,'no priority lines — no This week panel');
    }finally{try{if(was===null)localStorage.removeItem('lav3.q4BuyShut');else localStorage.setItem('lav3.q4BuyShut',was);}catch(e){}}
  };

  /* 160 · b674 (Jack, 10 Nov — HIGH5 "49 (PrepHub 0) seems well off"; Skullcandy "a column of how many sent") */
  S['b674: order check — SellerFuse like for like, the Sent column, a delivered order outside the check, two-SKU one tick']=async()=>{
    const keepRun=SFRUN,keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS,keepPull=window._ocPullable;
    try{
      window._ocPullable=()=>keepPull().filter(r=>r._chk);
      window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);},dI=d=>ukAddDays(todayISO(),-d);
      const k=String(++_n).padStart(7,'0').slice(-7),A='B0CHK674'+k.slice(-2);
      const askJ=()=>({state:'rejected',kind:'check',what:'jack-check',rejectNote:'Arrived — YES, the account shows it delivered.',rejectedBy:'Jack',by:'Sarah',at:iso()});
      /* the HIGH5 shape: an old order sent in two boxes (one before SellerFuse starts), one sent on one box, the stuck one,
         and a newer order delivered with nothing booked in that is not part of the check */
      const st=mkRow({asin:A,prod:'CHECK ROW sf',date:dm(40),oid:'202-'+k+'-0000001',acct:'Biz 02',exp:6,rcvd:0,resolution:{state:'asked',kind:'check',what:'jack-check',ask:'Check whether this order actually arrived',by:'Sarah',at:iso()}});
      const y1=mkRow({asin:A,sku:'Amuk_14.13_X_'+k+'_03',prod:'CHECK ROW sf',date:dm(40),oid:'026-'+k+'-0000002',acct:'Biz 01',exp:3,rcvd:3,ship:3,sent:'Yes',
        shipSegments:[{shipId:'FBA15'+k.slice(0,6)+'A',units:3,date:dI(20),type:'Standard'}],allShipIds:['FBA15'+k.slice(0,6)+'A']});
      const y2=mkRow({asin:A,sku:'Amuk_14.13_X_'+k+'_08',prod:'CHECK ROW sf',date:dm(40),oid:'202-'+k+'-0000003',acct:'EU 03',exp:8,rcvd:8,ship:8,sent:'Yes',
        shipSegments:[{shipId:'FBA15'+k.slice(0,6)+'B',units:6,date:dI(38),type:'Standard'},{shipId:'FBA15'+k.slice(0,6)+'C',units:2,date:dI(20),type:'Standard'}],allShipIds:['FBA15'+k.slice(0,6)+'B','FBA15'+k.slice(0,6)+'C']});
      const y3=mkRow({asin:A,prod:'CHECK ROW sf',date:dm(28),oid:'202-'+k+'-0000004',acct:'Biz 03 - WM',exp:8,rcvd:0});
      const ln=(id,sku,u)=>({id,sku,units:u,date:dI(20)});
      SFRUN=Object.assign({},keepRun||{at:iso()},{summary:Object.assign({},(keepRun&&keepRun.summary)||{},{asinBal:{since:dI(30),at:todayISO(),
        by:{[A]:[ln('FBA15'+k.slice(0,6)+'A',y1.sku,3),ln('FBA15'+k.slice(0,6)+'C',y2.sku,2),ln('FBA15'+k.slice(0,6)+'D','Amuk_OLD_'+k,30)]}}})});window.SFRUN=SFRUN;
      mkRow({asin:A,sku:'Amuk_OLD_'+k,prod:'CHECK ROW sf',date:dm(95),oid:'202-'+k+'-0000005',acct:'Biz 02',exp:30,rcvd:30,ship:30,sent:'Yes',archived:true,
        shipSegments:[{shipId:'FBA15'+k.slice(0,6)+'D',units:30,date:dI(20),type:'Standard'}],allShipIds:['FBA15'+k.slice(0,6)+'D']});
      who('Jack');await ocStartFromJack(st.uuid);await ocAllDel(A);
      goPage('jack');renderJack();await wait(150);
      let c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));
      ok(!!c,'the card is on Jack’s page');
      if(c){const L=c.querySelector('.ocSfL');
        ok(L&&/35 of this product went to Amazon on 3 shipments/.test(L.textContent),'SellerFuse: every unit of the product on its shipments since its start — an old order’s box included');
        ok(L&&/PrepHub has the same 35/.test(L.textContent),'…and PrepHub has the same on those shipments — like for like, not “PrepHub 0”');
        ok(!/in its 60 days/.test(c.textContent),'the old “in its 60 days (PrepHub N)” wording is gone');
        ok([...c.querySelectorAll('.ocT th')].some(th=>th.textContent==='Sent'),'a Sent column');
        const row=oid=>[...c.querySelectorAll('.ocT tbody tr')].find(tr=>tr.textContent.includes(oid));
        const r1=row(y1.oid),r2=row(y2.oid),r3=row(st.oid);
        ok(r1&&r1.querySelector('.ocSentC .ocSeg.ok'),'an order sent on one box: ✓ against SellerFuse');
        ok(r2&&r2.querySelector('.ocSentC .ocSeg.old')&&r2.querySelector('.ocSentC .ocSeg.ok'),'an order split over two boxes: the one before SellerFuse starts says so, the other is ✓');
        ok(r2&&/^8/.test(r2.querySelector('.ocSentC').textContent.trim()),'…and the column shows its total sent');
        ok(r3&&r3.querySelector('.ocSentC .ocDim0'),'the stuck order: 0 sent');
        ok(/8 more on/.test(c.textContent)&&c.textContent.includes(y3.oid),'the newer order ticked delivered with nothing booked in is named — Send doesn’t touch it');}
      /* a SellerFuse line that differs from PrepHub is red, and the line says how many went with nothing behind them */
      SFRUN.summary.asinBal.by[A][0]=ln('FBA15'+k.slice(0,6)+'A',y1.sku,4);renderJack();await wait(80);
      c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));
      if(c){const r1=[...c.querySelectorAll('.ocT tbody tr')].find(tr=>tr.textContent.includes(y1.oid));
        ok(r1&&r1.querySelector('.ocSentC .ocSeg.bad'),'SellerFuse 4, PrepHub 3 on that box: red');
        ok(/PrepHub has 35 of them — 1 went with nothing booked in/.test((c.querySelector('.ocSfL')||{}).textContent||''),'…and the SellerFuse line says 1 went with nothing booked in');}
      /* the one tick: two orders, two SKUs */
      const Z='B0CHK674Z'+k.slice(-1),kz=String(++_n).padStart(7,'0').slice(-7);
      const zs=mkRow({asin:Z,prod:'CHECK ROW two',date:dm(30),oid:'406-'+kz+'-0000001',acct:'EU 02',sup:'Amazon Spain',exp:2,rcvd:0,resolution:{state:'asked',kind:'check',what:'jack-check',ask:'Check whether this order actually arrived',by:'Sarah',at:iso()}});
      const zf=mkRow({asin:Z,sku:'Amf_72.25_X_'+kz+'_01',prod:'CHECK ROW two',date:dm(30),oid:'171-'+kz+'-0000002',acct:'EU 03',sup:'Amazon France',exp:1,rcvd:1,ship:1});
      const zd=mkRow({asin:Z,sku:'Amf_72.82_X_'+kz+'_01',prod:'CHECK ROW two',date:dm(30),oid:'302-'+kz+'-0000003',acct:'EU 03',sup:'Amazon Germany',exp:1,rcvd:1,ship:1});
      await ocStartFromJack(zs.uuid);let P=_ocPlan(Z);
      for(const o of P.orders.filter(o=>o.amz&&o.oid!==zs.oid))await ocAns(Z,o.key,'c');
      P=_ocPlan(Z);ok(P.ready&&P.M===0,'both covering orders cancelled: nothing missing');
      await ocSend(Z);
      ok(zs.resolution.bookedAs&&zs.resolution.bookedAs.srcs.length===2,'booked in as two orders');
      who('Sarah');srtBookedAs(zs.uuid);await wait(60);
      {const inp=document.getElementById('srtSku'),note=(document.getElementById('srtNote')||{}).value||'';
        ok(inp&&[zf.sku,zd.sku].includes(inp.value),'the close-off opens with one of the two SKUs');
        ok(note.includes('1 as '+zf.oid)&&note.includes('1 as '+zd.oid)&&note.includes(zf.sku)&&note.includes(zd.sku),'the note names both orders and both SKUs, with a count each');
        ok(window._srtSkuCheck&&!window._srtSkuCheck.short,'its SKU check is satisfied by Jack’s order check');}
      try{closeSorted();}catch(e){}
    }finally{SFRUN=keepRun;window.SFRUN=keepRun;window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;window._ocPullable=keepPull;who('Jack');}
  };

  /* 161 · b674 (AQUARIAN: "how many up and down … if it's not matching I need to check them all"; "go to Sarah first") */
  S['b674: delivered orders join the check, up and down, squared only when it matches; Sarah first, then Becki; job cards say what']=async()=>{
    const keepSave=window._saveAsinChecks,keepA=ASIN_CHECKS,keepPull=window._ocPullable;
    try{
      window._ocPullable=()=>keepPull().filter(r=>r._chk);
      window._saveAsinChecks=async(A,v)=>{const n=Object.assign({},ASIN_CHECKS);if(v)n[A]=v;else delete n[A];ASIN_CHECKS=n;return true;};
      const dm=d=>{const t=ukAddDays(todayISO(),-d);return t.slice(8)+'/'+t.slice(5,7);};
      const kk=()=>String(++_n).padStart(7,'0').slice(-7);
      const askJ=()=>({state:'asked',kind:'check',what:'jack-check',ask:'Check whether this order actually arrived',by:'Sarah',at:iso()});
      /* the AQUARIAN shape: stuck 96/87, one order booked over (32 ordered, 200 booked), two delivered with none booked */
      const A='B0CHK74A'+(++_n),k=kk();
      const st=mkRow({asin:A,prod:'CHECK ROW aq',date:dm(30),oid:'203-'+k+'-0000001',acct:'Biz 03 - WM',exp:96,rcvd:87,ship:87,sent:'Yes',resolution:askJ()});
      const ov=mkRow({asin:A,prod:'CHECK ROW aq',date:dm(30),oid:'203-'+k+'-0000002',acct:'Biz 03 - WM',exp:32,rcvd:200,ship:200,sent:'Yes'});
      const l1=mkRow({asin:A,prod:'CHECK ROW aq',date:dm(30),oid:'203-'+k+'-0000003',acct:'Biz 03 - WM',exp:120,rcvd:0});
      const l2=mkRow({asin:A,prod:'CHECK ROW aq',date:dm(30),oid:'203-'+k+'-0000004',acct:'Biz 03 - WM',exp:36,rcvd:0});
      const ok1=mkRow({asin:A,prod:'CHECK ROW aq',date:dm(30),oid:'204-'+k+'-0000005',acct:'Biz 01',exp:200,rcvd:200,ship:200,sent:'Yes'});
      who('Jack');await ocStartFromJack(st.uuid);
      let P=_ocPlan(A);
      ok(!P.squared,'units booked over that nothing explains yet: not squared — every order needs an answer');
      await ocAllDel(A);P=_ocPlan(A);
      eq(P.lone.length,2,'two orders ticked delivered with nothing booked in are outside the check');
      ok(!P.ready,'Send waits until they are added');
      goPage('jack');renderJack();await wait(150);
      let c=[...document.querySelectorAll('#jackWrap .ocCard')].find(x=>x.textContent.includes(A));
      ok(c&&c.querySelector('.ocJoin button'),'the card offers to add them');
      ok(c&&/Add the 2 orders above to the check first/.test((c.querySelector('.ocGo')||{}).textContent||''),'…and Send says why it waits');
      {const u=c&&c.querySelector('.ocUD');ok(u&&u.textContent.includes(ov.oid)&&/\+168/.test(u.textContent)&&/−120/.test(u.textContent)&&/−36/.test(u.textContent)&&/−9/.test(u.textContent),'up and down, order by order: +168, −120, −36, −9');
        ok(u&&/overall \+3/.test(u.textContent),'…and overall +3');}
      await ocJoin(A);P=_ocPlan(A);
      ok(_ocAsked(l1)&&_ocAsked(l2),'added: both on the check');
      ok(P.orders.filter(o=>o.amz).every(o=>o.ans&&o.ans.a==='d'),'every answer he gave is still ticked');
      ok(P.ready&&P.M===0,'now it adds up: nothing really missing');
      eq(P.extra,3,'only the real 3 extra are left over');
      ok(P.rows.every(x=>x.route==='sarah'),'all three go to Sarah — booked in as the order booked over');
      await ocSend(A);
      ok([st,l1,l2].every(x=>x.resolution.state==='rejected'&&x.resolution.bookedAs&&x.resolution.bookedAs.srcs[0].oid===ov.oid),'each: one tick for Sarah, booked in as '+ov.oid);
      ok(/3 more booked in than delivered/.test(st.resolution.rejectNote||''),'Sarah is told about the 3 extra');
      /* matching: squared early still works when nothing is left over */
      const B='B0CHK74B'+(++_n),k2=kk();
      const b1=mkRow({asin:B,prod:'CHECK ROW sq',date:dm(30),oid:'203-'+k2+'-0000001',acct:'Biz 03 - WM',exp:2,rcvd:0,resolution:askJ()});
      const b2=mkRow({asin:B,prod:'CHECK ROW sq',date:dm(30),oid:'203-'+k2+'-0000002',acct:'Biz 03 - WM',exp:2,rcvd:2,ship:2});
      mkRow({asin:B,prod:'CHECK ROW sq',date:dm(30),oid:'204-'+k2+'-0000003',acct:'Biz 01',exp:2,rcvd:2,ship:2});
      await ocStartFromJack(b1.uuid);await ocAns(B,b2.oid,'c');P=_ocPlan(B);
      ok(P.squared&&P.ready,'a cancelled twin that covers it exactly: squared early, as before');
      /* Sarah first, with a move job: Send to Becki waits for the move */
      const C='B0CHK74C'+(++_n),k3=kk();
      const c1=mkRow({asin:C,prod:'CHECK ROW mv',date:dm(30),oid:'406-'+k3+'-0000001',acct:'EU 03',sup:'Amazon Spain',exp:2,rcvd:0,resolution:askJ()});
      const c2=mkRow({asin:C,prod:'CHECK ROW mv',date:dm(30),oid:'407-'+k3+'-0000002',acct:'EU 03',sup:'Amazon Spain',exp:1,rcvd:1,ship:1});
      await ocStartFromJack(c1.uuid);await ocAns(C,c2.oid,'c');P=_ocPlan(C);
      ok(P.ready&&P.M===1&&P.rows[0].route==='missing'&&P.rows[0].moved===1,'1 under the cancelled order, 1 really missing');
      await ocSend(C);
      ok(c1.resolution.ocBecki&&c1.resolution.ocBecki.need===1&&!_isAmzDel(c1)&&onSarahActive(c1),'to Sarah with the finding — not on Becki’s list yet');
      const jobs=c1.resolution.ordChk.done.jobs||[];ok(jobs.length===1,'Sarah has the move job');
      who('Sarah');goPage('admin');renderAdmin();await wait(150);
      {const b=[...document.querySelectorAll('button')].find(x=>/Send to Becki — check the shelves for 1/.test(x.textContent));
        ok(!b||b.disabled,'her Send to Becki waits for the move job'+(b?'':' (card not drawn on this page — checked by the press below)'));}
      await ocSarahToBecki(c1.uuid);ok(!_isAmzDel(c1),'pressing it before the move does nothing');
      await doneVaActions(jobs);await ocSarahToBecki(c1.uuid);
      ok(_isAmzDel(c1)&&c1.resolution.amzDelivered.need===1&&c1.resolution.amzDelivered.how==='order-check','move done → Becki’s shelf check for exactly 1');
      {const g=_ocSends().find(x=>x.A===C);ok(g&&!g.ok,'…and once Sarah has acted, his Send can’t be undone under her');}
      /* a job card says what it is */
      const j=mkRow({asin:'B0CHK74J'+(++_n),prod:'CHECK ROW job',date:dm(10),exp:5,rcvd:5});
      if(typeof addVaActions==='function'){await addVaActions(j,['Update Purchase Sheet'],'Expected quantity corrected 400 → 96');renderAdmin();await wait(120);
        const cardTxt=[...document.querySelectorAll('.jobWhat')].map(x=>x.textContent+' '+((x.nextElementSibling||{}).textContent||'')).join(' | ');
        ok(/Update Purchase Sheet/.test(cardTxt)&&/400 → 96/.test(cardTxt),'a job card says what the job is and why, without opening it');}
    }finally{window._ocPullable=keepPull;window._saveAsinChecks=keepSave;ASIN_CHECKS=keepA;who('Jack');}
  };

  /* 162 · b675 (Becki, 11 Nov — Kingdom Coffee renumbered on the sheet, hub stock typed in by hand, the COG note rows,
     Reindeer "103 buildable", and the SellerFuse bar on a tab opened before the check landed) */
  S['b675: renumbered lines join, hand-typed stock joins, note rows aren’t bad dates, scooped parts never limit, SellerFuse bar looks again']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),TAB='Lavarion Q4',SUP='CHECK KC SUP',HUB='CHECK HUB SUP',NM='CHECK Clipper HC',NM2='CHECK Mini Marsh';
    const prodW=D.products.find(p=>!p.archived&&p.type==='bundle'&&(p.recipe||[]).length);ok(prodW,'a bundle to link to');
    const cid=prodW.recipe[0].c,C=()=>D.components.concat(D.products),cc=C().find(x=>x.id===cid);
    const d1='2026-10-01',d2='2026-10-02';
    const P=(id,date,name,qty,oid,linked,extra)=>Object.assign({id,uuid:null,tab:TAB,date,name,qty,price:0.29,sup:SUP,oid,loc:'Warehouse',arr:0,
      alloc:linked?[{to:cid,qty}]:[],acct:'',invoice:'',notes:'',spend:+(qty*0.29).toFixed(2),mismatch:0},extra||{});
    const row=(date,name,qty,oid,extra)=>Object.assign({tab:TAB,date,name,qty,price:0.29,sup:SUP,oid,acct:'',invoice:'',notes:'',sheetArr:'Confirmed',spend:+(qty*0.29).toFixed(2),mismatch:0},extra||{});
    const lay=(pid,qty)=>{(cc.layers=cc.layers||[]).push({id:'chkL-'+pid,date:d2,qty,rem:0,cost:0.29,sup:SUP,oid:'x',loc:'Warehouse',arr:1,src:'P:'+pid});};
    const keepAck=JSON.stringify(D.settings.diffAck||{});
    const clean=()=>{const A=LV3.__D().purchases;for(let i=A.length-1;i>=0;i--)if(A[i].sup===SUP||A[i].sup===HUB)A.splice(i,1);
      C().forEach(o=>{if(o.layers)o.layers=o.layers.filter(l=>!/^chkL-/.test(String(l.id||'')));});
      const k=LV3.__D().settings.purchKilled||{};Object.keys(k).forEach(x=>{if(/check (clipper|mini marsh)|chk hub/i.test(x))delete k[x];});};
    const mine=()=>LV3.__D().purchases.filter(p=>p.sup===SUP);
    const byId=id=>LV3.__D().purchases.find(p=>p.id===id);
    const run=async rows=>{window.__lavSheetRowsHook=t=>t===TAB?rows:null;try{await LV3.syncPurchases();}finally{delete window.__lavSheetRowsHook;}};
    try{
      /* G · two Kingdom Coffee orders renumbered at once, the same two products on both */
      clean();
      [['chk-a',d1,NM,300,'1000169069'],['chk-b',d2,NM,7500,'invoice number tbc'],['chk-c',d1,NM2,88,'1000169063'],['chk-d',d2,NM2,1518,'invoice number tbc']]
        .forEach(([id,d,nm,q,o])=>{D.purchases.push(P(id,d,nm,q,o,true));lay(id,q);});
      await run([row(d1,NM,300,'#1000169069'),row(d2,NM,7500,'"'),row(d1,NM2,88,'#1000169063'),row(d2,NM2,1518,'"')]);
      eq(mine().length,4,'G: four lines on the sheet, four purchases — nothing doubled');
      eq((byId('chk-a')||{}).oid,'#1000169069','G: the 01/10 Clipper takes its new order number');
      eq((byId('chk-b')||{}).oid,'"','G: the 02/10 Clipper takes its new order number');
      eq((byId('chk-d')||{}).oid,'"','G: the 02/10 marshmallows too');
      ok(mine().every(p=>(p.alloc||[]).length),'G: none waiting to be linked');
      /* H · today's state: an earlier sync already added the edited line as new beside the one holding the stock */
      clean();
      D.purchases.push(P('chk-a',d1,NM,300,'1000169069',true));lay('chk-a',300);
      D.purchases.push(P('chk-n',d1,NM,300,'#1000169069',false));
      const hand0=LV3.__onHand(cc);
      await run([row(d1,NM,300,'#1000169069')]);
      eq(mine().length,1,'H: the copy goes — one purchase for one sheet line');
      ok(byId('chk-a')&&!byId('chk-n'),'H: the one that keeps it is the one with the stock');
      eq(byId('chk-a').oid,'#1000169069','H: it takes the sheet’s order number');
      const L1=cc.layers.find(l=>l.id==='chkL-chk-a');ok(L1&&L1.src==='P:chk-a'&&L1.oid==='#1000169069','H: its stock stays on it, with the new number');
      eq(LV3.__onHand(cc),hand0,'H: stock unchanged');
      ok(!Object.keys(D.settings.purchKilled||{}).some(k=>/check clipper/.test(k)),'H: nothing is put on the ignore list');
      /* H2 · not certain (two old lines the same) — left exactly as it was */
      clean();
      D.purchases.push(P('chk-a',d1,NM,300,'1000169069',true));lay('chk-a',300);
      D.purchases.push(P('chk-b',d1,NM,300,'1000169070',true));lay('chk-b',300);
      D.purchases.push(P('chk-n',d1,NM,300,'#1000169069',false));
      await run([row(d1,NM,300,'#1000169069')]);
      ok(byId('chk-n')&&byId('chk-a').oid==='1000169069'&&byId('chk-b').oid==='1000169070','H2: two old lines it could be — nothing joined, nothing changed');
      /* I · stock typed in by hand before the line was on the sheet (Black HC 300, Nisbets, 29/09, "transferred over from hub") */
      clean();
      (cc.layers=cc.layers||[]).push({id:'chkL-hub',date:'2026-09-29',qty:300,rem:0,cost:0.24,sup:HUB,oid:'—',loc:'Warehouse',arr:1,src:'backstock',note:'transferred over from hub'});
      D.purchases.push({id:'chk-h',uuid:null,tab:TAB,date:'2026-09-29',name:cc.name,qty:300,price:0.24,sup:HUB,oid:'UK19037313',loc:'Warehouse',arr:0,alloc:[],acct:'',invoice:'',notes:'',spend:72,mismatch:0});
      const hand1=LV3.__onHand(cc),nL=cc.layers.length;
      await run([{tab:TAB,date:'2026-09-29',name:cc.name,qty:300,price:0.24,sup:HUB,oid:'UK19037313',acct:'',invoice:'',notes:'',sheetArr:'Confirmed',spend:72,mismatch:0}]);
      const h=byId('chk-h');ok(h&&(h.alloc||[]).length===1&&h.alloc[0].to===cid&&h.alloc[0].qty===300,'I: the sheet line is linked to the part');
      eq((cc.layers.find(l=>l.id==='chkL-hub')||{}).src,'P:chk-h','I: …through the batch typed in by hand');
      eq(cc.layers.length,nL,'I: no new batch');eq(LV3.__onHand(cc),hand1,'I: stock unchanged');
      /* J · "Leave it" stops counting as a difference */
      clean();
      D.purchases.push(P('chk-y',d1,NM,11,'OLD-Y',true));lay('chk-y',11);
      D.purchases.push(P('chk-z',d1,NM,12,'OLD-Z',true));lay('chk-z',12);
      D.settings.diffAck=D.settings.diffAck||{};D.settings.diffAck[[d1,'old-z',NM.toLowerCase(),12].join('|')]={on:d1,by:'check'};
      await run([row(d1,NM2,5,'NEW-1')]);
      const dk=(window.__lavSheetDiff||[]).map(x=>x.k);
      ok(dk.includes([d1,'old-y',NM.toLowerCase(),11].join('|')),'J: a line nobody has answered still counts');
      ok(!dk.includes([d1,'old-z',NM.toLowerCase(),12].join('|')),'J: a line marked "Leave it" does not');
      /* K · note rows and empty rows are not "a date that isn't a real day" */
      const pr=LV3.__parseRows([{Date:'',Name:'COG pub snacks - £5.78'},{Date:'',Name:'',Spent:'£0.00'},
        {Date:'',Name:'Real thing','Quanity Bought':'5','Buy Price':'1'},{Date:'31/09/2026',Name:'Bad day','Quanity Bought':'3','Buy Price':'1'},
        {Date:'02/10/2026',Name:'Fine','Quanity Bought':'4','Buy Price':'1'}],'Lavarion Q3');
      eq(pr.skips.date,2,'K: only real lines with no proper date are counted (not the note row or the empty one)');eq(pr.rows.length,1,'K: the good line comes through');
    }finally{clean();D.settings.diffAck=JSON.parse(keepAck);}
    /* L · scooped parts never limit, still cost, still bought — in KG bags */
    const limParts=p=>(p.recipe||[]).map(r=>({r,c:D.components.find(x=>x.id===r.c)})).filter(x=>x.c&&!x.c.untracked&&!x.c.scoop);
    const bundle=D.products.find(p=>!p.archived&&p.type==='bundle'&&limParts(p).length>=2&&limParts(p).some(x=>x.c.kind!=='packaging'));
    if(bundle){
      const parts=limParts(bundle),canOf=x=>Math.floor(LV3.__onHand(x.c)/x.r.q);
      const low=parts.filter(x=>x.c.kind!=='packaging').sort((a,b)=>canOf(a)-canOf(b))[0];
      const next=Math.min(...parts.filter(x=>x!==low).map(canOf));
      const av0=(LV3.lavShipList().find(x=>x.asin===bundle.asin)||{}).available;
      const keepS=JSON.stringify(D.settings.scoop||{});
      try{
        D.settings.scoop=D.settings.scoop||{};D.settings.scoop[String(low.c.id)]=true;low.c.scoop=true;
        const av1=(LV3.lavShipList().find(x=>x.asin===bundle.asin)||{}).available;
        ok(av1>=av0,'L: scooping the part that limited it never lowers Can build');
        eq(av1,next,'L: the next countable part decides');
      }finally{D.settings.scoop=JSON.parse(keepS);low.c.scoop=isScoopChk(low.c);}
    }
    function isScoopChk(c){return /^reindeer (oats?|bird seeds?)$/i.test(String(c.name||'').trim())&&(D.settings.scoop||{})[String(c.id)]!==false;}
    const rf=D.products.find(p=>/^reindeer food$/i.test(String(p.name||'').trim())&&!p.archived);
    if(rf){
      const comps=rf.recipe.map(r=>({r,c:D.components.find(x=>x.id===r.c)})).filter(x=>x.c);
      ok(comps.filter(x=>/oats?|seeds?/i.test(x.c.name)).every(x=>x.c.scoop),'L: Reindeer oats and seeds are scooped by default');
      const want=Math.min(...comps.filter(x=>!x.c.scoop&&!x.c.untracked).map(x=>Math.floor(LV3.__onHand(x.c)/x.r.q)));
      eq((LV3.lavShipList().find(x=>x.asin===rf.asin)||{}).available,want,'L: Reindeer Food — the bags and tags decide Can build');
      const sb1=(LV3.q4Calc().shopBy||[]).find(x=>x.asin===rf.asin);
      if(sb1&&sb1.left>0){const kg=sb1.buy.filter(b=>b.cu==='KG bag');
        ok(kg.length&&kg.every(b=>b.cq===25),'L: the Q4 buy list still has the oats and seeds — in KG bags of 25');}
    }
    {const msg=LV3.q4StaffMsg({shopBy:[{id:'x',asin:'B0CHKSCOOP',name:'CHECK Reindeer',target:10,done:0,left:10,first:false,setAt:null,
        buy:[{id:'c1',name:'CHECK Oats',qty:1253,cq:25,cu:'KG bag',sup:'Tesco',ord:0},{id:'c2',name:'CHECK Tags',qty:30,cq:10,cu:null,sup:'Tesco',ord:0}]}]});
      ok(/CHECK Oats: 1,253 = 51 KG bags of 25/.test(msg),'L: the staff message says KG bags');
      ok(/buy 51 KG bags of 25 = 1,275 → 22 left over/.test(msg),'L: …and in the full order list');
      ok(/CHECK Tags: 30 = 3 cases of 10/.test(msg),'L: a counted part still says cases');}
    /* M · the SellerFuse bar looks for a newer check before it warns */
    if(window.SFRUN&&window._sfPeekNewer){const was=SFRUN.at;SFRUN.at='2026-01-01T00:00:00Z';
      const got=await window._sfPeekNewer(true);
      ok(got&&window.SFRUN&&new Date(window.SFRUN.at)>new Date('2026-01-02'),'M: a newer check in the database is loaded before any warning');
      ok(window.SFRUN.at===was||new Date(window.SFRUN.at)>=new Date(was),'M: …the newest one');}
  };

  S['b676/b677: cases on the On order list, Receive and Receive several — count in boxes, a cases box beside every units box']=async()=>{
    let n=0;while(!(window.LV3&&LV3.isReady&&LV3.isReady())&&n++<40)await wait(250);
    const D=LV3.__D(),T=LV3.__casesTxt;
    eq(T(240,24),'10 cases','a whole number of cases');
    eq(T(245,24),'10 cases + 5 loose','cases + loose');
    eq(T(1,24),'1 loose — under a case','under a case');
    eq(T(24,24),'1 case','one case');
    eq(T(0,24),'','nothing owed, nothing said');
    eq(T(100,0),'','no case size — never guessed');
    const day=new Date().toISOString().slice(0,10);
    const c={id:'chk-case-c',name:'CHECK Case Tea',kind:'component',tag:'complementary',caseQty:24,layers:[
      {id:'chk-case-l',src:'',qty:240,rem:240,ord:240,arr:0,date:day,sup:'CHECK CASE',oid:'CHK-CASE',cost:0.15,arrivedOn:day}]};
    /* its own stand-in record, so a save never adds it to the real parts list */
    c._src={id:c.id,uuid:null,name:c.name,kind:'component',tag:'complementary',caseQty:24,archived:false};
    c._src._sig=[c.name,c.kind,c.tag,c.caseQty].join('|');
    D.components.push(c);
    const $=id=>document.getElementById(id);
    try{
      /* A · Receive with a case size */
      LV3.openReceive('component',c.id,'chk-case-l');await wait(120);
      eq(String($('rcvCs').value),'10','A: the boxes start at what is owed — 10 cases');
      eq(String($('rcvLoose').value),'0','A: …and 0 loose');
      ok(/10 cases/.test(document.querySelector('.rcvFacts').textContent),'A: Ordered / Outstanding say their cases');
      ok([...document.querySelectorAll('.rcvAll')].some(b=>/All 240 · 10 cases/.test(b.textContent)),'A: "All 240 · 10 cases"');
      $('rcvCs').value='9';$('rcvLoose').value='5';LV3.rcvFromCases();
      eq(String($('rcvGot').value),'221','A: 9 cases of 24 + 5 loose fills in 221');
      $('rcvGot').focus();$('rcvGot').value='50';LV3.rcvPreview();
      eq(String($('rcvCs').value)+'/'+String($('rcvLoose').value),'2/2','A: typing 50 units shows 2 cases + 2 loose');
      LV3.cm('lav3Ov2');
      /* A2 · b677: the On order list has a cases box beside the units box, in step both ways */
      LV3.go('purchases');await wait(300);
      ok($('rcv-chk-case-l-c'),'A2: the On order list has a cases box');
      eq(String($('rcv-chk-case-l-c').value),'10','A2: 240 owed shows 10 cases');
      $('rcv-chk-case-l-c').value='9';LV3.ordCsIn('chk-case-l',24,'c');
      eq(String($('rcv-chk-case-l').value),'216','A2: typing 9 cases sets 216 units');
      $('rcv-chk-case-l').value='221';LV3.ordCsIn('chk-case-l',24,'u');
      eq(String($('rcv-chk-case-l-c').value)+'|'+$('rcv-chk-case-l-l').textContent,'9|+ 5 loose','A2: typing 221 units shows 9 cases + 5 loose');
      $('rcv-chk-case-l-c').value='8';LV3.ordCsIn('chk-case-l',24,'c');
      eq(String($('rcv-chk-case-l').value),'197','A2: typing 8 cases keeps the 5 loose — 197');
      LV3.go('overview');await wait(150);
      /* B · a part with no case size asks, and keeps what is typed */
      c.caseQty=null;
      LV3.openReceive('component',c.id,'chk-case-l');await wait(120);
      ok($('rcvCq')&&!$('rcvCs'),'B: no case size — it asks how many in a case, no boxes guessed');
      $('rcvCq').value='12';LV3.rcvCqTyped();
      eq(String(($('rcvCs')||{}).value),'20','B: typed 12 a case — 240 owed shows 20 cases');
      $('rcvGot').value='36';LV3.rcvPreview();
      LV3.rcvConfirm();await wait(150);
      eq(c.caseQty,12,'B: the case size typed at check-in is kept on the part');
      const lay=c.layers.find(l=>String(l.id)==='chk-case-l');
      eq(lay&&lay.rcvd,36,'B: 36 booked in (3 cases)');
      /* C · a part that already has a case size is never overwritten from check-in */
      c.caseQty=24;
      LV3.openReceive('component',c.id,'chk-case-l');await wait(120);
      ok(!$('rcvCq'),'C: a part with a case size is not asked again');
      LV3.cm('lav3Ov2');
      /* D · Receive several says the cases under the count */
      LV3.openDeliveries();await wait(150);
      const i=(window._dlv||[]).findIndex(x=>String(x.l.id)==='chk-case-l');
      ok(i>=0,'D: the arrived line is in Receive several');
      const qi=$('dlv-q-'+i);qi.value='50';LV3.dlvCs(i);
      eq(String($('dlv-q-'+i+'-c').value)+'|'+$('dlv-q-'+i+'-l').textContent,'2|+ 2 loose','D: 50 typed → 2 cases + 2 loose');
      $('dlv-q-'+i+'-c').value='3';LV3.dlvCsIn(i,'c');
      eq(String(qi.value),'74','D: typing 3 cases → 74 units (the 2 loose kept)');
      LV3.cm('lav3Ov2');LV3.cm('lav3Ov1');
    }finally{
      const ix=D.components.indexOf(c);if(ix>=0)D.components.splice(ix,1);
      try{LV3.cm('lav3Ov2');LV3.cm('lav3Ov1');}catch(e){}
    }
  };

  async function run(only){
    R.length=0;const t0=Date.now();
    const _dbwWas=(typeof DBW!=='undefined')?DBW.paused:false;try{DBW.paused=true;}catch(e){}
    for(const name of Object.keys(S)){
      if(only&&!name.includes(only))continue;
      try{await S[name]();R.push({name,ok:true});}
      catch(e){R.push({name,ok:false,err:String(e&&e.message||e)});console.error('[checks] '+name,e);}
      finally{cleanup();}
    }
    const fails=R.filter(x=>!x.ok);
    let rep=R.map(x=>(x.ok?'  PASS  ':'  FAIL  ')+x.name+(x.ok?'':'\n          '+x.err)).join('\n');
    /* the audit rides along as information: live rows where a page disagrees with _rowOwner */
    try{const a=audit();rep+=`\n\n  AUDIT  ${a.rows} live rows — ${a.disagreements} where a page disagrees with the one owner rule`
      +Object.keys(a.tally).map(k=>`\n          ${a.tally[k]} × ${k}`).join('')
      +a.list.slice(0,8).map(x=>`\n          · ${x.sku} — ${x.why} — ${x.problems.join('; ')}`).join('');}catch(e){rep+='\n\n  AUDIT  could not run: '+e.message;}
    try{DBW.paused=_dbwWas;}catch(e){}
    console.log(`[checks] ${R.length-fails.length}/${R.length} passed in ${Date.now()-t0}ms\n`+rep);
    return {passed:R.length-fails.length,total:R.length,fails,report:rep};
  }
  return {run,audit,S,mkRow,cleanup};
})();
