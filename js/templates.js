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

