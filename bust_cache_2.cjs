const fs = require('fs');
let html = fs.readFileSync('ucmas-mail.html', 'utf8');

html = html.replace(/\?v=4/g, '?v=5');

fs.writeFileSync('ucmas-mail.html', html);
console.log('Cache busted in ucmas-mail.html (v5)');
