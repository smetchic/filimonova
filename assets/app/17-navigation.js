function renderHome() {
  $("workArea").className = "work-area content-work";
  $("workArea").innerHTML =
    '<div class="review-panel"><div class="review-panel-title">Рабочая база проекта подключена</div>' +
    '<div class="review-grid">' +
      '<div><span>Позиции спецификации</span><strong>'+dataState.specRows.length+'</strong></div>' +
      '<div><span>Номенклатура</span><strong>'+dataState.catalogItems.length+'</strong></div>' +
      '<div><span>Сметы</span><strong>'+dataState.estimates.length+'</strong></div>' +
      '<div><span>Строки смет</span><strong>'+dataState.estimateRows.length+'</strong></div>' +
    '</div>' +
    '<div class="review-note">Спецификация загружена из реальных Excel. Сметы и связи отображаются после импорта соответствующих файлов.</div></div>';
}

function renderSimple(text) {
  $("workArea").className = "work-area content-work";
  $("workArea").innerHTML = '<div class="review-panel"><div class="review-panel-title">'+esc(text)+'</div><div class="review-note">Каркас раздела подключён. Детализируем его после основных рабочих экранов.</div></div>';
}

function renderContent(pageKey,tab) {
  if (pageKey === "home") return renderHome();
  if (pageKey === "spec") return tab === 0 ? renderSpecProject() : renderSpecSummary();
  if (pageKey === "estimates") {
    if (tab === 0) return renderEstimateTable();
    if (tab === 1) return renderCurrentPricePlaceholder();
    return renderGprPlaceholder();
  }
  if (pageKey === "supply") {
    if (tab === 0) return renderSupplySummary();
    if (tab === 1) return renderSupplyDocuments();
    return renderSupplierPrice();
  }
  if (pageKey === "montage") return renderMontage(tab);
  if (pageKey === "avr") return renderAvr(tab);
  if (pageKey === "s29") return renderS29(tab);
  if (pageKey === "recon") return tab === 0 ? renderRecon() : renderEstimateJournal();
  if (pageKey === "diffs") return renderSimple("Расхождения");
  if (pageKey === "links") return renderWorkLinks();
  if (pageKey === "import") return renderSimple("Импорт");
  if (pageKey === "docs") return renderSimple("Документы");
  if (pageKey === "settings") return renderSimple("Настройки");
  return renderSimple("Раздел");
}

