
import re

with open("02_Sales_Managment/10_Import_Settlement/import-settlement.css", "r", encoding="utf-8") as f:
    content = f.read()

# Find the start of "/* Print Layout CSS will be replaced */"
start_idx = content.find("/* Print Layout CSS will be replaced */")
if start_idx != -1:
    content = content[:start_idx]

new_css = """/* Print Layout CSS */
@media print {
    @page {
        size: A4 portrait;
        margin: 15mm 15mm;
    }
    
    body {
        background: #fff !important;
        color: #000 !important;
        font-family: "Pretendard", "Malgun Gothic", sans-serif !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
    }
    
    /* Reset Wrappers */
    .main-wrapper, .page-wrapper, .page-body, .is-container, main {
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        box-shadow: none !important;
        border: none !important;
        background: #fff !important;
    }
    
    .editor-body {
        box-shadow: none !important;
        padding: 0 !important;
        border: none !important;
        background: transparent !important;
        width: 100% !important;
    }

    /* Override ALL inline backgrounds using !important on elements that have them */
    .panel-row, table tr, table td, table th, .dash-card, .cost-item-card, .readonly-quote-info {
        background: transparent !important;
        color: #000 !important;
    }
    .panel-row {
        border-bottom: 1px solid #e2e8f0 !important;
        margin: 0 !important;
        padding: 4px 0 !important;
    }
    .panel-row .p-label { color: #475569 !important; font-weight: normal !important; }
    .panel-row .p-value { color: #000 !important; font-weight: bold !important; }

    /* Hide Unnecessary UI */
    .panel-header, .bottom-actions, .help-text, .tooltip-icon, .btn-add-in-group, .btn-delete-item, .drag-handle, .is-sidebar, .toast-container, .modal, .header-actions {
        display: none !important;
    }

    /* Print Header (Fake a formal document title) */
    #editTitle {
        text-align: center !important;
        font-size: 24px !important;
        font-weight: 700 !important;
        border-bottom: 2px solid #000 !important;
        padding-bottom: 10px !important;
        margin-bottom: 20px !important;
        color: #000 !important;
    }
    #editTitle i { display: none !important; } /* Hide icon */

    /* Typography & Headers */
    h3 {
        font-size: 16px !important;
        margin-top: 15px !important;
        margin-bottom: 8px !important;
        color: #000 !important;
        border-bottom: 1px solid #000 !important;
        padding-bottom: 4px !important;
        page-break-after: avoid;
    }
    h4 {
        color: #333 !important;
    }

    /* Flatten Inputs */
    .calc-input, input, select, textarea {
        border: none !important;
        background: transparent !important;
        appearance: none;
        -webkit-appearance: none;
        padding: 0 !important;
        margin: 0 !important;
        color: #000 !important;
        font-family: inherit !important;
        pointer-events: none;
        font-size: 11px !important;
        box-shadow: none !important;
        resize: none !important;
    }
    select::-ms-expand { display: none; }
    
    /* Layout specific */
    .sticky-dashboard {
        position: static !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 0 20px 0 !important;
        border: none !important;
        width: 100% !important;
    }

    /* Dashboard Cards - Formal Style */
    .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr) !important;
        gap: 0 !important;
        width: 100% !important;
        border: 2px solid #000 !important;
        border-right: none !important;
    }
    .dash-card {
        border: none !important;
        border-right: 2px solid #000 !important;
        box-shadow: none !important;
        break-inside: avoid;
        padding: 10px !important;
        background: #fff !important;
        text-align: center;
        border-radius: 0 !important;
    }
    .dash-card .dash-label { font-size: 11px !important; color: #333 !important; margin-bottom: 6px !important; font-weight: bold !important; }
    .dash-card .dash-value { font-size: 16px !important; font-weight: 800 !important; color: #000 !important; }
    .dash-card .dash-sub, .dash-card .dash-pct { font-size: 9px !important; color: #666 !important; margin-top: 4px !important; }
    
    /* Cost Groups & Cards */
    .cost-group {
        break-inside: avoid;
        border: none !important;
        margin-bottom: 15px !important;
        box-shadow: none !important;
        padding: 0 !important;
    }
    .cost-item-card {
        break-inside: avoid;
        border: 1px solid #ccc !important;
        padding: 8px !important;
        background: #fff !important;
        margin-bottom: 8px !important;
        border-radius: 0 !important;
    }
    .edit-section {
        break-inside: auto;
        margin-bottom: 20px !important;
    }

    /* Tables styling */
    table {
        width: 100% !important;
        border-collapse: collapse !important;
        table-layout: auto !important;
        border-top: 2px solid #000 !important;
        border-bottom: 2px solid #000 !important;
        margin-bottom: 10px !important;
    }
    table th, table td {
        border: 1px solid #ccc !important;
        padding: 6px 4px !important;
        white-space: normal !important;
        word-break: keep-all !important;
        font-size: 10px !important;
        color: #000 !important;
    }
    table th {
        background-color: #f5f5f5 !important;
        font-weight: 700 !important;
        text-align: center !important;
    }

    /* Highlight Columns in Table */
    .highlight-col { background: transparent !important; font-weight: 700 !important; }
    
    /* Print modes specific hiding */
    body.print-mode-summary .print-hide-summary { display: none !important; }
    body.print-mode-detailed .print-hide-detailed { display: none !important; }
    
    body.print-hide-info #basicInfoSection { display: none !important; }
    body.print-hide-dash #stickyDashboard { display: none !important; }
    body.print-hide-ancillary #ancillarySection { display: none !important; }
    body.print-hide-summary #summaryTableSection { display: none !important; }
    body.print-hide-items #costResultSection { display: none !important; }

    /* Fix potential overflow */
    * {
        max-width: 100% !important;
    }
}
"""

with open("02_Sales_Managment/10_Import_Settlement/import-settlement.css", "w", encoding="utf-8") as f:
    f.write(content + "\n" + new_css)

