function switchAuthTab(name) {
  const login = name === "login";
  tabLogin.classList.toggle("active", login);
  tabSignup.classList.toggle("active", !login);
  loginForm.classList.toggle("hidden", !login);
  signupForm.classList.toggle("hidden", login);
  setStatus(loginStatus, "");
  setStatus(signupStatus, "");
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

let searchRenderTimer=null;
$("searchInput").addEventListener("input",function() {
  const key = currentViewKey();
  ui.search[key] = $("searchInput").value;
  $("globalSearch").classList.toggle("has-value",!!$("searchInput").value);
  if(searchRenderTimer) clearTimeout(searchRenderTimer);
  searchRenderTimer=setTimeout(function(){
    searchRenderTimer=null;
    rerenderContent();
  },90);
});
$("searchClear").addEventListener("click",function() {
  const key = currentViewKey();
  ui.search[key] = "";
  $("searchInput").value = "";
  $("globalSearch").classList.remove("has-value");
  if(searchRenderTimer){clearTimeout(searchRenderTimer);searchRenderTimer=null;}
  rerenderContent();
  $("searchInput").focus();
});

async function isAdmin(userId) {
  const result = await client.from("app_admins").select("user_id").eq("user_id",userId).maybeSingle();
  if (result.error) throw result.error;
  return !!result.data;
}

// Objects (projects). The chosen object is remembered in the browser; without a choice
// the original object (cfg.projectCode) opens. "*" keeps this working before the settings column exists.
const OBJECT_STORAGE_KEY="filimonova.projectId";
let objectList=[];

async function loadObjectList() {
  const result = await client.from("projects").select("*").order("created_at");
  if (result.error) throw result.error;
  objectList = result.data || [];
  return objectList;
}

async function ensureProject(user) {
  const list = await loadObjectList();
  const saved = localStorage.getItem(OBJECT_STORAGE_KEY);
  const found = list.find(function(p){return p.id===saved;}) ||
    list.find(function(p){return p.code===cfg.projectCode;}) || list[0];
  if (found) return found;

  const result = await client.from("projects").insert({
    code:cfg.projectCode,
    name:cfg.projectName,
    created_by:user.id,
    status:"active"
  }).select("*").single();
  if (result.error) throw result.error;
  objectList=[result.data];
  return result.data;
}

function switchObject(id) {
  localStorage.setItem(OBJECT_STORAGE_KEY,id);
  window.location.reload();
}

function showProjectIdentity(project) {
  const name = project.name || cfg.projectName;
  const brand = document.querySelector("#appView .brand");
  if (brand) {
    brand.querySelector(".brand-mark").textContent = name.trim().charAt(0).toUpperCase() || "Ф";
    brand.querySelector(".brand-title").textContent = name;
    brand.querySelector(".brand-sub").textContent = objectList.length > 1 ? "ПТО · сменить объект ▾" : "ПТО · объект ▾";
    brand.title = "Объекты и настройки объекта";
  }
  document.title = name + " · ПТО";
}

function objectSettingsMissing(err) {
  const text = String(err && (err.message || err.details) || "");
  return /settings/.test(text) && /column|schema cache/i.test(text);
}

const OBJECT_ZONES=["Цоколь","Выше 0.000","Лестницы"];
const OBJECT_STAIRS_SECTION="Элементы лестниц";

function objectEstimateRowHtml(e, sectionCount) {
  const sections = [];
  for (let i = 1; i <= sectionCount; i++) sections.push("Секция " + i);
  sections.push(OBJECT_STAIRS_SECTION);
  if (e.section && !sections.includes(e.section)) sections.push(e.section);
  return '<tr data-object-estimate>' +
    '<td><input type="text" data-field="number" value="' + esc(e.number || "") + '" placeholder="№"></td>' +
    '<td><select data-field="section">' + sections.map(function(s){return '<option' + (s===e.section?' selected':'') + '>' + esc(s) + '</option>';}).join("") + '</select></td>' +
    '<td><select data-field="zone">' + OBJECT_ZONES.map(function(z){return '<option' + (z===e.zone?' selected':'') + '>' + esc(z) + '</option>';}).join("") + '</select></td>' +
    '<td><button type="button" class="context-link" data-object-estimate-remove title="Убрать смету">×</button></td>' +
  '</tr>';
}

function openObjectDialog() {
  const project = dataState.project;
  if (!project) return;
  const settings = objectSettings(project);
  const backdrop = document.createElement("div");
  backdrop.className = "spec-import-backdrop open execution-confirm";
  const list = objectList.map(function(p){
    const current = p.id === project.id;
    return '<button type="button" class="object-list-item' + (current ? ' current' : '') + '" data-object-id="' + esc(p.id) + '">' +
      '<strong>' + esc(p.name || "Без названия") + '</strong><span>' + esc(current ? "открыт сейчас" : (p.full_name || "")) + '</span></button>';
  }).join("");
  const settingsHtml = !ui.isAdmin ? "" :
    '<div class="object-settings"><div class="object-settings-title">Настройки объекта «' + esc(project.name || "") + '»</div>' +
    '<div class="supplier-import-fields" style="grid-template-columns:1fr 1fr">' +
      '<label><span>Название</span><input type="text" data-object-field="name" value="' + esc(project.name || "") + '"></label>' +
      '<label><span>Секций в доме</span><input type="text" inputmode="numeric" data-object-field="sections" value="' + settings.sections + '"></label>' +
      '<label style="grid-column:1/-1"><span>Полное наименование (для документов)</span><input type="text" data-object-field="full_name" value="' + esc(project.full_name || "") + '"></label>' +
    '</div>' +
    '<div class="object-settings-title">Локальные сметы</div>' +
    '<table class="object-estimates"><thead><tr><th>№ сметы</th><th>Секция</th><th>Зона</th><th></th></tr></thead><tbody>' +
      settings.estimates.map(function(e){return objectEstimateRowHtml(e,settings.sections);}).join("") +
    '</tbody></table>' +
    '<button type="button" class="context-link" data-object-estimate-add>+ Добавить смету</button>' +
    '<div class="object-settings-note">Номер сметы связывает загружаемый файл с секцией и зоной. Смета лестниц — секция «' + OBJECT_STAIRS_SECTION + '», зона «Лестницы».</div>' +
    '</div>';
  backdrop.innerHTML = '<div class="spec-import-modal object-dialog"><div class="spec-import-head"><div><strong>Объекты</strong><span>Выберите объект, с которым работать.</span></div><button class="spec-import-close" type="button">×</button></div>' +
    '<div class="object-dialog-body"><div class="object-list">' + list + '</div>' + settingsHtml + '</div>' +
    '<div class="spec-import-foot"><span class="object-dialog-state"></span><span class="spacer"></span>' +
      (ui.isAdmin ? '<button class="context-link" type="button" data-object-new>+ Новый объект</button><button class="context-link execution-confirm-apply" type="button" data-object-save>Сохранить настройки</button>' : '') +
    '</div></div>';
  document.body.appendChild(backdrop);
  const state = backdrop.querySelector(".object-dialog-state");
  function close(){ backdrop.remove(); }
  backdrop.querySelector(".spec-import-close").onclick = close;
  backdrop.onclick = function(e){ if (e.target === backdrop) close(); };
  backdrop.querySelectorAll("[data-object-id]").forEach(function(btn){
    btn.onclick = function(){ if (btn.dataset.objectId !== project.id) switchObject(btn.dataset.objectId); else close(); };
  });
  if (!ui.isAdmin) return;

  const tbody = backdrop.querySelector(".object-estimates tbody");
  function sectionCountInput(){
    const n = Math.round(Number(backdrop.querySelector('[data-object-field="sections"]').value));
    return n >= 1 && n <= 20 ? n : 0;
  }
  function wireRows(){
    tbody.querySelectorAll("[data-object-estimate-remove]").forEach(function(btn){
      btn.onclick = function(){ btn.closest("tr").remove(); };
    });
  }
  function readRows(){
    return Array.from(tbody.querySelectorAll("[data-object-estimate]")).map(function(tr){
      const get = function(f){ return tr.querySelector('[data-field="' + f + '"]').value.trim(); };
      const section = get("section"), zone = get("zone");
      const stairs = section === OBJECT_STAIRS_SECTION || zone === "Лестницы";
      return {number:get("number").replace(/^№\s*/,""), section:stairs ? OBJECT_STAIRS_SECTION : section, zone:stairs ? "Лестницы" : zone, stairs:stairs};
    });
  }
  // Section lists in the estimate rows follow the section count as it is typed.
  backdrop.querySelector('[data-object-field="sections"]').oninput = function(){
    const n = sectionCountInput();
    if (!n) return;
    const rows = readRows();
    tbody.innerHTML = rows.map(function(e){return objectEstimateRowHtml(e,n);}).join("");
    wireRows();
  };
  backdrop.querySelector("[data-object-estimate-add]").onclick = function(){
    tbody.insertAdjacentHTML("beforeend",objectEstimateRowHtml({number:"",section:"Секция 1",zone:"Цоколь"},sectionCountInput() || settings.sections));
    wireRows();
  };
  wireRows();

  backdrop.querySelector("[data-object-save]").onclick = async function(){
    const name = backdrop.querySelector('[data-object-field="name"]').value.trim();
    const fullName = backdrop.querySelector('[data-object-field="full_name"]').value.trim();
    const sections = sectionCountInput();
    const estimates = readRows();
    if (!name) { state.textContent = "Укажите название объекта."; return; }
    if (!sections) { state.textContent = "Число секций должно быть от 1 до 20."; return; }
    const numbers = estimates.map(function(e){return e.number;});
    if (numbers.some(function(n){return !n;})) { state.textContent = "У каждой сметы должен быть номер."; return; }
    if (new Set(numbers).size !== numbers.length) { state.textContent = "Номера смет повторяются."; return; }
    const tooHigh = estimates.find(function(e){ const k = sectionKey(e.section); return k && Number(k.slice(1)) > sections; });
    if (tooHigh) { state.textContent = "Смета №" + tooHigh.number + " указана для секции, которой нет в доме."; return; }
    state.textContent = "Сохраняю…";
    const raw = project.settings && typeof project.settings === "object" ? project.settings : {};
    const result = await client.from("projects").update({
      name:name,
      full_name:fullName || null,
      settings:Object.assign({},raw,{sections:sections,estimates:estimates})
    }).eq("id",project.id).select("id");
    if (result.error) {
      state.textContent = objectSettingsMissing(result.error) ? "Сначала нужно обновить базу данных (миграция настроек объекта)." : result.error.message;
      return;
    }
    if (!result.data || !result.data.length) { state.textContent = "Нет прав на изменение этого объекта."; return; }
    window.location.reload();
  };

  backdrop.querySelector("[data-object-new]").onclick = async function(){
    const name = (window.prompt("Название нового объекта","") || "").trim();
    if (!name) return;
    state.textContent = "Создаю объект…";
    const session = (await client.auth.getSession()).data.session;
    const result = await client.from("projects").insert({
      code:"OBJ-" + Date.now().toString(36).toUpperCase(),
      name:name,
      created_by:session && session.user ? session.user.id : null,
      status:"active",
      settings:{sections:settings.sections,estimates:[]}
    }).select("id").single();
    if (result.error) {
      state.textContent = objectSettingsMissing(result.error) ? "Сначала нужно обновить базу данных (миграция настроек объекта)." : result.error.message;
      return;
    }
    switchObject(result.data.id);
  };
}

const appBrand = document.querySelector("#appView .brand");
if (appBrand) {
  appBrand.setAttribute("role","button");
  appBrand.tabIndex = 0;
  appBrand.addEventListener("click",openObjectDialog);
  appBrand.addEventListener("keydown",function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openObjectDialog(); } });
}

