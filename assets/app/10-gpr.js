function gprMonthName(key,shortName) {
  const names=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const short=["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const month=Number(String(key||"").slice(5,7));
  return (shortName?short:names)[Math.max(0,month-1)] || "";
}

function activeGprPlan() {
  return (dataState.gprPlans||[]).find(function(p){return p.status==="active";}) || (dataState.gprPlans||[])[0] || null;
}

function gprAllMonths() {
  const plan=activeGprPlan();
  if(!plan) return [];
  return (dataState.gprMonths||[])
    .filter(function(m){return m.plan_id===plan.id;})
    .slice()
    .sort(function(a,b){return String(a.month).localeCompare(String(b.month));})
    .map(function(m){
      const key=String(m.month||"").slice(0,7);
      return Object.assign({},m,{
        key:key,
        year:key.slice(0,4),
        month:gprMonthName(key,true),
        fullMonth:gprMonthName(key,false),
        label:gprMonthName(key,false)+" "+key.slice(0,4),
        monthlyIndex:Number(m.monthly_index||1),
        index:Number(m.execution_index||1)
      });
    });
}

function gprMonths() {
  const plan=activeGprPlan();
  const all=gprAllMonths();
  if(!plan) return [];
  let selected=all.filter(function(m){return !!m.is_in_period;});
  if(!selected.length && plan.start_month && plan.end_month){
    const start=String(plan.start_month).slice(0,7),end=String(plan.end_month).slice(0,7);
    selected=all.filter(function(m){return m.key>=start && m.key<=end;});
  }
  return selected;
}

function gprPeriodControlsHtml() {
  const months=gprMonths();
  const period=months.length
    ? months[0].label+" — "+months[months.length-1].label
    : "не установлен";
  const last=months.length?Number(months[months.length-1].index||1):1;
  return '<span class="gpr-period-summary"><span class="gpr-period-label">Цена на начало работ:</span><strong>01.10.2026</strong><span>·</span><span class="gpr-period-label">Период:</span><strong>'+esc(period)+'</strong><span>·</span><span class="gpr-period-label">Прогноз:</span><strong>от цены на начало работ</strong><span class="context-muted">нарастающий индекс до '+esc(last.toFixed(4).replace(".",","))+'</span></span>';
}

let gprAssignmentState=null;

function gprAssignments() {
  const plan=activeGprPlan();
  if(
    gprAssignmentState &&
    gprAssignmentState.planId===(plan&&plan.id||"") &&
    gprAssignmentState.rows===dataState.gprFloorAssignments &&
    gprAssignmentState.months===dataState.gprMonths
  ) return gprAssignmentState.map;
  const byMonth=new Map(gprAllMonths().map(function(m){return [m.id,m.key];}));
  const map={};
  if(plan){
    (dataState.gprFloorAssignments||[]).filter(function(a){return a.plan_id===plan.id;}).forEach(function(a){
      const month=byMonth.get(a.month_id);
      if(month) map[(a.building_section||"*")+"|"+a.level_code]=month;
    });
  }
  gprAssignmentState={planId:plan&&plan.id||"",rows:dataState.gprFloorAssignments,months:dataState.gprMonths,map:map};
  return map;
}

function gprAssignedMonth(section,level) {
  const a=gprAssignments();
  return a[(section||"*")+"|"+level] || a["*|"+level] || "";
}

function estimateScope(e) {
  const name=String(e && e.name || "");
  const section=name.includes("Секция 2") ? "Секция 2" : name.includes("Секция 1") ? "Секция 1" : "";
  const zone=name.includes("Цоколь") ? "Цоколь" : name.includes("Выше 0.000") ? "Выше 0.000" : "";
  return {section:section,zone:zone};
}

let gprSpecState=null;

function gprSpecData() {
  if(
    gprSpecState &&
    gprSpecState.specRows===dataState.specRows &&
    gprSpecState.specSections===dataState.specSections &&
    gprSpecState.specQuantities===dataState.specQuantities &&
    gprSpecState.links===dataState.reconciliationLinks
  ) return gprSpecState;

  const joined=specJoinedRows();
  const byId=new Map(joined.map(function(r){return [r.id,r];}));
  const links=new Map();
  (dataState.reconciliationLinks||[]).forEach(function(l){
    if(!links.has(l.estimate_row_id)) links.set(l.estimate_row_id,[]);
    const sr=byId.get(l.specification_row_id);
    if(sr) links.get(l.estimate_row_id).push(sr);
  });
  gprSpecState={
    specRows:dataState.specRows,
    specSections:dataState.specSections,
    specQuantities:dataState.specQuantities,
    links:dataState.reconciliationLinks,
    joined:joined,
    linked:links
  };
  return gprSpecState;
}

function gprSpecRowsForEstimateMaterial(row,e) {
  const state=gprSpecData();
  const linked=state.linked.get(row.id)||[];
  if(linked.length) return linked;
  const item=estimateProjectItem(row);
  if(!item) return [];
  const scope=estimateScope(e);
  return state.joined.filter(function(sr){
    if(sr.catalog_item_id!==item.id) return false;
    if(scope.section && sr.section.building_section!==scope.section) return false;
    if(scope.zone && sr.section.zone!==scope.zone) return false;
    return true;
  });
}

let gprShareState=null;

function gprMaterialMonthShare(row,e,monthKey) {
  if(
    !gprShareState ||
    gprShareState.assignments!==dataState.gprFloorAssignments ||
    gprShareState.links!==dataState.reconciliationLinks ||
    gprShareState.quantities!==dataState.specQuantities
  ){
    gprShareState={
      assignments:dataState.gprFloorAssignments,
      links:dataState.reconciliationLinks,
      quantities:dataState.specQuantities,
      map:new Map()
    };
  }
  const cacheKey=row.id+"|"+monthKey;
  if(gprShareState.map.has(cacheKey)) return gprShareState.map.get(cacheKey);
  const rows=gprSpecRowsForEstimateMaterial(row,e);
  let total=0,monthQty=0;
  rows.forEach(function(sr){
    sr.quantities.forEach(function(qty,level){
      const q=Number(qty||0);
      total+=q;
      if(gprAssignedMonth(sr.section.building_section,level)===monthKey) monthQty+=q;
    });
  });
  const share=total>0 ? monthQty/total : 0;
  gprShareState.map.set(cacheKey,share);
  return share;
}

function gprMaterialMonthQty(row,e,monthKey) {
  return Number(row.quantity||0)*gprMaterialMonthShare(row,e,monthKey);
}

function gprWorkMaterialRows(row,estimateRows) {
  const ids=(dataState.estimateWorkLinks||[])
    .filter(function(l){return l.work_row_id===row.id;})
    .map(function(l){return l.material_row_id;});
  if(ids.length){
    const set=new Set(ids);
    return (dataState.estimateRows||[]).filter(function(r){return r.row_type==="material" && set.has(r.id);});
  }
  return estimateRows.filter(function(r){return r.row_type==="material" && r.section_id===row.section_id;});
}

function gprRowMonthQty(row,e,monthKey,estimateRows) {
  if(row.row_type==="material") return gprMaterialMonthQty(row,e,monthKey);
  const materialRows=gprWorkMaterialRows(row,estimateRows);
  const totalWeight=materialRows.reduce(function(sum,mr){return sum+Math.abs(Number(mr.quantity||0));},0);
  if(!totalWeight) return 0;
  const monthWeight=materialRows.reduce(function(sum,mr){
    return sum+Math.abs(Number(mr.quantity||0))*gprMaterialMonthShare(mr,e,monthKey);
  },0);
  return Number(row.quantity||0)*(monthWeight/totalWeight);
}

function gprRowCurrentPrice(row,m) {
  const c=rowCost(row,m);
  const P=ui.currentPrice||{forecast:1.0647,competition:1,vat:0};
  const qty=Number(row.quantity||0);

  const salary=Number(c.salary_amount||0);
  const machines=Number(c.machines_amount||0);
  const drivers=Number(c.drivers_amount||0);
  const transport=Number(c.transport_amount||0);
  const materials=Number(c.materials_amount||0);
  const forecast=Number(P.forecast||1);

  // Material row: only its own material + transport cost is brought to the
  // price date 01.10.2026 by the forecast index for that date.
  if(row.row_type==="material"){
    const direct=materials+transport;
    const afterForecast=direct*forecast;
    return {
      mode:"material",
      qty:qty,
      salary:0,
      machines:0,
      drivers:0,
      transport:transport,
      materials:materials,
      wageBase:0,
      direct:direct,
      ohr:0,
      profit:0,
      temporary:0,
      winter:0,
      soc:0,
      travel:0,
      returnTemp:0,
      contractor:direct,
      competition:1,
      forecast:forecast,
      total:afterForecast,
      unit:qty!==0 ? afterForecast/qty : 0
    };
  }

  // Work row: exactly the same calculation chain as "Текущая цена".
  const wageBase=salary+drivers;
  const direct=salary+machines+transport+materials;
  const ohr=wageBase*1.0931;
  const profit=wageBase*1.0563;
  const temporary=wageBase*0.037*0.93;
  const winter=wageBase*0.025740*0.93;
  const soc=wageBase*0.34;
  const travel=0;
  const returnTemp=-temporary*0.15;
  const contractor=direct+ohr+profit+temporary+winter+soc+travel+returnTemp;
  const afterCompetition=contractor*Number(P.competition||1);
  const afterForecast=afterCompetition*forecast;
  const unit=qty!==0 ? afterForecast/qty : 0;

  return {
    mode:"work",
    qty:qty,
    salary:salary,
    machines:machines,
    drivers:drivers,
    transport:transport,
    materials:materials,
    wageBase:wageBase,
    direct:direct,
    ohr:ohr,
    profit:profit,
    temporary:temporary,
    winter:winter,
    soc:soc,
    travel:travel,
    returnTemp:returnTemp,
    contractor:contractor,
    competition:Number(P.competition||1),
    forecast:forecast,
    total:afterForecast,
    unit:unit
  };
}


function gprDisplayState() {
  if(!ui.gprDisplay){
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem("filimonova.gpr.display")||"null");}catch(_){saved=null;}
    ui.gprDisplay=Object.assign({
      price:true,
      amount:true,
      total:true,
      months:true,
      index:false,
      materials:true,
      works:true
    },saved||{});
  }
  return ui.gprDisplay;
}

