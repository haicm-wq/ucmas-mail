const fs = require('fs');
let code = fs.readFileSync('js/api.js', 'utf8');

const compressFuncs = `
// --- AUTO COMPRESS IMAGES ---
function compressBase64Image(base64, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = base64;
  });
}

async function compressImagesInHtml(html) {
  if (!html.includes('data:image/')) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const imgs = doc.querySelectorAll('img[src^="data:image/"]');
  
  for (let img of imgs) {
    const src = img.getAttribute('src');
    if (src.length > 300000) { 
       try {
         const compressedSrc = await compressBase64Image(src, 1000, 0.75);
         img.setAttribute('src', compressedSrc);
       } catch (e) {
         console.warn('Cannot compress image', e);
       }
    }
  }
  return doc.body.innerHTML;
}
// ----------------------------
`;

// Insert the functions before saveCampaignDraft
if (!code.includes('compressImagesInHtml')) {
  code = code.replace(/    async function saveCampaignDraft\(\)/, compressFuncs + '\n    async function saveCampaignDraft()');
}

// Update saveCampaignDraft
const saveTarget = `      let body = document.getElementById('c-body').value.trim();
      
      if (!name) { toast('Chưa nhập tên Campaign!', 'err'); return; }
      // Cho phép lưu nháp không cần tiêu đề, nội dung hoặc phân cấp`;

const saveReplacement = `      let body = document.getElementById('c-body').value.trim();
      body = await compressImagesInHtml(body);
      
      if (!name) { toast('Chưa nhập tên Campaign để lưu nháp!', 'err'); return; }
      // Cho phép lưu nháp không cần tiêu đề, nội dung hoặc phân cấp`;

code = code.replace(saveTarget, saveReplacement);

// Update startSend
const startTarget = `      const subject = document.getElementById('c-subject').value.trim();
      const body = document.getElementById('c-body').value.trim();
      const from = document.getElementById('c-from').value.trim();`;

const startReplacement = `      const subject = document.getElementById('c-subject').value.trim();
      let body = document.getElementById('c-body').value.trim();
      body = await compressImagesInHtml(body);
      const from = document.getElementById('c-from').value.trim();`;

code = code.replace(startTarget, startReplacement);

// Remove the strict 4MB throw in startSend because compression solves it, 
// or rather, keep the check AFTER compression, just to be absolutely safe.
const oldThrowTarget = `        const bodySize = new Blob([body]).size;
        if (bodySize > 4 * 1024 * 1024) {
          throw new Error('Nội dung email quá lớn (>4MB). Vui lòng giảm dung lượng ảnh đính kèm!');
        }`;
code = code.replace(oldThrowTarget, `        if (new Blob([body]).size > 4 * 1024 * 1024) {
          throw new Error('Nội dung email vẫn quá lớn (>4MB) sau khi nén. Vui lòng dùng link ảnh thay vì dán trực tiếp!');
        }`);

fs.writeFileSync('js/api.js', code);
console.log('Added auto image compression to api.js');
