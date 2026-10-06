function linkedSpecRowsForEstimateRow(row) {
  const ids=new Set(
    dataState.reconciliationLinks
      .filter(function(l){return l.estimate_row_id===row.id;})
      .map(function(l){return l.specification_row_id;})
  );
  return specJoinedRows().filter(function(sr){return ids.has(sr.id);});
}

function estimateQuantityPieces(row,linkedRows) {
  const q=Number(row.quantity);
  if(!Number.isFinite(q)) return null;
  const u=importNorm(row.unit).replace(/\./g,"").replace(/\s+/g,"");
  if(["шт","штука","штук"].includes(u)) return q;
  if(u==="100шт" || u==="100штук") return q*100;
  if(u==="м3" || u==="м³" || u==="кубм"){
    const vols=linkedRows.map(function(x){return Number(x.volumePerPiece||0);});
    if(!vols.length || vols.some(function(v){return !(v>0);})) return null;
    const first=vols[0];
    if(vols.some(function(v){return Math.abs(v-first)>1e-9;})) return null;
    return q/first;
  }
  return null;
}

function reconPositionText(rows) {
  const list=rows.map(function(r){return r.position_no;});
  if(!list.length) return "—";
  if(list.length<=4) return list.join(", ");
  return list.slice(0,3).join(", ")+"… ("+list.length+")";
}

