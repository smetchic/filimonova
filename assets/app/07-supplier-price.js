function supplierMatchMark(value) {
  return importNorm(value).replace(/ё/g,"е").replace(/[()\s]/g,"");
}

function supplierMatchName(value) {
  return importNorm(value)
    .replace(/ё/g,"е")
    .replace(/\(\s*у\s*\)/g,"у");
}

// Supplier OCR comparison only: Cyrillic О, Latin O/o and digit 0 are
// treated as the same symbol. Original values and stable source_key stay unchanged.
function supplierCompareMark(value) {
  return supplierMatchMark(value).replace(/[оo0]/g,"0");
}

function supplierCompareName(value) {
  return supplierMatchName(value).replace(/[оo0]/g,"0");
}

function supplierNumericSignature(value) {
  return (supplierMatchName(value).match(/\d+/g)||[]).join("|");
}

function supplierAutoAttentionNotes(project,raw) {
  const notes=[];
  const projectMark=supplierMatchMark(project.mark);
  const supplierMark=supplierMatchMark(raw.source_mark);
  const projectName=supplierMatchName(project.name);
  const supplierName=supplierMatchName(raw.source_name);

  if(projectMark!==supplierMark){
    if(supplierCompareMark(project.mark)===supplierCompareMark(raw.source_mark)){
      notes.push("Марка: допустимая замена символов (например О/0)");
    }else{
      notes.push("Марка записана иначе");
    }
  }

  if(projectName!==supplierName){
    if(supplierCompareName(project.name)===supplierCompareName(raw.source_name)){
      notes.push("Наименование: допустимая замена символов (например О/0)");
    }else if(
      supplierNumericSignature(project.name) &&
      supplierNumericSignature(project.name)===supplierNumericSignature(raw.source_name)
    ){
      notes.push("Наименование записано иначе при совпадающих числах");
    }else{
      notes.push("Наименование отличается");
    }
  }
  return notes;
}

function supplierColumnLabel(table,header,col) {
  const parts=[];
  for(let r=Math.max(0,header-2);r<=Math.min(table.length-1,header+2);r++){
    const v=importText((table[r]||[])[col]);
    if(v) parts.push(v);
  }
  return importNorm(parts.join(" "));
}

function parseSupplierSpecWorkbook(buffer,fallbackDate) {
  if(!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const wb=XLSX.read(buffer,{type:"array",cellDates:false,cellFormula:false});
  let sheetName="",table=null,header=-1,markCol=-1,nameCol=-1;

  const preferred=wb.SheetNames.includes("24.08")
    ? ["24.08"].concat(wb.SheetNames.filter(function(x){return x!=="24.08";}))
    : wb.SheetNames.slice();

  for(const name of preferred){
    const t=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null,raw:true,blankrows:false});
    for(let i=0;i<Math.min(t.length,60);i++){
      const row=t[i]||[];
      const labels=row.map(importNorm);
      const p=labels.findIndex(function(x){return x==="позиция" || x==="марка" || x.includes("позиция");});
      const n=labels.findIndex(function(x){return x.includes("наименование");});
      if(p>=0 && n>=0){
        sheetName=name;table=t;header=i;markCol=p;nameCol=n;break;
      }
    }
    if(table) break;
  }
  if(!table) throw new Error("Не найдена таблица поставщика с колонками «Позиция/Марка» и «Наименование».");

  const maxCols=Math.max.apply(null,table.slice(Math.max(0,header-2),Math.min(table.length,header+8)).map(function(r){return (r||[]).length;}));
  const labels=Array.from({length:maxCols},function(_,c){return supplierColumnLabel(table,header,c);});

  let volumeCol=labels.findIndex(function(x,c){
    return c!==markCol && c!==nameCol && (x.includes("объем")||x.includes("объём")) &&
      (x.includes("ед")||x.includes("1")||x.includes("шт")||x.includes("м3")||x.includes("м³"));
  });
  if(volumeCol<0) volumeCol=nameCol+1;

  const priceCols=[];
  labels.forEach(function(label,col){
    if(col===markCol || col===nameCol || col===volumeCol) return;
    const year=(label.match(/\b(20\d{2})\b/)||[])[1];
    if(year && (label.includes("цен")||label.includes("стоим")||col===volumeCol+1||col===volumeCol+2)){
      priceCols.push({col:col,year:Number(year)});
    }
  });
  if(!priceCols.length){
    if(maxCols>volumeCol+1) priceCols.push({col:volumeCol+1,year:2026});
    if(maxCols>volumeCol+2) priceCols.push({col:volumeCol+2,year:2027});
  }

  let qtyHouseCol=labels.findIndex(function(x,c){
    return c!==markCol && c!==nameCol && c!==volumeCol &&
      (x.includes("колич")||x.includes("шт")) && (x.includes("дом")||x.includes("всего")||x.includes("итого"));
  });
  if(qtyHouseCol<0 && maxCols>volumeCol+3) qtyHouseCol=volumeCol+3;

  const sourceHeaders={
    number:importText((table[header]||[])[0])||"№ п/п",
    mark:importText((table[header]||[])[markCol])||"Позиция",
    name:importText((table[header]||[])[nameCol])||"Наименование изделия",
    volume:importText((table[header]||[])[volumeCol])||"Объём ед. изд., м³",
    price_group:priceCols.length?importText((table[header]||[])[priceCols[0].col])||"Цена за шт. с НДС":"Цена за шт. с НДС",
    price_labels:priceCols.map(function(pc){return {effective_from:String(pc.year)+"-01-01",label:importText((table[header+1]||[])[pc.col])||String(pc.year)};}),
    total_group:qtyHouseCol>=0?importText((table[header]||[])[qtyHouseCol])||"Всего на дом":"Всего на дом",
    quantity:qtyHouseCol>=0?importText((table[header+1]||[])[qtyHouseCol])||"шт.":"шт.",
    total_volume:qtyHouseCol>=0?importText((table[header+1]||[])[qtyHouseCol+1])||"м³":"м³",
    total_amount:qtyHouseCol>=0?importText((table[header+1]||[])[qtyHouseCol+2])||"руб.":"руб."
  };
  const totalVolumeCol=qtyHouseCol>=0&&qtyHouseCol+1<maxCols?qtyHouseCol+1:-1;
  const totalAmountCol=qtyHouseCol>=0&&qtyHouseCol+2<maxCols?qtyHouseCol+2:-1;
  const rows=[],counts={};
  let group="",section="",pendingHeading="";
  for(let i=header+1;i<table.length;i++){
    const raw=table[i]||[];
    const mark=importText(raw[markCol]);
    const name=importText(raw[nameCol]);
    if(!mark && !name) continue;

    const volume=estimateNumber(raw[volumeCol],"Строка "+(i+1)+", объём");
    const prices=priceCols.map(function(pc){
      const value=estimateNumber(raw[pc.col],"Строка "+(i+1)+", цена "+pc.year);
      return value==null ? null : {
        effective_from:String(pc.year)+"-01-01",
        price_basis:"piece",
        unit_price_gross:value
      };
    }).filter(Boolean);
    const qty=qtyHouseCol>=0 ? estimateNumber(raw[qtyHouseCol],"Строка "+(i+1)+", количество") : null;
    const totalVolume=totalVolumeCol>=0?estimateNumber(raw[totalVolumeCol],"Строка "+(i+1)+", общий объём"):null;
    const totalAmount=totalAmountCol>=0?estimateNumber(raw[totalAmountCol],"Строка "+(i+1)+", общая стоимость"):null;

    const looksSection=!mark && !!name && volume==null && !prices.length && qty==null && !/^(итого|всего)/i.test(name);
    if(looksSection){
      if(pendingHeading){group=pendingHeading;section=name;pendingHeading="";}
      else pendingHeading=name;
      continue;
    }
    if(!mark&&/^(итого|всего)/i.test(name)){
      const total={qty:qty,volume:totalVolume,amount:totalAmount};
      let field="source_section_total";
      if(/^всего\s+на\s+отметку/i.test(name)) field="source_group_total";
      else if(/^всего\s+на\s+дом/i.test(name)) field="source_grand_total";
      if(field==="source_grand_total"){
        rows.forEach(function(row){row[field]=total;});
      }else{
        for(let j=rows.length-1;j>=0;j--){
          const row=rows[j];
          if(field==="source_section_total" && (row.source_group!==group || row.source_section!==section)) break;
          if(field==="source_group_total" && row.source_group!==group) break;
          row[field]=total;
        }
      }
      continue;
    }
    if(!mark || !name) continue;

    if(pendingHeading){section=pendingHeading;pendingHeading="";}

    if(!prices.length){
      const genericPriceCol=labels.findIndex(function(x,c){
        return c!==markCol && c!==nameCol && c!==volumeCol && (x.includes("цен")||x.includes("стоим"));
      });
      if(genericPriceCol>=0){
        const value=estimateNumber(raw[genericPriceCol],"Строка "+(i+1)+", цена");
        if(value!=null) prices.push({effective_from:fallbackDate,price_basis:"piece",unit_price_gross:value});
      }
    }

    const base=supplierMatchName(section)+"|"+supplierMatchMark(mark)+"|"+supplierMatchName(name);
    counts[base]=(counts[base]||0)+1;
    rows.push({
      source_row_no:i+1,
      source_key:base+"#"+counts[base],
      source_position:importText(raw[0]),
      source_mark:mark,
      source_name:name,
      source_group:group,
      source_section:section,
      unit_volume_m3:volume,
      qty_house:qty,
      source_total_volume_m3:totalVolume,
      source_total_gross:totalAmount,
      source_headers:sourceHeaders,
      prices:prices
    });
  }
  if(!rows.length) throw new Error("В файле поставщика не найдено товарных позиций.");

  return {
    sheetName:sheetName,
    rows:rows,
    priceYears:Array.from(new Set(rows.flatMap(function(r){return r.prices.map(function(p){return p.effective_from.slice(0,4);});}))).sort()
  };
}

function supplierProjectFacts() {
  const facts=new Map();
  specJoinedRows().forEach(function(sr){
    if(!facts.has(sr.catalog_item_id)) facts.set(sr.catalog_item_id,{qty:0,volumes:new Set()});
    const f=facts.get(sr.catalog_item_id);
    f.qty+=Number(sr.total||0);
    if(Number(sr.volumePerPiece)>0) f.volumes.add(Number(sr.volumePerPiece));
  });
  facts.forEach(function(f){f.volume=f.volumes.size===1?Array.from(f.volumes)[0]:null;});
  return facts;
}

