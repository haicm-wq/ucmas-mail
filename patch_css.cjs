const fs = require('fs');
let code = fs.readFileSync('styles.css', 'utf8');

const target = `/* ═══ MODERN UI OVERRIDES (GLASSMORPHISM & ANIMATIONS) ═══ */
:root {
  --bg: #09090b;
  --surface: rgba(24, 24, 27, 0.75);
  --surface2: rgba(39, 39, 42, 0.75);
  --glass-blur: blur(16px);
}
.sidebar, .topbar, .modal-content, .card, .stat-card, .tbl-wrap, .prog-wrap, .tmpl-editor-wrap {
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  background: var(--surface) !important;
}
.btn, .stat-card, .tmpl-card, .db-step-btn, .wf-card, .card {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
}
.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.btn:active {
  transform: translateY(0);
}
.stat-card:hover, .tmpl-card:hover, .card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.4) !important;
  border-color: var(--accent) !important;
}
.modal-content {
  box-shadow: 0 24px 64px rgba(0,0,0,0.6) !important;
  transform: scale(0.95) translateY(10px);
  animation: modal-fade-in 0.3s forwards cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes modal-fade-in {
  to { transform: scale(1) translateY(0); opacity: 1; }
}`;

const replacement = `/* ═══ MODERN UI OVERRIDES (GLASSMORPHISM & ANIMATIONS) ═══ */
:root {
  --bg: #09090b;
  --surface: #18181b; /* Dùng màu đặc cho thẻ nội dung để tránh lag cuộn */
  --glass-bg: rgba(24, 24, 27, 0.75);
  --surface2: #27272a;
  --glass-blur: blur(8px); /* Giảm độ mờ để tăng FPS */
}

/* Chỉ áp dụng hiệu ứng kính cho thanh điều hướng và popup */
.sidebar, .topbar, .modal-content {
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  background: var(--glass-bg) !important;
}

/* Thẻ nội dung dùng màu đặc (solid) */
.card, .stat-card, .tbl-wrap, .prog-wrap, .tmpl-editor-wrap {
  background: var(--surface) !important;
}

/* Tối ưu Transition: Bỏ 'all', chỉ animate các thuộc tính cần thiết */
.btn, .stat-card, .tmpl-card, .db-step-btn, .wf-card, .card {
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease !important;
  will-change: transform;
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.btn:active {
  transform: translateY(0);
}
.stat-card:hover, .tmpl-card:hover, .card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.4) !important;
  border-color: var(--accent) !important;
}
.modal-content {
  box-shadow: 0 24px 64px rgba(0,0,0,0.6) !important;
  transform: scale(0.95) translateY(10px);
  animation: modal-fade-in 0.25s forwards cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes modal-fade-in {
  to { transform: scale(1) translateY(0); opacity: 1; }
}`;

if (code.includes('/* ═══ MODERN UI OVERRIDES (GLASSMORPHISM & ANIMATIONS) ═══ */')) {
  code = code.replace(target, replacement);
  fs.writeFileSync('styles.css', code);
  console.log('Patched styles.css successfully.');
} else {
  console.log('Target block not found.');
}
