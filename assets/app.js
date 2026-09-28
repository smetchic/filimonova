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
    columnFilters: {},
    columnSort: {}
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
    return '<td class="' + esc(extraClass || "") + '" data-filter-field="' + esc(field) + '" data-filter-value="' + esc(value == null ? "" : value) + '">' + content + '</td>';
  }

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

  function intrinsicColumnWidth(table,index) {
    if (table.classList.contains("working-summary")) {
      if (index === 3 || index === 5) return 58;
      if (index === 4 || index === 6) return 64;
      if (index >= 7) return 28;
    }
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
      if(cell.classList.contains("vertical-sub")) { max=Math.max(max,28); return; }
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
      widths=Array.from({length:count},function(_,i){return intrinsicColumnWidth(table,i);});
      saveTableWidths(table,widths);
    }
    Array.from(cg.children).forEach(function(col,i){col.style.width=widths[i]+"px";});
    updateStickyOffsets(table,widths);

    table.querySelectorAll("thead th").forEach(function(th){
      if(Number(th.dataset.logicalSpan||th.colSpan||1)!==1) return;
      if(th.querySelector(".resize-handle")) return;
      const index=Number(th.dataset.logicalStart);
      const h=document.createElement("span");h.className="resize-handle";th.appendChild(h);
      h.addEventListener("mousedown",function(e){
        e.preventDefault();e.stopPropagation();
        const startX=e.clientX,start=widths[index];
        function move(ev){
          widths[index]=Math.max(28,Math.min(520,start+ev.clientX-startX));
          cg.children[index].style.width=widths[index]+"px";
          updateStickyOffsets(table,widths);
        }
        function up(){document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);saveTableWidths(table,widths);}
        document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
      });
      h.addEventListener("dblclick",function(e){
        e.preventDefault();e.stopPropagation();
        widths[index]=intrinsicColumnWidth(table,index);
        cg.children[index].style.width=widths[index]+"px";
        updateStickyOffsets(table,widths);
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
    let modal=document.getElementById("materialCardModal");
    if(!modal){
      modal=document.createElement("div");
      modal.id="materialCardModal";
      modal.className="material-modal-backdrop";
      document.body.appendChild(modal);
    }
    const levels=levelCodes();
    modal.innerHTML='<div class="material-card" role="dialog" aria-modal="true">' +
      '<div class="material-card-head"><div><div class="material-section-label">Раздел</div><div class="material-identity"><strong>'+esc(item.mark)+'</strong><span>'+esc(item.name)+'</span></div></div><button class="material-close" type="button" aria-label="Закрыть">×</button></div>' +
      '<div class="material-tabs"><button class="active" data-mtab="overview">Обзор</button><button data-mtab="projectEstimate">Проект и смета</button><button data-mtab="supplyMontage">Поставка и монтаж</button><button data-mtab="avrS29">АВР и С-29</button><button data-mtab="history">История</button></div>' +
      '<div class="material-body"></div></div>';
    modal.classList.add("open");
    function body(tab){
      const b=modal.querySelector(".material-body");
      if(tab==="overview"){
        b.innerHTML='<div class="material-overview"><section><h3>Исполнение</h3><div class="material-metrics"><div><span>Поставлено</span><strong>0 шт. / 0 м³</strong></div><div><span>Смонтировано</span><strong>0 шт. / 0 м³</strong></div><div><span>Запроцентовано</span><strong>0 шт. / 0 м³</strong></div><div><span>Списано</span><strong>0 м³</strong></div></div></section><section><h3>Количество и объём</h3><div class="material-metrics"><div><span>Всего по проекту</span><strong>'+fmt0(st.qty)+' шт. / '+fmt(st.m3)+' м³</strong></div><div><span>Объём 1 шт.</span><strong>'+(st.rows[0]?fmt(st.rows[0].volumePerPiece):"—")+' м³</strong></div><div><span>Осталось поставить</span><strong>'+fmt0(st.qty)+' шт.</strong></div><div><span>Осталось смонтировать</span><strong>'+fmt0(st.qty)+' шт.</strong></div></div></section></div><div class="material-cost-strip"><div><span>Стоимость</span><strong>—</strong></div><div><span>Стоимость единицы</span><strong>—</strong></div></div>'+(sourceOnly?'<div class="material-note">Исходная строка не связана с проектной номенклатурой. Карточка открыта в source-only режиме.</div>':'');
      } else if(tab==="projectEstimate"){
        const floorHead=levels.map(function(x){return '<th>'+esc(levelLabel(x))+'</th>';}).join("");
        const floorVals=levels.map(function(x){return '<td>'+fmt0(st.floors.get(x)||0)+'</td>';}).join("");
        const estRows=st.est.map(function(r){const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});return '<tr><td>'+esc(e?e.number:"")+'</td><td>'+esc(r.position)+'</td><td>'+esc(r.basis)+'</td><td>'+esc(r.name)+'</td><td class="num">'+fmt(r.quantity)+'</td></tr>';}).join("");
        b.innerHTML='<section class="material-section"><h3>Проект</h3><div class="floor-matrix-wrap"><table class="floor-matrix"><thead><tr><th>Секция</th>'+floorHead+'<th>Всего</th></tr></thead><tbody><tr><td>Дом</td>'+floorVals+'<td>'+fmt0(st.qty)+'</td></tr></tbody></table></div></section><section class="material-section"><h3>Связь со сметой</h3><table class="material-est-table"><thead><tr><th>№ сметы</th><th>Позиция</th><th>Обоснование</th><th>Наименование</th><th>Всего по смете</th></tr></thead><tbody>'+(estRows||'<tr><td colspan="5" class="material-note">Связанных строк сметы нет.</td></tr>')+'</tbody></table></section>';
      } else if(tab==="supplyMontage"){
        b.innerHTML='<section class="material-section"><h3>Поставка и монтаж</h3><div class="material-progress-row"><span>Поставлено</span><strong>0 / '+fmt0(st.qty)+' шт.</strong></div><div class="progress"><i style="width:0%"></i></div><div class="material-progress-row"><span>Смонтировано</span><strong>0 / '+fmt0(st.qty)+' шт.</strong></div><div class="progress"><i style="width:0%"></i></div><div class="material-note">Фактических документов поставки и монтажа в тестовой базе пока нет.</div></section>';
      } else if(tab==="avrS29"){
        b.innerHTML='<section class="material-section"><h3>АВР и С-29</h3><div class="material-note">Подписанные АВР и бухгалтерские снимки отсутствуют. Фиктивные факты не подставляются.</div></section>';
      } else {
        b.innerHTML='<section class="material-section"><h3>История</h3><div class="material-note">История будет формироваться из реальных импортов, связей и фактов. Технические ID здесь не выводятся.</div></section>';
      }
    }
    body("overview");
    modal.querySelector(".material-close").onclick=function(){modal.classList.remove("open");};
    modal.onclick=function(e){if(e.target===modal) modal.classList.remove("open");};
    modal.querySelectorAll("[data-mtab]").forEach(function(btn){btn.onclick=function(){modal.querySelectorAll("[data-mtab]").forEach(function(x){x.classList.toggle("active",x===btn);});body(btn.dataset.mtab);};});
    const card=modal.querySelector(".material-card"), head=modal.querySelector(".material-card-head");
    let drag=null;
    head.onmousedown=function(e){
      if(e.target.closest("button,input,select")) return;
      const r=card.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};card.classList.add("dragging");
      function move(ev){const left=Math.max(8,Math.min(window.innerWidth-r.width-8,ev.clientX-drag.x));const top=Math.max(8,Math.min(window.innerHeight-r.height-8,ev.clientY-drag.y));card.style.left=left+"px";card.style.top=top+"px";card.style.transform="none";}
      function up(){document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);card.classList.remove("dragging");}
      document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
    };
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
      if (tab === 1) return '<span class="context-caption">Текущая цена</span><span class="context-muted">НДС по объекту 0 %, участвует в формулах</span>';
      if (tab === 2) return '<span class="context-caption">ГПР</span><span class="context-muted">Помесячный финансовый план · без недель и дней</span><span class="spacer"></span><button class="context-link" type="button" data-gpr-action="spread">Разнести по месяцам</button><button class="context-link" type="button" data-gpr-action="display">Отображение</button><button class="context-link" type="button" data-gpr-action="excel">Экспорт Excel</button>';
      if (tab === 3) return '<span class="context-caption">Сверка</span><span class="context-muted">Ручные связи имеют приоритет</span>';
      return '<span class="context-caption">Журнал</span><span class="context-muted">Записи создаются из контрольных экранов</span>';
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
      if (tab === 0) return '<button class="context-link" type="button">Месяц ▾</button><span>·</span><button class="context-link" type="button">АВР ▾</button><span>·</span><button class="context-link" type="button">Версия ▾</button><span>·</span><span class="context-muted">Статус: нет акта</span>';
      if (tab === 1) return '<button class="context-link" type="button">Период: Весь период ▾</button><button class="context-link" type="button">Импорт Excel АВР</button>';
      return buildEstimateContext(0);
    }
    if (pageKey === "s29") {
      if (tab === 0) return '<button class="context-link" type="button">Месяц ▾</button><span>·</span><button class="context-link" type="button">АВР: нет ▾</button><span>·</span><span class="context-muted">остатки на дату —</span><span>·</span><span class="context-muted">бух. импорт —</span>';
      return '<span class="context-muted">Контекст текущего представления</span>';
    }
    if (pageKey === "supply") {
      if (tab === 1) return '<span class="context-caption">Документы поставки</span><span>Белые ТТН фиксируют фактическое поступление сразу; зелёные ТТН документально подтверждают его.</span><span class="spacer"></span><span class="context-muted">Двойной клик по строке — редактировать</span>';
      if (tab === 2) return '<span class="context-caption">Прайс поставщика</span><span>Позиции проекта сгруппированы по Рабочей сводке.</span><span class="spacer"></span><span class="context-muted">Состояние цены фильтруется в колонке «Прайс»</span>';
      return '<span class="context-muted">Данные по всему объекту</span>';
    }
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
    if (pageKey === "estimates") return tab === 0 || tab === 2;
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
      body = tableMessage("Нет строк по текущему фильтру.",3+4+levels.length*2);
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
              body += '</tr>';
            });
          });
        });
      }
    }

    const head1 = '<tr>' +
      '<th class="sticky-1" rowspan="2">№</th>' +
      '<th class="sticky-2 filterable-head" rowspan="2">' + filterHeader("Марка","mark") + '</th>' +
      '<th class="sticky-3 filterable-head" rowspan="2">' + filterHeader("Наименование","name") + '</th>' +
      '<th colspan="2">Секция 1</th><th colspan="2">Секция 2</th>' +
      levels.map(function(x){ return '<th colspan="2" class="floor-parent">' + esc(summaryLevelLabel(x)) + '</th>'; }).join("") +
      '</tr>';
    const head2 = '<tr>' +
      '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
      '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
      levels.map(function(){ return '<th class="vertical-sub"><span>Секция 1</span></th><th class="vertical-sub"><span>Секция 2</span></th>'; }).join("") +
      '</tr>';

    $("workArea").className = "work-area table-work spec-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table working-summary" data-table-key="spec-summary-v2"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div></div>';
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
      rows = rows.filter(function(r){ return passesSearch([r.position,r.basis,r.name]); })
        .filter(function(r){return rowPassesColumnFilters({position:r.position,basis:r.basis,name:r.name});});
      rows = sortRows(rows,{
        position:function(r){return r.position;},
        basis:function(r){return r.basis;},
        name:function(r){return r.name;}
      });
      if (!sortBucket()) rows.sort(function(a,b){ return Number(a.sort_order||0)-Number(b.sort_order||0); });
      if (!rows.length && (currentSearch() || Object.keys(filterBucket()).length)) return;

      const eKey = "est:estimate:"+e.number;
      body += estimateGroupRow("Смета №"+e.number+" · "+(e.name||""),rows,eKey,0,m);
      if (ui.collapsed.has(eKey)) return;

      const sections = dataState.estimateSections.filter(function(s){ return s.estimate_id === e.id; });
      sections.forEach(function(s) {
        const sRows = rows.filter(function(r){ return r.section_id === s.id; });
        if (!sRows.length) return;
        const sKey = "est:section:"+e.number+":"+s.id;
        body += estimateGroupRow(s.title,sRows,sKey,1,m);
        if (ui.collapsed.has(sKey) || ui.collapseLeaves) return;

        sRows.forEach(function(r) {
          const c = rowCost(r,m);
          const item=dataState.catalogItems.find(function(x){return x.mark===r.basis;});
          body += '<tr class="data-row" ' + (r.row_type==="material" ? 'data-material-id="'+esc(item?item.id:"")+'" data-material-mark="'+esc(r.basis||"")+'"' : '') + '>';
          body += '<td class="e-sticky-1 center"><span class="type-mark">' + (r.row_type === "work" ? "Р" : "М") + '</span></td>';
          body += filterCell("position",r.position,esc(r.position || ""),"e-sticky-2 center");
          body += filterCell("basis",r.basis,esc(r.basis || ""),"e-sticky-3");
          body += filterCell("name",r.name,esc(r.name || ""),"e-sticky-4");
          body += '<td class="center">' + esc(r.unit || "") + '</td>';
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
        '<th class="e-sticky-2 filterable-head" rowspan="2">' + filterHeader("Поз. сметы","position") + '</th>' +
        '<th class="e-sticky-3 filterable-head" rowspan="2">' + filterHeader("Обоснование","basis") + '</th>' +
        '<th class="e-sticky-4 filterable-head" rowspan="2">' + filterHeader("Наименование","name") + '</th>' +
        '<th rowspan="2">Ед. изм.</th>' +
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
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table est-table" data-table-key="estimate-main">' + head + '<tbody>' + body + '</tbody></table></div></div>';
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
    const body=rows.map(function(r){
      if(r.kind==="group") return '<tr class="group-only"><td class="center"></td><td colspan="7">'+esc(r.name)+'</td></tr>';
      no++;
      const cls=r.kind==="subtotal"?"subtotal":r.kind==="final"?"final":"";
      const pct=r.pct==null?"":String(r.id==="winter"?"2,5740":r.pct).replace(".",",");
      let k="";
      if(r.id==="forecastK") k='<input class="forecast-input" value="'+Number((ui.currentPrice||{}).forecast||1.0552).toFixed(4).replace(".",",")+'" aria-label="Прогнозный индекс">';
      else if(r.k!=null) k=Number(r.k).toFixed(4).replace(".",",");
      return '<tr class="'+cls+' data-row" data-formula-row="'+r.id+'"><td class="center">'+no+'</td>'+filterCell("name",r.name,esc(r.name),"")+'<td class="num" data-formula-cell="'+r.id+':pct">'+pct+'</td><td class="num rate-cell" data-formula-cell="'+r.id+':k">'+k+'</td><td class="num formula-amount" data-formula-cell="'+r.id+'">'+money(r.v)+'</td><td class="num muted">'+currentRefValue(r,"forecast")+'</td><td class="num muted">'+currentRefValue(r,"competition")+'</td><td class="num muted">'+currentRefValue(r,"both")+'</td></tr>';
    }).join("");
    $("workArea").className="work-area table-work current-price-work";
    $("workArea").innerHTML='<div class="formula-strip"><div class="formula-address">—</div><div class="formula-name"><b>fx</b><span>Выберите расчётную строку</span></div><div class="formula-expression"></div></div>'+
      '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table current-price-table" data-table-key="current-price"><thead><tr><th rowspan="2">№</th><th class="filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th><th rowspan="2">%</th><th rowspan="2">К-т</th><th rowspan="2">Текущая стоимость</th><th colspan="3">Справочно</th></tr><tr><th>с прогнозным</th><th>с конкурсным</th><th>с прогнозным и конкурсным</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
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
      document.querySelector(".formula-address").textContent="E"+(model.indexOf(r)+3);
      document.querySelector(".formula-name span").textContent=r.name;
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

  function gprMonths() {
    return [
      {key:"2026-12",year:"2026",month:"Дек",label:"Дек 2026",index:1},
      {key:"2027-01",year:"2027",month:"Янв",label:"Янв 2027",index:1},
      {key:"2027-02",year:"2027",month:"Фев",label:"Фев 2027",index:1},
      {key:"2027-03",year:"2027",month:"Мар",label:"Мар 2027",index:1},
      {key:"2027-04",year:"2027",month:"Апр",label:"Апр 2027",index:1},
      {key:"2027-05",year:"2027",month:"Май",label:"Май 2027",index:1}
    ];
  }

  function gprAssignments() {
    if (!ui.gprAssignments) {
      try { ui.gprAssignments = JSON.parse(localStorage.getItem("filimonova.gpr.assignments") || "{}"); }
      catch(_) { ui.gprAssignments = {}; }
    }
    return ui.gprAssignments;
  }

  function estimateScope(e) {
    const name=String(e && e.name || "");
    const section=name.includes("Секция 2") ? "Секция 2" : name.includes("Секция 1") ? "Секция 1" : "";
    const zone=name.includes("Цоколь") ? "Цоколь" : name.includes("Выше 0.000") ? "Выше 0.000" : "";
    return {section:section,zone:zone};
  }

  function gprMaterialMonthQty(row,e,monthKey) {
    const item=dataState.catalogItems.find(function(x){return x.mark===row.basis;});
    if(!item) return 0;
    const scope=estimateScope(e);
    let qty=0;
    dataState.specRows.forEach(function(sr){
      if(sr.catalog_item_id!==item.id) return;
      const sec=dataState.specSections.find(function(x){return x.id===sr.section_id;});
      if(!sec) return;
      if(scope.section && sec.building_section!==scope.section) return;
      if(scope.zone && sec.zone!==scope.zone) return;
      dataState.specQuantities.forEach(function(q){
        if(q.specification_row_id!==sr.id) return;
        if(gprAssignments()[q.level_code]===monthKey) qty+=Number(q.quantity||0);
      });
    });
    return qty;
  }

  function gprRowMonthQty(row,e,monthKey,estimateRows) {
    if(row.row_type==="material") return gprMaterialMonthQty(row,e,monthKey);
    const materialRows=estimateRows.filter(function(x){return x.row_type==="material";});
    const allMaterial=materialRows.reduce(function(sum,mr){return sum+Number(mr.quantity||0);},0);
    if(!allMaterial) return 0;
    const monthMaterial=materialRows.reduce(function(sum,mr){return sum+gprMaterialMonthQty(mr,e,monthKey);},0);
    return Number(row.quantity||0)*(monthMaterial/allMaterial);
  }

  function gprRowAmounts(row,e,estimateRows,m) {
    const c=rowCost(row,m);
    const P=ui.currentPrice||{forecast:1.0552,competition:1};
    const unitAtStart=Number(c.total_unit||0)*Number(P.competition||1)*Number(P.forecast||1);
    const totalAtStart=Number(row.quantity||0)*unitAtStart;
    const months={};
    gprMonths().forEach(function(month){
      const q=gprRowMonthQty(row,e,month.key,estimateRows);
      months[month.key]=q*unitAtStart*Number(month.index||1);
    });
    return {unit:unitAtStart,total:totalAtStart,months:months};
  }

  function gprGroupRow(label,rows,e,key,depth,m) {
    registerGroup(key);
    const monthTotals={};
    let total=0;
    gprMonths().forEach(function(mon){monthTotals[mon.key]=0;});
    rows.forEach(function(r){
      const a=gprRowAmounts(r,e,rows,m);
      total+=a.total;
      gprMonths().forEach(function(mon){monthTotals[mon.key]+=a.months[mon.key]||0;});
    });
    let html='<tr class="group-row group-toggle" data-group-key="'+esc(key)+'">';
    html+='<td colspan="4" class="est-group-title gpr-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>';
    html+='<td></td><td></td><td></td><td class="num strong-num">'+money(total)+'</td>';
    gprMonths().forEach(function(mon){html+='<td class="num gpr-month group-month">'+money(monthTotals[mon.key])+'</td>';});
    html+='</tr>';
    return html;
  }

  function renderGprPlaceholder() {
    const m=maps(),months=gprMonths();
    let body="";
    ui.currentGroupKeys=[];

    dataState.estimates.filter(function(e){return ui.estimates[e.number]!==false;}).forEach(function(e){
      let erows=dataState.estimateRows.filter(function(r){return r.estimate_id===e.id;});
      erows=erows.filter(function(r){return passesSearch([r.position,r.basis,r.name]) && rowPassesColumnFilters({position:r.position,basis:r.basis,name:r.name});});
      erows=sortRows(erows,{position:function(r){return r.position;},basis:function(r){return r.basis;},name:function(r){return r.name;}});
      if(!sortBucket()) erows.sort(function(x,y){return Number(x.sort_order||0)-Number(y.sort_order||0);});
      if(!erows.length && (currentSearch()||Object.keys(filterBucket()).length)) return;

      const eKey="gpr:estimate:"+e.number;
      body+=gprGroupRow("Смета №"+e.number+" · "+(e.name||""),erows,e,eKey,0,m);
      if(ui.collapsed.has(eKey)) return;

      const sections=dataState.estimateSections.filter(function(x){return x.estimate_id===e.id;});
      sections.forEach(function(sec){
        const sRows=erows.filter(function(r){return r.section_id===sec.id;});
        if(!sRows.length) return;
        const sKey="gpr:section:"+e.number+":"+sec.id;
        body+=gprGroupRow(sec.title,sRows,e,sKey,1,m);
        if(ui.collapsed.has(sKey)||ui.collapseLeaves) return;

        sRows.forEach(function(r){
          const a=gprRowAmounts(r,e,sRows,m);
          const item=dataState.catalogItems.find(function(x){return x.mark===r.basis;});
          body+='<tr class="data-row '+(r.row_type==="material"?'gpr-material-row':'gpr-work-row')+'" '+(r.row_type==="material"?'data-material-id="'+esc(item?item.id:"")+'" data-material-mark="'+esc(r.basis||"")+'"':'')+'>';
          body+='<td class="e-sticky-1 center"><span class="type-mark">'+(r.row_type==="material"?"М":"Р")+'</span></td>';
          body+=filterCell("position",r.position,esc(r.position),"e-sticky-2 center");
          body+=filterCell("basis",r.basis,esc(r.basis),"e-sticky-3");
          body+=filterCell("name",r.name,esc(r.name),"e-sticky-4");
          body+='<td class="center">'+esc(r.unit||"")+'</td><td class="num">'+fmt(r.quantity)+'</td><td class="num">'+money(a.unit)+'</td><td class="num">'+money(a.total)+'</td>';
          months.forEach(function(mon){body+='<td class="num gpr-month">'+money(a.months[mon.key])+'</td>';});
          body+='</tr>';
        });
      });
    });

    if(!body) body=tableMessage("Нет строк по текущему фильтру.",8+months.length);

    const years=[];
    months.forEach(function(mon){
      let y=years.find(function(x){return x.year===mon.year;});
      if(!y){y={year:mon.year,count:0};years.push(y);}
      y.count++;
    });
    const yearHead=years.map(function(y){return '<th class="gpr-year" colspan="'+y.count+'">'+esc(y.year)+'</th>';}).join("");
    const monthHead=months.map(function(mon){return '<th class="gpr-month-head">'+esc(mon.month)+'</th>';}).join("");

    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table est-table gpr-table" data-table-key="gpr-v2"><thead>'+
      '<tr><th class="e-sticky-1" rowspan="2">Тип</th><th class="e-sticky-2 filterable-head" rowspan="2">'+filterHeader("Поз. сметы","position")+'</th><th class="e-sticky-3 filterable-head" rowspan="2">'+filterHeader("Обоснование","basis")+'</th><th class="e-sticky-4 filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th><th rowspan="2">Ед. изм.</th><th rowspan="2">Кол-во</th><th rowspan="2">Цена на начало работ</th><th rowspan="2">Стоимость на начало работ</th>'+yearHead+'</tr>'+
      '<tr>'+monthHead+'</tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function openGprAllocationModal() {
    const months=gprMonths(),levels=levelCodes(),existing=gprAssignments();
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
    modal.innerHTML='<div class="gpr-modal"><div class="gpr-modal-head"><strong>Разнести по месяцам</strong><button type="button" class="gpr-modal-close">×</button></div>'+
      '<div class="gpr-modal-body"><div class="gpr-alloc-scroll"><table class="gpr-alloc-table"><thead><tr><th rowspan="2">Этаж / уровень</th>'+years.map(function(y){return '<th colspan="'+y.count+'">'+esc(y.year)+'</th>';}).join("")+'</tr><tr>'+months.map(function(mon){return '<th>'+esc(mon.month)+'</th>';}).join("")+'</tr></thead><tbody>'+
      levels.map(function(level){
        return '<tr><td>'+esc(summaryLevelLabel(level))+'</td>'+months.map(function(mon){
          return '<td><input type="checkbox" class="gpr-month-check" data-level="'+esc(level)+'" data-month="'+esc(mon.key)+'" '+(existing[level]===mon.key?'checked':'')+'></td>';
        }).join("")+'</tr>';
      }).join("")+'</tbody></table></div></div>'+
      '<div class="gpr-modal-foot"><button type="button" class="context-link gpr-cancel">Отмена</button><span class="spacer"></span><button type="button" class="context-link gpr-apply">Применить к графику</button></div></div>';
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
    modal.querySelector(".gpr-apply").onclick=function(){
      const next={};
      modal.querySelectorAll(".gpr-month-check:checked").forEach(function(check){next[check.dataset.level]=check.dataset.month;});
      ui.gprAssignments=next;
      localStorage.setItem("filimonova.gpr.assignments",JSON.stringify(next));
      close();
      rerenderContent();
    };
  }

  function openGprDisplay() {
    let pop=document.getElementById("gprDisplayPopover");
    if(!pop){
      pop=document.createElement("div");
      pop.id="gprDisplayPopover";
      pop.className="gpr-display-popover";
      pop.innerHTML='<strong>Отображение</strong><label><input type="checkbox" checked data-gpr-show="price"> Цена на начало работ</label><label><input type="checkbox" checked data-gpr-show="amount"> Стоимость на начало работ</label><label><input type="checkbox" checked data-gpr-show="months"> Месячные суммы</label><label><input type="checkbox" data-gpr-show="index"> Индекс месяца</label><label><input type="checkbox" checked> Материалы</label><label><input type="checkbox" checked> Работы</label>';
      document.body.appendChild(pop);
    }
    const btn=document.querySelector('[data-gpr-action="display"]');
    const r=btn.getBoundingClientRect();
    pop.style.right=Math.max(8,window.innerWidth-r.right)+"px";
    pop.style.top=(r.bottom+5)+"px";
    pop.classList.toggle("open");
  }

  function wireGprControls() {
    const spread=document.querySelector('[data-gpr-action="spread"]');
    const display=document.querySelector('[data-gpr-action="display"]');
    const excel=document.querySelector('[data-gpr-action="excel"]');
    if(spread) spread.onclick=openGprAllocationModal;
    if(display) display.onclick=openGprDisplay;
    if(excel) excel.onclick=function(){alert("Экспорт ГПР формируется только в Excel (.xlsx).");};
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
    const head='<thead><tr>'+
      '<th class="filterable-head">'+filterHeader("Дата поступления","date")+'</th>'+
      '<th class="filterable-head">'+filterHeader("Тип","type")+'</th>'+
      '<th class="filterable-head">'+filterHeader("№ ТТН","ttn")+'</th>'+
      '<th class="filterable-head">'+filterHeader("Файл","file")+'</th>'+
      '<th>Позиций</th><th>Шт.</th><th>м³</th><th>Без НДС</th><th>НДС</th><th>С НДС</th><th>Состояние</th></tr></thead>';
    $("workArea").innerHTML =
      '<div class="engineering-shell"><div class="local-action-row"><button class="local-text-action" type="button">+ Добавить накладную</button></div>' +
      '<div class="engineering-scroll"><table class="eng-table supply-doc-table" data-table-key="supply-documents">'+head+
      '<tbody>' + tableMessage("Накладных пока нет. Фактические поступления не подменяются тестовыми документами.",11) + '</tbody></table></div></div>';
  }

  function renderSupplierPrice() {
    let rows=buildWorkingSummaryRows().filter(function(r){return passesSearch([r.mark,r.name,"Нет цены"]);})
      .filter(function(r){return rowPassesColumnFilters({mark:r.mark,name:r.name,price:"Нет цены"});});
    rows=sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;},price:function(){return "Нет цены";}});
    ui.currentGroupKeys=[];
    let body="";
    function vector(list){
      let qty=0,vol=0;list.forEach(function(r){const q=Number(r.bySection["Секция 1"]||0)+Number(r.bySection["Секция 2"]||0);qty+=q;vol+=q*Number(r.volumePerPiece||0);});
      return {qty:qty,vol:vol};
    }
    function group(label,list,key,depth){
      registerGroup(key);const v=vector(list);
      return '<tr class="group-row group-toggle" data-group-key="'+esc(key)+'"><td colspan="3" class="group-title spec-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>'+
        '<td class="num">'+fmt0(v.qty)+'</td><td></td><td class="num">'+fmt(v.vol)+'</td><td></td><td></td><td></td><td></td><td></td></tr>';
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
              body+='<tr class="data-row" data-material-id="'+esc(r.catalogItemId||"")+'"><td class="sticky-1 center">'+(index+1)+'</td>'+
                filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3")+
                '<td class="num">'+fmt0(q)+'</td><td class="num">'+fmt(r.volumePerPiece)+'</td><td class="num">'+fmt(q*r.volumePerPiece)+'</td>'+
                '<td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>'+
                filterCell("price","Нет цены",'<span class="price-state none">Нет цены</span>',"status-cell")+'</tr>';
            });
          });
        });
      }
    }
    const stats='<span>Рабочая сводка: '+rows.length+' · связано с прайсом: 0 · без цены: '+rows.length+'</span>';
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="local-action-row"><button class="local-text-action" type="button">Импорт прайса</button><span class="local-meta">'+stats+'</span></div><div class="engineering-scroll"><table class="eng-table price-table" data-table-key="supplier-price">'+
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
      let rows = dataState.estimateRows.filter(function(r){return r.estimate_id===e.id && passesSearch([r.position,r.basis,r.name]) && rowPassesColumnFilters({position:r.position,basis:r.basis,name:r.name});});
      if (!rows.length && currentSearch()) return;
      const key = "ks6:"+e.number;
      registerGroup(key);
      body += '<tr class="group-row group-toggle" data-group-key="'+key+'"><td colspan="5" class="est-group-title"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc("Смета №"+e.number+" · "+e.name)+'</td><td class="num">'+fmt(rows.reduce(function(a,r){return a+Number(r.quantity||0);},0))+'</td><td></td><td></td><td class="num">'+fmt(rows.reduce(function(a,r){return a+Number(r.quantity||0);},0))+'</td></tr>';
      if (ui.collapsed.has(key) || ui.collapseLeaves) return;
      rows.forEach(function(r) {
        body += '<tr class="data-row"><td>'+ (r.row_type==="work"?"Р":"М") +'</td><td>'+esc(r.position)+'</td><td>'+esc(r.basis)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.unit)+'</td><td class="num">'+fmt(r.quantity)+'</td><td class="num"></td><td class="num">0</td><td class="num">'+fmt(r.quantity)+'</td></tr>';
      });
    });
    if (!body) body = tableMessage("Нет строк по текущему фильтру.",9);
    $("workArea").className = "work-area table-work";
    $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table ks-table" data-table-key="ks6"><thead><tr><th>Тип</th><th class="filterable-head">'+filterHeader("Поз. сметы","position")+'</th><th class="filterable-head">'+filterHeader("Обоснование","basis")+'</th><th class="filterable-head">'+filterHeader("Наименование","name")+'</th><th>Ед. изм.</th><th>По смете</th><th>Сен. 26</th><th>Запроцентовано</th><th>Остаток</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderS29(tab) {
    const titles = ["Расчёт С-29","Бухгалтерия","Связи с бухгалтерией","Экономия / перерасход"];
    $("workArea").className = "work-area content-work";
    $("workArea").innerHTML = '<div class="review-panel"><div class="review-panel-title">'+esc(titles[tab] || "С-29")+'</div>' +
      '<div class="review-note">Тестовые спецификации и сметы уже в базе. Для С-29 нужен подписанный АВР и бухгалтерский снимок; их пока намеренно не создаём, чтобы не подменять реальную логику фиктивным фактом.</div></div>';
  }

  function renderRecon() {
    const qm=quantityMap();
    let rows=dataState.estimateRows.filter(function(r){return r.row_type==="material" && passesSearch([r.position,r.basis,r.name]);});
    rows=rows.filter(function(r){return rowPassesColumnFilters({position:r.position,basis:r.basis,name:r.name});});
    rows=sortRows(rows,{position:function(r){return r.position;},basis:function(r){return r.basis;},name:function(r){return r.name;}});
    let body=rows.map(function(r){
      const e=dataState.estimates.find(function(x){return x.id===r.estimate_id;});
      const item=dataState.catalogItems.find(function(x){return x.mark===r.basis;});
      const srows=item?dataState.specRows.filter(function(x){return x.catalog_item_id===item.id;}):[];
      let projectQty=0;srows.forEach(function(sr){const m=qm.get(sr.id);if(m)m.forEach(function(v){projectQty+=Number(v||0);});});
      const diff=projectQty-Number(r.quantity||0),linked=!!item;
      return '<tr class="data-row" '+(item?'data-material-id="'+esc(item.id)+'"':'data-material-mark="'+esc(r.basis||"")+'"')+'>'+
        '<td class="center">'+esc(srows[0]?srows[0].position_no:"—")+'</td><td>'+esc(item?item.mark:"—")+'</td><td>'+esc(item?item.name:"—")+'</td><td class="num">'+(linked?fmt0(projectQty):"—")+'</td>'+
        '<td class="center">'+esc(e?e.number:"")+'</td>'+filterCell("position",r.position,esc(r.position),"center")+filterCell("basis",r.basis,esc(r.basis),"")+
        '<td>'+esc(item?item.mark:r.basis)+'</td>'+filterCell("name",r.name,esc(r.name),"")+'<td class="num">'+fmt(r.quantity)+'</td>'+
        '<td class="num '+(diff<0?"warning":"")+'">'+(linked?fmt(diff):"—")+'</td>'+
        '<td><span class="soft-status '+(linked?"ok":"warn")+'">'+(linked?"Связано":"Без связи")+'</span></td><td>Авто</td><td>'+(linked && diff===0?"Нет":linked?"Количество":"Связь")+'</td><td class="center">□</td><td><span class="link">Изменить</span></td></tr>';
    }).join("");
    if(!body)body=tableMessage("Нет строк по текущему фильтру.",16);
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table recon-table" data-table-key="estimate-recon"><thead><tr><th colspan="4">Спецификация</th><th colspan="6">Смета</th><th rowspan="2">Разница</th><th rowspan="2">Сопоставление</th><th rowspan="2">Способ</th><th rowspan="2">Расхождение</th><th rowspan="2">Журнал</th><th rowspan="2">Действия</th></tr>'+
      '<tr><th>Поз. спецификации</th><th>Марка</th><th>Наименование по спецификации</th><th>Проект, шт.</th><th>№ сметы</th><th class="filterable-head">'+filterHeader("Поз. сметы","position")+'</th><th class="filterable-head">'+filterHeader("Обоснование","basis")+'</th><th>Принятое обоснование</th><th class="filterable-head">'+filterHeader("Наименование по смете","name")+'</th><th>Смета, шт.</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }

  function renderEstimateJournal() {
    $("workArea").className="work-area table-work";
    $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table journal-table" data-table-key="estimate-journal"><thead><tr><th>№ сметы</th><th>Раздел</th><th>Поз. сметы</th><th>Обоснование</th><th>Расхождение</th><th>Комментарий</th><th>Состояние</th><th>Действия</th></tr></thead><tbody>'+tableMessage("В журнал ещё не добавлены контрольные записи.",8)+'</tbody></table></div></div>';
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
      return renderEstimateJournal();
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
    wireGprControls();

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