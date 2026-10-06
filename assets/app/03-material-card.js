function materialStats(item) {
  const rows=specJoinedRows().filter(function(r){return item && r.catalog_item_id===item.id;});
  let qty=0,m3=0;const floors=new Map();
  rows.forEach(function(r){
    qty+=r.total;m3+=r.total*r.volumePerPiece;
    r.quantities.forEach(function(v,k){floors.set(k,Number(floors.get(k)||0)+Number(v||0));});
  });
  const est=dataState.estimateRows.filter(function(r){return r.row_type==="material" && item && r.basis===item.mark;});
  return {rows:rows,qty:qty,m3:m3,floors:floors,est:est};
}

function openMaterialCard(id,mark,sourceName) {
  let item=dataState.catalogItems.find(function(x){return x.id===id;});
  if(!item && mark) item=dataState.catalogItems.find(function(x){return x.mark===mark;});
  const sourceOnly=!item;
  if(!item) item={id:"",mark:mark||"Материал",name:sourceName||"Исходная строка без связи"};
  const st=materialStats(sourceOnly?null:item);
  const levels=levelCodes();
  const linkedEstimateRows=sourceOnly?[]:dataState.estimateRows.filter(function(r){
    return r.row_type==="material" && (
      r.catalog_item_id===item.id ||
      dataState.reconciliationLinks.some(function(l){
        if(l.estimate_row_id!==r.id) return false;
        return st.rows.some(function(sr){return sr.id===l.specification_row_id;});
      })
    );
  });
  // Volume per piece is a supplier-price constant.
  // It is never derived from panel dimensions or project geometry.
  const linkedSupplierItemIds=new Set((dataState.supplierPriceLinks||[])
    .filter(function(l){return item.id && l.catalog_item_id===item.id;})
    .map(function(l){return l.supplier_item_id;}));
  const supplierVolumes=Array.from(new Set((dataState.supplierItems||[])
    .filter(function(si){return item.id && (si.catalog_item_id===item.id || linkedSupplierItemIds.has(si.id));})
    .map(function(si){return Number(si.unit_volume_m3||0);})
    .filter(function(v){return v>0;})
    .map(function(v){return v.toFixed(6);})
  )).map(Number);
  const volumePerPiece=supplierVolumes.length===1?supplierVolumes[0]:0;
  const projectM3=st.qty*volumePerPiece;
  const itemSupplyFact=item.id?(supplyFactState().byCatalog.get(item.id)||{pieces:0,m3:0}):{pieces:0,m3:0};
  const suppliedQty=Number(itemSupplyFact.pieces||0);
  const suppliedM3=Number(itemSupplyFact.m3||0);
  const mountedEvents=(dataState.montageEvents||[]).filter(function(x){
    return st.rows.some(function(sr){return sr.id===x.specification_row_id;}) && x.event_type==="fact";
  });
  const mountedQty=mountedEvents.reduce(function(a,x){return a+Number(x.quantity||0);},0);
  const activeVersionByPeriod=new Map();
  (dataState.avrDocuments||[]).forEach(function(doc){
    const versions=versionsForDocument(doc.id);
    const active=versions.find(function(v){return v.state==="signed" || !!v.signed_at;})
      || versions.find(function(v){return v.state==="in_use";})
      || null;
    if(active) activeVersionByPeriod.set(periodKey(doc.period_month),active);
  });
  const activeVersionIds=new Set(Array.from(activeVersionByPeriod.values()).map(function(v){return v.id;}));
  const linkedEstimateRowIds=new Set(linkedEstimateRows.map(function(r){return r.id;}));
  const avrRows=(dataState.avrRows||[]).filter(function(x){
    return activeVersionIds.has(x.version_id) && linkedEstimateRowIds.has(x.estimate_row_id);
  });
  const avrQty=avrRows.reduce(function(a,x){return a+Number(x.quantity||0);},0);
  const avrM3=avrRows.reduce(function(a,x){return a+Number(x.quantity_m3||0);},0);
  const avrAmount=avrRows.reduce(function(a,x){return a+Number(x.amount||0);},0);

  const s29DocsById=new Map((dataState.s29Documents||[]).map(function(d){return [d.id,d];}));
  const effectiveS29Rows=(dataState.s29Rows||[]).filter(function(x){
    if(!item.id || x.catalog_item_id!==item.id) return false;
    const doc=s29DocsById.get(x.document_id);
    return !!(doc && (doc.fixed_at || doc.status==="fixed"));
  });
  const allS29Rows=(dataState.s29Rows||[]).filter(function(x){return item.id && x.catalog_item_id===item.id;});
  const writtenM3=effectiveS29Rows.reduce(function(a,x){return a+Number(x.written_off_m3||0);},0);
  const estimateAmount=linkedEstimateRows.reduce(function(sum,r){
    const c=(dataState.estimateCosts||[]).find(function(x){return x.estimate_row_id===r.id;});
    return sum+Number(c&&c.total_amount||0);
  },0);
  const estimateQty=linkedEstimateRows.reduce(function(sum,r){return sum+Number(r.quantity||0);},0);
  const materialRowIds=new Set(linkedEstimateRows.map(function(r){return r.id;}));
  const linkedWorkIds=new Set((dataState.estimateWorkLinks||[])
    .filter(function(l){return materialRowIds.has(l.material_row_id);})
    .map(function(l){return l.work_row_id;}));
  const linkedWorkRows=(dataState.estimateRows||[]).filter(function(r){return linkedWorkIds.has(r.id);});
  const linkedWorkCosts=linkedWorkRows.map(function(r){
    const cost=(dataState.estimateCosts||[]).find(function(c){return c.estimate_row_id===r.id;})||null;
    const progress=workLinkProgress(r.id);
    const expectedPieces=Number(progress.expected||0);
    const totalAmount=Number(cost&&cost.total_amount||0);
    return {
      row:r,
      cost:cost,
      expectedPieces:expectedPieces,
      unitPerPiece:expectedPieces>0&&totalAmount>0?totalAmount/expectedPieces:null
    };
  });
  const installationUnit=linkedWorkCosts.length && linkedWorkCosts.every(function(x){return x.unitPerPiece!=null;})
    ? linkedWorkCosts.reduce(function(sum,x){return sum+Number(x.unitPerPiece||0);},0)
    : null;
  // Unit figures are shown only when the source has one unambiguous price per piece.
  const unitCosts=linkedEstimateRows.map(function(r){
    return (dataState.estimateCosts||[]).find(function(c){return c.estimate_row_id===r.id;});
  }).filter(Boolean);
  function singleUnitCost(field){
    if(!linkedEstimateRows.length || unitCosts.length!==linkedEstimateRows.length ||
      unitCosts.some(function(c){return Number(c[field]||0)<=0;})) return null;
    const values=Array.from(new Set(unitCosts.map(function(c){return Number(c[field]).toFixed(2);})));
    return values.length===1?Number(values[0]):null;
  }
  const materialUnit=singleUnitCost("materials_unit");
  const transportUnit=singleUnitCost("transport_unit");
  const supplierModel=item.id?supplierPriceModel(item.id,volumePerPiece):null;
  const supplierUnit=supplierModel && supplierModel.singlePrice!=null && supplierModel.state!=="Проверить"
    ?Number(supplierModel.singlePrice):null;
  const cardGeometry=workLinkMaterialGeometry(item)||workLinkMaterialGeometry(linkedEstimateRows[0]||null);
  function unitMoney(value){return value!=null && Number.isFinite(value) && value>0?money(value)+" руб.":"—";}
  const sectionLabel=st.rows.length&&st.rows[0].section?st.rows[0].section.name:"Раздел";
  let modal=document.getElementById("materialCardModal");
  if(!modal){modal=document.createElement("div");modal.id="materialCardModal";modal.className="material-modal-backdrop";document.body.appendChild(modal);}
  modal.innerHTML='<div class="material-card material-v11" role="dialog" aria-modal="true">'+
    '<header class="material-card-head"><button class="material-close" title="Закрыть">×</button><div class="material-section-label">'+esc(sectionLabel)+'</div><div class="material-identity"><strong>'+esc(item.mark)+'</strong><span>'+esc(item.name)+'</span></div></header>'+
    '<nav class="material-tabs"><button class="active" data-mtab="overview">Обзор</button><button data-mtab="projectEstimate">Проект и смета</button><button data-mtab="supplyMontage">Поставка и монтаж</button><button data-mtab="avrS29">АВР и С-29</button><button data-mtab="history">История</button></nav>'+
    '<div class="material-body"></div></div>';
  modal.classList.add("open");
  const materialCard=modal.querySelector(".material-card");
  if(materialCard){
    try{
      const saved=JSON.parse(localStorage.getItem("filimonova.materialCard.position")||"null");
      if(saved&&Number.isFinite(saved.left)&&Number.isFinite(saved.top)){
        const maxLeft=Math.max(0,window.innerWidth-materialCard.offsetWidth);
        const maxTop=Math.max(0,window.innerHeight-Math.min(materialCard.offsetHeight,window.innerHeight-18));
        materialCard.style.position="fixed";
        materialCard.style.left=Math.max(0,Math.min(maxLeft,saved.left))+"px";
        materialCard.style.top=Math.max(0,Math.min(maxTop,saved.top))+"px";
        materialCard.style.right="auto";
        materialCard.style.bottom="auto";
        materialCard.style.margin="0";
        materialCard.style.transform="none";
      }
    }catch(_){}
    const head=materialCard.querySelector(".material-card-head");
    if(head) head.ondblclick=function(e){
      if(e.target.closest("button,input,select,textarea,a,label")) return;
      localStorage.removeItem("filimonova.materialCard.position");
      materialCard.removeAttribute("style");
    };
  }
  function kpi(label,value,sub,cls){return '<div class="mv-kpi '+(cls||"")+'"><div class="mv-kpi-label">'+esc(label)+'</div><div class="mv-kpi-value">'+value+'</div>'+(sub?'<div class="mv-kpi-sub">'+sub+'</div>':'')+'</div>';}
  function block(title,html,extra){return '<section class="mv-block '+(extra||"")+'"><div class="mv-block-title">'+title+'</div>'+html+'</section>';}
  function body(tab){
    const b=modal.querySelector(".material-body");
    const fmt0=value=>numFmt.format(Number(value)||0);
    const fmt=value=>numFmt.format(Number(value)||0);
    if(tab==="overview"){
      const s29Note=allS29Rows.length && !effectiveS29Rows.length
        ?"есть черновик С-29; в итог не включён"
        :"по зафиксированным С-29";
      const exec=block("Исполнение",'<div class="mv-overview-exec">'+
        kpi("Поставлено",fmt0(suppliedQty)+' шт. / '+fmt(suppliedM3)+' м³',st.qty?fmt(suppliedQty/st.qty*100)+'% от проекта · без двойного учёта зелёной ТТН':"")+
        kpi("Смонтировано",fmt0(mountedQty)+' шт. / '+fmt(mountedQty*volumePerPiece)+' м³',st.qty?fmt(mountedQty/st.qty*100)+'% от проекта':"")+
        kpi("Запроцентовано",fmt0(avrQty)+' шт. / '+fmt(avrM3)+' м³',"подписанные / используемые АВР","good")+
        kpi("Списано",fmt(writtenM3)+' м³',s29Note,writtenM3>avrM3?"warn":"")+
      '</div>');
      const project=block("Проект",'<div class="mv-overview-qty">'+
        '<div class="mv-qty"><b>Всего по проекту</b><strong>'+fmt0(st.qty)+' шт.</strong><span>проектная спецификация</span></div>'+
        '<div class="mv-qty"><b>Размеры панели</b><strong>'+(cardGeometry?esc(cardGeometry.label):"—")+'</strong><span>длина × высота × толщина</span></div>'+
        '<div class="mv-qty"><b>Площадь панели</b><strong>'+(cardGeometry&&cardGeometry.area!=null?numFmt.format(cardGeometry.area)+" м²":"—")+'</strong><span>по фактическому контуру панели</span></div>'+
        '<div class="mv-qty"><b>Объём 1 шт.</b><strong>'+(volumePerPiece?fmt(volumePerPiece)+" м³":"—")+'</strong><span>из прайса поставщика · константа</span></div>'+
        '</div>');
      const cost=block("Стоимость",'<div class="mv-cost-grid">'+
        '<div class="mv-cost"><b>Сметная позиция</b><strong>'+(estimateAmount?money(estimateAmount)+" руб.":"—")+'</strong><span>материал + транспорт по связанным строкам</span></div>'+
        '<div class="mv-cost"><b>Запроцентовано</b><strong>'+(avrAmount?money(avrAmount)+" руб.":"—")+'</strong><span>только действующие АВР</span></div>'+
        '<div class="mv-cost"><b>Остаток</b><strong>'+(estimateAmount?money(Math.max(0,estimateAmount-avrAmount))+" руб.":"—")+'</strong><span>по сметной позиции</span></div>'+
        '</div>','mv-mt');
      b.innerHTML='<div class="mv-overview-two">'+exec+project+'</div>'+cost+(sourceOnly?'<div class="mv-note">Исходная строка не связана с проектной номенклатурой. Карточка открыта в source-only режиме.</div>':'');
    } else if(tab==="projectEstimate"){
      const project='<div class="mv-grid2 mv-mb">'+block("Проект",'<div class="mv-kpi2">'+
        kpi("Всего",fmt0(st.qty)+" шт.",volumePerPiece?fmt(projectM3)+" м³":"объём не определён")+
        kpi("Объём 1 шт.",volumePerPiece?fmt(volumePerPiece)+" м³":"—","из прайса поставщика · константа")+'</div>')+
        block("Смета",'<div class="mv-kpi2">'+
        kpi("Количество по смете",estimateQty?fmt(estimateQty)+" шт.":"—","связанные материальные позиции")+
        kpi("Контроль",estimateQty&&Math.abs(estimateQty-st.qty)<1e-9?"Совпадает":(linkedEstimateRows.length?"Проверить":"Нет связи"),linkedEstimateRows.length?"проект ↔ смета":"связь не создана",estimateQty&&Math.abs(estimateQty-st.qty)<1e-9?"good":"warn")+
        '</div>')+'</div>';

      const unitCost=block("Стоимость единицы",
        '<div class="mv-unit-grid">'+
        '<div class="mv-unit"><b>Материал по смете, 1 шт.</b><strong>'+unitMoney(materialUnit)+'</strong><span>сметная составляющая материала</span></div>'+
        '<div class="mv-unit"><b>Транспорт по смете, 1 шт.</b><strong>'+unitMoney(transportUnit)+'</strong><span>сметная составляющая транспорта</span></div>'+
        '<div class="mv-unit"><b>Цена поставщика, 1 шт.</b><strong>'+unitMoney(supplierUnit)+'</strong><span>с НДС · действующий прайс поставщика</span></div>'+
        '<div class="mv-unit"><b>Связанные работы, 1 шт.</b><strong>'+unitMoney(installationUnit)+'</strong><span>'+(linkedWorkRows.length?linkedWorkRows.length+" "+(linkedWorkRows.length===1?"работа":"работы")+" · распределено по количеству панелей":"нет связанной работы")+'</span></div>'+
        '</div>','mv-mb');

      const floors='<div class="mv-floor-wrap"><div class="mv-floor-grid"><div class="head">Секция</div>'+levels.map(function(x){return '<div class="head">'+esc(x)+'</div>';}).join("")+'<div class="head">Всего</div>'+
        buildingSections().map(function(bs){
          return '<div class="rowhead">'+esc(bs)+'</div>'+levels.map(function(code){
            let v=0;st.rows.filter(function(r){return r.section&&r.section.building_section===bs;}).forEach(function(r){v+=Number(r.quantities.get(code)||0);});
            return '<div class="'+(v?"val":"zero")+'">'+(v?fmt0(v):"—")+'</div>';
          }).join("")+'<div class="total">'+fmt0(st.rows.filter(function(r){return r.section&&r.section.building_section===bs;}).reduce(function(s,r){return s+Number(r.total||0);},0))+'</div>';
        }).join("")+'</div></div>';

      const estBody=linkedEstimateRows.map(function(r){
        const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
        const linked=linkedSpecRowsForEstimateRow(r);const q=estimateQuantityPieces(r,linked);
        const accepted=avrRows.filter(function(a){return a.estimate_row_id===r.id;}).reduce(function(s,a){return s+Number(a.quantity||0);},0);
        return '<tr><td class="center">№'+esc(e?e.number:"")+'</td><td class="center">'+esc(r.position)+'</td><td>'+esc(estimateDisplayBasis(r))+'</td><td>'+esc(estimateDisplayName(r))+'</td><td class="center">'+esc(r.unit||"")+'</td><td class="num">'+(q==null?"—":fmt(q))+'</td><td class="num">'+fmt(accepted)+'</td><td class="num">'+(q==null?"—":fmt(Math.max(0,q-accepted)))+'</td><td class="num">'+money(((dataState.estimateCosts||[]).find(function(x){return x.estimate_row_id===r.id;})||{}).total_amount)+'</td></tr>';
      }).join("");

      const workBody=linkedWorkCosts.map(function(x){
        const r=x.row;
        const e=dataState.estimates.find(function(v){return v.id===r.estimate_id;});
        return '<tr><td class="center">№'+esc(e?e.number:"")+'</td><td class="center">'+esc(r.position||"")+'</td><td>'+esc(estimateDisplayBasis(r)||"")+'</td><td>'+esc(estimateDisplayName(r)||"")+'</td><td class="center">'+esc(r.unit||"")+'</td><td class="num">'+fmt(r.quantity)+'</td><td class="num">'+(x.expectedPieces?fmt0(x.expectedPieces):"—")+'</td><td class="num">'+unitMoney(x.unitPerPiece)+'</td></tr>';
      }).join("");

      const names='<div class="mv-source-grid"><div class="mv-source-box"><div class="mv-source-head">Исходные данные сметы</div><div class="mv-props">'+
        '<div class="mv-prop"><b>Исходное обоснование</b><span>'+esc(linkedEstimateRows[0]?estimateSourceValue(linkedEstimateRows[0],"basis"):"—")+'</span></div>'+
        '<div class="mv-prop"><b>Исходное наименование</b><span>'+esc(linkedEstimateRows[0]?estimateSourceValue(linkedEstimateRows[0],"name"):"—")+'</span></div>'+
        '<div class="mv-prop"><b>Источник</b><span>'+(linkedEstimateRows[0]?"Смета №"+esc((dataState.estimates.find(function(e){return e.id===linkedEstimateRows[0].estimate_id;})||{}).number||""):"—")+'</span></div></div></div>'+
        '<div class="mv-source-box"><div class="mv-source-head">Принятые проектные данные</div><div class="mv-props">'+
        '<div class="mv-prop"><b>Марка</b><span>'+esc(item.mark)+'</span></div>'+
        '<div class="mv-prop"><b>Наименование</b><span>'+esc(item.name)+'</span></div>'+
        '<div class="mv-prop"><b>Обозначение</b><span>'+esc(st.rows[0]&&st.rows[0].designation||"—")+'</span></div>'+
        '</div></div></div>';

      b.innerHTML=project+unitCost+
        block('Распределение по этажам <span class="sub">по проектной спецификации</span>',floors,'mv-mb')+
        block("Связанные строки смет",'<div class="mv-table-wrap"><table><thead><tr><th>Смета</th><th>Поз.</th><th>Обоснование</th><th>Наименование</th><th>Ед.</th><th>По смете</th><th>Запроцентовано</th><th>Остаток</th><th>Стоимость</th></tr></thead><tbody>'+(estBody||'<tr><td colspan="9" class="center">Связанных строк сметы нет.</td></tr>')+'</tbody></table></div>','mv-mb')+
        block("Связанные работы",'<div class="mv-table-wrap"><table><thead><tr><th>Смета</th><th>Поз.</th><th>Обоснование</th><th>Наименование</th><th>Ед.</th><th>По смете</th><th>Панелей</th><th>На 1 панель</th></tr></thead><tbody>'+(workBody||'<tr><td colspan="8" class="center">Связанных работ нет.</td></tr>')+'</tbody></table></div>','mv-mb')+
        names;      } else if(tab==="supplyMontage"){
      b.innerHTML=block('Движение материала <span class="sub">поставка — факт без повторного учёта зелёных ТТН</span>','<div class="mv-flow"><div class="mv-flow-card"><b>Требуется по проекту</b><strong>'+fmt0(st.qty)+' шт. / '+fmt(projectM3)+' м³</strong><span>100%</span></div><div class="mv-arrow">→</div><div class="mv-flow-card"><b>Поставлено</b><strong>'+fmt0(suppliedQty)+' шт. / '+fmt(suppliedM3)+' м³</strong><span>'+fmt(st.qty?suppliedQty/st.qty*100:0)+'%</span></div><div class="mv-arrow">→</div><div class="mv-flow-card"><b>Смонтировано</b><strong>'+fmt0(mountedQty)+' шт. / '+fmt(mountedQty*volumePerPiece)+' м³</strong><span>'+fmt(st.qty?mountedQty/st.qty*100:0)+'%</span></div></div>','mv-mb')+
        '<div class="mv-grid2">'+block("Поставка",'<div class="mv-meter-row"><b>Поставлено</b><div class="mv-track"><div class="mv-fill" style="width:'+Math.min(100,st.qty?suppliedQty/st.qty*100:0)+'%"></div></div><div class="mv-meter-val">'+fmt0(suppliedQty)+' / '+fmt0(st.qty)+' шт.</div></div><div class="mv-meter-row"><b>Осталось поставить</b><div></div><div class="mv-meter-val">'+fmt0(Math.max(0,st.qty-suppliedQty))+' шт.</div></div>')+
        block("Монтаж",'<div class="mv-meter-row"><b>Смонтировано</b><div class="mv-track"><div class="mv-fill good" style="width:'+Math.min(100,st.qty?mountedQty/st.qty*100:0)+'%"></div></div><div class="mv-meter-val">'+fmt0(mountedQty)+' / '+fmt0(st.qty)+' шт.</div></div><div class="mv-meter-row"><b>Осталось смонтировать</b><div></div><div class="mv-meter-val">'+fmt0(Math.max(0,st.qty-mountedQty))+' шт.</div></div>')+'</div>';
    } else if(tab==="avrS29"){
      const monthKeys=new Set();
      activeVersionByPeriod.forEach(function(_,key){monthKeys.add(key);});
      (dataState.s29Documents||[]).forEach(function(d){
        if((dataState.s29Rows||[]).some(function(r){return r.document_id===d.id&&r.catalog_item_id===item.id;})) monthKeys.add(periodKey(d.period_month));
      });
      const monthRows=Array.from(monthKeys).sort().map(function(key){
        const version=activeVersionByPeriod.get(key)||null;
        const monthAvr=version?(dataState.avrRows||[]).filter(function(r){
          return r.version_id===version.id&&linkedEstimateRowIds.has(r.estimate_row_id);
        }):[];
        const monthQty=monthAvr.reduce(function(s,r){return s+Number(r.quantity||0);},0);
        const monthM3=monthAvr.reduce(function(s,r){return s+Number(r.quantity_m3||0);},0);
        const monthAmount=monthAvr.reduce(function(s,r){return s+Number(r.amount||0);},0);
        const docs=(dataState.s29Documents||[]).filter(function(d){return periodKey(d.period_month)===key;})
          .sort(function(a,b){return String(b.updated_at||b.created_at||"").localeCompare(String(a.updated_at||a.created_at||""));});
        const fixedDoc=docs.find(function(d){return d.fixed_at||d.status==="fixed";})||null;
        const displayDoc=fixedDoc||docs[0]||null;
        const displayRows=displayDoc?(dataState.s29Rows||[]).filter(function(r){return r.document_id===displayDoc.id&&r.catalog_item_id===item.id;}):[];
        const monthWritten=displayRows.reduce(function(s,r){return s+Number(r.written_off_m3||0);},0);
        const status=[];
        if(version) status.push(version.state==="signed"||version.signed_at?"АВР подписан":"АВР используется");
        else status.push("нет действующего АВР");
        if(displayDoc) status.push(fixedDoc?"С-29 зафиксирован":"С-29 черновик");
        else status.push("нет С-29");
        return {key:key,qty:monthQty,m3:monthM3,amount:monthAmount,written:monthWritten,status:status.join(" · ")};
      });
      const tableBody=monthRows.map(function(r){
        return '<tr><td>'+esc(periodLabel(r.key,false))+'</td><td class="num">'+fmt0(r.qty)+'</td><td class="num">'+fmt(r.m3)+'</td><td class="num">'+money(r.amount)+'</td><td class="num">'+fmt(r.written)+'</td><td class="num">'+fmt(r.m3-r.written)+'</td><td>'+esc(r.status)+'</td></tr>';
      }).join("") || '<tr><td colspan="7" class="center">По позиции пока нет АВР и С-29.</td></tr>';
      b.innerHTML='<div class="mv-grid3 mv-mb">'+
        block("Запроцентовано",'<div class="mv-single"><div class="mv-kpi-value good">'+fmt0(avrQty)+' шт. / '+fmt(avrM3)+' м³</div><div class="mv-kpi-sub">'+(avrAmount?money(avrAmount)+" руб.":"—")+' · действующие АВР</div></div>')+
        block("Списано",'<div class="mv-single"><div class="mv-kpi-value">'+fmt(writtenM3)+' м³</div><div class="mv-kpi-sub">только зафиксированные С-29</div></div>')+
        block("Разница",'<div class="mv-single"><div class="mv-kpi-value '+(writtenM3>avrM3?"warn":"")+'">'+fmt(avrM3-writtenM3)+' м³</div><div class="mv-kpi-sub">АВР − списание</div></div>')+
        '</div>'+
        block("АВР и списание по месяцам",'<div class="mv-table-wrap"><table><thead><tr><th>Месяц</th><th>АВР, шт.</th><th>АВР, м³</th><th>Стоимость АВР</th><th>С-29, м³</th><th>Разница</th><th>Статус источника</th></tr></thead><tbody>'+tableBody+
        '<tr class="mv-total-row"><td><strong>Накопительно</strong></td><td class="num"><strong>'+fmt0(avrQty)+'</strong></td><td class="num"><strong>'+fmt(avrM3)+'</strong></td><td class="num"><strong>'+money(avrAmount)+'</strong></td><td class="num"><strong>'+fmt(writtenM3)+'</strong></td><td class="num"><strong>'+fmt(avrM3-writtenM3)+'</strong></td><td></td></tr>'+
        '</tbody></table></div>');      } else {
      b.innerHTML=block('История материала <span class="sub">изменения данных, связей и источников</span>','<div class="mv-history"><div class="mv-history-row"><div class="mv-history-time">Текущая база</div><div class="mv-history-source">Проект</div><div class="mv-history-text">Карточка собрана из актуальных данных Supabase. История изменений будет показываться только из фактического журнала событий.</div><div class="mv-history-user">Система</div></div></div>');
    }
  }
  body("overview");
  modal.querySelector(".material-close").onclick=function(){modal.classList.remove("open");};
  modal.onclick=function(e){if(e.target===modal) modal.classList.remove("open");};
  modal.querySelectorAll("[data-mtab]").forEach(function(btn){btn.onclick=function(){modal.querySelectorAll("[data-mtab]").forEach(function(x){x.classList.toggle("active",x===btn);});body(btn.dataset.mtab);};});
}

function checkHtml(id,label,checked,group) {
  return '<label class="check"><input type="checkbox" data-filter-group="' + esc(group) + '" data-filter-id="' + esc(id) + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
}
