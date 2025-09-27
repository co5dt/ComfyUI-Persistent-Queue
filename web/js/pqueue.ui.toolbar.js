(function () {
    "use strict";

    const state = (window.PQueue && window.PQueue.state) || {};
    const UI = (window.PQueue && window.PQueue.UI) || (window.PQueue = (window.PQueue || {}), window.PQueue.UI = {}, window.PQueue.UI);
    const Events = (window.PQueue && window.PQueue.Events) || window.Events;
    const Format = (window.PQueue && window.PQueue.Format) || window.Format;

    UI.renderToolbar = function renderToolbar() {
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
        
        const executeSelectedBtn = UI.button({
            id: "pqueue-execute-selected",
            icon: state.paused ? "ti ti-player-play" : "ti ti-player-skip-forward",
            ariaLabel: state.paused ? "Run selected jobs" : "Skip selected jobs",
            title: state.paused ? "Run selected jobs" : "Skip selected jobs",
            variant: state.paused ? "primary" : "warning",
            subtle: true,
            disabled: state.selectedPending.size === 0,
            badge: state.selectedPending.size || null,
        });
        executeSelectedBtn.addEventListener('click', Events.executeSelectedJobs);

        const status = UI.el("div", { class: "pqueue-toolbar__status" });
        state.dom = state.dom || {};
        state.dom.status = status;

        // Summary row (metrics integrated into toolbar)
        const summary = UI.el("div", { class: "pqueue-toolbar__summary" });
        const item = (icon, label, value) => {
            const el = UI.el("span", { class: "pqueue-summary__item" });
            el.appendChild(UI.icon(icon, { size: "sm" }));
            el.appendChild(UI.el("span", { class: "pqueue-muted", text: label }));
            el.appendChild(UI.el("span", { class: "pqueue-code", text: value }));
            return el;
        };

        const m = state.metrics || {};
        const runningEl = item("ti ti-activity", "Active", String(m.runningCount || 0));
        const pendingEl = item("ti ti-stack-2", "Pending", String(m.queueCount || 0));
        const histCount = (state.historyTotal != null) ? state.historyTotal : (m.historyCount || 0);
        const historyEl = item("ti ti-history", "History", String(histCount || 0));
        const srVal = (m.successRate != null) ? `${Math.round(m.successRate * 100)}%` : "—";
        const successEl = item("ti ti-chart-pie", "SR", srVal);
        const etaVal = m.estimatedTotalDuration ? Format.duration(m.estimatedTotalDuration) : "—";
        const etaEl = item("ti ti-hourglass-high", "ETA", etaVal);
        etaEl.title = [
            m.estimatedRunningDuration ? `Running ~${Format.duration(m.estimatedRunningDuration)}` : null,
            m.estimatedPendingDuration ? `Pending ~${Format.duration(m.estimatedPendingDuration)}` : null,
        ].filter(Boolean).join(" • ") || "Estimated total duration based on recent averages";

        state.dom.summary = summary;
        state.dom.summaryRunning = runningEl.querySelector('.pqueue-code');
        state.dom.summaryPending = pendingEl.querySelector('.pqueue-code');
        state.dom.summaryHistory = historyEl.querySelector('.pqueue-code');
        state.dom.summarySuccess = successEl.querySelector('.pqueue-code');
        state.dom.summaryEta = etaEl.querySelector('.pqueue-code');

        summary.appendChild(runningEl);
        summary.appendChild(pendingEl);
        summary.appendChild(etaEl);
        summary.appendChild(successEl);
        summary.appendChild(historyEl);

        return UI.el("div", { class: "pqueue-toolbar" }, [
            UI.el("div", { class: "pqueue-toolbar__row" }, [
                UI.el("div", { class: "pqueue-toolbar__group" }, [pauseBtn, clearBtn, executeSelectedBtn]),
                status,
            ]),
            UI.el("div", { class: ["pqueue-toolbar__row", "pqueue-toolbar__row--secondary"] }, [
                summary,
            ]),
        ]);
    };

    UI.updateToolbarControls = function updateToolbarControls() {
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
            
            const executeSelectedBtn = document.getElementById('pqueue-execute-selected');
            if (executeSelectedBtn) {
                const isPaused = !!state.paused;
                const hasSelected = state.selectedPending.size > 0;
                executeSelectedBtn.title = isPaused ? 'Run selected jobs' : 'Skip selected jobs';
                executeSelectedBtn.setAttribute('aria-label', isPaused ? 'Run selected jobs' : 'Skip selected jobs');
                executeSelectedBtn.classList.toggle('pqueue-button--primary', isPaused);
                executeSelectedBtn.classList.toggle('pqueue-button--warning', !isPaused);
                executeSelectedBtn.disabled = !hasSelected;
                
                // Update icon
                executeSelectedBtn.innerHTML = '';
                executeSelectedBtn.appendChild(UI.icon(isPaused ? 'ti ti-player-play' : 'ti ti-player-skip-forward'));
                
                // Update badge
                const existingBadge = executeSelectedBtn.querySelector('.pqueue-button__badge');
                if (existingBadge) existingBadge.remove();
                if (hasSelected) {
                    executeSelectedBtn.appendChild(UI.el("span", { class: "pqueue-button__badge", text: String(state.selectedPending.size) }));
                }
                
                executeSelectedBtn.removeEventListener('click', Events.executeSelectedJobs);
                executeSelectedBtn.addEventListener('click', Events.executeSelectedJobs);
            }

            // no explicit refresh button; updates are event-driven
        } catch (err) { /* noop */ }
    };

    UI.updateToolbarSummary = function updateToolbarSummary() {
        try {
            const m = state.metrics || {};
            if (state.dom.summaryRunning) state.dom.summaryRunning.textContent = String(m.runningCount || 0);
            if (state.dom.summaryPending) state.dom.summaryPending.textContent = String(m.queueCount || 0);
            const histCount = (state.historyTotal != null) ? state.historyTotal : (m.historyCount || 0);
            if (state.dom.summaryHistory) state.dom.summaryHistory.textContent = String(histCount || 0);
            if (state.dom.summarySuccess) state.dom.summarySuccess.textContent = (m.successRate != null) ? `${Math.round(m.successRate * 100)}%` : '—';
            if (state.dom.summaryEta) state.dom.summaryEta.textContent = m.estimatedTotalDuration ? Format.duration(m.estimatedTotalDuration) : '—';
        } catch (err) { /* noop */ }
    };
})();




