function supplyFactState() {
  const docs=new Map((dataState.supplyDocuments||[]).map(function(d){return [d.id,d];}));
  const allocatedByGreen=new Map();
  (dataState.supplyLineAllocations||[]).forEach(function(a){
    const key=a.green_line_id;
    if(!allocatedByGreen.has(key)) allocatedByGreen.set(key,{pieces:0,m3:0});
    const v=allocatedByGreen.get(key);
    v.pieces+=Number(a.allocated_pieces||0);
    v.m3+=Number(a.allocated_m3||0);
  });
  const byCatalog=new Map(),unmatched=[];
  (dataState.supplyDocumentLines||[]).forEach(function(line){
    const doc=docs.get(line.document_id);
    if(!doc||doc.status!=="posted") return;
    let pieces=Number(line.qty_pieces||0),m3=Number(line.qty_m3||0);
    if(doc.document_type==="green"){
      const a=allocatedByGreen.get(line.id)||{pieces:0,m3:0};
      pieces=Math.max(0,pieces-a.pieces);
      m3=Math.max(0,m3-a.m3);
    }
    if(pieces<=0&&m3<=0) return;
    const fact={
      line:line,doc:doc,pieces:pieces,m3:m3,
      mark:line.source_mark||"",name:line.source_name||""
    };
    if(!line.catalog_item_id){unmatched.push(fact);return;}
    if(!byCatalog.has(line.catalog_item_id)) byCatalog.set(line.catalog_item_id,{pieces:0,m3:0});
    const v=byCatalog.get(line.catalog_item_id);
    v.pieces+=pieces;v.m3+=m3;
  });
  return {byCatalog:byCatalog,unmatched:unmatched};
}

function supplyMountedByCatalog() {
  const specById=new Map((dataState.specRows||[]).map(function(r){return [r.id,r];}));
  const map=new Map();
  (dataState.montageEvents||[]).forEach(function(event){
    if(event.event_type!=="fact") return;
    const sr=specById.get(event.specification_row_id);
    if(!sr||!sr.catalog_item_id) return;
    map.set(sr.catalog_item_id,Number(map.get(sr.catalog_item_id)||0)+Number(event.quantity||0));
  });
  return map;
}

