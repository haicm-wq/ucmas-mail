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
