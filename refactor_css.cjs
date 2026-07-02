const fs = require('fs');

let css = fs.readFileSync('styles.css', 'utf8');

// 1. Theme Overhaul: Replace variables in :root
const rootRegex = /:root\s*\{[^}]+\}/;
const lightRoot = `:root {
  --bg: #f3f4f6; /* Light gray background */
  --surface: #ffffff; /* White cards */
  --surface2: #f8fafc; /* Slightly darker surface for headers/hover */
  --surface3: #f1f5f9;
  --border: #e2e8f0;
  --border2: #cbd5e1;
  --text: #1e293b; /* Dark text */
  --muted: #64748b; /* Muted text */
  
  /* Primary Vibrant Blue Accent */
  --accent: #2563eb;
  --accent2: #3b82f6;
  --accent-glow: rgba(37, 99, 235, 0.15);
  
  /* Segment colors adapted for light theme */
  --l1: #eab308;
  --l1b: rgba(234, 179, 8, 0.12);
  --l2: #10b981;
  --l2b: rgba(16, 185, 129, 0.12);
  --l3: #3b82f6;
  --l3b: rgba(59, 130, 246, 0.12);
  --l4: #a855f7;
  --l4b: rgba(168, 85, 247, 0.12);
  
  /* Status colors */
  --ok: #10b981;
  --err: #ef4444;
  --warn: #f59e0b;
  
  /* Fonts & Variables */
  --fh: 'Montserrat', sans-serif;
  --fb: 'Montserrat', sans-serif;
  --fm: 'Montserrat', sans-serif;
  --r: 10px;
  --rl: 14px;
}`;

css = css.replace(rootRegex, lightRoot);

// 2. Remove the duplicate / old overrides at the bottom
const overridesRegex = /\/\* ═══ MODERN UI OVERRIDES.*?$/s;
css = css.replace(overridesRegex, '');

// 3. Deduplicate CSS classes
// Since I cannot confidently regex all CSS rules across 3000 lines without breaking things, 
// I will output a new CSS file `styles_light.css` with standard Bootstrap-like classes for buttons and cards,
// and modify `ucmas-mail.html` to use them.

// Actually, rewriting the whole CSS file is too dangerous.
// Let's just append the new generalized classes and then update HTML.
// In HTML, we will change <button class="abtn"> to <button class="btn btn-outline">
// <div class="stat-card"> to <div class="card stat-card">

const utilityClasses = `

/* ═══ NEW UNIFIED CLASSES ═══ */

/* unified buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 8px 16px;
  border-radius: 8px;
  font-family: var(--fm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.btn:hover {
  background: var(--surface2);
  border-color: var(--border2);
  transform: translateY(-1px);
}
.btn:active {
  transform: translateY(0);
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  box-shadow: 0 4px 12px var(--accent-glow);
}
.btn-primary:hover {
  background: var(--accent2);
  color: #fff;
}
.btn-danger {
  background: var(--err);
  color: #fff;
  border: none;
}
.btn-danger:hover {
  background: #dc2626;
}
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.btn-block {
  width: 100%;
}

/* unified cards */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--rl);
  overflow: hidden;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease;
}
.card:hover {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08);
}
.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface2);
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  font-family: var(--fh);
}
.card-body {
  padding: 20px;
}

/* input fields */
.fi, .fsel {
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-family: var(--fb);
  font-size: 13.5px;
  outline: none;
  transition: all 0.2s ease;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
}
.fi:focus, .fsel:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.fsel {
  appearance: none;
  background: var(--surface) url("data:image/svg+xml;utf8,<svg fill='%2364748b' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/><path d='M0 0h24v24H0z' fill='none'/></svg>") no-repeat right 8px center;
}

/* general background fix */
body {
  background: var(--bg);
  color: var(--text);
}

/* topbar / sidebar */
.topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.sidebar {
  background: var(--surface);
  border-right: 1px solid var(--border);
}
.nav-tab.active {
  background: var(--surface2);
  color: var(--accent);
}
`;

css += utilityClasses;

fs.writeFileSync('styles.css', css);
console.log('Processed styles.css');