function previewSupplierSpec(parsed,supplierName) {
  const catalog=dataState.catalogItems;
  const facts=supplierProjectFacts();
  const itemsForSupplier=dataState.supplierItems.filter(function(si){
    const supplier=dataState.suppliers.find(function(s){return s.id===si.supplier_id;});
    return supplier && supplierMatchName(supplier.name)===supplierMatchName(supplierName);
  });
  const bySource=new Map(itemsForSupplier.map(function(x){return [x.source_key,x];}));
  const result={
    rows:parsed.rows.length,matched:0,newOrChanged:0,withoutPrice:0,
    supplierOnly:0,requiresReview:0,volumeConflicts:0,qtyConflicts:0
  };
  const resolved=[];

  parsed.rows.forEach(function(row){
    const old=bySource.get(row.source_key);
    let catalogId=null,state="";
    if(old && old.link_method==="manual" && old.catalog_item_id){
      catalogId=old.catalog_item_id;state="matched";
    }else{
      const both=catalog.filter(function(ci){
        return supplierCompareMark(ci.mark)===supplierCompareMark(row.source_mark) &&
          supplierCompareName(ci.name)===supplierCompareName(row.source_name);
      });
      const byMark=catalog.filter(function(ci){return supplierCompareMark(ci.mark)===supplierCompareMark(row.source_mark);});
      const byName=catalog.filter(function(ci){return supplierCompareName(ci.name)===supplierCompareName(row.source_name);});
      if(both.length===1){catalogId=both[0].id;state="matched";}
      else if(both.length>1){state="review";}
      else if(byMark.length || byName.length){state="review";}
      else state="supplier_only";
    }

    let review=state==="review";
    if(state==="supplier_only") result.supplierOnly++;
    if(catalogId){
      const f=facts.get(catalogId);
      if(row.unit_volume_m3!=null && f && f.volume!=null && Math.abs(Number(row.unit_volume_m3)-Number(f.volume))>1e-6){
        result.volumeConflicts++; review=true;
      }
      if(row.qty_house!=null && f && Math.abs(Number(row.qty_house)-Number(f.qty))>1e-6){
        result.qtyConflicts++; review=true;
      }
      if(!review) result.matched++;
    }
    if(review) result.requiresReview++;
    if(!row.prices.length) result.withoutPrice++;

    let changed=false;
    if(row.prices.length){
      if(!old) changed=true;
      else{
        const existing=dataState.supplierPrices.filter(function(p){return p.supplier_item_id===old.id;});
        changed=row.prices.some(function(p){
          return !existing.some(function(ep){
            return ep.effective_from===p.effective_from &&
              ep.price_basis===p.price_basis &&
              Math.abs(Number(ep.unit_price_gross)-Number(p.unit_price_gross))<1e-9;
          });
        });
      }
    }
    if(changed) result.newOrChanged++;
    resolved.push({row:row,catalogId:catalogId,state:state,review:review});
  });

  const priceKeys=new Map();
  resolved.forEach(function(x){
    if(!x.catalogId) return;
    x.row.prices.forEach(function(p){
      const key=x.catalogId+"|"+p.effective_from+"|"+p.price_basis;
      if(!priceKeys.has(key)) priceKeys.set(key,new Set());
      priceKeys.get(key).add(String(p.unit_price_gross));
    });
  });
  priceKeys.forEach(function(values){
    if(values.size>1) result.requiresReview++;
  });

  return result;
}