function saveGprDisplayState() {
  localStorage.setItem("filimonova.gpr.display",JSON.stringify(gprDisplayState()));
}

function gprMoneyText(value) {
  return moneyFmt.format(Number(value||0));
}

function gprNumberText(value,maxDigits) {
  return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:maxDigits==null?3:maxDigits}).format(Number(value||0));
}

function gprRowAmounts(row,e,estimateRows,m,monthList) {
  const current=gprRowCurrentPrice(row,m);
  const unitAtStart=current.unit;
  const totalAtStart=current.total;
  const months={},monthQty={},monthIndex={};
  let totalMonths=0;
  (monthList||gprMonths()).forEach(function(month){
    const q=gprRowMonthQty(row,e,month.key,estimateRows);
    const idx=Number(month.index||1);
    const amount=q*unitAtStart*idx;
    monthQty[month.key]=q;
    monthIndex[month.key]=idx;
    months[month.key]=amount;
    totalMonths+=amount;
  });
  return {
    current:current,
    unit:unitAtStart,
    total:totalAtStart,
    totalMonths:totalMonths,
    months:months,
    monthQty:monthQty,
    monthIndex:monthIndex
  };
}

function gprGroupRow(label,rows,e,key,depth,m,monthList) {
  registerGroup(key);
  const display=gprDisplayState();
  const activeMonths=monthList||gprMonths();
  const monthTotals={};
  let startTotal=0,totalMonths=0;
  activeMonths.forEach(function(mon){monthTotals[mon.key]=0;});
  rows.forEach(function(r){
    const a=gprRowAmounts(r,e,rows,m,activeMonths);
    startTotal+=a.total;
    totalMonths+=a.totalMonths;
    activeMonths.forEach(function(mon){monthTotals[mon.key]+=a.months[mon.key]||0;});
  });
  let html='<tr class="group-row group-toggle" data-group-key="'+esc(key)+'">';
  html+='<td colspan="4" class="est-group-title gpr-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>';
  html+='<td></td><td></td>';
  if(display.price) html+='<td></td>';
  if(display.amount){
    html+='<td class="num strong-num gpr-value-cell" data-gpr-address="'+esc(label+' · Стоимость на начало работ')+'" data-gpr-formula-json="'+gprFormulaData([{text:"Сумма строк",cls:"c1"},{text:" = ",cls:"op"},{text:gprMoneyText(startTotal),cls:"result"}])+'">'+money(startTotal)+'</td>';
  }
  if(display.total){
    html+='<td class="num strong-num gpr-value-cell" data-gpr-address="'+esc(label+' · Стоимость всего')+'" data-gpr-formula-json="'+gprFormulaData(gprFormulaPartsTotal(activeMonths,monthTotals,totalMonths))+'">'+money(totalMonths)+'</td>';
  }
  if(display.months){
    activeMonths.forEach(function(mon){
      html+='<td class="num gpr-month group-month gpr-value-cell" data-gpr-address="'+esc(label+' · '+mon.label)+'" data-gpr-formula-json="'+gprFormulaData([{text:"Сумма строк за "+mon.label,cls:"c1"},{text:" = ",cls:"op"},{text:gprMoneyText(monthTotals[mon.key]||0),cls:"result"}])+'">'+money(monthTotals[mon.key])+'</td>';
    });
  }
  html+='</tr>';
  return html;
}

