(function () {
    "use strict";

    const PQ = window.PQueue = window.PQueue || {};
    const state = PQ.state;
    const UI = window.PQueue?.UI || window.UI;
    const API = window.PQueue?.API || window.API;

    window.refresh = async function refresh({ skipIfBusy, force } = {}) {
        if (!force && Date.now() < (state.renderLockUntil || 0)) return;
        if (state.isRefreshing && skipIfBusy) return;
        state.isRefreshing = true;
        UI.updateToolbarStatus();
        try {
            const [queue, paged] = await Promise.all([
                API.getQueue(),
                API.getHistoryPaginated(state.historyPaging?.params || { sort_by: "id", sort_dir: "desc", limit: 60 })
            ]);
            state.paused = !!queue.paused;
            const dedupByPid = (arr) => {
                try {
                    const seen = new Set();
                    const out = [];
                    (arr || []).forEach((it) => {
                        const pid = String(it?.[1] ?? "");
                        if (!pid || seen.has(pid)) return;
                        seen.add(pid);
                        out.push(it);
                    });
                    return out;
                } catch (err) { return arr || []; }
            };
            state.queue_running = dedupByPid(queue.queue_running || []);
            state.queue_pending = queue.queue_pending || [];
            state.db_pending = queue.db_pending || [];
            // Server no longer sends normalized progress; keep existing values until sockets update
            state.running_progress = state.running_progress || {};
            state.samplerCountById = queue.sampler_count_by_id || {};
            // Initialize client-side normalization state for socket updates
            state.progressBaseById = state.progressBaseById || {};
            state.progressLastAggById = state.progressLastAggById || {};
            try {
                Object.entries(state.running_progress).forEach(([pid, norm]) => {
                    const num = Number(state.samplerCountById?.[pid]) || 0;
                    if (num > 0) {
                        const share = 1 / Math.max(1, num);
                        const n = Math.max(0, Math.min(1, Number(norm) || 0));
                        const baseSamplers = Math.floor((n / share) + 1e-6);
                        const base = Math.min(1, baseSamplers * share);
                        const lastAgg = Math.max(0, Math.min(1, (n - base) / share));
                        state.progressBaseById[pid] = base;
                        state.progressLastAggById[pid] = lastAgg;
                    }
                });
            } catch (err) { /* noop */ }
            state.history = (paged && Array.isArray(paged.history)) ? paged.history : [];
            state.historyTotal = (paged && typeof paged.total === 'number') ? paged.total : null;
            state.error = null;

            const index = new Map();
            // Prefer db_by_id when available so running items also have DB info (renamed names)
            if (queue?.db_by_id && typeof queue.db_by_id === 'object') {
                Object.values(queue.db_by_id).forEach((row) => {
                    try { if (row?.prompt_id) index.set(String(row.prompt_id), row); } catch (err) { /* noop */ }
                });
            }
            // Always include db_pending as well
            state.db_pending.forEach((row) => {
                if (row?.prompt_id) index.set(String(row.prompt_id), row);
            });
            state.dbIndex = index;

            state.workflowCache = new Map();
            state.workflowNameCache = new Map();
            [...state.queue_pending, ...state.queue_running].forEach((item) => {
                const pid = String(item[1] ?? "");
                try {
                    const wf = item[2];
                    if (wf !== undefined) {
                        const key = typeof wf === "string" ? wf : JSON.stringify(wf);
                        if (key) state.workflowCache.set(pid, key);
                    }
                    const label = UI.deriveWorkflowLabel(item, index.get(pid));
                    if (label) state.workflowNameCache.set(pid, label);
                } catch (err) { /* noop */ }
            });

            deriveMetrics();

            const visibleIds = new Set(state.queue_pending.map((item) => String(item[1] ?? "")));
            state.selectedPending.forEach((id) => {
                if (!visibleIds.has(id)) state.selectedPending.delete(id);
            });

            state.lastUpdated = new Date().toISOString();
            try {
                state.historyIds = new Set();
                state.history.forEach((row) => {
                    if (row && row.id != null) state.historyIds.add(row.id);
                });
                const last = state.history[state.history.length - 1];
                state.historyPaging = state.historyPaging || { isLoading: false, hasMore: true, nextCursor: null, params: { sort_by: "id", sort_dir: "desc", limit: 60 } };
                state.historyPaging.nextCursor = paged?.next_cursor || (last ? { id: last.id, value: last.id } : null);
                state.historyPaging.hasMore = !!paged?.has_more;
                if (!state.historyPaging.hasMore && state.dom.historySentinel) state.dom.historySentinel.style.display = "none";
            } catch (err) { /* noop */ }
            try { UI.updateAfterRefresh(paged); } catch (err) { /* noop */ }
            try { await Events.syncLatestForAsc(); } catch (err) { /* noop */ }
        } catch (err) {
            console.error("pqueue: refresh failed", err);
            state.error = err?.message || "Failed to load persistent queue";
        } finally {
            state.isRefreshing = false;
            if (!state.dom || !state.dom.root) UI.render();
            UI.updateToolbarStatus();
            try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (err) { /* noop */ }
        }
    };

    window.deriveMetrics = function deriveMetrics() {
        const metrics = {
            runningCount: state.queue_running.length,
            queueCount: state.queue_pending.length,
            persistedCount: state.db_pending.length,
            historyCount: state.history.length,
            successRate: null,
            avgDuration: null,
            estimatedTotalDuration: null,
            estimatedPendingDuration: null,
            estimatedRunningDuration: null,
            failureCount: 0,
            lastFailure: null,
        };

        const durations = [];
        const durationsByWorkflow = new Map();
        let success = 0;
        let failure = 0;
        let total = 0;

        state.history.forEach((row) => {
            const status = String(row.status || "").toLowerCase();
            const duration = Number(row.duration_seconds);
            if (["success", "completed", "done"].includes(status)) success += 1;
            if (["failed", "error", "failure"].includes(status)) {
                failure += 1;
                const ts = row.completed_at || row.created_at;
                if (ts && (!metrics.lastFailure || ts > metrics.lastFailure)) metrics.lastFailure = ts;
            }
            if (["success", "completed", "done", "failed", "error", "failure", "cancelled", "canceled", "interrupted"].includes(status)) total += 1;
            if (Number.isFinite(duration) && duration > 0) durations.push(duration);

            const wf = row.workflow;
            if (!wf) return;
            let key = "";
            if (typeof wf === "string") key = wf;
            else {
                try {
                    key = JSON.stringify(wf);
                } catch (err) {
                    key = "";
                }
            }
            if (!key) return;
            const list = durationsByWorkflow.get(key) || [];
            if (Number.isFinite(duration) && duration > 0) list.push(duration);
            durationsByWorkflow.set(key, list);
        });

        metrics.successRate = total ? success / total : null;
        metrics.failureCount = failure;
        metrics.avgDuration = durations.length ? durations.reduce((acc, v) => acc + v, 0) / durations.length : null;
        state.metrics = metrics;

        const averages = new Map();
        durationsByWorkflow.forEach((vals, key) => {
            if (!vals.length) return;
            const avg = vals.reduce((acc, v) => acc + v, 0) / vals.length;
            averages.set(key, avg);
        });
        state.durationByWorkflow = averages;

        try {
            const fallback = metrics.avgDuration || 0;
            const getEstimateForItem = (item) => {
                if (!Array.isArray(item)) return 0;
                const pid = String(item[1] ?? "");
                let key = state.workflowCache.get(pid);
                if (!key) {
                    const wf = item[2];
                    if (wf !== undefined) {
                        try {
                            key = typeof wf === "string" ? wf : JSON.stringify(wf);
                            if (key) state.workflowCache.set(pid, key);
                        } catch (err) {
                            key = null;
                        }
                    }
                }
                const perWf = (key && averages.has(key)) ? averages.get(key) : fallback;
                return (Number.isFinite(perWf) && perWf > 0) ? perWf : 0;
            };

            let pendingEstimate = 0;
            for (const item of state.queue_pending) pendingEstimate += getEstimateForItem(item);

            let runningEstimate = 0;
            for (const item of state.queue_running) {
                const perItem = getEstimateForItem(item);
                const pid = String(item[1] ?? "");
                const progress = Math.max(0, Math.min(1, Number(state.running_progress?.[pid]) || 0));
                const remaining = perItem * (1 - progress);
                if (Number.isFinite(remaining) && remaining > 0) runningEstimate += remaining;
            }

            const total = pendingEstimate + runningEstimate;
            metrics.estimatedPendingDuration = pendingEstimate > 0 ? pendingEstimate : null;
            metrics.estimatedRunningDuration = runningEstimate > 0 ? runningEstimate : null;
            metrics.estimatedTotalDuration = total > 0 ? total : null;
            state.metrics = metrics;
        } catch (err) {
            state.metrics = metrics;
        }
    };

    window.lookupWorkflow = function lookupWorkflow(promptId) {
        if (!promptId) return null;
        const queue = state.queue_pending.find((item) => String(item[1]) === String(promptId));
        if (queue) return { workflow: queue[2], source: "Queue" };
        const db = state.dbIndex.get(promptId);
        if (db?.workflow) {
            try {
                return { workflow: JSON.parse(db.workflow), source: "Persistence" };
            } catch (err) {
                return { workflow: db.workflow, source: "Persistence" };
            }
        }
        const history = state.history.find((row) => String(row.prompt_id) === String(promptId));
        if (history?.workflow) {
            try {
                return { workflow: JSON.parse(history.workflow), source: "History" };
            } catch (err) {
                return { workflow: history.workflow, source: "History" };
            }
        }
        return null;
    };

    function getBestActiveName() {
        try {
            const fromUI = (UI && typeof UI.getActiveWorkflowName === 'function') ? UI.getActiveWorkflowName() : null;
            const cached = window.PQueue?.vars?.lastActiveWorkflowName || null;
            const name = fromUI || cached || null;
            return (typeof name === 'string' && name.trim()) ? name.trim() : null;
        } catch (err) { return null; }
    }

    // Do NOT mutate prompt JSON; attach into extra_data to avoid breaking execution
    function ensureExtraDataHasName(container) {
        try {
            if (!container || typeof container !== 'object') return false;
            const name = getBestActiveName();
            if (!name) return false;
            const ed = (container.extra_data && typeof container.extra_data === 'object') ? container.extra_data : (container.extra_data = {});
            if (typeof ed.pqueue_workflow_name === 'string' && ed.pqueue_workflow_name.trim()) return false;
            ed.pqueue_workflow_name = name;
            return true;
        } catch (err) { return false; }
    }

    function annotateBodyWithName(bodyObj) {
        try {
            if (!bodyObj || typeof bodyObj !== 'object') return false;
            // Attach via extra_data in the envelope; do not edit prompt
            return ensureExtraDataHasName(bodyObj);
        } catch (err) { return false; }
    }

    function sanitizePromptForExecution(bodyObj) {
        try {
            const prompt = bodyObj && bodyObj.prompt;
            if (!prompt || typeof prompt !== 'object') return false;
            let changed = false;
            // Remove accidental metadata keys that are not valid nodes
            if (Object.prototype.hasOwnProperty.call(prompt, 'name') && typeof prompt.name === 'string') {
                delete prompt.name; changed = true;
            }
            if (Object.prototype.hasOwnProperty.call(prompt, 'workflow') && typeof prompt.workflow === 'object' && !prompt.workflow.class_type) {
                delete prompt.workflow; changed = true;
            }
            return changed;
        } catch (err) { return false; }
    }

    function countSamplersFromWorkflow(workflow) {
        try {
            let wf = workflow;
            if (!wf) return 0;
            if (typeof wf === 'string') {
                try { wf = JSON.parse(wf); } catch (err) { return 0; }
            }
            let nodes = [];
            if (wf && typeof wf === 'object') {
                if (Array.isArray(wf.nodes)) {
                    nodes = wf.nodes.filter((n) => n && typeof n === 'object');
                } else {
                    try { Object.values(wf).forEach((v) => { if (v && typeof v === 'object' && (v.class_type || v.class)) nodes.push(v); }); } catch (err) {}
                }
            }
            let count = 0;
            nodes.forEach((n) => {
                try { const ct = String(n.class_type || n.class || '').toLowerCase(); if (ct.includes('sampler')) count += 1; } catch (err) {}
            });
            return count;
        } catch (err) { return 0; }
    }

    function installPromptNameInjector() {
        try {
            PQ.nameInjector = PQ.nameInjector || { apiWrapped: false, fetchWrapped: false, intervalId: null, namePollId: null };

            // Keep a cached last-known active workflow name to mitigate timing issues
            window.PQueue = window.PQueue || {};
            window.PQueue.vars = window.PQueue.vars || {};
            if (!PQ.nameInjector.namePollId) {
                PQ.nameInjector.namePollId = window.setInterval(() => {
                    try {
                        const n = (UI && typeof UI.getActiveWorkflowName === 'function') ? UI.getActiveWorkflowName() : null;
                        if (n && typeof n === 'string' && n.trim()) {
                            window.PQueue.vars.lastActiveWorkflowName = n.trim();
                        }
                    } catch (err) {}
                }, 500);
            }

            const tryWrapApi = () => {
                try {
                    const apis = [window.app?.api, window.app, window.api, window].filter(Boolean);
                    if (!apis.length) return false;
                    const candidates = ['queuePrompt', 'enqueuePrompt', 'prompt', 'queue', 'queue_prompt'];
                    let wrappedAny = false;
                    apis.forEach((api) => {
                        candidates.forEach((fn) => {
                            const orig = api[fn];
                            if (typeof orig === 'function' && !orig.__pqueue_wrapped__) {
                                api[fn] = async function(...args) {
                                    try {
                                        if (args && args.length) {
                                            // Heuristic: merge into extra_data arg if present, else into a body-like envelope
                                            // Case: queuePrompt(prompt, client_id, extraData?)
                                            if (typeof args[1] === 'string') {
                                                if (typeof args[2] === 'object') { ensureExtraDataHasName(args[2]); }
                                                else { args[2] = {}; ensureExtraDataHasName(args[2]); }
                                            } else {
                                                // Case: single envelope arg or different signature
                                                for (let i = 0; i < args.length; i++) {
                                                    const a = args[i];
                                                    if (a && typeof a === 'object') { ensureExtraDataHasName(a); break; }
                                                }
                                            }
                                        }
                                    } catch (err) {}
                                    return orig.apply(this, args);
                                };
                                try { api[fn].__pqueue_wrapped__ = true; } catch (err) {}
                                wrappedAny = true;
                            }
                        });
                    });
                    if (wrappedAny) { PQ.nameInjector.apiWrapped = true; }
                    return wrappedAny;
                } catch (err) { return false; }
            };

            if (!PQ.nameInjector.fetchWrapped) {
                const origFetch = window.fetch;
                if (typeof origFetch === 'function') {
                    window.fetch = function(input, init) {
                        try {
                            const isRequestObj = (typeof input === 'object' && input && typeof input.url === 'string');
                            const url = isRequestObj ? input.url : (typeof input === 'string' ? input : '');
                            const method = String((init && init.method) || (isRequestObj && input.method) || 'GET').toUpperCase();
                            if (method === 'POST' && /\/prompt(?:\b|\?|$)/.test(url)) {
                                // Case A: init with JSON body string
                                if (init && typeof init.body === 'string') {
                                    try {
                                        const body = JSON.parse(init.body);
                                        if (annotateBodyWithName(body)) {
                                            const headers = (init.headers instanceof Headers) ? init.headers : new Headers(init.headers || {});
                                            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
                                            sanitizePromptForExecution(body);
                                            const newInit = Object.assign({}, init, { body: JSON.stringify(body), headers });
                                            return origFetch.call(this, url, newInit);
                                        }
                                        // Even if no annotation, still sanitize
                                        if (sanitizePromptForExecution(body)) {
                                            const headers = (init.headers instanceof Headers) ? init.headers : new Headers(init.headers || {});
                                            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
                                            const newInit = Object.assign({}, init, { body: JSON.stringify(body), headers });
                                            return origFetch.call(this, url, newInit);
                                        }
                                    } catch (err) {}
                                }
                                // Case B: Request object input
                                if (isRequestObj && !init) {
                                    try {
                                        const req = input;
                                        const cloned = req.clone();
                                        return cloned.text().then((txt) => {
                                            try {
                                                const body = JSON.parse(txt);
                                                const annotated = annotateBodyWithName(body);
                                                const sanitized = sanitizePromptForExecution(body);
                                                if (annotated || sanitized) {
                                                    const headers = new Headers(req.headers || {});
                                                    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
                                                    const newReq = new Request(req.url, {
                                                        method: req.method || 'POST',
                                                        headers,
                                                        body: JSON.stringify(body),
                                                        mode: req.mode,
                                                        credentials: req.credentials,
                                                        cache: req.cache,
                                                        redirect: req.redirect,
                                                        referrer: req.referrer,
                                                        referrerPolicy: req.referrerPolicy,
                                                        integrity: req.integrity,
                                                        keepalive: req.keepalive,
                                                        signal: req.signal,
                                                    });
                                                    return origFetch.call(this, newReq);
                                                }
                                            } catch (err) {}
                                            return origFetch.call(this, input);
                                        });
                                    } catch (err) {}
                                }
                            }
                        } catch (err) {}
                        return origFetch.apply(this, arguments);
                    };
                    PQ.nameInjector.fetchWrapped = true;
                }
            }

            if (!PQ.nameInjector.apiWrapped) {
                const ok = tryWrapApi();
                if (!ok && !PQ.nameInjector.intervalId) {
                    let ticks = 0;
                    let delay = 50;
                    const step = () => {
                        try {
                            if (tryWrapApi() || ++ticks > 120) {
                                if (PQ.nameInjector.intervalId) window.clearTimeout(PQ.nameInjector.intervalId);
                                PQ.nameInjector.intervalId = null;
                                return;
                            }
                            delay = Math.min(500, Math.floor(delay * 1.5));
                            PQ.nameInjector.intervalId = window.setTimeout(step, delay);
                        } catch (err) {}
                    };
                    PQ.nameInjector.intervalId = window.setTimeout(step, delay);
                }
            }
        } catch (err) {}
    }

    function setupSockets() {
        try {
            const api = window.app?.api;
            if (!api || typeof api.addEventListener !== "function") {
                console.warn("pqueue: WebSocket API not available, falling back to polling");
                return false;
            }

            const onProgress = (event) => {
                try {
                    const payload = event?.detail;
                    if (!payload?.prompt_id || !payload.nodes) return;
                    const pid = String(payload.prompt_id);
                    const num = Number(state.samplerCountById?.[pid]) || 0;
                    const agg = Progress.computeAggregate(payload.nodes); // 0..1 for current node set
                    if (num > 0) {
                        const share = 1 / Math.max(1, num);
                        let base = Number(state.progressBaseById?.[pid]);
                        let last = Number(state.progressLastAggById?.[pid]);
                        if (!Number.isFinite(base)) base = 0;
                        if (!Number.isFinite(last)) last = 0;
                        // Detect wrap-around between samplers
                        if (last >= 0.9 && agg <= 0.1) {
                            base = Math.min(1, base + share);
                        }
                        // Guard: never allow a sudden jump to full share at t=0
                        const rawClamped = Math.max(0, Math.min(1, agg));
                        let normalized = Math.min(1, Math.max(0, base + (rawClamped * share)));
                        const prevNorm = Number(state.running_progress?.[pid]) || 0;
                        if (normalized < prevNorm) normalized = prevNorm; // enforce monotonic UI
                        state.progressBaseById[pid] = base;
                        state.progressLastAggById[pid] = agg;
                        state.running_progress[pid] = normalized;
                        UI.updateProgressBars();
                        return;
                    }
                    // Fallback: aggregate raw nodes when sampler count unknown or zero
                    {
                        const prevNorm = Number(state.running_progress?.[pid]) || 0;
                        state.running_progress[pid] = Math.max(prevNorm, agg);
                    }
                    UI.updateProgressBars();
                } catch (err) { /* noop */ }
            };

            const onLifecycle = () => refresh({ skipIfBusy: true });
            const onExecuting = (event) => {
                try {
                    const pid = String(event?.detail?.prompt_id || event?.detail?.data?.prompt_id || '');
                    if (!pid) return;
                    if (state.progressBaseById) delete state.progressBaseById[pid];
                    if (state.progressLastAggById) delete state.progressLastAggById[pid];
                    if (state.running_progress) delete state.running_progress[pid];
                } catch (err) { /* noop */ }
            };

            api.addEventListener("progress_state", onProgress);
            api.addEventListener("executing", onExecuting);
            api.addEventListener("status", onLifecycle);
            api.addEventListener("execution_start", onLifecycle);
            api.addEventListener("executed", onLifecycle);
            api.addEventListener("execution_success", onLifecycle);
            api.addEventListener("execution_error", onLifecycle);
            api.addEventListener("execution_interrupted", onLifecycle);

            stopPolling();
            return true;
        } catch (err) {
            console.error("pqueue: socket setup failed", err);
            return false;
        }
    }

    function stopPolling() {
        try {
            if (window.PQueue?.vars?.pollIntervalId) {
                clearInterval(window.PQueue.vars.pollIntervalId);
                window.PQueue.vars.pollIntervalId = null;
            }
            if (window.PQueue?.vars?.focusListener) {
                window.removeEventListener("focus", window.PQueue.vars.focusListener);
                window.PQueue.vars.focusListener = null;
            }
        } catch (err) { /* ignore */ }
    }

    function startPolling() {
        stopPolling();
        window.PQueue.vars.focusListener = () => refresh({ skipIfBusy: true });
        window.addEventListener("focus", window.PQueue.vars.focusListener);
        window.PQueue.vars.pollIntervalId = window.setInterval(() => refresh({ skipIfBusy: true }), 3000);
    }

    window.initializePQueue = function initialize() {
        const finalize = (el) => {
            state.container = el;
            UI.render();
            try { installPromptNameInjector(); } catch (err) {}
            if (!setupSockets()) {
                startPolling();
                let retries = 50;
                const retryId = window.setInterval(() => {
                    if (setupSockets() || --retries <= 0) window.clearInterval(retryId);
                }, 200);
            }
            refresh();
        };

        const tab = {
            id: "persistent_queue",
            icon: "ti ti-archive",
            title: "Persistent Queue",
            tooltip: "Persistent Queue",
            type: "custom",
            render: (el) => {
                UI.removeFallback();
                finalize(el);
            },
        };

        const registerSidebar = () => {
            try {
                if (window.app?.extensionManager?.registerSidebarTab) {
                    window.app.extensionManager.registerSidebarTab(tab);
                    PQ.registered = true;
                    return true;
                }
            } catch (err) {
                console.error("pqueue: sidebar registration failed", err);
            }
            return false;
        };

        const init = () => {
            if (PQ.booted) return;
            PQ.booted = true;
            UI.ensureAssets();
            try { installPromptNameInjector(); } catch (err) {}
            // Fast retry until the sidebar is ready, then stop entirely
            if (registerSidebar()) return;

            // Observe DOM for sidebar container to appear (less janky than polling alone)
            let mo = null;
            const observeForSidebar = () => {
                try {
                    if (mo) return;
                    mo = new MutationObserver(() => {
                        try {
                            if (document.querySelector('.sidebar-content-container') || window.app?.extensionManager?.registerSidebarTab) {
                                if (registerSidebar()) cleanupWaiters();
                            }
                        } catch (err) { /* noop */ }
                    });
                    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
                } catch (err) { /* noop */ }
            };

            // Very short interval retry; removed immediately on success or fallback
            const startFastRetry = () => {
                let ticks = 0;
                const maxTicks = 200; // ~6s at 30ms
                const iid = window.setInterval(() => {
                    try {
                        if (registerSidebar()) { cleanupWaiters(); return; }
                        if (++ticks >= maxTicks) { window.clearInterval(iid); }
                    } catch (err) { /* noop */ }
                }, 10);
                waiters.intervalId = iid;
            };

            const cleanupWaiters = () => {
                try { if (waiters.intervalId) { window.clearInterval(waiters.intervalId); waiters.intervalId = null; } } catch (err) {}
                try { if (waiters.fallbackTimeoutId) { window.clearTimeout(waiters.fallbackTimeoutId); waiters.fallbackTimeoutId = null; } } catch (err) {}
                try { if (mo) { mo.disconnect(); mo = null; } } catch (err) {}
                // If we registered after fallback was mounted, ensure fallback is removed
                if (PQ.usedFallback) { try { UI.removeFallback(); } catch (err) {} }
            };

            const waiters = { intervalId: null, fallbackTimeoutId: null };
            observeForSidebar();
            startFastRetry();

            // Graceful fallback after a brief wait to avoid flicker
            waiters.fallbackTimeoutId = window.setTimeout(() => {
                if (PQ.registered) { cleanupWaiters(); return; }
                PQ.usedFallback = true;
                UI.mountFallback();
                finalize(state.container);
            }, 2000);
        };

        const extension = {
            name: "ComfyUI-Persistent-Queue",
            setup: () => init(),
        };

        if (window.app?.registerExtension) {
            window.app.registerExtension(extension);
            // Safety fallback: trigger retry path immediately (no initial delay)
            window.setTimeout(() => { try { if (!window.PQueue?.booted) init(); } catch (err) {} }, 0);
        } else if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    };
})();


