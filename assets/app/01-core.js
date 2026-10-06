// The app is split into plain scripts loaded in order from index.html (no build step).
// Their top-level declarations share the global scope, so later files use names from earlier ones.

const cfg = window.FILIMONOVA_CONFIG;
if (!cfg || !window.supabase) {
  document.body.innerHTML = '<div style="padding:24px;font-family:Segoe UI">Ошибка загрузки конфигурации.</div>';
  throw new Error("Filimonova: configuration or Supabase client is not loaded");
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
  montage: {
    s1: localStorage.getItem("filimonova.montage.s1") !== "0",
    s2: localStorage.getItem("filimonova.montage.s2") !== "0",
    level: localStorage.getItem("filimonova.montage.level") || "1",
    period: localStorage.getItem("filimonova.montage.period") || ""
  },
  accountingLinkFilter: localStorage.getItem("filimonova.accounting.linkFilter") || "unmatched",
  columnFilters: {},
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
  supplierSnapshotRows: [],
  supplierControlJournal: []
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
const num0Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmt(value) {
  const n = Number(value || 0);
  return n ? numFmt.format(n) : "";
}

function fmt0(value) {
  const n = Number(value || 0);
  return n ? num0Fmt.format(n) : "";
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

let excelJsLoadPromise=null;
function ensureExcelJsLoaded() {
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if(excelJsLoadPromise) return excelJsLoadPromise;
  excelJsLoadPromise=new Promise(function(resolve,reject){
    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    script.async=true;
    script.onload=function(){
      if(window.ExcelJS) resolve(window.ExcelJS);
      else reject(new Error("Модуль ExcelJS загрузился без ExcelJS."));
    };
    script.onerror=function(){
      excelJsLoadPromise=null;
      reject(new Error("Не удалось загрузить модуль ExcelJS."));
    };
    document.head.appendChild(script);
  });
  return excelJsLoadPromise;
}

let xlsxLoadPromise=null;
function ensureXlsxLoaded() {
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise=new Promise(function(resolve,reject){
    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.async=true;
    script.onload=function(){
      if(window.XLSX) resolve(window.XLSX);
      else reject(new Error("Модуль Excel загрузился без XLSX."));
    };
    script.onerror=function(){
      xlsxLoadPromise=null;
      reject(new Error("Не удалось загрузить модуль Excel."));
    };
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

async function fetchAllRows(table,columns,configure) {
  const pageSize=1000;
  async function page(from,withCount) {
    let query=client.from(table).select(columns,withCount?{count:"exact"}:undefined);
    if(configure) query=configure(query);
    const result=await query.range(from,from+pageSize-1);
    if(result.error) throw result.error;
    return {rows:result.data||[],count:result.count};
  }

  const first=await page(0,false);
  if(first.rows.length<pageSize) return first.rows;

  const second=await page(pageSize,true);
  const all=first.rows.concat(second.rows);
  if(second.rows.length<pageSize) return all;

  const total=Number(second.count);
  if(!Number.isFinite(total) || total<=pageSize*2) {
    let from=pageSize*2;
    while(true){
      const next=await page(from,false);
      all.push.apply(all,next.rows);
      if(next.rows.length<pageSize) break;
      from+=pageSize;
    }
    return all;
  }

  const offsets=[];
  for(let from=pageSize*2;from<total;from+=pageSize) offsets.push(from);
  const concurrency=4;
  for(let i=0;i<offsets.length;i+=concurrency){
    const batch=await Promise.all(offsets.slice(i,i+concurrency).map(function(from){return page(from,false);}));
    batch.forEach(function(result){all.push.apply(all,result.rows);});
  }
  return all;
}

async function loadProjectDataFresh(project) {
  const requests = [
    fetchAllRows("catalog_items","id,mark,name,normalized_key,length_mm,height_mm,thickness_mm,area_m2,geometry_source,geometry_source_page,geometry_confidence",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("mark");}),
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
    fetchAllRows("supply_documents","id,supplier_id,document_type,receipt_date,ttn_number,status,note,source_file_name,source_file_path,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("receipt_date");}),
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
    fetchAllRows("supplier_price_links","id,supplier_id,catalog_item_id,supplier_item_id,scope_key,link_method,validation_state,last_checked_import_id,created_at,updated_at",function(q){return q.eq("project_id",project.id);}),
    fetchAllRows("supplier_price_journal","id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method,actor_id,created_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});}),
    fetchAllRows("supplier_price_snapshot_rows","import_id,source_name,imported_at,version_no,supplier_id,import_row_id,source_row_no,source_key,raw_data,normalized_data,supplier_item_id,catalog_item_id,link_method,validation_state,scope_key",function(q){return q.eq("project_id",project.id).order("imported_at",{ascending:false}).order("source_row_no");}),
    fetchAllRows("supplier_price_control_journal","id,catalog_item_id,supplier_item_id,issue_key,reasons,status,snapshot,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});})
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
    supplierSnapshotRows:results[39] || [],
    supplierControlJournal:results[40] || []
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


async function projectDataSliceRequest(key,project) {
  switch(key) {
    case "catalogItems": return fetchAllRows("catalog_items","id,mark,name,normalized_key,length_mm,height_mm,thickness_mm,area_m2,geometry_source,geometry_source_page,geometry_confidence",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("mark");});
    case "specSections": return fetchAllRows("specification_sections","id,building_section,zone,name,sort_order,is_stairs",function(q){return q.eq("project_id",project.id).order("sort_order");});
    case "specRows": return fetchAllRows("specification_rows","id,section_id,catalog_item_id,position_no,designation,project_volume_m3,sort_order",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("position_no");});
    case "specQuantities": return fetchAllRows("specification_quantities","specification_row_id,level_code,level_order,quantity",function(q){return q.eq("project_id",project.id).order("level_order").order("specification_row_id");});
    case "estimates": return fetchAllRows("estimates","id,number,name,status,building_section,zone,is_stairs",function(q){return q.eq("project_id",project.id).eq("status","active").order("number");});
    case "estimateSections": return fetchAllRows("estimate_sections","id,estimate_id,title,sort_order",function(q){return q.eq("project_id",project.id).order("sort_order");});
    case "estimateRows": return fetchAllRows("estimate_rows","id,estimate_id,section_id,row_type,position,basis,name,unit,quantity,sort_order,catalog_item_id,source_original",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("sort_order");});
    case "estimateCosts": return fetchAllRows("estimate_row_costs","estimate_row_id,salary_unit,salary_amount,machines_unit,machines_amount,drivers_unit,drivers_amount,materials_unit,materials_amount,transport_unit,transport_amount,total_unit,total_amount",function(q){return q.eq("project_id",project.id);});
    case "reconciliationLinks": return fetchAllRows("reconciliation_links","id,estimate_row_id,specification_row_id,link_method,origin_mode",function(q){return q.eq("project_id",project.id);});
    case "reconciliationJournal": return fetchAllRows("reconciliation_journal","id,estimate_row_id,specification_row_id,issue_key,reasons,proposal,comment,status,snapshot,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});});
    case "suppliers": return fetchAllRows("suppliers","id,name",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("name");});
    case "supplierItems": return fetchAllRows("supplier_items","id,supplier_id,catalog_item_id,source_mark,source_name,source_section,source_key,unit_volume_m3,link_method,link_state,source_import_row_id",function(q){return q.eq("project_id",project.id).is("archived_at",null).order("source_mark");});
    case "supplierPrices": return fetchAllRows("supplier_prices_current","id,supplier_item_id,effective_from,price_basis,unit_price_gross,unit_volume_snapshot_m3,source_import_row_id,source_imported_at",function(q){return q.eq("project_id",project.id).order("effective_from");});
    case "supplyDocuments": return fetchAllRows("supply_documents","id,supplier_id,document_type,receipt_date,ttn_number,status,note,source_file_name,source_file_path,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("receipt_date");});
    case "supplyDocumentLines": return fetchAllRows("supply_document_lines","id,document_id,sort_order,source_mark,source_name,catalog_item_id,supplier_item_id,qty_pieces,qty_m3,unit_volume_snapshot_m3,price_basis,unit_price,amount_net,vat_percent,vat_amount,amount_gross,match_state",function(q){return q.eq("project_id",project.id).order("sort_order");});
    case "supplyLineAllocations": return fetchAllRows("supply_line_allocations","id,white_line_id,green_line_id,allocated_pieces,allocated_m3",function(q){return q.eq("project_id",project.id);});
    case "estimateWorkLinks": return fetchAllRows("estimate_work_links","id,material_row_id,work_row_id,link_method",function(q){return q.eq("project_id",project.id);});
    case "montageEvents": return fetchAllRows("montage_events","id,specification_row_id,level_code,event_date,event_type,quantity,note,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("event_date").order("created_at");});
    case "gprPlans": return fetchAllRows("gpr_plans","id,name,status,start_month,end_month,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("created_at");});
    case "gprMonths": return fetchAllRows("gpr_months","id,plan_id,month,monthly_index,execution_index,is_in_period",function(q){return q.eq("project_id",project.id).order("month");});
    case "gprFloorAssignments": return fetchAllRows("gpr_floor_assignments","id,plan_id,month_id,building_section,level_code",function(q){return q.eq("project_id",project.id);});
    case "gprRowAssignments": return fetchAllRows("gpr_row_assignments","id,plan_id,month_id,estimate_row_id,quantity,source_mode,source_specification_row_id,source_level_code,parent_assignment_id",function(q){return q.eq("project_id",project.id);});
    case "avrDocuments": return fetchAllRows("avr_documents","id,period_month,display_number,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("period_month");});
    case "avrVersions": return fetchAllRows("avr_versions","id,document_id,version_no,state,source_import_id,signed_at,created_at",function(q){return q.eq("project_id",project.id).order("created_at");});
    case "avrRows": return fetchAllRows("avr_rows","id,version_id,estimate_row_id,quantity,quantity_m3,amount,source_import_row_id",function(q){return q.eq("project_id",project.id);});
    case "accountingRows": return fetchAllRows("accounting_rows","id,import_id,source_import_row_id,account_code,material_code,name,unit,quantity,unit_price,amount,source_row_no",function(q){return q.eq("project_id",project.id).order("source_row_no");});
    case "accountingCodeLinks": return fetchAllRows("accounting_code_links","id,accounting_code,catalog_item_id,link_method,note",function(q){return q.eq("project_id",project.id);});
    case "accountingPeriodSources": return fetchAllRows("accounting_period_sources","period_month,import_id,selected_at",function(q){return q.eq("project_id",project.id).order("period_month");});
    case "s29Documents": return fetchAllRows("s29_documents","id,period_month,avr_version_id,accounting_import_id,status,fixed_at,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("period_month");});
    case "s29Rows": return fetchAllRows("s29_rows","id,document_id,catalog_item_id,avr_quantity_pieces,volume_per_piece_snapshot_m3,avr_quantity_m3,written_off_m3,economy_m3,overrun_m3,note",function(q){return q.eq("project_id",project.id);});
    case "s29Allocations": return fetchAllRows("s29_allocations","id,s29_row_id,accounting_row_id,allocated_m3",function(q){return q.eq("project_id",project.id);});
    case "s29Carryovers": return fetchAllRows("s29_carryovers","id,origin_document_id,origin_row_id,catalog_item_id,kind,origin_month,created_m3,created_at",function(q){return q.eq("project_id",project.id);});
    case "s29CarryoverSettlements": return fetchAllRows("s29_carryover_settlements","id,carryover_id,settlement_document_id,settlement_month,settled_m3,created_at",function(q){return q.eq("project_id",project.id);});
    case "imports": return fetchAllRows("imports","id,domain,source_name,source_period,status,report,imported_at,source_slot,applied_at",function(q){return q.eq("project_id",project.id).in("domain",["avr","accounting","supplier_price"]).order("imported_at",{ascending:false});});
    case "supplierPriceLinks": return fetchAllRows("supplier_price_links","id,supplier_id,catalog_item_id,supplier_item_id,scope_key,link_method,validation_state,last_checked_import_id,created_at,updated_at",function(q){return q.eq("project_id",project.id);});
    case "supplierPriceJournal": return fetchAllRows("supplier_price_journal","id,import_id,catalog_item_id,supplier_item_id,event_type,before_value,after_value,link_method,actor_id,created_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});});
    case "supplierSnapshotRows": return fetchAllRows("supplier_price_snapshot_rows","import_id,source_name,imported_at,version_no,supplier_id,import_row_id,source_row_no,source_key,raw_data,normalized_data,supplier_item_id,catalog_item_id,link_method,validation_state,scope_key",function(q){return q.eq("project_id",project.id).order("imported_at",{ascending:false}).order("source_row_no");});
    case "supplierControlJournal": return fetchAllRows("supplier_price_control_journal","id,catalog_item_id,supplier_item_id,issue_key,reasons,status,snapshot,created_at,updated_at",function(q){return q.eq("project_id",project.id).order("created_at",{ascending:false});});
    default: throw new Error("Unknown project data slice: "+key);
  }
}

let derivedDataCache={state:null,maps:null,quantityMap:null,supplierVolumeMap:null,specJoinedRows:null};
function invalidateDerivedDataCache() {
  derivedDataCache={state:null,maps:null,quantityMap:null,supplierVolumeMap:null,specJoinedRows:null};
}

async function refreshProjectDataSlices(keys,project) {
  project=project||dataState.project;
  if(!project || !project.id || !keys || !keys.length) return;
  const unique=Array.from(new Set(keys));
  const values=await Promise.all(unique.map(function(key){return projectDataSliceRequest(key,project);}));
  unique.forEach(function(key,index){dataState[key]=values[index]||[];});
  dataState.loaded=true;
  dataState.source="supabase";
  dataState.project=project;
  invalidateDerivedDataCache();
}

function maps() {
  if(derivedDataCache.state===dataState && derivedDataCache.maps) return derivedDataCache.maps;
  const value={
    catalog:new Map(dataState.catalogItems.map(function(x){ return [x.id,x]; })),
    sections:new Map(dataState.specSections.map(function(x){ return [x.id,x]; })),
    estimates:new Map(dataState.estimates.map(function(x){ return [x.id,x]; })),
    estimateSections:new Map(dataState.estimateSections.map(function(x){ return [x.id,x]; })),
    costs:new Map(dataState.estimateCosts.map(function(x){ return [x.estimate_row_id,x]; }))
  };
  derivedDataCache.state=dataState;
  derivedDataCache.maps=value;
  return value;
}

function quantityMap() {
  if(derivedDataCache.state===dataState && derivedDataCache.quantityMap) return derivedDataCache.quantityMap;
  const map = new Map();
  dataState.specQuantities.forEach(function(q) {
    if (!map.has(q.specification_row_id)) map.set(q.specification_row_id, new Map());
    map.get(q.specification_row_id).set(q.level_code, Number(q.quantity || 0));
  });
  derivedDataCache.state=dataState;
  derivedDataCache.quantityMap=map;
  return map;
}

function supplierVolumeMap() {
  if(derivedDataCache.state===dataState && derivedDataCache.supplierVolumeMap) return derivedDataCache.supplierVolumeMap;
  const buckets=new Map();
  (dataState.supplierItems||[]).forEach(function(x){
    if(!x.catalog_item_id || x.link_state!=="matched") return;
    const v=Number(x.unit_volume_m3||0);
    if(!(v>0)) return;
    if(!buckets.has(x.catalog_item_id)) buckets.set(x.catalog_item_id,new Set());
    buckets.get(x.catalog_item_id).add(v.toFixed(6));
  });
  const out=new Map();
  buckets.forEach(function(values,id){
    if(values.size===1) out.set(id,Number(Array.from(values)[0]));
  });
  derivedDataCache.state=dataState;
  derivedDataCache.supplierVolumeMap=out;
  return out;
}

function supplierExactVolumeMap() {
  if(derivedDataCache.state===dataState && derivedDataCache.supplierExactVolumeMap) return derivedDataCache.supplierExactVolumeMap;
  function key(mark,name){
    const clean=function(value){
      return importNorm(value).replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g,"");
    };
    return clean(mark)+"|"+clean(name);
  }
  const buckets=new Map();
  (dataState.supplierItems||[]).forEach(function(x){
    const volume=Number(x.unit_volume_m3||0);
    if(!(volume>0)) return;
    const k=key(x.source_mark,x.source_name);
    if(k==="|") return;
    if(!buckets.has(k)) buckets.set(k,new Set());
    buckets.get(k).add(volume.toFixed(6));
  });
  const out=new Map();
  buckets.forEach(function(values,k){
    if(values.size===1) out.set(k,Number(Array.from(values)[0]));
  });
  derivedDataCache.state=dataState;
  derivedDataCache.supplierExactVolumeMap={values:out,key:key};
  return derivedDataCache.supplierExactVolumeMap;
}

function catalogUnitVolumeFallback(catalogItemId) {
  const matched=Number(supplierVolumeMap().get(catalogItemId)||0);
  if(matched>0) return matched;
  const item=maps().catalog.get(catalogItemId);
  if(!item) return 0;
  const exact=supplierExactVolumeMap();
  return Number(exact.values.get(exact.key(item.mark,item.name))||0);
}

function specJoinedRows() {
  if(derivedDataCache.state===dataState && derivedDataCache.specJoinedRows) return derivedDataCache.specJoinedRows;
  const m = maps();
  const qm = quantityMap();
  const rows=dataState.specRows.map(function(r) {
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
      volumePerPiece:catalogUnitVolumeFallback(r.catalog_item_id)
    });
  });
  derivedDataCache.state=dataState;
  derivedDataCache.specJoinedRows=rows;
  return rows;
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
