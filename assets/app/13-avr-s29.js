function exFmt(value) { return numFmt.format(Number(value)||0); }
function exFmt0(value) { return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(value)||0); }
function exMoney(value) { return moneyFmt.format(Number(value)||0); }

function periodKey(value) {
  return String(value || "").slice(0,7);
}

function periodDate(value) {
  const key=periodKey(value);
  return key ? key+"-01" : "";
}

function periodLabel(value,short) {
  const key=periodKey(value);
  if(!key) return "—";
  const parts=key.split("-");
  const date=new Date(Number(parts[0]),Number(parts[1])-1,1);
  const text=new Intl.DateTimeFormat("ru-RU",{month:short?"short":"long",year:"numeric"}).format(date).replace(" г.","");
  return text.charAt(0).toUpperCase()+text.slice(1);
}

function dateTimeLabel(value) {
  if(!value) return "—";
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);
}

function executionPeriods() {
  const set=new Set();
  (dataState.avrDocuments||[]).forEach(function(x){if(periodKey(x.period_month)) set.add(periodKey(x.period_month));});
  (dataState.accountingPeriodSources||[]).forEach(function(x){if(periodKey(x.period_month)) set.add(periodKey(x.period_month));});
  (dataState.s29Documents||[]).forEach(function(x){if(periodKey(x.period_month)) set.add(periodKey(x.period_month));});
  (dataState.montageEvents||[]).forEach(function(x){if(periodKey(x.event_date)) set.add(periodKey(x.event_date));});
  (dataState.gprMonths||[]).forEach(function(x){if(periodKey(x.month)) set.add(periodKey(x.month));});
  const now=new Date();
  for(let i=0;i<12;i++) set.add(now.getFullYear()+"-"+String(i+1).padStart(2,"0"));
  return Array.from(set).sort();
}

function monthSelectHtml(value,attr,includeAll) {
  let html=includeAll?'<option value="all"'+(value==="all"?' selected':'')+'>Весь период</option>':"";
  executionPeriods().forEach(function(key){html+='<option value="'+key+'"'+(key===value?' selected':'')+'>'+esc(periodLabel(key,false))+'</option>';});
  return '<select class="execution-select execution-period-select" '+attr+'>'+html+'</select>';
}

function versionsForDocument(documentId) {
  return (dataState.avrVersions||[]).filter(function(v){return v.document_id===documentId;}).sort(function(a,b){return Number(b.version_no)-Number(a.version_no);});
}

function sourceVersionForDocument(doc) {
  const versions=versionsForDocument(doc.id);
  return versions.find(function(v){return v.state==="signed" || !!v.signed_at;}) || versions.find(function(v){return v.state==="in_use";}) || versions[0] || null;
}

function selectedAvrDocument() {
  let key=ui.avr.period;
  const docs=(dataState.avrDocuments||[]).slice().sort(function(a,b){return String(b.period_month).localeCompare(String(a.period_month));});
  if(!key){key=docs.length?periodKey(docs[0].period_month):periodKey(new Date().toISOString());ui.avr.period=key;}
  return docs.find(function(d){return periodKey(d.period_month)===key;}) || null;
}

function selectedAvrVersion() {
  const doc=selectedAvrDocument();
  if(!doc) return null;
  const versions=versionsForDocument(doc.id);
  const requested=versions.find(function(v){return v.id===ui.avr.versionId;});
  return requested || sourceVersionForDocument(doc);
}

function importForVersion(version) {
  return version ? (dataState.imports||[]).find(function(x){return x.id===version.source_import_id;}) : null;
}

function avrStatus(version) {
  if(!version) return "Нет акта";
  if(version.state==="signed" || version.signed_at) return "Подписан";
  if(version.state==="in_use") return "Используется";
  return "Черновик";
}

function renderExecutionMetrics(items) {
  return '<div class="execution-metrics">'+items.map(function(item){return '<div class="execution-metric'+(item.tone?' '+item.tone:'')+'"><span>'+esc(item.label)+'</span><strong>'+item.value+'</strong><small>'+esc(item.note||"")+'</small></div>';}).join("")+'</div>';
}

