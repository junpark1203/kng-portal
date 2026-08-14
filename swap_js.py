import sys
path = 'c:/DEV/KNG WEBPAGE_20260505/02_Sales_Managment/10_Import_Settlement/import-settlement.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

idx4 = content.find('    // 4. Ancillary (Cost Details)')
idx5 = content.find('    // 5. Summary')
idx6 = content.find('    // 6. Items (Cost allocation)')

if idx4 != -1 and idx5 != -1 and idx6 != -1:
    block4 = content[idx4:idx5]
    block5 = content[idx5:idx6]
    
    # We want block5 to appear before block4.
    new_content = content[:idx4] + block5 + block4 + content[idx6:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully swapped print logic in import-settlement.js")
else:
    print("Could not find the blocks")