function renderSupplySummary() {
  const fact=supplyFactState();
  const mountedByCatalog=supplyMountedByCatalog();
  let rows=buildWorkingSummaryRows().filter(function(r){return passesSearch([r.mark,r.name]);})
    .filter(function(r){return rowPassesColumnFilters({mark:r.mark,name:r.name});});
  rows=sortRows(rows,{mark:function(r){return r.mark;},name:function(r){return r.name;}});
  ui.currentGroupKeys=[];
  let body="";

  function vectorForRow(r){
    const projectPieces=summaryProjectQty(r);
    const projectM3=projectPieces*Number(r.volumePerPiece||0);
    const delivered=fact.byCatalog.get(r.catalogItemId)||{pieces:0,m3:0};
    const mountedPieces=Number(mountedByCatalog.get(r.catalogItemId)||0);
    const mountedM3=mountedPieces*Number(r.volumePerPiece||0);
    const onObjectPieces=Math.max(0,Number(delivered.pieces||0)-mountedPieces);
    const onObjectM3=Math.max(0,Number(delivered.m3||0)-mountedM3);
    const remainPieces=Math.max(0,projectPieces-Number(delivered.pieces||0));
    const remainM3=Math.max(0,projectM3-Number(delivered.m3||0));
    let status="";
    if(Number(delivered.pieces||0)<=0&&Number(delivered.m3||0)<=0) status="Не поставлялось";
    else if(Number(delivered.pieces||0)>projectPieces+1e-9) status="Перепоставка";
    else if(Number(delivered.pieces||0)<projectPieces-1e-9) status="Частично";
    return {
      projectPieces:projectPieces,projectM3:projectM3,
      deliveredPieces:Number(delivered.pieces||0),deliveredM3:Number(delivered.m3||0),
      onObjectPieces:onObjectPieces,onObjectM3:onObjectM3,
      mountedPieces:mountedPieces,mountedM3:mountedM3,
      remainPieces:remainPieces,remainM3:remainM3,status:status
    };
  }

  function supplyVector(list){
    return list.reduce(function(acc,r){
      const v=vectorForRow(r);
      Object.keys(acc).forEach(function(k){acc[k]+=Number(v[k]||0);});
      return acc;
    },{
      projectPieces:0,projectM3:0,deliveredPieces:0,deliveredM3:0,
      onObjectPieces:0,onObjectM3:0,mountedPieces:0,mountedM3:0,remainPieces:0,remainM3:0
    });
  }

  function group(label,list,key,depth){
    registerGroup(key);
    const v=supplyVector(list);
    return '<tr class="group-row group-toggle" data-group-key="'+esc(key)+'">'+
      '<td colspan="3" class="group-title spec-group-title" style="padding-left:'+(8+depth*14)+'px"><span class="group-arrow">'+groupArrow(key)+'</span>'+esc(label)+'</td>'+
      '<td class="num">'+exFmt0(v.projectPieces)+'</td><td class="num">'+exFmt(v.projectM3)+'</td>'+
      '<td class="num">'+exFmt0(v.deliveredPieces)+'</td><td class="num">'+exFmt(v.deliveredM3)+'</td>'+
      '<td class="num">'+exFmt0(v.onObjectPieces)+'</td><td class="num">'+exFmt(v.onObjectM3)+'</td>'+
      '<td class="num">'+exFmt0(v.mountedPieces)+'</td><td class="num">'+exFmt(v.mountedM3)+'</td>'+
      '<td class="num">'+exFmt0(v.remainPieces)+'</td><td class="num">'+exFmt(v.remainM3)+'</td><td></td></tr>';
  }

  function leaf(r,index){
    const v=vectorForRow(r);
    return '<tr class="data-row" data-material-id="'+esc(r.catalogItemId||"")+'"><td class="sticky-1 center">'+(index+1)+'</td>'+
      filterCell("mark",r.mark,esc(r.mark),"sticky-2")+filterCell("name",r.name,esc(r.name),"sticky-3")+
      '<td class="num">'+exFmt0(v.projectPieces)+'</td><td class="num">'+exFmt(v.projectM3)+'</td>'+
      '<td class="num">'+(v.deliveredPieces?exFmt(v.deliveredPieces):"")+'</td><td class="num">'+(v.deliveredM3?exFmt(v.deliveredM3):"")+'</td>'+
      '<td class="num">'+(v.onObjectPieces?exFmt(v.onObjectPieces):"")+'</td><td class="num">'+(v.onObjectM3?exFmt(v.onObjectM3):"")+'</td>'+
      '<td class="num">'+(v.mountedPieces?exFmt(v.mountedPieces):"")+'</td><td class="num">'+(v.mountedM3?exFmt(v.mountedM3):"")+'</td>'+
      '<td class="num">'+exFmt(v.remainPieces)+'</td><td class="num">'+exFmt(v.remainM3)+'</td>'+
      '<td class="status-cell">'+esc(v.status)+'</td></tr>';
  }

  if(rows.length){
    const root="supply:root";
    body+=group("Всего по дому",rows,root,0);
    if(!ui.collapsed.has(root)){
      ["Цоколь","Выше 0.000"].forEach(function(zone){
        const zr=rows.filter(function(r){return r.zone===zone;});
        if(!zr.length) return;
        const zk="supply:zone:"+zone;
        body+=group(zone,zr,zk,1);
        if(ui.collapsed.has(zk)) return;
        Array.from(new Set(zr.map(function(r){return r.sectionName;}))).forEach(function(name){
          const sr=zr.filter(function(r){return r.sectionName===name;});
          const sk="supply:section:"+zone+":"+name;
          body+=group(name,sr,sk,2);
          if(ui.collapsed.has(sk)||ui.collapseLeaves) return;
          sr.forEach(function(r,index){body+=leaf(r,index);});
        });
      });
      const stairs=rows.filter(function(r){return r.zone==="Лестницы"||r.sectionName==="Элементы лестниц";});
      if(stairs.length){
        const sk="supply:stairs";
        body+=group("Элементы лестниц",stairs,sk,1);
        if(!ui.collapsed.has(sk)&&!ui.collapseLeaves) stairs.forEach(function(r,index){body+=leaf(r,index);});
      }
    }
  }

  const unmatched=fact.unmatched.filter(function(x){return passesSearch([x.mark,x.name]);});
  if(unmatched.length){
    const key="supply:unmatched";
    registerGroup(key);
    const totals=unmatched.reduce(function(a,x){a.pieces+=x.pieces;a.m3+=x.m3;return a;},{pieces:0,m3:0});
    body+='<tr class="group-row group-toggle" data-group-key="'+key+'"><td colspan="3" class="group-title spec-group-title"><span class="group-arrow">'+groupArrow(key)+'</span>Не сопоставлено</td>'+
      '<td></td><td></td><td class="num">'+exFmt(totals.pieces)+'</td><td class="num">'+exFmt(totals.m3)+'</td><td class="num">'+exFmt(totals.pieces)+'</td><td class="num">'+exFmt(totals.m3)+'</td><td></td><td></td><td></td><td></td><td>Не сопоставлено</td></tr>';
    if(!ui.collapsed.has(key)&&!ui.collapseLeaves){
      unmatched.forEach(function(x,index){
        body+='<tr class="data-row" data-material-mark="'+esc(x.mark)+'" data-material-name="'+esc(x.name)+'"><td class="sticky-1 center">'+(index+1)+'</td>'+
          filterCell("mark",x.mark,esc(x.mark||"—"),"sticky-2")+filterCell("name",x.name,esc(x.name||"—"),"sticky-3")+
          '<td></td><td></td><td class="num">'+exFmt(x.pieces)+'</td><td class="num">'+exFmt(x.m3)+'</td>'+
          '<td class="num">'+exFmt(x.pieces)+'</td><td class="num">'+exFmt(x.m3)+'</td><td></td><td></td><td></td><td></td><td>Не сопоставлено</td></tr>';
      });
    }
  }

  if(!body) body=tableMessage("Нет строк по текущему фильтру.",14);

  const head='<thead><tr><th class="sticky-1" rowspan="2">№</th>'+
    '<th class="sticky-2 filterable-head" rowspan="2">'+filterHeader("Марка","mark")+'</th>'+
    '<th class="sticky-3 filterable-head" rowspan="2">'+filterHeader("Наименование","name")+'</th>'+
    '<th colspan="2">По проекту</th><th colspan="2">Поставлено</th><th colspan="2">На объекте</th><th colspan="2">Смонтировано</th><th colspan="2">Осталось поставить</th><th rowspan="2">Статус</th></tr>'+
    '<tr><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th><th>шт.</th><th>м³</th></tr></thead>';
  $("workArea").className="work-area table-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table supply-table" data-table-key="supply-summary">'+head+'<tbody>'+body+'</tbody></table></div></div>';
}

function supplyDateLabel(value) {
  const s=String(value||"").slice(0,10);
  if(!s) return "—";
  const p=s.split("-");
  return p.length===3 ? p[2]+"."+p[1]+"."+p[0] : s;
}