function renderAvr(tab) {
  if(tab===2){renderKs6();return;}
  if(tab===1){renderAvrRegistry();return;}
  const doc=selectedAvrDocument();
  const version=selectedAvrVersion();
  const rows=version?(dataState.avrRows||[]).filter(function(x){return x.version_id===version.id;}):[];
  const estimateRowMap=new Map(dataState.estimateRows.map(function(x){return [x.id,x];}));
  const materialRows=rows.filter(function(x){const r=estimateRowMap.get(x.estimate_row_id);return r&&r.row_type==="material";});
  const qty=materialRows.reduce(function(s,x){return s+Number(x.quantity||0);},0);
  const m3=materialRows.reduce(function(s,x){return s+Number(x.quantity_m3||0);},0);
  const amount=rows.reduce(function(s,x){return s+Number(x.amount||0);},0);
  let body="";
  ui.currentGroupKeys=[];
  ui.avrWidthSamples=Array.from({length:9},function(){return [];});
  function widthSample(index,value){
    const text=String(value==null?"":value).trim();
    if(text) ui.avrWidthSamples[index].push(text);
  }
  widthSample(0,"Р");widthSample(0,"М");
  if(version){
    dataState.estimates.forEach(function(estimate){
      const estimateRows=rows.map(function(x){return {fact:x,row:estimateRowMap.get(x.estimate_row_id)};})
        .filter(function(x){return x.row&&x.row.estimate_id===estimate.id&&passesSearch([x.row.position,x.row.basis,x.row.name]);});
      if(!estimateRows.length) return;
      estimateRows.forEach(function(x){
        const r=x.row,f=x.fact,item=(dataState.catalogItems||[]).find(function(c){return c.id===r.catalog_item_id;});
        const displayBasis=estimateDisplayBasis(r),displayName=estimateDisplayName(r),mark=item&&item.mark||"";
        widthSample(1,r.position);widthSample(2,displayBasis);widthSample(3,mark);
        if(r.row_type==="material"){widthSample(4,displayName);widthSample(5,r.unit);}
        widthSample(6,exFmt(f.quantity));
        if(r.row_type==="material") widthSample(7,exFmt(f.quantity_m3));
        widthSample(8,exMoney(f.amount));
      });
      const estimateKey="avr:"+estimate.id;
      registerGroup(estimateKey);
      const estimateQty=estimateRows.reduce(function(s,x){return s+Number(x.fact.quantity||0);},0);
      const estimateM3=estimateRows.reduce(function(s,x){return s+Number(x.fact.quantity_m3||0);},0);
      const estimateAmount=estimateRows.reduce(function(s,x){return s+Number(x.fact.amount||0);},0);
      widthSample(6,exFmt(estimateQty));widthSample(7,exFmt(estimateM3));widthSample(8,exMoney(estimateAmount));
      body+='<tr class="group-row group-toggle" data-group-key="'+estimateKey+'"><td colspan="6"><span class="group-arrow">'+groupArrow(estimateKey)+'</span>'+esc("Смета №"+estimate.number+" · "+estimate.name)+'</td><td class="num">'+exFmt(estimateQty)+'</td><td class="num">'+exFmt(estimateM3)+'</td><td class="num">'+exMoney(estimateAmount)+'</td></tr>';
      if(ui.collapsed.has(estimateKey)) return;
      const sections=dataState.estimateSections.filter(function(s){return s.estimate_id===estimate.id;})
        .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
      sections.forEach(function(section){
        const sectionRows=estimateRows.filter(function(x){return x.row.section_id===section.id;})
          .sort(function(a,b){return Number(a.row.sort_order||0)-Number(b.row.sort_order||0);});
        if(!sectionRows.length) return;
        const sectionKey=estimateKey+":"+section.id;
        registerGroup(sectionKey);
        const sectionQty=sectionRows.reduce(function(s,x){return s+Number(x.fact.quantity||0);},0);
        const sectionM3=sectionRows.reduce(function(s,x){return s+Number(x.fact.quantity_m3||0);},0);
        const sectionAmount=sectionRows.reduce(function(s,x){return s+Number(x.fact.amount||0);},0);
        widthSample(6,exFmt(sectionQty));widthSample(7,exFmt(sectionM3));widthSample(8,exMoney(sectionAmount));
        body+='<tr class="group-row group-toggle" data-group-key="'+sectionKey+'"><td colspan="6" class="est-group-title" style="padding-left:22px"><span class="group-arrow">'+groupArrow(sectionKey)+'</span>'+esc(section.title)+'</td><td class="num">'+exFmt(sectionQty)+'</td><td class="num">'+exFmt(sectionM3)+'</td><td class="num">'+exMoney(sectionAmount)+'</td></tr>';
        if(ui.collapsed.has(sectionKey)||ui.collapseLeaves) return;
        sectionRows.forEach(function(x){
          const r=x.row,f=x.fact,item=(dataState.catalogItems||[]).find(function(c){return c.id===r.catalog_item_id;});
          const displayBasis=estimateDisplayBasis(r),displayName=estimateDisplayName(r),mark=item&&item.mark||"";
          widthSample(1,r.position);widthSample(2,displayBasis);widthSample(3,mark);
          if(r.row_type==="material"){widthSample(4,displayName);widthSample(5,r.unit);}
          widthSample(6,exFmt(f.quantity));
          if(r.row_type==="material") widthSample(7,exFmt(f.quantity_m3));
          widthSample(8,exMoney(f.amount));
          body+='<tr class="data-row" data-row-type="'+esc(r.row_type||"")+'"><td class="center"><span class="type-mark">'+(r.row_type==="work"?"Р":"М")+'</span></td><td class="center">'+esc(r.position||"")+'</td><td title="'+esc(displayBasis||"")+'">'+esc(displayBasis||"")+'</td><td>'+esc(mark)+'</td><td title="'+esc(displayName||"")+'">'+esc(displayName||"")+'</td><td class="center">'+esc(r.unit||"")+'</td><td class="num">'+exFmt(f.quantity)+'</td><td class="num">'+(r.row_type==="material"?exFmt(f.quantity_m3):"—")+'</td><td class="num">'+exMoney(f.amount)+'</td></tr>';
        });
      });
    });
  }
  if(!body) body=tableMessage(doc?"В выбранной версии нет строк АВР.":"Для выбранного месяца АВР ещё не импортирован.",9);
  const requiresCheck=materialRows.filter(function(x){
    const r=estimateRowMap.get(x.estimate_row_id);
    return !r || !linkedSpecRowsForEstimateRow(r).length || !Number.isFinite(Number(x.quantity_m3));
  }).length;
  const avrTitle='АВР №'+esc(doc&&doc.display_number||"—")+' · '+esc(periodLabel(doc&&doc.period_month||ui.avr.period,false))+' · импорт №'+esc(version&&version.version_no||"—");
  $("workArea").className="work-area execution-work avr-execution-work";
  $("workArea").innerHTML=renderExecutionMetrics([
    {label:"Панелей в акте",value:exFmt0(qty)+" шт.",note:"принятые строки М"},
    {label:"Объём панелей",value:exFmt(m3)+" м³",note:"по доверенным объёмам"},
    {label:"Стоимость по акту",value:exMoney(amount)+" руб.",note:"запроцентовано Р/М"},
    {label:"Требует проверки",value:exFmt0(requiresCheck),note:"несопоставленные строки",tone:requiresCheck>0?"warn":""}
  ])+'<div class="engineering-shell execution-table">'+
    '<div class="execution-table-title avr-execution-title"><span class="avr-execution-caption">'+avrTitle+'</span><span class="spacer"></span>'+
    '<button class="service-action" data-service="collapse" type="button">Свернуть всё</button>'+
    '<button class="service-action" data-service="expand" type="button">Развернуть всё</button></div>'+
    '<div class="engineering-scroll"><table class="eng-table avr-table" data-table-key="avr-v2"><thead><tr>'+
    '<th>Тип</th>'+
    '<th><span class="column-header-stack"><span>Поз.</span><span>см.</span></span></th>'+
    '<th>Обоснование</th><th>Марка</th><th>Наименование</th>'+
    '<th><span class="column-header-stack"><span>Ед.</span><span>изм.</span></span></th>'+
    '<th><span class="column-header-stack"><span>Кол-во</span><span>в акте</span></span></th>'+
    '<th><span class="column-header-stack"><span>Кол-во,</span><span>м³</span></span></th>'+
    '<th><span class="column-header-stack"><span>Стоимость</span><span>по акту</span></span></th>'+
    '</tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function renderAvrRegistry() {
  const filter=ui.avr.registryPeriod||"all";
  let body="";
  (dataState.avrDocuments||[]).slice().sort(function(a,b){return String(b.period_month).localeCompare(String(a.period_month));}).forEach(function(doc){
    if(filter!=="all"&&periodKey(doc.period_month)!==filter) return;
    const versions=versionsForDocument(doc.id);
    versions.forEach(function(v){
      const source=importForVersion(v);
      let actions='<span class="context-muted">—</span>';
      if(v.state==="signed"||v.signed_at){
        actions='<button class="inline-action" data-avr-unsign="'+v.id+'">Отменить подписание</button>';
      }else{
        actions=(v.state!=="in_use"?'<button class="inline-action" data-avr-use="'+v.id+'">использовать</button>':'')+'<button class="inline-action" data-avr-sign="'+v.id+'">Отметить как подписанный</button>';
      }
      body+='<tr class="data-row"><td>'+esc(periodLabel(doc.period_month,false))+'</td><td>'+esc(doc.display_number||"—")+'</td><td>'+esc(source&&source.source_name||"—")+'</td><td class="num">'+v.version_no+'</td><td>'+dateTimeLabel(v.created_at)+'</td><td><span class="execution-status '+esc(v.state)+'">'+esc(avrStatus(v))+'</span></td><td class="registry-actions">'+actions+'</td></tr>';
    });
  });
  if(!body) body=tableMessage("АВР за выбранный период ещё не импортировались.",7);
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table compact-registry execution-registry"><thead><tr><th>Период</th><th>№ АВР</th><th>Файл</th><th>Версия</th><th>Импортирован</th><th>Статус</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function renderKs6() {
  // Position is an identity column here, exactly as in the estimate grid: no filter.
  clearColumnFilter("position");
  const docs=(dataState.avrDocuments||[]).slice().sort(function(a,b){return String(a.period_month).localeCompare(String(b.period_month));});
  const sources=executionPeriods().map(function(period){
    const doc=docs.find(function(x){return periodKey(x.period_month)===period;})||null;
    return {period:period,doc:doc,version:doc?sourceVersionForDocument(doc):null};
  });
  const factByVersionRow=new Map();
  (dataState.avrRows||[]).forEach(function(x){factByVersionRow.set(x.version_id+":"+x.estimate_row_id,Number(x.quantity||0));});
  const estimates=dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;});
  const monthNames=["Янв.","Февр.","Март","Апр.","Май","Июнь","Июль","Авг.","Сент.","Окт.","Нояб.","Дек."];
  const years=[];
  sources.forEach(function(source){
    const parts=source.period.split("-");
    const year=parts[0];
    let group=years.find(function(x){return x.year===year;});
    if(!group){group={year:year,sources:[]};years.push(group);}
    group.sources.push(source);
  });

  ui.currentGroupKeys=[];
  ui.ks6WidthSamples=Array.from({length:8+sources.length},function(){return [];});
  function widthSample(index,value){
    const text=String(value==null?"":value).trim();
    if(text) ui.ks6WidthSamples[index].push(text);
  }
  widthSample(0,"Р");widthSample(0,"М");

  function rowFacts(rows){
    // Итоги по смете и разделам в 6-КС считаем только по материальным позициям (М).
    // Работы (Р) остаются отдельными строками журнала, но в агрегаты не входят.
    const materialOnly=(rows||[]).filter(function(r){return r.row_type==="material";});
    const monthTotals=sources.map(function(x){
      return x.version?materialOnly.reduce(function(sum,r){return sum+(factByVersionRow.get(x.version.id+":"+r.id)||0);},0):0;
    });
    const estimateTotal=materialOnly.reduce(function(sum,r){return sum+Number(r.quantity||0);},0);
    const accrued=monthTotals.reduce(function(sum,v){return sum+v;},0);
    return {estimateTotal:estimateTotal,monthTotals:monthTotals,accrued:accrued,rest:estimateTotal-accrued};
  }

  function groupRow(label,rows,key,depth){
    registerGroup(key);
    const f=rowFacts(rows);
    widthSample(5,exFmt(f.estimateTotal));
    widthSample(6,exFmt(f.accrued));
    widthSample(7,exFmt(f.rest));
    f.monthTotals.forEach(function(v,i){widthSample(8+i,exFmt(v));});
    return '<tr class="group-row group-toggle" data-group-key="'+key+'">'+
      '<td colspan="5" class="est-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>'+
      '<td class="num">'+exFmt(f.estimateTotal)+'</td>'+
      '<td class="num">'+exFmt(f.accrued)+'</td>'+
      '<td class="num '+(f.rest<0?'warning-num':'')+'">'+(f.rest<0?'<span class="warning-icon">⚠</span>':'')+exFmt(f.rest)+'</td>'+
      f.monthTotals.map(function(v){return '<td class="num">'+exFmt(v)+'</td>';}).join("")+
    '</tr>';
  }

  let body="";
  estimates.forEach(function(e){
    let rows=dataState.estimateRows.filter(function(r){
      return r.estimate_id===e.id &&
        passesSearch([r.position,estimateDisplayBasis(r),estimateDisplayName(r),r.basis,r.name]) &&
        rowPassesColumnFilters({basis:estimateDisplayBasis(r),name:estimateDisplayName(r)});
    });
    rows.sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
    if(!rows.length&&(currentSearch()||Object.keys(filterBucket()).length)) return;
    rows.forEach(function(r){
      const values=sources.map(function(x){return x.version?(factByVersionRow.get(x.version.id+":"+r.id)||0):0;});
      const sum=values.reduce(function(s,v){return s+v;},0);
      const rest=Number(r.quantity||0)-sum;
      const basis=estimateDisplayBasis(r),name=estimateDisplayName(r);
      widthSample(1,r.position);widthSample(2,basis);
      if(r.row_type==="material"){widthSample(3,name);widthSample(4,r.unit);}
      widthSample(5,exFmt(r.quantity));widthSample(6,exFmt(sum));widthSample(7,exFmt(rest));
      values.forEach(function(v,i){widthSample(8+i,exFmt(v));});
    });

    const estimateKey="ks6:"+e.id;
    body+=groupRow("Смета №"+e.number+" · "+(e.name||""),rows,estimateKey,0);
    if(ui.collapsed.has(estimateKey)) return;

    const sections=dataState.estimateSections.filter(function(sec){return sec.estimate_id===e.id;})
      .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
    const seenSections=new Set();
    sections.forEach(function(sec){
      const sectionRows=rows.filter(function(r){return r.section_id===sec.id;})
        .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
      if(!sectionRows.length) return;
      seenSections.add(sec.id);
      const sectionKey=estimateKey+":section:"+sec.id;
      body+=groupRow(sec.title,sectionRows,sectionKey,1);
      if(ui.collapsed.has(sectionKey)||ui.collapseLeaves) return;
      sectionRows.forEach(function(r){
        const values=sources.map(function(x){return x.version?(factByVersionRow.get(x.version.id+":"+r.id)||0):0;});
        const sum=values.reduce(function(s,v){return s+v;},0);
        const rest=Number(r.quantity||0)-sum;
        const basis=estimateDisplayBasis(r),name=estimateDisplayName(r);
        widthSample(1,r.position);widthSample(2,basis);
        if(r.row_type==="material"){widthSample(3,name);widthSample(4,r.unit);}
        widthSample(5,exFmt(r.quantity));widthSample(6,exFmt(sum));widthSample(7,exFmt(rest));
        values.forEach(function(v,i){widthSample(8+i,exFmt(v));});
        body+='<tr class="data-row" data-row-type="'+esc(r.row_type||"")+'">'+
          '<td class="center"><span class="type-mark">'+(r.row_type==="work"?"Р":"М")+'</span></td>'+
          '<td class="center">'+esc(r.position||"")+'</td>'+
          filterCell("basis",basis,esc(basis||""),"")+
          filterCell("name",name,esc(name||""),"")+
          '<td class="center" title="'+esc(r.unit||"")+'">'+esc(r.unit||"")+'</td>'+
          '<td class="num">'+exFmt(r.quantity)+'</td>'+
          '<td class="num">'+exFmt(sum)+'</td>'+
          '<td class="num '+(rest<0?'warning-num':'')+'">'+(rest<0?'<span class="warning-icon">⚠</span>':'')+exFmt(rest)+'</td>'+
          values.map(function(v){return '<td class="num">'+exFmt(v)+'</td>';}).join("")+
        '</tr>';
      });
    });

    const unsectioned=rows.filter(function(r){return !r.section_id||!seenSections.has(r.section_id);});
    if(unsectioned.length){
      const sectionKey=estimateKey+":section:other";
      body+=groupRow("Без раздела",unsectioned,sectionKey,1);
      if(!ui.collapsed.has(sectionKey)&&!ui.collapseLeaves){
        unsectioned.forEach(function(r){
          const values=sources.map(function(x){return x.version?(factByVersionRow.get(x.version.id+":"+r.id)||0):0;});
          const sum=values.reduce(function(s,v){return s+v;},0),rest=Number(r.quantity||0)-sum;
          const basis=estimateDisplayBasis(r),name=estimateDisplayName(r);
          widthSample(1,r.position);widthSample(2,basis);
          if(r.row_type==="material"){widthSample(3,name);widthSample(4,r.unit);}
          widthSample(5,exFmt(r.quantity));widthSample(6,exFmt(sum));widthSample(7,exFmt(rest));
          values.forEach(function(v,i){widthSample(8+i,exFmt(v));});
          body+='<tr class="data-row" data-row-type="'+esc(r.row_type||"")+'">'+
            '<td class="center"><span class="type-mark">'+(r.row_type==="work"?"Р":"М")+'</span></td>'+
            '<td class="center">'+esc(r.position||"")+'</td>'+
            filterCell("basis",basis,esc(basis||""),"")+
            filterCell("name",name,esc(name||""),"")+
            '<td class="center" title="'+esc(r.unit||"")+'">'+esc(r.unit||"")+'</td>'+
            '<td class="num">'+exFmt(r.quantity)+'</td>'+
            '<td class="num">'+exFmt(sum)+'</td>'+
            '<td class="num '+(rest<0?'warning-num':'')+'">'+(rest<0?'<span class="warning-icon">⚠</span>':'')+exFmt(rest)+'</td>'+
            values.map(function(v){return '<td class="num">'+exFmt(v)+'</td>';}).join("")+
          '</tr>';
        });
      }
    }
  });

  const columnCount=8+sources.length;
  if(!body) body=tableMessage("Нет строк по текущему фильтру.",columnCount);

  const head1='<tr>'+
    '<th rowspan="2">Тип</th>'+
    '<th rowspan="2"><span class="column-header-stack"><span>Поз.</span><span>см.</span></span></th>'+
    '<th class="filterable-head" rowspan="2">'+filterHeader("Обоснование","basis")+'</th>'+
    '<th class="filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th>'+
    '<th rowspan="2"><span class="column-header-stack"><span>Ед.</span><span>изм.</span></span></th>'+
    '<th rowspan="2"><span class="column-header-stack"><span>По</span><span>смете</span></span></th>'+
    '<th rowspan="2"><span class="column-header-stack"><span>Запроцен-</span><span>товано</span></span></th>'+
    '<th rowspan="2">Остаток</th>'+
    years.map(function(group){return '<th class="ks-year-head" colspan="'+group.sources.length+'">'+esc(group.year)+'</th>';}).join("")+
  '</tr>';
  const head2='<tr>'+years.map(function(group){
    return group.sources.map(function(source){
      const monthIndex=Math.max(0,Number(source.period.slice(5,7))-1);
      return '<th class="ks-month-head" title="'+esc(periodLabel(source.period,false))+'">'+esc(monthNames[monthIndex]||source.period.slice(5,7))+'</th>';
    }).join("");
  }).join("")+'</tr>';

  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table ks-table" data-table-key="ks6-v3"><thead>'+head1+head2+'</thead><tbody>'+body+'</tbody></table></div></div>';
}

