document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const uploadArea = document.getElementById('uploadArea');
  const resultsSection = document.getElementById('resultsSection');
  const sitesContainer = document.getElementById('sitesContainer');

  let globalSitesData = [];
  let historyStack = [];
  let expandedSiteIndex = -1;
  let searchQuery = '';
  window.selectedItemIds = new Set();
  window.globalCategories = new Set(['잡자재', '안전자재', '기타자재', '쇼핑몰']);
  window.STANDARD_CATEGORIES = ['잡자재', '안전자재', '기타자재', '쇼핑몰'];
  window.currentTab = '전체';
  window.categoryMemory = {};

  // #5 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); window.undoAction(); }
    if (e.key === 'Escape') { const m=document.getElementById('siteModal'); if(m&&m.style.display==='flex') window.closeSiteModal(); }
  });

  window.setFilterTab = function(tabName) { window.currentTab=tabName; window.selectedItemIds.clear(); updateFloatingBar(); renderResults(); };

  function generateId() { return 'item_' + Math.random().toString(36).substr(2, 9); }

  const parseNum = (val) => {
    if (val === "" || val == null) return NaN;
    let s = String(val).replace(/,/g, '').trim();
    if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
    else if (/^[△▲]|(\(-\))/.test(s)) s = '-' + s.replace(/^[△▲]|(\(-\))/g, '');
    return Number(s);
  };
  const formatNum = (val) => { if (val === "" || val == null) return ""; let n = parseNum(val); return isNaN(n) ? val : n.toLocaleString('ko-KR'); };

  function saveState() { historyStack.push(JSON.parse(JSON.stringify(globalSitesData))); if (historyStack.length > 30) historyStack.shift(); }

  window.undoAction = function() {
    if (historyStack.length === 0) return alert('취소할 작업이 없습니다.');
    globalSitesData = historyStack.pop(); window.selectedItemIds.clear(); updateFloatingBar(); renderResults();
  };

  window.toggleItem = function(itemId, isChecked) {
    if (isChecked) window.selectedItemIds.add(itemId); else window.selectedItemIds.delete(itemId);
    updateFloatingBar();
  };

  window.toggleAllSiteItems = function(si, isChecked) {
    const site=globalSitesData[si]; if(!site) return;
    const items=site.filteredItems||site.items;
    items.forEach(it => { if(isChecked) window.selectedItemIds.add(it.id); else window.selectedItemIds.delete(it.id); });
    document.querySelectorAll('.item-checkbox').forEach(cb => { if(items.some(it=>it.id===cb.dataset.id)) cb.checked=isChecked; });
    updateFloatingBar();
  };

  window.selectAllUnclassified = function() {
    globalSitesData.forEach(s => s.items.forEach(it => { if(!it.category) window.selectedItemIds.add(it.id); }));
    updateFloatingBar(); renderResults();
  };
  window.selectSiteUnclassified = function(si) {
    const site=globalSitesData[si]; if(!site) return;
    site.items.forEach(it => { if(!it.category) window.selectedItemIds.add(it.id); });
    updateFloatingBar(); renderResults();
  };

  function updateFloatingBar() {
    const bar=document.getElementById('floatingActionBar'), countSpan=document.getElementById('floatingSelectedCount'), select=document.getElementById('moveSiteSelect');
    if (window.selectedItemIds.size > 0) {
      countSpan.textContent=window.selectedItemIds.size+'건 선택됨';
      const cv=select.value; select.innerHTML='';
      globalSitesData.forEach(s=>{const o=document.createElement('option');o.value=o.textContent=s.siteName;select.appendChild(o);});
      const co=document.createElement('option');co.value='__CUSTOM__';co.textContent='직접 입력...';select.appendChild(co);
      if(cv&&Array.from(select.options).some(o=>o.value===cv))select.value=cv;
      window.handleFloatingSelectChange();
      const bs=document.getElementById('bulkCategorySelect');
      if(bs){const bv=bs.value;bs.innerHTML='';window.globalCategories.forEach(c=>{const o=document.createElement('option');o.value=o.textContent=c;bs.appendChild(o);});const cc=document.createElement('option');cc.value='__CUSTOM__';cc.textContent='직접 입력...';bs.appendChild(cc);if(bv&&Array.from(bs.options).some(o=>o.value===bv))bs.value=bv;window.handleBulkCategorySelect();}
      bar.classList.add('visible');
    } else { bar.classList.remove('visible'); }
  }

  window.handleBulkCategorySelect = function() { const s=document.getElementById('bulkCategorySelect'),i=document.getElementById('customBulkCategory'); if(s.value==='__CUSTOM__'){i.style.display='inline-block';i.focus();}else{i.style.display='none';i.value='';} };
  window.executeBulkCategory = function() {
    if(window.selectedItemIds.size===0)return;
    const s=document.getElementById('bulkCategorySelect'),ci=document.getElementById('customBulkCategory');
    let tc=s.value;if(tc==='__CUSTOM__'){tc=ci.value.trim();if(!tc)return alert('분류명을 텍스트 칸에 입력해주세요.');window.globalCategories.add(tc);}
    saveState();
    globalSitesData.forEach(site=>site.items.forEach(item=>{if(window.selectedItemIds.has(item.id)){item.category=tc;window.categoryMemory[item.itemName]=tc;}}));
    window.selectedItemIds.clear();updateFloatingBar();renderResults();
  };
  window.handleFloatingSelectChange = function() { const s=document.getElementById('moveSiteSelect'),i=document.getElementById('customMoveSiteName'); if(s.value==='__CUSTOM__'){i.style.display='inline-block';i.focus();}else{i.style.display='none';i.value='';} };
  window.executeDelete = function() {
    if(window.selectedItemIds.size===0)return;
    if(!confirm('선택한 '+window.selectedItemIds.size+'개의 내역을 정말 삭제하시겠습니까?'))return;
    saveState();
    for(let i=globalSitesData.length-1;i>=0;i--){globalSitesData[i].items=globalSitesData[i].items.filter(it=>!window.selectedItemIds.has(it.id));if(!globalSitesData[i].items.length)globalSitesData.splice(i,1);}
    window.selectedItemIds.clear();updateFloatingBar();renderResults();
  };
  window.executeMove = function() {
    if(window.selectedItemIds.size===0)return;
    const s=document.getElementById('moveSiteSelect'),ci=document.getElementById('customMoveSiteName');
    let tn=s.value;if(tn==='__CUSTOM__'){tn=ci.value.trim();if(!tn)return alert('현장명을 입력해주세요.');}
    saveState();const itm=[];
    for(let i=globalSitesData.length-1;i>=0;i--){const r=[];globalSitesData[i].items.forEach(it=>{if(window.selectedItemIds.has(it.id))itm.push(it);else r.push(it);});globalSitesData[i].items=r;if(!r.length)globalSitesData.splice(i,1);}
    let tgt=globalSitesData.find(s=>s.siteName===tn);
    if(!tgt){tgt={siteName:tn,items:[],sortConfig:[{col:'date',asc:true},{col:'seqNo',asc:true}]};globalSitesData.unshift(tgt);}
    tgt.items.push(...itm);
    tgt.items.sort((a,b)=>{let d=String(a.date||"").localeCompare(String(b.date||""));return d!==0?d:(parseInt(a.seqNo)||0)-(parseInt(b.seqNo)||0);});
    tgt.sortConfig=[{col:'date',asc:true},{col:'seqNo',asc:true}];
    window.selectedItemIds.clear();updateFloatingBar();renderResults();
  };
  window.clearSelection = function() { window.selectedItemIds.clear(); document.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); updateFloatingBar(); };

  window.recalculateAllSites = function() {
    globalSitesData.forEach(site=>{
      const groups={};
      site.items.forEach(item=>{const key=(item.date||"")+"-"+(item.seqNo||"");if(!groups[key])groups[key]={total:0,purchaseItemId:null,lastItem:null};const sn=parseNum(item.sales);if(!isNaN(sn))groups[key].total+=sn;if(item.purchase!==""&&item.purchase!=null)groups[key].purchaseItemId=item.id;groups[key].lastItem=item.id;});
      site.items.forEach(item=>{const key=(item.date||"")+"-"+(item.seqNo||"");const g=groups[key];if(g.purchaseItemId===item.id)item.purchase=formatNum(g.total);else if(!g.purchaseItemId&&g.lastItem===item.id){item.purchase=formatNum(g.total);g.purchaseItemId=item.id;}else item.purchase="";});
    });
  };

  window.editSiteName = function(si,el) {
    if(el.querySelector('input'))return;
    const site=globalSitesData[si],orig=site.siteName;
    const inp=document.createElement('input');inp.type='text';inp.value=orig;inp.className='inline-edit-input site-name-input';
    el.innerHTML='';el.appendChild(inp);inp.focus();
    const fin=()=>{const nv=inp.value.trim();if(nv&&nv!==orig){saveState();site.siteName=nv;}renderResults();};
    inp.addEventListener('blur',fin);inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=orig;inp.blur();}});
  };

  window.editCategoryField = function(itemId,td) {
    if(td.querySelector('select')||td.querySelector('input'))return;
    let ti=null;for(let s of globalSitesData){ti=s.items.find(i=>i.id===itemId);if(ti)break;}if(!ti)return;
    const ov=ti.category||'';
    const sel=document.createElement('select');sel.className='form-select inline-edit-input';
    const eo=document.createElement('option');eo.value='';eo.textContent='선택 안 함';sel.appendChild(eo);
    window.globalCategories.forEach(c=>{const o=document.createElement('option');o.value=o.textContent=c;sel.appendChild(o);});
    const suggested=window.categoryMemory[ti.itemName];
    if(suggested&&!window.globalCategories.has(suggested)){window.globalCategories.add(suggested);const so=document.createElement('option');so.value=so.textContent=suggested;sel.appendChild(so);}
    const co=document.createElement('option');co.value='__CUSTOM__';co.textContent='직접입력...';sel.appendChild(co);
    if(ov&&window.globalCategories.has(ov))sel.value=ov;else if(ov){window.globalCategories.add(ov);sel.value=ov;}else if(suggested)sel.value=suggested;else sel.value='';
    td.innerHTML='';td.appendChild(sel);sel.focus();
    const apply=(v)=>{const nv=v.trim();if(nv!==ov){saveState();ti.category=nv;if(nv){window.globalCategories.add(nv);window.categoryMemory[ti.itemName]=nv;}}renderResults();};
    sel.addEventListener('change',()=>{if(sel.value==='__CUSTOM__'){const inp=document.createElement('input');inp.type='text';inp.className='inline-edit-input';td.innerHTML='';td.appendChild(inp);inp.focus();inp.addEventListener('blur',()=>apply(inp.value));inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape')apply(ov);});}else apply(sel.value);});
    sel.addEventListener('blur',()=>{if(sel.parentNode===td&&sel.value!=='__CUSTOM__')apply(sel.value);});
    sel.addEventListener('keydown',e=>{if(e.key==='Escape')apply(ov);});
  };

  window.editItemField = function(itemId,field,td) {
    if(td.querySelector('input'))return;
    let ti=null;for(let s of globalSitesData){ti=s.items.find(i=>i.id===itemId);if(ti)break;}if(!ti)return;
    let ov=ti[field];if(ov==null)ov="";
    const inp=document.createElement('input');inp.type='text';inp.value=ov;inp.className='inline-edit-input';
    td.innerHTML='';td.appendChild(inp);inp.focus();
    const fin=()=>{const nv=inp.value.trim();if(nv!==String(ov)){saveState();ti[field]=(field==='qty'||field==='unitPrice'||field==='sales')?formatNum(nv):nv;if(field==='sales'||field==='date'||field==='seqNo')window.recalculateAllSites();}renderResults();};
    inp.addEventListener('blur',fin);inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=String(ov);inp.blur();}});
  };

  window.handleTableSort = function(si,col) {
    const site=globalSitesData[si];if(!site.sortConfig)site.sortConfig=[];
    let idx=site.sortConfig.findIndex(c=>c.col===col);
    if(idx>=0){site.sortConfig[idx].asc=!site.sortConfig[idx].asc;site.sortConfig.unshift(site.sortConfig.splice(idx,1)[0]);}
    else site.sortConfig.unshift({col,asc:true});
    site.items.sort((a,b)=>{for(let sc of site.sortConfig){let vA=a[sc.col]||"",vB=b[sc.col]||"",cmp=0;if(['seqNo','qty','unitPrice','sales','purchase'].includes(sc.col))cmp=(parseNum(vA)||0)-(parseNum(vB)||0);else cmp=String(vA).localeCompare(String(vB));if(cmp!==0)return sc.asc?cmp:-cmp;}return 0;});
    renderResults();
  };

  window.handleChipDragStart=function(e,i){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('sourceIndex',i);setTimeout(()=>e.target.classList.add('dragging'),0);};
  window.handleChipDragEnd=function(e){e.target.classList.remove('dragging');};
  window.handleChipDragOver=function(e){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('drag-over-chip');};
  window.handleChipDragLeave=function(e){e.currentTarget.classList.remove('drag-over-chip');};
  window.handleChipDrop=function(e,ti){e.preventDefault();e.currentTarget.classList.remove('drag-over-chip');const si=parseInt(e.dataTransfer.getData('sourceIndex'),10);if(isNaN(si)||si===ti)return;const src=globalSitesData[si],tgt=globalSitesData[ti];if(confirm('"'+src.siteName+'"→"'+tgt.siteName+'" 병합하시겠습니까?')){saveState();tgt.items.push(...src.items);tgt.items.sort((a,b)=>{let d=String(a.date||"").localeCompare(String(b.date||""));return d!==0?d:(parseInt(a.seqNo)||0)-(parseInt(b.seqNo)||0);});tgt.sortConfig=[{col:'date',asc:true},{col:'seqNo',asc:true}];globalSitesData.splice(si,1);updateFloatingBar();renderResults();}};

  let amountSortAsc=false,nameSortAsc=true;
  window.sortByAmount=function(){globalSitesData.sort((a,b)=>{let aT=a.filteredTotalPurchase||0,bT=b.filteredTotalPurchase||0;return amountSortAsc?aT-bT:bT-aT;});amountSortAsc=!amountSortAsc;renderResults();};
  window.sortByName=function(){globalSitesData.sort((a,b)=>nameSortAsc?a.siteName.localeCompare(b.siteName):b.siteName.localeCompare(a.siteName));nameSortAsc=!nameSortAsc;renderResults();};
  window.toggleAccordion=function(si){expandedSiteIndex=(expandedSiteIndex===si)?-1:si;renderResults();};
  window.handleSearch=function(val){searchQuery=val.trim().toLowerCase();renderResults();};

  window.openSiteModal=function(si){
    const modal=document.getElementById('siteModal'),title=document.getElementById('siteModalTitle'),body=document.getElementById('siteModalBody');
    modal.dataset.siteIndex=si;
    if(si===-1){title.textContent='📊 전체 현장 내역';let h='';globalSitesData.forEach((s,idx)=>{if(window.currentTab!=='전체'&&(!s.filteredItems||!s.filteredItems.length))return;h+='<div style="margin-bottom:1.5rem;"><h4 style="color:var(--primary);margin:0 0 0.5rem;padding-bottom:0.5rem;border-bottom:2px solid var(--primary-fixed);">'+s.siteName+'</h4>'+buildSiteTable(s,idx)+'</div>';});body.innerHTML=h;}
    else{const s=globalSitesData[si];if(!s)return;title.textContent=s.siteName;body.innerHTML=buildSiteTable(s,si);}
    modal.style.display='flex';document.body.style.overflow='hidden';
  };
  window.closeSiteModal=function(){document.getElementById('siteModal').style.display='none';document.body.style.overflow='';renderResults();};

  /* ===== Excel Parsing ===== */
  window.addEventListener('dragover',e=>e.preventDefault());
  window.addEventListener('drop',e=>e.preventDefault());
  uploadArea.addEventListener('dragover',e=>{e.preventDefault();uploadArea.classList.add('drag-over');});
  uploadArea.addEventListener('dragleave',()=>uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop',e=>{e.preventDefault();uploadArea.classList.remove('drag-over');if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;handleFile(fileInput.files[0]);}});
  fileInput.addEventListener('change',e=>{if(e.target.files.length)handleFile(e.target.files[0]);});

  function handleFile(file) {
    const reader=new FileReader();
    reader.onload=e=>{try{const data=new Uint8Array(e.target.result);const wb=XLSX.read(data,{type:'array'});processData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""}));}catch(err){alert("엑셀 파싱 오류");}};
    reader.readAsArrayBuffer(file);
  }

  function processData(rows) {
    if(!rows.length)return;
    let headerRowIdx=-1,colMap={dateNo:-1,itemName:-1,qty:-1,unitPrice:-1,sales:-1};
    for(let i=0;i<Math.min(20,rows.length);i++){let mc=0;for(let j=0;j<rows[i].length;j++){const v=String(rows[i][j]||"").trim();if(v.includes("일자-No.")){colMap.dateNo=j;mc++;}else if(v.includes("품목명")||v.includes("[규격]")){colMap.itemName=j;mc++;}else if(v==="수량"){colMap.qty=j;mc++;}else if(v==="단가"){colMap.unitPrice=j;mc++;}else if(v==="판매"){colMap.sales=j;mc++;}}if(mc>=3){headerRowIdx=i;break;}}
    if(headerRowIdx===-1)return alert("양식 오류");
    globalSitesData=[];historyStack=[];window.selectedItemIds.clear();expandedSiteIndex=-1;searchQuery='';updateFloatingBar();
    let currentGroup=[],currentSeq=null;
    for(let i=headerRowIdx+1;i<rows.length;i++){const row=rows[i];const dNR=String(row[colMap.dateNo]||"").trim();const iNR=String(row[colMap.itemName]||"").trim();if(!row.some(c=>String(c).trim()!==""))continue;if(!dNR.includes('-')&&!iNR)continue;const isTR=row.some(c=>{const t=String(c).replace(/\s/g,'');return t==='합계'||t==='월계'||t==='누계'||t==='총계'||t==='전월이월';});if(isTR)continue;if(dNR.includes('-')){if(currentSeq!==null&&currentSeq!==dNR){finalizeGroup(currentGroup,globalSitesData,colMap);currentGroup=[];}currentSeq=dNR;currentGroup.push(row);}else if(currentSeq!==null)currentGroup.push(row);}
    if(currentGroup.length>0)finalizeGroup(currentGroup,globalSitesData,colMap);
    window.sortByName();
  }

  function finalizeGroup(group,sitesData,colMap) {
    if(!group.length)return;
    let siteName="알 수 없는 현장";
    for(let j=group.length-1;j>=0;j--){const n=String(group[j][colMap.itemName]||"").trim();if(n){siteName=n;break;}}
    let totalSales=0;group.forEach(r=>{const sn=parseNum(r[colMap.sales]);if(!isNaN(sn))totalSales+=sn;});
    const items=group.map((r,index)=>{
      const isLast=(index===group.length-1);const raw=String(r[colMap.dateNo]||"").trim();
      let parts=(raw&&raw.includes('-'))?raw.split('-'):[raw,""];
      return{id:generateId(),category:"",date:parts[0],seqNo:parts[1],itemName:String(r[colMap.itemName]||"").trim(),qty:formatNum(r[colMap.qty]),unitPrice:formatNum(r[colMap.unitPrice]),sales:formatNum(r[colMap.sales]),purchase:isLast?formatNum(totalSales):""};
    });
    // #6 분류 패턴 자동 적용
    items.forEach(it=>{if(!it.category&&window.categoryMemory[it.itemName])it.category=window.categoryMemory[it.itemName];});
    let siteObj=sitesData.find(s=>s.siteName===siteName);
    if(!siteObj){siteObj={siteName,items:[]};sitesData.push(siteObj);}
    siteObj.items.push(...items);
  }

  /* ===== 공유 테이블 빌더 ===== */
  function buildSiteTable(site,si) {
    const items=site.filteredItems||site.items;
    const allSel=items.length>0&&items.every(it=>window.selectedItemIds.has(it.id));
    let html='<div style="display:flex;gap:0.4rem;margin-bottom:0.6rem;flex-wrap:wrap;align-items:center;">';
    html+='<button class="sort-btn" style="font-size:0.75rem;" onclick="window.selectSiteUnclassified('+si+')">📋 미분류 선택</button></div>';
    html+='<table class="data-table"><thead><tr>'
      +'<th style="padding-left:1rem;width:36px;text-align:center;"><input type="checkbox" onchange="window.toggleAllSiteItems('+si+',this.checked)" '+(allSel?'checked':'')+'></th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'date\')">일자 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'seqNo\')">No. ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'category\')">분류 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'itemName\')">품목명[규격] ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'qty\')">수량 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'unitPrice\')">단가 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'sales\')">판매 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'purchase\')">매입 ↕</th>'
      +'</tr></thead><tbody>';
    items.forEach(item=>{
      const chk=window.selectedItemIds.has(item.id)?'checked':'';
      const bg=chk?'background-color:var(--surface-container-high);':'';
      let bc='unassigned';if(item.category){const std=['잡자재','안전자재','기타자재','쇼핑몰'];bc='assigned cat-'+(std.includes(item.category)?item.category:'custom');}
      const bt=item.category||'미분류';
      html+='<tr style="'+bg+'">'
        +'<td style="padding-left:1rem;text-align:center;"><input type="checkbox" class="item-checkbox" data-id="'+item.id+'" onchange="window.toggleItem(\''+item.id+'\',this.checked)" '+chk+'></td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'date\',this)" class="editable-td">'+item.date+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'seqNo\',this)" class="editable-td">'+item.seqNo+'</td>'
        +'<td ondblclick="window.editCategoryField(\''+item.id+'\',this)" class="editable-td category-cell"><span class="category-badge '+bc+'">'+bt+'</span></td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'itemName\',this)" class="editable-td">'+item.itemName+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'qty\',this)" class="editable-td">'+item.qty+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'unitPrice\',this)" class="editable-td">'+item.unitPrice+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'sales\',this)" class="editable-td">'+item.sales+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'purchase\',this)" class="editable-td">'+item.purchase+'</td>'
        +'</tr>';
    });
    html+='</tbody></table>';
    return html;
  }

  /* ===== Rendering ===== */
  function renderResults() {
    if(!globalSitesData.length){sitesContainer.innerHTML='';resultsSection.style.display='none';return;}
    let gTP=0,gTotal=0,gUncat=0;
    globalSitesData.forEach(site=>{
      let tP=0;
      site.filteredItems=site.items.filter(item=>{
        let match=false;
        if(window.currentTab==='전체')match=true;
        else if(window.currentTab==='직접입력')match=item.category&&!window.STANDARD_CATEGORIES.includes(item.category);
        else match=item.category===window.currentTab;
        if(match&&searchQuery){const q=searchQuery;match=((item.itemName||'').toLowerCase().includes(q)||(item.date||'').includes(q)||(item.seqNo||'').includes(q));}
        if(match&&item.purchase){const num=parseNum(item.purchase);if(!isNaN(num))tP+=num;}
        return match;
      });
      site.filteredTotalPurchase=tP;
      gTP+=tP;
      const fitems=site.filteredItems;
      gTotal+=fitems.length;
      fitems.forEach(it=>{if(!it.category)gUncat++;});
    });

    sitesContainer.innerHTML='';
    const sdiv=document.createElement('div');sdiv.className='summary-container';
    const classified=gTotal-gUncat;
    const pct=gTotal>0?Math.round(classified/gTotal*100):0;

    let sh='<div class="summary-header">'
      +'<h3 style="margin:0;font-size:1.1rem;color:var(--primary);font-weight:800;">전체 현장 요약</h3>'
      +'<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">'
      +'<button class="sort-btn" onclick="window.undoAction()" '+(historyStack.length===0?'disabled':'style="color:var(--primary);font-weight:800;border-color:var(--primary);"')+' title="Ctrl+Z">↩ 실행 취소</button>'
      +'<button class="sort-btn" onclick="window.sortByName()">가나다순 ↕</button>'
      +'<button class="sort-btn" onclick="window.sortByAmount()">금액순 ↕</button>'
      +'<button class="sort-btn" onclick="window.selectAllUnclassified()" style="background:#FFF3E0;border-color:#FF9800;color:#E65100;">📋 미분류 일괄</button>'
      +'<button class="sort-btn" onclick="window.downloadExcel()" style="background:var(--secondary-container);color:var(--on-secondary-container);">📥 엑셀</button></div></div>';

    // #8 대시보드 카드
    sh+='<div class="stats-dashboard">'
      +'<div class="stat-card"><div class="stat-card-label">현장 수</div><div class="stat-card-value">'+globalSitesData.length+'곳</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">매입 합계</div><div class="stat-card-value">'+Math.round(gTP).toLocaleString('ko-KR')+'</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">미분류</div><div class="stat-card-value">'+(gUncat>0?gUncat+'건':'완료 ✓')+'</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">분류 완료율</div><div class="stat-card-value success">'+pct+'%</div>'
      +'<div class="progress-bar-container"><div class="progress-bar-fill" style="width:'+pct+'%"></div></div></div>'
      +'</div>';

    // #4 검색
    sh+='<div class="search-container"><span class="search-icon">🔍</span><input type="text" class="search-input" placeholder="품목명, 일자, No.로 검색..." value="'+searchQuery+'" oninput="window.handleSearch(this.value)"></div>';

    const tabs=[['전체','전체보기'],['잡자재','잡자재'],['안전자재','안전자재'],['기타자재','기타자재'],['쇼핑몰','쇼핑몰'],['직접입력','직접입력 (기타)']];
    sh+='<div class="tab-container">';
    tabs.forEach(([k,l])=>{sh+='<button class="tab-btn'+(window.currentTab===k?' active':'')+'" onclick="window.setFilterTab(\''+k+'\')">'+l+'</button>';});
    sh+='</div><div class="summary-list">';

    // 전체 현장 칩
    sh+='<button class="summary-chip" style="background:var(--primary-fixed);border:2px solid var(--primary);" onclick="window.openSiteModal(-1)"><strong style="color:var(--primary);">📊 전체 현장</strong></button>';

    globalSitesData.forEach((site,idx)=>{
      if(window.currentTab!=='전체'&&site.filteredItems.length===0)return;
      sh+='<button class="summary-chip" draggable="true" '
        +'onclick="window.openSiteModal('+idx+')" '
        +'ondragstart="window.handleChipDragStart(event,'+idx+')" ondragend="window.handleChipDragEnd(event)" '
        +'ondragover="window.handleChipDragOver(event)" ondragleave="window.handleChipDragLeave(event)" ondrop="window.handleChipDrop(event,'+idx+')">'
        +'<strong onclick="event.stopPropagation();" ondblclick="event.stopPropagation();window.editSiteName('+idx+',this)" class="editable-header" title="더블 클릭하여 현장명 수정">'+site.siteName+'</strong>'
        +'<span>'+(site.filteredTotalPurchase||0).toLocaleString('ko-KR')+'원</span></button>';
    });
    sh+='</div>';
    sdiv.innerHTML=sh;sitesContainer.appendChild(sdiv);

    // 아코디언
    globalSitesData.forEach((site,idx)=>{
      if(window.currentTab!=='전체'&&site.filteredItems.length===0)return;
      const isExp=(expandedSiteIndex===idx);
      const card=document.createElement('div');card.className='site-card accordion-card'+(isExp?' expanded':'');card.id='site-card-'+idx;
      const itemCount=site.filteredItems.length;
      let uncat=0;site.filteredItems.forEach(it=>{if(!it.category)uncat++;});
      const sitePct=itemCount>0?Math.round((itemCount-uncat)/itemCount*100):100;

      let badges='<div class="status-badges">';
      if(itemCount-uncat>0)badges+='<span class="status-badge ok">분류 '+(itemCount-uncat)+'</span>';
      if(uncat>0)badges+='<span class="status-badge uncat">미분류 '+uncat+'</span>';
      badges+='</div>';

      let ch='<div class="accordion-header" onclick="window.toggleAccordion('+idx+')">'
        +'<div class="accordion-header-left">'
        +'<span class="accordion-arrow">'+(isExp?'▼':'▶')+'</span>'
        +'<h3 class="accordion-site-name" ondblclick="event.stopPropagation();window.editSiteName('+idx+',this)">'+site.siteName+'</h3>'
        +'<span class="accordion-item-count">'+itemCount+'건</span>'
        +badges
        +'</div>'
        +'<div class="accordion-header-right">'
        +'<span class="accordion-amount">'+(site.filteredTotalPurchase||0).toLocaleString('ko-KR')+'원</span>'
        +'<button class="sort-btn" style="font-size:0.75rem;" onclick="event.stopPropagation();window.openSiteModal('+idx+')">🔍 상세</button>'
        +'</div></div>';

      if(!isExp) ch+='<div style="padding:0 1.5rem 0.5rem;"><div class="progress-bar-container"><div class="progress-bar-fill" style="width:'+sitePct+'%"></div></div></div>';
      if(isExp) ch+='<div class="accordion-body">'+buildSiteTable(site,idx)+'</div>';
      card.innerHTML=ch;sitesContainer.appendChild(card);
    });
    resultsSection.style.display='block';
  }

  /* ===== 엑셀 다운로드 ===== */
  window.downloadExcel = function() {
    if(!globalSitesData.length)return alert('다운로드할 데이터가 없습니다.');
    var boldStyle={font:{bold:true}};var yellowBoldStyle={font:{bold:true,sz:11},fill:{fgColor:{rgb:'FFFF00'}}};
    var headerStyle={font:{bold:true,color:{rgb:'FFFFFF'},sz:11},fill:{fgColor:{rgb:'000666'}},alignment:{horizontal:'center'}};
    var numStyle={alignment:{horizontal:'right'}};
    var wsData=[],styleMap={};
    wsData.push(['일자','품목명[규격]','수량','단가','판매','매입']);
    for(var hc=0;hc<6;hc++)styleMap['r0c'+hc]=headerStyle;
    globalSitesData.forEach(function(site){
      var items=site.filteredItems;if(!items||!items.length)return;
      var sT=0;items.forEach(function(it){if(it.purchase){var pn=parseNum(it.purchase);if(!isNaN(pn))sT+=pn;}});
      items.forEach(function(it){
        var ds=it.date||'';if(ds.length===4)ds=ds.substring(0,2)+'/'+ds.substring(2,4);else if(ds.length===3)ds='0'+ds.substring(0,1)+'/'+ds.substring(1,3);
        var sn=parseNum(it.sales),pn=parseNum(it.purchase);
        wsData.push([ds,it.itemName||'',it.qty?parseNum(it.qty):'',it.unitPrice?parseNum(it.unitPrice):'',!isNaN(sn)?sn:'',(it.purchase&&!isNaN(pn))?pn:'']);
        var ri=wsData.length-1;styleMap['r'+ri+'c0']={alignment:{horizontal:'center'}};for(var ci=2;ci<6;ci++)styleMap['r'+ri+'c'+ci]=numStyle;
      });
      var smRI=wsData.length;wsData.push(['',site.siteName,'','','',sT]);
      for(var sc=0;sc<6;sc++)styleMap['r'+smRI+'c'+sc]=yellowBoldStyle;
    });
    var ws=XLSX.utils.aoa_to_sheet(wsData);
    var range=XLSX.utils.decode_range(ws['!ref']);
    for(var R=range.s.r;R<=range.e.r;R++){for(var C=range.s.c;C<=range.e.c;C++){var addr=XLSX.utils.encode_cell({r:R,c:C});if(!ws[addr])ws[addr]={v:'',t:'s'};var key='r'+R+'c'+C;if(styleMap[key])ws[addr].s=styleMap[key];}}
    ws['!cols']=[{wch:8},{wch:30},{wch:8},{wch:12},{wch:14},{wch:14}];
    ws['!rows']=[];for(var rh=0;rh<=range.e.r;rh++)ws['!rows'].push({hpt:17.4});
    for(var R2=1;R2<=range.e.r;R2++){for(var C2=2;C2<=5;C2++){var addr2=XLSX.utils.encode_cell({r:R2,c:C2});if(ws[addr2]&&typeof ws[addr2].v==='number')ws[addr2].z='#,##0';}}
    var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'분개내역');
    var today=new Date();var dt=today.getFullYear()+''+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
    var tabName=window.currentTab==='전체'?'전체':window.currentTab;
    XLSX.writeFile(wb,'월마감_'+tabName+'_'+dt+'.xlsx');
  };
});
