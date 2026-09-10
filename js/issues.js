/* BDL PrepHub — js/issues.js — issue workflow, clear data, backup.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── ISSUE WORKFLOW ─────────────────────────────────────────────────────────────
let _issueRowId=null;
let _issueLineCount=0;

/* Jack, 8 Sep: "let me check it in here — mark it as delivered here." A gated
   row with nothing counted in is a delivery problem, not a business decision,
   and sending her back to the Prep Sheet to type one number was the long way
   round. Same write the sheet does, same guards, from inside the popup. */
async function riBookIn(){
  const r=rows.find(x=>String(x.id)===String(_issueRowId)||x.uuid===String(_issueRowId));
  if(!r){toast('Row not found','er');return;}
  const el=document.getElementById('riBookQty');
  const n=parseInt(el&&el.value);
  const exp=parseInt(r.exp)||0;
  if(!Number.isFinite(n)||n<1){toast('How many actually turned up?','er');return;}
  if(n>exp){toast(`Only ${exp} were ordered — book in ${exp} or fewer`,'er');return;}
  if(_blockRcvdBelowSent(r,n))return;
  const was=parseInt(r.rcvd)||0;
  r.rcvd=n;
  r.rcvdAt=new Date().toISOString();
  if(r.status==='In-Transit'||r.status==='Not Arrived')r.status=(n>=exp)?'In Warehouse':'In-Transit';
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');r.rcvd=was;return;}
  logAudit('Booked in from the issue popup',`${r.sku||r.asin||''} — ${was} → ${n} of ${exp}`);
  toast(`${fmt(n)} of ${fmt(exp)} booked in`+(n>=exp?' — nothing outstanding':` — ${fmt(exp-n)} still unaccounted for`),'ok');
  try{renderPrep();renderStats();}catch(e){}
  openIssueModal(_issueRowId);
}
function openIssueModal(rowId){
  _issueRowId=rowId;
  _issueLineCount=0;
  const r=rows.find(x=>String(x.id)===String(rowId)||x.uuid===String(rowId));
  if(!r)return;
  document.getElementById('issueModalTitle').textContent='Raise Issue — '+r.sku;
  const _exp=r.exp||0,_got=parseInt(r.rcvd)||0,_short=Math.max(0,_exp-_got);
  document.getElementById('issueModalInfo').innerHTML=
    `<div style="font-size:13px;font-weight:800;color:var(--text);line-height:1.35;">${esc(r.prod||r.sku||'')}</div>
     <div style="font-size:11.5px;font-weight:600;color:var(--text2);margin-top:3px;">${esc(r.sup||'')}${r.acct?' · '+esc(r.acct):''}${r.oid?' · '+esc(r.oid):''}</div>
     <div class="riMaths">
       <div><span>Ordered</span><b>${_exp}</b></div>
       <div><span>Booked in</span><b style="color:${_got?'var(--green)':'var(--text3)'};">${_got}</b></div>
       <div><span>Unaccounted for</span><b style="color:${_short?'#fbbf24':'var(--green)'};">${_short}</b></div>
     </div>
     ${_short>0&&_exp>0?`<div class="riWarn">${_got===0?'Nothing has been booked in yet.':`${_got} of ${_exp} booked in.`} If the stock is here, count it in first — only raise an issue for what is genuinely wrong.</div>
       <div class="riBookIn">
         <span class="riBookL">It is here — book it in now</span>
         <input id="riBookQty" type="number" min="1" max="${_exp}" value="${_short}" onkeydown="if(event.key==='Enter'){event.preventDefault();riBookIn();}">
         <span class="riBookU">of ${_exp}</span>
         <button class="riBookGo" onclick="riBookIn()" title="Counts the units in on the Prep Sheet without leaving this popup — then raise an issue only for what is genuinely wrong">Book it in</button>
       </div>`:''}
     ${(()=>{const _q=_ukQuery(r);const _rs=r.resolution||{};
       if(_q)return `<div class="riAsk open"><b>Question already with ${_rs.state==='asked'?'Jack':'the admin team'}</b> — ${esc(_q.by||'')} asked on ${_qryWhen(_q.at)} whether more is on the way. The answer comes back in the VA Note. Raise an issue here only for what is genuinely wrong now.</div>`;
       if(_qryOwed(r)>0&&!['Delivered','In Warehouse','Returned'].includes(r.status))return `<div class="riAsk">${_got?`${_got} of ${_exp} booked in — not sure if the rest is still coming?`:`Nothing booked in — not sure if it has been dispatched?`} <button class="riAskBtn" onclick="cm('issueModal');openQuery('${r.uuid||r.id}')">Ask: is more on the way?</button><div class="riAskSub">A question for Sarah, not an issue. Raise Missing only once someone confirms nothing more is due.</div></div>`;
       return '';})()}`;
  // Show existing open issues (match by uuid or local id for backward compat)
  const rk=r.uuid||r.id;
  const existing=claims.filter(cl=>(cl.prepRowId===rk||cl.prepRowId===r.id||cl.prepRowId===r.uuid)&&cl.cst!=='Resolved'&&cl.cst!=='Closed');
  document.getElementById('issueLines').innerHTML='';
  if(existing.length){
    existing.forEach(cl=>addIssueLine(cl));
  } else if(r.issueType&&r.issueType!=='—'&&r.issueType!==''){
    // Orphaned flag: the prep row records an issue (shows the red flag/hover)
    // but no matching claim exists — typically left over from when the
    // actions insert was failing. Pre-fill from the row so it's visible and
    // re-saving recreates the missing record (instead of opening blank).
    addIssueLine({issT:r.issueType,dif:r.issueQty||1});
  } else {
    addIssueLine();
  }
  om('issueModal');
}