function renderRecon() {
  if(!ui.reconLinkFilter) ui.reconLinkFilter="all";

  const claimCount=new Map();
  dataState.reconciliationLinks.forEach(function(l){
    claimCount.set(l.specification_row_id,(claimCount.get(l.specification_row_id)||0)+1);
  });

  // The reconciliation grid is specification-first. Every project position exists
  // in the grid even when no estimate row is linked to it.
  let specRows=specJoinedRows().filter(passesSpecFilters).slice().sort(function(a,b){
    return String(a.position_no||"").localeCompare(String(b.position_no||""),"ru",{numeric:true,sensitivity:"base"});
  });

  const viewRows=[];
  specRows.forEach(function(sr){
    const links=dataState.reconciliationLinks.filter(function(l){return l.specification_row_id===sr.id;});
    const estimateRows=links.map(function(l){
      return dataState.estimateRows.find(function(r){return r.id===l.estimate_row_id;});
    }).filter(Boolean);
    if(!estimateRows.length) viewRows.push({spec:sr,estimate:null,link:null});
    else estimateRows.forEach(function(r){
      viewRows.push({spec:sr,estimate:r,link:links.find(function(l){return l.estimate_row_id===r.id;})||null});
    });
  });

  let filtered=viewRows.filter(function(v){
    const r=v.estimate, sr=v.spec;
    const searchValues=[sr.position_no,sr.mark,sr.name];
    if(r) searchValues.push(r.position,estimateDisplayBasis(r),estimateDisplayName(r),r.basis,r.name);
    if(!passesSearch(searchValues)) return false;
    if(!r){
      const filters=filterBucket();
      return !((filters.position&&filters.position.size)||(filters.basis&&filters.basis.size)||(filters.name&&filters.name.size));
    }
    return rowPassesColumnFilters({position:r.position,basis:estimateDisplayBasis(r),name:estimateDisplayName(r)});
  });

  function viewIssue(v){
    const r=v.estimate, sr=v.spec;
    if(!r) return true;
    if((claimCount.get(sr.id)||0)>1) return true;
    const linkedGroup=linkedSpecRowsForEstimateRow(r);
    const estimatePieces=estimateQuantityPieces(r,linkedGroup);
    const projectQty=linkedGroup.reduce(function(sum,x){return sum+Number(x.total||0);},0);
    if(estimatePieces==null || Math.abs(projectQty-estimatePieces)>1e-9) return true;
    return importNorm(sr.name)!==importNorm(String(estimateSourceValue(r,"name")||""));
  }
  if(ui.reconLinkFilter==="unlinked") filtered=filtered.filter(function(v){return !v.estimate;});
  else if(ui.reconLinkFilter==="linked") filtered=filtered.filter(function(v){return !!v.estimate;});
  else if(ui.reconLinkFilter==="issues") filtered=filtered.filter(viewIssue);

  let body=filtered.map(function(v){
    const sr=v.spec, r=v.estimate;
    const projectQty=Number(sr.total||0);
    if(!r){
      return '<tr class="data-row recon-unlinked-spec" data-spec-row="'+esc(sr.id)+'">'+
        '<td class="center">'+esc(sr.position_no||"")+'</td>'+
        '<td>'+esc(sr.mark||"")+'</td>'+
        '<td>'+esc(sr.name||"")+'</td>'+
        '<td class="num">'+fmt0(projectQty)+'</td>'+
        '<td></td><td></td><td></td><td></td><td></td><td></td>'+
        '<td></td>'+
        '<td><span class="soft-status warn">Без связи</span></td>'+
        '<td></td><td></td><td></td>'+
        '<td><button class="table-text-action" type="button" data-recon-spec-edit="'+esc(sr.id)+'">Изменить</button></td>'+
      '</tr>';
    }

    const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
    const linkedGroup=linkedSpecRowsForEstimateRow(r);
    const groupProjectQty=linkedGroup.reduce(function(sum,x){return sum+Number(x.total||0);},0);
    const estimatePieces=estimateQuantityPieces(r,linkedGroup);
    const diff=estimatePieces==null ? null : groupProjectQty-estimatePieces;
    const conflict=(claimCount.get(sr.id)||0)>1;
    const method=v.link && v.link.link_method==="manual" ? "Manual" : "Auto";
    const sourceName=String(estimateSourceValue(r,"name")||"");
    const nameMismatch=importNorm(sr.name)!==importNorm(sourceName);
    const reasons=[];
    if(nameMismatch) reasons.push("Наименование");
    if(estimatePieces==null || Math.abs(diff)>1e-9) reasons.push("Количество");
    const discrepancy=conflict?"Конфликт":(reasons.length?reasons.join(" + "):"Нет");
    const status=conflict?"Конфликт":"Связано";
    const statusClass=conflict?"bad":"ok";
    const accepted=sr.mark||r.basis||"";

    return '<tr class="data-row" data-recon-row="'+esc(r.id)+'" data-spec-row="'+esc(sr.id)+'">'+
      '<td class="center">'+esc(sr.position_no||"")+'</td>'+
      '<td>'+esc(sr.mark||"")+'</td>'+
      '<td>'+esc(sr.name||"")+'</td>'+
      '<td class="num">'+fmt0(projectQty)+'</td>'+
      '<td class="center">'+esc(e?e.number:"")+'</td>'+
      filterCell("position",r.position,esc(r.position),"center")+
      filterCell("basis",r.basis,esc(r.basis),"")+
      '<td>'+esc(accepted)+'</td>'+
      filterCell("name",r.name,esc(r.name),"")+
      '<td class="num">'+(estimatePieces==null?"—":fmt(estimatePieces))+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"warning":"")+'">'+(diff==null?"—":fmt(diff))+'</td>'+
      '<td><span class="soft-status '+statusClass+'">'+status+'</span></td>'+
      '<td>'+method+'</td>'+
      '<td>'+esc(discrepancy)+'</td>'+
      '<td class="center"><input class="table-checkbox" type="checkbox" data-recon-journal="'+esc(r.id)+'" '+(dataState.reconciliationJournal.some(function(j){return j.estimate_row_id===r.id && j.status==="open";})?'checked':'')+' aria-label="Запись в журнале"></td>'+
      '<td><button class="table-text-action" type="button" data-recon-edit="'+esc(r.id)+'">Изменить</button></td>'+
    '</tr>';
  }).join("");

  if(!body)body=tableMessage("Нет строк по текущему фильтру.",16);
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table recon-table recon-header-clean" data-table-key="estimate-recon-v6"><thead><tr><th colspan="4">Спецификация</th><th colspan="6">Смета</th><th rowspan="2">Разница</th><th rowspan="2">Сопоставление</th><th rowspan="2">Способ</th><th rowspan="2">Расхождение</th><th rowspan="2">Журнал</th><th rowspan="2">Действия</th></tr>'+
    '<tr><th>Поз. спецификации</th><th>Марка</th><th>Наименование по спецификации</th><th>Проект, шт.</th><th>№ сметы</th><th class="filterable-head">'+filterHeader("Поз. сметы","position")+'</th><th class="filterable-head">'+filterHeader("Обоснование","basis")+'</th><th>Принятое обоснование</th><th class="filterable-head">'+filterHeader("Наименование по смете","name")+'</th><th>Смета, шт.</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  document.querySelectorAll("[data-recon-spec-edit]").forEach(function(btn){
    btn.onclick=function(){openReconciliationEditorForSpec(btn.dataset.reconSpecEdit);};
  });
}

 function reconciliationEditorModal() {
  let modal=document.getElementById("reconciliationEditorModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="reconciliationEditorModal";
  modal.className="spec-import-backdrop";
  modal.innerHTML='<div class="recon-edit-modal"><div class="spec-import-head"><div><strong>Ручное сопоставление</strong><span class="recon-edit-caption">Выберите позиции спецификации для строки сметы</span></div><button class="spec-import-close" type="button">×</button></div><div class="recon-source-card"><div class="recon-block-label">Строка сметы — привязываем</div><div class="recon-source-grid"><div><span>Смета / позиция</span><strong class="recon-source-position"></strong></div><div><span>Обоснование</span><strong class="recon-source-basis"></strong></div><div class="recon-source-name-wrap"><span>Наименование</span><strong class="recon-source-name"></strong></div></div></div><div class="recon-target-head"><strong>Позиции спецификации — выбираем, к чему привязать</strong><span>Можно выбрать несколько позиций</span></div><div class="recon-choice-header"><span></span><span>Поз.</span><span>Марка</span><span>Наименование</span><span>Кол-во</span></div><div class="recon-edit-list"></div><div class="spec-import-foot"><span class="recon-edit-state"></span><span class="spacer"></span><button class="context-link recon-edit-cancel" type="button">Отмена</button><button class="context-link recon-edit-save" type="button">Сохранить</button></div></div>';
  document.body.appendChild(modal);
  const close=function(){modal.classList.remove("open");};
  modal.querySelector(".spec-import-close").onclick=close;
  modal.querySelector(".recon-edit-cancel").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector(".recon-edit-save").onclick=saveManualReconciliation;
  return modal;
}

function openReconciliationEditorForSpec(specRowId) {
  const sr=specJoinedRows().find(function(x){return x.id===specRowId;});
  if(!sr) return;
  const candidates=dataState.estimateRows.filter(function(r){
    if(r.row_type!=="material") return false;
    const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
    if(!e) return false;
    if(sr.section.is_stairs) return !!e.is_stairs;
    return !e.is_stairs &&
      (!e.building_section || e.building_section===sr.section.building_section) &&
      (!e.zone || e.zone===sr.section.zone);
  });
  const specPeers=specJoinedRows().filter(function(x){
    return x.section && sr.section &&
      x.section.building_section===sr.section.building_section &&
      x.section.zone===sr.section.zone;
  }).sort(function(a,b){return Number(a.sort_order||a.position_no||0)-Number(b.sort_order||b.position_no||0);});
  const specIndex=Math.max(0,specPeers.findIndex(function(x){return x.id===sr.id;}));
  const specRatio=specPeers.length>1?specIndex/(specPeers.length-1):0;
  const ranked=candidates.map(function(r){
    const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
    const peers=dataState.estimateRows.filter(function(x){return x.estimate_id===r.estimate_id&&x.row_type==="material";})
      .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
    const ri=Math.max(0,peers.findIndex(function(x){return x.id===r.id;}));
    const rr=peers.length>1?ri/(peers.length-1):0;
    let score=(1-Math.min(1,Math.abs(specRatio-rr)))*120;
    if(importNorm(estimateSourceValue(r,"basis"))===importNorm(sr.mark)) score+=1000;
    if(importNorm(estimateSourceValue(r,"name"))===importNorm(sr.name)) score+=500;
    const occupied=dataState.reconciliationLinks.some(function(l){return l.estimate_row_id===r.id&&l.specification_row_id!==sr.id;});
    return {row:r,estimate:e,score:score,occupied:occupied};
  }).sort(function(a,b){return b.score-a.score || String(a.estimate.number).localeCompare(String(b.estimate.number),"ru",{numeric:true}) || Number(a.row.sort_order||0)-Number(b.row.sort_order||0);});
  const modal=reconciliationEditorModal();
  const card=modal.querySelector(".recon-edit-modal");
  card.style.position="";card.style.left="";card.style.top="";card.style.margin="";
  modal.dataset.estimateRowId="";
  modal.dataset.specRowId=sr.id;
  modal.querySelector(".spec-import-head strong").textContent="Связь позиции спецификации со сметой";
  modal.querySelector(".recon-edit-caption").textContent="Выберите строку сметы";
  modal.querySelector(".recon-block-label").textContent="Позиция спецификации — привязываем";
  modal.querySelector(".recon-source-position").textContent="Поз. "+sr.position_no+" · "+(sr.section&&sr.section.building_section?sr.section.building_section:"");
  modal.querySelector(".recon-source-basis").textContent=sr.mark||"—";
  modal.querySelector(".recon-source-name").textContent=sr.name||"—";
  modal.querySelector(".recon-target-head strong").textContent="Строки сметы — выбираем";
  modal.querySelector(".recon-target-head span").textContent="Отметьте строку слева и нажмите «Сохранить»";
  const list=modal.querySelector(".recon-edit-list");
  list.innerHTML='<table class="recon-candidate-table"><colgroup><col class="recon-col-pick"><col class="recon-col-est"><col class="recon-col-pos"><col class="recon-col-basis"><col class="recon-col-accepted"><col class="recon-col-name"><col class="recon-col-qty"></colgroup><thead><tr><th>Выбор</th><th>Смета</th><th>Поз.</th><th>Обоснование</th><th>Принятое обоснование</th><th>Наименование</th><th>Кол-во</th></tr></thead><tbody>'+
    ranked.map(function(c,index){
      const basis=estimateSourceValue(c.row,"basis")||"—";
      const accepted=estimateDisplayBasis(c.row)||"—";
      const name=estimateSourceValue(c.row,"name")||"—";
      return '<tr class="recon-candidate-row'+(c.occupied?' is-occupied':'')+'" data-candidate-row>'+
        '<td class="recon-pick-cell"><input type="radio" name="recon-estimate-candidate" data-recon-estimate="'+esc(c.row.id)+'" aria-label="Выбрать строку сметы №'+esc(c.estimate.number)+' позиция '+esc(c.row.position)+'"></td>'+
        '<td>№'+esc(c.estimate.number)+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td>'+
        '<td class="recon-num">'+esc(c.row.position)+'</td>'+
        '<td title="'+esc(basis)+'">'+esc(basis)+'</td>'+
        '<td title="'+esc(accepted)+'">'+esc(accepted)+'</td>'+
        '<td title="'+esc(name)+'">'+esc(name)+(c.occupied?'<small class="recon-table-note occupied">Уже есть связь</small>':'')+'</td>'+
        '<td class="recon-num">'+esc(c.row.quantity==null?"—":fmt(c.row.quantity))+' шт.</td>'+
      '</tr>';
    }).join("")+
  '</tbody></table>';
  modal.querySelector(".recon-choice-header").innerHTML="";
  modal.querySelector(".recon-choice-header").style.display="none";
  const saveBtn=modal.querySelector(".recon-edit-save");
  saveBtn.classList.add("is-disabled");
  saveBtn.setAttribute("aria-disabled","true");
  list.querySelectorAll("[data-candidate-row]").forEach(function(row){
    const input=row.querySelector("[data-recon-estimate]");
    row.addEventListener("click",function(ev){
      if(ev.target!==input){input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));}
    });
    input.addEventListener("change",function(){
      list.querySelectorAll("[data-candidate-row]").forEach(function(r){
        r.classList.toggle("is-selected",!!r.querySelector("[data-recon-estimate]:checked"));
      });
      saveBtn.classList.remove("is-disabled");
      saveBtn.setAttribute("aria-disabled","false");
    });
  });
  modal.querySelector(".recon-edit-state").textContent="";
  modal.classList.add("open");
}

