    // ════════════════════════════════════════
    // CONSTANTS
    // ════════════════════════════════════════
    const TOAST_DURATION = 3500;
    const DEBOUNCE_SEARCH = 300;
    const DEBOUNCE_RENDER = 150;
    const CODE_SYNC_DELAY = 400;
    const AUTO_RESUME_DELAY = 3000;
    const COPY_FEEDBACK_DELAY = 2000;
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút — sau đó fetch fresh
    const DEFAULT_PER_PAGE = 100;        // giảm từ 500 → 100

    // ════════════════════════════════════════
    // UTILITIES
    // ════════════════════════════════════════

    // Debounce — tránh gọi liên tục khi user gõ nhanh
    function debounce(fn, ms) {
      let timer;
      return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    }

    // XSS-safe escape — LUÔN dùng khi nhúng data người dùng vào HTML
    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // DRY helper — reload contacts từ API với filter hiện tại
    function refreshContacts() {
      const search = document.querySelector('.tbl-search')?.value || '';
      if (window._backendConnected) loadContactsPage(search);
      else renderContactTable(search);
    }

    // Level lookup map — O(1) thay vì O(n) scan mỗi lần
    let _levelMap = new Map();
    function rebuildLevelMap() { _levelMap = new Map(levels.map(l => [l.id, l])); }
    function getLevelById(id) { return _levelMap.get(id) || null; }

    // ════════════════════════════════════════
    // DATA STORE