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
  window.currentViewMode = 'purchase';
  window.categoryMemory = {}; // #6 분류 패턴 기억: itemName → category

  // #5 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); window.undoAction(); }
    if (e.key === 'Escape') {
      const modal = document.getElementById('siteModal');
      if (modal && modal.style.display === 'flex') window.closeSiteModal();
    }
  });

  window.setViewMode = function(mode) {
    window.currentViewMode = mode;
    renderResults();
    // 모달이 열려있으면 모달 내용도 갱신
    const modal = document.getElementById('siteModal');
    if (modal && modal.style.display === 'flex' && modal.dataset.siteIndex !== undefined) {
      const si = parseInt(modal.dataset.siteIndex, 10);
      if (!isNaN(si)) window.openSiteModal(si);
    }
  };
  window.setFilterTab = function(tabName) {
    window.currentTab = tabName;
    window.selectedItemIds.clear();
    updateFloatingBar();
    renderResults();
  };

  function generateId() { return 'item_' + Math.random().toString(36).substr(2, 9); }

  // HTML 표출용: "(주)케앤지(현장명)" → "현장명" 으로 변환
  function displaySiteName(raw) {
    if (!raw) return '';
    const m = raw.match(/^\(주\)케앤지\((.+)\)$/);
    return m ? m[1] : raw;
  }

  // 뷰 모드에 따른 현장 금액 표시 (칩용)
  function getChipAmount(site) {
    const vm = window.currentViewMode;
    const fmtA = (v) => Math.round(v||0).toLocaleString('ko-KR');
    if (vm === 'sales') return fmtA(site.filteredTotalSales)+'원';
    if (vm === 'origin') return fmtA(site.filteredTotalOrg)+'원';
    if (vm === 'all') return '<span class="chip-amount-row"><em>매입</em>'+fmtA(site.filteredTotalPurch)+'</span>'
      +'<span class="chip-amount-row"><em>매출</em>'+fmtA(site.filteredTotalSales)+'</span>'
      +'<span class="chip-amount-row"><em>원매입</em>'+fmtA(site.filteredTotalOrg)+'</span>';
    return fmtA(site.filteredTotalPurch)+'원';
  }

  // 뷰 모드에 따른 아코디언 금액 표시 (한 줄 컴팩트)
  function getAccordionAmount(site) {
    const vm = window.currentViewMode;
    const fmtA = (v) => Math.round(v||0).toLocaleString('ko-KR');
    if (vm === 'sales') return fmtA(site.filteredTotalSales)+'원';
    if (vm === 'origin') return fmtA(site.filteredTotalOrg)+'원';
    if (vm === 'all') return '<span class="acc-lbl">매입</span>'+fmtA(site.filteredTotalPurch)
      +' <span class="acc-lbl">매출</span>'+fmtA(site.filteredTotalSales)
      +' <span class="acc-lbl">원매입</span>'+fmtA(site.filteredTotalOrg);
    return fmtA(site.filteredTotalPurch)+'원';
  }

  // 뷰 모드에 따른 전역 합계 레이블/값
  function getGlobalAmountCards(gP, gS, gO) {
    const vm = window.currentViewMode;
    const fmtA = (v) => Math.round(v).toLocaleString('ko-KR');
    if (vm === 'sales') return '<div class="stat-card"><div class="stat-card-label">매출 합계</div><div class="stat-card-value">'+fmtA(gS)+'</div></div>';
    if (vm === 'origin') return '<div class="stat-card"><div class="stat-card-label">원매입 합계</div><div class="stat-card-value">'+fmtA(gO)+'</div></div>';
    if (vm === 'all') return '<div class="stat-card"><div class="stat-card-label">매입 합계</div><div class="stat-card-value">'+fmtA(gP)+'</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">매출 합계</div><div class="stat-card-value">'+fmtA(gS)+'</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">원매입 합계</div><div class="stat-card-value">'+fmtA(gO)+'</div></div>';
    return '<div class="stat-card"><div class="stat-card-label">매입 합계</div><div class="stat-card-value">'+fmtA(gP)+'</div></div>';
  }

  const parseNum = (val) => {
    if (val === "" || val == null) return NaN;
    let s = String(val).replace(/,/g, '').trim();
    if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
    else if (/^[△▲]|(\(-\))/.test(s)) s = '-' + s.replace(/^[△▲]|(\(-\))/g, '');
    return Number(s);
  };
  const formatNum = (val) => { if (val === "" || val == null) return ""; let n = parseNum(val); return isNaN(n) ? val : n.toLocaleString('ko-KR'); };
  const formatMoney = (val) => { if (val === "" || val == null) return ""; let n = parseNum(val); return isNaN(n) ? val : Math.round(n).toLocaleString('ko-KR'); };
  const normalizeDateString = (dateStr) => {
    if (!dateStr) return "";
    let str = String(dateStr).trim();
    if (/^\d{5}$/.test(str)) { let d = new Date(Math.round((parseInt(str,10) - 25569) * 86400 * 1000)); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    if (str.includes('/')) { let p=str.split('/'); if(p[0].length===4) return p[0]+'-'+p[1].padStart(2,'0')+'-'+p[2].padStart(2,'0'); if(p.length===3){let y=p[2];if(y.length===2)y='20'+y;return y+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');} }
    if (str.includes('.')) { let p=str.split('.').filter(x=>x.trim()); if(p.length>=3){let y=p[0];if(y.length===2)y='20'+y;return y+'-'+p[1].padStart(2,'0')+'-'+p[2].padStart(2,'0');} }
    return str;
  };

  function saveState() { historyStack.push(JSON.parse(JSON.stringify(globalSitesData))); if (historyStack.length > 30) historyStack.shift(); }

  window.undoAction = function() {
    if (historyStack.length === 0) return alert('취소할 작업이 없습니다.');
    globalSitesData = historyStack.pop();
    window.selectedItemIds.clear(); updateFloatingBar(); renderResults();
  };

  window.toggleItem = function(itemId, isChecked, cb) {
    if (isChecked) window.selectedItemIds.add(itemId); else window.selectedItemIds.delete(itemId);
    if (cb) { const tr = cb.closest('tr'); if (tr) tr.style.backgroundColor = isChecked ? 'var(--surface-container-high)' : ''; }
    updateFloatingBar();
  };

  window.toggleAllSiteItems = function(siteIndex, isChecked) {
    const site = globalSitesData[siteIndex]; if (!site) return;
    const items = site.filteredItems || site.items;
    items.forEach(item => { if (isChecked) window.selectedItemIds.add(item.id); else window.selectedItemIds.delete(item.id); });
    document.querySelectorAll('.item-checkbox').forEach(cb => { if (items.some(it => it.id === cb.dataset.id)) cb.checked = isChecked; });
    updateFloatingBar();
  };

  window.selectAllUnclassified = function() {
    globalSitesData.forEach(s => s.items.forEach(it => { if (!it.category) window.selectedItemIds.add(it.id); }));
    updateFloatingBar(); renderResults();
  };
  window.selectSiteUnclassified = function(si) {
    const site = globalSitesData[si]; if (!site) return;
    site.items.forEach(it => { if (!it.category) window.selectedItemIds.add(it.id); });
    updateFloatingBar(); renderResults();
  };

  function updateFloatingBar() {
    const bar = document.getElementById('floatingActionBar');
    const countSpan = document.getElementById('floatingSelectedCount');
    const select = document.getElementById('moveSiteSelect');
    if (window.selectedItemIds.size > 0) {
      countSpan.textContent = window.selectedItemIds.size + '건 선택됨';
      const cv = select.value; select.innerHTML = '';
      globalSitesData.forEach(s => { const o=document.createElement('option'); o.value=o.textContent=s.siteName; select.appendChild(o); });
      const co=document.createElement('option'); co.value='__CUSTOM__'; co.textContent='직접 입력...'; select.appendChild(co);
      if (cv && Array.from(select.options).some(o=>o.value===cv)) select.value=cv;
      window.handleFloatingSelectChange();
      const bs = document.getElementById('bulkCategorySelect');
      if (bs) { const bv=bs.value; bs.innerHTML=''; window.globalCategories.forEach(c=>{const o=document.createElement('option');o.value=o.textContent=c;bs.appendChild(o);}); const cc=document.createElement('option');cc.value='__CUSTOM__';cc.textContent='직접 입력...';bs.appendChild(cc); if(bv&&Array.from(bs.options).some(o=>o.value===bv))bs.value=bv; window.handleBulkCategorySelect(); }
      bar.classList.add('visible');
    } else { bar.classList.remove('visible'); }
  }

  window.handleBulkCategorySelect = function() { const s=document.getElementById('bulkCategorySelect'),i=document.getElementById('customBulkCategory'); if(s.value==='__CUSTOM__'){i.style.display='inline-block';i.focus();}else{i.style.display='none';i.value='';} };
  window.executeBulkCategory = function() {
    if (window.selectedItemIds.size===0) return;
    const s=document.getElementById('bulkCategorySelect'), ci=document.getElementById('customBulkCategory');
    let tc=s.value; if(tc==='__CUSTOM__'){tc=ci.value.trim();if(!tc)return alert('분류명을 텍스트 칸에 입력해주세요.');window.globalCategories.add(tc);}
    saveState();
    globalSitesData.forEach(site=>site.items.forEach(item=>{
      if(window.selectedItemIds.has(item.id)){item.category=tc; window.categoryMemory[item.itemName]=tc;}
    }));
    window.selectedItemIds.clear(); updateFloatingBar(); renderResults();
  };
  window.handleFloatingSelectChange = function() { const s=document.getElementById('moveSiteSelect'),i=document.getElementById('customMoveSiteName'); if(s.value==='__CUSTOM__'){i.style.display='inline-block';i.focus();}else{i.style.display='none';i.value='';} };
  window.executeDelete = function() {
    if (window.selectedItemIds.size===0) return;
    if (!confirm('선택한 '+window.selectedItemIds.size+'개의 내역을 정말 삭제하시겠습니까?')) return;
    saveState();
    for(let i=globalSitesData.length-1;i>=0;i--){globalSitesData[i].items=globalSitesData[i].items.filter(it=>!window.selectedItemIds.has(it.id));if(globalSitesData[i].items.length===0)globalSitesData.splice(i,1);}
    window.selectedItemIds.clear(); updateFloatingBar(); renderResults();
  };
  window.executeMove = function() {
    if (window.selectedItemIds.size===0) return;
    const s=document.getElementById('moveSiteSelect'),ci=document.getElementById('customMoveSiteName');
    let tn=s.value; if(tn==='__CUSTOM__'){tn=ci.value.trim();if(!tn)return alert('현장명을 입력해주세요.');}
    saveState(); const itm=[];
    for(let i=globalSitesData.length-1;i>=0;i--){const r=[];globalSitesData[i].items.forEach(it=>{if(window.selectedItemIds.has(it.id))itm.push(it);else r.push(it);});globalSitesData[i].items=r;if(!r.length)globalSitesData.splice(i,1);}
    let tgt=globalSitesData.find(s=>s.siteName===tn);
    if(!tgt){tgt={siteName:tn,items:[],totals:{originPurch:0,purch:0,sales:0}};globalSitesData.unshift(tgt);}
    tgt.items.push(...itm); window.selectedItemIds.clear(); updateFloatingBar(); renderResults();
  };
  window.clearSelection = function() { window.selectedItemIds.clear(); document.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); updateFloatingBar(); };

  window.editSiteName = function(si, el) {
    if (el.querySelector('input')) return;
    const site=globalSitesData[si], orig=site.siteName;
    const inp=document.createElement('input'); inp.type='text'; inp.value=orig; inp.className='inline-edit-input site-name-input';
    el.innerHTML=''; el.appendChild(inp); inp.focus();
    const fin=()=>{const nv=inp.value.trim();if(nv&&nv!==orig){saveState();site.siteName=nv;}renderResults();};
    inp.addEventListener('blur',fin); inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=orig;inp.blur();}});
  };

  window.editCategoryField = function(itemId, td) {
    if (td.querySelector('select')||td.querySelector('input')) return;
    let ti=null; for(let s of globalSitesData){ti=s.items.find(i=>i.id===itemId);if(ti)break;} if(!ti) return;
    const ov=ti.category||'';
    const sel=document.createElement('select'); sel.className='form-select inline-edit-input';
    const eo=document.createElement('option'); eo.value=''; eo.textContent='선택 안 함'; sel.appendChild(eo);
    window.globalCategories.forEach(c=>{const o=document.createElement('option');o.value=o.textContent=c;sel.appendChild(o);});
    // #6 분류 패턴 자동 제안
    const suggested = window.categoryMemory[ti.itemName];
    if (suggested && !window.globalCategories.has(suggested)) { window.globalCategories.add(suggested); const so=document.createElement('option');so.value=so.textContent=suggested;sel.appendChild(so); }
    const co=document.createElement('option');co.value='__CUSTOM__';co.textContent='직접입력...';sel.appendChild(co);
    if(ov&&window.globalCategories.has(ov))sel.value=ov; else if(ov){window.globalCategories.add(ov);sel.value=ov;} else if(suggested){sel.value=suggested;} else sel.value='';
    td.innerHTML=''; td.appendChild(sel); sel.focus();
    const apply=(v)=>{const nv=v.trim();if(nv!==ov){saveState();ti.category=nv;if(nv){window.globalCategories.add(nv);window.categoryMemory[ti.itemName]=nv;}}renderResults();};
    sel.addEventListener('change',()=>{
      if(sel.value==='__CUSTOM__'){const inp=document.createElement('input');inp.type='text';inp.className='inline-edit-input';td.innerHTML='';td.appendChild(inp);inp.focus();inp.addEventListener('blur',()=>apply(inp.value));inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape')apply(ov);});}
      else apply(sel.value);
    });
    sel.addEventListener('blur',()=>{if(sel.parentNode===td&&sel.value!=='__CUSTOM__')apply(sel.value);});
    sel.addEventListener('keydown',e=>{if(e.key==='Escape')apply(ov);});
  };

  window.editItemField = function(itemId, field, td) {
    if (td.querySelector('input')) return;
    let ti=null; for(let s of globalSitesData){ti=s.items.find(i=>i.id===itemId);if(ti)break;} if(!ti) return;
    let ov=ti[field]; if(ov==null)ov="";
    const inp=document.createElement('input'); inp.type='text'; inp.value=ov; inp.className='inline-edit-input';
    td.innerHTML=''; td.appendChild(inp); inp.focus();
    const fin=()=>{const nv=inp.value.trim();if(nv!==String(ov)){saveState();if(field==='qty')ti[field]=formatNum(nv);else if(['originPurchUnit','originPurchAmnt','purchUnit','purchAmnt','salesUnit','salesAmnt'].includes(field))ti[field]=formatMoney(nv);else ti[field]=nv;}renderResults();};
    inp.addEventListener('blur',fin); inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=String(ov);inp.blur();}});
  };

  window.handleTableSort = function(si, col) {
    const site=globalSitesData[si]; if(!site.sortConfig)site.sortConfig=[];
    let idx=site.sortConfig.findIndex(c=>c.col===col);
    if(idx>=0){site.sortConfig[idx].asc=!site.sortConfig[idx].asc;site.sortConfig.unshift(site.sortConfig.splice(idx,1)[0]);}
    else site.sortConfig.unshift({col,asc:true});
    site.items.sort((a,b)=>{for(let sc of site.sortConfig){let vA=a[sc.col]||"",vB=b[sc.col]||"",cmp=0;if(['qty','originPurchUnit','originPurchAmnt','purchUnit','purchAmnt','salesUnit','salesAmnt'].includes(sc.col))cmp=(parseNum(vA)||0)-(parseNum(vB)||0);else cmp=String(vA).localeCompare(String(vB));if(cmp!==0)return sc.asc?cmp:-cmp;}return 0;});
    renderResults();
  };

  window.handleChipDragStart=function(e,i){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('sourceIndex',i);setTimeout(()=>e.target.classList.add('dragging'),0);};
  window.handleChipDragEnd=function(e){e.target.classList.remove('dragging');};
  window.handleChipDragOver=function(e){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('drag-over-chip');};
  window.handleChipDragLeave=function(e){e.currentTarget.classList.remove('drag-over-chip');};
  window.handleChipDrop=function(e,ti){e.preventDefault();e.currentTarget.classList.remove('drag-over-chip');const si=parseInt(e.dataTransfer.getData('sourceIndex'),10);if(isNaN(si)||si===ti)return;const src=globalSitesData[si],tgt=globalSitesData[ti];if(confirm('"'+src.siteName+'"→"'+tgt.siteName+'" 병합하시겠습니까?')){saveState();tgt.items.push(...src.items);globalSitesData.splice(si,1);updateFloatingBar();renderResults();}};

  let amountSortAsc=false, nameSortAsc=true;
  window.sortByAmount=function(){globalSitesData.sort((a,b)=>{let aT=a.filteredTotalPurch||0,bT=b.filteredTotalPurch||0;return amountSortAsc?aT-bT:bT-aT;});amountSortAsc=!amountSortAsc;renderResults();};
  window.sortByName=function(){globalSitesData.sort((a,b)=>nameSortAsc?a.siteName.localeCompare(b.siteName):b.siteName.localeCompare(a.siteName));nameSortAsc=!nameSortAsc;renderResults();};
  window.toggleAccordion=function(si){expandedSiteIndex=(expandedSiteIndex===si)?-1:si;renderResults();};

  // #4 검색
  window.handleSearch = function(val) { searchQuery = val.trim().toLowerCase(); renderResults(); };

  /* ===== 정보 팝업 (대시보드 카드 클릭용) ===== */
  window.openInfoPopup = function(titleText, bodyHtml) {
    const modal = document.getElementById('siteModal');
    const title = document.getElementById('siteModalTitle');
    const body = document.getElementById('siteModalBody');
    title.textContent = titleText;
    body.innerHTML = bodyHtml;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  window.showSiteListPopup = function() {
    let html = '<div class="info-popup-list">';
    globalSitesData.forEach((site, idx) => {
      html += '<div class="info-popup-item">' 
        + '<span class="info-popup-idx">' + (idx + 1) + '</span>'
        + '<span class="info-popup-name">' + displaySiteName(site.siteName) + '</span>'
        + '<span class="info-popup-amount">' + Math.round(site.filteredTotalPurch || 0).toLocaleString('ko-KR') + '원</span>'
        + '</div>';
    });
    html += '</div>';
    window.openInfoPopup('📋 전체 현장 목록 (' + globalSitesData.length + '곳)', html);
  };

  window.showErrorPopup = function() {
    let totalErrors = 0;
    let rows = [];
    globalSitesData.forEach(site => {
      const items = site.filteredItems || site.items;
      let siteErrors = [];
      items.forEach(item => {
        let orgP = parseNum(item.originPurchUnit) || 0, pP = parseNum(item.purchUnit) || 0;
        let sP = parseNum(item.salesUnit) || 0, q = parseNum(item.qty) || 0;
        let warnings = [];
        let eO = Math.round(pP * 0.98); if (orgP !== eO) warnings.push('원매입단가 오차(' + Math.round(orgP - eO) + '원)');
        let eS = Math.round(orgP * 1.25); if (sP !== eS) warnings.push('매출단가 오차(' + Math.round(sP - eS) + '원)');
        let cP = Math.round(pP * q), curP = parseNum(item.purchAmnt) || 0; if (cP !== curP) warnings.push('매입금액 오차(' + Math.round(curP - cP) + '원)');
        if (warnings.length > 0) siteErrors.push({ item, warnings });
      });
      if (siteErrors.length > 0) {
        totalErrors += siteErrors.length;
        rows.push({ type: 'header', name: displaySiteName(site.siteName), count: siteErrors.length });
        siteErrors.forEach(({ item, warnings }) => {
          rows.push({ type: 'row', date: item.date || '', itemName: item.itemName || '', spec: item.spec || '', detail: warnings.join(', ') });
        });
      }
    });
    let html = '';
    if (rows.length === 0) {
      html = '<div class="info-popup-empty">✅ 검증 오류가 없습니다.</div>';
    } else {
      html = '<table class="info-popup-table unified-table"><thead><tr>'
        + '<th style="width:12%;">일자</th><th style="width:22%;">품목명</th><th style="width:20%;">규격</th><th style="width:46%;">오류 내용</th>'
        + '</tr></thead><tbody>';
      rows.forEach(r => {
        if (r.type === 'header') {
          html += '<tr class="site-separator-row"><td colspan="4">'
            + '<strong>' + r.name + '</strong> <span class="info-popup-badge error">' + r.count + '건</span></td></tr>';
        } else {
          html += '<tr><td>' + r.date + '</td><td>' + r.itemName + '</td><td>' + r.spec + '</td>'
            + '<td class="info-popup-error-text">' + r.detail + '</td></tr>';
        }
      });
      html += '</tbody></table>';
    }
    window.openInfoPopup('⚠️ 검증 오류 내역 (' + totalErrors + '건)', html);
  };

  window.showUncatPopup = function() {
    let totalUncat = 0;
    let rows = [];
    globalSitesData.forEach(site => {
      const items = site.filteredItems || site.items;
      const uncatItems = items.filter(it => !it.category);
      if (uncatItems.length > 0) {
        totalUncat += uncatItems.length;
        rows.push({ type: 'header', name: displaySiteName(site.siteName), count: uncatItems.length });
        uncatItems.forEach(item => {
          rows.push({ type: 'row', date: item.date || '', itemName: item.itemName || '', spec: item.spec || '', amount: item.purchAmnt || '' });
        });
      }
    });
    let html = '';
    if (rows.length === 0) {
      html = '<div class="info-popup-empty">✅ 모든 항목이 분류되었습니다.</div>';
    } else {
      html = '<table class="info-popup-table unified-table"><thead><tr>'
        + '<th style="width:12%;">일자</th><th style="width:30%;">품목명</th><th style="width:28%;">규격</th><th style="width:30%;">매입금액</th>'
        + '</tr></thead><tbody>';
      rows.forEach(r => {
        if (r.type === 'header') {
          html += '<tr class="site-separator-row"><td colspan="4">'
            + '<strong>' + r.name + '</strong> <span class="info-popup-badge uncat">' + r.count + '건</span></td></tr>';
        } else {
          html += '<tr><td>' + r.date + '</td><td>' + r.itemName + '</td><td>' + r.spec + '</td>'
            + '<td style="text-align:right;">' + r.amount + '</td></tr>';
        }
      });
      html += '</tbody></table>';
    }
    window.openInfoPopup('📦 미분류 내역 (' + totalUncat + '건)', html);
  };

  window.showClassRatePopup = function() {
    let html = '<div class="info-popup-list">';
    let hasMissing = false;
    globalSitesData.forEach(site => {
      const items = site.filteredItems || site.items;
      const uncatCount = items.filter(it => !it.category).length;
      const total = items.length;
      const pct = total > 0 ? Math.round((total - uncatCount) / total * 100) : 100;
      const statusClass = uncatCount > 0 ? 'warn' : 'ok';
      if (uncatCount > 0) hasMissing = true;
      html += '<div class="info-popup-item">'
        + '<span class="info-popup-name" style="flex:1;">' + displaySiteName(site.siteName) + '</span>'
        + '<span class="info-popup-badge ' + statusClass + '">' + (uncatCount > 0 ? '미분류 ' + uncatCount + '건' : '완료 ✓') + '</span>'
        + '<span class="info-popup-pct">' + pct + '%</span>'
        + '</div>';
    });
    html += '</div>';
    if (!hasMissing) html = '<div class="info-popup-empty">✅ 모든 현장의 분류가 완료되었습니다.</div>' + html;
    window.openInfoPopup('📊 현장별 분류 완료율', html);
  };

  /* ===== 팝업 모달 ===== */
  window.openSiteModal=function(si){
    const modal=document.getElementById('siteModal'),title=document.getElementById('siteModalTitle'),body=document.getElementById('siteModalBody');
    modal.dataset.siteIndex=si;
    if(si===-1){title.textContent='📊 전체 현장 내역';let h='';globalSitesData.forEach((s,idx)=>{if(window.currentTab!=='전체'&&(!s.filteredItems||!s.filteredItems.length))return;h+='<div style="margin-bottom:1.5rem;"><h4 style="color:var(--primary);margin:0 0 0.5rem;padding-bottom:0.5rem;border-bottom:2px solid var(--primary-fixed);">'+displaySiteName(s.siteName)+'</h4>'+buildSiteTable(s,idx)+'</div>';});body.innerHTML=h;}
    else{const s=globalSitesData[si];if(!s)return;title.textContent=displaySiteName(s.siteName);body.innerHTML=buildSiteTable(s,si);}
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
    reader.onload=e=>{try{const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});processData(wb);}catch(err){alert("엑셀 파싱 오류: "+err.message);}};
    reader.readAsArrayBuffer(file);
  }

  function processData(workbook) {
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});
    if(!rows.length) return;
    globalSitesData=[];historyStack=[];window.selectedItemIds.clear();expandedSiteIndex=-1;searchQuery='';updateFloatingBar();
    let currentSite=null,currentBlock=[];
    for(let i=0;i<rows.length;i++){
      const row=rows[i]; if(!row||!row.length) continue;
      const bCol=String(row[1]||"").trim();
      if(bCol.startsWith('(주)케앤지')){if(currentSite&&currentBlock.length)finalizeGroup(currentSite,currentBlock,globalSitesData);currentSite=bCol;currentBlock=[];continue;}
      if(bCol.startsWith('계(')){if(currentSite){finalizeGroup(currentSite,currentBlock,globalSitesData,row);currentSite=null;currentBlock=[];}continue;}
      if(currentSite){if(bCol==='상품명'||String(row[0]).trim()==='발생일자')continue;if(String(row[0]||"").trim()!==""||bCol!=="")currentBlock.push(row);}
    }
    if(currentSite&&currentBlock.length)finalizeGroup(currentSite,currentBlock,globalSitesData);
    renderResults();
  }

  function finalizeGroup(siteName,blockRows,sitesData,totalRow=null) {
    if(!blockRows.length) return;
    let items=blockRows.map(r=>({
      id:generateId(),category:"",
      date:normalizeDateString(r[0]),itemName:String(r[1]||"").trim(),spec:String(r[2]||"").trim(),unit:String(r[3]||"").trim(),
      qty:formatNum(r[4]),salesUnit:formatMoney(r[5]),salesAmnt:formatMoney(r[6]),purchUnit:formatMoney(r[7]),purchAmnt:formatMoney(r[8]),originPurchUnit:formatMoney(r[9]),originPurchAmnt:formatMoney(r[10])
    })).filter(it=>it.date||it.itemName);
    // #6 분류 패턴 자동 적용
    items.forEach(it => { if (!it.category && window.categoryMemory[it.itemName]) it.category = window.categoryMemory[it.itemName]; });
    let totals={originPurch:0,purch:0,sales:0};
    if(totalRow){totals.sales=parseNum(totalRow[6])||0;totals.purch=parseNum(totalRow[8])||0;totals.originPurch=parseNum(totalRow[10])||0;}
    let siteObj=sitesData.find(s=>s.siteName===siteName);
    if(!siteObj){siteObj={siteName,items:[],totals:{originPurch:0,purch:0,sales:0}};sitesData.push(siteObj);}
    siteObj.items.push(...items);
    siteObj.totals.originPurch+=totals.originPurch;siteObj.totals.purch+=totals.purch;siteObj.totals.sales+=totals.sales;
  }

  /* ===== 현장별 통계 계산 ===== */
  function calcSiteStats(site) {
    const items = site.filteredItems || site.items;
    let ok=0, warn=0, uncat=0;
    items.forEach(it => {
      if (!it.category) uncat++;
      let orgP=parseNum(it.originPurchUnit)||0, pP=parseNum(it.purchUnit)||0, sP=parseNum(it.salesUnit)||0, q=parseNum(it.qty)||0;
      let hasWarn=false;
      if(orgP!==Math.round(pP*0.98))hasWarn=true;
      if(sP!==Math.round(orgP*1.25))hasWarn=true;
      if(Math.round(pP*q)!==(parseNum(it.purchAmnt)||0))hasWarn=true;
      if(hasWarn)warn++; else ok++;
    });
    return {ok,warn,uncat,total:items.length};
  }

  /* ===== 공유 테이블 빌더 ===== */
  function buildSiteTable(site,si) {
    const items=site.filteredItems||site.items;
    const allSel=items.length>0&&items.every(it=>window.selectedItemIds.has(it.id));
    let html='<div style="display:flex;gap:0.4rem;margin-bottom:0.6rem;flex-wrap:wrap;align-items:center;">';
    const modes=[['purchase','매입(메인)'],['sales','매출'],['origin','원매입'],['all','전체보기']];
    modes.forEach(([k,l])=>{html+='<button class="tab-btn'+(window.currentViewMode===k?' active':'')+'" onclick="window.setViewMode(\''+k+'\')">'+l+'</button>';});
    html+='<button class="sort-btn" style="margin-left:auto;font-size:0.75rem;" onclick="window.selectSiteUnclassified('+si+')">📋 미분류 선택</button></div>';
    html+='<table class="data-table"><thead><tr>'
      +'<th style="padding-left:1rem;width:36px;text-align:center;"><input type="checkbox" onchange="window.toggleAllSiteItems('+si+',this.checked)" '+(allSel?'checked':'')+'></th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'date\')">일자 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'category\')">분류 ↕</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'itemName\')">품목명 ↕</th>'
      +'<th>규격</th><th>단위</th>'
      +'<th class="sortable-th" onclick="window.handleTableSort('+si+',\'qty\')">수량 ↕</th>';
    if(window.currentViewMode==='origin'||window.currentViewMode==='all')html+='<th>원매입단가</th><th>원매입금액</th>';
    if(window.currentViewMode==='purchase'||window.currentViewMode==='all')html+='<th>매입단가</th><th>매입금액</th>';
    if(window.currentViewMode==='sales'||window.currentViewMode==='all')html+='<th>매출단가</th><th>매출금액</th>';
    html+='<th>검증</th></tr></thead><tbody>';
    let sumOrg=0,sumP=0,sumS=0;
    items.forEach(item=>{
      const chk=window.selectedItemIds.has(item.id)?'checked':'';
      const bg=chk?'background-color:var(--surface-container-high);':'';
      let bc='unassigned'; if(item.category){const std=['잡자재','안전자재','기타자재','쇼핑몰'];bc='assigned cat-'+(std.includes(item.category)?item.category:'custom');}
      const bt=item.category||'미분류';
      let orgP=parseNum(item.originPurchUnit)||0,pP=parseNum(item.purchUnit)||0,sP=parseNum(item.salesUnit)||0,q=parseNum(item.qty)||0;
      sumOrg+=(parseNum(item.originPurchAmnt)||0);sumP+=(parseNum(item.purchAmnt)||0);sumS+=(parseNum(item.salesAmnt)||0);
      let w="";
      let eO=Math.round(pP*0.98);if(orgP!==eO)w+='원매입단가 오차('+Math.round(orgP-eO)+'원) ';
      let eS=Math.round(orgP*1.25);if(sP!==eS)w+='매출단가 오차('+Math.round(sP-eS)+'원) ';
      let cP=Math.round(pP*q),curP=parseNum(item.purchAmnt)||0;if(cP!==curP)w+='매입금액 오차('+Math.round(curP-cP)+'원) ';
      let vt=w===''?'<span style="color:var(--secondary);font-weight:700;font-size:0.78rem">✓</span>':'<span style="color:var(--error);font-size:0.75rem;font-weight:700">⚠ '+w+'</span>';
      html+='<tr style="'+bg+'">'
        +'<td style="padding-left:1rem;text-align:center;"><input type="checkbox" class="item-checkbox" data-id="'+item.id+'" onchange="window.toggleItem(\''+item.id+'\',this.checked,this)" '+chk+'></td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'date\',this)" class="editable-td">'+item.date+'</td>'
        +'<td ondblclick="window.editCategoryField(\''+item.id+'\',this)" class="editable-td category-cell"><span class="category-badge '+bc+'">'+bt+'</span></td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'itemName\',this)" class="editable-td">'+item.itemName+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'spec\',this)" class="editable-td">'+item.spec+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'unit\',this)" class="editable-td">'+item.unit+'</td>'
        +'<td ondblclick="window.editItemField(\''+item.id+'\',\'qty\',this)" class="editable-td">'+item.qty+'</td>';
      if(window.currentViewMode==='origin'||window.currentViewMode==='all')html+='<td ondblclick="window.editItemField(\''+item.id+'\',\'originPurchUnit\',this)" class="editable-td">'+item.originPurchUnit+'</td><td ondblclick="window.editItemField(\''+item.id+'\',\'originPurchAmnt\',this)" class="editable-td">'+item.originPurchAmnt+'</td>';
      if(window.currentViewMode==='purchase'||window.currentViewMode==='all')html+='<td ondblclick="window.editItemField(\''+item.id+'\',\'purchUnit\',this)" class="editable-td">'+item.purchUnit+'</td><td ondblclick="window.editItemField(\''+item.id+'\',\'purchAmnt\',this)" class="editable-td">'+item.purchAmnt+'</td>';
      if(window.currentViewMode==='sales'||window.currentViewMode==='all')html+='<td ondblclick="window.editItemField(\''+item.id+'\',\'salesUnit\',this)" class="editable-td">'+item.salesUnit+'</td><td ondblclick="window.editItemField(\''+item.id+'\',\'salesAmnt\',this)" class="editable-td">'+item.salesAmnt+'</td>';
      html+='<td>'+vt+'</td></tr>';
    });
    html+='</tbody></table>';
    let tS=site.totals.sales||0,tO=site.totals.originPurch||0,tP=site.totals.purch||0;
    let sn="";
    if(Math.abs(Math.round(sumS-tS))>=1)sn+=' [매출합계 오차 '+Math.round(sumS-tS)+'원]';
    if(Math.abs(Math.round(sumOrg-tO))>=1)sn+=' [원매입합계 오차 '+Math.round(sumOrg-tO)+'원]';
    if(Math.abs(Math.round(sumP-tP))>=1)sn+=' [매입합계 오차 '+Math.round(sumP-tP)+'원]';
    let ts="";
    if(window.currentViewMode==='purchase'||window.currentViewMode==='all')ts+='매입: '+tP.toLocaleString('ko-KR')+'원';
    if(window.currentViewMode==='origin'||window.currentViewMode==='all')ts+=(ts?' | ':'')+'원매입: '+tO.toLocaleString('ko-KR')+'원';
    if(window.currentViewMode==='sales'||window.currentViewMode==='all')ts+=(ts?' | ':'')+'매출: '+tS.toLocaleString('ko-KR')+'원';
    html+='<div style="margin-top:0.6rem;padding:0.6rem 1rem;background:var(--surface-container-lowest);border-radius:0.75rem;box-shadow:var(--shadow-sm);"><strong style="color:var(--secondary);font-size:0.88rem;">'+ts+'</strong>';
    if(sn)html+='<span style="color:var(--error);font-size:0.78rem;margin-left:0.75rem;font-weight:600;">'+sn+'</span>';
    html+='</div>';
    return html;
  }

  /* ===== Rendering ===== */
  function renderResults() {
    if(!globalSitesData.length){sitesContainer.innerHTML='';resultsSection.style.display='none';return;}
    let gP=0,gS=0,gO=0,gOk=0,gWarn=0,gUncat=0,gTotal=0;
    globalSitesData.forEach(site=>{
      let tP=0,tS=0,tO=0;
      site.filteredItems=site.items.filter(item=>{
        let match=false;
        if(window.currentTab==='전체')match=true;
        else if(window.currentTab==='직접입력')match=item.category&&!window.STANDARD_CATEGORIES.includes(item.category);
        else match=item.category===window.currentTab;
        // #4 검색 필터
        if(match&&searchQuery){const q=searchQuery;match=((item.itemName||'').toLowerCase().includes(q)||(item.spec||'').toLowerCase().includes(q)||(item.date||'').includes(q));}
        if(match){const p=parseNum(item.purchAmnt);if(!isNaN(p))tP+=p;const s=parseNum(item.salesAmnt);if(!isNaN(s))tS+=s;const o=parseNum(item.originPurchAmnt);if(!isNaN(o))tO+=o;}
        return match;
      });
      site.filteredTotalPurch=tP;site.filteredTotalSales=tS;site.filteredTotalOrg=tO;
      gP+=tP;gS+=tS;gO+=tO;
      const st=calcSiteStats(site);gOk+=st.ok;gWarn+=st.warn;gUncat+=st.uncat;gTotal+=st.total;
    });

    sitesContainer.innerHTML='';
    const sdiv=document.createElement('div');sdiv.className='summary-container';

    // #8 요약 대시보드
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

    // 대시보드 카드
    sh+='<div class="stats-dashboard">'
      +'<div class="stat-card clickable" onclick="window.showSiteListPopup()"><div class="stat-card-label">현장 수</div><div class="stat-card-value">'+globalSitesData.length+'곳</div></div>'
      +getGlobalAmountCards(gP, gS, gO)
      +'<div class="stat-card"><div class="stat-card-label">검증 정상</div><div class="stat-card-value success">'+gOk+'건</div></div>'
      +'<div class="stat-card clickable" onclick="window.showErrorPopup()"><div class="stat-card-label">검증 오류</div><div class="stat-card-value error">'+(gWarn>0?gWarn+'건':'없음')+'</div></div>'
      +'<div class="stat-card clickable" onclick="window.showUncatPopup()"><div class="stat-card-label">미분류</div><div class="stat-card-value">'+(gUncat>0?gUncat+'건':'완료 ✓')+'</div></div>'
      +'<div class="stat-card clickable" onclick="window.showClassRatePopup()"><div class="stat-card-label">분류 완료율</div><div class="stat-card-value success">'+pct+'%</div>'
      +'<div class="progress-bar-container"><div class="progress-bar-fill" style="width:'+pct+'%"></div></div></div>'
      +'</div>';

    // 뷰 모드 전환 버튼
    const vmodes=[['purchase','매입'],['sales','매출'],['origin','원매입'],['all','전체보기']];
    sh+='<div class="tab-container" style="margin-bottom:0.25rem;">';
    vmodes.forEach(([k,l])=>{sh+='<button class="tab-btn view-mode-btn'+(window.currentViewMode===k?' active':'')+'" onclick="window.setViewMode(\''+k+'\')">'+(k==='purchase'?'💰 ':k==='sales'?'📈 ':k==='origin'?'📦 ':'📊 ')+l+'</button>';});
    sh+='</div>';

    // #4 검색
    sh+='<div class="search-container"><span class="search-icon">🔍</span><input type="text" class="search-input" placeholder="품목명, 규격, 일자로 검색..." value="'+searchQuery+'" oninput="window.handleSearch(this.value)"></div>';

    // 탭
    const tabs=[['전체','전체보기'],['잡자재','잡자재'],['안전자재','안전자재'],['기타자재','기타자재'],['쇼핑몰','쇼핑몰'],['직접입력','직접입력 (기타)']];
    sh+='<div class="tab-container">';
    tabs.forEach(([k,l])=>{sh+='<button class="tab-btn'+(window.currentTab===k?' active':'')+'" onclick="window.setFilterTab(\''+k+'\')">'+l+'</button>';});
    sh+='</div><div class="summary-list">';

    // 전체 현장 칩
    sh+='<button class="summary-chip" style="background:var(--primary-fixed);border:2px solid var(--primary);" onclick="window.openSiteModal(-1)"><strong style="color:var(--primary);">📊 전체 현장</strong></button>';

    globalSitesData.forEach((site,idx)=>{
      if(window.currentTab!=='전체'&&(!site.filteredItems||!site.filteredItems.length))return;
      sh+='<button class="summary-chip" draggable="true" '
        +'onclick="window.openSiteModal('+idx+')" '
        +'ondragstart="window.handleChipDragStart(event,'+idx+')" ondragend="window.handleChipDragEnd(event)" '
        +'ondragover="window.handleChipDragOver(event)" ondragleave="window.handleChipDragLeave(event)" ondrop="window.handleChipDrop(event,'+idx+')">'
        +'<strong onclick="event.stopPropagation();" ondblclick="event.stopPropagation();window.editSiteName('+idx+',this)" class="editable-header" title="더블 클릭하여 현장명 수정">'
        +displaySiteName(site.siteName)+'</strong>'
        +'<span>'+getChipAmount(site)+'</span></button>';
    });
    sh+='</div>';
    sdiv.innerHTML=sh;sitesContainer.appendChild(sdiv);

    // 아코디언 카드
    globalSitesData.forEach((site,idx)=>{
      if(window.currentTab!=='전체'&&(!site.filteredItems||!site.filteredItems.length))return;
      const isExp=(expandedSiteIndex===idx);
      const card=document.createElement('div');card.className='site-card accordion-card'+(isExp?' expanded':'');card.id='site-card-'+idx;
      const st=calcSiteStats(site);
      const itemCount=(site.filteredItems||site.items).length;

      // #1 상태배지 + #3 항목개수
      let badges='<div class="status-badges">';
      if(st.ok>0)badges+='<span class="status-badge ok">✓'+st.ok+'</span>';
      if(st.warn>0)badges+='<span class="status-badge warn">⚠'+st.warn+'</span>';
      if(st.uncat>0)badges+='<span class="status-badge uncat">미분류 '+st.uncat+'</span>';
      badges+='</div>';

      // #2 프로그레스 바
      const sitePct=itemCount>0?Math.round((itemCount-st.uncat)/itemCount*100):100;

      let ch='<div class="accordion-header" onclick="window.toggleAccordion('+idx+')">'
        +'<div class="accordion-header-left">'
        +'<span class="accordion-arrow">'+(isExp?'▼':'▶')+'</span>'
        +'<h3 class="accordion-site-name" ondblclick="event.stopPropagation();window.editSiteName('+idx+',this)" class="editable-header">'+displaySiteName(site.siteName)+'</h3>'
        +'<span class="accordion-item-count">'+itemCount+'건</span>'
        +badges
        +'</div>'
        +'<div class="accordion-header-right">'
        +'<span class="accordion-amount">'+getAccordionAmount(site)+'</span>'
        +'<button class="sort-btn" style="font-size:0.75rem;" onclick="event.stopPropagation();window.openSiteModal('+idx+')">🔍 상세</button>'
        +'</div></div>';

      if(!isExp){
        ch+='<div style="padding:0 1.5rem 0.5rem;"><div class="progress-bar-container"><div class="progress-bar-fill" style="width:'+sitePct+'%"></div></div></div>';
      }

      if(isExp) ch+='<div class="accordion-body">'+buildSiteTable(site,idx)+'</div>';
      card.innerHTML=ch;sitesContainer.appendChild(card);
    });
    resultsSection.style.display='block';
  }

  /* ===== 엑셀 다운로드 ===== */
  window.downloadExcel = function() {
    if (!globalSitesData.length) return alert('다운로드할 데이터가 없습니다.');
    var wsData=[],merges=[],styleMap={};
    var monthStr='OO';
    for(var si=0;si<globalSitesData.length;si++){var its=globalSitesData[si].filteredItems||globalSitesData[si].items;for(var ii=0;ii<its.length;ii++){var d=its[ii].date;if(d&&d.includes('-')){monthStr=d.split('-')[1];break;}}if(monthStr!=='OO')break;}
    wsData.push(['평생건산 '+monthStr+'월 납품내역','','','','','','','']);
    merges.push({s:{r:0,c:0},e:{r:0,c:7}});
    var titleStyle={font:{name:'맑은 고딕',bold:true,sz:18},alignment:{horizontal:'center',vertical:'center'}};
    for(var tc=0;tc<=7;tc++)styleMap['r0c'+tc]=titleStyle;
    wsData.push(['발생일자','상품명','규격명','단위','수량','','매입','']);
    merges.push({s:{r:1,c:0},e:{r:2,c:0}},{s:{r:1,c:1},e:{r:2,c:1}},{s:{r:1,c:2},e:{r:2,c:2}},{s:{r:1,c:3},e:{r:2,c:3}},{s:{r:1,c:4},e:{r:2,c:4}},{s:{r:1,c:6},e:{r:1,c:7}});
    var hs={font:{name:'맑은 고딕',bold:true,sz:11},alignment:{horizontal:'center',vertical:'center'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
    for(var hc=0;hc<=7;hc++)styleMap['r1c'+hc]=hs;
    wsData.push(['','','','','','','단가','금액']);
    for(var hc2=0;hc2<=7;hc2++)styleMap['r2c'+hc2]=hs;
    globalSitesData.forEach(function(site){
      var sI=site.filteredItems||site.items;if(!sI||!sI.length)return;
      var sT=0;sI.forEach(function(it){var pn=parseNum(it.purchAmnt);if(!isNaN(pn))sT+=pn;});
      var sN=site.siteName.replace(/['']/g,'');
      var sRI=wsData.length;wsData.push([sN,'','','','','','','']);
      merges.push({s:{r:sRI,c:0},e:{r:sRI,c:7}});
      for(var sc=0;sc<=7;sc++)styleMap['r'+sRI+'c'+sc]={font:{name:'맑은 고딕',bold:true,sz:11},fill:{fgColor:{rgb:'B3D9FF'}},alignment:{horizontal:'left',vertical:'center'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
      sI.forEach(function(it){
        var nQ=parseNum(it.qty),nPr=parseNum(it.purchUnit),nA=parseNum(it.purchAmnt);
        wsData.push([it.date||'',it.itemName||'',it.spec||'',it.unit||'',!isNaN(nQ)?nQ:'','',!isNaN(nPr)?nPr:'',!isNaN(nA)?nA:'']);
        var ri=wsData.length-1;styleMap['r'+ri+'c0']={alignment:{horizontal:'center'}};for(var ci=4;ci<=7;ci++)styleMap['r'+ri+'c'+ci]={alignment:{horizontal:'right'}};
      });
      var smRI=wsData.length;wsData.push(['','계('+sN.replace(/^\(주\)케앤지/,'').replace(/^\(/,'').replace(/\)$/,'')+')','','','','','',Math.round(sT)]);
      merges.push({s:{r:smRI,c:1},e:{r:smRI,c:2}});
      for(var sc2=0;sc2<=7;sc2++)styleMap['r'+smRI+'c'+sc2]={font:{bold:true},fill:{fgColor:{rgb:'FFE0B2'}}};
    });
    var ws=XLSX.utils.aoa_to_sheet(wsData);ws['!merges']=merges;
    var range=XLSX.utils.decode_range(ws['!ref']);
    for(var R=range.s.r;R<=range.e.r;R++){for(var C=range.s.c;C<=range.e.c;C++){var addr=XLSX.utils.encode_cell({r:R,c:C});if(!ws[addr])ws[addr]={v:'',t:'s'};var key='r'+R+'c'+C;if(styleMap[key])ws[addr].s=styleMap[key];if(R>2&&C>=4&&typeof ws[addr].v==='number')ws[addr].z='#,##0';}}
    ws['!cols']=[{wch:15},{wch:20},{wch:15},{wch:6},{wch:8},{wch:4},{wch:12},{wch:14}];
    ws['!rows']=[{hpt:35},{hpt:20},{hpt:20}];for(var r=3;r<=range.e.r;r++)ws['!rows'].push({hpt:18});
    var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'평생건산 납품내역');
    var today=new Date();var dt=today.getFullYear()+''+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
    XLSX.writeFile(wb,'평생건산_납품내역_'+dt+'.xlsx');
  };
});