(function(){
'use strict';
async function af(u,o={}){let t=null;try{if(window.parent&&window.parent.getAuthToken)t=await window.parent.getAuthToken()}catch(e){}if(!o.headers)o.headers={};if(t)o.headers['Authorization']='Bearer '+t;return fetch(u,o)}
const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?'http://localhost:3000/api/hq':'https://kng.junparks.com/api/hq';
const $=id=>document.getElementById(id),E=s=>s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let labels=[],specs=[],ltpls=[],curId=null,esId=null,layout={},selectedKeys=new Set(),keyObjectKey=null,historyStack=[];
const PP={A4:{w:210,h:297},A3:{w:297,h:420}};
function toast(m,t='info'){const c=$('toastC');if(!c)return;const el=document.createElement('div');el.className='toast '+t;el.innerHTML=`<i class='bx bx-${t==='success'?'check-circle':t==='error'?'error-circle':t==='warning'?'error':'info-circle'}'></i> <span>${E(m)}</span>`;c.appendChild(el);setTimeout(()=>{el.classList.add('fade-out');setTimeout(()=>el.remove(),300)},3e3)}

// Tabs
function initTabs(){document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tp').forEach(x=>x.classList.remove('active'));b.classList.add('active');const id={editor:'pEditor',list:'pList',specs:'pSpecs'}[b.dataset.tab];if($(id))$(id).classList.add('active');if(b.dataset.tab==='list'){renderList();updCalc()}if(b.dataset.tab==='specs')renderSpecs()})}
function goTab(n){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===n));document.querySelectorAll('.tp').forEach(p=>p.classList.remove('active'));const id={editor:'pEditor',list:'pList',specs:'pSpecs'}[n];if($(id))$(id).classList.add('active')}

// Logo
function initLogo(){const fi=$('logoFI');$('btnUpLogo').onclick=()=>fi.click();$('logoPv').onclick=()=>fi.click();$('btnClrLogo').onclick=()=>{$('logoImg').src='';$('logoImg').style.display='none';$('logoPh').style.display='';updPv()};fi.onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>2e6){toast('2MB 이하','warning');return}const r=new FileReader();r.onload=v=>{$('logoImg').src=v.target.result;$('logoImg').style.display='';$('logoPh').style.display='none';updPv()};r.readAsDataURL(f);fi.value=''}}
async function fetchLT(){try{const r=await af(API+'/logo-templates');if(r.ok)ltpls=await r.json()}catch(e){}$('logoTplSel').innerHTML='<option value="">— 로고 템플릿 —</option>'+ltpls.map(t=>`<option value="${t.id}">${E(t.manufacturer)}</option>`).join('')}
function initLT(){$('logoTplSel').onchange=()=>{const t=ltpls.find(x=>x.id===$('logoTplSel').value);if(t&&t.logoBase64){$('logoImg').src=t.logoBase64;$('logoImg').style.display='';$('logoPh').style.display='none';updPv();toast(t.manufacturer+' 적용','success')}};$('btnSaveTpl').onclick=async()=>{const lg=$('logoImg').style.display!=='none'?$('logoImg').src:'';if(!lg){toast('로고 먼저 선택','warning');return}const m=$('fMfr').value.trim()||prompt('제조사명:');if(!m)return;try{await af(API+'/logo-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manufacturer:m,logoBase64:lg})});await fetchLT();toast('저장','success')}catch(e){toast('실패','error')}};$('btnDelTpl').onclick=async()=>{const id=$('logoTplSel').value;if(!id)return;if(!confirm('삭제?'))return;try{await af(API+'/logo-templates/'+id,{method:'DELETE'});await fetchLT();toast('삭제','success')}catch(e){toast('실패','error')}}}

function saveHistory(){historyStack.push(JSON.stringify(layout));if(historyStack.length>30)historyStack.shift();}
function undo(){if(historyStack.length>0){layout=JSON.parse(historyStack.pop());selectedKeys.clear();keyObjectKey=null;updPv();}}
function deleteSelected(){if(!selectedKeys.size)return;saveHistory();selectedKeys.forEach(k=>{if(!layout[k])layout[k]={...gp(k)};layout[k].hidden=true;});selectedKeys.clear();keyObjectKey=null;updPv();}

// Data
function coll(){layout.isTableMode=$('chkTableMode').checked;return{name:$('fName').value.trim(),productName:$('fProd').value.trim(),color:$('fColor').value.trim(),size:$('fSize').value.trim(),manufacturer:$('fMfr').value.trim(),price:$('fPrice').value.trim(),origin:$('fOrigin').value.trim(),spec:$('fSpec').value.trim(),barcode:$('fBarcode').value.trim(),memo:$('fMemo').value.trim(),logoBase64:$('logoImg').style.display!=='none'?$('logoImg').src:'',memoImageBase64:$('memoImgWrapper').style.display!=='none'?$('memoImg').src:'',extraFields:[],layout}}
function load(d){$('fName').value=d.name||'';$('fProd').value=d.productName||'';$('fColor').value=d.color||'';$('fSize').value=d.size||'';$('fMfr').value=d.manufacturer||'';$('fPrice').value=d.price||'';$('fOrigin').value=d.origin||'';$('fSpec').value=d.spec||'';$('fBarcode').value=d.barcode||'';$('fMemo').value=d.memo||'';if(d.logoBase64){$('logoImg').src=d.logoBase64;$('logoImg').style.display='';$('logoPh').style.display='none'}else{$('logoImg').src='';$('logoImg').style.display='none';$('logoPh').style.display=''}if(d.memoImageBase64){$('memoImg').src=d.memoImageBase64;$('memoImgWrapper').style.display=''}else{$('memoImg').src='';$('memoImgWrapper').style.display='none'}try{layout=typeof d.layout==='string'?JSON.parse(d.layout||'{}'):(d.layout||{})}catch(e){layout={}}$('chkTableMode').checked=!!layout.isTableMode;updPv()}
function reset(){curId=null;layout={isTableMode:$('chkTableMode').checked};selectedKeys.clear();keyObjectKey=null;historyStack=[];load({layout})}

// Layout
function dp(){return{logo:{x:50,y:10},product_lbl:{x:20,y:25,bold:true},product_val:{x:60,y:25,bold:false},color_lbl:{x:20,y:35,bold:true},color_val:{x:60,y:35,bold:false},size_lbl:{x:20,y:45,bold:true},size_val:{x:60,y:45,bold:false},mfr_lbl:{x:20,y:55,bold:true},mfr_val:{x:60,y:55,bold:false},price_lbl:{x:20,y:65,bold:true},price_val:{x:60,y:65,bold:false},info_lbl:{x:20,y:75,bold:true},info_val:{x:60,y:75,bold:false},memo_lbl:{x:20,y:85,bold:true},memo_val:{x:60,y:85,bold:false},table:{x:50,y:50},memoImg:{x:50,y:80}}}
function gp(k){const d=dp()[k]||{x:50,y:50},l=layout&&layout[k]?layout[k]:{};return{x:l.x??d.x,y:l.y??d.y,sx:l.sx??1,sy:l.sy??1,fs:l.fs||null,bold:l.bold??d.bold??false,nowrap:l.nowrap||false,hidden:l.hidden||false}}

// Calc
function calcG(pw,ph,lw,lh,mt,mb,ml,mr,gx,gy){return{cols:Math.max(1,Math.floor((pw-ml-mr+gx)/(lw+gx))),rows:Math.max(1,Math.floor((ph-mt-mb+gy)/(lh+gy)))}}

// Preview (single label for editor)
function updPv(){
    const d=coll(),c=$('pvC');
    const lw=parseFloat($('inLW')?$('inLW').value:63.5)||63.5;
    const lh=parseFloat($('inLH')?$('inLH').value:38.1)||38.1;
    const zoom=parseFloat($('pvZoom')?$('pvZoom').value:1.5)||1.5;
    const w=lw*3.78*zoom, h=lh*3.78*zoom;
    const fs=Math.max(10, Math.min(20, w/18));
    
    const formatPrice = p => { if(!p)return''; let n=Number(p.replace(/,/g,'')); return isNaN(n)?E(p):n.toLocaleString()+'원'; };
    const makeRow = (lbl, val, isPrc=false) => `<div style="display:flex;align-items:flex-start;text-align:left;line-height:1.3;white-space:nowrap;color:#000"><div style="width:2.8em;margin-right:1em;text-align-last:justify;font-weight:600">${lbl}</div><div style="font-weight:${isPrc?'800':'600'}">${isPrc?`${val}<br><span style="font-size:75%;font-weight:normal">(부가세 포함)</span>`:val}</div></div>`;

    const isTableMode=$('chkTableMode').checked;

    const els=[];
    if(d.logoBase64)els.push({k:'logo',h:`<img style="max-height:${h*0.35}px;max-width:${w*0.7}px;object-fit:contain" src="${d.logoBase64}">`});
    if(d.memoImageBase64)els.push({k:'memoImg',h:`<img style="max-height:${h*0.3}px;max-width:${w*0.7}px;object-fit:contain" src="${d.memoImageBase64}">`});

    if(isTableMode){
        let th = `<table class="lbl-table">`;
        if(d.productName)th+=`<tr><td style="width:3em;font-weight:600">품 명</td><td style="font-weight:600">${E(d.productName)}</td></tr>`;
        if(d.color)th+=`<tr><td style="font-weight:600">컬 러</td><td style="font-weight:600">${E(d.color)}</td></tr>`;
        if(d.size)th+=`<tr><td style="font-weight:600">사이즈</td><td style="font-weight:600">${E(d.size)}</td></tr>`;
        if(d.manufacturer)th+=`<tr><td style="font-weight:600">제조사</td><td style="font-weight:600">${E(d.manufacturer)}</td></tr>`;
        if(d.origin)th+=`<tr><td style="font-weight:600">브랜드</td><td style="font-weight:600">${E(d.origin)}</td></tr>`;
        if(d.spec)th+=`<tr><td style="font-weight:600">포장규격</td><td style="font-weight:600">${E(d.spec)}</td></tr>`;
        if(d.price)th+=`<tr><td style="font-weight:600">가 격</td><td style="font-weight:800">${formatPrice(d.price)}<br><span style="font-size:75%;font-weight:normal">(부가세 포함)</span></td></tr>`;
        if(d.memo)th+=`<tr><td style="font-weight:600">비 고</td><td style="font-weight:600">${E(d.memo)}</td></tr>`;
        th += `</table>`;
        if(th.includes('<tr>')) els.push({k:'table', h:th});
    } else {
        if(d.productName){ els.push({k:'product_lbl',h:'품 명'}); els.push({k:'product_val',h:E(d.productName)}); }
        if(d.color){ els.push({k:'color_lbl',h:'컬 러'}); els.push({k:'color_val',h:E(d.color)}); }
        if(d.size){ els.push({k:'size_lbl',h:'사이즈'}); els.push({k:'size_val',h:E(d.size)}); }
        if(d.manufacturer){ els.push({k:'mfr_lbl',h:'제조사'}); els.push({k:'mfr_val',h:E(d.manufacturer)}); }
        if(d.price){ els.push({k:'price_lbl',h:'가 격'}); els.push({k:'price_val',h:formatPrice(d.price)}); }
        const ip=[d.origin,d.spec].filter(Boolean);
        if(ip.length){ els.push({k:'info_lbl',h:'정 보'}); els.push({k:'info_val',h:E(ip.join(' | '))}); }
        if(d.memo){ els.push({k:'memo_lbl',h:'메 모'}); els.push({k:'memo_val',h:E(d.memo)}); }
    }
    
    let s=`<div class="pv-sheet" style="width:${w}px;height:${h}px;position:relative;background:#fff"><div class="pv-label first-label" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;font-size:${fs}px;box-shadow:0 0 0 1px var(--gray-200) inset">`;
    for(const e of els){
        const p=gp(e.k);
        if(p.hidden) continue;
        const sel=selectedKeys.has(e.k)?'selected':'';
        const ko=keyObjectKey===e.k?'key-object':'';
        const stFS=p.fs?`font-size:${p.fs}px;`:'';
        const stB=p.bold?`font-weight:bold;`:'';
        const stW=p.nowrap?`white-space:nowrap;`:'';
        s+=`<div class="el ${sel} ${ko}" data-key="${e.k}" style="left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%) scale(${p.sx},${p.sy});${stFS}${stB}${stW}">${e.h}<div class="resizer"></div></div>`;
    }
    s+='</div></div>';c.innerHTML=s;initInteraction(c.querySelector('.first-label'))

    if($('pvToolbar')){
        $('pvToolbar').style.display=selectedKeys.size>0?'flex':'none';
        if(selectedKeys.size>0){
            const fKey = [...selectedKeys][0];
            const p = gp(fKey);
            $('inTSize').value=p.fs||'';
            $('btnTBold').style.background=p.bold?'#e2e8f0':'';
            if($('btnTWrap')) $('btnTWrap').style.background=p.nowrap?'#e2e8f0':'';
            
            const hasImg = [...selectedKeys].some(k=>k==='logo'||k==='memoImg');
            if($('inTScale')){
                $('inTScale').style.display = hasImg ? 'inline-block' : 'none';
                if(hasImg) $('inTScale').value = Math.round((p.sx||1)*100);
            }
        }
    }
}

function initInteraction(el){
    if(!el) return;
    // --- Click on element: select / shift-toggle ---
    el.querySelectorAll('.el').forEach(n=>{
        // Resize handle
        const rz=n.querySelector('.resizer');
        if(rz) rz.onmousedown=e=>{
            e.preventDefault();e.stopPropagation();
            saveHistory();
            const k=n.dataset.key, rect=el.getBoundingClientRect();
            const startX=e.clientX, startY=e.clientY;
            const cur=gp(k); const sx0=cur.sx, sy0=cur.sy;
            const mv=v=>{
                let dx=(v.clientX-startX)/rect.width*4;
                let dy=(v.clientY-startY)/rect.height*4;
                if(v.shiftKey){const d=Math.max(dx,dy);dx=d;dy=d;}
                const nsx=Math.max(0.3,Math.min(4,sx0+dx));
                const nsy=Math.max(0.3,Math.min(4,sy0+dy));
                if(!layout[k])layout[k]={...gp(k)};
                layout[k].sx=Math.round(nsx*100)/100;
                layout[k].sy=Math.round(nsy*100)/100;
                // Apply to all selected if multi-selected
                if(selectedKeys.has(k)&&selectedKeys.size>1){
                    const dsx=layout[k].sx-sx0, dsy=layout[k].sy-sy0;
                    selectedKeys.forEach(sk=>{
                        if(sk===k)return;
                        if(!layout[sk])layout[sk]={...gp(sk)};
                        const orig=gp(sk);
                        layout[sk].sx=Math.max(0.3,Math.min(4,Math.round(((orig.sx||1)+dsx)*100)/100));
                        layout[sk].sy=Math.max(0.3,Math.min(4,Math.round(((orig.sy||1)+dsy)*100)/100));
                    });
                }
                updPv();
            };
            const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
            document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
            return;
        };
        // Move handle
        n.onmousedown=e=>{
            if(e.target.classList.contains('resizer'))return;
            e.preventDefault();
            const k=n.dataset.key, rect=el.getBoundingClientRect();
            // Selection logic
            if(e.shiftKey){
                if(selectedKeys.has(k)){
                    selectedKeys.delete(k);
                    if(keyObjectKey===k)keyObjectKey=null;
                } else selectedKeys.add(k);
                updPv(); return;
            } else if(!selectedKeys.has(k)){
                selectedKeys.clear(); selectedKeys.add(k); keyObjectKey=null; updPv();
            } else {
                keyObjectKey=k;
                el.querySelectorAll('.el').forEach(x=>x.classList.remove('key-object'));
                n.classList.add('key-object');
            }
            // Collect initial positions of all selected
            const startX=e.clientX, startY=e.clientY;
            const initPos={};
            selectedKeys.forEach(sk=>{
                const p=gp(sk);
                initPos[sk]={x:p.x,y:p.y};
            });
            n.classList.add('dragging');
            const mv=v=>{
                let dxPct=(v.clientX-startX)/rect.width*100;
                let dyPct=(v.clientY-startY)/rect.height*100;
                // Shift: constrain to single axis
                if(v.shiftKey){if(Math.abs(dxPct)>Math.abs(dyPct))dyPct=0;else dxPct=0;}
                selectedKeys.forEach(sk=>{
                    const nd=el.querySelector(`.el[data-key="${sk}"]`);
                    if(!nd)return;
                    const nx=Math.max(0,Math.min(100,initPos[sk].x+dxPct));
                    const ny=Math.max(0,Math.min(100,initPos[sk].y+dyPct));
                    nd.style.left=nx+'%'; nd.style.top=ny+'%';
                });
            };
            const up=v=>{
                n.classList.remove('dragging');
                document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
                let dxPct=(v.clientX-startX)/rect.width*100;
                let dyPct=(v.clientY-startY)/rect.height*100;
                if(v.shiftKey){if(Math.abs(dxPct)>Math.abs(dyPct))dyPct=0;else dxPct=0;}
                if(Math.abs(dxPct)>0.1 || Math.abs(dyPct)>0.1) saveHistory();
                selectedKeys.forEach(sk=>{
                    if(!layout[sk])layout[sk]={...gp(sk)};
                    layout[sk].x=Math.round(Math.max(0,Math.min(100,initPos[sk].x+dxPct))*10)/10;
                    layout[sk].y=Math.round(Math.max(0,Math.min(100,initPos[sk].y+dyPct))*10)/10;
                });
                updPv();
            };
            document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
        };
    });
    // --- Click on empty space: deselect all or marquee ---
    el.onmousedown=e=>{
        if(e.target!==el)return;
        e.preventDefault();
        selectedKeys.clear();
        keyObjectKey=null;
        // Marquee selection
        const rect=el.getBoundingClientRect();
        const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
        const mq=document.createElement('div');
        mq.className='marquee';
        mq.style.cssText=`left:${sx}px;top:${sy}px;width:0;height:0`;
        el.appendChild(mq);
        const mv=v=>{
            const cx=v.clientX-rect.left, cy=v.clientY-rect.top;
            mq.style.left=Math.min(sx,cx)+'px'; mq.style.top=Math.min(sy,cy)+'px';
            mq.style.width=Math.abs(cx-sx)+'px'; mq.style.height=Math.abs(cy-sy)+'px';
        };
        const up=v=>{
            document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
            const mr=mq.getBoundingClientRect();
            el.querySelectorAll('.el').forEach(nd=>{
                const er=nd.getBoundingClientRect();
                if(er.left<mr.right&&er.right>mr.left&&er.top<mr.bottom&&er.bottom>mr.top){
                    selectedKeys.add(nd.dataset.key);
                }
            });
            mq.remove();
            updPv();
        };
        document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
    };
}

    function alignElements(type) {
        saveHistory();
        // Find all possible keys in the current UI
        const allKeys = Array.from(document.querySelectorAll('.pv-label .el')).map(n=>n.dataset.key);
        let activeKeys = selectedKeys.size > 0 ? [...selectedKeys] : allKeys;
        activeKeys = activeKeys.filter(k => document.querySelector(`.el[data-key="${k}"]`));
        if(!activeKeys.length) return;
        activeKeys.forEach(k => { if(!layout[k]) layout[k] = {...gp(k)}; });
        
        let targetX = 50, targetY = 50;
        if (keyObjectKey && selectedKeys.has(keyObjectKey)) {
            targetX = layout[keyObjectKey].x;
            targetY = layout[keyObjectKey].y;
        } else if (selectedKeys.size > 0) {
            const xs = activeKeys.map(k => layout[k].x);
            const ys = activeKeys.map(k => layout[k].y);
            if(type==='left') targetX = Math.min(...xs);
            else if(type==='right') targetX = Math.max(...xs);
            else if(type==='center') targetX = xs.reduce((a,b)=>a+b,0)/xs.length;
            if(type==='top') targetY = Math.min(...ys);
            else if(type==='bottom') targetY = Math.max(...ys);
            else if(type==='middle') targetY = ys.reduce((a,b)=>a+b,0)/ys.length;
        } else {
            if(type==='left') targetX = 10;
            else if(type==='right') targetX = 90;
            else if(type==='center') targetX = 50;
            if(type==='top') targetY = 15;
            else if(type==='bottom') targetY = 90;
            else if(type==='middle') targetY = 50;
        }

        if(type === 'left' || type === 'center' || type === 'right') {
            activeKeys.forEach(k => layout[k].x = targetX);
        } else if(type === 'top' || type === 'middle' || type === 'bottom') {
            activeKeys.forEach(k => layout[k].y = targetY);
        } else if(type === 'distribute') {
            activeKeys.sort((a,b) => layout[a].y - layout[b].y);
            const startY = activeKeys.length > 1 ? layout[activeKeys[0]].y : 15;
            const endY = activeKeys.length > 1 ? layout[activeKeys[activeKeys.length-1]].y : 90;
            const step = activeKeys.length > 1 ? (endY - startY) / (activeKeys.length - 1) : 0;
            activeKeys.forEach((k, i) => layout[k].y = Math.round((startY + step * i)*10)/10);
        }
        updPv();
    }

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
    const s=$('selSpec');
    if(s){const p=s.value;s.innerHTML='<option value="">직접 입력</option>'+specs.map(x=>`<option value="${x.id}">${E(x.name)}</option>`).join('');if(p&&specs.find(x=>x.id===p))s.value=p}
}
function renderSpecs(){$('specList').innerHTML=specs.map(s=>`<div class="sp-item"><div class="sp-hd"><div class="sp-nm">${E(s.name)} ${s.isDefault?'<span class="sp-badge">기본</span>':''}</div><div class="sp-act"><button class="ed" data-id="${s.id}"><i class='bx bx-edit'></i></button>${!s.isDefault?`<button class="dl" data-id="${s.id}"><i class='bx bx-trash'></i></button>`:''}</div></div><div class="sp-dt"><span>${s.labelWidth||'?'}×${s.labelHeight||'?'}mm</span><span>여백 ${s.marginTop}/${s.marginBottom}/${s.marginLeft}/${s.marginRight}</span></div></div>`).join('');$('specList').querySelectorAll('.ed').forEach(b=>b.onclick=()=>openSM(b.dataset.id));$('specList').querySelectorAll('.dl').forEach(b=>b.onclick=()=>delSp(b.dataset.id))}
function openSM(id){esId=id||null;const s=id?specs.find(x=>x.id===id):null;$('mSpTitle').textContent=s?'규격 수정':'규격 추가';$('sName').value=s?s.name:'';$('sLW').value=s?s.labelWidth:63.5;$('sLH').value=s?s.labelHeight:38.1;$('sMT').value=s?s.marginTop:15;$('sMB').value=s?s.marginBottom:15;$('sML').value=s?s.marginLeft:7;$('sMR').value=s?s.marginRight:7;$('sGX').value=s?s.gapX:2.5;$('sGY').value=s?s.gapY:0;$('mSpec').style.display='flex'}
async function saveSp(){const d={name:$('sName').value.trim(),labelWidth:parseFloat($('sLW').value)||63.5,labelHeight:parseFloat($('sLH').value)||38.1,marginTop:parseFloat($('sMT').value)||0,marginBottom:parseFloat($('sMB').value)||0,marginLeft:parseFloat($('sML').value)||0,marginRight:parseFloat($('sMR').value)||0,gapX:parseFloat($('sGX').value)||0,gapY:parseFloat($('sGY').value)||0};if(!d.name){toast('이름 입력','warning');return}try{const u=esId?`${API}/label-specs/${esId}`:`${API}/label-specs`;await af(u,{method:esId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});await fetchS();renderSpecs();$('mSpec').style.display='none';toast('저장','success')}catch(e){toast('실패','error')}}
async function delSp(id){if(!confirm('삭제?'))return;try{await af(`${API}/label-specs/${id}`,{method:'DELETE'});await fetchS();renderSpecs();toast('삭제','success')}catch(e){toast('실패','error')}}

// Sheet Editor Print Flow
function openSheetEditor(){
    const items=getChecked();if(!items.length){toast('라벨을 체크하세요','warning');return}
    const s=getPS(),g=calcG(s.pw,s.ph,s.lw,s.lh,s.mt,s.mb,s.ml,s.mr,s.gx,s.gy);
    const flat=[];items.forEach(i=>{let lo={};try{lo=typeof i.label.layout==='string'?JSON.parse(i.label.layout||'{}'):(i.label.layout||{})}catch(e){}for(let n=0;n<i.qty;n++)flat.push({d:i.label,lo:JSON.parse(JSON.stringify(lo))})});
    const lps=g.cols*g.rows,sheets=Math.ceil(flat.length/lps)||1;
    
    sheetSlots=[]; sheetSelectedKeys.clear(); sheetKeyObjectKey=null; sheetHistoryStack=[];
    for(let i=0;i<sheets*lps;i++) sheetSlots.push(i<flat.length?flat[i]:null);
    
    $('sheetEditor').style.display='flex';
    renderSheet();
}
function renderSheet(){
    const s=getPS(),g=calcG(s.pw,s.ph,s.lw,s.lh,s.mt,s.mb,s.ml,s.mr,s.gx,s.gy);
    const lps=g.cols*g.rows,sheets=Math.ceil(sheetSlots.length/lps)||1;
    const fs=Math.max(6,Math.min(11,s.lw/7));
    
    let h='';
    const formatPrice=p=>{if(!p)return'';let n=Number(p.replace(/,/g,''));return isNaN(n)?E(p):n.toLocaleString()+'원'};
    
    for(let sh=0;sh<sheets;sh++){
        h+=`<div class="sheet-page" style="width:${s.pw}mm;height:${s.ph}mm;background:#fff;position:relative;box-shadow:0 4px 12px rgba(0,0,0,0.1);flex-shrink:0;box-sizing:border-box">`;
        for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++){
            const idx=sh*lps+r*g.cols+c;
            if(idx>=sheetSlots.length)break;
            const slot=sheetSlots[idx], cx=s.ml+c*(s.lw+s.gx), cy=s.mt+r*(s.lh+s.gy);
            
            h+=`<div class="sh-slot" data-idx="${idx}" style="position:absolute;left:${cx}mm;top:${cy}mm;width:${s.lw}mm;height:${s.lh}mm;border:1px dashed ${slot?'transparent':'var(--gray-300)'};box-sizing:border-box;font-size:${fs}pt;background:${slot?'none':'#fafafa'};cursor:${slot?'default':'pointer'};overflow:hidden">`;
            if(slot){
                const {d,lo}=slot;
                const gpp=k=>{
                    const dd=dp()[k]||{x:50,y:50},ll=lo&&lo[k]?lo[k]:{};
                    return{x:ll.x??dd.x,y:ll.y??dd.y,sx:ll.sx??1,sy:ll.sy??1,fs:ll.fs||null,bold:ll.bold||false,hidden:ll.hidden||false};
                };
                const els=[];
                if(d.logoBase64)els.push({k:'logo',v:`<img src="${d.logoBase64}" style="max-height:${s.lh*0.35}mm;max-width:${s.lw*0.7}mm;object-fit:contain" draggable="false">`});
                if(d.memoImageBase64)els.push({k:'memoImg',v:`<img src="${d.memoImageBase64}" style="max-height:${s.lh*0.3}mm;max-width:${s.lw*0.7}mm;object-fit:contain" draggable="false">`});
                
                const isTableMode=lo&&lo.isTableMode;
                if(isTableMode){
                    let th=`<table class="lbl-table" style="pointer-events:none">`;
                    if(d.productName)th+=`<tr><td style="width:3em;font-weight:600">품 명</td><td style="font-weight:600">${E(d.productName)}</td></tr>`;
                    if(d.color)th+=`<tr><td style="font-weight:600">컬 러</td><td style="font-weight:600">${E(d.color)}</td></tr>`;
                    if(d.size)th+=`<tr><td style="font-weight:600">사이즈</td><td style="font-weight:600">${E(d.size)}</td></tr>`;
                    if(d.manufacturer)th+=`<tr><td style="font-weight:600">제조사</td><td style="font-weight:600">${E(d.manufacturer)}</td></tr>`;
                    if(d.origin)th+=`<tr><td style="font-weight:600">브랜드</td><td style="font-weight:600">${E(d.origin)}</td></tr>`;
                    if(d.spec)th+=`<tr><td style="font-weight:600">포장규격</td><td style="font-weight:600">${E(d.spec)}</td></tr>`;
                    if(d.price)th+=`<tr><td style="font-weight:600">가 격</td><td style="font-weight:800">${formatPrice(d.price)}<br><span style="font-size:75%;font-weight:normal">(부가세 포함)</span></td></tr>`;
                    if(d.memo)th+=`<tr><td style="font-weight:600">비 고</td><td style="font-weight:600">${E(d.memo)}</td></tr>`;
                    th+=`</table>`;
                    if(th.includes('<tr>'))els.push({k:'table',v:th});
                } else {
                    if(d.productName){els.push({k:'product_lbl',v:'품 명'});els.push({k:'product_val',v:E(d.productName)});}
                    if(d.color){els.push({k:'color_lbl',v:'컬 러'});els.push({k:'color_val',v:E(d.color)});}
                    if(d.size){els.push({k:'size_lbl',v:'사이즈'});els.push({k:'size_val',v:E(d.size)});}
                    if(d.manufacturer){els.push({k:'mfr_lbl',v:'제조사'});els.push({k:'mfr_val',v:E(d.manufacturer)});}
                    if(d.price){els.push({k:'price_lbl',v:'가 격'});els.push({k:'price_val',v:formatPrice(d.price)});}
                    const ip=[d.origin,d.spec].filter(Boolean);
                    if(ip.length){els.push({k:'info_lbl',v:'정 보'});els.push({k:'info_val',v:E(ip.join(' | '))});}
                    if(d.memo){els.push({k:'memo_lbl',v:'메 모'});els.push({k:'memo_val',v:E(d.memo)});}
                }
                
                for(const e of els){
                    const p=gpp(e.k);const psx=p.sx??1,psy=p.sy??1;
                    if(p.hidden)continue;
                    const fK=`${idx}_${e.k}`;
                    const sel=sheetSelectedKeys.has(fK)?'sh-sel':'';
                    const ko=sheetKeyObjectKey===fK?'sh-ko':'';
                    const stFS=p.fs?`font-size:${p.fs}px;`:'';
                    const stB=p.bold?`font-weight:bold;`:'';
                    const stW=p.nowrap?`white-space:nowrap;`:'';
                    const bs=`box-shadow:${sel||ko?(ko?'0 0 0 1.5px #ef4444 inset, 0 0 0 1.5px rgba(255,255,255,0.5)':'0 0 0 1.5px var(--primary-color) inset, 0 0 0 1.5px rgba(255,255,255,0.5)'):'none'}`;
                    h+=`<div class="sh-el ${sel} ${ko}" data-idx="${idx}" data-basek="${e.k}" data-key="${fK}" style="position:absolute;left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%) scale(${psx},${psy});transform-origin:center center;padding:2px;cursor:move;user-select:none;${stFS}${stB}${stW};${bs}">${e.v}</div>`;
                }
            }
            h+=`</div>`;
        }
        h+=`</div>`;
    }
    $('sheetCanvas').innerHTML=h;
    initSheetInteraction();
    updateShToolbar();
}

function saveShHistory(){ sheetHistoryStack.push(JSON.stringify(sheetSlots)); if(sheetHistoryStack.length>30)sheetHistoryStack.shift(); }
function undoSh(){ if(sheetHistoryStack.length>0){ sheetSlots=JSON.parse(sheetHistoryStack.pop()); sheetSelectedKeys.clear(); sheetKeyObjectKey=null; renderSheet(); } }

function initSheetInteraction(){
    const sc=$('sheetCanvas');
    sc.onmousedown=e=>{
        if(e.target.closest('.sh-el') || e.target.closest('.sh-slot')) return;
        e.preventDefault();
        sheetSelectedKeys.clear(); sheetKeyObjectKey=null;
        const rect=sc.getBoundingClientRect();
        const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
        const mq=document.createElement('div');
        mq.className='marquee'; mq.style.cssText=`left:${sx}px;top:${sy}px;width:0;height:0`;
        sc.appendChild(mq);
        const mv=v=>{
            const cx=v.clientX-rect.left, cy=v.clientY-rect.top;
            mq.style.left=Math.min(sx,cx)+'px'; mq.style.top=Math.min(sy,cy)+'px';
            mq.style.width=Math.abs(cx-sx)+'px'; mq.style.height=Math.abs(cy-sy)+'px';
        };
        const up=v=>{
            document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
            const mr=mq.getBoundingClientRect();
            sc.querySelectorAll('.sh-el').forEach(nd=>{
                const er=nd.getBoundingClientRect();
                if(er.left<mr.right&&er.right>mr.left&&er.top<mr.bottom&&er.bottom>mr.top) sheetSelectedKeys.add(nd.dataset.key);
            });
            mq.remove();
            renderSheet();
        };
        document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
    };

    sc.querySelectorAll('.sh-slot').forEach(sl=>{
        sl.onmousedown=e=>{
            if(e.target.closest('.sh-el')) return;
            e.preventDefault();
            const fromIdx = parseInt(sl.dataset.idx);
            let dragged = false;
            
            const ghost = sl.cloneNode(true);
            ghost.style.position = 'fixed'; ghost.style.pointerEvents = 'none'; ghost.style.opacity = '0.5'; ghost.style.zIndex = '99999';
            
            const mv=v=>{
                if(!dragged){ dragged=true; document.body.appendChild(ghost); }
                ghost.style.left = v.clientX + 5 + 'px'; ghost.style.top = v.clientY + 5 + 'px';
                
                sc.querySelectorAll('.sh-slot').forEach(t=>{ t.style.borderColor = t.dataset.idx===sl.dataset.idx?'':(sheetSlots[t.dataset.idx]?'transparent':'var(--gray-300)'); t.style.background = sheetSlots[t.dataset.idx]?'none':'#fafafa'; });
                
                const hover = document.elementFromPoint(v.clientX, v.clientY);
                const hoverSlot = hover ? hover.closest('.sh-slot') : null;
                if(hoverSlot && hoverSlot !== sl){
                    hoverSlot.style.borderColor = 'var(--primary-color)';
                    hoverSlot.style.background = 'var(--gray-200)';
                }
            };
            const up=v=>{
                document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
                if(dragged){
                    ghost.remove();
                    sc.querySelectorAll('.sh-slot').forEach(t=>{ t.style.borderColor = sheetSlots[t.dataset.idx]?'transparent':'var(--gray-300)'; t.style.background = sheetSlots[t.dataset.idx]?'none':'#fafafa'; });
                    const hover = document.elementFromPoint(v.clientX, v.clientY);
                    const hoverSlot = hover ? hover.closest('.sh-slot') : null;
                    if(hoverSlot && hoverSlot !== sl){
                        const toIdx = parseInt(hoverSlot.dataset.idx);
                        saveShHistory();
                        const temp = sheetSlots[fromIdx]; sheetSlots[fromIdx] = sheetSlots[toIdx]; sheetSlots[toIdx] = temp;
                        sheetSelectedKeys.clear(); sheetKeyObjectKey=null;
                        renderSheet();
                    }
                } else {
                    if(!sheetSlots[fromIdx]){
                        const firstLabelIdx = sheetSlots.findIndex(x=>x!==null);
                        if(firstLabelIdx !== -1 && firstLabelIdx !== fromIdx){
                            saveShHistory();
                            const diff = fromIdx - firstLabelIdx;
                            const newSlots = new Array(sheetSlots.length).fill(null);
                            for(let i=0; i<sheetSlots.length; i++){ if(sheetSlots[i] && i+diff >=0 && i+diff < newSlots.length) newSlots[i+diff] = sheetSlots[i]; }
                            sheetSlots = newSlots;
                            sheetSelectedKeys.clear(); sheetKeyObjectKey=null;
                            renderSheet();
                        }
                    } else {
                        sheetSelectedKeys.clear(); sheetKeyObjectKey=null; renderSheet();
                    }
                }
            };
            document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
        };
    });

    sc.querySelectorAll('.sh-el').forEach(n=>{
        n.onmousedown=e=>{
            e.preventDefault();e.stopPropagation();
            const fK=n.dataset.key;
            if(e.shiftKey){
                if(sheetSelectedKeys.has(fK)){
                    sheetSelectedKeys.delete(fK);
                    if(sheetKeyObjectKey===fK)sheetKeyObjectKey=null;
                } else sheetSelectedKeys.add(fK);
                renderSheet(); return;
            } else if(!sheetSelectedKeys.has(fK)){
                sheetSelectedKeys.clear(); sheetSelectedKeys.add(fK); sheetKeyObjectKey=null; renderSheet();
            } else {
                sheetKeyObjectKey=fK;
                sc.querySelectorAll('.sh-el').forEach(x=>{
                    const k = x.dataset.key;
                    x.style.boxShadow=sheetSelectedKeys.has(k)?(k===fK?'0 0 0 1.5px #ef4444 inset, 0 0 0 1.5px rgba(255,255,255,0.5)':'0 0 0 1.5px var(--primary-color) inset, 0 0 0 1.5px rgba(255,255,255,0.5)'):'none';
                });
            }
            
            const startX=e.clientX, startY=e.clientY;
            const initPos={};
            sheetSelectedKeys.forEach(sk=>{
                const [idx, ...b] = sk.split('_'); const bk = b.join('_');
                const sl=sheetSlots[idx];
                const gpp = sl.lo&&sl.lo[bk]?sl.lo[bk]:dp()[bk]||{x:50,y:50};
                initPos[sk] = {x:gpp.x??50, y:gpp.y??50};
            });
            const slNode = n.closest('.sh-slot');
            const rect = slNode.getBoundingClientRect();
            
            const mv=v=>{
                let dxPct=(v.clientX-startX)/rect.width*100;
                let dyPct=(v.clientY-startY)/rect.height*100;
                if(v.shiftKey){if(Math.abs(dxPct)>Math.abs(dyPct))dyPct=0;else dxPct=0;}
                sheetSelectedKeys.forEach(sk=>{
                    const nd=sc.querySelector(`.sh-el[data-key="${sk}"]`);
                    if(nd){ nd.style.left=Math.max(0,Math.min(100,initPos[sk].x+dxPct))+'%'; nd.style.top=Math.max(0,Math.min(100,initPos[sk].y+dyPct))+'%'; }
                });
            };
            const up=v=>{
                document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
                let dxPct=(v.clientX-startX)/rect.width*100;
                let dyPct=(v.clientY-startY)/rect.height*100;
                if(v.shiftKey){if(Math.abs(dxPct)>Math.abs(dyPct))dyPct=0;else dxPct=0;}
                if(Math.abs(dxPct)>0.1 || Math.abs(dyPct)>0.1) saveShHistory();
                sheetSelectedKeys.forEach(sk=>{
                    const [idx, ...b] = sk.split('_'); const bk = b.join('_');
                    const sl=sheetSlots[idx];
                    if(!sl.lo) sl.lo={};
                    if(!sl.lo[bk]){ const dd=dp()[bk]||{x:50,y:50}; sl.lo[bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
                    sl.lo[bk].x = Math.round(Math.max(0,Math.min(100,initPos[sk].x+dxPct))*10)/10;
                    sl.lo[bk].y = Math.round(Math.max(0,Math.min(100,initPos[sk].y+dyPct))*10)/10;
                });
                renderSheet();
            };
            document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
        };
    });
}

function updateShToolbar(){
    const tb=$('shToolbar');if(!tb)return;
    tb.style.display=sheetSelectedKeys.size>0?'flex':'none';
    if(sheetSelectedKeys.size>0){
        const fK=[...sheetSelectedKeys][0];
        const [idx, ...b] = fK.split('_'); const bk = b.join('_');
        const sl=sheetSlots[idx];
        const gpp = sl.lo&&sl.lo[bk]?sl.lo[bk]:dp()[bk]||{};
        $('inShSize').value=gpp.fs||'';
        $('btnShBold').style.background=gpp.bold?'#e2e8f0':'';
        if($('btnShWrap')) $('btnShWrap').style.background=gpp.nowrap?'#e2e8f0':'';
        const hasImg=[...sheetSelectedKeys].some(k=>k.endsWith('_logo')||k.endsWith('_memoImg'));
        $('inShScale').style.display=hasImg?'inline-block':'none';
        if(hasImg) $('inShScale').value=Math.round((gpp.sx||1)*100);
    }
}

function alignSheetElements(type){
    saveShHistory();
    const activeKeys = [...sheetSelectedKeys];
    if(!activeKeys.length)return;
    const parsed = activeKeys.map(sk=>{ const [idxStr, ...b] = sk.split('_'); return {sk, idx:parseInt(idxStr), bk:b.join('_')}; });
    
    parsed.forEach(p=>{
        const sl=sheetSlots[p.idx];
        if(!sl.lo) sl.lo={};
        if(!sl.lo[p.bk]){ const dd=dp()[p.bk]||{x:50,y:50}; sl.lo[p.bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
    });
    
    let targetX = 50, targetY = 50;
    if(sheetKeyObjectKey && sheetSelectedKeys.has(sheetKeyObjectKey)){
        const [idx, ...b] = sheetKeyObjectKey.split('_'); const bk = b.join('_');
        const sl=sheetSlots[idx]; targetX = sl.lo[bk].x; targetY = sl.lo[bk].y;
    } else {
        const xs = parsed.map(p=>sheetSlots[p.idx].lo[p.bk].x);
        const ys = parsed.map(p=>sheetSlots[p.idx].lo[p.bk].y);
        if(type==='left') targetX=Math.min(...xs); else if(type==='right') targetX=Math.max(...xs); else if(type==='center') targetX=xs.reduce((a,b)=>a+b,0)/xs.length;
        if(type==='top') targetY=Math.min(...ys); else if(type==='bottom') targetY=Math.max(...ys); else if(type==='middle') targetY=ys.reduce((a,b)=>a+b,0)/ys.length;
    }
    
    if(type==='left'||type==='center'||type==='right') parsed.forEach(p=>sheetSlots[p.idx].lo[p.bk].x=targetX);
    else if(type==='top'||type==='middle'||type==='bottom') parsed.forEach(p=>sheetSlots[p.idx].lo[p.bk].y=targetY);
    renderSheet();
}

function executePrint(){
    const s=getPS(),g=calcG(s.pw,s.ph,s.lw,s.lh,s.mt,s.mb,s.ml,s.mr,s.gx,s.gy);
    const lps=g.cols*g.rows,sheets=Math.ceil(sheetSlots.length/lps)||1;
    const fs=Math.max(6,Math.min(11,s.lw/7));
    let h='';
    const formatPrice=p=>{if(!p)return'';let n=Number(p.replace(/,/g,''));return isNaN(n)?E(p):n.toLocaleString()+'원'};
    
    for(let sh=0;sh<sheets;sh++){
        h+=`<div class="ps" style="width:${s.pw}mm;height:${s.ph}mm;position:relative;box-sizing:border-box">`;
        for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++){
            const idx=sh*lps+r*g.cols+c;
            if(idx>=sheetSlots.length)break;
            const slot=sheetSlots[idx];
            if(!slot) continue;
            
            const cx=s.ml+c*(s.lw+s.gx),cy=s.mt+r*(s.lh+s.gy);
            const {d,lo}=slot;
            const gpp=k=>{
                const dd=dp()[k]||{x:50,y:50},ll=lo&&lo[k]?lo[k]:{};
                return{x:ll.x??dd.x,y:ll.y??dd.y,sx:ll.sx??1,sy:ll.sy??1,fs:ll.fs||null,bold:ll.bold||false,hidden:ll.hidden||false};
            };
            
            h+=`<div style="position:absolute;left:${cx}mm;top:${cy}mm;width:${s.lw}mm;height:${s.lh}mm;overflow:hidden;font-size:${fs}pt">`;
            
            const cm=`width:3mm;height:3mm;position:absolute;border:0 solid #ccc;`;
            h+=`<div style="${cm}left:0;top:0;border-left-width:1px;border-top-width:1px"></div>`;
            h+=`<div style="${cm}right:0;top:0;border-right-width:1px;border-top-width:1px"></div>`;
            h+=`<div style="${cm}left:0;bottom:0;border-left-width:1px;border-bottom-width:1px"></div>`;
            h+=`<div style="${cm}right:0;bottom:0;border-right-width:1px;border-bottom-width:1px"></div>`;

            const els=[];
            if(d.logoBase64)els.push({k:'logo',v:`<img src="${d.logoBase64}" style="max-height:${s.lh*0.35}mm;max-width:${s.lw*0.7}mm;object-fit:contain">`});
            if(d.memoImageBase64)els.push({k:'memoImg',v:`<img src="${d.memoImageBase64}" style="max-height:${s.lh*0.3}mm;max-width:${s.lw*0.7}mm;object-fit:contain">`});
            
            const isTableMode=lo&&lo.isTableMode;
            if(isTableMode){
                let th=`<table class="lbl-table">`;
                if(d.productName)th+=`<tr><td style="width:3em;font-weight:600">품 명</td><td style="font-weight:600">${E(d.productName)}</td></tr>`;
                if(d.color)th+=`<tr><td style="font-weight:600">컬 러</td><td style="font-weight:600">${E(d.color)}</td></tr>`;
                if(d.size)th+=`<tr><td style="font-weight:600">사이즈</td><td style="font-weight:600">${E(d.size)}</td></tr>`;
                if(d.manufacturer)th+=`<tr><td style="font-weight:600">제조사</td><td style="font-weight:600">${E(d.manufacturer)}</td></tr>`;
                if(d.origin)th+=`<tr><td style="font-weight:600">브랜드</td><td style="font-weight:600">${E(d.origin)}</td></tr>`;
                if(d.spec)th+=`<tr><td style="font-weight:600">포장규격</td><td style="font-weight:600">${E(d.spec)}</td></tr>`;
                if(d.price)th+=`<tr><td style="font-weight:600">가 격</td><td style="font-weight:800">${formatPrice(d.price)}<br><span style="font-size:75%;font-weight:normal">(부가세 포함)</span></td></tr>`;
                if(d.memo)th+=`<tr><td style="font-weight:600">비 고</td><td style="font-weight:600">${E(d.memo)}</td></tr>`;
                th+=`</table>`;
                if(th.includes('<tr>'))els.push({k:'table',v:th});
            } else {
                if(d.productName){els.push({k:'product_lbl',v:'품 명'});els.push({k:'product_val',v:E(d.productName)});}
                if(d.color){els.push({k:'color_lbl',v:'컬 러'});els.push({k:'color_val',v:E(d.color)});}
                if(d.size){els.push({k:'size_lbl',v:'사이즈'});els.push({k:'size_val',v:E(d.size)});}
                if(d.manufacturer){els.push({k:'mfr_lbl',v:'제조사'});els.push({k:'mfr_val',v:E(d.manufacturer)});}
                if(d.price){els.push({k:'price_lbl',v:'가 격'});els.push({k:'price_val',v:formatPrice(d.price)});}
                const ip=[d.origin,d.spec].filter(Boolean);
                if(ip.length){els.push({k:'info_lbl',v:'정 보'});els.push({k:'info_val',v:E(ip.join(' | '))});}
                if(d.memo){els.push({k:'memo_lbl',v:'메 모'});els.push({k:'memo_val',v:E(d.memo)});}
            }
            
            for(const e of els){
                const p=gpp(e.k);const psx=p.sx??1,psy=p.sy??1;
                if(p.hidden)continue;
                const stFS=p.fs?`font-size:${p.fs}px;`:'';
                const stB=p.bold?`font-weight:bold;`:'';
                const stW=p.nowrap?`white-space:nowrap;`:'';
                h+=`<div style="position:absolute;left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%) scale(${psx},${psy});transform-origin:center center;${stFS}${stB}${stW}">${e.v}</div>`
            }
            h+='</div>';
        }
        h+='</div>';
    }
    const pa=$('printArea');pa.innerHTML=h;pa.style.display='block';
    setTimeout(()=>{window.print();setTimeout(()=>{pa.style.display='none'},500)},200)
}

// Init
function initMemoImg(){
    const fi=$('memoFI');
    if(!fi)return;
    $('btnUpMemoImg').onclick=()=>fi.click();
    $('btnClrMemoImg').onclick=()=>{
        $('memoImg').src='';
        $('memoImgWrapper').style.display='none';
        updPv();
    };
    fi.onchange=e=>{
        const f=e.target.files[0];
        if(!f)return;
        if(f.size>2e6){toast('2MB 이하','warning');return}
        const r=new FileReader();
        r.onload=v=>{
            $('memoImg').src=v.target.result;
            $('memoImgWrapper').style.display='';
            updPv();
        };
        r.readAsDataURL(f);
        fi.value='';
    }
}

document.addEventListener('DOMContentLoaded',async()=>{
    initTabs();initLogo();initLT();initMemoImg();
    await Promise.all([fetchL(),fetchS(),fetchLT()]);
    renderList();
    renderSpecs();
    ['fName','fProd','fColor','fSize','fMfr','fPrice','fOrigin','fSpec','fBarcode','fMemo'].forEach(id=>{if($(id))$(id).oninput=updPv;});
    $('btnSave').onclick=saveL;$('btnNew').onclick=()=>{reset();updPv()};
    $('btnRst').onclick=()=>{layout={isTableMode:$('chkTableMode').checked};selectedKeys.clear();updPv();toast('초기화','info')};
    document.querySelectorAll('.btn-align').forEach(b=>b.onclick=()=>alignElements(b.dataset.align));
    if($('pvZoom'))$('pvZoom').onchange=updPv;
    if($('chkTableMode'))$('chkTableMode').onchange=updPv;
    
    // Sheet Editor Toolbar
    $('btnShCancel').onclick = () => $('sheetEditor').style.display='none';
    $('btnShPrint').onclick = executePrint;
    $('btnShUndo').onclick = undoSh;
    $('btnShDel').onclick = () => {
        if(!sheetSelectedKeys.size) return;
        saveShHistory();
        sheetSelectedKeys.forEach(sk=>{
            const [idx, ...b] = sk.split('_'); const bk = b.join('_');
            const sl = sheetSlots[idx];
            if(!sl.lo) sl.lo={};
            if(!sl.lo[bk]){ const dd=dp()[bk]||{x:50,y:50}; sl.lo[bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
            sl.lo[bk].hidden = true;
        });
        sheetSelectedKeys.clear(); sheetKeyObjectKey=null;
        renderSheet();
    };
    $('btnShBold').onclick = () => {
        saveShHistory();
        sheetSelectedKeys.forEach(sk=>{
            const [idx, ...b] = sk.split('_'); const bk = b.join('_');
            const sl = sheetSlots[idx];
            if(!sl.lo) sl.lo={};
            if(!sl.lo[bk]){ const dd=dp()[bk]||{x:50,y:50}; sl.lo[bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
            sl.lo[bk].bold = !sl.lo[bk].bold;
        });
        renderSheet();
    };
    $('btnShWrap').onclick = () => {
        saveShHistory();
        sheetSelectedKeys.forEach(sk=>{
            const [idx, ...b] = sk.split('_'); const bk = b.join('_');
            const sl = sheetSlots[idx];
            if(!sl.lo) sl.lo={};
            if(!sl.lo[bk]){ const dd=dp()[bk]||{x:50,y:50}; sl.lo[bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
            sl.lo[bk].nowrap = !sl.lo[bk].nowrap;
        });
        renderSheet();
    };
    $('inShSize').onchange = (e) => {
        saveShHistory();
        const val = parseInt(e.target.value) || null;
        sheetSelectedKeys.forEach(sk=>{
            const [idx, ...b] = sk.split('_'); const bk = b.join('_');
            const sl = sheetSlots[idx];
            if(!sl.lo) sl.lo={};
            if(!sl.lo[bk]){ const dd=dp()[bk]||{x:50,y:50}; sl.lo[bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
            sl.lo[bk].fs = val;
        });
        renderSheet();
    };
    $('inShScale').onchange = (e) => {
        saveShHistory();
        const val = parseInt(e.target.value) || null;
        if(val){
            sheetSelectedKeys.forEach(sk=>{
                const [idx, ...b] = sk.split('_'); const bk = b.join('_');
                if(bk==='logo'||bk==='memoImg'){
                    const sl = sheetSlots[idx];
                    if(!sl.lo) sl.lo={};
                    if(!sl.lo[bk]){ const dd=dp()[bk]||{x:50,y:50}; sl.lo[bk]={x:dd.x,y:dd.y,sx:1,sy:1}; }
                    sl.lo[bk].sx = val/100; sl.lo[bk].sy = val/100;
                }
            });
            renderSheet();
        }
    };
    document.querySelectorAll('#shToolbar .btn-align[data-align]').forEach(b=>b.onclick=()=>alignSheetElements(b.dataset.align));
    
    // Toolbar events
    if($('btnTBold')) $('btnTBold').onclick=()=>{
        saveHistory();
        selectedKeys.forEach(k=>{
            if(!layout[k]) layout[k] = {...gp(k)};
            layout[k].bold = !layout[k].bold;
        });
        updPv();
    };
    if($('btnTWrap')) $('btnTWrap').onclick=()=>{
        saveHistory();
        selectedKeys.forEach(k=>{
            if(!layout[k]) layout[k] = {...gp(k)};
            layout[k].nowrap = !layout[k].nowrap;
        });
        updPv();
    };
    if($('inTSize')) $('inTSize').onchange=(e)=>{
        saveHistory();
        const val = parseInt(e.target.value) || null;
        selectedKeys.forEach(k=>{
            if(!layout[k]) layout[k] = {...gp(k)};
            layout[k].fs = val;
        });
        updPv();
    };
    if($('inTScale')) $('inTScale').onchange=(e)=>{
        saveHistory();
        const val = parseInt(e.target.value) || null;
        if(val) {
            selectedKeys.forEach(k=>{
                if(k==='logo'||k==='memoImg'){
                    if(!layout[k]) layout[k] = {...gp(k)};
                    layout[k].sx = val / 100;
                    layout[k].sy = val / 100;
                }
            });
            updPv();
        }
    };
    if($('btnUndo')) $('btnUndo').onclick=undo;
    if($('btnTDel')) $('btnTDel').onclick=deleteSelected;
    
    document.addEventListener('keydown', e=>{
        const isSheet = $('sheetEditor').style.display === 'flex';
        if(e.ctrlKey && e.key.toLowerCase()==='z'){
            e.preventDefault();
            if(isSheet) undoSh(); else undo();
        }
        if((e.key==='Delete' || e.key==='Backspace') && (isSheet ? sheetSelectedKeys.size>0 : selectedKeys.size>0)){
            if(e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;
            e.preventDefault();
            if(isSheet) $('btnShDel').click(); else deleteSelected();
        }
    });
    $('selPaper').onchange=$('inLW').oninput=$('inLH').oninput=updCalc;
    $('selSpec').onchange=()=>{const s=specs.find(x=>x.id===$('selSpec').value);if(s){$('inLW').value=s.labelWidth||63.5;$('inLH').value=s.labelHeight||38.1}updCalc()};
    $('btnPrint').onclick=openSheetEditor;
    $('btnAddSp').onclick=()=>openSM(null);
    $('mSpX').onclick=$('mSpCancel').onclick=()=>$('mSpec').style.display='none';
    $('mSpSave').onclick=saveSp;
    $('mSpec').onclick=e=>{if(e.target===$('mSpec'))$('mSpec').style.display='none'};
    updPv();updCalc()
})
})();
