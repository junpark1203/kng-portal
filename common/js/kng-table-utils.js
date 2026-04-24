/* =========================================================================
   K&G 공통 테이블 유틸리티 (kng-table-utils.js)
   - showToast: 토스트 알림
   - getPageNumbers: 페이지 번호 배열 생성
   - renderPagination: 페이지네이션 UI 렌더링
   - updateSortUI: 정렬 표시 업데이트
   - applySorting: 범용 정렬 엔진
   ========================================================================= */

/**
 * 토스트 알림을 표시합니다.
 * @param {string} msg - 메시지 내용
 * @param {'info'|'success'|'error'|'warning'} type - 알림 타입
 * @param {HTMLElement} [container] - 토스트 컨테이너 (기본: #toastContainer)
 */
function showToast(msg, type = 'info', container = null) {
    const toastContainer = container || document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'bx-info-circle';
    if (type === 'success') icon = 'bx-check-circle';
    if (type === 'error') icon = 'bx-error-circle';
    if (type === 'warning') icon = 'bx-error';

    toast.innerHTML = `<i class='bx ${icon}'></i> <span>${msg}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * 페이지 번호 배열을 생성합니다.
 * @param {number} current - 현재 페이지
 * @param {number} total - 전체 페이지 수
 * @param {number} [maxVisible=5] - 표시할 최대 페이지 수
 * @returns {Array<number|string>} - 페이지 번호 배열 ('...' 포함)
 */
function getPageNumbers(current, total, maxVisible = 5) {
    const pages = [];
    let start = Math.max(1, current - Math.floor(maxVisible / 2));
    let end = start + maxVisible - 1;
    if (end > total) { end = total; start = Math.max(1, end - maxVisible + 1); }
    if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total) { if (end < total - 1) pages.push('...'); pages.push(total); }
    return pages;
}

/**
 * 페이지네이션 UI를 렌더링합니다.
 * @param {Object} opts - 페이지네이션 옵션
 * @param {HTMLElement|string} opts.container - 페이지네이션 DOM 요소 또는 ID
 * @param {number} opts.totalFiltered - 필터링된 전체 건수
 * @param {number} opts.totalAll - 전체 데이터 건수
 * @param {number} opts.totalPages - 전체 페이지 수
 * @param {number} opts.currentPage - 현재 페이지
 * @param {number} opts.pageSize - 페이지당 건수 (0 = 전체)
 * @param {number} opts.startIdx - 현재 페이지 시작 인덱스
 * @param {number} opts.endIdx - 현재 페이지 끝 인덱스
 * @param {Function} opts.onPageChange - 페이지 변경 콜백: (page) => void
 * @param {Function} opts.onPageSizeChange - 페이지 크기 변경 콜백: (size) => void
 * @param {Array<{value:number, label:string}>} [opts.pageSizeOptions] - 페이지 크기 옵션 목록
 */
function renderPagination(opts) {
    const container = typeof opts.container === 'string'
        ? document.getElementById(opts.container)
        : opts.container;
    if (!container) return;
    if (opts.totalFiltered === 0) { container.innerHTML = ''; return; }

    const pageSizeOptions = opts.pageSizeOptions || [
        { value: 50, label: '50개' },
        { value: 100, label: '100개' },
        { value: 150, label: '150개' },
        { value: 200, label: '200개' },
        { value: 0, label: '전체' }
    ];

    let html = '<div class="pagination-bar">';
    html += '<div class="pagination-info">';
    html += '<div class="page-size-wrap">';
    html += '<label>페이지당</label>';
    html += '<select class="page-size-select kng-page-size-select">';
    pageSizeOptions.forEach(s => {
        html += `<option value="${s.value}"${s.value === opts.pageSize ? ' selected' : ''}>${s.label}</option>`;
    });
    html += '</select></div>';
    html += `<span class="pagination-summary">총 <strong>${opts.totalFiltered}</strong>건`;
    if (opts.totalFiltered !== opts.totalAll) {
        html += ` <span class="filtered-note">(검색결과, 전체 ${opts.totalAll}건)</span>`;
    }
    if (opts.pageSize !== 0 && opts.totalFiltered > 0) {
        html += `  |  <strong>${opts.startIdx + 1}</strong> – <strong>${opts.endIdx}</strong>번째`;
    }
    html += '</span></div>';

    if (opts.totalPages > 1) {
        html += '<div class="pagination-controls">';
        html += `<button class="page-btn" data-page="1"${opts.currentPage === 1 ? ' disabled' : ''} title="처음"><i class='bx bx-chevrons-left'></i></button>`;
        html += `<button class="page-btn" data-page="${opts.currentPage - 1}"${opts.currentPage === 1 ? ' disabled' : ''} title="이전"><i class='bx bx-chevron-left'></i></button>`;
        getPageNumbers(opts.currentPage, opts.totalPages).forEach(pg => {
            if (pg === '...') {
                html += '<span class="page-ellipsis">…</span>';
            } else {
                html += `<button class="page-btn${pg === opts.currentPage ? ' active' : ''}" data-page="${pg}">${pg}</button>`;
            }
        });
        html += `<button class="page-btn" data-page="${opts.currentPage + 1}"${opts.currentPage === opts.totalPages ? ' disabled' : ''} title="다음"><i class='bx bx-chevron-right'></i></button>`;
        html += `<button class="page-btn" data-page="${opts.totalPages}"${opts.currentPage === opts.totalPages ? ' disabled' : ''} title="끝"><i class='bx bx-chevrons-right'></i></button>`;
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind events (using event delegation to avoid duplicate listeners)
    const sizeSelect = container.querySelector('.kng-page-size-select');
    if (sizeSelect && opts.onPageSizeChange) {
        sizeSelect.addEventListener('change', function () {
            opts.onPageSizeChange(parseInt(this.value, 10));
        });
    }

    container.querySelectorAll('.page-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', function () {
            if (this.disabled) return;
            const page = parseInt(this.dataset.page, 10);
            if (opts.onPageChange) opts.onPageChange(page);
        });
    });
}

/**
 * 테이블 헤더의 정렬 상태 UI를 업데이트합니다.
 * @param {string} column - 현재 정렬 컬럼
 * @param {boolean} asc - 오름차순 여부
 * @param {HTMLElement|Document} [scope=document] - 검색 범위
 */
function updateSortUI(column, asc, scope = document) {
    scope.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('data-sort') === column) {
            th.classList.add(asc ? 'sort-asc' : 'sort-desc');
        }
    });
}

/**
 * 범용 정렬 함수. 배열을 in-place로 정렬합니다.
 * @param {Array} data - 정렬할 배열
 * @param {string} column - 정렬 기준 컬럼
 * @param {boolean} asc - 오름차순 여부
 * @param {string[]} [numericFields=[]] - 숫자로 비교할 필드명 목록
 * @param {string[]} [commaNumericFields=[]] - 콤마 포함 숫자 필드명 (예: "55,000")
 * @returns {Array} 정렬된 동일 배열
 */
function applySorting(data, column, asc, numericFields = [], commaNumericFields = []) {
    return data.sort((a, b) => {
        let valA = a[column] || '';
        let valB = b[column] || '';

        if (numericFields.includes(column)) {
            valA = Number(valA);
            valB = Number(valB);
        } else if (commaNumericFields.includes(column)) {
            valA = parseInt(String(valA).replace(/,/g, '')) || 0;
            valB = parseInt(String(valB).replace(/,/g, '')) || 0;
        }

        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
    });
}

/**
 * 페이지네이션 계산 유틸리티
 * @param {number} totalItems - 전체 아이템 수
 * @param {number} currentPage - 현재 페이지
 * @param {number} pageSize - 페이지 크기 (0 = 전체)
 * @returns {{effectivePageSize: number, totalPages: number, page: number, startIdx: number, endIdx: number}}
 */
function calcPagination(totalItems, currentPage, pageSize) {
    const effectivePageSize = (pageSize === 0) ? totalItems : pageSize;
    const totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(totalItems / effectivePageSize)) : 1;
    let page = currentPage;
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    const startIdx = (page - 1) * effectivePageSize;
    const endIdx = (pageSize === 0) ? totalItems : Math.min(startIdx + effectivePageSize, totalItems);
    return { effectivePageSize, totalPages, page, startIdx, endIdx };
}

// ==========================================
// Fuzzy Search Utilities
// ==========================================

/**
 * 한글 초성 매핑 테이블
 */
const CHOSUNG_LIST = [
    'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ',
    'ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'
];

/**
 * 한글 문자를 초성으로 변환합니다.
 * @param {string} str - 입력 문자열
 * @returns {string} 초성 문자열
 */
function getChosung(str) {
    return [...str].map(ch => {
        const code = ch.charCodeAt(0) - 0xAC00;
        if (code < 0 || code > 11171) return ch;
        return CHOSUNG_LIST[Math.floor(code / 588)];
    }).join('');
}

/**
 * 검색어가 모두 초성인지 판별합니다.
 * @param {string} query - 검색어
 * @returns {boolean}
 */
function isChosungOnly(query) {
    return [...query].every(ch => CHOSUNG_LIST.includes(ch));
}

/**
 * 퍼지 검색: 공백/대소문자/특수문자 정규화 + 초성 검색
 * @param {string} target - 대상 문자열
 * @param {string} query - 검색어 (정규화 전)
 * @returns {boolean} 매칭 여부
 */
function fuzzyMatch(target, query) {
    if (!target || !query) return false;

    // 정규화: 소문자 + 공백/특수문자 제거
    const normalize = s => s.toLowerCase().replace(/[\s\-_\/\\.,()]/g, '');
    const nTarget = normalize(target);
    const nQuery = normalize(query);

    // 기본 포함 검색
    if (nTarget.includes(nQuery)) return true;

    // 초성 검색 (ㅇㅈㅇㅎ → 양지유화)
    if (isChosungOnly(nQuery)) {
        const targetChosung = getChosung(target);
        if (targetChosung.includes(nQuery)) return true;
    }

    return false;
}

/**
 * 디바운스 함수
 * @param {Function} fn - 실행할 함수
 * @param {number} delay - 지연시간 (ms)
 * @returns {Function}
 */
function debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * 활성 필터 칩을 렌더링합니다.
 * @param {Object} opts - 옵션
 * @param {HTMLElement|string} opts.container - 칩을 렌더할 DOM 요소 또는 ID
 * @param {Array<{key:string, label:string, value:string}>} opts.filters - 활성 필터 목록
 * @param {Function} opts.onRemove - 개별 필터 제거 콜백: (key) => void
 * @param {Function} opts.onClearAll - 전체 해제 콜백: () => void
 */
function renderActiveFilters(opts) {
    const container = typeof opts.container === 'string'
        ? document.getElementById(opts.container)
        : opts.container;
    if (!container) return;

    const filters = opts.filters.filter(f => f.value);
    if (filters.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    let html = '';
    filters.forEach(f => {
        html += `<span class="active-filter-chip">
            <span class="afc-label">${f.label}:</span>
            <span class="afc-value">${f.value}</span>
            <button class="afc-remove" data-key="${f.key}" title="필터 해제">✕</button>
        </span>`;
    });
    html += `<button class="afc-clear-all">전체 해제</button>`;
    container.innerHTML = html;

    container.querySelectorAll('.afc-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            if (opts.onRemove) opts.onRemove(btn.dataset.key);
        });
    });
    container.querySelector('.afc-clear-all')?.addEventListener('click', () => {
        if (opts.onClearAll) opts.onClearAll();
    });
}

