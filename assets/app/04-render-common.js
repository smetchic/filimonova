const PAGE_MENU_HTML='<button class="action more" data-page-menu type="button" aria-label="Ещё" aria-haspopup="true">…</button>';

function renderUtilityActions(pageKey) {
  const el=$("pageActions");
  if(!el) return;
  if(pageKey==="spec"){
    el.innerHTML='<button class="action" data-spec-import-open type="button">Импорт Excel</button>'+PAGE_MENU_HTML;
    const btn=el.querySelector("[data-spec-import-open]");
    if(btn) btn.onclick=openSpecImportModal;
  }else if(pageKey==="estimates"){
    el.innerHTML='<button class="action" data-estimate-import-open type="button">Импорт Excel</button>'+PAGE_MENU_HTML;
    const btn=el.querySelector("[data-estimate-import-open]");
    if(btn) btn.onclick=openEstimateImportModal;
  }else{
    el.innerHTML=PAGE_MENU_HTML;
  }
  el.querySelector("[data-page-menu]").onclick=function(e){e.stopPropagation();togglePageMenu(e.currentTarget);};
}

function closePageMenu() {
  const menu=document.querySelector(".page-menu");
  if(menu) menu.remove();
  document.removeEventListener("click",closePageMenu);
}

function togglePageMenu(anchor) {
  if(document.querySelector(".page-menu")) return closePageMenu();
  const hasTable=!!document.querySelector("#workArea table");
  const menu=document.createElement("div");
  menu.className="page-menu";
  menu.setAttribute("role","menu");
  menu.innerHTML=
    '<button type="button" role="menuitem" data-page-menu-action="excel"'+(hasTable?'':' disabled')+'>Скачать таблицу в Excel</button>'+
    '<button type="button" role="menuitem" data-page-menu-action="print">Печать страницы</button>';
  const rect=anchor.getBoundingClientRect();
  menu.style.top=Math.round(rect.bottom+4)+"px";
  menu.style.right=Math.round(window.innerWidth-rect.right)+"px";
  document.body.appendChild(menu);
  menu.querySelector('[data-page-menu-action="excel"]').onclick=function(){closePageMenu();exportCurrentTableToExcel();};
  menu.querySelector('[data-page-menu-action="print"]').onclick=function(){closePageMenu();window.print();};
  setTimeout(function(){document.addEventListener("click",closePageMenu);},0);
}

// Numbers in tables are formatted for reading ("1 164 000,00"); turn them back into
// numbers so Excel can sum them.
function excelValueFromText(text) {
  const t=String(text).replace(/[\u00a0\u202f\s]/g,"");
  if(/^[-−]?\d+(,\d+)?$/.test(t)) return Number(t.replace("−","-").replace(",","."));
  return text;
}

async function exportCurrentTableToExcel() {
  const table=document.querySelector("#workArea table");
  if(!table) return;
  let XLSX;
  try{XLSX=await ensureXlsxLoaded();}catch(err){alert(err.message||String(err));return;}
  const sheet=XLSX.utils.table_to_sheet(table,{raw:true});
  Object.keys(sheet).forEach(function(addr){
    const cell=sheet[addr];
    if(addr[0]==="!" || !cell || typeof cell.v!=="string") return;
    cell.v=cell.v.replace(/^[▾▸▼►]\s*/,"");
    const v=excelValueFromText(cell.v.trim());
    if(typeof v==="number"){cell.v=v;cell.t="n";}
  });
  const page=pages[ui.page]||{title:"Таблица",tabs:[]};
  const tabName=page.tabs[ui.tabs[ui.page]||0]||"";
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,"Таблица");
  const date=new Date().toISOString().slice(0,10);
  const name=[page.title.split(" — ")[0],tabName!==page.title?tabName:"",date].filter(Boolean).join(" · ");
  const blob=new Blob([XLSX.write(book,{type:"array",bookType:"xlsx"})],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);
  link.download=name.replace(/[\\/:*?"<>|]/g,"-")+".xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function(){URL.revokeObjectURL(link.href);},1000);
}

