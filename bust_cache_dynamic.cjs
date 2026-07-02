const fs = require('fs');
let html = fs.readFileSync('ucmas-mail.html', 'utf8');
html = html.replace(/\?v=\d+/g, '?v=7');
fs.writeFileSync('ucmas-mail.html', html);
console.log('Cache dynamically busted to v7');