const DENIED_TITLE="Доступ не предоставлен";
const DENIED_TEXT="Учётная запись не имеет прав на объекты ПТО.";

function setDeniedScreen(title,text,canRetry) {
  deniedView.querySelector(".auth-brand").textContent=title;
  deniedView.querySelector(".auth-subtitle").textContent=text;
  $("deniedRetryBtn").classList.toggle("hidden",!canRetry);
}

// A failed load is not the same as missing rights: only an access error from the
// database means "no access"; anything else (network, timeout) can simply be retried.
function showSessionError(err,session) {
  const message=err && err.message ? err.message : String(err);
  const status=Number(err && err.status);
  const denied=status===401 || status===403 || (err && err.code==="42501");
  appView.classList.add("hidden");
  deniedView.classList.remove("hidden");
  if(denied) setDeniedScreen(DENIED_TITLE,"Ошибка доступа: "+message,false);
  else setDeniedScreen("Не удалось загрузить данные","Проверьте соединение и повторите. Подробности: "+message,true);
  $("deniedRetryBtn").onclick=function(){
    deniedView.classList.add("hidden");
    renderSession(session);
  };
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
        setDeniedScreen(DENIED_TITLE,DENIED_TEXT,false);
        return;
      }
      const project = await ensureProject(session.user);
      await loadProjectData(project);
      $("userEmail").textContent = session.user.email || "—";
      $("adminState").textContent = "Глобальный администратор";
      $("projectName").textContent = project.name || cfg.projectName;
      showProjectIdentity(project);
      $("projectStatus").textContent = "База готова к импорту";
      $("projectId").textContent = project.id;
      appView.classList.remove("hidden");
    } catch (err) {
      showSessionError(err,session);
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
      setDeniedScreen(DENIED_TITLE,DENIED_TEXT,false);
      return;
    }
    const project = await ensureProject(session.user);
    await loadProjectData(project);

    $("userEmail").textContent = session.user.email || "—";
    $("adminState").textContent = "Глобальный администратор";
    $("projectName").textContent = project.name || cfg.projectName;
    showProjectIdentity(project);
    $("projectId").textContent = project.id;
    $("projectStatus").textContent = project.status || "active";

    appView.classList.remove("hidden");
    renderPage(ui.page);
  } catch (err) {
    showSessionError(err,session);
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
