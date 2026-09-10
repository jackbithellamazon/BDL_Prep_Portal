/* BDL PrepHub — js/lavarion-bridge.js — Lavarion page glue + the Lavarion picker (the Lavarion area itself is js/lavarion.js).
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── LAVARION ──────────────────────────────────────────────────────────────────
let _lavNid=0;

function renderLavarion(){
  const w=document.getElementById('lavList');
  const q=(document.getElementById('lavSrch')||{}).value?.toLowerCase()||'';
  let data=lavAsins.filter(a=>!q||(a.asin+a.sku+a.prod).toLowerCase().includes(q));

  if(!data.length){
    w.innerHTML=`<div class="empty"><div class="empty-ico">📦</div><div class="empty-t">${q?'No Lavarion ASINs match your search':'No Lavarion ASINs yet — click "+ Add Lavarion ASIN" to get started'}</div></div>`;
    return;
  }

  w.innerHTML=`<table id="lavTable">
    <thead><tr>
      <th class="th-left">ASIN / SKU</th>
      <th class="th-left">Product Name</th>
      <th style="width:90px;">VAT</th>
      <th class="th-left">Notes</th>
      <th style="width:80px;"></th>
    </tr></thead>
    <tbody>${data.map(a=>{
      const vv=(a.vat||a.vat==='0')?String(a.vat):'20';
      const vatCell=vatTag(vv);
      return`<tr>
        <td class="td-left">
          <div class="stack">
            <div class="s-asin" onclick="copyVal('${a.asin}',this)" style="display:inline-flex;">${a.asin}</div>
            <div class="s-sku" onclick="copyVal('${a.sku}',this)" style="display:inline-flex;">${a.sku}</div>
          </div>
        </td>
        <td class="td-left" style="font-weight:600;font-size:12px;">${a.prod}</td>
        <td style="text-align:center;">${vatCell}</td>
        <td class="td-left" style="font-size:10px;color:var(--text3);">${a.notes||'—'}</td>
        <td>
          <div style="display:flex;gap:4px;">
            <button onclick="openEditLav('${a.id}')" style="padding:3px 8px;background:var(--btn-orange-bg);border:1px solid var(--btn-orange-border);color:var(--btn-orange-text);border-radius:3px;font-size:10px;font-weight:700;cursor:pointer;">Edit</button>
            <button onclick="deleteLav('${a.id}')" style="padding:3px 8px;background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:3px;font-size:10px;cursor:pointer;">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function openAddLav(){
  lavEditId=null;
  document.getElementById('lavModalTitle').textContent='Add Lavarion ASIN';
  ['lav-asin','lav-sku','lav-prod','lav-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const v=document.getElementById('lav-vat');if(v)v.value='20';
  om('lavModal');
}
function openEditLav(id){
  const a=lavAsins.find(x=>x.id===id);if(!a)return;
  lavEditId=id;
  document.getElementById('lavModalTitle').textContent='Edit Lavarion ASIN';
  document.getElementById('lav-asin').value=a.asin||'';
  document.getElementById('lav-sku').value=a.sku||'';
  document.getElementById('lav-prod').value=a.prod||'';
  document.getElementById('lav-notes').value=a.notes||'';
  const v=document.getElementById('lav-vat');if(v)v.value=(a.vat||a.vat==='0')?String(a.vat):'20';
  om('lavModal');
}
function saveLav(){
  const asin=document.getElementById('lav-asin').value.trim();
  const sku=document.getElementById('lav-sku').value.trim();
  const prod=document.getElementById('lav-prod').value.trim();
  if(!asin||!prod){toast('ASIN and Product Name required','er');return;}
  const obj={
    id:lavEditId||++_lavNid,
    asin,sku,prod,
    cost:0,total:0,dg:'No',
    vat:(document.getElementById('lav-vat')||{}).value||'20',
    notes:document.getElementById('lav-notes').value.trim(),
  };
  // Preserve the existing uuid so we update (not duplicate) the DB row on edit.
  if(lavEditId){const i=lavAsins.findIndex(x=>x.id===lavEditId);if(i>=0){obj.uuid=lavAsins[i].uuid;lavAsins[i]=obj;}}
  else lavAsins.push(obj);
  saveLavAsin(obj);
  cm('lavModal');renderLavarion();
  toast(lavEditId?'Lavarion ASIN updated':'Lavarion ASIN added ✓');
  logAudit('Lavarion ASIN '+(lavEditId?'updated':'added'),sku);
}
function deleteLav(id){
  const a=lavAsins.find(x=>x.id===id);
  const usedIn=lavShipments.filter(s=>s.asin===a?.asin||s.sku===a?.sku);
  const histNote=usedIn.length
    ? ` It has been sent in ${usedIn.length} shipment ${usedIn.length===1?'entry':'entries'} — that shipment data is kept and stays on your reports; only the catalogue entry is removed.`
    : '';
  showConfirm('Delete Lavarion ASIN?',`This removes ${a?.prod||'this ASIN'} from your Lavarion stock list.${histNote}`,()=>{
    deleteLavAsin_db(a);
    if(a&&lv2Recipes[a.asin]){delete lv2Recipes[a.asin];if(typeof lv2Save==='function')lv2Save();}
    lavAsins=lavAsins.filter(x=>x.id!==id);
    renderLavarion();toast('Lavarion ASIN deleted — shipment history kept');
    logAudit('Lavarion ASIN deleted',(a?.sku||a?.asin||'')+(usedIn.length?` (history in ${usedIn.length} shipment${usedIn.length!==1?'s':''} preserved)`:''));
  });
}

// Called from Shipments page — "Add Lavarion Units" button
let _lavLineCount=0;
function openLavShip(shipId){
  _lavShipId=shipId;
  _lavLineCount=0;
  document.getElementById('lavShipModalTitle').textContent='Add Lavarion to '+shipId;
  document.getElementById('lavShipLines').innerHTML='';
  addLavShipLine();
  om('lavShipModal');
}
function addLavShipLine(){
  const idx=_lavLineCount++;
  const container=document.getElementById('lavShipLines');
  const div=document.createElement('div');
  div.id='lsl-'+idx;
  div.style.cssText='background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px;';
  div.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:10px;font-weight:700;color:var(--accent);">ASIN ${idx+1}</div>
      ${idx>0?`<button onclick="document.getElementById('lsl-${idx}').remove();pkFoot('lsl');" title="Drop this line" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;">&#10005;</button>`:''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 76px 92px;gap:8px;align-items:end;">
      <div style="position:relative;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Product</div>
        ${/* Was a bare <select> of every Lavarion ASIN — Jack, 20 Aug: "search
             can't do". You cannot type in a select, so finding one product
             among dozens meant scrolling a list ordered by nothing useful.
             Type-to-filter, matching name, SKU or ASIN, with the stock and the
             cost shown on each row so the choice is made before you click. */''}
        <input class="fi-in" id="lsl-search-${idx}" autocomplete="off"
          placeholder="Type a product, SKU or ASIN…" style="font-size:12px;"
          oninput="pkFilter('lsl',${idx})" onfocus="pkFilter('lsl',${idx})"
          onkeydown="if(event.key==='Escape'){pkHide('lsl',${idx});this.blur();}">
        <input type="hidden" id="lsl-asin-${idx}" value="">
        <div id="lsl-pop-${idx}" style="display:none;position:absolute;z-index:60;left:0;right:0;top:100%;
          margin-top:3px;max-height:230px;overflow:auto;background:var(--bg2);border:1px solid var(--border2);
          border-radius:7px;box-shadow:0 12px 26px rgba(0,0,0,.55);"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Units</div>
        <input class="fi-in" type="number" id="lsl-units-${idx}" min="1" placeholder="0" style="font-size:12px;"
          oninput="pkCheck('lsl',${idx})">
      </div>
      <div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">COG/Unit £</div>
        <input class="fi-in" type="number" id="lsl-cost-${idx}" min="0" step="0.01" placeholder="auto"
          title="Worked out from the oldest stock first. Type over it only if this batch genuinely cost something else."
          style="font-size:12px;" oninput="this.dataset.touched='1';pkCheck('lsl',${idx});">
      </div>
    </div>
    <div id="lsl-info-${idx}" style="font-size:11px;color:var(--text3);margin-top:6px;"></div>
  `;
  container.appendChild(div);
  pkFoot('lsl');
  setTimeout(()=>{const el=document.getElementById('lsl-search-'+idx);if(el)el.focus();},30);
}
/* ── THE LAVARION PICKER ──────────────────────────────────────────────────
   One implementation, two screens. "Add Lavarion to shipment" and "New
   Shipment" ask the identical question — can these units go, and at what cost
   — so they run the same code and cannot drift apart. The only difference is
   the id prefix on the inputs and which footer button they drive.        */
const PK={
  'lsl'   :{go:'lavShipGo',label:n=>n?`Add ${n} to Shipment`:'Add to Shipment'},
  'ns-lav':{go:'nsGo',label:n=>n?`Create Shipment · ${n} Lavarion line${n===1?'':'s'}`:'Create Shipment'}
};
const _pk=(pfx,part,idx)=>document.getElementById(`${pfx}-${part}-${idx}`);

/* The picker came up empty on every search. LV3.lavShipList reads the Lavarion
   module's own product list, and that module only loads when you OPEN the
   Lavarion page — from Shipments it had nothing to offer. The old dropdown
   worked because it used `lavAsins`, which dbLoad always fills.
   So: lavAsins is the list, always. If the Lavarion module happens to be
   loaded, its buildable count and FIFO cost are merged in on top; if not, the
   ASIN's own stored cost is used, which is what it is there for. */
function _lslRows(){
  const base=(typeof lavAsins!=='undefined'?lavAsins:[])
    .filter(a=>!a.archived)
    .map(a=>({asin:a.asin||'',sku:a.sku||'',name:a.prod||a.asin||'',
              available:null,cog:(a.cost>0?a.cost:null)}));
  let rich=[];
  try{if(window.LV3&&LV3.lavShipList)rich=LV3.lavShipList()||[];}catch(e){}
  if(rich.length){
    const by={};rich.forEach(r=>{if(r.asin)by[String(r.asin).toLowerCase()]=r;});
    base.forEach(b=>{const r=by[String(b.asin).toLowerCase()];
      if(r){if(r.available!=null)b.available=r.available;if(r.cog!=null)b.cog=r.cog;
            if(r.sku&&!b.sku)b.sku=r.sku;}});
  }
  return base.sort((a,b)=>a.name.localeCompare(b.name));
}
function _lslInfo(asin,units){
  let info=null;
  try{if(window.LV3&&LV3.lavShipInfo)info=LV3.lavShipInfo(asin,units);}catch(e){}
  if(info)return info;
  const a=(typeof lavAsins!=='undefined'?lavAsins:[]).find(x=>String(x.asin||'').toLowerCase()===String(asin||'').toLowerCase());
  return a?{asin:a.asin||'',sku:a.sku||'',name:a.prod||'',available:null,
            cog:(a.cost>0?a.cost:null),blocked:[],unpriced:[],mixed:false,fallback:true}:null;
}
/* A blended cost is an average, so it lands on fractions of a penny. Jack, 20
   Aug: it rounds UP — a COG guessed high costs you nothing, a COG guessed low
   quietly flatters every margin downstream. */
const pkBlendUp=n=>Math.ceil((n||0)*100)/100;
function pkReasons(){
  try{if(window.LV3&&LV3.ovReasons)return LV3.ovReasons();}catch(e){}
  return [['other','Something else']];
}

function pkHide(pfx,idx){const p=_pk(pfx,'pop',idx);if(p)p.style.display='none';}
function pkFilter(pfx,idx){
  const inp=_pk(pfx,'search',idx),pop=_pk(pfx,'pop',idx);
  if(!inp||!pop)return;
  const q=(inp.value||'').trim().toLowerCase();
  let rows=_lslRows();
  if(q)rows=rows.filter(r=>((r.name||'')+' '+(r.sku||'')+' '+(r.asin||'')).toLowerCase().includes(q));
  if(!rows.length){
    pop.innerHTML='<div style="padding:9px 11px;font-size:11.5px;color:var(--text3)">Nothing matches that</div>';
    pop.style.display='block';return;
  }
  pop.innerHTML=rows.slice(0,40).map(r=>{
    const stock=(r.available==null)?'<span style="color:var(--text3)">no build list</span>'
      :`<span style="color:${r.available>0?'var(--green)':'var(--red)'}">${r.available} buildable</span>`;
    const cog=(r.cog==null)?'<span style="color:var(--text3)">no price yet</span>'
      :`<span style="color:var(--amber)">£${r.cog.toFixed(2)}</span>`;
    return `<div onclick="pkPick('${pfx}',${idx},'${String(r.asin).replace(/'/g,"\\'")}')"
      style="padding:8px 11px;cursor:pointer;border-bottom:1px solid var(--border);"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">
      <div style="font-size:12.5px;font-weight:700;color:var(--text);">${esc(r.name||r.asin)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">
        ${esc(r.sku||'no SKU')} · ${esc(r.asin||'')} &nbsp;·&nbsp; ${stock} &nbsp;·&nbsp; ${cog}</div>
    </div>`;}).join('');
  pop.style.display='block';
}
function pkPick(pfx,idx,asin){
  const u=parseInt((_pk(pfx,'units',idx)||{}).value)||1;
  const info=_lslInfo(asin,u);
  const inp=_pk(pfx,'search',idx),hid=_pk(pfx,'asin',idx),cost=_pk(pfx,'cost',idx);
  if(hid){hid.value=asin;delete hid.dataset.blend;delete hid.dataset.why;}
  if(inp)inp.value=(info&&info.name)||asin;
  /* the auto COG Jack expected and never got — the FIFO cost of one unit,
     filled in for you and still editable if this shipment really did cost
     something else */
  if(cost&&info&&info.cog!=null&&!cost.dataset.touched)cost.value=info.cog.toFixed(2);
  pkHide(pfx,idx);
  pkCheck(pfx,idx);
}
function pkSetUnits(pfx,idx,n){
  const u=_pk(pfx,'units',idx);if(!u)return;
  u.value=n;
  const c=_pk(pfx,'cost',idx);if(c)delete c.dataset.touched;
  const h=_pk(pfx,'asin',idx);if(h){delete h.dataset.blend;delete h.dataset.why;}
  pkCheck(pfx,idx);
}
/* Blending is a decision, so it is made the way the Lavarion page makes it:
   ticked on deliberately, with a reason that can be counted afterwards. */
function pkBlendToggle(pfx,idx,on){
  const h=_pk(pfx,'asin',idx);if(!h)return;
  if(on)h.dataset.blend='1'; else {delete h.dataset.blend;delete h.dataset.why;}
  const c=_pk(pfx,'cost',idx);if(c)delete c.dataset.touched;
  pkCheck(pfx,idx);
}
function pkBlendWhy(pfx,idx,k){
  const h=_pk(pfx,'asin',idx);if(!h)return;
  h.dataset.why=k||'';
  pkCheck(pfx,idx);
}
function pkBlendNote(pfx,idx,v){
  const h=_pk(pfx,'asin',idx);if(!h)return;
  h.dataset.note=v||'';
  pkFoot(pfx);
}
function pkVerdict(pfx,idx){
  const hid=_pk(pfx,'asin',idx);
  const asin=hid&&hid.value;
  if(!asin)return{k:'empty'};
  const want=parseInt((_pk(pfx,'units',idx)||{}).value)||0;
  const info=_lslInfo(asin,want||1);
  if(!info)return{k:'empty'};
  const cost=_pk(pfx,'cost',idx);
  const typed=parseFloat(cost&&cost.value)||0;
  if(!want)return{k:'nounits',info};
  if((info.unpriced||[]).length&&typed<=0)return{k:'noprice',info,want};
  /* You cannot send stock you do not have. There is no tick and no override —
     Jack, 20 Aug: "they can't send 14 units as we only have 12". The units
     that are not there yet go out on a later shipment, once they exist. */
  if(info.available!=null&&want>info.available)
    return{k:'short',info,want,can:info.available,gap:want-info.available};
  /* The stock IS there, but it was bought in two batches at two prices. Same
     rule as the Lavarion page: blocked by default, overridable with a reason. */
  let split=null;
  if(info.mixed){try{if(window.LV3&&LV3.lavShipSplit)split=LV3.lavShipSplit(asin,want);}catch(e){}}
  if(split){
    const on=hid.dataset.blend==='1',why=hid.dataset.why||'',note=hid.dataset.note||'';
    const per=pkBlendUp(info.cog);
    if(!on)return{k:'mixed',info,want,split,per};
    if(!why||(why==='other'&&!note.trim()))return{k:'mixed',info,want,split,per,on:true,why,note};
    return{k:'blended',info,want,split,per,why,note};
  }
  return{k:'ok',info,want,per:typed||info.cog};
}
function pkCheck(pfx,idx){
  const box=_pk(pfx,'info',idx);
  if(!box)return;
  const v=pkVerdict(pfx,idx);
  if(v.k==='empty'){box.innerHTML='';pkFoot(pfx);return;}
  const info=v.info,cost=_pk(pfx,'cost',idx);
  /* keep the auto figure honest as the quantity moves — the whole reason the
     COG engine exists is so nobody works this out by hand. A short line has no
     price for the full quantity, so show the cost of the units that do exist. */
  const fill=(v.k==='blended')?v.per
            :(info.cog!=null)?info.cog
            :(info.coveredPer!=null)?info.coveredPer:null;
  if(cost&&fill!=null&&!cost.dataset.touched)cost.value=fill.toFixed(2);
  const gbp=n=>'£'+(n||0).toFixed(2);
  const line=(col,txt)=>`<div style="font-size:12px;color:${col};font-weight:700;">${txt}</div>`;
  const sub=t=>`<div style="font-size:11px;color:var(--text3);margin-top:2px;">${t}</div>`;
  const btn=(on,txt)=>`<button type="button" onclick="${on}" style="padding:4px 10px;background:var(--bg4);border:1px solid var(--border2);color:var(--text);border-radius:5px;font-size:11.5px;font-weight:700;cursor:pointer;">${txt}</button>`;
  const row=h=>`<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px;">${h}</div>`;
  const tick=(on,txt)=>`<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:${on?'var(--amber)':'var(--text2)'};cursor:pointer;font-weight:${on?'700':'400'};">
      <input type="checkbox" ${on?'checked':''} onchange="pkBlendToggle('${pfx}',${idx},this.checked)" style="cursor:pointer;">${txt}</label>`;
  const whyBox=(why,note)=>`<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px;">
      <select class="fi-in" style="font-size:11.5px;max-width:230px;" onchange="pkBlendWhy('${pfx}',${idx},this.value)">
        <option value="">Why are you blending them?…</option>
        ${pkReasons().map(r=>`<option value="${r[0]}" ${why===r[0]?'selected':''}>${esc(r[1])}</option>`).join('')}
      </select>
      ${why==='other'?`<input class="fi-in" style="font-size:11.5px;max-width:230px;" placeholder="Say what the reason is"
        value="${esc(note||'')}" oninput="pkBlendNote('${pfx}',${idx},this.value)">`:''}
    </div>`;
  let html='';
  if(v.k==='nounits'){
    html=sub(`${esc(info.sku||'no SKU set')}${info.available!=null?` · ${info.available} buildable`:''}${info.cog!=null?` · ${gbp(info.cog)} each`:''} — enter units`);
  }else if(v.k==='noprice'){
    html=line('var(--amber)',`No purchase price on ${(info.unpriced||[]).map(u=>esc(u.name)).join(', ')||'a component'}`)
      +sub('The COG cannot be worked out, so this line needs one typed in. It will be recorded as a typed figure, not a calculated one.');
  }else if(v.k==='short'){
    const short=(info.blocked||[]).map(b=>`${esc(b.name)} (need ${b.need}, have ${b.have})`).join(', ');
    html=line('var(--red)',`Only ${v.can} can be built — you are asking for ${v.want}`)
      +sub((short?`Short on ${short}. `:'')+`The other ${v.gap} do not exist yet, so they go out on a later shipment once the parts land.`)
      +(v.can>0?row(btn(`pkSetUnits('${pfx}',${idx},${v.can})`,`Send ${v.can} instead`)):'');
  }else if(v.k==='mixed'){
    const f=v.split.first,r=v.split.rest;
    html=line('var(--amber)',`Only ${f.units} were bought at ${f.per!=null?gbp(f.per):'this price'}`)
      +sub(`The other ${r.units} came in at ${r.per!=null?gbp(r.per):'a different price'}. One shipment carries one cost, so send ${f.units} now and put the remaining ${r.units} on the next shipment — or blend them if you have to.`)
      +row(btn(`pkSetUnits('${pfx}',${idx},${f.units})`,`Send ${f.units} at ${f.per!=null?gbp(f.per):'this price'}`)
        +tick(!!v.on,`Blend all ${v.want} into one cost at ${gbp(v.per)}`))
      +(v.on?whyBox(v.why,v.note):'');
  }else if(v.k==='blended'){
    const f=v.split.first,r=v.split.rest;
    const label=(pkReasons().find(x=>x[0]===v.why)||[])[1]||v.why;
    html=line('var(--amber)',`Blended — ${gbp(v.per)} each, rounded up`)
      +sub(`${f.units} bought at ${f.per!=null?gbp(f.per):'—'} and ${r.units} at ${r.per!=null?gbp(r.per):'—'}, averaged onto one line. Recorded as an override: ${esc(label)}${v.why==='other'&&v.note?` — ${esc(v.note)}`:''}.`)
      +row(btn(`pkSetUnits('${pfx}',${idx},${f.units})`,`Actually, send ${f.units} at one price`)
        +tick(true,`Blend all ${v.want} into one cost at ${gbp(v.per)}`))
      +whyBox(v.why,v.note);
  }else{
    const total=(v.per||0)*v.want;
    html=line('var(--text2)',`${v.want} × ${gbp(v.per||0)} = <span style="color:var(--text)">${gbp(total)}</span>`)
      +sub(`${esc(info.sku||'no SKU set')}${info.available!=null?` · ${info.available} buildable, ${info.available-v.want} left after this`:''}${info.fallback?" · price is the ASIN's own cost, open Lavarion for the built-up figure":''}`);
  }
  box.innerHTML=html;
  pkFoot(pfx);
}
/* the footer button should never be a surprise */
function pkFoot(pfx){
  const cfg=PK[pfx]||{};
  const b=document.getElementById(cfg.go);if(!b)return;
  let n=0,bad=0,blend=0;
  document.querySelectorAll(`[id^="${pfx}-asin-"]`).forEach(sel=>{
    const idx=sel.id.split('-').pop();
    if(!sel.value)return;
    const v=pkVerdict(pfx,idx);
    if(v.k==='empty'||v.k==='nounits')return;
    n++;
    if(v.k==='short'||v.k==='noprice'||v.k==='mixed')bad++;
    if(v.k==='blended')blend++;
  });
  b.textContent=(cfg.label?cfg.label(n):'Save')+(blend?` · ${blend} blended COG`:'');
  b.style.opacity=bad?'.55':'1';
  b.title=bad?'One or more lines cannot go as they are':'';
}
/* every line has to have been decided — returns the reasons it cannot save */
function pkStops(pfx){
  const stop=[];
  document.querySelectorAll(`[id^="${pfx}-asin-"]`).forEach(sel=>{
    const idx=sel.id.split('-').pop();
    if(!sel.value)return;
    const units=parseInt((_pk(pfx,'units',idx)||{}).value)||0;
    if(units<=0)return;
    const cost=parseFloat((_pk(pfx,'cost',idx)||{}).value)||0;
    const v=pkVerdict(pfx,idx);
    const who=(v.info&&v.info.name)||sel.value;
    if(v.k==='short')
      stop.push(`${who}: only ${v.can} can be built, so ${v.want} cannot go. Send ${v.can} now and the other ${v.gap} on a later shipment.`);
    else if(v.k==='noprice')
      stop.push(`${who}: no purchase price on record — type the COG for this line.`);
    else if(v.k==='mixed'&&v.on)
      stop.push(`${who}: pick a reason for blending the two costs${v.why==='other'?', and say what it is':''}.`);
    else if(v.k==='mixed')
      stop.push(`${who}: only ${v.split.first.units} were bought at that price. Send ${v.split.first.units} now and the rest on the next shipment, or tick to blend them.`);
    else if(cost<=0)
      stop.push(`${who}: no COG on the line.`);
  });
  return stop;
}
/* what a saved line should record about how it was decided */
function pkMeta(pfx,idx){
  const v=pkVerdict(pfx,idx);
  return (v.k==='blended')?{blended:true,per:v.per,why:v.why,note:v.note}:null;
}