function gprFormulaData(parts) {
  return esc(JSON.stringify(parts||[]));
}

function gprFormulaPartsPrice(a,row) {
  const c=a.current||{};
  if(c.mode==="material"){
    return [
      {text:"материалы "+gprMoneyText(c.materials),cls:"c1"},
      {text:" + ",cls:"op"},
      {text:"транспорт "+gprMoneyText(c.transport),cls:"c1"},
      {text:" = ",cls:"op"},
      {text:gprMoneyText(c.direct),cls:"c1"},
      {text:" × ",cls:"op"},
      {text:"прогнозный на 01.10.2026 "+Number(c.forecast||1).toFixed(4).replace(".",","),cls:"c3"},
      {text:" = ",cls:"op"},
      {text:gprMoneyText(c.total),cls:"c1"},
      {text:" ÷ ",cls:"op"},
      {text:gprNumberText(c.qty,6),cls:"c1"},
      {text:" = ",cls:"op"},
      {text:gprMoneyText(a.unit),cls:"result"}
    ];
  }
  const parts=[
    {text:"ЗП "+gprMoneyText(c.salary),cls:"c1"},
    {text:" + ",cls:"op"},
    {text:"машины "+gprMoneyText(c.machines),cls:"c1"},
    {text:" + ",cls:"op"},
    {text:"материалы "+gprMoneyText(c.materials),cls:"c1"},
    {text:" + ",cls:"op"},
    {text:"транспорт "+gprMoneyText(c.transport),cls:"c1"},
    {text:" = ",cls:"op"},
    {text:"прямые "+gprMoneyText(c.direct),cls:"c1"}
  ];
  if(Number(c.wageBase||0)!==0){
    parts.push({text:" + ",cls:"op"},{text:"ОХР "+gprMoneyText(c.ohr),cls:"c2"});
    parts.push({text:" + ",cls:"op"},{text:"прибыль "+gprMoneyText(c.profit),cls:"c2"});
    parts.push({text:" + ",cls:"op"},{text:"временные "+gprMoneyText(c.temporary),cls:"c3"});
    parts.push({text:" + ",cls:"op"},{text:"зимние "+gprMoneyText(c.winter),cls:"c3"});
    parts.push({text:" + ",cls:"op"},{text:"соцстрах "+gprMoneyText(c.soc),cls:"c2"});
    if(Number(c.returnTemp||0)!==0){
      parts.push({text:" − ",cls:"op"},{text:"возврат "+gprMoneyText(Math.abs(c.returnTemp)),cls:"c3"});
    }
  }
  parts.push({text:" = ",cls:"op"},{text:gprMoneyText(c.contractor),cls:"c1"});
  parts.push({text:" × ",cls:"op"},{text:"конкурсный "+Number(c.competition||1).toFixed(4).replace(".",","),cls:"c2"});
  parts.push({text:" × ",cls:"op"},{text:"прогнозный "+Number(c.forecast||1).toFixed(4).replace(".",","),cls:"c3"});
  parts.push({text:" = ",cls:"op"},{text:gprMoneyText(c.total),cls:"c1"});
  if(Number(c.qty||0)!==0){
    parts.push({text:" ÷ ",cls:"op"},{text:gprNumberText(c.qty,6),cls:"c1"});
    parts.push({text:" = ",cls:"op"},{text:gprMoneyText(a.unit),cls:"result"});
  }
  return parts;
}