function openReconciliationEditor(rowId) {
  const row=dataState.estimateRows.find(function(x){return x.id===rowId;});
  if(!row) return;
  const estimate=dataState.estimates.find(function(x){return x.id===row.estimate_id;});
  if(!estimate) return;
  const estSection=dataState.estimateSections.find(function(x){return x.id===row.section_id;});
  const allSpec=specJoinedRows().filter(function(sr){
    const ss=sr.section;
    if(estimate.is_stairs) return !!ss.is_stairs;
    return !ss.is_stairs &&
      (!estimate.building_section || ss.building_section===estimate.building_section) &&
      (!estimate.zone || ss.zone===estimate.zone);
  });
  const matchingSections=Array.from(new Set(allSpec.filter(function(sr){
    return estSection && importNorm(sr.section.name)===importNorm(estSection.title);
  }).map(function(sr){return sr.section.id;})));
  const scoped=matchingSections.length===1
    ? allSpec.filter(function(sr){return sr.section.id===matchingSections[0];})
    : allSpec;

  const groups=new Map();
  scoped.forEach(function(sr){
    if(!groups.has(sr.catalog_item_id)){
      groups.set(sr.catalog_item_id,{id:sr.catalog_item_id,mark:sr.mark,name:sr.name,rows:[],qty:0});
    }
    const g=groups.get(sr.catalog_item_id);
    g.rows.push(sr); g.qty+=Number(sr.total||0);
  });
  const linkedIds=new Set(
    dataState.reconciliationLinks.filter(function(l){return l.estimate_row_id===row.id;})
      .map(function(l){return l.specification_row_id;})
  );
  const modal=reconciliationEditorModal();
  modal.dataset.specRowId="";
  modal.dataset.estimateRowId=row.id;
  modal.querySelector(".recon-source-position").textContent="№"+estimate.number+" · поз. "+row.position;
  modal.querySelector(".recon-source-basis").textContent=estimateSourceValue(row,"basis")||"—";
  modal.querySelector(".recon-source-name").textContent=estimateSourceValue(row,"name")||"—";
  modal.querySelector(".recon-edit-state").textContent="";
  // Manual reconciliation candidate ranking.
  // Source rows in estimate/specification normally follow approximately the same construction order,
  // so relative row position is a useful tie-breaker, never an automatic persistent link.
  const estimatePeers=dataState.estimateRows.filter(function(x){
    return x.estimate_id===row.estimate_id && x.row_type==="material" &&
      (!row.section_id || x.section_id===row.section_id);
  }).sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
  const estimateIndex=Math.max(0,estimatePeers.findIndex(function(x){return x.id===row.id;}));
  const estimateRatio=estimatePeers.length>1 ? estimateIndex/(estimatePeers.length-1) : 0;
  const orderedSpec=scoped.slice().sort(function(a,b){return Number(a.sort_order||a.position_no||0)-Number(b.sort_order||b.position_no||0);});
  function tokenSimilarity(a,b){
    const aa=new Set(importNorm(a).split(/[^a-zа-яё0-9]+/i).filter(Boolean));
    const bb=new Set(importNorm(b).split(/[^a-zа-яё0-9]+/i).filter(Boolean));
    if(!aa.size || !bb.size) return 0;
    let common=0; aa.forEach(function(x){if(bb.has(x)) common++;});
    return common/Math.max(aa.size,bb.size);
  }
  const ranked=Array.from(groups.values()).map(function(g){
    const basis=estimateSourceValue(row,"basis");
    const name=estimateSourceValue(row,"name");
    let score=0;
    const normBasis=importNorm(basis);
    const normName=importNorm(name);
    const normMark=importNorm(g.mark);
    const normSpecName=importNorm(g.name);
    if(normBasis===normMark) score+=1000;
    if(normName===normSpecName) score+=1500;
    if(normMark && normName.includes(normMark)) score+=800;
    if(normSpecName && (normName.includes(normSpecName) || normSpecName.includes(normName))) score+=350;
    score+=tokenSimilarity(name,g.name)*160;
    const indexes=g.rows.map(function(sr){return orderedSpec.findIndex(function(x){return x.id===sr.id;});}).filter(function(i){return i>=0;});
    const specIndex=indexes.length?Math.min.apply(null,indexes):0;
    const specRatio=orderedSpec.length>1 ? specIndex/(orderedSpec.length-1) : 0;
    score+=(1-Math.min(1,Math.abs(estimateRatio-specRatio)))*120;
    return {group:g,score:score};
  }).sort(function(a,b){
    return b.score-a.score || a.group.mark.localeCompare(b.group.mark,"ru");
  });
  modal.querySelector(".spec-import-head strong").textContent="Ручное сопоставление";
  modal.querySelector(".recon-edit-caption").textContent="Выберите позиции спецификации для строки сметы";
  modal.querySelector(".recon-block-label").textContent="Строка сметы — привязываем";
  modal.querySelector(".recon-target-head strong").textContent="Позиции спецификации — выбираем, к чему привязать";
  modal.querySelector(".recon-target-head span").textContent="Можно выбрать несколько позиций";
  const header=modal.querySelector(".recon-choice-header");
  header.innerHTML="";
  header.style.display="none";
  const list=modal.querySelector(".recon-edit-list");
  list.innerHTML=ranked.length
    ? '<table class="recon-spec-candidate-table"><colgroup><col class="recon-spec-col-pick"><col class="recon-spec-col-pos"><col class="recon-spec-col-mark"><col class="recon-spec-col-name"><col class="recon-spec-col-qty"></colgroup><thead><tr><th>Выбор</th><th>Поз.</th><th>Марка</th><th>Наименование</th><th>Кол-во</th></tr></thead><tbody>'+
      ranked.map(function(candidate,index){
        const g=candidate.group;
        const checked=g.rows.some(function(sr){return linkedIds.has(sr.id);});
        const positions=g.rows.map(function(sr){return sr.position_no;});
        const positionText=positions.length<=3?positions.join(", "):positions.slice(0,2).join(", ")+"…";
        return '<tr class="recon-spec-candidate-row'+(checked?' is-selected':'')+'" data-recon-spec-row>'+
          '<td class="recon-spec-pick-cell"><input type="checkbox" data-recon-catalog="'+esc(g.id)+'" '+(checked?'checked':'')+' aria-label="Выбрать позицию '+esc(g.mark)+'"></td>'+
          '<td class="recon-num">'+esc(positionText||"—")+'</td>'+
          '<td class="recon-spec-mark">'+esc(g.mark)+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td>'+
          '<td title="'+esc(g.name)+'">'+esc(g.name)+'</td>'+
          '<td class="recon-num">'+fmt0(g.qty)+' шт.</td>'+
        '</tr>';
      }).join("")+
      '</tbody></table>'
    : '<div class="empty-note">В области этой сметы нет проектных позиций.</div>';
  list.querySelectorAll("[data-recon-spec-row]").forEach(function(candidateRow){
    const input=candidateRow.querySelector("[data-recon-catalog]");
    candidateRow.addEventListener("click",function(ev){
      if(ev.target!==input){
        input.checked=!input.checked;
        input.dispatchEvent(new Event("change",{bubbles:true}));
      }
    });
    input.addEventListener("change",function(){
      candidateRow.classList.toggle("is-selected",input.checked);
    });
  });
  modal.classList.add("open");
}