function selectedS29Document() {
  let key=ui.s29.period;
  const docs=(dataState.s29Documents||[]).slice().sort(function(a,b){return String(b.period_month).localeCompare(String(a.period_month));});
  if(!key){key=docs.length?periodKey(docs[0].period_month):periodKey(new Date().toISOString());ui.s29.period=key;}
  return docs.find(function(d){return periodKey(d.period_month)===key;})||null;
}

function renderS29(tab) {
  if(tab===1){renderAccounting();return;}
  if(tab===2){renderAccountingLinks();return;}
  if(tab===3){renderCarryovers();return;}
  const doc=selectedS29Document();
  const rows=doc?(dataState.s29Rows||[]).filter(function(x){return x.document_id===doc.id;}):[];
  const catalog=new Map(dataState.catalogItems.map(function(x){return [x.id,x];}));
  const totalPieces=rows.reduce(function(s,x){return s+Number(x.avr_quantity_pieces||0);},0);
  const norm=rows.reduce(function(s,x){return s+Number(x.avr_quantity_m3||0);},0);
  const actual=rows.reduce(function(s,x){return s+Number(x.written_off_m3||0);},0);
  const economy=rows.reduce(function(s,x){return s+Number(x.economy_m3||0);},0);
  const overrun=rows.reduce(function(s,x){return s+Number(x.overrun_m3||0);},0);
  let body=rows.filter(function(x){const c=catalog.get(x.catalog_item_id)||{};return passesSearch([c.mark,c.name,x.note]);}).map(function(x){
    const c=catalog.get(x.catalog_item_id)||{};const delta=Number(x.economy_m3||0)-Number(x.overrun_m3||0);
    return '<tr class="data-row"><td>'+esc(c.mark||"")+'</td><td>'+esc(c.name||"")+'</td><td>Текущий месяц</td><td class="num">'+exFmt(x.avr_quantity_pieces)+'</td><td class="num">'+exFmt(x.volume_per_piece_snapshot_m3)+'</td><td class="num">'+exFmt(x.avr_quantity_m3)+'</td><td class="num">'+exFmt(x.written_off_m3)+'</td><td class="num '+(delta<0?'warning-num':'')+'">'+exFmt(delta)+'</td><td class="num">'+exFmt(x.written_off_m3)+'</td><td>—</td></tr>';
  }).join("");
  if(!body) body=tableMessage(doc?"В С-29 выбранного месяца нет строк.":"С-29 появится после выбора подписанного АВР и бухгалтерского снимка.",10);
  $("workArea").className="work-area execution-work avr-execution-work s29-execution-work";
  $("workArea").innerHTML=renderExecutionMetrics([
    {label:"Панелей по АВР",value:exFmt0(totalPieces)+" шт.",note:rows.length+" позиций"},
    {label:"Норма текущего месяца",value:exFmt(norm)+" м³",note:"по проектным объёмам"},
    {label:"Фактически списано",value:exFmt(actual)+" м³",note:"по бухгалтерскому снимку"},
    {label:"Экономия",value:exFmt(economy)+" м³",note:"переносится далее",tone:economy>0?"warn":""},
    {label:"Перерасход",value:exFmt(overrun)+" м³",note:"контроль списания",tone:overrun>0?"danger":""}
  ])+'<div class="engineering-shell execution-table">'+
    '<div class="execution-table-title avr-execution-title s29-execution-title">'+
      '<span class="avr-execution-caption">Расчёт текущей С-29</span>'+
      '<span class="context-muted">перерасход и текущий месяц — отдельные строки</span>'+
    '</div>'+
    '<div class="engineering-scroll"><table class="eng-table s29-table"><thead><tr><th>Марка</th><th>Наименование</th><th>Тип строки</th><th>АВР, шт.</th><th>1 шт., м³</th><th>По нормам, м³</th><th>Фактически, м³</th><th>Эконом(+)/перерасход(−)</th><th>Списание, м³</th><th>Месяц происхождения</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function executionConfirm(title,text,actionLabel) {
  return new Promise(function(resolve){
    const backdrop=document.createElement("div");
    backdrop.className="spec-import-backdrop open execution-confirm";
    backdrop.innerHTML='<div class="spec-import-modal execution-confirm-card"><div class="spec-import-head"><div><strong>'+esc(title)+'</strong><span>'+esc(text)+'</span></div><button class="spec-import-close" type="button">×</button></div><div class="spec-import-foot"><button class="context-link execution-confirm-cancel" type="button">Отмена</button><span class="spacer"></span><button class="context-link execution-confirm-apply" type="button">'+esc(actionLabel)+'</button></div></div>';
    document.body.appendChild(backdrop);
    let done=false;
    function finish(value){if(done)return;done=true;backdrop.remove();resolve(value);}
    backdrop.querySelector(".spec-import-close").onclick=function(){finish(false);};
    backdrop.querySelector(".execution-confirm-cancel").onclick=function(){finish(false);};
    backdrop.querySelector(".execution-confirm-apply").onclick=function(){finish(true);};
    backdrop.onclick=function(e){if(e.target===backdrop) finish(false);};
  });
}

