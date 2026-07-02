    // ════════════════════════════════════════
    // CONTACTS
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

    // Get UUIDs of all checked rows — hoặc tất cả filtered IDs nếu đang ở chế độ select all
    function getCheckedContactIds() {
      if (_selectAllFiltered && _allFilteredIds.length > 0) {
        return _allFilteredIds;
      }
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