async function saveManualReconciliation() {
  const modal=reconciliationEditorModal();
  const specRowId=modal.dataset.specRowId||"";
  if(specRowId){
    const chosen=modal.querySelector("[data-recon-estimate]:checked");
    const state=modal.querySelector(".recon-edit-state");
    if(!chosen){state.textContent="Выберите строку сметы.";return;}
    state.textContent="Сохраняю…";
    try{
      const result=await client.rpc("set_manual_reconciliation",{
        p_estimate_row_id:chosen.dataset.reconEstimate,
        p_specification_row_ids:[specRowId]
      });
      if(result.error) throw result.error;
      await refreshProjectDataSlices(["reconciliationLinks","reconciliationJournal"],dataState.project);
      modal.dataset.specRowId="";
      modal.classList.remove("open");
      renderPage("recon",0);
    }catch(err){state.textContent=err&&err.message?err.message:String(err);}
    return;
  }
  const rowId=modal.dataset.estimateRowId;
  const selectedCatalogs=new Set(
    Array.from(modal.querySelectorAll("[data-recon-catalog]:checked")).map(function(x){return x.dataset.reconCatalog;})
  );
  const row=dataState.estimateRows.find(function(x){return x.id===rowId;});
  const estimate=row && dataState.estimates.find(function(x){return x.id===row.estimate_id;});
  const estSection=row && dataState.estimateSections.find(function(x){return x.id===row.section_id;});
  if(!row || !estimate) return;
  let scoped=specJoinedRows().filter(function(sr){
    const ss=sr.section;
    if(estimate.is_stairs) return !!ss.is_stairs;
    return !ss.is_stairs &&
      (!estimate.building_section || ss.building_section===estimate.building_section) &&
      (!estimate.zone || ss.zone===estimate.zone);
  });
  const matchingSections=Array.from(new Set(scoped.filter(function(sr){
    return estSection && importNorm(sr.section.name)===importNorm(estSection.title);
  }).map(function(sr){return sr.section.id;})));
  if(matchingSections.length===1) scoped=scoped.filter(function(sr){return sr.section.id===matchingSections[0];});
  const ids=scoped.filter(function(sr){return selectedCatalogs.has(sr.catalog_item_id);}).map(function(sr){return sr.id;});
  const state=modal.querySelector(".recon-edit-state");
  state.textContent="Сохраняю…";
  try{
    const result=await client.rpc("set_manual_reconciliation",{
      p_estimate_row_id:rowId,
      p_specification_row_ids:ids
    });
    if(result.error) throw result.error;
    await refreshProjectDataSlices(["reconciliationLinks","reconciliationJournal"],dataState.project);
    modal.classList.remove("open");
    renderPage("recon",0);
  }catch(err){
    state.textContent=err&&err.message?err.message:String(err);
  }
}

