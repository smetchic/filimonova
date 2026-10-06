function montageSequenceException(row) {
  const name=norm(row&&row.section&&row.section.name||"");
  return name==="ограждение лоджий" || name==="опорные вкладыши";
}

function montageSupplyFactMap() {
  const fact=supplyFactState();
  const result=new Map();
  fact.byCatalog.forEach(function(v,id){result.set(id,Number(v.pieces||0));});
  return result;
}

function montageFactIndex(rows) {
  const joinedById=new Map((rows||specJoinedRows()).map(function(r){return [r.id,r];}));
  const byRowLevel=new Map(),byRowLevelDate=new Map(),byCatalog=new Map();
  (dataState.montageEvents||[]).forEach(function(event){
    if(event.event_type!=="fact") return;
    const qty=Number(event.quantity||0);
    const row=joinedById.get(event.specification_row_id) || specJoinedRows().find(function(r){return r.id===event.specification_row_id;});
    const rl=event.specification_row_id+"|"+event.level_code;
    const rld=rl+"|"+String(event.event_date).slice(0,10);
    byRowLevel.set(rl,Number(byRowLevel.get(rl)||0)+qty);
    byRowLevelDate.set(rld,Number(byRowLevelDate.get(rld)||0)+qty);
    if(row&&row.catalog_item_id) byCatalog.set(row.catalog_item_id,Number(byCatalog.get(row.catalog_item_id)||0)+qty);
  });
  return {byRowLevel:byRowLevel,byRowLevelDate:byRowLevelDate,byCatalog:byCatalog};
}

function montagePreviousFloorState(row,level,index,allRows) {
  if(montageSequenceException(row) || !/^\d+$/.test(String(level)) || Number(level)<=1) return {locked:false};
  const prev=String(Number(level)-1);
  const bs=row.section&&row.section.building_section;
  const relevant=(allRows||specJoinedRows()).filter(function(r){
    return r.section&&r.section.building_section===bs && !montageSequenceException(r) && qtyAt(r,prev)>0;
  });
  const plan=relevant.reduce(function(sum,r){return sum+qtyAt(r,prev);},0);
  const mounted=relevant.reduce(function(sum,r){return sum+Number(index.byRowLevel.get(r.id+"|"+prev)||0);},0);
  return {
    locked:plan>0&&mounted+1e-9<plan,
    previous:prev,
    plan:plan,
    mounted:mounted
  };
}

function montageMonthDays(period) {
  const parts=String(period||"").split("-");
  const year=Number(parts[0]),month=Number(parts[1]);
  if(!(year>2000&&month>=1&&month<=12)) return [];
  const count=new Date(year,month,0).getDate();
  return Array.from({length:count},function(_,i){return i+1;});
}

function montageDate(period,day) {
  return String(period)+"-"+String(day).padStart(2,"0");
}