function supplyDocumentTypeLabel(type) {
  return type==="green" ? "Зелёная ТТН" : "Белая ТТН";
}

function supplyDocumentRegistryState(doc,lines) {
  const lineIds=new Set((lines||[]).map(function(l){return l.id;}));
  const allocations=dataState.supplyLineAllocations||[];
  const review=(lines||[]).some(function(l){return l.match_state==="review"||l.match_state==="unmatched";});
  if(doc.status==="cancelled") return {label:"Отменена",tone:"cancelled"};
  if(doc.status==="draft") return {label:"Черновик",tone:"draft"};

  const totalPieces=(lines||[]).reduce(function(s,l){return s+Number(l.qty_pieces||0);},0);
  const totalM3=(lines||[]).reduce(function(s,l){return s+Number(l.qty_m3||0);},0);
  const eps=0.000001;

  if(doc.document_type==="white"){
    if(review) return {label:"Требует проверки",tone:"issue"};
    const confirmed=allocations.filter(function(a){return lineIds.has(a.white_line_id);}).reduce(function(acc,a){
      acc.pieces+=Number(a.allocated_pieces||0);
      acc.m3+=Number(a.allocated_m3||0);
      return acc;
    },{pieces:0,m3:0});
    const usePieces=totalPieces>eps;
    const total=usePieces?totalPieces:totalM3;
    const done=usePieces?confirmed.pieces:confirmed.m3;
    if(done<=eps) return {label:"Ожидает ТТН",tone:"waiting"};
    if(done+eps<total) return {label:"Частично подтверждена",tone:"partial"};
    return {label:"Подтверждена",tone:"ok"};
  }

  if(review) return {label:"Есть расхождение",tone:"issue"};
  const linked=allocations.filter(function(a){return lineIds.has(a.green_line_id);}).reduce(function(acc,a){
    acc.pieces+=Number(a.allocated_pieces||0);
    acc.m3+=Number(a.allocated_m3||0);
    return acc;
  },{pieces:0,m3:0});
  const usePieces=totalPieces>eps;
  const total=usePieces?totalPieces:totalM3;
  const done=usePieces?linked.pieces:linked.m3;
  if(done<=eps) return {label:"Без белой ТТН",tone:"waiting"};
  if(done+eps<total) return {label:"Частично сопоставлена",tone:"partial"};
  return {label:"Сопоставлена",tone:"ok"};
}

async function openSupplyDocumentFile(documentId) {
  const doc=(dataState.supplyDocuments||[]).find(function(d){return d.id===documentId;});
  if(!doc||!doc.source_file_path) return;
  const popup=window.open("","_blank");
  try{
    const result=await client.storage.from("supply-documents").createSignedUrl(doc.source_file_path,60);
    if(result.error) throw result.error;
    if(popup) popup.location.href=result.data.signedUrl;
    else window.open(result.data.signedUrl,"_blank","noopener");
  }catch(err){
    if(popup) popup.close();
    alert("Не удалось открыть файл накладной:\n"+(err&&err.message?err.message:String(err)));
  }
}

function renderSupplyDocuments() {
  let docs=(dataState.supplyDocuments||[]).slice().sort(function(a,b){
    return String(b.receipt_date||"").localeCompare(String(a.receipt_date||"")) ||
      String(b.created_at||"").localeCompare(String(a.created_at||""));
  });
  docs=docs.filter(function(doc){
    const lines=(dataState.supplyDocumentLines||[]).filter(function(l){return l.document_id===doc.id;});
    const state=supplyDocumentRegistryState(doc,lines);
    return passesSearch([doc.receipt_date,supplyDocumentTypeLabel(doc.document_type),doc.ttn_number,doc.source_file_name,state.label]);
  }).filter(function(doc){
    return rowPassesColumnFilters({
      date:supplyDateLabel(doc.receipt_date),
      type:supplyDocumentTypeLabel(doc.document_type),
      ttn:doc.ttn_number||""
    });
  });

  let body=docs.map(function(doc){
    const lines=(dataState.supplyDocumentLines||[]).filter(function(l){return l.document_id===doc.id;});
    const positions=lines.length;
    const pieces=lines.reduce(function(s,l){return s+Number(l.qty_pieces||0);},0);
    const m3=lines.reduce(function(s,l){return s+Number(l.qty_m3||0);},0);
    const net=lines.reduce(function(s,l){return s+Number(l.amount_net||0);},0);
    const vat=lines.reduce(function(s,l){return s+Number(l.vat_amount||0);},0);
    const gross=lines.reduce(function(s,l){return s+Number(l.amount_gross||0);},0);
    const state=supplyDocumentRegistryState(doc,lines);
    const typeLabel=supplyDocumentTypeLabel(doc.document_type);
    const fileCell=doc.source_file_name
      ? (doc.source_file_path
        ? '<button class="table-text-action supply-file-link" data-supply-file-open="'+doc.id+'" type="button" title="'+esc(doc.source_file_name)+'">'+esc(doc.source_file_name)+'</button>'
        : esc(doc.source_file_name))
      : "—";
    return '<tr class="data-row supply-doc-row" data-supply-document-id="'+doc.id+'">'+
      filterCell("date",supplyDateLabel(doc.receipt_date),esc(supplyDateLabel(doc.receipt_date)))+
      filterCell("type",typeLabel,esc(typeLabel))+
      filterCell("ttn",doc.ttn_number||"",esc(doc.ttn_number||"—"))+
      '<td class="supply-file-cell">'+fileCell+'</td>'+
      '<td class="num">'+exFmt0(positions)+'</td>'+
      '<td class="num">'+(pieces?exFmt(pieces):"")+'</td>'+
      '<td class="num">'+(m3?exFmt(m3):"")+'</td>'+
      '<td class="num">'+(net?exMoney(net):"")+'</td>'+
      '<td class="num">'+(vat?exMoney(vat):"")+'</td>'+
      '<td class="num">'+(gross?exMoney(gross):"")+'</td>'+
      '<td><span class="supply-doc-state '+state.tone+'">'+esc(state.label)+'</span></td>'+
    '</tr>';
  }).join("");

  if(!body) body=tableMessage('Накладных пока нет. Добавьте фактическую поставку через «+ Добавить накладную».',11);

  $("workArea").className="work-area table-work supply-doc-work";
  $("workArea").innerHTML='<div class="engineering-shell"><div class="engineering-scroll"><table class="eng-table supply-doc-table" data-table-key="supply-documents-v2">'+
    '<thead><tr>'+
      '<th class="filterable-head">'+filterHeader("Дата поступления","date")+'</th>'+
      '<th class="filterable-head">'+filterHeader("Тип","type")+'</th>'+
      '<th class="filterable-head">'+filterHeader("№ ТТН","ttn")+'</th>'+
      '<th>Файл</th><th>Позиций</th><th>Шт.</th><th>м³</th><th>Без НДС</th><th>НДС</th><th>С НДС</th><th>Состояние</th>'+
    '</tr></thead><tbody>'+body+'</tbody></table></div></div>';

  document.querySelectorAll(".supply-doc-row").forEach(function(row){
    row.onclick=function(e){
      document.querySelectorAll(".supply-doc-row.active-row").forEach(function(x){x.classList.remove("active-row");});
      row.classList.add("active-row");
      // A phone has no double click: one tap opens the invoice.
      if(isPhoneLayout() && !e.target.closest("button,a,input,select")) row.ondblclick(e);
    };
    row.ondblclick=function(e){
      if(e.target.closest("button,a,input,select")) return;
      const doc=(dataState.supplyDocuments||[]).find(function(d){return d.id===row.dataset.supplyDocumentId;});
      if(doc) openSupplyDocumentEditor(doc);
    };
  });
  document.querySelectorAll("[data-supply-file-open]").forEach(function(btn){
    btn.onclick=function(e){
      e.preventDefault();
      e.stopPropagation();
      openSupplyDocumentFile(btn.dataset.supplyFileOpen);
    };
  });
}

