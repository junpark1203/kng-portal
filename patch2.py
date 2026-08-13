import sys

with open('02_Sales_Managment/10_Import_Settlement/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('<div class="modal-header">', '<div class="modal-header" style="flex-shrink: 0 !important;">')
text = text.replace('<div class="modal-footer" style="padding: 15px 20px; text-align: right; border-top: 1px solid var(--border-color); background: #f9fafb; border-radius: 0 0 10px 10px;">', '<div class="modal-footer" style="padding: 15px 20px; text-align: right; border-top: 1px solid var(--border-color); background: #f9fafb; border-radius: 0 0 10px 10px; flex-shrink: 0 !important;">')

with open('02_Sales_Managment/10_Import_Settlement/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('SUCCESS')
