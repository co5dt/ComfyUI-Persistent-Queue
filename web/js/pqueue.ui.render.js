(function () {
    "use strict";

    const state = (window.PQueue && window.PQueue.state) || {};
    const UI = (window.PQueue && window.PQueue.UI) || window.UI;
    const Events = (window.PQueue && window.PQueue.Events) || window.Events;
    const Format = (window.PQueue && window.PQueue.Format) || window.Format;

    UI.render = function render() {
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
    };

    UI.updateAfterRefresh = function updateAfterRefresh(paged) {
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
    };

    UI.updateToolbarStatus = function updateToolbarStatus() {
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
    };
})();



