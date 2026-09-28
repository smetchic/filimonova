(() => {
  const cfg = window.FILIMONOVA_CONFIG;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<div style="padding:24px;font-family:Segoe UI">Ошибка загрузки конфигурации.</div>';
    return;
  }

  const reviewMode = new URLSearchParams(window.location.search).get("review") === "1";

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

  const pages = {
    home: {
      section: "Обзор",
      title: "Главная",
      subtitle: "Сводная информация по объекту",
      tabs: ["Обзор"],
      context: () => '<span class="context-muted">Контекст страницы</span>',
      serviceLeft: () => "",
      hierarchical: false
    },
    spec: {
      section: "Проект",
      title: "Спецификация",
      subtitle: "Проектная структура ЖБИ и рабочая сводка",
      tabs: ["По проекту", "Рабочая сводка"],
      context: () => checks(["Все","Секция 1","Секция 2","Цокольные","Выше 0.000","Лестницы"]),
      serviceLeft: () => '<span class="legend-item"><span class="legend-dot supply"></span>Поставка</span><span class="legend-item"><span class="legend-dot montage"></span>Монтаж</span><span class="legend-item"><span class="legend-dot avr"></span>АВР</span>',
      hierarchical: true
    },
    estimates: {
      section: "Проект",
      title: "Сметы",
      subtitle: "Локальные сметы объекта и расчёт стоимости",
      tabs: ["Смета","Текущая цена","График производства работ","Сверка","Журнал"],
      context: (tab) => tab === 0 ? checks(["Все","№200","№201","№202","№203","№207"]) : '<span class="context-muted">Контекст текущего представления</span>',
      serviceLeft: () => "",
      hierarchical: true
    },
    supply: {
      section: "Исполнение",
      title: "Поставка",
      subtitle: "Поступления, остатки на объекте и цены поставщика",
      tabs: ["Сводка поставки","Накладные","Прайс поставщика"],
      context: () => '<span class="context-muted">Контекст текущего представления</span>',
      serviceLeft: () => "",
      hierarchical: true
    },
    montage: {
      section: "Исполнение",
      title: "Монтаж",
      subtitle: "Фактический монтаж по датам, этажам и секциям",
      tabs: ["Календарь","3D модель"],
      context: () => '<span class="context-caption">Показывать:</span>' + checksHtml(["Все","Секция 1","Секция 2"]) + '<span class="context-link">Уровень ▾</span><span class="context-link">Период / месяц ▾</span>',
      serviceLeft: () => '<span class="context-muted">ЛКМ +1 · ПКМ −1</span>',
      hierarchical: false
    },
    avr: {
      section: "Исполнение",
      title: "АВР — акты выполненных работ",
      subtitle: "Импорт факта по панелям, расчёт акта и накопительный контроль 6-КС",
      tabs: ["Расчёт АВР","Реестр АВР","Журнал 6-КС"],
      context: (tab) => {
        if (tab === 0) return '<button class="context-link" type="button">Месяц ▾</button><span>·</span><button class="context-link" type="button">АВР ▾</button><span>·</span><button class="context-link" type="button">Версия ▾</button><span>·</span><span class="context-muted">Статус: —</span>';
        if (tab === 1) return '<button class="context-link" type="button">Период: Весь период ▾</button><button class="context-link" type="button">Импорт Excel АВР</button>';
        return checks(["Все","№200","№201","№202","№203","№207"]);
      },
      serviceLeft: () => "",
      hierarchical: true
    },
    s29: {
      section: "Исполнение",
      title: "С-29 — списание материалов",
      subtitle: "АВР в шт. → объём в м³ → бухгалтерские остатки → экономия/перерасход",
      tabs: ["Расчёт С-29","Бухгалтерия","Связи с бухгалтерией","Экономия / перерасход"],
      context: (tab) => tab === 0
        ? '<button class="context-link" type="button">Месяц ▾</button><span>·</span><button class="context-link" type="button">АВР ▾</button><span>·</span><span class="context-muted">остатки на дату —</span><span>·</span><span class="context-muted">бух. импорт —</span>'
        : '<span class="context-muted">Контекст текущего представления</span>',
      serviceLeft: () => "",
      hierarchical: true
    },
    recon: {
      section: "Контроль",
      title: "Сверка",
      subtitle: "Сопоставление спецификации и смет",
      tabs: ["Сверка"],
      context: () => '<span class="context-muted">Контекст страницы</span>',
      serviceLeft: () => "",
      hierarchical: true
    },
    diffs: {
      section: "Контроль",
      title: "Расхождения",
      subtitle: "Контроль различий между проектными и сметными данными",
      tabs: ["Расхождения"],
      context: () => '<span class="context-muted">Контекст страницы</span>',
      serviceLeft: () => "",
      hierarchical: false
    },
    links: {
      section: "Контроль",
      title: "Связи работ",
      subtitle: "Связи материалов и работ по строкам смет",
      tabs: ["Связи работ"],
      context: () => '<span class="context-muted">Контекст страницы</span>',
      serviceLeft: () => "",
      hierarchical: true
    },
    import: {
      section: "Данные",
      title: "Импорт",
      subtitle: "Рабочая область импорта данных проекта",
      tabs: ["Импорт"],
      context: () => '<span class="context-muted">Контекст импорта</span>',
      serviceLeft: () => "",
      hierarchical: false
    },
    docs: {
      section: "Система",
      title: "Документы",
      subtitle: "Документы проекта",
      tabs: ["Документы"],
      context: () => '<span class="context-muted">Контекст страницы</span>',
      serviceLeft: () => "",
      hierarchical: false
    },
    settings: {
      section: "Система",
      title: "Настройки",
      subtitle: "Параметры проекта и интерфейса",
      tabs: ["Настройки"],
      context: () => '<span class="context-muted">Контекст страницы</span>',
      serviceLeft: () => "",
      hierarchical: false
    }
  };

  let activePage = localStorage.getItem("filimonova.ui.page") || "home";
  if (!pages[activePage]) activePage = "home";
  const activeTabs = {};

  function setStatus(el, message, type="") {
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

  function checks(items) {
    return '<span class="context-caption">Показывать:</span>' + checksHtml(items);
  }

  function checksHtml(items) {
    return items.map((x, i) => '<label class="check"><input type="checkbox"' + (i === 0 ? ' checked' : '') + '><span>' + x + '</span></label>').join("");
  }

  function renderPage(pageKey, tabIndex = null) {
    const page = pages[pageKey] || pages.home;
    activePage = pageKey;
    localStorage.setItem("filimonova.ui.page", pageKey);

    let tab = tabIndex == null ? (activeTabs[pageKey] || 0) : tabIndex;
    if (tab < 0 || tab >= page.tabs.length) tab = 0;
    activeTabs[pageKey] = tab;

    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.page === pageKey);
    });

    $("breadcrumbs").innerHTML = '<span>Филимонова</span><span class="slash">/</span><span>' + page.section + '</span><span class="slash">/</span><span class="current">' + page.title + '</span>';
    $("pageTitle").textContent = page.title;
    $("pageSubtitle").textContent = page.subtitle;

    $("pageTabs").innerHTML = page.tabs.map((label, i) =>
      '<button class="page-tab' + (i === tab ? ' active' : '') + '" type="button" data-tab="' + i + '">' + label + '</button>'
    ).join("");

    $("pageTabs").querySelectorAll(".page-tab").forEach(btn => {
      btn.addEventListener("click", () => renderPage(pageKey, Number(btn.dataset.tab)));
    });

    $("contextRow").innerHTML = page.context(tab);
    $("serviceLeft").innerHTML = page.serviceLeft(tab);
    $("serviceRight").innerHTML = page.hierarchical
      ? '<button class="service-action" type="button">Свернуть всё</button><button class="service-action" type="button">Развернуть всё</button>'
      : '';

    $("workArea").innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-kicker">UI · этап 1</div>' +
        '<h2>' + page.title + ' · ' + page.tabs[tab] + '</h2>' +
        '<p>Рабочая область пока намеренно пустая — согласовываем B1–B7.</p>' +
      '</div>';
  }

  tabLogin.addEventListener("click", () => switchAuthTab("login"));
  tabSignup.addEventListener("click", () => switchAuthTab("signup"));

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(loginStatus, "Вход…");
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    button.disabled = false;
    if (error) return setStatus(loginStatus, error.message, "error");
    setStatus(loginStatus, "Вход выполнен.", "ok");
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = signupForm.querySelector('button[type="submit"]');
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;
    const password2 = $("signupPassword2").value;

    if (password !== password2) return setStatus(signupStatus, "Пароли не совпадают.", "error");
    if (password.length < 6) return setStatus(signupStatus, "Пароль должен содержать не менее 6 символов.", "error");

    button.disabled = true;
    setStatus(signupStatus, "Создание учётной записи…");
    const redirectTo = window.location.origin + window.location.pathname;
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    button.disabled = false;
    if (error) return setStatus(signupStatus, error.message, "error");
    setStatus(signupStatus, data.session ? "Учётная запись создана." : "Учётная запись создана. Подтвердите email по ссылке из письма, затем войдите.", "ok");
  });

  async function logout() {
    await client.auth.signOut();
  }
  $("logoutBtn").addEventListener("click", logout);
  $("deniedLogoutBtn").addEventListener("click", logout);

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => renderPage(btn.dataset.page));
  });

  const searchBox = $("globalSearch");
  const searchInput = $("searchInput");
  const searchClear = $("searchClear");
  searchInput.addEventListener("input", () => searchBox.classList.toggle("has-value", !!searchInput.value));
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchBox.classList.remove("has-value");
    searchInput.focus();
  });

  async function isAdmin(userId) {
    const { data, error } = await client.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async function ensureProject(user) {
    let { data, error } = await client.from("projects").select("id,code,name,status,created_at").order("created_at",{ascending:true}).limit(1);
    if (error) throw error;
    if (data && data.length) return data[0];

    const inserted = await client.from("projects").insert({
      code: cfg.projectCode,
      name: cfg.projectName,
      created_by: user.id,
      status: "active"
    }).select("id,code,name,status,created_at").single();

    if (inserted.error) throw inserted.error;
    return inserted.data;
  }

  async function renderSession(session) {
    if (reviewMode) {
      authView.classList.add("hidden");
      deniedView.classList.add("hidden");
      appView.classList.remove("hidden");
      $("userEmail").textContent = "UI REVIEW";
      $("adminState").textContent = "Режим просмотра интерфейса";
      $("projectName").textContent = cfg.projectName;
      $("projectStatus").textContent = "Без данных";
      $("projectId").textContent = "—";
      renderPage(activePage);
      return;
    }

    if (!session?.user) {
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
      $("userEmail").textContent = session.user.email || "—";
      $("adminState").textContent = "Глобальный администратор";
      $("projectName").textContent = project.name || cfg.projectName;
      $("projectId").textContent = project.id;
      $("projectStatus").textContent = project.status || "active";

      appView.classList.remove("hidden");
      renderPage(activePage);
    } catch (err) {
      appView.classList.add("hidden");
      deniedView.classList.remove("hidden");
      deniedView.querySelector(".auth-subtitle").textContent = "Ошибка доступа: " + (err?.message || String(err));
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    if (reviewMode) return;
    setTimeout(() => renderSession(session), 0);
  });

  if (reviewMode) {
    renderSession(null);
  } else {
    client.auth.getSession().then(({data}) => renderSession(data.session));
  }
})();