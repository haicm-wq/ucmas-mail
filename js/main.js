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
    // Select all filtered state
    let _selectAllFiltered = false;  // true = đang chọn TẤT CẢ contacts theo bộ lọc
    let _allFilteredIds = [];        // danh sách IDs khi chọn tất cả
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
    // preFiltered=true: API đã filter level → chỉ filter text trên client
    // preFiltered=false: contacts chưa filter → filter cả level lẫn text
    function renderContactTable(query = '', preFiltered = false) {
      const tbody = document.getElementById('contact-tbody');
      let rows = contacts.filter(c => {
        const cLevelIds = c.level_ids || (c.level_id ? [c.level_id] : []);
        const levelMatch = preFiltered
          || currentFilter === 'all'
          || cLevelIds.includes(currentFilter)
          || cLevelIds.some(lid => isChildOf(lid, currentFilter));
        const q = query.toLowerCase();
        const textMatch = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
        return levelMatch && textMatch;
      });
      tbody.innerHTML = rows.map((c) => {
        const cLevelIds = c.level_ids || (c.level_id ? [c.level_id] : []);
        const levelBadges = cLevelIds.map(lid => {
          const lv = getLevelById(lid);
          if (!lv) return '';
          return `<span class="lt" style="background:${hexToRgba(lv.color || '#888', .12)};color:${lv.color || '#888'};border:1px solid ${hexToRgba(lv.color || '#888', .25)};margin:1px">● ${esc(lv.name)}</span>`;
        }).filter(Boolean).join('') || '<span style="color:var(--muted)">—</span>';
        const dbStatus = c.dbStatus || 'active';
        const hasSent = c.last && c.last !== '—';
        const statusIcon = dbStatus === 'unsubscribed' ? 's-err' : dbStatus === 'bounced' ? 's-err' : hasSent ? 's-ok' : 's-pend';
        const statusLabel = dbStatus === 'unsubscribed' ? 'Unsub' : dbStatus === 'bounced' ? 'Bounced' : hasSent ? 'Đã gửi' : 'Active';
        const cid = esc(c.id); // dùng UUID thay index — an toàn khi filter active
        return `<tr data-id="${cid}">
      <td><input type="checkbox" onchange="onRowCheck()"></td>
      <td style="font-weight:500">${esc(c.name)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(c.child_name || '')}</td>
      <td class="col-em">${esc(c.email)}</td>
      <td style="max-width:180px">${levelBadges}</td>
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
      }).join('') || `<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--muted)">Kh\u00f4ng c\u00f3 contact n\u00e0o</td></tr>`;
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
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--muted)"><span style="display:inline-block;animation:spin 1s linear infinite">⟳</span> Đang tải...</td></tr>`;
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
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--err)">⚠ Lỗi tải contacts: ${e.message}</td></tr>`;
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
      // Khi bỏ chọn tất cả → reset trạng thái select all filtered
      if (!cb.checked) { _selectAllFiltered = false; _allFilteredIds = []; }
      updateBulkBar();
    }

    function onRowCheck() {
      // Khi user bỏ chọn 1 row riêng lẻ → thoát chế độ select all filtered
      _selectAllFiltered = false;
      _allFilteredIds = [];
      updateBulkBar();
    }

    function updateBulkBar() {
      const pageChecked = [];
      document.querySelectorAll('#contact-tbody tr').forEach(tr => {
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb?.checked && tr.dataset.id) pageChecked.push(tr.dataset.id);
      });
      const bar = document.getElementById('bulk-bar');
      const countEl = document.getElementById('bulk-count');
      const chkAll = document.getElementById('chk-all');
      const totalOnPage = document.querySelectorAll('#contact-tbody input[type=checkbox]').length;
      const allPageChecked = totalOnPage > 0 && pageChecked.length === totalOnPage;

      if (pageChecked.length > 0 || _selectAllFiltered) {
        bar.style.display = 'flex';
        // Hiện số lượng đã chọn
        if (_selectAllFiltered) {
          countEl.innerHTML = `<strong>${_allFilteredIds.length.toLocaleString()}</strong> contacts (tất cả theo bộ lọc)`;
        } else {
          countEl.textContent = `${pageChecked.length} đã chọn`;
        }
        // Điền level options vào bulk select
        const sel = document.getElementById('bulk-level-sel');
        sel.innerHTML = '<option value="">Đổi level → chọn level</option>' +
          levels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
      } else {
        bar.style.display = 'none';
      }
      if (chkAll) chkAll.indeterminate = pageChecked.length > 0 && pageChecked.length < totalOnPage;
      if (chkAll) chkAll.checked = totalOnPage > 0 && pageChecked.length === totalOnPage;

      // Hiện banner "Chọn tất cả X contacts theo bộ lọc" khi đã chọn hết trang
      let banner = document.getElementById('select-all-filtered-banner');
      if (allPageChecked && !_selectAllFiltered && totalContacts > totalOnPage) {
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'select-all-filtered-banner';
          banner.style.cssText = 'width:100%;text-align:center;padding:8px 0;font-size:13px;color:var(--text);margin-top:4px;';
          bar.appendChild(banner);
        }
        banner.innerHTML = `Đã chọn <strong>${pageChecked.length}</strong> contacts trên trang này. ` +
          `<a href="#" onclick="selectAllFiltered();return false" style="color:var(--accent2);font-weight:700;text-decoration:underline">` +
          `Chọn tất cả ${totalContacts.toLocaleString()} contacts theo bộ lọc hiện tại</a>`;
        banner.style.display = '';
      } else if (banner) {
        banner.style.display = 'none';
      }
    }

    async function selectAllFiltered() {
      toast('Đang tải tất cả contacts theo bộ lọc...', 'ok');
      try {
        const levelId = currentFilter === 'all' ? undefined : currentFilter;
        const search = document.querySelector('.tbl-search')?.value || '';
        const tagsParam = selectedTags.length ? selectedTags.join(',') : undefined;
        let url = '/api/contacts?action=all-ids';
        if (levelId) url += `&levelId=${levelId}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (tagsParam) url += `&tags=${encodeURIComponent(tagsParam)}&tagMode=${tagFilterMode}`;
        _allFilteredIds = await apiFetch(url);
        _selectAllFiltered = true;
        updateBulkBar();
        toast(`✓ Đã chọn tất cả ${_allFilteredIds.length.toLocaleString()} contacts theo bộ lọc`, 'ok');
      } catch (e) {
        toast('Lỗi tải danh sách: ' + e.message, 'err');
      }
    }

    function clearSelection() {
      document.querySelectorAll('#contact-tbody input[type=checkbox]').forEach(c => c.checked = false);
      _selectAllFiltered = false;
      _allFilteredIds = [];
      updateBulkBar();
    }

    async function bulkDelete() {
      const ids = getCheckedContactIds();
      if (!ids.length) return;
      if (!confirm(`Xoá ${ids.length} contacts đã chọn? Hành động này không thể hoàn tác!`)) return;

      const deleteCount = ids.length;
      // Xoá optimistic trước — loại bỏ contacts đã chọn khỏi danh sách hiện tại
      const idSet = new Set(ids);
      contacts = contacts.filter(c => !idSet.has(c.id));
      totalContacts = Math.max(0, totalContacts - deleteCount);
      renderContactTable('', true);
      updateBulkBar();
      renderSidebar();
      toast(`Đang xoá ${deleteCount} contacts...`, 'warn');

      // Xoá trên Supabase bằng API bulk-delete — 1 request thay vì n request
      if (window._backendConnected && ids.length) {
        try {
          const result = await apiFetch('/api/contacts?action=bulk-delete', {
            method: 'DELETE',
            body: JSON.stringify({ ids })
          });
          clearCache();
          toast(`✓ Đã xoá ${result.deleted || deleteCount} contacts khỏi database`, 'ok');
          // Refresh lại từ server để đồng bộ số lượng chính xác
          refreshContacts();
          scheduleRefresh();
        } catch (e) {
          toast('Lỗi xoá trên server: ' + e.message, 'err');
          refreshContacts();
        }
      }
    }

    async function bulkChangeLevel() {
      const ids = getCheckedContactIds();
      const levelId = document.getElementById('bulk-level-sel').value;
      if (!ids.length) return;
      if (!levelId) { toast('Chọn level muốn đổi!', 'err'); return; }

      const lv = getLevelById(levelId);
      const idSet = new Set(ids);
      contacts.forEach(c => {
        if (idSet.has(c.id)) { c.level_id = levelId; c.level = lv?.name || ''; }
      });
      renderContactTable('', true); scheduleRefresh();
      toast(`Đã đổi level ${ids.length} contacts → ${lv?.name}`);

      // Cập nhật trên Supabase
      if (window._backendConnected) {
        for (const id of ids) {
          try { await apiFetch('/api/contacts?action=level', { method: 'PATCH', body: JSON.stringify({ id, levelId }) }); }
          catch (_) { }
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
      totalContacts = Math.max(0, totalContacts - 1);
      renderContactTable('', true);
      renderSidebar();
      toast('Đã xoá contact', 'warn');
      if (window._backendConnected && c.id) {
        try {
          await apiFetch('/api/contacts?id=' + c.id, { method: 'DELETE' });
          clearCache();
          refreshContacts();
          scheduleRefresh();
        } catch (e) { toast('Lỗi xóa trên server: ' + e.message, 'err'); }
      }
    }

    // ════════════════════════════════════════
    // VISUAL EDITOR
    // ════════════════════════════════════════
    // QUIL JS INTEGRATION
    let tmplQuill = null;
    let campQuill = null;
    let _veReady = false;
    let _codeSyncTimer = null;

    function initVisualEditor(html) {
      if (!tmplQuill) {
        tmplQuill = new Quill('#ve-quill', {
          theme: 'snow',
          modules: {
            toolbar: [
              [{ 'header': [1, 2, 3, false] }],
              ['bold', 'italic', 'underline', 'strike'],
              [{ 'color': [] }, { 'background': [] }],
              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
              [{ 'align': [] }],
              ['link', 'image', 'clean']
            ]
          }
        });
        
        tmplQuill.getModule('toolbar').addHandler('image', () => {
          openImageDialog();
        });

        tmplQuill.on('text-change', () => {
          clearTimeout(_codeSyncTimer);
          _codeSyncTimer = setTimeout(syncVisualToCode, 300);
        });
      }

      const rawContent = html || document.getElementById('tmpl-code').value || '';
      tmplQuill.clipboard.dangerouslyPasteHTML(rawContent);
      _veReady = true;
    }

    function syncVisualToCode() {
      if (!_veReady) return;
      document.getElementById('tmpl-code').value = tmplQuill.root.innerHTML;
      updatePreviewFrame();
    }

    function syncCodeToVisual() {
      if (!_veReady || !tmplQuill) return;
      tmplQuill.clipboard.dangerouslyPasteHTML(document.getElementById('tmpl-code').value);
    }

    function onCodeInput() {
      clearTimeout(_codeSyncTimer);
      _codeSyncTimer = setTimeout(() => {
        syncCodeToVisual();
        updatePreviewFrame();
      }, 500);
    }

    function veExec(cmd, val) {} 
    function veExecBlock(tag) {} 

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

      [codePane, visualPane, previewPane].forEach(p => { if (p) p.style.display = 'none'; });
      if (veToolbar) veToolbar.style.display = 'none';

      if (mode === 'visual') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        visualPane.style.display = '';
        if (!_veReady) initVisualEditor();
        else syncCodeToVisual();
      } else if (mode === 'split') {
        area.style.gridTemplateColumns = '1fr 1fr';
        area.classList.add('split-mode');
        codePane.style.display = '';
        visualPane.style.display = '';
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

    // New Campaign Quill logic
    function initCampaignQuill() {
      if (!campQuill) {
        campQuill = new Quill('#c-quill', {
          theme: 'snow',
          modules: {
            toolbar: [
              [{ 'header': [1, 2, 3, false] }],
              ['bold', 'italic', 'underline', 'strike'],
              [{ 'color': [] }, { 'background': [] }],
              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
              [{ 'align': [] }],
              ['link', 'image', 'clean']
            ]
          }
        });
        campQuill.getModule('toolbar').addHandler('image', () => {
          openImageDialog();
        });
        campQuill.on('text-change', () => {
          updateCampaignCodeFromQuill();
        });
      }
    }

    function updateCampaignCodeFromQuill() {
      if (campQuill) {
        document.getElementById('c-body').value = campQuill.root.innerHTML;
        updateCampaignPreview();
      }
    }

    function updateCampaignQuillFromCode() {
      if (campQuill) {
        campQuill.clipboard.dangerouslyPasteHTML(document.getElementById('c-body').value);
      }
    }

    // Shared preview renderer — dùng chung cho template editor và campaign
    const PREVIEW_SAMPLE = { name: 'Nguyễn Văn A', email: 'sample@ucmas.vn', level: 'L1', company: 'UCMAS', child_name: 'Bé Nguyễn Văn B', ten_con: 'Bé Nguyễn Văn B', date: new Date().toLocaleDateString('vi-VN') };
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

      const html = `<a href="${url}" target="${target}">${text || url}</a>`;

      if (typeof tmplQuill !== 'undefined' && tmplQuill && (editorMode === 'visual' || editorMode === 'split')) {
          const range = tmplQuill.getSelection(true);
          if (range) tmplQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else tmplQuill.clipboard.dangerouslyPasteHTML(tmplQuill.getLength(), html);
          syncVisualToCode();
      } else if (typeof campQuill !== 'undefined' && campQuill && document.getElementById('c-body-code-wrap').style.display !== 'none') {
          const range = campQuill.getSelection(true);
          if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), html);
          updateCampaignCodeFromQuill();
      } else {
          insertTmplVar(html);
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

      if (typeof tmplQuill !== 'undefined' && tmplQuill && document.getElementById('modal-image').classList.contains('open') && document.getElementById('ve-quill')) {
          const range = tmplQuill.getSelection(true);
          if (range) tmplQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else tmplQuill.clipboard.dangerouslyPasteHTML(tmplQuill.getLength(), html);
          syncVisualToCode();
      } else if (typeof campQuill !== 'undefined' && campQuill) {
          const range = campQuill.getSelection(true);
          if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), html);
          updateCampaignCodeFromQuill();
      } else {
          insertTmplVar(html);
      }
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
      if ((editorMode === 'visual' || editorMode === 'split') && typeof tmplQuill !== 'undefined' && tmplQuill) {
        const range = tmplQuill.getSelection(true);
        if (range) tmplQuill.clipboard.dangerouslyPasteHTML(range.index, v);
        else tmplQuill.clipboard.dangerouslyPasteHTML(tmplQuill.getLength(), v);
        syncVisualToCode();
        return;
      }
      const ta = document.getElementById('tmpl-code');
      const s = ta.selectionStart || 0;
      ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd || ta.value.length);
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
      if (typeof campQuill !== 'undefined' && campQuill) {
          campQuill.clipboard.dangerouslyPasteHTML(t.body);
      }
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
      if (tab === 'code') {
        if (typeof initCampaignQuill === 'function') {
            initCampaignQuill();
            updateCampaignQuillFromCode();
        }
      }
      if (tab === 'preview') updateCampaignPreview();
    }

    function updateCampaignPreview() {
      const code = document.getElementById('c-body').value;
      renderEmailPreview(code, document.getElementById('c-preview-frame'));
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
          const child_name = parts[3] || '';
          return { email: email.toLowerCase(), name, company, child_name };
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
        child_name: r.child_name || '',
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

function insertCampaignVar(v) {
      if (typeof campQuill !== 'undefined' && campQuill && document.getElementById('c-body-code-wrap').style.display !== 'none') {
        const range = campQuill.getSelection(true);
        if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, v);
        else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), v);
        updateCampaignCodeFromQuill();
      } else {
        const ta = document.getElementById('c-body');
        const s = ta.selectionStart || 0;
        ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd || ta.value.length);
        ta.selectionStart = ta.selectionEnd = s + v.length;
        ta.focus();
        if (typeof campQuill !== 'undefined' && campQuill) campQuill.clipboard.dangerouslyPasteHTML(ta.value);
        updateCampaignPreview();
      }
    }