function supplyEditorCatalogItems() {
  const ids=new Set((dataState.specRows||[]).map(function(r){return r.catalog_item_id;}).filter(Boolean));
  return (dataState.catalogItems||[]).filter(function(item){return ids.has(item.id);});
}

function supplyEditorVolumeInfo(catalogItemId) {
  if(!catalogItemId) return {volume:null,supplierItemId:null,ambiguous:false};
  const direct=(dataState.supplierItems||[]).filter(function(si){return si.catalog_item_id===catalogItemId;});
  const linkedIds=new Set((dataState.supplierPriceLinks||[])
    .filter(function(l){return l.catalog_item_id===catalogItemId&&l.supplier_item_id;})
    .map(function(l){return l.supplier_item_id;}));
  const items=(dataState.supplierItems||[]).filter(function(si){
    return si.catalog_item_id===catalogItemId || linkedIds.has(si.id);
  });
  const values=Array.from(new Set(items.map(function(si){return Number(si.unit_volume_m3||0);})
    .filter(function(v){return v>0;}).map(function(v){return v.toFixed(6);}))).map(Number);
  return {
    volume:values.length===1?values[0]:null,
    supplierItemId:items.length===1?items[0].id:null,
    ambiguous:values.length>1
  };
}

function supplyEditorResolveRow(row) {
  const catalog=supplyEditorCatalogItems();
  const mark=norm(row.source_mark||"");
  const name=norm(row.source_name||"");
  let candidates=catalog.slice();
  if(mark) candidates=candidates.filter(function(item){return norm(item.mark)===mark;});
  if(name) candidates=candidates.filter(function(item){return norm(item.name)===name;});
  if(candidates.length===1 && (mark||name)){
    row.catalog_item_id=candidates[0].id;
    const info=supplyEditorVolumeInfo(row.catalog_item_id);
    row.supplier_item_id=info.supplierItemId||null;
    if(!(Number(row.unit_volume_snapshot_m3)>0) && info.volume!=null) row.unit_volume_snapshot_m3=info.volume;
    return candidates[0];
  }
  row.catalog_item_id=null;
  row.supplier_item_id=null;
  if(!(Number(row.unit_volume_snapshot_m3)>0)) row.unit_volume_snapshot_m3=null;
  return null;
}

function supplyEditorNumber(value) {
  if(value==null||value==="") return null;
  const n=Number(String(value).replace(",",".").replace(/\s/g,""));
  return Number.isFinite(n)?n:null;
}

function supplyEditorComputed(row,type) {
  supplyEditorResolveRow(row);
  const volume=supplyEditorNumber(row.unit_volume_snapshot_m3);
  let pcs=supplyEditorNumber(row.qty_pieces);
  let m3=supplyEditorNumber(row.qty_m3);
  const price=supplyEditorNumber(row.unit_price);
  let vatPercent=supplyEditorNumber(row.vat_percent);
  if(type==="white"){
    m3=pcs!=null&&volume!=null?pcs*volume:null;
    return {pcs:pcs,m3:m3,volume:volume,net:null,vat:null,gross:null};
  }
  if(vatPercent==null) vatPercent=20;
  pcs=m3!=null&&volume!=null&&volume>0?m3/volume:null;
  const net=m3!=null&&price!=null?m3*price:null;
  const vat=net!=null?net*vatPercent/100:null;
  const gross=net!=null?net+(vat||0):null;
  return {pcs:pcs,m3:m3,volume:volume,net:net,vat:vat,gross:gross};
}

