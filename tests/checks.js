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
