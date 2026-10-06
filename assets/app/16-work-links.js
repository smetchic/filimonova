function workLinkMaterialGeometry(row) {
  if(!row) return null;
  let item=null;
  if(row.length_mm!=null || row.height_mm!=null || row.thickness_mm!=null) {
    item=row;
  } else if(row.catalog_item_id) {
    item=maps().catalog.get(row.catalog_item_id)||null;
  } else if(row.id) {
    item=maps().catalog.get(row.id)||null;
  }

  let lengthMm=item?Number(item.length_mm||0):0;
  let heightMm=item?Number(item.height_mm||0):0;
  let thicknessMm=item?Number(item.thickness_mm||0):0;
  let source=item&&item.geometry_source?item.geometry_source:"";
  let sourcePage=item&&item.geometry_source_page?item.geometry_source_page:null;

  if(!(lengthMm>0&&heightMm>0&&thicknessMm>0)) {
    const text=String(
      (item&&item.name) ||
      (row&&estimateDisplayName(row)) ||
      (row&&row.name) || ""
    ).replace(/,/g,".");
    const match=text.match(/(\d{1,3})\.(\d{1,2})\.(\d{1,2})/);
    if(!match) return null;
    lengthMm=Number(match[1])*100;
    heightMm=Number(match[2])*100;
    thicknessMm=Number(match[3])*10;
    if(!(lengthMm>0&&heightMm>0&&thicknessMm>0)) return null;
    source="designation-fallback";
    sourcePage=null;
  }

  const length=lengthMm/1000;
  const height=heightMm/1000;
  const thickness=thicknessMm/1000;
  const storedArea=item?Number(item.area_m2||0):0;
  const area=storedArea>0?storedArea:(length*height);

  return {
    length:length,
    height:height,
    thickness:thickness,
    lengthMm:lengthMm,
    heightMm:heightMm,
    thicknessMm:thicknessMm,
    area:area,
    source:source,
    sourcePage:sourcePage,
    label:numFmt.format(length)+" × "+numFmt.format(height)+" × "+numFmt.format(thickness)+" м"
  };
}

function workLinkMaterialArea(row) {
  const g=workLinkMaterialGeometry(row);
  return g?g.area:null;
}

function workLinkThreshold(row) {
  const text=String(estimateDisplayName(row)||row.name||"").replace(/,/g,".");
  const m=text.match(/(?:до|не\s+более)\s*(\d+(?:\.\d+)?)\s*м(?:2|²)/i);
  return m?Number(m[1]):null;
}


function workLinkKind(value) {
  const text=norm(value);
  if(/площадк/.test(text)) return "platform";
  if(/лестничн.*марш|\bмарш/.test(text)) return "march";
  if(/балк/.test(text)) return "beam";
  if(/вентиляц|вентблок|вентиляционн.*блок/.test(text)) return "vent";
  if(/вкладыш/.test(text)) return "insert";
  if(/экран|козыр/.test(text)) return "canopy";
  if(/лоджи/.test(text)) return "loggia";
  if(/стенк/.test(text)) return "wall";
  if(/панел/.test(text)) return "panel";
  return "";
}