function supplyEditorRowStatus(row,type) {
  const c=supplyEditorComputed(row,type);
  if(!row.catalog_item_id) return "Не сопоставлено";
  if(!(c.volume>0)) return "Нет объёма";
  if(type==="green" && c.pcs!=null && Math.abs(c.pcs-Math.round(c.pcs))>0.000001) return "Проверить";
  return "Сопоставлено";
}

function closeTtnSuggestions() {
  document.querySelectorAll(".ttn-suggest-popup").forEach(function(x){x.remove();});
}

function supplyEditorSuggestionValues(field,row,query) {
  const q=norm(query||"");
  const otherRaw=field==="mark"?String(row.source_name||""):String(row.source_mark||"");
  const other=norm(otherRaw);
  const valueOf=function(item){return field==="mark"?String(item.mark||""):String(item.name||"");};
  const otherOf=function(item){return field==="mark"?String(item.name||""):String(item.mark||"");};

  let candidates=supplyEditorCatalogItems().filter(function(item){
    const value=valueOf(item);
    if(!value) return false;
    if(q && !norm(value).includes(q)) return false;
    if(!other) return true;

    const candidateOther=norm(otherOf(item));
    if(candidateOther===other) return true;

    // Пока соседнее поле набрано частично, используем его как живой фильтр.
    return candidateOther.includes(other) || other.includes(candidateOther);
  });

  candidates.sort(function(a,b){
    const av=valueOf(a),bv=valueOf(b);
    const an=norm(av),bn=norm(bv);
    const ao=norm(otherOf(a)),bo=norm(otherOf(b));

    // Сначала полное совпадение с соседней ячейкой, затем частичное.
    const ar=other ? (ao===other?0:(ao.startsWith(other)?1:2)) : 0;
    const br=other ? (bo===other?0:(bo.startsWith(other)?1:2)) : 0;
    if(ar!==br) return ar-br;

    // Для вводимого значения сначала начало строки, затем остальные вхождения.
    const aq=q ? (an.startsWith(q)?0:1) : 0;
    const bq=q ? (bn.startsWith(q)?0:1) : 0;
    if(aq!==bq) return aq-bq;

    return av.localeCompare(bv,"ru",{numeric:true,sensitivity:"base"});
  });

  const seen=new Set();
  const values=[];
  candidates.forEach(function(item){
    const value=valueOf(item);
    const key=norm(value);
    if(seen.has(key)) return;
    seen.add(key);
    values.push({value:value,item:item});
  });
  return values;
}

function isPhoneLayout() {
  return window.matchMedia("(max-width:760px)").matches;
}

function openTtnSuggestions(input,field,row,draftRows,rerender) {
  closeTtnSuggestions();
  const values=supplyEditorSuggestionValues(field,row,input.value||"");
  if(!values.length) return;

  const rect=input.getBoundingClientRect();
  const pop=document.createElement("div");
  pop.className="ttn-suggest-popup";
  pop.dataset.ttnSuggestionField=field;
  const width=Math.min(Math.max(rect.width,field==="name"?300:180),window.innerWidth-16);
  pop.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+"px";
  pop.style.top=(rect.bottom+2)+"px";
  pop.style.width=width+"px";

  values.slice(0,60).forEach(function(x){
    const option=document.createElement("button");
    option.type="button";
    option.textContent=x.value;
    option.title=x.value;
    option.onclick=function(e){
      e.preventDefault();
      e.stopPropagation();

      if(field==="mark") row.source_mark=x.value;
      else row.source_name=x.value;

      supplyEditorResolveRow(row);
      closeTtnSuggestions();
      rerender();
    };
    pop.appendChild(option);
  });

  document.body.appendChild(pop);
}

function supplyReconciliationHtml(doc) {
  if(!doc || doc.document_type!=="green") return "";
  const greenLines=(dataState.supplyDocumentLines||[]).filter(function(l){return l.document_id===doc.id;});
  const greenIds=new Set(greenLines.map(function(l){return l.id;}));
  const currentAllocations=(dataState.supplyLineAllocations||[]).filter(function(a){return greenIds.has(a.green_line_id);});
  if(!currentAllocations.length){
    return '<div class="ttn-recon"><div class="ttn-recon-title">Сверка с белыми ТТН</div><div class="ttn-recon-empty">Для этой зелёной ТТН подтверждаемые количества белых ТТН пока не определены.</div></div>';
  }
  const lineById=new Map((dataState.supplyDocumentLines||[]).map(function(l){return [l.id,l];}));
  const docById=new Map((dataState.supplyDocuments||[]).map(function(d){return [d.id,d];}));
  const whiteIds=Array.from(new Set(currentAllocations.map(function(x){return x.white_line_id;})));
  const rows=whiteIds.map(function(whiteId){
    const white=lineById.get(whiteId)||{};
    const whiteDoc=docById.get(white.document_id)||{};
    const confirmed=(dataState.supplyLineAllocations||[]).filter(function(x){return x.white_line_id===whiteId;})
      .reduce(function(s,x){return s+Number(x.allocated_pieces||0);},0);
    const total=Number(white.qty_pieces||0);
    const remain=Math.max(0,total-confirmed);
    return '<tr>'+
      '<td>'+esc(supplyDateLabel(whiteDoc.receipt_date))+(whiteDoc.ttn_number?' · №'+esc(whiteDoc.ttn_number):"")+'</td>'+
      '<td>'+esc(white.source_mark||white.source_name||"—")+'</td>'+
      '<td class="num">'+(total?exFmt(total):"")+'</td>'+
      '<td class="num">'+(confirmed?exFmt(confirmed):"")+'</td>'+
      '<td class="num">'+(remain?exFmt(remain):"0")+'</td>'+
      '<td>'+(remain<=0.000001?"Закрыта":"Частично")+'</td>'+
    '</tr>';
  }).join("");
  return '<div class="ttn-recon"><div class="ttn-recon-title">Сверка с белыми ТТН</div><div class="ttn-recon-scroll"><table>'+
    '<thead><tr><th>Белая ТТН</th><th>Позиция</th><th>По белой, шт.</th><th>Подтверждено, шт.</th><th>Осталось, шт.</th><th>Состояние</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div></div>';
}

