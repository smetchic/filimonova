function renderSpecProject() {
  const levels = levelCodes().concat(["Всего"]);
  let rows = specJoinedRows().filter(passesSpecFilters).filter(rowMatchesSpecSearch)
    .filter(function(r){return rowPassesColumnFilters({mark:r.mark,name:r.name});});
  rows = sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
  rows.sort(function(a,b){
    const s=sortBucket();
    if(s && (s.field==="mark" || s.field==="name")) return 0;
    return a.position_no - b.position_no;
  });

  let body = "";
  ui.currentGroupKeys = [];
  if (!rows.length) {
    body = tableMessage("Нет строк по текущему фильтру.",3+levels.length);
  } else {
    const rootKey = "spec-project:root";
    body += specGroupRow("Всего по дому",rows,rootKey,0,levels);
    if (!ui.collapsed.has(rootKey)) {
      ["Секция 1","Секция 2"].forEach(function(bs) {
        const bsRows = rows.filter(function(r){ return r.section.building_section === bs; });
        if (!bsRows.length) return;
        const bsKey = "spec-project:bs:"+bs;
        body += specGroupRow(bs,bsRows,bsKey,1,levels);
        if (ui.collapsed.has(bsKey)) return;
        ["Цоколь","Выше 0.000"].forEach(function(zone) {
          const zRows = bsRows.filter(function(r){ return r.section.zone === zone; });
          if (!zRows.length) return;
          const zKey = "spec-project:zone:"+bs+":"+zone;
          body += specGroupRow(zone,zRows,zKey,2,levels);
          if (ui.collapsed.has(zKey)) return;
          const sectionNames = Array.from(new Set(zRows.map(function(r){ return r.section.name; })));
          sectionNames.forEach(function(sectionName) {
            const sRows = zRows.filter(function(r){ return r.section.name === sectionName; });
            const sKey = "spec-project:section:"+bs+":"+zone+":"+sectionName;
            body += specGroupRow(sectionName,sRows,sKey,3,levels);
            if (ui.collapsed.has(sKey) || ui.collapseLeaves) return;
            sRows.forEach(function(r) {
              body += '<tr class="data-row" data-row-id="' + esc(r.id) + '" data-material-id="' + esc(r.catalog_item_id||"") + '">';
              body += '<td class="sticky-1 center">' + esc(r.position_no) + '</td>';
              body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
              body += filterCell("name",r.name,esc(r.name),"sticky-3");
              levels.forEach(function(code) {
                const value = code === "Всего" ? r.total : qtyAt(r,code);
                body += '<td class="level-col num">' + fmt0(value) + '</td>';
              });
              body += '</tr>';
            });
          });
        });
      });
      const stairRows = rows.filter(function(r){return r.section.is_stairs;});
      if(stairRows.length){
        const stairKey="spec-project:stairs";
        body += specGroupRow("Элементы лестниц",stairRows,stairKey,1,levels);
        if(!ui.collapsed.has(stairKey) && !ui.collapseLeaves){
          stairRows.forEach(function(r){
            body += '<tr class="data-row" data-row-id="' + esc(r.id) + '" data-material-id="' + esc(r.catalog_item_id||"") + '">';
            body += '<td class="sticky-1 center">' + esc(r.position_no) + '</td>';
            body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
            body += filterCell("name",r.name,esc(r.name),"sticky-3");
            levels.forEach(function(code){
              const value = code === "Всего" ? r.total : qtyAt(r,code);
              body += '<td class="level-col num">' + fmt0(value) + '</td>';
            });
            body += '</tr>';
          });
        }
      }
    }
  }

  const head = '<thead><tr>' +
    '<th class="sticky-1">№</th>' +
    '<th class="sticky-2 filterable-head">' + filterHeader("Марка","mark") + '</th>' +
    '<th class="sticky-3 filterable-head">' + filterHeader("Наименование","name") + '</th>' +
    levels.map(function(x){ return '<th class="level-col">' + esc(x === "Всего" ? "Всего" : levelLabel(x)) + '</th>'; }).join("") +
    '</tr></thead>';

  $("workArea").className = "work-area table-work spec-work";
  $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table" data-table-key="spec-project">' + head + '<tbody>' + body + '</tbody></table></div></div>';
}