async function confirmLavShipMulti(){
  if(!_lavShipId){toast('No shipment selected','er');return;}
  const stop=pkStops('lsl');
  if(stop.length){toast(stop[0],'er');return;}
  const lines=[];
  document.querySelectorAll('[id^="lsl-asin-"]').forEach(sel=>{
    const idx=sel.id.split('-').pop();
    const asin=sel.value;
    const units=parseInt(document.getElementById('lsl-units-'+idx)?.value)||0;
    const cost=parseFloat(document.getElementById('lsl-cost-'+idx)?.value)||0;
    if(!asin||units<=0)return;
    const a=lavAsins.find(x=>x.asin===asin);
    lines.push({shipId:_lavShipId,asin,sku:a?.sku||'',prod:a?.prod||asin,units,cost,
      date:shipDateFor(_lavShipId),_meta:pkMeta('lsl',idx)});
  });
  if(!lines.length){toast('Add at least one ASIN with units','er');return;}
  for(const entry of lines){
    const meta=entry._meta;delete entry._meta;
    lavShipments.push(entry);
    const _ok=await saveLavShipment(entry);
    if(_ok===false){const _i=lavShipments.indexOf(entry);if(_i>=0)lavShipments.splice(_i,1);continue;}
    logAudit('Lavarion added to shipment',entry.asin+' x '+entry.units+' -> '+_lavShipId
      +(meta?` — COG £${entry.cost} blended across two purchase prices by ${window.currentUserName||'someone'} (${meta.why}${meta.note?': '+meta.note:''})`:''));
    /* a blend is a decision, counted the same way the Lavarion page counts its own */
    if(meta){try{if(window.LV3&&LV3.noteOverride)LV3.noteOverride({k:meta.why||'other',
      shipId:_lavShipId,prod:entry.prod,units:entry.units,cost:entry.cost,note:meta.note});}catch(e){}}
  }
  cm('lavShipModal');
  renderShipments();renderLavarion();
  toast('✓ '+lines.length+' Lavarion ASIN'+(lines.length!==1?'s':'')+' added to '+_lavShipId);
}