async function setAvrVersionState(versionId,action) {
  const version=(dataState.avrVersions||[]).find(function(x){return x.id===versionId;});
  if(!version) return;
  if(action==="sign"){
    const ok=await executionConfirm("Подписание АВР","Версия v"+version.version_no+" станет окончательным источником месяца для журнала 6-КС и С-29.","Отметить как подписанный");
    if(!ok) return;
  }
  if(action==="unsign"){
    const ok=await executionConfirm("Отмена подписания АВР","Версия v"+version.version_no+" снова станет рабочей версией «Используется». Для тестирования действие временно доступно без проверки роли администратора.","Отменить подписание");
    if(!ok) return;
  }
  const result=await client.rpc("set_avr_version_state",{p_project_id:dataState.project.id,p_version_id:versionId,p_action:action});
  if(result.error) throw result.error;
  await refreshProjectDataSlices(["avrVersions"],dataState.project);
  renderPage("avr",1);
}

function detectWorkbookPeriod(rows,expectedKey) {
  const months={
    "январь":"01","февраль":"02","март":"03","апрель":"04","май":"05","июнь":"06",
    "июль":"07","август":"08","сентябрь":"09","октябрь":"10","ноябрь":"11","декабрь":"12"
  };
  let detected="";
  rows.some(function(entry){
    const text=entry.values.map(function(value){return String(value==null?"":value);}).join(" ").replace(/\s+/g," ").trim().toLowerCase();
    const match=text.match(/за\s+(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)\s+месяц\s+(20[0-9]{2})\s+год(?:а)?/i);
    if(!match) return false;
    detected=match[2]+"-"+months[match[1].toLowerCase()];
    return true;
  });
  return detected;
}

