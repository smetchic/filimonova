function rowCost(row,m) {
  return m.costs.get(row.id) || {
    salary_unit:0,salary_amount:0,machines_unit:0,machines_amount:0,
    materials_unit:0,materials_amount:0,transport_unit:0,transport_amount:0,total_unit:0,total_amount:0
  };
}

function estimateGroupVector(rows,m) {
  const qty = sameUnitTotal(rows,function(r){return r.unit;},function(r){return r.quantity;});
  let salary = 0, machines = 0, materials = 0, transport = 0, total = 0;
  rows.forEach(function(r) {
    const c = rowCost(r,m);
    salary += Number(c.salary_amount || 0);
    machines += Number(c.machines_amount || 0);
    materials += Number(c.materials_amount || 0);
    transport += Number(c.transport_amount || 0);
    total += Number(c.total_amount || 0);
  });
  return {qty:qty,salary:salary,machines:machines,materials:materials,transport:transport,total:total};
}

function estimateGroupRow(label,rows,key,depth,m) {
  registerGroup(key);
  const v = estimateGroupVector(rows,m);
  let html = '<tr class="' + groupRowClass(key,depth) + '" data-group-key="' + esc(key) + '">';
  html += '<td colspan="4" class="est-group-title" style="padding-left:' + (8+depth*14) + 'px"><span class="group-arrow">' + groupArrow(key) + '</span>' + esc(label) + '</td>';
  html += '<td></td><td class="num">' + (v.qty===null ? '' : fmt(v.qty)) + '</td><td class="num"></td>';
  html += '<td></td><td class="num">' + money(v.salary) + '</td>';
  html += '<td></td><td class="num">' + money(v.machines) + '</td>';
  html += '<td></td><td class="num">' + money(v.materials) + '</td>';
  html += '<td></td><td class="num">' + money(v.transport) + '</td>';
  html += '<td></td><td class="num strong-num">' + money(v.total) + '</td>';
  html += '</tr>';
  return html;
}

function estimateProjectItem(row) {
  return row && row.catalog_item_id
    ? maps().catalog.get(row.catalog_item_id) || null
    : null;
}

function estimateSourceValue(row,key) {
  return row && row.source_original && row.source_original[key]!=null
    ? row.source_original[key]
    : row && row[key]!=null ? row[key] : "";
}

function estimateDisplayBasis(row) {
  const item=estimateProjectItem(row);
  return row.row_type==="material" && item ? item.mark : row.basis;
}

function estimateDisplayName(row) {
  const item=estimateProjectItem(row);
  return row.row_type==="material" && item ? item.name : row.name;
}

