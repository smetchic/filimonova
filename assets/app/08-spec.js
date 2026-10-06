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
      buildingSections().forEach(function(bs) {
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
        bySection:{},
        byLevel:{}
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

// Pieces of a working-summary row in the object's sections (stairs rows are house-wide).
function summarySectionQty(r, bs) {
  return Number(r.bySection[bs] || 0);
}

function summaryLevelQty(r, bs, code) {
  return Number((r.byLevel[bs] && r.byLevel[bs].get(code)) || 0);
}

function summaryProjectQty(r) {
  if (r.houseOnly) return Number(r.houseTotal || 0);
  return buildingSections().reduce(function(sum,bs){ return sum + summarySectionQty(r,bs); },0);
}

// Group row cells: total, then quantity and volume per section, then each level per section.
function summaryVector(rows, levels) {
  const sections = buildingSections();
  const out = [];
  let total = 0;
  const bySection = sections.map(function(bs) {
    let qty = 0, vol = 0;
    rows.forEach(function(r) {
      const q = summarySectionQty(r,bs);
      qty += q;
      vol += q * Number(r.volumePerPiece || 0);
    });
    total += qty;
    return [qty,vol];
  });
  out.push({v:total});
  bySection.forEach(function(x){ out.push({v:x[0]},{v:x[1],volume:true}); });
  levels.forEach(function(code) {
    sections.forEach(function(bs) {
      let q = 0;
      rows.forEach(function(r){ q += summaryLevelQty(r,bs,code); });
      out.push({v:q});
    });
  });
  return out;
}

function summaryGroupRow(label, rows, key, depth, levels) {
  registerGroup(key);
  const vector = summaryVector(rows,levels);
  let html = '<tr class="group-row group-toggle" data-group-key="' + esc(key) + '">';
  html += '<td colspan="3" class="group-title spec-group-title" style="padding-left:' + (8+depth*14) + 'px"><span class="group-arrow">' + groupArrow(key) + '</span>' + esc(label) + '</td>';
  vector.forEach(function(c){
    html += '<td class="' + (c.volume ? "vol-col" : "summary-col") + ' num">' + (c.volume ? fmt(c.v) : fmt0(c.v)) + '</td>';
  });
  html += '</tr>';
  return html;
}

function renderSpecSummary() {
  const levels = levelCodes();
  const sections = buildingSections();
  let rows = buildWorkingSummaryRows().filter(function(r){
    return columnFilterPass("mark",r.mark) && columnFilterPass("name",r.name);
  });
  rows = sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
  ui.currentGroupKeys = [];

  let body = "";
  let displayNo = 0;
  if (!rows.length) {
    body = tableMessage("Нет строк по текущему фильтру.",4+sections.length*2+levels.length*sections.length);
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
            const total=summaryProjectQty(r);
            displayNo++;
            body += '<tr class="data-row" data-material-id="' + esc(r.catalogItemId||"") + '">';
            body += '<td class="sticky-1 center">' + displayNo + '</td>';
            body += filterCell("mark",r.mark,esc(r.mark),"sticky-2");
            body += filterCell("name",r.name,esc(r.name),"sticky-3");
            body += '<td class="summary-col num strong-num">' + fmt0(total) + '</td>';
            sections.forEach(function(bs) {
              const q = summarySectionQty(r,bs);
              body += '<td class="qty-col num">' + fmt0(q) + '</td><td class="vol-col num">' + fmt(q*r.volumePerPiece) + '</td>';
            });
            levels.forEach(function(code) {
              sections.forEach(function(bs) {
                body += '<td class="summary-col num">' + fmt0(summaryLevelQty(r,bs,code)) + '</td>';
              });
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
              sections.map(function(){return '<td class="qty-col num">—</td><td class="vol-col num">—</td>';}).join("")+
              levels.map(function(){return sections.map(function(){return '<td class="summary-col num">—</td>';}).join("");}).join("")+
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
    sections.map(function(bs){ return '<th colspan="2">' + esc(bs) + '</th>'; }).join("") +
    levels.map(function(x){ return '<th colspan="' + sections.length + '" class="floor-parent">' + esc(summaryLevelLabel(x)) + '</th>'; }).join("") +
    '</tr>';
  const head2 = '<tr>' +
    sections.map(function(){ return '<th class="qty-col">Кол-во, шт.</th><th class="vol-col">Объём, м³</th>'; }).join("") +
    levels.map(function(){ return sections.map(function(bs){ return '<th class="summary-col">' + esc(sectionKey(bs).slice(1)) + '</th>'; }).join(""); }).join("") +
    '</tr>';

  $("workArea").className = "work-area table-work spec-work";
  $("workArea").innerHTML = '<div class="engineering-shell"><div class="engineering-scroll"><table class="spec-table working-summary" data-table-key="spec-summary-v6' + (sections.length===2 ? '' : '-s'+sections.length) + '"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div></div>';
}
