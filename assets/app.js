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
    estimates: { "200": true, "201": true, "202": true, "203": true, "207": true }
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
    estimateCosts: []
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
      tabs: ["Смета","Текущая цена","График производства работ","Сверка","Журнал"]
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
      subtitle: "Сопоставление спецификации и смет",
      tabs: ["Сверка"]
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

  function makeDemoData() {
    const catalogItems = [
      { id:"c1", mark:"ПСЦ 31.16.26-01", name:"Панель стеновая внутренняя цоколя", normalized_key:"test:псц31.16.26-01" },
      { id:"c2", mark:"ПСЦ 31.16.26-02", name:"Панель стеновая внутренняя цоколя", normalized_key:"test:псц31.16.26-02" },
      { id:"c3", mark:"ПСВ 31.16.26-13у", name:"Панель стеновая внутренняя", normalized_key:"test:псв31.16.26-13у" },
      { id:"c4", mark:"ПСВ 31.16.26-14у", name:"Панель стеновая внутренняя", normalized_key:"test:псв31.16.26-14у" }
    ];
    const specSections = [
      {id:"s1b",building_section:"Секция 1",zone:"Цоколь",name:"Внутренние стеновые панели цоколя",sort_order:20,is_stairs:false},
      {id:"s1a",building_section:"Секция 1",zone:"Выше 0.000",name:"Внутренние стеновые панели",sort_order:30,is_stairs:false},
      {id:"s2b",building_section:"Секция 2",zone:"Цоколь",name:"Внутренние стеновые панели цоколя",sort_order:20,is_stairs:false},
      {id:"s2a",building_section:"Секция 2",zone:"Выше 0.000",name:"Внутренние стеновые панели",sort_order:30,is_stairs:false}
    ];
    const specRows = [
      {id:"r1",section_id:"s1b",catalog_item_id:"c1",position_no:1,designation:"ФМ-ТЕСТ-Ц-01",project_volume_m3:0.86,sort_order:10},
      {id:"r2",section_id:"s1b",catalog_item_id:"c2",position_no:2,designation:"ФМ-ТЕСТ-Ц-02",project_volume_m3:0.92,sort_order:20},
      {id:"r3",section_id:"s1a",catalog_item_id:"c3",position_no:3,designation:"ФМ-ТЕСТ-В-13",project_volume_m3:0.52,sort_order:10},
      {id:"r4",section_id:"s1a",catalog_item_id:"c4",position_no:4,designation:"ФМ-ТЕСТ-В-14",project_volume_m3:0.51,sort_order:20},
      {id:"r5",section_id:"s2b",catalog_item_id:"c1",position_no:5,designation:"ФМ-ТЕСТ-Ц-01",project_volume_m3:0.86,sort_order:10},
      {id:"r6",section_id:"s2b",catalog_item_id:"c2",position_no:6,designation:"ФМ-ТЕСТ-Ц-02",project_volume_m3:0.92,sort_order:20},
      {id:"r7",section_id:"s2a",catalog_item_id:"c3",position_no:7,designation:"ФМ-ТЕСТ-В-13",project_volume_m3:0.52,sort_order:10},
      {id:"r8",section_id:"s2a",catalog_item_id:"c4",position_no:8,designation:"ФМ-ТЕСТ-В-14",project_volume_m3:0.51,sort_order:20}
    ];
    const specQuantities = [];
    function q(row, code, order, quantity) {
      specQuantities.push({specification_row_id:row,level_code:code,level_order:order,quantity:quantity});
    }
    q("r1","Ц",0,4); q("r2","Ц",0,2);
    q("r3","1",1,2); q("r3","2",2,2); q("r3","3",3,2);
    q("r4","1",1,1); q("r4","2",2,1); q("r4","3",3,1);
    q("r5","Ц",0,3); q("r6","Ц",0,3);
    q("r7","1",1,2); q("r7","2",2,2); q("r7","3",3,2);
    q("r8","1",1,1); q("r8","2",2,1); q("r8","3",3,2);

    const estimates = [
      {id:"e200",number:"200",name:"Секция 1 · Цоколь",status:"active"},
      {id:"e201",number:"201",name:"Секция 2 · Цоколь",status:"active"},
      {id:"e202",number:"202",name:"Секция 1 · Выше 0.000",status:"active"},
      {id:"e203",number:"203",name:"Секция 2 · Выше 0.000",status:"active"},
      {id:"e207",number:"207",name:"Элементы лестниц",status:"active"}
    ];
    const estimateSections = estimates.map(function(e) {
      return {
        id:"es"+e.number,
        estimate_id:e.id,
        title:e.number === "207" ? "Элементы лестниц" : (e.number === "200" || e.number === "201" ? "Стеновые панели цоколя" : "Стеновые панели выше 0.000"),
        sort_order:10
      };
    });
    const estimateRows = [];
    function er(number,type,position,basis,name,qty,order) {
      estimateRows.push({
        id:"er"+number+"_"+position,
        estimate_id:"e"+number,
        section_id:"es"+number,
        row_type:type,
        position:String(position),
        basis:basis,
        name:name,
        unit:"шт.",
        quantity:qty,
        sort_order:order
      });
    }
    er("200","work",1,"Е7-1-1","Монтаж стеновых панелей цоколя",6,10);
    er("200","material",2,"ПСЦ 31.16.26-01","Панель ПСЦ 31.16.26-01",4,20);
    er("200","material",3,"ПСЦ 31.16.26-02","Панель ПСЦ 31.16.26-02",2,30);
    er("201","work",1,"Е7-1-1","Монтаж стеновых панелей цоколя",6,10);
    er("201","material",2,"ПСЦ 31.16.26-01","Панель ПСЦ 31.16.26-01",3,20);
    er("201","material",3,"ПСЦ 31.16.26-02","Панель ПСЦ 31.16.26-02",3,30);
    er("202","work",1,"Е7-1-2","Монтаж внутренних стеновых панелей",9,10);
    er("202","material",2,"ПСВ 31.16.26-13у","Панель ПСВ 31.16.26-13у",6,20);
    er("202","material",3,"ПСВ 31.16.26-14у","Панель ПСВ 31.16.26-14у",3,30);
    er("203","work",1,"Е7-1-2","Монтаж внутренних стеновых панелей",10,10);
    er("203","material",2,"ПСВ 31.16.26-13у","Панель ПСВ 31.16.26-13у",6,20);
    er("203","material",3,"ПСВ 31.16.26-14у","Панель ПСВ 31.16.26-14у",4,30);
    er("207","work",1,"Е7-5-1","Монтаж элементов лестниц",8,10);
    er("207","material",2,"ЛМ 30.12-1","Лестничный марш ЛМ 30.12-1",4,20);
    er("207","material",3,"ЛП 28.12-1","Лестничная площадка ЛП 28.12-1",4,30);

    const estimateCosts = estimateRows.map(function(r) {
      let totalUnit = 83.70;
      let material = 0;
      if (r.row_type === "material") {
        const price = {
          "ПСЦ 31.16.26-01":974.50,
          "ПСЦ 31.16.26-02":1049.50,
          "ПСВ 31.16.26-13у":799.50,
          "ПСВ 31.16.26-14у":824.50,
          "ЛМ 30.12-1":1214.50,
          "ЛП 28.12-1":894.50
        }[r.basis] || 0;
        totalUnit = price;
        material = Math.max(0, price - 34.50);
      }
      return {
        estimate_row_id:r.id,
        salary_unit:r.row_type === "work" ? 54.20 : 0,
        salary_amount:r.row_type === "work" ? 54.20 * r.quantity : 0,
        machines_unit:r.row_type === "work" ? 21.40 : 0,
        machines_amount:r.row_type === "work" ? 21.40 * r.quantity : 0,
        drivers_unit:r.row_type === "work" ? 8.10 : 0,
        drivers_amount:r.row_type === "work" ? 8.10 * r.quantity : 0,
        materials_unit:r.row_type === "material" ? material : 0,
        materials_amount:r.row_type === "material" ? material * r.quantity : 0,
        transport_unit:r.row_type === "material" ? 34.50 : 0,
        transport_amount:r.row_type === "material" ? 34.50 * r.quantity : 0,
        total_unit:totalUnit,
        total_amount:totalUnit * r.quantity
      };
    });

    return {
      loaded:true,
      source:"demo",
      project:{id:"demo",code:"FILIMONOVA",name:"Филимонова",status:"active"},
      catalogItems:catalogItems,
      specSections:specSections,
      specRows:specRows,
      specQuantities:specQuantities,
      estimates:estimates,
      estimateSections:estimateSections,
      estimateRows:estimateRows,
      estimateCosts:estimateCosts
    };
  }

  async function loadProjectData(project) {
    const requests = [
      client.from("catalog_items").select("id,mark,name,normalized_key").eq("project_id",project.id).is("archived_at",null).order("mark"),
      client.from("specification_sections").select("id,building_section,zone,name,sort_order,is_stairs").eq("project_id",project.id).order("sort_order"),
      client.from("specification_rows").select("id,section_id,catalog_item_id,position_no,designation,project_volume_m3,sort_order").eq("project_id",project.id).is("archived_at",null).order("position_no"),
      client.from("specification_quantities").select("specification_row_id,level_code,level_order,quantity").eq("project_id",project.id).order("level_order"),
      client.from("estimates").select("id,number,name,status").eq("project_id",project.id).eq("status","active").order("number"),
      client.from("estimate_sections").select("id,estimate_id,title,sort_order").eq("project_id",project.id).order("sort_order"),
      client.from("estimate_rows").select("id,estimate_id,section_id,row_type,position,basis,name,unit,quantity,sort_order").eq("project_id",project.id).is("archived_at",null).order("sort_order"),
      client.from("estimate_row_costs").select("estimate_row_id,salary_unit,salary_amount,machines_unit,machines_amount,drivers_unit,drivers_amount,materials_unit,materials_amount,transport_unit,transport_amount,total_unit,total_amount").eq("project_id",project.id)
    ];
    const results = await Promise.all(requests);
    const failed = results.find(function(x) { return x.error; });
    if (failed) throw failed.error;
    dataState = {
      loaded:true,
      source:"supabase",
      project:project,
      catalogItems:results[0].data || [],
      specSections:results[1].data || [],
      specRows:results[2].data || [],
      specQuantities:results[3].data || [],
      estimates:results[4].data || [],
      estimateSections:results[5].data || [],
      estimateRows:results[6].data || [],
      estimateCosts:results[7].data || []
    };
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

  function checkHtml(id,label,checked,group) {
    return '<label class="check"><input type="checkbox" data-filter-group="' + esc(group) + '" data-filter-id="' + esc(id) + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
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
    if (tab === 1) {
      html += '<span class="spacer"></span>';
      html += checkHtml("homeTotal","Итог по дому",ui.spec.showHomeTotal,"spec-option");
    }
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
    if (pageKey === "estimates") return buildEstimateContext(tab);
    if (pageKey === "montage") {
      return '<span class="context-caption">Показывать:</span>' +
        checkHtml("all","Все",true,"montage") +
        checkHtml("s1","Секция 1",true,"montage") +
        checkHtml("s2","Секция 2",true,"montage") +
        '<button class="context-link" type="button">Уровень: 1 ▾</button>' +
        '<button class="context-link" type="button">Сентябрь 2026 ▾</button>';
    }
    if (pageKey === "avr") {
      if (tab === 0) return '<button class="context-link" type="button">Месяц ▾</button><span>·</span><button class="context-link" type="button">АВР ▾</button><span>·</span><button class="context-link" type="button">Версия ▾</button><span>·</span><span class="context-muted">Статус: нет акта</span>';
      if (tab === 1) return '<button class="context-link" type="button">Период: Весь период ▾</button><button class="context-link" type="button">Импорт Excel АВР</button>';
      return buildEstimateContext(0);
    }
    if (pageKey === "s29") {
      if (tab === 0) return '<button class="context-link" type="button">Месяц ▾</button><span>·</span><button class="context-link" type="button">АВР: нет ▾</button><span>·</span><span class="context-muted">остатки на дату —</span><span>·</span><span class="context-muted">бух. импорт —</span>';
      return '<span class="context-muted">Контекст текущего представления</span>';
    }
    if (pageKey === "supply") return '<span class="context-muted">Данные по всему объекту</span>';
    return '<span class="context-muted">Контекст страницы</span>';
  }

  function buildServiceLeft(pageKey) {
    if (pageKey === "spec") {
      return '<span class="legend-item"><span class="legend-dot supply"></span>Поставка</span>' +
        '<span class="legend-item"><span class="legend-dot montage"></span>Монтаж</span>' +
        '<span class="legend-item"><span class="legend-dot avr"></span>АВР</span>';
    }
    if (pageKey === "montage") return '<span class="context-muted">ЛКМ +1 · ПКМ −1</span>';
    if (dataState.source === "supabase") return '<span class="context-muted">Тестовые данные · Supabase</span>';
    if (reviewMode) return '<span class="context-muted">Тестовые данные · режим просмотра</span>';
    return "";
  }

  function isHierarchical(pageKey, tab) {
    if (pageKey === "spec") return true;
    if (pageKey === "estimates") return tab === 0;
    if (pageKey === "supply") return tab === 0 || tab === 2;
    if (pageKey === "avr") return tab === 2;
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
    let rows = specJoinedRows().filter(passesSpecFilters).filter(rowMatchesSpecSearch);
    rows.sort(function(a,b){ return a.position_no - b.position_no; });

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
              if (ui.collapsed.has(sKey)) return;
              sRows.forEach(function(r) {
                body += '<tr class="data-row" data-row-id="' + esc(r.id) + '">';
                body += '<td class="sticky-1">' + esc(r.position_no) + '</td>';
                body += '<td class="sticky-2">' + esc(r.mark) + '</td>';
                body += '<td class="sticky-3">' + esc(r.name) + '</td>';
                levels.forEach(function(code) {
                  const value = code === "Всего" ? r.total : qtyAt(r,code);
                  body += '<td class="level-col num">' + fmt0(value) + '</td>';
                });
                body += '</tr>';
              });
            });
          });
        });
      }
    }

    const head = '<thead><tr>' +
      '<th class="sticky-1">№</th>' +
      '<th class="sticky-2">Марка</th>' +
      '<th class="sticky-3">Наименование</th>' +
      levels.map(function(x){ return '<th class="level-col">' + esc(x) + '</th>'; }).join("") +
      '</tr></thead>';

    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table">' + head + '<tbody>' + body + '</tbody></table></div></div>';
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
          volumePerPiece:r.volumePerPiece,
          bySection:{"Секция 1":0,"Секция 2":0},
          byLevel:{"Секция 1":new Map(),"Секция 2":new Map()}
        });
      }
      const g = grouped.get(key);
      const bs = r.section.building_section;
      if (!g.bySection[bs]) g.bySection[bs] = 0;
      g.bySection[bs] += r.total;
      if (!g.byLevel[bs]) g.byLevel[bs] = new Map();
      levels.forEach(function(code) {
        const v = qtyAt(r,code);
        if (v) g.byLevel[bs].set(code,Number(g.byLevel[bs].get(code) || 0)+v);
      });
    });

    return Array.from(grouped.values()).sort(function(a,b) {
      const z = a.zone.localeCompare(b.zone,"ru");
      if (z) return z;
      const s = a.sectionName.localeCompare(b.sectionName,"ru");
      if (s) return s;
      return a.mark.localeCompare(b.mark,"ru");
    });
  }

  function summaryVector(rows, levels, showHome) {
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
    out.push(s1,s2);
    if (showHome) out.push(s1+s2);
    return out;
  }

  function summaryGroupRow(label, rows, key, depth, levels, showHome) {
    registerGroup(key);
    const vector = summaryVector(rows,levels,showHome);
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
    const showHome = ui.spec.showHomeTotal;
    const rows = buildWorkingSummaryRows();
    ui.currentGroupKeys = [];

    let body = "";
    if (!rows.length) {
      body = tableMessage("Нет строк по текущему фильтру.",3+4+levels.length*2+2+(showHome?1:0));
    } else {
      const rootKey = "spec-summary:root";
      body += summaryGroupRow("Всего по дому",rows,rootKey,0,levels,showHome);
      if (!ui.collapsed.has(rootKey)) {
        ["Цоколь","Выше 0.000"].forEach(function(zone) {
          const zRows = rows.filter(function(r){ return r.zone === zone; });
          if (!zRows.length) return;
          const zKey = "spec-summary:zone:"+zone;
          body += summaryGroupRow(zone,zRows,zKey,1,levels,showHome);
          if (ui.collapsed.has(zKey)) return;
          const names = Array.from(new Set(zRows.map(function(r){ return r.sectionName; })));
          names.forEach(function(name) {
            const sRows = zRows.filter(function(r){ return r.sectionName === name; });
            const sKey = "spec-summary:section:"+zone+":"+name;
            body += summaryGroupRow(name,sRows,sKey,2,levels,showHome);
            if (ui.collapsed.has(sKey)) return;
            sRows.forEach(function(r,index) {
              const s1 = Number(r.bySection["Секция 1"] || 0);
              const s2 = Number(r.bySection["Секция 2"] || 0);
              body += '<tr class="data-row">';
              body += '<td class="sticky-1">' + (index+1) + '</td>';
              body += '<td class="sticky-2">' + esc(r.mark) + '</td>';
              body += '<td class="sticky-3">' + esc(r.name) + '</td>';
              body += '<td class="qty-col num">' + fmt0(s1) + '</td><td class="vol-col num">' + fmt(s1*r.volumePerPiece) + '</td>';
              body += '<td class="qty-col num">' + fmt0(s2) + '</td><td class="vol-col num">' + fmt(s2*r.volumePerPiece) + '</td>';
              levels.forEach(function(code) {
                body += '<td class="summary-col num">' + fmt0((r.byLevel["Секция 1"] && r.byLevel["Секция 1"].get(code)) || 0) + '</td>';
                body += '<td class="summary-col num">' + fmt0((r.byLevel["Секция 2"] && r.byLevel["Секция 2"].get(code)) || 0) + '</td>';
              });
              body += '<td class="summary-col num">' + fmt0(s1) + '</td><td class="summary-col num">' + fmt0(s2) + '</td>';
              if (showHome) body += '<td class="summary-col num">' + fmt0(s1+s2) + '</td>';
              body += '</tr>';
            });
          });
        });
      }
    }

    const head1 = '<tr>' +
      '<th class="sticky-1" rowspan="2">№</th>' +
      '<th class="sticky-2" rowspan="2">Марка</th>' +
      '<th class="sticky-3" rowspan="2">Наименование</th>' +
      '<th colspan="2">Секция 1</th><th colspan="2">Секция 2</th>' +
      levels.map(function(x){ return '<th colspan="2">' + esc(x) + '</th>'; }).join("") +
      '<th colspan="' + (showHome ? 3 : 2) + '">Всего</th></tr>';
    const head2 = '<tr>' +
      '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
      '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
      levels.map(function(){ return '<th class="vertical-sub"><span>Секция 1</span></th><th class="vertical-sub"><span>Секция 2</span></th>'; }).join("") +
      '<th class="vertical-sub"><span>Секция 1</span></th><th class="vertical-sub"><span>Секция 2</span></th>' +
      (showHome ? '<th class="vertical-sub"><span>Дом</span></th>' : '') +
      '</tr>';

    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table working-summary"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div></div>';
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
    html += '<td></td><td class="num">' + fmt(v.qty) + '</td><td class="num">' + fmt(v.qty) + '</td>';
    html += '<td></td><td class="num">' + money(v.salary) + '</td>';
    html += '<td></td><td class="num">' + money(v.machines) + '</td>';
    html += '<td></td><td class="num">' + money(v.materials) + '</td>';
    html += '<td></td><td class="num">' + money(v.transport) + '</td>';
    html += '<td></td><td class="num strong-num">' + money(v.total) + '</td>';
    html += '</tr>';
    return html;
  }

  function renderEstimateTable() {
    const m = maps();
    const selected = dataState.estimates.filter(function(e){ return ui.estimates[e.number] !== false; });
    ui.currentGroupKeys = [];
    let body = "";

    selected.forEach(function(e) {
      let rows = dataState.estimateRows.filter(function(r){ return r.estimate_id === e.id; });
      rows = rows.filter(function(r){ return passesSearch([r.position,r.basis,r.name]); });
      rows.sort(function(a,b){ return Number(a.sort_order||0)-Number(b.sort_order||0); });
      if (!rows.length && currentSearch()) return;

      const eKey = "est:estimate:"+e.number;
      body += estimateGroupRow("Смета №"+e.number+" · "+(e.name||""),rows,eKey,0,m);
      if (ui.collapsed.has(eKey)) return;

      const sections = dataState.estimateSections.filter(function(s){ return s.estimate_id === e.id; });
      sections.forEach(function(s) {
        const sRows = rows.filter(function(r){ return r.section_id === s.id; });
        if (!sRows.length) return;
        const sKey = "est:section:"+e.number+":"+s.id;
        body += estimateGroupRow(s.title,sRows,sKey,1,m);
        if (ui.collapsed.has(sKey)) return;

        sRows.forEach(function(r) {
          const c = rowCost(r,m);
          body += '<tr class="data-row">';
          body += '<td class="e-sticky-1"><span class="type-mark">' + (r.row_type === "work" ? "Р" : "М") + '</span></td>';
          body += '<td class="e-sticky-2">' + esc(r.position || "") + '</td>';
          body += '<td class="e-sticky-3">' + esc(r.basis || "") + '</td>';
          body += '<td class="e-sticky-4">' + esc(r.name || "") + '</td>';
          body += '<td>' + esc(r.unit || "") + '</td>';
          body += '<td class="num">' + fmt(r.quantity) + '</td>';
          body += '<td class="num">' + fmt(r.quantity) + '</td>';
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
        '<th class="e-sticky-2" rowspan="2">Поз. сметы</th>' +
        '<th class="e-sticky-3" rowspan="2">Обоснование</th>' +
        '<th class="e-sticky-4" rowspan="2">Наименование</th>' +
        '<th rowspan="2">Ед. изм.</th>' +
        '<th rowspan="2">Количество</th>' +
        '<th rowspan="2">Остаток по смете</th>' +
        '<th colspan="2">Зарплата</th>' +
        '<th colspan="2">Машины</th>' +
        '<th colspan="2">Материалы</th>' +
        '<th colspan="2">Транспорт</th>' +
        '<th colspan="2">Всего</th>' +
      '</tr>' +
      '<tr>' +
        '<th>ед.</th><th>всего</th><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th><th>ед.</th><th>всего</th>' +
      '</tr>' +
    '</thead>';

    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table est-table">' + head + '<tbody>' + body + '</tbody></table></div></div>';
  }

  function renderCurrentPricePlaceholder() {
    const totals = dataState.estimateRows.reduce(function(acc,r) {
      const c = maps().costs.get(r.id);
      return acc + Number(c ? c.total_amount : 0);
    },0);
    $("workArea").className = "work-area content-work";
    $("workArea").innerHTML =
      '<div class="review-panel">' +
        '<div class="review-panel-title">Текущая цена</div>' +
        '<div class="review-grid">' +
          '<div><span>База тестовых смет</span><strong>' + money(totals) + '</strong></div>' +
          '<div><span>Прогнозный индекс</span><strong>1,0552</strong></div>' +
          '<div><span>Конкурсный коэффициент</span><strong>1,0000</strong></div>' +
          '<div><span>НДС</span><strong>0%</strong></div>' +
        '</div>' +
        '<div class="review-note">Структура экрана уже рабочая; полный расчётный движок текущих цен подключим после согласования таблицы смет.</div>' +
      '</div>';
  }

  function renderGprPlaceholder() {
    const months = ["Окт. 26","Ноя. 26","Дек. 26","Янв. 27"];
    const rows = dataState.estimates.map(function(e) {
      return '<tr><td class="gpr-sticky">' + esc("Смета №"+e.number+" · "+e.name) + '</td>' +
        months.map(function(){ return '<td class="gpr-month"></td>'; }).join("") + '</tr>';
    }).join("");
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML =
      '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table gpr-table">' +
      '<thead><tr><th class="gpr-sticky">Смета / раздел</th>' + months.map(function(m){return '<th>'+m+'</th>';}).join("") + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function renderSupplySummary() {
    const levels = levelCodes();
    const rows = buildWorkingSummaryRows();
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
        '<td class="num">0</td><td class="num">0</td>' +
        '<td class="num">0</td><td class="num">0</td>' +
        '<td class="num">0</td><td class="num">0</td>' +
        '<td class="num">'+fmt0(v.qty)+'</td><td class="num">'+fmt(v.vol)+'</td><td></td></tr>';
    }

    let filtered = rows.filter(function(r){ return passesSearch([r.mark,r.name]); });
    if (!filtered.length) body = tableMessage("Нет строк по текущему поиску.",14);
    else {
      const root = "supply:root";
      body += group("Всего по дому",filtered,root,0);
      if (!ui.collapsed.has(root)) {
        ["Цоколь","Выше 0.000"].forEach(function(zone) {
          const zr = filtered.filter(function(r){return r.zone===zone;});
          if (!zr.length) return;
          const zk = "supply:zone:"+zone;
          body += group(zone,zr,zk,1);
          if (ui.collapsed.has(zk)) return;
          const names = Array.from(new Set(zr.map(function(r){return r.sectionName;})));
          names.forEach(function(name) {
            const sr = zr.filter(function(r){return r.sectionName===name;});
            const sk = "supply:section:"+zone+":"+name;
            body += group(name,sr,sk,2);
            if (ui.collapsed.has(sk)) return;
            sr.forEach(function(r,index) {
              const q = Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);
              const v = q*Number(r.volumePerPiece||0);
              body += '<tr class="data-row"><td class="sticky-1">'+(index+1)+'</td><td class="sticky-2">'+esc(r.mark)+'</td><td class="sticky-3">'+esc(r.name)+'</td>' +
                '<td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(v)+'</td>' +
                '<td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td>' +
                '<td class="num">0</td><td class="num">0</td>' +
                '<td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(v)+'</td><td class="status-cell">Не поставлялось</td></tr>';
            });
          });
        });
      }
    }

    const head = '<thead><tr>' +
      '<th class="sticky-1" rowspan="2">№</th><th class="sticky-2" rowspan="2">Марка</th><th class="sticky-3" rowspan="2">Наименование</th>' +
      '<th colspan="2">По проекту</th><th colspan="2">Поставлено</th><th colspan="2">На объекте</th><th colspan="2">Смонтировано</th><th colspan="2">Осталось поставить</th><th rowspan="2">Статус</th></tr>' +
      '<tr><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th></tr></thead>';

    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table supply-table">' + head + '<tbody>' + body + '</tbody></table></div></div>';
  }

  function renderSupplyDocuments() {
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML =
      '<div class="engineering-shell"><div class="local-action-row"><button class="local-text-action" type="button">+ Добавить накладную</button></div>' +
      '<div class="engineering-scroll"><table class="eng-table compact-registry"><thead><tr><th>Дата</th><th>Тип</th><th>№ ТТН</th><th>Поставщик</th><th>Позиций</th><th>Статус</th></tr></thead>' +
      '<tbody>' + tableMessage("Накладных пока нет. Проектная номенклатура уже загружена.",6) + '</tbody></table></div></div>';
  }

  function renderSupplierPrice() {
    const rows = buildWorkingSummaryRows().filter(function(r){ return passesSearch([r.mark,r.name]); });
    ui.currentGroupKeys = [];
    let body = "";
    rows.forEach(function(r,index) {
      const q = Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);
      body += '<tr class="data-row"><td class="sticky-1">'+(index+1)+'</td><td class="sticky-2">'+esc(r.mark)+'</td><td class="sticky-3">'+esc(r.name)+'</td>' +
        '<td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(r.volumePerPiece)+'</td><td class="num">'+fmt(q*r.volumePerPiece)+'</td>' +
        '<td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="status-cell">Нет цены</td></tr>';
    });
    if (!body) body = tableMessage("Нет строк по текущему поиску.",11);
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML =
      '<div class="engineering-shell"><div class="local-action-row"><button class="local-text-action" type="button">Импорт прайса</button></div><div class="engineering-scroll"><table class="eng-table price-table">' +
      '<thead><tr><th class="sticky-1" rowspan="2">№</th><th class="sticky-2" rowspan="2">Марка</th><th class="sticky-3" rowspan="2">Наименование</th><th rowspan="2">Всего, шт.</th>' +
      '<th colspan="2">Объём, м³</th><th colspan="2">Стоимость за 1 шт.</th><th colspan="2">Стоимость за 1 м³</th><th rowspan="2">Прайс</th></tr>' +
      '<tr><th>за ед.</th><th>всего</th><th>за ед.</th><th>всего</th><th>за ед.</th><th>всего</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderMontage(tab) {
    if (tab === 1) {
      $("workArea").className = "work-area content-work";
      $("workArea").innerHTML = '<div class="review-panel"><div class="review-panel-title">3D модель</div><div class="review-note">Раздел зарезервирован. В актуальном ТЗ 3D остаётся placeholder до отдельного этапа.</div></div>';
      return;
    }
    const days = Array.from({length:30},function(_,i){return i+1;});
    const rows = specJoinedRows().filter(function(r){ return passesSearch([r.mark,r.name]); });
    let body = rows.map(function(r) {
      const floorQty = qtyAt(r,"1");
      return '<tr class="data-row"><td class="sticky-1">'+esc(r.position_no)+'</td><td class="sticky-2">'+esc(r.mark)+'</td><td class="sticky-3">'+esc(r.name)+'</td>' +
        '<td class="num">'+fmt0(floorQty)+'</td><td class="num">0</td><td class="num">'+fmt0(floorQty)+'</td><td class="num">0</td><td class="num">0</td>' +
        days.map(function(){return '<td class="day-cell"></td>';}).join("") + '</tr>';
    }).join("");
    if (!body) body = tableMessage("Нет строк по текущему поиску.",8+days.length);
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table montage-table"><thead><tr>' +
      '<th class="sticky-1">№</th><th class="sticky-2">Марка</th><th class="sticky-3">Наименование</th><th>На этаж</th><th>Смонтировано</th><th>Остаток</th><th>Поставлено</th><th>Доступно для монтажа</th>' +
      days.map(function(d){return '<th class="day-cell">'+d+'</th>';}).join("") + '</tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderAvr(tab) {
    if (tab === 2) {
      renderKs6();
      return;
    }
    if (tab === 1) {
      $("workArea").className = "work-area table-work";
      $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table compact-registry"><thead><tr><th>Период</th><th>№ АВР</th><th>Файл</th><th>Версия</th><th>Статус</th></tr></thead><tbody>' + tableMessage("АВР ещё не импортировались.",5) + '</tbody></table></div></div>';
      return;
    }
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table avr-table"><thead><tr><th>Тип</th><th>Поз. сметы</th><th>Обоснование</th><th>Марка</th><th>Наименование</th><th>Ед. изм.</th><th>Кол-во в акте</th><th>Кол-во, м³</th><th>Стоимость по акту</th></tr></thead><tbody>' + tableMessage("Для тестовой базы текущий АВР ещё не создан.",9) + '</tbody></table></div></div>';
  }

  function renderKs6() {
    const m = maps();
    const estimates = dataState.estimates.filter(function(e){return ui.estimates[e.number] !== false;});
    ui.currentGroupKeys = [];
    let body = "";
    estimates.forEach(function(e) {
      let rows = dataState.estimateRows.filter(function(r){return r.estimate_id===e.id && passesSearch([r.position,r.basis,r.name]);});
      if (!rows.length && currentSearch()) return;
      const key = "ks6:"+e.number;
      registerGroup(key);
      body += '<tr class="group-row group-toggle" data-group-key="'+key+'"><td colspan="5" class="est-group-title"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc("Смета №"+e.number+" · "+e.name)+'</td><td class="num">'+fmt(rows.reduce(function(a,r){return a+Number(r.quantity||0);},0))+'</td><td></td><td></td><td class="num">'+fmt(rows.reduce(function(a,r){return a+Number(r.quantity||0);},0))+'</td></tr>';
      if (ui.collapsed.has(key)) return;
      rows.forEach(function(r) {
        body += '<tr class="data-row"><td>'+ (r.row_type==="work"?"Р":"М") +'</td><td>'+esc(r.position)+'</td><td>'+esc(r.basis)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.unit)+'</td><td class="num">'+fmt(r.quantity)+'</td><td class="num"></td><td class="num">0</td><td class="num">'+fmt(r.quantity)+'</td></tr>';
      });
    });
    if (!body) body = tableMessage("Нет строк по текущему фильтру.",9);
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table ks-table"><thead><tr><th>Тип</th><th>Поз. сметы</th><th>Обоснование</th><th>Наименование</th><th>Ед. изм.</th><th>По смете</th><th>Сен. 26</th><th>Запроцентовано</th><th>Остаток</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderS29(tab) {
    const titles = ["Расчёт С-29","Бухгалтерия","Связи с бухгалтерией","Экономия / перерасход"];
    $("workArea").className = "work-area content-work";
    $("workArea").innerHTML = '<div class="review-panel"><div class="review-panel-title">'+esc(titles[tab] || "С-29")+'</div>' +
      '<div class="review-note">Тестовые спецификации и сметы уже в базе. Для С-29 нужен подписанный АВР и бухгалтерский снимок; их пока намеренно не создаём, чтобы не подменять реальную логику фиктивным фактом.</div></div>';
  }

  function renderRecon() {
    const marks = new Set(dataState.catalogItems.map(function(x){return x.mark;}));
    const rows = dataState.estimateRows.filter(function(r){return r.row_type==="material" && passesSearch([r.position,r.basis,r.name]);});
    let body = rows.map(function(r) {
      const e = dataState.estimates.find(function(x){return x.id===r.estimate_id;});
      const linked = marks.has(r.basis);
      return '<tr><td>'+esc(e ? e.number : "")+'</td><td>'+esc(r.position)+'</td><td>'+esc(r.basis)+'</td><td>'+esc(r.name)+'</td><td>'+ (linked ? '<span class="soft-status ok">Точное совпадение марки</span>' : '<span class="soft-status warn">Без связи</span>') +'</td></tr>';
    }).join("");
    if (!body) body = tableMessage("Нет строк по текущему поиску.",5);
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table compact-registry"><thead><tr><th>Смета</th><th>Поз.</th><th>Обоснование</th><th>Наименование</th><th>Состояние</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderHome() {
    $("workArea").className = "work-area content-work";
    $("workArea").innerHTML =
      '<div class="review-panel"><div class="review-panel-title">Тестовая рабочая база подключена</div>' +
      '<div class="review-grid">' +
        '<div><span>Позиции спецификации</span><strong>'+dataState.specRows.length+'</strong></div>' +
        '<div><span>Номенклатура</span><strong>'+dataState.catalogItems.length+'</strong></div>' +
        '<div><span>Сметы</span><strong>'+dataState.estimates.length+'</strong></div>' +
        '<div><span>Строки смет</span><strong>'+dataState.estimateRows.length+'</strong></div>' +
      '</div>' +
      '<div class="review-note">Эти данные предназначены только для отработки интерфейса. Перед реальным импортом тестовый набор будет удалён.</div></div>';
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
      if (tab === 2) return renderGprPlaceholder();
      if (tab === 3) return renderRecon();
      return renderSimple("Журнал смет");
    }
    if (pageKey === "supply") {
      if (tab === 0) return renderSupplySummary();
      if (tab === 1) return renderSupplyDocuments();
      return renderSupplierPrice();
    }
    if (pageKey === "montage") return renderMontage(tab);
    if (pageKey === "avr") return renderAvr(tab);
    if (pageKey === "s29") return renderS29(tab);
    if (pageKey === "recon") return renderRecon();
    if (pageKey === "diffs") return renderSimple("Расхождения");
    if (pageKey === "links") return renderSimple("Связи работ");
    if (pageKey === "import") return renderSimple("Импорт");
    if (pageKey === "docs") return renderSimple("Документы");
    if (pageKey === "settings") return renderSimple("Настройки");
    return renderSimple("Раздел");
  }

  function wireContextControls() {
    document.querySelectorAll('#contextRow input[data-filter-group="spec"]').forEach(function(input) {
      input.addEventListener("change",function() {
        const id = input.dataset.filterId;
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
    document.querySelectorAll('#contextRow input[data-filter-group="spec-option"]').forEach(function(input) {
      input.addEventListener("change",function() {
        if (input.dataset.filterId === "homeTotal") {
          ui.spec.showHomeTotal = input.checked;
          localStorage.setItem("filimonova.spec.showHomeTotal",input.checked ? "1" : "0");
          renderPage(ui.page,ui.tabs[ui.page]||0);
        }
      });
    });
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

  function wireTableControls() {
    document.querySelectorAll(".group-toggle[data-group-key]").forEach(function(row) {
      row.addEventListener("click",function() {
        const key = row.dataset.groupKey;
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
  }

  function wireServiceControls() {
    const collapse = document.querySelector('[data-service="collapse"]');
    const expand = document.querySelector('[data-service="expand"]');
    if (collapse) collapse.addEventListener("click",function() {
      ui.currentGroupKeys.forEach(function(k){ui.collapsed.add(k);});
      rerenderContent();
    });
    if (expand) expand.addEventListener("click",function() {
      ui.currentGroupKeys.forEach(function(k){ui.collapsed.delete(k);});
      rerenderContent();
    });
  }

  function rerenderContent() {
    const tab = ui.tabs[ui.page] || 0;
    ui.currentGroupKeys = [];
    renderContent(ui.page,tab);
    wireTableControls();
    wireServiceControls();
  }

  function renderPage(pageKey,tabIndex) {
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
    $("serviceLeft").innerHTML = buildServiceLeft(pageKey);
    $("serviceRight").innerHTML = isHierarchical(pageKey,tab)
      ? '<button class="service-action" data-service="collapse" type="button">Свернуть всё</button><button class="service-action" data-service="expand" type="button">Развернуть всё</button>'
      : "";

    wireContextControls();
    ui.currentGroupKeys = [];
    renderContent(pageKey,tab);
    wireTableControls();
    wireServiceControls();
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

  document.querySelectorAll(".nav-btn").forEach(function(btn) {
    btn.addEventListener("click",function(){renderPage(btn.dataset.page);});
  });

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
      authView.classList.add("hidden");
      deniedView.classList.add("hidden");
      appView.classList.remove("hidden");
      try {
        if (session && session.user) {
          const admin = await isAdmin(session.user.id);
          if (admin) {
            const project = await ensureProject(session.user);
            await loadProjectData(project);
            $("userEmail").textContent = session.user.email || "—";
            $("adminState").textContent = "Глобальный администратор";
            $("projectName").textContent = project.name || cfg.projectName;
            $("projectStatus").textContent = "Тестовая база · Supabase";
            $("projectId").textContent = project.id;
          } else {
            dataState = makeDemoData();
            $("userEmail").textContent = "UI REVIEW";
          }
        } else {
          dataState = makeDemoData();
          $("userEmail").textContent = "UI REVIEW";
          $("adminState").textContent = "Режим просмотра интерфейса";
          $("projectName").textContent = cfg.projectName;
          $("projectStatus").textContent = "Тестовые данные";
          $("projectId").textContent = "—";
        }
      } catch (err) {
        dataState = makeDemoData();
        $("userEmail").textContent = "UI REVIEW";
        $("projectStatus").textContent = "Fallback тестовых данных";
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

  client.auth.onAuthStateChange(function(_event,session) {
    setTimeout(function(){renderSession(session);},0);
  });

  client.auth.getSession().then(function(result){renderSession(result.data.session);});
})();