function renderEstimateTable() {
  const m = maps();
  const selected = dataState.estimates.filter(function(e){ return ui.estimates[e.number] !== false; });
  ui.currentGroupKeys = [];
  let body = "";

  selected.forEach(function(e) {
    let rows = dataState.estimateRows.filter(function(r){ return r.estimate_id === e.id; });
    rows = rows.filter(function(r){
      return passesSearch([r.position,estimateDisplayBasis(r),estimateDisplayName(r),r.basis,r.name]);
    }).filter(function(r){
      return rowPassesColumnFilters({
        position:r.position,
        basis:estimateDisplayBasis(r),
        name:estimateDisplayName(r)
      });
    });
    rows = sortRows(rows,{
      position:function(r){return r.position;},
      basis:function(r){return estimateDisplayBasis(r);},
      name:function(r){return estimateDisplayName(r);}
    });
    if (!sortBucket()) rows.sort(function(a,b){ return Number(a.sort_order||0)-Number(b.sort_order||0); });
    if (!rows.length && (currentSearch() || Object.keys(filterBucket()).length)) return;

    const eKey = "est:estimate:"+e.number;
    body += estimateGroupRow("Смета №"+e.number+" · "+(e.name||""),rows,eKey,0,m);
    if (ui.collapsed.has(eKey)) return;

    const sections = dataState.estimateSections.filter(function(sec){ return sec.estimate_id === e.id; });
    sections.forEach(function(sec) {
      const sRows = rows.filter(function(r){ return r.section_id === sec.id; });
      if (!sRows.length) return;
      const sKey = "est:section:"+e.number+":"+sec.id;
      body += estimateGroupRow(sec.title,sRows,sKey,1,m);
      if (ui.collapsed.has(sKey) || ui.collapseLeaves) return;

      sRows.forEach(function(r) {
        const c = rowCost(r,m);
        const item=estimateProjectItem(r);
        const displayBasis=estimateDisplayBasis(r);
        const displayName=estimateDisplayName(r);
        body += '<tr class="data-row" data-row-type="'+esc(r.row_type||"")+'" data-estimate-row-id="'+esc(r.id)+'" ' +
          (r.row_type==="material" ? 'data-material-id="'+esc(item?item.id:"")+'" data-material-mark="'+esc(displayBasis||"")+'"' : '') + '>';
        body += '<td class="e-sticky-1 center"><span class="type-mark">' + (r.row_type === "work" ? "Р" : "М") + '</span></td>';
        body += filterCell("position",r.position,esc(r.position || ""),"e-sticky-2 center");
        body += filterCell("basis",displayBasis,esc(displayBasis || ""),"e-sticky-3");
        body += filterCell("name",displayName,esc(displayName || ""),"e-sticky-4");
        body += '<td class="center estimate-unit-cell" title="'+esc(r.unit||"")+'">' + esc(r.unit || "") + '</td>';
        body += '<td class="num">' + fmt(r.quantity) + '</td>';
        body += '<td class="num"></td>';
        body += '<td class="num">' + money(c.salary_unit) + '</td><td class="num">' + money(c.salary_amount) + '</td>';
        body += '<td class="num">' + money(c.machines_unit) + '</td><td class="num">' + money(c.machines_amount) + '</td>';
        body += '<td class="num">' + money(c.materials_unit) + '</td><td class="num">' + money(c.materials_amount) + '</td>';
        body += '<td class="num">' + money(c.transport_unit) + '</td><td class="num">' + money(c.transport_amount) + '</td>';
        body += '<td class="num">' + money(c.total_unit) + '</td><td class="num strong-num">' + money(c.total_amount) + '</td>';
        body += '</tr>';
      });
    });
  });

  if (!body) body = tableMessage("Нет строк по текущему фильтру.",17);

  const head = '<thead>' +
    '<tr>' +
      '<th class="e-sticky-1" rowspan="2">Тип</th>' +
      '<th class="e-sticky-2" rowspan="2"><span class="column-header-stack"><span>Поз.</span><span>см.</span></span></th>' +
      '<th class="e-sticky-3 filterable-head" rowspan="2">' + filterHeader("Обоснование","basis") + '</th>' +
      '<th class="e-sticky-4 filterable-head" rowspan="2">' + filterHeader("Наименование","name") + '</th>' +
      '<th rowspan="2"><span class="column-header-stack"><span>Ед.</span><span>изм.</span></span></th>' +
      '<th rowspan="2">Количество</th>' +
      '<th rowspan="2">Остаток по смете</th>' +
      '<th colspan="2">Зарплата</th>' +
      '<th colspan="2">Машины</th>' +
      '<th colspan="2">Материалы</th>' +
      '<th colspan="2">Транспорт</th>' +
      '<th colspan="2">Всего</th>' +
    '</tr>' +
    '<tr><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th></tr>' +
  '</thead>';

  $("workArea").className = "work-area table-work";
  $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table est-table" data-table-key="estimate-main-v6">' + head + '<tbody>' + body + '</tbody></table></div></div>';
}

// Прогнозный индекс один на объект и хранится в current_price_settings;
// пока строки нет, действует предварительный 1,0647.
const DEFAULT_FORECAST_INDEX=1.0647;
function savedForecastIndex() {
  const row=(dataState.currentPriceSettings||[])[0];
  const v=row?Number(row.forecast_index):NaN;
  return Number.isFinite(v)&&v>0?v:DEFAULT_FORECAST_INDEX;
}
function currentPriceParams() {
  if(!ui.currentPrice) ui.currentPrice={competition:1,vat:0};
  ui.currentPrice.forecast=savedForecastIndex();
  return ui.currentPrice;
}
async function saveForecastIndex(value) {
  const result=await client.from("current_price_settings").upsert({project_id:dataState.project.id,forecast_index:value},{onConflict:"project_id"}).select("project_id,forecast_index");
  if(result.error) throw result.error;
  dataState.currentPriceSettings=result.data||[];
  invalidateDerivedDataCache();
}

