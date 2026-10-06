function renderAccounting() {
  const imports=(dataState.imports||[]).filter(function(x){return x.domain==="accounting";}).sort(function(a,b){return String(b.imported_at).localeCompare(String(a.imported_at));});
  let body=imports.map(function(imp){
    const count=(dataState.accountingRows||[]).filter(function(x){return x.import_id===imp.id;}).length;
    const selected=(dataState.accountingPeriodSources||[]).some(function(x){return x.import_id===imp.id;});
    return '<tr class="data-row"><td>'+esc(periodLabel(imp.source_period,false))+'</td><td>'+esc(imp.source_name||"—")+'</td><td>'+dateTimeLabel(imp.imported_at)+'</td><td class="num">'+count+'</td><td><span class="execution-status '+(selected?'in_use':'draft')+'">'+(selected?'Используется':'Снимок')+'</span></td></tr>';
  }).join("");
  if(!body) body=tableMessage("Бухгалтерские отчёты ещё не импортировались.",5);
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table"><thead><tr><th>Период</th><th>Файл</th><th>Импортирован</th><th>Строк</th><th>Статус</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function accountingBaseText(value) {
  return importNorm(value)
    .replace(/ё/g,"е")
    .replace(/[–—−]/g,"-");
}

function accountingTokens(value,visual) {
  let text=accountingBaseText(value);
  if(visual) text=text.replace(/[oо0]/g,"0");
  return text.match(/[a-zа-я]+|[0-9]+/gi)||[];
}

function accountingTokenKey(value,visual) {
  return accountingTokens(value,visual).join("|");
}

function accountingNumbers(value) {
  return accountingTokens(value,false).filter(function(x){return /^[0-9]+$/.test(x);}).join("|");
}

function accountingSourceParts(value) {
  const raw=String(value==null?"":value).trim();
  const open=raw.indexOf("(");
  if(open<0) return {raw:raw,outer:raw,inner:raw,hasParen:false};
  const close=raw.lastIndexOf(")");
  return {
    raw:raw,
    outer:raw.slice(0,open).trim(),
    inner:raw.slice(open+1,close>open?close:raw.length).trim(),
    hasParen:true
  };
}

function accountingTokensEndWith(haystack,needle) {
  if(!needle.length||needle.length>haystack.length) return false;
  const start=haystack.length-needle.length;
  for(let i=0;i<needle.length;i++) if(haystack[start+i]!==needle[i]) return false;
  return true;
}

function accountingTokenSimilarity(a,b) {
  const aa=new Set(accountingTokens(a,true).filter(function(x){return x.length>1 || /^[0-9]+$/.test(x);}));
  const bb=new Set(accountingTokens(b,true).filter(function(x){return x.length>1 || /^[0-9]+$/.test(x);}));
  if(!aa.size||!bb.size) return 0;
  let common=0;
  aa.forEach(function(x){if(bb.has(x)) common++;});
  return common/Math.max(aa.size,bb.size);
}

function accountingMatchingCatalogContext() {
  const specIds=new Set((dataState.specRows||[]).map(function(x){return x.catalog_item_id;}));
  const catalog=(dataState.catalogItems||[]).filter(function(item){return specIds.has(item.id);});
  const markCounts=new Map();
  catalog.forEach(function(item){
    const key=accountingTokenKey(item.mark,true);
    markCounts.set(key,Number(markCounts.get(key)||0)+1);
  });
  return {catalog:catalog,markCounts:markCounts};
}

function accountingProjectFamilySet() {
  const families=new Set();
  const specIds=new Set((dataState.specRows||[]).map(function(x){return x.catalog_item_id;}));
  (dataState.catalogItems||[]).forEach(function(item){
    if(!specIds.has(item.id)) return;
    const markTokens=accountingTokens(item.mark,true);
    markTokens.forEach(function(token){
      if(/^[a-zа-я]{2,6}$/i.test(token)) families.add(token);
    });
    const nameTokens=accountingTokens(item.name,true);
    // From project names keep only compact code-like tokens, not descriptive words.
    nameTokens.slice(0,3).forEach(function(token){
      if(/^[a-zа-я]{2,6}$/i.test(token) && token.length<=5) families.add(token);
    });
  });
  return families;
}

