// Local estimates of the object come from its settings (number, section, zone).
function estimateImportSlots() {
  return objectSettings().estimates.map(function(e){
    const scope=e.stairs ? (e.section||"Элементы лестниц") : [e.section,e.zone].filter(Boolean).join(" · ");
    return {number:e.number,label:"№"+e.number+(scope?" — "+scope:"")};
  });
}

function estimateNumber(value,label) {
  if(value==null || value==="" || /^[-–—]$/.test(importText(value))) return null;
  if(typeof value==="number") return Number.isFinite(value) ? value : null;
  const text=importText(value).replace(/\s/g,"").replace(",",".");
  if(!text || /^[-–—]$/.test(text)) return null;
  const n=Number(text);
  if(!Number.isFinite(n)) throw new Error(label+": неверное число «"+importText(value)+"»");
  return n;
}

function estimatePair(value,label) {
  if(value==null || value==="") return [null,null];
  if(typeof value==="number") return [value,null];
  const parts=String(value).split(/\r?\n/).map(function(x){return x.trim();});
  const a=(!parts[0] || /^[-–—]$/.test(parts[0])) ? null : estimateNumber(parts[0],label+" / ед.");
  const b=(!parts[1] || /^[-–—]$/.test(parts[1])) ? null : estimateNumber(parts[1],label+" / всего");
  return [a,b];
}

function nativeEstimateHeader(table) {
  return table.slice(0,50).findIndex(function(row){
    return importNorm(row&&row[1])==="обоснование" &&
      importNorm(row&&row[2]).includes("наименование работ, ресурсов");
  });
}

function normalizeEstimateUnit(unit,rowType) {
  const value=String(unit==null?"":unit).replace(/\s+/g," ").trim();
  if(rowType==="work" && /^100\s*ШТ\.?\s*(?:СБОРНЫХ\s+КОНСТРУКЦИЙ\s*)?\.?$/i.test(value)) return "100 ШТ";
  return value;
}

function parseEstimateWorkbook(buffer,estimateNumberValue) {
  if(!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const wb=XLSX.read(buffer,{type:"array",cellDates:false,cellFormula:false});
  let sheetName="",table=null,header=-1;
  for(const name of wb.SheetNames){
    const candidate=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null,raw:true,blankrows:false});
    const h=nativeEstimateHeader(candidate);
    if(h>=0){sheetName=name;table=candidate;header=h;break;}
  }
  if(!table) throw new Error("Не найден штатный формат локальной сметы: «Обоснование / Наименование работ, ресурсов».");

  const flat=table.slice(0,60).flat().map(function(v){return importText(v);}).filter(Boolean);
  const declaredText=flat.join(" ");
  const declared=declaredText.match(/ЛОКАЛЬН[А-ЯЁA-Z\s()]*№\s*(\d+)/i);
  if(declared && declared[1]!==String(estimateNumberValue)){
    throw new Error("В файле локальная смета №"+declared[1]+", выбран слот №"+estimateNumberValue+".");
  }

  let estimateName="";
  for(let i=0;i<Math.min(table.length,40);i++){
    const cells=(table[i]||[]).map(importText).filter(Boolean);
    if(cells.some(function(x){return /ЛОКАЛЬН[А-ЯЁA-Z\s()]*СМЕТ/i.test(x);})){
      estimateName=cells.join(" ");
      break;
    }
  }
  if(!estimateName) estimateName="Локальная смета №"+estimateNumberValue;

  const rows=[],sections=[],notes=[],sectionCounts={},identityCounts={};
  let section=null;
  const service=/^(К ДЛЯ|КОЭФФИЦИЕНТ|БАЗА |ПРИМЕНЕН |КЖ\d)/i;

  for(let i=header+4;i<table.length;i++){
    const raw=table[i]||[];
    const basis=importText(raw[1]);
    const name=importText(raw[2]);

    if(/^ПРИМЕЧАНИЕ\s*:/i.test(basis)){
      const text=name || basis.replace(/^ПРИМЕЧАНИЕ\s*:\s*/i,"").trim();
      if(service.test(text)){
        if(text) notes.push({source_row_no:i+1,sort_order:notes.length+1,text:text});
        continue;
      }
      if(!text) continue;
      const key=importNorm(text);
      sectionCounts[key]=(sectionCounts[key]||0)+1;
      section={
        title:text,
        occurrence:sectionCounts[key],
        sort_order:sections.length+1,
        source_row_no:i+1
      };
      sections.push(section);
      continue;
    }

    const pos=importText(raw[0]).replace(/\.$/,"");
    if(!/^\d+$/.test(pos) || !basis || !name || raw[3]==null || raw[3]==="") continue;

    let rowType=null;
    if(/^[ЕE]\d+-/i.test(basis)) rowType="work";
    else if(/^\d+\//.test(basis)) rowType="material";
    if(!rowType){
      throw new Error("Строка "+(i+1)+": неизвестный код «"+basis+"». Тип Р/М автоматически не угадывается.");
    }
    if(!section) throw new Error("Строка "+(i+1)+": позиция находится до первого раздела «ПРИМЕЧАНИЕ:».");

    const uq=String(raw[3]).trim().split(/\r?\n/);
    const quantity=estimateNumber(uq.pop(),"Строка "+(i+1)+", количество");
    const unit=normalizeEstimateUnit(uq.join(" ").trim(),rowType);
    if(!unit || quantity==null) throw new Error("Строка "+(i+1)+": не удалось разделить единицу измерения и количество.");

    const costs={};
    [
      [4,"salary"],[5,"machines"],[6,"drivers"],
      [7,"materials"],[8,"transport"],[9,"total"]
    ].forEach(function(pair){
      const vals=estimatePair(raw[pair[0]],"Строка "+(i+1)+", "+pair[1]);
      costs[pair[1]+"_unit"]=vals[0];
      costs[pair[1]+"_amount"]=vals[1];
    });

    const identityBase=importNorm(section.title)+"#"+section.occurrence+"|"+rowType+"|"+pos;
    identityCounts[identityBase]=(identityCounts[identityBase]||0)+1;
    const sourceIdentity=identityBase+"#"+identityCounts[identityBase];

    rows.push({
      source_row_no:i+1,
      source_identity:sourceIdentity,
      section_title:section.title,
      section_occurrence:section.occurrence,
      row_type:rowType,
      position:pos,
      basis:basis,
      name:name,
      unit:unit,
      quantity:quantity,
      sort_order:rows.length+1,
      costs:costs
    });
  }

  if(!sections.length) throw new Error("Не найдено ни одного раздела сметы.");
  if(!rows.length) throw new Error("Не найдено ни одной строки Р/М.");

  const works=rows.filter(function(r){return r.row_type==="work";}).length;
  const materials=rows.length-works;
  return {
    sheetName:sheetName,
    estimateName:estimateName,
    sections:sections,
    rows:rows,
    notes:notes,
    works:works,
    materials:materials
  };
}

