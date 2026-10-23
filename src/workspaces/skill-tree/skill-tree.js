// Workspace "Skill Tree": editor de nós no estilo Blueprint.
// Cada nó tem um pino de entrada (esquerda) e um de saída (direita).
// Ligar a saída de A na entrada de B torna A pré-requisito de B.
(() => {
  'use strict';

  const NODE_W = 200;
  const NODE_H = 76;
  const HEAD_H = 30;
  const GRID = 16;
  const DEFAULT_COLOR = '#6ea8ff';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HISTORY_LIMIT = 200;

  const EXAMPLE = {
    type: 'skill-tree',
    version: 2,
    name: 'Guerreiro (exemplo)',
    budget: 10,
    nodes: [
      { id: 'n1', name: 'Golpe Forte', description: 'Ataque básico com +20% de dano.', cost: 1, maxRank: 3, category: 'Ataque', color: '#ef6b6b', x: 0, y: 32, prerequisites: [] },
      { id: 'n2', name: 'Pele de Ferro', description: '+10% de armadura.', cost: 1, maxRank: 3, category: 'Defesa', color: '#6ea8ff', x: 0, y: 288, prerequisites: [] },
      { id: 'n3', name: 'Investida', description: 'Avança até o inimigo e o atordoa por 1s.', cost: 2, maxRank: 1, category: 'Ataque', color: '#ef6b6b', x: 288, y: -48, prerequisites: ['n1'] },
      { id: 'n4', name: 'Fúria', description: 'Cada golpe recebido aumenta o dano em 2%.', cost: 2, maxRank: 2, category: 'Ataque', color: '#ef6b6b', x: 288, y: 112, prerequisites: ['n1'] },
      { id: 'n5', name: 'Escudo Erguido', description: 'Bloqueia 50% do dano frontal.', cost: 2, maxRank: 1, category: 'Defesa', color: '#6ea8ff', x: 288, y: 288, prerequisites: ['n2'] },
      { id: 'n6', name: 'Berserker', description: 'Ultimate: dobra o dano por 10s, mas ignora defesa.', cost: 3, maxRank: 1, category: 'Ultimate', color: '#f2b84b', x: 576, y: 32, prerequisites: ['n3', 'n4'] },
      { id: 'n7', name: 'Muralha', description: 'Ultimate: fica imune a dano por 3s.', cost: 3, maxRank: 1, category: 'Ultimate', color: '#f2b84b', x: 576, y: 208, prerequisites: ['n4', 'n5'] },
    ],
  };

  // ---------- Modelo ----------
  function toInt(v, fallback, min) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(min, n) : fallback;
  }

  // Aceita documentos v1 (sem "type") e v2; devolve um documento limpo.
  function normalize(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error('JSON sem a lista "nodes".');
    const ids = new Set();
    const nodes = data.nodes.map((n, i) => {
      let id = String(n.id ?? 'n' + (i + 1));
      while (ids.has(id)) id += '_';
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
    return {
      type: 'skill-tree',
      version: 2,
      name: String(data.name ?? 'Skill Tree'),
      budget: toInt(data.budget, 10, 0),
      nodes,
    };
  }

  const snap = (v) => Math.round(v / GRID) * GRID;
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function el(tag, props = {}, ...children) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...children);
    return e;
  }

  function wirePath(x1, y1, x2, y2) {
    const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // ---------- Editor ----------
  class SkillTreeEditor {
    constructor(host, doc, ctx) {
      this.ctx = ctx;
      this.doc = normalize(doc);
      this.sel = new Set();
      this.selLink = null;        // { from, to }
      this.mode = 'edit';
      this.ranks = {};
      this.view = { x: 80, y: 80, k: 1 };
      this.undoStack = [];
      this.redoStack = [];
      this.drag = null;
      this.spaceDown = false;
      this.lastPointer = null;    // posição do mouse no mundo
      this.panelKey = null;
      this.formFresh = false;

      this.buildDom(host);
      this.bindEvents();
      requestAnimationFrame(() => { this.fit(); this.render(); });
      this.render();
    }

    // ----- API do workspace -----
    getDocument() { return JSON.parse(JSON.stringify(this.doc)); }
    getTitle() { return this.doc.name || 'Skill Tree'; }
    onShow() { this.render(); this.svg.focus({ preventScroll: true }); }
    destroy() { this.root.remove(); }

    // ----- DOM -----
    buildDom(host) {
      this.root = el('div', { className: 'st' });
      this.root.innerHTML = `
        <div class="st-toolbar">
          <button data-act="add" title="Nova habilidade (N)">+ Habilidade</button>
          <span class="sep"></span>
          <button data-act="undo" title="Desfazer (Ctrl+Z)">↶</button>
          <button data-act="redo" title="Refazer (Ctrl+Y)">↷</button>
          <span class="sep"></span>
          <button data-act="fit" title="Enquadrar (F)">Enquadrar</button>
          <span class="spacer"></span>
          <label class="st-budget" hidden>Pontos <input type="number" min="0" data-field="budget"> <span data-out="spent"></span></label>
          <button data-act="reset" hidden>Zerar teste</button>
          <button data-act="mode" class="mode" title="Alternar editar / testar (T)">Modo: Editar</button>
        </div>
        <div class="st-body">
          <div class="st-canvas">
            <svg tabindex="0">
              <defs>
                <pattern id="st-grid-sm" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
                  <path d="M ${GRID} 0 L 0 0 0 ${GRID}" class="grid-sm"/>
                </pattern>
                <pattern id="st-grid" width="${GRID * 8}" height="${GRID * 8}" patternUnits="userSpaceOnUse">
                  <rect width="${GRID * 8}" height="${GRID * 8}" fill="url(#st-grid-sm)"/>
                  <path d="M ${GRID * 8} 0 L 0 0 0 ${GRID * 8}" class="grid-lg"/>
                </pattern>
              </defs>
              <g class="viewport">
                <rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#st-grid)"/>
                <g class="links"></g>
                <path class="wire-temp" hidden/>
                <g class="nodes"></g>
                <rect class="marquee" hidden/>
              </g>
            </svg>
            <div class="st-hint"></div>
            <div class="st-menu" hidden></div>
          </div>
          <aside class="st-panel"></aside>
        </div>`;
      host.append(this.root);
      const q = (s) => this.root.querySelector(s);
      this.svg = q('svg');
      this.viewport = q('.viewport');
      this.gLinks = q('.links');
      this.gNodes = q('.nodes');
      this.wireTemp = q('.wire-temp');
      this.marquee = q('.marquee');
      this.hint = q('.st-hint');
      this.menu = q('.st-menu');
      this.panel = q('.st-panel');
      this.budgetInput = q('[data-field=budget]');
    }

    bindEvents() {
      this.root.querySelector('.st-toolbar').addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'add') this.addNodeAtCenter();
        else if (act === 'undo') this.undo();
        else if (act === 'redo') this.redo();
        else if (act === 'fit') { this.fit(this.sel.size ? [...this.sel] : null); this.render(); }
        else if (act === 'mode') this.toggleMode();
        else if (act === 'reset') { this.ranks = {}; this.render(); }
      });
      this.budgetInput.addEventListener('input', () => {
        this.doc.budget = toInt(this.budgetInput.value, 0, 0);
        this.ctx.changed();
        this.render();
      });

      const svg = this.svg;
      svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      svg.addEventListener('pointermove', (e) => this.onPointerMove(e));
      svg.addEventListener('pointerup', (e) => this.onPointerUp(e));
      svg.addEventListener('pointercancel', () => this.cancelDrag());
      svg.addEventListener('dblclick', (e) => this.onDoubleClick(e));
      svg.addEventListener('contextmenu', (e) => e.preventDefault());
      svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      svg.addEventListener('pointerleave', () => { if (!this.drag) this.lastPointer = null; });
      document.addEventListener('pointerdown', (e) => {
        if (!this.menu.hidden && !this.menu.contains(e.target)) this.hideMenu();
      });
    }

    // ----- Utilidades -----
    node(id) { return this.doc.nodes.find((n) => n.id === id); }

    newId(taken = new Set()) {
      let i = this.doc.nodes.length + 1;
      while (this.node('n' + i) || taken.has('n' + i)) i++;
      return 'n' + i;
    }

    dependents(id) { return this.doc.nodes.filter((n) => n.prerequisites.includes(id)); }

    // true se `id` já depende (direta ou indiretamente) de `ancestorId`
    dependsOn(id, ancestorId) {
      const stack = [id];
      const seen = new Set();
      while (stack.length) {
        const cur = this.node(stack.pop());
        if (!cur || seen.has(cur.id)) continue;
        seen.add(cur.id);
        for (const p of cur.prerequisites) {
          if (p === ancestorId) return true;
          stack.push(p);
        }
      }
      return false;
    }

    toWorld(clientX, clientY) {
      const r = this.svg.getBoundingClientRect();
      return { x: (clientX - r.left - this.view.x) / this.view.k, y: (clientY - r.top - this.view.y) / this.view.k };
    }

    pinPos(node, side) {
      return side === 'out'
        ? { x: node.x + NODE_W, y: node.y + HEAD_H / 2 }
        : { x: node.x, y: node.y + HEAD_H / 2 };
    }

    // ----- Histórico -----
    checkpoint() {
      this.undoStack.push(JSON.stringify(this.doc));
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }

    mutate(fn) {
      this.checkpoint();
      fn();
      this.commit();
    }

    commit() {
      this.ctx.changed();
      this.render();
    }

    restore(json) {
      this.doc = JSON.parse(json);
      for (const id of [...this.sel]) if (!this.node(id)) this.sel.delete(id);
      this.selLink = null;
      this.panelKey = null;
      this.commit();
    }

    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(JSON.stringify(this.doc));
      this.restore(this.undoStack.pop());
    }

    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(JSON.stringify(this.doc));
      this.restore(this.redoStack.pop());
    }

    // ----- Operações -----
    createNode(x, y, extra = {}) {
      const node = {
        id: this.newId(),
        name: 'Nova habilidade',
        description: '',
        cost: 1,
        maxRank: 1,
        category: '',
        color: DEFAULT_COLOR,
        x: snap(x),
        y: snap(y),
        prerequisites: [],
        ...extra,
      };
      this.doc.nodes.push(node);
      return node;
    }

    addNodeAt(x, y) {
      let node;
      this.mutate(() => {
        node = this.createNode(x, y);
        this.selectOnly(node.id);
      });
      this.focusName();
      return node;
    }

    addNodeAtCenter() {
      if (this.mode !== 'edit') return;
      const r = this.svg.getBoundingClientRect();
      const c = this.lastPointer || this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
      let x = snap(c.x - NODE_W / 2);
      let y = snap(c.y - NODE_H / 2);
      while (this.doc.nodes.some((n) => n.x === x && n.y === y)) { x += GRID * 2; y += GRID * 2; }
      this.addNodeAt(x, y);
    }

    focusName() {
      requestAnimationFrame(() => {
        const input = this.panel.querySelector('[data-field=name]');
        input?.focus();
        input?.select();
      });
    }

    deleteSelection() {
      if (this.selLink) {
        const { from, to } = this.selLink;
        this.mutate(() => {
          const n = this.node(to);
          if (n) n.prerequisites = n.prerequisites.filter((p) => p !== from);
          this.selLink = null;
        });
        return;
      }
      if (!this.sel.size) return;
      const ids = new Set(this.sel);
      this.mutate(() => {
        this.doc.nodes = this.doc.nodes.filter((n) => !ids.has(n.id));
        for (const n of this.doc.nodes) n.prerequisites = n.prerequisites.filter((p) => !ids.has(p));
        for (const id of ids) delete this.ranks[id];
        this.sel.clear();
      });
    }

    // `pre` passa a ser pré-requisito de `post`. Devolve false se inválido.
    connect(pre, post) {
      if (pre === post) return false;
      const node = this.node(post);
      if (!node || node.prerequisites.includes(pre)) return false;
      if (this.dependsOn(pre, post)) {
        this.ctx.toast('Essa conexão criaria um ciclo.', true);
        return false;
      }
      this.mutate(() => node.prerequisites.push(pre));
      return true;
    }

    disconnect(pre, post) {
      const node = this.node(post);
      if (!node) return;
      this.mutate(() => { node.prerequisites = node.prerequisites.filter((p) => p !== pre); });
    }

    // Remove as ligações de um pino (Alt + clique, como na Unreal).
    breakPin(id, side) {
      const node = this.node(id);
      if (!node) return;
      const has = side === 'in' ? node.prerequisites.length : this.dependents(id).length;
      if (!has) return;
      this.mutate(() => {
        if (side === 'in') node.prerequisites = [];
        else for (const d of this.dependents(id)) d.prerequisites = d.prerequisites.filter((p) => p !== id);
      });
    }

    breakAll(ids) {
      const set = new Set(ids);
      this.mutate(() => {
        for (const n of this.doc.nodes) {
          if (set.has(n.id)) n.prerequisites = [];
          else n.prerequisites = n.prerequisites.filter((p) => !set.has(p));
        }
      });
    }

    copy(cut = false) {
      if (!this.sel.size) return;
      const ids = new Set(this.sel);
      const nodes = this.doc.nodes.filter((n) => ids.has(n.id)).map((n) => ({
        ...n,
        prerequisites: n.prerequisites.filter((p) => ids.has(p)),
      }));
      this.ctx.clipboard.set({ kind: 'skill-tree/nodes', nodes: JSON.parse(JSON.stringify(nodes)) });
      if (cut) this.deleteSelection();
      this.ctx.toast(`${nodes.length} ${nodes.length === 1 ? 'habilidade copiada' : 'habilidades copiadas'}.`);
    }

    paste(at = this.lastPointer) {
      const clip = this.ctx.clipboard.get();
      if (clip?.kind !== 'skill-tree/nodes' || !clip.nodes.length) return;
      const minX = Math.min(...clip.nodes.map((n) => n.x));
      const minY = Math.min(...clip.nodes.map((n) => n.y));
      const ox = at ? snap(at.x) - minX : GRID * 2;
      const oy = at ? snap(at.y) - minY : GRID * 2;
      this.mutate(() => {
        const map = {};
        const taken = new Set();
        for (const n of clip.nodes) { map[n.id] = this.newId(taken); taken.add(map[n.id]); }
        this.sel.clear();
        this.selLink = null;
        for (const n of clip.nodes) {
          this.doc.nodes.push({ ...n, id: map[n.id], x: n.x + ox, y: n.y + oy, prerequisites: n.prerequisites.map((p) => map[p]) });
          this.sel.add(map[n.id]);
        }
      });
    }

    duplicate() {
      if (!this.sel.size) return;
      const prev = this.ctx.clipboard.get();
      this.copy();
      const nodes = [...this.sel].map((id) => this.node(id));
      const minX = Math.min(...nodes.map((n) => n.x));
      const minY = Math.min(...nodes.map((n) => n.y));
      this.paste({ x: minX + GRID * 2, y: minY + GRID * 2 });
      this.ctx.clipboard.set(prev);
    }

    nudge(dx, dy) {
      if (!this.sel.size) return;
      this.mutate(() => {
        for (const id of this.sel) { const n = this.node(id); n.x += dx; n.y += dy; }
      });
    }

    align(kind) {
      const nodes = [...this.sel].map((id) => this.node(id)).filter(Boolean);
      if (nodes.length < 2) return;
      this.mutate(() => {
        if (kind === 'left') { const x = Math.min(...nodes.map((n) => n.x)); nodes.forEach((n) => { n.x = x; }); }
        if (kind === 'top') { const y = Math.min(...nodes.map((n) => n.y)); nodes.forEach((n) => { n.y = y; }); }
        if (kind === 'hdist' || kind === 'vdist') {
          const axis = kind === 'hdist' ? 'x' : 'y';
          nodes.sort((a, b) => a[axis] - b[axis]);
          const first = nodes[0][axis];
          const step = (nodes[nodes.length - 1][axis] - first) / (nodes.length - 1);
          nodes.forEach((n, i) => { n[axis] = snap(first + step * i); });
        }
      });
    }

    selectOnly(id) {
      this.sel = new Set(id ? [id] : []);
      this.selLink = null;
    }

    toggleMode() {
      this.mode = this.mode === 'edit' ? 'test' : 'edit';
      this.hideMenu();
      this.panelKey = null;
      this.render();
    }

    // ----- Modo teste -----
    spent() { return this.doc.nodes.reduce((s, n) => s + (this.ranks[n.id] || 0) * n.cost, 0); }
    prereqsMet(n) { return n.prerequisites.every((p) => (this.ranks[p] || 0) > 0); }
    canUnlock(n) {
      return (this.ranks[n.id] || 0) < n.maxRank && this.prereqsMet(n) && this.spent() + n.cost <= this.doc.budget;
    }
    canRefund(n) {
      const r = this.ranks[n.id] || 0;
      if (!r) return false;
      return r > 1 || this.dependents(n.id).every((d) => !(this.ranks[d.id] > 0));
    }
    state(n) {
      const r = this.ranks[n.id] || 0;
      if (r >= n.maxRank) return 'unlocked maxed';
      if (r > 0) return this.canUnlock(n) ? 'unlocked available' : 'unlocked';
      return this.canUnlock(n) ? 'available' : 'locked';
    }

    unlock(id) {
      const n = this.node(id);
      if (!n) return;
      if (!this.canUnlock(n)) {
        if (!this.prereqsMet(n)) this.ctx.toast('Pré-requisitos não cumpridos.', true);
        else if ((this.ranks[id] || 0) >= n.maxRank) this.ctx.toast('Nível máximo atingido.');
        else this.ctx.toast('Pontos insuficientes.', true);
        return;
      }
      this.ranks[id] = (this.ranks[id] || 0) + 1;
      this.render();
    }

    refund(id) {
      const n = this.node(id);
      if (!n || !this.canRefund(n)) {
        if (n && this.ranks[id]) this.ctx.toast('Outra habilidade desbloqueada depende desta.', true);
        return;
      }
      this.ranks[id] -= 1;
      if (!this.ranks[id]) delete this.ranks[id];
      this.render();
    }

    // ----- Ponteiro -----
    onPointerDown(e) {
      this.svg.focus({ preventScroll: true });
      this.hideMenu();
      const p = this.toWorld(e.clientX, e.clientY);
      const pin = e.target.closest('[data-pin]');
      const nodeEl = e.target.closest('.node');
      const linkEl = e.target.closest('.wire-hit');
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;

      // Botão direito / do meio, ou espaço + esquerdo: mover a visão.
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
        this.svg.setPointerCapture(e.pointerId);
        this.drag = {
          type: 'pan', button: e.button, sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y, moved: false,
          nodeId: nodeEl?.dataset.id || null, link: linkEl ? { from: linkEl.dataset.from, to: linkEl.dataset.to } : null,
        };
        this.svg.classList.add('panning');
        return;
      }
      if (e.button !== 0) return;
      this.svg.setPointerCapture(e.pointerId);

      if (this.mode === 'test') {
        if (nodeEl) { this.unlock(nodeEl.dataset.id); this.sel = new Set([nodeEl.dataset.id]); this.render(); }
        return;
      }

      if (pin) {
        const id = pin.closest('.node').dataset.id;
        const side = pin.dataset.pin;
        if (e.altKey) { this.breakPin(id, side); return; }
        this.drag = { type: 'wire', id, side };
        this.updateWire(p);
        return;
      }

      if (nodeEl) {
        const id = nodeEl.dataset.id;
        const wasSelected = this.sel.has(id);
        if (additive) {
          if (wasSelected) this.sel.delete(id); else this.sel.add(id);
        } else if (!wasSelected) {
          this.selectOnly(id);
        }
        this.selLink = null;
        const orig = new Map([...this.sel].map((sid) => [sid, { x: this.node(sid).x, y: this.node(sid).y }]));
        this.drag = { type: 'move', start: p, sx: e.clientX, sy: e.clientY, orig, moved: false, clickedId: id, wasSelected, additive };
        this.render();
        return;
      }

      if (linkEl) {
        this.sel.clear();
        this.selLink = { from: linkEl.dataset.from, to: linkEl.dataset.to };
        this.render();
        return;
      }

      // Fundo: caixa de seleção.
      this.drag = { type: 'box', start: p, base: additive ? new Set(this.sel) : new Set(), moved: false };
      if (!additive) { this.sel.clear(); this.selLink = null; this.render(); }
    }

    onPointerMove(e) {
      const p = this.toWorld(e.clientX, e.clientY);
      this.lastPointer = p;
      const d = this.drag;
      if (!d) return;

      if (d.type === 'pan') {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        this.view.x = d.vx + dx;
        this.view.y = d.vy + dy;
        this.applyView();
      } else if (d.type === 'move') {
        if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 4) return;
        if (!d.moved) { this.checkpoint(); d.moved = true; }
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        for (const [id, o] of d.orig) {
          const n = this.node(id);
          n.x = e.altKey ? Math.round(o.x + dx) : snap(o.x + dx);
          n.y = e.altKey ? Math.round(o.y + dy) : snap(o.y + dy);
        }
        this.renderLinks();
        this.renderNodes();
      } else if (d.type === 'wire') {
        this.updateWire(p);
      } else if (d.type === 'box') {
        d.moved = true;
        const x = Math.min(d.start.x, p.x);
        const y = Math.min(d.start.y, p.y);
        const w = Math.abs(p.x - d.start.x);
        const h = Math.abs(p.y - d.start.y);
        Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => this.marquee.setAttribute(k, v));
        this.marquee.hidden = false;
        this.sel = new Set(d.base);
        for (const n of this.doc.nodes) {
          if (n.x < x + w && n.x + NODE_W > x && n.y < y + h && n.y + NODE_H > y) this.sel.add(n.id);
        }
        this.renderNodes();
      }
    }

    onPointerUp(e) {
      const d = this.drag;
      this.drag = null;
      this.svg.classList.remove('panning');
      if (!d) return;

      if (d.type === 'pan') {
        if (d.button === 2 && !d.moved) this.openMenu(e, d.nodeId, d.link);
      } else if (d.type === 'move') {
        if (d.moved) this.commit();
        else if (d.wasSelected && !d.additive && this.sel.size > 1) { this.selectOnly(d.clickedId); this.render(); }
        else this.render();
      } else if (d.type === 'wire') {
        this.wireTemp.hidden = true;
        this.finishWire(d, e);
      } else if (d.type === 'box') {
        this.marquee.hidden = true;
        this.render();
      }
    }

    cancelDrag() {
      if (this.drag?.type === 'move' && this.drag.moved) this.commit();
      this.drag = null;
      this.wireTemp.hidden = true;
      this.marquee.hidden = true;
      this.svg.classList.remove('panning');
    }

    updateWire(p) {
      const d = this.drag;
      const a = this.pinPos(this.node(d.id), d.side);
      const path = d.side === 'out' ? wirePath(a.x, a.y, p.x, p.y) : wirePath(p.x, p.y, a.x, a.y);
      this.wireTemp.setAttribute('d', path);
      this.wireTemp.style.stroke = this.node(d.id).color;
      this.wireTemp.hidden = false;
    }

    finishWire(d, e) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = target?.closest?.('.node');
      const otherId = nodeEl?.dataset.id;
      if (otherId && otherId !== d.id) {
        if (d.side === 'out') this.connect(d.id, otherId);
        else this.connect(otherId, d.id);
        return;
      }
      if (otherId === d.id) return;
      // Soltou no vazio: cria um nó já conectado, como no Blueprint.
      const p = this.toWorld(e.clientX, e.clientY);
      const src = this.node(d.id);
      this.mutate(() => {
        const node = d.side === 'out'
          ? this.createNode(p.x, p.y - HEAD_H / 2, { color: src.color, category: src.category, prerequisites: [d.id] })
          : this.createNode(p.x - NODE_W, p.y - HEAD_H / 2, { color: src.color, category: src.category });
        if (d.side === 'in') src.prerequisites.push(node.id);
        this.selectOnly(node.id);
      });
      this.focusName();
    }

    onDoubleClick(e) {
      if (this.mode !== 'edit') return;
      if (e.target.closest('.node')) { this.focusName(); return; }
      if (e.target.closest('.wire-hit')) return;
      const p = this.toWorld(e.clientX, e.clientY);
      this.addNodeAt(p.x - NODE_W / 2, p.y - HEAD_H / 2);
    }

    onWheel(e) {
      e.preventDefault();
      const r = this.svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const k = Math.min(2.5, Math.max(0.2, this.view.k * Math.exp(-e.deltaY * 0.0015)));
      this.view.x = mx - (mx - this.view.x) * (k / this.view.k);
      this.view.y = my - (my - this.view.y) * (k / this.view.k);
      this.view.k = k;
      this.applyView();
    }

    applyView() {
      const { x, y, k } = this.view;
      this.viewport.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
      this.hint.dataset.zoom = Math.round(k * 100) + '%';
      this.renderHint();
    }

    fit(ids = null) {
      const nodes = ids ? ids.map((id) => this.node(id)).filter(Boolean) : this.doc.nodes;
      const r = this.svg.getBoundingClientRect();
      if (!nodes.length || !r.width) { Object.assign(this.view, { x: 80, y: 80, k: 1 }); this.applyView(); return; }
      const minX = Math.min(...nodes.map((n) => n.x));
      const minY = Math.min(...nodes.map((n) => n.y));
      const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
      const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
      const pad = 60;
      const k = Math.min(1.2, (r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1));
      this.view.k = Math.max(0.2, k);
      this.view.x = (r.width - (maxX - minX) * this.view.k) / 2 - minX * this.view.k;
      this.view.y = (r.height - (maxY - minY) * this.view.k) / 2 - minY * this.view.k;
      this.applyView();
    }

    // ----- Menu de contexto -----
    openMenu(e, nodeId, link) {
      const items = [];
      const p = this.toWorld(e.clientX, e.clientY);
      const clip = this.ctx.clipboard.get();
      const canPaste = clip?.kind === 'skill-tree/nodes';
      if (this.mode === 'test') {
        if (nodeId) this.refund(nodeId);
        return;
      }
      if (nodeId) {
        if (!this.sel.has(nodeId)) { this.selectOnly(nodeId); this.render(); }
        const n = this.sel.size;
        items.push(['Duplicar', 'Ctrl+D', () => this.duplicate()]);
        items.push(['Copiar', 'Ctrl+C', () => this.copy()]);
        items.push(['Recortar', 'Ctrl+X', () => this.copy(true)]);
        items.push(['Desconectar tudo', 'Alt+clique no pino', () => this.breakAll([...this.sel])]);
        items.push(null);
        items.push([n > 1 ? `Excluir ${n} habilidades` : 'Excluir', 'Del', () => this.deleteSelection()]);
      } else if (link) {
        this.sel.clear();
        this.selLink = link;
        this.render();
        items.push(['Remover conexão', 'Del', () => this.disconnect(link.from, link.to)]);
      } else {
        items.push(['Nova habilidade aqui', 'Duplo clique', () => this.addNodeAt(p.x - NODE_W / 2, p.y - HEAD_H / 2)]);
        if (canPaste) items.push(['Colar aqui', 'Ctrl+V', () => this.paste(p)]);
        items.push(null);
        items.push(['Selecionar tudo', 'Ctrl+A', () => { this.sel = new Set(this.doc.nodes.map((x) => x.id)); this.render(); }]);
        items.push(['Enquadrar tudo', 'F', () => { this.fit(); this.render(); }]);
      }
      this.menu.replaceChildren();
      for (const item of items) {
        if (!item) { this.menu.append(el('div', { className: 'sep' })); continue; }
        const [label, keys, fn] = item;
        const b = el('button', {}, el('span', { textContent: label }), el('kbd', { textContent: keys }));
        b.onclick = () => { this.hideMenu(); fn(); };
        this.menu.append(b);
      }
      const r = this.svg.getBoundingClientRect();
      this.menu.hidden = false;
      const mw = this.menu.offsetWidth;
      const mh = this.menu.offsetHeight;
      this.menu.style.left = Math.min(e.clientX - r.left, r.width - mw - 4) + 'px';
      this.menu.style.top = Math.min(e.clientY - r.top, r.height - mh - 4) + 'px';
    }

    hideMenu() { this.menu.hidden = true; }

    // ----- Teclado -----
    onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ') { this.spaceDown = true; return true; }
      if (key === 't' && !mod) { this.toggleMode(); return true; }
      if (key === 'f' && !mod) { this.fit(this.sel.size ? [...this.sel] : null); this.render(); return true; }
      if (e.key === 'Escape') { this.hideMenu(); this.sel.clear(); this.selLink = null; this.render(); return true; }
      if (this.mode !== 'edit') return false;
      if (mod && key === 'z' && !e.shiftKey) { this.undo(); return true; }
      if ((mod && key === 'y') || (mod && key === 'z' && e.shiftKey)) { this.redo(); return true; }
      if (mod && key === 'a') { this.sel = new Set(this.doc.nodes.map((n) => n.id)); this.selLink = null; this.render(); return true; }
      if (mod && key === 'c') { this.copy(); return true; }
      if (mod && key === 'x') { this.copy(true); return true; }
      if (mod && key === 'v') { this.paste(); return true; }
      if (mod && key === 'd') { this.duplicate(); return true; }
      if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); return true; }
      if (key === 'n' && !mod) { this.addNodeAtCenter(); return true; }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && this.sel.size) {
        const step = e.shiftKey ? GRID * 4 : GRID;
        this.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
        return true;
      }
      return false;
    }

    onKeyUp(e) {
      if (e.key === ' ') this.spaceDown = false;
    }

    // ----- Renderização -----
    render() {
      this.applyView();
      this.renderLinks();
      this.renderNodes();
      this.renderPanel();
      this.renderToolbar();
    }

    renderLinks() {
      this.gLinks.replaceChildren();
      for (const node of this.doc.nodes) {
        for (const pid of node.prerequisites) {
          const pre = this.node(pid);
          if (!pre) continue;
          const a = this.pinPos(pre, 'out');
          const b = this.pinPos(node, 'in');
          const d = wirePath(a.x, a.y, b.x, b.y);
          const selected = this.selLink && this.selLink.from === pid && this.selLink.to === node.id;
          const touching = this.sel.has(pid) || this.sel.has(node.id);
          let cls = 'wire';
          if (selected) cls += ' selected';
          if (touching) cls += ' related';
          if (this.mode === 'test') cls += this.ranks[pid] > 0 ? ' active' : ' dim';
          const wire = svgEl('path', { d, class: cls });
          wire.style.stroke = pre.color;
          this.gLinks.append(wire);
          this.gLinks.append(svgEl('path', { d, class: 'wire-hit', 'data-from': pid, 'data-to': node.id }));
        }
      }
    }

    renderNodes() {
      this.gNodes.replaceChildren();
      const hasIn = new Set();
      const hasOut = new Set();
      for (const n of this.doc.nodes) {
        if (n.prerequisites.length) hasIn.add(n.id);
        for (const p of n.prerequisites) hasOut.add(p);
      }
      // Selecionados por último, para ficarem por cima.
      const ordered = [...this.doc.nodes].sort((a, b) => this.sel.has(a.id) - this.sel.has(b.id));
      for (const node of ordered) {
        let cls = 'node';
        if (this.sel.has(node.id)) cls += ' selected';
        if (this.mode === 'test') cls += ' ' + this.state(node);
        const g = svgEl('g', { class: cls, transform: `translate(${node.x} ${node.y})`, 'data-id': node.id });
        g.style.setProperty('--node-color', node.color);

        g.append(svgEl('rect', { class: 'shadow', x: 2, y: 4, width: NODE_W, height: NODE_H, rx: 8 }));
        g.append(svgEl('rect', { class: 'body', width: NODE_W, height: NODE_H, rx: 8 }));
        g.append(svgEl('path', { class: 'head', d: `M 0 8 A 8 8 0 0 1 8 0 H ${NODE_W - 8} A 8 8 0 0 1 ${NODE_W} 8 V ${HEAD_H} H 0 Z` }));
        g.append(svgEl('rect', { class: 'outline', width: NODE_W, height: NODE_H, rx: 8 }));

        const title = svgEl('text', { class: 'title', x: 16, y: 20 });
        title.textContent = truncate(node.name || 'Sem nome', 22);
        g.append(title);

        const r = this.ranks[node.id] || 0;
        const meta = svgEl('text', { class: 'meta', x: 12, y: HEAD_H + 20 });
        const rankText = this.mode === 'test' ? `nível ${r}/${node.maxRank}` : `máx ${node.maxRank}`;
        meta.textContent = `${node.cost} pt · ${rankText}`;
        g.append(meta);

        const desc = svgEl('text', { class: 'desc', x: 12, y: HEAD_H + 37 });
        desc.textContent = truncate(node.description || node.category || '', 30);
        g.append(desc);

        if (node.category) {
          const cat = svgEl('text', { class: 'cat', x: NODE_W - 12, y: HEAD_H + 20, 'text-anchor': 'end' });
          cat.textContent = truncate(node.category, 12);
          g.append(cat);
        }

        for (const side of ['in', 'out']) {
          const cx = side === 'in' ? 0 : NODE_W;
          const connected = side === 'in' ? hasIn.has(node.id) : hasOut.has(node.id);
          const pin = svgEl('g', { class: 'pin' + (connected ? ' connected' : ''), 'data-pin': side });
          pin.append(svgEl('circle', { class: 'pin-hit', cx, cy: HEAD_H / 2, r: 12 }));
          pin.append(svgEl('circle', { class: 'pin-dot', cx, cy: HEAD_H / 2, r: 6 }));
          const tip = svgEl('title');
          tip.textContent = side === 'in'
            ? 'Entrada: arraste até a saída de outra habilidade para exigi-la. Alt+clique desconecta.'
            : 'Saída: arraste até outra habilidade para torná-la dependente. Alt+clique desconecta.';
          pin.append(tip);
          g.append(pin);
        }

        if (node.description) {
          const tip = svgEl('title');
          tip.textContent = node.name + '\n' + node.description;
          g.append(tip);
        }
        this.gNodes.append(g);
      }
    }

    renderToolbar() {
      const q = (s) => this.root.querySelector(s);
      const testing = this.mode === 'test';
      const modeBtn = q('[data-act=mode]');
      modeBtn.textContent = testing ? 'Modo: Testar' : 'Modo: Editar';
      modeBtn.classList.toggle('testing', testing);
      q('.st-budget').hidden = !testing;
      q('[data-act=reset]').hidden = !testing;
      q('[data-act=add]').disabled = testing;
      q('[data-act=undo]').disabled = testing || !this.undoStack.length;
      q('[data-act=redo]').disabled = testing || !this.redoStack.length;
      if (document.activeElement !== this.budgetInput) this.budgetInput.value = this.doc.budget;
      q('[data-out=spent]').textContent = `gastos: ${this.spent()}`;
      this.renderHint();
    }

    renderHint() {
      const zoom = this.hint.dataset.zoom || '100%';
      let text;
      if (this.mode === 'test') text = 'Clique: desbloquear · Clique direito: devolver';
      else if (this.sel.size > 1) text = `${this.sel.size} selecionadas · arraste para mover juntas · Ctrl+D duplica`;
      else text = 'Arraste dos pinos para conectar · Botão direito: menu / mover visão · Arraste no fundo: selecionar';
      this.hint.textContent = `${text} · ${zoom}`;
      this.ctx.setStatus(`${this.doc.nodes.length} habilidades`);
    }

    // ----- Painel lateral -----
    renderPanel() {
      const ids = [...this.sel];
      const key = this.mode + '|' + (this.mode === 'test' ? ids[0] || '' : ids.join(','));
      if (key !== this.panelKey) {
        this.panelKey = key;
        this.panel.replaceChildren();
        if (this.mode === 'test') this.buildTestPanel();
        else if (ids.length === 1) this.buildNodePanel();
        else if (ids.length > 1) this.buildMultiPanel();
        else this.buildTreePanel();
      }
      this.refreshPanel();
    }

    // Liga campos do painel ao documento, com um ponto de desfazer por edição.
    bindField(input, apply) {
      input.addEventListener('focus', () => { this.formFresh = true; });
      input.addEventListener('input', () => {
        if (this.formFresh) { this.checkpoint(); this.formFresh = false; }
        apply(input.value);
        this.ctx.changed();
        this.renderLinks();
        this.renderNodes();
        this.refreshPanel();
        this.renderToolbar();
      });
    }

    field(label, input) {
      return el('label', { className: 'field' }, el('span', { textContent: label }), input);
    }

    buildTreePanel() {
      const name = el('input', { type: 'text' });
      name.dataset.field = 'tree-name';
      this.bindField(name, (v) => { this.doc.name = v; });
      this.panel.append(
        el('h2', { textContent: 'Árvore' }),
        this.field('Nome', name),
        el('div', { className: 'st-stats' }),
        el('h3', { textContent: 'Atalhos' }),
        this.helpList([
          ['Duplo clique no fundo', 'nova habilidade'],
          ['Arrastar de um pino', 'conectar (soltar no vazio cria uma nova)'],
          ['Alt + clique no pino', 'desconectar'],
          ['Arrastar no fundo', 'caixa de seleção'],
          ['Ctrl / Shift + clique', 'adicionar à seleção'],
          ['Botão direito', 'menu · arrastar move a visão'],
          ['Roda do mouse', 'zoom'],
          ['Ctrl+C / V / X / D', 'copiar, colar, recortar, duplicar'],
          ['Ctrl+Z / Ctrl+Y', 'desfazer / refazer'],
          ['Setas', 'mover seleção (Shift: mais longe)'],
          ['F · T', 'enquadrar · modo testar'],
          ['Alt ao arrastar', 'sem encaixe na grade'],
        ]),
      );
    }

    helpList(rows) {
      const dl = el('dl', { className: 'help' });
      for (const [k, v] of rows) dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
      return dl;
    }

    buildNodePanel() {
      const id = [...this.sel][0];
      const n = () => this.node(id);
      const mk = (tag, type, fieldName, apply, attrs = {}) => {
        const input = el(tag, type ? { type, ...attrs } : attrs);
        input.dataset.field = fieldName;
        this.bindField(input, (v) => { if (n()) apply(n(), v); });
        return input;
      };
      const name = mk('input', 'text', 'name', (node, v) => { node.name = v; });
      const desc = mk('textarea', undefined, 'description', (node, v) => { node.description = v; }, { rows: 4 });
      const cost = mk('input', 'number', 'cost', (node, v) => { node.cost = toInt(v, 0, 0); }, { min: 0 });
      const maxRank = mk('input', 'number', 'maxRank', (node, v) => { node.maxRank = toInt(v, 1, 1); }, { min: 1 });
      const category = mk('input', 'text', 'category', (node, v) => { node.category = v; });
      category.setAttribute('list', 'st-categories');
      const color = mk('input', 'color', 'color', (node, v) => { node.color = v; });

      const prereqAdd = el('select', { className: 'prereq-add' });
      prereqAdd.addEventListener('change', () => {
        if (prereqAdd.value) this.connect(prereqAdd.value, id);
      });

      this.panel.append(
        el('h2', { textContent: 'Habilidade' }),
        this.field('Nome', name),
        this.field('Descrição', desc),
        el('div', { className: 'row' }, this.field('Custo (pontos)', cost), this.field('Nível máximo', maxRank)),
        el('div', { className: 'row' }, this.field('Categoria', category), this.field('Cor', color)),
        el('datalist', { id: 'st-categories' }),
        el('fieldset', {}, el('legend', { textContent: 'Pré-requisitos' }), el('ul', { className: 'chips prereqs' }), prereqAdd),
        el('fieldset', {}, el('legend', { textContent: 'Desbloqueia' }), el('ul', { className: 'chips unlocks' })),
        el('button', { className: 'danger', textContent: 'Excluir habilidade', onclick: () => this.deleteSelection() }),
      );
    }

    buildMultiPanel() {
      const ids = () => [...this.sel].map((id) => this.node(id)).filter(Boolean);
      const color = el('input', { type: 'color' });
      color.dataset.field = 'multi-color';
      this.bindField(color, (v) => ids().forEach((n) => { n.color = v; }));
      const category = el('input', { type: 'text', placeholder: '(vários)' });
      category.dataset.field = 'multi-category';
      category.setAttribute('list', 'st-categories');
      this.bindField(category, (v) => ids().forEach((n) => { n.category = v; }));
      const cost = el('input', { type: 'number', min: 0, placeholder: '(vários)' });
      cost.dataset.field = 'multi-cost';
      this.bindField(cost, (v) => { if (v !== '') ids().forEach((n) => { n.cost = toInt(v, 0, 0); }); });

      const btn = (label, fn) => el('button', { textContent: label, onclick: fn });
      this.panel.append(
        el('h2', { className: 'multi-title' }),
        el('p', { className: 'muted', textContent: 'Alterar um campo aplica a todas as selecionadas.' }),
        el('div', { className: 'row' }, this.field('Cor', color), this.field('Custo', cost)),
        this.field('Categoria', category),
        el('datalist', { id: 'st-categories' }),
        el('h3', { textContent: 'Organizar' }),
        el('div', { className: 'btn-grid' },
          btn('Alinhar à esquerda', () => this.align('left')),
          btn('Alinhar ao topo', () => this.align('top')),
          btn('Distribuir na horizontal', () => this.align('hdist')),
          btn('Distribuir na vertical', () => this.align('vdist')),
        ),
        el('div', { className: 'btn-grid' },
          btn('Duplicar', () => this.duplicate()),
          btn('Desconectar tudo', () => this.breakAll([...this.sel])),
        ),
        el('button', { className: 'danger', textContent: 'Excluir selecionadas', onclick: () => this.deleteSelection() }),
      );
    }

    buildTestPanel() {
      this.panel.append(el('h2', { textContent: 'Modo Testar' }), el('div', { className: 'test-info' }));
    }

    refreshPanel() {
      const ids = [...this.sel];
      const setVal = (fieldName, value) => {
        const input = this.panel.querySelector(`[data-field="${fieldName}"]`);
        if (input && document.activeElement !== input) input.value = value;
      };
      const categories = [...new Set(this.doc.nodes.map((n) => n.category).filter(Boolean))];
      const dl = this.panel.querySelector('#st-categories');
      if (dl) dl.replaceChildren(...categories.map((c) => el('option', { value: c })));

      if (this.mode === 'test') {
        const box = this.panel.querySelector('.test-info');
        const n = this.node(ids[0]);
        const spent = this.spent();
        box.replaceChildren(
          el('p', { textContent: `Pontos: ${spent} gastos de ${this.doc.budget} (${this.doc.budget - spent} restantes).` }),
          el('p', { className: 'muted', textContent: 'Clique para desbloquear, clique direito para devolver.' }),
        );
        if (n) {
          box.append(el('h3', { textContent: n.name }));
          if (n.description) box.append(el('p', { textContent: n.description }));
          box.append(el('p', { className: 'muted', textContent: `Custo ${n.cost} pt · nível ${this.ranks[n.id] || 0}/${n.maxRank}` }));
          if (n.prerequisites.length) box.append(el('p', { className: 'muted', textContent: 'Requer: ' + n.prerequisites.map((p) => this.node(p)?.name).join(', ') }));
        }
        return;
      }

      if (ids.length === 0) {
        setVal('tree-name', this.doc.name);
        const stats = this.panel.querySelector('.st-stats');
        const total = this.doc.nodes.reduce((s, n) => s + n.cost * n.maxRank, 0);
        const roots = this.doc.nodes.filter((n) => !n.prerequisites.length).length;
        stats.replaceChildren(
          el('div', { textContent: this.doc.nodes.length ? `${this.doc.nodes.length} habilidades · ${roots} iniciais` : 'Árvore vazia: dê um duplo clique no canvas.' }),
          el('div', { textContent: `${total} pontos para completar tudo` }),
        );
        return;
      }

      if (ids.length > 1) {
        const nodes = ids.map((id) => this.node(id)).filter(Boolean);
        this.panel.querySelector('.multi-title').textContent = `${nodes.length} habilidades selecionadas`;
        const same = (k) => (nodes.every((n) => n[k] === nodes[0][k]) ? nodes[0][k] : '');
        setVal('multi-color', same('color') || nodes[0].color);
        setVal('multi-category', same('category'));
        setVal('multi-cost', same('cost'));
        return;
      }

      const n = this.node(ids[0]);
      if (!n) return;
      for (const k of ['name', 'description', 'cost', 'maxRank', 'category', 'color']) setVal(k, n[k]);

      const chip = (node, onRemove) => {
        const li = el('li', { textContent: node.name, title: 'Ir para esta habilidade' });
        li.style.setProperty('--chip-color', node.color);
        li.onclick = () => { this.selectOnly(node.id); this.render(); };
        if (onRemove) {
          li.append(el('button', { type: 'button', textContent: '×', title: 'Remover', onclick: (e) => { e.stopPropagation(); onRemove(); } }));
        }
        return li;
      };
      this.panel.querySelector('.prereqs').replaceChildren(
        ...n.prerequisites.map((p) => this.node(p)).filter(Boolean).map((p) => chip(p, () => this.disconnect(p.id, n.id))),
      );
      this.panel.querySelector('.unlocks').replaceChildren(...this.dependents(n.id).map((d) => chip(d)));

      const sel = this.panel.querySelector('.prereq-add');
      const options = this.doc.nodes
        .filter((o) => o.id !== n.id && !n.prerequisites.includes(o.id) && !this.dependsOn(o.id, n.id))
        .map((o) => el('option', { value: o.id, textContent: o.name }));
      sel.replaceChildren(el('option', { value: '', textContent: '+ adicionar pré-requisito…' }), ...options);
      sel.disabled = !options.length;
    }
  }

  window.SKR.registerWorkspace({
    id: 'skill-tree',
    name: 'Skill Tree',
    description: 'Árvores de habilidades com custos, níveis e pré-requisitos. Conecte nós como em Blueprints.',
    color: '#6ea8ff',
    createDocument: () => ({ type: 'skill-tree', version: 2, name: 'Nova skill tree', budget: 10, nodes: [] }),
    exampleDocument: () => JSON.parse(JSON.stringify(EXAMPLE)),
    matches: (doc) => Array.isArray(doc?.nodes),
    mount: (host, doc, ctx) => new SkillTreeEditor(host, doc, ctx),
  });
})();