function gprFormulaPartsAmount(qty,unit,total) {
  return [
    {text:gprNumberText(qty,3),cls:"c1"},
    {text:" × ",cls:"op"},
    {text:gprMoneyText(unit),cls:"c2"},
    {text:" = ",cls:"op"},
    {text:gprMoneyText(total),cls:"result"}
  ];
}

function gprFormulaPartsMonth(qty,unit,index,amount) {
  return [
    {text:gprNumberText(qty,3),cls:"c1"},
    {text:" × ",cls:"op"},
    {text:gprMoneyText(unit),cls:"c2"},
    {text:" × ",cls:"op"},
    {text:Number(index||1).toFixed(4).replace(".",","),cls:"c3"},
    {text:" = ",cls:"op"},
    {text:gprMoneyText(amount),cls:"result"}
  ];
}

function gprFormulaPartsTotal(months,values,total) {
  const nonZero=months
    .map(function(mon){return Number(values[mon.key]||0);})
    .filter(function(value){return Math.abs(value)>0.0049;});
  if(!nonZero.length) return [];
  const parts=[];
  nonZero.forEach(function(value,i){
    if(i) parts.push({text:" + ",cls:"op"});
    parts.push({text:gprMoneyText(value),cls:"c"+((i%3)+1)});
  });
  parts.push({text:" = ",cls:"op"});
  parts.push({text:gprMoneyText(total),cls:"result"});
  return parts;
}

