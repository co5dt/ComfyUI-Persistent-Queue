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

    const Progress = {
        computeAggregateProgress(nodes) {
            let totalMax = 0;
            let totalVal = 0;
            Object.values(nodes ?? {}).forEach((st) => {
                const mv = Math.max(1, Number(st?.max ?? 1));
                const vv = Math.max(0, Math.min(Number(st?.value ?? 0), mv));
                totalMax += mv;
                totalVal += vv;
            });
            return totalMax > 0 ? Math.max(0, Math.min(1, totalVal / totalMax)) : 0;
        },
    };

    const UI = {
        el(tag, attrs = {}, children = []) {
            const e = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'class') {
                    e.className = v;
                } else if (k === 'text') {
                    e.textContent = v;
                } else {
                    e.setAttribute(k, v);
                }
            }
            for (const c of children) {
                e.appendChild(c);
            }
            return e;
        },

        createButton({ id, text, icon, classes, onClick }) {
            const button = UI.el('button', { id, class: `p-button p-component ${classes}` });
            if (icon) {
                button.appendChild(UI.el('span', { class: `p-button-icon pi ${icon}` }));
            }
            if (text) {
                button.appendChild(UI.el('span', { class: 'p-button-label', text }));
            }
            if (onClick) {
                button.onclick = onClick;
            }
            return button;
        },

        createCard(title, content) {
            return UI.el('div', { class: 'p-card pqueue-card' }, [
                UI.el('div', { class: 'p-card-body' }, [
                    UI.el('div', { class: 'p-card-title', text: title }),
                    content,
                ]),
            ]);
        },

        updateProgressBarsFromState() {
            if (!state.container) return;
            Object.entries(state.running_progress).forEach(([pid, f]) => {
                const bar = state.container.querySelector(`.pqueue-item[data-id="${pid}"] .pqueue-progress-bar`);
                if (bar) bar.style.width = `${(Number(f) * 100).toFixed(2)}%`;
            });
        },

        ensureThemeLink() {
            if (!document.getElementById('pqueue-style-link')) {
                const link = document.createElement('link');
                link.id = 'pqueue-style-link';
                link.rel = 'stylesheet';
                link.href = '/extensions/ComfyUI-PersistentQueue/css/queue_style.css';
                document.head.appendChild(link);
            }
        },

        renderToolbar() {
            const pauseBtn = UI.createButton({
                id: 'pqueue-toggle',
                text: state.paused ? 'Resume' : 'Pause',
                icon: state.paused ? 'pi-play' : 'pi-pause',
                classes: state.paused ? 'p-button-success' : 'p-button-warning',
            });
            const refreshBtn = UI.createButton({
                id: 'pqueue-refresh',
                text: 'Refresh',
                icon: 'pi-refresh',
                classes: 'p-button-text',
            });
            const clearBtn = UI.createButton({
                id: 'pqueue-clear',
                text: 'Clear Pending',
                icon: 'pi-stop',
                classes: 'p-button-text p-button-danger',
            });

            return UI.el('div', { class: 'pqueue-toolbar' }, [pauseBtn, refreshBtn, clearBtn]);
        },

        renderRunningSection() {
            const runningList = UI.el('ul', { class: 'pqueue-list' });
            if (!state.queue_running.length) {
                runningList.appendChild(UI.el('li', { class: 'pqueue-empty', text: 'No running job' }));
            } else {
                state.queue_running.forEach(item => {
                    const pid = item[1];
                    const frac = Math.max(0, Math.min(1, Number(state.running_progress?.[pid]) || 0));
                    const progressBar = UI.el('div', { class: 'pqueue-progress-bar' });
                    progressBar.style.width = `${(frac * 100).toFixed(2)}%`;

                    const li = UI.el('li', { class: 'pqueue-item', 'data-id': pid }, [
                        UI.el('div', { class: 'pqueue-left' }, [
                            UI.el('div', { class: 'pqueue-meta' }, [
                                UI.el('i', { class: 'pi pi-spin pi-spinner' }),
                                UI.el('span', { text: pid })
                            ]),
                            UI.el('div', { class: 'pqueue-progress-wrap' }, [progressBar]),
                        ]),
                        UI.el('div', { class: 'pqueue-actions' }, [])
                    ]);
                    runningList.appendChild(li);
                });
            }
            return UI.createCard('Running', runningList);
        },

        renderPendingSection() {
            const pendingList = UI.el('ul', { id: 'pqueue-pending', class: 'pqueue-list' });
            if (!state.queue_pending.length) {
                pendingList.appendChild(UI.el('li', { class: 'pqueue-empty', text: 'No pending items' }));
            } else {
                state.queue_pending.forEach(item => {
                    const checked = state.selectedPending.has(item[1]);
                    const checkbox = UI.el('input', { type: 'checkbox', class: 'p-checkbox-input pqueue-select' });
                    if (checked) checkbox.checked = true;

                    const priorityInput = UI.el('input', { type: 'number', value: '0', class: 'p-inputtext pqueue-priority', min: '0', style: 'width:5rem' });
                    const savePriorityBtn = UI.createButton({
                        icon: 'pi-sort-amount-up-alt',
                        classes: 'p-button-text pqueue-priority-save',
                    });
                    const deleteBtn = UI.createButton({
                        icon: 'pi-trash',
                        classes: 'p-button-text p-button-danger pqueue-delete',
                    });

                    const li = UI.el('li', { draggable: 'true', 'data-id': item[1], class: 'pqueue-item' }, [
                        UI.el('div', { class: 'pqueue-meta' }, [
                            UI.el('i', { class: 'pi pi-bars', style: 'cursor:grab' }),
                            checkbox,
                            UI.el('span', { text: item[1] })
                        ]),
                        UI.el('div', { class: 'pqueue-actions' }, [
                            priorityInput,
                            savePriorityBtn,
                            deleteBtn,
                        ])
                    ]);
                    pendingList.appendChild(li);
                });
            }
            return UI.createCard(`Pending (${state.queue_pending.length})`, pendingList);
        },

        renderHistorySection() {
            const historyList = UI.el('ul', { class: 'pqueue-list' });
            if (!state.history.length) {
                historyList.appendChild(UI.el('li', { class: 'pqueue-empty', text: 'No history' }));
            } else {
                state.history.forEach(row => {
                    const ok = (row.status ?? 'success') === 'success';
                    const thumbs = UI.buildResultThumbs(row);
                    const time = UI.buildDuration(row);
                    const li = UI.el('li', { class: 'pqueue-item' }, [
                        UI.el('div', { class: 'pqueue-meta' }, [
                            UI.el('i', { class: `pi ${ok ? 'pi-check pqueue-status-success' : 'pi-times pqueue-status-error'}` }),
                            (time ? UI.el('span', { class: 'task-time', text: time }) : UI.el('span', {}))
                        ]),
                        UI.el('div', { class: 'pqueue-thumbs-grid' }, thumbs.children.length ? Array.from(thumbs.children) : [])
                    ]);
                    historyList.appendChild(li);
                });
            }
            return UI.createCard('History', historyList);
        },

        render() {
            if (!state.container) return;
            UI.ensureThemeLink();
            state.container.innerHTML = '';

            const root = UI.el('div', { class: 'pqueue-root' });
            const toolbar = UI.renderToolbar();
            const sections = UI.el('div', { class: 'pqueue-sections' });

            sections.appendChild(UI.renderRunningSection());
            sections.appendChild(UI.el('div', { class: 'pqueue-divider' }));
            sections.appendChild(UI.renderPendingSection());
            sections.appendChild(UI.el('div', { class: 'pqueue-divider' }));
            sections.appendChild(UI.renderHistorySection());

            root.appendChild(toolbar);
            root.appendChild(sections);
            state.container.appendChild(root);

            Events.init();
            UI.updateProgressBarsFromState();
        },

        buildResultThumbs(row) {
            try {
                const wrap = UI.el('div', { class: 'flex gap-1 flex-wrap' });
                let outputs = row.outputs ?? {};
                if (typeof outputs === 'string') {
                    try { outputs = JSON.parse(outputs); } catch(e) { outputs = {}; }
                }
                const images = [];
                Object.values(outputs).forEach(v => {
                    if (v && typeof v === 'object') {
                        const imgs = v.images ?? v.ui?.images ?? [];
                        if (Array.isArray(imgs)) imgs.forEach(i => images.push(i));
                    } else if (Array.isArray(v)) {
                        v.forEach(i => { if (i?.filename || i?.name) images.push(i); });
                    }
                });
                images.slice(0, 4).forEach(i => {
                    const filename = i.filename ?? i.name ?? '';
                    const type = i.type ?? 'output';
                    const subfolder = i.subfolder ?? '';
                    const url = new URL('/view', window.location.origin);
                    url.searchParams.set('filename', filename);
                    url.searchParams.set('type', type);
                    if (subfolder) url.searchParams.set('subfolder', subfolder);
                    url.searchParams.set('preview', 'webp;50');
                    const img = UI.el('img', { src: url.href, class: 'pqueue-thumb', title: filename });
                    img.onclick = () => UI.openGallery(filename, type, subfolder);
                    wrap.appendChild(img);
                });
                return wrap;
            } catch(e) { return UI.el('span', {}); }
        },

        buildDuration(row) {
            try {
                const dur = Number(row.duration_seconds);
                if (!Number.isNaN(dur) && dur > 0) {
                    return `${dur.toFixed(2)}s`;
                }
                const started = row.created_at ?? row.started_at;
                const completed = row.completed_at;
                if (!started || !completed) return '';
                const t1 = new Date(started).getTime();
                const t2 = new Date(completed).getTime();
                if (!isFinite(t1) || !isFinite(t2)) return '';
                const sec = Math.max(0, (t2 - t1) / 1000);
                return `${sec.toFixed(2)}s`;
            } catch(e) { return ''; }
        },

        openGallery(filename, type, subfolder) {
            const url = new URL('/view', window.location.origin);
            url.searchParams.set('filename', filename);
            url.searchParams.set('type', type);
            if (subfolder) url.searchParams.set('subfolder', subfolder);
            window.open(url.href, '_blank');
        },

        ensureStyles() {
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
        },

        mount() {
            if (state.container) return;
            UI.ensureStyles();
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

            const panel = UI.el('div', { id: 'pqueue-panel', class: 'pqueue-panel' });
            const header = document.createElement('header');
            const title = document.createElement('div');
            title.textContent = 'Persistent Queue';
            const close = document.createElement('button');
            close.textContent = '×';
            close.onclick = () => { panel.style.display = 'none'; };
            header.appendChild(title);
            header.appendChild(close);
            panel.appendChild(header);
            state.container = UI.el('div', { class: 'pqueue-content' });
            panel.appendChild(state.container);
            document.body.appendChild(panel);
            refresh();
        }
    };

    const Events = {
        async onPauseClick() {
            if (state.paused) await API.resume(); else await API.pause();
            await refresh();
        },

        async onClearClick() {
            const ids = Array.from(document.querySelectorAll('#pqueue-pending li[data-id]')).map(li => li.dataset.id);
            if (ids.length) {
                await API.del(ids);
                await refresh();
            }
        },

        onPendingListItemCheckboxChange(e) {
            const li = e.target.closest('li');
            const id = li.dataset.id;
            if (e.target.checked) state.selectedPending.add(id); else state.selectedPending.delete(id);
        },

        async onPendingListItemPrioritySaveClick(e) {
            const li = e.target.closest('li');
            const id = li.dataset.id;
            const val = parseInt(li.querySelector('.pqueue-priority').value || '0', 10);
            await API.setPriority(id, val);
            await refresh();
        },

        async onPendingListItemDeleteClick(e) {
            const li = e.target.closest('li');
            const id = li.dataset.id;
            await API.del([id]);
            await refresh();
        },

        init() {
            document.getElementById('pqueue-toggle').onclick = Events.onPauseClick;
            document.getElementById('pqueue-refresh').onclick = refresh;
            const clearBtn = document.getElementById('pqueue-clear');
            if (clearBtn) {
                clearBtn.onclick = Events.onClearClick;
            }

            const list = document.getElementById('pqueue-pending');
            if (!list) return;

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

            list.addEventListener('change', (e) => {
                if (e.target.classList.contains('pqueue-select')) {
                    Events.onPendingListItemCheckboxChange(e);
                }
            });

            list.addEventListener('click', (e) => {
                if (e.target.closest('.pqueue-priority-save')) {
                    Events.onPendingListItemPrioritySaveClick(e);
                } else if (e.target.closest('.pqueue-delete')) {
                    Events.onPendingListItemDeleteClick(e);
                }
            });
        }
    };

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
        const hooked = tryHookWebsocket();
        if (!hooked) {
            window.addEventListener('focus', () => refresh());
            setInterval(() => { refresh(); }, 3000);
        }
    }

    function tryHookWebsocket() {
        try {
            const api = (window.app && window.app.api && typeof window.app.api.addEventListener === 'function') ? window.app.api : null;
            if (!api) return false;

            const onProgressState = (ev) => {
                try {
                    const payload = ev && ev.detail ? ev.detail : ev;
                    if (!payload || !payload.prompt_id || !payload.nodes) return;
                    state.running_progress[payload.prompt_id] = computeAggregateProgress(payload.nodes);
                    updateProgressBarsFromState();
                } catch(e) { /* ignore */ }
            };

            const onQueueOrExecChange = () => { refresh(); };

            api.addEventListener('progress_state', onProgressState);
            // Legacy progress event (non-aggregated); ignore or do minimal update if needed
            api.addEventListener('progress', (ev) => { /* no-op; prefer progress_state */ });
            // Queue/lifecycle updates
            api.addEventListener('status', onQueueOrExecChange);
            api.addEventListener('executing', onQueueOrExecChange);
            api.addEventListener('executed', onQueueOrExecChange);
            api.addEventListener('execution_start', onQueueOrExecChange);
            api.addEventListener('execution_success', onQueueOrExecChange);
            api.addEventListener('execution_error', onQueueOrExecChange);
            api.addEventListener('execution_interrupted', onQueueOrExecChange);
            return true;
        } catch(e) { return false; }
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