function workLinkAutoCandidate(material) {
  let works=(dataState.estimateRows||[]).filter(function(w){
    return w.row_type==="work" &&
      w.estimate_id===material.estimate_id &&
      w.section_id===material.section_id;
  });
  if(!works.length) return null;

  const materialKind=workLinkKind(estimateDisplayName(material)||material.name||"");
  if(materialKind){
    const sameKind=works.filter(function(w){return workLinkKind(estimateDisplayName(w)||w.name||"")===materialKind;});
    if(sameKind.length) works=sameKind;
  }

  if(works.length===1) return {work:works[0],reason:materialKind?"тип изделия":"единственная работа раздела"};

  const area=workLinkMaterialArea(material);
  const withLimits=works.map(function(w){return {work:w,limit:workLinkThreshold(w)};}).filter(function(x){return x.limit!=null;});
  if(area!=null&&withLimits.length){
    const eligible=withLimits.filter(function(x){return area<=x.limit+0.03;});
    const pool=(eligible.length?eligible:withLimits).slice().sort(function(a,b){
      if(eligible.length && a.limit!==b.limit) return a.limit-b.limit;
      if(!eligible.length && a.limit!==b.limit) return b.limit-a.limit;
      return Math.abs(Number(a.work.sort_order||0)-Number(material.sort_order||0))-
        Math.abs(Number(b.work.sort_order||0)-Number(material.sort_order||0));
    });
    if(pool.length) return {work:pool[0].work,reason:"площадь "+area.toFixed(2)+" м²"};
  }

  if(materialKind){
    const sameKind=works.filter(function(w){return workLinkKind(estimateDisplayName(w)||w.name||"")===materialKind;});
    if(sameKind.length===1) return {work:sameKind[0],reason:"тип изделия"};
  }

  return null;
}

function workLinkCandidateScore(material,work) {
  let score=0;
  if(work.estimate_id===material.estimate_id) score+=10000;
  if(work.section_id===material.section_id) score+=6000;
  const area=workLinkMaterialArea(material);
  const limit=workLinkThreshold(work);
  if(area!=null&&limit!=null){
    if(area<=limit+0.03) score+=3000-limit*10;
    else score-=3000+(area-limit)*100;
  }
  score-=Math.abs(Number(work.sort_order||0)-Number(material.sort_order||0));
  return score;
}

function workLinkProgress(workRowId) {
  const work=(dataState.estimateRows||[]).find(function(r){return r.id===workRowId;});
  const links=(dataState.estimateWorkLinks||[]).filter(function(l){return l.work_row_id===workRowId;});
  const ids=new Set(links.map(function(l){return l.material_row_id;}));
  const pieces=(dataState.estimateRows||[]).filter(function(r){return ids.has(r.id);})
    .reduce(function(sum,r){return sum+Number(r.quantity||0);},0);
  const expected=work?Number(work.quantity||0)*100:0;
  const delta=pieces-expected;
  return {pieces:pieces,expected:expected,delta:delta,ok:Math.abs(delta)<0.001};
}