// The issue TYPE determines the workflow: who owns it, what the first move is,
// and how soon. Missing/Damaged/Not Arrived/Incorrect → VA investigates & chases.
// Gated → Jack decides (eBay vs get ungated). Damage claims are time-critical
// (supplier windows), so they get the tightest due date.
function _issueDefaults(type){
  const plus=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  switch(type){
    case 'Gated':return{owner:'Jack',na:'Decide: sell on eBay (1–2 units) or get ungated (invoice / buy units)',nd:plus(3)};
    case 'Damaged':return{owner:'VA',na:'Get photos attached, then raise supplier / reimbursement claim',nd:plus(2)};
    case 'Missing':return{owner:'VA',na:'Investigate — already shipped? portal not updated? Then contact supplier',nd:plus(2)};
    case 'Not Arrived':return{owner:'VA',na:'Check tracking, then chase supplier for delivery ETA',nd:plus(2)};
    case 'Incorrect':return{owner:'VA',na:'Contact supplier — wrong item received, arrange swap/refund',nd:plus(2)};
    default:return{owner:'VA',na:'Investigate and decide next step',nd:plus(3)};
  }
}
// Auto-describe an issue from the row's own numbers — no manual typing.
function _autoIssueNote(type,qty,r){
  const exp=r.exp||0,rec=r.rcvd||0;
  if(type==='Missing')return `Missing ${qty} of ${exp} units (received ${rec})`;
  if(type==='Gated')return `Gated — ${qty} unit${qty===1?'':'s'} can't be sent until ungated or returned`;
  if(type==='Damaged')return `${qty} unit${qty===1?'':'s'} arrived damaged`;
  if(type==='Incorrect')return `${qty} incorrect unit${qty===1?'':'s'} received`;
  if(type==='Not Arrived')return `${qty} unit${qty===1?'':'s'} not arrived — no delivery received`;
  return '';
}
// When staff pick a type, prefill the obvious quantity from the row itself:
// Missing = shortfall (expected − received), Gated = the affected stock.
function _ilTypePick(idx){
  const r=rows.find(x=>String(x.id)===String(_issueRowId)||x.uuid===String(_issueRowId));
  if(!r)return;
  const t=(document.getElementById(`il-type-${idx}`)||{}).value;
  const q=document.getElementById(`il-qty-${idx}`);
  if(!q||q.value)return; // never overwrite something staff already typed
  if(t==='Missing')q.value=Math.max(0,(r.exp||0)-(r.rcvd||0))||'';
  else if(t==='Gated')q.value=Math.max(1,(r.rcvd||r.exp||1));
}
function addIssueLine(existing=null){
  const idx=_issueLineCount++;
  const div=document.createElement('div');
  div.id=`il-${idx}`;
  div.style.cssText='display:grid;grid-template-columns:1fr 70px 28px;gap:6px;align-items:center;background:var(--bg3);border-radius:6px;padding:8px 10px;';
  div.innerHTML=`
    <select class="fi-in" id="il-type-${idx}" style="font-size:12px;" onchange="_ilTypePick(${idx})">
      <option value="">— Select type —</option>
      <option value="Missing"${existing?.issT==='Missing'?' selected':''}>Missing</option>
      <option value="Damaged"${existing?.issT==='Damaged'?' selected':''}>Damaged</option>
      <option value="Incorrect"${existing?.issT==='Incorrect'?' selected':''}>Incorrect</option>
      <option value="Gated"${existing?.issT==='Gated'?' selected':''}>Gated</option>
      <option value="Not Arrived"${existing?.issT==='Not Arrived'?' selected':''}>Not Arrived</option>
    </select>
    <div style="position:relative;">
      <input type="number" id="il-qty-${idx}" class="fi-in" min="1" value="${existing?.dif||''}" placeholder="Qty" style="font-size:12px;padding-right:24px;">
      <span style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--text3);">units</span>
    </div>
    <button onclick="document.getElementById('il-${idx}').remove()" style="background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:4px;cursor:pointer;font-size:12px;padding:2px 6px;height:32px;"${_issueLineCount===1&&!existing?' disabled':''}>✕</button>
    ${existing?`<input type="hidden" id="il-uuid-${idx}" value="${existing.uuid||''}"><input type="hidden" id="il-cst-${idx}" value="${existing.cst||'Open'}">`:``}
  `;
  document.getElementById('issueLines').appendChild(div);
}

