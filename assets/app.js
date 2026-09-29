(() => {
  const cfg = window.FILIMONOVA_CONFIG;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<div style="padding:24px;font-family:Segoe UI">Ошибка загрузки конфигурации.</div>';
    return;
  }

  const query = new URLSearchParams(window.location.search);
  const reviewMode = query.get("review") === "1";
  const requestedPage = query.get("page");

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const appView = $("appView");
  const deniedView = $("deniedView");
  const loginForm = $("loginForm");
  const signupForm = $("signupForm");
  const loginStatus = $("loginStatus");
  const signupStatus = $("signupStatus");
  const tabLogin = $("tabLogin");
  const tabSignup = $("tabSignup");

  const ui = {
    page: requestedPage || localStorage.getItem("filimonova.ui.page") || "home",
    tabs: {},
    search: {},
    collapsed: new Set(),
    currentGroupKeys: [],
    spec: {
      s1: true,
      s2: true,
      basement: true,
      above: true,
      stairs: true,
      showHomeTotal: localStorage.getItem("filimonova.spec.showHomeTotal") === "1"
    },
    estimates: { "200": true, "201": true, "202": true, "203": true, "207": true },
    avr: {
      period: localStorage.getItem("filimonova.avr.period") || "",
      registryPeriod: localStorage.getItem("filimonova.avr.registryPeriod") || "all",
      versionId: ""
    },
    s29: {
      period: localStorage.getItem("filimonova.s29.period") || ""
    },
    columnFilters: {},
    columnSort: {},
    isAdmin: false
  };

  let dataState = {
    loaded: false,
    source: "none",
    project: null,
    catalogItems: [],
    specSections: [],
    specRows: [],
    specQuantities: [],
    estimates: [],
    estimateSections: [],
    estimateRows: [],
    estimateCosts: [],
    reconciliationLinks: [],
    suppliers: [],
    supplierItems: [],
    supplierPrices: [],
    supplierPriceLinks: [],
    supplierPriceJournal: [],
    supplierSnapshotRows: []
  };

  const pages = {
    home: {
      section: "Обзор",
      title: "Главная",
      subtitle: "Сводная информация по объекту",
      tabs: ["Обзор"]
    },
    spec: {
      section: "Проект",
      title: "Спецификация",
      subtitle: "Проектная структура ЖБИ и рабочая сводка",
      tabs: ["По проекту", "Рабочая сводка"]
    },
    estimates: {
      section: "Проект",
      title: "Сметы",
      subtitle: "Локальные сметы объекта и расчёт стоимости",
      tabs: ["Смета","Текущая цена","График производства работ"]
    },
    supply: {
      section: "Исполнение",
      title: "Поставка",
      subtitle: "Поступления, остатки на объекте и цены поставщика",
      tabs: ["Сводка поставки","Накладные","Прайс поставщика"]
    },
    montage: {
      section: "Исполнение",
      title: "Монтаж",
      subtitle: "Фактический монтаж по датам, этажам и секциям",
      tabs: ["Календарь","3D модель"]
    },
    avr: {
      section: "Исполнение",
      title: "АВР — акты выполненных работ",
      subtitle: "Импорт факта по панелям, расчёт акта и накопительный контроль 6-КС",
      tabs: ["Расчёт АВР","Реестр АВР","Журнал 6-КС"]
    },
    s29: {
      section: "Исполнение",
      title: "С-29 — списание материалов",
      subtitle: "АВР в шт. → объём в м³ → бухгалтерские остатки → экономия/перерасход",
      tabs: ["Расчёт С-29","Бухгалтерия","Связи с бухгалтерией","Экономия / перерасход"]
    },
    recon: {
      section: "Контроль",
      title: "Сверка",
      subtitle: "Контроль сопоставления проектных и сметных данных",
      tabs: ["Сметы ↔ Спецификация","Журнал"]
    },
    diffs: {
      section: "Контроль",
      title: "Расхождения",
      subtitle: "Контроль различий между проектными и сметными данными",
      tabs: ["Расхождения"]
    },
    links: {
      section: "Контроль",
      title: "Связи работ",
      subtitle: "Связи материалов и работ по строкам смет",
      tabs: ["Связи работ"]
    },
    import: {
      section: "Данные",
      title: "Импорт",
      subtitle: "Рабочая область импорта данных проекта",
      tabs: ["Импорт"]
    },
    docs: {
      section: "Система",
      title: "Документы",
      subtitle: "Документы проекта",
      tabs: ["Документы"]
    },
    settings: {
      section: "Система",
      title: "Настройки",
      subtitle: "Параметры проекта и интерфейса",
      tabs: ["Настройки"]
    }
  };

  if (!pages[ui.page]) ui.page = "home";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function norm(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  const numFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function fmt(value) {
    const n = Number(value || 0);
    return n ? numFmt.format(n) : "";
  }

  function fmt0(value) {
    const n = Number(value || 0);
    return n ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n) : "";
  }

  function money(value) {
    const n = Number(value || 0);
    return n ? moneyFmt.format(n) : "";
  }

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message || "";
    el.className = "status" + (type ? " " + type : "");
  }

  function switchAuthTab(name) {
    const login = name === "login";
    tabLogin.classList.toggle("active", login);
    tabSignup.classList.toggle("active", !login);
    loginForm.classList.toggle("hidden", !login);
    signupForm.classList.toggle("hidden", login);
    setStatus(loginStatus, "");
    setStatus(signupStatus, "");
  }

  async function fetchAllRows(table,columns,configure) {
    const pageSize=1000;
    let from=0;
    const all=[];
    while(true) {
      let query=client.from(table).select(columns);
      if(configure) query=configure(query);
      const result=await query.range(from,from+pageSize-1);
      if(result.error) throw result.error;
      const rows=result.data||[];
      all.push.apply(all,rows);
      if(rows.length<pageSize) break;
      from+=pageSize;
    }
    return all;
  }

  async function loadProjectDataFresh(project) {
    const requests = [
      fetchAllRows("catalog_items","id,mark,name,normalized_key",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("mark");}),
      fetchAllRows("specification_sections","id,building_section,zone,name,sort_order,is_stairs",function(q){return q.eq("project_id",project.id).order("sort_order");}),
      fetchAllRows("specification_rows","id,section_id,catalog_item_id,position_no,designation,project_volume_m3,sort_order",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("position_no");}),
      fetchAllRows("specification_quantities","specification_row_id,level_code,level_order,quantity",function(q){return q.eq("project_id",project.id).order("level_order").order("specification_row_id");}),
      fetchAllRows("estimates","id,number,name,status,building_section,zone,is_stairs",function(q){return q.eq("project_id",project.id).eq("status","active").order("number");}),
      fetchAllRows("estimate_sections","id,estimate_id,title,sort_order",function(q){return q.eq("project_id",project.id).order("sort_order");}),
      fetchAllRows("estimate_rows","id,estimate_id,section_id,row_type,position,basis,name,unit,quantity,sort_order,catalog_item_id,source_original",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("sort_order");}),
      fetchAllRows("estimate_row_costs","estimate_row_id,salary_unit,salary_amount,machines_unit,machines_amount,drivers_unit,drivers_amount,materials_unit,materials_amount,transport_unit,transport_amount,total_unit,total_amount",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("reconciliation_links","id,estimate_row_id,specification_row_id,link_method,origin_mode",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("reconciliation_journal","id,estimate_row_id,specification_row_id,issue_key,reasons,proposal,comment,status,snapshot,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});}),
      fetchAllRows("suppliers","id,name",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("name");}),
      fetchAllRows("supplier_items","id,supplier_id,catalog_item_id,source_mark,source_name,source_section,source_key,unit_volume_m3,link_method,link_state,source_import_row_id",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("source_mark");}),
      fetchAllRows("supplier_prices_current","id,supplier_item_id,effective_from,price_basis,unit_price_gross,unit_volume_snapshot_m3,source_import_row_id,source_imported_at",function(q){return q.eq("project_id",project.id).order("effective_from");}),
      fetchAllRows("supply_documents","id,supplier_id,document_type,receipt_date,ttn_number,status,note,created_at",function(q){return q.eq("project_id",project.id).order("receipt_date");}),
      fetchAllRows("supply_document_lines","id,document_id,sort_order,source_mark,source_name,catalog_item_id,supplier_item_id,qty_pieces,qty_m3,unit_volume_snapshot_m3,price_basis,unit_price,amount_net,vat_percent,vat_amount,amount_gross,match_state",function(q){return q.eq("project_id",project.id).order("sort_order");}),
      fetchAllRows("supply_line_allocations","id,white_line_id,green_line_id,allocated_pieces,allocated_m3",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("montage_events","id,specification_row_id,level_code,event_date,event_type,quantity,note",function(q){return q.eq("project_id",project.id).order("event_date");}),
      fetchAllRows("estimate_work_links","id,material_row_id,work_row_id,link_method",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("current_price_settings","*",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("current_price_revisions","id,estimate_id,revision_no,settings_snapshot,is_current,created_at",function(q){return q.eq("project_id",project.id).order("created_at");}),
      fetchAllRows("current_price_row_results","id,revision_id,estimate_row_id,quantity,unit_price_at_start,total_with_vat,with_tender,with_forecast,with_tender_and_forecast,contractor_total",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("gpr_plans","id,name,status,start_month,end_month,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("created_at");}),
      fetchAllRows("gpr_months","id,plan_id,month,monthly_index,execution_index,is_in_period",function(q){return q.eq("project_id",project.id).order("month");}),
      fetchAllRows("gpr_floor_assignments","id,plan_id,month_id,building_section,level_code",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("gpr_row_assignments","id,plan_id,month_id,estimate_row_id,quantity,source_mode,source_specification_row_id,source_level_code,parent_assignment_id",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("avr_documents","id,period_month,display_number,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("period_month");}),
      fetchAllRows("avr_versions","id,document_id,version_no,state,source_import_id,signed_at,created_at",function(q){return q.eq("project_id",project.id).order("created_at");}),
      fetchAllRows("avr_rows","id,version_id,estimate_row_id,quantity,quantity_m3,amount,source_import_row_id",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("accounting_rows","id,import_id,source_import_row_id,account_code,material_code,name,unit,quantity,unit_price,amount,source_row_no",function(q){return q.eq("project_id",project.id).order("source_row_no");}),
      fetchAllRows("accounting_code_links","id,accounting_code,catalog_item_id,link_method,note",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("accounting_period_sources","period_month,import_id,selected_at",function(q){return q.eq("project_id",project.id).order("period_month");}),
      fetchAllRows("s29_documents","id,period_month,avr_version_id,accounting_import_id,status,fixed_at,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("period_month");}),
      fetchAllRows("s29_rows","id,document_id,catalog_item_id,avr_quantity_pieces,volume_per_piece_snapshot_m3,avr_quantity_m3,written_off_m3,economy_m3,overrun_m3,note",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("s29_allocations","id,s29_row_id,accounting_row_id,allocated_m3",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("s29_carryovers","id,origin_document_id,origin_row_id,catalog_item_id,kind,origin_month,created_m3,created_at",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("s29_carryover_settlements","id,carryover_id,settlement_document_id,settlement_month,settled_m3,created_at",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("imports","id,domain,source_name,source_period,status,report,imported_at,source_slot,applied_at",function(q){return q.eq("project_id",project.id).in("domain",["avr","accounting","supplier_price"]).order("imported_at",{ascending:false});}),
      fetchAllRows("supplier_price_links","id,supplier_id,catalog_item_id,supplier_item_id,link_method,validation_state,last_checked_import_id,created_at,updated_at",function(q){return q.eq("project_id",project.id);}),
      fetchAllRows("supplier_price_journal","id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method,actor_id,created_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});}),
      fetchAllRows("supplier_price_snapshot_rows","import_id,source_name,imported_at,version_no,supplier_id,import_row_id,source_row_no,source_key,raw_data,normalized_data,supplier_item_id,catalog_item_id,link_method,validation_state",function(q){return q.eq("project_id",project.id).order("imported_at",{ascending:false}).order("source_row_no");})
    ];
    const results = await Promise.all(requests);
    dataState = {
      loaded:true,
      source:"supabase",
      project:project,
      catalogItems:results[0] || [],
      specSections:results[1] || [],
      specRows:results[2] || [],
      specQuantities:results[3] || [],
      estimates:results[4] || [],
      estimateSections:results[5] || [],
      estimateRows:results[6] || [],
      estimateCosts:results[7] || [],
      reconciliationLinks:results[8] || [],
      reconciliationJournal:results[9] || [],
      suppliers:results[10] || [],
      supplierItems:results[11] || [],
      supplierPrices:results[12] || [],
      supplyDocuments:results[13] || [],
      supplyDocumentLines:results[14] || [],
      supplyLineAllocations:results[15] || [],
      montageEvents:results[16] || [],
      estimateWorkLinks:results[17] || [],
      currentPriceSettings:results[18] || [],
      currentPriceRevisions:results[19] || [],
      currentPriceRowResults:results[20] || [],
      gprPlans:results[21] || [],
      gprMonths:results[22] || [],
      gprFloorAssignments:results[23] || [],
      gprRowAssignments:results[24] || [],
      avrDocuments:results[25] || [],
      avrVersions:results[26] || [],
      avrRows:results[27] || [],
      accountingRows:results[28] || [],
      accountingCodeLinks:results[29] || [],
      accountingPeriodSources:results[30] || [],
      s29Documents:results[31] || [],
      s29Rows:results[32] || [],
      s29Allocations:results[33] || [],
      s29Carryovers:results[34] || [],
      s29CarryoverSettlements:results[35] || [],
      imports:results[36] || [],
      supplierPriceLinks:results[37] || [],
      supplierPriceJournal:results[38] || [],
      supplierSnapshotRows:results[39] || []
    };
  }

  // Prevent duplicate full-project reloads. Supabase can emit INITIAL_SESSION while
  // getSession() resolves, and overlapping reloads previously launched 80–120 REST
  // requests at once, causing PostgREST timeout-manager kills and a visibly unstable UI.
  let projectDataLoadPromise=null;
  let projectDataLoadProjectId="";
  async function loadProjectData(project) {
    if(!project || !project.id) return loadProjectDataFresh(project);
    if(projectDataLoadPromise && projectDataLoadProjectId===project.id) {
      return projectDataLoadPromise;
    }
    projectDataLoadProjectId=project.id;
    const promise=loadProjectDataFresh(project);
    projectDataLoadPromise=promise;
    try{
      return await promise;
    }finally{
      if(projectDataLoadPromise===promise){
        projectDataLoadPromise=null;
        projectDataLoadProjectId="";
      }
    }
  }


  function maps() {
    return {
      catalog:new Map(dataState.catalogItems.map(function(x){ return [x.id,x]; })),
      sections:new Map(dataState.specSections.map(function(x){ return [x.id,x]; })),
      estimates:new Map(dataState.estimates.map(function(x){ return [x.id,x]; })),
      estimateSections:new Map(dataState.estimateSections.map(function(x){ return [x.id,x]; })),
      costs:new Map(dataState.estimateCosts.map(function(x){ return [x.estimate_row_id,x]; }))
    };
  }

  function quantityMap() {
    const map = new Map();
    dataState.specQuantities.forEach(function(q) {
      if (!map.has(q.specification_row_id)) map.set(q.specification_row_id, new Map());
      map.get(q.specification_row_id).set(q.level_code, Number(q.quantity || 0));
    });
    return map;
  }

  function specJoinedRows() {
    const m = maps();
    const qm = quantityMap();
    return dataState.specRows.map(function(r) {
      const item = m.catalog.get(r.catalog_item_id) || {mark:"",name:""};
      const section = m.sections.get(r.section_id) || {building_section:"",zone:"",name:"",sort_order:0,is_stairs:false};
      const quantities = qm.get(r.id) || new Map();
      let total = 0;
      quantities.forEach(function(v){ total += Number(v || 0); });
      return Object.assign({}, r, {
        mark:item.mark || "",
        name:item.name || "",
        section:section,
        quantities:quantities,
        total:total,
        volumePerPiece:Number(r.project_volume_m3 || 0)
      });
    });
  }

  function passesSpecFilters(row) {
    const s = row.section;
    if (s.is_stairs) return ui.spec.stairs;
    if (s.building_section === "Секция 1" && !ui.spec.s1) return false;
    if (s.building_section === "Секция 2" && !ui.spec.s2) return false;
    if (s.zone === "Цоколь" && !ui.spec.basement) return false;
    if (s.zone === "Выше 0.000" && !ui.spec.above) return false;
    return true;
  }

  function currentViewKey() {
    return ui.page + ":" + (ui.tabs[ui.page] || 0);
  }

  function currentSearch() {
    return ui.search[currentViewKey()] || "";
  }

  function passesSearch(parts) {
    const q = norm(currentSearch());
    if (!q) return true;
    return norm(parts.join(" ")).includes(q);
  }

  function levelLabel(code) {
    return code === "К" ? "Кровля" : code;
  }

  function summaryLevelLabel(code) {
    if (code === "Ц") return "Цоколь";
    if (code === "Ч") return "Чердак";
    if (code === "К") return "Крыша";
    if (/^\d+$/.test(String(code))) return String(code) + " этаж";
    return String(code);
  }

  function filterBucket() {
    const key = currentViewKey();
    if (!ui.columnFilters) ui.columnFilters = {};
    if (!ui.columnFilters[key]) ui.columnFilters[key] = {};
    return ui.columnFilters[key];
  }

  function sortBucket() {
    const key = currentViewKey();
    if (!ui.columnSort) ui.columnSort = {};
    return ui.columnSort[key] || null;
  }

  function columnFilterPass(field,value) {
    const set = filterBucket()[field];
    if (!set || !set.size) return true;
    return set.has(String(value == null ? "" : value));
  }

  function rowPassesColumnFilters(values) {
    const filters = filterBucket();
    return Object.keys(filters).every(function(field) {
      const set = filters[field];
      if (!set || !set.size) return true;
      return set.has(String(values[field] == null ? "" : values[field]));
    });
  }

  function sortRows(records,getters) {
    const sort = sortBucket();
    if (!sort || !getters || !getters[sort.field]) return records;
    return records.slice().sort(function(a,b) {
      const av = getters[sort.field](a), bv = getters[sort.field](b);
      const an = Number(av), bn = Number(bv);
      let cmp;
      if (Number.isFinite(an) && Number.isFinite(bn) && String(av).trim() !== "" && String(bv).trim() !== "") cmp = an-bn;
      else cmp = String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv),"ru",{numeric:true,sensitivity:"base"});
      return sort.dir === "desc" ? -cmp : cmp;
    });
  }

  function filterHeader(label,field) {
    const active = !!filterBucket()[field];
    const icon = '<svg class="filter-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.25h11L9.25 8.2v3.55l-2.5 1.25V8.2L2.5 3.25z" fill="currentColor"/></svg>';
    return '<span class="header-label">' + esc(label) + '</span><button class="column-filter-trigger' + (active ? ' active' : '') + '" type="button" data-column-filter="' + esc(field) + '" aria-label="Фильтр ' + esc(label) + '">' + icon + '</button>';
  }

  function filterCell(field,value,content,extraClass) {
    const raw=value == null ? "" : String(value);
    const title=(field==="name" || field==="basis") && raw ? ' title="' + esc(raw) + '"' : "";
    return '<td class="' + esc(extraClass || "") + '" data-filter-field="' + esc(field) + '" data-filter-value="' + esc(raw) + '"' + title + '>' + content + '</td>';
  }

  // Long estimate names stay compact by default. Double-clicking the name cell
  // expands only that cell and does not trigger the material-card row action.
  document.addEventListener("dblclick",function(e){
    const cell=e.target && e.target.closest ? e.target.closest('td[data-filter-field="name"]') : null;
    if(!cell || !cell.closest(".est-table,.ks-table")) return;
    e.preventDefault();
    e.stopPropagation();
    cell.classList.toggle("cell-text-expanded");
  },true);

  function ensureFilterPopup() {
    let pop = document.getElementById("columnFilterPopup");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "columnFilterPopup";
    pop.className = "column-filter-popup";
    document.body.appendChild(pop);
    return pop;
  }

  function openColumnFilter(trigger) {
    const field = trigger.dataset.columnFilter;
    const pop = ensureFilterPopup();
    const cells = Array.from(document.querySelectorAll('#workArea [data-filter-field="' + CSS.escape(field) + '"]'));
    let values = Array.from(new Set(cells.map(function(c){ return c.dataset.filterValue || ""; })));
    values.sort(function(a,b){ return a.localeCompare(b,"ru",{numeric:true,sensitivity:"base"}); });
    const existing = filterBucket()[field];
    let chosen = new Set(existing ? Array.from(existing) : values);
    const currentSort = sortBucket();

    function valueRows(query) {
      const q = norm(query || "");
      const shown = values.filter(function(v){ return !q || norm(v).includes(q); });
      const allChecked = shown.length > 0 && shown.every(function(v){return chosen.has(v);});
      const someChecked = shown.some(function(v){return chosen.has(v);});
      return '<label class="filter-value filter-all"><input type="checkbox" data-filter-all ' + (allChecked ? 'checked' : '') + '><span>(Выбрать все)</span></label>' +
        shown.map(function(v){
          return '<label class="filter-value"><input type="checkbox" data-filter-value-choice="' + esc(v) + '" ' + (chosen.has(v)?'checked':'') + '><span>' + esc(v || "(Пусто)") + '</span></label>';
        }).join("");
    }

    pop.innerHTML =
      '<button class="filter-command" type="button" data-sort-dir="asc">Сортировать по возрастанию' + (currentSort && currentSort.field===field && currentSort.dir==="asc" ? ' ✓' : '') + '</button>' +
      '<button class="filter-command" type="button" data-sort-dir="desc">Сортировать по убыванию' + (currentSort && currentSort.field===field && currentSort.dir==="desc" ? ' ✓' : '') + '</button>' +
      '<button class="filter-command" type="button" data-sort-clear>Очистить сортировку</button>' +
      '<div class="filter-sep"></div><div class="filter-title">Фильтр текущей колонки</div>' +
      '<input class="filter-search" type="text" placeholder="Поиск по значениям" autocomplete="off">' +
      '<div class="filter-values">' + valueRows("") + '</div>' +
      '<div class="filter-footer"><button class="filter-clear" type="button">Очистить фильтр</button><span class="spacer"></span><button class="filter-btn" type="button" data-filter-cancel>Отмена</button><button class="filter-btn primary-small" type="button" data-filter-ok>ОК</button></div>';

    const rect = trigger.getBoundingClientRect();
    pop.style.left = Math.max(8,Math.min(window.innerWidth-294,rect.right-286)) + "px";
    pop.style.top = Math.min(window.innerHeight-390,rect.bottom+4) + "px";
    pop.classList.add("open");

    const search = pop.querySelector(".filter-search");
    const list = pop.querySelector(".filter-values");
    function bindValues() {
      const all = list.querySelector("[data-filter-all]");
      if (all) {
        const shown = Array.from(list.querySelectorAll("[data-filter-value-choice]"));
        all.indeterminate = shown.some(function(x){return x.checked;}) && !shown.every(function(x){return x.checked;});
        all.onchange = function(){
          shown.forEach(function(x){
            x.checked = all.checked;
            const v=x.dataset.filterValueChoice;
            if(x.checked) chosen.add(v); else chosen.delete(v);
          });
        };
      }
      list.querySelectorAll("[data-filter-value-choice]").forEach(function(x){
        x.onchange=function(){
          const v=x.dataset.filterValueChoice;
          if(x.checked) chosen.add(v); else chosen.delete(v);
          bindValues();
        };
      });
    }
    bindValues();
    search.oninput=function(){ list.innerHTML=valueRows(search.value); bindValues(); };
    pop.querySelectorAll("[data-sort-dir]").forEach(function(b){
      b.onclick=function(){
        if(!ui.columnSort) ui.columnSort={};
        ui.columnSort[currentViewKey()]={field:field,dir:b.dataset.sortDir};
        pop.classList.remove("open");
        rerenderContent();
      };
    });
    pop.querySelector("[data-sort-clear]").onclick=function(){
      if(ui.columnSort) delete ui.columnSort[currentViewKey()];
      pop.classList.remove("open");
      rerenderContent();
    };
    pop.querySelector("[data-filter-cancel]").onclick=function(){pop.classList.remove("open");};
    pop.querySelector(".filter-clear").onclick=function(){
      delete filterBucket()[field];
      pop.classList.remove("open");
      rerenderContent();
    };
    pop.querySelector("[data-filter-ok]").onclick=function(){
      const shownValues = values;
      if (chosen.size === shownValues.length && shownValues.every(function(v){return chosen.has(v);})) delete filterBucket()[field];
      else filterBucket()[field]=new Set(Array.from(chosen));
      pop.classList.remove("open");
      rerenderContent();
    };
    setTimeout(function(){search.focus();},0);
  }

  function logicalHeaderGrid(table) {
    const grid=[];
    Array.from(table.tHead ? table.tHead.rows : []).forEach(function(row,r){
      if(!grid[r]) grid[r]=[];
      let c=0;
      Array.from(row.cells).forEach(function(cell){
        while(grid[r][c]) c++;
        const rs=cell.rowSpan||1, cs=cell.colSpan||1;
        cell.dataset.logicalStart=String(c);
        cell.dataset.logicalSpan=String(cs);
        for(let rr=r;rr<r+rs;rr++){
          if(!grid[rr]) grid[rr]=[];
          for(let cc=0;cc<cs;cc++) grid[rr][c+cc]=cell;
        }
        c+=cs;
      });
    });
    return grid;
  }

  function measureEngineeringText(text,extra) {
    const canvas=intrinsicColumnWidth.canvas||(intrinsicColumnWidth.canvas=document.createElement("canvas"));
    const ctx=canvas.getContext("2d");
    ctx.font='12px "Segoe UI Variable","Segoe UI",Arial,sans-serif';
    return Math.ceil(ctx.measureText(String(text==null?"":text)).width)+18+Number(extra||0);
  }

  function estimateIntrinsicColumnWidth(table,index) {
    if(!table.classList.contains("est-table")) return null;
    const rows=(dataState.estimateRows||[]).filter(function(r){return !r.archived_at;});
    if(index===0){
      return Math.max(measureEngineeringText("Тип"),measureEngineeringText("М"),measureEngineeringText("Р"));
    }
    if(index===1){
      let max=0;
      rows.forEach(function(r){max=Math.max(max,measureEngineeringText(r.position||""));});
      if(table.classList.contains("gpr-table")) max+=28;
      return max;
    }
    if(index===2){
      let max=0;
      rows.forEach(function(r){max=Math.max(max,measureEngineeringText(estimateDisplayBasis(r)||""));});
      return max;
    }
    if(index===3){
      // Work names never participate in the material-name column width.
      let max=0;
      rows.filter(function(r){return r.row_type==="material";}).forEach(function(r){
        max=Math.max(max,measureEngineeringText(estimateDisplayName(r)||""));
      });
      return max;
    }
    if(index===4){
      // Units of work rows and the two-line header do not affect the width.
      let max=0;
      rows.filter(function(r){return r.row_type==="material";}).forEach(function(r){
        max=Math.max(max,measureEngineeringText(r.unit||""));
      });
      return max;
    }
    return null;
  }

  function intrinsicColumnWidth(table,index) {
    if (table.classList.contains("working-summary")) {
      if (index === 3 || index === 5) return 58;
      if (index === 4 || index === 6) return 64;
      // Floor subcolumns contain only quantities. Keep them compact and stable:
      // size from the complete project dataset, not from the currently visible grouping.
      if (index >= 7) {
        const levels=levelCodes();
        const floorEnd=7+levels.length*2;
        if(index < floorEnd){
          const rel=index-7, section=rel%2===0?"Секция 1":"Секция 2";
          const code=levels[Math.floor(rel/2)];
          let maxText="0";
          buildWorkingSummaryRows().forEach(function(r){
            const v=Number((r.byLevel[section]&&r.byLevel[section].get(code))||0);
            const txt=fmt0(v);
            if(txt.length>maxText.length) maxText=txt;
          });
          const canvas=intrinsicColumnWidth.canvas||(intrinsicColumnWidth.canvas=document.createElement("canvas"));
          const ctx=canvas.getContext("2d");
          ctx.font="12px Segoe UI";
          return Math.max(28,Math.ceil(ctx.measureText(maxText).width)+12);
        }
        return 42;
      }
    }
    const estimateWidth=estimateIntrinsicColumnWidth(table,index);
    if(estimateWidth!=null) return estimateWidth;
    let max=40;
    const cells=[];
    if(table.tHead) Array.from(table.tHead.rows).forEach(function(row){
      Array.from(row.cells).forEach(function(cell){
        if(Number(cell.dataset.logicalStart)===index && Number(cell.dataset.logicalSpan||1)===1) cells.push(cell);
      });
    });
    Array.from(table.tBodies).forEach(function(body){
      Array.from(body.rows).forEach(function(row){
        let c=0;
        Array.from(row.cells).forEach(function(cell){
          const span=cell.colSpan||1;
          if(span===1 && c===index) cells.push(cell);
          c+=span;
        });
      });
    });
    cells.forEach(function(cell){
      const txt=(cell.textContent||"").trim();
      const canvas=intrinsicColumnWidth.canvas||(intrinsicColumnWidth.canvas=document.createElement("canvas"));
      const ctx=canvas.getContext("2d");
      const cs=getComputedStyle(cell);
      ctx.font=cs.font||"12px Segoe UI";
      let w=Math.ceil(ctx.measureText(txt).width)+18;
      if(cell.querySelector(".column-filter-trigger")) w+=28;
      max=Math.max(max,w);
    });
    if(index===0) max=Math.max(40,Math.min(max,68));
    // Estimate names must never make the whole grid excessively wide.
    // Full text remains available through the cell title tooltip.
    if((table.classList.contains("est-table") || table.classList.contains("ks-table")) && index===3) {
      return Math.max(220,Math.min(max,480));
    }
    if((table.classList.contains("est-table") || table.classList.contains("ks-table")) && index===2) {
      return Math.max(120,Math.min(max,280));
    }
    return Math.max(28,Math.min(max,340));
  }

  function saveTableWidths(table,widths) {
    const key="filimonova.tablewidths."+currentViewKey()+"."+(table.dataset.tableKey||table.className.replace(/\s+/g,"."));
    localStorage.setItem(key,JSON.stringify(widths));
  }

  function loadTableWidths(table) {
    const key="filimonova.tablewidths."+currentViewKey()+"."+(table.dataset.tableKey||table.className.replace(/\s+/g,"."));
    try{return JSON.parse(localStorage.getItem(key)||"null");}catch(_){return null;}
  }

  function updateStickyHeaderOffsets(table) {
    if (!table || !table.tHead) return;
    let top = 0;
    Array.from(table.tHead.rows).forEach(function(row) {
      Array.from(row.cells).forEach(function(cell) {
        cell.style.top = Math.round(top) + "px";
      });
      const h = row.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) top += h;
    });
  }

  function updateStickyOffsets(table,widths) {
    /* Sticky offsets must be based only on the rendered sticky identity columns.
       Colgroup widths are not reliable here because grouped headers can make the
       browser redistribute column width. */
    const sets = [
      ["sticky-1","sticky-2","sticky-3"],
      ["e-sticky-1","e-sticky-2","e-sticky-3","e-sticky-4"]
    ];

    sets.forEach(function(classes) {
      let left = 0;
      classes.forEach(function(cls) {
        const cells = Array.from(table.querySelectorAll("." + cls));
        if (!cells.length) return;
        cells.forEach(function(cell){ cell.style.left = Math.round(left) + "px"; });
        const head = table.querySelector("thead ." + cls) || cells[0];
        const width = head.getBoundingClientRect().width;
        if (Number.isFinite(width) && width > 0) left += width;
      });
    });

    table.querySelectorAll(".gpr-sticky").forEach(function(cell){cell.style.left="0px";});
  }

  function tableColumnMinimum(table,index) {
    // One width policy for every estimate-derived grid (estimate, KS and GPR).
    if(table.classList.contains("est-table")) {
      if(index===0) return 32;   // type: actual width is content-driven and locked
      if(index===1) return 48;   // estimate position: content-driven and locked
      if(index===2) return 96;   // basis
      if(index===3) return 140;  // material name
      if(index===4) return 56;   // material unit
      return 82;
    }
    if(table.classList.contains("ks-table")) {
      if(index===0) return 42;
      if(index===1) return 72;
      if(index===2) return 190;
      if(index===3) return 420;
      if(index===4) return 92;
      return 90;
    }
    return 28;
  }

  function forceLogicalColumnWidth(table,index,width) {
    // Width ownership belongs exclusively to the generated COLGROUP.
    // Never force widths on TH/TD: doing so conflicts with rowspan/colspan headers
    // and breaks the scroll geometry of multi-level engineering tables.
    return;
  }

  function lockTableToColumnSum(table,widths) {
    if(!table) return;
    const total=Math.max(1,widths.reduce(function(sum,w){return sum+(Number(w)||0);},0));
    // COLGROUP + this exact pixel width are the single source of truth.
    // Use !important because legacy .est-table{width:max-content!important}
    // previously overrode the runtime width and let long work text expand columns.
    table.style.setProperty("width",total+"px","important");
    table.style.setProperty("min-width",total+"px","important");
    table.style.setProperty("max-width","none","important");
  }

  function tableColumnLocked(table,index) {
    return table.classList.contains("est-table") && (index===0 || index===1);
  }

  function tableColumnResizeMinimum(table,index) {
    if(table.classList.contains("est-table") && index>=2 && index<=4) {
      return Math.max(tableColumnMinimum(table,index),intrinsicColumnWidth(table,index));
    }
    return tableColumnMinimum(table,index);
  }

  function installResizeAutofit(table) {
    if(!table || !table.tHead) return;
    const grid=logicalHeaderGrid(table);
    const count=Math.max.apply(null,grid.map(function(r){return r.length;}));
    let cg=table.querySelector("colgroup[data-generated]");
    if(!cg){
      cg=document.createElement("colgroup");cg.dataset.generated="1";
      for(let i=0;i<count;i++) cg.appendChild(document.createElement("col"));
      table.insertBefore(cg,table.firstChild);
    }
    let widths=loadTableWidths(table);
    if(!Array.isArray(widths)||widths.length!==count) {
      widths=Array.from({length:count},function(_,i){
        return Math.max(tableColumnMinimum(table,i),intrinsicColumnWidth(table,i));
      });
      saveTableWidths(table,widths);
    } else {
      // Saved widths are the user's choice. Never expand them because cell text is long.
      widths=widths.map(function(w,i){
        const n=Number(w);
        const min=tableColumnResizeMinimum(table,i);
        if(tableColumnLocked(table,i)) return Math.max(min,intrinsicColumnWidth(table,i));
        return Number.isFinite(n) && n>=min ? n : min;
      });
    }
    if(table.classList.contains("est-table")) {
      const policyKey="filimonova.tablewidths."+currentViewKey()+"."+(table.dataset.tableKey||table.className.replace(/\s+/g,"."))+".identity-policy";
      if(localStorage.getItem(policyKey)!=="3") {
        [1,2,3,4].forEach(function(i){if(i<count) widths[i]=Math.max(tableColumnMinimum(table,i),intrinsicColumnWidth(table,i));});
        localStorage.setItem(policyKey,"3");
        saveTableWidths(table,widths);
      }
    }
    Array.from(cg.children).forEach(function(col,i){
      col.style.width=widths[i]+"px";
      col.style.minWidth=widths[i]+"px";
      col.style.maxWidth=widths[i]+"px";
    });
    widths.forEach(function(w,i){forceLogicalColumnWidth(table,i,w);});
    lockTableToColumnSum(table,widths);
    updateStickyOffsets(table,widths);
    updateStickyHeaderOffsets(table);

    table.querySelectorAll("thead th").forEach(function(th){
      if(Number(th.dataset.logicalSpan||th.colSpan||1)!==1) return;
      if(th.querySelector(".resize-handle")) return;
      const index=Number(th.dataset.logicalStart);
      if(tableColumnLocked(table,index)) return;
      const h=document.createElement("span");h.className="resize-handle";th.appendChild(h);
      h.addEventListener("mousedown",function(e){
        e.preventDefault();e.stopPropagation();
        const startX=e.clientX,start=widths[index];
        function move(ev){
          widths[index]=Math.max(tableColumnResizeMinimum(table,index),Math.min(720,start+ev.clientX-startX));
          cg.children[index].style.width=widths[index]+"px";
          cg.children[index].style.minWidth=widths[index]+"px";
          cg.children[index].style.maxWidth=widths[index]+"px";
          forceLogicalColumnWidth(table,index,widths[index]);
          lockTableToColumnSum(table,widths);
          updateStickyOffsets(table,widths);
          updateStickyHeaderOffsets(table);
        }
        function up(){document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);saveTableWidths(table,widths);}
        document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
      });
      h.addEventListener("dblclick",function(e){
        e.preventDefault();e.stopPropagation();
        widths[index]=Math.max(tableColumnResizeMinimum(table,index),intrinsicColumnWidth(table,index));
        cg.children[index].style.width=widths[index]+"px";
        cg.children[index].style.minWidth=widths[index]+"px";
        cg.children[index].style.maxWidth=widths[index]+"px";
        forceLogicalColumnWidth(table,index,widths[index]);
        lockTableToColumnSum(table,widths);
        updateStickyOffsets(table,widths);
        updateStickyHeaderOffsets(table);
        saveTableWidths(table,widths);
      });
    });
  }

  function installTableTools() {
    document.querySelectorAll("#workArea table").forEach(function(table){installResizeAutofit(table);});
    document.querySelectorAll("#workArea .column-filter-trigger").forEach(function(btn){
      btn.onclick=function(e){e.preventDefault();e.stopPropagation();openColumnFilter(btn);};
    });
    document.querySelectorAll('#workArea .data-row[data-material-id],#workArea .data-row[data-material-mark]').forEach(function(row){
      row.ondblclick=function(e){e.preventDefault();openMaterialCard(row.dataset.materialId||"",row.dataset.materialMark||"");};
    });
  }

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

  function openMaterialCard(id,mark) {
    let item=dataState.catalogItems.find(function(x){return x.id===id;});
    if(!item && mark) item=dataState.catalogItems.find(function(x){return x.mark===mark;});
    const sourceOnly=!item;
    if(!item) item={id:"",mark:mark||"Материал",name:"Исходная строка без связи"};
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
    const volumePerPiece=st.rows.length?Number(st.rows[0].volumePerPiece||0):0;
    const suppliedLines=(dataState.supplyDocumentLines||[]).filter(function(x){return item.id && x.catalog_item_id===item.id;});
    const suppliedQty=suppliedLines.reduce(function(a,x){return a+Number(x.qty_pieces||0);},0);
    const suppliedM3=suppliedLines.reduce(function(a,x){return a+Number(x.qty_m3||0);},0);
    const mountedEvents=(dataState.montageEvents||[]).filter(function(x){
      return st.rows.some(function(sr){return sr.id===x.specification_row_id;}) && x.event_type==="mounted";
    });
    const mountedQty=mountedEvents.reduce(function(a,x){return a+Number(x.quantity||0);},0);
    const avrRows=(dataState.avrRows||[]).filter(function(x){return linkedEstimateRows.some(function(r){return r.id===x.estimate_row_id;});});
    const avrQty=avrRows.reduce(function(a,x){return a+Number(x.quantity||0);},0);
    const avrM3=avrRows.reduce(function(a,x){return a+Number(x.quantity_m3||0);},0);
    const avrAmount=avrRows.reduce(function(a,x){return a+Number(x.amount||0);},0);
    const s29Rows=(dataState.s29Rows||[]).filter(function(x){return item.id && x.catalog_item_id===item.id;});
    const writtenM3=s29Rows.reduce(function(a,x){return a+Number(x.written_off_m3||0);},0);
    const estimateAmount=linkedEstimateRows.reduce(function(sum,r){
      const c=(dataState.estimateCosts||[]).find(function(x){return x.estimate_row_id===r.id;});
      return sum+Number(c&&c.total_amount||0);
    },0);
    const estimateQty=linkedEstimateRows.reduce(function(sum,r){return sum+Number(r.quantity||0);},0);
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
    const supplierUnit=supplierModel && supplierModel.prices.length===1 &&
      supplierModel.prices[0].price_basis==="piece" && supplierModel.state!=="Проверить"
      ?Number(supplierModel.prices[0].unit_price_gross):null;
    function unitMoney(value){return value!=null && Number.isFinite(value) && value>0?money(value)+" BYN":"—";}
    const sectionLabel=st.rows.length&&st.rows[0].section?st.rows[0].section.name:"Раздел";
    const allNames=Array.from(new Set(dataState.catalogItems.map(function(x){return x.name;}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,"ru",{numeric:true});});
    let modal=document.getElementById("materialCardModal");
    if(!modal){modal=document.createElement("div");modal.id="materialCardModal";modal.className="material-modal-backdrop";document.body.appendChild(modal);}
    modal.innerHTML='<div class="material-card material-v11" role="dialog" aria-modal="true">'+
      '<header class="material-card-head"><button class="material-close" title="Закрыть">×</button><div class="material-section-label">'+esc(sectionLabel)+'</div><div class="material-identity"><strong>'+esc(item.mark)+'</strong><span>'+esc(item.name)+'</span></div></header>'+
      '<nav class="material-tabs"><button class="active" data-mtab="overview">Обзор</button><button data-mtab="projectEstimate">Проект и смета</button><button data-mtab="supplyMontage">Поставка и монтаж</button><button data-mtab="avrS29">АВР и С-29</button><button data-mtab="history">История</button></nav>'+
      '<div class="material-body"></div></div>';
    modal.classList.add("open");
    function kpi(label,value,sub,cls){return '<div class="mv-kpi '+(cls||"")+'"><div class="mv-kpi-label">'+esc(label)+'</div><div class="mv-kpi-value">'+value+'</div>'+(sub?'<div class="mv-kpi-sub">'+sub+'</div>':'')+'</div>';}
    function block(title,html,extra){return '<section class="mv-block '+(extra||"")+'"><div class="mv-block-title">'+title+'</div>'+html+'</section>';}
    function body(tab){
      const b=modal.querySelector(".material-body");
      const fmt0=value=>numFmt.format(Number(value)||0);
      const fmt=value=>numFmt.format(Number(value)||0);
      if(tab==="overview"){
        const exec=block("Исполнение",'<div class="mv-overview-exec">'+
          kpi("Поставлено",fmt0(suppliedQty)+' шт. / '+fmt(suppliedM3)+' м³',st.qty?fmt(suppliedQty/st.qty*100)+'% от проектного количества':"")+
          kpi("Смонтировано",fmt0(mountedQty)+' шт. / '+fmt(mountedQty*volumePerPiece)+' м³',st.qty?fmt(mountedQty/st.qty*100)+'% от проекта':"")+
          kpi("Запроцентовано",fmt0(avrQty)+' шт. / '+fmt(avrM3)+' м³',"по АВР","good")+
          kpi("Списано",fmt(writtenM3)+' м³',avrM3?((writtenM3<avrM3?"меньше АВР на ":"разница с АВР ")+fmt(Math.abs(avrM3-writtenM3))+" м³"):"","warn")+
        '</div>');
        const qty=block("Количество и объём",'<div class="mv-overview-qty">'+
          '<div class="mv-qty"><b>Всего по проекту</b><strong>'+fmt0(st.qty)+' шт.</strong><span>'+fmt(st.m3)+' м³</span></div>'+
          '<div class="mv-qty"><b>Объём 1 шт.</b><strong>'+(volumePerPiece?fmt(volumePerPiece):"—")+' м³</strong><span>рабочий объём списания</span></div>'+
          '<div class="mv-qty"><b>Осталось поставить</b><strong>'+fmt0(Math.max(0,st.qty-suppliedQty))+' шт.</strong><span>'+fmt(Math.max(0,st.qty-suppliedQty)*volumePerPiece)+' м³</span></div>'+
          '<div class="mv-qty"><b>Осталось смонтировать</b><strong>'+fmt0(Math.max(0,st.qty-mountedQty))+' шт.</strong><span>'+fmt(Math.max(0,st.qty-mountedQty)*volumePerPiece)+' м³</span></div></div>');
        const cost=block("Стоимость",'<div class="mv-cost-grid"><div class="mv-cost"><b>По смете</b><strong>'+(estimateAmount?money(estimateAmount)+" BYN":"—")+'</strong><span>связанные позиции материала</span></div><div class="mv-cost"><b>Запроцентовано</b><strong>'+(avrAmount?money(avrAmount)+" BYN":"—")+'</strong><span>по действующим АВР</span></div><div class="mv-cost"><b>Остаток</b><strong>'+(estimateAmount?money(Math.max(0,estimateAmount-avrAmount))+" BYN":"—")+'</strong><span>по сметной стоимости</span></div></div>','mv-mt');
        const unitCost=block('Стоимость единицы <span class="mv-badge">с НДС</span>',
          '<div class="mv-unit-grid">'+
          '<div class="mv-unit"><b>Материал по смете, 1 шт.</b><strong>'+unitMoney(materialUnit)+'</strong><span>сметная стоимость материала</span></div>'+
          '<div class="mv-unit"><b>Транспорт по смете, 1 шт.</b><strong>'+unitMoney(transportUnit)+'</strong><span>отдельная сметная составляющая</span></div>'+
          '<div class="mv-unit"><b>Цена поставщика, 1 шт.</b><strong>'+unitMoney(supplierUnit)+'</strong><span>действующий прайс поставщика</span></div>'+
          '<div class="mv-unit"><b>Монтаж, 1 шт.</b><strong>—</strong><span>стоимость единицы не рассчитана</span></div>'+
          '</div>','mv-mt');
        b.innerHTML='<div class="mv-overview-two">'+exec+qty+'</div>'+cost+unitCost+(sourceOnly?'<div class="mv-note">Исходная строка не связана с проектной номенклатурой. Карточка открыта в source-only режиме.</div>':'');
      } else if(tab==="projectEstimate"){
        const project='<div class="mv-grid2 mv-mb">'+block("Проект",'<div class="mv-kpi2">'+kpi("Всего",fmt0(st.qty)+" шт.",fmt(st.m3)+" м³")+kpi("Объём 1 шт.",volumePerPiece?fmt(volumePerPiece)+" м³":"—","для учёта и списания")+'</div>')+
          block("Смета",'<div class="mv-kpi2">'+kpi("Количество по смете",estimateQty?fmt(estimateQty)+" шт.":"—","связанные позиции")+kpi("Контроль",estimateQty&&Math.abs(estimateQty-st.qty)<1e-9?"Совпадает":(linkedEstimateRows.length?"Проверить":"Нет связи"),linkedEstimateRows.length?"проект ↔ смета":"связь не создана",estimateQty&&Math.abs(estimateQty-st.qty)<1e-9?"good":"warn")+'</div>')+'</div>';
        const floors='<div class="mv-floor-wrap"><div class="mv-floor-grid"><div class="head">Секция</div>'+levels.map(function(x){return '<div class="head">'+esc(x)+'</div>';}).join("")+'<div class="head">Всего</div>'+
          ["Секция 1","Секция 2"].map(function(bs){
            return '<div class="rowhead">'+bs+'</div>'+levels.map(function(code){
              let v=0;st.rows.filter(function(r){return r.section&&r.section.building_section===bs;}).forEach(function(r){v+=Number(r.quantities.get(code)||0);});
              return '<div class="'+(v?"val":"zero")+'">'+(v?fmt0(v):"—")+'</div>';
            }).join("")+'<div class="total">'+fmt0(st.rows.filter(function(r){return r.section&&r.section.building_section===bs;}).reduce(function(s,r){return s+Number(r.total||0);},0))+'</div>';
          }).join("")+'</div></div>';
        const estBody=linkedEstimateRows.map(function(r){
          const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
          const linked=linkedSpecRowsForEstimateRow(r);const q=estimateQuantityPieces(r,linked);
          return '<tr><td class="center">№'+esc(e?e.number:"")+'</td><td class="center">'+esc(r.position)+'</td><td>'+esc(estimateDisplayBasis(r))+'</td><td>'+esc(estimateDisplayName(r))+'</td><td class="center">'+esc(r.unit||"")+'</td><td class="num">'+(q==null?"—":fmt(q))+'</td><td class="num">'+fmt(avrRows.filter(function(a){return a.estimate_row_id===r.id;}).reduce(function(s,a){return s+Number(a.quantity||0);},0))+'</td><td class="num">'+(q==null?"—":fmt(Math.max(0,q-avrRows.filter(function(a){return a.estimate_row_id===r.id;}).reduce(function(s,a){return s+Number(a.quantity||0);},0))))+'</td><td class="num">'+money(((dataState.estimateCosts||[]).find(function(x){return x.estimate_row_id===r.id;})||{}).total_amount)+'</td></tr>';
        }).join("");
        const names='<div class="mv-source-grid"><div class="mv-source-box"><div class="mv-source-head">Исходные данные сметы</div><div class="mv-props">'+
          '<div class="mv-prop"><b>Исходное обоснование</b><span>'+esc(linkedEstimateRows[0]?estimateSourceValue(linkedEstimateRows[0],"basis"):"—")+'</span></div>'+
          '<div class="mv-prop"><b>Исходное наименование</b><span>'+esc(linkedEstimateRows[0]?estimateSourceValue(linkedEstimateRows[0],"name"):"—")+'</span></div>'+
          '<div class="mv-prop"><b>Источник</b><span>'+(linkedEstimateRows[0]?"Смета №"+esc((dataState.estimates.find(function(e){return e.id===linkedEstimateRows[0].estimate_id;})||{}).number||""):"—")+'</span></div></div></div>'+
          '<div class="mv-source-box"><div class="mv-source-head">Принятые данные</div><div class="mv-props"><div class="mv-prop"><b>Марка</b><span>'+esc(item.mark)+'</span></div><div class="mv-prop"><b>Наименование</b><span><select class="mv-name-select" data-material-name-select><option value="">'+esc(item.name)+'</option>'+allNames.filter(function(n){return n!==item.name;}).map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+'</option>';}).join("")+'</select></span></div><div class="mv-prop"><b>Обозначение</b><span>'+esc(st.rows[0]&&st.rows[0].designation||"—")+'</span></div></div></div></div>';
        b.innerHTML=project+block('Распределение по этажам <span class="sub">компактная матрица вместо длинного списка</span>',floors,'mv-mb')+
          block("Связанные строки смет",'<div class="mv-table-wrap"><table><thead><tr><th>Смета</th><th>Поз.</th><th>Марка</th><th>Наименование</th><th>Ед.</th><th>По смете</th><th>Запроцентовано</th><th>Остаток</th><th>Стоимость</th></tr></thead><tbody>'+(estBody||'<tr><td colspan="9" class="center">Связанных строк сметы нет.</td></tr>')+'</tbody></table></div>','mv-mb')+names;
        const sel=b.querySelector("[data-material-name-select]");
        if(sel) sel.onchange=function(){
          if(!sel.value)return;
          const target=dataState.catalogItems.find(function(x){return x.name===sel.value;});
          if(target && target.id!==item.id) alert("Выбор наименования показан в карточке, но сохранение в базу пока не включено: нужно определить, меняем ли номенклатуру проекта или только принятое наименование строки сметы.");
          sel.value="";
        };
      } else if(tab==="supplyMontage"){
        b.innerHTML=block("Движение материала",'<div class="mv-flow"><div class="mv-flow-card"><b>Требуется по проекту</b><strong>'+fmt0(st.qty)+' шт. / '+fmt(st.m3)+' м³</strong><span>100%</span></div><div class="mv-arrow">→</div><div class="mv-flow-card"><b>Поставлено</b><strong>'+fmt0(suppliedQty)+' шт. / '+fmt(suppliedM3)+' м³</strong><span>'+fmt(st.qty?suppliedQty/st.qty*100:0)+'%</span></div><div class="mv-arrow">→</div><div class="mv-flow-card"><b>Смонтировано</b><strong>'+fmt0(mountedQty)+' шт. / '+fmt(mountedQty*volumePerPiece)+' м³</strong><span>'+fmt(st.qty?mountedQty/st.qty*100:0)+'%</span></div></div>','mv-mb')+
          '<div class="mv-grid2">'+block("Поставка",'<div class="mv-meter-row"><b>Поставлено</b><div class="mv-track"><div class="mv-fill" style="width:'+Math.min(100,st.qty?suppliedQty/st.qty*100:0)+'%"></div></div><div class="mv-meter-val">'+fmt0(suppliedQty)+' / '+fmt0(st.qty)+' шт.</div></div><div class="mv-meter-row"><b>Осталось поставить</b><div></div><div class="mv-meter-val">'+fmt0(Math.max(0,st.qty-suppliedQty))+' шт.</div></div>')+
          block("Монтаж",'<div class="mv-meter-row"><b>Смонтировано</b><div class="mv-track"><div class="mv-fill good" style="width:'+Math.min(100,st.qty?mountedQty/st.qty*100:0)+'%"></div></div><div class="mv-meter-val">'+fmt0(mountedQty)+' / '+fmt0(st.qty)+' шт.</div></div><div class="mv-meter-row"><b>Осталось смонтировать</b><div></div><div class="mv-meter-val">'+fmt0(Math.max(0,st.qty-mountedQty))+' шт.</div></div>')+'</div>';
      } else if(tab==="avrS29"){
        b.innerHTML='<div class="mv-grid3 mv-mb">'+block("Запроцентовано",'<div class="mv-single"><div class="mv-kpi-value good">'+fmt0(avrQty)+' шт. / '+fmt(avrM3)+' м³</div><div class="mv-kpi-sub">'+(avrAmount?money(avrAmount)+" BYN":"—")+'</div></div>')+
          block('Списано <span class="mv-badge">без НДС</span>','<div class="mv-single"><div class="mv-kpi-value warn">'+fmt(writtenM3)+' м³</div><div class="mv-kpi-sub">по С-29 / бухгалтерии</div></div>')+
          block("Разница",'<div class="mv-single"><div class="mv-kpi-value warn">'+fmt(Math.abs(avrM3-writtenM3))+' м³</div></div>')+'</div>'+
          block("АВР и списание по месяцам",'<div class="mv-table-wrap"><table><thead><tr><th>Показатель</th><th>Кол-во, шт.</th><th>АВР, м³</th><th>Стоимость АВР</th><th>С-29, м³</th><th>Разница</th></tr></thead><tbody><tr><td>Накопительно</td><td class="num">'+fmt0(avrQty)+'</td><td class="num">'+fmt(avrM3)+'</td><td class="num">'+money(avrAmount)+'</td><td class="num">'+fmt(writtenM3)+'</td><td class="num">'+fmt(avrM3-writtenM3)+'</td></tr></tbody></table></div>');
      } else {
        b.innerHTML=block('История материала <span class="sub">изменения данных, связей и источников</span>','<div class="mv-history"><div class="mv-history-row"><div class="mv-history-time">Текущая база</div><div class="mv-history-source">Проект</div><div class="mv-history-text">Карточка собрана из актуальных данных Supabase. История изменений будет показываться только из фактического журнала событий.</div><div class="mv-history-user">Система</div></div></div>');
      }
    }
    body("overview");
    modal.querySelector(".material-close").onclick=function(){modal.classList.remove("open");};
    modal.onclick=function(e){if(e.target===modal) modal.classList.remove("open");};
    modal.querySelectorAll("[data-mtab]").forEach(function(btn){btn.onclick=function(){modal.querySelectorAll("[data-mtab]").forEach(function(x){x.classList.toggle("active",x===btn);});body(btn.dataset.mtab);};});
    const card=modal.querySelector(".material-card"),head=modal.querySelector(".material-card-head");
    head.onmousedown=function(e){
      if(e.target.closest("button,input,select"))return;
      const r=card.getBoundingClientRect(),dx=e.clientX-r.left,dy=e.clientY-r.top;
      card.style.position="fixed";card.style.left=r.left+"px";card.style.top=r.top+"px";card.style.margin="0";
      function move(ev){card.style.left=Math.max(8,Math.min(window.innerWidth-card.offsetWidth-8,ev.clientX-dx))+"px";card.style.top=Math.max(8,Math.min(window.innerHeight-card.offsetHeight-8,ev.clientY-dy))+"px";}
      function up(){document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);}
      document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
    };
  }

  function checkHtml(id,label,checked,group) {
    return '<label class="check"><input type="checkbox" data-filter-group="' + esc(group) + '" data-filter-id="' + esc(id) + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }


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
      await loadProjectData(dataState.project);
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


  const ESTIMATE_IMPORT_SLOTS = [
    {number:"200",label:"№200 — Секция 1 · Цоколь"},
    {number:"201",label:"№201 — Секция 2 · Цоколь"},
    {number:"202",label:"№202 — Секция 1 · Выше 0.000"},
    {number:"203",label:"№203 — Секция 2 · Выше 0.000"},
    {number:"207",label:"№207 — Элементы лестниц"}
  ];

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
      const unit=uq.join(" ").trim();
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
    const close=function(){modal.classList.remove("open");};
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
    list.innerHTML=ESTIMATE_IMPORT_SLOTS.map(function(slot){
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
      const slot=ESTIMATE_IMPORT_SLOTS.find(function(x){return x.number===number;});
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
      await loadProjectData(dataState.project);
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


  function supplierMatchMark(value) {
    return importNorm(value).replace(/ё/g,"е").replace(/[()\s]/g,"");
  }

  function supplierMatchName(value) {
    return importNorm(value).replace(/ё/g,"е");
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

    const rows=[],counts={};
    let section="";
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

      const looksSection=!mark && !!name && volume==null && !prices.length && qty==null && !/^(итого|всего)/i.test(name);
      if(looksSection){section=name;continue;}
      if(!mark || !name) continue;
      if(/^(итого|всего)/i.test(name)) continue;

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
        source_mark:mark,
        source_name:name,
        source_section:section,
        unit_volume_m3:volume,
        qty_house:qty,
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
          return supplierMatchMark(ci.mark)===supplierMatchMark(row.source_mark) &&
            supplierMatchName(ci.name)===supplierMatchName(row.source_name);
        });
        const byMark=catalog.filter(function(ci){return supplierMatchMark(ci.mark)===supplierMatchMark(row.source_mark);});
        const byName=catalog.filter(function(ci){return supplierMatchName(ci.name)===supplierMatchName(row.source_name);});
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
        '<div class="spec-import-head"><div><strong>Импорт спецификации поставщика</strong><span>Источник сохраняется как новая версия; проектные количества не заменяются</span></div><button class="spec-import-close" type="button">×</button></div>'+
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
    apply.disabled=true;state.textContent="Записываю спецификацию поставщика…";
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
      await loadProjectData(dataState.project);
      renderPage("supply",2);
      state.textContent="Импорт завершён";
      preview.innerHTML=
        '<strong>Спецификация поставщика загружена</strong>'+
        '<span>'+esc(String(report.rows||0))+' позиций</span>'+
        '<span>'+esc(String(report.matched||0))+' сопоставлено</span>'+
        '<span>'+esc(String(report.new_or_changed_price||0))+' новая/изменённая цена</span>'+
        '<span>'+esc(String(report.without_price||0))+' без цены</span>'+
        '<span>'+esc(String(report.supplier_only||0))+' только у поставщика</span>'+
        '<span>'+esc(String(report.requires_review||0))+' требует проверки</span>';
      preview.classList.remove("hidden");
    }catch(err){
      state.textContent="Ошибка импорта";
      preview.innerHTML='<strong>Не удалось записать спецификацию поставщика</strong><pre>'+esc(err&&err.message?err.message:String(err))+'</pre>';
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

  function supplierCheckProjectRows() {
    const out=new Map();
    buildWorkingSummaryRows().forEach(function(r){
      if(!r.catalogItemId) return;
      if(!out.has(r.catalogItemId)) out.set(r.catalogItemId,{catalogItemId:r.catalogItemId,mark:r.mark,name:r.name,qty:0,volumes:new Set()});
      const x=out.get(r.catalogItemId);
      x.qty+=r.houseOnly?Number(r.houseTotal||0):Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);
      if(Number(r.volumePerPiece)>0) x.volumes.add(Number(r.volumePerPiece).toFixed(6));
    });
    return Array.from(out.values()).map(function(x){x.volume=x.volumes.size===1?Number(Array.from(x.volumes)[0]):null;return x;});
  }

  function supplierCandidateScore(project,row) {
    const raw=row.raw_data||{};
    let score=0;
    const pm=supplierMatchMark(project.mark),sm=supplierMatchMark(raw.source_mark);
    const pn=supplierMatchName(project.name),sn=supplierMatchName(raw.source_name);
    if(pm===sm) score+=1000;
    if(pn===sn) score+=1200;
    if(pm&&sm&&(pm.includes(sm)||sm.includes(pm))) score+=180;
    const pt=new Set(pn.split(/[^a-zа-яё0-9]+/i).filter(Boolean));
    const st=new Set(sn.split(/[^a-zа-яё0-9]+/i).filter(Boolean));
    let common=0;pt.forEach(function(t){if(st.has(t)) common++;});
    score+=common*20;
    return score;
  }

  function supplierCheckRow(project,snapshot) {
    const link=(dataState.supplierPriceLinks||[]).find(function(x){return x.catalog_item_id===project.catalogItemId;});
    const source=link?snapshot.find(function(x){return x.supplier_item_id===link.supplier_item_id;}):null;
    const raw=source&&source.raw_data||{};
    const prices=Array.isArray(raw.prices)?raw.prices:[];
    const piecePrices=prices.filter(function(p){return (p.price_basis||"piece")==="piece";});
    const m3Prices=prices.filter(function(p){return p.price_basis==="m3";});
    const piece=piecePrices.length===1?Number(piecePrices[0].unit_price_gross):null;
    const supplierVolume=raw.unit_volume_m3==null?null:Number(raw.unit_volume_m3);
    const perM3=m3Prices.length===1?Number(m3Prices[0].unit_price_gross):(piece!=null&&supplierVolume>0?piece/supplierVolume:null);
    const reasons=[];
    const candidates=snapshot.map(function(s){return {row:s,score:supplierCandidateScore(project,s)};}).filter(function(x){return x.score>0;}).sort(function(a,b){return b.score-a.score;});
    if(link&&!source) reasons.push("Нет в новой версии");
    if(!link && candidates.length>1) reasons.push("Несколько кандидатов");
    if(!link && candidates.length<=1) reasons.push("Нет подтверждённой связи");
    if(source){
      if(supplierMatchMark(project.mark)!==supplierMatchMark(raw.source_mark)) reasons.push("Марка");
      if(supplierMatchName(project.name)!==supplierMatchName(raw.source_name)) reasons.push("Наименование");
      if(!prices.length) reasons.push("Без цены");
      if(new Set(prices.map(function(p){return String(p.effective_from)+"|"+String(p.unit_price_gross);})).size!==prices.length) reasons.push("Несколько цен");
      if(raw.qty_house!=null&&Math.abs(Number(raw.qty_house)-project.qty)>1e-6) reasons.push("Количество: "+fmt0(raw.qty_house)+" ≠ "+fmt0(project.qty));
      if(supplierVolume!=null&&project.volume!=null&&Math.abs(supplierVolume-project.volume)>1e-6) reasons.push("Объём: "+fmt(supplierVolume)+" ≠ "+fmt(project.volume));
    }
    const currentImport=source&&source.import_id;
    const changed=(dataState.supplierPriceJournal||[]).some(function(j){return j.import_id===currentImport&&j.catalog_item_id===project.catalogItemId&&j.event_type==="price_changed";});
    if(changed) reasons.push("Изменена цена");
    let status="Сопоставлено";
    if(!link || (link&&link.validation_state==="review") || (!source&&link&&link.validation_state!=="confirmed")) status="Требует проверки";
    else if(!source) status="Нет в новой версии";
    else if(!prices.length) status="Без цены";
    else if(changed) status="Изменена цена";
    else if(raw.qty_house!=null&&Math.abs(Number(raw.qty_house)-project.qty)>1e-6) status="Расхождение количества";
    else if(supplierVolume!=null&&project.volume!=null&&Math.abs(supplierVolume-project.volume)>1e-6) status="Расхождение объёма";
    return {project:project,link:link,source:source,raw:raw,prices:prices,piece:piece,perM3:perM3,status:status,reasons:reasons,candidates:candidates};
  }

  function supplierStatusClass(status) {
    if(status==="Сопоставлено") return "ok";
    if(status==="Изменена цена"||status.indexOf("Расхождение")===0||status==="Требует проверки") return "review";
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

  function renderSupplierCheckJournal(content) {
    let rows=(dataState.supplierPriceJournal||[]).filter(function(j){return !ui.supplierCheckCatalog||j.catalog_item_id===ui.supplierCheckCatalog;});
    const imports=new Map((dataState.imports||[]).map(function(x){return [x.id,x];}));
    const catalog=new Map(dataState.catalogItems.map(function(x){return [x.id,x];}));
    const items=new Map(dataState.supplierItems.map(function(x){return [x.id,x];}));
    let body=rows.map(function(j){
      const i=imports.get(j.import_id),c=catalog.get(j.catalog_item_id),s=items.get(j.supplier_item_id);
      const version=(dataState.supplierSnapshotRows||[]).find(function(x){return x.import_id===j.import_id;});
      return '<tr><td>'+esc(new Date(j.created_at).toLocaleString("ru-RU"))+'</td><td>'+esc(version?'Прайс №'+version.version_no:(i&&i.source_name||"—"))+'</td><td>'+esc(c?c.id.slice(0,8):"—")+'</td><td>'+esc(c&&c.mark||"—")+'</td><td>'+esc(s&&s.source_key||"—")+'</td><td>'+esc(s&&s.source_mark||"—")+'</td><td>'+esc(supplierEventLabel(j.event_type))+'</td><td>'+esc(supplierValueText(j.before_value))+'</td><td>'+esc(supplierValueText(j.after_value))+'</td><td>'+esc(j.link_method==="manual"?"Вручную":j.link_method==="auto"?"Авто":"—")+'</td><td>Пользователь</td></tr>';
    }).join("");
    if(!body) body=tableMessage(ui.supplierCheckCatalog?"По позиции ещё нет событий.":"Журнал проверки прайса пока пуст.",11);
    content.innerHTML=(ui.supplierCheckCatalog?'<div class="supplier-check-journal-filter"><button class="table-text-action" data-supplier-journal-all type="button">← Общий журнал</button></div>':'')+
      '<div class="engineering-scroll"><table class="eng-table supplier-check-journal" data-table-key="supplier-price-journal-v1"><thead><tr><th>Дата/время</th><th>Версия прайса</th><th>Позиция спецификации</th><th>Марка проекта</th><th>Позиция поставщика</th><th>Марка поставщика</th><th>Событие</th><th>Было</th><th>Стало</th><th>Способ</th><th>Пользователь</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    const all=content.querySelector("[data-supplier-journal-all]");if(all)all.onclick=function(){ui.supplierCheckCatalog="";renderSupplierCheck();};
  }

  function renderSupplierCheckRecon(content) {
    const snapshot=latestSupplierSnapshotRows();
    const rows=supplierCheckProjectRows().map(function(p){return supplierCheckRow(p,snapshot);});
    let body=rows.map(function(x,index){
      const r=x.raw||{};
      return '<tr class="data-row"><td class="center">'+(index+1)+'</td><td>'+esc(x.project.mark)+'</td><td>'+esc(x.project.name)+'</td><td class="num">'+fmt0(x.project.qty)+'</td><td class="num">'+(x.project.volume==null?'—':fmt(x.project.volume))+'</td><td class="num">'+(x.project.volume==null?'—':fmt(x.project.qty*x.project.volume))+'</td>'+
        '<td class="center">'+(x.source?esc(x.source.source_row_no):'—')+'</td><td>'+esc(r.source_mark||"")+'</td><td>'+esc(r.source_name||"")+'</td><td class="num">'+(r.qty_house==null?'—':fmt0(r.qty_house))+'</td><td class="num '+(x.reasons.some(function(v){return v.indexOf("Объём:")===0;})?'warning':'')+'">'+(r.unit_volume_m3==null?'—':fmt(r.unit_volume_m3))+'</td><td class="num">'+(x.piece==null?'—':money(x.piece))+'</td><td class="num">'+(x.perM3==null?'—':money(x.perM3))+'</td>'+
        '<td><span class="price-state '+supplierStatusClass(x.status)+'">'+esc(x.status)+'</span></td><td>'+esc(x.link?(x.link.link_method==="manual"?"Вручную":"Авто"):"—")+'</td><td class="supplier-check-reasons">'+esc(x.reasons.length?x.reasons.join(" · "):"Нет")+'</td>'+
        '<td><button class="table-text-action" data-supplier-row-journal="'+esc(x.project.catalogItemId)+'" type="button">История</button></td><td><button class="table-text-action" data-supplier-match="'+esc(x.project.catalogItemId)+'" type="button">'+(x.link?'Изменить':'Сопоставить')+'</button></td></tr>';
    }).join("");
    const supplierOnly=snapshot.filter(function(s){return !s.catalog_item_id;});
    if(supplierOnly.length){
      body+='<tr class="group-row"><td colspan="18" class="group-title">Только у поставщика</td></tr>';
      supplierOnly.forEach(function(s){const r=s.raw_data||{};const ps=Array.isArray(r.prices)?r.prices:[];body+='<tr class="data-row supplier-only-row"><td></td><td></td><td></td><td></td><td></td><td></td><td class="center">'+esc(s.source_row_no)+'</td><td>'+esc(r.source_mark||"")+'</td><td>'+esc(r.source_name||"")+'</td><td class="num">'+(r.qty_house==null?'—':fmt0(r.qty_house))+'</td><td class="num">'+(r.unit_volume_m3==null?'—':fmt(r.unit_volume_m3))+'</td><td class="num">'+(ps.length?money(ps[0].unit_price_gross):'—')+'</td><td></td><td><span class="price-state supplier">Только у поставщика</span></td><td>—</td><td>Не создаёт проектную позицию</td><td></td><td></td></tr>';});
    }
    if(!body) body=tableMessage("Нет данных для проверки. Сначала импортируйте прайс поставщика.",18);
    content.innerHTML='<div class="supplier-check-summary">Рабочая сводка: '+rows.length+' · версия прайса: '+(snapshot[0]?'№'+snapshot[0].version_no:'нет')+' · требует проверки: '+rows.filter(function(x){return x.status!=="Сопоставлено";}).length+'</div><div class="engineering-scroll"><table class="eng-table supplier-check-table" data-table-key="supplier-price-check-v1"><thead><tr><th colspan="6">СПЕЦИФИКАЦИЯ</th><th colspan="7">ПРАЙС ПОСТАВЩИКА</th><th colspan="5">СВЕРКА</th></tr><tr><th>№</th><th>Марка</th><th>Наименование</th><th>Проект, шт.</th><th>Объём за ед., м³</th><th>Объём всего, м³</th><th>Строка источника</th><th>Марка поставщика</th><th>Наименование поставщика</th><th>Количество поставщика</th><th>Объём за ед., м³</th><th>Цена за 1 шт.</th><th>Цена за 1 м³</th><th>Сопоставление</th><th>Способ</th><th>Расхождение</th><th>Журнал</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    content.querySelectorAll("[data-supplier-match]").forEach(function(btn){btn.onclick=function(){openSupplierMatchEditor(btn.dataset.supplierMatch);};});
    content.querySelectorAll("[data-supplier-row-journal]").forEach(function(btn){btn.onclick=function(){ui.supplierCheckTab="journal";ui.supplierCheckCatalog=btn.dataset.supplierRowJournal;renderSupplierCheck();};});
  }

  function renderSupplierCheck() {
    const modal=supplierCheckModal();
    if(!ui.supplierCheckTab) ui.supplierCheckTab="recon";
    modal.querySelectorAll("[data-supplier-check-tab]").forEach(function(btn){btn.classList.toggle("active",btn.dataset.supplierCheckTab===ui.supplierCheckTab);});
    const content=modal.querySelector(".supplier-check-content");
    if(ui.supplierCheckTab==="journal") renderSupplierCheckJournal(content); else renderSupplierCheckRecon(content);
    content.querySelectorAll("table").forEach(function(t){installResizeAutofit(t);});
  }

  function openSupplierCheck() {
    ui.supplierCheckTab="recon";ui.supplierCheckCatalog="";
    const modal=supplierCheckModal();renderSupplierCheck();modal.classList.add("open");
  }

  function supplierMatchEditorModal() {
    let modal=document.getElementById("supplierMatchEditorModal");
    if(modal)return modal;
    modal=document.createElement("div");modal.id="supplierMatchEditorModal";modal.className="spec-import-backdrop supplier-match-backdrop";
    modal.innerHTML='<div class="recon-edit-modal supplier-match-modal"><div class="spec-import-head"><div><strong>Сопоставить с прайсом</strong><span>Кандидаты отсортированы по вероятности; выбор не выполняется автоматически</span></div><button class="spec-import-close" type="button">×</button></div><div class="supplier-match-source"></div><div class="supplier-match-list"></div><div class="spec-import-foot"><span class="recon-edit-state"></span><span class="spacer"></span><button class="context-link supplier-link-remove" type="button">Снять связь</button><button class="context-link supplier-match-cancel" type="button">Отмена</button><button class="context-link supplier-match-save" type="button">Сопоставить</button></div></div>';
    document.body.appendChild(modal);
    const close=function(){modal.classList.remove("open");};modal.querySelector(".spec-import-close").onclick=close;modal.querySelector(".supplier-match-cancel").onclick=close;
    modal.querySelector(".supplier-match-save").onclick=saveSupplierMatch;modal.querySelector(".supplier-link-remove").onclick=function(){saveSupplierMatch(true);};
    return modal;
  }

  function openSupplierMatchEditor(catalogId) {
    const project=supplierCheckProjectRows().find(function(x){return x.catalogItemId===catalogId;});if(!project)return;
    const snapshot=latestSupplierSnapshotRows();const model=supplierCheckRow(project,snapshot);const linked=model.link&&model.link.supplier_item_id;
    const ranked=snapshot.map(function(s){return {row:s,score:supplierCandidateScore(project,s)};}).sort(function(a,b){return b.score-a.score||Number(a.row.source_row_no)-Number(b.row.source_row_no);});
    const modal=supplierMatchEditorModal();modal.dataset.catalogId=catalogId;
    modal.querySelector(".supplier-match-source").innerHTML='<span>Проектная номенклатура</span><strong>'+esc(project.mark)+' · '+esc(project.name)+'</strong><small>Проект: '+fmt0(project.qty)+' шт.'+(project.volume!=null?' · '+fmt(project.volume)+' м³/шт.':'')+'</small>';
    modal.querySelector(".supplier-link-remove").classList.toggle("hidden",!model.link);
    modal.querySelector(".supplier-match-list").innerHTML='<table class="eng-table recon-candidate-table"><thead><tr><th>Выбор</th><th>Строка прайса</th><th>Марка поставщика</th><th>Наименование поставщика</th><th>Объём за ед.</th><th>Цена за 1 шт.</th><th>Цена за 1 м³</th><th>Состояние</th></tr></thead><tbody>'+ranked.map(function(c,index){const s=c.row,r=s.raw_data||{},ps=Array.isArray(r.prices)?r.prices:[],piece=ps.find(function(p){return (p.price_basis||"piece")==="piece";}),vol=Number(r.unit_volume_m3||0),owner=(dataState.supplierPriceLinks||[]).find(function(x){return x.supplier_item_id===s.supplier_item_id;});const disabled=owner&&owner.catalog_item_id!==catalogId;return '<tr class="supplier-candidate-row'+(linked===s.supplier_item_id?' is-selected':'')+'"><td class="center"><input type="radio" name="supplier-candidate" data-supplier-candidate="'+esc(s.supplier_item_id||'')+'" '+(linked===s.supplier_item_id?'checked':'')+' '+(disabled?'disabled':'')+'></td><td class="center">'+esc(s.source_row_no)+'</td><td><strong>'+esc(r.source_mark||'')+'</strong>'+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td><td>'+esc(r.source_name||'')+'</td><td class="num">'+(vol?fmt(vol):'—')+'</td><td class="num">'+(piece?money(piece.unit_price_gross):'—')+'</td><td class="num">'+(piece&&vol?money(Number(piece.unit_price_gross)/vol):'—')+'</td><td>'+(disabled?'Связано с другой позицией':linked===s.supplier_item_id?'Текущая связь':'Кандидат')+'</td></tr>';}).join('')+'</tbody></table>';
    modal.querySelector(".recon-edit-state").textContent="";
    modal.querySelectorAll(".supplier-candidate-row").forEach(function(row){row.onclick=function(e){const radio=row.querySelector("input");if(radio.disabled)return;if(e.target!==radio)radio.checked=true;modal.querySelectorAll(".supplier-candidate-row").forEach(function(x){x.classList.toggle("is-selected",x.querySelector("input").checked);});};});
    modal.classList.add("open");
  }

  async function saveSupplierMatch(remove) {
    const modal=supplierMatchEditorModal(),state=modal.querySelector(".recon-edit-state");
    const chosen=remove?null:modal.querySelector("[data-supplier-candidate]:checked");
    if(!remove&&!chosen){state.textContent="Выберите позицию поставщика.";return;}
    state.textContent="Сохраняю…";
    const result=await client.rpc("set_supplier_price_link",{p_project_id:dataState.project.id,p_catalog_item_id:modal.dataset.catalogId,p_supplier_item_id:remove?null:chosen.dataset.supplierCandidate});
    if(result.error){state.textContent=result.error.message;return;}
    await loadProjectData(dataState.project);modal.classList.remove("open");renderSupplierCheck();renderSupplierPrice();
  }

  function renderUtilityActions(pageKey) {
    const el=$("pageActions");
    if(!el) return;
    if(pageKey==="spec"){
      el.innerHTML='<button class="action" data-spec-import-open type="button">Импорт Excel</button><button class="action more" type="button" aria-label="Ещё">…</button>';
      const btn=el.querySelector("[data-spec-import-open]");
      if(btn) btn.onclick=openSpecImportModal;
    }else if(pageKey==="estimates"){
      el.innerHTML='<button class="action" data-estimate-import-open type="button">Импорт Excel</button><button class="action more" type="button" aria-label="Ещё">…</button>';
      const btn=el.querySelector("[data-estimate-import-open]");
      if(btn) btn.onclick=openEstimateImportModal;
    }else if(pageKey==="avr" || pageKey==="s29"){
      el.innerHTML="";
    }else{
      el.innerHTML='<button class="action" type="button">Настроить</button><button class="action more" type="button" aria-label="Ещё">…</button>';
    }
  }

  function buildSpecContext(tab) {
    const all = ui.spec.s1 && ui.spec.s2 && ui.spec.basement && ui.spec.above && ui.spec.stairs;
    let html = '<span class="context-caption">Показывать:</span>';
    html += checkHtml("all","Все",all,"spec");
    html += checkHtml("s1","Секция 1",ui.spec.s1,"spec");
    html += checkHtml("s2","Секция 2",ui.spec.s2,"spec");
    html += checkHtml("basement","Цокольные",ui.spec.basement,"spec");
    html += checkHtml("above","Выше 0.000",ui.spec.above,"spec");
    html += checkHtml("stairs","Лестницы",ui.spec.stairs,"spec");
    return html;
  }

  function buildEstimateContext(tab) {
    if (tab !== 0 && !(ui.page === "avr" && tab === 2)) return '<span class="context-muted">Контекст текущего представления</span>';
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
    if (pageKey === "montage") {
      return '<span class="context-caption">Показывать:</span>' +
        checkHtml("all","Все",true,"montage") +
        checkHtml("s1","Секция 1",true,"montage") +
        checkHtml("s2","Секция 2",true,"montage") +
        '<button class="context-link" type="button">Уровень: 1 ▾</button>' +
        '<button class="context-link" type="button">Сентябрь 2026 ▾</button>';
    }
    if (pageKey === "avr") {
      if (tab === 0) {
        const doc=selectedAvrDocument();
        const version=selectedAvrVersion();
        const versions=doc?versionsForDocument(doc.id):[];
        return '<span class="context-caption">Месяц:</span>'+monthSelectHtml(ui.avr.period,'data-avr-period',false)+'<span>·</span><span class="context-caption">АВР:</span><strong>'+esc(doc&&doc.display_number||"нет")+'</strong><span>·</span><span class="context-caption">Версия:</span><select class="execution-select" data-avr-version '+(!versions.length?'disabled':'')+'>'+(!versions.length?'<option>—</option>':versions.map(function(v){return '<option value="'+v.id+'"'+(version&&v.id===version.id?' selected':'')+'>v'+v.version_no+'</option>';}).join(""))+'</select><span>·</span><span class="execution-status '+(version?version.state:'draft')+'">'+esc(avrStatus(version))+'</span>';
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
        let actions='<button class="context-link" data-s29-excel type="button" '+(!doc?'disabled':'')+'>Сформировать Excel</button>';
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
      if (tab === 1) return '<span class="context-caption">Документы поставки</span><span>Белые ТТН фиксируют фактическое поступление сразу; зелёные ТТН документально подтверждают его.</span><span class="spacer"></span><span class="context-muted">Накладные будут подключены к данным поставки</span>';
      if (tab === 2) return '<span class="context-caption">Прайс поставщика</span><span>Позиции проекта сгруппированы по Рабочей сводке.</span><span class="spacer"></span><button class="context-link" data-supplier-check-open type="button">Проверить прайс</button><button class="context-link" data-supplier-import-open type="button">Импорт спецификации поставщика</button>';
      return '<span class="context-muted">Данные по всему объекту</span>';
    }
    return '<span class="context-muted">Контекст страницы</span>';
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
    if (pageKey === "montage") return '<span class="context-muted">ЛКМ +1 · ПКМ −1</span>';
    return "";
  }

  function isHierarchical(pageKey, tab) {
    if (pageKey === "spec") return true;
    if (pageKey === "estimates") return tab === 0;
    if (pageKey === "supply") return tab === 0 || tab === 2;
    if (pageKey === "avr") return tab === 0 || tab === 2;
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

  function renderSpecProject() {
    const levels = levelCodes().concat(["Всего"]);
    let rows = specJoinedRows().filter(passesSpecFilters).filter(rowMatchesSpecSearch)
      .filter(function(r){return rowPassesColumnFilters({mark:r.mark,name:r.name});});
    rows = sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
    rows.sort(function(a,b){
      const s=sortBucket();
      if(s && (s.field==="mark" || s.field==="name")) return 0;
      return a.position_no - b.position_no;
    });

    let body = "";
    ui.currentGroupKeys = [];
    if (!rows.length) {
      body = tableMessage("Нет строк по текущему фильтру.",3+levels.length);
    } else {
      const rootKey = "spec-project:root";
      body += specGroupRow("Всего по дому",rows,rootKey,0,levels);
      if (!ui.collapsed.has(rootKey)) {
        ["Секция 1","Секция 2"].forEach(function(bs) {
          const bsRows = rows.filter(function(r){ return r.section.building_section === bs; });
          if (!bsRows.length) return;
          const bsKey = "spec-project:bs:"+bs;
          body += specGroupRow(bs,bsRows,bsKey,1,levels);
          if (ui.collapsed.has(bsKey)) return;
          ["Цоколь","Выше 0.000"].forEach(function(zone) {
            const zRows = bsRows.filter(function(r){ return r.section.zone === zone; });
            if (!zRows.length) return;
            const zKey = "spec-project:zone:"+bs+":"+zone;
            body += specGroupRow(zone,zRows,zKey,2,levels);
            if (ui.collapsed.has(zKey)) return;
            const sectionNames = Array.from(new Set(zRows.map(function(r){ return r.section.name; })));
            sectionNames.forEach(function(sectionName) {
              const sRows = zRows.filter(function(r){ return r.section.name === sectionName; });
              const sKey = "spec-project:section:"+bs+":"+zone+":"+sectionName;
              body += specGroupRow(sectionName,sRows,sKey,3,levels);
              if (ui.collapsed.has(sKey) || ui.collapseLeaves) return;
              sRows.forEach(function(r) {
                body += '<tr class="data-row" data-row-id="' + esc(r.id) + '" data-material-id="' + esc(r.catalog_item_id||"") + '">';
                body += '<td class="sticky-1 center">' + esc(r.position_no) + '</td>';
                body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
                body += filterCell("name",r.name,esc(r.name),"sticky-3");
                levels.forEach(function(code) {
                  const value = code === "Всего" ? r.total : qtyAt(r,code);
                  body += '<td class="level-col num">' + fmt0(value) + '</td>';
                });
                body += '</tr>';
              });
            });
          });
        });
        const stairRows = rows.filter(function(r){return r.section.is_stairs;});
        if(stairRows.length){
          const stairKey="spec-project:stairs";
          body += specGroupRow("Элементы лестниц",stairRows,stairKey,1,levels);
          if(!ui.collapsed.has(stairKey) && !ui.collapseLeaves){
            stairRows.forEach(function(r){
              body += '<tr class="data-row" data-row-id="' + esc(r.id) + '" data-material-id="' + esc(r.catalog_item_id||"") + '">';
              body += '<td class="sticky-1 center">' + esc(r.position_no) + '</td>';
              body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
              body += filterCell("name",r.name,esc(r.name),"sticky-3");
              levels.forEach(function(code){
                const value = code === "Всего" ? r.total : qtyAt(r,code);
                body += '<td class="level-col num">' + fmt0(value) + '</td>';
              });
              body += '</tr>';
            });
          }
        }
      }
    }

    const head = '<thead><tr>' +
      '<th class="sticky-1">№</th>' +
      '<th class="sticky-2 filterable-head">' + filterHeader("Марка","mark") + '</th>' +
      '<th class="sticky-3 filterable-head">' + filterHeader("Наименование","name") + '</th>' +
      levels.map(function(x){ return '<th class="level-col">' + esc(x === "Всего" ? "Всего" : levelLabel(x)) + '</th>'; }).join("") +
      '</tr></thead>';

    $("workArea").className = "work-area table-work spec-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table" data-table-key="spec-project">' + head + '<tbody>' + body + '</tbody></table></div></div>';
  }

  function buildWorkingSummaryRows() {
    const rows = specJoinedRows().filter(passesSpecFilters).filter(rowMatchesSpecSearch);
    const levels = levelCodes();
    const grouped = new Map();

    rows.forEach(function(r) {
      const key = [r.section.zone,r.section.name,r.catalog_item_id || (r.mark+"|"+r.name)].join("||");
      if (!grouped.has(key)) {
        grouped.set(key,{
          key:key,
          zone:r.section.zone,
          sectionName:r.section.name,
          mark:r.mark,
          name:r.name,
          catalogItemId:r.catalog_item_id || "",
          volumePerPiece:r.volumePerPiece,
          bySection:{"Секция 1":0,"Секция 2":0},
          byLevel:{"Секция 1":new Map(),"Секция 2":new Map()}
        });
      }
      const g = grouped.get(key);
      if (r.section.is_stairs) {
        // Stairs are a house-wide block. Never invent a 50/50 S1/S2 allocation.
        g.houseOnly=true;
        g.houseTotal=Number(g.houseTotal||0)+Number(r.total||0);
        if(!g.houseByLevel) g.houseByLevel=new Map();
        levels.forEach(function(code) {
          const v=Number(qtyAt(r,code)||0);
          if (v) g.houseByLevel.set(code,Number(g.houseByLevel.get(code)||0)+v);
        });
      } else {
        const bs = r.section.building_section;
        if (!g.bySection[bs]) g.bySection[bs] = 0;
        g.bySection[bs] += r.total;
        if (!g.byLevel[bs]) g.byLevel[bs] = new Map();
        levels.forEach(function(code) {
          const v = qtyAt(r,code);
          if (v) g.byLevel[bs].set(code,Number(g.byLevel[bs].get(code) || 0)+v);
        });
      }
    });

    return Array.from(grouped.values()).sort(function(a,b) {
      const z = a.zone.localeCompare(b.zone,"ru");
      if (z) return z;
      const s = a.sectionName.localeCompare(b.sectionName,"ru");
      if (s) return s;
      return a.mark.localeCompare(b.mark,"ru");
    });
  }

  function summaryVector(rows, levels) {
    const out = [];
    let s1 = 0, s2 = 0, v1 = 0, v2 = 0;
    rows.forEach(function(r) {
      const a = Number(r.bySection["Секция 1"] || 0);
      const b = Number(r.bySection["Секция 2"] || 0);
      s1 += a; s2 += b;
      v1 += a * Number(r.volumePerPiece || 0);
      v2 += b * Number(r.volumePerPiece || 0);
    });
    out.push(s1,v1,s2,v2);
    levels.forEach(function(code) {
      let a = 0, b = 0;
      rows.forEach(function(r) {
        a += Number((r.byLevel["Секция 1"] && r.byLevel["Секция 1"].get(code)) || 0);
        b += Number((r.byLevel["Секция 2"] && r.byLevel["Секция 2"].get(code)) || 0);
      });
      out.push(a,b);
    });
    out.push(s1+s2);
    return out;
  }

  function summaryGroupRow(label, rows, key, depth, levels) {
    registerGroup(key);
    const vector = summaryVector(rows,levels);
    let html = '<tr class="group-row group-toggle" data-group-key="' + esc(key) + '">';
    html += '<td colspan="3" class="group-title spec-group-title" style="padding-left:' + (8+depth*14) + 'px"><span class="group-arrow">' + groupArrow(key) + '</span>' + esc(label) + '</td>';
    vector.forEach(function(v,i){
      const cls = i === 1 || i === 3 ? "vol-col" : "summary-col";
      html += '<td class="' + cls + ' num">' + (i === 1 || i === 3 ? fmt(v) : fmt0(v)) + '</td>';
    });
    html += '</tr>';
    return html;
  }

  function renderSpecSummary() {
    const levels = levelCodes();
    let rows = buildWorkingSummaryRows().filter(function(r){return rowPassesColumnFilters({mark:r.mark,name:r.name});});
    rows = sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
    ui.currentGroupKeys = [];

    let body = "";
    if (!rows.length) {
      body = tableMessage("Нет строк по текущему фильтру.",3+4+levels.length*2+1);
    } else {
      const rootKey = "spec-summary:root";
      body += summaryGroupRow("Всего по дому",rows,rootKey,0,levels);
      if (!ui.collapsed.has(rootKey)) {
        ["Цоколь","Выше 0.000"].forEach(function(zone) {
          const zRows = rows.filter(function(r){ return r.zone === zone; });
          if (!zRows.length) return;
          const zKey = "spec-summary:zone:"+zone;
          body += summaryGroupRow(zone,zRows,zKey,1,levels);
          if (ui.collapsed.has(zKey)) return;
          const names = Array.from(new Set(zRows.map(function(r){ return r.sectionName; })));
          names.forEach(function(name) {
            const sRows = zRows.filter(function(r){ return r.sectionName === name; });
            const sKey = "spec-summary:section:"+zone+":"+name;
            body += summaryGroupRow(name,sRows,sKey,2,levels);
            if (ui.collapsed.has(sKey) || ui.collapseLeaves) return;
            sRows.forEach(function(r,index) {
              const s1 = Number(r.bySection["Секция 1"] || 0);
              const s2 = Number(r.bySection["Секция 2"] || 0);
              body += '<tr class="data-row" data-material-id="' + esc(r.catalogItemId||"") + '">';
              body += '<td class="sticky-1 center">' + (index+1) + '</td>';
              body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
              body += filterCell("name",r.name,esc(r.name),"sticky-3");
              body += '<td class="qty-col num">' + fmt0(s1) + '</td><td class="vol-col num">' + fmt(s1*r.volumePerPiece) + '</td>';
              body += '<td class="qty-col num">' + fmt0(s2) + '</td><td class="vol-col num">' + fmt(s2*r.volumePerPiece) + '</td>';
              levels.forEach(function(code) {
                body += '<td class="summary-col num">' + fmt0((r.byLevel["Секция 1"] && r.byLevel["Секция 1"].get(code)) || 0) + '</td>';
                body += '<td class="summary-col num">' + fmt0((r.byLevel["Секция 2"] && r.byLevel["Секция 2"].get(code)) || 0) + '</td>';
              });
              body += '<td class="summary-col num strong-num">' + fmt0(r.houseOnly?Number(r.houseTotal||0):s1+s2) + '</td>';
              body += '</tr>';
            });
          });
        });
        const stairRows=rows.filter(function(r){return r.zone==="Лестницы";});
        if(stairRows.length){
          const stairKey="spec-summary:stairs";
          body += summaryGroupRow("Элементы лестниц",stairRows,stairKey,1,levels);
          if(!ui.collapsed.has(stairKey) && !ui.collapseLeaves){
            stairRows.forEach(function(r,index){
              const s1=Number(r.bySection["Секция 1"]||0);
              const s2=Number(r.bySection["Секция 2"]||0);
              body += '<tr class="data-row" data-material-id="'+esc(r.catalogItemId||"")+'"><td class="sticky-1 center">'+(index+1)+'</td>'+
                filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3")+
                '<td class="qty-col num">—</td><td class="vol-col num">—</td>'+
                '<td class="qty-col num">—</td><td class="vol-col num">—</td>'+
                levels.map(function(){return '<td class="summary-col num">—</td><td class="summary-col num">—</td>';}).join("")+
                '<td class="summary-col num strong-num">'+fmt0(r.houseTotal||0)+'</td></tr>';
            });
          }
        }
      }
    }

    const head1 = '<tr>' +
      '<th class="sticky-1" rowspan="2">№</th>' +
      '<th class="sticky-2 filterable-head" rowspan="2">' + filterHeader("Марка","mark") + '</th>' +
      '<th class="sticky-3 filterable-head" rowspan="2">' + filterHeader("Наименование","name") + '</th>' +
      '<th colspan="2">Секция 1</th><th colspan="2">Секция 2</th>' +
      levels.map(function(x){ return '<th colspan="2" class="floor-parent">' + esc(summaryLevelLabel(x)) + '</th>'; }).join("") +
      '<th rowspan="2" class="summary-col">Итого, шт.</th>' +
      '</tr>';
    const head2 = '<tr>' +
      '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
      '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
      levels.map(function(){ return '<th class="summary-col">1</th><th class="summary-col">2</th>'; }).join("") +
      '</tr>';

    $("workArea").className = "work-area table-work spec-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table working-summary" data-table-key="spec-summary-v5"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function rowCost(row,m) {
    return m.costs.get(row.id) || {
      salary_unit:0,salary_amount:0,machines_unit:0,machines_amount:0,
      materials_unit:0,materials_amount:0,transport_unit:0,transport_amount:0,total_unit:0,total_amount:0
    };
  }

  function estimateGroupVector(rows,m) {
    let qty = 0, salary = 0, machines = 0, materials = 0, transport = 0, total = 0;
    rows.forEach(function(r) {
      qty += Number(r.quantity || 0);
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
    let html = '<tr class="group-row group-toggle" data-group-key="' + esc(key) + '">';
    html += '<td colspan="4" class="est-group-title" style="padding-left:' + (8+depth*14) + 'px"><span class="group-arrow">' + groupArrow(key) + '</span>' + esc(label) + '</td>';
    html += '<td></td><td class="num">' + fmt(v.qty) + '</td><td class="num"></td>';
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
      ? dataState.catalogItems.find(function(x){return x.id===row.catalog_item_id;}) || null
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

  function currentPriceModel() {
    if(!ui.currentPrice) ui.currentPrice={forecast:1.0552,competition:1,vat:0};
    const P=ui.currentPrice,m=maps();
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
    const P=ui.currentPrice||{forecast:1.0552,competition:1};
    if(mode==="forecast") return money(row.v*P.forecast);
    if(mode==="competition") return money(row.v*P.competition);
    return money(row.v*P.competition*P.forecast);
  }

  function currentFormulaParts(r) {
    const P=ui.currentPrice||{forecast:1.0552,competition:1,vat:0};
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
      afterForecast:["=",{r:"afterCompetition",t:"Итого с учётом конкурсного коэффициента"}," × ",{r:"forecastK:k",t:Number(P.forecast||1.0552).toFixed(4).replace(".",",")}],
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
      if(r.id==="forecastK") k='<input class="forecast-input" value="'+Number((ui.currentPrice||{}).forecast||1.0552).toFixed(4).replace(".",",")+'" aria-label="Прогнозный индекс">';
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
      if(Number.isFinite(v)&&v>0){ui.currentPrice.forecast=v;rerenderContent();}
    };
    select("temporary");
  }


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
    const P=ui.currentPrice||{forecast:1.0552,competition:1,vat:0};
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
    modal.querySelectorAll(".gpr-index-input").forEach(function(input){input.oninput=recalc;});
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
          month:String(mon.month).slice(0,10),
          monthly_index:monthly,
          execution_index:cumulativeStored,
          is_in_period:checked.some(function(x){return x.id===mon.id;})
        });
      }
      state.textContent="Сохраняю…";
      const saveMonths=await client.from("gpr_months").upsert(payload,{onConflict:"id"});
      if(saveMonths.error){state.textContent=saveMonths.error.message;return;}
      const savePlan=await client.from("gpr_plans").update({
        start_month:String(checked[0].month).slice(0,10),
        end_month:String(checked[checked.length-1].month).slice(0,10)
      }).eq("id",plan.id).eq("project_id",dataState.project.id);
      if(savePlan.error){state.textContent=savePlan.error.message;return;}
      await loadProjectData(dataState.project);
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
      await loadProjectData(dataState.project);
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

  function renderSupplySummary() {
    let rows = buildWorkingSummaryRows().filter(function(r){ return passesSearch([r.mark,r.name]); })
      .filter(function(r){return rowPassesColumnFilters({mark:r.mark,name:r.name});});
    rows=sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
    ui.currentGroupKeys = [];
    let body = "";

    function supplyVector(list) {
      let qty = 0, vol = 0;
      list.forEach(function(r) {
        const q = Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);
        qty += q; vol += q*Number(r.volumePerPiece||0);
      });
      return {qty:qty,vol:vol};
    }
    function group(label,list,key,depth) {
      registerGroup(key);
      const v = supplyVector(list);
      return '<tr class="group-row group-toggle" data-group-key="'+esc(key)+'">' +
        '<td colspan="3" class="group-title spec-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>' +
        '<td class="num">'+fmt0(v.qty)+'</td><td class="num">'+fmt(v.vol)+'</td>' +
        '<td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td>' +
        '<td class="num">0</td><td class="num">0</td><td class="num">'+fmt0(v.qty)+'</td><td class="num">'+fmt(v.vol)+'</td><td></td></tr>';
    }

    if (!rows.length) body = tableMessage("Нет строк по текущему фильтру.",14);
    else {
      const root = "supply:root";
      body += group("Всего по дому",rows,root,0);
      if (!ui.collapsed.has(root)) {
        ["Цоколь","Выше 0.000"].forEach(function(zone) {
          const zr = rows.filter(function(r){return r.zone===zone;});
          if (!zr.length) return;
          const zk = "supply:zone:"+zone;
          body += group(zone,zr,zk,1);
          if (ui.collapsed.has(zk)) return;
          Array.from(new Set(zr.map(function(r){return r.sectionName;}))).forEach(function(name) {
            const sr = zr.filter(function(r){return r.sectionName===name;});
            const sk = "supply:section:"+zone+":"+name;
            body += group(name,sr,sk,2);
            if (ui.collapsed.has(sk) || ui.collapseLeaves) return;
            sr.forEach(function(r,index) {
              const q = Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0),v=q*Number(r.volumePerPiece||0);
              body += '<tr class="data-row" data-material-id="'+esc(r.catalogItemId||"")+'"><td class="sticky-1 center">'+(index+1)+'</td>'+
                filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3")+
                '<td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(v)+'</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(v)+'</td><td class="status-cell">Не поставлялось</td></tr>';
            });
          });
        });
      }
    }

    const head = '<thead><tr><th class="sticky-1" rowspan="2">№</th>'+
      '<th class="sticky-2 filterable-head" rowspan="2">'+filterHeader("Марка","mark")+'</th>'+
      '<th class="sticky-3 filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th>'+
      '<th colspan="2">По проекту</th><th colspan="2">Поставлено</th><th colspan="2">На объекте</th><th colspan="2">Смонтировано</th><th colspan="2">Осталось поставить</th><th rowspan="2">Статус</th></tr>'+
      '<tr><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th></tr></thead>';
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table supply-table" data-table-key="supply-summary">' + head + '<tbody>' + body + '</tbody></table></div></div>';
  }

  function renderSupplyDocuments() {
    $("workArea").className = "work-area table-work";
    let docs=(dataState.supplyDocuments||[]).filter(function(d){return passesSearch([d.receipt_date,d.document_type,d.ttn_number,d.status]);});
    let body=docs.map(function(d){
      const lines=(dataState.supplyDocumentLines||[]).filter(function(x){return x.document_id===d.id;});
      const pcs=lines.reduce(function(a,x){return a+Number(x.qty_pieces||0);},0);
      const m3=lines.reduce(function(a,x){return a+Number(x.qty_m3||0);},0);
      const net=lines.reduce(function(a,x){return a+Number(x.amount_net||0);},0);
      const vat=lines.reduce(function(a,x){return a+Number(x.vat_amount||0);},0);
      const gross=lines.reduce(function(a,x){return a+Number(x.amount_gross||0);},0);
      return '<tr class="data-row">'+
        filterCell("date",d.receipt_date,esc(d.receipt_date||""),"")+
        filterCell("type",d.document_type,esc(d.document_type||""),"")+
        filterCell("ttn",d.ttn_number,esc(d.ttn_number||""),"")+
        '<td>—</td><td class="num">'+fmt0(lines.length)+'</td><td class="num">'+fmt(pcs)+'</td><td class="num">'+fmt(m3)+'</td>'+
        '<td class="num">'+money(net)+'</td><td class="num">'+money(vat)+'</td><td class="num">'+money(gross)+'</td><td>'+esc(d.status||"")+'</td></tr>';
    }).join("");
    if(!body) body=tableMessage("Накладных пока нет. Фактические поступления не подменяются тестовыми документами.",11);
    const head='<thead><tr>'+
      '<th class="filterable-head">'+filterHeader("Дата поступления","date")+'</th>'+
      '<th class="filterable-head">'+filterHeader("Тип","type")+'</th>'+
      '<th class="filterable-head">'+filterHeader("№ ТТН","ttn")+'</th>'+
      '<th>Файл</th><th>Позиций</th><th>Шт.</th><th>м³</th><th>Без НДС</th><th>НДС</th><th>С НДС</th><th>Состояние</th></tr></thead>';
    $("workArea").innerHTML =
      '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table supply-doc-table" data-table-key="supply-documents">'+head+
      '<tbody>'+body+'</tbody></table></div></div>';
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
    const singlePrice=distinctPrices.length===1 && !hasReview ? Number(distinctPrices[0].unit_price_gross||0) : null;
    const volume=supplierVolume!=null?supplierVolume:Number(projectVolume||0);
    return {
      items:items,
      prices:distinctPrices,
      supplierVolume:supplierVolume,
      volume:volume,
      state:state,
      singlePrice:singlePrice,
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
    const singlePrice=distinct.length===1 && !review ? Number(distinct[0].unit_price_gross||0) : null;
    const volume=Number(item.unit_volume_m3||0);
    return {
      prices:distinct,state:state,singlePrice:singlePrice,volume:volume,
      perM3:singlePrice!=null && volume>0?singlePrice/volume:null
    };
  }

  function renderSupplierPrice() {
    let rows=buildWorkingSummaryRows().map(function(r){
      return Object.assign({},r,{_price:supplierPriceModel(r.catalogItemId,r.volumePerPiece)});
    }).filter(function(r){
      return passesSearch([r.mark,r.name,r._price.state]);
    }).filter(function(r){
      return rowPassesColumnFilters({mark:r.mark,name:r.name,price:r._price.state});
    });
    rows=sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;},price:function(r){return r._price.state;}});
    ui.currentGroupKeys=[];
    let body="";

    function vector(list){
      let qty=0,vol=0,costPiece=0,costM3=0,pricedQty=0;
      list.forEach(function(r){
        const q=Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);
        qty+=q;
        vol+=q*Number(r._price.volume||0);
        if(r._price.singlePrice!=null){costPiece+=q*r._price.singlePrice;pricedQty+=q;}
        if(r._price.perM3!=null){costM3+=q*Number(r._price.volume||0)*r._price.perM3;}
      });
      return {qty:qty,vol:vol,costPiece:costPiece,costM3:costM3,pricedQty:pricedQty};
    }

    function group(label,list,key,depth){
      registerGroup(key);const v=vector(list);
      return '<tr class="group-row group-toggle" data-group-key="'+esc(key)+'"><td colspan="3" class="group-title spec-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>'+
        '<td class="num">'+fmt0(v.qty)+'</td><td></td><td class="num">'+fmt(v.vol)+'</td>'+
        '<td></td><td class="num">'+(v.pricedQty?money(v.costPiece):"")+'</td>'+
        '<td></td><td class="num">'+(v.pricedQty?money(v.costM3):"")+'</td><td></td></tr>';
    }

    if(!rows.length) body=tableMessage("Нет строк по текущему фильтру.",11);
    else{
      const root="price:root";body+=group("Всего по дому",rows,root,0);
      if(!ui.collapsed.has(root)){
        ["Цоколь","Выше 0.000"].forEach(function(zone){
          const zr=rows.filter(function(r){return r.zone===zone;});if(!zr.length)return;
          const zk="price:zone:"+zone;body+=group(zone,zr,zk,1);if(ui.collapsed.has(zk))return;
          Array.from(new Set(zr.map(function(r){return r.sectionName;}))).forEach(function(name){
            const sr=zr.filter(function(r){return r.sectionName===name;});const sk="price:section:"+zone+":"+name;
            body+=group(name,sr,sk,2);if(ui.collapsed.has(sk) || ui.collapseLeaves)return;
            sr.forEach(function(r,index){
              const q=Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);
              const p=r._price;
              body+='<tr class="data-row" data-material-id="'+esc(r.catalogItemId||"")+'"><td class="sticky-1 center">'+(index+1)+'</td>'+
                filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3")+
                '<td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(p.volume)+'</td><td class="num">'+fmt(q*p.volume)+'</td>'+
                '<td class="num">'+(p.singlePrice==null?"—":money(p.singlePrice))+'</td><td class="num">'+(p.singlePrice==null?"—":money(q*p.singlePrice))+'</td>'+
                '<td class="num">'+(p.perM3==null?"—":money(p.perM3))+'</td><td class="num">'+(p.perM3==null?"—":money(q*p.volume*p.perM3))+'</td>'+
                filterCell("price",p.state,'<span class="price-state '+(p.state==="Проверить"?"review":p.state==="Нет цены"?"none":"ok")+'">'+esc(p.state)+'</span>',"status-cell")+'</tr>';
            });
          });
        });
      }
    }

    const supplierOnly=dataState.supplierItems.filter(function(item){
      return !item.catalog_item_id && passesSearch([item.source_mark,item.source_name,item.link_state]);
    }).filter(function(item){
      const p=supplierOnlyPriceModel(item);
      return rowPassesColumnFilters({mark:item.source_mark,name:item.source_name,price:p.state});
    });

    if(supplierOnly.length){
      const key="price:supplier-only";
      registerGroup(key);
      body+='<tr class="group-row group-toggle" data-group-key="'+key+'"><td colspan="3" class="group-title spec-group-title" style="padding-left:8px"><span class="group-arrow">'+groupArrow(key)+'</span>Только у поставщика</td><td colspan="8"></td></tr>';
      if(!ui.collapsed.has(key) && !ui.collapseLeaves){
        supplierOnly.forEach(function(item,index){
          const p=supplierOnlyPriceModel(item);
          body+='<tr class="data-row supplier-only-row"><td class="sticky-1 center">'+(index+1)+'</td>'+
            filterCell("mark",item.source_mark,esc(item.source_mark),"sticky-2")+
            filterCell("name",item.source_name,esc(item.source_name),"sticky-3")+
            '<td class="num">—</td><td class="num">'+fmt(p.volume)+'</td><td class="num">—</td>'+
            '<td class="num">'+(p.singlePrice==null?"—":money(p.singlePrice))+'</td><td class="num">—</td>'+
            '<td class="num">'+(p.perM3==null?"—":money(p.perM3))+'</td><td class="num">—</td>'+
            filterCell("price",p.state,'<span class="price-state '+(p.state==="Проверить"?"review":"supplier")+'">'+esc(p.state)+'</span>',"status-cell")+'</tr>';
        });
      }
    }

    const linkedProjectRows=rows.filter(function(r){return r._price.items.length>0;}).length;
    const noPriceRows=rows.filter(function(r){return r._price.state==="Нет цены";}).length;
    const stats='<span>Рабочая сводка: '+rows.length+' · связано с прайсом: '+linkedProjectRows+' · без цены: '+noPriceRows+(supplierOnly.length?' · только у поставщика: '+supplierOnly.length:'')+'</span>';
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table price-table" data-table-key="supplier-price-v2">'+
      '<thead><tr><th class="sticky-1" rowspan="2">№</th><th class="sticky-2 filterable-head" rowspan="2">'+filterHeader("Марка","mark")+'</th><th class="sticky-3 filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th><th rowspan="2">Всего, шт.</th>'+
      '<th colspan="2">Объём, м³</th><th colspan="2">Стоимость за 1 шт.</th><th colspan="2">Стоимость за 1 м³</th><th class="filterable-head" rowspan="2">'+filterHeader("Прайс","price")+'</th></tr>'+
      '<tr><th>за ед.</th><th>всего</th><th>за ед.</th><th>всего</th><th>за ед.</th><th>всего</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderMontage(tab) {
    if (tab === 1) {
      $("workArea").className = "work-area content-work";
      $("workArea").innerHTML = '<div class="review-panel"><div class="review-panel-title">3D модель</div><div class="review-note">Раздел зарезервирован. В актуальном ТЗ 3D остаётся placeholder до отдельного этапа.</div></div>';
      return;
    }
    const days = Array.from({length:30},function(_,i){return i+1;});
    const rows = specJoinedRows().filter(function(r){ return passesSearch([r.mark,r.name]) && rowPassesColumnFilters({mark:r.mark,name:r.name}); });
    let body = rows.map(function(r) {
      const floorQty = qtyAt(r,"1");
      return '<tr class="data-row" data-material-id="'+esc(r.catalog_item_id||"")+'"><td class="sticky-1 center">'+esc(r.position_no)+'</td>'+filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3") +
        '<td class="num">'+fmt0(floorQty)+'</td><td class="num">0</td><td class="num">'+fmt0(floorQty)+'</td><td class="num">0</td><td class="num">0</td>' +
        days.map(function(){return '<td class="day-cell"></td>';}).join("") + '</tr>';
    }).join("");
    if (!body) body = tableMessage("Нет строк по текущему поиску.",8+days.length);
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table montage-table"><thead><tr>' +
      '<th class="sticky-1">№</th><th class="sticky-2 filterable-head">'+filterHeader("Марка","mark")+'</th><th class="sticky-3 filterable-head">'+filterHeader("Наименование","name")+'</th><th>На этаж</th><th>Смонтировано</th><th>Остаток</th><th>Поставлено</th><th>Доступно для монтажа</th>' +
      days.map(function(d){return '<th class="day-cell">'+d+'</th>';}).join("") + '</tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

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
    (dataState.gprMonths||[]).forEach(function(x){if(periodKey(x.month)) set.add(periodKey(x.month));});
    const now=new Date();
    for(let i=0;i<12;i++) set.add(now.getFullYear()+"-"+String(i+1).padStart(2,"0"));
    return Array.from(set).sort();
  }

  function monthSelectHtml(value,attr,includeAll) {
    let html=includeAll?'<option value="all"'+(value==="all"?' selected':'')+'>Весь период</option>':"";
    executionPeriods().forEach(function(key){html+='<option value="'+key+'"'+(key===value?' selected':'')+'>'+esc(periodLabel(key,false))+'</option>';});
    return '<select class="execution-select" '+attr+'>'+html+'</select>';
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
    if(version){
      dataState.estimates.forEach(function(estimate){
        const estimateRows=rows.map(function(x){return {fact:x,row:estimateRowMap.get(x.estimate_row_id)};}).filter(function(x){return x.row&&x.row.estimate_id===estimate.id&&passesSearch([x.row.position,x.row.basis,x.row.name]);});
        if(!estimateRows.length) return;
        const estimateKey="avr:"+estimate.id;
        registerGroup(estimateKey);
        body+='<tr class="group-row group-toggle" data-group-key="'+estimateKey+'"><td colspan="6"><span class="group-arrow">'+groupArrow(estimateKey)+'</span>'+esc("Смета №"+estimate.number+" · "+estimate.name)+'</td><td class="num">'+exFmt(estimateRows.reduce(function(s,x){return s+Number(x.fact.quantity||0);},0))+'</td><td class="num">'+exFmt(estimateRows.reduce(function(s,x){return s+Number(x.fact.quantity_m3||0);},0))+'</td><td class="num">'+exMoney(estimateRows.reduce(function(s,x){return s+Number(x.fact.amount||0);},0))+'</td></tr>';
        if(ui.collapsed.has(estimateKey)) return;
        const sections=dataState.estimateSections.filter(function(s){return s.estimate_id===estimate.id;});
        sections.forEach(function(section){
          const sectionRows=estimateRows.filter(function(x){return x.row.section_id===section.id;});
          if(!sectionRows.length) return;
          const sectionKey=estimateKey+":"+section.id;
          registerGroup(sectionKey);
          body+='<tr class="group-row group-toggle group-level-2" data-group-key="'+sectionKey+'"><td colspan="9"><span class="group-arrow">'+groupArrow(sectionKey)+'</span>'+esc(section.title)+'</td></tr>';
          if(ui.collapsed.has(sectionKey)) return;
          sectionRows.forEach(function(x){
            const r=x.row;const f=x.fact;const item=(dataState.catalogItems||[]).find(function(c){return c.id===r.catalog_item_id;});
            body+='<tr class="data-row"><td class="center"><span class="row-type '+(r.row_type==="work"?'work':'material')+'">'+(r.row_type==="work"?'Р':'М')+'</span></td><td class="center">'+esc(r.position||"")+'</td><td>'+esc(estimateDisplayBasis(r))+'</td><td>'+esc(item&&item.mark||"")+'</td><td>'+esc(estimateDisplayName(r))+'</td><td class="center">'+esc(r.unit||"")+'</td><td class="num">'+exFmt(f.quantity)+'</td><td class="num">'+(r.row_type==="material"?exFmt(f.quantity_m3):"—")+'</td><td class="num">'+exMoney(f.amount)+'</td></tr>';
          });
        });
      });
    }
    if(!body) body=tableMessage(doc?"В выбранной версии нет строк АВР.":"Для выбранного месяца АВР ещё не импортирован.",9);
    $("workArea").className="work-area execution-work";
    $("workArea").innerHTML=renderExecutionMetrics([
      {label:"Панелей в акте",value:exFmt0(qty)+" шт.",note:materialRows.length+" позиций"},
      {label:"Объём панелей",value:exFmt(m3)+" м³",note:"по проектным объёмам"},
      {label:"Стоимость по акту",value:exMoney(amount)+" BYN",note:"материалы и связанные работы"},
      {label:"Версия",value:version?"v"+version.version_no:"—",note:avrStatus(version),tone:version&&version.state==="signed"?"ok":""}
    ])+'<div class="engineering-shell execution-table"><div class="engineering-scroll"><table class="eng-table avr-table" data-table-key="avr"><thead><tr><th>Тип</th><th>Поз. сметы</th><th>Обоснование</th><th>Марка</th><th>Наименование</th><th>Ед. изм.</th><th>Кол-во в акте</th><th>Кол-во, м³</th><th>Стоимость по акту</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
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
        if(v.state!=="signed"&&!v.signed_at){
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
    const docs=(dataState.avrDocuments||[]).slice().sort(function(a,b){return String(a.period_month).localeCompare(String(b.period_month));});
    const sources=executionPeriods().map(function(period){
      const doc=docs.find(function(x){return periodKey(x.period_month)===period;})||null;
      return {period:period,doc:doc,version:doc?sourceVersionForDocument(doc):null};
    });
    const factByVersionRow=new Map();
    (dataState.avrRows||[]).forEach(function(x){factByVersionRow.set(x.version_id+":"+x.estimate_row_id,Number(x.quantity||0));});
    const estimates=dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;});
    ui.currentGroupKeys=[];
    let body="";
    estimates.forEach(function(e){
      const rows=dataState.estimateRows.filter(function(r){return r.estimate_id===e.id&&passesSearch([r.position,r.basis,r.name])&&rowPassesColumnFilters({position:r.position,basis:r.basis,name:r.name});});
      if(!rows.length&&currentSearch()) return;
      const key="ks6:"+e.id;registerGroup(key);
      const totalEstimate=rows.reduce(function(s,r){return s+Number(r.quantity||0);},0);
      const monthTotals=sources.map(function(x){return x.version?rows.reduce(function(s,r){return s+(factByVersionRow.get(x.version.id+":"+r.id)||0);},0):0;});
      const accrued=monthTotals.reduce(function(s,v){return s+v;},0);
      body+='<tr class="group-row group-toggle" data-group-key="'+key+'"><td colspan="5"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc("Смета №"+e.number+" · "+e.name)+'</td><td class="num">'+exFmt(totalEstimate)+'</td>'+monthTotals.map(function(v){return '<td class="num">'+exFmt(v)+'</td>';}).join("")+'<td class="num">'+exFmt(accrued)+'</td><td class="num '+(totalEstimate-accrued<0?'warning-num':'')+'">'+exFmt(totalEstimate-accrued)+'</td></tr>';
      if(ui.collapsed.has(key)) return;
      rows.forEach(function(r){
        const values=sources.map(function(x){return x.version?(factByVersionRow.get(x.version.id+":"+r.id)||0):0;});
        const sum=values.reduce(function(s,v){return s+v;},0);const rest=Number(r.quantity||0)-sum;
        body+='<tr class="data-row"><td class="center"><span class="row-type '+(r.row_type==="work"?'work':'material')+'">'+(r.row_type==="work"?'Р':'М')+'</span></td><td>'+esc(r.position)+'</td><td>'+esc(estimateDisplayBasis(r))+'</td><td>'+esc(estimateDisplayName(r))+'</td><td>'+esc(r.unit)+'</td><td class="num">'+exFmt(r.quantity)+'</td>'+values.map(function(v){return '<td class="num">'+exFmt(v)+'</td>';}).join("")+'<td class="num">'+exFmt(sum)+'</td><td class="num '+(rest<0?'warning-num':'')+'">'+(rest<0?'<span class="warning-icon">⚠</span>':'')+exFmt(rest)+'</td></tr>';
      });
    });
    const columnCount=8+sources.length;
    if(!body) body=tableMessage("Нет строк по текущему фильтру.",columnCount);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table ks-table" data-table-key="ks6"><thead><tr><th>Тип</th><th class="filterable-head">'+filterHeader("Поз. сметы","position")+'</th><th class="filterable-head">'+filterHeader("Обоснование","basis")+'</th><th class="filterable-head">'+filterHeader("Наименование","name")+'</th><th>Ед. изм.</th><th>По смете</th>'+sources.map(function(x){return '<th>'+esc(periodLabel(x.period,true))+'</th>';}).join("")+'<th>Запроцентовано</th><th>Остаток</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
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
    $("workArea").className="work-area execution-work";
    $("workArea").innerHTML=renderExecutionMetrics([
      {label:"Панелей по АВР",value:exFmt0(totalPieces)+" шт.",note:rows.length+" позиций"},
      {label:"Норма текущего месяца",value:exFmt(norm)+" м³",note:"по проектным объёмам"},
      {label:"Фактически списано",value:exFmt(actual)+" м³",note:"по бухгалтерскому снимку"},
      {label:"Экономия",value:exFmt(economy)+" м³",note:"переносится далее",tone:economy>0?"warn":""},
      {label:"Перерасход",value:exFmt(overrun)+" м³",note:"контроль списания",tone:overrun>0?"danger":""}
    ])+'<div class="engineering-shell execution-table"><div class="execution-table-title"><strong>Расчёт текущей С-29</strong><span>перерасход и текущий месяц — отдельные строки</span></div><div class="engineering-scroll"><table class="eng-table s29-table"><thead><tr><th>Марка</th><th>Наименование</th><th>Тип строки</th><th>АВР, шт.</th><th>1 шт., м³</th><th>По нормам, м³</th><th>Фактически, м³</th><th>Эконом(+)/перерасход(−)</th><th>Списание, м³</th><th>Месяц происхождения</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderAccounting() {
    const imports=(dataState.imports||[]).filter(function(x){return x.domain==="accounting";}).sort(function(a,b){return String(b.imported_at).localeCompare(String(a.imported_at));});
    let body=imports.map(function(imp){
      const count=(dataState.accountingRows||[]).filter(function(x){return x.import_id===imp.id;}).length;
      const selected=(dataState.accountingPeriodSources||[]).some(function(x){return x.import_id===imp.id;});
      return '<tr class="data-row"><td>'+esc(periodLabel(imp.source_period,false))+'</td><td>'+esc(imp.source_name||"—")+'</td><td>'+dateTimeLabel(imp.imported_at)+'</td><td class="num">'+count+'</td><td><span class="execution-status '+(selected?'in_use':'draft')+'">'+(selected?'Используется':'Снимок')+'</span></td></tr>';
    }).join("");
    if(!body) body=tableMessage("Бухгалтерские отчёты ещё не импортировались.",5);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table"><thead><tr><th>Период</th><th>Файл</th><th>Импортирован</th><th>Строк</th><th>Статус</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderAccountingLinks() {
    const catalog=new Map(dataState.catalogItems.map(function(x){return [x.id,x];}));
    const codes=Array.from(new Set((dataState.accountingRows||[]).map(function(x){return x.material_code;}))).sort();
    let body=codes.map(function(code){
      const rows=(dataState.accountingRows||[]).filter(function(x){return x.material_code===code;});
      const link=(dataState.accountingCodeLinks||[]).find(function(x){return x.accounting_code===code;});const item=link?catalog.get(link.catalog_item_id):null;
      return '<tr class="data-row"><td>'+esc(code)+'</td><td>'+esc(rows[0]&&rows[0].name||"")+'</td><td>'+esc(item&&item.mark||"—")+'</td><td>'+esc(item&&item.name||"Не сопоставлено")+'</td><td>'+esc(link&&link.link_method==="manual"?"Ручная":"Авто")+'</td></tr>';
    }).join("");
    if(!body) body=tableMessage("После импорта бухгалтерии здесь появятся коды для сопоставления.",5);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table"><thead><tr><th>Код материала</th><th>Наименование бухгалтерии</th><th>Марка проекта</th><th>Номенклатура проекта</th><th>Связь</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderCarryovers() {
    const catalog=new Map(dataState.catalogItems.map(function(x){return [x.id,x];}));
    let body=(dataState.s29Carryovers||[]).slice().sort(function(a,b){return String(a.origin_month).localeCompare(String(b.origin_month));}).map(function(x){
      const item=catalog.get(x.catalog_item_id)||{};const settled=(dataState.s29CarryoverSettlements||[]).filter(function(s){return s.carryover_id===x.id;}).reduce(function(sum,s){return sum+Number(s.settled_m3||0);},0);const rest=Number(x.created_m3||0)-settled;
      const months=(dataState.s29CarryoverSettlements||[]).filter(function(s){return s.carryover_id===x.id;}).map(function(s){return periodLabel(s.settlement_month,false);}).join(", ")||"—";
      return '<tr class="data-row"><td>'+esc(periodLabel(x.origin_month,false))+'</td><td>'+esc(item.mark||"")+'</td><td>'+esc(item.name||"")+'</td><td>'+esc(x.kind==="economy"?"Экономия":"Перерасход")+'</td><td class="num">'+exFmt(x.created_m3)+'</td><td class="num">'+exFmt(settled)+'</td><td>'+esc(months)+'</td><td class="num '+(rest>0?'warning-num':'')+'">'+exFmt(rest)+'</td></tr>';
    }).join("");
    if(!body) body=tableMessage("Накопительная экономия и перерасход пока отсутствуют.",8);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table"><thead><tr><th>Месяц возникновения</th><th>Марка</th><th>Наименование</th><th>Вид</th><th>Возникло, м³</th><th>Погашено, м³</th><th>Месяц погашения</th><th>Остаток, м³</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function linkedSpecRowsForEstimateRow(row) {
    const ids=new Set(
      dataState.reconciliationLinks
        .filter(function(l){return l.estimate_row_id===row.id;})
        .map(function(l){return l.specification_row_id;})
    );
    return specJoinedRows().filter(function(sr){return ids.has(sr.id);});
  }

  function estimateQuantityPieces(row,linkedRows) {
    const q=Number(row.quantity);
    if(!Number.isFinite(q)) return null;
    const u=importNorm(row.unit).replace(/\./g,"").replace(/\s+/g,"");
    if(["шт","штука","штук"].includes(u)) return q;
    if(u==="100шт" || u==="100штук") return q*100;
    if(u==="м3" || u==="м³" || u==="кубм"){
      const vols=linkedRows.map(function(x){return Number(x.volumePerPiece||0);});
      if(!vols.length || vols.some(function(v){return !(v>0);})) return null;
      const first=vols[0];
      if(vols.some(function(v){return Math.abs(v-first)>1e-9;})) return null;
      return q/first;
    }
    return null;
  }

  function reconPositionText(rows) {
    const list=rows.map(function(r){return r.position_no;});
    if(!list.length) return "—";
    if(list.length<=4) return list.join(", ");
    return list.slice(0,3).join(", ")+"… ("+list.length+")";
  }

  function renderRecon() {
    if(!ui.reconLinkFilter) ui.reconLinkFilter="all";

    const claimCount=new Map();
    dataState.reconciliationLinks.forEach(function(l){
      claimCount.set(l.specification_row_id,(claimCount.get(l.specification_row_id)||0)+1);
    });

    // The reconciliation grid is specification-first. Every project position exists
    // in the grid even when no estimate row is linked to it.
    let specRows=specJoinedRows().filter(passesSpecFilters).slice().sort(function(a,b){
      return String(a.position_no||"").localeCompare(String(b.position_no||""),"ru",{numeric:true,sensitivity:"base"});
    });

    const viewRows=[];
    specRows.forEach(function(sr){
      const links=dataState.reconciliationLinks.filter(function(l){return l.specification_row_id===sr.id;});
      const estimateRows=links.map(function(l){
        return dataState.estimateRows.find(function(r){return r.id===l.estimate_row_id;});
      }).filter(Boolean);
      if(!estimateRows.length) viewRows.push({spec:sr,estimate:null,link:null});
      else estimateRows.forEach(function(r){
        viewRows.push({spec:sr,estimate:r,link:links.find(function(l){return l.estimate_row_id===r.id;})||null});
      });
    });

    let filtered=viewRows.filter(function(v){
      const r=v.estimate, sr=v.spec;
      const searchValues=[sr.position_no,sr.mark,sr.name];
      if(r) searchValues.push(r.position,estimateDisplayBasis(r),estimateDisplayName(r),r.basis,r.name);
      if(!passesSearch(searchValues)) return false;
      if(!r){
        const filters=filterBucket();
        return !((filters.position&&filters.position.size)||(filters.basis&&filters.basis.size)||(filters.name&&filters.name.size));
      }
      return rowPassesColumnFilters({position:r.position,basis:estimateDisplayBasis(r),name:estimateDisplayName(r)});
    });

    function viewIssue(v){
      const r=v.estimate, sr=v.spec;
      if(!r) return true;
      if((claimCount.get(sr.id)||0)>1) return true;
      const linkedGroup=linkedSpecRowsForEstimateRow(r);
      const estimatePieces=estimateQuantityPieces(r,linkedGroup);
      const projectQty=linkedGroup.reduce(function(sum,x){return sum+Number(x.total||0);},0);
      if(estimatePieces==null || Math.abs(projectQty-estimatePieces)>1e-9) return true;
      return importNorm(sr.name)!==importNorm(String(estimateSourceValue(r,"name")||""));
    }
    if(ui.reconLinkFilter==="unlinked") filtered=filtered.filter(function(v){return !v.estimate;});
    else if(ui.reconLinkFilter==="linked") filtered=filtered.filter(function(v){return !!v.estimate;});
    else if(ui.reconLinkFilter==="issues") filtered=filtered.filter(viewIssue);

    let body=filtered.map(function(v){
      const sr=v.spec, r=v.estimate;
      const projectQty=Number(sr.total||0);
      if(!r){
        return '<tr class="data-row recon-unlinked-spec" data-spec-row="'+esc(sr.id)+'">'+
          '<td class="center">'+esc(sr.position_no||"")+'</td>'+
          '<td>'+esc(sr.mark||"")+'</td>'+
          '<td>'+esc(sr.name||"")+'</td>'+
          '<td class="num">'+fmt0(projectQty)+'</td>'+
          '<td></td><td></td><td></td><td></td><td></td><td></td>'+
          '<td></td>'+
          '<td><span class="soft-status warn">Без связи</span></td>'+
          '<td></td><td></td><td></td>'+
          '<td><button class="table-text-action" type="button" data-recon-spec-edit="'+esc(sr.id)+'">Изменить</button></td>'+
        '</tr>';
      }

      const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
      const linkedGroup=linkedSpecRowsForEstimateRow(r);
      const groupProjectQty=linkedGroup.reduce(function(sum,x){return sum+Number(x.total||0);},0);
      const estimatePieces=estimateQuantityPieces(r,linkedGroup);
      const diff=estimatePieces==null ? null : groupProjectQty-estimatePieces;
      const conflict=(claimCount.get(sr.id)||0)>1;
      const method=v.link && v.link.link_method==="manual" ? "Manual" : "Auto";
      const sourceName=String(estimateSourceValue(r,"name")||"");
      const nameMismatch=importNorm(sr.name)!==importNorm(sourceName);
      const reasons=[];
      if(nameMismatch) reasons.push("Наименование");
      if(estimatePieces==null || Math.abs(diff)>1e-9) reasons.push("Количество");
      const discrepancy=conflict?"Конфликт":(reasons.length?reasons.join(" + "):"Нет");
      const status=conflict?"Конфликт":"Связано";
      const statusClass=conflict?"bad":"ok";
      const accepted=sr.mark||r.basis||"";

      return '<tr class="data-row" data-recon-row="'+esc(r.id)+'" data-spec-row="'+esc(sr.id)+'">'+
        '<td class="center">'+esc(sr.position_no||"")+'</td>'+
        '<td>'+esc(sr.mark||"")+'</td>'+
        '<td>'+esc(sr.name||"")+'</td>'+
        '<td class="num">'+fmt0(projectQty)+'</td>'+
        '<td class="center">'+esc(e?e.number:"")+'</td>'+
        filterCell("position",r.position,esc(r.position),"center")+
        filterCell("basis",r.basis,esc(r.basis),"")+
        '<td>'+esc(accepted)+'</td>'+
        filterCell("name",r.name,esc(r.name),"")+
        '<td class="num">'+(estimatePieces==null?"—":fmt(estimatePieces))+'</td>'+
        '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"warning":"")+'">'+(diff==null?"—":fmt(diff))+'</td>'+
        '<td><span class="soft-status '+statusClass+'">'+status+'</span></td>'+
        '<td>'+method+'</td>'+
        '<td>'+esc(discrepancy)+'</td>'+
        '<td class="center"><input class="table-checkbox" type="checkbox" data-recon-journal="'+esc(r.id)+'" '+(dataState.reconciliationJournal.some(function(j){return j.estimate_row_id===r.id && j.status==="open";})?'checked':'')+' aria-label="Запись в журнале"></td>'+
        '<td><button class="table-text-action" type="button" data-recon-edit="'+esc(r.id)+'">Изменить</button></td>'+
      '</tr>';
    }).join("");

    if(!body)body=tableMessage("Нет строк по текущему фильтру.",16);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table recon-table recon-header-clean" data-table-key="estimate-recon-v6"><thead><tr><th colspan="4">Спецификация</th><th colspan="6">Смета</th><th rowspan="2">Разница</th><th rowspan="2">Сопоставление</th><th rowspan="2">Способ</th><th rowspan="2">Расхождение</th><th rowspan="2">Журнал</th><th rowspan="2">Действия</th></tr>'+
      '<tr><th>Поз. спецификации</th><th>Марка</th><th>Наименование по спецификации</th><th>Проект, шт.</th><th>№ сметы</th><th class="filterable-head">'+filterHeader("Поз. сметы","position")+'</th><th class="filterable-head">'+filterHeader("Обоснование","basis")+'</th><th>Принятое обоснование</th><th class="filterable-head">'+filterHeader("Наименование по смете","name")+'</th><th>Смета, шт.</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
    document.querySelectorAll("[data-recon-spec-edit]").forEach(function(btn){
      btn.onclick=function(){openReconciliationEditorForSpec(btn.dataset.reconSpecEdit);};
    });
  }

   function reconciliationEditorModal() {
    let modal=document.getElementById("reconciliationEditorModal");
    if(modal) return modal;
    modal=document.createElement("div");
    modal.id="reconciliationEditorModal";
    modal.className="spec-import-backdrop";
    modal.innerHTML='<div class="recon-edit-modal"><div class="spec-import-head"><div><strong>Ручное сопоставление</strong><span class="recon-edit-caption">Выберите позиции спецификации для строки сметы</span></div><button class="spec-import-close" type="button">×</button></div><div class="recon-source-card"><div class="recon-block-label">Строка сметы — привязываем</div><div class="recon-source-grid"><div><span>Смета / позиция</span><strong class="recon-source-position"></strong></div><div><span>Обоснование</span><strong class="recon-source-basis"></strong></div><div class="recon-source-name-wrap"><span>Наименование</span><strong class="recon-source-name"></strong></div></div></div><div class="recon-target-head"><strong>Позиции спецификации — выбираем, к чему привязать</strong><span>Можно выбрать несколько позиций</span></div><div class="recon-choice-header"><span></span><span>Поз.</span><span>Марка</span><span>Наименование</span><span>Кол-во</span></div><div class="recon-edit-list"></div><div class="spec-import-foot"><span class="recon-edit-state"></span><span class="spacer"></span><button class="context-link recon-edit-cancel" type="button">Отмена</button><button class="context-link recon-edit-save" type="button">Сохранить</button></div></div>';
    document.body.appendChild(modal);
    const close=function(){modal.classList.remove("open");};
    modal.querySelector(".spec-import-close").onclick=close;
    modal.querySelector(".recon-edit-cancel").onclick=close;
    modal.onclick=function(e){if(e.target===modal) close();};
    modal.querySelector(".recon-edit-save").onclick=saveManualReconciliation;
    const card=modal.querySelector(".recon-edit-modal");
    const handle=modal.querySelector(".spec-import-head");
    handle.addEventListener("mousedown",function(ev){
      if(ev.target.closest("button")) return;
      const rect=card.getBoundingClientRect();
      const dx=ev.clientX-rect.left,dy=ev.clientY-rect.top;
      card.style.position="fixed";card.style.left=rect.left+"px";card.style.top=rect.top+"px";card.style.margin="0";
      handle.classList.add("dragging");
      function move(e){
        const left=Math.max(8,Math.min(window.innerWidth-card.offsetWidth-8,e.clientX-dx));
        const top=Math.max(8,Math.min(window.innerHeight-card.offsetHeight-8,e.clientY-dy));
        card.style.left=left+"px";card.style.top=top+"px";
      }
      function up(){document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);handle.classList.remove("dragging");}
      document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
    });
    return modal;
  }

  function openReconciliationEditorForSpec(specRowId) {
    const sr=specJoinedRows().find(function(x){return x.id===specRowId;});
    if(!sr) return;
    const candidates=dataState.estimateRows.filter(function(r){
      if(r.row_type!=="material") return false;
      const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
      if(!e) return false;
      if(sr.section.is_stairs) return !!e.is_stairs;
      return !e.is_stairs &&
        (!e.building_section || e.building_section===sr.section.building_section) &&
        (!e.zone || e.zone===sr.section.zone);
    });
    const specPeers=specJoinedRows().filter(function(x){
      return x.section && sr.section &&
        x.section.building_section===sr.section.building_section &&
        x.section.zone===sr.section.zone;
    }).sort(function(a,b){return Number(a.sort_order||a.position_no||0)-Number(b.sort_order||b.position_no||0);});
    const specIndex=Math.max(0,specPeers.findIndex(function(x){return x.id===sr.id;}));
    const specRatio=specPeers.length>1?specIndex/(specPeers.length-1):0;
    const ranked=candidates.map(function(r){
      const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
      const peers=dataState.estimateRows.filter(function(x){return x.estimate_id===r.estimate_id&&x.row_type==="material";})
        .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
      const ri=Math.max(0,peers.findIndex(function(x){return x.id===r.id;}));
      const rr=peers.length>1?ri/(peers.length-1):0;
      let score=(1-Math.min(1,Math.abs(specRatio-rr)))*120;
      if(importNorm(estimateSourceValue(r,"basis"))===importNorm(sr.mark)) score+=1000;
      if(importNorm(estimateSourceValue(r,"name"))===importNorm(sr.name)) score+=500;
      const occupied=dataState.reconciliationLinks.some(function(l){return l.estimate_row_id===r.id&&l.specification_row_id!==sr.id;});
      return {row:r,estimate:e,score:score,occupied:occupied};
    }).sort(function(a,b){return b.score-a.score || String(a.estimate.number).localeCompare(String(b.estimate.number),"ru",{numeric:true}) || Number(a.row.sort_order||0)-Number(b.row.sort_order||0);});
    const modal=reconciliationEditorModal();
    const card=modal.querySelector(".recon-edit-modal");
    card.style.position="";card.style.left="";card.style.top="";card.style.margin="";
    modal.dataset.estimateRowId="";
    modal.dataset.specRowId=sr.id;
    modal.querySelector(".spec-import-head strong").textContent="Связь позиции спецификации со сметой";
    modal.querySelector(".recon-edit-caption").textContent="Выберите строку сметы";
    modal.querySelector(".recon-block-label").textContent="Позиция спецификации — привязываем";
    modal.querySelector(".recon-source-position").textContent="Поз. "+sr.position_no+" · "+(sr.section&&sr.section.building_section?sr.section.building_section:"");
    modal.querySelector(".recon-source-basis").textContent=sr.mark||"—";
    modal.querySelector(".recon-source-name").textContent=sr.name||"—";
    modal.querySelector(".recon-target-head strong").textContent="Строки сметы — выбираем";
    modal.querySelector(".recon-target-head span").textContent="Отметьте строку слева и нажмите «Сохранить»";
    const list=modal.querySelector(".recon-edit-list");
    list.innerHTML='<table class="recon-candidate-table"><colgroup><col class="recon-col-pick"><col class="recon-col-est"><col class="recon-col-pos"><col class="recon-col-basis"><col class="recon-col-accepted"><col class="recon-col-name"><col class="recon-col-qty"></colgroup><thead><tr><th>Выбор</th><th>Смета</th><th>Поз.</th><th>Обоснование</th><th>Принятое обоснование</th><th>Наименование</th><th>Кол-во</th></tr></thead><tbody>'+
      ranked.map(function(c,index){
        const basis=estimateSourceValue(c.row,"basis")||"—";
        const accepted=estimateDisplayBasis(c.row)||"—";
        const name=estimateSourceValue(c.row,"name")||"—";
        return '<tr class="recon-candidate-row'+(c.occupied?' is-occupied':'')+'" data-candidate-row>'+
          '<td class="recon-pick-cell"><input type="radio" name="recon-estimate-candidate" data-recon-estimate="'+esc(c.row.id)+'" aria-label="Выбрать строку сметы №'+esc(c.estimate.number)+' позиция '+esc(c.row.position)+'"></td>'+
          '<td>№'+esc(c.estimate.number)+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td>'+
          '<td class="recon-num">'+esc(c.row.position)+'</td>'+
          '<td title="'+esc(basis)+'">'+esc(basis)+'</td>'+
          '<td title="'+esc(accepted)+'">'+esc(accepted)+'</td>'+
          '<td title="'+esc(name)+'">'+esc(name)+(c.occupied?'<small class="recon-table-note occupied">Уже есть связь</small>':'')+'</td>'+
          '<td class="recon-num">'+esc(c.row.quantity==null?"—":fmt(c.row.quantity))+' шт.</td>'+
        '</tr>';
      }).join("")+
    '</tbody></table>';
    modal.querySelector(".recon-choice-header").innerHTML="";
    modal.querySelector(".recon-choice-header").style.display="none";
    const saveBtn=modal.querySelector(".recon-edit-save");
    saveBtn.classList.add("is-disabled");
    saveBtn.setAttribute("aria-disabled","true");
    list.querySelectorAll("[data-candidate-row]").forEach(function(row){
      const input=row.querySelector("[data-recon-estimate]");
      row.addEventListener("click",function(ev){
        if(ev.target!==input){input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));}
      });
      input.addEventListener("change",function(){
        list.querySelectorAll("[data-candidate-row]").forEach(function(r){
          r.classList.toggle("is-selected",!!r.querySelector("[data-recon-estimate]:checked"));
        });
        saveBtn.classList.remove("is-disabled");
        saveBtn.setAttribute("aria-disabled","false");
      });
    });
    modal.querySelector(".recon-edit-state").textContent="";
    modal.classList.add("open");
  }

  function openReconciliationEditor(rowId) {
    const row=dataState.estimateRows.find(function(x){return x.id===rowId;});
    if(!row) return;
    const estimate=dataState.estimates.find(function(x){return x.id===row.estimate_id;});
    if(!estimate) return;
    const estSection=dataState.estimateSections.find(function(x){return x.id===row.section_id;});
    const allSpec=specJoinedRows().filter(function(sr){
      const ss=sr.section;
      if(estimate.is_stairs) return !!ss.is_stairs;
      return !ss.is_stairs &&
        (!estimate.building_section || ss.building_section===estimate.building_section) &&
        (!estimate.zone || ss.zone===estimate.zone);
    });
    const matchingSections=Array.from(new Set(allSpec.filter(function(sr){
      return estSection && importNorm(sr.section.name)===importNorm(estSection.title);
    }).map(function(sr){return sr.section.id;})));
    const scoped=matchingSections.length===1
      ? allSpec.filter(function(sr){return sr.section.id===matchingSections[0];})
      : allSpec;

    const groups=new Map();
    scoped.forEach(function(sr){
      if(!groups.has(sr.catalog_item_id)){
        groups.set(sr.catalog_item_id,{id:sr.catalog_item_id,mark:sr.mark,name:sr.name,rows:[],qty:0});
      }
      const g=groups.get(sr.catalog_item_id);
      g.rows.push(sr); g.qty+=Number(sr.total||0);
    });
    const linkedIds=new Set(
      dataState.reconciliationLinks.filter(function(l){return l.estimate_row_id===row.id;})
        .map(function(l){return l.specification_row_id;})
    );
    const modal=reconciliationEditorModal();
    modal.dataset.specRowId="";
    modal.dataset.estimateRowId=row.id;
    modal.querySelector(".recon-source-position").textContent="№"+estimate.number+" · поз. "+row.position;
    modal.querySelector(".recon-source-basis").textContent=estimateSourceValue(row,"basis")||"—";
    modal.querySelector(".recon-source-name").textContent=estimateSourceValue(row,"name")||"—";
    modal.querySelector(".recon-edit-state").textContent="";
    // Manual reconciliation candidate ranking.
    // Source rows in estimate/specification normally follow approximately the same construction order,
    // so relative row position is a useful tie-breaker, never an automatic persistent link.
    const estimatePeers=dataState.estimateRows.filter(function(x){
      return x.estimate_id===row.estimate_id && x.row_type==="material" &&
        (!row.section_id || x.section_id===row.section_id);
    }).sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);});
    const estimateIndex=Math.max(0,estimatePeers.findIndex(function(x){return x.id===row.id;}));
    const estimateRatio=estimatePeers.length>1 ? estimateIndex/(estimatePeers.length-1) : 0;
    const orderedSpec=scoped.slice().sort(function(a,b){return Number(a.sort_order||a.position_no||0)-Number(b.sort_order||b.position_no||0);});
    function tokenSimilarity(a,b){
      const aa=new Set(importNorm(a).split(/[^a-zа-яё0-9]+/i).filter(Boolean));
      const bb=new Set(importNorm(b).split(/[^a-zа-яё0-9]+/i).filter(Boolean));
      if(!aa.size || !bb.size) return 0;
      let common=0; aa.forEach(function(x){if(bb.has(x)) common++;});
      return common/Math.max(aa.size,bb.size);
    }
    const ranked=Array.from(groups.values()).map(function(g){
      const basis=estimateSourceValue(row,"basis");
      const name=estimateSourceValue(row,"name");
      let score=0;
      const normBasis=importNorm(basis);
      const normName=importNorm(name);
      const normMark=importNorm(g.mark);
      const normSpecName=importNorm(g.name);
      if(normBasis===normMark) score+=1000;
      if(normName===normSpecName) score+=1500;
      if(normMark && normName.includes(normMark)) score+=800;
      if(normSpecName && (normName.includes(normSpecName) || normSpecName.includes(normName))) score+=350;
      score+=tokenSimilarity(name,g.name)*160;
      const indexes=g.rows.map(function(sr){return orderedSpec.findIndex(function(x){return x.id===sr.id;});}).filter(function(i){return i>=0;});
      const specIndex=indexes.length?Math.min.apply(null,indexes):0;
      const specRatio=orderedSpec.length>1 ? specIndex/(orderedSpec.length-1) : 0;
      score+=(1-Math.min(1,Math.abs(estimateRatio-specRatio)))*120;
      return {group:g,score:score};
    }).sort(function(a,b){
      return b.score-a.score || a.group.mark.localeCompare(b.group.mark,"ru");
    });
    modal.querySelector(".spec-import-head strong").textContent="Ручное сопоставление";
    modal.querySelector(".recon-edit-caption").textContent="Выберите позиции спецификации для строки сметы";
    modal.querySelector(".recon-block-label").textContent="Строка сметы — привязываем";
    modal.querySelector(".recon-target-head strong").textContent="Позиции спецификации — выбираем, к чему привязать";
    modal.querySelector(".recon-target-head span").textContent="Можно выбрать несколько позиций";
    const header=modal.querySelector(".recon-choice-header");
    header.innerHTML="";
    header.style.display="none";
    const list=modal.querySelector(".recon-edit-list");
    list.innerHTML=ranked.length
      ? '<table class="recon-spec-candidate-table"><colgroup><col class="recon-spec-col-pick"><col class="recon-spec-col-pos"><col class="recon-spec-col-mark"><col class="recon-spec-col-name"><col class="recon-spec-col-qty"></colgroup><thead><tr><th>Выбор</th><th>Поз.</th><th>Марка</th><th>Наименование</th><th>Кол-во</th></tr></thead><tbody>'+
        ranked.map(function(candidate,index){
          const g=candidate.group;
          const checked=g.rows.some(function(sr){return linkedIds.has(sr.id);});
          const positions=g.rows.map(function(sr){return sr.position_no;});
          const positionText=positions.length<=3?positions.join(", "):positions.slice(0,2).join(", ")+"…";
          return '<tr class="recon-spec-candidate-row'+(checked?' is-selected':'')+'" data-recon-spec-row>'+
            '<td class="recon-spec-pick-cell"><input type="checkbox" data-recon-catalog="'+esc(g.id)+'" '+(checked?'checked':'')+' aria-label="Выбрать позицию '+esc(g.mark)+'"></td>'+
            '<td class="recon-num">'+esc(positionText||"—")+'</td>'+
            '<td class="recon-spec-mark">'+esc(g.mark)+(index===0?'<small class="recon-table-note">Предлагаем</small>':'')+'</td>'+
            '<td title="'+esc(g.name)+'">'+esc(g.name)+'</td>'+
            '<td class="recon-num">'+fmt0(g.qty)+' шт.</td>'+
          '</tr>';
        }).join("")+
        '</tbody></table>'
      : '<div class="empty-note">В области этой сметы нет проектных позиций.</div>';
    list.querySelectorAll("[data-recon-spec-row]").forEach(function(candidateRow){
      const input=candidateRow.querySelector("[data-recon-catalog]");
      candidateRow.addEventListener("click",function(ev){
        if(ev.target!==input){
          input.checked=!input.checked;
          input.dispatchEvent(new Event("change",{bubbles:true}));
        }
      });
      input.addEventListener("change",function(){
        candidateRow.classList.toggle("is-selected",input.checked);
      });
    });
    modal.classList.add("open");
  }

  async function saveManualReconciliation() {
    const modal=reconciliationEditorModal();
    const specRowId=modal.dataset.specRowId||"";
    if(specRowId){
      const chosen=modal.querySelector("[data-recon-estimate]:checked");
      const state=modal.querySelector(".recon-edit-state");
      if(!chosen){state.textContent="Выберите строку сметы.";return;}
      state.textContent="Сохраняю…";
      try{
        const result=await client.rpc("set_manual_reconciliation",{
          p_estimate_row_id:chosen.dataset.reconEstimate,
          p_specification_row_ids:[specRowId]
        });
        if(result.error) throw result.error;
        await loadProjectData(dataState.project);
        modal.dataset.specRowId="";
        modal.classList.remove("open");
        renderPage("recon",0);
      }catch(err){state.textContent=err&&err.message?err.message:String(err);}
      return;
    }
    const rowId=modal.dataset.estimateRowId;
    const selectedCatalogs=new Set(
      Array.from(modal.querySelectorAll("[data-recon-catalog]:checked")).map(function(x){return x.dataset.reconCatalog;})
    );
    const row=dataState.estimateRows.find(function(x){return x.id===rowId;});
    const estimate=row && dataState.estimates.find(function(x){return x.id===row.estimate_id;});
    const estSection=row && dataState.estimateSections.find(function(x){return x.id===row.section_id;});
    if(!row || !estimate) return;
    let scoped=specJoinedRows().filter(function(sr){
      const ss=sr.section;
      if(estimate.is_stairs) return !!ss.is_stairs;
      return !ss.is_stairs &&
        (!estimate.building_section || ss.building_section===estimate.building_section) &&
        (!estimate.zone || ss.zone===estimate.zone);
    });
    const matchingSections=Array.from(new Set(scoped.filter(function(sr){
      return estSection && importNorm(sr.section.name)===importNorm(estSection.title);
    }).map(function(sr){return sr.section.id;})));
    if(matchingSections.length===1) scoped=scoped.filter(function(sr){return sr.section.id===matchingSections[0];});
    const ids=scoped.filter(function(sr){return selectedCatalogs.has(sr.catalog_item_id);}).map(function(sr){return sr.id;});
    const state=modal.querySelector(".recon-edit-state");
    state.textContent="Сохраняю…";
    try{
      const result=await client.rpc("set_manual_reconciliation",{
        p_estimate_row_id:rowId,
        p_specification_row_ids:ids
      });
      if(result.error) throw result.error;
      await loadProjectData(dataState.project);
      modal.classList.remove("open");
      renderPage("recon",0);
    }catch(err){
      state.textContent=err&&err.message?err.message:String(err);
    }
  }

  async function setReconciliationJournal(rowId,enabled,input) {
    const row=dataState.estimateRows.find(function(x){return x.id===rowId;});
    if(!row || !dataState.project) return;
    input.disabled=true;
    try{
      const existing=dataState.reconciliationJournal.filter(function(j){return j.estimate_row_id===rowId && j.status==="open";});
      if(enabled){
        if(!existing.length){
          const linked=linkedSpecRowsForEstimateRow(row);
          const projectQty=linked.reduce(function(sum,x){return sum+Number(x.total||0);},0);
          const estimatePieces=estimateQuantityPieces(row,linked);
          const reasons=[];
          if(!linked.length) reasons.push("Без связи");
          if(estimatePieces==null) reasons.push("Количество сметы не приведено к шт.");
          else if(Math.abs(projectQty-estimatePieces)>1e-9) reasons.push("Расхождение количества");
          const specNames=Array.from(new Set(linked.map(function(x){return x.name;})));
          if(specNames.length===1 && importNorm(specNames[0])!==importNorm(estimateSourceValue(row,"name"))) reasons.push("Расхождение наименования");
          if(!reasons.length) reasons.push("Добавлено пользователем");
          const payload={
            project_id:dataState.project.id,
            estimate_row_id:row.id,
            issue_key:"estimate:"+row.id,
            reasons:reasons,
            status:"open",
            snapshot:{
              estimate_id:row.estimate_id,
              estimate_position:row.position,
              estimate_basis:estimateSourceValue(row,"basis"),
              estimate_name:estimateSourceValue(row,"name"),
              estimate_quantity_pieces:estimatePieces,
              specification_positions:linked.map(function(x){return x.position_no;}),
              specification_marks:Array.from(new Set(linked.map(function(x){return x.mark;}))),
              specification_names:specNames,
              project_quantity_pieces:projectQty,
              difference_pieces:estimatePieces==null?null:projectQty-estimatePieces
            }
          };
          const result=await client.from("reconciliation_journal").insert(payload).select("id,estimate_row_id,specification_row_id,issue_key,reasons,proposal,comment,status,snapshot,created_at,updated_at").single();
          if(result.error) throw result.error;
          dataState.reconciliationJournal.unshift(result.data);
        }
      }else if(existing.length){
        const ids=existing.map(function(x){return x.id;});
        const result=await client.from("reconciliation_journal").delete().in("id",ids);
        if(result.error) throw result.error;
        dataState.reconciliationJournal=dataState.reconciliationJournal.filter(function(j){return !ids.includes(j.id);});
      }
      rerenderContent();
    }catch(err){
      console.error(err);
      input.checked=!enabled;
      alert("Не удалось изменить Журнал: "+(err.message||err));
    }finally{
      input.disabled=false;
    }
  }

  function wireReconciliationControls() {
    const linkSelect=document.querySelector("[data-recon-link-select]");
    if(linkSelect) linkSelect.onchange=function(){
      ui.reconLinkFilter=linkSelect.value||"all";
      rerenderContent();
    };
    document.querySelectorAll("[data-recon-edit]").forEach(function(btn){
      btn.onclick=function(){openReconciliationEditor(btn.dataset.reconEdit);};
    });
    document.querySelectorAll("[data-recon-journal]").forEach(function(input){
      input.onchange=function(){setReconciliationJournal(input.dataset.reconJournal,input.checked,input);};
    });
  }

  function journalNameDiffHtml(left,right) {
    const a=String(left||""), b=String(right||"");
    const na=importNorm(a), nb=importNorm(b);
    if(!a) return "—";
    if(na===nb) return esc(a);
    const aw=a.split(/(\s+|[-–—,.;:()\/]+)/), bw=b.split(/(\s+|[-–—,.;:()\/]+)/);
    const bTokens=new Set(bw.map(function(x){return importNorm(x);}).filter(Boolean));
    return aw.map(function(x){
      const n=importNorm(x);
      if(!n || /^\s+$|^[-–—,.;:()\/]+$/.test(x)) return esc(x);
      return bTokens.has(n)?esc(x):'<mark class="journal-diff-text">'+esc(x)+'</mark>';
    }).join("");
  }

  function journalDiscrepancyLabel(specName,estimateName,diff,linked) {
    const nameDiff=linked && importNorm(specName)!==importNorm(estimateName);
    const qtyDiff=diff!=null && Math.abs(Number(diff))>1e-9;
    if(!linked) return "Без связи";
    if(nameDiff && qtyDiff) return "Наименование + количество";
    if(nameDiff) return "Наименование";
    if(qtyDiff) return "Количество";
    return "Нет";
  }

  function renderEstimateJournal() {
    const rows=(dataState.reconciliationJournal||[]).filter(function(j){return j.status==="open";});
    let body=rows.map(function(j){
      const r=dataState.estimateRows.find(function(x){return x.id===j.estimate_row_id;});
      const e=r?dataState.estimates.find(function(x){return x.id===r.estimate_id;}):null;
      const snap=j.snapshot||{};
      const srows=r?linkedSpecRowsForEstimateRow(r):[];
      const linked=srows.length>0 || (snap.specification_positions||[]).length>0;
      const positions=srows.length?srows.map(function(x){return x.position_no;}):(snap.specification_positions||[]);
      const marks=srows.length?Array.from(new Set(srows.map(function(x){return x.mark;}))):(snap.specification_marks||[]);
      const specNames=srows.length?Array.from(new Set(srows.map(function(x){return x.name;}))):(snap.specification_names||[]);
      const specName=specNames.join(" / ");
      const estimateName=r?String(estimateSourceValue(r,"name")||""):String(snap.estimate_name||"");
      const projectQty=srows.length?srows.reduce(function(sum,x){return sum+Number(x.total||0);},0):(snap.project_quantity_pieces==null?null:Number(snap.project_quantity_pieces));
      const estimateQty=r?estimateQuantityPieces(r,srows):snap.estimate_quantity_pieces;
      const diff=projectQty==null||estimateQty==null?null:Number(projectQty)-Number(estimateQty);
      const discrepancy=journalDiscrepancyLabel(specName,estimateName,diff,linked);
      return '<tr class="data-row">'+
        '<td title="'+esc(positions.join(", "))+'">'+esc(positions.length?(positions.length<=3?positions.join(", "):positions.slice(0,2).join(", ")+"…"):"—")+'</td>'+
        '<td>'+esc(marks.length?marks.join(" / "):"—")+'</td>'+
        '<td class="journal-name-cell">'+journalNameDiffHtml(specName,estimateName)+'</td>'+
        '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(projectQty==null?"—":fmt(projectQty))+'</td>'+
        '<td class="center">'+esc(e?e.number:"—")+'</td>'+
        '<td class="center">'+esc(r?r.position:(snap.estimate_position||"—"))+'</td>'+
        '<td class="journal-name-cell">'+journalNameDiffHtml(estimateName,specName)+'</td>'+
        '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(estimateQty==null?"—":fmt(estimateQty))+'</td>'+
        '<td class="num '+(diff!=null&&Math.abs(diff)>1e-9?"journal-diff-number":"")+'">'+(diff==null?"—":fmt(diff))+'</td>'+
        '<td>'+esc(discrepancy)+'</td>'+
        '<td><button class="table-text-action" type="button" data-journal-remove="'+esc(j.id)+'">Убрать</button></td>'+
      '</tr>';
    }).join("");
    if(!body) body=tableMessage("В журнал ещё не добавлены контрольные записи.",11);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table journal-table" data-table-key="reconciliation-journal-v2"><thead><tr><th colspan="4">Спецификация</th><th colspan="4">Смета</th><th colspan="3">Контроль</th></tr><tr><th>Поз. спецификации</th><th>Марка</th><th>Наименование по спецификации</th><th>Проект, шт.</th><th>№ сметы</th><th>Поз. сметы</th><th>Наименование по смете</th><th>Смета, шт.</th><th>Разница</th><th>Расхождение</th><th>Действия</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
    document.querySelectorAll("[data-journal-remove]").forEach(function(btn){
      btn.onclick=async function(){
        const j=dataState.reconciliationJournal.find(function(x){return x.id===btn.dataset.journalRemove;});
        if(!j) return;
        btn.disabled=true;
        try{
          const result=await client.from("reconciliation_journal").delete().eq("id",j.id);
          if(result.error) throw result.error;
          dataState.reconciliationJournal=dataState.reconciliationJournal.filter(function(x){return x.id!==j.id;});
          rerenderContent();
        }catch(err){console.error(err);alert("Не удалось убрать запись из Журнала: "+(err.message||err));btn.disabled=false;}
      };
    });
  }

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
    if (pageKey === "links") return renderSimple("Связи работ");
    if (pageKey === "import") return renderSimple("Импорт");
    if (pageKey === "docs") return renderSimple("Документы");
    if (pageKey === "settings") return renderSimple("Настройки");
    return renderSimple("Раздел");
  }

  function wireContextControls() {
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
    const result=await client.rpc("set_avr_version_state",{p_project_id:dataState.project.id,p_version_id:versionId,p_action:action});
    if(result.error) throw result.error;
    await loadProjectData(dataState.project);
    renderPage("avr",1);
  }

  function detectWorkbookPeriod(rows,expectedKey) {
    const months={"январ":"01","феврал":"02","март":"03","апрел":"04","мая":"05","май":"05","июн":"06","июл":"07","август":"08","сентябр":"09","октябр":"10","ноябр":"11","декабр":"12"};
    const found=new Set();
    rows.forEach(function(entry){
      entry.values.forEach(function(value){
        const text=String(value==null?"":value).toLowerCase();
        Object.keys(months).forEach(function(stem){
          const match=text.match(new RegExp(stem+"[^0-9]{0,12}(20[0-9]{2})"));
          if(match) found.add(match[1]+"-"+months[stem]);
        });
        const iso=text.match(/(20[0-9]{2})[-./](0?[1-9]|1[0-2])(?:[-./][0-3]?[0-9])?/);
        if(iso) found.add(iso[1]+"-"+String(Number(iso[2])).padStart(2,"0"));
        const ru=text.match(/(?:^|\D)(?:[0-3]?\d)[./-](0?[1-9]|1[0-2])[./-](20[0-9]{2})(?:\D|$)/);
        if(ru) found.add(ru[2]+"-"+String(Number(ru[1])).padStart(2,"0"));
      });
    });
    if(found.has(expectedKey)) return expectedKey;
    return found.size===1?Array.from(found)[0]:"";
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

  async function parseAvrWorkbook(file,expectedKey) {
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
    rows.some(function(entry){
      const text=entry.values.map(function(x){return String(x==null?"":x);}).join(" ");
      const match=text.match(/(?:акт|с-?2а)[^№0-9]{0,18}№?\s*([0-9][0-9\/-]*)/i);
      if(match){actNo=match[1];return true;}return false;
    });
    if(!actNo) throw new Error("Не удалось прочитать номер АВР из шапки файла.");
    const estimateByNumber=new Map(dataState.estimates.map(function(x){return [String(x.number),x];}));
    const basisMap=new Map();
    dataState.estimateRows.filter(function(x){return x.row_type==="material";}).forEach(function(row){
      const key=importNorm(estimateSourceValue(row,"basis"));
      if(!basisMap.has(key)) basisMap.set(key,[]);basisMap.get(key).push(row);
    });
    const parsed=[];const errors=[];let currentEstimate=null;
    rows.forEach(function(entry,rowIndex){
      const joined=entry.values.map(function(x){return String(x==null?"":x);}).join(" ");
      const estimateMatch=joined.match(/локальн\S*\s+смет\S*\s*№\s*([0-9]+)/i);
      if(estimateMatch) currentEstimate=estimateByNumber.get(estimateMatch[1])||null;
      entry.values.forEach(function(cell,basisIndex){
        const key=importNorm(cell);
        let candidates=basisMap.get(key)||[];
        if(currentEstimate) candidates=candidates.filter(function(x){return x.estimate_id===currentEstimate.id;});
        if(candidates.length>1){
          const rowPosition=entry.values.map(function(x){return String(x==null?"":x).trim();});
          candidates=candidates.filter(function(x){return rowPosition.includes(String(x.position));});
        }
        if(candidates.length!==1) return;
        const estimateRow=candidates[0];
        if(parsed.some(function(x){return x.estimate_row_id===estimateRow.id;})) return;
        const numeric=[];
        entry.values.forEach(function(value,columnIndex){
          const number=typeof value==="number"?value:Number(String(value==null?"":value).replace(/\s/g,"").replace(",","."));
          if(Number.isFinite(number)&&number>=0&&columnIndex!==basisIndex) numeric.push({value:number,columnIndex:columnIndex,score:headerScore(rows,rowIndex,columnIndex)+(columnIndex>basisIndex?1:0)});
        });
        numeric.sort(function(a,b){return b.score-a.score||a.columnIndex-b.columnIndex;});
        const chosen=numeric[0];
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
      await loadProjectData(dataState.project);
      renderPage("avr",0);
    }catch(err){alert("Импорт АВР остановлен:\n"+(err&&err.message?err.message:String(err)));if(control) control.disabled=false;}
  }

  function accountingHeaderIndex(values,patterns) {
    return values.findIndex(function(value){const text=importNorm(value);return patterns.some(function(pattern){return pattern.test(text);});});
  }

  async function parseAccountingWorkbook(file,expectedKey) {
    if(!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:"array",cellDates:true,cellFormula:false});
    const all=[];
    workbook.SheetNames.forEach(function(sheet){
      XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,defval:null,raw:true,blankrows:false}).forEach(function(values,index){all.push({sheet:sheet,rowNo:index+1,values:values});});
    });
    const detected=detectWorkbookPeriod(all,expectedKey);
    if(!detected) throw new Error("Не удалось определить месяц бухгалтерского отчёта.");
    if(detected!==expectedKey) throw new Error("В отчёте указан "+periodLabel(detected,false)+", а выбран "+periodLabel(expectedKey,false)+".");
    let headerAt=-1,columns=null;
    for(let i=0;i<all.length;i++){
      const cells=all[i].values;
      const name=accountingHeaderIndex(cells,[/наимен/]);
      const code=accountingHeaderIndex(cells,[/код.*материал/,/материал.*код/,/номенклатур.*код/,/^код$/]);
      const qty=accountingHeaderIndex(cells,[/колич/,/списан/,/расход/]);
      if(name>=0&&code>=0&&qty>=0){
        headerAt=i;columns={name:name,code:code,qty:qty,account:accountingHeaderIndex(cells,[/счет/,/счёт/]),unit:accountingHeaderIndex(cells,[/ед.*изм/,/^ед$/]),price:accountingHeaderIndex(cells,[/цен/]),amount:accountingHeaderIndex(cells,[/сумм/,/стоим/])};break;
      }
    }
    if(headerAt<0) throw new Error("Не найдена таблица с колонками Код материала, Наименование и Количество.");
    const rows=[];
    for(let i=headerAt+1;i<all.length;i++){
      const entry=all[i];const code=String(entry.values[columns.code]||"").trim();const name=String(entry.values[columns.name]||"").trim();
      const qty=Number(String(entry.values[columns.qty]==null?"":entry.values[columns.qty]).replace(/\s/g,"").replace(",","."));
      if(!code&&!name) continue;
      if(!code||!name||!Number.isFinite(qty)) continue;
      const numberAt=function(index){if(index<0)return null;const value=Number(String(entry.values[index]==null?"":entry.values[index]).replace(/\s/g,"").replace(",","."));return Number.isFinite(value)?value:null;};
      rows.push({source_row_no:entry.rowNo,account_code:columns.account>=0?String(entry.values[columns.account]||"").trim():null,material_code:code,name:name,unit:columns.unit>=0?String(entry.values[columns.unit]||"").trim():null,quantity:qty,unit_price:numberAt(columns.price),amount:numberAt(columns.amount),raw_data:{sheet:entry.sheet,row:entry.values}});
    }
    if(!rows.length) throw new Error("После проверки в бухгалтерском отчёте не осталось строк материалов.");
    return {buffer:buffer,rows:rows};
  }

  async function importAccountingFile(file,period) {
    const button=document.querySelector("[data-accounting-import]");if(button)button.disabled=true;
    try{
      const parsed=await parseAccountingWorkbook(file,period);const hash=await sha256Hex(parsed.buffer);
      const result=await client.rpc("apply_accounting_import",{p_project_id:dataState.project.id,p_period_month:periodDate(period),p_source_name:file.name,p_source_sha256:hash,p_rows:parsed.rows});
      if(result.error) throw result.error;
      await loadProjectData(dataState.project);renderPage("s29",1);
    }catch(err){alert("Импорт бухгалтерии остановлен:\n"+(err&&err.message?err.message:String(err)));if(button)button.disabled=false;}
  }

  async function calculateS29() {
    const button=document.querySelector("[data-s29-calculate]");if(button)button.disabled=true;
    try{
      const result=await client.rpc("recalculate_s29",{p_project_id:dataState.project.id,p_period_month:periodDate(ui.s29.period)});
      if(result.error) throw result.error;
      await loadProjectData(dataState.project);renderPage("s29",0);
    }catch(err){alert("Расчёт С-29 не выполнен:\n"+(err&&err.message?err.message:String(err)));if(button)button.disabled=false;}
  }

  async function fixS29(documentId) {
    const ok=await executionConfirm("Фиксация С-29","Расчёт месяца станет неизменяемым снимком, а экономия и её погашение будут записаны в накопительный реестр.","Зафиксировать С-29");
    if(!ok) return;
    const result=await client.rpc("fix_s29",{p_project_id:dataState.project.id,p_document_id:documentId});
    if(result.error) throw result.error;
    await loadProjectData(dataState.project);renderPage("s29",0);
  }

  function exportS29Excel() {
    if(!window.XLSX) return alert("Модуль Excel не загрузился.");
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
    const s29=document.querySelector("[data-s29-period]");
    if(s29) s29.onchange=function(){ui.s29.period=s29.value;localStorage.setItem("filimonova.s29.period",s29.value);renderPage("s29",0);};
    const accountingPeriod=document.querySelector("[data-accounting-period]");
    if(accountingPeriod) accountingPeriod.onchange=function(){ui.s29.period=accountingPeriod.value;localStorage.setItem("filimonova.s29.period",accountingPeriod.value);renderPage("s29",1);};
    const accountingButton=document.querySelector("[data-accounting-import]");const accountingFile=document.querySelector("[data-accounting-file]");
    if(accountingButton&&accountingFile){accountingButton.onclick=function(){accountingFile.click();};accountingFile.onchange=function(){const file=accountingFile.files&&accountingFile.files[0];if(file)importAccountingFile(file,ui.s29.period);};}
    const calculate=document.querySelector("[data-s29-calculate]");if(calculate)calculate.onclick=calculateS29;
    const fix=document.querySelector("[data-s29-fix]");if(fix)fix.onclick=function(){fix.disabled=true;fixS29(fix.dataset.s29Fix).catch(function(err){alert(err.message||err);fix.disabled=false;});};
    const excel=document.querySelector("[data-s29-excel]");if(excel)excel.onclick=exportS29Excel;
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
    $("serviceLeft").innerHTML = buildServiceLeft(pageKey,tab);
    $("serviceRow").classList.toggle("hidden",pageKey==="estimates" && (tab===1 || tab===2));
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

    if (previousScroll && previousPage === pageKey && previousTab === tab) {
      const nextScroller = document.querySelector("#workArea .engineering-scroll");
      if (nextScroller) {
        nextScroller.scrollLeft = previousScroll.left;
        nextScroller.scrollTop = previousScroll.top;
      }
    }
  }

  tabLogin.addEventListener("click",function(){switchAuthTab("login");});
  tabSignup.addEventListener("click",function(){switchAuthTab("signup");});

  loginForm.addEventListener("submit",async function(e) {
    e.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(loginStatus,"Вход…");
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const result = await client.auth.signInWithPassword({email:email,password:password});
    button.disabled = false;
    if (result.error) return setStatus(loginStatus,result.error.message,"error");
    setStatus(loginStatus,"Вход выполнен.","ok");
  });

  signupForm.addEventListener("submit",async function(e) {
    e.preventDefault();
    const button = signupForm.querySelector('button[type="submit"]');
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;
    const password2 = $("signupPassword2").value;
    if (password !== password2) return setStatus(signupStatus,"Пароли не совпадают.","error");
    if (password.length < 6) return setStatus(signupStatus,"Пароль должен содержать не менее 6 символов.","error");
    button.disabled = true;
    setStatus(signupStatus,"Создание учётной записи…");
    const redirectTo = window.location.origin + window.location.pathname;
    const result = await client.auth.signUp({email:email,password:password,options:{emailRedirectTo:redirectTo}});
    button.disabled = false;
    if (result.error) return setStatus(signupStatus,result.error.message,"error");
    setStatus(signupStatus,result.data.session ? "Учётная запись создана." : "Учётная запись создана. Подтвердите email по ссылке из письма, затем войдите.","ok");
  });

  async function logout() {
    await client.auth.signOut();
  }
  $("logoutBtn").addEventListener("click",logout);
  $("deniedLogoutBtn").addEventListener("click",logout);

  const sidebarKey = "filimonova:ui:sidebar-collapsed";
  function syncSidebarState() {
    const collapsed = document.body.classList.contains("sidebar-collapsed");
    const toggle = $("sidebarToggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded",collapsed ? "false" : "true");
      const label = toggle.querySelector("span");
      if (label) label.textContent = collapsed ? "Развернуть" : "Свернуть";
      toggle.title = collapsed ? "Развернуть меню" : "Свернуть меню";
    }
  }
  if (localStorage.getItem(sidebarKey) === "1") document.body.classList.add("sidebar-collapsed");
  document.querySelectorAll(".nav-btn").forEach(function(btn) {
    const label=btn.querySelector("span");
    if(label) btn.title=label.textContent.trim();
    btn.addEventListener("click",function(){renderPage(btn.dataset.page);});
  });
  const sidebarToggle=$("sidebarToggle");
  if(sidebarToggle) {
    sidebarToggle.addEventListener("click",function() {
      document.body.classList.toggle("sidebar-collapsed");
      localStorage.setItem(sidebarKey,document.body.classList.contains("sidebar-collapsed") ? "1" : "0");
      syncSidebarState();
    });
  }
  syncSidebarState();

  $("searchInput").addEventListener("input",function() {
    const key = currentViewKey();
    ui.search[key] = $("searchInput").value;
    $("globalSearch").classList.toggle("has-value",!!$("searchInput").value);
    rerenderContent();
  });
  $("searchClear").addEventListener("click",function() {
    const key = currentViewKey();
    ui.search[key] = "";
    $("searchInput").value = "";
    $("globalSearch").classList.remove("has-value");
    rerenderContent();
    $("searchInput").focus();
  });

  async function isAdmin(userId) {
    const result = await client.from("app_admins").select("user_id").eq("user_id",userId).maybeSingle();
    if (result.error) throw result.error;
    return !!result.data;
  }

  async function ensureProject(user) {
    let result = await client.from("projects").select("id,code,name,status,created_at").eq("code",cfg.projectCode).limit(1);
    if (result.error) throw result.error;
    if (result.data && result.data.length) return result.data[0];

    result = await client.from("projects").insert({
      code:cfg.projectCode,
      name:cfg.projectName,
      created_by:user.id,
      status:"active"
    }).select("id,code,name,status,created_at").single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function renderSession(session) {
    if (reviewMode) {
      if (!session || !session.user) {
        appView.classList.add("hidden");
        deniedView.classList.add("hidden");
        authView.classList.remove("hidden");
        return;
      }
      authView.classList.add("hidden");
      deniedView.classList.add("hidden");
      try {
        const admin = await isAdmin(session.user.id);
        ui.isAdmin=!!admin;
        if (!admin) {
          appView.classList.add("hidden");
          deniedView.classList.remove("hidden");
          return;
        }
        const project = await ensureProject(session.user);
        await loadProjectData(project);
        $("userEmail").textContent = session.user.email || "—";
        $("adminState").textContent = "Глобальный администратор";
        $("projectName").textContent = project.name || cfg.projectName;
        $("projectStatus").textContent = "База готова к импорту";
        $("projectId").textContent = project.id;
        appView.classList.remove("hidden");
      } catch (err) {
        appView.classList.add("hidden");
        deniedView.classList.remove("hidden");
        deniedView.querySelector(".auth-subtitle").textContent = "Ошибка доступа: " + (err && err.message ? err.message : String(err));
        return;
      }
      renderPage(ui.page);
      return;
    }

    if (!session || !session.user) {
      appView.classList.add("hidden");
      deniedView.classList.add("hidden");
      authView.classList.remove("hidden");
      return;
    }

    authView.classList.add("hidden");
    deniedView.classList.add("hidden");

    try {
      const admin = await isAdmin(session.user.id);
      ui.isAdmin=!!admin;
      if (!admin) {
        appView.classList.add("hidden");
        deniedView.classList.remove("hidden");
        return;
      }
      const project = await ensureProject(session.user);
      await loadProjectData(project);

      $("userEmail").textContent = session.user.email || "—";
      $("adminState").textContent = "Глобальный администратор";
      $("projectName").textContent = project.name || cfg.projectName;
      $("projectId").textContent = project.id;
      $("projectStatus").textContent = project.status || "active";

      appView.classList.remove("hidden");
      renderPage(ui.page);
    } catch (err) {
      appView.classList.add("hidden");
      deniedView.classList.remove("hidden");
      deniedView.querySelector(".auth-subtitle").textContent = "Ошибка доступа: " + (err && err.message ? err.message : String(err));
    }
  }

  client.auth.onAuthStateChange(function(event,session) {
    // getSession() below owns the initial bootstrap. Re-running the full project load
    // for INITIAL_SESSION or routine token refreshes caused overlapping Supabase reads.
    if(event==="INITIAL_SESSION") return;
    if(event==="TOKEN_REFRESHED" && dataState.loaded) return;
    setTimeout(function(){renderSession(session);},0);
  });

  client.auth.getSession().then(function(result){renderSession(result.data.session);});
})();