function workLinkModal() {
  let modal=document.getElementById("workLinkModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="workLinkModal";
  modal.className="spec-import-backdrop";
  modal.innerHTML=
    '<div class="spec-import-modal work-link-modal">'+
      '<div class="spec-import-head"><div><strong>Сопоставление работ с материалом</strong><span class="work-link-modal-caption">Выберите одну или несколько работ</span></div><button class="spec-import-close" type="button">×</button></div>'+
      '<div class="work-link-source"></div>'+
      '<div class="work-link-candidates"></div>'+
      '<div class="spec-import-foot"><span class="work-link-save-state"></span><span class="spacer"></span><button class="context-link work-link-cancel" type="button">Отмена</button><button class="context-link work-link-save" type="button">Сохранить</button></div>'+
    '</div>';
  document.body.appendChild(modal);
  const close=function(){modal.classList.remove("open");};
  modal.querySelector(".spec-import-close").onclick=close;
  modal.querySelector(".work-link-cancel").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector(".work-link-save").onclick=saveWorkLinks;
  return modal;
}

function openWorkLinkEditor(materialRowId) {
  const material=(dataState.estimateRows||[]).find(function(r){return r.id===materialRowId&&r.row_type==="material";});
  if(!material) return;
  const estimate=(dataState.estimates||[]).find(function(e){return e.id===material.estimate_id;});
  const section=(dataState.estimateSections||[]).find(function(x){return x.id===material.section_id;});
  const current=new Set((dataState.estimateWorkLinks||[]).filter(function(l){return l.material_row_id===material.id;}).map(function(l){return l.work_row_id;}));
  const works=(dataState.estimateRows||[]).filter(function(r){return r.row_type==="work"&&r.estimate_id===material.estimate_id;});
  const ranked=works.map(function(work){
    return {work:work,score:workLinkCandidateScore(material,work)};
  }).sort(function(a,b){
    const ac=current.has(a.work.id),bc=current.has(b.work.id);
    if(ac!==bc) return ac?-1:1;
    return b.score-a.score || Number(a.work.sort_order||0)-Number(b.work.sort_order||0);
  });
  const suggested=ranked.length?ranked.slice().sort(function(a,b){return b.score-a.score;})[0].work.id:"";
  const modal=workLinkModal();
  modal.dataset.materialRowId=material.id;
  modal.querySelector(".work-link-save-state").textContent="";
  modal.querySelector(".work-link-modal-caption").textContent="Смета №"+(estimate?estimate.number:"")+" · "+(section?section.title:"");
  modal.querySelector(".work-link-source").innerHTML=
    '<div class="work-link-source-type">М</div>'+
    '<div><span>Поз. см.</span><strong>'+esc(material.position||"—")+'</strong></div>'+
    '<div><span>Обоснование</span><strong>'+esc(estimateDisplayBasis(material)||"—")+'</strong></div>'+
    '<div class="work-link-source-name"><span>Материал</span><strong>'+esc(estimateDisplayName(material)||"—")+'</strong></div>'+
    '<div><span>Количество</span><strong>'+fmt(material.quantity)+' '+esc(material.unit||"")+'</strong></div>';
  const rows=ranked.map(function(item,index){
    const w=item.work;
    const sec=(dataState.estimateSections||[]).find(function(x){return x.id===w.section_id;});
    const checked=current.has(w.id);
    const progress=workLinkProgress(w.id);
    const label=checked?"Текущая связь":(w.id===suggested?"Предлагаем":"");
    return '<tr class="work-link-candidate'+(w.id===suggested?' suggested':'')+'">'+
      '<td class="center"><input type="checkbox" data-work-link-choice="'+esc(w.id)+'" '+(checked?'checked':'')+'></td>'+
      '<td class="center">'+esc(w.position||"")+'</td>'+
      '<td>'+esc(estimateDisplayBasis(w)||"")+'</td>'+
      '<td>'+esc(estimateDisplayName(w)||"")+(label?'<small class="work-link-note">'+esc(label)+'</small>':'')+'</td>'+
      '<td class="center">'+esc(w.unit||"")+'</td>'+
      '<td class="num">'+fmt(w.quantity)+'</td>'+
      '<td>'+esc(sec?sec.title:"")+'</td>'+
      '<td class="work-link-control '+(progress.ok?'ok':'')+'">'+fmt0(progress.pieces)+' / '+fmt0(progress.expected)+' шт.</td>'+
    '</tr>';
  }).join("");
  modal.querySelector(".work-link-candidates").innerHTML=
    '<div class="work-link-candidate-head"><strong>Работы этой сметы</strong><span>Можно выбрать несколько. Вверху — текущие связи и наиболее вероятная работа.</span></div>'+
    '<div class="work-link-candidate-scroll"><table class="eng-table work-link-candidate-table"><thead><tr><th></th><th>Поз. см.</th><th>Обоснование</th><th>Наименование работы</th><th>Ед. изм.</th><th>Кол-во</th><th>Раздел</th><th>Связано / по смете</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  modal.classList.add("open");
}

async function saveWorkLinks() {
  const modal=workLinkModal();
  const materialId=modal.dataset.materialRowId;
  const selected=new Set(Array.from(modal.querySelectorAll("[data-work-link-choice]:checked")).map(function(x){return x.dataset.workLinkChoice;}));
  const current=(dataState.estimateWorkLinks||[]).filter(function(l){return l.material_row_id===materialId;});
  const currentIds=new Set(current.map(function(l){return l.work_row_id;}));
  const add=Array.from(selected).filter(function(id){return !currentIds.has(id);});
  const remove=current.filter(function(l){return !selected.has(l.work_row_id);});
  const save=modal.querySelector(".work-link-save");
  const state=modal.querySelector(".work-link-save-state");
  save.disabled=true;state.textContent="Сохраняю…";
  try{
    let inserted=[];
    if(add.length){
      const payload=add.map(function(workId){
        return {project_id:dataState.project.id,material_row_id:materialId,work_row_id:workId,link_method:"manual"};
      });
      const result=await client.from("estimate_work_links").insert(payload).select("id,material_row_id,work_row_id,link_method");
      if(result.error) throw result.error;
      inserted=result.data||[];
    }
    if(remove.length){
      const ids=remove.map(function(x){return x.id;});
      const result=await client.from("estimate_work_links").delete().in("id",ids);
      if(result.error) throw result.error;
    }
    const removeIds=new Set(remove.map(function(x){return x.id;}));
    dataState.estimateWorkLinks=(dataState.estimateWorkLinks||[]).filter(function(x){return !removeIds.has(x.id);}).concat(inserted);
    state.textContent="Сохранено";
    modal.classList.remove("open");
    renderPage("links",0);
  }catch(err){
    console.error(err);
    state.textContent="Ошибка: "+(err&&err.message?err.message:String(err));
  }finally{
    save.disabled=false;
  }
}


async function autoMatchWorkLinks() {
  const selectedEstimateIds=new Set((dataState.estimates||[]).filter(function(e){return ui.estimates[e.number]!==false;}).map(function(e){return e.id;}));
  const rowMap=new Map((dataState.estimateRows||[]).map(function(r){return [r.id,r];}));
  const existing=dataState.estimateWorkLinks||[];
  const manualMaterials=new Set(existing.filter(function(l){return l.link_method==="manual";}).map(function(l){return l.material_row_id;}));
  const autoToRemove=existing.filter(function(l){
    if(l.link_method!=="auto") return false;
    const m=rowMap.get(l.material_row_id);
    return m&&selectedEstimateIds.has(m.estimate_id);
  });

  const candidates=[];
  let skippedManual=0,unresolved=0;
  (dataState.estimateRows||[]).forEach(function(material){
    if(material.row_type!=="material"||!selectedEstimateIds.has(material.estimate_id)) return;
    if(manualMaterials.has(material.id)){skippedManual++;return;}
    const match=workLinkAutoCandidate(material);
    if(!match||!match.work){unresolved++;return;}
    candidates.push({
      project_id:dataState.project.id,
      material_row_id:material.id,
      work_row_id:match.work.id,
      link_method:"auto"
    });
  });

  const selectedEstimates=(dataState.estimates||[]).filter(function(e){return selectedEstimateIds.has(e.id);});
  const ok=await executionConfirm(
    "Автосопоставление работ",
    "Будут пересчитаны только автоматические связи по "+selectedEstimates.length+" выбранным сметам. Ручные связи сохранятся. Найдено "+candidates.length+" материалов для автосвязи; без уверенного соответствия: "+unresolved+".",
    "Автосопоставить"
  );
  if(!ok) return;

  const trigger=document.querySelector("[data-work-link-auto]");
  if(trigger) trigger.disabled=true;
  try{
    if(autoToRemove.length){
      const removeIds=autoToRemove.map(function(x){return x.id;});
      const deleteBatchSize=80;
      for(let i=0;i<removeIds.length;i+=deleteBatchSize){
        const result=await client.from("estimate_work_links").delete().in("id",removeIds.slice(i,i+deleteBatchSize));
        if(result.error) throw result.error;
      }
    }
    let inserted=[];
    if(candidates.length){
      const insertBatchSize=200;
      for(let i=0;i<candidates.length;i+=insertBatchSize){
        const result=await client.from("estimate_work_links").insert(candidates.slice(i,i+insertBatchSize)).select("id,material_row_id,work_row_id,link_method");
        if(result.error) throw result.error;
        inserted=inserted.concat(result.data||[]);
      }
    }
    const removedIds=new Set(autoToRemove.map(function(x){return x.id;}));
    dataState.estimateWorkLinks=existing.filter(function(x){return !removedIds.has(x.id);}).concat(inserted);
    ui.workLinkLastAuto={matched:inserted.length,unresolved:unresolved,manual:skippedManual};
    renderPage("links",0);
  }catch(err){
    console.error(err);
    const details=err&&err.details?(" · "+err.details):"";
    const hint=err&&err.hint?(" · "+err.hint):"";
    alert("Автосопоставление не выполнено: "+(err&&err.message?err.message:String(err))+details+hint);
    if(trigger) trigger.disabled=false;
  }
}

async function removeWorkLink(linkId) {
  const link=(dataState.estimateWorkLinks||[]).find(function(x){return x.id===linkId;});
  if(!link) return;
  const result=await client.from("estimate_work_links").delete().eq("id",link.id);
  if(result.error) throw result.error;
  dataState.estimateWorkLinks=(dataState.estimateWorkLinks||[]).filter(function(x){return x.id!==link.id;});
  renderPage("links",0);
}

function renderWorkLinks() {
  if(!ui.workLinkFilter) ui.workLinkFilter="all";
  const selectedEstimateIds=new Set((dataState.estimates||[]).filter(function(e){return ui.estimates[e.number]!==false;}).map(function(e){return e.id;}));
  const rowMap=new Map((dataState.estimateRows||[]).map(function(r){return [r.id,r];}));
  const links=dataState.estimateWorkLinks||[];
  const materialLinks=new Map();
  const workLinks=new Map();

  links.forEach(function(l){
    if(!materialLinks.has(l.material_row_id)) materialLinks.set(l.material_row_id,[]);
    materialLinks.get(l.material_row_id).push(l);
    if(!workLinks.has(l.work_row_id)) workLinks.set(l.work_row_id,[]);
    workLinks.get(l.work_row_id).push(l);
  });

  const search=norm(currentSearch());
  function rowSearchText(row){
    return norm([row.position,estimateDisplayBasis(row),estimateDisplayName(row),row.unit].join(" "));
  }
  function workMatchesSearch(work,linkedMaterials){
    if(!search) return true;
    if(rowSearchText(work).includes(search)) return true;
    return linkedMaterials.some(function(m){return rowSearchText(m).includes(search);});
  }
  function materialMatchesSearch(material){
    return !search || rowSearchText(material).includes(search);
  }
  function controlHtml(work){
    const p=workLinkProgress(work.id);
    const delta=Math.round((p.delta||0)*1000)/1000;
    let cls="ok",tail=" · совпадает";
    if(delta>0){cls="over";tail=" · +"+fmt0(delta);}
    else if(delta<0){cls="under";tail=" · −"+fmt0(Math.abs(delta));}
    return '<span class="work-link-control '+cls+'">'+fmt0(p.pieces)+' / '+fmt0(p.expected)+' шт.'+tail+'</span>';
  }

  ui.currentGroupKeys=[];
  let body="";

  (dataState.estimates||[]).filter(function(e){return selectedEstimateIds.has(e.id);}).forEach(function(e){
    const estimateRows=(dataState.estimateRows||[]).filter(function(r){return r.estimate_id===e.id;});
    const sections=(dataState.estimateSections||[]).filter(function(sec){return sec.estimate_id===e.id;});
    let estimateBody="";

    sections.forEach(function(sec){
      const works=estimateRows.filter(function(r){return r.section_id===sec.id&&r.row_type==="work";})
        .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
      const materials=estimateRows.filter(function(r){return r.section_id===sec.id&&r.row_type==="material";})
        .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
      const unmatched=materials.filter(function(m){return !(materialLinks.get(m.id)||[]).length && materialMatchesSearch(m);});

      let sectionBody="";
      if(ui.workLinkFilter!=="unlinked"){
        works.forEach(function(w){
          const wl=workLinks.get(w.id)||[];
          const linkedMaterials=wl.map(function(l){return rowMap.get(l.material_row_id);}).filter(Boolean)
            .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
          const hasLinks=linkedMaterials.length>0;
          if(ui.workLinkFilter==="linked" && !hasLinks) return;
          if(ui.workLinkFilter==="work-unlinked" && hasLinks) return;
          if(!workMatchesSearch(w,linkedMaterials)) return;

          sectionBody+='<tr class="data-row work-link-work-row" data-estimate-row-id="'+esc(w.id)+'">'+
            '<td class="center"><span class="type-mark work">Р</span></td>'+
            '<td class="center">'+esc(w.position||"")+'</td>'+
            '<td>'+esc(estimateDisplayBasis(w)||"")+'</td>'+
            '<td class="work-link-work-name">'+esc(estimateDisplayName(w)||"")+'</td>'+
            '<td class="center"></td><td class="num"></td>'+
            '<td class="center">'+esc(w.unit||"")+'</td>'+
            '<td class="num">'+fmt(w.quantity)+'</td>'+
            '<td>'+controlHtml(w)+'</td>'+
            '<td>'+(hasLinks?'':'<span class="work-link-status warn">Нет материала</span>')+'</td>'+
          '</tr>';

          linkedMaterials.forEach(function(m){
            const link=wl.find(function(x){return x.material_row_id===m.id;});
            const method=link&&link.link_method==="manual"?"ручная":"авто";
            const geometry=workLinkMaterialGeometry(m);
            sectionBody+='<tr class="data-row work-link-material-child" data-estimate-row-id="'+esc(m.id)+'" data-material-id="'+esc(m.catalog_item_id||"")+'" data-material-mark="'+esc(estimateDisplayBasis(m)||"")+'" data-material-name="'+esc(estimateDisplayName(m)||"")+'" title="Двойной щелчок — карточка панели">'+
              '<td class="center"><span class="type-mark">М</span></td>'+
              '<td class="center">'+esc(m.position||"")+'</td>'+
              '<td>'+esc(estimateDisplayBasis(m)||"")+'</td>'+
              '<td class="work-link-material-name" data-material-card-open="'+esc(m.catalog_item_id||"")+'">'+esc(estimateDisplayName(m)||"")+'</td>'+
              '<td class="center work-link-dim">'+(geometry?esc(geometry.label):"—")+'</td>'+
              '<td class="num work-link-area">'+(geometry&&geometry.area!=null?numFmt.format(geometry.area):"—")+'</td>'+
              '<td class="center">'+esc(m.unit||"")+'</td>'+
              '<td class="num">'+fmt(m.quantity)+'</td>'+
              '<td><span class="work-link-method '+(method==="ручная"?"manual":"auto")+'">'+method+'</span></td>'+
              '<td><button class="inline-action" type="button" data-work-link-edit="'+esc(m.id)+'">изменить</button>'+(link?' <span class="action-sep">·</span> <button class="inline-action" type="button" data-work-link-remove="'+esc(link.id)+'">убрать</button>':'')+'</td>'+
            '</tr>';
          });
        });
      }

      if(ui.workLinkFilter==="all" || ui.workLinkFilter==="unlinked"){
        if(unmatched.length){
          const uk="work-links:unmatched:"+sec.id;
          registerGroup(uk);
          sectionBody+='<tr class="group-row group-toggle work-link-unmatched-group" data-group-key="'+esc(uk)+'"><td colspan="10"><span class="group-arrow">'+groupArrow(uk)+'</span>Не сопоставлено · '+unmatched.length+'</td></tr>';
          if(!ui.collapsed.has(uk) && !ui.collapseLeaves){
            unmatched.forEach(function(m){
              const geometry=workLinkMaterialGeometry(m);
              sectionBody+='<tr class="data-row work-link-unmatched-row" data-estimate-row-id="'+esc(m.id)+'" data-material-id="'+esc(m.catalog_item_id||"")+'" data-material-mark="'+esc(estimateDisplayBasis(m)||"")+'" data-material-name="'+esc(estimateDisplayName(m)||"")+'" title="Двойной щелчок — карточка панели">'+
                '<td class="center"><span class="type-mark">М</span></td>'+
                '<td class="center">'+esc(m.position||"")+'</td>'+
                '<td>'+esc(estimateDisplayBasis(m)||"")+'</td>'+
                '<td class="work-link-material-name" data-material-card-open="'+esc(m.catalog_item_id||"")+'">'+esc(estimateDisplayName(m)||"")+'</td>'+
                '<td class="center work-link-dim">'+(geometry?esc(geometry.label):"—")+'</td>'+
                '<td class="num work-link-area">'+(geometry&&geometry.area!=null?numFmt.format(geometry.area):"—")+'</td>'+
                '<td class="center">'+esc(m.unit||"")+'</td>'+
                '<td class="num">'+fmt(m.quantity)+'</td>'+
                '<td><span class="work-link-status warn">Без работы</span></td>'+
                '<td><button class="inline-action" type="button" data-work-link-edit="'+esc(m.id)+'">сопоставить</button></td>'+
              '</tr>';
            });
          }
        }
      }

      if(!sectionBody) return;
      const sk="work-links:section:"+sec.id;
      registerGroup(sk);
      estimateBody+='<tr class="group-row group-toggle group-level-2" data-group-key="'+esc(sk)+'"><td colspan="10"><span class="group-arrow">'+groupArrow(sk)+'</span>'+esc(sec.title)+'</td></tr>';
      if(!ui.collapsed.has(sk) && !ui.collapseLeaves) estimateBody+=sectionBody;
    });

    if(!estimateBody) return;
    const ek="work-links:estimate:"+e.id;
    registerGroup(ek);
    const allMaterials=estimateRows.filter(function(r){return r.row_type==="material";});
    const linkedCount=allMaterials.filter(function(r){return (materialLinks.get(r.id)||[]).length>0;}).length;
    body+='<tr class="group-row group-toggle work-link-estimate-group" data-group-key="'+esc(ek)+'"><td colspan="10"><span class="group-arrow">'+groupArrow(ek)+'</span>'+esc("Смета №"+e.number+" · "+(e.name||""))+' · '+linkedCount+' / '+allMaterials.length+' материалов</td></tr>';
    if(!ui.collapsed.has(ek)) body+=estimateBody;
  });

  if(!body){
    const emptyText=ui.workLinkFilter==="unlinked"
      ?"Материалов без работы по текущему фильтру нет."
      :ui.workLinkFilter==="work-unlinked"
        ?"Работ без материала по текущему фильтру нет."
        :"Нет строк по текущему фильтру.";
    body=tableMessage(emptyText,8);
  }

  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table work-links-table" data-table-key="work-links-v3"><thead><tr><th>Тип</th><th>Поз. см.</th><th>Обоснование</th><th>Наименование</th><th>Размеры, м</th><th>Площадь, м²</th><th>Ед. изм.</th><th>Кол-во</th><th>Связь / контроль</th><th>Действие</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';

  document.querySelectorAll("[data-material-card-open]").forEach(function(cell){
    cell.onclick=function(e){
      e.stopPropagation();
      const row=cell.closest("[data-material-id]");
      if(row) openMaterialCard(row.dataset.materialId||"",row.dataset.materialMark||"",row.dataset.materialName||"");
    };
  });
  document.querySelectorAll("[data-work-link-edit]").forEach(function(btn){
    btn.onclick=function(e){e.stopPropagation();openWorkLinkEditor(btn.dataset.workLinkEdit);};
  });
  document.querySelectorAll("[data-work-link-remove]").forEach(function(btn){
    btn.onclick=function(e){
      e.stopPropagation();
      btn.disabled=true;
      removeWorkLink(btn.dataset.workLinkRemove).catch(function(err){
        console.error(err);
        alert("Не удалось убрать связь: "+(err.message||err));
        btn.disabled=false;
      });
    };
  });
}