/* A refusal shown as a corner toast, while the person is looking at the middle
   of a dialog, gets missed. This puts the reason inside the dialog, in their
   eyeline, and it stays until they act on it. */
let _deliveryComplete=false;
function _blockIssue(title,body,choices){
  const anchor=document.getElementById('il-type-0');
  const host=anchor?anchor.closest('.modal')||anchor.parentElement.parentElement:null;
  if(!host){toast(title,'er');return;}
  let el=document.getElementById('issueBlockMsg');
  if(!el){
    el=document.createElement('div');
    el.id='issueBlockMsg';
    el.style.cssText='margin:0 0 14px;padding:12px 14px;border-radius:10px;'
      +'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);';
    const first=host.querySelector('div');
    host.insertBefore(el,first&&first.nextSibling?first.nextSibling:host.firstChild);
  }
  el.innerHTML='<div style="font-size:13px;font-weight:800;color:#f87171;margin-bottom:4px;">'
    +esc(title)+'</div><div style="font-size:12px;font-weight:600;color:#fecaca;line-height:1.5;">'
    +esc(body)+'</div>'
    +((choices||[]).length?'<div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap;">'
      +choices.map(([lab,act],i)=>'<button onclick="'+act+'" style="padding:7px 14px;border-radius:7px;cursor:pointer;'
        +'font-size:12px;font-weight:800;'+(i===choices.length-1
          ?'background:var(--accent);border:1px solid var(--accent);color:#1a1400;'
          :'background:var(--bg3);border:1px solid var(--border2);color:var(--text2);')+'">'+esc(lab)+'</button>').join('')
      +'</div>':'');
  el.scrollIntoView({block:'nearest',behavior:'smooth'});
  return;
}
async function saveIssueModal(){
  const _old=document.getElementById('issueBlockMsg'); if(_old)_old.remove();
  const r=rows.find(x=>String(x.id)===String(_issueRowId)||x.uuid===String(_issueRowId));
  if(!r){toast('Row not found','er');return;}
  const lines=[];
  let i=0;
  while(document.getElementById(`il-type-${i}`)!==null||i<_issueLineCount){
    const typeEl=document.getElementById(`il-type-${i}`);
    const qtyEl=document.getElementById(`il-qty-${i}`);
    if(typeEl&&qtyEl){
      const t=typeEl.value;const q=parseInt(qtyEl.value)||0;
      if(t&&q>0)lines.push({type:t,qty:q,uuid:document.getElementById(`il-uuid-${i}`)?.value||null,cst:document.getElementById(`il-cst-${i}`)?.value||'Needs Attention'});
    }
    i++;
    if(i>20)break;
  }
  if(!lines.length){toast('Add at least one issue type and quantity','er');return;}
  /* Gated means "it is here and we cannot sell it". You cannot be gated on
     stock that has never been booked in — that is a delivery problem, not a
     business decision, and it was landing on Jack's list either way. */
  const got=parseInt(r.rcvd)||0;
  const exp=r.exp||0;
  /* 100 ordered, 50 turn up in the first box — that is not a missing-stock
     issue, it is half a delivery. Raising it as Missing starts a claim clock
     and puts a false loss on the Issues page. Ask once whether the delivery is
     actually finished; only then is it a genuine shortfall. */
  const shortLine=lines.find(l=>/missing|not arrived/i.test(l.type));
  if(shortLine&&got>0&&got<exp&&!_deliveryComplete){
    return _blockIssue('Is that the whole delivery?',
      `${got} of ${exp} have been booked in. If the rest is coming in another box this is not a missing-stock issue yet — book the rest in when it lands. Only raise it as missing once you are sure nothing else is due.`,
      [['Not sure — ask Sarah if more is coming','cm(\'issueModal\');openQuery(\''+(r.uuid||r.id)+'\')'],
       ['More boxes still due — cancel','cm(\'issueModal\')'],
       ['That is the whole delivery','_deliveryComplete=true;saveIssueModal()']]);
  }
  const gatedLine=lines.find(l=>/gated/i.test(l.type));
  if(gatedLine&&got<=0)
    return _blockIssue('This stock has not been booked in yet',
      `Gated means it is here and we cannot sell it. Nothing has been counted in against this order, so right now it is a delivery problem, not a business decision. Receive the ${r.exp||0} unit${(r.exp||0)===1?'':'s'} on the Prep Sheet first, then raise it as gated.`);
  if(gatedLine&&gatedLine.qty>got)
    return _blockIssue(`Only ${got} unit${got===1?'':'s'} counted in`,
      `You have marked ${gatedLine.qty} as gated but only ${got} ${got===1?'has':'have'} been received. Book the rest in first, or lower the gated quantity to ${got}.`);
  // Remove old open claims for this row (match by uuid or local id)
  const oldClaims=claims.filter(cl=>(cl.prepRowId===(r.uuid||r.id)||cl.prepRowId===r.id||cl.prepRowId===r.uuid)&&cl.cst!=='Resolved'&&cl.cst!=='Closed');
  for(const oc of oldClaims){
    if(!lines.find(l=>l.uuid===oc.uuid)){
      await sb.from('actions').delete().eq('id',oc.uuid);
      claims=claims.filter(c=>c.uuid!==oc.uuid);
    }
  }
  // Save each issue line as a claim
  for(const line of lines){
    const cog=parseSKU(r.sku).cogs||0;
    if(line.uuid){
      // Update existing
      const cl=claims.find(c=>c.uuid===line.uuid);
      if(cl){cl.issT=line.type;cl.dif=line.qty;cl.claimValue=cog*line.qty;await saveClaim(cl);}
    } else {
      // Create new
      try{await _createIssueClaim(r,line.type,line.qty);}
      catch(e){toast('Issue save failed: '+((e&&e.message)||e),'er');setSyncStatus('error');return;}
    }
  }
  // Update prep row issueType/issueQty from first issue line
  r.issueType=lines[0].type;
  r.issueQty=lines.reduce((a,l)=>a+l.qty,0);
  await saveRow(r);
  cm('issueModal');
  renderPrep();
  renderClaims();
  toast(`✓ ${lines.length} issue${lines.length!==1?'s':''} raised`);
  logAudit('Issue raised',r.sku+' — '+lines.map(l=>l.type+' '+l.qty+'u').join(', '));
}

