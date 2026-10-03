(() => {
  "use strict";

  const MODAL_ID = "materialCardModal";

  function text(el){ return String(el && el.textContent || "").replace(/\s+/g," ").trim(); }

  function findBlock(body,title){
    return Array.from(body.querySelectorAll(":scope > .mv-block, :scope > .mv-grid2 > .mv-block"))
      .find(function(block){
        const head=block.querySelector(":scope > .mv-block-title");
        return head && text(head).indexOf(title)===0;
      }) || null;
  }

  function refineOverview(body){
    const wrap=body.querySelector(":scope > .mv-overview-two");
    if(!wrap) return;

    const blocks=Array.from(wrap.children).filter(function(x){return x.classList.contains("mv-block");});
    const project=blocks.find(function(x){const h=x.querySelector(".mv-block-title");return h&&text(h).indexOf("Проект")===0;});
    const execution=blocks.find(function(x){const h=x.querySelector(".mv-block-title");return h&&text(h).indexOf("Исполнение")===0;});

    if(project && !project.dataset.mcOverviewCompact){
      const metrics=Array.from(project.querySelectorAll(".mv-qty"));
      metrics.forEach(function(metric){
        const label=text(metric.querySelector("b"));
        if(label!=="Всего по проекту" && label!=="Объём 1 шт.") metric.remove();
      });
      project.dataset.mcOverviewCompact="1";
    }

    if(execution && !execution.dataset.mcOverviewCompact){
      Array.from(execution.querySelectorAll(".mv-kpi")).forEach(function(kpi){
        const label=kpi.querySelector(".mv-kpi-label");
        if(!label) return;
        const t=text(label);
        if(t==="Запроцентовано") label.textContent="АВР";
        if(t==="Списано") label.textContent="С-29";
      });
      execution.dataset.mcOverviewCompact="1";
    }

    if(project && execution && wrap.firstElementChild!==project) wrap.insertBefore(project,execution);
    wrap.classList.add("mc-overview-stack");
  }

  function refineEstimateStatus(body){
    const top=body.querySelector(":scope > .mv-grid2.mv-mb");
    if(!top) return;
    const blocks=Array.from(top.children).filter(function(x){return x.classList.contains("mv-block");});
    const estimate=blocks.find(function(x){const h=x.querySelector(".mv-block-title");return h&&text(h).indexOf("Смета")===0;});
    if(!estimate || estimate.dataset.mcEstimateCompact) return;

    const kpis=Array.from(estimate.querySelectorAll(".mv-kpi2 > .mv-kpi"));
    const control=kpis.find(function(kpi){const l=kpi.querySelector(".mv-kpi-label");return l&&text(l)==="Контроль";});
    if(control){
      const value=control.querySelector(".mv-kpi-value");
      const status=text(value)||"";
      const tone=value && value.classList.contains("good") ? "good" : (value && value.classList.contains("warn") ? "warn" : "");
      const head=estimate.querySelector(":scope > .mv-block-title");
      if(head && status){
        const badge=document.createElement("span");
        badge.className="mc-estimate-status "+tone;
        badge.textContent=status;
        head.appendChild(badge);
      }
      control.remove();
    }
    estimate.dataset.mcEstimateCompact="1";
  }

  function makeFloorTable(headers,rows,start,end){
    const table=document.createElement("table");
    table.className="mc-floor-table";
    const thead=document.createElement("thead");
    const hr=document.createElement("tr");
    const h0=document.createElement("th"); h0.textContent="Секция"; hr.appendChild(h0);
    for(let i=start;i<end;i++){
      const th=document.createElement("th"); th.textContent=headers[i+1]||""; hr.appendChild(th);
    }
    thead.appendChild(hr); table.appendChild(thead);
    const tbody=document.createElement("tbody");
    rows.forEach(function(row){
      const tr=document.createElement("tr");
      const r0=document.createElement("th"); r0.textContent=row[0]||""; tr.appendChild(r0);
      for(let i=start;i<end;i++){
        const td=document.createElement("td");
        const value=row[i+1]||"";
        td.textContent=value==="—"||value==="0" ? "" : value;
        if(td.textContent) td.className="val";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function refineFloors(body){
    const grid=body.querySelector(".mv-floor-grid");
    if(!grid || grid.dataset.mcFloorDone) return;
    const children=Array.from(grid.children);
    const firstRowHead=children.findIndex(function(x){return x.classList.contains("rowhead");});
    if(firstRowHead<4) return;
    const colCount=firstRowHead;
    if(children.length<colCount*3) return;

    const headers=children.slice(0,colCount).map(text);
    const row1=children.slice(colCount,colCount*2).map(text);
    const row2=children.slice(colCount*2,colCount*3).map(text);
    const floorCount=Math.max(0,headers.length-2);
    if(!floorCount) return;

    const split=Math.ceil(floorCount/2);
    const shell=document.createElement("div");
    shell.className="mc-floor-split";
    shell.appendChild(makeFloorTable(headers,[row1,row2],0,split));
    shell.appendChild(makeFloorTable(headers,[row1,row2],split,floorCount));

    const totals=document.createElement("div");
    totals.className="mc-floor-totals";
    const total1=row1[colCount-1]||"";
    const total2=row2[colCount-1]||"";
    totals.innerHTML='<span>Секция 1 <b>'+total1+'</b></span><span>Секция 2 <b>'+total2+'</b></span>';
    shell.appendChild(totals);

    grid.replaceWith(shell);
  }

  function compactTable(block,title,keep,labels,className){
    if(!block) return;
    const table=block.querySelector("table");
    if(!table || table.dataset.mcCompact) return;
    const rows=Array.from(table.rows);
    rows.forEach(function(row,rowIndex){
      const cells=Array.from(row.cells);
      if(cells.length===1 && Number(cells[0].colSpan||1)>1){
        cells[0].colSpan=keep.length;
        return;
      }
      for(let i=cells.length-1;i>=0;i--){
        if(keep.indexOf(i)===-1) cells[i].remove();
      }
      if(rowIndex===0){
        Array.from(row.cells).forEach(function(cell,i){if(labels[i]!=null) cell.textContent=labels[i];});
      }
    });
    table.dataset.mcCompact="1";
    table.classList.add("mc-compact-table",className);
    Array.from(table.rows).forEach(function(row){
      const cells=Array.from(row.cells);
      if(cells[3]) cells[3].classList.add("mc-wrap-name");
    });
  }

  function refineTables(body){
    const blocks=Array.from(body.querySelectorAll(":scope > .mv-block"));
    const estimateBlock=blocks.find(function(x){const h=x.querySelector(":scope > .mv-block-title");return h&&text(h).indexOf("Связанные строки смет")===0;});
    const worksBlock=blocks.find(function(x){const h=x.querySelector(":scope > .mv-block-title");return h&&text(h).indexOf("Связанные работы")===0;});

    compactTable(estimateBlock,"Связанные строки смет",[0,1,2,3,5,8],["№ см.","Поз.","Обоснование","Наименование","Кол-во","Стоимость"],"mc-estimate-table");
    compactTable(worksBlock,"Связанные работы",[0,1,2,3,7],["№ см.","Поз.","Обозначение","Наименование","На 1 панель"],"mc-work-table");
  }

  function propMap(box){
    const out=new Map();
    Array.from(box.querySelectorAll(".mv-prop")).forEach(function(p){
      const b=p.querySelector("b"),s=p.querySelector("span");
      if(b) out.set(text(b),s?text(s):"");
    });
    return out;
  }

  function refinePositionData(body){
    const grid=body.querySelector(":scope > .mv-source-grid");
    if(!grid || grid.dataset.mcPositionDone) return;
    const boxes=Array.from(grid.querySelectorAll(":scope > .mv-source-box"));
    if(boxes.length<2) return;
    const source=propMap(boxes[0]),project=propMap(boxes[1]);
    const estimateTable=body.querySelector(".mc-estimate-table tbody tr");
    const cells=estimateTable?Array.from(estimateTable.cells):[];
    const estimateNo=cells[0]?text(cells[0]):(source.get("Источник")||"");
    const position=cells[1]?text(cells[1]):"";
    const sourceBasis=source.get("Исходное обоснование")||"";
    const designation=project.get("Обозначение")||"";
    const sourceName=source.get("Исходное наименование")||"";
    const projectName=project.get("Наименование")||"";

    const box=document.createElement("div");
    box.className="mv-source-box mc-position-data";
    box.innerHTML='<div class="mv-source-head">Данные позиции</div><div class="mv-props">'+
      '<div class="mv-prop"><b>Смета</b><span>'+estimateNo+'</span></div>'+
      '<div class="mv-prop"><b>Поз. см.</b><span>'+position+'</span></div>'+
      '<div class="mv-prop"><b>Обоснование</b><span>'+sourceBasis+'</span></div>'+
      '<div class="mv-prop mc-prop-wide"><b>Обозначение</b><span>'+designation+'</span></div>'+
      ((sourceName&&projectName&&sourceName!==projectName)?'<div class="mv-prop mc-prop-wide"><b>Наименование по смете</b><span>'+sourceName+'</span></div>':'')+
      '</div>';
    grid.innerHTML="";
    grid.appendChild(box);
    grid.dataset.mcPositionDone="1";
  }

  function refineProjectEstimate(body){
    refineEstimateStatus(body);
    refineFloors(body);
    refineTables(body);
    refinePositionData(body);
  }

  function refine(){
    const modal=document.getElementById(MODAL_ID);
    if(!modal || !modal.classList.contains("open")) return;
    const body=modal.querySelector(".material-body");
    const active=modal.querySelector(".material-tabs button.active");
    if(!body || !active) return;
    const tab=active.dataset.mtab||"";
    if(tab==="overview") refineOverview(body);
    if(tab==="projectEstimate") refineProjectEstimate(body);
  }

  let queued=false;
  function queueRefine(){
    if(queued) return;
    queued=true;
    requestAnimationFrame(function(){ queued=false; refine(); });
  }

  const observer=new MutationObserver(queueRefine);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
  document.addEventListener("click",function(e){
    if(e.target && e.target.closest && e.target.closest("#materialCardModal .material-tabs button")) setTimeout(queueRefine,0);
  },true);
  queueRefine();
})();
