import sys

with open('05_Management/project_tracker/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

target = '''                        <button id="btnEditProject" class="btn-icon" title="프로젝트 수정"><i class='bx bx-edit-alt'></i></button>'''
replacement = '''                        <button id="btnEditProject" class="btn-icon" title="프로젝트 수정"><i class='bx bx-edit-alt'></i></button>
                        <button id="btnPrintProject" class="btn-icon" title="로그 인쇄"><i class='bx bx-printer'></i></button>'''
text = text.replace(target, replacement)

end_target = '</body>'
end_replacement = '    <div id="printContainer" class="is-container"></div>\n</body>'
text = text.replace(end_target, end_replacement)

with open('05_Management/project_tracker/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('SUCCESS')