function wireContextControls() {
  const supplyDocAdd=document.querySelector("[data-supply-doc-add]");
  if(supplyDocAdd) supplyDocAdd.onclick=function(){openSupplyDocumentEditor(null);};
  const supplierImport=document.querySelector("[data-supplier-import-open]");
  if(supplierImport) supplierImport.onclick=openSupplierImportModal;
  const supplierCheck=document.querySelector("[data-supplier-check-open]");
  if(supplierCheck) supplierCheck.onclick=openSupplierCheck;
  document.querySelectorAll('#contextRow input[data-filter-group="spec"]').forEach(function(input) {
    input.addEventListener("click",function(e) {
      const id=input.dataset.filterId;
      if(id==="s1" || id==="s2"){
        const focused = id==="s1" ? (ui.spec.s1 && !ui.spec.s2 && !ui.spec.stairs) : (ui.spec.s2 && !ui.spec.s1 && !ui.spec.stairs);
        e.preventDefault();
        if(focused){
          ui.spec[id]=false;
        }else{
          ui.spec.s1=id==="s1";
          ui.spec.s2=id==="s2";
          ui.spec.basement=true;
          ui.spec.above=true;
          ui.spec.stairs=false;
        }
        renderPage(ui.page,ui.tabs[ui.page]||0);
      }
    });
    input.addEventListener("change",function() {
      const id = input.dataset.filterId;
      if(id==="s1" || id==="s2") return;
      if (id === "all") {
        ["s1","s2","basement","above","stairs"].forEach(function(k){ui.spec[k]=input.checked;});
      } else {
        ui.spec[id] = input.checked;
      }
      renderPage(ui.page,ui.tabs[ui.page]||0);
    });
  });
  const specMaster = document.querySelector('#contextRow input[data-filter-group="spec"][data-filter-id="all"]');
  if (specMaster) {
    const vals = [ui.spec.s1,ui.spec.s2,ui.spec.basement,ui.spec.above,ui.spec.stairs];
    specMaster.indeterminate = vals.some(Boolean) && !vals.every(Boolean);
  }
  document.querySelectorAll('#contextRow input[data-filter-group="estimate"]').forEach(function(input) {
    input.addEventListener("change",function() {
      const id = input.dataset.filterId;
      const nums = dataState.estimates.map(function(e){return e.number;});
      if (id === "all") nums.forEach(function(n){ui.estimates[n]=input.checked;});
      else ui.estimates[id]=input.checked;
      renderPage(ui.page,ui.tabs[ui.page]||0);
    });
  });
  const estMaster = document.querySelector('#contextRow input[data-filter-group="estimate"][data-filter-id="all"]');
  if (estMaster) {
    const vals = dataState.estimates.map(function(e){return ui.estimates[e.number] !== false;});
    estMaster.indeterminate = vals.some(Boolean) && !vals.every(Boolean);
  }

  document.querySelectorAll('#contextRow input[data-filter-group="montage"]').forEach(function(input){
    input.addEventListener("change",function(){
      const id=input.dataset.filterId;
      if(id==="all"){
        ui.montage.s1=input.checked;
        ui.montage.s2=input.checked;
      }else if(id==="s1"||id==="s2"){
        ui.montage[id]=input.checked;
      }
      localStorage.setItem("filimonova.montage.s1",ui.montage.s1?"1":"0");
      localStorage.setItem("filimonova.montage.s2",ui.montage.s2?"1":"0");
      renderPage("montage",ui.tabs.montage||0);
    });
  });
  const montageMaster=document.querySelector('#contextRow input[data-filter-group="montage"][data-filter-id="all"]');
  if(montageMaster){
    const vals=[!!ui.montage.s1,!!ui.montage.s2];
    montageMaster.indeterminate=vals.some(Boolean)&&!vals.every(Boolean);
  }
  const montageLevel=document.querySelector("[data-montage-level]");
  if(montageLevel) montageLevel.onchange=function(){
    ui.montage.level=montageLevel.value;
    localStorage.setItem("filimonova.montage.level",ui.montage.level);
    renderPage("montage",ui.tabs.montage||0);
  };
  const montagePeriod=document.querySelector("[data-montage-period]");
  if(montagePeriod) montagePeriod.onchange=function(){
    ui.montage.period=montagePeriod.value;
    localStorage.setItem("filimonova.montage.period",ui.montage.period);
    renderPage("montage",ui.tabs.montage||0);
  };
}

function wireTableControls() {
  document.querySelectorAll(".group-toggle[data-group-key]").forEach(function(row) {
    row.addEventListener("click",function(e) {
      if(e.target.closest(".column-filter-trigger,.resize-handle")) return;
      const key = row.dataset.groupKey;
      ui.collapseLeaves = false;
      if (ui.collapsed.has(key)) ui.collapsed.delete(key);
      else ui.collapsed.add(key);
      rerenderContent();
    });
  });
  document.querySelectorAll(".data-row").forEach(function(row) {
    row.addEventListener("click",function() {
      document.querySelectorAll(".data-row.active-row").forEach(function(x){x.classList.remove("active-row");});
      row.classList.add("active-row");
    });
  });
  installTableTools();
}