/* one issue line → one claim record. Used by the Raise Issue popup and by the
   answer to a warehouse question ("nothing more is coming" = Missing). */
async function _createIssueClaim(r,type,qty,opts){
  opts=opts||{};
  const cog=parseSKU(r.sku).cogs||0;const d=_issueDefaults(type);
  const owner=opts.owner||d.owner;
  const newCl={id:Date.now(),uuid:null,prepRowId:r.uuid||r.id,
    date:r.date,raisedAt:todayISO(),sup:r.sup,oid:r.oid,prod:r.prod,sku:r.sku,asin:r.asin,
    issT:type,exp:r.exp,rec:r.rcvd,dif:qty,cost:cog,claimValue:cog*qty,
    cst:'Needs Attention',notes:opts.note||_autoIssueNote(type,qty,r),
    owner,nextAction:d.na,nextDue:d.nd,raisedBy:_who(),
    sentToJack:opts.sentToJack||null,
    log:[{t:getNowUK(),msg:(opts.logMsg||'Issue raised — awaiting review')+' · assigned to '+owner}]};
  const res=await sb.from('actions').insert(claimToDb(newCl)).select().single();
  if(res.error){
    console.error('Issue insert error:',res.error.message,res.error.details,res.error.hint);
    throw new Error(res.error.message);
  }
  if(res.data){newCl.uuid=res.data.id;newCl.id=res.data.id;}
  claims.push(newCl);
  return newCl;
}

