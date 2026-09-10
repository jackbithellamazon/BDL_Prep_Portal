/* BDL PrepHub — js/ui.js — modals, toast, theme, sorting.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── MODALS ────────────────────────────────────────────────────────────────────
function om(id){document.getElementById(id).classList.add('open');}
function cm(id){
  // Clean up insights keyboard handler if closing that modal
  const m=document.getElementById('prepHistoryModal');
  if(m&&m._kbHandler){document.removeEventListener('keydown',m._kbHandler);m._kbHandler=null;}document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)cm(o.id);}));
/* Escape closes any open lv2 modal — consistent with the app's other modals */
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  ['lav3Ov1','lav3Ov2'].forEach(function(id){
    var o=document.getElementById(id); if(o&&o.classList.contains('open'))cm(id);
  });
});

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg,type='ok'){
  const c=document.getElementById('toasts');
  const t=document.createElement('div');
  t.className=`toast ${type}`;t.textContent=msg;
  c.appendChild(t);setTimeout(()=>t.remove(),3000);
}
// Toast with an Undo button. Stays ~7s; clicking Undo runs onUndo() once and
// dismisses. Used after reversible-but-destructive actions (archive, remove
// shipment) so a misclick is a one-tap recovery.
function toastUndo(msg,onUndo,seconds=7){
  const c=document.getElementById('toasts');
  const t=document.createElement('div');
  t.className='toast';t.style.gap='10px';
  const span=document.createElement('span');span.textContent=msg;
  const btn=document.createElement('button');
  btn.textContent='Undo';
  btn.style.cssText='background:var(--btn-blue-bg);border:1px solid var(--btn-blue-border);color:var(--btn-blue-text);border-radius:4px;font-size:10px;font-weight:800;padding:2px 9px;cursor:pointer;flex-shrink:0;';
  let done=false;
  const close=()=>{if(t.parentElement)t.remove();};
  btn.onclick=()=>{if(done)return;done=true;close();try{onUndo&&onUndo();}catch(e){console.error('Undo failed',e);toast('Undo failed','er');}};
  t.appendChild(span);t.appendChild(btn);
  c.appendChild(t);
  setTimeout(close,seconds*1000);
}

// ── THEME TOGGLE ──────────────────────────────────────────────────────────────
function toggleTheme(){
  const html=document.documentElement;
  const btn=document.getElementById('themeBtn');
  const isLight=html.classList.contains('light-mode');
  if(isLight){
    html.classList.remove('light-mode');
    if(btn)btn.textContent='🌙';
    localStorage.setItem('prepHubTheme','dark');
  }else{
    html.classList.add('light-mode');
    if(btn)btn.textContent='☀️';
    localStorage.setItem('prepHubTheme','light');
  }
}

// Load saved theme — default is dark
if(localStorage.getItem('prepHubTheme')==='light'){
  document.documentElement.classList.add('light-mode');
  const btn=document.getElementById('themeBtn');
  if(btn)btn.textContent='☀️';
}

// ── SORTING ───────────────────────────────────────────────────────────────────
let sortBy={field:null,asc:true};
function sortTable(field){
  if(!field)return;
  // Save visual position — same slot in the table, not same data row
  const savedRow=focusRow;
  const savedCol=focusCol;

  if(sortBy.field===field){sortBy.asc=!sortBy.asc;}else{sortBy.field=field;sortBy.asc=true;}

  // Delegate to the single source of truth so date handling (and the
  // "Sent to Amazon at bottom" rule) stay consistent. Fixes the DD/MM sort bug
  // where unpadded dates like "20/5" jumped above "21/05".
  sortRows();

  // Update dropdown arrow indicator
  const dd=document.getElementById('prepSortF');
  if(dd){
    const arrow=sortBy.asc?' ↑':' ↓';
    Array.from(dd.options).forEach(o=>{
      o.text=o.text.replace(/ [↑↓]$/,'');
      if(o.value===field)o.text+=arrow;
    });
  }

  renderPrep();

  // Restore to same visual slot — clamp to table length in case rows filtered
  if(savedRow>=0){
    const newTrs=getRowEls();
    if(newTrs.length)setFocus(Math.min(savedRow,newTrs.length-1),savedCol<0?0:savedCol);
  }
}

// Update diff cell instantly without full re-render
function updateDiffCell(id,rcvd,exp){
  const td=document.getElementById('diff-'+id);if(!td)return;
  const _r=rows.find(x=>String(x.id)===String(id)||x.uuid===String(id));
  const diff=exp-(parseInt(_r&&_r.cancelledQty)||0)-rcvd;
  if(rcvd===0){td.innerHTML='<span class="nt-wait" title="Nothing booked in yet — this is not a discrepancy">none in</span>';return;}
  if(diff===0)td.innerHTML='<span class="nt nt-ok" style="font-family:Arial,sans-serif;">✓</span>';
  else if(diff>0)td.innerHTML=`<span class="nt nt-bad">-${diff}</span>`;
  else td.innerHTML=`<span class="nt nt-ok">+${Math.abs(diff)}</span>`;
}
