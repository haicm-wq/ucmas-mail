const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

const lines = content.split('\n');
let fileIndex = 0;
let currentFile = '00-init.js';
const files = {};

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('// ════════════════════════════════════════') && lines[i+1] && lines[i+1].startsWith('    // ')) {
        const title = lines[i+1].trim().replace('// ', '');
        fileIndex++;
        const prefix = String(fileIndex).padStart(2, '0');
        
        if (title.includes('CONSTANTS') || title.includes('UTILITIES') || title.includes('DATA STORE')) currentFile = `${prefix}-store.js`;
        else if (title.includes('NAVIGATION') || title.includes('TOAST') || title.includes('SIDEBAR') || title.includes('DASHBOARD')) currentFile = `${prefix}-ui.js`;
        else if (title.includes('CONTACTS') || title.includes('BULK')) currentFile = `${prefix}-contacts.js`;
        else if (title.includes('TAG ')) currentFile = `${prefix}-tags.js`;
        else if (title.includes('SEGMENT ')) currentFile = `${prefix}-segments.js`;
        else if (title.includes('LEVEL ')) currentFile = `${prefix}-levels.js`;
        else if (title.includes('TEMPLATES')) currentFile = `${prefix}-templates.js`;
        else if (title.includes('WORKFLOW')) currentFile = `${prefix}-workflows.js`;
        else if (title.includes('CAMPAIGN') || title.includes('SEND')) currentFile = `${prefix}-campaigns.js`;
        else if (title.includes('API LAYER')) currentFile = `${prefix}-api.js`;
        else if (title.includes('SETTINGS') || title.includes('GOOGLE SHEETS')) currentFile = `${prefix}-settings.js`;
        else currentFile = `${prefix}-main.js`;
    }
    
    if (!files[currentFile]) {
        files[currentFile] = [];
    }
    files[currentFile].push(line);
}

if (!fs.existsSync('js')) fs.mkdirSync('js');

let scriptTags = '';
for (const mod in files) {
    fs.writeFileSync(`js/${mod}`, files[mod].join('\n'));
    console.log(`Wrote ${mod}`);
    scriptTags += `<script src="js/${mod}"></script>\n`;
}

fs.writeFileSync('script_tags.txt', scriptTags);
console.log('Done splitting!');
