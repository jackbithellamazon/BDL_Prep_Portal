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
    const theirs={t:'2026-10-12T02:00:00.000Z',k:'edit',txt:'CHECK Stock at Amazon counted 12 Oct — 41 products',who:'Sarah'};
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

  function D_products(){try{return (LV3.allProducts&&LV3.allProducts())||[];}catch(e){return [];}}
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