function headerScore(rows,rowIndex,columnIndex) {
  let text="";
  for(let i=Math.max(0,rowIndex-7);i<rowIndex;i++) text+=" "+String(rows[i].values[columnIndex]||"").toLowerCase();
  let score=0;
  if(/колич|объем|объём/.test(text)) score+=3;
  if(/отчет|отчёт|выполн|акт|текущ/.test(text)) score+=7;
  if(/цена|стоим|руб|byn|итого/.test(text)) score-=8;
  if(/процент|%/.test(text)) score-=5;
  return score;
}

function excelNumber(value) {
  if(typeof value==="number") return Number.isFinite(value)?value:null;
  const number=Number(String(value==null?"":value).replace(/\s/g,"").replace(",","."));
  return Number.isFinite(number)?number:null;
}

function avrQuantityColumns(rows) {
  const bySheet=new Map();
  rows.forEach(function(entry){
    entry.values.forEach(function(value,columnIndex){
      const text=importNorm(value);
      if(/единиц.*измер/.test(text)&&/колич/.test(text)&&!bySheet.has(entry.sheet)) bySheet.set(entry.sheet,columnIndex);
    });
  });
  return bySheet;
}

async function parseAvrWorkbook(file,expectedKey) {
  await ensureXlsxLoaded();
  if(!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:"array",cellDates:true,cellFormula:false});
  const rows=[];
  workbook.SheetNames.forEach(function(sheetName){
    const values=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:null,raw:true,blankrows:false});
    values.forEach(function(row,index){rows.push({sheet:sheetName,rowNo:index+1,values:row});});
  });
  const detectedPeriod=detectWorkbookPeriod(rows,expectedKey);
  if(!detectedPeriod) throw new Error("Не удалось однозначно определить отчётный месяц из шапки АВР.");
  if(detectedPeriod!==expectedKey) throw new Error("В файле указан "+periodLabel(detectedPeriod,false)+", а выбран "+periodLabel(expectedKey,false)+".");
  let actNo="";
  const actNumberPatterns=[
    /акт.{0,320}?(?:№|номер|n(?:o)?\.?)\s*[:.]?\s*([0-9]+(?:\s*[\/-]\s*[0-9]+)*)/i,
    /(?:№|номер|n(?:o)?\.?)\s*[:.]?\s*([0-9]+(?:\s*[\/-]\s*[0-9]+)*)[^а-яёa-z0-9]{0,80}акт/i,
    /акт\s*[:.\-]?\s*([0-9]+(?:\s*[\/-]\s*[0-9]+)*)/i
  ];
  for(let rowIndex=0;rowIndex<rows.length&&!actNo;rowIndex++){
    const entry=rows[rowIndex];
    const parts=[];
    for(let offset=0;offset<3;offset++){
      const candidate=rows[rowIndex+offset];
      if(!candidate||candidate.sheet!==entry.sheet) break;
      parts.push(candidate.values.map(function(x){return String(x==null?"":x);}).join(" "));
    }
    const text=parts.join(" ").replace(/\s+/g," ").trim();
    if(!/акт/i.test(text)) continue;
    for(let patternIndex=0;patternIndex<actNumberPatterns.length;patternIndex++){
      const match=text.match(actNumberPatterns[patternIndex]);
      if(match){
        actNo=match[1].replace(/\s+/g,"");
        break;
      }
    }
  }
  if(!actNo){
    rows.some(function(entry){
      const text=entry.values.map(function(x){return String(x==null?"":x);}).join(" ").replace(/\s+/g," ").trim();
      if(/форма\s*с-?2а/i.test(text)) return false;
      const match=text.match(/с-?2а.{0,60}?(?:№|номер|n(?:o)?\.?)\s*[:.]?\s*([0-9]+(?:\s*[\/-]\s*[0-9]+)*)/i);
      if(match){actNo=match[1].replace(/\s+/g,"");return true;}
      return false;
    });
  }
  if(!actNo) throw new Error("Не удалось прочитать номер АВР из шапки файла.");
  const estimateByNumber=new Map(dataState.estimates.map(function(x){return [String(x.number),x];}));
  const basisMap=new Map();
  dataState.estimateRows.filter(function(x){return x.row_type==="material";}).forEach(function(row){
    const key=importNorm(estimateSourceValue(row,"basis"));
    if(!basisMap.has(key)) basisMap.set(key,[]);basisMap.get(key).push(row);
  });
  const quantityColumns=avrQuantityColumns(rows);
  const parsed=[];const errors=[];let currentEstimate=null;
  rows.forEach(function(entry,rowIndex){
    const joined=entry.values.map(function(x){return String(x==null?"":x);}).join(" ");
    const estimateMatch=joined.match(/локальн\S*\s+смет\S*\s*№\s*([0-9]+)/i);
    if(estimateMatch) currentEstimate=estimateByNumber.get(estimateMatch[1])||null;
    entry.values.forEach(function(cell,basisIndex){
      const key=importNorm(cell);
      let candidates=basisMap.get(key)||[];
      if(currentEstimate) candidates=candidates.filter(function(x){return x.estimate_id===currentEstimate.id;});
      const sourcePosition=String(entry.values[1]==null?"":entry.values[1]).trim();
      if(sourcePosition) candidates=candidates.filter(function(x){return String(x.position)===sourcePosition;});
      if(candidates.length!==1) return;
      const estimateRow=candidates[0];
      if(parsed.some(function(x){return x.estimate_row_id===estimateRow.id;})) return;
      let chosen=null;
      const quantityColumn=quantityColumns.get(entry.sheet);
      if(quantityColumn!=null){
        for(let offset=0;offset<=2;offset++){
          const candidateRow=rows[rowIndex+offset];
          if(!candidateRow||candidateRow.sheet!==entry.sheet) break;
          if(offset>0&&importNorm(candidateRow.values[2])) break;
          const number=excelNumber(candidateRow.values[quantityColumn]);
          if(number!=null&&number>=0){chosen={value:number,columnIndex:quantityColumn};break;}
        }
      }
      if(!chosen){
        const numeric=[];
        entry.values.forEach(function(value,columnIndex){
          const number=excelNumber(value);
          if(number!=null&&number>=0&&columnIndex!==basisIndex) numeric.push({value:number,columnIndex:columnIndex,score:headerScore(rows,rowIndex,columnIndex)+(columnIndex>basisIndex?1:0)});
        });
        numeric.sort(function(a,b){return b.score-a.score||a.columnIndex-b.columnIndex;});
        chosen=numeric[0];
      }
      if(!chosen){errors.push("Строка "+entry.rowNo+": не найдено количество для позиции "+estimateRow.position);return;}
      const linked=linkedSpecRowsForEstimateRow(estimateRow);
      const volumes=Array.from(new Set(linked.map(function(x){return Number(x.volumePerPiece||0);}).filter(function(x){return x>0;}).map(function(x){return x.toFixed(6);})));
      if(volumes.length!==1){errors.push("Строка "+entry.rowNo+": не определён единый объём панели для позиции "+estimateRow.position);return;}
      const volume=Number(volumes[0]);
      const cost=(dataState.estimateCosts||[]).find(function(x){return x.estimate_row_id===estimateRow.id;});
      parsed.push({estimate_row_id:estimateRow.id,source_row_no:entry.rowNo,basis:String(cell),quantity:chosen.value,quantity_m3:chosen.value*volume,amount:chosen.value*Number(cost&&cost.total_unit||0),raw_data:{sheet:entry.sheet,row:entry.values}});
    });
  });
  if(errors.length) throw new Error(errors.slice(0,8).join("\n"));
  if(!parsed.length) throw new Error("В файле не найдены материальные позиции, совпадающие с № сметы, позицией и обоснованием.");
  return {buffer:buffer,actNo:actNo,period:detectedPeriod,rows:parsed};
}