function renderMontage(tab) {
  if (tab === 1) {
    $("workArea").className = "work-area content-work";
    $("workArea").innerHTML = '<div class="review-panel"><div class="review-panel-title">3D модель</div><div class="review-note">Требует разработки. Формат модели, камера, размещение и инструменты редактирования пока не определены.</div></div>';
    return;
  }

  if(!ui.montage.period){
    const now=new Date();
    ui.montage.period=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  }
  const level=ui.montage.level||"1";
  const period=ui.montage.period;
  const days=montageMonthDays(period);
  const allRows=specJoinedRows();
  const fact=montageFactIndex(allRows);
  const delivered=montageSupplyFactMap();

  let rows=allRows.filter(function(r){
    const bs=r.section&&r.section.building_section;
    if(!buildingSections().includes(bs)||!montageSectionOn(bs)) return false;
    if(qtyAt(r,level)<=0) return false;
    return passesSearch([r.position_no,r.mark,r.name,r.section&&r.section.name]) &&
      rowPassesColumnFilters({mark:r.mark,name:r.name});
  }).sort(function(a,b){return Number(a.position_no||0)-Number(b.position_no||0);});

  let body="";
  rows.forEach(function(r){
    const plan=qtyAt(r,level);
    const mounted=Number(fact.byRowLevel.get(r.id+"|"+level)||0);
    const remaining=Math.max(0,plan-mounted);
    const supplied=Number(delivered.get(r.catalog_item_id)||0);
    const installedCatalog=Number(fact.byCatalog.get(r.catalog_item_id)||0);
    const available=Math.max(0,supplied-installedCatalog);
    const floorState=montagePreviousFloorState(r,level,fact,allRows);
    const lockReason=floorState.locked
      ?"Уровень "+level+" заблокирован: уровень "+floorState.previous+" секции ещё не завершён ("+exFmt0(floorState.mounted)+" из "+exFmt0(floorState.plan)+")."
      : remaining<=0
        ?"Проектное количество на уровне уже смонтировано."
        : available<1
          ?"Нет физически доступных поставленных изделий этой номенклатуры."
          :MONTAGE_CLICK_HINT;

    body+='<tr class="data-row montage-data-row'+(floorState.locked?' montage-floor-locked':'')+'" data-material-id="'+esc(r.catalog_item_id||"")+'" data-spec-row-id="'+esc(r.id)+'">'+
      '<td class="sticky-1 center">'+esc(r.position_no)+'</td>'+
      filterCell("mark",r.mark,esc(r.mark),"sticky-2")+
      filterCell("name",r.name,esc(r.name),"sticky-3")+
      '<td class="num">'+exFmt0(plan)+'</td>'+
      '<td class="num montage-mounted-cell">'+exFmt0(mounted)+'</td>'+
      '<td class="num">'+exFmt0(remaining)+'</td>'+
      '<td class="num">'+exFmt0(supplied)+'</td>'+
      '<td class="num montage-available-cell '+(available>0?'has-stock':'no-stock')+'">'+exFmt0(available)+'</td>'+
      days.map(function(day){
        const date=montageDate(period,day);
        const value=Number(fact.byRowLevelDate.get(r.id+"|"+level+"|"+date)||0);
        const plusBlocked=floorState.locked||remaining<=0||available<1;
        return '<td class="day-cell montage-day'+(value>0?' has-fact':'')+(plusBlocked?' plus-locked':'')+'"'+
          ' data-montage-spec-row="'+esc(r.id)+'" data-montage-date="'+date+'" data-montage-value="'+value+'"'+
          ' title="'+esc(lockReason)+'">'+(value?exFmt0(value):"")+'</td>';
      }).join("")+
    '</tr>';
  });

  if (!body) body=tableMessage("На выбранном уровне нет позиций по текущему фильтру.",8+days.length);

  $("workArea").className="work-area table-work montage-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table montage-table" data-table-key="montage-calendar-v2"><thead><tr>'+
    '<th class="sticky-1">№</th>'+
    '<th class="sticky-2 filterable-head">'+filterHeader("Марка","mark")+'</th>'+
    '<th class="sticky-3 filterable-head">'+filterHeader("Наименование","name")+'</th>'+
    '<th><span class="column-header-stack"><span>На</span><span>этаж</span></span></th>'+
    '<th><span class="column-header-stack"><span>Смонти-</span><span>ровано</span></span></th>'+
    '<th>Остаток</th>'+
    '<th>Поставлено</th>'+
    '<th><span class="column-header-stack"><span>Доступно для</span><span>монтажа</span></span></th>'+
    days.map(function(d){return '<th class="day-cell">'+d+'</th>';}).join("")+
    '</tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

const MONTAGE_CLICK_HINT="Щелчок по дню добавляет 1 шт., правый щелчок убирает 1 шт.";

// A click changes the fact at once, so every change offers an undo for a few seconds.
let montageUndoTimer=null;
function showMontageUndo(cell,delta) {
  const old=document.querySelector(".montage-undo");
  if(old) old.remove();
  if(montageUndoTimer){clearTimeout(montageUndoTimer);montageUndoTimer=null;}
  const row=cell.closest("tr");
  const mark=row&&row.cells[1]?row.cells[1].textContent.trim():"";
  const date=cell.dataset.montageDate.split("-").reverse().slice(0,2).join(".");
  const specRowId=cell.dataset.montageSpecRow, eventDate=cell.dataset.montageDate, level=ui.montage.level;
  const bar=document.createElement("div");
  bar.className="montage-undo";
  bar.setAttribute("role","status");
  bar.innerHTML='<span>'+esc((delta>0?"Добавлено":"Убрано")+" 1 шт.: "+mark+", уровень "+level+", "+date)+'</span><button type="button">Отменить</button>';
  document.body.appendChild(bar);
  function close(){bar.remove();if(montageUndoTimer){clearTimeout(montageUndoTimer);montageUndoTimer=null;}}
  bar.querySelector("button").onclick=async function(){
    const btn=this;
    btn.disabled=true;
    try{
      await adjustMontageFact(specRowId,eventDate,-delta,level);
      close();
      rerenderContent();
    }catch(err){
      btn.disabled=false;
      alert("Не удалось отменить:\n"+(err&&err.message?err.message:String(err)));
    }
  };
  montageUndoTimer=setTimeout(close,8000);
}

async function adjustMontageFact(specificationRowId,eventDate,delta,levelCode) {
  const result=await client.rpc("adjust_montage_fact",{
    p_project_id:dataState.project.id,
    p_specification_row_id:specificationRowId,
    p_level_code:levelCode||ui.montage.level,
    p_event_date:eventDate,
    p_delta:delta
  });
  if(result.error) throw result.error;
  await refreshProjectDataSlices(["montageEvents"],dataState.project);
}

function wireMontageControls() {
  if(ui.page!=="montage" || (ui.tabs.montage||0)!==0) return;
  document.querySelectorAll("[data-montage-spec-row]").forEach(function(cell){
    async function apply(delta){
      if(cell.classList.contains("montage-busy")) return;
      if(delta>0 && cell.classList.contains("plus-locked")){
        alert(cell.title||"Монтаж сейчас недоступен.");
        return;
      }
      if(delta<0 && Number(cell.dataset.montageValue||0)<=0) return;
      cell.classList.add("montage-busy");
      try{
        await adjustMontageFact(cell.dataset.montageSpecRow,cell.dataset.montageDate,delta);
        showMontageUndo(cell,delta);
        rerenderContent();
      }catch(err){
        alert("Монтаж не изменён:\n"+(err&&err.message?err.message:String(err)));
        cell.classList.remove("montage-busy");
      }
    }
    cell.onclick=function(e){e.preventDefault();e.stopPropagation();apply(1);};
    cell.oncontextmenu=function(e){e.preventDefault();e.stopPropagation();apply(-1);};
  });
}
