(() => {
  "use strict";

  const KEY="filimonova.appearance";
  const MODES=new Set(["light","dark","system"]);
  const media=window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  // Load correction layers after all legacy project styles.
  (function ensureThemeFixes(){
    if(!document.querySelector('link[data-dark-theme-fixes]')){
      const dark=document.createElement("link");
      dark.rel="stylesheet";
      dark.href="./assets/theme-dark-fixes.css?v=20261004-1924";
      dark.dataset.darkThemeFixes="1";
      document.head.appendChild(dark);
    }
    if(!document.querySelector('link[data-light-theme-fixes]')){
      const light=document.createElement("link");
      light.rel="stylesheet";
      light.href="./assets/theme-light-fixes.css?v=20261004-2330";
      light.dataset.lightThemeFixes="1";
      document.head.appendChild(light);
    }
  })();

  function readMode(){
    const saved=String(localStorage.getItem(KEY)||"light");
    return MODES.has(saved)?saved:"light";
  }

  function resolved(mode){
    return mode==="system" ? (media&&media.matches?"dark":"light") : mode;
  }

  function apply(mode,save){
    if(!MODES.has(mode)) mode="light";
    if(save!==false) localStorage.setItem(KEY,mode);
    const actual=resolved(mode);
    document.documentElement.dataset.theme=actual;
    document.documentElement.dataset.appearance=mode;
    document.documentElement.style.colorScheme=actual;
    document.querySelectorAll("[data-theme-mode]").forEach(function(btn){
      const active=btn.dataset.themeMode===mode;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",active?"true":"false");
    });
  }

  apply(readMode(),false);

  if(media){
    const onSystemChange=function(){if(readMode()==="system")apply("system",false);};
    if(media.addEventListener) media.addEventListener("change",onSystemChange);
    else if(media.addListener) media.addListener(onSystemChange);
  }

  function settingsActive(){
    const active=document.querySelector('.nav-btn.active[data-page="settings"]');
    if(active) return true;
    const title=document.getElementById("pageTitle");
    return title && String(title.textContent||"").trim()==="Настройки";
  }

  function markup(){
    return '<section class="theme-settings-panel" data-theme-settings>'+ 
      '<div class="theme-settings-head"><strong>Внешний вид</strong><span>Оформление сохраняется только для этого браузера и не влияет на данные проекта.</span></div>'+ 
      '<div class="theme-settings-row">'+
        '<div class="theme-settings-copy"><b>Тема интерфейса</b><span>Можно оставить светлую, включить тёмную или следовать теме Windows/macOS.</span></div>'+ 
        '<div class="theme-choice" role="group" aria-label="Тема интерфейса">'+
          '<button type="button" data-theme-mode="light">Светлая</button>'+ 
          '<button type="button" data-theme-mode="dark">Тёмная</button>'+ 
          '<button type="button" data-theme-mode="system">Системная</button>'+ 
        '</div>'+ 
      '</div>'+ 
      '<div class="theme-settings-preview" aria-hidden="true">'+
        '<div class="theme-preview-card"><i></i><span></span><span></span></div>'+ 
        '<div class="theme-preview-card"><i></i><span></span><span></span></div>'+ 
        '<div class="theme-preview-card"><i></i><span></span><span></span></div>'+ 
      '</div>'+ 
    '</section>';
  }

  function ensureSettings(){
    if(!settingsActive()) return;
    const area=document.getElementById("workArea");
    if(!area || area.querySelector("[data-theme-settings]")){
      apply(readMode(),false);
      return;
    }

    Array.from(area.querySelectorAll(":scope > .empty-state")).forEach(function(node){node.remove();});
    area.classList.add("content-work","theme-settings-host");
    area.insertAdjacentHTML("afterbegin",markup());
    area.querySelectorAll("[data-theme-mode]").forEach(function(btn){
      btn.addEventListener("click",function(){apply(btn.dataset.themeMode,true);});
    });
    apply(readMode(),false);
  }

  let queued=false;
  function queue(){
    if(queued) return;
    queued=true;
    requestAnimationFrame(function(){queued=false;ensureSettings();});
  }

  document.addEventListener("click",function(e){
    if(e.target && e.target.closest && e.target.closest('.nav-btn[data-page="settings"]')) setTimeout(queue,0);
  },true);

  const observer=new MutationObserver(queue);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",queue,{once:true});
  else queue();
})();
