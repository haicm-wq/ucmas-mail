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
          const hasLevel = !levelIds.length || levelIds.some(lid => (c.level_ids || [c.level_id]).includes(lid));
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
