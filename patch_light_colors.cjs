const fs = require('fs');
let css = fs.readFileSync('styles.css', 'utf8');

// Replace GrapeJS & Skeleton hardcoded colors with variables
css = css.replace(/background:\s*#1a1a2e;?/g, 'background: rgba(0, 0, 0, 0.5);'); // gjs-overlay
css = css.replace(/#111319/g, 'var(--surface)');
css = css.replace(/#181c26/g, 'var(--surface2)');
css = css.replace(/#1e2230/g, 'var(--surface3)');
css = css.replace(/#28304a/g, 'var(--border2)');
css = css.replace(/#1e2338/g, 'var(--border)');
css = css.replace(/#e6e8f2/g, 'var(--text)');
css = css.replace(/#5e6585/g, 'var(--muted)');
css = css.replace(/#0d0d1a/g, 'var(--surface3)'); // gjs-cv-canvas
css = css.replace(/#4f6cff22/g, 'var(--accent-glow)');
css = css.replace(/#4f6cff/g, 'var(--accent)');
css = css.replace(/#f5a623/g, 'var(--warn)');
css = css.replace(/#7b93ff/g, 'var(--accent2)');

// Fix skeleton loader gradients
css = css.replace(/background: linear-gradient\(90deg, var\(--surface2\) 25%, var\(--surface3\) 50%, var\(--surface2\) 75%\);/g, 'background: linear-gradient(90deg, var(--surface2) 25%, var(--border) 50%, var(--surface2) 75%);');

fs.writeFileSync('styles.css', css);
console.log('Fixed hardcoded colors in styles.css');