function currentPriceModel() {
  const P=currentPriceParams(),m=maps();
  const selectedIds=new Set(dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;}).map(function(e){return e.id;}));
  const base={salary:0,machines:0,drivers:0,transport:0,materials:0};
  dataState.estimateRows.filter(function(r){return selectedIds.has(r.estimate_id);}).forEach(function(r){
    const c=rowCost(r,m);
    base.salary+=Number(c.salary_amount||0);
    base.machines+=Number(c.machines_amount||0);
    base.drivers+=Number(c.drivers_amount||0);
    base.transport+=Number(c.transport_amount||0);
    base.materials+=Number(c.materials_amount||0);
  });
  const wageBase=base.salary+base.drivers;
  const direct=base.salary+base.machines+base.transport+base.materials;
  const ohr=wageBase*1.0931,profit=wageBase*1.0563,temp=wageBase*.037*.93,winter=wageBase*.025740*.93;
  const works=direct+ohr+profit+temp+winter,soc=wageBase*.34,travel=0,other=soc+travel,totalWorks=works+other,ret=-temp*.15;
  const contractor=totalWorks+ret,afterCompetition=contractor*P.competition,afterForecast=afterCompetition*P.forecast,vat=afterForecast*(P.vat/100),grand=afterForecast+vat;
  return [
    {id:"salary",name:"Заработная плата",kind:"input",v:base.salary},
    {id:"machines",name:"Эксплуатация машин и механизмов",kind:"input",v:base.machines},
    {id:"drivers",name:"Заработная плата машинистов",kind:"input",v:base.drivers},
    {id:"transport",name:"Транспортные расходы подрядчика",kind:"input",v:base.transport},
    {id:"materials",name:"Материалы подрядчика",kind:"input",v:base.materials},
    {id:"direct",name:"Итого прямые затраты",kind:"subtotal",v:direct,refs:["salary","machines","transport","materials"],formula:"Заработная плата + Машины + Транспорт + Материалы"},
    {id:"ohr",name:"Общехозяйственные и общепроизводственные расходы",kind:"formula",pct:109.31,v:ohr,refs:["salary","drivers","ohr:pct"],formula:"(Заработная плата + ЗП машинистов) × 109,31%"},
    {id:"profit",name:"Плановая прибыль",kind:"formula",pct:105.63,v:profit,refs:["salary","drivers","profit:pct"],formula:"(Заработная плата + ЗП машинистов) × 105,63%"},
    {id:"temporary",name:"Временные здания и сооружения",kind:"formula",pct:3.7,k:.93,v:temp,refs:["salary","drivers","temporary:pct","temporary:k"],formula:"(Заработная плата + ЗП машинистов) × 3,70% × 0,93"},
    {id:"winter",name:"Дополнительные средства при производстве СМР в зимнее время",kind:"formula",pct:2.574,k:.93,v:winter,refs:["salary","drivers","winter:pct","winter:k"],formula:"(Заработная плата + ЗП машинистов) × 2,5740% × 0,93"},
    {id:"works",name:"Итого строительных и иных специальных монтажных работ",kind:"subtotal",v:works,refs:["direct","ohr","profit","temporary","winter"],formula:"Прямые затраты + ОХР + Плановая прибыль + Временные + Зимние"},
    {id:"otherGroup",name:"Прочие затраты",kind:"group"},
    {id:"soc",name:"Затраты, связанные с отчислениями на социальное страхование",kind:"formula",pct:34,v:soc,refs:["salary","drivers","soc:pct"],formula:"(Заработная плата + ЗП машинистов) × 34%"},
    {id:"travel",name:"Средства, связанные с подвижным и разъездным характером работ",kind:"formula",pct:0,v:travel,refs:["salary","drivers","travel:pct"],formula:"(Заработная плата + ЗП машинистов) × 0%"},
    {id:"other",name:"Итого прочие затраты",kind:"subtotal",v:other,refs:["soc","travel"],formula:"Социальное страхование + разъездной характер"},
    {id:"totalWorks",name:"Всего строительных и иных специальных монтажных работ",kind:"subtotal",v:totalWorks,refs:["works","other"],formula:"Итого СМР + прочие затраты"},
    {id:"returnTemp",name:"Возврат от временных зданий и сооружений",kind:"formula",pct:15,v:ret,refs:["temporary","returnTemp:pct"],formula:"− Временные здания и сооружения × 15%"},
    {id:"contractor",name:"Итого подрядных работ",kind:"subtotal",v:contractor,refs:["totalWorks","returnTemp"],formula:"Всего СМР + возврат от временных"},
    {id:"competitionK",name:"Конкурсный коэффициент",kind:"parameter",k:P.competition},
    {id:"afterCompetition",name:"Итого с учётом конкурсного коэффициента",kind:"subtotal",v:afterCompetition,refs:["contractor","competitionK:k"],formula:"Итого подрядных работ × конкурсный коэффициент"},
    {id:"forecastK",name:"Прогнозный индекс",kind:"parameter",k:P.forecast,editable:true},
    {id:"afterForecast",name:"Итого с учётом прогнозного индекса",kind:"subtotal",v:afterForecast,refs:["afterCompetition","forecastK:k"],formula:"Итого с конкурсным коэффициентом × прогнозный индекс"},
    {id:"vat",name:"НДС",kind:"formula",pct:P.vat,v:vat,refs:["afterForecast","vat:pct"],formula:"Итого с прогнозным индексом × НДС"},
    {id:"grand",name:"Всего с НДС",kind:"final",v:grand,refs:["afterForecast","vat"],formula:"Итого с прогнозным индексом + НДС"}
  ];
}

