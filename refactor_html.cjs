const fs = require('fs');
let html = fs.readFileSync('ucmas-mail.html', 'utf8');

// Replace class="abtn" with class="btn"
html = html.replace(/class="abtn"/g, 'class="btn"');
// Replace class="send-btn" with class="btn btn-primary"
html = html.replace(/class="send-btn"/g, 'class="btn btn-primary"');
// Replace class="db-step-btn" with class="btn" if appropriate, wait, db-step-btn has specific layout
// Let's just remove hardcoded styles for stop/resume buttons
html = html.replace(/style="color:#ff6b6b;border-color:#ff6b6b;font-size:12px;padding:4px 16px"/g, 'class="btn btn-danger"');
html = html.replace(/style="display:none;color:#3de8a0;border-color:#3de8a0;font-size:12px;padding:4px 16px"/g, 'style="display:none;"');

// In Light Mode, some inline backgrounds like #1e2230 will look bad. Let's find and remove them.
html = html.replace(/background:#1e2230/g, 'background:var(--surface2)');
html = html.replace(/background:#181c26/g, 'background:var(--surface)');

// Write back
fs.writeFileSync('ucmas-mail.html', html);
console.log('Processed HTML');
