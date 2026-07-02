const fs = require('fs');
let html = fs.readFileSync('ucmas-mail.html', 'utf8');

html = html.replace(/styles\.css(?:\?v=\d+)?/g, 'styles.css?v=3');
html = html.replace(/src="js\/([^"]+\.js)(?:\?v=\d+)?"/g, 'src="js/$1?v=3"');

fs.writeFileSync('ucmas-mail.html', html);
console.log('Cache busted in ucmas-mail.html');