function currentRefValue(row,mode) {
  if(row.v==null || ["competitionK","afterCompetition","forecastK","afterForecast","vat","grand"].includes(row.id)) return "";
  const P=currentPriceParams();
  if(mode==="forecast") return money(row.v*P.forecast);
  if(mode==="competition") return money(row.v*P.competition);
  return money(row.v*P.competition*P.forecast);
}

function currentFormulaParts(r) {
  const P=currentPriceParams();
  const parts={
    direct:["=",{r:"salary",t:"Заработная плата"}," + ",{r:"machines",t:"Эксплуатация машин и механизмов"}," + ",{r:"transport",t:"Транспортные расходы подрядчика"}," + ",{r:"materials",t:"Материалы подрядчика"}],
    ohr:["=(",{r:"salary",t:"Заработная плата"}," + ",{r:"drivers",t:"Заработная плата машинистов"},") × ",{r:"ohr:pct",t:"109,31%"}],
    profit:["=(",{r:"salary",t:"Заработная плата"}," + ",{r:"drivers",t:"Заработная плата машинистов"},") × ",{r:"profit:pct",t:"105,63%"}],
    temporary:["=(",{r:"salary",t:"Заработная плата"}," + ",{r:"drivers",t:"Заработная плата машинистов"},") × ",{r:"temporary:pct",t:"3,70%"}," × ",{r:"temporary:k",t:"0,93"}," = 3,441% базы"],
    winter:["=(",{r:"salary",t:"Заработная плата"}," + ",{r:"drivers",t:"Заработная плата машинистов"},") × ",{r:"winter:pct",t:"2,5740%"}," × ",{r:"winter:k",t:"0,93"}," = 2,394% базы"],
    works:["=",{r:"direct",t:"Итого прямые затраты"}," + ",{r:"ohr",t:"Общехозяйственные и общепроизводственные расходы"}," + ",{r:"profit",t:"Плановая прибыль"}," + ",{r:"temporary",t:"Временные здания и сооружения"}," + ",{r:"winter",t:"Дополнительные средства в зимнее время"}],
    soc:["=(",{r:"salary",t:"Заработная плата"}," + ",{r:"drivers",t:"Заработная плата машинистов"},") × ",{r:"soc:pct",t:"34%"}],
    travel:["=(",{r:"salary",t:"Заработная плата"}," + ",{r:"drivers",t:"Заработная плата машинистов"},") × ",{r:"travel:pct",t:"0%"}],
    other:["=",{r:"soc",t:"Затраты на социальное страхование"}," + ",{r:"travel",t:"Средства, связанные с подвижным и разъездным характером работ"}],
    totalWorks:["=",{r:"works",t:"Итого строительных и иных специальных монтажных работ"}," + ",{r:"other",t:"Итого прочие затраты"}],
    returnTemp:["=−",{r:"temporary",t:"Временные здания и сооружения"}," × ",{r:"returnTemp:pct",t:"15%"}],
    contractor:["=",{r:"totalWorks",t:"Всего строительных и иных специальных монтажных работ"}," + ",{r:"returnTemp",t:"Возврат от временных зданий и сооружений"}],
    afterCompetition:["=",{r:"contractor",t:"Итого подрядных работ"}," × ",{r:"competitionK:k",t:Number(P.competition||1).toFixed(4).replace(".",",")}],
    afterForecast:["=",{r:"afterCompetition",t:"Итого с учётом конкурсного коэффициента"}," × ",{r:"forecastK:k",t:Number(P.forecast).toFixed(4).replace(".",",")}],
    vat:["=",{r:"afterForecast",t:"Итого с учётом прогнозного индекса"}," × ",{r:"vat:pct",t:String(P.vat||0).replace(".",",")+"%"}],
    grand:["=",{r:"afterForecast",t:"Итого с учётом прогнозного индекса"}," + ",{r:"vat",t:"НДС"}]
  };
  return parts[r.id] || [];
}

function currentFormulaHtml(r) {
  const refs=r.refs||[];
  const colors=["formula-c1","formula-c2","formula-c3","formula-c4"];
  return currentFormulaParts(r).map(function(x){
    if(typeof x==="string") return esc(x);
    const idx=Math.max(0,refs.indexOf(x.r));
    return '<span class="formula-token '+colors[idx%4]+'">'+esc(x.t)+'</span>';
  }).join("");
}

