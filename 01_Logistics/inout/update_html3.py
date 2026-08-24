# -*- coding: utf-8 -*-
import sys

content = ""
try:
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()
except:
    try:
        with open('index.html', 'r', encoding='utf-8-sig') as f:
            content = f.read()
    except:
        with open('index.html', 'r', encoding='cp949') as f:
            content = f.read()

import re
old_buttons_regex = r'<div class="btn-group shadow-sm">.*?</div>'
new_buttons = '''            <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> 엑셀등록
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> 직출고 등록
            </button>'''

content = re.sub(old_buttons_regex, new_buttons, content, flags=re.DOTALL)

insert_idx = content.find('<!-- 직출고 엑셀 업로드 모달 -->')
if insert_idx != -1 and 'excelMenuModal' not in content:
    new_modal = '''<!-- 엑셀 등록 메뉴 모달 -->
<div class="modal fade" id="excelMenuModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold"><i class='bx bx-table'></i> 엑셀 일괄 등록</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body text-center py-4">
                <button class="btn btn-warning w-100 py-3 fw-bold fs-6 shadow-sm" onclick="app.closeExcelMenuAndOpenDirect()">
                    <i class='bx bx-shuffle'></i> 직출고 일괄등록
                </button>
                <div class="mt-4 text-muted small text-start">
                    <i class='bx bx-info-circle'></i> 입고 및 출고 일괄등록은 추후 지원 예정입니다.
                </div>
            </div>
        </div>
    </div>
</div>

'''
    content = content[:insert_idx] + new_modal + content[insert_idx:]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
