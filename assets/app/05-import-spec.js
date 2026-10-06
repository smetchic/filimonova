const SPEC_IMPORT_SLOTS = [
  {key:"spec_s1_basement",label:"Секция 1 — Цоколь",kind:"project"},
  {key:"spec_s1_above",label:"Секция 1 — Выше 0.000",kind:"project"},
  {key:"spec_s2_basement",label:"Секция 2 — Цоколь",kind:"project"},
  {key:"spec_s2_above",label:"Секция 2 — Выше 0.000",kind:"project"},
  {key:"spec_stairs",label:"Элементы лестниц",kind:"stairs"}
];

const SPEC_BASEMENT_SECTIONS = [
  "Наружные стеновые панели цоколя",
  "Внутренние стеновые панели цоколя",
  "Внутренние стеновые перегородки цоколя",
  "Панели стеновые шахт лифтов",
  "Разделительные стенки лоджий цоколя",
  "Стенки входа цоколя",
  "Плиты перекрытия",
  "Плиты лоджий",
  "Плиты шахт лифтов",
  "Плиты входа",
  "Опорные вкладыши"
];

const SPEC_ABOVE_SECTIONS = [
  "Наружные стеновые панели",
  "Наружные стеновые панели чердака",
  "Внутренние стеновые панели",
  "Внутренние стеновые панели чердака",
  "Внутренние стеновые перегородки",
  "Панели стеновые шахт лифтов",
  "Разделительные стенки лоджий",
  "Ограждение лоджий",
  "Вентиляционные блоки",
  "Плиты перекрытия",
  "Плиты покрытия",
  "Плиты лоджий",
  "Плиты шахт лифтов",
  "Опорные вкладыши",
  "Стенки входа",
  "Экраны козырьков входа",
  "Козырьки входа"
];

function importText(v) {
  return v == null ? "" : String(v).replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
}

function importNorm(v) {
  return importText(v).toLowerCase().replace(/ё/g,"е");
}

function canonicalSectionName(value,slotKey) {
  const list = slotKey.includes("basement") ? SPEC_BASEMENT_SECTIONS : SPEC_ABOVE_SECTIONS;
  const n=importNorm(value);
  return list.find(function(x){return importNorm(x)===n;}) || "";
}

function excelHeaderMap(row) {
  const out={};
  row.forEach(function(v,i){
    const n=importNorm(v).replace(/[.:]/g,"").trim();
    if(!n) return;
    if(n==="поз" || n==="марка") out.mark=i;
    else if(n.includes("обознач")) out.designation=i;
    else if(n.includes("наимен")) out.name=i;
    else if(n==="всего") out.total=i;
    else if(n.includes("масса")) out.mass=i;
    else if(n.includes("количество") || n==="кол-во" || n==="кол во") out.quantity=i;
    else if(n.includes("цоколь")) out.levelC=i;
    else if(n==="чердак" || n==="ч") out.levelAttic=i;
    else if(n==="кровля" || n==="крыша" || n==="к") out.levelRoof=i;
    else if(/^(?:[1-9]|1[0-9])$/.test(n)) {
      if(!out.levels) out.levels={};
      out.levels[n]=i;
    }
  });
  return out;
}

async function sha256Hex(buffer) {
  const digest=await crypto.subtle.digest("SHA-256",buffer);
  return Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
}

