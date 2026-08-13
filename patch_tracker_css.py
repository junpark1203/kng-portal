import sys

with open('05_Management/project_tracker/style.css', 'a', encoding='utf-8') as f:
    f.write('''

/* ==========================================================================
   Print Styles
   ========================================================================== */
@media print {
    body * {
        visibility: hidden;
    }
    
    #printContainer, #printContainer * {
        visibility: visible;
    }
    
    #printContainer {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        background: #fff;
    }

    .print-report {
        font-family: 'Pretendard', sans-serif;
        color: #000;
        padding: 0;
        line-height: 1.4;
    }

    .print-header {
        margin-bottom: 20px;
        border-bottom: 2px solid #000;
        padding-bottom: 15px;
    }

    .print-title {
        font-size: 24px;
        font-weight: 700;
        margin: 0 0 15px 0;
        text-align: center;
    }

    .print-info-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 25px;
        font-size: 13px;
    }

    .print-info-table th,
    .print-info-table td {
        border: 1px solid #ccc;
        padding: 8px 10px;
        text-align: left;
    }

    .print-info-table th {
        background-color: #f1f5f9;
        font-weight: 600;
        width: 15%;
    }

    .print-info-table td {
        width: 35%;
    }

    .print-log-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
    }

    .print-log-table th,
    .print-log-table td {
        border: 1px solid #ccc;
        padding: 10px;
        vertical-align: top;
    }

    .print-log-table th {
        background-color: #f1f5f9;
        font-weight: 600;
        text-align: center;
    }
    
    .print-log-table .col-date { width: 12%; text-align: center; }
    .print-log-table .col-type { width: 10%; text-align: center; }
    .print-log-table .col-manager { width: 10%; text-align: center; }
    .print-log-table .col-content { width: 68%; }

    /* Page break handling */
    .print-log-table tr {
        page-break-inside: avoid;
    }

    /* Type Badges for Print */
    .type-badge {
        display: inline-block;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        border: 1px solid #ccc;
    }
    .type-badge.info { background: #e0f2fe; color: #0284c7; border-color: #bae6fd; }
    .type-badge.warning { background: #fef08a; color: #a16207; border-color: #fde047; }
    .type-badge.success { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
}
''')

print('SUCCESS')
