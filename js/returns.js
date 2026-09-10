/* BDL PrepHub — js/returns.js — returns, add returns to shipment, prep cost calculator, shipment edits, Lavarion shipment lines, new shipment.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── RETURNS ───────────────────────────────────────────────────────────────────
let returnSkus=[];
let returnShipments=[];
let _retEditId=null;
let _retShipId=null;
let _retLineCount=0;

// Derive a human-readable product description for a return SKU/line. Return SKUs
// are often bulk-pasted with no product name, so this looks the SKU/ASIN up in
// the prep sheet and the Lavarion catalogue. When found, the name is cached back
// onto the object so other views pick it up. Falls back to a short descriptor
// built from the SKU parts (supplier · type) so there's always something more
// identifiable than the raw encoded SKU.
// Product/name for a return line. Only the explicit name the user typed (single
// add) or supplied after the "-" in bulk add is shown. No auto-fill from prep
// rows/catalogue and no synthesised "supplier · type" descriptor — empty stays
// empty so the column reflects exactly what was entered.
function retProdDesc(o){
  return (o&&o.prod&&String(o.prod).trim())?String(o.prod).trim():'';
}

function renderReturns(){
  const w=document.getElementById('returnsList');
  if(w&&!w.classList.contains('retWrap'))w.classList.add('retWrap');
  const q=(_retQ||'').toLowerCase();
  const gbp=n=>'£'+(n||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  /* Imported names arrive as "logitech", "df cm", "4711 - dg". Presentation
     tidies the capitalisation; the stored value is never touched. */
  const nice=t=>String(t||'').trim().replace(/\s+/g,' ')
    .replace(/\b[a-z]/g,c=>c.toUpperCase());

  /* Say what is actually wrong, not just "needs attention" — the row has to
     name its own problem or somebody still has to go and find out. */
  const stateOf=r=>{
    const ship=(typeof returnShipments!=='undefined'?returnShipments:[]).filter(x=>x.sku===r.sku);
    /* The typed-in cost is the one a person checked; the SKU string is only the
       fallback. The shipment picker already worked this way — the page did not,
       so the same return could show two different prices in two places. */
    const cog=(r.cog>0?r.cog:0)||parseSKU(r.sku).cogs||0;
    const named=!!String(r.prod||'').trim();
    /* The quantity that means anything is the one on the shipment lines. This
       list holds one row per return so the SKU can be found quickly — there is
       no "logged quantity" to be part-way through. */
    const sent=ship.reduce((a,x)=>a+(x.units||0),0);
    const value=ship.reduce((a,x)=>a+(x.units||0)*(x.cost||cog||0),0);
    const base={ship,cog,named,sent,value};
    if(!named)return{k:'attn',label:'Product name missing',col:'#fbbf24',...base};
    if(!cog)  return{k:'attn',label:'Cost missing',col:'#fbbf24',...base};
    return ship.length?{k:'ship',label:'In shipment',col:'#4ade80',...base}
                      :{k:'none',label:'Not shipped',col:'#94a3b8',...base};
  };
  const all=returnSkus.map(r=>({r,st:stateOf(r)}));
  const nAll=all.length, nShip=all.filter(x=>x.st.k==='ship').length,
        nNone=all.filter(x=>x.st.k==='none').length, nAttn=all.filter(x=>x.st.k==='attn').length;
  /* This summed the cost of ONE unit of each return and called it a value.
     A value is a price times a quantity, and the only real quantity is the one
     on the shipment lines — so that is what it counts. A return not yet on a
     shipment has no quantity anywhere, so it is counted, not valued. */
  const totalVal=all.reduce((t,x)=>t+x.st.value,0);
  const totalUnits=all.reduce((t,x)=>t+x.st.sent,0);
  let data=all.filter(({r})=>!q||((r.sku||'')+(r.asin||'')+(r.prod||'')).toLowerCase().includes(q));
  if(_retFilter!=='all')data=data.filter(x=>x.st.k===_retFilter);

  const kpi=(label,val,sub,col)=>`<div class="retKpi" style="border-top:3px solid ${col};">
      <div class="retKpiL">${label}</div>
      <div class="retKpiV" style="color:${col};">${val}</div>
      <div class="retKpiS">${sub||''}</div></div>`;
  const chip=(k,label,n)=>`<button class="retPill${_retFilter===k?' on':''}" onclick="setRetFilter('${k}')">${label} <b>${n}</b></button>`;

  const header=`<div class="retHead">
      <p>Track returned inventory, shipment progress and recovery value.</p>
      <div class="retHeadBtns">
        <button class="retBtn bulk" onclick="openBulkAddReturns()">Bulk add SKUs</button>
        <button class="retBtn warn" onclick="bulkRemoveShippedReturns()"
          title="Clear every return already in a shipment off this list. They stay on the Shipments page.">Remove all in-shipment</button>
        <button class="retPrimary" onclick="openAddReturn()">+ Add single SKU</button>
      </div>
    </div>
    <div class="retKpis">
      ${kpi('Total returns',nAll,'being tracked','#93c5fd')}
      ${kpi('Value going back',gbp(totalVal),totalUnits?`${fmt(totalUnits)} unit${totalUnits===1?'':'s'} on shipments`:'nothing on a shipment yet','#fbbf24')}
      ${kpi('In shipment',nShip,nNone?`${nNone} not on one yet`:(nAll?'all on their way':'—'),'#4ade80')}
      ${kpi('Needs attention',nAttn,nAttn?'missing name or cost':'all accounted for',nAttn?'#f87171':'#4ade80')}
    </div>
    <div class="retBar">
      <div class="retSearch">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="4"/><line x1="10" y1="10" x2="13" y2="13"/></svg>
        <input id="returnSrch" value="${esc(_retQ||'')}" placeholder="Search returns by product, SKU or ASIN"
          oninput="_retQ=this.value;renderReturns();" autocomplete="off">
      </div>
      <div class="retChips">
        ${chip('all','All',nAll)}${chip('ship','In shipment',nShip)}${chip('none','Not shipped',nNone)}${chip('attn','Needs attention',nAttn)}
      </div>
    </div>`;

  if(!nAll){w.innerHTML=header+`<div class="empty" style="padding:50px;"><div class="empty-t">No returns yet — press “Add return”.</div></div>`;return;}

  const sel=_retSel;
  const bulkBar=sel.size?`<div class="retBulk">
      <span><b>${sel.size}</b> selected</span>
      <button class="retBtn" onclick="retBulkClear()">Clear</button>
      <span style="flex:1"></span>
      <button class="retBtn danger" onclick="retBulkRemove()">Remove from this list</button>
    </div>`:'';

  w.innerHTML=header+bulkBar+`<table>
    <colgroup><col style="width:34px"><col style="width:30%"><col style="width:13%"><col style="width:9%"><col style="width:26%"><col style="width:150px"></colgroup>
    <thead><tr>
      <th><input type="checkbox" ${sel.size&&sel.size===data.length?'checked':''} onchange="retSelAll(this.checked)"></th>
      <th>Return</th><th>Status</th><th style="text-align:right;">Cost / unit</th><th>Shipments</th><th>Actions</th>
    </tr></thead><tbody>
    ${data.map(({r,st})=>{
      const units=st.ship.reduce((a,x)=>a+(x.units||0),0);
      const ids=[...new Set(st.ship.map(x=>x.shipId))];
      const raw=String(r.sku||''); const m=raw.match(/^(\S+)\s*[-–—]+\s*(.+)$/);
      const code=m?m[1]:raw, buried=m?m[2]:'';
      const title=st.named?nice(r.prod):(buried?nice(buried):'Product name missing');
      const on=sel.has(r.uuid);
      return `<tr class="${on?'sel':''}${st.k==='attn'?' attn':''}">
        <td><input type="checkbox" ${on?'checked':''} onchange="retSel('${r.uuid}',this.checked)"></td>
        <td>
          <div class="retTitle${st.named?'':' missing'}" onclick="openEditReturn('${r.uuid}')" style="cursor:pointer;">${esc(title)}</div>
          <div class="retSub" title="${raw.replace(/"/g,'&quot;')}" onclick="copyVal('${code.replace(/'/g,"\\'")}',this)">${esc(code)}${r.asin?' · '+esc(r.asin):''}</div>
          ${st.named?'':`<div class="retFix" onclick="openEditReturn('${r.uuid}')">Add product details</div>`}
        </td>
        <td><span class="retChip" style="color:${st.col};background:${st.col}1f;border-color:${st.col}55;">${st.label}</span></td>
        <td class="retCog${st.cog?'':' miss'}">${st.cog?gbp(st.cog):'Missing'}</td>
        <td>${st.ship.length
          ? `<div class="retUnits">${ids.length} shipment${ids.length===1?'':'s'} · ${units} unit${units===1?'':'s'}</div>
             <div class="retShipId" title="${ids.join(', ')}">${ids.join(', ')}</div>`
          : '<span style="color:var(--text3);">—</span>'}</td>
        <td class="retActs">
          <button class="retAct" onclick="openEditReturn('${r.uuid}')">Edit</button>
          ${st.ship.length
            ? `<button class="retAct go" onclick="deleteReturnSku('${r.uuid}',true)" title="Take it off this active list — it stays on the Shipments page">Done — remove</button>`
            : `<button class="retAct del" onclick="deleteReturnSku('${r.uuid}',false)" title="Delete this return SKU">Delete</button>`}
        </td>
      </tr>`;}).join('')}
    </tbody></table>
    <div class="retFoot">${data.length===nAll?`${nAll} return${nAll===1?'':'s'}`:`${data.length} of ${nAll} returns`}</div>`;
}
let _retFilter='all', _retQ='', _retSel=new Set();
function setRetFilter(k){_retFilter=k;renderReturns();}
function retSel(id,on){on?_retSel.add(id):_retSel.delete(id);renderReturns();}
function retSelAll(on){_retSel.clear();if(on)document.querySelectorAll('#page-returns tbody input[type=checkbox]').forEach(c=>{const m=c.getAttribute('onchange').match(/'([^']+)'/);if(m)_retSel.add(m[1]);});renderReturns();}
function retBulkClear(){_retSel.clear();renderReturns();}
/* Mass removal is hidden until rows are selected, and always confirms —
   it used to sit in the toolbar styled green, which is the colour of safe. */
function retBulkRemove(){
  const n=_retSel.size; if(!n)return;
  if(!confirm(`Take ${n} return${n===1?'':'s'} off this active list?\n\nAnything already in a shipment stays on the Shipments page. Nothing is deleted from history.`))return;
  [..._retSel].forEach(id=>{try{deleteReturnSku(id,true);}catch(e){}});
  _retSel.clear();renderReturns();
}
function retMenu(ev,uuid,shipped){
  ev.stopPropagation();
  document.querySelectorAll('.retMenu').forEach(m=>m.remove());
  const b=ev.currentTarget, m=document.createElement('div');
  m.className='retMenu';
  const go=`document.querySelectorAll('.retMenu').forEach(x=>x.remove());`;
  m.innerHTML=`<button onclick="${go}openEditReturn('${uuid}')">Edit details</button>`
    +(shipped?`<button onclick="${go}deleteReturnSku('${uuid}',true)">Done — take off this list</button>`
             :`<button class="bad" onclick="${go}deleteReturnSku('${uuid}',false)">Delete</button>`);
  b.parentElement.appendChild(m);
  setTimeout(()=>document.addEventListener('click',function h(){m.remove();document.removeEventListener('click',h);},{once:true}),0);
}

// Rows bulk-added BEFORE the parser was fixed have the " - name" text baked into
// the stored SKU (e.g. "Arg_263.2_387_Jac_1_Ret - garmin nav"). This repair finds
// them, splits the name into the Product field, and saves the corrected rows to
// Supabase. It also handles the case where a clean copy of the SKU already exists
// (e.g. you re-added it): instead of creating a duplicate-key clash it copies the
// name onto the clean row and deletes the dirty one. Idempotent and safe to re-run.
function legacyReturnRows(){
  return returnSkus.filter(r=>/\s-\s/.test(r.sku||''));
}
async function repairLegacyReturnSkus(silent){
  const bad=legacyReturnRows();
  if(!bad.length){if(!silent)toast('No legacy rows to fix');return;}
  let fixed=0,merged=0,failed=0;
  for(const r of bad){
    const m=String(r.sku).match(/^(.*?)\s-\s(.*)$/);
    if(!m)continue;
    const cleanSku=m[1].trim();
    const name=m[2].trim();
    if(!cleanSku){failed++;continue;}
    // A different, already-clean row with this SKU? Merge into it, drop the dirty dupe.
    const dupe=returnSkus.find(x=>x!==r&&x.uuid&&x.sku===cleanSku);
    if(dupe){
      if(name&&(!dupe.prod||!String(dupe.prod).trim())){
        dupe.prod=name;
        const u=await sb.from('returns_skus').update({product_name:dupe.prod}).eq('id',dupe.uuid);
        if(u.error){console.error('Repair merge update error:',u.error);}
      }
      if(r.uuid){
        const del=await sb.from('returns_skus').delete().eq('id',r.uuid);
        if(del.error){console.error('Repair delete error:',del.error);failed++;continue;}
      }
      const idx=returnSkus.indexOf(r);if(idx>=0)returnSkus.splice(idx,1);
      merged++;
      continue;
    }
    // No clash — clean this row in place.
    r.sku=cleanSku;
    if(!r.prod||!String(r.prod).trim())r.prod=name;
    if(r.uuid){
      const upd=await sb.from('returns_skus').update({sku:r.sku,product_name:r.prod}).eq('id',r.uuid);
      if(upd.error){console.error('Legacy return repair error:',upd.error);if(!silent)toast('Repair failed for '+cleanSku+': '+upd.error.message,'er');failed++;continue;}
    }
    fixed++;
  }
  renderReturns();
  if(fixed||merged||failed||!silent){
    const parts=[];
    if(fixed)parts.push(`${fixed} cleaned`);
    if(merged)parts.push(`${merged} duplicate${merged!==1?'s':''} merged`);
    if(failed)parts.push(`${failed} failed`);
    toast((failed?'⚠ ':'✓ ')+(parts.join(' · ')||'nothing to fix'),failed?'er':undefined);
  }
  logAudit('Return SKUs repaired',`${fixed} cleaned, ${merged} merged, ${failed} failed`);
}

function openBulkAddReturns(){
  document.getElementById('bulkReturnInput').value='';
  document.getElementById('bulkReturnPreview').innerHTML='';
  bulkReturnScan();
  om('bulkReturnModal');
  setTimeout(()=>{const el=document.getElementById('bulkReturnInput');if(el)el.focus();},120);
}

/* One parser, used by both the preview and the save, so what you are shown is
   exactly what gets added. Splitting on " - " (space-dash-space) rather than a
   bare dash keeps SKUs that contain dashes intact. */
function parseReturnLines(raw){
  const seen={};
  return String(raw||'').split('\n').map(s=>s.trim()).filter(Boolean).map(line=>{
    const m=line.match(/^(.*?)(?:\s+-\s+|\s*[|\t]\s*)(.*)$/);
    const sku=(m?m[1]:line).trim(), name=(m?m[2]:'').trim();
    if(!sku)return null;
    let cog=0;try{cog=parseSKU(sku).cogs||0;}catch(e){cog=0;}
    let state='new',why='will be added';
    if(seen[sku]){state='dupe';why='same SKU earlier in this list';}
    else if(returnSkus.find(r=>r.sku===sku&&r.uuid)){state='have';why='already on the returns list';}
    else if(!cog){state='nocog';why='no COG could be read out of this SKU';}
    seen[sku]=1;
    const match=(typeof rows!=='undefined'?rows:[]).find(r=>r.sku===sku);
    return{sku,name,cog,state,why,asin:(match&&match.asin)||''};
  }).filter(Boolean);
}
/* Paste-and-hope was the problem: nothing was shown until after the save, and
   anything already on the list was skipped in silence — five lines in, three
   added, no word about the other two. Now every line reports itself before
   anything is written. */
function bulkReturnScan(){
  const box=document.getElementById('bulkReturnPreview');
  const btn=document.getElementById('bulkReturnGo');
  if(!box)return;
  const raw=(document.getElementById('bulkReturnInput')||{}).value||'';
  const list=parseReturnLines(raw);
  const ok=list.filter(x=>x.state==='new'||x.state==='nocog');
  if(btn){btn.disabled=!ok.length;btn.style.opacity=ok.length?'1':'.45';
    btn.textContent=ok.length?`Add ${ok.length} SKU${ok.length===1?'':'s'}`:'Add SKUs';}
  if(!list.length){box.innerHTML='';return;}
  const skipped=list.length-ok.length;
  const TAG={new:['#4ade80','new'],nocog:['#fbbf24','no COG'],
             have:['#94a3b8','already added'],dupe:['#94a3b8','repeat']};
  box.innerHTML=`
    <div class="brSum">
      <b>${ok.length}</b> to add${skipped?` · <b style="color:#94a3b8">${skipped}</b> skipped` : ''}
      ${list.some(x=>x.state==='nocog')?` · <b style="color:#fbbf24">${list.filter(x=>x.state==='nocog').length}</b> with no COG`:''}
    </div>
    <div class="brList">
      ${list.map(x=>{const t=TAG[x.state];
        return `<div class="brRow ${x.state}">
          <span class="brSku">${esc(x.sku)}</span>
          <span class="brCog">${x.cog?('£'+x.cog.toFixed(2)):'—'}</span>
          <span class="brNm">${x.name?esc(x.name):'<i>no name</i>'}</span>
          <span class="brState" style="color:${t[0]};border-color:${t[0]}55">${t[1]}</span>
        </div>`;}).join('')}
    </div>
    ${skipped?`<div class="brNote">Skipped lines are left exactly as they are — nothing on the returns list is changed or overwritten.</div>`:''}`;
}

async function saveBulkReturns(){
  const raw=document.getElementById('bulkReturnInput').value;
  // Each line is "SKU - name" — the name part is optional.
  // Separator is " - " (space-dash-space), "|", or a tab. Using space-dash-space
  // (not a bare "-") means SKUs that contain dashes, e.g. "MY-OTE3-R49A", stay intact.
  // The match is non-greedy so only the FIRST separator splits the line.
  // Same parser the preview uses, so what was shown is exactly what goes in.
  const all=parseReturnLines(raw);
  if(!all.length){toast('Paste at least one SKU','er');return;}
  const lines=all.filter(x=>x.state==='new'||x.state==='nocog');
  const skipped=all.length-lines.length;
  if(!lines.length){toast('Every one of those is already on the list','er');return;}
  const btn=document.getElementById('bulkReturnGo');
  if(btn){btn.disabled=true;btn.textContent=`Adding ${lines.length}…`;}
  let added=0,failed=0;
  for(const {sku,name,cog,asin} of lines){
    // Product name is only set from the explicit name after the "-". No auto-fill.
    const obj={uuid:null,sku,asin:asin||'',prod:name||'',cog,units:1,notes:''};
    const res=await sb.from('returns_skus').insert({sku:obj.sku,asin:obj.asin,product_name:obj.prod,cog:obj.cog,units:obj.units,notes:obj.notes}).select().single();
    if(res.error){console.error('Bulk return SKU insert error:',res.error);toast('Save failed for '+sku+': '+res.error.message,'er');failed++;continue;}
    if(res.data)obj.uuid=res.data.id;
    returnSkus.push(obj);
    added++;
  }
  cm('bulkReturnModal');
  renderReturns();
  /* Say what was left out. Adding 3 of 5 and reporting "3 added" is how a
     missing SKU goes unnoticed until someone counts the shelf. */
  toast(`✓ ${added} return SKU${added!==1?'s':''} added${skipped?` · ${skipped} already on the list`:''}${failed?` · ${failed} failed`:''}`);
  logAudit('Bulk return SKUs added',`${added} added${skipped?`, ${skipped} skipped as duplicates`:''}${failed?`, ${failed} failed`:''}`);
}

function openAddReturn(){
  _retEditId=null;
  document.getElementById('returnModalTitle').textContent='Add Return SKU';
  document.getElementById('ret-sku').value='';
  document.getElementById('ret-asin').value='';
  document.getElementById('ret-prod').value='';
  document.getElementById('ret-cog').value='';
  document.getElementById('ret-units').value='1';
  document.getElementById('ret-notes').value='';
  om('returnModal');
  setTimeout(()=>{const el=document.getElementById('ret-sku');if(el)el.focus();},120);
}

function onRetSkuInput(){
  const sku=document.getElementById('ret-sku').value;
  const cog=parseSKU(sku).cogs;
  const cogEl=document.getElementById('ret-cog');
  if(cog>0&&cogEl)cogEl.value=cog.toFixed(2);
  // COG auto-fills from the SKU; ASIN fills from a matching prep row if found.
  // Product name is NOT auto-filled — it stays whatever the user types.
  const match=rows.find(r=>r.sku===sku);
  const asinEl=document.getElementById('ret-asin');
  if(match){
    if(asinEl)asinEl.value=match.asin||'';
  }
}

function openEditReturn(uuid){
  const r=returnSkus.find(x=>x.uuid===uuid);if(!r)return;
  _retEditId=uuid;
  document.getElementById('returnModalTitle').textContent='Edit Return SKU';
  document.getElementById('ret-sku').value=r.sku||'';
  document.getElementById('ret-asin').value=r.asin||'';
  document.getElementById('ret-prod').value=r.prod||'';
  document.getElementById('ret-cog').value=r.cog||parseSKU(r.sku).cogs||'';
  document.getElementById('ret-units').value=r.units||1;
  document.getElementById('ret-notes').value=r.notes||'';
  om('returnModal');
}

async function saveReturnSku(){
  const sku=document.getElementById('ret-sku').value.trim();
  if(!sku){toast('SKU is required','er');return;}
  const cog=parseFloat(document.getElementById('ret-cog').value)||parseSKU(sku).cogs||0;
  const units=parseInt(document.getElementById('ret-units').value)||1;
  const obj={
    uuid:_retEditId||null,
    sku,
    asin:document.getElementById('ret-asin')?.value?.trim()||'',
    prod:document.getElementById('ret-prod')?.value?.trim()||'',
    cog,units,
    notes:document.getElementById('ret-notes').value.trim(),
    shipped:false,
  };
  if(_retEditId){
    const i=returnSkus.findIndex(x=>x.uuid===_retEditId);
    if(i>=0)returnSkus[i]=obj;
    const upd=await sb.from('returns_skus').update({sku:obj.sku,asin:obj.asin,product_name:obj.prod,cog:obj.cog,units:obj.units,notes:obj.notes}).eq('id',obj.uuid);
    if(upd.error){console.error('Return SKU update error:',upd.error);toast('Save failed: '+upd.error.message,'er');return;}
  }else{
    const res=await sb.from('returns_skus').insert({sku:obj.sku,asin:obj.asin,product_name:obj.prod,cog:obj.cog,units:obj.units,notes:obj.notes}).select().single();
    if(res.error){console.error('Return SKU insert error:',res.error);toast('Save failed: '+res.error.message,'er');return;}
    if(res.data)obj.uuid=res.data.id;
    returnSkus.push(obj);
  }
  const wasEdit=!!_retEditId;
  _retEditId=null;
  cm('returnModal');renderReturns();
  toast(`✓ Return SKU ${wasEdit?'updated':'added'}`);
}

// Bulk-clear every return SKU that's already attached to a shipment from the
// active list. The returns_shipments rows are untouched, so each SKU stays
// permanently under its shipment(s) on the Shipments page.
async function bulkRemoveShippedReturns(){
  const shipped=returnSkus.filter(r=>returnShipments.some(s=>s.sku===r.sku));
  if(!shipped.length){toast('No in-shipment returns to remove','er');return;}
  showConfirm(`Remove ${shipped.length} in-shipment return${shipped.length!==1?'s':''}?`,
    `These are all already attached to a shipment. They'll be cleared from this active list but stay permanently under their shipment(s) on the Shipments page.`,
    async()=>{
      const ids=shipped.map(r=>r.uuid).filter(Boolean);
      returnSkus=returnSkus.filter(r=>!shipped.includes(r));
      renderReturns();
      setSyncStatus('syncing');
      let failed=0;
      for(const id of ids){
        const res=await sb.from('returns_skus').delete().eq('id',id);
        if(res.error)failed++;
      }
      setSyncStatus(failed?'error':'synced');
      logAudit('Returns bulk-removed from active list',`${ids.length-failed} cleared (kept in shipments)`);
      toast(failed?`Removed ${ids.length-failed}, ${failed} failed`:`✓ Removed ${ids.length} from active list (kept in shipments)`);
    });
}
async function deleteReturnSku(uuid,isShipped){
  const r=returnSkus.find(x=>x.uuid===uuid);
  const sku=r?r.sku:'';
  // IMPORTANT: this only deletes from returns_skus (the active list). The
  // returns_shipments rows stay untouched, so the SKU remains visible forever
  // under its shipment(s) on the Shipments page for research/reference.
  const title=isShipped?'Remove from active returns?':'Delete Return SKU?';
  const msg=isShipped
    ?`"${sku}" stays permanently attached to its shipment(s) on the Shipments page — this just clears it from your active returns list.`
    :'This removes the SKU from your returns list. It has not been attached to any shipment.';
  showConfirm(title,msg,async()=>{
    returnSkus=returnSkus.filter(x=>x.uuid!==uuid);
    renderReturns();
    const res=await sb.from('returns_skus').delete().eq('id',uuid);
    if(res.error){toast('Remove failed: '+res.error.message,'er');return;}
    logAudit(isShipped?'Return removed from active list':'Return SKU deleted',sku);
    toast(isShipped?'✓ Removed from active list (kept in shipment)':'Return SKU deleted');
  });
}

// ── ADD RETURNS TO SHIPMENT ───────────────────────────────────────────────────
function openRetShip(shipId){
  _retShipId=shipId;
  _retLineCount=0;
  document.getElementById('retShipModalTitle').textContent='Returns on '+shipId;
  document.getElementById('retShipLines').innerHTML='';
  renderRetShipExisting();
  addRetShipLine();
  om('retShipModal');
}

// List returns already attached to the current shipment, with edit + remove.
function renderRetShipExisting(){
  const box=document.getElementById('retShipExisting');
  if(!box)return;
  const mine=returnShipments.filter(rs=>rs.shipId===_retShipId);
  if(!mine.length){
    box.innerHTML='<div style="font-size:12px;color:var(--text3);background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:10px 12px;margin-bottom:14px;">Nothing coming back on this shipment yet.</div>';
    return;
  }
  const units=mine.reduce((a,b)=>a+(b.units||0),0);
  const value=mine.reduce((a,b)=>a+((b.units||0)*(b.cost||0)),0);
  box.innerHTML=`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.045em;">Already coming back</div>
      <div style="font-size:12px;color:var(--text2);"><b style="color:var(--text)">${fmt(units)}</b> units · <b style="color:var(--text)">${fmtGBP2(value)}</b></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${mine.map(rs=>`
        <div style="display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:9px 11px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(retProdDesc(rs)||rs.sku)}</div>
            <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-top:1px;">${esc(rs.sku)}${rs.cost?' · £'+(rs.cost).toFixed(2)+'/unit':''}</div>
          </div>
          <input type="number" min="1" value="${rs.units||1}" id="ret-existing-units-${rs.uuid}" title="Units coming back"
            style="width:62px;padding:4px 6px;background:var(--bg);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-size:13px;font-family:var(--mono);text-align:center;">
          <button onclick="saveRetShipLine('${rs.uuid}')" title="Save the new unit count" style="padding:4px 9px;background:var(--btn-green-bg);border:1px solid var(--btn-green-border);color:var(--btn-green-text);border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">Save</button>
          <button onclick="deleteRetShipLine('${rs.uuid}')" title="Take this return off the shipment" style="padding:4px 9px;background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">Remove</button>
        </div>`).join('')}
    </div>`;
}

// Update the units on an already-attached return.
async function saveRetShipLine(uuid){
  const rs=returnShipments.find(x=>x.uuid===uuid);if(!rs)return;
  const inp=document.getElementById('ret-existing-units-'+uuid);
  const units=parseInt(inp?.value)||0;
  if(units<=0){toast('Units must be greater than 0','er');return;}
  rs.units=units;
  const res=await sb.from('returns_shipments').update({units}).eq('id',uuid);
  if(res.error){toast('Update failed: '+res.error.message,'er');return;}
  renderRetShipExisting();renderShipments();renderReturns();renderDashboard();
  toast('✓ Units updated');
  logAudit('Return units updated',`${rs.sku} → ${rs.shipId} (${units})`);
}

// Detach a return from THIS shipment (deletes the returns_shipments row only).
async function deleteRetShipLine(uuid){
  const rs=returnShipments.find(x=>x.uuid===uuid);if(!rs)return;
  showConfirm('Remove from shipment?',
    `Detaches "${rs.sku}" (${rs.units} ${rs.units===1?'unit':'units'}) from ${rs.shipId}. The return SKU stays on your Returns page.`,
    async()=>{
      returnShipments=returnShipments.filter(x=>x.uuid!==uuid);
      const res=await sb.from('returns_shipments').delete().eq('id',uuid);
      if(res.error){toast('Remove failed: '+res.error.message,'er');return;}
      renderRetShipExisting();renderShipments();renderReturns();renderDashboard();
      toast('✓ Return removed from shipment');
      logAudit('Return detached from shipment',`${rs.sku} ✕ ${rs.shipId}`);
    });
}

function addRetShipLine(){
  const idx=_retLineCount++;
  const container=document.getElementById('retShipLines');
  const div=document.createElement('div');
  div.id=`rsl-${idx}`;
  div.style.cssText='background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:11px 12px;margin-bottom:8px;';
  div.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.045em;">Return ${idx+1}</div>
      ${idx>0?`<button onclick="document.getElementById('rsl-${idx}').remove()" title="Drop this line" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;">&#10005;</button>`:''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 76px 92px;gap:8px;align-items:end;">
      <div style="position:relative;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Return SKU</div>
        ${/* Same fix as the Lavarion picker, same reason: a <select> cannot be
             typed into, so finding one return SKU meant scrolling a list of
             every return you have ever taken. Type the product name. */''}
        <input class="fi-in" id="rsl-search-${idx}" autocomplete="off"
          placeholder="Type a product, SKU or ASIN…" style="font-size:12px;"
          oninput="rslFilter(${idx})" onfocus="rslFilter(${idx})"
          onkeydown="if(event.key==='Escape'){rslHide(${idx});this.blur();}">
        <input type="hidden" id="rsl-sku-${idx}" value="">
        <div id="rsl-pop-${idx}" style="display:none;position:absolute;z-index:60;left:0;right:0;top:100%;
          margin-top:3px;max-height:230px;overflow:auto;background:var(--bg2);border:1px solid var(--border2);
          border-radius:7px;box-shadow:0 12px 26px rgba(0,0,0,.55);"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Units</div>
        <input class="fi-in" type="number" id="rsl-units-${idx}" min="1" placeholder="0" style="font-size:12px;"
          oninput="rslCheck(${idx})">
      </div>
      <div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">COG/Unit £</div>
        <input class="fi-in" type="number" id="rsl-cost-${idx}" min="0" step="0.01" placeholder="auto"
          title="Taken from the return SKU. Type over it only if this batch genuinely cost something else."
          style="font-size:12px;" oninput="this.dataset.touched='1';rslCheck(${idx});">
      </div>
    </div>
    <div id="rsl-info-${idx}" style="font-size:11px;color:var(--text3);margin-top:5px;"></div>
  `;
  container.appendChild(div);
  setTimeout(()=>{const el=document.getElementById('rsl-search-'+idx);if(el)el.focus();},30);
}

/* the return-SKU picker */
function _rslRows(){
  const on={};(returnShipments||[]).forEach(rs=>{if(rs.shipId===_retShipId)on[rs.sku]=(on[rs.sku]||0)+(rs.units||0);});
  /* returnSkus is a lookup list — one row per return SKU, added so a SKU can be
     found fast when building a shipment. Its `units` field is not a stock count
     (bulk import hard-codes 1, and Jack adds one row per return rather than
     tracking quantities here), so nothing may reason from it. The real
     quantities live on returnShipments, and `already` comes from there. */
  return (returnSkus||[]).map(r=>({
      sku:r.sku||'',asin:r.asin||'',name:retProdDesc(r)||r.sku||'',
      already:on[r.sku]||0,
      cog:(r.cog>0?r.cog:(parseSKU(r.sku||'').cogs||0))||null
    })).sort((a,b)=>a.name.localeCompare(b.name));
}
function rslHide(idx){const p=document.getElementById('rsl-pop-'+idx);if(p)p.style.display='none';}
function rslFilter(idx){
  const inp=document.getElementById('rsl-search-'+idx),pop=document.getElementById('rsl-pop-'+idx);
  if(!inp||!pop)return;
  const q=(inp.value||'').trim().toLowerCase();
  let rows=_rslRows();
  if(q)rows=rows.filter(r=>((r.name||'')+' '+(r.sku||'')+' '+(r.asin||'')).toLowerCase().includes(q));
  if(!rows.length){
    pop.innerHTML='<div style="padding:9px 11px;font-size:11.5px;color:var(--text3)">'+
      (returnSkus.length?'Nothing matches that':'No return SKUs set up yet — add them on the Returns page first')+'</div>';
    pop.style.display='block';return;
  }
  pop.innerHTML=rows.slice(0,40).map(r=>{
    const cog=(r.cog==null)?'<span style="color:var(--text3)">no price yet</span>'
      :`<span style="color:var(--amber)">£${r.cog.toFixed(2)}</span>`;
    const qty=r.already?`<span style="color:var(--blue)">${r.already} already on this shipment</span>`:'';
    return `<div onclick="rslPick(${idx},'${String(r.sku).replace(/'/g,"\\'")}')"
      style="padding:8px 11px;cursor:pointer;border-bottom:1px solid var(--border);"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">
      <div style="font-size:12.5px;font-weight:700;color:var(--text);">${esc(r.name)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">
        ${esc(r.sku||'no SKU')}${r.asin?' · '+esc(r.asin):''} &nbsp;·&nbsp; ${cog}${qty?' &nbsp;·&nbsp; '+qty:''}</div>
    </div>`;}).join('');
  pop.style.display='block';
}
function rslPick(idx,sku){
  const r=_rslRows().find(x=>x.sku===sku);
  const inp=document.getElementById('rsl-search-'+idx);
  const hid=document.getElementById('rsl-sku-'+idx);
  const cost=document.getElementById('rsl-cost-'+idx);
  const units=document.getElementById('rsl-units-'+idx);
  if(hid)hid.value=sku;
  if(inp)inp.value=(r&&r.name)||sku;
  /* the COG the return was booked at, filled in for you and still editable */
  if(cost&&r&&r.cog!=null&&!cost.dataset.touched)cost.value=r.cog.toFixed(2);
  /* deliberately does not guess the quantity — it is typed per shipment */
  rslHide(idx);
  rslCheck(idx);
}
function rslCheck(idx){
  const hid=document.getElementById('rsl-sku-'+idx);
  const box=document.getElementById('rsl-info-'+idx);
  if(!box)return;
  const sku=hid&&hid.value;
  if(!sku){box.innerHTML='';return;}
  const r=_rslRows().find(x=>x.sku===sku);
  if(!r){box.innerHTML='';return;}
  const cost=document.getElementById('rsl-cost-'+idx);
  if(cost&&r.cog!=null&&!cost.dataset.touched)cost.value=r.cog.toFixed(2);
  const want=parseInt((document.getElementById('rsl-units-'+idx)||{}).value)||0;
  const rate=parseFloat((cost||{}).value)||0;
  const bits=['SKU: '+(r.sku?esc(r.sku):'<span style="color:var(--text3)">none set</span>')];
  if(r.asin)bits.push(esc(r.asin));
  if(r.cog!=null)bits.push(`COG £${r.cog.toFixed(2)} <span style="color:var(--text3)">from the return SKU</span>`);
  else bits.push('<span style="color:var(--amber)">no price on record — type the COG</span>');
  if(want>0&&rate>0)bits.push(`<b style="color:var(--text)">${fmtGBP2(want*rate)}</b> of stock back`);
  let warn='';
  if(r.already)warn+=`<div style="margin-top:5px;color:var(--blue);">${r.already} of this SKU already on ${_retShipId} — these units are added to that line, not a second one.</div>`;
  box.innerHTML=bits.join(' · ')+warn;
}

/* onRslSelect went with the <select> it was wired to — rslPick/rslCheck do this now. */
async function confirmRetShip(){
  if(!_retShipId){toast('No shipment selected','er');return;}
  if(!returnSkus.length){toast('No return SKUs set up — add them on the Returns page first','er');return;}
  const lines=[],stop=[];
  document.querySelectorAll('[id^="rsl-sku-"]').forEach(sel=>{
    const idx=sel.id.split('-').pop();
    const sku=(sel.value||'').trim();
    const units=parseInt(document.getElementById(`rsl-units-${idx}`)?.value)||0;
    const cost=parseFloat(document.getElementById(`rsl-cost-${idx}`)?.value)||0;
    if(!sku||units<=0)return;
    const r=_rslRows().find(x=>x.sku===sku);
    /* No quantity check against returnSkus: that list is a lookup, its units
       field is not a stock count, and checking against it only ever produced a
       warning about a number nobody maintains. */
    if(cost<=0)stop.push(`${(r&&r.name)||sku}: no COG on the line.`);
    lines.push({shipId:_retShipId,sku,prod:(r&&r.name)||sku,asin:(r&&r.asin)||'',units,cost,
      date:shipDateFor(_retShipId)});
  });
  if(stop.length){toast(stop[0],'er');return;}
  if(!lines.length){toast('Pick a return and enter units above 0','er');return;}
  let saved=0,merged=0;
  for(const entry of lines){
    /* The same SKU twice on one shipment made two rows that every total then
       counted separately. One shipment, one line per SKU — the units go up. */
    const twin=returnShipments.find(x=>x.shipId===entry.shipId&&x.sku===entry.sku&&x.uuid);
    if(twin){
      const was=twin.units||0;
      twin.units=was+entry.units;
      if(entry.cost>0)twin.cost=entry.cost;
      const res=await sb.from('returns_shipments').update({units:twin.units,cost:twin.cost}).eq('id',twin.uuid);
      if(res.error){twin.units=was;toast('Save failed: '+res.error.message,'er');continue;}
      merged++;
      logAudit('Return units added to shipment',`${entry.sku} → ${entry.shipId} (${was} + ${entry.units} = ${twin.units})`);
    }else{
      const res=await sb.from('returns_shipments').insert({ship_id:entry.shipId,sku:entry.sku,product_name:entry.prod,units:entry.units,cost:entry.cost,date:entry.date}).select().single();
      if(res.error){console.error('Return shipment insert error:',res.error);toast('Save failed: '+res.error.message,'er');continue;}
      if(res.data)entry.uuid=res.data.id;
      returnShipments.push(entry);
      saved++;
      logAudit('Returns added to shipment',`${entry.sku} x${entry.units} → ${entry.shipId}`);
    }

  }
  if(!saved&&!merged)return;
  cm('retShipModal');renderShipments();renderReturns();renderDashboard();
  const bits=[];
  if(saved)bits.push(`${saved} return${saved!==1?'s':''} added`);
  if(merged)bits.push(`${merged} line${merged!==1?'s':''} topped up`);
  toast('✓ '+bits.join(', ')+' on '+_retShipId);
}

// Cache for shipment types (persists across re-renders)
const _shipTypeCache={};

// ── PREP COST CALCULATOR ──────────────────────────────────────────────────────
const PREP_FEE_DEFAULTS={
  tier1Units:1000,tier1p:0.50,
  tier2Units:3000,tier2p:0.45,
  tier3Units:5000,tier3p:0.35,
  tier4p:0.30,
  // Daily/weekly prep estimates are priced at the rate implied by a TYPICAL
  // month's volume (not their own tiny volume), since the prep bill is monthly.
  // 2,000 lands in the 1,001–3,000 band → the 45p rate.
  expectedMonthlyUnits:2000,
  boxCost:1.00,
  dgExtraPerBox:2.50,
  osCostPerUnit:1.50,
  bundleCostPerUnit:0.60,
  vatRate:1.20,
};
let prepFees={...PREP_FEE_DEFAULTS};
/* The prep fee rates lived ONLY in this browser's localStorage — so when Jack
   changed a rate, Becki's machine kept the old one and every money figure on
   her dashboard quietly disagreed with his. Rates are shared numbers; they live
   in Supabase now, with localStorage kept as an instant-start cache. */
function loadPrepFees(){
  try{const s=localStorage.getItem('prepFees');if(s)prepFees={...PREP_FEE_DEFAULTS,...JSON.parse(s)};}catch(e){}
  try{sb.from('app_settings').select('value').eq('key','prep_fees').maybeSingle().then(r=>{
    if(r&&r.data&&r.data.value){
      try{prepFees={...PREP_FEE_DEFAULTS,...JSON.parse(r.data.value)};
        localStorage.setItem('prepFees',JSON.stringify(prepFees));
        if(typeof renderDashboard==='function')renderDashboard();
      }catch(e){}
    }else{
      /* first machine to load after this fix seeds the shared copy */
      sb.from('app_settings').upsert({key:'prep_fees',value:JSON.stringify(prepFees)},{onConflict:'key'})
        .then(()=>{});
    }
  });}catch(e){}
}
function savePrepFees(){
  localStorage.setItem('prepFees',JSON.stringify(prepFees));
  try{sb.from('app_settings').upsert({key:'prep_fees',value:JSON.stringify(prepFees)},{onConflict:'key'})
    .then(r=>{if(r&&r.error)console.warn('prep fees save',r.error);});}catch(e){}
}
// Prep is billed as a VOLUME flat-rate, not progressive brackets: the total
// number of units in the period decides ONE per-unit rate, and EVERY unit is
// charged at that rate. e.g. 1,183 units → falls in the 1,001–3,000 band → all
// 1,183 units × the tier-2 rate (not 1,000 @ tier1 + 183 @ tier2).
function pickUnitRate(units){
  if(units<=prepFees.tier1Units)return prepFees.tier1p;
  if(units<=prepFees.tier2Units)return prepFees.tier2p;
  if(units<=prepFees.tier3Units)return prepFees.tier3p;
  return prepFees.tier4p;
}
// Human-readable band label for the volume the units fall into.
function unitRateBand(units){
  if(units<=prepFees.tier1Units)return '1–'+fmt(prepFees.tier1Units);
  if(units<=prepFees.tier2Units)return (prepFees.tier1Units+1)+'–'+fmt(prepFees.tier2Units);
  if(units<=prepFees.tier3Units)return (prepFees.tier2Units+1)+'–'+fmt(prepFees.tier3Units);
  return fmt(prepFees.tier3Units+1)+'+';
}
function calcTieredRate(units){
  return units*pickUnitRate(units);
}
/* SMART PREP BAND, 30 Aug (Jack): "over the past 2 months I've hit 3,000 —
   from the 1st it should know it'll do the 3,000 band again." The band floor
   is no longer the hand-typed expected volume: it is the AVERAGE of the last
   three completed months' actual tiered units (Standard+DG+Lavarion — the same
   pool the band prices). One unit prepped on the 1st is priced at the volume
   this operation genuinely runs. The manual setting survives as a minimum for
   brand-new months with no history. */
let _smartExpCache=null;
function smartExpectedInfo(){
  if(_smartExpCache)return _smartExpCache;
  const manual=prepFees.expectedMonthlyUnits||0;
  let out={v:manual,src:'your setting',months:0};
  try{
    const now=new Date();
    const vals=[];
    for(let k=1;k<=2;k++){
      const d=new Date(now.getFullYear(),now.getMonth()-k,1);
      const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const seg=r=>(r._segUnits!=null)?r._segUnits:(r.ship||0);
      const rs=rows.filter(r=>r.sent==='Yes'&&r.sentDate&&r.sentDate.slice(0,7)===ym
        &&(!r.shipType||r.shipType==='Standard'||r.shipType==='DG')&&r.inBundle!=='Yes')
        .reduce((a,r)=>a+seg(r),0);
      const lv=lavShipments.filter(s=>s.date&&String(s.date).slice(0,7)===ym)
        .reduce((a,s)=>a+(s.units||0),0);
      const t=rs+lv;if(t>0)vals.push(t);
    }
    if(vals.length){
      /* the BEST recent month, not the average — a ramp-up month must not
         drag the assumed volume below what this operation now runs at */
      const best=Math.max.apply(null,vals);
      if(best>manual)out={v:best,src:'your best of the last '+vals.length+' month'+(vals.length===1?'':'s'),months:vals.length};
      else out={v:manual,src:'your setting (recent months ran lower)',months:vals.length};
    }
  }catch(e){}
  _smartExpCache=out;return out;
}
const smartExpectedUnits=()=>smartExpectedInfo().v;
function calcImpliedPrepCost(sentRows,sentLavRows,boxMap,rateUnits){
  // rateUnits (optional): the volume used to PICK the per-unit rate. Defaults to
  // this period's own tiered units (correct for the monthly figure). Daily/weekly
  // tiles pass the typical monthly volume so they're priced at the realistic
  // monthly rate rather than their own small volume.
  // Standard/DG/Lavarion → tiered rate pool
  // Oversize → £1.50 flat per unit
  // Bundle → 60p flat per unit
  // Standard boxes → £1.00, DG boxes → £2.50 (full rate, not £1+extra)
  // When a row carries _segUnits it represents one shipment's slice of a
  // split SKU — use that instead of the row's full ship count.
  const u=r=>(r._segUnits!=null)?r._segUnits:(r.ship||0);
  const stdUnits=sentRows.filter(r=>(!r.shipType||r.shipType==='Standard')&&r.inBundle!=='Yes').reduce((a,r)=>a+u(r),0);
  const osUnits=sentRows.filter(r=>r.shipType==='Oversize').reduce((a,r)=>a+u(r),0);
  const dgUnits=sentRows.filter(r=>r.shipType==='DG').reduce((a,r)=>a+u(r),0);
  const bundleUnits=sentRows.filter(r=>r.inBundle==='Yes').reduce((a,r)=>a+u(r),0);
  const lavUnits=sentLavRows.reduce((a,s)=>a+(s.units||0),0);
  const tieredUnits=stdUnits+dgUnits+lavUnits;
  // rateUnits acts as a FLOOR on the band volume: price at your typical monthly
  // volume unless you have already sent more (which earns a cheaper high-volume
  // band). This stops early-month periods dropping into the 1-1,000 band when a
  // full month will land far higher. Completed periods pass no rateUnits and use
  // their own actual volume.
  const _rateVol=(rateUnits!=null&&rateUnits>0)?Math.max(tieredUnits,rateUnits):tieredUnits;
  const baseCost=tieredUnits*pickUnitRate(_rateVol);
  const osCost=osUnits*prepFees.osCostPerUnit;
  const bundleCost=bundleUnits*prepFees.bundleCostPerUnit;
  const dgBoxes=Object.entries(boxMap).filter(([sid])=>(_shipTypeCache[sid]||'Standard')==='DG').reduce((a,[,b])=>a+(b||0),0);
  const stdBoxes=Object.values(boxMap).reduce((a,b)=>a+(b||0),0)-dgBoxes;
  const boxCostTotal=(stdBoxes+dgBoxes)*prepFees.boxCost;
  const totalBoxes=stdBoxes+dgBoxes;
  const totalUnits=stdUnits+osUnits+dgUnits+bundleUnits+lavUnits;
  const subtotal=baseCost+osCost+bundleCost+boxCostTotal;
  return{totalUnits,stdUnits,osUnits,dgUnits,bundleUnits,lavUnits,tieredUnits,
    baseCost,osCost,bundleCost,boxCostTotal,dgBoxes,stdBoxes,totalBoxes,
    unitRate:pickUnitRate(_rateVol),unitRateBand:unitRateBand(_rateVol),
    subtotal,withVat:subtotal*prepFees.vatRate};
}

function updateShipmentType(shipId,type){
  _shipTypeCache[shipId]=type;
  // Update any row that has a segment in this shipment (matches split rows too,
  // where the row's primary shipId may be a different shipment).
  rows.forEach(r=>{
    const segs=normaliseSegments(r);
    const hit=segs.find(s=>s.shipId===shipId);
    if(!hit)return;
    hit.type=type;
    r.shipSegments=segs;
    if(r.shipId===shipId)r.shipType=type; // primary segment → mirror onto row
    r._dirty=true;saveRow(r);
  });
  // Save to ship_boxes so type persists for Lavarion-only shipments
  const boxPayload={ship_id:shipId,boxes:shipBoxes[shipId]||0,ship_type:type};
  sb.from('ship_boxes').upsert(boxPayload,{onConflict:'ship_id'}).then(res=>{
    if(res.error){console.error('ship_boxes save error:',res.error);}
  });
  try{renderNoBoxBanner();}catch(e){}
  toast('Shipment type updated to '+type);
  renderShipments();
}

// ── EDIT / DELETE A WHOLE SHIPMENT ────────────────────────────────────────────
let _editShipId=null;
// Gather everything attached to a shipment ID: OA rows (via segments), Lavarion
// lines and Return lines.
function shipmentContents(shipId){
  const oaRows=rows.filter(r=>normaliseSegments(r).some(sg=>sg.shipId===shipId));
  const lav=lavShipments.filter(ls=>ls.shipId===shipId);
  const ret=returnShipments.filter(rs=>rs.shipId===shipId);
  const oaUnits=oaRows.reduce((a,r)=>a+normaliseSegments(r).filter(sg=>sg.shipId===shipId).reduce((x,sg)=>x+(sg.units||0),0),0);
  const lavUnits=lav.reduce((a,l)=>a+(l.units||0),0);
  const retUnits=ret.reduce((a,r)=>a+(r.units||0),0);
  return{oaRows,lav,ret,oaUnits,lavUnits,retUnits};
}

function openEditShipment(shipId){
  _editShipId=shipId;
  const c=shipmentContents(shipId);
  document.getElementById('editShipModalTitle').textContent='Edit Shipment — '+shipId;
  // Pre-fill date from first segment of this shipment
  const _editC=shipmentContents(shipId);
  const _editFirstSeg=(_editC.oaRows[0]?.shipSegments||[]).find(s=>s.shipId===shipId);
  const _editDate=_editFirstSeg?.date||_editC.oaRows[0]?.sentDate||'';
  const _editDateEl=document.getElementById('editShipDate');
  if(_editDateEl&&_editDate)_editDateEl.value=_editDate;
  document.getElementById('editShipNewId').value=shipId;
  document.getElementById('editShipSummary').innerHTML=
    `<b style="color:var(--text);">${shipId}</b> currently holds: `+
    [c.oaRows.length?`${c.oaRows.length} SKU line${c.oaRows.length!==1?'s':''} (${c.oaUnits} unit${c.oaUnits!==1?'s':''})`:'',
     c.lav.length?`${c.lav.length} Lavarion line${c.lav.length!==1?'s':''} (${c.lavUnits} unit${c.lavUnits!==1?'s':''})`:'',
     c.ret.length?`${c.ret.length} Return${c.ret.length!==1?'s':''} (${c.retUnits} unit${c.retUnits!==1?'s':''})`:''
    ].filter(Boolean).join(' · ')||'nothing.';
  document.getElementById('editShipDeleteDesc').innerHTML=
    `Sent SKUs go back to the prep sheet as <b>In Warehouse</b> (their Sent status &amp; Shipment ID are cleared — nothing is deleted, so you can re-send them). Any Lavarion lines and Returns on this shipment are detached. Use this only if the whole shipment was created by mistake.`;
  om('editShipModal');
}

async function saveShipmentDate(){
  const shipId=_editShipId;
  const newDate=(document.getElementById('editShipDate').value||'').trim();
  if(!shipId)return;
  if(!newDate){toast('Pick a date first','er');return;}
  const c=shipmentContents(shipId);
  setSyncStatus('syncing');
  for(const r of c.oaRows){
    const segs=normaliseSegments(r);
    segs.forEach(sg=>{if(sg.shipId===shipId)sg.date=newDate;});
    r.shipSegments=segs;
    r.sentDate=newDate;
    r._dirty=true;
    await saveRow(r);
  }
  for(const ls of c.lav){
    ls.date=newDate;
    /* the column is sent_date — writing `date` failed silently, so Lavarion
       lines kept the old date while the prep rows moved */
    if(ls.uuid){const r=await sb.from('lavarion_shipments').update({sent_date:newDate}).eq('id',ls.uuid);
      if(r.error)console.warn('[ship date] lav',r.error);}
  }
  setSyncStatus('synced');
  cm('editShipModal');
  renderShipments();renderPrep();renderDashboard();
  toast(`✓ Date updated to ${newDate.split('-').reverse().join('/')}`);
  logAudit('Shipment date changed',`${shipId} → ${newDate}`);
}
async function saveShipmentRename(){
  if(histGate())return;
  const oldId=_editShipId;
  const newId=(document.getElementById('editShipNewId').value||'').trim().toUpperCase();
  if(!oldId)return;
  if(!newId){toast('Enter a new Shipment ID','er');return;}
  if(newId===oldId){toast('That is already the ID','er');cm('editShipModal');return;}
  const c=shipmentContents(oldId);
  setSyncStatus('syncing');
  // OA rows: rename the matching segment + legacy mirrors.
  for(const r of c.oaRows){
    const segs=normaliseSegments(r);
    segs.forEach(sg=>{if(sg.shipId===oldId)sg.shipId=newId;});
    r.shipSegments=segs;
    r.allShipIds=[...new Set(segs.map(sg=>sg.shipId))];
    if(r.shipId===oldId)r.shipId=newId;
    r._dirty=true;await saveRow(r);
  }
  // Lavarion lines.
  for(const ls of c.lav){
    ls.shipId=newId;
    if(ls.uuid)await sb.from('lavarion_shipments').update({ship_id:newId}).eq('id',ls.uuid);
  }
  // Returns.
  for(const rs of c.ret){
    rs.shipId=newId;
    if(rs.uuid)await sb.from('returns_shipments').update({ship_id:newId}).eq('id',rs.uuid);
  }
  // Carry box count + type cache across to the new ID.
  if(shipBoxes[oldId]!=null){shipBoxes[newId]=shipBoxes[oldId];delete shipBoxes[oldId];saveShipBoxes(newId,shipBoxes[newId]);}
  if(_shipTypeCache[oldId]){_shipTypeCache[newId]=_shipTypeCache[oldId];delete _shipTypeCache[oldId];}
  setSyncStatus('synced');
  cm('editShipModal');
  renderShipments();renderPrep();renderDashboard();
  toast(`✓ Renamed ${oldId} → ${newId}`);
  logAudit('Shipment renamed',`${oldId} → ${newId}`);
}

async function deleteShipment(){
  if(histGate())return;
  const shipId=_editShipId;if(!shipId)return;
  const c=shipmentContents(shipId);
  // Close the Edit Shipment modal FIRST so the confirm dialog isn't stacked on
  // top of it (two overlays = doubled-up dimmer / black screen).
  cm('editShipModal');
  showConfirm('Remove this shipment?',
    `Removes "${shipId}". Sent SKUs go back to the prep sheet as In Warehouse so you can re-send them (nothing is deleted). ${c.lav.length+c.ret.length>0?`${c.lav.length} Lavarion line(s) and ${c.ret.length} return(s) on it are detached.`:''}`,
    async()=>{
      setSyncStatus('syncing');
      // OA rows: remove this shipment's segment; if it was the row's only
      // shipment, revert the row to In Warehouse (un-sent) keeping its data.
      for(const r of c.oaRows){
        const segs=normaliseSegments(r).filter(sg=>sg.shipId!==shipId);
        r.shipSegments=segs;
        r.allShipIds=[...new Set(segs.map(sg=>sg.shipId))];
        if(segs.length){
          r.shipId=segs[segs.length-1].shipId;
          r.ship=segs.reduce((a,sg)=>a+(sg.units||0),0);
          r.status='Part Sent';r.sent='No';
        }else{
          r.shipId='';r.ship=0;r.status='In Warehouse';r.sent='No';r.sentDate='';
        }
        // Coming back into the active workflow → make sure it's visible on the
        // prep sheet, not stuck behind "Show Archived".
        r.archived=false;
        r._dirty=true;await saveRow(r);
      }
      // Detach Lavarion lines — and put their stock back, exactly as removing
      // one line does. OA rows return to the prep sheet here; Lavarion units
      // were staying consumed by a shipment that no longer existed.
      let putBack=0;
      for(const ls of c.lav){
        if(ls.uuid)await sb.from('lavarion_shipments').delete().eq('id',ls.uuid);
        try{const b=(window.LV3&&LV3.shipRestore)?LV3.shipRestore(ls.asin,ls.units||0):null;
            if(b)putBack+=b.restored;}catch(e){}
      }
      lavShipments=lavShipments.filter(ls=>ls.shipId!==shipId);
      if(putBack){try{if(window.LV3&&LV3.render)LV3.render();}catch(e){}
        logAudit('Lavarion stock returned',`${putBack} units back on the shelf from ${shipId}`);}
      // Detach Returns (the return SKU itself stays on the Returns page).
      for(const rs of c.ret){if(rs.uuid)await sb.from('returns_shipments').delete().eq('id',rs.uuid);}
      returnShipments=returnShipments.filter(rs=>rs.shipId!==shipId);
      // Clear box count.
      if(shipBoxes[shipId]!=null){delete shipBoxes[shipId];sb.from('ship_boxes').delete().eq('ship_id',shipId);}
      delete _shipTypeCache[shipId];
      setSyncStatus('synced');
      renderShipments();renderPrep();renderDashboard();
      toast(`✓ Shipment ${shipId} removed`);
      logAudit('Shipment removed',shipId);
    });
}

/* Jack, 7 Sep: "a dropdown or popup for more info" — one place with everything
   the app holds on a row or claim: order, units, both notes with who wrote
   them, the case, the warehouse question, and every step in order. */
function jkStory(kind,id){
  const H=[];const when=t=>t?esc(_logWhen(t)):'';
  const line=(k,v)=>{if(v===undefined||v===null||v==='')return;H.push(`<div class="jkSt"><span>${k}</span><div>${v}</div></div>`);};
  let title='';
  if(kind==='lavlate'){
    const g=((window.LV3&&LV3.lavLateList)?LV3.lavLateList():[]).find(x=>x.key===id);if(!g){toast('Order not found','er');return;}
    title=g.name||'Late order';let tj=null;try{tj=g.toJack?JSON.parse(g.toJack):null;}catch(e){}
    line('Order',esc(g.oid||'—')+(g.sup?' · '+esc(g.sup):'')+(g.acct?' · '+esc(g.acct):''));
    line('Units',fmt(g.owed)+' still owed'+(g.cost?' · '+fmtGBP2(g.cost)+' at stake':''));
    line('Ordered',g.ordered?esc(_dmy(g.ordered))+' · '+g.days+' days ago':'—');
    line('Was due',g.eta?esc(_dmy(g.eta)):'no window set');
    if(tj)line('Sent to Jack',when(tj.at)+(tj.by?' by '+esc(tj.by):'')+(tj.note?' — '+esc(tj.note):''));
    let ts=null;try{ts=g.toSarah?JSON.parse(g.toSarah):null;}catch(e){}
    if(ts)line('Job for Sarah',when(ts.at)+(ts.by?' from '+esc(ts.by):'')+(ts.note?' — '+esc(ts.note):''));
  }else if(kind==='claim'){
    const c=claims.find(x=>String(x.id)===String(id));if(!c){toast('Claim not found','er');return;}
    title=c.prod||c.sku||'Claim';
    line('Order',esc(c.oid||'—')+(c.sup?' · '+esc(c.sup):'')+(c.acct?' · '+esc(c.acct):''));
    line('SKU / ASIN',esc(c.sku||'')+(c.asin?' · '+esc(c.asin):''));
    line('Issue',esc(c.issT||'')+((c.dif||c.exp)?' · '+fmt(c.dif||c.exp)+' units':'')+(c.claimValue?' · '+fmtGBP2(c.claimValue):''));
    line('Raised',when(c.raisedAt)+(c.raisedBy?' by '+esc(c.raisedBy):''));
    line('Status',esc(c.cst||'')+(c.owner?' · with '+esc(c.owner):''));
    line('Next action',esc(c.nextAction||''));
    line('Notes',esc(c.notes||''));line('VA note',esc(c.vaNote||''));line('Jack note',esc(c.jackNote||''));
    const lg=(c.log||[]).slice().reverse();
    if(lg.length)line('History',lg.map(L=>`<div class="stLog"><span class="stLogWhen">${esc(String(L.t||'').slice(0,17))}</span> — ${esc(L.msg||'')}</div>`).join(''));
  }else{
    const r=_rowById(id);if(!r){toast('Row not found','er');return;}
    title=r.prod||r.sku||'Row';const q=r.resolution||{};
    line('Order',esc(r.oid||'—')+(r.sup?' · '+esc(r.sup):'')+(r.acct?' · '+esc(r.acct):'')+(r.date?' · ordered '+esc(r.date):''));
    line('SKU / ASIN',esc(r.sku||'')+(r.asin?' · '+esc(r.asin):''));
    line('Units',`${fmt(r.exp||0)} expected · ${fmt(parseInt(r.rcvd)||0)} received · ${fmt(parseInt(r.ship)||0)} shipped${_cxLabel(r)} · ${esc(r.status||'')}`);
    if(q.wentAs)line('Went out under',`<b>${esc(q.wentAs)}</b> — ${esc(q.by||'Sarah')} confirmed in Seller Central${q.at?', '+when(q.at):''}${q.wentAsQty?' · '+fmt(q.wentAsQty)+' unit'+(q.wentAsQty===1?'':'s'):''}`);
    if(r.expectedDelivery)line('Expected delivery',esc(_dmy(r.expectedDelivery)));
    if(r.notes)line('Packing notes',esc(r.notes)+(r.notesBy?` <i>— ${esc(r.notesBy)}${r.notesAt?', '+when(r.notesAt):''}</i>`:''));
    if(r.vaNote)line('VA note',esc(r.vaNote).replace(/\n/g,'<br>')+(r.vaNoteBy?` <i>— ${esc(r.vaNoteBy)}${r.vaNoteAt?', '+when(r.vaNoteAt):''}</i>`:''));
    if(q.state)line('Case',esc(q.state)+(q.what?' · '+esc(typeof _resText==='function'?_resText(q.what):q.what):'')+(q.by?' · by '+esc(q.by):'')+(q.at?' · '+when(q.at):''));
    line('Sarah asked',esc(q.ask||''));line('Her note',esc(q.note||''));line('She suggests',esc(q.fix||''));
    if(q.rejectNote)line('Answer given',esc(q.rejectNote)+(q.rejectedBy?' — '+esc(q.rejectedBy):''));
    const Q=(typeof _ukQuery==='function')?_ukQuery(r):null;
    if(Q)line('Warehouse question',esc(Q.ask||'')+(Q.note?' — “'+esc(Q.note)+'”':'')+(Q.by?' · '+esc(Q.by):'')+(Q.at?' · '+when(Q.at):'')+(Q.answer?'<br>Answer: '+esc(Q.answer)+(Q.reply?' — '+esc(Q.reply):''):''));
    const lg=((q.chase&&q.chase.log)||[]).slice().reverse();
    if(lg.length)line('History',lg.map(L=>`<div class="stLog"><span class="stLogWhen">${when(L.at)}</span>${L.by?' · <b>'+esc(L.by)+'</b>':''} — ${esc(L.what||'')}</div>`).join(''));
  }
  document.getElementById('jkStoryTitle').textContent=title;
  document.getElementById('jkStoryBody').innerHTML=H.join('')||'<div style="color:var(--text3);font-size:12px;">Nothing recorded on this one yet.</div>';
  om('jkStoryModal');
}
// ── LAVARION SHIPMENT LINE EDIT ───────────────────────────────────────────────
let _editLavLineId=null;
/* Becki, 7 Sep: a line recorded while the Lavarion data had not loaded left
   every part on the bench. The hook now refuses that; this is the repair for
   a line that already went through. Deliberately one click, one confirm, and
   named in the audit log — it takes stock off, so it must be seen. */
function lavLineConsumeNow(){
  const ls=lavShipments.find(s=>s.uuid===_editLavLineId||(s.uuid||String(lavShipments.indexOf(s)))===String(_editLavLineId));
  if(!ls)return;
  const n=parseInt(ls.units)||0;if(!n){toast('No units on this line','er');return;}
  showConfirm('Take the parts off for this line?',
    `<b>${n} × ${esc(ls.prod||ls.asin)}</b> on ${esc(ls.shipId||'')}.<br><br>Every part in its build list comes off the bench now, oldest batch first, exactly as the send should have done. Only do this once per line — check the Components tab still shows the stock first.`,
    async()=>{
      if(!(window.LV3&&LV3.shipConsume)){toast('Lavarion page not available','er');return;}
      if(!(LV3.isReady&&LV3.isReady())){try{await LV3.boot();}catch(e){}}
      if(!(LV3.isReady&&LV3.isReady())){toast('Lavarion stock is not loaded — reload the page and try again','er');return;}
      const r=LV3.shipConsume(ls.asin,n);
      if(!r){toast(`${ls.prod||ls.asin} is not a product the Lavarion page knows`,'er');return;}
      if(r.over>0){try{LV3.noteOverSent(ls.asin,r.over,ls.shipId);}catch(e){}
        toast(`Only ${fmt(r.consumed)} were on the bench — ${fmt(r.over)} recorded as owed`,'er');}
      /* do not say done until the database has it — a toast on a debounced
         save is how a green tick and a stale shelf happened on the same day */
      let _saved=true;try{if(LV3.flush)await LV3.flush();}catch(e){_saved=false;}
      if(!_saved)toast('Taken off on screen but the save FAILED — check the sync badge, then Settings → Check the database','er');
      else if(!(r.over>0))toast(`✓ Parts for ${fmt(n)} × ${ls.prod||ls.asin} taken off the bench and saved`,'ok');
      try{logAudit('Lavarion parts taken off by hand',`${ls.asin} x${n} on ${ls.shipId} — the send had not taken them off (${window.currentUserName||'someone'})`);}catch(e){}
      cm('editLavLineModal');
      try{LV3.render();}catch(e){}
      try{renderShipments();}catch(e){}
    });
}
function editLavShipLine(uuid){

  const ls=lavShipments.find(s=>s.uuid===uuid||(s.uuid||String(lavShipments.indexOf(s)))===String(uuid));
  if(!ls)return;
  _editLavLineId=uuid;
  document.getElementById('editLavUnits').value=ls.units||0;
  document.getElementById('editLavCog').value=ls.cost||0;
  document.getElementById('editLavProd').textContent=ls.prod;
  om('editLavLineModal');
}
function saveEditLavLine(){
  const ls=lavShipments.find(s=>s.uuid===_editLavLineId||(s.uuid||String(lavShipments.indexOf(s)))===String(_editLavLineId));
  if(!ls)return;
  const was=parseInt(ls.units)||0;
  ls.units=parseInt(document.getElementById('editLavUnits').value)||0;
  ls.cost=parseFloat(document.getElementById('editLavCog').value)||0;
  /* This wrote straight to the database and skipped the stock entirely, so
     changing 14 to 4 left ten units consumed by nothing. Move the difference. */
  const delta=ls.units-was;
  if(delta!==0){
    try{
      if(delta>0&&window.LV3&&LV3.shipConsume){
        const r=LV3.shipConsume(ls.asin,delta);
        if(r&&r.over>0){
          try{LV3.noteOverSent(ls.asin,r.over,ls.shipId);}catch(e){}
          toast(`⚠ Only ${r.consumed} of the extra ${delta} were in stock — ${r.over} recorded as owed.`,'er');
        }
      }else if(delta<0&&window.LV3&&LV3.shipRestore){
        LV3.shipRestore(ls.asin,-delta);
      }
      if(window.LV3&&LV3.render)LV3.render();
    }catch(e){console.warn('[lav3] edit line stock',e);}
    logAudit('Lavarion line units changed',
      `${ls.asin} on ${ls.shipId}: ${was} → ${ls.units} (${delta>0?'+':''}${delta} on stock)`);
  }
  // Save to Supabase
  setSyncStatus('syncing');
  sb.from('lavarion_shipments').update({units:ls.units,cost:ls.cost}).eq('id',ls.uuid).then(()=>setSyncStatus('synced'));
  cm('editLavLineModal');
  renderShipments();
  toast('Lavarion line updated ✓');
}
// Remove a Lavarion ASIN line from a shipment entirely (e.g. added to the wrong
// shipment ID by accident). Deletes the shipment entry only — the ASIN stays in
// the Lavarion catalogue, and any OTHER shipments keep their own entries.
function delLavShipLine(uuid){
  const ls=lavShipments.find(s=>s.uuid===uuid||(s.uuid||String(lavShipments.indexOf(s)))===String(uuid));
  if(!ls){toast('Could not find that line','er');return;}
  showConfirm('Remove from shipment?',
    `This removes ${ls.prod||ls.asin} (${ls.units||0} unit${(ls.units||0)!==1?'s':''}) from shipment ${ls.shipId}. The ASIN stays in your Lavarion catalogue and other shipments are unaffected.`,
    ()=>{
      setSyncStatus('syncing');
      if(ls.uuid){
        sb.from('lavarion_shipments').delete().eq('id',ls.uuid)
          .then(()=>setSyncStatus('synced'))
          .catch(()=>setSyncStatus('error'));
      }else{setSyncStatus('synced');}
      lavShipments=lavShipments.filter(s=>s!==ls);
      /* the line goes, so the stock comes back — otherwise the units were
         consumed by a shipment that no longer exists */
      let back=null;
      try{if(window.LV3&&LV3.shipRestore)back=LV3.shipRestore(ls.asin,ls.units||0);}catch(e){}
      logAudit('Lavarion removed from shipment',
        `${ls.asin} x ${ls.units} from ${ls.shipId}`+(back?` — ${back.restored} put back on the shelf`:''));
      if(back&&back.short>0)toast(`${back.restored} put back; ${back.short} could not be — those batches were already full.`,'er');
      try{if(window.LV3&&LV3.render)LV3.render();}catch(e){}
      renderShipments();
      if(document.getElementById('page-admin')&&document.getElementById('page-admin').classList.contains('active'))renderAdmin();
      toast('Removed from shipment ✓');
    });
}
// ── EDIT A RETURN LINE ON A SHIPMENT ─────────────────────────────────────────
// Mirrors editLavShipLine — opens the modal pre-filled with this return's units
// and cost. Looked up by the returns_shipments row uuid.
let _editRetLineId=null;
function editRetShipLine(uuid){
  const rs=returnShipments.find(s=>String(s.uuid)===String(uuid));
  if(!rs){toast('Could not find that return line','er');return;}
  _editRetLineId=rs.uuid;
  document.getElementById('editRetUnits').value=rs.units||0;
  document.getElementById('editRetCog').value=rs.cost||0;
  document.getElementById('editRetProd').textContent=rs.prod||rs.sku||'';
  om('editRetLineModal');
}
async function saveEditRetLine(){
  const rs=returnShipments.find(s=>String(s.uuid)===String(_editRetLineId));
  if(!rs)return;
  const units=parseInt(document.getElementById('editRetUnits').value)||0;
  if(units<=0){toast('Units must be greater than 0','er');return;}
  rs.units=units;
  rs.cost=parseFloat(document.getElementById('editRetCog').value)||0;
  if(rs.uuid){
    const res=await sb.from('returns_shipments').update({units:rs.units,cost:rs.cost}).eq('id',rs.uuid);
    if(res.error){toast('Update failed: '+res.error.message,'er');return;}
  }
  cm('editRetLineModal');
  renderShipments();renderReturns();renderDashboard();
  toast('Return line updated ✓');
  logAudit('Return units updated',`${rs.sku} → ${rs.shipId} (${units})`);
}

let _shipLavOnly=false;
/* Jack, 19 Aug: "default should always open on today". It opened on
   month-to-date, and groups sort oldest-first, so today's shipment — the one
   thing the page is opened for — was the LAST item after weeks of history. */
let _shipDateFilter='today';
let _shipShowAll=false;   // the render cap is lifted only on request
function toggleShipLavFilter(){
  _shipLavOnly=!_shipLavOnly;
  const btn=document.getElementById('shipLavBtn');
  if(btn){
    btn.style.background=_shipLavOnly?'rgba(204,153,255,.2)':'var(--bg2)';
    btn.style.color=_shipLavOnly?'#cc99ff':'var(--text3)';
    btn.style.borderColor=_shipLavOnly?'#cc99ff':'rgba(204,153,255,.4)';
  }
  renderShipments();
}

/* Jump to the shipments behind a headline number, with the right period already
   selected — the tiles on the prep sheet call this. */
/* A number you can see but not act on is a number you have to rebuild by hand
   in the filter bar. Clicking the tile sets the status filter and scrolls to
   the rows it counted. */
function statFilter(status){
  const sel=document.getElementById('statusFilter')||document.querySelector('#page-prep select');
  if(sel){
    sel.value=(sel.value===status)?'':status;
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const t=document.querySelector('#page-prep .tbl-wrap');
  if(t)t.scrollIntoView({behavior:'smooth',block:'start'});
}
/* Useful on day one, noise every day after. Off by default, one click away. */
try{if(localStorage.getItem('prepKbHint')==='1')setTimeout(()=>toggleKbHint(),0);}catch(e){}
/* Swaps the "+ VA note" link for a real box, so an empty row stays one line
   tall until someone actually has something to say. */
function addVaNote(id,btn){
  const wrap=btn.parentElement;
  btn.remove();
  const ta=document.createElement('textarea');
  ta.className='ci ci-note va';ta.rows=3;ta.placeholder='VA note…';ta.title="VA note — Sarah's";
  ta.onblur=function(){this.rows=this.value?2:1;if(!this.value){this.replaceWith(mkAddVa(id));}};
  ta.onchange=function(){uf(id,'vaNote',this.value);};
  wrap.appendChild(ta);ta.focus();
}
function mkAddVa(id){
  const b=document.createElement('button');
  b.className='addVa';b.textContent='+ VA note';b.title='Add a VA note';
  b.onclick=function(){addVaNote(id,this);};
  return b;
}
/* Swap the text for a real textarea, size it to the content, and put it back
   as text when you click away. No scrollbars, no drag handles, no clipping. */
function editNote(el,id,field){
  if(el.querySelector('textarea'))return;
  /* Jack, 4 Sep: "packing notes should be Becki only — Sarah has to use VA
     note." The login already says who is typing, so the column can hold the
     line itself rather than relying on people remembering. It is a stop, not a
     lecture: it names the right box and offers to open it. */
  if(field==='notes'&&/^sarah/i.test(String(window.currentUserName||'').trim())){
    const row0=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
    showConfirm('Packing Notes are the warehouse\u2019s',
      'This column is for Becki and the UK team \u2014 what to do with the box.\n\nAnything you find out about the order goes in <b>VA Note</b>, the column just to the right.\n\nOpen VA Note instead?',
      ()=>{const cell=document.querySelector(`[data-note-va="${id}"]`);
           if(cell)editNote(cell,id,'vaNote');
           else toast('Use the VA Note column on this row','ok');});
    return;
  }
  const row=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  const cur=(row&&row[field])||'';
  const ta=document.createElement('textarea');
  ta.className='noteEdit';ta.value=cur;
  ta.placeholder=field==='notes'?'Packing instructions…':'What you found out…';
  el.textContent='';el.appendChild(ta);
  const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,150)+'px';};
  ta.addEventListener('input',grow);grow();ta.focus();
  ta.setSelectionRange(cur.length,cur.length);
  ta.addEventListener('keydown',e=>{if(e.key==='Escape'){ta.value=cur;ta.blur();}});
  ta.addEventListener('blur',()=>{
    const v=ta.value.trim();
    if(v!==cur)uf(id,field,v);
    el.classList.toggle('empty',!v);
    el.innerHTML=v?esc(v):'<span class="noteAdd">+ note</span>';
  });
}
function toggleKbHint(){
  const h=document.getElementById('kbHint'),b=document.getElementById('kbHintBtn');
  if(!h)return;
  const on=h.style.display==='none';
  h.style.display=on?'':'none';
  if(b)b.style.display=on?'none':'';
  try{localStorage.setItem('prepKbHint',on?'1':'0');}catch(e){}
}
function jumpToShipments(range){
  const btn=document.querySelector('.sb-item[onclick*="shipments"]');
  if(btn)goPage('shipments',btn);
  setShipDateFilter(range||'mtd');
}
function setShipDateFilter(v){
  _shipShowAll=false;
  _shipDateFilter=v;
  // Update button styles
  ['today','yesterday','week','7d','mtd','ytd','all'].forEach(k=>{
    const btn=document.getElementById('shipDateBtn-'+k);
    if(btn){btn.classList.toggle('sdBtn-active',k===v);}
  });
  renderShipments();
}

function getShipDateRange(){
  const todayStr=todayISO();
  const now=new Date();
  function localISO(d){
    return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  if(_shipDateFilter==='today')return{s:todayStr,e:todayStr};
  if(_shipDateFilter==='yesterday')return{s:yesterdayISO(),e:yesterdayISO()};
  /* Monday to today — the same week the "Sent This Week" tile counts, so the
     two can be checked against each other. "7 Days" is a rolling window and
     deliberately answers a different question. */
  if(_shipDateFilter==='week'){const{s}=getWeekRange(0);return{s:localISO(s),e:todayStr};}
  if(_shipDateFilter==='7d'){const d=new Date();d.setDate(d.getDate()-6);return{s:localISO(d),e:todayStr};}
  if(_shipDateFilter==='mtd'){const s=new Date(now.getFullYear(),now.getMonth(),1);return{s:localISO(s),e:todayStr};}
  if(_shipDateFilter==='ytd'){return{s:`${now.getFullYear()}-01-01`,e:todayStr};}
  if(_shipDateFilter==='custom'){
    let f=document.getElementById('shipDateFrom')?.value||'';
    let t=document.getElementById('shipDateTo')?.value||todayStr;
    /* A blank From returned '' — falsy — and the whole date filter was skipped,
       so picking a To date on its own quietly showed every shipment on record
       with no chip lit and nothing naming the period. A blank From now means
       "from the beginning", which is what picking only a To date means. */
    if(!f)f='0000-01-01';
    /* and if they are the wrong way round, swap rather than show nothing */
    if(f&&t&&f>t){const x=f;f=t;t=x;}
    return{s:f,e:t};
  }
  return{s:null,e:null};
}

// ── NEW SHIPMENT (LAVARION-ONLY) ──────────────────────────────────────────────
let _nsLavCount=0;

function openNewShipment(){
  _nsLavCount=0;
  document.getElementById('ns-id').value='';
  document.getElementById('ns-type').value='Standard';
  document.getElementById('ns-date').value=todayISO();
  document.getElementById('ns-boxes').value='';
  document.getElementById('ns-lavRows').innerHTML='';
  addNsLavRow(); // start with one row
  om('newShipModal');
}

/* This screen still had the original dropdown: no search, no buildable count,
   no cost, no check — so a shipment created here could go out short and the
   only word about it was a toast AFTER the row was already saved. It is the
   same job as the Add-Lavarion picker, so it is the same picker, off the same
   helpers, so the two screens can never disagree about what is allowed. */
/* This screen still had the original dropdown: no search, no buildable count,
   no cost, no check — so a shipment created here could go out short and the
   only word about it was a toast AFTER the row was already saved. Same job as
   the Add-Lavarion picker, so it runs the same code, off the same helpers. */
function addNsLavRow(){
  const idx=_nsLavCount++;
  const container=document.getElementById('ns-lavRows');
  const row=document.createElement('div');
  row.id=`ns-lav-${idx}`;
  row.style.cssText='background:var(--bg3);border:1px solid var(--border);border-radius:7px;padding:10px 11px;margin-bottom:8px;';
  row.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 76px 92px 24px;gap:8px;align-items:end;">
      <div style="position:relative;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Product</div>
        <input class="fi-in" id="ns-lav-search-${idx}" autocomplete="off"
          placeholder="Type a product, SKU or ASIN…" style="font-size:12px;"
          oninput="pkFilter('ns-lav',${idx})" onfocus="pkFilter('ns-lav',${idx})"
          onkeydown="if(event.key==='Escape'){pkHide('ns-lav',${idx});this.blur();}">
        <input type="hidden" id="ns-lav-asin-${idx}" value="">
        <div id="ns-lav-pop-${idx}" style="display:none;position:absolute;z-index:60;left:0;right:0;top:100%;
          margin-top:3px;max-height:230px;overflow:auto;background:var(--bg2);border:1px solid var(--border2);
          border-radius:7px;box-shadow:0 12px 26px rgba(0,0,0,.55);"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Units</div>
        <input class="fi-in" type="number" id="ns-lav-units-${idx}" min="1" placeholder="0" style="font-size:12px;"
          oninput="pkCheck('ns-lav',${idx})">
      </div>
      <div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">COG/Unit £</div>
        <input class="fi-in" type="number" id="ns-lav-cost-${idx}" min="0" step="0.01" placeholder="auto"
          title="Worked out from the oldest stock first. Type over it only if this batch genuinely cost something else."
          style="font-size:12px;" oninput="this.dataset.touched='1';pkCheck('ns-lav',${idx});">
      </div>
      <button onclick="document.getElementById('ns-lav-${idx}').remove();pkFoot('ns-lav');" title="Drop this line"
        style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;">&#10005;</button>
    </div>
    <div id="ns-lav-info-${idx}" style="font-size:11px;color:var(--text3);margin-top:6px;"></div>
  `;
  container.appendChild(row);
  pkFoot('ns-lav');
}

async function saveNewShipment(){
  const shipId=document.getElementById('ns-id').value.trim().toUpperCase();
  if(!shipId){toast('FBA Shipment ID is required','er');return;}
  const type=document.getElementById('ns-type').value;
  const date=document.getElementById('ns-date').value||todayISO();
  const boxes=parseInt(document.getElementById('ns-boxes').value)||0;

  // Collect Lavarion rows
  /* Same stop as the Add-Lavarion picker — this screen had none at all. */
  const stop=pkStops('ns-lav');
  const lavRows=[];
  document.querySelectorAll('[id^="ns-lav-asin-"]').forEach(sel=>{
    const idx=sel.id.split('-').pop();
    const asin=sel.value;
    const units=parseInt(document.getElementById(`ns-lav-units-${idx}`)?.value)||0;
    const cost=parseFloat(document.getElementById(`ns-lav-cost-${idx}`)?.value)||0;
    if(asin&&units>0){
      const a=lavAsins.find(x=>x.asin===asin);
      lavRows.push({shipId,asin,sku:a?.sku||'',prod:a?.prod||asin,units,cost,date,_meta:pkMeta('ns-lav',idx)});
    }
  });

  if(stop.length){toast(stop[0],'er');return;}
  if(!lavRows.length){toast('Add at least one Lavarion ASIN with units','er');return;}

  // Write type to cache NOW so renderShipments picks it up immediately and
  // the type filter (DG / Oversize) works on first render — without this the
  // shipment is created but typed as 'Standard' in memory and is invisible
  // whenever the DG filter is active (the root cause of "confirms but doesn't appear").
  _shipTypeCache[shipId]=type;

  // Save boxes — always upsert even when 0 so ship_type is persisted; otherwise
  // a DG shipment with no boxes yet loses its type on the next page refresh.
  shipBoxes[shipId]=boxes||0;
  await sb.from('ship_boxes').upsert({ship_id:shipId,boxes:boxes||0,ship_type:type},{onConflict:'ship_id'});
  try{renderNoBoxBanner();}catch(e){}

  // Save Lavarion shipments
  for(const ls of lavRows){
    const meta=ls._meta;delete ls._meta;
    lavShipments.push(ls);
    const _ok=await saveLavShipment(ls);
    if(_ok===false){const _i=lavShipments.indexOf(ls);if(_i>=0)lavShipments.splice(_i,1);continue;}
    if(meta){
      logAudit('Lavarion added to shipment',
        `${ls.asin} x ${ls.units} -> ${shipId} — COG £${ls.cost} blended across two purchase prices by ${window.currentUserName||'someone'} (${meta.why}${meta.note?': '+meta.note:''})`);
      try{if(window.LV3&&LV3.noteOverride)LV3.noteOverride({k:meta.why||'other',
        shipId,prod:ls.prod,units:ls.units,cost:ls.cost,note:meta.note});}catch(e){}
    }
  }

  cm('newShipModal');renderShipments();
  toast(`✓ Shipment ${shipId} created with ${lavRows.length} Lavarion ASIN${lavRows.length!==1?'s':''}`);
  logAudit('New Shipment created',shipId);
}