function renderGprPlaceholder() {
  const m=maps(),months=gprMonths(),display=gprDisplayState();
  let body="";
  ui.currentGroupKeys=[];

  dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;}).forEach(function(e){
    let erows=dataState.estimateRows.filter(function(r){return r.estimate_id===e.id;});
    erows=erows.filter(function(r){
      if(r.row_type==="material" && !display.materials) return false;
      if(r.row_type==="work" && !display.works) return false;
      const displayBasis=estimateDisplayBasis(r), displayName=estimateDisplayName(r);
      return passesSearch([r.position,displayBasis,displayName,r.basis,r.name]) &&
        rowPassesColumnFilters({basis:displayBasis,name:displayName});
    });
    erows=sortRows(erows,{
      position:function(r){return r.position;},
      basis:function(r){return estimateDisplayBasis(r);},
      name:function(r){return estimateDisplayName(r);}
    });
    if(!sortBucket()) erows.sort(function(x,y){return Number(x.sort_order||0)-Number(y.sort_order||0);});
    if(!erows.length) return;

    const eKey="gpr:estimate:"+e.number;
    body+=gprGroupRow("Смета №"+e.number+" · "+(e.name||""),erows,e,eKey,0,m,months);
    if(ui.collapsed.has(eKey)) return;

    const sections=dataState.estimateSections.filter(function(x){return x.estimate_id===e.id;});
    sections.forEach(function(sec){
      const sRows=erows.filter(function(r){return r.section_id===sec.id;});
      if(!sRows.length) return;
      const sKey="gpr:section:"+e.number+":"+sec.id;
      body+=gprGroupRow(sec.title,sRows,e,sKey,1,m,months);
      if(ui.collapsed.has(sKey)||ui.collapseLeaves) return;

      sRows.forEach(function(r){
        const a=gprRowAmounts(r,e,sRows,m,months);
        const item=estimateProjectItem(r);
        const displayBasis=estimateDisplayBasis(r);
        const displayName=estimateDisplayName(r);
        const estimateLabel='Смета №'+e.number+' · поз. '+String(r.position||"");
        body+='<tr class="data-row '+(r.row_type==="material"?'gpr-material-row':'gpr-work-row')+'" '+(r.row_type==="material"?'data-material-id="'+esc(item?item.id:"")+'" data-material-mark="'+esc(displayBasis||"")+'"':'')+'>';
        body+='<td class="e-sticky-1 center"><span class="type-mark">'+(r.row_type==="material"?"М":"Р")+'</span></td>';
        body+=filterCell("position",r.position,esc(r.position),"e-sticky-2 center");
        body+=filterCell("basis",displayBasis,esc(displayBasis),"e-sticky-3");
        body+=filterCell("name",displayName,esc(displayName),"e-sticky-4");
        body+='<td class="center">'+esc(r.unit||"")+'</td><td class="num">'+fmt(r.quantity)+'</td>';

        if(display.price){
          body+='<td class="num gpr-value-cell" data-gpr-address="'+esc(estimateLabel+' · Цена на начало работ')+'" data-gpr-formula-json="'+gprFormulaData(gprFormulaPartsPrice(a,r))+'">'+money(a.unit)+'</td>';
        }
        if(display.amount){
          body+='<td class="num gpr-value-cell" data-gpr-address="'+esc(estimateLabel+' · Стоимость на начало работ')+'" data-gpr-formula-json="'+gprFormulaData(gprFormulaPartsAmount(r.quantity,a.unit,a.total))+'">'+money(a.total)+'</td>';
        }
        if(display.total){
          body+='<td class="num gpr-value-cell" data-gpr-address="'+esc(estimateLabel+' · Стоимость всего')+'" data-gpr-formula-json="'+gprFormulaData(gprFormulaPartsTotal(months,a.months,a.totalMonths))+'">'+money(a.totalMonths)+'</td>';
        }
        if(display.months){
          months.forEach(function(mon){
            const q=Number(a.monthQty[mon.key]||0),idx=Number(a.monthIndex[mon.key]||1),amount=Number(a.months[mon.key]||0);
            body+='<td class="num gpr-month gpr-value-cell" data-gpr-address="'+esc(estimateLabel+' · '+mon.label)+'" data-gpr-formula-json="'+gprFormulaData(gprFormulaPartsMonth(q,a.unit,idx,amount))+'" title="Объём '+esc(gprNumberText(q,3))+' × цена '+esc(gprMoneyText(a.unit))+' × индекс '+esc(idx.toFixed(4).replace(".",","))+'">'+money(amount)+'</td>';
          });
        }
        body+='</tr>';
      });
    });
  });

  const dynamicCols=(display.price?1:0)+(display.amount?1:0)+(display.total?1:0)+(display.months?months.length:0);
  if(!body) body=tableMessage(months.length?"Нет строк по текущему фильтру.":"Сначала задайте период ГПР.",6+dynamicCols);

  const years=[];
  if(display.months){
    months.forEach(function(mon){
      let y=years.find(function(x){return x.year===mon.year;});
      if(!y){y={year:mon.year,count:0};years.push(y);}
      y.count++;
    });
  }
  const headerRows=display.months?(display.index?3:2):1;
  const yearHead=years.map(function(y){return '<th class="gpr-year" colspan="'+y.count+'">'+esc(y.year)+'</th>';}).join("");
  const monthHead=months.map(function(mon){return '<th class="gpr-month-head">'+esc(mon.month)+'</th>';}).join("");
  const indexHead=months.map(function(mon){return '<th class="gpr-index-head" title="Нарастающий прогнозный индекс">'+esc(Number(mon.index||1).toFixed(4).replace(".",","))+'</th>';}).join("");

  let top='<tr>'+
    '<th class="e-sticky-1" rowspan="'+headerRows+'">Тип</th>'+
    '<th class="e-sticky-2" rowspan="'+headerRows+'">Поз. см.</th>'+
    '<th class="e-sticky-3 filterable-head" rowspan="'+headerRows+'">'+filterHeader("Обоснование","basis")+'</th>'+
    '<th class="e-sticky-4 filterable-head" rowspan="'+headerRows+'">'+filterHeader("Наименование","name")+'</th>'+
    '<th rowspan="'+headerRows+'"><span class="column-header-stack"><span>Ед.</span><span>изм.</span></span></th>'+
    '<th rowspan="'+headerRows+'">Кол-во</th>';
  if(display.price) top+='<th rowspan="'+headerRows+'">Цена на начало работ</th>';
  if(display.amount) top+='<th rowspan="'+headerRows+'">Стоимость на начало работ</th>';
  if(display.total) top+='<th rowspan="'+headerRows+'">Стоимость всего</th>';
  if(display.months) top+=yearHead;
  top+='</tr>';

  let thead='<thead>'+top;
  if(display.months) thead+='<tr>'+monthHead+'</tr>';
  if(display.months&&display.index) thead+='<tr>'+indexHead+'</tr>';
  thead+='</thead>';

  $("workArea").className="work-area table-work gpr-work";
  $("workArea").innerHTML='<div class="formula-strip gpr-formula-strip">'+
    '<div class="formula-address">—</div>'+
    '<div class="gpr-formula-fx">fx</div>'+
    '<div class="formula-expression"><span class="formula-placeholder">Выберите числовую ячейку от «Цена на начало работ» и правее</span></div>'+
    '</div>'+
    '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table est-table gpr-table" data-table-key="gpr-v5">'+thead+'<tbody>'+body+'</tbody></table></div></div>';
}

