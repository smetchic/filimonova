// One drag rule for all application windows.
// Individual dialogs may still define their own content behavior; their header
// always acts as the move handle unless the pointer is on an interactive control.
document.addEventListener("mousedown",function(e){
  if(e.button!==0 || !e.target || !e.target.closest) return;
  const handle=e.target.closest(".spec-import-head,.gpr-modal-head,.material-card-head");
  if(!handle || e.target.closest("button,input,select,textarea,a,label")) return;
  const card=handle.closest(".spec-import-modal,.recon-edit-modal,.supplier-check-modal,.gpr-modal,.material-card");
  if(!card) return;
  e.preventDefault();
  e.stopPropagation();
  const rect=card.getBoundingClientRect();
  const dx=e.clientX-rect.left,dy=e.clientY-rect.top;
  card.style.position="fixed";
  card.style.left=rect.left+"px";
  card.style.top=rect.top+"px";
  card.style.right="auto";
  card.style.bottom="auto";
  card.style.margin="0";
  card.style.transform="none";
  card.classList.add("dialog-dragging");
  function move(ev){
    const minVisible=Math.min(160,Math.max(70,card.offsetWidth*0.2));
    const left=Math.max(-card.offsetWidth+minVisible,Math.min(window.innerWidth-minVisible,ev.clientX-dx));
    const top=Math.max(0,Math.min(window.innerHeight-44,ev.clientY-dy));
    card.style.left=Math.round(left)+"px";
    card.style.top=Math.round(top)+"px";
  }
  function up(){
    card.classList.remove("dialog-dragging");
    if(card.classList.contains("material-card")){
      try{
        const r=card.getBoundingClientRect();
        localStorage.setItem("filimonova.materialCard.position",JSON.stringify({left:Math.round(r.left),top:Math.round(r.top)}));
      }catch(_){}
    }
    document.removeEventListener("mousemove",move,true);
    document.removeEventListener("mouseup",up,true);
  }
  document.addEventListener("mousemove",move,true);
  document.addEventListener("mouseup",up,true);
},true);

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
  // Column sorting is intentionally disabled.
  // Engineering tables preserve source / estimate / specification order.
  return null;
}

function clearColumnFilter(field) {
  const key=currentViewKey();
  if(!ui.columnFilters || !ui.columnFilters[key]) return;
  const next=Object.assign({},ui.columnFilters[key]);
  delete next[field];
  if(Object.keys(next).length) ui.columnFilters[key]=next;
  else delete ui.columnFilters[key];
}

function clearColumnSort() {
  const key=currentViewKey();
  if(ui.columnSort && Object.prototype.hasOwnProperty.call(ui.columnSort,key)){
    const next=Object.assign({},ui.columnSort);
    delete next[key];
    ui.columnSort=next;
  }
}

function columnFilterPass(field,value) {
  const set = filterBucket()[field];
  if (!set) return true;
  if (!set.size) return false;
  return set.has(String(value == null ? "" : value));
}

