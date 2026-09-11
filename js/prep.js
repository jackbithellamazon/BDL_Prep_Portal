/* BDL PrepHub — js/prep.js — the Prep Sheet: table, the one rule, activity bar, add row, auto-clear.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── PREP TABLE ────────────────────────────────────────────────────────────────
let _prepShown=[];   // exactly the rows on screen — see getFilteredRows
function renderPrepRows(data){
  /* Remember precisely what was drawn. "Select all" used to re-derive the list
     with its own filter, which left out the archived check the renderer does —
     so ticking the box on a sheet showing 33 rows selected 743, every archived
     row included, and offered to archive them. A destructive action must
     operate on what is on the screen, not on a second opinion about it. */
  _prepShown=Array.isArray(data)?data.slice():[];
  // Never destroy a cell the user is actively editing. If focus is inside the
  // prep table, defer the rebuild until they blur. This is the universal guard
  // against a background save/echo/re-render wiping a half-typed value.
  const ae=document.activeElement;
  if(ae&&ae.closest&&ae.closest('#prepBody')&&(ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA')){
    _pendingPrepRender=true;
    if(!ae._deferBound){
      ae._deferBound=true;
      ae.addEventListener('blur',()=>{if(_pendingPrepRender){_pendingPrepRender=false;renderPrep();}},{once:true});
    }
    return;
  }
  // Clear stale DOM refs
  _prevFocusTr=null;_prevFocusTd=null;
  // The DOM is about to be rewritten with an arbitrary row set — the search
  // fast-path can no longer assume it holds the plain base set.
  _prepDomSig=null;
  const b=document.getElementById('prepBody');
  if(!data.length){b.innerHTML=`<tr><td colspan="18">${prepEmptyState()}</td></tr>`;return;}
  const todayStr=todayISO();
  b.innerHTML=data.map((r,_rowIx)=>{
    const diff=_effExp(r)-(r.rcvd||0);
    /* Said in whatever unit the person is holding. On a 2-pack, "3 short" means
       six bottles missing off the pallet, and the tooltip says so. */
    const _pk=packOf(r);
    const _inItems=n=>_pk>1?` (${Math.abs(n)*_pk} item${Math.abs(n)*_pk!==1?'s':''})`:'';
    const diffEl=r.rcvd>0
      ? (diff===0?`<span class="nt nt-ok" style="font-family:Arial,sans-serif;" title="All ${r.exp} accounted for${_pk>1?` — ${itemsOf(r.exp,r)} items`:''}">✓</span>`
        : diff>0?`<span class="nt nt-bad" title="${diff} short of the ${r.exp} expected${_inItems(diff)}">-${diff}</span>`
        : `<span class="nt nt-ok" title="${Math.abs(diff)} more than expected${_inItems(diff)}">+${Math.abs(diff)}</span>`)
      : `<span class="nt-wait" title="Nothing booked in yet — this is not a discrepancy">none in</span>`;
    const isSent=r.status==='Sent to Amazon';
    const canComp=isSent&&diff===0;
    // Age calculation: prefer createdAt, fall back to row date field (DD/MM)
    // Age from purchase date — 20-day clock starts from when item was ordered
    let rowAgeDate=null;
    if(r.date){
      const[dd,mm]=r.date.split('/');
      if(dd&&mm)rowAgeDate=new Date(`${new Date().getFullYear()}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
    }
    const daysSinceCreate=rowAgeDate&&!isNaN(rowAgeDate)?Math.floor((new Date()-rowAgeDate)/(1000*60*60*24)):0;
    const isOld=daysSinceCreate>=20;
    // If expected delivery date is set and hasn't passed yet — never flag red
    const expectedDeliveryDate=r.expectedDelivery?new Date(r.expectedDelivery):null;
    const expectedPassed=!expectedDeliveryDate||new Date()>expectedDeliveryDate;
    const safeStatuses=['Delivered','In Warehouse','Sent to Amazon','Part Sent'];
    const isSubSave=r.subSave==='Yes';
    /* Jack, 4 Sep (UK staff): "Subscribe & Save only gets 35 days before it
       turns red." It was exempt for ever, so 21 late S&S rows (£2,350) belonged
       to nobody. Same clock as every other row, just a longer one. */
    const _lateAfter=isSubSave?TM.ssLateDays:TM.lateDays;
    const isStuck=daysSinceCreate>_lateAfter&&r.status==='In-Transit'&&expectedPassed;
    // Auto-flag late rows if not already actioned — set directly, debounced save
    /* A row with a resolution has been dealt with — re-flagging it "Late"
       on the next repaint is how closed work kept reappearing as open. */
    if(isStuck&&!r.transitAction&&!r.resolution){
      r.transitAction='Late — Needs Chasing';
      r._dirty=true;
      debounce('autoflag_'+r.id,()=>saveRow(r),2000);
    }
    // Once a row has arrived/shipped, the transit follow-up tag is moot — clear it
    // so it stops showing "Late" and drops out of the chase queue.
    if(['Sent to Amazon','Part Sent','Delivered','In Warehouse','Returned'].includes(r.status)&&r.transitAction){
      r.transitAction='';
      r._dirty=true;
      debounce('clearta_'+r.id,()=>saveRow(r),2000);
    }
    const isSubSaveInTransit=isSubSave&&r.status==='In-Transit';
    const hasIssue=r.issueType&&r.issueType!=='—'&&r.issueType!=='';
    const statusClass=
      hasIssue?'st-issue':
      r.status==='Sent to Amazon'?'row-sent':
      r.status==='Part Sent'?'st-partsent':
      r.status==='In Warehouse'?'st-warehouse':
      r.status==='Delivered'?'st-delivered':
      r.status==='Issue'?'st-issue':
      r.status==='Returned'?'st-returned':
      r.status==='Not Arrived'?'st-notarrived':'';
    /* Jack, 4 Sep: "it didn't turn a colour" — a question with the admin team
       greys the whole row, like a row that is with Jack: someone else has it. */
    const _qOpen=!hasIssue&&!!_ukQuery(r);
    const _amzDel=_isAmzDel(r);   /* the flag colours the row whatever else is on it */
    /* Jack, 8 Sep: "thought we had a row turn another colour on issues — is
       that not happening any more?" It only ever fired when the STATUS itself
       was 'Issue'. A gated claim on an In-Warehouse row is still an issue, so
       the row says so — and the status colour no longer buries it. */
    const rowCls=[
      _amzDel?'row-amzdel':
      isStuck?'row-stuck':
      hasIssue?'row-issue':
      _qOpen?'row-query':
      isSubSaveInTransit?'row-subsave':
      statusClass,
      r.pri==='Yes'?'row-pri':'',
      r.archived?'row-archived':''
    ].filter(Boolean).join(' ');
    const rcvdColor=r.rcvd>0&&r.rcvd>=_effExp(r)?'var(--green)':r.rcvd>0?'var(--amber)':'';
    // Build tooltip explaining why this row is coloured
    const rowTooltip=
      _amzDel?`&#9679; Amazon say delivered — ${esc(r.resolution.amzDelivered.by||'Jack')} checked the account ${_qryWhen(r.resolution.amzDelivered.at)}. Check the shelves. Found it: book it in and send it on the next shipment, the flag clears itself. Not on the shelves: press Not here and it goes to Jack.`:
      isStuck?`⏱ Late — ${daysSinceCreate} days in transit (threshold: ${_lateAfter} days)`:
      _qOpen?`❓ Question with the admin team — ${_ukQuery(r).by||'warehouse'} asked ${_qryWhen(_ukQuery(r).at)}: is more on the way? The answer comes back in the VA Note.`:
      isSubSaveInTransit?'🔄 Subscribe & Save — expected delivery window applies':
      hasIssue?`⚑ Issue: ${r.issueType}${r.issueQty?' ('+r.issueQty+' units)':''}`:
      r.status==='Sent to Amazon'?'✓ Sent to Amazon':
      /* Jack, 7 Sep: "not true as only 1 arrived so not rest in warehouse is it" —
         the hover said every Part Sent row had units sitting here. Say the real
         split: what went, what is still here to send, what has not arrived. */
      r.status==='Part Sent'?(()=>{const _snt=segmentsSentTotal(r),_left=remainingToShip(r),_owe=_owedUnits(r);
        return '↗ Part Sent — '+_snt+' of '+(parseInt(r.exp)||0)+' sent'+(_left>0?' · '+_left+' here still to send':'')+(_owe>0?' · '+_owe+' still to arrive':'');})():
      r.status==='In Warehouse'?'📦 In Warehouse — ready to prep':
      r.status==='Delivered'?'✅ Delivered':
      r.pri==='Yes'?'⭐ Priority row':'';
    const rowBorder=
      _amzDel?'border-left:4px solid #22d3ee!important;':
      isStuck?'border-left:4px solid #ef4444!important;':
      _qOpen?'border-left:4px solid #94a3b8!important;':
      isSubSaveInTransit?'border-left:4px solid #5599ff!important;':
      hasIssue?'border-left:4px solid #f87171!important;':
      r.status==='In Warehouse'?'border-left:4px solid #a78bfa!important;':
      r.status==='Part Sent'?'border-left:4px solid #fb923c!important;':
      r.status==='Delivered'?'border-left:4px solid #34d399!important;':
      '';
    return `<tr class="${rowCls}" id="row-${r.id}" data-id="${r.id}" style="${r.archived?'opacity:.55;':''}${rowBorder}">
      <td style="text-align:center;font-size:11px;color:var(--text3);font-family:var(--mono);user-select:none;line-height:1.3;position:relative;" ${rowTooltip?`data-tip="${rowTooltip.replace(/"/g,'&quot;')}"`:''}
        onmouseenter="showRowTip(event,this)" onmouseleave="hideRowTip()">
        <div style="font-size:10px;color:var(--text3);">${_rowIx+1}</div>
        ${r.sheetRow
          ? `<div style="font-size:12px;font-weight:800;color:var(--accent);" title="Line ${r.sheetRow} on the Purchase Sheet">${r.sheetRow}</div>`
          : `<div style="font-size:10px;color:var(--text3);font-style:italic;" title="No Purchase Sheet line recorded — set it in Edit Row">—</div>`}
      </td>
      <td style="text-align:center;"><input type="checkbox" class="bulk-check" data-rk="${r.uuid||r.id}" ${_selectedIds.has(r.uuid||r.id)?'checked':''} onchange="if(this.checked)_selectedIds.add('${r.uuid||r.id}');else _selectedIds.delete('${r.uuid||r.id}');updateBulkUI();"></td>
      <td style="text-align:center;white-space:nowrap;"><button onclick="doAllArrived('${r.uuid||r.id}')" title="All Arrived — sets Qty Received = Expected Units, Status = In Warehouse. Can be overridden by editing Qty Received directly." style="background:var(--btn-blue-bg);border:1px solid var(--btn-blue-border);color:var(--btn-blue-text);border-radius:3px;width:18px;height:18px;font-size:11px;cursor:pointer;padding:0;line-height:1;">✈</button> <button onclick="doAllShipped('${r.uuid||r.id}')" title="All Shipped — sets Shipped = Received, prompts for Shipment ID" style="background:var(--btn-green-bg);border:1px solid var(--btn-green-border);color:var(--btn-green-text);border-radius:3px;width:18px;height:18px;font-size:11px;cursor:pointer;padding:0;line-height:1;">✓</button></td>

      <td class="sasCell">${r.issueType&&r.issueType!=='—'?`<span data-issue="1" class="sasFlag" title="Issue: ${r.issueType}${r.issueQty?' — '+r.issueQty+' unit'+(r.issueQty===1?'':'s'):''}">⚑</span>`:''}<a class="sas-btn" href="${r.sas}" target="_blank" style="font-size:10px;padding:2px 5px;">SAS</a></td>
      <td class="td-left">
        <div class="stack-date" style="gap:1px;">
          <div class="s-date" style="font-size:12px;">${r.date}</div>
          <div class="s-oid" style="font-size:11px;" onclick="copyVal('${r.oid.replace(/'/g,"\\'")}',this)">${r.oid||`<span style="color:var(--text3);font-style:italic;font-size:11px;">no order id</span>`}</div>
          <div class="s-sup" style="font-size:10px;">${r.sup}</div>
          ${r.acct?`<div style="font-size:11px;color:var(--text3);margin-top:1px;">${r.acct}</div>`:''}
          ${r.expectedDelivery?`<div style="font-size:11px;color:${new Date()>new Date(r.expectedDelivery)?'#ff5555':'#ffaa33'};margin-top:1px;">📅 ${new Date(r.expectedDelivery).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</div>`:''}
        </div>
      </td>
      <td class="td-left">
        <div class="stack">
          <div class="s-title" onclick="copyVal('${r.prod.replace(/'/g,"\\'")}',this)"
            data-tip="${(r.prod||'').replace(/"/g,'&quot;')}" onmouseenter="showRowTip(event,this)" onmouseleave="hideRowTip()"
            style="max-width:none;">${cpIco()}<span class="s-titleTxt">${shortTitle(r.prod)}</span></div>
          <div class="s-asin" onclick="copyVal('${r.asin}',this)">${cpIco()}${r.asin}</div>
          <div class="s-sku" onclick="copyVal('${r.sku}',this)">${cpIco()}${r.sku}</div>
        </div>
      </td>
      <td class="dgbun">${(()=>{
        const c=[];
        if(r.dg==='Yes')c.push('<span class="pchip dg" title="Dangerous goods">&#9888; DG</span>');
        if(r.bun==='Yes'){
          const q=parseInt(r.bqty);
          c.push(q>1
            ? `<span class="pchip" title="Bundled — ${q} items make one saleable unit">&#10064;&#65038; ${q} in 1</span>`
            : `<span class="pchip" title="Marked as a bundle but no quantity set on the Purchase Sheet">&#10064;&#65038; bundle</span>`);
        }
        return c.join(' ')||'<span class="pnone">&mdash;</span>';
      })()}</td>
      <td>${_cxParts(r).cx?`<div class="expLive" title="${fmt(r.exp||0)} ordered${_cxLabel(r,' · ')} — the number below is the order as written; this is what is still expected">${fmt(_effExp(r))}<small>${_cxLabel(r,' · ').replace(/^ · /,'')}</small></div>`:''}<input class="ci ci-num${_cxParts(r).cx?' expRaw':''}" type="number" value="${r.exp}" onchange="uf('${r.uuid||r.id}','exp',+this.value);updateDiffCell(${r.id},${r.rcvd||0},+this.value);debounce('stats',renderStats);" tabindex="-1">${(r.bun==='Yes'&&(parseInt(r.bqty)||0)>1)?`<div class="expPack" title="Bundle of ${r.bqty} — ${r.exp||0} saleable unit${(r.exp||0)!==1?'s':''}, ${(r.exp||0)*(parseInt(r.bqty)||1)} individual items to handle"><b>${(r.exp||0)*(parseInt(r.bqty)||1)}</b> items<br>&times;${r.bqty} per bundle</div>`:''}</td>
      <td><select class="ci-sel" onchange="handleStatusChange('${r.uuid||r.id}',this);" tabindex="-1">
        ${['In-Transit','Delivered','In Warehouse','Part Sent','Sent to Amazon','Issue','Not Arrived','Returned'].map(s=>`<option${r.status===s?' selected':''}>${s}</option>`).join('')}
      </select>${r.status==='Part Sent'?(()=>{const _left=remainingToShip(r);const _bs='display:block;margin-top:3px;width:100%;box-sizing:border-box;padding:4px 4px;border:none;border-radius:4px;font-size:9px;font-weight:800;cursor:pointer;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;background:#2563eb;color:#fff;';return `<button onclick="${_left>0?'sendMore':'sendExtra'}('${r.uuid||r.id}')" title="Send ${_left>0?'the remaining '+_left+' unit'+(_left===1?'':'s'):'another unit (none calculated as outstanding, but you can still send 1+ more)'} to a shipment ID" style="${_bs}">↗ Send more${_left>0?` (${_left})`:''}</button>`;})():''}</td>
      <td>${(()=>{
        /* Existing rows that already carry the impossible state — shipped more
           than was ever booked in. NOT rewritten silently: history is his, so
           the row says so out loud and he decides. New ones cannot be created
           (see the invariant in addSegment). */
        const _out=parseInt(r.ship)||0,_in=parseInt(r.rcvd)||0;
        /* Jack, 4 Sep: "sent and in looks wrong in qty received." The figures
           are right — 4 units went onto a shipment and none were ever booked
           in — but "4 sent, 0 in" sat in the QTY RECEIVED column repeating the
           0 underneath it, so it read like a miscount rather than a warning. */
        /* Jack, 4 Sep: this shouted over the very number the column exists to
           show. The received figure leads; the mismatch is one quiet line under
           it, in the same shape as every other sub-line on this table. */
        return (_out>_in)?`<div class="qtyFlag" title="${_out} unit${_out===1?'':'s'} were put on a shipment but ${_in===0?'none were':'only '+_in+' were'} ever booked in as received. Either the count-in was missed, or they never actually went. Fix the received figure, or undo the shipment on the Shipments page."><span class="qtyFlagDot">&#9888;</span>${_out} already sent out</div>`:'';})()}${isBundle(r)
        /* A bundle row is counted in ITEMS, because that is what comes out of
           the box. It was being typed straight into a box compared against the
           ASIN figure — 92 bottles against 49 units — which is where Becki's
           phantom "+43 extra" came from. */
        ? `<input class="ci ci-num" type="number" min="0" value="${itemsOf(r.rcvd,r)}" id="rcvIt-${r.id}"
             title="Count the individual items out of the box — ${packOf(r)} of them make one Amazon unit"
             onchange="setRcvdItems('${r.uuid||r.id}',${r.id},+this.value)"
             style="${rcvdColor?'color:'+rcvdColor:''}" tabindex="-1">
           <div class="expPack" id="rcvSub-${r.id}" title="Individual items counted in, and the Amazon units they make up">${
             r.rcvd?`<b>${r.rcvd}</b> unit${r.rcvd!==1?'s':''}`:`items<br>&times;${packOf(r)} per bundle`}</div>`
        : `<input class="ci ci-num" type="text" inputmode="numeric" value="${r.rcvd}" onchange="ufRcvdTyped('${r.uuid||r.id}',${r.id},${r.exp||0},this)" title="Type the total booked in — or +2 to add two more to what is already here" style="${rcvdColor?'color:'+rcvdColor:''}" tabindex="-1">`
      }</td>
      <td id="diff-${r.id}">${diffEl}</td>
      <td style="text-align:center;">
        ${(()=>{const _rk=r.uuid||r.id;
          const _cl=claims.filter(c=>(c.prepRowId===_rk||c.prepRowId===r.id||c.prepRowId===r.uuid)&&c.cst!=='Resolved'&&c.cst!=='Closed');
          const _seen=[];
          if(_cl.length)_cl.forEach(c=>{const t=(c.issT||'Issue');const q=parseInt(c.dif)||parseInt(c.exp)||0;const k=t+'|'+q;if(_seen.some(x=>x.k===k))return;_seen.push({k,t,q,id:c.id});});
          else if(hasIssue)_seen.push({k:'row',t:r.issueType||'Issue',q:parseInt(r.issueQty)||0,id:null});
          if(!_seen.length)return '';
          return _seen.map(x=>`<div class="issTag" onclick="openIssueModal('${r.uuid||r.id}')" title="Open the issue — ${esc(x.t)}${x.q?' · '+x.q+' unit'+(x.q===1?'':'s'):''}. Click to change or close it.">&#9873; ${esc(x.t)}${x.q?` &middot; ${x.q}`:''}</div>`).join('');})()}
        <button onclick="openIssueModal('${r.uuid||r.id}')" id="ib-${r.id}"
          style="padding:4px 10px;background:transparent;border:1px dashed var(--border2);color:var(--text3);border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;min-width:32px;"
          title="Raise an issue against this row">+ issue</button>
        ${(()=>{const _q=_ukQuery(r);const _rs=r.resolution||{};
          if(_isAmzDel(r))return `<div class="qryTag amz" title="Amazon say this was delivered. Found it on the shelves? Book it in and send it on the next shipment — the flag clears itself, nothing to press. Not here? Press the button and it goes to Jack to raise with Amazon.">Amazon say delivered — check the shelves</div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:4px;"><button class="qryAsk qryNot" onclick="amzNotHere('${r.uuid||r.id}')" title="Checked the shelves, back stock and anywhere else — it is not here. It goes straight to Jack to raise with Amazon.">Not here</button></div>`;
          if(typeof _partShipStale==='function'&&_partShipStale(r)){const _lf=(typeof remainingToShip==='function')?remainingToShip(r):0;
            return `<div class="qryTag" title="${fmt(parseInt(r.ship)||0)} went out${r.sentDate?' by '+_dmy(r.sentDate):''}; ${fmt(_lf)} never followed. Still on the shelf? Send them. Went out under another SKU? Press the button.">${fmt(_lf)} never went &mdash; still here, or another SKU?</div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:4px;"><button class="qryAsk" onclick="wentOutUnder('${r.uuid||r.id}')" title="They went out on another SKU's shipment — record it; Sarah confirms it in Seller Central">Went out under another SKU&hellip;</button></div>`;}
          if(_q)return `<div class="qryTag" onclick="openQuery('${r.uuid||r.id}')" title="${esc(_q.ask||'')}${_q.note?' — “'+esc(_q.note)+'”':''} — asked by ${esc(_q.by||'')} ${_qryWhen(_q.at)} · with ${_rs.state==='asked'?'Jack':'the admin team'}. The answer comes back in the VA Note.">&#10148; Admin team</div>`;
          const _aq=_rs.query;
          if(_aq&&_aq.answer==='more-coming'&&r.expectedDelivery&&new Date(r.expectedDelivery)>=new Date(new Date().toDateString()))return `<div class="qryTag ok" title="${esc(_aq.answeredBy||'')} answered ${_qryWhen(_aq.answeredAt)}: more is still coming${_aq.reply?' — “'+esc(_aq.reply)+'”':''}. See the VA Note.">&#10003; Due ${new Date(r.expectedDelivery).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</div>`;
          if(_qryOwed(r)>0&&!['Delivered','In Warehouse','Returned'].includes(r.status)&&!/missing|not arrived/i.test(String(r.issueType||'')))return `<button class="qryAsk" onclick="openQuery('${r.uuid||r.id}')" title="Not an issue — a question for Sarah: is more of this still on the way?">? ask</button>`;
          return '';})()}
      </td>
      <td><input class="ci ci-num" type="number" value="${r.ship}" onchange="uf('${r.uuid||r.id}','ship',+this.value);debounce('stats',renderStats);" tabindex="-1"></td>
      <td style="padding:4px;">
        ${(()=>{
          const segs=normaliseSegments(r);
          const unitWord=n=>n===1?'unit':'units';
          // A subtle "undo this batch" control — reads as a deliberate action, not
          // an error. Muted by default, turns red only on hover.
          const undoBtn=(s)=>`<button onclick="undoSegment('${r.uuid||r.id}','${s.shipId}','${s.date||''}',${s.units||0})" title="Undo this batch — return ${s.units} ${unitWord(s.units)} to send" style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;background:transparent;border:none;color:var(--text3);border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1;" onmouseover="this.style.background='var(--btn-red-bg)';this.style.color='var(--btn-red-text)';" onmouseout="this.style.background='transparent';this.style.color='var(--text3)';">↺</button>`;
          const unitBadge=(n)=>`<span style="flex-shrink:0;font-family:var(--mono);font-size:9px;font-weight:800;color:var(--accent);background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:0 6px;line-height:1.5;white-space:nowrap;">${n} ${unitWord(n)}</span>`;
          if(segs.length>1){
            // Split across shipments: stack each FBA ID as its own chip. The unit
            // badge matters here — it shows how the units divide across shipments.
            return `<div style="display:flex;flex-direction:column;gap:4px;">${
              segs.map(s=>`<div style="display:flex;align-items:center;gap:6px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:2px 4px 2px 8px;">
                <span style="font-family:var(--mono);font-size:10px;font-weight:800;color:var(--text);word-break:break-all;line-height:1.3;flex:1;min-width:0;">${s.shipId}</span>
                ${unitBadge(s.units)}
                ${undoBtn(s)}
              </div>`).join('')
            }</div>`;
          }
          if(segs.length===1){
            // One batch: a clean chip with an editable ID and a subtle undo. No unit
            // count here — it's identical to the Shipped Qty column, so it's just noise.
            const s=segs[0];
            return `<div style="display:flex;align-items:center;gap:6px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:2px 4px 2px 8px;">
              <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:${r.shipId?'var(--text)':'var(--text3)'};word-break:break-all;white-space:normal;line-height:1.4;cursor:text;flex:1;min-width:0;"
                onclick="editShipIdInline('${r.uuid||r.id}',this)" title="Click to edit shipment ID">${r.shipId||'—'}</span>
              ${undoBtn(s)}
            </div>`;
          }
          // No shipment yet: an editable, dashed "add ID" chip.
          return `<div style="font-family:var(--mono);font-size:10px;font-weight:700;word-break:break-all;white-space:normal;line-height:1.4;cursor:text;min-height:18px;color:var(--text3);border:1px dashed var(--border2);border-radius:6px;padding:2px 8px;"
            onclick="editShipIdInline('${r.uuid||r.id}',this)"
            title="Click to add shipment ID">${r.shipId||'—'}</div>`;
        })()}
        <input type="hidden" id="shipid-${r.id}" value="${r.shipId||''}">
        ${(()=>{const h=(typeof acNearly==='function')?acNearly(r):null;
          return h?`<div class="acHold" title="This row stays on the prep sheet until this is sorted">${esc(h)}</div>`:'';})()}
      </td>
      <td class="td-left"><div class="noteCell${r.notes?'':' empty'}" tabindex="0"
        title="Packing instructions — click to edit" onclick="editNote(this,'${r.uuid||r.id}','notes')"
        onkeydown="if(event.key==='Enter'){event.preventDefault();editNote(this,'${r.uuid||r.id}','notes');}"
        >${r.notes?esc(r.notes):'<span class="noteAdd">+ note</span>'}</div></td>
      <td class="td-left"><div class="noteCell va${r.vaNote?'':' empty'}" tabindex="0"
        title="${r.vaNoteBy?esc(r.vaNoteBy)+(r.vaNoteAt?' · '+new Date(r.vaNoteAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'')+' — click to edit':"Sarah's progress note — click to edit"}" onclick="editNote(this,'${r.uuid||r.id}','vaNote')"
        onkeydown="if(event.key==='Enter'){event.preventDefault();editNote(this,'${r.uuid||r.id}','vaNote');}"
        data-note-va="${r.uuid||r.id}"
        >${r.vaNote?esc(r.vaNote):'<span class="noteAdd">+ note</span>'}</div></td>
      <td style="text-align:center;min-width:160px;">
        <select class="ci" onchange="uf('${r.uuid||r.id}','transitAction',this.value);" style="font-size:10px;padding:2px 6px;background:${{'Urgent — Chase Now':'rgba(239,68,68,.2)','Late — Needs Chasing':'rgba(239,68,68,.15)','Delayed':'rgba(251,146,60,.15)','Chasing Supplier':'rgba(251,146,60,.12)','Awaiting Update':'rgba(251,146,60,.1)','On Its Way':'rgba(34,197,94,.08)'}[r.transitAction]||'var(--bg3)'};color:${{'Urgent — Chase Now':'#f87171','Late — Needs Chasing':'#f87171','Delayed':'#fb923c','Chasing Supplier':'#fb923c','Awaiting Update':'#fbbf24','On Its Way':'var(--green)'}[r.transitAction]||'var(--text2)'};border:1px solid ${{'Urgent — Chase Now':'rgba(239,68,68,.4)','Late — Needs Chasing':'rgba(239,68,68,.3)','Delayed':'rgba(251,146,60,.35)','Chasing Supplier':'rgba(251,146,60,.3)','Awaiting Update':'rgba(251,191,36,.3)','On Its Way':'rgba(34,197,94,.3)'}[r.transitAction]||'var(--border2)'};border-radius:3px;width:100%;cursor:pointer;font-weight:${r.transitAction?'600':'400'};" tabindex="-1">
          <option value="" ${!r.transitAction?'selected':''}>—</option>
          <option value="On Its Way" ${r.transitAction==='On Its Way'?'selected':''}>On Its Way</option>
          <option value="Delayed" ${r.transitAction==='Delayed'?'selected':''}>Delayed</option>
          <option value="Awaiting Update" ${r.transitAction==='Awaiting Update'?'selected':''}>Awaiting Update</option>
          <option value="Chasing Supplier" ${r.transitAction==='Chasing Supplier'?'selected':''}>Chasing Supplier</option>
          <option value="Late — Needs Chasing" ${r.transitAction==='Late — Needs Chasing'?'selected':''}>Late — Needs Chasing</option>
          <option value="Urgent — Chase Now" ${r.transitAction==='Urgent — Chase Now'?'selected':''}>Urgent — Chase Now</option>
        </select>
      </td>
      <td><div class="row-acts" style="opacity:1;">
        <button class="ra" title="Edit row" onclick="openEdit('${r.uuid||r.id}')" style="background:var(--btn-orange-bg);border:1px solid var(--btn-orange-border);color:var(--btn-orange-text);border-radius:3px;font-size:10px;font-weight:700;width:auto;padding:0 6px;cursor:pointer;">Edit</button>
        ${isSent?`<button class="ra" title="Undo Send — revert to In Warehouse" onclick="undoSentToAmazon('${r.uuid||r.id}')" style="background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:3px;font-size:11px;font-weight:700;width:auto;padding:0 5px;cursor:pointer;">↺ Undo</button>`:''}
        ${hasIssue?`<button class="ra" title="Move to Actions — removes from prep sheet" onclick="moveToActions('${r.uuid||r.id}')" style="background:rgba(248,113,113,.2);border:1px solid #f87171;color:#f87171;border-radius:3px;font-size:11px;font-weight:700;width:auto;padding:0 5px;cursor:pointer;">→ Actions</button>`:''}
        ${canComp?`<button class="ra g" title="Complete" onclick="openComp('${r.uuid||r.id}')">✓</button>`:''}
      </div></td>
      <td style="text-align:center;">${
        r.archived
          ?`<button onclick="(async()=>{const r=rows.find(x=>x.uuid==='${r.uuid||''}'||String(x.id)==='${r.id}');if(r){await unarchiveRow(r);renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();toast('Row unarchived');}})()" title="Unarchive — bring back to the active prep sheet" style="padding:2px 6px;background:var(--btn-blue-bg);border:1px solid var(--btn-blue-border);color:var(--btn-blue-text);border-radius:3px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap;">↺ Unarchive</button>`
          :(isSent?`<input type="checkbox" onchange="if(this.checked){archiveRowUI('${r.uuid||r.id}');}" title="Archive (hide from sheet, keep on Shipments page)">`:'<span style="color:var(--text3);">—</span>')
      }</td>
    </tr>`;
  }).join('');

  updateBundleCols(data);
  try{acPaintChip();paintAcctFilter();}catch(e){}
  // Apply issue badges for any rows with issueType already set
  // Re-render issue badges based on claims
  data.forEach(r=>{
    const rowIssues=claims.filter(cl=>(cl.prepRowId===(r.uuid||r.id)||cl.prepRowId===r.id||cl.prepRowId===r.uuid)&&cl.cst!=='Resolved'&&cl.cst!=='Closed');
    if(rowIssues.length>0)updateIssueFlag(r.id,true,rowIssues);
    else updateIssueFlag(r.id,false,[]);
  });
}

function deferClearNav(){}

/* ── THE ONE RULE: nothing can have shipped that was never received ──────────
   Jack, 17 Aug: "how can we received 0 but sent 2 out? — major bug". An audit
   of every quantity write found SIXTEEN ways to reach that state, in two
   families: shipping units that were never booked in, and — far more of them —
   zeroing the received count on a row that had ALREADY shipped. The old guard
   in uf() only ever looked at the first family, warned once per row per
   session, and then wrote the value anyway.

   `_sentOut` is the truth about what has left the building: the segments are
   authoritative, r.ship is the legacy mirror, so take whichever is larger. */
/* Jack, 6 Sep: "thought we fixed this" — a row showing 4 SHIPPED and 0
   RECEIVED. Units on a shipment were, by definition, here; typing the ship
   figure has raised the received count since 4 Sep, but rows that were
   already wrong stayed wrong. Every load and every sync now brings received
   up to what has gone out, and says so in the audit log. */
function healSentBelowReceived(why){
  let n=0;
  (rows||[]).forEach(r=>{
    if(!r||r.archived)return;
    const out=_sentOut(r),inn=parseInt(r.rcvd)||0;
    if(out>inn){
      r.rcvd=out;r._dirty=true;n++;
      debounce('healrcvd_'+(r.uuid||r.id),()=>saveRow(r),1500);
      try{logAudit('Received corrected to match what shipped',`${r.sku||r.asin||''} — was ${inn}, now ${out} (${why||'auto'})`);}catch(e){}
    }
    /* Jack, 6 Sep: a row still owed units is Part Sent, whatever went out */
    if(r.status==='Sent to Amazon'&&_owedUnits(r)>0){
      r.status='Part Sent';r.sent='No';r._dirty=true;n++;
      debounce('healst_'+(r.uuid||r.id),()=>saveRow(r),1500);
      try{logAudit('Status corrected to Part Sent',`${r.sku||r.asin||''} — ${_owedUnits(r)} still owed (${why||'auto'})`);}catch(e){}
    }
  });
  if(n)console.log('[heal] received raised to match shipped on '+n+' row(s) — '+(why||''));
  return n;
}
/* units the supplier still owes on a row */
/* Amazon say delivered, warehouse not sure — Becki's to check. Clears itself
   when received catches up, or when she answers Not here. */
function _amzFoundBySave(r){
  const a=r&&!r.archived&&r.resolution&&r.resolution.amzDelivered;
  if(!a||a.done||_owedUnits(r)>0)return false;
  const _d=new Date(),_dd=_ddUK(_d);
  a.done={by:_who(),at:_d.toISOString(),how:'found'};
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${_dd}: found it — all booked in`;
  r.vaNoteBy=_who();r.vaNoteAt=_d.toISOString();
  try{logAudit('Amazon-says-delivered cleared — all booked in',`${r.sku||r.asin||''} — ${fmt(parseInt(r.rcvd)||0)} of ${fmt(parseInt(r.exp)||0)} in`);}catch(e){}
  return true;
}
function _isAmzDel(r){const a=r&&r.resolution&&r.resolution.amzDelivered;return !!(a&&!a.done&&_owedUnits(r)>0);}
function _amzDelRows(){return rows.filter(r=>!r.archived&&_isAmzDel(r));}
let _amzFilterActive=false;
function toggleAmzFilter(){_amzFilterActive=!_amzFilterActive;renderPrep();}
function renderAmzBanner(){
  const el=document.getElementById('amzDelBanner');if(!el)return;
  const n=_amzDelRows().length;
  if(!n){if(_amzFilterActive){_amzFilterActive=false;}el.innerHTML='';return;}
  el.innerHTML=`<div class="nbBanner" style="border-color:rgba(34,211,238,.5);">
    <div class="nbTop">
      <span class="nbDot" style="color:#22d3ee;">&#9679;</span>
      <b>${n} order${n===1?'':'s'} Amazon say ${n===1?'was':'were'} delivered but ${n===1?'is':'are'}n\u2019t fully booked in</b>
      <span class="nbSub">check the shelves &mdash; if it is here, book it in and send it. If it is not, press the red <b style="color:#f87171;">Not here</b> button in the Issues column of the row</span>
      <button class="nbGo" style="background:rgba(34,211,238,.18);border-color:rgba(34,211,238,.5);color:#22d3ee;" onclick="toggleAmzFilter()">${_amzFilterActive?'Show everything':'Show just those'}</button>
    </div></div>`;
}
/* Jack, 9 Sep: "we don't need a Found it button. If Becki finds the stock she
   just sends it out on the next shipment — once everything balances the issue
   resolves anyway." So finding it is not a thing to press: book it in as
   normal and the flag clears itself. Only Not here needs an answer. */
