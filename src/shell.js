// Casca do aplicativo: abas, arquivos, sessão e atualizações.
// Cada tipo de documento é um "workspace" registrado com SKR.registerWorkspace.
window.SKR = (() => {
  'use strict';

  const platform = window.SKRPlatform;
  const SESSION_KEY = 'skr-designer:session';
  const $ = (id) => document.getElementById(id);

  const workspaces = [];      // tipos registrados
  const tabs = [];            // documentos abertos
  let activeId = 'home';
  let nextTabId = 1;
  let clipboard = null;       // área de transferência interna, compartilhada entre abas

  // Workspaces planejados, mostrados na tela inicial como "em breve".
  const PLANNED = [
    { name: 'Árvore de diálogos', description: 'Conversas com ramificações e condições.' },
    { name: 'Banco de itens', description: 'Itens, raridades e atributos em tabela.' },
    { name: 'Quests', description: 'Missões, objetivos e recompensas encadeadas.' },
  ];

  /**
   * Registra um tipo de workspace.
   * def = { id, name, description, color, createDocument(), matches(doc), mount(host, doc, ctx) }
   * mount devolve { getDocument(), getTitle(), onKeyDown(e), onKeyUp(e), onShow(), destroy() }
   */
  function registerWorkspace(def) {
    workspaces.push(def);
  }

  function findWorkspace(doc) {
    return workspaces.find((w) => w.id === doc?.type) || workspaces.find((w) => w.matches?.(doc));
  }

  // ---------- Abas ----------
  function openTab(workspace, doc, { path = null, fileName = null, dirty = false, activate = true } = {}) {
    const tab = { id: 't' + nextTabId++, workspace, path, fileName, dirty, instance: null, el: null };
    tab.el = document.createElement('div');
    tab.el.className = 'workspace';
    tab.el.hidden = true;
    $('host').append(tab.el);
    try {
      tab.instance = workspace.mount(tab.el, doc, makeContext(tab));
    } catch (err) {
      tab.el.remove();
      throw err;
    }
    tabs.push(tab);
    if (activate) activate_(tab.id);
    else renderTabs();
    saveSession();
    return tab;
  }

  function makeContext(tab) {
    return {
      changed() {
        tab.dirty = true;
        renderTabs();
        scheduleSave();
      },
      toast,
      setStatus,
      clipboard: {
        get: () => clipboard,
        set: (value) => { clipboard = value; },
      },
    };
  }

  function activeTab() {
    return tabs.find((t) => t.id === activeId) || null;
  }

  function activate_(id) {
    activeId = id;
    $('home').hidden = id !== 'home';
    for (const t of tabs) t.el.hidden = t.id !== id;
    const tab = activeTab();
    tab?.instance.onShow?.();
    renderTabs();
    saveSession();
  }

  async function closeTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      const choice = await ask('Fechar documento', `"${tabTitle(tab)}" tem alterações não salvas.`, ['Salvar', 'Descartar', 'Cancelar']);
      if (choice === 'Cancelar' || choice === null) return;
      if (choice === 'Salvar' && !(await save(tab))) return;
    }
    const idx = tabs.indexOf(tab);
    tab.instance.destroy?.();
    tab.el.remove();
    tabs.splice(idx, 1);
    if (activeId === id) activate_(tabs[idx]?.id || tabs[idx - 1]?.id || 'home');
    else renderTabs();
    saveSession();
  }

  function tabTitle(tab) {
    return tab.instance.getTitle?.() || tab.fileName || tab.workspace.name;
  }

  function renderTabs() {
    const bar = $('tabs');
    bar.replaceChildren();
    const mk = (id, label, extra = {}) => {
      const b = document.createElement('div');
      b.className = 'tab' + (id === activeId ? ' active' : '');
      b.setAttribute('role', 'tab');
      b.title = extra.title || label;
      b.onmousedown = (e) => {
        if (e.button === 1 && id !== 'home') { e.preventDefault(); closeTab(id); }
        else if (e.button === 0) activate_(id);
      };
      if (extra.color) {
        const dot = document.createElement('span');
        dot.className = 'tab-dot';
        dot.style.background = extra.color;
        b.append(dot);
      }
      b.append(document.createTextNode(label));
      if (extra.dirty) b.append(Object.assign(document.createElement('span'), { className: 'tab-dirty', textContent: '●' }));
      if (id !== 'home') {
        const x = document.createElement('button');
        x.className = 'tab-close';
        x.textContent = '×';
        x.title = 'Fechar (Ctrl+W)';
        x.onmousedown = (e) => e.stopPropagation();
        x.onclick = () => closeTab(id);
        b.append(x);
      }
      bar.append(b);
    };
    mk('home', 'Início');
    for (const t of tabs) {
      mk(t.id, tabTitle(t), { dirty: t.dirty, color: t.workspace.color, title: t.path || tabTitle(t) });
    }
    const tab = activeTab();
    document.title = tab ? `${tabTitle(tab)}${tab.dirty ? ' •' : ''} — SKR Designer` : 'SKR Designer';
    $('btnSave').disabled = !tab;
    $('btnSaveAs').disabled = !tab;
    platform.setUnsaved(tabs.some((t) => t.dirty));
  }

  // ---------- Tela inicial ----------
  function renderHome() {
    const home = document.createElement('div');
    home.id = 'home';
    home.className = 'home';
    home.innerHTML = `
      <div class="home-inner">
        <h1>SKR Designer</h1>
        <p class="muted">Ferramentas para game designers. Escolha um workspace para começar.</p>
        <div class="cards" id="homeCards"></div>
        <h3>Em breve</h3>
        <div class="cards planned" id="homePlanned"></div>
        <p class="muted small">Atalhos: Ctrl+N novo · Ctrl+O abrir · Ctrl+S salvar · Ctrl+W fechar aba · Ctrl+Tab trocar de aba</p>
      </div>`;
    $('host').append(home);

    const cards = home.querySelector('#homeCards');
    for (const w of workspaces) {
      const c = document.createElement('div');
      c.className = 'card';
      c.style.setProperty('--card-color', w.color);
      c.innerHTML = `<h2></h2><p></p><div class="card-actions"></div>`;
      c.querySelector('h2').textContent = w.name;
      c.querySelector('p').textContent = w.description;
      const actions = c.querySelector('.card-actions');
      const bNew = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Novo' });
      bNew.onclick = () => newDocument(w);
      actions.append(bNew);
      if (w.exampleDocument) {
        const bEx = Object.assign(document.createElement('button'), { textContent: 'Abrir exemplo' });
        bEx.onclick = () => openTab(w, w.exampleDocument());
        actions.append(bEx);
      }
      cards.append(c);
    }
    const open = document.createElement('div');
    open.className = 'card';
    open.innerHTML = '<h2>Abrir arquivo</h2><p>Abre um documento .json salvo antes.</p><div class="card-actions"><button>Abrir…</button></div>';
    open.querySelector('button').onclick = openDocument;
    cards.append(open);

    const planned = home.querySelector('#homePlanned');
    for (const p of PLANNED) {
      const c = document.createElement('div');
      c.className = 'card disabled';
      c.innerHTML = '<h2></h2><p></p>';
      c.querySelector('h2').textContent = p.name;
      c.querySelector('p').textContent = p.description;
      planned.append(c);
    }

    const menu = $('newMenu');
    for (const w of workspaces) {
      const b = Object.assign(document.createElement('button'), { textContent: w.name });
      b.onclick = () => { menu.hidden = true; newDocument(w); };
      menu.append(b);
    }
  }

  // ---------- Arquivos ----------
  function newDocument(workspace = workspaces[0]) {
    openTab(workspace, workspace.createDocument());
  }

  async function openDocument() {
    const file = await platform.openFile();
    if (!file) return;
    let doc;
    try {
      doc = JSON.parse(file.content);
    } catch {
      toast('O arquivo não é um JSON válido.', true);
      return;
    }
    const workspace = findWorkspace(doc);
    if (!workspace) {
      toast('Tipo de documento não reconhecido.', true);
      return;
    }
    const existing = file.path && tabs.find((t) => t.path === file.path);
    if (existing) { activate_(existing.id); return; }
    try {
      openTab(workspace, doc, { path: file.path, fileName: file.name });
      toast(`"${file.name}" aberto.`);
    } catch (err) {
      toast('Não foi possível abrir: ' + err.message, true);
    }
  }

  async function save(tab = activeTab(), saveAs = false) {
    if (!tab) return false;
    const doc = tab.instance.getDocument();
    const content = JSON.stringify(doc, null, 2);
    const suggestedName = (tab.fileName || (tabTitle(tab).trim().replace(/[^\w\-]+/g, '_') || 'documento') + '.json');
    try {
      const res = await platform.saveFile({ content, filePath: saveAs ? null : tab.path, suggestedName });
      if (!res) return false;
      tab.path = res.path;
      tab.fileName = res.name;
      tab.dirty = false;
      renderTabs();
      saveSession();
      toast(platform.isDesktop ? `Salvo em ${res.path}` : `"${res.name}" baixado.`);
      return true;
    } catch (err) {
      toast('Erro ao salvar: ' + err.message, true);
      return false;
    }
  }

  // ---------- Sessão (reabre as abas ao iniciar) ----------
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 400);
  }

  function saveSession() {
    const data = {
      active: tabs.findIndex((t) => t.id === activeId),
      tabs: tabs.map((t) => ({ type: t.workspace.id, doc: t.instance.getDocument(), path: t.path, fileName: t.fileName, dirty: t.dirty })),
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* sem armazenamento */ }
  }

  function restoreSession() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { /* ignora */ }
    if (!data?.tabs?.length) return false;
    for (const t of data.tabs) {
      const w = workspaces.find((x) => x.id === t.type);
      if (!w) continue;
      try { openTab(w, t.doc, { path: t.path, fileName: t.fileName, dirty: t.dirty, activate: false }); } catch { /* documento corrompido */ }
    }
    activate_(tabs[data.active]?.id || 'home');
    return true;
  }

  // ---------- Atualizações ----------
  async function checkUpdates() {
    const btn = $('btnUpdates');
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    let info;
    try {
      info = await platform.checkForUpdates();
    } catch (err) {
      info = { status: 'error', message: err.message };
    }
    btn.disabled = false;
    btn.textContent = 'Verificar atualizações';

    if (info.status === 'latest') {
      ask('Atualizações', `Você já está na versão mais recente (${info.current}).`, ['OK']);
    } else if (info.status === 'none') {
      ask('Atualizações', 'Ainda não há nenhuma versão publicada no GitHub.', ['OK']);
    } else if (info.status === 'error') {
      ask('Atualizações', 'Não foi possível verificar: ' + info.message, ['OK']);
    } else if (info.status === 'available') {
      const body = document.createElement('div');
      body.append(Object.assign(document.createElement('p'), { textContent: `Versão ${info.latest} disponível (você tem ${info.current}).` }));
      if (info.notes) body.append(Object.assign(document.createElement('pre'), { className: 'notes', textContent: info.notes }));
      if (!info.canInstall) {
        body.append(Object.assign(document.createElement('p'), {
          className: 'muted',
          textContent: 'Na versão portátil, baixe o novo executável e substitua o antigo.',
        }));
      }
      const actions = info.canInstall ? ['Baixar e instalar', 'Depois'] : ['Abrir página de download', 'Depois'];
      const choice = await ask('Nova versão', body, actions);
      if (choice === 'Abrir página de download') platform.openExternal(info.pageUrl);
      if (choice === 'Baixar e instalar') downloadAndInstall();
    }
  }

  async function downloadAndInstall() {
    const body = document.createElement('div');
    const bar = Object.assign(document.createElement('progress'), { max: 100, value: 0 });
    const label = Object.assign(document.createElement('p'), { textContent: 'Baixando… 0%' });
    body.append(label, bar);
    platform.onUpdateProgress((pct) => { bar.value = pct; label.textContent = `Baixando… ${pct}%`; });
    showModal('Atualizando', body, []);
    try {
      const res = await platform.downloadUpdate();
      if (res.status !== 'downloaded') {
        ask('Atualizações', 'Nenhuma atualização para instalar.', ['OK']);
        return;
      }
      saveSession();
      const choice = await ask('Atualização pronta', 'O app vai fechar para instalar a nova versão. Suas abas serão reabertas.', ['Reiniciar agora', 'Ao sair']);
      if (choice === 'Reiniciar agora') platform.installUpdate();
    } catch (err) {
      ask('Atualizações', 'Falha ao baixar: ' + err.message, ['OK']);
    }
  }

  // ---------- Modal / toast / status ----------
  let modalResolve = null;
  function showModal(title, body, buttons) {
    if (modalResolve) modalResolve(null);
    $('modalTitle').textContent = title;
    const b = $('modalBody');
    b.replaceChildren();
    if (typeof body === 'string') b.append(Object.assign(document.createElement('p'), { textContent: body }));
    else b.append(body);
    const actions = $('modalActions');
    actions.replaceChildren();
    $('modal').hidden = false;
    return new Promise((resolve) => {
      modalResolve = resolve;
      buttons.forEach((label, i) => {
        const btn = Object.assign(document.createElement('button'), { textContent: label, className: i === 0 ? 'primary' : '' });
        btn.onclick = () => closeModal(label);
        actions.append(btn);
      });
      actions.querySelector('button')?.focus();
    });
  }

  function closeModal(value) {
    $('modal').hidden = true;
    const r = modalResolve;
    modalResolve = null;
    r?.(value);
  }

  const ask = showModal;

  let toastTimer = null;
  function toast(msg, isError = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setStatus(text) {
    $('status').textContent = text || '';
  }

  // ---------- Teclado ----------
  function isTyping() {
    const el = document.activeElement;
    return el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
  }

  function onKeyDown(e) {
    if (!$('modal').hidden) {
      if (e.key === 'Escape') closeModal(null);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); save(activeTab(), e.shiftKey); return; }
    if (mod && key === 'o') { e.preventDefault(); openDocument(); return; }
    if (mod && key === 'n') { e.preventDefault(); newDocument(); return; }
    if (mod && key === 'w') { e.preventDefault(); if (activeTab()) closeTab(activeId); return; }
    if (mod && e.key === 'Tab') {
      e.preventDefault();
      const ids = ['home', ...tabs.map((t) => t.id)];
      const i = ids.indexOf(activeId);
      activate_(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      return;
    }
    const tab = activeTab();
    if (!tab || isTyping()) return;
    if (tab.instance.onKeyDown?.(e)) e.preventDefault();
  }

  function onKeyUp(e) {
    activeTab()?.instance.onKeyUp?.(e);
  }

  // ---------- Início ----------
  async function start() {
    renderHome();
    $('btnNew').onclick = (e) => { e.stopPropagation(); $('newMenu').hidden = !$('newMenu').hidden; };
    document.addEventListener('click', () => { $('newMenu').hidden = true; });
    $('btnOpen').onclick = openDocument;
    $('btnSave').onclick = () => save();
    $('btnSaveAs').onclick = () => save(activeTab(), true);
    $('btnUpdates').onclick = checkUpdates;
    $('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeModal(null); });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('beforeunload', saveSession);
    platform.onUpdateError((msg) => toast('Atualização: ' + msg, true));

    const info = await platform.appInfo();
    $('version').textContent = info.version === 'web'
      ? 'versão web'
      : `v${info.version}${info.portable ? ' · portátil' : ''}`;

    if (!restoreSession()) activate_('home');
  }

  return { registerWorkspace, start, toast };
})();
