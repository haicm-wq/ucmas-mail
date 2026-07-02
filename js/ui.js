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