async function setReconciliationJournal(rowId,enabled,input) {
  const row=dataState.estimateRows.find(function(x){return x.id===rowId;});
  if(!row || !dataState.project) return;
  input.disabled=true;
  try{
    const existing=dataState.reconciliationJournal.filter(function(j){return j.estimate_row_id===rowId && j.status==="open";});
    if(enabled){
      if(!existing.length){
        const linked=linkedSpecRowsForEstimateRow(row);
        const projectQty=linked.reduce(function(sum,x){return sum+Number(x.total||0);},0);
        const estimatePieces=estimateQuantityPieces(row,linked);
        const reasons=[];
        if(!linked.length) reasons.push("Без связи");
        if(estimatePieces==null) reasons.push("Количество сметы не приведено к шт.");
        else if(Math.abs(projectQty-estimatePieces)>1e-9) reasons.push("Расхождение количества");
        const specNames=Array.from(new Set(linked.map(function(x){return x.name;})));
        if(specNames.length===1 && importNorm(specNames[0])!==importNorm(estimateSourceValue(row,"name"))) reasons.push("Расхождение наименования");
        if(!reasons.length) reasons.push("Добавлено пользователем");
        const payload={
          project_id:dataState.project.id,
          estimate_row_id:row.id,
          issue_key:"estimate:"+row.id,
          reasons:reasons,
          status:"open",
          snapshot:{
            estimate_id:row.estimate_id,
            estimate_number:(dataState.estimates.find(function(e){return e.id===row.estimate_id;})||{}).number||"",
            estimate_position:row.position,
            estimate_basis:estimateSourceValue(row,"basis"),
            estimate_name:estimateSourceValue(row,"name"),
            estimate_quantity_pieces:estimatePieces,
            specification_positions:linked.map(function(x){return x.position_no;}),
            specification_marks:Array.from(new Set(linked.map(function(x){return x.mark;}))),
            specification_names:specNames,
            project_quantity_pieces:projectQty,
            difference_pieces:estimatePieces==null?null:projectQty-estimatePieces
          }
        };
        const result=await client.from("reconciliation_journal").insert(payload).select("id,estimate_row_id,specification_row_id,issue_key,reasons,proposal,comment,status,snapshot,created_at,updated_at").single();
        if(result.error) throw result.error;
        dataState.reconciliationJournal.unshift(result.data);
      }
    }else if(existing.length){
      const ids=existing.map(function(x){return x.id;});
      const result=await client.from("reconciliation_journal").delete().in("id",ids);
      if(result.error) throw result.error;
      dataState.reconciliationJournal=dataState.reconciliationJournal.filter(function(j){return !ids.includes(j.id);});
    }
    rerenderContent();
  }catch(err){
    console.error(err);
    input.checked=!enabled;
    alert("Не удалось изменить Журнал: "+(err.message||err));
  }finally{
    input.disabled=false;
  }
}

