// SKR Designer · editor primitivo de Skill Tree
// Sem dependências: abra index.html no navegador.
(() => {
  'use strict';

  const NODE_W = 170;
  const NODE_H = 58;
  const GRID = 20;
  const STORAGE_KEY = 'skr-designer:tree';
  const DEFAULT_COLOR = '#6ea8ff';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const EXAMPLE = {
    version: 1,
    name: 'Guerreiro (exemplo)',
    nodes: [
      { id: 'n1', name: 'Golpe Forte', description: 'Ataque básico com +20% de dano.', cost: 1, maxRank: 3, category: 'Ataque', color: '#ef6b6b', x: 100, y: 60, prerequisites: [] },
      { id: 'n2', name: 'Pele de Ferro', description: '+10% de armadura.', cost: 1, maxRank: 3, category: 'Defesa', color: '#6ea8ff', x: 420, y: 60, prerequisites: [] },
      { id: 'n3', name: 'Investida', description: 'Avança até o inimigo e o atordoa por 1s.', cost: 2, maxRank: 1, category: 'Ataque', color: '#ef6b6b', x: 0, y: 200, prerequisites: ['n1'] },
      { id: 'n4', name: 'Fúria', description: 'Cada golpe recebido aumenta o dano em 2%.', cost: 2, maxRank: 2, category: 'Ataque', color: '#ef6b6b', x: 200, y: 200, prerequisites: ['n1'] },
      { id: 'n5', name: 'Escudo Erguido', description: 'Bloqueia 50% do dano frontal.', cost: 2, maxRank: 1, category: 'Defesa', color: '#6ea8ff', x: 420, y: 200, prerequisites: ['n2'] },
      { id: 'n6', name: 'Berserker', description: 'Ultimate: dobra o dano por 10s, mas ignora defesa.', cost: 3, maxRank: 1, category: 'Ultimate', color: '#f2b84b', x: 200, y: 340, prerequisites: ['n3', 'n4'] },
      { id: 'n7', name: 'Muralha', description: 'Ultimate: fica imune a dano por 3s.', cost: 3, maxRank: 1, category: 'Ultimate', color: '#f2b84b', x: 420, y: 340, prerequisites: ['n5', 'n4'] },
    ],
  };

  // ---------- Estado ----------
  let tree = emptyTree();
  let selectedId = null;
  let mode = 'edit'; // 'edit' | 'test'
  let ranks = {};    // id -> nível desbloqueado no modo teste
  const view = { x: 60, y: 40, k: 1 };

  // ---------- Elementos ----------
  const $ = (id) => document.getElementById(id);
  const svg = $('canvas');
  const viewport = $('viewport');
  const gLinks = $('links');
  const gNodes = $('nodes');
  const form = $('form');
  const panelEmpty = $('panelEmpty');
  const testInfo = $('testInfo');
  const prereqList = $('prereqList');
  const prereqAdd = $('prereqAdd');
  const unlocksList = $('unlocksList');
  const treeName = $('treeName');
  const budgetInput = $('budget');

  // ---------- Modelo ----------
  function emptyTree() {
    return { version: 1, name: 'Nova árvore', nodes: [] };
  }

  function getNode(id) {
    return tree.nodes.find((n) => n.id === id);
  }

  function newId() {
    let i = tree.nodes.length + 1;
    while (getNode('n' + i)) i++;
    return 'n' + i;
  }

  function dependents(id) {
    return tree.nodes.filter((n) => n.prerequisites.includes(id));
  }

  // true se `ancestorId` já depende (direta ou indiretamente) de `id`
  function dependsOn(id, ancestorId) {
    const stack = [id];
    const seen = new Set();
    while (stack.length) {
      const cur = getNode(stack.pop());
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      for (const p of cur.prerequisites) {
        if (p === ancestorId) return true;
        stack.push(p);
      }
    }
    return false;
  }

  function addNode(x, y) {
    const node = {
      id: newId(),
      name: 'Nova habilidade',
      description: '',
      cost: 1,
      maxRank: 1,
      category: '',
      color: DEFAULT_COLOR,
      x: snap(x),
      y: snap(y),
      prerequisites: [],
    };
    tree.nodes.push(node);
    select(node.id);
    changed();
    form.elements.name.focus();
    form.elements.name.select();
    return node;
  }

  function deleteNode(id) {
    tree.nodes = tree.nodes.filter((n) => n.id !== id);
    for (const n of tree.nodes) n.prerequisites = n.prerequisites.filter((p) => p !== id);
    delete ranks[id];
    if (selectedId === id) selectedId = null;
    changed();
  }

  // Liga/desliga `prereqId` como pré-requisito de `nodeId`.
  function togglePrereq(prereqId, nodeId) {
    if (prereqId === nodeId) return;
    const node = getNode(nodeId);
    if (!node) return;
    if (node.prerequisites.includes(prereqId)) {
      node.prerequisites = node.prerequisites.filter((p) => p !== prereqId);
      toast(`Conexão removida`);
    } else {
      if (dependsOn(prereqId, nodeId)) {
        toast('Essa conexão criaria um ciclo.', true);
        return;
      }
      node.prerequisites.push(prereqId);
      toast(`"${getNode(prereqId).name}" agora é pré-requisito de "${node.name}"`);
    }
    changed();
  }

  // Aceita JSON externo e devolve uma árvore válida (ou lança erro).
  function normalize(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error('JSON sem a lista "nodes".');
    const ids = new Set();
    const nodes = data.nodes.map((n, i) => {
      const id = String(n.id ?? 'n' + (i + 1));
      if (ids.has(id)) throw new Error(`ID repetido: ${id}`);
      ids.add(id);
      return {
        id,
        name: String(n.name ?? 'Sem nome'),
        description: String(n.description ?? ''),
        cost: toInt(n.cost, 1, 0),
        maxRank: toInt(n.maxRank, 1, 1),
        category: String(n.category ?? ''),
        color: /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : DEFAULT_COLOR,
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        prerequisites: Array.isArray(n.prerequisites) ? n.prerequisites.map(String) : [],
      };
    });
    for (const n of nodes) n.prerequisites = [...new Set(n.prerequisites.filter((p) => ids.has(p) && p !== n.id))];
    return { version: 1, name: String(data.name ?? 'Árvore'), nodes };
  }

  function toInt(v, fallback, min) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(min, n) : fallback;
  }

  function snap(v) {
    return Math.round(v / GRID) * GRID;
  }

  // ---------- Modo teste ----------
  function spentPoints() {
    return tree.nodes.reduce((sum, n) => sum + (ranks[n.id] || 0) * n.cost, 0);
  }

  function budget() {
    return toInt(budgetInput.value, 0, 0);
  }

  function prereqsMet(node) {
    return node.prerequisites.every((p) => (ranks[p] || 0) > 0);
  }

  function canUnlock(node) {
    const r = ranks[node.id] || 0;
    return r < node.maxRank && prereqsMet(node) && spentPoints() + node.cost <= budget();
  }

  function canRefund(node) {
    const r = ranks[node.id] || 0;
    if (r === 0) return false;
    if (r > 1) return true;
    return dependents(node.id).every((d) => !(ranks[d.id] > 0));
  }

  function nodeState(node) {
    const r = ranks[node.id] || 0;
    if (r >= node.maxRank) return 'unlocked maxed';
    if (r > 0) return canUnlock(node) ? 'unlocked available' : 'unlocked';
    return canUnlock(node) ? 'available' : 'locked';
  }

  function unlock(id) {
    const node = getNode(id);
    if (!node) return;
    if (!canUnlock(node)) {
      if (!prereqsMet(node)) toast('Pré-requisitos não cumpridos.', true);
      else if ((ranks[id] || 0) >= node.maxRank) toast('Nível máximo atingido.');
      else toast('Pontos insuficientes.', true);
      return;
    }
    ranks[id] = (ranks[id] || 0) + 1;
    render();
  }

  function refund(id) {
    const node = getNode(id);
    if (!node || !canRefund(node)) {
      if (node && ranks[id]) toast('Outra habilidade desbloqueada depende desta.', true);
      return;
    }
    ranks[id] -= 1;
    if (!ranks[id]) delete ranks[id];
    render();
  }

  // ---------- Renderização ----------
  function render() {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    renderLinks();
    renderNodes();
    renderPanel();
    renderToolbar();
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // Ponto na borda do retângulo do nó na direção de (tx, ty).
  function edgePoint(node, tx, ty) {
    const cx = node.x + NODE_W / 2;
    const cy = node.y + NODE_H / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = Math.min((NODE_W / 2) / Math.abs(dx || 1e-9), (NODE_H / 2) / Math.abs(dy || 1e-9));
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function renderLinks() {
    gLinks.replaceChildren();
    for (const node of tree.nodes) {
      for (const pid of node.prerequisites) {
        const pre = getNode(pid);
        if (!pre) continue;
        const a = edgePoint(pre, node.x + NODE_W / 2, node.y + NODE_H / 2);
        const b = edgePoint(node, pre.x + NODE_W / 2, pre.y + NODE_H / 2);
        const active = mode === 'test' && ranks[pid] > 0;
        gLinks.append(svgEl('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          class: 'link' + (active ? ' active' : ''),
          'marker-end': 'url(#arrow)',
        }));
      }
    }
  }

  function renderNodes() {
    gNodes.replaceChildren();
    const selected = getNode(selectedId);
    for (const node of tree.nodes) {
      let cls = 'node';
      if (node.id === selectedId) cls += ' selected';
      if (mode === 'test') cls += ' ' + nodeState(node);
      else if (selected && node.prerequisites.includes(selected.id)) cls += ' link-target';

      const g = svgEl('g', { class: cls, transform: `translate(${node.x} ${node.y})`, 'data-id': node.id });
      g.style.setProperty('--node-color', node.color);
      g.append(svgEl('rect', { class: 'body', width: NODE_W, height: NODE_H, rx: 8 }));
      g.append(svgEl('rect', { class: 'stripe', width: 6, height: NODE_H - 16, x: 8, y: 8, rx: 3 }));

      const title = svgEl('text', { class: 'title', x: 22, y: 24 });
      title.textContent = truncate(node.name || 'Sem nome', 20);
      g.append(title);

      const meta = svgEl('text', { class: 'meta', x: 22, y: 43 });
      const r = ranks[node.id] || 0;
      const rankText = mode === 'test' ? `${r}/${node.maxRank}` : `máx ${node.maxRank}`;
      meta.textContent = `${node.cost} pt · ${rankText}` + (node.category ? ` · ${truncate(node.category, 10)}` : '');
      g.append(meta);

      const tip = svgEl('title');
      tip.textContent = node.name + (node.description ? '\n' + node.description : '');
      g.append(tip);
      gNodes.append(g);
    }
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function renderPanel() {
    const node = getNode(selectedId);
    const editing = mode === 'edit' && node;
    form.hidden = !editing;
    panelEmpty.hidden = !!editing || mode === 'test';
    testInfo.hidden = mode !== 'test';

    if (mode === 'test') {
      renderTestInfo(node);
      return;
    }
    if (!editing) {
      renderStats();
      return;
    }

    // Só atualiza campos que não estão sendo digitados, para não perder o cursor.
    for (const key of ['name', 'description', 'cost', 'maxRank', 'category', 'color']) {
      const el = form.elements[key];
      if (document.activeElement !== el) el.value = node[key];
    }

    const cats = [...new Set(tree.nodes.map((n) => n.category).filter(Boolean))];
    $('categories').replaceChildren(...cats.map((c) => Object.assign(document.createElement('option'), { value: c })));

    prereqList.replaceChildren(...node.prerequisites.map((pid) => {
      const li = document.createElement('li');
      li.textContent = getNode(pid)?.name ?? pid;
      li.title = 'Ir para este nó';
      li.onclick = () => select(pid);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Remover pré-requisito';
      x.onclick = (e) => { e.stopPropagation(); togglePrereq(pid, node.id); };
      li.append(x);
      return li;
    }));

    const options = tree.nodes
      .filter((n) => n.id !== node.id && !node.prerequisites.includes(n.id) && !dependsOn(n.id, node.id))
      .map((n) => Object.assign(document.createElement('option'), { value: n.id, textContent: n.name }));
    prereqAdd.replaceChildren(prereqAdd.options[0], ...options);
    prereqAdd.value = '';
    prereqAdd.disabled = options.length === 0;

    unlocksList.replaceChildren(...dependents(node.id).map((d) => {
      const li = document.createElement('li');
      li.textContent = d.name;
      li.onclick = () => select(d.id);
      return li;
    }));
  }

  function renderStats() {
    const total = tree.nodes.reduce((s, n) => s + n.cost * n.maxRank, 0);
    const roots = tree.nodes.filter((n) => !n.prerequisites.length).length;
    const unnamed = tree.nodes.filter((n) => !n.name.trim()).length;
    const stats = $('stats');
    stats.innerHTML = '';
    if (!tree.nodes.length) {
      stats.textContent = 'A árvore está vazia. Clique em "+ Nó" ou carregue o exemplo.';
      return;
    }
    const lines = [
      `${tree.nodes.length} habilidades · ${roots} iniciais`,
      `${total} pontos para completar tudo`,
    ];
    for (const l of lines) stats.append(Object.assign(document.createElement('div'), { textContent: l }));
    if (unnamed) stats.append(Object.assign(document.createElement('div'), { className: 'warn', textContent: `${unnamed} sem nome` }));
  }

  function renderTestInfo(node) {
    const spent = spentPoints();
    testInfo.innerHTML = '';
    const p = (text, cls) => testInfo.append(Object.assign(document.createElement('p'), { textContent: text, className: cls || '' }));
    const h = Object.assign(document.createElement('h2'), { textContent: 'Modo Testar' });
    testInfo.append(h);
    p(`Pontos: ${spent} gastos de ${budget()} (${budget() - spent} restantes).`);
    p('Clique para desbloquear, clique direito para devolver.', 'muted');
    if (node) {
      testInfo.append(Object.assign(document.createElement('h2'), { textContent: node.name }));
      if (node.description) p(node.description);
      p(`Custo ${node.cost} pt · nível ${ranks[node.id] || 0}/${node.maxRank}`, 'muted');
      if (node.prerequisites.length) {
        p('Requer: ' + node.prerequisites.map((id) => getNode(id)?.name).join(', '), 'muted');
      }
    }
  }

  function renderToolbar() {
    if (document.activeElement !== treeName) treeName.value = tree.name;
    const testing = mode === 'test';
    $('btnMode').textContent = testing ? 'Modo: Testar' : 'Modo: Editar';
    $('btnMode').classList.toggle('testing', testing);
    $('budgetBox').hidden = !testing;
    $('btnReset').hidden = !testing;
    $('btnAdd').disabled = testing;
    $('btnDelete').disabled = testing || !selectedId;
    $('spent').textContent = `gastos: ${spentPoints()}`;
    $('hint').textContent = testing
      ? 'Clique: desbloquear · Clique direito: devolver'
      : selectedId ? 'Shift + clique em outro nó: liga/desliga pré-requisito' : 'Duplo clique no fundo: novo nó';
  }

  function select(id) {
    selectedId = id;
    render();
  }

  // ---------- Persistência ----------
  let saveTimer = null;
  function changed() {
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)); } catch { /* sem armazenamento */ }
    }, 300);
  }

  function loadTree(data, msg) {
    tree = normalize(data);
    selectedId = null;
    ranks = {};
    fitView();
    changed();
    if (msg) toast(msg);
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (tree.name || 'skill-tree').trim().replace(/[^\w\-]+/g, '_') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Arquivo JSON baixado.');
  }

  function openJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadTree(JSON.parse(reader.result), `"${file.name}" carregado.`);
      } catch (err) {
        toast('Não foi possível abrir: ' + err.message, true);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Visão (pan / zoom) ----------
  function toWorld(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  }

  function fitView() {
    if (!tree.nodes.length) { Object.assign(view, { x: 60, y: 40, k: 1 }); return; }
    const r = svg.getBoundingClientRect();
    const minX = Math.min(...tree.nodes.map((n) => n.x));
    const minY = Math.min(...tree.nodes.map((n) => n.y));
    const maxX = Math.max(...tree.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...tree.nodes.map((n) => n.y + NODE_H));
    const pad = 40;
    const k = Math.min(1.2, (r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1));
    view.k = Math.max(0.3, k);
    view.x = (r.width - (maxX - minX) * view.k) / 2 - minX * view.k;
    view.y = (r.height - (maxY - minY) * view.k) / 2 - minY * view.k;
  }

  let drag = null; // { type: 'node'|'pan', ... }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const g = e.target.closest('.node');
    svg.setPointerCapture(e.pointerId);
    if (g) {
      const id = g.dataset.id;
      if (mode === 'test') { unlock(id); return; }
      if (e.shiftKey && selectedId && selectedId !== id) { togglePrereq(selectedId, id); return; }
      const node = getNode(id);
      const p = toWorld(e.clientX, e.clientY);
      drag = { type: 'node', id, dx: p.x - node.x, dy: p.y - node.y, moved: false };
      if (selectedId !== id) select(id);
    } else {
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      svg.classList.add('panning');
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.type === 'node') {
      const node = getNode(drag.id);
      const p = toWorld(e.clientX, e.clientY);
      const nx = snap(p.x - drag.dx);
      const ny = snap(p.y - drag.dy);
      if (nx !== node.x || ny !== node.y) {
        node.x = nx; node.y = ny; drag.moved = true;
        renderLinks(); renderNodes();
      }
    } else {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    }
  });

  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.type === 'node' && drag.moved) changed();
    if (drag.type === 'pan' && !drag.moved && selectedId) select(null);
    drag = null;
    svg.classList.remove('panning');
  });

  svg.addEventListener('dblclick', (e) => {
    if (mode !== 'edit' || e.target.closest('.node')) return;
    const p = toWorld(e.clientX, e.clientY);
    addNode(p.x - NODE_W / 2, p.y - NODE_H / 2);
  });

  svg.addEventListener('contextmenu', (e) => {
    const g = e.target.closest('.node');
    if (mode === 'test' && g) {
      e.preventDefault();
      refund(g.dataset.id);
    }
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - (mx - view.x) * (k / view.k);
    view.y = my - (my - view.y) * (k / view.k);
    view.k = k;
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  }, { passive: false });

  // ---------- Formulário ----------
  form.addEventListener('input', (e) => {
    const node = getNode(selectedId);
    if (!node || !e.target.name) return;
    const { name, value } = e.target;
    if (name === 'cost') node.cost = toInt(value, 0, 0);
    else if (name === 'maxRank') node.maxRank = toInt(value, 1, 1);
    else node[name] = value;
    changed();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  prereqAdd.addEventListener('change', () => {
    if (prereqAdd.value) togglePrereq(prereqAdd.value, selectedId);
  });

  treeName.addEventListener('input', () => { tree.name = treeName.value; changed(); });

  // ---------- Barra de ferramentas ----------
  $('btnAdd').onclick = () => {
    const r = svg.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    // Evita empilhar nós exatamente no mesmo lugar.
    let x = c.x - NODE_W / 2, y = c.y - NODE_H / 2;
    while (tree.nodes.some((n) => n.x === snap(x) && n.y === snap(y))) { x += GRID * 2; y += GRID * 2; }
    addNode(x, y);
  };
  $('btnDelete').onclick = () => { if (selectedId) deleteNode(selectedId); };
  $('btnNew').onclick = () => {
    if (tree.nodes.length && !confirm('Descartar a árvore atual e começar uma nova?')) return;
    loadTree(emptyTree(), 'Nova árvore criada.');
  };
  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) openJson(f);
    e.target.value = '';
  };
  $('btnSave').onclick = downloadJson;
  $('btnExample').onclick = () => {
    if (tree.nodes.length && !confirm('Substituir a árvore atual pelo exemplo?')) return;
    loadTree(EXAMPLE, 'Exemplo carregado.');
  };
  $('btnMode').onclick = () => {
    mode = mode === 'edit' ? 'test' : 'edit';
    render();
  };
  $('btnReset').onclick = () => { ranks = {}; render(); };
  budgetInput.addEventListener('input', render);

  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); downloadJson(); return; }
    if (typing || mode !== 'edit') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteNode(selectedId); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); $('btnAdd').click(); }
    else if (e.key === 'Escape') select(null);
  });

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, isError = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Início ----------
  function init() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* ignora */ }
    try {
      tree = saved ? normalize(saved) : normalize(EXAMPLE);
    } catch {
      tree = normalize(EXAMPLE);
    }
    fitView();
    render();
  }

  init();
})();