function accountingRelevantCodeSet() {
  const relevant=new Set();
  const linked=new Set((dataState.accountingCodeLinks||[]).map(function(x){return String(x.accounting_code||"");}));
  linked.forEach(function(code){if(code) relevant.add(code);});

  const families=accountingProjectFamilySet();
  const sourceByCode=new Map();
  (dataState.accountingRows||[]).forEach(function(row){
    const code=String(row.material_code||"").trim();
    if(!code) return;
    if(!sourceByCode.has(code)) sourceByCode.set(code,[]);
    sourceByCode.get(code).push(String(row.name||""));
  });

  sourceByCode.forEach(function(names,code){
    if(relevant.has(code)) return;
    const isProjectLike=names.some(function(name){
      const numberCount=(accountingNumbers(name).match(/[0-9]+/g)||[]).length;
      if(numberCount<2) return false;
      const tokens=accountingTokens(name,true);
      return tokens.some(function(token){
        if(families.has(token)) return true;
        // Common bookkeeping variants add "э" to a project family (ППэ, ВСэ, ЗНСэ).
        if(token.endsWith("э") && families.has(token.slice(0,-1))) return true;
        return false;
      });
    });
    if(isProjectLike) relevant.add(code);
  });

  return relevant;
}

function accountingManualNameMemory() {
  const manualByCode=new Map();
  (dataState.accountingCodeLinks||[]).forEach(function(link){
    if(link.link_method==="manual"&&link.accounting_code&&link.catalog_item_id) {
      manualByCode.set(String(link.accounting_code),link.catalog_item_id);
    }
  });
  const buckets=new Map();
  (dataState.accountingRows||[]).forEach(function(row){
    const id=manualByCode.get(String(row.material_code||""));
    if(!id) return;
    const key=accountingTokenKey(row.name,true);
    if(!key) return;
    if(!buckets.has(key)) buckets.set(key,new Set());
    buckets.get(key).add(id);
  });
  const learned=new Map();
  buckets.forEach(function(ids,key){
    if(ids.size===1) learned.set(key,Array.from(ids)[0]);
  });
  return {manualByCode:manualByCode,learnedByName:learned};
}

function accountingMatchEvidence(sourceName,item,context) {
  const parts=accountingSourceParts(sourceName);
  const outerTokens=accountingTokens(parts.outer,true);
  const fullTokens=accountingTokens(parts.raw,true);
  const innerTokens=accountingTokens(parts.inner,false);
  const innerVisualTokens=accountingTokens(parts.inner,true);
  const markTokens=accountingTokens(item.mark,true);
  const nameTokens=accountingTokens(item.name,false);
  const nameVisualTokens=accountingTokens(item.name,true);

  const markExact=accountingTokensEndWith(outerTokens,markTokens);
  const nameExact=innerTokens.length>0 && innerTokens.join("|")===nameTokens.join("|");
  const nameVisualExact=innerVisualTokens.length>0 && innerVisualTokens.join("|")===nameVisualTokens.join("|");
  const nameContained=!parts.hasParen && nameVisualTokens.length>=3 && accountingTokensEndWith(fullTokens,nameVisualTokens);
  const sourceNums=accountingNumbers(parts.inner);
  const projectNums=accountingNumbers(item.name);
  const numbersExact=!!sourceNums && sourceNums===projectNums;
  const markKey=accountingTokenKey(item.mark,true);
  const markUnique=Number(context.markCounts.get(markKey)||0)===1;
  const enoughNumbers=sourceNums ? sourceNums.split("|").length>=2 : false;

  let score=0;
  if(nameExact) score+=30000;
  else if(nameVisualExact) score+=29000;
  else if(nameContained) score+=28000;
  if(markExact) score+=5000;
  if(markExact&&markUnique&&numbersExact&&enoughNumbers) score+=7000;
  else if(numbersExact) score+=1000;
  score+=Math.round(accountingTokenSimilarity(sourceName,(item.mark||"")+" "+(item.name||""))*500);

  const autoSafe=nameExact||nameVisualExact||nameContained||(markExact&&markUnique&&numbersExact&&enoughNumbers);
  let reason="Похожее совпадение";
  if(nameExact&&markExact) reason="Марка + точное обозначение";
  else if(nameExact) reason="Точное обозначение";
  else if(nameVisualExact&&markExact) reason="Марка + обозначение О/0";
  else if(nameVisualExact) reason="Обозначение с допустимой О/0";
  else if(nameContained) reason="Номенклатура в тексте отчёта";
  else if(markExact&&markUnique&&numbersExact&&enoughNumbers) reason="Марка + числовое обозначение";

  const attention=autoSafe&&!markExact&&(nameExact||nameVisualExact)
    ?"Наименование совпало, марка в отчёте отличается"
    :"";

  return {
    score:score,
    autoSafe:autoSafe,
    reason:reason,
    attention:attention,
    markExact:markExact,
    nameExact:nameExact,
    nameVisualExact:nameVisualExact,
    numbersExact:numbersExact
  };
}