function wireReconciliationControls() {
  const journalExport=document.querySelector("[data-recon-journal-export]");
  if(journalExport) journalExport.onclick=function(){exportEstimateJournalExcel();};
  const linkSelect=document.querySelector("[data-recon-link-select]");
  if(linkSelect) linkSelect.onchange=function(){
    ui.reconLinkFilter=linkSelect.value||"all";
    rerenderContent();
  };
  document.querySelectorAll("[data-recon-edit]").forEach(function(btn){
    btn.onclick=function(){openReconciliationEditor(btn.dataset.reconEdit);};
  });
  document.querySelectorAll("[data-recon-journal]").forEach(function(input){
    input.onchange=function(){setReconciliationJournal(input.dataset.reconJournal,input.checked,input);};
  });
}

function journalNameDiffHtml(left,right) {
  const a=String(left||""), b=String(right||"");
  const na=importNorm(a), nb=importNorm(b);
  if(!a) return "—";
  if(na===nb) return esc(a);
  const aw=a.split(/(\s+|[-–—,.;:()\/]+)/), bw=b.split(/(\s+|[-–—,.;:()\/]+)/);
  const bTokens=new Set(bw.map(function(x){return importNorm(x);}).filter(Boolean));
  return aw.map(function(x){
    const n=importNorm(x);
    if(!n || /^\s+$|^[-–—,.;:()\/]+$/.test(x)) return esc(x);
    return bTokens.has(n)?esc(x):'<mark class="journal-diff-text">'+esc(x)+'</mark>';
  }).join("");
}

function journalDiscrepancyLabel(specName,estimateName,diff,linked) {
  const nameDiff=linked && importNorm(specName)!==importNorm(estimateName);
  const qtyDiff=diff!=null && Math.abs(Number(diff))>1e-9;
  if(!linked) return "Без связи";
  if(nameDiff && qtyDiff) return "Наименование + количество";
  if(nameDiff) return "Наименование";
  if(qtyDiff) return "Количество";
  return "Нет";
}

function journalNaturalCompare(a,b) {
  return String(a==null?"":a).localeCompare(String(b==null?"":b),"ru",{numeric:true,sensitivity:"base"});
}