function supplierImportModal() {
  let modal=document.getElementById("supplierImportModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="supplierImportModal";
  modal.className="spec-import-backdrop";
  modal.innerHTML=
    '<div class="spec-import-modal supplier-import-modal">'+
      '<div class="spec-import-head"><div><strong>Импорт прайса поставщика</strong><span>Структура и исходные значения сохраняются как новая версия; Рабочая сводка не изменяется</span></div><button class="spec-import-close" type="button">×</button></div>'+
      '<div class="supplier-import-fields">'+
        '<label><span>Поставщик</span><input class="supplier-name-input" type="text" placeholder="Наименование поставщика"></label>'+
        '<label><span>Дата для цены без года</span><input class="supplier-date-input" type="date"></label>'+
        '<input class="supplier-spec-file" type="file" accept=".xlsx,.xls,.xlsm">'+
        '<button class="context-link supplier-file-pick" type="button">Выбрать Excel</button>'+
      '</div>'+
      '<div class="spec-import-preview hidden"></div>'+
      '<div class="spec-import-foot"><span class="spec-import-state"></span><span class="spacer"></span><button class="context-link supplier-import-close" type="button">Закрыть</button><button class="context-link supplier-import-apply" type="button" disabled>Применить импорт</button></div>'+
    '</div>';
  document.body.appendChild(modal);
  const close=function(){modal.classList.remove("open");};
  modal.querySelector(".spec-import-close").onclick=close;
  modal.querySelector(".supplier-import-close").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector(".supplier-file-pick").onclick=function(){
    const input=modal.querySelector(".supplier-spec-file");input.value="";input.click();
  };
  modal.querySelector(".supplier-spec-file").onchange=function(e){
    if(e.target.files&&e.target.files[0]) prepareSupplierSpecImport(e.target.files[0]);
  };
  modal.querySelector(".supplier-name-input").oninput=function(){
    if(ui.pendingSupplierImport) renderSupplierImportPreview();
  };
  modal.querySelector(".supplier-import-apply").onclick=applyPendingSupplierImport;
  return modal;
}

function renderSupplierImportPreview() {
  const modal=supplierImportModal();
  const pending=ui.pendingSupplierImport;
  if(!pending) return;
  const supplierName=modal.querySelector(".supplier-name-input").value.trim();
  const preview=modal.querySelector(".spec-import-preview");
  const apply=modal.querySelector(".supplier-import-apply");
  if(!supplierName){
    preview.innerHTML='<strong>Укажите поставщика</strong><span>Импорт пока нельзя применить</span>';
    preview.classList.remove("hidden");apply.disabled=true;return;
  }
  const r=previewSupplierSpec(pending.parsed,supplierName);
  pending.preview=r;
  preview.innerHTML=
    '<strong>'+esc(pending.fileName)+'</strong>'+
    '<span>'+r.rows+' позиций</span>'+
    '<span>'+r.matched+' сопоставлено</span>'+
    '<span>'+r.newOrChanged+' новая/изменённая цена</span>'+
    '<span>'+r.withoutPrice+' без цены</span>'+
    '<span>'+r.supplierOnly+' только у поставщика</span>'+
    '<span>'+r.requiresReview+' требует проверки</span>'+
    '<span>лист «'+esc(pending.parsed.sheetName)+'»</span>';
  preview.classList.remove("hidden");
  apply.disabled=false;
}

async function prepareSupplierSpecImport(file) {
  await ensureXlsxLoaded();
  const modal=supplierImportModal();
  const state=modal.querySelector(".spec-import-state");
  const preview=modal.querySelector(".spec-import-preview");
  const apply=modal.querySelector(".supplier-import-apply");
  apply.disabled=true;state.textContent="Читаю Excel…";preview.classList.add("hidden");
  try{
    const buffer=await file.arrayBuffer();
    const fallbackDate=modal.querySelector(".supplier-date-input").value || new Date().toISOString().slice(0,10);
    const parsed=parseSupplierSpecWorkbook(buffer,fallbackDate);
    const hash=await sha256Hex(buffer);
    ui.pendingSupplierImport={fileName:file.name,hash:hash,parsed:parsed};
    state.textContent="Проверка выполнена";
    renderSupplierImportPreview();
  }catch(err){
    ui.pendingSupplierImport=null;
    state.textContent="Ошибка проверки";
    preview.innerHTML='<strong>Импорт остановлен</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
    preview.classList.remove("hidden");
  }
}

async function applyPendingSupplierImport() {
  const pending=ui.pendingSupplierImport;
  if(!pending || !dataState.project) return;
  const modal=supplierImportModal();
  const state=modal.querySelector(".spec-import-state");
  const preview=modal.querySelector(".spec-import-preview");
  const apply=modal.querySelector(".supplier-import-apply");
  const supplierName=modal.querySelector(".supplier-name-input").value.trim();
  if(!supplierName){renderSupplierImportPreview();return;}
  apply.disabled=true;state.textContent="Записываю прайс поставщика…";
  try{
    const result=await client.rpc("apply_supplier_spec_import",{
      p_project_id:dataState.project.id,
      p_source_name:pending.fileName,
      p_source_sha256:pending.hash,
      p_supplier_name:supplierName,
      p_rows:pending.parsed.rows
    });
    if(result.error) throw result.error;
    const report=result.data||{};
    ui.pendingSupplierImport=null;
    await refreshProjectDataSlices(["suppliers","supplierItems","supplierPrices","supplierPriceLinks","supplierPriceJournal","supplierSnapshotRows","supplierControlJournal","imports"],dataState.project);
    renderPage("supply",2);
    state.textContent="Импорт завершён";
    preview.innerHTML=
      '<strong>Прайс поставщика загружен</strong>'+
      '<span>'+esc(String(report.rows||0))+' позиций</span>'+
      '<span>'+esc(String(report.matched||0))+' сопоставлено</span>'+
      '<span>'+esc(String(report.new_or_changed_price||0))+' новая/изменённая цена</span>'+
      '<span>'+esc(String(report.without_price||0))+' без цены</span>'+
      '<span>'+esc(String(report.supplier_only||0))+' только у поставщика</span>'+
      '<span>'+esc(String(report.requires_review||0))+' требует проверки</span>';
    preview.classList.remove("hidden");
  }catch(err){
    state.textContent="Ошибка импорта";
    preview.innerHTML='<strong>Не удалось записать прайс поставщика</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
    preview.classList.remove("hidden");
    apply.disabled=false;
  }
}

function openSupplierImportModal() {
  const modal=supplierImportModal();
  ui.pendingSupplierImport=null;
  modal.querySelector(".supplier-name-input").value=dataState.suppliers.length===1?dataState.suppliers[0].name:"";
  modal.querySelector(".supplier-date-input").value=new Date().toISOString().slice(0,10);
  modal.querySelector(".spec-import-preview").classList.add("hidden");
  modal.querySelector(".supplier-import-apply").disabled=true;
  modal.querySelector(".spec-import-state").textContent="";
  modal.classList.add("open");
}

function supplierCheckModal() {
  let modal=document.getElementById("supplierCheckModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="supplierCheckModal";
  modal.className="spec-import-backdrop supplier-check-backdrop";
  modal.innerHTML='<div class="supplier-check-modal">'+
    '<div class="spec-import-head"><div><strong>Проверка прайса поставщика</strong><span>Спецификация ↔ immutable-версия прайса</span></div><button class="spec-import-close" type="button">×</button></div>'+
    '<div class="supplier-check-tabs"><button type="button" data-supplier-check-tab="recon">Сверка</button><button type="button" data-supplier-check-tab="journal">Журнал</button></div>'+
    '<div class="supplier-check-content"></div></div>';
  document.body.appendChild(modal);
  const close=function(){modal.classList.remove("open");};
  modal.querySelector(".spec-import-close").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelectorAll("[data-supplier-check-tab]").forEach(function(btn){
    btn.onclick=function(){ui.supplierCheckTab=btn.dataset.supplierCheckTab;ui.supplierCheckCatalog="";renderSupplierCheck();};
  });
  return modal;
}

function latestSupplierSnapshotRows() {
  const all=dataState.supplierSnapshotRows||[];
  if(!all.length) return [];
  const latest=all.slice().sort(function(a,b){return String(b.imported_at).localeCompare(String(a.imported_at));})[0].import_id;
  return all.filter(function(x){return x.import_id===latest;});
}

function supplierScopeNorm(value) {
  return String(value==null?"":value).toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();
}

function supplierProjectScopeKey(zone,sectionName) {
  return supplierScopeNorm(zone)+"|"+supplierScopeNorm(sectionName);
}

function supplierSourceScopeKey(row) {
  const raw=row&&row.raw_data||row||{};
  const group=supplierScopeNorm(raw.source_group);
  const section=supplierScopeNorm(raw.source_section);
  let zone="";
  if(group.indexOf("ниже отметки")>=0 || group.indexOf("цокол")>=0) zone="цоколь";
  else if(group.indexOf("выше отметки")>=0 || group.indexOf("выше 0.000")>=0) zone="выше 0.000";
  else if(group.indexOf("лестниц")>=0 || section.indexOf("элемент")>=0&&section.indexOf("лестниц")>=0) zone="лестницы";
  return zone+"|"+section;
}

function supplierLinkScopeKey(link,snapshot) {
  if(link&&link.scope_key) return link.scope_key;
  const source=link&&snapshot?snapshot.find(function(x){return x.supplier_item_id===link.supplier_item_id;}):null;
  return source?supplierSourceScopeKey(source):"";
}

function supplierCheckProjectRows() {
  return buildWorkingSummaryRows().filter(function(r){return !!r.catalogItemId;}).map(function(r){
    const qty=summaryProjectQty(r);
    const volume=Number(r.volumePerPiece)>0?Number(r.volumePerPiece):null;
    const scopeKey=supplierProjectScopeKey(r.zone,r.sectionName);
    return {
      catalogItemId:r.catalogItemId,
      projectKey:r.catalogItemId+"::"+scopeKey,
      scopeKey:scopeKey,
      zone:r.zone,
      sectionName:r.sectionName,
      mark:r.mark,
      name:r.name,
      qty:qty,
      volume:volume
    };
  });
}

function supplierCandidateScore(project,row) {
  const raw=row.raw_data||{};
  let score=0;
  const pm=supplierCompareMark(project.mark),sm=supplierCompareMark(raw.source_mark);
  const pn=supplierCompareName(project.name),sn=supplierCompareName(raw.source_name);
  const sourceScope=supplierSourceScopeKey(row);
  if(sourceScope&&project.scopeKey===sourceScope) score+=5000;
  else if(sourceScope) score-=1200;
  if(pm===sm) score+=1000;
  if(pn===sn) score+=1200;
  if(pm&&sm&&(pm.includes(sm)||sm.includes(pm))) score+=180;
  const pt=new Set(pn.split(/[^a-zа-яё0-9]+/i).filter(Boolean));
  const st=new Set(sn.split(/[^a-zа-яё0-9]+/i).filter(Boolean));
  let common=0;pt.forEach(function(t){if(st.has(t)) common++;});
  score+=common*20;
  return score;
}

function supplierAbsenceAllowed(project) {
  const name=String(project&&project.name||"").replace(/\u00a0/g," ").trim().toLowerCase();
  return name.indexOf("лестничная площадка")===0 ||
    name.indexOf("лестничный марш")===0;
}

function supplierCheckRow(project,snapshot) {
  const link=(dataState.supplierPriceLinks||[]).find(function(x){
    return x.catalog_item_id===project.catalogItemId && supplierLinkScopeKey(x,snapshot)===project.scopeKey;
  });
  const source=link?snapshot.find(function(x){return x.supplier_item_id===link.supplier_item_id;}):null;
  const raw=source&&source.raw_data||{};
  const prices=Array.isArray(raw.prices)?raw.prices:[];
  const piecePrices=prices.filter(function(p){return (p.price_basis||"piece")==="piece";});
  const m3Prices=prices.filter(function(p){return p.price_basis==="m3";});
  const piecePrice=supplierApplicablePrice(piecePrices);
  const m3Price=supplierApplicablePrice(m3Prices);
  const piece=piecePrice?Number(piecePrice.unit_price_gross):null;
  const supplierVolume=raw.unit_volume_m3==null?null:Number(raw.unit_volume_m3);
  const perM3=m3Price?Number(m3Price.unit_price_gross):(piece!=null&&supplierVolume>0?piece/supplierVolume:null);
  const reasons=[];
  const candidates=snapshot.map(function(s){return {row:s,score:supplierCandidateScore(project,s)};}).filter(function(x){return x.score>0;}).sort(function(a,b){return b.score-a.score;});
  const absenceAllowed=!link&&supplierAbsenceAllowed(project);
  if(link&&!source) reasons.push("Нет в новой версии");
  if(absenceAllowed) reasons.push("Допустимое отсутствие у поставщика");
  else if(!link && candidates.length>1) reasons.push("Несколько кандидатов");
  else if(!link && candidates.length<=1) reasons.push("Нет подтверждённой связи");
  const autoAttentionNotes=source&&link&&link.link_method==="auto"
    ? supplierAutoAttentionNotes(project,raw)
    : [];
  const projectNums=supplierNumericSignature(project.name);
  const supplierNums=source?supplierNumericSignature(raw.source_name):"";
  const numericDesignationMismatch=!!(
    source&&link&&link.link_method==="auto"&&
    projectNums&&supplierNums&&projectNums!==supplierNums
  );
  if(source){
    if(supplierCompareMark(project.mark)!==supplierCompareMark(raw.source_mark)) reasons.push("Марка");
    if(supplierCompareName(project.name)!==supplierCompareName(raw.source_name)) reasons.push("Наименование");
    autoAttentionNotes.forEach(function(note){
      if(!reasons.includes(note)) reasons.push(note);
    });
    if(numericDesignationMismatch){
      reasons.push("Числа в обозначении: "+projectNums+" ≠ "+supplierNums);
    }
    if(!prices.length) reasons.push("Без цены");
    if(new Set(prices.map(function(p){return String(p.effective_from)+"|"+String(p.unit_price_gross);})).size!==prices.length) reasons.push("Несколько цен");
    if(raw.qty_house!=null&&Math.abs(Number(raw.qty_house)-project.qty)>1e-6) reasons.push("Количество: "+fmt0(raw.qty_house)+" ≠ "+fmt0(project.qty));
    if(supplierVolume!=null&&project.volume!=null&&Math.abs(supplierVolume-project.volume)>1e-6) reasons.push("Объём: "+fmt(supplierVolume)+" ≠ "+fmt(project.volume));
  }
  const currentImport=source&&source.import_id;
  const changed=(dataState.supplierPriceJournal||[]).some(function(j){return j.import_id===currentImport&&j.catalog_item_id===project.catalogItemId&&j.event_type==="price_changed";});
  if(changed) reasons.push("Изменена цена");
  let status="Сопоставлено";
  const manualConfirmed=!!(link&&source&&link.link_method==="manual"&&link.validation_state==="confirmed");
  if(absenceAllowed) status="Не является ошибкой";
  else if(!link || (link&&link.validation_state==="review") || (!source&&link&&link.validation_state!=="confirmed")) status="Требует проверки";
  else if(!source) status="Нет в новой версии";
  else if(!prices.length) status="Без цены";
  else if(changed) status="Изменена цена";
  else if(numericDesignationMismatch) status="Требует проверки";
  else if(manualConfirmed) status="Сопоставлено вручную";
  else if(raw.qty_house!=null&&Math.abs(Number(raw.qty_house)-project.qty)>1e-6) status="Расхождение количества";
  else if(supplierVolume!=null&&project.volume!=null&&Math.abs(supplierVolume-project.volume)>1e-6) status="Расхождение объёма";
  else if(autoAttentionNotes.length) status="Сопоставлено с замечанием";
  return {project:project,link:link,source:source,raw:raw,prices:prices,piece:piece,perM3:perM3,status:status,reasons:reasons,candidates:candidates};
}

function supplierStatusClass(status) {
  if(status==="Сопоставлено"||status==="Сопоставлено вручную") return "ok";
  if(status==="Не является ошибкой") return "none";
  if(status==="Изменена цена"||status.indexOf("Расхождение")===0||status==="Требует проверки"||status==="Сопоставлено с замечанием") return "review";
  return "none";
}

function supplierEventLabel(type) {
  return ({automatic_exact_link:"Точное сопоставление",manual_link_created:"Создана ручная связь",manual_link_changed:"Изменена ручная связь",manual_link_removed:"Снята ручная связь",ambiguous_confirmed:"Спорное соответствие подтверждено",price_changed:"Изменена цена",missing_in_new_version:"Нет в новой версии",supplier_only_appeared:"Новая позиция только у поставщика",saved_link_rechecked:"Сохранённая связь проверена",source_changed:"Изменены исходные данные",quantity_changed:"Изменено количество",volume_changed:"Изменён объём"})[type]||type;
}

function supplierValueText(value) {
  if(value==null) return "—";
  if(typeof value!=="object") return String(value);
  if(value.price!=null) return money(value.price);
  if(value.source_mark||value.source_name) return [value.source_mark,value.source_name].filter(Boolean).join(" · ");
  if(value.supplier_item_id) return String(value.supplier_item_id).slice(0,8);
  if(value.present===false) return "Не найдено";
  if(value.previous_price_continues) return "Предыдущая цена действует";
  return Object.keys(value).length?JSON.stringify(value):"—";
}

function supplierControlJournalEntry(catalogId,supplierItemId) {
  return (dataState.supplierControlJournal||[]).find(function(j){
    if(j.status!=="open") return false;
    if(catalogId && j.catalog_item_id===catalogId) return true;
    if(supplierItemId && j.supplier_item_id===supplierItemId) return true;
    return false;
  })||null;
}

function supplierControlJournalCheckboxHtml(catalogId,supplierItemId) {
  const checked=!!supplierControlJournalEntry(catalogId,supplierItemId);
  return '<input class="table-checkbox" type="checkbox" data-supplier-control-journal data-catalog-id="'+esc(catalogId||"")+'" data-supplier-item-id="'+esc(supplierItemId||"")+'" '+(checked?'checked ':'')+'aria-label="Запись в журнале">';
}

async function setSupplierControlJournal(catalogId,supplierItemId,enabled,input) {
  if(!dataState.project) return;
  input.disabled=true;
  const existing=(dataState.supplierControlJournal||[]).filter(function(j){
    if(j.status!=="open") return false;
    return (catalogId&&j.catalog_item_id===catalogId)||(supplierItemId&&j.supplier_item_id===supplierItemId);
  });
  try{
    if(enabled){
      if(!existing.length){
        const snapshotRows=latestSupplierSnapshotRows();
        const project=catalogId?supplierCheckProjectRows().find(function(x){return x.catalogItemId===catalogId;}):null;
        const link=catalogId?(dataState.supplierPriceLinks||[]).find(function(x){return x.catalog_item_id===catalogId;}):null;
        const actualSupplierItemId=supplierItemId||(link&&link.supplier_item_id)||"";
        const source=actualSupplierItemId?snapshotRows.find(function(x){return x.supplier_item_id===actualSupplierItemId;}):null;
        const raw=source&&source.raw_data||{};
        const model=project?supplierCheckRow(project,snapshotRows):null;
        const reasons=model&&model.reasons.length?model.reasons.slice():(source?["Только у поставщика"]:["Добавлено пользователем"]);
        const payload={
          project_id:dataState.project.id,
          catalog_item_id:catalogId||null,
          supplier_item_id:actualSupplierItemId||null,
          issue_key:catalogId?("catalog:"+catalogId):("supplier:"+actualSupplierItemId),
          reasons:reasons,
          status:"open",
          snapshot:{
            project_mark:project&&project.mark||null,
            project_name:project&&project.name||null,
            project_quantity:project?project.qty:null,
            project_volume_m3:project?project.volume:null,
            supplier_row_no:source&&source.source_row_no||null,
            supplier_mark:raw.source_mark||null,
            supplier_name:raw.source_name||null,
            supplier_quantity:raw.qty_house==null?null:Number(raw.qty_house),
            supplier_volume_m3:raw.unit_volume_m3==null?null:Number(raw.unit_volume_m3),
            supplier_piece_price:model&&model.piece!=null?model.piece:null,
            supplier_m3_price:model&&model.perM3!=null?model.perM3:null,
            discrepancy:model&&model.reasons.length?model.reasons.join(" · "):(source?"Только у поставщика":"Добавлено пользователем")
          }
        };
        const result=await client.from("supplier_price_control_journal").insert(payload)
          .select("id,catalog_item_id,supplier_item_id,issue_key,reasons,status,snapshot,created_at,updated_at").single();
        if(result.error) throw result.error;
        if(!dataState.supplierControlJournal) dataState.supplierControlJournal=[];
        dataState.supplierControlJournal.unshift(result.data);
      }
    }else if(existing.length){
      const ids=existing.map(function(x){return x.id;});
      const result=await client.from("supplier_price_control_journal").delete().in("id",ids);
      if(result.error) throw result.error;
      dataState.supplierControlJournal=(dataState.supplierControlJournal||[]).filter(function(j){return !ids.includes(j.id);});
    }
  }catch(err){
    console.error(err);
    input.checked=!enabled;
    alert("Не удалось изменить Журнал: "+(err.message||err));
  }finally{
    input.disabled=false;
  }
}

function renderSupplierCheckJournal(content) {
  const snapshotRows=latestSupplierSnapshotRows();
  const projects=supplierCheckProjectRows();
  const rows=(dataState.supplierControlJournal||[]).filter(function(j){return j.status==="open";});
  let body=rows.map(function(j){
    const snap=j.snapshot||{};
    const link=(dataState.supplierPriceLinks||[]).find(function(x){
      return (j.catalog_item_id&&x.catalog_item_id===j.catalog_item_id)||(j.supplier_item_id&&x.supplier_item_id===j.supplier_item_id);
    });
    const catalogId=j.catalog_item_id||(link&&link.catalog_item_id)||"";
    const supplierItemId=j.supplier_item_id||(link&&link.supplier_item_id)||"";
    const project=catalogId?projects.find(function(x){return x.catalogItemId===catalogId;}):null;
    const source=supplierItemId?snapshotRows.find(function(x){return x.supplier_item_id===supplierItemId;}):null;
    const raw=source&&source.raw_data||{};
    const model=project?supplierCheckRow(project,snapshotRows):null;

    const projectMark=project?project.mark:(snap.project_mark||"");
    const projectName=project?project.name:(snap.project_name||"");
    const projectQty=project?Number(project.qty):snap.project_quantity;
    const projectVol=project?project.volume:snap.project_volume_m3;
    const supplierRow=source?source.source_row_no:snap.supplier_row_no;
    const supplierMark=source?(raw.source_mark||""):(snap.supplier_mark||"");
    const supplierName=source?(raw.source_name||""):(snap.supplier_name||"");
    const supplierQty=source?(raw.qty_house==null?null:Number(raw.qty_house)):snap.supplier_quantity;
    const supplierVol=source?(raw.unit_volume_m3==null?null:Number(raw.unit_volume_m3)):snap.supplier_volume_m3;
    const piece=model&&model.piece!=null?model.piece:snap.supplier_piece_price;
    const perM3=model&&model.perM3!=null?model.perM3:snap.supplier_m3_price;
    const diff=projectQty==null||supplierQty==null?null:Number(projectQty)-Number(supplierQty);
    const discrepancy=model
      ? (model.reasons.length?model.reasons.join(" · "):"Нет")
      : (snap.discrepancy||((j.reasons||[]).join(" · "))||"Только у поставщика");

    return '<tr class="data-row">'+
      '<td>'+journalNameDiffHtml(projectMark,supplierMark)+'</td>'+
      '<td class="journal-name-cell">'+journalNameDiffHtml(projectName,supplierName)+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(projectQty==null?"—":fmt0(projectQty))+'</td>'+
      '<td class="num">'+(projectVol==null?"—":fmt(projectVol))+'</td>'+
      '<td class="center">'+esc(supplierRow==null?"—":supplierRow)+'</td>'+
      '<td>'+journalNameDiffHtml(supplierMark,projectMark)+'</td>'+
      '<td class="journal-name-cell">'+journalNameDiffHtml(supplierName,projectName)+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(supplierQty==null?"—":fmt0(supplierQty))+'</td>'+
      '<td class="num">'+(supplierVol==null?"—":fmt(supplierVol))+'</td>'+
      '<td class="num">'+(piece==null?"—":money(piece))+'</td>'+
      '<td class="num">'+(perM3==null?"—":money(perM3))+'</td>'+
      '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(diff==null?"—":fmt0(diff))+'</td>'+
      '<td>'+esc(discrepancy)+'</td>'+
      '<td><button class="table-text-action" type="button" data-supplier-journal-remove="'+esc(j.id)+'">Убрать</button></td>'+
    '</tr>';
  }).join("");

  if(!body) body=tableMessage("В журнал ещё не добавлены контрольные записи.",14);
  content.innerHTML=
    '<div class="engineering-scroll"><table class="eng-table journal-table supplier-control-journal" data-table-key="supplier-control-journal-v1">'+
    '<thead><tr><th colspan="4">Спецификация</th><th colspan="7">Прайс поставщика</th><th colspan="3">Контроль</th></tr>'+
    '<tr><th>Марка</th><th>Наименование по спецификации</th><th>Проект, шт.</th><th>Объём за ед., м³</th>'+
    '<th>№ поставщика</th><th>Марка поставщика</th><th>Наименование поставщика</th><th>Поставщик, шт.</th><th>Объём за ед., м³</th><th>Цена за 1 шт.</th><th>Цена за 1 м³</th>'+
    '<th>Разница, шт.</th><th>Расхождение</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div>';

  content.querySelectorAll("[data-supplier-journal-remove]").forEach(function(btn){
    btn.onclick=async function(){
      const j=(dataState.supplierControlJournal||[]).find(function(x){return x.id===btn.dataset.supplierJournalRemove;});
      if(!j) return;
      btn.disabled=true;
      try{
        const result=await client.from("supplier_price_control_journal").delete().eq("id",j.id);
        if(result.error) throw result.error;
        dataState.supplierControlJournal=(dataState.supplierControlJournal||[]).filter(function(x){return x.id!==j.id;});
        renderSupplierCheck();
      }catch(err){
        console.error(err);
        alert("Не удалось убрать запись из Журнала: "+(err.message||err));
        btn.disabled=false;
      }
    };
  });
}

function renderSupplierCheckRecon(content) {
  if(!ui.supplierCheckStatus) ui.supplierCheckStatus="all";
  const snapshot=latestSupplierSnapshotRows().slice().sort(function(a,b){
    const an=Number(a.source_row_no),bn=Number(b.source_row_no);
    if(Number.isFinite(an)&&Number.isFinite(bn)&&an!==bn) return an-bn;
    return String(a.source_row_no||"").localeCompare(String(b.source_row_no||""),"ru",{numeric:true});
  });
  const rows=supplierCheckProjectRows().map(function(p){return supplierCheckRow(p,snapshot);});
  const linkedBySupplierItem=new Map();
  rows.forEach(function(x){if(x.source&&x.link) linkedBySupplierItem.set(x.link.supplier_item_id,x);});
  let displayNo=0;
  function projectRowHtml(x) {
    const r=x.raw||{};
    displayNo++;
    const rowKey=x.source&&x.source.supplier_item_id?"supplier:"+x.source.supplier_item_id:"project:"+x.project.projectKey;
    return '<tr class="data-row" data-supplier-check-key="'+esc(rowKey)+'"><td class="center">'+displayNo+'</td><td>'+esc(x.project.mark)+'</td><td>'+esc(x.project.name)+'</td><td class="num">'+fmt0(x.project.qty)+'</td><td class="num">'+(x.project.volume==null?'—':fmt(x.project.volume))+'</td><td class="num">'+(x.project.volume==null?'—':fmt(x.project.qty*x.project.volume))+'</td>'+
      '<td class="center">'+(x.source?esc(x.source.source_row_no):'—')+'</td><td>'+esc(r.source_mark||"")+'</td><td>'+esc(r.source_name||"")+'</td><td class="num">'+(r.qty_house==null?'—':fmt0(r.qty_house))+'</td><td class="num '+(x.reasons.some(function(v){return v.indexOf("Объём:")===0;})?'warning':'')+'">'+(r.unit_volume_m3==null?'—':fmt(r.unit_volume_m3))+'</td><td class="num">'+(x.piece==null?'—':money(x.piece))+'</td><td class="num">'+(x.perM3==null?'—':money(x.perM3))+'</td>'+
      '<td><span class="price-state '+supplierStatusClass(x.status)+'">'+esc(x.status)+'</span></td><td>'+esc(x.link?(x.link.link_method==="manual"?"Вручную":"Авто"):"—")+'</td><td class="supplier-check-reasons">'+esc(x.reasons.length?x.reasons.join(" · "):"Нет")+'</td>'+
      '<td class="center">'+supplierControlJournalCheckboxHtml(x.project.catalogItemId,x.source&&x.source.supplier_item_id||"")+'</td><td><button class="table-text-action" data-supplier-match="'+esc(x.project.catalogItemId)+'" data-supplier-scope="'+esc(x.project.scopeKey)+'" type="button">'+(x.link?'Изменить':'Сопоставить')+'</button></td></tr>';
  }
  function supplierOnlyRowHtml(s) {
    const r=s.raw_data||{},ps=Array.isArray(r.prices)?r.prices:[];
    const piece=ps.find(function(p){return (p.price_basis||"piece")==="piece";});
    const m3=ps.find(function(p){return p.price_basis==="m3";});
    displayNo++;
    return '<tr class="data-row supplier-only-row" data-supplier-check-key="'+esc("supplier:"+(s.supplier_item_id||""))+'"><td class="center">'+displayNo+'</td><td></td><td></td><td></td><td></td><td></td><td class="center">'+esc(s.source_row_no)+'</td><td>'+esc(r.source_mark||"")+'</td><td>'+esc(r.source_name||"")+'</td><td class="num">'+(r.qty_house==null?'—':fmt0(r.qty_house))+'</td><td class="num">'+(r.unit_volume_m3==null?'—':fmt(r.unit_volume_m3))+'</td><td class="num">'+(piece?money(piece.unit_price_gross):'—')+'</td><td class="num">'+(m3?money(m3.unit_price_gross):'—')+'</td><td><span class="price-state supplier">Только у поставщика</span></td><td>—</td><td>Не создаёт проектную позицию</td><td class="center">'+supplierControlJournalCheckboxHtml("",s.supplier_item_id||"")+'</td><td><button class="table-text-action" data-supplier-source-match="'+esc(s.supplier_item_id||"")+'" type="button">Сопоставить</button></td></tr>';
  }
  const supplierOnlyStatus="Только у поставщика";
  const availableStatuses=new Set(rows.map(function(x){return x.status;}));
  snapshot.forEach(function(s){
    if(!linkedBySupplierItem.has(s.supplier_item_id)) availableStatuses.add(supplierOnlyStatus);
  });
  const withoutCurrentSupplierRow=rows.filter(function(x){return !x.source;});
  withoutCurrentSupplierRow.forEach(function(x){availableStatuses.add(x.status);});

  const statusOrder=[
    "Сопоставлено",
    "Сопоставлено с замечанием",
    "Расхождение количества",
    "Расхождение объёма",
    "Изменена цена",
    "Без цены",
    "Требует проверки",
    "Только у поставщика",
    "Нет в новой версии",
    "Сопоставлено вручную",
    "Не является ошибкой"
  ];
  const statusOptions=statusOrder.filter(function(s){return availableStatuses.has(s);});
  Array.from(availableStatuses).forEach(function(s){if(!statusOptions.includes(s)) statusOptions.push(s);});
  if(ui.supplierCheckStatus!=="all"&&!availableStatuses.has(ui.supplierCheckStatus)) ui.supplierCheckStatus="all";

  const statusMatches=function(status){
    return ui.supplierCheckStatus==="all"||status===ui.supplierCheckStatus;
  };

  let body="",lastSourceGroup="",lastSourceSection="";
  snapshot.forEach(function(s){
    const linked=linkedBySupplierItem.get(s.supplier_item_id);
    const status=linked?linked.status:supplierOnlyStatus;
    if(!statusMatches(status)) return;
    const raw=s.raw_data||{};
    const sourceGroup=importText(raw.source_group);
    const sourceSection=importText(raw.source_section);
    if(sourceGroup && sourceGroup!==lastSourceGroup){
      body+='<tr class="supplier-check-structure-row supplier-check-structure-group"><td colspan="18">'+esc(sourceGroup)+'</td></tr>';
      lastSourceGroup=sourceGroup;
      lastSourceSection="";
    }
    if(sourceSection && sourceSection!==lastSourceSection){
      body+='<tr class="supplier-check-structure-row supplier-check-structure-section"><td colspan="18">'+esc(sourceSection)+'</td></tr>';
      lastSourceSection=sourceSection;
    }
    body+=linked?projectRowHtml(linked):supplierOnlyRowHtml(s);
  });
  const visibleWithoutCurrent=withoutCurrentSupplierRow.filter(function(x){return statusMatches(x.status);});
  if(visibleWithoutCurrent.length){
    body+='<tr class="group-row"><td colspan="18" class="group-title">Нет в новой версии / не сопоставлено</td></tr>';
    body+=visibleWithoutCurrent.map(projectRowHtml).join("");
  }
  if(!body) body=tableMessage(ui.supplierCheckStatus==="all"?"Нет данных для проверки. Сначала импортируйте прайс поставщика.":"Нет строк с выбранным статусом.",18);

  const attentionCount=rows.filter(function(x){
    return x.status!=="Сопоставлено"&&x.status!=="Сопоставлено вручную"&&x.status!=="Не является ошибкой";
  }).length + snapshot.filter(function(s){return !linkedBySupplierItem.has(s.supplier_item_id);}).length;

  const statusSelect='<label class="supplier-check-status-filter"><span>Статус</span><select data-supplier-check-status>'+
    '<option value="all">Все статусы</option>'+
    statusOptions.map(function(status){
      return '<option value="'+esc(status)+'" '+(ui.supplierCheckStatus===status?'selected':'')+'>'+esc(status)+'</option>';
    }).join("")+
    '</select></label>';

  content.innerHTML='<div class="supplier-check-summary"><span>Рабочая сводка: '+rows.length+' · версия прайса: '+(snapshot[0]?'№'+snapshot[0].version_no:'нет')+' · требует проверки: '+attentionCount+'</span><span class="spacer"></span>'+statusSelect+'</div><div class="engineering-scroll"><table class="eng-table supplier-check-table" data-table-key="supplier-price-check-v2"><thead><tr><th colspan="6">СПЕЦИФИКАЦИЯ</th><th colspan="7">ПРАЙС ПОСТАВЩИКА</th><th colspan="5">СВЕРКА</th></tr><tr><th>№</th><th>Марка</th><th>Наименование</th><th>Проект, шт.</th><th>Объём за ед., м³</th><th>Объём всего, м³</th><th>№ поставщика</th><th>Марка поставщика</th><th>Наименование поставщика</th><th>Количество поставщика</th><th>Объём за ед., м³</th><th>Цена за 1 шт.</th><th>Цена за 1 м³</th><th>Сопоставление</th><th>Способ</th><th>Расхождение</th><th>Журнал</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div>';
  const statusFilter=content.querySelector("[data-supplier-check-status]");
  if(statusFilter){
    statusFilter.onchange=function(){
      ui.supplierCheckStatus=statusFilter.value||"all";
      renderSupplierCheck();
    };
  }
  content.querySelectorAll("[data-supplier-match]").forEach(function(btn){btn.onclick=function(){openSupplierMatchEditor(btn.dataset.supplierMatch,btn.dataset.supplierScope||"");};});
  content.querySelectorAll("[data-supplier-source-match]").forEach(function(btn){btn.onclick=function(){openSupplierSourceMatchEditor(btn.dataset.supplierSourceMatch);};});
  content.querySelectorAll("[data-supplier-control-journal]").forEach(function(input){
    input.onchange=function(){
      setSupplierControlJournal(input.dataset.catalogId||"",input.dataset.supplierItemId||"",input.checked,input);
    };
  });
}

function renderSupplierCheck() {
  const modal=supplierCheckModal();
  if(!ui.supplierCheckTab) ui.supplierCheckTab="recon";
  const tabKey=ui.supplierCheckTab;
  const content=modal.querySelector(".supplier-check-content");
  const oldScroll=content.querySelector(".engineering-scroll");
  if(!ui.supplierCheckScroll) ui.supplierCheckScroll={};
  if(oldScroll){
    ui.supplierCheckScroll[tabKey]={top:oldScroll.scrollTop,left:oldScroll.scrollLeft};
  }
  modal.querySelectorAll("[data-supplier-check-tab]").forEach(function(btn){btn.classList.toggle("active",btn.dataset.supplierCheckTab===ui.supplierCheckTab);});
  if(ui.supplierCheckTab==="journal") renderSupplierCheckJournal(content); else renderSupplierCheckRecon(content);
  content.querySelectorAll("table").forEach(function(t){installResizeAutofit(t);});
  const nextScroll=content.querySelector(".engineering-scroll");
  const saved=ui.supplierCheckScroll[tabKey];
  if(nextScroll){
    const restore=function(){
      if(!saved) return;
      nextScroll.scrollTop=saved.top||0;
      nextScroll.scrollLeft=saved.left||0;
    };
    restore();
    requestAnimationFrame(function(){
      restore();
      requestAnimationFrame(restore);
    });
    setTimeout(restore,40);
    nextScroll.addEventListener("scroll",function(){
      ui.supplierCheckScroll[tabKey]={top:nextScroll.scrollTop,left:nextScroll.scrollLeft};
    },{passive:true});
  }
}

async function openSupplierCheck() {
  ui.supplierCheckTab="recon";ui.supplierCheckCatalog="";
  const modal=supplierCheckModal();
  modal.classList.add("open");
  modal.querySelector(".supplier-check-content").innerHTML='<div class="supplier-check-summary">Обновляю сверку…</div>';
  try{
    const results=await Promise.all([
      fetchAllRows("supplier_price_links","id,supplier_id,catalog_item_id,supplier_item_id,scope_key,link_method,validation_state,last_checked_import_id,created_at,updated_at",function(q){return q.eq("project_id",dataState.project.id);}),
      fetchAllRows("supplier_price_snapshot_rows","import_id,source_name,imported_at,version_no,supplier_id,import_row_id,source_row_no,source_key,raw_data,normalized_data,supplier_item_id,catalog_item_id,link_method,validation_state,scope_key",function(q){return q.eq("project_id",dataState.project.id).order("imported_at",{ascending:false}).order("source_row_no");})
    ]);
    dataState.supplierPriceLinks=results[0]||[];
    dataState.supplierSnapshotRows=results[1]||[];
    dataState.supplierSnapshotLoaded=true;
  }catch(err){
    console.error(err);
  }
  renderSupplierCheck();
}

function supplierMatchEditorModal() {
  let modal=document.getElementById("supplierMatchEditorModal");
  if(modal)return modal;
  modal=document.createElement("div");modal.id="supplierMatchEditorModal";modal.className="spec-import-backdrop supplier-match-backdrop";
  modal.innerHTML='<div class="recon-edit-modal supplier-match-modal"><div class="spec-import-head"><div><strong>Сопоставить с прайсом</strong><span>Кандидаты отсортированы по вероятности; выбор не выполняется автоматически</span></div><button class="spec-import-close" type="button">×</button></div><div class="supplier-match-source"></div><div class="supplier-match-list"></div><div class="spec-import-foot"><span class="recon-edit-state"></span><span class="spacer"></span><button class="context-link supplier-link-remove" type="button">Снять связь</button><button class="context-link supplier-match-cancel" type="button">Отмена</button><button class="context-link supplier-match-save" type="button">Сопоставить</button></div></div>';
  document.body.appendChild(modal);
  const close=function(){modal.classList.remove("open");};modal.querySelector(".spec-import-close").onclick=close;modal.querySelector(".supplier-match-cancel").onclick=close;
  modal.querySelector(".supplier-match-save").onclick=function(){saveSupplierMatch(false);};modal.querySelector(".supplier-link-remove").onclick=function(){saveSupplierMatch(true);};
  return modal;
}

function openSupplierMatchEditor(catalogId,scopeKey) {
  const project=supplierCheckProjectRows().find(function(x){
    return x.catalogItemId===catalogId && (!scopeKey || x.scopeKey===scopeKey);
  });
  if(!project)return;
  scopeKey=project.scopeKey;
  const snapshot=latestSupplierSnapshotRows();
  const model=supplierCheckRow(project,snapshot);
  const linked=model.link&&model.link.supplier_item_id;
  const ranked=snapshot.map(function(s){return {row:s,score:supplierCandidateScore(project,s)};})
    .sort(function(a,b){return b.score-a.score||Number(a.row.source_row_no)-Number(b.row.source_row_no);});
  const modal=supplierMatchEditorModal();
  modal.dataset.matchMode="project";
  modal.dataset.catalogId=catalogId;
  modal.dataset.scopeKey=scopeKey;
  delete modal.dataset.supplierItemId;
  modal.querySelector(".spec-import-head strong").textContent="Сопоставить с прайсом";
  modal.querySelector(".spec-import-head span").textContent="Кандидаты поставщика отсортированы по вероятности";
  modal.querySelector(".supplier-match-source").innerHTML=
    '<span>Рабочая сводка</span><strong>'+esc(project.mark)+' · '+esc(project.name)+'</strong>'+
    '<small>'+esc(project.zone)+' · '+esc(project.sectionName)+' · Проект: '+fmt0(project.qty)+' шт.'+(project.volume!=null?' · '+fmt(project.volume)+' м³/шт.':'')+'</small>';
  modal.querySelector(".supplier-link-remove").classList.toggle("hidden",!model.link);
  modal.querySelector(".supplier-match-list").innerHTML=
    '<table class="eng-table recon-candidate-table supplier-match-candidate-table"><thead><tr><th>Выбор</th><th>Строка прайса</th><th>Раздел поставщика</th><th>Марка поставщика</th><th>Наименование поставщика</th><th>Кол-во по прайсу</th><th>Объём за ед.</th><th>Цена за 1 шт.</th><th>Цена за 1 м³</th><th>Состояние</th></tr></thead><tbody>'+
    ranked.map(function(c,index){
      const s=c.row,r=s.raw_data||{},ps=Array.isArray(r.prices)?r.prices:[],
        piece=supplierApplicablePrice(ps.filter(function(p){return (p.price_basis||"piece")==="piece";})),
        qty=r.qty_house==null?null:Number(r.qty_house),vol=Number(r.unit_volume_m3||0),
        owner=(dataState.supplierPriceLinks||[]).find(function(x){return x.supplier_item_id===s.supplier_item_id;});
      const sameTarget=owner&&owner.catalog_item_id===catalogId&&supplierLinkScopeKey(owner,snapshot)===scopeKey;
      const ownedElsewhere=owner&&!sameTarget;
      const disabled=ownedElsewhere&&owner.link_method==="manual";
      const stateText=disabled?'Вручную связано с другой строкой сводки':ownedElsewhere?'Автосвязь с другой строкой — будет заменена':linked===s.supplier_item_id?'Текущая связь':'Кандидат';
      return '<tr class="supplier-candidate-row'+(linked===s.supplier_item_id?' is-selected':'')+'">'+
        '<td class="center"><input type="radio" name="supplier-candidate" data-supplier-candidate="'+esc(s.supplier_item_id||'')+'" '+(linked===s.supplier_item_id?'checked':'')+' '+(disabled?'disabled':'')+'></td>'+
        '<td class="center">'+esc(s.source_row_no)+'</td>'+
        '<td class="supplier-match-section"><strong>'+esc(r.source_section||'—')+'</strong>'+(r.source_group?'<small>'+esc(r.source_group)+'</small>':'')+'</td>'+
        '<td><strong>'+esc(r.source_mark||'')+'</strong>'+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td>'+
        '<td>'+esc(r.source_name||'')+'</td><td class="num">'+(qty==null?'—':fmt0(qty))+'</td>'+
        '<td class="num">'+(vol?fmt(vol):'—')+'</td><td class="num">'+(piece?money(piece.unit_price_gross):'—')+'</td>'+
        '<td class="num">'+(piece&&vol?money(Number(piece.unit_price_gross)/vol):'—')+'</td><td>'+stateText+'</td></tr>';
    }).join('')+'</tbody></table>';
  modal.querySelector(".recon-edit-state").textContent="";
  modal.querySelectorAll(".supplier-candidate-row").forEach(function(row){
    row.onclick=function(e){
      const radio=row.querySelector("input");
      if(radio.disabled)return;
      if(e.target!==radio)radio.checked=true;
      modal.querySelectorAll(".supplier-candidate-row").forEach(function(x){x.classList.toggle("is-selected",x.querySelector("input").checked);});
    };
  });
  modal.querySelectorAll("table").forEach(function(table){installResizeAutofit(table);});
  modal.classList.add("open");
}

function openSupplierSourceMatchEditor(supplierItemId) {
  const snapshot=latestSupplierSnapshotRows();
  const source=snapshot.find(function(s){return s.supplier_item_id===supplierItemId;});
  if(!source) return;
  const raw=source.raw_data||{};
  const projects=supplierCheckProjectRows();
  const ranked=projects.map(function(project){
    return {project:project,score:supplierCandidateScore(project,source)};
  }).sort(function(a,b){
    if(b.score!==a.score) return b.score-a.score;
    return String(a.project.mark||"").localeCompare(String(b.project.mark||""),"ru",{numeric:true});
  });
  const modal=supplierMatchEditorModal();
  modal.dataset.matchMode="source";
  modal.dataset.supplierItemId=supplierItemId;
  delete modal.dataset.catalogId;
  delete modal.dataset.scopeKey;
  modal.querySelector(".spec-import-head strong").textContent="Сопоставить позицию поставщика";
  modal.querySelector(".spec-import-head span").textContent="Выберите строку Рабочей сводки; наиболее вероятная показана первой";
  modal.querySelector(".supplier-match-source").innerHTML=
    '<span>Позиция поставщика</span><strong>'+esc(raw.source_mark||"")+' · '+esc(raw.source_name||"")+'</strong>'+
    '<small>'+esc(raw.source_section||"")+(raw.source_group?' · '+esc(raw.source_group):'')+'</small>';
  modal.querySelector(".supplier-link-remove").classList.add("hidden");
  modal.querySelector(".supplier-match-list").innerHTML=
    '<table class="eng-table recon-candidate-table supplier-project-candidate-table" data-table-key="supplier-source-project-match-v2">'+
    '<thead><tr><th>Выбор</th><th>Марка проекта</th><th>Наименование</th><th>Зона / раздел</th><th>Проект, шт.</th><th>Объём за ед.</th><th>Состояние</th></tr></thead><tbody>'+
    ranked.map(function(c,index){
      const p=c.project;
      const owner=(dataState.supplierPriceLinks||[]).find(function(x){
        return x.catalog_item_id===p.catalogItemId && supplierLinkScopeKey(x,snapshot)===p.scopeKey;
      });
      const occupied=owner&&owner.supplier_item_id!==supplierItemId;
      const disabled=occupied&&owner.link_method==="manual";
      const stateText=disabled?"Уже сопоставлено вручную":occupied?"Есть автосвязь — будет заменена":"Свободно";
      return '<tr class="supplier-candidate-row">'+
        '<td class="center"><input type="radio" name="supplier-project-candidate" data-project-candidate="'+esc(p.catalogItemId)+'" data-project-scope="'+esc(p.scopeKey)+'" '+(disabled?'disabled':'')+'></td>'+
        '<td><strong>'+esc(p.mark||"")+'</strong>'+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td>'+
        '<td>'+esc(p.name||"")+'</td>'+
        '<td class="supplier-match-section"><strong>'+esc(p.sectionName||"")+'</strong><small>'+esc(p.zone||"")+'</small></td>'+
        '<td class="num">'+fmt0(p.qty)+'</td>'+
        '<td class="num">'+(p.volume==null?'—':fmt(p.volume))+'</td>'+
        '<td>'+esc(stateText)+'</td></tr>';
    }).join("")+'</tbody></table>';
  modal.querySelector(".recon-edit-state").textContent="";
  const first=modal.querySelector("[data-project-candidate]:not(:disabled)");
  if(first){first.checked=true;first.closest("tr").classList.add("is-selected");}
  modal.querySelectorAll(".supplier-candidate-row").forEach(function(row){
    row.onclick=function(e){
      const radio=row.querySelector("input");
      if(!radio||radio.disabled)return;
      if(e.target!==radio)radio.checked=true;
      modal.querySelectorAll(".supplier-candidate-row").forEach(function(x){
        const r=x.querySelector("input");x.classList.toggle("is-selected",!!r&&r.checked);
      });
    };
  });
  modal.querySelectorAll("table").forEach(function(table){installResizeAutofit(table);});
  modal.classList.add("open");
}

function applySupplierLinkLocally(catalogId,supplierItemId,remove,scopeKey) {
  const links=dataState.supplierPriceLinks||[];
  const snapshot=latestSupplierSnapshotRows();
  const oldByCatalog=links.find(function(x){
    return x.catalog_item_id===catalogId && supplierLinkScopeKey(x,snapshot)===scopeKey;
  })||null;
  const oldBySupplier=supplierItemId?links.find(function(x){return x.supplier_item_id===supplierItemId;})||null:null;
  const detached=new Set();

  let next=links.slice();
  if(oldByCatalog){
    next=next.filter(function(x){return x!==oldByCatalog;});
    if(oldByCatalog.supplier_item_id) detached.add(oldByCatalog.supplier_item_id);
  }
  if(oldBySupplier && !(oldBySupplier.catalog_item_id===catalogId && supplierLinkScopeKey(oldBySupplier,snapshot)===scopeKey)){
    next=next.filter(function(x){return x!==oldBySupplier;});
    if(oldBySupplier.supplier_item_id) detached.add(oldBySupplier.supplier_item_id);
  }

  function clearSupplier(id){
    if(!id)return;
    const si=(dataState.supplierItems||[]).find(function(x){return x.id===id;});
    if(si){si.catalog_item_id=null;si.link_method=null;si.link_state="unmatched";}
    (dataState.supplierSnapshotRows||[]).forEach(function(x){
      if(x.supplier_item_id===id){
        x.catalog_item_id=null;x.link_method=null;x.validation_state=null;x.scope_key="";
      }
    });
  }
  detached.forEach(clearSupplier);

  if(!remove && supplierItemId){
    const si=(dataState.supplierItems||[]).find(function(x){return x.id===supplierItemId;});
    const latest=latestSupplierSnapshotRows()[0]||null;
    const link={
      id:oldByCatalog&&oldByCatalog.id||("local-"+catalogId+"-"+scopeKey+"-"+supplierItemId),
      supplier_id:si&&si.supplier_id||null,
      catalog_item_id:catalogId,
      supplier_item_id:supplierItemId,
      scope_key:scopeKey,
      link_method:"manual",
      validation_state:"confirmed",
      last_checked_import_id:latest&&latest.import_id||null,
      updated_at:new Date().toISOString()
    };
    next.push(link);
    if(si){si.catalog_item_id=catalogId;si.link_method="manual";si.link_state="matched";}
    (dataState.supplierSnapshotRows||[]).forEach(function(x){
      if(x.supplier_item_id===supplierItemId){
        x.catalog_item_id=catalogId;x.link_method="manual";x.validation_state="confirmed";x.scope_key=scopeKey;
      }
    });
    detached.delete(supplierItemId);
  }

  dataState.supplierPriceLinks=next;
  return {oldByCatalog:oldByCatalog,oldBySupplier:oldBySupplier,detached:Array.from(detached)};
}

function patchSupplierCheckSupplierRow(supplierItemId) {
  if(!supplierItemId)return false;
  const check=document.getElementById("supplierCheckModal");
  if(!check)return false;
  const row=check.querySelector('[data-supplier-check-key="'+CSS.escape("supplier:"+supplierItemId)+'"]');
  if(!row)return false;
  const snapshot=latestSupplierSnapshotRows();
  const source=snapshot.find(function(x){return x.supplier_item_id===supplierItemId;});
  if(!source)return false;
  const raw=source.raw_data||{};
  const link=(dataState.supplierPriceLinks||[]).find(function(x){return x.supplier_item_id===supplierItemId;});
  const project=link?supplierCheckProjectRows().find(function(x){
    return x.catalogItemId===link.catalog_item_id && x.scopeKey===supplierLinkScopeKey(link,snapshot);
  }):null;
  const cells=row.cells;
  if(cells.length<18)return false;

  if(project){
    const model=supplierCheckRow(project,snapshot);
    row.classList.remove("supplier-only-row");
    cells[1].textContent=project.mark||"";
    cells[2].textContent=project.name||"";
    cells[3].textContent=fmt0(project.qty);
    cells[4].textContent=project.volume==null?"—":fmt(project.volume);
    cells[5].textContent=project.volume==null?"—":fmt(project.qty*project.volume);
    cells[13].innerHTML='<span class="price-state '+supplierStatusClass(model.status)+'">'+esc(model.status)+'</span>';
    cells[14].textContent=link.link_method==="manual"?"Вручную":"Авто";
    cells[15].textContent=model.reasons.length?model.reasons.join(" · "):"Нет";
    cells[16].innerHTML=supplierControlJournalCheckboxHtml(project.catalogItemId,supplierItemId);
    cells[17].innerHTML='<button class="table-text-action" data-supplier-match="'+esc(project.catalogItemId)+'" data-supplier-scope="'+esc(project.scopeKey)+'" type="button">Изменить</button>';
    const duplicate=check.querySelector('[data-supplier-check-key="'+CSS.escape("project:"+project.projectKey)+'"]');
    if(duplicate && duplicate!==row) duplicate.remove();
    const journal=cells[16].querySelector("[data-supplier-control-journal]");
    if(journal) journal.onchange=function(){setSupplierControlJournal(project.catalogItemId,supplierItemId,journal.checked,journal);};
    const change=cells[17].querySelector("[data-supplier-match]");
    if(change) change.onclick=function(){openSupplierMatchEditor(project.catalogItemId,project.scopeKey);};
  }else{
    row.classList.add("supplier-only-row");
    for(let i=1;i<=5;i++) cells[i].textContent="";
    cells[13].innerHTML='<span class="price-state supplier">Только у поставщика</span>';
    cells[14].textContent="—";
    cells[15].textContent="Не создаёт проектную позицию";
    cells[16].innerHTML=supplierControlJournalCheckboxHtml("",supplierItemId);
    cells[17].innerHTML='<button class="table-text-action" data-supplier-source-match="'+esc(supplierItemId)+'" type="button">Сопоставить</button>';
    const journal=cells[16].querySelector("[data-supplier-control-journal]");
    if(journal) journal.onchange=function(){setSupplierControlJournal("",supplierItemId,journal.checked,journal);};
    const match=cells[17].querySelector("[data-supplier-source-match]");
    if(match) match.onclick=function(){openSupplierSourceMatchEditor(supplierItemId);};
  }
  return true;
}

function refreshSupplierCheckSummaryOnly() {
  const summary=document.querySelector("#supplierCheckModal .supplier-check-summary");
  if(!summary)return;
  const snapshot=latestSupplierSnapshotRows();
  const rows=supplierCheckProjectRows().map(function(p){return supplierCheckRow(p,snapshot);});
  summary.textContent="Рабочая сводка: "+rows.length+" · версия прайса: "+(snapshot[0]?"№"+snapshot[0].version_no:"нет")+" · требует проверки: "+
    rows.filter(function(x){return x.status!=="Сопоставлено"&&x.status!=="Сопоставлено вручную";}).length;
}

async function saveSupplierMatch(remove) {
  remove=remove===true;
  const modal=supplierMatchEditorModal(),state=modal.querySelector(".recon-edit-state");
  const mode=modal.dataset.matchMode||"project";
  let catalogId=modal.dataset.catalogId||"";
  let scopeKey=modal.dataset.scopeKey||"";
  let supplierItemId=modal.dataset.supplierItemId||"";
  if(mode==="source"){
    const chosenProject=modal.querySelector("[data-project-candidate]:checked");
    if(!chosenProject){state.textContent="Выберите позицию Рабочей сводки.";return;}
    catalogId=chosenProject.dataset.projectCandidate;
    scopeKey=chosenProject.dataset.projectScope||"";
    remove=false;
  }else{
    const chosenSupplier=remove?null:modal.querySelector("[data-supplier-candidate]:checked");
    if(!remove&&!chosenSupplier){state.textContent="Выберите позицию поставщика.";return;}
    supplierItemId=remove?null:chosenSupplier.dataset.supplierCandidate;
  }
  const snapshotForScope=latestSupplierSnapshotRows();
  const previousCatalogLink=(dataState.supplierPriceLinks||[]).find(function(x){
    return x.catalog_item_id===catalogId && supplierLinkScopeKey(x,snapshotForScope)===scopeKey;
  })||null;
  const previousSupplierLink=supplierItemId?(dataState.supplierPriceLinks||[]).find(function(x){return x.supplier_item_id===supplierItemId;})||null:null;

  // Optimistic UI: apply the mapping immediately. The network/database write
  // continues after the editor closes, so the user's workflow is not blocked
  // by the Supabase round trip.
  const oldLinks=(dataState.supplierPriceLinks||[]).slice();
  const affectedIds=new Set();
  if(previousCatalogLink&&previousCatalogLink.supplier_item_id) affectedIds.add(previousCatalogLink.supplier_item_id);
  if(previousSupplierLink&&previousSupplierLink.supplier_item_id) affectedIds.add(previousSupplierLink.supplier_item_id);
  if(supplierItemId) affectedIds.add(supplierItemId);

  const itemBackup=[];
  (dataState.supplierItems||[]).forEach(function(si){
    if(affectedIds.has(si.id)){
      itemBackup.push({row:si,catalog_item_id:si.catalog_item_id,link_method:si.link_method,link_state:si.link_state});
    }
  });
  const snapshotBackup=[];
  (dataState.supplierSnapshotRows||[]).forEach(function(row){
    if(affectedIds.has(row.supplier_item_id)){
      snapshotBackup.push({row:row,catalog_item_id:row.catalog_item_id,link_method:row.link_method,validation_state:row.validation_state});
    }
  });

  const local=applySupplierLinkLocally(catalogId,supplierItemId,remove,scopeKey);
  modal.classList.remove("open");

  const affected=new Set(local.detached||[]);
  affectedIds.forEach(function(id){affected.add(id);});
  affected.forEach(function(id){patchSupplierCheckSupplierRow(id);});
  refreshSupplierCheckSummaryOnly();
  ui.supplierPriceDirty=true;

  if(remove){
    renderSupplierCheck();
  }

  // Persist after the UI has already advanced. If the database rejects the
  // change, restore the exact previous client state and show the error.
  client.rpc("set_supplier_price_link_scoped",{
    p_project_id:dataState.project.id,
    p_catalog_item_id:catalogId,
    p_supplier_item_id:supplierItemId||null,
    p_scope_key:scopeKey
  }).then(function(result){
    if(!result.error) return;
    dataState.supplierPriceLinks=oldLinks;
    itemBackup.forEach(function(x){
      x.row.catalog_item_id=x.catalog_item_id;
      x.row.link_method=x.link_method;
      x.row.link_state=x.link_state;
    });
    snapshotBackup.forEach(function(x){
      x.row.catalog_item_id=x.catalog_item_id;
      x.row.link_method=x.link_method;
      x.row.validation_state=x.validation_state;
    });
    renderSupplierCheck();
    ui.supplierPriceDirty=true;
    const summary=document.querySelector("#supplierCheckModal .supplier-check-summary");
    if(summary){
      summary.innerHTML='<span class="supplier-save-error">Не сохранено: '+esc(result.error.message||"ошибка записи")+'</span>';
    }
  });
}

function supplierApplicablePrice(prices) {
  const list=(prices||[]).slice().filter(function(p){return p && p.unit_price_gross!=null;}).sort(function(a,b){
    return String(a.effective_from||"").localeCompare(String(b.effective_from||""));
  });
  if(!list.length) return null;
  const now=new Date();
  const today=String(now.getFullYear()).padStart(4,"0")+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  const active=list.filter(function(p){return !p.effective_from || String(p.effective_from).slice(0,10)<=today;});
  return active.length ? active[active.length-1] : list[0];
}

function supplierPriceModel(catalogItemId,projectVolume) {
  const items=dataState.supplierItems.filter(function(x){return x.catalog_item_id===catalogItemId;});
  const prices=items.flatMap(function(item){
    return dataState.supplierPrices.filter(function(p){return p.supplier_item_id===item.id;});
  });
  const volumeValues=Array.from(new Set(items.map(function(x){return Number(x.unit_volume_m3||0);}).filter(function(v){return v>0;}).map(function(v){return v.toFixed(6);}))).map(Number);
  const supplierVolume=volumeValues.length===1?volumeValues[0]:null;
  const hasReview=items.some(function(x){return ["review","needs_review","ambiguous"].includes(x.link_state);}) || volumeValues.length>1;
  const distinctPrices=Array.from(new Map(prices.map(function(p){
    return [p.effective_from+"|"+p.price_basis+"|"+Number(p.unit_price_gross).toFixed(6),p];
  })).values());
  let state;
  if(hasReview) state="Проверить";
  else if(!distinctPrices.length) state="Нет цены";
  else state=distinctPrices.length+" "+(distinctPrices.length===1?"цена":distinctPrices.length<5?"цены":"цен");
  const applicable=supplierApplicablePrice(distinctPrices);
  const singlePrice=applicable && !hasReview ? Number(applicable.unit_price_gross||0) : null;
  const volume=supplierVolume!=null?supplierVolume:Number(projectVolume||0);
  return {
    items:items,
    prices:distinctPrices,
    supplierVolume:supplierVolume,
    volume:volume,
    state:state,
    singlePrice:singlePrice,
    effectiveFrom:applicable?applicable.effective_from:null,
    perM3:singlePrice!=null && supplierVolume>0 ? singlePrice/supplierVolume : null
  };
}

function supplierOnlyPriceModel(item) {
  const prices=dataState.supplierPrices.filter(function(p){return p.supplier_item_id===item.id;});
  const distinct=Array.from(new Map(prices.map(function(p){
    return [p.effective_from+"|"+p.price_basis+"|"+Number(p.unit_price_gross).toFixed(6),p];
  })).values());
  const review=["review","needs_review","ambiguous"].includes(item.link_state);
  const state=review?"Проверить":"Только поставщик";
  const applicable=supplierApplicablePrice(distinct);
  const singlePrice=applicable && !review ? Number(applicable.unit_price_gross||0) : null;
  const volume=Number(item.unit_volume_m3||0);
  return {
    prices:distinct,state:state,singlePrice:singlePrice,volume:volume,
    effectiveFrom:applicable?applicable.effective_from:null,
    perM3:singlePrice!=null && volume>0?singlePrice/volume:null
  };
}

// The snapshot archive is the largest table, so it is not part of the initial load.
let supplierSnapshotLoadPromise=null;
function loadSupplierSnapshotForPage() {
  if(supplierSnapshotLoadPromise) return;
  supplierSnapshotLoadPromise=refreshProjectDataSlices(["supplierSnapshotRows"],dataState.project).then(function(){
    dataState.supplierSnapshotLoaded=true;
    supplierSnapshotLoadPromise=null;
    if(ui.page==="supply" && ui.tabs.supply===2) renderPage("supply",2);
  }).catch(function(err){
    console.error(err);
    supplierSnapshotLoadPromise=null;
    dataState.supplierSnapshotError=true;
    if(ui.page==="supply" && ui.tabs.supply===2) renderPage("supply",2);
  });
}

function renderSupplierPrice() {
  if(!dataState.supplierSnapshotLoaded){
    if(dataState.supplierSnapshotError){
      dataState.supplierSnapshotError=false;
      return '<div class="empty">Не удалось загрузить прайс поставщика. <button class="primary" type="button" onclick="renderPage(\'supply\',2)">Повторить</button></div>';
    }
    loadSupplierSnapshotForPage();
    return '<div class="empty">Загружаю прайс поставщика…</div>';
  }
  const snapshot=latestSupplierSnapshotRows().slice().sort(function(a,b){
    const an=Number(a.source_row_no),bn=Number(b.source_row_no);
    return an-bn;
  });
  const projects=supplierCheckProjectRows();

  function rowStatus(row){
    if(row.catalog_item_id){
      const scope=supplierSourceScopeKey(row);
      const project=projects.find(function(x){return x.catalogItemId===row.catalog_item_id&&x.scopeKey===scope;})
        || projects.find(function(x){return x.catalogItemId===row.catalog_item_id;});
      if(project) return supplierCheckRow(project,snapshot).status;
    }
    if(row.validation_state==="review"||row.validation_state==="needs_review") return "Требует проверки";
    return "Только у поставщика";
  }

  let rows=snapshot.map(function(row){
    const raw=row.raw_data||{};
    return {snapshot:row,raw:raw,status:rowStatus(row)};
  }).filter(function(x){
    return passesSearch([x.raw.source_group,x.raw.source_section,x.raw.source_position,x.raw.source_mark,x.raw.source_name,x.status]);
  }).filter(function(x){
    return rowPassesColumnFilters({mark:x.raw.source_mark,name:x.raw.source_name,price:x.status});
  });

  const firstRaw=(snapshot[0]&&snapshot[0].raw_data)||{};
  const headers=firstRaw.source_headers||{
    number:"№ п/п",mark:"Позиция",name:"Наименование изделия",volume:"Объём ед. изд., м³",
    price_group:"Цена за шт. с НДС",total_group:"Всего на дом",quantity:"шт.",total_volume:"м³",total_amount:"руб."
  };
  let priceKeys=[];
  snapshot.forEach(function(row){
    (Array.isArray(row.raw_data&&row.raw_data.prices)?row.raw_data.prices:[]).forEach(function(p){
      const key=String(p.effective_from||"").slice(0,10)+"|"+(p.price_basis||"piece");
      if(!priceKeys.some(function(x){return x.key===key;})) priceKeys.push({key:key,effective_from:p.effective_from,price_basis:p.price_basis||"piece"});
    });
  });
  priceKeys.sort(function(a,b){return String(a.effective_from||"").localeCompare(String(b.effective_from||""));});
  if(!priceKeys.length) priceKeys=[{key:"",effective_from:"",price_basis:"piece"}];
  const columnCount=9+priceKeys.length;
  ui.currentGroupKeys=[];
  let body="",displayNo=0;

  function priceFor(raw,key){
    return (Array.isArray(raw.prices)?raw.prices:[]).find(function(p){
      return String(p.effective_from||"").slice(0,10)+"|"+(p.price_basis||"piece")===key;
    });
  }
  function totals(list,sourceField){
    return list.reduce(function(acc,x){
      const r=x.raw||{},q=Number(r.qty_house||0),v=Number(r.unit_volume_m3||0);
      const first=(Array.isArray(r.prices)?r.prices:[]).slice().sort(function(a,b){return String(a.effective_from||"").localeCompare(String(b.effective_from||""));})[0];
      acc.qty+=q;
      acc.volume+=r.source_total_volume_m3==null?q*v:Number(r.source_total_volume_m3||0);
      acc.amount+=r.source_total_gross==null?(first?q*Number(first.unit_price_gross||0):0):Number(r.source_total_gross||0);
      return acc;
    },{qty:0,volume:0,amount:0});
  }
  function groupRow(label,list,key,depth,sourceField){
    registerGroup(key);
    const t=totals(list,sourceField);
    return '<tr class="'+groupRowClass(key,depth)+' supplier-source-group" data-group-key="'+esc(key)+'"><td colspan="4" class="group-title spec-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td><td></td>'+
      priceKeys.map(function(){return '<td></td>';}).join('')+
      '<td class="num">'+fmt0(t.qty)+'</td><td class="num">'+fmt(t.volume)+'</td><td class="num">'+money(t.amount)+'</td><td></td></tr>';
  }
  function dataRow(x,sourceIndex){
    const r=x.raw||{},q=r.qty_house==null?null:Number(r.qty_house),v=r.unit_volume_m3==null?null:Number(r.unit_volume_m3);
    const totalVolume=r.source_total_volume_m3==null?(q!=null&&v!=null?q*v:null):Number(r.source_total_volume_m3);
    const first=(Array.isArray(r.prices)?r.prices:[]).slice().sort(function(a,b){return String(a.effective_from||"").localeCompare(String(b.effective_from||""));})[0];
    const totalAmount=r.source_total_gross==null?(q!=null&&first?q*Number(first.unit_price_gross||0):null):Number(r.source_total_gross);
    displayNo++;
    return '<tr class="data-row supplier-source-row" data-supplier-item-id="'+esc(x.snapshot.supplier_item_id||"")+'"><td class="sticky-1 center">'+displayNo+'</td><td class="sticky-2 center">'+esc(r.source_position||sourceIndex)+'</td>'+
      filterCell("mark",r.source_mark,esc(r.source_mark||""),"sticky-3")+
      filterCell("name",r.source_name,esc(r.source_name||""),"sticky-4")+
      '<td class="num">'+(v==null?'—':fmt(v))+'</td>'+
      priceKeys.map(function(pk){const p=priceFor(r,pk.key);return '<td class="num">'+(p?money(p.unit_price_gross):'—')+'</td>';}).join('')+
      '<td class="num">'+(q==null?'—':fmt0(q))+'</td><td class="num">'+(totalVolume==null?'—':fmt(totalVolume))+'</td><td class="num">'+(totalAmount==null?'—':money(totalAmount))+'</td>'+
      filterCell("price",x.status,'<span class="price-state '+supplierStatusClass(x.status)+'">'+esc(x.status)+'</span>',"status-cell")+'</tr>';
  }

  if(!rows.length) body=tableMessage(snapshot.length?"Нет строк по текущему фильтру.":"Прайс поставщика ещё не загружен.",columnCount);
  else{
    const groups=[];
    rows.forEach(function(x){
      const groupName=x.raw.source_group||"Прайс поставщика";
      let group=groups[groups.length-1];
      if(!group||group.name!==groupName){group={name:groupName,rows:[],sections:[]};groups.push(group);}
      group.rows.push(x);
      const sectionName=x.raw.source_section||"Без раздела";
      let section=group.sections[group.sections.length-1];
      if(!section||section.name!==sectionName){section={name:sectionName,rows:[]};group.sections.push(section);}
      section.rows.push(x);
    });
    groups.forEach(function(group,gi){
      const gk="supplier-price:group:"+gi+":"+group.name;
      body+=groupRow(group.name,group.rows,gk,0,"source_group_total");
      if(ui.collapsed.has(gk)) return;
      group.sections.forEach(function(section,si){
        const sk=gk+":section:"+si+":"+section.name;
        body+=groupRow(section.name,section.rows,sk,1,"source_section_total");
        if(ui.collapsed.has(sk)||ui.collapseLeaves) return;
        section.rows.forEach(function(x,index){body+=dataRow(x,index+1);});
      });
    });
    const grand=totals(rows,"source_grand_total");
    body+='<tr class="group-row group-depth-0 supplier-price-grand-total"><td colspan="4" class="group-title spec-group-title">ВСЕГО НА ДОМ</td><td></td>'+priceKeys.map(function(){return '<td></td>';}).join('')+'<td class="num">'+fmt0(grand.qty)+'</td><td class="num">'+fmt(grand.volume)+'</td><td class="num">'+money(grand.amount)+'</td><td></td></tr>';
  }

  const version=snapshot[0]||null;
  const linked=rows.filter(function(x){return !!x.snapshot.catalog_item_id;}).length;
  const review=rows.filter(function(x){return x.status!=="Сопоставлено"&&x.status!=="Сопоставлено вручную";}).length;
  const banner=version?'<div class="supplier-price-source-banner"><strong>Прайс №'+esc(version.version_no)+'</strong><span>'+esc(version.source_name||"Файл поставщика")+'</span><span>'+esc(new Date(version.imported_at).toLocaleString("ru-RU"))+'</span><span>'+rows.length+' позиций · '+linked+' связано с Рабочей сводкой · '+review+' требуют внимания</span></div>':'';
  const priceSubheads=priceKeys.map(function(pk){
    const year=String(pk.effective_from||"").slice(0,4);
    const saved=(Array.isArray(headers.price_labels)?headers.price_labels:[]).find(function(x){return String(x.effective_from||"").slice(0,4)===year;});
    return '<th>'+esc(saved&&saved.label?saved.label:(year?year:"Цена"))+'</th>';
  }).join('');
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML=banner+'<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table price-table supplier-source-price-table" data-table-key="supplier-price-v3">'+
    '<thead><tr><th class="sticky-1" rowspan="2">Наш №</th><th class="sticky-2" rowspan="2">'+esc(headers.number)+'</th><th class="sticky-3 filterable-head" rowspan="2">'+filterHeader(headers.mark,"mark")+'</th><th class="sticky-4 filterable-head" rowspan="2">'+filterHeader(headers.name,"name")+'</th><th rowspan="2">'+esc(headers.volume)+'</th><th colspan="'+priceKeys.length+'">'+esc(headers.price_group)+'</th><th colspan="3">'+esc(headers.total_group)+'</th><th class="filterable-head" rowspan="2">'+filterHeader("Прайс","price")+'</th></tr>'+
    '<tr>'+priceSubheads+'<th>'+esc(headers.quantity)+'</th><th>'+esc(headers.total_volume)+'</th><th>'+esc(headers.total_amount)+'</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}