function renderCurrentPricePlaceholder() {
  const model=currentPriceModel();
  let rows=model.filter(function(r){return r.kind==="group" || passesSearch([r.name]);})
    .filter(function(r){return r.kind==="group" || rowPassesColumnFilters({name:r.name});});
  let no=0;
  let body=rows.map(function(r){
    if(r.kind==="group") return '<tr class="group-only"><td class="center"></td><td colspan="7">'+esc(r.name)+'</td></tr>';
    no++;
    const cls=r.kind==="subtotal"?"subtotal":r.kind==="final"?"final":"";
    const pct=r.pct==null?"":String(r.id==="winter"?"2,5740":r.pct).replace(".",",");
    let k="";
    if(r.id==="forecastK") k='<input class="forecast-input" value="'+savedForecastIndex().toFixed(4).replace(".",",")+'" aria-label="Прогнозный индекс"'+(ui.isAdmin?'':' readonly title="Индекс меняет администратор"')+'>';
    else if(r.k!=null) k=Number(r.k).toFixed(4).replace(".",",");
    return '<tr class="'+cls+' data-row" data-formula-row="'+r.id+'" data-current-row-no="'+no+'"><td class="center">'+no+'</td>'+filterCell("name",r.name,esc(r.name),"")+'<td class="num" data-formula-cell="'+r.id+':pct">'+pct+'</td><td class="num rate-cell" data-formula-cell="'+r.id+':k">'+k+'</td><td class="num formula-amount" data-formula-cell="'+r.id+'">'+money(r.v)+'</td><td class="num muted">'+currentRefValue(r,"forecast")+'</td><td class="num muted">'+currentRefValue(r,"competition")+'</td><td class="num muted">'+currentRefValue(r,"both")+'</td></tr>';
  }).join("");
  body+=Array.from({length:6},function(){
    return '<tr class="current-price-empty-row" aria-hidden="true"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  }).join("");
  $("workArea").className="work-area table-work current-price-work";
  $("workArea").innerHTML='<div class="formula-strip"><div class="formula-address">—</div><div class="formula-controls" aria-hidden="true"><span class="formula-cancel">×</span><span class="formula-accept">✓</span><b class="formula-fx">fx</b></div><div class="formula-expression"><span class="formula-placeholder">Выберите расчётную строку</span></div></div>'+
    '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table current-price-table" data-table-key="current-price-v2"><thead><tr><th rowspan="2">№</th><th class="filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th><th rowspan="2">%</th><th rowspan="2">К-т</th><th rowspan="2">Текущая стоимость</th><th colspan="3">Справочно</th></tr><tr><th>с прогнозным</th><th>с конкурсным</th><th>с прогнозным и конкурсным</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  const byId=new Map(model.map(function(x){return [x.id,x];}));
  function select(id){
    const r=byId.get(id);if(!r)return;
    document.querySelectorAll(".formula-active,.formula-ref1,.formula-ref2,.formula-ref3,.formula-ref4").forEach(function(x){x.classList.remove("formula-active","formula-ref1","formula-ref2","formula-ref3","formula-ref4");});
    const active=document.querySelector('[data-formula-cell="'+CSS.escape(id)+'"]');
    if(active) active.classList.add("formula-active");
    const refClasses=["formula-ref1","formula-ref2","formula-ref3","formula-ref4"];
    (r.refs||[]).forEach(function(ref,i){
      const cell=document.querySelector('[data-formula-cell="'+CSS.escape(ref)+'"]');
      if(cell) cell.classList.add(refClasses[i%4]);
    });
    const selectedRow=document.querySelector('[data-formula-row="'+CSS.escape(id)+'"]');
    document.querySelector(".formula-address").textContent=selectedRow&&selectedRow.dataset.currentRowNo?selectedRow.dataset.currentRowNo:"—";
    document.querySelector(".formula-expression").innerHTML=currentFormulaHtml(r);
  }
  document.querySelectorAll("[data-formula-row]").forEach(function(row){row.onclick=function(){select(row.dataset.formulaRow);};});
  const input=document.querySelector(".forecast-input");
  if(input) input.onchange=function(){
    const v=Number(input.value.replace(",","."));
    if(!ui.isAdmin||!Number.isFinite(v)||v<=0||v===savedForecastIndex()){rerenderContent();return;}
    input.disabled=true;
    saveForecastIndex(v).then(rerenderContent).catch(function(err){alert("Индекс не сохранён:\n"+(err&&err.message?err.message:String(err)));rerenderContent();});
  };
  select("temporary");
}
