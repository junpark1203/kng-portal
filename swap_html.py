import sys
import re

path = 'c:/DEV/KNG WEBPAGE_20260505/02_Sales_Managment/10_Import_Settlement/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Swap the main sections in index.html
# Find <!-- SECTION 3: 항목별 비용 정산 (카드형 아코디언) --> up to <!-- SECTION 4: 비용 요약 -->
idx3 = content.find('                <!-- SECTION 3: 항목별 비용 정산 (카드형 아코디언) -->')
idx4 = content.find('                <!-- SECTION 4: 비용 요약 -->')
idx5 = content.find('                <!-- SECTION 5: 품목별 실수입원가 산출 -->')

if idx3 != -1 and idx4 != -1 and idx5 != -1:
    block3 = content[idx3:idx4]
    block4 = content[idx4:idx5]
    
    # Change the heading numbers inside block3 and block4
    block3 = block3.replace('<h3>3. 항목별 비용 정산 및 분석</h3>', '<h3>4. 항목별 비용 정산 및 분석</h3>')
    block4 = block4.replace('<h3>4. 비용 요약</h3>', '<h3>3. 비용 요약</h3>')
    
    new_content = content[:idx3] + block4 + block3 + content[idx5:]
    
    # Swap the modal labels (chkPrint_Ancillary and chkPrint_Summary)
    # The modal section 4 is Ancillary, 5 is Summary. We swap their html block as well.
    m_idx4 = new_content.find('                        <!-- 4. 항목별 비용 정산 및 분석 -->')
    m_idx5 = new_content.find('                        <!-- 5. 비용 요약 -->')
    m_idx6 = new_content.find('                        <!-- 6. 품목별 실수입원가 산출 -->')
    
    if m_idx4 != -1 and m_idx5 != -1 and m_idx6 != -1:
        m_block4 = new_content[m_idx4:m_idx5]
        m_block5 = new_content[m_idx5:m_idx6]
        new_content = new_content[:m_idx4] + m_block5 + m_block4 + new_content[m_idx6:]
        
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully swapped index.html sections")
else:
    print("Could not find the sections in index.html")