/* Jack, 8 Sep: "Sarah flags it → goes to me → I check whether Amazon says it
   has arrived." One press, no popup — the question is always the same one. */
async function amzAskJack(rid){
  const r=_rowById(rid);if(!r)return;
  const now=new Date().toISOString();
  const riding=(typeof _caseOf==='function')?_caseOf(r):null;
  if(riding)riding.log=(riding.log||[]).concat([{at:now,by:_who(),what:'Sent to Jack — has Amazon delivered it?'}]);
  r.resolution=Object.assign({},r.resolution||{},{state:'asked',kind:'check',what:'jack-check',
    ask:'Has Amazon delivered it?',note:'',by:_who(),at:now,chase:riding||undefined});
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Sent to Jack — Amazon delivery check',`${r.sku||r.asin||''}`);
  toast('Sent to Jack — he checks the Amazon account and answers','ok');
  renderAdmin();try{renderJack();renderPrep();}catch(e){}
}
/* Jack, 8 Sep: "send to Becki to check if we have it — button there." His
   answer is a finding; SHE starts the shelf check. */
/* Jack, 8 Sep: "if Amazon says it hasn't arrived that needs to stay with me —
   Sarah can't deal with Amazon refunds anyway. She should still be able to see
   the status, but she doesn't have an action." So it never goes back to her
   list: it stays his, and her row shows his status line, read-only. */
