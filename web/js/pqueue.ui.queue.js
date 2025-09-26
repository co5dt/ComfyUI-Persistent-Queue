(function () {
    "use strict";

    const state = (window.PQueue && window.PQueue.state) || {};
    const API = (window.PQueue && window.PQueue.API) || window.API;
    const UI = (window.PQueue && window.PQueue.UI) || window.UI;
    const Format = (window.PQueue && window.PQueue.Format) || window.Format;
    const setStatusMessage = (window.PQueue && window.PQueue.setStatusMessage) || window.setStatusMessage;

    UI.renderMetrics = function renderMetrics() {
        const m = state.metrics;
        if (!m) return null;
        const tiles = [
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
        const bodyInner = UI.el("div", { class: "pqueue-metrics" }, tiles);
        const body = UI.el("div", { class: "pqueue-card__body" }, [bodyInner]);
        try {
            body.style.overflow = 'hidden';
            body.style.transition = 'height 120ms ease, opacity 120ms ease';
        } catch (err) { /* noop */ }
        const cardHeader = [];
        cardHeader.push(UI.el("h3", { class: "pqueue-card__title", text: "Queue Metrics" }));
        const toggle = UI.button({ icon: state.uiMetricsCollapsed ? "ti ti-chevron-down" : "ti ti-chevron-up", variant: "ghost", subtle: true, title: state.uiMetricsCollapsed ? "Expand" : "Collapse" });
        toggle.addEventListener("click", () => {
            try {
                const isCollapsed = !!state.uiMetricsCollapsed;
                const iconName = !isCollapsed ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
                const setIcon = (name) => {
                    try { toggle.innerHTML = ''; toggle.appendChild(UI.icon(name)); } catch (err) { /* noop */ }
                };
                if (!isCollapsed) {
                    // collapse
                    const start = body.scrollHeight;
                    body.style.height = `${start}px`;
                    body.style.opacity = '1';
                    requestAnimationFrame(() => {
                        body.style.height = '0px';
                        body.style.opacity = '0';
                    });
                    const onEnd = () => {
                        body.removeEventListener('transitionend', onEnd);
                        setIcon('ti ti-chevron-down');
                        state.uiMetricsCollapsed = true;
                    };
                    body.addEventListener('transitionend', onEnd);
                } else {
                    // expand
                    const target = bodyInner.scrollHeight;
                    body.style.height = '0px';
                    body.style.opacity = '0';
                    requestAnimationFrame(() => {
                        const h = bodyInner.scrollHeight || target;
                        body.style.height = `${h}px`;
                        body.style.opacity = '1';
                    });
                    const onEnd = () => {
                        body.removeEventListener('transitionend', onEnd);
                        try { body.style.height = ''; } catch (err) { /* noop */ }
                        setIcon('ti ti-chevron-up');
                        state.uiMetricsCollapsed = false;
                    };
                    body.addEventListener('transitionend', onEnd);
                }
            } catch (err) { /* noop */ }
        });
        const actions = UI.el("div", { class: "pqueue-card__actions" }, [toggle]);
        const header = UI.el("header", { class: "pqueue-card__header" }, [UI.el("div", { class: "pqueue-card__title-wrap" }, cardHeader), actions]);
        const wrap = UI.el("section", { class: ["pqueue-card"] }, [header]);
        try { wrap.setAttribute('data-collapsed', state.uiMetricsCollapsed ? 'true' : 'false'); } catch (err) { /* noop */ }
        if (state.uiMetricsCollapsed) {
            try { body.style.height = '0px'; body.style.opacity = '0'; } catch (err) { /* noop */ }
        } else {
            try { body.style.height = ''; body.style.opacity = '1'; } catch (err) { /* noop */ }
        }
        wrap.appendChild(body);
        state.dom.metrics = wrap;
        return wrap;
    };

    UI.renderRunning = function renderRunning() {
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
    };

    UI.renderPending = function renderPending() {
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

        // Build collapsible card (mirrors metrics behavior)
        const bodyInner = UI.el("div", { class: "pqueue-pending" }, [filter, wrapper, footer]);
        const body = UI.el("div", { class: "pqueue-card__body" }, [bodyInner]);
        try {
            body.style.overflow = 'hidden';
            body.style.transition = 'height 120ms ease, opacity 120ms ease';
        } catch (err) { /* noop */ }

        const titleWrap = UI.el("div", { class: "pqueue-card__title-wrap" });
        titleWrap.appendChild(UI.icon("ti ti-stack-front", { size: "md" }));
        titleWrap.appendChild(UI.el("h3", { class: "pqueue-card__title", text: "Queue" }));
        const subtitleText = state.metrics.queueCount ? `${state.metrics.queueCount} pending` : null;
        if (subtitleText) titleWrap.appendChild(UI.el("span", { class: "pqueue-card__subtitle", text: subtitleText }));

        const toggle = UI.button({ icon: state.uiQueueCollapsed ? "ti ti-chevron-down" : "ti ti-chevron-up", variant: "ghost", subtle: true, title: state.uiQueueCollapsed ? "Expand" : "Collapse" });
        toggle.addEventListener("click", () => {
            try {
                const isCollapsed = !!state.uiQueueCollapsed;
                const setIcon = (name) => { try { toggle.innerHTML = ''; toggle.appendChild(UI.icon(name)); } catch (err) { /* noop */ } };
                if (!isCollapsed) {
                    const start = body.scrollHeight;
                    body.style.height = `${start}px`;
                    body.style.opacity = '1';
                    requestAnimationFrame(() => {
                        body.style.height = '0px';
                        body.style.opacity = '0';
                    });
                    const onEnd = () => {
                        body.removeEventListener('transitionend', onEnd);
                        setIcon('ti ti-chevron-down');
                        state.uiQueueCollapsed = true;
                        try { wrap.setAttribute('data-collapsed', 'true'); } catch (err) { /* noop */ }
                    };
                    body.addEventListener('transitionend', onEnd);
                } else {
                    const target = bodyInner.scrollHeight;
                    body.style.height = '0px';
                    body.style.opacity = '0';
                    requestAnimationFrame(() => {
                        const h = bodyInner.scrollHeight || target;
                        body.style.height = `${h}px`;
                        body.style.opacity = '1';
                    });
                    const onEnd = () => {
                        body.removeEventListener('transitionend', onEnd);
                        try { body.style.height = ''; } catch (err) { /* noop */ }
                        setIcon('ti ti-chevron-up');
                        state.uiQueueCollapsed = false;
                        try { wrap.setAttribute('data-collapsed', 'false'); } catch (err) { /* noop */ }
                    };
                    body.addEventListener('transitionend', onEnd);
                }
            } catch (err) { /* noop */ }
        });

        const actions = UI.el("div", { class: "pqueue-card__actions" }, [filter, toggle]);
        const header = UI.el("header", { class: "pqueue-card__header" }, [titleWrap, actions]);
        const wrap = UI.el("section", { class: ["pqueue-card", "pqueue-card--queue"] }, [header]);
        try { wrap.setAttribute('data-collapsed', state.uiQueueCollapsed ? 'true' : 'false'); } catch (err) { /* noop */ }
        if (state.uiQueueCollapsed) {
            try { body.style.height = '0px'; body.style.opacity = '0'; } catch (err) { /* noop */ }
        } else {
            try { body.style.height = ''; body.style.opacity = '1'; } catch (err) { /* noop */ }
        }
        wrap.appendChild(body);
        state.dom.pendingCard = wrap;
        return wrap;
    };

    UI.pendingRow = function pendingRow(item) {
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
    };

    UI.updateMetrics = function updateMetrics() {
        try {
            const old = state.dom.metrics;
            const newMetrics = UI.renderMetrics();
            if (!newMetrics) return;
            if (old && old.parentNode) {
                old.parentNode.replaceChild(newMetrics, old);
                state.dom.metrics = newMetrics;
            }
        } catch (err) { /* noop */ }
    };

    UI.updateRunningSection = function updateRunningSection() {
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
    };

    UI.updatePendingSection = function updatePendingSection() {
        try {
            UI.withStableAnchor(() => {
                const card = state.dom.pendingCard;
                if (!card) return;
                const subtitle = card.querySelector('.pqueue-card__subtitle');
                if (subtitle) subtitle.textContent = state.metrics.queueCount ? `${state.metrics.queueCount} pending` : '';
                const table = state.dom.pendingTable;
                if (!table) return;
				Array.from(table.querySelectorAll('.pqueue-row[data-id]')).forEach((n) => n.remove());
				try { Array.from(table.querySelectorAll('.pqueue-empty')).forEach((n) => n.remove()); } catch (err) { /* noop */ }
                const rows = state.queue_pending.map(UI.pendingRow).filter(Boolean);
                const header = table.querySelector('.pqueue-list__header');
                const frag = document.createDocumentFragment();
                rows.forEach((r) => frag.appendChild(r));
                if (header && header.nextSibling) {
                    table.insertBefore(frag, header.nextSibling);
                } else {
                    table.appendChild(frag);
                }
				if (!rows.length) {
					const empty = UI.emptyState({
						icon: 'ti ti-stack-2',
						title: 'Queue empty',
						description: 'Enqueue prompts in ComfyUI to populate the persistent queue.',
					});
					if (header && header.nextSibling) table.insertBefore(empty, header.nextSibling);
					else table.appendChild(empty);
				}
                UI.refreshFilter();
                UI.updateSelectionUI();
                UI.updatePendingFooter(Array.from(table.querySelectorAll('.pqueue-row[data-id]')).filter((r) => r.style.display !== 'none').length);
            });
        } catch (err) { /* noop */ }
    };

    UI.updateProgressBars = function updateProgressBars() {
        if (!state.dom.root) return;
        Object.entries(state.running_progress).forEach(([pid, frac]) => {
            const bar = state.dom.root.querySelector(`.pqueue-item[data-id="${pid}"] .pqueue-progress-bar`);
            if (bar) bar.style.width = `${(Number(frac) * 100).toFixed(1)}%`;
        });
    };

    UI.refreshFilter = function refreshFilter() {
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
    };

    UI.updatePendingFooter = function updatePendingFooter(visibleCount) {
        if (state.dom.pendingCount) state.dom.pendingCount.textContent = `${visibleCount} row${visibleCount === 1 ? "" : "s"}`;
        if (state.dom.pendingUpdated) state.dom.pendingUpdated.textContent = state.lastUpdated ? `Updated ${Format.relative(state.lastUpdated)}` : "Awaiting update";
    };

    UI.updateSelectionUI = function updateSelectionUI() {
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
        // Update toolbar controls to refresh execute selected button
        UI.updateToolbarControls();
    };
})();