function accountingLinkCandidates(code,query) {
  const rows=(dataState.accountingRows||[]).filter(function(x){return String(x.material_code||"")===String(code||"");});
  const sourceName=rows[0]&&rows[0].name||"";
  const current=(dataState.accountingCodeLinks||[]).find(function(x){return String(x.accounting_code||"")===String(code||"");});
  const context=accountingMatchingCatalogContext();
  const q=importNorm(query||"");

  return context.catalog.filter(function(item){
    if(!q) return true;
    return importNorm(item.mark).includes(q)||importNorm(item.name).includes(q);
  }).map(function(item){
    const evidence=accountingMatchEvidence(sourceName,item,context);
    let score=evidence.score;
    const isCurrent=!!(current&&current.catalog_item_id===item.id);
    if(isCurrent) score+=100000;
    return {
      item:item,
      score:score,
      current:isCurrent,
      autoSafe:evidence.autoSafe,
      reason:evidence.reason,
      attention:evidence.attention
    };
  }).sort(function(a,b){
    return b.score-a.score||
      String(a.item.mark||"").localeCompare(String(b.item.mark||""),"ru",{numeric:true,sensitivity:"base"})||
      String(a.item.name||"").localeCompare(String(b.item.name||""),"ru",{numeric:true,sensitivity:"base"});
  });
}