async function amzClaimMine(rid){
  const r=_rowById(rid);if(!r)return;
  const now=new Date().toISOString(),owe=_owedUnits(r);
  const d=new Date(),dd=_ddUK(d);
  const ch=(r.resolution&&r.resolution.chase)||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Amazon say it was never delivered — following it up with Amazon for a refund'}]);
  r.delivered='No';
  r.resolution=Object.assign({},r.resolution||{},{state:'asked',kind:'check',what:'amz-claim',
    ask:`${_who()} confirmed it hasn\u2019t arrived — following up with Amazon for a refund${owe?` (${owe} unit${owe===1?'':'s'})`:''}`,
    note:'',by:_who(),at:now,chase:ch});
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: Amazon say it was never delivered — not coming, I am claiming it with Amazon`;
  r.vaNoteBy=_who();r.vaNoteAt=now;
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Amazon never delivered — with Jack',`${r.sku||r.asin||''} — ${owe} unit(s)`);
  toast('Yours until it is sorted — Sarah can see the status but has nothing to do','ok');
  renderJack();try{renderAdmin();renderPrep();}catch(e){}
}
async function amzToBecki(rid){
  const r=_rowById(rid);if(!r)return;
  const now=new Date().toISOString(),d=new Date(),dd=_ddUK(d);
  const who=(r.resolution&&r.resolution.rejectedBy)||'Jack';
  r.resolution=Object.assign({},r.resolution||{},{amzDelivered:{by:who,at:now,sentBy:_who()}});
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: ${who} says Amazon show this delivered — please check the shelves`;
  r.vaNoteBy=_who();r.vaNoteAt=now;
  const ch=(r.resolution.chase)||null;
  if(ch)ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Sent to Becki — Amazon say delivered, check the shelves'}]);
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Sent to the warehouse to check',`${r.sku||r.asin||''} — Amazon say delivered`);
  toast('Sent to Becki — it is flagged on the Prep Sheet for her to check the shelves','ok');
  renderAdmin();try{renderPrep();}catch(e){}
}
/* Jack, 9 Sep: "this was a mistake on the SKU — why has it gone back to
   Becki?" Sarah had pressed Send to Becki where the answer was Yes, wrong SKU —
   and the grey row had no way back, so Becki's only moves were Found it (books
   in units that never arrived) or Not here (a refund claim on Jack). Undo puts
   the row back exactly where it was: Jack's answer still on it, her two
   buttons back. The send stays in the history. */
async function amzUndoBecki(rid){
  const r=_rowById(rid);if(!r||!r.resolution||!r.resolution.amzDelivered)return;
  const now=new Date().toISOString(),d=new Date(),dd=_ddUK(d);
  const was=r.resolution.amzDelivered;
  const res=Object.assign({},r.resolution);delete res.amzDelivered;
  res.amzDeliveredUndone=(res.amzDeliveredUndone||[]).concat([Object.assign({},was,{undoneBy:_who(),undoneAt:now})]);
  r.resolution=res;
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: sent to Becki by mistake — back with Sarah, no need to check the shelves`;
  r.vaNoteBy=_who();r.vaNoteAt=now;
  const ch=r.resolution.chase||null;
  if(ch)ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Pulled back from Becki — sent by mistake'}]);
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Pulled back from the warehouse',`${r.sku||r.asin||''} — Send to Becki undone`);
  toast('Back with Sarah — the flag is off the Prep Sheet, her buttons are back','ok');
  renderAdmin();try{renderPrep();}catch(e){}
}
/* An Amazon order that is genuinely missing is his to raise — she never claims
   against Amazon herself. */
/* Jack, 9 Sep, on the Tefal: "needs to go back to me as that was wrong SKU and
   wrong amount on the purchase sheet." Becki was checking shelves for 2 units
   that were never ordered. Undo hands the row back to Sarah; this takes it
   straight to him, because he is the one who knows the sheet is wrong and he
   has the answer buttons for it. Becki's flag clears either way. */
async function amzBackToJack(rid){
  const r=_rowById(rid);if(!r||!r.resolution||!r.resolution.amzDelivered)return;
  const now=new Date().toISOString(),d=new Date(),dd=_ddUK(d);
  const was=r.resolution.amzDelivered;
  const res=Object.assign({},r.resolution);delete res.amzDelivered;
  res.amzDeliveredUndone=(res.amzDeliveredUndone||[]).concat([Object.assign({},was,{undoneBy:_who(),undoneAt:now,why:'pulled back to Jack'})]);
  const ch=res.chase||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Pulled back off the warehouse — Jack is answering it'}]);
  r.resolution=Object.assign({},res,{state:'asked',kind:'check',what:'jack-check',
    ask:'Pulled back off the warehouse — Jack to answer',note:'',by:_who(),at:now,chase:ch});
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: taken off the warehouse check — Jack is answering this one`;
  r.vaNoteBy=_who();r.vaNoteAt=now;
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Pulled back from the warehouse to Jack',`${r.sku||r.asin||''} — by ${_who()}`);
  toast('On Jack\u2019s Admin — off Becki\u2019s shelves list','ok');
  renderAdmin();try{renderJack();renderPrep();}catch(e){}
}
async function amzRaiseToJack(rid){
  const r=_rowById(rid);if(!r)return;
  const now=new Date().toISOString();
  const owe=_owedUnits(r);
  const ch=(r.resolution&&r.resolution.chase)||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Amazon say delivered and it is not here — to Jack to raise with Amazon'}]);
  r.resolution=Object.assign({},r.resolution||{},{state:'asked',kind:'check',what:'amz-missing',
    ask:`Amazon say delivered — ${owe} unit${owe===1?'':'s'} not in the warehouse. Raise it with Amazon.`,
    note:'',by:_who(),at:now,chase:ch});
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Amazon missing — to Jack',`${r.sku||r.asin||''} — ${owe} units`);
  toast('Sent to Jack — he raises it with Amazon','ok');
  renderAdmin();try{renderJack();renderPrep();}catch(e){}
}
async function amzNotHere(rid){
  const r=_rowById(rid);if(!r||!r.resolution||!r.resolution.amzDelivered)return;
  const now=new Date().toISOString(),d=new Date(),dd=_ddUK(d);
  r.resolution.amzDelivered.done={by:_who(),at:now,how:'not-here'};
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: checked the shelves — not here`;
  r.vaNoteBy=_who();r.vaNoteAt=now;
  /* Jack, 8 Sep: "if it's Amazon it needs to come back to me to raise a refund /
     speak to Amazon." Straight to his page, not Sarah's. */
  const ch=r.resolution.chase||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Checked the shelves — not here. Amazon say delivered — to Jack to raise it'}]);
  r.resolution=Object.assign({},r.resolution,{state:'asked',kind:'check',what:'amz-missing',
    ask:'Amazon say delivered — Becki checked the shelves, not here. Raise it with Amazon.',note:'',by:_who(),at:now,chase:ch});
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Amazon says delivered — not in warehouse',`${r.sku||r.asin||''} — to Jack`);
  toast('Sent to Jack — Amazon say delivered, you say not here. He raises it with Amazon.','ok');
  renderPrep();try{renderAdmin();renderJack();}catch(e){}
}
/* Jack, 9 Sep: "yes ask please." Pressing Sorted used to write the units off
   and close the row whatever had actually happened to the money — a refund
   Amazon promised and never paid vanished with it. Three answers, and only one
   of them is the end of it. */
function amzMoneyBox(rid,btn){
  const td=btn&&btn.closest('td');if(!td)return;
  const r=_rowById(rid);if(!r)return;
  const owe=_owedUnits(r),val=(parseSKU(r.sku).cogs||0)*owe;
  td.innerHTML=`<div class="jkAnsBox" data-jk-edit="1">
    <div class="jkAnsT">${fmt(owe)} unit${owe===1?'':'s'} &middot; ${fmtGBP2(val)} &mdash; has the money come back?</div>
    <button class="csAct good" onclick="amzMissingDone('${rid}','in')" title="The refund or reimbursement has landed. The row closes everywhere and nothing stays on your money list.">Yes &mdash; the money is back</button>
    <button class="csAct go" onclick="amzMissingDone('${rid}','raised')" title="Raised with Amazon but the money has not landed yet. The row closes for everyone else and stays on your money list until you say it has landed.">Raised &mdash; still waiting on the money</button>
    <button class="csAct warn" onclick="amzMissingDone('${rid}','refused')" title="No money coming — written off. It stays visible as a loss rather than disappearing.">No money coming &mdash; write it off</button>
    <button class="csAct plain" onclick="renderJack()">Back</button></div>`;
}
async function amzMissingDone(rid,money){
  const r=_rowById(rid);if(!r||!r.resolution)return;
  const now=new Date().toISOString();
  const owe=_owedUnits(r);
  const ch=r.resolution.chase||{path:'never-arrived',step:'',due:'',log:[]};
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:`Sorted with Amazon — refund or reimbursement raised${owe?` · ${owe} unit${owe===1?'':'s'} written off`:''}`}]);
  money=money||'in';
  ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:money==='in'?'Refund received':money==='refused'?'No refund coming — written off':'Refund raised with Amazon — waiting on the money'}]);
  r.resolution=Object.assign({},r.resolution,{state:'approved',kind:'ops',
    what:money==='refused'?'no-refund':'refund-done',approvedBy:_who(),approvedAt:now,
    refundRaised:{by:_who(),at:now},refundUnits:owe,
    moneyIn:money==='in'?{by:_who(),at:now}:undefined,
    moneyOff:money==='refused'?{by:_who(),at:now,why:'Amazon would not refund'}:undefined,
    chase:ch});
  /* Jack, 8 Sep: a processed refund is closed and done. The units are not
     coming, so they stop being owed — otherwise the row resurfaces forever. */
  if(owe>0)r.cancelledQty=(parseInt(r.cancelledQty)||0)+owe;
  try{_statusFollowsStock(r);if(/^Late/.test(String(r.transitAction||'')))r.transitAction='';}catch(e){}
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  logAudit('Amazon missing sorted',`${r.sku||r.asin||''} — ${money==='in'?'money received':money==='refused'?'written off, no refund':'refund raised, waiting on the money'} — ${_who()}`);
  toast(money==='in'?'Done — money received, closed everywhere':money==='refused'?'Written off — no money coming':'Closed for everyone else — it stays on your money list until the money lands','ok');
  renderJack();try{renderAdmin();renderPrep();}catch(e){}
}
function _owedUnits(r){return Math.max(0,(parseInt(r&&r.exp)||0)-(parseInt(r&&r.rcvd)||0)-(parseInt(r&&r.cancelledQty)||0));}
/* Jack, 10 Sep: "if no more are coming as they have been refunded, why is it
   still down as in transit?" The order quantity stays as the record (it is
   what the Purchase Sheet says); what the row SHOWS is what is still expected
   after every decision — 10 ordered with 2 refunded expects 8. */
function _effExp(r){return Math.max(0,(parseInt(r&&r.exp)||0)-(parseInt(r&&r.cancelledQty)||0));}
/* Status follows the stock the moment nothing is owed. Everything shipped —
   Sent to Amazon. Units on the shelf still to send — In Warehouse. A row
   nothing ever landed on is a phantom and files. Never touches a row that
   still owes units, and never moves a row backwards. */
function _statusFollowsStock(r){
  if(!r||_owedUnits(r)>0)return '';
  const got=parseInt(r.rcvd)||0,ship=parseInt(r.ship)||0;
  const left=(typeof remainingToShip==='function')?remainingToShip(r):0;
  if(got===0&&ship===0){if(!r.archived){r.archived=true;return 'archived — nothing ever landed on this row';}return '';}
  if(ship>0&&left===0&&r.status!=='Sent to Amazon'){r.status='Sent to Amazon';r.sent='Yes';if(!r.sentDate)r.sentDate=((r.shipSegments||[]).slice(-1)[0]||{}).date||new Date().toISOString().slice(0,10);return 'everything shipped — Sent to Amazon';}
  if(got>0&&left>0&&['In-Transit','Issue',''].includes(r.status||'')){r.status='In Warehouse';return `${fmt(left)} on the shelf to send — In Warehouse`;}
  return '';
}
/* Jack, 9 Sep: "whose sheet is Samsung on?" Nobody's. Closing a row never
   touched its units or status, so a wrong-SKU close left 2 units "still out"
   on an In-Transit row that every list then ignored because it was approved.
   Six rows sat like that, £2,400 of phantom in-transit stock. A close that
   says nothing more is coming now SETTLES the row:
     arrived and correct  → whatever was still out is booked in
     wrong SKU            → the outstanding units are accounted for on the
                            other SKU's row (recorded as wentAsQty, counted
                            like cancelled so nothing is owed); a row that
                            never received or shipped anything is a phantom
                            and archives
     cancelled            → outstanding units cancelled
   Then, with nothing owed: the stale 'Late' label clears, and a row that has
   shipped everything it holds becomes Sent to Amazon. Returns what it did. */
function _settleClosedUnits(r,what){
  if(!r)return{changed:false,note:''};
  if(r.resolution&&r.resolution.amzDelivered&&!r.resolution.amzDelivered.done)return{changed:false,note:''};
  const before={rcvd:parseInt(r.rcvd)||0,cx:parseInt(r.cancelledQty)||0,status:r.status,archived:!!r.archived,ta:r.transitAction||''};
  const exp=parseInt(r.exp)||0;let got=before.rcvd,cx=before.cx;
  let owed=Math.max(0,exp-got-cx),notes=[];
  /* Jack, 9 Sep: "if Sarah says NO, it hasn't gone out on the wrong SKU, then
     the unit is still missing/unaccounted for — therefore it needs to go to
     Becki to physically check the warehouse." Wrong SKU is the only close that
     TRACES the units. 'Arrived and correct' with units still out traces
     nothing: the order came, the count does not match, so they are unaccounted
     for and that is a shelf question, not a paperwork one. Never booked in on
     the strength of the outcome alone. */
  if(what==='arrived-ok'&&owed>0){return{changed:false,toBecki:true,note:`${fmt(owed)} unaccounted for — the order arrived but the count does not match, so it goes to Becki to check the shelves`};}
  else if((what==='wrong-sku'||what==='cancel-wrong-sku')&&owed>0){
    r.cancelledQty=cx+owed;
    if(r.resolution)r.resolution.wentAsQty=(parseInt(r.resolution.wentAsQty)||0)+owed;
    notes.push(`${fmt(owed)} accounted for on the other SKU${r.resolution&&r.resolution.wentAs?' ('+r.resolution.wentAs+')':''}`);owed=0;}
  else if((what==='cancelled'||what==='duplicate')&&owed>0){r.cancelledQty=cx+owed;notes.push(`${fmt(owed)} cancelled`);owed=0;}
  if(owed===0){
    if(/^Late/.test(String(r.transitAction||'')))r.transitAction='';
    const _m=_statusFollowsStock(r);if(_m)notes.push(_m);
  }
  const changed=before.rcvd!==(parseInt(r.rcvd)||0)||before.cx!==(parseInt(r.cancelledQty)||0)||before.status!==r.status||before.archived!==!!r.archived||before.ta!==(r.transitAction||'');
  /* what the close did to the numbers, on the row itself — so a month from now
     the row still says why 10 units stopped being owed, without the audit log */
  if(changed&&r.resolution&&notes.length)r.resolution.settled={what,note:notes.join(' · '),by:(typeof _who==='function'?_who():''),at:new Date().toISOString()};
  return{changed,note:notes.join(' · '),before};
}
/* cancelledQty is the "not coming on this row" bucket. It now holds two very
   different things: units genuinely cancelled, and units Sarah traced to
   another SKU. Every place that prints it says which. */
function _cxParts(r){
  const cx=parseInt(r&&r.cancelledQty)||0;
  const wa=Math.min(cx,parseInt(r&&r.resolution&&r.resolution.wentAsQty)||0);
  return{cx,wentAs:wa,cancelled:Math.max(0,cx-wa),sku:(r&&r.resolution&&r.resolution.wentAs)||''};
}
function _cxLabel(r,sep){
  const p=_cxParts(r);if(!p.cx)return '';
  const out=[];
  if(p.cancelled)out.push(`${fmt(p.cancelled)} cancelled`);
  if(p.wentAs)out.push(`${fmt(p.wentAs)} went out as ${p.sku||'another SKU'}`);
  return (sep||' · ')+out.join(sep||' · ');
}
/* the same hand-over Sarah's "No — send to Becki" makes, from a close that
   turned out to leave units unaccounted for */
async function _sendToBeckiShelves(r,why){
  if(!r)return false;
  const now=new Date().toISOString(),d=new Date(),dd=_ddUK(d);
  const who=(r.resolution&&(r.resolution.approvedBy||r.resolution.by))||'Sarah';
  r.resolution=Object.assign({},r.resolution||{},{amzDelivered:{by:who,at:now,sentBy:_who()}});
  r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${dd}: ${why||'unaccounted for'} — please check the shelves`;
  r.vaNoteBy=_who();r.vaNoteAt=now;
  const ch=(r.resolution.chase)||null;
  if(ch)ch.log=(ch.log||[]).concat([{at:now,by:_who(),what:'Sent to Becki — '+(why||'unaccounted for')}]);
  r._dirty=true;
  return true;
}
/* Jack, 11 Sep: "if Becki realises she sent it under the wrong SKU, she can put
   that in and send it back to Sarah — she doesn't need to validate Seller
   Central herself." The units are recorded as shipped on the other SKU's
   shipment, the row closes by the stock rule, and Sarah gets one job: confirm
   it in Seller Central. */
