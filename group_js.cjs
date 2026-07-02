const fs = require('fs');
const files = fs.readdirSync('js').filter(f => f.endsWith('.js') && f.match(/^\d{2}-/)).sort();
const grouped = {};
for (const f of files) {
  const parts = f.split('-');
  const type = parts.slice(1).join('-'); // e.g. store.js
  if (!grouped[type]) grouped[type] = [];
  grouped[type].push(fs.readFileSync(`js/${f}`, 'utf8'));
}
let scriptTags = '';
for (const type in grouped) {
  fs.writeFileSync(`js/${type}`, grouped[type].join('\n'));
  console.log(`Grouped ${type}`);
  scriptTags += `<script src="js/${type}"></script>\n`;
}
fs.writeFileSync('script_tags.txt', scriptTags);
// Delete original 01- 02- files
for (const f of files) fs.unlinkSync(`js/${f}`);
console.log('Done grouping!');