function buildSpecContext(tab) {
  const sections = buildingSections();
  const all = sections.every(specSectionOn) && ui.spec.basement && ui.spec.above && ui.spec.stairs;
  let html = '<span class="context-caption">Показывать:</span>';
  html += checkHtml("all","Все",all,"spec");
  sections.forEach(function(bs){ html += checkHtml(sectionKey(bs),bs,specSectionOn(bs),"spec"); });
  html += checkHtml("basement","Цокольные",ui.spec.basement,"spec");
  html += checkHtml("above","Выше 0.000",ui.spec.above,"spec");
  html += checkHtml("stairs","Лестницы",ui.spec.stairs,"spec");
  return html;
}

function buildEstimateContext(tab) {
  if (tab !== 0 && !(ui.page === "avr" && tab === 2)) return "";
  const numbers = dataState.estimates.map(function(e){ return e.number; });
  const all = numbers.length > 0 && numbers.every(function(n){ return ui.estimates[n] !== false; });
  let html = '<span class="context-caption">Показывать:</span>';
  html += checkHtml("all","Все",all,"estimate");
  numbers.forEach(function(n){ html += checkHtml(n,"№"+n,ui.estimates[n] !== false,"estimate"); });
  return html;
}

function buildContext(pageKey, tab) {
  if (pageKey === "spec") return buildSpecContext(tab);
  if (pageKey === "estimates") {
    if (tab === 0) return buildEstimateContext(tab);
    if (tab === 1) {
      const selected=dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;});
      const nums=selected.map(function(e){return "№"+e.number;});
      const note=!nums.length
        ? "Нет выбранных смет для расчёта"
        : nums.length===1
          ? "Текущая цена рассчитана по смете "+nums[0]
          : "Текущая цена рассчитана по сметам "+nums.join(", ");
      return '<span class="context-caption">Текущая цена</span><span class="context-muted">'+esc(note)+'</span>';
    }
    if (tab === 2) return gprPeriodControlsHtml() + '<span class="spacer"></span>' + (ui.isAdmin?'<button class="context-link" type="button" data-gpr-action="settings">Параметры ГПР</button>':'') + '<button class="context-link" type="button" data-gpr-action="spread">Разнести по графику</button><button class="context-link" type="button" data-gpr-action="display">Отображение</button><button class="context-link" type="button" data-gpr-action="excel">Экспорт Excel</button>';
  }
  if (pageKey === "recon") {
    if (tab === 0) return buildSpecContext(0);
    return '<span class="context-caption">Журнал</span><span class="context-muted">Только записи, добавленные вручную из Сверки</span>';
  }
  if (pageKey === "links") {
    return buildEstimateContext(0);
  }
  if (pageKey === "montage") {
    const montage=ui.montage||{level:"1",period:""};
    const sections=buildingSections();
    const all=sections.every(montageSectionOn);
    const levels=levelCodes();
    if(!levels.includes(montage.level)) montage.level="1";
    if(!montage.period){
      const now=new Date();
      montage.period=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
    }
    return '<span class="context-caption">Показывать:</span>' +
      checkHtml("all","Все",all,"montage") +
      sections.map(function(bs){return checkHtml(sectionKey(bs),bs,montageSectionOn(bs),"montage");}).join("") +
      '<span>·</span><span class="context-caption">Уровень:</span>'+
      '<select class="execution-select execution-period-select montage-context-select" data-montage-level>'+
        levels.map(function(code){return '<option value="'+esc(code)+'"'+(code===montage.level?' selected':'')+'>'+esc(code)+'</option>';}).join("")+
      '</select>'+
      '<span>·</span><span class="context-caption">Месяц:</span>'+
      monthSelectHtml(montage.period,'data-montage-period',false);
  }
  if (pageKey === "avr") {
    if (tab === 0) {
      const doc=selectedAvrDocument();
      const version=selectedAvrVersion();
      const versions=doc?versionsForDocument(doc.id):[];
      return '<span class="context-caption">Месяц:</span>'+monthSelectHtml(ui.avr.period,'data-avr-period',false)+
        '<span>·</span><strong>АВР №'+esc(doc&&doc.display_number||"—")+'</strong>'+
        '<span>·</span><select class="execution-select execution-version-select" data-avr-version '+(!versions.length?'disabled':'')+' aria-label="Версия АВР">'+
        (!versions.length?'<option>версия —</option>':versions.map(function(v){return '<option value="'+v.id+'"'+(version&&v.id===version.id?' selected':'')+'>версия №'+v.version_no+'</option>';}).join(""))+
        '</select><span class="execution-status '+(version?version.state:'draft')+'">'+esc(avrStatus(version).toLowerCase())+'</span>';
    }
    if (tab === 1) {
      const filter=ui.avr.registryPeriod||"all";
      return '<span class="context-caption">Период:</span>'+monthSelectHtml(filter,'data-avr-registry-period',true)+'<span class="spacer"></span><input class="execution-file" data-avr-file type="file" accept=".xlsx,.xls,.xlsm" hidden><button class="context-link" data-avr-import type="button" '+(filter==="all"?'disabled':'')+'>Импорт Excel АВР</button>';
    }
    return buildEstimateContext(0);
  }
  if (pageKey === "s29") {
    if (tab === 0) {
      const doc=selectedS29Document();
      const avrDoc=(dataState.avrDocuments||[]).find(function(x){return periodKey(x.period_month)===ui.s29.period;});
      const signed=avrDoc?versionsForDocument(avrDoc.id).find(function(v){return v.state==="signed"||v.signed_at;}):null;
      const periodSource=(dataState.accountingPeriodSources||[]).find(function(x){return periodKey(x.period_month)===ui.s29.period;});
      const source=periodSource?(dataState.imports||[]).find(function(x){return x.id===periodSource.import_id;}):null;
      const stale=!!doc&&!!signed&&!!periodSource&&(doc.avr_version_id!==signed.id||doc.accounting_import_id!==periodSource.import_id);
      let actions='<button class="context-link" data-s29-form type="button" '+(!doc?'disabled':'')+'>Бланк С-29</button><button class="context-link" data-s29-excel type="button" '+(!doc?'disabled':'')+'>Расшифровка Excel</button>';
      if(signed&&periodSource&&(!doc||doc.status!=="fixed")) actions='<button class="context-link" data-s29-calculate type="button">'+(doc?(stale?'АВР месяца изменился · Обновить данные':'Пересчитать'):'Рассчитать С-29')+'</button>'+actions;
      if(doc&&doc.status!=="fixed") actions+='<button class="context-link" data-s29-fix="'+doc.id+'" type="button">Зафиксировать</button>';
      if(doc&&doc.status==="fixed") actions+='<span class="execution-status signed">Зафиксирован</span>';
      return '<span class="context-caption">Месяц:</span>'+monthSelectHtml(ui.s29.period,'data-s29-period',false)+'<span>·</span><strong>'+(signed?'АВР v'+signed.version_no:'АВР: нет')+'</strong><span>·</span><span class="context-muted">бух. импорт '+esc(source&&source.source_name||"—")+'</span><span class="spacer"></span>'+actions;
    }
    if(tab===1) return '<span class="context-caption">Месяц:</span>'+monthSelectHtml(ui.s29.period,'data-accounting-period',false)+'<span class="context-muted">immutable snapshot</span><span class="spacer"></span><input class="execution-file" data-accounting-file type="file" accept=".xlsx,.xls,.xlsm" hidden><button class="context-link" data-accounting-import type="button">Импорт бухгалтерии</button>';
    if(tab===2) return '<span class="context-caption">Сопоставление кодов бухгалтерии с проектной номенклатурой</span>';
    return '<span class="context-caption">FIFO: сначала погашается экономия предыдущих месяцев</span>';
  }
  if (pageKey === "supply") {
    if (tab === 1) return '<span class="context-caption">Документы поставки</span><span class="context-muted supply-doc-context-note">Белые ТТН фиксируют фактическое поступление сразу; зелёные ТТН документально подтверждают его.</span><span class="spacer"></span><button class="context-link supply-doc-add-link" data-supply-doc-add type="button">+ Добавить накладную</button><span class="context-muted supply-doc-edit-hint">Двойной клик по строке — редактировать</span>';
    if (tab === 2) return '<span class="context-caption">Прайс поставщика</span><span>Исходный порядок и данные поставщика · сверка с Рабочей сводкой</span><span class="spacer"></span><button class="context-link" data-supplier-check-open type="button">Проверить прайс</button><button class="context-link" data-supplier-import-open type="button">Импорт прайса поставщика</button>';
    return '<span class="context-muted">Данные по всему объекту</span>';
  }
  return "";
}

