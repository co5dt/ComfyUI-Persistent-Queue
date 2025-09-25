(function () {
    "use strict";

    // UI module extracted from original pqueue.js without logic changes
    const state = (window.PQueue && window.PQueue.state) || {};
    const API = (window.PQueue && window.PQueue.API) || window.API;
    const Icons = (window.PQueue && window.PQueue.Icons) || window.Icons;
    const Format = (window.PQueue && window.PQueue.Format) || window.Format;
    const Events = (window.PQueue && window.PQueue.Events) || window.Events;
    const setStatusMessage = (window.PQueue && window.PQueue.setStatusMessage) || window.setStatusMessage;
    const copyText = (window.PQueue && window.PQueue.copyText) || window.copyText;
    const UI = {
        el(tag, attrs = {}, children = []) {
            const el = document.createElement(tag);
            Object.entries(attrs || {}).forEach(([key, value]) => {
                if (value === null || value === undefined) return;
                if (key === "class") {
                    el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
                } else if (key === "text") {
                    el.textContent = value;
                } else {
                    el.setAttribute(key, value);
                }
            });
            (Array.isArray(children) ? children : [children]).forEach((child) => {
                if (child instanceof Node) el.appendChild(child);
                else if (child !== null && child !== undefined) el.appendChild(document.createTextNode(String(child)));
            });
            return el;
        },

        icon(name, { spin = false, size } = {}) {
            const classes = ["pqueue-icon"];
            if (spin) classes.push("pqueue-icon--spin");
            if (size) classes.push(`pqueue-icon--${size}`);
            const el = UI.el("span", { class: classes });
            const svg = Icons.resolve(name);
            if (svg) el.appendChild(svg);
            else if (name) el.classList.add(...String(name).split(/\s+/));
            return el;
        },

        button({ id, text, icon, variant, subtle, size, badge, title, disabled, onClick, ariaLabel }) {
            const classes = ["pqueue-button"];
            if (variant) classes.push(`pqueue-button--${variant}`);
            if (subtle) classes.push("pqueue-button--subtle");
            if (size) classes.push(`pqueue-button--${size}`);
            const attrs = { class: classes, type: "button" };
            if (id) attrs.id = id;
            if (title) attrs.title = title;
            if (ariaLabel) attrs["aria-label"] = ariaLabel;
            const btn = UI.el("button", attrs);
            if (disabled) btn.disabled = true;
            if (icon) btn.appendChild(UI.icon(icon));
            if (text) btn.appendChild(UI.el("span", { class: "pqueue-button__label", text }));
            if (badge != null) {
                btn.appendChild(UI.el("span", { class: "pqueue-button__badge", text: String(badge) }));
            }
            if (typeof onClick === "function") btn.addEventListener("click", onClick);
            return btn;
        },

        statusBadge(status, { subtle } = {}) {
            const normalized = String(status || "").toLowerCase();
            const meta = {
                success: { icon: "ti ti-circle-check", label: "Success", variant: "success" },
                completed: { icon: "ti ti-circle-check", label: "Completed", variant: "success" },
                running: { icon: "ti ti-player-play", label: "Running", variant: "info" },
                executing: { icon: "ti ti-player-play", label: "Executing", variant: "info" },
                failed: { icon: "ti ti-alert-triangle", label: "Failed", variant: "danger" },
                error: { icon: "ti ti-alert-triangle", label: "Error", variant: "danger" },
                interrupted: { icon: "ti ti-player-stop", label: "Interrupted", variant: "warning" },
                cancelled: { icon: "ti ti-player-stop", label: "Cancelled", variant: "warning" },
                canceled: { icon: "ti ti-player-stop", label: "Cancelled", variant: "warning" },
                pending: { icon: "ti ti-clock-hour-3", label: "Pending", variant: "neutral" },
                queued: { icon: "ti ti-clock-hour-3", label: "Queued", variant: "neutral" },
            }[normalized] || { icon: "ti ti-circle-dashed", label: Format.statusLabel(status || "Unknown"), variant: "neutral" };
            const classes = ["pqueue-status", `pqueue-status--${meta.variant}`];
            if (subtle) classes.push("pqueue-status--subtle");
            const badge = UI.el("span", { class: classes });
            badge.appendChild(UI.icon(meta.icon, { size: "sm" }));
            badge.appendChild(UI.el("span", { class: "pqueue-status__label", text: meta.label }));
            return badge;
        },

        emptyState({ icon, title, description, action } = {}) {
            const box = UI.el("div", { class: "pqueue-empty" });
            if (icon) box.appendChild(UI.icon(icon, { size: "lg" }));
            if (title) box.appendChild(UI.el("h4", { class: "pqueue-empty__title", text: title }));
            if (description) box.appendChild(UI.el("p", { class: "pqueue-empty__desc", text: description }));
            if (action) box.appendChild(action);
            return box;
        },

        metricTile({ icon, label, value, caption, variant, tooltip }) {
            const card = UI.el("article", { class: ["pqueue-metric", variant ? `pqueue-metric--${variant}` : null] });
            const labelEl = UI.el("span", { class: "pqueue-metric__label", text: label });
            const headerChildren = [UI.icon(icon, { size: "md" }), labelEl];
            if (tooltip) {
                card.setAttribute("title", tooltip);
            }
            const header = UI.el("div", { class: "pqueue-metric__header" }, headerChildren);
            card.appendChild(header);
            card.appendChild(UI.el("div", { class: "pqueue-metric__value", text: value }));
            if (caption) card.appendChild(UI.el("div", { class: "pqueue-metric__caption", text: caption }));
            return card;
        },

        ensureAssets() {
            if (!document.getElementById("pqueue-style")) {
                const link = document.createElement("link");
                link.id = "pqueue-style";
                link.rel = "stylesheet";
                link.href = "/extensions/ComfyUI-PersistentQueue/css/queue_style.css";
                document.head.appendChild(link);
            }
            if (!document.querySelector("link[data-pqueue-icons]")) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = "/extensions/ComfyUI-PersistentQueue/lib/tabler-icons.min.css";
                link.dataset.pqueueIcons = "true";
                document.head.appendChild(link);
            }
        },

        // Compute a robust numeric key for history ordering
        historyKey(row) {
            try {
                const ts = row && (row.completed_at || row.created_at);
                if (typeof ts === 'number' && Number.isFinite(ts)) {
                    return ts < 1e12 ? Math.floor(ts * 1000) : Math.floor(ts);
                }
                if (typeof ts === 'string') {
                    const s = ts.trim();
                    if (/^\d+$/.test(s)) {
                        const n = parseInt(s, 10);
                        if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
                    }
                    let ms = Date.parse(s);
                    if (!Number.isFinite(ms)) {
                        ms = Date.parse(s.replace(' ', 'T'));
                    }
                    if (Number.isFinite(ms)) return ms;
                }
                const id = Number(row?.id);
                return Number.isFinite(id) ? id : 0;
            } catch (err) {
                const id = Number(row?.id);
                return Number.isFinite(id) ? id : 0;
            }
        },

        // Composite key: [ms, id] for strict total ordering
        historyKeyParts(row) {
            const ms = UI.historyKey(row) || 0;
            const id = Number(row?.id) || 0;
            return [ms, id];
        },

        // Find and cache the real scroll container (ComfyUI sidebar)
        getScrollContainer() {
            try {
                if (state?.dom?.scrollContainer && document.body.contains(state.dom.scrollContainer)) return state.dom.scrollContainer;
                const explicit = document.querySelector('.sidebar-content-container');
                if (explicit) { state.dom.scrollContainer = explicit; return explicit; }
                let el = state.container;
                while (el && el !== document.body && el !== document.documentElement) {
                    try {
                        const style = window.getComputedStyle(el);
                        const oy = style.overflowY;
                        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
                            state.dom.scrollContainer = el;
                            return el;
                        }
                        el = el.parentElement;
                    } catch (err) { break; }
                }
                const fallback = document.scrollingElement || document.documentElement || document.body;
                state.dom.scrollContainer = fallback;
                return fallback;
            } catch (err) {
                return document.scrollingElement || document.documentElement || document.body;
            }
        },

        // Choose the history card nearest the top of the viewport as the scroll anchor
        getVisibleHistoryAnchor() {
            try {
                const scroller = UI.getScrollContainer();
                const grid = state.dom.historyGrid;
                if (!scroller || !grid) return null;
                const scRect = scroller.getBoundingClientRect();
                const cards = Array.from(grid.querySelectorAll('.pqueue-history-card'));
                if (!cards.length) return null;
                let best = null;
                let bestDelta = Infinity;
                for (const el of cards) {
                    const top = el.getBoundingClientRect().top;
                    const delta = top - scRect.top;
                    if (delta >= -1 && delta < bestDelta) { bestDelta = delta; best = el; }
                }
                if (best) return best;
                for (let i = cards.length - 1; i >= 0; i--) {
                    const el = cards[i];
                    if (el.getBoundingClientRect().top < scRect.top) return el;
                }
                return cards[0];
            } catch (err) { return null; }
        },

        // Keep an anchor element visually stationary while mutating DOM
        withStableAnchor(mutator) {
            try {
                state.anchorLockDepth = (state.anchorLockDepth || 0) + 1;
                if (state.anchorLockDepth === 1) {
                    const scroller = UI.getScrollContainer();
                    const anchor = UI.getVisibleHistoryAnchor() || state.dom.historyCard || state.dom.root;
                    if (scroller && anchor) {
                        const scRect = scroller.getBoundingClientRect();
                        const aRect = anchor.getBoundingClientRect();
                        state.anchorSnapshot = { scroller, anchor, before: aRect.top - scRect.top };
                    } else {
                        state.anchorSnapshot = null;
                    }
                }
                mutator && mutator();
                window.requestAnimationFrame(() => {
                    try {
                        state.anchorLockDepth = Math.max(0, (state.anchorLockDepth || 1) - 1);
                        if (state.anchorLockDepth === 0 && state.anchorSnapshot && state.anchorSnapshot.scroller && document.body.contains(state.anchorSnapshot.anchor)) {
                            const { scroller, anchor, before } = state.anchorSnapshot;
                            const scRect2 = scroller.getBoundingClientRect();
                            const aRect2 = anchor.getBoundingClientRect();
                            const delta = (aRect2.top - scRect2.top) - before;
                            if (delta) scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
                        }
                    } catch (err) { /* noop */ }
                });
            } catch (err) {
                try { mutator && mutator(); } catch (e) { /* noop */ }
                state.anchorLockDepth = 0;
                state.anchorSnapshot = null;
            }
        },

        render() {
            if (!state.container) return;
            UI.ensureAssets();

            const prevDom = state.dom;
            let _prevScrollTop = 0;
            let _prevAnchorOffset = null;
            let _prevScroller = null;
            const findScrollContainer = (node) => {
                try {
                    let el = node;
                    while (el && el !== document.body && el !== document.documentElement) {
                        const style = window.getComputedStyle(el);
                        const oy = style.overflowY;
                        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
                        el = el.parentElement;
                    }
                    return document.scrollingElement || document.documentElement || document.body;
                } catch (err) {
                    return document.scrollingElement || document.documentElement || document.body;
                }
            };
            try {
                _prevScroller = findScrollContainer(state.container);
                if (_prevScroller) {
                    _prevScrollTop = _prevScroller.scrollTop || 0;
                    const prevCard = (prevDom && prevDom.historyCard) ? prevDom.historyCard : state.container.querySelector('.pqueue-card');
                    if (prevCard) {
                        const scRect = _prevScroller.getBoundingClientRect();
                        const cardRect = prevCard.getBoundingClientRect();
                        _prevAnchorOffset = cardRect.top - scRect.top;
                    }
                }
            } catch (err) { /* noop */ }

            const dom = (state.dom = {});
            state.container.innerHTML = "";

            const root = UI.el("div", { class: "pqueue-root" });
            dom.root = root;

            root.appendChild(UI.renderToolbar());
            const sections = UI.el("div", { class: "pqueue-sections" });
            const metrics = UI.renderMetrics();
            if (metrics) sections.appendChild(metrics);
            sections.appendChild(UI.renderRunning());
            sections.appendChild(UI.renderPending());
            sections.appendChild(UI.renderHistory());
            root.appendChild(sections);
            state.container.appendChild(root);

            dom.sections = sections;

            requestAnimationFrame(() => {
                try {
                    const scroller = _prevScroller || findScrollContainer(state.container);
                    if (!scroller) return;
                    const newCard = (state.dom && state.dom.historyCard) ? state.dom.historyCard : state.container.querySelector('.pqueue-card');
                    if (_prevAnchorOffset != null && newCard) {
                        const scRect2 = scroller.getBoundingClientRect();
                        const cardRect2 = newCard.getBoundingClientRect();
                        const newOffset = cardRect2.top - scRect2.top;
                        scroller.scrollTop = Math.max(0, _prevScrollTop + (newOffset - _prevAnchorOffset));
                    } else {
                        scroller.scrollTop = _prevScrollTop;
                    }
                } catch (err) { /* noop */ }
            });

            Events.bind();
            UI.updateProgressBars();
            UI.refreshFilter();
            UI.updateSelectionUI();
            UI.updateToolbarStatus();
        },

        renderToolbar() {
            const pauseBtn = UI.button({
                id: "pqueue-toggle",
                icon: state.paused ? "ti ti-player-play-filled" : "ti ti-player-pause-filled",
                ariaLabel: state.paused ? "Resume queue" : "Pause queue",
                title: state.paused ? "Resume queue" : "Pause queue",
                variant: state.paused ? "success" : "warning",
                subtle: true,
            });
            pauseBtn.addEventListener('click', Events.togglePause);
            const clearBtn = UI.button({
                id: "pqueue-clear",
                icon: "ti ti-player-stop",
                ariaLabel: "Clear pending",
                title: "Clear pending jobs",
                variant: "danger",
                subtle: true,
            });
            clearBtn.addEventListener('click', Events.clearPending);

            return UI.el("div", { class: "pqueue-toolbar" }, [
                UI.el("div", { class: "pqueue-toolbar__row" }, [
                    UI.el("div", { class: "pqueue-toolbar__group" }, [pauseBtn, clearBtn]),
                ]),
            ]);
        },

        renderMetrics() {
            const m = state.metrics;
            if (!m) return null;
            const tiles = [
                UI.metricTile({
                    icon: "ti ti-stack-2",
                    label: "In queue",
                    value: String(m.queueCount),
                    caption: `${m.runningCount} running • ${m.persistedCount} persisted`,
                    variant: m.queueCount ? "primary" : "neutral",
                }),
                UI.metricTile({
                    icon: "ti ti-chart-pie",
                    label: "Success rate",
                    value: m.successRate != null ? `${Math.round(m.successRate * 100)}%` : "—",
                    caption: m.failureCount ? `${m.failureCount} recent failure${m.failureCount === 1 ? "" : "s"}` : "No recent failures",
                    variant: m.successRate != null && m.successRate >= 0.75 ? "success" : "neutral",
                }),
                UI.metricTile({
                    icon: "ti ti-clock-hour-3",
                    label: "Avg duration",
                    value: m.avgDuration ? Format.duration(m.avgDuration) : "—",
                    caption: "Calculated from history",
                    variant: "neutral",
                }),
                UI.metricTile({
                    icon: "ti ti-hourglass-high",
                    label: "Est. total duration",
                    value: m.estimatedTotalDuration ? Format.duration(m.estimatedTotalDuration) : "—",
                    caption: [
                        m.estimatedRunningDuration ? `~${Format.duration(m.estimatedRunningDuration)} running` : null,
                        m.estimatedPendingDuration ? `~${Format.duration(m.estimatedPendingDuration)} pending` : null,
                    ].filter(Boolean).join(" • ") || (m.queueCount ? `${m.queueCount} pending item${m.queueCount === 1 ? "" : "s"}` : "No pending items"),
                    variant: m.estimatedTotalDuration ? "neutral" : "neutral",
                    tooltip: "Sum of per-workflow averages for running (remaining) and pending items. Per-workflow averages are computed from recent history; if unavailable, falls back to global average duration.",
                }),
            ];
            const wrap = UI.el("div", { class: "pqueue-metrics" }, tiles);
            state.dom.metrics = wrap;
            return wrap;
        },

        renderRunning() {
            const rows = [];
            if (!state.queue_running.length) {
                const placeholder = UI.el("div", { class: "pqueue-item pqueue-item--running", style: "display:flex;align-items:center;justify-content:center;text-align:center;" }, [
                    UI.el("span", { class: "pqueue-muted", text: "no running job" })
                ]);
                rows.push(placeholder);
            } else {
                state.queue_running.forEach((item, index) => {
                    const pid = item[1];
                    const fraction = Math.max(0, Math.min(1, Number(state.running_progress?.[pid]) || 0));
                    const workflowName = state.workflowNameCache.get(pid) || pid;
                    const meta = UI.el("div", { class: "pqueue-item__meta" }, [
                        UI.icon("ti ti-loader-2", { spin: true }),
                        UI.el("span", { class: "pqueue-chip pqueue-chip--primary", text: `#${index + 1}` }),
                        UI.el("span", { class: "pqueue-row__label", text: workflowName }),
                        UI.el("span", { class: "pqueue-progress__label", text: Format.percent(fraction) }),
                    ]);
                    const bar = UI.el("div", { class: "pqueue-progress-bar" });
                    bar.style.width = `${(fraction * 100).toFixed(1)}%`;
                    const progress = UI.el("div", { class: "pqueue-progress" }, [UI.el("div", { class: "pqueue-progress__track" }, [bar])]);
                    rows.push(UI.el("div", { class: "pqueue-item pqueue-item--running", "data-id": pid }, [meta, progress]));
                });
            }
            const card = UI.card("Currently running", {
                icon: "ti ti-activity-heartbeat",
                subtitle: state.metrics.runningCount ? `${state.metrics.runningCount} active` : "",
                content: rows,
                classes: "pqueue-card--running",
            });
            state.dom.runningCard = card;
            return card;
        },

        renderPending() {
            const wrapper = UI.el("div", { class: "pqueue-table-wrapper" });
            const list = UI.el("div", { class: "pqueue-list", id: "pqueue-pending" });
            state.dom.pendingTable = list;

            const filter = UI.el("input", {
                id: "pqueue-filter",
                class: "pqueue-input",
                type: "search",
                placeholder: "Filter pending by prompt, status, error…",
                value: state.filters.pending,
                spellcheck: "false",
            });
            state.dom.filterInput = filter;

            const listHeader = UI.el("div", { class: "pqueue-list__header" }, [
                UI.el("label", { class: "pqueue-list__selectall" }, [
                    UI.el("input", { type: "checkbox", class: "pqueue-checkbox pqueue-select-all", title: "Select all visible" }),
                    UI.el("span", { class: "pqueue-table__heading", text: "Select all" })
                ])
            ]);
            list.appendChild(listHeader);

            const rows = state.queue_pending.map(UI.pendingRow).filter(Boolean);
            if (!rows.length) {
                rows.push(UI.emptyState({
                    icon: "ti ti-stack-2",
                    title: "Queue empty",
                    description: "Enqueue prompts in ComfyUI to populate the persistent queue.",
                }));
            }
            rows.forEach((row) => list.appendChild(row));
            wrapper.appendChild(list);

            const footerCount = UI.el("span", { class: "pqueue-muted" });
            const footerUpdated = UI.el("span", { class: "pqueue-muted" });
            state.dom.pendingCount = footerCount;
            state.dom.pendingUpdated = footerUpdated;

            const deleteSelected = UI.button({
                id: "pqueue-delete-selected",
                icon: "ti ti-trash",
                variant: "danger",
                subtle: true,
                disabled: state.selectedPending.size === 0,
                badge: state.selectedPending.size || null,
            });
            state.dom.deleteSelectedBtn = deleteSelected;

            const footer = UI.el("div", { class: "pqueue-table__footer" }, [
                UI.el("div", { class: "pqueue-table__footer-left" }, [footerCount, footerUpdated]),
                UI.el("div", { class: "pqueue-table__footer-right" }, [deleteSelected]),
            ]);

            const card = UI.card("Queue", {
                icon: "ti ti-stack-front",
                subtitle: state.metrics.queueCount ? `${state.metrics.queueCount} pending` : null,
                actions: [filter],
                content: [wrapper, footer],
            });
            state.dom.pendingCard = card;
            return card;
        },

        pendingRow(item) {
            if (!Array.isArray(item)) return null;
            const pid = String(item[1] ?? "");
            const db = state.dbIndex.get(pid) || {};
            const selected = state.selectedPending.has(pid);

            const row = UI.el("article", { class: ["pqueue-row", selected ? "is-selected" : null], "data-id": pid, draggable: "true" });

            const checkbox = UI.el("input", { type: "checkbox", class: "pqueue-checkbox pqueue-select" });
            checkbox.checked = selected;

            const status = UI.statusBadge(db.status || "pending", { subtle: true });
            const primaryLabel = UI.buildWorkflowLabel(pid, item, db);
            primaryLabel.contentEditable = "true";
            primaryLabel.spellcheck = false;
            primaryLabel.dataset.id = pid;
            primaryLabel.dataset.original = primaryLabel.textContent || "";
            primaryLabel.classList.add("pqueue-editable");
            const finishEdit = async (node, save) => {
                try {
                    const id = node?.dataset?.id;
                    if (!id) return;
                    const original = node.dataset.original || "";
                    const current = (node.textContent || "").trim();
                    if (!save) {
                        node.textContent = original;
                        return;
                    }
                    if (current === original || !current) return;
                    await API.rename(id, current);
                    state.workflowNameCache.set(id, current);
                    setStatusMessage("Name updated");
                } catch (err) {
                    console.error("pqueue: rename failed", err);
                    state.error = err?.message || "Failed to rename";
                    UI.updateToolbarStatus();
                } finally {
                    node.dataset.original = node.textContent || "";
                }
            };
            primaryLabel.addEventListener("keydown", async (e) => {
                e.stopPropagation();
                const target = e.currentTarget;
                if (e.key === "Enter") {
                    e.preventDefault();
                    await finishEdit(target, true);
                    target.blur();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    await finishEdit(target, false);
                    target.blur();
                }
            });
            primaryLabel.addEventListener("blur", async (e) => {
                await finishEdit(e.currentTarget, true);
            });
            const line1 = UI.el("div", { class: "pqueue-pcard__line1" }, [
                UI.el("div", { class: "pqueue-pcard__l1-left" }, [checkbox, primaryLabel]),
                UI.el("div", { class: "pqueue-pcard__l1-right" }, [UI.el("span", { class: "pqueue-muted", text: db.created_at ? Format.relative(db.created_at) : "—" })])
            ]);

            const estimateSeconds = UI.estimateDuration(pid, item[2]);
            const estimateLabel = estimateSeconds ? `Est. ${Format.duration(estimateSeconds)}` : "";
            const dateLabel = db.created_at ? new Date(db.created_at).toLocaleDateString() : "";
            const timeLabel = db.created_at ? new Date(db.created_at).toLocaleTimeString() : "";

            const deleteBtn = UI.button({ icon: "ti ti-trash", variant: "danger", subtle: true, title: "Delete" });
            deleteBtn.dataset.action = "delete";
            deleteBtn.dataset.id = pid;

            const moveTopBtn = UI.button({ icon: "ti ti-arrow-bar-to-up", variant: "ghost", subtle: true, title: "Move to top" });
            moveTopBtn.dataset.action = "move-top";
            moveTopBtn.dataset.id = pid;

            const moveBottomBtn = UI.button({ icon: "ti ti-arrow-bar-to-down", variant: "ghost", subtle: true, title: "Move to bottom" });
            moveBottomBtn.dataset.action = "move-bottom";
            moveBottomBtn.dataset.id = pid;

            const actionsWrap = UI.el("div", { class: "pqueue-actions-group" }, [deleteBtn, moveTopBtn, moveBottomBtn, UI.icon("ti ti-drag-drop", { size: "sm" })]);

            const line2 = UI.el("div", { class: "pqueue-pcard__line2" }, [
                UI.el("span", { class: "pqueue-muted", text: estimateLabel }),
                UI.el("span", { class: "pqueue-muted", text: dateLabel }),
                UI.el("span", { class: "pqueue-muted", text: timeLabel }),
                actionsWrap,
            ]);

            const statusLine = UI.el("div", { class: "pqueue-pcard__status" }, [status]);
            if (db.error) {
                const err = UI.icon("ti ti-alert-triangle", { size: "sm" });
                err.classList.add("pqueue-row__error");
                err.title = db.error;
                statusLine.appendChild(err);
            }

            row.appendChild(line1);
            row.appendChild(line2);
            row.appendChild(statusLine);

            row.dataset.search = [state.workflowNameCache.get(pid) || "", db.status, db.error, db.created_at].filter(Boolean).join(" ").toLowerCase();
            return row;
        },

        renderHistory() {
            const grid = UI.el("div", { class: "pqueue-history" });
            state.dom.historyGrid = grid;
            if (!state.history.length) {
                grid.appendChild(UI.emptyState({
                    icon: "ti ti-photo-off",
                    title: "History empty",
                    description: "Completed prompts will show their thumbnails here.",
                }));
            } else {
                state.history.forEach((row) => grid.appendChild(UI.historyCard(row)));
            }
            const sentinel = UI.historySentinel();
            state.dom.historySentinel = sentinel;
            grid.appendChild(sentinel);
            const count = (state.historyTotal != null) ? state.historyTotal : state.metrics.historyCount;
            const base = (count != null) ? `${count} entries` : null;
            const range = UI.currentHistoryRangeLabel();
            const subtitle = [base, range].filter(Boolean).join(' • ');
            const card = UI.card("History", {
                icon: "ti ti-clock-bolt",
                subtitle,
                actions: UI.historyFilters(),
                content: grid,
            });
            state.dom.historyCard = card;
            state.dom.historySubtitle = card.querySelector('.pqueue-card__subtitle');
            return card;
        },

        updateAfterRefresh(paged) {
            try {
                UI.updateToolbarControls();
                UI.updateMetrics();
                UI.updateRunningSection();
                UI.updatePendingSection();
                UI.reconcileHistoryFromState();
                UI.updateHistorySubtitle();
            } catch (err) {
                try { UI.ensureHistoryObserver(); } catch (e) { /* noop */ }
            }
        },

        reconcileHistoryFromState() {
            try {
                const grid = state.dom.historyGrid;
                const sentinel = state.dom.historySentinel;
                if (!grid || !sentinel) return;
                const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
                UI.withStableAnchor(() => {
                    try { Array.from(grid.querySelectorAll('.pqueue-empty')).forEach((n) => n.remove()); } catch (err) { /* noop */ }
                    const existingIds = new Set(Array.from(grid.querySelectorAll('.pqueue-history-card')).map((n) => n.getAttribute('data-id')));
                    const ordered = Array.isArray(state.history) ? state.history.slice() : [];
                    try {
                        ordered.sort((a, b) => {
                            const [ams, aid] = UI.historyKeyParts(a);
                            const [bms, bid] = UI.historyKeyParts(b);
                            if (ams !== bms) return dir === 'desc' ? (bms - ams) : (ams - bms);
                            return dir === 'desc' ? (bid - aid) : (aid - bid);
                        });
                    } catch (err) { /* noop */ }

                    for (const row of ordered) {
                        const id = row?.id != null ? String(row.id) : null;
                        if (!id || existingIds.has(id)) continue;
                        const card = UI.historyCard(row);
                        const key = Number(card.getAttribute('data-key') || 0);
                        const key2 = Number(card.getAttribute('data-key2') || 0);
                        const existingCards = Array.from(grid.querySelectorAll('.pqueue-history-card'));
                        let inserted = false;
                        if (dir === 'desc') {
                            for (const existing of existingCards) {
                                const otherKey = Number(existing.getAttribute('data-key') || 0);
                                const otherKey2 = Number(existing.getAttribute('data-key2') || 0);
                                if (key > otherKey || (key === otherKey && key2 >= otherKey2)) { grid.insertBefore(card, existing); inserted = true; break; }
                            }
                            if (!inserted) grid.insertBefore(card, sentinel);
                        } else {
                            for (let i = existingCards.length - 1; i >= 0; i--) {
                                const existing = existingCards[i];
                                const otherKey = Number(existing.getAttribute('data-key') || 0);
                                const otherKey2 = Number(existing.getAttribute('data-key2') || 0);
                                if (key > otherKey || (key === otherKey && key2 >= otherKey2)) { grid.insertBefore(card, existing.nextSibling || sentinel); inserted = true; break; }
                            }
                            if (!inserted) {
                                const firstCard = existingCards[0] || grid.querySelector('.pqueue-history-card');
                                grid.insertBefore(card, firstCard || sentinel);
                            }
                        }
                        existingIds.add(id);
                    }

                    try {
                        state.historyIds = new Set(Array.from(grid.querySelectorAll('.pqueue-history-card')).map((n) => Number(n.getAttribute('data-id'))).filter((v) => v != null));
                    } catch (err) { /* noop */ }
                });
            } catch (err) { /* noop */ }
        },

        updateToolbarControls() {
            try {
                const pauseBtn = document.getElementById('pqueue-toggle');
                if (pauseBtn) {
                    const isPaused = !!state.paused;
                    pauseBtn.title = isPaused ? 'Resume queue' : 'Pause queue';
                    pauseBtn.setAttribute('aria-label', isPaused ? 'Resume queue' : 'Pause queue');
                    pauseBtn.classList.toggle('pqueue-button--success', isPaused);
                    pauseBtn.classList.toggle('pqueue-button--warning', !isPaused);
                    pauseBtn.innerHTML = '';
                    pauseBtn.appendChild(UI.icon(isPaused ? 'ti ti-player-play-filled' : 'ti ti-player-pause-filled'));
                    pauseBtn.removeEventListener('click', Events.togglePause);
                    pauseBtn.addEventListener('click', Events.togglePause);
                }
            } catch (err) { /* noop */ }
        },

        updateMetrics() {
            try {
                const newMetrics = UI.renderMetrics();
                if (!newMetrics) return;
                const old = state.dom.metrics;
                if (old && old.parentNode) {
                    old.parentNode.replaceChild(newMetrics, old);
                    state.dom.metrics = newMetrics;
                }
            } catch (err) { /* noop */ }
        },

        updateRunningSection() {
            try {
                UI.withStableAnchor(() => {
                    const card = state.dom.runningCard;
                    if (!card) return;
                    const body = card.querySelector('.pqueue-card__body');
                    if (!body) return;
                    const rect = body.getBoundingClientRect();
                    const beforeHeight = Math.max(0, (rect && rect.height) || 0);
                    body.innerHTML = '';
                    if (!state.queue_running.length) {
                        if (beforeHeight) body.style.minHeight = `${beforeHeight}px`;
                        const placeholder = UI.el('div', { class: 'pqueue-item pqueue-item--running', style: 'display:flex;align-items:center;justify-content:center;text-align:center;' }, [
                            UI.el('span', { class: 'pqueue-muted', text: 'no running job' })
                        ]);
                        body.appendChild(placeholder);
                    } else {
                        try { body.style.minHeight = ''; } catch (err) { /* noop */ }
                        state.queue_running.forEach((item, index) => {
                            const pid = item[1];
                            const fraction = Math.max(0, Math.min(1, Number(state.running_progress?.[pid]) || 0));
                            const workflowName = state.workflowNameCache.get(pid) || pid;
                            const meta = UI.el('div', { class: 'pqueue-item__meta' }, [
                                UI.icon('ti ti-loader-2', { spin: true }),
                                UI.el('span', { class: 'pqueue-chip pqueue-chip--primary', text: `#${index + 1}` }),
                                UI.el('span', { class: 'pqueue-row__label', text: workflowName }),
                                UI.el('span', { class: 'pqueue-progress__label', text: Format.percent(fraction) }),
                            ]);
                            const bar = UI.el('div', { class: 'pqueue-progress-bar' });
                            bar.style.width = `${(fraction * 100).toFixed(1)}%`;
                            const progress = UI.el('div', { class: 'pqueue-progress' }, [UI.el('div', { class: 'pqueue-progress__track' }, [bar])]);
                            body.appendChild(UI.el('div', { class: 'pqueue-item pqueue-item--running', 'data-id': pid }, [meta, progress]));
                        });
                    }
                    const subtitle = card.querySelector('.pqueue-card__subtitle');
                    if (subtitle) subtitle.textContent = state.metrics.runningCount ? `${state.metrics.runningCount} active` : '';
                });
            } catch (err) { /* noop */ }
        },

        updatePendingSection() {
            try {
                UI.withStableAnchor(() => {
                    const card = state.dom.pendingCard;
                    if (!card) return;
                    const subtitle = card.querySelector('.pqueue-card__subtitle');
                    if (subtitle) subtitle.textContent = state.metrics.queueCount ? `${state.metrics.queueCount} pending` : '';
                    const table = state.dom.pendingTable;
                    if (!table) return;
                    Array.from(table.querySelectorAll('.pqueue-row[data-id]')).forEach((n) => n.remove());
                    const rows = state.queue_pending.map(UI.pendingRow).filter(Boolean);
                    const header = table.querySelector('.pqueue-list__header');
                    const frag = document.createDocumentFragment();
                    rows.forEach((r) => frag.appendChild(r));
                    if (header && header.nextSibling) {
                        table.insertBefore(frag, header.nextSibling);
                    } else {
                        table.appendChild(frag);
                    }
                    UI.refreshFilter();
                    UI.updateSelectionUI();
                    UI.updatePendingFooter(Array.from(table.querySelectorAll('.pqueue-row[data-id]')).filter((r) => r.style.display !== 'none').length);
                });
            } catch (err) { /* noop */ }
        },

        mergeHistoryFromRefresh(paged) {
            try {
                const grid = state.dom.historyGrid;
                const sentinel = state.dom.historySentinel;
                if (!grid || !sentinel) return;

                let list = Array.isArray(paged?.history) ? paged.history : [];
                try {
                    const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
                    list = list.slice().sort((a, b) => {
                        const [ams, aid] = UI.historyKeyParts(a);
                        const [bms, bid] = UI.historyKeyParts(b);
                        if (ams !== bms) return dir === 'desc' ? (bms - ams) : (ams - bms);
                        return dir === 'desc' ? (bid - aid) : (aid - bid);
                    });
                } catch (err) { /* noop */ }
                if (!state.historyIds) state.historyIds = new Set();
                UI.withStableAnchor(() => {
                    try { Array.from(grid.querySelectorAll('.pqueue-empty')).forEach((n) => n.remove()); } catch (err) { /* noop */ }
                    for (const row of list) {
                        const id = row?.id;
                        if (id == null || state.historyIds.has(id)) continue;
                        state.historyIds.add(id);
                        const card = UI.historyCard(row);
                        const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
                        const key = Number(card.getAttribute('data-key') || 0);
                        const key2 = Number(card.getAttribute('data-key2') || 0);
                        const existingCards = Array.from(grid.querySelectorAll('.pqueue-history-card'));
                        let inserted = false;
                        if (dir === 'desc') {
                            for (const existing of existingCards) {
                                const otherKey = Number(existing.getAttribute('data-key') || 0);
                                const otherKey2 = Number(existing.getAttribute('data-key2') || 0);
                                if (key > otherKey || (key === otherKey && key2 >= otherKey2)) { grid.insertBefore(card, existing); inserted = true; break; }
                            }
                            if (!inserted) grid.insertBefore(card, sentinel);
                        } else {
                            for (let i = existingCards.length - 1; i >= 0; i--) {
                                const existing = existingCards[i];
                                const otherKey = Number(existing.getAttribute('data-key') || 0);
                                const otherKey2 = Number(existing.getAttribute('data-key2') || 0);
                                if (key > otherKey || (key === otherKey && key2 >= otherKey2)) { grid.insertBefore(card, existing.nextSibling || sentinel); inserted = true; break; }
                            }
                            if (!inserted) grid.insertBefore(card, sentinel);
                        }
                        if (Array.isArray(state.history)) {
                            if (dir === 'desc') state.history.unshift(row);
                            else state.history.push(row);
                        }
                    }
                });
                if (typeof paged?.total === 'number') state.historyTotal = paged.total;
                state.historyPaging = state.historyPaging || { isLoading: false, hasMore: true, nextCursor: null, params: { sort_by: 'id', sort_dir: 'desc', limit: 60 } };
                state.historyPaging.nextCursor = paged?.next_cursor || state.historyPaging.nextCursor;
                state.historyPaging.hasMore = !!paged?.has_more || state.historyPaging.hasMore;
                if (!state.historyPaging.hasMore && sentinel) sentinel.style.display = 'none';
            } catch (err) { /* noop */ }
        },

        currentHistoryRangeLabel() {
            try {
                const sDate = state.filters?.historySince || "";
                const sTime = state.filters?.historySinceTime || "";
                const uDate = state.filters?.historyUntil || "";
                const uTime = state.filters?.historyUntilTime || "";
                if (!sDate && !uDate) return "";
                if (state.historyPreset === 'today') return 'Today';
                if (state.historyPreset === '24h') return 'Last 24h';
                if (state.historyPreset === '7d') return 'Last 7 days';
                const compact = (d, t, end) => {
                    if (!d) return '';
                    const parts = d.split('-').map((x) => parseInt(x, 10));
                    let hh = end ? 23 : 0, mm = end ? 59 : 0;
                    if (t && /^\d{2}:\d{2}/.test(t)) {
                        const tt = t.split(':').map((x) => parseInt(x, 10));
                        hh = tt[0] ?? hh; mm = tt[1] ?? mm;
                    }
                    const pad = (n) => String(n).padStart(2, '0');
                    return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])} ${pad(hh)}:${pad(mm)}`;
                };
                const left = compact(sDate, sTime, false);
                const right = compact(uDate, uTime, true);
                if (left && right) return `${left} – ${right}`;
                if (left) return `Since ${left}`;
                if (right) return `Until ${right}`;
                return "";
            } catch (err) {
                return "";
            }
        },

        updateHistorySubtitle() {
            try {
                const el = state.dom.historySubtitle;
                if (!el) return;
                const count = (state.historyTotal != null) ? state.historyTotal : state.metrics?.historyCount;
                const base = (count != null) ? `${count} entries` : null;
                const range = UI.currentHistoryRangeLabel();
                const text = [base, range].filter(Boolean).join(' • ');
                el.textContent = text;
            } catch (err) { /* noop */ }
        },

        historyFilters() {
            const filtersBtn = UI.button({ icon: "ti ti-filter", variant: "ghost", subtle: true, title: "Filters" });
            const sortToggle = UI.sortToggleButton();

            filtersBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                Events.toggleFiltersPopover(e.currentTarget);
            });

            return [filtersBtn, sortToggle, UI.clearFiltersIcon()];
        },

        clearFiltersIcon() {
            const btn = UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Clear filters" });
            btn.addEventListener('click', () => Events.applyHistoryPreset('clear'));
            return btn;
        },

        sortToggleButton() {
            const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
            const icon = dir === 'asc' ? 'ti ti-arrow-bar-to-up' : 'ti ti-arrow-bar-to-down';
            const title = dir === 'asc' ? 'Sort ascending (click to toggle)' : 'Sort descending (click to toggle)';
            const btn = UI.button({ icon, variant: 'ghost', subtle: true, title });
            btn.addEventListener('click', () => {
                const current = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
                const next = current === 'asc' ? 'desc' : 'asc';
                Events.setHistorySort(next);
                UI.updateSortToggle();
            });
            state.dom.sortToggleBtn = btn;
            return btn;
        },

        updateSortToggle() {
            try {
                const btn = state.dom.sortToggleBtn;
                if (!btn) return;
                const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
                const icon = dir === 'asc' ? 'ti ti-arrow-bar-to-up' : 'ti ti-arrow-bar-to-down';
                btn.innerHTML = '';
                btn.appendChild(UI.icon(icon));
                btn.title = dir === 'asc' ? 'Sort ascending (click to toggle)' : 'Sort descending (click to toggle)';
            } catch (err) { /* noop */ }
        },

        historySentinel() {
            const wrap = UI.el("div", { class: "pqueue-history-sentinel" });
            const spinner = UI.icon("ti ti-loader-2", { size: "md", spin: true });
            wrap.appendChild(spinner);
            return wrap;
        },

        historyCard(row) {
            const attrs = { class: "pqueue-history-card", title: Format.tooltip(row) };
            if (row && row.id != null) attrs["data-id"] = String(row.id);
            const ts = row && (row.completed_at || row.created_at);
            if (ts != null) attrs["data-ts"] = String(ts);
            const [ms, idPart] = UI.historyKeyParts(row);
            attrs["data-key"] = String(ms);
            attrs["data-key2"] = String(idPart);
            const card = UI.el("article", attrs);
            const header = UI.el("div", { class: "pqueue-history-card__header" }, [UI.statusBadge(row.status || "success"), UI.el("span", { class: "pqueue-history-card__time", text: row.completed_at ? Format.relative(row.completed_at) : Format.relative(row.created_at) })]);
            const fileLabel = UI.historyPrimaryFilename(row);
            const meta = UI.el("div", { class: "pqueue-history-card__meta" }, [UI.el("span", { class: "pqueue-code", text: fileLabel }), UI.el("span", { class: "pqueue-history-card__duration", text: Format.duration(Number(row.duration_seconds)) || "—" })]);
            const thumbs = UI.renderThumbs(row);
            card.appendChild(header);
            card.appendChild(meta);
            card.appendChild(thumbs);
            return card;
        },

        renderThumbs(row) {
            const container = UI.el("div", { class: "pqueue-thumb-row" });
            const placeholderMeta = UI.thumbPlaceholder(row);

            const ensurePlaceholder = () => {
                const wrap = UI.el("div", { class: ["pqueue-thumb-wrap", "pqueue-thumb-wrap-placeholder", placeholderMeta.variant ? `pqueue-thumb-wrap-placeholder--${placeholderMeta.variant}` : null] });
                wrap.appendChild(UI.thumbPlaceholderNode(placeholderMeta));
                container.appendChild(wrap);
            };

            const attachFallback = (wrap, img, images) => {
                img.addEventListener(
                    "error",
                    () => {
                        wrap.classList.add("pqueue-thumb-wrap-placeholder");
                        if (placeholderMeta.variant) wrap.classList.add(`pqueue-thumb-wrap-placeholder--${placeholderMeta.variant}`);
                        wrap.replaceChildren(UI.thumbPlaceholderNode(placeholderMeta));
                        if (!images.length) wrap.onclick = null;
                    },
                    { once: true }
                );
            };

            if (row.id) {
                const galleryImages = UI.extractImages(row);
                const url = new URL(`/api/pqueue/history/thumb/${row.id}`, window.location.origin);
                url.searchParams.set("_", String(Date.now()));
                const wrap = UI.el("div", { class: "pqueue-thumb-wrap" });
                const img = UI.el("img", { class: "pqueue-thumb", src: url.href, title: `history-${row.id}`, loading: "lazy", decoding: "async", fetchpriority: "low" });
                attachFallback(wrap, img, galleryImages);
                wrap.appendChild(img);
                const count = UI.countImages(row);
                if (count > 1) wrap.appendChild(UI.el("div", { class: "pqueue-thumb-badge", text: `${count}` }));
                if (galleryImages.length) wrap.onclick = () => UI.openGallery(galleryImages, 0, row.prompt_id);
                container.appendChild(wrap);
            }

            if (!container.children.length) {
                const images = UI.extractImages(row);
                if (images.length) {
                    const first = images[0];
                    const url = UI.buildPreviewUrl(first, row.prompt_id);
                    const wrap = UI.el("div", { class: "pqueue-thumb-wrap" });
                    const img = UI.el("img", { class: "pqueue-thumb", src: url.href, title: first.filename, loading: "lazy", decoding: "async", fetchpriority: "low" });
                    attachFallback(wrap, img, images);
                    wrap.appendChild(img);
                    if (images.length > 1) wrap.appendChild(UI.el("div", { class: "pqueue-thumb-badge", text: `${images.length}` }));
                    wrap.onclick = () => UI.openGallery(images, 0, row.prompt_id);
                    container.appendChild(wrap);
                }
            }

            if (!container.children.length) ensurePlaceholder();
            return container;
        },

        thumbPlaceholder(row) {
            const status = String(row?.status ?? "").toLowerCase();
            if (["interrupted", "cancelled", "canceled", "stopped"].includes(status)) {
                return { text: "Interrupted", icon: "ti ti-player-stop", variant: "interrupted" };
            }
            if (["error", "failed", "failure"].includes(status)) {
                return { text: "Failed", icon: "ti ti-alert-triangle", variant: "failed" };
            }
            return { text: "Preview unavailable", icon: "ti ti-photo-off", variant: "empty" };
        },

        thumbPlaceholderNode(meta) {
            return UI.el("div", { class: ["pqueue-thumb-placeholder", meta.variant ? `pqueue-thumb-placeholder--${meta.variant}` : null] }, [UI.icon(meta.icon), UI.el("span", { class: "pqueue-thumb-placeholder__text", text: meta.text })]);
        },

        estimateDuration(promptId, workflow) {
            let key = state.workflowCache.get(promptId);
            if (!key && workflow !== undefined) {
                try {
                    key = typeof workflow === "string" ? workflow : JSON.stringify(workflow);
                    if (key) state.workflowCache.set(promptId, key);
                } catch (err) { /* ignore */ }
            }
            if (key && state.durationByWorkflow.has(key)) return state.durationByWorkflow.get(key);
            return state.metrics.avgDuration;
        },

        updateProgressBars() {
            if (!state.dom.root) return;
            Object.entries(state.running_progress).forEach(([pid, frac]) => {
                const bar = state.dom.root.querySelector(`.pqueue-item[data-id="${pid}"] .pqueue-progress-bar`);
                if (bar) bar.style.width = `${(Number(frac) * 100).toFixed(1)}%`;
            });
        },

        ensureHistoryObserver() {
            try {
                if (!('IntersectionObserver' in window)) return;
                const grid = state.dom.historyGrid;
                const sentinel = state.dom.historySentinel;
                if (!grid || !sentinel) return;

                if (state.historyObserver) {
                    state.historyObserver.disconnect();
                    state.historyObserver = null;
                }

                if (!state.historyPaging?.nextCursor && state.history?.length) {
                    const last = state.history[state.history.length - 1];
                    state.historyPaging.nextCursor = { id: last?.id, value: last?.id };
                    state.historyPaging.hasMore = true;
                }

                const scroller = UI.getScrollContainer();
                const rootIsAncestor = (el, ancestor) => {
                    try {
                        if (!ancestor || !(ancestor instanceof Element)) return false;
                        return ancestor.contains(el);
                    } catch (err) { return false; }
                };
                const root = rootIsAncestor(sentinel, scroller) ? scroller : null;
                const obs = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;
                        Events.loadMoreHistory();
                    });
                }, { root: root, rootMargin: '360px 0px', threshold: 0 });
                obs.observe(sentinel);
                state.historyObserver = obs;
            } catch (err) { /* noop */ }
        },

        ensureThumbObserver() {
            try {
                if (!('IntersectionObserver' in window)) return;
                const grid = state.dom.historyGrid;
                if (!grid) return;

                if (state.thumbObserver) {
                    try { state.thumbObserver.disconnect(); } catch (e) {}
                    state.thumbObserver = null;
                }

                const scroller = UI.getScrollContainer();
                const rootIsAncestor = (el, ancestor) => {
                    try { return ancestor instanceof Element ? ancestor.contains(el) : false; } catch (err) { return false; }
                };
                const root = rootIsAncestor(grid, scroller) ? scroller : null;
                const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
                const obs = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        const img = entry.target;
                        if (!(img instanceof HTMLImageElement)) return;
                        if (entry.isIntersecting) {
                            try { img.setAttribute('fetchpriority', 'high'); } catch (err) {}
                            try { img.decoding = 'async'; } catch (err) {}
                            try { ric(() => { try { img.decode().catch(() => {}); } catch (e) {} }); } catch (err) {}
                        } else {
                            try { img.setAttribute('fetchpriority', 'low'); } catch (err) {}
                        }
                    });
                }, { root, rootMargin: '300px 0px', threshold: 0 });

                const imgs = Array.from(grid.querySelectorAll('.pqueue-thumb'));
                imgs.forEach((img) => { try { obs.observe(img); } catch (err) {} });
                state.thumbObserver = obs;
            } catch (err) { /* noop */ }
        },

        buildFiltersPopover(anchor) {
            const since = UI.el("input", { type: "date", class: "pqueue-input", value: state.filters?.historySince || "", id: "pqueue-since-date" });
            const sinceTime = UI.el("input", { type: "time", class: "pqueue-input", value: state.filters?.historySinceTime || "", id: "pqueue-since-time", step: "1" });
            const until = UI.el("input", { type: "date", class: "pqueue-input", value: state.filters?.historyUntil || "", id: "pqueue-until-date" });
            const untilTime = UI.el("input", { type: "time", class: "pqueue-input", value: state.filters?.historyUntilTime || "", id: "pqueue-until-time", step: "1" });
            const onChange = () => Events.updateHistoryDateFilters(since.value, until.value, sinceTime.value, untilTime.value);
            [since, sinceTime, until, untilTime].forEach((el) => el.addEventListener("change", onChange));

            state.dom.historySince = since;
            state.dom.historySinceTime = sinceTime;
            state.dom.historyUntil = until;
            state.dom.historyUntilTime = untilTime;

            const dates = UI.el("div", { class: "pqueue-popover__grid" }, [
                UI.el("label", { class: "pqueue-field" }, [UI.el("span", { class: "pqueue-field__label", text: "Since date" }), since]),
                UI.el("label", { class: "pqueue-field" }, [UI.el("span", { class: "pqueue-field__label", text: "Since time" }), sinceTime]),
                UI.el("label", { class: "pqueue-field" }, [UI.el("span", { class: "pqueue-field__label", text: "Until date" }), until]),
                UI.el("label", { class: "pqueue-field" }, [UI.el("span", { class: "pqueue-field__label", text: "Until time" }), untilTime]),
            ]);

            const presets = UI.el("div", { class: "pqueue-popover__section pqueue-popover__presets" }, [
                UI.button({ text: "Today", variant: "ghost", subtle: true, size: "sm", onClick: () => Events.applyHistoryPreset("today") }),
                UI.button({ text: "Last 24h", variant: "ghost", subtle: true, size: "sm", onClick: () => Events.applyHistoryPreset("24h") }),
                UI.button({ text: "Last 7d", variant: "ghost", subtle: true, size: "sm", onClick: () => Events.applyHistoryPreset("7d") }),
                UI.button({ text: "Clear", variant: "ghost", subtle: true, size: "sm", onClick: () => Events.applyHistoryPreset("clear") }),
            ]);

            const header = UI.el('div', { class: 'pqueue-popover__header pqueue-card__header' }, [
                UI.el('div', { class: 'pqueue-popover__title', text: 'History filters' }),
                UI.el('div', { class: 'pqueue-popover__hint', text: 'Local timezone applied' }),
                UI.button({ icon: 'ti ti-x', variant: 'ghost', subtle: true, title: 'Close', onClick: () => { try { pop?.dispatchEvent(new CustomEvent('pqueue-close', { bubbles: true })); } catch (err) {} } })
            ]);

            const footer = UI.el('div', { class: 'pqueue-popover__footer' }, [
                UI.el('div', { class: 'pqueue-popover__footer-left' }, [UI.el('span', { class: 'pqueue-muted', text: UI.currentHistoryRangeLabel() })]),
                UI.el('div', { class: 'pqueue-popover__footer-right' }, [
                    UI.button({ text: 'Clear', variant: 'ghost', subtle: true, size: 'sm', onClick: () => Events.applyHistoryPreset('clear') }),
                    UI.button({ text: 'Done', variant: 'secondary', size: 'sm', onClick: () => { try { pop?.dispatchEvent(new CustomEvent('pqueue-close', { bubbles: true })); } catch (err) {} } })
                ])
            ]);

            const content = UI.el('div', { class: 'pqueue-card__body pqueue-popover__content' }, [
                UI.el('div', { class: 'pqueue-popover__section' }, [UI.el('strong', { text: 'Date range' })]),
                dates,
                UI.el('div', { class: 'pqueue-popover__section' }, [UI.el('strong', { text: 'Presets' })]),
                presets
            ]);

            const pop = UI.el('div', { class: ['pqueue-popover', 'pqueue-card'], role: 'dialog', 'aria-label': 'History filters' }, [
                UI.el('div', { class: 'pqueue-popover__arrow' }),
                header,
                content,
                footer
            ]);
            pop.setAttribute('data-open', 'false');

            const keyHandler = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    try { pop.dispatchEvent(new CustomEvent('pqueue-close', { bubbles: true })); } catch (err) {}
                } else if (e.key === 'Tab') {
                    const focusables = pop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                    const list = Array.from(focusables).filter((n) => !n.hasAttribute('disabled'));
                    if (!list.length) return;
                    const first = list[0];
                    const last = list[list.length - 1];
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
            };
            pop.addEventListener('keydown', keyHandler);

            try {
                const rect = anchor.getBoundingClientRect();
                const maxLeft = window.innerWidth - 360;
                const left = Math.min(rect.left + window.scrollX, maxLeft);
                const top = rect.bottom + 8 + window.scrollY;
                pop.style.top = `${top}px`;
                pop.style.left = `${left}px`;
                const arrow = pop.querySelector('.pqueue-popover__arrow');
                if (arrow) {
                    const anchorCenter = rect.left + rect.width / 2 + window.scrollX;
                    const popLeft = left;
                    const offset = Math.max(14, Math.min((anchorCenter - popLeft), 346));
                    arrow.style.left = `${offset}px`;
                }
            } catch (err) {}

            window.setTimeout(() => since.focus(), 0);

            return pop;
        },

        refreshFilter() {
            const table = state.dom.pendingTable;
            if (!table) return;
            const filterVal = (state.filters.pending || "").trim().toLowerCase();
            const rows = Array.from(table.querySelectorAll(".pqueue-row[data-id]"));
            let visible = 0;
            rows.forEach((row) => {
                const match = !filterVal || (row.dataset.search || "").includes(filterVal);
                row.style.display = match ? "" : "none";
                if (match) visible += 1;
            });
            UI.updatePendingFooter(visible);
        },

        updatePendingFooter(visibleCount) {
            if (state.dom.pendingCount) state.dom.pendingCount.textContent = `${visibleCount} row${visibleCount === 1 ? "" : "s"}`;
            if (state.dom.pendingUpdated) state.dom.pendingUpdated.textContent = state.lastUpdated ? `Updated ${Format.relative(state.lastUpdated)}` : "Awaiting update";
        },

        updateSelectionUI() {
            const table = state.dom.pendingTable;
            if (!table) return;
            const rows = Array.from(table.querySelectorAll(".pqueue-row[data-id]"));
            const visibleRows = rows.filter((row) => row.style.display !== "none");
            visibleRows.forEach((row) => {
                const selected = state.selectedPending.has(row.dataset.id);
                row.classList.toggle("is-selected", selected);
                const checkbox = row.querySelector(".pqueue-select");
                if (checkbox) checkbox.checked = selected;
            });
            const visibleSelected = visibleRows.filter((row) => state.selectedPending.has(row.dataset.id)).length;
            const selectAll = table.querySelector(".pqueue-select-all");
            if (selectAll) {
                if (!visibleRows.length) {
                    selectAll.checked = false;
                    selectAll.indeterminate = false;
                } else {
                    selectAll.checked = visibleSelected === visibleRows.length;
                    selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleRows.length;
                }
            }
            const count = state.selectedPending.size || null;
            if (state.dom.bulkPriorityBtn) {
                state.dom.bulkPriorityBtn.disabled = !count;
                const badge = state.dom.bulkPriorityBtn.querySelector(".pqueue-button__badge");
                if (badge) {
                    if (count) badge.textContent = String(count);
                    else badge.remove();
                } else if (count) {
                    state.dom.bulkPriorityBtn.appendChild(UI.el("span", { class: "pqueue-button__badge", text: String(count) }));
                }
            }
            if (state.dom.deleteSelectedBtn) {
                state.dom.deleteSelectedBtn.disabled = !count;
                const badge = state.dom.deleteSelectedBtn.querySelector(".pqueue-button__badge");
                if (badge) {
                    if (count) badge.textContent = String(count);
                    else badge.remove();
                } else if (count) {
                    state.dom.deleteSelectedBtn.appendChild(UI.el("span", { class: "pqueue-button__badge", text: String(count) }));
                }
            }
        },

        updateToolbarStatus() {
            const status = state.dom.status;
            if (!status) return;
            status.innerHTML = "";
            if (state.error) {
                status.appendChild(UI.icon("ti ti-alert-circle", { size: "md" }));
                status.appendChild(UI.el("span", { class: "pqueue-toolbar__status-text pqueue-toolbar__status-text--error", text: state.error }));
                return;
            }
            if (state.statusMessage) {
                status.appendChild(UI.icon("ti ti-info-circle", { size: "md" }));
                status.appendChild(UI.el("span", { class: "pqueue-toolbar__status-text", text: state.statusMessage }));
                return;
            }
            if (state.isRefreshing) {
                status.appendChild(UI.icon("ti ti-loader-2", { size: "md", spin: true }));
                status.appendChild(UI.el("span", { class: "pqueue-toolbar__status-text", text: "Syncing…" }));
                return;
            }
            if (state.lastUpdated) {
                status.appendChild(UI.icon("ti ti-history", { size: "md" }));
                status.appendChild(UI.el("span", { class: "pqueue-toolbar__status-text", text: `Updated ${Format.relative(state.lastUpdated)}` }));
            } else {
                status.appendChild(UI.icon("ti ti-bolt", { size: "md" }));
                status.appendChild(UI.el("span", { class: "pqueue-toolbar__status-text", text: "Ready" }));
            }
        },

        ensureGallery() {
            if (UI.galleryOverlay) return;
            const overlay = UI.el("div", { class: "pqueue-gallery-overlay" });
            const box = UI.el("div", { class: "pqueue-gallery" });
            const closeBtn = UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Close" });
            closeBtn.addEventListener("click", UI.closeGallery);
            const img = UI.el("img", { class: "pqueue-gallery__img" });
            const counter = UI.el("div", { class: "pqueue-gallery__counter" });
            const prev = UI.button({ icon: "ti ti-chevron-left", variant: "ghost", subtle: true, title: "Previous" });
            prev.addEventListener("click", () => UI.galleryShow(UI.galleryState.index - 1));
            const next = UI.button({ icon: "ti ti-chevron-right", variant: "ghost", subtle: true, title: "Next" });
            next.addEventListener("click", () => UI.galleryShow(UI.galleryState.index + 1));

            box.appendChild(closeBtn);
            box.appendChild(img);
            box.appendChild(counter);
            box.appendChild(prev);
            box.appendChild(next);
            overlay.appendChild(box);

            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) UI.closeGallery();
            });

            document.body.appendChild(overlay);
            UI.galleryOverlay = overlay;
            UI.galleryImg = img;
            UI.galleryCounter = counter;
            UI.galleryState = { images: [], index: 0, pid: null };
        },

        openGallery(images, startIndex = 0, pid = null) {
            UI.ensureGallery();
            UI.galleryState.images = images || [];
            UI.galleryState.pid = pid;
            UI.galleryState.index = Math.max(0, Math.min(startIndex, UI.galleryState.images.length - 1));
            UI.galleryOverlay.style.display = "flex";
            UI.galleryShow(UI.galleryState.index);
            UI.bindGalleryKeys(true);
        },

        closeGallery() {
            if (UI.galleryOverlay) UI.galleryOverlay.style.display = "none";
            UI.bindGalleryKeys(false);
        },

        galleryShow(index) {
            const images = UI.galleryState.images;
            if (!images.length) return;
            UI.galleryState.index = (index + images.length) % images.length;
            const desc = images[UI.galleryState.index];
            UI.galleryImg.src = UI.buildPreviewUrl(desc, UI.galleryState.pid).href;
            UI.galleryCounter.textContent = `${UI.galleryState.index + 1} / ${images.length}`;
        },

        bindGalleryKeys(enabled) {
            const handler = (e) => {
                if (!UI.galleryOverlay || UI.galleryOverlay.style.display !== "flex") return;
                if (e.key === "Escape") UI.closeGallery();
                else if (e.key === "ArrowRight") UI.galleryShow(UI.galleryState.index + 1);
                else if (e.key === "ArrowLeft") UI.galleryShow(UI.galleryState.index - 1);
            };
            if (enabled) {
                UI.galleryKeyHandler = handler;
                document.addEventListener("keydown", handler);
            } else if (UI.galleryKeyHandler) {
                document.removeEventListener("keydown", UI.galleryKeyHandler);
                UI.galleryKeyHandler = null;
            }
        },

        buildPreviewUrl(imgDesc, pid) {
            const url = new URL("/api/pqueue/preview", window.location.origin);
            url.searchParams.set("filename", imgDesc.filename);
            url.searchParams.set("type", imgDesc.type);
            if (imgDesc.subfolder) url.searchParams.set("subfolder", imgDesc.subfolder);
            url.searchParams.set("preview", "webp;50");
            if (pid) url.searchParams.set("pid", pid);
            return url;
        },

        extractImages(row) {
            try {
                let outputs = row.outputs ?? {};
                if (typeof outputs === "string") {
                    try {
                        outputs = JSON.parse(outputs);
                    } catch (err) {
                        outputs = {};
                    }
                }
                const images = [];
                Object.values(outputs).forEach((value) => {
                    if (value && typeof value === "object") {
                        const list = value.images ?? value.ui?.images ?? [];
                        if (Array.isArray(list)) list.forEach((img) => pushImg(img));
                    } else if (Array.isArray(value)) {
                        value.forEach((img) => pushImg(img));
                    }
                });
                return images;

                function pushImg(img) {
                    if (!img || typeof img !== "object") return;
                    const filename = img.filename ?? img.name;
                    if (!filename) return;
                    images.push({ filename, type: img.type ?? "output", subfolder: img.subfolder ?? "" });
                }
            } catch (err) {
                return [];
            }
        },

        countImages(row) {
            try {
                return UI.extractImages(row).length;
            } catch (err) {
                return 0;
            }
        },

        historyPrimaryFilename(row) {
            try {
                const images = UI.extractImages(row);
                if (images.length && images[0]?.filename) {
                    return images[0].filename;
                }
                if (row.prompt_id) return String(row.prompt_id);
                return "Unnamed output";
            } catch (err) {
                return row.prompt_id ? String(row.prompt_id) : "Unnamed output";
            }
        },

        deriveWorkflowLabel(item, dbRow) {
            try {
                const prompt = item?.[2];
                if (prompt && typeof prompt === "object") {
                    const name = prompt?.workflow?.name || prompt?.workflow?.title || prompt?.name;
                    if (typeof name === "string" && name.trim()) return name.trim();
                }
                if (dbRow?.workflow) {
                    try {
                        const parsed = JSON.parse(dbRow.workflow);
                        const name = parsed?.workflow?.name || parsed?.workflow?.title || parsed?.name;
                        if (typeof name === "string" && name.trim()) return name.trim();
                    } catch (err) { /* ignore */ }
                }
            } catch (err) { /* ignore */ }
            return "Untitled workflow";
        },

        buildWorkflowLabel(pid, item, dbRow) {
            let label = state.workflowNameCache.get(pid);
            if (!label) {
                label = UI.deriveWorkflowLabel(item, dbRow);
                state.workflowNameCache.set(pid, label);
            }
            return UI.el("span", { class: "pqueue-row__label", text: label });
        },

        ensureWorkflowModal() {
            if (UI.workflowOverlay) return;
            const overlay = UI.el("div", { class: "pqueue-modal" });
            const dialog = UI.el("div", { class: "pqueue-modal__dialog" });
            const header = UI.el("header", { class: "pqueue-modal__header" });
            const title = UI.el("h3", { class: "pqueue-modal__title" });
            const subtitle = UI.el("div", { class: "pqueue-modal__subtitle" });
            const copyBtn = UI.button({ icon: "ti ti-copy", text: "Copy JSON", variant: "ghost", subtle: true });
            copyBtn.dataset.action = "workflow-copy";
            const closeBtn = UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Close" });
            closeBtn.addEventListener("click", UI.closeWorkflowModal);
            header.appendChild(title);
            header.appendChild(subtitle);
            header.appendChild(UI.el("div", { class: "pqueue-modal__actions" }, [copyBtn, closeBtn]));
            const body = UI.el("div", { class: "pqueue-modal__body" });
            const code = UI.el("pre", { class: "pqueue-modal__code" });
            body.appendChild(code);
            dialog.appendChild(header);
            dialog.appendChild(body);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) UI.closeWorkflowModal();
            });
            document.body.appendChild(overlay);
            UI.workflowOverlay = overlay;
            UI.workflowDialog = dialog;
            UI.workflowTitle = title;
            UI.workflowSubtitle = subtitle;
            UI.workflowCode = code;
            UI.workflowCopyBtn = copyBtn;
            UI.workflowCopyBtn.addEventListener("click", () => {
                if (UI.workflowCode?.textContent) copyText(UI.workflowCode.textContent);
            });
            UI.workflowKeyHandler = (e) => {
                if (e.key === "Escape") UI.closeWorkflowModal();
            };
            document.addEventListener("keydown", UI.workflowKeyHandler);
        },

        openWorkflowModal({ promptId, workflowText, sourceLabel }) {
            UI.ensureWorkflowModal();
            UI.workflowOverlay.style.display = "flex";
            UI.workflowTitle.textContent = `Workflow for ${promptId}`;
            UI.workflowSubtitle.textContent = sourceLabel ? `Source: ${sourceLabel}` : "";
            UI.workflowCode.textContent = workflowText;
        },

        closeWorkflowModal() {
            if (UI.workflowOverlay) UI.workflowOverlay.style.display = "none";
        },

        card(title, { icon, actions, subtitle, content, classes } = {}) {
            const head = [];
            const titleWrap = UI.el("div", { class: "pqueue-card__title-wrap" });
            if (icon) titleWrap.appendChild(UI.icon(icon, { size: "md" }));
            titleWrap.appendChild(UI.el("h3", { class: "pqueue-card__title", text: title }));
            if (subtitle) titleWrap.appendChild(UI.el("span", { class: "pqueue-card__subtitle", text: subtitle }));
            head.push(titleWrap);
            if (actions && actions.length) head.push(UI.el("div", { class: "pqueue-card__actions" }, actions));

            const body = Array.isArray(content) ? content : [content];
            return UI.el("section", { class: ["pqueue-card", classes].filter(Boolean) }, [UI.el("header", { class: "pqueue-card__header" }, head), UI.el("div", { class: "pqueue-card__body" }, body)]);
        },

        mountFallback() {
            if (document.getElementById("pqueue-fallback-panel")) {
                state.container = document.querySelector("#pqueue-fallback-panel .pqueue-fallback__content");
                return;
            }
            const fab = UI.el("button", { id: "pqueue-fab", class: "pqueue-fab", type: "button" }, [UI.icon("ti ti-history", { size: "md" }), UI.el("span", { class: "pqueue-fab__label", text: "Persistent Queue" })]);
            const panel = UI.el("div", { id: "pqueue-fallback-panel", class: "pqueue-fallback", "data-open": "false" });
            const header = UI.el("header", { class: "pqueue-fallback__header" }, [UI.el("div", { class: "pqueue-fallback__title", text: "Persistent Queue" }), UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Close", onClick: () => panel.setAttribute("data-open", "false") })]);
            const content = UI.el("div", { class: "pqueue-fallback__content" });
            panel.appendChild(header);
            panel.appendChild(content);
            document.body.appendChild(panel);
            document.body.appendChild(fab);
            fab.addEventListener("click", () => {
                const open = panel.getAttribute("data-open") === "true";
                panel.setAttribute("data-open", open ? "false" : "true");
                if (!open) refresh({ skipIfBusy: true });
            });
            state.container = content;
        },

        removeFallback() {
            document.getElementById("pqueue-fab")?.remove();
            document.getElementById("pqueue-fallback-panel")?.remove();
        },
    };

    window.PQueue = window.PQueue || {};
    window.PQueue.UI = UI;
    window.UI = UI;
})();