async function importAvrFile(file,period) {
  const control=document.querySelector("[data-avr-import]");
  if(control) control.disabled=true;
  try{
    const parsed=await parseAvrWorkbook(file,period);
    const hash=await sha256Hex(parsed.buffer);
    const result=await client.rpc("apply_avr_import",{
      p_project_id:dataState.project.id,p_period_month:periodDate(period),p_display_number:parsed.actNo,
      p_source_name:file.name,p_source_sha256:hash,p_rows:parsed.rows
    });
    if(result.error) throw result.error;
    ui.avr.period=period;ui.avr.versionId=result.data&&result.data.version_id||"";
    await refreshProjectDataSlices(["avrDocuments","avrVersions","avrRows","imports"],dataState.project);
    renderPage("avr",0);
  }catch(err){alert("Импорт АВР остановлен:\n"+(err&&err.message?err.message:String(err)));if(control) control.disabled=false;}
}

async function calculateS29() {
  const button=document.querySelector("[data-s29-calculate]");if(button)button.disabled=true;
  try{
    const result=await client.rpc("recalculate_s29",{p_project_id:dataState.project.id,p_period_month:periodDate(ui.s29.period)});
    if(result.error) throw result.error;
    await refreshProjectDataSlices(["s29Documents","s29Rows","s29Allocations","s29Carryovers","s29CarryoverSettlements"],dataState.project);renderPage("s29",0);
  }catch(err){alert("Расчёт С-29 не выполнен:\n"+(err&&err.message?err.message:String(err)));if(button)button.disabled=false;}
}

