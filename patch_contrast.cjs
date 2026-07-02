const fs = require('fs');
let css = fs.readFileSync('styles.css', 'utf8');

// Update Tag/Label colors (remove pastel rainbow, use high contrast neutral/blue tones)
css = css.replace(/--l1:\s*#eab308;?/g, '--l1: #0f172a;');
css = css.replace(/--l1b:\s*rgba\(234, 179, 8, 0\.12\);?/g, '--l1b: #e2e8f0;');

css = css.replace(/--l2:\s*#10b981;?/g, '--l2: #1d4ed8;');
css = css.replace(/--l2b:\s*rgba\(16, 185, 129, 0\.12\);?/g, '--l2b: #dbeafe;');

css = css.replace(/--l3:\s*#3b82f6;?/g, '--l3: #4338ca;');
css = css.replace(/--l3b:\s*rgba\(59, 130, 246, 0\.12\);?/g, '--l3b: #e0e7ff;');

css = css.replace(/--l4:\s*#a855f7;?/g, '--l4: #334155;');
css = css.replace(/--l4b:\s*rgba\(168, 85, 247, 0\.12\);?/g, '--l4b: #f1f5f9;');

// Update Status colors for higher contrast on white
css = css.replace(/--ok:\s*#10b981;?/g, '--ok: #15803d;'); // Green 700
css = css.replace(/--err:\s*#ef4444;?/g, '--err: #b91c1c;'); // Red 700
css = css.replace(/--warn:\s*#f59e0b;?/g, '--warn: #b45309;'); // Amber 700

// We also need to fix trk-card-icon colors if they were hardcoded in HTML
// Let's check `ucmas-mail.html`
let html = fs.readFileSync('ucmas-mail.html', 'utf8');

// Replace hardcoded pastel tracking cards in HTML
html = html.replace(/style="background:rgba\(91,168,255,\.12\);color:#5ba8ff"/g, 'style="background:var(--l2b);color:var(--l2)"');
html = html.replace(/style="background:rgba\(61,232,160,\.12\);color:#3de8a0"/g, 'style="background:var(--l2b);color:var(--l2)"');
html = html.replace(/style="background:rgba\(79,108,255,\.12\);color:#4f6cff"/g, 'style="background:var(--l2b);color:var(--l2)"');
html = html.replace(/style="background:rgba\(201,126,245,\.12\);color:#c97ef5"/g, 'style="background:var(--l4b);color:var(--l4)"');
html = html.replace(/style="background:rgba\(255,126,179,\.12\);color:#ff7eb3"/g, 'style="background:var(--err);color:#fff"');
html = html.replace(/style="background:rgba\(255,87,87,\.12\);color:#ff5757"/g, 'style="background:var(--err);color:#fff"');
html = html.replace(/color:#5ba8ff/g, 'color:var(--l2)');
html = html.replace(/color:#3de8a0/g, 'color:var(--l2)');
html = html.replace(/color:#4f6cff/g, 'color:var(--l2)');
html = html.replace(/color:#c97ef5/g, 'color:var(--l4)');
html = html.replace(/color:#ff7eb3/g, 'color:var(--err)');
html = html.replace(/color:#ff5757/g, 'color:var(--err)');

// Cache bust again
html = html.replace(/\?v=3/g, '?v=4');

fs.writeFileSync('styles.css', css);
fs.writeFileSync('ucmas-mail.html', html);
console.log('Fixed contrast and colors!');
