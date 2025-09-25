(function () {
    "use strict";

    const state = (window.PQueue && window.PQueue.state) || {};
    const API = (window.PQueue && window.PQueue.API) || window.API;
    const Icons = (window.PQueue && window.PQueue.Icons) || window.Icons;
    const Format = (window.PQueue && window.PQueue.Format) || window.Format;
    const Events = (window.PQueue && window.PQueue.Events) || window.Events;
    const setStatusMessage = (window.PQueue && window.PQueue.setStatusMessage) || window.setStatusMessage;
    const copyText = (window.PQueue && window.PQueue.copyText) || window.copyText;

    const UI = window.PQueue?.UI || {};

    UI.el = function el(tag, attrs = {}, children = []) {
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
    };

    UI.icon = function icon(name, { spin = false, size } = {}) {
        const classes = ["pqueue-icon"];
        if (spin) classes.push("pqueue-icon--spin");
        if (size) classes.push(`pqueue-icon--${size}`);
        const el = UI.el("span", { class: classes });
        const svg = Icons.resolve(name);
        if (svg) el.appendChild(svg);
        else if (name) el.classList.add(...String(name).split(/\s+/));
        return el;
    };

    UI.button = function button({ id, text, icon, variant, subtle, size, badge, title, disabled, onClick, ariaLabel }) {
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
    };

    UI.statusBadge = function statusBadge(status, { subtle } = {}) {
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
    };

    UI.emptyState = function emptyState({ icon, title, description, action } = {}) {
        const box = UI.el("div", { class: "pqueue-empty" });
        if (icon) box.appendChild(UI.icon(icon, { size: "lg" }));
        if (title) box.appendChild(UI.el("h4", { class: "pqueue-empty__title", text: title }));
        if (description) box.appendChild(UI.el("p", { class: "pqueue-empty__desc", text: description }));
        if (action) box.appendChild(action);
        return box;
    };

    UI.metricTile = function metricTile({ icon, label, value, caption, variant, tooltip }) {
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
    };

    UI.ensureAssets = function ensureAssets() {
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
    };

    UI.historyKey = function historyKey(row) {
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
    };

    UI.historyKeyParts = function historyKeyParts(row) {
        const ms = UI.historyKey(row) || 0;
        const id = Number(row?.id) || 0;
        return [ms, id];
    };

    UI.getScrollContainer = function getScrollContainer() {
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
    };

    UI.getVisibleHistoryAnchor = function getVisibleHistoryAnchor() {
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
    };

    UI.withStableAnchor = function withStableAnchor(mutator) {
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
    };

    UI.estimateDuration = function estimateDuration(promptId, workflow) {
        let key = state.workflowCache.get(promptId);
        if (!key && workflow !== undefined) {
            try {
                key = typeof workflow === "string" ? workflow : JSON.stringify(workflow);
                if (key) state.workflowCache.set(promptId, key);
            } catch (err) { /* ignore */ }
        }
        if (key && state.durationByWorkflow.has(key)) return state.durationByWorkflow.get(key);
        return state.metrics.avgDuration;
    };

    UI.card = function card(title, { icon, actions, subtitle, content, classes } = {}) {
        const head = [];
        const titleWrap = UI.el("div", { class: "pqueue-card__title-wrap" });
        if (icon) titleWrap.appendChild(UI.icon(icon, { size: "md" }));
        titleWrap.appendChild(UI.el("h3", { class: "pqueue-card__title", text: title }));
        if (subtitle) titleWrap.appendChild(UI.el("span", { class: "pqueue-card__subtitle", text: subtitle }));
        head.push(titleWrap);
        if (actions && actions.length) head.push(UI.el("div", { class: "pqueue-card__actions" }, actions));

        const body = Array.isArray(content) ? content : [content];
        return UI.el("section", { class: ["pqueue-card", classes].filter(Boolean) }, [UI.el("header", { class: "pqueue-card__header" }, head), UI.el("div", { class: "pqueue-card__body" }, body)]);
    };

    UI.buildPreviewUrl = function buildPreviewUrl(imgDesc, pid) {
        const url = new URL("/api/pqueue/preview", window.location.origin);
        url.searchParams.set("filename", imgDesc.filename);
        url.searchParams.set("type", imgDesc.type);
        if (imgDesc.subfolder) url.searchParams.set("subfolder", imgDesc.subfolder);
        url.searchParams.set("preview", "webp;50");
        if (pid) url.searchParams.set("pid", pid);
        return url;
    };

    UI.deriveWorkflowLabel = function deriveWorkflowLabel(item, dbRow) {
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
    };

    UI.buildWorkflowLabel = function buildWorkflowLabel(pid, item, dbRow) {
        let label = state.workflowNameCache.get(pid);
        if (!label) {
            label = UI.deriveWorkflowLabel(item, dbRow);
            state.workflowNameCache.set(pid, label);
        }
        return UI.el("span", { class: "pqueue-row__label", text: label });
    };

    window.PQueue = window.PQueue || {};
    window.PQueue.UI = UI;
    window.UI = UI;
})();




