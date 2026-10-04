(() => {
  "use strict";

  const KEY="filimonova.appearance";
  const MODES=new Set(["light","dark","system"]);
  const media=window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  (function ensureThemeFixes(){
    const stamp="20261004-2345";
    let dark=document.querySelector('link[data-dark-theme-fixes]');
    if(!dark){
      dark=document.createElement("link");
      dark.rel="stylesheet";
      dark.dataset.darkThemeFixes="1";
      document.head.appendChild(dark);
    }
    dark.href="./assets/theme-dark-fixes.css?v="+stamp;

    let light=document.querySelector('link[data-light-theme-fixes]');
    if(!light){
      light=document.createElement("link");
      light.rel="stylesheet";
      light.dataset.lightThemeFixes="1";
      document.head.appendChild(light);
    }
    light.href="./assets/theme-light-fixes.css?v="+stamp;

    let statusStyle=document.querySelector('style[data-price-status-runtime-fix]');
    if(!statusStyle){
      statusStyle=document.createElement("style");
      statusStyle.dataset.priceStatusRuntimeFix="1";
      document.head.appendChild(statusStyle);
    }
    statusStyle.textContent=`
      .supplier-source-price-table td.status-cell,
      .supplier-source-price-table td[data-filter-field="price"]{
        border-radius:0!important;
        box-shadow:none!important;
        outline:0!important;
      }
      html[data-theme="light"] .supplier-source-price-table td.status-cell,
      html[data-theme="light"] .supplier-source-price-table td[data-filter-field="price"]{
        background:#fff!important;
      }
      html[data-theme="dark"] .supplier-source-price-table td.status-cell,
      html[data-theme="dark"] .supplier-source-price-table td[data-filter-field="price"]{
        background:#202328!important;
      }
      .supplier-source-price-table td.status-cell > .price-state,
      .supplier-source-price-table td[data-filter-field="price"] > .price-state{
        display:inline-flex!important;
        width:auto!important;
        max-width:calc(100% - 2px)!important;
        min-width:0!important;
        height:20px!important;
        min-height:20px!important;
        align-items:center!important;
        justify-content:center!important;
        padding:0 8px!important;
        margin:0!important;
        border-radius:10px!important;
        box-sizing:border-box!important;
        white-space:nowrap!important;
        font-size:10.5px!important;
        line-height:18px!important;
        font-weight:400!important;
        box-shadow:none!important;
      }
      html[data-theme="light"] .supplier-source-price-table .price-state.ok{
        background:#eef7f1!important;color:#356348!important;border:1px solid #bfd8c8!important;
      }
      html[data-theme="light"] .supplier-source-price-table .price-state.review,
      html[data-theme="light"] .supplier-source-price-table .price-state.warn{
        background:#fff7e6!important;color:#9a5619!important;border:1px solid #e8d49f!important;
      }
      html[data-theme="light"] .supplier-source-price-table .price-state.bad{
        background:#fff0ee!important;color:#9c443a!important;border:1px solid #e8bdb7!important;
      }
      html[data-theme="light"] .supplier-source-price-table .price-state.supplier,
      html[data-theme="light"] .supplier-source-price-table .price-state.none{
        background:#fbf7ed!important;color:#7a5a34!important;border:1px solid #e6d9be!important;
      }
      html[data-theme="dark"] .supplier-source-price-table .price-state.ok{
        background:#20372b!important;color:#82d4a4!important;border:1px solid #365b45!important;
      }
      html[data-theme="dark"] .supplier-source-price-table .price-state.review,
      html[data-theme="dark"] .supplier-source-price-table .price-state.warn,
      html[data-theme="dark"] .supplier-source-price-table .price-state.supplier,
      html[data-theme="dark"] .supplier-source-price-table .price-state.none{
        background:#3b3222!important;color:#e6bd70!important;border:1px solid #655536!important;
      }
      html[data-theme="dark"] .supplier-source-price-table .price-state.bad{
        background:#3b2525!important;color:#f0a39c!important;border:1px solid #694040!important;
      }
    `;
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