async function clearAllIssues(){
  const r=rows.find(x=>x.uuid===String(_issueRowId)||String(x.id)===String(_issueRowId));
  if(!r){toast('Row not found','er');return;}
  showConfirm('Clear all issues on this SKU?',
    `Removes the issue flag and any issue records for "${r.sku}". Use this if an issue was raised by mistake. This cannot be undone.`,
    async()=>{
      // Delete every claim linked to this row (by uuid or local id)
      const rk=r.uuid||r.id;
      const toRemove=claims.filter(cl=>cl.prepRowId===rk||cl.prepRowId===r.id||cl.prepRowId===r.uuid);
      for(const cl of toRemove){
        if(cl.uuid){try{await sb.from('actions').delete().eq('id',cl.uuid);}catch(e){console.error('delete claim',e);}}
      }
      claims=claims.filter(cl=>!(cl.prepRowId===rk||cl.prepRowId===r.id||cl.prepRowId===r.uuid));
      // Clear the prep-row flag
      r.issueType='';r.issueQty=0;r._dirty=true;
      await saveRow(r);
      cm('issueModal');
      renderPrep();renderClaims();updateCB();
      toast('Issues cleared ✓');
      logAudit('Issues cleared',r.sku);
    }
  );
}


function editShipIdInline(id,el){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));if(!r)return;
  const current=r.shipId||'';
  const input=document.createElement('input');
  input.type='text';input.value=current;
  input.style.cssText='font-family:var(--mono);font-size:10px;font-weight:700;width:90px;background:var(--bg3);border:1px solid var(--accent);border-radius:3px;color:var(--text);padding:2px 4px;';
  el.replaceWith(input);
  input.focus();input.select();
  function done(){
    const val=input.value.trim().toUpperCase();
    const oldId=r.shipId||'';
    r.shipId=val;
    // If this row has exactly one shipment segment, rename it to match so the
    // shipments page moves the units to the new ID rather than orphaning them.
    const segs=normaliseSegments(r);
    if(segs.length===1){
      segs[0].shipId=val;
      r.shipSegments=segs;
      r.allShipIds=val?[val]:[];
    }else if(segs.length>1&&oldId){
      // Multi-segment: rename only the segment that matched the old primary ID.
      let touched=false;
      segs.forEach(s=>{if(s.shipId===oldId&&!touched){s.shipId=val;touched=true;}});
      r.shipSegments=segs;
      r.allShipIds=[...new Set(segs.map(s=>s.shipId))];
    }
    uf(id,'shipId',val);
    saveRow(r);
    renderPrep(); // refresh the segment breakdown line + shipments grouping
  }
  input.onblur=done;
  input.onkeydown=e=>{if(e.key==='Enter')done();if(e.key==='Escape'){input.value=current;done();}};
}
function updateIssueFlag(id,hasIssue,issueList){
  const btn=document.getElementById('ib-'+id);
  if(!btn)return;
  if(hasIssue&&issueList&&issueList.length){
    const total=issueList.reduce((a,c)=>a+(c.dif||0),0);
    btn.style.background='rgba(248,113,113,.25)';
    btn.style.borderColor='#f87171';
    btn.style.color='#f87171';
    btn.style.borderStyle='solid';
    btn.innerHTML=`⚑ ${total} unit${total===1?'':'s'}`;
    btn.title=issueList.map(c=>c.issT+' — '+c.dif+' unit'+(c.dif===1?'':'s')).join(', ');
    // Also mark the row red
    const tr=document.getElementById('row-'+id);
    if(tr){tr.classList.add('st-issue');}
  } else {
    btn.style.background='transparent';
    btn.style.borderColor='var(--border2)';
    btn.style.borderStyle='dashed';
    btn.style.color='var(--text3)';
    btn.innerHTML='+ issue';
    btn.title='Raise an issue against this row';
    const tr=document.getElementById('row-'+id);
    if(tr){tr.classList.remove('st-issue');}
  }
}

