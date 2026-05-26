/**
 * 본사 매입 현황 — 라벨 출력
 * Logo templates, drag-and-drop layout, save/load, print
 */
(function () {
    'use strict';
    async function authFetch(url, o = {}) {
        let t = null;
        try { if (window.parent && window.parent.getAuthToken) t = await window.parent.getAuthToken(); } catch (e) {}
        if (!o.headers) o.headers = {};
        if (t) o.headers['Authorization'] = 'Bearer ' + t;
        return fetch(url, o);
    }
    const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api/hq' : 'https://kng.junparks.com/api/hq';
    const $ = id => document.getElementById(id);
    const esc = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    let labels = [], specs = [], logoTemplates = [], currentLabelId = null, editingSpecId = null;
    // layout: { logo:{x,y}, product:{x,y}, mfr:{x,y}, price:{x,y}, info:{x,y}, memo:{x,y} }
    // Values are percentages (0-100) within label cell
    let layout = {};

    function toast(msg, type = 'info') {
        const c = $('toastContainer'); if (!c) return;
        const ic = { success:'bx-check-circle', error:'bx-error-circle', warning:'bx-error', info:'bx-info-circle' };
        const t = document.createElement('div'); t.className = 'toast ' + type;
        t.innerHTML = `<i class='bx ${ic[type]||ic.info}'></i> <span>${esc(msg)}</span>`;
        c.appendChild(t); setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    // ── Tabs ──
    function initTabs() {
        document.querySelectorAll('.header-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.header-tab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const p = $('panel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
                if (p) p.classList.add('active');
                if (btn.dataset.tab === 'saved') renderSavedList();
                if (btn.dataset.tab === 'specs') renderSpecList();
            });
        });
    }
    function switchTab(n) {
        document.querySelectorAll('.header-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === n));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const p = $('panel' + n.charAt(0).toUpperCase() + n.slice(1));
        if (p) p.classList.add('active');
    }

    // ── Logo Upload ──
    function initLogoUpload() {
        const fi = $('logoFileInput');
        $('btnUploadLogo').addEventListener('click', () => fi.click());
        $('logoPreview').addEventListener('click', () => fi.click());
        $('btnClearLogo').addEventListener('click', () => {
            $('logoImg').src = ''; $('logoImg').style.display = 'none';
            $('logoPlaceholder').style.display = ''; updatePreview();
        });
        fi.addEventListener('change', e => {
            const f = e.target.files[0]; if (!f) return;
            if (f.size > 2*1024*1024) { toast('2MB 이하만 가능합니다.','warning'); return; }
            const r = new FileReader();
            r.onload = ev => { $('logoImg').src = ev.target.result; $('logoImg').style.display = ''; $('logoPlaceholder').style.display = 'none'; updatePreview(); };
            r.readAsDataURL(f); fi.value = '';
        });
    }

    // ── Logo Templates ──
    async function fetchLogoTemplates() {
        try { const r = await authFetch(API+'/logo-templates'); if (r.ok) logoTemplates = await r.json(); } catch(e){}
        populateLogoTemplateSelect();
    }
    function populateLogoTemplateSelect() {
        const sel = $('logoTemplateSelect');
        sel.innerHTML = '<option value="">— 저장된 로고 불러오기 —</option>' +
            logoTemplates.map(t => `<option value="${t.id}">${esc(t.manufacturer)}</option>`).join('');
    }
    function initLogoTemplates() {
        $('logoTemplateSelect').addEventListener('change', () => {
            const tpl = logoTemplates.find(t => t.id === $('logoTemplateSelect').value);
            if (tpl && tpl.logoBase64) {
                $('logoImg').src = tpl.logoBase64; $('logoImg').style.display = '';
                $('logoPlaceholder').style.display = 'none'; updatePreview();
                toast(tpl.manufacturer + ' 로고 적용', 'success');
            }
        });
        $('btnSaveLogoTpl').addEventListener('click', async () => {
            const logo = $('logoImg').style.display !== 'none' ? $('logoImg').src : '';
            if (!logo) { toast('로고를 먼저 선택해주세요.','warning'); return; }
            const mfr = $('lblManufacturer').value.trim() || prompt('저장할 제조사명을 입력하세요:');
            if (!mfr) return;
            try {
                const r = await authFetch(API+'/logo-templates', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ manufacturer: mfr, logoBase64: logo }) });
                if (!r.ok) throw new Error((await r.json()).error);
                await fetchLogoTemplates(); toast(mfr+' 로고 템플릿 저장 완료','success');
            } catch(e) { toast('저장 실패: '+e.message,'error'); }
        });
        $('btnDeleteLogoTpl').addEventListener('click', async () => {
            const id = $('logoTemplateSelect').value;
            if (!id) { toast('삭제할 템플릿을 선택하세요.','warning'); return; }
            if (!confirm('이 로고 템플릿을 삭제하시겠습니까?')) return;
            try {
                const r = await authFetch(API+'/logo-templates/'+id, { method:'DELETE' });
                if (!r.ok) throw new Error((await r.json()).error);
                await fetchLogoTemplates(); toast('삭제 완료','success');
            } catch(e) { toast(e.message,'error'); }
        });
    }

    // ── Data ──
    function collectData() {
        return {
            name: $('lblName').value.trim(), productName: $('lblProductName').value.trim(),
            manufacturer: $('lblManufacturer').value.trim(), price: $('lblPrice').value.trim(),
            origin: $('lblOrigin').value.trim(), spec: $('lblSpec').value.trim(),
            barcode: $('lblBarcode').value.trim(), memo: $('lblMemo').value.trim(),
            logoBase64: $('logoImg').style.display !== 'none' ? $('logoImg').src : '',
            extraFields: [], layout: layout
        };
    }
    function loadData(d) {
        $('lblName').value = d.name||''; $('lblProductName').value = d.productName||'';
        $('lblManufacturer').value = d.manufacturer||''; $('lblPrice').value = d.price||'';
        $('lblOrigin').value = d.origin||''; $('lblSpec').value = d.spec||'';
        $('lblBarcode').value = d.barcode||''; $('lblMemo').value = d.memo||'';
        if (d.logoBase64) { $('logoImg').src = d.logoBase64; $('logoImg').style.display = ''; $('logoPlaceholder').style.display = 'none'; }
        else { $('logoImg').src = ''; $('logoImg').style.display = 'none'; $('logoPlaceholder').style.display = ''; }
        try { layout = typeof d.layout === 'string' ? JSON.parse(d.layout||'{}') : (d.layout||{}); } catch(e) { layout = {}; }
        updatePreview();
    }
    function resetEditor() { currentLabelId = null; layout = {}; loadData({}); $('printQty').value = 1; }

    // ── Default layout positions (percentage within label) ──
    function defaultPositions() {
        return { logo:{x:50,y:15}, product:{x:50,y:38}, mfr:{x:50,y:52}, price:{x:50,y:66}, info:{x:50,y:80}, memo:{x:50,y:92} };
    }
    function getPos(key) {
        const def = defaultPositions();
        return (layout && layout[key]) ? layout[key] : def[key];
    }

    // ── Preview with drag ──
    function getSelectedSpec() { const id = $('specSelect').value; return specs.find(s => s.id === id) || specs[0] || null; }

    function updatePreview() {
        const sp = getSelectedSpec(), container = $('previewContainer');
        if (!sp) { container.innerHTML = '<div class="empty-state"><i class="bx bx-ruler"></i><p>용지 규격을 선택해주세요.</p></div>'; return; }
        const d = collectData();
        const scale = 2.5;
        const pw = sp.paperWidth*scale, ph = sp.paperHeight*scale;
        const ml = sp.marginLeft*scale, mr = sp.marginRight*scale, mt = sp.marginTop*scale, mb = sp.marginBottom*scale;
        const gx = sp.gapX*scale, gy = sp.gapY*scale;
        const lw = (pw - ml - mr - (sp.cols-1)*gx) / sp.cols;
        const lh = (ph - mt - mb - (sp.rows-1)*gy) / sp.rows;
        const fs = Math.max(7, Math.min(12, lw/7));

        // Build elements list
        const els = [];
        if (d.logoBase64) els.push({ key:'logo', html:`<img class="lbl-logo" src="${d.logoBase64}" style="max-height:${lh*0.28}px;max-width:${lw*0.6}px;">` });
        if (d.productName) els.push({ key:'product', html:`<div class="lbl-product" style="max-width:${lw-4}px;">${esc(d.productName)}</div>` });
        if (d.manufacturer) els.push({ key:'mfr', html:`<div class="lbl-mfr" style="max-width:${lw-4}px;">${esc(d.manufacturer)}</div>` });
        if (d.price) els.push({ key:'price', html:`<div class="lbl-price">${esc(d.price)}</div>` });
        const infoParts = [d.origin, d.spec, d.barcode].filter(Boolean);
        if (infoParts.length) els.push({ key:'info', html:`<div class="lbl-info" style="max-width:${lw-4}px;">${esc(infoParts.join(' | '))}</div>` });
        if (d.memo) els.push({ key:'memo', html:`<div class="lbl-info" style="max-width:${lw-4}px;">${esc(d.memo)}</div>` });

        let html = `<div class="preview-sheet" style="width:${pw}px;height:${ph}px;position:relative;">`;
        // Only render first label interactively, rest as copies
        for (let r = 0; r < sp.rows; r++) {
            for (let c = 0; c < sp.cols; c++) {
                const x = ml + c*(lw+gx), y = mt + r*(lh+gy);
                const isFirst = (r===0 && c===0);
                html += `<div class="preview-label${isFirst?' first-label':''}" data-first="${isFirst}" style="position:absolute;left:${x}px;top:${y}px;width:${lw}px;height:${lh}px;font-size:${fs}px;">`;
                for (const el of els) {
                    const pos = getPos(el.key);
                    html += `<div class="lbl-el" data-key="${el.key}" style="left:${pos.x}%;top:${pos.y}%;transform:translate(-50%,-50%);">${el.html}</div>`;
                }
                html += '</div>';
            }
        }
        html += '</div>';
        container.innerHTML = html;
        // Attach drag only to first label
        initDrag(container.querySelector('.first-label'), lw, lh);
    }

    // ── Drag-and-drop ──
    function initDrag(labelEl, lw, lh) {
        if (!labelEl) return;
        labelEl.querySelectorAll('.lbl-el').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                const key = el.dataset.key;
                const rect = labelEl.getBoundingClientRect();
                el.classList.add('dragging');
                const onMove = ev => {
                    const px = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                    const py = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
                    el.style.left = px + '%'; el.style.top = py + '%';
                };
                const onUp = ev => {
                    el.classList.remove('dragging');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    const px = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                    const py = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
                    if (!layout) layout = {};
                    layout[key] = { x: Math.round(px*10)/10, y: Math.round(py*10)/10 };
                    updatePreview(); // re-render all labels with new positions
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
    }

    // ── Save/Load Labels ──
    async function fetchLabels() { try { const r = await authFetch(API+'/labels'); if (r.ok) labels = await r.json(); } catch(e){} }
    async function saveLabel() {
        const d = collectData();
        if (!d.name) { toast('라벨 이름을 입력해주세요.','warning'); return; }
        try {
            const url = currentLabelId ? `${API}/labels/${currentLabelId}` : `${API}/labels`;
            const r = await authFetch(url, { method: currentLabelId?'PUT':'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d) });
            const res = await r.json(); if (!r.ok) throw new Error(res.error);
            if (!currentLabelId) currentLabelId = res.id;
            await fetchLabels(); toast('저장 완료','success');
        } catch(e) { toast('저장 실패: '+e.message,'error'); }
    }
    async function deleteLabel(id) {
        if (!confirm('삭제하시겠습니까?')) return;
        try {
            const r = await authFetch(API+'/labels/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ids:[id]}) });
            if (!r.ok) throw new Error((await r.json()).error);
            if (currentLabelId===id) resetEditor();
            await fetchLabels(); renderSavedList(); toast('삭제 완료','success');
        } catch(e) { toast(e.message,'error'); }
    }
    function renderSavedList() {
        const list = $('savedList');
        if (!labels.length) { list.innerHTML = '<div class="empty-state"><i class="bx bx-folder-open"></i><p>저장된 라벨이 없습니다.</p></div>'; return; }
        list.innerHTML = labels.map(l => `<div class="saved-item ${l.id===currentLabelId?'active':''}" data-id="${l.id}"><div class="saved-item-info"><div class="saved-item-name">${esc(l.name||'(이름 없음)')}</div><div class="saved-item-detail">${esc(l.productName||'')} ${l.manufacturer?'· '+esc(l.manufacturer):''}</div></div><div class="saved-item-actions"><button class="btn-delete" data-id="${l.id}" title="삭제"><i class='bx bx-trash'></i></button></div></div>`).join('');
        list.querySelectorAll('.saved-item').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('.btn-delete')) return;
                const lbl = labels.find(l => l.id === el.dataset.id);
                if (lbl) { currentLabelId = lbl.id; loadData(lbl); renderSavedList(); switchTab('editor'); }
            });
        });
        list.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteLabel(b.dataset.id); }));
    }

    // ── Paper Specs ──
    async function fetchSpecs() {
        try { const r = await authFetch(API+'/label-specs'); if (r.ok) specs = await r.json(); } catch(e){}
        const sel = $('specSelect'), prev = sel.value;
        sel.innerHTML = specs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
        if (prev && specs.find(s => s.id===prev)) sel.value = prev;
        else if (specs.length) sel.value = specs[0].id;
        updatePreview();
    }
    function renderSpecList() {
        const list = $('specList');
        list.innerHTML = specs.map(s => `<div class="spec-item"><div class="spec-item-header"><div class="spec-item-name">${esc(s.name)} ${s.isDefault?'<span class="spec-default-badge">기본</span>':''}</div><div class="spec-actions"><button class="btn-edit-spec" data-id="${s.id}"><i class='bx bx-edit'></i></button>${!s.isDefault?`<button class="btn-delete-spec" data-id="${s.id}"><i class='bx bx-trash'></i></button>`:''}</div></div><div class="spec-item-detail"><span>${s.paperWidth}×${s.paperHeight}mm</span><span>${s.cols}열×${s.rows}행 (${s.cols*s.rows}칸)</span><span>여백 ${s.marginTop}/${s.marginBottom}/${s.marginLeft}/${s.marginRight}</span></div></div>`).join('');
        list.querySelectorAll('.btn-edit-spec').forEach(b => b.addEventListener('click', () => openSpecModal(b.dataset.id)));
        list.querySelectorAll('.btn-delete-spec').forEach(b => b.addEventListener('click', () => deleteSpec(b.dataset.id)));
    }
    function openSpecModal(id) {
        editingSpecId = id||null; const sp = id ? specs.find(s=>s.id===id) : null;
        $('specModalTitle').textContent = sp ? '용지 규격 수정' : '용지 규격 추가';
        $('specName').value = sp?sp.name:''; $('specPaperWidth').value = sp?sp.paperWidth:210; $('specPaperHeight').value = sp?sp.paperHeight:297;
        $('specCols').value = sp?sp.cols:3; $('specRows').value = sp?sp.rows:7;
        $('specMarginTop').value = sp?sp.marginTop:15; $('specMarginBottom').value = sp?sp.marginBottom:15;
        $('specMarginLeft').value = sp?sp.marginLeft:7; $('specMarginRight').value = sp?sp.marginRight:7;
        $('specGapX').value = sp?sp.gapX:2; $('specGapY').value = sp?sp.gapY:0;
        $('specModalOverlay').classList.add('active');
    }
    async function saveSpec() {
        const d = { name:$('specName').value.trim(), paperWidth:parseFloat($('specPaperWidth').value)||210, paperHeight:parseFloat($('specPaperHeight').value)||297, cols:parseInt($('specCols').value)||3, rows:parseInt($('specRows').value)||7, marginTop:parseFloat($('specMarginTop').value)||0, marginBottom:parseFloat($('specMarginBottom').value)||0, marginLeft:parseFloat($('specMarginLeft').value)||0, marginRight:parseFloat($('specMarginRight').value)||0, gapX:parseFloat($('specGapX').value)||0, gapY:parseFloat($('specGapY').value)||0 };
        if (!d.name) { toast('규격 이름을 입력해주세요.','warning'); return; }
        try {
            const url = editingSpecId ? `${API}/label-specs/${editingSpecId}` : `${API}/label-specs`;
            const r = await authFetch(url, { method:editingSpecId?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) });
            if (!r.ok) throw new Error((await r.json()).error);
            await fetchSpecs(); renderSpecList(); $('specModalOverlay').classList.remove('active');
            toast(editingSpecId?'수정 완료':'추가 완료','success');
        } catch(e) { toast(e.message,'error'); }
    }
    async function deleteSpec(id) {
        if (!confirm('삭제하시겠습니까?')) return;
        try { const r = await authFetch(`${API}/label-specs/${id}`,{method:'DELETE'}); if (!r.ok) throw new Error((await r.json()).error); await fetchSpecs(); renderSpecList(); toast('삭제 완료','success'); } catch(e) { toast(e.message,'error'); }
    }

    // ── Print ──
    function handlePrint() {
        const sp = getSelectedSpec();
        if (!sp) { toast('용지 규격을 선택해주세요.','warning'); return; }
        const qty = parseInt($('printQty').value)||1, d = collectData();
        const lps = sp.cols*sp.rows, sheets = Math.ceil(qty/lps);
        const lw = ((sp.paperWidth-sp.marginLeft-sp.marginRight-(sp.cols-1)*sp.gapX)/sp.cols).toFixed(2);
        const lh = ((sp.paperHeight-sp.marginTop-sp.marginBottom-(sp.rows-1)*sp.gapY)/sp.rows).toFixed(2);
        const fs = Math.max(6,Math.min(11,lw/7));
        const els = [];
        if (d.logoBase64) els.push({key:'logo',html:`<img src="${d.logoBase64}" style="max-height:30%;max-width:60%;object-fit:contain;">`});
        if (d.productName) els.push({key:'product',html:`<div style="font-weight:700;text-align:center;line-height:1.2;max-width:95%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.productName)}</div>`});
        if (d.manufacturer) els.push({key:'mfr',html:`<div style="font-size:85%;color:#666;text-align:center;">${esc(d.manufacturer)}</div>`});
        if (d.price) els.push({key:'price',html:`<div style="font-weight:800;text-align:center;color:#333;">${esc(d.price)}</div>`});
        const ip = [d.origin,d.spec,d.barcode].filter(Boolean);
        if (ip.length) els.push({key:'info',html:`<div style="font-size:75%;color:#999;text-align:center;">${esc(ip.join(' | '))}</div>`});
        if (d.memo) els.push({key:'memo',html:`<div style="font-size:70%;color:#aaa;text-align:center;">${esc(d.memo)}</div>`});

        let html = '', printed = 0;
        for (let s=0; s<sheets && printed<qty; s++) {
            html += `<div class="print-sheet" style="width:${sp.paperWidth}mm;height:${sp.paperHeight}mm;padding:${sp.marginTop}mm ${sp.marginRight}mm ${sp.marginBottom}mm ${sp.marginLeft}mm;box-sizing:border-box;position:relative;">`;
            for (let r=0; r<sp.rows && printed<qty; r++) {
                for (let c=0; c<sp.cols && printed<qty; c++, printed++) {
                    const cx = c*(parseFloat(lw)+sp.gapX), cy = r*(parseFloat(lh)+sp.gapY);
                    html += `<div style="position:absolute;left:${cx}mm;top:${cy}mm;width:${lw}mm;height:${lh}mm;overflow:hidden;font-size:${fs}pt;">`;
                    for (const el of els) {
                        const pos = getPos(el.key);
                        html += `<div style="position:absolute;left:${pos.x}%;top:${pos.y}%;transform:translate(-50%,-50%);">${el.html}</div>`;
                    }
                    html += '</div>';
                }
            }
            html += '</div>';
        }
        const pa = $('printArea'); pa.innerHTML = html; pa.style.display = 'block';
        setTimeout(() => { window.print(); setTimeout(() => { pa.style.display = 'none'; }, 500); }, 200);
    }

    // ── Init ──
    document.addEventListener('DOMContentLoaded', async () => {
        initTabs(); initLogoUpload(); initLogoTemplates();
        await Promise.all([fetchLabels(), fetchSpecs(), fetchLogoTemplates()]);
        ['lblName','lblProductName','lblManufacturer','lblPrice','lblOrigin','lblSpec','lblBarcode','lblMemo'].forEach(id => $(id).addEventListener('input', updatePreview));
        $('specSelect').addEventListener('change', updatePreview);
        $('btnSave').addEventListener('click', saveLabel);
        $('btnPrint').addEventListener('click', handlePrint);
        $('btnNew').addEventListener('click', () => { resetEditor(); updatePreview(); });
        $('btnResetLayout').addEventListener('click', () => { layout = {}; updatePreview(); toast('위치가 초기화되었습니다.','info'); });
        $('btnAddSpec').addEventListener('click', () => openSpecModal(null));
        $('specModalClose').addEventListener('click', () => $('specModalOverlay').classList.remove('active'));
        $('specModalCancel').addEventListener('click', () => $('specModalOverlay').classList.remove('active'));
        $('specModalSave').addEventListener('click', saveSpec);
        $('specModalOverlay').addEventListener('click', e => { if (e.target===$('specModalOverlay')) $('specModalOverlay').classList.remove('active'); });
        updatePreview();
    });
})();
