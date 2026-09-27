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
    ok(!(window._srtGate&&window._srtGate.missingAsk),'gate opens once the SKU is named');
    await submitSorted();await wait(400);
    eq(r1.resolution.wentAs,r2.sku,'went-out-under SKU recorded');eq(r1.resolution.wentAsQty,16,'16 units recorded');
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

  /* 14 · the Lavarion pages lay out (b548 turned every panel into a flex row for two days) */
  S['Lavarion panels lay out']=async()=>{
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
    const sa=_adminItems();const onS=new Set(sa.filter(i=>!i.waiting).map(i=>String(i.rid)));const withB=new Set(sa.filter(i=>i.withBecki).map(i=>String(i.rid)));
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

  /* 19 · Lavarion comes to Jack first; Sarah gets it only as a job with his note; her Send to Jack returns it */
  S['Lavarion shortage — Jack first, Sarah only as a job']=async()=>{
    ok(window.LV3&&LV3.supplierIssues,'LV3 present');
    const fake={key:'o:chk-lav-1',ref:'UK-CHK-LAV',sup:'CHECK SUPPLIER',on:'2026-09-01',short:5,dmg:0,val:50,lines:[{name:'CHECK ROW LAV'}],evid:'',toJack:'',toSarah:'',log:[],chased:'',quiet:false};
    const o1=LV3.supplierIssues,o2=LV3.setSupplierIssueField,o3=LV3.logSupplierIssue;
    LV3.supplierIssues=()=>[fake];LV3.setSupplierIssueField=(k,f,v)=>{if(k===fake.key)fake[f]=v;return true;};LV3.logSupplierIssue=(k,e)=>{fake.log.push(e);};
    try{
      const onJ=()=>jackTodo().lavQ.some(g=>g.key===fake.key),onS=()=>_allAdminRows().some(i=>i.rid==='lav:'+fake.key);
      ok(onJ(),'a fresh shortage is on Jack’s page');ok(!onS(),'…and not on Sarah’s');
      who('Jack');lavIssueToSarah(fake.key,'Chase them for the 5');
      ok(!onJ(),'off Jack’s page once sent');ok(onS(),'on Sarah’s as a job');ok(_allAdminRows().find(i=>i.rid==='lav:'+fake.key).jobNote==='Chase them for the 5','with his note');
      who('Sarah');lavToJack(fake.key);
      ok(onJ(),'her Send to Jack puts it back on his page');ok(!onS(),'…and off hers');
    }finally{LV3.supplierIssues=o1;LV3.setSupplierIssueField=o2;LV3.logSupplierIssue=o3;}
  };

  /* 20 · a promised date parks the row for everyone; when it slips it is Sarah's chase, not Jack's question */
  S['promised date — parked, then slips to Sarah']=async()=>{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};
    const park=mkRow({exp:3,expectedDelivery:d(3),resolution:asked({chase:{path:'never-arrived',step:'due-date',due:d(3),log:[]}})});
    eq(_rowOwner(park).owner,'none','future date → nobody’s list');ok(!onJack(park),'not on Jack’s');ok(!onSarahActive(park),'not on Sarah’s');
    const slip=mkRow({exp:3,expectedDelivery:d(-1),resolution:asked({chase:{path:'never-arrived',step:'due-date',due:d(-1),log:[]}})});
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
    ok(r.archived,'nothing ever landed → filed');ok(cl.settledOnRow,'the claim is stamped so it runs once');
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
      ok(d2[0].dupCheck&&d2[0].dupCheck.answered==='separate','D: already answered — never asked');
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

  function D_products(){try{return (LV3.allProducts&&LV3.allProducts())||[];}catch(e){return [];}}
  async function run(only){
    R.length=0;const t0=Date.now();
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
    console.log(`[checks] ${R.length-fails.length}/${R.length} passed in ${Date.now()-t0}ms\n`+rep);
    return {passed:R.length-fails.length,total:R.length,fails,report:rep};
  }
  return {run,audit,S,mkRow,cleanup};
})();
