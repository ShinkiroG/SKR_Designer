// Acesso ao sistema: usa a ponte do Electron quando existe e cai para
// recursos do navegador quando a interface é aberta direto no browser.
window.SKRPlatform = (() => {
  'use strict';

  const native = window.skrNative;
  const RELEASES_API = 'https://api.github.com/repos/ShinkiroG/SKR_Designer/releases/latest';

  if (native) {
    return { isDesktop: true, ...native };
  }

  function openFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ path: null, name: file.name, content: reader.result });
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      input.click();
    });
  }

  async function saveFile({ content, suggestedName }) {
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName || 'documento.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return { path: null, name: a.download };
  }

  async function checkForUpdates() {
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (res.status === 404) return { status: 'none', current: 'web' };
      if (!res.ok) return { status: 'error', current: 'web', message: `GitHub respondeu ${res.status}.` };
      const rel = await res.json();
      return { status: 'available', current: 'web', latest: String(rel.tag_name).replace(/^v/, ''), notes: rel.body || '', pageUrl: rel.html_url, canInstall: false };
    } catch (err) {
      return { status: 'error', current: 'web', message: err.message };
    }
  }

  return {
    isDesktop: false,
    openFile,
    saveFile,
    setUnsaved() {},
    appInfo: async () => ({ version: 'web', portable: false, packaged: false, platform: 'web' }),
    openExternal: async (url) => { window.open(url, '_blank', 'noopener'); },
    checkForUpdates,
    downloadUpdate: async () => { throw new Error('Disponível só no app desktop.'); },
    installUpdate: async () => {},
    onUpdateProgress() {},
    onUpdateError() {},
  };
})();
