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
