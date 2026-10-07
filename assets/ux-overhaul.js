(() => {
  "use strict";

  const cfg=window.FILIMONOVA_CONFIG;
  if(!cfg||!window.supabase) return;

  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const num0=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0});
  const num2=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
  const money=new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
  const state={projectId:"",cache:null,cacheAt:0,drawerItem:null,observer:null,timer:null,homeLoading:false};

  function page(){const b=document.querySelector('.nav-btn.active[data-page]');return b?b.dataset.page:"";}
  function tab(){const a=Array.from(document.querySelectorAll('#pageTabs .page-tab'));return Math.max(0,a.findIndex(x=>x.classList.contains('active')));}
  function pid(){const x=String(($('projectId')&&$('projectId').textContent)||"").trim();if(x&&x!=="—")state.projectId=x;return state.projectId;}
  function pct(a,b){return b>0?Math.max(0,Math.min(100,a/b*100)):0;}

  async function rows(table,select,apply){
    const out=[],size=1000;let from=0;
    for(;;){let q=db.from(table).select(select||"*").range(from,from+size-1);if(apply)q=apply(q);const r=await q;if(r.error)throw r.error;const part=r.data||[];out.push(...part);if(part.length<size)break;from+=size;}
    return out;
  }

  async function dashboardData(force){
    const projectId=pid();if(!projectId)return null;
    if(!force&&state.cache&&state.cache.projectId===projectId&&Date.now()-state.cacheAt<45000)return state.cache;

    const [catalog,specRows,specQty,supplierItems,supplyDocs,supplyLines,montageEvents,avrDocs,avrVersions,avrRows,s29Docs,s29Rows,priceLinks,snapshotRows,journal]=await Promise.all([
      rows('catalog_items','id,mark,name',q=>q.eq('project_id',projectId).is('archived_at',null)),
      rows('specification_rows','id,catalog_item_id,position_no',q=>q.eq('project_id',projectId).is('archived_at',null)),
      rows('specification_quantities','specification_row_id,quantity',q=>q.eq('project_id',projectId)),
      rows('supplier_items','id,catalog_item_id,unit_volume_m3,link_state',q=>q.eq('project_id',projectId).is('archived_at',null)),
      rows('supply_documents','id,document_type,status,receipt_date',q=>q.eq('project_id',projectId)),
      rows('supply_document_lines','id,document_id,catalog_item_id,qty_pieces,qty_m3,match_state',q=>q.eq('project_id',projectId)),
      rows('montage_events','id,specification_row_id,event_type,quantity,event_date',q=>q.eq('project_id',projectId)),
      rows('avr_documents','id,period_month',q=>q.eq('project_id',projectId)),
      rows('avr_versions','id,document_id,state,signed_at',q=>q.eq('project_id',projectId)),
      rows('avr_rows','id,version_id,estimate_row_id,quantity,quantity_m3,amount',q=>q.eq('project_id',projectId)),
      rows('s29_documents','id,period_month,status,fixed_at',q=>q.eq('project_id',projectId)),
      rows('s29_rows','id,document_id,catalog_item_id,avr_quantity_pieces,avr_quantity_m3,written_off_m3,economy_m3,overrun_m3',q=>q.eq('project_id',projectId)),
      rows('supplier_price_links','id,catalog_item_id,supplier_item_id,validation_state',q=>q.eq('project_id',projectId)),
      rows('supplier_price_snapshot_rows','import_id,imported_at,catalog_item_id,supplier_item_id,validation_state,scope_key',q=>q.eq('project_id',projectId)),
      rows('reconciliation_journal','id,status,issue_key',q=>q.eq('project_id',projectId))
    ]);

    const qtyByRow=new Map();specQty.forEach(x=>qtyByRow.set(x.specification_row_id,Number(qtyByRow.get(x.specification_row_id)||0)+Number(x.quantity||0)));
    const specById=new Map(specRows.map(x=>[x.id,x]));
    const catalogById=new Map(catalog.map(x=>[x.id,x]));
    const projectQty=specRows.reduce((s,r)=>s+Number(qtyByRow.get(r.id)||0),0);

    const supplierVol=new Map();
    supplierItems.forEach(x=>{const v=Number(x.unit_volume_m3||0);if(x.catalog_item_id&&v>0&&!supplierVol.has(x.catalog_item_id))supplierVol.set(x.catalog_item_id,v);});
    const projectM3=specRows.reduce((s,r)=>s+Number(qtyByRow.get(r.id)||0)*Number(supplierVol.get(r.catalog_item_id)||0),0);

    const whiteDocIds=new Set(supplyDocs.filter(x=>x.document_type==='white').map(x=>x.id));
    const physicalLines=supplyLines.filter(x=>whiteDocIds.has(x.document_id));
    const suppliedQty=physicalLines.reduce((s,x)=>s+Number(x.qty_pieces||0),0);
    const suppliedM3=physicalLines.reduce((s,x)=>s+Number(x.qty_m3||0),0);
    const unmatchedSupply=physicalLines.filter(x=>!x.catalog_item_id||!x.match_state||String(x.match_state).toLowerCase().includes('не сопостав')).length;

    const mountedQty=montageEvents.filter(x=>x.event_type==='fact').reduce((s,x)=>s+Number(x.quantity||0),0);

    const activeVersionIds=new Set();
    avrDocs.forEach(d=>{const vs=avrVersions.filter(v=>v.document_id===d.id);const active=vs.find(v=>v.state==='signed'||v.signed_at)||vs.find(v=>v.state==='in_use');if(active)activeVersionIds.add(active.id);});
    const activeAvr=avrRows.filter(x=>activeVersionIds.has(x.version_id));
    const avrQty=activeAvr.reduce((s,x)=>s+Number(x.quantity||0),0);
    const avrAmount=activeAvr.reduce((s,x)=>s+Number(x.amount||0),0);

    const fixedDocIds=new Set(s29Docs.filter(x=>x.fixed_at||x.status==='fixed').map(x=>x.id));
    const fixedRows=s29Rows.filter(x=>fixedDocIds.has(x.document_id));
    const writtenM3=fixedRows.reduce((s,x)=>s+Number(x.written_off_m3||0),0);
    const economy=fixedRows.reduce((s,x)=>s+Number(x.economy_m3||0),0);
    const overrun=fixedRows.reduce((s,x)=>s+Number(x.overrun_m3||0),0);

    let latestImport="";
    snapshotRows.forEach(x=>{const k=String(x.imported_at||"");if(k>latestImport)latestImport=k;});
    const latestSnapshots=latestImport?snapshotRows.filter(x=>String(x.imported_at||"")===latestImport):snapshotRows;
    const unresolvedSet=new Set();
    latestSnapshots.forEach(x=>{const st=String(x.validation_state||'').toLowerCase();if(['review','unmatched','missing','not_in_new_version','manual_review'].includes(st)&&x.catalog_item_id)unresolvedSet.add(x.catalog_item_id);});
    const reconIssues=journal.filter(x=>!['resolved','ignored','closed'].includes(String(x.status||'').toLowerCase())).length;

    const data={projectId,catalog,specRows,specById,catalogById,qtyByRow,supplierVol,projectQty,projectM3,suppliedQty,suppliedM3,mountedQty,avrQty,avrAmount,writtenM3,economy,overrun,unresolvedPrice:unresolvedSet.size,unmatchedSupply,reconIssues,s29Rows:fixedRows,montageEvents,supplyLines:physicalLines,priceLinks};
    state.cache=data;state.cacheAt=Date.now();return data;
  }

  function go(target,targetTab){const b=document.querySelector('.nav-btn[data-page="'+CSS.escape(target)+'"]');if(b)b.click();if(targetTab!=null)setTimeout(()=>{const t=document.querySelectorAll('#pageTabs .page-tab');if(t[targetTab])t[targetTab].click();},60);}
  function progress(label,value,tone){return '<div class="ux-progress-row" data-tone="'+tone+'"><label>'+esc(label)+'</label><div class="ux-progress-track"><span style="width:'+Math.round(value)+'%"></span></div><b>'+Math.round(value)+'%</b></div>';}
  function kpi(label,value,sub,tone,percent,target,targetTab){return '<div class="ux-kpi" data-tone="'+tone+'" data-ux-go="'+target+'" data-ux-tab="'+targetTab+'"><div class="ux-kpi-head"><i class="ux-kpi-dot"></i><div class="ux-kpi-label">'+esc(label)+'</div></div><div class="ux-kpi-value">'+value+'</div><div class="ux-kpi-sub">'+esc(sub)+'</div><div class="ux-kpi-progress"><span style="width:'+Math.round(percent)+'%"></span></div></div>';}

  async function renderHome(force){
    if(page()!=='home')return;
    const area=$('workArea');if(!area)return;
    if(!force&&(state.homeLoading||area.querySelector('.ux-dashboard-grid')))return;
    state.homeLoading=true;
    area.className='work-area content-work';
    area.innerHTML='<div class="ux-dashboard"><div class="ux-drawer-loading">Формирую рабочую сводку…</div></div>';
    try{
      const d=await dashboardData(force);if(!d)return;
      const supplyPct=pct(d.suppliedQty,d.projectQty),montagePct=pct(d.mountedQty,d.projectQty),avrPct=pct(d.avrQty,d.projectQty),writePct=pct(d.writtenM3,d.projectM3);
      const attention=[];
      if(d.unresolvedPrice)attention.push({tone:'warn',status:'Проверить',area:'Прайс поставщика',text:'Позиции требуют проверки сопоставления',count:d.unresolvedPrice,target:'supply',tab:2});
      if(d.unmatchedSupply)attention.push({tone:'bad',status:'Не связано',area:'Поставка',text:'Строки белых ТТН без связи с проектной номенклатурой',count:d.unmatchedSupply,target:'supply',tab:1});
      if(d.reconIssues)attention.push({tone:'warn',status:'Контроль',area:'Сверка',text:'Открытые замечания смета ↔ спецификация',count:d.reconIssues,target:'recon',tab:0});
      if(d.overrun>.0001)attention.push({tone:'bad',status:'Перерасход',area:'С-29',text:'Зафиксирован перерасход материалов',count:num2.format(d.overrun)+' м³',target:'s29',tab:3});
      if(!attention.length)attention.push({tone:'ok',status:'Норма',area:'Контроль',text:'Критичных открытых расхождений не найдено',count:'',target:'recon',tab:0});
      const att=attention.map(x=>'<tr data-ux-go="'+x.target+'" data-ux-tab="'+x.tab+'"><td><span class="ux-attention-status '+x.tone+'"><i></i>'+esc(x.status)+'</span></td><td>'+esc(x.area)+'</td><td>'+esc(x.text)+'</td><td class="ux-attention-count">'+esc(x.count)+'</td></tr>').join('');
      area.innerHTML='<div class="ux-dashboard"><div class="ux-dashboard-head"><div class="ux-dashboard-title"><strong>Рабочая сводка ПТО</strong><span>живые данные объекта</span></div><span class="spacer"></span><div class="ux-mode-switch"><button class="active" type="button" data-ux-pto>ПТО</button><button type="button" data-ux-manager>Руководитель</button></div><button class="ux-dashboard-refresh" type="button" data-ux-refresh>Обновить</button></div><div class="ux-dashboard-grid">'+
        kpi('Проект',num0.format(d.projectQty)+' шт.',num2.format(d.projectM3)+' м³ · '+num0.format(d.specRows.length)+' строк','blue',100,'spec',1)+
        kpi('Поставка',num0.format(d.suppliedQty)+' шт.',num2.format(d.suppliedM3)+' м³ · '+Math.round(supplyPct)+'% проекта','green',supplyPct,'supply',0)+
        kpi('Монтаж',num0.format(d.mountedQty)+' шт.','осталось '+num0.format(Math.max(0,d.projectQty-d.mountedQty))+' шт.','green',montagePct,'montage',0)+
        kpi('АВР',num0.format(d.avrQty)+' шт.',money.format(d.avrAmount)+' руб.','blue',avrPct,'avr',0)+
        kpi('С-29',num2.format(d.writtenM3)+' м³','экономия '+num2.format(d.economy)+' · перерасход '+num2.format(d.overrun),'amber',writePct,'s29',0)+
        kpi('Контроль',num0.format(d.unresolvedPrice+d.unmatchedSupply+d.reconIssues),'позиций и замечаний требуют внимания',d.unresolvedPrice+d.unmatchedSupply+d.reconIssues?'red':'green',d.unresolvedPrice+d.unmatchedSupply+d.reconIssues?70:100,'recon',0)+
        '</div><div class="ux-dashboard-body"><div class="ux-panel"><div class="ux-panel-head"><strong>Требует внимания</strong><span>только открытые рабочие вопросы</span><span class="spacer"></span><button class="ux-panel-link" data-ux-go="recon" data-ux-tab="0" type="button">Открыть сверку</button></div><table class="ux-attention-table"><thead><tr><th>Состояние</th><th>Раздел</th><th>Что проверить</th><th class="ux-attention-count">Кол-во</th></tr></thead><tbody>'+att+'</tbody></table></div><div class="ux-panel"><div class="ux-panel-head"><strong>Исполнение проекта</strong><span class="spacer"></span></div><div class="ux-progress-list">'+progress('Поставка',supplyPct,'green')+progress('Монтаж',montagePct,'green')+progress('АВР',avrPct,'blue')+progress('Списание',writePct,'amber')+'</div><div class="ux-dashboard-note">Проценты считаются от проектного количества/объёма. Карточки и строки открывают соответствующий рабочий модуль.</div></div></div></div>';
      area.querySelectorAll('[data-ux-go]').forEach(x=>x.onclick=()=>go(x.dataset.uxGo,Number(x.dataset.uxTab||0)));
      const refresh=area.querySelector('[data-ux-refresh]');if(refresh)refresh.onclick=()=>{state.cache=null;renderHome(true);};
      const manager=area.querySelector('[data-ux-manager]');if(manager)manager.onclick=()=>managerMode(area);
      const pto=area.querySelector('[data-ux-pto]');if(pto)pto.onclick=()=>renderHome(true);
    }catch(err){area.innerHTML='<div class="review-panel"><div class="review-panel-title">Рабочая сводка</div><div class="review-note">Не удалось сформировать сводку: '+esc(err&&err.message?err.message:String(err))+'</div></div>';}
    finally{state.homeLoading=false;}
  }

  function managerMode(area){const title=area.querySelector('.ux-dashboard-title strong');if(title)title.textContent='Сводка руководителя';const b=area.querySelectorAll('.ux-mode-switch button');b.forEach(x=>x.classList.remove('active'));if(b[1])b[1].classList.add('active');const note=area.querySelector('.ux-dashboard-note');if(note)note.textContent='Управленческий режим: выполнение, стоимость и ключевые отклонения без технической детализации.';}

  // Active column filters as chips: «Марка: ПБ 60-12, НС-1 ×». Values come from the
  // filter state itself, so the chip says exactly what is shown.
  function filterEntries(){
    const filters=(ui.columnFilters&&ui.columnFilters[currentViewKey()])||{};
    return Object.keys(filters).map(field=>{
      const b=document.querySelector('#workArea .column-filter-trigger[data-column-filter="'+CSS.escape(field)+'"]');
      const head=b&&b.closest('th')&&b.closest('th').querySelector('.header-label');
      const name=(head&&head.textContent.trim())||field;
      const values=Array.from(filters[field]||[]).map(v=>v||'(Пусто)');
      const shown=values.length?(values.length<=2?values.join(', '):values.slice(0,2).join(', ')+' и ещё '+(values.length-2)):'ничего';
      return {field,label:name+': '+shown,title:name+': '+values.join(', ')};
    });
  }
  function clearField(field){clearColumnFilter(field);rerenderContent();}
  function clearAll(){Object.keys((ui.columnFilters&&ui.columnFilters[currentViewKey()])||{}).forEach(clearColumnFilter);rerenderContent();}

  function serviceTools(){
    const left=$('serviceLeft'),right=$('serviceRight');if(!left||!right)return;
    const entries=filterEntries(),sig=entries.map(x=>x.label).join('|');let box=left.querySelector('.ux-filter-summary');
    if(entries.length){
      if(!box){box=document.createElement('span');box.className='ux-filter-summary';left.appendChild(box);}
      if(box.dataset.sig!==sig){box.dataset.sig=sig;box.innerHTML='<span class="ux-filter-caption">Фильтры:</span>'+entries.map(x=>'<span class="ux-filter-chip" title="'+esc(x.title)+'"><span>'+esc(x.label)+'</span><button type="button" data-field="'+esc(x.field)+'">×</button></span>').join('')+'<button class="ux-clear-filters" type="button" data-all>Сбросить все</button>';box.querySelectorAll('[data-field]').forEach(b=>b.onclick=()=>clearField(b.dataset.field));const a=box.querySelector('[data-all]');if(a)a.onclick=clearAll;}
    }else if(box)box.remove();
    let tools=right.querySelector('.ux-service-tools');
    // "Колонки" only makes sense next to a table.
    if(!document.querySelector('#workArea table')){if(tools)tools.remove();return;}
    if(!tools){tools=document.createElement('span');tools.className='ux-service-tools';tools.innerHTML='<span class="ux-service-separator"></span><button class="ux-tool-link" type="button" data-cols>Колонки</button>';right.appendChild(tools);}
    const c=tools.querySelector('[data-cols]');if(c)c.onclick=e=>openColumns(e.currentTarget);
  }

  function headers(table){if(!table||!table.tHead)return[];let logical=0,out=[];Array.from(table.tHead.rows[0].cells).forEach(th=>{const span=Number(th.colSpan||1),label=(th.innerText||'').replace(/\s+/g,' ').trim();if(span===1)out.push({index:logical,label:label||('Колонка '+(logical+1))});logical+=span;});return out;}
  function popup(){let p=document.querySelector('.ux-column-popup');if(p)return p;p=document.createElement('div');p.className='ux-column-popup';document.body.appendChild(p);return p;}
  function grid(table){const rows=Array.from(table.rows),g=[];rows.forEach((tr,ri)=>{if(!g[ri])g[ri]=[];let ci=0;Array.from(tr.cells).forEach(cell=>{while(g[ri][ci])ci++;const cs=Number(cell.colSpan||1),rs=Number(cell.rowSpan||1);for(let r=0;r<rs;r++){if(!g[ri+r])g[ri+r]=[];for(let c=0;c<cs;c++)g[ri+r][ci+c]=cell;}ci+=cs;});});return g;}
  function applyHidden(table,set){
    const g=grid(table),seen=new Set();g.forEach(row=>row.forEach(cell=>{if(seen.has(cell))return;seen.add(cell);const indexes=[];for(let i=0;i<row.length;i++)if(row[i]===cell)indexes.push(i);cell.style.display=indexes.length&&indexes.every(i=>set.has(i))?'none':'';}));
    const cols=table.querySelectorAll('colgroup col');cols.forEach((c,i)=>c.style.display=set.has(i)?'none':'');
    if(typeof refreshFrozenColumns==='function')refreshFrozenColumns(table);
  }
  function storageKey(table){return 'filimonova.hiddenColumns.'+(table.dataset.tableKey||page()+'.'+tab());}
  function restoreColumns(){document.querySelectorAll('#workArea table').forEach(t=>{let x=[];try{x=JSON.parse(localStorage.getItem(storageKey(t))||'[]');}catch(_){}applyHidden(t,new Set(x.map(Number)));});}
  function openColumns(anchor){const table=document.querySelector('#workArea table');if(!table)return;const h=headers(table);if(!h.length)return;let x=[];try{x=JSON.parse(localStorage.getItem(storageKey(table))||'[]');}catch(_){}const set=new Set(x.map(Number)),p=popup();p.innerHTML='<div class="ux-column-popup-head">Показывать колонки</div><div class="ux-column-popup-list">'+h.map(v=>'<label class="ux-column-option"><input type="checkbox" data-col="'+v.index+'" '+(set.has(v.index)?'':'checked')+'><span>'+esc(v.label)+'</span></label>').join('')+'</div><div class="ux-column-popup-foot"><button type="button" data-show-all>Показать все</button><span class="spacer"></span><button type="button" data-close>Закрыть</button></div>';const r=anchor.getBoundingClientRect();p.style.left=Math.max(8,Math.min(window.innerWidth-276,r.right-268))+'px';p.style.top=Math.min(window.innerHeight-430,r.bottom+5)+'px';p.classList.add('open');p.querySelectorAll('[data-col]').forEach(c=>c.onchange=()=>{const i=Number(c.dataset.col);if(c.checked)set.delete(i);else set.add(i);localStorage.setItem(storageKey(table),JSON.stringify(Array.from(set)));applyHidden(table,set);});p.querySelector('[data-show-all]').onclick=()=>{set.clear();localStorage.setItem(storageKey(table),'[]');applyHidden(table,set);p.querySelectorAll('[data-col]').forEach(c=>c.checked=true);};p.querySelector('[data-close]').onclick=()=>p.classList.remove('open');}

  function drawer(){let d=document.querySelector('.ux-detail-drawer');if(d)return d;d=document.createElement('aside');d.className='ux-detail-drawer';d.innerHTML='<div class="ux-drawer-head"><div class="ux-drawer-ident"><div class="ux-drawer-kicker">Позиция проекта</div><strong>—</strong><span>—</span></div><button class="ux-drawer-close" type="button">×</button></div><div class="ux-drawer-tabs"><button class="ux-drawer-tab active" data-dtab="overview" type="button">Обзор</button><button class="ux-drawer-tab" data-dtab="refs" type="button">Связи</button></div><div class="ux-drawer-body"></div>';document.body.appendChild(d);d.querySelector('.ux-drawer-close').onclick=()=>d.classList.remove('open');d.querySelectorAll('[data-dtab]').forEach(b=>b.onclick=()=>{d.querySelectorAll('.ux-drawer-tab').forEach(x=>x.classList.toggle('active',x===b));renderDrawer(b.dataset.dtab);});return d;}
  function metric(label,value){return '<div class="ux-drawer-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
  function section(title,body){return '<div class="ux-drawer-section"><div class="ux-drawer-section-head"><strong>'+esc(title)+'</strong></div>'+body+'</div>';}
  function itemStats(item,d){const rs=d.specRows.filter(r=>r.catalog_item_id===item.id),ids=new Set(rs.map(r=>r.id)),projectQty=rs.reduce((s,r)=>s+Number(d.qtyByRow.get(r.id)||0),0),vol=Number(d.supplierVol.get(item.id)||0),supplied=d.supplyLines.filter(x=>x.catalog_item_id===item.id).reduce((s,x)=>s+Number(x.qty_pieces||0),0),mounted=d.montageEvents.filter(x=>x.event_type==='fact'&&ids.has(x.specification_row_id)).reduce((s,x)=>s+Number(x.quantity||0),0),s29=d.s29Rows.filter(x=>x.catalog_item_id===item.id),written=s29.reduce((s,x)=>s+Number(x.written_off_m3||0),0),econ=s29.reduce((s,x)=>s+Number(x.economy_m3||0),0),over=s29.reduce((s,x)=>s+Number(x.overrun_m3||0),0);return{rs,projectQty,vol,projectM3:projectQty*vol,supplied,mounted,written,econ,over};}
  async function openDrawer(row){const id=row.dataset.materialId||'',mark=row.dataset.materialMark||((row.querySelector('[data-filter-field="mark"],[data-filter-field="basis"]')||{}).textContent||'').trim();if(!id&&!mark)return;const d=drawer();d.classList.add('open');d.querySelector('.ux-drawer-ident strong').textContent=mark||'Материал';d.querySelector('.ux-drawer-ident span').textContent='Загрузка…';d.querySelector('.ux-drawer-body').innerHTML='<div class="ux-drawer-loading">Собираю данные по позиции…</div>';try{const data=await dashboardData(false);let item=id?data.catalogById.get(id):null;if(!item&&mark)item=data.catalog.find(x=>x.mark===mark);if(!item)throw new Error('Позиция не найдена в каталоге.');state.drawerItem=item;d.querySelector('.ux-drawer-ident strong').textContent=item.mark||'Материал';d.querySelector('.ux-drawer-ident span').textContent=item.name||'';renderDrawer('overview');}catch(e){d.querySelector('.ux-drawer-body').innerHTML='<div class="ux-drawer-loading">'+esc(e.message||String(e))+'</div>';}}
  async function renderDrawer(mode){const d=drawer(),item=state.drawerItem;if(!item)return;const data=await dashboardData(false),s=itemStats(item,data);if(mode==='overview'){d.querySelector('.ux-drawer-body').innerHTML='<div class="ux-drawer-grid">'+metric('Проект',num0.format(s.projectQty)+' шт.')+metric('Поставлено',num0.format(s.supplied)+' шт.')+metric('Смонтировано',num0.format(s.mounted)+' шт.')+metric('Объём/ед.',s.vol?num2.format(s.vol)+' м³':'—')+metric('Списано',num2.format(s.written)+' м³')+metric('Осталось',num0.format(Math.max(0,s.projectQty-s.mounted))+' шт.')+'</div>'+section('Контроль','<ul class="ux-ref-list"><li><b>Экономия</b><span>'+num2.format(s.econ)+' м³</span></li><li><b>Перерасход</b><span>'+num2.format(s.over)+' м³</span></li><li><b>Проектный объём</b><span>'+num2.format(s.projectM3)+' м³</span></li></ul>');}else{const spec=s.rs.length?s.rs.map(r=>'№ '+(r.position_no||'—')).join(', '):'нет',docs=data.supplyLines.filter(x=>x.catalog_item_id===item.id).length,links=data.priceLinks.filter(x=>x.catalog_item_id===item.id).length;d.querySelector('.ux-drawer-body').innerHTML=section('Вертикальная трассировка','<ul class="ux-ref-list"><li><b>Спецификация</b><span>'+esc(spec)+'</span></li><li><b>Прайс</b><span>'+num0.format(links)+' связей</span></li><li><b>Поставка</b><span>'+num0.format(docs)+' строк белых ТТН</span></li><li><b>Монтаж</b><span>'+num0.format(s.mounted)+' шт.</span></li><li><b>С-29</b><span>'+num2.format(s.written)+' м³ списано</span></li></ul>');}}
  function wireDrawer(){document.querySelectorAll('#workArea .data-row[data-material-id],#workArea .data-row[data-material-mark]').forEach(r=>{if(r.dataset.uxDrawerWired)return;r.dataset.uxDrawerWired='1';r.addEventListener('click',e=>{if(e.target.closest('button,input,select,a,.day-cell,.column-filter-trigger'))return;openDrawer(r);});});}

  function statuses(){document.querySelectorAll('#workArea td,#workArea .supply-doc-state,#workArea .ttn-link-state').forEach(el=>{if(el.dataset.uxStatus)return;const t=(el.textContent||'').trim().toLowerCase();let c='';if((/сопоставлено|подписан|закрыт|совпадает|норма|используется/.test(t)||t==='поставлено')&&!/не сопостав/.test(t))c='ux-state-ok';else if(/провер|замеч|частич|без цены|нет в новой|ожида/.test(t))c='ux-state-warn';else if(/ошиб|перерасход|перепостав|не сопостав|расхожд/.test(t))c='ux-state-bad';if(c){el.classList.add(c);el.dataset.uxStatus='1';}});}

  function gpr(){const table=document.querySelector('#workArea .gpr-table');if(!table||table.dataset.uxGprEnhanced)return;table.dataset.uxGprEnhanced='1';table.querySelectorAll('tbody tr.data-row').forEach(r=>{const cells=Array.from(r.querySelectorAll('.gpr-month')),active=cells.filter(c=>{const n=Number((c.textContent||'').replace(/\s/g,'').replace(',','.'));return n>0;});if(!active.length)return;const a=cells.indexOf(active[0]),b=cells.indexOf(active[active.length-1]);for(let i=a;i<=b;i++)cells[i].classList.add('ux-gpr-span');active.forEach(c=>c.classList.add('ux-gpr-active'));cells[a].classList.add('ux-gpr-start');cells[b].classList.add('ux-gpr-end');});const right=$('serviceRight');if(!right||right.querySelector('.ux-gpr-scale'))return;const s=document.createElement('span');s.className='ux-gpr-scale';s.innerHTML='<button class="active" data-scale="month" type="button">Месяц</button><button data-scale="quarter" type="button">Квартал</button><button data-scale="year" type="button">Год</button>';right.insertBefore(s,right.firstChild);s.querySelectorAll('button').forEach(b=>b.onclick=()=>{s.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));table.classList.toggle('ux-gpr-scale-quarter',b.dataset.scale==='quarter');table.classList.toggle('ux-gpr-scale-year',b.dataset.scale==='year');});}

  // Bars above the work area that ended up with nothing in them take no space.
  function hideEmptyBars(){
    const filled=el=>!!el&&(!!el.textContent.trim()||!!el.querySelector('select,input,button'));
    const service=$('serviceRow');if(service)service.classList.toggle('is-empty',!filled($('serviceLeft'))&&!filled($('serviceRight')));
    const context=$('contextRow');if(context)context.classList.toggle('is-empty',!filled(context));
  }
  function afterRender(){if(page()==='home'){renderHome(false);hideEmptyBars();return;}serviceTools();restoreColumns();wireDrawer();statuses();if(page()==='estimates'&&tab()===2)gpr();hideEmptyBars();}
  function schedule(){clearTimeout(state.timer);state.timer=setTimeout(afterRender,80);}
  function start(){const root=$('appView')||document.body;state.observer=new MutationObserver(schedule);state.observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});document.addEventListener('click',schedule,true);schedule();}

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
