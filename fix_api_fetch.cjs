const fs = require('fs');
let code = fs.readFileSync('js/api.js', 'utf8');

// 1. Fix apiFetch 
const apiFetchTarget = `          const res = await fetch(API + path, {
            cache: 'no-store',
            ...options,
            signal: options.signal || AbortSignal.timeout(API_TIMEOUT),
            headers: { 'Content-Type': 'application/json', ...cfgHeaders(), ...(options.headers || {}) },
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error || 'Lỗi API');
          return json.data;`;

const apiFetchReplacement = `          const res = await fetch(API + path, {
            cache: 'no-store',
            ...options,
            signal: options.signal || AbortSignal.timeout(API_TIMEOUT),
            headers: { 'Content-Type': 'application/json', ...cfgHeaders(), ...(options.headers || {}) },
          });
          
          if (!res.ok) {
            if (res.status === 413) throw new Error('Ảnh quá nặng (vượt quá 4MB). Xin hãy giảm dung lượng hoặc dùng link ảnh!');
            const txt = await res.text();
            try {
              const j = JSON.parse(txt);
              throw new Error(j.error || 'Lỗi API ' + res.status);
            } catch(e) {
              throw new Error(txt || 'Lỗi API ' + res.status);
            }
          }
          
          const json = await res.json();
          if (!json.success) throw new Error(json.error || 'Lỗi API');
          return json.data;`;

code = code.replace(apiFetchTarget, apiFetchReplacement);

// 2. Fix saveCampaignDraft size check
const saveTarget = `      body = await compressImagesInHtml(body);
      
      if (!name) { toast('Chưa nhập tên Campaign để lưu nháp!', 'err'); return; }
      // Cho phép lưu nháp không cần tiêu đề, nội dung hoặc phân cấp
      
      const selectedLevelIds = [];`;

const saveReplacement = `      body = await compressImagesInHtml(body);
      
      if (!name) { toast('Chưa nhập tên Campaign để lưu nháp!', 'err'); return; }
      // Cho phép lưu nháp không cần tiêu đề, nội dung hoặc phân cấp
      
      if (new Blob([body]).size > 4 * 1024 * 1024) {
        toast('Lỗi: Ảnh đính kèm vẫn quá nặng sau khi nén (>4MB). Vui lòng gửi bằng đường dẫn link ảnh thay vì copy-paste trực tiếp!', 'err');
        return;
      }
      
      const selectedLevelIds = [];`;

code = code.replace(saveTarget, saveReplacement);

// 3. Update compressImagesInHtml to catch ALL images > 50KB and compress more aggressively
const compressTarget = `    if (src.length > 300000) { 
       try {
         const compressedSrc = await compressBase64Image(src, 1000, 0.75);`;

const compressReplacement = `    if (src.length > 50000) { // Nén tất cả ảnh > 35KB
       try {
         const compressedSrc = await compressBase64Image(src, 800, 0.6); // Giảm xuống 800px và 60% chất lượng`;

code = code.replace(compressTarget, compressReplacement);

fs.writeFileSync('js/api.js', code);
console.log('Fixed apiFetch and Image Compressor');