function openGprSettingsModal() {
  if(!ui.isAdmin) return;
  const plan=activeGprPlan(),months=gprAllMonths();
  if(!plan || !months.length) return;
  let modal=document.getElementById("gprSettingsModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="gprSettingsModal";
    modal.className="gpr-modal-backdrop";
    document.body.appendChild(modal);
  }
  const rows=months.map(function(mon){
    return '<tr data-gpr-settings-row="'+esc(mon.id)+'" data-month-key="'+esc(mon.key)+'">'+
      '<td class="center"><input class="gpr-settings-check" type="checkbox" '+(mon.is_in_period?'checked':'')+' aria-label="Включить '+esc(mon.label)+'"></td>'+
      '<td>'+esc(mon.label)+'</td>'+
      '<td class="num"><input class="gpr-index-input" data-gpr-month-index="'+esc(mon.id)+'" value="'+esc(Number(mon.monthlyIndex||1).toFixed(4).replace(".",","))+'" inputmode="decimal" aria-label="Индекс '+esc(mon.label)+'"></td>'+
      '<td class="num gpr-cumulative-cell" data-gpr-cumulative="'+esc(mon.id)+'">'+esc(Number(mon.index||1).toFixed(4).replace(".",","))+'</td>'+
    '</tr>';
  }).join("");
  modal.innerHTML='<div class="gpr-modal gpr-settings-modal"><div class="gpr-modal-head"><strong>Параметры ГПР</strong><button type="button" class="gpr-modal-close">×</button></div>'+
    '<div class="gpr-settings-note">Цена на начало работ берётся из расчёта «Текущая цена» на 01.10.2026. Индекс Октября применяется за период 01.10.2026–31.10.2026; далее месячные прогнозные индексы применяются последовательно, а нарастающий индекс рассчитывается относительно цены на 01.10.2026.</div>'+
    '<div class="gpr-modal-body"><div class="gpr-alloc-scroll"><table class="gpr-settings-table"><thead><tr><th>Период</th><th>Месяц</th><th>Индекс месяца</th><th>Индекс нарастающим итогом</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
    '<div class="gpr-modal-foot"><span class="gpr-settings-state"></span><button type="button" class="context-link gpr-cancel">Отмена</button><span class="spacer"></span><button type="button" class="context-link gpr-settings-save">Сохранить</button></div></div>';
  modal.classList.add("open");

  function close(){modal.classList.remove("open");}
  function numberValue(input){
    const n=Number(String(input.value||"").replace(",","."));
    return Number.isFinite(n)&&n>0?n:null;
  }
  function recalc(){
    let cumulative=1;
    months.forEach(function(mon){
      const input=modal.querySelector('[data-gpr-month-index="'+CSS.escape(mon.id)+'"]');
      const n=numberValue(input);
      if(n!=null) cumulative*=n;
      const cell=modal.querySelector('[data-gpr-cumulative="'+CSS.escape(mon.id)+'"]');
      if(cell) cell.textContent=(n==null?"—":cumulative.toFixed(4).replace(".",","));
    });
  }
  const gprIndexInputs=Array.from(modal.querySelectorAll(".gpr-index-input"));
  gprIndexInputs.forEach(function(input,index){
    input.oninput=recalc;
    input.onkeydown=function(e){
      if(e.key!=="Enter") return;
      e.preventDefault();
      const next=gprIndexInputs[index+1];
      if(next){
        next.focus();
        next.select();
      }else{
        input.select();
      }
    };
  });
  recalc();
  modal.querySelector(".gpr-modal-close").onclick=close;
  modal.querySelector(".gpr-cancel").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector(".gpr-settings-save").onclick=async function(){
    const state=modal.querySelector(".gpr-settings-state");
    const checked=months.filter(function(mon){
      const row=modal.querySelector('[data-gpr-settings-row="'+CSS.escape(mon.id)+'"]');
      return row && row.querySelector(".gpr-settings-check").checked;
    });
    if(!checked.length){state.textContent="Выберите хотя бы один месяц.";return;}
    const first=months.indexOf(checked[0]),last=months.indexOf(checked[checked.length-1]);
    if(checked.length!==last-first+1){state.textContent="Период должен быть непрерывным.";return;}

    let cumulative=1;
    const payload=[];
    for(const mon of months){
      const input=modal.querySelector('[data-gpr-month-index="'+CSS.escape(mon.id)+'"]');
      const rawMonthly=numberValue(input);
      if(rawMonthly==null){state.textContent="Проверьте индекс для "+mon.label+".";return;}
      const monthly=Math.round(rawMonthly*10000)/10000;
      cumulative*=monthly;
      const cumulativeStored=Math.round(cumulative*10000)/10000;
      payload.push({
        id:mon.id,
        project_id:dataState.project.id,
        plan_id:plan.id,
        month:mon.key+"-01",
        monthly_index:monthly,
        execution_index:cumulativeStored,
        is_in_period:checked.some(function(x){return x.id===mon.id;})
      });
    }
    if(payload.some(function(x){return !/^\d{4}-\d{2}-01$/.test(x.month);})){
      state.textContent="Ошибка периода: некорректная дата месяца.";
      return;
    }
    state.textContent="Сохраняю…";
    const saveMonths=await client.from("gpr_months").upsert(payload,{onConflict:"id"});
    if(saveMonths.error){state.textContent=saveMonths.error.message;return;}
    const savePlan=await client.from("gpr_plans").update({
      start_month:checked[0].key+"-01",
      end_month:checked[checked.length-1].key+"-01"
    }).eq("id",plan.id).eq("project_id",dataState.project.id);
    if(savePlan.error){state.textContent=savePlan.error.message;return;}
    await refreshProjectDataSlices(["gprPlans","gprMonths"],dataState.project);
    gprSpecState=null;
    gprAssignmentState=null;
    gprShareState=null;
    gprPriceFactorState=null;
    close();
    renderPage("estimates",2);
  };
}

