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

  // --- authFetch: JWT 토큰을 자동으로 실어 보내는 fetch 래퍼 ---
  async function authFetch(url, options = {}) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, options);
  }

  // --- 토스트 알림 ---
  function showToast(msg, type='info', duration=3000) {
    let container = document.getElementById('toastContainer');
    if(!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:99999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
      document.body.appendChild(container);
    }
    const colors = { info:'#1976D2', success:'#2E7D32', warning:'#E65100', error:'#C62828' };
    const icons = { info:'💾', success:'✅', warning:'⚠️', error:'❌' };
    const toast = document.createElement('div');
    toast.style.cssText = `pointer-events:auto;background:${colors[type]||colors.info};color:#fff;padding:0.8rem 1.2rem;border-radius:0.6rem;font-size:0.9rem;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transform:translateX(100%);transition:all 0.3s ease;display:flex;align-items:center;gap:0.5rem;max-width:360px;`;
    toast.innerHTML = `<span>${icons[type]||icons.info}</span><span>${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translateX(0)'; });
    setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(100%)'; setTimeout(() => toast.remove(), 300); }, duration);
  }

  // --- Auto Save & Load (개선) ---
  let lastSaveTime = null;

  function saveToLocalStorage() {
    if(globalSitesData.length === 0) { localStorage.removeItem('happySafety_autosave'); lastSaveTime = null; return; }
    const payload = {
      globalSitesData,
      categoryMemory,
      globalCategories: Array.from(window.globalCategories),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('happySafety_autosave', JSON.stringify(payload));
    lastSaveTime = new Date();
  }

  function restorePayload(parsed) {
    globalSitesData = parsed.globalSitesData || [];
    window.categoryMemory = parsed.categoryMemory || {};
    if(parsed.globalCategories) window.globalCategories = new Set(parsed.globalCategories);
    lastSaveTime = parsed.savedAt ? new Date(parsed.savedAt) : new Date();
  }
  
  function loadFromLocalStorage() {
    const saved = localStorage.getItem('happySafety_autosave');
    if(saved) {
      try {
        const parsed = JSON.parse(saved);
        restorePayload(parsed);
        renderResults();
        const timeStr = parsed.savedAt ? new Date(parsed.savedAt).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        showToast(`이전 작업을 자동 복원했습니다. ${timeStr ? '(' + timeStr + ')' : ''}`, 'success', 4000);
      } catch(e) { console.error('Failed to load autosave', e); }
    }
  }

  window.addEventListener('beforeunload', (e) => {
    // 페이지 떠나기 전 마지막 저장 보장
    if (globalSitesData.length > 0) {
      saveToLocalStorage();
      e.returnValue = '진행 중인 작업이 있습니다. 창을 닫으시겠습니까?';
    }
  });

  // --- 수동 저장 슬롯 관리 (NAS 서버) ---
  const SAVE_API = 'https://kng.junparks.com/api/happysafety/saves';
  const SAVE_SLOTS_KEY = 'happySafety_saveSlots'; // 마이그레이션용

  // 업로드 화면에 저장 목록 표시
  async function renderSavedSlots() {
    const section = document.getElementById('savedWorkSection');
    const container = document.getElementById('savedSlotsContainer');
    const countSpan = document.getElementById('savedWorkCount');
    if(!section || !container) return;

    try {
      const res = await authFetch(SAVE_API);
      if(!res.ok) throw new Error('fetch failed');
      const slots = await res.json();
      if(slots.length === 0) { section.style.display = 'none'; return; }

      section.style.display = 'block';
      countSpan.textContent = slots.length + '개';
      container.innerHTML = slots.map(slot => {
        const dt = new Date(slot.createdAt).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        const amt = (slot.totalAmount || 0).toLocaleString('ko-KR');
        return `<div class="saved-slot-card" onclick="window.loadServerSlot('${slot.id}')">
          <span class="saved-slot-icon">📋</span>
          <div class="saved-slot-info">
            <div class="saved-slot-name">${slot.name}</div>
            <div class="saved-slot-meta">${dt} · ${slot.siteCount}현장 · ${slot.itemCount}건 · ₩${amt}</div>
          </div>
          <button class="saved-slot-delete" onclick="event.stopPropagation();window.deleteServerSlot('${slot.id}','${slot.name.replace(/'/g,"\\'")}')">✕</button>
        </div>`;
      }).join('');
    } catch(e) {
      console.error('저장 목록 로드 실패:', e);
      section.style.display = 'none';
    }
  }

  window.manualSave = async function() {
    if(globalSitesData.length === 0) return alert('저장할 데이터가 없습니다.');
    const defaultName = new Date().toLocaleString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(/\./g, '-').trim();
    const name = prompt('저장 이름을 입력하세요:', defaultName);
    if(!name) return;

    const totalAmount = globalSitesData.reduce((sum, site) => {
      let siteTotal = 0;
      site.items.forEach(it => { const pn = parseNum(it.purchase); if(!isNaN(pn)) siteTotal += pn; });
      return sum + siteTotal;
    }, 0);

    try {
      const res = await authFetch(SAVE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          data: {
            globalSitesData,
            categoryMemory: window.categoryMemory,
            globalCategories: Array.from(window.globalCategories)
          },
          siteCount: globalSitesData.length,
          itemCount: globalSitesData.reduce((s, site) => s + site.items.length, 0),
          totalAmount: Math.round(totalAmount)
        })
      });
      if(res.ok) {
        showToast(`"${name}" 서버에 저장 완료!`, 'success');
        renderSavedSlots();
      } else {
        const err = await res.json();
        showToast('저장 실패: ' + (err.error || '서버 오류'), 'error');
      }
    } catch(e) {
      console.error(e);
      showToast('서버 연결 오류. 네트워크를 확인해주세요.', 'error');
    }
  };

  window.openSaveManager = async function() {
    let modal = document.getElementById('saveManagerModal');
    if(!modal) {
      modal = document.createElement('div');
      modal.id = 'saveManagerModal';
      modal.className = 'site-modal-overlay';
      modal.onclick = function(e) { if(e.target === modal) modal.style.display = 'none'; };
      document.body.appendChild(modal);
    }

    modal.innerHTML = '<div class="site-modal" style="max-width:520px;"><div class="site-modal-header"><h3>💾 저장 관리</h3><button class="site-modal-close" onclick="document.getElementById(\'saveManagerModal\').style.display=\'none\'">&times;</button></div><div class="site-modal-body" style="padding:1rem;"><p style="text-align:center;color:var(--text-muted);padding:2rem;">불러오는 중...</p></div></div>';
    modal.style.display = 'flex';

    try {
      const res = await authFetch(SAVE_API);
      if(!res.ok) throw new Error('fetch failed');
      const slots = await res.json();
      
      let html = '<div class="site-modal" style="max-width:520px;">'
        + '<div class="site-modal-header"><h3>💾 저장 관리 (' + slots.length + '개)</h3><button class="site-modal-close" onclick="document.getElementById(\'saveManagerModal\').style.display=\'none\'">&times;</button></div>'
        + '<div class="site-modal-body" style="padding:1rem;">';

      if(slots.length === 0) {
        html += '<p style="text-align:center;color:var(--text-muted);padding:2rem;">저장된 내역이 없습니다.<br><small>작업 중 💾 저장 버튼을 눌러 저장하세요.</small></p>';
      } else {
        html += '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
        slots.forEach(slot => {
          const dt = new Date(slot.createdAt).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
          const amt = (slot.totalAmount || 0).toLocaleString('ko-KR');
          html += `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.7rem 1rem;border-radius:0.5rem;background:var(--surface-container-high);">`
            + `<div style="flex:1;"><strong style="font-size:0.95rem;">${slot.name}</strong>`
            + `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.2rem;">${dt} · ${slot.siteCount}현장 · ${slot.itemCount}건 · ₩${amt}</div></div>`
            + `<button class="sort-btn" style="font-size:0.8rem;background:#E8F5E9;border-color:#4CAF50;color:#1B5E20;" onclick="window.loadServerSlot('${slot.id}')">불러오기</button>`
            + `<button class="sort-btn" style="font-size:0.8rem;background:#FFEBEE;border-color:#EF5350;color:#C62828;" onclick="window.deleteServerSlot('${slot.id}','${slot.name.replace(/'/g,"\\'")}')">삭제</button>`
            + `</div>`;
        });
        html += '</div>';
      }
      html += '</div></div>';
      modal.innerHTML = html;
    } catch(e) {
      console.error(e);
      modal.innerHTML = '<div class="site-modal" style="max-width:520px;"><div class="site-modal-header"><h3>💾 저장 관리</h3><button class="site-modal-close" onclick="document.getElementById(\'saveManagerModal\').style.display=\'none\'">&times;</button></div><div class="site-modal-body" style="padding:1rem;"><p style="text-align:center;color:var(--error);padding:2rem;">서버 연결 오류</p></div></div>';
    }
  };

  window.loadServerSlot = async function(id) {
    if(globalSitesData.length > 0 && !confirm('현재 작업을 덮어쓰게 됩니다. 계속하시겠습니까?')) return;
    try {
      const res = await authFetch(SAVE_API + '/' + id);
      if(!res.ok) throw new Error('fetch failed');
      const slot = await res.json();
      if(slot.data) {
        restorePayload(slot.data);
        renderResults();
        const modal = document.getElementById('saveManagerModal');
        if(modal) modal.style.display = 'none';
        showToast(`"${slot.name}" 불러오기 완료!`, 'success');
      }
    } catch(e) {
      console.error(e);
      showToast('불러오기 실패. 서버를 확인해주세요.', 'error');
    }
  };

  window.deleteServerSlot = async function(id, name) {
    if(!confirm(`"${name}" 저장을 삭제하시겠습니까?`)) return;
    try {
      const res = await authFetch(SAVE_API + '/' + id, { method: 'DELETE' });
      if(res.ok) {
        showToast('저장 내역이 삭제되었습니다.', 'warning');
        window.openSaveManager(); // 모달 새로고침
        renderSavedSlots(); // 업로드 화면도 갱신
      } else {
        showToast('삭제 실패', 'error');
      }
    } catch(e) {
      console.error(e);
      showToast('서버 연결 오류', 'error');
    }
  };

  window.resetWork = function() {
    if(globalSitesData.length === 0) return;
    if(!confirm('현재 작업 내역을 모두 초기화하시겠습니까?\n(서버 저장 내역은 유지됩니다)')) return;
    globalSitesData = []; historyStack = []; window.selectedItemIds.clear(); expandedSiteIndex = -1; searchQuery = '';
    updateFloatingBar(); renderResults();
    showToast('작업이 초기화되었습니다.', 'info');
  };

  function getSaveTimeLabel() {
    if(!lastSaveTime) return '';
    return lastSaveTime.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  // --- localStorage → 서버 마이그레이션 ---
  async function migrateLocalStorageToServer() {
    const oldSlots = localStorage.getItem(SAVE_SLOTS_KEY);
    if(!oldSlots) return;
    try {
      const slots = JSON.parse(oldSlots);
      if(!Array.isArray(slots) || slots.length === 0) { localStorage.removeItem(SAVE_SLOTS_KEY); return; }
      
      let migrated = 0;
      for(const slot of slots) {
        try {
          const totalAmount = (slot.globalSitesData || []).reduce((sum, site) => {
            let siteTotal = 0;
            (site.items || []).forEach(it => { const pn = parseNum(it.purchase); if(!isNaN(pn)) siteTotal += pn; });
            return sum + siteTotal;
          }, 0);

          const res = await authFetch(SAVE_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: slot.name || '마이그레이션 데이터',
              data: {
                globalSitesData: slot.globalSitesData,
                categoryMemory: slot.categoryMemory,
                globalCategories: slot.globalCategories
              },
              siteCount: slot.siteCount || 0,
              itemCount: slot.itemCount || 0,
              totalAmount: Math.round(totalAmount)
            })
          });
          if(res.ok) migrated++;
        } catch(e) { console.error('마이그레이션 개별 실패:', e); }
      }
      if(migrated > 0) {
        localStorage.removeItem(SAVE_SLOTS_KEY);
        showToast(`기존 저장 ${migrated}건을 서버로 이전했습니다.`, 'success', 5000);
        renderSavedSlots();
      }
    } catch(e) { console.error('마이그레이션 실패:', e); }
  }

  loadFromLocalStorage();
  renderSavedSlots();
  migrateLocalStorageToServer();
  // -------------------------

  // #5 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); window.undoAction(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); window.manualSave(); }
    if (e.key === 'Escape') { const m=document.getElementById('siteModal'); if(m&&m.style.display==='flex') window.closeSiteModal(); const sm=document.getElementById('saveManagerModal'); if(sm&&sm.style.display==='flex') sm.style.display='none'; }
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

  window.handleChipDragStart=function(e,i){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('sourceIndex',i);e.dataTransfer.setData('shiftKey',e.shiftKey?'1':'0');setTimeout(()=>e.target.classList.add('dragging'),0);};
  window.handleChipDragEnd=function(e){e.target.classList.remove('dragging');document.querySelectorAll('.drag-over-chip,.drag-reorder-chip').forEach(el=>{el.classList.remove('drag-over-chip','drag-reorder-chip');});};
  window.handleChipDragOver=function(e){e.preventDefault();e.dataTransfer.dropEffect='move';if(e.shiftKey){e.currentTarget.classList.add('drag-over-chip');e.currentTarget.classList.remove('drag-reorder-chip');}else{e.currentTarget.classList.add('drag-reorder-chip');e.currentTarget.classList.remove('drag-over-chip');}};
  window.handleChipDragLeave=function(e){e.currentTarget.classList.remove('drag-over-chip','drag-reorder-chip');};
  window.handleChipDrop=function(e,ti){e.preventDefault();e.currentTarget.classList.remove('drag-over-chip','drag-reorder-chip');const si=parseInt(e.dataTransfer.getData('sourceIndex'),10);if(isNaN(si)||si===ti)return;
    if(e.shiftKey){
      // Shift+드래그: 병합
      const src=globalSitesData[si],tgt=globalSitesData[ti];
      if(confirm('"'+src.siteName+'" → "'+tgt.siteName+'" 병합하시겠습니까?')){saveState();tgt.items.push(...src.items);tgt.items.sort((a,b)=>{let d=String(a.date||"").localeCompare(String(b.date||""));return d!==0?d:(parseInt(a.seqNo)||0)-(parseInt(b.seqNo)||0);});tgt.sortConfig=[{col:'date',asc:true},{col:'seqNo',asc:true}];globalSitesData.splice(si,1);updateFloatingBar();renderResults();}
    } else {
      // 일반 드래그: 순서 변경
      saveState();const [moved]=globalSitesData.splice(si,1);globalSitesData.splice(ti,0,moved);renderResults();
    }
  };
  window.moveSiteOrder=function(si,dir){const ni=si+dir;if(ni<0||ni>=globalSitesData.length)return;saveState();const temp=globalSitesData[si];globalSitesData[si]=globalSitesData[ni];globalSitesData[ni]=temp;if(expandedSiteIndex===si)expandedSiteIndex=ni;else if(expandedSiteIndex===ni)expandedSiteIndex=si;renderResults();};

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
    saveToLocalStorage();
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

    const saveTimeLabel = getSaveTimeLabel();
    let sh='<div class="summary-header">'
      +'<h3 style="margin:0;font-size:1.1rem;color:var(--primary);font-weight:800;">전체 현장 요약</h3>'
      +'<div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">'
      +(saveTimeLabel ? '<span style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.6rem;background:var(--surface-container-highest);border-radius:0.4rem;">💾 자동저장 '+saveTimeLabel+'</span>' : '')
      +'<button class="sort-btn" onclick="window.manualSave()" style="background:#E3F2FD;border-color:#1976D2;color:#0D47A1;font-weight:600;">💾 저장</button>'
      +'<button class="sort-btn" onclick="window.openSaveManager()" style="background:#F3E5F5;border-color:#9C27B0;color:#6A1B9A;">📂 불러오기</button>'
      +'<button class="sort-btn" onclick="window.resetWork()" style="background:#FFF3E0;border-color:#FF9800;color:#E65100;">🗑 초기화</button>'
      +'<span style="width:1px;height:1.4rem;background:var(--outline-variant);"></span>'
      +'<button class="sort-btn" onclick="window.undoAction()" '+(historyStack.length===0?'disabled':'style="color:var(--primary);font-weight:800;border-color:var(--primary);"')+' title="Ctrl+Z">↩ 실행 취소</button>'
      +'<button class="sort-btn" onclick="window.sortByName()">가나다순 ↕</button>'
      +'<button class="sort-btn" onclick="window.sortByAmount()">금액순 ↕</button>'
      +'<button class="sort-btn" onclick="window.selectAllUnclassified()" style="background:#FFF3E0;border-color:#FF9800;color:#E65100;">📋 미분류 일괄</button>'
      +'<button class="sort-btn" onclick="window.downloadExcel()" style="background:var(--secondary-container);color:var(--on-secondary-container);">📥 엑셀</button>'
      +'<button class="sort-btn" onclick="window.sendToSupplyHistory()" style="background:#E8F5E9;border-color:#4CAF50;color:#1B5E20;">📤 공급내역 전송</button></div></div>';

    // #8 대시보드 카드
    sh+='<div class="stats-dashboard">'
      +'<div class="stat-card"><div class="stat-card-label">현장 수</div><div class="stat-card-value">'+globalSitesData.length+'곳</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">매입 합계</div><div class="stat-card-value">'+Math.round(gTP).toLocaleString('ko-KR')+'</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">미분류</div><div class="stat-card-value">'+(gUncat>0?gUncat+'건':'완료 ✓')+'</div></div>'
      +'<div class="stat-card"><div class="stat-card-label">분류 완료율</div><div class="stat-card-value success">'+pct+'%</div>'
      +'<div class="progress-bar-container"><div class="progress-bar-fill" style="width:'+pct+'%"></div></div></div>'
      +'</div>';

    sh+='<div class="search-container"><span class="search-icon">🔍</span><input type="text" class="search-input" placeholder="품목명, 일자, No.로 검색..." value="'+searchQuery+'" oninput="window.handleSearch(this.value)"></div>';

    const tabs=[['전체','전체보기'],['잡자재','잡자재'],['안전자재','안전자재'],['기타자재','기타자재'],['쇼핑몰','쇼핑몰'],['직접입력','직접입력 (기타)']];
    sh+='<div class="tab-container">';
    tabs.forEach(([k,l])=>{sh+='<button class="tab-btn'+(window.currentTab===k?' active':'')+'" onclick="window.setFilterTab(\''+k+'\')">'+l+'</button>';});
    sh+='</div>'
      +'<div style="margin-bottom: 0.8rem; font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.5rem; background: var(--surface-container-highest); padding: 0.6rem 1rem; border-radius: 0.5rem;">'
      +'<span style="font-size: 1rem;">💡</span>'
      +'<span>현장 칩을 <strong>드래그</strong>하여 순서를 변경하거나, <strong>Shift 키 + 드래그</strong>하여 현장을 병합할 수 있습니다.</span>'
      +'</div>'
      +'<div class="summary-list">';

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
        +'<div class="order-controls" onclick="event.stopPropagation()">'
        +'<button class="order-btn" onclick="window.moveSiteOrder('+idx+',-1)" '+(idx===0?'disabled':'')+' title="위로 이동">▲</button>'
        +'<span class="order-num">'+(idx+1)+'</span>'
        +'<button class="order-btn" onclick="window.moveSiteOrder('+idx+',1)" '+(idx===globalSitesData.length-1?'disabled':'')+' title="아래로 이동">▼</button>'
        +'</div>'
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

  /* ===== 공급내역 전송 ===== */
  window.sendToSupplyHistory = async function() {
    if(!globalSitesData.length) return alert('전송할 데이터가 없습니다.');

    // 미분류 체크
    let uncatCount = 0;
    globalSitesData.forEach(s => s.items.forEach(it => { if(!it.category) uncatCount++; }));
    if(uncatCount > 0) {
      if(!confirm(`아직 미분류 항목이 ${uncatCount}건 있습니다.\n미분류 항목은 "미분류"로 전송됩니다. 계속하시겠습니까?`)) return;
    }

    // 전송할 데이터 구성
    const bulkItems = [];
    const today = new Date();
    const yearPrefix = today.getFullYear().toString();
    // 현재 월 기준으로 일자 변환 (MMDD → YYYY-MM-DD)
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    const currentYear = today.getFullYear();

    globalSitesData.forEach(site => {
      site.items.forEach(it => {
        // 매입란(purchase)이 있는 행은 현장 소계이므로 제외 (마지막 행)
        // 실제 품목 데이터만 전송
        const itemName = (it.itemName || '').trim();
        if(!itemName) return;

        // 수량, 단가, 판매금액 파싱
        const qty = parseNum(it.qty) || 0;
        const price = parseNum(it.unitPrice) || 0;
        const total = parseNum(it.sales) || 0;
        if(qty === 0 && price === 0 && total === 0) return; // 빈 행 제외

        // 일자 변환: 엑셀 원본은 "MMDD" 또는 "MDD" 형태
        let dateStr = (it.date || '').trim();
        let supplyDate = '';
        if(dateStr.length >= 3 && dateStr.length <= 4) {
          const mm = dateStr.length === 4 ? dateStr.substring(0, 2) : '0' + dateStr.substring(0, 1);
          const dd = dateStr.length === 4 ? dateStr.substring(2, 4) : dateStr.substring(1, 3);
          supplyDate = currentYear + '-' + mm + '-' + dd;
        }

        bulkItems.push({
          id: 'SH-HS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          supplyDate,
          site: site.siteName,
          supplier: '행복한안전',
          manufacturer: '',
          item: itemName,
          qty,
          price,
          total,
          category: it.category || '미분류'
        });
      });
    });

    if(bulkItems.length === 0) return alert('전송할 품목이 없습니다.');

    const msg = `총 ${bulkItems.length}건의 품목을 일반 자재 공급내역으로 전송합니다.\n\n` +
      `• 현장: ${globalSitesData.length}곳\n` +
      `• 공급사: 행복한안전 (자동)\n` +
      `• 합계: ₩${bulkItems.reduce((s,i) => s + i.total, 0).toLocaleString()}\n\n` +
      `전송하시겠습니까?`;
    if(!confirm(msg)) return;

    try {
      const res = await authFetch('https://kng.junparks.com/api/supply-history/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bulkItems)
      });
      if(res.ok) {
        const result = await res.json();
        alert(`✅ 전송 완료!\n\n${result.insertedCount || bulkItems.length}건이 공급내역에 등록되었습니다.\n(중복 항목은 자동으로 건너뜁니다)`);
      } else {
        const err = await res.json();
        alert('❌ 전송 실패: ' + (err.error || '서버 오류'));
      }
    } catch(e) {
      console.error(e);
      alert('❌ 서버 연결 오류. 네트워크 상태를 확인해주세요.');
    }
  };
});