async function fixS29(documentId) {
  const ok=await executionConfirm("Фиксация С-29","Расчёт месяца станет неизменяемым снимком, а экономия и её погашение будут записаны в накопительный реестр.","Зафиксировать С-29");
  if(!ok) return;
  const result=await client.rpc("fix_s29",{p_project_id:dataState.project.id,p_document_id:documentId});
  if(result.error) throw result.error;
  await refreshProjectDataSlices(["s29Documents","s29Rows","s29Allocations","s29Carryovers","s29CarryoverSettlements"],dataState.project);renderPage("s29",0);
}

async function exportS29Excel() {
  try{await ensureXlsxLoaded();}catch(err){return alert(err&&err.message?err.message:String(err));}
  const doc=selectedS29Document();if(!doc) return;
  const catalog=new Map(dataState.catalogItems.map(function(x){return [x.id,x];}));
  const rows=(dataState.s29Rows||[]).filter(function(x){return x.document_id===doc.id;});
  const table2=[
    ["С-29 · Таблица 2"],["Объект",dataState.project&&dataState.project.name||"Филимонова"],["Отчётный месяц",periodLabel(doc.period_month,false)],["Статус",doc.status==="fixed"?"Зафиксирован":"Черновик"],[],
    ["Код материального ресурса","Наименование материала","Ед. изм.","Количество по производственным нормам, м³","Фактически списано, м³","Экономия, м³","Перерасход, м³","Примечание"]
  ];
  rows.forEach(function(r){const item=catalog.get(r.catalog_item_id)||{};table2.push([item.mark||"",(item.name||"")+"\n1 шт. = "+exFmt(r.volume_per_piece_snapshot_m3)+" м³; по АВР — "+exFmt0(r.avr_quantity_pieces)+" шт.","м³",Number(r.avr_quantity_m3||0),Number(r.written_off_m3||0),Number(r.economy_m3||0),Number(r.overrun_m3||0),r.note||""]);});
  table2.push([],['Материально ответственное лицо','',''],['Начальник участка','',''],['Дата составления',new Date().toLocaleDateString('ru-RU')]);
  const detail=[["Расшифровка экономии/перерасхода за "+periodLabel(doc.period_month,false)],[],["Марка","Наименование","Вид","Месяц происхождения","Возникло, м³","Погашено, м³","Остаток, м³"]];
  (dataState.s29Carryovers||[]).filter(function(x){return x.origin_document_id===doc.id;}).forEach(function(x){const item=catalog.get(x.catalog_item_id)||{};const settled=(dataState.s29CarryoverSettlements||[]).filter(function(s){return s.carryover_id===x.id;}).reduce(function(sum,s){return sum+Number(s.settled_m3||0);},0);detail.push([item.mark||"",item.name||"",x.kind==="economy"?"Экономия":"Перерасход",periodLabel(x.origin_month,false),Number(x.created_m3||0),settled,Number(x.created_m3||0)-settled]);});
  const registry=[["Реестр экономии/перерасхода (накопительный)"],[],["Месяц возникновения","Марка","Наименование","Вид","Возникло, м³","Погашено, м³","Месяц погашения","Остаток, м³"]];
  (dataState.s29Carryovers||[]).forEach(function(x){const item=catalog.get(x.catalog_item_id)||{};const settlements=(dataState.s29CarryoverSettlements||[]).filter(function(s){return s.carryover_id===x.id;});const settled=settlements.reduce(function(sum,s){return sum+Number(s.settled_m3||0);},0);registry.push([periodLabel(x.origin_month,false),item.mark||"",item.name||"",x.kind==="economy"?"Экономия":"Перерасход",Number(x.created_m3||0),settled,settlements.map(function(s){return periodLabel(s.settlement_month,false);}).join(", ")||"—",Number(x.created_m3||0)-settled]);});
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.aoa_to_sheet(table2);const ws2=XLSX.utils.aoa_to_sheet(detail);const ws3=XLSX.utils.aoa_to_sheet(registry);
  ws1['!cols']=[{wch:22},{wch:58},{wch:10},{wch:22},{wch:20},{wch:16},{wch:16},{wch:28}];ws2['!cols']=[{wch:16},{wch:48},{wch:18},{wch:20},{wch:16},{wch:16},{wch:16}];ws3['!cols']=[{wch:20},{wch:16},{wch:48},{wch:18},{wch:16},{wch:16},{wch:22},{wch:16}];
  XLSX.utils.book_append_sheet(wb,ws1,"С-29 (таблица 2)");XLSX.utils.book_append_sheet(wb,ws2,"Расшифровка "+periodKey(doc.period_month));XLSX.utils.book_append_sheet(wb,ws3,"Реестр экономии-перерасхода");
  XLSX.writeFile(wb,"С-29_"+periodKey(doc.period_month)+".xlsx");
}

