(function () {
    "use strict";

    const state = (window.PQueue && window.PQueue.state) || {};
    const UI = (window.PQueue && window.PQueue.UI) || window.UI;
    const Format = (window.PQueue && window.PQueue.Format) || window.Format;
    const Events = (window.PQueue && window.PQueue.Events) || window.Events;

    UI.historySentinel = function historySentinel() {
        const wrap = UI.el("div", { class: "pqueue-history-sentinel" });
        const spinner = UI.icon("ti ti-loader-2", { size: "md", spin: true });
        wrap.appendChild(spinner);
        return wrap;
    };

    UI.historyCard = function historyCard(row) {
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
    };

    UI.renderThumbs = function renderThumbs(row) {
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
    };

    UI.thumbPlaceholder = function thumbPlaceholder(row) {
        const status = String(row?.status ?? "").toLowerCase();
        if (["interrupted", "cancelled", "canceled", "stopped"].includes(status)) {
            return { text: "Interrupted", icon: "ti ti-player-stop", variant: "interrupted" };
        }
        if (["error", "failed", "failure"].includes(status)) {
            return { text: "Failed", icon: "ti ti-alert-triangle", variant: "failed" };
        }
        return { text: "Preview unavailable", icon: "ti ti-photo-off", variant: "empty" };
    };

    UI.thumbPlaceholderNode = function thumbPlaceholderNode(meta) {
        return UI.el("div", { class: ["pqueue-thumb-placeholder", meta.variant ? `pqueue-thumb-placeholder--${meta.variant}` : null] }, [UI.icon(meta.icon), UI.el("span", { class: "pqueue-thumb-placeholder__text", text: meta.text })]);
    };

    UI.extractImages = function extractImages(row) {
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
    };

    UI.countImages = function countImages(row) {
        try {
            return UI.extractImages(row).length;
        } catch (err) {
            return 0;
        }
    };

    UI.historyPrimaryFilename = function historyPrimaryFilename(row) {
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
    };

    UI.renderHistory = function renderHistory() {
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

        // Collapsible card structure
        const bodyInner = grid;
        const body = UI.el("div", { class: "pqueue-card__body" }, [bodyInner]);
        try {
            body.style.overflow = 'hidden';
            body.style.transition = 'height 120ms ease, opacity 120ms ease';
        } catch (err) { /* noop */ }

        const titleWrap = UI.el("div", { class: "pqueue-card__title-wrap" });
        titleWrap.appendChild(UI.icon("ti ti-clock-bolt", { size: "md" }));
        titleWrap.appendChild(UI.el("h3", { class: "pqueue-card__title", text: "History" }));
        if (subtitle) titleWrap.appendChild(UI.el("span", { class: "pqueue-card__subtitle", text: subtitle }));

        const toggle = UI.button({ icon: state.uiHistoryCollapsed ? "ti ti-chevron-down" : "ti ti-chevron-up", variant: "ghost", subtle: true, title: state.uiHistoryCollapsed ? "Expand" : "Collapse" });
        toggle.addEventListener("click", () => {
            try {
                const isCollapsed = !!state.uiHistoryCollapsed;
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
                        state.uiHistoryCollapsed = true;
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
                        state.uiHistoryCollapsed = false;
                        try { wrap.setAttribute('data-collapsed', 'false'); } catch (err) { /* noop */ }
                    };
                    body.addEventListener('transitionend', onEnd);
                }
            } catch (err) { /* noop */ }
        });

        const actions = UI.el("div", { class: "pqueue-card__actions" }, [...UI.historyFilters(), toggle]);
        const header = UI.el("header", { class: "pqueue-card__header" }, [titleWrap, actions]);
        const wrap = UI.el("section", { class: ["pqueue-card"] }, [header]);
        try { wrap.setAttribute('data-collapsed', state.uiHistoryCollapsed ? 'true' : 'false'); } catch (err) { /* noop */ }
        if (state.uiHistoryCollapsed) {
            try { body.style.height = '0px'; body.style.opacity = '0'; } catch (err) { /* noop */ }
        } else {
            try { body.style.height = ''; body.style.opacity = '1'; } catch (err) { /* noop */ }
        }

        wrap.appendChild(body);
        state.dom.historyCard = wrap;
        state.dom.historySubtitle = wrap.querySelector('.pqueue-card__subtitle');
        try { UI.ensureThumbObserver(); } catch (err) { /* noop */ }
        return wrap;
    };

    UI.ensureHistoryObserver = function ensureHistoryObserver() {
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
    };

    UI.ensureThumbObserver = function ensureThumbObserver() {
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
    };

    UI.mergeHistoryFromRefresh = function mergeHistoryFromRefresh(paged) {
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
            try { UI.ensureThumbObserver(); } catch (err) { /* noop */ }
        } catch (err) { /* noop */ }
    };

    UI.reconcileHistoryFromState = function reconcileHistoryFromState() {
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
            try { UI.ensureThumbObserver(); } catch (err) { /* noop */ }
        } catch (err) { /* noop */ }
    };

    UI.currentHistoryRangeLabel = function currentHistoryRangeLabel() {
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
    };

    UI.updateHistorySubtitle = function updateHistorySubtitle() {
        try {
            const el = state.dom.historySubtitle;
            if (!el) return;
            const count = (state.historyTotal != null) ? state.historyTotal : state.metrics?.historyCount;
            const base = (count != null) ? `${count} entries` : null;
            const range = UI.currentHistoryRangeLabel();
            const text = [base, range].filter(Boolean).join(' • ');
            el.textContent = text;
        } catch (err) { /* noop */ }
    };

    UI.historyFilters = function historyFilters() {
        const filtersBtn = UI.button({ icon: "ti ti-filter", variant: "ghost", subtle: true, title: "Filters" });
        const sortToggle = UI.sortToggleButton();

        filtersBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            Events.toggleFiltersPopover(e.currentTarget);
        });

        return [filtersBtn, sortToggle, UI.clearFiltersIcon()];
    };

    UI.clearFiltersIcon = function clearFiltersIcon() {
        const btn = UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Clear filters" });
        btn.addEventListener('click', () => Events.applyHistoryPreset('clear'));
        return btn;
    };

    UI.sortToggleButton = function sortToggleButton() {
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
    };

    UI.updateSortToggle = function updateSortToggle() {
        try {
            const btn = state.dom.sortToggleBtn;
            if (!btn) return;
            const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
            const icon = dir === 'asc' ? 'ti ti-arrow-bar-to-up' : 'ti ti-arrow-bar-to-down';
            btn.innerHTML = '';
            btn.appendChild(UI.icon(icon));
            btn.title = dir === 'asc' ? 'Sort ascending (click to toggle)' : 'Sort descending (click to toggle)';
        } catch (err) { /* noop */ }
    };

    UI.buildFiltersPopover = function buildFiltersPopover(anchor) {
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
    };
})();




