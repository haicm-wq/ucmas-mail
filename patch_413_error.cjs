const fs = require('fs');
let code = fs.readFileSync('js/api.js', 'utf8');

// Patch in saveCampaignDraft (around line 1170)
const saveTarget = `        const result = await apiFetch('/api/campaigns-send?save_draft=1', {
          method: 'POST',
          body: JSON.stringify({
            name, from_name: from, from_email: document.getElementById('c-from-email').value || '',
            subject, body_text: body, target_level_ids: selectedLevelIds,
          }),
        });`;

const saveReplacement = `        const bodySize = new Blob([body]).size;
        if (bodySize > 4 * 1024 * 1024) {
          toast('Lỗi: Nội dung email quá lớn (>4MB). Vui lòng giảm dung lượng ảnh đính kèm!', 'err');
          return;
        }
        
        const result = await apiFetch('/api/campaigns-send?save_draft=1', {
          method: 'POST',
          body: JSON.stringify({
            name, from_name: from, from_email: document.getElementById('c-from-email').value || '',
            subject, body_text: body, target_level_ids: selectedLevelIds,
          }),
        });`;

// Patch in startSend (around line 1010)
const startTarget = `        const response = await fetch('/api/campaigns-send', {
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
        }`;

const startReplacement = `        const bodySize = new Blob([body]).size;
        if (bodySize > 4 * 1024 * 1024) {
          throw new Error('Nội dung email quá lớn (>4MB). Vui lòng giảm dung lượng ảnh đính kèm!');
        }
        
        const response = await fetch('/api/campaigns-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cfgHeaders() },
          body: JSON.stringify({
            name, from_name: from, from_email: document.getElementById('c-from-email').value || '',
            subject, body_text: body, target_level_ids: selectedLevelIds,
          }),
        });

        if (!response.ok) {
          if (response.status === 413) throw new Error('Dữ liệu gửi đi quá lớn (vượt quá 4MB). Vui lòng nén ảnh lại!');
          const errText = await response.text();
          try {
            const errData = JSON.parse(errText);
            throw new Error(errData.error || 'Lỗi API Backend');
          } catch(e) {
            throw new Error(errText || 'Lỗi API Backend ' + response.status);
          }
        }`;

code = code.replace(saveTarget, saveReplacement);
code = code.replace(startTarget, startReplacement);

// Also patch apiFetch to handle 413 globally
const apiFetchTarget = `    async function apiFetch(url, options = {}) {
      options.headers = { 'Content-Type': 'application/json', ...cfgHeaders(), ...options.headers };
      const res = await fetch(url, options);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'API Error');
      }
      return res.json();
    }`;

const apiFetchReplacement = `    async function apiFetch(url, options = {}) {
      options.headers = { 'Content-Type': 'application/json', ...cfgHeaders(), ...options.headers };
      const res = await fetch(url, options);
      if (!res.ok) {
        if (res.status === 413) throw new Error('Dữ liệu quá lớn (vượt giới hạn 4MB của Vercel).');
        const txt = await res.text();
        try {
          const d = JSON.parse(txt);
          throw new Error(d.error || 'API Error');
        } catch(e) {
          throw new Error(txt || 'API Error ' + res.status);
        }
      }
      return res.json();
    }`;
    
code = code.replace(apiFetchTarget, apiFetchReplacement);

fs.writeFileSync('js/api.js', code);
console.log('Patched 413 errors');
