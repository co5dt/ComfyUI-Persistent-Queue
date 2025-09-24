// Minimal frontend extension for ComfyUI Persistent Queue
// Loaded automatically from WEB_DIRECTORY by ComfyUI and served at /extensions/<name>/pqueue.js

(function() {
    const API = {
        getQueue: () => fetch('/api/pqueue').then(r => r.json()),
        getHistory: (limit=50) => fetch(`/api/pqueue/history?limit=${limit}`).then(r => r.json()),
        pause: () => fetch('/api/pqueue/pause', { method: 'POST' }),
        resume: () => fetch('/api/pqueue/resume', { method: 'POST' }),
        reorder: (order) => fetch('/api/pqueue/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }),
        setPriority: (prompt_id, priority) => fetch('/api/pqueue/priority', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt_id, priority }) }),
        del: (prompt_ids) => fetch('/api/pqueue/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt_ids }) }),
    };

    const state = {
        paused: false,
        queue_running: [],
        queue_pending: [],
        db_pending: [],
        history: [],
        running_progress: {},
        container: null,
        listPending: null,
        selectedPending: new Set(),
    };

    function el(tag, attrs={}, children=[]) {
        const e = document.createElement(tag);
        Object.entries(attrs).forEach(([k,v]) => {
            if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
        });
        children.forEach(c => e.appendChild(c));
        return e;
    }

    function ensureThemeLink() {
        if (!document.getElementById('pqueue-style-link')) {
            const link = document.createElement('link');
            link.id = 'pqueue-style-link';
            link.rel = 'stylesheet';
            link.href = '/extensions/ComfyUI-PersistentQueue/css/queue_style.css';
            document.head.appendChild(link);
        }
    }

    function render() {
        if (!state.container) return;
        ensureThemeLink();
        state.container.innerHTML = '';

        const root = el('div', { class: 'pqueue-root' });

        // Toolbar
        const toolbar = el('div', { class: 'pqueue-toolbar' });
        const pauseBtn = el('button', { id: 'pqueue-toggle', class: `p-button p-component ${state.paused ? 'p-button-success' : 'p-button-warning'}` });
        pauseBtn.innerHTML = `<span class="p-button-icon pi ${state.paused ? 'pi-play' : 'pi-pause'}"></span><span class="p-button-label">${state.paused ? 'Resume' : 'Pause'}</span>`;
        const refreshBtn = el('button', { id: 'pqueue-refresh', class: 'p-button p-component p-button-text' });
        refreshBtn.innerHTML = `<span class="p-button-icon pi pi-refresh"></span><span class="p-button-label">Refresh</span>`;
        const clearBtn = el('button', { id: 'pqueue-clear', class: 'p-button p-component p-button-text p-button-danger' });
        clearBtn.innerHTML = `<span class="p-button-icon pi pi-stop"></span><span class="p-button-label">Clear Pending</span>`;
        toolbar.appendChild(pauseBtn);
        toolbar.appendChild(refreshBtn);
        toolbar.appendChild(clearBtn);

        const sections = el('div', { class: 'pqueue-sections' });

        // Running
        const runningCard = el('div', { class: 'p-card pqueue-card' });
        const runningBody = el('div', { class: 'p-card-body' });
        runningBody.appendChild(el('div', { class: 'p-card-title', text: 'Running' }));
        const runningList = el('ul', { class: 'pqueue-list' });
        if (!state.queue_running.length) runningList.appendChild(el('li', { class: 'pqueue-empty', text: 'No running job' }));
        state.queue_running.forEach(item => {
            const pid = item[1];
            const leftCol = el('div', { class: 'pqueue-left' }, [
                el('div', { class: 'pqueue-meta' }, [
                    el('i', { class: 'pi pi-spin pi-spinner' }),
                    el('span', { text: pid })
                ]),
                (() => {
                    const wrap = el('div', { class: 'pqueue-progress-wrap' });
                    const bar = el('div', { class: 'pqueue-progress-bar' });
                    const frac = Math.max(0, Math.min(1, Number(state.running_progress && state.running_progress[pid]) || 0));
                    bar.style.width = `${(frac * 100).toFixed(2)}%`;
                    wrap.appendChild(bar);
                    return wrap;
                })()
            ]);
            const li = el('li', { class: 'pqueue-item' }, [
                leftCol,
                el('div', { class: 'pqueue-actions' }, [])
            ]);
            runningList.appendChild(li);
        });
        runningBody.appendChild(runningList);
        runningCard.appendChild(runningBody);

        // Pending
        const pendingCard = el('div', { class: 'p-card pqueue-card' });
        const pendingBody = el('div', { class: 'p-card-body' });
        pendingBody.appendChild(el('div', { class: 'p-card-title', text: `Pending (${state.queue_pending.length})` }));
        const pendingList = el('ul', { id: 'pqueue-pending', class: 'pqueue-list' });
        if (!state.queue_pending.length) pendingList.appendChild(el('li', { class: 'pqueue-empty', text: 'No pending items' }));
        state.queue_pending.forEach(item => {
            const checked = state.selectedPending.has(item[1]);
            const li = el('li', { draggable: 'true', 'data-id': item[1], class: 'pqueue-item' }, [
                el('div', { class: 'pqueue-meta' }, [
                    el('i', { class: 'pi pi-bars', style: 'cursor:grab' }),
                    (() => { const cb = el('input', { type: 'checkbox', class: 'p-checkbox-input pqueue-select' }); if (checked) cb.checked = true; return cb; })(),
                    el('span', { text: item[1] })
                ]),
                el('div', { class: 'pqueue-actions' }, [
                    el('input', { type: 'number', value: '0', class: 'p-inputtext pqueue-priority', min: '0', style: 'width:5rem' }),
                    (() => { const b=el('button', { class: 'p-button p-component p-button-text pqueue-priority-save' }); b.innerHTML='<span class="p-button-icon pi pi-sort-amount-up-alt"></span>'; return b; })(),
                    (() => { const b=el('button', { class: 'p-button p-component p-button-text p-button-danger pqueue-delete' }); b.innerHTML='<span class="p-button-icon pi pi-trash"></span>'; return b; })(),
                ])
            ]);
            pendingList.appendChild(li);
        });
        pendingBody.appendChild(pendingList);
        pendingCard.appendChild(pendingBody);

        // History
        const historyCard = el('div', { class: 'p-card pqueue-card' });
        const historyBody = el('div', { class: 'p-card-body' });
        historyBody.appendChild(el('div', { class: 'p-card-title', text: 'History' }));
        const historyList = el('ul', { class: 'pqueue-list' });
        if (!state.history.length) historyList.appendChild(el('li', { class: 'pqueue-empty', text: 'No history' }));
        state.history.forEach(row => {
            const ok = (row.status||'success') === 'success';
            const thumbs = buildResultThumbs(row);
            const time = buildDuration(row);
            const li = el('li', { class: 'pqueue-item' }, [
                el('div', { class: 'pqueue-meta' }, [
                    el('i', { class: `pi ${ok ? 'pi-check pqueue-status-success' : 'pi-times pqueue-status-error'}` }),
                    (time ? el('span', { class: 'task-time', text: time }) : el('span', {}))
                ]),
                el('div', { class: 'pqueue-thumbs-grid' }, thumbs.children.length ? Array.from(thumbs.children) : [])
            ]);
            historyList.appendChild(li);
        });
        historyBody.appendChild(historyList);
        historyCard.appendChild(historyBody);

        sections.appendChild(runningCard);
        sections.appendChild(el('div', { class: 'pqueue-divider' }));
        sections.appendChild(pendingCard);
        sections.appendChild(el('div', { class: 'pqueue-divider' }));
        sections.appendChild(historyCard);

        root.appendChild(toolbar);
        root.appendChild(sections);
        state.container.appendChild(root);

        wireHandlers();
    }

    function wireHandlers() {
        document.getElementById('pqueue-toggle').onclick = async () => {
            if (state.paused) await API.resume(); else await API.pause();
            await refresh();
        };
        document.getElementById('pqueue-refresh').onclick = refresh;
        const clearBtn = document.getElementById('pqueue-clear');
        if (clearBtn) {
            clearBtn.onclick = async () => {
                const ids = Array.from(document.querySelectorAll('#pqueue-pending li[data-id]')).map(li => li.dataset.id);
                if (ids.length) {
                    await API.del(ids);
                    await refresh();
                }
            };
        }

        const list = document.getElementById('pqueue-pending');
        let dragged;
        list.addEventListener('dragstart', (e) => {
            const li = e.target.closest('li');
            dragged = li;
            e.dataTransfer.setData('text/plain', li.dataset.id);
        });
        list.addEventListener('dragover', (e) => e.preventDefault());
        list.addEventListener('drop', async (e) => {
            e.preventDefault();
            const target = e.target.closest('li');
            if (!dragged || !target || dragged === target) return;
            const rect = target.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            if (before) list.insertBefore(dragged, target); else list.insertBefore(dragged, target.nextSibling);
            const order = Array.from(list.querySelectorAll('li')).map(li => li.dataset.id);
            await API.reorder(order);
            await refresh();
        });

        list.querySelectorAll('.pqueue-select').forEach(cb => {
            cb.onchange = (e) => {
                const li = e.target.closest('li');
                const id = li.dataset.id;
                if (e.target.checked) state.selectedPending.add(id); else state.selectedPending.delete(id);
            };
        });

        list.querySelectorAll('.pqueue-priority-save').forEach(btn => {
            btn.onclick = async (e) => {
                const li = e.target.closest('li');
                const id = li.dataset.id;
                const val = parseInt(li.querySelector('.pqueue-priority').value || '0', 10);
                await API.setPriority(id, val);
                await refresh();
            };
        });

        list.querySelectorAll('.pqueue-delete').forEach(btn => {
            btn.onclick = async (e) => {
                const li = e.target.closest('li');
                const id = li.dataset.id;
                await API.del([id]);
                await refresh();
            };
        });
    }

    function buildResultThumbs(row) {
        try {
            const wrap = el('div', { class: 'flex gap-1 flex-wrap' });
            let outputs = row.outputs || {};
            if (typeof outputs === 'string') {
                try { outputs = JSON.parse(outputs); } catch(e) { outputs = {}; }
            }
            const images = [];
            Object.values(outputs).forEach(v => {
                if (v && typeof v === 'object') {
                    const imgs = (v.images) || (v.ui && v.ui.images) || [];
                    if (Array.isArray(imgs)) imgs.forEach(i => images.push(i));
                } else if (Array.isArray(v)) {
                    v.forEach(i => { if (i && (i.filename || i.name)) images.push(i); });
                }
            });
            images.slice(0, 4).forEach(i => {
                const filename = i.filename || i.name || '';
                const type = i.type || 'output';
                const subfolder = i.subfolder || '';
                const url = `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}${subfolder?`&subfolder=${encodeURIComponent(subfolder)}`:''}&preview=webp;50`;
                const img = el('img', { src: url, class: 'pqueue-thumb', title: filename });
                img.onclick = () => openGallery(filename, type, subfolder);
                wrap.appendChild(img);
            });
            return wrap;
        } catch(e) { return el('span', {}); }
    }

    function buildDuration(row) {
        try {
            const dur = Number(row.duration_seconds);
            if (!Number.isNaN(dur) && dur > 0) {
                return `${dur.toFixed(2)}s`;
            }
            const started = row.created_at || row.started_at;
            const completed = row.completed_at;
            if (!started || !completed) return '';
            const t1 = new Date(started).getTime();
            const t2 = new Date(completed).getTime();
            if (!isFinite(t1) || !isFinite(t2)) return '';
            const sec = Math.max(0, (t2 - t1) / 1000);
            return `${sec.toFixed(2)}s`;
        } catch(e) { return ''; }
    }

    function openGallery(filename, type, subfolder) {
        try {
            if (window.app && window.app.extensionManager && window.app.extensionManager.dialog) {
                // Use the built-in image preview route; the core gallery opens via dialogs in the frontend
                const url = `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}${subfolder?`&subfolder=${encodeURIComponent(subfolder)}`:''}`;
                window.open(url, '_blank');
                return;
            }
        } catch(e) {}
        const url = `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}${subfolder?`&subfolder=${encodeURIComponent(subfolder)}`:''}`;
        window.open(url, '_blank');
    }

    async function refresh() {
        const q = await API.getQueue();
        state.paused = !!q.paused;
        state.queue_running = q.queue_running || [];
        state.queue_pending = q.queue_pending || [];
        state.db_pending = q.db_pending || [];
        state.running_progress = q.running_progress || {};
        const h = await API.getHistory(50);
        state.history = h.history || [];
        render();
    }

    // Mount a simple panel into the existing UI sidebar if possible
    function ensureStyles() {
        if (document.getElementById('pqueue-styles')) return;
        const style = document.createElement('style');
        style.id = 'pqueue-styles';
        style.textContent = `
        #pqueue-fab{position:fixed;right:16px;bottom:16px;z-index:99999;background:#2d2f34;color:#fff;border:none;border-radius:20px;padding:8px 12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.35)}
        #pqueue-panel{position:fixed;right:16px;top:64px;z-index:99998;width:420px;max-width:90vw;height:65vh;background:#1c1d20;color:#ddd;border:1px solid #333;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.5);display:none;flex-direction:column}
        #pqueue-panel header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #333}
        #pqueue-panel .pqueue-content{padding:8px 12px;overflow:auto;height:100%}
        #pqueue-panel ul{list-style:none;margin:0;padding:0}
        #pqueue-panel li{display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px dashed #2c2c2c}
        #pqueue-panel .pqueue-item{cursor:grab}
        #pqueue-panel .pqueue-section{margin-bottom:10px}
        `;
        document.head.appendChild(style);
    }

    function mount() {
        if (state.container) return;
        ensureStyles();
        // Floating button
        const fab = document.createElement('button');
        fab.id = 'pqueue-fab';
        fab.textContent = 'Persistent Queue';
        fab.onclick = () => {
            const panel = document.getElementById('pqueue-panel');
            if (!panel) return;
            const visible = panel.style.display !== 'none';
            panel.style.display = visible ? 'none' : 'flex';
            if (!visible) refresh();
        };
        document.body.appendChild(fab);

        const panel = el('div', { id: 'pqueue-panel', class: 'pqueue-panel' });
        const header = document.createElement('header');
        const title = document.createElement('div');
        title.textContent = 'Persistent Queue';
        const close = document.createElement('button');
        close.textContent = '×';
        close.onclick = () => { panel.style.display = 'none'; };
        header.appendChild(title);
        header.appendChild(close);
        panel.appendChild(header);
        state.container = el('div', { class: 'pqueue-content' });
        panel.appendChild(state.container);
        document.body.appendChild(panel);
        refresh();
    }

    // Listen to ComfyUI WS events to auto-refresh
    function setupSocketRefresh() {
        // The frontend sends events to the page via a global event dispatch. As a minimal approach, poll occasionally
        // and also refresh when the page receives focus.
        window.addEventListener('focus', () => refresh());
        setInterval(() => { refresh(); }, 1000);
    }

    // Initialize extension
    function init() {
        try {
            const tryRegisterSidebar = () => {
                if (window.app && window.app.extensionManager && typeof window.app.extensionManager.registerSidebarTab === 'function') {
                    window.app.extensionManager.registerSidebarTab({
                        id: 'persistent_queue',
                        icon: 'pi pi-history',
                        title: 'Persistent Queue',
                        tooltip: 'Persistent Queue',
                        type: 'custom',
                        render: (el) => {
                            state.container = el;
                            render();
                            setupSocketRefresh();
                        }
                    });
                    // Remove floating fallback if present
                    const fab = document.getElementById('pqueue-fab');
                    if (fab && fab.parentElement) fab.parentElement.removeChild(fab);
                    const panel = document.getElementById('pqueue-panel');
                    if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
                    return true;
                }
                return false;
            };

            if (!tryRegisterSidebar()) {
                // Retry registration for a short window while the frontend boots
                let retries = 50;
                const iv = setInterval(() => {
                    if (tryRegisterSidebar() || --retries <= 0) clearInterval(iv);
                }, 200);
                // Fallback: floating panel immediately
                mount();
                setupSocketRefresh();
            }
        } catch(e) { console.warn('pqueue init failed', e); }
    }

    // Prefer native extension lifecycle if available
    if (window.app && typeof window.app.registerExtension === 'function') {
        window.app.registerExtension({
            name: 'ComfyUI-PersistentQueue',
            sidebarTabs: [
                {
                    id: 'persistent_queue',
                    icon: 'pi pi-history',
                    title: 'Persistent Queue',
                    tooltip: 'Persistent Queue',
                    type: 'custom',
                    render: (el) => {
                        state.container = el;
                        render();
                        setupSocketRefresh();
                    }
                }
            ],
            async setup(app) {
                // If for some reason sidebarTabs is not recognized by this frontend build,
                // fall back to runtime registration or floating panel.
                init();
            }
        });
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();


