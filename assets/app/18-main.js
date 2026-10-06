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

const DENIED_TITLE="Доступ не предоставлен";
const DENIED_TEXT="Учётная запись не имеет прав на проект «Филимонова».";

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
