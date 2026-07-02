    // ════════════════════════════════════════
    // GOOGLE SHEETS
    // ════════════════════════════════════════
    const SHEETS_KEY = 'ucmas_sheets';
    let _autoSyncTimer = null;

    function getSheetsConfig() {
      try { return JSON.parse(localStorage.getItem(SHEETS_KEY) || '{}'); } catch { return {}; }
    }

    function openSheetsModal() {
      const cfg = getSheetsConfig();
      document.getElementById('gs-import-url').value = cfg.importUrl || '';
      document.getElementById('gs-webhook-url').value = cfg.webhookUrl || '';
      updateAutoSyncBtn();
      document.getElementById('modal-sheets').classList.add('open');
    }

    function saveSheetSettings() {
      const cfg = {
        importUrl: document.getElementById('gs-import-url').value.trim(),
        webhookUrl: document.getElementById('gs-webhook-url').value.trim(),
        autoSync: getSheetsConfig().autoSync || false,
      };
      localStorage.setItem(SHEETS_KEY, JSON.stringify(cfg));
      closeModal('modal-sheets');
      toast('Đã lưu cài đặt Google Sheets');
    }

    // ── Import contacts từ Google Sheet ────
    async function importFromSheets() {
      const url = document.getElementById('gs-import-url').value.trim() || getSheetsConfig().importUrl;
      if (!url) { toast('Nhập URL Google Sheet trước!', 'err'); return; }

      const btn = document.querySelector('#modal-sheets .btn-primary');
      if (btn) { btn.textContent = 'Đang đồng bộ...'; btn.disabled = true; }

      try {
        // Dùng api proxy để tránh CORS
        const res = await fetch('/api/sheets-proxy?url=' + encodeURIComponent(url), {
          headers: cfgHeaders(), signal: AbortSignal.timeout(15000),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        toast(`Đồng bộ xong: ${json.data.imported} contacts, ${json.data.skipped} bỏ qua`);

        // Reload contacts — dùng transformContact() để không drop tags
        clearCache();
        await loadContactsPage();
        scheduleRefresh();

        // Lưu URL
        const cfg = getSheetsConfig();
        cfg.importUrl = url;
        cfg.lastSync = new Date().toLocaleString('vi-VN');
        localStorage.setItem(SHEETS_KEY, JSON.stringify(cfg));

      } catch (e) { toast('Lỗi đồng bộ: ' + e.message, 'err'); }
      finally {
        if (btn) { btn.textContent = '↓ Đồng bộ ngay'; btn.disabled = false; }
      }
    }

    // ── Auto-sync ───────────────────────────
    function toggleAutoSync() {
      const cfg = getSheetsConfig();
      cfg.autoSync = !cfg.autoSync;
      localStorage.setItem(SHEETS_KEY, JSON.stringify(cfg));
      updateAutoSyncBtn();
      if (cfg.autoSync) {
        startAutoSync();
        toast('Tự động đồng bộ mỗi 5 phút');
      } else {
        if (_autoSyncTimer) clearInterval(_autoSyncTimer);
        toast('Đã tắt tự động đồng bộ', 'warn');
      }
    }

    function updateAutoSyncBtn() {
      const cfg = getSheetsConfig();
      const btn = document.getElementById('btn-autosync');
      if (!btn) return;
      btn.textContent = cfg.autoSync ? '⟳ Tự động (bật)' : '⟳ Tự động (tắt)';
      btn.style.color = cfg.autoSync ? 'var(--ok)' : '';
      btn.style.borderColor = cfg.autoSync ? 'var(--ok)' : '';
    }

    function startAutoSync() {
      if (_autoSyncTimer) clearInterval(_autoSyncTimer);
      _autoSyncTimer = setInterval(() => {
        const cfg = getSheetsConfig();
        if (cfg.autoSync && cfg.importUrl) importFromSheets();
      }, 5 * 60 * 1000); // 5 phút
    }

    // ── Ghi lịch sử gửi về Google Sheet ────
    async function syncLogsToSheet(campaignId, campaignName, results) {
      const cfg = getSheetsConfig();
      if (!cfg.webhookUrl || !results?.length) return;
      try {
        const rows = results.map(r => ({
          email: r.email,
          name: contacts.find(c => c.email === r.email)?.name || '',
          level: r.level,
          status: r.status,
          campaign: campaignName,
          sent_at: new Date().toLocaleString('vi-VN'),
        }));
        await fetch(cfg.webhookUrl, {
          method: 'POST',
          body: JSON.stringify(rows),
          mode: 'no-cors',
        });
        toast('✓ Đã ghi lịch sử về Google Sheet');
      } catch (_) { }
    }

    // ── Download file mẫu CSV ───────────────
    function downloadSampleCSV() {
      const csv = [
        'name,email,level,company,phone,child_name',
        'Nguyễn Văn A,nguyenvana@email.com,L1,UCMAS Hà Nội,0901234567,Bé Nguyễn Văn B',
        'Trần Thị B,tranthib@email.com,L2,UCMAS HCM,0907654321,Bé Trần Văn C',
        'Lê Văn C,levanc@email.com,L3,,,',
        'Phạm Thị D,phamthid@email.com,L4,UCMAS Đà Nẵng,,Bé Phạm Thị E',
      ].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM cho Excel đọc được tiếng Việt
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ucmas-contacts-mau.csv';
      a.click();
    }

    function copyAppsScript() {
      const code = document.getElementById('apps-script-code').textContent;
      navigator.clipboard.writeText(code).then(() => toast('Đã copy Apps Script code!'));
    }

    // Khởi động auto-sync nếu đã bật từ trước
    if (getSheetsConfig().autoSync) startAutoSync();

    // ════════════════════════════════════════
    // SETTINGS — localStorage, không cần auth
    // ════════════════════════════════════════
    const CFG_KEY = 'ucmas_config';

    function getConfig() {
      try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
    }

    function openSettings() {
      const cfg = getConfig();
      document.getElementById('cfg-sb-url').value = cfg.sbUrl || '';
      document.getElementById('cfg-sb-key').value = cfg.sbKey || '';
      document.getElementById('cfg-resend').value = cfg.resend || '';
      document.getElementById('cfg-from').value = cfg.from || '';

      // Nếu server đã configured, hiện thông báo cho biết
      const infoBox = document.querySelector('#modal-settings .info-box');
      if (infoBox && _serverConfigured) {
        infoBox.className = 'info-box ok';
        infoBox.innerHTML = '✓ App đang dùng <strong>Vercel Environment Variables</strong>. Mọi người truy cập link đều dùng chung dữ liệu này.';
      }
      document.getElementById('modal-settings').classList.add('open');
    }

    async function saveSettings() {
      const cfg = {
        sbUrl: document.getElementById('cfg-sb-url').value.trim(),
        sbKey: document.getElementById('cfg-sb-key').value.trim(),
        resend: document.getElementById('cfg-resend').value.trim(),
        from: document.getElementById('cfg-from').value.trim(),
      };
      if (!cfg.sbUrl || !cfg.sbKey) { toast('Nhập Supabase URL và Service Role Key!', 'err'); return; }
      if (!cfg.resend) { toast('Nhập Resend API Key!', 'err'); return; }
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      closeModal('modal-settings');
      toast('Đã lưu — đang kết nối...');
      await loadFromBackend();
      window._backendConnected = true;
    }

    async function testSettingsConnection() {
      const url = document.getElementById('cfg-sb-url').value.trim();
      const key = document.getElementById('cfg-sb-key').value.trim();
      if (!url || !key) { toast('Nhập Supabase URL và Service Role Key trước!', 'err'); return; }
      try {
        const res = await fetch('/api/stats', {
          headers: { 'x-sb-url': url, 'x-sb-key': key },
          signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        if (json.success) toast('✓ Kết nối Supabase thành công!');
        else toast('Lỗi: ' + json.error, 'err');
      } catch (e) { toast('Không thể kết nối: ' + e.message, 'err'); }
    }