// Undo a single shipment batch (segment) on a row — pulls those units off that
// FBA shipment and returns them to "to send" on this row. Unlike undoSentToAmazon
// (which only peels the most recent batch and only on fully-sent rows), this works
// on Part-Sent rows too and can target ANY batch. Identified by shipId+date+units
// so the right segment is removed even when a SKU is split several ways.
function undoSegment(id,shipId,dateISO,units){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  const segs=normaliseSegments(r);
  const idx=segs.findIndex(s=>s.shipId===shipId&&(s.date||'')===(dateISO||'')&&(s.units||0)===(units||0));
  if(idx<0){toast('Could not find that batch','er');return;}
  const seg=segs[idx];
  const dd=dateISO&&dateISO.length>=10?`${dateISO.slice(8,10)}/${dateISO.slice(5,7)}`:'';
  showConfirm('Undo this shipment batch?',
    `Removes ${seg.units} unit${seg.units!==1?'s':''} from ${shipId}${dd?` (sent ${dd})`:''} and puts them back as "to send" on this row. Other batches and the rest of that shipment are unaffected.`,
    ()=>{
      const remaining=segs.filter((s,i)=>i!==idx);
      r.shipSegments=remaining;
      r.allShipIds=[...new Set(remaining.map(s=>s.shipId))];
      r.ship=remaining.reduce((a,s)=>a+(s.units||0),0);
      r.shipId=remaining.length?remaining[remaining.length-1].shipId:'';
      if(remaining.length===0){
        r.status='In Warehouse';r.sent='No';r.sentDate='';r.sentAt='';
      }else if(remainingToShip(r)>0||_owedUnits(r)>0){
        r.status='Part Sent';r.sent='No';
      }else{
        r.status='Sent to Amazon';r.sent='Yes';
      }
      r._dirty=true;
      saveRow(r);
      logAudit('Shipment batch undone',`${r.sku}: −${seg.units}u from ${shipId}`);
      renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();
      toast(`✓ Batch undone — ${seg.units}u back to send`);
    });
}

