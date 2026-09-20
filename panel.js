(() => {
    'use strict';

    const API = '/api/addons/petey-life';
    const root = document.querySelector('[data-addon-id="petey-life"]');
    if (!root) return;

    const byId = id => document.getElementById(id);
    const canvas = byId('life-canvas');
    const ctx = canvas.getContext('2d');
    const stage = byId('life-stage');
    const bubble = byId('life-bubble');
    const presence = root.querySelector('.life-presence');
    const modeButtons = [...root.querySelectorAll('[data-life-mode]')];
    const panels = [...root.querySelectorAll('[data-life-panel]')];
    const colors = ['#4f7693', '#806f65', '#895b3f', '#3f786b', '#67507c', '#8b5f3d', '#4e8b58'];
    const sizes = {
        bed: [4, 2], bookshelf: [2, 1], chair: [1, 1], coffee: [1, 1],
        computer: [2, 2], counter: [3, 1], lamp: [1, 1], plant: [1, 1],
        rug: [3, 2], sofa: [3, 2], table: [2, 2], television: [3, 1],
    };

    let world = null;
    let persona = null;
    let mode = 'peek';
    let active = false;
    let busy = false;
    let placement = false;
    let selectedId = '';
    let petey = {col: 0, row: 0};
    let path = [];
    let lastStep = 0;
    let animationFrame = 0;
    let autonomyTimer = 0;
    let persistTimer = 0;
    let bubbleTimer = 0;
    let metrics = {x: 0, y: 0, tile: 24};

    async function api(pathname, options = {}) {
        const response = await fetch(`${API}${pathname}`, {
            ...options,
            headers: {'Content-Type': 'application/json', ...(options.headers || {})},
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
    }

    function setStatus(text, isBusy = false) {
        byId('life-status').textContent = text;
        presence.classList.toggle('busy', isBusy);
    }

    function showError(error) {
        setStatus('Needs attention');
        byId('life-hint').textContent = error?.message || String(error);
    }

    function title(value) {
        return String(value).replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function applyState(payload) {
        world = payload.world;
        persona = payload.petey;
        petey = {col: Number(world.petey.col), row: Number(world.petey.row)};
        path = [];
        byId('life-persona').textContent = `${persona.name} · ${persona.role}`;
        byId('life-autonomy').checked = world.settings.autonomy;
        byId('life-interval').value = String(world.settings.interval);
        byId('life-activity').textContent = world.petey.activity;
        byId('life-hint').textContent = persona.traits.length ? persona.traits.slice(0, 3).join(' · ') : 'Petey is at home';
        const kindSelect = byId('life-object-kind');
        if (!kindSelect.options.length) {
            payload.object_kinds.forEach(kind => kindSelect.add(new Option(title(kind), kind)));
        }
        renderEvents();
        if (world.petey.say) showBubble(world.petey.say, 3500);
        scheduleAutonomy();
        resize();
    }

    async function load() {
        if (world) {
            scheduleAutonomy();
            resize();
            return;
        }
        setStatus('Opening room', true);
        try {
            applyState(await api('/state'));
            setStatus('At home');
            startAnimation();
        } catch (error) {
            showError(error);
        }
    }

    function setMode(next) {
        mode = next;
        modeButtons.forEach(button => button.classList.toggle('active', button.dataset.lifeMode === next));
        panels.forEach(panel => { panel.hidden = panel.dataset.lifePanel !== next; });
        stage.classList.toggle('building', next === 'build');
        placement = false;
        byId('life-build-status').textContent = 'Select Place item, then choose a tile.';
        scheduleAutonomy();
    }

    function occupiedCells(ignoreId = '') {
        const cells = new Set();
        world.objects.forEach(object => {
            if (object.id === ignoreId || object.kind === 'rug') return;
            for (let row = object.row; row < object.row + object.h; row += 1) {
                for (let col = object.col; col < object.col + object.w; col += 1) cells.add(`${col},${row}`);
            }
        });
        return cells;
    }

    function neighbors(node, blocked) {
        return [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .map(([dc, dr]) => ({col: node.col + dc, row: node.row + dr}))
            .filter(item => item.col >= 0 && item.row >= 0 && item.col < world.cols && item.row < world.rows)
            .filter(item => !blocked.has(`${item.col},${item.row}`));
    }

    function findPath(start, goals) {
        const blocked = occupiedCells();
        blocked.delete(`${Math.round(start.col)},${Math.round(start.row)}`);
        const goalKeys = new Set(goals.map(goal => `${goal.col},${goal.row}`));
        const queue = [{col: Math.round(start.col), row: Math.round(start.row)}];
        const cameFrom = new Map([[`${queue[0].col},${queue[0].row}`, null]]);
        let end = null;
        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            const key = `${current.col},${current.row}`;
            if (goalKeys.has(key)) { end = current; break; }
            neighbors(current, blocked).forEach(next => {
                const nextKey = `${next.col},${next.row}`;
                if (!cameFrom.has(nextKey)) { cameFrom.set(nextKey, current); queue.push(next); }
            });
        }
        if (!end) return [];
        const result = [];
        while (end && !(end.col === Math.round(start.col) && end.row === Math.round(start.row))) {
            result.unshift(end);
            end = cameFrom.get(`${end.col},${end.row}`);
        }
        return result;
    }

    function approachTiles(object) {
        const blocked = occupiedCells(object.id);
        const candidates = [];
        for (let col = object.col; col < object.col + object.w; col += 1) {
            candidates.push({col, row: object.row - 1}, {col, row: object.row + object.h});
        }
        for (let row = object.row; row < object.row + object.h; row += 1) {
            candidates.push({col: object.col - 1, row}, {col: object.col + object.w, row});
        }
        return candidates.filter(item => item.col >= 0 && item.row >= 0 && item.col < world.cols && item.row < world.rows)
            .filter(item => !blocked.has(`${item.col},${item.row}`));
    }

    function applyDecision(payload) {
        const decision = payload.decision;
        world.events = payload.state.world.events;
        world.petey.activity = decision.activity;
        world.petey.say = decision.say;
        byId('life-activity').textContent = decision.activity;
        renderEvents();
        if (decision.say) showBubble(decision.say, Math.max(3000, decision.duration * 500));
        const target = world.objects.find(object => object.id === decision.target);
        path = target ? findPath(petey, approachTiles(target)) : [];
        if (!target && decision.action === 'walk_to') {
            const open = [];
            const blocked = occupiedCells();
            for (let row = 0; row < world.rows; row += 1) for (let col = 0; col < world.cols; col += 1) {
                if (!blocked.has(`${col},${row}`)) open.push({col, row});
            }
            if (open.length) path = findPath(petey, [open[Math.floor(Math.random() * open.length)]]);
        }
        busy = false;
        setStatus(path.length ? 'Walking' : 'At home');
        scheduleAutonomy(Math.max(decision.duration * 1000, world.settings.interval * 1000));
    }

    async function requestDecision(command = '') {
        if (busy || !world) return;
        busy = true;
        clearTimeout(autonomyTimer);
        setStatus(command ? 'Listening to you' : 'Thinking', true);
        byId('life-next').disabled = true;
        try {
            applyDecision(await api('/decide', {
                method: 'POST', body: JSON.stringify({command, visible: active && !document.hidden}),
            }));
        } catch (error) {
            busy = false;
            showError(error);
            scheduleAutonomy();
        } finally {
            byId('life-next').disabled = false;
        }
    }

    function scheduleAutonomy(delay) {
        clearTimeout(autonomyTimer);
        if (!world?.settings.autonomy || !active || document.hidden || mode !== 'peek') return;
        autonomyTimer = window.setTimeout(() => requestDecision(), delay ?? world.settings.interval * 1000);
    }

    async function saveSettings() {
        try {
            const payload = await api('/settings', {
                method: 'PUT',
                body: JSON.stringify({autonomy: byId('life-autonomy').checked, interval: Number(byId('life-interval').value)}),
            });
            world.settings = payload.world.settings;
            setStatus('Settings saved');
            scheduleAutonomy(world.settings.autonomy ? 800 : undefined);
        } catch (error) { showError(error); }
    }

    async function saveWorld() {
        try {
            const payload = await api('/world', {method: 'PUT', body: JSON.stringify({petey: world.petey, objects: world.objects})});
            world.objects = payload.world.objects;
            world.petey = payload.world.petey;
            renderEvents();
        } catch (error) { showError(error); }
    }

    function queuePositionSave() {
        clearTimeout(persistTimer);
        persistTimer = window.setTimeout(() => {
            world.petey.col = Math.round(petey.col);
            world.petey.row = Math.round(petey.row);
            saveWorld();
        }, 500);
    }

    function renderEvents() {
        const list = byId('life-events');
        list.replaceChildren();
        const events = [...(world?.events || [])].reverse().slice(0, 8);
        byId('life-event-count').textContent = events.length ? `${events.length} recent` : '';
        if (!events.length) {
            const item = document.createElement('li'); item.textContent = 'Petey has not done anything yet.'; list.append(item); return;
        }
        events.forEach(event => {
            const item = document.createElement('li');
            const stamp = event.at ? new Date(event.at * 1000).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}) : '';
            item.textContent = `${stamp}${stamp ? ' · ' : ''}${event.text}`;
            list.append(item);
        });
    }

    function showBubble(text, duration = 4000) {
        clearTimeout(bubbleTimer);
        bubble.textContent = text;
        bubble.hidden = false;
        positionBubble();
        bubbleTimer = window.setTimeout(() => { bubble.hidden = true; }, duration);
    }

    function positionBubble() {
        bubble.style.left = `${metrics.x + (petey.col + .8) * metrics.tile}px`;
        bubble.style.top = `${Math.max(8, metrics.y + (petey.row - .85) * metrics.tile)}px`;
    }

    function resize() {
        if (!world) return;
        const rect = stage.getBoundingClientRect();
        const cssWidth = Math.max(320, rect.width);
        const cssHeight = Math.max(400, rect.height);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(cssHeight * ratio);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        metrics.tile = Math.max(15, Math.floor(Math.min((cssWidth - 20) / world.cols, (cssHeight - 20) / world.rows)));
        metrics.x = Math.floor((cssWidth - metrics.tile * world.cols) / 2);
        metrics.y = Math.floor((cssHeight - metrics.tile * world.rows) / 2);
        draw(performance.now());
    }

    function roundedRect(x, y, w, h, radius = 4) {
        ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
    }

    function drawFloor() {
        const {x, y, tile} = metrics;
        ctx.fillStyle = '#211a2a';
        ctx.fillRect(x - 5, y - 5, world.cols * tile + 10, world.rows * tile + 10);
        for (let row = 0; row < world.rows; row += 1) for (let col = 0; col < world.cols; col += 1) {
            ctx.fillStyle = (col + row) % 2 ? '#30263a' : '#342a40';
            ctx.fillRect(x + col * tile, y + row * tile, tile, tile);
            ctx.strokeStyle = 'rgba(255,255,255,.025)'; ctx.strokeRect(x + col * tile, y + row * tile, tile, tile);
        }
        ctx.fillStyle = '#554466';
        ctx.fillRect(x - 5, y - 8, world.cols * tile + 10, 8);
        ctx.fillRect(x - 8, y - 5, 8, world.rows * tile + 10);
    }

    function drawObject(object) {
        const {x, y, tile} = metrics;
        const left = x + object.col * tile + 2;
        const top = y + object.row * tile + 2;
        const width = object.w * tile - 4;
        const height = object.h * tile - 4;
        ctx.save();
        ctx.fillStyle = object.kind === 'rug' ? `${object.color}88` : 'rgba(0,0,0,.22)';
        roundedRect(left + 3, top + 4, width, height, Math.max(3, tile * .12));
        ctx.fillStyle = object.color;
        roundedRect(left, top, width, height, Math.max(3, tile * .12));
        const line = Math.max(1.5, tile * .07);
        ctx.lineWidth = line; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.fillStyle = 'rgba(255,255,255,.45)';
        if (object.kind === 'bed') {
            ctx.fillStyle = '#ddd5e9'; roundedRect(left + line, top + line, width * .3, height - line * 2, 3);
            ctx.strokeRect(left + width * .34, top + line, width * .6, height - line * 2);
        } else if (object.kind === 'bookshelf') {
            for (let i = 0; i < 5; i += 1) { ctx.fillStyle = ['#d48a72','#e2bd65','#70a8a0'][i % 3]; ctx.fillRect(left + width * (.1 + i * .17), top + height * .2, width * .1, height * .65); }
        } else if (object.kind === 'computer') {
            ctx.fillStyle = '#151824'; roundedRect(left + width * .14, top + height * .1, width * .72, height * .46, 3);
            ctx.fillStyle = '#77d6d2'; ctx.fillRect(left + width * .2, top + height * .16, width * .6, height * .32);
            ctx.fillStyle = '#b8a6c8'; ctx.fillRect(left + width * .22, top + height * .72, width * .56, height * .12);
        } else if (object.kind === 'sofa') {
            ctx.fillStyle = 'rgba(255,255,255,.16)'; roundedRect(left + line, top + line, width - line * 2, height * .4, 4);
            ctx.strokeRect(left + width / 2, top + height * .46, 1, height * .45);
        } else if (object.kind === 'television') {
            ctx.fillStyle = '#11131a'; roundedRect(left + width * .08, top + line, width * .84, height * .72, 3);
            ctx.fillStyle = '#6d7895'; ctx.fillRect(left + width * .14, top + height * .15, width * .72, height * .42);
        } else if (object.kind === 'plant') {
            ctx.fillStyle = '#986549'; ctx.fillRect(left + width * .25, top + height * .58, width * .5, height * .35);
            ctx.fillStyle = '#75c47e'; ctx.beginPath(); ctx.arc(left + width * .5, top + height * .38, width * .34, 0, Math.PI * 2); ctx.fill();
        } else if (object.kind === 'lamp') {
            ctx.fillStyle = '#e8cb76'; ctx.beginPath(); ctx.moveTo(left + width * .2, top + height * .48); ctx.lineTo(left + width * .8, top + height * .48); ctx.lineTo(left + width * .65, top + height * .12); ctx.lineTo(left + width * .35, top + height * .12); ctx.fill();
            ctx.fillRect(left + width * .47, top + height * .48, width * .08, height * .4);
        } else if (object.kind === 'coffee') {
            ctx.fillStyle = '#292331'; roundedRect(left + width * .2, top + height * .18, width * .58, height * .65, 3);
            ctx.fillStyle = '#e6c46a'; ctx.fillRect(left + width * .34, top + height * .3, width * .28, height * .12);
        } else if (object.kind === 'chair') {
            ctx.fillStyle = 'rgba(255,255,255,.18)'; roundedRect(left + width * .18, top + height * .1, width * .64, height * .42, 3);
        } else if (object.kind !== 'rug') {
            ctx.strokeRect(left + line, top + line, width - line * 2, height - line * 2);
        }
        if (selectedId === object.id) {
            ctx.strokeStyle = '#f5d77c'; ctx.lineWidth = 3; ctx.setLineDash([5, 3]); ctx.strokeRect(left - 2, top - 2, width + 4, height + 4);
        }
        ctx.restore();
    }

    function drawPetey(now) {
        const {x, y, tile} = metrics;
        const centerX = x + (petey.col + .5) * tile;
        const centerY = y + (petey.row + .5) * tile;
        const bob = path.length ? Math.sin(now / 90) * tile * .04 : Math.sin(now / 600) * tile * .025;
        const size = tile * .66;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(centerX, centerY + tile * .35, size * .48, size * .18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#72d4a8'; roundedRect(centerX - size * .42, centerY - size * .38 + bob, size * .84, size * .76, size * .2);
        ctx.fillStyle = '#d8fff0'; roundedRect(centerX - size * .31, centerY - size * .24 + bob, size * .62, size * .35, size * .12);
        ctx.fillStyle = '#252033';
        ctx.fillRect(centerX - size * .18, centerY - size * .14 + bob, Math.max(2, size * .1), Math.max(2, size * .1));
        ctx.fillRect(centerX + size * .09, centerY - size * .14 + bob, Math.max(2, size * .1), Math.max(2, size * .1));
        ctx.fillStyle = '#b58aff'; ctx.fillRect(centerX - size * .12, centerY + size * .18 + bob, size * .24, size * .08);
        ctx.strokeStyle = '#72d4a8'; ctx.lineWidth = Math.max(2, tile * .08); ctx.beginPath(); ctx.moveTo(centerX, centerY - size * .38 + bob); ctx.lineTo(centerX, centerY - size * .55 + bob); ctx.stroke();
        ctx.fillStyle = '#f5d77c'; ctx.beginPath(); ctx.arc(centerX, centerY - size * .59 + bob, size * .09, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        positionBubble();
    }

    function draw(now) {
        if (!world) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawFloor();
        world.objects.filter(object => object.kind === 'rug').forEach(drawObject);
        world.objects.filter(object => object.kind !== 'rug').sort((a, b) => a.row - b.row).forEach(drawObject);
        drawPetey(now);
    }

    function animate(now) {
        if (active && world) {
            if (path.length && now - lastStep > 145) {
                const next = path.shift(); petey.col = next.col; petey.row = next.row; lastStep = now;
                if (!path.length) { setStatus('At home'); queuePositionSave(); }
            }
            draw(now);
        }
        animationFrame = requestAnimationFrame(animate);
    }

    function startAnimation() {
        if (!animationFrame) animationFrame = requestAnimationFrame(animate);
    }

    function canvasCell(event) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.clientWidth / rect.width;
        const scaleY = canvas.clientHeight / rect.height;
        return {
            col: Math.floor(((event.clientX - rect.left) * scaleX - metrics.x) / metrics.tile),
            row: Math.floor(((event.clientY - rect.top) * scaleY - metrics.y) / metrics.tile),
        };
    }

    function objectAt(cell) {
        return world.objects.slice().reverse().find(object => cell.col >= object.col && cell.col < object.col + object.w && cell.row >= object.row && cell.row < object.row + object.h);
    }

    function uniqueId(kind) {
        let index = 1; let candidate = kind;
        const ids = new Set(world.objects.map(object => object.id));
        while (ids.has(candidate)) candidate = `${kind}-${index++}`;
        return candidate;
    }

    async function handleCanvasClick(event) {
        if (mode !== 'build' || !world) return;
        const cell = canvasCell(event);
        if (cell.col < 0 || cell.row < 0 || cell.col >= world.cols || cell.row >= world.rows) return;
        const existing = objectAt(cell);
        if (!placement) {
            selectedId = existing?.id || '';
            byId('life-remove').disabled = !selectedId;
            byId('life-build-status').textContent = existing ? `${existing.label} selected.` : 'Nothing on that tile.';
            draw(performance.now());
            return;
        }
        const kind = byId('life-object-kind').value;
        const [w, h] = sizes[kind] || [1, 1];
        const blocked = occupiedCells();
        const fits = cell.col + w <= world.cols && cell.row + h <= world.rows &&
            [...Array(h)].every((_, dr) => [...Array(w)].every((__, dc) => !blocked.has(`${cell.col + dc},${cell.row + dr}`)));
        if (!fits) { byId('life-build-status').textContent = 'That item does not fit there.'; return; }
        const id = uniqueId(kind);
        world.objects.push({id, kind, label: byId('life-object-label').value.trim() || title(kind), col: cell.col, row: cell.row, w, h, color: colors[world.objects.length % colors.length]});
        selectedId = id; placement = false; byId('life-remove').disabled = false;
        byId('life-build-status').textContent = `${title(kind)} placed.`;
        await saveWorld(); draw(performance.now());
    }

    modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.lifeMode)));
    byId('life-next').addEventListener('click', () => requestDecision());
    byId('life-autonomy').addEventListener('change', saveSettings);
    byId('life-interval').addEventListener('change', saveSettings);
    byId('life-command-form').addEventListener('submit', event => {
        event.preventDefault(); const command = byId('life-command').value.trim(); if (command) { requestDecision(command); byId('life-command').value = ''; }
    });
    root.querySelectorAll('[data-life-command]').forEach(button => button.addEventListener('click', () => requestDecision(button.dataset.lifeCommand)));
    byId('life-place').addEventListener('click', () => { placement = true; selectedId = ''; byId('life-remove').disabled = true; byId('life-build-status').textContent = 'Now tap an empty tile.'; });
    byId('life-remove').addEventListener('click', async () => {
        if (!selectedId) return; const object = world.objects.find(item => item.id === selectedId);
        world.objects = world.objects.filter(item => item.id !== selectedId); selectedId = ''; byId('life-remove').disabled = true;
        byId('life-build-status').textContent = `${object?.label || 'Item'} removed.`; await saveWorld(); draw(performance.now());
    });
    canvas.addEventListener('click', handleCanvasClick);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(autonomyTimer); else scheduleAutonomy(); });
    window.addEventListener('resize', resize);
    window.addEventListener('petey:view', event => {
        active = event.detail.view === 'addon-petey-life';
        if (active) load(); else { clearTimeout(autonomyTimer); path = []; }
    });
})();
