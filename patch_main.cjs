const fs = require('fs');
let code = fs.readFileSync('js/main.js', 'utf8');

const veStart = code.indexOf('    let _veReady = false;');
const veEndStr = "    // Shared preview renderer";
const veEnd = code.indexOf(veEndStr);

if (veStart === -1 || veEnd === -1) {
    console.log("Could not find VISUAL EDITOR section bounds");
    process.exit(1);
}

const newVeLogic = `    // QUIL JS INTEGRATION
    let tmplQuill = null;
    let campQuill = null;
    let _veReady = false;
    let _codeSyncTimer = null;

    function initVisualEditor(html) {
      if (!tmplQuill) {
        tmplQuill = new Quill('#ve-quill', {
          theme: 'snow',
          modules: {
            toolbar: [
              [{ 'header': [1, 2, 3, false] }],
              ['bold', 'italic', 'underline', 'strike'],
              [{ 'color': [] }, { 'background': [] }],
              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
              [{ 'align': [] }],
              ['link', 'image', 'clean']
            ]
          }
        });
        
        tmplQuill.getModule('toolbar').addHandler('image', () => {
          openImageDialog();
        });

        tmplQuill.on('text-change', () => {
          clearTimeout(_codeSyncTimer);
          _codeSyncTimer = setTimeout(syncVisualToCode, 300);
        });
      }

      const rawContent = html || document.getElementById('tmpl-code').value || '';
      tmplQuill.clipboard.dangerouslyPasteHTML(rawContent);
      _veReady = true;
    }

    function syncVisualToCode() {
      if (!_veReady) return;
      document.getElementById('tmpl-code').value = tmplQuill.root.innerHTML;
      updatePreviewFrame();
    }

    function syncCodeToVisual() {
      if (!_veReady || !tmplQuill) return;
      tmplQuill.clipboard.dangerouslyPasteHTML(document.getElementById('tmpl-code').value);
    }

    function onCodeInput() {
      clearTimeout(_codeSyncTimer);
      _codeSyncTimer = setTimeout(() => {
        syncCodeToVisual();
        updatePreviewFrame();
      }, 500);
    }

    function veExec(cmd, val) {} 
    function veExecBlock(tag) {} 

    function setEditorMode(mode) {
      editorMode = mode;
      const area = document.getElementById('editor-area');
      const codePane = document.getElementById('code-pane');
      const visualPane = document.getElementById('visual-pane');
      const previewPane = document.getElementById('preview-pane-wrap');
      const veToolbar = document.getElementById('ve-toolbar');

      document.querySelectorAll('.editor-btn').forEach(b => b.classList.remove('active-mode'));
      const modeBtn = document.getElementById('btn-mode-' + mode);
      if (modeBtn) modeBtn.classList.add('active-mode');

      [codePane, visualPane, previewPane].forEach(p => { if (p) p.style.display = 'none'; });
      if (veToolbar) veToolbar.style.display = 'none';

      if (mode === 'visual') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        visualPane.style.display = '';
        if (!_veReady) initVisualEditor();
        else syncCodeToVisual();
      } else if (mode === 'split') {
        area.style.gridTemplateColumns = '1fr 1fr';
        area.classList.add('split-mode');
        codePane.style.display = '';
        visualPane.style.display = '';
        if (!_veReady) initVisualEditor();
        else syncCodeToVisual();
      } else if (mode === 'code') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        codePane.style.display = '';
      } else if (mode === 'preview') {
        area.style.gridTemplateColumns = '1fr';
        area.classList.remove('split-mode');
        previewPane.style.display = '';
        updatePreviewFrame();
      }
    }

    // New Campaign Quill logic
    function initCampaignQuill() {
      if (!campQuill) {
        campQuill = new Quill('#c-quill', {
          theme: 'snow',
          modules: {
            toolbar: [
              [{ 'header': [1, 2, 3, false] }],
              ['bold', 'italic', 'underline', 'strike'],
              [{ 'color': [] }, { 'background': [] }],
              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
              [{ 'align': [] }],
              ['link', 'image', 'clean']
            ]
          }
        });
        campQuill.getModule('toolbar').addHandler('image', () => {
          openImageDialog();
        });
        campQuill.on('text-change', () => {
          updateCampaignCodeFromQuill();
        });
      }
    }

    function updateCampaignCodeFromQuill() {
      if (campQuill) {
        document.getElementById('c-body').value = campQuill.root.innerHTML;
        updateCampaignPreview();
      }
    }

    function updateCampaignQuillFromCode() {
      if (campQuill) {
        campQuill.clipboard.dangerouslyPasteHTML(document.getElementById('c-body').value);
      }
    }

`;

code = code.substring(0, veStart) + newVeLogic + code.substring(veEnd);

code = code.replace(
  /function applyImage\(\) \{[\s\S]*?closeModal\('modal-image'\);\s*\}/,
  `function applyImage() {
      const url = document.getElementById('img-url').value.trim();
      const alt = document.getElementById('img-alt').value.trim() || '';
      const width = document.getElementById('img-width').value;
      if (!url) { toast('Chọn ảnh hoặc nhập URL!', 'err'); return; }

      const style = \`max-width:100%;width:\${width};height:auto;display:block;\${width === 'center' ? 'margin:0 auto' : ''}\`;
      const html = \`<img src="\${url}" alt="\${alt}" style="\${style}">\`;

      if (typeof tmplQuill !== 'undefined' && tmplQuill && document.getElementById('modal-image').classList.contains('open') && document.getElementById('ve-quill')) {
          const range = tmplQuill.getSelection(true);
          if (range) tmplQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else tmplQuill.clipboard.dangerouslyPasteHTML(tmplQuill.getLength(), html);
          syncVisualToCode();
      } else if (typeof campQuill !== 'undefined' && campQuill) {
          const range = campQuill.getSelection(true);
          if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), html);
          updateCampaignCodeFromQuill();
      } else {
          insertTmplVar(html);
      }
      closeModal('modal-image');
    }`
);