function undoSentToAmazon(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  const segs=normaliseSegments(r);
  // Split SKU: peel off only the most recent shipment so earlier ones stay
  // intact. (e.g. undo today's 2u FBA2 send but keep yesterday's 8u FBA1.)
  if(segs.length>1){
    const last=segs[segs.length-1];
    showConfirm('Undo last shipment?',
      `Removes "${r.sku}" from ${last.shipId} (${last.units}u) and re-opens those units. Earlier shipments stay attached.`,
      ()=>{
        const remaining=segs.slice(0,-1);
        r.shipSegments=remaining;
        r.allShipIds=[...new Set(remaining.map(s=>s.shipId))];
        r.shipId=remaining.length?remaining[remaining.length-1].shipId:'';
        r.ship=remaining.reduce((a,s)=>a+(s.units||0),0);
        r.status='Part Sent';r.sent='No';
        r._dirty=true;
        saveRow(r);
        logAudit('Undo last shipment',`${r.sku} ✕ ${last.shipId} (${last.units}u)`);
        renderPrep();
        toast(`✓ Removed from ${last.shipId} — ${r.sku.split('_')[0]}`);
      });
    return;
  }
  showConfirm('Undo Send to Amazon?',
    `This will revert "${r.sku}" back to "In Warehouse". The shipment ID and sent date will be cleared.`,
    ()=>{
      r.status='In Warehouse';
      r.sent='No';
      r.sentDate='';
      r.sentAt='';
      r.ship=0;
      r.shipId='';
      r.allShipIds=[];
      r.shipSegments=[];
      r._dirty=true;
      saveRow(r);
      logAudit('Undo Send to Amazon',r.sku);
      renderPrep();
      toast('✓ Reverted to In Warehouse');
    }
  );
}
// ── SETTINGS: CLEAR DATA ──────────────────────────────────────────────────────
/* These buttons empty whole tables. They were one ordinary Confirm away from
   anybody who opened Settings — including staff who have no reason to be near
   them — and "Wipe Everything" took the AUDIT LOG with it, so the record of the
   wipe was destroyed by the wipe. Now: the word has to be typed, and history
   (audit log, shipment records) is never included in any of it. */
let _wipeCb=null,_wipeWord='';
function wipeAsk(word,what,sub,cb){
  _wipeCb=cb;_wipeWord=word;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('wipeWhat',what);set('wipeSub',sub);set('wipeWord',word);
  const t=document.getElementById('wipeType');if(t)t.value='';
  const b=document.getElementById('wipeGoBtn');if(b)b.disabled=true;
  om('wipeModal');
  setTimeout(()=>{const el=document.getElementById('wipeType');if(el)el.focus();},60);
}
function wipeCheck(){
  const t=document.getElementById('wipeType'),b=document.getElementById('wipeGoBtn');
  if(t&&b)b.disabled=(t.value.trim().toUpperCase()!==_wipeWord.toUpperCase());
}
function wipeCancel(){cm('wipeModal');_wipeCb=null;}
function wipeGo(){
  const t=document.getElementById('wipeType');
  if(!t||t.value.trim().toUpperCase()!==_wipeWord.toUpperCase())return;
  const cb=_wipeCb;_wipeCb=null;cm('wipeModal');
  if(cb)cb();
}
async function clearTable(table,label){
  wipeAsk('DELETE',`Delete every one of your ${label}`,
    `This empties the ${table} table in Supabase. Everything anyone has entered there goes, for all users, immediately.`,
    async()=>{
    logAudit('Table cleared',`${label} (${table}) — emptied from Settings`);
    setSyncStatus('syncing');
    const res=await sb.from(table).delete().neq('id','00000000-0000-0000-0000-000000000000');
    if(res.error){setSyncStatus('error');toast(`Error clearing ${label}`,'er');return;}
    setSyncStatus('synced');
    if(table==='prep_rows'){rows=[];renderPrep();renderDashboard();updateCB();}
    if(table==='actions'){claims=[];renderClaims();updateCB();}
    if(table==='ship_boxes'){shipBoxes={};}
    toast(`✓ All ${label} cleared`);
  });
}
/* ── BACKUP ────────────────────────────────────────────────────────────────
   Jack, before pointing the sync at the real purchase tracker: "wanna add a
   export and save on prep hub incase we fuck up".
   Saves what the browser currently holds — which is everything the app loaded
   from the database — into one JSON file. Read-only: it writes nothing back,
   sends nothing anywhere, and cannot itself lose data.
   Restoring is deliberately NOT here. Putting rows back needs care about ids
   and duplicates, and a half-tested restore button is more dangerous than no
   button at all. The file holds everything needed to put things right. */
