// Production-grade frontend for ComfyUI Persistent Queue
// Served automatically at /extensions/ComfyUI-PersistentQueue/pqueue.js

(function () {
    "use strict";

    const API = {
        getQueue: () => fetch("/api/pqueue").then((r) => r.json()),
        getHistory: (limit = 50) => fetch(`/api/pqueue/history?limit=${limit}`).then((r) => r.json()),
        getHistoryPaginated: (params = {}) => {
            const url = new URL("/api/pqueue/history", window.location.origin);
            Object.entries(params).forEach(([k, v]) => {
                if (v === undefined || v === null || v === "") return;
                url.searchParams.set(k, String(v));
            });
            return fetch(url.href).then((r) => r.json());
        },
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
        rename: (prompt_id, name) =>
            fetch("/api/pqueue/rename", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_id, name }),
            }),
    };

    const Icons = {
        _ns: "http://www.w3.org/2000/svg",
        _svg(attrs = {}) {
            const svg = document.createElementNS(Icons._ns, "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "1em");
            svg.setAttribute("height", "1em");
            svg.setAttribute("aria-hidden", "true");
            Object.entries(attrs).forEach(([k, v]) => svg.setAttribute(k, v));
            return svg;
        },
        _path(d, attrs = {}) {
            const p = document.createElementNS(Icons._ns, "path");
            p.setAttribute("d", d);
            Object.entries(attrs).forEach(([k, v]) => p.setAttribute(k, v));
            return p;
        },
        _strokeSvg(paths) {
            const svg = Icons._svg({ fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" });
            paths.forEach((d) => svg.appendChild(Icons._path(d)));
            return svg;
        },
        _filledSvg(paths) {
            const svg = Icons._svg({ fill: "currentColor" });
            paths.forEach((d) => svg.appendChild(Icons._path(d)));
            return svg;
        },
        resolve(name) {
            const base = String(name || "").trim();
            const key = base.split(/\s+/).pop().replace(/^ti-/, "");
            switch (key) {
                case "player-play":
                    return Icons._strokeSvg(["M8 5v14l11-7z"]);
                case "player-play-filled":
                    return Icons._filledSvg(["M8 5v14l11-7z"]);
                case "player-pause":
                case "player-pause-filled":
                    return Icons._filledSvg(["M6 5h4v14H6z", "M14 5h4v14h-4z"]);
                case "player-stop":
                    return Icons._filledSvg(["M6 6h12v12H6z"]);
                case "refresh":
                    return Icons._strokeSvg(["M20 11a8 8 0 1 0-2.36 5.65M20 11v-5M20 11h-5"]);
                case "trash":
                    return Icons._strokeSvg(["M4 7h16", "M7 7v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7", "M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"]);
                case "drag-drop":
                    return Icons._strokeSvg(["M7 6h.01","M12 6h.01","M17 6h.01","M7 12h.01","M12 12h.01","M17 12h.01","M7 18h.01","M12 18h.01","M17 18h.01"]);
                case "arrow-bar-to-up":
                    return Icons._strokeSvg(["M12 4v10","M8 8l4-4 4 4","M4 20h16"]);
                case "arrow-bar-to-down":
                    return Icons._strokeSvg(["M12 20V10","M8 16l4 4 4-4","M4 4h16"]);
                case "loader-2":
                    return Icons._strokeSvg(["M12 3a9 9 0 1 0 9 9"]);
                case "circle-check":
                    return Icons._strokeSvg(["M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0","M9 12l2 2 4-4"]);
                case "alert-triangle":
                    return Icons._strokeSvg(["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z","M12 9v4","M12 17h.01"]);
                case "clock-hour-3":
                    return Icons._strokeSvg(["M12 7v5l4 2","M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"]);
                case "circle-dashed":
                    return Icons._strokeSvg(["M12 3a9 9 0 0 1 9 9","M21 12a9 9 0 0 1-9 9","M12 21a9 9 0 0 1-9-9","M3 12a9 9 0 0 1 9-9"]);
                case "x":
                    return Icons._strokeSvg(["M6 6l12 12","M6 18L18 6"]);
                case "chevron-left":
                    return Icons._strokeSvg(["M15 6l-6 6 6 6"]);
                case "chevron-right":
                    return Icons._strokeSvg(["M9 6l6 6-6 6"]);
                case "copy":
                    return Icons._strokeSvg(["M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z","M4 16V6a2 2 0 0 1 2-2h8"]);
                case "history":
                    return Icons._strokeSvg(["M3 13a9 9 0 1 0 3-7","M3 13H7","M12 7v6l4 2"]);
                case "activity-heartbeat":
                    return Icons._strokeSvg(["M3 12h4l2-3 3 6 2-3h5"]);
                case "stack-front":
                case "stack-2":
                    return Icons._strokeSvg(["M12 4l8 4-8 4-8-4 8-4z","M4 12l8 4 8-4","M4 16l8 4 8-4"]);
                case "bolt":
                    return Icons._strokeSvg(["M13 3L4 14h7l-1 7 9-11h-7z"]);
                case "info-circle":
                    return Icons._strokeSvg(["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M12 8h.01","M11 12h2v6h-2z"]);
                default:
                    return null;
            }
        }
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
            historySince: "",
            historyUntil: "",
            historySinceTime: "",
            historyUntilTime: "",
        },
        historyIds: new Set(),
        historyPaging: {
            isLoading: false,
            hasMore: true,
            nextCursor: null,
            params: { sort_by: "id", sort_dir: "desc", limit: 60 },
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
                link.href = "/extensions/ComfyUI-PersistentQueue/lib/tabler-icons.min.css";
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
            const base = state.metrics.historyCount ? `${state.metrics.historyCount} entries` : null;
            const range = UI.currentHistoryRangeLabel();
            const subtitle = [base, range].filter(Boolean).join(' • ');
            const card = UI.card("Recent history", {
                icon: "ti ti-clock-bolt",
                subtitle,
                actions: UI.historyFilters(),
                content: grid,
            });
            state.dom.historyCard = card;
            state.dom.historySubtitle = card.querySelector('.pqueue-card__subtitle');
            return card;
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
                const base = state.metrics?.historyCount ? `${state.metrics.historyCount} entries` : null;
                const range = UI.currentHistoryRangeLabel();
                const text = [base, range].filter(Boolean).join(' • ');
                el.textContent = text;
            } catch (err) {
                /* noop */
            }
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
            } catch (err) {
                /* noop */
            }
        },

        historySentinel() {
            const wrap = UI.el("div", { class: "pqueue-history-sentinel" });
            const spinner = UI.icon("ti ti-loader-2", { size: "md", spin: true });
            wrap.appendChild(spinner);
            return wrap;
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
                const img = UI.el("img", { class: "pqueue-thumb", src: url.href, title: `history-${row.id}`, loading: "lazy" });
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
                    const img = UI.el("img", { class: "pqueue-thumb", src: url.href, title: first.filename, loading: "lazy" });
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

                // Initialize cursor from currently loaded list if not set
                if (!state.historyPaging?.nextCursor && state.history?.length) {
                    const last = state.history[state.history.length - 1];
                    state.historyPaging.nextCursor = { id: last?.id, value: last?.id };
                    state.historyPaging.hasMore = true;
                }

                const obs = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;
                        Events.loadMoreHistory();
                    });
                }, { root: null, rootMargin: '600px 0px', threshold: 0 });
                obs.observe(sentinel);
                state.historyObserver = obs;
            } catch (err) {
                /* noop */
            }
        },

        buildFiltersPopover(anchor) {
            const since = UI.el("input", { type: "date", class: "pqueue-input", value: state.filters?.historySince || "", id: "pqueue-since-date" });
            const sinceTime = UI.el("input", { type: "time", class: "pqueue-input", value: state.filters?.historySinceTime || "", id: "pqueue-since-time", step: "1" });
            const until = UI.el("input", { type: "date", class: "pqueue-input", value: state.filters?.historyUntil || "", id: "pqueue-until-date" });
            const untilTime = UI.el("input", { type: "time", class: "pqueue-input", value: state.filters?.historyUntilTime || "", id: "pqueue-until-time", step: "1" });
            const onChange = () => Events.updateHistoryDateFilters(since.value, until.value, sinceTime.value, untilTime.value);
            [since, sinceTime, until, untilTime].forEach((el) => el.addEventListener("change", onChange));

            // store DOM refs so presets can reflect UI immediately
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
                UI.button({ icon: 'ti ti-x', variant: 'ghost', subtle: true, title: 'Close', onClick: () => { pop?.remove(); state.dom.filtersPopover = null; } })
            ]);

            const footer = UI.el('div', { class: 'pqueue-popover__footer' }, [
                UI.el('div', { class: 'pqueue-popover__footer-left' }, [UI.el('span', { class: 'pqueue-muted', text: UI.currentHistoryRangeLabel() })]),
                UI.el('div', { class: 'pqueue-popover__footer-right' }, [
                    UI.button({ text: 'Clear', variant: 'ghost', subtle: true, size: 'sm', onClick: () => Events.applyHistoryPreset('clear') }),
                    UI.button({ text: 'Done', variant: 'secondary', size: 'sm', onClick: () => { pop?.remove(); state.dom.filtersPopover = null; } })
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

            // keyboard handling: Esc closes; Tab traps within
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

            // Position near anchor and align arrow
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

            // focus first input
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
            UI.ensureHistoryObserver();
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
            // Reset history paging on manual refresh
            state.history = [];
            state.historyIds = new Set();
            // Preserve current date filters when resetting paging
            const pad = (n) => String(n).padStart(2, '0');
            const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
            const buildParams = () => {
                const params = { sort_by: "id", sort_dir: "desc", limit: 60 };
                const s = state.filters?.historySince;
                const u = state.filters?.historyUntil;
                if (s) {
                    const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
                    const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
                    params.since = fmt(start);
                }
                if (u) {
                    const [y, m, d] = u.split('-').map((x) => parseInt(x, 10));
                    const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
                    params.until = fmt(end);
                }
                return params;
            };
            state.historyPaging = { isLoading: false, hasMore: true, nextCursor: null, params: buildParams() };
            refresh();
            UI.updateHistorySubtitle();
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

        async loadMoreHistory() {
            try {
                const paging = state.historyPaging;
                if (!paging || paging.isLoading || !paging.hasMore) return;
                paging.isLoading = true;

                const params = { ...paging.params };
                if (paging.nextCursor?.id != null) params.cursor_id = paging.nextCursor.id;
                if (paging.nextCursor?.value != null) params.cursor_value = paging.nextCursor.value;

                const result = await API.getHistoryPaginated(params);
                const list = Array.isArray(result?.history) ? result.history : [];
                const grid = state.dom.historyGrid;
                const sentinel = state.dom.historySentinel;
                if (grid && sentinel && list.length) {
                    const frag = document.createDocumentFragment();
                    for (const row of list) {
                        const id = row?.id;
                        if (id == null || state.historyIds.has(id)) continue;
                        state.historyIds.add(id);
                        frag.appendChild(UI.historyCard(row));
                    }
                    grid.insertBefore(frag, sentinel);
                }
                if (list.length) state.history.push(...list);
                paging.nextCursor = result?.next_cursor || null;
                paging.hasMore = !!result?.has_more;

                // Hide sentinel when no more
                if (!paging.hasMore && sentinel) sentinel.style.display = "none";
            } catch (err) {
                /* ignore load errors to avoid UI jank */
            } finally {
                if (state.historyPaging) state.historyPaging.isLoading = false;
            }
        },

        toggleFiltersPopover(anchor) {
            try {
                // If open, close and cleanup listeners
                if (state.dom.filtersPopover) {
                    const existing = state.dom.filtersPopover;
                    if (typeof existing._closeAnimated === 'function') existing._closeAnimated();
                    else {
                        if (state.dom.filtersPopoverListeners) {
                            const { onDocPointer, onResize, onScroll } = state.dom.filtersPopoverListeners;
                            if (onDocPointer) document.removeEventListener('pointerdown', onDocPointer, true);
                            if (onResize) window.removeEventListener('resize', onResize);
                            if (onScroll) window.removeEventListener('scroll', onScroll, true);
                            state.dom.filtersPopoverListeners = null;
                        }
                        existing.remove();
                        state.dom.filtersPopover = null;
                    }
                    return;
                }

                const pop = UI.buildFiltersPopover(anchor);
                document.body.appendChild(pop);
                state.dom.filtersPopover = pop;

                // Positioning function to keep popover within viewport
                const position = () => {
                    try {
                        const margin = 10;
                        const rect = anchor.getBoundingClientRect();
                        const viewportW = window.innerWidth;
                        const viewportH = window.innerHeight;
                        const scrollX = window.scrollX;
                        const scrollY = window.scrollY;

                        // reset classes and styles affecting size
                        pop.classList.remove('pqueue-popover--above');
                        pop.style.maxHeight = '80vh';

                        const popW = pop.offsetWidth;
                        const popH = pop.offsetHeight;

                        const anchorCenter = rect.left + rect.width / 2 + scrollX;
                        let left = Math.round(anchorCenter - popW / 2);
                        left = Math.max(scrollX + margin, Math.min(left, scrollX + viewportW - popW - margin));

                        // Prefer below; flip above if overflowing bottom
                        let top = rect.bottom + margin + scrollY;
                        const bottomOverflow = (top + popH) - (scrollY + viewportH - margin);
                        if (bottomOverflow > 0) {
                            const aboveTop = rect.top + scrollY - popH - margin;
                            if (aboveTop >= scrollY + margin) {
                                top = aboveTop;
                                pop.classList.add('pqueue-popover--above');
                            } else {
                                // Clamp within viewport if neither fits perfectly
                                top = Math.max(scrollY + margin, Math.min(top, scrollY + viewportH - popH - margin));
                            }
                        }

                        pop.style.left = `${left}px`;
                        pop.style.top = `${top}px`;

                        // Position arrow
                        const arrow = pop.querySelector('.pqueue-popover__arrow');
                        if (arrow) {
                            const popLeft = left;
                            const offset = Math.max(14, Math.min(anchorCenter - popLeft, popW - 14));
                            arrow.style.left = `${offset}px`;
                        }
                    } catch (err) { /* noop */ }
                };

                // Outside click/tap closes popover
                const closeAnimated = () => {
                    try {
                        if (!state.dom.filtersPopover) return;
                        const node = state.dom.filtersPopover;
                        // remove global listeners immediately
                        document.removeEventListener('pointerdown', onDocPointer, true);
                        window.removeEventListener('resize', onResize);
                        window.removeEventListener('scroll', onScroll, true);
                        state.dom.filtersPopoverListeners = null;
                        let removed = false;
                        const cleanup = () => {
                            if (removed) return;
                            removed = true;
                            try { node.remove(); } catch (err) {}
                            if (state.dom.filtersPopover === node) state.dom.filtersPopover = null;
                        };
                        node.setAttribute('data-open', 'false');
                        const timeoutId = window.setTimeout(cleanup, 180);
                        node.addEventListener('transitionend', () => { window.clearTimeout(timeoutId); cleanup(); }, { once: true });
                    } catch (err) { /* noop */ }
                };

                const onDocPointer = (ev) => {
                    try {
                        if (!state.dom.filtersPopover) return;
                        const target = ev.target;
                        if (state.dom.filtersPopover.contains(target)) return;
                        if (anchor && (target === anchor || (anchor.contains && anchor.contains(target)))) return;
                        closeAnimated();
                    } catch (err) { /* noop */ }
                };
                const onResize = () => position();
                const onScroll = () => position();
                document.addEventListener('pointerdown', onDocPointer, true);
                window.addEventListener('resize', onResize);
                window.addEventListener('scroll', onScroll, true);
                state.dom.filtersPopoverListeners = { onDocPointer, onResize, onScroll };
                pop.addEventListener('pqueue-close', closeAnimated);
                pop._closeAnimated = closeAnimated;

                // Initial position
                position();
                // Animate open
                requestAnimationFrame(() => { try { pop.setAttribute('data-open', 'true'); } catch (err) {} });
            } catch (err) {
                /* noop */
            }
        },

        setHistorySort(dir) {
            try {
                if (!state.historyPaging) state.historyPaging = { isLoading: false, hasMore: true, nextCursor: null, params: { sort_by: 'id', sort_dir: 'desc', limit: 60 } };
                const params = state.historyPaging.params || {};
                params.sort_dir = (dir === 'asc') ? 'asc' : 'desc';
                state.historyPaging.params = params;

                // Reset and reload
                const grid = state.dom.historyGrid;
                const sentinel = state.dom.historySentinel;
                if (grid) Array.from(grid.querySelectorAll('.pqueue-history-card')).forEach((n) => n.remove());
                state.history = [];
                state.historyIds = new Set();
                state.historyPaging.nextCursor = null;
                state.historyPaging.hasMore = true;
                if (sentinel) sentinel.style.display = '';
                Events.loadMoreHistory();
                UI.updateSortToggle();
            } catch (err) {
                /* noop */
            }
        },

        updateHistoryDateFilters(sinceVal, untilVal, sinceTimeVal = "", untilTimeVal = "") {
            // Use LOCAL day bounds and format as 'YYYY-MM-DD HH:MM:SS' to match DB format
            const pad = (n) => String(n).padStart(2, '0');
            const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
            const toLocalStart = (d, t) => {
                if (!d) return "";
                const parts = d.split('-').map((x) => parseInt(x, 10));
                let hh = 0, mm = 0, ss = 0;
                if (t && /^\d{2}:\d{2}(:\d{2})?$/.test(t)) {
                    const tt = t.split(':').map((x) => parseInt(x, 10));
                    hh = tt[0] ?? 0; mm = tt[1] ?? 0; ss = tt[2] ?? 0;
                }
                const dt = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, hh, mm, ss, 0);
                return fmt(dt);
            };
            const toLocalEnd = (d, t) => {
                if (!d) return "";
                const parts = d.split('-').map((x) => parseInt(x, 10));
                let hh = 23, mm = 59, ss = 59;
                if (t && /^\d{2}:\d{2}(:\d{2})?$/.test(t)) {
                    const tt = t.split(':').map((x) => parseInt(x, 10));
                    hh = tt[0] ?? 23; mm = tt[1] ?? 59; ss = tt[2] ?? 59;
                }
                const dt = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, hh, mm, ss, 999);
                return fmt(dt);
            };

            state.filters.historySince = sinceVal || "";
            state.filters.historyUntil = untilVal || "";
            state.filters.historySinceTime = sinceTimeVal || "";
            state.filters.historyUntilTime = untilTimeVal || "";
            if (!state.historyPaging) state.historyPaging = { isLoading: false, hasMore: true, nextCursor: null, params: { sort_by: "id", sort_dir: "desc", limit: 60 } };
            const params = state.historyPaging.params || {};
            params.since = toLocalStart(state.filters.historySince, state.filters.historySinceTime) || undefined;
            params.until = toLocalEnd(state.filters.historyUntil, state.filters.historyUntilTime) || undefined;
            state.historyPaging.params = params;

            // Reset list and load first page with filters
            const grid = state.dom.historyGrid;
            const sentinel = state.dom.historySentinel;
            if (grid) {
                // Remove all history cards except sentinel
                Array.from(grid.querySelectorAll('.pqueue-history-card')).forEach((n) => n.remove());
            }
            state.history = [];
            state.historyIds = new Set();
            state.historyPaging.nextCursor = null;
            state.historyPaging.hasMore = true;
            if (sentinel) sentinel.style.display = "";
            // Prime by fetching one page now
            Events.loadMoreHistory();
            UI.updateHistorySubtitle();
        },

        applyHistoryPreset(kind) {
            try {
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const toDateStr = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
                const toTimeStr = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

                if (kind === 'clear') {
                    state.historyPreset = undefined;
                    state.filters.historySince = "";
                    state.filters.historySinceTime = "";
                    state.filters.historyUntil = "";
                    state.filters.historyUntilTime = "";
                } else if (kind === 'today') {
                    state.historyPreset = 'today';
                    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
                    state.filters.historySince = toDateStr(start);
                    state.filters.historySinceTime = '00:00:00';
                    state.filters.historyUntil = toDateStr(end);
                    state.filters.historyUntilTime = '23:59:59';
                } else if (kind === '24h') {
                    state.historyPreset = '24h';
                    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    state.filters.historySince = toDateStr(start);
                    state.filters.historySinceTime = toTimeStr(start);
                    state.filters.historyUntil = toDateStr(now);
                    state.filters.historyUntilTime = toTimeStr(now);
                } else if (kind === '7d') {
                    state.historyPreset = '7d';
                    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    state.filters.historySince = toDateStr(start);
                    state.filters.historySinceTime = toTimeStr(start);
                    state.filters.historyUntil = toDateStr(now);
                    state.filters.historyUntilTime = toTimeStr(now);
                }

                if (state.dom.historySince) state.dom.historySince.value = state.filters.historySince;
                if (state.dom.historySinceTime) state.dom.historySinceTime.value = state.filters.historySinceTime;
                if (state.dom.historyUntil) state.dom.historyUntil.value = state.filters.historyUntil;
                if (state.dom.historyUntilTime) state.dom.historyUntilTime.value = state.filters.historyUntilTime;

                Events.updateHistoryDateFilters(
                    state.filters.historySince,
                    state.filters.historyUntil,
                    state.filters.historySinceTime,
                    state.filters.historyUntilTime
                );
                UI.updateHistorySubtitle();
            } catch (err) {
                /* noop */
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
            // Use paginated history for initial load to respect filters
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
            // Seed history paging cursors and ids
            try {
                state.historyIds = new Set();
                state.history.forEach((row) => {
                    if (row && row.id != null) state.historyIds.add(row.id);
                });
                const last = state.history[state.history.length - 1];
                state.historyPaging = state.historyPaging || { isLoading: false, hasMore: true, nextCursor: null, params: { sort_by: "id", sort_dir: "desc", limit: 60 } };
                state.historyPaging.nextCursor = paged?.next_cursor || (last ? { id: last.id, value: last.id } : null);
                state.historyPaging.hasMore = !!paged?.has_more;
                // If filters active but server returned fewer than requested and has_more==false, keep sentinel hidden
                if (!state.historyPaging.hasMore && state.dom.historySentinel) state.dom.historySentinel.style.display = "none";
            } catch (err) {
                /* noop */
            }
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
                    return true;
                }
            } catch (err) {
                console.error("pqueue: sidebar registration failed", err);
            }
            return false;
        };

        const init = () => {
            UI.ensureAssets();
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