function wentOutUnder(rid){
  const r=_rowById(rid);if(!r)return;
  const left=(typeof remainingToShip==='function')?remainingToShip(r):Math.max(0,(parseInt(r.rcvd)||0)-(parseInt(r.ship)||0));
  if(left<=0){toast('Everything on this row has already shipped','er');return;}
  askText(`${fmt(left)} went out under another SKU?`,
    `Which SKU ${left===1?'did it':'did they'} go out under? The ${fmt(left)} ${left===1?'unit is':'units are'} recorded as shipped on that SKU's shipment, this row closes, and Sarah gets the job of confirming it in Seller Central.`,
    'e.g. the old SKU','Record it',sku=>{
      sku=String(sku||'').trim();if(!sku)return;
      let shipId='',best='';
      rows.filter(x=>x!==r&&x.sku===sku).forEach(o=>(o.shipSegments||[]).forEach(s=>{if(s.shipId&&String(s.date||'')>=best){best=String(s.date||'');shipId=s.shipId;}}));
      if(!shipId){askText('Which shipment?','No shipment is recorded against that SKU — type the shipment ID it went out on.','FBA…','Record it',id=>_wentOutGo(r,sku,String(id||'').trim(),left));return;}
      _wentOutGo(r,sku,shipId,left);
    });
}
async function _wentOutGo(r,sku,shipId,units){
  if(!r||!shipId||!(units>0))return;
  const dd=_ddUK();
  try{addSegment(r,shipId,units,r.shipType||'Standard');}catch(e){toast('Could not record the shipment: '+(e&&e.message||e),'er');return;}
  r.notes=((r.notes||'').trim()?(r.notes.trim()+'\n'):'')+`${_who()} ${dd}: ${fmt(units)} went out under ${sku} on ${shipId}`;
  r._dirty=true;
  try{await _mustSave(r);}catch(e){toast('Didn\u2019t save — nothing was recorded','er');return;}
  try{await addVaActions(r,['Confirm in Seller Central'],`${_who()} says ${fmt(units)} × ${r.prod||r.sku||''} went out under ${sku} on ${shipId} — confirm it in Seller Central, then it is accounted for`);}catch(e){}
  try{logAudit('Went out under another SKU',`${r.sku||''} — ${fmt(units)} unit${units===1?'':'s'} on ${shipId} as ${sku} — ${_who()}`);}catch(e){}
  toast(`${fmt(units)} recorded as shipped on ${shipId} as ${sku} — Sarah gets the Seller Central check`,'ok');
  try{renderPrep();renderAdmin();renderJack();}catch(e){}
}
/* which approved-and-closed rows are still owed units — the limbo list */
function _limboRows(){
  const settle=['arrived-ok','wrong-sku','cancel-wrong-sku','cancelled','duplicate'];
  /* a row already handed to Becki is being dealt with — it is not limbo */
  return rows.filter(r=>!r.archived&&r.resolution&&!(r.resolution.amzDelivered&&!r.resolution.amzDelivered.done)
    &&r.resolution.state==='approved'&&settle.includes(r.resolution.what)
    &&['In-Transit','Part Sent','In Warehouse','Delivered','Issue',''].includes(r.status||'')&&_owedUnits(r)>0);
}
function _sentOut(r){
  let segs=0;
  try{segs=segmentsSentTotal(r);}catch(e){}
  return Math.max(parseInt(r&&r.ship)||0,segs||0);
}
/* Refuse to drop the received count below what is already on a shipment. The
   shipment record lives ONLY on this row, so the honest route out is to undo
   the send — not to quietly rewrite the count under it. Returns true if the
   write was blocked. */
function _blockRcvdBelowSent(r,want){
  const out=_sentOut(r);
  if((parseInt(want)||0)>=out||out<=0)return false;
  const ids=(r.allShipIds&&r.allShipIds.length?r.allShipIds:[r.shipId]).filter(Boolean).join(', ');
  toast(`${out} unit${out===1?'':'s'} are already on ${ids||'a shipment'} — undo the send first, then change what arrived`,'er');
  return true;
}
/* Jack, 5 Sep: "8 arrive today, 2 tomorrow — she types +2, it becomes 10."
   A leading + or − adds to what is already booked in; a plain number still
   replaces it, exactly as before. */
function ufRcvdTyped(id,rid,exp,el){
  const raw=String(el.value||'').trim();
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));if(!r)return;
  const was=parseInt(r.rcvd)||0;
  let v;
  if(/^[+\-−]\d+$/.test(raw)){v=Math.max(0,was+parseInt(raw.replace('−','-'),10));
    try{logAudit('Received added to',`${r.sku||r.asin||''} — ${was} ${raw.replace('−','-')} = ${v} (typed on the sheet)`);}catch(e){}}
  else v=Math.max(0,parseInt(raw,10)||0);
  el.value=v;
  uf(id,'rcvd',v);updateDiffCell(rid,v,exp);debounce('stats',renderStats);
}
function uf(id,field,val){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  /* Received cannot go below what has gone out. This is the direction the old
     guard never checked, and it is how most of the bad rows were made — the
     bundle items box flooring to 0, a cleared cell, a corrected count. */
  if(field==='rcvd'&&_blockRcvdBelowSent(r,val)){try{renderPrep();}catch(e){}return;}
  /* The other direction: typing a shipped figure larger than what was booked
     in. Rather than warn once and write it anyway, the received count is
     brought up to match — putting units on a shipment IS saying they were
     here — and the correction is named in the Audit Log. */
  if(field==='ship'&&(val||0)>(parseInt(r.rcvd)||0)){
    const was=parseInt(r.rcvd)||0;
    r.rcvd=val||0;
    toast(`Only ${was} booked in — Qty Received raised to ${val} so the numbers add up`,'er');
    try{logAudit('Received corrected to match what shipped',
      `${r.sku||r.asin||''} — was ${was}, now ${val} (typed on the sheet)`);}catch(e){}
  }
  /* the 48-hour part-arrival clock reads this: when did the count last move */
  if(field==='rcvd'&&(parseInt(val)||0)!==(parseInt(r.rcvd)||0))r.rcvdAt=new Date().toISOString();
  if(field==='rcvd'&&r.resolution&&r.resolution.amzDelivered&&!r.resolution.amzDelivered.done){
    const _owe=Math.max(0,(parseInt(r.exp)||0)-(parseInt(val)||0)-(parseInt(r.cancelledQty)||0));
    if(_owe===0){r.resolution.amzDelivered.done={by:_who(),at:new Date().toISOString(),how:'found'};
      const _d=new Date(),_dd=_ddUK(_d);
      r.vaNote=((r.vaNote||'').trim()?(r.vaNote.trim()+'\n'):'')+`${_who()} ${_dd}: found it — all booked in`;
      r.vaNoteBy=_who();r.vaNoteAt=new Date().toISOString();
      toast('All booked in — the Amazon-says-delivered flag is cleared','ok');}
  }
  /* who wrote the VA note and when — survives a refresh once the SQL adds the columns */
  if(field==='vaNote'&&String(val||'').trim()!==String(r.vaNote||'').trim()){
    r.vaNoteBy=String(val||'').trim()?_who():'';r.vaNoteAt=String(val||'').trim()?new Date().toISOString():'';}
  r[field]=val;
  // Keep shipment segments coherent for SIMPLE rows (one shipment). For rows
  // split across multiple shipments we leave segments as the source of truth —
  // edit the split via the green tick / undo instead of these inline cells.
  if(field==='ship'||field==='shipId'){
    const segs=normaliseSegments(r);
    if(segs.length<=1){
      if(field==='ship'){
        if((val||0)>0){const _existSeg=(r.shipSegments||[]).find(s=>s.shipId===(r.shipId||''));r.shipSegments=[{shipId:r.shipId||'',units:val,date:_existSeg?.date||_segDateFor(r,r.shipId||''),type:r.shipType||'Standard'}];}
        else{r.shipSegments=[];}
      }else if(field==='shipId'){
        if(segs.length===1){segs[0].shipId=val;r.shipSegments=segs;}
        else if((r.ship||0)>0){const _existSeg2=(r.shipSegments||[]).find(s=>s.shipId===val)||r.shipSegments?.[0];r.shipSegments=[{shipId:val,units:r.ship,date:_existSeg2?.date||_segDateFor(r,val),type:r.shipType||'Standard'}];}
        r.allShipIds=val?[val]:[];
      }
    }
  }
  r._dirty=true;
  r._srch=null;
  debounce('save_'+id,()=>{saveRow(r);},300);
}

/* Search filters on every keystroke, instantly. The row data is all in memory,
   so matching "bos" → "Bosch" is a trivial array filter — spreadsheet-fast.
   Crucially it does NOT flush dirty-row saves (that network work is what used
   to block the repaint per keystroke). Edits still save via their own debounce. */
/* The prep table render is heavy (rebuilds all rows' HTML). Running it inline on
   each keystroke blocks the browser from painting the typed character. So we
   defer the filter: the keystroke returns immediately (input paints), then the
   filter runs after a short idle. Rapid typing collapses to a single render. */
let _prepSearchT=null;
/* THE DURABLE FIX — searching no longer rebuilds the table's HTML at all.
   The table is rendered ONCE with the full base set (status/late/issue/archive
   filters applied, but NOT the search query). Each keystroke then just toggles
   `display:none` on existing <tr> elements — no innerHTML, no Date parsing,
   no 185-line template per row. That's sub-millisecond for hundreds of rows,
   so typing paints instantly and results follow in the same breath.
   A full rebuild only happens when the underlying base set changes (status
   filter, sort, archive toggle, data edits) — renderPrepRows invalidates
   `_prepDomSig` whenever it rewrites the DOM, and the next keystroke rebuilds
   the base set exactly once before returning to the cheap toggle path. */