function parseSpecificationWorkbook(buffer,slotKey) {
  if(!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const wb=XLSX.read(buffer,{type:"array",cellDates:false,cellFormula:false});
  const preferred=slotKey==="spec_stairs" ? ["Импорт","Спецификация"] : ["Спецификация","Импорт"];
  let sheetName=preferred.find(function(n){return wb.SheetNames.includes(n);}) || wb.SheetNames[0];
  if(!sheetName) throw new Error("В Excel нет листов.");
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:null,raw:true,blankrows:false});
  if(!rows.length) throw new Error("Лист Excel пуст.");

  let headerIndex=-1, map=null;
  for(let i=0;i<Math.min(rows.length,40);i++){
    const m=excelHeaderMap(rows[i]||[]);
    const hasIdentity=(m.mark!=null && m.name!=null);
    const hasProjectLevels=(m.levelC!=null || (m.levels && Object.keys(m.levels).length) || m.levelAttic!=null || m.levelRoof!=null);
    const hasStairLevels=((m.levels && Object.keys(m.levels).length) || m.levelAttic!=null || m.levelRoof!=null);
    if(hasIdentity && (slotKey==="spec_stairs" ? hasStairLevels : hasProjectLevels)){
      headerIndex=i; map=m; break;
    }
  }
  if(headerIndex<0) throw new Error("Не найдена строка заголовков спецификации.");

  const basement=slotKey.includes("basement");
  const stairs=slotKey==="spec_stairs";
  if(!stairs && basement && map.levelC==null) throw new Error("Не найдена колонка «Цокольный этаж».");
  if(!stairs && !basement && !(map.levels && Object.keys(map.levels).length)) throw new Error("Не найдены поэтажные колонки 1–19.");
  if(stairs && !(map.levels && Object.keys(map.levels).length) && map.levelAttic==null && map.levelRoof==null) throw new Error("Для элементов лестниц нужны поэтажные колонки 1–19 / Чердак / Кровля.");

  let currentSection=stairs ? "Элементы лестниц" : "";
  const panels=[];
  const identityCounts=new Map();
  const issues=[];

  for(let r=headerIndex+1;r<rows.length;r++){
    const row=rows[r]||[];
    const mark=importText(row[map.mark]);
    const name=importText(row[map.name]);
    const designation=map.designation==null ? "" : importText(row[map.designation]);

    if(!stairs && !mark){
      const section=canonicalSectionName(name,slotKey);
      if(section) currentSection=section;
      continue;
    }
    if(!mark && !name) continue;
    if(!mark || !name) {
      issues.push("Строка "+(r+1)+": отсутствует Марка или Наименование.");
      continue;
    }
    if(!currentSection) {
      issues.push("Строка "+(r+1)+": позиция идёт до известного заголовка раздела.");
      continue;
    }

    const levels={};
    if(stairs){
      Object.keys(map.levels||{}).forEach(function(code){
        const q=Number(row[map.levels[code]]||0);
        if(Number.isFinite(q) && q!==0) levels[code]=q;
      });
      if(map.levelAttic!=null){
        const q=Number(row[map.levelAttic]||0); if(Number.isFinite(q)&&q!==0) levels["Ч"]=q;
      }
      if(map.levelRoof!=null){
        const q=Number(row[map.levelRoof]||0); if(Number.isFinite(q)&&q!==0) levels["К"]=q;
      }
    } else if(basement){
      const q=Number(row[map.levelC]||0);
      if(Number.isFinite(q) && q!==0) levels["Ц"]=q;
    } else {
      Object.keys(map.levels||{}).forEach(function(code){
        const q=Number(row[map.levels[code]]||0);
        if(Number.isFinite(q) && q!==0) levels[code]=q;
      });
      if(map.levelAttic!=null){
        const q=Number(row[map.levelAttic]||0); if(Number.isFinite(q)&&q!==0) levels["Ч"]=q;
      }
      if(map.levelRoof!=null){
        const q=Number(row[map.levelRoof]||0); if(Number.isFinite(q)&&q!==0) levels["К"]=q;
      }
    }

    const calcTotal=Object.values(levels).reduce(function(a,b){return a+Number(b||0);},0);
    const sourceTotalRaw=map.total==null ? null : row[map.total];
    const sourceTotal=(sourceTotalRaw==null || importText(sourceTotalRaw)==="") ? calcTotal : Number(sourceTotalRaw);
    if(!Number.isFinite(sourceTotal)) {
      issues.push("Строка "+(r+1)+": некорректное значение «Всего».");
      continue;
    }
    if(Math.abs(sourceTotal-calcTotal)>0.000001){
      issues.push("Строка "+(r+1)+": «Всего» = "+sourceTotal+", сумма уровней = "+calcTotal+".");
      continue;
    }
    if(calcTotal<=0){
      issues.push("Строка "+(r+1)+": количество равно нулю.");
      continue;
    }

    const massRaw=map.mass==null ? null : row[map.mass];
    const mass=(massRaw==null || importText(massRaw)==="") ? null : Number(massRaw);
    if(mass!=null && !Number.isFinite(mass)){
      issues.push("Строка "+(r+1)+": некорректная масса.");
      continue;
    }

    const normalizedKey=importNorm(mark)+"|"+importNorm(name);
    const baseIdentity=importNorm(currentSection)+"|"+importNorm(mark)+"|"+importNorm(designation)+"|"+importNorm(name);
    const occurrence=(identityCounts.get(baseIdentity)||0)+1;
    identityCounts.set(baseIdentity,occurrence);
    const sourceIdentity=baseIdentity+"#"+occurrence;

    panels.push({
      source_row_no:r+1,
      section:currentSection,
      mark:mark,
      name:name,
      designation:designation,
      normalized_key:normalizedKey,
      source_identity:sourceIdentity,
      levels:levels,
      source_total:sourceTotal,
      mass_kg:mass
    });
  }

  if(issues.length) throw new Error(issues.slice(0,8).join("\n")+(issues.length>8?"\n… ещё "+(issues.length-8):""));
  if(!panels.length) throw new Error("Не найдено ни одной позиции для импорта.");

  const totalQty=panels.reduce(function(sum,p){return sum+Number(p.source_total||0);},0);
  const sectionCount=new Set(panels.map(function(p){return p.section;})).size;
  return {sheetName:sheetName,panels:panels,totalQty:totalQty,sectionCount:sectionCount};
}