function _bkSafe(fn,d){try{const v=fn();return v===undefined?d:v;}catch(e){return d;}}
function downloadBackup(kind){
  if(histGate())return;
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  let blob,name;
  if(kind==='csv'){
    const cols=['id','uuid','sku','asin','prod','sup','acct','oid','date','exp','rcvd','ship','status',
                'issueType','issueQty','shipId','sent','sentDate','archived','notes','sheetSyncId'];
    const esc2=v=>{const t=String(v==null?'':v);return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
    const lines=[cols.join(',')].concat((rows||[]).map(r=>cols.map(c=>esc2(r[c])).join(',')));
    blob=new Blob([lines.join('\n')],{type:'text/csv'});
    name='prephub-prep-rows-'+stamp+'.csv';
  }else{
    const data={
      _backup:'BDL PrepHub',
      _takenAt:new Date().toISOString(),
      /* BUILD is a const inside the Lavarion module, invisible from here —
         read the version off the page instead so a backup always says which
         build produced it. */
      _build:_bkSafe(()=>(document.querySelector('.ver')||{}).textContent||document.title,''),
      _by:_bkSafe(()=>_who(),''),
      _warning:'A snapshot of what one browser had loaded. Not a database dump — rows another person added since this page loaded are not in here.',
      prepRows:_bkSafe(()=>rows,[]),
      actions:_bkSafe(()=>claims,[]),
      vaActions:_bkSafe(()=>VA_ACTIONS,[]),
      shipBoxes:_bkSafe(()=>shipBoxes,{}),
      lavAsins:_bkSafe(()=>lavAsins,[]),
      lavShipments:_bkSafe(()=>lavShipments,[]),
      returnSkus:_bkSafe(()=>returnSkus,[]),
      returnShipments:_bkSafe(()=>returnShipments,[]),
      /* the Lavarion module keeps its own copies — stock batches and purchases
         are the ones that carry money, so they matter most of all */
      lavLayers:_bkSafe(()=>(window.LV3&&LV3.__layers?LV3.__layers():null),null),
      lavPurchases:_bkSafe(()=>(window.LV3&&LV3.__purch?LV3.__purch():null),null),
      syncSources:_bkSafe(()=>_ssSources,[]),
      syncConfig:_bkSafe(()=>_ssConfig,{})
    };
    const counts=Object.keys(data).filter(k=>Array.isArray(data[k])).map(k=>k+':'+data[k].length).join(' · ');
    data._counts=counts;
    blob=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});
    name='prephub-backup-'+stamp+'.json';
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);
  const el=document.getElementById('bkStamp');
  if(el)el.textContent='Saved '+name+' \u2014 '+Math.round(blob.size/1024)+' KB';
  try{logAudit('Backup downloaded',name);}catch(e){}
  try{toast('\u2713 Backup saved to your Downloads');}catch(e){}
}
async function clearEverything(){
  wipeAsk('WIPE EVERYTHING','Empty the prep sheet, the actions and the Lavarion catalogue',
    'Every prep row, every action, every box count and every Lavarion ASIN — for everyone, immediately. Meant for starting fresh after a trial, not for tidying up.',
    async()=>{
    /* The audit log and the shipment records are NOT touched. A wipe that
       deletes the record of the wipe leaves nobody able to say what was here,
       and a shipment that physically went to Amazon happened whatever this
       button does. */
    logAudit('ALL DATA WIPED','prep rows, actions, box counts and Lavarion ASINs — audit log and shipment records kept');
    setSyncStatus('syncing');
    await Promise.all([
      sb.from('prep_rows').delete().neq('id','00000000-0000-0000-0000-000000000000'),
      sb.from('actions').delete().neq('id','00000000-0000-0000-0000-000000000000'),
      sb.from('ship_boxes').delete().neq('id','00000000-0000-0000-0000-000000000000'),
      sb.from('lavarion_asins').delete().neq('id','00000000-0000-0000-0000-000000000000'),
    ]);
    // Also clear sync history from app_settings
    await sb.from('app_settings').delete().eq('key','sync_history').catch(()=>{});
    _syncHistory.length=0;
    /* lavShipments and audit are deliberately NOT emptied here — they were not
       deleted, and blanking them on screen would say they had been. */
    rows=[];claims=[];shipBoxes={};lavAsins=[];
    renderPrep();renderDashboard();renderClaims();updateCB();
    updateSyncHealthUI();
    setSyncStatus('synced');
    toast('✓ Wiped — audit log and shipment records kept');
  });
}