function buildWorkingSummaryRows() {
  const rows = specJoinedRows().filter(passesSpecFilters).filter(rowMatchesSpecSearch);
  const levels = levelCodes();
  const grouped = new Map();

  rows.forEach(function(r) {
    const key = [r.section.zone,r.section.name,r.catalog_item_id || (r.mark+"|"+r.name)].join("||");
    if (!grouped.has(key)) {
      grouped.set(key,{
        key:key,
        zone:r.section.zone,
        sectionName:r.section.name,
        mark:r.mark,
        name:r.name,
        catalogItemId:r.catalog_item_id || "",
        volumePerPiece:r.volumePerPiece,
        bySection:{"Секция 1":0,"Секция 2":0},
        byLevel:{"Секция 1":new Map(),"Секция 2":new Map()}
      });
    }
    const g = grouped.get(key);
    if (r.section.is_stairs) {
      // Stairs are a house-wide block. Never invent a 50/50 S1/S2 allocation.
      g.houseOnly=true;
      g.houseTotal=Number(g.houseTotal||0)+Number(r.total||0);
      if(!g.houseByLevel) g.houseByLevel=new Map();
      levels.forEach(function(code) {
        const v=Number(qtyAt(r,code)||0);
        if (v) g.houseByLevel.set(code,Number(g.houseByLevel.get(code)||0)+v);
      });
    } else {
      const bs = r.section.building_section;
      if (!g.bySection[bs]) g.bySection[bs] = 0;
      g.bySection[bs] += r.total;
      if (!g.byLevel[bs]) g.byLevel[bs] = new Map();
      levels.forEach(function(code) {
        const v = qtyAt(r,code);
        if (v) g.byLevel[bs].set(code,Number(g.byLevel[bs].get(code) || 0)+v);
      });
    }
  });

  // Map preserves first appearance in the source specification.
  // This is the canonical unsorted order of the Working Summary.
  return Array.from(grouped.values());
}

function summaryVector(rows, levels) {
  const out = [];
  let s1 = 0, s2 = 0, v1 = 0, v2 = 0;
  rows.forEach(function(r) {
    const a = Number(r.bySection["Секция 1"] || 0);
    const b = Number(r.bySection["Секция 2"] || 0);
    s1 += a; s2 += b;
    v1 += a * Number(r.volumePerPiece || 0);
    v2 += b * Number(r.volumePerPiece || 0);
  });
  out.push(s1+s2,s1,v1,s2,v2);
  levels.forEach(function(code) {
    let a = 0, b = 0;
    rows.forEach(function(r) {
      a += Number((r.byLevel["Секция 1"] && r.byLevel["Секция 1"].get(code)) || 0);
      b += Number((r.byLevel["Секция 2"] && r.byLevel["Секция 2"].get(code)) || 0);
    });
    out.push(a,b);
  });
  return out;
}

function summaryGroupRow(label, rows, key, depth, levels) {
  registerGroup(key);
  const vector = summaryVector(rows,levels);
  let html = '<tr class="group-row group-toggle" data-group-key="' + esc(key) + '">';
  html += '<td colspan="3" class="group-title spec-group-title" style="padding-left:' + (8+depth*14) + 'px"><span class="group-arrow">' + groupArrow(key) + '</span>' + esc(label) + '</td>';
  vector.forEach(function(v,i){
    const isVolume = i === 2 || i === 4;
    const cls = isVolume ? "vol-col" : "summary-col";
    html += '<td class="' + cls + ' num">' + (isVolume ? fmt(v) : fmt0(v)) + '</td>';
  });
  html += '</tr>';
  return html;
}