function estimateImportModal() {
  let modal=document.getElementById("estimateImportModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="estimateImportModal";
  modal.className="spec-import-backdrop";
  modal.innerHTML=
    '<div class="spec-import-modal">'+
      '<div class="spec-import-head"><div><strong>Импорт локальных смет</strong><span>Исходная структура Р/М, разделы и стоимости сохраняются</span></div><button class="spec-import-close" type="button">×</button></div>'+
      '<div class="spec-import-list"></div>'+
      '<div class="spec-import-preview hidden"></div>'+
      '<div class="spec-import-foot"><span class="spec-import-state"></span><span class="spacer"></span><button class="context-link estimate-import-close" type="button">Закрыть</button><button class="context-link estimate-import-apply" type="button" disabled>Импортировать</button></div>'+
    '</div>';
  document.body.appendChild(modal);
  const close=function(){
    modal.classList.remove("open");
    if(ui.supplierPriceDirty){
      ui.supplierPriceDirty=false;
      setTimeout(function(){
        if(ui.page==="supply" && (ui.tabs.supply||0)===2){
          renderSupplierPrice();
          installTableTools();
        }
      },0);
    }
  };
  modal.querySelector(".spec-import-close").onclick=close;
  modal.querySelector(".estimate-import-close").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector(".estimate-import-apply").onclick=applyPendingEstimateImport;
  return modal;
}

async function refreshEstimateImportStatuses() {
  const modal=estimateImportModal();
  const list=modal.querySelector(".spec-import-list");
  const result=await client.from("imports")
    .select("id,source_slot,source_name,status,report,applied_at,imported_at")
    .eq("project_id",dataState.project.id)
    .eq("domain","estimate")
    .eq("status","applied")
    .order("imported_at",{ascending:false});
  const latest={};
  if(!result.error){
    (result.data||[]).forEach(function(x){if(x.source_slot && !latest[x.source_slot]) latest[x.source_slot]=x;});
  }
  list.innerHTML=estimateImportSlots().map(function(slot){
    const cur=latest["estimate_"+slot.number];
    const detail=cur
      ? '<span class="spec-import-loaded">'+esc(cur.source_name||"Excel")+' · '+esc(String((cur.report&&cur.report.rows)||"—"))+' строк · '+esc(String((cur.report&&cur.report.materials)||"—"))+' М</span>'
      : '<span class="spec-import-empty">не загружено</span>';
    return '<div class="spec-import-row">'+
      '<div class="spec-import-slot"><strong>'+esc(slot.label)+'</strong>'+detail+'</div>'+
      '<input class="estimate-import-file" type="file" accept=".xlsx,.xls,.xlsm" data-estimate-number="'+esc(slot.number)+'">'+
      '<button class="context-link estimate-file-pick" type="button" data-estimate-number="'+esc(slot.number)+'">Выбрать Excel</button>'+
    '</div>';
  }).join("");

  list.querySelectorAll(".estimate-file-pick").forEach(function(btn){
    btn.onclick=function(){
      const input=list.querySelector('.estimate-import-file[data-estimate-number="'+CSS.escape(btn.dataset.estimateNumber)+'"]');
      input.value="";
      input.click();
    };
  });
  list.querySelectorAll(".estimate-import-file").forEach(function(input){
    input.onchange=function(){
      if(input.files&&input.files[0]) prepareEstimateImport(input.dataset.estimateNumber,input.files[0]);
    };
  });
}

async function prepareEstimateImport(number,file) {
  await ensureXlsxLoaded();
  const modal=estimateImportModal();
  const state=modal.querySelector(".spec-import-state");
  const preview=modal.querySelector(".spec-import-preview");
  const apply=modal.querySelector(".estimate-import-apply");
  apply.disabled=true;
  state.textContent="Читаю Excel…";
  preview.classList.add("hidden");
  try{
    const buffer=await file.arrayBuffer();
    const parsed=parseEstimateWorkbook(buffer,number);
    const hash=await sha256Hex(buffer);
    ui.pendingEstimateImport={number:number,fileName:file.name,hash:hash,parsed:parsed};
    const slot=estimateImportSlots().find(function(x){return x.number===number;});
    preview.innerHTML=
      '<strong>'+esc(slot?slot.label:"№"+number)+'</strong>'+
      '<span>'+esc(file.name)+'</span>'+
      '<span>'+parsed.sections.length+' разделов</span>'+
      '<span>'+parsed.rows.length+' строк</span>'+
      '<span>'+parsed.works+' Р</span>'+
      '<span>'+parsed.materials+' М</span>'+
      '<span>лист «'+esc(parsed.sheetName)+'»</span>';
    preview.classList.remove("hidden");
    state.textContent="Проверка пройдена";
    apply.disabled=false;
  }catch(err){
    ui.pendingEstimateImport=null;
    state.textContent="Ошибка проверки";
    preview.innerHTML='<strong>Импорт остановлен</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
    preview.classList.remove("hidden");
  }
}

async function applyPendingEstimateImport() {
  const pending=ui.pendingEstimateImport;
  if(!pending || !dataState.project) return;
  const modal=estimateImportModal();
  const state=modal.querySelector(".spec-import-state");
  const preview=modal.querySelector(".spec-import-preview");
  const apply=modal.querySelector(".estimate-import-apply");
  apply.disabled=true;
  state.textContent="Записываю смету и выполняю точное сопоставление…";
  try{
    const result=await client.rpc("apply_estimate_import",{
      p_project_id:dataState.project.id,
      p_estimate_number:pending.number,
      p_source_name:pending.fileName,
      p_source_sha256:pending.hash,
      p_estimate_name:pending.parsed.estimateName,
      p_sections:pending.parsed.sections,
      p_rows:pending.parsed.rows,
      p_notes:pending.parsed.notes
    });
    if(result.error) throw result.error;
    const report=result.data||{};
    ui.pendingEstimateImport=null;
    ui.estimates[pending.number]=true;
    await refreshProjectDataSlices(["estimates","estimateSections","estimateRows","estimateCosts","reconciliationLinks","reconciliationJournal","estimateWorkLinks"],dataState.project);
    renderPage("estimates",0);
    await refreshEstimateImportStatuses();
    const rec=report.reconciliation||{};
    state.textContent="Импорт завершён";
    preview.innerHTML=
      '<strong>Смета №'+esc(pending.number)+' загружена</strong>'+
      '<span>'+esc(String(report.rows||0))+' строк</span>'+
      '<span>'+esc(String(report.materials||0))+' М</span>'+
      '<span>'+esc(String(rec.auto_links_created||0))+' автосвязей</span>'+
      '<span>'+esc(String(rec.unlinked_material_rows||0))+' без связи</span>';
    preview.classList.remove("hidden");
  }catch(err){
    state.textContent="Ошибка импорта";
    preview.innerHTML='<strong>Не удалось записать смету</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
    preview.classList.remove("hidden");
    apply.disabled=false;
  }
}

async function openEstimateImportModal() {
  const modal=estimateImportModal();
  ui.pendingEstimateImport=null;
  modal.querySelector(".spec-import-preview").classList.add("hidden");
  modal.querySelector(".estimate-import-apply").disabled=true;
  modal.querySelector(".spec-import-state").textContent="";
  modal.classList.add("open");
  await refreshEstimateImportStatuses();
}