function rowPassesColumnFilters(values) {
  const filters = filterBucket();
  return Object.keys(filters).every(function(field) {
    const set = filters[field];
    if (!set) return true;
    if (!set.size) return false;
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
  const raw=value == null ? "" : String(value);
  const title=(field==="name" || field==="basis") && raw ? ' title="' + esc(raw) + '"' : "";
  return '<td class="' + esc(extraClass || "") + '" data-filter-field="' + esc(field) + '" data-filter-value="' + esc(raw) + '"' + title + '>' + content + '</td>';
}

// Long estimate names stay compact by default. Double-clicking the name cell
// expands only that cell and does not trigger the material-card row action.
document.addEventListener("dblclick",function(e){
  const cell=e.target && e.target.closest ? e.target.closest('td[data-filter-field="name"]') : null;
  if(!cell || !cell.closest(".est-table,.ks-table")) return;
  e.preventDefault();
  e.stopPropagation();
  cell.classList.toggle("cell-text-expanded");
},true);

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
  const viewKey=currentViewKey();
  const pop = ensureFilterPopup();
  let values;
  if(ui.page==="spec" && (field==="mark" || field==="name")){
    const tab=ui.tabs.spec||0;
    const base=tab===0
      ? specJoinedRows().filter(passesSpecFilters).filter(rowMatchesSpecSearch)
      : buildWorkingSummaryRows();
    values=Array.from(new Set(base.map(function(r){return String(r[field]==null?"":r[field]);})));
  }else{
    const cells = Array.from(document.querySelectorAll('#workArea [data-filter-field="' + CSS.escape(field) + '"]'));
    values = Array.from(new Set(cells.map(function(c){ return c.dataset.filterValue || ""; })));
  }
  values.sort(function(a,b){ return a.localeCompare(b,"ru",{numeric:true,sensitivity:"base"}); });
  const viewFilters=(ui.columnFilters&&ui.columnFilters[viewKey])||{};
  const existing = viewFilters[field];
  let chosen = new Set(existing ? Array.from(existing) : values);

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
    '<div class="filter-title">Фильтр текущей колонки</div>' +
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
  pop.querySelector("[data-filter-cancel]").onclick=function(){pop.classList.remove("open");};
  pop.querySelector(".filter-clear").onclick=function(){
    chosen=new Set(values);
    search.value="";
    list.innerHTML=valueRows("");
    bindValues();
  };
  pop.querySelector("[data-filter-ok]").onclick=function(){
    // If a search is entered, the visible checked search results become the
    // filter. Previously hidden values stayed selected in the background,
    // so the filter icon became active while almost all rows remained visible.
    if(search.value.trim()){
      chosen=new Set(Array.from(list.querySelectorAll("[data-filter-value-choice]:checked"))
        .map(function(x){return x.dataset.filterValueChoice;}));
    }
    const allValues = values;
    if (!search.value.trim() && chosen.size === allValues.length && allValues.every(function(v){return chosen.has(v);})) {
      if(ui.columnFilters&&ui.columnFilters[viewKey]){
        const next=Object.assign({},ui.columnFilters[viewKey]);
        delete next[field];
        if(Object.keys(next).length) ui.columnFilters[viewKey]=next;
        else delete ui.columnFilters[viewKey];
      }
    } else {
      if(!ui.columnFilters) ui.columnFilters={};
      if(!ui.columnFilters[viewKey]) ui.columnFilters[viewKey]={};
      ui.columnFilters[viewKey][field]=new Set(Array.from(chosen));
    }
    if(ui.page==="spec"){
      ui.collapseLeaves=false;
      ui.collapsed.clear();
    }
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

function measureEngineeringText(text,extra) {
  const canvas=intrinsicColumnWidth.canvas||(intrinsicColumnWidth.canvas=document.createElement("canvas"));
  const ctx=canvas.getContext("2d");
  ctx.font='12px "Segoe UI Variable","Segoe UI",Arial,sans-serif';
  return Math.ceil(ctx.measureText(String(text==null?"":text)).width)+18+Number(extra||0);
}

function valueSamplesIntrinsicWidth(samples,minWidth) {
  let max=0;
  (samples||[]).forEach(function(value){
    const text=String(value==null?"":value).trim();
    if(!text) return;
    max=Math.max(max,measureEngineeringText(text));
  });
  return Math.max(Number(minWidth||0),max);
}

function ksIntrinsicColumnWidth(table,index) {
  if(!table.classList.contains("ks-table")) return null;
  const samples=(ui.ks6WidthSamples&&ui.ks6WidthSamples[index])||[];
  return valueSamplesIntrinsicWidth(samples,tableColumnMinimum(table,index));
}

function avrIntrinsicColumnWidth(table,index) {
  if(!table.classList.contains("avr-table")) return null;
  const samples=(ui.avrWidthSamples&&ui.avrWidthSamples[index])||[];
  return valueSamplesIntrinsicWidth(samples,tableColumnMinimum(table,index));
}

function estimateIntrinsicColumnWidth(table,index) {
  if(!table.classList.contains("est-table")) return null;
  const rows=(dataState.estimateRows||[]).filter(function(r){return !r.archived_at;});
  if(index===0){
    return Math.max(measureEngineeringText("Тип"),measureEngineeringText("М"),measureEngineeringText("Р"));
  }
  if(index===1){
    let max=0;
    rows.forEach(function(r){max=Math.max(max,measureEngineeringText(r.position||""));});
    if(table.classList.contains("gpr-table")) max+=28;
    return max;
  }
  if(index===2){
    let max=0;
    rows.forEach(function(r){max=Math.max(max,measureEngineeringText(estimateDisplayBasis(r)||""));});
    return max;
  }
  if(index===3){
    // Work names never participate in the material-name column width.
    let max=0;
    rows.filter(function(r){return r.row_type==="material";}).forEach(function(r){
      max=Math.max(max,measureEngineeringText(estimateDisplayName(r)||""));
    });
    return max;
  }
  if(index===4){
    // Units of work rows and the two-line header do not affect the width.
    let max=0;
    rows.filter(function(r){return r.row_type==="material";}).forEach(function(r){
      max=Math.max(max,measureEngineeringText(r.unit||""));
    });
    return max;
  }
  return null;
}

function intrinsicColumnWidth(table,index) {
  if (table.classList.contains("working-summary")) {
    // Columns: №, mark, name, total, then quantity/volume per section, then each level per section.
    const sections=buildingSections();
    const floorStart=4+sections.length*2;
    if (index === 3) return 58;
    if (index >= 4 && index < floorStart) return (index-4)%2===0 ? 58 : 64;
    // Floor subcolumns contain only quantities. Keep them compact and stable:
    // size from the complete project dataset, not from the currently visible grouping.
    if (index >= floorStart) {
      const levels=levelCodes();
      const floorEnd=floorStart+levels.length*sections.length;
      if(index < floorEnd){
        const rel=index-floorStart, section=sections[rel%sections.length];
        const code=levels[Math.floor(rel/sections.length)];
        let maxText="0";
        buildWorkingSummaryRows().forEach(function(r){
          const v=Number((r.byLevel[section]&&r.byLevel[section].get(code))||0);
          const txt=fmt0(v);
          if(txt.length>maxText.length) maxText=txt;
        });
        const canvas=intrinsicColumnWidth.canvas||(intrinsicColumnWidth.canvas=document.createElement("canvas"));
        const ctx=canvas.getContext("2d");
        ctx.font="12px Segoe UI";
        return Math.max(28,Math.ceil(ctx.measureText(maxText).width)+12);
      }
      return 42;
    }
  }
  const ksWidth=ksIntrinsicColumnWidth(table,index);
  if(ksWidth!=null) return ksWidth;
  const avrWidth=avrIntrinsicColumnWidth(table,index);
  if(avrWidth!=null) return avrWidth;
  const estimateWidth=estimateIntrinsicColumnWidth(table,index);
  if(estimateWidth!=null) return estimateWidth;
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
    const txt=(cell.textContent||"").trim();
    const canvas=intrinsicColumnWidth.canvas||(intrinsicColumnWidth.canvas=document.createElement("canvas"));
    const ctx=canvas.getContext("2d");
    ctx.font=canvasFontOf(cell);
    let w=Math.ceil(ctx.measureText(txt).width)+18;
    if(cell.querySelector(".column-filter-trigger")) w+=28;
    max=Math.max(max,w);
  });
  if(index===0) max=Math.max(40,Math.min(max,68));
  // Estimate names must never make the whole grid excessively wide.
  // Full text remains available through the cell title tooltip.
  if((table.classList.contains("est-table") || table.classList.contains("ks-table")) && index===3) {
    return Math.max(220,Math.min(max,480));
  }
  if((table.classList.contains("est-table") || table.classList.contains("ks-table")) && index===2) {
    return Math.max(120,Math.min(max,280));
  }
  return Math.max(28,Math.min(max,340));
}

// Chromium leaves the computed `font` shorthand empty, and an empty canvas font silently
// falls back to 10px, so build it from the longhands.
function canvasFontOf(cell) {
  const cs=getComputedStyle(cell);
  return [cs.fontStyle,cs.fontWeight,cs.fontSize,cs.fontFamily].join(" ");
}

const NUMERIC_CELL_TEXT=/^[\d\s.,:\-−+%]+$/;

// The narrowest width each column needs so that numbers, dates, codes and whole header words
// are never cut. Saved and dragged widths may not go below it. A header spanning several
// columns (for example "Смонтировано" over шт./м³) yields a need for their sum in `spans`. Text is measured in a
// real span because table digits use tabular-nums, which canvas measurement ignores.
function columnContentMinimums(table,count) {
  const mins=new Array(count).fill(0);
  const spans=new Map();
  const styles=new Map();
  // Per column and cell style, keep only the longest strings: they are the widest.
  const candidates=new Map();
  function styleKey(cell) {
    const key=cell.tagName+"|"+cell.className+"|"+(cell.parentElement?cell.parentElement.className:"");
    if(!styles.has(key)) styles.set(key,cell);
    return key;
  }
  function add(index,span,text,cell,extra) {
    if(index+span>count || !text) return;
    const key=styleKey(cell);
    const ck=index+"/"+span+"|"+key+"|"+extra;
    let c=candidates.get(ck);
    if(!c){c={index:index,span:span,key:key,extra:extra,len:0,texts:new Set()};candidates.set(ck,c);}
    if(text.length>c.len){c.len=text.length;c.texts=new Set([text]);}
    else if(text.length===c.len) c.texts.add(text);
  }
  // A status badge inside a cell adds its own padding and border to the text width.
  const badgeCache=new Map();
  function badgeExtra(cell) {
    const badge=cell.children.length===1?cell.firstElementChild:null;
    if(!badge || badge.textContent.trim()!==cell.textContent.trim()) return 0;
    if(!badgeCache.has(badge.className)){
      const cs=getComputedStyle(badge);
      badgeCache.set(badge.className,Math.ceil((parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0)+(parseFloat(cs.borderLeftWidth)||0)+(parseFloat(cs.borderRightWidth)||0)+(parseFloat(cs.marginLeft)||0)+(parseFloat(cs.marginRight)||0)));
    }
    return badgeCache.get(badge.className);
  }
  if(table.tHead) Array.from(table.tHead.rows).forEach(function(row){
    Array.from(row.cells).forEach(function(th){
      const span=Number(th.dataset.logicalSpan||th.colSpan||1);
      const label=th.querySelector(".header-label");
      ((label||th).textContent||"").trim().split(/\s+/).forEach(function(word){
        add(Number(th.dataset.logicalStart),span,word,th,th.querySelector(".column-filter-trigger")?26:0);
      });
    });
  });
  Array.from(table.tBodies).forEach(function(body){
    Array.from(body.rows).forEach(function(row){
      let c=0;
      Array.from(row.cells).forEach(function(cell){
        const span=cell.colSpan||1;
        if(span===1){
          const text=(cell.textContent||"").trim();
          // Numbers, dates, short marks, status labels and single-token codes (ГЭСН…, ТТН-…)
          // stay whole; long names may be cut.
          if(text && (cell.classList.contains("num") || NUMERIC_CELL_TEXT.test(text) || text.length<=16 || (text.length<=32 && !/\s/.test(text)))) add(c,1,text,cell,badgeExtra(cell));
        }
        c+=span;
      });
    });
  });
  if(!candidates.size) return {mins:mins,spans:[]};
  const probe=document.createElement("span");
  probe.style.cssText="position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap";
  document.body.appendChild(probe);
  const fontProps=["fontStyle","fontWeight","fontSize","fontFamily","fontVariantNumeric","letterSpacing"];
  candidates.forEach(function(c){
    const cs=getComputedStyle(styles.get(c.key));
    fontProps.forEach(function(prop){probe.style[prop]=cs[prop];});
    const pad=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0)+(parseFloat(cs.borderLeftWidth)||0)+(parseFloat(cs.borderRightWidth)||0)+2;
    c.texts.forEach(function(text){
      probe.textContent=text;
      const need=Math.ceil(probe.getBoundingClientRect().width+pad+c.extra);
      if(c.span===1) mins[c.index]=Math.max(mins[c.index],need);
      else {
        const sk=c.index+"/"+c.span;
        const prev=spans.get(sk);
        if(!prev || prev.need<need) spans.set(sk,{start:c.index,span:c.span,need:need});
      }
    });
  });
  probe.remove();
  return {mins:mins,spans:Array.from(spans.values())};
}