function sortedEstimateJournalRows() {
  const estimateRowById=new Map((dataState.estimateRows||[]).map(function(x){return [x.id,x];}));
  const estimateById=new Map((dataState.estimates||[]).map(function(x){return [x.id,x];}));
  const rows=(dataState.reconciliationJournal||[])
    .filter(function(j){return j.status==="open";})
    .slice()
    .sort(function(a,b){
      const ra=estimateRowById.get(a.estimate_row_id)||null;
      const rb=estimateRowById.get(b.estimate_row_id)||null;
      const ea=ra?estimateById.get(ra.estimate_id)||null:null;
      const eb=rb?estimateById.get(rb.estimate_id)||null:null;
      const sa=a.snapshot||{}, sb=b.snapshot||{};
      const estimateNoA=ea?ea.number:(sa.estimate_number||"");
      const estimateNoB=eb?eb.number:(sb.estimate_number||"");
      const byEstimate=journalNaturalCompare(estimateNoA,estimateNoB);
      if(byEstimate) return byEstimate;
      const positionA=ra?ra.position:(sa.estimate_position||"");
      const positionB=rb?rb.position:(sb.estimate_position||"");
      const byPosition=journalNaturalCompare(positionA,positionB);
      if(byPosition) return byPosition;
      const specA=(sa.specification_positions||[])[0]||"";
      const specB=(sb.specification_positions||[])[0]||"";
      return journalNaturalCompare(specA,specB);
    });
  return {rows:rows,estimateRowById:estimateRowById,estimateById:estimateById};
}

function journalDiffRichText(left,right) {
  const a=String(left||""), b=String(right||"");
  if(!a) return [{text:"—"}];
  const na=importNorm(a), nb=importNorm(b);
  if(na===nb) return [{text:a}];
  const parts=a.split(/(\s+|[-–—,.;:()\/]+)/);
  const rightTokens=new Set(
    b.split(/(\s+|[-–—,.;:()\/]+)/)
     .map(function(x){return importNorm(x);})
     .filter(Boolean)
  );
  return parts.map(function(x){
    const n=importNorm(x);
    const plain=!n || /^\s+$|^[-–—,.;:()\/]+$/.test(x) || rightTokens.has(n);
    return plain
      ? {text:x}
      : {text:x,font:{color:{argb:"FFA52A2A"},bold:true}};
  });
}