function renderSpecSummary() {
  const levels = levelCodes();
  let rows = buildWorkingSummaryRows().filter(function(r){
    return columnFilterPass("mark",r.mark) && columnFilterPass("name",r.name);
  });
  rows = sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
  ui.currentGroupKeys = [];

  let body = "";
  let displayNo = 0;
  if (!rows.length) {
    body = tableMessage("Нет строк по текущему фильтру.",3+4+levels.length*2+1);
  } else {
    const rootKey = "spec-summary:root";
    body += summaryGroupRow("Всего по дому",rows,rootKey,0,levels);
    if (!ui.collapsed.has(rootKey)) {
      ["Цоколь","Выше 0.000"].forEach(function(zone) {
        const zRows = rows.filter(function(r){ return r.zone === zone; });
        if (!zRows.length) return;
        const zKey = "spec-summary:zone:"+zone;
        body += summaryGroupRow(zone,zRows,zKey,1,levels);
        if (ui.collapsed.has(zKey)) return;
        const names = Array.from(new Set(zRows.map(function(r){ return r.sectionName; })));
        names.forEach(function(name) {
          const sRows = zRows.filter(function(r){ return r.sectionName === name; });
          const sKey = "spec-summary:section:"+zone+":"+name;
          body += summaryGroupRow(name,sRows,sKey,2,levels);
          if (ui.collapsed.has(sKey) || ui.collapseLeaves) return;
          sRows.forEach(function(r) {
            const s1 = Number(r.bySection["Секция 1"] || 0);
            const s2 = Number(r.bySection["Секция 2"] || 0);
            const total=r.houseOnly?Number(r.houseTotal||0):s1+s2;
            displayNo++;
            body += '<tr class="data-row" data-material-id="' + esc(r.catalogItemId||"") + '">';
            body += '<td class="sticky-1 center">' + displayNo + '</td>';
            body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
            body += filterCell("name",r.name,esc(r.name),"sticky-3");
            body += '<td class="summary-col num strong-num">' + fmt0(total) + '</td>';
            body += '<td class="qty-col num">' + fmt0(s1) + '</td><td class="vol-col num">' + fmt(s1*r.volumePerPiece) + '</td>';
            body += '<td class="qty-col num">' + fmt0(s2) + '</td><td class="vol-col num">' + fmt(s2*r.volumePerPiece) + '</td>';
            levels.forEach(function(code) {
              body += '<td class="summary-col num">' + fmt0((r.byLevel["Секция 1"] && r.byLevel["Секция 1"].get(code)) || 0) + '</td>';
              body += '<td class="summary-col num">' + fmt0((r.byLevel["Секция 2"] && r.byLevel["Секция 2"].get(code)) || 0) + '</td>';
            });
            body += '</tr>';
          });
        });
      });
      const stairRows=rows.filter(function(r){return r.zone==="Лестницы";});
      if(stairRows.length){
        const stairKey="spec-summary:stairs";
        body += summaryGroupRow("Элементы лестниц",stairRows,stairKey,1,levels);
        if(!ui.collapsed.has(stairKey) && !ui.collapseLeaves){
          stairRows.forEach(function(r){
            displayNo++;
            body += '<tr class="data-row" data-material-id="'+esc(r.catalogItemId||"")+'"><td class="sticky-1 center">'+displayNo+'</td>'+
              filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3")+
              '<td class="summary-col num strong-num">'+fmt0(r.houseTotal||0)+'</td>'+
              '<td class="qty-col num">—</td><td class="vol-col num">—</td>'+
              '<td class="qty-col num">—</td><td class="vol-col num">—</td>'+
              levels.map(function(){return '<td class="summary-col num">—</td><td class="summary-col num">—</td>';}).join("")+
              '</tr>';
          });
        }
      }
    }
  }

  const head1 = '<tr>' +
    '<th class="sticky-1" rowspan="2">№</th>' +
    '<th class="sticky-2 filterable-head" rowspan="2">' + filterHeader("Марка","mark") + '</th>' +
    '<th class="sticky-3 filterable-head" rowspan="2">' + filterHeader("Наименование","name") + '</th>' +
    '<th rowspan="2" class="summary-col">Итого, шт.</th>' +
    '<th colspan="2">Секция 1</th><th colspan="2">Секция 2</th>' +
    levels.map(function(x){ return '<th colspan="2" class="floor-parent">' + esc(summaryLevelLabel(x)) + '</th>'; }).join("") +
    '</tr>';
  const head2 = '<tr>' +
    '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
    '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>' +
    levels.map(function(){ return '<th class="summary-col">1</th><th class="summary-col">2</th>'; }).join("") +
    '</tr>';

  $("workArea").className = "work-area table-work spec-work";
  $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table working-summary" data-table-key="spec-summary-v6"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div></div>';
}