function wireServiceControls() {
  const collapse = document.querySelector('[data-service="collapse"]');
  const expand = document.querySelector('[data-service="expand"]');
  const accountingLinkAuto=document.querySelector("[data-accounting-link-auto]");
  if(accountingLinkAuto) accountingLinkAuto.addEventListener("click",function(){
    autoMatchAccountingLinks();
  });
  const workLinkAuto=document.querySelector("[data-work-link-auto]");
  if(workLinkAuto) workLinkAuto.addEventListener("click",function(){
    autoMatchWorkLinks();
  });
  const workLinkFilter=document.querySelector("[data-work-link-filter]");
  if(workLinkFilter) workLinkFilter.addEventListener("change",function(){
    ui.workLinkFilter=workLinkFilter.value;
    ui.collapsed.clear();
    ui.collapseLeaves=false;
    rerenderContent();
  });
  if (collapse) collapse.addEventListener("click",function() {
    ui.collapsed.clear();
    ui.collapseLeaves = true;
    rerenderContent();
  });
  if (expand) expand.addEventListener("click",function() {
    ui.collapsed.clear();
    ui.collapseLeaves = false;
    rerenderContent();
  });
}

function rerenderContent() {
  const tab = ui.tabs[ui.page] || 0;
  const oldScroller = document.querySelector("#workArea .engineering-scroll");
  const scrollState = oldScroller ? {left:oldScroller.scrollLeft,top:oldScroller.scrollTop} : null;

  ui.currentGroupKeys = [];
  renderContent(ui.page,tab);
  wireTableControls();
  wireServiceControls();
  wireGprControls();
  wireReconciliationControls();
  wireExecutionControls();
  wireMontageControls();

  if (scrollState) {
    const nextScroller = document.querySelector("#workArea .engineering-scroll");
    if (nextScroller) {
      nextScroller.scrollLeft = scrollState.left;
      nextScroller.scrollTop = scrollState.top;
    }
  }
}

