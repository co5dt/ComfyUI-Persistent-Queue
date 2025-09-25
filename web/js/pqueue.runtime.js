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
            state.queue_running = queue.queue_running || [];
            state.queue_pending = queue.queue_pending || [];
            state.db_pending = queue.db_pending || [];
            state.running_progress = queue.running_progress || {};
            state.history = (paged && Array.isArray(paged.history)) ? paged.history : [];
            state.historyTotal = (paged && typeof paged.total === 'number') ? paged.total : null;
            state.error = null;

            const index = new Map();
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
                    state.running_progress[payload.prompt_id] = Progress.computeAggregate(payload.nodes);
                    UI.updateProgressBars();
                } catch (err) { /* noop */ }
            };

            const onLifecycle = () => refresh({ skipIfBusy: true });

            api.addEventListener("progress_state", onProgress);
            api.addEventListener("executing", onProgress);
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
            name: "ComfyUI-PersistentQueue",
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


