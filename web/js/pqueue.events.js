(function () {
    "use strict";

    let state = window.PQueue?.state;
    let API = window.PQueue?.API || window.API;
    let UI = window.PQueue?.UI || window.UI;
    let setStatusMessage = window.PQueue?.setStatusMessage || window.setStatusMessage;

    function refreshRefs() {
        state = window.PQueue?.state;
        UI = window.PQueue?.UI || window.UI;
        API = window.PQueue?.API || window.API;
        setStatusMessage = window.PQueue?.setStatusMessage || window.setStatusMessage || function () {};
    }

    let dragRow = null;
    let dropHover = null;

    const Events = {
        bind() {
            refreshRefs();
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

            try {
                const root = state.container;
                if (root && !root._pqlockBound) {
                    const lock = () => { state.renderLockUntil = Date.now() + 300; };
                    const unlockSoon = () => { state.renderLockUntil = Date.now() + 100; };
                    root.addEventListener('pointerdown', lock, true);
                    root.addEventListener('pointerup', unlockSoon, true);
                    root.addEventListener('click', unlockSoon, true);
                    root._pqlockBound = true;
                }
            } catch (err) { /* noop */ }
        },

        async syncLatestForAsc() {
            refreshRefs();
            try {
                const paging = state.historyPaging;
                const params = paging?.params || {};
                if ((params.sort_dir || 'desc') !== 'asc') return;
                const latestParams = { ...params, sort_dir: 'desc', limit: Math.min(10, params.limit || 10) };
                delete latestParams.cursor_id;
                delete latestParams.cursor_value;
                const result = await API.getHistoryPaginated(latestParams);
                let list = Array.isArray(result?.history) ? result.history : [];
                if (!list.length) return;
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
                let added = 0;
                for (const row of list) {
                    const id = row?.id;
                    if (id == null || state.historyIds.has(id)) continue;
                    state.historyIds.add(id);
                    state.history.push(row);
                    added += 1;
                }
                if (added) UI.reconcileHistoryFromState();
            } catch (err) { /* noop */ }
        },

        async togglePause() {
            refreshRefs();
            try {
                if (state.paused) await API.resume();
                else await API.pause();
                setStatusMessage(state.paused ? "Resuming queue…" : "Pausing queue…");
                await refresh({ force: true });
            } catch (err) {
                console.error("pqueue: toggle pause failed", err);
                state.error = err?.message || "Failed to toggle queue";
                UI.updateToolbarStatus();
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        async clearPending() {
            refreshRefs();
            if (!state.queue_pending.length) {
                setStatusMessage("Queue already empty");
                return;
            }
            if (!window.confirm(`Remove ${state.queue_pending.length} pending prompt${state.queue_pending.length === 1 ? "" : "s"}?`)) return;
            try {
                const ids = state.queue_pending.map((item) => item[1]).filter(Boolean);
                await API.del(ids);
                setStatusMessage(`Cleared ${ids.length} prompt${ids.length === 1 ? "" : "s"}`);
                await refresh({ force: true });
            } catch (err) {
                console.error("pqueue: clear failed", err);
                state.error = err?.message || "Failed to clear queue";
                UI.updateToolbarStatus();
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        manualRefresh() {
            refreshRefs();
            if (state.isRefreshing) return;
            state.history = [];
            state.historyIds = new Set();
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
            refreshRefs();
            state.filters.pending = event.target.value;
            UI.refreshFilter();
            UI.updateSelectionUI();
        },

        toggleSelectAll(event) {
            refreshRefs();
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
            refreshRefs();
            if (!event.target.classList.contains("pqueue-select")) return;
            const row = event.target.closest(".pqueue-row[data-id]");
            if (!row) return;
            const id = row.dataset.id;
            if (event.target.checked) state.selectedPending.add(id);
            else state.selectedPending.delete(id);
            UI.updateSelectionUI();
        },

        handleTableClick(event) {
            refreshRefs();
            const btn = event.target.closest("button[data-action]");
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === "delete") Events.deleteSingle(id);
            else if (action === "move-top") Events.moveSingle(id, "top");
            else if (action === "move-bottom") Events.moveSingle(id, "bottom");
        },

        handleTableKey() { refreshRefs(); },

        handleDragStart(event) {
            refreshRefs();
            const row = event.target.closest(".pqueue-row[data-id]");
            if (!row) return;
            dragRow = row;
            row.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", row.dataset.id);
        },

        handleDragOver(event) {
            refreshRefs();
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
            refreshRefs();
            const target = event.target.closest(".pqueue-row[data-id]");
            if (target && target !== dragRow) target.classList.remove("pqueue-row--before", "pqueue-row--after");
        },

        async handleDrop(event) {
            refreshRefs();
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
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        handleDragEnd() {
            refreshRefs();
            if (dropHover) dropHover.classList.remove("pqueue-row--before", "pqueue-row--after");
            dropHover = null;
            if (dragRow) {
                dragRow.classList.remove("is-dragging");
                dragRow = null;
            }
        },


        async deleteSingle(id) {
            refreshRefs();
            if (!id) return;
            if (!window.confirm(`Delete prompt ${id}?`)) return;
            try {
                await API.del([id]);
                state.selectedPending.delete(id);
                setStatusMessage(`Deleted ${id}`);
                await refresh({ force: true });
            } catch (err) {
                console.error("pqueue: delete failed", err);
                state.error = err?.message || "Failed to delete prompt";
                UI.updateToolbarStatus();
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        // priority editing is not exposed in the current UI; left intentionally unimplemented
        async moveSingle(id, where) {
            refreshRefs();
            try {
                const table = state.dom.pendingTable;
                if (!table) return;
                // Optimistically move the row in the DOM for immediate feedback
                const rowEl = table.querySelector(`.pqueue-row[data-id="${id}"]`);
                const header = table.querySelector('.pqueue-list__header');
                if (!rowEl) return;
                if (where === 'top') {
                    if (header && header.nextSibling) table.insertBefore(rowEl, header.nextSibling);
                    else table.insertBefore(rowEl, table.firstChild);
                } else {
                    table.appendChild(rowEl);
                }
                // Build new order based on current DOM row order
                const ids = Array.from(table.querySelectorAll('.pqueue-row[data-id]')).map((r) => r.dataset.id);
                await API.reorder(ids);
                setStatusMessage(where === 'top' ? 'Moved to top' : 'Moved to bottom');
                await refresh({ force: true });
            } catch (err) {
                console.error('pqueue: move failed', err);
                state.error = err?.message || 'Failed to move prompt';
                UI.updateToolbarStatus();
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        async loadMoreHistory() {
            refreshRefs();
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
                const dir = (state.historyPaging?.params?.sort_dir === 'asc') ? 'asc' : 'desc';
                if (grid && sentinel && list.length) {
                    UI.withStableAnchor(() => {
                        try { Array.from(grid.querySelectorAll('.pqueue-empty')).forEach((n) => n.remove()); } catch (err) { /* noop */ }
                        for (const row of list) {
                            const id = row?.id;
                            if (id == null || state.historyIds.has(id)) continue;
                            state.historyIds.add(id);
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
                            if (Array.isArray(state.history)) {
                                if (dir === 'desc') state.history.push(row);
                                else state.history.push(row);
                            }
                        }
                    });
                } else if (list.length) {
                    if (Array.isArray(state.history)) state.history.push(...list);
                }
                if (typeof result?.total === 'number') state.historyTotal = result.total;
                paging.nextCursor = result?.next_cursor || null;
                paging.hasMore = !!result?.has_more;

                if (!paging.hasMore && sentinel) sentinel.style.display = "none";
                try { deriveMetrics(); } catch (err) { /* noop */ }
                UI.updateHistorySubtitle();
            } catch (err) {
                /* ignore load errors to avoid UI jank */
            } finally {
                if (state.historyPaging) state.historyPaging.isLoading = false;
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        toggleFiltersPopover(anchor) {
            refreshRefs();
            try {
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

                const position = () => {
                    try {
                        const margin = 10;
                        const rect = anchor.getBoundingClientRect();
                        const viewportW = window.innerWidth;
                        const viewportH = window.innerHeight;
                        const scrollX = window.scrollX;
                        const scrollY = window.scrollY;

                        pop.classList.remove('pqueue-popover--above');
                        pop.style.maxHeight = '80vh';

                        const popW = pop.offsetWidth;
                        const popH = pop.offsetHeight;

                        const anchorCenter = rect.left + rect.width / 2 + scrollX;
                        let left = Math.round(anchorCenter - popW / 2);
                        left = Math.max(scrollX + margin, Math.min(left, scrollX + viewportW - popW - margin));

                        let top = rect.bottom + margin + scrollY;
                        const bottomOverflow = (top + popH) - (scrollY + viewportH - margin);
                        if (bottomOverflow > 0) {
                            const aboveTop = rect.top + scrollY - popH - margin;
                            if (aboveTop >= scrollY + margin) {
                                top = aboveTop;
                                pop.classList.add('pqueue-popover--above');
                            } else {
                                top = Math.max(scrollY + margin, Math.min(top, scrollY + viewportH - popH - margin));
                            }
                        }

                        pop.style.left = `${left}px`;
                        pop.style.top = `${top}px`;

                        const arrow = pop.querySelector('.pqueue-popover__arrow');
                        if (arrow) {
                            const popLeft = left;
                            const offset = Math.max(14, Math.min(anchorCenter - popLeft, popW - 14));
                            arrow.style.left = `${offset}px`;
                        }
                    } catch (err) { /* noop */ }
                };

                const closeAnimated = () => {
                    try {
                        if (!state.dom.filtersPopover) return;
                        const node = state.dom.filtersPopover;
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
                window.addEventListener('scroll', onScroll, { capture: true, passive: true });
                state.dom.filtersPopoverListeners = { onDocPointer, onResize, onScroll };
                pop.addEventListener('pqueue-close', closeAnimated);
                pop._closeAnimated = closeAnimated;

                position();
                requestAnimationFrame(() => { try { pop.setAttribute('data-open', 'true'); } catch (err) {} });
            } catch (err) { /* noop */ }
        },

        async setHistorySort(dir) {
            refreshRefs();
            try {
                if (!state.historyPaging) state.historyPaging = { isLoading: false, hasMore: true, nextCursor: null, params: { sort_by: 'id', sort_dir: 'desc', limit: 60 } };
                const params = state.historyPaging.params || {};
                params.sort_dir = (dir === 'asc') ? 'asc' : 'desc';
                state.historyPaging.params = params;

                const grid = state.dom.historyGrid;
                const scroller = UI.getScrollContainer();
                let restore = null;
                if (grid && scroller) {
                    const rect = grid.getBoundingClientRect();
                    const scRect = scroller.getBoundingClientRect();
                    const beforeOffset = rect.top - scRect.top;
                    const beforeHeight = rect.height;
                    grid.style.minHeight = `${beforeHeight}px`;
                    restore = () => {
                        try { grid.style.minHeight = ''; } catch (err) {}
                        try { scroller.scrollTop = Math.max(0, scroller.scrollTop + ((grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - beforeOffset)); } catch (err) {}
                    };
                }
                const sentinel = state.dom.historySentinel;
                if (grid) Array.from(grid.querySelectorAll('.pqueue-history-card')).forEach((n) => n.remove());
                state.history = [];
                state.historyIds = new Set();
                state.historyTotal = null;
                state.historyPaging.nextCursor = null;
                state.historyPaging.hasMore = true;
                if (sentinel) sentinel.style.display = '';
                await Events.loadMoreHistory();
                await Events.syncLatestForAsc();
                UI.updateHistorySubtitle();
                UI.updateSortToggle();
                try { UI.ensureHistoryObserver(); } catch (err) { /* noop */ }
                if (typeof restore === 'function') requestAnimationFrame(restore);
            } catch (err) { /* noop */ }
        },

        updateHistoryDateFilters(sinceVal, untilVal, sinceTimeVal = "", untilTimeVal = "") {
            refreshRefs();
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

            const grid = state.dom.historyGrid;
            const sentinel = state.dom.historySentinel;
            if (grid) {
                Array.from(grid.querySelectorAll('.pqueue-history-card')).forEach((n) => n.remove());
            }
            state.history = [];
            state.historyIds = new Set();
            state.historyTotal = null;
            state.historyPaging.nextCursor = null;
            state.historyPaging.hasMore = true;
            if (sentinel) sentinel.style.display = "";
            Events.loadMoreHistory();
            UI.updateHistorySubtitle();
        },

        applyHistoryPreset(kind) {
            refreshRefs();
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
            } catch (err) { /* noop */ }
        },

        async deleteSelected() {
            refreshRefs();
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
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },
        
        async executeSelectedJobs() {
            refreshRefs();
            if (!state.selectedPending.size) return;
            
            const isPaused = !!state.paused;
            const action = isPaused ? "run" : "skip";
            
            const selectedIds = Array.from(state.selectedPending);
            
            try {
                if (isPaused) {
                    // Run selected jobs
                    console.log('Running selected jobs:', selectedIds);
                    const response = await API.runSelectedJobs(selectedIds);
                    const result = await response.json();
                    console.log('Run selected response:', response.status, result);
                    if (!response.ok) {
                        throw new Error(result.error || 'Failed to run selected jobs');
                    }
                    setStatusMessage(`Running ${selectedIds.length} selected job${selectedIds.length === 1 ? "" : "s"}`);
                    // Force an immediate refresh to reflect the new top-of-queue order
                    await refresh({ force: true });
                    // Schedule a follow-up refresh to account for any async server re-heapify
                    window.setTimeout(() => { try { refresh({ skipIfBusy: true }); } catch (err) {} }, 150);
                } else {
                    // Skip selected jobs (remove from queue)
                    console.log('Skipping selected jobs:', selectedIds);
                    const response = await API.skipSelectedJobs(selectedIds);
                    const result = await response.json();
                    console.log('Skip selected response:', response.status, result);
                    if (!response.ok) {
                        throw new Error(result.error || 'Failed to skip selected jobs');
                    }
                    setStatusMessage(`Skipped ${selectedIds.length} selected job${selectedIds.length === 1 ? "" : "s"}`);
                }
                
                state.selectedPending.clear();
                UI.updateSelectionUI();
            } catch (err) {
                console.error(`pqueue: ${action} selected jobs failed`, err);
                state.error = err?.message || `Failed to ${action} selected jobs`;
                UI.updateToolbarStatus();
                try { if (typeof UI.updateToolbarSummary === 'function') UI.updateToolbarSummary(); } catch (e) { /* noop */ }
            }
        },

        viewWorkflow(id) {
            refreshRefs();
            const info = lookupWorkflow(id);
            if (!info) {
                setStatusMessage("Workflow not available", 3000);
                return;
            }
            const text = typeof info.workflow === "string" ? info.workflow : JSON.stringify(info.workflow, null, 2);
            UI.openWorkflowModal({ promptId: id, workflowText: text, sourceLabel: info.source });
        },
    };

    window.PQueue = window.PQueue || {};
    window.PQueue.Events = Events;
    window.Events = Events;
})();


