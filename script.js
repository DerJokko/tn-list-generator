/* TSV → grouped PDF exporter
   Features:
   - load TSV from file or example `tests/input.tsv`
   - choose columns to export
   - choose one column as grouping
   - choose one main group to display first; others alphabetical
   - flag columns as: Ausgeblendet, Spalte, Zähler, Sonstiges
   - Sonstiges columns are combined into one "Sonstiges" column
   - Zähler columns produce counts appended at the end of the PDF
   - mark rows as SiFü (checkbox) — SiFü rows are bold in PDF
   - PDF export: landscape, thinner lines, blue header, two-column layout side-by-side
*/

let headers = [];
let rows = []; // array of {cells: [], siFu: boolean}

const fileInput = document.getElementById('fileInput');
const loadExample = document.getElementById('loadExample');
const columnsDiv = document.getElementById('columns');
const tableContainer = document.getElementById('tableContainer');
const exportBtn = document.getElementById('exportPdf');
const groupingInfo = document.getElementById('groupingInfo');
const mainGroupContainer = document.getElementById('mainGroupContainer');
const pdfTitleCard = document.getElementById('pdfTitleCard');
let selectedMainValue = '';
const geldToggle = document.getElementById('geldToggle');
// state for Sonstiges value selections: { colIdx: Set(selectedValues) }
let othersSelections = {};

fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  const text = await f.text();
  handleTSV(text);
});

loadExample.addEventListener('click', async ()=>{
  try{
    const resp = await fetch('tests/input.tsv');
    if(!resp.ok) throw new Error('Fetch failed');
    const txt = await resp.text();
    handleTSV(txt);
  }catch(err){
    alert('Beispiel konnte nicht geladen werden. Lade eine Datei manuell.');
    console.error(err);
  }
});

function parseTSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length>0);
  if(lines.length===0) return {headers:[],rows:[]};
  const hdr = lines[0].split('\t');
  const data = lines.slice(1).map(l=>l.split('\t'));
  return {headers:hdr,rows:data};
}

function handleTSV(text){
  const parsed = parseTSV(text);
  headers = parsed.headers;
  rows = parsed.rows.map(cells=>({cells, siFu:false, geld:false}));
  renderColumnControls();
  renderMainGroupOptions();
  renderPreview();
  exportBtn.disabled = false;
}

function renderColumnControls(){
  columnsDiv.innerHTML = '';
  const list = document.createElement('div'); list.className = 'col-list';
  headers.forEach((h,idx)=>{
    const wrap = document.createElement('div'); wrap.className='col-item';

    // top row: radio + column name
    const top = document.createElement('div'); top.className = 'top-row';
    const rb = document.createElement('input'); rb.type='radio'; rb.name='grouping'; rb.dataset.colIndex=idx;
    rb.addEventListener('change', ()=>{ groupingInfo.textContent = headers[idx]; renderMainGroupOptions(); renderPreview(); });
    const title = document.createElement('span'); title.textContent = h;
    top.appendChild(rb); top.appendChild(title);

    // flags row
    const flagsRow = document.createElement('div'); flagsRow.className = 'flags-row';
    const flags = ['hidden','col','count','others'];
    flags.forEach(f=>{
      const lbl = document.createElement('label'); lbl.className='flag-btn'; lbl.classList.add('flag-'+f);
      const inp = document.createElement('input'); inp.type='checkbox'; inp.dataset.colIndex=idx; inp.dataset.flag=f; inp.style.display='none';
      // default: Ausgeblendet checked
      if(f==='hidden') inp.checked = true;
      inp.addEventListener('change', ()=>{
        if(inp.checked) lbl.classList.add('active'); else lbl.classList.remove('active');
        // enforce hidden vs col mutual exclusivity
        if(f==='hidden' && inp.checked){ const colinp = wrap.querySelector('input[data-flag="col"]'); if(colinp){ colinp.checked = false; colinp.dispatchEvent(new Event('change')); } }
        if(f==='col' && inp.checked){ const hid = wrap.querySelector('input[data-flag="hidden"]'); if(hid){ hid.checked = false; hid.dispatchEvent(new Event('change')); } }
        renderPreview();
      });
      const span = document.createElement('span'); span.textContent = (f==='hidden'? 'Ausgeblendet' : f==='col'? 'Eingeblendet' : f==='count'? 'Zähler' : 'Sonstiges');
      lbl.appendChild(inp); lbl.appendChild(span); flagsRow.appendChild(lbl);
      if(inp.checked) lbl.classList.add('active');
    });

    wrap.appendChild(top);
    wrap.appendChild(flagsRow);
    list.appendChild(wrap);
  });
  columnsDiv.appendChild(list);
}