function tableWidthStorageKey(table) {
  const tableKey=table.dataset.tableKey||table.className.replace(/\s+/g,".");
  // Modal grids must keep their widths regardless of which page/tab opened them.
  const scope=table.closest("#workArea")?currentViewKey():"modal";
  return "filimonova.tablewidths."+scope+"."+tableKey;
}

function saveTableWidths(table,widths) {
  localStorage.setItem(tableWidthStorageKey(table),JSON.stringify(widths));
}

function loadTableWidths(table) {
  try{return JSON.parse(localStorage.getItem(tableWidthStorageKey(table))||"null");}catch(_){return null;}
}

function updateStickyHeaderOffsets(table) {
  if (!table || !table.tHead) return;
  let top = 0;
  Array.from(table.tHead.rows).forEach(function(row) {
    Array.from(row.cells).forEach(function(cell) {
      cell.style.top = Math.round(top) + "px";
    });
    const h = row.getBoundingClientRect().height;
    if (Number.isFinite(h) && h > 0) top += h;
  });
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

function tableColumnMinimum(table,index) {
  // Estimate-derived grids use content, not header text, as the sizing source.
  if(table.classList.contains("ks-table")) {
    if(index===0) return 42;  // Р/М: как в смете, с запасом под маркер без ellipsis
    if(index===1) return 48;  // Поз. см.
    if(index===2) return 96;  // Обоснование
    if(index===3) return 140; // Наименование
    if(index===4) return 56;  // Ед. изм.
    if(index===5) return 48;  // По смете
    if(index===6) return 48;  // Запроцентовано
    if(index===7) return 48;  // Остаток
    return 42;                // месяцы
  }
  if(table.classList.contains("avr-table")) {
    if(index===0) return 42;
    if(index===1) return 48;
    if(index===2) return 96;
    if(index===3) return 72;
    if(index===4) return 140;
    if(index===5) return 56;
    return 64;
  }
  if(table.classList.contains("est-table")) {
    if(index===0) return 32;   // type: actual width is content-driven and locked
    if(index===1) return 48;   // estimate position: content-driven and locked
    if(index===2) return 96;   // basis
    if(index===3) return 140;  // material name
    if(index===4) return 56;   // material unit
    return 82;
  }
  return 28;
}

function forceLogicalColumnWidth(table,index,width) {
  // Width ownership belongs exclusively to the generated COLGROUP.
  // Never force widths on TH/TD: doing so conflicts with rowspan/colspan headers
  // and breaks the scroll geometry of multi-level engineering tables.
  return;
}

function lockTableToColumnSum(table,widths) {
  if(!table) return;
  const total=Math.max(1,widths.reduce(function(sum,w){return sum+(Number(w)||0);},0));
  // COLGROUP + this exact pixel width are the single source of truth.
  // Use !important because legacy .est-table{width:max-content!important}
  // previously overrode the runtime width and let long work text expand columns.
  table.style.setProperty("width",total+"px","important");
  table.style.setProperty("min-width",total+"px","important");
  table.style.setProperty("max-width","none","important");
}

function tableColumnLocked(table,index) {
  return (table.classList.contains("est-table") || table.classList.contains("ks-table") || table.classList.contains("avr-table")) && (index===0 || index===1);
}

function tableColumnResizeMinimum(table,index) {
  return Math.max(tableColumnTypeMinimum(table,index),(table._contentMins&&table._contentMins[index])||0);
}

function tableColumnTypeMinimum(table,index) {
  if(table.classList.contains("ks-table") && index>=2 && index<=4) {
    return Math.max(tableColumnMinimum(table,index),intrinsicColumnWidth(table,index));
  }
  if(table.classList.contains("avr-table") && index>=2 && index<=5) {
    return Math.max(tableColumnMinimum(table,index),intrinsicColumnWidth(table,index));
  }
  if(table.classList.contains("est-table") && index>=2 && index<=4) {
    return Math.max(tableColumnMinimum(table,index),intrinsicColumnWidth(table,index));
  }
  return tableColumnMinimum(table,index);
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
    widths=Array.from({length:count},function(_,i){
      return Math.max(tableColumnMinimum(table,i),intrinsicColumnWidth(table,i));
    });
    saveTableWidths(table,widths);
  } else {
    // Saved widths are the user's choice. Never expand them because cell text is long.
    widths=widths.map(function(w,i){
      const n=Number(w);
      const min=tableColumnResizeMinimum(table,i);
      if(tableColumnLocked(table,i)) return Math.max(min,intrinsicColumnWidth(table,i));
      return Number.isFinite(n) && n>=min ? n : min;
    });
  }
  const content=columnContentMinimums(table,count);
  content.spans.forEach(function(s){
    let sum=0;
    for(let i=s.start;i<s.start+s.span;i++) sum+=Math.max(widths[i],content.mins[i]);
    if(sum<s.need) content.mins[s.start+s.span-1]=Math.max(content.mins[s.start+s.span-1],widths[s.start+s.span-1]+s.need-sum);
  });
  table._contentMins=content.mins;
  widths=widths.map(function(w,i){return Math.max(w,content.mins[i]||0);});
  if(table.classList.contains("est-table")) {
    const policyKey="filimonova.tablewidths."+currentViewKey()+"."+(table.dataset.tableKey||table.className.replace(/\s+/g,"."))+".identity-policy";
    if(localStorage.getItem(policyKey)!=="3") {
      [1,2,3,4].forEach(function(i){if(i<count) widths[i]=Math.max(tableColumnMinimum(table,i),intrinsicColumnWidth(table,i));});
      localStorage.setItem(policyKey,"3");
      saveTableWidths(table,widths);
    }
  }
  Array.from(cg.children).forEach(function(col,i){
    col.style.width=widths[i]+"px";
    col.style.minWidth=widths[i]+"px";
    col.style.maxWidth=widths[i]+"px";
  });
  widths.forEach(function(w,i){forceLogicalColumnWidth(table,i,w);});
  lockTableToColumnSum(table,widths);
  updateStickyOffsets(table,widths);
  updateStickyHeaderOffsets(table);

  table.querySelectorAll("thead th").forEach(function(th){
    if(Number(th.dataset.logicalSpan||th.colSpan||1)!==1) return;
    if(th.querySelector(".resize-handle")) return;
    const index=Number(th.dataset.logicalStart);
    if(tableColumnLocked(table,index)) return;
    const h=document.createElement("span");h.className="resize-handle";th.appendChild(h);
    h.addEventListener("mousedown",function(e){
      e.preventDefault();e.stopPropagation();
      const startX=e.clientX,start=widths[index];
      function move(ev){
        widths[index]=Math.max(tableColumnResizeMinimum(table,index),Math.min(720,start+ev.clientX-startX));
        cg.children[index].style.width=widths[index]+"px";
        cg.children[index].style.minWidth=widths[index]+"px";
        cg.children[index].style.maxWidth=widths[index]+"px";
        forceLogicalColumnWidth(table,index,widths[index]);
        lockTableToColumnSum(table,widths);
        updateStickyOffsets(table,widths);
        updateStickyHeaderOffsets(table);
      }
      function up(){document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);saveTableWidths(table,widths);}
      document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
    });
    h.addEventListener("dblclick",function(e){
      e.preventDefault();e.stopPropagation();
      widths[index]=Math.max(tableColumnResizeMinimum(table,index),intrinsicColumnWidth(table,index));
      cg.children[index].style.width=widths[index]+"px";
      cg.children[index].style.minWidth=widths[index]+"px";
      cg.children[index].style.maxWidth=widths[index]+"px";
      forceLogicalColumnWidth(table,index,widths[index]);
      lockTableToColumnSum(table,widths);
      updateStickyOffsets(table,widths);
      updateStickyHeaderOffsets(table);
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
    row.ondblclick=function(e){e.preventDefault();openMaterialCard(row.dataset.materialId||"",row.dataset.materialMark||"",row.dataset.materialName||"");};
  });
}