function buildServiceLeft(pageKey,tab) {
  if (pageKey === "spec") {
    return '<span class="legend-item"><span class="legend-dot supply"></span>Поставка</span>' +
      '<span class="legend-item"><span class="legend-dot montage"></span>Монтаж</span>' +
      '<span class="legend-item"><span class="legend-dot avr"></span>АВР</span>';
  }
  if (pageKey === "estimates" && tab===0) {
    const selected=dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;});
    const ids=new Set(selected.map(function(e){return e.id;}));
    const rows=(dataState.estimateRows||[]).filter(function(r){return ids.has(r.estimate_id) && !r.archived_at;});
    const works=rows.filter(function(r){return r.row_type==="work";}).length;
    const materials=rows.filter(function(r){return r.row_type==="material";}).length;
    return '<span class="context-muted">'+selected.length+' смет · '+works+' работ · '+materials+' материалов</span>';
  }
  if (pageKey === "links") {
    const ids=new Set(dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;}).map(function(e){return e.id;}));
    const materials=(dataState.estimateRows||[]).filter(function(r){return ids.has(r.estimate_id)&&r.row_type==="material";});
    const works=(dataState.estimateRows||[]).filter(function(r){return ids.has(r.estimate_id)&&r.row_type==="work";});
    const links=(dataState.estimateWorkLinks||[]).filter(function(l){
      const m=(dataState.estimateRows||[]).find(function(r){return r.id===l.material_row_id;});
      return m&&ids.has(m.estimate_id);
    });
    const linkedMaterials=new Set(links.map(function(l){return l.material_row_id;})).size;
    const linkedWorks=new Set(links.map(function(l){return l.work_row_id;})).size;
    const last=ui.workLinkLastAuto;
    return '<span class="context-muted">'+linkedMaterials+' / '+materials.length+' материалов · '+linkedWorks+' / '+works.length+' работ имеют связь'+(last?' · авто: '+last.matched+' · не определено: '+last.unresolved:'')+'</span>';
  }
  if (pageKey === "montage") return '<span class="context-muted">'+esc(MONTAGE_CLICK_HINT)+'</span>';
  return "";
}

