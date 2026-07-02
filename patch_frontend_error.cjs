const fs = require('fs');
let code = fs.readFileSync('js/api.js', 'utf8');

const target = `        const reader = response.body.getReader();`;
const replacement = `        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Lỗi API Backend');
        }
        const reader = response.body.getReader();`;

code = code.replace(target, replacement);

fs.writeFileSync('js/api.js', code);
console.log('Patched API Error handling');
