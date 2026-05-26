(function(){
'use strict';
async function af(u,o={}){let t=null;try{if(window.parent&&window.parent.getAuthToken)t=await window.parent.getAuthToken()}catch(e){}if(!o.headers)o.headers={};if(t)o.headers['Authorization']='Bearer '+t;return fetch(u,o)}
const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?'http://localhost:3000/api/hq':'https://kng.junparks.com/api/hq';
const $=id=>document.getElementById(id),E=s=>s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let labels=[],specs=[],ltpls=[],curId=null,esId=null,layout={};
const PP={A4:{w:210,h:297},A3:{w:297,h:420}};
function toast(m,t='info'){const c=$('toastC');if(!c)return;const el=document.createElement('div');el.className='toast '+t;el.innerHTML=`<i class='bx bx-${t==='success'?'check-circle':t==='error'?'error-circle':t==='warning'?'error':'info-circle'}'></i> <span>${E(m)}</span>`;c.appendChild(el);setTimeout(()=>{el.classList.add('fade-out');setTimeout(()=>el.remove(),300)},3e3)}

// Tabs
function initTabs(){document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tp').forEach(x=>x.classList.remove('active'));b.classList.add('active');const id={editor:'pEditor',list:'pList',specs:'pSpecs'}[b.dataset.tab];if($(id))$(id).classList.add('active');if(b.dataset.tab==='list'){renderList();updCalc()}if(b.dataset.tab==='specs')renderSpecs()})}
function goTab(n){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===n));document.querySelectorAll('.tp').forEach(p=>p.classList.remove('active'));const id={editor:'pEditor',list:'pList',specs:'pSpecs'}[n];if($(id))$(id).classList.add('active')}

// Logo
function initLogo(){const fi=$('logoFI');$('btnUpLogo').onclick=()=>fi.click();$('logoPv').onclick=()=>fi.click();$('btnClrLogo').onclick=()=>{$('logoImg').src='';$('logoImg').style.display='none';$('logoPh').style.display='';updPv()};fi.onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>2e6){toast('2MB 이하','warning');return}const r=new FileReader();r.onload=v=>{$('logoImg').src=v.target.result;$('logoImg').style.display='';$('logoPh').style.display='none';updPv()};r.readAsDataURL(f);fi.value=''}}
async function fetchLT(){try{const r=await af(API+'/logo-templates');if(r.ok)ltpls=await r.json()}catch(e){}$('logoTplSel').innerHTML='<option value="">— 로고 템플릿 —</option>'+ltpls.map(t=>`<option value="${t.id}">${E(t.manufacturer)}</option>`).join('')}
function initLT(){$('logoTplSel').onchange=()=>{const t=ltpls.find(x=>x.id===$('logoTplSel').value);if(t&&t.logoBase64){$('logoImg').src=t.logoBase64;$('logoImg').style.display='';$('logoPh').style.display='none';updPv();toast(t.manufacturer+' 적용','success')}};$('btnSaveTpl').onclick=async()=>{const lg=$('logoImg').style.display!=='none'?$('logoImg').src:'';if(!lg){toast('로고 먼저 선택','warning');return}const m=$('fMfr').value.trim()||prompt('제조사명:');if(!m)return;try{await af(API+'/logo-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manufacturer:m,logoBase64:lg})});await fetchLT();toast('저장','success')}catch(e){toast('실패','error')}};$('btnDelTpl').onclick=async()=>{const id=$('logoTplSel').value;if(!id)return;if(!confirm('삭제?'))return;try{await af(API+'/logo-templates/'+id,{method:'DELETE'});await fetchLT();toast('삭제','success')}catch(e){toast('실패','error')}}}

// Data
function coll(){return{name:$('fName').value.trim(),productName:$('fProd').value.trim(),manufacturer:$('fMfr').value.trim(),price:$('fPrice').value.trim(),origin:$('fOrigin').value.trim(),spec:$('fSpec').value.trim(),barcode:$('fBarcode').value.trim(),memo:$('fMemo').value.trim(),logoBase64:$('logoImg').style.display!=='none'?$('logoImg').src:'',extraFields:[],layout}}
function load(d){$('fName').value=d.name||'';$('fProd').value=d.productName||'';$('fMfr').value=d.manufacturer||'';$('fPrice').value=d.price||'';$('fOrigin').value=d.origin||'';$('fSpec').value=d.spec||'';$('fBarcode').value=d.barcode||'';$('fMemo').value=d.memo||'';if(d.logoBase64){$('logoImg').src=d.logoBase64;$('logoImg').style.display='';$('logoPh').style.display='none'}else{$('logoImg').src='';$('logoImg').style.display='none';$('logoPh').style.display=''}try{layout=typeof d.layout==='string'?JSON.parse(d.layout||'{}'):(d.layout||{})}catch(e){layout={}}updPv()}
function reset(){curId=null;layout={};load({})}

// Layout
function dp(){return{logo:{x:50,y:15},product:{x:50,y:38},mfr:{x:50,y:52},price:{x:50,y:66},info:{x:50,y:80},memo:{x:50,y:92}}}
function gp(k){return(layout&&layout[k])?layout[k]:dp()[k]}

// Calc
function calcG(pw,ph,lw,lh,mt,mb,ml,mr,gx,gy){return{cols:Math.max(1,Math.floor((pw-ml-mr+gx)/(lw+gx))),rows:Math.max(1,Math.floor((ph-mt-mb+gy)/(lh+gy)))}}

// Preview (single label for editor)
function updPv(){
    const d=coll(),c=$('pvC');
    let lw=63.5, lh=38.1;
    const pvSpId=$('pvSpec')?$('pvSpec').value:'';
    if(pvSpId){
        const s=specs.find(x=>x.id===pvSpId);
        if(s){lw=s.labelWidth||63.5;lh=s.labelHeight||38.1;}
    }
    const w=380, h=w*(lh/lw);
    const fs=Math.max(10, Math.min(20, w/18));
    const els=[];
    if(d.logoBase64)els.push({k:'logo',h:`<img style="max-height:${h*0.35}px;max-width:${w*0.7}px;object-fit:contain" src="${d.logoBase64}">`});
    if(d.productName)els.push({k:'product',h:`<div class="p-nm" style="max-width:${w-10}px;font-size:110%">${E(d.productName)}</div>`});
    if(d.manufacturer)els.push({k:'mfr',h:`<div class="p-mfr" style="max-width:${w-10}px;font-size:85%">${E(d.manufacturer)}</div>`});
    if(d.price)els.push({k:'price',h:`<div class="p-prc" style="font-size:120%">${E(d.price)}</div>`});
    const ip=[d.origin,d.spec,d.barcode].filter(Boolean);
    if(ip.length)els.push({k:'info',h:`<div class="p-info" style="max-width:${w-10}px;font-size:75%">${E(ip.join(' | '))}</div>`});
    if(d.memo)els.push({k:'memo',h:`<div class="p-info" style="max-width:${w-10}px;font-size:70%">${E(d.memo)}</div>`});
    let s=`<div class="pv-sheet" style="width:${w}px;height:${h}px;position:relative;background:#fff"><div class="pv-label first-label" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;font-size:${fs}px;box-shadow:0 0 0 1px var(--gray-200) inset">`;
    for(const e of els){const p=gp(e.k);s+=`<div class="el" data-key="${e.k}" style="left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%)">${e.h}</div>`}
    s+='</div></div>';c.innerHTML=s;initDrag(c.querySelector('.first-label'))
}
function initDrag(el){if(!el)return;el.querySelectorAll('.el').forEach(n=>{n.onmousedown=e=>{e.preventDefault();const k=n.dataset.key,r=el.getBoundingClientRect();n.classList.add('dragging');const mv=v=>{n.style.left=Math.max(0,Math.min(100,(v.clientX-r.left)/r.width*100))+'%';n.style.top=Math.max(0,Math.min(100,(v.clientY-r.top)/r.height*100))+'%'};const up=v=>{n.classList.remove('dragging');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);layout[k]={x:Math.round(Math.max(0,Math.min(100,(v.clientX-r.left)/r.width*100))*10)/10,y:Math.round(Math.max(0,Math.min(100,(v.clientY-r.top)/r.height*100))*10)/10};updPv()};document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up)}})}

// Labels CRUD
async function fetchL(){try{const r=await af(API+'/labels');if(r.ok)labels=await r.json()}catch(e){}}
async function saveL(){const d=coll();if(!d.name){toast('라벨 이름을 입력하세요','warning');return}try{const u=curId?`${API}/labels/${curId}`:`${API}/labels`;const r=await af(u,{method:curId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const j=await r.json();if(!r.ok)throw new Error(j.error);if(!curId)curId=j.id;await fetchL();toast('저장 완료','success')}catch(e){toast(e.message,'error')}}
async function delL(id){if(!confirm('삭제?'))return;try{await af(API+'/labels/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})});if(curId===id)reset();await fetchL();renderList();toast('삭제','success')}catch(e){toast(e.message,'error')}}

// Label list with checkboxes + qty
function renderList(){
    const el=$('lblList');
    if(!labels.length){el.innerHTML='<div class="empty"><i class="bx bx-folder-open"></i><p>편집 탭에서 라벨을 만들어 저장하세요</p></div>';return}
    el.innerHTML=labels.map(l=>`<div class="lbl-row" data-id="${l.id}">
<input type="checkbox" class="chk" data-id="${l.id}">
<span class="name" data-id="${l.id}">${E(l.name||l.productName||'(이름없음)')}</span>
<span class="detail">${E(l.manufacturer||'')}</span>
<input type="number" class="qty" min="1" max="500" value="1" data-id="${l.id}">
<button class="del" data-id="${l.id}"><i class='bx bx-trash'></i></button>
</div>`).join('');
    el.querySelectorAll('.name').forEach(n=>n.onclick=()=>{const lb=labels.find(x=>x.id===n.dataset.id);if(lb){curId=lb.id;load(lb);goTab('editor')}});
    el.querySelectorAll('.del').forEach(b=>b.onclick=()=>delL(b.dataset.id));
    el.querySelectorAll('.chk').forEach(c=>c.onchange=updCalc);
    el.querySelectorAll('.qty').forEach(q=>q.onchange=updCalc)
}
function getChecked(){
    const items=[];
    document.querySelectorAll('.lbl-row').forEach(row=>{
        const chk=row.querySelector('.chk');if(!chk||!chk.checked)return;
        const id=chk.dataset.id,qty=parseInt(row.querySelector('.qty').value)||1;
        const lb=labels.find(x=>x.id===id);if(lb)items.push({label:lb,qty})
    });return items
}
function updCalc(){
    const items=getChecked(),total=items.reduce((s,i)=>s+i.qty,0);
    const sp=getPS(),g=calcG(sp.pw,sp.ph,sp.lw,sp.lh,sp.mt,sp.mb,sp.ml,sp.mr,sp.gx,sp.gy);
    const lps=g.cols*g.rows,sheets=total?Math.ceil(total/lps):0;
    $('calcInfo').innerHTML=`라벨 ${sp.lw}×${sp.lh}mm · <b>${g.cols}열×${g.rows}행=${lps}칸</b>/장 · 선택 ${total}개 → <b>${sheets}장</b> 출력`
}
function getPS(){
    const p=PP[$('selPaper').value]||PP.A4;
    const sp=specs.find(s=>s.id===$('selSpec').value);
    return{pw:p.w,ph:p.h,lw:parseFloat($('inLW').value)||63.5,lh:parseFloat($('inLH').value)||38.1,mt:sp?sp.marginTop:15,mb:sp?sp.marginBottom:15,ml:sp?sp.marginLeft:7,mr:sp?sp.marginRight:7,gx:sp?sp.gapX:2.5,gy:sp?sp.gapY:0}
}

// Specs
async function fetchS(){try{const r=await af(API+'/label-specs');if(r.ok)specs=await r.json()}catch(e){}popSel()}
function popSel(){
    const s=$('selSpec'), pv=$('pvSpec');
    if(s){const p=s.value;s.innerHTML='<option value="">직접 입력</option>'+specs.map(x=>`<option value="${x.id}">${E(x.name)}</option>`).join('');if(p&&specs.find(x=>x.id===p))s.value=p}
    if(pv){const pp=pv.value;pv.innerHTML='<option value="">기본 규격 (63.5×38.1)</option>'+specs.map(x=>`<option value="${x.id}">${E(x.name)}</option>`).join('');if(pp&&specs.find(x=>x.id===pp))pv.value=pp;else if(specs.length)pv.value=specs.find(x=>x.isDefault)?specs.find(x=>x.isDefault).id:specs[0].id}
}
function renderSpecs(){$('specList').innerHTML=specs.map(s=>`<div class="sp-item"><div class="sp-hd"><div class="sp-nm">${E(s.name)} ${s.isDefault?'<span class="sp-badge">기본</span>':''}</div><div class="sp-act"><button class="ed" data-id="${s.id}"><i class='bx bx-edit'></i></button>${!s.isDefault?`<button class="dl" data-id="${s.id}"><i class='bx bx-trash'></i></button>`:''}</div></div><div class="sp-dt"><span>${s.labelWidth||'?'}×${s.labelHeight||'?'}mm</span><span>여백 ${s.marginTop}/${s.marginBottom}/${s.marginLeft}/${s.marginRight}</span></div></div>`).join('');$('specList').querySelectorAll('.ed').forEach(b=>b.onclick=()=>openSM(b.dataset.id));$('specList').querySelectorAll('.dl').forEach(b=>b.onclick=()=>delSp(b.dataset.id))}
function openSM(id){esId=id||null;const s=id?specs.find(x=>x.id===id):null;$('mSpTitle').textContent=s?'규격 수정':'규격 추가';$('sName').value=s?s.name:'';$('sLW').value=s?s.labelWidth:63.5;$('sLH').value=s?s.labelHeight:38.1;$('sMT').value=s?s.marginTop:15;$('sMB').value=s?s.marginBottom:15;$('sML').value=s?s.marginLeft:7;$('sMR').value=s?s.marginRight:7;$('sGX').value=s?s.gapX:2.5;$('sGY').value=s?s.gapY:0;$('mSpec').style.display='flex'}
async function saveSp(){const d={name:$('sName').value.trim(),labelWidth:parseFloat($('sLW').value)||63.5,labelHeight:parseFloat($('sLH').value)||38.1,marginTop:parseFloat($('sMT').value)||0,marginBottom:parseFloat($('sMB').value)||0,marginLeft:parseFloat($('sML').value)||0,marginRight:parseFloat($('sMR').value)||0,gapX:parseFloat($('sGX').value)||0,gapY:parseFloat($('sGY').value)||0};if(!d.name){toast('이름 입력','warning');return}try{const u=esId?`${API}/label-specs/${esId}`:`${API}/label-specs`;await af(u,{method:esId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});await fetchS();renderSpecs();$('mSpec').style.display='none';toast('저장','success')}catch(e){toast('실패','error')}}
async function delSp(id){if(!confirm('삭제?'))return;try{await af(`${API}/label-specs/${id}`,{method:'DELETE'});await fetchS();renderSpecs();toast('삭제','success')}catch(e){toast('실패','error')}}

// Print
function doPrint(){
    const items=getChecked();if(!items.length){toast('라벨을 체크하세요','warning');return}
    const s=getPS(),g=calcG(s.pw,s.ph,s.lw,s.lh,s.mt,s.mb,s.ml,s.mr,s.gx,s.gy);
    const flat=[];items.forEach(i=>{let lo={};try{lo=typeof i.label.layout==='string'?JSON.parse(i.label.layout||'{}'):(i.label.layout||{})}catch(e){}for(let n=0;n<i.qty;n++)flat.push({d:i.label,lo})});
    const lps=g.cols*g.rows,sheets=Math.ceil(flat.length/lps),fs=Math.max(6,Math.min(11,s.lw/7));
    let h='',idx=0;
    for(let sh=0;sh<sheets&&idx<flat.length;sh++){
        h+=`<div class="ps" style="width:${s.pw}mm;height:${s.ph}mm;position:relative;box-sizing:border-box">`;
        for(let r=0;r<g.rows&&idx<flat.length;r++)for(let c=0;c<g.cols&&idx<flat.length;c++,idx++){
            const{d,lo}=flat[idx],cx=s.ml+c*(s.lw+s.gx),cy=s.mt+r*(s.lh+s.gy);
            const gpp=k=>(lo&&lo[k])?lo[k]:dp()[k];
            h+=`<div style="position:absolute;left:${cx}mm;top:${cy}mm;width:${s.lw}mm;height:${s.lh}mm;overflow:hidden;font-size:${fs}pt">`;
            const els=[];
            if(d.logoBase64)els.push({k:'logo',v:`<img src="${d.logoBase64}" style="max-height:30%;max-width:60%;object-fit:contain">`});
            if(d.productName)els.push({k:'product',v:`<div style="font-weight:700;text-align:center;line-height:1.2">${E(d.productName)}</div>`});
            if(d.manufacturer)els.push({k:'mfr',v:`<div style="font-size:85%;color:#666;text-align:center">${E(d.manufacturer)}</div>`});
            if(d.price)els.push({k:'price',v:`<div style="font-weight:800;text-align:center;color:#333">${E(d.price)}</div>`});
            const ip=[d.origin,d.spec,d.barcode].filter(Boolean);
            if(ip.length)els.push({k:'info',v:`<div style="font-size:75%;color:#999;text-align:center">${E(ip.join(' | '))}</div>`});
            if(d.memo)els.push({k:'memo',v:`<div style="font-size:70%;color:#aaa;text-align:center">${E(d.memo)}</div>`});
            for(const e of els){const p=gpp(e.k);h+=`<div style="position:absolute;left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%)">${e.v}</div>`}
            h+='</div>'}
        h+='</div>'}
    const pa=$('printArea');pa.innerHTML=h;pa.style.display='block';
    setTimeout(()=>{window.print();setTimeout(()=>{pa.style.display='none'},500)},200)
}

// Init
document.addEventListener('DOMContentLoaded',async()=>{
    initTabs();initLogo();initLT();
    await Promise.all([fetchL(),fetchS(),fetchLT()]);
    ['fName','fProd','fMfr','fPrice','fOrigin','fSpec','fBarcode','fMemo'].forEach(id=>$(id).oninput=updPv);
    $('btnSave').onclick=saveL;$('btnNew').onclick=()=>{reset();updPv()};
    $('btnRst').onclick=()=>{layout={};updPv();toast('초기화','info')};
    if($('pvSpec'))$('pvSpec').onchange=updPv;
    $('selPaper').onchange=$('inLW').oninput=$('inLH').oninput=updCalc;
    $('selSpec').onchange=()=>{const s=specs.find(x=>x.id===$('selSpec').value);if(s){$('inLW').value=s.labelWidth||63.5;$('inLH').value=s.labelHeight||38.1}updCalc()};
    $('btnPrint').onclick=doPrint;
    $('btnAddSp').onclick=()=>openSM(null);
    $('mSpX').onclick=$('mSpCancel').onclick=()=>$('mSpec').style.display='none';
    $('mSpSave').onclick=saveSp;
    $('mSpec').onclick=e=>{if(e.target===$('mSpec'))$('mSpec').style.display='none'};
    updPv();updCalc()
})
})();