function wireExecutionControls() {
  const period=document.querySelector("[data-avr-period]");
  if(period) period.onchange=function(){ui.avr.period=period.value;ui.avr.versionId="";localStorage.setItem("filimonova.avr.period",period.value);renderPage("avr",0);};
  const version=document.querySelector("[data-avr-version]");
  if(version) version.onchange=function(){ui.avr.versionId=version.value;rerenderContent();};
  const registry=document.querySelector("[data-avr-registry-period]");
  if(registry) registry.onchange=function(){ui.avr.registryPeriod=registry.value;localStorage.setItem("filimonova.avr.registryPeriod",registry.value);renderPage("avr",1);};
  const importButton=document.querySelector("[data-avr-import]");
  const fileInput=document.querySelector("[data-avr-file]");
  if(importButton&&fileInput){importButton.onclick=function(){fileInput.click();};fileInput.onchange=function(){const file=fileInput.files&&fileInput.files[0];if(file)importAvrFile(file,ui.avr.registryPeriod);};}
  document.querySelectorAll("[data-avr-use]").forEach(function(btn){btn.onclick=function(){btn.disabled=true;setAvrVersionState(btn.dataset.avrUse,"use").catch(function(err){alert(err.message||err);btn.disabled=false;});};});
  document.querySelectorAll("[data-avr-sign]").forEach(function(btn){btn.onclick=function(){btn.disabled=true;setAvrVersionState(btn.dataset.avrSign,"sign").catch(function(err){alert(err.message||err);btn.disabled=false;});};});
  document.querySelectorAll("[data-avr-unsign]").forEach(function(btn){btn.onclick=function(){btn.disabled=true;setAvrVersionState(btn.dataset.avrUnsign,"unsign").catch(function(err){alert(err.message||err);btn.disabled=false;});};});
  const s29=document.querySelector("[data-s29-period]");
  if(s29) s29.onchange=function(){ui.s29.period=s29.value;localStorage.setItem("filimonova.s29.period",s29.value);renderPage("s29",0);};
  const accountingPeriod=document.querySelector("[data-accounting-period]");
  if(accountingPeriod) accountingPeriod.onchange=function(){ui.s29.period=accountingPeriod.value;localStorage.setItem("filimonova.s29.period",accountingPeriod.value);renderPage("s29",1);};
  const accountingButton=document.querySelector("[data-accounting-import]");const accountingFile=document.querySelector("[data-accounting-file]");
  if(accountingButton&&accountingFile){accountingButton.onclick=function(){accountingFile.click();};accountingFile.onchange=function(){const file=accountingFile.files&&accountingFile.files[0];if(file)importAccountingFile(file,ui.s29.period);};}
  const accountingLinkFilter=document.querySelector("[data-accounting-link-filter]");
  if(accountingLinkFilter) accountingLinkFilter.onchange=function(){
    ui.accountingLinkFilter=accountingLinkFilter.value;
    localStorage.setItem("filimonova.accounting.linkFilter",ui.accountingLinkFilter);
    rerenderContent();
  };
  document.querySelectorAll("[data-accounting-link-edit]").forEach(function(btn){
    btn.onclick=function(e){e.stopPropagation();openAccountingLinkEditor(btn.dataset.accountingLinkEdit);};
  });
  const calculate=document.querySelector("[data-s29-calculate]");if(calculate)calculate.onclick=calculateS29;
  const fix=document.querySelector("[data-s29-fix]");if(fix)fix.onclick=function(){fix.disabled=true;fixS29(fix.dataset.s29Fix).catch(function(err){alert(err.message||err);fix.disabled=false;});};
  const excel=document.querySelector("[data-s29-excel]");if(excel)excel.onclick=exportS29Excel;
}