function getColumnFlags(idx){
  const inputs = Array.from(columnsDiv.querySelectorAll('input[data-col-index="'+idx+'"]'));
  const res = {col:false,count:false,others:false,hidden:false};
  inputs.forEach(i=>{ const f = i.dataset.flag; if(f) res[f]= !!i.checked; });
  return res;
}

function getSelectedColumnIndexes(){
  // columns that are marked as Eingeblendet (Spalte) and not hidden
  return headers.map((_,i)=>i).filter(i=>{
    const f = getColumnFlags(i); return !!f.col && !f.hidden;
  });
}

function getGroupingIndex(){
  const rb = columnsDiv.querySelector('input[type=radio]:checked');
  return rb ? Number(rb.dataset.colIndex) : -1;
}

function renderMainGroupOptions(){
  mainGroupContainer.innerHTML = '';
  const grouping = getGroupingIndex();
  selectedMainValue = '';
  if(grouping<0) return;
  const seen = Array.from(new Set(rows.map(r=> r.cells[grouping] ?? ''))).sort((a,b)=> String(a).localeCompare(String(b),'de'));
  seen.forEach(k=>{
    const btn = document.createElement('button'); btn.type='button'; btn.textContent = k || '(leer)';
    btn.addEventListener('click', ()=>{
      selectedMainValue = (selectedMainValue===k) ? '' : k;
      Array.from(mainGroupContainer.children).forEach(c=>c.classList.remove('active'));
      if(selectedMainValue) btn.classList.add('active');
      renderPreview();
    });
    mainGroupContainer.appendChild(btn);
  });
}

