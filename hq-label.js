(function(){
'use strict';
async function authFetch(u,o={}){let t=null;try{if(window.parent&&window.parent.getAuthToken)t=await window.parent.getAuthToken()}catch(e){}if(!o.headers)o.headers={};if(t)o.headers['Authorization']='Bearer '+t;return fetch(u,o)}
const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?'http://localhost:3000/api/hq':'https://kng.junparks.com/api/hq';
const $=id=>document.getElementById(id),esc=s=>s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let labels=[],specs=[],logoTpls=[],currentLabelId=null,editingSpecId=null,layout={},printQueue=[];
const PAPERS={A4:{w:210,h:297},A3:{w:297,h:420}};

function toast(m,t='info'){const c=$('toastContainer');if(!c)return;const ic={success:'bx-check-circle',error:'bx-error-circle',warning:'bx-error',info:'bx-info-circle'};const el=document.createElement('div');el.className='toast '+t;el.innerHTML=`<i class='bx ${ic[t]||ic.info}'></i> <span>${esc(m)}</span>`;c.appendChild(el);setTimeout(()=>{el.classList.add('fade-out');setTimeout(()=>el.remove(),300)},3500)}

// Tabs
function initTabs(){document.querySelectorAll('.header-tab').forEach(b=>{b.addEventListener('click',()=>{document.querySelectorAll('.header-tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');const p=$('panel'+b.dataset.tab.charAt(0).toUpperCase()+b.dataset.tab.slice(1));if(p)p.classList.add('active');if(b.dataset.tab==='saved')renderSavedList();if(b.dataset.tab==='specs')renderSpecList();if(b.dataset.tab==='print')updatePrintCalc()})})}
function switchTab(n){document.querySelectorAll('.header-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===n));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));const p=$('panel'+n.charAt(0).toUpperCase()+n.slice(1));if(p)p.classList.add('active')}

// Logo
function initLogo(){const fi=$('logoFileInput');$('btnUploadLogo').onclick=()=>fi.click();$('logoPreview').onclick=()=>fi.click();$('btnClearLogo').onclick=()=>{$('logoImg').src='';$('logoImg').style.display='none';$('logoPlaceholder').style.display='';updatePreview()};fi.onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>2*1024*1024){toast('2MB 이하만 가능','warning');return}const r=new FileReader();r.onload=ev=>{$('logoImg').src=ev.target.result;$('logoImg').style.display='';$('logoPlaceholder').style.display='none';updatePreview()};r.readAsDataURL(f);fi.value=''}}

// Logo Templates
async function fetchLogoTpls(){try{const r=await authFetch(API+'/logo-templates');if(r.ok)logoTpls=await r.json()}catch(e){}populateLogoSel()}
function populateLogoSel(){$('logoTemplateSelect').innerHTML='<option value="">— 로고 템플릿 —</option>'+logoTpls.map(t=>`<option value="${t.id}">${esc(t.manufacturer)}</option>`).join('')}
function initLogoTpls(){$('logoTemplateSelect').onchange=()=>{const t=logoTpls.find(x=>x.id===$('logoTemplateSelect').value);if(t&&t.logoBase64){$('logoImg').src=t.logoBase64;$('logoImg').style.display='';$('logoPlaceholder').style.display='none';updatePreview();toast(t.manufacturer+' 로고 적용','success')}};$('btnSaveLogoTpl').onclick=async()=>{const logo=$('logoImg').style.display!=='none'?$('logoImg').src:'';if(!logo){toast('로고를 먼저 선택하세요','warning');return}const mfr=$('lblManufacturer').value.trim()||prompt('제조사명:');if(!mfr)return;try{const r=await authFetch(API+'/logo-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manufacturer:mfr,logoBase64:logo})});if(!r.ok)throw new Error((await r.json()).error);await fetchLogoTpls();toast('저장 완료','success')}catch(e){toast(e.message,'error')}};$('btnDeleteLogoTpl').onclick=async()=>{const id=$('logoTemplateSelect').value;if(!id){toast('템플릿을 선택하세요','warning');return}if(!confirm('삭제하시겠습니까?'))return;try{const r=await authFetch(API+'/logo-templates/'+id,{method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error);await fetchLogoTpls();toast('삭제 완료','success')}catch(e){toast(e.message,'error')}}}

// Data
function collectData(){return{name:$('lblName').value.trim(),productName:$('lblProductName').value.trim(),manufacturer:$('lblManufacturer').value.trim(),price:$('lblPrice').value.trim(),origin:$('lblOrigin').value.trim(),spec:$('lblSpec').value.trim(),barcode:$('lblBarcode').value.trim(),memo:$('lblMemo').value.trim(),logoBase64:$('logoImg').style.display!=='none'?$('logoImg').src:'',extraFields:[],layout:layout}}
function loadData(d){$('lblName').value=d.name||'';$('lblProductName').value=d.productName||'';$('lblManufacturer').value=d.manufacturer||'';$('lblPrice').value=d.price||'';$('lblOrigin').value=d.origin||'';$('lblSpec').value=d.spec||'';$('lblBarcode').value=d.barcode||'';$('lblMemo').value=d.memo||'';if(d.logoBase64){$('logoImg').src=d.logoBase64;$('logoImg').style.display='';$('logoPlaceholder').style.display='none'}else{$('logoImg').src='';$('logoImg').style.display='none';$('logoPlaceholder').style.display=''}try{layout=typeof d.layout==='string'?JSON.parse(d.layout||'{}'):(d.layout||{})}catch(e){layout={}}updatePreview()}
function resetEditor(){currentLabelId=null;layout={};loadData({});$('printQty')&&($('printQty').value=1)}

// Layout
function defPos(){return{logo:{x:50,y:15},product:{x:50,y:38},mfr:{x:50,y:52},price:{x:50,y:66},info:{x:50,y:80},memo:{x:50,y:92}}}
function getPos(k){const d=defPos();return(layout&&layout[k])?layout[k]:d[k]}

// Calc cols/rows from paper+label
function calcGrid(pw,ph,lw,lh,mt,mb,ml,mr,gx,gy){
    const cols=Math.floor((pw-ml-mr+gx)/(lw+gx));
    const rows=Math.floor((ph-mt-mb+gy)/(lh+gy));
    return{cols:Math.max(1,cols),rows:Math.max(1,rows)}
}

// Preview
function getPreviewSpec(){
    const paper=PAPERS[$('paperSize')?$('paperSize').value:'A4']||PAPERS.A4;
    const selId=$('printSpecSelect')?$('printSpecSelect').value:'';
    const sp=specs.find(s=>s.id===selId);
    const lw=parseFloat($('printLabelW')?$('printLabelW').value:63.5)||63.5;
    const lh=parseFloat($('printLabelH')?$('printLabelH').value:38.1)||38.1;
    const mt=sp?sp.marginTop:15,mb=sp?sp.marginBottom:15,ml=sp?sp.marginLeft:7,mr=sp?sp.marginRight:7;
    const gx=sp?sp.gapX:2.5,gy=sp?sp.gapY:0;
    const g=calcGrid(paper.w,paper.h,lw,lh,mt,mb,ml,mr,gx,gy);
    return{paperW:paper.w,paperH:paper.h,labelW:lw,labelH:lh,cols:g.cols,rows:g.rows,mt,mb,ml,mr,gx,gy}
}

function updatePreview(){
    const sp=getPreviewSpec(),container=$('previewContainer');
    const d=collectData(),scale=2.5;
    const pw=sp.paperW*scale,ph=sp.paperH*scale;
    const lw=sp.labelW*scale,lh=sp.labelH*scale;
    const ml=sp.ml*scale,mt=sp.mt*scale,gx=sp.gx*scale,gy=sp.gy*scale;
    const fs=Math.max(7,Math.min(12,lw/7));
    const els=[];
    if(d.logoBase64)els.push({key:'logo',html:`<img style="max-height:${lh*0.28}px;max-width:${lw*0.6}px;object-fit:contain" src="${d.logoBase64}">`});
    if(d.productName)els.push({key:'product',html:`<div class="lbl-product" style="max-width:${lw-4}px">${esc(d.productName)}</div>`});
    if(d.manufacturer)els.push({key:'mfr',html:`<div class="lbl-mfr" style="max-width:${lw-4}px">${esc(d.manufacturer)}</div>`});
    if(d.price)els.push({key:'price',html:`<div class="lbl-price">${esc(d.price)}</div>`});
    const ip=[d.origin,d.spec,d.barcode].filter(Boolean);
    if(ip.length)els.push({key:'info',html:`<div class="lbl-info" style="max-width:${lw-4}px">${esc(ip.join(' | '))}</div>`});
    if(d.memo)els.push({key:'memo',html:`<div class="lbl-info" style="max-width:${lw-4}px">${esc(d.memo)}</div>`});
    let h=`<div class="preview-sheet" style="width:${pw}px;height:${ph}px;position:relative">`;
    for(let r=0;r<sp.rows;r++)for(let c=0;c<sp.cols;c++){
        const x=ml+c*(lw+gx),y=mt+r*(lh+gy),isF=r===0&&c===0;
        h+=`<div class="preview-label${isF?' first-label':''}" style="position:absolute;left:${x}px;top:${y}px;width:${lw}px;height:${lh}px;font-size:${fs}px">`;
        for(const el of els){const p=getPos(el.key);h+=`<div class="lbl-el" data-key="${el.key}" style="left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%)">${el.html}</div>`}
        h+='</div>'}
    h+='</div>';container.innerHTML=h;
    initDrag(container.querySelector('.first-label'))
}

function initDrag(el){if(!el)return;el.querySelectorAll('.lbl-el').forEach(n=>{n.onmousedown=e=>{e.preventDefault();const k=n.dataset.key,rect=el.getBoundingClientRect();n.classList.add('dragging');const mv=ev=>{n.style.left=Math.max(0,Math.min(100,(ev.clientX-rect.left)/rect.width*100))+'%';n.style.top=Math.max(0,Math.min(100,(ev.clientY-rect.top)/rect.height*100))+'%'};const up=ev=>{n.classList.remove('dragging');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);const px=Math.max(0,Math.min(100,(ev.clientX-rect.left)/rect.width*100)),py=Math.max(0,Math.min(100,(ev.clientY-rect.top)/rect.height*100));if(!layout)layout={};layout[k]={x:Math.round(px*10)/10,y:Math.round(py*10)/10};updatePreview()};document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up)}})}

// Labels CRUD
async function fetchLabels(){try{const r=await authFetch(API+'/labels');if(r.ok)labels=await r.json()}catch(e){}}
async function saveLabel(){const d=collectData();if(!d.name){toast('라벨 이름을 입력하세요','warning');return}try{const url=currentLabelId?`${API}/labels/${currentLabelId}`:`${API}/labels`;const r=await authFetch(url,{method:currentLabelId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const res=await r.json();if(!r.ok)throw new Error(res.error);if(!currentLabelId)currentLabelId=res.id;await fetchLabels();toast('저장 완료','success')}catch(e){toast(e.message,'error')}}
async function deleteLabel(id){if(!confirm('삭제?'))return;try{const r=await authFetch(API+'/labels/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})});if(!r.ok)throw new Error((await r.json()).error);if(currentLabelId===id)resetEditor();await fetchLabels();renderSavedList();toast('삭제','success')}catch(e){toast(e.message,'error')}}
function renderSavedList(){const l=$('savedList');if(!labels.length){l.innerHTML='<div class="empty-state"><i class="bx bx-folder-open"></i><p>저장된 라벨이 없습니다.</p></div>';return}l.innerHTML=labels.map(x=>`<div class="saved-item ${x.id===currentLabelId?'active':''}" data-id="${x.id}"><div><div class="saved-item-name">${esc(x.name||'(이름 없음)')}</div><div class="saved-item-detail">${esc(x.productName||'')} ${x.manufacturer?'· '+esc(x.manufacturer):''}</div></div><div class="saved-item-actions"><button class="btn-delete" data-id="${x.id}"><i class='bx bx-trash'></i></button></div></div>`).join('');l.querySelectorAll('.saved-item').forEach(el=>{el.onclick=e=>{if(e.target.closest('.btn-delete'))return;const lb=labels.find(x=>x.id===el.dataset.id);if(lb){currentLabelId=lb.id;loadData(lb);renderSavedList();switchTab('editor')}}});l.querySelectorAll('.btn-delete').forEach(b=>{b.onclick=e=>{e.stopPropagation();deleteLabel(b.dataset.id)}})}

// Specs
async function fetchSpecs(){try{const r=await authFetch(API+'/label-specs');if(r.ok)specs=await r.json()}catch(e){}populatePrintSpec()}
function populatePrintSpec(){const sel=$('printSpecSelect');if(!sel)return;const prev=sel.value;sel.innerHTML='<option value="">직접 입력</option>'+specs.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');if(prev&&specs.find(s=>s.id===prev))sel.value=prev}
function renderSpecList(){$('specList').innerHTML=specs.map(s=>`<div class="spec-item"><div class="spec-item-header"><div class="spec-item-name">${esc(s.name)} ${s.isDefault?'<span class="spec-default-badge">기본</span>':''}</div><div class="spec-actions"><button class="btn-edit-spec" data-id="${s.id}"><i class='bx bx-edit'></i></button>${!s.isDefault?`<button class="btn-del-spec" data-id="${s.id}"><i class='bx bx-trash'></i></button>`:''}</div></div><div class="spec-item-detail"><span>${s.labelWidth||'?'}×${s.labelHeight||'?'}mm</span><span>여백 ${s.marginTop}/${s.marginBottom}/${s.marginLeft}/${s.marginRight}</span><span>간격 ${s.gapX}/${s.gapY}</span></div></div>`).join('');$('specList').querySelectorAll('.btn-edit-spec').forEach(b=>b.onclick=()=>openSpecModal(b.dataset.id));$('specList').querySelectorAll('.btn-del-spec').forEach(b=>b.onclick=()=>deleteSpec(b.dataset.id))}
function openSpecModal(id){editingSpecId=id||null;const s=id?specs.find(x=>x.id===id):null;$('specModalTitle').textContent=s?'라벨 규격 수정':'라벨 규격 추가';$('specName').value=s?s.name:'';$('specLabelW').value=s?s.labelWidth:63.5;$('specLabelH').value=s?s.labelHeight:38.1;$('specMT').value=s?s.marginTop:15;$('specMB').value=s?s.marginBottom:15;$('specML').value=s?s.marginLeft:7;$('specMR').value=s?s.marginRight:7;$('specGX').value=s?s.gapX:2.5;$('specGY').value=s?s.gapY:0;$('specModalOverlay').classList.add('active')}
async function saveSpec(){const d={name:$('specName').value.trim(),labelWidth:parseFloat($('specLabelW').value)||63.5,labelHeight:parseFloat($('specLabelH').value)||38.1,marginTop:parseFloat($('specMT').value)||0,marginBottom:parseFloat($('specMB').value)||0,marginLeft:parseFloat($('specML').value)||0,marginRight:parseFloat($('specMR').value)||0,gapX:parseFloat($('specGX').value)||0,gapY:parseFloat($('specGY').value)||0};if(!d.name){toast('이름을 입력하세요','warning');return}try{const url=editingSpecId?`${API}/label-specs/${editingSpecId}`:`${API}/label-specs`;const r=await authFetch(url,{method:editingSpecId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error((await r.json()).error);await fetchSpecs();renderSpecList();$('specModalOverlay').classList.remove('active');toast('저장 완료','success')}catch(e){toast(e.message,'error')}}
async function deleteSpec(id){if(!confirm('삭제?'))return;try{const r=await authFetch(`${API}/label-specs/${id}`,{method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error);await fetchSpecs();renderSpecList();toast('삭제','success')}catch(e){toast(e.message,'error')}}

// Print tab
function updatePrintCalc(){
    const sp=getPreviewSpec();
    $('printCalcInfo').innerHTML=`<b>${sp.cols}열 × ${sp.rows}행 = ${sp.cols*sp.rows}칸</b> (용지당) · 라벨 ${sp.labelW}×${sp.labelH}mm`;
    const total=printQueue.reduce((s,q)=>s+q.qty,0);
    const sheets=Math.ceil(total/(sp.cols*sp.rows));
    $('printSummary').textContent=`총 ${total}개 라벨 · ${sheets}장 출력`;
}
function renderPrintList(){
    const el=$('printLabelList');
    if(!printQueue.length){el.innerHTML='<div class="empty-state" style="padding:15px"><i class="bx bx-plus-circle" style="font-size:24px"></i><p>위의 "라벨 추가" 버튼으로 인쇄할 라벨을 선택하세요</p></div>';updatePrintCalc();return}
    el.innerHTML=printQueue.map((q,i)=>`<div class="print-row"><span class="pr-name">${esc(q.label.name||q.label.productName||'(이름없음)')}</span><span class="pr-detail">${esc(q.label.productName||'')}</span><input type="number" min="1" max="500" value="${q.qty}" data-idx="${i}"><button class="btn-remove" data-idx="${i}" title="제거"><i class='bx bx-x'></i></button></div>`).join('');
    el.querySelectorAll('input[type=number]').forEach(inp=>{inp.onchange=()=>{printQueue[+inp.dataset.idx].qty=Math.max(1,parseInt(inp.value)||1);updatePrintCalc()}});
    el.querySelectorAll('.btn-remove').forEach(b=>{b.onclick=()=>{printQueue.splice(+b.dataset.idx,1);renderPrintList()}});
    updatePrintCalc()
}
function openLabelPicker(){
    const el=$('labelPickerList');
    if(!labels.length){el.innerHTML='<div class="empty-state"><p>저장된 라벨이 없습니다. 먼저 편집 탭에서 라벨을 저장하세요.</p></div>';$('labelPickerOverlay').classList.add('active');return}
    el.innerHTML=labels.map(l=>`<div class="saved-item" data-id="${l.id}" style="cursor:pointer"><div><div class="saved-item-name">${esc(l.name||'(이름없음)')}</div><div class="saved-item-detail">${esc(l.productName||'')} ${l.manufacturer?'· '+esc(l.manufacturer):''}</div></div></div>`).join('');
    el.querySelectorAll('.saved-item').forEach(item=>{item.onclick=()=>{const lb=labels.find(x=>x.id===item.dataset.id);if(lb){printQueue.push({label:lb,qty:1});renderPrintList();$('labelPickerOverlay').classList.remove('active');toast(lb.name+' 추가','success')}}});
    $('labelPickerOverlay').classList.add('active')
}

function handlePrint(){
    if(!printQueue.length){toast('인쇄할 라벨을 추가하세요','warning');return}
    const sp=getPreviewSpec(),total=printQueue.reduce((s,q)=>s+q.qty,0),lps=sp.cols*sp.rows;
    const sheets=Math.ceil(total/lps);
    // Build flat list
    const flat=[];printQueue.forEach(q=>{const lb=q.label;let lo={};try{lo=typeof lb.layout==='string'?JSON.parse(lb.layout||'{}'):(lb.layout||{})}catch(e){}for(let i=0;i<q.qty;i++)flat.push({data:lb,layout:lo})});
    const fs=Math.max(6,Math.min(11,sp.labelW/7));
    let html='',idx=0;
    for(let s=0;s<sheets&&idx<flat.length;s++){
        html+=`<div class="print-sheet" style="width:${sp.paperW}mm;height:${sp.paperH}mm;position:relative;box-sizing:border-box">`;
        for(let r=0;r<sp.rows&&idx<flat.length;r++)for(let c=0;c<sp.cols&&idx<flat.length;c++,idx++){
            const {data:d,layout:lo}=flat[idx];
            const cx=sp.ml+c*(sp.labelW+sp.gapX),cy=sp.mt+r*(sp.labelH+sp.gapY);
            const dp=k=>(lo&&lo[k])?lo[k]:defPos()[k];
            html+=`<div style="position:absolute;left:${cx}mm;top:${cy}mm;width:${sp.labelW}mm;height:${sp.labelH}mm;overflow:hidden;font-size:${fs}pt">`;
            const els=[];
            if(d.logoBase64)els.push({k:'logo',h:`<img src="${d.logoBase64}" style="max-height:30%;max-width:60%;object-fit:contain">`});
            if(d.productName)els.push({k:'product',h:`<div style="font-weight:700;text-align:center;line-height:1.2">${esc(d.productName)}</div>`});
            if(d.manufacturer)els.push({k:'mfr',h:`<div style="font-size:85%;color:#666;text-align:center">${esc(d.manufacturer)}</div>`});
            if(d.price)els.push({k:'price',h:`<div style="font-weight:800;text-align:center;color:#333">${esc(d.price)}</div>`});
            const ip=[d.origin,d.spec,d.barcode].filter(Boolean);
            if(ip.length)els.push({k:'info',h:`<div style="font-size:75%;color:#999;text-align:center">${esc(ip.join(' | '))}</div>`});
            if(d.memo)els.push({k:'memo',h:`<div style="font-size:70%;color:#aaa;text-align:center">${esc(d.memo)}</div>`});
            for(const e of els){const p=dp(e.k);html+=`<div style="position:absolute;left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%)">${e.h}</div>`}
            html+='</div>'}
        html+='</div>'}
    const pa=$('printArea');pa.innerHTML=html;pa.style.display='block';
    setTimeout(()=>{window.print();setTimeout(()=>{pa.style.display='none'},500)},200)
}

// Init
document.addEventListener('DOMContentLoaded',async()=>{
    initTabs();initLogo();initLogoTpls();
    await Promise.all([fetchLabels(),fetchSpecs(),fetchLogoTpls()]);
    ['lblName','lblProductName','lblManufacturer','lblPrice','lblOrigin','lblSpec','lblBarcode','lblMemo'].forEach(id=>$(id).addEventListener('input',updatePreview));
    // Print spec controls
    if($('paperSize'))$('paperSize').onchange=()=>{updatePreview();updatePrintCalc()};
    if($('printSpecSelect'))$('printSpecSelect').onchange=()=>{const s=specs.find(x=>x.id===$('printSpecSelect').value);if(s){$('printLabelW').value=s.labelWidth||63.5;$('printLabelH').value=s.labelHeight||38.1}updatePreview();updatePrintCalc()};
    if($('printLabelW'))$('printLabelW').oninput=()=>{updatePreview();updatePrintCalc()};
    if($('printLabelH'))$('printLabelH').oninput=()=>{updatePreview();updatePrintCalc()};
    $('btnSave').onclick=saveLabel;
    $('btnNew').onclick=()=>{resetEditor();updatePreview()};
    $('btnResetLayout').onclick=()=>{layout={};updatePreview();toast('위치 초기화','info')};
    $('btnAddSpec').onclick=()=>openSpecModal(null);
    $('specModalClose').onclick=$('specModalCancel').onclick=()=>$('specModalOverlay').classList.remove('active');
    $('specModalSave').onclick=saveSpec;
    $('specModalOverlay').onclick=e=>{if(e.target===$('specModalOverlay'))$('specModalOverlay').classList.remove('active')};
    $('btnAddToPrint').onclick=openLabelPicker;
    $('labelPickerClose').onclick=()=>$('labelPickerOverlay').classList.remove('active');
    $('labelPickerOverlay').onclick=e=>{if(e.target===$('labelPickerOverlay'))$('labelPickerOverlay').classList.remove('active')};
    $('btnDoPrint').onclick=handlePrint;
    renderPrintList();updatePreview()
})
})();