function renderPage(pageKey,tabIndex) {
  const previousPage = ui.page;
  const previousTab = ui.tabs[previousPage] || 0;
  const previousScroller = document.querySelector("#workArea .engineering-scroll");
  const previousScroll = previousScroller ? {left:previousScroller.scrollLeft,top:previousScroller.scrollTop} : null;

  const page = pages[pageKey] || pages.home;
  ui.page = pageKey;
  localStorage.setItem("filimonova.ui.page",pageKey);

  let tab = tabIndex == null ? (ui.tabs[pageKey] || 0) : Number(tabIndex);
  if (!Number.isFinite(tab) || tab < 0 || tab >= page.tabs.length) tab = 0;
  ui.tabs[pageKey] = tab;

  document.querySelectorAll(".nav-btn").forEach(function(btn) {
    btn.classList.toggle("active",btn.dataset.page === pageKey);
  });

  $("breadcrumbs").innerHTML = '<span>Филимонова</span><span class="slash">/</span><span>'+esc(page.section)+'</span><span class="slash">/</span><span class="current">'+esc(page.title)+'</span>';
  $("pageTitle").textContent = page.title;
  $("pageSubtitle").textContent = page.subtitle;
  renderUtilityActions(pageKey);

  $("pageTabs").innerHTML = page.tabs.map(function(label,i) {
    return '<button class="page-tab'+(i===tab?' active':'')+'" type="button" data-tab="'+i+'">'+esc(label)+'</button>';
  }).join("");
  $("pageTabs").querySelectorAll(".page-tab").forEach(function(btn) {
    btn.addEventListener("click",function() {
      const nextTab = Number(btn.dataset.tab);
      renderPage(pageKey,nextTab);
    });
  });

  const searchKey = pageKey+":"+tab;
  $("searchInput").value = ui.search[searchKey] || "";
  $("globalSearch").classList.toggle("has-value",!!$("searchInput").value);

  $("contextRow").innerHTML = buildContext(pageKey,tab);
  $("contextRow").classList.toggle("avr-context-row",(pageKey==="avr" && tab===0) || (pageKey==="s29" && tab===0));
  $("contextRow").classList.toggle("supply-doc-context-row",pageKey==="supply" && tab===1);
  $("serviceLeft").innerHTML = buildServiceLeft(pageKey,tab);
  $("serviceRow").classList.toggle("hidden",
    (pageKey==="estimates" && (tab===1 || tab===2)) ||
    (pageKey==="supply" && tab===1) ||
    (pageKey==="avr" && tab===0) ||
    (pageKey==="s29" && tab===0)
  );
  // Project UI rule: page-level controls belong in the existing service row;
  // do not add local button bars above working tables.
  if(pageKey==="recon" && tab===0){
    if(!ui.reconLinkFilter) ui.reconLinkFilter="all";
    $("serviceRight").innerHTML =
      '<span class="context-muted">Сопоставление:</span>' +
      '<select class="service-select" data-recon-link-select aria-label="Фильтр сопоставления">' +
        '<option value="all"'+(ui.reconLinkFilter==="all"?' selected':'')+'>Все</option>' +
        '<option value="issues"'+(ui.reconLinkFilter==="issues"?' selected':'')+'>Только расхождения</option>' +
        '<option value="unlinked"'+(ui.reconLinkFilter==="unlinked"?' selected':'')+'>Без связи</option>' +
        '<option value="linked"'+(ui.reconLinkFilter==="linked"?' selected':'')+'>Связано</option>' +
      '</select>';
  } else if(pageKey==="recon" && tab===1){
    $("serviceRight").innerHTML =
      '<button class="service-action" data-recon-journal-export type="button">Экспорт в Excel</button>';
  } else if(pageKey==="s29" && tab===2){
    const autoSummary=ui.accountingLinkLastAuto
      ? '<span class="context-muted">'+ui.accountingLinkLastAuto.matched+' авто · '+ui.accountingLinkLastAuto.unresolved+' без связи</span>'
      : '';
    $("serviceRight").innerHTML =
      '<button class="service-action" data-accounting-link-auto type="button">Автосопоставить</button>'+
      autoSummary+
      '<span class="context-muted">Показать:</span>'+
      '<select class="service-select" data-accounting-link-filter aria-label="Фильтр связей бухгалтерии">'+
        '<option value="unmatched"'+(ui.accountingLinkFilter==="unmatched"?' selected':'')+'>Не сопоставлено</option>'+
        '<option value="all"'+(ui.accountingLinkFilter==="all"?' selected':'')+'>Все</option>'+
        '<option value="auto"'+(ui.accountingLinkFilter==="auto"?' selected':'')+'>Авто</option>'+
        '<option value="manual"'+(ui.accountingLinkFilter==="manual"?' selected':'')+'>Ручные</option>'+
      '</select>';
  } else if(pageKey==="links"){
    if(!ui.workLinkFilter) ui.workLinkFilter="all";
    $("serviceRight").innerHTML =
      '<button class="service-action" data-work-link-auto type="button">Автосопоставить</button>'+
      '<span class="context-muted">Показать:</span>'+
      '<select class="service-select" data-work-link-filter aria-label="Фильтр связей работ">'+
        '<option value="all"'+(ui.workLinkFilter==="all"?' selected':'')+'>Все</option>'+
        '<option value="unlinked"'+(ui.workLinkFilter==="unlinked"?' selected':'')+'>Материалы без работы</option>'+
        '<option value="linked"'+(ui.workLinkFilter==="linked"?' selected':'')+'>Работы с материалом</option>'+
        '<option value="work-unlinked"'+(ui.workLinkFilter==="work-unlinked"?' selected':'')+'>Работы без материала</option>'+
      '</select>'+
      '<button class="service-action" data-service="collapse" type="button">Свернуть всё</button>'+
      '<button class="service-action" data-service="expand" type="button">Развернуть всё</button>';
  } else {
    $("serviceRight").innerHTML = isHierarchical(pageKey,tab)
      ? '<button class="service-action" data-service="collapse" type="button">Свернуть всё</button><button class="service-action" data-service="expand" type="button">Развернуть всё</button>'
      : "";
  }

  wireContextControls();
  ui.currentGroupKeys = [];
  renderContent(pageKey,tab);
  wireTableControls();
  wireServiceControls();
  wireGprControls();
  wireReconciliationControls();
  wireExecutionControls();
  wireMontageControls();

  if (previousScroll && previousPage === pageKey && previousTab === tab) {
    const nextScroller = document.querySelector("#workArea .engineering-scroll");
    if (nextScroller) {
      nextScroller.scrollLeft = previousScroll.left;
      nextScroller.scrollTop = previousScroll.top;
    }
  }
}
