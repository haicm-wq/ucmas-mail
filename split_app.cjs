const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

const lines = content.split('\n');
const modules = {};
let currentModule = 'main.js';

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('// ════════════════════════════════════════') && lines[i+1] && lines[i+1].startsWith('    // ')) {
        const title = lines[i+1].trim().replace('// ', '');
        
        if (title.includes('CONSTANTS') || title.includes('UTILITIES') || title.includes('DATA STORE')) currentModule = 'store.js';
        else if (title.includes('NAVIGATION') || title.includes('SIDEBAR') || title.includes('DASHBOARD')) currentModule = 'ui.js';
        else if (title.includes('CONTACTS')) currentModule = 'contacts.js';
        else if (title.includes('TAG ')) currentModule = 'tags.js';
        else if (title.includes('SEGMENT ')) currentModule = 'segments.js';
        else if (title.includes('LEVEL ')) currentModule = 'levels.js';
        else if (title.includes('TEMPLATES')) currentModule = 'templates.js';
        else if (title.includes('WORKFLOW')) currentModule = 'workflows.js';
        else if (title.includes('CAMPAIGN') || title.includes('SEND')) currentModule = 'campaigns.js';
        else if (title.includes('API LAYER')) currentModule = 'api.js';
        else if (title.includes('SETTINGS') || title.includes('GOOGLE SHEETS')) currentModule = 'settings.js';
        else currentModule = 'main.js';
    }
    
    if (!modules[currentModule]) {
        modules[currentModule] = [];
    }
    modules[currentModule].push(line);
}

if (!fs.existsSync('js')) fs.mkdirSync('js');

for (const mod in modules) {
    fs.writeFileSync(`js/${mod}`, modules[mod].join('\n'));
    console.log(`Wrote ${mod} - ${modules[mod].length} lines`);
}
