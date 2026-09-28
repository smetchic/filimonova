(() => {
  const cfg = window.FILIMONOVA_CONFIG;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<div style="padding:24px;font-family:Segoe UI">Ошибка загрузки конфигурации.</div>';
    return;
  }

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const appView = $("appView");
  const loginForm = $("loginForm");
  const signupForm = $("signupForm");
  const loginStatus = $("loginStatus");
  const signupStatus = $("signupStatus");
  const tabLogin = $("tabLogin");
  const tabSignup = $("tabSignup");

  function setStatus(el, message, type="") {
    el.textContent = message || "";
    el.className = "status" + (type ? " " + type : "");
  }

  function switchTab(name) {
    const login = name === "login";
    tabLogin.classList.toggle("active", login);
    tabSignup.classList.toggle("active", !login);
    loginForm.classList.toggle("hidden", !login);
    signupForm.classList.toggle("hidden", login);
    setStatus(loginStatus, "");
    setStatus(signupStatus, "");
  }

  tabLogin.addEventListener("click", () => switchTab("login"));
  tabSignup.addEventListener("click", () => switchTab("signup"));

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(loginStatus, "Вход…");
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    button.disabled = false;
    if (error) {
      setStatus(loginStatus, error.message, "error");
      return;
    }
    setStatus(loginStatus, "Вход выполнен.", "ok");
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = signupForm.querySelector("button[type=submit]");
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;
    const password2 = $("signupPassword2").value;

    if (password !== password2) {
      setStatus(signupStatus, "Пароли не совпадают.", "error");
      return;
    }
    if (password.length < 6) {
      setStatus(signupStatus, "Пароль должен содержать не менее 6 символов.", "error");
      return;
    }

    button.disabled = true;
    setStatus(signupStatus, "Создание учётной записи…");
    const redirectTo = window.location.origin + window.location.pathname;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    });
    button.disabled = false;

    if (error) {
      setStatus(signupStatus, error.message, "error");
      return;
    }
    if (!data.session) {
      setStatus(signupStatus, "Учётная запись создана. Подтвердите email по ссылке из письма, затем войдите.", "ok");
    } else {
      setStatus(signupStatus, "Учётная запись создана.", "ok");
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await client.auth.signOut();
  });

  async function isAdmin(userId) {
    const { data, error } = await client
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async function ensureProject(user) {
    let { data, error } = await client
      .from("projects")
      .select("id,code,name,status,created_at")
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) throw error;
    if (data && data.length) return data[0];

    const inserted = await client
      .from("projects")
      .insert({
        code: cfg.projectCode,
        name: cfg.projectName,
        created_by: user.id,
        status: "active"
      })
      .select("id,code,name,status,created_at")
      .single();

    if (inserted.error) throw inserted.error;
    return inserted.data;
  }

  async function renderSession(session) {
    if (!session?.user) {
      appView.classList.add("hidden");
      authView.classList.remove("hidden");
      return;
    }

    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    $("userEmail").textContent = session.user.email || "—";
    $("adminState").textContent = "Проверка…";
    $("projectName").textContent = "—";
    $("projectId").textContent = "—";

    try {
      const admin = await isAdmin(session.user.id);
      $("adminState").textContent = admin ? "Глобальный администратор" : "Нет прав администратора";
      $("adminState").className = admin ? "badge" : "badge";

      if (!admin) {
        $("projectName").textContent = "Доступ не предоставлен";
        return;
      }

      const project = await ensureProject(session.user);
      $("projectName").textContent = project.name || "Филимонова";
      $("projectId").textContent = project.id;
      $("projectStatus").textContent = project.status === "active" ? "Активен" : project.status;
    } catch (err) {
      $("projectName").textContent = "Ошибка";
      $("projectId").textContent = err?.message || String(err);
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => renderSession(session), 0);
  });

  client.auth.getSession().then(({ data }) => renderSession(data.session));
})();