function isHierarchical(pageKey, tab) {
  if (pageKey === "spec") return true;
  if (pageKey === "estimates") return tab === 0;
  if (pageKey === "supply") return tab === 0 || tab === 2;
  if (pageKey === "avr") return tab === 0 || tab === 2;
  if (pageKey === "links") return true;
  return false;
}

function levelCodes() {
  return ["Ц"].concat(Array.from({length:19},function(_,i){ return String(i+1); })).concat(["Ч","К"]);
}

function qtyAt(row, code) {
  return Number(row.quantities.get(code) || 0);
}

function rowMatchesSpecSearch(row) {
  return passesSearch([row.mark,row.name,row.designation]);
}

function tableMessage(text, colspan) {
  return '<tr><td class="table-message" colspan="' + colspan + '">' + esc(text) + '</td></tr>';
}

function groupArrow(key) {
  return ui.collapsed.has(key) ? "▸" : "▾";
}

function registerGroup(key) {
  ui.currentGroupKeys.push(key);
}

function specGroupRow(label, rows, key, depth, levels) {
  registerGroup(key);
  let html = '<tr class="group-row group-toggle" data-group-key="' + esc(key) + '">';
  html += '<td colspan="3" class="group-title spec-group-title" style="padding-left:' + (8 + depth * 14) + 'px"><span class="group-arrow">' + groupArrow(key) + '</span>' + esc(label) + '</td>';
  levels.forEach(function(code) {
    let value = 0;
    rows.forEach(function(r){ value += code === "Всего" ? r.total : qtyAt(r,code); });
    html += '<td class="level-col num">' + fmt0(value) + '</td>';
  });
  html += '</tr>';
  return html;
}