code = code.replace(
  /function applyLink\(\) \{[\s\S]*?closeModal\('modal-link'\);\s*\}/,
  `function applyLink() {
      const text = document.getElementById('link-text').value.trim();
      const url = document.getElementById('link-url').value.trim();
      const target = document.getElementById('link-target').value;
      if (!url) { toast('Nhập URL!', 'err'); return; }

      const html = \`<a href="\${url}" target="\${target}">\${text || url}</a>\`;

      if (typeof tmplQuill !== 'undefined' && tmplQuill && (editorMode === 'visual' || editorMode === 'split')) {
          const range = tmplQuill.getSelection(true);
          if (range) tmplQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else tmplQuill.clipboard.dangerouslyPasteHTML(tmplQuill.getLength(), html);
          syncVisualToCode();
      } else if (typeof campQuill !== 'undefined' && campQuill && document.getElementById('c-body-code-wrap').style.display !== 'none') {
          const range = campQuill.getSelection(true);
          if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, html);
          else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), html);
          updateCampaignCodeFromQuill();
      } else {
          insertTmplVar(html);
      }
      closeModal('modal-link');
    }`
);

code = code.replace(
  /function insertTmplVar\(v\) \{[\s\S]*?ta\.focus\(\);\s*\}/,
  `function insertTmplVar(v) {
      if ((editorMode === 'visual' || editorMode === 'split') && typeof tmplQuill !== 'undefined' && tmplQuill) {
        const range = tmplQuill.getSelection(true);
        if (range) tmplQuill.clipboard.dangerouslyPasteHTML(range.index, v);
        else tmplQuill.clipboard.dangerouslyPasteHTML(tmplQuill.getLength(), v);
        syncVisualToCode();
        return;
      }
      const ta = document.getElementById('tmpl-code');
      const s = ta.selectionStart || 0;
      ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd || ta.value.length);
      ta.selectionStart = ta.selectionEnd = s + v.length;
      ta.focus();
    }`
);

code = code.replace(
  /function setCampaignBodyTab\(tab\) \{[\s\S]*?if \(tab === 'preview'\) updateCampaignPreview\(\);\s*\}/,
  `function setCampaignBodyTab(tab) {
      document.getElementById('c-tab-code').classList.toggle('active', tab === 'code');
      document.getElementById('c-tab-preview').classList.toggle('active', tab === 'preview');
      document.getElementById('c-body-code-wrap').style.display = tab === 'code' ? '' : 'none';
      document.getElementById('c-body-preview-wrap').style.display = tab === 'preview' ? '' : 'none';
      if (tab === 'code') {
        if (typeof initCampaignQuill === 'function') {
            initCampaignQuill();
            updateCampaignQuillFromCode();
        }
      }
      if (tab === 'preview') updateCampaignPreview();
    }`
);

code = code.replace(
  /function loadTemplateIntoCampaign\(id\) \{[\s\S]*?toast\(\`Đã tải: \$\{t\.name\}\`\);\s*\}/,
  `function loadTemplateIntoCampaign(id) {
      if (!id) return;
      const t = templates.find(x => x.id === id);
      if (!t) return;
      document.getElementById('c-body').value = t.body;
      if (typeof campQuill !== 'undefined' && campQuill) {
          campQuill.clipboard.dangerouslyPasteHTML(t.body);
      }
      document.getElementById('c-name').placeholder = t.name;
      updateCampaignPreview();
      toast(\`Đã tải: \${t.name}\`);
    }`
);

// If insertCampaignVar doesn't exist, we must add it because it might be in another file, wait, let's just append it to main.js if not found
if (!code.includes('function insertCampaignVar(')) {
  code += `\nfunction insertCampaignVar(v) {
      if (typeof campQuill !== 'undefined' && campQuill && document.getElementById('c-body-code-wrap').style.display !== 'none') {
        const range = campQuill.getSelection(true);
        if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, v);
        else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), v);
        updateCampaignCodeFromQuill();
      } else {
        const ta = document.getElementById('c-body');
        const s = ta.selectionStart || 0;
        ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd || ta.value.length);
        ta.selectionStart = ta.selectionEnd = s + v.length;
        ta.focus();
        if (typeof campQuill !== 'undefined' && campQuill) campQuill.clipboard.dangerouslyPasteHTML(ta.value);
        updateCampaignPreview();
      }
    }\n`;
} else {
  // If it exists, replace it
  code = code.replace(
    /function insertCampaignVar\(v\) \{[\s\S]*?updateCampaignPreview\(\);\s*\}/,
    `function insertCampaignVar(v) {
      if (typeof campQuill !== 'undefined' && campQuill && document.getElementById('c-body-code-wrap').style.display !== 'none') {
        const range = campQuill.getSelection(true);
        if (range) campQuill.clipboard.dangerouslyPasteHTML(range.index, v);
        else campQuill.clipboard.dangerouslyPasteHTML(campQuill.getLength(), v);
        updateCampaignCodeFromQuill();
      } else {
        const ta = document.getElementById('c-body');
        const s = ta.selectionStart || 0;
        ta.value = ta.value.substring(0, s) + v + ta.value.substring(ta.selectionEnd || ta.value.length);
        ta.selectionStart = ta.selectionEnd = s + v.length;
        ta.focus();
        if (typeof campQuill !== 'undefined' && campQuill) campQuill.clipboard.dangerouslyPasteHTML(ta.value);
        updateCampaignPreview();
      }
    }`
  );
}

fs.writeFileSync('js/main.js', code);
console.log('Patched js/main.js successfully.');