function onPrepSearch(){
  clearTimeout(_prepSearchT);
  // Tiny coalescing delay: the keystroke handler itself does nothing heavy,
  // so the character always paints on the very next frame.
  _prepSearchT=setTimeout(()=>{requestAnimationFrame(applyPrepSearch);},40);
}
let _prepDomSig=null; // signature of the un-searched base set currently in the DOM
function _prepBaseSig(){
  const st=(document.getElementById('prepStF')||{}).value||'';
  const ac=(document.getElementById('prepAcctF')||{}).value||'';
  return st+'|'+ac+'|'+(_issuesFilterActive?1:0)+'|'+(_lateFilterActive?1:0)+'|'+(_readyFilterActive?1:0)+'|'+(_amzFilterActive?1:0)+'|'+(_ssFilterActive?1:0)+'|'+(_showArchived?1:0);
}
// Base set = every filter EXCEPT the search query (mirrors filterPrep's logic)
function _prepBaseRows(){
  const st=(document.getElementById('prepStF')||{}).value||'';
  const _acctF=(document.getElementById('prepAcctF')||{}).value||'';
  /* Jack, 3 Sep: "happy for it to archive but I don't want it to show on the
     Prep Sheet." Cleared-out history is not archived STOCK — it is noise from
     before the app existed, and it would have swamped Show Archived. It never
     appears on this page in either mode; it lives in History Lookup and the
     audit log, and Undo still works from the toast. */
  const base=(_showArchived?rows.filter(r=>r.archived):rows.filter(r=>!r.archived)).filter(r=>!_offPrepSheet(r));
  if(!st&&!_acctF&&!_issuesFilterActive&&!_lateFilterActive&&!_readyFilterActive&&!_amzFilterActive&&!_ssFilterActive)return base;
  return base.filter(r=>{
    const rid=r.uuid||String(r.id);
    if(_acctF&&String(r.acct||'').trim()!==_acctF)return false;
    if(_readyFilterActive&&acHold(r)!==null)return false;
    if(_issuesFilterActive){
      const hasIssue=claims.some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id)&&cl.cst!=='Resolved');
      if(!hasIssue)return false;
    }
    if(_amzFilterActive&&!_isAmzDel(r))return false;
    if(_ssFilterActive&&r.subSave!=='Yes')return false;
    if(_lateFilterActive&&!_prepRowLate(r))return false;   /* one rule, shared with the dashboard */
    if(st){
      const hasIssueFlag=claims.some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id)&&cl.cst!=='Resolved'&&cl.cst!=='Closed');
      if(r.status!==st&&!(st==='Issue'&&hasIssueFlag))return false;
    }
    return true;
  });
}
function applyPrepSearch(){
  const inp=document.getElementById('prepSrch');if(!inp)return;
  const q=inp.value.toLowerCase();
  const sig=_prepBaseSig();
  if(_prepDomSig!==sig){
    // DOM doesn't currently hold the plain base set — rebuild it ONCE (without
    // the query), preserving scroll, then fall through to the cheap toggle.
    const wrap=document.querySelector('#page-prep .tbl-wrap');
    const scrollTop=wrap?wrap.scrollTop:0;
    renderPrepRows(_prepBaseRows());   // sets _prepDomSig=null internally
    if(_pendingPrepRender)return;      // rebuild was deferred (cell mid-edit)
    _prepDomSig=sig;
    if(wrap)wrap.scrollTop=scrollTop;
  }
  const b=document.getElementById('prepBody');if(!b)return;
  const map=new Map(rows.map(r=>[String(r.id),r]));
  let shown=0;
  b.querySelectorAll('tr[data-id]').forEach(tr=>{
    const r=map.get(tr.dataset.id);
    let show=true;
    if(q){
      if(!r)show=false;
      else{
        if(!r._srch)r._srch=(r.sku+'|'+r.asin+'|'+(r.ean||'')+'|'+r.prod+'|'+r.oid+'|'+r.sup+'|'+(r.acct||'')+'|'+r.date+'|'+(r.notes||'')+'|'+(r.vaNote||'')+'|'+(r.transitAction||'')).toLowerCase();
        show=r._srch.includes(q);
      }
    }
    tr.style.display=show?'':'none';
    if(show){shown++;const numDiv=tr.querySelector('td div');if(numDiv)numDiv.textContent=shown;}
  });
  // "No rows found" message when the query matches nothing (all rows hidden)
  let nm=document.getElementById('prepNoMatchRow');
  if(shown===0){
    if(!nm){
      nm=document.createElement('tr');
      nm.id='prepNoMatchRow';
      b.appendChild(nm);
    }
    nm.innerHTML=`<td colspan="18">${prepEmptyState()}</td>`;
    nm.style.display='';
  }else if(nm){nm.style.display='none';}
}
function updatePrepSearchUI(){}
/* the account list is whatever is actually on the sheet — never a hard-coded
   list that quietly goes stale when a new buying account appears */
function paintAcctFilter(){
  const sel=document.getElementById('prepAcctF');if(!sel)return;
  const seen={};
  const inView=r=>!_offPrepSheet(r)&&((typeof _showArchived!=='undefined'&&_showArchived)?r.archived:!r.archived);
  rows.filter(inView).forEach(r=>{const a=String(r.acct||'').trim();if(a)seen[a]=(seen[a]||0)+1;});
  const names=Object.keys(seen).sort();
  const cur=sel.value;
  const want=''+names.map(n=>n+':'+seen[n]).join('|');
  if(sel.dataset.built===want)return;            // nothing new — leave it alone
  sel.dataset.built=want;
  sel.innerHTML='<option value="">All accounts</option>'
    +names.map(n=>`<option value="${esc(n)}">${esc(n)} (${seen[n]})</option>`).join('');
  if(names.indexOf(cur)>=0)sel.value=cur;        // keep the chosen one selected
}

/* An empty sheet with no explanation reads as deleted data. 24 Aug: the
   Ready-to-clear chip was left on with nothing eligible, every row was hidden,
   the sheet said only "No rows found" — and it was reported as "the auto-clear
   has wiped the prep sheet". The rows were fine; 13 of them then never got
   marked sent because nobody could see them, and a 96-unit shipment reached
   Amazon with 52 units in the hub. The empty state now names every filter that
   is hiding rows and clears the lot with one click. */
function prepEmptyState(){
  const active=[];
  if(typeof _readyFilterActive!=='undefined'&&_readyFilterActive)active.push('the <b>Ready to clear</b> filter');
  const _ac=(document.getElementById('prepAcctF')||{}).value||'';
  if(_ac)active.push(`the account filter (<b>${esc(_ac)}</b>)`);
  if(_issuesFilterActive)active.push('the <b>Issues</b> filter');
  if(_lateFilterActive)active.push('the <b>Late</b> filter');
  if(_ssFilterActive)active.push('the <b>S&amp;S</b> filter');
  const st=(document.getElementById('prepStF')||{}).value||'';
  if(st)active.push(`the status filter (<b>${esc(st)}</b>)`);
  const q=((document.getElementById('prepSrch')||{}).value||'').trim();
  if(q)active.push(`your search (<b>&ldquo;${esc(q)}&rdquo;</b>)`);
  const hidden=(_showArchived?rows.filter(r=>r.archived):rows.filter(r=>!r.archived)).filter(r=>!_offPrepSheet(r)).length;
  if(!active.length||!hidden)
    return `<div class="empty"><div class="empty-ico">📦</div><div class="empty-t">No rows found</div></div>`;
  return `<div class="empty"><div class="empty-ico">📦</div>
    <div class="empty-t">Nothing matches — but ${fmt(hidden)} row${hidden===1?' is':'s are'} still here</div>
    <div style="font-size:12.5px;color:var(--text2);margin-top:6px;line-height:1.6;">
      ${active.join(' and ')} ${active.length===1?'is':'are'} hiding ${hidden===1?'it':'them'}. Nothing has been cleared or deleted.</div>
    <button onclick="prepShowEverything()" style="margin-top:12px;padding:7px 16px;background:var(--accent);border:none;color:#1a1a18;border-radius:6px;font-size:12.5px;font-weight:800;cursor:pointer;">Show everything</button>
  </div>`;
}
function prepShowEverything(){
  if(typeof _readyFilterActive!=='undefined'&&_readyFilterActive)toggleReadyFilter();
  if(_issuesFilterActive)toggleIssuesFilter();
  if(_lateFilterActive)toggleLateFilter();
  if(_ssFilterActive)toggleSubSaveFilter();
  const st=document.getElementById('prepStF');if(st)st.value='';
  const ac=document.getElementById('prepAcctF');if(ac)ac.value='';
  const q=document.getElementById('prepSrch');if(q)q.value='';
  filterPrep();
}
function filterPrep(skipFlush){
  if(!skipFlush)flushPending();
  // Reset late filter when a status filter is applied — they conflict
  const _stVal=(document.getElementById('prepStF')||{}).value||'';
  if(_stVal&&_lateFilterActive){_lateFilterActive=false;const lb=document.getElementById('showLateBtn');if(lb){lb.textContent='⏱ Late';lb.style.background='rgba(251,146,60,.15)';lb.style.borderColor='rgba(251,146,60,.4)';}}  
  const wrap=document.querySelector('#page-prep .tbl-wrap');
  const scrollTop=wrap?wrap.scrollTop:0;
  const q=document.getElementById('prepSrch').value.toLowerCase();
  const st=document.getElementById('prepStF').value;
  const _acctF=(document.getElementById('prepAcctF')||{}).value||'';
  // _showArchived ON = show ONLY archived rows; OFF = show only active rows.
  // Rows cleared as "sorted outside the app" are excluded from BOTH modes.
  const baseRows=(_showArchived?rows.filter(r=>r.archived):rows.filter(r=>!r.archived)).filter(r=>!_offPrepSheet(r));
  if(!q&&!st&&!_acctF&&!_issuesFilterActive&&!_lateFilterActive&&!_readyFilterActive&&!_amzFilterActive&&!_ssFilterActive){renderPrepRows(baseRows);}
  else{
    const filtered=baseRows.filter(r=>{
      const rid=r.uuid||String(r.id);
      if(_acctF&&String(r.acct||'').trim()!==_acctF)return false;
      if(_readyFilterActive&&acHold(r)!==null)return false;
      if(_amzFilterActive&&!_isAmzDel(r))return false;
    if(_ssFilterActive&&r.subSave!=='Yes')return false;
      if(_ssFilterActive&&r.subSave!=='Yes')return false;
      if(_issuesFilterActive){
        const hasIssue=claims.some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id)&&cl.cst!=='Resolved');
        if(!hasIssue)return false;
      }
      if(_lateFilterActive&&!_prepRowLate(r))return false;   /* one rule, shared with the dashboard */
      if(_lateFilterActive&&!_prepRowLate(r))return false;   /* one rule, shared with the dashboard */
      if(st){
        const hasIssueFlag=claims.some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id)&&cl.cst!=='Resolved'&&cl.cst!=='Closed');
        const matchesStatus=r.status===st;
        const matchesIssueFilter=st==='Issue'&&hasIssueFlag;
        if(!matchesStatus&&!matchesIssueFilter)return false;
      }
      if(q){
        if(!r._srch)r._srch=(r.sku+'|'+r.asin+'|'+(r.ean||'')+'|'+r.prod+'|'+r.oid+'|'+r.sup+'|'+(r.acct||'')+'|'+r.date+'|'+(r.notes||'')+'|'+(r.vaNote||'')+'|'+(r.transitAction||'')).toLowerCase();
        if(!r._srch.includes(q))return false;
      }
      return true;
    });
    renderPrepRows(filtered);
  }
  if(wrap)wrap.scrollTop=scrollTop;
}

/* ── PREP ACTIVITY BAR — factual "added to the system" counts + still-in-transit ──
   Answers "how much have we logged, and when." Straight counts off each row's
   created date (createdISO, a reliable YYYY-MM-DD). No arrival guessing, no
   "overdue" judgement. Underneath: a plain count of how much is still In-Transit. */