async function exportEstimateJournalExcel() {
  const trigger=document.querySelector("[data-recon-journal-export]");
  if(trigger) trigger.disabled=true;
  try{
    await ensureExcelJsLoaded();
    const bundle=sortedEstimateJournalRows();
    if(!bundle.rows.length){
      alert("В журнале нет записей для экспорта.");
      return;
    }

    const workbook=new ExcelJS.Workbook();
    workbook.creator="ПТО Филимонова";
    workbook.created=new Date();
    const ws=workbook.addWorksheet("Журнал сверки",{
      views:[{state:"frozen",ySplit:2}]
    });

    ws.mergeCells("A1:D1");
    ws.mergeCells("E1:H1");
    ws.mergeCells("I1:J1");
    ws.getCell("A1").value="Спецификация";
    ws.getCell("E1").value="Смета";
    ws.getCell("I1").value="Контроль";

    const headers=["Поз. спецификации","Марка","Наименование по спецификации","Проект, шт.","№ сметы","Поз. сметы","Наименование по смете","Смета, шт.","Разница","Расхождение"];
    ws.addRow(headers);

    const thin={style:"thin",color:{argb:"FFD9DDE3"}};
    const border={top:thin,left:thin,bottom:thin,right:thin};
    const groupFill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF1F3F5"}};
    const headerFill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF7F8FA"}};
    const diffFill={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFF7F6"}};
    const diffFont={color:{argb:"FFB42318"},bold:true};

    ["A1","E1","I1"].forEach(function(addr){
      const cell=ws.getCell(addr);
      cell.font={bold:true,color:{argb:"FF4F5258"}};
      cell.alignment={horizontal:"center",vertical:"middle"};
      cell.fill=groupFill;
    });
    ws.getRow(1).height=22;
    ws.getRow(2).height=34;
    ws.getRow(2).eachCell(function(cell){
      cell.font={bold:true,color:{argb:"FF4F5258"}};
      cell.alignment={horizontal:"center",vertical:"middle",wrapText:true};
      cell.fill=headerFill;
      cell.border=border;
    });
    for(let c=1;c<=10;c++) ws.getCell(1,c).border=border;

    bundle.rows.forEach(function(j){
      const r=bundle.estimateRowById.get(j.estimate_row_id)||null;
      const e=r?bundle.estimateById.get(r.estimate_id)||null:null;
      const snap=j.snapshot||{};
      const srows=r?linkedSpecRowsForEstimateRow(r):[];
      const linked=srows.length>0 || (snap.specification_positions||[]).length>0;
      const positions=srows.length?srows.map(function(x){return x.position_no;}):(snap.specification_positions||[]);
      const marks=srows.length?Array.from(new Set(srows.map(function(x){return x.mark;}))):(snap.specification_marks||[]);
      const specNames=srows.length?Array.from(new Set(srows.map(function(x){return x.name;}))):(snap.specification_names||[]);
      const specName=specNames.join(" / ");
      const estimateName=r?String(estimateSourceValue(r,"name")||""):String(snap.estimate_name||"");
      const projectQty=srows.length?srows.reduce(function(sum,x){return sum+Number(x.total||0);},0):(snap.project_quantity_pieces==null?null:Number(snap.project_quantity_pieces));
      const estimateQty=r?estimateQuantityPieces(r,srows):snap.estimate_quantity_pieces;
      const diff=projectQty==null||estimateQty==null?null:Number(projectQty)-Number(estimateQty);
      const discrepancy=journalDiscrepancyLabel(specName,estimateName,diff,linked);

      const row=ws.addRow([
        positions.length?positions.join(", "):"—",
        marks.length?marks.join(" / "):"—",
        "",
        projectQty==null?"—":Number(projectQty),
        e?e.number:(snap.estimate_number||"—"),
        r?r.position:(snap.estimate_position||"—"),
        "",
        estimateQty==null?"—":Number(estimateQty),
        diff==null?"—":Number(diff),
        discrepancy
      ]);

      row.getCell(3).value={richText:journalDiffRichText(specName,estimateName)};
      row.getCell(7).value={richText:journalDiffRichText(estimateName,specName)};

      row.eachCell({includeEmpty:true},function(cell,col){
        cell.border=border;
        cell.alignment={
          vertical:"top",
          wrapText:true,
          horizontal:[1,4,5,6,8,9].includes(col)?"center":"left"
        };
      });

      if(diff!=null && Math.abs(Number(diff))>1e-9){
        [4,8,9].forEach(function(col){
          const cell=row.getCell(col);
          cell.font=diffFont;
          cell.fill=diffFill;
        });
      }
    });

    ws.columns=[
      {width:16},{width:18},{width:46},{width:12},{width:11},
      {width:12},{width:54},{width:12},{width:12},{width:24}
    ];
    ws.autoFilter={from:{row:2,column:1},to:{row:2,column:10}};
    ws.getColumn(4).numFmt="0.###";
    ws.getColumn(8).numFmt="0.###";
    ws.getColumn(9).numFmt="0.###";

    const buffer=await workbook.xlsx.writeBuffer();
    const blob=new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download="Журнал_сверки.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }catch(err){
    console.error(err);
    alert("Экспорт Журнала не выполнен: "+(err&&err.message?err.message:String(err)));
  }finally{
    if(trigger) trigger.disabled=false;
  }
}

function renderEstimateJournal() {
  const bundle=sortedEstimateJournalRows();
  const rows=bundle.rows;
  const estimateRowById=bundle.estimateRowById;
  const estimateById=bundle.estimateById;
  let body=rows.map(function(j){
    const r=estimateRowById.get(j.estimate_row_id)||null;
    const e=r?estimateById.get(r.estimate_id)||null:null;
    const snap=j.snapshot||{};
    const srows=r?linkedSpecRowsForEstimateRow(r):[];
    const linked=srows.length>0 || (snap.specification_positions||[]).length>0;
    const positions=srows.length?srows.map(function(x){return x.position_no;}):(snap.specification_positions||[]);
    const marks=srows.length?Array.from(new Set(srows.map(function(x){return x.mark;}))):(snap.specification_marks||[]);
    const specNames=srows.length?Array.from(new Set(srows.map(function(x){return x.name;}))):(snap.specification_names||[]);
    const specName=specNames.join(" / ");
    const estimateName=r?String(estimateSourceValue(r,"name")||""):String(snap.estimate_name||"");
    const projectQty=srows.length?srows.reduce(function(sum,x){return sum+Number(x.total||0);},0):(snap.project_quantity_pieces==null?null:Number(snap.project_quantity_pieces));
    const estimateQty=r?estimateQuantityPieces(r,srows):snap.estimate_quantity_pieces;
    const diff=projectQty==null||estimateQty==null?null:Number(projectQty)-Number(estimateQty);
    const discrepancy=journalDiscrepancyLabel(specName,estimateName,diff,linked);
    return '<tr class="data-row">'+
      '<td title="'+esc(positions.join(", "))+'">'+esc(positions.length?(positions.length<=3?positions.join(", "):positions.slice(0,2).join(", ")+"…"):"—")+'</td>'+
      '<td>'+esc(marks.length?marks.join(" / "):"—")+'</td>'+
      '<td class="journal-name-cell">'+journalNameDiffHtml(specName,estimateName)+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(projectQty==null?"—":fmt(projectQty))+'</td>'+
      '<td class="center">'+esc(e?e.number:"—")+'</td>'+
      '<td class="center">'+esc(r?r.position:(snap.estimate_position||"—"))+'</td>'+
      '<td class="journal-name-cell">'+journalNameDiffHtml(estimateName,specName)+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(estimateQty==null?"—":fmt(estimateQty))+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(diff==null?"—":fmt(diff))+'</td>'+
      '<td>'+esc(discrepancy)+'</td>'+
      '<td><button class="table-text-action" type="button" data-journal-remove="'+esc(j.id)+'">Убрать</button></td>'+
    '</tr>';
  }).join("");
  if(!body) body=tableMessage("В журнал ещё не добавлены контрольные записи.",11);
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table journal-table" data-table-key="reconciliation-journal-v2"><thead><tr><th colspan="4">Спецификация</th><th colspan="4">Смета</th><th colspan="3">Контроль</th></tr><tr><th>Поз. спецификации</th><th>Марка</th><th>Наименование по спецификации</th><th>Проект, шт.</th><th>№ сметы</th><th>Поз. сметы</th><th>Наименование по смете</th><th>Смета, шт.</th><th>Разница</th><th>Расхождение</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  document.querySelectorAll("[data-journal-remove]").forEach(function(btn){
    btn.onclick=async function(){
      const j=dataState.reconciliationJournal.find(function(x){return x.id===btn.dataset.journalRemove;});
      if(!j) return;
      btn.disabled=true;
      try{
        const result=await client.from("reconciliation_journal").delete().eq("id",j.id);
        if(result.error) throw result.error;
        dataState.reconciliationJournal=dataState.reconciliationJournal.filter(function(x){return x.id!==j.id;});
        rerenderContent();
      }catch(err){console.error(err);alert("Не удалось убрать запись из Журнала: "+(err.message||err));btn.disabled=false;}
    };
  });
}
