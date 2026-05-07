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
    // ════════════════════════════════════════
    // Khởi tạo rỗng — dữ liệu thật load từ Supabase sau
    let levels = [];
    let contacts = [];
    let templates = [];
    let allTags = []; // [{tag, color, count}] hoặc [{id, name, color, count}]
    let allSegments = []; // [{id, name, color, rules, logic, tag_mode}]

    let activeTemplate = null;
    let selectedLevels = {};
    let currentFilter = 'all';
    let currentPage = 0;
    let perPage = DEFAULT_PER_PAGE;
    let totalContacts = 0;
    let editorMode = 'split';
    let selectedColor = '#f5c842';
    let selectedColorQuick = '#f5c842';
    let _workflowInited = false;
    // Tag & Segment state
    let selectedTags = []; // tags đang filter
    let tagFilterMode = 'or'; // 'and' | 'or' cho tags
    let segmentLogic = 'and'; // 'and' | 'or' giữa level và tags
    // Segment form state
    let _sfLogic = 'and', _sfTagMode = 'or', _sfColor = '#60a5fa', _tfColor = '#a78bfa';
    let _sfLevelRules = [], _sfTagRules = [];

    // Batch render — gộp nhiều render calls vào 1 animation frame
    let _refreshPending = false;
    function refreshUI() {
      renderSidebar(); renderDashStats(); renderFilterChips();
    }
    function scheduleRefresh() {
      if (_refreshPending) return;
      _refreshPending = true;
      requestAnimationFrame(() => { refreshUI(); _refreshPending = false; });
    }

    // ════════════════════════════════════════
    // NAVIGATION
    // ════════════════════════════════════════
    function gotoPage(id, tabEl, sbEl) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sb-item').forEach(s => s.classList.remove('active'));
      const pg = document.getElementById('page-' + id);
      if (pg) pg.classList.add('active');
      if (tabEl) tabEl.classList.add('active');
      if (sbEl) sbEl.classList.add('active');
      // Hide main sidebar on workflows page
      const mainSidebar = document.querySelector('.sidebar');
      const mainEl = document.querySelector('.main');
      if (id === 'workflows') {
        mainSidebar.classList.add('wf-hidden');
      } else {
        mainSidebar.classList.remove('wf-hidden');
      }
      mainEl.scrollTop = 0;
      if (id === 'levels') renderLevelPage();
      if (id === 'tags') renderTagPage();
      if (id === 'segments') renderSegmentPage();
      if (id === 'campaign') renderCampaignTargets();
      if (id === 'templates') { renderTemplates(); setTimeout(() => setEditorMode('visual'), 100); }
      if (id === 'contacts') refreshContacts(); // dùng refreshContacts để load đúng filter từ API
      if (id === 'database') gotoDbPanel('setup');
      if (id === 'history' && window._backendConnected) refreshTracking();
      if (id === 'workflows' && !_workflowInited) { initWorkflows(); _workflowInited = true; }
    }

    // ════════════════════════════════════════
    // TOAST
    // ════════════════════════════════════════
    function toast(msg, type = 'ok') {
      const icons = { ok: '✅', err: '❌', warn: '⚠️' };
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
      document.getElementById('toast-area').appendChild(t);
      setTimeout(() => t.remove(), TOAST_DURATION);
    }

    // ════════════════════════════════════════
    // ════════════════════════════════════════
    // LEVEL HELPERS
    // ════════════════════════════════════════
    // getLevelById → dùng _levelMap.get() ở trên (O(1))
    function getRootLevels() { return levels.filter(l => !l.parent); }
    function getChildren(pid) { return levels.filter(l => l.parent === pid); }
    function getLevelColor(id) { const l = getLevelById(id); return l ? l.color : '#888'; }
    function hexToRgba(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

    // ════════════════════════════════════════
    // SIDEBAR RENDER
    // ════════════════════════════════════════
    function renderSidebar() {
      const tree = document.getElementById('sidebar-level-tree');
      const roots = getRootLevels();
      tree.innerHTML = roots.map(r => {
        const children = getChildren(r.id);
        const hasChildren = children.length > 0;
        return `<div class="level-node">
      <div class="level-parent" onclick="sbClickLevel('${r.id}', ${hasChildren})">
        ${hasChildren ? `<span class="level-expand" id="sb-exp-${r.id}">▶</span>` : '<span style="width:12px;display:inline-block"></span>'}
        <div class="level-pip" style="background:${r.color}"></div>
        <span class="level-name-sb">${r.name}</span>
        <span class="level-cnt-sb" style="color:${r.color}">${r.count}</span>
      </div>
      ${hasChildren ? `<div class="level-children" id="sb-ch-${r.id}">
        ${children.map(c => `<div class="level-child-item" onclick="filterLevel('${c.id}')">
          <div class="child-pip" style="background:${c.color}"></div>
          <span>${c.name}</span>
          <span style="margin-left:auto;font-family:var(--fm);font-size:10px;color:var(--muted)">${c.count}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
      }).join('');
      // update all contacts badge
      // Dùng totalContacts từ server nếu có, fallback về tổng count từ levels
      const sidebarTotal = totalContacts > 0 ? totalContacts : levels.reduce((s, l) => s + l.count, 0);
      document.getElementById('sb-cnt-all').textContent = sidebarTotal;
    }

    function sbClickLevel(id, hasChildren) {
      if (hasChildren) {
        const ch = document.getElementById('sb-ch-' + id);
        const exp = document.getElementById('sb-exp-' + id);
        ch.classList.toggle('open');
        exp.classList.toggle('open');
      }
      filterLevel(id);
    }

    function filterLevel(levelId) {
      // Dùng setFilter thay vì tự xử lý — setFilter gọi refreshContacts() → API đúng filter
      gotoPage('contacts');
      setFilter(levelId);
    }

    // ════════════════════════════════════════
    // DASHBOARD STATS
    // ════════════════════════════════════════
    function renderDashStats() {
      const roots = getRootLevels().slice(0, 4);
      const classes = ['l1', 'l2', 'l3', 'l4'];
      const container = document.getElementById('dash-stats');
      if (!container) return;
      container.innerHTML = roots.map((r, i) => `
    <div class="stat-card ${classes[i] || 'l1'}" onclick="filterLevel('${r.id}')" style="cursor:pointer">
      <div class="stat-lbl"><div style="width:8px;height:8px;border-radius:2px;background:${r.color};flex-shrink:0"></div>${r.name}</div>
      <div class="stat-val" style="color:${r.color}">${r.count}</div>
      <div class="stat-sub">contacts · ${getChildren(r.id).length} sub-levels</div>
    </div>`).join('');
    }

    function renderDashLiveStats() {
      const el = document.getElementById('dash-live-stats');
      if (!el) return;
      const totalTags = allTags.length;
      const totalSegs = allSegments.length;
      const totalLvs = levels.length;
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);flex:1;min-width:140px">
          <span style="font-size:20px">👥</span>
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--text)">${totalContacts.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--muted)">Tổng Contacts</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);flex:1;min-width:140px">
          <span style="font-size:20px">🏷</span>
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--accent2)">${totalTags}</div>
            <div style="font-size:11px;color:var(--muted)">Tags đang dùng</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);flex:1;min-width:140px">
          <span style="font-size:20px">◉</span>
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--accent)">${totalSegs}</div>
            <div style="font-size:11px;color:var(--muted)">Segments đã lưu</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);flex:1;min-width:140px">
          <span style="font-size:20px">⬣</span>
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--warn)">${totalLvs}</div>
            <div style="font-size:11px;color:var(--muted)">Levels cấp bậc</div>
          </div>
        </div>`;
    }

    async function refreshDashboard() {
      const btn = document.getElementById('dash-refresh-btn');
      if (btn) { btn.textContent = '⟳ Đang tải...'; btn.disabled = true; }
      await fetchFreshData(true);
      renderDashLiveStats();
      const now = new Date().toLocaleTimeString('vi-VN');
      const el = document.getElementById('dash-last-updated');
      if (el) el.textContent = 'Cập nhật lúc ' + now;
      if (btn) { btn.textContent = '⟳ Làm mới'; btn.disabled = false; }
    }

    // ════════════════════════════════════════
    // CONTACTS
    // ════════════════════════════════════════
    // preFiltered=true: API đã filter level → chỉ filter text trên client
    // preFiltered=false: contacts chưa filter → filter cả level lẫn text
    function renderContactTable(query = '', preFiltered = false) {
      const tbody = document.getElementById('contact-tbody');
      let rows = contacts.filter(c => {
        const levelMatch = preFiltered
          || currentFilter === 'all'
          || c.level_id === currentFilter
          || isChildOf(c.level_id, currentFilter);
        const q = query.toLowerCase();
        const textMatch = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
        return levelMatch && textMatch;
      });
      tbody.innerHTML = rows.map((c) => {
        const lv = getLevelById(c.level_id);
        const color = lv ? lv.color : '#888';
        const levelName = lv ? lv.name : (c.level || '—');
        const dbStatus = c.dbStatus || 'active';
        const hasSent = c.last && c.last !== '—';
        const statusIcon = dbStatus === 'unsubscribed' ? 's-err' : dbStatus === 'bounced' ? 's-err' : hasSent ? 's-ok' : 's-pend';
        const statusLabel = dbStatus === 'unsubscribed' ? 'Unsub' : dbStatus === 'bounced' ? 'Bounced' : hasSent ? 'Đã gửi' : 'Active';
        const cid = esc(c.id); // dùng UUID thay index — an toàn khi filter active
        return `<tr data-id="${cid}">
      <td><input type="checkbox" onchange="onRowCheck()"></td>
      <td style="font-weight:500">${esc(c.name)}</td>
      <td class="col-em">${esc(c.email)}</td>
      <td><span class="lt" style="background:${hexToRgba(color, .12)};color:${color};border:1px solid ${hexToRgba(color, .25)}">\u25cf ${levelName}</span></td>
      <td style="max-width:200px">${(c.tags||[]).map(t=>`<span class="tag-chip" onclick="removeTagFromContact('${cid}','${esc(t)}')">${esc(t)} \u00d7</span>`).join('')}<input class="tag-inline" type="text" placeholder="+ tag" onkeydown="if(event.key==='Enter'){addTagToContact('${cid}',this.value);this.value='';}" style="width:50px;border:none;background:transparent;color:var(--text);font-size:10px;outline:none"></td>
      <td><span class="sdot ${statusIcon}"></span>${statusLabel}</td>
      <td style="color:var(--muted);font-size:12px">${c.last}</td>
      <td>
        <button class="abtn" onclick="viewContactHistory('${esc(c.email)}','${esc(c.name)}')"
          style="font-size:10px;padding:2px 8px" title="Xem l\u1ecbch s\u1eed email">📧 L\u1ecbch s\u1eed</button>
        <select class="lsel" onchange="changeContactLevel('${cid}', this.value)">
          ${levels.map(l => `<option value="${l.id}"${l.id === c.level_id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
        <button class="abtn" onclick="removeContact('${cid}')" style="margin-left:4px;color:var(--err)">\u2715</button>
      </td>
    </tr>`;
      }).join('') || `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--muted)">Kh\u00f4ng c\u00f3 contact n\u00e0o</td></tr>`;
      document.getElementById('table-count').textContent = rows.length + ' contacts';
    }

    function isChildOf(levelId, parentId) {
      const lv = getLevelById(levelId);
      if (!lv) return false;
      if (lv.parent === parentId) return true;
      if (lv.parent) return isChildOf(lv.parent, parentId);
      return false;
    }

    function renderFilterChips() {
      const container = document.getElementById('filter-chips');
      const roots = getRootLevels();
      let html = `<button class="chip ${currentFilter === 'all' ? 'ca' : ''}" onclick="setFilter('all')">Tất cả</button>` +
        roots.map(r => `<button class="chip ${currentFilter === r.id ? 'ca' : ''}" style="${currentFilter === r.id ? `background:${hexToRgba(r.color, .12)};border-color:${r.color};color:${r.color}` : ''}" onclick="setFilter('${r.id}')">${r.name}</button>`).join('');

      // Tag filter chips
      if (allTags.length > 0) {
        html += `<span style="border-left:1px solid var(--border);height:16px;margin:0 6px"></span>`;
        html += allTags.slice(0, 15).map(t => {
          const isActive = selectedTags.includes(t.tag);
          return `<button class="chip ${isActive ? 'ca' : ''}" style="${isActive ? 'background:var(--accent-glow);border-color:var(--accent);color:var(--accent2)' : ''}font-size:11px" onclick="toggleTagFilter('${t.tag.replace(/'/g, "\\'")}')">🏷 ${t.tag} <span style="font-size:9px;opacity:.6">${t.count}</span></button>`;
        }).join('');
      }

      // Segment logic toggle (chỉ hiện khi có cả level và tag filter)
      if (currentFilter !== 'all' && selectedTags.length > 0) {
        html += `<span style="border-left:1px solid var(--border);height:16px;margin:0 6px"></span>`;
        html += `<button class="chip ${segmentLogic === 'and' ? 'ca' : ''}" onclick="toggleSegmentLogic()" style="font-size:10px;font-weight:600">${segmentLogic === 'and' ? 'AND' : 'OR'}</button>`;
      }

      // Tag mode toggle (khi filter nhiều tags)
      if (selectedTags.length > 1) {
        html += `<button class="chip" onclick="toggleTagMode()" style="font-size:10px;font-weight:600">${tagFilterMode === 'and' ? 'Tags: ALL' : 'Tags: ANY'}</button>`;
      }

      container.innerHTML = html;
    }

    function setFilter(f) {
      currentFilter = f;
      currentPage = 0;
      renderFilterChips();
      refreshContacts();
    }

    function toggleTagFilter(tag) {
      const idx = selectedTags.indexOf(tag);
      if (idx >= 0) selectedTags.splice(idx, 1);
      else selectedTags.push(tag);
      currentPage = 0;
      renderFilterChips();
      refreshContacts();
    }

    function toggleSegmentLogic() {
      segmentLogic = segmentLogic === 'and' ? 'or' : 'and';
      currentPage = 0;
      renderFilterChips();
      refreshContacts();
    }

    function toggleTagMode() {
      tagFilterMode = tagFilterMode === 'and' ? 'or' : 'and';
      currentPage = 0;
      renderFilterChips();
      refreshContacts();
    }

    const filterTable = debounce(function(q) {
      currentPage = 0;
      if (window._backendConnected) {
        loadContactsPage(q);
      } else {
        renderContactTable(q);
      }
    }, DEBOUNCE_SEARCH);

    async function loadContactsPage(search = '') {
      const levelId = currentFilter === 'all' ? undefined : currentFilter;
      const tagsParam = selectedTags.length ? selectedTags.join(',') : undefined;
      // Hiện loading row
      const tbody = document.getElementById('contact-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)"><span style="display:inline-block;animation:spin 1s linear infinite">⟳</span> Đang tải...</td></tr>`;
      try {
        let url = `/api/contacts?page=${currentPage}&per_page=${perPage}`;
        if (levelId) url += `&levelId=${levelId}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (tagsParam) url += `&tags=${encodeURIComponent(tagsParam)}&tagMode=${tagFilterMode}`;
        const result = await apiFetch(url);
        const { data, total } = result;
        totalContacts = total;
        // Dùng transformContact() — nhất quán, không drop tags
        contacts = (data || []).map(transformContact);
        // preFiltered = true: API đã lọc level → renderContactTable không filter lại
        renderContactTable(search, true);
        updatePaginationUI(total);
      } catch (e) {
        console.error('[loadContactsPage]', e.message);
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--err)">⚠ Lỗi tải contacts: ${e.message}</td></tr>`;
      }
    }

    function updatePaginationUI(total) {
      const start = currentPage * perPage + 1;
      const end = Math.min((currentPage + 1) * perPage, total);
      const pages = Math.ceil(total / perPage);

      document.getElementById('page-info').textContent = `${start}–${end} / ${total} contacts`;
      document.getElementById('page-num').textContent = `Trang ${currentPage + 1}/${pages}`;
      document.getElementById('btn-prev-page').disabled = currentPage === 0;
      document.getElementById('btn-next-page').disabled = currentPage >= pages - 1;
      document.getElementById('table-count').textContent = total + ' contacts';
    }

    function changePage(delta) {
      currentPage = Math.max(0, currentPage + delta);
      refreshContacts();
    }

    function changePerPage(val) {
      perPage = parseInt(val);
      currentPage = 0;
      refreshContacts();
    }
    function selectAll(cb) {
      document.querySelectorAll('#contact-tbody input[type=checkbox]').forEach(c => c.checked = cb.checked);
      updateBulkBar();
    }

    function onRowCheck() { updateBulkBar(); }

    function updateBulkBar() {
      const checked = getCheckedIndices();
      const bar = document.getElementById('bulk-bar');
      const countEl = document.getElementById('bulk-count');
      const chkAll = document.getElementById('chk-all');
      const total = document.querySelectorAll('#contact-tbody input[type=checkbox]').length;

      if (checked.length > 0) {
        bar.style.display = 'flex';
        countEl.textContent = `${checked.length} đã chọn`;
        // Điền level options vào bulk select
        const sel = document.getElementById('bulk-level-sel');
        sel.innerHTML = '<option value="">Đổi level → chọn level</option>' +
          levels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
      } else {
        bar.style.display = 'none';
      }
      if (chkAll) chkAll.indeterminate = checked.length > 0 && checked.length < total;
      if (chkAll) chkAll.checked = total > 0 && checked.length === total;
    }

    function getCheckedIndices() {
      const rows = document.querySelectorAll('#contact-tbody tr');
      const result = [];
      rows.forEach((tr, i) => {
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb?.checked) result.push(parseInt(tr.dataset.idx));
      });
      return result.filter(i => !isNaN(i));
    }

    function clearSelection() {
      document.querySelectorAll('#contact-tbody input[type=checkbox]').forEach(c => c.checked = false);
      updateBulkBar();
    }

    async function bulkDelete() {
      const idxs = getCheckedIndices();
      if (!idxs.length) return;
      if (!confirm(`Xoá ${idxs.length} contacts đã chọn?`)) return;

      const toDelete = idxs.map(i => contacts[i]).filter(Boolean);
      const ids = toDelete.map(c => c.id).filter(Boolean);

      // Xoá optimistic trước
      const toDeleteSet = new Set(idxs);
      contacts = contacts.filter((_, i) => !toDeleteSet.has(i));
      renderContactTable(); scheduleRefresh();
      updateBulkBar();
      toast(`Đã xoá ${toDelete.length} contacts`, 'warn');

      // Xoá trên Supabase
      if (window._backendConnected && ids.length) {
        for (const id of ids) {
          try { await apiFetch('/api/contacts?id=' + id, { method: 'DELETE' }); } catch (_) { }
        }
      }
    }

    async function bulkChangeLevel() {
      const idxs = getCheckedIndices();
      const levelId = document.getElementById('bulk-level-sel').value;
      if (!idxs.length) return;
      if (!levelId) { toast('Chọn level muốn đổi!', 'err'); return; }

      const lv = getLevelById(levelId);
      idxs.forEach(i => {
        if (contacts[i]) { contacts[i].level_id = levelId; contacts[i].level = lv?.name || ''; }
      });
      renderContactTable(); scheduleRefresh();
      toast(`Đã đổi level ${idxs.length} contacts → ${lv?.name}`);

      // Cập nhật trên Supabase
      if (window._backendConnected) {
        for (const i of idxs) {
          const c = contacts[i];
          if (c?.id) {
            try { await apiFetch('/api/contacts?action=level', { method: 'PATCH', body: JSON.stringify({ id: c.id, levelId }) }); }
            catch (_) { }
          }
        }
      }
    }
    async function changeContactLevel(contactId, levelId) {
      const c = contacts.find(c => c.id === contactId);
      if (!c) return;
      const lv = getLevelById(levelId);
      c.level_id = levelId;
      c.level = lv ? lv.name : '';
      renderContactTable('', true);
      toast(`Đã cập nhật level → ${lv ? lv.name : levelId}`);
      if (window._backendConnected && c.id) {
        try { await apiFetch('/api/contacts?action=level', { method: 'PATCH', body: JSON.stringify({ id: c.id, levelId }) }); }
        catch (e) { toast('Lỗi lưu level: ' + e.message, 'err'); }
      }
    }
    async function removeContact(contactId) {
      const idx = contacts.findIndex(c => c.id === contactId);
      if (idx === -1) return;
      const c = contacts[idx];
      contacts.splice(idx, 1);
      renderContactTable('', true);
      toast('Đã xoá contact', 'warn');
      if (window._backendConnected && c.id) {
        try {
          await apiFetch('/api/contacts?id=' + c.id, { method: 'DELETE' });
          clearCache();
        } catch (e) { toast('Lỗi xóa trên server: ' + e.message, 'err'); }
      }
    }

    // ════════════════════════════════════════
    // TAG MANAGEMENT
    // ════════════════════════════════════════
    async function loadAllTags() {
      if (!window._backendConnected) return;
      // Load tags và segments song song — nhanh hơn 2x so với tuần tự
      const [tagsRes, segsRes] = await Promise.allSettled([
        apiFetch('/api/contacts?action=tags'),
        apiFetch('/api/contacts?action=segments'),
      ]);
      if (tagsRes.status === 'fulfilled' && Array.isArray(tagsRes.value)) {
        allTags = tagsRes.value;
        renderFilterChips();
        renderSidebarTags();
      } else {
        console.warn('[loadAllTags] Không tải được tags:', tagsRes.reason?.message);
      }
      if (segsRes.status === 'fulfilled' && Array.isArray(segsRes.value)) {
        allSegments = segsRes.value;
        renderSidebarSegments();
      } else {
        console.warn('[loadAllTags] Không tải được segments:', segsRes.reason?.message);
      }
    }

    async function addTagToContact(contactId, tag) {
      tag = tag.trim();
      const c = contacts.find(c => c.id === contactId);
      if (!tag || !c) return;
      if (!c.tags) c.tags = [];
      if (c.tags.includes(tag)) return;
      c.tags.push(tag);
      renderContactTable('', true);
      if (window._backendConnected && c.id) {
        try {
          await apiFetch('/api/contacts?action=contact-tags', { method: 'PATCH', body: JSON.stringify({ id: c.id, tags: c.tags }) });
          loadAllTags();
        } catch (e) { toast('Lỗi lưu tag: ' + e.message, 'err'); }
      }
    }

    async function removeTagFromContact(contactId, tag) {
      const c = contacts.find(c => c.id === contactId);
      if (!c) return;
      c.tags = (c.tags || []).filter(t => t !== tag);
      renderContactTable('', true);
      if (window._backendConnected && c.id) {
        try {
          await apiFetch('/api/contacts?action=contact-tags', { method: 'PATCH', body: JSON.stringify({ id: c.id, tags: c.tags }) });
          loadAllTags();
        } catch (e) { toast('Lỗi xoá tag: ' + e.message, 'err'); }
      }
    }

    async function bulkAddTagAction() {
      const idxs = getCheckedIndices();
      const tag = document.getElementById('bulk-tag-input').value.trim();
      if (!idxs.length) return;
      if (!tag) { toast('Nhập tag muốn gắn!', 'err'); return; }

      const ids = idxs.map(i => contacts[i]?.id).filter(Boolean);
      idxs.forEach(i => {
        if (contacts[i]) {
          if (!contacts[i].tags) contacts[i].tags = [];
          if (!contacts[i].tags.includes(tag)) contacts[i].tags.push(tag);
        }
      });
      renderContactTable();
      toast(`Đã gắn tag "${tag}" cho ${idxs.length} contacts`);

      if (window._backendConnected && ids.length) {
        try {
          await apiFetch('/api/contacts?action=bulk-tag', { method: 'PATCH', body: JSON.stringify({ ids, tag }) });
          loadAllTags();
        } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
      }
    }

    async function bulkRemoveTagAction() {
      const idxs = getCheckedIndices();
      const tag = document.getElementById('bulk-tag-input').value.trim();
      if (!idxs.length) return;
      if (!tag) { toast('Nhập tag muốn gỡ!', 'err'); return; }

      const ids = idxs.map(i => contacts[i]?.id).filter(Boolean);
      idxs.forEach(i => {
        if (contacts[i]) contacts[i].tags = (contacts[i].tags || []).filter(t => t !== tag);
      });
      renderContactTable();
      toast(`Đã gỡ tag "${tag}" khỏi ${idxs.length} contacts`, 'warn');

      if (window._backendConnected && ids.length) {
        try {
          await apiFetch('/api/contacts?action=bulk-untag', { method: 'PATCH', body: JSON.stringify({ ids, tag }) });
          loadAllTags();
        } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
      }
    }

    // ════════════════════════════════════════
    // BULK → ADD TO SEGMENT
    // ════════════════════════════════════════
    let _bsegTab = 'existing';   // 'existing' | 'new'
    let _bsegColor = '#6366f1';

    function openBulkSegmentModal() {
      const ids = getCheckedContactIds();
      if (!ids.length) { toast('Chưa chọn contact nào!', 'err'); return; }

      // Update count label
      const countEl = document.getElementById('bseg-count-label');
      if (countEl) countEl.textContent = `${ids.length} contacts`;

      // Fill existing segments dropdown
      const sel = document.getElementById('bseg-existing-sel');
      if (sel) {
        sel.innerHTML = '<option value="">— Chọn segment —</option>' +
          allSegments.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      }

      // Reset state
      _bsegTab = 'existing';
      _bsegColor = '#6366f1';
      switchBulkSegTab('existing');
      document.getElementById('bseg-new-name').value = '';
      document.getElementById('bseg-new-desc').value = '';
      document.querySelectorAll('#bseg-new-colors .color-opt').forEach(el => {
        el.classList.toggle('selected', el.dataset.color === _bsegColor);
      });
      const preview = document.getElementById('bseg-existing-preview');
      if (preview) preview.style.display = 'none';

      document.getElementById('modal-bulk-segment').classList.add('open');
    }

    function switchBulkSegTab(tab) {
      _bsegTab = tab;
      document.getElementById('bseg-tab-existing')?.classList.toggle('ca', tab === 'existing');
      document.getElementById('bseg-tab-new')?.classList.toggle('ca', tab === 'new');
      document.getElementById('bseg-panel-existing').style.display = tab === 'existing' ? '' : 'none';
      document.getElementById('bseg-panel-new').style.display = tab === 'new' ? '' : 'none';
    }

    function onBsegExistingChange() {
      const segId = document.getElementById('bseg-existing-sel').value;
      const preview = document.getElementById('bseg-existing-preview');
      const info = document.getElementById('bseg-existing-info');
      if (!segId) { preview.style.display = 'none'; return; }
      const seg = allSegments.find(s => s.id === segId);
      if (seg) {
        info.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${seg.color||'#60a5fa'};display:inline-block"></span>${seg.name}</span>`;
        preview.style.display = '';
      }
    }

    function pickBulkSegColor(el) {
      document.querySelectorAll('#bseg-new-colors .color-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      _bsegColor = el.dataset.color;
    }

    // Get UUIDs of all checked rows
    function getCheckedContactIds() {
      const ids = [];
      document.querySelectorAll('#contact-tbody tr').forEach(tr => {
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb?.checked && tr.dataset.id) ids.push(tr.dataset.id);
      });
      return ids;
    }

    async function executeBulkSegment() {
      const contactIds = getCheckedContactIds();
      if (!contactIds.length) { toast('Chưa chọn contact nào!', 'err'); return; }

      if (_bsegTab === 'existing') {
        await _bulkAddToExistingSegment(contactIds);
      } else {
        await _bulkCreateNewSegment(contactIds);
      }
    }

    async function _bulkAddToExistingSegment(contactIds) {
      const segId = document.getElementById('bseg-existing-sel').value;
      if (!segId) { toast('Chọn segment muốn thêm vào!', 'err'); return; }
      const seg = allSegments.find(s => s.id === segId);
      if (!seg) { toast('Segment không tồn tại!', 'err'); return; }
      if (!window._backendConnected) { toast('Chưa kết nối Supabase', 'err'); return; }

      // 1. Tạo tag mới tự động: "seg_<segment-slug>_<timestamp>"
      const slug = seg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      const autoTag = `seg-${slug}-${Date.now().toString(36)}`;

      try {
        // 2. Tạo tag trong DB
        await apiFetch('/api/contacts?action=tags', {
          method: 'POST',
          body: JSON.stringify({ name: autoTag, color: seg.color || '#6366f1', description: `Auto-tag cho segment "${seg.name}"` })
        });

        // 3. Gắn tag vào tất cả contacts được chọn
        await apiFetch('/api/contacts?action=bulk-tag', {
          method: 'PATCH',
          body: JSON.stringify({ ids: contactIds, tag: autoTag })
        });

        // 4. Cập nhật local contacts
        contactIds.forEach(cid => {
          const c = contacts.find(x => x.id === cid);
          if (c) { if (!c.tags) c.tags = []; if (!c.tags.includes(autoTag)) c.tags.push(autoTag); }
        });

        // 5. Thêm tag rule vào segment hiện tại
        const updatedRules = [...(seg.rules || []), { type: 'tag', value: autoTag }];
        await apiFetch('/api/contacts?action=segments', {
          method: 'PATCH',
          body: JSON.stringify({ id: segId, rules: updatedRules })
        });

        // 6. Refresh data
        await loadAllTags();
        allSegments = await apiFetch('/api/contacts?action=segments');
        renderSidebarSegments();
        renderContactTable();

        closeModal('modal-bulk-segment');
        clearSelection();
        toast(`✓ Đã thêm ${contactIds.length} contacts vào segment "${seg.name}"!`);
      } catch (e) {
        toast('Lỗi: ' + e.message, 'err');
      }
    }

    async function _bulkCreateNewSegment(contactIds) {
      const name = document.getElementById('bseg-new-name').value.trim();
      const desc = document.getElementById('bseg-new-desc').value.trim();
      if (!name) { toast('Nhập tên segment mới!', 'err'); return; }
      if (!window._backendConnected) { toast('Chưa kết nối Supabase', 'err'); return; }

      // 1. Tạo auto-tag
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      const autoTag = `seg-${slug}-${Date.now().toString(36)}`;

      try {
        // 2. Tạo tag trong DB
        await apiFetch('/api/contacts?action=tags', {
          method: 'POST',
          body: JSON.stringify({ name: autoTag, color: _bsegColor, description: `Auto-tag cho segment "${name}"` })
        });

        // 3. Gắn tag vào contacts
        await apiFetch('/api/contacts?action=bulk-tag', {
          method: 'PATCH',
          body: JSON.stringify({ ids: contactIds, tag: autoTag })
        });

        // 4. Cập nhật local contacts
        contactIds.forEach(cid => {
          const c = contacts.find(x => x.id === cid);
          if (c) { if (!c.tags) c.tags = []; if (!c.tags.includes(autoTag)) c.tags.push(autoTag); }
        });

        // 5. Tạo segment mới với rule tag
        await apiFetch('/api/contacts?action=segments', {
          method: 'POST',
          body: JSON.stringify({
            name,
            color: _bsegColor,
            description: desc || `Segment tạo từ ${contactIds.length} contacts được chọn`,
            rules: [{ type: 'tag', value: autoTag }],
            logic: 'and',
            tag_mode: 'or'
          })
        });

        // 6. Refresh data
        await loadAllTags();
        allSegments = await apiFetch('/api/contacts?action=segments');
        renderSidebarSegments();
        renderContactTable();

        closeModal('modal-bulk-segment');
        clearSelection();
        toast(`✓ Đã tạo segment mới "${name}" với ${contactIds.length} contacts!`);
      } catch (e) {
        toast('Lỗi: ' + e.message, 'err');
      }
    }

    // ════════════════════════════════════════
    // TAG PAGE MANAGEMENT
    // ════════════════════════════════════════
    function renderTagPage() {
      const body = document.getElementById('tag-list-body');
      const count = document.getElementById('tag-total-count');
      if (!allTags.length) {
        body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Chưa có tag nào. Tạo tag đầu tiên →</div>`;
        if (count) count.textContent = '0 tags';
        return;
      }
      if (count) count.textContent = allTags.length + ' tags';
      body.innerHTML = allTags.map(t => {
        const tagName = t.tag || t.name;
        const tagColor = t.color || '#a78bfa';
        const tagCount = t.count || 0;
        const tagId = t.id;
        return `<div class="level-row" style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">
          <div style="width:12px;height:12px;border-radius:50%;background:${tagColor};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${tagName}</div>
            ${t.description ? `<div style="font-size:11px;color:var(--muted)">${t.description}</div>` : ''}
          </div>
          <span style="font-family:var(--fm);font-size:11px;color:${tagColor};font-weight:600">${tagCount} contacts</span>
          <button class="abtn" onclick="editTag('${tagId}','${tagName}','${tagColor}','${(t.description||'').replace(/'/g,"\\\\'")}')">✏</button>
          <button class="abtn" onclick="deleteTag('${tagId}','${tagName}')" style="color:var(--err)">✕</button>
        </div>`;
      }).join('');
    }

    function renderSidebarTags() {
      const list = document.getElementById('sidebar-tag-list');
      if (!list) return;
      if (!allTags.length) {
        list.innerHTML = `<div style="padding:4px 16px;font-size:11px;color:var(--muted)">Chưa có tag</div>`;
        return;
      }
      list.innerHTML = allTags.slice(0, 12).map(t => {
        const tagName = t.tag || t.name;
        const tagColor = t.color || '#a78bfa';
        const isActive = selectedTags.includes(tagName);
        return `<button class="sb-tag-item ${isActive ? 'active' : ''}" onclick="filterByTag('${tagName.replace(/'/g,"\\\\'")}')">
          <div style="width:7px;height:7px;border-radius:50%;background:${tagColor};flex-shrink:0"></div>
          <span style="flex:1">${tagName}</span>
          <span style="font-family:var(--fm);font-size:10px;color:var(--muted)">${t.count||0}</span>
        </button>`;
      }).join('');
    }

    function filterByTag(tag) {
      toggleTagFilter(tag);
      gotoPage('contacts');
    }

    function openAddTag() {
      document.getElementById('tf-edit-id').value = '';
      document.getElementById('tf-name').value = '';
      document.getElementById('tf-desc').value = '';
      document.getElementById('tag-form-title').textContent = '🏷 Thêm Tag mới';
      document.getElementById('tf-cancel').style.display = 'none';
      _tfColor = '#a78bfa';
      document.querySelectorAll('#tf-colors .color-opt').forEach(el => {
        el.classList.toggle('selected', el.dataset.color === _tfColor);
      });
    }

    function editTag(id, name, color, desc) {
      document.getElementById('tf-edit-id').value = id;
      document.getElementById('tf-name').value = name;
      document.getElementById('tf-desc').value = desc || '';
      document.getElementById('tag-form-title').textContent = '✏ Sửa Tag';
      document.getElementById('tf-cancel').style.display = 'block';
      _tfColor = color;
      document.querySelectorAll('#tf-colors .color-opt').forEach(el => {
        el.classList.toggle('selected', el.dataset.color === color);
      });
    }

    function cancelEditTag() { openAddTag(); }

    function pickTagColor(el) {
      document.querySelectorAll('#tf-colors .color-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      _tfColor = el.dataset.color;
    }

    async function saveTag() {
      const name = document.getElementById('tf-name').value.trim();
      const desc = document.getElementById('tf-desc').value.trim();
      const editId = document.getElementById('tf-edit-id').value;
      if (!name) { toast('Nhập tên tag!', 'err'); return; }
      if (!window._backendConnected) { toast('Chưa kết nối Supabase', 'err'); return; }
      try {
        if (editId) {
          await apiFetch('/api/contacts?action=tags', { method: 'PATCH', body: JSON.stringify({ id: editId, name, color: _tfColor, description: desc }) });
          toast(`Đã cập nhật tag "${name}"`);
        } else {
          await apiFetch('/api/contacts?action=tags', { method: 'POST', body: JSON.stringify({ name, color: _tfColor, description: desc }) });
          toast(`Đã tạo tag "${name}"`);
        }
        await loadAllTags();
        renderTagPage();
        openAddTag();
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    }

    async function deleteTag(id, name) {
      if (!confirm(`Xoá tag "${name}"? Tag này sẽ bị xoá khỏi tất cả contacts.`)) return;
      try {
        await apiFetch('/api/contacts?action=tags&id=' + id, { method: 'DELETE' });
        toast(`Đã xoá tag "${name}"`, 'warn');
        await loadAllTags();
        renderTagPage();
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    }

    // ════════════════════════════════════════
    // SEGMENT PAGE
    // ════════════════════════════════════════
    async function renderSegmentPage() {
      if (window._backendConnected) {
        try {
          allSegments = await apiFetch('/api/contacts?action=segments');
        } catch (_) { }
      }
      renderSegmentList();
      renderSegFormLevels();
      renderSegFormTags();
    }

    function renderSegmentList() {
      const body = document.getElementById('segment-list-body');
      const count = document.getElementById('seg-total-count');
      if (!allSegments.length) {
        body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Chưa có segment nào. Tạo segment đầu tiên →</div>`;
        if (count) count.textContent = '';
        return;
      }
      if (count) count.textContent = allSegments.length + ' segments';
      body.innerHTML = allSegments.map(s => {
        const rules = s.rules || [];
        const levelRules = rules.filter(r => r.type === 'level');
        const tagRules = rules.filter(r => r.type === 'tag');
        const desc = [
          levelRules.length ? `${levelRules.length} level` : '',
          tagRules.length ? `${tagRules.length} tag` : '',
        ].filter(Boolean).join(` ${s.logic === 'or' ? 'OR' : 'AND'} `);
        return `<div class="level-row" style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">
          <div style="width:12px;height:12px;border-radius:50%;background:${s.color||'#60a5fa'};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${s.name}</div>
            <div style="font-size:11px;color:var(--muted)">${desc || 'Không có điều kiện'}</div>
          </div>
          <button class="abtn" style="font-size:11px" onclick="filterBySegment('${s.id}')">◉ Xem</button>
          <button class="abtn" onclick="editSegment('${s.id}')">✏</button>
          <button class="abtn" onclick="deleteSegment('${s.id}','${s.name.replace(/'/g,"\\\\'")}')}" style="color:var(--err)">✕</button>
        </div>`;
      }).join('');
    }

    function renderSidebarSegments() {
      const list = document.getElementById('sidebar-segment-list');
      if (!list) return;
      if (!allSegments.length) {
        list.innerHTML = '';
        return;
      }
      list.innerHTML = allSegments.slice(0, 8).map(s =>
        `<button class="sb-seg-item" onclick="filterBySegment('${s.id}')">
          <div style="width:7px;height:7px;border-radius:50%;background:${s.color||'#60a5fa'};flex-shrink:0"></div>
          <span style="flex:1">${s.name}</span>
        </button>`
      ).join('');
    }

    async function filterBySegment(segId) {
      const seg = allSegments.find(s => s.id === segId);
      if (!seg) return;
      // Apply segment rules to filter
      const rules = seg.rules || [];
      const levelIds = rules.filter(r => r.type === 'level').map(r => r.value);
      const tags = rules.filter(r => r.type === 'tag').map(r => r.value);
      // Reset filter
      currentFilter = levelIds.length === 1 ? levelIds[0] : 'all';
      selectedTags = tags;
      tagFilterMode = seg.tag_mode || 'or';
      segmentLogic = seg.logic || 'and';
      gotoPage('contacts');
      const search = document.querySelector('.tbl-search')?.value || '';
      if (window._backendConnected) loadContactsPage(search);
      renderFilterChips();
    }

    function openNewSegment() {
      document.getElementById('sf-edit-id').value = '';
      document.getElementById('sf-name').value = '';
      document.getElementById('sf-desc').value = '';
      document.getElementById('seg-form-title').textContent = '⊕ Tạo Segment mới';
      document.getElementById('sf-cancel').style.display = 'none';
      document.getElementById('sf-preview-count').textContent = '—';
      _sfLevelRules = []; _sfTagRules = []; _sfLogic = 'and'; _sfTagMode = 'or'; _sfColor = '#60a5fa';
      renderSegFormLevels(); renderSegFormTags(); updateSegLogicUI(); updateSegTagModeUI();
    }

    function editSegment(id) {
      const s = allSegments.find(x => x.id === id);
      if (!s) return;
      document.getElementById('sf-edit-id').value = s.id;
      document.getElementById('sf-name').value = s.name;
      document.getElementById('sf-desc').value = s.description || '';
      document.getElementById('seg-form-title').textContent = '✏ Sửa Segment';
      document.getElementById('sf-cancel').style.display = 'block';
      _sfLogic = s.logic || 'and'; _sfTagMode = s.tag_mode || 'or'; _sfColor = s.color || '#60a5fa';
      _sfLevelRules = (s.rules||[]).filter(r => r.type === 'level');
      _sfTagRules = (s.rules||[]).filter(r => r.type === 'tag');
      renderSegFormLevels(); renderSegFormTags(); updateSegLogicUI(); updateSegTagModeUI();
      previewSegCount();
    }

    function cancelEditSegment() { openNewSegment(); }

    function pickSegColor(el) {
      document.querySelectorAll('#sf-colors .color-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      _sfColor = el.dataset.color;
    }

    function setSegLogic(v) { _sfLogic = v; updateSegLogicUI(); previewSegCount(); }
    function setSegTagMode(v) { _sfTagMode = v; updateSegTagModeUI(); previewSegCount(); }

    function updateSegLogicUI() {
      document.getElementById('sf-logic-and')?.classList.toggle('ca', _sfLogic === 'and');
      document.getElementById('sf-logic-or')?.classList.toggle('ca', _sfLogic === 'or');
    }
    function updateSegTagModeUI() {
      document.getElementById('sf-tagmode-or')?.classList.toggle('ca', _sfTagMode === 'or');
      document.getElementById('sf-tagmode-and')?.classList.toggle('ca', _sfTagMode === 'and');
    }

    function renderSegFormLevels() {
      const cont = document.getElementById('sf-level-rules');
      if (!cont) return;
      // Hiển thị levels đã chọn + các level chưa chọn để add
      cont.innerHTML = _sfLevelRules.map(r => {
        const lv = getLevelById(r.value);
        const name = lv ? lv.name : r.value;
        const color = lv ? lv.color : '#888';
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:8px;background:${hexToRgba(color,.15)};color:${color};border:1px solid ${hexToRgba(color,.3)};font-size:11px;cursor:pointer" onclick="removeSegLevel('${r.value}')">● ${name} ×</span>`;
      }).join('');
      // Dropdown để thêm level
      const remaining = levels.filter(l => !_sfLevelRules.find(r => r.value === l.id));
      if (remaining.length) {
        cont.innerHTML += `<select class="fsel" onchange="addSegLevel(this.value);this.value=''" style="font-size:11px;padding:2px 6px;border-radius:6px;height:24px">
          <option value="">+ Thêm level...</option>
          ${remaining.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}
        </select>`;
      }
    }

    function renderSegFormTags() {
      const cont = document.getElementById('sf-tag-rules');
      if (!cont) return;
      cont.innerHTML = _sfTagRules.map(r => {
        const t = allTags.find(x => (x.tag||x.name) === r.value);
        const color = t?.color || '#a78bfa';
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:8px;background:${hexToRgba(color,.15)};color:${color};border:1px solid ${hexToRgba(color,.3)};font-size:11px;cursor:pointer" onclick="removeSegTag('${r.value}')">🏷 ${r.value} ×</span>`;
      }).join('');
      // Dropdown để thêm tag
      const remaining = allTags.filter(t => !_sfTagRules.find(r => r.value === (t.tag||t.name)));
      if (remaining.length) {
        cont.innerHTML += `<select class="fsel" onchange="addSegTag(this.value);this.value=''" style="font-size:11px;padding:2px 6px;border-radius:6px;height:24px">
          <option value="">+ Thêm tag...</option>
          ${remaining.map(t => `<option value="${t.tag||t.name}">${t.tag||t.name}</option>`).join('')}
        </select>`;
      }
    }

    function addSegLevel(id) {
      if (id && !_sfLevelRules.find(r => r.value === id)) {
        _sfLevelRules.push({ type: 'level', value: id });
        renderSegFormLevels(); previewSegCount();
      }
    }
    function removeSegLevel(id) {
      _sfLevelRules = _sfLevelRules.filter(r => r.value !== id);
      renderSegFormLevels(); previewSegCount();
    }
    function addSegTag(tag) {
      if (tag && !_sfTagRules.find(r => r.value === tag)) {
        _sfTagRules.push({ type: 'tag', value: tag });
        renderSegFormTags(); previewSegCount();
      }
    }
    function removeSegTag(tag) {
      _sfTagRules = _sfTagRules.filter(r => r.value !== tag);
      renderSegFormTags(); previewSegCount();
    }

    const previewSegCount = debounce(async function() {
      const el = document.getElementById('sf-preview-count');
      if (!el) return;
      if (!_sfLevelRules.length && !_sfTagRules.length) { el.textContent = '—'; return; }
      if (!window._backendConnected) { el.textContent = '?'; return; }
      el.textContent = '...';
      try {
        const rules = [..._sfLevelRules, ..._sfTagRules];
        const res = await apiFetch('/api/contacts?action=segment-count', {
          method: 'GET' // can't pass body in GET, use temp segment inline count
        });
        // Use client-side count as estimate
        el.textContent = '~' + contacts.filter(c => {
          const levelIds = _sfLevelRules.map(r => r.value);
          const tags = _sfTagRules.map(r => r.value);
          const hasLevel = !levelIds.length || levelIds.includes(c.level_id);
          const hasTags = !tags.length || (_sfTagMode === 'and'
            ? tags.every(t => (c.tags||[]).includes(t))
            : tags.some(t => (c.tags||[]).includes(t)));
          return _sfLogic === 'or' ? (hasLevel || hasTags) : (hasLevel && hasTags);
        }).length + '+';
      } catch (_) { el.textContent = '?'; }
    }, 400);

    async function saveSegment() {
      const name = document.getElementById('sf-name').value.trim();
      const desc = document.getElementById('sf-desc').value.trim();
      const editId = document.getElementById('sf-edit-id').value;
      if (!name) { toast('Nhập tên segment!', 'err'); return; }
      if (!window._backendConnected) { toast('Chưa kết nối Supabase', 'err'); return; }
      const rules = [..._sfLevelRules, ..._sfTagRules];
      try {
        if (editId) {
          await apiFetch('/api/contacts?action=segments', { method: 'PATCH', body: JSON.stringify({ id: editId, name, color: _sfColor, description: desc, rules, logic: _sfLogic, tag_mode: _sfTagMode }) });
          toast(`Đã cập nhật segment "${name}"`);
        } else {
          await apiFetch('/api/contacts?action=segments', { method: 'POST', body: JSON.stringify({ name, color: _sfColor, description: desc, rules, logic: _sfLogic, tag_mode: _sfTagMode }) });
          toast(`Đã tạo segment "${name}"`);
        }
        allSegments = await apiFetch('/api/contacts?action=segments');
        renderSegmentList();
        renderSidebarSegments();
        cancelEditSegment();
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    }

    async function deleteSegment(id, name) {
      if (!confirm(`Xoá segment "${name}"?`)) return;
      try {
        await apiFetch('/api/contacts?action=segments&id=' + id, { method: 'DELETE' });
        allSegments = allSegments.filter(s => s.id !== id);
        renderSegmentList(); renderSidebarSegments();
        toast(`Đã xoá segment "${name}"`, 'warn');
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    }

    // ════════════════════════════════════════
    // LEVEL MANAGEMENT
    // ════════════════════════════════════════
    function renderLevelPage() {
      const body = document.getElementById('level-list-body');
      const roots = getRootLevels();
      let html = '';
      roots.forEach(r => {
        html += levelRow(r, false);
        getChildren(r.id).forEach(c => { html += levelRow(c, true); });
      });
      body.innerHTML = html || '<div style="padding:20px;color:var(--muted);text-align:center">Chưa có level nào</div>';
      document.getElementById('level-total-count').textContent = levels.length + ' levels';
      // update quick form parent select
      const qlp = document.getElementById('ql-parent');
      qlp.innerHTML = '<option value="">— Level gốc —</option>' + levels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    }

    function levelRow(lv, isChild) {
      const parentLv = lv.parent ? getLevelById(lv.parent) : null;
      return `<div class="level-row">
    ${isChild ? '<div style="width:20px;height:1px;background:var(--border2);margin-left:8px;flex-shrink:0"></div>' : ''}
    <div class="level-row-pip" style="background:${lv.color}${isChild ? ';width:7px;height:7px' : ''}"></div>
    <span class="level-row-name">${lv.name}</span>
    ${parentLv ? `<span class="level-row-parent">sub: ${parentLv.name}</span>` : ''}
    <span style="color:var(--muted);font-size:12px;flex:1;margin-left:8px">${lv.desc || ''}</span>
    <span class="level-row-cnt">${lv.count} contacts</span>
    <div class="level-row-actions">
      <button class="abtn" onclick="editLevel('${lv.id}')">Edit</button>
      ${lv.id !== 'L1' && lv.id !== 'L2' && lv.id !== 'L3' && lv.id !== 'L4' ? `<button class="abtn btn-danger" onclick="deleteLevel('${lv.id}')">✕</button>` : ''}
    </div>
  </div>`;
    }

    async function deleteLevel(id) {
      const lv = getLevelById(id);
      const lvName = lv ? lv.name : id;
      if (!confirm(`Xoá level "${lvName}"?\nContacts thuộc level này sẽ không bị xoá.`)) return;
      if (window._backendConnected) {
        try {
          await apiFetch('/api/levels?id=' + id, { method: 'DELETE' });
        } catch (e) { toast('Lỗi xoá level: ' + e.message, 'err'); return; }
      }
      // Cập nhật local state + xóa cache để reload lấy data mới
      levels = levels.filter(l => l.id !== id && l.parent !== id);
      rebuildLevelMap();
      clearCache(); // ← xóa cache để reload không trả về data cũ
      scheduleRefresh();
      renderLevelPage();
      toast(`Đã xoá level "${lvName}"`, 'warn');
    }
    function editLevel(id) { toast('Tính năng edit level sẽ có trong bản tiếp theo', 'warn'); }

    // modal add level
    function openAddLevel(parentId = '') {
      document.getElementById('ml-name').value = '';
      document.getElementById('ml-desc').value = '';
      document.getElementById('ml-parent').value = parentId;
      updateModalPreview();
      document.getElementById('modal-level').classList.add('open');
    }
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }
    function pickColor(el) {
      document.querySelectorAll('#ml-colors .color-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected'); selectedColor = el.dataset.color;
    }
    function pickColorQuick(el) {
      document.querySelectorAll('#ql-colors .color-opt').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected'); selectedColorQuick = el.dataset.color;
    }
    function updateModalPreview() {
      const parent = document.getElementById('ml-parent').value;
      const preview = document.getElementById('ml-preview');
      const tree = document.getElementById('ml-tree-preview');
      if (parent) {
        const pLv = getLevelById(parent);
        preview.classList.add('visible');
        tree.innerHTML = `<div style="background:${hexToRgba(pLv.color, .12)};color:${pLv.color};padding:2px 8px;border-radius:8px;font-size:12px">${pLv.name}</div>
      <span style="color:var(--muted)">→</span>
      <div style="background:${hexToRgba(selectedColor, .12)};color:${selectedColor};padding:2px 8px;border-radius:8px;font-size:12px">${document.getElementById('ml-name').value || 'New Level'}</div>`;
      } else { preview.classList.remove('visible'); }
    }
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('ml-parent').addEventListener('change', updateModalPreview);
      document.getElementById('ml-name').addEventListener('input', updateModalPreview);
    });

    async function saveLevel() {
      const name = document.getElementById('ml-name').value.trim();
      if (!name) { toast('Nhập tên level!', 'err'); return; }
      if (levels.find(l => l.name === name)) { toast('Level đã tồn tại!', 'err'); return; }
      const parent = document.getElementById('ml-parent').value || null;
      const desc = document.getElementById('ml-desc').value.trim();
      let newId = name;
      if (window._backendConnected) {
        try {
          const created = await apiFetch('/api/levels', { method: 'POST',
            body: JSON.stringify({ name, color: selectedColor, parent_id: parent, description: desc }) });
          newId = created?.id || name;
        } catch (e) { toast('Lỗi tạo level: ' + e.message, 'err'); return; }
      }
      levels.push({ id: newId, name, color: selectedColor, parent, desc, count: 0 });
      rebuildLevelMap();
      clearCache(); // ← reload sẽ lấy data mới từ Supabase
      closeModal('modal-level');
      scheduleRefresh(); renderLevelPage();
      toast(`Đã tạo level "${name}"`);
    }

    async function saveQuickLevel() {
      const name = document.getElementById('ql-name').value.trim();
      if (!name) { toast('Nhập tên level!', 'err'); return; }
      if (levels.find(l => l.name === name)) { toast('Level đã tồn tại!', 'err'); return; }
      const parent = document.getElementById('ql-parent').value || null;
      const desc = document.getElementById('ql-desc').value.trim();
      let newId = name;
      if (window._backendConnected) {
        try {
          const created = await apiFetch('/api/levels', { method: 'POST',
            body: JSON.stringify({ name, color: selectedColorQuick, parent_id: parent, description: desc }) });
          newId = created?.id || name;
        } catch (e) { toast('Lỗi tạo level: ' + e.message, 'err'); return; }
      }
      levels.push({ id: newId, name, color: selectedColorQuick, parent, desc, count: 0 });
      rebuildLevelMap();
      clearCache();
      document.getElementById('ql-name').value = '';
      document.getElementById('ql-desc').value = '';
      scheduleRefresh(); renderLevelPage(); renderCampaignTargets();
      toast(`Đã tạo level "${name}"`);
    }
    function updateQuickPreview() { /* removed — stub not needed */ }

    // ════════════════════════════════════════
    // TEMPLATES
    // ════════════════════════════════════════
    function renderTemplates() {
      const grid = document.getElementById('template-grid');
      const countEl = document.getElementById('tmpl-count');
      const sbBadge = document.getElementById('sb-cnt-tmpl');
      if (countEl) countEl.textContent = templates.length + ' mẫu';
      if (sbBadge) sbBadge.textContent = templates.length;
      grid.innerHTML = templates.map(t => `
    <div class="tmpl-card ${activeTemplate === t.id ? 'active-tmpl' : ''}" onclick="selectTemplate('${t.id}')">
      <div class="tmpl-card-row">
        <div class="tmpl-card-icon">${t.icon}</div>
        <div class="tmpl-card-info">
          <div class="tmpl-card-name">${t.name}</div>
          <div class="tmpl-card-desc">${t.desc}</div>
        </div>
        <button class="tmpl-card-del" onclick="event.stopPropagation();deleteTemplate('${t.id}')" title="Xoá template">✕</button>
      </div>
      ${t.tags && t.tags.length ? `<div class="tmpl-tags">${t.tags.map(tg => `<span class="tmpl-tag">${tg}</span>`).join('')}</div>` : ''}
    </div>`).join('');
      // update campaign template picker
      const picker = document.getElementById('tmpl-picker');
      if (picker) picker.innerHTML = '<option value="">— Load template —</option>' + templates.map(t => `<option value="${t.id}">${t.icon} ${t.name}</option>`).join('');
    }

    function selectTemplate(id) {
      activeTemplate = id;
      const t = templates.find(x => x.id === id);
      if (!t) return;
      _veReady = false;
      document.getElementById('tmpl-code').value = t.body;
      document.getElementById('tmpl-name-input').value = t.name;
      if (editorMode === 'visual' || editorMode === 'split') {
        initVisualEditor(t.body);
      }
      updatePreviewFrame();
      renderTemplates();
      toast(`Đã tải template: ${t.name}`);
    }

    // Delete template (local + backend)
    async function deleteTemplate(id) {
      const t = templates.find(x => x.id === id);
      if (!t) return;
      if (!confirm(`Xoá template "${t.name}"?`)) return;
      if (window._backendConnected) {
        try {
          const res = await fetch(API + `/api/templates?id=${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...cfgHeaders() },
          });
          if (!res.ok) {
            const text = await res.text();
            let msg = 'Lỗi server';
            try { msg = JSON.parse(text).error || msg; } catch(_) { msg = text || msg; }
            throw new Error(msg);
          }
        } catch (e) {
          toast('Lỗi xoá: ' + e.message, 'err');
          return;
        }
      }
      templates = templates.filter(x => x.id !== id);
      if (activeTemplate === id) {
        activeTemplate = null;
        document.getElementById('tmpl-code').value = '';
        document.getElementById('tmpl-name-input').value = '';
        updatePreview();
      }
      renderTemplates();
      toast(`Đã xoá template "${t.name}"`);
    }


    // ════════════════════════════════════════
    // VISUAL EDITOR
    // ════════════════════════════════════════
    let _veReady = false;
    let _codeSyncTimer = null;

    function getVeFrame() { return document.getElementById('ve-frame'); }
    function getVeDoc() { return getVeFrame()?.contentDocument; }

    function initVisualEditor(html) {
      const frame = getVeFrame();
      if (!frame) return;
      const doc = frame.contentDocument;
      const rawContent = html || document.getElementById('tmpl-code').value || '<p>Bắt đầu soạn email...</p>';

      // Detect nếu là full HTML doc — extract body + styles
      const isFullDoc = /^\s*<!DOCTYPE|^\s*<html/i.test(rawContent);
      let bodyContent = rawContent;
      let extraStyles = '';

      if (isFullDoc) {
        const bodyMatch = rawContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) bodyContent = bodyMatch[1];
        const styleMatches = rawContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
        if (styleMatches) {
          extraStyles = styleMatches.map(s => {
            const inner = s.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            return inner ? inner[1] : '';
          }).join('\n');
        }
      }

      doc.open();
      doc.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <style>
      body{margin:0;padding:16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#222;min-height:460px;outline:none}
      body:empty:before{content:'Nhấp để bắt đầu soạn...';color:#aaa}
      a{color:#4f6cff}img{max-width:100%}
      *{box-sizing:border-box}
      ${extraStyles}
    </style>
  </head><body></body></html>`);
      doc.close();
      doc.body.innerHTML = bodyContent;
      doc.designMode = 'on';
      _veReady = true;

      // Sync visual → code khi user gõ
      doc.addEventListener('input', () => {
        clearTimeout(_codeSyncTimer);
        _codeSyncTimer = setTimeout(syncVisualToCode, CODE_SYNC_DELAY);
      });
      doc.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); veExec('undo'); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); veExec('redo'); }
      });
      // Handle paste with formatting
      doc.addEventListener('paste', e => {
        const clipHtml = e.clipboardData.getData('text/html');
        if (clipHtml) {
          e.preventDefault();
          doc.execCommand('insertHTML', false, clipHtml);
          syncVisualToCode();
        }
      });
    }

    function syncVisualToCode() {
      if (!_veReady) return;
      const doc = getVeDoc();
      if (!doc) return;
      document.getElementById('tmpl-code').value = doc.body.innerHTML;
      updatePreviewFrame();
    }

    function syncCodeToVisual() {
      if (!_veReady) return;
      const doc = getVeDoc();
      if (!doc) return;
      doc.body.innerHTML = document.getElementById('tmpl-code').value;
    }

    function onCodeInput() {
      clearTimeout(_codeSyncTimer);
      _codeSyncTimer = setTimeout(() => {
        syncCodeToVisual();
        updatePreviewFrame();
      }, 500);
    }

    function veExec(cmd, val) {
      const doc = getVeDoc();
      if (doc && doc.designMode === 'on') { doc.execCommand(cmd, false, val || null); doc.body.focus(); syncVisualToCode(); }
    }

    function veExecBlock(tag) {
      const doc = getVeDoc();
      if (!doc) return;
      doc.execCommand('formatBlock', false, tag);
      doc.body.focus();
      syncVisualToCode();
    }

    function setEditorMode(mode) {
      editorMode = mode;
      const area = document.getElementById('editor-area');
      const codePane = document.getElementById('code-pane');
      const visualPane = document.getElementById('visual-pane');
      const previewPane = document.getElementById('preview-pane-wrap');
      const veToolbar = document.getElementById('ve-toolbar');

      document.querySelectorAll('.editor-btn').forEach(b => b.classList.remove('active-mode'));
      const modeBtn = document.getElementById('btn-mode-' + mode);
      if (modeBtn) modeBtn.classList.add('active-mode');

      // Reset all
      [codePane, visualPane, previewPane].forEach(p => { if (p) p.style.display = 'none'; });
      veToolbar.style.display = 'none';

      if (mode === 'visual') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        visualPane.style.display = '';
        veToolbar.style.display = '';
        // Reset iframe scale
        const veFrame = document.getElementById('ve-frame');
        if (veFrame) { veFrame.style.transform = ''; veFrame.style.width = ''; veFrame.style.height = ''; }
        if (!_veReady) initVisualEditor();
        else syncCodeToVisual();
      } else if (mode === 'split') {
        area.style.gridTemplateColumns = '1fr 1fr';
        area.classList.add('split-mode');
        codePane.style.display = '';
        visualPane.style.display = '';
        veToolbar.style.display = '';
        // Scale down iframe to fit the pane
        const veFrame = document.getElementById('ve-frame');
        if (veFrame) {
          requestAnimationFrame(() => {
            const paneW = visualPane.offsetWidth;
            // Use 600px as the email design width
            const emailW = 600;
            if (paneW > 0 && paneW < emailW) {
              const scale = paneW / emailW;
              veFrame.style.transform = `scale(${scale})`;
              veFrame.style.width = emailW + 'px';
              veFrame.style.height = (460 / scale) + 'px';
            } else {
              veFrame.style.transform = '';
              veFrame.style.width = '100%';
              veFrame.style.height = '';
            }
          });
        }
        if (!_veReady) initVisualEditor();
        else syncCodeToVisual();
      } else if (mode === 'code') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        codePane.style.display = '';
      } else if (mode === 'preview') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        previewPane.style.display = '';
        updatePreviewFrame();
      }
    }

    // Shared preview renderer — dùng chung cho template editor và campaign
    const PREVIEW_SAMPLE = { name: 'Nguyễn Văn A', email: 'sample@ucmas.vn', level: 'L1', company: 'UCMAS', date: new Date().toLocaleDateString('vi-VN') };
    function renderEmailPreview(code, frame) {
      if (!frame || !code?.trim()) {
        if (frame) frame.srcdoc = '<p style="color:#aaa;font-family:Arial;padding:16px">Chưa có nội dung</p>';
        return;
      }
      let rendered = code;
      Object.entries(PREVIEW_SAMPLE).forEach(([k, v]) => { rendered = rendered.replaceAll('{{' + k + '}}', v); });
      const isHtml = /^\s*<!DOCTYPE|^\s*<html|<[a-z][\s\S]*>/i.test(rendered);
      if (!isHtml && rendered.trim()) {
        rendered = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>body{font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:600px;margin:0 auto;padding:20px;line-height:1.7}p{margin:0 0 12px}a{color:#4f6cff}</style>
        </head><body>${rendered.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '').join('\n')}</body></html>`;
      }
      frame.srcdoc = rendered;
    }

    function updatePreviewFrame() {
      renderEmailPreview(document.getElementById('tmpl-code').value, document.getElementById('preview-frame'));
    }

    function updatePreview() { updatePreviewFrame(); }

    // ── Link dialog ──────────────────────────
    let _savedRange = null;
    function openLinkDialog() {
      const doc = getVeDoc();
      if (doc) {
        const sel = doc.getSelection();
        if (sel.rangeCount) _savedRange = sel.getRangeAt(0).cloneRange();
        const selectedText = sel.toString();
        document.getElementById('link-text').value = selectedText || '';
        document.getElementById('link-url').value = '';
      }
      document.getElementById('modal-link').classList.add('open');
    }

    function applyLink() {
      const text = document.getElementById('link-text').value.trim();
      const url = document.getElementById('link-url').value.trim();
      const target = document.getElementById('link-target').value;
      if (!url) { toast('Nhập URL!', 'err'); return; }

      const doc = getVeDoc();
      if (doc && doc.designMode === 'on') {
        doc.body.focus();
        if (_savedRange) {
          const sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(_savedRange);
        }
        const html = `<a href="${url}" target="${target}">${text || url}</a>`;
        doc.execCommand('insertHTML', false, html);
        syncVisualToCode();
      } else {
        insertTmplVar(`<a href="${url}" target="${target}">${text || url}</a>`);
      }
      closeModal('modal-link');
    }

    // ── Image dialog ─────────────────────────
    function previewImg() {
      const url = document.getElementById('img-url').value.trim();
      const wrap = document.getElementById('img-preview-wrap');
      const img = document.getElementById('img-preview');
      if (url) { img.src = url; wrap.style.display = ''; }
      else { wrap.style.display = 'none'; }
    }

    function loadImgFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('img-url').value = ev.target.result;
        previewImg();
      };
      reader.readAsDataURL(file);
    }

    function applyImage() {
      const url = document.getElementById('img-url').value.trim();
      const alt = document.getElementById('img-alt').value.trim() || '';
      const width = document.getElementById('img-width').value;
      if (!url) { toast('Chọn ảnh hoặc nhập URL!', 'err'); return; }

      const style = `max-width:100%;width:${width};height:auto;display:block;${width === 'center' ? 'margin:0 auto' : ''}`;
      const html = `<img src="${url}" alt="${alt}" style="${style}">`;

      const doc = getVeDoc();
      if (doc && doc.designMode === 'on') {
        doc.body.focus();
        doc.execCommand('insertHTML', false, html);
        syncVisualToCode();
      } else { insertTmplVar(html); }
      closeModal('modal-image');
    }

    function openImageDialog() {
      document.getElementById('img-url').value = '';
      document.getElementById('img-alt').value = '';
      document.getElementById('img-preview-wrap').style.display = 'none';
      document.getElementById('modal-image').classList.add('open');
    }

    // ── Button dialog ─────────────────────────
    function openButtonDialog() {
      document.getElementById('btn-text').value = 'Bấm vào đây';
      document.getElementById('btn-url').value = 'https://';
      updateBtnPreview();
      document.getElementById('modal-button').classList.add('open');
    }

    function updateBtnPreview() {
      const text = document.getElementById('btn-text').value || 'Button';
      const bg = document.getElementById('btn-bg').value;
      const color = document.getElementById('btn-color').value;
      const radius = document.getElementById('btn-radius').value + 'px';
      const size = document.getElementById('btn-size').value + 'px';
      const align = document.getElementById('btn-align').value;
      document.getElementById('btn-preview-area').style.textAlign = align;
      document.getElementById('btn-preview-area').innerHTML =
        `<a style="display:inline-block;padding:12px 28px;background:${bg};color:${color};text-decoration:none;border-radius:${radius};font-size:${size};font-weight:600;font-family:Arial,sans-serif">${text}</a>`;
    }

    function applyButton() {
      const text = document.getElementById('btn-text').value.trim() || 'Button';
      const url = document.getElementById('btn-url').value.trim();
      const bg = document.getElementById('btn-bg').value;
      const color = document.getElementById('btn-color').value;
      const radius = document.getElementById('btn-radius').value + 'px';
      const size = document.getElementById('btn-size').value + 'px';
      const align = document.getElementById('btn-align').value;
      if (!url) { toast('Nhập URL cho button!', 'err'); return; }

      const html = `<div style="text-align:${align};margin:16px 0">
  <a href="${url}" target="_blank" style="display:inline-block;padding:12px 28px;background:${bg};color:${color};text-decoration:none;border-radius:${radius};font-size:${size};font-weight:600;font-family:Arial,sans-serif">${text}</a>
</div>`;

      const doc = getVeDoc();
      if (doc && doc.designMode === 'on') {
        doc.body.focus();
        doc.execCommand('insertHTML', false, html);
        syncVisualToCode();
      } else { insertTmplVar(html); }
      closeModal('modal-button');
    }

    function insertTmplVar(v) {
      const mode = editorMode;
      if ((mode === 'visual' || mode === 'split') && _veReady) {
        const doc = getVeDoc();
        if (doc) { doc.body.focus(); doc.execCommand('insertHTML', false, v); syncVisualToCode(); return; }
      }
      const ta = document.getElementById('tmpl-code');
      const s = ta.selectionStart;
      ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + v.length;
      ta.focus();
    }

    function uploadTemplateFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        const content = ev.target.result;
        const name = file.name.replace(/\.(html?|txt)$/i, '');
        document.getElementById('tmpl-code').value = content;
        document.getElementById('tmpl-name-input').value = name;
        activeTemplate = null;
        _veReady = false; // force reinit visual editor
        if (editorMode === 'visual' || editorMode === 'split') {
          initVisualEditor(content);
        }
        updatePreview();
        renderTemplates();
        toast(`Đã tải file: ${file.name}`);
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    }

    function newBlankTemplate() {
      activeTemplate = null;
      document.getElementById('tmpl-code').value = 'Xin chào {{name}},\n\n[Nội dung của bạn]\n\nTrân trọng,\nUCMAS Vietnam';
      document.getElementById('tmpl-name-input').value = 'Template mới';
      updatePreview(); renderTemplates();
    }

    async function saveCurrentTemplate() {
      const name = document.getElementById('tmpl-name-input').value.trim() || 'Template mới';
      const body = document.getElementById('tmpl-code').value;

      if (activeTemplate) {
        // Update existing
        const t = templates.find(x => x.id === activeTemplate);
        if (t) {
          t.name = name; t.body = body;
          if (window._backendConnected) {
            try { await apiFetch(`/api/templates?id=${t.id}`, { method: 'PUT', body: JSON.stringify({ name, body }) }); }
            catch (e) { toast('Lỗi lưu: ' + e.message, 'err'); }
          }
          toast(`Đã lưu: ${name}`);
        }
      } else {
        // Create new
        if (window._backendConnected) {
          try {
            const result = await apiFetch('/api/templates', {
              method: 'POST',
              body: JSON.stringify({ name, icon: '📄', description: 'Template tuỳ chỉnh', body, tags: ['custom'] }),
            });
            if (result) { templates.push(result); activeTemplate = result.id; }
          } catch (e) { toast('Lỗi tạo template: ' + e.message, 'err'); }
        } else {
          const id = 't' + Date.now();
          templates.push({ id, name, icon: '📄', desc: 'Template tuỳ chỉnh', tags: ['custom'], body });
          activeTemplate = id;
        }
        toast(`Đã lưu template mới: ${name}`);
      }
      renderTemplates();
    }

    function onSenderChange() {
      const val = document.getElementById('c-sender').value;
      const [email, name] = val.split('|');
      document.getElementById('c-from').value = name || 'UCMAS Vietnam';
      // If email contains @, it's a custom email; otherwise use default
      document.getElementById('c-from-email').value = email.includes('@') ? email : '';
    }

    function loadTemplateIntoCampaign(id) {
      if (!id) return;
      const t = templates.find(x => x.id === id);
      if (!t) return;
      document.getElementById('c-body').value = t.body;
      document.getElementById('c-name').placeholder = t.name;
      updateCampaignPreview();
      toast(`Đã tải: ${t.name}`);
    }

    // Campaign body: Code / Preview tabs
    function setCampaignBodyTab(tab) {
      document.getElementById('c-tab-code').classList.toggle('active', tab === 'code');
      document.getElementById('c-tab-preview').classList.toggle('active', tab === 'preview');
      document.getElementById('c-body-code-wrap').style.display = tab === 'code' ? '' : 'none';
      document.getElementById('c-body-preview-wrap').style.display = tab === 'preview' ? '' : 'none';
      if (tab === 'preview') updateCampaignPreview();
    }

    function updateCampaignPreview() {
      const code = document.getElementById('c-body').value;
      renderEmailPreview(code, document.getElementById('c-preview-frame'));
    }

    // ════════════════════════════════════════
    // WORKFLOW BUILDER
    // ════════════════════════════════════════
    let workflows = [];
    let activeWorkflow = null;

    const WF_NODE_TYPES = {
      trigger: { icon: '⚡', label: 'Trigger', color: 'trigger' },
      email:   { icon: '✉', label: 'Gửi Email', color: 'email' },
      wait:    { icon: '⏱', label: 'Chờ / Delay', color: 'wait' },
      condition: { icon: '🔀', label: 'Điều kiện', color: 'condition' },
    };

    function updateWfBadges() {
      const badge = document.getElementById('sb-cnt-wf');
      if (badge) badge.textContent = workflows.length;
      const cnt = document.getElementById('wf-count');
      if (cnt) cnt.textContent = workflows.length;
    }

    function renderWorkflowList() {
      const list = document.getElementById('wf-list');
      if (!list) return;
      updateWfBadges();
      list.innerHTML = workflows.map(wf => `
        <div class="wf-card ${activeWorkflow === wf.id ? 'active-wf' : ''}" onclick="openWorkflow('${wf.id}')">
          <div class="wf-card-name">${wf.name}</div>
          <div class="wf-card-meta">
            <span class="wf-card-status ${wf.status}">${wf.status}</span>
            <span>${wf.nodes.length} bước</span>
          </div>
        </div>`).join('') || '<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px">Chưa có workflow nào</div>';
    }

    async function createWorkflow() {
      const wfData = {
        name: 'Workflow mới',
        status: 'draft',
        nodes: [
          { id: 'n_' + Date.now(), type: 'trigger', config: { triggerType: 'tag_assigned', tag: '' } }
        ],
      };
      try {
        if (window._backendConnected) {
          const wf = await apiFetch('/api/workflows', {
            method: 'POST', body: JSON.stringify(wfData),
          });
          workflows.push(wf);
          activeWorkflow = wf.id;
        } else {
          const wf = { ...wfData, id: 'wf_' + Date.now() };
          workflows.push(wf);
          activeWorkflow = wf.id;
        }
        renderWorkflowList();
        openWorkflow(activeWorkflow);
        toast('Đã tạo workflow mới');
      } catch (e) { toast('Lỗi tạo workflow: ' + e.message, 'err'); }
    }

    function openWorkflow(id) {
      activeWorkflow = id;
      const wf = workflows.find(w => w.id === id);
      if (!wf) return;
      document.getElementById('wf-empty').style.display = 'none';
      document.getElementById('wf-editor').style.display = '';
      document.getElementById('wf-name').value = wf.name;
      document.getElementById('wf-status').value = wf.status;
      renderWorkflowList();
      renderWorkflowFlow();
    }

    async function saveWorkflow() {
      const wf = workflows.find(w => w.id === activeWorkflow);
      if (!wf) return;
      wf.name = document.getElementById('wf-name').value.trim() || 'Workflow';
      wf.status = document.getElementById('wf-status').value;
      // Save node configs from DOM
      wf.nodes.forEach(node => {
        const el = document.getElementById('wfn-' + node.id);
        if (!el) return;
        if (node.type === 'trigger') {
          node.config.triggerType = el.querySelector('[data-cfg=triggerType]')?.value || 'tag_assigned';
          node.config.tag = el.querySelector('[data-cfg=tag]')?.value || '';
          node.config.level = el.querySelector('[data-cfg=level]')?.value || '';
        } else if (node.type === 'email') {
          node.config.templateId = el.querySelector('[data-cfg=templateId]')?.value || '';
          node.config.subject = el.querySelector('[data-cfg=subject]')?.value || '';
        } else if (node.type === 'wait') {
          node.config.delay = parseInt(el.querySelector('[data-cfg=delay]')?.value) || 1;
          node.config.unit = el.querySelector('[data-cfg=unit]')?.value || 'hours';
        } else if (node.type === 'condition') {
          node.config.condType = el.querySelector('[data-cfg=condType]')?.value || 'opened';
        }
      });
      try {
        if (window._backendConnected) {
          await apiFetch(`/api/workflows?id=${wf.id}`, {
            method: 'PUT', body: JSON.stringify({ name: wf.name, status: wf.status, nodes: wf.nodes }),
          });
        }
        updateWfBadges();
        renderWorkflowList();
        toast(`Đã lưu: ${wf.name}`);
      } catch (e) { toast('Lỗi lưu: ' + e.message, 'err'); }
    }

    function updateWfStatus() {
      const wf = workflows.find(w => w.id === activeWorkflow);
      if (wf) { wf.status = document.getElementById('wf-status').value; updateWfBadges(); renderWorkflowList(); }
    }

    async function deleteWorkflow() {
      const wf = workflows.find(w => w.id === activeWorkflow);
      if (!wf || !confirm(`Xoá workflow "${wf.name}"?`)) return;
      try {
        if (window._backendConnected) {
          const res = await fetch(API + `/api/workflows?id=${wf.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...cfgHeaders() },
          });
          if (!res.ok) throw new Error('Lỗi server');
        }
        workflows = workflows.filter(w => w.id !== activeWorkflow);
        activeWorkflow = null;
        document.getElementById('wf-editor').style.display = 'none';
        document.getElementById('wf-empty').style.display = '';
        updateWfBadges();
        renderWorkflowList();
        toast('Đã xoá workflow');
      } catch (e) { toast('Lỗi xoá: ' + e.message, 'err'); }
    }

    function addWfNode(type, afterIdx) {
      const wf = workflows.find(w => w.id === activeWorkflow);
      if (!wf) return;
      const defaults = {
        trigger: { triggerType: 'tag_assigned', tag: '', level: '' },
        email: { templateId: '', subject: '' },
        wait: { delay: 1, unit: 'hours' },
        condition: { condType: 'opened' },
      };
      const node = { id: 'n_' + Date.now(), type, config: defaults[type] || {} };
      if (afterIdx !== undefined) wf.nodes.splice(afterIdx + 1, 0, node);
      else wf.nodes.push(node);
      updateWfBadges();
      renderWorkflowFlow();
      document.getElementById('wf-add-menu')?.classList.remove('open');
    }

    function removeWfNode(nodeId) {
      const wf = workflows.find(w => w.id === activeWorkflow);
      if (!wf) return;
      if (wf.nodes.length <= 1) { toast('Workflow cần ít nhất 1 node', 'err'); return; }
      wf.nodes = wf.nodes.filter(n => n.id !== nodeId);
      updateWfBadges();
      renderWorkflowFlow();
    }

    function renderNodeBody(node) {
      const c = node.config || {};
      if (node.type === 'trigger') {
        const levelOpts = (typeof levels !== 'undefined' ? levels : []).map(l =>
          `<option value="${l.id}" ${c.level === l.id ? 'selected' : ''}>${l.name}</option>`
        ).join('');
        return `
          <label>Loại trigger</label>
          <select data-cfg="triggerType">
            <option value="tag_assigned" ${c.triggerType === 'tag_assigned' ? 'selected' : ''}>Gắn tag / Level</option>
            <option value="manual" ${c.triggerType === 'manual' ? 'selected' : ''}>Thủ công</option>
            <option value="contact_added" ${c.triggerType === 'contact_added' ? 'selected' : ''}>Contact mới thêm</option>
          </select>
          <label>Level / Tag</label>
          <select data-cfg="level"><option value="">— Chọn level —</option>${levelOpts}</select>`;
      }
      if (node.type === 'email') {
        const tmplOpts = (typeof templates !== 'undefined' ? templates : []).map(t =>
          `<option value="${t.id}" ${c.templateId === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`
        ).join('');
        return `
          <label>Template email</label>
          <select data-cfg="templateId"><option value="">— Chọn template —</option>${tmplOpts}</select>
          <label>Subject (tuỳ chỉnh)</label>
          <input data-cfg="subject" value="${c.subject || ''}" placeholder="Để trống = dùng subject mặc định">`;
      }
      if (node.type === 'wait') {
        return `
          <label>Thời gian chờ</label>
          <div style="display:flex;gap:6px">
            <input data-cfg="delay" type="number" min="1" value="${c.delay || 1}" style="width:80px">
            <select data-cfg="unit" style="width:auto">
              <option value="minutes" ${c.unit === 'minutes' ? 'selected' : ''}>Phút</option>
              <option value="hours" ${c.unit === 'hours' ? 'selected' : ''}>Giờ</option>
              <option value="days" ${c.unit === 'days' ? 'selected' : ''}>Ngày</option>
            </select>
          </div>`;
      }
      if (node.type === 'condition') {
        return `
          <label>Điều kiện</label>
          <select data-cfg="condType">
            <option value="opened" ${c.condType === 'opened' ? 'selected' : ''}>Email được mở</option>
            <option value="clicked" ${c.condType === 'clicked' ? 'selected' : ''}>Có click link</option>
            <option value="not_opened" ${c.condType === 'not_opened' ? 'selected' : ''}>Không mở email</option>
          </select>
          <div style="margin-top:8px;font-size:10.5px;color:var(--muted)">
            ✓ Đúng → tiếp tục flow bên dưới<br>
            ✕ Sai → dừng workflow cho contact này
          </div>`;
      }
      return '';
    }

    function renderWorkflowFlow() {
      const wf = workflows.find(w => w.id === activeWorkflow);
      const flow = document.getElementById('wf-flow');
      if (!wf || !flow) return;

      flow.innerHTML = wf.nodes.map((node, idx) => {
        const t = WF_NODE_TYPES[node.type] || {};
        const isFirst = idx === 0;
        return `
          ${idx > 0 ? '<div class="wf-connector"></div>' : ''}
          <div class="wf-node wf-type-${t.color}" id="wfn-${node.id}">
            ${!isFirst ? `<button class="wf-node-del" onclick="removeWfNode('${node.id}')" title="Xoá">✕</button>` : ''}
            <div class="wf-node-hd">
              <div class="wf-node-icon">${t.icon}</div>
              <span>${t.label}</span>
              <span style="margin-left:auto;font-size:10px;opacity:.5">#${idx + 1}</span>
            </div>
            <div class="wf-node-body">${renderNodeBody(node)}</div>
          </div>
          ${idx < wf.nodes.length - 1 ? '' : `
            <div class="wf-connector"></div>
            <div style="position:relative">
              <button class="wf-add-node" onclick="toggleAddMenu(this)" title="Thêm bước">+</button>
              <div class="wf-add-menu" id="wf-add-menu">
                <div class="wf-add-opt" onclick="addWfNode('email',${idx})">✉ Gửi Email</div>
                <div class="wf-add-opt" onclick="addWfNode('wait',${idx})">⏱ Chờ / Delay</div>
                <div class="wf-add-opt" onclick="addWfNode('condition',${idx})">🔀 Điều kiện</div>
              </div>
            </div>
          `}`;
      }).join('');
    }

    function toggleAddMenu(btn) {
      const menu = btn.nextElementSibling;
      if (menu) menu.classList.toggle('open');
      // Close on click outside
      setTimeout(() => {
        document.addEventListener('click', function closer(e) {
          if (!menu.contains(e.target) && e.target !== btn) {
            menu.classList.remove('open');
            document.removeEventListener('click', closer);
          }
        });
      }, 10);
    }

    // Init workflows on page load
    async function initWorkflows() {
      if (window._backendConnected) {
        try {
          const data = await apiFetch('/api/workflows');
          workflows = data || [];
        } catch (e) {
          console.warn('Workflows API not available, using empty list');
          workflows = [];
        }
      }
      renderWorkflowList();
    }

    // ════════════════════════════════════════
    // SCHEDULE
    // ════════════════════════════════════════
    function toggleSchedule() {
      const checked = document.getElementById('c-schedule-check').checked;
      document.getElementById('c-schedule-wrap').style.display = checked ? '' : 'none';
      const btn = document.getElementById('btn-send-campaign');
      btn.innerHTML = checked ? '⏰ Lên lịch gửi' : '✉ Send Campaign';
      if (checked) {
        // Set default time to 1 hour from now
        const d = new Date(Date.now() + 3600000);
        const local = d.toISOString().slice(0, 16);
        document.getElementById('c-schedule-time').value = local;
      }
    }

    // ════════════════════════════════════════
    // CONTACT EMAIL HISTORY
    // ════════════════════════════════════════
    async function viewContactHistory(email, name) {
      document.getElementById('ch-contact-name').textContent = name;
      document.getElementById('ch-contact-email').textContent = email;
      document.getElementById('ch-history-list').innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">Đang tải...</div>';
      document.getElementById('modal-contact-history').classList.add('open');

      try {
        const logs = await apiFetch(`/api/campaigns?contact_email=${encodeURIComponent(email)}`);
        if (!logs || !logs.length) {
          document.getElementById('ch-history-list').innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">Chưa nhận email nào</div>';
          return;
        }

        const eventIcons = {
          sent: { icon: '📤', label: 'Đã gửi', color: 'var(--accent2)' },
          delivered: { icon: '✅', label: 'Đã nhận', color: 'var(--ok)' },
          opened: { icon: '👁', label: 'Đã mở', color: '#60a5fa' },
          clicked: { icon: '🔗', label: 'Đã click', color: '#a78bfa' },
          bounced: { icon: '⛔', label: 'Bounced', color: 'var(--err)' },
          complained: { icon: '🚫', label: 'Spam', color: 'var(--err)' },
          delayed: { icon: '⏳', label: 'Trì hoãn', color: 'var(--warn)' },
        };

        document.getElementById('ch-history-list').innerHTML = logs.map(l => {
          const date = l.sent_at ? new Date(l.sent_at).toLocaleString('vi-VN') : '—';
          const isFailed = l.status === 'failed';

          // Tracking events timeline
          const tracking = l.tracking || [];
          const bestEvent = tracking.length > 0
            ? (['clicked', 'opened', 'delivered', 'bounced', 'complained'].find(t => tracking.some(e => e.event_type === t)) || 'sent')
            : (isFailed ? 'failed' : 'sent');
          const best = eventIcons[bestEvent] || eventIcons.sent;

          const eventsHtml = tracking.length > 0
            ? tracking.map(ev => {
                const info = eventIcons[ev.event_type] || { icon: '•', label: ev.event_type, color: 'var(--muted)' };
                const evDate = ev.created_at ? new Date(ev.created_at).toLocaleString('vi-VN') : '';
                return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:${info.color};margin-right:8px" title="${evDate}">
                  ${info.icon} ${info.label}
                </span>`;
              }).join('')
            : '<span style="font-size:10px;color:var(--muted)">Chưa có tracking data</span>';

          return `<div class="h-item" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div class="h-icon ${isFailed ? 'err' : 'ok'}" style="width:36px;height:36px;font-size:16px">${best.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${l.campaign_name || 'Campaign'}</div>
              <div style="font-size:11px;color:var(--muted);margin:2px 0">${date}</div>
              <div style="margin-top:4px">${eventsHtml}</div>
            </div>
            <span style="font-size:11px;font-weight:600;color:${best.color};white-space:nowrap">${best.label}</span>
          </div>`;
        }).join('');
      } catch (e) {
        document.getElementById('ch-history-list').innerHTML =
          `<div style="padding:20px;text-align:center;color:var(--err)">Lỗi: ${e.message}</div>`;
      }
    }

    // ════════════════════════════════════════
    // CAMPAIGN
    // ════════════════════════════════════════
    function renderCampaignTargets() {
      const container = document.getElementById('campaign-level-targets');
      if (!container) return;
      const roots = getRootLevels();
      container.innerHTML = roots.map(r => {
        const children = getChildren(r.id);
        const sel = selectedLevels[r.id];
        const cls = sel ? `sl${levels.indexOf(r) % 4 + 1}` : '';
        return `<div class="ltr ${cls}" id="ct-${r.id}" onclick="toggleCampaignLevel('${r.id}')">
      <div class="lck" style="${sel ? `background:${r.color};border-color:${r.color};color:#000` : ''}">✓</div>
      <div class="li">
        <div class="ln">${r.name}</div>
        <div class="ld">${r.desc || 'Phân cấp khách hàng'} ${children.length > 0 ? `<span style="color:var(--muted);font-size:10.5px">+ ${children.length} sub</span>` : ''}</div>
      </div>
      <div class="lc" style="${sel ? `color:${r.color}` : ''}">
        ${r.count + children.reduce((s, c) => s + c.count, 0)}
      </div>
    </div>`;
      }).join('');
      updateCampaignSummary();
      // also render template picker
      renderTemplates();
    }

    function toggleCampaignLevel(id) {
      selectedLevels[id] = !selectedLevels[id];
      renderCampaignTargets();
    }

    function updateCampaignSummary() {
      let total = 0;
      const segs = [];
      getRootLevels().forEach(r => {
        if (selectedLevels[r.id]) {
          total += r.count + getChildren(r.id).reduce((s, c) => s + c.count, 0);
          segs.push(r.name);
        }
      });
      document.getElementById('s-total').textContent = total;
      document.getElementById('s-segs').textContent = segs.join(', ') || '—';
      document.getElementById('c-total-label').textContent = total + ' recipients';
      document.getElementById('s-time').textContent = total ? '~' + Math.ceil(total * 0.2) + 's' : '—';
    }

    function insertCampaignVar(v) {
      const ta = document.getElementById('c-body');
      const s = ta.selectionStart;
      ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + v.length; ta.focus();
    }

    // ════════════════════════════════════════
    // SEND
    // ════════════════════════════════════════
    function startSend() {
      const segs = Object.entries(selectedLevels).filter(([k, v]) => v);
      if (!segs.length) { toast('Chọn ít nhất 1 level!', 'err'); return; }
      const prog = document.getElementById('send-progress');
      prog.classList.add('active');
      prog.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const steps = ['ps1', 'ps2', 'ps3', 'ps4'];
      let i = 0;
      function next() {
        if (i > 0) document.getElementById(steps[i - 1]).className = 'pstep done';
        if (i < steps.length) {
          document.getElementById(steps[i]).className = 'pstep run'; i++;
          const pct = Math.round((i / (steps.length + 1)) * 100);
          document.getElementById('prog-fill').style.width = pct + '%';
          document.getElementById('prog-pct').textContent = pct + '%';
          setTimeout(next, 850 + Math.random() * 350);
        } else {
          document.getElementById('prog-fill').style.width = '100%';
          document.getElementById('prog-pct').textContent = '100%';
          steps.forEach(s => document.getElementById(s).className = 'pstep done');
          setTimeout(() => { prog.classList.remove('active'); toast('Campaign đã gửi thành công!'); gotoPage('history'); }, 600);
        }
      }
      next();
    }

    // ════════════════════════════════════════
    // FILE UPLOAD
    // ════════════════════════════════════════
    // handleUpload: xem phiên bản thật ở phần backend override bên dưới
    function handleDrop(e) {
      e.preventDefault();
      document.getElementById('upload-zone').classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleUpload({ target: { files: [file] } });
    }

    // ════════════════════════════════════════
    // DATABASE PAGE
    // ════════════════════════════════════════
    function gotoDbPanel(panel) {
      document.querySelectorAll('.db-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.db-step-btn').forEach(b => b.classList.remove('active'));
      const p = document.getElementById('dbpanel-' + panel);
      if (p) p.classList.add('active');
      const b = document.getElementById('dbstep-' + panel);
      if (b) b.classList.add('active');
    }

    function switchSqlTab(tab) {
      ['tables', 'indexes', 'rls-sql', 'seed'].forEach(t => {
        const el = document.getElementById('sql-' + t);
        const btn = document.getElementById('sqltab-' + t.replace('-sql', ''));
        if (el) el.style.display = (t === tab) ? '' : 'none';
        if (btn) btn.classList.toggle('active', t === tab);
      });
      // fix tab button IDs that differ
      document.querySelectorAll('.db-tab').forEach(b => b.classList.remove('active'));
      const mapping = { tables: 'sqltab-tables', indexes: 'sqltab-indexes', 'rls-sql': 'sqltab-rls', seed: 'sqltab-seed' };
      const activebtn = document.getElementById(mapping[tab]);
      if (activebtn) activebtn.classList.add('active');
    }

    function copyCode(id) {
      const el = document.getElementById(id);
      if (!el) return;
      navigator.clipboard.writeText(el.textContent).then(() => {
        const btn = el.closest('.code-block')?.querySelector('.code-block-copy');
        if (btn) { btn.textContent = '✓ Copied!'; btn.style.color = 'var(--ok)'; setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = '' }, 2000); }
      });
    }

    function copyAllSQL() {
      const ids = ['sql-tables-code', 'sql-idx-code', 'sql-rls-code', 'sql-seed-code'];
      const all = ids.map(id => { const e = document.getElementById(id); return e ? e.textContent : ''; }).join('\n\n');
      navigator.clipboard.writeText(all).then(() => toast('Đã copy toàn bộ SQL script!'));
    }

    function saveEnv() {
      const fields = { url: 'env-sb-url', anon: 'env-sb-anon', service: 'env-sb-service', resend: 'env-resend', from: 'env-from' };
      Object.entries(fields).forEach(([k, id]) => {
        const val = document.getElementById(id)?.value || '';
        const preview = document.getElementById('ep-' + k);
        if (preview && val) preview.textContent = val;
      });
    }

    function copyEnvFile() {
      const get = id => document.getElementById(id)?.value || document.getElementById(id.replace('env-', 'ep-'))?.textContent || '';
      const content = `# Supabase
NEXT_PUBLIC_SUPABASE_URL=${get('env-sb-url')}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${get('env-sb-anon')}
SUPABASE_SERVICE_ROLE_KEY=${get('env-sb-service')}

# Resend
RESEND_API_KEY=${get('env-resend')}
FROM_EMAIL=${get('env-from')}

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000`;
      navigator.clipboard.writeText(content).then(() => toast('Đã copy .env.local!'));
    }

    function testDbConnection() {
      const url = document.getElementById('env-sb-url')?.value.trim();
      const key = document.getElementById('env-sb-anon')?.value.trim();
      const dot = document.getElementById('db-dot');
      const txt = document.getElementById('db-status-text');
      const sub = document.getElementById('db-status-sub');
      const btn = document.getElementById('db-test-btn');

      if (!url || !key) {
        dot.className = 'db-conn-dot disconnected';
        txt.textContent = 'Thiếu thông tin kết nối';
        sub.textContent = 'Vào Step 5 (Env Variables) → điền Supabase URL và Anon Key';
        toast('Nhập Supabase URL và Anon Key ở bước 5 trước!', 'err');
        gotoDbPanel('env');
        return;
      }

      dot.className = 'db-conn-dot pending';
      txt.textContent = 'Đang kết nối...';
      sub.textContent = 'Kiểm tra Supabase...';
      btn.textContent = 'Đang kiểm tra...';
      btn.disabled = true;

      fetch(`${url}/rest/v1/levels?select=id&limit=1`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
      }).then(r => {
        btn.textContent = 'Test Connection'; btn.disabled = false;
        if (r.ok) {
          dot.className = 'db-conn-dot connected';
          txt.textContent = '✓ Kết nối thành công!';
          sub.textContent = `Supabase: ${url}`;
          toast('Supabase kết nối thành công!');
          document.getElementById('dbstep-setup').classList.add('done');
          document.getElementById('dbstep-schema').classList.add('done');
          document.getElementById('dbstep-sql').classList.add('done');
          document.getElementById('dbstep-connect').classList.add('done');
          document.getElementById('dbstep-env').classList.add('done');
        } else {
          dot.className = 'db-conn-dot disconnected';
          txt.textContent = `Lỗi kết nối (HTTP ${r.status})`;
          sub.textContent = r.status === 404 ? 'Table "levels" chưa tồn tại — chạy SQL script ở Step 3' : 'Kiểm tra lại URL và API Key';
          toast(`Kết nối thất bại: HTTP ${r.status}`, 'err');
        }
      }).catch(e => {
        btn.textContent = 'Test Connection'; btn.disabled = false;
        dot.className = 'db-conn-dot disconnected';
        txt.textContent = 'Không thể kết nối';
        sub.textContent = 'Kiểm tra URL Supabase hoặc kết nối internet';
        toast('Lỗi mạng — kiểm tra URL và internet', 'err');
      });
    }


    function init() {
      // Chỉ render skeleton UI, không render data — tránh flash mock data
      renderSidebar();
      renderDashStats();
      renderFilterChips();
      renderContactTable();
      renderTemplates();
      renderCampaignTargets();
    }
    // KHÔNG gọi init() ở đây — gọi sau khi load data thật từ backend

    // ════════════════════════════════════════
    // ════════════════════════════════════════
    // GRAPESJS BUILDER
    // ════════════════════════════════════════
    let _gjsEditor = null;
    let _gjsLoaded = false;

    function loadGrapeJS() {
      return new Promise((resolve) => {
        if (_gjsLoaded) { resolve(); return; }
        const s1 = document.createElement('script');
        s1.src = 'https://unpkg.com/grapesjs';
        s1.onload = () => {
          const s2 = document.createElement('script');
          s2.src = 'https://unpkg.com/grapesjs-preset-newsletter';
          s2.onload = () => { _gjsLoaded = true; resolve(); };
          document.head.appendChild(s2);
        };
        document.head.appendChild(s1);
      });
    }

    async function openBuilder() {
      const overlay = document.getElementById('gjs-overlay');
      overlay.classList.remove('hidden');

      // Điền tên template hiện tại
      const tmplName = document.getElementById('tmpl-name-input')?.value || '';
      document.getElementById('gjs-tmpl-name').value = tmplName;

      // Load GrapeJS nếu chưa có
      if (!_gjsEditor) {
        const loading = document.getElementById('gjs');
        loading.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5e6585;font-size:14px">⟳ Đang tải editor...</div>';
        await loadGrapeJS();
        initGrapeJS();
      }

      // Load nội dung template hiện tại vào builder
      const currentHtml = document.getElementById('tmpl-code')?.value || '';
      if (_gjsEditor && currentHtml) {
        _gjsEditor.setComponents(currentHtml);
      }
    }

    function initGrapeJS() {
      _gjsEditor = grapesjs.init({
        container: '#gjs',
        height: '100%',
        storageManager: false, // không dùng storage local của GrapeJS
        plugins: ['gjs-preset-newsletter'],
        pluginsOpts: {
          'gjs-preset-newsletter': {
            modalLabelImport: 'Paste HTML',
            modalLabelExport: 'Copy HTML',
            codeViewerTheme: 'material',
            inlineCss: true,
          }
        },
        deviceManager: {
          devices: [
            { name: 'Desktop', width: '' },
            { name: 'Tablet', width: '768px', widthMedia: '768px' },
            { name: 'Mobile portrait', width: '375px', widthMedia: '480px' },
          ]
        },
        canvas: {
          styles: [
            'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap'
          ]
        },
        styleManager: {
          appendTo: '.gjs-pn-views-container',
        },
        blockManager: {
          appendTo: '#gjs-blocks',
        },
      });

      // Thêm các blocks email chuẩn responsive
      addEmailBlocks(_gjsEditor);
    }

    function addEmailBlocks(editor) {
      const bm = editor.BlockManager;

      bm.add('ucmas-section', {
        label: '📦 Section',
        category: 'Layout',
        content: `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
      <tr><td style="padding:20px;background:#ffffff">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:15px;color:#333">Nhập nội dung tại đây...</p>
      </td></tr>
    </table>`,
      });

      bm.add('ucmas-2col', {
        label: '⊞ 2 cột',
        category: 'Layout',
        content: `<table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="padding:16px;background:#f9f9f9;vertical-align:top">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#333">Cột trái</p>
        </td>
        <td width="50%" style="padding:16px;background:#ffffff;vertical-align:top">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#333">Cột phải</p>
        </td>
      </tr>
    </table>`,
      });

      bm.add('ucmas-header', {
        label: '🏷 Header',
        category: 'Components',
        content: `<table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 24px;background:#4f6cff;text-align:center">
        <h1 style="margin:0;font-family:Arial,sans-serif;font-size:28px;font-weight:700;color:#ffffff">UCMAS Vietnam</h1>
        <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,.8)">Thông báo quan trọng</p>
      </td></tr>
    </table>`,
      });

      bm.add('ucmas-button', {
        label: '🔘 Button CTA',
        category: 'Components',
        content: `<table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:24px;text-align:center">
        <a href="#" style="display:inline-block;padding:14px 32px;background:#4f6cff;color:#ffffff;text-decoration:none;border-radius:8px;font-family:Arial,sans-serif;font-size:15px;font-weight:600">Bấm vào đây</a>
      </td></tr>
    </table>`,
      });

      bm.add('ucmas-divider', {
        label: '➖ Divider',
        category: 'Components',
        content: `<table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:8px 24px"><hr style="border:none;border-top:1px solid #e0e0e0;margin:0"></td></tr>
    </table>`,
      });

      bm.add('ucmas-footer', {
        label: '🔻 Footer',
        category: 'Components',
        content: `<table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:24px;background:#f5f5f5;text-align:center">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#999">© 2025 UCMAS Vietnam. All rights reserved.</p>
        <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#aaa">
          <a href="#" style="color:#4f6cff;text-decoration:none">Hủy đăng ký</a> · <a href="#" style="color:#4f6cff;text-decoration:none">Chính sách bảo mật</a>
        </p>
      </td></tr>
    </table>`,
      });

      bm.add('ucmas-vars', {
        label: '🔤 Biến cá nhân',
        category: 'Components',
        content: `<table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:20px 24px;background:#fff">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:15px;color:#333">
          Xin chào <strong>{{name}}</strong>,<br><br>
          Đây là email dành cho khách hàng <strong>{{level}}</strong> của chúng tôi.
        </p>
      </td></tr>
    </table>`,
      });
    }

    function gjsSetDevice(device) {
      if (_gjsEditor) _gjsEditor.setDevice(device);
      const btns = ['Desktop', 'Tablet', 'Mobile portrait'];
      btns.forEach(d => {
        const btnKey = d === 'Mobile portrait' ? 'mobile' : d.toLowerCase();
        const btn = document.getElementById(`gjsBtn-${btnKey}`);
        if (btn) {
          btn.style.background = d === device ? '#4f6cff' : 'transparent';
          btn.style.color = d === device ? '#fff' : '#5e6585';
        }
      });
    }

    function gjsUndo() { _gjsEditor?.UndoManager.undo(); }
    function gjsRedo() { _gjsEditor?.UndoManager.redo(); }
    function gjsClearCanvas() {
      if (!confirm('Xoá toàn bộ nội dung builder?')) return;
      _gjsEditor?.setComponents('');
    }

    function closeBuilder() {
      document.getElementById('gjs-overlay').classList.add('hidden');
    }

    function saveFromBuilder() {
      if (!_gjsEditor) return;
      const name = document.getElementById('gjs-tmpl-name').value.trim() || 'Template Builder';
      // Lấy HTML đầy đủ (inline CSS cho email)
      const html = _gjsEditor.runCommand('gjs-get-inlined-html') || _gjsEditor.getHtml();
      const css = _gjsEditor.getCss();
      const fullHtml = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif}
  ${css}
  @media only screen and (max-width:480px){
    table{width:100%!important}
    td{display:block!important;width:100%!important;padding:12px!important}
    img{max-width:100%!important;height:auto!important}
  }
</style>
</head><body>
${html}
</body></html>`;

      // Đưa vào code editor
      document.getElementById('tmpl-name-input').value = name;
      document.getElementById('tmpl-code').value = fullHtml;
      activeTemplate = null; // coi như template mới

      closeBuilder();
      setEditorMode('split'); // hiện split để thấy kết quả
      toast(`✓ Đã lưu HTML từ Builder — bấm 💾 Lưu template để lưu vào Supabase`);
    }

    // QUICK ADD CONTACTS
    // ════════════════════════════════════════
    function openQuickAdd() {
      // Điền level options
      const sel = document.getElementById('qa-level');
      sel.innerHTML = '<option value="">— Chọn level —</option>' +
        levels.map(l => `<option value="${l.id}">${l.name}${l.parent ? ' (sub)' : ''}</option>`).join('');
      document.getElementById('qa-emails').value = '';
      document.getElementById('qa-preview').style.display = 'none';
      document.getElementById('modal-quick-add').classList.add('open');
    }

    function parseQuickAddLines() {
      const raw = document.getElementById('qa-emails').value.trim();
      if (!raw) return [];
      return raw.split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          const parts = line.split(',').map(p => p.trim());
          const email = parts[0] || '';
          const name = parts[1] || email.split('@')[0]; // fallback tên = phần trước @
          const company = parts[2] || '';
          return { email: email.toLowerCase(), name, company };
        })
        .filter(r => r.email.includes('@'));
    }

    function previewQuickAdd() {
      const rows = parseQuickAddLines();
      const levelId = document.getElementById('qa-level').value;
      const lv = getLevelById(levelId);

      if (!rows.length) { toast('Chưa nhập email nào hợp lệ!', 'err'); return; }

      const previewEl = document.getElementById('qa-preview');
      const listEl = document.getElementById('qa-preview-list');
      previewEl.style.display = '';
      listEl.innerHTML = rows.map(r => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--surface2);border-radius:7px;font-size:12.5px">
      <span style="flex:1;font-family:var(--fm)">${r.email}</span>
      <span style="color:var(--muted)">${r.name !== r.email.split('@')[0] ? r.name : ''}</span>
      ${lv ? `<span style="background:${hexToRgba(lv.color, .12)};color:${lv.color};padding:1px 8px;border-radius:10px;font-size:11px">${lv.name}</span>` : ''}
    </div>`).join('');
    }

    async function submitQuickAdd() {
      const rows = parseQuickAddLines();
      const levelId = document.getElementById('qa-level').value;

      if (!rows.length) { toast('Chưa nhập email nào hợp lệ!', 'err'); return; }
      if (!levelId) { toast('Chọn level trước!', 'err'); return; }

      const lv = getLevelById(levelId);
      const toUpsert = rows.map(r => ({
        name: r.name, email: r.email, company: r.company,
        level_id: levelId, status: 'active',
      }));

      try {
        const result = await apiFetch('/api/contacts?action=bulk', {
          method: 'POST',
          body: JSON.stringify({ contacts: toUpsert }),
        });
        toast(`✓ Đã thêm ${result.imported} contacts vào level ${lv?.name || ''}`);
        closeModal('modal-quick-add');
        // Reload contacts — dùng transformContact() để không drop tags
        clearCache();
        await loadContactsPage();
        scheduleRefresh();
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    }

    // ════════════════════════════════════════
    // GOOGLE SHEETS
    // ════════════════════════════════════════
    const SHEETS_KEY = 'ucmas_sheets';
    let _autoSyncTimer = null;

    function getSheetsConfig() {
      try { return JSON.parse(localStorage.getItem(SHEETS_KEY) || '{}'); } catch { return {}; }
    }

    function openSheetsModal() {
      const cfg = getSheetsConfig();
      document.getElementById('gs-import-url').value = cfg.importUrl || '';
      document.getElementById('gs-webhook-url').value = cfg.webhookUrl || '';
      updateAutoSyncBtn();
      document.getElementById('modal-sheets').classList.add('open');
    }

    function saveSheetSettings() {
      const cfg = {
        importUrl: document.getElementById('gs-import-url').value.trim(),
        webhookUrl: document.getElementById('gs-webhook-url').value.trim(),
        autoSync: getSheetsConfig().autoSync || false,
      };
      localStorage.setItem(SHEETS_KEY, JSON.stringify(cfg));
      closeModal('modal-sheets');
      toast('Đã lưu cài đặt Google Sheets');
    }

    // ── Import contacts từ Google Sheet ────
    async function importFromSheets() {
      const url = document.getElementById('gs-import-url').value.trim() || getSheetsConfig().importUrl;
      if (!url) { toast('Nhập URL Google Sheet trước!', 'err'); return; }

      const btn = document.querySelector('#modal-sheets .btn-primary');
      if (btn) { btn.textContent = 'Đang đồng bộ...'; btn.disabled = true; }

      try {
        // Dùng api proxy để tránh CORS
        const res = await fetch('/api/sheets-proxy?url=' + encodeURIComponent(url), {
          headers: cfgHeaders(), signal: AbortSignal.timeout(15000),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        toast(`Đồng bộ xong: ${json.data.imported} contacts, ${json.data.skipped} bỏ qua`);

        // Reload contacts — dùng transformContact() để không drop tags
        clearCache();
        await loadContactsPage();
        scheduleRefresh();

        // Lưu URL
        const cfg = getSheetsConfig();
        cfg.importUrl = url;
        cfg.lastSync = new Date().toLocaleString('vi-VN');
        localStorage.setItem(SHEETS_KEY, JSON.stringify(cfg));

      } catch (e) { toast('Lỗi đồng bộ: ' + e.message, 'err'); }
      finally {
        if (btn) { btn.textContent = '↓ Đồng bộ ngay'; btn.disabled = false; }
      }
    }

    // ── Auto-sync ───────────────────────────
    function toggleAutoSync() {
      const cfg = getSheetsConfig();
      cfg.autoSync = !cfg.autoSync;
      localStorage.setItem(SHEETS_KEY, JSON.stringify(cfg));
      updateAutoSyncBtn();
      if (cfg.autoSync) {
        startAutoSync();
        toast('Tự động đồng bộ mỗi 5 phút');
      } else {
        if (_autoSyncTimer) clearInterval(_autoSyncTimer);
        toast('Đã tắt tự động đồng bộ', 'warn');
      }
    }

    function updateAutoSyncBtn() {
      const cfg = getSheetsConfig();
      const btn = document.getElementById('btn-autosync');
      if (!btn) return;
      btn.textContent = cfg.autoSync ? '⟳ Tự động (bật)' : '⟳ Tự động (tắt)';
      btn.style.color = cfg.autoSync ? 'var(--ok)' : '';
      btn.style.borderColor = cfg.autoSync ? 'var(--ok)' : '';
    }

    function startAutoSync() {
      if (_autoSyncTimer) clearInterval(_autoSyncTimer);
      _autoSyncTimer = setInterval(() => {
        const cfg = getSheetsConfig();
        if (cfg.autoSync && cfg.importUrl) importFromSheets();
      }, 5 * 60 * 1000); // 5 phút
    }

    // ── Ghi lịch sử gửi về Google Sheet ────
    async function syncLogsToSheet(campaignId, campaignName, results) {
      const cfg = getSheetsConfig();
      if (!cfg.webhookUrl || !results?.length) return;
      try {
        const rows = results.map(r => ({
          email: r.email,
          name: contacts.find(c => c.email === r.email)?.name || '',
          level: r.level,
          status: r.status,
          campaign: campaignName,
          sent_at: new Date().toLocaleString('vi-VN'),
        }));
        await fetch(cfg.webhookUrl, {
          method: 'POST',
          body: JSON.stringify(rows),
          mode: 'no-cors',
        });
        toast('✓ Đã ghi lịch sử về Google Sheet');
      } catch (_) { }
    }

    // ── Download file mẫu CSV ───────────────
    function downloadSampleCSV() {
      const csv = [
        'name,email,level,company,phone',
        'Nguyễn Văn A,nguyenvana@email.com,L1,UCMAS Hà Nội,0901234567',
        'Trần Thị B,tranthib@email.com,L2,UCMAS HCM,0907654321',
        'Lê Văn C,levanc@email.com,L3,,',
        'Phạm Thị D,phamthid@email.com,L4,UCMAS Đà Nẵng,',
      ].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM cho Excel đọc được tiếng Việt
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ucmas-contacts-mau.csv';
      a.click();
    }

    function copyAppsScript() {
      const code = document.getElementById('apps-script-code').textContent;
      navigator.clipboard.writeText(code).then(() => toast('Đã copy Apps Script code!'));
    }

    // Khởi động auto-sync nếu đã bật từ trước
    if (getSheetsConfig().autoSync) startAutoSync();

    // ════════════════════════════════════════
    // SETTINGS — localStorage, không cần auth
    // ════════════════════════════════════════
    const CFG_KEY = 'ucmas_config';

    function getConfig() {
      try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
    }

    function openSettings() {
      const cfg = getConfig();
      document.getElementById('cfg-sb-url').value = cfg.sbUrl || '';
      document.getElementById('cfg-sb-key').value = cfg.sbKey || '';
      document.getElementById('cfg-resend').value = cfg.resend || '';
      document.getElementById('cfg-from').value = cfg.from || '';

      // Nếu server đã configured, hiện thông báo cho biết
      const infoBox = document.querySelector('#modal-settings .info-box');
      if (infoBox && _serverConfigured) {
        infoBox.className = 'info-box ok';
        infoBox.innerHTML = '✓ App đang dùng <strong>Vercel Environment Variables</strong>. Mọi người truy cập link đều dùng chung dữ liệu này.';
      }
      document.getElementById('modal-settings').classList.add('open');
    }

    async function saveSettings() {
      const cfg = {
        sbUrl: document.getElementById('cfg-sb-url').value.trim(),
        sbKey: document.getElementById('cfg-sb-key').value.trim(),
        resend: document.getElementById('cfg-resend').value.trim(),
        from: document.getElementById('cfg-from').value.trim(),
      };
      if (!cfg.sbUrl || !cfg.sbKey) { toast('Nhập Supabase URL và Service Role Key!', 'err'); return; }
      if (!cfg.resend) { toast('Nhập Resend API Key!', 'err'); return; }
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      closeModal('modal-settings');
      toast('Đã lưu — đang kết nối...');
      await loadFromBackend();
      window._backendConnected = true;
    }

    async function testSettingsConnection() {
      const url = document.getElementById('cfg-sb-url').value.trim();
      const key = document.getElementById('cfg-sb-key').value.trim();
      if (!url || !key) { toast('Nhập Supabase URL và Service Role Key trước!', 'err'); return; }
      try {
        const res = await fetch('/api/stats', {
          headers: { 'x-sb-url': url, 'x-sb-key': key },
          signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        if (json.success) toast('✓ Kết nối Supabase thành công!');
        else toast('Lỗi: ' + json.error, 'err');
      } catch (e) { toast('Không thể kết nối: ' + e.message, 'err'); }
    }

    // ════════════════════════════════════════
    // API LAYER — Vercel Serverless Functions
    // Endpoints: /api/levels /api/contacts /api/templates /api/campaigns /api/stats
    // ════════════════════════════════════════
    const API = ''; // relative URLs — hoạt động trên cả Vercel lẫn localhost

    let _serverConfigured = false; // true khi Vercel env vars đã được set

    function cfgHeaders() {
      if (_serverConfigured) return {}; // backend tự dùng env vars, không cần headers
      const cfg = getConfig();
      const h = {};
      if (cfg.sbUrl) h['x-sb-url'] = cfg.sbUrl;
      if (cfg.sbKey) h['x-sb-key'] = cfg.sbKey;
      if (cfg.resend) h['x-resend-key'] = cfg.resend;
      if (cfg.from) h['x-from-email'] = cfg.from;
      return h;
    }

    const API_TIMEOUT = 10000; // 10s timeout cho mỗi API call
    const API_MAX_RETRIES = 2; // retry tối đa cho GET/DELETE (idempotent)

    // ── Shared contact transformer — NGUỒN DUY NHẤT để map contact data ──
    // Dùng ở mọi nơi để tránh tags bị drop hay status mapping sai
    function transformContact(c) {
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        level: c.levels?.name || '',
        level_id: c.level_id,
        company: c.company || '',
        tags: c.tags || [],           // QUAN TRỌNG: không được bỏ qua
        dbStatus: c.status || 'active', // dùng dbStatus, không phải status
        last: c.last_sent_at
          ? new Date(c.last_sent_at).toLocaleDateString('vi-VN') : '—',
      };
    }

    async function apiFetch(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      // Chỉ retry cho GET và DELETE (idempotent) — POST/PUT/PATCH không retry
      const maxRetries = (method === 'GET' || method === 'DELETE') ? API_MAX_RETRIES : 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(API + path, {
            ...options,
            signal: options.signal || AbortSignal.timeout(API_TIMEOUT),
            headers: { 'Content-Type': 'application/json', ...cfgHeaders(), ...(options.headers || {}) },
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error || 'Lỗi API');
          return json.data;
        } catch (e) {
          const isLast = attempt === maxRetries;
          if (isLast) throw e;
          // Exponential backoff: 500ms, 1000ms
          const delay = 500 * (attempt + 1);
          console.warn(`[apiFetch] ${method} ${path} thất bại (lần ${attempt + 1}), thử lại sau ${delay}ms:`, e.message);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // ── Load dữ liệu thật từ backend khi server chạy ──────
    const CACHE_KEY = 'ucmas_data_cache';

    function saveCache(data) {
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), ...data })); } catch (_) { }
    }
    function loadCache() {
      try {
        const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (!c) return null;
        if (Date.now() - c.ts > 10 * 60 * 1000) return null; // cache 10 phút
        return c;
      } catch (_) { return null; }
    }

    function applyData({ levels: lv, contacts: ct, templates: tm, campaigns: ca }) {
      if (lv?.length) { levels = lv; rebuildLevelMap(); }
      if (tm?.length) templates = tm;
      refreshUI();
      renderTemplates(); renderCampaignTargets();
      if (ca) { renderHistoryFromApi(ca); renderDashCampaigns(ca); }

      // Contacts: nếu backend connected → dùng refreshContacts() để đảm bảo luôn dùng đúng filter
      // Nếu offline hoặc data từ cache (không có filter) → dùng data truyền vào
      if (window._backendConnected) {
        // Reload contacts với filter hiện tại — tránh race condition của background refresh
        refreshContacts();
      } else {
        if (ct) contacts = ct;
        renderContactTable();
      }

      if (totalContacts > 0) updatePaginationUI(totalContacts);
      loadAllTags();
      renderDashLiveStats();
      const now = new Date().toLocaleTimeString('vi-VN');
      const el = document.getElementById('dash-last-updated');
      if (el) el.textContent = 'Cập nhật lúc ' + now;
    }

    // Xóa cache — gọi sau bất kỳ thao tác ghi nào (xóa, tạo, sửa)
    function clearCache() {
      try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
    }

    function showLoading(msg = 'Đang tải dữ liệu...') {
      const el = document.getElementById('global-loading');
      const txt = document.getElementById('loading-text');
      if (el) el.classList.remove('hidden');
      if (txt) txt.textContent = msg;
    }
    function hideLoading() {
      const el = document.getElementById('global-loading');
      if (el) el.classList.add('hidden');
    }

    async function loadFromBackend() {
      // 1. Hiện cache ngay lập tức nếu có
      const cached = loadCache();
      if (cached) {
        applyData(cached);
        hideLoading();
        // Refresh ngầm không block UI
        fetchFreshData(true);
        return;
      }

      // 2. Không có cache — hiện loading và fetch
      showLoading('Đang kết nối Supabase...');
      await fetchFreshData(false);
    }

    async function fetchFreshData(silent = false) {
      try {
        // Quick health check — 5s timeout
        const res = await fetch('/api/stats', { headers: cfgHeaders(), signal: AbortSignal.timeout(5000) });
        if (!res.ok) { hideLoading(); return; }
        const statsCheck = await res.json();
        if (!statsCheck.success) { hideLoading(); return; }

        if (!silent) showLoading('Đang tải dữ liệu...');

        // 🛡️ allSettled: 1 API fail KHÔNG làm các API khác bị hủy
        // Contacts: load theo filter hiện tại nếu có (tránh ghi đè khi user đang xem level cụ thể)
        const contactFilter = (currentFilter && currentFilter !== 'all') ? `&levelId=${currentFilter}` : '';
        const [lvRes, ctRes, tmRes, caRes] = await Promise.allSettled([
          apiFetch('/api/levels'),
          apiFetch(`/api/contacts?page=${currentPage}&per_page=${perPage}${contactFilter}`),
          apiFetch('/api/templates'),
          apiFetch('/api/campaigns'),
        ]);

        // Log cảnh báo cho từng API thất bại (không crash app)
        const apiNames = ['levels', 'contacts', 'templates', 'campaigns'];
        [lvRes, ctRes, tmRes, caRes].forEach((r, i) => {
          if (r.status === 'rejected') console.warn(`[fetchFreshData] /api/${apiNames[i]} thất bại:`, r.reason?.message);
        });

        // Transform từng phần — null nếu API đó thất bại (giữ state cũ)
        const lv = lvRes.status === 'fulfilled' && lvRes.value?.length
          ? lvRes.value.map(l => ({
              id: l.id, name: l.name, color: l.color,
              parent: l.parent_id || null, desc: l.description || '', count: l.count || 0,
            }))
          : null;

        // Dùng transformContact() — nguồn duy nhất, không drop tags
        const ctRaw = ctRes.status === 'fulfilled' ? ctRes.value : null;
        const ct = ctRaw?.data ? ctRaw.data.map(transformContact) : null;
        if (ctRaw?.total != null) totalContacts = ctRaw.total;

        const tmRaw = tmRes.status === 'fulfilled' ? tmRes.value : null;
        const tm = tmRaw?.length
          ? tmRaw.map(t => ({
              id: t.id, name: t.name, icon: t.icon || '📄',
              desc: t.description || '', tags: t.tags || [], body: t.body,
            }))
          : null;

        const ca = caRes.status === 'fulfilled' ? caRes.value : null;

        // Cập nhật totalContacts và level counts từ stats
        if (statsCheck.data?.totalContacts != null) totalContacts = statsCheck.data.totalContacts;
        if (statsCheck.data?.countMap && lv) {
          lv.forEach(l => { l.count = statsCheck.data.countMap[l.id] || 0; });
        }

        // Lưu cache (chỉ lưu phần có data, giữ lại phần cũ nếu API fail)
        const cacheUpdate = {};
        if (lv) cacheUpdate.levels = lv;
        if (ct) cacheUpdate.contacts = ct;
        if (tm) cacheUpdate.templates = tm;
        if (ca) cacheUpdate.campaigns = ca;
        if (Object.keys(cacheUpdate).length) saveCache(cacheUpdate);

        // Apply vào UI
        applyData({ levels: lv, contacts: ct, templates: tm, campaigns: ca });
        hideLoading();

        // Thông báo nếu có API bị lỗi
        const failedApis = apiNames.filter((_, i) => [lvRes, ctRes, tmRes, caRes][i].status === 'rejected');
        if (failedApis.length > 0 && !silent) {
          toast(`⚠ Không tải được: ${failedApis.join(', ')}. Dữ liệu có thể chưa đầy đủ.`, 'warn');
        } else {
          document.getElementById('conn-status').innerHTML = `<div class="status-dot"></div>Supabase connected`;
          if (!silent) toast('Đã tải xong dữ liệu', 'ok');
        }

      } catch (e) {
        hideLoading();
        if (!silent) toast('Lỗi kết nối Supabase: ' + e.message, 'err');
        else console.warn('[fetchFreshData silent]', e.message);
      }
    }

    function renderDashCampaigns(campaigns) {
      const body = document.getElementById('dash-campaigns');
      if (!body) return;
      const recent = (campaigns || []).slice(0, 5);
      if (!recent.length) {
        body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Chưa có campaign nào. <span style="color:var(--accent2);cursor:pointer" onclick="gotoPage('campaign')">Tạo ngay →</span></div>`;
        return;
      }
      const statusColor = s => s === 'completed' ? 'var(--ok)' : s === 'failed' ? 'var(--err)' : 'var(--warn)';
      const statusIcon = s => s === 'completed' ? 'ok' : s === 'failed' ? 'err' : 'partial';
      body.innerHTML = recent.map(c => {
        const total = (c.sent_count || 0) + (c.failed_count || 0);
        const pct = total > 0 ? Math.round(c.sent_count / total * 100) : 0;
        const date = c.sent_at ? new Date(c.sent_at).toLocaleDateString('vi-VN') : '—';
        const lvls = (c.target_levels || []).slice(0, 3);
        return `<div class="h-item">
      <div class="h-icon ${statusIcon(c.status)}">✉</div>
      <div style="flex:1">
        <div class="h-title">${c.name}</div>
        <div class="h-meta">
          ${lvls.map((l, i) => `<span class="lt lt${(i % 4) + 1}">${l}</span>`).join('')}
          ${date !== '—' ? `· ${date}` : ''}
        </div>
      </div>
      <div class="h-stats">
        <div class="h-sent" style="color:${statusColor(c.status)}">${c.sent_count}/${total || '?'}</div>
        <div class="h-rate">${total > 0 ? pct + '%' : c.status}</div>
      </div>
    </div>`;
      }).join('');
    }

    // ═══ TRACKING UI — inline expand, auto-refresh 30min, 5-day window ═══
    let _histCampaigns = [];
    let _trkAutoTimer = null;
    const TRK_INTERVAL = 30 * 60 * 1000; // 30 phút
    const TRK_MAX_AGE = 5 * 24 * 60 * 60 * 1000; // 5 ngày

    function renderHistoryFromApi(campaigns) {
      _histCampaigns = campaigns || [];
      const body = document.getElementById('history-campaigns-body');
      if (!body) return;
      if (!_histCampaigns.length) {
        body.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Chưa có campaign nào</div>';
        updateTrackingOverview([]); return;
      }
      document.getElementById('history-campaign-count').textContent = _histCampaigns.length + ' campaigns';
      const sI = s => s === 'completed' ? 'ok' : s === 'failed' ? 'err' : s === 'sending' ? 'run' : s === 'paused' ? 'partial' : 'partial';
      body.innerHTML = _histCampaigns.map(c => {
        const total = (c.sent_count||0) + (c.failed_count||0);
        const trk = c.tracking || {};
        const oR = c.sent_count > 0 ? Math.round((trk.opened||0)/c.sent_count*100) : 0;
        const cR = c.sent_count > 0 ? Math.round((trk.clicked||0)/c.sent_count*100) : 0;
        const sd = c.sent_at ? new Date(c.sent_at) : null;
        const active = sd && (Date.now()-sd.getTime()) < TRK_MAX_AGE;
        const tl = active ? '<span style="color:var(--ok);font-size:10px">● tracking</span>' : (sd ? '<span style="font-size:10px;color:var(--muted)">hết hạn</span>' : '');
        const isPartial  = c.status === 'partial' || c.status === 'sending' || c.status === 'paused';
        const isSending  = c.status === 'sending';
        const canResume  = c.status === 'partial' || c.status === 'paused';
        return `<div class="trk-campaign" id="trk-camp-${c.id}">
  <div class="trk-campaign-row" onclick="toggleCampaignDetail('${c.id}')">
    <div class="h-icon ${sI(c.status)}">✉</div>
    <div style="flex:1;min-width:140px">
      <div class="h-title">${c.name}</div>
      <div class="h-meta">${(c.target_levels||[]).map((l,i)=>`<span class="lt lt${(i%4)+1}">${l}</span>`).join('')} · ${sd?sd.toLocaleDateString('vi-VN'):'—'} ${tl}${isPartial ? ' <span style="color:#f5a623;font-size:10px;font-weight:600">⏸ đang dở (' + c.sent_count + ' đã gửi)</span>' : ''}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <div class="trk-pill"><span class="trk-pill-icon" style="color:#3de8a0">✓</span>${c.sent_count}/${total}</div>
      <div class="trk-pill"><span class="trk-pill-icon" style="color:#4f6cff">👁</span>${oR}%</div>
      <div class="trk-pill"><span class="trk-pill-icon" style="color:#c97ef5">🔗</span>${cR}%</div>
      ${trk.bounced?`<div class="trk-pill" style="border-color:#ff7eb3"><span class="trk-pill-icon" style="color:#ff7eb3">⚠</span>${trk.bounced}</div>`:''}
    </div>
    ${canResume ? `<button class="abtn" style="font-size:10px;padding:2px 8px;color:#f5a623;border-color:#f5a623" onclick="event.stopPropagation();resumeCampaign('${c.id}')">▶ Gửi tiếp</button>` : ''}
    ${isSending ? `<button class="abtn" style="font-size:10px;padding:2px 8px;color:#ff7eb3;border-color:#ff7eb3" onclick="event.stopPropagation();stopCampaignById('${c.id}')">⏹ Dừng</button>` : ''}
    <div class="trk-expand-icon" id="trk-arrow-${c.id}">▸</div>
  </div>
  <div class="trk-campaign-detail" id="trk-detail-${c.id}"></div>
</div>`;
      }).join('');
      updateTrackingOverview(_histCampaigns);
      startTrackingAutoRefresh();
    }

    async function toggleCampaignDetail(id) {
      const el = document.getElementById('trk-camp-' + id);
      if (!el) return;
      if (el.classList.contains('open')) { el.classList.remove('open'); return; }
      // Close others
      document.querySelectorAll('.trk-campaign.open').forEach(e => e.classList.remove('open'));
      el.classList.add('open');
      const detail = document.getElementById('trk-detail-' + id);
      detail.innerHTML = '<div class="trk-detail-inner" style="text-align:center;padding:20px"><div style="width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent2);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 8px"></div>Đang tải...</div>';
      try {
        const [stats, evData] = await Promise.all([
          apiFetch(`/api/tracking?campaign_id=${id}`),
          apiFetch(`/api/tracking?campaign_id=${id}&logs`)
        ]);
        renderInlineDetail(detail, stats, evData.logs, evData.events, id);
      } catch (e) {
        detail.innerHTML = `<div class="trk-detail-inner" style="color:var(--err)">❌ ${e.message}<br><small style="color:var(--muted)">Kiểm tra bảng email_events trong Supabase</small></div>`;
      }
    }

    function renderInlineDetail(container, stats, logs, events, campId) {
      const oR = stats.open_rate||0, cR = stats.click_rate||0;
      const dR = stats.total_sent ? Math.round(stats.delivered/stats.total_sent*100) : 0;
      const emailMap = {};
      (logs||[]).forEach(l => { emailMap[l.email] = {email:l.email, level:l.level, status:l.status, ev:[]}; });
      (events||[]).forEach(e => {
        if (!emailMap[e.recipient_email]) emailMap[e.recipient_email] = {email:e.recipient_email,level:'—',status:'—',ev:[]};
        emailMap[e.recipient_email].ev.push(e.event_type);
      });
      const list = Object.values(emailMap);
      container.innerHTML = `<div class="trk-detail-inner">
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
    <div class="trk-rate-bar"><div class="trk-rate-hd"><span>Delivery</span><span style="color:#3de8a0">${dR}%</span></div><div class="trk-rate-bg"><div class="trk-rate-fill" style="width:${dR}%;background:#3de8a0"></div></div></div>
    <div class="trk-rate-bar"><div class="trk-rate-hd"><span>Open Rate</span><span style="color:#4f6cff">${oR}%</span></div><div class="trk-rate-bg"><div class="trk-rate-fill" style="width:${oR}%;background:#4f6cff"></div></div></div>
    <div class="trk-rate-bar"><div class="trk-rate-hd"><span>Click Rate</span><span style="color:#c97ef5">${cR}%</span></div><div class="trk-rate-bg"><div class="trk-rate-fill" style="width:${cR}%;background:#c97ef5"></div></div></div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;font-family:var(--fm)">
    <span>📨 Gửi: <b>${stats.total_sent}</b></span>
    <span>📬 Delivered: <b style="color:#3de8a0">${stats.delivered}</b></span>
    <span>👁 Opens: <b style="color:#4f6cff">${stats.unique_opens}</b></span>
    <span>🔗 Clicks: <b style="color:#c97ef5">${stats.unique_clicks}</b></span>
    ${stats.bounced?`<span>⚠ Bounce: <b style="color:#ff7eb3">${stats.bounced}</b></span>`:''}
    ${stats.complained?`<span>🚫 Spam: <b style="color:#ff5757">${stats.complained}</b></span>`:''}
    ${stats.total_failed?`<span>❌ Failed: <b style="color:var(--err)">${stats.total_failed}</b></span>`:''}
  </div>
  <div style="font-weight:600;font-size:12px;margin-bottom:6px">📋 Chi tiết từng email (${list.length})</div>
  <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
    <table style="width:100%;font-size:11px;border-collapse:collapse">
      <thead><tr style="background:var(--surface3);position:sticky;top:0">
        <th style="padding:6px 8px;text-align:left">Email</th><th style="padding:6px;text-align:left">Level</th>
        <th style="padding:6px;text-align:center">Sent</th><th style="padding:6px;text-align:center">📬</th>
        <th style="padding:6px;text-align:center">👁</th><th style="padding:6px;text-align:center">🔗</th>
        <th style="padding:6px;text-align:center">Status</th>
      </tr></thead>
      <tbody>${list.map(em => {
        const d=em.ev.includes('delivered'), o=em.ev.includes('opened'), c=em.ev.includes('clicked');
        const b=em.ev.includes('bounced'), sp=em.ev.includes('complained');
        const badge = b?'<span style="color:#ff7eb3">Bounce</span>':sp?'<span style="color:#ff5757">Spam</span>':em.status==='failed'?'<span style="color:var(--err)">Failed</span>':'<span style="color:var(--ok)">OK</span>';
        return `<tr style="border-top:1px solid var(--border)">
          <td style="padding:5px 8px;font-family:var(--fm)">${em.email}</td><td style="padding:5px 6px">${em.level||'—'}</td>
          <td style="text-align:center">${em.status==='sent'?'✅':em.status==='failed'?'❌':'—'}</td>
          <td style="text-align:center">${d?'📬':'—'}</td><td style="text-align:center">${o?'👁':'—'}</td>
          <td style="text-align:center">${c?'🔗':'—'}</td><td style="text-align:center">${badge}</td></tr>`;
      }).join('')}</tbody>
    </table>
  </div>
  <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
    <button class="abtn" style="font-size:11px;color:var(--accent2);border-color:var(--accent2)" onclick="backfillCampaign('${campId}',this)">🔄 Đồng bộ trạng thái từ Resend</button>
    <button class="abtn" style="font-size:11px" onclick="exportCampaignLogs('${campId}')">⬇ Export CSV</button>
  </div>
</div>`;
    }

    function updateTrackingOverview(campaigns) {
      let tS=0,tD=0,tO=0,tC=0,tB=0,tSp=0;
      (campaigns||[]).forEach(c => { tS+=c.sent_count||0; const t=c.tracking||{}; tD+=t.delivered||0; tO+=t.opened||0; tC+=t.clicked||0; tB+=t.bounced||0; tSp+=t.complained||0; });
      const el=id=>document.getElementById(id);
      el('trk-total-sent').textContent=tS; el('trk-total-delivered').textContent=tD;
      el('trk-total-opened').textContent=tO; el('trk-total-clicked').textContent=tC;
      el('trk-total-bounced').textContent=tB; el('trk-total-spam').textContent=tSp;
      const banner=document.getElementById('webhook-banner');
      if(banner){ banner.style.display=(tS>0&&tD===0&&tO===0)?'':'none';
        const u=document.getElementById('webhook-url-display'); if(u) u.textContent=window.location.origin+'/api/webhooks'; }
    }

    function startTrackingAutoRefresh() {
      if (_trkAutoTimer) clearInterval(_trkAutoTimer);
      // Check if any campaign is within 5-day window
      const hasActive = _histCampaigns.some(c => c.sent_at && (Date.now()-new Date(c.sent_at).getTime()) < TRK_MAX_AGE);
      const statusEl = document.getElementById('trk-auto-status');
      if (hasActive) {
        _trkAutoTimer = setInterval(() => { if (document.getElementById('page-history')?.classList.contains('active')) refreshTracking(true); }, TRK_INTERVAL);
        if (statusEl) statusEl.textContent = '⟳ Auto-refresh 30p';
      } else {
        if (statusEl) statusEl.textContent = '';
      }
    }

    // Flag dùng để dừng campaign từ UI
    window._stopCampaign = false;
    window._sendingCampaignId = null;

    async function stopCampaign() {
      window._stopCampaign = true;
      const cid = window._sendingCampaignId;
      if (!cid) return;
      try {
        await apiFetch(`/api/campaigns-send?stop=${cid}`, { method: 'POST' });
        toast('⏸ Đã dừng gửi campaign');
      } catch (e) { toast('Lỗi dừng: ' + e.message, 'err'); }
      window._sendingCampaignId = null;
      refreshTracking();
    }

    // Dừng campaign trực tiếp từ History (theo ID — không cần đang gửi trong tab hiện tại)
    async function stopCampaignById(campaignId) {
      if (!confirm('Dừng gửi campaign này?')) return;
      try {
        await apiFetch(`/api/campaigns-send?stop=${campaignId}`, { method: 'POST' });
        toast('⏸ Đã dừng campaign');
        if (window._sendingCampaignId === campaignId) {
          window._stopCampaign = true;
          window._sendingCampaignId = null;
        }
        refreshTracking();
      } catch (e) { toast('Lỗi dừng: ' + e.message, 'err'); }
    }

    /**
     * Gửi tiếp campaign bị dở.
     * An toàn vì backend gửi tuần tự, log ngay mỗi email.
     * Nếu bị timeout lại → tự động gửi tiếp đến hết.
     */
    async function resumeCampaign(campaignId, isAutoResume) {
      // Chặn 2 luồng song song
      if (window._sendingCampaignId === campaignId) {
        if (!isAutoResume) toast('⚠ Campaign này đang được gửi rồi.', 'warn');
        return;
      }
      if (window._sendingCampaignId) {
        toast('⚠ Đang có campaign khác đang gửi. Vui lòng chờ.', 'warn');
        return;
      }

      window._stopCampaign     = false;
      window._sendingCampaignId = campaignId;
      clearTimeout(window._resumeTimer);

      if (!isAutoResume) toast('▶ Đang gửi tiếp campaign...');

      let lastSent = 0, lastTotal = 0, completed = false;

      try {
        const response = await fetch(`/api/campaigns-send?resume=${campaignId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cfgHeaders() },
        });

        // Nếu tất cả đã gửi → response là JSON
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const json = await response.json();
          if (json.success) {
            toast('✅ Tất cả email đã được gửi!');
            refreshTracking();
          } else if (json.error?.includes('409') || response.status === 409) {
            // Campaign đang được gửi bởi tiến trình khác → chờ 10s rồi thử lại
            toast('⏳ Campaign đang được xử lý. Kiểm tra lại sau...', 'warn');
            refreshTracking();
          } else {
            toast('Lỗi: ' + (json.error || 'Unknown'), 'err');
          }
          return;
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (window._stopCampaign) { reader.cancel(); break; }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop();

          for (const ev of events) {
            if (!ev.startsWith('data: ')) continue;
            const data = JSON.parse(ev.slice(6));

            if (data.type === 'start') {
              lastSent  = data.alreadySent || 0;
              lastTotal = data.total || 0;
              toast(`▶ Tiếp tục từ email ${lastSent + 1}/${lastTotal}...`);
            }
            if (data.type === 'progress') {
              lastSent  = data.sent  || 0;
              lastTotal = data.total || 0;
              const pct = lastTotal > 0 ? Math.round(lastSent / lastTotal * 100) : 0;
              // Cập nhật progress bar nếu đang ở tab New Campaign
              const progFill = document.getElementById('prog-fill');
              const progPct  = document.getElementById('prog-pct');
              if (progFill) progFill.style.width = pct + '%';
              if (progPct)  progPct.textContent   = pct + '%';
            }
            if (data.type === 'done') {
              completed = true;
              toast(`✅ Hoàn thành! ${data.sent}/${data.total} đã gửi`);
              window._sendingCampaignId = null;
              refreshTracking();
            }
          }
        }
      } catch (e) {
        // Kết nối bị ngắt (timeout hoặc mất mạng)
        console.warn('[resumeCampaign] connection lost:', e.message);
      } finally {
        if (!completed) window._sendingCampaignId = null;
      }

      if (window._stopCampaign) {
        window._sendingCampaignId = null;
        toast('⏸ Đã dừng gửi.');
        refreshTracking();
        return;
      }

      // Tự động gửi tiếp nếu chưa xong — AN TOÀN vì backend tuần tự + log ngay
      if (!completed && lastTotal > 0 && lastSent < lastTotal) {
        toast(`⏳ Đã gửi ${lastSent}/${lastTotal}. Tự động tiếp tục sau 3s...`);
        window._resumeTimer = setTimeout(() => {
          if (!window._stopCampaign) resumeCampaign(campaignId, true);
        }, 3000);
      } else if (!completed) {
        toast('⚠ Không thể kết nối. Vào History → bấm Gửi tiếp khi sẵn sàng.', 'warn');
        refreshTracking();
      }
    }

    async function backfillCampaign(campaignId, btn) {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang đồng bộ...'; }
      try {
        const result = await apiFetch(`/api/tracking?backfill=${campaignId}`, { method: 'POST' });
        console.log('[backfill result]', result);
        if (result.mode === 'search') {
          if (result.found > 0) {
            toast(`✅ Tìm thấy ${result.found} email (${result.unique} unique, ${result.duplicates} trùng). Đã tạo ${result.send_logs_created} bản ghi.`);
          } else {
            toast(`⚠ Không tìm thấy email trên Resend. Đã quét ${result.scanned} email. Kiểm tra console (F12) để debug.`, 'warn');
          }
        } else {
          toast(`✅ Đồng bộ xong: ${result.synced}/${result.total} email đã cập nhật`);
        }
        // Reload history page
        refreshTracking(true);
        toggleCampaignDetail(campaignId);
        setTimeout(() => toggleCampaignDetail(campaignId), 300);
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
      finally { if (btn) { btn.disabled = false; btn.textContent = '🔄 Đồng bộ trạng thái từ Resend'; } }
    }

    async function refreshTracking(silent) {
      if (!silent) toast('Đang tải tracking data...');
      try {
        const data = await apiFetch('/api/tracking?summary');
        if (data) { renderHistoryFromApi(data); if (!silent) toast('Đã cập nhật tracking data'); }
      } catch (e) {
        if (!silent) toast('Lỗi: ' + e.message, 'err');
        try { const ca = await apiFetch('/api/campaigns'); renderHistoryFromApi(ca); } catch(_){}
      }
    }


    async function exportCampaignLogs(campaignId) {
      try {
        const logs = await apiFetch(`/api/campaigns?logs=${campaignId}`);
        const csv = ['email,level,status,resend_id,error_msg,sent_at',
          ...logs.map(l => [l.email, l.level, l.status, l.resend_id || '', l.error_msg || '', l.sent_at].join(','))
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `campaign-${campaignId}.csv`;
        a.click();
        toast('Đã xuất log CSV');
      } catch (e) { toast('Lỗi export: ' + e.message, 'err'); }
    }

    // ── Override: Upload CSV thật ──────────────────────────
    async function handleUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      toast(`Đang import "${file.name}"...`);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/contacts-import', { method: 'POST', body: fd });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        const d = json.data;
        toast(`Import xong: ${d.imported} contacts, ${d.skipped} bỏ qua`);
        if (d.parseErrors?.length) d.parseErrors.forEach(e => toast(e, 'warn'));
        // Reload contacts
        const ctData = await apiFetch('/api/contacts');
        if (ctData) contacts = ctData.map(c => ({
          id: c.id, name: c.name, email: c.email,
          level: c.levels?.name || '', level_id: c.level_id,
          company: c.company || '',
          status: c.status === 'active' ? 'pending' : c.status,
          last: c.last_sent_at ? new Date(c.last_sent_at).toLocaleDateString('vi-VN') : '—',
        }));
        renderContactTable(); scheduleRefresh();
      } catch (err) { toast('Lỗi import: ' + err.message, 'err'); }
    }

    // ── Override: Tạo Level thật ──────────────────────────
    const _saveLevel = saveLevel;
    saveLevel = async function () {
      if (!window._backendConnected) { _saveLevel(); return; }
      const name = document.getElementById('ml-name').value.trim();
      if (!name) { toast('Nhập tên level!', 'err'); return; }
      try {
        await apiFetch('/api/levels', {
          method: 'POST', body: JSON.stringify({
            name, color: selectedColor,
            parent_id: document.getElementById('ml-parent').value || null,
            description: document.getElementById('ml-desc').value.trim(),
          })
        });
        closeModal('modal-level');
        const lvData = await apiFetch('/api/levels');
        levels = lvData.map(l => ({ id: l.id, name: l.name, color: l.color, parent: l.parent_id || null, desc: l.description || '', count: l.count || 0 }));
        scheduleRefresh(); renderLevelPage();
        toast(`Đã tạo level "${name}"`);
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    };

    const _saveQuickLevel = saveQuickLevel;
    saveQuickLevel = async function () {
      if (!window._backendConnected) { _saveQuickLevel(); return; }
      const name = document.getElementById('ql-name').value.trim();
      if (!name) { toast('Nhập tên level!', 'err'); return; }
      try {
        await apiFetch('/api/levels', {
          method: 'POST',
          body: JSON.stringify({
            name, color: selectedColorQuick,
            parent_id: document.getElementById('ql-parent').value || null,
            description: document.getElementById('ql-desc').value.trim(),
          }),
        });
        document.getElementById('ql-name').value = '';
        document.getElementById('ql-desc').value = '';
        const lvData = await apiFetch('/api/levels');
        levels = lvData.map(l => ({ id: l.id, name: l.name, color: l.color, parent: l.parent_id || null, desc: l.description || '', count: l.count || 0 }));
        scheduleRefresh(); renderLevelPage(); renderCampaignTargets();
        toast(`Đã tạo level "${name}"`);
      } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
    };

    // ── Override: Lưu template thật ───────────────────────
    const _saveCurrentTemplate = saveCurrentTemplate;
    saveCurrentTemplate = async function () {
      if (!window._backendConnected) { _saveCurrentTemplate(); return; }
      const name = document.getElementById('tmpl-name-input').value.trim() || 'Template mới';
      const body = document.getElementById('tmpl-code').value;
      try {
        if (activeTemplate && templates.find(t => t.id === activeTemplate)) {
          await apiFetch(`/api/templates?id=${activeTemplate}`, {
            method: 'PUT', body: JSON.stringify({ name, body }),
          });
        } else {
          const t = await apiFetch('/api/templates', {
            method: 'POST', body: JSON.stringify({ name, body, icon: '📄', description: 'Template tuỳ chỉnh', tags: ['custom'] }),
          });
          activeTemplate = t.id;
        }
        const tmData = await apiFetch('/api/templates');
        templates = tmData.map(t => ({ id: t.id, name: t.name, icon: t.icon || '📄', desc: t.description || '', tags: t.tags || [], body: t.body }));
        renderTemplates();
        toast(`Đã lưu: ${name}`);
      } catch (e) { toast('Lỗi lưu template: ' + e.message, 'err'); }
    };

    // ── Override: Gửi Campaign thật (SSE) ─────────────────
    const _startSend = startSend;
    startSend = async function () {
      if (!window._backendConnected) { _startSend(); return; }

      const segs = Object.entries(selectedLevels).filter(([, v]) => v);
      if (!segs.length) { toast('Chọn ít nhất 1 level!', 'err'); return; }

      const name = document.getElementById('c-name').value.trim();
      const subject = document.getElementById('c-subject').value.trim();
      const body = document.getElementById('c-body').value.trim();
      const from = document.getElementById('c-from').value.trim();

      if (!name || !subject || !body) { toast('Điền đầy đủ Campaign Name, Subject và Nội dung!', 'err'); return; }

      // Check schedule
      const isScheduled = document.getElementById('c-schedule-check')?.checked;
      if (isScheduled) {
        const schedTime = document.getElementById('c-schedule-time').value;
        if (!schedTime) { toast('Chọn thời gian gửi!', 'err'); return; }
        const schedDate = new Date(schedTime);
        if (schedDate <= new Date()) { toast('Thời gian gửi phải ở tương lai!', 'err'); return; }
        // Lưu scheduled campaign
        const scheduled = JSON.parse(localStorage.getItem('ucmas_scheduled') || '[]');
        scheduled.push({
          id: 'sched_' + Date.now(),
          name, from, subject, body,
          target_level_ids: segs.map(([id]) => { const lv = getLevelById(id); return lv ? lv.id : id; }).filter(Boolean),
          scheduled_at: schedDate.toISOString(),
          status: 'scheduled',
        });
        localStorage.setItem('ucmas_scheduled', JSON.stringify(scheduled));
        toast(`⏰ Đã lên lịch gửi "${name}" vào ${schedDate.toLocaleString('vi-VN')}`, 'ok');
        document.getElementById('c-schedule-check').checked = false;
        toggleSchedule();
        return;
      }

      // Lấy level uuid từ tên level đã chọn
      const selectedLevelIds = segs.map(([id]) => {
        const lv = getLevelById(id);
        return lv ? lv.id : id;
      }).filter(Boolean);

      const prog = document.getElementById('send-progress');
      prog.classList.add('active');
      prog.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      document.getElementById('ps1').className = 'pstep run';
      document.getElementById('ps2').className = 'pstep';
      document.getElementById('ps3').className = 'pstep';
      document.getElementById('ps4').className = 'pstep';

      try {
        const response = await fetch('/api/campaigns-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cfgHeaders() },
          body: JSON.stringify({
            name, from_name: from, from_email: document.getElementById('c-from-email').value || '',
            subject, body_text: body, target_level_ids: selectedLevelIds,
          }),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop();

          for (const event of events) {
            if (!event.startsWith('data: ')) continue;
            const data = JSON.parse(event.slice(6));

            if (data.type === 'start') {
              document.getElementById('ps1').className = 'pstep done';
              document.getElementById('ps2').className = 'pstep run';
              window._sendingCampaignId = data.campaignId;
            }
            if (data.type === 'progress') {
              const pct = Math.round((data.sent + data.failed) / data.total * 100);
              document.getElementById('prog-fill').style.width = pct + '%';
              document.getElementById('prog-pct').textContent = pct + '%';
              if (document.getElementById('ps2').className.includes('run')) {
                document.getElementById('ps2').className = 'pstep done';
                document.getElementById('ps3').className = 'pstep run';
              }
            }
            if (data.type === 'done') {
              ['ps1', 'ps2', 'ps3', 'ps4'].forEach(s => document.getElementById(s).className = 'pstep done');
              document.getElementById('prog-fill').style.width = '100%';
              document.getElementById('prog-pct').textContent = '100%';
              setTimeout(() => {
                prog.classList.remove('active');
                toast(`Đã gửi xong! ${data.sent}/${data.total} thành công.`);
                gotoPage('history');
              }, 600);
            }
            if (data.type === 'error') {
              if (data.resumable) {
                document.getElementById('prog-fill').style.width = Math.round(data.sent/data.total*100) + '%';
                document.getElementById('prog-pct').textContent = Math.round(data.sent/data.total*100) + '%';
                toast('⏳ Đã gửi ' + data.sent + '/' + data.total + '. Tự động gửi tiếp...');
                setTimeout(async () => { prog.classList.remove('active'); await resumeCampaign(data.campaignId, true); }, AUTO_RESUME_DELAY);
              } else {
                prog.classList.remove('active');
                toast('Gửi thất bại: ' + data.error, 'err');
              }
            }
          }
        }
      } catch (e) {
        // Kết nối bị ngắt (timeout Vercel) — tự resume an toàn
        // Backend gửi tuần tự + log ngay → không có email nào gửi trùng
        prog.classList.remove('active');
        const cid = window._sendingCampaignId;
        if (cid && !window._stopCampaign) {
          window._sendingCampaignId = null;
          toast('⏳ Kết nối bị ngắt. Tự động gửi tiếp sau 3 giây...');
          refreshTracking();
          clearTimeout(window._resumeTimer);
          window._resumeTimer = setTimeout(() => resumeCampaign(cid, true), 3000);
        } else {
          window._sendingCampaignId = null;
          toast('⚠ Kết nối bị ngắt', 'warn');
        }
      }
    };

    // Khởi động — check server config trước, rồi mới quyết định hiện setup hay load thẳng
    init();

    async function startup() {
      try {
        // Kiểm tra xem Vercel env vars đã được set chưa
        const cfgRes = await fetch('/api/config', { signal: AbortSignal.timeout(4000) });
        const cfgJson = await cfgRes.json();

        if (cfgJson.configured) {
          // ✅ Server đã có config (Vercel env vars) → load thẳng, không cần localStorage
          _serverConfigured = true;
          window._backendConnected = true;
          await loadFromBackend();
          return;
        }
      } catch (_) { }

      // ❌ Server chưa config → dùng localStorage (chế độ cá nhân)
      const _cfg = getConfig();
      if (!_cfg.sbUrl || !_cfg.sbKey) {
        hideLoading();
        setTimeout(() => {
          toast('👋 Lần đầu sử dụng? Bấm ⚙ Settings để nhập Supabase và Resend key.', 'warn');
          openSettings();
        }, 500);
      } else {
        await loadFromBackend();
        window._backendConnected = true;
      }
    }

    startup();