function _prepStartOfWeek(now){ // Monday as week start
  const d=new Date(now); const day=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return d;
}
function renderActivityWidget(){
  const el=document.getElementById('dashActivity'); if(!el)return;
  const active=rows.filter(r=>!r.archived);
  const now=new Date();
  const todayStr=todayISO();
  const y=new Date(now); y.setDate(y.getDate()-1);
  const yStr=`${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
  const weekStart=_prepStartOfWeek(now);
  const monStart=new Date(now.getFullYear(),now.getMonth(),1);
  const units=r=>parseInt(r.exp)||0;
  const cog=r=>parseSKU(r.sku).cogs*(units(r));
  const inRange=(iso,from)=>{ if(!iso)return false; const d=new Date(iso+'T00:00:00'); return d>=from; };
  // INVARIANT (per card): inTransit + arrived === added (units & £).
  const stillTransit=r=>r.status==='In-Transit'||r.status==='Not Arrived';
  const B=()=>({u:0,cogv:0,lines:0,asins:new Set(),itU:0,itV:0,arrU:0,arrV:0});
  const bT=B(),bY=B(),bW=B(),bM=B();
  const tally=(b,r)=>{const u=units(r),v=cog(r);b.u+=u;b.cogv+=v;b.lines++;if(r.asin)b.asins.add(r.asin);
    if(stillTransit(r)){b.itU+=u;b.itV+=v;}else{b.arrU+=u;b.arrV+=v;}};
  active.forEach(r=>{const iso=r.createdISO||'';
    if(iso===todayStr)tally(bT,r);
    if(iso===yStr)tally(bY,r);
    if(inRange(iso,weekStart))tally(bW,r);
    if(inRange(iso,monStart))tally(bM,r);
  });
  const anyDated=active.some(r=>r.createdISO);
  if(!anyDated){el.innerHTML='';return;}
  const cell=(lab,b)=>`<div class="pa-cell" title="${lab} — added ${b.u} units · ${b.lines} SKU lines · ${b.asins.size} ASINs · ${fmtGBP2(b.cogv)} COG&#10;In transit: ${b.itU} units · ${fmtGBP2(b.itV)}&#10;Arrived: ${b.arrU} units · ${fmtGBP2(b.arrV)}">
     <div class="pa-lab">${lab}</div>
     <div class="pa-u">${b.u}<span class="pa-un">units</span></div>
     <div class="pa-meta">${b.lines} lines · ${b.asins.size} ASINs · ${fmtGBP2(b.cogv)}</div>
     <div class="pa-split">${b.u?`<span class="pa-it">${b.itU} in transit</span> · <span class="pa-arr">${b.arrU} arrived</span>`:'<span class="pa-none">nothing added</span>'}</div>
   </div>`;
  el.innerHTML=`<div class="pa-bar">
     <div class="pa-title">Added to prep portal</div>
     <div class="pa-cells">
       ${cell('Today',bT)}${cell('Yesterday',bY)}${cell('This week',bW)}${cell('This month',bM)}
     </div>
   </div>`;
}
/* ── RENDER GATING ─────────────────────────────────────────────────────────────
   The battery complaint, at its root. Every realtime event rebuilt the prep
   table AND the dashboard — ~77k DOM nodes and most of a second of layout — on
   every open machine, whether the tab was visible or not and whether the page
   being rebuilt was even on screen. Three people working meant every laptop
   doing near-continuous layout for screens nobody was looking at.
   Nothing is removed: a skipped paint sets a dirty flag, and the flag is
   flushed the moment the page or tab is actually looked at (goPage below, and
   the visibilitychange listener). Same screens, same data — just no painting
   of invisible things. */
let _dirtyR={prep:false,dash:false,admin:false,jack:false};
let _ssRanWhileHidden=false;
function _pageActive(id){const p=document.getElementById(id);return !!(p&&p.classList.contains('active'));}
/* One repaint per burst of realtime traffic instead of one per event. 250ms is
   invisible to a human and collapses a multi-row save into a single rebuild. */
let _rtRepaintT=null;
/* A repaint that lands between a finger going down and coming up destroys the
   button mid-click — no click event is ever generated, the dead-button class
   that killed the week arrows. Rather than converting every one of the prep
   sheet's handlers, the flush itself now waits for any press in progress to
   finish (plus a beat for the click to be delivered) before swapping the DOM
   out from under it. Protects every control in the app at once. */
let _ptrHeld=false,_rtOwed=false,_rtWaitT=null;
document.addEventListener('pointerdown',()=>{_ptrHeld=true;},true);
const _ptrFree=()=>{_ptrHeld=false;
  if(_rtOwed){_rtOwed=false;setTimeout(_rtFlush,80);}};
document.addEventListener('pointerup',_ptrFree,true);
document.addEventListener('pointercancel',_ptrFree,true);
/* A pointerup can be lost — released outside the window, a drag that ends
   off-screen — and a stuck flag would hold every repaint until the next click.
   Losing focus counts as letting go. */
window.addEventListener('blur',_ptrFree);
/* NOTHING repaints while a popup is open. Deferring the flush to just after the
   press turned "repaint during your click" into "repaint 80ms after it" — which
   is exactly when a popup has finished opening, so the rebuild wiped it and the
   button looked like it needed pressing twice. A rebuild underneath an open
   dialog was never right anyway: it is what closed a half-filled close-off form
   when somebody else happened to save a row. */
function _modalOpen(){
  /* getClientRects(), NOT getComputedStyle. A computed `display` is the
     element's OWN value and knows nothing about a hidden ancestor, so every
     .mod box sitting inside a closed .overlay still reports display:block —
     which read as "a popup is open" permanently and stopped the app repainting
     at all. Client rects are real on-screen geometry: a closed dialog has none.
     Only the overlay containers are checked; the inner boxes are theirs. */
  const els=document.querySelectorAll('.overlay');
  for(const el of els){if(el.getClientRects().length)return true;}
  return false;
}
function _rtFlush(){
  if(_ptrHeld||_modalOpen()){
    /* keep the debt and look again shortly — it flushes the moment the dialog
       is closed, without needing every close path to remember to tell us */
    _rtOwed=true;
    clearTimeout(_rtWaitT);_rtWaitT=setTimeout(_rtFlush,500);
    return;
  }
  clearTimeout(_rtWaitT);_rtOwed=false;
  /* If the user is actively editing a cell in the prep table, rebuilding it
     now would destroy their input mid-type. Defer the prep re-render until
     they click away; dashboard and badges still update. */
  const ae=document.activeElement;
  const editingPrep=ae&&ae.closest&&(ae.closest('#page-prep')||ae.closest('#page-admin'))&&(ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA');
  if(editingPrep){
    _pendingPrepRender=true;
    ae.addEventListener('blur',()=>{if(_pendingPrepRender){_pendingPrepRender=false;renderPrep();}},{once:true});
  }else renderPrep();
  renderDashboard();updateCB();
  if(_pageActive('page-admin'))renderAdmin();
  /* Jack's queue and its sidebar badge are live too: Sarah pressing Send to
     Jack should light up his screen without him touching anything. renderJack
     gates itself when unseen; the badge is cheap and always worth updating. */
  renderJackAuto();
  try{paintJackBadge();}catch(e){}
}
function rtRepaint(){
  clearTimeout(_rtRepaintT);
  _rtRepaintT=setTimeout(_rtFlush,250);
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)return;
  /* the tab is being looked at again — pay the debts, once */
  if(_dirtyR.prep&&_pageActive('page-prep'))renderPrep();
  if(_dirtyR.dash&&_pageActive('page-dashboard'))renderDashboard();
  if(_dirtyR.admin&&_pageActive('page-admin'))renderAdmin();
  if(_dirtyR.jack&&_pageActive('page-jack'))renderJack();
  if(_ssRanWhileHidden){_ssRanWhileHidden=false;
    try{if(_ssConfig.enabled&&!_ssBusy)runSheetSync(false);}catch(e){}}
});
function renderPrep(){
  try{healSentBelowReceived('prep sheet');}catch(e){}
  /* invisible → not painted, only owed */
  if(document.hidden||!_pageActive('page-prep')){_dirtyR.prep=true;return;}
  /* restored bulk ticks (they survive a hard refresh now) need their counter
     bar woken too, not just the checkboxes */
  if(_selectedIds.size)setTimeout(()=>{try{updateBulkUI();}catch(e){}},0);
  _dirtyR.prep=false;
  sortRows();
  renderStats();
  updateArchivedBtn();
  // Preserve scroll position
  const wrap=document.querySelector('#page-prep .tbl-wrap');
  const scrollTop=wrap?wrap.scrollTop:0;
  // Re-apply active filter instead of showing all rows
  const q=(document.getElementById('prepSrch')||{}).value?.toLowerCase()||'';
  const st=(document.getElementById('prepStF')||{}).value||'';
  const _acctF=(document.getElementById('prepAcctF')||{}).value||'';
  // Archived rows are hidden from the active prep sheet (but kept in `rows` so
  // the shipments page and stats still see them). _showArchived flips to an
  // archived-ONLY view rather than mixing archived in with active rows.
  const baseRows=(_showArchived?rows.filter(r=>r.archived):rows.filter(r=>!r.archived)).filter(r=>!_offPrepSheet(r));
  if(q||st||_acctF||_issuesFilterActive||_lateFilterActive||_readyFilterActive||_amzFilterActive||_ssFilterActive){
    const filtered=baseRows.filter(r=>{
      const rid=r.uuid||String(r.id);
      if(_acctF&&String(r.acct||'').trim()!==_acctF)return false;
      if(_readyFilterActive&&acHold(r)!==null)return false;
      if(_amzFilterActive&&!_isAmzDel(r))return false;
    if(_ssFilterActive&&r.subSave!=='Yes')return false;
      if(_ssFilterActive&&r.subSave!=='Yes')return false;
      if(_issuesFilterActive){
        const hasIssue=claims.some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id)&&cl.cst!=='Resolved');
        if(!hasIssue)return false;
      }
      if(_lateFilterActive&&!_prepRowLate(r))return false;   /* one rule, shared with the dashboard */
      if(_lateFilterActive&&!_prepRowLate(r))return false;   /* one rule, shared with the dashboard */
      if(st){
        const hasIssueFlag=claims.some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id)&&cl.cst!=='Resolved'&&cl.cst!=='Closed');
        const matchesStatus=r.status===st;
        const matchesIssueFilter=st==='Issue'&&hasIssueFlag;
        if(!matchesStatus&&!matchesIssueFilter)return false;
      }
      if(q){
        if(!r._srch)r._srch=(r.sku+'|'+r.asin+'|'+(r.ean||'')+'|'+r.prod+'|'+r.oid+'|'+r.sup+'|'+r.date).toLowerCase();
        if(!r._srch.includes(q))return false;
      }
      return true;
    });
    renderPrepRows(filtered);
  }else{
    renderPrepRows(baseRows);
  }
  // Restore scroll position
  if(wrap)wrap.scrollTop=scrollTop;
}

// ── ADD ROW ───────────────────────────────────────────────────────────────────
function autoSAS(){
  const a=document.getElementById('f-asin').value.trim();
  if(a)document.getElementById('f-sas').value=`https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${a}`;
}
function tbq(){document.getElementById('bqG').style.display=document.getElementById('f-bun').value==='Yes'?'block':'none';}
function openAdd(){
  editId=null;document.getElementById('addTitle').textContent='Add New Row';
  clearForm();document.getElementById('f-date').value=new Date().toISOString().split('T')[0];
  const db=document.getElementById('deleteEditBtn');if(db)db.style.display='none';
  om('addModal');
}
function openEdit(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));if(!r)return;
  editId=id;document.getElementById('addTitle').textContent='Edit Row';
  const db=document.getElementById('deleteEditBtn');if(db)db.style.display='';
  // "Remove & exclude from sync" only for rows with NO shipment and NOT marked sent
  // — so it can never nuke a real, shipment-backed send.
  const exb=document.getElementById('excludeSyncBtn');
  if(exb){const hasShip=r.shipId||(r.allShipIds||[]).length||(r.shipSegments||[]).length;const isSent=r.sent==='Yes'||r.status==='Sent to Amazon';exb.style.display=(!hasShip&&!isSent)?'':'none';}
  clearForm();
  // populate date
  if(r.date){const[dd,mm]=r.date.split('/');document.getElementById('f-date').value=`2026-${(mm||'01').padStart(2,'0')}-${(dd||'01').padStart(2,'0')}`;}  
  document.getElementById('f-oid').value=r.oid||'';
  document.getElementById('f-sup').value=r.sup||'';
  const acctEl=document.getElementById('f-acct');if(acctEl)acctEl.value=r.acct||'';
  document.getElementById('f-prod').value=r.prod||'';
  document.getElementById('f-asin').value=r.asin||'';
  document.getElementById('f-ean').value=r.ean||'';
  document.getElementById('f-dg').value=r.dg||'';
  document.getElementById('f-sku').value=r.sku||'';
  const vatEl=document.getElementById('f-vat');if(vatEl)vatEl.value=r.vat||'';
  const vatDisp=document.getElementById('f-vat-display');
  if(vatDisp)vatDisp.textContent=({'0':'0% VAT','5':'5% VAT','20':'20% VAT'})[r.vat]||'— not set (fills from purchase sheet column H)';
  document.getElementById('f-sas').value=r.sas||'';
  document.getElementById('f-exp').value=r.exp||'';
  document.getElementById('f-aqty').value=r.aqty||'';
  document.getElementById('f-bun').value=r.bun||'No';
  document.getElementById('f-bqty').value=r.bqty||'';
  const ssEl=document.getElementById('f-subSave');if(ssEl)ssEl.value=r.subSave||'No';
  document.getElementById('f-status').value=r.status||'In-Transit';
  document.getElementById('f-rcvd').value=r.rcvd||'';
  document.getElementById('f-issueType').value=r.issueType||'';
  document.getElementById('f-issueQty').value=r.issueQty||'';
  document.getElementById('f-ship').value=r.ship||'';
  document.getElementById('f-shipId').value=r.shipId||'';
  document.getElementById('f-sent').value=r.sent||'No';
  document.getElementById('f-reimb').value=r.reimb||'No';
  document.getElementById('f-pri').value=r.pri||'No';
  document.getElementById('f-notes').value=r.notes||'';
  const vaN=document.getElementById('f-vaNotes');if(vaN)vaN.value=r.vaNote||'';
  /* Jack, 7 Sep: "who is writing these?" — Sarah, through this form: the stop
     on the Packing Notes cell never covered the edit form, so twelve order
     references landed in the warehouse column on 4 Sep. Same rule here. */
  {const pn=document.getElementById('f-notes');
   if(pn){const sar=/^sarah/i.test(String(window.currentUserName||'').trim());
     pn.readOnly=sar;pn.style.opacity=sar?'.55':'';
     pn.title=sar?'Packing Notes are Becki\u2019s \u2014 what to do with the box. What you found out goes in VA Notes below.':'';}}
  const exD=document.getElementById('f-expectedDelivery');if(exD)exD.value=r.expectedDelivery||'';
  const srEl=document.getElementById('f-sheetRow');if(srEl)srEl.value=r.sheetRow||'';
  const pS=document.getElementById('f-prepStatus');if(pS)pS.value=r.prepStatus||'Pending';
  tbq();
  om('addModal');
}
function clearForm(){
  ['f-oid','f-prod','f-asin','f-sku','f-sas','f-exp','f-aqty','f-bqty','f-rcvd','f-ship','f-shipId','f-issueQty','f-notes','f-vaNotes','f-expectedDelivery','f-sheetRow'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  document.getElementById('f-sup').value='';
  ['f-bun','f-sent','f-reimb','f-pri','f-subSave'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='No';});
  document.getElementById('f-status').value='In-Transit';
  document.getElementById('f-prepStatus').value='Pending';
  document.getElementById('f-issueType').value='';
  document.getElementById('f-dg').value='';
  const vatC=document.getElementById('f-vat');if(vatC)vatC.value='';
  const vatD=document.getElementById('f-vat-display');if(vatD)vatD.textContent='— not set (fills from purchase sheet column H)';
  tbq();
}
async function moveToActions(id){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));
  if(!r)return;
  const rowIssues=claims.filter(c=>c.prepRowId===id&&c.cst!=='Resolved');
  if(!rowIssues.length){
    toast('No open issues on this row to move','er');
    return;
  }
  showConfirm('Move to Actions?',
    `This will move "${r.sku}" to the Actions page and remove it from the active prep sheet. The VA will handle the issue there.`,
    async()=>{
      // Save each issue to Supabase first
      let allSaved=true;
      for(const cl of rowIssues){
        if(!cl.uuid){
          const res=await sb.from('actions').insert(claimToDb(cl)).select().single();
          if(res.error){
            console.error('Failed to save issue:',res.error);
            allSaved=false;
            toast('Failed to save issue to Actions: '+res.error.message,'er');
            break;
          }
          if(res.data){cl.uuid=res.data.id;cl.id=res.data.id;}
        }
      }
      if(!allSaved){
        toast('Could not move to Actions — check connection','er');
        return;
      }
      // Only archive the row after the issue is confirmed saved to Actions.
      // Soft-archive (not delete) so any shipment history on the row is kept.
      await archiveRow(r);
      renderPrep();
      renderClaims();
      renderShipments&&renderShipments();
      toast('✓ Moved to Actions');
      logAudit('Moved to Actions',r.sku);
    }
  );
}

function selectAllSent(){
  // Check all rows that are Sent to Amazon
  document.querySelectorAll('.row-cb').forEach(cb=>{
    const id=cb.dataset.id;
    const r=rows.find(x=>String(x.id)===String(id)||x.uuid===String(id));
    cb.checked=!!(r&&r.status==='Sent to Amazon');
  });
  updateBulkBar();
}

/* PostgREST filters travel in the URL, so a few hundred ids blow past the
   length limit and come back as a flat 400. Chunk every bulk id update. */
async function _chunkedUpdate(table,patch,ids,size){
  size=size||60;
  for(let i=0;i<ids.length;i+=size){
    const slice=ids.slice(i,i+size);
    const r=await sb.from(table).update(patch).in('id',slice);
    if(r.error)return r;
  }
  return{error:null};
}

/* ── AUTO-CLEAR FINISHED ROWS ──────────────────────────────────────────────
   A row that went to Amazon days ago, fully reconciled, with nothing
   outstanding, is just noise on the prep sheet. It gets archived — the same
   archive the bulk button has always used, so it stays on Shipments, in the
   audit log, and under "Show Archived". Nothing is deleted.

   Nothing is decided quietly. A row is held back for exactly one reason at a
   time, that reason is shown on the row, the sheet has a filter for what is
   going tonight, and every sweep leaves an undo and an audit entry.        */

const AC_DEF={on:true,hours:48,at:'20:00',lastRun:''};
let AC=Object.assign({},AC_DEF);
let _acLastBatch=[];            // for Undo
let _readyFilterActive=false;

/* Everything here is wall-clock UK, whatever the browser's own timezone is —
   a VA working abroad must not shift when a row clears. */
function ukWall(d){
  try{
    const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',
      month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
    const p={};f.formatToParts(d||new Date()).forEach(x=>{if(x.type!=='literal')p[x.type]=x.value;});
    const hh=p.hour==='24'?'00':p.hour;
    return new Date(`${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:00`);
  }catch(e){return d||new Date();}
}
const ukToday=()=>{const w=ukWall();return `${w.getFullYear()}-${String(w.getMonth()+1).padStart(2,'0')}-${String(w.getDate()).padStart(2,'0')}`;};

/* sent_date is the day it went; sent_at carries the time. Rows sent before
   sent_at existed have no time, so they are treated as late in the day — a
   row clears an hour late rather than a day early. */
function sentMoment(r){
  const day=String(r.sentDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const m=String(r.sentAt||'').match(/(\d{1,2}):(\d{2})/);
  const hh=m?String(m[1]).padStart(2,'0'):'23',mm=m?m[2]:'59';
  return new Date(`${day}T${hh}:${mm}:00`);
}
/* Weekends do not count. Bank holidays do — Jack, 20 Aug, asked directly. */
function workHoursSince(from,now){
  if(!from)return 0;
  const to=now||ukWall();
  let n=0,guard=0,cur=new Date(from.getTime());
  while(cur<to&&guard<24*400){
    const w=cur.getDay();
    if(w>=1&&w<=5)n++;
    cur=new Date(cur.getTime()+3600000);guard++;
  }
  return n;
}
const acOpenClaims=r=>{
  const rid=r.uuid||String(r.id);
  return (typeof claims!=='undefined'?claims:[])
    .some(cl=>(cl.prepRowId===rid||cl.prepRowId===r.id||cl.prepRowId===r.uuid)
              &&cl.cst!=='Resolved'&&cl.cst!=='Closed');
};

/* Null means this row can go. Anything else is the reason it cannot, written
   for the person reading the sheet, not for the log. */
function acHold(r){
  if(!r||r.archived)return 'already archived';
  if(r.status!=='Sent to Amazon')return r.status==='Part Sent'?'part sent':'not sent to Amazon yet';
  if(r.sent!=='Yes')return 'not marked as sent';
  /* S&S used to be a permanent exclusion here. That was me reading "anything
     that is part sent or has S&S can't be sent" too literally — that list was
     about what makes a row UNFINISHED, and Subscribe & Save says nothing about
     whether a row that has already gone to Amazon and reconciled is done.
     S&S matters for arrival (it is exempt from overdue chasing, because those
     deliveries come on a schedule) — not for clearing. A finished row is a
     finished row, so it now clears on exactly the same rules as every other. */
  if(r.issueType&&r.issueType!=='—')return `has an issue: ${r.issueType}`;
  if(acOpenClaims(r))return 'has an open claim';
  if(r.resolution&&['proposed','asked'].includes(r.resolution.state))return 'waiting on Jack';
  if(typeof _ukQuery==='function'&&_ukQuery(r))return 'question open — is more on the way?';
  if(r.reimb==='Yes')return 'reimbursement being chased';
  const hasShip=String(r.shipId||'').trim()||((r.allShipIds||[]).length>0);
  if(!hasShip)return 'waiting on shipment ID';
  const exp=_effExp(r),rcv=parseInt(r.rcvd)||0,shp=parseInt(r.ship)||0;
  if(!exp||!shp)return 'quantities not filled in';
  if(exp!==rcv||rcv!==shp)return `numbers do not match — ${exp} expected, ${rcv} received, ${shp} shipped`;
  const m=sentMoment(r);
  if(!m)return 'no sent date recorded';
  const need=parseInt(AC.hours)||48;
  const done=workHoursSince(m);
  if(done<need){
    const left=need-done;
    return `${left} working hour${left===1?'':'s'} to go`;
  }
  return null;
}
const acReady=()=>rows.filter(r=>!r.archived&&acHold(r)===null);
/* only worth showing a reason on rows that are otherwise finished — every
   In-Transit row saying "not sent to Amazon yet" would be noise */
function acNearly(r){
  if(!r||r.archived||r.status!=='Sent to Amazon')return null;
  const h=acHold(r);
  return h==='already archived'?null:h;
}

/* ── settings, shared so one machine cannot disagree with another ── */
async function acLoad(){
  try{
    const r=await sb.from('app_settings').select('value').eq('key','auto_clear').maybeSingle();
    if(r&&r.data&&r.data.value){
      const v=JSON.parse(r.data.value);
      if(v&&typeof v==='object')AC=Object.assign({},AC_DEF,v);
    }
  }catch(e){console.warn('[autoclear] load',e);}
}
async function acSave(){
  try{
    await sb.from('app_settings').upsert({key:'auto_clear',value:JSON.stringify(AC)},{onConflict:'key'});
  }catch(e){console.warn('[autoclear] save',e);}
}
function acSet(k,v){
  AC[k]=v;acSave();
  try{acPaintCard();acPaintChip();}catch(e){}
  try{renderPrep&&renderPrep();}catch(e){}
}

/* ── the sweep ── */
/* Once a day, at 8pm UK — or the first moment after 8pm that somebody has the
   app open, because at 8pm on a Sunday nobody does. lastRun is stored with the
   setting, not per browser, so three open tabs still means one sweep. */
function acDue(){
  if(!AC.on)return false;
  if(AC.lastRun===ukToday())return false;
  const w=ukWall();
  const[hh,mm]=String(AC.at||'20:00').split(':').map(Number);
  /* `hh||20` would read midnight as eight in the evening — zero is falsy */
  const H=Number.isFinite(hh)?hh:20,M=Number.isFinite(mm)?mm:0;
  return (w.getHours()*60+w.getMinutes())>=(H*60+M);
}
async function acSweep(manual){
  if(!manual&&!acDue())return;
  const today=ukToday();
  /* claim the day BEFORE doing the work, so two tabs cannot both sweep */
  if(!manual){
    AC.lastRun=today;
    await acSave();
  }
  /* a row someone is in the middle of is left where it is and picked up
     tomorrow — rows vanishing under the cursor is how people stop trusting it */
  const busy=new Set();
  try{
    const ae=document.activeElement;
    const tr=ae&&ae.closest?ae.closest('tr[id^="row-"]'):null;
    if(tr)busy.add(tr.id.replace('row-',''));
    (typeof getSelectedRows==='function'?getSelectedRows():[]).forEach(id=>busy.add(String(id)));
  }catch(e){}
  const go=acReady().filter(r=>!busy.has(String(r.id))&&!busy.has(String(r.uuid)));
  if(!go.length){if(manual)toast('Nothing is ready to clear yet');return;}
  const ids=[];
  go.forEach(r=>{r.archived=true;if(r.uuid)ids.push(r.uuid);});
  _acLastBatch=go.map(r=>r.uuid||String(r.id));
  try{renderPrep();}catch(e){}
  if(ids.length){
    const res=await _chunkedUpdate('prep_rows',{archived:true},ids);
    if(res&&res.error){
      go.forEach(r=>{r.archived=false;});_acLastBatch=[];
      try{renderPrep();}catch(e){}
      toast('Auto-clear failed: '+res.error.message,'er');return;
    }
  }
  logAudit('Rows auto-cleared',
    `${go.length} finished row${go.length===1?'':'s'} archived after ${AC.hours} working hours — `
    +go.slice(0,8).map(r=>r.sku||r.asin||r.id).join(', ')+(go.length>8?` +${go.length-8} more`:''));
  acBar(go.length);
}
/* what happened, and the way back */
function acBar(n){
  const host=document.getElementById('acBar');if(!host)return;
  host.innerHTML=`<span style="font-size:13px;font-weight:800;color:var(--text);">${n} finished row${n===1?'':'s'} cleared</span>
    <span style="font-size:12.5px;color:var(--text2);">archived after ${AC.hours} working hours — still on Shipments and under Show Archived</span>
    <button onclick="toggleArchivedView()" style="padding:3px 9px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:5px;font-size:11.5px;font-weight:700;cursor:pointer;">Show me</button>
    <button onclick="acUndo()" style="padding:3px 9px;background:var(--btn-red-bg);border:1px solid var(--btn-red-border);color:var(--btn-red-text);border-radius:5px;font-size:11.5px;font-weight:700;cursor:pointer;">Undo</button>
    <button onclick="document.getElementById('acBar').style.display='none'" title="Dismiss" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;margin-left:auto;">&#10005;</button>`;
  host.style.display='flex';
}
async function acUndo(){
  if(!_acLastBatch.length){toast('Nothing to undo','er');return;}
  const back=rows.filter(r=>_acLastBatch.includes(r.uuid||String(r.id)));
  back.forEach(r=>{r.archived=false;});
  const ids=back.map(r=>r.uuid).filter(Boolean);
  if(ids.length){
    const res=await _chunkedUpdate('prep_rows',{archived:false},ids);
    if(res&&res.error){toast('Undo failed: '+res.error.message,'er');return;}
  }
  logAudit('Auto-clear undone',`${back.length} row${back.length===1?'':'s'} put back on the prep sheet`);
  _acLastBatch=[];
  const host=document.getElementById('acBar');if(host)host.style.display='none';
  renderPrep();
  toast(`✓ ${back.length} row${back.length===1?'':'s'} back on the sheet`);
}

/* the filter chip — so "why is that still there" has an answer on screen */
function toggleReadyFilter(){
  _readyFilterActive=!_readyFilterActive;
  if(_readyFilterActive){
    if(_issuesFilterActive)toggleIssuesFilter();
    if(_lateFilterActive)toggleLateFilter();
  if(_ssFilterActive)toggleSubSaveFilter();
    _readyFilterActive=true;
  }
  acPaintChip();
  renderPrep();
}
function acPaintChip(){
  const b=document.getElementById('showReadyBtn');if(!b)return;
  const n=acReady().length;
  b.textContent=_readyFilterActive?`Ready to clear ${n} ✓`:`Ready to clear ${n}`;
  b.style.background=_readyFilterActive?'rgba(74,222,128,.32)':'rgba(74,222,128,.13)';
  b.style.borderColor=_readyFilterActive?'#4ade80':'rgba(74,222,128,.4)';
  b.title=AC.on
    ?`These go automatically at ${AC.at} UK, once they have had ${AC.hours} working hours`
    :'Auto-clear is switched off in Settings — nothing goes on its own';
}

/* checked when the app opens, then hourly; the once-a-day guard does the rest */
/* The off switch. If this misbehaves at seven on a Monday morning somebody
   needs to stop it without waiting for a new build. */
function acPaintCard(){
  const c=document.getElementById('acCard');if(!c)return;
  const n=(typeof rows!=='undefined')?acReady().length:0;
  c.innerHTML=`
    <div style="font-size:12px;font-weight:800;color:var(--text2);margin-bottom:4px;">Clear finished rows off the prep sheet</div>
    <div style="font-size:11.5px;color:var(--text3);line-height:1.55;margin-bottom:12px;">
      A row is archived once it has gone to Amazon, the numbers all agree, it has a shipment ID and
      nothing is outstanding on it. Weekends do not count toward the wait. S&amp;S rows never clear, and
      neither does anything with an issue. Archived is not deleted — the rows stay on Shipments and
      under Show Archived.</div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;margin-bottom:12px;">
      <input type="checkbox" ${AC.on?'checked':''} onchange="acSet('on',this.checked)" style="cursor:pointer;">
      <b>Clear them automatically</b></label>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:end;">
      <div><div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Wait this many working hours</div>
        <input class="fi-in" type="number" min="1" max="500" value="${AC.hours}" style="width:90px;font-size:12px;"
          onchange="acSet('hours',Math.max(1,parseInt(this.value)||48))"></div>
      <div><div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Run at (UK time)</div>
        <input class="fi-in" type="time" value="${AC.at}" style="width:110px;font-size:12px;"
          onchange="acSet('at',this.value||'20:00')"></div>
      <button onclick="acSweep(true)" style="padding:6px 12px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:5px;font-size:12px;font-weight:700;cursor:pointer;">Run it now</button>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:11px;">
      ${n} row${n===1?'':'s'} ready right now${AC.lastRun?` · last run ${esc(AC.lastRun)}`:' · has not run yet'}.
      It runs once a day, at the first moment after ${esc(AC.at)} that somebody has the app open.</div>`;
}
function acStart(){
  acLoad().then(()=>{
    try{acPaintChip();acPaintCard();}catch(e){}
    setTimeout(()=>{acSweep().catch(e=>console.warn('[autoclear]',e));},20000);
    setInterval(()=>{acSweep().catch(e=>console.warn('[autoclear]',e));},3600000);
  });
}

/* Clear a batch of rows that were sorted before the app existed. Archives them
   — off Sarah's Admin (it skips archived rows) and off the active Prep Sheet —
   with a real resolution attached so the history says what happened. Nothing is
   deleted, the rows stay under Show Archived, and Undo puts them straight back. */
const _isJack=()=>/^jack/i.test(String(window.currentUserName||'').trim());
/* rows cleared as "sorted outside the app" — off the Prep Sheet for good */
/* Rows the Prep Sheet should never show: cleared pre-app history, and gated
   stock Jack has taken onto his own plate (nobody else can act on it, so it
   only crowds the list). */
const _isClearedOld=r=>!!(r&&r.archived&&r.resolution&&r.resolution.what==='cleared-old');
/* Jack, 4 Sep: "why is this still on the Prep Sheet if I took it off both?"
   Because `r.jackGated` was invented in memory and there is NO `jack_gated`
   COLUMN on prep_rows — saveRow dropped it without a word, so the next load
   brought the row straight back. Same silent-failure class as the job bug.
   Nothing new is stored now: the CLAIM already records the truth (gated, owned
   by Jack, still open), so the Prep Sheet asks it. That survives any reload,
   resync or another machine, and undoing on Jack's page puts the row back on
   its own. Rebuilt once per render — not per row — so 1,300 rows stay cheap. */
let _gatedOffCache={ids:null,at:0};
function _gatedOffRowIds(){
  const now=Date.now();
  if(_gatedOffCache.ids&&now-_gatedOffCache.at<800)return _gatedOffCache.ids;
  const set=new Set();
  try{
    (typeof claims!=='undefined'?claims:[]).forEach(c=>{
      if(!c||c.archived)return;
      if((c.issT||'')!=='Gated')return;
      if((c.owner||'')!=='Jack'||c.sentToJack)return;   // hers, or waiting on him for her
      if(c.cst==='Resolved'||c.cst==='Closed')return;
      if(c.prepRowId)set.add(String(c.prepRowId));
    });
  }catch(e){}
  _gatedOffCache={ids:set,at:now};
  return set;
}
const _offPrepSheet=r=>{
  if(_isClearedOld(r))return true;
  if(!r)return false;
  const ids=_gatedOffRowIds();
  return ids.has(String(r.uuid||''))||ids.has(String(r.id||''));
};
/* Same job as the bulk button, for one row, from Sarah's Admin where he is
   actually looking at them. TEMPORARY — goes when the clear-out is done. */
/* Jack, 3 Sep: "no clear on this either" — the button only existed on transit
   rows, but plenty of his old ones are claims and Lavarion check-ins. Each
   closes through its own subsystem, so Clear does the right thing per type
   rather than one blunt archive. */
/* `D` belongs to the Lavarion closure and is NOT reachable from admin scope —
   reading it here threw. Kept in the same app_settings store as ROW_SEEN. */
let LAV_CLEARED={};
const lavCleared=()=>LAV_CLEARED;
async function clearOldClaim(id){
  if(!_isJack()){toast('Jack only','er');return;}
  const c=claims.find(x=>String(x.id)===String(id));if(!c)return;
  showConfirm('Clear this off the list?',
    `${c.prod||c.sku||'This claim'}\n\nClosed as sorted outside the app and archived. It leaves Sarah's Admin and the Claims list.\n\nNothing is deleted — the whole record is kept, and Undo puts it back.`,
    async()=>{
      const was={cst:c.cst,archived:c.archived,resolvedAt:c.resolvedAt};
      if(!c.log)c.log=[];
      c.log.push({t:getNowUK(),msg:'Cleared — sorted outside the app ('+_who()+')'});
      c.cst='Resolved';c.resolvedAt=todayISO();c.archived=true;
      try{await saveClaim(c);}catch(e){console.warn('[clearOld claim]',e);}
      try{renderAdmin();renderClaims();}catch(e){}
      try{logAudit('Old claim cleared',`${c.sku||c.sup||''} — sorted outside the app`);}catch(e){}
      toastUndo('Claim cleared',async()=>{
        c.cst=was.cst;c.archived=was.archived;c.resolvedAt=was.resolvedAt;
        try{await saveClaim(c);}catch(e){}
        try{renderAdmin();renderClaims();}catch(e){}
        toast('Put back','ok');});
    });
}
async function clearOldLav(key){
  if(!_isJack()){toast('Jack only','er');return;}
  /* a Lavarion shortage is recalculated from the check-ins every time, so
     "quiet" cannot be stored on it — the cleared keys are remembered instead */
  showConfirm('Clear this off the list?',
    `This supplier shortage is marked as sorted outside the app and leaves your page and Sarah's.\n\nThe check-in figures behind it are untouched — nothing is deleted, and Undo puts it back.`,
    async()=>{
      LAV_CLEARED[String(key)]={at:new Date().toISOString(),by:_who()};
      try{await _putSetting('lav_cleared',LAV_CLEARED);}catch(e){}
      try{renderAdmin();renderJack&&renderJack();}catch(e){}
      try{logAudit('Old supplier shortage cleared',String(key));}catch(e){}
      toastUndo('Shortage cleared',async()=>{
        delete LAV_CLEARED[String(key)];
        try{await _putSetting('lav_cleared',LAV_CLEARED);}catch(e){}
        try{renderAdmin();renderJack&&renderJack();}catch(e){}
        toast('Put back','ok');});
    });
}
async function clearOldRow(rid){
  if(!_isJack()){toast('Jack only','er');return;}
  const r=rows.find(x=>String(x.uuid)===String(rid)||String(x.id)===String(rid));
  if(!r){toast('Row not found','er');return;}
  showConfirm('Clear this off both sheets?',
    `${r.prod||r.sku||'This row'}\n\nMarked "Sorted outside the app" and archived. It leaves this page and the Prep Sheet, and a sync will not bring it back.\n\nNothing is deleted — it stays under Show Archived, and Undo puts it back.`,
    async()=>{
      const stamp=new Date().toISOString();
      const was={archived:r.archived,resolution:r.resolution,transitAction:r.transitAction};
      r.resolution={state:'approved',kind:'ops',what:'cleared-old',
        note:'Cleared from Admin — dealt with before PrepHub tracked it',
        by:_who(),at:stamp,approvedAt:stamp,filed:true};
      r.archived=true;r.transitAction='';
      try{renderAdmin();}catch(e){}try{renderPrep();}catch(e){}
      try{await saveRow(r);}catch(e){console.warn('[clearOld]',e);}
      try{logAudit('Old row cleared',`${r.sku||r.prod||''} — sorted outside the app`);}catch(e){}
      toastUndo(`${r.prod||r.sku||'Row'} cleared`,async()=>{
        r.archived=was.archived;r.resolution=was.resolution;r.transitAction=was.transitAction;
        try{renderAdmin();}catch(e){}try{renderPrep();}catch(e){}
        try{await saveRow(r);}catch(e){}
        toast('Put back','ok');
      });
    });
}
async function doBulkClearOld(){
  if(!/^jack/i.test(String(window.currentUserName||'').trim())){toast('Jack only','er');return;}
  const selIds=getSelectedRows();
  if(!selIds.length){toast('Tick the rows you want cleared first','er');return;}
  const selRows=selIds.map(id=>rows.find(x=>String(x.id)===String(id)||x.uuid===String(id))).filter(Boolean);
  if(!selRows.length){toast('No rows found','er');return;}
  const already=selRows.filter(r=>r.archived).length;
  const todo=selRows.filter(r=>!r.archived);
  if(!todo.length){toast('Those are already archived','er');return;}
  showConfirm('Clear these off both sheets?',
    `${todo.length} row${todo.length===1?'':'s'} will be marked "Sorted outside the app" and archived.${already?' ('+already+' already archived, skipped.)':''}\n\n`
    +'They come off Sarah\u2019s Admin and off the active Prep Sheet, and a sheet sync will not bring them back.\n\n'
    +'Nothing is deleted \u2014 they stay under Show Archived with their full history, and Undo puts them back.',
    async()=>{
      const btn=document.querySelector('[onclick="doBulkClearOld()"]');
      if(btn){btn.disabled=true;btn.textContent='Clearing…';}
      setSyncStatus('syncing');
      const stamp=new Date().toISOString();
      const ids=[];
      todo.forEach(r=>{
        r.resolution={state:'approved',kind:'ops',what:'cleared-old',
          note:'Cleared in bulk — this was dealt with before PrepHub tracked it',
          by:_who(),at:stamp,approvedAt:stamp,filed:true};
        r.archived=true;
        r.transitAction='';
        if(r.uuid)ids.push(r.uuid);
      });
      clearBulkSelect();
      renderPrep();try{renderAdmin();}catch(e){}try{renderDashboard();}catch(e){}
      for(const r of todo){try{await saveRow(r);}catch(e){console.warn('[clearOld]',e);}}
      try{logAudit('Old rows cleared',`${todo.length} row${todo.length===1?'':'s'} archived as sorted outside the app`);}catch(e){}
      if(btn){btn.disabled=false;btn.textContent='Clear as sorted';}
      setSyncStatus('synced');
      toastUndo(`${todo.length} row${todo.length===1?'':'s'} cleared — under Show Archived if you need them`,async()=>{
        todo.forEach(r=>{r.archived=false;r.resolution=null;});
        renderPrep();try{renderAdmin();}catch(e){}
        for(const r of todo){try{await saveRow(r);}catch(e){}}
        toast('Put back','ok');
      });
    });
}
async function doBulkArchive(){
  const selIds=getSelectedRows(); // returns array of IDs
  if(!selIds.length){toast('No rows selected','er');return;}
  // Resolve IDs to actual row objects
  const selRows=selIds.map(id=>rows.find(x=>String(x.id)===String(id)||x.uuid===String(id))).filter(Boolean);
  const sentRows=selRows.filter(r=>r.status==='Sent to Amazon');
  const notSent=selRows.length-sentRows.length;
  if(!sentRows.length){toast('None of the selected rows are Sent to Amazon','er');return;}
  const msg=`Archive ${sentRows.length} Sent to Amazon row${sentRows.length!==1?'s':''}?${notSent>0?' ('+notSent+' non-sent rows skipped)':''}\n\nThis clears them off the prep sheet for good. They stay permanently on the Shipments page under their Shipment ID. (If you ever attached one by mistake, "Show Archived" can restore it — but you shouldn't normally need to.)`;
  showConfirm('Archive rows?',msg,async()=>{
    // Block UI during save so closing/refreshing mid-save can't corrupt data
    const archiveBtn=document.querySelector('[onclick="doBulkArchive()"]');
    if(archiveBtn){archiveBtn.disabled=true;archiveBtn.textContent='Archiving…';}
    setSyncStatus('syncing');
    // Mark archived + correct status locally first for instant UI update
    const ids=[];
    sentRows.forEach(r=>{
      r.archived=true;
      r.status='Sent to Amazon'; // ensure status is correct before saving
      if(r.uuid)ids.push(r.uuid);
    });
    clearBulkSelect();
    renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();
    // Persist in a single batched update — archived AND status together
    if(ids.length){
      let res=await _chunkedUpdate('prep_rows',{archived:true,status:'Sent to Amazon'},ids);
      if(res.error&&_missingColInErr(res.error)==='archived'){
        _missingCols.add('archived');
        if(!_missingColWarned){_missingColWarned=true;toast('Add the "archived" column — see Settings → Database','er');}
        res={error:null};
      }
      if(res.error){
        setSyncStatus('error');
        toast('Archive save failed: '+res.error.message,'er');
        if(archiveBtn){archiveBtn.disabled=false;archiveBtn.textContent='🗑 Archive Sent';}
        return;
      }
    }
    if(archiveBtn){archiveBtn.disabled=false;archiveBtn.textContent='🗑 Archive Sent';}
    setSyncStatus('synced');
    logAudit('Bulk archive',sentRows.length+' rows');
    toastUndo(`${sentRows.length} row${sentRows.length!==1?'s':''} archived`,async()=>{
      setSyncStatus('syncing');
      sentRows.forEach(r=>{r.archived=false;});
      renderPrep();renderShipments&&renderShipments();renderDashboard&&renderDashboard();
      const undoIds=sentRows.filter(r=>r.uuid).map(r=>r.uuid);
      if(undoIds.length&&!_missingCols.has('archived')){
        const res=await _chunkedUpdate('prep_rows',{archived:false},undoIds);
        if(res.error){setSyncStatus('error');toast('Undo save failed','er');return;}
      }
      setSyncStatus('synced');
      toast(`Archive undone — ${sentRows.length} row${sentRows.length!==1?'s':''} back`);
    });
  });
}

// Permanently remove a junk/demo row AND tombstone it so the sheet sync never
// re-adds it. Only callable for rows with no shipment and not marked sent (the
// button is hidden otherwise). Never touches the Shipments page.
function removeAndExcludeRow(){
  if(!editId){toast('No row selected','er');return;}
  const r=rows.find(x=>String(x.id)===String(editId)||x.uuid===String(editId));
  if(!r){toast('Row not found','er');return;}
  const hasShip=r.shipId||(r.allShipIds||[]).length||(r.shipSegments||[]).length;
  if(hasShip||r.sent==='Yes'||r.status==='Sent to Amazon'){toast('This row has a shipment or is marked sent — can’t exclude it here','er');return;}
  showConfirm('Remove & exclude from sync?',
    `Permanently remove "${r.sku}" and stop it syncing back from the sheet. The record is gone for good (you can re-allow it later in Settings → Excluded from Sync). This does not affect the Shipments page.`,
    async()=>{
      const syncId=r.sheetSyncId||((r.sku||'')+'|'+((r.oid||'').trim()||'nooid'));
      if(!_syncExcluded.some(x=>_exId(x)===syncId)){_syncExcluded.push({syncId,sku:r.sku||'',asin:r.asin||'',prod:r.prod||'',oid:(r.oid||'').trim()});await saveSyncExcluded();}
      try{if(r.uuid)await sb.from('prep_rows').delete().eq('id',r.uuid);}catch(e){console.warn('delete failed',e);}
      rows=rows.filter(x=>x!==r);
      editId=null;
      cm('addModal');
      renderPrep();
      if(typeof renderShipments==='function')renderShipments();
      if(typeof renderDashboard==='function')renderDashboard();
      toast('Row removed & excluded from sync');
      logAudit('Row removed & excluded from sync',`${r.sku} (${syncId})`);
    }
  );
}

function deleteEditRow(){
  if(!editId){toast('No row selected','er');return;}
  const r=rows.find(x=>String(x.id)===String(editId)||x.uuid===String(editId));
  if(!r){toast('Row not found','er');return;}
  showConfirm('Delete this row?',
    `Permanently delete "${r.sku}" from the prep sheet. This cannot be undone.`,
    async()=>{
      await deleteRow(r);
      rows=rows.filter(x=>!((r.uuid&&x.uuid===r.uuid)||String(x.id)===String(editId)||x.uuid===String(editId)));
      editId=null;
      cm('addModal');
      renderPrep();
      toast('Row deleted');
      logAudit('Row deleted',r.sku);
    }
  );
}

function saveRowForm(){
  const dv=document.getElementById('f-date').value;
  let df='';if(dv){const p=dv.split('-');df=`${p[2].padStart(2,'0')}/${p[1].padStart(2,'0')}`;}
  const sentVal=document.getElementById('f-sent').value;
  const existing=editId?rows.find(x=>String(x.id)===String(editId)||x.uuid===String(editId)):null;
  const r={
    /* Client-minted uuid on NEW rows: the insert carries it, so the realtime
       echo dedupes by uuid even while the insert response is still in flight.
       _minted routes saveRow straight to insert (no pointless 0-match update). */
    uuid:existing?.uuid||(window.crypto&&crypto.randomUUID?crypto.randomUUID():undefined),
    _minted:!existing&&!!(window.crypto&&crypto.randomUUID),
    id:existing?existing.id:++nid,date:df,
    oid:document.getElementById('f-oid').value,
    sup:document.getElementById('f-sup').value,
    acct:(document.getElementById('f-acct')||{}).value||'',
    prod:document.getElementById('f-prod').value,
    asin:document.getElementById('f-asin').value,
    ean:(document.getElementById('f-ean')||{}).value||'',
    dg:document.getElementById('f-dg').value,
    sku:document.getElementById('f-sku').value,
    vat:(document.getElementById('f-vat')||{}).value||'',
    sas:document.getElementById('f-sas').value||`https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${document.getElementById('f-asin').value}`,
    exp:parseInt(document.getElementById('f-exp').value)||0,
    aqty:parseInt(document.getElementById('f-aqty').value)||0,
    bun:document.getElementById('f-bun').value,
    bqty:document.getElementById('f-bqty').value,
    subSave:(document.getElementById('f-subSave')||{}).value||'No',
    status:document.getElementById('f-status').value,
    rcvd:parseInt(document.getElementById('f-rcvd').value)||0,
    issueType:document.getElementById('f-issueType').value,
    issueQty:parseInt(document.getElementById('f-issueQty').value)||0,
    ship:parseInt(document.getElementById('f-ship').value)||0,
    sent:sentVal,
    sentDate:sentVal==='Yes'?(existing?.sentDate||todayISO()):'',
    reimb:document.getElementById('f-reimb').value,
    pri:document.getElementById('f-pri').value,
    notes:document.getElementById('f-notes').value,
    vaNote:(document.getElementById('f-vaNotes')||{}).value||'',
    expectedDelivery:(document.getElementById('f-expectedDelivery')||{}).value||'',
    sheetRow:(document.getElementById('f-sheetRow')||{}).value||'',
    prepStatus:(document.getElementById('f-prepStatus')||{}).value||'Pending',
    shipId:document.getElementById('f-shipId').value,
    createdAt:existing?.createdAt||getNowUK(),
    createdISO:existing?.createdISO||todayISO(),
    importedFrom:existing?.importedFrom||'',
    shipType:existing?.shipType||'',
    // Carry the shipment-split data across the edit so it isn't wiped.
    shipSegments:existing?.shipSegments?existing.shipSegments.slice():[],
    allShipIds:existing?.allShipIds?existing.allShipIds.slice():[],
  };
  if(!r.sku||!r.sup){toast('SKU and Supplier required','er');return;}
  // Reconcile segments with any manual ship/shipId changes made in the form.
  (function reconcileSegs(){
    const segs=normaliseSegments(r);
    if(segs.length<=1){
      // Simple row: rebuild a single segment from the (possibly edited) fields.
      if((r.ship||0)>0&&r.shipId){
        r.shipSegments=[{shipId:r.shipId,units:r.ship,date:_segDateFor(r,r.shipId),type:r.shipType||'Standard'}];
        r.allShipIds=[r.shipId];
      }else{
        r.shipSegments=[];r.allShipIds=r.shipId?[r.shipId]:[];
      }
    }else{
      // Split row: keep the split as-is, but if the form's total ship differs,
      // trust the segments (source of truth) and snap ship back to their sum.
      r.ship=segs.reduce((a,s)=>a+(s.units||0),0);
      r.shipSegments=segs;
      r.allShipIds=[...new Set(segs.map(s=>s.shipId))];
      if(!segs.some(s=>s.shipId===r.shipId))r.shipId=segs[segs.length-1].shipId;
    }
  })();
  const wasEdit=!!editId;
  /* This form rebuilds the row from its own fields, so anything NOT on the
     form was being wiped by a save — the whole case file and its log, the
     triage answers, the cancelled quantity, the sheet link, even the archive
     flag (which quietly resurrected finished rows onto the live sheet).
     Correcting a supplier's spelling must not delete a fortnight of chasing. */
  if(existing)['resolution','qtyFix','cancelledQty','delivered','wrongSku','archived',
    'sheetSyncId','sheetRow','importedFrom','expectedDelivery','chaseSnoozeUntil',
    'transitAction','notesBy','notesAt','vaNote','vaNoteBy','vaNoteAt','allShipIds','shipSegments','sentAt']
    .forEach(k=>{if(!(k in r)&&existing[k]!==undefined)r[k]=existing[k];});
  if(existing&&String(r.vaNote||'').trim()!==String(existing.vaNote||'').trim()){
    r.vaNoteBy=String(r.vaNote||'').trim()?_who():'';r.vaNoteAt=String(r.vaNote||'').trim()?new Date().toISOString():'';}
  /* The form rebuilds received and shipped as two independent boxes with no
     relationship between them, so clearing one while the other held units
     saved the impossible state — and reconcileSegs then rebuilt the segments
     from the surviving figure, making it look deliberate. */
  if(existing&&_sentOut(existing)>0&&(parseInt(r.rcvd)||0)<_sentOut(existing)){
    _blockRcvdBelowSent(existing,r.rcvd);
    return;
  }
  if((parseInt(r.ship)||0)>(parseInt(r.rcvd)||0)){
    const _wasR=parseInt(r.rcvd)||0;
    r.rcvd=parseInt(r.ship)||0;
    try{logAudit('Received corrected to match what shipped',
      `${r.sku||''} — was ${_wasR}, now ${r.rcvd} (row edit)`);}catch(e){}
  }
  if(editId){const i=rows.findIndex(x=>(r.uuid&&x.uuid===r.uuid)||String(x.id)===String(editId)||x.uuid===String(editId));if(i>=0)rows[i]=r;else{toast('Row not found','er');return;}}
  else rows.push(r);
  editId=null;
  r._dirty=true;saveRow(r);
  if(!wasEdit)ensureRowEan(r);   // new row → auto-fetch its EAN (cached per ASIN)
  cm('addModal');renderPrep();toast(wasEdit?'Row updated ✓':'Row added ✓');
}