function accountingLinkModal() {
  let modal=document.getElementById("accountingLinkModal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="accountingLinkModal";
  modal.className="spec-import-backdrop";
  modal.innerHTML=
    '<div class="recon-edit-modal accounting-link-modal">'+
      '<div class="spec-import-head"><div><strong>Связь с бухгалтерией</strong><span class="accounting-link-caption">Выберите позицию нашей спецификации</span></div><button class="spec-import-close" type="button">×</button></div>'+
      '<div class="recon-source-card"><div class="recon-block-label">Строка бухгалтерии — привязываем</div><div class="recon-source-grid">'+
        '<div><span>Код материала</span><strong class="accounting-source-code"></strong></div>'+
        '<div class="recon-source-name-wrap"><span>Наименование бухгалтерии</span><strong class="accounting-source-name"></strong></div>'+
        '<div><span>Текущая связь</span><strong class="accounting-current-link"></strong></div>'+
      '</div></div>'+
      '<div class="accounting-link-search-row"><span>Наша спецификация</span><input type="text" data-accounting-candidate-search placeholder="Поиск по марке или наименованию"></div>'+
      '<div class="recon-edit-list accounting-candidate-list"></div>'+
      '<div class="spec-import-foot"><button class="context-link accounting-link-remove" type="button">Убрать связь</button><span class="accounting-link-state"></span><span class="spacer"></span><button class="context-link accounting-link-cancel" type="button">Отмена</button><button class="context-link accounting-link-save" type="button">Сохранить</button></div>'+
    '</div>';
  document.body.appendChild(modal);
  const close=function(){modal.classList.remove("open");};
  modal.querySelector(".spec-import-close").onclick=close;
  modal.querySelector(".accounting-link-cancel").onclick=close;
  modal.onclick=function(e){if(e.target===modal) close();};
  modal.querySelector("[data-accounting-candidate-search]").oninput=function(){
    renderAccountingLinkCandidates(modal,modal.dataset.accountingCode,this.value);
  };
  modal.querySelector(".accounting-link-save").onclick=async function(){
    const code=modal.dataset.accountingCode;
    const picked=modal.querySelector("[data-accounting-catalog]:checked");
    if(!picked) return;
    const state=modal.querySelector(".accounting-link-state");
    state.textContent="Сохраняю…";
    try{
      const result=await client.rpc("set_accounting_code_link",{
        p_project_id:dataState.project.id,
        p_accounting_code:code,
        p_catalog_item_id:picked.dataset.accountingCatalog
      });
      if(result.error) throw result.error;
      await refreshProjectDataSlices(["accountingCodeLinks"],dataState.project);
      modal.classList.remove("open");
      rerenderContent();
    }catch(err){
      state.textContent=err&&err.message?err.message:String(err);
    }
  };
  modal.querySelector(".accounting-link-remove").onclick=async function(){
    const code=modal.dataset.accountingCode;
    const current=(dataState.accountingCodeLinks||[]).find(function(x){return x.accounting_code===code;});
    if(!current) return;
    const ok=await executionConfirm("Убрать связь","Бухгалтерский код "+code+" больше не будет связан с проектной номенклатурой.","Убрать связь");
    if(!ok) return;
    const state=modal.querySelector(".accounting-link-state");
    state.textContent="Удаляю…";
    try{
      const result=await client.rpc("set_accounting_code_link",{
        p_project_id:dataState.project.id,
        p_accounting_code:code,
        p_catalog_item_id:null
      });
      if(result.error) throw result.error;
      await refreshProjectDataSlices(["accountingCodeLinks"],dataState.project);
      modal.classList.remove("open");
      rerenderContent();
    }catch(err){
      state.textContent=err&&err.message?err.message:String(err);
    }
  };
  return modal;
}

function renderAccountingLinkCandidates(modal,code,query) {
  const ranked=accountingLinkCandidates(code,query);
  const list=modal.querySelector(".accounting-candidate-list");
  const shown=ranked.slice(0,80);
  if(!shown.length){
    list.innerHTML='<div class="review-note">По запросу ничего не найдено.</div>';
    return;
  }
  list.innerHTML='<table class="recon-candidate-table accounting-candidate-table"><colgroup><col class="accounting-col-pick"><col class="accounting-col-mark"><col><col class="accounting-col-section"></colgroup><thead><tr><th>Выбор</th><th>Марка</th><th>Наименование проекта</th><th>Раздел</th></tr></thead><tbody>'+
    shown.map(function(c,index){
      const sections=Array.from(new Set((dataState.specRows||[]).filter(function(r){return r.catalog_item_id===c.item.id;}).map(function(r){
        const s=(dataState.specSections||[]).find(function(x){return x.id===r.section_id;});
        return s?s.name:"";
      }).filter(Boolean)));
      return '<tr class="recon-candidate-row'+(c.current?' is-selected':'')+'" data-accounting-candidate-row>'+
        '<td class="recon-pick-cell"><input type="radio" name="accounting-catalog-candidate" data-accounting-catalog="'+esc(c.item.id)+'" '+(c.current?'checked':'')+'></td>'+
        '<td><strong>'+esc(c.item.mark||"—")+'</strong>'+(index===0&&!c.current?'<small class="recon-table-note">Предлагаем · '+esc(c.reason||"")+'</small>':c.current?'<small class="recon-table-note">Текущая связь</small>':'')+'</td>'+
        '<td>'+esc(c.item.name||"—")+'</td>'+
        '<td>'+esc(sections.slice(0,2).join(" / ")||"—")+'</td>'+
      '</tr>';
    }).join("")+'</tbody></table>';
  list.querySelectorAll("[data-accounting-candidate-row]").forEach(function(row){
    const input=row.querySelector("[data-accounting-catalog]");
    row.onclick=function(ev){
      if(ev.target!==input) input.checked=true;
      list.querySelectorAll("[data-accounting-candidate-row]").forEach(function(r){
        r.classList.toggle("is-selected",!!r.querySelector("[data-accounting-catalog]:checked"));
      });
    };
    input.onchange=function(){
      list.querySelectorAll("[data-accounting-candidate-row]").forEach(function(r){
        r.classList.toggle("is-selected",!!r.querySelector("[data-accounting-catalog]:checked"));
      });
    };
  });
}

function openAccountingLinkEditor(code) {
  const rows=(dataState.accountingRows||[]).filter(function(x){return x.material_code===code;});
  if(!rows.length) return;
  const link=(dataState.accountingCodeLinks||[]).find(function(x){return x.accounting_code===code;});
  const item=link?(dataState.catalogItems||[]).find(function(x){return x.id===link.catalog_item_id;}):null;
  const modal=accountingLinkModal();
  modal.dataset.accountingCode=code;
  modal.querySelector(".accounting-source-code").textContent=code;
  modal.querySelector(".accounting-source-name").textContent=rows[0].name||"—";
  modal.querySelector(".accounting-current-link").textContent=item?(item.mark+" · "+item.name):"Не сопоставлено";
  modal.querySelector(".accounting-link-state").textContent="";
  modal.querySelector(".accounting-link-remove").style.display=link?"":"none";
  const search=modal.querySelector("[data-accounting-candidate-search]");
  search.value="";
  renderAccountingLinkCandidates(modal,code,"");
  modal.classList.add("open");
  setTimeout(function(){search.focus();},0);
}

function renderAccountingLinks() {
  const catalog=new Map((dataState.catalogItems||[]).map(function(x){return [x.id,x];}));
  const relevantCodes=accountingRelevantCodeSet();
  const byCode=new Map();
  (dataState.accountingRows||[]).forEach(function(row){
    const code=String(row.material_code||"").trim();
    if(!code||!relevantCodes.has(code)) return;
    if(!byCode.has(code)) byCode.set(code,[]);
    byCode.get(code).push(row);
  });
  const filter=ui.accountingLinkFilter||"unmatched";
  const rows=Array.from(byCode.entries()).map(function(entry){
    const code=entry[0],sourceRows=entry[1];
    const link=(dataState.accountingCodeLinks||[]).find(function(x){return x.accounting_code===code;});
    const item=link?catalog.get(link.catalog_item_id):null;
    return {code:code,sourceRows:sourceRows,link:link,item:item};
  }).filter(function(x){
    if(filter==="unmatched") return !x.link;
    if(filter==="auto") return !!x.link&&x.link.link_method==="auto";
    if(filter==="manual") return !!x.link&&x.link.link_method==="manual";
    return true;
  }).sort(function(a,b){
    if(!!a.link!==!!b.link) return a.link?1:-1;
    return String(a.code).localeCompare(String(b.code),"ru",{numeric:true});
  });

  let body=rows.map(function(x){
    const name=x.sourceRows[0]&&x.sourceRows[0].name||"";
    const linkLabel=!x.link?"Не сопоставлено":x.link.link_method==="manual"?"Ручная":"Авто";
    const action=!x.link?"сопоставить":"изменить";
    return '<tr class="data-row">'+
      '<td>'+esc(x.code)+'</td>'+
      '<td title="'+esc(name)+'">'+esc(name)+'</td>'+
      '<td>'+esc(x.item&&x.item.mark||"—")+'</td>'+
      '<td>'+esc(x.item&&x.item.name||"Не сопоставлено")+'</td>'+
      '<td title="'+esc(x.link&&x.link.note||"")+'"><span class="accounting-link-kind '+(!x.link?'unmatched':x.link.link_method)+'">'+esc(linkLabel)+'</span><span> · </span><button class="table-text-action" type="button" data-accounting-link-edit="'+esc(x.code)+'">'+action+'</button></td>'+
    '</tr>';
  }).join("");
  if(!body) body=tableMessage(filter==="all"?"Проектных позиций для сопоставления нет. Непроектные материалы бухгалтерии здесь не показываются.":"По выбранному фильтру строк нет.",5);
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table accounting-links-table"><thead><tr><th>Код материала</th><th>Наименование бухгалтерии</th><th>Марка проекта</th><th>Номенклатура проекта</th><th>Связь</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function renderCarryovers() {
  const catalog=new Map(dataState.catalogItems.map(function(x){return [x.id,x];}));
  let body=(dataState.s29Carryovers||[]).slice().sort(function(a,b){return String(a.origin_month).localeCompare(String(b.origin_month));}).map(function(x){
    const item=catalog.get(x.catalog_item_id)||{};const settled=(dataState.s29CarryoverSettlements||[]).filter(function(s){return s.carryover_id===x.id;}).reduce(function(sum,s){return sum+Number(s.settled_m3||0);},0);const rest=Number(x.created_m3||0)-settled;
    const months=(dataState.s29CarryoverSettlements||[]).filter(function(s){return s.carryover_id===x.id;}).map(function(s){return periodLabel(s.settlement_month,false);}).join(", ")||"—";
    return '<tr class="data-row"><td>'+esc(periodLabel(x.origin_month,false))+'</td><td>'+esc(item.mark||"")+'</td><td>'+esc(item.name||"")+'</td><td>'+esc(x.kind==="economy"?"Экономия":"Перерасход")+'</td><td class="num">'+exFmt(x.created_m3)+'</td><td class="num">'+exFmt(settled)+'</td><td>'+esc(months)+'</td><td class="num '+(rest>0?'warning-num':'')+'">'+exFmt(rest)+'</td></tr>';
  }).join("");
  if(!body) body=tableMessage("Накопительная экономия и перерасход пока отсутствуют.",8);
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table"><thead><tr><th>Месяц возникновения</th><th>Марка</th><th>Наименование</th><th>Вид</th><th>Возникло, м³</th><th>Погашено, м³</th><th>Месяц погашения</th><th>Остаток, м³</th></tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

function detectAccountingPeriod(rows,expectedKey,fileName) {
  const avrPeriod=detectWorkbookPeriod(rows,expectedKey);
  if(avrPeriod) return avrPeriod;

  const monthNames={
    "январь":"01","января":"01","февраль":"02","февраля":"02","март":"03","марта":"03",
    "апрель":"04","апреля":"04","май":"05","мая":"05","июнь":"06","июня":"06",
    "июль":"07","июля":"07","август":"08","августа":"08","сентябрь":"09","сентября":"09",
    "октябрь":"10","октября":"10","ноябрь":"11","ноября":"11","декабрь":"12","декабря":"12"
  };
  const found=[];
  function add(year,month,day,score){
    year=Number(year);month=Number(month);day=Number(day||1);
    if(!(year>=2000&&year<=2100&&month>=1&&month<=12&&day>=1&&day<=31)) return;
    const last=new Date(Date.UTC(year,month,0)).getUTCDate();
    if(day>last) return;
    found.push({key:String(year)+"-"+String(month).padStart(2,"0"),score:score+(day===last?5:0)});
  }
  function scan(value,score){
    if(value instanceof Date && !isNaN(value.getTime())){
      add(value.getFullYear(),value.getMonth()+1,value.getDate(),score+6);
    }
    const text=String(value==null?"":value).replace(/\s+/g," ").trim();
    let m;
    const dmy=/(0?[1-9]|[12][0-9]|3[01])[.\/-](0?[1-9]|1[0-2])[.\/-](20[0-9]{2})/g;
    while((m=dmy.exec(text))) add(m[3],m[2],m[1],score+6);
    const ymd=/(20[0-9]{2})[.\/-](0?[1-9]|1[0-2])[.\/-](0?[1-9]|[12][0-9]|3[01])/g;
    while((m=ymd.exec(text))) add(m[1],m[2],m[3],score+6);
    const named=/(январь|января|февраль|февраля|март|марта|апрель|апреля|май|мая|июнь|июня|июль|июля|август|августа|сентябрь|сентября|октябрь|октября|ноябрь|ноября|декабрь|декабря)\s+(20[0-9]{2})/ig;
    while((m=named.exec(text))) add(m[2],monthNames[m[1].toLowerCase()],1,score+3);
  }
  (rows||[]).forEach(function(entry){
    const score=entry.rowNo<=40?4:0;
    (entry.values||[]).forEach(function(v){scan(v,score);});
    (entry.displayValues||[]).forEach(function(v){scan(v,score);});
  });
  scan(fileName||"",2);
  if(!found.length) return "";
  const bestByKey=new Map();
  found.forEach(function(x){if(!bestByKey.has(x.key)||bestByKey.get(x.key)<x.score) bestByKey.set(x.key,x.score);});
  const ranked=Array.from(bestByKey.entries()).sort(function(a,b){return b[1]-a[1]||String(b[0]).localeCompare(String(a[0]));});
  const topScore=ranked[0][1];
  const top=ranked.filter(function(x){return x[1]===topScore;});
  if(top.length===1) return top[0][0];
  if(expectedKey && top.some(function(x){return x[0]===expectedKey;})) return expectedKey;
  return "";
}

function accountingHeaderIndex(values,patterns) {
  return values.findIndex(function(value){const text=importNorm(value);return patterns.some(function(pattern){return pattern.test(text);});});
}

function accountingAutoLinkMap(rows) {
  const sourceByCode=new Map();
  (rows||[]).forEach(function(row){
    const code=String(row.material_code||"").trim();
    const name=String(row.name||"").trim();
    if(!code||!name) return;
    if(!sourceByCode.has(code)) sourceByCode.set(code,new Set());
    sourceByCode.get(code).add(name);
  });

  const context=accountingMatchingCatalogContext();
  const memory=accountingManualNameMemory();
  const result=new Map();

  sourceByCode.forEach(function(namesSet,code){
    const names=Array.from(namesSet);
    const manualId=memory.manualByCode.get(code);
    if(manualId){
      result.set(code,{catalog_item_id:manualId,reason:"Сохранённая ручная связь"});
      return;
    }

    const learnedIds=new Set();
    names.forEach(function(name){
      const learned=memory.learnedByName.get(accountingTokenKey(name,true));
      if(learned) learnedIds.add(learned);
    });
    if(learnedIds.size===1){
      result.set(code,{catalog_item_id:Array.from(learnedIds)[0],reason:"Обучено по ручной связи такого же наименования"});
      return;
    }

    let bestScore=-1;
    let best=[];
    context.catalog.forEach(function(item){
      let bestEvidence=null;
      names.forEach(function(sourceName){
        const evidence=accountingMatchEvidence(sourceName,item,context);
        if(!evidence.autoSafe) return;
        if(!bestEvidence||evidence.score>bestEvidence.score) bestEvidence=evidence;
      });
      if(!bestEvidence) return;
      if(bestEvidence.score>bestScore){
        bestScore=bestEvidence.score;
        best=[{item:item,evidence:bestEvidence}];
      }else if(bestEvidence.score===bestScore){
        best.push({item:item,evidence:bestEvidence});
      }
    });

    if(best.length===1){
      const chosen=best[0];
      const note=chosen.evidence.attention
        ? chosen.evidence.reason+"; "+chosen.evidence.attention
        : chosen.evidence.reason;
      result.set(code,{catalog_item_id:chosen.item.id,reason:note});
    }
  });
  return result;
}

async function autoMatchAccountingLinks() {
  const relevantCodes=accountingRelevantCodeSet();
  const rows=(dataState.accountingRows||[]).filter(function(row){
    return relevantCodes.has(String(row.material_code||"").trim());
  });
  if(!rows.length) return;

  const manualCodes=new Set((dataState.accountingCodeLinks||[])
    .filter(function(x){return x.link_method==="manual";})
    .map(function(x){return String(x.accounting_code||"");}));

  const autoLinks=accountingAutoLinkMap(rows);
  const payload=[];
  autoLinks.forEach(function(match,code){
    if(manualCodes.has(String(code))) return;
    if(!match||!match.catalog_item_id) return;
    payload.push({
      accounting_code:String(code),
      catalog_item_id:match.catalog_item_id,
      note:match.reason||"Автоматическое строгое сопоставление"
    });
  });

  const allCodes=new Set(rows.map(function(x){return String(x.material_code||"").trim();}).filter(Boolean));
  const unresolved=Math.max(0,allCodes.size-manualCodes.size-payload.length);
  const ok=await executionConfirm(
    "Автосопоставление бухгалтерии",
    "Будут пересчитаны только автоматические связи. Ручные связи сохранятся. Найдено "+payload.length+" уверенных автосвязей; без уверенного соответствия: "+unresolved+".",
    "Автосопоставить"
  );
  if(!ok) return;

  const btn=document.querySelector("[data-accounting-link-auto]");
  if(btn) btn.disabled=true;
  try{
    const result=await client.rpc("apply_accounting_auto_links",{
      p_project_id:dataState.project.id,
      p_links:payload
    });
    if(result.error) throw result.error;
    await refreshProjectDataSlices(["accountingCodeLinks"],dataState.project);
    ui.accountingLinkLastAuto={matched:payload.length,unresolved:unresolved,manual:manualCodes.size};
    ui.accountingLinkFilter="unmatched";
    localStorage.setItem("filimonova.accounting.linkFilter","unmatched");
    renderPage("s29",2);
  }catch(err){
    alert("Автосопоставление бухгалтерии не выполнено:\n"+(err&&err.message?err.message:String(err)));
    if(btn) btn.disabled=false;
  }
}

async function parseAccountingWorkbook(file,expectedKey) {
  await ensureXlsxLoaded();
  if(!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:"array",cellDates:true,cellFormula:false});
  const all=[];
  workbook.SheetNames.forEach(function(sheet){
    const rawRows=XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,defval:null,raw:true,blankrows:false});
    const displayRows=XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,defval:null,raw:false,blankrows:false,dateNF:"dd.mm.yyyy"});
    rawRows.forEach(function(values,index){
      all.push({sheet:sheet,rowNo:index+1,values:values,displayValues:displayRows[index]||[]});
    });
  });
  const detected=detectAccountingPeriod(all,expectedKey,file&&file.name||"");
  if(!detected) throw new Error("Не удалось однозначно определить месяц бухгалтерского отчёта по дате отчёта.");
  let headerAt=-1,columns=null,dataAt=-1;
  for(let i=0;i<all.length;i++){
    const cells=all[i].values;
    const name=accountingHeaderIndex(cells,[/наимен/]);
    const code=accountingHeaderIndex(cells,[/код.*материал/,/материал.*код/,/номенклатур.*(?:код|номер)/,/^код$/]);
    if(name>=0&&code>=0){
      let qty=accountingHeaderIndex(cells,[/израсход/,/отпущ/,/списан/,/расход/]);
      let amount=-1;
      let subheader=i;
      if(qty>=0){
        for(let j=i+1;j<Math.min(all.length,i+6);j++){
          if(all[j].sheet!==all[i].sheet) break;
          const q=accountingHeaderIndex(all[j].values,[/^кол.*во$/,/^колич/]);
          if(q>=qty&&q<=qty+2){
            qty=q;
            amount=all[j].values.findIndex(function(value,index){return index>q&&index<=q+2&&/^(сумм|стоим)/.test(importNorm(value));});
            subheader=j;break;
          }
        }
      }else{
        qty=accountingHeaderIndex(cells,[/колич/]);
        amount=accountingHeaderIndex(cells,[/сумм/,/стоим/]);
      }
      if(qty>=0){
        headerAt=i;dataAt=subheader+1;columns={name:name,code:code,qty:qty,account:accountingHeaderIndex(cells,[/счет/,/счёт/]),unit:accountingHeaderIndex(cells,[/ед.*изм/,/^ед$/]),price:accountingHeaderIndex(cells,[/цен/]),amount:amount};break;
      }
    }
  }
  if(headerAt<0) throw new Error("Не найдена таблица с колонками Код материала, Наименование и Количество.");
  const rows=[];
  for(let i=dataAt;i<all.length;i++){
    const entry=all[i];const code=String(entry.values[columns.code]||"").trim();const name=String(entry.values[columns.name]||"").trim();
    const qty=excelNumber(entry.values[columns.qty]);
    if(!code&&!name) continue;
    if(!code||!name||qty==null) continue;
    const numberAt=function(index){return index<0?null:excelNumber(entry.values[index]);};
    rows.push({source_row_no:entry.rowNo,account_code:columns.account>=0?String(entry.values[columns.account]||"").trim():null,material_code:code,name:name,unit:columns.unit>=0?String(entry.values[columns.unit]||"").trim():null,quantity:qty,unit_price:numberAt(columns.price),amount:numberAt(columns.amount),raw_data:{sheet:entry.sheet,row:entry.values}});
  }
  if(!rows.length) throw new Error("После проверки в бухгалтерском отчёте не осталось строк материалов.");
  const autoLinks=accountingAutoLinkMap(rows);
  rows.forEach(function(row){
    const matched=autoLinks.get(String(row.material_code||"").trim())||null;
    row.catalog_item_id=matched&&matched.catalog_item_id||null;
    row.catalog_match_reason=matched&&matched.reason||null;
  });
  return {buffer:buffer,rows:rows,period:detected};
}

async function importAccountingFile(file,period) {
  const button=document.querySelector("[data-accounting-import]");if(button)button.disabled=true;
  try{
    const parsed=await parseAccountingWorkbook(file,period);const hash=await sha256Hex(parsed.buffer);
    const importPeriod=parsed.period||period;
    const result=await client.rpc("apply_accounting_import",{p_project_id:dataState.project.id,p_period_month:periodDate(importPeriod),p_source_name:file.name,p_source_sha256:hash,p_rows:parsed.rows});
    if(result.error) throw result.error;
    ui.s29.period=importPeriod;
    localStorage.setItem("filimonova.s29.period",importPeriod);
    await refreshProjectDataSlices(["accountingRows","accountingCodeLinks","accountingPeriodSources","imports"],dataState.project);renderPage("s29",1);
  }catch(err){alert("Импорт бухгалтерии остановлен:\n"+(err&&err.message?err.message:String(err)));if(button)button.disabled=false;}
}