function openSupplyDocumentEditor(documentRow) {
  closeTtnSuggestions();
  const existing=documentRow||null;
  let type=existing&&existing.document_type==="green"?"green":"white";
  let receiptDate=existing&&existing.receipt_date?String(existing.receipt_date).slice(0,10):new Date().toISOString().slice(0,10);
  let ttnNumber=existing&&existing.ttn_number||"";
  let fileName=existing&&existing.source_file_name||"";
  let filePath=existing&&existing.source_file_path||"";
  let pendingFile=null;
  let draftRows=existing?(dataState.supplyDocumentLines||[]).filter(function(l){return l.document_id===existing.id;})
    .sort(function(a,b){return Number(a.sort_order||0)-Number(b.sort_order||0);})
    .map(function(l){return {
      id:l.id||null,source_mark:l.source_mark||"",source_name:l.source_name||"",
      catalog_item_id:l.catalog_item_id||null,supplier_item_id:l.supplier_item_id||null,
      qty_pieces:l.qty_pieces==null?"":String(l.qty_pieces),
      qty_m3:l.qty_m3==null?"":String(l.qty_m3),
      unit_volume_snapshot_m3:l.unit_volume_snapshot_m3==null?"":String(l.unit_volume_snapshot_m3),
      unit_price:l.unit_price==null?"":String(l.unit_price),
      vat_percent:l.vat_percent==null?"":String(l.vat_percent)
    };}):[];
  function blankRow(){
    return {id:null,source_mark:"",source_name:"",catalog_item_id:null,supplier_item_id:null,qty_pieces:"",qty_m3:"",unit_volume_snapshot_m3:"",unit_price:"",vat_percent:""};
  }
  if(!draftRows.length) draftRows=[blankRow()];

  let backdrop=document.getElementById("supplyDocumentModal");
  if(!backdrop){backdrop=document.createElement("div");backdrop.id="supplyDocumentModal";backdrop.className="ttn-modal-backdrop";document.body.appendChild(backdrop);}
  backdrop.classList.add("open");
  backdrop.innerHTML='<div class="ttn-modal" role="dialog" aria-modal="true">'+
    '<div class="ttn-modal-head"><div><strong>'+(existing?'Накладная поставки':'Новая накладная')+'</strong><span>'+(existing?'Редактирование документа':'Фактическое поступление или официальное подтверждение')+'</span></div><button class="ttn-close" type="button">×</button></div>'+
    '<div class="ttn-type-tabs"><button type="button" data-ttn-type="white">Белая ТТН</button><button type="button" data-ttn-type="green">Зелёная ТТН</button></div>'+
    '<div class="ttn-meta">'+
      '<label><span>Дата поступления</span><input type="date" data-ttn-date></label>'+
      '<label><span>№ ТТН</span><input type="text" data-ttn-number></label>'+
      '<div class="ttn-file"><span>Файл</span><input type="file" data-ttn-file hidden><button class="context-link" type="button" data-ttn-file-action></button></div>'+
    '</div>'+
    '<div class="ttn-table-zone"></div>'+
    '<div class="ttn-modal-foot"><span class="ttn-status" data-ttn-status></span><span class="spacer"></span><button class="context-link" type="button" data-ttn-cancel>Отмена</button><button class="context-link ttn-save" type="button" data-ttn-save>Сохранить</button></div>'+
    '</div>';

  const modal=backdrop.querySelector(".ttn-modal");
  const dateInput=modal.querySelector("[data-ttn-date]");
  const numberInput=modal.querySelector("[data-ttn-number]");
  const fileInput=modal.querySelector("[data-ttn-file]");
  const fileAction=modal.querySelector("[data-ttn-file-action]");
  const zone=modal.querySelector(".ttn-table-zone");
  const status=modal.querySelector("[data-ttn-status]");
  dateInput.value=receiptDate;
  numberInput.value=ttnNumber;

  function syncHeader(){
    modal.querySelectorAll("[data-ttn-type]").forEach(function(btn){btn.classList.toggle("active",btn.dataset.ttnType===type);});
    numberInput.disabled=type==="white";
    numberInput.placeholder=type==="white"?"не требуется":"номер зелёной ТТН";
    if(type==="white") numberInput.value="";
    fileAction.textContent=pendingFile?pendingFile.name:(fileName?fileName+" · заменить":"Прикрепить файл");
  }

  function rowPayload(row,index){
    const c=supplyEditorComputed(row,type);
    return {
      id:row.id||null,
      sort_order:index,
      source_mark:String(row.source_mark||"").trim(),
      source_name:String(row.source_name||"").trim(),
      catalog_item_id:row.catalog_item_id||null,
      supplier_item_id:row.supplier_item_id||null,
      qty_pieces:c.pcs==null?null:c.pcs,
      qty_m3:c.m3==null?null:c.m3,
      unit_volume_snapshot_m3:c.volume==null?null:c.volume,
      unit_price:type==="green"?supplyEditorNumber(row.unit_price):null,
      vat_percent:type==="green"?supplyEditorNumber(row.vat_percent):null
    };
  }

  function renderLines(){
    closeTtnSuggestions();
    const green=type==="green";
    const cols=green?10:6;
    let totalPcs=0,totalM3=0,totalNet=0,totalVat=0,totalGross=0;

    const body=draftRows.map(function(row,index){
      const c=supplyEditorComputed(row,type);
      totalPcs+=Number(c.pcs||0);
      totalM3+=Number(c.m3||0);
      totalNet+=Number(c.net||0);
      totalVat+=Number(c.vat||0);
      totalGross+=Number(c.gross||0);
      const state=supplyEditorRowStatus(row,type);
      // data-label captions the fields when a phone shows each row as a card.
      const common='<td class="ttn-source-input" data-label="Марка"><input data-ttn-mark="'+index+'" value="'+esc(row.source_mark||"")+'" placeholder="Марка" autocomplete="off"></td>'+
        '<td class="ttn-source-input ttn-name-input" data-label="Наименование"><input data-ttn-name="'+index+'" value="'+esc(row.source_name||"")+'" placeholder="Наименование" autocomplete="off"></td>';

      if(!green){
        return '<tr data-ttn-row="'+index+'">'+common+
          '<td class="num-input" data-label="Кол-во, шт."><input data-ttn-pieces="'+index+'" inputmode="decimal" value="'+esc(row.qty_pieces||"")+'"></td>'+
          '<td class="num computed" data-label="Объём, м³">'+(c.m3!=null?exFmt(c.m3):"—")+'</td>'+
          '<td class="ttn-link-state '+(state==="Сопоставлено"?"ok":"review")+'" data-label="Сопоставление">'+esc(state)+'</td>'+
          '<td class="center"><button class="table-text-action" data-ttn-remove="'+index+'" type="button">удалить</button></td></tr>';
      }

      return '<tr data-ttn-row="'+index+'">'+common+
        '<td class="num-input" data-label="Кол-во по ТТН, м³"><input data-ttn-m3="'+index+'" inputmode="decimal" value="'+esc(row.qty_m3||"")+'"></td>'+
        '<td class="num computed" data-label="Расчёт, шт.">'+(c.pcs!=null?exFmt(c.pcs):"—")+'</td>'+
        '<td class="num-input" data-label="Цена за 1 м³"><input data-ttn-price="'+index+'" inputmode="decimal" value="'+esc(row.unit_price||"")+'"></td>'+
        '<td class="num computed" data-label="Сумма без НДС">'+(c.net!=null?exMoney(c.net):"—")+'</td>'+
        '<td class="num computed" data-label="НДС">'+(c.vat!=null?exMoney(c.vat):"—")+'</td>'+
        '<td class="num computed" data-label="Сумма с НДС">'+(c.gross!=null?exMoney(c.gross):"—")+'</td>'+
        '<td class="ttn-link-state '+(state==="Сопоставлено"?"ok":"review")+'" data-label="Сопоставление">'+esc(state)+'</td>'+
        '<td class="center"><button class="table-text-action" data-ttn-remove="'+index+'" type="button">удалить</button></td></tr>';
    }).join("");

    const head=green
      ? '<thead><tr><th>Марка</th><th>Наименование</th><th>Кол-во по ТТН, м³</th><th>Расчёт, шт.</th><th>Цена за 1 м³</th><th>Сумма без НДС</th><th>НДС</th><th>Сумма с НДС</th><th>Сопоставление</th><th></th></tr></thead>'
      : '<thead><tr><th>Марка</th><th>Наименование</th><th>Кол-во, шт.</th><th>Объём, м³</th><th>Сопоставление</th><th></th></tr></thead>';

    const foot=green
      ? '<tfoot><tr class="ttn-total-row"><td colspan="2">ИТОГО</td><td class="num" data-label="м³">'+(totalM3?exFmt(totalM3):"")+'</td><td class="num" data-label="шт.">'+(totalPcs?exFmt(totalPcs):"")+'</td><td></td><td class="num" data-label="Без НДС">'+(totalNet?exMoney(totalNet):"")+'</td><td class="num" data-label="НДС">'+(totalVat?exMoney(totalVat):"")+'</td><td class="num" data-label="С НДС">'+(totalGross?exMoney(totalGross):"")+'</td><td></td><td></td></tr>'+
        '<tr class="ttn-add-row"><td colspan="'+cols+'"><button class="table-text-action" data-ttn-add-row type="button">+ Добавить строку</button></td></tr></tfoot>'
      : '<tfoot><tr class="ttn-total-row"><td colspan="2">ИТОГО</td><td class="num" data-label="шт.">'+(totalPcs?exFmt(totalPcs):"")+'</td><td class="num" data-label="м³">'+(totalM3?exFmt(totalM3):"")+'</td><td></td><td></td></tr>'+
        '<tr class="ttn-add-row"><td colspan="'+cols+'"><button class="table-text-action" data-ttn-add-row type="button">+ Добавить строку</button></td></tr></tfoot>';

    zone.innerHTML='<div class="ttn-grid-scroll"><table class="ttn-grid">'+head+'<tbody>'+body+'</tbody>'+foot+'</table></div>'+
      (green?supplyReconciliationHtml(existing):'<div class="ttn-inline-note">Белая ТТН фиксирует фактическое поступление в штуках; м³ рассчитываются по спецификации поставщика.</div>');

    zone.querySelector("[data-ttn-add-row]").onclick=function(){draftRows.push(blankRow());renderLines();};
    zone.querySelectorAll("[data-ttn-remove]").forEach(function(btn){
      btn.onclick=function(){
        const index=Number(btn.dataset.ttnRemove);
        draftRows.splice(index,1);
        if(!draftRows.length) draftRows.push(blankRow());
        renderLines();
      };
    });
    zone.querySelectorAll("[data-ttn-mark]").forEach(function(input){
      const index=Number(input.dataset.ttnMark);
      input.oninput=function(){
        draftRows[index].source_mark=input.value;
        draftRows[index].catalog_item_id=null;
        draftRows[index].supplier_item_id=null;
        draftRows[index].unit_volume_snapshot_m3="";
        openTtnSuggestions(input,"mark",draftRows[index],draftRows,renderLines);
      };
      input.onfocus=function(){openTtnSuggestions(input,"mark",draftRows[index],draftRows,renderLines);};
      input.onblur=function(){setTimeout(closeTtnSuggestions,150);};
    });
    zone.querySelectorAll("[data-ttn-name]").forEach(function(input){
      const index=Number(input.dataset.ttnName);
      input.oninput=function(){
        draftRows[index].source_name=input.value;
        draftRows[index].catalog_item_id=null;
        draftRows[index].supplier_item_id=null;
        draftRows[index].unit_volume_snapshot_m3="";
        openTtnSuggestions(input,"name",draftRows[index],draftRows,renderLines);
      };
      input.onfocus=function(){openTtnSuggestions(input,"name",draftRows[index],draftRows,renderLines);};
      input.onblur=function(){setTimeout(closeTtnSuggestions,150);};
    });
    zone.querySelectorAll("[data-ttn-pieces]").forEach(function(input){
      const index=Number(input.dataset.ttnPieces);
      input.onchange=function(){draftRows[index].qty_pieces=input.value;renderLines();};
    });
    zone.querySelectorAll("[data-ttn-m3]").forEach(function(input){
      const index=Number(input.dataset.ttnM3);
      input.onchange=function(){draftRows[index].qty_m3=input.value;renderLines();};
    });
    zone.querySelectorAll("[data-ttn-price]").forEach(function(input){
      const index=Number(input.dataset.ttnPrice);
      input.onchange=function(){draftRows[index].unit_price=input.value;renderLines();};
    });
  }

  async function save(){
    receiptDate=dateInput.value;
    ttnNumber=numberInput.value.trim();
    const payload=draftRows.map(rowPayload).filter(function(r){
      return r.source_mark||r.source_name||Number(r.qty_pieces||0)>0||Number(r.qty_m3||0)>0;
    });
    if(!receiptDate){status.textContent="Укажите дату поступления.";return;}
    if(type==="green"&&!ttnNumber){status.textContent="Для зелёной ТТН укажите номер.";return;}
    if(!payload.length){status.textContent="Добавьте хотя бы одну строку.";return;}
    status.textContent="Сохранение…";
    modal.querySelector("[data-ttn-save]").disabled=true;
    try{
      const result=await client.rpc("save_supply_document",{
        p_project_id:dataState.project.id,
        p_document_id:existing&&existing.id||null,
        p_document_type:type,
        p_receipt_date:receiptDate,
        p_ttn_number:type==="green"?ttnNumber:null,
        p_source_file_name:fileName||null,
        p_source_file_path:filePath||null,
        p_rows:payload
      });
      if(result.error) throw result.error;
      const documentId=result.data;

      if(pendingFile){
        const safeName=pendingFile.name.replace(/[^0-9A-Za-zА-Яа-яЁё._-]+/g,"_");
        const path=dataState.project.id+"/"+documentId+"/"+Date.now()+"-"+safeName;
        const upload=await client.storage.from("supply-documents").upload(path,pendingFile,{upsert:false});
        if(upload.error) throw upload.error;
        const upd=await client.from("supply_documents").update({
          source_file_name:pendingFile.name,
          source_file_path:path,
          updated_at:new Date().toISOString()
        }).eq("id",documentId).eq("project_id",dataState.project.id);
        if(upd.error) throw upd.error;
        if(filePath&&filePath!==path) client.storage.from("supply-documents").remove([filePath]).catch(function(){});
      }

      await refreshProjectDataSlices(["supplyDocuments","supplyDocumentLines","supplyLineAllocations"],dataState.project);
      closeTtnSuggestions();
      backdrop.classList.remove("open");
      backdrop.innerHTML="";
      renderPage("supply",1);
    }catch(err){
      status.textContent=err&&err.message?err.message:String(err);
      modal.querySelector("[data-ttn-save]").disabled=false;
    }
  }

  syncHeader();
  renderLines();

  modal.querySelector(".ttn-close").onclick=function(){closeTtnSuggestions();backdrop.classList.remove("open");backdrop.innerHTML="";};
  modal.querySelector("[data-ttn-cancel]").onclick=modal.querySelector(".ttn-close").onclick;
  backdrop.onclick=function(e){if(e.target===backdrop) modal.querySelector(".ttn-close").click();};
  modal.querySelectorAll("[data-ttn-type]").forEach(function(btn){
    btn.onclick=function(){
      type=btn.dataset.ttnType;
      syncHeader();
      renderLines();
    };
  });
  dateInput.onchange=function(){receiptDate=dateInput.value;};
  numberInput.oninput=function(){ttnNumber=numberInput.value;};
  fileAction.onclick=function(){fileInput.click();};
  fileInput.onchange=function(){pendingFile=fileInput.files&&fileInput.files[0]||null;syncHeader();};
  modal.querySelector("[data-ttn-save]").onclick=save;
}
