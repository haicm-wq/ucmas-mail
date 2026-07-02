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
        child_name: c.child_name || '',
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
            cache: 'no-store',
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
      const statusLabel = s => s === 'completed' ? 'hoàn thành' : s === 'sending' ? 'đang gửi' : s === 'paused' ? 'dừng' : s === 'failed' ? 'thất bại' : s;
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
        <div class="h-sent" style="color:${statusColor(c.status)}">${c.sent_count || 0}/${total || '?'}</div>
        <div class="h-rate">${total > 0 ? pct + '%' : statusLabel(c.status)}</div>
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
      const sI = s => s === 'completed' ? 'ok' : s === 'failed' ? 'err' : s === 'sending' ? 'run' : 'partial'; // 'partial' → CSS class (không phải enum DB)
      body.innerHTML = _histCampaigns.map(c => {
        const total = (c.sent_count||0) + (c.failed_count||0);
        const trk = c.tracking || {};
        const oR = c.sent_count > 0 ? Math.round((trk.opened||0)/c.sent_count*100) : 0;
        const cR = c.sent_count > 0 ? Math.round((trk.clicked||0)/c.sent_count*100) : 0;
        const sd = c.sent_at ? new Date(c.sent_at) : null;
        const active = sd && (Date.now()-sd.getTime()) < TRK_MAX_AGE;
        const tl = active ? '<span style="color:var(--ok);font-size:10px">● tracking</span>' : (sd ? '<span style="font-size:10px;color:var(--muted)">hết hạn</span>' : '');
        const isPartial  = c.status === 'sending' || c.status === 'paused';
        const isSending  = c.status === 'sending';
        const canResume  = c.status === 'paused';
        const isComplete = c.status === 'completed';
        // Badge trạng thái
        const statusBadge = isComplete
          ? ` <span style="color:#3de8a0;font-size:10px;font-weight:600">✅ hoàn thành (${c.sent_count} đã gửi)</span>`
          : isSending
          ? ` <span class="sending-badge" style="color:#f5a623;font-size:10px;font-weight:600">⟳ đang gửi...</span>`
          : isPartial
          ? ` <span style="color:#f5a623;font-size:10px;font-weight:600">⏸ đang dở (${c.sent_count} đã gửi)</span>`
          : '';
        return `<div class="trk-campaign" id="trk-camp-${c.id}">
  <div class="trk-campaign-row" onclick="toggleCampaignDetail('${c.id}')">
    <div class="h-icon ${sI(c.status)}">✉</div>
    <div style="flex:1;min-width:140px">
      <div class="h-title">${c.name}</div>
      <div class="h-meta">${(c.target_levels||[]).map((l,i)=>`<span class="lt lt${(i%4)+1}">${l}</span>`).join('')} · ${sd?sd.toLocaleDateString('vi-VN'):'—'} ${tl}${statusBadge}</div>
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

      // Gán filter tags cho mỗi email
      list.forEach(em => {
        em.filters = [];
        if (em.status === 'sent') em.filters.push('sent');
        if (em.status === 'failed') em.filters.push('failed');
        if (em.ev.includes('delivered')) em.filters.push('delivered');
        if (em.ev.includes('opened')) em.filters.push('opened');
        if (em.ev.includes('clicked')) em.filters.push('clicked');
        if (em.ev.includes('bounced')) em.filters.push('bounced');
        if (em.ev.includes('complained')) em.filters.push('spam');
      });

      const tblId = 'trk-tbl-' + campId;
      const filterId = 'trk-filter-' + campId;
      const countId = 'trk-fcount-' + campId;

      container.innerHTML = `<div class="trk-detail-inner">
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
    <div class="trk-rate-bar"><div class="trk-rate-hd"><span>Delivery</span><span style="color:#3de8a0">${dR}%</span></div><div class="trk-rate-bg"><div class="trk-rate-fill" style="width:${dR}%;background:#3de8a0"></div></div></div>
    <div class="trk-rate-bar"><div class="trk-rate-hd"><span>Open Rate</span><span style="color:#4f6cff">${oR}%</span></div><div class="trk-rate-bg"><div class="trk-rate-fill" style="width:${oR}%;background:#4f6cff"></div></div></div>
    <div class="trk-rate-bar"><div class="trk-rate-hd"><span>Click Rate</span><span style="color:#c97ef5">${cR}%</span></div><div class="trk-rate-bg"><div class="trk-rate-fill" style="width:${cR}%;background:#c97ef5"></div></div></div>
  </div>
  <div id="${filterId}" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;font-family:var(--fm)">
    <span class="trk-stat-btn active" data-filter="all" onclick="filterCampaignEmails('${campId}','all',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">📋 Tất cả: <b>${list.length}</b></span>
    <span class="trk-stat-btn" data-filter="sent" onclick="filterCampaignEmails('${campId}','sent',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">📨 Gửi: <b>${stats.total_sent}</b></span>
    <span class="trk-stat-btn" data-filter="delivered" onclick="filterCampaignEmails('${campId}','delivered',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">📬 Delivered: <b style="color:#3de8a0">${stats.delivered}</b></span>
    <span class="trk-stat-btn" data-filter="opened" onclick="filterCampaignEmails('${campId}','opened',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">👁 Opens: <b style="color:#4f6cff">${stats.unique_opens}</b></span>
    <span class="trk-stat-btn" data-filter="clicked" onclick="filterCampaignEmails('${campId}','clicked',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">🔗 Clicks: <b style="color:#c97ef5">${stats.unique_clicks}</b></span>
    ${stats.bounced?`<span class="trk-stat-btn" data-filter="bounced" onclick="filterCampaignEmails('${campId}','bounced',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">⚠ Bounce: <b style="color:#ff7eb3">${stats.bounced}</b></span>`:''}
    ${stats.complained?`<span class="trk-stat-btn" data-filter="spam" onclick="filterCampaignEmails('${campId}','spam',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">🚫 Spam: <b style="color:#ff5757">${stats.complained}</b></span>`:''}
    ${stats.total_failed?`<span class="trk-stat-btn" data-filter="failed" onclick="filterCampaignEmails('${campId}','failed',this)" style="cursor:pointer;padding:3px 10px;border-radius:12px;border:1px solid var(--border);transition:all .2s">❌ Failed: <b style="color:var(--err)">${stats.total_failed}</b></span>`:''}
  </div>
  <div style="font-weight:600;font-size:12px;margin-bottom:6px">📋 <span id="${countId}">Chi tiết từng email (${list.length})</span></div>
  <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
    <table style="width:100%;font-size:11px;border-collapse:collapse" id="${tblId}">
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
        return `<tr style="border-top:1px solid var(--border)" data-filters="${em.filters.join(',')}">
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

      // Highlight nút "Tất cả" mặc định
      const allBtn = container.querySelector('.trk-stat-btn.active');
      if (allBtn) { allBtn.style.background = 'var(--accent)'; allBtn.style.color = '#fff'; allBtn.style.borderColor = 'var(--accent)'; }
    }

    // ── Lọc email trong campaign detail theo trạng thái ──
    const _filterColors = {
      all:'var(--accent)', sent:'#5ba8ff', delivered:'#3de8a0',
      opened:'#4f6cff', clicked:'#c97ef5', bounced:'#ff7eb3',
      spam:'#ff5757', failed:'#ef4444',
    };
    function filterCampaignEmails(campId, filter, btn) {
      const tbl = document.getElementById('trk-tbl-' + campId);
      const countEl = document.getElementById('trk-fcount-' + campId);
      const filterBar = document.getElementById('trk-filter-' + campId);
      if (!tbl) return;

      // Reset tất cả nút filter
      if (filterBar) {
        filterBar.querySelectorAll('.trk-stat-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = ''; b.style.color = ''; b.style.borderColor = 'var(--border)';
        });
      }
      // Highlight nút active
      if (btn) {
        btn.classList.add('active');
        const col = _filterColors[filter] || 'var(--accent)';
        btn.style.background = col; btn.style.color = '#fff'; btn.style.borderColor = col;
      }

      const rows = tbl.querySelectorAll('tbody tr');
      let shown = 0;
      rows.forEach(row => {
        if (filter === 'all') {
          row.style.display = '';
          shown++;
        } else {
          const filters = (row.getAttribute('data-filters') || '').split(',');
          if (filters.includes(filter)) {
            row.style.display = '';
            shown++;
          } else {
            row.style.display = 'none';
          }
        }
      });

      // Cập nhật label
      const filterNames = {all:'Tất cả',sent:'Đã gửi',delivered:'Delivered',opened:'Đã mở',clicked:'Đã click',bounced:'Bounce',spam:'Spam',failed:'Failed'};
      if (countEl) countEl.textContent = `${filterNames[filter]||filter} (${shown})`;
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
    window._killSwitchActive = false;

    // ── KILL SWITCH TOÀN HỆ THỐNG ──────────────────────────────
    function applyKillSwitchUI(active) {
      window._killSwitchActive = active;
      const btn    = document.getElementById('kill-switch-btn');
      const banner = document.getElementById('kill-switch-banner');
      if (!btn || !banner) return;

      if (active) {
        // Trạng thái KHOÁ — nút chuyển sang "Mở khoá"
        btn.style.background     = 'linear-gradient(135deg,#16a34a,#15803d)';
        btn.style.boxShadow      = '0 0 12px rgba(22,163,74,.4)';
        btn.innerHTML            = '<span style="font-size:14px">✅</span> Mở khoá hệ thống';
        banner.style.display     = 'block';

        // Dừng frontend ngay lập tức
        window._stopCampaign = true;
        clearTimeout(window._resumeTimer);
        window._sendingCampaignId = null;
      } else {
        // Trạng thái BÌNH THƯỜNG — nút đỏ
        btn.style.background     = 'linear-gradient(135deg,#dc2626,#991b1b)';
        btn.style.boxShadow      = '0 0 12px rgba(220,38,38,.4)';
        btn.innerHTML            = '<span style="font-size:14px">⛔</span> Dừng khẩn cấp';
        banner.style.display     = 'none';
        window._stopCampaign     = false;
      }
    }

    async function toggleKillSwitch() {
      const active = !window._killSwitchActive;

      if (active) {
        // Kích hoạt kill switch — hiện confirm
        if (!confirm('⛔ Dừng khẩn cấp toàn hệ thống?\n\nThao tác này sẽ:\n• Dừng tất cả campaign đang gửi ngay lập tức\n• Khoá hệ thống không cho gửi thêm email\n• Cần mở khoá thủ công để tiếp tục\n\nBạn có chắc chắn?')) return;
      }

      const btn = document.getElementById('kill-switch-btn');
      btn.disabled    = true;
      btn.textContent = '⏳ Đang xử lý...';

      try {
        const action = active ? 'stop' : 'resume';
        const result = await apiFetch(`/api/campaigns-send?emergency=${action}`, { method: 'POST' });

        applyKillSwitchUI(active);

        if (active) {
          toast(`⛔ Đã khoá hệ thống! ${result.campaignsPaused || 0} campaign bị dừng.`, 'err');
          refreshTracking();
        } else {
          toast('✅ Hệ thống đã mở khoá. Bạn có thể gửi email trở lại.', 'ok');
        }
      } catch (e) {
        toast('Lỗi: ' + e.message, 'err');
        // Rollback UI
        btn.disabled = false;
        applyKillSwitchUI(window._killSwitchActive);
      } finally {
        btn.disabled = false;
      }
    }

    // Kiểm tra trạng thái kill switch khi tải trang
    async function checkKillSwitchOnLoad() {
      try {
        const result = await apiFetch('/api/campaigns-send?emergency=status');
        if (result.killSwitchActive) applyKillSwitchUI(true);
      } catch (_) { /* bỏ qua nếu API chưa có */ }
    }

    async function stopCampaign() {
      window._stopCampaign = true;
      
      const btnStop = document.getElementById('btn-stop-campaign');
      const btnResume = document.getElementById('btn-resume-campaign');
      if (btnStop) btnStop.style.display = 'none';
      if (btnResume) btnResume.style.display = '';
      const progLbl = document.querySelector('.prog-lbl');
      if (progLbl) progLbl.textContent = '⏸ Đã dừng — bấm Tiếp tục để gửi tiếp';

      const cid = window._sendingCampaignId;
      if (!cid) return; 
      
      try {
        await apiFetch(`/api/campaigns-send?stop=${cid}`, { method: 'POST' });
        toast('⏸ Đã dừng gửi campaign');
      } catch (e) { toast('Lỗi dừng: ' + e.message, 'err'); }
      
      window._lastPausedCampaignId = cid;
      window._sendingCampaignId = null;
      refreshTracking();
    }

    // Tiếp tục gửi từ trang Campaign (bấm nút trên progress bar)
    function resumeFromCampaignPage() {
      const cid = window._lastPausedCampaignId;
      if (!cid) { toast('Không tìm thấy campaign để gửi tiếp. Vào History → Gửi tiếp.', 'err'); return; }
      // Reset UI progress bar
      const btnStop = document.getElementById('btn-stop-campaign');
      const btnResume = document.getElementById('btn-resume-campaign');
      if (btnStop) btnStop.style.display = '';
      if (btnResume) btnResume.style.display = 'none';
      const progLbl = document.querySelector('.prog-lbl');
      if (progLbl) progLbl.textContent = 'Đang gửi tiếp campaign...';
      const prog = document.getElementById('send-progress');
      if (prog) { prog.classList.add('active'); prog.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      // Gọi resumeCampaign
      resumeCampaign(cid);
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

      // ── Cập nhật History UI ngay lập tức → hiện trạng thái "đang gửi" ──
      updateCampaignCardUI(campaignId, 'sending');

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
        window._lastPausedCampaignId = campaignId;
        toast('⏸ Đã dừng gửi.');
        updateCampaignCardUI(campaignId, 'paused');
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
        updateCampaignCardUI(campaignId, 'paused');
        refreshTracking();
      }
    }

    /**
     * Cập nhật UI campaign card trong History ngay lập tức (không cần chờ API refresh).
     * Giải quyết lỗi: bấm Gửi tiếp nhưng UI không đổi → bấm lại → báo trùng.
     */
    function updateCampaignCardUI(campaignId, newStatus) {
      const card = document.getElementById('trk-camp-' + campaignId);
      if (!card) return;
      const row = card.querySelector('.trk-campaign-row');
      if (!row) return;

      // Tìm và xoá các nút cũ (Gửi tiếp / Dừng)
      const oldBtns = row.querySelectorAll('.campaign-action-btn');
      oldBtns.forEach(b => b.remove());

      // Tìm expand icon để insert trước nó
      const expandIcon = row.querySelector('.trk-expand-icon');

      if (newStatus === 'sending') {
        // Đang gửi → hiện nút Dừng + badge "đang gửi"
        const stopBtn = document.createElement('button');
        stopBtn.className = 'abtn campaign-action-btn';
        stopBtn.style.cssText = 'font-size:10px;padding:2px 8px;color:#ff7eb3;border-color:#ff7eb3';
        stopBtn.innerHTML = '⏹ Dừng';
        stopBtn.onclick = (e) => { e.stopPropagation(); stopCampaignById(campaignId); };
        if (expandIcon) row.insertBefore(stopBtn, expandIcon);
        else row.appendChild(stopBtn);

        // Cập nhật icon status
        const icon = card.querySelector('.h-icon');
        if (icon) { icon.className = 'h-icon run'; }

        // Cập nhật meta text
        const meta = card.querySelector('.h-meta');
        if (meta) {
          // Xoá badge trạng thái cũ nếu có
          const oldBadge = meta.querySelector('.sending-badge');
          if (oldBadge) oldBadge.remove();
          const badge = document.createElement('span');
          badge.className = 'sending-badge';
          badge.style.cssText = 'color:#f5a623;font-size:10px;font-weight:600;margin-left:4px';
          badge.innerHTML = '⟳ đang gửi...';
          meta.appendChild(badge);
        }
      } else if (newStatus === 'paused') {
        // Đã dừng → hiện nút Gửi tiếp
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'abtn campaign-action-btn';
        resumeBtn.style.cssText = 'font-size:10px;padding:2px 8px;color:#f5a623;border-color:#f5a623';
        resumeBtn.innerHTML = '▶ Gửi tiếp';
        resumeBtn.onclick = (e) => { e.stopPropagation(); resumeCampaign(campaignId); };
        if (expandIcon) row.insertBefore(resumeBtn, expandIcon);
        else row.appendChild(resumeBtn);

        // Cập nhật icon
        const icon = card.querySelector('.h-icon');
        if (icon) { icon.className = 'h-icon partial'; }

        // Cập nhật badge
        const meta = card.querySelector('.h-meta');
        if (meta) {
          const oldBadge = meta.querySelector('.sending-badge');
          if (oldBadge) oldBadge.remove();
          const badge = document.createElement('span');
          badge.className = 'sending-badge';
          badge.style.cssText = 'color:#f5a623;font-size:10px;font-weight:600;margin-left:4px';
          badge.innerHTML = '⏸ đang dở';
          meta.appendChild(badge);
        }
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
          child_name: c.child_name || '',
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

      // Reset trạng thái stop/resume
      window._stopCampaign = false;
      const btnStop = document.getElementById('btn-stop-campaign');
      const btnResume = document.getElementById('btn-resume-campaign');
      if (btnStop) btnStop.style.display = '';
      if (btnResume) btnResume.style.display = 'none';
      const progLbl = document.querySelector('.prog-lbl');
      if (progLbl) progLbl.textContent = 'Đang gửi campaign...';

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

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Lỗi API Backend');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (window._stopCampaign) { reader.cancel(); break; }
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
              if (data.paused || data.killed) {
                // Campaign bị dừng giữa chừng → hiện nút tiếp tục
                window._lastPausedCampaignId = data.campaignId;
                window._sendingCampaignId = null;
                const pct = data.total > 0 ? Math.round(data.sent / data.total * 100) : 0;
                document.getElementById('prog-fill').style.width = pct + '%';
                document.getElementById('prog-pct').textContent = pct + '%';
                const bStop = document.getElementById('btn-stop-campaign');
                const bResume = document.getElementById('btn-resume-campaign');
                if (bStop) bStop.style.display = 'none';
                if (bResume) bResume.style.display = '';
                const pLbl = document.querySelector('.prog-lbl');
                if (pLbl) pLbl.textContent = `⏸ Đã dừng — ${data.sent}/${data.total} đã gửi`;
                toast(`⏸ Đã dừng: ${data.sent}/${data.total} đã gửi. Bấm Tiếp tục để gửi tiếp.`);
              } else {
                ['ps1', 'ps2', 'ps3', 'ps4'].forEach(s => document.getElementById(s).className = 'pstep done');
                document.getElementById('prog-fill').style.width = '100%';
                document.getElementById('prog-pct').textContent = '100%';
                setTimeout(() => {
                  prog.classList.remove('active');
                  toast(`Đã gửi xong! ${data.sent}/${data.total} thành công.`);
                  gotoPage('history');
                }, 600);
              }
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
          checkKillSwitchOnLoad(); // kiểm tra kill switch khi tải trang
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
        checkKillSwitchOnLoad(); // kiểm tra kill switch khi tải trang
      }
    }

    startup();

    async function saveCampaignDraft() {
      if (!window._backendConnected) { toast('Lưu nháp chỉ hoạt động khi kết nối backend', 'err'); return; }
      
      const name = document.getElementById('c-name').value.trim();
      const from = document.getElementById('c-from').value.trim();
      const subject = document.getElementById('c-subject').value.trim();
      let body = document.getElementById('c-body').value.trim();
      
      if (!name) { toast('Chưa nhập tên Campaign!', 'err'); return; }
      // Cho phép lưu nháp không cần tiêu đề, nội dung hoặc phân cấp
      
      const selectedLevelIds = [];
      document.querySelectorAll('.seg-cb').forEach(cb => {
        if (cb.checked) selectedLevelIds.push(cb.value);
      });

      const btn = document.getElementById('btn-save-campaign');
      const oldTxt = btn.textContent;
      btn.textContent = 'Đang lưu...';
      btn.disabled = true;

      try {
        const result = await apiFetch('/api/campaigns-send?save_draft=1', {
          method: 'POST',
          body: JSON.stringify({
            name, from_name: from, from_email: document.getElementById('c-from-email').value || '',
            subject, body_text: body, target_level_ids: selectedLevelIds,
          }),
        });
        toast('✅ Đã lưu nháp campaign! Bạn có thể xem và gửi tiếp ở mục History.');
        refreshTracking();
      } catch (e) {
        toast('Lỗi lưu nháp: ' + e.message, 'err');
      } finally {
        btn.textContent = oldTxt;
        btn.disabled = false;
      }
    }
