// Production-grade frontend for ComfyUI Persistent Queue
// Served automatically at /extensions/ComfyUI-PersistentQueue/pqueue.js

(function () {
    "use strict";

    const API = {
        getQueue: () => fetch("/api/pqueue").then((r) => r.json()),
        getHistory: (limit = 50) => fetch(`/api/pqueue/history?limit=${limit}`).then((r) => r.json()),
        pause: () => fetch("/api/pqueue/pause", { method: "POST" }),
        resume: () => fetch("/api/pqueue/resume", { method: "POST" }),
        reorder: (order) =>
            fetch("/api/pqueue/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order }),
            }),
        setPriority: (prompt_id, priority) =>
            fetch("/api/pqueue/priority", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_id, priority }),
            }),
        del: (prompt_ids) =>
            fetch("/api/pqueue/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_ids }),
            }),
    };

    const state = {
        paused: false,
        queue_running: [],
        queue_pending: [],
        db_pending: [],
        history: [],
        running_progress: {},
        workflowCache: new Map(),
        durationByWorkflow: new Map(),
        dbIndex: new Map(),
        workflowNameCache: new Map(),
        selectedPending: new Set(),
        filters: {
            pending: "",
        },
        metrics: {
            runningCount: 0,
            queueCount: 0,
            persistedCount: 0,
            historyCount: 0,
            successRate: null,
            avgDuration: null,
            failureCount: 0,
            lastFailure: null,
        },
        isRefreshing: false,
        lastUpdated: null,
        error: null,
        statusMessage: null,
        statusTimer: null,
        container: null,
        dom: {},
    };

    let pollIntervalId = null;
    let focusListener = null;
    let dragRow = null;
    let dropHover = null;

    const Progress = {
        computeAggregate(nodes) {
            let totalMax = 0;
            let totalVal = 0;
            Object.values(nodes ?? {}).forEach((st) => {
                const max = Math.max(1, Number(st?.max ?? 1));
                const val = Math.max(0, Math.min(Number(st?.value ?? 0), max));
                totalMax += max;
                totalVal += val;
            });
            if (!totalMax) return 0;
            return Math.max(0, Math.min(1, totalVal / totalMax));
        },
    };

    const Format = {
        relative(iso) {
            if (!iso) return "";
            const date = new Date(iso);
            if (!isFinite(date.getTime())) return "";
            const diff = date.getTime() - Date.now();
            const abs = Math.abs(diff);
            const units = [
                { limit: 45 * 1000, div: 1000, unit: "second" },
                { limit: 45 * 60 * 1000, div: 60 * 1000, unit: "minute" },
                { limit: 22 * 60 * 60 * 1000, div: 60 * 60 * 1000, unit: "hour" },
                { limit: 26 * 24 * 60 * 60 * 1000, div: 24 * 60 * 60 * 1000, unit: "day" },
                { limit: 11 * 30 * 24 * 60 * 60 * 1000, div: 30 * 24 * 60 * 60 * 1000, unit: "month" },
            ];
            let value = diff;
            let unit = "year";
            for (const u of units) {
                if (abs < u.limit) {
                    value = diff / u.div;
                    unit = u.unit;
                    break;
                }
            }
            if (unit === "year") value = diff / (365 * 24 * 60 * 60 * 1000);
            value = Math.round(value);
            if (typeof Intl !== "undefined" && Intl.RelativeTimeFormat) {
                const rtf = Format._rtf || (Format._rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }));
                return rtf.format(value, unit);
            }
            const suffix = value === 0 ? "now" : value < 0 ? "ago" : "from now";
            return `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? "" : "s"} ${suffix}`;
        },

        datetime(iso) {
            if (!iso) return "";
            const d = new Date(iso);
            if (!isFinite(d.getTime())) return "";
            return d.toLocaleString();
        },

        duration(seconds) {
            if (!isFinite(seconds) || seconds <= 0) return "";
            const sec = Math.round(seconds);
            if (sec < 60) return `${sec}s`;
            const minutes = Math.floor(sec / 60);
            const remSec = sec % 60;
            if (minutes < 60) return remSec ? `${minutes}m ${remSec}s` : `${minutes}m`;
            const hours = Math.floor(minutes / 60);
            const remMin = minutes % 60;
            if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            return remHours ? `${days}d ${remHours}h` : `${days}d`;
        },

        percent(frac) {
            const n = Number(frac);
            if (!isFinite(n) || n < 0) return "0%";
            return `${Math.min(100, Math.max(0, n * 100)).toFixed(0)}%`;
        },

        statusLabel(status) {
            const s = String(status || "").toLowerCase();
            if (["success", "completed", "done"].includes(s)) return "Success";
            if (["running", "executing", "in-progress"].includes(s)) return "Running";
            if (["failed", "error", "failure"].includes(s)) return "Failed";
            if (["cancelled", "canceled", "interrupted", "stopped"].includes(s)) return "Interrupted";
            if (["pending", "queued", "waiting"].includes(s)) return "Pending";
            return status || "Unknown";
        },

        tooltip(row) {
            if (!row) return "";
            const lines = [];
            if (row.prompt_id) lines.push(`Prompt ID: ${row.prompt_id}`);
            if (row.created_at) lines.push(`Created: ${Format.datetime(row.created_at)}`);
            if (row.completed_at) lines.push(`Completed: ${Format.datetime(row.completed_at)}`);
            if (row.status) lines.push(`Status: ${Format.statusLabel(row.status)}`);
            if (row.duration_seconds) lines.push(`Duration: ${Format.duration(Number(row.duration_seconds))}`);
            if (row.error) lines.push(`Error: ${row.error}`);
            return lines.join("\n");
        },
    };

    function setStatusMessage(message, duration = 2500) {
        if (state.statusTimer) {
            clearTimeout(state.statusTimer);
            state.statusTimer = null;
        }
        state.statusMessage = message || null;
        UI.updateToolbarStatus();
        if (message && duration > 0) {
            state.statusTimer = window.setTimeout(() => {
                state.statusMessage = null;
                state.statusTimer = null;
                UI.updateToolbarStatus();
            }, duration);
        }
    }

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
            if (name) classes.push(name);
            if (spin) classes.push("pqueue-icon--spin");
            if (size) classes.push(`pqueue-icon--${size}`);
            return UI.el("span", { class: classes });
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

        metricTile({ icon, label, value, caption, variant }) {
            const card = UI.el("article", { class: ["pqueue-metric", variant ? `pqueue-metric--${variant}` : null] });
            const header = UI.el("div", { class: "pqueue-metric__header" }, [UI.icon(icon, { size: "md" }), UI.el("span", { class: "pqueue-metric__label", text: label })]);
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
                link.href = "https://unpkg.com/@tabler/icons-webfont@latest/tabler-icons.min.css";
                link.crossOrigin = "anonymous";
                link.dataset.pqueueIcons = "true";
                document.head.appendChild(link);
            }
        },

        render() {
            if (!state.container) return;
            UI.ensureAssets();

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
            const clearBtn = UI.button({
                id: "pqueue-clear",
                icon: "ti ti-player-stop",
                ariaLabel: "Clear pending",
                title: "Clear pending jobs",
                variant: "danger",
                subtle: true,
            });
            const refreshBtn = UI.button({ id: "pqueue-refresh", icon: "ti ti-refresh", ariaLabel: "Refresh", title: "Refresh", variant: "ghost", subtle: true });

            const filter = UI.el("input", {
                id: "pqueue-filter",
                class: "pqueue-input",
                type: "search",
                placeholder: "Filter pending by prompt, status, error…",
                value: state.filters.pending,
                spellcheck: "false",
            });

            const summary = UI.el("div", { class: "pqueue-toolbar__summary" }, [
                UI.el("span", { class: "pqueue-summary__item", text: `${state.metrics.queueCount} in queue` }),
                UI.el("span", { class: "pqueue-summary__item", text: `${state.metrics.runningCount} running` }),
                UI.el("span", { class: "pqueue-summary__item", text: `${state.metrics.historyCount} recent` }),
            ]);

            const status = UI.el("div", { class: "pqueue-toolbar__status" });

            state.dom.filterInput = filter;
            state.dom.status = status;

            return UI.el("div", { class: "pqueue-toolbar" }, [
                UI.el("div", { class: "pqueue-toolbar__row" }, [
                    UI.el("div", { class: "pqueue-toolbar__group" }, [pauseBtn, clearBtn, refreshBtn]),
                    status,
                ]),
                UI.el("div", { class: "pqueue-toolbar__row pqueue-toolbar__row--secondary" }, [filter, summary]),
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
            ];
            const wrap = UI.el("div", { class: "pqueue-metrics" }, tiles);
            state.dom.metrics = wrap;
            return wrap;
        },

        renderRunning() {
            const rows = [];
            if (!state.queue_running.length) {
                rows.push(UI.emptyState({
                    icon: "ti ti-player-play",
                    title: "No running jobs",
                    description: "Prompts start running after the queue resumes",
                }));
            } else {
                state.queue_running.forEach((item, index) => {
                    const pid = item[1];
                    const fraction = Math.max(0, Math.min(1, Number(state.running_progress?.[pid]) || 0));
                    const meta = UI.el("div", { class: "pqueue-item__meta" }, [
                        UI.icon("ti ti-loader-2", { spin: true }),
                        UI.el("span", { class: "pqueue-chip pqueue-chip--primary", text: `#${index + 1}` }),
                        UI.el("span", { class: "pqueue-code", text: pid }),
                        UI.el("span", { class: "pqueue-progress__label", text: Format.percent(fraction) }),
                    ]);
                    const bar = UI.el("div", { class: "pqueue-progress-bar" });
                    bar.style.width = `${(fraction * 100).toFixed(1)}%`;
                    const progress = UI.el("div", { class: "pqueue-progress" }, [UI.el("div", { class: "pqueue-progress__track" }, [bar])]);
                    rows.push(UI.el("div", { class: "pqueue-item pqueue-item--running", "data-id": pid }, [meta, progress]));
                });
            }
            return UI.card("Currently running", {
                icon: "ti ti-activity-heartbeat",
                subtitle: state.metrics.runningCount ? `${state.metrics.runningCount} active` : null,
                content: rows,
            });
        },

        renderPending() {
            const wrapper = UI.el("div", { class: "pqueue-table-wrapper" });
            const list = UI.el("div", { class: "pqueue-list", id: "pqueue-pending" });
            state.dom.pendingTable = list;

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

            return UI.card("Queue", {
                icon: "ti ti-stack-front",
                subtitle: state.metrics.queueCount ? `${state.metrics.queueCount} pending` : null,
                content: [wrapper, footer],
            });
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
            return UI.card("Recent history", {
                icon: "ti ti-clock-bolt",
                subtitle: state.metrics.historyCount ? `${state.metrics.historyCount} entries` : null,
                content: grid,
            });
        },

        historyCard(row) {
            const card = UI.el("article", { class: "pqueue-history-card", title: Format.tooltip(row) });
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
                const img = UI.el("img", { class: "pqueue-thumb", src: url.href, title: `history-${row.id}` });
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
                    const img = UI.el("img", { class: "pqueue-thumb", src: url.href, title: first.filename });
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
                } catch (err) {
                    /* ignore */
                }
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
                    } catch (err) {
                        /* ignore */
                    }
                }
            } catch (err) {
                /* ignore */
            }
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

    const Events = {
        bind() {
            document.getElementById("pqueue-toggle")?.addEventListener("click", Events.togglePause);
            document.getElementById("pqueue-clear")?.addEventListener("click", Events.clearPending);
            document.getElementById("pqueue-refresh")?.addEventListener("click", Events.manualRefresh);
            state.dom.filterInput?.addEventListener("input", Events.handleFilter);
            state.dom.deleteSelectedBtn?.addEventListener("click", Events.deleteSelected);
            state.dom.pendingTable?.querySelector(".pqueue-select-all")?.addEventListener("change", Events.toggleSelectAll);

            const table = state.dom.pendingTable;
            if (table) {
                table.addEventListener("dragstart", Events.handleDragStart);
                table.addEventListener("dragover", Events.handleDragOver);
                table.addEventListener("dragleave", Events.handleDragLeave);
                table.addEventListener("drop", Events.handleDrop);
                table.addEventListener("dragend", Events.handleDragEnd);
                table.addEventListener("change", Events.handleTableChange);
                table.addEventListener("click", Events.handleTableClick);
                table.addEventListener("keydown", Events.handleTableKey);
            }
        },

        async togglePause() {
            try {
                if (state.paused) await API.resume();
                else await API.pause();
                setStatusMessage(state.paused ? "Resuming queue…" : "Pausing queue…");
            await refresh();
            } catch (err) {
                console.error("pqueue: toggle pause failed", err);
                state.error = err?.message || "Failed to toggle queue";
                UI.updateToolbarStatus();
            }
        },

        async clearPending() {
            if (!state.queue_pending.length) {
                setStatusMessage("Queue already empty");
                return;
            }
            if (!window.confirm(`Remove ${state.queue_pending.length} pending prompt${state.queue_pending.length === 1 ? "" : "s"}?`)) return;
            try {
                const ids = state.queue_pending.map((item) => item[1]).filter(Boolean);
                await API.del(ids);
                setStatusMessage(`Cleared ${ids.length} prompt${ids.length === 1 ? "" : "s"}`);
                await refresh();
            } catch (err) {
                console.error("pqueue: clear failed", err);
                state.error = err?.message || "Failed to clear queue";
                UI.updateToolbarStatus();
            }
        },

        manualRefresh() {
            if (state.isRefreshing) return;
            refresh();
        },

        handleFilter(event) {
            state.filters.pending = event.target.value;
            UI.refreshFilter();
            UI.updateSelectionUI();
        },

        toggleSelectAll(event) {
            const checked = event.target.checked;
            const rows = Array.from(state.dom.pendingTable.querySelectorAll(".pqueue-row[data-id]"));
            rows.forEach((row) => {
                if (row.style.display === "none") return;
                if (checked) state.selectedPending.add(row.dataset.id);
                else state.selectedPending.delete(row.dataset.id);
            });
            UI.updateSelectionUI();
        },

        handleTableChange(event) {
            if (!event.target.classList.contains("pqueue-select")) return;
            const row = event.target.closest(".pqueue-row[data-id]");
            if (!row) return;
            const id = row.dataset.id;
            if (event.target.checked) state.selectedPending.add(id);
            else state.selectedPending.delete(id);
            UI.updateSelectionUI();
        },

        handleTableClick(event) {
            const btn = event.target.closest("button[data-action]");
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === "delete") Events.deleteSingle(id);
            else if (action === "move-top") Events.moveSingle(id, "top");
            else if (action === "move-bottom") Events.moveSingle(id, "bottom");
        },

        handleTableKey() {},

        handleDragStart(event) {
            const row = event.target.closest(".pqueue-row[data-id]");
            if (!row) return;
            dragRow = row;
            row.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", row.dataset.id);
        },

        handleDragOver(event) {
            if (!dragRow) return;
            const target = event.target.closest(".pqueue-row[data-id]");
            if (!target || target === dragRow) return;
            event.preventDefault();
            if (dropHover && dropHover !== target) dropHover.classList.remove("pqueue-row--before", "pqueue-row--after");
                const rect = target.getBoundingClientRect();
            const before = event.clientY - rect.top < rect.height / 2;
            target.classList.toggle("pqueue-row--before", before);
            target.classList.toggle("pqueue-row--after", !before);
            dropHover = target;
        },

        handleDragLeave(event) {
            const target = event.target.closest(".pqueue-row[data-id]");
            if (target && target !== dragRow) target.classList.remove("pqueue-row--before", "pqueue-row--after");
        },

        async handleDrop(event) {
            if (!dragRow) return;
            event.preventDefault();
            const table = state.dom.pendingTable;
            const target = event.target.closest(".pqueue-row[data-id]");
            if (!table || !target || target === dragRow) return;
            const rect = target.getBoundingClientRect();
            const before = event.clientY - rect.top < rect.height / 2;
            target.classList.remove("pqueue-row--before", "pqueue-row--after");
            table.insertBefore(dragRow, before ? target : target.nextSibling);
            const order = Array.from(table.querySelectorAll(".pqueue-row[data-id]"))
                .filter((row) => row.style.display !== "none")
                .map((row) => row.dataset.id);
            try {
                await API.reorder(order);
                setStatusMessage("Queue reordered");
                await refresh({ skipIfBusy: true });
            } catch (err) {
                console.error("pqueue: reorder failed", err);
                state.error = err?.message || "Failed to reorder queue";
                UI.updateToolbarStatus();
            }
        },

        handleDragEnd() {
            if (dropHover) dropHover.classList.remove("pqueue-row--before", "pqueue-row--after");
            dropHover = null;
            if (dragRow) {
                dragRow.classList.remove("is-dragging");
                dragRow = null;
            }
        },

        async savePriority() {},

        async deleteSingle(id) {
            if (!id) return;
            if (!window.confirm(`Delete prompt ${id}?`)) return;
            try {
                await API.del([id]);
                state.selectedPending.delete(id);
                setStatusMessage(`Deleted ${id}`);
                await refresh({ skipIfBusy: true });
            } catch (err) {
                console.error("pqueue: delete failed", err);
                state.error = err?.message || "Failed to delete prompt";
                UI.updateToolbarStatus();
            }
        },

        async bulkPriority() {},
        async moveSingle(id, where) {
            try {
                const table = state.dom.pendingTable;
                if (!table) return;
                const ids = Array.from(table.querySelectorAll('.pqueue-row[data-id]')).map((r) => r.dataset.id);
                const currentIndex = ids.indexOf(id);
                if (currentIndex === -1) return;
                ids.splice(currentIndex, 1);
                if (where === 'top') ids.unshift(id);
                else ids.push(id);
                await API.reorder(ids);
                setStatusMessage(where === 'top' ? 'Moved to top' : 'Moved to bottom');
                await refresh({ skipIfBusy: true });
            } catch (err) {
                console.error('pqueue: move failed', err);
                state.error = err?.message || 'Failed to move prompt';
                UI.updateToolbarStatus();
            }
        },

        async deleteSelected() {
            if (!state.selectedPending.size) return;
            if (!window.confirm(`Delete ${state.selectedPending.size} selected prompt${state.selectedPending.size === 1 ? "" : "s"}?`)) return;
            try {
                await API.del(Array.from(state.selectedPending));
                state.selectedPending.clear();
                setStatusMessage("Deleted selected prompts");
                await refresh({ skipIfBusy: true });
            } catch (err) {
                console.error("pqueue: bulk delete failed", err);
                state.error = err?.message || "Failed to delete prompts";
                UI.updateToolbarStatus();
            }
        },

        viewWorkflow(id) {
            const info = lookupWorkflow(id);
            if (!info) {
                setStatusMessage("Workflow not available", 3000);
                return;
            }
            const text = typeof info.workflow === "string" ? info.workflow : JSON.stringify(info.workflow, null, 2);
            UI.openWorkflowModal({ promptId: id, workflowText: text, sourceLabel: info.source });
        },
    };

    async function refresh({ skipIfBusy } = {}) {
        if (state.isRefreshing && skipIfBusy) return;
        state.isRefreshing = true;
        UI.updateToolbarStatus();
        try {
            const [queue, history] = await Promise.all([API.getQueue(), API.getHistory(50)]);
            state.paused = !!queue.paused;
            state.queue_running = queue.queue_running || [];
            state.queue_pending = queue.queue_pending || [];
            state.db_pending = queue.db_pending || [];
            state.running_progress = queue.running_progress || {};
            state.history = history.history || [];
            state.error = null;

            const index = new Map();
            state.db_pending.forEach((row) => {
                if (row?.prompt_id) index.set(String(row.prompt_id), row);
            });
            state.dbIndex = index;

            state.workflowCache = new Map();
            state.workflowNameCache = new Map();
            state.queue_pending.forEach((item) => {
                const pid = String(item[1] ?? "");
                try {
                    const wf = item[2];
                    if (wf !== undefined) {
                        const key = typeof wf === "string" ? wf : JSON.stringify(wf);
                        if (key) state.workflowCache.set(pid, key);
                    }
                    const label = UI.deriveWorkflowLabel(item, index.get(pid));
                    if (label) state.workflowNameCache.set(pid, label);
                } catch (err) {
                    /* noop */
                }
            });

            deriveMetrics();

            const visibleIds = new Set(state.queue_pending.map((item) => String(item[1] ?? "")));
            state.selectedPending.forEach((id) => {
                if (!visibleIds.has(id)) state.selectedPending.delete(id);
            });

            state.lastUpdated = new Date().toISOString();
        } catch (err) {
            console.error("pqueue: refresh failed", err);
            state.error = err?.message || "Failed to load persistent queue";
        } finally {
            state.isRefreshing = false;
            UI.render();
        }
    }

    function deriveMetrics() {
        const metrics = {
            runningCount: state.queue_running.length,
            queueCount: state.queue_pending.length,
            persistedCount: state.db_pending.length,
            historyCount: state.history.length,
            successRate: null,
            avgDuration: null,
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
    }

    function lookupWorkflow(promptId) {
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
                    state.running_progress[payload.prompt_id] = Progress.computeAggregate(payload.nodes);
                    UI.updateProgressBars();
                } catch (err) {
                    /* noop */
                }
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
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
            if (focusListener) {
                window.removeEventListener("focus", focusListener);
                focusListener = null;
            }
        } catch (err) {
            /* ignore */
        }
    }

    function startPolling() {
        stopPolling();
        focusListener = () => refresh({ skipIfBusy: true });
        window.addEventListener("focus", focusListener);
        pollIntervalId = window.setInterval(() => refresh({ skipIfBusy: true }), 3000);
    }

    function copyText(text) {
        navigator.clipboard?.writeText(text).then(
            () => setStatusMessage("Workflow copied to clipboard"),
            () => fallbackCopy(text)
        );

        function fallbackCopy(value) {
            try {
                const textarea = document.createElement("textarea");
                textarea.value = value;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
                setStatusMessage("Workflow copied to clipboard");
            } catch (err) {
                console.error("pqueue: fallback copy failed", err);
                setStatusMessage("Copy failed", 4000);
            }
        }
    }

    function initialize() {
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
            icon: "ti ti-history",
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
                    return true;
                }
            } catch (err) {
                console.error("pqueue: sidebar registration failed", err);
            }
            return false;
        };

        const init = () => {
            if (registerSidebar()) return;
            UI.mountFallback();
            finalize(state.container);
            let retries = 50;
            const intervalId = window.setInterval(() => {
                if (registerSidebar() || --retries <= 0) window.clearInterval(intervalId);
            }, 200);
        };

        const extension = {
            name: "ComfyUI-PersistentQueue",
            setup: () => init(),
        };

        if (window.app?.registerExtension) {
            window.app.registerExtension(extension);
        } else if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    initialize();
})();


