const fs = require('fs');
let code = fs.readFileSync('js/api.js', 'utf8');

code = code.replace(
  /async function stopCampaign\(\) \{[\s\S]*?refreshTracking\(\);\s*\}/,
  `async function stopCampaign() {
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
        await apiFetch(\`/api/campaigns-send?stop=\${cid}\`, { method: 'POST' });
        toast('⏸ Đã dừng gửi campaign');
      } catch (e) { toast('Lỗi dừng: ' + e.message, 'err'); }
      
      window._lastPausedCampaignId = cid;
      window._sendingCampaignId = null;
      refreshTracking();
    }`
);

if (!code.includes('async function saveCampaignDraft')) {
  code += `\n    async function saveCampaignDraft() {
      if (!window._backendConnected) { toast('Lưu nháp chỉ hoạt động khi kết nối backend', 'err'); return; }
      
      const name = document.getElementById('c-name').value.trim();
      const from = document.getElementById('c-from').value.trim();
      const subject = document.getElementById('c-subject').value.trim();
      let body = document.getElementById('c-body').value.trim();
      
      if (!name) { toast('Chưa nhập tên Campaign!', 'err'); return; }
      if (!subject) { toast('Chưa nhập tiêu đề!', 'err'); return; }
      if (!body) { toast('Chưa nhập nội dung!', 'err'); return; }
      
      const selectedLevelIds = [];
      document.querySelectorAll('.seg-cb').forEach(cb => {
        if (cb.checked) selectedLevelIds.push(cb.value);
      });
      if (selectedLevelIds.length === 0) { toast('Chưa chọn phân cấp khách hàng!', 'err'); return; }

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
    }\n`;
}

fs.writeFileSync('js/api.js', code);
console.log('Patched api.js');