function openGprAllocationModal() {
  const plan=activeGprPlan(),months=gprMonths(),levels=levelCodes(),existing=gprAssignments();
  if(!plan || !months.length){
    if(ui.isAdmin) openGprSettingsModal();
    return;
  }
  let modal=document.getElementById("gprAllocationModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="gprAllocationModal";
    modal.className="gpr-modal-backdrop";
    document.body.appendChild(modal);
  }
  const years=[];
  months.forEach(function(mon){
    let y=years.find(function(x){return x.year===mon.year;});
    if(!y){y={year:mon.year,count:0};years.push(y);}
    y.count++;
  });
  function existingFor(level){
    const a=existing["Секция 1|"+level]||"",b=existing["Секция 2|"+level]||"";
    return a===b?a:(a||b);
  }
  modal.innerHTML='<div class="gpr-modal"><div class="gpr-modal-head"><strong>Разнести по графику</strong><button type="button" class="gpr-modal-close">×</button></div>'+
    '<div class="gpr-modal-body"><div class="gpr-alloc-scroll"><table class="gpr-alloc-table"><thead><tr><th rowspan="2">Этаж / уровень</th>'+years.map(function(y){return '<th colspan="'+y.count+'">'+esc(y.year)+'</th>';}).join("")+'</tr><tr>'+months.map(function(mon){return '<th>'+esc(mon.month)+'</th>';}).join("")+'</tr></thead><tbody>'+
    levels.map(function(level){
      return '<tr><td>'+esc(summaryLevelLabel(level))+'</td>'+months.map(function(mon){
        return '<td><input type="checkbox" class="gpr-month-check" data-level="'+esc(level)+'" data-month="'+esc(mon.key)+'" '+(existingFor(level)===mon.key?'checked':'')+'></td>';
      }).join("")+'</tr>';
    }).join("")+'</tbody></table></div></div>'+
    '<div class="gpr-modal-foot"><span class="gpr-allocation-state"></span><button type="button" class="context-link gpr-cancel">Отмена</button><span class="spacer"></span><button type="button" class="context-link gpr-apply">Применить к графику</button></div></div>';
  modal.classList.add("open");

  modal.querySelectorAll(".gpr-month-check").forEach(function(check){
    check.onchange=function(){
      if(!check.checked) return;
      modal.querySelectorAll('.gpr-month-check[data-level="'+CSS.escape(check.dataset.level)+'"]').forEach(function(other){
        if(other!==check) other.checked=false;
      });
    };
  });
  function close(){modal.classList.remove("open");}
  modal.querySelector(".gpr-modal-close").onclick=close;
  modal.querySelector(".gpr-cancel").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector(".gpr-apply").onclick=async function(){
    const state=modal.querySelector(".gpr-allocation-state");
    const monthByKey=new Map(months.map(function(mon){return [mon.key,mon];}));
    const rows=[];
    modal.querySelectorAll(".gpr-month-check:checked").forEach(function(check){
      const mon=monthByKey.get(check.dataset.month);
      if(!mon) return;
      ["Секция 1","Секция 2"].forEach(function(section){
        rows.push({
          project_id:dataState.project.id,
          plan_id:plan.id,
          month_id:mon.id,
          building_section:section,
          level_code:check.dataset.level
        });
      });
    });
    state.textContent="Сохраняю…";
    const del=await client.from("gpr_floor_assignments").delete().eq("project_id",dataState.project.id).eq("plan_id",plan.id);
    if(del.error){state.textContent=del.error.message;return;}
    if(rows.length){
      const ins=await client.from("gpr_floor_assignments").insert(rows);
      if(ins.error){state.textContent=ins.error.message;return;}
    }
    await refreshProjectDataSlices(["gprFloorAssignments"],dataState.project);
    gprSpecState=null;
    gprAssignmentState=null;
    gprShareState=null;
    gprPriceFactorState=null;
    close();
    renderPage("estimates",2);
  };
}

