import sys

with open('02_Sales_Managment/10_Import_Settlement/import-settlement.js', 'r', encoding='utf-8') as f:
    text = f.read()

with open('executePrint_replacement.js', 'r', encoding='utf-8') as f:
    execute_print_code = f.read()

with open('generatePrintTemplate_replacement.js', 'r', encoding='utf-8') as f:
    generate_template_code = f.read()

with open('eventListeners_replacement.js', 'r', encoding='utf-8') as f:
    event_listeners_code = f.read()

start = text.find('function executePrint() {')
if start != -1:
    text = text[:start] + execute_print_code + '\n\n' + generate_template_code + '\n'

insert_point = text.find("document.getElementById('btnExecutePrint').addEventListener('click', executePrint);")
if insert_point != -1:
    insert_point += len("document.getElementById('btnExecutePrint').addEventListener('click', executePrint);")
    text = text[:insert_point] + '\n' + event_listeners_code + text[insert_point:]

with open('02_Sales_Managment/10_Import_Settlement/import-settlement.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('SUCCESS')
