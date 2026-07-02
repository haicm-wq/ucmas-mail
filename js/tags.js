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
      const ids = getCheckedContactIds();
      const tag = document.getElementById('bulk-tag-input').value.trim();
      if (!ids.length) return;
      if (!tag) { toast('Nhập tag muốn gắn!', 'err'); return; }

      const idSet = new Set(ids);
      contacts.forEach(c => {
        if (idSet.has(c.id)) {
          if (!c.tags) c.tags = [];
          if (!c.tags.includes(tag)) c.tags.push(tag);
        }
      });
      renderContactTable('', true);
      toast(`Đã gắn tag "${tag}" cho ${ids.length} contacts`);

      if (window._backendConnected && ids.length) {
        try {
          await apiFetch('/api/contacts?action=bulk-tag', { method: 'PATCH', body: JSON.stringify({ ids, tag }) });
          loadAllTags();
        } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
      }
    }

    async function bulkRemoveTagAction() {
      const ids = getCheckedContactIds();
      const tag = document.getElementById('bulk-tag-input').value.trim();
      if (!ids.length) return;
      if (!tag) { toast('Nhập tag muốn gỡ!', 'err'); return; }

      const idSet = new Set(ids);
      contacts.forEach(c => {
        if (idSet.has(c.id)) c.tags = (c.tags || []).filter(t => t !== tag);
      });
      renderContactTable('', true);
      toast(`Đã gỡ tag "${tag}" khỏi ${ids.length} contacts`, 'warn');

      if (window._backendConnected && ids.length) {
        try {
          await apiFetch('/api/contacts?action=bulk-untag', { method: 'PATCH', body: JSON.stringify({ ids, tag }) });
          loadAllTags();
        } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
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