function renderPreview(){
  tableContainer.innerHTML = '';
  if(!headers.length) return;
  const selected = getSelectedColumnIndexes();
  const grouping = getGroupingIndex();
  if(selected.length===0){ tableContainer.textContent = 'Keine Spalten ausgewählt.'; return; }
  if(grouping<0){ tableContainer.textContent = 'Bitte Gruppierung auswählen.'; return; }

  const sonIndices = headers.map((_,i)=>i).filter(i=> getColumnFlags(i).others && !getColumnFlags(i).hidden);

  // ensure othersSelections exist for current Sonstiges columns
  ensureOthersSelections(sonIndices);

  // build groups
  const groups = new Map();
  rows.forEach(r=>{
    const key = grouping>=0 ? (r.cells[grouping] ?? '') : '';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  // ordering
  const selectedMain = selectedMainValue || '';
  const otherKeys = Array.from(groups.keys()).filter(k=> k !== selectedMain).sort((a,b)=> String(a).localeCompare(String(b), 'de'));
  const order = [];
  if(selectedMain && groups.has(selectedMain)) order.push(selectedMain);
  order.push(...otherKeys);

  const table = document.createElement('table');
  table.className = 'preview';
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  hrow.appendChild(document.createElement('th')).textContent = 'SiFü';
  // headers: visible normal columns (left), Sonstiges, grouping (rightmost)
  const selectedNormal = selected.filter(ci=> !sonIndices.includes(ci));
  const afterCols = selectedNormal.filter(ci=> ci !== grouping);
  // adjust preview header if Geld column is enabled
  if(geldToggle && geldToggle.checked){
    hrow.appendChild(document.createElement('th')).textContent = 'Geld';
  }
  afterCols.forEach(ci=>{ const th=document.createElement('th'); th.textContent = headers[ci]; hrow.appendChild(th); });
  if(sonIndices.length>0){ const th=document.createElement('th'); th.textContent = 'Sonstiges'; hrow.appendChild(th); }
  // group column rightmost
  hrow.appendChild(document.createElement('th')).textContent = headers[grouping];
  thead.appendChild(hrow); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for(const key of order){
    const groupRows = groups.get(key) || [];
    groupRows.sort((a,b)=> (a.siFu===b.siFu)?0:(a.siFu? -1:1));
    const siCount = groupRows.filter(r=>r.siFu).length;
    const restCount = groupRows.length - siCount;

    // group header row
    const gh = document.createElement('tr');
    const gcell = document.createElement('td');
    const colCount = 1 + (geldToggle && geldToggle.checked ? 1 : 0) + afterCols.length + (sonIndices.length>0?1:0) + 1; // SiFü + optional Geld + visible cols + Sonstiges + group
    gcell.colSpan = colCount;
    gcell.style.fontWeight = '600';
    gcell.textContent = `${String(key || '(leer)')}\n${siCount} + ${restCount}`;
    gh.appendChild(gcell); tbody.appendChild(gh);

    groupRows.forEach(r=>{
      const tr = document.createElement('tr');

      // SiFü checkbox cell
      const tdSi = document.createElement('td');
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!r.siFu;
      cb.addEventListener('change', ()=>{ r.siFu = cb.checked; renderPreview(); });
      tdSi.appendChild(cb); tr.appendChild(tdSi);

      // Geld checkbox cell (optional)
      if(geldToggle && geldToggle.checked){
        const tdG = document.createElement('td');
        const gcb = document.createElement('input'); gcb.type='checkbox'; gcb.checked = !!r.geld;
        gcb.addEventListener('change', ()=>{ r.geld = gcb.checked; renderPreview(); });
        tdG.appendChild(gcb); tr.appendChild(tdG);
      }

      // visible normal columns
      afterCols.forEach(ci=>{ const td=document.createElement('td'); td.textContent = r.cells[ci] ?? ''; if(r.siFu) td.style.fontWeight = '600'; tr.appendChild(td); });

      // Sonstiges combined cell (render chips per son column)
      if(sonIndices.length>0){
        const td = document.createElement('td');
        sonIndices.forEach(ci=>{
          const raw = (r.cells[ci]||'').trim();
          if(!raw) return;
          const span = document.createElement('span'); span.className = 'other-value';
          const selSet = othersSelections[ci] || new Set();
          const isSelected = selSet.size===0 || selSet.has(raw);
          span.textContent = raw;
          span.dataset.col = ci; span.dataset.val = raw;
          span.classList.add(isSelected? 'selected':'deselected');
          span.addEventListener('click', ()=>{ toggleOtherValue(ci, raw); });
          td.appendChild(span); td.appendChild(document.createTextNode(' '));
        });
        tr.appendChild(td);
      }

      // group value (rightmost)

      const tg = document.createElement('td'); tg.textContent = r.cells[grouping] ?? ''; tr.appendChild(tg);

      if(r.siFu){ tg.style.fontWeight = '600'; }

      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  tableContainer.appendChild(table);

  // removed summary controls for Sonstiges values (inline chips remain in preview)
}

function ensureOthersSelections(sonIndices){
  // build set of all values for each son index if not present
  sonIndices.forEach(ci=>{
    if(!(ci in othersSelections)){
      const vals = new Set();
      rows.forEach(r=>{ const v = (r.cells[ci]||'').trim(); if(v) vals.add(v); });
      othersSelections[ci] = new Set(Array.from(vals));
    }
  });
  // remove selections for columns no longer Sonstiges
  Object.keys(othersSelections).map(Number).forEach(k=>{ if(!sonIndices.includes(k)) delete othersSelections[k]; });
}

function toggleOtherValue(colIdx, val){
  if(!(colIdx in othersSelections)) othersSelections[colIdx] = new Set();
  const s = othersSelections[colIdx];
  if(s.has(val)) s.delete(val); else s.add(val);
  renderPreview();
}

exportBtn.addEventListener('click', async ()=>{
  const selected = getSelectedColumnIndexes();
  const grouping = getGroupingIndex();
  if(grouping<0){ alert('Bitte eine Gruppierungs-Spalte auswählen.'); return; }
  if(selected.length===0){ alert('Bitte mindestens eine Spalte zum Export auswählen.'); return; }

  // Sonstiges columns: those flagged 'others' and not hidden
  const sonIndices = headers.map((_,i)=>i).filter(i=> getColumnFlags(i).others && !getColumnFlags(i).hidden);
  // Zähler columns: any column flagged 'count' (even if hidden)
  const countIndices = headers.map((_,i)=>i).filter(i=> getColumnFlags(i).count);
  let normalSelected = selected.filter(ci=> !sonIndices.includes(ci));
  if(grouping>=0 && !normalSelected.includes(grouping) && !sonIndices.includes(grouping)){
    normalSelected.unshift(grouping);
  }

  // build groups map
  const groups = new Map();
  rows.forEach(r=>{
    const key = r.cells[grouping] ?? '';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  // determine order with main first then alphabetical
  const selectedMain = selectedMainValue || '';
  const otherKeys = Array.from(groups.keys()).filter(k=> k !== selectedMain).sort((a,b)=> String(a).localeCompare(String(b), 'de'));
  const order = [];
  if(selectedMain && groups.has(selectedMain)) order.push(selectedMain);
  order.push(...otherKeys);

  // prepare head: visible columns first, Sonstiges combined, group column last
  const colsAfterGroup = normalSelected.filter(ci=> ci !== grouping);
  const head = [];
  colsAfterGroup.forEach(ci=> head.push(headers[ci]));
  // Geld column as first column in export
  head.unshift('Geld');
  if(sonIndices.length>0) head.push('Sonstiges');
  head.push(headers[grouping]);

  // Build an array of groups (rows + meta)
  const groupsArr = [];
  for(const key of order){
    const groupRows = groups.get(key) || [];
    groupRows.sort((a,b)=> (a.siFu===b.siFu)?0:(a.siFu? -1:1));
    const siCount = groupRows.filter(r=>r.siFu).length;
    const restCount = groupRows.length - siCount;
    const span = groupRows.length;
    const rowsForGroup = groupRows.map((r,ri)=>{
      const firstOfGroup = ri===0;
      const row = [];
      // Geld cell as first column in export rows (use 'Ja'/'Nein')
      row.push(r.geld ? 'Ja' : 'Nein');
      colsAfterGroup.forEach(ci=> row.push(r.cells[ci] ?? ''));
      if(sonIndices.length>0){
        const vals = [];
        sonIndices.forEach(ci=>{ const raw = (r.cells[ci]||'').trim(); if(raw){ const sel = othersSelections[ci]; if(!sel || sel.size===0 || sel.has(raw)) vals.push(raw); } });
        row.push(vals.join(', '));
      }
      row.push(firstOfGroup ? `${String(key || '(leer)')}\n${siCount} + ${restCount}` : '');
      return { row, meta: { siFu: r.siFu, isFirst: firstOfGroup, span } };
    });
    groupsArr.push({ key, rows: rowsForGroup, span });
  }

  // Partition groups into two columns (greedy balance by span)
  const leftGroups = [], rightGroups = [];
  let leftCount = 0, rightCount = 0;
  groupsArr.forEach(gobj=>{
    if(leftCount <= rightCount){ leftGroups.push(gobj); leftCount += gobj.span; }
    else { rightGroups.push(gobj); rightCount += gobj.span; }
  });

  function flattenGroupsToBody(groupsList){
    const body = [];
    const meta = [];
    groupsList.forEach(g=>{
      g.rows.forEach(r=>{ body.push(r.row); meta.push(r.meta); });
    });
    return { body, meta };
  }

  const left = flattenGroupsToBody(leftGroups);
  const right = flattenGroupsToBody(rightGroups);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let title = 'export';
  if(pdfTitleCard){ const txt = (pdfTitleCard.innerText || pdfTitleCard.textContent || '').trim(); if(txt.length>0) title = txt; }
  doc.setFontSize(12);
  doc.text(title, 14, 12);

  const pageW = doc.internal.pageSize.getWidth();
  const margin = { left: 14, right: 12 };
  const gap = 8;
  const tableWidth = (pageW - margin.left - margin.right - gap) / 2;
  // Combine left and right into a single side-by-side table to ensure they render next to each other
  // Build a single stacked table with all groups in order
  const all = flattenGroupsToBody(groupsArr);
  // (keep meta for per-row info) we'll draw separators before group starts (except the very first)
  if(all.body.length > 0){
    doc.autoTable({
      startY: 18,
      startX: margin.left,
      head: [head],
      body: all.body,
      tableWidth: pageW - margin.left - margin.right,
      styles: { fontSize: 8, cellPadding: 1.2, lineWidth: 0.2 },
      headStyles: { fillColor: [7,90,160], textColor: 255 },
      tableLineWidth: 0.2,
      theme: 'grid',
      rowPageBreak: 'auto',
      didParseCell: function(data){
        if(data.section !== 'body') return;
        const m = all.meta[data.row.index];
        // Geld column coloring: index 0
        if(data.column.index === 0){ const txt = (data.cell.text || '').toString().toLowerCase(); if(txt.indexOf('ja')>=0) data.cell.styles.textColor = [46,139,87]; else data.cell.styles.textColor = [204,43,43]; }
        // determine normal value column range (exclude Geld at 0, Sonstiges if present, and group last column)
        const groupCol = head.length - 1;
        const sonCol = (sonIndices.length>0) ? head.length - 2 : -1;
        const firstNormal = 1;
        const lastNormal = (sonCol !== -1) ? sonCol - 1 : groupCol - 1;
        if(m && m.siFu && data.column >= firstNormal && data.column <= lastNormal){ data.cell.styles.fontStyle = 'bold'; }
        // group column is last: set rowSpan for first of group, otherwise clear
        if(data.column.index === groupCol){ if(m && m.isFirst) data.cell.rowSpan = m.span; else data.cell.text = ''; }
      },
      didDrawCell: function(data){
        if(data.section !== 'body') return;
        // overlay bold text for normal SiFü columns (autoTable may not render bold reliably)
        const groupCol = head.length - 1;
        const sonCol = (sonIndices.length>0) ? head.length - 2 : -1;
        const firstNormal = 1;
        const lastNormal = (sonCol !== -1) ? sonCol - 1 : groupCol - 1;
        const m = all.meta[data.row.index];
        if(m && m.siFu && data.column >= firstNormal && data.column <= lastNormal){
          try{
            const txt = Array.isArray(data.cell.text) ? data.cell.text.join(' ') : (data.cell.text || '');
            doc.setFont('helvetica','bold');
            doc.text(String(txt), data.cell.textPos.x, data.cell.textPos.y);
            doc.setFont('helvetica','normal');
          }catch(e){ /* ignore drawing errors */ }
        }

        // draw thick filled separator above group start rows (except overall first row)
        if(m && m.isFirst && data.column.index === groupCol && data.row.index > 0){
          const y = data.cell.y; // slightly above the cell
          // align separator to the actual table start/width when available
          const startX = (data.table && data.table.startX) ? data.table.startX : margin.left;
          const width = (data.table && data.table.width) ? data.table.width : (pageW - margin.left - margin.right);
          try{
            doc.setFillColor(0,0,0);
            // rectangle height controls thickness; reduce to 0.4 for half thickness
            doc.rect(startX, y, width, 0.2, 'F');
          }catch(e){ /* ignore */ }
        }
      }
    });
  }

  // append count summaries (Zähler)
  let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 18;
  const pageH = doc.internal.pageSize.getHeight();
  if(countIndices.length>0){
    if(y > pageH - 40){ doc.addPage(); y = 14; }
    for(const ci of countIndices){
      const freq = new Map();
      rows.forEach(r=>{
        const v = (r.cells[ci] ?? '').trim() || '(leer)';
        freq.set(v, (freq.get(v)||0)+1);
      });
      const items = Array.from(freq.entries()).sort((a,b)=> b[1]-a[1]);
      doc.setFontSize(10); doc.text(headers[ci], 14, y); y += 5;
      items.forEach(([val,count])=>{
        const line = `- ${count}x  ${val}`;
        doc.setFontSize(9); doc.text(line, 18, y); y += 5;
        if(y > pageH - 20){ doc.addPage(); y = 14; }
      });
      y += 4;
    }
  }

  doc.save(title + '.pdf');
});
