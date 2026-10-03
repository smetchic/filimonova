(() => {
  "use strict";

  const cfg=window.FILIMONOVA_CONFIG;
  if(!cfg||!window.supabase) return;
  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const num0=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0});
  const num2=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
  const money=new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
  const state={projectId:"",cache:null,cacheAt:0,drawerItem:null,observer:null,renderTimer:null};

  function currentPage(){
    const active=document.querySelector('.nav-btn.active[data-page]');
    return active?active.dataset.page:"";
  }
  function currentTab(){
    const tabs=Array.from(document.querySelectorAll('#pageTabs .page-tab'));
    return Math.max(0,tabs.findIndex(x=>x.classList.contains('active')));
  }
  function projectId(){
    const id=String(($('projectId')&&$('projectId').textContent)||"").trim();
    if(id&&id!=="—") state.projectId=id;
    return state.projectId;
  }
  async function allRows(table,select,apply){
    const size=1000,out=[];
    let from=0;
    while(true){
      let q=db.from(table).select(select||"*").range(from,from+size-1);
      if(apply) q=apply(q);
      const r=await q;
      if(r.error) throw r.error;
      const rows=r.data||[];
      out.push(...rows);
      if(rows.length<size) break;
      from+=size;
    }
    return out;
  }
  async function loadDashboardData(force){
    const pid=projectId();
    if(!pid) return null;
    if(!force&&state.cache&&state.cache.projectId===pid&&Date.now()-state.cacheAt<45000) return state.cache;
    const [catalog,specRows,specQty,supplierItems,supplyLines,montageEvents,avrDocs,avrVersions,avrRows,s29Docs,s29Rows,priceLinks,snapshotRows,journal]=await Promise.all([
      allRows('catalog_items','id,mark,name',q=>q.eq('project_id',pid).is('archived_at',null)),
      allRows('specification_rows','id,catalog_item_id,position_no',q=>q.eq('project_id',pid).is('archived_at',null)),
      allRows('specification_quantities','specification_row_id,quantity',q=>q.eq('project_id',pid)),
      allRows('supplier_items','id,catalog_item_id,unit_volume_m3,link_state',q=>q.eq('project_id',pid).is('archived_at',null)),
      allRows('supply_document_lines','id,document_id,catalog_item_id,qty_pieces,qty_m3,match_state',q=>q.eq('project_id',pid)),
      allRows('montage_events','id,specification_row_id,event_type,quantity,event_date',q=>q.eq('project_id',pid)),
      allRows('avr_documents','id,period_month',q=>q.eq('project_id',pid)),
      allRows('avr_versions','id,document_id,state,signed_at',q=>q.eq('project_id',pid)),
      allRows('avr_rows','id,version_id,estimate_row_id,quantity,quantity_m3,amount',q=>q.eq('project_id',pid)),
      allRows('s29_documents','id,period_month,status,fixed_at',q=>q.eq('project_id',pid)),
      allRows('s29_rows','id,document_id,catalog_item_id,avr_quantity_pieces,avr_quantity_m3,written_off_m3,economy_m3,overrun_m3',q=>q.eq('project_id',pid)),
      allRows('supplier_price_links','id,catalog_item_id,supplier_item_id,validation_state',q=>q.eq('project_id',pid)),
      allRows('supplier_price_snapshot_rows','import_id,catalog_item_id,supplier_item_id,validation_state,scope_key',q=>q.eq('project_id',pid)),
      allRows('reconciliation_journal','id,status,issue_key',q=>q.eq('project_id',pid))
    ]);
    const qtyByRow=new Map();
    specQty.forEach(x=>qtyByRow.set(x.specification_row_id,Number(qtyByRow.get(x.specification_row_id)||0)+Number(x.quantity||0)));
    const specById=new Map(specRows.map(x=>[x.id,x]));
    const catalogById=new Map(catalog.map(x=>[x.id,x]));
    const projectQty=specRows.reduce((s,r)=>s+Number(qtyByRow.get(r.id)||0),0);
    const supplierVol=new Map();
    supplierItems.forEach(x=>{if(x.catalog_item_id&&Number(x.unit_volume_m3)>0&&!supplierVol.has(x.catalog_item_id)) supplierVol.set(x.catalog_item_id,Number(x.unit_volume_m3));});
    const projectM3=specRows.reduce((s,r)=>s+Number(qtyByRow.get(r.id)||0)*Number(supplierVol.get(r.catalog_item_id)||0),0);
    const suppliedQty=supplyLines.reduce((s,x)=>s+Number(x.qty_pieces||0),0);
    const suppliedM3=supplyLines.reduce((s,x)=>s+Number(x.qty_m3||0),0);
    const mountedQty=montageEvents.filter(x=>x.event_type==='fact').reduce((s,x)=>s+Number(x.quantity||0),0);
    const activeVersionIds=new Set();
    avrDocs.forEach(d=>{
      const vs=avrVersions.filter(v=>v.document_id===d.id);
      const active=vs.find(v=>v.state==='signed'||v.signed_at)||vs.find(v=>v.state==='in_use');
      if(active) activeVersionIds.add(active.id);
    });
    const activeAvrRows=avrRows.filter(x=>activeVersionIds.has(x.version_id));
    const avrQty=activeAvrRows.reduce((s,x)=>s+Number(x.quantity||0),0);
    const avrAmount=activeAvrRows.reduce((s,x)=>s+Number(x.amount||0),0);
    const fixedDocIds=new Set(s29Docs.filter(d=>d.fixed_at||d.status==='fixed').map(d=>d.id));
    const fixedRows=s29Rows.filter(x=>fixedDocIds.has(x.document_id));
    const writtenM3=fixedRows.reduce((s,x)=>s+Number(x.written_off_m3||0),0);
    const economy=fixedRows.reduce((s,x)=>s+Number(x.economy_m3||0),0);
    const overrun=fixedRows.reduce((s,x)=>s+Number(x.overrun_m3||0),0);
    const unresolvedPrice=new Set();
    snapshotRows.forEach(x=>{if(['review','unmatched','missing','not_in_new_version'].includes(String(x.validation_state||'').toLowerCase())&&x.catalog_item_id) unresolvedPrice.add(x.catalog_item_id);});
    const unmatchedSupply=supplyLines.filter(x=>!x.catalog_item_id||!x.match_state||String(x.match_state).toLowerCase().includes('не сопостав')).length;
    const reconIssues=journal.filter(x=>!['resolved','ignored','closed'].includes(String(x.status||'').toLowerCase())).length;
    const data={projectId:pid,catalog,specRows,qtyByRow,specById,catalogById,supplierVol,projectQty,projectM3,suppliedQty,suppliedM3,mountedQty,avrQty,avrAmount,writtenM3,economy,overrun,unresolvedPrice:unresolvedPrice.size,unmatchedSupply,reconIssues,s29Rows:fixedRows,montageEvents,supplyLines,priceLinks};
    state.cache=data;state.cacheAt=Date.now();
    return data;
  }
  function pct(a,b){return b>0?Math.max(0,Math.min(100,a/b*100)):0;}
  function kpi(label,value,sub,tone,percent,page,tab){
    return '<div class="ux-kpi" data-tone="'+tone+'" data-ux-go="'+page+'" data-ux-tab="'+(tab==null?'':tab)+'"><div class="ux-kpi-head"><i class="ux-kpi-dot"></i><div class="ux-kpi-label">'+esc(label)+'</div></div><div class="ux-kpi-value">'+value+'</div><div class="ux-kpi-sub">'+esc(sub)+'</div><div class="ux-kpi-progress"><span style="width:'+Math.round(percent)+'%"></span></div></div>';
  }
  function go(page,tab){
    const btn=document.querySelector('.nav-btn[data-page="'+CSS.escape(page)+'"]');
    if(btn) btn.click();
    if(tab!=null){setTimeout(()=>{const tabs=document.querySelectorAll('#pageTabs .page-tab');if(tabs[tab]) tabs[tab].click();},40);}
  }
  async function renderHome(force){
    if(currentPage()!=='home') return;
    const area=$('workArea');if(!area) return;
    area.className='work-area content-work';
    area.innerHTML='<div class="ux-dashboard"><div class="ux-drawer-loading">Формирую рабочую сводку…</div></div>';
    try{
      const d=await loadDashboardData(force);
      if(!d) return;
      const attention=[];
      if(d.unresolvedPrice) attention.push({tone:'warn',status:'Проверить',area:'Прайс поставщика',text:'Позиции требуют проверки сопоставления',count:d.unresolvedPrice,page:'supply',tab:2});
      if(d.unmatchedSupply) attention.push({tone:'bad',status:'Не связано',area:'Поставка',text:'Строки ТТН без связи с проектной номенклатурой',count:d.unmatchedSupply,page:'supply',tab:1});
      if(d.reconIssues) attention.push({tone:'warn',status:'Контроль',area:'Сверка',text:'Открытые замечания по связям смета ↔ спецификация',count:d.reconIssues,page:'recon',tab:0});
      if(d.overrun>0.0001) attention.push({tone:'bad',status:'Перерасход',area:'С-29',text:'Зафиксирован перерасход материалов',count:num2.format(d.overrun)+' м³',page:'s29',tab:3});
      if(!attention.length) attention.push({tone:'ok',status:'Норма',area:'Контроль',text:'Критичных открытых расхождений не найдено',count:'',page:'recon',tab:0});
      const attentionBody=attention.map(x=>'<tr data-ux-go="'+x.page+'" data-ux-tab="'+x.tab+'"><td><span class="ux-attention-status '+x.tone+'"><i></i>'+esc(x.status)+'</span></td><td>'+esc(x.area)+'</td><td>'+esc(x.text)+'</td><td class="ux-attention-count">'+esc(x.count)+'</td></tr>').join('');
      const supplyPct=pct(d.suppliedQty,d.projectQty),montagePct=pct(d.mountedQty,d.projectQty),avrPct=pct(d.avrQty,d.projectQty),writePct=pct(d.writtenM3,d.projectM3);
      area.innerHTML='<div class="ux-dashboard">'+
        '<div class="ux-dashboard-head"><div class="ux-dashboard-title"><strong>Рабочая сводка ПТО</strong><span>живые данные объекта</span></div><span class="spacer"></span><div class="ux-mode-switch"><button class="active" type="button">ПТО</button><button type="button" data-ux-manager>Руководитель</button></div><button class="ux-dashboard-refresh" type="button" data-ux-refresh>Обновить</button></div>'+
        '<div class="ux-dashboard-grid">'+
          kpi('Проект',num0.format(d.projectQty)+' шт.',num2.format(d.projectM3)+' м³ · '+num0.format(d.specRows.length)+' строк','blue',100,'spec',1)+
          kpi('Поставка',num0.format(d.suppliedQty)+' шт.',num2.format(d.suppliedM3)+' м³ · '+Math.round(supplyPct)+'% проекта','green',supplyPct,'supply',0)+
          kpi('Монтаж',num0.format(d.mountedQty)+' шт.','осталось '+num0.format(Math.max(0,d.projectQty-d.mountedQty))+' шт.','green',montagePct,'montage',0)+
          kpi('АВР',num0.format(d.avrQty)+' шт.',money.format(d.avrAmount)+' руб.','blue',avrPct,'avr',0)+
          kpi('С-29',num2.format(d.writtenM3)+' м³','экономия '+num2.format(d.economy)+' · перерасход '+num2.format(d.overrun),'amber',writePct,'s29',0)+
          kpi('Контроль',num0.format(d.unresolvedPrice+d.unmatchedSupply+d.reconIssues),'позиций и замечаний требуют внимания',d.unresolvedPrice+d.unmatchedSupply+d.reconIssues?'red':'green',d.unresolvedPrice+d.unmatchedSupply+d.reconIssues?70:100,'recon',0)+
        '</div>'+
        '<div class="ux-dashboard-body"><div class="ux-panel"><div class="ux-panel-head"><strong>Требует внимания</strong><span>только открытые рабочие вопросы</span><span class="spacer"></span><button class="ux-panel-link" data-ux-go="diffs" data-ux-tab="0" type="button">Все расхождения</button></div><table class="ux-attention-table"><thead><tr><th>Состояние</th><th>Раздел</th><th>Что проверить</th><th class="ux-attention-count">Кол-во</th></tr></thead><tbody>'+attentionBody+'</tbody></table></div>'+
        '<div class="ux-panel"><div class="ux-panel-head"><strong>Исполнение проекта</strong><span class="spacer"></span></div><div class="ux-progress-list">'+
          progress('Поставка',supplyPct,'green')+progress('Монтаж',montagePct,'green')+progress('АВР',avrPct,'blue')+progress('Списание',writePct,'amber')+
        '</div><div class="ux-dashboard-note">Проценты считаются от проектного количества/объёма. Карточки и строки открывают соответствующий рабочий модуль.</div></div></div></div>';
      area.querySelectorAll('[data-ux-go]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.uxGo,el.dataset.uxTab===''?null:Number(el.dataset.uxTab))));
      const refresh=area.querySelector('[data-ux-refresh]');if(refresh) refresh.onclick=()=>renderHome(true);
      const manager=area.querySelector('[data-ux-manager]');if(manager) manager.onclick=()=>managerMode(area,d);
    }catch(err){area.innerHTML='<div class="review-panel"><div class="review-panel-title">Рабочая сводка</div><div class="review-note">Не удалось сформировать сводку: '+esc(err&&err.message?err.message:String(err))+'</div></div>';}
  }
  function progress(label,value,tone){return '<div class="ux-progress-row" data-tone="'+tone+'"><label>'+esc(label)+'</label><div class="ux-progress-track"><span style="width:'+Math.round(value)+'%"></span></div><b>'+Math.round(value)+'%</b></div>';}
  function managerMode(area,d){
    const title=area.querySelector('.ux-dashboard-title strong');if(title) title.textContent='Сводка руководителя';
    const buttons=area.querySelectorAll('.ux-mode-switch button');buttons.forEach(x=>x.classList.remove('active'));if(buttons[1]) buttons[1].classList.add('active');
    const note=area.querySelector('.ux-dashboard-note');if(note) note.textContent='Управленческий режим: выполнение, стоимость и ключевые отклонения без технической детализации.';
    if(buttons[0]) buttons[0].onclick=()=>renderHome(false);
  }

  function activeFilterEntries(){
    const popups=[];
    document.querySelectorAll('#workArea .column-filter-trigger.active').forEach(btn=>{
      const th=btn.closest('th');const label=(th&&th.querySelector('.header-label')&&th.querySelector('.header-label').textContent)||btn.dataset.columnFilter||'Фильтр';
      popups.push({field:btn.dataset.columnFilter,label});
    });
    return popups;
  }
  function enhanceServiceRow(){
    const left=$('serviceLeft'),right=$('serviceRight');if(!left||!right) return;
    const entries=activeFilterEntries();
    let box=left.querySelector('.ux-filter-summary');
    if(entries.length){
      if(!box){box=document.createElement('span');box.className='ux-filter-summary';left.appendChild(box);}
      box.innerHTML='<span class="ux-filter-caption">Фильтры:</span>'+entries.map(x=>'<span class="ux-filter-chip"><span>'+esc(x.label)+'</span><button type="button" data-ux-clear-field="'+esc(x.field)+'">×</button></span>').join('')+'<button class="ux-clear-filters" type="button" data-ux-clear-all>Очистить всё</button>';
      box.querySelectorAll('[data-ux-clear-field]').forEach(b=>b.onclick=()=>clearFieldFilter(b.dataset.uxClearField));
      const clear=box.querySelector('[data-ux-clear-all]');if(clear) clear.onclick=clearAllFilters;
    }else if(box) box.remove();
    let tools=right.querySelector('.ux-service-tools');
    if(!tools){tools=document.createElement('span');tools.className='ux-service-tools';tools.innerHTML='<span class="ux-service-separator"></span><button class="ux-tool-link" type="button" data-ux-columns>Колонки</button>';right.appendChild(tools);}
    const col=tools.querySelector('[data-ux-columns]');if(col) col.onclick=e=>openColumnConfigurator(e.currentTarget);
  }
  function clearFieldFilter(field){
    const trigger=document.querySelector('#workArea .column-filter-trigger[data-column-filter="'+CSS.escape(field)+'"]');
    if(!trigger) return;
    trigger.click();
    setTimeout(()=>{const p=$('columnFilterPopup');if(!p) return;const clear=p.querySelector('.filter-clear');const ok=p.querySelector('[data-filter-ok]');if(clear) clear.click();if(ok) ok.click();},25);
  }
  function clearAllFilters(){
    const fields=activeFilterEntries().map(x=>x.field);let i=0;
    function next(){if(i>=fields.length) return;clearFieldFilter(fields[i++]);setTimeout(next,90);}next();
  }
  function columnHeaders(table){
    if(!table||!table.tHead) return [];
    const first=Array.from(table.tHead.rows[0].cells);
    let logical=0,out=[];
    first.forEach(th=>{
      const span=Number(th.colSpan||1),rowspan=Number(th.rowSpan||1);
      const label=(th.innerText||'').replace(/\s+/g,' ').trim();
      if(span===1&&rowspan>=1) out.push({index:logical,label:label||('Колонка '+(logical+1))});
      logical+=span;
    });
    return out;
  }
  function ensureColumnPopup(){
    let pop=document.querySelector('.ux-column-popup');if(pop) return pop;
    pop=document.createElement('div');pop.className='ux-column-popup';document.body.appendChild(pop);return pop;
  }
  function openColumnConfigurator(anchor){
    const table=document.querySelector('#workArea table');if(!table) return;
    const headers=columnHeaders(table);if(!headers.length) return;
    const key='filimonova.hiddenColumns.'+(table.dataset.tableKey||currentPage()+'.'+currentTab());
    let hidden=[];try{hidden=JSON.parse(localStorage.getItem(key)||'[]');}catch(_){hidden=[];}
    const set=new Set(hidden.map(Number));const pop=ensureColumnPopup();
    pop.innerHTML='<div class="ux-column-popup-head">Показывать колонки</div><div class="ux-column-popup-list">'+headers.map(h=>'<label class="ux-column-option"><input type="checkbox" data-ux-col="'+h.index+'" '+(set.has(h.index)?'':'checked')+'><span>'+esc(h.label)+'</span></label>').join('')+'</div><div class="ux-column-popup-foot"><button type="button" data-ux-cols-all>Показать все</button><span class="spacer"></span><button type="button" data-ux-cols-close>Закрыть</button></div>';
    const r=anchor.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(window.innerWidth-276,r.right-268))+'px';pop.style.top=Math.min(window.innerHeight-430,r.bottom+5)+'px';pop.classList.add('open');
    pop.querySelectorAll('[data-ux-col]').forEach(ch=>ch.onchange=()=>{const idx=Number(ch.dataset.uxCol);if(ch.checked)set.delete(idx);else set.add(idx);localStorage.setItem(key,JSON.stringify(Array.from(set)));applyHiddenColumns(table,set);});
    pop.querySelector('[data-ux-cols-all]').onclick=()=>{set.clear();localStorage.setItem(key,'[]');applyHiddenColumns(table,set);pop.querySelectorAll('[data-ux-col]').forEach(x=>x.checked=true);};
    pop.querySelector('[data-ux-cols-close]').onclick=()=>pop.classList.remove('open');
  }
  function logicalGrid(table){
    const rows=Array.from(table.rows),grid=[];
    rows.forEach((tr,ri)=>{if(!grid[ri])grid[ri]=[];let ci=0;Array.from(tr.cells).forEach(cell=>{while(grid[ri][ci])ci++;const cs=Number(cell.colSpan||1),rs=Number(cell.rowSpan||1);for(let r=0;r<rs;r++){if(!grid[ri+r])grid[ri+r]=[];for(let c=0;c<cs;c++)grid[ri+r][ci+c]=cell;}ci+=cs;});});return grid;
  }
  function applyHiddenColumns(table,set){
    const grid=logicalGrid(table),seen=new Set();
    grid.forEach(row=>row.forEach((cell,idx)=>{if(seen.has(cell))return;seen.add(cell);const start=row.indexOf(cell),span=Number(cell.colSpan||1);let all=true;for(let i=start;i<start+span;i++)if(!set.has(i))all=false;cell.style.display=all?'none':'';}));
  }
  function restoreHiddenColumns(){
    document.querySelectorAll('#workArea table').forEach(table=>{const key='filimonova.hiddenColumns.'+(table.dataset.tableKey||currentPage()+'.'+currentTab());let hidden=[];try{hidden=JSON.parse(localStorage.getItem(key)||'[]');}catch(_){}applyHiddenColumns(table,new Set(hidden.map(Number)));});
  }

  function ensureDrawer(){
    let d=document.querySelector('.ux-detail-drawer');if(d) return d;
    d=document.createElement('aside');d.className='ux-detail-drawer';d.innerHTML='<div class="ux-drawer-head"><div class="ux-drawer-ident"><div class="ux-drawer-kicker">Позиция проекта</div><strong>—</strong><span>—</span></div><button class="ux-drawer-close" type="button">×</button></div><div class="ux-drawer-tabs"><button class="ux-drawer-tab active" data-ux-drawer-tab="overview" type="button">Обзор</button><button class="ux-drawer-tab" data-ux-drawer-tab="refs" type="button">Связи</button></div><div class="ux-drawer-body"></div>';
    document.body.appendChild(d);d.querySelector('.ux-drawer-close').onclick=()=>d.classList.remove('open');d.querySelectorAll('[data-ux-drawer-tab]').forEach(b=>b.onclick=()=>{d.querySelectorAll('.ux-drawer-tab').forEach(x=>x.classList.toggle('active',x===b));renderDrawerBody(b.dataset.uxDrawerTab);});return d;
  }
  async function openDrawerFromRow(row){
    const id=row.dataset.materialId||'';const mark=row.dataset.materialMark||((row.querySelector('[data-filter-field="mark"], [data-filter-field="basis"]')||{}).textContent||'').trim();
    if(!id&&!mark) return;
    const d=ensureDrawer();d.classList.add('open');d.querySelector('.ux-drawer-ident strong').textContent=mark||'Материал';d.querySelector('.ux-drawer-ident span').textContent='Загрузка связей…';d.querySelector('.ux-drawer-body').innerHTML='<div class="ux-drawer-loading">Собираю данные по позиции…</div>';
    try{
      const data=await loadDashboardData(false);let item=id?data.catalogById.get(id):null;if(!item&&mark)item=data.catalog.find(x=>x.mark===mark);if(!item) throw new Error('Позиция не найдена в каталоге.');
      state.drawerItem=item;d.querySelector('.ux-drawer-ident strong').textContent=item.mark||'Материал';d.querySelector('.ux-drawer-ident span').textContent=item.name||'';renderDrawerBody('overview');
    }catch(err){d.querySelector('.ux-drawer-body').innerHTML='<div class="ux-drawer-loading">'+esc(err.message||String(err))+'</div>';}
  }
  function drawerStats(item,d){
    const rows=d.specRows.filter(r=>r.catalog_item_id===item.id);const rowIds=new Set(rows.map(r=>r.id));const projectQty=rows.reduce((s,r)=>s+Number(d.qtyByRow.get(r.id)||0),0);const vol=Number(d.supplierVol.get(item.id)||0);const projectM3=projectQty*vol;
    const supplied=d.supplyLines.filter(x=>x.catalog_item_id===item.id).reduce((s,x)=>s+Number(x.qty_pieces||0),0);const mounted=d.montageEvents.filter(x=>x.event_type==='fact'&&rowIds.has(x.specification_row_id)).reduce((s,x)=>s+Number(x.quantity||0),0);const s29=d.s29Rows.filter(x=>x.catalog_item_id===item.id);const written=s29.reduce((s,x)=>s+Number(x.written_off_m3||0),0);const econ=s29.reduce((s,x)=>s+Number(x.economy_m3||0),0);const over=s29.reduce((s,x)=>s+Number(x.overrun_m3||0),0);return{rows,projectQty,vol,projectM3,supplied,mounted,written,econ,over};
  }
  async function renderDrawerBody(tab){
    const d=ensureDrawer(),item=state.drawerItem;if(!item)return;const data=await loadDashboardData(false),s=drawerStats(item,data);
    if(tab==='overview'){
      d.querySelector('.ux-drawer-body').innerHTML='<div class="ux-drawer-grid">'+metric('Проект',num0.format(s.projectQty)+' шт.')+metric('Поставлено',num0.format(s.supplied)+' шт.')+metric('Смонтировано',num0.format(s.mounted)+' шт.')+metric('Объём/ед.',s.vol?num2.format(s.vol)+' м³':'—')+metric('Списано',num2.format(s.written)+' м³')+metric('Осталось',num0.format(Math.max(0,s.projectQty-s.mounted))+' шт.')+'</div>'+section('Контроль','<ul class="ux-ref-list"><li><b>Экономия</b><span>'+num2.format(s.econ)+' м³</span></li><li><b>Перерасход</b><span>'+num2.format(s.over)+' м³</span></li><li><b>Проектный объём</b><span>'+num2.format(s.projectM3)+' м³</span></li></ul>');
    }else{
      const specText=s.rows.length?s.rows.map(r=>'№ '+(r.position_no||'—')).join(', '):'нет';const supplier=data.supplyLines.filter(x=>x.catalog_item_id===item.id).length;const linkedPrice=data.priceLinks.filter(x=>x.catalog_item_id===item.id).length;
      d.querySelector('.ux-drawer-body').innerHTML=section('Вертикальная трассировка','<ul class="ux-ref-list"><li><b>Спецификация</b><span>'+esc(specText)+'</span></li><li><b>Прайс</b><span>'+num0.format(linkedPrice)+' связей</span></li><li><b>Поставка</b><span>'+num0.format(supplier)+' строк документов</span></li><li><b>Монтаж</b><span>'+num0.format(s.mounted)+' шт.</span></li><li><b>С-29</b><span>'+num2.format(s.written)+' м³ списано</span></li></ul>');
    }
  }
  function metric(label,value){return '<div class="ux-drawer-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
  function section(title,body){return '<div class="ux-drawer-section"><div class="ux-drawer-section-head"><strong>'+esc(title)+'</strong></div>'+body+'</div>';}
  function wireDrawerRows(){
    document.querySelectorAll('#workArea .data-row[data-material-id],#workArea .data-row[data-material-mark]').forEach(row=>{
      if(row.dataset.uxDrawerWired==='1')return;row.dataset.uxDrawerWired='1';row.addEventListener('click',e=>{if(e.target.closest('button,input,select,a,.day-cell,.column-filter-trigger'))return;openDrawerFromRow(row);});
    });
  }

  function classifyStatuses(){
    document.querySelectorAll('#workArea td, #workArea .supply-doc-state, #workArea .ttn-link-state').forEach(el=>{
      const t=(el.textContent||'').trim().toLowerCase();if(!t||el.dataset.uxStatus==='1')return;
      let cls='';if(/сопоставлено|подписан|закрыт|совпадает|норма|используется/.test(t)&&!/не сопостав/.test(t))cls='ux-state-ok';else if(/провер|замеч|частич|без цены|нет в новой|ожида/.test(t))cls='ux-state-warn';else if(/ошиб|перерасход|не сопостав|расхожд/.test(t))cls='ux-state-bad';
      if(cls){el.classList.add(cls);el.dataset.uxStatus='1';}
    });
  }
  function enhanceGpr(){
    const table=document.querySelector('#workArea .gpr-table');if(!table)return;
    table.querySelectorAll('tbody tr.data-row').forEach(row=>{
      const cells=Array.from(row.querySelectorAll('.gpr-month'));const active=cells.filter(c=>{const t=(c.textContent||'').replace(/\s/g,'').replace(',','.');return Number(t)>0;});
      cells.forEach(c=>c.classList.remove('ux-gpr-span','ux-gpr-active','ux-gpr-start','ux-gpr-end'));
      if(!active.length)return;const first=cells.indexOf(active[0]),last=cells.indexOf(active[active.length-1]);for(let i=first;i<=last;i++)cells[i].classList.add('ux-gpr-span');active.forEach(c=>c.classList.add('ux-gpr-active'));cells[first].classList.add('ux-gpr-start');cells[last].classList.add('ux-gpr-end');
    });
    const right=$('serviceRight');if(!right||right.querySelector('.ux-gpr-scale'))return;const scale=document.createElement('span');scale.className='ux-gpr-scale';scale.innerHTML='<button class="active" data-scale="month" type="button">Месяц</button><button data-scale="quarter" type="button">Квартал</button><button data-scale="year" type="button">Год</button>';right.insertBefore(scale,right.firstChild);scale.querySelectorAll('button').forEach(b=>b.onclick=()=>{scale.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));table.classList.toggle('ux-gpr-scale-quarter',b.dataset.scale==='quarter');table.classList.toggle('ux-gpr-scale-year',b.dataset.scale==='year');});
  }

  function afterRender(){
    const page=currentPage();
    if(page==='home') renderHome(false);else{enhanceServiceRow();restoreHiddenColumns();wireDrawerRows();classifyStatuses();if(page==='estimates'&&currentTab()===2)enhanceGpr();}
  }
  function schedule(){clearTimeout(state.renderTimer);state.renderTimer=setTimeout(afterRender,70);}
  function start(){
    const root=$('appView')||document.body;state.observer=new MutationObserver(schedule);state.observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});document.addEventListener('click',schedule,true);schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
