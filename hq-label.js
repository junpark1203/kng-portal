/**
 * 본사 매입 현황 — 라벨 출력
 * Label editor, save/load, paper spec management, print
 */
(function () {
    'use strict';

    async function authFetch(url, opts = {}) {
        let token = null;
        try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch (e) { }
        if (!opts.headers) opts.headers = {};
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, opts);
    }

    const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api/hq' : 'https://kng.junparks.com/api/hq';

    const $ = id => document.getElementById(id);
    const escHtml = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let labels = [], specs = [], currentLabelId = null, editingSpecId = null;

    // ── Toast ──
    function toast(msg, type = 'info') {
        const c = $('toastContainer'); if (!c) return;
        const icons = { success: 'bx-check-circle', error: 'bx-error-circle', warning: 'bx-error', info: 'bx-info-circle' };
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = `<i class='bx ${icons[type] || icons.info}'></i> <span>${escHtml(msg)}</span>`;
        c.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    // ══════════════════════════════════════
    //  Tabs
    // ══════════════════════════════════════
    function initTabs() {
        document.querySelectorAll('.header-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.header-tab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const panel = $('panel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
                if (panel) panel.classList.add('active');
                if (btn.dataset.tab === 'saved') renderSavedList();
                if (btn.dataset.tab === 'specs') renderSpecList();
            });
        });
    }

    // ══════════════════════════════════════
    //  Logo Upload
    // ══════════════════════════════════════
    function initLogoUpload() {
        const fileInput = $('logoFileInput');
        $('btnUploadLogo').addEventListener('click', () => fileInput.click());
        $('logoPreview').addEventListener('click', () => fileInput.click());
        $('btnClearLogo').addEventListener('click', () => {
            $('logoImg').src = ''; $('logoImg').style.display = 'none';
            $('logoPlaceholder').style.display = ''; updatePreview();
        });
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            if (file.size > 2 * 1024 * 1024) { toast('이미지 크기는 2MB 이하로 선택해주세요.', 'warning'); return; }
            const reader = new FileReader();
            reader.onload = ev => {
                $('logoImg').src = ev.target.result; $('logoImg').style.display = '';
                $('logoPlaceholder').style.display = 'none'; updatePreview();
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });
    }

    // ══════════════════════════════════════
    //  Collect / Load Label Data
    // ══════════════════════════════════════
    function collectData() {
        return {
            name: $('lblName').value.trim(),
            productName: $('lblProductName').value.trim(),
            manufacturer: $('lblManufacturer').value.trim(),
            price: $('lblPrice').value.trim(),
            origin: $('lblOrigin').value.trim(),
            spec: $('lblSpec').value.trim(),
            barcode: $('lblBarcode').value.trim(),
            memo: $('lblMemo').value.trim(),
            logoBase64: $('logoImg').style.display !== 'none' ? $('logoImg').src : '',
            extraFields: []
        };
    }

    function loadData(d) {
        $('lblName').value = d.name || '';
        $('lblProductName').value = d.productName || '';
        $('lblManufacturer').value = d.manufacturer || '';
        $('lblPrice').value = d.price || '';
        $('lblOrigin').value = d.origin || '';
        $('lblSpec').value = d.spec || '';
        $('lblBarcode').value = d.barcode || '';
        $('lblMemo').value = d.memo || '';
        if (d.logoBase64) {
            $('logoImg').src = d.logoBase64; $('logoImg').style.display = '';
            $('logoPlaceholder').style.display = 'none';
        } else {
            $('logoImg').src = ''; $('logoImg').style.display = 'none';
            $('logoPlaceholder').style.display = '';
        }
        updatePreview();
    }

    function resetEditor() {
        currentLabelId = null;
        loadData({});
        $('printQty').value = 1;
    }

    // ══════════════════════════════════════
    //  Preview
    // ══════════════════════════════════════
    function getSelectedSpec() {
        const id = $('specSelect').value;
        return specs.find(s => s.id === id) || specs[0] || null;
    }

    function updatePreview() {
        const sp = getSelectedSpec();
        const container = $('previewContainer');
        if (!sp) { container.innerHTML = '<div class="empty-state"><i class="bx bx-ruler"></i><p>용지 규격을 선택해주세요.</p></div>'; return; }

        const d = collectData();
        const scale = 2.5; // mm to px approx
        const pw = sp.paperWidth * scale, ph = sp.paperHeight * scale;
        const ml = sp.marginLeft * scale, mr = sp.marginRight * scale;
        const mt = sp.marginTop * scale, mb = sp.marginBottom * scale;
        const gx = sp.gapX * scale, gy = sp.gapY * scale;
        const totalGapX = (sp.cols - 1) * gx, totalGapY = (sp.rows - 1) * gy;
        const lw = (pw - ml - mr - totalGapX) / sp.cols;
        const lh = (ph - mt - mb - totalGapY) / sp.rows;
        const fontSize = Math.max(7, Math.min(12, lw / 7));

        let html = `<div class="preview-sheet" style="width:${pw}px;height:${ph}px;position:relative;">`;
        for (let r = 0; r < sp.rows; r++) {
            for (let c = 0; c < sp.cols; c++) {
                const x = ml + c * (lw + gx), y = mt + r * (lh + gy);
                html += `<div class="preview-label" style="position:absolute;left:${x}px;top:${y}px;width:${lw}px;height:${lh}px;font-size:${fontSize}px;">`;
                if (d.logoBase64) html += `<img class="lbl-logo" src="${d.logoBase64}">`;
                if (d.productName) html += `<div class="lbl-product">${escHtml(d.productName)}</div>`;
                if (d.manufacturer) html += `<div class="lbl-mfr">${escHtml(d.manufacturer)}</div>`;
                if (d.price) html += `<div class="lbl-price">${escHtml(d.price)}</div>`;
                const infoParts = [d.origin, d.spec, d.barcode].filter(Boolean);
                if (infoParts.length) html += `<div class="lbl-info">${escHtml(infoParts.join(' | '))}</div>`;
                if (d.memo) html += `<div class="lbl-info">${escHtml(d.memo)}</div>`;
                html += '</div>';
            }
        }
        html += '</div>';
        container.innerHTML = html;
    }

    // ══════════════════════════════════════
    //  Save / Load Labels (API)
    // ══════════════════════════════════════
    async function fetchLabels() {
        try { const r = await authFetch(API + '/labels'); if (r.ok) labels = await r.json(); } catch (e) { console.error(e); }
    }

    async function saveLabel() {
        const d = collectData();
        if (!d.name) { toast('라벨 이름을 입력해주세요.', 'warning'); return; }
        try {
            const url = currentLabelId ? `${API}/labels/${currentLabelId}` : `${API}/labels`;
            const method = currentLabelId ? 'PUT' : 'POST';
            const r = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
            const res = await r.json();
            if (!r.ok) throw new Error(res.error);
            if (!currentLabelId) currentLabelId = res.id;
            await fetchLabels();
            toast('라벨이 저장되었습니다.', 'success');
        } catch (e) { toast('저장 실패: ' + e.message, 'error'); }
    }

    async function deleteLabel(id) {
        if (!confirm('이 라벨을 삭제하시겠습니까?')) return;
        try {
            const r = await authFetch(API + '/labels/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
            if (!r.ok) throw new Error((await r.json()).error);
            if (currentLabelId === id) resetEditor();
            await fetchLabels(); renderSavedList();
            toast('삭제되었습니다.', 'success');
        } catch (e) { toast('삭제 실패: ' + e.message, 'error'); }
    }

    function renderSavedList() {
        const list = $('savedList');
        if (labels.length === 0) {
            list.innerHTML = '<div class="empty-state"><i class="bx bx-folder-open"></i><p>저장된 라벨이 없습니다.</p></div>';
            return;
        }
        list.innerHTML = labels.map(l => `
            <div class="saved-item ${l.id === currentLabelId ? 'active' : ''}" data-id="${l.id}">
                <div class="saved-item-info">
                    <div class="saved-item-name">${escHtml(l.name || '(이름 없음)')}</div>
                    <div class="saved-item-detail">${escHtml(l.productName || '')} ${l.manufacturer ? '· ' + escHtml(l.manufacturer) : ''}</div>
                </div>
                <div class="saved-item-actions">
                    <button class="btn-delete" data-id="${l.id}" title="삭제"><i class='bx bx-trash'></i></button>
                </div>
            </div>`).join('');

        list.querySelectorAll('.saved-item').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('.btn-delete')) return;
                const lbl = labels.find(l => l.id === el.dataset.id);
                if (lbl) { currentLabelId = lbl.id; loadData(lbl); renderSavedList(); switchTab('editor'); }
            });
        });
        list.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); deleteLabel(btn.dataset.id); });
        });
    }

    function switchTab(name) {
        document.querySelectorAll('.header-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const panel = $('panel' + name.charAt(0).toUpperCase() + name.slice(1));
        if (panel) panel.classList.add('active');
    }

    // ══════════════════════════════════════
    //  Paper Specs (API)
    // ══════════════════════════════════════
    async function fetchSpecs() {
        try {
            const r = await authFetch(API + '/label-specs');
            if (r.ok) specs = await r.json();
        } catch (e) { console.error(e); }
        populateSpecSelect();
    }

    function populateSpecSelect() {
        const sel = $('specSelect');
        const prev = sel.value;
        sel.innerHTML = specs.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
        if (prev && specs.find(s => s.id === prev)) sel.value = prev;
        else if (specs.length) sel.value = specs[0].id;
        updatePreview();
    }

    function renderSpecList() {
        const list = $('specList');
        list.innerHTML = specs.map(s => `
            <div class="spec-item" data-id="${s.id}">
                <div class="spec-item-header">
                    <div class="spec-item-name">${escHtml(s.name)} ${s.isDefault ? '<span class="spec-default-badge">기본</span>' : ''}</div>
                    <div class="spec-actions">
                        <button class="btn-edit-spec" data-id="${s.id}" title="수정"><i class='bx bx-edit'></i></button>
                        ${!s.isDefault ? `<button class="btn-delete-spec" data-id="${s.id}" title="삭제"><i class='bx bx-trash'></i></button>` : ''}
                    </div>
                </div>
                <div class="spec-item-detail">
                    <span>${s.paperWidth}×${s.paperHeight}mm</span>
                    <span>${s.cols}열 × ${s.rows}행 (${s.cols * s.rows}칸)</span>
                    <span>여백 ${s.marginTop}/${s.marginBottom}/${s.marginLeft}/${s.marginRight}</span>
                </div>
            </div>`).join('');

        list.querySelectorAll('.btn-edit-spec').forEach(btn => {
            btn.addEventListener('click', () => openSpecModal(btn.dataset.id));
        });
        list.querySelectorAll('.btn-delete-spec').forEach(btn => {
            btn.addEventListener('click', () => deleteSpec(btn.dataset.id));
        });
    }

    function openSpecModal(id) {
        editingSpecId = id || null;
        const sp = id ? specs.find(s => s.id === id) : null;
        $('specModalTitle').textContent = sp ? '용지 규격 수정' : '용지 규격 추가';
        $('specName').value = sp ? sp.name : '';
        $('specPaperWidth').value = sp ? sp.paperWidth : 210;
        $('specPaperHeight').value = sp ? sp.paperHeight : 297;
        $('specCols').value = sp ? sp.cols : 3;
        $('specRows').value = sp ? sp.rows : 7;
        $('specMarginTop').value = sp ? sp.marginTop : 15;
        $('specMarginBottom').value = sp ? sp.marginBottom : 15;
        $('specMarginLeft').value = sp ? sp.marginLeft : 7;
        $('specMarginRight').value = sp ? sp.marginRight : 7;
        $('specGapX').value = sp ? sp.gapX : 2;
        $('specGapY').value = sp ? sp.gapY : 0;
        $('specModalOverlay').classList.add('active');
    }

    async function saveSpec() {
        const data = {
            name: $('specName').value.trim(),
            paperWidth: parseFloat($('specPaperWidth').value) || 210,
            paperHeight: parseFloat($('specPaperHeight').value) || 297,
            cols: parseInt($('specCols').value) || 3,
            rows: parseInt($('specRows').value) || 7,
            marginTop: parseFloat($('specMarginTop').value) || 0,
            marginBottom: parseFloat($('specMarginBottom').value) || 0,
            marginLeft: parseFloat($('specMarginLeft').value) || 0,
            marginRight: parseFloat($('specMarginRight').value) || 0,
            gapX: parseFloat($('specGapX').value) || 0,
            gapY: parseFloat($('specGapY').value) || 0
        };
        if (!data.name) { toast('규격 이름을 입력해주세요.', 'warning'); return; }
        try {
            const url = editingSpecId ? `${API}/label-specs/${editingSpecId}` : `${API}/label-specs`;
            const method = editingSpecId ? 'PUT' : 'POST';
            const r = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (!r.ok) throw new Error((await r.json()).error);
            await fetchSpecs(); renderSpecList();
            $('specModalOverlay').classList.remove('active');
            toast(editingSpecId ? '규격이 수정되었습니다.' : '규격이 추가되었습니다.', 'success');
        } catch (e) { toast('저장 실패: ' + e.message, 'error'); }
    }

    async function deleteSpec(id) {
        if (!confirm('이 규격을 삭제하시겠습니까?')) return;
        try {
            const r = await authFetch(`${API}/label-specs/${id}`, { method: 'DELETE' });
            if (!r.ok) throw new Error((await r.json()).error);
            await fetchSpecs(); renderSpecList();
            toast('삭제되었습니다.', 'success');
        } catch (e) { toast(e.message, 'error'); }
    }

    // ══════════════════════════════════════
    //  Print
    // ══════════════════════════════════════
    function handlePrint() {
        const sp = getSelectedSpec();
        if (!sp) { toast('용지 규격을 선택해주세요.', 'warning'); return; }
        const qty = parseInt($('printQty').value) || 1;
        const d = collectData();
        const totalLabels = qty;
        const labelsPerSheet = sp.cols * sp.rows;
        const sheets = Math.ceil(totalLabels / labelsPerSheet);

        // Build print HTML
        const lw = ((sp.paperWidth - sp.marginLeft - sp.marginRight - (sp.cols - 1) * sp.gapX) / sp.cols).toFixed(2);
        const lh = ((sp.paperHeight - sp.marginTop - sp.marginBottom - (sp.rows - 1) * sp.gapY) / sp.rows).toFixed(2);
        const fontSize = Math.max(6, Math.min(11, lw / 7));

        let html = '';
        let printed = 0;
        for (let s = 0; s < sheets && printed < totalLabels; s++) {
            html += `<div class="print-sheet" style="width:${sp.paperWidth}mm;height:${sp.paperHeight}mm;padding:${sp.marginTop}mm ${sp.marginRight}mm ${sp.marginBottom}mm ${sp.marginLeft}mm;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:${sp.gapY}mm ${sp.gapX}mm;align-content:flex-start;">`;
            for (let i = 0; i < labelsPerSheet && printed < totalLabels; i++, printed++) {
                html += `<div style="width:${lw}mm;height:${lh}mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;font-size:${fontSize}pt;padding:1mm;box-sizing:border-box;">`;
                if (d.logoBase64) html += `<img src="${d.logoBase64}" style="max-height:30%;max-width:60%;object-fit:contain;margin-bottom:1mm;">`;
                if (d.productName) html += `<div style="font-weight:700;text-align:center;line-height:1.2;max-width:95%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(d.productName)}</div>`;
                if (d.manufacturer) html += `<div style="font-size:85%;color:#666;text-align:center;">${escHtml(d.manufacturer)}</div>`;
                if (d.price) html += `<div style="font-weight:800;text-align:center;color:#333;">${escHtml(d.price)}</div>`;
                const infoParts = [d.origin, d.spec, d.barcode].filter(Boolean);
                if (infoParts.length) html += `<div style="font-size:75%;color:#999;text-align:center;">${escHtml(infoParts.join(' | '))}</div>`;
                if (d.memo) html += `<div style="font-size:70%;color:#aaa;text-align:center;">${escHtml(d.memo)}</div>`;
                html += '</div>';
            }
            html += '</div>';
        }

        const printArea = $('printArea');
        printArea.innerHTML = html;
        printArea.style.display = 'block';
        setTimeout(() => { window.print(); setTimeout(() => { printArea.style.display = 'none'; }, 500); }, 200);
    }

    // ══════════════════════════════════════
    //  Init
    // ══════════════════════════════════════
    document.addEventListener('DOMContentLoaded', async () => {
        initTabs();
        initLogoUpload();

        await Promise.all([fetchLabels(), fetchSpecs()]);

        // Live preview on input change
        ['lblName', 'lblProductName', 'lblManufacturer', 'lblPrice', 'lblOrigin', 'lblSpec', 'lblBarcode', 'lblMemo'].forEach(id => {
            $(id).addEventListener('input', updatePreview);
        });
        $('specSelect').addEventListener('change', updatePreview);

        // Buttons
        $('btnSave').addEventListener('click', saveLabel);
        $('btnPrint').addEventListener('click', handlePrint);
        $('btnNew').addEventListener('click', () => { resetEditor(); updatePreview(); });

        // Spec modal
        $('btnAddSpec').addEventListener('click', () => openSpecModal(null));
        $('specModalClose').addEventListener('click', () => $('specModalOverlay').classList.remove('active'));
        $('specModalCancel').addEventListener('click', () => $('specModalOverlay').classList.remove('active'));
        $('specModalSave').addEventListener('click', saveSpec);
        $('specModalOverlay').addEventListener('click', e => { if (e.target === $('specModalOverlay')) $('specModalOverlay').classList.remove('active'); });

        updatePreview();
    });
})();