function openGprDisplay() {
  const state=gprDisplayState();
  let pop=document.getElementById("gprDisplayPopover");
  if(!pop){
    pop=document.createElement("div");
    pop.id="gprDisplayPopover";
    pop.className="gpr-display-popover";
    document.body.appendChild(pop);
  }
  const options=[
    ["price","Цена на начало работ"],
    ["amount","Стоимость на начало работ"],
    ["total","Стоимость всего"],
    ["months","Месячные суммы"],
    ["index","Индекс месяца"],
    ["materials","Материалы"],
    ["works","Работы"]
  ];
  pop.innerHTML='<strong>Отображение</strong>'+options.map(function(opt){
    return '<label><input type="checkbox" data-gpr-show="'+opt[0]+'" '+(state[opt[0]]?'checked':'')+'> '+opt[1]+'</label>';
  }).join("");
  pop.querySelectorAll("[data-gpr-show]").forEach(function(input){
    input.onchange=function(){
      state[input.dataset.gprShow]=input.checked;
      if(input.dataset.gprShow==="index" && input.checked) state.months=true;
      saveGprDisplayState();
      pop.classList.remove("open");
      renderPage("estimates",2);
    };
  });
  const btn=document.querySelector('[data-gpr-action="display"]');
  if(!btn) return;
  const r=btn.getBoundingClientRect();
  pop.style.right=Math.max(8,window.innerWidth-r.right)+"px";
  pop.style.top=(r.bottom+5)+"px";
  pop.classList.toggle("open");
}

function wireGprFormulaBar() {
  const strip=document.querySelector(".gpr-formula-strip");
  if(!strip) return;
  const address=strip.querySelector(".formula-address");
  const expr=strip.querySelector(".formula-expression");
  document.querySelectorAll(".gpr-value-cell").forEach(function(cell){
    cell.onclick=function(e){
      e.stopPropagation();
      document.querySelectorAll(".gpr-value-cell.gpr-formula-active").forEach(function(x){x.classList.remove("gpr-formula-active");});
      cell.classList.add("gpr-formula-active");
      address.textContent=cell.dataset.gprAddress||"—";
      let parts=[];
      try{parts=JSON.parse(cell.dataset.gprFormulaJson||"[]");}catch(_){parts=[];}
      expr.innerHTML=parts.map(function(part){
        return '<span class="gpr-formula-token gpr-formula-'+esc(part.cls||"op")+'">'+esc(part.text||"")+'</span>';
      }).join("");
    };
  });
}

function wireGprControls() {
  const settings=document.querySelector('[data-gpr-action="settings"]');
  const spread=document.querySelector('[data-gpr-action="spread"]');
  const display=document.querySelector('[data-gpr-action="display"]');
  const excel=document.querySelector('[data-gpr-action="excel"]');
  if(settings) settings.onclick=openGprSettingsModal;
  if(spread) spread.onclick=openGprAllocationModal;
  if(display) display.onclick=openGprDisplay;
  if(excel) excel.onclick=function(){alert("Экспорт ГПР формируется только в Excel (.xlsx).");};
  wireGprFormulaBar();
}