function specImportModal() {
  let modal=document.getElementById("specImportModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="specImportModal";
  modal.className="spec-import-backdrop";
  modal.innerHTML=
    '<div class="spec-import-modal">'+
      '<div class="spec-import-head"><div><strong>Импорт спецификации</strong><span>Excel загружается в явно выбранный слот проекта</span></div><button class="spec-import-close" type="button">×</button></div>'+
      '<div class="spec-import-list"></div>'+
      '<div class="spec-import-preview hidden"></div>'+
      '<div class="spec-import-foot"><span class="spec-import-state"></span><span class="spacer"></span><button class="context-link spec-import-cancel" type="button">Закрыть</button><button class="context-link spec-import-apply" type="button" disabled>Импортировать</button></div>'+
    '</div>';
  document.body.appendChild(modal);
  modal.querySelector(".spec-import-close").onclick=function(){modal.classList.remove("open");};
  modal.querySelector(".spec-import-cancel").onclick=function(){modal.classList.remove("open");};
  modal.onclick=function(e){if(e.target===modal) modal.classList.remove("open");};
  modal.querySelector(".spec-import-apply").onclick=applyPendingSpecImport;
  return modal;
}

async function refreshSpecImportStatuses() {
  const modal=specImportModal();
  const list=modal.querySelector(".spec-import-list");
  const result=await client.from("imports")
    .select("id,source_slot,source_name,status,report,applied_at,imported_at")
    .eq("project_id",dataState.project.id)
    .eq("domain","specification")
    .eq("status","applied")
    .order("imported_at",{ascending:false});
  const latest={};
  if(!result.error){
    (result.data||[]).forEach(function(x){if(x.source_slot && !latest[x.source_slot]) latest[x.source_slot]=x;});
  }
  list.innerHTML=SPEC_IMPORT_SLOTS.map(function(slot){
    const cur=latest[slot.key];
    const detail=cur
      ? '<span class="spec-import-loaded">'+esc(cur.source_name||"Excel")+' · '+esc(String((cur.report&&cur.report.positions)||"—"))+' поз. · '+esc(String((cur.report&&cur.report.quantity_total)||"—"))+' шт.</span>'
      : '<span class="spec-import-empty">не загружено</span>';
    return '<div class="spec-import-row">'+
      '<div class="spec-import-slot"><strong>'+esc(slot.label)+'</strong>'+detail+'</div>'+
      '<input class="spec-import-file" type="file" accept=".xlsx,.xls,.xlsm" data-slot="'+esc(slot.key)+'">'+
      '<button class="context-link spec-file-pick" type="button" data-slot="'+esc(slot.key)+'">Выбрать Excel</button>'+
    '</div>';
  }).join("");

  list.querySelectorAll(".spec-file-pick").forEach(function(btn){
    btn.onclick=function(){
      const input=list.querySelector('.spec-import-file[data-slot="'+CSS.escape(btn.dataset.slot)+'"]');
      input.value="";
      input.click();
    };
  });
  list.querySelectorAll(".spec-import-file").forEach(function(input){
    input.onchange=function(){if(input.files&&input.files[0]) prepareSpecImport(input.dataset.slot,input.files[0]);};
  });
}

async function prepareSpecImport(slotKey,file) {
  await ensureXlsxLoaded();
  const modal=specImportModal();
  const state=modal.querySelector(".spec-import-state");
  const preview=modal.querySelector(".spec-import-preview");
  const apply=modal.querySelector(".spec-import-apply");
  apply.disabled=true;
  state.textContent="Читаю Excel…";
  preview.classList.add("hidden");
  try{
    const buffer=await file.arrayBuffer();
    const parsed=parseSpecificationWorkbook(buffer,slotKey);
    const hash=await sha256Hex(buffer);
    ui.pendingSpecImport={slotKey:slotKey,fileName:file.name,hash:hash,parsed:parsed};
    const slot=SPEC_IMPORT_SLOTS.find(function(x){return x.key===slotKey;});
    preview.innerHTML='<strong>'+esc(slot?slot.label:slotKey)+'</strong>'+
      '<span>'+esc(file.name)+'</span>'+
      '<span>'+parsed.panels.length+' позиций</span>'+
      '<span>'+fmt0(parsed.totalQty)+' шт.</span>'+
      '<span>'+parsed.sectionCount+' разделов</span>'+
      '<span>лист «'+esc(parsed.sheetName)+'»</span>';
    preview.classList.remove("hidden");
    state.textContent="Проверка пройдена";
    apply.disabled=false;
  }catch(err){
    ui.pendingSpecImport=null;
    state.textContent="";
    preview.innerHTML='<strong>Импорт остановлен</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
    preview.classList.remove("hidden");
  }
}

async function applyPendingSpecImport() {
  const pending=ui.pendingSpecImport;
  if(!pending || !dataState.project) return;
  const modal=specImportModal();
  const state=modal.querySelector(".spec-import-state");
  const apply=modal.querySelector(".spec-import-apply");
  apply.disabled=true;
  state.textContent="Записываю в базу…";
  try{
    let result;
    if(pending.slotKey==="spec_stairs"){
      result=await client.rpc("apply_specification_stairs_import",{
        p_project_id:dataState.project.id,
        p_source_name:pending.fileName,
        p_source_sha256:pending.hash,
        p_panels:pending.parsed.panels
      });
    }else{
      result=await client.rpc("apply_specification_slot_import",{
        p_project_id:dataState.project.id,
        p_source_slot:pending.slotKey,
        p_source_name:pending.fileName,
        p_source_sha256:pending.hash,
        p_panels:pending.parsed.panels
      });
    }
    if(result.error) throw result.error;
    ui.pendingSpecImport=null;
    state.textContent="Импорт завершён";
    modal.querySelector(".spec-import-preview").classList.add("hidden");
    await refreshProjectDataSlices(["catalogItems","specSections","specRows","specQuantities","reconciliationLinks"],dataState.project);
    const tab=ui.tabs.spec||0;
    renderPage("spec",tab);
    await refreshSpecImportStatuses();
  }catch(err){
    state.textContent="Ошибка импорта";
    const preview=modal.querySelector(".spec-import-preview");
    preview.innerHTML='<strong>Не удалось записать данные</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
    preview.classList.remove("hidden");
    apply.disabled=false;
  }
}

async function openSpecImportModal() {
  const modal=specImportModal();
  ui.pendingSpecImport=null;
  modal.querySelector(".spec-import-preview").classList.add("hidden");
  modal.querySelector(".spec-import-apply").disabled=true;
  modal.querySelector(".spec-import-state").textContent="";
  modal.classList.add("open");
  await refreshSpecImportStatuses();
}
