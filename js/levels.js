    // ════════════════════════════════════════
    // LEVEL HELPERS
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
